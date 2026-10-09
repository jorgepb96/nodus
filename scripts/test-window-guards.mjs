import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Nodi's overlay and the presenter windows set no window-open handler, and nothing set a
// permission handler on the default session. Measured in Electron 43: window.open from such a
// window opened a new in-app window, and a data: page on the default session was GRANTED
// geolocation (every permission is granted when no handler is installed).

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(root, 'electron/windowGuards.ts');

async function load() {
  assert.ok(fs.existsSync(modulePath), 'electron/windowGuards.ts exists');
  const { build } = await import('esbuild');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-window-guards-'));
  const bundle = path.join(scratch, 'guards.cjs');
  await build({ entryPoints: [modulePath], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const loaded = createRequire(import.meta.url)(bundle);
  fs.rmSync(scratch, { recursive: true, force: true });
  return loaded;
}

test('main.ts installs the default guards on the default session', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(main, /installDefaultWindowGuards\(\{ app, session: session\.defaultSession,/);
});

test('every new contents denies window.open and hands the link to the system browser', async () => {
  const { installDefaultWindowGuards } = await load();
  const listeners = [];
  const opened = [];
  const handlers = {};
  installDefaultWindowGuards({
    app: { on: (event, listener) => listeners.push([event, listener]) },
    session: { setPermissionRequestHandler: h => { handlers.request = h; }, setPermissionCheckHandler: h => { handlers.check = h; } },
    openExternal: url => opened.push(url),
  });
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], 'web-contents-created');
  let windowOpen = null;
  listeners[0][1]({}, { setWindowOpenHandler: h => { windowOpen = h; } });
  assert.deepEqual(windowOpen({ url: 'https://example.org/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.org/']);

  const granted = (permission, requestingUrl) => new Promise(resolve => handlers.request(null, permission, resolve, { requestingUrl }));
  assert.equal(await granted('media', 'file:///Applications/Nodus.app/Contents/Resources/app/dist/index.html'), true, 'Nodus itself keeps the microphone');
  assert.equal(await granted('media', 'https://attacker.example/'), false, 'a foreign page does not');
  assert.equal(await granted('geolocation', 'https://attacker.example/'), false);
  assert.equal(await granted('openExternal', 'https://attacker.example/'), false);
  assert.equal(await granted('notifications', 'https://attacker.example/'), false);
  assert.equal(await granted('fullscreen', 'https://www.youtube-nocookie.com/embed/x'), true, 'an embedded video can still go full screen');
  assert.equal(handlers.check(null, 'geolocation', 'null', {}), false, 'an opaque origin is not Nodus');
  assert.equal(handlers.check(null, 'media', 'file://', {}), true);
});

test('the development server counts as Nodus only by its exact origin', async () => {
  const { defaultSessionPermissionAllowed } = await load();
  assert.equal(defaultSessionPermissionAllowed('media', 'http://localhost:5173/index.html', 'http://localhost:5173/'), true);
  assert.equal(defaultSessionPermissionAllowed('media', 'http://localhost:5174/', 'http://localhost:5173/'), false);
  assert.equal(defaultSessionPermissionAllowed('media', 'http://localhost:5173/'), false, 'and not at all in a packaged build');
});
