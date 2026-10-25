import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-index-listing')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-listing-'));
const sent = [];
const window = { isDestroyed: () => false, webContents: { send: channel => sent.push(channel) } };
installRuntimeHooks(root, { BrowserWindow: class { static getAllWindows() { return [window]; } } });
const require = createRequire(import.meta.url);
const database = require('../electron/db/database.ts');
const settings = require('../electron/db/settingsRepo.ts');
const repo = require('../electron/db/embeddingIndexesRepo.ts');
const ai = require('../electron/ai/aiClient.ts');
const requests = [];
ai.embedManyStrict = async (texts, signal) => { signal.throwIfAborted(); requests.push(texts.length); return texts.map(() => [1, 0, 0]); };
const service = require('../electron/ai/embeddingIndexes.ts');
const inventory = require('../electron/ai/embeddingIndexInventory.ts');
const documentary = require('../electron/ai/documentaryPreparation.ts');
const COUNT = 2_500;
const waitFor = async predicate => {
  const deadline = Date.now() + 20_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Index preparation timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
const ready = id => waitFor(() => { const row = repo.indexRow(database.getDb(), id); assert.notEqual(row.preparation, 'error', row.error); return row.preparation === 'idle' && repo.embeddingIndexHead(database.getDb()).active_id === id; });
function countIdeaReads(db) {
  const prepare = db.prepare;
  const counter = { reads: 0, restore: () => { db.prepare = prepare; } };
  db.prepare = function(sql) { if (/\bSELECT\b/i.test(sql) && /\bFROM\s+"?ideas"?\b/i.test(sql)) counter.reads++; return prepare.call(this, sql); };
  return counter;
}
test.after(async () => { await service.pauseAllEmbeddingIndexPreparations(); await documentary.closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true }); });

test('a preparation reports batches as progress without asking every window to list the indexes again', async () => {
  settings.updateSettings({ embeddingProvider: 'openai', embeddingModel: 'model-a' });
  const db = database.getDb();
  const insert = db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES(?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < COUNT; i++) insert.run(`idea-${i}`, 'claim', `Claim ${i}`, `Evidence ${i}`, '2026-10-19'); })();
  sent.length = 0;
  const id = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-a' }); await ready(id);
  const batches = Math.ceil(COUNT / 32);
  assert.equal(requests.reduce((n, size) => n + size, 0), COUNT);
  assert.ok(sent.filter(channel => channel === 'embeddingIndexes:progress').length >= batches, 'each batch still reports its progress');
  assert.ok(sent.filter(channel => channel === 'embeddingIndexes:changed').length <= 2, `only start and completion trigger a listing, got ${sent.filter(channel => channel === 'embeddingIndexes:changed').length}`);
});

test('listing hashes the corpus in pages, yields between them and reuses the result until the corpus changes', async () => {
  const db = database.getDb();
  const profile = repo.embeddingProfile(settings.getSettings());
  const comparable = inputs => inputs.map(input => [input.family, input.entityId, input.textHash, input.excluded ?? null].join('|')).sort();
  assert.deepEqual(comparable(await inventory.collectEmbeddingIndexInputsAsync(profile, { lean: true })), comparable(inventory.collectEmbeddingIndexInputs(profile)),
    'the paged hash-only inventory matches the preparation inventory');

  db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('Edited after indexing', 'idea-0');
  const order = [];
  const listing = service.listEmbeddingIndexes().then(result => { order.push('listing'); return result; });
  setImmediate(() => order.push('event loop'));
  const [summary] = await listing;
  assert.equal(order[0], 'event loop', 'other main-process work runs while the listing reads the corpus');
  assert.equal(summary.pending, 1, 'only the edited idea is pending');
  assert.deepEqual(summary.coverage.find(family => family.family === 'ideas'), { family: 'ideas', total: COUNT, indexed: COUNT - 1, excluded: 0 });

  const reads = countIdeaReads(db);
  try {
    const again = await service.listEmbeddingIndexes();
    assert.equal(again[0].pending, 1);
    const preview = await service.previewEmbeddingIndex({ provider: 'openai', model: 'model-a' });
    assert.equal(preview.pending, 1);
    assert.equal(reads.reads, 0, 'an unchanged corpus is not hashed again');
    db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('Edited twice', 'idea-1');
    assert.equal((await service.listEmbeddingIndexes())[0].pending, 2);
    assert.ok(reads.reads > 0, 'a corpus change invalidates the cached inventory');
  } finally { reads.restore(); }
});

test('the vault adopts a legacy set of its selected model on the next settings read, without provider calls', async () => {
  const db = database.getDb();
  const active = repo.embeddingIndexHead(db).active_id;
  await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-a', indexId: active }); await ready(active);
  // Rebuild the post-migration state: model-b vectors only in a legacy set, nothing active.
  const legacy = 'legacy-model-b';
  db.prepare('INSERT INTO embedding_indexes(id,fingerprint,profile_json,legacy,dimensions,updated_at) VALUES(?,?,?,?,?,?)')
    .run(legacy, 'legacy-fingerprint', JSON.stringify({ provider: 'openai', model: 'model-b', endpoint: 'legacy:unknown', modelRevision: null, recipeVersion: 0 }), 1, 3, new Date().toISOString());
  db.prepare(`INSERT INTO embedding_index_values(index_id,generation,family,entity_id,text_hash,contract_json,embedding,created_at)
    SELECT ?,1,family,entity_id,text_hash,'{"protocol":"legacy_locked"}',embedding,created_at FROM embedding_index_values WHERE index_id=?`).run(legacy, active);
  db.prepare('UPDATE embedding_index_state SET active_id=NULL').run();
  const before = requests.length;
  settings.updateSettings({ embeddingModel: 'model-b' });

  const head = repo.embeddingIndexHead(db);
  assert.notEqual(head.active_id, null);
  assert.equal(settings.getSettings().embeddingModel, 'model-b');
  const listed = await service.listEmbeddingIndexes();
  const adopted = listed.find(index => index.active);
  assert.equal(adopted.profile.model, 'model-b');
  assert.equal(adopted.legacy, false);
  assert.equal(adopted.vectors, COUNT);
  assert.equal(adopted.pending, 0, 'unchanged texts need no recomputation');
  assert.equal(listed.some(index => index.legacy), false, 'no legacy card is left asking for a rebuild');
  assert.equal(adopted.run.reason, 'activation');
  const preview = await service.previewEmbeddingIndex({ provider: 'openai', model: 'model-b' });
  assert.deepEqual([preview.existingIndexId, preview.pending, preview.reusable], [adopted.id, 0, COUNT]);
  await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-b' }); await ready(adopted.id);
  assert.equal(requests.length, before, 'adopting and verifying the legacy vectors sends nothing to the provider');
});
