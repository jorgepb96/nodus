import {mobileDeepResearchCover} from './deepResearchCover';
import {autonomousCompleteGuide} from './autonomousCompleteGuide';
import {orchestrateDeepResearch,type DeepResearchDeps} from '../../electron/ai/deepResearchCore';
import {mobileDeepResearchCoverMetadata,durableDeepResearchCall,indexMobileDeepResearchCitations,normalizeMobileDeepResearchRequest,assertMobileDeepResearchSource,type MobileDeepResearchCheckpoint,type MobileDeepResearchSource,type MobileDeepResearchReport} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {structuredPrompt} from './structuredPrompt';
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
 let progressWrites=Promise.resolve();
 const source=async<T>(stage:string,input:unknown):Promise<T>=>{
  signal.throwIfAborted();
  const key=`source:${sha256Snapshot([stage,input])}`;
  return durableDeepResearchCall(checkpoint,key,input,async()=>{
   for(let round=0;round<128;round++){
    signal.throwIfAborted();
    const replies=Object.fromEntries(Object.entries(checkpoint.calls).filter(([key])=>key.startsWith('host:')).map(([key,value])=>[key.slice(5),value.output]));
    let result:any;
    try {result=await call('getMobileDeepResearchSource',{request,generationId:checkpoint.id,expectedVaultId:checkpoint.context?.vaultId,expectedRevision:checkpoint.context?.revision,stage,input,history:checkpoint.history??[],transcript:checkpoint.completionTranscript,replies});}
    catch(error){controller.abort();throw error;}

    if(result?.version!==1)throw new Error('invalid_deep_research_stage_response');
    if(result.progress){checkpoint.progress=result.progress;notify(result.progress);}
    if(Object.hasOwn(result,'value')){
     checkpoint.history??=[];checkpoint.history.push({stage,input:structuredClone(input)});return result.value as T;
    }
    const prompt=result.completion;
    if(!prompt||typeof prompt.id!=='string'||!(/^[a-f0-9]{64}:\d+$/.test(prompt.id))||prompt.model?.provider!==model.provider||prompt.model?.model!==model.model||typeof prompt.system!=='string'||typeof prompt.user!=='string'||!['json','text'].includes(prompt.format))throw new Error('invalid_deep_research_completion_frame');
    const body=structuredPrompt({system:prompt.system,user:prompt.user,temperature:prompt.temperature??0.2,maxTokens:prompt.maxTokens},model,prompt.researchEffort??request.thinkingEffort);
    const completionRequest={...body,format:prompt.format,generationId:checkpoint.id,completionKey:checkpoint.completionAttempt?`${prompt.id}:review:${checkpoint.completionAttempt}`:prompt.id};
    await durableDeepResearchCall(checkpoint,`host:${prompt.id}`,prompt,()=>call('mobileStructuredCompletion',completionRequest),persist,{paid:true,request:completionRequest,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??completionRequest);return value===null?undefined:value;}});
   }
   throw new Error('La etapa requiere demasiadas decisiones de modelo. La investigación y sus respuestas se conservan para revisión.');
  },persist);
 };
 try {
  if(request.decorativeImage?.enabled&&!checkpoint.imageModel){const imageModel=await call('mobileImageConfiguration');if(!imageModel?.provider||!imageModel?.model)throw new Error('Configura un modelo de imagen del móvil antes de generar la portada.');checkpoint.imageModel=imageModel;await persist();}
  if(!checkpoint.report){
   if(request.completeGuide){
    checkpoint.state='running';delete checkpoint.error;await persist();
    checkpoint.report=await autonomousCompleteGuide(call,checkpoint,persist,controller,notify);
    checkpoint.report.draft.generationModel=model;
    checkpoint.report.draft.documentSkills=request.documentSkills;
   }else{
   const description=await source<{variant:string;context:MobileDeepResearchCheckpoint['context']}>('describe',[]);
   if(!description.context||description.context.version!==1)throw new Error('invalid_deep_research_source_description');
   checkpoint.context??=description.context;checkpoint.state='running';delete checkpoint.error;await persist();
   if(description.variant!=='academic'){
    const completed=await source<{report:NonNullable<MobileDeepResearchCheckpoint['report']>}>('variantRun',[]);
    if(!completed.report?.draft||!completed.report.meta)throw new Error('invalid_deep_research_variant_result');
    checkpoint.report=completed.report;
   } else {
   const deps:DeepResearchDeps={
    strictDocumentaryGrounding:true,
    buildSnapshot:async brief=>{const captured=await source<MobileDeepResearchSource>('snapshot',{brief});assertMobileDeepResearchSource(captured);checkpoint.context??={version:captured.version,vaultId:captured.vaultId,vaultType:captured.vaultType,revision:captured.revision,sourceScope:captured.sourceScope,queryEmbeddingModel:captured.queryEmbeddingModel,preparedSourcesOnly:captured.preparedSourcesOnly};await persist();return captured.snapshot;},
    planReport:input=>source('planReport',input),writeSection:input=>source('writeSection',input),finalize:input=>source('finalize',input),
    verifyCitations:(claims,language)=>source('verifyCitations',[claims,language]),checkCoherence:(sections,language)=>source('checkCoherence',[sections,language]),
    retrieveForSection:input=>source('section',input),researchTraversal:()=>source('researchTraversal',[]),
    repairSectionCoverage:(input,draft)=>source('repairSectionCoverage',[input,draft]),checkSectionCoverage:(input,draft)=>source('checkSectionCoverage',[input,draft]),
    auditFactualProse:markdown=>source('auditFactualProse',markdown),auditReportConsistency:statements=>source('auditReportConsistency',[statements]),
    ...(request.deepResearchVersion==='v2'?{
     decomposeObjective:(objective:string,language:NonNullable<DeepResearchRequest['language']>)=>source<string[]>('decomposeObjective',[objective,language]),
     auditFinalSummary:(input,draft)=>source('auditFinalSummary',[input,draft]),auditPlanCoverage:input=>source('auditPlanCoverage',input),auditSectionClaims:input=>source('auditSectionClaims',input),reviseSection:input=>source('reviseSection',input),
    }:{}),
   };
   checkpoint.state='running';delete checkpoint.error;await persist();
   checkpoint.report=await orchestrateDeepResearch({...request,studyMode:false,unitMode:false,documentSkills:undefined},deps,progress=>{checkpoint.progress=progress;notify(progress);progressWrites=progressWrites.then(persist);},signal);
   await progressWrites;signal.throwIfAborted();
   const report=checkpoint.report;report.draft={...report.draft,brief:{...report.draft.brief,deepResearchApproach:request.approach,deepResearchVersion:request.deepResearchVersion},deepResearchApproach:request.approach,deepResearchVersion:request.deepResearchVersion,deepResearchSectionLength:request.sectionLength,generationModel:model,documentSkills:undefined};
   }
   }
   await persist();
  }
  if(request.decorativeImage?.enabled&&!(checkpoint.report as MobileDeepResearchReport).mobileCover){checkpoint.state='running';await persist();(checkpoint.report as MobileDeepResearchReport).mobileCover=await mobileDeepResearchCover(call,checkpoint,persist,signal);}
  checkpoint.state='saved';await persist();
  try {const result=await call('saveMobileDeepResearchReport',{request,source:checkpoint.context,report:checkpoint.report,requestId:checkpoint.id});
   if(!result||result.id!==checkpoint.id)throw new Error('invalid_deep_research_publication_receipt');
   checkpoint.result=result;checkpoint.state='available';delete checkpoint.error;delete checkpoint.publicationPending;await persist();}
  catch(error){checkpoint.publicationPending=true;checkpoint.error=String(error);await persist();}
 } catch(error) {
  // Cancellation stops future stages, while an accepted completion may already
  // have reached durable native storage. Attach it without buying a new answer.
  if(checkpoint.inflight?.request){
   try {const recovered=await call('mobileSavedStructuredCompletion',checkpoint.inflight.request);if(recovered!==null){checkpoint.calls[checkpoint.inflight.key]={input:checkpoint.inflight.input,output:recovered};if(checkpoint.inflight.key.startsWith('host:')){checkpoint.completionTranscript??=[];if(!checkpoint.completionTranscript.includes(checkpoint.inflight.key.slice(5)))checkpoint.completionTranscript.push(checkpoint.inflight.key.slice(5));}delete checkpoint.inflight;}}catch{/* Original failure remains; unresolved marker still forbids automatic repayment. */}
  }
  checkpoint.state=signal.aborted&&checkpoint.state==='cancelled'?'cancelled':'failed';checkpoint.error=String(error).includes('mobile_paid_response_uncertain')?'El paso quedó sin una respuesta confirmada y pudo haberse enviado al proveedor. No se volverá a comprar automáticamente; revisa este paso antes de reintentarlo.':String(error);await persist();throw error;
 } finally {await progressWrites.catch(()=>{});await call('endAutonomousAuthoring',checkpoint.id);}
}
export async function autonomousDeepResearchCheckpoints(call:Call,summaries=false):Promise<MobileDeepResearchCheckpoint[]> {const values=await call('mobileDeepResearchCheckpoints',...(summaries?['summaries']:[]));if(!Array.isArray(values))throw new Error('invalid_deep_research_checkpoints');return values;}
export async function cancelAutonomousDeepResearch(call:Call,id:string):Promise<boolean>{
 const checkpoint=(await autonomousDeepResearchCheckpoints(call)).find(item=>item.id===id);if(!checkpoint||checkpoint.report)return false;
 const running=active.get(checkpoint.entityKey);if(running){running.checkpoint.state='cancelled';checkpoint.state='cancelled';await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);running.controller.abort();await call('cancelAutonomousGeneration',id);await running.task.catch(()=>{});return true;}
 checkpoint.state='cancelled';delete checkpoint.error;await call('mobileGenerationCheckpoint','save','deepResearch',checkpoint.entityKey,checkpoint);return true;
}

export async function localDeepResearchJobs(call:Call):Promise<Array<DeepResearchJobRecord&{retryable:boolean}>> {
 return (await autonomousDeepResearchCheckpoints(call,true)).filter(item=>!item.hiddenFromQueue).map(item=>({id:item.id,origin:'mobile',vaultId:item.context?.vaultId??'',vaultName:'Este dispositivo',objective:item.request.objective,title:item.report?.draft.title??item.request.objective.slice(0,120),deepResearchApproach:item.request.approach,deepResearchVersion:item.request.deepResearchVersion,structure:item.request.sectionLimit==='single'?'single':'sectioned',sectionLength:item.request.sectionLength,model:item.request.model,status:item.report?'completed':item.state==='cancelled'?'cancelled':active.has(item.entityKey)?'running':'failed',retryable:!active.has(item.entityKey)&&item.state!=='cancelled'&&!item.recoveryReviewRequired,progress:item.progress??null,error:item.error??(!item.report&&!active.has(item.entityKey)&&item.state!=='cancelled'?'Investigación pausada en este dispositivo. Puedes continuar con sus respuestas guardadas.':null),savedDraftId:item.report?`mobile-dr-${item.id}`:null,saveError:item.publicationPending?item.error??'Pendiente de guardar en el Mac':null,ahead:null,enqueuedAt:item.createdAt,startedAt:item.state==='accepted'?null:item.createdAt,finishedAt:item.report?item.report.draft.generatedAt:null}));
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
