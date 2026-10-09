// A desktop writer's image rows travel with their bytes, the way every receiver requires.
//
// world_images, map_images and decorative_images are writable from a replica. Their bytes
// never ride inside a mutation; a receiver fetches them by the hash in `mutation.assets`. The
// owner's inbox (inboxPoller hydrateImageMutations) and other replicas (pullRelayOperations)
// THROW on such a row without that hash, and neither acknowledges past a throw. drainOutbox
// sent these rows with the bytes stripped and no `assets`, which the server accepts (it only
// checks the assets a mutation names), so one image edited on a desktop replica stopped the
// owner from collecting anything after it, from anyone, permanently.
//
// No network: fetch is replaced by a fake server with an asset store.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-outbox-images')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-outbox-images-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { createVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const { setNodusServerTokenFor } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));
const { ensureOutboxTriggers } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));

test.after(async () => {
  replica.stopReplicaSync();
  await rm(userData, { recursive: true, force: true });
});

test('an image added on a writer replica is uploaded and named in the mutation', async () => {
  const vault = createVault('Mundo', 'worldbuilding', {
    origin: 'connected',
    remote: {
      serverKind: 'classic', url: 'https://sync.invalid', spaceId: 'space-1', spaceName: 'Mundo',
      serverName: 'Servidor', userEmail: 'a@example.test', role: 'writer', state: 'active',
      lastPulledRevision: null, lastPulledAt: null,
    },
  });
  setNodusServerTokenFor(vault.id, 'device-token');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('retrato de prueba')]);
  const db = new Database(vault.path, { fileMustExist: true });
  ensureOutboxTriggers(db, true);
  db.prepare(`INSERT INTO world_images (image_id, entity_kind, entity_id, kind, label, mime_type, bytes, blob, created_at, updated_at)
    VALUES ('img-1', 'character', 'c-1', 'portrait', 'Retrato', 'image/png', ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`)
    .run(png.length, png);

  const assetsOnServer = new Map();
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const asset = target.match(/\/assets\/([0-9a-f]{64})$/);
    if (asset && init.method === 'HEAD') return new Response(null, { status: assetsOnServer.has(asset[1]) ? 200 : 404 });
    if (asset && init.method === 'POST') {
      assetsOnServer.set(asset[1], Buffer.from(init.body));
      return Response.json({ ok: true });
    }
    if (target.endsWith('/mutations') && init.method === 'POST') {
      const { mutations } = JSON.parse(String(init.body));
      sent.push(...mutations);
      return Response.json({ accepted: mutations.map((mutation) => mutation.id), duplicate: [], rejected: [] });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  try {
    await replica.drainOutbox(vault.id);
    const image = sent.find((mutation) => mutation.table === 'world_images');
    assert.ok(image, 'the image row was not sent at all');
    const hash = createHash('sha256').update(png).digest('hex');
    assert.deepEqual(image.assets, [{ hash }], 'the row went out without the asset hash every receiver requires');
    assert.ok(assetsOnServer.get(hash)?.equals(png), 'the bytes were never uploaded');
    assert.equal(image.row.blob, undefined, 'bytes still never ride inside the mutation');
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
