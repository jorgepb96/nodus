import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-eg2-availability-'));
try {
  const outfile = path.join(root, 'intel.cjs');
  await build({ stdin: { contents: `export * from './electron/ai/nodusLocalAi'; export {embedEmbeddingGemma2} from './electron/ai/embeddingGemma2Host';`, resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'cjs',
    tsconfig: 'electron/tsconfig.json', logLevel: 'silent', external: ['@huggingface/transformers'],
    define: { 'process.platform': '"darwin"', 'process.arch': '"x64"' },
    plugins: [{ name: 'isolated-electron', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'qa' }));
      b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(root)}, getAppPath: () => ${JSON.stringify(process.cwd())}, isPackaged: false }; export const utilityProcess = { fork: () => { throw new Error('worker must not start'); } };` }));
    } }],
  });
  const manager = await import(pathToFileURL(outfile));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No remote API or download permitted'); };
  try {
    const available = manager.listNodusLocalEmbeddingModels();
    assert.ok(available.some(m => m.id === 'multilingual-e5-small-int8'));
    assert.ok(!available.some(m => m.id.startsWith('embeddinggemma-')));
    for (const dim of [256, 512]) {
      const id = `embeddinggemma-2-text-q8-${dim}-v1`;
      await assert.rejects(manager.downloadNodusLocalModel(id), /Mac con procesador Intel/);
      await assert.rejects(manager.embedWithNodusLocal(id, 'query'), /Mac con procesador Intel/);
      await assert.rejects(manager.embedEmbeddingGemma2(id, root, ['query'], {}), /Mac con procesador Intel/);
      await manager.deleteNodusLocalModel(id); // Installed/partial assets stay removable.
    }
    const status = await manager.getNodusLocalAiStatus();
    const profiles = status.models.filter(m => m.id.startsWith('embeddinggemma-'));
    assert.equal(profiles.length, 2);
    assert.ok(profiles.every(m => m.unavailableReason.includes('Intel')));
  } finally { globalThis.fetch = oldFetch; }
  const sharedFile = path.join(root, 'shared.mjs');
  await build({ stdin: { contents: `export * from './shared/embeddingGemma2Availability'; export {localizeRuntimeError} from './shared/uiLanguage'; export {EMBEDDING_GEMMA2_TRANSLATIONS} from './src/i18n.embeddingGemma2';`, resolveDir: process.cwd() },
    outfile: sharedFile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const shared = await import(pathToFileURL(sharedFile));
  for (const platform of ['darwin', 'win32', 'linux']) for (const arch of ['x64', 'arm64']) {
    for (const dim of [256, 512]) assert.equal(Boolean(shared.nodusLocalModelUnavailableReason(`embeddinggemma-2-text-q8-${dim}-v1`, platform, arch)), platform === 'darwin' && arch === 'x64');
    assert.equal(shared.nodusLocalModelUnavailableReason('multilingual-e5-small-int8', platform, arch), undefined);
  }
  for (const locale of Object.keys(shared.EMBEDDING_GEMMA2_INTEL_COPY)) {
    const translated = shared.localizeRuntimeError(shared.EMBEDDING_GEMMA2_INTEL_UNAVAILABLE, locale);
    assert.equal(translated, shared.EMBEDDING_GEMMA2_INTEL_COPY[locale]);
    assert.equal(shared.EMBEDDING_GEMMA2_TRANSLATIONS[locale][shared.EMBEDDING_GEMMA2_INTEL_UNAVAILABLE], translated);
  }
  console.log('Intel availability: real manager denies both profiles before download/worker, catalog filters them, legacy E5 retained, platform matrix and all UI/runtime translations passed (simulated Intel).');
} finally { await fs.rm(root, { recursive: true, force: true }); }
