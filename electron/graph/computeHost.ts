/**
 * Host for the vector-math compute worker. Spawns the worker lazily, matches
 * responses to requests by id, and — crucially — degrades gracefully: if the
 * worker file is missing (dev stubs, tests) or the thread dies, every request
 * falls back to the chunked in-process implementation, which yields to the
 * event loop so the app stays responsive. Results are identical either way.
 */
import path from 'node:path';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { yieldToEventLoop } from '../util/async';
import {
  topMatchesPerCentroidChunked,
  topApproximateNeighborsChunked,
  type CentroidMatch,
  type LabeledVector,
  type NeighborMatch,
} from './similarityCore';

interface Pending {
  resolve: (matches: Array<CentroidMatch | NeighborMatch>) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextRequestId = 1;
const pending = new Map<number, Pending>();
let consecutiveTimeouts = 0;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * After this many timeouts in a row, stop paying the spawn + vector-transfer
 * cost and route everything to the chunked in-process path instead.
 */
const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** Overridable so tests can exercise the timeout path without waiting 2 minutes. */
function requestTimeoutMs(): number {
  const override = Number(process.env.NODUS_COMPUTE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_REQUEST_TIMEOUT_MS;
}

function workerFile(): string {
  // Bundled next to main.js by the vite worker entry; __dirname comes from the
  // ESM banner in vite.config.ts.
  return path.join(__dirname, 'computeWorker.js');
}

function workerDisabled(): boolean {
  return process.env.NODUS_DISABLE_COMPUTE_WORKER === '1';
}

function failAllPending(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

/**
 * Abandon a worker that blew the timeout.
 *
 * The worker runs each request as one synchronous loop, so a request that
 * overran cannot be cancelled cooperatively and will not answer a message: the
 * thread keeps burning a core until the process exits. Dropping the pending
 * entry alone (the previous behaviour) left that thread running forever AND
 * left every later request queued behind it in the worker's serial message
 * queue, each waiting out its own full timeout.
 *
 * Terminating is therefore the only real recovery. The next request lazily
 * spawns a fresh worker with an empty queue; callers of the failed request fall
 * back to the chunked in-process path, which yields to the event loop.
 */
function abandonTimedOutWorker(reason: string): void {
  consecutiveTimeouts += 1;
  const doomed = worker;
  worker = null;
  if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
    // Repeated timeouts mean the workload simply exceeds the budget; stop
    // re-spawning and let everything take the chunked path from here.
    workerBroken = true;
  }
  if (doomed) {
    void doomed.terminate().catch(() => undefined);
  }
  // Anything still queued was waiting behind the stuck job on the same thread.
  failAllPending(new Error(reason));
}

function getWorker(): Worker | null {
  if (workerDisabled() || workerBroken) return null;
  if (worker) return worker;
  const file = workerFile();
  if (!fs.existsSync(file)) {
    workerBroken = true;
    return null;
  }
  try {
    const spawned = new Worker(file);
    worker = spawned;
    spawned.unref(); // never keep the app alive just for the compute thread
    spawned.on('message', (res: { id: number; ok: boolean; matches?: Array<CentroidMatch | NeighborMatch>; error?: string }) => {
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.ok && res.matches) p.resolve(res.matches);
      else p.reject(new Error(res.error ?? 'compute worker error'));
    });
    // Events from a worker that is no longer the current one are ignored. A timed-out
    // worker is terminated on purpose and then exits with code 1; letting that exit mark
    // the host broken (and null out a successor spawned meanwhile) turned ONE timeout into
    // "inline for the rest of the session", bypassing MAX_CONSECUTIVE_TIMEOUTS.
    spawned.on('error', (err) => {
      if (worker !== spawned) return;
      workerBroken = true;
      worker = null;
      failAllPending(err instanceof Error ? err : new Error(String(err)));
    });
    spawned.on('exit', (code) => {
      if (worker !== spawned) return;
      worker = null;
      if (code !== 0) {
        workerBroken = true;
        failAllPending(new Error(`compute worker exited with code ${code}`));
      }
    });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runInline(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number
): Promise<CentroidMatch[]> {
  return topMatchesPerCentroidChunked(centroids, candidates, threshold, maxPerCentroid, yieldToEventLoop);
}

/**
 * Score candidates against centroids off the main thread when possible.
 * Vectors are copied into transferable buffers, so callers keep ownership of
 * the arrays they pass in.
 */
export async function computeThemeMatches(
  centroids: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerCentroid: number
): Promise<CentroidMatch[]> {
  const w = getWorker();
  if (!w) return runInline(centroids, candidates, threshold, maxPerCentroid);

  const id = nextRequestId++;
  const wire = (list: LabeledVector[]) =>
    list.map((v) => {
      const copy = new Float32Array(v.vector); // detach-safe copy
      return { id: v.id, buffer: copy.buffer };
    });
  const centroidWire = wire(centroids);
  const candidateWire = wire(candidates);
  const transfers = [...centroidWire, ...candidateWire].map((v) => v.buffer);

  try {
    return await new Promise<CentroidMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // Kill the thread before rejecting: it is still spinning on this job.
        abandonTimedOutWorker('compute worker timed out');
        reject(new Error('compute worker timed out'));
      }, requestTimeoutMs());
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          consecutiveTimeouts = 0;
          resolve(m as CentroidMatch[]);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      w.postMessage(
        { id, kind: 'themeMatches', centroids: centroidWire, candidates: candidateWire, threshold, maxPerCentroid },
        transfers
      );
    });
  } catch {
    // Worker failed mid-flight: recompute inline so the caller never sees it.
    return runInline(centroids, candidates, threshold, maxPerCentroid);
  }
}

/** Find a bounded approximate top-k off the main thread, with exact cosine scores for returned pairs. */
export async function computeNearestNeighbors(
  queries: LabeledVector[],
  candidates: LabeledVector[],
  threshold: number,
  maxPerQuery: number
): Promise<NeighborMatch[]> {
  const w = getWorker();
  if (!w) {
    return topApproximateNeighborsChunked(
      queries,
      candidates,
      threshold,
      maxPerQuery,
      yieldToEventLoop
    );
  }
  const id = nextRequestId++;
  const wire = (list: LabeledVector[]) =>
    list.map((value) => {
      const copy = new Float32Array(value.vector);
      return { id: value.id, buffer: copy.buffer };
    });
  const queryWire = wire(queries);
  const candidateWire = wire(candidates);
  try {
    return await new Promise<NeighborMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // Kill the thread before rejecting: it is still spinning on this job.
        abandonTimedOutWorker('nearest-neighbor worker timed out');
        reject(new Error('nearest-neighbor worker timed out'));
      }, requestTimeoutMs());
      pending.set(id, {
        resolve: (matches) => {
          clearTimeout(timer);
          consecutiveTimeouts = 0;
          resolve(matches as NeighborMatch[]);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      w.postMessage(
        {
          id,
          kind: 'nearestNeighbors',
          centroids: queryWire,
          candidates: candidateWire,
          threshold,
          maxPerCentroid: maxPerQuery,
        },
        [...queryWire, ...candidateWire].map((value) => value.buffer)
      );
    });
  } catch {
    return topApproximateNeighborsChunked(
      queries,
      candidates,
      threshold,
      maxPerQuery,
      yieldToEventLoop
    );
  }
}

/** Test/diagnostic hook: report which path computeThemeMatches will take. */
export function computeWorkerAvailable(): boolean {
  return getWorker() !== null;
}
