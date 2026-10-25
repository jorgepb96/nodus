import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-vault-cache-'));
try {
  const outfile = path.join(temp, 'cache.mjs');
  await build({ entryPoints: [path.join(root, 'src/vaultQueryCache.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  const cache = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

  cache.setActiveVaultQueryScope('vault-a');
  cache.setVaultQueryCache('vault-a', 'home', { works: 12 });
  assert.deepEqual(cache.getVaultQueryCache('vault-a', 'home'), { works: 12 });
  assert.equal(cache.getVaultQueryCache('vault-b', 'home'), undefined, 'cache values must never cross vaults');
  assert.equal(cache.getVaultQueryRevision('vault-a'), 0);
  assert.equal(cache.invalidateVaultQueryCache(), 1, 'active-vault invalidation increments its revision');
  assert.equal(cache.getVaultQueryCache('vault-a', 'home'), undefined, 'old-revision values must be discarded');
  cache.setVaultQueryCache('vault-b', 'home', { works: 3 });
  cache.invalidateVaultQueryCache('vault-a');
  assert.deepEqual(cache.getVaultQueryCache('vault-b', 'home'), { works: 3 }, 'invalidating one vault must preserve the others');

  for (let i = 0; i < 60; i += 1) cache.setVaultQueryCache('vault-a', `page-${i}`, i);
  assert.equal(cache.getVaultQueryCache('vault-a', 'page-0'), undefined, 'per-vault cache must evict old pages');
  assert.equal(cache.getVaultQueryCache('vault-a', 'page-59'), 59);

  const [hooks, app, home, library, ideas] = await Promise.all([
    readFile(path.join(root, 'src/hooks.ts'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/HomeView.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/Library.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/IdeasView.tsx'), 'utf8'),
  ]);
  assert.match(hooks, /notifyDataChanged[\s\S]*?invalidateVaultQueryCache\(\)/, 'explicit data changes must invalidate cache');
  assert.match(hooks, /!active && \(prevActive \|\| newlyFinished\)[\s\S]*?invalidateVaultQueryCache\(\)/, 'completed scans, including single-event cached jobs, must invalidate cache');
  assert.match(app, /setActiveVaultQueryScope\(activeVault\?\.id/, 'cache scope must follow the active vault');
  for (const [name, source] of [['Home', home], ['Library', library], ['Ideas', ideas]]) {
    assert.match(source, /getVaultQueryCache/, `${name} must reuse a valid cached query`);
    assert.match(source, /setVaultQueryCache/, `${name} must populate the vault cache`);
  }
  assert.match(ideas, /const initialListLoad = useRef\(true\)/, 'Ideas must track the first list request of each visit');
  assert.match(
    ideas,
    /const force = initialListLoad\.current;[\s\S]*?initialListLoad\.current = false;[\s\S]*?reload\(force\)/,
    'entering Ideas must bypass a stale cached list before later requests may reuse it',
  );
  console.log('Vault query cache tests passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
