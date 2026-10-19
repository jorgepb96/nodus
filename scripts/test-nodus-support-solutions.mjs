import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupportService } from '../apps/nodus-support/core/service.mjs';
import { SolutionManager } from '../apps/nodus-support/core/solutions.mjs';
import { readPolicy,resolvePolicy } from '../apps/nodus-support/core/policies.mjs';
import { inventory } from '../apps/nodus-support/core/files.mjs';
import { createSupportKey } from './support-keygen.mjs';

const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-solutions-')));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
async function fixture(name) {
  const folder=path.join(scratch,name),profile=path.join(folder,'original'),policies=path.join(folder,'policies');
  fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'note.txt'),'original work');
  const service=new SupportService({profile,storage:path.join(folder,'support'),isRunning:async()=>false,probe:async({root})=>({protocol:1,root,ok:true})});
  service.installation=async()=>({protocol:1});
  let session=await service.create({symptom:'startup',mode:'guided'});session=await service.protect(session.id);session=await service.test(session.id,'copy-profile');
  session=await service.event(session.id,{trialOpened:session.recoveredProfiles[0]});session=await service.answer(session.id,true);
  return {folder,profile,policies,service,session,manager:new SolutionManager(service,policies)};
}
test('undo asks before switching away from new work and verifies a separate recovery copy',async()=>{
  const f=await fixture('divergence'),before=await inventory(f.profile);
  let state=await f.manager.apply(f.session.id,0);const recovered=state.policyActiveRoot;
  fs.writeFileSync(path.join(recovered,'profile/note.txt'),'recent unsaved-to-original work');
  state=await f.manager.undo(state.id);assert.equal(state.status,'conflict');assert.equal(readPolicy(f.policies,f.profile).recoveredRoot,recovered);
  state=await f.manager.undo(state.id,'keep-current');assert.equal(state.status,'confirmed');
  state=await f.manager.undo(state.id,'use-previous');assert.equal(state.status,'reverted');assert.equal(readPolicy(f.policies,f.profile).recoveredRoot,null);
  assert.equal(fs.readFileSync(path.join(state.divergenceVerified,'profile/note.txt'),'utf8'),'recent unsaved-to-original work');
  assert.equal(fs.readFileSync(path.join(recovered,'profile/note.txt'),'utf8'),'recent unsaved-to-original work');
  assert.deepEqual(await inventory(f.profile),before);
});
for(const phase of ['policy-prepared','policy-written','undo-prepared','undo-written'])test(`interruption at ${phase} retains all data and reconciles the committed choice`,async()=>{
  const f=await fixture(phase),before=await inventory(f.profile);
  const manager=new SolutionManager(f.service,f.policies,{transition:point=>{if(point===phase)throw new Error('simulated power loss');}});
  if(phase.startsWith('policy'))await assert.rejects(manager.apply(f.session.id,0),/simulated power loss/);
  else {await manager.apply(f.session.id,0);await assert.rejects(manager.undo(f.session.id),/simulated power loss/);}
  const state=await f.manager.recover(f.session.id),policy=readPolicy(f.policies,f.profile);
  if(phase==='policy-written')assert.equal(state.policyApplied,policy.id);
  if(phase==='policy-prepared')assert.equal(policy,null);
  if(phase==='undo-written'){assert.equal(state.policyApplied,null);assert.equal(state.status,'reverted');}
  if(phase==='undo-prepared')assert.equal(policy.id,state.policyApplied);
  assert.deepEqual(await inventory(f.profile),before);
  assert.equal(fs.readFileSync(path.join(f.session.recoveredProfiles[0],'profile/note.txt'),'utf8'),'original work');
});
test('applying a recovered profile refuses a newly changed original',async()=>{
  const f=await fixture('new-original');fs.writeFileSync(path.join(f.profile,'new.txt'),'new original work');
  await assert.rejects(f.manager.apply(f.session.id,0),/COPY_NOT_VERIFIED/);assert.equal(readPolicy(f.policies,f.profile),null);
});
test('successive recovery workspaces keep the latest work selected and require reverse-order undo',async()=>{
  const f=await fixture('successive');let first=await f.manager.apply(f.session.id,0);const active=path.join(first.policyActiveRoot,'profile');
  fs.writeFileSync(path.join(active,'recent.txt'),'work in first recovery');
  const service=new SupportService({profile:active,storage:path.join(f.folder,'next-support'),isRunning:async()=>false,probe:async({root})=>({protocol:1,root,ok:true})});service.installation=async()=>({protocol:1});
  let second=await service.create({symptom:'startup',mode:'guided'});second=await service.protect(second.id);second=await service.test(second.id,'copy-profile');second=await service.event(second.id,{trialOpened:second.recoveredProfiles[0]});second=await service.answer(second.id,true);
  const manager=new SolutionManager(service,f.policies);second=await manager.apply(second.id,0);
  assert.equal(resolvePolicy(f.policies,f.profile).recoveredRoot,second.policyActiveRoot);
  assert.equal(fs.readFileSync(path.join(second.policyActiveRoot,'profile/recent.txt'),'utf8'),'work in first recovery');
  await assert.rejects(f.manager.undo(first.id),/RECOVERY_SELECTION_CONFLICT/);
  await manager.undo(second.id);assert.equal(resolvePolicy(f.policies,f.profile).recoveredRoot,first.policyActiveRoot);
  first=await f.manager.undo(first.id);assert.equal(first.status,'conflict');
});
test('manifest keys stay private, separate from code signing and outside repositories',()=>{
  const repo=path.resolve(import.meta.dirname,'..');
  assert.throws(()=>createSupportKey('test-key',repo,repo),/outside the repository/);
  const key=createSupportKey('test-key',path.join(scratch,'keys'),repo);
  assert.equal(JSON.parse(fs.readFileSync(key.publicFile,'utf8')).keyId,'test-key');
  if(process.platform!=='win32')assert.equal(fs.statSync(key.privateFile).mode&0o777,0o600);
  assert.throws(()=>createSupportKey('test-key',path.join(scratch,'keys'),repo),/EEXIST/);
});
