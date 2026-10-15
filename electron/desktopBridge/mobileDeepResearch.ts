import {validateMobileResearchVisuals,publishMobileResearchVisuals} from './mobileResearchVisuals';
import {captureAcademicResearchSource} from './mobileAcademicResearch';
import {captureMobileAcademicResearchSource} from '../../shared/mobileAcademicResearch';
import {captureGenealogyResearchSource} from '../ai/genealogyDeepResearch';
import {captureMobileGenealogyResearchSource} from '../../shared/mobileGenealogyResearch';
import {getMobileStudyResearchSourcePack} from '../ai/studySearch';
import {mobileDeepResearchCorpusRevision} from './mobileResearchRevision';
import {prepareImageStorage} from '../imageStorage';
import {markDecorativeImagePending,saveDecorativeImagePrompt,saveDecorativeImageReady} from '../db/decorativeImagesRepo';
import {buildDecorativeImagePrompt} from '../../shared/imageStyles';
import {vaultTypeImagePrompt} from '../../shared/vaultTypes';
import {getWebPassage,recordWebPassage,type WebPassageRecord} from '../db/researchWebRepo';
import {saveCompleteGuideArtifacts} from '../db/completeGuideRepo';
import {seedCompleteGuideFigures} from '../ai/completeGuide/figures';
import {captureMobileCompleteGuide} from './mobileCompleteGuide';
import {getDocumentaryPassageDetail} from '../citations/documentaryCitations';
import {getScopedLegacyPassageDetail} from '../citations/scopedLegacyCitations';
import {effectiveEmbeddingConfig} from '../ai/aiClient';
import {resolveAcademicRunScope} from '../ai/researchCorpusRun';
import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';

import {academicRelationshipContext} from '../ai/deepResearchApproaches';
import {companionCanonicalDeepResearchDeps,generateDeepResearchReport} from '../ai/deepResearch';
import {withJobOutputLanguage} from '../ai/jobOutputLanguage';
import {withJobThinkingEffort} from '../ai/thinkingEffort';
import {withMobileCompletionReplay} from '../ai/mobileCompletionReplay';

import {getWritingWorkshopDraft,saveWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {canonicalJson} from '../../shared/canonicalJson';
import { normalizeMobileDeepResearchRequest, type MobileDeepResearchProof, type MobileDeepResearchSource,type MobileDeepResearchReport } from '../../shared/mobileDeepResearch';
import type {DeepResearchReport,DeepResearchRequest,WritingWorkshopBrief,DeepResearchProgress} from '../../shared/types';
import type { SectionRetrievalInput } from '../ai/deepResearchCore';
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export {mobileDeepResearchCorpusRevision} from './mobileResearchRevision';
const STAGES = ['academicSnapshot','genealogySnapshot','studySnapshot','guideSnapshot','describe','variantRun','snapshot','section','researchTraversal','auditFactualProse','auditReportConsistency','repairSectionCoverage','checkSectionCoverage','planReport','writeSection','finalize','auditFinalSummary','decomposeObjective','auditPlanCoverage','auditSectionClaims','reviseSection','verifyCitations','checkCoherence'] as const;
type Stage = typeof STAGES[number];
type StageInput = {stage:Stage;input:unknown};
export async function mobileDeepResearchSource(raw:unknown,signal?:AbortSignal):Promise<unknown> {
 const value=raw as {request:DeepResearchRequest;generationId:string;expectedVaultId?:string;expectedRevision?:string;stage:Stage;input:any;history:StageInput[];transcript?:string[];replies:Record<string,string>};
 if(!value||Object.keys(value).some(key=>!['request','generationId','expectedVaultId','expectedRevision','stage','input','history','replies','transcript'].includes(key))||!STAGES.includes(value.stage)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.generationId)||(value.transcript!==undefined&&(!Array.isArray(value.transcript)||value.transcript.length>4096||value.transcript.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}:\d+$/.test(id))))||!Array.isArray(value.history)||value.history.length>256||!value.replies||typeof value.replies!=='object'||Array.isArray(value.replies)||Object.entries(value.replies).some(([key,reply])=>!/^[a-f0-9]{64}:\d+$/.test(key)||typeof reply!=='string'||reply.length>1_000_000)||Buffer.byteLength(JSON.stringify(value))>32*1024*1024)throw new Error('invalid_deep_research_source_request');
 const request=normalizeMobileDeepResearchRequest(value.request),vault=getActiveVault();
 if(value.expectedVaultId!=null&&value.expectedVaultId!==vault.id)throw new Error('deep_research_source_scope_conflict');
 if(value.expectedRevision!=null&&value.expectedRevision!==mobileDeepResearchCorpusRevision(request))throw new Error('deep_research_source_conflict');
 if(value.stage==='academicSnapshot'){if(value.history.length||Object.keys(value.replies).length||vault.type!=='academic'||request.completeGuide||request.studyMode||request.unitMode)throw new Error('invalid_academic_research_source');const revision=mobileDeepResearchCorpusRevision(request),capture=captureAcademicResearchSource(request);if(mobileDeepResearchCorpusRevision(request)!==revision)throw new Error('deep_research_source_conflict');return {version:1,value:captureMobileAcademicResearchSource(capture,{version:1,vaultId:vault.id,vaultType:vault.type,revision,sourceScope:'linked_corpus',preparedSourcesOnly:true})};}
 if(value.stage==='genealogySnapshot'){if(value.history.length||Object.keys(value.replies).length||vault.type!=='genealogy')throw new Error('invalid_genealogy_research_source');const revision=mobileDeepResearchCorpusRevision(request),capture=captureGenealogyResearchSource(request);if(mobileDeepResearchCorpusRevision(request)!==revision)throw new Error('deep_research_source_conflict');return {version:1,value:captureMobileGenealogyResearchSource(capture,{version:1,vaultId:vault.id,vaultType:vault.type,revision,sourceScope:'linked_corpus',preparedSourcesOnly:true})};}
 if(value.stage==='studySnapshot'){if(value.history.length||Object.keys(value.replies).length||!['estudio','docencia'].includes(vault.type))throw new Error('invalid_study_research_source');return {version:1,value:getMobileStudyResearchSourcePack(request.objective)};}
 if(value.stage==='guideSnapshot'){if(value.history.length||Object.keys(value.replies).length)throw new Error('invalid_complete_guide_source');return {version:1,value:await captureMobileCompleteGuide(request,mobileDeepResearchCorpusRevision(request),signal)};}

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
 let progress:DeepResearchProgress|undefined;
 const replay=await withMobileCompletionReplay(binding,request.model!,value.replies,()=>withJobOutputLanguage(request.language,()=>withJobThinkingEffort(request.thinkingEffort,request.model,async()=>{
  const deps=vault.type==='academic'?companionCanonicalDeepResearchDeps(request,signal):null;
  async function stage(entry:StageInput):Promise<unknown>{
   signal?.throwIfAborted();
   if(entry.stage==='describe')return {variant:vault.type==='academic'?'academic':request.completeGuide?'completeGuide':vault.type==='docencia'||request.unitMode?'unit':vault.type==='estudio'||request.studyMode?'study':vault.type==='genealogy'?'genealogy':'academic',context:{version:1,vaultId:vault.id,vaultType:vault.type,revision:mobileDeepResearchCorpusRevision(request),sourceScope:'linked_corpus',queryEmbeddingModel:{provider:effectiveEmbeddingConfig().provider,model:effectiveEmbeddingConfig().modelId},preparedSourcesOnly:true}};
   if(entry.stage==='variantRun'){
    if(vault.type==='academic'||request.completeGuide)throw new Error('mobile_deep_research_variant_stage_invalid');
    let sources:unknown[]=[],knowledge:unknown;
    const report=await generateDeepResearchReport(request,value=>{progress=value;},signal,{sourceOnly:true,onSources:(captured,facts)=>{sources=structuredClone(captured);knowledge=structuredClone(facts);},onWorkText:(id,text)=>{for(const source of sources as Array<{refId?:string;fullText?:string}>){if(source.refId===id)source.fullText=text;}}});
    return {report,sources,knowledge};
   }
   if(!deps)throw new Error('mobile_deep_research_stage_variant_conflict');
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
 },signal)),queryMemo,value.transcript);
 return replay.completion?{version:1,completion:replay.completion,progress}:{version:1,value:replay.value,progress};
}
export function saveMobileDeepResearchReport(raw:unknown,deviceGrant:string,signal?:AbortSignal) {
 const input=raw as {request:DeepResearchRequest;source:MobileDeepResearchProof;report:DeepResearchReport;requestId:string};
 if(!input||Object.keys(input).some(key=>!['request','source','report','requestId'].includes(key))||typeof deviceGrant!=='string'||!deviceGrant||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)||Buffer.byteLength(JSON.stringify(input))>32*1024*1024)throw new Error('invalid_deep_research_publication');
 const request=normalizeMobileDeepResearchRequest(input.request);
 if(input.source?.version!==1||typeof input.source.vaultId!=="string"||!input.source.vaultId||!/^[a-f0-9]{64}$/.test(input.source.revision)||!["linked_corpus","device_downloads"].includes(input.source.sourceScope))throw new Error("invalid_deep_research_source_proof");
 const report=input.report as MobileDeepResearchReport;
 if(!report?.draft||report.draft.brief?.kind!=='deep_research'||report.draft.brief.objective!==request.objective||typeof report.draft.draftMarkdown!=='string'||!report.draft.draftMarkdown.trim()||!Array.isArray(report.draft.bibliography)||!report.meta)throw new Error('invalid_deep_research_report');
 if(request.completeGuide){
  const artifacts=report.completeGuideArtifacts as {runId?:unknown;items?:unknown;chapters?:unknown;syllabus?:unknown;sources?:unknown;passages?:unknown}|undefined;
  const {runId,...config}=request.completeGuide;
  if(report.draft.completeGuide?.runId!==runId||canonicalJson(report.draft.completeGuide.config)!==canonicalJson(config)||artifacts?.runId!==runId||!Array.isArray(artifacts.items)||!Array.isArray(artifacts.chapters)||!Array.isArray(artifacts.sources)||!Array.isArray(artifacts.passages)||!artifacts.syllabus)throw new Error('invalid_complete_guide_publication');
 }else if(report.draft.completeGuide||report.completeGuideArtifacts||report.completeGuideFigures)throw new Error('invalid_complete_guide_publication');
 const cover=report.mobileCover;
 if(cover&&(!request.decorativeImage?.enabled||cover.style!==request.decorativeImage.style||!['openai','gemini','openrouter'].includes(cover.model?.provider)||typeof cover.model.model!=='string'||!cover.model.model||typeof cover.context!=='string'||cover.context.length>260||cover.prompt!==buildDecorativeImagePrompt(cover.style,cover.context,vaultTypeImagePrompt(input.source.vaultType))||cover.mime!=='image/jpeg'||typeof cover.bytes!=='string'||cover.bytes.length>7_000_000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cover.bytes)))throw new Error('invalid_mobile_deep_research_cover');
 const db=getDb(),fingerprint=hash(input);
 db.exec('CREATE TABLE IF NOT EXISTS mobile_deep_research_publications(device_grant TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(device_grant,request_id))');
 return db.transaction(()=>{
  const receipt=db.prepare('SELECT payload_hash,result_json FROM mobile_deep_research_publications WHERE device_grant=? AND request_id=?').get(deviceGrant,input.requestId) as {payload_hash:string;result_json:string}|undefined;
  if(receipt){if(receipt.payload_hash!==fingerprint)throw new Error('idempotency_conflict');return JSON.parse(receipt.result_json);}
  signal?.throwIfAborted();if(input.source.vaultId!==getActiveVault().id||input.source.vaultType!==getActiveVault().type)throw new Error('deep_research_source_scope_conflict');
  if(input.source.revision!==mobileDeepResearchCorpusRevision(request))throw new Error('deep_research_source_conflict');
  const webPassages=(report.completeGuideArtifacts as {webPassages?:unknown}|undefined)?.webPassages;
  if(webPassages!==undefined){
   if(!request.completeGuide?.webText||!Array.isArray(webPassages)||webPassages.length>1000)throw new Error('invalid_complete_guide_web_evidence');
   for(const raw of webPassages){
    const row=raw as WebPassageRecord;
    if(!row||typeof row.text!=='string'||!row.text.trim()||row.text.length>100_000||typeof row.title!=='string'||typeof row.domain!=='string'||typeof row.retrievedAt!=='string'||!['html','pdf'].includes(row.kind)||!(row.pageNumber===null||Number.isSafeInteger(row.pageNumber)&&row.pageNumber!>0)||![row.url,row.finalUrl].every(url=>{try{const value=new URL(url);return value.protocol==='https:'&&!value.username&&!value.password;}catch{return false;}}))throw new Error('invalid_complete_guide_web_evidence');
    recordWebPassage(row);
   }
  }
  for(const match of report.draft.draftMarkdown.matchAll(/\(nodus:\/\/(idea|work|passage)\/([^\s)]+)\)/g)) {
    let id:string;try{id=decodeURIComponent(match[2]);}catch{throw new Error('invalid_deep_research_citation');}
    const table=match[1]==='idea'?'ideas':match[1]==='work'?'works':'passages',column=match[1]==='idea'?'global_id':match[1]==='work'?'nodus_id':'passage_id';
    const scoped=match[1]==='passage'&&(id.startsWith('web:')?getWebPassage(id):id.startsWith('documentary:')?getDocumentaryPassageDetail(id):id.startsWith('scoped:')?getScopedLegacyPassageDetail(id):null);
    const globalWork=getActiveVault().type==='academic'&&match[1]==='work'&&resolveAcademicRunScope(request.notebookId).documents.some(document=>document.workId===id);
    if(!scoped&&!globalWork&&!db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id))throw new Error('deep_research_citation_source_missing');
  }
  if(getWritingWorkshopDraft(input.requestId))throw new Error('deep_research_identity_conflict');
  const visuals=validateMobileResearchVisuals((report as MobileDeepResearchReport & {mobileVisuals?:unknown}).mobileVisuals,request,report.draft,input.source.vaultId,input.requestId,deviceGrant);
  const draft={...report.draft,generationModel:request.model,mobileGenerationReceipt:{requestId:input.requestId,inputHash:fingerprint,sourceScope:input.source.sourceScope}};
  const result=saveWritingWorkshopDraft({draft,model:request.model},input.requestId);
  if(cover){
   const image=prepareImageStorage(Buffer.from(cover.bytes,'base64'),cover.mime);
   markDecorativeImagePending({entityKind:'deep_research',entityId:result.id,provider:cover.model.provider==='gemini'?'google':cover.model.provider as 'openai'|'openrouter',model:cover.model.model,style:cover.style,preserveContext:false,preservePrompt:false});
   saveDecorativeImagePrompt('deep_research',result.id,cover.context,cover.prompt);
   result.image=saveDecorativeImageReady('deep_research',result.id,image.image,image.mimeType,image.thumbnail,image.thumbnailMimeType);
  }

  if(request.completeGuide){
   saveCompleteGuideArtifacts(result.id,request.completeGuide.runId,report.completeGuideArtifacts);
   // The receipt is committed only after required evidence and prepared figures
   // land. Replaying a lost ACK returns that same receipt before corpus CAS.
   if(report.completeGuideFigures){const {figures,siblings}=report.completeGuideFigures;seedCompleteGuideFigures(result.id,figures,itemId=>siblings[itemId]??[]);}
  }
  publishMobileResearchVisuals(visuals);
  db.prepare('INSERT INTO mobile_deep_research_publications VALUES(?,?,?,?)').run(deviceGrant,input.requestId,fingerprint,JSON.stringify(result));return result;
 })();
}
