import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bundleModelSetup } from './lib/model-setup-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-resource-'));
const bundle = await bundleModelSetup(repo, tmp);
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const requests = [];
let transport = (...args) => globalThis.fetch(...args);
Module._load = function (id, ...args) {
  if (id === 'electron') return {
    app: { getPath: () => tmp, getVersion: () => 'test', on() {}, once() {} },
    utilityProcess: {}, net: { fetch: (...args) => { requests.push(args); return transport(...args); } },
  };
  return originalLoad.call(this, id, ...args);
};
let setup;
try { setup = require(bundle); } finally { Module._load = originalLoad; }
const body = Buffer.alloc(96_000, 7);
const sha = createHash('sha256').update(body).digest('hex');
const ranges = [];
const server = createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { location: '/asset' }); res.end(); return; }
  const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
  if (req.headers.range) ranges.push(req.headers.range);
  if (req.url === '/asset' && start === body.length) { res.writeHead(416); res.end(); return; }
  res.writeHead(start ? 206 : 200, { 'content-length': body.length - start });
  if (req.url === '/slow') { res.write(body.subarray(0, 20_000)); return; }
  res.end(body.subarray(start));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(tmp, { recursive: true, force: true }); });

test('the real downloader follows redirects, omits cookies, reuses verified files and resumes partial/empty files', async () => {
  const target = path.join(tmp, 'asset.bin');
  const progress = [];
  await setup.downloadVerifiedNodusAsset(`${base}/redirect`, target, body.length, sha, n => progress.push(n));
  assert.deepEqual(await readFile(target), body);
  assert.equal(progress.reduce((a, b) => a + b, 0), body.length);
  assert.equal(requests.at(-1)[1].credentials, 'omit');
  const count = requests.length;
  await setup.downloadVerifiedNodusAsset(`${base}/asset`, target, body.length, sha, () => {});
  assert.equal(requests.length, count, 'a verified file requires no network');
  for (const prefix of [0, 20_000, body.length]) {
    const file = path.join(tmp, `resume-${prefix}.bin`);
    await writeFile(`${file}.download`, body.subarray(0, prefix));
    await setup.downloadVerifiedNodusAsset(`${base}/asset`, file, body.length, sha, () => {});
    assert.deepEqual(await readFile(file), body);
    if (prefix) assert.equal(ranges.at(-1), `bytes=${prefix}-`);
  }
});

test('size and SHA-256 mismatches never publish an unverified file', async () => {
  for (const [name, bytes, digest, error] of [['size', body.length - 1, sha, /Descarga incompleta/], ['hash', body.length, '0'.repeat(64), /SHA-256/]]) {
    const file = path.join(tmp, `${name}.bin`);
    await assert.rejects(setup.downloadVerifiedNodusAsset(`${base}/asset`, file, bytes, digest, () => {}), error);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    await assert.rejects(readFile(`${file}.download`), { code: 'ENOENT' });
  }
});

test('cancelling a streamed download preserves its partial and a retry finishes it', async () => {
  const file = path.join(tmp, 'cancel.bin');
  const controller = new AbortController();
  await assert.rejects(setup.downloadVerifiedNodusAsset(`${base}/slow`, file, body.length, sha, () => controller.abort(), controller.signal), { name: 'AbortError' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await setup.downloadVerifiedNodusAsset(`${base}/asset`, file, body.length, sha, () => {});
  assert.deepEqual(await readFile(file), body);
});

test('connection diagnostics retain only the host and safe cause code, and remain localized', async () => {
  const url = 'https://user:private-password@models.invalid/model?api_key=private-key&signature=private-signature';
  transport = async () => { throw new TypeError(`fetch failed ${url}`, { cause: { code: 'ENOTFOUND', message: url } }); };
  try {
    await assert.rejects(setup.fetchModelResource(url), error => {
      assert.equal(error.message, 'No se pudo conectar con models.invalid. Comprueba la conexión y el proxy del sistema. (ENOTFOUND)');
      assert.doesNotMatch(error.message, /private-|user:|api_key|signature/);
      for (const lang of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
        const localized = setup.localizeRuntimeError(error.message, lang);
        assert.notEqual(localized, error.message, lang);
        assert.match(localized, /models\.invalid/);
        assert.match(localized, /ENOTFOUND/);
        const nested = setup.localizeRuntimeError(`No se pudo instalar un runtime de llama.cpp utilizable. archive.zip: ${error.message}`, lang);
        assert.doesNotMatch(nested, /No se pudo conectar/, lang);
      }
      return true;
    });
    assert.equal(setup.modelResourceError(url, Error('net::ERR_PROXY_CONNECTION_FAILED')).message.endsWith('(ERR_PROXY_CONNECTION_FAILED)'), true);
    const controller = new AbortController(); controller.abort();
    const abort = controller.signal.reason;
    transport = async () => { throw abort; };
    await assert.rejects(setup.fetchModelResource(url, { signal: controller.signal }), error => error === abort);
  } finally { transport = (...args) => globalThis.fetch(...args); }
});
