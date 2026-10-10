import { createImmersionAIDependencies } from '@shared/immersionGeneration';
import { orchestrateImmersion } from '../../electron/ai/immersionCore';
import type { ImmersionBuildProgress, ImmersionPlan, ImmersionRequest, ImmersionSession } from '@shared/types';
import {structuredPrompt} from './structuredPrompt';
import {immersionContextFromCopy, mobileImmersionLanguage, type MobileImmersionGenerationContext} from '@shared/mobileImmersion';
import {PendingPublicationError, preservePendingPublication, type PublicationCheckpoint} from './publicationRecovery';

type Call = (method:string,...args:unknown[])=>Promise<any>;
type Checkpoint = PublicationCheckpoint & {id:string;entityKey:string;request:ImmersionRequest;state:'accepted'|'running'|'saved'|'available'|'failed';context?:MobileImmersionGenerationContext;plan?:ImmersionPlan;result?:ImmersionSession;error?:string};
const active = new Map<string,Promise<ImmersionSession>>();
export async function autonomousImmersionContext(call:Call, request: Pick<ImmersionRequest,'topic'|'language'|'minutes'>):Promise<MobileImmersionGenerationContext> {
  try { return await call('getImmersionGenerationContext',request); }
  catch(error) {
    if((error as {code?:string})?.code!=='offline')throw error;
    return immersionContextFromCopy(request, await call('getImmersionOfflineSource',
      {topic:request.topic.trim(),language:mobileImmersionLanguage(request.language)}));
  }
}
export async function autonomousImmersion(call:Call, request:ImmersionRequest, onProgress:(progress:ImmersionBuildProgress)=>void):Promise<ImmersionSession> {
  const identity = JSON.stringify([request.topic.trim(),request.language??'es',request.minutes,request.includeQuiz,request.model?.provider,request.model?.model,request.thinkingEffort]);
  const entity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),x=>x.toString(16).padStart(2,'0')).join('');
  if (active.has(entity)) return active.get(entity)!;
  const run=execute(call,entity,request,onProgress).finally(()=>active.delete(entity));active.set(entity,run);return run;
}
async function execute(call:Call,entityKey:string,request:ImmersionRequest,onProgress:(progress:ImmersionBuildProgress)=>void):Promise<ImmersionSession> {
  if (!request.model) throw new Error('Elige un modelo y configura su proveedor en los ajustes del móvil.');
  const previous=await call('mobileGenerationCheckpoint','load','immersion',entityKey) as Checkpoint|null;
  if(previous?.state==='available' && previous.recoveredPublication && previous.result){
    delete previous.recoveredPublication;await call('mobileGenerationCheckpoint','save','immersion',entityKey,previous);return previous.result;
  }
  const checkpoint:Checkpoint=previous && previous.state !== 'available' ? previous : {id:crypto.randomUUID(),entityKey,request,state:'accepted'};
  request=checkpoint.request;
  const save=()=>call('mobileGenerationCheckpoint','save','immersion',entityKey,checkpoint);
  await save();
  try {
    checkpoint.context??=await autonomousImmersionContext(call,request);
    if(!checkpoint.plan){checkpoint.state='running';delete checkpoint.error;await save();}
    const complete=async<T>(prompt:{system:string;user:string;temperature:number;maxTokens:number},valid:(value:unknown)=>value is T):Promise<T>=>{
      const response=await call('mobileStructuredCompletion',{...structuredPrompt(prompt,request.model!,request.thinkingEffort),generationId:checkpoint.id});
      let result:unknown;
      try { result=JSON.parse(String(response).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); } catch { throw new Error('El proveedor devolvió JSON incompleto.'); }
      if(!valid(result))throw new Error('La respuesta de inmersión no respeta la estructura requerida.');return result;
    };
    if(!checkpoint.plan){
      checkpoint.plan=await orchestrateImmersion(request,{buildMaterial:async()=>checkpoint.context!.material,...createImmersionAIDependencies(complete)},onProgress);
      checkpoint.state='saved';await save();
    }
    checkpoint.result=await call('saveImmersionGeneratedSession',{request,revision:checkpoint.context!.revision,offlineSourceVersion:checkpoint.context!.offlineSourceVersion,plan:checkpoint.plan,model:request.model,requestId:checkpoint.id});
    checkpoint.state='available';delete checkpoint.error;delete checkpoint.publicationPending;await save();return checkpoint.result!;
  }catch(error){
    if(preservePendingPublication(checkpoint,error)){await save();throw new PendingPublicationError();}
    checkpoint.state='failed';checkpoint.error=String(error);await save();throw error;
  }
}
