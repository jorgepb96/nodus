// The Nodi overlay and the Presenter windows no longer receive the whole bridge.
//
// Nothing else can catch a gap: src/global.d.ts declares `window.nodus: NodusApi`
// for every renderer, so a Nodi component calling a method its window does not
// expose typechecks fine and fails at runtime, in a window with no devtools open.
// This test compares the declared per-window surfaces against every
// `window.nodus.*` call in the code each window actually loads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readSource, ipcCensus } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const allFiles = sourceFiles(path.join(repoRoot, 'src')).map((file) => ({
  rel: path.relative(repoRoot, file).split(path.sep).join('/'),
  code: readFileSync(file, 'utf8'),
}));

/** Every source file a window's bundle actually contains.
 *
 *  Asked of the bundler rather than described with a pattern here. A pattern names the
 *  files somebody thought of: `ChatMarkdown.tsx` was named, and the module it imports to
 *  ask which fences each capability claims was not, so a call that took the whole Nodi
 *  chat panel down with a TypeError passed this test unnoticed. An import graph has no
 *  such blind spot — it is the same graph the window loads. */
async function bundledSources(entry) {
  const result = await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true, write: false, metafile: true, platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    loader: { '.css': 'empty', '.png': 'empty', '.jpg': 'empty', '.svg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    plugins: [{
      // Vite's `?url` and `?raw` suffixes: an asset reference, never code that could call
      // the bridge, so a stub keeps the graph walkable without changing what it contains.
      name: 'vite-asset-queries',
      setup(api) {
        api.onResolve({ filter: /\?(url|raw|worker|inline)$/ }, ({ path: value }) => ({ path: value, namespace: 'vite-asset' }));
        api.onLoad({ filter: /.*/, namespace: 'vite-asset' }, () => ({ contents: 'export default ""', loader: 'js' }));
      },
    }],
  });
  return new Set(Object.keys(result.metafile.inputs).filter(file => /^src\/.*\.tsx?$/.test(file)));
}

/** The bridge methods called by the files a window class loads. */
function methodsUsedBy(owns) {
  const used = new Map();
  for (const { rel, code } of allFiles) {
    if (!owns(rel)) continue;
    for (const match of code.matchAll(/window\.nodus\??\.([A-Za-z0-9_]+)/g)) {
      if (!used.has(match[1])) used.set(match[1], rel);
    }
  }
  return used;
}

const overlaySources = await bundledSources('src/mascot.tsx');
const presenterSources = new Set([
  ...await bundledSources('src/presenter/presenterView.tsx'),
  ...await bundledSources('src/presenter/audience.tsx'),
]);

/** The names in a `X_WINDOW_METHODS` tuple in shared/api/windows.ts. */
function declaredMethods(constName) {
  const source = readFileSync(path.join(repoRoot, 'shared/api/windows.ts'), 'utf8');
  const start = source.indexOf(`export const ${constName} = [`);
  assert.ok(start >= 0, `${constName} is not declared in shared/api/windows.ts`);
  const end = source.indexOf('] as const', start);
  return [...source.slice(start, end).matchAll(/^\s*'([A-Za-z0-9_]+)',$/gm)].map((match) => match[1]);
}

test('the Nodi overlay declares every bridge method its code calls', () => {
  const declared = new Set(declaredMethods('NODI_WINDOW_METHODS'));
  // mascot.html loads src/mascot.tsx; this is everything that ends up in that bundle.
  const used = methodsUsedBy((rel) => overlaySources.has(rel));
  const missing = [...used].filter(([name]) => !declared.has(name)).map(([name, rel]) => `${name} (${rel})`);
  assert.deepEqual(missing, [], 'Nodi calls methods its preload does not expose');
});

test('the Nodi overlay does not acquire vault attachment storage through shared Markdown', () => {
  const declared = new Set(declaredMethods('NODI_WINDOW_METHODS'));
  const used = methodsUsedBy((rel) => overlaySources.has(rel));
  for (const method of ['storePageAsset', 'pickPageAsset', 'getPageAsset']) {
    assert.equal(declared.has(method), false, `${method} stays outside the overlay bridge`);
    assert.equal(used.has(method), false, `shared rendering must not require ${method} in the overlay`);
  }
});

test('the Presenter windows declare every bridge method their code calls', () => {
  const declared = new Set(declaredMethods('PRESENTER_WINDOW_METHODS'));
  // presenterAudience.html and presenterView.html. src/presenter/remote/ is the phone
  // remote: served over HTTP by the cast server, with no preload at all, so it is not a
  // window class here and nothing imports it into these two.
  const used = methodsUsedBy((rel) => presenterSources.has(rel));
  const missing = [...used].filter(([name]) => !declared.has(name)).map(([name, rel]) => `${name} (${rel})`);
  assert.deepEqual(missing, [], 'the Presenter calls methods its preload does not expose');
});

test('every declared per-window method exists on the NodusApi surface', () => {
  const { apiMethods } = ipcCensus();
  for (const constName of ['NODI_WINDOW_METHODS', 'PRESENTER_WINDOW_METHODS']) {
    for (const name of declaredMethods(constName)) {
      assert.ok(apiMethods.has(name), `${constName} lists '${name}', which NodusApi does not declare`);
    }
  }
});

test('each window class loads its own preload, sandboxed', () => {
  const expectations = [
    ['electron/main.ts', 'preload.cjs'],
    ['electron/mascotWindow.ts', 'preload.nodi.cjs'],
    ['electron/toolkit/presenter/windows.ts', 'preload.presenter.cjs'],
  ];
  for (const [file, preload] of expectations) {
    const source = readSource(file);
    assert.match(source, new RegExp(`preload: path\\.join\\(__dirname, '${preload.replace(/\./g, '\\.')}'\\)`), `${file} must load ${preload}`);
    // One line per window, and the only line that has to be reverted if a
    // sandboxed renderer ever turns out to break something subtle.
    assert.match(source, /sandbox: true,/, `${file} must sandbox its renderer`);
  }
});

test('each preload is built on its own, because a sandboxed one cannot require a chunk', () => {
  const config = readSource('vite.config.ts');
  // rollup splits shared modules into chunks as soon as a build has two entries, and
  // a sandboxed preload's `require` resolves electron and a couple of builtins only.
  assert.match(config, /inlineDynamicImports: true/, 'preload builds must stay single-file');
  for (const name of ['preload.nodi', 'preload.presenter']) {
    assert.ok(config.includes(`'${name}'`), `vite.config.ts must build ${name}`);
  }
});
