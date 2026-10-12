// The lifecycle of a capability's worker process: what retires it, what one call's failure may do
// to the others it is carrying, and which turn's services a call is answered with.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-worker-lifecycle-'));
const outfile = path.join(tmp, 'worker.mjs');
globalThis.__lifecycleChildren = [];
await build({ entryPoints: [path.join(root, 'electron/capabilities/workerHost.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'worker-process-fixture', setup(api) {
    api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      import { EventEmitter } from 'node:events';
      export const utilityProcess = { fork() {
        const child = new EventEmitter(); child.messages = []; child.killed = false;
        child.postMessage = message => { child.messages.push(message); if (message.type === 'shutdown') queueMicrotask(() => child.emit('exit', 0)); };
        child.kill = () => { child.killed = true; };
        globalThis.__lifecycleChildren.push(child); return child;
      } };
    ` }));
  } }],
});
const lib = await import(pathToFileURL(outfile));
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = (child, capabilityId) => child.emit('message', { type: 'ready', protocol: 1, capabilityId });
test.after(() => rm(tmp, { recursive: true, force: true }));

test('removing or updating a plugin stops the workers it started', async () => {
  // As installed: the plugin id and the id of the capability it provides are different words.
  const runtime = { capabilityId: 'nodus:chemistry', plugin: { id: 'chemistry-studio', version: '2.5.28', digest: 'a'.repeat(64) }, manifest: {}, entryPath: '/isolated/worker.cjs', permissions: {} };
  const detached = lib.acquireCapabilityWorker(runtime, { bootstrapPath: '/isolated/bootstrap.cjs', services: async () => null });
  const scoped = lib.acquireCapabilityWorker(runtime, { bootstrapPath: '/isolated/bootstrap.cjs', services: async () => null, scopeKey: 'turn-1' });
  for (const handle of [detached, scoped]) {
    const pending = handle.call('health', {});
    const child = globalThis.__lifecycleChildren.at(-1);
    ready(child, 'nodus:chemistry'); await tick();
    const call = child.messages.find(message => message.type === 'call');
    child.emit('message', { type: 'result', callId: call.callId, ok: true, value: 'ok' });
    await pending;
  }
  assert.ok(detached.alive && scoped.alive);
  // Exactly what the remove, rollback, approve and update paths ask for.
  if (typeof lib.stopPluginWorkers === 'function') await lib.stopPluginWorkers('chemistry-studio');
  else await lib.stopCapabilityWorkers(key => key.includes('chemistry-studio'));
  assert.equal(detached.alive, false, 'the settings/health worker of the removed plugin is still running');
  assert.equal(scoped.alive, false, 'a turn worker of the removed plugin is still running');
  // Another plugin whose id merely contains this one's is left alone.
  const other = { ...runtime, capabilityId: 'nodus:legal', plugin: { ...runtime.plugin, id: 'chemistry-studio-extra' } };
  const survivor = lib.acquireCapabilityWorker(other, { bootstrapPath: '/isolated/bootstrap.cjs', services: async () => null });
  const pending = survivor.call('health', {});
  const child = globalThis.__lifecycleChildren.at(-1);
  ready(child, 'nodus:legal'); await tick();
  child.emit('message', { type: 'result', callId: child.messages.find(message => message.type === 'call').callId, ok: true, value: 'ok' });
  await pending;
  if (typeof lib.stopPluginWorkers === 'function') {
    await lib.stopPluginWorkers('chemistry-studio');
    assert.ok(survivor.alive, 'a different plugin was stopped');
  }
  await survivor.stop();
});

test('what a worker logs reaches the main log', async () => {
  const runtime = { capabilityId: 'nodus:probe', plugin: { id: 'probe', version: '1.0.0', digest: 'b'.repeat(64) }, manifest: {}, entryPath: '/isolated/worker.cjs', permissions: {} };
  const handle = new lib.CapabilityWorkerHandle(runtime, { bootstrapPath: '/isolated/bootstrap.cjs', services: async () => null });
  const pending = handle.call('health', {});
  const child = globalThis.__lifecycleChildren.at(-1);
  ready(child, 'nodus:probe'); await tick();
  const written = [];
  const saved = console.warn;
  console.warn = (...args) => written.push(args.join(' '));
  try {
    child.emit('message', { type: 'log', level: 'warn', message: 'local reference mirror unavailable', detail: { code: 1 } });
  } finally { console.warn = saved; }
  child.emit('message', { type: 'result', callId: child.messages.find(message => message.type === 'call').callId, ok: true, value: 'ok' });
  await pending;
  await handle.stop();
  assert.ok(written.some(line => line.includes('nodus:probe') && line.includes('local reference mirror unavailable')), `logged: ${JSON.stringify(written)}`);
});
