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
      import {app,dialog} from 'electron';import {isolateSupportApplication} from './electron/support/isolation.ts';
      import {listAppleCalendars,mutateAppleCalendar} from './electron/calendar/appleCalendarBridge.ts';
      const root=process.env.SUPPORT_FIXTURE_ROOT,original=process.env.SUPPORT_FIXTURE_ORIGINAL;
      isolateSupportApplication(root);
      await assert.rejects(listAppleCalendars(true),error=>error.code==='SUPPORT_EXTERNAL_ACTION_DENIED');
      await assert.rejects(mutateAppleCalendar({action:'delete',nativeId:'synthetic'}),error=>error.code==='SUPPORT_EXTERNAL_ACTION_DENIED');
      assert.throws(()=>app.relaunch(),/SUPPORT_EXTERNAL_ACTION_DENIED/);
      assert.throws(()=>app.setLoginItemSettings({openAtLogin:true}),/SUPPORT_EXTERNAL_ACTION_DENIED/);
      process.env.SUPPORT_SAVE_PATH=original;
      await assert.rejects(dialog.showSaveDialog({}),/SUPPORT_WRITE_DENIED/);
      assert.throws(()=>dialog.showSaveDialogSync({}),/SUPPORT_WRITE_DENIED/);
      process.env.SUPPORT_SAVE_PATH=path.join(root,'new-export.pdf');
      assert.equal((await dialog.showSaveDialog({})).filePath,process.env.SUPPORT_SAVE_PATH);
      assert.equal(fs.readFileSync(original,'utf8'),'preserve original');
    `,resolveDir:path.resolve(import.meta.dirname,'..')},outfile:bundle,bundle:true,platform:'node',format:'esm',plugins:[{name:'controlled-electron',setup(builder){
      builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test-electron'}));
      builder.onLoad({filter:/.*/,namespace:'test-electron'},()=>({contents:`
        import {EventEmitter} from 'node:events';
        export const app=Object.assign(new EventEmitter(),{whenReady:async()=>{},getAppPath:()=>process.env.SUPPORT_FIXTURE_ROOT,getLocale:()=> 'en',relaunch(){},setLoginItemSettings(){},setAsDefaultProtocolClient(){},removeAsDefaultProtocolClient(){}});
        export const net={request(){},async fetch(){}};export const utilityProcess={fork(){}};
        export const safeStorage={decryptString(){},encryptString(){}};
        export const shell={async openExternal(){},async openPath(){},async trashItem(){}};
        export const systemPreferences={setUserDefault(){},removeUserDefault(){}};
        export const dialog={async showSaveDialog(){return {canceled:false,filePath:process.env.SUPPORT_SAVE_PATH}},showSaveDialogSync(){return process.env.SUPPORT_SAVE_PATH}};
        export const session={defaultSession:{webRequest:{onBeforeRequest(){}},setPermissionRequestHandler(){},on(){}}};
      `,loader:'js'}));
    }}]});
    execFileSync(process.execPath,[bundle],{env:{...process.env,NODUS_SUPPORT_INTERACTIVE:'1',NODUS_SUPPORT_LANGUAGE:'en',SUPPORT_FIXTURE_ROOT:root,SUPPORT_FIXTURE_ORIGINAL:original},stdio:'pipe'});
  } finally {fs.rmSync(base,{recursive:true,force:true});}
});
