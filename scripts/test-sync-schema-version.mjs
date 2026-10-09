// What a build stamps on what it sends must change only when a table changes shape.
//
// A replica refuses a snapshot, an owner refuses (and acknowledges, so loses) a mutation, and
// a package import is refused, whenever the sender's stamp is above the receiver's schema.
// The guard exists because rows from a newer schema may carry columns the receiver would
// drop. Stamping the raw SCHEMA_VERSION made every migration a hard break between peers,
// including v201, which adds one index and rewrites two triggers and changes no table.
//
// This walks the real migrations on a fresh database, finds the last one that changed any
// table's columns, and checks both the declared SYNC_SCHEMA_VERSION and the stamps the
// senders actually write against it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-sync-schema-version')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-sync-schema-version-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const { ensureOutboxTriggers } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));

test.after(async () => { await rm(userData, { recursive: true, force: true }); });

function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => [name, db.pragma(`table_info("${name.replace(/"/g, '""')}")`)]));
}

function lastShapeChange() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let previous = shape(db);
  let last = 0;
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      db.exec(migration.up);
      migration.after?.(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
    const next = shape(db);
    if (next !== previous) last = migration.version;
    previous = next;
  }
  db.close();
  return last;
}

test('senders stamp the last migration that changed a table, not every migration', () => {
  const expected = lastShapeChange();
  assert.ok(expected > 0 && expected <= SCHEMA_VERSION);

  const db = new Database(path.join(userData, 'sender.sqlite'));
  try {
    runMigrations(db);
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);

    const snapshot = buildServerSnapshot({ id: 'v', name: 'Vault', type: 'academic' }, { nodusServerIncludeUserContent: true, nodusServerIncludePassages: false }, db);
    assert.equal(snapshot.schemaVersion, expected,
      `a publication is stamped v${snapshot.schemaVersion}, so every build at v${expected}..v${snapshot.schemaVersion - 1} refuses it although no table changed after v${expected}`);

    ensureOutboxTriggers(db, true);
    db.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
      .run('n-1', 'Nota', 'markdown', 'x', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    const stamps = db.prepare('SELECT DISTINCT schema_version AS v FROM server_outbox').all().map((row) => row.v);
    assert.deepEqual(stamps, [expected], 'an outgoing mutation is stamped with the wire version');
  } finally {
    db.close();
  }

  const { SYNC_SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/syncSchemaVersion.ts'));
  assert.equal(SYNC_SCHEMA_VERSION, expected,
    `migration v${expected} is the last that changed a table: set SYNC_SCHEMA_VERSION to ${expected}`);
});
