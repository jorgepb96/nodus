import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { withServer } from './lib/nodusServerHarness.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { encodeVectorSet, decodeVectorSet, searchVectors } from '../server/lib/core/vectors.mjs';

test('disposable server locks the full EmbeddingGemma contract, including same-dimension prompt changes', { timeout: 60000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-eg2-server-'));
  try {
    const file = path.join(temporary, 'contract.mjs');
    await build({ entryPoints: ['shared/embeddingGemma2.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    const { embeddingGemma2Contract } = await import(pathToFileURL(file));
    const contract = embeddingGemma2Contract('embeddinggemma-2-text-q8-512-v1');
    const vector = Array.from({ length: 512 }, (_, index) => Math.sin(index + .5));
    const other = Array.from({ length: 512 }, (_, index) => Math.cos(index + .3));
    const metadata = { kind: 'ideas', provider: 'nodus', model: contract.model, dim: contract.dim, embeddingContract: contract };
    const payload = encodeVectorSet({ ...metadata, entries: [{ id: 'i-a', vector }, { id: 'i-b', vector: other }] });
    const decoded = decodeVectorSet(payload);
    assert.deepEqual(decoded.header.embeddingContract, contract);
    const hits = searchVectors(decoded, vector, { limit: 2 });
    assert.equal(hits[0].id, 'i-a'); assert(hits[0].score > .99, 'int8 transport preserves nearest result');
    await withServer({ label: 'embeddinggemma-contract' }, async server => {
      const spaceId = await server.createSpace('Disposable EmbeddingGemma QA');
      await server.setPublicationPolicy(spaceId, ['allowVectors']);
      const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
      await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());
      const upload = body => server.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/vectors?kind=ideas`, { body });
      assert.equal((await upload(payload)).status, 200);
      const inconsistent = await upload(encodeVectorSet({ ...metadata, embeddingContract: { ...contract, dim: 256 }, entries: [{ id: 'i-a', vector }] }));
      assert.equal(inconsistent.status, 400, 'contract dimension must match the binary vector header');
      const changed = { ...contract, task: { ...contract.task, query: 'query: incompatible prompt' } };
      const refused = await upload(encodeVectorSet({ ...metadata, embeddingContract: changed, entries: [{ id: 'i-a', vector }] }));
      assert.equal(refused.status, 409); assert.equal((await refused.json()).error, 'embedding_contract_locked');
      const query = embeddingContract => server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/search/semantic`, {
        json: { kind: 'ideas', vector, provider: 'nodus', model: contract.model, dim: 512, embeddingContract, limit: 2, query: 'archivo' },
      });
      const compatible = await (await query(contract)).json();
      assert.equal(compatible.indexed, true); assert.equal(compatible.results[0].id, 'i-a');
      const mismatch = await (await query(changed)).json(); assert.equal(mismatch.indexed, false); assert.equal(mismatch.fallback, 'lexical');
      const missing = await (await query(undefined)).json(); assert.equal(missing.indexed, false, 'dimensions and model alone do not unlock a full contract');
    });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
