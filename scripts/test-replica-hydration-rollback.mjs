// Connecting to a space whose first pull fails leaves no empty "connected" vault behind.
//
// createConnectedVault creates the vault, pulls, and is meant to roll the vault back when that
// first hydration fails. pullReplica never throws, though: it records the failure on the
// replica's runtime and returns. So the rollback never ran, the sign-in reported success, and
// the user was left with a connected vault that held nothing (here: a publication from a
// newer schema, which this build refuses).
//
// No network: fetch is replaced by a fake server.
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
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-hydration-rollback')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-replica-hydration-rollback-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { listVaults } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));

test.after(async () => {
  replica.stopReplicaSync();
  await rm(userData, { recursive: true, force: true });
});

test('a first pull that fails rolls the new connected vault back and says why', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/v1/auth/device')) {
      return Response.json({ deviceToken: 'device-token', role: 'reader', space: { id: 'space-1', name: 'Espacio', vault: { type: 'academic' } } });
    }
    if (target.endsWith('/snapshot')) {
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, revision: 'rev-new', tables: {} })));
      return new Response(body, { status: 200, headers: { 'x-nodus-revision': 'rev-new' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const before = listVaults().filter((vault) => vault.origin === 'connected').length;
    await assert.rejects(
      replica.createConnectedVault({
        url: 'https://sync.invalid', ticket: 'ticket', userEmail: 'a@example.test', serverName: 'Servidor',
        space: { id: 'space-1', name: 'Espacio', description: '', role: 'reader', vault: null, updatedAt: null, hasSnapshot: true },
      }),
      /esquema más reciente/,
      'connecting reported success over a vault that could not be hydrated',
    );
    assert.equal(listVaults().filter((vault) => vault.origin === 'connected').length, before, 'an empty connected vault was left behind');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
