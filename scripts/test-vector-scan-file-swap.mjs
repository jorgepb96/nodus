// The vector-scan worker keeps its read connections open between scans. When a vault's file is
// replaced by a rename (a multi-vault restore, restoreVaultDatabase) or deleted and recreated (a
// vault reset), that connection still reads the OLD file: semantic search would keep returning the
// rows the user just restored over or wiped. The worker must notice the swap and reopen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--vector-scan-file-swap')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-vector-scan-swap-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { build } = require('esbuild');
let host = null;
try {
  const workerFile = path.join(scratch, 'vectorScanWorker.cjs');
  const sqlitePath = require.resolve('better-sqlite3');
  await build({ entryPoints: [path.join(repoRoot, 'electron/workers/vectorScanWorker.ts')], outfile: workerFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'native-sqlite', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: sqlitePath, external: true })); } }] });
  process.env.NODUS_VECTOR_SCAN_WORKER_FILE = workerFile;
  host = require(path.join(repoRoot, 'electron/db/vectorScanHost.ts'));
  const registry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));

  const vector = Buffer.from(Float32Array.from([1, 0, 0, 0]).buffer);
  const make = (file, label, rows) => {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS passages (passage_id TEXT PRIMARY KEY, embedding BLOB)');
    const insert = db.prepare('INSERT INTO passages (passage_id, embedding) VALUES (?, ?)');
    db.transaction(() => { for (let index = 0; index < rows; index += 1) insert.run(`${label}-${index}`, vector); })();
    return db;
  };
  const vault = registry.getActiveVault();
  const scan = () => host.scanSimilarInWorker(vault.path, { table: 'passages', sql: 'SELECT passage_id, rowid AS rid, vec_scan(embedding) AS similarity FROM passages WHERE rowid > ? AND rowid <= ?', params: [], query: [1, 0, 0, 0], threshold: -1, limit: 100 });
  const ids = (rows) => rows.map((row) => row.passage_id).sort();

  make(vault.path, 'old', 10).close();
  assert.equal((await scan()).length, 10, 'the worker holds a connection to the vault');

  // 1. A multi-vault restore: the backup's file is renamed over the vault (restoreVaultDatabase).
  const backup = path.join(scratch, 'backup.sqlite');
  make(backup, 'backup', 5).close();
  registry.restoreVaultDatabase({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy }, backup);
  const afterRestore = await scan();
  assert.deepEqual(ids(afterRestore), ['backup-0', 'backup-1', 'backup-2', 'backup-3', 'backup-4'], 'a scan after a restore reads the restored vault, not the file it replaced');

  // 2. A vault reset: the file is deleted and a fresh one created in its place.
  registry.resetVaultDatabase(vault.id);
  const afterReset = await scan();
  assert.deepEqual(afterReset, [], 'a scan after a reset finds nothing, not the wiped passages');

  // 3. A successor file with the same row count and the same data_version must not be answered
  //    from the vectors and rows cached for the file it replaced.
  const first = path.join(scratch, 'first.sqlite');
  const second = path.join(scratch, 'second.sqlite');
  make(first, 'first', 3).close();
  make(second, 'second', 3).close();
  registry.restoreVaultDatabase({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy }, first);
  assert.deepEqual(ids(await scan()), ['first-0', 'first-1', 'first-2']);
  registry.restoreVaultDatabase({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy }, second);
  assert.deepEqual(ids(await scan()), ['second-0', 'second-1', 'second-2'], 'rows cached for the replaced file are not served for its successor');

  // The file-backed multi-vault restore stops the worker before any vault file is replaced.
  const source = fs.readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  const from = source.indexOf('async function restoreAllVaultsFromFile');
  const body = source.slice(from, source.indexOf('\n}\n', from));
  const stop = body.indexOf('await stopVectorScanWorker()');
  assert.ok(stop >= 0 && stop < body.indexOf('restoreVaultDatabase('), 'restoreAllVaultsFromFile stops the vector-scan worker before replacing vault files');
  console.log('Vector scans follow a vault file that was restored over or reset.');
} finally {
  await host?.stopVectorScanWorker?.();
  fs.rmSync(scratch, { recursive: true, force: true });
}
