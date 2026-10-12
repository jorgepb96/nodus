// A server that refused this machine is not asked again by the next worker. The refusal is kept by
// the host, for the process, per plugin and endpoint — not in the worker that happened to see it,
// which used to end with the turn (and with each phase of one answer).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-endpoint-refusal-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const bundle = path.join(scratch, 'services.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/hostServices';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'stand-ins', setup(api) {
    api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    api.onResolve({ filter: /(^electron$)|(safeStorageGate$)|(publicHost$)|(\/maps\/service$)/ }, args => ({ path: args.path, namespace: 'stub' }));
    api.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents:
      args.path === 'electron' ? `exports.app = { getPath: () => ${JSON.stringify(scratch)} };`
      : args.path.endsWith('safeStorageGate') ? 'exports.safeStorage = { isEncryptionAvailable: () => false };'
      : args.path.endsWith('publicHost') ? 'exports.assertPublicHost = async () => {};'
      : 'exports.createMapService = () => ({});' }));
  } }],
});
const lib = createRequire(import.meta.url)(bundle);

const sent = [];
let answer = () => new Response('{}', { status: 200 });
globalThis.fetch = async url => { sent.push(String(url)); return answer(); };

const endpoint = { id: 'pubchem', origin: 'https://pubchem.ncbi.nlm.nih.gov', pathPrefixes: ['/rest/pug/compound/'], methods: ['GET'], maxResponseBytes: 1_000_000, timeoutMs: 30_000 };
const runtimeOf = pluginId => ({ capabilityId: 'nodus:chemistry', plugin: { id: pluginId, version: '1.0.0', digest: 'a'.repeat(64) }, manifest: { id: 'chemistry' }, entryPath: '/x/worker.js', permissions: { network: [endpoint] } });
const ask = (services, pluginId = 'chemistry-studio') => services({ runtime: runtimeOf(pluginId), channel: 'network', method: 'fetch', payload: { endpointId: 'pubchem', path: '/rest/pug/compound/name/ethanol/cids/JSON' }, signal: new AbortController().signal });

test('a refusal seen by one worker holds for every worker of the plugin until the server said', async () => {
  // Two turns: each builds its own services, as each runner does.
  const firstTurn = lib.createCapabilityHostServices();
  const nextTurn = lib.createCapabilityHostServices();
  answer = () => new Response('busy', { status: 503, headers: { 'Retry-After': '1' } });
  assert.equal((await ask(firstTurn)).status, 503, 'the refusal itself reaches the worker that asked');
  answer = () => new Response('{}', { status: 200 });
  const before = sent.length;
  const started = Date.now();
  await assert.rejects(ask(nextTurn), /asked this machine to wait/);
  assert.ok(Date.now() - started < 100, 'a refused request fails at once, it does not wait');
  assert.equal(sent.length, before, 'nothing was sent while the server had asked this machine to wait');
  // Another plugin is its own client.
  assert.equal((await ask(nextTurn, 'other-plugin')).status, 200);
  // Once the server's time has passed, requests go out again.
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal((await ask(nextTurn)).status, 200);
});
