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
import {runProbe} from '../apps/nodus-support/core/probe.mjs';
import {SupportService} from '../apps/nodus-support/core/service.mjs';
import {waitForTrial} from '../apps/nodus-support/core/trial-ready.mjs';
import {randomUUID} from 'node:crypto';
import {supportSourceDigest} from './lib/supportEvidence.mjs';
const repo=path.resolve(import.meta.dirname,'..'),sourceSha256=supportSourceDigest(repo),require=createRequire(import.meta.url),electron=require('electron'),version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version;
const fixtureOnly=process.argv.includes('--verify-fixture-only'),interfaceOnly=process.argv.includes('--verify-interface-only');
if(interfaceOnly)assert.equal(process.platform,'darwin','Development interface verification is supported only on macOS');
if(!fixtureOnly&&!interfaceOnly)assert.equal(process.env.CI,'true','This full process-discovery test requires a disposable native CI host, with no personal Nodus session');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-e2e-'))),runtime=path.join(root,process.platform==='darwin'?'NodusSupportQA.app':'runtime');
const source=process.platform==='darwin'?path.resolve(electron,'../../..'):path.dirname(electron);
fs.cpSync(source,runtime,{recursive:true,verbatimSymlinks:true});
const resources=process.platform==='darwin'?path.join(runtime,'Contents/Resources'):path.join(runtime,'resources'),executable=process.platform==='darwin'?path.join(runtime,'Contents/MacOS/NodusSupportQA'):path.join(runtime,process.platform==='win32'?'NodusSupportQA.exe':'NodusSupportQA');
fs.renameSync(process.platform==='darwin'?path.join(runtime,'Contents/MacOS/Electron'):path.join(runtime,path.basename(electron)),executable);
const entry=path.join(root,'fixture-app');fs.mkdirSync(entry);
fs.writeFileSync(path.join(entry,'package.json'),JSON.stringify({name:'nodus',version,main:'entry.mjs',type:'module'}));
fs.writeFileSync(path.join(entry,'entry.mjs'),`
 import {app} from 'electron';import fs from 'node:fs';import path from 'node:path';
 const publishJSON=(file,value)=>{const pending=file+'.pending';fs.writeFileSync(pending,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(pending,file);};
 const root=process.env.NODUS_ISOLATED_ROOT,fixture=${JSON.stringify(root)};
 if(!root||!path.resolve(root).startsWith(fixture+path.sep)||!(process.env.NODUS_SUPPORT_PROBE==='1'||process.env.NODUS_SUPPORT_INTERACTIVE==='1'))app.exit(1);
 else {
 app.getAppPath=()=>${JSON.stringify(repo)};
 if(process.env.NODUS_SUPPORT_INTERACTIVE==='1'){
   app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',()=>{
     const until=Date.now()+60000;
     const edit=async()=>{
       if(window.isDestroyed()||Date.now()>until)return;
       try{
         const saved=path.join(root,'qualification-note.json');
         if(fs.existsSync(saved)){
           const id=JSON.parse(fs.readFileSync(saved,'utf8')).id;
           const previous=await window.webContents.executeJavaScript('window.nodus?.getNote('+JSON.stringify(id)+')');
           if(previous?.id===id){publishJSON(path.join(root,'qualification-note-reopened.json'),previous);return;}
         }
         const note=await window.webContents.executeJavaScript('window.nodus?.createNote({title:"Support qualification",content:"New work saved through the real renderer and IPC"})');
         if(note?.id){publishJSON(path.join(root,'qualification-note.json'),note);return;}
       }catch(error){fs.writeFileSync(path.join(root,'qualification-note-error.txt'),String(error));}
       setTimeout(()=>void edit(),250).unref();
     };void edit();
   }));
   const poll=setInterval(()=>{if(fs.existsSync(path.join(root,'qualification-quit')))app.quit();},200);poll.unref();
   app.once('will-quit',()=>fs.writeFileSync(path.join(root,'qualification-closed'),'cooperative quit'));
 }
 await import(${JSON.stringify(pathToFileURL(path.join(repo,JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).main)).href)});
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
if(fixtureOnly) {
 const service=new SupportService({profile,storage:path.join(root,'fixture-probe-state'),executable,probe:runProbe,isRunning:async()=>false});
 let value=await service.create({symptom:'startup',mode:'guided'});value=await service.protect(value.id);assert.equal(value.status,'protected');
 for(const action of ['fresh-profile','software-graphics']){value=await service.test(value.id,action);assert.equal(value.actions.find(attempt=>attempt.action===action).status,'passed',JSON.stringify(value));}
 const copy=value.recoveredProfiles.at(-1),token=randomUUID(),env={...process.env,NODUS_ISOLATED_ROOT:copy,NODUS_SUPPORT_INTERACTIVE:'1',NODUS_SUPPORT_TRIAL_TOKEN:token,NODUS_QA_DEFER_CREDENTIAL_STATUS:'1',NODUS_STELLAR_PREVIEW:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:executable,args:[],env,timeout:60000});
 try{const page=await app.firstWindow();await page.waitForFunction(()=>window.nodus&&document.getElementById('root')?.children.length);await waitForTrial({root:copy,token,version});const until=Date.now()+30000;while(!fs.existsSync(path.join(copy,'qualification-note.json'))&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,200));assert.ok(fs.existsSync(path.join(copy,'qualification-note.json')),fs.existsSync(path.join(copy,'qualification-note-error.txt'))?fs.readFileSync(path.join(copy,'qualification-note-error.txt'),'utf8'):'No saved note');}finally{await app.close();}
 assert.deepEqual(await Promise.all([profile,external,library].map(file=>inventory(file))),before);console.log('Native fixture: actual probes, real application, ready receipt and saved note passed without touching any other session.');process.exit(0);
}
const archiveService=new SupportService({profile,storage:path.join(root,'archive-fixture-state'),executable,probe:runProbe,isRunning:async()=>false});
let archiveSession=await archiveService.create({symptom:'data',mode:'guided'});archiveSession=await archiveService.protect(archiveSession.id);assert.equal(archiveSession.status,'protected');
const archiveCopy=await archiveService.workingCopy(archiveSession);execFileSync(electron,[path.join(repo,'scripts/support-native-archive-fixture.mjs'),archiveCopy.root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
const recoveryArchive=path.join(archiveCopy.root,'qualification.nodus');assert.ok(fs.existsSync(recoveryArchive));const archiveInventory=await inventory(recoveryArchive);
const helper=path.join(root,'helper');fs.cpSync(path.join(repo,'build/support-app'),helper,{recursive:true});
await build({entryPoints:[path.join(repo,'apps/nodus-support/main.mjs')],outfile:path.join(helper,'main.mjs'),define:{__NODUS_SUPPORT_SOURCE_SHA256__:JSON.stringify(sourceSha256)},bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],banner:{js:'import{createRequire as __fixtureRequire}from"node:module";const require=__fixtureRequire(import.meta.url);const __dirname=__fixtureRequire(import.meta.url)("node:path").dirname(__fixtureRequire(import.meta.url)("node:url").fileURLToPath(import.meta.url));'},plugins:[{name:'test-only-qualification-and-dialogs',setup(builder){
 if(interfaceOnly){
 builder.onResolve({filter:/^node:child_process$/},()=>({path:'child_process',namespace:'local-process-discovery'}));
 builder.onLoad({filter:/.*/,namespace:'local-process-discovery'},()=>({loader:'js',contents:`
 import{createRequire}from'node:module';import{promisify}from'node:util';const cp=createRequire(import.meta.url)('child_process');
 export const {spawn,spawnSync,execFileSync,execSync,fork}=cp;
 export const execFile=(...args)=>cp.execFile(...args);
 execFile[promisify.custom]=async(command,...args)=>{const result=await promisify(cp.execFile)(command,...args);if(command==='/bin/ps')result.stdout=result.stdout.split('\\n').filter(line=>line.includes(${JSON.stringify(root)})).join('\\n');return result;};
 export default {...cp,execFile};
 `}));
 }
 builder.onLoad({filter:/qualified-repairs\.json$/},()=>({contents:JSON.stringify({format:'nodus.support-qualified-repairs/2',sourceSha256,protocol:1,platforms:{[`${process.platform}-${process.arch}`]:['interactive-copy','apply-solution','restore-copy','reinstall']}}),loader:'json'}));
 builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'qualification-electron'}));
 builder.onLoad({filter:/.*/,namespace:'qualification-electron'},()=>({loader:'js',contents:`
 import{createRequire}from'node:module';const e=createRequire(import.meta.url)('electron');
 export const {app,BrowserWindow,clipboard,ipcMain,net,protocol,shell}=e;
 export const dialog={...e.dialog,async showMessageBox(_window,options){if(!options.message||!options.buttons?.length)throw new Error('Unexpected approval');const response=globalThis.fixtureNextApproval??1;globalThis.fixtureNextApproval=undefined;globalThis.fixtureApprovals??=[];globalThis.fixtureApprovals.push({message:options.message,response});return{response,checkboxChecked:true};},async showOpenDialog(_window,options){if(!options.filters?.some(filter=>filter.extensions.includes('nodus')))throw new Error('Unexpected file selection');return{canceled:false,filePaths:[${JSON.stringify(recoveryArchive)}]};},async showSaveDialog(){throw new Error('Unexpected export');}};
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
async function closeTrial(value,crash=false){
 const trial=value.trialOpened;await wait(()=>fs.existsSync(path.join(trial,'qualification-note.json')),`Actual note was not saved: ${fs.existsSync(path.join(trial,'qualification-note-error.txt'))?fs.readFileSync(path.join(trial,'qualification-note-error.txt'),'utf8'):trial}`);
 const note=JSON.parse(fs.readFileSync(path.join(trial,'qualification-note.json'),'utf8'));assert.ok(note.id);assert.match(note.content,/New work saved/);
 if(crash){assert.equal(value.trialReady.root,trial);assert.ok(trial.startsWith(root+path.sep));process.kill(value.trialReady.pid,'SIGKILL');await wait(()=>{try{process.kill(value.trialReady.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},'Crashed fixture did not exit');}
 else{fs.writeFileSync(path.join(trial,'qualification-quit'),'user closed test');await wait(()=>fs.existsSync(path.join(trial,'qualification-closed')),'Nodus did not quit cooperatively');}
 // will-quit precedes process exit, particularly on Windows. Do not start a
 // restore while production's process check still correctly sees the fixture.
 await wait(async()=>!(await api('inspect')).inspection.findings.some(finding=>['CLOSE_NODUS_FIRST','PROCESS_CHECK_UNAVAILABLE'].includes(finding.code)),'The disposable Nodus processes did not finish shutting down');return trial;
}
try {
 await open();await button('Check my installation').click();await button('Create verified copy').click();await page.locator('.test-list .test-row').first().waitFor();
 const installationBefore=await inventory(runtime,undefined,undefined,{links:true});
 await app.evaluate(()=>{globalThis.fixtureNextApproval=0;});await button('Download and reinstall Nodus').click();
 await wait(()=>app.evaluate(()=>globalThis.fixtureApprovals?.some(value=>value.response===0)),'Installer cancellation was not acknowledged');
 assert.equal((await session()).installationAttempt,undefined);assert.equal((await session()).installationPrevious,undefined);await verifyInventory(runtime,installationBefore);

 await page.locator('.test-list').first().getByRole('button').click();await wait(async()=>!!(await session()).actions.find(action=>action.action==='fresh-profile'&&action.status!=='running'),'Fresh-profile check did not finish');assert.equal((await session()).actions.find(action=>action.action==='fresh-profile').status,'passed',JSON.stringify(await session()));await page.waitForFunction(()=>document.querySelector('.test-list')?.textContent?.includes('graphics'));
 await page.locator('.test-list').first().getByRole('button').click();await button('It works now').waitFor();assert.equal(await button('It works now').isDisabled(),true);
 await page.getByRole('button',{name:/^Open additional copy/}).last().click();await wait(async()=>!!(await session()).trialOpened,'Trial readiness never confirmed');
 let value=await session();const deadPid=value.trialReady.pid,trial=await closeTrial(value,true);
 await page.getByRole('button',{name:/^Open additional copy/}).last().click();await wait(async()=>{const next=await session();return next.trialOpened===trial&&next.trialReady?.pid!==deadPid;},'The crashed recovery workspace did not reopen');
 await wait(()=>fs.existsSync(path.join(trial,'qualification-note-reopened.json')),'The saved note did not survive the real application crash');
 assert.equal(JSON.parse(fs.readFileSync(path.join(trial,'qualification-note-reopened.json'),'utf8')).id,JSON.parse(fs.readFileSync(path.join(trial,'qualification-note.json'),'utf8')).id);
 assert.ok(fs.readdirSync(path.join(trial,'profile')).some(name=>name.startsWith('isolated-instance.lock.support-retained-')));
 await closeTrial(await session());await button('It works now').click();await button('Use this solution when opening Nodus').click();
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
 await button('Recover an earlier copy').click();
 await page.locator('input[type=password]').fill('Deliberately wrong synthetic password');await page.locator('form.recovery-password').getByRole('button').click();
 await wait(async()=>(await session()).actions.some(action=>action.action==='restore-copy'&&action.status==='failed'),'Wrong archive password was not rejected');
 const failedRoot=(await session()).recoveryAttempt;assert.ok(fs.existsSync(failedRoot));
 await page.locator('input[type=password]').fill('Support qualification synthetic password');await page.locator('form.recovery-password').getByRole('button').click();
 await wait(async()=>(await session()).actions.some(action=>action.action==='restore-copy'&&action.status==='passed'),'Archive was not restored into an additional profile');
 const restored=(await session()).recoveredProfiles.at(-1);assert.notEqual(restored,failedRoot);assert.ok(fs.existsSync(failedRoot));assert.ok(fs.existsSync(path.join(restored,'profile')));await verifyInventory(recoveryArchive,archiveInventory);
 assert.deepEqual(await Promise.all([profile,external,library].map(file=>inventory(file))),before);
 assert.equal(supportSourceDigest(repo),sourceSha256);
 fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}-${interfaceOnly?'development-interface':'end-to-end'}.json`),JSON.stringify({format:interfaceOnly?'nodus.support-development-interface-evidence/1':'nodus.support-e2e-evidence/1',processDiscoveryControlled:interfaceOnly,sourceSha256,platform:process.platform,arch:process.arch,productionMain:true,productionPreload:true,productionRenderer:true,realNodusRuntime:true,testOnlyCatalog:true,guided:true,automatic:true,trialReadiness:true,actualNoteSaved:true,actualApplicationCrashRecovered:true,staleLockRetained:true,policyApplied:true,divergentWorkPreserved:true,rollback:true,assistantRestart:true,negativeAnswer:true,installerCancelledBeforeDownload:true,wrongPasswordRejected:true,failedRestoreRetained:true,additionalArchiveRestored:true,archiveUnchanged:true,reviewedReport:true,originalsUnchanged:true},null,2));
 console.log('Actual Support main/preload/UI + actual Nodus: guided and automatic trial, saved note, policy, divergent work, undo, restart and report passed.');
}catch(error){try{const failure=await session();fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}-e2e-session.json`),JSON.stringify(failure,null,2));for(const test of fs.readdirSync(path.join(failure.folder,'tests'))){const folder=path.join(failure.folder,'tests',test);for(const name of fs.readdirSync(folder))if(/^probe-private-.*\.log$/.test(name)||/^probe-result-.*\.json$/.test(name))fs.copyFileSync(path.join(folder,name),path.join(output,`${process.platform}-${process.arch}-e2e-${name}`));}}catch{/* Preserve the primary failure. */}await page?.screenshot({path:path.join(output,`${process.platform}-${process.arch}-e2e-failure.png`),fullPage:true}).catch(()=>{});throw error;}finally{await app?.close();}
