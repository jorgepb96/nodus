/** Private-runtime directory lifecycle in disposable roots. This is deliberately
 * not an OS installer, code-signing, notarization or whole-app uninstall test. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const disposableCI = process.argv.includes('--disposable-ci') && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
if (process.platform !== 'darwin' && !disposableCI) throw new Error('Requires OS boundary or disposable hosted CI');
const root = createResearchTestRoot();
const roots = [root, createResearchTestRoot()];
const proof = roots.map(profile => process.platform === 'darwin' ? verifyResearchSandbox(profile, macResearchSandbox(profile)) : { environment: 'disposable-hosted-ci', osWriteBoundaryVerified: false });
const source = path.resolve(import.meta.dirname, '../build/zotero-mcp');
const runtime = path.join(root, 'private-program/zotero-mcp');
const foreign = path.join(root, 'foreign-installation');
fs.mkdirSync(foreign);
fs.writeFileSync(path.join(foreign, 'python'), 'UNRELATED_EXECUTABLE_MUST_NOT_RUN');
fs.writeFileSync(path.join(foreign, 'keep.json'), '{"owner":"other-application"}');
for (const profile of roots) fs.writeFileSync(path.join(profile, 'profile/retained.json'), '{"retain":true}');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(directory) {
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true }).flatMap(entry => {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink()) return [[path.relative(directory, file), `link:${fs.readlinkSync(file)}`]];
    return entry.isFile() ? [[path.relative(directory, file), hash(file)]] : [];
  }).sort(([a], [b]) => a.localeCompare(b));
}
const original = inventory(source);
const unrelated = inventory(foreign);
fs.cpSync(source, runtime, { recursive: true, verbatimSymlinks: true });
assert.deepEqual(inventory(runtime), original, 'installation retains exact distributed bytes and relative symlinks');
const servers = [], clients = [], processes = [];
const requests = [];
async function connect(profile, index) {
  const marker = `synthetic-profile-${index}`;
  const server = http.createServer((req, res) => {
    requests.push({ profile: index, method: req.method, path: req.url });
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Zotero-Server-ID', marker);
    res.end(JSON.stringify({ key: 'SOURCE01', version: 1, data: { key: 'SOURCE01', version: 1, title: marker } }));
  });
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const manifest = path.join(profile, 'mcp/scope.json');
  fs.writeFileSync(manifest, JSON.stringify({ format: 'nodus.zotero-mcp-scope/1', root: profile, serverId: marker,
    endpoint: `http://127.0.0.1:${server.address().port}/api`, items: [{ libraryType: 'user', libraryId: '0', itemKey: 'SOURCE01', version: 1, revision: marker, attachments: [] }] }));
  const python = path.join(runtime, process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3');
  const args = ['-I', '-B', path.join(runtime, 'serve.py'), manifest];
  const policy = process.platform === 'darwin' ? macResearchSandbox(profile, [server.address().port]) : null;
  if (policy) verifyResearchSandbox(profile, policy);
  const transport = new StdioClientTransport({ command: policy ? '/usr/bin/sandbox-exec' : python,
    args: policy ? ['-p', policy, python, ...args] : args, stderr: 'pipe',
    env: { ...researchTestEnvironment(profile), PATH: foreign, HOME: profile,
      XDG_CACHE_HOME: path.join(profile, 'mcp/cache'), XDG_CONFIG_HOME: path.join(profile, 'mcp/config'), FASTMCP_CHECK_FOR_UPDATES: 'off' } });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'nodus-runtime-lifecycle-fixture', version: '1' });
  clients.push(client);
  await client.connect(transport);
  processes.push({ pid: transport.pid, profile, executable: python, owned: true });
  const result = await client.callTool({ name: 'zotero_get_item_metadata', arguments: { library_type: 'user', library_id: '0', item_key: 'SOURCE01' } });
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result), new RegExp(marker));
  return client;
}
const report = { root, roots, proof, kind: 'private-runtime-directory-lifecycle', nativeInstallerTest: false, passed: false };
try {
  await connect(roots[0], 0);
  await connect(roots[1], 1);
  assert.equal(new Set(processes.map(process => process.pid)).size, 2, 'two profiles own distinct child processes');
  await Promise.all(clients.splice(0).map(client => client.close()));
  assert.deepEqual(inventory(runtime), original, 'processes cannot silently change distributed bytes');
  // Same-version staged replacement exercises directory ownership and data
  // preservation; it does not claim compatibility with a future runtime version.
  const staged = path.join(root, 'private-program/staged');
  fs.cpSync(source, staged, { recursive: true, verbatimSymlinks: true });
  assert.deepEqual(inventory(staged), original);
  const old = path.join(root, 'private-program/previous');
  fs.renameSync(runtime, old); fs.renameSync(staged, runtime);
  // Windows may briefly retain filesystem handles after the children exit.
  // Retry removal without hiding a persistent failure or relaxing ownership.
  fs.rmSync(old, { recursive: true, maxRetries: 10, retryDelay: 100 });
  await connect(roots[0], 2);
  await Promise.all(clients.splice(0).map(client => client.close()));
  for (const processRecord of processes) assert.throws(() => process.kill(processRecord.pid, 0), error => error.code === 'ESRCH', 'owned child exited before removing executable resources');
  fs.rmSync(path.join(root, 'private-program'), { recursive: true, maxRetries: 10, retryDelay: 100 });
  assert.equal(fs.existsSync(runtime), false);
  assert.deepEqual(inventory(foreign), unrelated, 'removal preserves unrelated executables/configuration');
  for (const profile of roots) assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'profile/retained.json'))).retain, true);
  assert.deepEqual(inventory(source), original, 'source application resources remain untouched');
  Object.assign(report, { passed: true, files: original.length, processes, requests, simultaneousProfiles: 2,
    sameVersionReplacement: true, ownedProcessesClosed: true, retainedProfileData: true, unrelatedInstallationPreserved: true });
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  fs.writeFileSync(path.join(root, 'artifacts/runtime-lifecycle.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
