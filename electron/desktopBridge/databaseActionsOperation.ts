import {withOwningVault} from '../vaults/vaultRegistry';
import {withVaultDatabase} from '../db/database';
import {withMobileOperation} from './executionBoundary';
import {withGenerationSignal} from '../ai/generationSignal';
import {invalidateLiveCorpus} from './liveCorpus';
import {getMobileDatabaseActionSource,generateMobileDatabaseText,generateMobileDatabaseImage,saveMobileDatabaseGeneratedCell,runMobileDatabaseButton,recoverMobileDatabaseAction,saveMobileDatabaseButtonResult} from './MobileDatabaseActions';

export const MOBILE_DATABASE_ACTION_METHODS:ReadonlySet<string> = new Set(['getMobileDatabaseActionSource','generateMobileDatabaseText','generateMobileDatabaseImage','saveMobileDatabaseGeneratedCell','runMobileDatabaseButton','recoverMobileDatabaseAction','saveMobileDatabaseButtonResult']);
/** Closed dispatch; the grant and job identity always come from authorization. */
export async function executeMobileDatabaseAction(vaultId:string,domains:readonly string[],method:string,args:unknown[],identity?:{deviceGrant:string;idempotencyKey:string},signal?:AbortSignal,progress?:(phase:string)=>void):Promise<unknown> {
  if(!MOBILE_DATABASE_ACTION_METHODS.has(method)||args.length!==1||!domains.includes('corpus'))throw new Error('permission_denied');
  if(method!=='getMobileDatabaseActionSource'&&(!domains.includes('writing')||!identity))throw new Error('job_required');
  if(['generateMobileDatabaseText','generateMobileDatabaseImage'].includes(method)&&!domains.includes('research-generation'))throw new Error('permission_denied');
  if(['saveMobileDatabaseGeneratedCell','saveMobileDatabaseButtonResult'].includes(method)&&(args[0] as {requestId?:unknown}|null)?.requestId!==identity!.idempotencyKey)throw new Error('database_action_identity_conflict');
  const invoke=()=>withMobileOperation(async()=>{
    const phase=(value:string)=>progress?.(value);
    switch(method) {
      case 'getMobileDatabaseActionSource':return getMobileDatabaseActionSource(args[0]);
      case 'generateMobileDatabaseText':return generateMobileDatabaseText(args[0],identity!.idempotencyKey,identity!.deviceGrant,phase,signal,vaultId);
      case 'generateMobileDatabaseImage':return generateMobileDatabaseImage(args[0],identity!.idempotencyKey,identity!.deviceGrant,phase,signal,vaultId);
      case 'saveMobileDatabaseGeneratedCell':return saveMobileDatabaseGeneratedCell(args[0],identity!.deviceGrant,vaultId);
      case 'runMobileDatabaseButton':signal?.throwIfAborted();return runMobileDatabaseButton(args[0],identity!.idempotencyKey,identity!.deviceGrant);
      case 'recoverMobileDatabaseAction':return recoverMobileDatabaseAction(args[0],identity!.deviceGrant,vaultId,phase,signal);
      case 'saveMobileDatabaseButtonResult':return saveMobileDatabaseButtonResult(args[0],identity!.deviceGrant);
      default:throw new Error('operation_forbidden');
    }
  },domains);
  const result=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>signal?withGenerationSignal(signal,invoke):invoke()));
  if(method!=='getMobileDatabaseActionSource')invalidateLiveCorpus(vaultId);
  return result;
}
