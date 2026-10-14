import {app, BrowserWindow} from 'electron';
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LESSON_IDS, learningProgress, mergeLearningProgressChange, sanitizeLearningProgress, type AcademicLessonId} from '@shared/academicLearning';
import {learningWorkspaceSettings, type LearningWorkspaceInfo} from '@shared/learningWorkspace';
import {learningText} from '@shared/academicLearningCopy';
import {getSettings, updateSettings} from '../db/settingsRepo';
import {readGlobalPrefsRaw, writeGlobalPrefsRaw} from '../db/appPrefs';
import {getActiveVault} from '../vaults/vaultRegistry';
import {apiKeyCandidateFiles} from '../secrets/secretStore';
import {SECRET_PROVIDERS} from '@shared/providers';

export const isLearningWorkspace = () => process.env.NODUS_LEARNING_WORKSPACE === '1';
const entryFile = () => path.join(app.getPath('userData'),'learning-entry.json');
let entry: (LearningWorkspaceInfo & {requestId:string;settings:ReturnType<typeof learningWorkspaceSettings>}) | null = null;
let child: ChildProcess | null = null;
let closeSent=false;

export function learningWorkspaceInfo(): LearningWorkspaceInfo | null {
  if(!isLearningWorkspace())return null;
  entry ??= JSON.parse(fs.readFileSync(entryFile(),'utf8'));
  if(!entry || !LESSON_IDS.includes(entry.lessonId))throw new Error('Invalid learning workspace.');
  const {originVaultName,lessonId,resume,importExample}=entry;
  return {originVaultName,lessonId,resume,importExample};
}

export function initializeLearningWorkspace(): void {
  app.once('will-quit',()=>{child?.kill();});
  if(!learningWorkspaceInfo())return;
  process.once('disconnect',()=>app.quit());
  if(readGlobalPrefsRaw().learningWorkspaceVersion !== 1) {
    updateSettings({...entry!.settings,autoBackupFolder:path.join(app.getPath('userData'),'storage')});
    writeGlobalPrefsRaw({learningWorkspaceVersion:1});
  } else {
    // A resumed corpus keeps its models/checkpoints; the UI follows the current user language.
    updateSettings({uiLanguage:entry!.settings.uiLanguage,promptLanguage:entry!.settings.promptLanguage});
  }
}

export function learningWorkspaceReady(): void {
  if(!isLearningWorkspace())return;
  if(process.connected)process.send?.({kind:'learning-ready',requestId:entry!.requestId});
}

export function closeLearningWorkspace(discard=false): void {
  if(!isLearningWorkspace())throw new Error('No learning workspace is open.');
  if(closeSent)return;
  closeSent=true;
  if(process.connected)process.send?.({kind:'learning-finished',requestId:entry!.requestId,discard,progress:getSettings().academicLearningProgress});
  setTimeout(()=>app.quit(),50);
  // app.quit() is cooperative (see quitForUpdate in main.ts): an editor flush can cancel it
  // and leave this hidden process alive, the user's own window hidden behind it and a
  // discarded practice never deleted. The parent only acts on this process' exit.
  setTimeout(()=>app.exit(0),5000).unref?.();
}

/** A second real app instance owns every practice store and background worker. */
export async function openLearningWorkspace(lessonId: AcademicLessonId, origin: BrowserWindow | null): Promise<void> {
  if(isLearningWorkspace() || !LESSON_IDS.includes(lessonId))throw new Error('Invalid learning lesson.');
  if(child)throw new Error(learningText('workspaceAlreadyOpen',getSettings().uiLanguage));
  const owner=getActiveVault(),source=getSettings(),before=learningProgress(source.academicLearningProgress);
  const profile=path.join(app.getPath('userData'),'academic-learning-workspace');
  fs.mkdirSync(profile,{recursive:true,mode:0o700});
  const requestId=randomUUID();
  const firstLesson=fs.existsSync(path.join(profile,'nodus.sqlite'))||lessonId==='interface'?lessonId:'first-answer';
  const info={requestId,originVaultName:owner.name,lessonId:firstLesson,resume:true,importExample:true,settings:learningWorkspaceSettings(source)};
  fs.writeFileSync(path.join(profile,'learning-entry.json'),JSON.stringify(info),{mode:0o600});
  // Copy encrypted provider files only; the practice never reads/writes the user's stores.
  const secrets=path.join(profile,'secrets');fs.mkdirSync(secrets,{recursive:true,mode:0o700});
  for(const provider of SECRET_PROVIDERS) {
    const file=apiKeyCandidateFiles(provider)[0];
    if(file){const encrypted=fs.readFileSync(file);if(encrypted.subarray(0,4).toString()==='b64:')continue;fs.writeFileSync(path.join(secrets,`ai_key_${provider}.bin`),encrypted,{mode:0o600});}
  }
  const env:NodeJS.ProcessEnv={...process.env,NODUS_USERDATA:profile,NODUS_LEARNING_WORKSPACE:'1',NODUS_DISABLE_AUTO_UPDATE:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODUS_ISOLATED_ROOT;
  delete env.NODUS_TESSDATA_CACHE;
  const args=app.isPackaged?[]:[app.getAppPath()];
  if(process.env.NODUS_E2E_LEARNING_DEBUG==='1'){args.unshift('--inspect=0','--remote-debugging-port=0');if(process.platform==='linux')args.unshift('--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--disable-gpu-compositing');}
  child=spawn(process.execPath,args,{env,stdio:['ignore','ignore','ignore','ipc']});
  const running=child;let discard=false,ready=false;
  const visibleWindows=BrowserWindow.getAllWindows().filter(win=>win.isVisible());
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{running.kill();reject(new Error(learningText('workspaceFailed',source.uiLanguage)));},60000);
    running.on('message',(message:unknown)=>{
      if(!message || typeof message!=='object' || !('requestId' in message) || message.requestId!==requestId)return;
      const data=message as {kind?:string;discard?:boolean;progress?:unknown};
      if(data.kind==='learning-ready') {ready=true;clearTimeout(timer);visibleWindows.forEach(win=>win.hide());resolve();}
      if(data.kind==='learning-finished') {
        discard=data.discard===true;
        const progress=sanitizeLearningProgress(data.progress);
        if(progress){const current=learningProgress(getSettings().academicLearningProgress);updateSettings({academicLearningProgress:mergeLearningProgressChange(current,before,{...before,lessons:progress.lessons})});}
      }
    });
    running.once('error',()=>{clearTimeout(timer);reject(new Error(learningText('workspaceFailed',source.uiLanguage)));});
    running.once('exit',()=>{
      clearTimeout(timer);child=null;
      // This directory is fixed and private; neither a vault id nor a renderer path can redirect deletion.
      if(discard)fs.rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150});
      visibleWindows.forEach(win=>{if(!win.isDestroyed())win.show();});
      if(origin&&!origin.isDestroyed()){origin.show();origin.focus();origin.webContents.send('settings:changed');}
      if(!ready)reject(new Error(learningText('workspaceFailed',source.uiLanguage)));
    });
  });
}
