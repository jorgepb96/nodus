// Every Research Chat turn reads the model's catalogue entry to size its thinking allowance. The
// entry does not change between turns, so it is read from the provider once, not on every turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-thinking-catalog-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'thinkingEffort.mjs');
globalThis.__catalog = { reads: 0, fail: false };
await build({ entryPoints: [path.join(root, 'electron/ai/thinkingEffort.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', alias: { '@shared': path.join(root, 'shared') },
  plugins: [{ name: 'stubs', setup(api) {
    const mocks = {
      './providers': `export async function listModels(provider) { globalThis.__catalog.reads += 1; if (globalThis.__catalog.fail) throw new Error('offline'); await new Promise(r => setTimeout(r, 50)); return [{ id: 'claude-x', name: 'X', reasoningEfforts: ['low', 'high'] }]; }
export const openAiCompatBase = () => null;`,
      '../secrets/secretStore': `export const getApiKey = () => 'key';`,
    };
    api.onResolve({ filter: /^(\.\/providers|\.\.\/secrets\/secretStore)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { thinkingCatalogInfo } = await import(pathToFileURL(outfile));

test('the catalogue entry is read from the provider once across turns, not once per turn', async () => {
  const model = { provider: 'anthropic', model: 'claude-x' };
  const t0 = Date.now();
  const first = await thinkingCatalogInfo(model);
  const second = await thinkingCatalogInfo(model);
  const third = await thinkingCatalogInfo(model);
  console.log(`three turns: ${globalThis.__catalog.reads} catalogue read(s), ${Date.now() - t0} ms`);
  assert.equal(first?.id, 'claude-x');
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(globalThis.__catalog.reads, 1);
});

test('a failed read is not remembered: the next turn asks again', async () => {
  const model = { provider: 'openai', model: 'claude-x' };
  globalThis.__catalog = { reads: 0, fail: true };
  assert.equal(await thinkingCatalogInfo(model), undefined);
  globalThis.__catalog.fail = false;
  assert.equal((await thinkingCatalogInfo(model))?.id, 'claude-x');
  assert.equal(globalThis.__catalog.reads, 2);
});
