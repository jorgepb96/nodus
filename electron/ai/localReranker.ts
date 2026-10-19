import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, llamaServerPath, downloadVerifiedNodusAsset, installNodusLocalRuntime } from './nodusLocalAi';

/**
 * A local cross-encoder reranker (bge-reranker-v2-m3, Q8_0) for the textbook evidence search. It
 * reads the query and each candidate passage together, so it orders candidates the embedding and
 * keyword lanes found. On 40 chemistry queries over 46,072 textbook passages, reranking the top 30
 * raised the share of queries with a relevant passage in the top 5 from 0.82 to 0.88, and nDCG@5
 * from 0.786 to 0.829 (tools/retrieval-eval).
 *
 * It runs in its own llama-server beside the shared local-AI one, so a search does not swap the
 * embedding model out and back. The server starts on first use and stops after idling. Without the
 * model file (scripts/install-reranker.mjs puts it in place) nothing changes: `rerank` returns null.
 */

export const RERANKER_MODEL = {
  id: 'bge-reranker-v2-m3-q8_0',
  file: 'bge-reranker-v2-m3-Q8_0.gguf',
  url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/3093af03b1a635e67b084b1d8c03c5f5e020fd05/bge-reranker-v2-m3-Q8_0.gguf?download=true',
  bytes: 635_676_416,
  sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
  licence: 'Apache-2.0',
} as const;

const IDLE_MS = 5 * 60_000;
const START_TIMEOUT_MS = 60_000;
let download: { controller: AbortController; promise: Promise<void>; progress: number } | null = null;
export function localRerankerStatus() { return { available: rerankerAvailable(), downloading: !!download, progress: download?.progress ?? 0, bytes: RERANKER_MODEL.bytes }; }
export async function prepareLocalReranker(action: 'download' | 'cancel'): Promise<ReturnType<typeof localRerankerStatus>> {
  if (!['download', 'cancel'].includes(action)) throw new Error('Acción del reranker no válida.');
  if (action === 'cancel') { download?.controller.abort(); await download?.promise.catch(() => {}); return localRerankerStatus(); }
  if (rerankerAvailable()) return localRerankerStatus();
  if (!download) {
    const controller = new AbortController();
    const job = { controller, progress: 0, promise: Promise.resolve() };
    download = job;
    job.promise = (async () => {
      await installNodusLocalRuntime();
      controller.signal.throwIfAborted();
      let received = 0;
      await downloadVerifiedNodusAsset(RERANKER_MODEL.url, rerankerModelPath(), RERANKER_MODEL.bytes, RERANKER_MODEL.sha256,
        bytes => { received += bytes; job.progress = Math.min(1, received / RERANKER_MODEL.bytes); }, controller.signal);
    })().finally(() => { if (download === job) download = null; });
  }
  await download.promise;
  return localRerankerStatus();
}

let server: { child: ChildProcess; url: string; idle: NodeJS.Timeout | null } | null = null;
let starting: { promise: Promise<string | null>; controller: AbortController; users: number } | null = null;

export function rerankerModelPath(): string {
  return path.join(app.getPath('userData'), 'local-ai', 'models', RERANKER_MODEL.id, RERANKER_MODEL.file);
}

/** The model file is in place at its published size (its SHA-256 is checked when installed). */
export function rerankerAvailable(): boolean {
  try {
    return fs.statSync(rerankerModelPath()).size === RERANKER_MODEL.bytes;
  } catch {
    return false;
  }
}

function touch(): void {
  if (!server) return;
  if (server.idle) clearTimeout(server.idle);
  server.idle = setTimeout(stopReranker, IDLE_MS);
  server.idle.unref?.();
}

export function stopReranker(): void {
  starting?.controller.abort();
  const current = server;
  server = null;
  if (!current) return;
  if (current.idle) clearTimeout(current.idle);
  current.child.kill('SIGTERM');
}

async function startServer(signal: AbortSignal): Promise<string | null> {
  const executable = await llamaServerPath();
  signal.throwIfAborted();
  if (!executable || !rerankerAvailable()) return null;
  const port = await freePort();
  signal.throwIfAborted();
  const child = spawn(executable, [
    '--model', rerankerModelPath(), '--host', '127.0.0.1', '--port', String(port), '--reranking',
    '--ctx-size', '16384', '--parallel', '4', '--batch-size', '4096', '--ubatch-size', '4096',
    ...(process.platform === 'darwin' ? ['--n-gpu-layers', '999'] : ['--fit', 'on']),
    '--no-webui',
  ], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  try {
    while (Date.now() < deadline && child.exitCode == null) {
      signal.throwIfAborted();
      try {
        if ((await fetch(`${url}/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) })).ok) {
          signal.throwIfAborted();
          server = { child, url, idle: null };
          child.once('exit', () => { if (server?.child === child) server = null; });
          touch();
          return url;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        /* not listening yet */
      }
      await delay(250, undefined, { signal });
    }
    console.warn('[reranker] the local reranker did not start; textbook evidence keeps its fused order');
    return null;
  } finally {
    if (server?.child !== child) child.kill('SIGKILL');
  }
}

async function ensureServer(signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  if (server && server.child.exitCode == null) { touch(); return server.url; }
  if (!starting || starting.controller.signal.aborted) {
    const pending = { promise: Promise.resolve<string | null>(null), controller: new AbortController(), users: 0 };
    pending.promise = startServer(pending.controller.signal).finally(() => { if (starting === pending) starting = null; });
    starting = pending;
  }
  const pending = starting;
  pending.users++;
  let abort: (() => void) | undefined;
  try {
    if (!signal) return await pending.promise;
    return await Promise.race([pending.promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    pending.users--;
    // Cancelling one caller does not kill a startup another live search still needs.
    if (!pending.users && starting === pending) pending.controller.abort();
  }
}

/** Relevance scores for `documents` against `query`, in input order; null when the reranker is
 *  not installed or fails (the caller keeps its own order). */
export async function rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[] | null> {
  signal?.throwIfAborted();
  if (!documents.length || !rerankerAvailable()) return null;
  try {
    const url = await ensureServer(signal);
    signal?.throwIfAborted();
    if (!url) return null;
    const response = await fetch(`${url}/v1/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, documents, top_n: documents.length }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { results?: Array<{ index: number; relevance_score: number }> };
    const scores = new Array<number>(documents.length).fill(Number.NEGATIVE_INFINITY);
    for (const item of body.results ?? []) if (item.index >= 0 && item.index < scores.length) scores[item.index] = item.relevance_score;
    touch();
    return scores;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[reranker] rerank failed; textbook evidence keeps its fused order:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

app.on?.('will-quit', stopReranker);
