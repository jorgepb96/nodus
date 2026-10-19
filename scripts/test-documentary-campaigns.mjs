import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-campaigns')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-campaigns-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const preparation = load('electron/ai/documentaryPreparation.ts');
const database = load('electron/db/database.ts');
try {
  const registry = load('electron/vaults/vaultRegistry.ts');
  const vault = registry.getActiveVault();
  const other = registry.createVault('Other', 'academic');
  const db = database.getDb();
  const seed = (id, archived = 0) => db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type,archived) VALUES(?,?,?,'[]','book','text',?)").run(id, id, id, archived);
  seed('one'); seed('old-pending'); seed('archived', 1);
  const experience = load('electron/ai/researchPreparationExperience.ts');
  preparation.setResearchPreparationPaused(true);
  const repo = new (load('electron/db/documentaryCampaigns.ts').DocumentaryCampaigns)(preparation.documentaryStore().db);
  assert.equal(experience.getResearchPreparationPolicy().futureAdditions, true);
  assert.equal(repo.list().length, 0, 'updating/reading inventory creates no preparation');
  const preview = await experience.previewResearchPreparation({ scope: 'vault' });
  assert.deepEqual(preview.documents.map(doc => doc.title).sort(), ['old-pending', 'one']);
  assert.equal(preview.embeddingAvailable, false, 'a missing key does not choose another provider');
  assert.deepEqual((await experience.previewResearchPreparation({ scope: 'selection', documentIds: [] })).documents, []);
  await assert.rejects(() => experience.previewResearchPreparation({ scope: 'selection', documentIds: ['foreign'] }), /not_authorized/);
  await assert.rejects(() => experience.startResearchPreparationCampaign({ previewId: preview.id, mode: 'embeddings' }), /unavailable/);
  seed('after-preview');
  const campaign = await experience.startResearchPreparationCampaign({ previewId: preview.id, mode: 'text' });
  assert.equal(repo.audit(campaign).reason, 'manual');
  const progress = experience.getResearchPreparationProgress();
  assert.equal(progress.campaigns[0].jobs.length, 2, 'confirmation never expands the frozen inventory');
  assert.equal(progress.campaigns[0].embedding, null);
  await assert.rejects(() => experience.startResearchPreparationCampaign({ previewId: preview.id, mode: 'text' }), /expired/);
  const otherPolicy = repo.policy(other.id);
  experience.setResearchPreparationPolicy({ futureAdditions: false });
  experience.setResearchPreparationPolicy({ decision: 'declined', welcomeVersion: 1, futureAdditions: true });
  assert.equal(repo.policy(vault.id).known.length, 3, 'enabling future additions records preexisting pending members');
  assert.deepEqual(repo.policy(other.id), otherPolicy, 'changing a policy does not modify another vault');
  experience.setResearchPreparationPolicy({ futureAdditions: true, vaultId: other.id, known: [], authorized: {} });
  assert.deepEqual(repo.policy(other.id), otherPolicy, 'untrusted extra policy fields cannot change the owner or baseline');
  const beforeDisable = repo.list().length;
  experience.setResearchPreparationPolicy({ futureAdditions: false });
  assert.equal(repo.list().length, beforeDisable);
  assert.ok(experience.getResearchPreparationProgress().campaigns[0].jobs.every(job => job.state === 'queued'), 'disabling automatic work keeps explicit jobs');

  const doc = preview.documents.find(doc => doc.title === 'one');
  load('electron/ai/documentaryChunking.ts').documentaryChunks = async text => [{ text, pageLabel: null, pageNumber: null, sourceRef: null }];
  preparation.documentaryStore().setPreference('paused', false);
  try { await preparation.prepareDocumentaryText(doc, 'First attachment, not yet published'); }
  finally { preparation.documentaryStore().setPreference('paused', true); }
  assert.deepEqual(preparation.pinPublishedResearchDocument(doc).indexedSource.indexKeys, [], 'a campaign cannot expose its first partial attachment before atomic source publication');
  const configuration = JSON.parse(repo.list().find(row => row.id === campaign).configuration_json);
  const shared = repo.create(other.id, other.name, [doc], configuration);
  const job = repo.db.prepare('SELECT job_id FROM documentary_campaign_members WHERE campaign_id=?').get(shared).job_id;
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM documentary_campaign_members WHERE job_id=?').get(job).n, 2);
  const distinctSpace = repo.create(vault.id, vault.name, [doc], { ...configuration, embedding: { provider: 'openrouter', modelId: 'fixture', endpoint: 'https://example.invalid/v1' } });
  assert.notEqual(repo.db.prepare('SELECT job_id FROM documentary_campaign_members WHERE campaign_id=?').get(distinctSpace).job_id, job);
  repo.db.prepare('UPDATE documentary_requests SET priority=100 WHERE document_id=?').run(job);
  const sharedLease = repo.requests.claim(vault.id);
  assert.equal(sharedLease.document_id, job);
  repo.control(campaign, 'pause', doc.id);
  repo.requests.renew(sharedLease);
  assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(job).state, 'running', 'another authorized campaign retains the live shared lease');
  repo.control(shared, 'pause');
  assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(job).state, 'paused');
  assert.throws(() => repo.requests.renew(sharedLease), /lease_lost/, 'withdrawing the last active interest fences in-flight publication');
  repo.control(shared, 'resume');
  repo.synchronizeOwners([vault.id, other.id]);
  assert.equal(repo.db.prepare('SELECT vault_id FROM documentary_requests WHERE document_id=?').get(job).vault_id, other.id);
  repo.control(campaign, 'pause');
  repo.control(campaign, 'resume');
  assert.equal(repo.db.prepare('SELECT state FROM documentary_campaign_members WHERE campaign_id=? AND document_id=?').get(campaign, doc.id).state, 'paused', 'campaign resume preserves an explicitly paused member');
  repo.control(shared, 'cancel');
  assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(job).state, 'cancelled');
  repo.control(campaign, 'resume', doc.id);
  assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(job).state, 'queued');
  const blockedLease = repo.requests.claim(vault.id);
  assert.equal(blockedLease.document_id, job);
  repo.requests.block(blockedLease, 'documentary_ocr_deferred');
  repo.synchronizeOwners([vault.id, other.id]);
  const blocked = repo.db.prepare('SELECT state,attempts FROM documentary_requests WHERE document_id=?').get(job);
  assert.equal(blocked.state, 'blocked', 'missing OCR resources must not spin on owner reconciliation');
  assert.equal(blocked.attempts, 0, 'a recoverable resource block is not a provider failure');
  repo.control(campaign, 'retry', doc.id);
  assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(job).state, 'queued');
  const reopened = new (load('electron/db/documentaryCampaigns.ts').DocumentaryCampaigns)(repo.db);
  assert.equal(reopened.policy(vault.id).decision, 'declined');
  assert.equal(reopened.list().length, 3);
  const stale = await experience.previewResearchPreparation({ scope: 'selection', documentIds: [doc.id] });
  db.prepare("UPDATE works SET archived=1 WHERE nodus_id='one'").run();
  await assert.rejects(() => experience.startResearchPreparationCampaign({ previewId: stale.id, mode: 'text' }), /inventory_changed/);
  experience.setResearchPreparationPolicy({ futureAdditions: true });
  const countBeforeAddition = repo.list().length;
  seed('future-addition');
  preparation.notifyResearchCorpusChanged();
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(repo.list().length, countBeforeAddition + 1);
  const latest = experience.getResearchPreparationProgress().campaigns[0];
  assert.equal(latest.audit.reason, 'new_content');
  assert.deepEqual(latest.jobs.map(job => job.title), ['future-addition'], 'automatic work excludes old pending members');
  // Live finding: a document added before any embedding key existed froze the default
  // remote model; after configuring the local bge model, "Reintentar" re-queued it with the
  // same unusable model and it blocked again, forever.
  const settingsRepo = load('electron/db/settingsRepo.ts');
  const aiClient = load('electron/ai/aiClient.ts');
  const originalSettings = settingsRepo.getSettings, originalEmbedding = aiClient.effectiveEmbeddingConfig;
  try {
    const jobOf = id => repo.db.prepare('SELECT job_id FROM documentary_campaign_members WHERE campaign_id=?').get(id).job_id;
    const frozenEmbedding = id => JSON.parse(repo.db.prepare('SELECT configuration_json FROM documentary_requests WHERE document_id=?').get(jobOf(id)).configuration_json).embedding;
    const block = id => repo.db.prepare("UPDATE documentary_requests SET state='blocked',error='documentary_embeddings_unavailable' WHERE document_id=?").run(jobOf(id));
    settingsRepo.getSettings = () => ({ ...originalSettings(), providerKeys: {} });
    aiClient.effectiveEmbeddingConfig = () => ({ provider: 'nodus', modelId: 'bge-m3-q8_0', endpoint: 'nodus-local-runtime' });
    const stale = repo.create(vault.id, vault.name, [doc], { embedding: { provider: 'openai', modelId: 'text-embedding-3-small', endpoint: 'https://api.openai.com/v1' }, processingVersion: 'nodus-documentary/2' });
    block(stale);
    await experience.controlResearchPreparationCampaign({ campaignId: stale, documentId: doc.id, action: 'retry' });
    assert.equal(frozenEmbedding(stale).provider, 'nodus', 'a retry adopts the model configured now when the frozen one cannot run');
    assert.equal(experience.getResearchPreparationProgress().campaigns.find(item => item.id === stale).embedding.model, 'bge-m3-q8_0', 'the Queue shows the model that will run');
    assert.equal(repo.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(jobOf(stale)).state, 'queued');
    settingsRepo.getSettings = () => ({ ...originalSettings(), providerKeys: { openrouter: 'synthetic-test-only' } });
    const runnable = repo.create(vault.id, vault.name, [doc], { embedding: { provider: 'openrouter', modelId: 'baai/bge-m3', endpoint: 'https://openrouter.ai/api/v1' }, processingVersion: 'nodus-documentary/2' });
    block(runnable);
    await experience.controlAllResearchPreparation('retry');
    assert.equal(frozenEmbedding(runnable).provider, 'openrouter', 'a frozen model that still runs is never swapped behind the user');
  } finally { settingsRepo.getSettings = originalSettings; aiClient.effectiveEmbeddingConfig = originalEmbedding; }
  // "Indexar" in the Library is one click: no dialog, the pending documents are queued
  // at once; only more than 100 documents ask for confirmation first.
  const campaignsBefore = repo.list().length;
  try {
    aiClient.effectiveEmbeddingConfig = () => ({ provider: 'openrouter', modelId: 'baai/bge-m3', endpoint: 'https://openrouter.ai/api/v1' });
    settingsRepo.getSettings = () => ({ ...originalSettings(), providerKeys: {} });
    seed('index-now');
    const none = await experience.indexResearchWorks({ workIds: ['index-now'] });
    assert.deepEqual([none.requested, none.queued, none.embeddingAvailable], [1, 0, false], 'nothing is queued without a usable embedding model');
    settingsRepo.getSettings = () => ({ ...originalSettings(), providerKeys: { openrouter: 'synthetic-test-only' } });
    const one = await experience.indexResearchWorks({ workIds: ['index-now'] });
    assert.deepEqual([one.requested, one.queued, one.confirmationRequired], [1, 1, undefined], 'one click queues the document');
    assert.equal(repo.list().length, campaignsBefore + 1);
    const many = Array.from({ length: 101 }, (_, index) => `bulk-${index}`);
    for (const id of many) seed(id);
    const asked = await experience.indexResearchWorks({ workIds: many });
    assert.deepEqual([asked.queued, asked.confirmationRequired], [0, 101], 'more than 100 documents ask first and queue nothing');
    assert.equal(repo.list().length, campaignsBefore + 1);
    const confirmed = await experience.indexResearchWorks({ workIds: many, confirmed: true });
    assert.equal(confirmed.queued, 101);
    assert.equal(repo.list().length, campaignsBefore + 2);
  } finally { settingsRepo.getSettings = originalSettings; aiClient.effectiveEmbeddingConfig = originalEmbedding; }
  console.log('Frozen This-vault consent, missing configuration, independent future policy, shared job interests, per-document controls and revoked previews passed.');
} finally {
  await preparation.closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true });
}
