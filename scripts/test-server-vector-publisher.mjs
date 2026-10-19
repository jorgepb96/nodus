// The desktop half of semantic search.
//
// The server had the endpoint, the decoder, the search and an honest "no vectors here"
// fallback — and nothing ever sent it a matrix. Semantic search could never have worked in
// production, and the fallback made that look like a normal state rather than a hole.
//
// These pin the encoder against the decoder that consumes it, so the two cannot drift, and
// pin the two decisions that make the format safe: only one embedding model per matrix, and
// a corrupt row skipped rather than shifting every vector after it.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { decodeVectorSet, embeddingMatches, searchVectors } from '../server/lib/core/vectors.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-server-vector-publisher.mjs'), '--electron-vector-publisher')) {
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-vector-publisher-'));
installRuntimeHooks(root);

const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { buildVectorSet, describeVectorSet, vectorRevision } = require(path.join(repoRoot, 'electron/serverSync/serverVectors.ts'));
const Database = require('better-sqlite3');
const indexes = require(path.join(repoRoot, 'electron/db/embeddingIndexesRepo.ts'));

/** Deterministic vectors: a failure has to be reproducible. */
function pseudoVector(seed, dim) {
  const vector = new Float32Array(dim);
  let state = (seed * 2654435761) % 4294967296;
  for (let index = 0; index < dim; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    vector[index] = (state / 2147483648) * 2 - 1;
  }
  return vector;
}
const encode = (vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
const cosine = (a, b) => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

function seed(db, dim, count, provider = 'openrouter', model = 'baai/bge-m3', prefix = 'i') {
  const profile = indexes.embeddingProfile({ embeddingProvider: provider, embeddingModel: model, localProviders: {} });
  const saved = db.prepare('SELECT * FROM embedding_indexes WHERE fingerprint=?').get(indexes.profileFingerprint(profile)) ?? indexes.createIndex(db, profile);
  const context = indexes.indexContext(db, saved);
  if (!indexes.activeEmbeddingIndex(db)) {
    db.prepare('UPDATE embedding_index_state SET pending_id=?').run(saved.id);
    indexes.commitEmbeddingIndex(db, context);
  }
  const active = indexes.activeEmbeddingIndex(db).indexId === context.indexId;
  const insert = db.prepare(
    `INSERT INTO ideas (global_id, type, label, statement, created_at, embedding, embedding_provider, embedding_model, embedding_dim)
     VALUES (?, 'claim', ?, ?, '2026-01-01T00:00:00.000Z', ?, ?, ?, ?)`
  );
  const vectors = new Map();
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = `${prefix}-${String(index).padStart(4, '0')}`;
      const vector = pseudoVector(index + 1, dim);
      vectors.set(id, vector);
      insert.run(id, `Idea ${index}`, `Enunciado ${index}`, active ? encode(vector) : null, provider, model, dim);
      if (!active) indexes.storeIndexValue(db, context, { family: 'ideas', entityId: id, textHash: '', vector: Array.from(vector), contract: indexes.contractForProfile(profile, dim) });
    }
  })();
  return vectors;
}

test('what the desktop encodes is exactly what the server decodes', { timeout: 120_000 }, async () => {
  const db = new Database(path.join(root, 'vectors.sqlite'));
  try {
    runMigrations(db);
    const dim = 128;
    const vectors = seed(db, dim, 300);

    const summary = describeVectorSet(db, 'ideas');
    assert.equal(summary.count, 300);
    assert.equal(summary.dim, dim);
    assert.equal(summary.provider, 'openrouter');
    assert.equal(summary.model, 'baai/bge-m3');

    const built = buildVectorSet(db, 'ideas');
    // int8 plus an id table, against four bytes per dimension.
    assert.ok(built.buffer.length < 300 * dim * 4, 'the matrix is not smaller than float32');

    const set = decodeVectorSet(built.buffer);
    assert.equal(set.count, 300);
    assert.equal(set.dim, dim);
    assert.equal(set.header.quant, 'int8-l2');
    assert.equal(embeddingMatches(set.header, { provider: 'openrouter', model: 'baai/bge-m3', dim }), true);

    // A vector taken from the corpus finds itself, which is the end-to-end proof that the
    // encoder, the wire format and the search all agree on the layout.
    const [id, vector] = [...vectors][42];
    const hits = searchVectors(set, vector, { limit: 5 });
    assert.equal(hits[0].id, id, 'a corpus vector did not find itself');
    assert.ok(hits[0].score > 0.99, `self-similarity ${hits[0].score}`);

    // Ranking survives quantization: the top-10 should barely move against exact cosine.
    const query = pseudoVector(9_999, dim);
    const approximate = searchVectors(set, query, { limit: 10 }).map((hit) => hit.id);
    const exact = [...vectors]
      .map(([candidate, value]) => ({ id: candidate, score: cosine(query, value) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((hit) => hit.id);
    const overlap = approximate.filter((candidate) => exact.includes(candidate)).length;
    assert.ok(overlap >= 9, `top-10 overlap was ${overlap}/10`);

    db.prepare("INSERT INTO works(nodus_id,zotero_key,title) VALUES('w-doc','Z-DOC','Document')").run();
    db.prepare(`INSERT INTO document_profile_versions(
      version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,presentation_language,
      overview,profile_json,prompt_hash,created_at,published_at
    ) VALUES('profile-doc','w-doc','current','source','document-profile/1',1,'en','Overview','{}','prompt','2026-01-01','2026-01-01')`).run();
    const documentVector = pseudoVector(777, dim);
    db.prepare(`INSERT INTO document_vectors(
      vector_id,nodus_id,version_id,kind,source_id,text,text_hash,weight,embedding,
      embedding_provider,embedding_model,embedding_dim,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'doc-vector','w-doc','profile-doc','overview',null,'Overview','hash',1,encode(documentVector),
      'openrouter','baai/bge-m3',dim,'2026-01-01',
    );
    const documentSet = buildVectorSet(db, 'documents');
    assert.equal(documentSet.summary.count, 1);
    assert.equal(documentSet.summary.kind, 'documents');
    const decodedDocuments = decodeVectorSet(documentSet.buffer);
    assert.equal(decodedDocuments.header.kind, 'documents');
    assert.equal(searchVectors(decodedDocuments, documentVector, { limit: 1 })[0].id, 'doc-vector');
  } finally {
    db.close();
  }
});

test('publication follows the active index even when a saved index is larger, and corrupt writes are rejected', { timeout: 120_000 }, async () => {
  const db = new Database(path.join(root, 'mixed.sqlite'));
  try {
    runMigrations(db);
    seed(db, 64, 50, 'openrouter', 'baai/bge-m3');
    // A saved model may have more vectors. The explicit active head is authoritative.
    seed(db, 64, 75, 'openai', 'text-embedding-3-small', 'other');
    const built = buildVectorSet(db, 'ideas');
    const set = decodeVectorSet(built.buffer);
    assert.equal(set.header.model, 'baai/bge-m3');
    assert.equal(set.count, 50, 'the minority model leaked into the matrix');
    assert.equal(embeddingMatches(set.header, { provider: 'openai', model: 'text-embedding-3-small', dim: 64 }), false);

    // A blob whose length disagrees with the declared dimension is corrupt. Skipping it
    // matters: writing it anyway would shift every vector after it by a few bytes and
    // silently scramble the whole matrix.
    assert.throws(() => db.prepare(
      `INSERT INTO ideas (global_id, type, label, statement, created_at, embedding, embedding_provider, embedding_model, embedding_dim)
       VALUES ('i-broken', 'claim', 'Rota', '', '2026-01-01T00:00:00.000Z', ?, 'openrouter', 'baai/bge-m3', 64)`
    ).run(Buffer.alloc(17)), /dimension_mismatch|vector_invalid/);
    const after = decodeVectorSet(buildVectorSet(db, 'ideas').buffer);
    assert.equal(after.count, 50, 'a corrupt row entered the matrix');
    assert.ok(!after.ids.includes('i-broken'));

    // The fingerprint changes when the index does, so an unchanged one is never resent.
    const before = vectorRevision(db, 'ideas');
    seed(db, 64, 5, 'openrouter', 'baai/bge-m3', 'extra');
    assert.notEqual(vectorRevision(db, 'ideas'), before);
  } finally {
    db.close();
  }
});

test('a vault with no embeddings publishes nothing rather than an empty matrix', { timeout: 120_000 }, async () => {
  const db = new Database(path.join(root, 'empty.sqlite'));
  try {
    runMigrations(db);
    assert.equal(describeVectorSet(db, 'ideas'), null);
    assert.equal(buildVectorSet(db, 'ideas'), null);
    assert.equal(vectorRevision(db, 'ideas'), null);
    // An empty matrix would make the server claim it is indexed and answer every query
    // with nothing — the exact false negative the fallback exists to prevent.
  } finally {
    db.close();
  }
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });
