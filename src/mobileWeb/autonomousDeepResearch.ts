import {enrichAutonomousResearchVisuals,publishAutonomousResearchVisualAssets} from './autonomousResearchVisuals';
import {hasLegacyResearchTranscript,legacyBridgeResearch} from './legacyBridgeResearch';
import {autonomousAcademicResearch} from './autonomousAcademicResearch';
import {autonomousGenealogyResearch} from './autonomousGenealogyResearch';
import {autonomousStudyResearch} from './autonomousStudyResearch';
import {mobileDeepResearchCover} from './deepResearchCover';
import {autonomousCompleteGuide} from './autonomousCompleteGuide';
import {mobileDeepResearchCoverMetadata,indexMobileDeepResearchCitations,normalizeMobileDeepResearchRequest,type MobileDeepResearchCheckpoint,type MobileDeepResearchReport} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import type {DeepResearchRequest,DeepResearchProgress,DeepResearchJobRecord} from '@shared/types';

type Call=(method:string,...args:any[])=>Promise<any>;
const active=new Map<string,{controller:AbortController;task:Promise<void>;checkpoint:MobileDeepResearchCheckpoint}>();
export async function enqueueAutonomousDeepResearch(call:Call,raw:DeepResearchRequest,notify:(progress:DeepResearchProgress)=>void):Promise<'accepted'> {
 const request=normalizeMobileDeepResearchRequest(raw),entityKey=sha256Snapshot(request);
 if(active.has(entityKey))return 'accepted';
 const previous=await call('mobileGenerationCheckpoint','load','deepResearch',entityKey) as MobileDeepResearchCheckpoint|null;
 if(previous?.recoveryReviewRequired)throw new Error('Revisa el resultado recuperado antes de guardarlo o continuar esta investigación.');
 const checkpoint:MobileDeepResearchCheckpoint=previous&&!['available','cancelled'].includes(previous.state)?previous:{id:crypto.randomUUID(),entityKey,request,state:'accepted',createdAt:new Date().toISOString(),calls:{}};
 delete checkpoint.hiddenFromQueue;
 await call('beginAutonomousAuthoring',checkpoint.id);
 try {await call('mobileGenerationCheckpoint','save','deepResearch',entityKey,checkpoint);} catch(error){await call('endAutonomousAuthoring',checkpoint.id);throw error;}
 const controller=new AbortController();
 const task=execute(call,checkpoint,controller,notify).finally(()=>active.delete(entityKey));active.set(entityKey,{controller,task,checkpoint});void task.catch(()=>{});return 'accepted';
}
async function execute(call:Call,checkpoint:MobileDeepResearchCheckpoint,controller:AbortController,notify:(progress:DeepResearchProgress)=>void):Promise<void> {
 const persist=async()=>{checkpoint.citationIndex=indexMobileDeepResearchCitations(checkpoint);await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);};
 const request=checkpoint.request,model=request.model!,signal=controller.signal;
 try {
  if(request.decorativeImage?.enabled&&!checkpoint.imageModel){const imageModel=await call('mobileImageConfiguration');if(!imageModel?.provider||!imageModel?.model)throw new Error('Configura un modelo de imagen del móvil antes de generar la portada.');checkpoint.imageModel=imageModel;await persist();}
  if(!checkpoint.report){
   if(hasLegacyResearchTranscript(checkpoint)){
    checkpoint.state='running';delete checkpoint.error;await persist();
    checkpoint.report=await legacyBridgeResearch(call,checkpoint,persist,controller,notify);
   }else if(request.completeGuide){
    checkpoint.state='running';delete checkpoint.error;await persist();
    checkpoint.report=await autonomousCompleteGuide(call,checkpoint,persist,controller,notify);
    checkpoint.report.draft.generationModel=model;
    checkpoint.report.draft.documentSkills=request.documentSkills;
   }else if(request.studyMode||request.unitMode){
    checkpoint.state='running';delete checkpoint.error;await persist();
    checkpoint.report=await autonomousStudyResearch(call,checkpoint,persist,controller,progress=>{checkpoint.progress=progress;notify(progress);});
   }else if(Object.hasOwn(request,'focusPersonId')||checkpoint.context?.vaultType==='genealogy'){
    checkpoint.state='running';delete checkpoint.error;await persist();
    checkpoint.report=await autonomousGenealogyResearch(call,checkpoint,persist,controller,progress=>{checkpoint.progress=progress;notify(progress);});
   }else{
    checkpoint.state='running';delete checkpoint.error;await persist();
   checkpoint.report=await autonomousAcademicResearch(call,checkpoint,persist,controller,progress=>{checkpoint.progress=progress;notify(progress);});
   }
   await persist();
  }
  if(request.decorativeImage?.enabled&&!(checkpoint.report as MobileDeepResearchReport).mobileCover){checkpoint.state='running';await persist();(checkpoint.report as MobileDeepResearchReport).mobileCover=await mobileDeepResearchCover(call,checkpoint,persist,signal);}
  await enrichAutonomousResearchVisuals(call,checkpoint,persist,controller);
  checkpoint.state='saved';await persist();
  try {await publishAutonomousResearchVisualAssets(call,checkpoint,persist);const result=await call('saveMobileDeepResearchReport',{request,source:checkpoint.context,report:checkpoint.report,requestId:checkpoint.id});
   if(!result||result.id!==checkpoint.id)throw new Error('invalid_deep_research_publication_receipt');
   checkpoint.result=result;checkpoint.state='available';delete checkpoint.error;delete checkpoint.publicationPending;await persist();}
  catch(error){checkpoint.publicationPending=true;checkpoint.error=String(error);await persist();}
 } catch(error) {
  // Cancellation stops future stages, while an accepted completion may already
  // have reached durable native storage. Attach it without buying a new answer.
  if(checkpoint.inflight?.request){
   try {const recovered=await call('mobileSavedStructuredCompletion',checkpoint.inflight.request);if(recovered!==null){checkpoint.calls[checkpoint.inflight.key]={input:checkpoint.inflight.input,output:recovered};if(checkpoint.inflight.key.startsWith('host:')){checkpoint.completionTranscript??=[];if(!checkpoint.completionTranscript.includes(checkpoint.inflight.key.slice(5)))checkpoint.completionTranscript.push(checkpoint.inflight.key.slice(5));}delete checkpoint.inflight;}}catch{/* Original failure remains; unresolved marker still forbids automatic repayment. */}
  }
  checkpoint.state=signal.aborted&&checkpoint.state==='cancelled'?'cancelled':'failed';checkpoint.error=String(error).includes('mobile_paid_response_uncertain')?'El paso quedó sin una respuesta confirmada y pudo haberse enviado al proveedor. No se volverá a comprar automáticamente; revisa este paso antes de reintentarlo.':hasLegacyResearchTranscript(checkpoint)?`Este informe anterior conserva sus respuestas y necesita el Mac para continuar su recorrido original. ${String(error)}`:String(error);await persist();throw error;
 } finally {await call('endAutonomousAuthoring',checkpoint.id);}
}
export async function autonomousDeepResearchCheckpoints(call:Call,summaries=false):Promise<MobileDeepResearchCheckpoint[]> {const values=await call('mobileDeepResearchCheckpoints',...(summaries?['summaries']:[]));if(!Array.isArray(values))throw new Error('invalid_deep_research_checkpoints');return values;}
export async function cancelAutonomousDeepResearch(call:Call,id:string):Promise<boolean>{
 const checkpoint=(await autonomousDeepResearchCheckpoints(call)).find(item=>item.id===id);if(!checkpoint)return false;
 const running=active.get(checkpoint.entityKey);if(checkpoint.report&&!running)return false;if(running){running.checkpoint.state='cancelled';checkpoint.state='cancelled';await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);running.controller.abort();await call('cancelAutonomousGeneration',id);await running.task.catch(()=>{});return true;}
 checkpoint.state='cancelled';delete checkpoint.error;await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);return true;
}

export async function localDeepResearchJobs(call:Call):Promise<Array<DeepResearchJobRecord&{retryable:boolean}>> {
 return (await autonomousDeepResearchCheckpoints(call,true)).filter(item=>!item.hiddenFromQueue).map(item=>({id:item.id,origin:'mobile',vaultId:item.context?.vaultId??'',vaultName:'Este dispositivo',objective:item.request.objective,title:item.report?.draft.title??item.request.objective.slice(0,120),deepResearchApproach:item.request.approach,deepResearchVersion:item.request.deepResearchVersion,structure:item.request.sectionLimit==='single'?'single':'sectioned',sectionLength:item.request.sectionLength,model:item.request.model,status:item.state==='cancelled'?'cancelled':active.has(item.entityKey)?'running':item.report?'completed':'failed',retryable:!active.has(item.entityKey)&&item.state!=='cancelled'&&!item.recoveryReviewRequired,progress:item.progress??null,error:item.error??(!item.report&&!active.has(item.entityKey)&&item.state!=='cancelled'?'Investigación pausada en este dispositivo. Puedes continuar con sus respuestas guardadas.':null),savedDraftId:item.report?`mobile-dr-${item.id}`:null,saveError:item.publicationPending?item.error??'Pendiente de guardar en el Mac':null,ahead:null,enqueuedAt:item.createdAt,startedAt:item.state==='accepted'?null:item.createdAt,finishedAt:item.report?item.report.draft.generatedAt:null}));
}
export async function localDeepResearchReports(call:Call) {
 const checkpoints=await call('mobileDeepResearchCheckpoints','reports') as MobileDeepResearchCheckpoint[];
 return checkpoints.flatMap(item=>item.report?[{id:`mobile-dr-${item.id}`,title:item.report.draft.title,brief:item.report.draft.brief,selection:item.report.draft.selection,model:item.request.model??null,draft:item.report.draft,image:(item.report as MobileDeepResearchReport).mobileCover?mobileDeepResearchCoverMetadata((item.report as MobileDeepResearchReport).mobileCover!,`mobile-dr-${item.id}`,item.createdAt):null,createdAt:item.createdAt,updatedAt:item.createdAt,readAt:null,mobilePublicationId:item.state==='available'&&typeof (item.result as {id?:unknown}|undefined)?.id==='string'?(item.result as {id:string}).id:undefined}]:[]);
}
export async function clearLocalDeepResearchJobs(call:Call):Promise<number>{let count=0;for(const checkpoint of await autonomousDeepResearchCheckpoints(call)){if(active.has(checkpoint.entityKey)||checkpoint.hiddenFromQueue)continue;checkpoint.hiddenFromQueue=true;await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);count++;}return count;}

export async function retryLocalDeepResearch(call:Call,id:string,notify:(progress:DeepResearchProgress)=>void):Promise<void>{
 const checkpoint=(await autonomousDeepResearchCheckpoints(call)).find(item=>item.id===id);
 if(!checkpoint||active.has(checkpoint.entityKey)||checkpoint.state==='cancelled'||checkpoint.recoveryReviewRequired)throw new Error('Esta investigación no está disponible para continuar sin revisar sus fuentes.');
 if(checkpoint.inflight){
  const recovered=await call('mobileSavedStructuredCompletion',checkpoint.inflight.request);
  if(recovered!==null){checkpoint.calls[checkpoint.inflight.key]={input:checkpoint.inflight.input,output:recovered};if(checkpoint.inflight.key.startsWith('host:')){checkpoint.completionTranscript??=[];if(!checkpoint.completionTranscript.includes(checkpoint.inflight.key.slice(5)))checkpoint.completionTranscript.push(checkpoint.inflight.key.slice(5));}delete checkpoint.inflight;}
  else {
   if(!window.confirm('Este paso quedó sin respuesta confirmada y pudo haber consumido una llamada al proveedor. ¿Quieres volver a solicitarlo? Puede generar un nuevo cargo. Las respuestas anteriores se conservarán.'))return;
   checkpoint.uncertainAttempts??=[];checkpoint.uncertainAttempts.push(structuredClone(checkpoint.inflight));delete checkpoint.inflight;checkpoint.completionAttempt=crypto.randomUUID();
  }
  await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);
 }
 await enqueueAutonomousDeepResearch(call,checkpoint.request,notify);
}
