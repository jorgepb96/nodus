// A relay failure after a snapshot was applied must not re-download the snapshot every tick.
//
// pullReplica applied the snapshot, then pulled the relay, and only recorded the snapshot's
// revision after both. When the relay threw (a world image or a Yjs update the server could
// not hand over), the revision stayed unrecorded, so every thirty-second retry asked with the
// old ETag and received — and re-applied — the whole publication again, for as long as that
// one mutation kept failing.
//
// No network: fetch is replaced by a fake that honours If-None-Match like the real server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-relay-failure')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-replica-relay-failure-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { createVault, getVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const { setNodusServerTokenFor } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));

test.after(async () => {
  replica.stopReplicaSync();
  await rm(userData, { recursive: true, force: true });
});

test('the applied snapshot is recorded even when the relay that follows it fails', async () => {
  const vault = createVault('Réplica', 'academic', {
    origin: 'connected',
    remote: {
      serverKind: 'classic', url: 'https://sync.invalid', spaceId: 'space-1', spaceName: 'Espacio',
      serverName: 'Servidor', userEmail: 'a@example.test', role: 'reader', state: 'active',
      lastPulledRevision: null, lastPulledAt: null,
    },
  });
  setNodusServerTokenFor(vault.id, 'device-token');

  const revision = 'rev-1';
  let fullDownloads = 0;
  let relayPolls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/snapshot')) {
      const tag = `W/"${revision}"`;
      if (init.headers?.['if-none-match'] === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      fullDownloads += 1;
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ schemaVersion: SCHEMA_VERSION, revision, tables: {} })));
      return new Response(body, { status: 200, headers: { etag: tag, 'x-nodus-revision': revision } });
    }
    if (target.includes('/mutations?')) {
      relayPolls += 1;
      // A collaborator's world image whose bytes the server cannot hand over right now.
      return Response.json({ mutations: [{ id: 'm-1', seq: 1, kind: 'upsert', table: 'world_images', key: ['img-1'], row: { image_id: 'img-1' }, assets: [{ hash: 'a'.repeat(64) }] }], hasMore: false });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  try {
    for (let tick = 0; tick < 3; tick += 1) await replica.pullReplica(vault.id);
    assert.equal(relayPolls, 3, 'the relay is retried on every tick');
    assert.equal(fullDownloads, 1, `an unchanged publication was downloaded ${fullDownloads} times because the relay after it failed`);
    assert.equal(getVault(vault.id).remote.lastPulledRevision, revision);
    assert.equal(replica.getReplicaOverview()[0].phase, 'error', 'the relay failure is still reported');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
