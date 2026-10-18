import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'embeddinggemma-process-parity.mjs');
test('EmbeddingGemma parity runner defaults to a no-root, no-Electron dry run', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.createsRoot, false); assert.equal(plan.launchesElectron, false); assert.equal(plan.startsInference, false);
  assert.deepEqual(plan.profiles, ['embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1']);
  assert.equal(plan.fixtureRows, 7);
  assert(plan.approvedOwnedAssetCaches.every(cache => cache.root.startsWith('/private/tmp/nodus-research-')));
});
