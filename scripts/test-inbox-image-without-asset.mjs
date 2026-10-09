// An image mutation that names no asset is refused, not left to block the owner's inbox.
//
// The owner's inbox fetches an image row's bytes by the hash in `mutation.assets`. A row
// without one (what desktop replicas sent before they uploaded their images) made
// hydrateImageMutations throw, the tick aborted without acknowledging, and every later
// mutation from every collaborator sat in the ledger unapplied, with nothing in the inbox.
// It is deterministic, so it is now refused and acknowledged like any other poison row.
//
// Runs the real desktop modules against a real Nodus Server process on loopback.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-inbox-image-without-asset')) {
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-inbox-image-asset-'));
const workerFixture = path.join(userData, 'serverPublishWorker.js');
fs.writeFileSync(workerFixture, '// Existence check for the utility-process host.');
process.env.NODUS_SERVER_PUBLISH_WORKER_FILE = workerFixture;

// This suite exercises inbox and status behaviour, not snapshot construction. Preserve the
// production boundary by answering through the utilityProcess contract instead of enabling
// a main-process fallback in serverSyncService.
class FakePublishUtility extends EventEmitter {
  postMessage(request) {
    const raw = Buffer.from(JSON.stringify({
      format: 'nodus.server-snapshot',
      formatVersion: 2,
      revision: 'inbox-test-revision',
      generatedAt: new Date().toISOString(),
      vault: request.vault,
      schemaVersion: 0,
      assets: [],
      library: null,
      tables: {},
    }));
    queueMicrotask(() => this.emit('message', {
      kind: 'done',
      id: request.id,
      compressed: gzipSync(raw),
      rawBytes: raw.length,
      revision: 'inbox-test-revision',
      counts: {},
      assets: [],
      schemaVersion: 0,
      vectors: [],
    }));
  }
  kill() { return true; }
}

installRuntimeHooks(userData, {
  utilityProcess: { fork: () => new FakePublishUtility() },
});

const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const { setNodusServerToken } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const { listServerInbox, unreadServerInboxCount } = require(path.join(repoRoot, 'electron/db/serverInboxRepo.ts'));
const { drainServerInboxNow } = require(path.join(repoRoot, 'electron/serverSync/inboxPoller.ts'));
const { getNodusServerOverview, syncNodusServerVaultNow } = require(path.join(repoRoot, 'electron/serverSync/serverSyncService.ts'));
const { getActiveVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));

const STAMP = '2026-08-04T09:00:00.000Z';

/** The row a phone sends for a finished report. */
function reportRow(id, title, objective) {
  return {
    id,
    title,
    brief_json: JSON.stringify({ kind: 'deep_research', objective, language: 'es' }),
    selection_json: JSON.stringify({ ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [] }),
    model_json: null,
    draft_json: JSON.stringify({ title, draftMarkdown: '# Informe\n\nEscrito en el teléfono.' }),
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function reportMutation(mutationId, row, overrides = {}) {
  return {
    id: mutationId,
    clientId: 'iphone-de-jorge',
    kind: 'upsert',
    table: 'writing_saved_drafts',
    key: [row.id],
    row,
    schemaVersion: SCHEMA_VERSION,
    createdAt: STAMP,
    ...overrides,
  };
}

test.after(async () => { await rm(userData, { recursive: true, force: true }); });

test('an image row without an asset is refused and the mutations after it are applied', { timeout: 120_000 }, async () => {
  await withServer({ label: 'owner-hol' }, async (server) => {
    const spaceId = await server.createSpace('Mundo');
    await server.createUser('escritor@example.test', 'escritor-account-password', [{ spaceId, role: 'writer' }]);
    const writer = await server.deviceToken('escritor@example.test', 'escritor-account-password', spaceId, 'Desktop replica');
    const desktop = await server.pair(await server.pairingCode(spaceId), 'Nodus Desktop');
    setNodusServerToken(desktop.accessToken);
    updateSettings({ nodusServerUrl: server.origin, nodusServerSpaceId: spaceId, nodusServerSpaceName: 'Mundo', nodusServerEnabled: true, nodusServerAutoSync: false });
    // Exactly what drainOutbox sent for a world image: bytes stripped, no `assets`.
    const imageRow = { image_id: 'img-1', entity_kind: 'character', entity_id: 'c-1', kind: 'portrait', label: 'Retrato', mime_type: 'image/png', bytes: 25, created_at: STAMP, updated_at: STAMP };
    const sent = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [
      { id: 'm-image', clientId: 'replica', kind: 'upsert', table: 'world_images', key: ['img-1'], row: imageRow, schemaVersion: SCHEMA_VERSION, createdAt: STAMP },
      reportMutation('m-report', reportRow('dr-1', 'Informe posterior', 'Llega después')),
    ] } });
    assert.equal(sent.status, 200);
    for (let i = 0; i < 2; i++) await drainServerInboxNow();
    assert.ok(getDb().prepare("SELECT id FROM writing_saved_drafts WHERE id = 'dr-1'").get(), 'the report sent after the image never reached the owner');
    const remaining = await (await server.api(desktop.accessToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json();
    assert.deepEqual(remaining.mutations.map((m) => m.id), [], 'the ledger is stuck behind the image row');
    const refused = listServerInbox().find((entry) => entry.id === 'm-image');
    assert.equal(refused?.outcome, 'refused', 'the image row is reported to the owner');
  });
});
