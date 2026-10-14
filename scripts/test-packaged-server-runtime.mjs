// The server inside the desktop app must be able to load what it imports.
//
// From 5.0.4 to 5.9.1 it could not: electron-builder copied server/ into Resources/nodus-server
// with no node_modules and no shared/ beside it, so basic mode's child process died loading.
// Every other test ran the server from the repository, where the checkout answered for it. These
// tests run the server from a directory with no repository above it, laid out the way the app
// lays it out, and check that the inventory both the image and the app install from is whole.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = require('./packaged-server-runtime.cjs');
const serverManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'server/package.json'), 'utf8'));

test('server/package.json declares every package the server imports', async () => {
  const graph = await runtime.serverSourceGraph(repoRoot);
  const declared = new Set(Object.keys({ ...serverManifest.dependencies, ...serverManifest.optionalDependencies }));
  const undeclared = [...graph.packages]
    .filter(([name]) => !declared.has(name))
    .map(([name, importers]) => `${name} (imported by ${importers.join(', ')})`);
  assert.deepEqual(
    undeclared,
    [],
    'Declare these in server/package.json: the image installs only that file, and the app copies only what it lists.',
  );
  // The graph must actually see the imports that broke releases, or the check above is empty.
  for (const name of ['pdf-lib', 'subset-font', 'better-sqlite3', 'esbuild', 'yjs']) {
    assert.ok(graph.packages.has(name), `the graph lost ${name}`);
  }
  // yjs is reached only through the canonical migrations the server compiles at runtime.
  assert.ok(graph.packages.get('yjs').some((file) => file.startsWith('shared/')));
});

test('files the server reaches outside server/ are found and import no packages', async () => {
  const graph = await runtime.serverSourceGraph(repoRoot);
  assert.ok(graph.outsideFiles.includes('shared/serverProfilePreferences.mjs'));
  assert.ok(graph.outsideFiles.every((file) => file.startsWith('shared/')), graph.outsideFiles.join(', '));
  assert.ok(graph.migrationFiles.includes(runtime.MIGRATIONS_ENTRY));
  assert.deepEqual(graph.unreachablePackages, []);
  // The Dockerfile copies these to /shared; the app to <resources>/shared. Same relative import.
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'server/Dockerfile'), 'utf8');
  for (const file of graph.outsideFiles) assert.ok(dockerfile.includes(`COPY ${file} /${file}`), `the image must carry ${file}`);
});

test('the root install provides every declared package, at a version the server accepts', () => {
  const closure = runtime.serverPackageClosure(repoRoot);
  const names = new Set(closure.map((entry) => entry.name));
  for (const name of Object.keys(serverManifest.dependencies)) assert.ok(names.has(name), `${name} is not in the closure`);
  // Transitive packages come along: yjs needs lib0, subset-font loads harfbuzzjs's wasm.
  for (const name of ['lib0', 'harfbuzzjs']) assert.ok(names.has(name), `${name} is not in the closure`);
  for (const entry of closure) assert.match(entry.relative, /^node_modules\//);
  assert.equal(new Set(closure.map((entry) => entry.relative)).size, closure.length);
});

/** A miniature repository: server/package.json and a hand-made node_modules. */
function fixture(serverDependencies, packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-closure-'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.writeFileSync(path.join(root, 'server/package.json'), JSON.stringify({ dependencies: serverDependencies }));
  for (const [relative, manifest] of Object.entries(packages)) {
    fs.mkdirSync(path.join(root, relative), { recursive: true });
    fs.writeFileSync(path.join(root, relative, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

test('the closure nests as npm nested it, skips absent optional packages and refuses absent required ones', () => {
  const root = fixture({ a: '^1.0.0', b: '^1.0.0' }, {
    'node_modules/a': { name: 'a', version: '1.2.0', dependencies: { c: '^2.0.0' }, optionalDependencies: { 'a-other-platform': '1.0.0' } },
    // a needs c@2, b needs c@1: npm nests a's copy, and the copy must nest it the same way.
    'node_modules/a/node_modules/c': { name: 'c', version: '2.0.0', dependencies: { a: '^1.0.0' } },
    'node_modules/b': { name: 'b', version: '1.0.0', dependencies: { c: '^1.0.0' } },
    'node_modules/c': { name: 'c', version: '1.0.0' },
    'node_modules/unrelated': { name: 'unrelated', version: '9.9.9' },
  });
  try {
    assert.deepEqual(
      runtime.serverPackageClosure(root).map((entry) => `${entry.relative}@${entry.version}`),
      ['node_modules/a@1.2.0', 'node_modules/a/node_modules/c@2.0.0', 'node_modules/b@1.0.0', 'node_modules/c@1.0.0'],
    );
    fs.writeFileSync(path.join(root, 'node_modules/b/package.json'), JSON.stringify({ name: 'b', version: '1.0.0', dependencies: { gone: '1' } }));
    assert.throws(() => runtime.serverPackageClosure(root), /gone \(needed by b\) is not installed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a root install outside the server’s declared range stops the build', () => {
  const root = fixture({ a: '^2.0.0' }, { 'node_modules/a': { name: 'a', version: '1.2.0' } });
  try {
    assert.throws(() => runtime.serverPackageClosure(root), /asks for a@\^2\.0\.0, but the root lockfile installs 1\.2\.0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only what Node cannot load is left out, and licences always stay', () => {
  const needed = runtime.packageEntryNeeded;
  for (const kept of ['package.json', 'lib/index.js', 'dist/yjs.mjs', 'LICENSE', 'LICENSE.md', 'NOTICE', 'harfbuzzjs/hb-subset.wasm', 'build/Release/better_sqlite3.node']) {
    assert.equal(needed(kept, { nativeAddon: kept.endsWith('.node') }), true, kept);
  }
  for (const dropped of ['README.md', 'index.d.ts', 'src/index.ts', 'cjs/index.js.map']) {
    assert.equal(needed(dropped), false, dropped);
  }
  assert.equal(needed('node_modules', { directory: true }), false, 'nested dependencies are staged separately');
  // A native addon's sources and object files are only for compiling it…
  for (const directory of ['deps', 'src', 'build/Release/obj', 'build/Release/obj.target', 'build/Release/.deps']) {
    assert.equal(needed(directory, { directory: true, nativeAddon: true }), false, directory);
  }
  // …while in an ordinary package src/ may be the code itself.
  assert.equal(needed('src', { directory: true }), true);
  assert.equal(needed('build/Release', { directory: true, nativeAddon: true }), true);
});

/** Copy server/ the way package.json's extraResources entry does, into <resources>/nodus-server. */
function copyServerAsElectronBuilderDoes(resourcesPath) {
  const entry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    .build.extraResources.find((candidate) => candidate.from === 'server');
  assert.equal(entry.to, 'nodus-server');
  const excluded = new Set(entry.filter.filter((rule) => rule.startsWith('!') && !rule.includes('*')).map((rule) => rule.slice(1)));
  const source = path.join(repoRoot, 'server');
  fs.cpSync(source, path.join(resourcesPath, entry.to), {
    recursive: true,
    filter: (file) => !excluded.has(path.relative(source, file).split(path.sep)[0]),
  });
}

// Outside the repository on purpose: anywhere under it, a missing package would quietly resolve
// from the checkout's own node_modules and this would pass for the wrong reason.
function scratchResources() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-packaged-server-'));
  assert.ok(path.relative(repoRoot, directory).startsWith('..'), 'scratch must be outside the repository');
  return directory;
}

test('THE REGRESSION: server/ copied on its own, as 5.0.4–5.9.1 shipped it, does not run', async () => {
  const resources = scratchResources();
  try {
    copyServerAsElectronBuilderDoes(resources);
    await assert.rejects(
      runtime.verifyPackagedServerRuntime({ executable: process.execPath, resourcesPath: resources, requireNative: false }),
      (error) => /cannot load what it needs/.test(error.message) && /resolves pdf-lib/.test(error.message),
    );
  } finally {
    fs.rmSync(resources, { recursive: true, force: true });
  }
});

test('the staged server loads its whole graph and answers /healthz with no repository around it', async () => {
  const resources = scratchResources();
  try {
    copyServerAsElectronBuilderDoes(resources);
    const staged = await runtime.stagePackagedServerRuntime({ repoRoot, resourcesPath: resources });
    const serverRoot = path.join(resources, 'nodus-server');
    // The image's layout: preferences beside the server, migration sources inside it.
    assert.ok(fs.existsSync(path.join(resources, 'shared/serverProfilePreferences.mjs')));
    assert.ok(fs.existsSync(path.join(serverRoot, runtime.MIGRATIONS_ENTRY)));
    assert.ok(fs.existsSync(path.join(serverRoot, 'node_modules/yjs/package.json')));
    assert.ok(!fs.existsSync(path.join(serverRoot, 'node_modules/better-sqlite3/deps')), 'compiler inputs must not ship');
    assert.ok(staged.packages.length > 20);

    const result = await runtime.verifyPackagedServerRuntime({ executable: process.execPath, resourcesPath: resources, requireNative: false });
    for (const expected of [/^resolves pdf-lib/, /^canonical migrations compile/, /^Deep Research PDF renders Chinese text/, /answered \/healthz/]) {
      assert.ok(result.passed.some((line) => expected.test(line)), `${expected} did not pass: ${result.passed.join('; ')}`);
    }
  } finally {
    fs.rmSync(resources, { recursive: true, force: true });
  }
});
