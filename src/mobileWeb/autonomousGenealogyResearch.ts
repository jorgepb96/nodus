import {portableDeepResearchAI} from '@shared/portableDeepResearchAI';
import {prepareDeepResearchVariantRequest} from '@shared/prepareDeepResearchVariantRequest';
import {portableGenealogyDeepResearch,type PortableGenealogyDeepResearchHost} from '@shared/portableGenealogyDeepResearch';
import {planApproachRetrieval} from '@shared/portableDeepResearchApproaches';
import {normalizeDeepResearchApproach} from '@shared/deepResearchApproaches';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint} from '@shared/mobileDeepResearch';
import {validateMobileGenealogyResearchSource,type MobileGenealogyResearchSource} from '@shared/mobileGenealogyResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {normalizePromptLanguage} from '@shared/editorAiPrompts';
import {structuredPrompt} from './structuredPrompt';
import type {DeepResearchProgress} from '@shared/types';
type Call=(method:string,...args:any[])=>Promise<any>;
export async function autonomousGenealogyResearch(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController,notify:(progress:DeepResearchProgress)=>void){
 const {request}=checkpoint,model=request.model,signal=controller.signal;
 if(!model?.provider||!model.model)throw new Error('mobile_deep_research_model_missing');
 const sourceInput=JSON.stringify({focusPersonId:request.focusPersonId??null,objective:request.objective,language:request.language??null});
 const saved=checkpoint.calls['source:genealogy'];if(saved&&saved.input!==sourceInput)throw new Error('genealogy_research_request_conflict');
 let source=saved?.output as MobileGenealogyResearchSource|undefined;
 if(!source)source=await call('mobileGenealogyResearchSource',request);
 validateMobileGenealogyResearchSource(source!);const captured=source!;
 if(checkpoint.context&&['vaultId','vaultType','revision','sourceScope'].some(key=>checkpoint.context![key as keyof typeof checkpoint.context]!==captured.context[key as keyof typeof captured.context]))throw new Error('genealogy_research_source_conflict');
 if(!saved){checkpoint.calls['source:genealogy']={input:sourceInput,output:structuredClone(captured)};checkpoint.context=structuredClone(captured.context);await persist();}
 if((request.focusPersonId??null)!==(captured.focusPerson?.id??null))throw new Error('genealogy_research_focus_conflict');
 const complete=async(opts:Parameters<PortableGenealogyDeepResearchHost['completeText']>[0],chosen:Parameters<PortableGenealogyDeepResearchHost['completeText']>[1],format:'json'|'text',attempt=0)=>{
  signal.throwIfAborted();if(chosen&&(chosen.provider!==model.provider||chosen.model!==model.model))throw new Error('mobile_model_fallback_forbidden');
  const input={...structuredPrompt({system:opts.system,user:opts.user,maxTokens:opts.maxTokens??8000,temperature:opts.temperature??0.2},model,request.thinkingEffort),format,generationId:checkpoint.id,completionKey:`genealogy:${sha256Snapshot([format,opts.system,opts.user])}:${attempt}`};
  try{const value=await durableDeepResearchCall(checkpoint,`local:genealogy:${sha256Snapshot(input)}`,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??input);return value===null?undefined:value;}});if(typeof value!=='string')throw new Error('invalid_mobile_genealogy_completion');return value;}catch(error){controller.abort(error);throw error;}
 };
 const text:PortableGenealogyDeepResearchHost['completeText']=(opts,chosen)=>complete(opts,chosen,'text');
 const json:PortableGenealogyDeepResearchHost['completeJson']=async(opts,guard,chosen)=>{let failure:unknown;for(let attempt=0;attempt<(opts.noRetry?1:3);attempt++){const raw=await complete(opts,chosen,'json',attempt);try{const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));if(guard(value))return value;throw new Error('invalid_genealogy_model_response');}catch(error){failure=error;}}throw failure;};
 const engine=portableGenealogyDeepResearch({completeText:text,completeJson:json,getSettings:()=>({promptLanguage:request.language??captured.language}),resolveWorkFullText:async id=>{const item=captured.sources.find(source=>source.kind==='work'&&source.refId===id);if(!item?.fullText.trim())throw new Error('genealogy_research_work_not_downloaded');return item.fullText;},evidenceForPersons:names=>captured.evidence.filter(item=>names.has(item.persona)).slice(0,30).map(({persona,cita,localizacion})=>({persona,cita,localizacion}))});
 const approach=normalizeDeepResearchApproach(request.approach),language=normalizePromptLanguage(request.language??captured.language);
 let deps=engine.realDeps(model,signal);
 if(approach!=='general'){
  const retrieval=await planApproachRetrieval({approach,variant:'genealogy',objective:request.objective,language,model,corpusPreview:{focusPerson:captured.focusPerson,persons:captured.family.personas.slice(0,40),events:captured.family.eventos.slice(0,60),sources:captured.sources.map(source=>({kind:source.kind,title:source.title,label:source.label,persons:source.persons,snippet:source.snippet}))}},json);
  deps=engine.specializedGenealogyDeps(model,approach,retrieval,language,signal);
 }
 const routed=request.deepResearchVersion==='v2'?await prepareDeepResearchVariantRequest({...request,language:request.language??captured.language},model,portableDeepResearchAI({documentaryEvidence:false,completeText:text,completeJson:json}).aiDecomposeObjective,signal):request;
 const report=await engine.orchestrateGenealogyDeepResearch(routed,captured.sources,captured.family,deps,notify,captured.focusPerson,signal);signal.throwIfAborted();
 Object.assign(report.meta,{mobileRetrieval:{mode:'lexical',sourceScope:captured.context.sourceScope,preparedSourcesOnly:true,selection:captured.selection}});report.draft.generationModel=model;return report;
}
