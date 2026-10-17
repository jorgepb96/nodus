// The desktop app's basic mode serves the Nodus Server web app from nodus-server/dist/web.
// Releases shipped without it (5.9.1 has no Resources/nodus-server/dist) because only the
// Docker image ran `npm run build:server-web`. These tests drive the real electron-builder
// hooks with child processes stubbed: beforePack must build it, afterPack must refuse an app
// that does not carry it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Both hooks take execFileSync from node:child_process when they load, so the stub must be in
// place first. Nothing a test runs reaches a real build, download or signer.
const childProcess = require('node:child_process');
const calls = [];
let onCall = () => {};
childProcess.execFileSync = (file, args = [], options = {}) => {
  calls.push({ file, args, options });
  return onCall(file, args, options);
};
// beforePack's macOS-only tail compiles native helpers and writes the Dock tile into build/.
// A beforePack that no longer builds the server web app must fail here, not write there.
const { Module } = require('node:module');
for (const [file, name] of [['build-apple-calendar.cjs', 'buildAppleCalendar'], ['build-presenter-native.cjs', 'buildPresenterNative'], ['build-system-audio.cjs', 'buildSystemAudio'], ['build-trackpad-native.cjs', 'buildTrackpadNative']]) {
  const filename = require.resolve(`./${file}`);
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = { [name]: () => { throw new Error('beforePack reached its macOS-only steps'); } };
  require.cache[filename] = stub;
}

const { Arch } = require('electron-builder');
const beforePack = require('../build/beforePack.cjs').default;
const afterPack = require('../build/afterPack.cjs').default;
const { SERVER_WEB_CONFIG, buildServerWeb, missingServerWebFiles } = require('./packaged-server-web.cjs');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-packaged-server-web-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
let fixtures = 0;
const fixtureDir = () => fs.mkdtempSync(path.join(scratch, `${fixtures++}-`));

function writeServerWeb(webDir, { index = true, script = true, organism = true } = {}) {
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  if (index) {
    fs.writeFileSync(path.join(webDir, 'index.html'), [
      '<link rel="icon" href="/favicon.svg" />',
      '<script type="module" crossorigin src="/app/assets/index-C2cJnWDj.js"></script>',
      '<link rel="stylesheet" crossorigin href="/app/assets/index-BAb5CGx_.css">',
    ].join('\n'));
  }
  if (script) fs.writeFileSync(path.join(webDir, 'assets', 'index-C2cJnWDj.js'), 'export {};');
  fs.writeFileSync(path.join(webDir, 'assets', 'index-BAb5CGx_.css'), '');
  if (organism) fs.writeFileSync(path.join(webDir, 'organism.js'), '');
}

const isViteBuild = (args) => args.some((arg) => arg.endsWith(path.join('vite', 'bin', 'vite.js')));

test('beforePack builds the server web app with the build:server-web config, and a failed build stops packaging', async () => {
  calls.length = 0;
  onCall = (file, args) => {
    if (isViteBuild(args)) throw new Error('server web build failed');
  };
  await assert.rejects(
    beforePack({ electronPlatformName: process.platform, arch: Arch[process.arch] }),
    /server web build failed/,
  );
  const vite = calls.filter((call) => isViteBuild(call.args));
  assert.equal(vite.length, 1, 'beforePack must build the server web app exactly once');
  assert.equal(vite[0].file, process.execPath);
  assert.deepEqual(vite[0].args, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', SERVER_WEB_CONFIG]);
  assert.equal(vite[0].options.cwd, root);
  // The hook runs exactly what `npm run build:server-web` (CI, the Docker image) runs.
  assert.equal(pkg.scripts['build:server-web'], `vite build --config ${SERVER_WEB_CONFIG}`);
  assert.equal(pkg.build.beforePack, 'build/beforePack.cjs');
  assert.equal(pkg.build.afterPack, 'build/afterPack.cjs');
});

test('the server web build is checked for what the server will serve', () => {
  const repo = fixtureDir();
  const webDir = path.join(repo, 'server', 'dist', 'web');
  let ran = 0;

  assert.throws(() => buildServerWeb(repo, () => { ran += 1; }), /The server web build does not carry the Nodus Server web app: index\.html missing/);

  assert.throws(
    () => buildServerWeb(repo, () => { ran += 1; writeServerWeb(webDir, { script: false, organism: false }); }),
    (error) => /assets\/index-C2cJnWDj\.js, organism\.js missing/.test(error.message) && !/\.css/.test(error.message),
  );

  assert.equal(buildServerWeb(repo, () => { ran += 1; writeServerWeb(webDir); }), webDir);
  assert.equal(ran, 3);

  // An index.html that loads no /app/ script is the wrong file, not a smaller app.
  fs.writeFileSync(path.join(webDir, 'index.html'), '<div id="root"></div>');
  assert.deepEqual(missingServerWebFiles(webDir), ['the /app/ script index.html should load']);
});

test('the server extra resource carries dist/web into nodus-server', () => {
  const server = pkg.build.extraResources.find((entry) => entry.from === 'server');
  assert.equal(server?.to, 'nodus-server');
  for (const pattern of server.filter ?? []) {
    if (!pattern.startsWith('!')) continue;
    const first = pattern.slice(1).split('/')[0];
    assert.ok(!['dist', '**', '*'].includes(first), `extraResources filter ${pattern} may drop server/dist/web`);
  }
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`afterPack refuses a ${platform} app without the server web app`, async () => {
    const appOutDir = fixtureDir();
    const resources = platform === 'darwin' ? path.join(appOutDir, 'Nodus.app', 'Contents', 'Resources') : path.join(appOutDir, 'resources');
    const legal = path.join(resources, 'legal', 'generated');
    fs.mkdirSync(legal, { recursive: true });
    fs.writeFileSync(path.join(legal, 'ELECTRON_LICENSE.txt'), 'MIT');
    fs.writeFileSync(path.join(legal, 'ELECTRON_CHROMIUM_LICENSES.html'), '<html></html>');
    const context = {
      packager: { appInfo: { productFilename: 'Nodus' } },
      appOutDir,
      electronPlatformName: platform,
      arch: Arch[process.arch],
    };
    const webDir = path.join(resources, 'nodus-server', 'dist', 'web');
    // Stop at the next step that spawns anything (Drift, on every platform): the rest is not this test's.
    onCall = () => { throw new Error('reached the next afterPack step'); };

    await assert.rejects(afterPack(context), /The packed Nodus does not carry the Nodus Server web app: index\.html missing/);
    writeServerWeb(webDir, { script: false });
    await assert.rejects(afterPack(context), /assets\/index-C2cJnWDj\.js missing/);

    writeServerWeb(webDir);
    await assert.rejects(afterPack(context), /reached the next afterPack step/);
  });
}
