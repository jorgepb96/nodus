import { researchActivityStep, startResearchActivity } from './researchActivity';
import type { ResearchContextLayers } from '@shared/types';
import type { ResearchDocumentRead, ResearchEvidence, ResearchTraversal, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { RETRIEVAL_PRESETS, describeResearchLimitation, validateRetrievalSettings, validateResearchDocumentRead } from '@shared/researchCorpus';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import { textWithPageStarts } from '@shared/retrievalChunks';
import type { DeepResearchRequest, WritingWorkshopBrief, WritingWorkshopIdeaCandidate, WritingWorkshopPassageCandidate, WritingWorkshopSnapshot } from '@shared/types';
import type { DeepResearchDeps, SectionRetrievalInput } from './deepResearchCore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getDb } from '../db/database';
import { getResearchNotebook } from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { resolveResearchNotebook, resolveAcademicResearchScope } from './researchNotebookService';
import { assertResearchDocument, assertResearchDocumentPermission, researchFingerprint } from './researchCorpusScope';
import { resolveResearchSourceScope, scopedIdeaEvidencePassages } from './researchSourceScope';
import { getResearchPreparationInventory, retrieveSharedDocumentaryEvidence } from './documentaryPreparation';
import { retrieveHierarchical, selectPassageEvidence } from './hierarchicalRetrieval';
import { embed, resolveModelRef, researchModelContextWindow } from './aiClient';
import { createResearchSectionCoverage } from './researchSectionCoverage';
import { withResearchValidationThinking } from './thinkingEffort';
import { withResearchRequestBudget } from './researchRequestBudget';
import { recordScopedSourcePassage, recordScopedLegacyPassage } from '../citations/scopedLegacyCitations';
import { documentaryCitationId } from '../citations/documentaryCitations';
import { getSettings } from '../db/settingsRepo';
import { readAutomaticResearchZotero, pinZoteroOriginals, type ZoteroOriginalPins } from '../mcp/researchZotero';
import type { OriginalPage } from '../extraction/researchOriginal';
import { createResearchProseAuditor, findResearchConflicts } from './researchClaimAudit';
import { deepenResearch } from './researchActionCoordinator';
import { getGlobalLibraryItem, globalLibraryAttachmentPath } from '../library/libraryService';
import { readResearchOriginalInWorker } from '../library/libraryExtractionWorkerHost';
import type { ModelRef } from '@shared/types';
import { activeManualIdeaIds } from '../db/manualIdeaVisibility';
import type { ResearchWebGrant } from './researchWebStep';
import { searchResearchCatalog, type ResearchCatalogHit, type ResearchCatalogQuery } from '@shared/researchCatalog';
import type { ResearchTurnPlan } from './researchTurnPlanner';
import { extractCitationRefs } from './citationSanitize';
import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';

/** Research Chat's agent: the turn's plan and how many independent sources a finish needs.
 * Deep Research, the Dictionary and notebook reads leave it unset and keep their loop. */
export interface ResearchChatAgent {
  plan: ResearchTurnPlan;
  /** The user's literal last message, which may only say where or how to search. */
  question: string;
  minSources: number;
  /** A small local window: shorter menus in every decision. */
  compact: boolean;
}

/** Compatibility requests are explicit snapshots of the active vault. A notebook
 * may additionally authorize unlinked Global Library works. Neither path uses a
 * missing filter to mean "all" inside a repository. */
export function resolveAcademicRunScope(notebookId?: string | null): ResolvedResearchScope {
  return notebookId ? resolveResearchNotebook(notebookId) : resolveAcademicResearchScope();
}

/** One run owns the scope, evidence ledger and traversal across all sections. */
export class ResearchCorpusRun {
  readonly budget: ResearchRetrievalBudget;
  readonly evidence = new Map<string, WritingWorkshopPassageCandidate>();
  readonly limitations = new Set<string>();
  readonly matchedDocuments = new Set<string>();
  readonly readDocuments = new Set<string>();
  readonly attemptedDocuments = new Set<string>();
  private readonly zoteroMcpReads = new Set<string>();
  private readonly zoteroMcpAttempts = new Set<string>();
  private readonly contextDocuments = new Set<string>();
  readonly ideas = new Map<string, WritingWorkshopIdeaCandidate>();
  readonly traversal: Array<{ query: string; sources: string[]; candidates: number; partial: boolean }> = [];
  /** Research Chat and Dictionary: the web step, when the user left it on. Deep Research never sets it. */
  web?: ResearchWebGrant;
  /** Research Chat and Dictionary: the layers the user left on in the context balloon. Deep Research
   * reads both. A layer that is off is never consulted, not merely left out of the prompt. */
  layers: ResearchContextLayers = { ideas: true, documents: true };
  /** Whether the supervisor made at least one decision in this run. */
  supervised = false;
  /** Research Chat only. See ResearchChatAgent. */
  agent?: ResearchChatAgent;
  /** Works found by author, title or keywords in the library catalogue, best first. */
  readonly catalogHits = new Map<string, ResearchCatalogHit>();
  /** The finds of lookups by an author or a title the user named, as opposed to by topic. */
  readonly namedCatalogHits = new Set<string>();
  readonly catalogLookups: Array<{ query: ResearchCatalogQuery; hits: number }> = [];
  /** Passages earlier answers of the conversation cited and this turn carries again. */
  priorPassages = 0;
  private documentsByWork?: Map<string, ResolvedResearchScope['documents'][number]>;
  private readonly workIds: string[];
  private readonly ideaIds: string[];
  private originalPins?: Promise<ZoteroOriginalPins>;
  private graphSnapshot: Pick<WritingWorkshopSnapshot, 'gaps' | 'contradictions' | 'themes'> | null = null;
  private readonly sourceCoverage: NonNullable<ResearchTraversal['sourceCoverage']>;
  constructor(readonly scope: ResolvedResearchScope, settings: RetrievalSettings, readonly signal?: AbortSignal, readonly pinRevisions = false) {
    this.budget = new ResearchRetrievalBudget(settings);
    const inventory = new Map(getResearchPreparationInventory().documents.map(document => [document.id, document.preparation]));
    this.sourceCoverage = scope.documents.map(document => {
      const state = inventory.get(document.id);
      const reasons = [state?.reason, state?.text === 'abstract' ? 'abstract_only' : state?.text === 'missing' ? 'text_pending' : null,
        state?.embeddings !== 'ready' ? 'embeddings_pending' : null, state?.lexical === 'stale' ? 'previous_indexed_revision' : null].filter((reason): reason is string => !!reason);
      reasons.forEach(reason => this.limitations.add(reason));
      return { documentId: document.id, title: document.title, reasons };
    });
    this.workIds = scope.documents.filter(document => !document.indexedSource || document.indexedSource.revision === document.revision).flatMap(document => document.workId ? [document.workId] : []);
    const manual = getSettings().academicMode === 'manual' ? activeManualIdeaIds(getDb()) : null;
    this.ideaIds = [...resolveResearchSourceScope({ enabled: true, authorIds: [], workIds: this.workIds }, true)!.ideaIds].filter(id => !manual || manual.has(id));
  }
  validate(): void {
    this.signal?.throwIfAborted();
    if (getActiveVault().id !== this.scope.vaultId) throw new Error('research_scope_changed');
    if (this.scope.notebookId && getResearchNotebook(this.scope.notebookId)?.revision !== this.scope.notebookRevision) throw new Error('research_scope_changed');
    const current = researchCorpusInventory().documents;
    for (const document of this.scope.documents) (this.pinRevisions ? assertResearchDocumentPermission : assertResearchDocument)(this.scope, document.id, current.find(item => item.id === document.id));
    if (this.pinRevisions && this.scope.documents.some(document => current.find(item => item.id === document.id)?.revision !== document.revision)) {
      // Shared evidence and scoped legacy receipts are immutable. Graph analyses are not;
      // discard their cached copies instead of reading a silently newer revision.
      this.ideas.clear();
      for (const id of this.evidence.keys()) if (!id.startsWith('documentary:') && !id.startsWith('scoped:')) this.evidence.delete(id);
      this.graphSnapshot = { gaps: [], contradictions: [], themes: [] };
      this.budget.partial = true;
    }
  }
  /** Research Chat's agent starts from every query of its plan; other callers from one. */
  async investigate(query: string, model?: ModelRef | null): Promise<void> {
    if (this.pinRevisions && !this.originalPins) {
      const controller = new AbortController();
      const signal = this.signal ? AbortSignal.any([this.signal, controller.signal]) : controller.signal;
      const deadline = setTimeout(() => controller.abort(), 15000);
      this.originalPins = pinZoteroOriginals({ ...this.scope, documents: this.scope.documents.slice(0, this.budget.settings.candidates) }, signal)
        .catch(() => new Map()).finally(() => clearTimeout(deadline));
      await this.originalPins; this.validate();
    }
    // Leave room for an actual decision and bounded original read. Otherwise a
    // successful first retrieval would consume the entire expansion allowance.
    const queries = this.agent ? [...new Set([query, ...this.agent.plan.queries])].slice(0, 3) : [query];
    const opening = Math.floor((this.budget.evidenceTokenLimit - this.budget.usedEvidenceTokens) / 3 / queries.length);
    const limit = this.budget.settings.autoExpand && this.budget.settings.rounds > 1 ? Math.max(256, opening) : undefined;
    await this.retrieve(queries[0], 1, limit);
    // The plan's further queries widen the search; one that fails (a retrieval timeout on a
    // loaded machine) costs its own evidence, not the turn.
    for (const each of queries.slice(1)) {
      try { await this.retrieve(each, 1, limit); }
      catch (error) {
        this.validate();
        if (/not_authorized|scope_changed/.test(error instanceof Error ? error.message : '')) throw error;
        this.budget.partial = true; this.limitations.add('research_read_unavailable');
      }
    }
    // The supervisor's decisions read documents: nothing to decide with the documents off.
    if (this.layers.documents) await deepenResearch(this, query, model);
  }
  async retrieve(query: string, expandRounds = 2, roundLimit?: number): Promise<void> {
    this.validate();
    if (!this.budget.nextRound()) {
      this.traversal.push({ query, sources: this.scope.documents.map(document => document.id), candidates: 0, partial: true });
      return;
    }
    const settings = this.budget.settings;
    if (!this.scope.documents.length) return;
    const { ideas: readIdeas, documents: readDocuments } = this.layers;
    if (!readIdeas && !readDocuments) { this.traversal.push({ query, sources: [], candidates: 0, partial: false }); return; }
    const vector = await researchActivityStep('scope', 'embed', () => embed(query, this.signal)).catch(() => {
      this.limitations.add('embedding_provider_unavailable'); return null;
    });
    this.validate();
    const current = researchCorpusInventory().documents;
    const stableWorks = this.pinRevisions ? this.scope.documents.filter(document => (!document.indexedSource || document.indexedSource.revision === document.revision) && current.find(item => item.id === document.id)?.revision === document.revision).flatMap(document => document.workId ? [document.workId] : []) : this.workIds;
    const stableIdeas = stableWorks.length === this.workIds.length ? this.ideaIds : [];
    const hierarchy = await retrieveHierarchical(query, { embedding: vector, nodusIds: stableWorks, ideaIds: stableIdeas,
      documentLimit: readDocuments ? settings.candidates : 0, ideaLimit: readIdeas ? settings.passagesPerRound : 0, passageLimit: readDocuments ? settings.candidates : 0,
      minIdeaSimilarity: -1, minPassageSimilarity: -1, minDocumentSimilarity: -1 });
    const usedBeforeRound = this.budget.usedEvidenceTokens;
    const remaining = Math.min(roundLimit ?? Infinity, this.budget.evidenceTokenLimit - usedBeforeRound);
    const acceptRound = (id: string, text: string) => this.budget.usedEvidenceTokens - usedBeforeRound + Buffer.byteLength(text) <= remaining && this.budget.accept(id, text);
    const expansion = settings.autoExpand ? Math.max(1, Math.min(expandRounds, settings.rounds - this.budget.rounds + 1)) : 1;
    const shared = readDocuments && remaining >= 256 ? await retrieveSharedDocumentaryEvidence(this.scope, query,
      { ...settings, rounds: expansion, evidenceTokens: remaining }, vector, this.signal) : { evidence: [], traversal: { rounds: 1, candidates: 0, partial: true } };
    for (let round = 1; round < shared.traversal.rounds; round++) this.budget.nextRound();
    this.validate();
    // Interleave independent native/shared lanes, retaining source diversity.
    const candidates = shared.evidence.map(item => this.passage(item));
    const separable = readDocuments ? scopedIdeaEvidencePassages(query, stableWorks, settings.candidates) : [];
    const inventory = researchCorpusInventory().documents;
    const legacy = selectPassageEvidence([...hierarchy.passages, ...separable], settings.passagesPerRound, { preferLexical: true, preferSourceDiversity: true }).flatMap(hit => {
      const receipt = recordScopedLegacyPassage(this.scope, hit.passage_id, inventory);
      return receipt ? [{ id: receipt.passage_id, label: hit.title, summary: receipt.text, nodus_id: hit.nodus_id, pageLabel: receipt.page_label,
        authors: this.scope.documents.find(document => document.workId === hit.nodus_id)?.authors ?? [], year: hit.year, zotero_key: hit.zotero_key,
        citation: `nodus://passage/${encodeURIComponent(receipt.passage_id)}`, score: hit.similarity, reason: 'source' }] : [];
    });
    let selected = 0;
    for (let index = 0; index < Math.max(candidates.length, legacy.length); index++) for (const candidate of [candidates[index], legacy[index]]) {
      if (!candidate) continue;
      const key = `passage-content:${JSON.stringify([candidate.nodus_id, candidate.summary, candidate.pageLabel])}`;
      if (this.budget.visited.has(key)) continue;
      if (selected >= settings.passagesPerRound * shared.traversal.rounds) { this.budget.partial = true; break; }
      if (acceptRound(key, candidate.summary)) { this.evidence.set(candidate.id, candidate); selected++; }
    }
    const finishIdeas = readIdeas ? startResearchActivity('ideas', 'lexical') : undefined;
    const lexical = !readIdeas ? [] : getDb().prepare(`SELECT global_id,type,label,statement FROM ideas WHERE global_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(stableIdeas)) as Array<{ global_id: string; type: WritingWorkshopIdeaCandidate['type']; label: string; statement: string }>;
    const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const ordered = !readIdeas ? [] : [...hierarchy.ideas, ...lexical.map(idea => ({ ...idea, similarity: words.reduce((score, word) => score + Number(`${idea.label} ${idea.statement}`.toLocaleLowerCase().includes(word)), 0) })).filter(idea => idea.similarity > 0).sort((a, b) => b.similarity - a.similarity)];
    for (const found of ordered.slice(0, settings.passagesPerRound)) {
      // Some analysed ideas have no statement (6 in one real library): they read as their
      // label, and one with neither is skipped rather than charged to the budget as null.
      const statement = found.statement ?? found.label ?? '';
      const row = { ...found, statement };
      if (!statement || this.ideas.has(row.global_id) || !acceptRound(`idea:${row.global_id}`, statement)) continue;
      const ids = getDb().prepare('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id=?').all(row.global_id) as { nodus_id: string }[];
      const documents = this.scope.documents.filter(document => ids.some(id => id.nodus_id === document.workId));
      documents.forEach(document => this.contextDocuments.add(document.id));
      this.ideas.set(row.global_id, { id: row.global_id, label: row.label, summary: row.statement, statement: row.statement,
        type: row.type, themes: [], score: row.similarity, reason: 'scoped-idea', workCount: documents.length, evidenceCount: 0,
        works: documents.map(document => ({ nodus_id: document.workId!, title: document.title, authors: document.authors, year: document.year,
          zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' })) });
    }
    finishIdeas?.('completed', this.ideas.size);
    for (const candidate of [...candidates, ...legacy]) {
      const document = this.scope.documents.find(doc => (doc.workId ?? doc.id) === candidate.nodus_id);
      if (document) this.matchedDocuments.add(document.id);
    }
    this.budget.candidates += hierarchy.passages.length + separable.length + shared.traversal.candidates;
    this.budget.partial ||= shared.traversal.partial;
    this.traversal.push({ query, sources: this.scope.documents.map(document => document.id), candidates: hierarchy.passages.length + separable.length + shared.traversal.candidates, partial: this.budget.partial });
  }
  async readDocument(documentId: string, operation: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }> {
    this.validate();
    const read = validateResearchDocumentRead(operation);
    const document = this.scope.documents.find(item => item.id === documentId);
    if (!document) throw new Error('research_source_not_authorized');
    if (read.kind === 'pages' && read.attachmentId && document.attachments && !document.attachments.some(item => item.id === read.attachmentId)) throw new Error('research_source_not_authorized');
    this.attemptedDocuments.add(document.id);
    const query = read.kind === 'search' ? read.query : read.kind === 'references' ? read.query ?? 'references bibliography bibliografía bibliographie literaturverzeichnis' : `${read.kind}:${JSON.stringify(read)}`;
    if (!this.budget.nextRound(true) || this.budget.evidenceTokenLimit - this.budget.usedEvidenceTokens < 256) {
      this.budget.partial = true;
      this.traversal.push({ query, sources: [document.id], candidates: 0, partial: true });
      return { scopeId: this.scope.id, evidence: [], partial: true };
    }
    const result = await retrieveSharedDocumentaryEvidence({ ...this.scope, documents: [document] }, query,
      { ...this.budget.settings, rounds: 1, autoExpand: false, evidenceTokens: this.stepAllowance() }, null, this.signal, read);
    this.validate();
    const evidence = result.evidence.filter(item => {
      const candidate = this.passage(item);
      if (this.evidence.has(candidate.id)) return true;
      if (!this.budget.accept(`document-read:${item.id}`, item.text)) return false;
      this.evidence.set(candidate.id, candidate);
      return true;
    });
    this.budget.candidates += result.traversal.candidates;
    this.budget.partial ||= result.traversal.partial;
    this.traversal.push({ query, sources: [document.id], candidates: result.traversal.candidates, partial: this.budget.partial });
    if (evidence.length) { this.matchedDocuments.add(document.id); if (read.kind !== 'search') this.readDocuments.add(document.id); }
    else if (read.kind === 'pages') return this.readOriginal(documentId, read, true);
    else this.limitations.add('no_matches');
    return { evidence, scopeId: this.scope.id, partial: this.budget.partial };
  }
  async readOriginal(documentId: string, read: Extract<ResearchDocumentRead, { kind: 'pages' }>, counted = false): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }> {
    this.validate(); validateResearchDocumentRead(read);
    const document = this.scope.documents.find(item => item.id === documentId);
    if (!document) throw new Error('research_source_not_authorized');
    const current = researchCorpusInventory().documents.find(item => item.id === documentId);
    assertResearchDocument(this.scope, documentId, current);
    if (read.attachmentId && document.attachments && !document.attachments.some(item => item.id === read.attachmentId)) throw new Error('research_source_not_authorized');
    this.attemptedDocuments.add(document.id);
    const remaining = this.stepAllowance();
    if ((!counted && !this.budget.nextRound(true)) || remaining < 256) {
      this.limitations.add('budget_exhausted'); return { evidence: [], scopeId: this.scope.id, partial: true };
    }
    const library = document.libraryItemId ? getGlobalLibraryItem(document.libraryItemId) : null;
    const attachments = library?.attachments.filter(item => item.mimeType === 'application/pdf') ?? [];
    const attachment = read.attachmentId ? attachments.find(item => item.id === read.attachmentId) : attachments.length === 1 ? attachments[0] : null;
    let attachmentId = attachment?.id ?? read.attachmentId ?? null;
    let attachmentRevision = document.attachments?.find(item => item.id === attachmentId)?.revision;
    let sourceRef = library && attachment ? `library:${library.id}:${attachment.id}` : null;
    let pages: OriginalPage[] | undefined;
    if (attachment && library) {
      try { pages = await researchActivityStep('nodus', 'pages', () => readResearchOriginalInWorker({
        file: globalLibraryAttachmentPath(library.id, attachment.id), sha256: attachment.sha256,
        from: read.from, to: read.to ?? read.from, maxBytes: Math.min(64000, remaining), languages: getSettings().ocrLanguages || 'spa+eng',
      }, this.signal), document.title); }
      catch (error) {
        this.validate();
        if (document.origin.kind !== 'zotero' || !/ENOENT|EACCES|El archivo adjunto no está disponible|extraction_worker_unavailable|original_read_timeout/.test(error instanceof Error ? error.message : '')) throw error;
        this.limitations.add('local_original_unavailable');
      }
    }
    if (!pages && document.origin.kind === 'zotero') {
      this.zoteroMcpAttempts.add(document.id);
      const raw = await readAutomaticResearchZotero(this.scope, { documentId, from: read.from, to: read.to,
        attachmentKey: read.attachmentId ? library?.attachments.find(item => item.id === read.attachmentId)?.sourceKey ?? read.attachmentId : undefined }, this.signal, this.pinRevisions ? await (this.originalPins ?? Promise.resolve(new Map())) : undefined) as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
      const content = raw.structuredContent ?? JSON.parse(raw.content?.find(item => item.type === 'text')?.text ?? 'null');
      const value = content as { itemKey?: string; attachmentKey?: string; attachmentVersion?: number; attachmentSha256?: string; revision?: string; pages?: Array<{ text: string; pageNumber: number; partial?: boolean }>; needsOcr?: number[] };
      if (value?.revision !== document.revision || value.itemKey !== document.origin.itemKey || !value.attachmentKey || !Array.isArray(value.pages)
        || value.pages.length > 4 || value.pages.some(page => typeof page.text !== 'string' || !Number.isInteger(page.pageNumber) || page.pageNumber < read.from || page.pageNumber > (read.to ?? read.from))) throw new Error('research_mcp_invalid_evidence');
      attachmentId = library?.attachments.find(item => item.sourceKey === value.attachmentKey)?.id ?? value.attachmentKey;
      attachmentRevision = document.attachments?.find(item => item.id === attachmentId)?.revision
        ?? (Number.isSafeInteger(value.attachmentVersion) && /^[a-f0-9]{64}$/.test(value.attachmentSha256 ?? '') ? researchFingerprint([value.attachmentSha256, value.attachmentVersion]) : undefined);
      sourceRef = `zotero:${document.origin.libraryType}:${document.origin.libraryId}:${value.attachmentKey}`;
      let bytes = Math.min(64000, remaining);
      pages = value.pages.map(page => {
        const text = Buffer.from(page.text).subarray(0, bytes).toString('utf8').replace(/\uFFFD$/u, '');
        bytes -= Buffer.byteLength(text);
        return { text, pageNumber: page.pageNumber, pageLabel: null, partial: !!page.partial || text !== page.text, ocr: false };
      }).filter(page => page.text.trim());
      if (value.needsOcr?.length) { this.limitations.add('ocr_pending'); this.budget.partial = true; }
      if (pages.length) this.zoteroMcpReads.add(document.id);
    }
    if (!pages) { this.limitations.add('original_unavailable'); this.budget.partial = true; return { evidence: [], scopeId: this.scope.id, partial: true }; }
    this.validate(); assertResearchDocument(this.scope, documentId, researchCorpusInventory().documents.find(item => item.id === documentId));
    const evidence: ResearchEvidence[] = [];
    for (const page of pages) {
      // Ask the budget before the row is written. The receipt has to come first for its id, so a
      // page the budget then refused still consumed a receipt row and the receipt count stopped
      // equalling the evidence used. The capacity check does not reserve anything; `accept` below
      // still does that, and still handles the duplicate case.
      if (!this.budget.wouldAccept(page.text)) { this.budget.partial = true; continue; }
      const receipt = recordScopedSourcePassage(this.scope, document.id, { passage_id: '', nodus_id: document.workId ?? document.id,
        libraryItemId: library?.id ?? null, attachmentId, attachmentRevision, revision: document.revision, provenance: 'source',
        text: page.text, page_label: page.pageLabel, page_number: page.pageNumber, source_ref: sourceRef, chunk_index: 0,
        work: { title: document.title, authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' } });
      if (!receipt || !this.budget.accept(receipt.passage_id, page.text)) continue;
      this.evidence.set(receipt.passage_id, { id: receipt.passage_id, nodus_id: receipt.nodus_id, label: document.title, summary: page.text,
        authors: document.authors, year: document.year, pageLabel: page.pageLabel, zotero_key: receipt.work.zotero_key,
        citation: `nodus://passage/${encodeURIComponent(receipt.passage_id)}`, score: 1, reason: 'source' });
      evidence.push({ id: receipt.passage_id, documentId: document.id, workId: document.workId, attachmentId,
        attachmentRevision, revision: document.revision, text: page.text,
        locator: { sourceRef: receipt.source_ref, pageNumber: page.pageNumber, pageLabel: page.pageLabel }, provenance: 'source', limitations: page.partial ? ['page_truncated'] : [] });
      this.budget.partial ||= page.partial;
    }
    if (pages.length) this.readDocuments.add(document.id);
    if (!evidence.length) this.limitations.add('no_readable_text');
    this.traversal.push({ query: `original-pages:${read.from}-${read.to ?? read.from}`, sources: [document.id], candidates: pages.length, partial: this.budget.partial });
    return { evidence, scopeId: this.scope.id, partial: this.budget.partial };
  }
  /** Evidence one read of one source may bring. The chat agent reads several sources per turn:
   * handed the whole remaining allowance, its first read of a long work took all of it. */
  stepAllowance(): number {
    const remaining = this.budget.evidenceTokenLimit - this.budget.usedEvidenceTokens;
    return this.agent ? Math.min(remaining, Math.max(1024, Math.floor(this.budget.evidenceTokenLimit / 8))) : remaining;
  }
  /** The authorized source a passage's work belongs to. */
  documentForWork(nodusId: string): ResolvedResearchScope['documents'][number] | undefined {
    this.documentsByWork ??= new Map(this.scope.documents.map(document => [document.workId ?? document.id, document]));
    return this.documentsByWork.get(nodusId);
  }
  /** Distinct sources whose own text is in the evidence: the voices an answer can cite. */
  supportedDocuments(): Set<string> {
    const ids = new Set<string>();
    for (const item of this.evidence.values()) { const document = this.documentForWork(item.nodus_id); if (document) ids.add(document.id); }
    return ids;
  }
  /** Find authorized sources by who wrote them, what they are called or what their title is
   * about. Reads the catalogue records only; no text is added to the evidence. */
  catalog(query: ResearchCatalogQuery): ResearchCatalogHit[] {
    this.validate();
    const finish = startResearchActivity('scope', 'metadata', [query.author, query.title, query.keywords].filter(Boolean).join(' · '));
    const hits = searchResearchCatalog(this.scope.documents, query);
    for (const hit of hits) {
      if (!this.catalogHits.has(hit.id)) this.catalogHits.set(hit.id, hit);
      if (query.author || query.title) this.namedCatalogHits.add(hit.id);
    }
    this.catalogLookups.push({ query, hits: hits.length });
    finish('completed', hits.length);
    return hits;
  }
  /** Carry the passages earlier answers cited into this turn. A follow-up that brought back
   * only new evidence dropped them, and the answer then disowned its own earlier citations.
   * Each id is resolved through its persisted receipt, which rechecks vault and permission. */
  seedPriorEvidence(history: ReadonlyArray<{ role: string; content: string }>, limit = 12): number {
    this.validate();
    const ids: string[] = [];
    for (const message of [...history].reverse()) {
      if (message.role !== 'assistant') continue;
      for (const ref of extractCitationRefs(message.content)) if (ref.kind === 'passage' && /^(documentary|scoped):/.test(ref.id) && !ids.includes(ref.id)) ids.push(ref.id);
    }
    if (!ids.length) return 0;
    const finish = startResearchActivity('context', 'read');
    // A quarter of the evidence allowance at most: the turn still has to look further.
    let room = Math.floor(this.budget.evidenceTokenLimit / 4);
    for (const id of ids) {
      if (this.priorPassages >= limit) break;
      if (this.evidence.has(id)) continue;
      const detail = id.startsWith('documentary:') ? getDocumentaryPassageDetail(id) : getScopedLegacyPassageDetail(id);
      const document = detail && !detail.historical ? this.documentForWork(detail.nodus_id) : undefined;
      if (!detail || !document) continue;
      const bytes = Buffer.byteLength(detail.text);
      if (bytes > room) continue;
      if (!this.budget.accept(`prior:${id}`, detail.text)) break;
      room -= bytes;
      this.evidence.set(id, { id, label: document.title, summary: detail.text, nodus_id: detail.nodus_id, authors: document.authors, year: document.year,
        pageLabel: detail.page_label, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '',
        citation: `nodus://passage/${encodeURIComponent(id)}`, score: 1, reason: 'prior-turn' });
      this.matchedDocuments.add(document.id);
      this.priorPassages++;
    }
    finish('completed', this.priorPassages);
    return this.priorPassages;
  }
  /** What this turn's research did, in words the answer model can repeat to the reader. */
  researchLog(): string[] {
    const title = (id: string) => {
      const document = this.scope.documents.find(item => item.id === id);
      if (!document) return null;
      const author = document.authors[0]?.split(',')[0]?.trim();
      return `«${document.title}»${author || document.year ? ` (${[author, document.year].filter(Boolean).join(', ')})` : ''}`;
    };
    const log: string[] = [];
    if (this.agent) log.push(`Goal of this turn, as the research agent understood it from the conversation: ${this.agent.plan.goal}`);
    if (this.priorPassages) log.push(`${this.priorPassages} passages cited in earlier answers of this conversation were carried into this turn.`);
    const searches = this.traversal.filter(entry => entry.sources.length !== 1).map(entry => `«${entry.query.slice(0, 160)}»`);
    if (searches.length) log.push(`Searched the indexes of the library for: ${[...new Set(searches)].join('; ')}.`);
    for (const lookup of this.catalogLookups) {
      const hits = [...this.catalogHits.values()].filter(hit => searchResearchCatalog([hit], lookup.query).length).slice(0, 8).map(hit => title(hit.id)).filter(Boolean);
      const asked = [lookup.query.author && `author ${lookup.query.author}`, lookup.query.title && `title ${lookup.query.title}`, lookup.query.keywords && `keywords ${lookup.query.keywords}`].filter(Boolean).join(', ');
      log.push(`Looked up the library catalogue (the user's Zotero and Nodus records: authors, titles, years) for ${asked}: ${lookup.hits ? `${lookup.hits} works, ${hits.join('; ')}` : 'no work matches'}.`);
    }
    const inside = [...new Set(this.traversal.filter(entry => entry.sources.length === 1 && !entry.query.startsWith('original-pages:')).map(entry => entry.sources[0]))].map(title).filter(Boolean);
    if (inside.length) log.push(`Searched inside: ${inside.join('; ')}.`);
    const read = [...this.readDocuments].map(title).filter(Boolean);
    if (read.length) log.push(`Read pages or the surrounding passages of: ${read.join('; ')}.`);
    const mcpRead = [...this.zoteroMcpReads].map(title).filter(Boolean);
    const mcpFailed = [...this.zoteroMcpAttempts].filter(id => !this.zoteroMcpReads.has(id)).map(title).filter(Boolean);
    log.push(this.zoteroMcpAttempts.size ? 'Zotero MCP was requested for original pages.' : 'Zotero MCP was not called in this turn; Zotero-derived records and text, if used, were consulted through the local Nodus library.');
    if (mcpRead.length) log.push(`Original pages returned by Zotero MCP: ${mcpRead.join('; ')}.`);
    if (mcpFailed.length) log.push(`Zotero MCP attempts without readable pages: ${mcpFailed.join('; ')}. Do not claim these originals were read.`);
    const supported = [...this.supportedDocuments()].map(title).filter(Boolean);
    log.push(supported.length ? `Sources whose own text reached this answer: ${supported.join('; ')}.` : 'No source text was found for this turn.');
    return log;
  }
  coverage(): ResearchTraversal {
    return { scopeId: this.scope.id, sourceCount: this.scope.documents.length, rounds: this.budget.rounds,
      evidenceTokens: this.budget.usedEvidenceTokens, decisionTokens: this.budget.decisionTokens, matchedDocumentIds: [...this.matchedDocuments], readDocumentIds: [...this.readDocuments],
      catalogDocumentIds: [...this.catalogHits.keys()],
      attemptedDocumentIds: [...this.attemptedDocuments],
      contextDocumentIds: [...this.contextDocuments],
      sourceCoverage: this.sourceCoverage, limitations: [...this.limitations], partial: this.budget.partial, queries: this.traversal.map(query => ({ ...query, sources: [...query.sources] })) };
  }
  private passage(item: ResearchEvidence): WritingWorkshopPassageCandidate {
    const document = this.scope.documents.find(document => document.id === item.documentId)!;
    const id = documentaryCitationId(this.scope.id, item.id);
    return { id, label: document.title, summary: textWithPageStarts(item.text, item.locator.pageStarts), nodus_id: document.workId ?? document.id,
      authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '',
      pageLabel: item.locator.pageLabel, ...(item.limitations.length ? { limitations: item.limitations } : {}), citation: `nodus://passage/${encodeURIComponent(id)}`, score: 1, reason: item.provenance };
  }
  async snapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot> {
    await this.retrieve(brief.objective);
    return this.snapshotFromEvidence(brief);
  }
  snapshotFromEvidence(brief: WritingWorkshopBrief): WritingWorkshopSnapshot {
    this.validate();
    const rankedDocuments = [...this.scope.documents].sort((a, b) => Number([...this.evidence.values()].some(item => item.nodus_id === (b.workId ?? b.id))) - Number([...this.evidence.values()].some(item => item.nodus_id === (a.workId ?? a.id))));
    if (rankedDocuments.length > this.budget.settings.candidates) this.budget.partial = true;
    const works = rankedDocuments.slice(0, this.budget.settings.candidates).map(document => ({ id: document.workId ?? document.id, title: document.title, label: document.title,
      summary: '', score: 0, reason: 'authorized-source', authors: document.authors, year: document.year, themes: [],
      zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '', deepStatus: 'pending' as const, ideaCount: 0, gapCount: 0 }));
    const ideas = [...this.ideas.values()];
    const passages = [...this.evidence.values()];
    const { gaps, contradictions, themes } = this.graphSnapshot ??= this.layers.ideas ? this.graph() : { gaps: [], contradictions: [], themes: [] };
    return { generatedAt: new Date().toISOString(), brief, works, ideas, passages, themes, gaps, contradictions, tutorRoutes: [],
      stats: { works: works.length, ideas: ideas.length, passages: passages.length, themes: themes.length, gaps: gaps.length, contradictions: contradictions.length, tutorRoutes: 0 },
      recommendedSelection: { workIds: works.map(work => work.id), ideaIds: ideas.map(idea => idea.id), passageIds: passages.map(passage => passage.id), themeIds: themes.map(theme => theme.id), gapIds: gaps.map(gap => gap.id), contradictionIds: contradictions.map(edge => edge.id), tutorRouteIds: [] } };
  }
  private graph(): Pick<WritingWorkshopSnapshot, 'gaps' | 'contradictions' | 'themes'> {
    const db = getDb();
    const works = JSON.stringify(this.workIds);
    const ideas = JSON.stringify(this.ideaIds);
    const limit = this.budget.settings.passagesPerRound;
    const gaps = (db.prepare(`SELECT id,kind,statement,related_idea,confidence,nodus_id FROM gaps
      WHERE nodus_id IN (SELECT value FROM json_each(?)) AND (related_idea IS NULL OR related_idea IN (SELECT value FROM json_each(?)))
      ORDER BY confidence DESC,id LIMIT ?`).all(works, ideas, limit) as Array<{ id: string; kind: WritingWorkshopSnapshot['gaps'][number]['kind']; statement: string; related_idea: string | null; confidence: number; nodus_id: string }>)
      .filter(row => this.budget.accept(`gap:${row.id}`, row.statement)).map(row => {
        const document = this.scope.documents.find(document => document.workId === row.nodus_id)!;
        this.contextDocuments.add(document.id);
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
        const documents = this.scope.documents.filter(document => document.workId === row.source_work);
        documents.forEach(document => this.contextDocuments.add(document.id));
        return { id: row.id, label: `${row.from_label} / ${row.to_label}`, summary: `${row.from_statement} / ${row.to_statement}`,
        score: row.confidence, reason: 'scoped-contradiction', fromLabel: row.from_label, toLabel: row.to_label, type: row.type, basis: row.basis, confidence: row.confidence,
        sources: documents.map(document => `${document.authors.join('; ')} (${document.year ?? ''})`) };
      })
      .filter(row => this.budget.accept(`contradiction:${row.id}`, row.summary));
    const themes = (db.prepare(`SELECT t.theme_id id,t.label,COUNT(DISTINCT wt.nodus_id) workCount FROM themes t
      JOIN work_themes wt ON wt.theme_id=t.theme_id WHERE wt.nodus_id IN (SELECT value FROM json_each(?))
      GROUP BY t.theme_id ORDER BY workCount DESC,t.theme_id LIMIT ?`).all(works, limit) as Array<{ id: string; label: string; workCount: number }>)
      .filter(row => this.budget.accept(`theme:${row.id}`, row.label)).map(row => ({ ...row, summary: row.label, score: row.workCount, reason: 'scoped-theme', pinned: false, ideaCount: 0 }));
    return { gaps, contradictions, themes };
  }
  async section(input: SectionRetrievalInput, retrieve = true) {
    if (retrieve) await this.retrieve([input.objective, input.sectionTitle, input.purpose, ...input.keyClaims, ...(input.coverageQuestions ?? [])].join('\n'));
    // These exclusions prefer fresh evidence; they are not access revocations.
    // A small corpus must remain citable in later sections after discovery runs
    // out. Reusing already authorized evidence consumes no new retrieval budget.
    const preferUnused = <T extends { id: string }>(items: T[], used: string[], limit: number) =>
      [...items.filter(item => !used.includes(item.id)), ...items.filter(item => used.includes(item.id))].slice(0, limit);
    return { ideas: preferUnused([...this.ideas.values()], input.excludeIdeaIds, input.limits.ideas),
      passages: preferUnused([...this.evidence.values()], input.excludePassageIds, input.limits.passages), evidencePacks: [] };
  }
}

export function bindAcademicCorpusRun(deps: DeepResearchDeps, request: DeepResearchRequest, signal?: AbortSignal): DeepResearchDeps {
  const scope = resolveAcademicRunScope(request.notebookId);
  const settings = validateRetrievalSettings(request.retrieval ?? (request.notebookId ? getResearchNotebook(request.notebookId)?.settings : undefined) ?? RETRIEVAL_PRESETS.deep);
  const run = new ResearchCorpusRun(scope, settings, signal, true);
  let windowPromise: ReturnType<typeof researchModelContextWindow> | undefined;
  const model = request.model ?? getSettings().deepResearchModel ?? getSettings().synthesisModel;
  // One auditor per report: a proposition rejected in any part stays rejected in
  // every later section, summary, limitation and next step.
  const auditor = createResearchProseAuditor(model, signal);
  const coverage = createResearchSectionCoverage(model, signal);
  const auditProse = async (markdown: string) => {
    const sources = () => [...run.evidence.values()].map(item => ({ id: item.id, text: item.summary ?? '', label: item.label, citation: item.citation }));
    const expand = run.budget.settings.autoExpand && run.budget.rounds < run.budget.settings.rounds;
    const initialSources = sources();
    let audit = await auditor.audit(markdown, initialSources, !expand);
    const missing = expand ? audit.claims.find(claim => claim.status === 'removed') : undefined;
    if (missing) {
      await run.retrieve(missing.sentence.slice(0, 1000), 1);
      const expandedSources = sources();
      // An empty retrieval does not change the judge's input. Keep its completed
      // verdicts rather than buying an identical audit that can fail or disagree.
      if (JSON.stringify(expandedSources) === JSON.stringify(initialSources)) auditor.remember(audit);
      else audit = await auditor.audit(markdown, expandedSources);
    } else if (expand) auditor.remember(audit);
    run.validate();
    return { ...audit, passages: [...run.evidence.values()] };
  };
  const bounded: DeepResearchDeps = { ...deps, repairSectionCoverage: coverage.repair, checkSectionCoverage: coverage.check, strictDocumentaryGrounding: true, auditFactualProse: markdown => withResearchValidationThinking(model, () => auditProse(markdown)),
    auditSectionClaims: deps.auditSectionClaims ? (...args) => withResearchValidationThinking(model, () => deps.auditSectionClaims!(...args)) : undefined,
    auditFinalSummary: deps.auditFinalSummary ? (...args) => withResearchValidationThinking(model, () => deps.auditFinalSummary!(...args)) : undefined,
    judgeSectionRevision: deps.judgeSectionRevision ? (...args) => withResearchValidationThinking(model, () => deps.judgeSectionRevision!(...args)) : undefined,
    verifyCitations: deps.verifyCitations ? (...args) => withResearchValidationThinking(model, () => deps.verifyCitations!(...args)) : undefined,
    checkCoherence: deps.checkCoherence ? (...args) => withResearchValidationThinking(model, () => deps.checkCoherence!(...args)) : undefined,
    auditReportConsistency: statements => withResearchValidationThinking(model, () => findResearchConflicts(statements, model, signal)), buildSnapshot: async brief => {
    await run.investigate(brief.objective, model);
    const snapshot = run.snapshotFromEvidence(brief);
    if (!deps.prepareScopedSnapshot) return snapshot;
    const result = await deps.prepareScopedSnapshot(snapshot, async queries => {
      run.validate();
      const available = Math.max(0, Math.min(3, settings.rounds - run.budget.rounds - 1));
      for (const query of queries.slice(0, available)) await run.retrieve(query);
      if (queries.length > available) run.budget.partial = true;
      return run.snapshotFromEvidence(brief);
    });
    run.validate();
    return result;
  }, retrieveForSection: async input => {
    await run.investigate([input.objective, input.sectionTitle, input.purpose, ...input.keyClaims].join('\n'), model);
    return run.section(input, false);
  }, researchTraversal: async () => run.coverage(),
    // Basic searchable documents are independent from optional enriched analyses.
    preparePlanEvidence: undefined,
    finalize: input => deps.finalize({ ...input, supportConcerns: [...(input.supportConcerns ?? []),
      ...(run.budget.partial ? ['Documentary coverage is partial; do not infer absence from missing evidence.'] : []), ...[...run.limitations].map(describeResearchLimitation)] }) };
  return new Proxy(bounded, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return async (...args: unknown[]) => {
      run.validate();
      const window = await (windowPromise ??= model ? researchModelContextWindow(resolveModelRef(model)) : Promise.resolve({ tokens: 32768, known: false }));
      // Reserve three quarters for instructions, planning/history, tool framing
      // and output; every actual completion checks its complete final envelope using
      // the same byte-as-token bound. No characters/token conversion applies here.
      run.budget.constrainToWindow(window.tokens, Math.ceil(window.tokens * 0.75));
      const result = await withResearchRequestBudget(window.tokens, () => { run.budget.partial = true; }, () => value(...args));
      run.validate(); return result;
    };
  } });
}
