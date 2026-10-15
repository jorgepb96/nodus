// A 204/304 reply, or a status outside 200-599, must settle fetchPublicResource promptly
// instead of throwing inside the socket callback and waiting out the timeout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('null-body and out-of-range statuses settle without an uncaught exception', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-public-download-'));
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  // A raw TCP server, so it can send a status http.createServer refuses to write.
  const server = net.createServer((socket) => socket.once('data', (data) => {
    const status = /GET \/(\d+)/.exec(String(data))[1];
    socket.end(`HTTP/1.1 ${status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  }));
  try {
    const outfile = path.join(tmp, 'publicDownload.mjs');
    await build({ entryPoints: [path.join(root, 'electron/network/publicDownload.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron'] });
    const { fetchPublicResource } = await import(pathToFileURL(outfile).href);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const options = { assertPublic: async (url) => new URL(url), timeoutMs: 5000 };
    for (const status of [204, 304, 999]) {
      const started = Date.now();
      const outcome = await Promise.race([
        fetchPublicResource(`${base}/${status}`, options).then((r) => `ok ${r.response.status}`, (e) => `error ${e.message}`),
        new Promise((resolve) => setTimeout(() => resolve('still pending after 3 s'), 3000).unref()),
      ]);
      assert.ok(Date.now() - started < 2000 && !/pending/.test(outcome), `${status} settled in ${Date.now() - started} ms (${outcome})`);
      assert.doesNotMatch(outcome, /aborted/i, `${status}: ${outcome}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(uncaught.map(String), []);
  } finally {
    process.off('uncaughtException', onUncaught);
    server.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
