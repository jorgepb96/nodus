import type Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { BrowserWindow } from 'electron';
import type { EmbeddingProvider } from '@shared/types';
import type { EmbeddingIndexContext, EmbeddingIndexCoverage, EmbeddingIndexPreview, EmbeddingIndexProfile, EmbeddingIndexProgress, EmbeddingIndexSummary } from '@shared/embeddingIndexes';
import { EMBEDDING_TEXT_RECIPE_VERSIONS } from '@shared/embeddingIndexes';
import { getDb, onBeforeDatabaseClose, withDatabaseContext, withVaultDatabase, withoutDatabaseContext } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getVaultByPath } from '../vaults/vaultRegistry';
import { commitEmbeddingIndex, contractForProfile, createIndex, deleteIndex, embeddingIndexHead, embeddingProfile,
  indexContext, indexRow, profileFingerprint, refreshedEmbeddingProfile, assertEmbeddingProfileRevision, storeIndexValue, withEmbeddingIndexContext, withoutEmbeddingIndexContext, type IndexRow } from '../db/embeddingIndexesRepo';
import { collectEmbeddingIndexInputs, collectEmbeddingIndexInputsAsync, embeddingInputStillCurrent, externalEmbeddingProfile, type EmbeddingIndexInput } from './embeddingIndexInventory';
import { isEmbeddingGemma2 } from '@shared/embeddingGemma2';
import { embedManyStrict, type EmbeddingExecutionConfig } from './aiClient';
import { geminiBatchEmbeddingEndpoint } from './geminiEmbeddings';
import { documentaryStore, embeddingIdentityParameters, prepareDocumentaryEmbeddings, withDocumentaryWrites } from './documentaryPreparation';
import { documentaryIndexStorage, releaseDocumentaryIndexReferences } from '../db/embeddingDocumentaryRefs';
import type { DocumentaryChunk } from '../db/documentaryStore';
import { collectStudySearchEntries, studySearchExcludedSourceIds } from './studySearch';
import { researchCorpusInventory } from './researchCorpusInventory';
import { researchTestProviderBase } from '../qa/researchProviderProxy';
import { cancelEmbeddingIndexOperations } from './embeddingOperations';
import { defaultEmbeddingInputProfile, validateEmbeddingInputProfile, type EmbeddingInputProfile } from '@shared/embeddingInputProfiles';
import type { EmbeddingRunReason } from '@shared/embeddingRuns';
import { beginEmbeddingRun, changeEmbeddingRun, listEmbeddingRuns, recordEmbeddingRunItem, recordEmbeddingProviderInputs } from '../db/embeddingRunsRepo';

type Selection = { provider: EmbeddingProvider; model: string; input?: EmbeddingInputProfile; indexId?: string; rebuild?: boolean; vaultId?: string };
function assertVault(vaultId?: string): void {
  if (vaultId && getVaultByPath(getDb().name)?.id !== vaultId) throw new Error('La bóveda cambió. Vuelve a abrir la gestión de índices.');
}
const running = new Map<string, { id: string; runId: string; controller: AbortController; task: Promise<void> }>();
const managementScope = new AsyncLocalStorage<string>();
const managementQueue = new Map<string, Promise<unknown>>();
function manage<T>(work: () => Promise<T>): Promise<T> {
  const db = getDb();
  if (managementScope.getStore() === db.name) return work();
  const previous = managementQueue.get(db.name) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => {
    if (!db.open || getDb().name !== db.name) throw new Error('La bóveda cambió durante la preparación del índice.');
    return managementScope.run(db.name, work);
  });
  managementQueue.set(db.name, task);
  void task.finally(() => { if (managementQueue.get(db.name) === task) managementQueue.delete(db.name); }).catch(() => undefined);
  return task;
}
const initialized = new Set<string>();
const listeners = new Set<() => void>();
const timestamp = () => new Date().toISOString();
function sharedSourceRevision(): number {
  const vault = getVaultByPath(getDb().name);
  return vault?.type === 'academic' ? (documentaryStore().db.prepare('SELECT revision FROM documentary_embedding_source_versions WHERE vault_id=?').get(vault.id) as { revision: number } | undefined)?.revision ?? 0 : 0;
}
export function onEmbeddingIndexesChanged(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** `changed` makes every open Settings view list the indexes again. A preparation reports each
 * 32-input batch as progress only: the progress event already carries counts and the run. */
function announce(progress?: EmbeddingIndexProgress, activeChanged = false, changed = true): void {
  if (progress) progress = { ...progress, vaultId: getVaultByPath(getDb().name)?.id, run: listEmbeddingRuns(getDb(), progress.indexId, 1)[0] };
  withoutDatabaseContext(() => withoutEmbeddingIndexContext(() => {
    if (changed) for (const listener of listeners) listener();
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) {
      if (changed) window.webContents.send('embeddingIndexes:changed');
      if (activeChanged) window.webContents.send('embeddingIndexes:activeChanged');
      if (progress) window.webContents.send('embeddingIndexes:progress', progress);
    }
  }));
}
function initialize(db: Database.Database): void {
  if (initialized.has(db.name)) return;
  initialized.add(db.name);
  db.prepare("UPDATE embedding_indexes SET preparation='paused' WHERE preparation='running'").run();
  for (const run of db.prepare("SELECT id FROM embedding_index_runs WHERE state='running'").all() as Array<{ id: string }>) changeEmbeddingRun(db, run.id, 'paused', 'restart');
}
onBeforeDatabaseClose(() => {
  const db = getDb();
  initialized.delete(db.name);
  for (const key of listingInventories.keys()) if (key.startsWith(`${db.name}\0`)) listingInventories.delete(key);
  const job = running.get(db.name);
  if (job) {
    db.prepare("UPDATE embedding_indexes SET preparation='paused' WHERE id=? AND preparation='running'").run(job.id);
    changeEmbeddingRun(db, job.runId, 'paused', 'restart');
    job.controller.abort();
  }
});

type ListingInput = Pick<EmbeddingIndexInput, 'family' | 'entityId' | 'textHash' | 'excluded'>;
/** Listing and preview only need hashes. They are cached per vault and inventory variant until the
 * corpus revision (bumped by every source trigger) or an input policy changes. Preparation never
 * reads this cache: it collects a fresh inventory and re-checks it before activating. */
const listingInventories = new Map<string, { stamp: string; inputs: Promise<ListingInput[]> }>();
function inventoryVariant(db: Database.Database, profile: EmbeddingIndexProfile): string {
  return `${db.name}\0${JSON.stringify([profile.provider, profile.provider === 'nodus' && isEmbeddingGemma2(profile.model)])}`;
}
function inventoryStamp(db: Database.Database): string {
  // Embargoes and testimony agreements can expire without a write, so the stamp also ages out.
  return JSON.stringify([embeddingIndexHead(db)?.corpus_revision ?? 0, getSettings().testimonyAllowExternalProviders ?? null,
    studySearchExcludedSourceIds(), Math.floor(Date.now() / 600_000)]);
}
function listingInventory(profile: EmbeddingIndexProfile): Promise<ListingInput[]> {
  const db = getDb();
  const key = inventoryVariant(db, profile);
  const stamp = inventoryStamp(db);
  const cached = listingInventories.get(key);
  if (cached?.stamp === stamp) return cached.inputs;
  const inputs = withDatabaseContext(db, () => collectEmbeddingIndexInputsAsync(profile, { lean: true }));
  listingInventories.set(key, { stamp, inputs });
  inputs.catch(() => { if (listingInventories.get(key)?.inputs === inputs) listingInventories.delete(key); });
  return inputs;
}
function valuesByEntity(db: Database.Database, context: EmbeddingIndexContext): Map<string, string> {
  return new Map((db.prepare('SELECT family,entity_id,text_hash,recipe_version FROM embedding_index_values WHERE index_id=? AND generation=?')
    .all(context.indexId, context.generation) as Array<{ family: string; entity_id: string; text_hash: string; recipe_version: number }>)
    .filter(row => row.recipe_version === EMBEDDING_TEXT_RECIPE_VERSIONS[row.family]).map(row => [`${row.family}\0${row.entity_id}`, row.text_hash]));
}
function coverageOf(inputs: ListingInput[], existing: Map<string, string>): EmbeddingIndexCoverage[] {
  const result = new Map<string, EmbeddingIndexCoverage>();
  for (const input of inputs) {
    const row = result.get(input.family) ?? { family: input.family, total: 0, indexed: 0, excluded: 0 };
    row.total++;
    if (input.excluded) row.excluded++;
    else if (existing.get(`${input.family}\0${input.entityId}`) === input.textHash) row.indexed++;
    result.set(input.family, row);
  }
  return [...result.values()];
}
interface SharedRevision { index_key: string; document_id: string; chunks_json: string; identity_json: string }
type SharedDocument = ReturnType<typeof researchCorpusInventory>['documents'][number];
function sharedDocuments(): SharedDocument[] {
  const vault = getVaultByPath(getDb().name);
  if (vault?.type !== 'academic') return [];
  const owners = new Set((documentaryStore().db.prepare('SELECT document_id FROM documentary_source_owners WHERE vault_id=?').all(vault.id) as Array<{ document_id: string }>).map(row => row.document_id));
  return researchCorpusInventory().documents.filter(document => document.workId || owners.has(document.id));
}
function sharedRevisions(withChunks = false, documents = sharedDocuments()): SharedRevision[] {
  const vault = getVaultByPath(getDb().name);
  if (vault?.type !== 'academic') return [];
  const current = new Map(documents.map(document => [document.id, document.revision]));
  return (documentaryStore().db.prepare(`SELECT DISTINCT r.index_key,r.document_id,${withChunks ? 'r.chunks_json' : "'' AS chunks_json"},r.identity_json FROM documentary_revisions r
    JOIN documentary_source_owners o ON o.document_id=r.document_id WHERE o.vault_id=? AND r.lexical_ready=1 AND
    (r.index_key IN (SELECT current_key FROM documentary_attachment_heads WHERE document_id=r.document_id)
      OR (r.index_key IN (SELECT index_key FROM documentary_current WHERE document_id=r.document_id)
        AND NOT EXISTS(SELECT 1 FROM documentary_attachment_heads WHERE document_id=r.document_id AND current_key IS NOT NULL)))`)
    .all(vault.id) as SharedRevision[]).filter(revision => current.get(revision.document_id) === JSON.parse(revision.identity_json).revision);
}
function baseRevisionKey(json: string): string {
  const value = JSON.parse(json);
  return JSON.stringify([value.documentId, value.attachmentId, value.attachmentRevision ?? null, value.revision, value.textFingerprint,
    value.chunkerVersion, value.processingVersion, value.coverage ?? null, value.layout ?? null]);
}
/** The research corpus inventory walks the global library; a listing reads it once for all indexes. */
function sharedSnapshot(): { documents: SharedDocument[]; revisions: SharedRevision[] } {
  const documents = sharedDocuments();
  return { documents, revisions: sharedRevisions(false, documents) };
}
function sharedCoverage(profile: EmbeddingIndexProfile, row?: IndexRow, reusable = false, shared = sharedSnapshot()): EmbeddingIndexCoverage {
  const { revisions } = shared;
  const available = new Set(revisions.map(revision => revision.document_id));
  const missing = shared.documents.filter(document => !available.has(document.id)).length;
  const coverage = { family: 'documentary', total: revisions.length + missing, indexed: 0, excluded: missing };
  if (!revisions.length) return coverage;
  const ownKeys = new Set(row ? (getDb().prepare('SELECT index_key FROM embedding_index_documentary_refs WHERE index_id=? AND generation=?')
    .all(row.id, row.generation) as Array<{ index_key: string }>).map(ref => ref.index_key) : []);
  const context = { databasePath: getDb().name, indexId: row?.id ?? '', generation: row?.generation ?? 1, dimensions: row?.dimensions ?? null, profile };
  const parameters = JSON.stringify(embeddingIdentityParameters(executionFor(context)));
  const cached = documentaryStore().db.prepare(`SELECT index_key,identity_json FROM documentary_revisions WHERE embedding_ready=1
    AND document_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(revisions.map(revision => revision.document_id))) as Array<{ index_key: string; identity_json: string }>;
  const bases = new Set(cached.filter(revision => {
    if (!reusable && !ownKeys.has(revision.index_key)) return false;
    const identity = JSON.parse(revision.identity_json);
    return identity.embedding?.provider === profile.provider && identity.embedding?.model === profile.model
      && JSON.stringify(identity.embedding.parameters) === parameters;
  }).map(revision => baseRevisionKey(revision.identity_json)));
  coverage.indexed = revisions.filter(revision => bases.has(baseRevisionKey(revision.identity_json))).length;
  return coverage;
}
function resolveSelection(input: Selection): { profile: EmbeddingIndexProfile; row: IndexRow | undefined } {
  assertVault(input?.vaultId);
  const providers = ['nodus', 'ollama', 'lmstudio', 'openai', 'openrouter', 'gemini'];
  if (input?.rebuild && input.indexId && indexRow(getDb(), input.indexId).legacy && (!providers.includes(input.provider) || input.model === 'unknown')) {
    const settings = getSettings();
    input = { ...input, provider: settings.embeddingProvider, model: settings.embeddingModel };
  }
  if (!input || !providers.includes(input.provider) || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 512) throw new Error('Selecciona un proveedor y un modelo de embeddings válidos.');
  const db = getDb(); initialize(db);
  const profile = input.indexId ? JSON.parse(indexRow(db, input.indexId).profile_json) as EmbeddingIndexProfile : embeddingProfile(getSettings(), input);
  // Rebuilding an unverifiable legacy group creates a modern profile, preserving its source.
  let effective = profile.recipeVersion === 0 ? embeddingProfile(getSettings(), input) : input.rebuild ? refreshedEmbeddingProfile(profile) : profile;
  if (input.input) effective = { ...effective, input: validateEmbeddingInputProfile(input.input, effective.provider, effective.model) };
  else if (input.rebuild && !effective.input) effective = { ...effective, input: defaultEmbeddingInputProfile(effective.provider, effective.model) };
  const row = input.indexId && !indexRow(db, input.indexId).legacy ? indexRow(db, input.indexId)
    : db.prepare('SELECT * FROM embedding_indexes WHERE fingerprint=? AND legacy=0 LIMIT 1').get(profileFingerprint(effective)) as IndexRow | undefined;
  return { profile: effective, row: row?.fingerprint === profileFingerprint(effective) ? row : undefined };
}
function verifiedIndex(db: Database.Database, row: IndexRow): boolean {
  return !row.legacy && !row.staging_generation && row.fingerprint === profileFingerprint(JSON.parse(row.profile_json))
    && row.recipe_stamp === JSON.stringify(EMBEDDING_TEXT_RECIPE_VERSIONS)
    && row.verified_revision === embeddingIndexHead(db)?.corpus_revision && row.documentary_revision === sharedSourceRevision();
}
export async function previewEmbeddingIndex(input: Selection): Promise<EmbeddingIndexPreview> {
  const db = getDb();
  const { profile } = withoutEmbeddingIndexContext(() => resolveSelection(input));
  const inputs = await listingInventory(profile);
  if (getDb() !== db) throw new Error('La bóveda cambió. Vuelve a abrir la gestión de índices.');
  return withoutEmbeddingIndexContext(() => {
    const { row } = resolveSelection(input);
    const existing = row && !input.rebuild ? valuesByEntity(getDb(), indexContext(getDb(), row)) : new Map<string, string>();
    const coverage = coverageOf(inputs, existing);
    const shared = input.rebuild ? { ...sharedCoverage(profile, row), indexed: 0 } : sharedCoverage(profile, row, true);
    if (shared.total) coverage.push(shared);
    const exclusions = new Map<string, number>();
    for (const item of inputs) if (item.excluded) exclusions.set(item.excluded, (exclusions.get(item.excluded) ?? 0) + 1);
    if (shared.excluded) exclusions.set('no_text', (exclusions.get('no_text') ?? 0) + shared.excluded);
    const reusable = coverage.reduce((n, family) => n + family.indexed, 0);
    const excluded = coverage.reduce((n, family) => n + family.excluded, 0);
    return { profile, existingIndexId: row?.id ?? null, external: externalEmbeddingProfile(profile), reusable,
      pending: inputs.length + shared.total - reusable - excluded, excluded, coverage,
      estimatedBytes: row?.dimensions ? inputs.length * row.dimensions * 4 : null,
      exclusions: [...exclusions].map(([reason, count]) => ({ reason, count })) };
  });
}
export async function listEmbeddingIndexes(vaultId?: string): Promise<EmbeddingIndexSummary[]> {
  assertVault(vaultId);
  const db = getDb(); initialize(db);
  const listed = (db.prepare('SELECT * FROM embedding_indexes ORDER BY updated_at DESC,id').all() as IndexRow[])
    .map(row => ({ row, profile: JSON.parse(row.profile_json) as EmbeddingIndexProfile }));
  const inventories = new Map<string, ListingInput[]>();
  for (const { profile } of listed) {
    const variant = inventoryVariant(db, profile);
    if (!inventories.has(variant)) inventories.set(variant, await listingInventory(profile));
  }
  if (getDb() !== db) throw new Error('La bóveda cambió. Vuelve a abrir la gestión de índices.');
  return withoutEmbeddingIndexContext(() => {
    const active = embeddingIndexHead(db)?.active_id;
    const documentary = sharedSnapshot();
    const rows = db.prepare('SELECT id FROM embedding_indexes').all() as Array<{ id: string }>;
    const present = new Set(rows.map(row => row.id));
    return listed.filter(({ row }) => present.has(row.id)).map(({ row: listedRow, profile }) => {
      const row = indexRow(db, listedRow.id);
      const coverage = coverageOf(inventories.get(inventoryVariant(db, profile))!, valuesByEntity(db, indexContext(db, row)));
      const documentaryCoverage = sharedCoverage(profile, row, false, documentary);
      if (documentaryCoverage.total) coverage.push(documentaryCoverage);
      const stored = db.prepare('SELECT COUNT(*) n,COALESCE(SUM(length(embedding)),0) bytes FROM embedding_index_values WHERE index_id=?').get(row.id) as { n: number; bytes: number };
      const vault = getVaultByPath(db.name);
      const shared = vault ? documentaryIndexStorage(documentaryStore().db, vault.id, row.id) : { sharedBytes: 0, reclaimableBytes: 0 };
      return { id: row.id, profile, generation: row.generation, active: row.id === active, legacy: !!row.legacy,
        dimensions: row.dimensions, preparation: row.preparation, completed: row.completed, total: row.total, coverage, vectors: stored.n, bytes: stored.bytes,
        sharedBytes: shared.sharedBytes, reclaimableBytes: stored.bytes + shared.reclaimableBytes, pending: coverage.reduce((n, family) => n + family.total - family.excluded - family.indexed, 0), updatedAt: row.updated_at, error: row.error, run: listEmbeddingRuns(db, row.id, 1)[0] };
    });
  });
}

function executionFor(context: EmbeddingIndexContext): EmbeddingExecutionConfig {
  const profile = context.profile;
  return { provider: profile.provider, modelId: profile.model,
    endpoint: researchTestProviderBase(profile.provider) ?? (profile.provider === 'gemini' ? geminiBatchEmbeddingEndpoint(profile.model) : profile.endpoint),
    scope: context.databasePath, indexId: context.indexId, generation: context.generation, expectedDimensions: context.dimensions ?? undefined, preparing: true, profileFingerprint: profileFingerprint(profile), inputProfile: profile.input };
}
function updateProgress(db: Database.Database, id: string, completed: number, total: number, family: string | null): void {
  db.prepare('UPDATE embedding_indexes SET completed=?,total=?,updated_at=? WHERE id=?').run(completed, total, timestamp(), id);
  announce({ indexId: id, preparation: 'running', completed, total, family, error: null }, false, false);
}
function prepareTestimonyCarrier(db: Database.Database, input: EmbeddingIndexInput, context: EmbeddingIndexContext): void {
  if (input.family !== 'testimony_segment_embeddings') return;
  db.prepare(`INSERT OR IGNORE INTO testimony_segment_embeddings(segment_id,transcript_id,interview_id,model,dim,embedding,created_at) VALUES(?,?,?,?,0,X'',?)`)
    .run(input.entityId, input.transcriptId, input.interviewId, `${context.profile.provider}/${context.profile.model}`, timestamp());
}

async function prepareSharedDocumentary(context: EmbeddingIndexContext, signal: AbortSignal, runId: string): Promise<void> {
  const db = getDb();
  const vault = getVaultByPath(db.name);
  if (vault?.type !== 'academic') return;
  const store = documentaryStore();
  const revisions = sharedRevisions(true);
  const ownRefs = db.prepare('SELECT index_key FROM embedding_index_documentary_refs WHERE index_id=? AND generation=?').all(context.indexId, context.generation) as Array<{ index_key: string }>;
  const ownBases = new Set(ownRefs.flatMap(ref => {
    const row = store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE index_key=? AND embedding_ready=1').get(ref.index_key) as { identity_json: string } | undefined;
    return row ? [baseRevisionKey(row.identity_json)] : [];
  }));
  const allowedBases = new Set(revisions.map(revision => baseRevisionKey(revision.identity_json)));
  for (const ref of ownRefs) {
    const identity = store.db.prepare('SELECT identity_json FROM documentary_revisions WHERE index_key=?').get(ref.index_key) as { identity_json: string } | undefined;
    if (identity && allowedBases.has(baseRevisionKey(identity.identity_json))) continue;
    db.prepare('DELETE FROM embedding_index_documentary_refs WHERE index_id=? AND generation=? AND index_key=?').run(context.indexId, context.generation, ref.index_key);
    store.db.prepare('DELETE FROM documentary_embedding_index_owners WHERE vault_id=? AND index_id=? AND generation=? AND index_key=?').run(vault.id, context.indexId, context.generation, ref.index_key);
  }
  for (const revision of revisions) {
    signal.throwIfAborted();
    if (ownBases.has(baseRevisionKey(revision.identity_json))) {
      recordEmbeddingRunItem(db, runId, 'documentary', revision.document_id + ':' + revision.index_key, baseRevisionKey(revision.identity_json), 'reused'); continue;
    }
    const original = researchCorpusInventory().documents.find(document => document.id === revision.document_id);
    if (!original) continue;
    const assertOwned = () => {
      signal.throwIfAborted();
      if (!store.db.prepare('SELECT 1 FROM documentary_source_owners WHERE vault_id=? AND document_id=?').get(vault.id, revision.document_id)) throw new Error('research_source_not_authorized');
      const current = researchCorpusInventory().documents.find(document => document.id === revision.document_id);
      if (!current || current.permissionRevision !== original.permissionRevision) throw new Error('research_source_not_authorized');
      if (current.revision !== original.revision) throw new Error('research_source_revision_changed');
      const row = indexRow(db, context.indexId);
      if (row.preparation !== 'running') throw new Error('embedding_preparation_stopped');
    };
    const execution = { ...executionFor(context), force: indexRow(db, context.indexId).generation !== context.generation };
    const result = await prepareDocumentaryEmbeddings(revision.index_key, JSON.parse(revision.chunks_json) as DocumentaryChunk[], signal, execution, assertOwned,
      () => {}, count => recordEmbeddingProviderInputs(db, runId, count));
    assertOwned();
    recordEmbeddingRunItem(db, runId, 'documentary', revision.document_id + ':' + revision.index_key, baseRevisionKey(revision.identity_json), result.reused ? 'reused' : 'computed');
    db.prepare('INSERT OR IGNORE INTO embedding_index_documentary_refs(index_id,generation,index_key,document_id) VALUES(?,?,?,?)')
      .run(context.indexId, context.generation, result.indexKey, revision.document_id);
  }
}

async function runPreparation(context: EmbeddingIndexContext, signal: AbortSignal, runId: string): Promise<void> {
  const db = getDb();
  let attempted: EmbeddingIndexInput[] = [];
  try {
    // A final fresh inventory catches edits, removals and newly created entities. Only hashes
    // still pending are embedded in the next pass; no source extraction is performed.
    for (;;) {
      signal.throwIfAborted();
      const inputs = await withDatabaseContext(db, () => collectEmbeddingIndexInputsAsync(context.profile));
      signal.throwIfAborted();
      const existing = valuesByEntity(db, context);
      db.transaction(() => { for (const input of inputs) recordEmbeddingRunItem(db, runId, input.family, input.entityId, input.textHash,
        input.excluded ? 'excluded' : existing.get(`${input.family}\0${input.entityId}`) === input.textHash ? 'reused' : 'pending', input.excluded); })();
      const permitted = inputs.filter(input => !input.excluded);
      const eligible = new Map(permitted.map(input => [`${input.family}\0${input.entityId}`, input]));
      const remove = db.prepare('DELETE FROM embedding_index_values WHERE index_id=? AND generation=? AND family=? AND entity_id=?');
      for (const [key] of existing) if (!eligible.has(key)) { const [family, entity] = key.split('\0'); remove.run(context.indexId, context.generation, family, entity); }
      const pending = permitted.filter(input => existing.get(`${input.family}\0${input.entityId}`) !== input.textHash);
      if (!pending.length) {
        try { await withDocumentaryWrites(() => prepareSharedDocumentary(context, signal, runId)); }
        catch (error) {
          if (!signal.aborted && error instanceof Error && error.message === 'research_source_revision_changed') continue;
          throw error;
        }
        signal.throwIfAborted();
        // No await between final content check and the atomic head update.
        const final = collectEmbeddingIndexInputs(context.profile).filter(input => !input.excluded);
        const values = valuesByEntity(db, context);
        if (final.some(input => values.get(`${input.family}\0${input.entityId}`) !== input.textHash)) continue;
        commitEmbeddingIndex(db, context, sharedSourceRevision());
        changeEmbeddingRun(db, runId, 'complete');
        announce(undefined, true);
        return;
      }
      updateProgress(db, context.indexId, permitted.length - pending.length, permitted.length, null);
      for (let offset = 0; offset < pending.length; offset += 32) {
        signal.throwIfAborted();
        const batch = pending.slice(offset, offset + 32);
        attempted = batch;
        recordEmbeddingProviderInputs(db, runId, batch.length);
        const vectors = await embedManyStrict(batch.map(input => input.text), signal, { config: executionFor(context), role: 'document', titles: batch.map(input => input.title), jobId: `embedding-index:${context.indexId}` });
        signal.throwIfAborted();
        const studyExcluded = new Set(studySearchExcludedSourceIds());
        const studyEntries = batch.some(input => input.family === 'study_search')
          ? new Map(collectStudySearchEntries().filter(entry => !studyExcluded.has(entry.sourceId)).map(entry => [entry.indexId, entry.contentHash])) : undefined;
        db.transaction(() => {
          if (indexRow(db, context.indexId).preparation !== 'running') throw new Error('embedding_preparation_stopped');
          for (let index = 0; index < batch.length; index++) {
            const input = batch[index];
            if (!embeddingInputStillCurrent(input, context.profile, studyEntries)) continue;
            prepareTestimonyCarrier(db, input, context);
            storeIndexValue(db, context, { family: input.family, entityId: input.entityId, textHash: input.textHash, vector: vectors[index], contract: contractForProfile(context.profile, vectors[index].length) });
            recordEmbeddingRunItem(db, runId, input.family, input.entityId, input.textHash, 'computed');
          }
        })();
        attempted = [];
        updateProgress(db, context.indexId, Math.min(permitted.length, permitted.length - pending.length + offset + batch.length), permitted.length, batch[0]?.family ?? null);
      }
    }
  } catch (error) {
    if (!signal.aborted) for (const input of attempted) recordEmbeddingRunItem(db, runId, input.family, input.entityId, input.textHash, 'failed');
    const audit = listEmbeddingRuns(db, context.indexId, 1)[0];
    if (audit?.id === runId && audit.state === 'running') changeEmbeddingRun(db, runId, signal.aborted ? 'paused' : 'error', undefined, signal.aborted ? null : String(error));
    const row = db.prepare('SELECT * FROM embedding_indexes WHERE id=?').get(context.indexId) as IndexRow | undefined;
    if (row && row.preparation === 'running') {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare('UPDATE embedding_indexes SET preparation=?,error=?,updated_at=? WHERE id=?')
        .run(signal.aborted ? 'paused' : 'error', signal.aborted ? null : message, timestamp(), row.id);
      announce({ indexId: row.id, preparation: signal.aborted ? 'paused' : 'error', completed: row.completed, total: row.total, family: null, error: signal.aborted ? null : message });
    }
  }
}

async function launch(id: string, reason: EmbeddingRunReason = 'manual'): Promise<void> {
  const db = getDb();
  const owner = getVaultByPath(db.name);
  if (!owner) throw new Error('No se encontró la bóveda del índice.');
  const previous = running.get(db.name);
  if (previous) {
    db.prepare("UPDATE embedding_indexes SET preparation='paused' WHERE id=? AND preparation='running'").run(previous.id);
    previous.controller.abort();
    await previous.task;
  }
  if (!db.open || getDb().name !== db.name) throw new Error('La bóveda cambió durante la preparación del índice.');
  db.prepare("UPDATE embedding_indexes SET preparation='running',error=NULL,updated_at=? WHERE id=?").run(timestamp(), id);
  db.prepare('UPDATE embedding_index_state SET pending_id=? WHERE singleton=1').run(id);
  const context = indexContext(db, indexRow(db, id), true);
  const runId = beginEmbeddingRun(db, id, context.generation, reason);
  const controller = new AbortController();
  const task = withoutDatabaseContext(() => withoutEmbeddingIndexContext(() => withVaultDatabase(owner.id,
    () => withEmbeddingIndexContext(context, () => runPreparation(context, controller.signal, runId)))));
  const entry = { id, runId, controller, task };
  running.set(db.name, entry);
  void task.finally(() => { if (running.get(db.name) === entry) running.delete(db.name); }).catch(() => undefined);
  announce();
}
async function prepareEmbeddingIndexNow(input: Selection): Promise<string> {
  return withoutEmbeddingIndexContext(async () => {
    const db = getDb();
    const resolved = resolveSelection(input);
    const row = resolved.row ?? createIndex(db, resolved.profile);
    if (input.rebuild) {
      const next = Math.max(row.generation, row.staging_generation ?? 0) + 1;
      db.prepare('UPDATE embedding_indexes SET staging_generation=?,staging_dimensions=NULL WHERE id=?').run(next, row.id);
    }
    if (!input.rebuild && verifiedIndex(db, row)) {
      await activateEmbeddingIndex(row.id);
      return row.id;
    }
    await launch(row.id, input.rebuild ? 'rebuild' : embeddingIndexHead(db)?.active_id !== row.id ? 'model_change' : 'manual');
    return row.id;
  });
}
async function activateEmbeddingIndexNow(id: string, vaultId?: string): Promise<void> {
  assertVault(vaultId);
  const db = getDb();
  const row = indexRow(db, id);
  assertEmbeddingProfileRevision(JSON.parse(row.profile_json));
  if (row.legacy) throw new Error('Reconstruye el índice heredado antes de activarlo.');
  if (verifiedIndex(db, row) && row.preparation === 'idle') {
    const runId = beginEmbeddingRun(db, row.id, row.generation, 'activation');
    db.prepare('UPDATE embedding_index_state SET pending_id=? WHERE singleton=1').run(id);
    commitEmbeddingIndex(db, indexContext(db, row), sharedSourceRevision());
    changeEmbeddingRun(db, runId, 'complete');
    announce(undefined, true);
    return;
  }
  const profile = JSON.parse(row.profile_json) as EmbeddingIndexProfile;
  const preview = await previewEmbeddingIndex({ ...profile, indexId: id });
  if (preview.pending) throw new Error('Actualiza los pendientes antes de activar este índice.');
  await launch(id);
}
async function controlEmbeddingIndexNow(id: string, action: 'pause' | 'resume' | 'cancel', vaultId?: string): Promise<void> {
  assertVault(vaultId);
  if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('Acción de preparación no válida.');
  if (action === 'resume') { await launch(id, indexRow(getDb(), id).preparation === 'error' ? 'retry' : 'resume'); return; }
  const db = getDb(); indexRow(db, id);
  db.prepare('UPDATE embedding_indexes SET preparation=?,updated_at=? WHERE id=?').run(action === 'pause' ? 'paused' : 'cancelled', timestamp(), id);
  const job = running.get(db.name);
  if (job?.id === id) { job.controller.abort(); await job.task; }
  const audit = listEmbeddingRuns(db, id, 1)[0];
  if (audit && audit.state !== 'complete') changeEmbeddingRun(db, audit.id, action === 'pause' ? 'paused' : 'cancelled');
  if (action === 'cancel') db.prepare('UPDATE embedding_index_state SET pending_id=NULL WHERE pending_id=?').run(id);
  announce();
}
async function deleteEmbeddingIndexNow(id: string, vaultId?: string): Promise<void> {
  assertVault(vaultId);
  const origin = getDb().name;
  cancelEmbeddingIndexOperations(origin, id);
  if (embeddingIndexHead(getDb())?.active_id === id) {
    const pending = running.get(origin);
    if (pending && pending.id !== id) await controlEmbeddingIndex(pending.id, 'pause');
  }
  await controlEmbeddingIndex(id, 'cancel');
  if (getDb().name !== origin) throw new Error('La bóveda cambió antes de eliminar el índice.');
  const db = getDb();
  const vault = getVaultByPath(db.name);
  await withDocumentaryWrites(() => {
    deleteIndex(db, id);
    // Retire vault references before shared collection. A failure can leave an
    // extra shared owner, never a live reference to a reclaimed vector revision.
    if (vault) releaseDocumentaryIndexReferences(documentaryStore().db, vault.id, id);
  });
  announce(undefined, true);
}

export async function pauseAllEmbeddingIndexPreparations(): Promise<void> {
  for (const job of running.values()) job.controller.abort();
  await Promise.all([...running.values()].map(job => job.task));
}

export const prepareEmbeddingIndex = (input: Selection): Promise<string> => manage(() => prepareEmbeddingIndexNow(input));
export const activateEmbeddingIndex = (id: string, vaultId?: string): Promise<void> => manage(() => activateEmbeddingIndexNow(id, vaultId));
export const controlEmbeddingIndex = (id: string, action: 'pause' | 'resume' | 'cancel', vaultId?: string): Promise<void> => manage(() => controlEmbeddingIndexNow(id, action, vaultId));
export const deleteEmbeddingIndex = (id: string, vaultId?: string): Promise<void> => manage(() => deleteEmbeddingIndexNow(id, vaultId));
export function listEmbeddingIndexRuns(indexId?: string, vaultId?: string) { assertVault(vaultId); initialize(getDb()); return listEmbeddingRuns(getDb(), indexId); }
