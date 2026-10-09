// A capability's subworkers: kept between requests, never more at once than the manifest's
// `subworkers.max`, and never reused after a request that did not end in an answer.
// Real processes stand in for Electron's utility processes: a Node child with a `parentPort`
// shaped like the one a utility process is given.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-subworker-pool-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const preload = path.join(scratch, 'parent-port.cjs');
fs.writeFileSync(preload, `
const { EventEmitter } = require('node:events');
const port = new EventEmitter();
port.postMessage = message => process.send(message);
process.on('message', message => port.emit('message', { data: message }));
process.parentPort = port;
`);
const forks = [];
const bundle = path.join(scratch, 'runner.cjs');
// The runner's own adapter, so the same test runs against the code before and after the pool.
// Everything it imports that is not about subworkers is a stand-in.
const STUBBED = /(^electron$)|(\/ai\/aiClient$)|(\/chatAssets$)|(\/pluginStoreV2$)|(\/artifactStore$)|(\/svgServices$)|(\/secrets\/safeStorageGate$)|(\/maps\/service$)|(\/vision\/service$)|(publicHost$)/;
await build({
  stdin: { contents: `export { createCapabilityAdapters } from './electron/capabilities/runner'; export * from './electron/capabilities/subworkerPool';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'stand-ins',
    setup(api) {
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      api.onResolve({ filter: /subworkerPool$/ }, args => {
        const file = path.join(args.resolveDir, `${args.path}.ts`);
        return fs.existsSync(file) ? { path: file } : { path: 'absent', namespace: 'absent' };
      });
      api.onLoad({ filter: /.*/, namespace: 'absent' }, () => ({ loader: 'js', contents: 'module.exports = {};' }));
      api.onResolve({ filter: STUBBED }, args => ({ path: args.path, namespace: 'stub' }));
      api.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path === 'electron' ? `
        const { fork } = require('node:child_process');
        exports.app = { getPath: () => ${JSON.stringify(scratch)} };
        exports.utilityProcess = { fork(entry) {
          const child = fork(entry, [], { execArgv: ['--require', ${JSON.stringify(preload)}], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
          globalThis.__subworkerForks?.push(child.pid);
          return { on: (event, listener) => child.on(event, listener), once: (event, listener) => child.once(event, listener),
            postMessage: message => child.send(message), kill: () => child.kill('SIGKILL') };
        } };
      ` : 'module.exports = new Proxy({}, { get: (_target, name) => name === "__esModule" ? false : () => { throw new Error(`stand-in: ${String(name)}`); } });' }));
    },
  }],
});
globalThis.__subworkerForks = forks;
const lib = createRequire(import.meta.url)(bundle);
const adapters = lib.createCapabilityAdapters({ locale: 'en', pins: { revision: 0, pins: new Map() }, runCoreStages: async answer => answer });

const pkg = path.join(scratch, 'package');
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(pkg, 'worker.js'), '');
fs.writeFileSync(path.join(pkg, 'echo.js'), `
process.parentPort.on('message', ({ data }) => {
  const started = Date.now();
  if (data.exit) process.exit(3);
  setTimeout(() => process.parentPort.postMessage(data.fail ? { error: 'refused' } : { result: { pid: process.pid, started, ended: Date.now() } }), data.sleep ?? 0);
});
`);
let packages = 0;
const runtimeWith = max => ({
  capabilityId: 'nodus:probe',
  plugin: { id: 'probe', version: '1.0.0', digest: String(packages++).padStart(64, '0') },
  manifest: {}, entryPath: path.join(pkg, 'worker.js'),
  permissions: { subworkers: { max } },
});
const ask = (runtime, input, timeoutMs = 10_000, signal = new AbortController().signal) => adapters.subworker(runtime, { entry: 'echo.js', input, timeoutMs }, signal);
test.after(() => lib.stopCapabilitySubworkers?.());

test('a subworker that answered is kept for the next request', async () => {
  const runtime = runtimeWith(1);
  const first = await ask(runtime, {});
  const second = await ask(runtime, {});
  assert.equal(second.pid, first.pid, 'the second request was answered by the same process');
  // A refusal is an answer: the process is as able as it was.
  await assert.rejects(ask(runtime, { fail: true }), /refused/);
  assert.equal((await ask(runtime, {})).pid, first.pid);
});

test('a subworker that timed out, was cancelled or exited is never reused', async () => {
  const runtime = runtimeWith(1);
  const first = await ask(runtime, {});
  await assert.rejects(ask(runtime, { sleep: 3_000 }, 1_000), /time limit of 1 seconds/);
  const afterTimeout = await ask(runtime, {});
  assert.notEqual(afterTimeout.pid, first.pid);
  const controller = new AbortController();
  const cancelled = ask(runtime, { sleep: 3_000 }, 10_000, controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(cancelled, { name: 'AbortError' });
  await assert.rejects(ask(runtime, { exit: true }), /exited without a result/);
  assert.notEqual((await ask(runtime, {})).pid, afterTimeout.pid);
});

test('no more subworkers run at once than the manifest allows, and a queued request keeps its whole budget', async () => {
  const runtime = runtimeWith(2);
  const answers = await Promise.all([
    ...Array.from({ length: 4 }, () => ask(runtime, { sleep: 600 })),
    // Queued behind the first two for at least 0.6 s, with a one-second budget for 0.1 s of work.
    ask(runtime, { sleep: 100 }, 1_000),
  ]);
  const edges = answers.flatMap(answer => [[answer.started, 1], [answer.ended, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0, peak = 0;
  for (const [, delta] of edges) { running += delta; peak = Math.max(peak, running); }
  assert.ok(peak <= 2, `${peak} subworkers ran at once with subworkers.max = 2`);
});

test('a request cancelled while it waits for a slot never starts', async () => {
  const runtime = runtimeWith(1);
  const busy = ask(runtime, { sleep: 800 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const before = forks.length;
  const controller = new AbortController();
  const queued = ask(runtime, {}, 10_000, controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(queued, { name: 'AbortError' });
  await busy;
  assert.equal(forks.length, before, 'nothing was forked for the cancelled request');
});
