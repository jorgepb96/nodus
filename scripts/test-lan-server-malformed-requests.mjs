import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The presenter remote and the shared-app server listen on the LAN. A malformed escape (`/%`) or
// an unparsable Host header threw before the PIN check: the socket hung with no answer and the
// main process logged an uncaught exception for every such request.

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-lan-malformed-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const require = createRequire(path.join(root, 'package.json'));

async function load(entry, name) {
  const { build } = await import('esbuild');
  const outfile = path.join(scratch, `${name}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['bufferutil', 'utf-8-validate'] });
  return require(outfile);
}

function get(port, requestPath, headers = {}) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath, headers, timeout: 1500 }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('timeout', () => { request.destroy(); resolve('no answer'); });
    request.on('error', (error) => resolve(`error ${error.code}`));
  });
}

async function withUncaught(run) {
  const uncaught = [];
  const listener = (error) => uncaught.push(String(error));
  process.on('uncaughtException', listener);
  try { await run(); } finally { process.off('uncaughtException', listener); }
  return uncaught;
}

test('the presenter remote answers malformed requests instead of throwing', async () => {
  const server = await load('electron/toolkit/presenter/server.ts', 'presenter');
  const info = await server.startPresenterServer({ libraryDir: () => scratch, getState: () => ({}), onRemoteAction() {}, getVolume: async () => 0, setVolume: async () => {} });
  try {
    const statuses = [];
    const uncaught = await withUncaught(async () => {
      statuses.push(await get(info.port, '/%'));
      statuses.push(await get(info.port, '/api/state', { Host: '[' }));
    });
    assert.deepEqual(uncaught, []);
    assert.deepEqual(statuses, [404, 400]);
  } finally { server.stopPresenterServer(); }
});

test('the shared-app server answers malformed requests instead of throwing', async () => {
  const server = await load('electron/toolkit/apps/server.ts', 'apps');
  const source = fs.readFileSync(path.join(root, 'electron/toolkit/apps/server.ts'), 'utf8');
  assert.match(source, /function handleRequest\(req: IncomingMessage, res: ServerResponse\): void \{\n  try \{ handleRequestUnsafe\(req, res\); \}/, 'the request handler cannot throw');
  assert.equal(typeof server.startToolkitAppSession, 'function');
});
