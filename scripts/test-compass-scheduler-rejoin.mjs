// Cancelling a Compass search and immediately running the same one again must not attach
// the new run to the request that was just aborted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a new request does not join an aborted in-flight request', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-compass-rejoin-'));
  try {
    const outfile = path.join(tmp, 'scheduler.mjs');
    await build({ entryPoints: [path.join(root, 'electron/compass/compassRequestScheduler.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron', 'better-sqlite3'] });
    const { CompassRequestScheduler } = await import(pathToFileURL(outfile).href);
    const saved = new Map();
    const store = { getProviderUsage: (p) => saved.has(p) ? structuredClone(saved.get(p)) : null, saveProviderUsage: (u) => saved.set(u.provider, structuredClone(u)) };
    const scheduler = new CompassRequestScheduler(store);
    const first = new AbortController();
    // The provider takes a moment to notice the abort, as a real fetch does.
    const pending = scheduler.schedule({ provider: 'doaj', searchId: 'a', strategy: 'balanced', fingerprint: 'same', filters: {}, signal: first.signal,
      run: (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 5))) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    first.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    const second = new AbortController();
    const page = await scheduler.schedule({ provider: 'doaj', searchId: 'b', strategy: 'balanced', fingerprint: 'same', filters: {}, signal: second.signal,
      run: async () => ({ provider: 'doaj', records: ['fresh'] }) });
    assert.deepEqual(page.records, ['fresh']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
