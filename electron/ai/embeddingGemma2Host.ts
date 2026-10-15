import { assertNodusLocalModelAvailable } from '../../shared/embeddingGemma2Availability';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { backgroundProcess, type BackgroundProcess } from '../workers/backgroundProcess';
import { recordEmbeddingTrace } from '../qa/embeddingTrace';
import { EMBEDDING_GEMMA2_PROFILES, isEmbeddingGemma2, prepareEmbeddingGemma2Input, type EmbeddingRole } from '../../shared/embeddingGemma2';

interface Job {
  id: number; operation: 'plan' | 'infer'; texts: string[]; dimensions: number; role: EmbeddingRole;
  resolve: (result: number[][]) => void; reject: (error: unknown) => void;
  signal?: AbortSignal; abort: () => void; timer?: NodeJS.Timeout; qaSample?: NodeJS.Timeout; qaPeakRss?: number;
}
interface WorkerReply { id: number; operation?: string; ok?: boolean; fatal?: boolean; result?: number[][]; error?: string }
let worker: BackgroundProcess | null = null, directory: string | null = null, active: Job | null = null;
let workerReady = false, activeDispatchedId: number | null = null, nextId = 0, idle: NodeJS.Timeout | undefined;
let handshakeTimer: NodeJS.Timeout | undefined;
let terminating: Promise<void> | null = null;
const queue: Job[] = [];
const IDLE_MS = 5 * 60_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const QA_TRACE = (() => {
  try {
    const rootArg = process.env.NODUS_ISOLATED_ROOT;
    if (process.env.NODUS_EMBEDDING_QA_TRACE !== '1' || !rootArg) return false;
    const root = fs.realpathSync(rootArg);
    const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
    return marker.format === 'nodus.isolated-research-profile/1' && marker.root === root
      && fs.realpathSync(app.getPath('userData')).startsWith(`${root}${path.sep}`);
  } catch { return false; }
})();
let workerPid: number | undefined, workerStdout = '', workerStderr = '';
const appendTail = (current: string, value: string) => `${current}${value}`.slice(-12_000);
function trace(event: Record<string, unknown>) { if (QA_TRACE) recordEmbeddingTrace(event); }
function jobTraceMetadata(job: Job) {
  const json = JSON.stringify({ id: job.id, operation: job.operation, texts: job.texts, dimensions: job.dimensions });
  const requestBytes = Buffer.byteLength(json);
  return { rows: job.texts.length, operation: job.operation, requestBytes, maxRequestBytes: requestBytes,
    requestSha256: createHash('sha256').update(json).digest('hex') };
}
function sampleWorkerRss(): number {
  if (!QA_TRACE || !workerPid) return 0;
  try { return (app.getAppMetrics().find(metric => metric.pid === workerPid)?.memory.workingSetSize ?? 0) * 1024; }
  catch { return 0; }
}
function traceJobEnd(job: Job, outcome: string, error?: unknown) {
  if (job.qaSample) clearInterval(job.qaSample);
  trace({ type: 'embedding-gemma-process', phase: 'job-end', pid: workerPid, ...jobTraceMetadata(job), outcome,
    peakRssWorkerBytes: Math.max(job.qaPeakRss ?? 0, sampleWorkerRss()), errorCode: error instanceof Error ? error.name : undefined,
    stdoutTail: workerStdout || undefined, stderrTail: workerStderr || undefined });
  workerStdout = ''; workerStderr = '';
}

function settle(job: Job, error?: unknown, result?: number[][]) {
  traceJobEnd(job, error ? 'failed' : 'completed', error);
  clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
  if (error) job.reject(error); else job.resolve(result!);
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}
function reset(error: Error, shutdown = false) {
  const old = worker; worker = null; workerReady = false; activeDispatchedId = null;
  clearTimeout(idle); clearTimeout(handshakeTimer); handshakeTimer = undefined;
  if (active) { settle(active, error); active = null; }
  if (shutdown) for (const job of queue.splice(0)) settle(job, error);
  if (old) {
    // Do not allocate a replacement ONNX process until its OS process and native
    // worker thread have both exited.
    const pid = workerPid;
    trace({ type: 'embedding-gemma-process', phase: 'terminate-requested', pid, errorCode: error.name });
    const completion = old.terminate().then(code => {
      trace({ type: 'embedding-gemma-process', phase: 'exit', pid, exitCode: code, stdoutTail: workerStdout || undefined, stderrTail: workerStderr || undefined });
      workerStdout = ''; workerStderr = '';
      return undefined;
    }, () => undefined);
    terminating = completion;
    void completion.then(() => { if (terminating === completion) { terminating = null; pump(); } });
  } else if (!shutdown) pump();
}
export function closeEmbeddingGemma2Worker() { reset(new Error('EmbeddingGemma: runtime cerrado.'), true); }
export function embeddingGemma2Busy() { return Boolean(active || queue.length); }

function dispatchActive() {
  if (!worker || !workerReady || !active || terminating || activeDispatchedId === active.id) return;
  const job = active;
  try {
    worker.setIdle(false);
    activeDispatchedId = job.id;
    if (QA_TRACE) {
      job.qaPeakRss = sampleWorkerRss();
      job.qaSample = setInterval(() => { job.qaPeakRss = Math.max(job.qaPeakRss ?? 0, sampleWorkerRss()); }, 250);
      trace({ type: 'embedding-gemma-process', phase: 'job-start', pid: workerPid, ...jobTraceMetadata(job) });
    }
    job.timer = setTimeout(() => reset(new Error('EmbeddingGemma: tiempo de inferencia agotado.'), true), JOB_TIMEOUT_MS);
    worker.postMessage({ id: job.id, operation: job.operation, texts: job.texts, dimensions: job.dimensions });
  } catch (error) { reset(new Error(errorMessage(error)), true); }
}
function getWorker() {
  if (worker) return worker;
  const current = backgroundProcess(path.join(__dirname, 'embeddingGemma2Worker.cjs'), 'Nodus EmbeddingGemma Q8', { captureOutput: QA_TRACE });
  worker = current;
  workerPid = current.pid;
  current.on('spawn', (pid: number) => {
    workerPid = pid; workerStdout = ''; workerStderr = '';
    trace({ type: 'embedding-gemma-process', phase: 'spawn', pid, service: 'Nodus EmbeddingGemma Q8' });
  });
  current.on('output', (event: { stream: 'stdout' | 'stderr'; data: string }) => {
    if (event.stream === 'stdout') workerStdout = appendTail(workerStdout, event.data);
    else workerStderr = appendTail(workerStderr, event.data);
  });
  current.on('message', (reply: WorkerReply) => {
    if (worker !== current) return;
    if (reply.operation === 'ready' && reply.id === 0) {
      if (workerReady) return;
      clearTimeout(handshakeTimer); handshakeTimer = undefined;
      workerReady = true;
      dispatchActive();
      return;
    }
    if (reply.operation === 'error' && reply.id === 0) {
      reset(new Error(`EmbeddingGemma no disponible: ${reply.error ?? 'falló la inicialización del proceso aislado'}`), true);
      return;
    }
    if (!active || active.id !== reply.id) return;
    if (!reply.ok) {
      const failure = new Error(reply.error ?? 'EmbeddingGemma: la solicitud aislada falló.');
      if (reply.fatal) reset(new Error(`EmbeddingGemma no disponible: ${failure.message}`), true);
      else {
        const job = active; active = null; activeDispatchedId = null;
        settle(job, failure);
        queueMicrotask(pump);
      }
      return;
    }
    const job = active; active = null; activeDispatchedId = null;
    settle(job, job.signal?.aborted ? job.signal.reason ?? new Error('Cancelado') : undefined, reply.result);
    // Let a completed query plan enqueue inference before dispatching the next
    // background batch.
    queueMicrotask(pump);
  });
  current.on('error', error => { if (worker === current) reset(new Error(`EmbeddingGemma no disponible: ${errorMessage(error)}`), true); });
  current.on('exit', code => { if (worker === current) reset(new Error(`EmbeddingGemma no disponible: proceso aislado terminó (${code}).`), true); });
  current.on('spawn', () => {
    if (worker !== current || workerReady) return;
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
      if (worker === current && !workerReady) reset(new Error('EmbeddingGemma no disponible: expiró el handshake del proceso aislado.'), true);
    }, HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref();
  });
  current.setIdle(false);
  current.postMessage({ id: 0, operation: 'init', directory, threads: Math.max(1, Math.min(4, os.availableParallelism() - 1)), dtype: 'q8' });
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
    idle.unref(); worker.setIdle(true); return;
  }
  try {
    const current = getWorker();
    current.setIdle(false);
    if (workerReady) dispatchActive();
  } catch (error) { reset(new Error(`EmbeddingGemma no disponible: ${errorMessage(error)}`), true); }
}
function submit(operation: Job['operation'], texts: string[], dimensions: number, role: EmbeddingRole, signal?: AbortSignal): Promise<number[][]> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const job: Job = { id: ++nextId, operation, texts, dimensions, role, resolve, reject, signal, abort: () => {
      if (active === job) reset(new Error('EmbeddingGemma: solicitud cancelada.'), false);
      else { const index = queue.indexOf(job); if (index >= 0) { queue.splice(index, 1); settle(job, signal?.reason ?? new Error('Cancelado')); } }
    } };
    signal?.addEventListener('abort', job.abort, { once: true }); queue.push(job); pump();
  });
}
export async function embedEmbeddingGemma2(model: string, modelDirectory: string, texts: string[], options: { role?: EmbeddingRole; title?: string; titles?: (string | undefined)[] }, signal?: AbortSignal): Promise<number[][]> {
  if (!isEmbeddingGemma2(model)) throw new Error('Perfil EmbeddingGemma desconocido.');
  assertNodusLocalModelAvailable(model, process.platform, process.arch);
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
