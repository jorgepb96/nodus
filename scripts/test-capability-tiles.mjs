// The one result kind that reaches the network, and the gate in front of it.
//
// Every other kind is a file or a value. A deep-zoom image is a service, so opening an old
// conversation can cause a request — which makes this the only place where a result saved
// months ago can still act. The gate is therefore narrow, and this is where it is held to
// that: the capability must still be installed, the origin must be one its own manifest
// already declared, the path must stay under the service it named, and the host must be
// public. The renderer is given bytes, never a URL, so none of this can be argued with
// from the page.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-tiles-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

// What the registry and the package store answer is set per test; the gate itself, the
// limits and the public-host check are the real ones.
globalThis.__installed = new Map();
globalThis.__runtimes = new Map();
// Name resolution is stubbed, not because it is slow but because the case worth testing —
// a public-looking name that resolves to this machine — cannot be arranged with real DNS.
globalThis.__dns = new Map([['iiif.example.org', '93.184.216.34'], ['tiles.elsewhere.org', '93.184.216.35']]);

const bundle = path.join(scratch, 'tiles.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/tileProxy';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^node:dns$/ }, () => ({ path: 'dns', namespace: 'mock' }));
      api.onResolve({ filter: /registry$/ }, () => ({ path: 'registry', namespace: 'mock' }));
      api.onResolve({ filter: /pluginStoreV2$/ }, () => ({ path: 'store', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
        contents: name === 'registry'
          ? 'export const capabilityRegistry = () => ({ providers: globalThis.__installed });'
          : name === 'store'
            ? 'export const resolveTrustedCapability = (id) => globalThis.__runtimes.get(id);'
            : `export const promises = { lookup: async (hostname) => {
                 const address = globalThis.__dns.get(hostname);
                 if (!address) { const error = new Error('getaddrinfo ENOTFOUND ' + hostname); error.code = 'ENOTFOUND'; throw error; }
                 return [{ address, family: 4 }];
               } }; export default { promises };`,
        loader: 'js',
      }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const { assertTileRequestAllowed, fetchCapabilityTile } = createRequire(import.meta.url)(bundle);

const SERVICE = 'https://iiif.example.org/iiif/2/manuscript-1';
const TILE = '0,0,512,512/512,/0/default.jpg';

/** A capability that is installed and permitted to read one IIIF service. */
function install(id, network = [{ origin: 'https://iiif.example.org', methods: ['GET'], pathPrefixes: ['/iiif/2/'] }]) {
  globalThis.__installed.set(id, { source: 'plugin', plugin: { version: '1.0.0', digest: 'a'.repeat(64) } });
  globalThis.__runtimes.set(id, { permissions: { network } });
}

const reset = () => { globalThis.__installed.clear(); globalThis.__runtimes.clear(); };
const allowed = (overrides = {}) => assertTileRequestAllowed({ capabilityId: 'x:tiles', service: SERVICE, path: TILE, ...overrides });
const refused = (overrides, hint, because) => assert.rejects(() => allowed(overrides), hint, because ?? JSON.stringify(overrides));

test('a tile is fetched only for a capability that is installed now', async () => {
  reset();
  await refused({}, /not installed/, 'nothing is installed at all');

  // A result stays in the conversation after its package is removed. It must stop working.
  install('x:tiles');
  assert.equal((await allowed()).href, `${SERVICE}/${TILE}`);
  globalThis.__installed.delete('x:tiles');
  await refused({}, /not installed/);

  // A core capability has no package and no declared network, so it can never be the
  // owner of a tile request.
  globalThis.__installed.set('nodus:image', { source: 'core' });
  await refused({ capabilityId: 'nodus:image' }, /not installed/);
});

test('a tile cannot reach where its package was not already permitted to reach', async () => {
  reset();
  install('x:tiles');

  // Another host entirely.
  await refused({ service: 'https://tiles.elsewhere.org/iiif/2/x' }, /not permitted/);
  // The same host, a path the manifest never granted.
  await refused({ service: 'https://iiif.example.org/private/2/x' }, /not permitted/);
  // A near-miss on the origin: a subdomain is a different origin, and so is a port.
  await refused({ service: 'https://evil.iiif.example.org/iiif/2/x' }, /not permitted/);
  await refused({ service: 'https://iiif.example.org:8443/iiif/2/x' }, /not permitted/);

  // A package permitted only to write there cannot read tiles from there either.
  reset();
  install('x:tiles', [{ origin: 'https://iiif.example.org', methods: ['POST'], pathPrefixes: ['/iiif/2/'] }]);
  await refused({}, /not permitted/);

  reset();
  install('x:tiles', []);
  await refused({}, /not permitted/);
});

test('a service URL is not a prefix for the rest of the host', async () => {
  reset();
  install('x:tiles');

  // The tile path is joined to the service base and then checked by comparison, so it does
  // not matter how it is spelled: it has to land under the base the view declared.
  for (const escape of [
    '../../../etc/passwd',
    '../../other-manuscript/full/max/0/default.jpg',
    'https://elsewhere.org/x.jpg',
  ]) {
    await refused({ path: escape }, /belong to its own image service/, escape);
  }

  // A leading slash is stripped before the join, which turns the two paths that would
  // otherwise leave — an absolute one, and a protocol-relative one that `new URL` would
  // read as a different host entirely — into paths inside the service. Neutralised rather
  // than refused: the request is still the capability's own, just a pointless one.
  for (const [neutralised, target] of [
    ['/iiif/2/other/full/max/0/default.jpg', '/iiif/2/manuscript-1/iiif/2/other/full/max/0/default.jpg'],
    ['//elsewhere.org/x.jpg', '/iiif/2/manuscript-1/elsewhere.org/x.jpg'],
  ]) {
    const resolved = await allowed({ path: neutralised });
    assert.equal(resolved.origin, 'https://iiif.example.org', neutralised);
    assert.equal(resolved.pathname, target);
  }

  // Anything under the base is fine.
  assert.ok((await allowed({ path: 'full/max/0/default.jpg' })).pathname.startsWith('/iiif/2/manuscript-1/'));

  // The base is compared with its trailing slash, which is what stops one service name
  // being a textual prefix of another's. `…/manuscript` cannot reach `…/manuscript-1`,
  // even though one string starts with the other.
  await refused({ service: 'https://iiif.example.org/iiif/2/manuscript', path: '../manuscript-1/full/max/0/default.jpg' },
    /belong to its own image service/);
  assert.equal(
    (await allowed({ service: 'https://iiif.example.org/iiif/2/manuscript', path: '-1/full/max/0/default.jpg' })).pathname,
    '/iiif/2/manuscript/-1/full/max/0/default.jpg',
    'a path that looks like it completes a sibling name stays under the base it was joined to',
  );

  await refused({ path: '' }, /Invalid tile request/);
  await refused({ path: 'x'.repeat(2_001) }, /Invalid tile request/);
  await refused({ path: 'full/max/0/default.jpg#fragment' }, /Invalid tile request/);
});

test('a tile service is https, and never carries credentials', async () => {
  reset();
  install('x:tiles', [{ origin: 'http://iiif.example.org', methods: ['GET'], pathPrefixes: ['/'] }]);
  await refused({ service: 'http://iiif.example.org/iiif/2/x' }, /must be https/);

  reset();
  install('x:tiles');
  await refused({ service: 'https://user:secret@iiif.example.org/iiif/2/manuscript-1' }, /must be https/);
  await refused({ service: 'not a url' }, /Invalid tiled image service/);
});

test('a tile cannot be aimed at the machine the conversation is opened on', async () => {
  reset();
  // A manifest that declared a private origin would already have been refused at install
  // time; this is the second line, and the one that still applies if the name resolves
  // inward later.
  install('x:tiles', [{ origin: 'https://localhost', methods: ['GET'], pathPrefixes: ['/'] }]);
  await refused({ service: 'https://localhost/iiif/2/x' }, /not public/);

  reset();
  install('x:tiles', [{ origin: 'https://nodus.local', methods: ['GET'], pathPrefixes: ['/'] }]);
  await refused({ service: 'https://nodus.local/iiif/2/x' }, /not public/);

  // The case the name check is really for: an origin that looks public, was permitted on
  // that basis, and resolves inward. Nothing about the URL gives this away — only the
  // lookup does, which is why its result has to be waited for rather than started.
  reset();
  install('x:tiles', [{ origin: 'https://tiles.internal.example', methods: ['GET'], pathPrefixes: ['/'] }]);
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '169.254.169.254', '172.16.0.1']) {
    globalThis.__dns.set('tiles.internal.example', address);
    await refused({ service: 'https://tiles.internal.example/iiif/2/x' }, /not public/, address);
  }

  // And a tile is not fetched while that is still being decided.
  globalThis.__dns.set('tiles.internal.example', '169.254.169.254');
  let fetched = false;
  await assert.rejects(
    () => fetchCapabilityTile(
      { capabilityId: 'x:tiles', service: 'https://tiles.internal.example/iiif/2/x', path: TILE },
      async () => { fetched = true; throw new Error('the request should never have been made'); },
    ),
    /not public/,
  );
  assert.equal(fetched, false, 'the gate has to settle before the request, not alongside it');

  globalThis.__dns.delete('tiles.internal.example');
});

// ---------------------------------------------------------------- the response

const respond = (body, { status = 200, type = 'image/jpeg' } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => (name.toLowerCase() === 'content-type' ? type : null) },
  arrayBuffer: async () => body,
});

test('what comes back is checked before the renderer sees it', async () => {
  reset();
  install('x:tiles');
  const request = { capabilityId: 'x:tiles', service: SERVICE, path: TILE };

  const tile = await fetchCapabilityTile(request, respond(new Uint8Array([0xff, 0xd8, 0xff]).buffer));
  assert.equal(tile.mimeType, 'image/jpeg');
  assert.equal(tile.bytes.byteLength, 3);

  // The content type is declared by a third party, so only the handful of things a tile
  // can legitimately be is accepted.
  await assert.rejects(() => fetchCapabilityTile(request, respond(new ArrayBuffer(8), { type: 'text/html' })), /returned text\/html/);
  await assert.rejects(() => fetchCapabilityTile(request, respond(new ArrayBuffer(8), { type: 'image/svg+xml' })), /returned image\/svg\+xml/);
  await assert.rejects(() => fetchCapabilityTile(request, respond(new ArrayBuffer(8), { type: '' })), /an unknown type/);
  await assert.rejects(() => fetchCapabilityTile(request, respond(new ArrayBuffer(8), { status: 404 })), /answered 404/);
  await assert.rejects(() => fetchCapabilityTile(request, respond(new ArrayBuffer(9_000_000))), /larger than allowed/);

  // And the request itself never follows a redirect, which is how an allowed origin would
  // otherwise hand the connection to one that is not.
  let seen;
  await fetchCapabilityTile(request, async (url, init) => {
    seen = { url, ...init };
    return (await respond(new ArrayBuffer(4))())
  });
  assert.equal(seen.redirect, 'error');
  assert.equal(seen.method, 'GET');
  assert.equal(seen.url, `${SERVICE}/${TILE}`);
});

test('an oversized tile is cut off while it streams, not buffered whole and measured after', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const { build } = await import('esbuild');
  const root = path.resolve(import.meta.dirname, '..');
  const source = fs.readFileSync(path.join(root, 'electron/capabilities/tileProxy.ts'), 'utf8');
  assert.doesNotMatch(source, /Buffer\.from\(await response\.arrayBuffer\(\)\)/, 'the tile body is not read whole');
  assert.match(source, /readCappedBody\(response, LIMITS\.tileBytes,/);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capped-body-'));
  try {
    const bundle = path.join(scratch, 'capped.cjs');
    await build({ entryPoints: [path.join(root, 'electron/capabilities/cappedBody.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const { readCappedBody } = createRequire(import.meta.url)(bundle);
    const limit = 8 * 1024 * 1024;
    let pulled = 0;
    const endless = new ReadableStream({ pull(controller) { pulled += 1 << 20; controller.enqueue(new Uint8Array(1 << 20)); } });
    await assert.rejects(readCappedBody(new Response(endless), limit, 'too large'), /too large/);
    assert.ok(pulled <= limit + (2 << 20), `stopped near the limit (pulled ${pulled} bytes)`);
    await assert.rejects(readCappedBody(new Response('x', { headers: { 'content-length': String(limit + 1) } }), limit, 'too large'), /too large/);
    assert.equal((await readCappedBody(new Response('tile'), limit, 'too large')).toString(), 'tile');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
