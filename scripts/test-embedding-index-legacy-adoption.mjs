import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-index-legacy-adoption')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-adoption-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { migrations, runMigrations, SCHEMA_VERSION } = require('../electron/db/migrations.ts');
const { migrateDatabaseSafely } = require('../electron/db/migrationSafety.ts');
const repo = require('../electron/db/embeddingIndexesRepo.ts');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/** A 5.13 vault: vectors live in the source rows, stamped with the provider and model that made them. */
function migratedVault(name, settings, rows) {
  const file = path.join(root, `${name}.sqlite`);
  let db = new Database(file);
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter(migration => migration.version < 203)) db.transaction(() => { db.exec(migration.up); migration.after?.(db); db.pragma(`user_version=${migration.version}`); })();
  db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify(settings));
  const insert = db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at,embedding,embedding_provider,embedding_model,embedding_dim,embedding_text_hash) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const [id, provider, model, vector] of rows) insert.run(id, 'claim', id, 'Evidence', '2026-10-18', Buffer.from(new Float32Array(vector).buffer), provider, model, vector.length, `hash-${id}`);
  const before = db.prepare('SELECT global_id,hex(embedding) bytes FROM ideas ORDER BY global_id').all();
  db = migrateDatabaseSafely(db, file, SCHEMA_VERSION, runMigrations);
  return { db, before };
}

test('a fully indexed vault keeps searching with its own vectors after the saved-index migration', () => {
  const { db, before } = migratedVault('selected', { embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' }, [
    ['a', 'openrouter', 'baai/bge-m3', [1, 0, 0]], ['b', 'openrouter', 'baai/bge-m3', [0, 1, 0]], ['c', 'ollama', 'other', [0, 1]],
  ]);
  try {
    assert.equal(db.prepare('SELECT active_id FROM embedding_index_state').get().active_id, null, 'the migration itself still activates nothing');
    // The state a 5.14.0 user reached: a rebuild of the same model failed on its first batch.
    const selected = repo.embeddingProfile({ embeddingProvider: 'openrouter', embeddingModel: 'BAAI:bge-m3' });
    const failed = repo.createIndex(db, selected);
    db.prepare("UPDATE embedding_indexes SET staging_generation=2,preparation='error',error='Connection error.',total=2 WHERE id=?").run(failed.id);
    db.prepare('UPDATE embedding_index_state SET pending_id=?').run(failed.id);

    const context = repo.ensureInitialEmbeddingIndex(db, selected);
    assert.equal(context?.indexId, failed.id, 'the existing index with the same recipe receives the vectors');
    const head = db.prepare('SELECT active_id,pending_id,enabled FROM embedding_index_state').get();
    assert.deepEqual(head, { active_id: failed.id, pending_id: null, enabled: 1 });
    const row = repo.indexRow(db, failed.id);
    assert.deepEqual([row.preparation, row.error, row.staging_generation, row.dimensions, row.legacy], ['idle', null, null, 3, 0]);
    assert.equal(JSON.parse(row.profile_json).input.kind, 'plain', 'vectors made before input profiles carry no prefixes');
    assert.deepEqual(db.prepare("SELECT entity_id global_id,hex(embedding) bytes FROM embedding_index_values WHERE index_id=? AND generation=1 ORDER BY entity_id").all(failed.id),
      before.filter(idea => idea.global_id !== 'c'), 'vector bytes are moved, never recomputed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values WHERE index_id=? AND recipe_version=1').get(failed.id).n, 2);
    const contract = JSON.parse(db.prepare('SELECT contract_json FROM embedding_index_values WHERE index_id=? LIMIT 1').get(failed.id).contract_json);
    assert.equal(contract.protocol, 'nodus.embedding.local.v1');
    const legacy = db.prepare('SELECT json_extract(profile_json,\'$.provider\') provider FROM embedding_indexes WHERE legacy=1').all();
    assert.deepEqual(legacy, [{ provider: 'ollama' }], 'the emptied legacy set is removed; another model stays legacy');
    const run = db.prepare('SELECT reason,state,reviewed,reused,computed,provider_inputs FROM embedding_index_runs WHERE index_id=? ORDER BY started_at DESC LIMIT 1').get(failed.id);
    assert.deepEqual(run, { reason: 'activation', state: 'complete', reviewed: 2, reused: 2, computed: 0, provider_inputs: 0 });
    // Through the compatibility view, the ideas carry their vectors again.
    repo.registerEmbeddingIndexFunctions(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_read_ideas WHERE embedding IS NOT NULL').get().n, 2);

    const values = db.prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n;
    assert.equal(repo.ensureInitialEmbeddingIndex(db, selected)?.indexId, failed.id, 'a second settings read changes nothing');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n, values);
  } finally { db.close(); }
});

test('a legacy set from another model, or one the user deleted, is never activated', () => {
  const { db } = migratedVault('other', { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' }, [['a', 'openai', 'text-embedding-3-large', [1, 0, 0]]]);
  try {
    assert.equal(repo.ensureInitialEmbeddingIndex(db, repo.embeddingProfile({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' })), null);
    assert.equal(db.prepare('SELECT active_id FROM embedding_index_state').get().active_id, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_indexes WHERE legacy=1').get().n, 1);
    db.prepare('UPDATE embedding_index_state SET enabled=0').run();
    assert.equal(repo.ensureInitialEmbeddingIndex(db, repo.embeddingProfile({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-large' })), null, 'an explicit deletion is never undone');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_indexes WHERE legacy=1').get().n, 1);
  } finally { db.close(); }
});
