import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticReadQuery, contextReadQuery } from '../server/lib/core/corpusQueries.mjs';
import { decodeVectorSet, encodeVectorSet } from '../server/lib/core/vectors.mjs';
import { migrateLegacyVectorV1Header, fingerprintEmbeddingContract } from '../server/lib/core/embeddingContract.mjs';
import { academicSnapshot } from './lib/nodusServerFixtures.mjs';
const snapshot = academicSnapshot().payload;
const set = decodeVectorSet(encodeVectorSet({ kind: 'ideas', provider: 'fixture', model: 'model', dim: 2,
  entries: [{ id: 'i-a', vector: [1, 0] }, { id: 'i-b', vector: [0, 1] }] }));
const contract = migrateLegacyVectorV1Header(set.header);
const locked = { contract, fingerprint: fingerprintEmbeddingContract(contract) };

test('identity probes report the actual Mac index and lexical fallback remains explicit', async () => {
  const result = await semanticReadQuery(snapshot, { query: 'tesis', provider: 'probe', model: 'probe', dim: 0 }, set, locked);
  assert.equal(result.status, 200); assert.equal(result.body.reason, 'provider_mismatch');
  assert.deepEqual({ provider: result.body.expected.provider, model: result.body.expected.model, dim: result.body.expected.dim }, { provider: 'fixture', model: 'model', dim: 2 });
  assert.equal(result.body.fallback, 'lexical'); assert.equal(result.body.indexed, false); assert(result.body.warning);
  const absent = await semanticReadQuery(snapshot, { query: 'tesis' }, null);
  assert.equal(absent.body.reason, 'no_vectors'); assert.equal(absent.body.indexed, false);
  assert(absent.body.warning); assert(Array.isArray(absent.body.results));
});

test('compatible queries rank the real vectors and retain complete source rows', async (t) => {
  // Production has a listening HTTP host; this standalone test retains an equivalent
  // event-loop handle while the intentionally unreferenced worker finishes.
  const host = setInterval(() => {}, 1000); t.after(() => clearInterval(host));
  const result = await semanticReadQuery(snapshot, { kind: 'ideas', provider: 'fixture', model: 'model', dim: 2, vector: [1, 0], limit: 1 }, set, locked);
  assert.equal(result.status, 200); assert.equal(result.body.indexed, true);
  assert.equal(result.body.results.length, 1); assert.equal(result.body.results[0].id, 'i-a');
  assert.equal(result.body.results[0].row.global_id, 'i-a'); assert(result.body.results[0].score > 0.99);
  const exact = await semanticReadQuery(snapshot, { kind: 'ideas', embeddingContract: contract, vector: [1, 0], limit: 1 }, set, locked);
  assert.deepEqual(exact.body.results, result.body.results);
});

test('invalid vector kinds, dimensions and non-finite values fail explicitly', async () => {
  const identity = { provider: 'fixture', model: 'model', dim: 2 };
  for (const vector of [[1], [1, NaN], [1, Infinity], [1, '0']]) {
    const result = await semanticReadQuery(snapshot, { ...identity, vector }, set, locked);
    assert.equal(result.status, 400); assert.equal(result.body.error, 'bad_vector');
  }
  const result = await semanticReadQuery(snapshot, { ...identity, kind: '../../private' }, set, locked);
  assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_vector_kind');
});

test('context uses the same source-backed retrieval and bounded budget on both transports', () => {
  const result = contextReadQuery(snapshot, { query: 'tesis', include: ['ideas'], budget: 1000 }, 'mac-revision');
  assert.equal(result.status, 200); assert.equal(result.body.revision, 'mac-revision');
  assert.equal(result.body.stats.budget, 1000); assert(result.body.stats.chars <= 1000);
  assert(result.body.sections.every(section => section.kind === 'ideas'));
  for (const section of result.body.sections) for (const row of section.items) assert(row.global_id);
  assert.equal(result.body.citationScheme.idea, 'nodus://idea/<global_id>');
  assert.equal(result.body.documentProfilePolicy, 'orientation_only');
  assert.equal(contextReadQuery(snapshot, { budget: 1e12 }, 'r').body.stats.budget, 600_000);
});
