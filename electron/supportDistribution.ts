import {app,dialog,shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SupportAppInstallation} from '../apps/nodus-support/core/app-installation.mjs';
import {acceptPlatformSignature,downloadArtifact} from '../apps/nodus-support/core/releases.mjs';
import {resolveSupportApp,selectSupportInstaller,supportInstallerFormat,type SupportAppManifest} from '../shared/support/appDistribution.mjs';
import type {SupportDistributionState} from '../shared/support/distributionTypes';
import {supportText} from '../shared/support/messages';
import type {AppLanguage} from '../shared/types';
import trusted from '../apps/nodus-support/trusted-release-keys.json';
const run=promisify(execFile);
let state:SupportDistributionState={phase:'idle',platform:process.platform,arch:process.arch};
let release:{manifest:SupportAppManifest;envelope:unknown}|null=null;
let controller:AbortController|null=null;
let promptPending=false;
let ready:Promise<void>|null=null;
const storage=()=>path.join(process.env.NODUS_SUPPORT_ORIGINAL_APP_DATA??app.getPath('appData'),'Nodus Support','installations');
async function verifyPlatform(executable:string,manifest:SupportAppManifest):Promise<void> {
  if(process.platform==='darwin') {
    const bundle=path.resolve(executable,'../../..');
    await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);await run('/usr/sbin/spctl',['--assess','--type','execute',bundle]);
  } else if(process.platform==='win32') {
    const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const result=await run(powershell,['-NoProfile','-NonInteractive','-Command','(Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_SIGNATURE_FILE).Status.ToString()'],{env:{...process.env,NODUS_SUPPORT_SIGNATURE_FILE:executable}});
    acceptPlatformSignature(result.stdout.trim(),manifest.runtime.platformSignature);
  }
}
const manager=()=>new SupportAppInstallation({storage:storage(),keys:trusted.keys,platform:process.platform,arch:process.arch,verifyPlatform});
function allowDownload():void {if(process.env.NODUS_SUPPORT_INTERACTIVE==='1')throw new Error('SUPPORT_EXTERNAL_ACTION_DENIED');}
export async function installedSupportSelection(){
  const current=await manager().current();if(current)state={...state,installedVersion:current.manifest.version};return current;
}
export async function installedSupportExecutable():Promise<string|null>{return (await installedSupportSelection())?.executable??null;}
export async function supportDistributionState():Promise<SupportDistributionState> {
  ready??=installedSupportExecutable().then(()=>{}).catch(()=>{});await ready;return {...state};
}
async function detectedFormat():Promise<string> {
  if(process.platform!=='linux')return supportInstallerFormat(process.platform);
  const installed=process.env.APPIMAGE??process.execPath;
  if(process.env.APPIMAGE)return 'AppImage';
  let deb=false,rpm=false;
  try {deb=(await run('/usr/bin/dpkg-query',['--search',installed])).stdout.trim().length>0;}catch{/* RPM or AppImage. */}
  if(!deb)try{rpm=(await run('/usr/bin/rpm',['-qf',installed])).stdout.trim().length>0;}catch{/* A portable installation. */}
  return supportInstallerFormat(process.platform,{deb,rpm});
}
function failure(error:unknown):void {
  const code=String((error as {code?:string;message?:string})?.code??(error as Error)?.message??'SUPPORT_DOWNLOAD_INVALID');
  state={...state,phase:controller?.signal.aborted?'cancelled':code==='SUPPORT_ASSET_PENDING'?'pending':'error',error:code};
}
export async function checkSupportDownload():Promise<SupportDistributionState> {
  allowDownload();if(controller||promptPending)return supportDistributionState();controller=new AbortController();state={...state,phase:'checking',error:undefined};
  try {
    release=await resolveSupportApp(app.getVersion(),trusted.keys,process.platform,process.arch,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
    const installerFormat=await detectedFormat();selectSupportInstaller(release.manifest,installerFormat);
    state={...state,phase:'available',availableVersion:release.manifest.version,installerFormat,bytes:release.manifest.runtime.bytes,completed:0};
  }catch(error){release=null;failure(error);}finally{controller=null;}
  return {...state};
}
async function installSupportShortcut(executable:string,version:string):Promise<void> {
  // Never overwrite a user shortcut or an older installation. Each verified app has its own entry.
  const label=`Nodus Support ${version} ${randomUUID().slice(0,8)}`;
  if(process.platform==='darwin') {
    const applications=path.join(app.getPath('home'),'Applications');await fsp.mkdir(applications,{recursive:true});
    const shortcut=path.join(applications,`${label}.app`);await fsp.symlink(path.resolve(executable,'../../..'),shortcut);
    shell.showItemInFolder(shortcut);
  } else if(process.platform==='win32') {
    const programs=path.join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs');await fsp.mkdir(programs,{recursive:true});
    const shortcut=path.join(programs,`${label}.lnk`);
    if(fs.existsSync(shortcut)||!shell.writeShortcutLink(shortcut,'create',{target:executable,description:'Nodus Support',icon:executable,iconIndex:0}))throw new Error('SUPPORT_SHORTCUT_FAILED');
  } else {
    const applications=path.join(process.env.XDG_DATA_HOME??path.join(app.getPath('home'),'.local/share'),'applications');await fsp.mkdir(applications,{recursive:true});
    const quote=(value:string)=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('$','\\$').replaceAll('`','\\`').replaceAll('%','%%')+'"';
    const shortcut=path.join(applications,`nodus-support-${randomUUID()}.desktop`);
    await fsp.writeFile(shortcut,`[Desktop Entry]\nType=Application\nVersion=1.0\nName=${label}\nComment=Nodus Support\nExec=${quote(executable)}\nIcon=${path.join(path.dirname(executable),'resources/support-icon.png')}\nTerminal=false\nCategories=Utility;\n`,{flag:'wx',mode:0o700});
  }
}
export async function installSupportDownload(language:AppLanguage):Promise<SupportDistributionState> {
  allowDownload();if(controller||promptPending||!release||state.phase!=='available')return supportDistributionState();
  promptPending=true;let confirm;
  try{confirm=await dialog.showMessageBox({type:'info',message:supportText(language,'installSupport'),detail:supportText(language,'supportInstallHelp'),buttons:[supportText(language,'cancel'),supportText(language,'confirm')],defaultId:0,cancelId:0,noLink:true});}finally{promptPending=false;}
  if(confirm.response!==1)return {...state};if(controller)return {...state};
  controller=new AbortController();state={...state,phase:'downloading',completed:0,error:undefined};
  try {
    const installed=await manager().install(release.envelope,{signal:controller.signal,progress:value=>{state={...state,phase:value.phase==='installing'?'installing':'downloading',completed:value.completed??state.completed};}});
    state={...state,phase:'installed',installedVersion:installed.manifest.version};
    await installSupportShortcut(installed.executable,installed.manifest.version);
  }catch(error){failure(error);}finally{controller=null;}
  return {...state};
}
export async function saveSupportInstaller(language:AppLanguage):Promise<SupportDistributionState> {
  allowDownload();if(controller||promptPending||!release)return supportDistributionState();const artifact=selectSupportInstaller(release.manifest,state.installerFormat??await detectedFormat());
  promptPending=true;let destination;
  try {
    const confirm=await dialog.showMessageBox({type:'info',message:supportText(language,'saveSupportInstaller'),detail:supportText(language,'supportSystemInstallerHelp'),buttons:[supportText(language,'cancel'),supportText(language,'confirm')],defaultId:0,cancelId:0,noLink:true});
    if(confirm.response!==1)return {...state};
    destination=await dialog.showOpenDialog({title:supportText(language,'saveSupportInstaller'),properties:['openDirectory','createDirectory']});
    if(destination.canceled||!destination.filePaths[0])return {...state};
  }finally{promptPending=false;}
  controller=new AbortController();state={...state,phase:'downloading',error:undefined,bytes:artifact.bytes,completed:0};
  try {
    // Unique destination: even a previous download is retained. Never overwrite a chosen file.
    const folder=path.join(destination.filePaths[0],`Nodus-Support-${release.manifest.version}-${randomUUID()}`);
    const file=await downloadArtifact(artifact,folder,{signal:controller.signal,progress:value=>{state={...state,completed:value.completed};}});
    state={...state,phase:'saved'};shell.showItemInFolder(file);
  }catch(error){failure(error);}finally{controller=null;}
  return {...state};
}
export function cancelSupportDownload():SupportDistributionState {controller?.abort();return {...state};}
export async function revealSupportInstallation():Promise<void> {
  const executable=await installedSupportExecutable();if(executable)shell.showItemInFolder(process.platform==='darwin'?path.resolve(executable,'../../..'):executable);
}
