// A snapshot must not bring back an authored row this replica deleted.
//
// Authored tables are merged into a replica row by row, and a row the replica does not hold
// is inserted. A snapshot is the owner's last publication, so until the owner collects the
// replica's delete and republishes, the snapshot still carries the row. "Sync now" (a forced
// pull) or any unrelated republish therefore re-inserted a note the user had just deleted,
// with the outbox suppressed, so nothing queued the deletion again. The owner then deleted
// it, republished without it, and the authored merge never removes a local row: the note
// stayed on the replica for good while every other copy had lost it.
//
// The .nodussync merge already consults the local tombstones for exactly this
// (syncPackage.ts mergeTable); the snapshot merge now applies the same rule.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-replica-snapshot-tombstones')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-replica-tombstones-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { ensureTombstoneTriggers } = require(path.join(repoRoot, 'electron/db/tombstones.ts'));
const { applySnapshotToReplica } = require(path.join(repoRoot, 'electron/serverSync/replicaApply.ts'));

test.after(async () => { await rm(userData, { recursive: true, force: true }); });

function noteRow(id, content, stamp) {
  return { id, folder_id: null, title: id, kind: 'markdown', content, source_json: null, order_idx: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: stamp };
}

test('a note deleted on the replica is not re-inserted by a snapshot that predates the deletion', () => {
  const db = new Database(path.join(userData, 'replica.sqlite'));
  try {
    runMigrations(db);
    ensureTombstoneTriggers(db);
    const insert = db.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (@id, @folder_id, @title, @kind, @content, @source_json, @order_idx, @created_at, @updated_at)');
    insert.run(noteRow('n-deleted', 'borrada aquí', '2026-01-01T00:00:00.000Z'));
    insert.run(noteRow('n-edited-later', 'borrada aquí', '2026-01-01T00:00:00.000Z'));
    db.prepare("DELETE FROM notes WHERE id IN ('n-deleted', 'n-edited-later')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_tombstones WHERE table_name = 'notes'").get().n, 2);

    applySnapshotToReplica(db, {
      tables: {
        notes: [
          // The owner's publication from before the deletion reached them.
          noteRow('n-deleted', 'borrada aquí', '2026-01-01T00:00:00.000Z'),
          // Someone edited it AFTER this deletion: that edit is the later fact and wins.
          noteRow('n-edited-later', 'editada después', '2099-01-01T00:00:00.000Z'),
          // A note this replica never had arrives as usual.
          noteRow('n-new', 'nueva', '2026-01-02T00:00:00.000Z'),
        ],
      },
    });

    assert.equal(db.prepare("SELECT id FROM notes WHERE id = 'n-deleted'").get(), undefined, 'the snapshot resurrected a note deleted on this replica');
    assert.equal(db.prepare("SELECT content FROM notes WHERE id = 'n-edited-later'").get()?.content, 'editada después');
    assert.equal(db.prepare("SELECT content FROM notes WHERE id = 'n-new'").get()?.content, 'nueva');
    assert.ok(db.prepare("SELECT 1 FROM sync_tombstones WHERE table_name = 'notes' AND row_key = '[\"n-deleted\"]'").get(), 'the deletion is still remembered');
  } finally {
    db.close();
  }
});
