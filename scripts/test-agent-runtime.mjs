// The Codex and Copilot CLIs are downloaded the first time a provider is used
// (electron/ai/agentRuntime.ts). These drive the real module against a tarball laid
// out like the npm one, served from memory: what it installs, what it refuses, and
// that reading the status never reaches the network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as tar from 'tar';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pruning = require('../build/packagedNodeModules.cjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-agent-runtime-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'agentRuntime.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/agentRuntime.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
  banner: { js: "import { createRequire as __nodusCR } from 'node:module'; const require = __nodusCR(import.meta.url); const __filename = import.meta.filename;" },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  plugins: [{
    name: 'stub-electron',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `export const app = { getPath: () => ${JSON.stringify(scratch)}, isPackaged: true };
          export const net = { fetch: () => { throw new Error('the test must inject fetch'); } };`,
        loader: 'js',
      }));
    },
  }],
});
const runtime = await import(pathToFileURL(bundle).href);

const target = runtime.agentRuntimeTarget('codex');
let fixture = 0;

/** A tarball laid out like npm's: everything under package/, the CLI at its real path. */
async function npmTarball(executable, script) {
  const root = path.join(scratch, `fixture-${fixture += 1}`);
  const file = path.join(root, 'package', executable);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(root, 'package', 'package.json'), '{"name":"fixture"}');
  fs.writeFileSync(file, script, { mode: 0o755 });
  const tgz = path.join(root, 'package.tgz');
  await tar.c({ gzip: true, file: tgz, cwd: root, portable: true }, ['package']);
  const bytes = fs.readFileSync(tgz);
  return { bytes, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
}

function environment({ entries, fetchBytes, locateBundled = () => null }) {
  const root = path.join(scratch, `profile-${fixture += 1}`);
  const manifestPath = path.join(root, 'agent-runtimes.json');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, packages: entries }));
  const calls = [];
  runtime.__setAgentRuntimeEnvironmentForTest({
    root: () => path.join(root, 'agent-runtimes'),
    manifestPath: () => manifestPath,
    locateBundled,
    fetch: async (url) => {
      calls.push(url);
      const bytes = await fetchBytes(url);
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    },
  });
  return { root: path.join(root, 'agent-runtimes'), calls };
}

test('every release platform finds both CLIs in the manifest built from package-lock.json', () => {
  const manifest = pruning.agentRuntimeManifest();
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']]) {
    for (const kind of ['codex', 'copilot']) {
      const { packageName } = runtime.agentRuntimeTarget(kind, platform, arch);
      const entry = manifest.packages[packageName];
      assert.ok(entry, `${packageName} is downloadable`);
      assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
      assert.match(entry.integrity, /^sha512-/);
    }
    assert.deepEqual(
      pruning.onDemandPackagesFor(platform, arch),
      ['codex', 'copilot'].map((kind) => runtime.agentRuntimeTarget(kind, platform, arch).packageName),
      'the packager checks exactly the packages the app will ask for',
    );
  }
  assert.equal(runtime.agentRuntimeTarget('codex', 'freebsd', 'x64'), null);
});

test('a status read never downloads, and the first use installs the verified CLI', async () => {
  const { bytes, integrity } = await npmTarball(target.executable, '#!/bin/sh\necho fake-codex\n');
  const { root, calls } = environment({
    entries: { [target.packageName]: { version: '9.9.9', resolved: 'https://registry.example/codex.tgz', integrity } },
    fetchBytes: () => bytes,
  });

  assert.equal(runtime.resolveAgentRuntime('codex'), null);
  assert.deepEqual(runtime.agentRuntimeStatus('codex'), { state: 'missing', receivedBytes: 0, totalBytes: null });
  assert.equal(calls.length, 0, 'reading the status reached the network');

  const seen = [];
  const off = runtime.onAgentRuntimeChanged((kind) => seen.push({ kind, ...runtime.agentRuntimeStatus(kind) }));
  const [first, second] = await Promise.all([runtime.ensureAgentRuntime('codex'), runtime.ensureAgentRuntime('codex')]);
  off();
  assert.equal(first, second);
  assert.equal(calls.length, 1, 'two callers share one download');
  assert.ok(seen.some((event) => event.state === 'installing'), 'progress is reported while it downloads');
  assert.deepEqual(seen.at(-1), { kind: 'codex', state: 'ready', receivedBytes: 0, totalBytes: null });

  assert.ok(first.startsWith(root), `${first} lives beside the profile`);
  assert.ok(fs.existsSync(first));
  if (process.platform !== 'win32') {
    assert.equal(execFileSync(first, { encoding: 'utf8' }).trim(), 'fake-codex', 'the installed CLI runs');
  }
  assert.equal(runtime.resolveAgentRuntime('codex'), first);
  assert.equal(await runtime.ensureAgentRuntime('codex'), first);
  assert.equal(calls.length, 1, 'an installed CLI is not downloaded again');
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.startsWith('.')),
    [],
    'no download or staging directory is left behind',
  );
});

test('bytes that do not match the pinned integrity are refused and nothing is installed', async () => {
  const { bytes } = await npmTarball(target.executable, '#!/bin/sh\necho tampered\n');
  const honest = await npmTarball(target.executable, '#!/bin/sh\necho fake-codex\n');
  const { root } = environment({
    entries: { [target.packageName]: { version: '9.9.9', resolved: 'https://registry.example/codex.tgz', integrity: honest.integrity } },
    fetchBytes: () => bytes,
  });
  await assert.rejects(runtime.ensureAgentRuntime('codex'), /no coincide con su huella publicada/);
  assert.equal(runtime.agentRuntimeStatus('codex').state, 'failed');
  assert.equal(runtime.resolveAgentRuntime('codex'), null);
  assert.deepEqual(fs.readdirSync(root), [], 'the rejected bytes were removed');
});

test('a network failure is reported as such, and a later attempt can succeed', async () => {
  const { bytes, integrity } = await npmTarball(target.executable, '#!/bin/sh\necho fake-codex\n');
  let online = false;
  environment({
    entries: { [target.packageName]: { version: '9.9.9', resolved: 'https://registry.example/codex.tgz', integrity } },
    fetchBytes: () => {
      if (!online) throw new TypeError('fetch failed');
      return bytes;
    },
  });
  await assert.rejects(runtime.ensureAgentRuntime('codex'), /No se pudo descargar el motor oficial/);
  assert.equal(runtime.agentRuntimeStatus('codex').state, 'failed');
  online = true;
  assert.ok(fs.existsSync(await runtime.ensureAgentRuntime('codex')));
  assert.equal(runtime.agentRuntimeStatus('codex').state, 'ready');
});

test('a CLI already in node_modules is used as it is, with no manifest and no download', async () => {
  const bundled = path.join(scratch, 'bundled-codex');
  fs.writeFileSync(bundled, '');
  const { calls } = environment({
    entries: {},
    fetchBytes: () => { throw new Error('must not download'); },
    locateBundled: (kind) => (kind === 'codex' ? bundled : null),
  });
  assert.equal(await runtime.ensureAgentRuntime('codex'), bundled);
  assert.equal(runtime.agentRuntimeStatus('codex').state, 'ready');
  assert.equal(calls.length, 0);
  await assert.rejects(runtime.ensureAgentRuntime('copilot'), /no indica de dónde descargar/);
});

test('installing a new version clears this CLI\'s old ones and leaves the other CLI\'s download alone', async () => {
  const { bytes, integrity } = await npmTarball(target.executable, '#!/bin/sh\necho fake-codex\n');
  const { root } = environment({
    entries: { [target.packageName]: { version: '2.0.0', resolved: 'https://registry.example/codex.tgz', integrity } },
    fetchBytes: () => bytes,
  });
  const own = target.packageName.replace('/', '+');
  const other = runtime.agentRuntimeTarget('copilot').packageName.replace('/', '+');
  for (const name of [`${own}@1.0.0`, `.partial-${own}-interrupted`, `.download-${other}-in-flight.tgz`, `${other}@1.0.0`]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  await runtime.ensureAgentRuntime('codex');
  assert.deepEqual(
    fs.readdirSync(root).sort(),
    [`.download-${other}-in-flight.tgz`, `${other}@1.0.0`, `${own}@2.0.0`].sort(),
  );
});

test('a package without the expected executable is refused', async () => {
  const { bytes, integrity } = await npmTarball('somewhere/else', '#!/bin/sh\n');
  const { root } = environment({
    entries: { [target.packageName]: { version: '9.9.9', resolved: 'https://registry.example/codex.tgz', integrity } },
    fetchBytes: () => bytes,
  });
  await assert.rejects(runtime.ensureAgentRuntime('codex'), /no contiene el ejecutable esperado/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('only a profile that already chose these providers downloads ahead of use', async () => {
  assert.deepEqual(runtime.agentRuntimesInUse({ favorites: [], defaultModel: { provider: 'openai', model: 'gpt' } }), []);
  assert.deepEqual(
    runtime.agentRuntimesInUse({ favorites: [{ provider: 'github-copilot', model: 'x' }], jobs: { scan: { model: { provider: 'codex', model: 'y' } } } }).sort(),
    ['codex', 'copilot'],
  );

  const { bytes, integrity } = await npmTarball(target.executable, '#!/bin/sh\necho fake-codex\n');
  const { calls } = environment({
    entries: { [target.packageName]: { version: '9.9.9', resolved: 'https://registry.example/codex.tgz', integrity } },
    fetchBytes: () => bytes,
  });
  runtime.prefetchAgentRuntimesInUse({ favorites: [{ provider: 'anthropic', model: 'z' }] });
  assert.equal(calls.length, 0, 'a profile that never used Codex downloads nothing');
  runtime.prefetchAgentRuntimesInUse({ defaultModel: { provider: 'codex', model: 'gpt-5' } });
  await runtime.ensureAgentRuntime('codex');
  assert.equal(calls.length, 1, 'a Codex profile gets its CLI in the background, once');
});
