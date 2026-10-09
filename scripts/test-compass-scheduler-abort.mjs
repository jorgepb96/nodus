// A cancelled Compass request is not a provider failure: three cancels must not open the
// provider's circuit and refuse the next real search.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('aborted requests do not count toward the provider circuit', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-compass-abort-'));
  try {
    const outfile = path.join(tmp, 'scheduler.mjs');
    await build({ entryPoints: [path.join(root, 'electron/compass/compassRequestScheduler.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron', 'better-sqlite3'] });
    const { CompassRequestScheduler } = await import(pathToFileURL(outfile).href);
    const saved = new Map();
    const store = { getProviderUsage: (p) => saved.has(p) ? structuredClone(saved.get(p)) : null, saveProviderUsage: (u) => saved.set(u.provider, structuredClone(u)) };
    const scheduler = new CompassRequestScheduler(store);
    const slow = (signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ provider: 'crossref', records: [] }), 5000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
    });
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const pending = scheduler.schedule({ provider: 'crossref', searchId: `s${i}`, strategy: 'balanced', fingerprint: `f${i}`, filters: {}, signal: controller.signal, run: slow });
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(saved.get('crossref').consecutiveFailures, 0);
    assert.equal(saved.get('crossref').circuitUntil, undefined);
    const page = await scheduler.schedule({ provider: 'crossref', searchId: 'real', strategy: 'balanced', fingerprint: 'fresh', filters: {}, signal: new AbortController().signal, run: async () => ({ provider: 'crossref', records: ['hit'] }) });
    assert.deepEqual(page.records, ['hit']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
