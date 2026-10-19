import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { SupportService,detectSources } from '../apps/nodus-support/core/service.mjs';
import { inventory,copyInventory,readJson } from '../apps/nodus-support/core/files.mjs';
import { runProbe } from '../apps/nodus-support/core/probe.mjs';
import { supportSourceDigest } from './lib/supportEvidence.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),electron=require('electron');
const sourceSha256=supportSourceDigest(repo);
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-data-'))),profile=path.join(root,'original');
execFileSync(electron,[path.join(repo,'scripts/support-native-fixture.mjs'),root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
const sources=detectSources(profile).roots,before=await Promise.all(sources.map(source=>inventory(source)));
const service=new SupportService({profile,storage:path.join(root,'support'),executable:electron,isRunning:async()=>false,probe:input=>runProbe({...input,args:[repo]})});
service.installation=async()=>({protocol:1,version:'5.13.0',platform:process.platform,arch:process.arch});
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
const env={...process.env,NODUS_ISOLATED_ROOT:copy.root,NODUS_SUPPORT_INTERACTIVE:'1',NODUS_QA_DEFER_CREDENTIAL_STATUS:'1',NODUS_STELLAR_PREVIEW:'1',NODUS_HARNESS_KEYS_FILE:path.join(copy.root,'no-keys.json')};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[repo],env,timeout:60000});
try {
  const page=await app.firstWindow();await page.waitForFunction(()=>document.body?.innerText.trim().length>0,{},{timeout:60000});
  const vaults=await page.evaluate(()=>window.nodus.listVaults());assert.ok(vaults.every(v=>v.path.startsWith(copy.profile+path.sep)));
  const result=await app.evaluate(async()=>{try{await fetch('https://example.org');return 'unexpected';}catch(error){return error.code;}});assert.equal(result,'SUPPORT_NETWORK_DENIED');
  const file=path.join(copy.profile,'trial-notes.txt');fs.writeFileSync(file,'new work entered in trial');
}finally{await app.close();}
assert.deepEqual(await Promise.all(sources.map(source=>inventory(source))),before);
assert.equal(fs.readFileSync(path.join(copy.profile,'trial-notes.txt'),'utf8'),'new work entered in trial');
// Retain a corrupt original while probing a separate copy.
const corrupt=path.join(root,'corrupt');await copyInventory(profile,corrupt,await inventory(profile));fs.writeFileSync(path.join(corrupt,'nodus.sqlite'),'corrupt preserved database');
const corruptBefore=await inventory(corrupt),corruptService=new SupportService({profile:corrupt,storage:path.join(root,'corrupt-support'),executable:electron,isRunning:async()=>false,probe:input=>runProbe({...input,args:[repo]})});
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
fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}.json`),JSON.stringify({format:'nodus.support-native-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,checked,fullApplication:true,originalsUnchanged:true,trialEditsRetained:true,walRowsVerified:true,corruptOriginalRetained:true,partialRecovery:true,independentArchiveRestore:true,wrongPasswordRejected:true},null,2));
console.log('Native Support data diagnostics, repair copies, WAL, sample archive roundtrip and full application isolation passed.');
