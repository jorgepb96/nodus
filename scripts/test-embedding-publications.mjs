import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { Store } from '../server/lib/store.mjs';
import { EmbeddingPublications } from '../server/lib/embeddingPublications.mjs';
import { encodeVectorSet, decodeVectorSet } from '../server/lib/core/vectors.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contract = model => ({ provider: 'openai', model, dim: 3, protocol: 'test/1', task: 'retrieval', preprocessing: {}, normalization: 'none', quantization: 'float32', configVersion: 1 });
function vectorWire(id, model, generation = 1) {
  return gzipSync(encodeVectorSet({ kind: 'ideas', provider: 'openai', model, dim: 3, embeddingContract: contract(model),
    indexId: id, generation, entries: [{ id: 'i-a', vector: [1, 0, 0] }] }));
}
function publication(id, model, none = false) {
  const payload = { ...academicSnapshot().payload, embeddingIndex: none ? null : { id, generation: 1, valueRevision: 1 } };
  const snapshot = gzipSync(Buffer.from(JSON.stringify(payload)));
  const vector = none ? null : vectorWire(id, model);
  return { snapshot, vector, manifest: { revision: `${id}-revision`, snapshotHash: hash(snapshot), index: none ? null : { id, generation: 1 }, vectors: vector ? [{ kind: 'ideas', hash: hash(vector) }] : [] } };
}
const validate = bytes => ({ ...JSON.parse(gunzipSync(bytes)), provenance: { publishedAt: '2026-10-19T10:00:00.000Z' } });

test('an incomplete upload or failed head save preserves the previous complete publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-publication-'));
  try {
    const store = new Store(root);
    const space = { id: 'space', revision: 'previous' };
    store.state.spaces.push(space); store.save();
    store.writeSnapshot(space.id, gzipSync(Buffer.from('{"previous":true}')));
    const service = new EmbeddingPublications(store);
    const next = publication('index-b', 'model-b');
    const session = service.begin(space, next.manifest, 'owner');
    service.stageSnapshot(space, session.id, 'owner', next.snapshot);
    assert.throws(() => service.commit(space, session.id, 'owner', validate, gzipSync), /publication_incomplete/);
    assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(store.snapshotPath(space.id)))), { previous: true });
    assert.throws(() => service.stageVectors(space, session.id, 'other-owner', 'ideas', next.vector, gunzipSync), /owner_mismatch/);
    service.stageVectors(space, session.id, 'owner', 'ideas', next.vector, gunzipSync);
    const save = store.save.bind(store);
    store.save = () => { throw new Error('disk full'); };
    assert.throws(() => service.commit(space, session.id, 'owner', validate, gzipSync), /disk full/);
    assert.equal(space.revision, 'previous'); assert.equal(space.embeddingPublication, undefined);
    store.save = save;
    service.commit(space, session.id, 'owner', validate, gzipSync);
    assert.throws(() => service.stageSnapshot(space, session.id, 'owner', next.snapshot), /already_sealed/);
    assert.throws(() => service.stageVectors(space, session.id, 'owner', 'ideas', next.vector, gunzipSync), /already_sealed/);
    const reopened = new Store(root);
    assert.equal(JSON.parse(gunzipSync(fs.readFileSync(reopened.snapshotPath(space.id)))).embeddingIndex.id, 'index-b');
    assert.equal(decodeVectorSet(fs.readFileSync(reopened.vectorsPath(space.id, 'ideas'))).header.model, 'model-b');
    const empty = publication('without-index', '', true);
    const cleared = service.begin(space, empty.manifest, 'owner');
    service.stageSnapshot(space, cleared.id, 'owner', empty.snapshot);
    service.commit(space, cleared.id, 'owner', validate, gzipSync);
    assert.equal(fs.existsSync(store.vectorsPath(space.id, 'ideas')), false, 'publishing no active index retires the previous vectors');
    assert.deepEqual(space.embeddingContracts, {});
    assert.throws(() => service.stageSnapshot(space, session.id, 'owner', next.snapshot), /already_sealed/, 'replaced publications remain immutable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the HTTP publication API commits the snapshot and model together and supports removal', { timeout: 60_000 }, async () => {
  await withServer({ label: 'embedding-publications' }, async server => {
    const spaceId = await server.createSpace('Saved embeddings');
    await server.setPublicationPolicy(spaceId, ['allowVectors']);
    const { deviceToken } = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, deviceToken, spaceId, academicSnapshot());
    const base = `/api/v1/spaces/${spaceId}/embedding-publications`;
    const next = publication('model-b-index', 'model-b');
    const created = await server.api(deviceToken, 'POST', base, { json: next.manifest });
    assert.equal(created.status, 200, await created.clone().text());
    const session = await created.json();
    assert.equal((await server.api(deviceToken, 'PUT', `${base}/${session.id}/snapshot`, { body: next.snapshot })).status, 200);
    assert.equal((await server.api(deviceToken, 'POST', `${base}/${session.id}/commit`, { json: {} })).status, 409);
    assert.equal((await server.readState()).spaces.find(space => space.id === spaceId).embeddingPublication, undefined);
    assert.equal((await server.api(deviceToken, 'PUT', `${base}/${session.id}/vectors/ideas`, { body: next.vector })).status, 200);
    const committed = await server.api(deviceToken, 'POST', `${base}/${session.id}/commit`, { json: {} });
    assert.equal(committed.status, 200, await committed.clone().text());
    const state = (await server.readState()).spaces.find(space => space.id === spaceId);
    assert.equal(state.embeddingPublication, session.id);
    assert.equal(state.embeddingContracts.ideas.contract.model, 'model-b');
    const query = await server.api(deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
      json: { query: 'archivo', vector: [1, 0, 0], provider: 'openai', model: 'model-b', dim: 3, embeddingContract: contract('model-b') },
    });
    assert.equal(query.status, 200, await query.clone().text());
    assert.equal((await query.json()).indexed, true);
    const oldPublisher = await server.api(deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/snapshot`, {
      body: academicSnapshot().gzipped, headers: { 'content-encoding': 'gzip' },
    });
    assert.equal(oldPublisher.status, 409, 'a legacy upload cannot split the committed bundle');
    const empty = publication('deleted-index', '', true);
    const clearSession = await (await server.api(deviceToken, 'POST', base, { json: empty.manifest })).json();
    assert.equal((await server.api(deviceToken, 'PUT', `${base}/${clearSession.id}/snapshot`, { body: empty.snapshot })).status, 200);
    assert.equal((await server.api(deviceToken, 'POST', `${base}/${clearSession.id}/commit`, { json: {} })).status, 200);
    const unindexed = await (await server.api(deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, { json: { query: 'archivo', vector: [1, 0, 0], provider: 'openai', model: 'model-b', dim: 3 } })).json();
    assert.equal(unindexed.indexed, false);
  });
});
