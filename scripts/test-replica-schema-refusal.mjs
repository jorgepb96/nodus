// A replica refusing a newer-schema publication refuses it once, not every thirty seconds.
//
// Migration 201 is enough to make every older build refuse a publication from a 201 desktop.
// The refusal itself is right; how it happened was not. The snapshot request carries the last
// APPLIED revision as its ETag, so after a refusal the server kept answering with the whole
// snapshot (36.7 MiB gzipped on a real academic library), which the replica gunzipped and
// parsed on the main thread before refusing it again — on every tick, indefinitely.
//
// No network: fetch is replaced by a fake that honours If-None-Match the way the server does
// (server/lib/routes/api.mjs getSnapshot).
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
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-schema-refusal')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-replica-schema-refusal-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { createVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const { setNodusServerTokenFor } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));

test.after(async () => {
  replica.stopReplicaSync();
  await rm(userData, { recursive: true, force: true });
});

test('a newer-schema snapshot is downloaded once, refused, and then answered by 304', async () => {
  const vault = createVault('Réplica', 'academic', {
    origin: 'connected',
    remote: {
      serverKind: 'classic', url: 'https://sync.invalid', spaceId: 'space-1', spaceName: 'Espacio',
      serverName: 'Servidor', userEmail: 'a@example.test', role: 'writer', state: 'active',
      lastPulledRevision: 'rev-old', lastPulledAt: null,
    },
  });
  setNodusServerTokenFor(vault.id, 'device-token');

  const published = { revision: 'rev-newer', schemaVersion: SCHEMA_VERSION + 1 };
  let fullDownloads = 0;
  let relayCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/snapshot')) {
      const tag = `W/"${published.revision}"`;
      if (init.headers?.['if-none-match'] === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      fullDownloads += 1;
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ schemaVersion: published.schemaVersion, revision: published.revision, tables: {} })));
      return new Response(body, { status: 200, headers: { etag: tag, 'x-nodus-revision': published.revision } });
    }
    if (target.includes('/mutations')) relayCalls += 1;
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  try {
    for (let tick = 0; tick < 3; tick += 1) await replica.pullReplica(vault.id);
    await replica.syncReplicaNow(vault.id);
    assert.equal(fullDownloads, 1, `the refused snapshot was downloaded ${fullDownloads} times`);
    const [overview] = replica.getReplicaOverview();
    assert.equal(overview.phase, 'error');
    assert.match(overview.lastError, /esquema más reciente/, 'the refusal stays explained');
    assert.equal(relayCalls, 0, 'nothing is applied around a refused publication');

    // Once the owner publishes something this build can read, it is fetched and applied.
    Object.assign(published, { revision: 'rev-readable', schemaVersion: SCHEMA_VERSION });
    await replica.pullReplica(vault.id);
    assert.equal(fullDownloads, 2);
    assert.equal(replica.getReplicaOverview()[0].phase, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
