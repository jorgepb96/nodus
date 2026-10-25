import {listWorksPage} from '../db/worksRepo';
import {getLibraryReaderRawContent} from '../libraryReader/libraryReaderStore';
import {readDocumentarySourceMap} from '../ai/documentaryExtraction';
import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {effectiveEmbeddingConfig} from '../ai/aiClient';
import {activeEmbeddingIndex,embeddingIndexHead} from '../db/embeddingIndexesRepo';
import {resolveAcademicRunScope} from '../ai/researchCorpusRun';
import {canonicalJson} from '../../shared/canonicalJson';
import type {DeepResearchRequest} from '../../shared/types';
/** Prepared lexical sources remain usable when semantic search has no active index.
 * Other configuration failures still propagate; this never prepares an index. */
export function mobileResearchEmbeddingConfig():ReturnType<typeof effectiveEmbeddingConfig>|null {
 const db=getDb();
 return embeddingIndexHead(db)&&!activeEmbeddingIndex(db)?null:effectiveEmbeddingConfig();
}
/** Corpus source revision excludes derived indexes/profiles and their status.
 * It includes actual authored graph content and authoritative work text identity. */
export function mobileDeepResearchCorpusRevision(request?:DeepResearchRequest):string {
 const db=getDb(),digest=createHash('sha256');
 const vaultType=getActiveVault().type;
 const tables=vaultType==='academic'?['works','ideas','themes','gaps','edges']:vaultType==='genealogy'?['works','persons','events','relationships','social_relations','archive_items','archive_item_persons','record_evidence','event_participants','social_contacts','places']:['study_docs','study_subjects','study_materials','study_transcripts','study_transcript_segments','study_ideas','study_idea_connections','study_questions'];
 for(const table of tables){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const rows=db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[];
  const source=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!/^deep_|^embedding|^updated_at$|^last_|^document_profile|^resolved_text_cached|^read_tag$|^read_at$|^created_at$/.test(key)))).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
  digest.update(canonicalJson([table,source]));
 }
 if(vaultType==='genealogy'){let preparedCount=0;for(const work of listWorksPage({},{limit:100,offset:0}).items){if(preparedCount>=10)break;const prepared=getLibraryReaderRawContent(work.zotero_key);if(!prepared?.markdown?.trim())continue;digest.update(canonicalJson([work.nodus_id,prepared.markdown,readDocumentarySourceMap(prepared.folder,prepared.sourceMapFile)]));preparedCount++;}}
 const scope=vaultType==='academic'?resolveAcademicRunScope(request?.notebookId):null;
 if(vaultType==='academic')digest.update(canonicalJson(mobileResearchEmbeddingConfig()));
 if(scope)digest.update(canonicalJson({scopeId:scope.id,notebookId:scope.notebookId,notebookRevision:scope.notebookRevision,permissionFingerprint:scope.permissionFingerprint,documents:scope.documents.map(item=>({id:item.id,revision:item.revision})).sort((a,b)=>a.id.localeCompare(b.id))}));
 return digest.digest('hex');
}
