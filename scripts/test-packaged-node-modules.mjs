// The packaged node_modules is pruned to the main process's runtime closure
// (build/packagedNodeModules.cjs). Pruning too little only costs megabytes;
// pruning too much ships an app that breaks on a user's machine the first time a
// feature reaches for the missing package. These hold both directions, through
// electron-builder's own matcher, and the verifier that re-checks a packed app.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire, builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pruning = require('../build/packagedNodeModules.cjs');
const verifier = require('./verify-packaged-node-modules.cjs');
const asar = require('@electron/asar');
const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher.js');

const packages = pruning.readLockPackages();
const reached = pruning.runtimePackagePaths(packages);
const exclusions = pruning.packagedNodeModuleExclusions(packages);
const BUILTINS = new Set(builtinModules);

/** electron-builder's real node_modules filter for one platform and architecture. */
function nodeModuleFilter(platform, arch) {
  const expand = (pattern) => pattern.replaceAll('${platform}', platform).replaceAll('${arch}', arch);
  const files = require('../build/electron-builder.config.cjs').files;
  const matcher = getNodeModuleFileMatcher(repoRoot, '/app', expand, {}, {
    config: { files },
    debugLogger: { isEnabled: false },
  });
  const filter = matcher.createFilter();
  return (relative, directory = false) => filter(path.join(repoRoot, relative), {
    isDirectory: () => directory,
    moduleFullFilePath: relative,
  });
}

test('vite.config.ts takes its main-process externals from the packager', () => {
  const vite = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(vite, /require\('\.\/build\/packagedNodeModules\.cjs'\)/);
  assert.doesNotMatch(vite, /const mainExternals = \[/, 'a second list would let the bundler and the packager disagree');
});

test('every package the main process loads stays, on every platform', () => {
  const roots = [...pruning.MAIN_PROCESS_EXTERNALS, ...pruning.RUNTIME_RESOLVED_SPECIFIERS]
    .map(pruning.packageNameOf)
    .filter((name) => pruning.isProductionPackage(name, packages));
  assert.ok(roots.length > 15);
  for (const name of roots) assert.ok(reached.has(`node_modules/${name}`), `${name} is a runtime root`);

  for (const at of [
    'node_modules/onnxruntime-node',
    'node_modules/tesseract.js-core',
    'node_modules/libheif-js',
    'node_modules/harfbuzzjs',
    'node_modules/@huggingface/transformers/node_modules/onnxruntime-common',
    // Each platform's native package reaches its own build through optionalDependencies.
    'node_modules/@openai/codex-darwin-arm64',
    'node_modules/@openai/codex-win32-x64',
    'node_modules/@openai/codex-linux-x64',
    'node_modules/@github/copilot-darwin-x64',
    'node_modules/@github/copilot-win32-x64',
    'node_modules/@github/copilot-linux-x64',
    'node_modules/@img/sharp-win32-x64',
    'node_modules/@napi-rs/canvas-linux-x64-gnu',
    'node_modules/@koromix/koffi-win32-x64',
  ]) {
    assert.ok(packages[at], `${at} is in package-lock.json`);
    assert.ok(reached.has(at), `${at} is kept`);
  }
});

test('the renderer-only packages are left out of the app', () => {
  for (const at of [
    'node_modules/onnxruntime-web',
    'node_modules/@huggingface/transformers/node_modules/onnxruntime-web',
    'node_modules/@mathjax/src',
    'node_modules/@mathjax/mathjax-newcm-font',
    'node_modules/@blocknote/react',
    'node_modules/@emoji-mart/data',
    'node_modules/kokoro-js',
    'node_modules/@diffusionstudio/piper-wasm',
    'node_modules/three',
    'node_modules/react-dom',
  ]) {
    assert.ok(packages[at] && packages[at].dev !== true, `${at} is a production dependency`);
    assert.ok(exclusions.includes(`!${at}{,/**}`), `${at} is excluded`);
  }
});

test('every package electron/ resolves by name at runtime is kept', () => {
  // Bundling resolves imports; a createRequire()d name, or a require.resolve() of a
  // file inside a package, reaches node_modules only when the app runs.
  const named = new Map();
  const pending = [path.join(repoRoot, 'electron')];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/(?:\brequire|\breq|\))(?:\.resolve)?\(\s*['"]([^'"./][^'"]*)['"]/g)) {
          const name = pruning.packageNameOf(match[1]);
          if (match[1].startsWith('node:') || BUILTINS.has(name)) continue;
          named.set(name, path.relative(repoRoot, file));
        }
      }
    }
  }
  for (const name of ['electron-updater', '@openai/codex', '@github/copilot', 'pagedjs', 'pdfjs-dist']) {
    assert.ok(named.has(name), `the scan still finds ${name}`);
  }
  for (const [name, file] of named) {
    if (!pruning.isProductionPackage(name, packages)) continue;
    assert.ok(reached.has(`node_modules/${name}`), `${file} resolves ${name} at runtime, so it must be packed`);
  }
});

test('the Node builds of transformers load nothing the closure leaves out', () => {
  const transformers = 'node_modules/@huggingface/transformers';
  for (const build of ['transformers.node.mjs', 'transformers.node.cjs']) {
    const source = fs.readFileSync(path.join(repoRoot, transformers, 'dist', build), 'utf8');
    const imported = new Set([...source.matchAll(/(?:^import .* from|\brequire\()\s*["']([^"'.][^"']*)["']/gm)].map((match) => match[1]));
    assert.ok(imported.has('onnxruntime-node'), `${build} still uses the native runtime`);
    assert.ok(!imported.has('onnxruntime-web'), `${build} must not load the web runtime the packager drops`);
    for (const specifier of imported) {
      if (specifier.startsWith('node:') || BUILTINS.has(specifier)) continue;
      const at = pruning.resolveLockPath(packages, transformers, pruning.packageNameOf(specifier));
      assert.ok(at && reached.has(at), `${build} imports ${specifier}, which must be packed (${at})`);
    }
  }
});

test("electron-builder's own matcher keeps exactly this platform's runtime", () => {
  const keeps = nodeModuleFilter('darwin', 'arm64');
  for (const kept of [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node',
    'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
    'node_modules/@huggingface/transformers/dist/transformers.node.cjs',
    'node_modules/@huggingface/transformers/node_modules/onnxruntime-common/dist/cjs/index.js',
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    'node_modules/sharp/package.json',
    // The loaders and the SDK stay; only the CLIs themselves are downloaded at first use.
    'node_modules/@openai/codex/package.json',
    'node_modules/@github/copilot/package.json',
    'node_modules/@github/copilot-sdk/dist/index.js',
  ]) assert.ok(keeps(kept), `${kept} is packed`);
  for (const dropped of [
    'node_modules/onnxruntime-node/bin/napi-v3/darwin/x64/libonnxruntime.1.21.0.dylib',
    'node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1',
    'node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime.dll',
    'node_modules/@huggingface/transformers/dist/transformers.web.js',
    'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm',
    'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort.min.js',
    'node_modules/onnxruntime-web/dist/ort-wasm.wasm',
    'node_modules/@mathjax/src/package.json',
    'node_modules/pdfjs-dist/build/pdf.mjs.map',
    'node_modules/better-sqlite3/deps/sqlite3/sqlite3.c',
    'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
    'node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
    'node_modules/@github/copilot-darwin-arm64/copilot',
    'node_modules/@github/copilot-linuxmusl-x64/copilot',
  ]) assert.ok(!keeps(dropped), `${dropped} is left out`);
  assert.ok(!keeps('node_modules/@mathjax/src', true), 'an excluded package is not even walked');

  const windows = nodeModuleFilter('win32', 'x64');
  assert.ok(windows('node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime.dll'));
  assert.ok(!windows('node_modules/onnxruntime-node/bin/napi-v3/win32/arm64/onnxruntime.dll'));
  assert.ok(!windows('node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node'));
});

test('local and release packaging both carry the pruning', () => {
  const base = require('../build/electron-builder.config.cjs');
  assert.deepEqual(base.files.slice(0, require('../package.json').build.files.length), require('../package.json').build.files);
  assert.ok(base.files.includes('!node_modules/@mathjax/src{,/**}'));

  const previous = process.env.NODUS_RELEASE_CHANNEL;
  process.env.NODUS_RELEASE_CHANNEL = 'latest';
  try {
    const releasePath = require.resolve('../build/electron-builder.release.cjs');
    delete require.cache[releasePath];
    assert.deepEqual(require(releasePath).files, base.files);
  } finally {
    if (previous === undefined) delete process.env.NODUS_RELEASE_CHANNEL;
    else process.env.NODUS_RELEASE_CHANNEL = previous;
  }

  const scripts = require('../package.json').scripts;
  for (const name of ['dist', 'dist:mac', 'dist:win', 'dist:linux']) {
    assert.match(scripts[name], /electron-builder .*--config build\/electron-builder\.config\.cjs/, `${name} packs with the pruning`);
  }
});

test('the verifier names what a packed main bundle needs and the archive lacks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-packed-modules-'));
  try {
    const app = path.join(root, 'app');
    fs.mkdirSync(path.join(app, 'dist-electron'), { recursive: true });
    fs.writeFileSync(path.join(app, 'dist-electron', 'main-abc.js'), [
      'const t = await import("@huggingface/transformers");',
      'const polyfill = require.resolve("pagedjs");',
      'import x from "react";', // a renderer package a careless main import would need
      'const fs = require("node:fs"); const p = require("path");',
      'const optional = require("utf-8-validate");', // not installed: not this check's business
      '/**',
      ' *   import {unified} from "unified"', // a bundled library's usage example, not an import
      ' */',
    ].join('\n'));
    for (const name of ['@huggingface/transformers', 'pagedjs', 'sharp']) {
      fs.mkdirSync(path.join(app, 'node_modules', name), { recursive: true });
      fs.writeFileSync(path.join(app, 'node_modules', name, 'package.json'), '{}');
    }
    const archive = path.join(root, 'app.asar');
    await asar.createPackage(app, archive);
    const packed = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''));

    const requests = pruning.runtimeRequests(packed, (file) => asar.extractFile(archive, file).toString('utf8'), packages);
    const { names } = requests;
    assert.ok(requests.load.includes('@huggingface/transformers') && requests.load.includes('react'), 'imports are loaded');
    assert.ok(requests.resolve.includes('pagedjs'), 'what main only locates is resolved, not loaded');
    assert.ok(requests.resolve.includes('@openai/codex/package.json'), 'a runtime-resolved root keeps its exact specifier');
    assert.ok(!names.includes('unified'), 'doc comments are not code');
    assert.ok(names.includes('react'), 'a package the bundle imports by name is checked');
    assert.ok(names.includes('better-sqlite3'), 'the runtime roots are always checked');
    assert.ok(!names.includes('electron') && !names.includes('path'), 'Electron and builtins are not packages to pack');
    const missing = pruning.findMissingRuntimePackages(names, packed);
    assert.ok(missing.includes('react') && missing.includes('better-sqlite3'));
    assert.ok(!missing.includes('pagedjs') && !missing.includes('@huggingface/transformers'));

    assert.throws(
      () => verifier.verifyPackagedNodeModules({ executable: process.execPath, resources: root }, { load: false, packages }),
      /missing packages its main process loads:[\s\S]*react/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the load probe reports a dependency a packed package cannot find', () => {
  // The probe is plain Node: run it here against a directory laid out like app.asar.
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-probe-'));
  try {
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
      fs.writeFileSync(path.join(app, file), text);
    };
    write('package.json', '{}');
    write('node_modules/works/package.json', '{"main":"index.js"}');
    write('node_modules/works/index.js', 'module.exports = 1;');
    write('node_modules/broken/package.json', '{"main":"index.js"}');
    write('node_modules/broken/index.js', 'require("onnxruntime-common");');
    write('node_modules/esm-only/package.json', '{"type":"module","exports":{".":{"import":"./index.js"}}}');
    write('node_modules/esm-only/index.js', 'export default await Promise.resolve(1);');
    write('node_modules/wants-electron/package.json', '{"main":"index.js"}');
    write('node_modules/wants-electron/index.js', 'require("electron");');
    // A CLI package like @openai/codex: nothing to load, only files to locate.
    write('node_modules/cli-only/package.json', '{"bin":{"cli":"bin/cli.js"}}');

    const requests = [
      ...['works', 'broken', 'esm-only', 'wants-electron'].map((specifier) => ({ kind: 'load', specifier })),
      { kind: 'resolve', specifier: 'cli-only/package.json' },
      { kind: 'resolve', specifier: 'cli-only/missing.wasm' },
    ];
    const run = spawnSync(process.execPath, ['-e', verifier.PROBE], {
      env: { ...process.env, NODUS_PROBE_APP: app, NODUS_PROBE_REQUESTS: JSON.stringify(requests) },
      encoding: 'utf8',
    });
    const marker = run.stdout.lastIndexOf('@@NODUS_PROBE@@');
    assert.notEqual(marker, -1, run.stderr);
    const results = Object.fromEntries(JSON.parse(run.stdout.slice(marker + 15).trim()).map((result) => [result.specifier, result]));
    assert.equal(results['cli-only/package.json'].error, null, 'a package with no entry point still resolves its files');
    assert.equal(results['cli-only/missing.wasm'].missing, 'cli-only/missing.wasm');
    assert.equal(results.works.error, null);
    assert.equal(results['esm-only'].error, null, 'an ESM-only package with top-level await loads through import()');
    assert.equal(results.broken.missing, 'onnxruntime-common');
    assert.equal(results['wants-electron'].missing, 'electron');

    // Only a missing production package is a packaging fault.
    assert.equal(verifier.missingPackage(results.broken.missing), 'onnxruntime-common');
    assert.ok(pruning.isProductionPackage('onnxruntime-common', packages));
    assert.ok(!pruning.isProductionPackage('electron', packages), 'Electron is the runtime, never a packed package');
    assert.equal(verifier.missingPackage('/abs/file.js'), null);
    assert.equal(verifier.missingPackage('./relative'), null);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test('the packed app carries the download manifest for its platform and none of the CLIs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-on-demand-'));
  try {
    const resources = path.join(root, 'Resources');
    const app = path.join(root, 'app');
    fs.mkdirSync(path.join(app, 'node_modules/@openai/codex'), { recursive: true });
    fs.writeFileSync(path.join(app, 'node_modules/@openai/codex/package.json'), '{}');
    fs.mkdirSync(resources);
    await asar.createPackage(app, path.join(resources, 'app.asar'));

    const manifest = verifier.stageAndVerifyOnDemandRuntimes({ resources }, 'darwin', 'arm64', packages);
    const written = JSON.parse(fs.readFileSync(path.join(resources, pruning.AGENT_RUNTIME_MANIFEST), 'utf8'));
    assert.deepEqual(written, manifest);
    assert.equal(written.packages['@openai/codex-darwin-arm64'].integrity, packages['node_modules/@openai/codex-darwin-arm64'].integrity);

    // An app that still carries a CLI, even unpacked and nested, is refused.
    const nested = path.join(resources, 'app.asar.unpacked/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'codex'), '');
    assert.throws(
      () => verifier.stageAndVerifyOnDemandRuntimes({ resources }, 'darwin', 'arm64', packages),
      /still carries CLIs[\s\S]*@openai\/codex-darwin-arm64/,
    );
    assert.throws(
      () => verifier.stageAndVerifyOnDemandRuntimes({ resources }, 'freebsd', 'x64', packages),
      /cannot download @openai\/codex-freebsd-x64/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

