import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embeddinggemma-execution')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-eg2-execution-')); installRuntimeHooks(root);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
const database = load('electron/db/database.ts'), registry = load('electron/vaults/vaultRegistry.ts');
const settings = load('electron/db/settingsRepo.ts'), ai = load('electron/ai/aiClient.ts'), local = load('electron/ai/nodusLocalAi.ts');
const profile = 'embeddinggemma-2-text-q8-512-v1', calls = [];
let release;
local.embedWithNodusLocal = async (model, input, signal, options) => {
  calls.push({ model, input, options }); if (release) await release;
  return (Array.isArray(input) ? input : [input]).map(() => { const values = Array(model === 'multilingual-e5-small-int8' ? 384 : model.includes('256') ? 256 : 512).fill(0); values[0] = 1; return values; });
};
const setModel = model => settings.updateSettings({ onboardingComplete: true, embeddingProvider: 'nodus', embeddingModel: model });
try {
  const owner = registry.getActiveVault(); setModel(profile);
  const revision = settings.embeddingSettingsRevision(); setModel(profile);
  assert.equal(settings.embeddingSettingsRevision(), revision, 'no-op settings do not cancel work');
  const full = 'a'.repeat(10000);
  await ai.embedQuery(full); assert.equal(calls.at(-1).input.length, 10000); assert.equal(calls.at(-1).options.role, 'query');
  await ai.embedDocuments(['one', 'two'], undefined, { titles: ['First', 'Second'] });
  assert.deepEqual(calls.at(-1).options.titles, ['First', 'Second']); assert.equal(calls.at(-1).options.role, 'document');
  await assert.rejects(ai.embedDocuments(['one'], undefined, { titles: [] }), /títulos/);
  let finish; release = new Promise(resolve => { finish = resolve; });
  const old = ai.embedQuery('held query'); const refused = assert.rejects(old, /configuración.*cambió/);
  setModel('embeddinggemma-2-text-q8-256-v1'); setModel(profile); finish(); await refused; release = null;
  setModel('multilingual-e5-small-int8'); await ai.embedQuery(full); assert.equal(calls.at(-1).input.length, 8000, 'historical preparation is preserved');
  release = new Promise(resolve => { finish = resolve; });
  const legacy = ai.embedQuery('legacy indexing in flight'); const legacyRefused = assert.rejects(legacy, /configuración.*cambió/);
  await new Promise(resolve => setImmediate(resolve)); setModel(profile); finish(); await legacyRefused; release = null;
  const second = registry.createVault('Other disposable vault', 'academic');
  release = new Promise(resolve => { finish = resolve; });
  const scoped = ai.embedQuery('vault query'); const scopedRefused = assert.rejects(scoped, /bóveda.*cambió/);
  database.closeDb(); registry.setActiveVault(second.id); setModel(profile); finish(); await scopedRefused; release = null;
  database.closeDb(); registry.setActiveVault(owner.id);
  release = new Promise(resolve => { finish = resolve; });
  const pinned = registry.withOwningVault(owner.id, () => database.withVaultDatabase(owner.id, () => ai.embedQuery('pinned owner query')));
  const pinnedRefused = assert.rejects(pinned, /bóveda.*cambió/);
  await new Promise(resolve => setImmediate(resolve)); registry.setActiveVault(second.id); registry.setActiveVault(owner.id); finish(); await pinnedRefused; release = null;
  const previousProcess = { ...ai.effectiveEmbeddingConfig(), session: 'previous-process', revision: 999 };
  assert(await ai.embedDocument('resumed queued document', undefined, { config: previousProcess }), 'persisted configurations do not reuse a previous process settings counter');
  const summaries = load('electron/db/workSummariesRepo.ts');
  database.getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('summary-qa','summary-qa','First title','[]','book','text')").run();
  summaries.upsertWorkSummary({ nodusId: 'summary-qa', summary: 'A factual summary', sourceLevel: 'deep', model: null, contentHash: 'fixture' });
  const vector = Array(512).fill(0); vector[0] = 1;
  summaries.updateWorkSummaryEmbedding('summary-qa', 'A factual summary', vector, 'First title');
  assert.equal(summaries.summaryNeedsEmbedding(summaries.allWorkSummaryRows()[0], 'A factual summary'), false);
  database.getDb().prepare("UPDATE works SET title='Edited title' WHERE nodus_id='summary-qa'").run();
  assert.equal(summaries.summaryNeedsEmbedding(summaries.allWorkSummaryRows()[0], 'A factual summary'), true, 'a changed document title invalidates new-family summary embeddings');
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts'), { LibraryCatalog } = load('electron/library/libraryCatalog.ts');
  const { LibraryExtractionQueue } = load('electron/library/libraryExtractionQueue.ts');
  const store = new LibraryDiskStore(path.join(root, 'library'), 'queue-qa'); store.initialize();
  const catalog = new LibraryCatalog(path.join(root, 'catalog.sqlite'));
  const item = store.upsertItem({ id: 'nodus:queue-context', storageId: 'queue-context', source: 'nodus', metadata: { title: 'Queue context', itemType: 'report', creators: [] }, collectionIds: [], attachments: [] });
  catalog.indexItem(item, store); let progress = 0;
  const queue = await database.withVaultDatabase(owner.id, async () => {
    const queue = new LibraryExtractionQueue({ store, catalog, onProgress: () => { settings.getSettings(); progress++; },
      extract: async input => ({ item: input.item, quality: { status: 'passed', warnings: [], words: 10, figures: 0, tables: 0 } }) });
    queue.enqueue([item.id]); return queue;
  });
  try { await queue.waitForIdle(5000); assert.equal(queue.list()[0].status, 'done'); assert(progress >= 2, 'global extraction notifications survive closing the initiating vault connection'); }
  finally { queue.dispose(); catalog.close(); }
  console.log('Real embedding API rejects stale model/vault results, preserves legacy preparation and invalidates changed summary titles.');
} finally { load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
