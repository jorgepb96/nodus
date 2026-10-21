import type Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { EmbeddingContract } from '@shared/embeddingContract';
import { canonicalizeEmbeddingContract, createEmbeddingContract } from '@shared/embeddingContract';
import { embeddingGemma2Contract, isEmbeddingGemma2 } from '@shared/embeddingGemma2';
import type { EmbeddingIndexContext, EmbeddingIndexProfile, EmbeddingIndexSummary, StoredEmbeddingValue } from '@shared/embeddingIndexes';
import { EMBEDDING_TEXT_RECIPE_VERSIONS } from '@shared/embeddingIndexes';
import { DEFAULT_EMBEDDING_MODELS, DEFAULT_LOCAL_BASE_URLS, normalizeEmbeddingModel } from '@shared/providers';
import type { AppSettings, EmbeddingProvider } from '@shared/types';
import { getNodusLocalModel } from '@shared/localAiModels';
import { knownEmbeddingModelRevision, normalizeEmbeddingEndpoint } from '../ai/embeddingModelRevisions';
export { normalizeEmbeddingEndpoint } from '../ai/embeddingModelRevisions';
import { embeddingProvenance } from '../ai/embeddingProvenance';
import { defaultEmbeddingInputProfile, validateEmbeddingInputProfile, type EmbeddingInputProfile } from '@shared/embeddingInputProfiles';

const operation = new AsyncLocalStorage<EmbeddingIndexContext | null>();
const registeredConnections = new Map<string, Set<Database.Database>>();
const connectionHeads = new WeakMap<Database.Database, { indexId: string; generation: number } | null>();
function refreshConnectionHeads(db: Database.Database): void {
  const row = db.prepare('SELECT i.id,i.generation FROM embedding_indexes i JOIN embedding_index_state h ON h.active_id=i.id AND h.enabled=1').get() as { id: string; generation: number } | undefined;
  const context = row ? { indexId: row.id, generation: row.generation } : null;
  for (const connection of db.name === ':memory:' || !db.name ? [db] : registeredConnections.get(db.name) ?? []) {
    if (connection.open) connectionHeads.set(connection, context);
    else registeredConnections.get(db.name)?.delete(connection);
  }
}
export const currentEmbeddingIndexContext = () => operation.getStore();
export const withEmbeddingIndexContext = <T>(context: EmbeddingIndexContext | null, work: () => T): T => operation.run(context, work);
export const withoutEmbeddingIndexContext = <T>(work: () => T): T => operation.exit(work);
type Head = { active_id: string | null; enabled: number; pending_id: string | null; epoch: number; corpus_revision: number };
export interface IndexRow {
  id: string; fingerprint: string; profile_json: string; generation: number; staging_generation: number | null;
  staging_dimensions: number | null;
  legacy: number; dimensions: number | null; preparation: EmbeddingIndexSummary['preparation'];
  completed: number; total: number; error: string | null; updated_at: string;
  verified_revision: number; value_revision: number;
  documentary_revision: number;
  recipe_stamp: string;
}
export function hasEmbeddingIndexes(db: Database.Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='embedding_index_state'").get();
}
export function embeddingIndexHead(db: Database.Database): Head | null {
  return hasEmbeddingIndexes(db) ? db.prepare('SELECT * FROM embedding_index_state WHERE singleton=1').get() as Head : null;
}
export function indexRow(db: Database.Database, id: string): IndexRow {
  const row = db.prepare('SELECT * FROM embedding_indexes WHERE id=?').get(id) as IndexRow | undefined;
  if (!row) throw new Error('No se encontró el índice de embeddings.');
  return row;
}
export function embeddingGenerationRevision(db: Database.Database, indexId: string, generation: number): number {
  return (db.prepare('SELECT value_revision FROM embedding_index_generations WHERE index_id=? AND generation=?').get(indexId, generation) as { value_revision: number } | undefined)?.value_revision ?? 0;
}
export function indexContext(db: Database.Database, row: IndexRow, staging = false): EmbeddingIndexContext {
  return { databasePath: db.name, indexId: row.id, generation: staging ? row.staging_generation ?? row.generation : row.generation,
    dimensions: staging && row.staging_generation ? row.staging_dimensions : row.dimensions, profile: JSON.parse(row.profile_json) };
}
export function activeEmbeddingIndex(db: Database.Database): EmbeddingIndexContext | null {
  const captured = operation.getStore();
  if (captured !== undefined) {
    if (captured && captured.databasePath !== db.name) throw new Error('La bóveda cambió durante la operación de embeddings.');
    return captured;
  }
  const head = embeddingIndexHead(db);
  return head?.enabled && head.active_id ? indexContext(db, indexRow(db, head.active_id)) : null;
}

export function embeddingProfile(settings: Pick<AppSettings, 'embeddingProvider' | 'embeddingModel' | 'localProviders'>, input?: { provider: EmbeddingProvider; model: string; input?: EmbeddingInputProfile }): EmbeddingIndexProfile {
  const provider = input?.provider ?? settings.embeddingProvider ?? 'openai';
  const model = normalizeEmbeddingModel(provider, input?.model ?? settings.embeddingModel ?? DEFAULT_EMBEDDING_MODELS[provider]);
  const endpoint = provider === 'nodus' ? 'nodus-local-runtime' : provider === 'ollama' || provider === 'lmstudio'
    ? `${(settings.localProviders?.[provider]?.baseUrl || DEFAULT_LOCAL_BASE_URLS[provider]).replace(/\/+$/, '')}/v1`
    : provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
      : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1';
  const assets = provider === 'nodus' ? getNodusLocalModel(model)?.assets : undefined;
  const modelRevision = assets?.every(asset => asset.sha256)
    ? createHash('sha256').update(JSON.stringify(assets.map(asset => [asset.file, asset.sha256]))).digest('hex') : knownEmbeddingModelRevision(provider, endpoint, model);
  return { provider, model, endpoint: normalizeEmbeddingEndpoint(endpoint), modelRevision, recipeVersion: 1,
    input: validateEmbeddingInputProfile(input?.input ?? defaultEmbeddingInputProfile(provider, model), provider, model) };
}
export function profileFingerprint(profile: EmbeddingIndexProfile): string {
  const contract = contractForProfile(profile, profile.provider === 'nodus' && isEmbeddingGemma2(profile.model) ? embeddingGemma2Contract(profile.model).dim : 1);
  return createHash('sha256').update(JSON.stringify([profile.provider, profile.model, profile.endpoint, profile.modelRevision, profile.recipeVersion, canonicalizeEmbeddingContract(contract)])).digest('hex');
}
export function refreshedEmbeddingProfile(profile: EmbeddingIndexProfile): EmbeddingIndexProfile {
  const assets = profile.provider === 'nodus' ? getNodusLocalModel(profile.model)?.assets : undefined;
  const revision = assets?.every(asset => asset.sha256)
    ? createHash('sha256').update(JSON.stringify(assets.map(asset => [asset.file, asset.sha256]))).digest('hex')
    : knownEmbeddingModelRevision(profile.provider, profile.endpoint, profile.model);
  return revision ? { ...profile, modelRevision: revision } : profile;
}
export function assertEmbeddingProfileRevision(profile: EmbeddingIndexProfile): void {
  if (refreshedEmbeddingProfile(profile).modelRevision !== profile.modelRevision) throw new Error('El modelo ha cambiado de revisión. Reconstruye su índice desde Ajustes.');
}
export function contractForProfile(profile: EmbeddingIndexProfile, dim: number): EmbeddingContract {
  if (profile.provider === 'nodus' && isEmbeddingGemma2(profile.model)) {
    const contract = embeddingGemma2Contract(profile.model);
    if (contract.dim !== dim) throw new Error('embedding_contract_dimension_mismatch');
    return contract;
  }
  // Only models that declare their pooling carry it, so historical fingerprints are unchanged.
  const pooling = profile.provider === 'nodus' ? getNodusLocalModel(profile.model)?.pooling : undefined;
  return createEmbeddingContract({ provider: profile.provider, model: profile.model, dim,
    protocol: 'nodus.embedding.local.v1', task: 'retrieval',
    preprocessing: { input: 'utf16-8000', endpoint: profile.endpoint, modelRevision: profile.modelRevision,
      ...(profile.input ? { inputProfile: profile.input } : {}), ...(pooling ? { pooling } : {}) },
    normalization: profile.provider === 'nodus' ? 'l2' : 'provider-output',
    quantization: profile.provider === 'nodus' ? { weights: getNodusLocalModel(profile.model)?.quantization ?? 'unknown', output: 'float32' } : 'provider-output/float32', configVersion: 1 });
}
export function createIndex(db: Database.Database, profile: EmbeddingIndexProfile): IndexRow {
  const id = randomUUID();
  db.prepare('INSERT INTO embedding_indexes(id,fingerprint,profile_json,updated_at) VALUES(?,?,?,?)')
    .run(id, profileFingerprint(profile), JSON.stringify(profile), new Date().toISOString());
  return indexRow(db, id);
}

/** Empty vaults can configure their first model without an index build. Explicit deletion
 * sets enabled=0 and is never undone by an indexing timer or a settings read. */
export function ensureInitialEmbeddingIndex(db: Database.Database, profile: EmbeddingIndexProfile): EmbeddingIndexContext | null {
  const head = embeddingIndexHead(db);
  if (!head || !head.enabled) return null;
  if (head.active_id) {
    const current = indexRow(db, head.active_id);
    if (current.fingerprint === profileFingerprint(profile)) return indexContext(db, current);
    const effective = JSON.parse(current.profile_json) as EmbeddingIndexProfile;
    // Reading settings must preserve an already activated recipe, including custom
    // prefixes and the pre-profile recipe of an existing index.
    if (effective.provider === profile.provider && effective.model === profile.model && effective.endpoint === profile.endpoint
      && effective.modelRevision === profile.modelRevision) return indexContext(db, current);
    const count = db.prepare('SELECT 1 FROM embedding_index_values WHERE index_id=? LIMIT 1').get(current.id);
    const content = db.prepare(`SELECT 1 FROM ideas UNION ALL SELECT 1 FROM work_summaries
      UNION ALL SELECT 1 FROM passages UNION ALL SELECT 1 FROM notes
      UNION ALL SELECT 1 FROM archive_items UNION ALL SELECT 1 FROM study_docs
      UNION ALL SELECT 1 FROM study_materials UNION ALL SELECT 1 FROM testimony_transcript_segments LIMIT 1`).get();
    if (count || content) throw new Error('Prepara y activa el nuevo índice antes de cambiar el modelo de embeddings.');
  }
  if (!head.active_id) {
    const adopted = adoptLegacyEmbeddingIndex(db, profile);
    if (adopted) return adopted;
  }
  const hasLegacy = db.prepare('SELECT 1 FROM embedding_indexes WHERE legacy=1 LIMIT 1').get();
  if (hasLegacy && !head.active_id) return null;
  const existing = db.prepare('SELECT * FROM embedding_indexes WHERE fingerprint=? AND legacy=0 LIMIT 1').get(profileFingerprint(profile)) as IndexRow | undefined;
  const row = existing ?? createIndex(db, profile);
  db.prepare('UPDATE embedding_index_state SET active_id=?,epoch=epoch+1 WHERE singleton=1').run(row.id);
  refreshConnectionHeads(db);
  return indexContext(db, row);
}

/** The v203 migration moved every stored vector into a legacy set and left the vault with no
 * active index, so a vault that was fully indexed asked for a complete rebuild. A legacy set
 * produced by the provider and model the vault still selects IS the index it was searching with:
 * before saved indexes, embeddings were sent without prefixes or Gemini task types (EmbeddingGemma 2
 * kept its native template), clipped to the same 8,000 characters. Adopt it as the active index
 * instead. Rows whose text changed since stay searchable, exactly as before the update, and count
 * as pending until the next update recomputes only them. Sets from any other model stay legacy. */
export function adoptLegacyEmbeddingIndex(db: Database.Database, selected: EmbeddingIndexProfile): EmbeddingIndexContext | null {
  try {
    const head = embeddingIndexHead(db);
    if (!head?.enabled || head.active_id) return null;
    const candidates = (db.prepare('SELECT * FROM embedding_indexes WHERE legacy=1 AND dimensions IS NOT NULL').all() as IndexRow[]).filter(row => {
      const legacy = JSON.parse(row.profile_json) as { provider?: string; model?: string };
      return legacy.provider === selected.provider && typeof legacy.model === 'string'
        && normalizeEmbeddingModel(selected.provider, legacy.model) === selected.model;
    });
    if (!candidates.length) return null;
    const count = db.prepare('SELECT COUNT(*) n FROM embedding_index_values WHERE index_id=?');
    const legacy = candidates.map(row => ({ row, n: (count.get(row.id) as { n: number }).n })).sort((a, b) => b.n - a.n)[0].row;
    const dim = legacy.dimensions!;
    const native = selected.provider === 'nodus' && isEmbeddingGemma2(selected.model);
    const input = native ? defaultEmbeddingInputProfile(selected.provider, selected.model) : { version: 1 as const, kind: 'plain' as const, queryPrefix: '', documentPrefix: '' };
    const profile: EmbeddingIndexProfile = { ...selected, input: validateEmbeddingInputProfile(input, selected.provider, selected.model) };
    const contract = canonicalizeEmbeddingContract(contractForProfile(profile, dim));
    const fingerprint = profileFingerprint(profile);
    const recipes = Object.entries(EMBEDDING_TEXT_RECIPE_VERSIONS);
    const recipe = `CASE family ${recipes.map(([family, version]) => `WHEN '${family}' THEN ${version}`).join(' ')} END`;
    const stamp = new Date().toISOString();
    const adopted = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM embedding_indexes WHERE fingerprint=? AND legacy=0 ORDER BY updated_at DESC LIMIT 1').get(fingerprint) as IndexRow | undefined;
      if (existing && (existing.preparation === 'running' || (existing.dimensions !== null && existing.dimensions !== dim))) return null;
      const target = existing ?? createIndex(db, profile);
      // A rebuild staged before this adoption never finished; its generation is superseded.
      db.prepare('DELETE FROM embedding_index_values WHERE index_id=? AND generation<>?').run(target.id, target.generation);
      const moved = db.prepare(`UPDATE OR IGNORE embedding_index_values SET index_id=?,generation=?,contract_json=?,recipe_version=${recipe}
        WHERE index_id=? AND length(embedding)=? AND family IN (SELECT value FROM json_each(?))`)
        .run(target.id, target.generation, contract, legacy.id, dim * 4, JSON.stringify(recipes.map(([family]) => family))).changes;
      if (!moved) throw new Error('embedding_legacy_adoption_empty');
      db.prepare('DELETE FROM embedding_indexes WHERE id=? AND NOT EXISTS(SELECT 1 FROM embedding_index_values WHERE index_id=?)').run(legacy.id, legacy.id);
      db.prepare(`UPDATE embedding_indexes SET dimensions=?,staging_generation=NULL,staging_dimensions=NULL,preparation='idle',error=NULL,
        completed=0,total=0,verified_revision=-1,documentary_revision=-1,recipe_stamp=?,updated_at=? WHERE id=?`)
        .run(dim, JSON.stringify(EMBEDDING_TEXT_RECIPE_VERSIONS), stamp, target.id);
      db.prepare('UPDATE embedding_index_state SET active_id=?,enabled=1,pending_id=CASE WHEN pending_id IN (?,?) THEN NULL ELSE pending_id END,epoch=epoch+1 WHERE singleton=1')
        .run(target.id, target.id, legacy.id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='embedding_index_runs'").get()) {
        const run = randomUUID();
        db.prepare(`INSERT INTO embedding_index_runs(id,index_id,generation,reason,last_reason,state,reviewed,reused,started_at,updated_at)
          VALUES(?,?,?,'activation','activation','complete',?,?,?,?)`).run(run, target.id, target.generation, moved, moved, stamp, stamp);
        db.prepare("INSERT INTO embedding_index_run_events(run_id,reason,state,created_at) VALUES(?,'activation','complete',?)").run(run, stamp);
      }
      return target.id;
    }).immediate();
    if (!adopted) return null;
    refreshConnectionHeads(db);
    return indexContext(db, indexRow(db, adopted));
  } catch (error) {
    if (!(error instanceof Error && error.message === 'embedding_legacy_adoption_empty')) console.warn('[embeddings] legacy index adoption skipped:', error);
    return null;
  }
}

/** Register on every connection that reads compatibility views or writes carrier rows.
 * The closure reads the AsyncLocalStorage context at execution time, not registration. */
export function registerEmbeddingIndexFunctions(db: Database.Database, pinned?: { indexId: string; generation: number } | null): void {
  const connections = registeredConnections.get(db.name) ?? new Set<Database.Database>();
  connections.add(db); registeredConnections.set(db.name, connections);
  if (hasEmbeddingIndexes(db)) refreshConnectionHeads(db);
  db.function('nodus_embedding_index', { deterministic: true }, () => {
    const context = pinned === undefined ? operation.getStore() : pinned;
    if (context && 'databasePath' in context && context.databasePath !== db.name) return null;
    if (context !== undefined && (context === null || !('databasePath' in context) || context.databasePath === db.name)) return context?.indexId ?? null;
    return connectionHeads.get(db)?.indexId ?? null;
  });
  db.function('nodus_embedding_generation', { deterministic: true }, () => {
    const context = pinned === undefined ? operation.getStore() : pinned;
    if (context && 'databasePath' in context && context.databasePath !== db.name) return 0;
    if (context && (!('databasePath' in context) || context.databasePath === db.name)) return context.generation;
    return connectionHeads.get(db)?.generation ?? 0;
  });
  db.function('nodus_embedding_contract', { deterministic: true }, (json: unknown, dim: unknown) => canonicalizeEmbeddingContract(contractForProfile(JSON.parse(String(json)), Number(dim))));
  db.function('nodus_embedding_vector_valid', { deterministic: true }, (value: unknown) => {
    if (!Buffer.isBuffer(value) || !value.byteLength || value.byteLength % 4) return 0;
    const floats = new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    return floats.every(Number.isFinite) && floats.some(number => number !== 0) ? 1 : 0;
  });
}

export function storeIndexValue(db: Database.Database, context: EmbeddingIndexContext, value: StoredEmbeddingValue): void {
  storeIndexValues(db, context, [value]);
}

export function storeIndexValues(db: Database.Database, context: EmbeddingIndexContext, values: StoredEmbeddingValue[]): void {
  if (!values.length) return;
  if (context.databasePath !== db.name) throw new Error('embedding_index_vault_mismatch');
  assertEmbeddingProfileRevision(context.profile);
  const row = indexRow(db, context.indexId);
  if (row.fingerprint !== profileFingerprint(context.profile)) throw new Error('embedding_contract_mismatch');
  if (row.legacy || (context.generation !== row.generation && context.generation !== row.staging_generation)) throw new Error('embedding_index_generation_retired');
  const dim = values[0].vector.length;
  const contract = canonicalizeEmbeddingContract(contractForProfile(context.profile, dim));
  const generationDimension = context.generation === row.generation ? row.dimensions : row.staging_dimensions;
  if (generationDimension !== null && generationDimension !== dim) throw new Error('embedding_contract_dimension_mismatch');
  for (const value of values) {
    const origin = embeddingProvenance(value.vector);
    if (origin && (origin.indexId !== context.indexId || origin.generation !== context.generation || origin.databasePath !== context.databasePath)) throw new Error('embedding_index_configuration_changed');
    if (value.vector.length !== dim || !dim || value.vector.some(number => !Number.isFinite(number)) || !value.vector.some(number => number !== 0)) throw new Error('embedding_vector_invalid');
    if (contract !== canonicalizeEmbeddingContract(value.contract)) throw new Error('embedding_contract_mismatch');
  }
  const stamp = new Date().toISOString();
  db.transaction(() => {
    if (context.generation === row.generation) db.prepare('UPDATE embedding_indexes SET dimensions=COALESCE(dimensions,?),updated_at=? WHERE id=?').run(dim, stamp, row.id);
    else db.prepare('UPDATE embedding_indexes SET staging_dimensions=COALESCE(staging_dimensions,?),updated_at=? WHERE id=?').run(dim, stamp, row.id);
    const insert = db.prepare(`INSERT OR REPLACE INTO embedding_index_values(index_id,generation,family,entity_id,text_hash,contract_json,embedding,created_at,recipe_version) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const value of values) {
      const vector = Float32Array.from(value.vector);
      if (!vector.every(Number.isFinite) || !vector.some(number => number !== 0)) throw new Error('embedding_vector_invalid');
      const recipe = EMBEDDING_TEXT_RECIPE_VERSIONS[value.family];
      if (!recipe) throw new Error('embedding_family_unknown');
      insert.run(context.indexId, context.generation, value.family, value.entityId, value.textHash, contract, Buffer.from(vector.buffer), stamp, recipe);
    }
  })();
}

/** Legacy cache actions affect the captured active generation, never other models. */
export function clearActiveEmbeddingFamilies(db: Database.Database, families: readonly string[]): number {
  const context = activeEmbeddingIndex(db);
  if (!context) return 0;
  return db.transaction(() => {
    const result = db.prepare('DELETE FROM embedding_index_values WHERE index_id=? AND generation=? AND family IN (SELECT value FROM json_each(?))')
      .run(context.indexId, context.generation, JSON.stringify(families));
    db.prepare('UPDATE embedding_indexes SET verified_revision=-1 WHERE id=?').run(context.indexId);
    return result.changes;
  })();
}

export function commitEmbeddingIndex(db: Database.Database, context: EmbeddingIndexContext, documentaryRevision?: number): void {
  assertEmbeddingProfileRevision(context.profile);
  db.transaction(() => {
    const row = indexRow(db, context.indexId);
    const head = embeddingIndexHead(db)!;
    if (context.databasePath !== db.name || row.fingerprint !== profileFingerprint(context.profile)
      || context.generation !== (row.staging_generation ?? row.generation)) throw new Error('embedding_index_generation_retired');
    if (row.legacy || head.pending_id !== context.indexId || row.preparation === 'cancelled' || row.preparation === 'paused') throw new Error('embedding_index_activation_superseded');
    db.prepare("UPDATE embedding_indexes SET dimensions=CASE WHEN staging_generation=? THEN staging_dimensions ELSE dimensions END,generation=?,staging_generation=NULL,staging_dimensions=NULL,preparation='idle',error=NULL,verified_revision=(SELECT corpus_revision FROM embedding_index_state),updated_at=? WHERE id=?")
      .run(context.generation, context.generation, new Date().toISOString(), row.id);
    if (documentaryRevision !== undefined) db.prepare('UPDATE embedding_indexes SET documentary_revision=? WHERE id=?').run(documentaryRevision, row.id);
    db.prepare('UPDATE embedding_indexes SET recipe_stamp=? WHERE id=?').run(JSON.stringify(EMBEDDING_TEXT_RECIPE_VERSIONS), row.id);
    db.prepare('UPDATE embedding_index_state SET active_id=?,enabled=1,pending_id=NULL,epoch=epoch+1 WHERE singleton=1').run(row.id);
    const settings = db.prepare("SELECT value FROM settings WHERE key='app'").get() as { value: string } | undefined;
    const patch = { ...(settings ? JSON.parse(settings.value) : {}), embeddingProvider: context.profile.provider, embeddingModel: context.profile.model };
    db.prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(patch));
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='dictionary_retrieval_state'").get()) db.exec('DELETE FROM dictionary_retrieval_state');
  }).immediate();
  refreshConnectionHeads(db);
}

export function deleteIndex(db: Database.Database, id: string): void {
  db.transaction(() => {
    indexRow(db, id);
    db.prepare('UPDATE embedding_index_state SET enabled=CASE WHEN active_id=? THEN 0 ELSE enabled END,active_id=CASE WHEN active_id=? THEN NULL ELSE active_id END,pending_id=CASE WHEN pending_id=? THEN NULL ELSE pending_id END,epoch=epoch+1').run(id, id, id);
    db.prepare('DELETE FROM embedding_indexes WHERE id=?').run(id);
  }).immediate();
  refreshConnectionHeads(db);
}

/** Import an old file-backed cache without asserting compatibility that it never recorded. */
export function importLegacyStudyVectors(db: Database.Database, provider: string, model: string, entries: Array<{ indexId: string; contentHash: string; embedding: number[] | null }>): void {
  db.transaction(() => {
    for (const entry of entries) {
      if (!entry.embedding?.length) continue;
      const dim = entry.embedding.length;
      const profile = { provider, model, endpoint: 'legacy:unknown', modelRevision: null, recipeVersion: 0 };
      const fingerprint = createHash('sha256').update(JSON.stringify({ ...profile, dim })).digest('hex');
      const id = `legacy-${fingerprint}`;
      db.prepare('INSERT OR IGNORE INTO embedding_indexes(id,fingerprint,profile_json,legacy,dimensions,updated_at) VALUES(?,?,?,?,?,?)')
        .run(id, fingerprint, JSON.stringify(profile), 1, dim, new Date().toISOString());
      const floats = Float32Array.from(entry.embedding);
      const contract = { provider, model, dim, protocol: 'legacy_locked', task: 'unknown', preprocessing: 'unknown', normalization: 'unknown', quantization: 'float32', configVersion: 'legacy-local' };
      db.prepare(`INSERT OR IGNORE INTO embedding_index_values(index_id,generation,family,entity_id,text_hash,contract_json,embedding,created_at) VALUES(?,1,'study_search',?,?,?,?,?)`)
        .run(id, entry.indexId, entry.contentHash, JSON.stringify(contract), Buffer.from(floats.buffer), new Date().toISOString());
      const copied = db.prepare("SELECT length(embedding) bytes FROM embedding_index_values WHERE index_id=? AND generation=1 AND family='study_search' AND entity_id=?").get(id, entry.indexId) as { bytes: number };
      if (copied.bytes !== floats.byteLength) throw new Error('embedding_migration_inventory_mismatch:study_search');
    }
  }).immediate();
}
