import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

test('trial windows cannot mutate OS calendars, restart the app or pass original filenames to native exporters',async()=>{
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-native-boundary-'))),root=path.join(base,'copy'),original=path.join(base,'original');fs.mkdirSync(root);fs.writeFileSync(original,'preserve original');
  const bundle=path.join(base,'guard-test.mjs');
  try {
    await build({stdin:{contents:`
      import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
      import {app,dialog,ipcMain} from 'electron';import {isolateSupportApplication} from './electron/support/isolation.ts';
      import {listAppleCalendars,mutateAppleCalendar} from './electron/calendar/appleCalendarBridge.ts';
      import {prepareSupportLauncher,openNodusSupport} from './electron/supportLauncher.ts';
      const root=process.env.SUPPORT_FIXTURE_ROOT,original=process.env.SUPPORT_FIXTURE_ORIGINAL;
      Object.defineProperty(process,'resourcesPath',{value:path.join(root,'resources')});
      const helper=process.platform==='darwin'?path.join(process.resourcesPath,'nodus-support/Nodus Support.app/Contents/MacOS/nodus-support'):path.join(process.resourcesPath,'nodus-support/app',process.platform==='win32'?'nodus-support.exe':'nodus-support');
      fs.mkdirSync(path.dirname(helper),{recursive:true});fs.writeFileSync(helper,'synthetic helper');prepareSupportLauncher();
      isolateSupportApplication(root);
      await assert.rejects(listAppleCalendars(true),error=>error.code==='SUPPORT_EXTERNAL_ACTION_DENIED');
      await assert.rejects(mutateAppleCalendar({action:'delete',nativeId:'synthetic'}),error=>error.code==='SUPPORT_EXTERNAL_ACTION_DENIED');
      assert.throws(()=>process.kill(process.pid,0),/SUPPORT_PROCESS_DENIED/);
      for(const channel of ['updates:install','calendar:delete','toolkit:job:run','settings:setApiKey']){ipcMain.handle(channel,()=>{throw new Error('Unrestricted handler reached');});await assert.rejects(globalThis.supportHandlers[channel](),error=>!error.message.includes('Unrestricted'));}
      ipcMain.handle('notes:get',()=> 'copied note');assert.equal(globalThis.supportHandlers['notes:get'](),'copied note');
      assert.throws(()=>app.relaunch(),/SUPPORT_EXTERNAL_ACTION_DENIED/);
      assert.throws(()=>app.setLoginItemSettings({openAtLogin:true}),/SUPPORT_EXTERNAL_ACTION_DENIED/);
      process.env.SUPPORT_SAVE_PATH=original;
      await assert.rejects(dialog.showSaveDialog({}),/SUPPORT_WRITE_DENIED/);
      assert.throws(()=>dialog.showSaveDialogSync({}),/SUPPORT_WRITE_DENIED/);
      await assert.rejects(dialog.showOpenDialog({}),/SUPPORT_WRITE_DENIED/);
      assert.throws(()=>dialog.showOpenDialogSync({}),/SUPPORT_WRITE_DENIED/);
      process.env.SUPPORT_SAVE_PATH=path.join(root,'new-export.pdf');
      assert.equal((await dialog.showSaveDialog({})).filePath,process.env.SUPPORT_SAVE_PATH);
      assert.deepEqual((await dialog.showOpenDialog({})).filePaths,[process.env.SUPPORT_SAVE_PATH]);
      assert.deepEqual(dialog.showOpenDialogSync({}),[process.env.SUPPORT_SAVE_PATH]);
      process.env.NODUS_SUPPORT_ORIGINAL_APP_DATA=path.join(root,'system-config');process.env.NODUS_SUPPORT_ORIGINAL_PROFILE=path.join(root,'selected-profile');
      await openNodusSupport('en');
      assert.equal(globalThis.supportLaunch.executable,helper);assert.ok(globalThis.supportLaunch.args.includes('--support-state='+path.join(root,'system-config/Nodus Support')));
      assert.ok(globalThis.supportLaunch.args.includes('--nodus-profile='+path.join(root,'selected-profile')));
      assert.equal(Object.keys(globalThis.supportLaunch.options.env).some(key=>key.startsWith('NODUS_')),false);
      assert.equal('ELECTRON_RUN_AS_NODE' in globalThis.supportLaunch.options.env,false);
      assert.equal(fs.readFileSync(original,'utf8'),'preserve original');
    `,resolveDir:path.resolve(import.meta.dirname,'..')},outfile:bundle,bundle:true,platform:'node',format:'esm',banner:{js:'import{createRequire as __fixtureRequire}from"node:module";const require=__fixtureRequire(import.meta.url);'},plugins:[{name:'controlled-electron',setup(builder){
      builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test-electron'}));
      builder.onResolve({filter:/^node:child_process$/},()=>({path:'child-process',namespace:'test-child-process'}));
      builder.onLoad({filter:/.*/,namespace:'test-child-process'},()=>({contents:`
        import {EventEmitter} from 'node:events';
        export const spawn=(executable,args,options)=>{globalThis.supportLaunch={executable,args,options};const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
        export const execFile=()=>{};
        export default {spawn,execFile};
      `,loader:'js'}));
      builder.onLoad({filter:/.*/,namespace:'test-electron'},()=>({contents:`
        import {EventEmitter} from 'node:events';
        export const app=Object.assign(new EventEmitter(),{whenReady:async()=>{},getAppPath:()=>process.env.SUPPORT_FIXTURE_ROOT,getPath:()=>process.env.SUPPORT_FIXTURE_ROOT,getVersion:()=> '5.13.0',getLocale:()=> 'en',quit(){},relaunch(){},setLoginItemSettings(){},setAsDefaultProtocolClient(){},removeAsDefaultProtocolClient(){}});
        export const ipcMain={handle(channel,listener){globalThis.supportHandlers??={};globalThis.supportHandlers[channel]=listener;}};
        export const net={request(){},async fetch(){}};export const utilityProcess={fork(){}};
        export const safeStorage={decryptString(){},encryptString(){}};
        export const shell={async openExternal(){},async openPath(){},async trashItem(){}};
        export const systemPreferences={setUserDefault(){},removeUserDefault(){}};
        export const dialog={async showMessageBox(){return {response:1}},async showSaveDialog(){return {canceled:false,filePath:process.env.SUPPORT_SAVE_PATH}},showSaveDialogSync(){return process.env.SUPPORT_SAVE_PATH},async showOpenDialog(){return {canceled:false,filePaths:[process.env.SUPPORT_SAVE_PATH]}},showOpenDialogSync(){return [process.env.SUPPORT_SAVE_PATH]}};
        export const session={defaultSession:{webRequest:{onBeforeRequest(){}},setPermissionRequestHandler(){},on(){}}};
      `,loader:'js'}));
    }}]});
    execFileSync(process.execPath,[bundle],{env:{...process.env,NODUS_SUPPORT_INTERACTIVE:'1',NODUS_SUPPORT_LANGUAGE:'en',SUPPORT_FIXTURE_ROOT:root,SUPPORT_FIXTURE_ORIGINAL:original},stdio:'pipe'});
  } finally {fs.rmSync(base,{recursive:true,force:true});}
});
