import { researchActivityStep, startResearchActivity } from './researchActivity';
import { researchIndexedTextsAlone, type ResearchCorpusLayers } from '@shared/researchContextLayers';
import type { ResearchDocumentRead, ResearchEvidence, ResearchTraversal, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { RETRIEVAL_PRESETS, RESEARCH_LONGFORM_AGENT_SETTINGS, RESEARCH_AGENT_DECISION_BYTES, describeResearchLimitation, validateRetrievalSettings, validateResearchDocumentRead } from '@shared/researchCorpus';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import { RETRIEVAL_CHUNK_MAX_BYTES, textWithPageStarts } from '@shared/retrievalChunks';
import type { DeepResearchRequest, WritingWorkshopBrief, WritingWorkshopIdeaCandidate, WritingWorkshopPassageCandidate, WritingWorkshopSnapshot } from '@shared/types';
import type { DeepResearchDeps, SectionRetrievalInput } from './deepResearchCore';
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
import { insertScopedReceipts, recordScopedSourcePassage, recordScopedLegacyPassage, type ScopedReceiptRow } from '../citations/scopedLegacyCitations';
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
import { ResearchWebGrant, webDepth } from './researchWebStep';
import { searchResearchCatalog, type ResearchCatalogHit, type ResearchCatalogQuery } from '@shared/researchCatalog';
import type { ResearchTurnPlan } from './researchTurnPlanner';
import { extractCitationRefs } from './citationSanitize';
import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';
import { currentResearchHarness, researchHarnessStage } from './researchHarnessRuntime';
import { researchTaskKey } from '@shared/researchHarness';
import { researchExplorationRetrieval } from '@shared/researchExploration';
import { researchExcerptHasProse } from '@shared/researchDocumentReview';
import type { ResearchAction } from '@shared/researchActions';

/** Research Chat's agent: the turn's plan and how many independent sources a finish needs.
 * Deep Research, the Dictionary and notebook reads leave it unset and keep their loop. */
export interface ResearchChatAgent {
  plan: ResearchTurnPlan;
  /** The user's literal last message, which may only say where or how to search. */
  question: string;
  minSources: number;
  /** A small local window: shorter menus in every decision. */
  compact: boolean;
  /** A route correction: the opening searches only, no supervisor. */
  correction?: boolean;
}

/** Compatibility requests are explicit snapshots of the active vault. A notebook
 * may additionally authorize unlinked Global Library works. Neither path uses a
 * missing filter to mean "all" inside a repository. */
export function resolveAcademicRunScope(notebookId?: string | null): ResolvedResearchScope {
  return notebookId ? resolveResearchNotebook(notebookId) : resolveAcademicResearchScope();
}

/** One run owns the scope, evidence ledger and traversal across all sections. */
export class ResearchCorpusRun {
  readonly harness = currentResearchHarness();
  private readonly completedOperations = new Map<string, unknown>();
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
  /** Optional web access, granted by the request and charged to the shared budget. */
  web?: ResearchWebGrant;
  /** Research Chat and Dictionary: the layers the user left on in the context balloon. Deep Research
   * reads them all. A layer that is off is never consulted, not merely left out of the prompt. */
  layers: ResearchCorpusLayers = { ideas: true, documents: true, indexed: true };
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
  private inventoryMemo?: { at: number; documents: ReturnType<typeof researchCorpusInventory>['documents']; byId: Map<string, ReturnType<typeof researchCorpusInventory>['documents'][number]> };
  /** Receipts found while investigate() runs, written when it ends. See insertScopedReceipts. */
  private pendingReceipts?: ScopedReceiptRow[];
  private readonly sourceCoverage: NonNullable<ResearchTraversal['sourceCoverage']>;
  constructor(readonly scope: ResolvedResearchScope, settings: RetrievalSettings, readonly signal?: AbortSignal, readonly pinRevisions = false) {
    if (this.harness) this.harness.corpus = this;
    if (this.harness) settings = researchExplorationRetrieval(settings, this.harness.record.context.explorationMode ?? 'expanded');
    const fast = this.harness?.record.context.explorationMode === 'fast';
    this.budget = new ResearchRetrievalBudget(settings, settings.evidenceTokens, this.harness ? fast ? 96000 : RESEARCH_AGENT_DECISION_BYTES : settings.evidenceTokens);
    if (this.harness) this.budget.allowAdaptiveTargets((this.harness.record.checkpoint.modelContext as { tokens?: number } | undefined)?.tokens ?? 32768);
    if (fast) {
      this.budget.roundLimit = Math.min(this.budget.roundLimit, settings.rounds + 2);
      this.budget.evidenceTokenLimit = Math.min(this.budget.evidenceTokenLimit, Math.floor(settings.evidenceTokens * 1.5));
    }
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
    const saved = this.harness?.record.checkpoint.corpus as ReturnType<ResearchCorpusRun['checkpointData']> | undefined;
    if (saved) {
      if (saved.scopeId !== scope.id) throw new Error('research_scope_changed');
      for (const [target, entries] of [[this.evidence, saved.evidence], [this.ideas, saved.ideas], [this.catalogHits, saved.catalogHits], [this.completedOperations, saved.operations]] as const) {
        for (const [key, value] of entries) (target as Map<string, unknown>).set(key, value);
      }
      for (const [target, entries] of [[this.matchedDocuments, saved.matched], [this.readDocuments, saved.read], [this.attemptedDocuments, saved.attempted],
        [this.contextDocuments, saved.context], [this.namedCatalogHits, saved.named], [this.zoteroMcpReads, saved.mcpReads], [this.zoteroMcpAttempts, saved.mcpAttempts],
        [this.limitations, saved.limitations], [this.budget.visited, saved.budget.visited]] as const) entries.forEach(entry => target.add(entry));
      this.traversal.push(...saved.traversal); this.catalogLookups.push(...saved.lookups);
      Object.assign(this.budget, { rounds: saved.budget.rounds, usedEvidenceTokens: saved.budget.evidence, decisionTokens: saved.budget.decisions, candidates: saved.budget.candidates, partial: saved.budget.partial });
      this.budget.roundLimit = Math.min(this.budget.roundLimit, saved.budget.roundLimit ?? this.budget.roundLimit);
      this.budget.evidenceTokenLimit = Math.min(this.budget.evidenceTokenLimit, saved.budget.evidenceLimit ?? Infinity);
      this.budget.decisionTokenLimit = Math.min(this.budget.decisionTokenLimit, saved.budget.decisionLimit ?? Infinity);
      this.priorPassages = saved.priorPassages; this.graphSnapshot = saved.graph;
    }
  }
  private checkpointData() {
    return { scopeId: this.scope.id, evidence: [...this.evidence.entries()], ideas: [...this.ideas.entries()], catalogHits: [...this.catalogHits.entries()], operations: [...this.completedOperations.entries()],
      matched: [...this.matchedDocuments], read: [...this.readDocuments], attempted: [...this.attemptedDocuments], context: [...this.contextDocuments], named: [...this.namedCatalogHits],
      mcpReads: [...this.zoteroMcpReads], mcpAttempts: [...this.zoteroMcpAttempts], limitations: [...this.limitations], traversal: this.traversal, lookups: this.catalogLookups,
      priorPassages: this.priorPassages, graph: this.graphSnapshot, researchLog: this.researchLog(),
      budget: { rounds: this.budget.rounds, evidence: this.budget.usedEvidenceTokens, decisions: this.budget.decisionTokens, candidates: this.budget.candidates, partial: this.budget.partial,
        roundLimit: this.budget.roundLimit, evidenceLimit: this.budget.evidenceTokenLimit, decisionLimit: this.budget.decisionTokenLimit, visited: [...this.budget.visited] } };
  }
  checkpoint(interrupted = false): void {
    if (!this.harness) return;
    if (interrupted) this.harness.validateAuthorization(); else this.validate();
    // A checkpoint must never refer to a receipt still only in process memory.
    if (this.pendingReceipts?.length) { insertScopedReceipts(this.pendingReceipts); this.pendingReceipts = []; }
    this.harness.record.checkpoint.corpus = this.checkpointData();
    this.harness.record.summary.usage = { ...this.harness.record.summary.usage, rounds: this.budget.rounds, evidenceBytes: this.budget.usedEvidenceTokens, decisionBytes: this.budget.decisionTokens };
    this.harness.persist();
  }
  /** Academic generators consume one evidence ledger across discovery and later sections. */
  syncWebEvidence(): void {
    if (!this.harness || this.harness.record.context.mode === 'chat') return;
    for (const passage of this.web?.contextPassages() ?? []) this.evidence.set(passage.id, {
      id: passage.id, label: passage.title, summary: passage.text, nodus_id: `web:${passage.id}`,
      authors: [passage.site], year: null, zotero_key: '', pageLabel: passage.page ? String(passage.page) : null,
      citation: passage.citation, score: 1, reason: 'web',
    });
  }
  async perform<T>(action: Exclude<ResearchAction, { action: 'finish' | 'enqueue' | 'defer' }>, execute: () => Promise<T>): Promise<T> {
    if (!this.harness) return execute();
    this.validate(); this.harness.validate();
    const key = researchTaskKey(action);
    if (this.completedOperations.has(key)) return structuredClone(this.completedOperations.get(key)) as T;
    const task = this.harness.agenda.enqueue(action);
    const evidence = () => new Map<string, string>([...this.evidence.values()].map(item => [researchTaskKey({ action: 'search', query: `${item.nodus_id}\n${item.summary}` }), item.id] as [string, string])
      .concat((this.web?.contextPassages() ?? []).map(item => [researchTaskKey({ action: 'search', query: `${item.url}\n${item.text}` }), item.id] as [string, string])));
    const before = evidence();
    if (task) { task.status = 'running'; this.checkpoint(); }
    try {
      const result = await execute();
      this.validate(); this.harness.validate();
      if (task) this.harness.agenda.complete(task, [...evidence()].filter(([key]) => !before.has(key)).map(([, id]) => id));
      this.completedOperations.set(key, result ?? null); this.checkpoint(); return result;
    } catch (error) {
      if (task) {
        if (this.harness.signal.aborted) { task.status = 'pending'; task.note = 'interrupted'; }
        else { this.harness.agenda.complete(task, [], true); task.note = 'read_unavailable'; }
      }
      if (this.harness.signal.aborted) { try { this.checkpoint(true); } catch { /* A revoked scope cannot checkpoint old evidence. */ } }
      else this.checkpoint();
      throw error;
    }
  }
  /** The corpus inventory for this step. Building it reads every work, library item and note,
   * synchronously (~150 ms on a 14,000-work library), and one chat turn asked for it ~96 times:
   * seven times per search and twice per decision. Within a second it is the same inventory; the
   * next step after a model call or a read builds it again, so a change made meanwhile is seen. */
  inventory(): NonNullable<ResearchCorpusRun['inventoryMemo']> {
    if (!this.inventoryMemo || performance.now() - this.inventoryMemo.at > 1000) {
      const documents = researchCorpusInventory().documents;
      this.inventoryMemo = { at: performance.now(), documents, byId: documentsById(documents) };
    }
    return this.inventoryMemo;
  }
  validate(): void {
    this.signal?.throwIfAborted();
    if (getActiveVault().id !== this.scope.vaultId) throw new Error('research_scope_changed');
    if (this.scope.notebookId && getResearchNotebook(this.scope.notebookId)?.revision !== this.scope.notebookRevision) throw new Error('research_scope_changed');
    const current = this.inventory().byId;
    for (const document of this.scope.documents) (this.pinRevisions ? assertResearchDocumentPermission : assertResearchDocument)(this.scope, document.id, current.get(document.id));
    if (this.pinRevisions && this.scope.documents.some(document => current.get(document.id)?.revision !== document.revision)) {
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
    if (this.harness) {
      await this.harness.stage('investigate', query, async () => { await this.investigateUncached(query, model); this.syncWebEvidence(); this.checkpoint(); });
      this.syncWebEvidence();
      return;
    }
    return this.investigateUncached(query, model);
  }
  private async investigateUncached(query: string, model?: ModelRef | null): Promise<void> {
    this.pendingReceipts = [];
    try { await this.investigateSteps(query, model); }
    finally { const rows = this.pendingReceipts; this.pendingReceipts = undefined; insertScopedReceipts(rows); }
  }
  private async investigateSteps(query: string, model?: ModelRef | null): Promise<void> {
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
    // Legacy indexed-only turns keep one literal probe. V1 can refine index
    // searches while its capability grants continue to forbid other layers.
    const alone = researchIndexedTextsAlone(this.layers, !!this.web?.enabled) && !this.harness;
    const branches = this.harness && !alone && !this.agent?.correction && this.budget.settings.autoExpand && this.budget.roundLimit - this.budget.rounds > 1
      ? [...this.agent?.plan.exploration ?? []].sort((a, b) => b.priority - a.priority).slice(0, this.harness.record.context.explorationMode === 'fast' ? 1 : 4) : [];
    for (const branch of branches) this.harness!.agenda.enqueue({ action: 'search', query: branch.query }, branch.question, branch.priority,
      { purpose: branch.purpose, relation: branch.relation });
    const plannedQueries = this.agent && !alone ? [...new Set([...this.agent.plan.queries, ...branches.map(branch => branch.query)])].slice(0, 4).map(each => each.trim()).filter(Boolean) : [];
    const indexAgent = this.harness && researchIndexedTextsAlone(this.layers, !!this.web?.enabled);
    const allQueries = [...new Set(indexAgent && plannedQueries.length ? [...plannedQueries, query] : [query, ...plannedQueries])];
    // Every planned facet gets a literal probe in the first round. Additional
    // semantic probes need room for an entire prepared chunk; fragmenting a small
    // opening allowance over five queries can otherwise admit no evidence at all.
    // Reserve the existing two-thirds allowance when full documents permit
    // decisions and original reads. Other mixed-layer turns retain three probes.
    const remaining = this.budget.evidenceTokenLimit - this.budget.usedEvidenceTokens;
    // A broad harness turn probes the goal and complementary lines separately.
    // Keep a full chunk and a round for later reads; never enlarge the run budget.
    const openingBudget = branches.length ? Math.max(Math.floor(remaining / 3), Math.min(remaining - RETRIEVAL_CHUNK_MAX_BYTES,
      (1 + Math.min(2, branches.length)) * RETRIEVAL_CHUNK_MAX_BYTES)) : Math.floor(remaining / 3);
    const queryLimit = this.agent && !alone
      ? (this.layers.documents || this.harness) ? Math.min(Math.max(1, Math.floor(openingBudget / RETRIEVAL_CHUNK_MAX_BYTES)),
        Math.max(1, this.budget.settings.autoExpand ? this.budget.roundLimit - this.budget.rounds - 1 : 1)) : 3
      : 1;
    const queries = allQueries.slice(0, this.harness?.record.context.explorationMode === 'fast' ? Math.min(2, queryLimit) : queryLimit);
    const opening = Math.floor(openingBudget / queries.length);
    const limit = (this.layers.documents || !!this.harness) && this.budget.settings.autoExpand && this.budget.settings.rounds > 1 ? Math.max(256, opening) : undefined;
    // Each of the chat's opening queries widens the search, the first included; one that fails
    // (a retrieval timeout on a loaded machine) costs its own evidence, not the turn. A run with no
    // agent has only the one query, and its failure is still the run's.
    // All planned facets also enter the lexical lane of the first search, without adding
    // semantic probes. Only the budgeted `queries` are embedded, in one ordered batch.
    const vectors = queries.length > 1 && (this.layers.ideas || this.layers.indexed)
      ? await researchActivityStep('scope', 'embed', () => embedMany(queries, this.signal, { role: 'query' })).catch(() => [])
      : [];
    for (const [index, each] of queries.entries()) {
      try { await this.retrieve(each, 1, limit, vectors[index], index === 0 ? plannedQueries : undefined); }
      catch (error) {
        this.validate();
        if (/not_authorized|scope_changed/.test(error instanceof Error ? error.message : '') || (index === 0 && (!this.agent || alone))) throw error;
        this.budget.partial = true; this.limitations.add('research_read_unavailable');
      }
    }
    // The supervisor's decisions read documents: nothing to decide with the documents off.
    if ((this.layers.documents || (this.harness && (this.web?.enabled || branches.length || this.layers.indexed))) && !alone && !this.agent?.correction) await deepenResearch(this, query, model);
  }
  async retrieve(query: string, expandRounds = 2, roundLimit?: number, embedded?: number[] | null, lexicalQueries?: string[]): Promise<void> {
    return this.perform({ action: 'search', query }, () => this.retrieveUncached(query, expandRounds, roundLimit, embedded, lexicalQueries));
  }
  private async retrieveUncached(query: string, expandRounds = 2, roundLimit?: number, embedded?: number[] | null, lexicalQueries?: string[]): Promise<void> {
    this.validate();
    if (!this.budget.nextRound()) {
      this.traversal.push({ query, sources: this.scope.documents.map(document => document.id), candidates: 0, partial: true });
      return;
    }
    const settings = this.budget.settings;
    if (!this.scope.documents.length) return;
    // The indexed texts are the passages found by search; full documents add what reads the works
    // in depth: their profiles, the passages around each hit and the quotes their ideas carry.
    const { ideas: readIdeas, documents: readDocuments, indexed: readIndexed } = this.layers;
    if (!readIdeas && !readIndexed) { this.traversal.push({ query, sources: [], candidates: 0, partial: false }); return; }
    const vector = embedded !== undefined ? embedded : await researchActivityStep('scope', 'embed', () => embedQuery(query, this.signal)).catch(() => {
      this.limitations.add('embedding_provider_unavailable'); return null;
    });
    this.validate();
    const current = this.inventory().byId;
    // The authorized scope already contains citation metadata. On V1's opening
    // indexed probe, prioritize a named author's own texts without a catalogue
    // action, profiles, originals or any widening of the user's grant.
    const named = this.harness && !readDocuments && readIndexed && this.budget.rounds === 1
      ? this.agent?.plan.authors.flatMap(author => searchResearchCatalog(this.scope.documents, { author }, this.scope.documents.length)) ?? [] : [];
    const priorityIds = new Set(named.map(document => document.id));
    const searchScope = priorityIds.size ? { ...this.scope, documents: this.scope.documents.filter(document => priorityIds.has(document.id)) } : this.scope;
    const stableWorks = this.pinRevisions ? this.scope.documents.filter(document => (!document.indexedSource || document.indexedSource.revision === document.revision) && current.get(document.id)?.revision === document.revision).flatMap(document => document.workId ? [document.workId] : []) : searchScope.documents.flatMap(document => document.workId ? [document.workId] : []);
    const stableIdeas = stableWorks.length === this.workIds.length ? this.ideaIds : [];
    // Without full documents no profiles route the search, so the document lanes (support and
    // routed passages) stay empty too.
    const hierarchy = await retrieveHierarchical(query, { embedding: vector, nodusIds: stableWorks, ideaIds: stableIdeas,
      documentLimit: readDocuments ? settings.candidates : 0, ideaLimit: readIdeas ? settings.passagesPerRound : 0, passageLimit: readIndexed ? settings.candidates : 0,
      minIdeaSimilarity: -1, minPassageSimilarity: -1, minDocumentSimilarity: -1,
      lexicalPassageQueries: lexicalQueries?.length ? [query, ...lexicalQueries] : undefined });
    const usedBeforeRound = this.budget.usedEvidenceTokens;
    const remaining = Math.min(roundLimit ?? Infinity, this.budget.evidenceTokenLimit - usedBeforeRound);
    const acceptRound = (id: string, text: string) => this.budget.usedEvidenceTokens - usedBeforeRound + Buffer.byteLength(text) <= remaining && this.budget.accept(id, text);
    const expansion = settings.autoExpand && readDocuments ? Math.max(1, Math.min(expandRounds, this.budget.roundLimit - this.budget.rounds + 1)) : 1;
    const shared = readIndexed && remaining >= 256 ? await retrieveSharedDocumentaryEvidence(searchScope, query,
      { ...settings, rounds: expansion, evidenceTokens: remaining }, vector, this.signal, undefined,
      () => this.inventory().documents, lexicalQueries) : { evidence: [], traversal: { rounds: 1, candidates: 0, partial: true } };
    for (let round = 1; round < shared.traversal.rounds; round++) this.budget.nextRound();
    this.validate();
    // Interleave independent native/shared lanes, retaining source diversity.
    const candidates = shared.evidence.map(item => this.passage(item));
    // The quotes analysed ideas carry are derived from the graph, not the indexed text.
    const separable = readDocuments ? scopedIdeaEvidencePassages(query, stableWorks, settings.candidates) : [];
    const inventory = this.inventory().documents;
    const legacy = selectPassageEvidence([...hierarchy.passages, ...separable], settings.passagesPerRound, { preferLexical: true, preferSourceDiversity: true }).flatMap(hit => {
      const receipt = recordScopedLegacyPassage(this.scope, hit.passage_id, inventory, this.pendingReceipts);
      return receipt ? [{ id: receipt.passage_id, label: hit.title, summary: receipt.text, nodus_id: hit.nodus_id, pageLabel: receipt.page_label,
        authors: this.scope.documents.find(document => document.workId === hit.nodus_id)?.authors ?? [], year: hit.year, zotero_key: hit.zotero_key,
        citation: `nodus://passage/${encodeURIComponent(receipt.passage_id)}`, score: hit.similarity, reason: 'source' }] : [];
    });
    let selected = 0;
    for (let index = 0; index < Math.max(candidates.length, legacy.length); index++) for (const candidate of [candidates[index], legacy[index]]) {
      if (!candidate || this.harness && !researchExcerptHasProse(candidate.summary)) continue;
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
    this.traversal.push({ query, sources: searchScope.documents.map(document => document.id), candidates: hierarchy.passages.length + separable.length + shared.traversal.candidates, partial: this.budget.partial });
    recordEmbeddingTrace({ type: 'research-evidence-selection', query, scopeId: this.scope.id,
      sharedCandidates: shared.evidence.map(item => ({ id: item.id, documentId: item.documentId, provenance: item.provenance })),
      legacyCandidates: legacy.map(item => ({ id: item.id, reason: item.reason })),
      selectedPassages: [...this.evidence.keys()], selectedIdeas: [...this.ideas.keys()],
      limitations: [...this.limitations], partial: this.budget.partial });
  }
  async readDocument(documentId: string, operation: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }> {
    return this.perform({ action: 'read', documentId, operation }, () => this.readDocumentUncached(documentId, operation));
  }
  private async readDocumentUncached(documentId: string, operation: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }> {
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
      { ...this.budget.settings, rounds: 1, autoExpand: false, evidenceTokens: this.stepAllowance() }, null, this.signal, read, () => this.inventory().documents);
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
    return this.perform({ action: 'original', documentId, from: read.from, to: read.to, attachmentId: read.attachmentId }, () => this.readOriginalUncached(documentId, read, counted));
  }
  private async readOriginalUncached(documentId: string, read: Extract<ResearchDocumentRead, { kind: 'pages' }>, counted = false): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }> {
    this.validate(); validateResearchDocumentRead(read);
    const document = this.scope.documents.find(item => item.id === documentId);
    if (!document) throw new Error('research_source_not_authorized');
    const current = this.inventory().byId.get(documentId);
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
    this.validate(); assertResearchDocument(this.scope, documentId, this.inventory().byId.get(documentId));
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
        work: { title: document.title, authors: document.authors, year: document.year, zotero_key: document.origin.kind === 'zotero' ? document.origin.itemKey : '' } }, this.inventory().documents, this.pendingReceipts);
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
    // Prepared documentary chunks can occupy 4 KB. A 2 KB per-action share
    // silently discarded later facets even with half the global budget unused.
    const minimum = this.harness ? RETRIEVAL_CHUNK_MAX_BYTES : 1024;
    return this.agent ? Math.min(remaining, Math.max(minimum, Math.floor(this.budget.evidenceTokenLimit / 8))) : remaining;
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
    // A retrieved subset is not a bibliography. Give the writer the actual
    // metadata inventory for named authors, inside the authorized scope only.
    if (this.layers.documents) for (const author of new Set(this.catalogLookups.map(lookup => lookup.query.author?.trim()).filter((name): name is string => Boolean(name)))) {
      const matches = searchResearchCatalog(this.scope.documents, { author }, this.scope.documents.length);
      log.push(`Complete catalogue metadata query in this authorized scope: ${JSON.stringify({ author, totalMatchingRecords: matches.length,
        examplesTruncated: matches.length > 6, examples: matches.slice(0, 6).map(hit => ({ title: hit.title, authors: hit.authors, year: hit.year })) })}. Matching credits may include coauthors or editors. This is not a list of originals read, and the examples are not the complete catalogue when truncated.`);
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
  const settings = validateRetrievalSettings(request.retrieval ?? (request.notebookId ? getResearchNotebook(request.notebookId)?.settings : undefined) ?? (currentResearchHarness() ? RESEARCH_LONGFORM_AGENT_SETTINGS : RETRIEVAL_PRESETS.deep));
  const run = new ResearchCorpusRun(scope, settings, signal, true);
  if (run.harness) {
    run.web = new ResearchWebGrant(request.webSearch ?? 'off', webDepth(settings), request.objective, signal, request.model,
      Math.floor(run.budget.evidenceTokenLimit / 3));
  }
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
    if (run.harness) run.budget.phaseRoundLimit = Math.min(settings.rounds, run.budget.rounds + Math.max(1, Math.floor(settings.rounds / 3)));
    try { await run.investigate(brief.objective, model); }
    finally { run.budget.phaseRoundLimit = Infinity; }
    if (run.web) {
      await run.web.afterLibrary({ evidence: run.evidence.size, matched: run.matchedDocuments.size, supervised: run.supervised, titles: [] });
      run.syncWebEvidence();
      run.checkpoint();
    }
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
  if (run.harness) {
    bounded.continuousNarrative = true;
    // Keep deterministic citation/source guards; let the evidence-informed
    // writer own synthesis. Post-hoc entailment pruning removed antecedents and
    // qualified interpretations, breaking the report's connected argument.
    // The harness adds no mandatory model-review or automatic rewrite chain.
    bounded.verifyCitations = undefined;
    bounded.reviseSection = undefined;
    bounded.auditFactualProse = undefined;
    bounded.auditReportConsistency = undefined;
    bounded.auditSectionClaims = undefined;
    bounded.auditPlanCoverage = undefined;
    bounded.auditFinalSummary = undefined;
    bounded.judgeSectionRevision = undefined;
    bounded.reviewReport = undefined;
    bounded.checkCoherence = undefined;
    bounded.repairSectionCoverage = undefined;
    bounded.checkSectionCoverage = undefined;
  }
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
      const execute = () => withResearchRequestBudget(window.tokens, () => { run.budget.partial = true; }, () => value(...args));
      const result = await (run.harness && !['researchTraversal', 'auditFactualProse', 'auditReportConsistency', 'finalDocumentReview'].includes(String(property))
        ? researchHarnessStage(`deep.${String(property)}`, args, execute) : execute());
      if (run.harness && property === 'decomposeObjective' && Array.isArray(result)) for (const question of result) if (typeof question === 'string') run.harness.agenda.addQuestion(question);
      run.validate(); return result;
    };
  } });
}
