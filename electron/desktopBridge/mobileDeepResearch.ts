import {getDocumentaryPassageDetail} from '../citations/documentaryCitations';
import {getScopedLegacyPassageDetail} from '../citations/scopedLegacyCitations';
import {effectiveEmbeddingConfig} from '../ai/aiClient';
import {resolveAcademicRunScope} from '../ai/researchCorpusRun';
import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {buildIdeaFirstWritingWorkshopSnapshot,buildHistoricalWritingWorkshopSnapshot,retrieveSectionMaterial,retrieveSectionMaterialLegacy} from '../ai/writingWorkshop';
import {academicRelationshipContext} from '../ai/deepResearchApproaches';
import {companionCanonicalDeepResearchDeps} from '../ai/deepResearch';
import {withJobOutputLanguage} from '../ai/jobOutputLanguage';
import {withJobThinkingEffort} from '../ai/thinkingEffort';
import {withMobileCompletionReplay} from '../ai/mobileCompletionReplay';
import {prepareRelevantDocumentProfiles} from '../ai/documentPreparation';
import {getWritingWorkshopDraft,saveWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {canonicalJson} from '../../shared/canonicalJson';
import {normalizeMobileDeepResearchRequest,assertMobileDeepResearchSource,type MobileDeepResearchProof,type MobileDeepResearchSource} from '../../shared/mobileDeepResearch';
import type {DeepResearchReport,DeepResearchRequest,WritingWorkshopBrief} from '../../shared/types';
import type {SectionRetrievalInput,PlanEvidencePreparationInput} from '../ai/deepResearchCore';
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** Corpus source revision excludes derived indexes/profiles and their status.
 * It includes actual authored graph content and authoritative work text identity. */
export function mobileDeepResearchCorpusRevision(request?:DeepResearchRequest):string {
 const db=getDb(),digest=createHash('sha256');
 for(const table of ['works','ideas','themes','gaps','edges']){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const rows=db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[];
  const source=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!/^deep_|^embedding|^updated_at$|^last_|^document_profile|^resolved_text_cached|^read_tag$|^read_at$|^created_at$/.test(key)))).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
  digest.update(canonicalJson([table,source]));
 }
 const scope=resolveAcademicRunScope(request?.notebookId);
 digest.update(canonicalJson(effectiveEmbeddingConfig()));
 digest.update(canonicalJson({scopeId:scope.id,notebookId:scope.notebookId,notebookRevision:scope.notebookRevision,permissionFingerprint:scope.permissionFingerprint,documents:scope.documents.map(item=>({id:item.id,revision:item.revision})).sort((a,b)=>a.id.localeCompare(b.id))}));
 return digest.digest('hex');
}
const STAGES = ['snapshot','section','researchTraversal','auditFactualProse','auditReportConsistency','repairSectionCoverage','checkSectionCoverage','planReport','writeSection','finalize','auditFinalSummary','decomposeObjective','auditPlanCoverage','auditSectionClaims','reviseSection','verifyCitations','checkCoherence'] as const;
type Stage = typeof STAGES[number];
type StageInput = {stage:Stage;input:unknown};
export async function mobileDeepResearchSource(raw:unknown,signal?:AbortSignal):Promise<unknown> {
 const value=raw as {request:DeepResearchRequest;generationId:string;expectedVaultId?:string;expectedRevision?:string;stage:Stage;input:any;history:StageInput[];replies:Record<string,string>};
 if(!value||Object.keys(value).some(key=>!['request','generationId','expectedVaultId','expectedRevision','stage','input','history','replies'].includes(key))||!STAGES.includes(value.stage)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.generationId)||!Array.isArray(value.history)||value.history.length>256||!value.replies||typeof value.replies!=='object'||Array.isArray(value.replies)||Object.entries(value.replies).some(([key,reply])=>!/^[a-f0-9]{64}:\d+$/.test(key)||typeof reply!=='string'||reply.length>1_000_000)||Buffer.byteLength(JSON.stringify(value))>32*1024*1024)throw new Error('invalid_deep_research_source_request');
 const request=normalizeMobileDeepResearchRequest(value.request),vault=getActiveVault();
 if(value.expectedVaultId!=null&&value.expectedVaultId!==vault.id)throw new Error('deep_research_source_scope_conflict');
 if(value.expectedRevision!=null&&value.expectedRevision!==mobileDeepResearchCorpusRevision(request))throw new Error('deep_research_source_conflict');
 for(const entry of [...value.history,{stage:value.stage,input:value.input}]){
  if(!entry||!STAGES.includes(entry.stage)||Object.keys(entry).some(key=>!['stage','input'].includes(key)))throw new Error('invalid_deep_research_source_stage');
  const objective=(entry.input as {objective?:unknown}|null)?.objective;
  if(objective!=null&&objective!==request.objective)throw new Error('deep_research_request_binding_conflict');
 }
 signal?.throwIfAborted();
 const binding=hash([vault.id,request,value.generationId]);
 const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS mobile_deep_research_query_vectors(binding TEXT NOT NULL,query_hash TEXT NOT NULL,vector_json TEXT NOT NULL,PRIMARY KEY(binding,query_hash))');
 const queryMemo=async(key:string,work:()=>Promise<number[]|null>)=>{
  const row=db.prepare('SELECT vector_json FROM mobile_deep_research_query_vectors WHERE binding=? AND query_hash=?').get(binding,key) as {vector_json:string}|undefined;
  if(row)return JSON.parse(row.vector_json) as number[]|null;
  const vector=await work();signal?.throwIfAborted();
  if(vector!==null&&(!Array.isArray(vector)||vector.length>65536||vector.some(item=>!Number.isFinite(item))))throw new Error('invalid_mobile_query_vector');
  db.prepare('INSERT OR IGNORE INTO mobile_deep_research_query_vectors VALUES(?,?,?)').run(binding,key,JSON.stringify(vector));
  return vector;
 };
 const replay=await withMobileCompletionReplay(binding,request.model!,value.replies,()=>withJobOutputLanguage(request.language,()=>withJobThinkingEffort(request.thinkingEffort,request.model,async()=>{
  const deps=companionCanonicalDeepResearchDeps(request,signal);
  async function stage(entry:StageInput):Promise<unknown>{
   signal?.throwIfAborted();
   if(entry.stage==='snapshot'){
    const input=entry.input as {brief:WritingWorkshopBrief};
    if(input?.brief?.kind!=='deep_research'||input.brief.objective!==request.objective)throw new Error('invalid_deep_research_snapshot');
    const snapshot=await deps.buildSnapshot(input.brief);
    return {version:1,vaultId:vault.id,vaultType:vault.type,revision:mobileDeepResearchCorpusRevision(request),snapshot,relationships:academicRelationshipContext(snapshot),sourceScope:'linked_corpus',queryEmbeddingModel:{provider:effectiveEmbeddingConfig().provider,model:effectiveEmbeddingConfig().modelId},preparedSourcesOnly:true} satisfies MobileDeepResearchSource;
   }
   if(entry.stage==='section')return deps.retrieveForSection!(entry.input as SectionRetrievalInput);
   const operation=deps[entry.stage as keyof typeof deps];
   if(typeof operation!=='function')throw new Error('deep_research_stage_not_available');
   const args=Array.isArray(entry.input)?entry.input:[entry.input];
   return (operation as (...args:any[])=>Promise<unknown>)(...args);
  }
  for(const entry of value.history)await stage(entry);
  return stage({stage:value.stage,input:value.input});
 },signal)),queryMemo);
 return replay.completion?{version:1,completion:replay.completion}:{version:1,value:replay.value};
}
export function saveMobileDeepResearchReport(raw:unknown,deviceGrant:string,signal?:AbortSignal) {
 const input=raw as {request:DeepResearchRequest;source:MobileDeepResearchProof;report:DeepResearchReport;requestId:string};
 if(!input||Object.keys(input).some(key=>!['request','source','report','requestId'].includes(key))||typeof deviceGrant!=='string'||!deviceGrant||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)||Buffer.byteLength(JSON.stringify(input))>32*1024*1024)throw new Error('invalid_deep_research_publication');
 const request=normalizeMobileDeepResearchRequest(input.request);
 if(input.source?.version!==1||typeof input.source.vaultId!=="string"||!input.source.vaultId||!/^[a-f0-9]{64}$/.test(input.source.revision)||!["linked_corpus","device_downloads"].includes(input.source.sourceScope))throw new Error("invalid_deep_research_source_proof");
 const report=input.report;
 if(!report?.draft||report.draft.brief?.kind!=='deep_research'||report.draft.brief.objective!==request.objective||typeof report.draft.draftMarkdown!=='string'||!report.draft.draftMarkdown.trim()||!Array.isArray(report.draft.bibliography)||!report.meta)throw new Error('invalid_deep_research_report');
 const db=getDb(),fingerprint=hash(input);
 db.exec('CREATE TABLE IF NOT EXISTS mobile_deep_research_publications(device_grant TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(device_grant,request_id))');
 return db.transaction(()=>{
  const receipt=db.prepare('SELECT payload_hash,result_json FROM mobile_deep_research_publications WHERE device_grant=? AND request_id=?').get(deviceGrant,input.requestId) as {payload_hash:string;result_json:string}|undefined;
  if(receipt){if(receipt.payload_hash!==fingerprint)throw new Error('idempotency_conflict');return JSON.parse(receipt.result_json);}
  signal?.throwIfAborted();if(input.source.vaultId!==getActiveVault().id||input.source.vaultType!==getActiveVault().type)throw new Error('deep_research_source_scope_conflict');
  if(input.source.revision!==mobileDeepResearchCorpusRevision(request))throw new Error('deep_research_source_conflict');
  for(const match of report.draft.draftMarkdown.matchAll(/\(nodus:\/\/(idea|work|passage)\/([^\s)]+)\)/g)) {
    let id:string;try{id=decodeURIComponent(match[2]);}catch{throw new Error('invalid_deep_research_citation');}
    const table=match[1]==='idea'?'ideas':match[1]==='work'?'works':'passages',column=match[1]==='idea'?'global_id':match[1]==='work'?'nodus_id':'passage_id';
    const scoped=match[1]==='passage'&&(id.startsWith('documentary:')?getDocumentaryPassageDetail(id):id.startsWith('scoped:')?getScopedLegacyPassageDetail(id):null);
    const globalWork=match[1]==='work'&&resolveAcademicRunScope(request.notebookId).documents.some(document=>document.workId===id);
    if(!scoped&&!globalWork&&!db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id))throw new Error('deep_research_citation_source_missing');
  }
  if(getWritingWorkshopDraft(input.requestId))throw new Error('deep_research_identity_conflict');
  const draft={...report.draft,generationModel:request.model,mobileGenerationReceipt:{requestId:input.requestId,inputHash:fingerprint,sourceScope:input.source.sourceScope}};
  const result=saveWritingWorkshopDraft({draft,model:request.model},input.requestId);
  db.prepare('INSERT INTO mobile_deep_research_publications VALUES(?,?,?,?)').run(deviceGrant,input.requestId,fingerprint,JSON.stringify(result));return result;
 })();
}
