import type {DeepResearchRequest,DeepResearchReport,WritingWorkshopSnapshot,DeepResearchProgress,ModelRef} from './types';
import {canonicalJson} from './canonicalJson';
import {parseDeepResearchRequestVersion} from './deepResearchVersions';
import {normalizeDeepResearchApproach} from './deepResearchApproaches';
import {normalizeDeepResearchSectionLength} from './deepResearchSectionLength';
import {PROMPT_LANGUAGES} from './types';

export interface MobileDeepResearchSource {
 version:1;vaultId:string;vaultType:string;revision:string;snapshot:WritingWorkshopSnapshot;
 relationships:Array<{from:string;relation:string;to:string;confidence:number}>;
 /** Captured sources identify the actual consulted corpus, never an invented mirror. */
 queryEmbeddingModel?:{provider:string;model:string};preparedSourcesOnly?:boolean;
 sourceScope:'linked_corpus'|'device_downloads';
}
export type MobileDeepResearchProof = Pick<MobileDeepResearchSource,"version"|"vaultId"|"vaultType"|"revision"|"sourceScope"|"queryEmbeddingModel"|"preparedSourcesOnly">;
export interface MobileDeepResearchCheckpoint {
 id:string;entityKey:string;request:DeepResearchRequest;state:'accepted'|'running'|'saved'|'available'|'failed'|'cancelled';createdAt:string;
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
 return {...request,objective:request.objective.trim(),deepResearchVersion:parseDeepResearchRequestVersion(request.deepResearchVersion),approach:normalizeDeepResearchApproach(request.approach),sectionLength:normalizeDeepResearchSectionLength(request.sectionLength)};
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
   const recovered=await options.recover();if(recovered!==undefined){checkpoint.calls[key]={input:canonical,output:structuredClone(recovered)};delete checkpoint.inflight;await persist();return recovered;}
  }
  throw new Error('mobile_paid_response_uncertain');
 }
 if(options?.paid){checkpoint.inflight={key,input:canonical,request:structuredClone(options.request),createdAt:new Date().toISOString()};await persist();}
 const output=await invoke();checkpoint.calls[key]={input:canonical,output:structuredClone(output)};if(checkpoint.inflight?.key===key)delete checkpoint.inflight;await persist();return output;
}
export interface MobileDeepResearchCompletion {system:string;user:string;temperature?:number;maxTokens?:number;model?:ModelRef|null;format:'json'|'text'}
