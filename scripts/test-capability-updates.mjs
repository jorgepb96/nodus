// Updating an installed capability package, and what an uninstall keeps.
//
// An update is an install with a memory, so the interesting cases are the ones where the
// new version is not simply better: it wants more than the old one was allowed, it is
// older than what is here, or it carries the same version number over different bytes.
// None of those may be applied quietly, and the release is fetched from a fake source so
// the whole path — catalog, manifest, signature, archive — is the real one.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign as signBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-updates-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const signing = generateKeyPairSync('ed25519');
const trustedKeys = { keys: [{ keyId: 'nr01', publicKeyPem: signing.publicKey.export({ type: 'spki', format: 'pem' }).toString() }] };
const target = `${process.platform}-${process.arch}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const bundle = path.join(scratch, 'updates.cjs');
await build({
  stdin: {
    contents: `
      export * from './electron/capabilities/pluginStoreV2';
      export * from './electron/capabilities/registry';
      export * from './electron/capabilities/marketplaceV2';
      export * from './electron/capabilities/updates';
      export * from './electron/capabilities/skillLibrary';
      export { listChatSkills, saveChatSkill, replaceChatSkills, restorePluginSkillAuthorVersion } from './electron/chatSkills';
    `,
    resolveDir: root, loader: 'ts',
  },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onResolve({ filter: /migrationRunner$/ }, () => ({ path: 'migrations', namespace: 'mock' }));
      api.onResolve({ filter: /workerHost$/ }, () => ({ path: 'workers', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
        contents: name === 'electron'
          ? `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=>"5.4.0"};export const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString("utf8")};`
          : name === 'migrations'
            // The ladder itself is verified against real Electron elsewhere; here what
            // matters is that an update runs it before the new version is announced.
            ? `export const runPluginDataMigrations = async (id) => { globalThis.__migrated.push(id); globalThis.__recordDataVersion(id); };`
            : `export const stopCapabilityWorkers = async (match) => { globalThis.__stopped.push(String(match)); };
               export const stopPluginWorkers = async (pluginId) => { globalThis.__stopped.push(pluginId); };`,
        loader: 'js',
      }));
      api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'trusted-keys', namespace: 'keys' }));
      api.onLoad({ filter: /.*/, namespace: 'keys' }, () => ({ contents: JSON.stringify(trustedKeys), loader: 'json' }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const lib = createRequire(import.meta.url)(bundle);
globalThis.__migrated = [];
globalThis.__stopped = [];
globalThis.__recordDataVersion = id => lib.recordPluginDataVersion(id, 1);

// ---------------------------------------------------------------- a package, twice

const capability = (version, extraPermissions = {}) => ({
  schemaVersion: 2, id: 'legal', provides: 'nodus:legal', version,
  description: 'Find legislation in country repositories.',
  runtime: { kind: 'nodus-trusted-worker-v1', protocol: 1, entry: 'worker.js' },
  requires: [],
  tools: [{
    id: 'retrieve', description: 'Retrieve one law.',
    inputSchema: { type: 'object', properties: { country: { type: 'string' } }, required: ['country'], additionalProperties: false },
    artifactTypes: [], timeoutMs: 60_000, concurrency: 1, maxPerReply: 1, answerMode: 'replace-block', metered: true,
  }],
  artifacts: [],
  permissions: {
    network: [{ id: 'repos', origin: 'https://codeload.github.com', pathPrefixes: ['/legalize-dev/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 }],
    ...extraPermissions,
  },
});

const manifest = (version, migrations = ['migrations/001-adopt.cjs']) => ({
  schemaVersion: 2, id: 'legalize', name: 'Legalize', version,
  author: 'NodusResearch', description: 'Find legislation in country repositories.', license: 'AGPL-3.0-only',
  publisher: { id: 'NodusResearch', keyId: 'nr01' },
  compatibility: { capabilityApi: 2, minNodusVersion: '5.4.0', targets: [target] },
  replacesSkills: ['builtin-legal'],
  skills: ['skills/legalize/skill.json'],
  capabilities: ['capabilities/legal/capability.json'],
  migrations,
});

function archiveFor(version, { permissions = {}, filler = '' } = {}) {
  const zip = new AdmZip();
  const files = {
    'plugin.json': JSON.stringify(manifest(version), null, 2),
    'capabilities/legal/capability.json': JSON.stringify(capability(version, permissions), null, 2),
    'capabilities/legal/worker.js': `module.exports = () => ({});${filler}`,
    'migrations/001-adopt.cjs': 'module.exports = async () => ({});',
    'skills/legalize/skill.json': JSON.stringify({ schemaVersion: 1, id: 'legalize', name: 'Legalize', version, author: 'NodusResearch', description: 'Find legislation.', category: 'Research', license: 'AGPL-3.0-only', instructions: 'SKILL.md', capabilities: ['nodus:legal'], tools: [] }, null, 2),
    'skills/legalize/SKILL.md': 'Ask for a country.',
  };
  for (const [name, contents] of Object.entries(files)) zip.addFile(name, Buffer.from(contents));
  return zip.toBuffer();
}

function releaseFor(version, archive) {
  const release = {
    schemaVersion: 1, plugin: 'legalize', version,
    publisher: { id: 'NodusResearch', keyId: 'nr01' },
    createdAt: '2026-09-11T10:00:00.000Z',
    targets: [{ target, asset: `legalize-${version}-${target}.nodus-plugin`, bytes: archive.byteLength, sha256: sha256(archive) }],
  };
  const bytes = Buffer.from(JSON.stringify(release, null, 2));
  return { manifestBytes: bytes, signature: signBytes(null, bytes, signing.privateKey) };
}

/** A fake source: the catalog, the signed manifest and the asset, served over the same
 *  code path a real GitHub release goes through. */
function sourceServing(version, options = {}) {
  const archive = options.archive ?? archiveFor(version, options);
  const { manifestBytes, signature } = options.release ?? releaseFor(options.releaseVersion ?? version, archive);
  const catalog = {
    schemaVersion: 2, updatedAt: '2026-09-11T10:00:00.000Z',
    plugins: [{
      id: 'legalize', name: 'Legalize', description: { en: 'Find legislation.' }, version,
      path: 'plugins/legalize', replaces: ['builtin-legal'], targets: [target],
      release: {
        tag: `legalize-v${version}`, manifest: 'release-manifest.json', signature: 'release-manifest.sig',
        assets: [{ target, asset: `legalize-${version}-${target}.nodus-plugin`, bytes: Math.max(archive.byteLength, 1) }],
      },
    }],
  };
  const body = value => ({
    ok: true, status: 200, headers: new Map([['content-length', String(value.byteLength ?? value.length)]]),
    body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(Buffer.from(value)) })), cancel: async () => {} }; } },
  });
  const calls = [];
  const fetcher = async url => {
    calls.push(String(url));
    const text = String(url);
    if (text.includes('api.github.com/repos/NodusResearch/nodus-research-skill-marketplace/commits')) return body(JSON.stringify({ sha: 'b'.repeat(40) }));
    if (text.includes('api.github.com/repos/')) return body(JSON.stringify({ default_branch: 'main' }));
    if (text.endsWith('catalog-v2.json')) return body(JSON.stringify(catalog));
    if (text.endsWith('release-manifest.json')) return body(manifestBytes);
    if (text.endsWith('release-manifest.sig')) return body(signature);
    if (text.endsWith('.nodus-plugin')) return body(archive);
    throw new Error(`unexpected request: ${text}`);
  };
  fetcher.calls = calls;
  return fetcher;
}

const reset = () => {
  fs.rmSync(path.join(profile, 'plugins'), { recursive: true, force: true });
  fs.rmSync(path.join(profile, 'capability-catalog.json'), { force: true });
  lib.initializeCapabilityPluginStore();
  lib.replaceChatSkills([]);
  globalThis.__migrated = [];
  globalThis.__stopped = [];
};

async function install(version, options = {}) {
  const fetcher = sourceServing(version, options);
  await lib.fetchCapabilityCatalog('https://github.com/NodusResearch/nodus-research-skill-marketplace', fetcher);
  const outcome = await lib.installCatalogPlugin('legalize', { approvePermissions: true, fetcher });
  lib.recordPluginDataVersion('legalize', 1);
  lib.rebuildCapabilityRegistry();
  return outcome;
}

// ---------------------------------------------------------------- the ordinary case

test('an update is fetched, verified, migrated and announced', async () => {
  reset();
  await install('2.0.0');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.0.0');

  const results = await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.1.0') });
  assert.deepEqual(results, [{ pluginId: 'legalize', state: 'updated', from: '2.0.0', to: '2.1.0' }]);

  const state = lib.readPluginStateV2('legalize');
  assert.equal(state.active.version, '2.1.0');
  assert.equal(state.previous.version, '2.0.0', 'the version it came from is kept, so going back is one click');
  assert.equal(state.rollbackAvailable, true);
  // By plugin id: a predicate over worker keys that never matched satisfied a check for "anything".
  assert.deepEqual(globalThis.__stopped, ['legalize'], 'the process running the old bytes is stopped before the new ones are used');
  assert.ok(globalThis.__migrated.includes('legalize'), 'the new version climbs its ladder before it is announced');
  assert.equal(lib.capabilityIsAvailable('nodus:legal'), true);
  assert.equal(lib.listChatSkills().find(skill => skill.plugin?.id === 'legalize').version, '2.1.0', 'updating also installs the bundled workflow');
});

test('a package already at the catalog version is left alone', async () => {
  reset();
  await install('2.0.0');
  const results = await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.0.0') });
  assert.deepEqual(results, [{ pluginId: 'legalize', state: 'current', from: '2.0.0' }]);
});

test('automatic updates off means nothing is installed without being asked', async () => {
  reset();
  await install('2.0.0');
  lib.setCapabilityAutoUpdate('legalize', false);
  assert.equal(lib.readPluginStateV2('legalize').autoUpdate, false);

  const skipped = await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.1.0') });
  assert.equal(skipped[0].state, 'skipped');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.0.0');

  // Asking for that one package explicitly is a decision, and it is honoured.
  const asked = await lib.checkForCapabilityUpdates({ only: 'legalize', fetcher: sourceServing('2.1.0') });
  assert.equal(asked[0].state, 'updated');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.1.0');
});

// ---------------------------------------------------------------- what must not happen quietly

test('an update that wants more than was approved waits for a person', async () => {
  reset();
  await install('2.0.0');
  const fetcher = sourceServing('2.1.0', { permissions: { secrets: [{ id: 'token', label: 'API token', required: true, injection: { kind: 'header', endpointId: 'repos', header: 'Authorization', prefix: 'Bearer ' } }] } });
  const results = await lib.checkForCapabilityUpdates({ fetcher });

  assert.equal(results[0].state, 'awaiting-approval');
  const state = lib.readPluginStateV2('legalize');
  assert.equal(state.active.version, '2.0.0', 'the version in use is untouched');
  assert.equal(state.pending.version, '2.1.0');
  assert.equal(state.pending.reason, 'permissions');
  assert.equal(state.status, 'pending-permissions');

  // Asked again, it does not ask the source again: the answer is with the user.
  const again = await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.1.0') });
  assert.equal(again[0].state, 'awaiting-approval');

  // Approving is what applies it, and the new version still migrates before it registers.
  globalThis.__migrated = [];
  lib.approvePendingPluginV2('legalize');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.1.0');
});

test('a catalog offering an older version cannot walk a package backwards', async () => {
  reset();
  await install('2.1.0');
  const results = await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.0.0') });
  assert.equal(results[0].state, 'current', 'an older catalog entry is not an update');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.1.0');
});

test('a version number republished over different bytes is refused', async () => {
  reset();
  await install('2.0.0');
  const first = lib.readPluginStateV2('legalize').active.digest;

  // Same version, different archive, correctly signed: the signature is valid and the
  // package is still a lie, because 2.0.0 already means something on this machine.
  const republished = archiveFor('2.0.0', { filler: '\n// rebuilt with something extra' });
  assert.notEqual(sha256(republished), first);
  const fetcher = sourceServing('2.0.0', { archive: republished });
  await lib.fetchCapabilityCatalog('https://github.com/NodusResearch/nodus-research-skill-marketplace', fetcher);
  await assert.rejects(
    lib.installCatalogPlugin('legalize', { approvePermissions: true, fetcher }),
    /published with different content/i,
  );
  assert.equal(lib.readPluginStateV2('legalize').active.digest, first);
});

test('an unreachable source is not a failed update', async () => {
  reset();
  await install('2.0.0');
  const offline = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const results = await lib.checkForCapabilityUpdates({ fetcher: offline });

  assert.equal(results[0].state, 'current', 'the cached catalog still describes what is installed');
  assert.equal(lib.readPluginStateV2('legalize').active.version, '2.0.0');
  assert.equal(lib.capabilityIsAvailable('nodus:legal'), true, 'and the package keeps working');
});

// ---------------------------------------------------------------- uninstall, reinstall, purge

test('uninstalling keeps the work, removes the credentials, and a reinstall finds its place', async () => {
  reset();
  await install('2.0.0');

  const data = path.join(profile, 'plugins', 'data', 'legalize');
  const cache = path.join(profile, 'plugins', 'cache', 'legalize');
  const runtimes = path.join(profile, 'plugins', 'runtimes', 'legalize');
  const secret = path.join(profile, 'plugins', 'secrets', 'legalize.bin');
  for (const directory of [data, cache, runtimes]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(data, 'notes.json'), '{"kept":true}');
  fs.writeFileSync(path.join(cache, 'index-es.json'), '{"rebuildable":true}');
  fs.writeFileSync(path.join(runtimes, 'READY'), '');
  fs.writeFileSync(secret, 'a credential');

  lib.setCapabilityAutoUpdate('legalize', false);
  lib.removePluginV2('legalize');

  assert.equal(fs.existsSync(path.join(data, 'notes.json')), true, 'what the user accumulated is kept');
  assert.equal(fs.existsSync(cache), false, 'a rebuildable cache is not');
  assert.equal(fs.existsSync(runtimes), false, 'nor is a runtime that can be rebuilt from a lock');
  assert.equal(fs.existsSync(secret), false, 'and a credential is never left behind');
  assert.equal(lib.readPluginStateV2('legalize'), null);
  assert.equal(lib.rebuildCapabilityRegistry().providers.has('nodus:legal'), false);

  const tombstone = lib.pluginTombstone('legalize');
  assert.equal(tombstone.autoUpdate, false, 'the choice the user made about updates is remembered');
  assert.equal(tombstone.dataVersion, 1);

  // Reinstalling finds the data still there, so nothing has to be rebuilt or re-entered.
  await install('2.0.0');
  assert.equal(fs.existsSync(path.join(data, 'notes.json')), true);
  assert.equal(lib.capabilityIsAvailable('nodus:legal'), true);
});

test('an explicit purge is the only thing that takes the data', async () => {
  reset();
  await install('2.0.0');
  const data = path.join(profile, 'plugins', 'data', 'legalize');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'notes.json'), '{"kept":true}');

  lib.removePluginV2('legalize', { purgeData: true });
  assert.equal(fs.existsSync(data), false);
});


test('bundled workflows wait for migrations, then survive updates and rollback with local edits', async () => {
  reset();
  const fetcher = sourceServing('2.0.0');
  await lib.fetchCapabilityCatalog('https://github.com/NodusResearch/nodus-research-skill-marketplace', fetcher);
  await lib.installCatalogPlugin('legalize', { approvePermissions: true, fetcher });
  assert.deepEqual(lib.materializeTrustedPluginSkills('legalize'), [], 'pending migration cannot expose the workflow');
  lib.recordPluginDataVersion('legalize', 1);
  const [skill] = lib.materializeTrustedPluginSkills('legalize');
  lib.saveChatSkill({ ...skill, instructions: 'My edited workflow.', enabled: { assistant: true, nodi: false } });
  await lib.checkForCapabilityUpdates({ fetcher: sourceServing('2.1.0') });
  lib.rollbackPluginV2('legalize');
  const [rolledBack] = lib.materializeTrustedPluginSkills('legalize');
  assert.equal(rolledBack.id, skill.id);
  assert.equal(rolledBack.version, '2.0.0');
  assert.equal(rolledBack.instructions, 'My edited workflow.');
  // A skill is on for every chat at once: saving it on for one chat turns both switches on.
  assert.deepEqual(rolledBack.enabled, { assistant: true, nodi: true });
  const [restored] = lib.restorePluginSkillAuthorVersion(skill.id);
  assert.equal(restored.instructions, 'Ask for a country.');
  assert.equal(restored.id, skill.id);
  assert.deepEqual(restored.enabled, rolledBack.enabled);
  assert.equal(restored.overrides, undefined);
});
