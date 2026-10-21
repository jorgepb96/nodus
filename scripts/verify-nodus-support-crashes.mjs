// Crash the actual transaction process. All files belong to newly created fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventory,verifyInventory,writeNew,writeRecord,readJson} from '../apps/nodus-support/core/files.mjs';
import {SupportService} from '../apps/nodus-support/core/service.mjs';
import {SolutionManager} from '../apps/nodus-support/core/solutions.mjs';
import {activateInstallation,recoverInstallation} from '../apps/nodus-support/core/install-transaction.mjs';
import {readPolicy} from '../apps/nodus-support/core/policies.mjs';
import {supportSourceDigest} from './lib/supportEvidence.mjs';

const script=fileURLToPath(import.meta.url),repo=path.resolve(import.meta.dirname,'..');
function serviceAt(folder) {
  const service=new SupportService({profile:path.join(folder,'original'),storage:path.join(folder,'support'),isRunning:async()=>false,
    probe:async({root})=>({protocol:1,root,ok:true})});
  service.installation=async()=>({protocol:1,version:'5.13.0'});return service;
}
async function worker(folder,kind,point) {
  const profile=path.join(folder,'original');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'note.txt'),'only original version');
  await writeNew(path.join(folder,'baseline.json'),await inventory(profile));
  const pause=async phase=>{
    if(phase!==point)return;
    await writeRecord(path.join(folder,'reached.json'),{phase,pid:process.pid});
    await new Promise(()=>{setInterval(()=>{},1000);});
  };
  if(kind==='installation') {
    const original=path.join(folder,'Nodus'),staged=path.join(folder,'candidate'),retained=path.join(folder,'previous');
    fs.mkdirSync(original);fs.mkdirSync(staged);
    fs.writeFileSync(path.join(original,'program'),'previous verified program');fs.writeFileSync(path.join(staged,'program'),'candidate verified program');
    const transaction={original,staged,retained,previousInventory:await inventory(original),candidateInventory:await inventory(staged)};
    let sequence=0;
    await activateInstallation(transaction,async value=>{await writeRecord(path.join(folder,'records',`${String(++sequence).padStart(8,'0')}.json`),value);await pause(value.phase);},{transition:pause});
  } else {
    const service=serviceAt(folder),policies=path.join(folder,'policies');
    let session=await service.create({symptom:'startup',mode:'guided'});session=await service.protect(session.id);
    assert.equal(session.status,'protected');session=await service.test(session.id,'copy-profile');
    session=await service.event(session.id,{trialOpened:session.recoveredProfiles[0]});session=await service.answer(session.id,true);
    await writeNew(path.join(folder,'session-id.json'),{id:session.id});
    const manager=new SolutionManager(service,policies,{transition:pause});
    await manager.apply(session.id,0);
    if(point.startsWith('undo'))await manager.undo(session.id);
  }
  throw new Error(`Crash point was not reached: ${kind}/${point}`);
}

if(process.argv[2]==='--worker') {
  await worker(process.argv[3],process.argv[4],process.argv[5]);
} else {
  const sourceSha256=supportSourceDigest(repo),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-crashes-'))),checked=[];
  for(const [kind,points]of [
    ['installation',['prepared','retaining-original','original-retained','activating-candidate','candidate-active','complete']],
    ['policy',['policy-prepared','policy-written','undo-prepared','undo-written']],
  ])for(const point of points) {
    const folder=path.join(root,`${kind}-${point}`);fs.mkdirSync(folder);
    const child=spawn(process.execPath,[script,'--worker',folder,kind,point],{stdio:['ignore','ignore','pipe']});
    let stderr='',spawnError;child.stderr.on('data',value=>{stderr=(stderr+value).slice(-6000);});child.on('error',error=>{spawnError=error;});
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal}))),deadline=Date.now()+60000;
    try {
      while(!fs.existsSync(path.join(folder,'reached.json'))) {
        if(spawnError)throw spawnError;
        assert.equal(child.exitCode,null,`${kind}/${point} exited before the crash: ${stderr}`);assert.equal(child.signalCode,null);
        assert.ok(Date.now()<deadline,`${kind}/${point} did not reach the crash point: ${stderr}`);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(readJson(path.join(folder,'reached.json')).pid,child.pid);
      child.kill('SIGKILL');await closed;
      await verifyInventory(path.join(folder,'original'),readJson(path.join(folder,'baseline.json')));
      if(kind==='installation') {
        const records=fs.readdirSync(path.join(folder,'records')).filter(name=>/^\d{8}\.json$/.test(name)).sort();
        let current=readJson(path.join(folder,'records',records.at(-1))),sequence=0;
        const status=await recoverInstallation(current,async value=>{current=value;await writeRecord(path.join(folder,'recovery',`${++sequence}.json`),value);});
        assert.ok(['reverted','awaiting-user'].includes(status));
        const bytes=[current.original,current.staged,current.retained].filter(file=>fs.existsSync(file)).map(file=>fs.readFileSync(path.join(file,'program'),'utf8'));
        assert.ok(bytes.includes('previous verified program'),`${point} lost the original program`);
        assert.ok(bytes.includes('candidate verified program'),`${point} lost the candidate program`);
      } else {
        const service=serviceAt(folder),{id}=readJson(path.join(folder,'session-id.json')),policies=path.join(folder,'policies'),manager=new SolutionManager(service,policies);
        let session=await manager.recover(id);const policy=readPolicy(policies,service.profile);
        if(point==='policy-prepared')assert.equal(policy,null);
        if(point==='policy-written') {
          assert.equal(session.policyApplied,policy.id);
          const recent=path.join(session.policyActiveRoot,'profile/recent.txt');fs.writeFileSync(recent,'new work after restarting Support');
          session=await manager.undo(id);assert.equal(session.status,'conflict');
          session=await manager.undo(id,'use-previous');assert.equal(session.status,'reverted');
          assert.equal(fs.readFileSync(recent,'utf8'),'new work after restarting Support');
          assert.equal(fs.readFileSync(path.join(session.divergenceVerified,'profile/recent.txt'),'utf8'),'new work after restarting Support');
        }
        if(point==='undo-prepared')assert.equal(session.policyApplied,policy.id);
        if(point==='undo-written'){assert.equal(session.policyApplied,null);assert.equal(session.status,'reverted');}
      }
      await verifyInventory(path.join(folder,'original'),readJson(path.join(folder,'baseline.json')));
      checked.push(`${kind}/${point}`);console.log(`Actual process kill + durable recovery passed: ${kind}/${point}.`);
    } finally {if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
  }
  assert.equal(supportSourceDigest(repo),sourceSha256,'Sources changed during qualification.');
  const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});
  await writeNew(path.join(output,`${process.platform}-${process.arch}-crashes-${Date.now()}.json`),{format:'nodus.support-crash-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,actualProcessTermination:true,originalsUnchanged:true,previousAndCandidateRetained:true,recentEditsPreserved:true,checked});
}
