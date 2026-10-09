import { listResearchNotebooks } from '../db/researchNotebooksRepo';
import { selectResearchDocuments } from './researchCorpusScope';
import { researchActivityEnabled, startResearchActivity } from './researchActivity';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { backgroundProcess, type BackgroundProcess } from '../workers/backgroundProcess';
import { createHash } from 'node:crypto';
import { RETRIEVAL_CHUNKER_VERSION } from '@shared/retrievalChunks';
import { unpreparedResearchAttachmentIds } from '@shared/researchCorpus';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument, ResearchDocumentRead, ResearchEvidence, ResearchPreparationInventory, ResolvedResearchScope, RetrievalSettings } from '@shared/researchCorpus';
import { DocumentaryRequests } from '../db/documentaryRequests';
import { DocumentaryCampaigns } from '../db/documentaryCampaigns';
import { DocumentaryStore, type DocumentaryChunk } from '../db/documentaryStore';
import { schemeCleaningFor, type SchemeCleaning } from './schemeCleaning';
import { documentaryChunks } from './documentaryChunking';
import { researchCorpusInventory } from './researchCorpusInventory';
import { assertResearchDocumentPermission, documentsById, researchFingerprint } from './researchCorpusScope';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { getGlobalLibraryItem } from '../library/libraryService';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { embedMany, effectiveEmbeddingConfig, type EmbeddingExecutionConfig } from './aiClient';
import { DocumentaryEmbeddingBatches } from '../db/documentaryEmbeddingBatches';
import { storedDocumentaryVector } from '../db/documentaryVectors';
import { mapOrderedPool } from './orderedPool';
import { getWork } from '../db/worksRepo';
import { readResearchAttachmentSource } from './researchAttachmentSources';
import { getNote } from '../db/notesRepo';
import { getSettings } from '../db/settingsRepo';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { documentarySourceText, documentaryReaderComplete, readDocumentarySourceMap, extractTraditionalResearchWork, extractGlobalResearchAttachments, DOCUMENTARY_EXTRACTION_OPTIONS, type DocumentarySourcePart } from './documentaryExtraction';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { getActiveVault, getVault, listVaults, withOwningVault, withoutOwningVault } from '../vaults/vaultRegistry';
import { withVaultDatabase, withoutDatabaseContext } from '../db/database';
import { notifyDocumentaryPreparation } from './documentaryPreparationEvents';
import { onResearchCorpusChanged } from './researchCorpusEvents';

let shared: DocumentaryStore | null = null;
let stopping = false;
let corpusPoll: ReturnType<typeof setInterval> | null = null;
export function documentaryStore(): DocumentaryStore {
  if (!shared) {
    const directory = path.join(app.getPath('userData'), 'documentary');
    fs.mkdirSync(directory, { recursive: true });
    shared = new DocumentaryStore(path.join(directory, 'store.sqlite'));
    new DocumentaryCampaigns(shared.db);
    convertLegacyVectorsInBackground();
  }
  return shared;
}
let vectorConversion: ReturnType<typeof setTimeout> | null = null;
let vectorCursor = 0;
/** Stores written before vectors were binary hold each one twice as JSON: in the passage
 * and in its finished working copy. Both are rewritten in short batches in the
 * background (about 20 ms each on the main thread); semantic search reads either
 * format meanwhile. Afterwards the store is compacted once preparation is idle. */
function convertLegacyVectorsInBackground(): void {
  if (vectorConversion) return;
  vectorConversion = setTimeout(() => {
    vectorConversion = null;
    if (!shared || stopping) return;
    const store = shared;
    try {
      if (!store.preference('legacy-vectors-converted')) {
        if (!new DocumentaryEmbeddingBatches(store.db).discardFinished()) {
          const next = store.convertLegacyVectors(vectorCursor);
          if (next !== null) vectorCursor = next;
        }
        if (!store.preference('legacy-vectors-converted')) { convertLegacyVectorsInBackground(); return; }
      }
      compactDocumentaryStoreWhenIdle();
    } catch { /* Retried the next time the store opens. */ }
  }, 25);
  vectorConversion.unref?.();
}

let maintenance: Promise<void> | null = null;
let maintenanceWorker: BackgroundProcess | null = null;
let documentaryWriters = 0;
let initialized = false;
/** A failed VACUUM (a full disk, say) is not retried in the same session: every attempt
 * holds the writers off again. */
let compactionFailed = false;
/** Resolves when no store maintenance is running. */
export function documentaryMaintenanceSettled(): Promise<void> {
  return maintenance ?? Promise.resolve();
}
/** Work that writes the store outside the drain waits for maintenance to finish, and
 * holds the next one off while it runs. */
export async function withDocumentaryWrites<T>(work: () => Promise<T> | T): Promise<T> {
  // Starts synchronously when nothing is being maintained, like the work it wraps did.
  while (maintenance) await maintenance;
  documentaryWriters += 1;
  try { return await work(); } finally { documentaryWriters -= 1; }
}
const COMPACTION_MIN_FREE_BYTES = 256 * 1024 * 1024;
const COMPACTION_MIN_FREE_RATIO = 0.3;
function maintenanceWorkerFile(): string | null {
  const candidates = [process.env.NODUS_DOCUMENTARY_MAINTENANCE_WORKER_FILE, path.join(__dirname, 'documentaryMaintenanceWorker.js'),
    path.join(app.getAppPath(), 'dist-electron/documentaryMaintenanceWorker.js')];
  return candidates.find((file): file is string => !!file && fs.existsSync(file)) ?? null;
}
/** Rewrite the store without its free pages once most of it is free. On a real store,
 * binary vectors left 2.1 of 3.7 GB free and scattered what remained: semantic search
 * took 5 s per query before compaction and 0.3 s after, with identical results. VACUUM
 * holds the write lock for tens of seconds, so it runs in its own process and only while
 * nothing writes: the drain, reconciliation and preparation actions wait for it. */
export function compactDocumentaryStoreWhenIdle(threshold = { minFreeBytes: COMPACTION_MIN_FREE_BYTES, minFreeRatio: COMPACTION_MIN_FREE_RATIO }): void {
  if (!initialized || compactionFailed || maintenance || !shared || stopping || draining || lanes || activePreparations.size || documentaryWriters) return;
  const store = shared;
  const pages = store.db.pragma('page_count', { simple: true }) as number;
  const free = store.db.pragma('freelist_count', { simple: true }) as number;
  const pageSize = store.db.pragma('page_size', { simple: true }) as number;
  if (free * pageSize < threshold.minFreeBytes || free < pages * threshold.minFreeRatio) return;
  const file = maintenanceWorkerFile();
  if (!file) return;
  maintenance = withoutOwningVault(() => withoutDatabaseContext(() => new Promise<void>(resolve => {
    const worker = backgroundProcess(file, 'Nodus documentary maintenance');
    maintenanceWorker = worker;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true; maintenanceWorker = null;
      if (!ok) compactionFailed = true;
      void worker.terminate().finally(resolve);
    };
    worker.once('message', (message: { ok?: boolean }) => finish(message?.ok === true));
    worker.once('error', () => finish(false));
    worker.once('exit', () => finish(false));
    worker.postMessage({ filename: store.db.name });
  }))).finally(() => {
    maintenance = null;
    if (shared !== store || stopping) return;
    try { store.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* A later checkpoint trims the log. */ }
    notifyDocumentaryPreparation();
    void drainDocumentaryRequests().catch(() => undefined);
  });
}
/** Resolves once the shared store is closed: at once when idle, or when a drain in
 * progress has stopped (it closes the store itself, so no write is cut short). */
export function closeDocumentaryPreparation(): Promise<void> {
  stopping = true;
  if (corpusPoll) clearInterval(corpusPoll); corpusPoll = null;
  for (const active of activePreparations.values()) active.controller.abort();
  if (retryTimer) clearTimeout(retryTimer);
  if (autoTimer) clearTimeout(autoTimer);
  if (vectorConversion) clearTimeout(vectorConversion); vectorConversion = null;
  // An interrupted VACUUM rolls back; the store stays as it was.
  if (maintenanceWorker) void maintenanceWorker.terminate().catch(() => undefined);
  unsubscribe?.(); unsubscribe = null;
  if (!draining) { shared?.close(); shared = null; return Promise.resolve(); }
  return new Promise(resolve => { drainClosed = resolve; });
}
let drainClosed: (() => void) | null = null;

/** Shared text writer used once extraction has supplied a real source revision. */
export function prepareDocumentaryText(document: ResearchCorpusDocument, text: string, sourceMap: Record<string, string> = {}, signal?: AbortSignal, processingVersion = 'nodus-documentary/2'): Promise<{ indexKey: string; chunks: DocumentaryChunk[] }> {
  return withDocumentaryWrites(() => prepareDocumentaryTextNow(document, text, sourceMap, signal, processingVersion));
}
async function prepareDocumentaryTextNow(document: ResearchCorpusDocument, text: string, sourceMap: Record<string, string>, signal: AbortSignal | undefined, processingVersion: string): Promise<{ indexKey: string; chunks: DocumentaryChunk[] }> {
  const store = documentaryStore();
  // Scheme decluttering, where a layout file matches this text's pages: a separate identity,
  // so its chunks and vectors are never taken for the uncleaned index's or the reverse.
  const cleaning = schemeCleaningFor(text, sourceMap);
  const identity: DocumentaryIndexIdentity = { documentId: document.id, attachmentId: document.attachmentId, revision: document.revision,
    attachmentRevision: document.attachments?.find(attachment => attachment.id === document.attachmentId)?.revision,
    coverage: document.coverage, textFingerprint: createHash('sha256').update(text).digest('hex'), chunkerVersion: RETRIEVAL_CHUNKER_VERSION, processingVersion, embedding: null,
    ...(cleaning ? { layout: cleaning.signature } : {}) };
  const indexKey = store.enqueue(identity, { text, sourceMap });
  const existing = store.revision(indexKey);
  if (existing?.lexical_ready) return { indexKey, chunks: JSON.parse(existing.chunks_json!) };
  const job = store.claim(Date.now(), 60000, indexKey);
  if (!job) throw new Error(store.preference('paused') ? 'documentary_paused' : 'documentary_job_already_claimed');
  const heartbeat = setInterval(() => store.renew(job), 15000);
  try {
    signal?.throwIfAborted();
    if (job.stage === 'extract') store.saveExtraction(job, text);
    const chunks = existing?.chunks_json ? JSON.parse(existing.chunks_json) as DocumentaryChunk[] : cleanedChunks(await documentaryChunks(text, sourceMap, signal), cleaning, document.id);
    signal?.throwIfAborted();
    if (job.stage === 'chunk') store.saveChunks(job, chunks);
    if (job.stage === 'lexical') store.publishLexical(job);
    store.complete(job);
    return { indexKey, chunks };
  } catch (error) {
    if (store.getJob(indexKey)?.lease_token === job.lease_token) {
      if (signal?.aborted || stopping || store.preference('paused')) store.interrupt(job);
      else store.fail(job, 'documentary_preparation_failed');
    }
    throw error;
  } finally { clearInterval(heartbeat); }
}

function cleanedChunks(chunks: DocumentaryChunk[], cleaning: SchemeCleaning | null, documentId: string): DocumentaryChunk[] {
  if (!cleaning) return chunks;
  const cleaned = chunks.map(chunk => cleaning.clean(chunk));
  const before = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), after = cleaned.reduce((sum, chunk) => sum + chunk.text.length, 0);
  console.log(`[scheme-layout] ${documentId}: ${cleaning.pages} page layouts matched; ${cleaned.filter((chunk, index) => chunk !== chunks[index]).length}/${chunks.length} chunks cleaned; ${before} → ${after} chars`);
  return cleaned;
}

/** Upper bound per document; the provider gate (automatic 2→4, halved on a 429) is the real limit. */
const DOCUMENTARY_EMBEDDING_BATCHES_IN_FLIGHT = 4;

function embeddingIdentityParameters(config: EmbeddingExecutionConfig) {
  return { endpoint: createHash('sha256').update(config.endpoint).digest('hex'), inputPolicy: 'utf8-4096/2' };
}

export function prepareDocumentaryEmbeddings(indexKey: string, chunks: DocumentaryChunk[], signal?: AbortSignal, execution = effectiveEmbeddingConfig(), assertAuthorized: (final?: boolean) => void = () => {}, progress: (completed: number, unknown: number) => void = () => {}): Promise<{ indexKey: string; vectors: number[][]; provider: string; model: string }> {
  return withDocumentaryWrites(() => prepareDocumentaryEmbeddingsNow(indexKey, chunks, signal, execution, assertAuthorized, progress));
}
async function prepareDocumentaryEmbeddingsNow(indexKey: string, chunks: DocumentaryChunk[], signal: AbortSignal | undefined, execution: EmbeddingExecutionConfig, assertAuthorized: (final?: boolean) => void, progress: (completed: number, unknown: number) => void): Promise<{ indexKey: string; vectors: number[][]; provider: string; model: string }> {
  const store = documentaryStore();
  assertAuthorized(true);
  const base = JSON.parse(store.getJob(indexKey)!.identity_json) as DocumentaryIndexIdentity;
  const config = { provider: execution.provider, model: execution.modelId };
  const parameters = embeddingIdentityParameters(execution);
  const cached = store.db.prepare(`SELECT index_key FROM documentary_revisions WHERE document_id=? AND embedding_ready=1
    AND json_extract(identity_json,'$.textFingerprint')=? AND json_extract(identity_json,'$.revision')=?
    AND json_extract(identity_json,'$.chunkerVersion')=? AND json_extract(identity_json,'$.embedding.provider')=?
    AND json_extract(identity_json,'$.embedding.model')=? AND json_extract(identity_json,'$.processingVersion')=?
    AND json_extract(identity_json,'$.attachmentId') IS ?
    AND json_extract(identity_json,'$.embedding.parameters')=? AND json_extract(identity_json,'$.layout') IS ?`).get(base.documentId, base.textFingerprint, base.revision, base.chunkerVersion, config.provider, config.model, base.processingVersion, base.attachmentId, JSON.stringify(parameters), base.layout ?? null) as { index_key: string } | undefined;
  if (cached) {
    const rows = store.db.prepare('SELECT vector,vector_json FROM documentary_passages WHERE index_key=? ORDER BY ordinal').all(cached.index_key) as Array<{ vector: Buffer | null; vector_json: string | null }>;
    progress(rows.length, 0);
    return { indexKey: cached.index_key, vectors: rows.map(row => storedDocumentaryVector(row)!), ...config };
  }
  if (store.preference('paused')) throw new Error('documentary_paused');
  // Dimensions are measured from the response, so lease a persistent operation
  // identity before calling the provider, then publish under the complete space.
  const operation = `embedding:${base.documentId}:${researchFingerprint([indexKey, config, parameters])}`;
  const requests = new DocumentaryRequests(store.db);
  store.db.transaction(() => {
    if (!store.db.prepare('SELECT 1 FROM documentary_requests WHERE document_id=?').get(operation)) requests.enqueue(operation, base.revision, operation);
  }).immediate();
  let lease = requests.claim(operation, Date.now(), 60000, true);
  if (!lease) {
    // The operation is shared by every request for these vectors. One that failed, was
    // cancelled or is waiting out a retry backoff is taken over by the request that is
    // here to run it now; one another request is computing right now is left to it.
    const existing = store.db.prepare('SELECT state,error FROM documentary_requests WHERE document_id=?').get(operation) as { state: string; error: string | null } | undefined;
    if (existing && ['failed', 'cancelled', 'queued'].includes(existing.state)) {
      store.db.prepare(`UPDATE documentary_requests SET state='queued',attempts=0,error=NULL,available_at=?,lease_token=NULL,lease_until=NULL
        WHERE document_id=? AND state IN ('failed','cancelled','queued')`).run(Date.now(), operation);
      lease = requests.claim(operation, Date.now(), 60000, true);
    }
    if (!lease) throw new Error(existing?.state === 'running' ? 'documentary_embedding_busy' : existing?.error || 'documentary_embedding_job_unavailable');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const heartbeat = setInterval(() => { try { requests.renew(lease); } catch { controller.abort(); } }, 15000);
  let job: ReturnType<DocumentaryStore['claim']> = null;
  try {
    signal?.throwIfAborted();
    const checkpoints = new DocumentaryEmbeddingBatches(store.db);
    checkpoints.recover(operation);
    const texts = chunks.map(chunk => chunk.text);
    const vectors = checkpoints.read(operation, texts);
    const updateProgress = () => progress(vectors.filter(Boolean).length, (store.db.prepare("SELECT COUNT(*) n FROM documentary_embedding_attempts WHERE operation=? AND state='unknown'").get(operation) as { n: number }).n);
    updateProgress();
    // Bounded batches overlap (the provider gate decides how many run at once) and each
    // is checkpointed as soon as it returns, so a restart pays again only for the batches
    // that were in flight. The first failure stops the rest. The persistent operation
    // lease fences concurrent writers and late responses.
    const batches: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < texts.length;) {
      if (vectors[start]) { start++; continue; }
      let end = start + 1;
      while (end < texts.length && end - start < 32 && !vectors[end]) end++;
      batches.push({ start, end });
      start = end;
    }
    await mapOrderedPool(batches, DOCUMENTARY_EMBEDDING_BATCHES_IN_FLIGHT, async ({ start, end }, _index, batchSignal) => {
      batchSignal.throwIfAborted();
      requests.renew(lease);
      const batch = texts.slice(start, end);
      const attempt = checkpoints.begin(operation, start, batch.length);
      try {
        const received = await embedMany(batch, batchSignal, { config: execution, jobId: `${operation}:${start}` });
        // A sibling's failure cancels what is still in flight, but a response that has
        // already arrived was paid for and is kept; only a pause or a lost lease drops it.
        controller.signal.throwIfAborted();
        if (received.some(vector => !vector?.length)) throw new Error('documentary_embeddings_unavailable');
        checkpoints.complete(attempt, batch, received as number[][], () => { requests.renew(lease); assertAuthorized(); });
        vectors.splice(start, batch.length, ...received);
        updateProgress();
      } catch (error) { checkpoints.uncertain(attempt); updateProgress(); throw error; }
    }, controller.signal);
    signal?.throwIfAborted();
    requests.renew(lease);
    if (store.preference('paused')) throw new Error('documentary_paused');
    if (vectors.some(vector => !vector?.length) || !vectors.length) throw new Error('documentary_embeddings_unavailable');
    assertAuthorized(true);
    const identity: DocumentaryIndexIdentity = { ...base, embedding: { ...config, dimensions: vectors[0]!.length, metric: 'cosine', parameters } };
    const id = store.enqueue(identity, {});
    job = store.claim(Date.now(), 60000, id);
    if (!job) throw new Error('documentary_embedding_publication_unavailable');
    store.saveChunks(job, chunks);
    store.publishLexical(job);
    store.publishEmbeddings(job, vectors as number[][]);
    requests.finish(lease, null);
    checkpoints.discard(operation);
    return { indexKey: id, vectors: vectors as number[][], ...config };
  } catch (error) {
    if (job && store.getJob(job.id)?.state === 'running') store.fail(job, 'documentary_embedding_publication_failed');
    try { requests.finish(lease, 'documentary_embedding_failed', store.preference('paused') || stopping || !!signal?.aborted); } catch { /* Lease was fenced. */ }
    throw error;
  } finally { clearInterval(heartbeat); signal?.removeEventListener('abort', abort); }
}

/** A document's revisions without their text. `SELECT *` brought every revision's full text
 * and chunk JSON (327 MB over 453 revisions in a real library) into the main process for each
 * of 1,229 sources, and the inventory parsed the chunks twice to count them: 1.3–2.7 s with
 * the window frozen, at every Research Chat question and every documentary search. */
function revisionsFor(document: ResearchCorpusDocument): Array<{ index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number }> {
  return documentaryStore().db.prepare(`SELECT index_key,identity_json,embedding_ready,lexical_ready FROM documentary_revisions WHERE document_id=? AND json_extract(identity_json,'$.revision')=? ORDER BY embedding_ready DESC,created_at DESC`)
    .all(document.id, document.indexedSource?.revision ?? document.revision) as ReturnType<typeof revisionsFor>;
}
/** Chunks in a revision. A published one has exactly one passage per chunk (publishLexical
 * writes them in the transaction that sets lexical_ready), so they are counted on an index
 * instead of parsing the chunk JSON; an unpublished one is counted by SQLite. */
function chunkCount(store: DocumentaryStore, row: { index_key: string; lexical_ready: number }): number {
  const counted = row.lexical_ready
    ? store.db.prepare('SELECT COUNT(*) n FROM documentary_passages WHERE index_key=?').get(row.index_key)
    : store.db.prepare('SELECT json_array_length(chunks_json) n FROM documentary_revisions WHERE index_key=?').get(row.index_key);
  return (counted as { n: number | null } | undefined)?.n ?? 0;
}
function attachmentRevisions(document: ResearchCorpusDocument): Array<ReturnType<typeof revisionsFor>> {
  const groups = new Map<string | null, ReturnType<typeof revisionsFor>>();
  const attachments = document.indexedSource ? document.indexedSource.attachments : document.attachments;
  const published = document.indexedSource?.indexKeys.flatMap(key => documentaryStore().jobIdentity(key) ?? []);
  for (const row of revisionsFor(document)) {
    const identity: DocumentaryIndexIdentity = JSON.parse(row.identity_json);
    if (published && !published.some(base => base.attachmentId === identity.attachmentId && base.textFingerprint === identity.textFingerprint
      && base.chunkerVersion === identity.chunkerVersion && base.processingVersion === identity.processingVersion && (base.layout ?? null) === (identity.layout ?? null))) continue;
    if (attachments?.length && identity.attachmentId !== null
        && !attachments.some(attachment => attachment.id === identity.attachmentId
          && (!identity.attachmentRevision || attachment.revision === identity.attachmentRevision))) continue;
    const group = groups.get(identity.attachmentId) ?? [];
    group.push(row); groups.set(identity.attachmentId, group);
  }
  // A merged legacy derivative cannot accompany independently indexed files.
  if (groups.size > 1) groups.delete(null);
  return [...groups.values()];
}
export function pinPublishedResearchDocument(document: ResearchCorpusDocument): ResearchCorpusDocument {
  const store = documentaryStore();
  const published = store.publishedDocument(document);
  if (published) return published;
  // No partially built first revision may leak before the all-attachment switch.
  const preparing = store.db.prepare('SELECT 1 FROM documentary_requests WHERE document_id=? OR source_id=?').get(document.id, document.id);
  return preparing ? { ...document, indexedSource: { revision: document.revision, attachmentId: document.attachmentId, attachments: document.attachments, indexKeys: [] } } : document;
}

export function getResearchPreparationInventory(): ResearchPreparationInventory {
  const store = documentaryStore();
  let selectedEmbedding: EmbeddingExecutionConfig | null = null;
  try { selectedEmbedding = effectiveEmbeddingConfig(); } catch { /* Text readiness does not depend on model configuration. */ }
  const embeddingSpaces = new Map<string, NonNullable<ResearchPreparationInventory['embeddingSpaces']>[number]>();
  for (const row of store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE embedding_ready=1').all() as { identity_json: string }[]) {
    const embedding = (JSON.parse(row.identity_json) as DocumentaryIndexIdentity).embedding;
    if (embedding) {
      const id = researchFingerprint(embedding);
      embeddingSpaces.set(id, { id, provider: embedding.provider, model: embedding.model, dimensions: embedding.dimensions, metric: embedding.metric });
    }
  }
  return { enabled: new DocumentaryCampaigns(store.db).policy(getActiveVault().id).futureAdditions, embeddingSpaces: [...embeddingSpaces.values()], documents: researchCorpusInventory().documents.map(current => {
    const document = pinPublishedResearchDocument(current);
    const stale = document.indexedSource && document.indexedSource.revision !== document.revision;
    const groups = attachmentRevisions(document);
    const revisions = groups.flatMap(group => group.find(row => row.lexical_ready && !row.embedding_ready) ?? group.find(row => row.lexical_ready) ?? []);
    const revision = revisions[0];
    const latest = store.db.prepare('SELECT state,error,revision FROM documentary_requests WHERE document_id=? OR source_id=? ORDER BY updated_at DESC LIMIT 1').get(document.id, document.id) as { state: string; error: string | null; revision: string } | undefined;
    // A request for bytes that have since been replaced says nothing about the current file.
    const request = latest && latest.revision === current.revision ? latest : undefined;
    const passages = revisions.reduce((sum, row) => sum + chunkCount(store, row), 0);
    const compatibleVectors = groups.flatMap(group => group.find(row => {
      const identity = JSON.parse(row.identity_json) as DocumentaryIndexIdentity;
      return row.embedding_ready && selectedEmbedding && identity.embedding?.provider === selectedEmbedding.provider
        && identity.embedding.model === selectedEmbedding.modelId
        && JSON.stringify(identity.embedding.parameters) === JSON.stringify(embeddingIdentityParameters(selectedEmbedding));
    }) ?? []);
    const embedded = compatibleVectors.reduce((sum, row) => sum + chunkCount(store, row), 0);
    const incompatible = groups.some(group => group.some(row => row.embedding_ready)) && compatibleVectors.length === 0;
    const coverage = revision ? (JSON.parse(revision.identity_json) as DocumentaryIndexIdentity).coverage ?? document.coverage : document.coverage;
    // An error on a request that is still queued or running is a retry in progress,
    // not a failure. Once current text is published, only the vector stage remains,
    // so its errors belong to the provider whatever their message says.
    const retrying = request?.state === 'queued' || request?.state === 'running';
    const textPublished = !!revision && !stale;
    return { ...document, preparation: { documentId: document.id, revision: document.revision, text: coverage === 'abstract' ? 'abstract' : passages ? 'available' : 'missing',
      lexical: revision ? stale ? 'stale' : 'ready' : 'missing', embeddings: embedded === passages && passages > 0 ? stale ? 'stale' : 'ready' : embedded > 0 ? 'partial' : incompatible ? 'stale' : request?.error ? retrying ? request.state as 'queued' | 'running' : 'failed' : 'missing',
      status: request?.state === 'blocked' ? 'blocked' : request?.state === 'cancelled' ? 'cancelled' : store.preference('paused') ? 'paused' : revision ? 'ready' : request?.state === 'running' ? 'running' : request?.state === 'queued' ? 'queued' : request?.error ? 'failed' : 'catalogued',
      reason: request?.error?.startsWith('documentary_ocr_') ? 'ocr_required' : request?.error === 'documentary_embeddings_unavailable' ? 'no_model' : request?.error && (textPublished || request.error.includes('embedding')) ? 'provider_failed' : request?.error ? 'extraction_failed' : null, error: request?.error ?? null, passages, embedded,
      unpreparedAttachmentIds: unpreparedResearchAttachmentIds(document, revisions.map(row => JSON.parse(row.identity_json) as DocumentaryIndexIdentity)) } };
  }) };
}

/** Two documents at a time: while one waits on its embedding provider, the next one is
 * extracted. Requests for the same source never run together. */
const PREPARATION_LANES = 2;
/** Re-reading the corpus inventory costs tens of milliseconds on the main thread; a
 * source is revalidated at most this often while it is extracted or embedded, and
 * always before anything is published. */
const SOURCE_VALIDATION_INTERVAL_MS = 5000;
/** Page and batch progress reaches the windows at most this often. */
const PROGRESS_NOTICE_INTERVAL_MS = 250;
let draining = false;
let lanes = 0;
let lanesFinished: (() => void) | null = null;
const activePreparations = new Map<string, { controller: AbortController; sourceId: string }>();
export function interruptUnusedDocumentaryRequest(): void {
  for (const [requestId, active] of activePreparations) {
    const row = documentaryStore().db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(requestId) as { state: string } | undefined;
    if (row?.state !== 'running') active.controller.abort();
  }
}
let lastProgressNotice = 0;
let progressNoticeTimer: ReturnType<typeof setTimeout> | null = null;
function notifyPreparationProgress(): void {
  const wait = lastProgressNotice + PROGRESS_NOTICE_INTERVAL_MS - Date.now();
  if (wait <= 0) { lastProgressNotice = Date.now(); notifyDocumentaryPreparation(); return; }
  if (progressNoticeTimer) return;
  progressNoticeTimer = setTimeout(() => { progressNoticeTimer = null; lastProgressNotice = Date.now(); notifyDocumentaryPreparation(); }, wait);
  progressNoticeTimer.unref?.();
}
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Whether a frozen embedding configuration can run now: a local runtime, or a remote
 * provider whose credential is configured. */
export function embeddingConfigurationUsable(config: Pick<EmbeddingExecutionConfig, 'provider'>): boolean {
  return ['ollama', 'lmstudio', 'nodus'].includes(config.provider) || !!getSettings().providerKeys[config.provider];
}
export async function prepareResearchDocuments(documentIds: string[], mode: 'embeddings' | 'text' = 'embeddings'): Promise<void> {
  // Callers rely on the queue being written synchronously; only a running maintenance defers it.
  if (maintenance) await maintenance;
  const store = documentaryStore();
  const inventory = researchCorpusInventory();
  const configuration = { embedding: mode === 'text' ? null : effectiveEmbeddingConfig(), processingVersion: 'nodus-documentary/2', ocrLanguages: getSettings().ocrLanguages || 'spa+eng' };
  const wanted = new Set(documentIds);
  const documents = inventory.documents.filter(document => wanted.has(document.id));
  if (documents.length !== wanted.size) throw new Error('research_source_not_authorized');
  new DocumentaryCampaigns(store.db).create(getActiveVault().id, getActiveVault().name, documents, configuration);
  for (const document of documents) {
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state IN ('failed','cancelled')").all(document.id) as { id: string }[]) store.retry(row.id);
    const prefix = `embedding:${document.id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='queued',attempts=0,error=NULL,available_at=?
      WHERE substr(document_id,1,?)=? AND state IN ('failed','cancelled')`).run(Date.now(), prefix.length, prefix);
  }
  notifyDocumentaryPreparation();
  void drainDocumentaryRequests();
}
export function cancelResearchDocuments(documentIds: string[]): void {
  const allowed = new Set(researchCorpusInventory().documents.map(document => document.id));
  if (documentIds.some(id => !allowed.has(id))) throw new Error('research_source_not_authorized');
  const store = documentaryStore();
  const requests = new DocumentaryRequests(store.db);
  const campaigns = new DocumentaryCampaigns(store.db);
  for (const id of documentIds) {
    const owned = store.db.prepare(`SELECT c.id FROM documentary_campaigns c JOIN documentary_campaign_members m ON m.campaign_id=c.id
      WHERE c.vault_id=? AND m.document_id=?`).all(getActiveVault().id, id) as { id: string }[];
    for (const campaign of owned) campaigns.control(campaign.id, 'cancel', id);
    const interest = store.db.prepare(`SELECT 1 FROM documentary_campaign_members m JOIN documentary_campaigns c ON c.id=m.campaign_id
      WHERE m.document_id=? AND m.state='active' AND c.state='active' LIMIT 1`).get(id);
    if (interest) continue;
    requests.cancel(id);
    const prefix = `embedding:${id}:`;
    store.db.prepare(`UPDATE documentary_requests SET state='cancelled',lease_token=NULL,lease_until=NULL
      WHERE substr(document_id,1,?)=? AND state<>'complete'`).run(prefix.length, prefix);
    for (const row of store.db.prepare("SELECT id FROM documentary_jobs WHERE document_id=? AND state<>'complete'").all(id) as { id: string }[]) store.cancel(row.id);
    for (const active of activePreparations.values()) if (active.sourceId === id) active.controller.abort();
  }
  notifyDocumentaryPreparation();
}
export function drainDocumentaryRequests(): Promise<void> {
  return withoutOwningVault(() => withoutDatabaseContext(drainOwnedDocumentaryRequests));
}
const preparationOwners = () => listVaults().filter(vault => vault.type === 'academic').map(vault => vault.id);
async function drainOwnedDocumentaryRequests(): Promise<void> {
  if (stopping) return;
  if (maintenance) { void maintenance.then(() => drainDocumentaryRequests()).catch(() => undefined); return; }
  const store = documentaryStore();
  if (store.preference('paused')) return;
  // New work while a drain runs gets a lane of its own if one is free.
  if (draining) { if (lanesFinished && lanes < PREPARATION_LANES) startPreparationLane(); return; }
  draining = true;
  const requests = new DocumentaryRequests(store.db);
  // Adopt only legacy requests belonging to the active academic vault.
  if (getActiveVault().type === 'academic') store.db.prepare("UPDATE documentary_requests SET vault_id=? WHERE vault_id=''").run(getActiveVault().id);
  if (retryTimer) clearTimeout(retryTimer);
  try {
    await new Promise<void>(resolve => {
      lanesFinished = resolve;
      for (let lane = 0; lane < PREPARATION_LANES; lane++) startPreparationLane();
    });
  } finally {
    draining = false;
    if (stopping) { store.close(); shared = null; drainClosed?.(); drainClosed = null; }
    else {
      const delay = requests.nextDelay(preparationOwners());
      if (delay !== null && !store.preference('paused')) {
        retryTimer = setTimeout(() => { retryTimer = null; void drainDocumentaryRequests().catch(() => undefined); }, delay);
        retryTimer.unref();
      }
      if (store.preference('legacy-vectors-converted')) compactDocumentaryStoreWhenIdle();
    }
  }
}
function startPreparationLane(): void {
  lanes += 1;
  void drainPreparationLane().catch(() => undefined).finally(() => {
    lanes -= 1;
    if (lanes === 0) { const finished = lanesFinished; lanesFinished = null; finished?.(); }
  });
}
async function drainPreparationLane(): Promise<void> {
  const store = documentaryStore();
  const requests = new DocumentaryRequests(store.db);
  const owners = preparationOwners;
  for (;;) {
    if (stopping || store.preference('paused')) break;
    new DocumentaryCampaigns(store.db).synchronizeOwners(owners());
    const busySources = [...activePreparations.values()].map(active => active.sourceId);
    const request = requests.claim(owners(), Date.now(), 60000, false, busySources);
    if (!request) break;
    const controller = new AbortController();
    activePreparations.set(request.document_id, { controller, sourceId: request.source_id ?? request.document_id });
    notifyDocumentaryPreparation();
    const heartbeat = setInterval(() => { try { requests.renew(request); } catch { controller.abort(); } }, 15000);
    let validateSource = () => {};
    let validatedAt = 0;
    // `full` before every publication; page and batch progress revalidates on an interval.
    const checkLease = (full = true) => {
      controller.signal.throwIfAborted();
      if (full || Date.now() - validatedAt >= SOURCE_VALIDATION_INTERVAL_MS) { validateSource(); validatedAt = Date.now(); }
      if (getVault(request.vault_id)?.type !== 'academic') throw new Error('research_vault_unavailable');
      requests.renew(request);
    };
    try {
      await withOwningVault(request.vault_id, () => withVaultDatabase(request.vault_id, async () => {
      // Legacy authorized jobs capture their existing provider once at first
      // dispatch; new jobs already carry the enqueue-time configuration.
      const configuration = request.configuration_json ? JSON.parse(request.configuration_json) as { embedding: EmbeddingExecutionConfig | null; processingVersion: string; ocrLanguages?: string }
        : { embedding: effectiveEmbeddingConfig(), processingVersion: 'nodus-documentary/1' };
      if (!request.configuration_json) store.db.prepare('UPDATE documentary_requests SET configuration_json=? WHERE document_id=? AND lease_token=?').run(JSON.stringify(configuration), request.document_id, request.lease_token);
      if (!['nodus-documentary/1', 'nodus-documentary/2'].includes(configuration.processingVersion)) throw new Error('documentary_processing_version_unavailable');
      const document = researchCorpusInventory().documents.find(item => item.id === (request.source_id ?? request.document_id));
      if (!document) throw new Error('research_source_not_authorized');
      // New bytes are not a revoked permission: the request is simply obsolete.
      if (document.revision !== request.revision) throw new Error('research_source_revision_changed');
      validateSource = () => {
        const current = researchCorpusInventory().documents.find(item => item.id === document.id);
        if (!current || current.permissionRevision !== document.permissionRevision || (document.workId && current.workId !== document.workId)) throw new Error('research_source_not_authorized');
        if (current.revision !== document.revision) throw new Error('research_source_revision_changed');
      };
      checkLease();
      // OCR is deferred for documentary preparation, including already queued
      // v2 jobs. Detect scanned pages, preserve the last publication and skip.
      const extractionOptions = DOCUMENTARY_EXTRACTION_OPTIONS;
      const onExtractionProgress = (progress: { phase: string; page?: number; totalPages?: number }) => {
        checkLease(false);
        store.db.prepare('UPDATE documentary_requests SET stage=?,current_page=?,total_pages=?,updated_at=? WHERE document_id=? AND lease_token=?').run(progress.phase === 'ocr' ? 'ocr' : 'extraction', progress.page ?? null, progress.totalPages ?? null, Date.now(), request.document_id, request.lease_token);
        notifyPreparationProgress();
      };
      let text = '';
      let coverage = document.coverage;
      let sourceMap: Record<string, string> = {};
      let parts: DocumentarySourcePart[] = [];
      const publication = store.publishedDocument(document)?.indexedSource;
      const prepared: Array<{ indexKey: string; chunks: DocumentaryChunk[] }> = [];
      if (publication?.revision === document.revision && publication.indexKeys.length) {
        const identities = publication.indexKeys.map(key => JSON.parse(store.getJob(key)!.identity_json) as DocumentaryIndexIdentity);
        if (!unpreparedResearchAttachmentIds(document, identities).length && identities.every(identity => identity.chunkerVersion === RETRIEVAL_CHUNKER_VERSION && identity.processingVersion === configuration.processingVersion)) {
          for (const key of publication.indexKeys) {
            const revision = store.revision(key);
            if (revision?.lexical_ready && revision.chunks_json) prepared.push({ indexKey: key, chunks: JSON.parse(revision.chunks_json) });
          }
          if (prepared.length !== publication.indexKeys.length) prepared.length = 0;
          else coverage = identities.every(identity => identity.coverage === 'fulltext') ? 'fulltext' : identities.some(identity => identity.coverage === 'abstract') ? 'abstract' : document.coverage;
        }
      }
      if (!prepared.length) {
      if (document.conversationAttachment) {
        const { conversationId, attachmentId } = document.conversationAttachment;
        const source = readResearchAttachmentSource(conversationId, attachmentId);
        if (!source) throw new Error('research_source_not_authorized');
        // PDF import records physical page boundaries, not printed folios.
        text = `[[src:conversation]]\n${source.text}`;
        if (source.kind === 'pdf') text = text.split('\n').map(line => {
          const prefix = `[${source.name}, página `;
          const number = line.startsWith(prefix) && line.endsWith(']') ? line.slice(prefix.length, -1) : '';
          return /^[1-9]\d*$/.test(number) ? `[[src:conversation p. ${number}]]` : line;
        }).join('\n');
        sourceMap.conversation = `conversation:${conversationId}:${attachmentId}`;
      }
      if (document.noteId) {
        const note = getNote(document.noteId);
        if (!note || note.trashedAt) throw new Error('research_source_not_authorized');
        text = `[[src:note]]\n${note.content}`;
        sourceMap.note = `note:${getActiveVault().id}:${note.id}`;
      }
      if (document.libraryItemId) {
        const item = getGlobalLibraryItem(document.libraryItemId);
        const raw = getLibraryReaderRawContent(document.libraryItemId);
        const map = raw ? readDocumentarySourceMap(raw.folder, item?.files?.sourceMap) : null;
        const compatible = !!raw && !!map && map.reader.sha256 === createHash('sha256').update(raw.markdown).digest('hex')
          && documentaryReaderComplete(raw.folder, item?.files?.qualityReport)
          && item?.attachments.length === 1 && item.attachments[0].sha256 === map.source.sha256
          && item.contentRevision?.components.extraction.freshness === 'current';
        if (compatible && raw?.markdown) {
          text = documentarySourceText(raw.markdown, map, 'library');
          sourceMap.library = `library:${document.libraryItemId}:${document.attachmentId ?? 'reader'}`;
          coverage = 'fulltext';
        } else {
          // Use a private staging worker, not the active-vault Library queue.
          // Every compatible attachment keeps its own revision and locators.
          if (item?.attachments.length) parts = await extractGlobalResearchAttachments(document.libraryItemId, controller.signal, extractionOptions, onExtractionProgress);
          if (!parts.length) { text = item?.metadata.abstract ?? ''; coverage = 'abstract'; }
        }
      }
      if (!text && !parts.length && document.workId) {
        const work = getWork(document.workId);
        if (!work || work.archived) throw new Error('research_source_not_authorized');
        const settings = getSettings();
        const userId = settings.zoteroUserId || LOCAL_USER_ID;
        const item = await getItem(userId, work.zotero_key).catch(() => null);
        const resolved = await extractTraditionalResearchWork(userId, work.zotero_key, work.item_type, controller.signal, extractionOptions, onExtractionProgress);
        text = resolved.text || item?.abstract || '';
        coverage = resolved.text ? 'fulltext' : 'abstract';
        sourceMap = resolved.sourceMap;
        parts = resolved.parts;
      }
      if (!text.trim() && !parts.length) throw new Error('documentary_text_unavailable');
      const current = researchCorpusInventory().documents.find(item => item.id === document.id);
      if (!current || current.revision !== document.revision) throw new Error('research_source_revision_changed');
      checkLease();
      store.db.prepare("UPDATE documentary_requests SET stage='lexical' WHERE document_id=? AND lease_token=?").run(request.document_id, request.lease_token);
      if (parts.length) {
        for (const part of parts) {
          checkLease();
          prepared.push(await prepareDocumentaryText({ ...document, coverage: 'fulltext', attachmentId: part.attachmentId,
            attachments: [{ id: part.attachmentId, revision: part.attachmentRevision }] }, part.text, part.sourceMap, controller.signal, configuration.processingVersion));
        }
      } else prepared.push(await prepareDocumentaryText({ ...document, coverage }, text, sourceMap, controller.signal, configuration.processingVersion));
      }
      checkLease();
      const beforePublish = researchCorpusInventory().documents.find(item => item.id === document.id);
      if (!beforePublish || beforePublish.revision !== document.revision || beforePublish.permissionRevision !== document.permissionRevision) throw new Error('research_source_revision_changed');
      store.publishDocument({ ...document, coverage: parts.length ? 'fulltext' : coverage }, prepared.map(result => result.indexKey));
      // Publish every lexical attachment before any optional vector request.
      const total = prepared.reduce((sum, result) => sum + result.chunks.length, 0);
      store.db.prepare("UPDATE documentary_requests SET stage=?,total_passages=?,completed_passages=0,unknown_requests=0 WHERE document_id=? AND lease_token=?").run(configuration.embedding ? 'embeddings' : 'lexical', total, request.document_id, request.lease_token);
      let completed = 0, unknown = 0;
      for (const result of prepared) {
        checkLease();
        if (configuration.embedding && !embeddingConfigurationUsable(configuration.embedding)) throw new Error('documentary_embeddings_unavailable');
        if (configuration.embedding) await prepareDocumentaryEmbeddings(result.indexKey, result.chunks, controller.signal, configuration.embedding, final => checkLease(!!final), (count, uncertain) => {
          store.db.prepare('UPDATE documentary_requests SET completed_passages=?,unknown_requests=?,updated_at=? WHERE document_id=? AND lease_token=?').run(completed + count, unknown + uncertain, Date.now(), request.document_id, request.lease_token);
          notifyPreparationProgress();
        });
        completed += result.chunks.length;
        unknown = (store.db.prepare('SELECT unknown_requests FROM documentary_requests WHERE document_id=?').get(request.document_id) as { unknown_requests: number }).unknown_requests;
      }
      checkLease();
      requests.finish(request, null);
      store.db.prepare("UPDATE documentary_requests SET stage='complete' WHERE document_id=?").run(request.document_id);
      }));
    } catch (error) {
      const superseded = error instanceof Error && error.message === 'research_source_revision_changed';
      if (error instanceof Error && /^research_(source|vault)_/.test(error.message) && !superseded && request.source_id) {
        new DocumentaryCampaigns(store.db).blockOwner(request.document_id, request.vault_id);
      }
      try {
        const code = error instanceof Error ? error.message.slice(0, 120) : 'documentary_preparation_failed';
        // A request for replaced bytes can never succeed; retrying it would only
        // consume attempts. Close it; the new revision is prepared on its own request.
        if (superseded) store.db.prepare("UPDATE documentary_requests SET state='cancelled',error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE document_id=? AND lease_token=?")
          .run(code, Date.now(), request.document_id, request.lease_token);
        else if (/^documentary_(ocr_deferred|ocr_resources_missing|ocr_incomplete|embeddings_unavailable|extraction_worker_unavailable)$/.test(code)) requests.block(request, code);
        else requests.finish(request, code, store.preference('paused') || stopping || controller.signal.aborted);
      } catch { /* A newer request owns publication. */ }
    } finally { clearInterval(heartbeat); activePreparations.delete(request.document_id); notifyDocumentaryPreparation(); }
  }
}
export function setResearchPreparationPaused(paused: boolean): void {
  if (typeof paused !== 'boolean') throw new Error('Invalid preparation preference');
  documentaryStore().setPreference('paused', paused);
  notifyDocumentaryPreparation();
  if (paused) for (const active of activePreparations.values()) active.controller.abort(); else void drainDocumentaryRequests();
}
export function setResearchPreparationEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('Invalid preparation preference');
  if (getActiveVault().type !== 'academic') throw new Error('research_academic_vault_required');
  const repo = new DocumentaryCampaigns(documentaryStore().db);
  const policy = repo.policy(getActiveVault().id);
  if (enabled && !policy.futureAdditions) policy.known = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment).map(document => document.id);
  repo.savePolicy({ ...policy, futureAdditions: enabled, futureAdditionsSetByUser: true });
  notifyDocumentaryPreparation();
  initializeDocumentaryPreparation();
}

/** Reconcile ownership before garbage collection. Shared copies survive other vaults. */
export function reconcileResearchDocumentOwnership(): Promise<void> {
  return withDocumentaryWrites(reconcileOwnedResearchDocuments);
}
async function reconcileOwnedResearchDocuments(): Promise<void> {
  const store = documentaryStore();
  const snapshots: Array<{ vaultId: string; ids: Set<string> }> = [];
  for (const vault of listVaults().filter(vault => vault.type === 'academic')) {
    await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
      const inventory = researchCorpusInventory();
      const ids = new Set(inventory.documents.filter(document => document.workId).map(document => document.id));
      for (const notebook of listResearchNotebooks()) {
        const selected = notebook.mode === 'fixed' ? notebook.resolvedDocumentIds : selectResearchDocuments(notebook.sources, notebook.exclusions, inventory.documents, inventory.collections);
        for (const id of selected) if (inventory.documents.some(document => document.id === id)) ids.add(id);
      }
      snapshots.push({ vaultId: vault.id, ids });
    }));
  }
  store.db.transaction(() => {
    const previous = store.db.prepare('SELECT vault_id,document_id FROM documentary_source_owners').all() as Array<{ vault_id: string; document_id: string }>;
    store.db.prepare('DELETE FROM documentary_source_owners').run();
    for (const snapshot of snapshots) for (const id of snapshot.ids) store.db.prepare('INSERT INTO documentary_source_owners VALUES(?,?)').run(snapshot.vaultId, id);
    const removed = new Set<string>();
    for (const old of previous) {
      if (snapshots.some(snapshot => snapshot.vaultId === old.vault_id && snapshot.ids.has(old.document_id))) continue;
      store.db.prepare("UPDATE documentary_campaign_members SET state='cancelled' WHERE document_id=? AND campaign_id IN (SELECT id FROM documentary_campaigns WHERE vault_id=?)").run(old.document_id, old.vault_id);
      const policies = new DocumentaryCampaigns(store.db);
      const policy = policies.policy(old.vault_id);
      delete policy.authorized[old.document_id];
      policies.savePolicy({ ...policy, known: policy.known.filter(id => id !== old.document_id) });
      removed.add(old.document_id);
    }
    new DocumentaryCampaigns(store.db).synchronizeOwners(snapshots.map(snapshot => snapshot.vaultId));
    interruptUnusedDocumentaryRequest();
    for (const id of removed) if (!store.db.prepare('SELECT 1 FROM documentary_source_owners WHERE document_id=?').get(id)) store.removeDocument(id);
  }).immediate();
  notifyDocumentaryPreparation();
}

let unsubscribe: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
export function notifyResearchCorpusChanged(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = withoutOwningVault(() => withoutDatabaseContext(() => setTimeout(() => {
    autoTimer = null;
    void withDocumentaryWrites(async () => {
      await initialization;
      const repo = new DocumentaryCampaigns(documentaryStore().db);
      await reconcileResearchDocumentOwnership();
      for (const vault of listVaults().filter(vault => vault.type === 'academic')) {
        if (!repo.policy(vault.id).futureAdditions) continue;
        await withOwningVault(vault.id, () => withVaultDatabase(vault.id, async () => {
          const policy = repo.policy(vault.id);
          if (!policy.futureAdditions) return;
          const inventory = researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment);
          // A Set, not `known.includes`: that was one linear scan per library document, on a timer —
          // 12% of the main thread's busy time in a nine-turn trace (2026-10-09).
          const known = new Set(policy.known);
          const documents = inventory.filter(document => !known.has(document.id)
            || (policy.authorized[document.id] !== undefined && policy.authorized[document.id] !== document.revision));
          if (documents.length) await prepareResearchDocuments(documents.map(document => document.id));
          const updated = repo.policy(vault.id);
          repo.savePolicy({ ...updated, known: inventory.map(document => document.id) });
        })).catch(() => { /* Retry discovery after configuration/import recovery; keep other vaults moving. */ });
      }
    }).catch(() => undefined);
  }, 1000)));
  autoTimer.unref();
}
let initialization: Promise<void> | null = null;
export function initializeDocumentaryPreparation(): Promise<void> {
  return initialization ??= initializeOwnedDocumentaryPreparation();
}
async function initializeOwnedDocumentaryPreparation(): Promise<void> {
  if (unsubscribe) return;
  // Baseline pre-update documents without silently indexing the old library.
  // A new vault has no baseline row, so its first added documents are eligible.
  const repo = new DocumentaryCampaigns(documentaryStore().db);
  for (const vault of listVaults().filter(vault => vault.type === 'academic')) {
    const row = repo.db.prepare('SELECT policy_json FROM documentary_preparation_policies WHERE vault_id=?').get(vault.id);
    const policy = repo.policy(vault.id);
    await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
      for (const document of researchCorpusInventory().documents.filter(document => document.workId))
        repo.db.prepare('INSERT OR IGNORE INTO documentary_source_owners VALUES(?,?)').run(vault.id, document.id);
    }));
    if (row && policy.automaticVersion === 1) continue;
    await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
      repo.savePolicy({ ...policy, automaticVersion: 1,
        futureAdditions: policy.futureAdditionsSetByUser ? policy.futureAdditions : policy.decision !== 'declined',
        known: researchCorpusInventory().documents.filter(document => document.workId && !document.noteId && !document.conversationAttachment).map(document => document.id) });
    }));
  }
  // Also catches sources added by long-running importers after their initial event.
  corpusPoll = withoutOwningVault(() => withoutDatabaseContext(() => setInterval(notifyResearchCorpusChanged, 30000)));
  corpusPoll.unref();
  const global = onGlobalLibraryChanged(notifyResearchCorpusChanged);
  const authored = onResearchCorpusChanged(notifyResearchCorpusChanged);
  unsubscribe = () => { global(); authored(); };
  // A legacy profile preference must never authorize every vault.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite'))) {
    const store = documentaryStore();
    if (store.preference('enabled') && getActiveVault().type === 'academic') {
      setResearchPreparationEnabled(true);
      store.setPreference('enabled', false);
    }
  }
  // Resume explicitly queued work after a restart, including a crashed stage.
  if (fs.existsSync(path.join(app.getPath('userData'), 'documentary/store.sqlite'))) void drainDocumentaryRequests().catch(() => undefined);
  // Store maintenance never overlaps the start-up writes above.
  initialized = true;
  if (shared) convertLegacyVectorsInBackground();
}

export async function retrieveSharedDocumentaryEvidence(scope: ResolvedResearchScope, query: string, settings: RetrievalSettings, vector: number[] | null, signal?: AbortSignal, read?: ResearchDocumentRead): Promise<{ evidence: ResearchEvidence[]; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }> {
  const inventory = researchCorpusInventory();
  const config = currentEmbeddingConfig();
  let parameters: ReturnType<typeof embeddingIdentityParameters> | null = null;
  try { parameters = embeddingIdentityParameters(effectiveEmbeddingConfig()); } catch { /* Lexical retrieval remains available without an endpoint. */ }
  const vectorKeys: string[] = [];
  const indexedDocuments = new Set<string>();
  const incompleteAttachments = new Set<string>();
  // Per document of the scope, this ran a linear find over the inventory and parsed each revision's
  // identity up to three times, serialising the same embedding parameters once per row: ~11% of the
  // main thread's busy time in a nine-turn trace (2026-10-09). An index, one parse per row, and one
  // serialisation of the constant compare exactly the same things.
  const inventoryById = documentsById(inventory.documents);
  const parsedIdentities = new Map<object, DocumentaryIndexIdentity>();
  const identityOf = (row: { identity_json: string }): DocumentaryIndexIdentity => {
    let identity = parsedIdentities.get(row);
    if (!identity) { identity = JSON.parse(row.identity_json) as DocumentaryIndexIdentity; parsedIdentities.set(row, identity); }
    return identity;
  };
  const wantedParameters = JSON.stringify(parameters);
  const keys = scope.documents.flatMap(document => {
    assertResearchDocumentPermission(scope, document.id, inventoryById.get(document.id));
    const groups = attachmentRevisions(document);
    const identities = groups.flatMap(group => group.filter(row => row.lexical_ready).map(identityOf));
    if (unpreparedResearchAttachmentIds(document, identities).length) incompleteAttachments.add(document.id);
    return groups.flatMap(revisions => {
    const semantic = revisions.find(row => {
      const identity = identityOf(row);
      return row.embedding_ready && identity.embedding?.model === config.model && identity.embedding?.provider === config.provider && identity.embedding?.dimensions === vector?.length && JSON.stringify(identity.embedding.parameters) === wantedParameters;
    });
    if (semantic) vectorKeys.push(semantic.index_key);
    const revision = revisions.find(row => row.lexical_ready && !row.embedding_ready) ?? revisions.find(row => row.lexical_ready);
      if (revision) indexedDocuments.add(document.id);
      return revision ? [revision.index_key] : [];
    });
  });
  const space = researchFingerprint({ ...config, dimensions: vector?.length ?? 0, metric: 'cosine', parameters });
  const threshold = settings.threshold.mode === 'manual' && settings.threshold.embeddingSpace === space ? settings.threshold.value : -1;
  signal?.throwIfAborted();
  if (!keys.length && !vectorKeys.length) return { evidence: [], traversal: { partial: scope.documents.length > 0, rounds: 1, candidates: 0, evidenceTokens: 0, visited: [] } };
  const packagedWorker = path.join(__dirname, 'documentaryRetrievalWorker.js');
  const worker = backgroundProcess(fs.existsSync(packagedWorker) ? packagedWorker : path.join(app.getAppPath(), 'dist-electron/documentaryRetrievalWorker.js'), 'Nodus documentary retrieval');
  const finishSearch = startResearchActivity('nodus', read?.kind === 'search' ? 'search' : read?.kind === 'pages' ? 'pages' : read?.kind === 'context' ? 'expand' : read?.kind === 'references' ? 'references' : 'search', scope.documents.length === 1 ? scope.documents[0].title : query);
  const activities = new Map<string, ReturnType<typeof startResearchActivity>>();
  const result = await new Promise<{ passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }>((resolve, reject) => {
    let settled = false;
    const retrievalStarted = Date.now();
    // Diagnostic, off unless asked for: the query text itself, so a trace can tell a repeated
    // question from a rephrased one. It is the user's own words, so it is never logged by default.
    const traceQuery = process.env.NODUS_TRACE_QUERIES === '1' ? ` · query ${JSON.stringify(query.slice(0, 240))}` : '';
    const finish = (error: Error | null, value?: { passages: ReturnType<DocumentaryStore['lexicalSearch']>; traversal: { partial: boolean; rounds: number; candidates: number; evidenceTokens: number; visited: string[] } }) => {
      if (settled) return;
      settled = true;
      console.info(`${new Date().toISOString()} [documentary] retrieval ${read?.kind ?? 'search'} ${((Date.now() - retrievalStarted) / 1000).toFixed(1)}s · ${keys.length} lexical / ${vectorKeys.length} vector keys · ${value?.passages.length ?? 0} passages${error ? ` · ${error.message}` : ''}${traceQuery}`);
      clearTimeout(deadline);
      finishSearch(error ? 'failed' : 'completed', value?.passages.length);
      for (const finishActivity of activities.values()) finishActivity(error ? 'failed' : 'completed');
      activities.clear();
      signal?.removeEventListener('abort', abort);
      void worker.terminate().finally(() => { if (error) reject(error); else resolve(value!); });
    };
    const abort = () => finish(new Error('documentary_retrieval_cancelled'));
    const deadline = setTimeout(() => finish(new Error('documentary_retrieval_timeout')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', message => {
      if (settled) return;
      if (message.type === 'activity') {
        if (message.status === 'active') activities.set(message.key, startResearchActivity(message.operation === 'expand' ? 'context' : 'nodus', message.operation));
        else { activities.get(message.key)?.('completed', message.count); activities.delete(message.key); }
        return;
      }
      finish(message.error ? new Error(message.error) : null, message);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', (code: number | null) => { if (!settled) { console.warn(`[documentary] retrieval worker exited with code ${code} before replying`); finish(new Error('documentary_retrieval_worker_stopped')); } });
    worker.postMessage({ filename: documentaryStore().db.name, query, lexicalKeys: keys, vectorKeys, vector, settings, threshold, read, activity: researchActivityEnabled() });
  });
  const latest = researchCorpusInventory().documents;
  for (const document of scope.documents) assertResearchDocumentPermission(scope, document.id, latest.find(item => item.id === document.id));
  const evidence = result.passages.map(passage => {
    const document = scope.documents.find(document => document.id === passage.document_id)!;
    const identity = JSON.parse(documentaryStore().getJob(passage.index_key)!.identity_json) as DocumentaryIndexIdentity;
    const coverage = identity.coverage ?? document.coverage;
    return { id: passage.id, documentId: document.id, workId: document.workId, attachmentId: identity.attachmentId, attachmentRevision: identity.attachmentRevision,
      revision: identity.revision, text: passage.text, locator: JSON.parse(passage.locator_json),
      provenance: document.authoredKind ?? (coverage === 'abstract' ? 'abstract' as const : 'source' as const),
      limitations: [...(incompleteAttachments.has(document.id) ? ['attachments_partially_prepared'] : []), ...(identity.revision !== document.revision ? ['previous_indexed_revision'] : []), ...(document.authoredKind ? [document.authoredKind, 'not_primary_evidence'] : coverage === 'abstract' ? ['abstract_only'] : []), ...(document.sourceWarning ? [document.sourceWarning] : []), ...(read?.kind === 'references' ? ['reference_candidates_require_source_review'] : [])] };
  });
  return { evidence, traversal: { ...result.traversal, partial: result.traversal.partial || incompleteAttachments.size > 0 || indexedDocuments.size < scope.documents.length || scope.documents.some(document => document.indexedSource && document.indexedSource.revision !== document.revision) } };
}
