import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// The default `python3` is whichever interpreter was installed last, and that can be a version no
// package ships a lock for yet (3.15, while a package supports 3.11-3.14) with a supported
// `python3.11` sitting right beside it. Selection has to ask the package, not stop at the first
// interpreter that is new enough. Stub interpreters on a private PATH make that deterministic.

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-system-python-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'runtime.cjs');
await build({
  entryPoints: [path.join(root, 'electron/capabilities/pythonRuntime.ts')], outfile,
  bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'profile', setup(api) {
    api.onResolve({ filter: /^\.\/pluginStoreV2$/ }, () => ({ path: 'store', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const pluginsRuntimesRoot=()=>${JSON.stringify(path.join(scratch, 'runtimes'))};` }));
  } }],
});
const lib = createRequire(import.meta.url)(outfile);

const bin = path.join(scratch, 'bin');
fs.mkdirSync(bin);
for (const [name, version] of [['python3', '3.15.0'], ['python3.15', '3.15.0'], ['python3.12', '3.12.4'], ['python3.11', '3.11.9']]) {
  // `python3` and `python3.15` are the same interpreter, as a package manager installs them.
  const executable = path.join(bin, name === 'python3' ? 'python3.15' : name);
  // Answer what the `-c` program asks for, as a real interpreter would, in the order it asks.
  fs.writeFileSync(path.join(bin, name), [
    '#!/bin/sh',
    'case "$2" in',
    `  *version_info*executable*) echo ${version}; echo ${executable} ;;`,
    `  *executable*) echo ${executable} ;;`,
    `  *) echo ${version} ;;`,
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
}
const withPath = async fn => {
  const saved = process.env.PATH;
  process.env.PATH = bin;
  try { return await fn(); } finally { process.env.PATH = saved; }
};
const locked = new Set(['3.11', '3.12', '3.13', '3.14']);
const skip = process.platform === 'win32' ? 'stub interpreters are shell scripts' : false;

test('without a predicate the default python3 still wins', { skip }, () => withPath(async () => {
  assert.deepEqual(await lib.findSystemPython('3.10'), { path: path.join(bin, 'python3.15'), version: '3.15.0' });
}));

test('an unlocked default python3 does not hide a locked versioned interpreter', { skip }, () => withPath(async () => {
  const seen = [];
  assert.deepEqual(await lib.findSystemPython('3.10', minor => locked.has(minor), seen), { path: path.join(bin, 'python3.12'), version: '3.12.4' });
  // The same interpreter reached by two names is reported once.
  assert.deepEqual(seen.map(entry => entry.version), ['3.15.0', '3.12.4']);
}));

test('the default python3 is kept when the package supports it', { skip }, () => withPath(async () => {
  assert.equal((await lib.findSystemPython('3.10', minor => minor === '3.15' || minor === '3.12'))?.version, '3.15.0');
}));

test('a versioned interpreter below the minimum is not chosen', { skip }, () => withPath(async () => {
  assert.equal(await lib.findSystemPython('3.13', minor => minor === '3.11' || minor === '3.12'), null);
}));

test('the refusal names what the package supports and what was found', { skip }, () => withPath(async () => {
  const result = await lib.ensurePythonRuntime({ plugin: { id: 'probe' } }, 'probe', {
    download: async () => { throw new Error('nothing may be downloaded'); },
    minVersion: '3.10', selectLock: () => null, supportedVersions: ['3.13', '3.14'], signal: new AbortController().signal,
  });
  assert.equal(result.ready, false);
  assert.match(result.detail, /supports Python 3\.13, 3\.14 on /);
  for (const version of ['3.15.0', '3.12.4', '3.11.9']) assert.ok(result.detail.includes(version), `${version} is listed: ${result.detail}`);
}));
