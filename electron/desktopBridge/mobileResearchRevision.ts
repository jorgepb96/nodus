import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {effectiveEmbeddingConfig} from '../ai/aiClient';
import {resolveAcademicRunScope} from '../ai/researchCorpusRun';
import {canonicalJson} from '../../shared/canonicalJson';
import type {DeepResearchRequest} from '../../shared/types';
/** Corpus source revision excludes derived indexes/profiles and their status.
 * It includes actual authored graph content and authoritative work text identity. */
export function mobileDeepResearchCorpusRevision(request?:DeepResearchRequest):string {
 const db=getDb(),digest=createHash('sha256');
 const vaultType=getActiveVault().type;
 const tables=vaultType==='academic'?['works','ideas','themes','gaps','edges']:vaultType==='genealogy'?['works','persons','events','relationships','social_relations','archive_items','archive_item_persons','evidence','places']:['study_docs','study_subjects','study_materials','study_transcripts','study_transcript_segments','study_ideas','study_idea_connections','study_questions'];
 for(const table of tables){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const rows=db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[];
  const source=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!/^deep_|^embedding|^updated_at$|^last_|^document_profile|^resolved_text_cached|^read_tag$|^read_at$|^created_at$/.test(key)))).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
  digest.update(canonicalJson([table,source]));
 }
 const scope=vaultType==='academic'?resolveAcademicRunScope(request?.notebookId):null;
 digest.update(canonicalJson(effectiveEmbeddingConfig()));
 if(scope)digest.update(canonicalJson({scopeId:scope.id,notebookId:scope.notebookId,notebookRevision:scope.notebookRevision,permissionFingerprint:scope.permissionFingerprint,documents:scope.documents.map(item=>({id:item.id,revision:item.revision})).sort((a,b)=>a.id.localeCompare(b.id))}));
 return digest.digest('hex');
}
