// The pre-migration copy is a byte copy of the vault's main file, taken after a TRUNCATE checkpoint.
// If a reader holds a snapshot at that moment the checkpoint stops short, the newest commits stay in
// the -wal, and the copy silently lacks them. A failed migration then restores that copy and deletes
// the -wal: those commits are gone. The migration must not start from an incomplete checkpoint.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--migration-snapshot-checkpoint')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-migration-checkpoint-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const readers = [];
try {
  const { migrateDatabaseSafely } = require(path.join(repoRoot, 'electron/db/migrationSafety.ts'));
  const file = path.join(scratch, 'vault.sqlite');
  const setup = new Database(file);
  setup.pragma('journal_mode = WAL');
  setup.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES ('old')");
  setup.pragma('user_version = 1');
  setup.close();

  // A reader that started before the newest commits, and is still reading when the migration begins.
  const reader = new Database(file);
  readers.push(reader);
  const rows = reader.prepare('SELECT * FROM notes').iterate();
  rows.next();

  const vault = new Database(file);
  vault.pragma('wal_autocheckpoint = 0');
  vault.prepare("INSERT INTO notes (body) VALUES ('committed before the migration')").run();
  // The reader lets go a moment later, as a real one would.
  setTimeout(() => { rows.return(); }, 300);

  let failure = null;
  try {
    migrateDatabaseSafely(vault, file, 2, () => { throw new Error('the migration fails'); });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'the migration failed');
  if (rows.return) rows.return();
  reader.close();
  readers.length = 0;
  const after = new Database(file, { readonly: true });
  const bodies = after.prepare('SELECT body FROM notes ORDER BY id').pluck().all();
  after.close();
  assert.deepEqual(bodies, ['old', 'committed before the migration'], 'a commit made before the migration survives its failure');
  console.log('Migration safety: a failed migration never loses a commit that was still in the write-ahead log.');
} finally {
  for (const reader of readers) { try { reader.close(); } catch { /* closed */ } }
  fs.rmSync(scratch, { recursive: true, force: true });
}
