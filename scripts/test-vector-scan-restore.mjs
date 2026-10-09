// A vault replaced in place (backup restore) must open as the backup, not through the old vault's
// write-ahead log, which the vector-scan worker's long-lived connections would otherwise keep alive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--vector-scan-restore')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-vector-scan-restore-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { build } = require('esbuild');
try {
  const workerFile = path.join(scratch, 'vectorScanWorker.cjs');
  const sqlitePath = require.resolve('better-sqlite3');
  await build({ entryPoints: [path.join(repoRoot, 'electron/workers/vectorScanWorker.ts')], outfile: workerFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'native-sqlite', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: sqlitePath, external: true })); } }] });
  process.env.NODUS_VECTOR_SCAN_WORKER_FILE = workerFile;
  const host = require(path.join(repoRoot, 'electron/db/vectorScanHost.ts'));

  const vector = Buffer.from(Float32Array.from([1, 0, 0, 0]).buffer);
  const make = (file, label, rows) => {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE passages (passage_id TEXT PRIMARY KEY, embedding BLOB)');
    const insert = db.prepare('INSERT INTO passages VALUES (?, ?)');
    db.transaction(() => { for (let index = 0; index < rows; index += 1) insert.run(`${label}-${index}`, vector); })();
    return db;
  };
  const backup = path.join(scratch, 'backup.sqlite');
  make(backup, 'backup', 5).close();
  const vault = path.join(scratch, 'vault.sqlite');
  const main = make(vault, 'old', 10);
  const scan = () => host.scanSimilarInWorker(vault, { table: 'passages', sql: 'SELECT passage_id, rowid AS rid, vec_scan(embedding) AS similarity FROM passages WHERE rowid > ? AND rowid <= ?', params: [], query: [1, 0, 0, 0], threshold: -1, limit: 100 });
  assert.equal((await scan()).length, 10, 'the worker holds a connection to the vault');
  main.transaction(() => { for (let index = 0; index < 200; index += 1) main.prepare('INSERT INTO passages VALUES (?, ?)').run(`old-after-${index}`, vector); })();

  // What a restore does: stop the scans, close the vault, copy the backup over it, open it again.
  await host.stopVectorScanWorker?.();
  main.close();
  fs.copyFileSync(backup, vault);
  const reopened = new Database(vault);
  assert.deepEqual(reopened.prepare('SELECT passage_id FROM passages ORDER BY rowid').pluck().all(), ['backup-0', 'backup-1', 'backup-2', 'backup-3', 'backup-4'], 'the restored vault is the backup');
  reopened.close();
  const after = await scan();
  assert.ok(after && after.length === 5 && after.every(row => row.passage_id.startsWith('backup-')), 'a later scan starts a fresh worker on the restored vault');

  // Both restore paths stop the worker before the vault file is replaced.
  const source = fs.readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  for (const [name, from] of [['restoreBackupArchiveSafely', source.indexOf('export async function restoreBackupArchiveSafely')], ['restoreBackupArchiveFile', source.indexOf('export async function restoreBackupArchiveFile')]]) {
    const body = source.slice(source.indexOf('{', source.indexOf(')', from)));
    const stop = body.indexOf('await stopVectorScanWorker()');
    const replace = Math.min(...['restoreBackupArchive(', 'replaceDbFile('].map(call => body.indexOf(call)).filter(at => at >= 0));
    assert.ok(stop >= 0 && stop < replace, `${name} stops the vector-scan worker before replacing the vault`);
  }
  console.log('Restore: the vault opens as the backup, and vector scans resume on it.');
  await host.stopVectorScanWorker();
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
