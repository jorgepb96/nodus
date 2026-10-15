// Runners that name the same scope share their capability worker: an answer's evidence gather,
// its route checks and its correction rounds find the same process — and whatever the capability
// keeps in it — instead of a cold one per phase. Runs the real runner, workerHost and bootstrap in
// real child processes; the package store and Electron's utility process are stand-ins.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-worker-scope-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const preload = path.join(scratch, 'parent-port.cjs');
fs.writeFileSync(preload, `
const { EventEmitter } = require('node:events');
const port = new EventEmitter();
port.postMessage = message => process.send(message);
process.on('message', message => port.emit('message', { data: message }));
process.parentPort = port;
`);
await build({ entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')], outfile: path.join(scratch, 'capabilityWorkerBootstrap.js'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });

const entry = path.join(scratch, 'capability.cjs');
fs.writeFileSync(entry, `
let calls = 0;
module.exports = () => ({
  health: async () => ({ status: 'ready' }), renderArtifact: async () => ({}), shutdown: async () => {},
  async invoke() { calls += 1; return { calls, pid: process.pid }; },
});
`);
const runtime = { capabilityId: 'nodus:probe', plugin: { id: 'probe', version: '1.0.0', digest: 'a'.repeat(64) }, manifest: {}, entryPath: entry, permissions: {} };
globalThis.__probeRuntime = runtime;

const STUBBED = /(^electron$)|(\/ai\/aiClient$)|(\/chatAssets$)|(\/pluginStoreV2$)|(\/artifactStore$)|(\/svgServices$)|(\/secrets\/safeStorageGate$)|(\/maps\/service$)|(\/vision\/service$)|(publicHost$)/;
const bundle = path.join(scratch, 'runner.cjs');
await build({
  stdin: { contents: `export { createTrustedCapabilityRunner } from './electron/capabilities/runner'; export * from './electron/capabilities/workerHost';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'stand-ins', setup(api) {
    api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    api.onResolve({ filter: STUBBED }, args => ({ path: args.path, namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents:
      args.path === 'electron' ? `
        const { fork } = require('node:child_process');
        exports.app = { getPath: () => ${JSON.stringify(scratch)} };
        exports.utilityProcess = { fork(file) {
          const child = fork(file, [], { serialization: 'advanced', execArgv: ['--require', ${JSON.stringify(preload)}], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
          return { on: (e, l) => child.on(e, l), once: (e, l) => child.once(e, l), postMessage: m => child.send(m), kill: () => child.kill('SIGKILL') };
        } };`
      : args.path.endsWith('pluginStoreV2') ? 'exports.resolveTrustedCapability = () => globalThis.__probeRuntime; exports.pluginsRuntimesRoot = () => "/nowhere";'
      : 'module.exports = new Proxy({}, { get: (_t, name) => name === "__esModule" ? false : () => { throw new Error(`stand-in: ${String(name)}`); } });' }));
  } }],
});
const lib = createRequire(import.meta.url)(bundle);
const provider = { id: 'nodus:probe', tools: [{ id: 'count', timeoutMs: 10_000, concurrency: 1 }], artifacts: [] };
const runnerFor = scope => lib.createTrustedCapabilityRunner({ locale: 'en', pins: { revision: 0, pins: new Map() }, runCoreStages: async a => a, ...(scope ? { scope } : {}) });
const count = runner => runner.invoke({ provider, toolId: 'count', input: {} });
test.after(() => lib.stopCapabilityWorkers());

test('runners of one scope share one worker, and what it holds, across phases', async () => {
  // The evidence gather, then the route check of the same answer, each disposing its runner.
  const evidence = runnerFor('research:vault:conversation-1');
  const first = await count(evidence);
  await evidence.dispose();
  const check = runnerFor('research:vault:conversation-1');
  const second = await count(check);
  await check.dispose();
  assert.equal(second.pid, first.pid, 'the route check started a fresh worker');
  assert.equal(second.calls, first.calls + 1, 'the worker forgot what the evidence gather left in it');

  // Another conversation gets its own.
  const other = runnerFor('research:vault:conversation-2');
  const elsewhere = await count(other);
  await other.dispose();
  assert.notEqual(elsewhere.pid, first.pid);
});

test('a runner without a scope keeps its worker to itself and stops it when disposed', async () => {
  const a = runnerFor();
  const first = await count(a);
  await a.dispose();
  const b = runnerFor();
  const second = await count(b);
  await b.dispose();
  assert.notEqual(second.pid, first.pid);
  assert.equal(second.calls, 1);
});
