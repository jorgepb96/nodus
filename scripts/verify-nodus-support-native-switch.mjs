// Actual native payloads through the production switch/recovery functions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {_electron} from 'playwright-core';
import {inventory,copyInventory,verifyInventory,writeRecord} from '../apps/nodus-support/core/files.mjs';
import {activateInstallation,recoverInstallation} from '../apps/nodus-support/core/install-transaction.mjs';
import {preserveInstallation} from '../apps/nodus-support/core/releases.mjs';
import {supportSourceDigest} from './lib/supportEvidence.mjs';
assert.equal(process.env.CI,'true','Disposable native CI only');assert.ok(['darwin','linux'].includes(process.platform));
const repo=path.resolve(import.meta.dirname,'..'),sourceSha256=supportSourceDigest(repo),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-native-switch-'))),mac=process.platform==='darwin';
const payload=mac?path.join(repo,'release-support',process.arch==='arm64'?'mac-arm64':'mac','nodus-support.app'):path.join(repo,'release-support/Nodus-Support-x86_64.AppImage');
assert.ok(fs.existsSync(payload),`Native installer was not built at ${payload}`);
const signature=file=>{if(mac&&process.env.NODUS_REQUIRE_MACOS_SIGNING==='true'){execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',file],{stdio:'pipe'});if(process.env.NODUS_REQUIRE_MACOS_SIGNING==='true')execFileSync('/usr/sbin/spctl',['--assess','--type','execute',file],{stdio:'pipe'});}};
signature(payload);
const manifest=await inventory(payload,undefined,undefined,{links:mac}),original=path.join(root,mac?'Installed Support.app':'InstalledSupport.AppImage'),staged=path.join(root,mac?'Candidate Support.app':'CandidateSupport.AppImage'),retained=path.join(root,mac?'Previous Support.app':'PreviousSupport.AppImage');
await copyInventory(payload,original,manifest);await copyInventory(payload,staged,manifest);await verifyInventory(original,manifest);await verifyInventory(staged,manifest);
const protection=path.join(root,'protection');fs.mkdirSync(protection);const previous=await preserveInstallation(original,protection);
const profile=path.join(root,'profile');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'private-note.txt'),'Synthetic original work');const before=await inventory(profile);
const transaction={original,staged,retained,previousInventory:manifest,candidateInventory:manifest},journal=path.join(root,'journal');fs.mkdirSync(journal);let sequence=0;const record=value=>writeRecord(path.join(journal,`${String(sequence++).padStart(6,'0')}.json`),value);
await assert.rejects(activateInstallation(transaction,record,{transition:phase=>{if(phase==='original-retained')throw Object.assign(new Error('Simulated activation permission refusal'),{code:'EACCES'});}}),error=>error.code==='EACCES');
assert.equal(await recoverInstallation(transaction,record),'reverted');await verifyInventory(original,manifest);await verifyInventory(staged,manifest);await verifyInventory(previous,manifest);
await activateInstallation(transaction,record);signature(original);signature(retained);
const executable=mac?path.join(original,'Contents/MacOS/nodus-support'):original,env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
if(!mac){env.APPIMAGE_EXTRACT_AND_RUN='1';env.CHROME_DEVEL_SANDBOX=path.join(repo,'node_modules/electron/dist/chrome-sandbox');}
const app=await _electron.launch({executablePath:executable,args:['--support-retained=1',`--support-state=${path.join(root,'state')}`,`--nodus-profile=${profile}`,`--nodus-executable=${path.join(root,'missing-nodus')}`],env,timeout:90000,chromiumSandbox:true});
try{const page=await app.firstWindow();await page.locator('h1').waitFor();const result=await page.evaluate(()=>window.nodusSupport.inspect());assert.equal(result.inspection.profile,profile);}finally{await app.close();}
// Roll back with the same immutable payload and retain the active version too.
const rollback={original,staged:retained,retained:path.join(root,mac?'Retained candidate.app':'RetainedCandidate.AppImage'),previousInventory:manifest,candidateInventory:manifest};
await activateInstallation(rollback,record);signature(original);await verifyInventory(original,manifest);await verifyInventory(rollback.retained,manifest);await verifyInventory(previous,manifest);await verifyInventory(profile,before);
const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,`${process.platform}-${process.arch}-native-switch.json`),JSON.stringify({format:'nodus.support-native-switch-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,artifact:mac?'app':'AppImage',nativePayload:true,productionSwitch:true,failedActivationRecovered:true,realCandidateLaunched:true,rollback:true,previousRetained:true,candidateRetained:true,originalProfileUnchanged:true,platformSignatureChecked:mac&&process.env.NODUS_REQUIRE_MACOS_SIGNING==='true',notarizationChecked:mac&&process.env.NODUS_REQUIRE_MACOS_SIGNING==='true'},null,2));
console.log('Native payload activation, failed switch recovery, real candidate launch and retained rollback passed.');
