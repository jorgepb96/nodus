import {portableResearchCorpusRun} from '@shared/portableResearchCorpusRun';
import {bindPreparedResearchCorpus} from '@shared/portableResearchCorpusBinding';
import { researchActivityStep, startResearchActivity } from './researchActivity';
import type { ResolvedResearchScope } from '@shared/researchCorpus';
import { RETRIEVAL_PRESETS, validateRetrievalSettings } from '@shared/researchCorpus';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import type { DeepResearchRequest, WritingWorkshopIdeaCandidate, WritingWorkshopSnapshot } from '@shared/types';
import type { DeepResearchDeps } from './deepResearchCore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getDb } from '../db/database';
import { getResearchNotebook } from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { resolveResearchNotebook, resolveAcademicResearchScope } from './researchNotebookService';
import { assertResearchDocument, assertResearchDocumentPermission, documentsById, researchFingerprint } from './researchCorpusScope';
import { resolveResearchSourceScope, scopedIdeaEvidencePassages } from './researchSourceScope';
import { getResearchPreparationInventory, retrieveSharedDocumentaryEvidence } from './documentaryPreparation';
import { recordEmbeddingTrace } from '../qa/embeddingTrace';
import { retrieveHierarchical, selectPassageEvidence } from './hierarchicalRetrieval';
import { embedMany, embedQuery, resolveModelRef, researchModelContextWindow } from './aiClient';
import { createResearchSectionCoverage } from './researchSectionCoverage';
import { withResearchValidationThinking } from './thinkingEffort';
import { withResearchRequestBudget } from './researchRequestBudget';
import { insertScopedReceipts, recordScopedSourcePassage, recordScopedLegacyPassage } from '../citations/scopedLegacyCitations';
import { getSettings } from '../db/settingsRepo';
import { readAutomaticResearchZotero, pinZoteroOriginals } from '../mcp/researchZotero';
import { createResearchProseAuditor, findResearchConflicts } from './researchClaimAudit';
import { deepenResearch } from './researchActionCoordinator';
import { getGlobalLibraryItem, globalLibraryAttachmentPath } from '../library/libraryService';
import { readResearchOriginalInWorker } from '../library/libraryExtractionWorkerHost';
import { activeManualIdeaIds } from '../db/manualIdeaVisibility';
import { extractCitationRefs } from './citationSanitize';
import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';

/** Research Chat's agent: the turn's plan and how many independent sources a finish needs.
 * Deep Research, the Dictionary and notebook reads leave it unset and keep their loop. */
export type {ResearchChatAgent} from '@shared/portableResearchCorpusRun';

/** Compatibility requests are explicit snapshots of the active vault. A notebook
 * may additionally authorize unlinked Global Library works. Neither path uses a
 * missing filter to mean "all" inside a repository. */
export function resolveAcademicRunScope(notebookId?: string | null): ResolvedResearchScope {
  return notebookId ? resolveResearchNotebook(notebookId) : resolveAcademicResearchScope();
}

/** One run owns the scope, evidence ledger and traversal across all sections. */
export function scopedResearchGraph(scope:ResolvedResearchScope,workIds:string[],ideaIds:string[],budget:ResearchRetrievalBudget,contextDocuments:Set<string>):Pick<WritingWorkshopSnapshot,'gaps'|'contradictions'|'themes'> {
    const db = getDb();
    const works = JSON.stringify(workIds);
    const ideas = JSON.stringify(ideaIds);
    const limit = budget.settings.passagesPerRound;
    const gaps = (db.prepare(`SELECT id,kind,statement,related_idea,confidence,nodus_id FROM gaps
      WHERE nodus_id IN (SELECT value FROM json_each(?)) AND (related_idea IS NULL OR related_idea IN (SELECT value FROM json_each(?)))
      ORDER BY confidence DESC,id LIMIT ?`).all(works, ideas, limit) as Array<{ id: string; kind: WritingWorkshopSnapshot['gaps'][number]['kind']; statement: string; related_idea: string | null; confidence: number; nodus_id: string }>)
      .filter(row => budget.accept(`gap:${row.id}`, row.statement)).map(row => {
        const document = scope.documents.find(document => document.workId === row.nodus_id)!;
        contextDocuments.add(document.id);
        return { id: row.id, kind: row.kind, label: row.statement.slice(0, 100), summary: row.statement, score: row.confidence,
          reason: 'scoped-gap', relatedIdea: row.related_idea, confidence: row.confidence,
          work: { nodus_id: row.nodus_id, title: document.title, authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' } };
      });
    const contradictions = (db.prepare(`SELECT e.id,e.type,e.basis,e.confidence,e.source_work,a.label from_label,b.label to_label,
      a.statement from_statement,b.statement to_statement FROM visible_edges e JOIN ideas a ON a.global_id=e.from_id JOIN ideas b ON b.global_id=e.to_id
      WHERE e.type IN ('contradicts','refutes') AND e.source_work IN (SELECT value FROM json_each(?))
      AND e.from_id IN (SELECT value FROM json_each(?)) AND e.to_id IN (SELECT value FROM json_each(?))
      ORDER BY e.confidence DESC,e.id LIMIT ?`).all(works, ideas, ideas, limit) as Array<{ id: string; type: string; basis: WritingWorkshopSnapshot['contradictions'][number]['basis']; confidence: number; from_label: string; to_label: string; from_statement: string; to_statement: string; source_work: string }>)
      .map(row => {
        const documents = scope.documents.filter(document => document.workId === row.source_work);
        documents.forEach(document => contextDocuments.add(document.id));
        return { id: row.id, label: `${row.from_label} / ${row.to_label}`, summary: `${row.from_statement} / ${row.to_statement}`,
        score: row.confidence, reason: 'scoped-contradiction', fromLabel: row.from_label, toLabel: row.to_label, type: row.type, basis: row.basis, confidence: row.confidence,
        sources: documents.map(document => `${document.authors.join('; ')} (${document.year ?? ''})`) };
      })
      .filter(row => budget.accept(`contradiction:${row.id}`, row.summary));
    const themes = (db.prepare(`SELECT t.theme_id id,t.label,COUNT(DISTINCT wt.nodus_id) workCount FROM themes t
      JOIN work_themes wt ON wt.theme_id=t.theme_id WHERE wt.nodus_id IN (SELECT value FROM json_each(?))
      GROUP BY t.theme_id ORDER BY workCount DESC,t.theme_id LIMIT ?`).all(works, limit) as Array<{ id: string; label: string; workCount: number }>)
      .filter(row => budget.accept(`theme:${row.id}`, row.label)).map(row => ({ ...row, summary: row.label, score: row.workCount, reason: 'scoped-theme', pinned: false, ideaCount: 0 }));
    return { gaps, contradictions, themes };
}

export const {ResearchCorpusRun}=portableResearchCorpusRun({recordEmbeddingTrace,getActiveVault:(...args)=>getActiveVault(...args),getResearchNotebook:(...args)=>getResearchNotebook(...args),researchCorpusInventory:(...args)=>researchCorpusInventory(...args),assertResearchDocument:(...args)=>assertResearchDocument(...args),assertResearchDocumentPermission:(...args)=>assertResearchDocumentPermission(...args),documentsById:(...args)=>documentsById(...args),researchFingerprint:(...args)=>researchFingerprint(...args),resolveResearchSourceScope:(...args)=>resolveResearchSourceScope(...args),scopedIdeaEvidencePassages:(...args)=>scopedIdeaEvidencePassages(...args),getResearchPreparationInventory:(...args)=>getResearchPreparationInventory(...args),retrieveSharedDocumentaryEvidence:(...args)=>retrieveSharedDocumentaryEvidence(...args),retrieveHierarchical:(...args)=>retrieveHierarchical(...args),selectPassageEvidence:(...args)=>selectPassageEvidence(...args),embed:(...args)=>embedQuery(...args),embedMany:(...args)=>embedMany(...args),insertScopedReceipts:(...args)=>insertScopedReceipts(...args),recordScopedSourcePassage:(...args)=>recordScopedSourcePassage(...args),recordScopedLegacyPassage:(...args)=>recordScopedLegacyPassage(...args),getSettings:(...args)=>getSettings(...args),readAutomaticResearchZotero:(...args)=>readAutomaticResearchZotero(...args),pinZoteroOriginals:(...args)=>pinZoteroOriginals(...args),getGlobalLibraryItem:(...args)=>getGlobalLibraryItem(...args),globalLibraryAttachmentPath:(...args)=>globalLibraryAttachmentPath(...args),readResearchOriginalInWorker:(...args)=>readResearchOriginalInWorker(...args),getDocumentaryPassageDetail:(...args)=>getDocumentaryPassageDetail(...args),getScopedLegacyPassageDetail:(...args)=>getScopedLegacyPassageDetail(...args),extractCitationRefs:(...args)=>extractCitationRefs(...args),researchActivityStep:(...args)=>researchActivityStep(...args),startResearchActivity:(...args)=>startResearchActivity(...args),deepenResearch:(...args)=>deepenResearch(...args),manualIdeaIds:()=>getSettings().academicMode==='manual'?activeManualIdeaIds(getDb()):null,lexicalIdeas:ids=>getDb().prepare(`SELECT global_id,type,label,statement FROM ideas WHERE global_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as Array<{global_id:string;type:WritingWorkshopIdeaCandidate['type'];label:string;statement:string}>,ideaWorkIds:id=>getDb().prepare('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id=?').all(id) as Array<{nodus_id:string}>,graph:scopedResearchGraph});
export type ResearchCorpusRun=InstanceType<typeof ResearchCorpusRun>;

export function bindAcademicCorpusRun(deps: DeepResearchDeps, request: DeepResearchRequest, signal?: AbortSignal, options?: {sourceOnly: true}): DeepResearchDeps {
  const scope = resolveAcademicRunScope(request.notebookId);
  const settings = validateRetrievalSettings(request.retrieval ?? (request.notebookId ? getResearchNotebook(request.notebookId)?.settings : undefined) ?? RETRIEVAL_PRESETS.deep);
  const run = new ResearchCorpusRun(scope, settings, signal, !options?.sourceOnly);
  if (options?.sourceOnly) {
    // A companion may consult prepared evidence, never trigger PDF extraction,
    // Zotero original fetching, OCR, indexing or new derived profiles.
    run.readOriginal = async () => {
      run.budget.partial = true; run.limitations.add('research_read_unavailable');
      throw new Error('desktop_preparation_required');
    };
  }
  return bindPreparedResearchCorpus(deps,run,request.model ?? getSettings().deepResearchModel ?? getSettings().synthesisModel,{createResearchProseAuditor,createResearchSectionCoverage,findResearchConflicts,withResearchValidationThinking,contextWindow:model=>researchModelContextWindow(resolveModelRef(model)),withResearchRequestBudget},signal);
}
