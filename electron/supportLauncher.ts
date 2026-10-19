import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { installedSupportSelection } from './supportDistribution';
import { supportText } from '../shared/support/messages';
import type { AppLanguage } from '../shared/types';

let startHelper: typeof spawn | undefined;
let openDownloads: typeof shell.openExternal | undefined;
// Called by the early bootstrap before installing the copied-profile boundary.
// This grants only the fixed Support launcher below, never a generic spawn API.
export function prepareSupportLauncher():void {
  startHelper ??= spawn;
  openDownloads ??= shell.openExternal.bind(shell);
}
export async function openNodusSupport(language: AppLanguage): Promise<void> {
  if(!startHelper||!openDownloads)throw new Error('Support launcher was not initialized');
  const resources = process.resourcesPath;
  const legacyExecutable = process.platform === 'darwin'
    ? path.join(resources, 'nodus-support/Nodus Support.app/Contents/MacOS/nodus-support')
    : path.join(resources, 'nodus-support/app', process.platform === 'win32' ? 'nodus-support.exe' : 'nodus-support');
  const managed=await installedSupportSelection();
  const managedExecutable=managed?.executable;
  const executable=managedExecutable??(fs.existsSync(legacyExecutable)?legacyExecutable:null);
  if (!executable) {
    await openDownloads('https://github.com/jorgepb96/nodus/releases/latest'); return;
  }
  const response = await dialog.showMessageBox({ type: 'info', message: supportText(language, 'title'), detail: supportText(language, 'backupHelp'), buttons: [supportText(language, 'cancel'), supportText(language, 'confirm')], defaultId: 0, cancelId: 0, noLink: true });
  if (response.response !== 1) return;
  const installed = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath;
  const appData=process.env.NODUS_SUPPORT_ORIGINAL_APP_DATA??app.getPath('appData');
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('NODUS_'))delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.NODE_PATH;
  if(process.platform==='linux'&&process.env.NODUS_SUPPORT_ORIGINAL_APP_DATA)env.XDG_CONFIG_HOME=appData;
  const originalTemp=process.env.NODUS_SUPPORT_ORIGINAL_TEMP;
  if(originalTemp)for(const key of ['TMP','TEMP','TMPDIR'])env[key]=originalTemp;
  const token=managedExecutable?randomUUID():null;
  const child = startHelper(executable, [...(token?[`--support-launch-token=${token}`]:[]),`--support-state=${path.join(appData,'Nodus Support')}`,`--nodus-profile=${process.env.NODUS_SUPPORT_ORIGINAL_PROFILE ?? app.getPath('userData')}`, `--nodus-executable=${installed}`, `--nodus-version=${app.getVersion()}`], { detached: true, stdio: 'ignore',env });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  if(token) {
    const receipt=path.join(appData,'Nodus Support','launch-receipts',`${token}.json`);
    const deadline=Date.now()+90000;let opened=false;
    while(Date.now()<deadline){
      try{const value=JSON.parse(fs.readFileSync(receipt,'utf8'));if(value.format==='nodus.support-ready/1'&&value.token===token){
        if(value.version!==managed?.manifest.version){await dialog.showMessageBox({type:'info',message:'Nodus Support',detail:supportText(language,'supportCloseOlder')});return;}
        opened=true;break;
      }}catch{/* The separate helper may still be retaining its runtime. */}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(!opened)throw new Error('SUPPORT_STARTUP_FAILED');
  }
  // Existing before-quit/editor guards must save work. Support never forces termination.
  app.quit();
}
