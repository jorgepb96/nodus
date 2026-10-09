import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './research-app-harness.mjs';
import { checkNativeEmbeddingFailures } from './embedding-native-failures.mjs';

/** Reversible lifecycle changes inside one already marked, disposable campaign. */
export async function checkEmbeddingProductLifecycle(harness, report, save) {
  const { app, page } = harness, notebook = report.notebooks.dynamic, model = report.profile;
  const ready = async ids => {
    assert(await waitFor(async () => {
      const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
      return ids.every(id => inventory.documents.find(document => document.id === id)?.preparation.embeddings === 'ready');
    }, { timeoutMs: 300000, intervalMs: 250 }), 'required vectors finish before semantic assertions');
  };
  const before = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  const beforeKeys = Object.fromEntries(before.documents.map(document => [document.id, document.preparation]));
  const current = await page.evaluate(id => window.nodus.resolveResearchNotebook(id), notebook.id);
  const fixedBefore = await page.evaluate(id => window.nodus.resolveResearchNotebook(id), report.notebooks.fixed.id);
  const collections = await page.evaluate(() => window.nodus.listGlobalLibraryCollections());
  const collectionId = notebook.sources.find(source => source.kind === 'library-collection').id;
  assert(collections.some(collection => collection.id === collectionId));
  const item = await page.evaluate(async collectionId => {
    const item = await window.nodus.createGlobalLibraryItem({ title: 'Orbe research station', itemType: 'report', creators: [], abstract: 'The Orbe observatory stores its calibration log for 37 days. Its ultraviolet detector measures fluorescence, not salinity.' }, [collectionId]);
    return item;
  }, collectionId);
  const changed = await page.evaluate(id => window.nodus.resolveResearchNotebook(id), notebook.id);
  assert(changed.documents.some(document => document.id === item.id));
  assert(!(await page.evaluate(id => window.nodus.resolveResearchNotebook(id), report.notebooks.fixed.id)).documents.some(document => document.id === item.id));
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id); await ready([item.id]);
  const added = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'How long is the calibration log retained at Orbe?'), notebook.id);
  assert(added.evidence.some(evidence => evidence.documentId === item.id && evidence.text.includes('37')));
  const after = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  for (const id of current.documents.map(document => document.id)) {
    const state = after.documents.find(document => document.id === id)?.preparation;
    assert.equal(state?.passages, beforeKeys[id]?.passages, 'adding a source leaves existing passage counts intact');
  }
  report.checks.incrementalSource = { documentId: item.id, existingDocuments: current.documents.length, fixedNotebookUnchanged: fixedBefore.documents.length, evidence: added.evidence }; save();
  await page.evaluate(async id => { await window.nodus.updateGlobalLibraryItemMetadata(id, { title: 'Orbe revised station', abstract: 'The Orbe observatory stores its calibration log for 43 days. The old 37-day interval is superseded.' }); await window.nodus.prepareResearchDocuments([id]); }, item.id);
  await ready([item.id]);
  const edited = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'What is the current Orbe retention interval?'), notebook.id);
  assert(edited.evidence.some(evidence => evidence.documentId === item.id && evidence.text.includes('43')));
  report.checks.titleTextInvalidation = { evidence: edited.evidence }; save();
  const receipt = `documentary:${edited.scopeId}:${edited.evidence.find(evidence => evidence.documentId === item.id).id}`;
  assert(await page.evaluate(id => window.nodus.getPassage(id), receipt));
  await page.evaluate(id => window.nodus.setGlobalLibraryItemsDeleted([id], true), item.id);
  assert.equal(await page.evaluate(id => window.nodus.getPassage(id), receipt), null);
  assert(!(await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Orbe calibration retention'), notebook.id)).evidence.some(evidence => evidence.documentId === item.id));
  await page.evaluate(id => window.nodus.setGlobalLibraryItemsDeleted([id], false), item.id); await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id); await ready([item.id]);
  assert((await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Orbe calibration retention'), notebook.id)).evidence.some(evidence => evidence.documentId === item.id));
  report.checks.deleteRestore = true; save();
  const original = path.join(harness.root, 'fixtures/orbe-original.txt'), replacement = path.join(harness.root, 'fixtures/orbe-replacement.txt');
  fs.writeFileSync(original, 'The Orbe calibration file now prescribes retention for 73 days. This file supersedes the metadata-only interval.');
  fs.writeFileSync(replacement, 'The revised Orbe calibration file prescribes retention for 89 days. It supersedes the former 73-day rule.');
  const pick = file => app.evaluate(({ dialog }, file) => { globalThis.qaLifecyclePicker ??= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  try {
    await pick(original);
    const attached = await page.evaluate(async id => { await window.nodus.updateGlobalLibraryItemMetadata(id, { abstract: '' }); return window.nodus.addGlobalLibraryAttachments(id); }, item.id);
    await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id); await ready([item.id]);
    assert((await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Orbe current calibration file retention'), notebook.id)).evidence.some(evidence => evidence.documentId === item.id && evidence.text.includes('73')));
    const previous = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Orbe calibration file retention'), notebook.id);
    const previousReceipt = `documentary:${previous.scopeId}:${previous.evidence.find(evidence => evidence.documentId === item.id).id}`;
    await pick(replacement); await page.evaluate(({ itemId, attachmentId }) => window.nodus.replaceGlobalLibraryAttachment(itemId, attachmentId), { itemId: item.id, attachmentId: attached.attachments[0].id });
    await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), item.id); await ready([item.id]);
    const replaced = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'Orbe current calibration file retention'), notebook.id);
    assert(replaced.evidence.some(evidence => evidence.documentId === item.id && evidence.text.includes('89')));
    const historical = await page.evaluate(id => window.nodus.getPassage(id), previousReceipt);
    assert(historical?.historical, 'a retained conversation citation explicitly identifies its superseded revision');
    report.checks.originalReplacement = { previousReceiptHistorical: true, historical, evidence: replaced.evidence }; save();
  } finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.qaLifecyclePicker; delete globalThis.qaLifecyclePicker; }); }
  // A document-only notebook makes this a real cross-language semantic test:
  // its Spanish original has no matching apparatus/cloudiness/visible-beam terms.
  const corpus = JSON.parse(fs.readFileSync(path.join(harness.root, 'artifacts/corpus-manifest.json'), 'utf8'));
  const spanish = corpus.documents.find(document => document.theme === 2 && document.language === 'es');
  const listed = (await page.evaluate(() => window.nodus.listGlobalLibraryItems({ limit: 100 }))).items;
  const all = await page.evaluate(ids => Promise.all(ids.map(id => window.nodus.getGlobalLibraryItem(id))), listed.map(item => item.id));
  const source = all.find(item => item.attachments.some(attachment => attachment.sha256 === spanish.sha256)); assert(source);
  const limited = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'QA Spanish-only semantic evidence', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), source.id);
  const traceFile = path.join(harness.root, 'profile/embedding-trace.jsonl'), linesBefore = fs.readFileSync(traceFile, 'utf8').trim().split('\n').length;
  const query = 'Which apparatus determines how cloudy a liquid is using a visible beam?';
  const semantic = await page.evaluate(({ id, query }) => window.nodus.searchResearchNotebook(id, query), { id: limited.id, query });
  assert(semantic.evidence.every(evidence => evidence.documentId === source.id)); assert(semantic.evidence.some(evidence => /Alba|530|turbidez/.test(evidence.text)));
  const traces = fs.readFileSync(traceFile, 'utf8').trim().split('\n').slice(linesBefore).map(JSON.parse);
  assert(traces.some(trace => trace.retrieval?.semantic?.some(candidate => trace.retrieval.selected?.some(selected => selected.semanticIds?.includes(candidate.id)))), 'a semantic candidate contributes to the selected evidence');
  report.checks.semanticOnlySource = { notebook: limited, evidence: semantic.evidence, traces }; save();
  const manual = report.vaults.find(vault => vault.mode === 'manual'), automatic = report.vaults.find(vault => vault.mode === 'auto');
  await page.evaluate(id => window.nodus.switchVault(id), manual.id);
  assert.equal(await page.evaluate(id => window.nodus.getPassage(id), receipt), null, 'a citation from another vault cannot be opened');
  const manualNotebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'QA manual semantic source', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), source.id);
  await ready([source.id]);
  assert((await page.evaluate(({ id, query }) => window.nodus.searchResearchNotebook(id, query), { id: manualNotebook.id, query })).evidence.some(evidence => evidence.documentId === source.id));
  await page.evaluate(id => window.nodus.switchVault(id), automatic.id);
  report.checks.manualVaultAndCitationIsolation = true; save();
  if (model.startsWith('embeddinggemma')) {
    const alternate = model.includes('-512-') ? 'embeddinggemma-2-text-q8-256-v1' : 'embeddinggemma-2-text-q8-512-v1';
    await page.evaluate(model => window.nodus.updateSettings({ embeddingModel: model }), alternate);
    const pending = (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === source.id);
    assert.notEqual(pending.preparation.embeddings, 'ready', 'same weights with different dimensions are a different contract');
    await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), source.id); await ready([source.id]);
    await page.evaluate(({ id, query }) => window.nodus.searchResearchNotebook(id, query), { id: limited.id, query });
    const latest = fs.readFileSync(traceFile, 'utf8').trim().split('\n').map(JSON.parse).filter(trace => trace.type === 'documentary-retrieval').at(-1);
    assert.equal(latest.profile.model, alternate); assert.equal((typeof latest.contract === 'string' ? JSON.parse(latest.contract) : latest.contract).dim, alternate.includes('-256-') ? 256 : 512);
    await page.evaluate(model => window.nodus.updateSettings({ embeddingModel: model }), model);
    report.checks.explicitProfileRebuild = { pending: pending.preparation, rebuiltContract: latest.contract }; save();
  }
  await checkNativeEmbeddingFailures(harness, report, limited.id, source.id); save();
  await page.reload();
  await app.evaluate(({ ipcMain }, allowLocalRuntime) => { globalThis.qaOfflineRequests = []; globalThis.qaLocalRuntimeRequests = []; const old = globalThis.fetch; globalThis.qaOnlineFetch = old;
    globalThis.fetch = async (input, options) => {
      const address = String(input), url = new URL(address);
      // BGE runs llama.cpp in this same isolated profile and communicates over
      // loopback. The OS sandbox still rejects every unapproved port or host.
      if (allowLocalRuntime && url.hostname === '127.0.0.1' && url.pathname === '/v1/embeddings') {
        globalThis.qaLocalRuntimeRequests.push(address); return old(input, options);
      }
      globalThis.qaOfflineRequests.push(address); throw new Error('QA offline');
    }; }, model === 'bge-m3-q8_0');
  try {
    const offline = await page.evaluate(({ id, query }) => window.nodus.searchResearchNotebook(id, query), { id: limited.id, query });
    assert(offline.evidence.some(evidence => evidence.documentId === source.id));
    assert.deepEqual(await app.evaluate(() => globalThis.qaOfflineRequests), [], 'local embeddings/retrieval make zero network requests');
    report.checks.localOffline = true;
    report.checks.localRuntimeTransport = await app.evaluate(() => globalThis.qaLocalRuntimeRequests);
  } finally { await app.evaluate(() => { globalThis.fetch = globalThis.qaOnlineFetch; delete globalThis.qaOnlineFetch; }); }
  save();
}
