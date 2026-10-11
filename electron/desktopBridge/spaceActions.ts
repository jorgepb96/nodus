import {createHash} from 'node:crypto';
import type {BridgeJob} from './jobs';
import {executeCompanionSpaceAction} from '../serverSync/spaceActionProcessor';
import {withOwningVault} from '../vaults/vaultRegistry';
import {withVaultDatabase} from '../db/database';
import {withMobileOperation} from './executionBoundary';
import {withGenerationSignal} from '../ai/generationSignal';
import {invalidateLiveCorpus,liveCorpusRevision} from './liveCorpus';

export const COMPANION_CONTENT_ACTIONS=new Set(['idea.delete','idea.saveToNotes','deepResearch.saveToNotes','hypothesis.saveToNotes','projects.create','projects.update','projects.section.update','projects.chapter.import','worldbuilding.entityDelete','pages.restoreRevision','databases.importCSV']);
export const COMPANION_RESEARCH_ACTIONS=new Set(['author.synthesis.generate','authors.matrix.generate','argumentMap.generate','writing.generate','worldbuilding.continuity','worldbuilding.proseReview']);
export type CompanionSpaceAction={kind:string;schemaVersion:1;payload:Record<string,unknown>;idempotencyKey:string;inputRevision:string|null;inputFingerprint:string|null;executionMode?:string};
export function validateCompanionSpaceAction(raw:unknown,domains:readonly string[]):CompanionSpaceAction {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Buffer.byteLength(JSON.stringify(raw),'utf8')>2*1024*1024)throw new Error('invalid_space_action');
  const value=raw as CompanionSpaceAction;
  if(Object.keys(raw).some(key=>!['kind','schemaVersion','payload','idempotencyKey','inputRevision','inputFingerprint','executionMode'].includes(key))||value.schemaVersion!==1||typeof value.kind!=='string'||!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload)||typeof value.idempotencyKey!=='string'||!value.idempotencyKey||value.idempotencyKey.length>4096)throw new Error('invalid_space_action');
  if(!COMPANION_CONTENT_ACTIONS.has(value.kind)&&!COMPANION_RESEARCH_ACTIONS.has(value.kind))throw new Error('desktop_only_action');
  if(!domains.includes('corpus')||!domains.includes('writing'))throw new Error('permission_denied');
  if(COMPANION_RESEARCH_ACTIONS.has(value.kind)){
    if(!domains.includes('research-generation'))throw new Error('permission_denied');
    if(value.executionMode!=='live')throw new Error('explicit_live_mode_required');
  }
  for(const field of ['inputRevision','inputFingerprint'] as const)if(value[field]!=null&&(typeof value[field]!=='string'||value[field]!.length>4096))throw new Error('invalid_space_action_source');
  return value;
}
export function companionActionKey(key:string){return createHash('sha256').update(`companion-action:${key}`).digest('hex');}
export function companionActionResponse(job:BridgeJob){
  const action=job.args[0] as CompanionSpaceAction;
  return {id:job.id,sequence:job.actionSequence??0,spaceId:job.vaultId,idempotencyKey:action.idempotencyKey,kind:action.kind,schemaVersion:1,payload:action.payload,actorUserId:job.deviceGrant,createdByDevice:job.deviceGrant,inputRevision:action.inputRevision??null,inputFingerprint:action.inputFingerprint??null,
    status:job.state==='available'?'applied':job.state==='accepted'?'queued':['running','saved'].includes(job.state)?'running':job.state==='cancelled'?'cancelled':'failed',claimedByDevice:null,result:job.result??null,errorCode:job.error??null,createdAt:job.createdAt,updatedAt:job.updatedAt,claimedAt:null,finishedAt:['available','failed','interrupted','cancelled'].includes(job.state)?job.updatedAt:null};
}
export async function runCompanionSpaceAction(vaultId:string,domains:readonly string[],raw:unknown,id:string,signal?:AbortSignal){
  const action=validateCompanionSpaceAction(raw,domains);
  signal?.throwIfAborted();
  const invoke=()=>{signal?.throwIfAborted();return withMobileOperation(()=>executeCompanionSpaceAction({...action,id,status:'running',inputRevision:action.inputRevision??null,inputFingerprint:action.inputFingerprint??null}),domains);};
  const result=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,async()=>{
    if(action.inputRevision&&action.inputRevision!==await liveCorpusRevision(vaultId))throw new Error('stale_input_revision');
    return signal?withGenerationSignal(signal,invoke):invoke();
  }));
  if(result.changedVault)invalidateLiveCorpus(vaultId);return result.result;
}
