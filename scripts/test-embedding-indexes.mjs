import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--embedding-indexes-test')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-embedding-indexes-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const database = require('../electron/db/database.ts');
const settings = require('../electron/db/settingsRepo.ts');
const indexes = require('../electron/db/embeddingIndexesRepo.ts');
const ideas = require('../electron/db/ideasRepo.ts');
const { embeddingTextHash } = require('../electron/db/ideaEmbeddingText.ts');
let db;
test.after(() => { database.closeDb(); fs.rmSync(scratch, { recursive: true, force: true }); });

test('vectors are normalized, isolated and switched without copying the corpus', () => {
  const config = settings.updateSettings({ embeddingProvider: 'openai', embeddingModel: 'model-a' });
  db = database.getDb();
  const a = indexes.activeEmbeddingIndex(db);
  const idea = ideas.createIdea({ type: 'claim', label: 'A claim', statement: 'Some evidence', embedding: [1, 0, 0] });
  assert.equal(db.prepare('SELECT embedding FROM ideas WHERE global_id=?').get(idea.global_id).embedding, null);
  assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [1, 0, 0]);
  const profile = indexes.embeddingProfile(config, { provider: 'openai', model: 'model-b' });
  const row = indexes.createIndex(db, profile);
  const b = indexes.indexContext(db, row);
  indexes.storeIndexValue(db, b, { family: 'ideas', entityId: idea.global_id, textHash: embeddingTextHash('other'), vector: [0, 1, 0], contract: indexes.contractForProfile(profile, 3) });
  const activate = context => { db.prepare('UPDATE embedding_index_state SET pending_id=?').run(context.indexId); indexes.commitEmbeddingIndex(db, context); };
  activate(b);
  assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [0, 1, 0]);
  indexes.withEmbeddingIndexContext(a, () => {
    assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [1, 0, 0], 'an in-flight query keeps its original index');
    assert.throws(() => ideas.updateIdeaEmbedding(idea.global_id, ideas.embeddingTextForIdea({ type: 'claim', label: 'A claim', statement: 'Some evidence' }), [1, 1, 0]), /configuration_changed/, 'late source writes cannot enter the new active index');
  });
  const before = db.prepare('SELECT index_id,hex(embedding) bytes FROM embedding_index_values ORDER BY index_id').all();
  activate(a);
  assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [1, 0, 0]);
  assert.deepEqual(db.prepare('SELECT index_id,hex(embedding) bytes FROM embedding_index_values ORDER BY index_id').all(), before);
  db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('Changed evidence', idea.global_id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM embedding_index_values WHERE family='ideas' AND entity_id=?").get(idea.global_id).n, 0, 'a content edit invalidates every saved model');
  indexes.deleteIndex(db, a.indexId);
  assert.equal(indexes.activeEmbeddingIndex(db), null);
  settings.getSettings();
  assert.equal(indexes.activeEmbeddingIndex(db), null, 'settings reads never recreate an explicitly deleted active index');
});

test('contracts reject dimension changes and invalid vectors without partial writes', () => {
  const profile = indexes.embeddingProfile(settings.getSettings(), { provider: 'openai', model: 'strict-model' });
  const context = indexes.indexContext(db, indexes.createIndex(db, profile));
  const value = { family: 'notes', entityId: 'note', textHash: 'hash', vector: [1, 0, 0], contract: indexes.contractForProfile(profile, 3) };
  indexes.storeIndexValue(db, context, value);
  assert.throws(() => indexes.storeIndexValue(db, context, { ...value, vector: [1, 0], contract: indexes.contractForProfile(profile, 2) }), /dimension_mismatch/);
  assert.throws(() => indexes.storeIndexValue(db, context, { ...value, vector: [NaN, 0, 1] }), /vector_invalid/);
  const other = { ...profile, endpoint: 'https://other.example/v1' };
  assert.notEqual(indexes.profileFingerprint(profile), indexes.profileFingerprint(other));
  assert.notEqual(indexes.profileFingerprint(profile), indexes.profileFingerprint({ ...profile, modelRevision: 'different-revision' }));
  assert.equal(indexes.normalizeEmbeddingEndpoint('https://user:secret@example.org/v1/?token=secret#private'), 'https://example.org/v1');
});

test('a built-in Harrier index records its query instruction and last-token pooling', () => {
  const harrier = indexes.embeddingProfile(settings.getSettings(), { provider: 'nodus', model: 'harrier-oss-v1-0.6b-q8_0' });
  assert.equal(harrier.endpoint, 'nodus-local-runtime');
  assert.match(harrier.modelRevision, /^[a-f0-9]{64}$/, 'the pinned GGUF digest identifies the weights');
  assert.equal(harrier.input.kind, 'harrier');
  assert.equal(harrier.input.documentPrefix, '');
  const contract = indexes.contractForProfile(harrier, 1024);
  assert.equal(contract.preprocessing.pooling, 'last');
  assert.match(contract.preprocessing.inputProfile.queryPrefix, /^Instruct: .+\nQuery: $/);
  const bge = indexes.contractForProfile(indexes.embeddingProfile(settings.getSettings(), { provider: 'nodus', model: 'bge-m3-q8_0' }), 1024);
  assert.equal('pooling' in bge.preprocessing, false, 'models without a declared pooling keep their historical contract');
  assert.notEqual(indexes.profileFingerprint(harrier), indexes.profileFingerprint({ ...harrier, input: { version: 1, kind: 'plain', queryPrefix: '', documentPrefix: '' } }),
    'an index prepared without the instruction is a different vector space');
});

test('CLS profiles are new vector spaces and leave mean-pooled BGE-M3 and GTE indexes valid', () => {
  // Fingerprints of indexes prepared before the CLS profiles existed. A change here would force
  // every user with a local BGE-M3 or GTE index to rebuild it.
  const historical = {
    'bge-m3-q8_0': '36b4af3e7154f280cf435db32b95c50528009a67a385f04320b8ab43a895521f',
    'gte-multilingual-base-int8': '161b043abb4ac246ac29bdeee73a38d443944550de2178adf585a803ded60e19',
  };
  for (const [legacyId, fingerprint] of Object.entries(historical)) {
    const legacy = indexes.embeddingProfile(settings.getSettings(), { provider: 'nodus', model: legacyId });
    assert.equal(indexes.profileFingerprint(legacy), fingerprint, `${legacyId} keeps its historical fingerprint`);
    assert.equal('pooling' in indexes.contractForProfile(legacy, 1).preprocessing, false);
    const cls = indexes.embeddingProfile(settings.getSettings(), { provider: 'nodus', model: `${legacyId}-cls` });
    assert.equal(cls.modelRevision, legacy.modelRevision, 'both profiles name the same verified weights');
    assert.deepEqual(cls.input, legacy.input, 'only the pooling differs');
    assert.equal(indexes.contractForProfile(cls, 1).preprocessing.pooling, 'cls');
    assert.notEqual(indexes.profileFingerprint(cls), fingerprint, 'a CLS vector never lands in a mean-pooled index');
  }
});

test('model revisions are scoped to their normalized endpoint', () => {
  const revisions = require('../electron/ai/embeddingModelRevisions.ts');
  const config = { ...settings.getSettings(), localProviders: { ollama: { baseUrl: 'http://127.0.0.1:11434' } } };
  revisions.rememberEmbeddingModelRevisions('ollama', 'http://127.0.0.1:11434/v1/', [{ id: 'model', revision: 'a'.repeat(64) }]);
  const a = indexes.embeddingProfile(config, { provider: 'ollama', model: 'model' });
  revisions.rememberEmbeddingModelRevisions('ollama', 'http://127.0.0.1:11434/v1', [{ id: 'model', revision: 'b'.repeat(64) }]);
  const b = indexes.embeddingProfile(config, { provider: 'ollama', model: 'model' });
  assert.notEqual(indexes.profileFingerprint(a), indexes.profileFingerprint(b));
  const other = indexes.embeddingProfile({ ...config, localProviders: { ollama: { baseUrl: 'http://127.0.0.1:11435' } } }, { provider: 'ollama', model: 'model' });
  assert.equal(other.modelRevision, null);
});

test('a failed or paused generation leaves the active generation searchable', () => {
  const profile = indexes.embeddingProfile(settings.getSettings(), { provider: 'openai', model: 'generation-model' });
  const row = indexes.createIndex(db, profile);
  const context = indexes.indexContext(db, row);
  db.prepare('UPDATE embedding_index_state SET pending_id=?').run(row.id); indexes.commitEmbeddingIndex(db, context);
  const idea = ideas.createIdea({ type: 'claim', label: 'Stable', statement: 'Original', embedding: [1, 0, 0] });
  db.prepare("UPDATE embedding_indexes SET staging_generation=2,preparation='running' WHERE id=?").run(row.id);
  const staging = { ...context, generation: 2 };
  indexes.storeIndexValue(db, staging, { family: 'ideas', entityId: idea.global_id, textHash: 'new', vector: [0, 1, 0], contract: indexes.contractForProfile(profile, 3) });
  assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [1, 0, 0]);
  db.prepare("UPDATE embedding_indexes SET preparation='paused' WHERE id=?").run(row.id);
  assert.throws(() => indexes.commitEmbeddingIndex(db, staging), /activation_superseded/);
  assert.deepEqual(ideas.getIdea(idea.global_id).embedding, [1, 0, 0]);
});

test('shared documentary vectors are collected only after the last index releases them; citation text survives', () => {
  const { DocumentaryStore } = require('../electron/db/documentaryStore.ts');
  const refs = require('../electron/db/embeddingDocumentaryRefs.ts');
  const shared = new DocumentaryStore(path.join(scratch, 'reference-test.sqlite'));
  try {
    const profile = indexes.embeddingProfile(settings.getSettings(), { provider: 'openai', model: 'shared-model' });
    const a = indexes.indexContext(db, indexes.createIndex(db, profile));
    const b = indexes.indexContext(db, indexes.createIndex(db, profile));
    const identity = { documentId: 'shared-source', attachmentId: null, revision: '1', textFingerprint: 'text', chunkerVersion: '1', processingVersion: '1',
      embedding: { provider: 'openai', model: 'shared-model', dimensions: 2, metric: 'cosine', parameters: { embeddingProfile: indexes.profileFingerprint(profile) } } };
    const key = shared.enqueue(identity, {});
    const job = shared.claim();
    shared.saveChunks(job, [{ text: 'Citable evidence', pageLabel: '1', pageNumber: 1, sourceRef: 'source' }]);
    shared.publishLexical(job); shared.publishEmbeddings(job, [[1, 0]]);
    refs.recordDocumentaryIndexReference(db, shared.db, 'vault-a', a, key, 'shared-source');
    refs.recordDocumentaryIndexReference(db, shared.db, 'vault-b', b, key, 'shared-source');
    indexes.deleteIndex(db, a.indexId); refs.releaseDocumentaryIndexReferences(shared.db, 'vault-a', a.indexId);
    assert.equal(shared.revision(key).embedding_ready, 1, 'the other vault retains its vectors');
    indexes.deleteIndex(db, b.indexId); refs.releaseDocumentaryIndexReferences(shared.db, 'vault-b', b.indexId);
    assert.equal(shared.revision(key).embedding_ready, 0);
    assert.equal(shared.db.prepare('SELECT vector FROM documentary_passages WHERE index_key=?').get(key).vector, null);
    assert.equal(shared.db.prepare('SELECT text FROM documentary_passages WHERE index_key=?').get(key).text, 'Citable evidence');
  } finally { shared.close(); }
});
