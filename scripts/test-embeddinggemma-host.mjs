import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-eg2-host-'));
const instances = [], requests = [];
class ControlledWorker extends EventEmitter {
  constructor(file, options) { super(); this.options = options; instances.push(this); }
  postMessage(message) { requests.push({ worker: this, message }); }
  ref() {} unref() {}
  terminate() { this.termination = new Promise(resolve => { this.finishTermination = resolve; }); return this.termination; }
  reply(request, result) { this.emit('message', { id: request.message.id, ok: true, result }); }
}
globalThis.embeddingQaControlledWorker = ControlledWorker;
const file = path.join(scratch, 'host.cjs');
await build({ entryPoints: ['electron/ai/embeddingGemma2Host.ts'], outfile: file, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'controlled-native-lifecycle', setup(builder) {
    builder.onResolve({ filter: /^node:worker_threads$/ }, () => ({ path: 'worker', namespace: 'qa' }));
    builder.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const Worker = globalThis.embeddingQaControlledWorker;', loader: 'js' }));
  } }] });
const host = createRequire(import.meta.url)(file), profile = 'embeddinggemma-2-text-q8-512-v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
const next = () => { const request = requests.shift(); assert(request, 'scheduler dispatched a request'); return request; };
const reply = (request, result) => request.worker.reply(request, result);
test.after(async () => { host.closeEmbeddingGemma2Worker(); for (const worker of instances) worker.finishTermination?.(); delete globalThis.embeddingQaControlledWorker; await fs.rm(scratch, { recursive: true, force: true }); });

test('query overtakes pending indexing batches and restores document order', async () => {
  const documents = host.embedEmbeddingGemma2(profile, scratch, ['a', 'b', 'c'], { titles: ['A', 'B', 'C'] });
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
  assert(instances[0].options.workerData.threads <= 4);
});

test('active cancellation rejects its result and waits for native teardown before recovery', async () => {
  const abort = new AbortController();
  const cancelled = host.embedEmbeddingGemma2(profile, scratch, ['cancel'], {}, abort.signal);
  const rejected = assert.rejects(cancelled, /cancelada/);
  const pending = next(); abort.abort(); await rejected;
  const replacement = host.embedEmbeddingGemma2(profile, scratch, ['next'], { role: 'query' });
  await tick(); assert.equal(requests.length, 0); assert.equal(instances.length, 1);
  // A late native reply is ignored, even while the old worker is terminating.
  reply(pending, [[0]]); pending.worker.finishTermination(); await tick();
  const plan = next(); assert.equal(instances.length, 2); reply(plan, [[0]]); await tick(); reply(next(), [[7]]);
  assert.deepEqual(await replacement, [[7]]);
});

test('native crash rejects all outstanding jobs without changing profile or precision', async () => {
  const a = host.embedEmbeddingGemma2(profile, scratch, ['a'], {});
  const b = host.embedEmbeddingGemma2(profile, scratch, ['b'], {});
  const failures = [assert.rejects(a, /out of memory/), assert.rejects(b, /out of memory/)];
  const active = next(); active.worker.emit('error', new Error('out of memory')); await Promise.all(failures);
  assert.equal(requests.length, 0); assert.equal(host.embeddingGemma2Busy(), false);
  active.worker.finishTermination(); await tick();
  const recovery = host.embedEmbeddingGemma2(profile, scratch, ['recovery'], {});
  const plan = next(); assert.equal(plan.message.dimensions, 512); assert.equal(plan.worker.options.workerData.dtype, undefined);
  reply(plan, [[0]]); await tick(); reply(next(), [[8]]); assert.deepEqual(await recovery, [[8]]);
});
