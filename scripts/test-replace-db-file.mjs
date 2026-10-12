// Replacing the live vault with an imported database (legacy single-vault restore) must not read the
// imported file through the old vault's write-ahead log, and must not leave the vault truncated when
// the copy fails part way. Any other connection still open on the vault keeps its `-wal` beside it;
// copying a new database over the same file then opens THROUGH that log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--replace-db-file')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-replace-db-file-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
let database = null;
let other = null;
try {
  database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const live = database.getDb();
  const vaultPath = live.name;
  // The imported database: a copy of a fully migrated vault, marked so it can be recognised.
  live.prepare("INSERT INTO settings (key, value) VALUES ('test-marker', 'live')").run();
  live.pragma('wal_checkpoint(TRUNCATE)');
  const imported = path.join(scratch, 'imported.sqlite');
  await live.backup(imported);
  const marked = new Database(imported);
  marked.prepare("UPDATE settings SET value = 'imported' WHERE key = 'test-marker'").run();
  marked.close();

  // Another connection on the vault (a background job, a worker) with commits still in the log.
  other = new Database(vaultPath);
  other.pragma('wal_autocheckpoint = 0');
  const insert = other.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  other.transaction(() => { for (let index = 0; index < 200; index += 1) insert.run(`old-${index}`, 'x'.repeat(2000)); })();
  other.prepare("UPDATE settings SET value = 'live-after' WHERE key = 'test-marker'").run();
  assert.ok(fs.statSync(`${vaultPath}-wal`).size > 0, 'the old vault has commits in its log');

  database.replaceDbFile(imported);
  const reopened = database.getDb();
  assert.equal(reopened.pragma('quick_check', { simple: true }), 'ok', 'the replaced vault is intact');
  assert.equal(reopened.prepare("SELECT value FROM settings WHERE key = 'test-marker'").pluck().get(), 'imported', 'the vault opens as the imported database');
  assert.equal(reopened.prepare("SELECT COUNT(*) FROM settings WHERE key LIKE 'old-%'").pluck().get(), 0, 'no row of the old log leaks into it');
  other.close();
  other = null;
  database.closeDb();
  const after = new Database(vaultPath, { readonly: true });
  assert.equal(after.prepare("SELECT value FROM settings WHERE key = 'test-marker'").pluck().get(), 'imported', 'the old connection closing later does not write its log into the new vault');
  after.close();

  // A copy that fails part way leaves the vault as it was.
  const before = database.getDb().prepare("SELECT value FROM settings WHERE key = 'test-marker'").pluck().get();
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = (from, to, ...rest) => {
    fs.writeFileSync(to, Buffer.alloc(4096));
    const error = new Error('ENOSPC: no space left on device, copyfile'); error.code = 'ENOSPC';
    throw error;
  };
  try {
    assert.throws(() => database.replaceDbFile(imported), /ENOSPC/);
  } finally {
    fs.copyFileSync = realCopy;
  }
  database.closeDb();
  const survivor = new Database(vaultPath, { readonly: true });
  assert.equal(survivor.pragma('quick_check', { simple: true }), 'ok', 'a failed copy leaves the vault intact');
  assert.equal(survivor.prepare("SELECT value FROM settings WHERE key = 'test-marker'").pluck().get(), before);
  survivor.close();
  assert.deepEqual(fs.readdirSync(path.dirname(vaultPath)).filter((name) => name.includes('.incoming-')), [], 'no staged copy is left behind');
  console.log('replaceDbFile: the vault opens as the imported database, and a failed copy leaves it intact.');
} finally {
  try { other?.close(); } catch { /* already closed */ }
  try { database?.closeDb(); } catch { /* already closed */ }
  fs.rmSync(scratch, { recursive: true, force: true });
}
