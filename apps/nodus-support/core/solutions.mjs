import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert,inventory,verifyInventory,copyInventory,sufficientSpace,writeRecord,readJson } from './files.mjs';
import { readPolicy,resolvePolicy,writePolicy } from './policies.mjs';

export class SolutionManager {
  constructor(service,policies,{transition=()=>{}}={}) {this.service=service;this.policies=policies;this.transition=transition;}
  async apply(id,index) {
    return this.service.exclusive(async()=>{
      const session=await this.service.session(id);assert(session.status==='confirmed','USER_CONFIRMATION_REQUIRED');assert(!session.policyApplied,'INVALID_STATE');
      await this.service.guardSource(session);const sources=await this.service.protectedSources(session);
      assert(Number.isInteger(index)&&index>=0&&session.trialOpened===session.recoveredProfiles[index],'USER_TRIAL_REQUIRED');
      const root=session.recoveredProfiles[index],result=readJson(path.join(root,'result.json'));
      assert(result.ok===true&&result.protocol===1&&result.root===root&&!result.diagnostic&&!result.partial,'PROBE_INVALID');
      assert(result.action!=='fresh-profile','DIAGNOSTIC_PROFILE_ONLY');
      for(const source of sources)await verifyInventory(source.original,source.inventory);
      const previous=readPolicy(this.policies,this.service.profile);
      // Never switch away from an already selected recovery workspace as a side effect.
      assert(!previous?.recoveredRoot||previous.recoveredRoot===root,'RECOVERY_SELECTION_CONFLICT');
      // Keep the profile the user actually tested visible, including work entered there.
      const changes={softwareGraphics:result.action==='software-graphics'||previous?.softwareGraphics===true,recoveredRoot:root};
      const active=await inventory(path.join(root,'profile')),pendingId=randomUUID();
      await this.service.event(id,{policyPrevious:previous,policyPrepared:changes,policyPendingId:pendingId,policyActiveInventory:active,policyActiveRoot:changes.recoveredRoot});
      await this.transition('policy-prepared');
      const policy=await writePolicy(this.policies,this.service.profile,changes,previous?.id??null,pendingId);
      await this.transition('policy-written');
      return this.service.event(id,{policyApplied:policy.id,actions:[...session.actions,{id:policy.id,action:'apply-solution',status:'passed',at:policy.at}]});
    });
  }
  async undo(id,choice='check') {
    assert(['check','keep-current','use-previous'].includes(choice),'INVALID_REQUEST');
    return this.service.exclusive(async()=>{
      const session=await this.service.session(id);await this.service.guardSource(session);await this.service.protectedSources(session);
      assert(session.policyApplied,'NO_POLICY_APPLIED');
      const policy=readPolicy(this.policies,this.service.profile);assert(policy?.id===session.policyApplied,'CONCURRENT_CHANGE');
      assert(resolvePolicy(this.policies,this.service.profile)?.recoveredRoot===session.policyActiveRoot,'RECOVERY_SELECTION_CONFLICT');
      if(choice==='keep-current')return this.service.event(id,{status:'confirmed',conflict:null});
      let changed=false;
      if(session.policyActiveRoot)try{await verifyInventory(path.join(session.policyActiveRoot,'profile'),session.policyActiveInventory);}catch{changed=true;}
      if(changed&&choice==='check')return this.service.event(id,{status:'conflict',conflict:{current:session.policyActiveRoot,previous:session.policyPrevious?.recoveredRoot??this.service.profile}});
      if(changed) {
        const source=path.join(session.policyActiveRoot,'profile'),manifest=await inventory(source),folder=path.join(session.folder,'preserved-edits',randomUUID());
        await sufficientSpace(session.folder,manifest.bytes);await fsp.mkdir(folder,{recursive:true,mode:0o700});
        await this.service.event(id,{divergencePrepared:folder});await copyInventory(source,path.join(folder,'profile'),manifest);await verifyInventory(path.join(folder,'profile'),manifest);
        await writeRecord(path.join(folder,'manifest.json'),{format:'nodus.support-preserved-edits/1',source,inventory:manifest});
        await this.service.event(id,{divergenceVerified:folder});
      }
      const previous=session.policyPrevious??{softwareGraphics:false,recoveredRoot:null},pendingId=randomUUID();
      await this.service.event(id,{undoPendingId:pendingId});await this.transition('undo-prepared');
      await writePolicy(this.policies,this.service.profile,{softwareGraphics:previous.softwareGraphics,recoveredRoot:previous.recoveredRoot},session.policyApplied,pendingId);
      await this.transition('undo-written');
      return this.service.event(id,{status:'reverted',policyApplied:null,conflict:null,actions:[...session.actions,{id:pendingId,action:'undo-solution',status:'reverted',at:new Date().toISOString()}]});
    });
  }
  async recover(id) {
    return this.service.exclusive(async()=>{
      const session=await this.service.session(id);const current=readPolicy(this.policies,this.service.profile);
      if(session.undoPendingId&&current?.id===session.undoPendingId)return this.service.event(id,{status:'reverted',policyApplied:null,conflict:null,actions:session.actions.some(a=>a.id===current.id)?session.actions:[...session.actions,{id:current.id,action:'undo-solution',status:'reverted',at:current.at}]});
      if(session.policyPendingId&&!session.policyApplied&&current?.id===session.policyPendingId)return this.service.event(id,{status:'confirmed',policyApplied:current.id,actions:session.actions.some(a=>a.id===current.id)?session.actions:[...session.actions,{id:current.id,action:'apply-solution',status:'passed',at:current.at}]});
      return session;
    });
  }
}
