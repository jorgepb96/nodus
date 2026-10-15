import {decodeWebText} from '@shared/webTextDecoding';
import {runWebResearch,type WebResearchDeps} from '../../electron/websearch/webResearch';
import {extractHtmlPage,extractTextPage} from '../../electron/websearch/webPageExtract';
import {PLAN_SYSTEM,REFORMULATE_SYSTEM,PICK_SYSTEM,RATE_SYSTEM,validPlan,validQueries,validPick,validRatings} from '../../electron/websearch/webPlanning';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {CompleteGuideDeps} from '../../electron/ai/completeGuide/core';
type Call=(method:string,...args:any[])=>Promise<any>;
export async function mobileCompleteGuideWebText(call:Call,endpoint:string,input:Parameters<NonNullable<CompleteGuideDeps['web']>>[0],json:CompleteGuideDeps['json'],embed:CompleteGuideDeps['embed'],signal:AbortSignal) {
 const search=new URL(endpoint);if(search.protocol!=='https:'||search.username||search.password)throw new Error('invalid_mobile_search_endpoint');
 const question=`${input.unit}${input.terms.length?`: ${input.terms.join(', ')}`:''}`.slice(0,600);
 const model=<T>(system:string,user:unknown,maxTokens:number,validate:(value:unknown)=>value is T)=>json({stage:'web',system,user:JSON.stringify(user),maxTokens,temperature:0,mechanical:true,validate});
 const deps:WebResearchDeps={
  search:async(query,category)=>{const url=new URL(search);url.searchParams.set('q',query);url.searchParams.set('categories',category);url.searchParams.set('format','json');const result=await call('mobilePublicWebResource',url.href,'json');if(!Array.isArray(result.results))throw new Error('invalid_mobile_search_response');return {results:result.results,unresponsive:result.unresponsive_engines??[]};},
  fetchPage:async url=>{const page=await call('mobilePublicWebResource',url,'page');if(typeof page.bodyBytes==='string')page.body=decodeWebText(Uint8Array.from(atob(page.bodyBytes),character=>character.charCodeAt(0)),page.contentType??'');if(typeof page.body!=='string')throw new Error('invalid_mobile_web_page');return page;},
  extract:async page=>page.kind==='text'?extractTextPage(String(page.body),page.finalUrl):extractHtmlPage(String(page.body),page.finalUrl),
  planQueries:input=>model(PLAN_SYSTEM,{...input,requested:input.count},400,validPlan),
  reformulate:async input=>(await model(REFORMULATE_SYSTEM,{...input,requested:input.count},300,validQueries)).queries,
  pickResults:async input=>(await model(PICK_SYSTEM,input,120,validPick)).read,
  ratePassages:async input=>(await model(RATE_SYSTEM,input,60+input.passages.length*16,validRatings)).ratings,
  ...(embed?{embed:async texts=>{const vectors=await embed(texts);return vectors.every(Array.isArray)?vectors as number[][]:null;}}:{}),now:()=>Date.now(),
 };
 const result=await runWebResearch({question,depth:'fast',hint:[input.unit,...input.terms.slice(0,2).map(term=>`${input.unit} ${term}`)],intent:'expand',library:input.sections.join(' | '),evidenceBytes:12000,signal,activity:{start:()=>()=>{}}},deps);
 if(result.reason==='unavailable')throw new Error('web_unavailable');
 return {passages:result.evidence.map(item=>({id:`web:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([item.finalUrl,item.pageNumber,item.text]))))}`,title:item.title,site:item.siteName??item.domain,url:item.url,text:item.text,retrievedAt:item.retrievedAt,record:item}))};
}
