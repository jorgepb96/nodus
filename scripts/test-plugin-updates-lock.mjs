// The legacy chat-plugin updater must obey the same NODUS_DISABLE_AUTO_UPDATE lock as the
// app updater and the capability-package updater: no catalogue fetch, no install, no timer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load(tmp) {
  const outfile = path.join(tmp, 'skillPluginUpdates.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/skillPluginUpdates.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^electron$|\/skillMarketplace$|\/skillPlugins$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'electron'
        ? `export const app = { getPath: () => ${JSON.stringify(tmp)} };`
        : args.path.endsWith('skillPlugins')
          ? `export function listInstalledPlugins() { globalThis.__calls.push('list'); return [{ id: 'p', sourceId: 's', activeVersion: '1.0.0', autoUpdate: true }]; }`
          : `export async function updateSkillSource(id) { globalThis.__calls.push('fetch:' + id); return { sources: [] }; }
             export function installMarketplacePlugin() { globalThis.__calls.push('install'); }` }));
    } }],
  });
  return import(pathToFileURL(outfile).href);
}

test('plugin auto-updates stay off under NODUS_DISABLE_AUTO_UPDATE=1', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-plugin-lock-'));
  const previous = process.env.NODUS_DISABLE_AUTO_UPDATE;
  try {
    globalThis.__calls = [];
    process.env.NODUS_DISABLE_AUTO_UPDATE = '1';
    const updates = await load(tmp);
    await updates.checkPluginUpdates(true);
    updates.startPluginUpdates();
    await new Promise(resolve => setImmediate(resolve));
    updates.stopPluginUpdates();
    assert.deepEqual(globalThis.__calls, [], 'no plugin list, catalogue fetch or install while locked');

    // Control: without the lock the same stubbed loop does reach the catalogue.
    delete process.env.NODUS_DISABLE_AUTO_UPDATE;
    await updates.checkPluginUpdates(true);
    assert.deepEqual(globalThis.__calls, ['list', 'fetch:s']);
  } finally {
    if (previous === undefined) delete process.env.NODUS_DISABLE_AUTO_UPDATE; else process.env.NODUS_DISABLE_AUTO_UPDATE = previous;
    await rm(tmp, { recursive: true, force: true });
  }
});
