// The "is Tailscale serving our port?" check guards `tailscale serve --https=443 off`; it must
// not match a different port that merely starts with ours.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('servesPort matches the whole port number', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-tailscale-'));
  try {
    const outfile = path.join(tmp, 'tailscale.mjs');
    await build({ entryPoints: [path.join(root, 'electron/localServer/tailscale.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron'] });
    const { servesPort } = await import(pathToFileURL(outfile).href);
    assert.equal(typeof servesPort, 'function', 'servesPort is exported for this test');
    const other = JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { 'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:30000' } } } } });
    assert.equal(servesPort(other, 3000), false);
    assert.equal(servesPort(other, 300), false);
    assert.equal(servesPort(other, 30000), true);
    assert.equal(servesPort(JSON.stringify({ Proxy: 'https+insecure://localhost:7443' }), 7443), true);
    assert.equal(servesPort(JSON.stringify({ Proxy: 'http://127.0.0.1:7443/' }), 7443), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
