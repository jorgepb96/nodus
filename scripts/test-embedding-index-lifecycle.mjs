import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-index-lifecycle')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-lifecycle-'));
const ipcHandlers = new Map();
const browserSession = {};
installRuntimeHooks(root, {
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  session: { fromPartition: () => browserSession },
});
const require = createRequire(import.meta.url);
const database = require('../electron/db/database.ts');
const registry = require('../electron/vaults/vaultRegistry.ts');
const settings = require('../electron/db/settingsRepo.ts');
const ideas = require('../electron/db/ideasRepo.ts');
const repo = require('../electron/db/embeddingIndexesRepo.ts');
const ai = require('../electron/ai/aiClient.ts');
const requests = [];
let gate;
ai.embedManyStrict = async (texts, signal, options) => {
  requests.push({ model: options.config.modelId, texts: [...texts] });
  if (gate?.matches(options.config.modelId, texts)) {
    const current = gate; gate = null; current.started();
    await new Promise((resolve, reject) => {
      current.release = resolve;
      const abort = () => reject(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  signal.throwIfAborted();
  return texts.map(() => options.config.modelId === 'model-a' ? [1, 0, 0] : [0, 1, 0]);
};
const service = require('../electron/ai/embeddingIndexes.ts');
const runs = require('../electron/db/embeddingRunsRepo.ts');
const documentary = require('../electron/ai/documentaryPreparation.ts');
const waitFor = async predicate => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Index lifecycle timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
const ready = id => waitFor(() => { const row = repo.indexRow(database.getDb(), id); assert.notEqual(row.preparation, 'error', row.error); return row.preparation === 'idle' && repo.embeddingIndexHead(database.getDb()).active_id === id; });
function block(model, occurrence = 1) {
  let started;
  const blocked = new Promise(resolve => { started = resolve; });
  const value = { started, matches: candidate => candidate === model && --occurrence === 0, release: () => {} };
  gate = value; return { blocked, release: () => value.release() };
}
test.after(async () => { await service.pauseAllEmbeddingIndexPreparations(); await documentary.closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true }); });

test('A → B → A reuses vectors; edits, additions and deletions during a batch publish only current content', async () => {
  settings.updateSettings({ embeddingProvider: 'openai', embeddingModel: 'model-a' });
  const originals = Array.from({ length: 40 }, (_, index) => ideas.createIdea({ type: 'claim', label: `Idea ${index}`, statement: `Original evidence ${index}` }));
  const a = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-a' }); await ready(a);
  const b = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-b' }); await ready(b);
  const auditA = runs.listEmbeddingRuns(database.getDb(), a)[0];
  assert.equal(auditA.computed, 40); assert.equal(auditA.providerInputs, 40); assert.equal(auditA.failed, 0);
  const before = requests.length;
  const dbForActivation = database.getDb();
  const prepare = dbForActivation.prepare;
  let corpusReads = 0;
  dbForActivation.prepare = function(sql) { if (/\bSELECT\b/i.test(sql) && /\b(?:ideas|notes|study_materials|embedding_index_values)\b/.test(sql)) corpusReads++; return prepare.call(this, sql); };
  try { await service.activateEmbeddingIndex(a); } finally { dbForActivation.prepare = prepare; }
  await ready(a);
  assert.equal(corpusReads, 0, 'activating a verified index does not scan or copy the corpus');
  assert.equal(requests.length, before, 'reactivation makes no provider calls');
  assert.equal(runs.listEmbeddingRuns(database.getDb(), a)[0].reason, 'activation');
  assert.equal(runs.listEmbeddingRuns(database.getDb(), a)[0].providerInputs, 0);
  assert.deepEqual(ideas.getIdea(originals[0].global_id).embedding, [1, 0, 0]);
  assert.equal(repo.indexRow(database.getDb(), b).preparation, 'idle');

  const pending = block('model-c');
  const c = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-c' }); await pending.blocked;
  assert.equal(repo.embeddingIndexHead(database.getDb()).active_id, a, 'the previous index remains active');
  const db = database.getDb();
  db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('Edited while preparing', originals[0].global_id);
  db.prepare('DELETE FROM ideas WHERE global_id=?').run(originals[1].global_id);
  const extra = ideas.createIdea({ type: 'claim', label: 'Added during preparation', statement: 'New content' });
  pending.release(); await ready(c);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values WHERE index_id=? AND generation=1').get(c).n, 40);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM embedding_index_values WHERE entity_id=?').get(originals[1].global_id).n, 0);
  const changed = ideas.embeddingTextHash(ideas.embeddingTextForIdea({ type: 'claim', label: 'Idea 0', statement: 'Edited while preparing' }));
  assert.equal(db.prepare("SELECT text_hash FROM embedding_index_values WHERE index_id=? AND family='ideas' AND entity_id=?").get(c, originals[0].global_id).text_hash, changed);
  const aCalls = requests.filter(request => request.model === 'model-a').reduce((n, request) => n + request.texts.length, 0);
  await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-a', indexId: a }); await ready(a);
  assert.equal(requests.filter(request => request.model === 'model-a').reduce((n, request) => n + request.texts.length, 0) - aCalls, 2, 'only the edited and new idea need embeddings');
  const changedRun = runs.listEmbeddingRuns(db, a)[0];
  assert.equal(changedRun.computed, 2); assert.equal(changedRun.reused, 38); assert.equal(changedRun.providerInputs, 2);
  assert.ok(ideas.getIdea(extra.global_id).embedding);
});

test('pause, resume, restart and delete retain confirmed progress without replacing the active generation', async () => {
  const active = repo.embeddingIndexHead(database.getDb()).active_id;
  const pending = block('model-d', 2);
  const d = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-d' }); await pending.blocked;
  await service.controlEmbeddingIndex(d, 'pause');
  assert.equal(repo.indexRow(database.getDb(), d).preparation, 'paused');
  assert.equal(database.getDb().prepare('SELECT COUNT(*) n FROM embedding_index_values WHERE index_id=?').get(d).n, 32);
  const pausedRun = runs.listEmbeddingRuns(database.getDb(), d)[0];
  assert.equal(pausedRun.state, 'paused'); assert.equal(pausedRun.computed, 32);
  assert.equal(repo.embeddingIndexHead(database.getDb()).active_id, active);
  const before = requests.length;
  await service.controlEmbeddingIndex(d, 'resume'); await ready(d);
  assert.equal(requests.slice(before).reduce((n, request) => n + request.texts.length, 0), 8);
  const resumedRun = runs.listEmbeddingRuns(database.getDb(), d)[0];
  assert.equal(resumedRun.id, pausedRun.id); assert.equal(resumedRun.computed, 40); assert.equal(resumedRun.reused, 0);
  assert.equal(resumedRun.providerInputs, 48, 'attempted cancelled inputs remain distinct from confirmed vectors');
  const rebuild = block('model-d');
  await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-d', indexId: d, rebuild: true }); await rebuild.blocked;
  assert.equal(repo.indexRow(database.getDb(), d).generation, 1);
  assert.ok(ideas.getIdea(database.getDb().prepare('SELECT global_id FROM ideas LIMIT 1').get().global_id).embedding);
  await service.controlEmbeddingIndex(d, 'cancel');
  assert.equal(repo.indexRow(database.getDb(), d).generation, 1);
  const operations = require('../electron/ai/embeddingOperations.ts');
  const query = operations.beginEmbeddingOperation({ scope: database.getDb().name, indexId: d });
  const otherQuery = operations.beginEmbeddingOperation({ scope: database.getDb().name, indexId: active });
  await service.deleteEmbeddingIndex(d);
  assert.equal(query.signal.aborted, true, 'deletion aborts pending provider operations');
  assert.equal(otherQuery.signal.aborted, false, 'another saved index keeps its captured operations');
  query.release(); otherQuery.release();
  settings.getSettings();
  assert.equal(repo.activeEmbeddingIndex(database.getDb()), null);
  assert.equal(repo.embeddingIndexHead(database.getDb()).enabled, 0, 'deletion never silently regenerates a semantic index');

  const resumed = block('model-e');
  const e = await service.prepareEmbeddingIndex({ provider: 'openai', model: 'model-e' }); await resumed.blocked;
  const oldVault = registry.getActiveVault();
  const other = registry.createVault('Other vault');
  database.closeDb(); registry.setActiveVault(other.id); settings.getSettings();
  await service.pauseAllEmbeddingIndexPreparations();
  assert.equal(database.getDb().prepare('SELECT COUNT(*) n FROM embedding_index_values').get().n, 0, 'a late response cannot enter another vault');
  database.closeDb(); registry.setActiveVault(oldVault.id);
  assert.equal(repo.indexRow(database.getDb(), e).preparation, 'paused');
  await service.controlEmbeddingIndex(e, 'resume'); await ready(e);
});

test('an IPC query keeps its index across activation and cannot drift into a different vault after an await', async () => {
  const { createIpcContext } = require('../electron/ipc/context.ts');
  const { h } = createIpcContext(() => null);
  const id = database.getDb().prepare('SELECT global_id FROM ideas LIMIT 1').get().global_id;
  const originalVector = ideas.getIdea(id).embedding;
  let release;
  h('embeddings:contextProbe', async () => {
    await new Promise(resolve => { release = resolve; });
    return ideas.getIdea(id)?.embedding;
  });
  const invoke = ipcHandlers.get('embeddings:contextProbe');
  const event = { sender: { session: {} } };
  const oldQuery = invoke(event);
  const saved = database.getDb().prepare("SELECT id,profile_json FROM embedding_indexes WHERE json_extract(profile_json,'$.model')='model-a' AND legacy=0 LIMIT 1").get();
  await service.prepareEmbeddingIndex({ ...JSON.parse(saved.profile_json), indexId: saved.id }); await ready(saved.id);
  release();
  assert.deepEqual(await oldQuery, originalVector, 'activation cannot change an in-flight query\'s vector space');
  assert.notDeepEqual(ideas.getIdea(id).embedding, originalVector, 'a new query uses the newly active index');
  h('data:import', async () => {
    database.closeDb();
    return database.getDb().prepare('SELECT 1 AS reopened').get();
  });
  assert.deepEqual(await ipcHandlers.get('data:import')(event), { reopened: 1 }, 'whole-vault restoration can intentionally reopen its connection');

  const oldVault = registry.getActiveVault();
  const other = registry.createVault('IPC isolation');
  const switchedQuery = invoke(event);
  const rejected = assert.rejects(switchedQuery, /not open|closed/i);
  database.closeDb(); registry.setActiveVault(other.id); settings.getSettings();
  release();
  try {
    await rejected;
    assert.equal(database.getDb().prepare('SELECT COUNT(*) n FROM ideas').get().n, 0);
  } finally { database.closeDb(); registry.setActiveVault(oldVault.id); }
});
