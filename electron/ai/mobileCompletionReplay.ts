import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import type {ModelRef} from '../../shared/types';
export interface MobileCompletionPrompt {id:string;model:ModelRef;system:string;user:string;temperature?:number;maxTokens:number;format:'json'|'text';researchEffort?:string;reasoning?:string}
export type SourceEmbeddingMemo = (key:string,work:()=>Promise<number[]|null>)=>Promise<number[]|null>;
interface Scope {transcript?:string[];cursor:number;failure?:Error;embeddingMemo?:SourceEmbeddingMemo;active:boolean;binding:string;model:ModelRef;replies:Record<string,string>;counts:Map<string,number>;needed:MobileCompletionPrompt[]}
const scopes=new AsyncLocalStorage<Scope>();
class CompletionRequired extends Error {constructor(){super('mobile_completion_required');}}
export function hasMobileCompletionReplay():boolean {return scopes.getStore()!==undefined;}
/** The host exists only inside one authorized typed source stage. Late child work
 * is rejected after it closes; unrelated Desktop requests never see this scope. */
export async function withMobileCompletionReplay<T>(binding:string,model:ModelRef,replies:Record<string,string>,work:()=>Promise<T>,embeddingMemo?:SourceEmbeddingMemo,transcript?:string[]):Promise<{value?:T;completion?:MobileCompletionPrompt}> {
 const scope:Scope={transcript,cursor:0,embeddingMemo,active:true,binding,model,replies,counts:new Map(),needed:[]};
 return scopes.run(scope,async()=>{try {const value=await work();if(scope.failure)throw scope.failure;return scope.needed.length?{completion:scope.needed[0]}:{value};}
 catch(error){if(scope.failure)throw scope.failure;if(scope.needed.length)return {completion:scope.needed[0]};throw error;}
 finally {scope.active=false;}});
}
export function mobileCompletionReply(model:ModelRef,opts:{system:string;user:string;temperature?:number;maxTokens?:number;researchEffort?:string},jsonMode:boolean,reasoning:string):string|undefined {
 const scope=scopes.getStore();if(!scope)return undefined;
 if(!scope.active)throw new Error('mobile_completion_scope_closed');
 if(model.provider!==scope.model.provider||model.model!==scope.model.model)throw new Error('mobile_model_fallback_forbidden');
 const content={model:{provider:model.provider,model:model.model},system:opts.system,user:opts.user,temperature:opts.temperature,maxTokens:opts.maxTokens??8000,format:jsonMode?'json' as const:'text' as const,researchEffort:opts.researchEffort,reasoning};
 if(content.system.length+content.user.length>1_000_000)throw new Error('mobile_completion_prompt_too_large');
 const digest=createHash('sha256').update(canonicalJson([scope.binding,content])).digest('hex'),attempt=scope.counts.get(digest)??0;
 scope.counts.set(digest,attempt+1);const id=`${digest}:${attempt}`;
 if(scope.transcript&&scope.cursor<scope.transcript.length&&scope.transcript[scope.cursor]!==id){scope.failure=new Error("mobile_deep_research_transcript_changed");throw scope.failure;}
 if(Object.hasOwn(scope.replies,id)){scope.cursor++;return scope.replies[id];}
 scope.needed.push({id,...content});throw new CompletionRequired();
}

export async function memoizedMobileSourceEmbedding(input:unknown,work:()=>Promise<number[]|null>):Promise<number[]|null> {
 const scope=scopes.getStore();if(!scope)return work();
 if(!scope.active)throw new Error('mobile_completion_scope_closed');
 if(!scope.embeddingMemo)throw new Error('mobile_query_embedding_memo_missing');
 const key=createHash('sha256').update(canonicalJson([scope.binding,input])).digest('hex');
 return scope.embeddingMemo(key,work);
}
