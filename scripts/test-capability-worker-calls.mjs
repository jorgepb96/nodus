// Calls sharing one capability worker: a call's deadline or cancellation is its own, and a host
// call is answered with the services of the call that made it. Runs the host's real bootstrap
// and a small capability module in a real child process; only Electron's utility process is a
// stand-in (a Node child given a `parentPort` of the same shape).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-worker-calls-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const preload = path.join(scratch, 'parent-port.cjs');
fs.writeFileSync(preload, `
const { EventEmitter } = require('node:events');
const port = new EventEmitter();
port.postMessage = message => process.send(message);
process.on('message', message => port.emit('message', { data: message }));
process.parentPort = port;
`);
const bootstrap = path.join(scratch, 'capabilityWorkerBootstrap.js');
await build({ entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')], outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const hostBundle = path.join(scratch, 'host.cjs');
await build({
  entryPoints: [path.join(root, 'electron/capabilities/workerHost.ts')], outfile: hostBundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'utility-process', setup(api) {
    api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ loader: 'js', contents: `
      const { fork } = require('node:child_process');
      exports.utilityProcess = { fork(entry) {
        const child = fork(entry, [], { serialization: 'advanced', execArgv: ['--require', ${JSON.stringify(preload)}], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        return { on: (event, listener) => child.on(event, listener), once: (event, listener) => child.once(event, listener),
          postMessage: message => child.send(message), kill: () => child.kill('SIGKILL'), pid: child.pid };
      } };
    ` }));
  } }],
});
const lib = createRequire(import.meta.url)(hostBundle);

const entry = path.join(scratch, 'capability.cjs');
fs.writeFileSync(entry, `
module.exports = host => ({
  health: async () => ({ status: 'ready' }),
  renderArtifact: async () => ({}),
  shutdown: async () => {},
  async invoke({ toolId, input }) {
    // Read once, at the start, the way a capability reads it.
    const signal = host.signal;
    if (toolId === 'sleep') {
      const started = Date.now();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, input.ms);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      return { slept: input.ms, pid: process.pid, started, ended: Date.now() };
    }
    if (toolId === 'ask-host') return { answer: await host.storage.state.get('who') };
    if (toolId === 'uncloneable') return { draw: () => 'a function cannot cross a process boundary' };
    throw new Error('unknown tool');
  },
});
`);
const runtime = { capabilityId: 'nodus:probe', plugin: { id: 'probe', version: '1.0.0', digest: 'a'.repeat(64) }, manifest: {}, entryPath: entry, permissions: {} };
const servicesFor = name => async ({ channel, method }) => channel === 'storage' && method === 'state.get' ? name : null;
const handles = [];
const handleFor = () => { const handle = new lib.CapabilityWorkerHandle(runtime, { bootstrapPath: bootstrap, services: servicesFor('the handle') }); handles.push(handle); return handle; };
const invoke = (handle, toolId, input, options = {}) => handle.call('invoke', { toolId, input, locale: 'en' }, options);
test.after(() => Promise.all(handles.map(handle => handle.stop())));

test('one call past its deadline does not take the calls beside it down', async () => {
  const handle = handleFor();
  const slow = invoke(handle, 'sleep', { ms: 10_000 }, { timeoutMs: 1_000 });
  const neighbour = invoke(handle, 'sleep', { ms: 3_500 }, { timeoutMs: 60_000 });
  await assert.rejects(slow, /exceeded 1 seconds/);
  const answer = await neighbour;
  assert.equal(answer.slept, 3_500, 'the neighbour finished its own work');
  // And the process it shares was not killed for it.
  assert.equal((await invoke(handle, 'sleep', { ms: 10 })).pid, answer.pid);
});

test('a cancelled caller cancels its own call only', async () => {
  const handle = handleFor();
  const controller = new AbortController();
  const mine = invoke(handle, 'sleep', { ms: 10_000 }, { signal: controller.signal });
  const theirs = invoke(handle, 'sleep', { ms: 3_000 });
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(mine, { name: 'AbortError' });
  assert.equal((await theirs).slept, 3_000);
});

test('a host call is answered with the services of the call that made it', async () => {
  const handle = handleFor();
  const [first, second] = await Promise.all([
    invoke(handle, 'ask-host', {}, { services: servicesFor('turn one') }),
    invoke(handle, 'ask-host', {}, { services: servicesFor('turn two') }),
  ]);
  assert.equal(first.answer, 'turn one');
  assert.equal(second.answer, 'turn two');
  assert.equal((await invoke(handle, 'ask-host', {})).answer, 'the handle');
});

test('a tool runs no more invocations at once than its manifest concurrency, and a queued one keeps its whole budget', async () => {
  const handle = handleFor();
  const queue = { key: 'invoke:sleep', limit: 1 };
  const answers = await Promise.all([
    invoke(handle, 'sleep', { ms: 700 }, { queue }),
    invoke(handle, 'sleep', { ms: 700 }, { queue }),
    // Queued for at least 1.4 s, with a one-second budget for 0.1 s of work.
    invoke(handle, 'sleep', { ms: 100 }, { queue, timeoutMs: 1_000 }),
  ]);
  const sorted = answers.sort((a, b) => a.started - b.started);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].started >= sorted[i - 1].ended, 'two invocations of a concurrency-1 tool overlapped');
  // A caller that gives up while queued never reaches the worker.
  const controller = new AbortController();
  const busy = invoke(handle, 'sleep', { ms: 600 }, { queue });
  const queued = invoke(handle, 'sleep', { ms: 5_000 }, { queue, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const cancelledAt = Date.now();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.ok(Date.now() - cancelledAt < 400, 'the cancellation waited for the slot');
  await busy;
  // Different tools do not wait for each other.
  const [a, b] = await Promise.all([invoke(handle, 'sleep', { ms: 500 }, { queue }), invoke(handle, 'sleep', { ms: 500 }, { queue: { key: 'invoke:other', limit: 1 } })]);
  assert.ok(b.started < a.ended && a.started < b.ended, 'calls to different tools were serialized');
});

test('a result that cannot be sent fails its own call, not the process', async () => {
  const handle = handleFor();
  const neighbour = invoke(handle, 'sleep', { ms: 1_500 });
  await new Promise(resolve => setTimeout(resolve, 200));
  await assert.rejects(invoke(handle, 'uncloneable', {}, { timeoutMs: 10_000 }), /could not be sent|cloned/);
  assert.equal((await neighbour).slept, 1_500, 'the call beside it was lost with the process');
});
