import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { EMBEDDING_GEMMA2_PROFILES, isEmbeddingGemma2, prepareEmbeddingGemma2Input, type EmbeddingRole } from '../../shared/embeddingGemma2';

interface Job {
  id: number; operation: 'plan' | 'infer'; texts: string[]; dimensions: number; role: EmbeddingRole;
  resolve: (result: number[][]) => void; reject: (error: unknown) => void;
  signal?: AbortSignal; abort: () => void; timer?: NodeJS.Timeout;
}
let worker: Worker | null = null, directory: string | null = null, active: Job | null = null;
let nextId = 0, idle: NodeJS.Timeout | undefined;
let terminating: Promise<void> | null = null;
const queue: Job[] = [];
const IDLE_MS = 5 * 60_000;

function settle(job: Job, error?: unknown, result?: number[][]) {
  clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
  if (error) job.reject(error); else job.resolve(result!);
}
function reset(error: Error, shutdown = false) {
  const old = worker; worker = null;
  clearTimeout(idle);
  if (active) { settle(active, error); active = null; }
  if (shutdown) for (const job of queue.splice(0)) settle(job, error);
  if (old) {
    // Do not allocate a replacement ONNX session until native teardown finishes.
    const completion = old.terminate().then(() => undefined, () => undefined);
    terminating = completion;
    void completion.then(() => { if (terminating === completion) { terminating = null; pump(); } });
  } else if (!shutdown) pump();
}
export function closeEmbeddingGemma2Worker() { reset(new Error('EmbeddingGemma: runtime cerrado.'), true); }
export function embeddingGemma2Busy() { return Boolean(active || queue.length); }

function getWorker() {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, 'embeddingGemma2Worker.cjs'), { workerData: {
    directory, threads: Math.max(1, Math.min(4, os.availableParallelism() - 1)),
  } });
  worker = current;
  current.on('message', reply => {
    if (worker !== current || !active || active.id !== reply.id) return;
    const job = active; active = null;
    settle(job, job.signal?.aborted ? job.signal.reason ?? new Error('Cancelado') : reply.ok ? undefined : new Error(`EmbeddingGemma no disponible: ${reply.error}`), reply.result);
    // Let a completed query plan enqueue its inference before choosing the next
    // background batch. Resolving the promise schedules that continuation first.
    queueMicrotask(pump);
  });
  current.on('error', error => { if (worker === current) reset(error, true); });
  current.on('exit', code => { if (worker === current) reset(new Error(`EmbeddingGemma: worker terminó (${code}).`), true); });
  return current;
}
function pump() {
  if (active || terminating) return;
  clearTimeout(idle);
  const index = queue.findIndex(job => job.role === 'query');
  active = queue.splice(index < 0 ? 0 : index, 1)[0] ?? null;
  if (!active) {
    if (!worker) return;
    idle = setTimeout(() => reset(new Error('EmbeddingGemma: runtime inactivo.'), true), IDLE_MS);
    idle.unref(); worker?.unref(); return;
  }
  const job = active;
  try {
    const current = getWorker(); current.ref();
    job.timer = setTimeout(() => reset(new Error('EmbeddingGemma: tiempo de inferencia agotado.'), true), 10 * 60_000);
    current.postMessage({ id: job.id, operation: job.operation, texts: job.texts, dimensions: job.dimensions });
  } catch (error) { reset(error instanceof Error ? error : new Error(String(error)), true); }
}
function submit(operation: Job['operation'], texts: string[], dimensions: number, role: EmbeddingRole, signal?: AbortSignal): Promise<number[][]> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const job: Job = { id: ++nextId, operation, texts, dimensions, role, resolve, reject, signal, abort: () => {
      if (active === job) reset(new Error('EmbeddingGemma: solicitud cancelada.'));
      else { const index = queue.indexOf(job); if (index >= 0) { queue.splice(index, 1); settle(job, signal?.reason ?? new Error('Cancelado')); } }
    } };
    signal?.addEventListener('abort', job.abort, { once: true }); queue.push(job); pump();
  });
}
export async function embedEmbeddingGemma2(model: string, modelDirectory: string, texts: string[], options: { role?: EmbeddingRole; title?: string; titles?: (string | undefined)[] }, signal?: AbortSignal): Promise<number[][]> {
  if (!isEmbeddingGemma2(model)) throw new Error('Perfil EmbeddingGemma desconocido.');
  if (directory && directory !== modelDirectory && embeddingGemma2Busy()) throw new Error('EmbeddingGemma: otra biblioteca está en uso.');
  if (directory !== modelDirectory) { closeEmbeddingGemma2Worker(); directory = modelDirectory; }
  const role = options.role ?? 'document';
  if (options.titles && options.titles.length !== texts.length) throw new Error('EmbeddingGemma: títulos desalineados.');
  const prepared = texts.map((text, index) => prepareEmbeddingGemma2Input(text, role, options.titles?.[index] ?? options.title));
  const dimensions = EMBEDDING_GEMMA2_PROFILES[model];
  const cancel = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
  try {
    const batches = await submit('plan', prepared, dimensions, role, requestSignal);
    const output = Array<number[]>(texts.length);
    await Promise.all(batches.map(async indices => {
      const vectors = await submit('infer', indices.map(index => prepared[index]), dimensions, role, requestSignal);
      indices.forEach((index, row) => { output[index] = vectors[row]; });
    }));
    requestSignal.throwIfAborted();
    return output;
  } catch (error) { cancel.abort(error); throw error; }
}
