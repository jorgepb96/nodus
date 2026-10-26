import {orchestrateDeepResearch,type DeepResearchDeps} from '../../electron/ai/deepResearchCore';
import {durableDeepResearchCall,assertMobileDeepResearchSource,type MobileDeepResearchCheckpoint,type MobileDeepResearchSource} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {structuredPrompt} from './structuredPrompt';
import type {DeepResearchRequest,DeepResearchProgress} from '@shared/types';
type Call=(method:string,...args:any[])=>Promise<any>;
/** Compatibility only: keep already-purchased legacy transcripts on their exact
 * original path. New requests never use this Mac-connected replay adapter. */
export function hasLegacyResearchTranscript(checkpoint:MobileDeepResearchCheckpoint):boolean {
 return Object.keys(checkpoint.calls).some(key=>key.startsWith('host:'))&&!['source:academic','source:study','source:genealogy','source:completeGuide'].some(key=>checkpoint.calls[key]);
}
export async function legacyBridgeResearch(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController,notify:(progress:DeepResearchProgress)=>void){
 const request=checkpoint.request,model=request.model!,signal=controller.signal;let progressWrites=Promise.resolve();
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
 const description=await source<{variant:string;context:MobileDeepResearchCheckpoint['context']}>('describe',[]);
 if(!description.context||description.context.version!==1)throw new Error('invalid_deep_research_source_description');
 checkpoint.context??=description.context;
 if(description.variant!=='academic'){
  const completed=await source<{report:NonNullable<MobileDeepResearchCheckpoint['report']>}>('variantRun',[]);
  if(!completed.report?.draft||!completed.report.meta)throw new Error('invalid_deep_research_variant_result');return completed.report;
 }
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
 return checkpoint.report;
}
