// Looking for reusable analysis opens every other vault. A vault that has not been opened since an
// update is still on the old schema, and that lookup used to migrate it with bare runMigrations: no
// verified pre-migration copy, no migration report, so the one copy a downgrade or a failed
// migration needs never existed. A sibling behind the schema must be migrated the safe way, and one
// already current must be read without being opened for writing at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--vault-reuse-sibling-migration')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-vault-reuse-sibling-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
let database = null;
try {
  database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const registry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { reuseVaultAnalysisForWorks } = require(path.join(repoRoot, 'electron/vaults/vaultAnalysisImport.ts'));

  const sibling = registry.createVault('Sibling');
  // Put the sibling one schema version behind, as an update leaves every vault not yet opened.
  const behind = new Database(sibling.path);
  behind.exec('DROP INDEX IF EXISTS passages_fts_content_passage');
  behind.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
  behind.close();

  const db = database.getDb();
  db.prepare("INSERT INTO works (nodus_id, zotero_key, title) VALUES ('w1', 'ZKEY1', 'A work')").run();
  await reuseVaultAnalysisForWorks(['w1']);

  const migrated = new Database(sibling.path, { readonly: true });
  assert.equal(migrated.pragma('user_version', { simple: true }), SCHEMA_VERSION, 'the sibling was brought to the current schema');
  migrated.close();
  const migrations = path.join(path.dirname(sibling.path), '.nodus', 'migrations');
  const files = fs.existsSync(migrations) ? fs.readdirSync(migrations) : [];
  const prefix = `pre-v${SCHEMA_VERSION}-from-v${SCHEMA_VERSION - 1}-`;
  assert.ok(files.some((name) => name.startsWith(prefix) && name.endsWith('.sqlite')),
    `a verified pre-migration copy of the sibling exists (found: ${files.join(', ') || 'nothing'})`);
  assert.ok(files.some((name) => name.startsWith(prefix) && name.endsWith('.json')), 'the copy has its manifest');

  // A sibling already on the current schema is only read: no write, so no change to its file.
  const before = fs.statSync(sibling.path).mtimeMs;
  const walBefore = fs.existsSync(`${sibling.path}-wal`) ? fs.statSync(`${sibling.path}-wal`).size : 0;
  await reuseVaultAnalysisForWorks(['w1']);
  assert.equal(fs.statSync(sibling.path).mtimeMs, before, 'a current sibling is not written');
  assert.equal(fs.existsSync(`${sibling.path}-wal`) ? fs.statSync(`${sibling.path}-wal`).size : 0, walBefore);
  console.log('Analysis reuse: a sibling behind the schema is migrated with its safety copy; a current one is only read.');
} finally {
  try { database?.closeDb(); } catch { /* already closed */ }
  fs.rmSync(scratch, { recursive: true, force: true });
}
