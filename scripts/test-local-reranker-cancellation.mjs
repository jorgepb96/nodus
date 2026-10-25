import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reranker-cancel-'));
const outfile = path.join(tmp, 'reranker.mjs');
globalThis.__rerankerTest = { children: [], health: [] };
await build({ entryPoints: [path.join(root, 'electron/ai/localReranker.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'isolated-reranker-process', setup(api) {
    const stubs = {
      electron: `export const app = { getPath: () => '/isolated', on() {} };`,
      // Installed files report their catalogue size unless the test marks them absent.
      'node:fs': `const sizes = { 'bge-reranker-v2-m3-Q8_0.gguf': 635676416, 'qwen3-reranker-0.6b-q8_0.gguf': 639153184, 'bge-reranker-v2-m3-Q4_K_M.gguf': 438376864 };
        export default {
          statSync: file => { const state = globalThis.__rerankerTest, name = file.split('/').at(-1);
            if (state.available === false || state.removed?.some(dir => file.startsWith(dir))) throw new Error('ENOENT'); return { size: sizes[name] }; },
          rmSync: (dir, options) => { const state = globalThis.__rerankerTest; (state.removed ??= []).push(dir); state.rmOptions = options; },
        };`,
      '../db/settingsRepo': `export const getSettings = () => ({ researchRerankerModel: globalThis.__rerankerTest.selected });`,
      './nodusLocalAi': `export const llamaServerPath = async () => '/isolated/llama-server'; export const freePort = async () => 12345;
        export const installNodusLocalRuntime = async () => { globalThis.__rerankerTest.installs = (globalThis.__rerankerTest.installs ?? 0) + 1; };
        export const downloadVerifiedNodusAsset = async (url,path,bytes,sha256,progress,signal) => new Promise((resolve,reject) => {
          const state = globalThis.__rerankerTest; state.downloads = (state.downloads ?? 0) + 1;
          state.asset = {url,path,bytes,sha256}; state.progress = progress;
          state.complete = () => { state.available = true; resolve(); };
          signal.addEventListener('abort', () => reject(signal.reason), {once:true});
        });`,
      'node:child_process': `import { EventEmitter } from 'node:events'; export function spawn() {
        const child = new EventEmitter(); child.exitCode = null; child.kills = [];
        child.kill = signal => { child.kills.push(signal); child.exitCode = 0; child.emit('exit'); };
        globalThis.__rerankerTest.children.push(child); return child;
      }`,
    };
    api.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'stub' } : undefined);
    api.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
  } }],
});
const { rerank, stopReranker, prepareLocalReranker, localRerankerStatus, deleteLocalReranker, selectedRerankerModel } = await import(pathToFileURL(outfile));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url.endsWith('/health')) return new Promise((resolve, reject) => {
    globalThis.__rerankerTest.health.push(resolve);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  return { ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }) };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
test.after(async () => { stopReranker(); globalThis.fetch = originalFetch; await rm(tmp, { recursive: true, force: true }); });

test('cancelling the only startup waiter stops the process and a later request can retry', async () => {
  const controller = new AbortController();
  const pending = rerank('query', ['document'], controller.signal);
  pending.catch(() => {});
  await tick();
  const first = globalThis.__rerankerTest.children.at(-1);
  assert.ok(first);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await tick();
  assert.deepEqual(first.kills, ['SIGKILL']);
  const retry = rerank('retry', ['document']);
  await tick();
  assert.notEqual(globalThis.__rerankerTest.children.at(-1), first);
  globalThis.__rerankerTest.health.at(-1)({ ok: true });
  assert.deepEqual(await retry, [0.9]);
  stopReranker();
});

test('cancelling one of two startup waiters leaves the other request usable', async () => {
  const controller = new AbortController();
  const cancelled = rerank('first', ['document'], controller.signal);
  cancelled.catch(() => {});
  const live = rerank('second', ['document']);
  await tick();
  const child = globalThis.__rerankerTest.children.at(-1);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.deepEqual(child.kills, []);
  globalThis.__rerankerTest.health.at(-1)({ ok: true });
  assert.deepEqual(await live, [0.9]);
  assert.deepEqual(child.kills, []);
  stopReranker();
});

test('an already cancelled request never spawns a process', async () => {
  const count = globalThis.__rerankerTest.children.length;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(rerank('query', ['document'], controller.signal), { name: 'AbortError' });
  assert.equal(globalThis.__rerankerTest.children.length, count);
});

test('downloads require an explicit action, share one verified asset request, and can be cancelled or retried', async () => {
  const state = globalThis.__rerankerTest;
  const RERANKER_MODEL = selectedRerankerModel();
  state.available = false;
  assert.equal(await rerank('query', ['document']), null);
  assert.equal(state.downloads, undefined, 'a search never downloads a model');
  const first = prepareLocalReranker('download');
  const second = prepareLocalReranker('download');
  const rejectedFirst = assert.rejects(first, { name: 'AbortError' }), rejectedSecond = assert.rejects(second, { name: 'AbortError' });
  await tick();
  assert.equal(state.installs, 1); assert.equal(state.downloads, 1);
  assert.equal(state.asset.bytes, RERANKER_MODEL.bytes); assert.equal(state.asset.sha256, RERANKER_MODEL.sha256);
  assert.equal(state.asset.url, RERANKER_MODEL.url);
  state.progress(RERANKER_MODEL.bytes / 2);
  assert.equal(localRerankerStatus().progress, 0.5);
  await prepareLocalReranker('cancel'); await Promise.all([rejectedFirst, rejectedSecond]);
  assert.equal(localRerankerStatus().downloading, false); assert.equal(localRerankerStatus().available, false);
  const retry = prepareLocalReranker('download'); await tick(); state.complete();
  assert.equal((await retry).available, true);
  assert.equal(state.downloads, 2);
  await prepareLocalReranker('download'); assert.equal(state.downloads, 2, 'installed assets are reused');
});

test('the catalogue offers three rerankers and keeps the historical default selected', () => {
  globalThis.__rerankerTest.available = true; delete globalThis.__rerankerTest.selected;
  const status = localRerankerStatus();
  assert.deepEqual(status.models.map(model => model.id), ['bge-reranker-v2-m3-q4_k_m', 'qwen3-reranker-0.6b-q8_0', 'bge-reranker-v2-m3-q8_0']);
  assert.equal(status.selected, 'bge-reranker-v2-m3-q8_0', 'existing downloads keep working without a new choice');
  globalThis.__rerankerTest.selected = 'not-a-model';
  assert.equal(localRerankerStatus().selected, 'bge-reranker-v2-m3-q8_0', 'an unknown stored id falls back to the default');
});

test('selecting another model restarts the server with that model', async () => {
  const state = globalThis.__rerankerTest; state.available = true; state.removed = [];
  state.selected = 'bge-reranker-v2-m3-q8_0';
  const first = rerank('query', ['document']); await tick();
  const bge = state.children.at(-1); state.health.at(-1)({ ok: true }); await first;
  state.selected = 'qwen3-reranker-0.6b-q8_0';
  const second = rerank('query', ['document']); await tick();
  assert.deepEqual(bge.kills, ['SIGTERM'], 'the server of the previous model is stopped');
  const qwen = state.children.at(-1); assert.notEqual(qwen, bge);
  state.health.at(-1)({ ok: true }); assert.deepEqual(await second, [0.9]);
  stopReranker();
});

test('deleting a model stops the server that uses it and removes only its folder', async () => {
  const state = globalThis.__rerankerTest; state.available = true; state.removed = [];
  state.selected = 'bge-reranker-v2-m3-q4_k_m';
  const pending = rerank('query', ['document']); await tick();
  const child = state.children.at(-1); state.health.at(-1)({ ok: true }); await pending;
  const status = await deleteLocalReranker('bge-reranker-v2-m3-q4_k_m');
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.deepEqual(state.removed, ['/isolated/local-ai/models/bge-reranker-v2-m3-q4_k_m']);
  assert.deepEqual(state.rmOptions, { recursive: true, force: true });
  assert.equal(status.models.find(model => model.id === 'bge-reranker-v2-m3-q4_k_m').available, false);
  assert.equal(status.models.find(model => model.id === 'bge-reranker-v2-m3-q8_0').available, true, 'other models are untouched');
  assert.equal(await rerank('query', ['document']), null, 'search falls back to the fused order');
  await assert.rejects(deleteLocalReranker('../../etc'), /desconocido/);
});

test('a model cannot be deleted while it downloads', async () => {
  const state = globalThis.__rerankerTest; state.available = false; state.removed = []; state.selected = 'qwen3-reranker-0.6b-q8_0';
  const download = prepareLocalReranker('download', 'qwen3-reranker-0.6b-q8_0');
  const rejected = assert.rejects(download, { name: 'AbortError' });
  await tick();
  assert.equal(state.asset.url.includes('ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF'), true);
  await assert.rejects(deleteLocalReranker('qwen3-reranker-0.6b-q8_0'), /Espera a que termine la descarga/);
  assert.deepEqual(state.removed, []);
  await prepareLocalReranker('cancel', 'qwen3-reranker-0.6b-q8_0'); await rejected;
});

test('a reranker installed by an earlier version or install-reranker.mjs is reused, never downloaded again', async () => {
  const state = globalThis.__rerankerTest; state.available = true; state.removed = []; delete state.selected;
  const before = state.downloads;
  const status = await prepareLocalReranker('download', 'bge-reranker-v2-m3-q8_0');
  assert.equal(status.models.find(model => model.id === 'bge-reranker-v2-m3-q8_0').available, true);
  assert.equal(state.downloads, before, 'no transfer for a model already on disk');
  const { rerankerModelPath } = await import(pathToFileURL(outfile));
  assert.equal(rerankerModelPath('bge-reranker-v2-m3-q8_0'), '/isolated/local-ai/models/bge-reranker-v2-m3-q8_0/bge-reranker-v2-m3-Q8_0.gguf',
    'the path predates the catalogue: scripts/install-reranker.mjs and 5.14.0 downloads land here');
});
