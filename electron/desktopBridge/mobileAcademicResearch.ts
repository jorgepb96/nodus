import fs from 'node:fs';
import {recordScopedLegacyPassage,insertScopedReceipts,type ScopedReceiptRow} from '../citations/scopedLegacyCitations';
import {getActiveVault} from '../vaults/vaultRegistry';
import {app} from 'electron';
import path from 'node:path';
import {DocumentaryStore} from '../db/documentaryStore';
import {getDb} from '../db/database';
import {getSettings} from '../db/settingsRepo';
import {getResearchNotebook} from '../db/researchNotebooksRepo';
import {activeManualIdeaIds} from '../db/manualIdeaVisibility';
import {resolveResearchSourceScope} from '../ai/researchSourceScope';
import {resolveAcademicRunScope,scopedResearchGraph} from '../ai/researchCorpusRun';
import {ResearchRetrievalBudget} from '../../shared/researchRetrievalBudget';
import {RETRIEVAL_PRESETS,validateRetrievalSettings,type DocumentPreparationState,type DocumentaryIndexIdentity} from '../../shared/researchCorpus';
import type {DeepResearchRequest,WritingWorkshopIdeaCandidate} from '../../shared/types';
import type {AcademicResearchCapture} from '../../shared/mobileAcademicResearch';
/** Freeze already-published chunks through a read-only store. This has no
 * extraction worker, index writer, embedder, original fetch or model endpoint. */
export function captureAcademicResearchSource(request:DeepResearchRequest):AcademicResearchCapture {
 const scope=resolveAcademicRunScope(request.notebookId),settings=validateRetrievalSettings(request.retrieval??(request.notebookId?getResearchNotebook(request.notebookId)?.settings:undefined)??RETRIEVAL_PRESETS.deep),db=getDb();
 const filename=path.join(app.getPath('userData'),'documentary','store.sqlite'),store=fs.existsSync(filename)?new DocumentaryStore(filename,true):null;
 try {
  const passages:AcademicResearchCapture['passages']=[],legacyPassages:AcademicResearchCapture['legacyPassages']=[],pending:ScopedReceiptRow[]=[],preparation:DocumentPreparationState[]=[];let bytes=0;
  const charge=(value:unknown)=>{bytes+=Buffer.byteLength(JSON.stringify(value));if(bytes>15_000_000)throw new Error('academic_research_source_too_large');};
  for(const document of scope.documents){
   const revisions=store?.revisionsOf([document.id]).get(document.id)??[];
   const published=new Set(document.indexedSource?.indexKeys??[]);
   const allowed=revisions.filter(row=>row.lexical_ready&&(published.size?published.has(row.index_key):row.revision===document.revision)),groups=new Map<string,typeof allowed>();
   for(const row of allowed){const identity=JSON.parse(row.identity_json) as DocumentaryIndexIdentity,key=identity.attachmentId??'';groups.set(key,[...(groups.get(key)??[]),row]);}
   const chosen=[...groups.values()].map(rows=>rows.find(row=>!row.embedding_ready)??rows[0]);
   const identities=new Map(chosen.map(row=>[row.index_key,JSON.parse(row.identity_json) as DocumentaryIndexIdentity]));
   let count=0,embedded=0;
   for(const raw of (store?.db.prepare('SELECT id,index_key,ordinal,text,locator_json FROM documentary_passages WHERE document_id=? AND index_key IN (SELECT value FROM json_each(?)) ORDER BY index_key,ordinal').iterate(document.id,JSON.stringify([...identities.keys()]))??[]) as Iterable<{id:string;index_key:string;ordinal:number;text:string;locator_json:string}>){
    const identity=identities.get(raw.index_key)!;const item:AcademicResearchCapture['passages'][number]={id:raw.id,indexKey:raw.index_key,ordinal:raw.ordinal,documentId:document.id,workId:document.workId,attachmentId:identity.attachmentId,attachmentRevision:identity.attachmentRevision,revision:identity.revision,text:raw.text,locator:JSON.parse(raw.locator_json),provenance:document.authoredKind??((identity.coverage??document.coverage)==='abstract'?'abstract':'source'),limitations:[...(identity.revision!==document.revision?['previous_indexed_revision']:[]),...(document.authoredKind?[document.authoredKind,'not_primary_evidence']:(identity.coverage??document.coverage)==='abstract'?['abstract_only']:[]),...(document.sourceWarning?[document.sourceWarning]:[])]};charge(item);passages.push(item);count++;if(chosen.find(row=>row.index_key===raw.index_key)?.embedding_ready)embedded++;
   }
   preparation.push({documentId:document.id,revision:document.revision,text:count?(document.coverage==='abstract'?'abstract':'available'):'missing',lexical:count?(chosen.some(row=>row.revision!==document.revision)?'stale':'ready'):'missing',embeddings:count&&embedded===count?'ready':embedded?'partial':'missing',status:count?'ready':'catalogued',reason:null,error:null,passages:count,embedded});
  }
  const allowedWorks=scope.documents.flatMap(document=>document.workId?[document.workId]:[]);
  for(const raw of db.prepare('SELECT passage_id FROM passages WHERE nodus_id IN (SELECT value FROM json_each(?)) ORDER BY nodus_id,chunk_index,passage_id').iterate(JSON.stringify(allowedWorks)) as Iterable<{passage_id:string}>){
   const receipt=recordScopedLegacyPassage(scope,raw.passage_id,scope.documents,pending);if(!receipt)continue;
   const hit={passage_id:raw.passage_id,nodus_id:receipt.nodus_id,text:receipt.text,page_label:receipt.page_label,source_ref:receipt.source_ref,page_number:receipt.page_number,similarity:0,title:receipt.work.title,authors_json:JSON.stringify(receipt.work.authors),year:receipt.work.year,zotero_key:receipt.work.zotero_key,lanes:['lexical' as const]};const item={hit,receipt};charge(item);legacyPassages.push(item);
  }
  insertScopedReceipts(pending);
  if(!passages.length&&!legacyPassages.length)throw new Error('academic_research_prepared_sources_missing');
  const workIds=scope.documents.filter(document=>!document.indexedSource||document.indexedSource.revision===document.revision).flatMap(document=>document.workId?[document.workId]:[]),manual=getSettings().academicMode==='manual'?activeManualIdeaIds(db):null;
  const ideaIds=[...resolveResearchSourceScope({enabled:true,authorIds:[],workIds},true)!.ideaIds].filter(id=>!manual||manual.has(id)),ideas:WritingWorkshopIdeaCandidate[]=[];
  for(const row of db.prepare('SELECT global_id,type,label,statement FROM ideas WHERE global_id IN (SELECT value FROM json_each(?)) ORDER BY global_id').iterate(JSON.stringify(ideaIds)) as Iterable<{global_id:string;type:WritingWorkshopIdeaCandidate['type'];label:string;statement:string|null}>){
   const ids=db.prepare('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id=?').all(row.global_id) as Array<{nodus_id:string}>,documents=scope.documents.filter(document=>ids.some(id=>id.nodus_id===document.workId));
   const idea:WritingWorkshopIdeaCandidate={id:row.global_id,label:row.label,summary:row.statement??row.label,statement:row.statement??row.label,type:row.type,themes:[],score:0,reason:'scoped-idea',workCount:documents.length,evidenceCount:0,works:documents.map(document=>({nodus_id:document.workId!,title:document.title,authors:document.authors,year:document.year,zotero_key:document.origin.kind==='zotero'?document.origin.itemKey:''}))};charge(idea);ideas.push(idea);
  }
  const graph=scopedResearchGraph(scope,workIds,ideaIds,new ResearchRetrievalBudget({...settings,evidenceTokens:64000,passagesPerRound:Math.min(100,settings.candidates)}),new Set());
  const relationships=(db.prepare(`SELECT a.label from_label,e.type,b.label to_label,e.confidence FROM visible_edges e JOIN ideas a ON a.global_id=e.from_id JOIN ideas b ON b.global_id=e.to_id WHERE e.from_id IN (SELECT value FROM json_each(?)) AND e.to_id IN (SELECT value FROM json_each(?)) ORDER BY e.confidence DESC,e.id LIMIT 80`).all(JSON.stringify(ideaIds),JSON.stringify(ideaIds)) as Array<{from_label:string;type:string;to_label:string;confidence:number}>).map(row=>({from:row.from_label,relation:row.type,to:row.to_label,confidence:row.confidence}));
  const title=request.notebookId?getResearchNotebook(request.notebookId)!.name:getActiveVault().name;
  const result={title,scope,settings,passages,legacyPassages,ideas,graph,relationships,preparation};charge({scope,graph,relationships,preparation});return result;
 }finally{store?.close();}
}
