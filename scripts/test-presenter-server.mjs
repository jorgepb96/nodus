// F4 — the security-critical helpers of the mobile-remote server: PIN auth and
// path-traversal guards. The Electron-free module (electron/toolkit/presenter/
// serverAuth.ts) is esbuild-bundled and driven directly. This is the LAN-facing
// surface, so the guards are asserted explicitly: loopback bypasses the PIN, LAN
// needs it, and no crafted id/url can escape the library or dist directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-srv-'));
const bundle = path.join(outDir, 'serverAuth.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'electron/toolkit/presenter/serverAuth.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' },
);
const A = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('makePin returns a 6-digit string', () => {
  for (let i = 0; i < 50; i++) assert.match(A.makePin(), /^\d{6}$/);
});

test('loopback is recognised across forms', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) assert.equal(A.isLoopback(a), true);
  for (const a of ['192.168.1.20', '10.0.0.5', undefined]) assert.equal(A.isLoopback(a), false);
});

test('isAuthorized: loopback bypasses the PIN, LAN requires the exact PIN', () => {
  assert.equal(A.isAuthorized('127.0.0.1', null, '123456'), true);
  assert.equal(A.isAuthorized('192.168.1.20', '123456', '123456'), true);
  assert.equal(A.isAuthorized('192.168.1.20', '000000', '123456'), false);
  assert.equal(A.isAuthorized('192.168.1.20', null, '123456'), false);
  // No PIN set yet → LAN client is refused.
  assert.equal(A.isAuthorized('192.168.1.20', '123456', null), false);
});

test('safePdfPath neutralises traversal by reducing the id to a basename', () => {
  const base = '/tmp/nodus-lib';
  const ok = A.safePdfPath(base, 'abc123');
  assert.ok(ok && ok.endsWith(`${path.sep}abc123.pdf`) && ok.startsWith(base));
  // A traversal id collapses to a filename INSIDE the library dir (cannot escape).
  const evil = A.safePdfPath(base, '../../etc/passwd');
  assert.ok(evil && evil.startsWith(base + path.sep) && evil.endsWith(`${path.sep}passwd.pdf`));
  // Degenerate ids are rejected outright.
  assert.equal(A.safePdfPath(base, '..'), null);
  assert.equal(A.safePdfPath(base, ''), null);
});

test('safeStaticPath maps "/" to the mobile page and blocks directory escape', () => {
  const dist = '/tmp/nodus-dist';
  assert.equal(A.safeStaticPath(dist, '/'), path.resolve(dist, 'presenterRemote.html'));
  assert.equal(A.safeStaticPath(dist, '/assets/app.js'), path.resolve(dist, 'assets/app.js'));
  assert.equal(A.safeStaticPath(dist, '/assets/../../secret'), null);
  assert.equal(A.safeStaticPath(dist, '/../../../etc/passwd'), null);
});

test('contentTypeFor covers the served asset kinds', () => {
  assert.match(A.contentTypeFor('/x/presenterRemote.html'), /text\/html/);
  assert.match(A.contentTypeFor('/x/app.js'), /javascript/);
  assert.match(A.contentTypeFor('/x/w.wasm'), /application\/wasm/);
  assert.equal(A.contentTypeFor('/x/thing.bin'), 'application/octet-stream');
});

test('the shared Presenter link omits the PIN and its mobile page asks for it', async () => {
  const serverSource = await readFile(path.join(repoRoot, 'electron/toolkit/presenter/server.ts'), 'utf8');
  const remoteSource = await readFile(path.join(repoRoot, 'src/presenter/remote/main.tsx'), 'utf8');
  assert.match(serverSource, /presenterRemote\.html`/);
  assert.doesNotMatch(serverSource, /presenterRemote\.html\?pin=/);
  assert.doesNotMatch(serverSource, /pathname === ['"]\/api\/qr['"]/);
  assert.match(remoteSource, /data-testid="presenter-pin-gate"/);
  assert.match(remoteSource, /event\.code === 4001/);
  assert.match(remoteSource, /pattern="\[0-9\]\{6\}"/);
});

test('wrong PINs close the gate: a LAN client cannot walk the 6-digit space', () => {
  assert.equal(typeof A.createPinGate, 'function', 'the servers admit through a stateful gate');
  const gate = A.createPinGate('654321');
  let admitted = 0;
  for (let guess = 0; guess < 1000; guess++) {
    if (gate.admit({ remoteAddress: '192.168.1.20', providedPin: String(guess).padStart(6, '0') })) admitted++;
  }
  assert.equal(admitted, 0);
  assert.equal(gate.admit({ remoteAddress: '192.168.1.20', providedPin: '654321' }), false, 'after the limit even the right PIN is refused from that address');
  assert.equal(gate.admit({ remoteAddress: '192.168.1.21', providedPin: '654321' }), true, 'another device with the right PIN still joins');

  // Many addresses share one session limit.
  const shared = A.createPinGate('654321');
  for (let i = 0; i < A.PIN_FAILURES_PER_SESSION; i++) shared.admit({ remoteAddress: `10.0.${i >> 8}.${i & 255}`, providedPin: '000000' });
  assert.equal(shared.admit({ remoteAddress: '10.9.9.9', providedPin: '654321' }), false);
});

test('loopback skips the PIN only for a request addressed to loopback and not sent by a foreign page', () => {
  const gate = A.createPinGate('654321');
  assert.equal(gate.admit({ remoteAddress: '127.0.0.1', providedPin: null, host: '127.0.0.1:50123' }), true);
  assert.equal(gate.admit({ remoteAddress: '::1', providedPin: null, host: '[::1]:50123' }), true);
  assert.equal(gate.admit({ remoteAddress: '127.0.0.1', providedPin: null, host: 'localhost:50123', origin: 'http://localhost:50123' }), true);
  // A page in the presenter's browser opening ws://127.0.0.1:<port>.
  assert.equal(gate.admit({ remoteAddress: '127.0.0.1', providedPin: null, host: '127.0.0.1:50123', origin: 'https://evil.example' }), false);
  // A DNS-rebinding page: same-origin to itself, so no Origin, but its own host name.
  assert.equal(gate.admit({ remoteAddress: '127.0.0.1', providedPin: null, host: 'rebind.evil.example:50123' }), false);
  assert.equal(gate.admit({ remoteAddress: '127.0.0.1', providedPin: '654321', host: 'rebind.evil.example:50123' }), true, 'with the PIN it is an ordinary client');
});

test('both LAN servers admit through the gate, not the stateless check', async () => {
  for (const file of ['electron/toolkit/presenter/server.ts', 'electron/toolkit/apps/server.ts']) {
    const source = await readFile(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /isAuthorized\(/, file);
    assert.match(source, /createPinGate\(pin\)/, file);
  }
});
