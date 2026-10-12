import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-backup-revision-test')) process.exit(0);
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = function loadTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

test('durable backup revision changes on content writes, not on reads', () => {
  const Database = require('better-sqlite3');
  const { ensureBackupRevisionTriggers, backupVaultRevision } = require(path.join(repoRoot, 'electron/export/backupVaultRevision.ts'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-backup-revision-'));
  const dbPath = path.join(dir, 'vault.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT); CREATE TABLE backup_revision (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), sequence INTEGER NOT NULL); INSERT INTO backup_revision VALUES (1, 1); CREATE VIRTUAL TABLE search_fts USING fts5(content)');
    ensureBackupRevisionTriggers(db);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodus_backup_revision_%_search_fts_%'").get().n,
      0,
      'FTS shadow tables never receive user triggers',
    );
    const initial = backupVaultRevision(db);
    db.prepare('SELECT COUNT(*) AS n FROM notes').get();
    assert.equal(backupVaultRevision(db), initial, 'reads do not invalidate a reusable vault entry');
    db.prepare('INSERT INTO notes VALUES (?, ?)').run('n1', 'first');
    const inserted = backupVaultRevision(db);
    assert.notEqual(inserted, initial, 'insert invalidates the prior entry');
    db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('second', 'n1');
    assert.notEqual(backupVaultRevision(db), inserted, 'update invalidates the prior entry');
    const updated = backupVaultRevision(db);
    db.prepare('DELETE FROM notes WHERE id = ?').run('n1');
    assert.notEqual(backupVaultRevision(db), updated, 'delete invalidates the prior entry');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
