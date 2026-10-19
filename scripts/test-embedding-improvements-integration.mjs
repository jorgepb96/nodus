import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-improvements-integration')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-embedding-improvements-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const database = require('../electron/db/database.ts');
const settings = require('../electron/db/settingsRepo.ts');
const indexes = require('../electron/db/embeddingIndexesRepo.ts');
const runs = require('../electron/db/embeddingRunsRepo.ts');
const ideas = require('../electron/db/ideasRepo.ts');
const ai = require('../electron/ai/aiClient.ts');
const service = require('../electron/ai/embeddingIndexes.ts');
const documentary = require('../electron/ai/documentaryPreparation.ts');
const requests = [];
let intercept;
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
  await intercept?.(body);
  const texts = Array.isArray(body.input) ? body.input : [body.input];
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ object: 'list', model: body.model, data: texts.map((text, index) => ({ object: 'embedding', index, embedding: text.startsWith('consulta B:') ? [0, 1, 0] : [1, 0, 0] })) }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const workerFile = path.join(root, 'vectorScanWorker.cjs');
await build({ entryPoints: [path.join(repoRoot, 'electron/workers/vectorScanWorker.ts')], outfile: workerFile, bundle: true, platform: 'node', format: 'cjs',
  external: ['better-sqlite3'], alias: { '@shared': path.join(repoRoot, 'shared') }, logLevel: 'silent' });
fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
process.env.NODUS_VECTOR_SCAN_WORKER_FILE = workerFile;
const documentaryWorker = path.join(root, 'documentaryRetrievalWorker.cjs');
await build({ entryPoints: [path.join(repoRoot, 'electron/workers/documentaryRetrievalWorker.ts')], outfile: documentaryWorker, bundle: true, platform: 'node', format: 'cjs',
  external: ['better-sqlite3'], alias: { '@shared': path.join(repoRoot, 'shared') }, logLevel: 'silent' });
const processes = require('../electron/workers/backgroundProcess.ts');
const backgroundProcess = processes.backgroundProcess;
processes.backgroundProcess = (filename, ...args) => backgroundProcess(filename.endsWith('/documentaryRetrievalWorker.js') ? documentaryWorker : filename, ...args);
test.after(async () => {
  await service.pauseAllEmbeddingIndexPreparations(); await documentary.closeDocumentaryPreparation();
  await require('../electron/db/vectorScanHost.ts').stopVectorScanWorker();
  database.closeDb(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
});
let a, b, first, second;
test('the real HTTP embedding client uses document/query recipes and preserves activated profiles', async () => {
  settings.updateSettings({ embeddingProvider: 'ollama', embeddingModel: 'multilingual-e5-large',
    localProviders: { ollama: { baseUrl: endpoint }, lmstudio: { baseUrl: 'http://127.0.0.1:1234' } } });
  assert.equal(indexes.activeEmbeddingIndex(database.getDb()).profile.input.kind, 'e5');
  await ai.embedDocument('Una ley de educación'); await ai.embedQuery('¿Qué ley?');
  assert.equal(requests.at(-2).input, 'passage: Una ley de educación');
  assert.equal(requests.at(-1).input, 'query: ¿Qué ley?');
  const db = database.getDb();
  db.prepare('INSERT INTO works(nodus_id,zotero_key,title,item_type,deep_status) VALUES(?,?,?,?,?)').run('book', 'HISTORY1', 'Historia de la República', 'book', 'done');
  first = ideas.createIdea({ type: 'claim', label: 'Educación', statement: 'La reforma educativa de 1931 amplió la enseñanza.' });
  second = ideas.createIdea({ type: 'claim', label: 'Ejército', statement: 'La reforma militar de 1931 reorganizó el ejército.' });
  for (const idea of [first, second]) ideas.upsertOccurrence(idea.global_id, 'book', 'principal', 'Evidencia histórica', 1);
  a = indexes.activeEmbeddingIndex(db);
  const profileB = { ...a.profile, input: { version: 1, kind: 'custom', queryPrefix: 'consulta B: ', documentPrefix: 'documento B: ' } };
  assert.notEqual(indexes.profileFingerprint(profileB), indexes.profileFingerprint(a.profile));
  b = indexes.indexContext(db, indexes.createIndex(db, profileB));
  for (const context of [a, b]) for (const [index, idea] of [first, second].entries()) indexes.storeIndexValue(db, context, {
    family: 'ideas', entityId: idea.global_id, textHash: ideas.embeddingTextHash(ideas.embeddingTextForIdea(idea)), vector: index ? [0, 1, 0] : [1, 0, 0], contract: indexes.contractForProfile(context.profile, 3),
  });
  for (const context of [b, a]) { db.prepare('UPDATE embedding_index_state SET pending_id=?').run(context.indexId); indexes.commitEmbeddingIndex(db, context, 0); }
  a = indexes.indexContext(db, indexes.indexRow(db, a.indexId)); b = indexes.indexContext(db, indexes.indexRow(db, b.indexId));
  await indexes.withEmbeddingIndexContext(b, () => ai.embedQuery('educación'));
  assert.equal(requests.at(-1).input, 'consulta B: educación');
  settings.getSettings();
  assert.equal(indexes.activeEmbeddingIndex(db).indexId, a.indexId);
  const legacyProfile = { ...a.profile }; delete legacyProfile.input;
  const legacy = indexes.indexContext(db, indexes.createIndex(db, legacyProfile));
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(legacy.indexId); indexes.commitEmbeddingIndex(db, legacy, 0);
  const before = requests.length; settings.getSettings();
  assert.equal(requests.length, before, 'settings reads do not generate embeddings');
  assert.equal(indexes.activeEmbeddingIndex(db).profile.input, undefined, 'existing unprefixed profiles are never silently upgraded');
  await ai.embedQuery('consulta anterior'); assert.equal(requests.at(-1).input, 'consulta anterior');
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(a.indexId); indexes.commitEmbeddingIndex(db, a, 0);
});
test('A/B executes production retrieval without activation or document embedding and binds relevance to stable IDs', async () => {
  const comparison = require('../electron/ai/embeddingComparison.ts');
  const db = database.getDb(), active = indexes.embeddingIndexHead(db).active_id;
  const values = db.prepare('SELECT index_id,generation,family,entity_id,hex(embedding) vector FROM embedding_index_values ORDER BY index_id,entity_id').all();
  const before = requests.length;
  const report = await comparison.compareEmbeddingIndexes({ requestId: 'offline-comparison', indexIds: [a.indexId, b.indexId], family: 'ideas', limit: 1,
    questions: [{ question: 'reforma educativa 1931', expected: { ids: [first.global_id], complete: true } }] });
  assert.equal(report.arms[0].questions[0].hits[0].id, first.global_id);
  assert.equal(report.arms[1].questions[0].hits[0].id, second.global_id);
  assert.equal(report.arms[0].questions[0].quality.ndcg, 1);
  assert.equal(report.arms[1].questions[0].quality.ndcg, 0);
  assert.deepEqual(report.arms[0].questions[0].expected, { ids: [first.global_id], complete: true });
  assert.equal(report.arms[0].dimensions, 3); assert.ok(report.arms[0].contract);
  assert.equal(requests.length - before, 2, 'one query vector per arm; no document is re-embedded');
  assert.ok(requests.slice(before).every(body => typeof body.input === 'string'));
  assert.equal(indexes.embeddingIndexHead(db).active_id, active);
  assert.deepEqual(db.prepare('SELECT index_id,generation,family,entity_id,hex(embedding) vector FROM embedding_index_values ORDER BY index_id,entity_id').all(), values);
  assert.ok(report.arms.every(arm => arm.questions[0].embeddingMs >= 0 && arm.questions[0].retrievalMs >= 0));
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled by test'));
  await assert.rejects(() => comparison.compareEmbeddingIndexes({ requestId: 'cancelled-comparison', indexIds: [a.indexId, b.indexId], family: 'ideas', questions: [{ question: 'pregunta' }] }, cancelled.signal), /cancelled/);
  let start, release;
  const started = new Promise(resolve => { start = resolve; });
  intercept = async () => { intercept = null; start(); await new Promise(resolve => { release = resolve; }); };
  const changing = comparison.compareEmbeddingIndexes({ requestId: 'changed-comparison', indexIds: [a.indexId, b.indexId], family: 'ideas', questions: [{ question: 'pregunta nueva' }] });
  const rejected = assert.rejects(changing, /cambiaron|cambió/);
  await started; db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('La fuente cambió durante la consulta.', first.global_id); release(); await rejected;
});
test('persistent run counters separate reuse, confirmed writes, failures and attempts across resume and restart', () => {
  const db = database.getDb();
  const id = runs.beginEmbeddingRun(db, a.indexId, a.generation, 'content_changed');
  runs.recordEmbeddingRunItem(db, id, 'ideas', 'one', 'v1', 'computed');
  runs.recordEmbeddingRunItem(db, id, 'ideas', 'one', 'v1', 'reused');
  runs.recordEmbeddingRunItem(db, id, 'ideas', 'two', 'v1', 'reused');
  runs.recordEmbeddingRunItem(db, id, 'notes', 'private', 'v1', 'excluded', 'source_policy');
  runs.recordEmbeddingRunItem(db, id, 'notes', 'broken', 'v1', 'failed');
  runs.recordEmbeddingProviderInputs(db, id, 2);
  runs.changeEmbeddingRun(db, id, 'paused', 'restart');
  assert.equal(runs.beginEmbeddingRun(db, a.indexId, a.generation, 'resume'), id, 'resume retains counters and confirmed progress');
  runs.recordEmbeddingRunItem(db, id, 'notes', 'broken', 'v1', 'computed');
  runs.recordEmbeddingProviderInputs(db, id, 1); runs.changeEmbeddingRun(db, id, 'complete');
  let result = runs.listEmbeddingRuns(db, a.indexId)[0];
  assert.deepEqual([result.reviewed, result.reused, result.computed, result.excluded, result.failed, result.providerInputs], [4, 1, 2, 1, 0, 3]);
  assert.equal(result.reason, 'content_changed'); assert.equal(result.lastReason, 'resume');
  database.closeDb(); result = runs.listEmbeddingRuns(database.getDb(), a.indexId)[0];
  assert.equal(result.id, id); assert.equal(result.computed, 2);
});

test('documentary retrieval reranks through the real worker, falls back on failure, and deletion aborts a pending reranker', async () => {
  const chunks = require('../electron/ai/documentaryChunking.ts');
  const originalChunker = chunks.documentaryChunks;
  const reranker = require('../electron/ai/localReranker.ts');
  const originalRerank = reranker.rerank, originalAvailable = reranker.rerankerAvailable;
  try {
    chunks.documentaryChunks = async () => [
      { text: 'La reforma educativa de 1931 amplió las escuelas públicas.', pageLabel: '1', pageNumber: 1, sourceRef: 'fixture' },
      { text: 'La reforma educativa de 1931 mejoró la formación del profesorado.', pageLabel: '2', pageNumber: 2, sourceRef: 'fixture' },
    ];
    const inventory = require('../electron/ai/researchCorpusInventory.ts');
    const doc = inventory.researchCorpusInventory().documents.find(item => item.workId === 'book');
    const text = await documentary.prepareDocumentaryText(doc, 'Texto completo de la reforma educativa de 1931.');
    documentary.documentaryStore().publishDocument(doc, [text.indexKey]);
    const scope = require('../electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
    const settings = { preset: 'custom', candidates: 20, passagesPerRound: 2, evidenceTokens: 2000, rounds: 1, autoExpand: false, threshold: { mode: 'automatic' }, reranking: 'off' };
    const baseline = await documentary.retrieveSharedDocumentaryEvidence(scope, 'reforma educativa 1931', settings, null);
    assert.equal(baseline.evidence.length, 2);
    const desired = baseline.evidence[1];
    let calls = 0;
    reranker.rerankerAvailable = () => true;
    reranker.rerank = async (query, texts) => { calls++; assert.equal(query, 'reforma educativa 1931'); return texts.map(text => text === desired.text ? 10 : 0); };
    const local = { ...settings, reranking: 'local' };
    const result = await documentary.retrieveSharedDocumentaryEvidence(scope, 'reforma educativa 1931', local, null);
    assert.equal(result.evidence[0].id, desired.id);
    assert.equal(result.diagnostics.reranking, 'applied'); assert.ok(result.diagnostics.workerRssBytes > 0); assert.equal(calls, 1);
    reranker.rerank = async () => { throw new Error('fixture runtime failure'); };
    const fallback = await documentary.retrieveSharedDocumentaryEvidence(scope, 'reforma educativa 1931', local, null);
    assert.deepEqual(fallback.evidence.map(item => item.id), baseline.evidence.map(item => item.id));
    assert.equal(fallback.diagnostics.reranking, 'failed');
    const embedded = await documentary.prepareDocumentaryEmbeddings(text.indexKey, text.chunks);
    const db = database.getDb();
    assert.ok(db.prepare('SELECT 1 FROM embedding_index_documentary_refs WHERE index_id=?').get(a.indexId));
    let queryStarted, releaseQuery;
    const waitingQuery = new Promise(resolve => { queryStarted = resolve; });
    intercept = async () => { intercept = null; queryStarted(); await new Promise(resolve => { releaseQuery = resolve; }); };
    const changing = require('../electron/ai/embeddingComparison.ts').compareEmbeddingIndexes({ requestId: 'documentary-changing-refs', indexIds: [a.indexId, b.indexId], family: 'documentary', questions: [{ question: 'reforma educativa 1931' }] });
    const inconsistent = assert.rejects(changing, /contenido o los vectores cambiaron/);
    await waitingQuery;
    db.prepare('DELETE FROM embedding_index_documentary_refs WHERE index_id=?').run(a.indexId);
    releaseQuery(); await inconsistent;
    require('../electron/db/embeddingDocumentaryRefs.ts').recordDocumentaryIndexReference(db, documentary.documentaryStore().db,
      require('../electron/vaults/vaultRegistry.ts').getActiveVault().id, a, embedded.indexKey, doc.id);
    let started, cancelled = false;
    const pending = new Promise(resolve => { started = resolve; });
    reranker.rerank = async (_query, _texts, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true }); started();
    });
    const activeBefore = indexes.embeddingIndexHead(database.getDb()).active_id;
    const retrieval = indexes.withEmbeddingIndexContext(b, () => documentary.retrieveSharedDocumentaryEvidence(scope, 'reforma educativa 1931', local, null));
    const rejected = assert.rejects(retrieval, /cancelled/);
    await pending; await service.deleteEmbeddingIndex(b.indexId); await rejected;
    assert.equal(cancelled, true, 'deletion cancels the actual pending local operation');
    assert.equal(indexes.embeddingIndexHead(database.getDb()).active_id, activeBefore, 'deleting the saved comparison arm preserves the active index');
  } finally { chunks.documentaryChunks = originalChunker; reranker.rerank = originalRerank; reranker.rerankerAvailable = originalAvailable; }
});
