import {mobileCompleteGuideWebText} from './completeGuideWebText';
import {mobileCompleteGuideWebImages} from './completeGuideWebImages';
import {runCompleteGuide,type CompleteGuideDeps} from '../../electron/ai/completeGuide/core';
import {COMPLETE_GUIDE_PROMPT_VERSION} from '../../electron/ai/completeGuide/prompts';
import {completeGuidePrice} from '@shared/completeGuide/estimate';
import {normalizeCompleteGuideConfig} from '@shared/completeGuide/types';
import {buildCompleteGuideReport} from '@shared/completeGuide/report';
import {completeGuideFigureKey,assertMobileCompleteGuideSource,selectMobileCompleteGuideSources,type MobileCompleteGuideSource} from '@shared/mobileCompleteGuide';
import {portableResearchClaimAudit} from '@shared/portableResearchClaimAudit';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint} from '@shared/mobileDeepResearch';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {structuredPrompt} from './structuredPrompt';
import type {DeepResearchProgress} from '@shared/types';
type Call=(method:string,...args:any[])=>Promise<any>;
/** The whole canonical guide runs in this browser process. The Mac is only a
 * source download/publication destination, never an orchestration dependency. */
export async function autonomousCompleteGuide(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController,notify:(progress:DeepResearchProgress)=>void) {
 const signal=controller.signal;
 const request=checkpoint.request,config=normalizeCompleteGuideConfig(request.completeGuide),model=request.model!;
 checkpoint.embeddingConfiguration??=await call('mobileEmbeddingConfiguration');
 if(!checkpoint.embeddingConfiguration)throw new Error('Configura un modelo de embeddings del móvil para comparar los conceptos de la guía.');
 await persist();
 const sourceKey='source:completeGuide';
 let source=checkpoint.calls[sourceKey]?.output as MobileCompleteGuideSource|undefined;
 if(!source){source=selectMobileCompleteGuideSources(await call('mobileCompleteGuideSource',request),config.selection);assertMobileCompleteGuideSource(source,config.selection);checkpoint.calls[sourceKey]={input:JSON.stringify(config.selection),output:source};checkpoint.context=source.context;await persist();}
 assertMobileCompleteGuideSource(source,config.selection);
 const embedding=checkpoint.embeddingConfiguration;
 if(config.webText&&!checkpoint.webSearchEndpoint){const endpoint=await call('mobileWebSearchConfiguration');if(typeof endpoint!=='string'||!endpoint)throw new Error('Configura la búsqueda web del móvil antes de incluir fuentes web en la guía.');checkpoint.webSearchEndpoint=endpoint;await persist();}
 let writes=Promise.resolve();
 const flush=async()=>{await writes;signal.throwIfAborted();};
 const store=()=>{writes=writes.then(persist);};
 const paid=async(input:Record<string,unknown>)=>{
  await flush();const key=`local:guide:${sha256Snapshot(input)}`;
  try{return await durableDeepResearchCall(checkpoint,key,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const recovered=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??input);return recovered===null?undefined:recovered;}});}
  catch(error){controller.abort(error);throw error;}
 };
 const usage=()=>{
  const completed=Object.entries(checkpoint.calls).filter(([key,value])=>key.startsWith('local:guide:')&&(JSON.parse(value.input) as {format?:string}).format!=='embedding').map(([,value])=>value);
  const inputTokens=completed.reduce((sum,value)=>{const input=JSON.parse(value.input) as {system?:string;user?:string};return sum+Math.ceil(((input.system?.length??0)+(input.user?.length??0))/3.6);},0);
  const outputTokens=completed.reduce((sum,value)=>sum+Math.ceil((typeof value.output==='string'?value.output:JSON.stringify(value.output)).length/3.6),0);
  const price=completeGuidePrice(model);
  return {calls:completed.length,inputTokens,outputTokens,usd:price?(inputTokens*price.input+outputTokens*price.output)/1_000_000:null};
 };
 const jsonWithAttempts=async <T>(prompt:Omit<Parameters<CompleteGuideDeps['json']>[0],'validate'> & {validate:(value:unknown)=>value is T},attempts:number):Promise<T>=>{
  const spent=usage().usd;
  if(config.maxCostUsd&&spent!==null&&spent>=config.maxCostUsd)throw new Error(`Se ha alcanzado el presupuesto de la guía (${config.maxCostUsd} USD). Las respuestas se conservan.`);
  let failure:unknown;
  for(let attempt=0;attempt<attempts;attempt++){
   const body=structuredPrompt({system:prompt.system,user:prompt.user,maxTokens:prompt.maxTokens,temperature:prompt.temperature??0},model,prompt.mechanical?'standard':request.thinkingEffort);
   const raw=await paid({...body,format:'json',generationId:checkpoint.id,completionKey:`guide:${sha256Snapshot([prompt.stage,prompt.system,prompt.user])}:${attempt}`});
   try{const value=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;if(prompt.validate(value))return value;throw new Error('invalid_complete_guide_model_response');}catch(error){failure=error;}
  }
  throw failure;
 };
 const json:CompleteGuideDeps['json']=prompt=>jsonWithAttempts(prompt,3);
 const audit=portableResearchClaimAudit({completeJson:(opts,guard)=>jsonWithAttempts({stage:'verify',system:opts.system,user:opts.user,maxTokens:opts.maxTokens??6000,temperature:opts.temperature,mechanical:true,validate:guard},opts.noRetry?1:3),currentJobThinkingEffort:()=> 'standard',isOutputTruncated:error=>(error as {code?:string})?.code==='output_truncated'});
 const auditor=audit.createResearchProseAuditor(model,signal);
 checkpoint.guideCache??={};checkpoint.guideCheckpoints??={};
 const deps:CompleteGuideDeps={
  json,
  ...(config.webImages?{webImages:async requests=>{const key=`source:guide-web-images:${sha256Snapshot(requests)}`;return durableDeepResearchCall(checkpoint,key,requests,()=>mobileCompleteGuideWebImages(call,requests,(request.language??'es').split('-')[0],signal),persist);}} satisfies Partial<CompleteGuideDeps>:{}),
  embed:async texts=>{const vectors=[];for(const text of texts){const raw=await paid({model:{provider:embedding.provider,model:embedding.model},system:'',user:text.slice(0,8000),maxTokens:1,format:'embedding',embeddingDimensions:embedding.dim,generationId:checkpoint.id,completionKey:`guide:embed:${sha256Snapshot([embedding,text])}`});const vector=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(vector)||vector.length!==embedding.dim||vector.some(v=>typeof v!=='number'||!Number.isFinite(v))||vector.every(v=>v===0)){const error=new Error('invalid_mobile_embedding_response');controller.abort(error);throw error;}vectors.push(vector as number[]);}return vectors;},
  audit:async(markdown,sources)=>{const checked=await auditor.audit(markdown,sources);return {markdown:checked.markdown,removed:checked.claims.filter(claim=>claim.status!=='supported'&&!(claim.kind==='nonfactual'&&claim.failure!=='nonfactual_with_content')).length};},
  conflicts:async statements=>(await audit.findResearchConflicts(statements,model,signal)).filter(row=>row.incompatible).map(({a,b,reason})=>({a,b,reason})),
  figures:async requests=>requests.flatMap(request=>{const figure=source!.figures[completeGuideFigureKey(request.materialId,request.page,request.slide)];return figure?[{...figure,itemId:request.itemId,caption:request.caption,source:request.source}]:[];}),
  cacheGet:<T>(key:string)=>checkpoint.guideCache![key] as T??null,
  cachePut:(key,_stage,value)=>{checkpoint.guideCache![key]=structuredClone(value);store();},
  checkpointGet:<T>(stage:string,unit:string)=>checkpoint.guideCheckpoints![JSON.stringify([stage,unit])] as T??null,
  checkpointPut:(stage,unit,value)=>{checkpoint.guideCheckpoints![JSON.stringify([stage,unit])]=structuredClone(value);store();},
  hash:value=>bytesToHex(sha256(new TextEncoder().encode(value))),checkpoint:()=>signal.throwIfAborted(),
  progress:event=>{const progress:DeepResearchProgress={phase:event.stage==='write'?'section':event.stage==='verify'?'coverage':event.stage==='finalize'?'assembling':event.stage==='plan'?'planning':'document_preparation',message:event.detail??event.stage};checkpoint.progress=progress;notify(progress);store();},
 };
 if(config.webText)deps.web=async input=>{const key=`source:guide-web:${sha256Snapshot(input)}`;const result=await durableDeepResearchCall(checkpoint,key,input,()=>mobileCompleteGuideWebText(call,checkpoint.webSearchEndpoint!,input,prompt=>jsonWithAttempts(prompt,1),deps.embed,signal),persist);return result.passages;};
 try{
  const result=await runCompleteGuide({config,snapshot:source.frozen.snapshot,organization:source.frozen.organization,language:request.language??'es',modelKey:`${model.provider}/${model.model}`,promptVersion:COMPLETE_GUIDE_PROMPT_VERSION,instructions:config.instructions},deps);
  await flush();
  const report=buildCompleteGuideReport(request,config,source.frozen,result,request.language??'es',usage());
  const webPassages=Object.entries(checkpoint.calls).filter(([key])=>key.startsWith('source:guide-web:')).flatMap(([,value])=>(value.output as {passages:Array<{record:unknown}>}).passages.map(passage=>passage.record));
  if(webPassages.length)report.completeGuideArtifacts={...report.completeGuideArtifacts as object,webPassages};
  return report;
 }finally{await writes;}
}
