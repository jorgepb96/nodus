import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment } from './research-isolation.mjs';
import { EMBEDDING_GEMMA_PROCESS_FIXTURES as fixtures, EMBEDDING_GEMMA_PROCESS_PROFILES as profiles } from './lib/embeddinggemma-process-fixtures.mjs';
import { repoRoot } from './lib/tsRuntimeHooks.mjs';

const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const flags = new Set(process.argv.slice(2));
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha(Buffer.from(JSON.stringify(value)));
const dryRun = !flags.has('--prepare') && !flags.has('--run');
const caches = [
  { root: '/private/tmp/nodus-research-XnhRol', profile: profiles[0], dimensions: 512 },
  { root: '/private/tmp/nodus-research-KftJn2', profile: profiles[1], dimensions: 256 },
];
const sourcePaths = ['electron/ai/embeddingGemma2Host.ts','electron/workers/embeddingGemma2Worker.ts','electron/workers/backgroundProcess.ts','electron/workers/backgroundUtility.ts','electron/workers/backgroundParentPort.ts','shared/embeddingGemma2.ts'];
const sourceDigests = () => Object.fromEntries(sourcePaths.map(file => [file, sha(fs.readFileSync(path.join(repoRoot, file)))]));

function validateOwnedCache(cache) {
  const root = fs.realpathSync(cache.root);
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  assert.equal(marker.format, 'nodus.isolated-research-profile/1'); assert.equal(marker.root, root);
  const manifestFile = path.join(root, 'artifacts/model-manifest.json');
  const manifestBytes = fs.readFileSync(manifestFile), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.testedProfile, cache.profile); assert.equal(manifest.dimensions, cache.dimensions);
  const modelDirectory = fs.realpathSync(manifest.directory);
  assert(modelDirectory.startsWith(root + path.sep), 'model bytes come from this explicitly owned QA cache');
  return { root, manifestFile, manifestHash: sha(manifestBytes), manifest, modelDirectory };
}
function cloneTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) cloneTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    else throw new Error(`model asset tree contains a non-file entry: ${entry.name}`);
  }
}
function verifyAsset(asset, modelDir) {
  const file = path.join(modelDir, asset.file);
  assert(file.startsWith(modelDir + path.sep));
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, asset.bytes, `model asset bytes match manifest: ${asset.file}`);
  assert.equal(sha(bytes), asset.sha256, `model asset digest matches manifest: ${asset.file}`);
  return { file: asset.file, bytes: bytes.length, sha256: sha(bytes) };
}

if (dryRun) {
  process.stdout.write(JSON.stringify({ mode: 'dry-run', createsRoot: false, launchesElectron: false, startsInference: false,
    profiles, fixtureRows: fixtures.length, approvedOwnedAssetCaches: caches.map(cache => ({ root: cache.root, profile: cache.profile })) }, null, 2) + '\n');
  process.exit(0);
}

let root = arg('root');
if (flags.has('--prepare')) {
  if (root) throw new Error('--prepare creates a new root; do not reuse an existing path');
  root = createResearchTestRoot();
  const cacheState = caches.map(validateOwnedCache);
  const modelDir = path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
  cloneTree(cacheState[0].modelDirectory, modelDir);
  const byFile = new Map(cacheState.flatMap(cache => cache.manifest.assets.map(asset => [asset.file, asset])));
  const verifiedAssets = [...byFile.values()].map(asset => verifyAsset(asset, modelDir));
  for (const cache of cacheState) for (const asset of cache.manifest.assets) verifyAsset(asset, modelDir);
  const nodeModules = path.join(root, 'node_modules');
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), nodeModules, 'dir');
  fs.mkdirSync(path.join(root, 'profile/home'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, 'profile/config.json'), '{}', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'fixtures/empty-provider-keys.json'), '{}\n', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'artifacts/safe-storage-gate.json'), JSON.stringify({ storedCredentialCount: 0, config: {}, providerKeys: {}, rootCreatedFromEmptyState: true }, null, 2), { mode: 0o600 });
  const workerFile = path.join(root, 'embeddingGemma2Worker.cjs');
  const utilityFile = path.join(root, 'backgroundUtility.js');
  const hostFile = path.join(root, 'embeddingGemma2Host.cjs');
  const contractFile = path.join(root, 'embeddinggemma2-contract.mjs');
  await Promise.all([
    build({ entryPoints: [path.join(repoRoot, 'electron/workers/embeddingGemma2Worker.ts')], outfile: workerFile, bundle: true, platform: 'node', format: 'cjs', external: ['@nodus/embeddinggemma-transformers'], logLevel: 'silent' }),
    build({ entryPoints: [path.join(repoRoot, 'electron/workers/backgroundUtility.ts')], outfile: utilityFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' }),
    build({ entryPoints: [path.join(repoRoot, 'electron/ai/embeddingGemma2Host.ts')], outfile: hostFile, bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@nodus/embeddinggemma-transformers'], logLevel: 'silent' }),
    build({ entryPoints: [path.join(repoRoot, 'shared/embeddingGemma2.ts')], outfile: contractFile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }),
  ]);
  const bundleFiles = [workerFile, utilityFile, hostFile, contractFile];
  const artifact = { format: 'nodus.embeddinggemma-process-parity/1', root, preparedAt: new Date().toISOString(), profiles,
    sourceFiles: sourceDigests(),
    caches: cacheState.map(cache => ({ root: cache.root, profile: cache.profile, manifestSha256: cache.manifestHash })),
    verifiedAssets, bundles: Object.fromEntries(bundleFiles.map(file => [path.basename(file), { bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) }])),
    fixtureSha256: jsonHash(fixtures), fixtureRows: fixtures.length, runtimeLaunched: false, vectorGenerationStarted: false };
  fs.writeFileSync(path.join(root, 'artifacts/process-parity-prepared.json'), JSON.stringify(artifact, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ mode: 'prepared-no-runtime', root, bundleHashes: artifact.bundles, runtimeLaunched: false, vectorGenerationStarted: false }, null, 2)}\n`);
  process.exit(0);
}

if (!flags.has('--run')) throw new Error('Use default for dry-run, --prepare to create a marked QA root, or --run --root=<prepared-root> to launch the isolated Electron test.');
if (!root) throw new Error('--run requires --root=<prepared-marked-root>');
root = fs.realpathSync(root);
const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
assert.equal(marker.format, 'nodus.isolated-research-profile/1'); assert.equal(marker.root, root);
const preparedPath = path.join(root, 'artifacts/process-parity-prepared.json');
const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
assert.equal(prepared.root, root); assert.equal(prepared.fixtureSha256, jsonHash(fixtures));
assert.deepEqual(sourceDigests(), prepared.sourceFiles, 'production source files still match the prepared manifest');
for (const name of ['embeddingGemma2Worker.cjs','backgroundUtility.js','embeddingGemma2Host.cjs','embeddinggemma2-contract.mjs']) {
  assert.equal(sha(fs.readFileSync(path.join(root, name))), prepared.bundles[name].sha256, `${name} matches prepared bundle hash`);
}
for (const cache of caches) {
  const state = validateOwnedCache(cache);
  assert(prepared.caches.some(item => item.root === state.root && item.manifestSha256 === state.manifestHash), 'asset source cache contract is unchanged');
}
const modelDir = path.join(root, 'profile/local-ai/models/embeddinggemma-2-text-q8-v1');
const expectedAssets = new Map(caches.flatMap(cache => validateOwnedCache(cache).manifest.assets.map(asset => [asset.file, asset])));
const copiedAssets = [...expectedAssets.values()].map(asset => verifyAsset(asset, modelDir));
const tracesFile = path.join(root, 'profile/embedding-trace.jsonl');
const reportFile = path.join(root, 'artifacts/embeddinggemma-process-parity.json');

// Direct WorkerThread reference runs in a separate Electron-as-Node process,
// under the same deny-network/write boundary, so a native abort cannot kill this runner.
const sandboxProfile = macResearchSandbox(root);
const electronPath = createRequire(import.meta.url)('electron');
const referenceScript = path.join(repoRoot, 'scripts/lib/embeddinggemma-process-reference.mjs');
const referenceResult = spawnSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile, electronPath, referenceScript, `--root=${root}`], {
  cwd: root, env: { ...researchTestEnvironment(root), HOME: path.join(root, 'profile/home'), ELECTRON_RUN_AS_NODE: '1', NODUS_EMBEDDING_QA_TRACE: '0',
    NODUS_HARNESS_KEYS_FILE: path.join(root, 'fixtures/empty-provider-keys.json'), NODUS_E2E_NO_EXTERNAL_SERVICES: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_DISABLE_AUTO_UPDATE: '1' },
  encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
});
if (referenceResult.status !== 0) throw new Error(`direct worker reference failed: ${referenceResult.stderr || referenceResult.error || referenceResult.status}`);
const reference = JSON.parse(referenceResult.stdout);

const { createResearchApp } = await import('./lib/research-app-harness.mjs');
const harness = await createResearchApp({ root, extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1',
  NODUS_HARNESS_KEYS_FILE: path.join(root, 'fixtures/empty-provider-keys.json'), NODUS_E2E_NO_EXTERNAL_SERVICES: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_DISABLE_AUTO_UPDATE: '1' } });
let report;
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page, { embeddingProvider: 'nodus', embeddingModel: profiles[0] });
  const initialSettings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(initialSettings.embeddingProvider, 'nodus'); assert.equal(initialSettings.embeddingModel, profiles[0]);
  assert(Object.values(initialSettings.providerKeys ?? {}).every(value => !value), 'isolated settings contain no provider API keys');
  const callHost = async profile => app.evaluate(async (_electron, args) => {
    const Module = process.getBuiltinModule('node:module');
    const require = Module.createRequire(args.requireBase);
    const host = require(args.hostFile);
    const docs = args.fixtures.filter(item => item.role === 'document');
    const queries = args.fixtures.filter(item => item.role === 'query');
    const documents = await host.embedEmbeddingGemma2(args.profile, args.modelDir, docs.map(item => item.text), { titles: docs.map(item => item.title) });
    const queryVectors = await host.embedEmbeddingGemma2(args.profile, args.modelDir, queries.map(item => item.text), { role: 'query' });
    return [...documents, ...queryVectors];
  }, { requireBase: path.join(root, 'parity-require.cjs'), hostFile: path.join(root, 'embeddingGemma2Host.cjs'), modelDir, profile, fixtures });
  const hostVectors = {};
  const electronRuntime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node,
    platform: process.platform, architecture: process.arch }));
  for (const profile of profiles) hostVectors[profile] = await callHost(profile);
  const waitTrace = async predicate => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const lines = fs.existsSync(tracesFile) ? fs.readFileSync(tracesFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      const match = [...lines].reverse().find(predicate); if (match) return { match, lines };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('timed out waiting for QA child lifecycle trace');
  };
  const spawnTrace = await waitTrace(event => event.type === 'embedding-gemma-process' && event.phase === 'spawn' && Number.isSafeInteger(event.pid));
  const workerPid = spawnTrace.match.pid;
  assert(workerPid > 1 && workerPid !== process.pid);
  process.kill(workerPid, 'SIGKILL');
  await waitTrace(event => event.type === 'embedding-gemma-process' && event.phase === 'exit' && event.pid === workerPid);
  const settingsAfterKill = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(settingsAfterKill.embeddingProvider, 'nodus'); assert.equal(settingsAfterKill.embeddingModel, profiles[0]);
  assert(Object.values(settingsAfterKill.providerKeys ?? {}).every(value => !value), 'no provider keys appeared after worker crash');
  const recovered = await callHost(profiles[0]);
  await app.evaluate(async (_electron, args) => {
    const Module = process.getBuiltinModule('node:module');
    Module.createRequire(args.requireBase)(args.hostFile).closeEmbeddingGemma2Worker();
  }, { requireBase: path.join(root, 'parity-require.cjs'), hostFile: path.join(root, 'embeddingGemma2Host.cjs') });
  report = { format: 'nodus.embeddinggemma-process-parity-result/1', root, finishedAt: new Date().toISOString(), profiles,
    runtime: { electron: electronRuntime.electron, node: electronRuntime.node, platform: electronRuntime.platform, architecture: electronRuntime.architecture,
      coordinatorNode: { node: process.versions.node, platform: process.platform, architecture: process.arch }, referenceElectronAsNode: reference.runtime,
      isolation: harness.proof, network: 'macOS sandbox denies outbound and all loopback', externalProviderCalls: 0 },
    isolation: { markerFormat: marker.format, safeStorageGate: JSON.parse(fs.readFileSync(path.join(root, 'artifacts/safe-storage-gate.json'), 'utf8')),
      providerKeysPresent: false, copiedAssets, referenceChildExit: referenceResult.status, utilityPidKilled: workerPid, mainSettingsReadableAfterKill: true },
    fixtures: fixtures.map(({ role, title }) => ({ role, titleHash: title ? sha(title) : undefined })),
    comparisons: {}, trace: fs.existsSync(tracesFile) ? fs.readFileSync(tracesFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [],
    hostBundleNature: 'The host under test is an esbuild bundle of current production source loaded in the isolated QA app profile; it is not the host export loaded by main.js.',
    parity: 'Direct worker reference vs production-source embedding host vectors; Q8 model weights/tokenizer/prompt contracts unchanged.' };
  for (const profile of profiles) {
    const left = reference.profiles[profile], right = hostVectors[profile];
    assert.equal(left.length, fixtures.length); assert.equal(right.length, fixtures.length);
    const dimension = Number(profile.match(/-(256|512)-v1$/u)?.[1]);
    let maxAbsDiff = 0, maxNormError = 0;
    for (let row = 0; row < left.length; row++) {
      assert.equal(left[row].length, dimension); assert.equal(right[row].length, dimension);
      for (let column = 0; column < dimension; column++) {
        assert(Number.isFinite(left[row][column]) && Number.isFinite(right[row][column]));
        maxAbsDiff = Math.max(maxAbsDiff, Math.abs(left[row][column] - right[row][column]));
      }
      const norm = vector => Math.hypot(...vector);
      maxNormError = Math.max(maxNormError, Math.abs(norm(left[row]) - 1), Math.abs(norm(right[row]) - 1));
    }
    const serialize = vectors => Buffer.from(Float32Array.from(vectors.flat()).buffer);
    const summary = { count: right.length, dimension, referenceSha256: sha(serialize(left)), hostSha256: sha(serialize(right)),
      maxAbsDiff, maxNormError, rowOrder: 'identical fixtures and input order' };
    assert(maxNormError < 1e-6, `${profile} vectors remain normalized`);
    assert(maxAbsDiff < 1e-6, `${profile} direct and production paths are numerically equivalent`);
    report.comparisons[profile] = summary;
  }
  const recoveredDifference = Math.max(...recovered.flat().map((value, index) => Math.abs(value - hostVectors[profiles[0]].flat()[index])));
  assert(recoveredDifference < 1e-6, 'post-crash recovery preserves the same Q8-512 query/document vectors');
  report.recovery = { profile: profiles[0], vectorCount: recovered.length, maxAbsDiffFromPreCrash: recoveredDifference,
    sameProfileNoFallback: settingsAfterKill.embeddingModel === profiles[0] && settingsAfterKill.embeddingProvider === 'nodus' };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
  await harness.close();
} catch (error) {
  await harness.close().catch(() => {});
  throw error;
}
process.stdout.write(`${reportFile}\n`);
