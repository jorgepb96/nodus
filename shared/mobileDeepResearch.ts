import {citationUrl} from './completeGuide/locators';
import type {CompleteGuideSnapshot} from './completeGuide/snapshot';
import type {DeepResearchRequest,DeepResearchReport,WritingWorkshopSnapshot,DeepResearchProgress,ModelRef} from './types';
import {canonicalJson} from './canonicalJson';
import {parseDeepResearchRequestVersion} from './deepResearchVersions';
import {normalizeDeepResearchApproach} from './deepResearchApproaches';
import {normalizeDeepResearchSectionLength} from './deepResearchSectionLength';
import {PROMPT_LANGUAGES} from './types';
import {normalizeCompleteGuideConfig} from './completeGuide/types';

export interface MobileDeepResearchSource {
 version:1;vaultId:string;vaultType:string;revision:string;snapshot:WritingWorkshopSnapshot;
 relationships:Array<{from:string;relation:string;to:string;confidence:number}>;
 /** Captured sources identify the actual consulted corpus, never an invented mirror. */
 queryEmbeddingModel?:{provider:string;model:string};preparedSourcesOnly?:boolean;
 sourceScope:'linked_corpus'|'device_downloads';
}
export type MobileDeepResearchProof = Pick<MobileDeepResearchSource,"version"|"vaultId"|"vaultType"|"revision"|"sourceScope"|"queryEmbeddingModel"|"preparedSourcesOnly">;
export interface MobileDeepResearchCheckpoint {
 imageModel?:ModelRef;
 webSearchEndpoint?:string;
 embeddingConfiguration?:{provider:string;model:string;dim:number};
 id:string;entityKey:string;request:DeepResearchRequest;state:'accepted'|'running'|'saved'|'available'|'failed'|'cancelled';createdAt:string;
 completionTranscript?:string[];
 citationIndex?:Record<string,{callKey:string;path:Array<string|number>;citation?:string}>;
 guideCache?:Record<string,unknown>;guideCheckpoints?:Record<string,unknown>;
 context?:MobileDeepResearchProof;calls:Record<string,{input:string;output:unknown}>;report?:DeepResearchReport;
 inflight?:{key:string;input:string;request?:unknown;createdAt:string};
 uncertainAttempts?:Array<{key:string;input:string;request?:unknown;createdAt:string}>;completionAttempt?:string;
 history?:Array<{stage:string;input:unknown}>;recoveryReviewRequired?:boolean;progress?:DeepResearchProgress;error?:string;result?:unknown;publicationPending?:boolean;hiddenFromQueue?:boolean;
}
/** Keep every requested option. Unsupported corpus pipelines must be routed by
 * their own adapter before invoking the academic core. */
export function normalizeMobileDeepResearchRequest(raw:unknown):DeepResearchRequest {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_deep_research_request');
 const request=raw as DeepResearchRequest;
 if(typeof request.objective!=='string'||!request.objective.trim()||request.objective.length>100_000)throw new Error('invalid_deep_research_objective');
 if(request.language!=null&&!(PROMPT_LANGUAGES as readonly unknown[]).includes(request.language))throw new Error('invalid_deep_research_language');
 if(request.sectionLimit!=null&&!['auto','single'].includes(String(request.sectionLimit))&&(!Number.isSafeInteger(request.sectionLimit)||Number(request.sectionLimit)<1))throw new Error('invalid_deep_research_sections');
 if(!request.model?.provider||!request.model.model.trim())throw new Error('mobile_deep_research_model_missing');
 return {...request,...(request.completeGuide?{completeGuide:normalizeCompleteGuideConfig(request.completeGuide)}:{}),objective:request.objective.trim(),deepResearchVersion:parseDeepResearchRequestVersion(request.deepResearchVersion),approach:normalizeDeepResearchApproach(request.approach),sectionLength:normalizeDeepResearchSectionLength(request.sectionLength)};
}
export function assertMobileDeepResearchSource(source:MobileDeepResearchSource):void {
 if(source?.version!==1||!source.vaultId||!source.revision||!['linked_corpus','device_downloads'].includes(source.sourceScope)||!source.snapshot||!Array.isArray(source.relationships))throw new Error('invalid_deep_research_source');
 for(const key of ['ideas','themes','gaps','contradictions','works','passages','tutorRoutes'] as const){
  const rows=source.snapshot[key];if(!Array.isArray(rows)||rows.some(row=>typeof row.id!=='string'||!row.id)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('invalid_deep_research_source_rows');
 }
 if(new TextEncoder().encode(JSON.stringify(source)).length>16_000_000)throw new Error('deep_research_source_too_large');
}
/** Every paid call is captured before its result reaches the orchestration core.
 * Replaying the same stage never calls a provider again; changed inputs require a
 * new cache entry rather than borrowing another stage's answer. */
export async function durableDeepResearchCall<T>(checkpoint:MobileDeepResearchCheckpoint,key:string,input:unknown,invoke:()=>Promise<T>,persist:()=>Promise<void>,options?:{paid?:boolean;request?:unknown;recover?:()=>Promise<T|undefined>}):Promise<T> {
 const canonical=canonicalJson(input);const existing=checkpoint.calls[key];
 if(existing){if(existing.input!==canonical)throw new Error('deep_research_checkpoint_input_conflict');return structuredClone(existing.output) as T;}
 if(options?.paid&&checkpoint.inflight){
  if(checkpoint.inflight.key===key&&checkpoint.inflight.input===canonical&&options.recover){
   const recovered=await options.recover();if(recovered!==undefined){checkpoint.calls[key]={input:canonical,output:structuredClone(recovered)};if(key.startsWith('host:')){checkpoint.completionTranscript??=[];if(!checkpoint.completionTranscript.includes(key.slice(5)))checkpoint.completionTranscript.push(key.slice(5));}delete checkpoint.inflight;await persist();return recovered;}
  }
  throw new Error('mobile_paid_response_uncertain');
 }
 if(options?.paid){checkpoint.inflight={key,input:canonical,request:structuredClone(options.request),createdAt:new Date().toISOString()};await persist();}
 const output=await invoke();checkpoint.calls[key]={input:canonical,output:structuredClone(output)};if(options?.paid&&key.startsWith('host:')){checkpoint.completionTranscript??=[];checkpoint.completionTranscript.push(key.slice(5));}if(checkpoint.inflight?.key===key)delete checkpoint.inflight;await persist();return output;
}
export interface MobileDeepResearchCompletion {system:string;user:string;temperature?:number;maxTokens?:number;model?:ModelRef|null;format:'json'|'text'}

/** Point to the exact captured candidate, without copying source bodies into
 * another index or recursively searching provider prompts on every citation. */
export function indexMobileDeepResearchCitations(checkpoint:MobileDeepResearchCheckpoint):Record<string,{callKey:string;path:Array<string|number>;citation?:string}> {
 const index:Record<string,{callKey:string;path:Array<string|number>;citation?:string}>=Object.create(null);
 const groups={ideas:'idea',works:'work',passages:'passage',gaps:'gap',contradictions:'contradiction'} as const;
 for(const [callKey,call] of Object.entries(checkpoint.calls)){
  if(!callKey.startsWith('source:')||!call.output||typeof call.output!=='object')continue;
  const output=call.output as Record<string,unknown>;
  if(callKey==='source:study'&&Array.isArray(output.entries))output.entries.forEach((entry,position)=>{
   const route=entry.kind==='material'?'material':entry.kind==='document'?'doc':entry.kind==='transcript'?'recording':null;
   if(!route||typeof entry.sourceId!=='string')return;
   const id=route==='recording'?entry.location?.recordingId??entry.sourceId:entry.sourceId;
   index[`study:${route}:${id}`]??={callKey,path:['entries',position],citation:`nodus://study/${route}/${encodeURIComponent(id)}`};
  });
  if(callKey==='source:completeGuide'){
   const snapshot=(output.frozen as {snapshot?:CompleteGuideSnapshot}|undefined)?.snapshot;
   snapshot?.sources.forEach((source,position)=>{
    const passage=snapshot.passages.find(passage=>passage.sourceKey===source.sourceKey);if(!passage)return;
    const route=source.kind==='material'?'material':source.kind==='document'?'doc':'recording';
    const id=source.kind==='transcript'?source.recordingId??source.sourceId:source.sourceId;
    index[`study:${route}:${id}`]={callKey,path:['frozen','snapshot','sources',position],citation:citationUrl(source,passage.locator)};
   });
  }

  const containers:Array<{value:Record<string,unknown>;path:Array<string|number>;citation?:string}>= [{value:output,path:[]}];
  if(output.snapshot&&typeof output.snapshot==='object')containers.push({value:output.snapshot as Record<string,unknown>,path:['snapshot']});
  if(Array.isArray(output.sources))output.sources.forEach((row,position)=>{
   if(!row||typeof row!=='object')return;
   const citation=typeof row.url==='string'?row.url:typeof row.refId==='string'&&['document','work'].includes(row.kind)?`nodus://${row.kind==='document'?'archive':'work'}/${encodeURIComponent(row.refId)}`:undefined;
   if(!citation)return;
   try {const url=new URL(citation);if(url.protocol!=='nodus:')return;const identity=decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)??'');if(!identity)return;index[`${url.hostname}:${identity}`]??={callKey,path:['sources',position],citation};}catch{/* An invalid source locator is never indexed. */}
  });
  for(const container of containers)for(const [group,kind] of Object.entries(groups)){
   const rows=container.value[group];if(!Array.isArray(rows))continue;
   rows.forEach((row,position)=>{
    if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id)return;
    const key=`${kind}:${row.id}`;
    index[key]??={callKey,path:[...container.path,group,position]};
    if(kind==='contradiction')index[`debate:${row.id}`]??=index[key];
   });
  }
 }
 return index;
}

export interface MobileDeepResearchCover {model:ModelRef;style:import('./types').DecorativeImageStyle;context:string;prompt:string;bytes:string;mime:string}
export type MobileDeepResearchReport = DeepResearchReport & {mobileCover?:MobileDeepResearchCover};

export function mobileDeepResearchCoverMetadata(cover:MobileDeepResearchCover,id:string,createdAt:string):import('./types').DecorativeImage {
 return {entityKind:'deep_research',entityId:id,requested:true,status:'ready',provider:cover.model.provider==='gemini'?'google':cover.model.provider as 'openai'|'openrouter',model:cover.model.model,style:cover.style,visualContext:cover.context,prompt:cover.prompt,assetRef:null,mimeType:cover.mime,error:null,source:'ai',hasPrevious:false,createdAt,updatedAt:createdAt};
}
