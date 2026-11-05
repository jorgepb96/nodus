import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Queue contracts only: no network, provider, image fixture or E2E approval.
const result = await build({entryPoints: ['src/components/decorativeImageLoad.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false});
const {readDecorativeImage} = await import('data:text/javascript;base64,' +
  Buffer.from(result.outputFiles[0].text).toString('base64'));
let running = 0, peak = 0, completed = 0, cancelledRead = false;
const releases = [];
const first = Array.from({length: 3}, (_, i) => readDecorativeImage(async () => {
  running += 1; peak = Math.max(peak, running);
  await new Promise(resolve => releases.push(resolve)); running -= 1;
  if (i === 1) throw new Error('unreachable cover');
  completed += 1; return i;
}, () => true));
const closed = readDecorativeImage(async () => { cancelledRead = true; return -1; }, () => false);
const rest = Array.from({length: 20}, (_, i) => readDecorativeImage(async () => {
  running += 1; peak = Math.max(peak, running);
  await Promise.resolve(); running -= 1; completed += 1; return i + 3;
}, () => true));
assert.equal(releases.length, 3); releases.forEach(release => release());
const outcomes = await Promise.allSettled([...first, closed, ...rest]);
assert.equal(peak, 3); assert.equal(completed, 22); assert.equal(cancelledRead, false);
assert.equal(outcomes[1].status, 'rejected'); assert.equal(outcomes[3].value, null);
assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 23);
assert.equal(await readDecorativeImage(async () => 42, () => true), 42);
console.log('Cover queue contracts passed: bounded concurrency, rejected read, unmounted waiter and retry.');
