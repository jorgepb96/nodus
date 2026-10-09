// An edit made while the outgoing queue is on the wire must still be sent.
//
// The queue holds one pending entry per row and folds later edits into it. drainOutbox reads
// the live row, POSTs it, and then marks the entry sent by id. If the user edits the same row
// while that request is in flight, the trigger folds the newer edit into the SAME pending
// entry, and the acknowledgement for the older payload then marked the newer edit as sent: it
// never reached the server. The server also deduplicates by mutation id, so a re-send that
// reuses the id is answered "duplicate" and dropped the same way.
//
// No network: fetch is replaced by a fake that keeps the server's own rule (a ledger keyed by
// mutation id, server/lib/routes/api.mjs) and lets the test edit the row mid-request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-outbox-inflight')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-outbox-inflight-'));
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

test('an edit made during the POST stays queued and reaches the server on the next drain', async () => {
  const vault = createVault('Réplica', 'academic', {
    origin: 'connected',
    remote: {
      serverKind: 'classic', url: 'https://sync.invalid', spaceId: 'space-1', spaceName: 'Espacio',
      serverName: 'Servidor', userEmail: 'a@example.test', role: 'writer', state: 'active',
      lastPulledRevision: null, lastPulledAt: null,
    },
  });
  setNodusServerTokenFor(vault.id, 'device-token');

  const db = new Database(vault.path, { fileMustExist: true });
  ensureOutboxTriggers(db, true);
  db.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
    .run('n-1', 'Nota', 'markdown', 'primera versión', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z');

  // The fake server: a ledger keyed by mutation id, exactly the rule the real one applies.
  const ledger = new Map();
  let editDuringRequest = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/mutations') && init.method === 'POST') {
      const { mutations } = JSON.parse(String(init.body));
      if (editDuringRequest) {
        editDuringRequest = false;
        // The user keeps typing while the request is on the wire.
        db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
          .run('segunda versión', '2026-10-01T10:00:05.000Z', 'n-1');
      }
      const accepted = [];
      const duplicate = [];
      for (const mutation of mutations) {
        if (ledger.has(mutation.id)) duplicate.push(mutation.id);
        else { ledger.set(mutation.id, mutation); accepted.push(mutation.id); }
      }
      return new Response(JSON.stringify({ accepted, duplicate, rejected: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  try {
    await replica.drainOutbox(vault.id);
    const stillOwed = db.prepare("SELECT * FROM server_outbox WHERE state = 'pending' AND table_name = 'notes'").all();
    assert.equal(stillOwed.length, 1, 'the edit made during the request was marked sent without ever being sent');

    await replica.drainOutbox(vault.id);
    const notes = [...ledger.values()].filter((mutation) => mutation.table === 'notes');
    assert.equal(notes.at(-1)?.row?.content, 'segunda versión', 'the server never received the newer content');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM server_outbox WHERE state = 'pending'").get().n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
