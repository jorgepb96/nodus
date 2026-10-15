// A backup reuses a vault's cached snapshot only when the vault is still the database that snapshot
// was taken from. The revision counter alone cannot say so: a restore or a reset puts another file
// at the vault's path with its own counter, and once that counter reaches the cached value the next
// backup silently carried the replaced vault's contents instead of the live one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--backup-snapshot-cache-identity')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-backup-cache-identity-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
try {
  const { runBackupUtilityRequest } = require(path.join(repoRoot, 'electron/export/backupUtilityWorker.ts'));
  const { ensureBackupRevisionTriggers, backupVaultRevision } = require(path.join(repoRoot, 'electron/export/backupVaultRevision.ts'));
  const registry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));

  const make = (file, body) => {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);
      CREATE TABLE backup_revision (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), sequence INTEGER NOT NULL);
      INSERT INTO backup_revision VALUES (1, 1);`);
    ensureBackupRevisionTriggers(db);
    db.prepare("INSERT INTO settings VALUES ('app', '{}')").run();
    db.prepare("INSERT INTO notes VALUES ('n1', ?)").run(body);
    const revision = backupVaultRevision(db);
    db.close();
    return revision;
  };
  const vault = registry.getActiveVault();
  const cacheDir = path.join(scratch, 'cache');
  let id = 1;
  const snapshot = async () => {
    const targetPath = path.join(scratch, `snapshot-${id}.sqlite`);
    const result = await runBackupUtilityRequest({ kind: 'snapshot', id: id++, sourcePath: vault.path, targetPath, cacheDir, vaultId: vault.id });
    const db = new Database(targetPath, { readonly: true });
    const body = db.prepare("SELECT body FROM notes WHERE id = 'n1'").pluck().get();
    db.close();
    return { ...result, body };
  };

  const liveRevision = make(vault.path, 'before the restore');
  const first = await snapshot();
  assert.equal(first.body, 'before the restore');
  assert.equal(first.reused, false);
  const second = await snapshot();
  assert.equal(second.reused, true, 'an unchanged vault reuses its cached snapshot');
  assert.equal(second.body, 'before the restore');

  // Another database lands at the vault's path (a restore) with the same revision counter.
  const incoming = path.join(scratch, 'incoming.sqlite');
  assert.equal(make(incoming, 'after the restore'), liveRevision, 'the two databases share a revision value');
  registry.restoreVaultDatabase({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy }, incoming);
  const third = await snapshot();
  assert.equal(third.body, 'after the restore', 'the backup carries the restored vault, not the cached snapshot of the one it replaced');
  assert.equal(third.reused, false);
  const fourth = await snapshot();
  assert.equal(fourth.reused, true, 'the restored vault is cached in its turn');
  console.log('Backup snapshot cache: reused only for the database it was taken from.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
