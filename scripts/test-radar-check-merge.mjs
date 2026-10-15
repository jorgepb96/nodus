// A Radar check awaits the network for every follow. Whatever the user changes meanwhile
// must survive the check writing its results.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-radar-merge-'));
process.env.NODUS_TEST_USERDATA = path.join(temp, 'profile');
test.after(() => rm(temp, { recursive: true, force: true }));
const bundle = path.join(temp, 'radar.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'electron/radar/radarService.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', '--log-level=error',
  `--alias:electron=${path.join(root, 'scripts/stub-electron.mjs')}`, `--outfile=${bundle}`,
], { cwd: root });
const { RadarService } = createRequire(import.meta.url)(bundle);

function gated() {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  return { release, provider: async (follow) => { await gate; return [{ source: 'OpenAlex', externalId: `x-${follow.value}`, title: 'found', authors: '', summary: '', url: 'https://example.org/x' }]; } };
}

test('a follow added during a check is kept', async () => {
  const { release, provider } = gated();
  const radar = new RadarService({ storeFile: path.join(temp, 'a.json'), fixtureProvider: provider });
  radar.createFollow({ type: 'topic', value: 'first', cadence: 'daily' });
  const running = radar.check({ reason: 'manual' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  radar.createFollow({ type: 'topic', value: 'added during check', cadence: 'daily' });
  release();
  const result = await running;
  assert.deepEqual(radar.snapshot().follows.map((f) => f.value).sort(), ['added during check', 'first']);
  assert.equal(result.newItems, 1);
  const first = radar.snapshot().follows.find((f) => f.value === 'first');
  assert.equal(first.updateCount, 1);
  assert.ok(first.lastCheckedAt);
  assert.equal(radar.snapshot().checking, false);
});

test('a follow removed during a check stays removed, with no orphan updates', async () => {
  const { release, provider } = gated();
  const radar = new RadarService({ storeFile: path.join(temp, 'b.json'), fixtureProvider: provider });
  const follow = radar.createFollow({ type: 'topic', value: 'A', cadence: 'daily' });
  const running = radar.check({});
  await new Promise((resolve) => setTimeout(resolve, 10));
  radar.removeFollow(follow.id);
  release();
  await running;
  assert.deepEqual(radar.snapshot().follows, []);
  assert.equal(radar.snapshot().updates.filter((u) => u.followId === follow.id).length, 0);
});
