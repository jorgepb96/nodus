import type {HierarchicalPassageHit} from '../electron/ai/hierarchicalRetrieval';
import type {MobileDeepResearchProof} from './mobileDeepResearch';
import type {ResolvedResearchScope,ResearchEvidence,RetrievalSettings,DocumentPreparationState} from './researchCorpus';
import type {WritingWorkshopIdeaCandidate,WritingWorkshopSnapshot,PassageDetail} from './types';
import {validateRetrievalSettings} from './researchCorpus';
import {sha256Snapshot} from './databaseResearchEngine';
export interface AcademicResearchCapture {
 title:string;scope:ResolvedResearchScope;settings:RetrievalSettings;
 passages:Array<ResearchEvidence&{indexKey:string;ordinal:number}>;
 legacyPassages:Array<{hit:HierarchicalPassageHit;receipt:PassageDetail}>;
 ideas:WritingWorkshopIdeaCandidate[];
 graph:Pick<WritingWorkshopSnapshot,'themes'|'gaps'|'contradictions'>;
 relationships:Array<{from:string;relation:string;to:string;confidence:number}>;
 preparation:DocumentPreparationState[];
}
export interface MobileAcademicResearchSource extends AcademicResearchCapture {version:1;kind:'academic';context:MobileDeepResearchProof;sourceHash:string}
export function captureMobileAcademicResearchSource(capture:AcademicResearchCapture,context:MobileDeepResearchProof):MobileAcademicResearchSource {
 const result:MobileAcademicResearchSource={...structuredClone(capture),version:1,kind:'academic',context:{...context,preparedSourcesOnly:true},sourceHash:sha256Snapshot(capture)};
 validateMobileAcademicResearchSource(result);return result;
}
export function validateMobileAcademicResearchSource(value:MobileAcademicResearchSource):void {
 if(typeof value?.title!=='string'||!value.title.trim()||value.title.length>2048||value?.version!==1||value.kind!=='academic'||value.context?.version!==1||value.context.vaultType!=='academic'||!value.context.vaultId||!/^[a-f0-9]{64}$/.test(value.context.revision)||!['linked_corpus','device_downloads'].includes(value.context.sourceScope)||value.context.preparedSourcesOnly!==true||value.scope?.vaultId!==value.context.vaultId||!/^[a-f0-9]{64}$/.test(value.scope.id)||!Array.isArray(value.scope.documents))throw new Error('invalid_academic_research_scope');
 validateRetrievalSettings(value.settings);
 const documents=new Map(value.scope.documents.map(document=>[document.id,document]));if(documents.size!==value.scope.documents.length||!documents.size)throw new Error('academic_research_sources_missing');
 if(!Array.isArray(value.passages)||!Array.isArray(value.legacyPassages)||!value.passages.length&&!value.legacyPassages.length||!Array.isArray(value.ideas)||!value.graph||!Array.isArray(value.relationships)||!Array.isArray(value.preparation))throw new Error('academic_research_prepared_sources_missing');
 const ids=new Set<string>();for(const passage of value.passages){const document=documents.get(passage.documentId);if(!document||ids.has(passage.id)||typeof passage.text!=='string'||!passage.text.trim()||passage.workId!==document.workId||typeof passage.indexKey!=='string'||!passage.id.startsWith(passage.indexKey+':')||!Number.isSafeInteger(passage.ordinal)||passage.ordinal<0||!passage.locator||!Array.isArray(passage.limitations))throw new Error('invalid_academic_research_passage');ids.add(passage.id);}
 for(const item of value.legacyPassages){const document=value.scope.documents.find(document=>document.workId===item.hit.nodus_id);if(!document||item.receipt.nodus_id!==item.hit.nodus_id||item.receipt.text!==item.hit.text||!item.receipt.passage_id.startsWith(`scoped:${value.scope.id}:`)||!Array.isArray(item.hit.lanes)||typeof item.hit.text!=='string'||!item.hit.text.trim())throw new Error('invalid_academic_legacy_passage');}
 const works=new Set(value.scope.documents.flatMap(document=>document.workId?[document.workId]:[]));if(value.ideas.some(idea=>!idea.id||typeof idea.statement!=='string'||!Array.isArray(idea.works)||idea.works.some(work=>!works.has(work.nodus_id))))throw new Error('invalid_academic_research_idea');
 for(const field of ['themes','gaps','contradictions'] as const)if(!Array.isArray(value.graph[field]))throw new Error('invalid_academic_research_graph');
 if(value.preparation.some(state=>!documents.has(state.documentId)))throw new Error('invalid_academic_research_preparation');
 const {title,scope,settings,passages,legacyPassages,ideas,graph,relationships,preparation}=value;if(value.sourceHash!==sha256Snapshot({title,scope,settings,passages,legacyPassages,ideas,graph,relationships,preparation}))throw new Error('academic_research_source_conflict');
 if(new TextEncoder().encode(JSON.stringify(value)).length>16_000_000)throw new Error('academic_research_source_too_large');
}
