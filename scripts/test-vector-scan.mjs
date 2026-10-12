// The paged similarity scan, against the blocking query it replaces.
//
// Every semantic search in the app now goes through this: it walks a table in rowid
// windows and hands the event loop back between them, so a corpus search stops
// freezing the window. Two things have to hold, and neither is obvious from reading
// it — the ranking must be exactly what the single blocking statement produced, and
// the loop must genuinely get a turn.
//
// Built on a synthetic corpus rather than a vault, so it covers the shapes no vault
// on a given machine happens to have (the archive index in particular) and the ones
// a vault would not reproduce on demand: rowid gaps left by deletions, a window
// boundary landing exactly on the last row, an empty table.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// better-sqlite3's binary is built for Electron's ABI, so this re-runs itself under
// Electron rather than skipping: a test that quietly passes by not running is worse
// than no test. Same trick as scripts/test-idea-identity.mjs.
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-vector-scan-test')) process.exit(0);

const Database = require('better-sqlite3');

const outDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-vector-scan-test-'));
// The real module, with its database import resolved to a stub beside the bundle.
const shim = path.join(outDir, 'database.js');
writeFileSync(
  shim,
  `let db = null, query = null;
   exports.__setDb = (next) => { db = next; };
   exports.getDb = () => db;
   exports.setVectorScanQuery = (next) => { query = next; };
   exports.__query = () => query;\n`
);
const bundle = path.join(outDir, 'scan.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/db/vectorScan.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    '--external:./database',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'pipe' }
);
const { scanSimilar } = require(bundle);
const shimModule = require(shim);

const DIM = 16;
const databaseFile = path.join(outDir, 'vectors.sqlite');
const db = new Database(databaseFile);
shimModule.__setDb(db);

// Build the packaged background worker beside the bundled host. scanSimilar now
// prefers this path for real on-disk vaults and keeps the old paged loop only as a
// source-test/dev fallback.
const workerFile = path.join(outDir, 'vectorScanWorker.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/workers/vectorScanWorker.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    '--external:better-sqlite3',
    `--outfile=${workerFile}`,
  ],
  { cwd: repoRoot, stdio: 'pipe' }
);
process.env.NODUS_VECTOR_SCAN_WORKER_FILE = workerFile;

db.function('vec_cosine', (a, b) => {
  if (!a || !b) return 0;
  if (a.byteLength === 0 || a.byteLength !== b.byteLength || a.byteLength % 4 !== 0) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < fa.length; i++) { dot += fa[i] * fb[i]; na += fa[i] * fa[i]; nb += fb[i] * fb[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
});
db.function('vec_scan', (stored) => {
  const query = shimModule.__query();
  if (!stored || !query) return 0;
  if (stored.byteLength === 0 || stored.byteLength !== query.length * 4) return 0;
  const vector = new Float32Array(stored.buffer, stored.byteOffset, stored.byteLength / 4);
  let dot = 0, norm = 0;
  for (let i = 0; i < query.length; i++) { dot += vector[i] * query[i]; norm += vector[i] * vector[i]; }
  return norm === 0 ? 0 : dot / Math.sqrt(norm);
});

/** Deterministic pseudo-random vectors: the same corpus on every run. */
let seed = 42;
function nextFloat() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648 - 0.5;
}
function vector() {
  return Array.from({ length: DIM }, nextFloat);
}
function encode(values) {
  const f32 = Float32Array.from(values);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

const CONFIG = ['openai', 'test-model', DIM];

db.exec(`
  CREATE TABLE ideas (global_id TEXT PRIMARY KEY, embedding BLOB, embedding_provider TEXT,
                      embedding_model TEXT, embedding_dim INTEGER, orphaned_at TEXT);
  CREATE TABLE archive_items (item_id TEXT PRIMARY KEY, embedding BLOB, embedding_provider TEXT,
                              embedding_model TEXT, embedding_dim INTEGER);
  CREATE TABLE archive_item_persons (item_id TEXT, person_id TEXT);
`);

// 4,000 rows: more than two rowid windows, so the paging is genuinely exercised.
const ROWS = 4_000;
const insertIdea = db.prepare('INSERT INTO ideas VALUES (?, ?, ?, ?, ?, ?)');
const insertItem = db.prepare('INSERT INTO archive_items VALUES (?, ?, ?, ?, ?)');
db.transaction(() => {
  for (let i = 0; i < ROWS; i++) {
    const buf = encode(vector());
    // One in fifty carries no embedding, and one in a hundred is dormant: both are
    // filtered by the WHERE, and both must be filtered identically by either path.
    insertIdea.run(`g-${i}`, i % 50 === 0 ? null : buf, ...CONFIG, i % 100 === 0 ? '2026-01-01' : null);
    insertItem.run(`item-${i}`, i % 50 === 0 ? null : buf, ...CONFIG);
  }
})();
// Rowid gaps, exactly as deleting and re-adding documents leaves them.
db.exec(`DELETE FROM ideas WHERE rowid % 7 = 0; DELETE FROM archive_items WHERE rowid % 11 = 0`);
db.prepare('INSERT INTO archive_item_persons VALUES (?, ?)').run('item-3', 'p-1');

const query = vector();
const queryBuf = encode(query);

const IDEA_WHERE = `embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ? AND orphaned_at IS NULL`;
const blockingIdeas = (threshold, limit) =>
  db
    .prepare(
      `SELECT * FROM (SELECT global_id, vec_cosine(embedding, ?) AS similarity FROM ideas WHERE ${IDEA_WHERE})
        WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?`
    )
    .all(queryBuf, ...CONFIG, threshold, limit);
const pagedIdeas = (threshold, limit) =>
  scanSimilar({
    table: 'ideas',
    sql: `SELECT global_id, rowid AS rid, vec_scan(embedding) AS similarity FROM ideas
           WHERE rowid > ? AND rowid <= ? AND ${IDEA_WHERE}`,
    params: CONFIG,
    query,
    threshold,
    limit,
  });

test('the paged scan ranks exactly like the blocking query it replaces', async () => {
  for (const limit of [1, 48, 120, 500]) {
    const before = (await blockingIdeas(-1, limit)).map((row) => row.global_id);
    const after = (await pagedIdeas(-1, limit)).map((row) => row.global_id);
    assert.deepEqual(after, before, `top ${limit} differs`);
    assert.equal(after.length, limit, `top ${limit} is not full`);
  }
});

test('the rows a WHERE excludes are excluded either way', async () => {
  const total = db.prepare(`SELECT COUNT(*) n FROM ideas WHERE ${IDEA_WHERE}`).get(...CONFIG).n;
  const everything = await pagedIdeas(-1, ROWS * 2);
  assert.equal(everything.length, total, 'every eligible row is scanned, gaps and all');
  assert.ok(everything.length < ROWS, 'and the ineligible ones really were dropped');
  // Rowid gaps from deletion must not truncate the walk: the last row still shows up.
  const lastRowid = db.prepare('SELECT MAX(rowid) top FROM ideas').get().top;
  const lastId = db.prepare('SELECT global_id FROM ideas WHERE rowid = ?').get(lastRowid)?.global_id;
  if (lastId) assert.ok(everything.some((row) => row.global_id === lastId), 'the highest rowid is never skipped');
});

test('a threshold keeps the same rows as the blocking query', async () => {
  const cut = (await blockingIdeas(-1, 200)).at(-1).similarity;
  const before = (await blockingIdeas(cut, 500)).map((row) => row.global_id);
  const after = (await pagedIdeas(cut, 500)).map((row) => row.global_id);
  assert.deepEqual(after, before);
  assert.ok(before.length >= 200, 'the threshold is a real cut, not everything');
});

test('an empty table and a zero limit are answered without a scan', async () => {
  db.exec('CREATE TABLE empty_ideas (global_id TEXT PRIMARY KEY, embedding BLOB)');
  const none = await scanSimilar({
    table: 'empty_ideas',
    sql: `SELECT global_id, rowid AS rid, vec_scan(embedding) AS similarity FROM empty_ideas WHERE rowid > ? AND rowid <= ?`,
    params: [],
    query,
    threshold: -1,
    limit: 10,
  });
  assert.deepEqual(none, []);
  assert.deepEqual(await pagedIdeas(-1, 0), [], 'asking for nothing returns nothing');
});

test('the archive scan matches its blocking query, exclusions and all', async () => {
  const where = `embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
                 AND item_id NOT IN (SELECT item_id FROM archive_item_persons WHERE person_id = ?)`;
  const before = db
    .prepare(
      `SELECT item_id, vec_cosine(embedding, ?) AS similarity FROM archive_items WHERE ${where}
        ORDER BY similarity DESC LIMIT ?`
    )
    .all(queryBuf, ...CONFIG, 'p-1', 16)
    .map((row) => row.item_id);
  const after = (
    await scanSimilar({
      table: 'archive_items',
      sql: `SELECT item_id, rowid AS rid, vec_scan(embedding) AS similarity FROM archive_items
             WHERE rowid > ? AND rowid <= ? AND ${where}`,
      params: [...CONFIG, 'p-1'],
      query,
      threshold: -1,
      limit: 16,
    })
  ).map((row) => row.item_id);
  assert.deepEqual(after, before);
  assert.ok(!after.includes('item-3'), 'the excluded item stays excluded');
});

test('the event loop really does get a turn mid-scan', async () => {
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    timer = setImmediate(tick);
  };
  let timer = setImmediate(tick);
  await pagedIdeas(-1, 120);
  clearImmediate(timer);
  assert.ok(ticks >= 2, `the background scan allowed ${ticks} event-loop turns`);
});

test.after(() => {
  delete process.env.NODUS_VECTOR_SCAN_WORKER_FILE;
  db.close();
  rmSync(outDir, { recursive: true, force: true });
});
