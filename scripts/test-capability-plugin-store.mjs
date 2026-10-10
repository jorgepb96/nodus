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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-store-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

// One ephemeral publishing key for the whole run, injected in place of the committed
// production list so tests never need the matching production private key.
const signing = generateKeyPairSync('ed25519');
const retired = generateKeyPairSync('ed25519');
const impostor = generateKeyPairSync('ed25519');
const pem = key => key.export({ type: 'spki', format: 'pem' }).toString();
const trustedKeys = {
  keys: [
    { keyId: 'nr01', publicKeyPem: pem(signing.publicKey) },
    { keyId: 'nr00', publicKeyPem: pem(retired.publicKey), retiredAt: '2026-01-01T00:00:00.000Z' },
  ],
};

const bundle = path.join(scratch, 'store.cjs');
await build({
  stdin: {
    contents: `
      export * from './electron/capabilities/pluginStoreV2';
      export * from './electron/capabilities/registry';
      export * from './electron/capabilities/packageArchive';
      export * from './electron/capabilities/trustedKeys';
    `,
    resolveDir: root, loader: 'ts',
  },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=>"5.4.0"};export const safeStorage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString("utf8")};`,
        loader: 'js',
      }));
      // Tests supply their own publishing key and never use the production key.
      api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'trusted-keys', namespace: 'keys' }));
      api.onLoad({ filter: /.*/, namespace: 'keys' }, () => ({ contents: JSON.stringify(trustedKeys), loader: 'json' }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const lib = createRequire(import.meta.url)(bundle);

// ---------------------------------------------------------------- package fixtures

const target = `${process.platform}-${process.arch}`;

const capabilityManifest = (overrides = {}) => ({
  schemaVersion: 2, id: 'chemistry', provides: 'nodus:chemistry', version: '2.0.0',
  description: 'Verified chemistry identity, drawing and export.',
  runtime: { kind: 'nodus-trusted-worker-v1', protocol: 1, entry: 'worker.js' },
  requires: [{ id: 'nodus:svg', minVersion: '1.0.0', maxVersionExclusive: '2.0.0' }],
  tools: [{
    id: 'compile', description: 'Compile one chemistry plan.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'], additionalProperties: false },
    artifactTypes: ['chemistry-document'], timeoutMs: 60_000, concurrency: 1, maxPerReply: 1,
    answerMode: 'replace-block', metered: true,
  }],
  chat: {
    priority: 300,
    requestProtocols: [{ fence: 'chemistry-plan', toolId: 'compile', maxPerReply: 1, answerMode: 'replace-block' }],
    legacyResults: [{ fence: 'chemistry-document', artifactType: 'chemistry-document', artifactVersion: 1 }],
    hooks: { prepare: true, finalize: true },
    pendingLabel: { en: 'Drawing…' },
  },
  artifacts: [{ type: 'chemistry-document', version: 1, label: { en: 'Chemistry document' }, modelVisibility: 'projection' }],
  permissions: {
    network: [{ id: 'opsin', origin: 'https://opsin.ch.cam.ac.uk', pathPrefixes: ['/opsin/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 }],
    svg: true,
  },
  ...overrides,
});

const pluginManifest = (overrides = {}) => ({
  schemaVersion: 2, id: 'chemistry-studio', name: 'Chemistry Studio', version: '2.0.0',
  author: 'NodusResearch', description: 'Draw and verify chemical structures.', license: 'AGPL-3.0-only',
  publisher: { id: 'NodusResearch', keyId: 'nr01' },
  compatibility: { capabilityApi: 2, minNodusVersion: '5.4.0', targets: [target] },
  replacesSkills: ['builtin-chemistry'],
  skills: ['skills/chemistry-studio/skill.json'],
  capabilities: ['capabilities/chemistry/capability.json'],
  migrations: [],
  ...overrides,
});

/** adm-zip strips traversal when it writes, so a hostile entry name is patched into the
 *  finished bytes: placeholder and real name are the same length, and each appears twice
 *  (local header and central directory), leaving every other offset intact. */
function archiveWithRawNames(entries) {
  const zip = new AdmZip();
  for (const [placeholder, , contents] of entries) zip.addFile(placeholder, Buffer.from(contents));
  const buffer = zip.toBuffer();
  for (const [placeholder, real] of entries) {
    assert.equal(placeholder.length, real.length, 'placeholder and hostile name must be the same length');
    let index = buffer.indexOf(placeholder);
    assert.notEqual(index, -1, `adm-zip did not store the placeholder ${placeholder}`);
    while (index !== -1) { buffer.write(real, index, 'latin1'); index = buffer.indexOf(placeholder); }
  }
  return buffer;
}

/** adm-zip always writes a regular-file mode, so a symlink entry has to be written into
 *  the central directory by hand: external attributes live at offset 38 of each central
 *  directory file header (signature PK\x01\x02), with the Unix mode in the high 16 bits. */
function archiveWithUnixMode(name, contents, mode) {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(contents));
  const buffer = zip.toBuffer();
  const index = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(index, -1, 'the archive has no central directory');
  buffer.writeUInt32LE((mode << 16) >>> 0, index + 38);
  return buffer;
}

function archiveFor(files) {
  const zip = new AdmZip();
  for (const [name, contents] of Object.entries(files)) zip.addFile(name, Buffer.from(contents));
  return zip.toBuffer();
}

const defaultFiles = (plugin = pluginManifest(), capability = capabilityManifest()) => ({
  'plugin.json': JSON.stringify(plugin, null, 2),
  'capabilities/chemistry/capability.json': JSON.stringify(capability, null, 2),
  'capabilities/chemistry/worker.js': 'module.exports = () => ({});',
  'skills/chemistry-studio/skill.json': JSON.stringify({ schemaVersion: 1, id: 'chemistry-studio', name: 'Chemistry Studio', version: '2.0.0', author: 'NodusResearch', description: 'Draw and verify chemical structures.', category: 'Research', license: 'AGPL-3.0-only', instructions: 'SKILL.md', capabilities: ['nodus:chemistry'], tools: [] }, null, 2),
  'skills/chemistry-studio/SKILL.md': 'Use Chemistry Studio to draw verified structures.',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function releaseFor(archive, overrides = {}, key = signing.privateKey) {
  const release = {
    schemaVersion: 1, plugin: 'chemistry-studio', version: '2.0.0',
    publisher: { id: 'NodusResearch', keyId: 'nr01' },
    createdAt: '2026-09-11T10:00:00.000Z',
    targets: [{ target, asset: `chemistry-studio-2.0.0-${target}.nodus-plugin`, bytes: archive.byteLength, sha256: sha256(archive) }],
    ...overrides,
  };
  const releaseManifestBytes = Buffer.from(JSON.stringify(release, null, 2));
  return { releaseManifestBytes, signature: signBytes(null, releaseManifestBytes, key) };
}

const source = { id: 'nodusresearch/nodus-research-skill-marketplace', path: 'plugins/chemistry-studio', commit: 'a'.repeat(40) };
const download = (files = defaultFiles(), releaseOverrides = {}, key = signing.privateKey) => {
  const archive = archiveFor(files);
  return { archive, ...releaseFor(archive, releaseOverrides, key), source };
};

const reset = () => {
  fs.rmSync(path.join(profile, 'plugins'), { recursive: true, force: true });
  lib.initializeCapabilityPluginStore();
};

const rejects = (fn, hint) => assert.throws(fn, error => {
  assert.ok(error instanceof Error);
  if (hint) assert.match(error.message, hint);
  return true;
});

// ---------------------------------------------------------------- signature

test('a signed package installs, registers its capability and pins its own digest', () => {
  reset();
  const outcome = lib.installVerifiedPlugin(download(), { approvePermissions: true });
  assert.equal(outcome.activated, true);
  assert.equal(outcome.state.status, 'ready');
  assert.equal(outcome.state.trust.keyId, 'nr01');
  assert.equal(outcome.state.active.version, '2.0.0');
  assert.equal(outcome.state.rollbackAvailable, false);

  const registry = lib.rebuildCapabilityRegistry();
  assert.deepEqual([...registry.providers.keys()].sort(), ['nodus:3d', 'nodus:chemistry', 'nodus:image', 'nodus:maps', 'nodus:svg', 'nodus:vision']);
  assert.equal(registry.providers.get('nodus:chemistry').plugin.id, 'chemistry-studio');
  assert.equal(registry.fences.get('chemistry-plan').kind, 'request');
  assert.equal(registry.fences.get('chemistry-document').kind, 'legacy');
  assert.deepEqual(registry.problems, []);
  assert.equal(lib.capabilityIsAvailable('nodus:chemistry'), true);
  assert.equal(lib.capabilityIsAvailable('nodus:legal'), false);

  // The worker host gets an entry path inside the installed version, not the staging tree.
  const runtime = lib.resolveTrustedCapability('nodus:chemistry');
  assert.ok(runtime.entryPath.includes(path.join('installed', 'chemistry-studio', 'versions')));
  assert.equal(runtime.plugin.digest, outcome.state.active.digest);

  const pins = lib.pinCapabilitiesForTurn();
  assert.deepEqual(pins.pins.get('nodus:chemistry'), { version: '2.0.0', digest: outcome.state.active.digest });
});

test('a slot that holds newer content reports BOTH the content version and the slot label', () => {
  reset();
  const outcome = lib.installVerifiedPlugin(download(), { approvePermissions: true });
  assert.equal(outcome.state.active.version, '2.0.0', 'the slot was created for 2.0.0');
  const digest = outcome.state.active.digest;
  const slot = path.join(profile, 'plugins', 'installed', 'chemistry-studio', 'versions', `2.0.0-${digest}`);

  // A sideload replaces what a slot HOLDS without renaming the slot, so the directory keeps the
  // version it was created with while the manifests inside it move on. Reproduce exactly that.
  // Both manifests are rewritten because the reader requires them to agree.
  for (const relative of [['plugin.json'], ['capabilities', 'chemistry', 'capability.json']]) {
    const file = path.join(slot, ...relative);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.version = '2.0.9';
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  }

  const provider = lib.rebuildCapabilityRegistry().providers.get('nodus:chemistry');
  assert.ok(provider, 'the capability is still registered');

  // The CONTENT's version, which is what an artifact is stamped with so an archive of runs can
  // say which build produced it.
  assert.equal(provider.version, '2.0.9', 'the provider reports the version of the content');

  // The SLOT's label, which is what IDENTIFIES the installation. This one must not follow the
  // content: it is the turn pin, and resolveTrustedCapability both matches it against
  // state.active and builds `<version>-<digest>` from it.
  assert.equal(provider.plugin.version, '2.0.0', 'the plugin identity stays the slot label');
  assert.equal(provider.plugin.digest, digest);

  // THE REGRESSION GUARD. Stamping provider.plugin with the content version type-checked, passed
  // a stamp-only assertion, and still broke every capability call: the pin stopped matching
  // state.active and the slot path stopped existing, so the plugin reported itself "no longer
  // installed". Only a round trip through the pin catches that.
  const pin = lib.pinCapabilitiesForTurn().pins.get('nodus:chemistry');
  assert.deepEqual(pin, { version: '2.0.0', digest }, 'the pin carries the slot label');
  const runtime = lib.resolveTrustedCapability('nodus:chemistry', pin);
  assert.ok(runtime, 'the pinned capability still resolves');
  assert.ok(runtime.entryPath.includes(`2.0.0-${digest}`), 'through the slot directory that exists');
  assert.equal(runtime.manifest.version, '2.0.9', 'and the manifest it loads is the newer content');
});

test('nothing installs without a signature that verifies against a trusted key', () => {
  reset();
  const good = download();
  rejects(() => lib.installVerifiedPlugin({ ...good, signature: Buffer.alloc(64) }, { approvePermissions: true }), /does not verify/);
  rejects(() => lib.installVerifiedPlugin({ ...download(defaultFiles(), {}, impostor.privateKey) }, { approvePermissions: true }), /does not verify/);
  rejects(() => lib.installVerifiedPlugin({ ...good, releaseManifestBytes: Buffer.concat([good.releaseManifestBytes, Buffer.from(' ')]) }, { approvePermissions: true }), /does not verify/);
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(), { publisher: { id: 'NodusResearch', keyId: 'nr99' } }), { approvePermissions: true }), /unknown key/);
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(), { publisher: { id: 'NodusResearch', keyId: 'nr00' } }, retired.privateKey), { approvePermissions: true }), /retired key/);
  assert.equal(lib.readPluginStateV2('chemistry-studio'), null, 'a refused package leaves nothing behind');
});

test('the archive must be the bytes the manifest pinned, and agree with the package inside', () => {
  reset();
  const good = download();
  rejects(() => lib.installVerifiedPlugin({ ...good, archive: Buffer.concat([good.archive, Buffer.from('extra')]) }, { approvePermissions: true }), /size does not match/);

  // Same length, different bytes: the size check passes and the digest is what catches it.
  const substituted = Buffer.from(good.archive);
  substituted[Math.floor(substituted.byteLength / 2)] ^= 0xff;
  assert.equal(substituted.byteLength, good.archive.byteLength);
  rejects(() => lib.installVerifiedPlugin({ ...good, archive: substituted }, { approvePermissions: true }), /digest does not match/);

  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest({ version: '9.9.9' }))), { approvePermissions: true }), /version does not match/);
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest({ publisher: { id: 'NodusResearch', keyId: 'nr00' } }))), { approvePermissions: true }), /publisher does not match/);
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest({ id: 'something-else' }))), { approvePermissions: true }), /identifier does not match/);
});

test('a package published for another platform is not installed here', () => {
  reset();
  const foreign = target.startsWith('win32') ? 'linux-x64' : 'win32-x64';
  rejects(
    () => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest({ compatibility: { capabilityApi: 2, minNodusVersion: '5.4.0', targets: [foreign] } })), { targets: [{ target: foreign, asset: `chemistry-studio-2.0.0-${foreign}.nodus-plugin`, bytes: 1, sha256: 'a'.repeat(64) }] }), { approvePermissions: true }),
    /does not publish a package for/,
  );
});

// ---------------------------------------------------------------- archive safety

test('the archive format cannot write outside its own root or smuggle a non-regular file', () => {
  const destination = path.join(scratch, 'extract');
  fs.rmSync(destination, { recursive: true, force: true });

  rejects(() => lib.extractPluginArchive(archiveWithRawNames([['@@@escaped.txt', '../escaped.txt', 'no']]), destination), /Unsafe plugin archive entry/);
  rejects(() => lib.extractPluginArchive(archiveWithRawNames([['@absolute.txt', '/absolute.txt', 'no']]), destination), /Unsafe plugin archive entry/);
  rejects(() => lib.extractPluginArchive(archiveWithRawNames([['a@@@@@@@escaped.txt', 'a/../../escaped.txt', 'no']]), destination), /Unsafe plugin archive entry/);
  rejects(() => lib.safeEntryPath(destination, 'C:\\windows\\system32'), /Unsafe plugin archive entry/);

  rejects(() => lib.extractPluginArchive(archiveWithUnixMode('link', '/etc/passwd', 0o120777), destination), /non-regular entry/);
  rejects(() => lib.extractPluginArchive(archiveWithUnixMode('device', '', 0o020666), destination), /non-regular entry/);
  rejects(() => lib.extractPluginArchive(archiveWithUnixMode('socket', '', 0o140777), destination), /non-regular entry/);

  assert.equal(fs.existsSync(path.join(scratch, 'escaped.txt')), false);
  assert.equal(fs.existsSync(path.join(destination, 'link')), false);
});

test('the archive format bounds entry count and expanded size', () => {
  const destination = path.join(scratch, 'extract-limits');
  fs.rmSync(destination, { recursive: true, force: true });

  // A zip bomb is cheap to build and must be refused from the central directory alone,
  // before a single entry is written to disk.
  const bomb = new AdmZip();
  for (let i = 0; i < 60; i++) bomb.addFile(`pad-${i}.bin`, Buffer.alloc(10 * 1024 * 1024, 0));
  rejects(() => lib.extractPluginArchive(bomb.toBuffer(), destination), /expands to more than/);
  assert.equal(fs.existsSync(destination), false, 'nothing is written before the whole archive is judged');

  const report = lib.extractPluginArchive(archiveFor({ 'a.txt': 'ok', 'b/c.txt': 'ok' }), destination);
  assert.equal(report.entries, 2);
  assert.equal(fs.readFileSync(path.join(destination, 'b', 'c.txt'), 'utf8'), 'ok');
});

// ---------------------------------------------------------------- lifecycle

test('an update that widens permissions waits instead of taking them', () => {
  reset();
  lib.installVerifiedPlugin(download(), { approvePermissions: true });

  const wider = capabilityManifest({
    version: '2.1.0',
    permissions: {
      network: [
        { id: 'opsin', origin: 'https://opsin.ch.cam.ac.uk', pathPrefixes: ['/opsin/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 },
        { id: 'pubchem', origin: 'https://pubchem.ncbi.nlm.nih.gov', pathPrefixes: ['/rest/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 },
      ],
      svg: true,
    },
  });
  const files = defaultFiles(pluginManifest({ version: '2.1.0' }), wider);
  files['skills/chemistry-studio/skill.json'] = JSON.stringify({ ...JSON.parse(files['skills/chemistry-studio/skill.json']), version: '2.1.0' }, null, 2);
  const update = download(files, { version: '2.1.0' });

  const pending = lib.installVerifiedPlugin(update, {});
  assert.equal(pending.activated, false);
  assert.equal(pending.state.status, 'pending-permissions');
  assert.equal(pending.state.active.version, '2.0.0', 'the running version is untouched while an update waits');
  assert.equal(pending.state.pending.version, '2.1.0');

  const approved = lib.approvePendingPluginV2('chemistry-studio');
  assert.equal(approved.status, 'ready');
  assert.equal(approved.active.version, '2.1.0');
  assert.equal(approved.previous.version, '2.0.0');
  assert.equal(approved.rollbackAvailable, true);

  const back = lib.rollbackPluginV2('chemistry-studio');
  assert.equal(back.active.version, '2.0.0');
  assert.equal(back.previous.version, '2.1.0');
});

test('an update that narrows permissions is not treated as an expansion', () => {
  reset();
  lib.installVerifiedPlugin(download(), { approvePermissions: true });
  const narrower = capabilityManifest({ version: '2.1.0', permissions: { svg: true } });
  const files = defaultFiles(pluginManifest({ version: '2.1.0' }), narrower);
  files['skills/chemistry-studio/skill.json'] = JSON.stringify({ ...JSON.parse(files['skills/chemistry-studio/skill.json']), version: '2.1.0' }, null, 2);
  const outcome = lib.installVerifiedPlugin(download(files, { version: '2.1.0' }), {});
  assert.equal(outcome.activated, true, 'giving privilege back never needs a new approval');
  assert.equal(outcome.state.active.version, '2.1.0');
});

test('downgrades and republished versions are refused', () => {
  reset();
  lib.installVerifiedPlugin(download(), { approvePermissions: true });

  const older = defaultFiles(pluginManifest({ version: '1.9.0' }), capabilityManifest({ version: '1.9.0' }));
  older['skills/chemistry-studio/skill.json'] = JSON.stringify({ ...JSON.parse(older['skills/chemistry-studio/skill.json']), version: '1.9.0' }, null, 2);
  rejects(() => lib.installVerifiedPlugin(download(older, { version: '1.9.0' }), { approvePermissions: true }), /Refusing to install/);

  // Same version, different content: either the release was rewritten or something is
  // serving a substitute. The user is not asked to adjudicate that.
  const rewritten = defaultFiles();
  rewritten['capabilities/chemistry/worker.js'] = 'module.exports = () => ({ different: true });';
  rejects(() => lib.installVerifiedPlugin(download(rewritten), { approvePermissions: true }), /different content/);
});

test('two plugins cannot provide one capability, or claim one protocol', () => {
  reset();
  lib.installVerifiedPlugin(download(), { approvePermissions: true });

  const rivalCapability = capabilityManifest({ id: 'chem', provides: 'nodus:chemistry' });
  const rivalPlugin = pluginManifest({ id: 'rival-chemistry', name: 'Rival Chemistry', capabilities: ['capabilities/chem/capability.json'], skills: ['skills/rival-chemistry/skill.json'], replacesSkills: [] });
  const files = {
    'plugin.json': JSON.stringify(rivalPlugin, null, 2),
    'capabilities/chem/capability.json': JSON.stringify(rivalCapability, null, 2),
    'capabilities/chem/worker.js': 'module.exports = () => ({});',
    'skills/rival-chemistry/skill.json': JSON.stringify({ schemaVersion: 1, id: 'rival-chemistry', name: 'Rival Chemistry', version: '2.0.0', author: 'NodusResearch', description: 'A second chemistry provider.', category: 'Research', license: 'AGPL-3.0-only', instructions: 'SKILL.md', capabilities: ['nodus:chemistry'], tools: [] }, null, 2),
    'skills/rival-chemistry/SKILL.md': 'A second chemistry provider.',
  };
  const archive = archiveFor(files);
  const release = releaseFor(archive, { plugin: 'rival-chemistry' });
  lib.installVerifiedPlugin({ archive, ...release, source: { ...source, path: 'plugins/rival-chemistry' } }, { approvePermissions: true });

  const registry = lib.rebuildCapabilityRegistry();
  assert.equal(registry.providers.get('nodus:chemistry').plugin.id, 'chemistry-studio', 'the first provider keeps the capability');
  assert.equal(registry.problems.length, 1);
  assert.match(registry.problems[0].detail, /already provided by chemistry-studio/);
  assert.equal(registry.problems[0].pluginId, 'rival-chemistry');
});

test('a package cannot claim a core capability or an identifier outside its own namespace', () => {
  reset();
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest(), capabilityManifest({ provides: 'nodus:svg' }))), { approvePermissions: true }), /cannot provide a core capability/);
  rejects(() => lib.installVerifiedPlugin(download(defaultFiles(pluginManifest(), capabilityManifest({ provides: 'someone-else:thing', chat: undefined }))), { approvePermissions: true }), /namespaced by its own plugin/);
  assert.equal(lib.rebuildCapabilityRegistry().providers.has('nodus:svg'), true, 'the core keeps nodus:svg either way');
  assert.equal(lib.rebuildCapabilityRegistry().providers.get('nodus:svg').source, 'core');
});

test('uninstalling keeps the work and removes the credentials, and a reinstall finds its place', () => {
  reset();
  const installed = lib.installVerifiedPlugin(download(), { approvePermissions: true });
  const data = path.join(profile, 'plugins', 'data', 'chemistry-studio', 'chemistry');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ outcomes: 3 }));
  fs.mkdirSync(path.join(profile, 'plugins', 'cache', 'chemistry-studio'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'plugins', 'secrets', 'chemistry-studio.bin'), 'encrypted');
  assert.ok(installed.state.active);

  lib.removePluginV2('chemistry-studio');
  assert.equal(lib.readPluginStateV2('chemistry-studio'), null);
  assert.equal(fs.existsSync(path.join(data, 'state.json')), true, 'chat artifacts and durable data survive an uninstall');
  assert.equal(fs.existsSync(path.join(profile, 'plugins', 'secrets', 'chemistry-studio.bin')), false, 'credentials do not');
  assert.equal(fs.existsSync(path.join(profile, 'plugins', 'cache', 'chemistry-studio')), false, 'neither do rebuildable caches');

  const tombstone = lib.pluginTombstone('chemistry-studio');
  assert.equal(tombstone.id, 'chemistry-studio');
  assert.equal(tombstone.source.path, 'plugins/chemistry-studio');

  assert.equal(lib.rebuildCapabilityRegistry().providers.has('nodus:chemistry'), false);

  lib.installVerifiedPlugin(download(), { approvePermissions: true });
  assert.equal(fs.readFileSync(path.join(data, 'state.json'), 'utf8'), JSON.stringify({ outcomes: 3 }), 'the data it left behind is still there');

  lib.removePluginV2('chemistry-studio', { purgeData: true });
  assert.equal(fs.existsSync(data), false, 'the second, explicit removal takes the data too');
});

test('a package is not announced until its data has climbed its own migration ladder', () => {
  reset();
  const plugin = pluginManifest({ migrations: ['migrations/001-adopt.cjs', 'migrations/002-rename.cjs'] });
  const files = {
    ...defaultFiles(plugin),
    'migrations/001-adopt.cjs': 'module.exports = async () => ({});',
    'migrations/002-rename.cjs': 'module.exports = async () => ({});',
  };
  const outcome = lib.installVerifiedPlugin(download(files), { approvePermissions: true });
  assert.equal(outcome.activated, true);
  assert.equal(outcome.state.dataVersion, 0);

  // Installed, verified, active — and deliberately invisible. Announcing it here is how a
  // capability gets used against data it has not finished moving.
  let registry = lib.rebuildCapabilityRegistry();
  assert.equal(lib.capabilityIsAvailable('nodus:chemistry'), false);
  assert.match(registry.problems[0].detail, /Waiting for its data migration \(0 of 2\)/);

  // Halfway is still not ready.
  lib.recordPluginDataVersion('chemistry-studio', 1);
  registry = lib.rebuildCapabilityRegistry();
  assert.equal(lib.capabilityIsAvailable('nodus:chemistry'), false);
  assert.match(registry.problems[0].detail, /\(1 of 2\)/);

  lib.recordPluginDataVersion('chemistry-studio', 2);
  registry = lib.rebuildCapabilityRegistry();
  assert.equal(lib.capabilityIsAvailable('nodus:chemistry'), true);
  assert.deepEqual(registry.problems, []);

  // The recorded version is the host's to raise, never to lower: an older build reporting
  // a smaller number is describing what it can read, not what is on disk.
  lib.recordPluginDataVersion('chemistry-studio', 1);
  assert.equal(lib.readPluginStateV2('chemistry-studio').dataVersion, 2);
  rejects(() => lib.recordPluginDataVersion('chemistry-studio', -1), /Invalid data version/);

  // And the scripts handed to a worker are the ones inside the installed package.
  const scripts = lib.pluginMigrationScripts('chemistry-studio');
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    assert.ok(script.includes(path.join('installed', 'chemistry-studio', 'versions')), 'a migration is read from the signed package');
    assert.ok(fs.existsSync(script));
  }
});

test('a build with no publishing key installs nothing at all', async () => {
  const keyless = path.join(scratch, 'keyless.cjs');
  await build({
    stdin: { contents: `export * from './electron/capabilities/trustedKeys';`, resolveDir: root, loader: 'ts' },
    outfile: keyless, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'keyless-build',
      setup(api) {
        api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'trusted-keys', namespace: 'keyless' }));
        api.onLoad({ filter: /.*/, namespace: 'keyless' }, () => ({ contents: JSON.stringify({ keys: [] }), loader: 'json' }));
      },
    }],
  });
  const shipped = createRequire(import.meta.url)(keyless);
  assert.deepEqual(shipped.trustedPublishingKeys(), [], 'a keyless build carries no trusted publisher');
  rejects(() => shipped.assertPublishingKeysConfigured(), /no capability publishing key/);
});

// ---------------------------------------------------------------- answering the question

test('a first install that asks for permissions can be answered either way', () => {
  reset();
  // What the panel could not do before 5.4.1: a package installed without a blanket
  // approval pends with no active version, so every control keyed on `active` was absent
  // and the only reachable move was to install again and pend again.
  const asked = lib.installVerifiedPlugin(download(), {});
  assert.equal(asked.activated, false);
  assert.equal(asked.state.status, 'pending-permissions');
  assert.equal(asked.state.active, undefined, 'nothing is active before the question is answered');

  // The set the user is shown comes from the staged package: the stored fingerprint is a
  // hash and cannot be turned back into a list.
  const permissions = lib.pendingPluginPermissions('chemistry-studio');
  assert.deepEqual(permissions.network.map(endpoint => endpoint.origin), ['https://opsin.ch.cam.ac.uk']);
  assert.equal(permissions.svg, true);

  const allowed = lib.approvePendingPluginV2('chemistry-studio');
  assert.equal(allowed.status, 'ready');
  assert.equal(allowed.active.version, '2.0.0', 'saying yes to a first install activates it');
  assert.equal(allowed.pending, undefined);
});

test('refusing a first install leaves nothing behind', () => {
  reset();
  lib.installVerifiedPlugin(download(), {});
  assert.ok(lib.readPluginStateV2('chemistry-studio'), 'the package is staged while the question stands');

  assert.equal(lib.discardPendingPluginV2('chemistry-studio'), null);
  assert.equal(lib.readPluginStateV2('chemistry-studio'), null, 'no state survives a refusal');
  assert.deepEqual(lib.listInstalledPluginsV2().map(state => state.id), [], 'and it is not listed as installed');
  assert.equal(fs.existsSync(path.join(profile, 'plugins', 'installed', 'chemistry-studio')), false, 'nor left on disk');
});

test('refusing an update keeps the version that was already running', () => {
  reset();
  lib.installVerifiedPlugin(download(), { approvePermissions: true });
  const wider = capabilityManifest({
    version: '2.1.0',
    permissions: {
      network: [
        { id: 'opsin', origin: 'https://opsin.ch.cam.ac.uk', pathPrefixes: ['/opsin/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 },
        { id: 'pubchem', origin: 'https://pubchem.ncbi.nlm.nih.gov', pathPrefixes: ['/rest/'], methods: ['GET'], maxResponseBytes: 1_048_576, timeoutMs: 30_000 },
      ],
      svg: true,
    },
  });
  const files = defaultFiles(pluginManifest({ version: '2.1.0' }), wider);
  files['skills/chemistry-studio/skill.json'] = JSON.stringify({ ...JSON.parse(files['skills/chemistry-studio/skill.json']), version: '2.1.0' }, null, 2);
  lib.installVerifiedPlugin(download(files, { version: '2.1.0' }), {});

  const kept = lib.discardPendingPluginV2('chemistry-studio');
  assert.equal(kept.status, 'ready');
  assert.equal(kept.active.version, '2.0.0', 'the running version is what a refusal leaves you with');
  assert.equal(kept.pending, undefined);
  assert.equal(lib.pendingPluginPermissions('chemistry-studio'), null, 'and nothing is still asking');
});
