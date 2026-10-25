import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-index-migration')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-migration-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { migrations, runMigrations, SCHEMA_VERSION } = require('../electron/db/migrations.ts');
const { migrateDatabaseSafely, listMigrationRecoverySnapshots } = require('../electron/db/migrationSafety.ts');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('the protected additive migration preserves every actual model group and is idempotent', () => {
  const file = path.join(root, 'old.sqlite');
  let db = new Database(file);
  db.pragma('foreign_keys = ON');
  for (const migration of migrations.filter(migration => migration.version < 203)) db.transaction(() => { db.exec(migration.up); migration.after?.(db); db.pragma(`user_version=${migration.version}`); })();
  db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ embeddingProvider: 'openai', embeddingModel: 'selected-but-empty' }));
  const insert = db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at,embedding,embedding_provider,embedding_model,embedding_dim,embedding_text_hash) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const [id, provider, model, vector] of [['a', 'openai', 'model-a', [1, 0, 0]], ['b', 'ollama', 'model-b', [0, 1]], ['c', 'openai', 'model-a', [0, 0, 1]]]) {
    insert.run(id, 'claim', id, 'Evidence', new Date().toISOString(), Buffer.from(new Float32Array(vector).buffer), provider, model, vector.length, 'old-hash');
  }
  const before = db.prepare('SELECT global_id,hex(embedding) bytes FROM ideas ORDER BY global_id').all();
  db = migrateDatabaseSafely(db, file, SCHEMA_VERSION, runMigrations);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_indexes').get().n, 2);
    assert.equal(db.prepare('SELECT SUM(legacy) n FROM embedding_indexes').get().n, 2, 'unknown historical semantics remain explicitly unverified');
    assert.deepEqual(db.prepare("SELECT entity_id global_id,hex(embedding) bytes FROM embedding_index_values WHERE family='ideas' ORDER BY entity_id").all(), before);
    assert.equal(db.prepare('SELECT active_id FROM embedding_index_state').get().active_id, null, 'a majority must never override the selected empty profile');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ideas WHERE embedding IS NOT NULL').get().n, 0);
    const inventory = db.prepare('SELECT id,dimensions FROM embedding_indexes ORDER BY id').all();
    runMigrations(db);
    assert.deepEqual(db.prepare('SELECT id,dimensions FROM embedding_indexes ORDER BY id').all(), inventory);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n, 3);
    assert.ok(listMigrationRecoverySnapshots(file).some(snapshot => snapshot.fromVersion === 202), 'a recovery copy precedes vector normalization');
  } finally { db.close(); }
});
