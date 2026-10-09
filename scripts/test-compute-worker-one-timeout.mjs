// One compute-worker timeout must not disable the worker for the rest of the session: the
// host allows MAX_CONSECUTIVE_TIMEOUTS (2) before giving up, and a fresh worker serves the
// next request.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-compute-one-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const bundle = path.join(dir, 'computeHost.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'electron/graph/computeHost.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', '--log-level=error', `--outfile=${bundle}`,
], { cwd: repoRoot });
// The first worker ever started spins on its request; any later worker answers with a marker
// the inline fallback can never produce.
const marker = path.join(dir, 'spun-once');
writeFileSync(path.join(dir, 'computeWorker.js'), `
const fs = require('node:fs');
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (msg) => {
  if (!fs.existsSync(${JSON.stringify(marker)})) { fs.writeFileSync(${JSON.stringify(marker)}, '1'); for (;;) { Math.sqrt(Math.random()); } }
  parentPort.postMessage({ id: msg.id, ok: true, matches: [{ centroidId: 'from-worker', candidateId: 'from-worker', score: 1 }] });
  // A clean exit (code 0) so the test process can finish; it does not mark the host broken.
  setImmediate(() => process.exit(0));
});
`);

test('after one timeout, the next request is served by a fresh worker', async () => {
  process.env.NODUS_COMPUTE_TIMEOUT_MS = '500';
  const host = createRequire(import.meta.url)(bundle);
  const vectors = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, vector: Float32Array.from({ length: 8 }, () => Math.random()) }));
  const centroids = vectors(2, 'c'), candidates = vectors(6, 'k');
  const first = await host.computeThemeMatches(centroids, candidates, 0, 2);
  assert.ok(first.length > 0 && first[0].centroidId !== 'from-worker', 'the timed-out request fell back inline');
  await new Promise((resolve) => setTimeout(resolve, 200)); // let terminate() and its exit event land
  assert.equal(host.computeWorkerAvailable(), true, 'one timeout must not mark the worker broken');
  const second = await host.computeThemeMatches(centroids, candidates, 0, 2);
  assert.equal(second[0]?.centroidId, 'from-worker', 'served by the worker, not the inline fallback');
});
