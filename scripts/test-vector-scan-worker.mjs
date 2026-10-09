// The worker's cached scan, against the per-row `vec_scan` callback it replaces.
//
// The cache holds each table's vectors in the long-lived worker so a sweep is arithmetic instead of
// one SQLite-to-JS callback per row (~40 µs a row, measured). It must rank EXACTLY as the callback
// did — the same doubles, the same ties, the same zero for a missing or misshapen vector, the same
// rows excluded by the caller's own WHERE — and it must never answer from vectors a later write
// replaced.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// better-sqlite3 is built for Electron's ABI: re-run under Electron rather than skip.
if (!process.argv.includes('--electron-vector-scan-worker-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-vector-scan-worker.mjs'), '--electron-vector-scan-worker-test'],
    // Not the runner's IPC worker: an inherited NODE_TEST_CONTEXT turns the child's results into
    // binary events on stdout and hides a failure (the same reason as lib/tsRuntimeHooks.mjs).
    { cwd: repoRoot, env: Object.fromEntries(Object.entries({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }).filter(([key]) => key !== 'NODE_TEST_CONTEXT')), stdio: 'inherit' });
  process.exit(0);
}

const Database = require('better-sqlite3');
const { build } = require('esbuild');
const outDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-vector-scan-worker-'));
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));
const workerFile = path.join(outDir, 'worker.cjs');
// The bundle lives in a temp directory, where a bare 'better-sqlite3' would not resolve: point it
// at this repository's copy, built for Electron.
const sqlitePath = require.resolve('better-sqlite3');
await build({ entryPoints: [path.join(repoRoot, 'electron/workers/vectorScanWorker.ts')], outfile: workerFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'native-sqlite', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: sqlitePath, external: true })); } }] });

const DIM = 64;
const dbFile = path.join(outDir, 'corpus.sqlite');
let seed = 7;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
const vector = (dim = DIM) => Buffer.from(Float32Array.from({ length: dim }, random).buffer);
{
  const db = new Database(dbFile);
  db.exec('CREATE TABLE passages (passage_id TEXT PRIMARY KEY, kind TEXT, embedding BLOB, embedding_dim INTEGER)');
  const insert = db.prepare('INSERT INTO passages (rowid, passage_id, kind, embedding, embedding_dim) VALUES (?, ?, ?, ?, ?)');
  const twin = vector();
  let rowid = 0;
  for (let i = 0; i < 4000; i += 1) {
    rowid += i % 97 === 0 ? 3 : 1;                           // gaps left by deletions
    const embedding = i % 211 === 0 ? null                    // never embedded
      : i % 157 === 0 ? vector(DIM / 2)                       // the wrong length: scores 0
        : i % 50 === 0 ? twin                                  // identical vectors: ties
          : vector();
    insert.run(rowid, `p${i}`, i % 3 === 0 ? 'a' : 'b', embedding, DIM);
  }
  db.close();
}

const sql = (where = '') => `SELECT passage_id, rowid AS rid, vec_scan(embedding) AS similarity FROM passages
  WHERE rowid > ? AND rowid <= ? AND embedding IS NOT NULL${where}`;
const query = Array.from({ length: DIM }, random);

function scan(worker, input) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onError = (error) => { worker.off('message', onMessage); reject(error); };
    const onMessage = (reply) => { if (reply.id !== id) return; worker.off('message', onMessage); worker.off('error', onError); reply.ok ? resolve(reply.rows) : reject(new Error(reply.error)); };
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.postMessage({ id, databasePath: dbFile, scan: { table: 'passages', query, threshold: -1, limit: 60, params: [], ...input, sql: input.sql ?? sql() } });
  });
}
const cached = new Worker(workerFile, { env: { ...process.env }, stdout: true });
const callback = new Worker(workerFile, { env: { ...process.env, NODUS_VECTOR_SCAN_CACHE: '0' }, stdout: true });
let builds = 0;
cached.stdout.on('data', (chunk) => { builds += (String(chunk).match(/cache built/g) ?? []).length; });
callback.stdout.resume();
after(async () => { await cached.terminate(); await callback.terminate(); });

test('the cached scan ranks exactly as the per-row callback', async () => {
  for (const input of [{}, { limit: 7 }, { limit: 500 }, { threshold: 0.15, limit: 40 }]) {
    assert.deepEqual(await scan(cached, input), await scan(callback, input), JSON.stringify(input));
  }
});

test('ties, missing and misshapen vectors are treated exactly as before', async () => {
  const all = await scan(cached, { limit: 5000 });
  assert.deepEqual(all, await scan(callback, { limit: 5000 }));
  assert.ok(all.filter((row) => row.similarity === 0).length > 0, 'the wrong-length vectors score 0 and stay in the pool at threshold -1');
  const tied = all.filter((row) => /^p(\d+)$/.test(row.passage_id) && Number(row.passage_id.slice(1)) % 50 === 0 && Number(row.passage_id.slice(1)) % 211 && Number(row.passage_id.slice(1)) % 157);
  assert.ok(tied.length > 10 && new Set(tied.map((row) => row.similarity)).size === 1, 'identical vectors tie');
});

test("the caller's WHERE and its parameters filter exactly as before", async () => {
  const input = { sql: sql(' AND kind = ?'), params: ['a'], limit: 300 };
  const rows = await scan(cached, input);
  assert.deepEqual(rows, await scan(callback, input));
  assert.ok(rows.length > 0 && rows.every((row) => Number(row.passage_id.slice(1)) % 3 === 0), 'only kind a');
});

test('a write from another connection is never answered from the old vectors', async () => {
  await scan(cached, {});
  const before = builds;
  const writer = new Database(dbFile);
  writer.prepare('UPDATE passages SET embedding = ? WHERE passage_id = ?').run(Buffer.from(Float32Array.from(query).buffer), 'p1');
  writer.close();
  const rows = await scan(cached, { limit: 3 });
  assert.equal(rows[0].passage_id, 'p1', 'the re-embedded row is now the best match');
  assert.ok(Math.abs(rows[0].similarity - 1) < 1e-6);
  assert.deepEqual(rows, await scan(callback, { limit: 3 }));
  assert.equal(builds, before + 1, 'the cache was rebuilt once, for the write');
  await scan(cached, { limit: 3 });
  assert.equal(builds, before + 1, 'and not again without a write');
});
