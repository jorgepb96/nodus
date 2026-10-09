import { getDb, setVectorScanQuery } from './database';
import { yieldToEventLoop } from '../util/async';
import { scanSimilarInWorker } from './vectorScanHost';

// ─────────────────────────────────────────────────────────────────────────────
// Similarity search that lets the app breathe.
//
// There is no vector index: every semantic search is a full scan that pulls each
// stored embedding across the SQLite→JS boundary and cosines it there. On a real
// corpus (~10k ideas, ~33k passages, 1024 dimensions) one passage scan blocks the
// main process for several hundred milliseconds, and a single Deep Research report
// runs one per probe plus one per section — with a queue of reports, that is the
// whole session. Nothing else in the process moves while a scan is running: not the
// window, not another IPC call, not the queue itself.
//
// So the scan walks the table in rowid windows and yields the event loop between
// them. Same rows, same cosine, same ranking — the difference is that it can be
// interrupted.
//
// Two things about the paging are load-bearing and easy to undo by accident:
//
//   · It is a rowid WINDOW (`rowid > ? AND rowid <= ?`), not `ORDER BY rowid LIMIT`.
//     The latter reads as the obvious way to page, but SQLite answers it by scoring
//     every candidate row in the table and sorting them into a temp b-tree — for
//     each page. Measured on the real corpus that made a passage scan three times
//     more expensive overall. A window is a plain b-tree range walk.
//
//   · It is not a statement iterator. An open iterator makes the connection busy,
//     and every yield here is a chance for the renderer to run a query of its own,
//     which would then throw.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Width of one rowid window. Sized so a window is a few tens of milliseconds on a
 * large corpus: small enough that the window keeps painting, large enough that the
 * per-statement overhead stays negligible against the cosine work itself.
 */
const WINDOW_ROWIDS = 1_500;

function unitVector(values: number[]): Float32Array | null {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  if (norm === 0) return null;
  const length = Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) vector[i] /= length;
  return vector;
}

interface ScoredRow {
  rid: number;
  similarity: number;
}

export interface VectorScan {
  /** The table the rowid windows walk. A constant in our own code, never user input. */
  table: string;
  /**
   * `SELECT <id column>, <rowid> AS rid, vec_scan(<embedding>) AS similarity FROM …`
   * whose WHERE starts with `<rowid> > ? AND <rowid> <= ?` and continues with its own
   * conditions, taking `params` in order. No ORDER BY and no LIMIT — see above.
   */
  sql: string;
  /** The statement's own parameters, after the two window bounds. */
  params: unknown[];
  query: number[];
  threshold: number;
  limit: number;
}

/**
 * Scan a table for the `limit` rows most similar to `query`, without ever holding the
 * event loop for the whole scan.
 *
 * Rows are ranked by id only: pulling the payload of every row through SQLite, to then
 * throw all but a few dozen away, is work nobody asked for. Callers fetch what they
 * need for the winners.
 *
 * Rows written while the scan is in flight may or may not be seen, which is what any
 * ranked candidate pool over a live corpus already meant.
 */
export async function scanSimilar<T extends ScoredRow>(scan: VectorScan): Promise<T[]> {
  if (scan.limit <= 0) return [];
  const query = unitVector(scan.query);
  if (!query) return [];

  const db = getDb();
  const workerStarted = Date.now();
  const background = await scanSimilarInWorker<T>(db.name, scan);
  const workerMs = Date.now() - workerStarted;
  if (workerMs >= 1000) console.info(`${new Date().toISOString()} [vectorScan] ${scan.table} worker ${background ? 'answered' : 'unavailable'} in ${(workerMs / 1000).toFixed(1)}s`);
  if (background) return background;
  const highest = (db.prepare(`SELECT MAX(rowid) AS top FROM ${scan.table}`).get() as { top: number | null }).top ?? 0;
  if (highest === 0) return [];
  const statement = db.prepare(scan.sql);
  /** Re-sorted only when the pool grows past this; sorting every window would dominate. */
  const trimAt = Math.max(scan.limit * 4, 256);
  const kept: T[] = [];

  for (let from = 0; from < highest; from += WINDOW_ROWIDS) {
    const to = Math.min(from + WINDOW_ROWIDS, highest);
    // Armed immediately before the synchronous execution and disarmed straight
    // after, never across a yield: that is what makes a shared query vector safe.
    let window: T[];
    setVectorScanQuery(query);
    try {
      window = statement.all(from, to, ...scan.params) as T[];
    } finally {
      setVectorScanQuery(null);
    }

    for (const row of window) if (row.similarity >= scan.threshold) kept.push(row);
    if (kept.length > trimAt) {
      kept.sort((a, b) => b.similarity - a.similarity);
      kept.length = scan.limit;
    }
    if (to < highest) await yieldToEventLoop();
  }

  kept.sort((a, b) => b.similarity - a.similarity);
  return kept.slice(0, scan.limit);
}
