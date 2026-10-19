import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-index-performance')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-performance-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const database = require('../electron/db/database.ts');
const settings = require('../electron/db/settingsRepo.ts');
const indexes = require('../electron/db/embeddingIndexesRepo.ts');
const service = require('../electron/ai/embeddingIndexes.ts');
const documentary = require('../electron/ai/documentaryPreparation.ts');
test.after(async () => { await documentary.closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
test('20,000 entities and two saved indexes activate by changing pointers without scanning or copying vectors', async () => {
  const config = settings.getSettings();
  const db = database.getDb();
  const count = 20_000;
  const dimension = 64;
  const insert = db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES(?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < count; i++) insert.run(`idea-${i}`, 'claim', `Claim ${i}`, `Evidence ${i}`, '2026-10-19'); })();
  const contexts = ['a', 'b'].map(model => indexes.indexContext(db, indexes.createIndex(db, indexes.embeddingProfile(config, { provider: 'openai', model }))));
  for (const context of contexts) {
    for (let start = 0; start < count; start += 1000) {
      const values = Array.from({ length: Math.min(count - start, 1000) }, (_, i) => ({ family: 'ideas', entityId: `idea-${start + i}`, textHash: `text-${start + i}`, vector: [1, ...Array(dimension - 1).fill(0)], contract: indexes.contractForProfile(context.profile, dimension) }));
      indexes.storeIndexValues(db, context, values);
    }
    db.prepare('UPDATE embedding_index_state SET pending_id=?').run(context.indexId);
    indexes.commitEmbeddingIndex(db, context, 0);
  }
  const revision = db.prepare('SELECT index_id,generation,value_revision FROM embedding_index_generations ORDER BY index_id').all();
  const prepare = db.prepare;
  let vectorReads = 0;
  db.prepare = function(sql) { if (/\bSELECT\b/i.test(sql) && /\b(?:ideas|embedding_index_values)\b/.test(sql)) vectorReads++; return prepare.call(this, sql); };
  const start = performance.now();
  try { for (let i = 0; i < 20; i++) await service.activateEmbeddingIndex(contexts[i % 2].indexId); }
  finally { db.prepare = prepare; }
  const elapsed = performance.now() - start;
  assert.equal(vectorReads, 0, 'a verified activation never walks the corpus');
  assert.deepEqual(db.prepare('SELECT index_id,generation,value_revision FROM embedding_index_generations ORDER BY index_id').all(), revision, 'activation never copies or changes vector bytes');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n, count * 2);
  console.log(`20 activations over ${count.toLocaleString('en')} entities / ${(count * 2 * dimension * 4 / 1024 / 1024).toFixed(1)} MiB: ${elapsed.toFixed(0)} ms, zero corpus reads`);
});
