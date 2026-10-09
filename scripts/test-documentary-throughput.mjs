import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-throughput')) process.exit(0);

// Document indexing used to run one document, one page check and one embedding request
// at a time: every progress page re-read the whole corpus inventory on the main thread,
// figures were rendered and thrown away, and the provider gate kept remote embeddings
// serial. These are the guarantees that replaced it.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-throughput-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const database = load('electron/db/database.ts');
const preparation = load('electron/ai/documentaryPreparation.ts');
const until = async (condition, label) => {
  for (let i = 0; i < 2000 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), label);
};
try {
  const db = database.getDb();
  for (const key of ['THRU0001', 'THRU0002', 'THRU0003'])
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES(?,?,?,'[]','book','text')").run(key.toLowerCase(), key, `Source ${key}`);
  const inventoryModule = load('electron/ai/researchCorpusInventory.ts');
  const documents = inventoryModule.researchCorpusInventory().documents.filter(document => document.workId);
  assert.equal(documents.length, 3);

  // 1. Two documents are extracted at once, text-only, with bounded source checks.
  preparation.setResearchPreparationPaused(true);
  await preparation.prepareResearchDocuments(documents.map(document => document.id), 'text');
  load('electron/zotero/zoteroClient.ts').getItem = async () => ({ abstract: '' });
  load('electron/ai/documentaryChunking.ts').documentaryChunks = async text => [{ text, pageLabel: null, pageNumber: null, sourceRef: null }];
  const extraction = load('electron/ai/documentaryExtraction.ts');
  const pages = 400;
  const options = [];
  let extracting = 0, maxExtracting = 0;
  extraction.extractTraditionalResearchWork = async (_user, key, _type, _signal, extractionOptions, onProgress) => {
    options.push(extractionOptions);
    maxExtracting = Math.max(maxExtracting, ++extracting);
    try {
      for (let page = 1; page <= pages; page++) {
        onProgress({ phase: 'extract', progress: page / pages, page, totalPages: pages });
        if (page % 50 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    } finally { extracting--; }
    return { text: `Evidence ${key}`, sourceMap: {}, parts: [] };
  };
  const inventory = inventoryModule.researchCorpusInventory;
  let inventoryCalls = 0;
  inventoryModule.researchCorpusInventory = () => { inventoryCalls++; return inventory(); };
  let notices = 0;
  load('electron/ai/documentaryPreparationEvents.ts').onDocumentaryPreparationChanged(() => { notices++; });
  const store = preparation.documentaryStore();
  const complete = () => store.db.prepare("SELECT COUNT(*) n FROM documentary_requests WHERE state='complete'").get().n;
  preparation.setResearchPreparationPaused(false);
  await until(() => complete() === 3, 'every queued source is prepared');
  assert.equal(maxExtracting, 2, 'the next document is extracted while another is still in progress');
  assert.ok(options.length === 3 && options.every(value => value.extractImages === false && value.ocrMode === 'off'), 'indexing never renders figures or table crops');
  assert.ok(inventoryCalls < 60, `${pages * 3} progress pages re-read the corpus inventory ${inventoryCalls} times`);
  assert.ok(notices < 80, `${pages * 3} progress pages sent ${notices} snapshots to the windows`);
  inventoryModule.researchCorpusInventory = inventory;

  // 2. Embedding batches for one document overlap, bounded to four.
  const manyChunks = Array.from({ length: 300 }, (_, i) => ({ text: `Passage ${i}`, pageLabel: String(i + 1), pageNumber: i + 1, sourceRef: 'fixture' }));
  load('electron/ai/documentaryChunking.ts').documentaryChunks = async () => manyChunks;
  const text = await preparation.prepareDocumentaryText({ ...documents[0], id: 'overlap-fixture' }, 'Overlap source');
  const ai = load('electron/ai/aiClient.ts');
  let inFlight = 0, maxInFlight = 0, requests = 0;
  ai.embedMany = async texts => {
    requests++;
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    inFlight--;
    return texts.map(value => [Number(value.split(' ').at(-1)) + 1, 1, 0]);
  };
  const config = { provider: 'openrouter', modelId: 'baai/bge-m3', endpoint: 'http://127.0.0.1:9999/v1' };
  const embedded = await preparation.prepareDocumentaryEmbeddings(text.indexKey, manyChunks, undefined, config);
  assert.equal(requests, 10, 'batches stay bounded to 32 passages');
  assert.equal(maxInFlight, 4, 'up to four batches of one document are in flight');
  assert.deepEqual(embedded.vectors.map(vector => vector[0]), manyChunks.map((_, i) => i + 1), 'vectors keep passage order whatever order batches return in');

  // 3. Two requests for the same source never run together.
  const { DocumentaryRequests } = load('electron/db/documentaryRequests.ts');
  const queue = new DocumentaryRequests(store.db);
  queue.enqueue('lane:a', 'r1', 'lanes');
  queue.enqueue('lane:b', 'r1', 'lanes');
  store.db.prepare("UPDATE documentary_requests SET source_id='shared-source' WHERE document_id='lane:a'").run();
  store.db.prepare("UPDATE documentary_requests SET source_id='other-source', created_at=created_at+1 WHERE document_id='lane:b'").run();
  assert.equal(queue.claim('lanes', Date.now(), 60000, true, ['shared-source']).document_id, 'lane:b');
  assert.equal(queue.claim('lanes', Date.now(), 60000, true, ['other-source']).document_id, 'lane:a');

  // 4. The provider gate lets remote embedding requests overlap from the start.
  load('electron/secrets/secretStore.ts').getApiKey = provider => provider === 'openrouter' ? 'synthetic-test-only' : null;
  let gateInFlight = 0, gateMax = 0;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      gateMax = Math.max(gateMax, ++gateInFlight);
      setTimeout(() => {
        gateInFlight--;
        const payload = JSON.parse(body);
        const vector = index => payload.encoding_format === 'base64'
          ? Buffer.from(new Float32Array([index + 1, 1, 0]).buffer).toString('base64') : [index + 1, 1, 0];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', model: 'baai/bge-m3', data: [payload.input].flat().map((_, index) => ({ object: 'embedding', index, embedding: vector(index) })) }));
      }, 40);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = { ...config, endpoint: `http://127.0.0.1:${server.address().port}/v1` };
  // An explicit job must describe the currently selected execution contract.
  load('electron/db/settingsRepo.ts').updateSettings({ embeddingProvider: remote.provider, embeddingModel: remote.modelId });
  load('electron/ai/providers.ts').openAiCompatBase = provider => provider === remote.provider ? remote.endpoint : null;
  try {
    await Promise.all([0, 1, 2].map(i => ai.embedManyStrict([`Gate ${i}`], undefined, { config: remote })));
  } finally { server.close(); }
  assert.equal(gateMax, 2, 'remote embeddings start with two requests in flight');
  console.log('Documentary preparation overlaps documents and embedding batches, extracts text only and bounds its per-page work.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  database.closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
