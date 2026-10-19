import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {inventory} from '../apps/nodus-support/core/files.mjs';
import {activateInstallation,recoverInstallation} from '../apps/nodus-support/core/install-transaction.mjs';
import {readInstalledPackage,executableArchitectures,verifyActivatedInstallation} from '../apps/nodus-support/core/installation.mjs';
import {retainSupportRuntime} from '../apps/nodus-support/core/self-runtime.mjs';
import {SupportService} from '../apps/nodus-support/core/service.mjs';
import {hashFile} from '../apps/nodus-support/core/files.mjs';

const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-installation-'))),require=createRequire(import.meta.url);
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
test('activated AppImages are checked against the signed bytes without expecting adjacent resources',async()=>{
  const original=path.join(scratch,'Nodus.AppImage');fs.writeFileSync(original,'verified image');
  const artifact={bytes:fs.statSync(original).size,sha256:await hashFile(original)};
  const input={format:'AppImage',original,artifact,version:'5.13.0',installation:async()=>{throw new Error('No adjacent resources exist for AppImages');}};
  await verifyActivatedInstallation(input);
  fs.writeFileSync(original,'tampered image');await assert.rejects(verifyActivatedInstallation(input),/INSTALLATION_INTEGRITY_FAILED/);
  assert.equal(fs.readFileSync(original,'utf8'),'tampered image','Failed verification preserves the suspect version');
});
test('a completed system installer still needs the expected installed protocol and version',async()=>{
  const original=path.join(scratch,'installed-program');fs.mkdirSync(original);
  for(const result of [{protocol:null,version:'5.13.0'},{protocol:1,version:'5.9.1'},null])await assert.rejects(verifyActivatedInstallation({format:'nsis',original,version:'5.13.0',installation:async()=>result}),/INSTALLATION_INTEGRITY_FAILED/);
  await verifyActivatedInstallation({format:'nsis',original,version:'5.13.0',installation:async()=>({protocol:1,version:'5.13.0'})});
});
for(const phase of ['prepared','original-retained','candidate-active','complete'])test(`installation interrupted at ${phase} retains old and candidate versions`,async()=>{
  const folder=path.join(scratch,phase);fs.mkdirSync(folder);
  const transaction={original:path.join(folder,'Nodus'),staged:path.join(folder,'staged'),retained:path.join(folder,'retained')};
  fs.writeFileSync(transaction.original,'original verified program');fs.writeFileSync(transaction.staged,'candidate verified program');
  transaction.previousInventory=await inventory(transaction.original);transaction.candidateInventory=await inventory(transaction.staged);
  const records=[];const record=async value=>records.push(value);
  await assert.rejects(activateInstallation(transaction,record,{transition:value=>{if(value===phase)throw new Error('power loss');}}),/power loss/);
  const recovered=await recoverInstallation(records.at(-1),record);
  assert.ok(['reverted','awaiting-user'].includes(recovered));
  const retainedFiles=[transaction.original,transaction.staged,transaction.retained].filter(file=>fs.existsSync(file));
  const values=retainedFiles.map(file=>fs.readFileSync(file,'utf8'));
  assert.ok(values.includes('original verified program'));assert.ok(values.includes('candidate verified program'));
});
test('installation recovery preserves an unexpected concurrent version',async()=>{
  const folder=path.join(scratch,'concurrent');fs.mkdirSync(folder);const original=path.join(folder,'app'),staged=path.join(folder,'candidate'),retained=path.join(folder,'retained');
  fs.writeFileSync(original,'old');fs.writeFileSync(staged,'new');const transaction={original,staged,retained,previousInventory:await inventory(original),candidateInventory:await inventory(staged)};
  await activateInstallation(transaction,async()=>{});fs.writeFileSync(original,'changed after activation');
  assert.equal(await recoverInstallation(transaction,async()=>{}),'conflict');assert.equal(fs.readFileSync(original,'utf8'),'changed after activation');assert.equal(fs.readFileSync(retained,'utf8'),'old');
});
test('legacy package version is read directly from an actual ASAR without launching it',async()=>{
  const folder=path.join(scratch,'package'),source=path.join(folder,'source'),resources=path.join(folder,'resources');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(resources);
  fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({name:'nodus',version:'5.9.1',main:'never-run.js'}));
  fs.writeFileSync(path.join(source,'never-run.js'),'throw new Error("must never execute")');
  await require('@electron/asar').createPackage(source,path.join(resources,'app.asar'));
  // asar's writer can resolve before its final stream flush under parallel test load.
  for(let i=0;i<50;i++) {try{readInstalledPackage(resources);break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  assert.equal(readInstalledPackage(resources).version,'5.9.1');
  const executable=path.join(folder,'nodus'),elf=Buffer.alloc(64);Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf);elf.writeUInt16LE(62,18);fs.writeFileSync(executable,elf);
  const service=new SupportService({profile:path.join(folder,'profile'),storage:path.join(folder,'support'),executable,platform:'linux',arch:'x64'});
  assert.equal((await service.installation()).protocol,null);
  fs.writeFileSync(path.join(resources,'nodus-support-protocol.json'),JSON.stringify({protocol:1,version:'5.9.1',platform:'linux',arch:'x64',archiveSha256:await hashFile(path.join(resources,'app.asar'))}));
  assert.equal((await service.installation()).protocol,1);
  fs.appendFileSync(path.join(resources,'app.asar'),'changed package');await assert.rejects(service.installation(),/INSTALLATION_INTEGRITY_FAILED/);
  const malformed=path.join(scratch,'malformed');fs.mkdirSync(malformed);const header=Buffer.alloc(16);header.writeUInt32LE(0xffffffff,4);fs.writeFileSync(path.join(malformed,'app.asar'),header);
  assert.throws(()=>readInstalledPackage(malformed),/INSTALLATION_UNAVAILABLE/);
});
test('the independent runtime reuses only verified copies and retains changed or interrupted ones',async()=>{
  const source=path.join(scratch,'helper'),storage=path.join(scratch,'runtimes');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'support'),'helper runtime');
  const first=await retainSupportRuntime(source,storage);assert.equal(await retainSupportRuntime(source,storage),first);assert.equal(fs.readdirSync(storage).length,1);
  fs.writeFileSync(path.join(first,'support'),'damaged retained runtime');
  const second=await retainSupportRuntime(source,storage);assert.notEqual(first,second);assert.equal(fs.readFileSync(path.join(first,'support'),'utf8'),'damaged retained runtime');assert.equal(fs.readFileSync(path.join(second,'support'),'utf8'),'helper runtime');
});
test('architecture checks read file headers without executing binaries',()=>{
  const elf=Buffer.alloc(64);Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf);elf.writeUInt16LE(62,18);const file=path.join(scratch,'elf');fs.writeFileSync(file,elf);assert.deepEqual(executableArchitectures(file),['x64']);
  const mac=Buffer.alloc(64);mac.writeUInt32LE(0xfeedfacf);mac.writeUInt32LE(0x100000c,4);fs.writeFileSync(file,mac);assert.deepEqual(executableArchitectures(file),['arm64']);
});
