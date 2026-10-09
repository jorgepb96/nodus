import Database from 'better-sqlite3';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import type { VectorScanWorkerInput } from '../db/vectorScanHost';

interface WorkerRequest {
  id: number;
  databasePath: string;
  scan: VectorScanWorkerInput;
}

const ALLOWED_TABLES = new Set([
  'archive_items',
  'document_vectors',
  'ideas',
  'passages',
  'work_summaries',
]);
const WINDOW_ROWIDS = 1_500;
const databases = new Map<string, Database.Database>();

function unitVector(values: number[]): Float32Array | null {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) norm += vector[index] * vector[index];
  if (norm === 0) return null;
  const length = Math.sqrt(norm);
  for (let index = 0; index < vector.length; index += 1) vector[index] /= length;
  return vector;
}

function databaseFor(file: string): Database.Database {
  const resolved = path.resolve(file);
  const existing = databases.get(resolved);
  if (existing?.open) return existing;
  const database = new Database(resolved, { readonly: true, fileMustExist: true });
  database.pragma('query_only = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('temp_store = MEMORY');
  database.pragma('cache_size = -32768');
  database.pragma('mmap_size = 268435456');
  databases.set(resolved, database);
  return database;
}

/** What one sweep actually did, so the cost can be attributed rather than guessed at.
 *
 *  The existing line reported rows RETURNED — sixty, after the limit — which says nothing about
 *  the work. The cost is one callback per row VISITED, and the corpus holds 100,163 embedded
 *  passages and 52,378 ideas at 1024 dimensions, so a sweep is about 103 million multiply-adds:
 *  roughly a tenth of a second of arithmetic against a measured 5.3 to 8.5 seconds. Whether that
 *  gap is the callback boundary or something else is the question these counters answer, and
 *  rows-visited with the elapsed time gives the per-row cost directly.
 *
 *  `fingerprint` is a cheap hash of the query vector, not the text: the orchestration issues up to
 *  three different planned queries per turn and then deepens, so whether a cache would hit is a
 *  question about how often the same vector comes back — countable from the log, and not
 *  answerable from the code. */
interface SweepTrace { visited: number; windows: number; skipped: number; fingerprint: string }

function fingerprintOf(query: Float32Array): string {
  // FNV-1a over the first 64 dimensions: enough to tell two queries apart in a log, cheap enough
  // to run on every sweep, and not reversible into the query.
  let hash = 0x811c9dc5;
  for (let index = 0; index < Math.min(64, query.length); index += 1) {
    hash ^= Math.round(query[index] * 1e6) & 0xffffffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function scan(request: WorkerRequest, trace?: SweepTrace): unknown[] {
  const { databasePath, scan: input } = request;
  if (!path.isAbsolute(databasePath)) throw new Error('La ruta del vault no es absoluta.');
  if (!ALLOWED_TABLES.has(input.table)) throw new Error(`Tabla vectorial no permitida: ${input.table}`);
  if (!/^\s*SELECT\b/i.test(input.sql) || input.sql.includes(';')) {
    throw new Error('El worker solo admite una consulta SELECT interna.');
  }
  if (input.limit <= 0) return [];
  const query = unitVector(input.query);
  if (!query) return [];
  const database = databaseFor(databasePath);
  const highest = (database.prepare(`SELECT MAX(rowid) AS top FROM ${input.table}`).get() as { top: number | null }).top ?? 0;
  if (highest === 0) return [];

  if (trace) trace.fingerprint = fingerprintOf(query);
  database.function('vec_scan', (stored: Buffer | null) => {
    if (trace) trace.visited += 1;
    if (!stored || stored.byteLength === 0 || stored.byteLength !== query.length * 4) { if (trace) trace.skipped += 1; return 0; }
    const vector = new Float32Array(stored.buffer, stored.byteOffset, stored.byteLength / 4);
    let dot = 0;
    let norm = 0;
    for (let index = 0; index < query.length; index += 1) {
      dot += vector[index] * query[index];
      norm += vector[index] * vector[index];
    }
    return norm === 0 ? 0 : dot / Math.sqrt(norm);
  });

  const statement = database.prepare(input.sql);
  const trimAt = Math.max(input.limit * 4, 256);
  const kept: Array<{ similarity: number }> = [];
  for (let from = 0; from < highest; from += WINDOW_ROWIDS) {
    if (trace) trace.windows += 1;
    const to = Math.min(from + WINDOW_ROWIDS, highest);
    const rows = statement.all(from, to, ...input.params) as Array<{ similarity: number }>;
    for (const row of rows) if (row.similarity >= input.threshold) kept.push(row);
    if (kept.length > trimAt) {
      kept.sort((left, right) => right.similarity - left.similarity);
      kept.length = input.limit;
    }
  }
  kept.sort((left, right) => right.similarity - left.similarity);
  return kept.slice(0, input.limit);
}

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    // performance.now(), not Date.now(): a duration measured against the wall clock steps when
    // the clock does — an NTP correction or a sleep lands directly in the number, and a sweep that
    // took five seconds can report as a fraction of one or as a minute. The timestamp at the start
    // of the line stays wall clock, because that is for lining log lines up against each other.
    const started = performance.now();
    const trace: SweepTrace = { visited: 0, windows: 0, skipped: 0, fingerprint: '-' };
    const rows = scan(request, trace);
    const ms = performance.now() - started;
    // Every sweep, not only the slow ones: a cost cannot be attributed from a sample that excludes
    // the cheap cases, which is what suppressing them produced elsewhere in this codebase today.
    const perRow = trace.visited ? (ms * 1000 / trace.visited).toFixed(1) : '–';
    console.info(`${new Date().toISOString()} [vectorScanWorker] ${request.scan.table} scan ${(ms / 1000).toFixed(2)}s · ${rows.length} kept of ${trace.visited} visited (${trace.skipped} unembedded) · ${trace.windows} window(s) · ${perRow}µs/row · query ${trace.fingerprint} · ${request.scan.params.length} params`);
    parentPort?.postMessage({ id: request.id, ok: true, rows });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
});
