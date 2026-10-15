import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { build } from 'esbuild';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-eg2-host-'));
const instances = [], requests = [];
const realProcesses = [];
const traceEvents = [];
const isolatedRoot = fsSync.realpathSync(scratch);
await fs.mkdir(path.join(scratch, 'profile'), { recursive: true });
await fs.writeFile(path.join(scratch, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root: isolatedRoot }));
process.env.NODUS_ISOLATED_ROOT = isolatedRoot;
process.env.NODUS_EMBEDDING_QA_TRACE = '1';
globalThis.embeddingQaUserData = path.join(isolatedRoot, 'profile');
globalThis.embeddingQaMetrics = [{ pid: 42910, memory: { workingSetSize: 32 } }];
globalThis.embeddingQaTraceEvents = traceEvents;
class RealChildProcess extends EventEmitter {
  constructor(file, serviceName) {
    super(); this.file = file; this.serviceName = serviceName; this.messages = [];
    const parent = path.resolve('scripts/testchild-embeddinggemma-host.cjs');
    const worker = path.resolve('scripts/testchild-embeddinggemma-crash-worker.cjs');
    this.child = fork(parent, [worker], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
    this.hasExited = false;
    this.exited = new Promise(resolve => this.child.once('exit', (code, signal) => {
      this.exitCode = code; this.exitSignal = signal; this.hasExited = true; this.emit('exit', code ?? 1); resolve(code ?? 1);
    }));
    this.child.on('message', message => this.emit('message', message));
    this.child.on('error', error => this.emit('error', error));
    instances.push(this); realProcesses.push(this);
  }
  postMessage(message) { this.messages.push(message); if (this.child.connected) this.child.send(message); }
  setIdle(idle) { if (idle) this.child.unref(); else this.child.ref(); }
  unref() { this.child.unref(); }
  terminate() { if (!this.hasExited) this.child.kill('SIGTERM'); return this.exited; }
}
class ControlledProcess extends EventEmitter {
  constructor(file, serviceName, options) { super(); this.file = file; this.serviceName = serviceName; this.options = options; this.pid = 42910; instances.push(this); }
  postMessage(message) {
    if (this.throwAt === message.operation) throw this.throwError;
    requests.push({ worker: this, message });
  }
  setIdle() {} unref() {}
  terminate() { this.termination = new Promise(resolve => { this.finishTermination = resolve; }); return this.termination; }
  reply(request, result) { this.emit('message', { id: request.message.id, ok: true, result }); }
  reject(request, error, fatal = false) { this.emit('message', { id: request.message.id, ok: false, error, fatal }); }
}
globalThis.embeddingQaBackgroundFactory = (file, serviceName, options) => {
  if (globalThis.embeddingQaFailureMode === 'create') throw 'background process create failure';
  const process = new ControlledProcess(file, serviceName, options);
  process.throwAt = globalThis.embeddingQaFailureMode;
  process.throwError = 'background process post failure';
  return process;
};
const file = path.join(scratch, 'host.cjs');
await build({ entryPoints: ['electron/ai/embeddingGemma2Host.ts'], outfile: file, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  // Controlled workers test scheduling on a supported simulated platform. Intel
  // denial is exercised separately against the real manager and direct host.
  define: { 'process.platform': '"linux"' },
  plugins: [{ name: 'controlled-native-lifecycle', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/workers\/backgroundProcess$/ }, () => ({ path: 'background-process', namespace: 'qa-bg' }));
    builder.onLoad({ filter: /.*/, namespace: 'qa-bg' }, () => ({ contents: 'export function backgroundProcess(file, name, options) { return globalThis.embeddingQaBackgroundFactory(file, name, options); }', loader: 'js' }));
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-stub', namespace: 'qa-electron' }));
    builder.onLoad({ filter: /.*/, namespace: 'qa-electron' }, () => ({ contents: 'export const app = { getPath: () => globalThis.embeddingQaUserData, getAppMetrics: () => globalThis.embeddingQaMetrics };', loader: 'js' }));
    builder.onResolve({ filter: /^\.\.\/qa\/embeddingTrace$/ }, () => ({ path: 'embedding-trace', namespace: 'qa-trace' }));
    builder.onLoad({ filter: /.*/, namespace: 'qa-trace' }, () => ({ contents: 'export function recordEmbeddingTrace(event) { globalThis.embeddingQaTraceEvents.push(event); }', loader: 'js' }));
  } }] });
const host = createRequire(import.meta.url)(file), profile = 'embeddinggemma-2-text-q8-512-v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const next = () => { const request = requests.shift(); assert(request, 'scheduler dispatched a request'); return request; };
const reply = (request, result) => request.worker.reply(request, result);
const initialize = async () => {
  const init = next(); assert.equal(init.message.operation, 'init');
  assert.equal(init.message.directory, scratch); assert.equal(init.message.dtype, 'q8');
  assert(init.message.threads >= 1 && init.message.threads <= 4);
  init.worker.emit('message', { id: 0, operation: 'ready' });
  await tick();
};
test.after(async () => { host.closeEmbeddingGemma2Worker(); for (const worker of instances) { worker.finishTermination?.(); if (worker instanceof RealChildProcess) await worker.terminate(); } delete globalThis.embeddingQaBackgroundFactory; await fs.rm(scratch, { recursive: true, force: true }); });

test('query overtakes pending indexing batches and restores document order', { concurrency: false }, async () => {
  const documents = host.embedEmbeddingGemma2(profile, scratch, ['a', 'b', 'c'], { titles: ['A', 'B', 'C'] });
  await initialize();
  const plan = next(); assert.equal(plan.message.operation, 'plan'); reply(plan, [[0], [1], [2]]); await tick();
  const first = next(); assert.deepEqual(first.message.texts, ['title: A | text: a']);
  const query = host.embedEmbeddingGemma2(profile, scratch, ['q'], { role: 'query' });
  reply(first, [[1]]); await tick();
  const queryPlan = next(); assert.equal(queryPlan.message.operation, 'plan'); assert.equal(queryPlan.message.texts[0], 'task: search result | query: q');
  reply(queryPlan, [[0]]); await tick();
  const queryInference = next(); assert.equal(queryInference.message.texts[0], 'task: search result | query: q'); reply(queryInference, [[9]]); await tick();
  assert.deepEqual(await query, [[9]]);
  for (const value of [2, 3]) { reply(next(), [[value]]); await tick(); }
  assert.deepEqual(await documents, [[1], [2], [3]]);
  assert(instances[0].file.endsWith('embeddingGemma2Worker.cjs'));
  assert.equal(instances[0].serviceName, 'Nodus EmbeddingGemma Q8');
  assert.equal(instances[0].options.captureOutput, true, 'only the marked QA runtime opts into child output capture');
  const metadata = traceEvents.filter(event => event.type === 'embedding-gemma-process' && event.phase === 'job-end');
  assert(metadata.some(event => event.pid === 42910 && event.rows === 3 && event.operation === 'plan'
    && event.maxRequestBytes > 0 && /^[a-f0-9]{64}$/u.test(event.requestSha256) && event.peakRssWorkerBytes >= 32 * 1024));
  assert(!JSON.stringify(metadata).includes('title: A | text: a'), 'embedding QA trace does not persist request text');
  host.closeEmbeddingGemma2Worker(); instances[0].finishTermination(); await tick();
});

test('active cancellation preserves an independent query queued for fresh-process recovery', { concurrency: false }, async () => {
  const abort = new AbortController();
  const cancelled = host.embedEmbeddingGemma2(profile, scratch, ['cancel'], {}, abort.signal);
  const rejected = assert.rejects(cancelled, /cancelada/);
  const init = next(); assert.equal(init.message.operation, 'init'); init.worker.emit('message', { id: 0, operation: 'ready' }); await tick();
  const replacement = host.embedEmbeddingGemma2(profile, scratch, ['next'], { role: 'query' });
  const pending = next(); abort.abort(); await rejected;
  await tick(); assert.equal(requests.length, 0); assert.equal(instances.length, 2);
  // A late native reply is ignored, even while the old worker is terminating.
  pending.worker.finishTermination(); await tick();
  const replacementInit = next(); assert.equal(replacementInit.message.operation, 'init'); replacementInit.worker.emit('message', { id: 0, operation: 'ready' }); await tick();
  const plan = next(); assert.equal(instances.length, 3); reply(plan, [[0]]); await tick(); reply(next(), [[7]]);
  assert.deepEqual(await replacement, [[7]]);
  host.closeEmbeddingGemma2Worker(); instances.at(-1).finishTermination(); await tick();
});

test('native crash rejects all outstanding jobs without changing profile or precision', { concurrency: false }, async () => {
  const a = host.embedEmbeddingGemma2(profile, scratch, ['a'], {});
  const b = host.embedEmbeddingGemma2(profile, scratch, ['b'], {});
  const failures = [assert.rejects(a, /out of memory/), assert.rejects(b, /out of memory/)];
  const init = next(); init.worker.emit('message', { id: 0, operation: 'ready' }); await tick();
  const active = next(); active.worker.emit('error', new Error('out of memory')); await Promise.all(failures);
  assert.equal(requests.length, 0); assert.equal(host.embeddingGemma2Busy(), false);
  active.worker.finishTermination(); await tick();
  const recovery = host.embedEmbeddingGemma2(profile, scratch, ['recovery'], {});
  await initialize();
  const plan = next(); assert.equal(plan.message.dimensions, 512);
  reply(plan, [[0]]); await tick(); reply(next(), [[8]]); assert.deepEqual(await recovery, [[8]]);
  host.closeEmbeddingGemma2Worker(); instances.at(-1).finishTermination(); await tick();
});

test('synchronous creation, init and dispatch errors reject jobs instead of stranding them', { concurrency: false }, async () => {
  globalThis.embeddingQaFailureMode = 'create';
  const createFailure = host.embedEmbeddingGemma2(profile, scratch, ['create failure'], {});
  await assert.rejects(createFailure, /background process create failure/);
  assert.equal(host.embeddingGemma2Busy(), false);

  globalThis.embeddingQaFailureMode = 'init';
  const initFailure = host.embedEmbeddingGemma2(profile, scratch, ['init failure'], {});
  await assert.rejects(initFailure, /background process post failure/);
  instances.at(-1).finishTermination(); await tick();
  assert.equal(host.embeddingGemma2Busy(), false);

  globalThis.embeddingQaFailureMode = 'plan';
  const postFailure = host.embedEmbeddingGemma2(profile, scratch, ['post failure'], {});
  const init = next(); init.worker.emit('message', { id: 0, operation: 'ready' });
  await assert.rejects(postFailure, /background process post failure/);
  instances.at(-1).finishTermination(); await tick();
  assert.equal(host.embeddingGemma2Busy(), false);
  globalThis.embeddingQaFailureMode = undefined;
});

test('utility error events may contain strings', { concurrency: false }, async () => {
  const failed = host.embedEmbeddingGemma2(profile, scratch, ['string error'], {});
  const init = next(); init.worker.emit('message', { id: 0, operation: 'ready' }); await tick();
  const plan = next();
  const rejected = assert.rejects(failed, /utility fatal string/);
  plan.worker.emit('error', 'utility fatal string');
  await rejected;
  instances.at(-1).finishTermination(); await tick();
  assert.equal(host.embeddingGemma2Busy(), false);
});

test('input validation failure rejects only that job and leaves queued query usable', { concurrency: false }, async () => {
  const instanceCount = instances.length;
  const invalid = host.embedEmbeddingGemma2(profile, scratch, ['x'.repeat(9000)], {});
  const invalidRejected = assert.rejects(invalid, /presupuesto de tokens/);
  const init = next(); init.worker.emit('message', { id: 0, operation: 'ready' }); await tick();
  const invalidPlan = next();
  const query = host.embedEmbeddingGemma2(profile, scratch, ['short query'], { role: 'query' });
  invalidPlan.worker.reject(invalidPlan, 'EmbeddingGemma: presupuesto de tokens excedido.', false);
  await invalidRejected; await tick();
  const queryPlan = next(); assert.equal(queryPlan.message.operation, 'plan');
  reply(queryPlan, [[0]]); await tick(); reply(next(), [[4]]);
  assert.deepEqual(await query, [[4]]);
  assert.equal(instances.length, instanceCount + 1, 'nonfatal input error does not poison or replace the worker');
  host.closeEmbeddingGemma2Worker(); instances.at(-1).finishTermination(); await tick();
});

test('OS child crash is contained and a fresh child recovers with the same Q8 configuration', { concurrency: false }, async () => {
  host.closeEmbeddingGemma2Worker();
  instances.at(-1)?.finishTermination?.();
  await tick();
  globalThis.embeddingQaBackgroundFactory = (file, serviceName) => new RealChildProcess(file, serviceName);
  const ownerPid = process.pid;
  const crashed = host.embedEmbeddingGemma2(profile, scratch, ['crash'], { role: 'query' });
  await assert.rejects(crashed, /EmbeddingGemma no disponible/);
  assert.equal(process.pid, ownerPid, 'the owning test process remains alive');
  assert.equal(realProcesses[0].exitSignal, 'SIGKILL', 'only the disposable child was killed');
  assert.equal(host.embeddingGemma2Busy(), false);

  const recovered = host.embedEmbeddingGemma2(profile, scratch, ['recovered'], { role: 'query' });
  assert.deepEqual(await recovered, [[7]]);
  assert.equal(realProcesses.length, 2, 'recovery starts a new OS child');
  const init = realProcesses[1].messages.find(message => message.operation === 'init');
  assert.deepEqual({ directory: init.directory, dtype: init.dtype, threadsValid: init.threads >= 1 && init.threads <= 4 },
    { directory: scratch, dtype: 'q8', threadsValid: true });
  assert(realProcesses[1].messages.some(message => message.operation === 'plan'));
  assert(realProcesses[1].messages.some(message => message.operation === 'infer' && message.texts[0].endsWith('query: recovered')));
});
