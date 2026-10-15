import {prepareDeepResearchVariantRequest} from '@shared/prepareDeepResearchVariantRequest';
import {portableDeepResearchAI} from '@shared/portableDeepResearchAI';
import {portableStudyDeepResearch,type PortableStudyDeepResearchHost} from '@shared/portableStudyDeepResearch';
import {captureMobileStudyResearchSources,studyResearchKnowledge,type MobileStudyResearchSource} from '@shared/mobileStudyResearch';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint} from '@shared/mobileDeepResearch';
import {studyChatCandidates,orderStudyChatEntries} from '@shared/studyChatRetrieval';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {structuredPrompt} from './structuredPrompt';
import type {DeepResearchProgress} from '@shared/types';
type Call=(method:string,...args:any[])=>Promise<any>;
export async function autonomousStudyResearch(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController,notify:(progress:DeepResearchProgress)=>void){
 const {request}=checkpoint,signal=controller.signal,model=request.model!;
 let source=checkpoint.calls['source:study']?.output as MobileStudyResearchSource|undefined;
 if(!source){const captured=await call('mobileStudyResearchSource',request);source=captureMobileStudyResearchSources(captured.packs,captured.sourceScope);if(checkpoint.context&&(checkpoint.context.vaultId!==source.context.vaultId||checkpoint.context.vaultType!==source.context.vaultType||checkpoint.context.revision!==source.context.revision||checkpoint.context.sourceScope!==source.context.sourceScope))throw new Error('mobile_study_source_revision_changed');checkpoint.context=source.context;checkpoint.calls['source:study']={input:JSON.stringify({packIds:source.packIds}),output:source};await persist();}
 const copied=source;
 const complete=async(opts:Parameters<PortableStudyDeepResearchHost['completeText']>[0],chosen:Parameters<PortableStudyDeepResearchHost['completeText']>[1],format:'json'|'text',attempt=0)=>{
  signal.throwIfAborted();if(chosen&&(chosen.provider!==model.provider||chosen.model!==model.model))throw new Error('mobile_model_fallback_forbidden');
  const input={...structuredPrompt({system:opts.system,user:opts.user,maxTokens:opts.maxTokens??8000,temperature:opts.temperature??0.2},model,request.thinkingEffort),format,generationId:checkpoint.id,completionKey:`study:${sha256Snapshot([format,opts.system,opts.user])}:${attempt}`};
  try{const value=await durableDeepResearchCall(checkpoint,`local:study:${sha256Snapshot(input)}`,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??input);return value===null?undefined:value;}});if(typeof value!=='string')throw new Error('invalid_mobile_study_completion');return value;}catch(error){controller.abort(error);throw error;}
 };
 const text:PortableStudyDeepResearchHost['completeText']=(opts,chosen)=>complete(opts,chosen,'text');
 const json:PortableStudyDeepResearchHost['completeJson']=async(opts,guard,chosen)=>{let failure:unknown;for(let attempt=0;attempt<(opts.noRetry?1:3);attempt++){const raw=await complete(opts,chosen,'json',attempt);try{const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));if(guard(value))return value;throw new Error('invalid_study_model_response');}catch(error){failure=error;}}throw failure;};
 const engine=portableStudyDeepResearch({completeText:text,completeJson:json,retrieveStudyAssistantEntries:async(query,options,keys=[],limit=18)=>{signal.throwIfAborted();const candidates=studyChatCandidates(copied.entries,options,keys);return orderStudyChatEntries(query,candidates,options,keys,null,limit);},listStudyIdeasForSources:keys=>studyResearchKnowledge(copied,keys)});
 const routed=request.deepResearchVersion==='v2'?await prepareDeepResearchVariantRequest(request,model,portableDeepResearchAI({documentaryEvidence:false,completeText:text,completeJson:json}).aiDecomposeObjective,signal):request;
 const report=await engine.generateStudyDeepResearchReport(routed,model,notify,signal);signal.throwIfAborted();
 Object.assign(report.meta,{mobileRetrieval:{mode:'lexical',sourceScope:copied.context.sourceScope,preparedSourcesOnly:true}});
 report.draft.generationModel=model;return report;
}
