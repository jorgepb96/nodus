import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-writers')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-writer-test-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const { unpreparedResearchAttachmentIds } = load('shared/researchCorpus.ts');
  const multi = { revision: 'r1', coverage: 'fulltext', attachments: [{ id: 'a', revision: 'hash-a' }, { id: 'b', revision: 'hash-b' }] };
  const a = { revision: 'r1', attachmentId: 'a', attachmentRevision: 'hash-a', coverage: 'fulltext' };
  assert.deepEqual(unpreparedResearchAttachmentIds(multi, [a]), ['b'], 'one indexed file cannot hide an unsupported or pending attachment');
  assert.deepEqual(unpreparedResearchAttachmentIds(multi, [{ ...a, attachmentRevision: 'old-hash' }]), ['a', 'b']);
  assert.deepEqual(unpreparedResearchAttachmentIds(multi, [{ ...a, coverage: 'abstract' }]), ['a', 'b'], 'abstract availability is not attachment preparation');
  assert.deepEqual(unpreparedResearchAttachmentIds({ ...multi, indexedSource: { revision: 'r0', attachments: [multi.attachments[0]] } }, [{ ...a, revision: 'r0' }]), [], 'old publication coverage is evaluated against its pinned files');
  const db = load('electron/db/database.ts').getDb();
  assert.equal(db.pragma('user_version', { simple: true }), load('electron/db/migrations.ts').SCHEMA_VERSION);
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('inside','inside','Synthetic','[]','book','text')").run();
  const { beginPassagePublication } = load('electron/db/passagePublications.ts');
  const { replaceWorkPassages } = load('electron/db/passagesRepo.ts');
  const settings = load('electron/db/ideasRepo.ts').currentEmbeddingConfig();
  const old = beginPassagePublication('inside', 'old');
  const recent = beginPassagePublication('inside', 'recent');
  const rows = [{ text: 'Current evidence', pageLabel: '1', embedding: null }];
  const config = { embeddingProvider: settings.provider, embeddingModel: settings.model };
  replaceWorkPassages('inside', 'recent', rows, { ...config, publication: recent });
  assert.throws(() => replaceWorkPassages('inside', 'old', [], { ...config, publication: old }), /superseded/);
  assert.equal(db.prepare('SELECT text FROM passages').get().text, 'Current evidence');

  // Exercise the actual shared store and persistent operation lease. Only the
  // worker and provider are deterministic test doubles in this unit fixture.
  const chunks = load('electron/ai/documentaryChunking.ts');
  chunks.documentaryChunks = async text => [{ text, pageLabel: '1', pageNumber: 1, sourceRef: 'fixture' }];
  const ai = load('electron/ai/aiClient.ts');
  let calls = 0, unblock;
  ai.embedMany = async () => { calls++; await new Promise(resolve => { unblock = resolve; }); return [[1, 0, 0]]; };
  const preparation = load('electron/ai/documentaryPreparation.ts');
  const doc = load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory().documents.find(item => item.workId === 'inside');
  const text = await preparation.prepareDocumentaryText({ ...doc, coverage: 'fulltext' }, 'Known evidence');
  assert.equal(preparation.documentaryStore().lexicalSearch('Known', [text.indexKey], 3).length, 1);
  const pending = preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks);
  await assert.rejects(() => preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks), /embedding_busy/, 'a producer already computing these vectors is named, not reported as missing');
  assert.equal(calls, 1, 'concurrent producer is fenced before a provider request');
  unblock();
  const result = await pending;
  assert.equal(preparation.documentaryStore().revision(result.indexKey).embedding_ready, 1);
  const reused = await preparation.prepareDocumentaryEmbeddings(text.indexKey, text.chunks);
  assert.equal(calls, 1, 'compatible published vectors are reused');
  assert.deepEqual(reused.vectors, [[1, 0, 0]]);
  const preferences = load('electron/db/settingsRepo.ts');
  const indexes = load('electron/db/embeddingIndexesRepo.ts');
  const savedIndex = indexes.activeEmbeddingIndex(db);
  assert.throws(() => preferences.updateSettings({ embeddingModel: 'incompatible-fixture-space' }), /Prepara y activa/);
  const other = indexes.createIndex(db, indexes.embeddingProfile(preferences.getSettings(), { provider: preferences.getSettings().embeddingProvider, model: 'incompatible-fixture-space' }));
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(other.id);
  indexes.commitEmbeddingIndex(db, indexes.indexContext(db, other));
  assert.equal(preparation.getResearchPreparationInventory().documents.find(item => item.id === doc.id).preparation.embeddings, 'stale', 'another configured vector space is not reported as compatible');
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(savedIndex.indexId);
  indexes.commitEmbeddingIndex(db, savedIndex);
  const inventory = preparation.getResearchPreparationInventory();
  assert.equal(inventory.embeddingSpaces.length, 1);
  assert.match(inventory.embeddingSpaces[0].id, /^[a-f0-9]{64}$/);
  const files = [];
  for (const attachmentId of ['appendix-a', 'appendix-b']) {
    files.push(await preparation.prepareDocumentaryText({ ...doc, coverage: 'fulltext', attachmentId,
      attachments: [{ id: attachmentId, revision: `hash-${attachmentId}` }] }, `Independent ${attachmentId} evidence`));
  }
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const activity = [];
  const { withResearchActivity } = load('electron/ai/researchActivity.ts');
  const found = await withResearchActivity(event => activity.push(event), undefined, () => preparation.retrieveSharedDocumentaryEvidence(scope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null));
  assert.ok(activity.some(event => event.layer === 'nodus' && event.operation === 'lexical' && event.status === 'completed' && event.count === 2), 'real worker lexical progress crosses IPC');
  assert.ok(activity.some(event => event.layer === 'context' && event.operation === 'expand' && event.status === 'completed'), 'real Auto Expand rounds emit progress');
  assert.equal(activity.filter(event => event.status === 'active').length, activity.filter(event => event.status === 'completed').length);
  assert.ok(!activity.some(event => event.layer === 'zotero'), 'shared index access never pretends to contact Zotero');
  assert.deepEqual([...new Set(found.evidence.map(item => item.attachmentId))].sort(), ['appendix-a', 'appendix-b']);
  const incompleteScope = { ...scope, documents: scope.documents.map(document => document.id === doc.id ? { ...document,
    attachments: ['appendix-a', 'appendix-b', 'pending-scan'].map(id => ({ id, revision: `hash-${id}` })) } : document) };
  const corpusInventory = load('electron/ai/researchCorpusInventory.ts');
  const originalInventory = corpusInventory.researchCorpusInventory;
  corpusInventory.researchCorpusInventory = () => ({ ...originalInventory(), documents: incompleteScope.documents });
  try {
    const incomplete = await preparation.retrieveSharedDocumentaryEvidence(incompleteScope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null);
    assert.equal(incomplete.evidence.length, 2, 'available files remain searchable');
    assert.equal(incomplete.traversal.partial, true, 'missing attachment coverage reaches the shared traversal');
    assert.ok(incomplete.evidence.every(item => item.limitations.includes('attachments_partially_prepared')));
  } finally { corpusInventory.researchCorpusInventory = originalInventory; }

  assert.equal(preparation.getResearchPreparationInventory().documents.find(item => item.id === doc.id).preparation.passages, 2);
  const citations = load('electron/citations/documentaryCitations.ts');
  const citationId = citations.documentaryCitationId(scope.id, found.evidence[0].id);
  const before = citations.getDocumentaryPassageDetail(citationId);
  assert.equal(before.attachmentId, found.evidence[0].attachmentId);
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const readRun = new ResearchCorpusRun(scope, load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced);
  const pages = await readRun.readDocument(doc.id, { kind: 'pages', from: 1, attachmentId: 'appendix-b' });
  assert.equal(pages.evidence.length, 1);
  assert.equal(pages.evidence[0].attachmentId, 'appendix-b');
  const context = await readRun.readDocument(doc.id, { kind: 'context', passageId: pages.evidence[0].id, radius: 1 });
  assert.equal(context.evidence[0].id, pages.evidence[0].id);
  assert.equal(readRun.budget.rounds, 2, 'document operations share the run discovery budget');
  await assert.rejects(() => readRun.readDocument('foreign-document', { kind: 'search', query: 'Independent' }), /not_authorized/);
  await assert.rejects(() => readRun.readDocument(doc.id, { kind: 'pages', from: 1, to: 9 }), /Invalid physical page/);
  await assert.rejects(() => readRun.readDocument(doc.id, { kind: 'context', passageId: '../../outside' }), /Invalid context/);
  preparation.documentaryStore().publishDocument(doc, files.map(file => file.indexKey));
  db.prepare('UPDATE works SET resolved_text_hash=? WHERE nodus_id=?').run('changed-content', 'inside');
  const freshScope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  assert.equal(freshScope.documents[0].indexedSource.revision, doc.revision, 'new run explicitly pins the last complete publication');
  assert.notEqual(freshScope.documents[0].revision, doc.revision);
  const fallback = await preparation.retrieveSharedDocumentaryEvidence(freshScope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null);
  assert.equal(fallback.evidence.length, 2, 'failed or pending rebuild remains queryable');
  assert.ok(fallback.evidence.every(item => item.revision === doc.revision && item.limitations.includes('previous_indexed_revision')));
  assert.equal(fallback.traversal.partial, true);
  assert.equal(preparation.getResearchPreparationInventory().documents.find(item => item.id === doc.id).preparation.lexical, 'stale');
  const fallbackId = citations.documentaryCitationId(freshScope.id, fallback.evidence[0].id);
  assert.equal(citations.getDocumentaryPassageDetail(fallbackId).historical, true);
  const partial = await preparation.prepareDocumentaryText({ ...freshScope.documents[0], indexedSource: undefined, attachmentId: 'appendix-a' }, 'New revision unpublished half');
  const stillOld = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  assert.equal(stillOld.id, freshScope.id, 'an incomplete rebuild cannot change the published scope');
  assert.throws(() => preparation.documentaryStore().publishDocument(freshScope.documents[0], [partial.indexKey, 'missing']), /publication_incomplete/);
  assert.equal(load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope().id, freshScope.id);

  const pinnedRead = await preparation.retrieveSharedDocumentaryEvidence(scope, 'Independent', load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.balanced, null);
  assert.deepEqual(pinnedRead.evidence.map(item => item.text), found.evidence.map(item => item.text), 'frozen executions keep original indexed revisions after content changes');
  const historical = citations.getDocumentaryPassageDetail(citationId);
  assert.equal(historical.historical, true);
  assert.equal(historical.text, before.text, 'immutable citation keeps its exact original text after a content edit');
  db.prepare('UPDATE works SET archived=1 WHERE nodus_id=?').run('inside');
  assert.equal(citations.getDocumentaryPassageDetail(fallbackId), null);
  assert.equal(citations.getDocumentaryPassageDetail(citationId), null, 'revocation still blocks historical source reads');
  const manyChunks = Array.from({ length: 70 }, (_, i) => ({ text: `Known fragment ${i}`, pageLabel: String(i + 1), pageNumber: i + 1, sourceRef: 'fixture' }));
  chunks.documentaryChunks = async () => manyChunks;
  const checkpointText = await preparation.prepareDocumentaryText({ ...doc, id: 'checkpoint-fixture' }, 'Checkpoint source');
  const captured = { provider: 'openrouter', modelId: 'baai/bge-m3', endpoint: 'http://127.0.0.1:9999/v1' };
  const batches = [];
  let failSecond = true;
  ai.embedMany = async (texts, _signal, options) => {
    assert.deepEqual(options.config, captured, 'each dispatch keeps the explicit model and endpoint');
    batches.push([...texts]);
    if (texts[0] === 'Known fragment 32' && failSecond) { failSecond = false; throw new Error('fixture-provider-unavailable'); }
    return texts.map(text => [Number(text.split(' ').at(-1)) + 1, 1, 0]);
  };
  await assert.rejects(() => preparation.prepareDocumentaryEmbeddings(checkpointText.indexKey, manyChunks, undefined, captured), /fixture-provider/);
  const workingDb = preparation.documentaryStore().db;
  // Batches overlap: the third returned while the second failed, and its paid vectors are kept.
  assert.equal(workingDb.prepare('SELECT COUNT(*) n FROM documentary_embedding_chunks WHERE operation LIKE ?').get('embedding:checkpoint-fixture:%').n, 38);
  assert.equal(preparation.documentaryStore().revision(checkpointText.indexKey).embedding_ready, 0, 'partial vectors are never published');
  assert.equal(workingDb.prepare("SELECT COUNT(*) n FROM documentary_embedding_attempts WHERE state='unknown'").get().n, 1, 'ambiguous provider outcomes remain recorded');
  // Live finding: the failed operation waits out a retry backoff, and a second request
  // for the same document could not take it over ("documentary_embedding_job_unavailable").
  assert.ok(workingDb.prepare("SELECT available_at FROM documentary_requests WHERE document_id LIKE 'embedding:checkpoint-fixture:%'").get().available_at > Date.now(), 'the failed operation is in backoff');
  const resumed = await preparation.prepareDocumentaryEmbeddings(checkpointText.indexKey, manyChunks, undefined, captured);
  assert.equal(resumed.vectors.length, 70);
  assert.deepEqual(batches.map(batch => batch[0]), ['Known fragment 0', 'Known fragment 32', 'Known fragment 64', 'Known fragment 32'], 'recovery re-embeds only the failed batch, never a committed one');
  assert.equal(preparation.documentaryStore().revision(resumed.indexKey).embedding_ready, 1);
  console.log('Legacy fencing, lexical-first preparation, frozen model dispatch, durable batches and compatible vector reuse passed.');
} finally {
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
