import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-registry-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'registry.cjs');
await build({
  stdin: { contents: `export * from './skill-capabilities/contracts'; export * from './skill-capabilities/pluginPackage'; export * from './electron/skillPlugins'; export * from './electron/chatSkills'; export * from './electron/skillMarketplace'; export * from './electron/skillPluginUpdates'; export * from './electron/chatAssets';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'electron-profile', setup(api) {
    api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=>"5.3.0"};export const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString("utf8")};`, loader: 'js' }));
    api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
  } }],
});
const lib = createRequire(import.meta.url)(bundle);

function pluginFiles(version, permissions = {}, id = 'calculator-kit') {
  const plugin = { schemaVersion: 1, id, name: 'Calculator Kit', version, author: 'NodusResearch', description: `Deterministic calculator ${version}.`, license: 'MIT', compatibility: { capabilityApi: 1, minNodusVersion: '5.3.0' }, skills: ['skills/calculator/skill.json'], capabilities: ['capabilities/calculate/capability.json'] };
  const skill = { schemaVersion: 1, id: 'calculator', name: 'Calculator', version, author: 'NodusResearch', description: 'Calculate exact sums.', category: 'Research', license: 'MIT', instructions: 'SKILL.md', capabilities: ['self:calculate'], tools: [{ id: 'double', description: 'Double a number.', entry: 'tools/double.js', runtime: 'javascript-sandbox' }] };
  const capability = { schemaVersion: 1, id: 'calculate', version, description: 'Sandboxed arithmetic.', runtime: 'javascript-sandbox-v1', entry: 'runtime.js', tools: [{ id: 'sum', description: 'Sum a list of numbers.', inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } }, required: ['values'], additionalProperties: false }, resultKinds: ['json'] }], permissions };
  return { 'plugin.json': JSON.stringify(plugin, null, 2), 'skills/calculator/skill.json': JSON.stringify(skill, null, 2), 'skills/calculator/SKILL.md': `Use the ${version} calculator.`, 'skills/calculator/tools/double.js': '(input) => ({ value: input.value * 2 })', 'capabilities/calculate/capability.json': JSON.stringify(capability, null, 2), 'capabilities/calculate/runtime.js': '(request) => ({ kind: "json", value: { sum: request.input.values.reduce((a,b)=>a+b,0) } })' };
}

function writePlugin(directory, files) {
  for (const [relative, source] of Object.entries(files)) { const target = path.join(directory, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); }
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

test('temporary Git repository imports, updates, gates permissions, preserves overlays and rolls back atomically', () => {
  const author = path.join(scratch, 'author'), bare = path.join(scratch, 'origin.git'); fs.mkdirSync(author);
  git('-C', author, 'init', '-b', 'main'); git('-C', author, 'config', 'user.name', 'Nodus Test'); git('-C', author, 'config', 'user.email', 'test@nodus.invalid');
  writePlugin(path.join(author, 'calculator-kit'), pluginFiles('1.0.0'));
  git('-C', author, 'add', '.'); git('-C', author, 'commit', '-m', 'plugin v1'); const v1 = git('-C', author, 'rev-parse', 'HEAD');
  fs.rmSync(path.join(author, 'calculator-kit'), { recursive: true }); writePlugin(path.join(author, 'calculator-kit'), pluginFiles('1.1.0'));
  git('-C', author, 'add', '.'); git('-C', author, 'commit', '-m', 'plugin v1.1'); const v11 = git('-C', author, 'rev-parse', 'HEAD');
  fs.rmSync(path.join(author, 'calculator-kit'), { recursive: true }); writePlugin(path.join(author, 'calculator-kit'), pluginFiles('1.2.0', { storage: { maxBytes: 4096 } }));
  git('-C', author, 'add', '.'); git('-C', author, 'commit', '-m', 'plugin v1.2 permissions'); const v12 = git('-C', author, 'rev-parse', 'HEAD');
  assert.equal(new Set([v1, v11, v12]).size, 3);
  git('clone', '--bare', author, bare);
  const worktrees = [v1, v11, v12].map((commit, index) => { const directory = path.join(scratch, `worktree-${index}`); git(`--git-dir=${bare}`, 'worktree', 'add', '--detach', directory, commit); assert.equal(git('-C', directory, 'rev-parse', 'HEAD'), commit); return directory; });

  lib.initializeChatSkillDefaults(); lib.initializePluginStore();
  let skills = lib.installChatPluginDirectory(path.join(worktrees[0], 'calculator-kit'), { sourceId: 'test/origin', sourcePath: 'calculator-kit', sourceCommit: v1, approvePermissions: true, autoUpdate: true });
  let calculator = skills.find(skill => skill.plugin?.id === 'calculator-kit');
  assert.ok(calculator); assert.equal(calculator.version, '1.0.0'); assert.deepEqual(calculator.enabled, { assistant: false, nodi: false });
  assert.equal(calculator.capabilities[0], 'calculator-kit:calculate'); assert.equal(calculator.capabilityTools[0].toolId, 'sum');
  skills = lib.saveChatSkill({ ...calculator, instructions: 'My local overlay.', enabled: { assistant: true, nodi: false } });
  calculator = skills.find(skill => skill.plugin?.id === 'calculator-kit');

  skills = lib.installChatPluginDirectory(path.join(worktrees[1], 'calculator-kit'), { sourceId: 'test/origin', sourcePath: 'calculator-kit', sourceCommit: v11, approvePermissions: false, autoUpdate: true });
  calculator = skills.find(skill => skill.plugin?.id === 'calculator-kit');
  assert.equal(calculator.version, '1.1.0'); assert.equal(calculator.instructions, 'My local overlay.'); assert.equal(calculator.enabled.assistant, true);
  assert.equal(lib.listInstalledPlugins()[0].activeVersion, '1.1.0');
  const storage = lib.pluginStorageFile('calculator-kit', 'calculate'); fs.mkdirSync(path.dirname(storage), { recursive: true }); fs.writeFileSync(storage, '{"generation":1}');

  skills = lib.installChatPluginDirectory(path.join(worktrees[2], 'calculator-kit'), { sourceId: 'test/origin', sourcePath: 'calculator-kit', sourceCommit: v12, approvePermissions: false, autoUpdate: true });
  assert.equal(skills.find(skill => skill.plugin?.id === 'calculator-kit').version, '1.1.0');
  let installed = lib.listInstalledPlugins()[0]; assert.equal(installed.activeVersion, '1.1.0'); assert.equal(installed.pendingVersion, '1.2.0'); assert.equal(installed.pendingReason, 'permissions');
  skills = lib.approvePendingChatPlugin('calculator-kit'); calculator = skills.find(skill => skill.plugin?.id === 'calculator-kit');
  assert.equal(calculator.version, '1.2.0'); assert.equal(calculator.instructions, 'My local overlay.');
  fs.writeFileSync(storage, '{"generation":2}');
  skills = lib.rollbackChatPlugin('calculator-kit'); calculator = skills.find(skill => skill.plugin?.id === 'calculator-kit');
  assert.equal(calculator.version, '1.1.0'); assert.equal(calculator.instructions, 'My local overlay.'); assert.equal(fs.readFileSync(storage, 'utf8'), '{"generation":1}');
  assert.throws(() => lib.installChatPluginDirectory(path.join(worktrees[0], 'calculator-kit'), { sourceId: 'test/origin', approvePermissions: true }), /downgrades require explicit rollback/);

  const before = lib.readPluginState('updater-kit');
  const tampered = pluginFiles('1.1.0'); tampered['skills/calculator/SKILL.md'] = 'Changed without SemVer.';
  assert.throws(() => lib.installChatPluginPackage(lib.validatePluginPackage({ manifest: JSON.parse(tampered['plugin.json']), files: tampered }), { sourceId: 'test/origin', approvePermissions: true }), /without a version bump/);
  assert.deepEqual(lib.readPluginState('updater-kit'), before, 'failed validation and staging never change the active state');
});

test('registry contracts normalize built-ins and reject unsafe packages and schemas', () => {
  assert.equal(lib.normalizeCapabilityId('svg'), 'nodus:svg'); assert.equal(lib.normalizeCapabilityId('legal'), 'nodus:legal');
  const files = pluginFiles('1.0.0');
  assert.throws(() => lib.validatePluginPackage({ manifest: JSON.parse(files['plugin.json']), files: { ...files, '../escape': 'x' } }), /Unsafe plugin path/);
  const mismatched = pluginFiles('1.0.0'); const capability = JSON.parse(mismatched['capabilities/calculate/capability.json']); capability.version = '1.1.0'; mismatched['capabilities/calculate/capability.json'] = JSON.stringify(capability);
  assert.throws(() => lib.validatePluginPackage({ manifest: JSON.parse(mismatched['plugin.json']), files: mismatched }), /versions must match/);
  assert.equal(lib.jsonSchemaMatches({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false }, { n: 2 }), true);
  assert.equal(lib.jsonSchemaMatches({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false }, { n: 2, html: '<script>' }), false);
});

test('all seven chat orchestrators share the skill prompt and central dispatcher', () => {
  const direct = ['electron/ai/researchAssistant.ts', 'electron/ai/nodiChat.ts', 'electron/ai/worldChat.ts', 'electron/ai/databaseChat.ts', 'electron/ai/studyAssistant.ts', 'electron/ai/characterChat.ts'];
  for (const relative of direct) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /executeChatSkills/);
  }
  for (const relative of direct.slice(0, 5)) assert.match(fs.readFileSync(path.join(root, relative), 'utf8'), /buildChatSkillsPrompt/);
  const reader = fs.readFileSync(path.join(root, 'electron/ai/libraryReaderChat.ts'), 'utf8');
  assert.match(reader, /streamNodiChat/); assert.match(reader, /ChatSkillExecution/);
  assert.match(fs.readFileSync(path.join(root, 'electron/ai/characterInterview.ts'), 'utf8'), /buildChatSkillsPrompt/);
  const dispatcher = fs.readFileSync(path.join(root, 'electron/ai/chatSkillExecution.ts'), 'utf8');
  assert.doesNotMatch(dispatcher, /chemistry|genomics|legalize|decorativeImages|chatSvgQuality/i);
  assert.match(dispatcher, /executeRegisteredChatSkills/);
});

test('the auto-update cycle installs a compatible release, gates a wider one and survives a broken network', async () => {
  // The same temporary repository, served through a GitHub-shaped mock. Production's
  // HTTPS and github.com restrictions are untouched; only the transport is simulated.
  const author = path.join(scratch, 'updates'), origin = 'https://github.com/nodus-test/plugins';
  fs.mkdirSync(author);
  git('-C', author, 'init', '-b', 'main'); git('-C', author, 'config', 'user.name', 'Nodus Test'); git('-C', author, 'config', 'user.email', 'test@nodus.invalid');
  const commits = {};
  const publish = (version, permissions, message) => {
    fs.rmSync(path.join(author, 'updater-kit'), { recursive: true, force: true });
    writePlugin(path.join(author, 'updater-kit'), pluginFiles(version, permissions, 'updater-kit'));
    git('-C', author, 'add', '-A'); git('-C', author, 'commit', '-m', message);
    const sha = git('-C', author, 'rev-parse', 'HEAD');
    const worktree = path.join(scratch, `served-${version}`);
    git('-C', author, 'worktree', 'add', '--detach', worktree, sha);
    commits[sha] = worktree; return sha;
  };
  const v1 = publish('2.0.0', {}, 'plugin v2');
  const v11 = publish('2.1.0', {}, 'plugin v2.1');
  const v12 = publish('2.2.0', { storage: { maxBytes: 4096 } }, 'plugin v2.2 permissions');
  const incompatible = publish('2.3.0', {}, 'plugin v2.3 incompatible');
  const optedOut = publish('2.4.0', {}, 'plugin v2.4');
  { // The newest release demands a Nodus this build is older than.
    const directory = path.join(commits[incompatible], 'updater-kit');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8'));
    manifest.compatibility.minNodusVersion = '99.0.0';
    fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify(manifest, null, 2));
  }

  let head = v1, offline = false;
  const listing = commit => fs.readdirSync(path.join(commits[commit], 'updater-kit'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => ({ path: path.relative(commits[commit], path.join(entry.parentPath ?? entry.path, entry.name)), mode: '100644', type: 'blob', size: 100 }));
  const mock = async url => {
    if (offline) throw new Error('network is down');
    const value = String(url);
    const raw = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{40})\/(.+)$/.exec(value);
    if (raw) {
      const file = path.join(commits[raw[1]], decodeURIComponent(raw[2]));
      return fs.existsSync(file) ? new Response(fs.readFileSync(file, 'utf8'), { status: 200 }) : new Response('missing', { status: 404 });
    }
    if (value.includes('/git/trees/')) return new Response(JSON.stringify({ tree: listing(/trees\/([0-9a-f]{40})/.exec(value)[1]) }), { status: 200 });
    if (value.includes('/commits/')) return new Response(JSON.stringify({ sha: head }), { status: 200 });
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  // This test is about the update cycle itself, so it runs with the auto-update lock off
  // even on a machine whose environment sets it.
  const lock = process.env.NODUS_DISABLE_AUTO_UPDATE;
  delete process.env.NODUS_DISABLE_AUTO_UPDATE;
  try {
    const marketplace = lib.addSkillSource(origin);
    const sourceId = marketplace.sources.at(-1).id;
    await lib.updateSkillSource(sourceId);
    lib.installMarketplacePlugin(sourceId, 'updater-kit', head, true);
    lib.setPluginAutoUpdate('updater-kit', true);
    const installed = () => lib.listInstalledPlugins().find(plugin => plugin.id === 'updater-kit');
    assert.equal(installed().activeVersion, '2.0.0');

    head = v11;
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.1.0', 'an identical-permission release installs automatically');

    head = v12;
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.1.0', 'a wider permission set never applies itself');
    assert.equal(installed().pendingVersion, '2.2.0');
    assert.equal(installed().pendingReason, 'permissions');
    lib.approvePendingChatPlugin('updater-kit');
    assert.equal(installed().activeVersion, '2.2.0');

    head = incompatible;
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.2.0', 'an incompatible release is refused and leaves the active version alone');

    head = v11;
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.2.0', 'auto-update never walks a plugin backwards');

    offline = true;
    const before = lib.readPluginState('updater-kit');
    await lib.checkPluginUpdates(true);
    assert.deepEqual(lib.readPluginState('updater-kit'), before, 'a failed check leaves the installation untouched');
    offline = false;

    lib.setPluginAutoUpdate('updater-kit', false);
    head = optedOut;
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.2.0', 'a plugin without auto-update is never fetched');
    lib.setPluginAutoUpdate('updater-kit', true);
    await lib.checkPluginUpdates(true);
    assert.equal(installed().activeVersion, '2.4.0', 'and the same release installs once auto-update is on');
  } finally {
    globalThis.fetch = originalFetch;
    if (lock === undefined) delete process.env.NODUS_DISABLE_AUTO_UPDATE; else process.env.NODUS_DISABLE_AUTO_UPDATE = lock;
  }
});

test('inbox packages are reviewable, path-bounded and never active before approval', () => {
  const inbox = path.join(profile, 'plugins', 'inbox', 'inbox-kit');
  writePlugin(inbox, pluginFiles('1.0.0', {}, 'inbox-kit'));
  const waiting = lib.listInboxPlugins().find(plugin => plugin.id === 'inbox-kit');
  assert.ok(waiting, 'the package is offered for review');
  assert.equal(waiting.installed, false);
  assert.equal(waiting.permissions.storage, undefined, 'the review states the permissions it will grant');
  assert.equal(lib.listChatSkills().some(skill => skill.plugin?.id === 'inbox-kit'), false, 'nothing in the inbox is active before approval');
  assert.equal(lib.readPluginState('inbox-kit'), null);

  // Only paths inside the inbox can be read or discarded through this route.
  for (const escape of [path.join(profile, 'plugins', 'installed'), path.join(profile, 'plugins', 'inbox'), path.join(scratch, 'author')]) {
    assert.throws(() => lib.readInboxPlugin(escape), /not in the plugin inbox/);
    assert.throws(() => lib.discardInboxPlugin(escape), /not in the plugin inbox/);
  }

  const skills = lib.installChatPluginPackage(lib.readInboxPlugin(inbox), { sourceId: 'inbox', sourcePath: inbox, approvePermissions: true });
  const installed = skills.find(skill => skill.plugin?.id === 'inbox-kit');
  assert.ok(installed); assert.deepEqual(installed.enabled, { assistant: false, nodi: false }, 'an approved skill still starts disabled');
  lib.discardInboxPlugin(inbox);
  assert.equal(fs.existsSync(inbox), false);
  assert.equal(lib.listInboxPlugins().some(plugin => plugin.id === 'inbox-kit'), false);
});

test('an overlay can be reset to the author version, and results outlive the plugin that made them', () => {
  const directory = path.join(scratch, 'overlay-kit');
  writePlugin(directory, pluginFiles('1.0.0', {}, 'overlay-kit'));
  let skill = lib.installChatPluginDirectory(directory, { sourceId: 'local', approvePermissions: true }).find(item => item.plugin?.id === 'overlay-kit');
  const authored = skill.instructions;
  assert.equal(authored, 'Use the 1.0.0 calculator.');

  // A local edit is an overlay over the author's text, and it can be given back.
  skill = lib.saveChatSkill({ ...skill, instructions: 'My own wording.' }).find(item => item.id === skill.id);
  assert.equal(skill.instructions, 'My own wording.');
  skill = lib.restorePluginSkillAuthorVersion(skill.id).find(item => item.id === skill.id);
  assert.equal(skill.instructions, authored, 'the author version comes back');

  // A capability result is an opaque handle on the chat, not on the plugin.
  const owner = lib.chatAssetOwner('assistant', 'overlay-chat', 'vault');
  const source = lib.storeCapabilityFile(owner, { bytes: Buffer.from('report'), mimeType: 'text/plain', name: 'report.txt', title: 'Report' });
  assert.equal(lib.getCapabilityFile(source).blob.toString(), 'report');

  // Disabling the skill does not touch it.
  lib.saveChatSkill({ ...skill, enabled: { assistant: false, nodi: false } });
  assert.equal(lib.getCapabilityFile(source).blob.toString(), 'report');

  // Neither does uninstalling the plugin outright.
  const remaining = lib.removeChatPlugin('overlay-kit');
  assert.equal(remaining.some(item => item.plugin?.id === 'overlay-kit'), false, 'the plugin and its skills are gone');
  assert.equal(lib.readPluginState('overlay-kit'), null);
  assert.equal(lib.resolveInstalledCapability('overlay-kit:calculate'), null, 'its capability no longer resolves');
  assert.equal(lib.getCapabilityFile(source).blob.toString(), 'report', 'the result it produced stays readable');
});
