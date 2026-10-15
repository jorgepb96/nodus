// Verifies that a compute request which blows its timeout does not leave the
// worker thread spinning forever.
//
// The worker runs each request as one synchronous loop, so an overrunning job
// cannot be cancelled cooperatively and will never answer a message. Before the
// fix the host merely dropped its bookkeeping entry: the thread kept burning a
// core until the process exited, and every later request queued behind it.
//
// The assertion measures the actual harm — process CPU time — rather than any
// internal flag. process.cpuUsage() covers worker threads, so a live busy-loop
// is directly observable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-compute-'));
const bundle = path.join(dir, 'computeHost.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/graph/computeHost.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

// computeHost resolves its worker as `<dirname of the bundle>/computeWorker.js`.
// This stand-in reproduces the failure mode under test: a request that spins
// synchronously and never replies.
writeFileSync(
  path.join(dir, 'computeWorker.js'),
  `const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {
  // Synchronous, uninterruptible, never posts back — exactly what an
  // overrunning similarity pass looks like from the host's side.
  for (;;) { Math.sqrt(Math.random()); }
});
`
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Milliseconds of CPU (user+system) burned across all threads over `ms`. */
async function cpuBurnedOver(ms) {
  const before = process.cpuUsage();
  await wait(ms);
  const delta = process.cpuUsage(before);
  return (delta.user + delta.system) / 1000;
}

const require = createRequire(import.meta.url);

try {
  process.env.NODUS_COMPUTE_TIMEOUT_MS = '1200';
  const host = require(bundle);

  assert.ok(host.computeWorkerAvailable(), 'the stand-in worker should be picked up');

  const vectors = (n, tag) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${tag}-${i}`,
      vector: Float32Array.from({ length: 8 }, () => Math.random()),
    }));

  const centroids = vectors(4, 'c');
  const candidates = vectors(16, 'k');

  const started = Date.now();
  const resultPromise = host.computeThemeMatches(centroids, candidates, 0.0, 4);

  // --- Phase A: establish what a live spinning worker costs -----------------
  // Note both phases are measured the same way in the same process, and the
  // verdict is their RATIO. Absolute CPU-per-wall-window is not stable: the
  // suite runs test files in parallel, so under contention the worker gets a
  // smaller share of the core and an absolute threshold flakes. The ratio does
  // not care, because contention scales both measurements together.
  const burnedWhileSpinning = await cpuBurnedOver(600);
  assert.ok(
    burnedWhileSpinning > 20,
    `sanity: a spinning worker must burn measurable CPU (${burnedWhileSpinning.toFixed(0)}ms)`
  );

  // --- The request must still complete, via the chunked in-process path -----
  const matches = await resultPromise;
  const elapsed = Date.now() - started;
  assert.ok(Array.isArray(matches), 'caller must still receive results after a worker timeout');
  assert.ok(matches.length > 0, 'the inline fallback must produce real matches, not an empty list');
  assert.ok(elapsed >= 1200, `should not resolve before the timeout elapsed (took ${elapsed}ms)`);

  // --- Phase B: after the timeout, the thread must be gone ------------------
  await wait(300); // let terminate() land
  const burnedAfterTimeout = await cpuBurnedOver(600);
  const ratio = burnedAfterTimeout / burnedWhileSpinning;
  assert.ok(
    ratio < 0.25,
    `the abandoned worker must be terminated, but it is still burning CPU: ` +
      `${burnedAfterTimeout.toFixed(0)}ms after timeout vs ${burnedWhileSpinning.toFixed(0)}ms while ` +
      `spinning (${(ratio * 100).toFixed(0)}% — a terminated thread should be near zero)`
  );

  // --- After MAX_CONSECUTIVE_TIMEOUTS (2), requests stop queueing ------------
  // One timeout only replaces the worker: the next request gets a fresh thread,
  // which (this stand-in being a spinner) times out too. That second consecutive
  // timeout flips the host to the in-process path, so the third request must
  // return promptly instead of waiting behind a stuck thread.
  const second = await host.computeThemeMatches(centroids, candidates, 0.0, 4);
  assert.ok(Array.isArray(second) && second.length > 0, 'the follow-up request must still work');
  await wait(300);
  const thirdStart = Date.now();
  const third = await host.computeThemeMatches(centroids, candidates, 0.0, 4);
  const thirdElapsed = Date.now() - thirdStart;
  assert.ok(Array.isArray(third) && third.length > 0, 'a request after two timeouts must still work');
  assert.ok(
    thirdElapsed < 1200,
    `after two consecutive timeouts a request must not queue behind a worker (took ${thirdElapsed}ms)`
  );

  // --- And the process must stay quiet afterwards --------------------------
  const burnedAtRest = await cpuBurnedOver(400);
  assert.ok(
    burnedAtRest / burnedWhileSpinning < 0.25,
    `no thread should still be spinning at rest (${burnedAtRest.toFixed(0)}ms vs ` +
      `${burnedWhileSpinning.toFixed(0)}ms while spinning)`
  );

  console.log('# compute worker timeout tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
