import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// The evidence gather now runs one disconnection process per molecule, a few at a time, instead of
// one process working through them all in turn. The pool must keep the input order (the merged
// result is read in that order), never exceed its cap, and lose only a failing item, not the batch.
test('a bounded fan-out keeps order, respects its cap, and loses only what fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-each-bounded-'));
  try {
    await build({ entryPoints: ['electron/util/async.ts'], outfile: path.join(root, 'async.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const { eachBounded } = require(path.join(root, 'async.cjs'));
    let running = 0, peak = 0;
    const delays = [30, 5, 20, 1, 15, 8, 2];
    const out = await eachBounded(delays, 3, async (ms) => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      if (ms === 20) throw new Error('this molecule failed');
      return ms * 10;
    });
    assert.deepEqual(out, [300, 50, null, 10, 150, 80, 20], 'results in input order; the failure is null, the rest survive');
    assert.equal(peak, 3, 'never more than the cap at once');
    assert.deepEqual(await eachBounded([], 4, async () => 1), [], 'nothing to do is nothing');
    assert.deepEqual(await eachBounded([1, 2], 8, async (x) => x), [1, 2], 'a cap above the count is fine');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
