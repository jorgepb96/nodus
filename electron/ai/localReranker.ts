import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, llamaServerPath, downloadVerifiedNodusAsset, installNodusLocalRuntime } from './nodusLocalAi';
import { getSettings } from '../db/settingsRepo';
import { LOCAL_RERANKER_MODELS, getLocalRerankerModel, normalizeLocalRerankerId, type LocalRerankerModel } from '@shared/localRerankers';
import type { LocalRerankerStatus } from '@shared/embeddingComparison';

/**
 * A local cross-encoder reranker for the documentary and textbook evidence search. It reads the
 * query and each candidate passage together, so it orders candidates the embedding and keyword
 * lanes found. With bge-reranker-v2-m3 on 40 chemistry queries over 46,072 textbook passages,
 * reranking the top 30 raised the share of queries with a relevant passage in the top 5 from 0.82
 * to 0.88, and nDCG@5 from 0.786 to 0.829 (tools/retrieval-eval).
 *
 * The user picks one of the models in shared/localRerankers.ts. It runs in its own llama-server
 * beside the shared local-AI one, so a search does not swap the embedding model out and back. The
 * server starts on first use, restarts when another model is selected, and stops after idling.
 * Without the selected model file nothing changes: `rerank` returns null.
 */

const IDLE_MS = 5 * 60_000;
const START_TIMEOUT_MS = 60_000;
const downloads = new Map<string, { controller: AbortController; promise: Promise<void>; progress: number }>();

/** The selected model; a closed vault or an unknown id falls back to the historical default. */
export function selectedRerankerModel(): LocalRerankerModel {
  let id: unknown;
  try { id = getSettings().researchRerankerModel; } catch { /* no vault open yet */ }
  return getLocalRerankerModel(normalizeLocalRerankerId(id))!;
}
function requireModel(modelId: string | undefined): LocalRerankerModel {
  const model = modelId === undefined ? selectedRerankerModel() : getLocalRerankerModel(modelId);
  if (!model) throw new Error('Reranker local desconocido.');
  return model;
}

export function localRerankerStatus(): LocalRerankerStatus {
  const models = LOCAL_RERANKER_MODELS.map(model => {
    const job = downloads.get(model.id);
    return { id: model.id, available: rerankerAvailable(model.id), downloading: !!job, progress: job?.progress ?? 0, bytes: model.bytes };
  });
  const selected = selectedRerankerModel();
  const current = models.find(model => model.id === selected.id)!;
  return { selected: selected.id, available: current.available, downloading: current.downloading, progress: current.progress, bytes: current.bytes, models };
}

export async function prepareLocalReranker(action: 'download' | 'cancel', modelId?: string): Promise<LocalRerankerStatus> {
  if (!['download', 'cancel'].includes(action)) throw new Error('Acción del reranker no válida.');
  const model = requireModel(modelId);
  if (action === 'cancel') { const job = downloads.get(model.id); job?.controller.abort(); await job?.promise.catch(() => {}); return localRerankerStatus(); }
  if (rerankerAvailable(model.id)) return localRerankerStatus();
  let job = downloads.get(model.id);
  if (!job) {
    const controller = new AbortController();
    const created = { controller, progress: 0, promise: Promise.resolve() };
    job = created;
    downloads.set(model.id, created);
    created.promise = (async () => {
      await installNodusLocalRuntime();
      controller.signal.throwIfAborted();
      let received = 0;
      await downloadVerifiedNodusAsset(model.url, rerankerModelPath(model.id), model.bytes, model.sha256,
        bytes => { received += bytes; created.progress = Math.min(1, received / model.bytes); }, controller.signal);
    })().finally(() => { if (downloads.get(model.id) === created) downloads.delete(model.id); });
  }
  await job.promise;
  return localRerankerStatus();
}

/** Removes one model's files. A search that was using it falls back to the fused order. */
export async function deleteLocalReranker(modelId: string): Promise<LocalRerankerStatus> {
  const model = requireModel(modelId);
  if (downloads.has(model.id)) throw new Error('Espera a que termine la descarga antes de eliminar el modelo.');
  if (server?.modelId === model.id || starting?.modelId === model.id) stopReranker();
  fs.rmSync(path.dirname(rerankerModelPath(model.id)), { recursive: true, force: true });
  return localRerankerStatus();
}

let server: { child: ChildProcess; url: string; idle: NodeJS.Timeout | null; modelId: string } | null = null;
let starting: { promise: Promise<string | null>; controller: AbortController; users: number; modelId: string } | null = null;

export function rerankerModelPath(modelId = selectedRerankerModel().id): string {
  const model = requireModel(modelId);
  return path.join(app.getPath('userData'), 'local-ai', 'models', model.id, model.file);
}

/** The model file is in place at its published size (its SHA-256 is checked when installed). */
export function rerankerAvailable(modelId = selectedRerankerModel().id): boolean {
  try {
    return fs.statSync(rerankerModelPath(modelId)).size === requireModel(modelId).bytes;
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

async function startServer(model: LocalRerankerModel, signal: AbortSignal): Promise<string | null> {
  const executable = await llamaServerPath();
  signal.throwIfAborted();
  if (!executable || !rerankerAvailable(model.id)) return null;
  const port = await freePort();
  signal.throwIfAborted();
  const child = spawn(executable, [
    '--model', rerankerModelPath(model.id), '--host', '127.0.0.1', '--port', String(port), '--reranking',
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
          server = { child, url, idle: null, modelId: model.id };
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

async function ensureServer(model: LocalRerankerModel, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  if (server && server.child.exitCode == null && server.modelId === model.id) { touch(); return server.url; }
  // Another model was selected since this server (or its startup) began.
  if ((server && server.modelId !== model.id) || (starting && starting.modelId !== model.id)) stopReranker();
  if (!starting || starting.controller.signal.aborted) {
    const pending = { promise: Promise.resolve<string | null>(null), controller: new AbortController(), users: 0, modelId: model.id };
    pending.promise = startServer(model, pending.controller.signal).finally(() => { if (starting === pending) starting = null; });
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
  const model = selectedRerankerModel();
  if (!documents.length || !rerankerAvailable(model.id)) return null;
  try {
    const url = await ensureServer(model, signal);
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
