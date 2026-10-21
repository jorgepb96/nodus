import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {waitForTrial} from '../apps/nodus-support/core/trial-ready.mjs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { SupportService,detectSources } from '../apps/nodus-support/core/service.mjs';
import { inventory,copyInventory,readJson } from '../apps/nodus-support/core/files.mjs';
import { runProbe } from '../apps/nodus-support/core/probe.mjs';
import { supportSourceDigest } from './lib/supportEvidence.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),electron=require('electron');
const sourceSha256=supportSourceDigest(repo),version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version;
const diagnostic=value=>console.error('Synthetic probe bootstrap diagnostic:',JSON.stringify(value));
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-data-'))),profile=path.join(root,'original');
execFileSync(electron,[path.join(repo,'scripts/support-native-fixture.mjs'),root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
const sources=detectSources(profile).roots,before=await Promise.all(sources.map(source=>inventory(source)));
const service=new SupportService({profile,storage:path.join(root,'support'),executable:electron,isRunning:async()=>false,probe:input=>runProbe({...input,args:[repo],diagnostic})});
service.installation=async()=>({protocol:1,version,platform:process.platform,arch:process.arch});
const checked=[];let roundtripArchive;
for(const action of ['configuration-check','database-check','model-check','repair-local-endpoints','pause-sync','disable-plugins','rebuild-library','recover-database','archive-roundtrip']) {
  let session=await service.create({symptom:'other',mode:'guided'});session=await service.protect(session.id);assert.equal(session.status,'protected');
  session=await service.test(session.id,action);
  const attempt=session.actions.find(entry=>entry.action===action);assert.equal(attempt?.status,'passed',`${action}: ${session.lastError??JSON.stringify(session.actions)}`);
  assert.deepEqual(await Promise.all(sources.map(source=>inventory(source))),before,`${action} changed source data`);
  if(action==='pause-sync'){const prefs=readJson(path.join(session.recoveredProfiles[0],'profile/app-prefs.json'));assert.equal(prefs.studySyncEnabled,false);}
  if(action==='archive-roundtrip') {
    const tests=path.join(session.folder,'tests');roundtripArchive=fs.readdirSync(tests).map(name=>path.join(tests,name,'synthetic-roundtrip.nodus')).find(file=>fs.existsSync(file));assert.ok(roundtripArchive);
  }
  console.log(`Native ${action} passed; source hashes unchanged.`);
  checked.push(action);
}
// The full, real application must also open its copied data, without external capabilities.
let session=await service.create({symptom:'startup',mode:'guided'});session=await service.protect(session.id);const copy=await service.workingCopy(session);
execFileSync(electron,[path.join(repo,'scripts/support-native-fixture.mjs'),copy.profile,'--check-wal'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
const token=randomUUID(),env={...process.env,NODUS_SUPPORT_TRIAL_TOKEN:token,NODUS_ISOLATED_ROOT:copy.root,NODUS_SUPPORT_INTERACTIVE:'1',NODUS_QA_DEFER_CREDENTIAL_STATUS:'1',NODUS_STELLAR_PREVIEW:'1',NODUS_HARNESS_KEYS_FILE:path.join(copy.root,'no-keys.json')};delete env.ELECTRON_RUN_AS_NODE;
let networkHits=0;const canary=http.createServer((_request,response)=>{networkHits++;response.end('isolated test canary');});await new Promise(resolve=>canary.listen(0,'127.0.0.1',resolve));
const canaryUrl=`http://127.0.0.1:${canary.address().port}/`,outside=path.join(root,'isolation-canary.txt');fs.writeFileSync(outside,'outside copy must remain intact');
const app=await _electron.launch({args:[repo],env,timeout:60000});
try {
  const page=await app.firstWindow();await page.waitForFunction(()=>document.body?.innerText.trim().length>0,{},{timeout:60000});
  const vaults=await page.evaluate(()=>window.nodus.listVaults());assert.ok(vaults.every(v=>v.path.startsWith(copy.profile+path.sep)));
  await waitForTrial({root:copy.root,token,version:JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version,pid:await app.evaluate(()=>process.pid)});
  const boundary=await app.evaluate(async(e,input)=>{
    const require=process.getBuiltinModule('module').createRequire(input.package),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
    const deny=(fn,code)=>assert.throws(fn,error=>error.code===code);
    deny(()=>fs.writeFileSync(input.outside,'would overwrite original'),'SUPPORT_WRITE_DENIED');
    deny(()=>fs.renameSync(input.outside,input.root+'/moved-original'),'SUPPORT_WRITE_DENIED');
    deny(()=>cp.execFileSync(process.execPath,['--version']),'SUPPORT_PROCESS_DENIED');
    deny(()=>process.kill(process.pid,'SIGTERM'),'SUPPORT_PROCESS_DENIED');
    deny(()=>new (require('node:worker_threads').Worker)('process.exit(0)',{eval:true}),'SUPPORT_PROCESS_DENIED');
    deny(()=>require('node:http').get(input.url),'SUPPORT_NETWORK_DENIED');
    deny(()=>require('node:net').connect(1234,'127.0.0.1'),'SUPPORT_NETWORK_DENIED');
    deny(()=>require('node:dns').lookup('localhost',()=>{}),'SUPPORT_NETWORK_DENIED');
    await assert.rejects(fetch(input.url),error=>error.code==='SUPPORT_NETWORK_DENIED');
    await assert.rejects(e.net.fetch(input.url),error=>error.code==='SUPPORT_EXTERNAL_ACTION_DENIED');
    deny(()=>e.safeStorage.decryptString(Buffer.from('synthetic')),'SUPPORT_EXTERNAL_ACTION_DENIED');
    const Database=require('better-sqlite3');deny(()=>new Database(input.outside),'SUPPORT_WRITE_DENIED');
    const db=new Database(input.root+'/native-boundary.sqlite');
    deny(()=>db.prepare('ATTACH DATABASE ? AS original').run(input.outside),'SUPPORT_WRITE_DENIED');
    await assert.rejects(db.backup(input.outside),error=>error.code==='SUPPORT_WRITE_DENIED');db.close();
    // Ordinary browser initialization must not replace the mandatory restrictions.
    const target=e.session.fromPartition('support-boundary-'+process.pid);
    target.webRequest.onBeforeRequest((_request,done)=>done({cancel:false}));
    target.setPermissionRequestHandler((_contents,_permission,done)=>done(true));target.setPermissionCheckHandler(()=>true);
    const window=new e.BrowserWindow({show:false,webPreferences:{partition:'support-boundary-'+process.pid,sandbox:true,contextIsolation:true}});
    try {
      await assert.rejects(window.loadURL(input.url));
      await window.loadURL('data:text/html,<html><body>Permission check</body></html>');
      assert.equal(await window.webContents.executeJavaScript('navigator.permissions.query({name:"geolocation"}).then(value=>value.state)'),'denied');
    }finally{window.destroy();}
    return true;
  },{package:path.join(repo,'package.json'),outside,root:copy.root,url:canaryUrl});assert.equal(boundary,true);
  await page.evaluate(async url=>{try{await fetch(url);}catch{/* The native session must block this too. */}},canaryUrl);
  assert.equal(networkHits,0);assert.equal(fs.readFileSync(outside,'utf8'),'outside copy must remain intact');
  const file=path.join(copy.profile,'trial-notes.txt');fs.writeFileSync(file,'new work entered in trial');
}finally{await app.close();await new Promise(resolve=>canary.close(resolve));}
assert.deepEqual(await Promise.all(sources.map(source=>inventory(source))),before);
assert.equal(fs.readFileSync(path.join(copy.profile,'trial-notes.txt'),'utf8'),'new work entered in trial');
// Retain a corrupt original while probing a separate copy.
const corrupt=path.join(root,'corrupt');await copyInventory(profile,corrupt,await inventory(profile));fs.writeFileSync(path.join(corrupt,'nodus.sqlite'),'corrupt preserved database');
const corruptBefore=await inventory(corrupt),corruptService=new SupportService({profile:corrupt,storage:path.join(root,'corrupt-support'),executable:electron,isRunning:async()=>false,probe:input=>runProbe({...input,args:[repo],diagnostic})});
corruptService.installation=service.installation;
let damaged=await corruptService.create({symptom:'data',mode:'guided'});damaged=await corruptService.protect(damaged.id);damaged=await corruptService.test(damaged.id,'database-check');
assert.equal(damaged.actions.at(-1).status,'failed');assert.match(damaged.actions.at(-1).code,/SQLITE_/);
damaged=await corruptService.test(damaged.id,'recover-database');assert.equal(damaged.actions.at(-1).status,'passed');assert.ok(damaged.findings.some(f=>f.code==='PARTIAL_RECOVERY'));
assert.deepEqual(await inventory(corrupt),corruptBefore);assert.deepEqual(await Promise.all(sources.map(source=>inventory(source))),before);
// A wrong password must fail on a separate, empty profile and preserve the encrypted archive.
const wrong=await service.workingCopy(session,true);fs.copyFileSync(roundtripArchive,path.join(wrong.root,'recovery.nodus'));
const archiveBefore=await inventory(roundtripArchive),failure=await runProbe({executable:electron,args:[repo],root:wrong.root,action:'restore-archive',password:'deliberately incorrect password'});
assert.equal(failure.ok,false);assert.deepEqual(await inventory(roundtripArchive),archiveBefore);
assert.deepEqual(await Promise.all(sources.map(source=>inventory(source))),before);
const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});
assert.equal(supportSourceDigest(repo),sourceSha256,'Source changed during native verification; repeat against the final source.');
fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}.json`),JSON.stringify({format:'nodus.support-native-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,checked,fullApplication:true,trialReadyVerified:true,nativeSqliteBoundary:true,externalProcessBoundary:true,immutableSessionRestrictions:true,networkCanaryHits:networkHits,originalsUnchanged:true,trialEditsRetained:true,walRowsVerified:true,corruptOriginalRetained:true,partialRecovery:true,independentArchiveRestore:true,wrongPasswordRejected:true},null,2));
console.log('Native Support data diagnostics, repair copies, WAL, sample archive roundtrip and full application isolation passed.');
