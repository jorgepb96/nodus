import {retrieveDocumentary,type DocumentaryRetrievalPassage} from './documentaryRetrieval';
import type {MobileAcademicResearchSource} from './mobileAcademicResearch';
import type {ResearchDocumentRead,ResolvedResearchScope,RetrievalSettings} from './researchCorpus';
/** FTS-style lexical ranking over the actual copied scope. No semantic vector
 * from another provider, index creation, source discovery or live lookup. */
const words=(text:string):string[]=>text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
export function capturedAcademicRetrieval(source:MobileAcademicResearchSource) {
 const rows=source.passages.map(passage=>({id:passage.id,document_id:passage.documentId,index_key:passage.indexKey,text:passage.text,locator_json:JSON.stringify(passage.locator)})),raw=new Map(source.passages.map(passage=>[passage.id,passage]));
 const tokens=new Map(rows.map(row=>[row.id,words(row.text)])),average=rows.reduce((sum,row)=>sum+tokens.get(row.id)!.length,0)/Math.max(1,rows.length);
 const lexicalSearch=(query:string,keys:string[],limit:number):DocumentaryRetrievalPassage[]=>{
  const terms=[...new Set(words(query))].slice(0,32),allowed=new Set(keys);if(!terms.length)return [];
  const frequencies=new Map(terms.map(term=>[term,rows.filter(row=>tokens.get(row.id)!.includes(term)).length]));
  return rows.filter(row=>allowed.has(row.index_key)).map(row=>{const list=tokens.get(row.id)!;return {row,score:terms.reduce((score,term)=>{const count=list.filter(word=>word===term).length;if(!count)return score;const matches=frequencies.get(term)!,idf=Math.max(0.000001,Math.log((rows.length-matches+0.5)/(matches+0.5)));return score+idf*count*2.2/(count+1.2*(0.25+0.75*list.length/Math.max(1,average)));},0)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.row.id.localeCompare(b.row.id)).slice(0,limit).map(item=>item.row);
 };
 return async(scope:ResolvedResearchScope,query:string,settings:RetrievalSettings,_vector:number[]|null,signal?:AbortSignal,read?:ResearchDocumentRead)=>{
  signal?.throwIfAborted();if(scope.id!==source.scope.id||scope.vaultId!==source.context.vaultId||scope.documents.some(document=>!source.scope.documents.some(owned=>owned.id===document.id&&owned.revision===document.revision&&owned.permissionRevision===document.permissionRevision)))throw new Error('research_source_not_authorized');
  const documentIds=new Set(scope.documents.map(document=>document.id)),keys=[...new Set(source.passages.filter(passage=>documentIds.has(passage.documentId)).map(passage=>passage.indexKey))];
  const result=retrieveDocumentary({query,lexicalKeys:keys,vectorKeys:[],vector:null,settings,threshold:-1,read},{lexicalSearch,semanticSearch:()=>[],adjacentPassages:(id,indexKeys,radius=1)=>{const origin=raw.get(id),allowed=new Set(indexKeys);return !origin?[]:rows.filter(row=>row.index_key===origin.indexKey&&allowed.has(row.index_key)&&Math.abs(raw.get(row.id)!.ordinal-origin.ordinal)<=radius).sort((a,b)=>raw.get(a.id)!.ordinal-raw.get(b.id)!.ordinal);},physicalPages:(indexKeys,from,to,limit,attachmentId)=>{const allowed=new Set(indexKeys);return rows.filter(row=>{const item=raw.get(row.id)!;return allowed.has(row.index_key)&&item.locator.pageNumber!==null&&item.locator.pageNumber<=to&&(item.locator.pageEnd??item.locator.pageNumber)>=from&&(!attachmentId||item.attachmentId===attachmentId);}).sort((a,b)=>a.index_key.localeCompare(b.index_key)||raw.get(a.id)!.ordinal-raw.get(b.id)!.ordinal).slice(0,limit);}});
  signal?.throwIfAborted();return {evidence:result.passages.map(row=>raw.get(row.id)!),traversal:{...result.traversal,partial:result.traversal.partial||scope.documents.some(document=>!source.passages.some(passage=>passage.documentId===document.id)||document.indexedSource&&document.indexedSource.revision!==document.revision)}};
 };
}
