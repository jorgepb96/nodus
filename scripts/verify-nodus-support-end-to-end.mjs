// Production Support main/preload/renderer and real Nodus code, disposable profiles.
// Only the qualification catalog and native approval dialogs are test-controlled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createPackage} from '@electron/asar';
import {_electron} from 'playwright-core';
import {inventory,hashFile,verifyInventory} from '../apps/nodus-support/core/files.mjs';
import {supportSourceDigest} from './lib/supportEvidence.mjs';
const repo=path.resolve(import.meta.dirname,'..'),sourceSha256=supportSourceDigest(repo),require=createRequire(import.meta.url),electron=require('electron'),version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version;
assert.equal(process.env.CI,'true','This full process-discovery test requires a disposable native CI host, with no personal Nodus session');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-e2e-'))),runtime=path.join(root,process.platform==='darwin'?'NodusSupportQA.app':'runtime');
const source=process.platform==='darwin'?path.resolve(electron,'../../..'):path.dirname(electron);
fs.cpSync(source,runtime,{recursive:true,verbatimSymlinks:true});
const resources=process.platform==='darwin'?path.join(runtime,'Contents/Resources'):path.join(runtime,'resources'),executable=process.platform==='darwin'?path.join(runtime,'Contents/MacOS/NodusSupportQA'):path.join(runtime,process.platform==='win32'?'NodusSupportQA.exe':'NodusSupportQA');
fs.renameSync(process.platform==='darwin'?path.join(runtime,'Contents/MacOS/Electron'):path.join(runtime,path.basename(electron)),executable);
const entry=path.join(root,'fixture-app');fs.mkdirSync(entry);
fs.writeFileSync(path.join(entry,'package.json'),JSON.stringify({name:'nodus',version,main:'entry.mjs',type:'module'}));
fs.writeFileSync(path.join(entry,'entry.mjs'),`
 import {app} from 'electron';import fs from 'node:fs';import path from 'node:path';
 const root=process.env.NODUS_ISOLATED_ROOT,fixture=${JSON.stringify(root)};
 if(!root||!path.resolve(root).startsWith(fixture+path.sep)||!(process.env.NODUS_SUPPORT_PROBE==='1'||process.env.NODUS_SUPPORT_INTERACTIVE==='1'))app.exit(1);
 else {
 app.getAppPath=()=>${JSON.stringify(repo)};
 if(process.env.NODUS_SUPPORT_INTERACTIVE==='1'){
   app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',()=>{
     const until=Date.now()+60000;
     const edit=async()=>{
       if(window.isDestroyed()||Date.now()>until)return;
       try{const note=await window.webContents.executeJavaScript('window.nodus?.createNote({title:"Support qualification",content:"New work saved through the real renderer and IPC"})');
         if(note?.id){fs.writeFileSync(path.join(root,'qualification-note.json'),JSON.stringify(note),{flag:'wx'});return;}
       }catch(error){fs.writeFileSync(path.join(root,'qualification-note-error.txt'),String(error));}
       setTimeout(()=>void edit(),250).unref();
     };void edit();
   }));
   const poll=setInterval(()=>{if(fs.existsSync(path.join(root,'qualification-quit')))app.quit();},200);poll.unref();
   app.once('will-quit',()=>fs.writeFileSync(path.join(root,'qualification-closed'),'cooperative quit'));
 }
 await import(${JSON.stringify(pathToFileURL(path.join(repo,'dist-electron/bootstrap.js')).href)});
 }
`);
await createPackage(entry,path.join(resources,'app.asar'));
fs.writeFileSync(path.join(resources,'nodus-support-protocol.json'),JSON.stringify({protocol:1,trialReadyProtocol:1,supportSourceSha256:sourceSha256,version,platform:process.platform,arch:process.arch,archiveSha256:await hashFile(path.join(resources,'app.asar'))}));
if(process.platform==='darwin') {
 execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleExecutable NodusSupportQA',path.join(runtime,'Contents/Info.plist')]);
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',runtime],{stdio:'pipe'});
}
execFileSync(electron,[path.join(repo,'scripts/support-native-fixture.mjs'),root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
const profile=path.join(root,'original'),external=path.join(root,'external-vault'),library=path.join(root,'external-library'),before=await Promise.all([profile,external,library].map(file=>inventory(file)));
const helper=path.join(root,'helper');fs.cpSync(path.join(repo,'build/support-app'),helper,{recursive:true});
await build({entryPoints:[path.join(repo,'apps/nodus-support/main.mjs')],outfile:path.join(helper,'main.mjs'),define:{__NODUS_SUPPORT_SOURCE_SHA256__:JSON.stringify(sourceSha256)},bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],banner:{js:'import{createRequire as __fixtureRequire}from"node:module";const require=__fixtureRequire(import.meta.url);const __dirname=__fixtureRequire(import.meta.url)("node:path").dirname(__fixtureRequire(import.meta.url)("node:url").fileURLToPath(import.meta.url));'},plugins:[{name:'test-only-qualification-and-dialogs',setup(builder){
 builder.onLoad({filter:/qualified-repairs\.json$/},()=>({contents:JSON.stringify({format:'nodus.support-qualified-repairs/2',sourceSha256,protocol:1,platforms:{[`${process.platform}-${process.arch}`]:['interactive-copy','apply-solution']}}),loader:'json'}));
 builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'qualification-electron'}));
 builder.onLoad({filter:/.*/,namespace:'qualification-electron'},()=>({loader:'js',contents:`
 import{createRequire}from'node:module';const e=createRequire(import.meta.url)('electron');
 export const {app,BrowserWindow,clipboard,ipcMain,net,protocol,shell}=e;
 export const dialog={...e.dialog,async showMessageBox(_window,options){if(!options.message||!options.buttons?.length)throw new Error('Unexpected approval');return{response:0,checkboxChecked:true};},async showOpenDialog(){throw new Error('Unexpected file selection');},async showSaveDialog(){throw new Error('Unexpected export');}};
 `}));
}}]});
const state=path.join(root,'support-state'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
if(process.platform==='linux') {
 const sandbox=path.join(repo,'node_modules/electron/dist/chrome-sandbox'),stat=fs.statSync(sandbox);assert.equal(stat.uid,0);assert.ok(stat.mode&0o4000);env.CHROME_DEVEL_SANDBOX=sandbox;
}
const args=[helper,`--support-state=${state}`,`--nodus-profile=${profile}`,`--nodus-executable=${executable}`];
let app,page;const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});
const wait=async(test,message)=>{const until=Date.now()+90000;while(Date.now()<until){if(await test())return;await new Promise(resolve=>setTimeout(resolve,200));}assert.fail(message);};
const open=async()=>{app=await _electron.launch({args,env,timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(120000);await page.locator('h1').waitFor();};
const api=(method,...args)=>page.evaluate(async({method,args})=>window.nodusSupport[method](...args),{method,args});
const button=name=>page.getByRole('button',{name,exact:true});
const session=async()=>{const inspection=await api('inspect');return inspection.sessions.at(0);};
async function closeTrial(value){const trial=value.trialOpened;await wait(()=>fs.existsSync(path.join(trial,'qualification-note.json')),`Actual note was not saved: ${fs.existsSync(path.join(trial,'qualification-note-error.txt'))?fs.readFileSync(path.join(trial,'qualification-note-error.txt'),'utf8'):trial}`);const note=JSON.parse(fs.readFileSync(path.join(trial,'qualification-note.json'),'utf8'));assert.ok(note.id);assert.match(note.content,/New work saved/);fs.writeFileSync(path.join(trial,'qualification-quit'),'user closed test');await wait(()=>fs.existsSync(path.join(trial,'qualification-closed')),'Nodus did not quit cooperatively');await new Promise(resolve=>setTimeout(resolve,2000));return trial;}
try {
 await open();await button('Check my installation').click();await button('Create verified copy').click();await page.locator('.test-list .test-row').first().waitFor();
 await page.locator('.test-list').first().getByRole('button').click();await page.waitForFunction(()=>document.querySelector('.test-list')?.textContent?.includes('graphics'));
 await page.locator('.test-list').first().getByRole('button').click();await button('It works now').waitFor();assert.equal(await button('It works now').isDisabled(),true);
 await page.getByRole('button',{name:/^Open additional copy/}).last().click();await wait(async()=>!!(await session()).trialOpened,'Trial readiness never confirmed');
 let value=await session();const trial=await closeTrial(value);await button('It works now').click();await button('Use this solution when opening Nodus').click();
 await wait(async()=>!!(await session()).policyApplied,'Actual launch policy not applied');value=await session();
 // A later edit forces an explicit conflict and a newly verified retained copy.
 fs.writeFileSync(path.join(trial,'profile','later-user-work.txt'),'work entered after applying solution');
 await button('Return to the previous state, keeping all copies').click();await button('Use the previous profile and retain this one too').click();
 await wait(async()=>(await session()).status==='reverted','Actual undo failed');value=await session();assert.ok(value.divergenceVerified);
 assert.equal(fs.readFileSync(path.join(value.divergenceVerified,'profile/later-user-work.txt'),'utf8'),'work entered after applying solution');
 await verifyInventory(path.join(trial,'profile'),JSON.parse(fs.readFileSync(path.join(value.divergenceVerified,'manifest.json'),'utf8')).inventory);
 await app.close();await open();await api('resume',value.id);assert.equal((await session()).status,'reverted');
 // A second real UI run exercises the automatic sequence and the negative answer.
 await page.getByRole('radio').nth(1).check();await button('Check my installation').click();await button('Create verified copy').click();await button('Automatic sequence').click();await button('It works now').waitFor();
 await page.getByRole('button',{name:/^Open additional copy/}).last().click();await wait(async()=>!!(await session()).trialOpened,'Automatic trial did not become ready');await closeTrial(await session());
 await button('Still not working').click();await button('Get help').click();await page.locator('textarea').waitFor();assert.match(await page.locator('textarea').inputValue(),/Nodus support report/);
 assert.equal(await button('Open issue on GitHub').isDisabled(),true);
 assert.deepEqual(await Promise.all([profile,external,library].map(file=>inventory(file))),before);
 assert.equal(supportSourceDigest(repo),sourceSha256);
 fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}-end-to-end.json`),JSON.stringify({format:'nodus.support-e2e-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,productionMain:true,productionPreload:true,productionRenderer:true,realNodusRuntime:true,testOnlyCatalog:true,guided:true,automatic:true,trialReadiness:true,actualNoteSaved:true,policyApplied:true,divergentWorkPreserved:true,rollback:true,assistantRestart:true,negativeAnswer:true,reviewedReport:true,originalsUnchanged:true},null,2));
 console.log('Actual Support main/preload/UI + actual Nodus: guided and automatic trial, saved note, policy, divergent work, undo, restart and report passed.');
}catch(error){await page?.screenshot({path:path.join(output,`${process.platform}-${process.arch}-e2e-failure.png`),fullPage:true}).catch(()=>{});throw error;}finally{await app?.close();}
