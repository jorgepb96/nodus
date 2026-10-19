import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublication } from '../cloudflare/src/publications.mjs';
import { upsertVectorChunk, semanticSearch } from '../cloudflare/src/vectors.mjs';
const contract = endpoint => ({ provider: 'ollama', model: 'same-name', dim: 2, protocol: 'nodus.embedding.local.v1', task: 'retrieval', preprocessing: { endpoint }, normalization: 'l2', quantization: 'float32', configVersion: 1 });
const expected = { kind: 'ideas', indexId: 'index-a', generation: 2, provider: 'ollama', model: 'same-name', dimensions: 2, embeddingContract: contract('http://local-a/v1'), mode: 'vectorize', count: 1 };
const manifest = { embeddingIndex: { id: 'index-a', generation: 2 }, vectors: [expected] };
function environment() {
  let writes = 0, queries = 0;
  const publication = { id: 'publication', generation: 7, manifest_json: JSON.stringify(manifest) };
  const DB = { prepare(sql) { return { bind() { return this; }, async first() {
    if (sql.includes('FROM publications')) return publication;
    if (sql.includes('FROM spaces')) return { id: 'vault', active_generation: 7 };
    if (sql.includes('FROM vector_sets')) return { ...expected, vector_count: 1, index_binding: 'VECTORS_2' };
    if (sql.includes('COUNT(*)')) return { count: 1 };
    return null;
  }, async all() { return { results: [] }; }, async run() { writes++; return {}; } }; }, async batch() { writes++; return []; } };
  return { env: { DB, VECTORS_2: { async upsert() { writes++; }, async query() { queries++; return { matches: [] }; } } }, counts: () => ({ writes, queries }) };
}
test('Cloudflare rejects mixed index generations and endpoints before any vector write', async () => {
  for (const patch of [{ generation: 1 }, { indexId: 'other' }, { embeddingContract: contract('http://local-b/v1') }]) {
    const { env, counts } = environment();
    await assert.rejects(() => upsertVectorChunk(env, { space_id: 'vault' }, new Request('https://offline.example/vectors', { method: 'PUT', body: JSON.stringify({ ...expected, vectors: [{ id: 'idea', values: [1, 0] }], chunkId: 'a'.repeat(64), ...patch }) }), 'publication', 'ideas'), error => error.code === 'embedding_index_mismatch');
    assert.deepEqual(counts(), { writes: 0, queries: 0 });
  }
  const { env, counts } = environment();
  const result = await semanticSearch(env, { space_id: 'vault' }, { kind: 'ideas', provider: 'ollama', model: 'same-name', dim: 2, vector: [1, 0], query: 'evidence', embeddingContract: contract('http://local-b/v1') });
  assert.equal(result.indexed, false);
  assert.equal(counts().queries, 0, 'incompatible queries never reach Vectorize');
  const matched = await semanticSearch(env, { space_id: 'vault' }, { kind: 'ideas', provider: 'ollama', model: 'same-name', dim: 2, vector: [1, 0], embeddingContract: expected.embeddingContract });
  assert.equal(matched.indexed, true);
  assert.equal(counts().queries, 1);
});
test('Cloudflare cannot declare two contracts as one active index', async () => {
  const { env, counts } = environment();
  await assert.rejects(() => createPublication(env, { space_id: 'vault' }, new Request('https://offline.example/publications', { method: 'POST', body: JSON.stringify({ ...manifest, protocolVersion: 3, revision: 'a'.repeat(64), counts: {}, vectors: [expected, { ...expected, kind: 'documents', embeddingContract: contract('http://local-b/v1') }] }) })), error => error.code === 'embedding_index_mismatch');
  assert.equal(counts().writes, 0);
});
