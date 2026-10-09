/** Documentary retrieval contracts. No credentials or model-generated permissions. */
export interface ResearchSourceReference {
  kind: 'work' | 'library-item' | 'library-collection' | 'zotero-collection' | 'note' | 'conversation-attachment';
  id: string;
  libraryId?: string;
  libraryType?: 'user' | 'group';
  includeDescendants?: boolean;
}

export type RetrievalPreset = 'fast' | 'balanced' | 'deep' | 'custom';
export interface RetrievalSettings {
  preset: RetrievalPreset;
  candidates: number;
  passagesPerRound: number;
  evidenceTokens: number;
  rounds: number;
  autoExpand: boolean;
  threshold: { mode: 'automatic' } | { mode: 'manual'; value: number; embeddingSpace: string; metric: 'cosine' };
}
export const RETRIEVAL_PRESETS: Readonly<Record<Exclude<RetrievalPreset, 'custom'>, RetrievalSettings>> = {
  fast: { preset: 'fast', candidates: 24, passagesPerRound: 6, evidenceTokens: 4000, rounds: 1, autoExpand: true, threshold: { mode: 'automatic' } },
  balanced: { preset: 'balanced', candidates: 60, passagesPerRound: 12, evidenceTokens: 8000, rounds: 3, autoExpand: true, threshold: { mode: 'automatic' } },
  deep: { preset: 'deep', candidates: 120, passagesPerRound: 24, evidenceTokens: 16000, rounds: 8, autoExpand: true, threshold: { mode: 'automatic' } },
};

/** Research Chat's agent, when neither the user nor a notebook chose limits. `balanced`
 * left it one or two decisions and one document read per turn: a definition asked of a
 * library holding a dozen works on the genre was answered from a single source. Each
 * search, catalogue lookup and read is a step; the answer model is not charged for them. */
export const RESEARCH_CHAT_AGENT_SETTINGS: Readonly<RetrievalSettings> = {
  preset: 'custom', candidates: 60, passagesPerRound: 12, evidenceTokens: 32000, rounds: 14, autoExpand: true, threshold: { mode: 'automatic' },
};
/** A turn the user asked to keep light (thinking off or minimal) still reads more than one source. */
export const RESEARCH_CHAT_LIGHT_AGENT_SETTINGS: Readonly<RetrievalSettings> = { ...RETRIEVAL_PRESETS.balanced, preset: 'custom', rounds: 6 };
/** Bytes the chat agent's own decisions may spend: each is a separate provider call and
 * must not be bounded by the evidence the answer needs. About eight decisions. */
export const RESEARCH_CHAT_AGENT_DECISION_BYTES = 128_000;

export function validateRetrievalSettings(input: RetrievalSettings): RetrievalSettings {
  if (!input || !['fast', 'balanced', 'deep', 'custom'].includes(input.preset)) throw new Error('Invalid retrieval preset');
  const bounds: Array<[keyof RetrievalSettings, number, number]> = [
    ['candidates', 1, 500], ['passagesPerRound', 1, 100], ['evidenceTokens', 256, 64000], ['rounds', 1, 16],
  ];
  for (const [key, min, max] of bounds) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid retrieval limit: ${key}`);
  }
  if (input.passagesPerRound > input.candidates || typeof input.autoExpand !== 'boolean') throw new Error('Invalid retrieval limits');
  if (!input.threshold || !['automatic', 'manual'].includes(input.threshold.mode)) throw new Error('Invalid retrieval threshold');
  if (input.threshold.mode === 'manual' && (!Number.isFinite(input.threshold.value) || input.threshold.value < -1
      || input.threshold.value > 1 || !input.threshold.embeddingSpace || input.threshold.metric !== 'cosine')) throw new Error('Invalid cosine threshold');
  return { ...input, threshold: { ...input.threshold } };
}

export interface ResearchNotebookInput {
  id?: string;
  name: string;
  description?: string;
  mode: 'fixed' | 'linked';
  sources: ResearchSourceReference[];
  exclusions: string[];
  settings?: RetrievalSettings;
  noteIds?: string[];
  conversationSettings?: { systemPromptId?: string | null; thinkingEffort?: import('./researchReasoning').ResearchEffort };
  /** How the notebook shows in the chat history, like a project. */
  icon?: string | null;
  color?: string | null;
}
export interface ResearchNotebook extends ResearchNotebookInput {
  id: string;
  revision: number;
  resolvedDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchCorpusDocument {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  workId: string | null;
  libraryItemId: string | null;
  noteId?: string;
  conversationAttachment?: { conversationId: string; attachmentId: string };
  sourceWarning?: string;
  authoredKind?: 'user-note' | 'generated-report';
  origin: { kind: 'zotero'; libraryType: 'user' | 'group'; libraryId: string; itemKey: string } | { kind: 'nodus'; id: string };
  revision: string;
  attachmentId: string | null;
  attachments?: Array<{ id: string; revision: string }>;
  coverage: 'metadata' | 'abstract' | 'fulltext';
  permissionRevision: string;
  /** Backend-pinned published content; source revision above remains the live identity. */
  indexedSource?: { revision: string; attachmentId: string | null; attachments?: Array<{ id: string; revision: string }>; indexKeys: string[] };
}

export interface ResolvedResearchScope {
  conversationAttachments?: Array<{ conversationId: string; attachmentId: string; revision: string }>;
  id: string;
  vaultId: string;
  notebookId: string | null;
  notebookRevision: number | null;
  documents: ResearchCorpusDocument[];
  resolvedAt: string;
  permissionFingerprint: string;
  changes: { added: string[]; removed: string[] };
}

export interface ResearchCorpusCollection {
  reference: ResearchSourceReference;
  name: string;
  parentId: string | null;
  documentIds: string[];
  /** Where the collection lives: a Nodus collection, or one of Zotero's. */
  origin?: 'nodus' | 'zotero';
}

/** Where a notebook's documents stand: it is usable once nothing is pending. */
export interface ResearchNotebookPreparation {
  total: number;
  ready: number;
  pending: number;
  /** Documents that could not be indexed; they do not hold the notebook back. */
  failed: Array<{ documentId: string; title: string; reason: DocumentPreparationState['reason']; error: string | null }>;
  /** Documents nobody has asked to index yet; the notebook queues them. */
  unprepared: string[];
  paused: boolean;
}

/** One notebook's readiness from the preparation inventory. A document is done once its text
 * is searchable and, when an embedding model can run, its vectors are too; a document that
 * failed is reported and left behind rather than holding the notebook forever. */
export function notebookPreparationStatus(documentIds: readonly string[], documents: ReadonlyArray<{ id: string; title: string; preparation: DocumentPreparationState }>, embeddingsExpected: boolean): ResearchNotebookPreparation {
  const byId = new Map(documents.map(document => [document.id, document]));
  const status: ResearchNotebookPreparation = { total: 0, ready: 0, pending: 0, failed: [], unprepared: [], paused: false };
  for (const id of new Set(documentIds)) {
    const document = byId.get(id);
    if (!document) continue;
    const preparation = document.preparation;
    status.total++;
    const fail = () => status.failed.push({ documentId: id, title: document.title, reason: preparation.reason, error: preparation.error });
    if (preparation.status === 'blocked' || preparation.status === 'failed' || preparation.status === 'cancelled') fail();
    else if (preparation.status === 'queued' || preparation.status === 'running') status.pending++;
    else if (preparation.status === 'paused') { status.pending++; status.paused = true; }
    else if (preparation.status === 'catalogued') { status.pending++; status.unprepared.push(id); }
    else if (!embeddingsExpected || preparation.embeddings === 'ready' || preparation.text === 'missing') status.ready++;
    else if (preparation.embeddings === 'queued' || preparation.embeddings === 'running') status.pending++;
    else if (preparation.embeddings === 'failed') fail();
    else { status.pending++; status.unprepared.push(id); }
  }
  return status;
}

/** Every parameter affecting vector comparability belongs in this identity. */
export interface DocumentaryIndexIdentity {
  coverage?: 'fulltext' | 'abstract' | 'metadata';
  documentId: string;
  attachmentId: string | null;
  attachmentRevision?: string;
  revision: string;
  textFingerprint: string;
  chunkerVersion: string;
  processingVersion: string;
  /** Scheme layouts applied to the chunks (electron/ai/schemeCleaning.ts); absent when none. */
  layout?: string;
  embedding: null | { provider: string; model: string; dimensions: number; metric: 'cosine'; parameters: Record<string, string | number | boolean> };
}

export interface ResearchEvidence {
  id: string;
  documentId: string;
  workId: string | null;
  attachmentId: string | null;
  attachmentRevision?: string;
  revision: string;
  text: string;
  locator: { sourceRef: string | null; pageNumber: number | null; pageLabel: string | null; pageEnd?: number; pageStarts?: Array<{ page: number; offset: number }>; charStart?: number; charEnd?: number };
  provenance: 'source' | 'abstract' | 'idea-evidence' | 'profile-support' | 'user-note' | 'generated-report';
  limitations: string[];
}

export interface ResearchTraversal {
  sourceCoverage?: Array<{ documentId: string; title: string; reasons: string[] }>;
  /** Sources whose individual detail was replaced by counts, once per reason per source. */
  omittedSourceCoverage?: { count: number; reasonCounts: Record<string, number> };
  decisionTokens?: number;
  matchedDocumentIds?: string[];
  readDocumentIds?: string[];
  /** Authorized individual operations, including empty, unavailable or budget-blocked reads. */
  attemptedDocumentIds?: string[];
  catalogDocumentIds?: string[];
  /** Sources behind consulted ideas or graph records, without claiming a text match or read. */
  contextDocumentIds?: string[];
  limitations?: string[];
  scopeId: string;
  sourceCount: number;
  rounds: number;
  evidenceTokens: number;
  partial: boolean;
  queries: Array<{ query: string; sources: string[]; candidates: number; partial: boolean;
    /** A stored whole-scope search references its scope instead of repeating every ID. */
    scope?: { id: string; sourceCount: number } }>;
}

/** What each limitation code means, for a model prompt. Codes and field names are
 * internal: an answer that quotes them tells the reader nothing. */
const RESEARCH_LIMITATION_NOTES: Readonly<Record<string, string>> = {
  budget_exhausted: 'The research used its evidence or decision allowance, so it could not search or read further; relevant passages may remain unread.',
  embedding_provider_unavailable: 'Semantic search was unavailable, so only word matching was used.',
  research_decision_unavailable: 'The step that chooses further searches failed, so no further search was made.',
  research_decision_outside_scope: 'A proposed further search pointed outside the authorized sources and was not run.',
  repeated_action: 'A further search would only have repeated an earlier one.',
  original_revision_changed: 'An original changed during the research and was not read.',
  ocr_pending: 'Some scanned pages have no recognized text yet.',
  ocr_required: 'This source needs character recognition before its text can be searched.',
  research_read_unavailable: 'A requested reading of a source could not be completed.',
  no_matches: 'A search inside a source found no matching passage; this does not show that the source lacks the information.',
  local_original_unavailable: 'The local copy of an original was unavailable.',
  original_unavailable: 'An original could not be read.',
  no_readable_text: 'An original was opened but had no readable text.',
  abstract_only: 'Only the abstract of this source is available.',
  text_pending: 'This source has no search index yet; its content is only available by reading its original.',
  embeddings_pending: 'This source has no semantic index yet.',
  previous_indexed_revision: 'Evidence comes from an older indexed version of this source.',
  no_model: 'No embedding model is available for this source.',
  provider_failed: 'Indexing this source failed at the embedding provider.',
  extraction_failed: 'The text of this source could not be extracted.',
};
export function describeResearchLimitation(code: string): string {
  return RESEARCH_LIMITATION_NOTES[code] ?? 'Another retrieval limit applied to this research.';
}
/** Research Chat names the sources that took part in the turn, with who wrote them; the
 * rest of the library is counted, not listed. Listing all 1,223 sources of a library,
 * each with the same repeated notes and no author, made a 310,000-character prompt in
 * which the answer said indexed works had no index and that the list gave no authors. */
export interface ResearchScopePromptFocus {
  /** Sources the agent found in the catalogue, in addition to those with passages or reads. */
  documentIds: Iterable<string>;
  documents: ReadonlyArray<{ id: string; authors: string[]; year: number | null }>;
  limit?: number;
}
type ScopePromptSource = { title: string; authors?: string[]; year?: number; passages_found: boolean; original_read?: true; notes?: string[] };

/** Large chat records keep the turn's sources and summarize the rest. Whole-scope
 * searches reference the scope; individual attempts keep their IDs, even without hits.
 * Only the stored copy is compacted: the live run and model prompt retain full coverage. */
export const STORED_COVERAGE_LIMIT = 60;
export function compactResearchTraversal(coverage: ResearchTraversal): ResearchTraversal {
  const all = coverage.sourceCoverage ?? [];
  if (all.length <= STORED_COVERAGE_LIMIT || coverage.omittedSourceCoverage) return coverage;
  const scopeIds = new Set(all.map(source => source.documentId));
  const completeScope = all.length === coverage.sourceCount && scopeIds.size === coverage.sourceCount;
  const queries = coverage.queries.map(query => completeScope && query.sources.length === scopeIds.size
    && query.sources.every(id => scopeIds.has(id)) && new Set(query.sources).size === scopeIds.size
    ? { ...query, sources: [], scope: { id: coverage.scopeId, sourceCount: coverage.sourceCount } } : query);
  const involved = new Set([...(coverage.matchedDocumentIds ?? []), ...(coverage.readDocumentIds ?? []),
    ...(coverage.attemptedDocumentIds ?? []), ...(coverage.catalogDocumentIds ?? []), ...(coverage.contextDocumentIds ?? []),
    ...queries.flatMap(query => query.sources)]);
  const kept: NonNullable<ResearchTraversal['sourceCoverage']> = [];
  const counts = new Map<string, number>();
  let omitted = 0;
  for (const source of all) {
    if (involved.has(source.documentId)) kept.push(source);
    else {
      omitted++;
      for (const reason of new Set(source.reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  if (!omitted && queries.every((query, index) => query === coverage.queries[index])) return coverage;
  return { ...coverage, sourceCoverage: kept, queries,
    ...(omitted ? { omittedSourceCoverage: { count: omitted, reasonCounts: Object.fromEntries(counts) } } : {}) };
}

/** The run's coverage as a model should read it: titles and plain descriptions, without
 * identifiers, counters or codes. The stored record keeps the codes for the interface. */
export function researchScopeForPrompt(coverage: ResearchTraversal, focus?: ResearchScopePromptFocus): { sources: ScopePromptSource[]; other_sources?: { count: number; notes: string[] }; search_may_be_incomplete: boolean; limits?: string[] } {
  const matched = new Set(coverage.matchedDocumentIds ?? []);
  const read = new Set(coverage.readDocumentIds ?? []);
  const limits = [...new Set(coverage.limitations ?? [])].map(describeResearchLimitation);
  const all = coverage.sourceCoverage ?? [];
  // Only a positive original read is stated: indexed passages are already the source's own
  // text, and "original not read" was taken by answers to mean "only summaries were seen".
  const describe = (source: NonNullable<ResearchTraversal['sourceCoverage']>[number]): ScopePromptSource => {
    const document = focus?.documents.find(item => item.id === source.documentId);
    return { title: source.title, ...(document?.authors.length ? { authors: document.authors.slice(0, 4) } : {}), ...(document?.year != null ? { year: document.year } : {}),
      passages_found: matched.has(source.documentId), ...(read.has(source.documentId) ? { original_read: true as const } : {}),
      ...(source.reasons.length ? { notes: [...new Set(source.reasons)].map(describeResearchLimitation) } : {}) };
  };
  const search = { search_may_be_incomplete: coverage.partial, ...(limits.length ? { limits } : {}) };
  if (!focus) return { sources: all.map(describe), ...search };
  // A catalogue find the turn did not reach says so: without it, an answer blamed a missing
  // index for a work that was indexed and simply not read within the turn's limits.
  const unreached = (source: ScopePromptSource) => source.passages_found || source.original_read ? source
    : { ...source, notes: [...(source.notes ?? []), 'Found in the library catalogue; this turn did not read it within its limits.'] };
  const wanted = new Set([...read, ...matched, ...focus.documentIds]);
  // Read first, then passages found, then catalogue finds: the cap drops the least involved.
  const rank = (id: string) => read.has(id) ? 0 : matched.has(id) ? 1 : 2;
  const listed = all.filter(source => wanted.has(source.documentId)).sort((a, b) => rank(a.documentId) - rank(b.documentId)).slice(0, focus.limit ?? 40);
  const shown = new Set(listed.map(source => source.documentId));
  const rest = all.filter(source => !shown.has(source.documentId));
  const counts = new Map<string, number>();
  for (const source of rest) for (const reason of new Set(source.reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const notes = [...counts].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} of them: ${describeResearchLimitation(reason)}`);
  return { sources: listed.map(source => unreached(describe(source))), ...(rest.length ? { other_sources: { count: rest.length, notes } } : {}), ...search };
}

export type ResearchDocumentRead =
  | { kind: 'search'; query: string }
  | { kind: 'pages'; from: number; to?: number; attachmentId?: string }
  | { kind: 'context'; passageId: string; radius?: number }
  | { kind: 'references'; query?: string };

export function validateResearchDocumentRead(input: ResearchDocumentRead): ResearchDocumentRead {
  if (!input || !['search', 'pages', 'context', 'references'].includes(input.kind)) throw new Error('Invalid document operation');
  if ((input.kind === 'search' && (typeof input.query !== 'string' || !input.query.trim()))
    || ((input.kind === 'search' || input.kind === 'references') && input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 1000))) throw new Error('Invalid document query');
  if (input.kind === 'pages' && (!Number.isSafeInteger(input.from) || input.from < 1 || input.from > 1000000
    || (input.to !== undefined && (!Number.isSafeInteger(input.to) || input.to < input.from || input.to - input.from > 3))
    || (input.attachmentId !== undefined && (typeof input.attachmentId !== 'string' || input.attachmentId.length > 256)))) throw new Error('Invalid physical page range');
  if (input.kind === 'context' && (typeof input.passageId !== 'string' || !/^[a-f0-9]{64}:\d+$/.test(input.passageId)
    || (input.radius !== undefined && (!Number.isInteger(input.radius) || input.radius < 0 || input.radius > 3)))) throw new Error('Invalid context locator');
  return { ...input };
}

/** A partial or merged derivative cannot prove coverage of independent files. */
export function unpreparedResearchAttachmentIds(document: ResearchCorpusDocument, indexes: DocumentaryIndexIdentity[]): string[] {
  const expected = document.indexedSource?.attachments ?? document.attachments ?? [];
  const revision = document.indexedSource?.revision ?? document.revision;
  return expected.filter(attachment => !indexes.some(index => index.revision === revision
    && index.attachmentId === attachment.id && index.attachmentRevision === attachment.revision
    && (index.coverage ?? document.coverage) === 'fulltext')).map(attachment => attachment.id);
}

export interface DocumentPreparationState {
  documentId: string;
  revision: string;
  text: 'missing' | 'available' | 'abstract';
  lexical: 'missing' | 'ready' | 'stale';
  embeddings: 'missing' | 'queued' | 'running' | 'ready' | 'partial' | 'stale' | 'failed';
  status: 'blocked' | 'catalogued' | 'queued' | 'running' | 'paused' | 'ready' | 'failed' | 'cancelled';
  reason: 'no_attachment' | 'not_downloaded' | 'inaccessible' | 'extraction_failed' | 'ocr_required' | 'no_model' | 'provider_failed' | null;
  error: string | null;
  passages: number;
  embedded: number;
  /** Known source files lacking a complete compatible text index. */
  unpreparedAttachmentIds?: string[];
}

export interface ZoteroMcpStatus {
  externalUrl?: string | null;
  automatic?: boolean;
  sessionId?: string | null;
  activeSessions?: number;
  notebookId?: string | null;
  scopeId?: string | null;
  installed: boolean;
  mode: 'managed' | 'external';
  state: 'disabled' | 'stopped' | 'starting' | 'connected' | 'zotero_unavailable' | 'incompatible' | 'startup_error' | 'endpoint_error';
  version: string | null;
  transport: 'stdio' | 'streamable-http';
  error: string | null;
}

export interface ResearchPreparationInventory {
  enabled: boolean;
  embeddingSpaces?: Array<{ id: string; provider: string; model: string; dimensions: number; metric: 'cosine' }>;
  documents: Array<ResearchCorpusDocument & { preparation: DocumentPreparationState }>;
}

/** Asking to index more documents than this at once asks for confirmation first. */
export const RESEARCH_INDEX_CONFIRMATION_THRESHOLD = 100;
export interface ResearchIndexRequestResult {
  /** Works asked for that are documents of this vault. */
  requested: number;
  /** Documents queued now for text and embeddings. */
  queued: number;
  /** Documents whose text and embeddings were already ready. */
  alreadyIndexed: number;
  embeddingAvailable: boolean;
  /** Set, with nothing queued, when this many documents need an explicit confirmation. */
  confirmationRequired?: number;
}

export interface ResearchCorpusApi {
  getResearchPreparationPolicy(): Promise<ResearchPreparationPolicy>;
  setResearchPreparationPolicy(input: { welcomeVersion?: number; decision?: ResearchPreparationPolicy['decision']; futureAdditions?: boolean }): Promise<ResearchPreparationPolicy>;
  /** `inspect: false` skips the per-file preflight (it opens every unindexed PDF) for callers that do not show it. */
  previewResearchPreparation(input: { scope: 'vault' | 'selection'; documentIds?: string[]; inspect?: boolean }): Promise<ResearchPreparationPreview>;
  startResearchPreparationCampaign(input: { previewId: string; mode: 'embeddings' | 'text'; documentIds?: string[] }): Promise<string>;
  getResearchPreparationProgress(): Promise<ResearchPreparationProgress>;
  onResearchPreparationProgress(listener: (progress: ResearchPreparationProgress) => void): () => void;
  controlResearchPreparationCampaign(input: { campaignId: string; action: ResearchPreparationAction; documentId?: string }): Promise<void>;
  controlAllResearchPreparation(action: ResearchPreparationAction): Promise<void>;
  getResearchCorpusSources(): Promise<{ documents: ResearchCorpusDocument[]; collections: ResearchCorpusCollection[] }>;
  listResearchNotebooks(): Promise<ResearchNotebook[]>;
  saveResearchNotebook(input: ResearchNotebookInput): Promise<ResearchNotebook>;
  deleteResearchNotebook(id: string): Promise<void>;
  resolveResearchNotebook(id: string): Promise<ResolvedResearchScope>;
  /** Rename or restyle a notebook without touching what it reads. */
  updateResearchNotebookAppearance(id: string, patch: { name?: string; icon?: string | null; color?: string | null }): Promise<ResearchNotebook>;
  /** Where the notebook's documents stand; anything not asked for yet is queued first. */
  getResearchNotebookPreparation(id: string): Promise<ResearchNotebookPreparation>;
  searchResearchNotebook(id: string, query: string): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }>;
  readResearchDocument(input: { notebookId?: string | null; documentId: string; operation: ResearchDocumentRead }): Promise<{ evidence: ResearchEvidence[]; scopeId: string; partial: boolean }>;
  getResearchPreparationInventory(): Promise<ResearchPreparationInventory>;
  prepareResearchDocuments(documentIds: string[]): Promise<void>;
  /** Index works of the active vault now (all of them without workIds), no dialog. */
  indexResearchWorks(input: { workIds?: string[]; confirmed?: boolean }): Promise<ResearchIndexRequestResult>;
  cancelResearchDocuments(documentIds: string[]): Promise<void>;
  setResearchPreparationEnabled(enabled: boolean): Promise<void>;
  setResearchPreparationPaused(paused: boolean): Promise<void>;
  setResearchZoteroAutomatic(enabled: boolean): Promise<ZoteroMcpStatus>;
  getZoteroMcpStatus(notebookId?: string | null): Promise<ZoteroMcpStatus>;
  connectResearchZotero(input: { notebookId?: string | null; mode: 'managed' | 'external'; externalUrl?: string }): Promise<ZoteroMcpStatus>;
  disconnectResearchZotero(notebookId?: string | null): Promise<void>;
  readResearchZotero(input: { notebookId?: string | null; documentId: string; operation: 'metadata' | 'fulltext'; attachmentKey?: string }): Promise<unknown>;
}

/** User-visible preparation contracts contain no credentials or provider URLs. */
export interface ResearchPreparationPolicy {
  vaultId: string;
  welcomeVersion: number;
  decision: 'pending' | 'accepted' | 'declined';
  futureAdditions: boolean;
}
export interface ResearchPreparationPreview {
  id: string;
  vaultId: string;
  createdAt: number;
  documents: ResearchPreparationInventory['documents'];
  embedding: { provider: string; model: string; external: boolean } | null;
  embeddingAvailable: boolean;
  block: 'no_model' | null;
  preflight?: Array<{ documentId: string; status: 'available' | 'abstract' | 'inaccessible' | 'ocr_pending' | 'unknown'; pages: number | null; reason: string | null }>;
}
export type ResearchPreparationAction = 'pause' | 'resume' | 'cancel' | 'retry';
export interface ResearchPreparationJob {
  id: string;
  documentId: string;
  title: string;
  state: 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled' | 'blocked';
  stage: 'ocr' | 'extraction' | 'lexical' | 'embeddings' | 'complete';
  completedPassages: number;
  totalPassages: number | null;
  unknownRequests: number;
  currentPage?: number | null;
  totalPages?: number | null;
  error: string | null;
}
export interface ResearchPreparationCampaign {
  id: string;
  vaultId: string;
  vaultName: string;
  createdAt: number;
  updatedAt: number;
  state: 'active' | 'paused' | 'cancelled';
  embedding: ResearchPreparationPreview['embedding'];
  jobs: ResearchPreparationJob[];
}
export interface ResearchPreparationProgress {
  paused: boolean;
  campaigns: ResearchPreparationCampaign[];
}
