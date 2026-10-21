import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupportService } from '../apps/nodus-support/core/service.mjs';
import { SolutionManager } from '../apps/nodus-support/core/solutions.mjs';
import { readPolicy,resolvePolicy } from '../apps/nodus-support/core/policies.mjs';
import { rememberSelection,selectCurrentProfile } from '../apps/nodus-support/core/selection.mjs';
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
test('new support sessions select the latest workspace, including after viewing old history and undoing a solution',async()=>{
  const f=await fixture('selection-context');rememberSelection(f.service);
  let first=await f.manager.apply(f.session.id,0);
  fs.writeFileSync(path.join(first.policyActiveRoot,'profile/latest.txt'),'recent work in active workspace');
  selectCurrentProfile(f.service,f.policies);
  assert.equal(f.service.selectedProfile,f.profile);assert.equal(f.service.profile,path.join(first.policyActiveRoot,'profile'));
  let second=await f.service.create({symptom:'startup',mode:'guided'});second=await f.service.protect(second.id);second=await f.service.test(second.id,'copy-profile');
  second=await f.service.event(second.id,{trialOpened:second.recoveredProfiles[0]});second=await f.service.answer(second.id,true);
  second=await f.manager.apply(second.id,0);
  // Viewing an older session changes its context, never the saved choice.
  f.service.profile=f.profile;f.service.executable='/historical-installation';
  selectCurrentProfile(f.service,f.policies);
  assert.equal(f.service.executable,f.service.selectedExecutable);
  assert.equal(f.service.profile,path.join(second.policyActiveRoot,'profile'));
  const latest=await f.service.create({symptom:'data',mode:'guided'});assert.equal(latest.inspection.profile,f.service.profile);
  assert.equal(fs.readFileSync(path.join(latest.inspection.profile,'latest.txt'),'utf8'),'recent work in active workspace');
  f.service.profile=second.inspection.profile;await f.manager.undo(second.id);
  selectCurrentProfile(f.service,f.policies);assert.equal(f.service.profile,path.join(first.policyActiveRoot,'profile'));
  f.service.profile=f.profile;first=await f.manager.undo(first.id,'use-previous');assert.equal(first.status,'reverted');
  selectCurrentProfile(f.service,f.policies);assert.equal(f.service.profile,f.profile);
});
test('changes to an original after activation block silent selection and require an explicit retained undo',async()=>{
  const f=await fixture('original-changed');rememberSelection(f.service);
  let session=await f.manager.apply(f.session.id,0);
  fs.writeFileSync(path.join(f.profile,'note.txt'),'newer work in the original');
  assert.throws(()=>resolvePolicy(f.policies,f.profile),/RECOVERY_SELECTION_CONFLICT/);
  selectCurrentProfile(f.service,f.policies);assert.equal(f.service.selectionError,true);
  // Explicitly resume the recorded source, as the native confirmation requires.
  f.service.profile=f.profile;f.service.selectionError=false;
  session=await f.manager.undo(session.id);assert.equal(session.status,'conflict');
  session=await f.manager.undo(session.id,'use-previous');assert.equal(session.status,'reverted');
  assert.equal(fs.readFileSync(path.join(f.profile,'note.txt'),'utf8'),'newer work in the original');
  assert.equal(fs.readFileSync(path.join(session.divergenceVerified,'profile/note.txt'),'utf8'),'original work');
  selectCurrentProfile(f.service,f.policies);assert.equal(f.service.selectionError,false);assert.equal(f.service.profile,f.profile);
});
test('undo asks before switching away from new work and verifies a separate recovery copy',async()=>{
  const f=await fixture('divergence'),before=await inventory(f.profile);
  let state=await f.manager.apply(f.session.id,0);const recovered=state.policyActiveRoot;
  assert.equal((await f.service.cancel(state.id)).status,'confirmed');
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
test('legacy diagnostics run only the separate verified copy and never select it for an incompatible installation',async()=>{
  const folder=path.join(scratch,'legacy-runtime'),profile=path.join(folder,'profile'),original=path.join(folder,'old-nodus');fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(original,'old application');fs.writeFileSync(path.join(profile,'notes'),'recent user work');
  const invoked=[];
  const service=new SupportService({profile,storage:path.join(folder,'support'),executable:original,isRunning:async()=>false,probe:async input=>{invoked.push(input.executable);return {protocol:1,root:input.root,ok:true};}});
  service.installation=async(executable=original)=>({version:executable===original?'5.9.1':'5.13.0',protocol:executable===original?null:1});
  let session=await service.create({symptom:'startup',mode:'guided'});session=await service.protect(session.id);
  const runtimeFolder=path.join(session.folder,'runtimes','separate'),candidate=path.join(runtimeFolder,'candidate'),executable=path.join(candidate,'nodus');fs.mkdirSync(candidate,{recursive:true});fs.writeFileSync(executable,'verified test application');
  session=await service.event(session.id,{diagnosticRuntime:{folder:runtimeFolder,candidate,executable,version:'5.13.0',inventory:await inventory(candidate)}});
  session=await service.test(session.id,'copy-profile');assert.equal(session.status,'awaiting-user');assert.deepEqual(invoked,[executable]);
  session=await service.event(session.id,{trialOpened:session.recoveredProfiles[0]});session=await service.answer(session.id,true);
  await assert.rejects(new SolutionManager(service,path.join(folder,'policies')).apply(session.id,0),/COMPATIBLE_INSTALL_REQUIRED/);
  fs.writeFileSync(executable,'damaged candidate');await assert.rejects(service.runtimeFor(session),/COPY_NOT_VERIFIED/);
  assert.equal(fs.readFileSync(original,'utf8'),'old application');assert.equal(fs.readFileSync(path.join(profile,'notes'),'utf8'),'recent user work');
});
