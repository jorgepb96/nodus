// Drawing a signature with a finger on the trackpad: the mapping onto the canvas and the macOS addon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-sign-trackpad-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
buildSync({ entryPoints: ['src/sign/trackpad.ts'], outfile: path.join(temp, 'trackpad.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const { trackpadArea, trackpadPoint, followFinger, restingPen } = require(path.join(temp, 'trackpad.cjs'));
const macbook = { width: 142.67, height: 85.09 };

test('the whole trackpad lands on the canvas, to scale and centred, so nothing is cut off', () => {
  const area = trackpadArea(macbook);
  assert.equal(area.height, 300);
  assert.ok(Math.abs(area.width / area.height - macbook.width / macbook.height) < 1e-9);
  assert.ok(Math.abs(area.x * 2 + area.width - 900) < 1e-9);
  // Every corner of the trackpad is a point on the canvas, at the frame's corners.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
    const p = trackpadPoint({ x, y }, area);
    assert.ok(p.x >= 0 && p.x <= 900 && p.y >= 0 && p.y <= 300, `${x},${y}`);
  }
  assert.deepEqual(trackpadPoint({ x: 0, y: 1 }, area), { x: area.x, y: 0 });
  assert.deepEqual(trackpadPoint({ x: 1, y: 0 }, area), { x: area.x + area.width, y: 300 });
  // The same finger travel draws the same length across and down.
  const across = trackpadPoint({ x: 0.6, y: 0.5 }, area).x - trackpadPoint({ x: 0.5, y: 0.5 }, area).x;
  const down = trackpadPoint({ x: 0.5, y: 0.4 }, area).y - trackpadPoint({ x: 0.5, y: 0.5 }, area).y;
  assert.ok(Math.abs(across / (0.1 * macbook.width) - down / (0.1 * macbook.height)) < 1e-9);
  // Readings just past the edge stay on the frame.
  assert.deepEqual(trackpadPoint({ x: -0.02, y: 1.03 }, area), { x: area.x, y: 0 });
});

test('a surface wider than the canvas spans its width instead, and an unknown one is 16:10', () => {
  const wide = trackpadArea({ width: 400, height: 100 });
  assert.equal(wide.width, 900);
  assert.equal(wide.height, 225);
  assert.deepEqual(trackpadArea({ width: 0, height: 0 }), trackpadArea({ width: 160, height: 100 }));
});

const frame = (...contacts) => ({ device: 0, width: 142.67, height: 85.09, contacts: contacts.map(([id, x = 0.5, y = 0.5]) => ({ id, x, y })) });
function run(frames) {
  let pen = restingPen();
  const log = [];
  for (const f of frames) {
    const result = followFinger(pen, f);
    pen = result.pen;
    log.push(result.steps.map(s => s.kind === 'begin' || s.kind === 'extend' ? `${s.kind}:${s.contact.id}` : s.kind).join(','));
  }
  return log;
}

test('a stroke follows the finger that started it until that finger lifts', () => {
  assert.deepEqual(run([frame([1]), frame([1]), frame([1]), frame()]), ['begin:1', 'extend:1', 'extend:1', 'end']);
  // A palm or thumb landing mid-stroke neither ends nor hijacks it, and never draws afterwards.
  assert.deepEqual(run([frame([1]), frame([1], [2]), frame([1], [2]), frame([2]), frame([2]), frame()]),
    ['begin:1', 'extend:1', 'extend:1', 'end', 'none', 'none']);
  // A finger already resting does not stop a new finger from writing.
  assert.deepEqual(run([frame([1]), frame(), frame([3]), frame([3], [4]), frame([3]), frame([3], [5])]),
    ['begin:1', 'end', 'begin:3', 'extend:3', 'extend:3', 'extend:3']);
  // Lifting and touching again is a new contact, so a new stroke, never a joining line.
  assert.deepEqual(run([frame([7]), frame([7]), frame(), frame([8]), frame([8]), frame()]),
    ['begin:7', 'extend:7', 'end', 'begin:8', 'extend:8', 'end']);
  // The writing finger lifts while a new one lands in the same frame: the new one starts a stroke.
  assert.deepEqual(run([frame([1]), frame([2])]), ['begin:1', 'end,begin:2']);
});

test('the macOS addon starts and stops cleanly, with or without a trackpad', { skip: process.platform !== 'darwin' }, async () => {
  const { buildTrackpadNative } = require('./build-trackpad-native.cjs');
  const native = require(buildTrackpadNative());
  assert.throws(() => native.start(), /frame listener/);
  const surface = native.start(() => {});
  assert.ok(surface === null || (typeof surface.width === 'number' && typeof surface.height === 'number'));
  // CI runners have no trackpad: null, not a crash.
  if (surface) {
    assert.ok(surface.width > 50 && surface.width < 300, `width ${surface.width}`);
    assert.ok(surface.height > 30 && surface.height < 200, `height ${surface.height}`);
  }
  // Restarting replaces the listener; stopping twice is harmless.
  native.start(() => {});
  native.stop();
  native.stop();
});

test('packaging carries the addon to every macOS build', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.ok(pkg.build.mac.extraResources.some(r => r.to === 'trackpad-native/nodus-trackpad.node'));
  for (const script of ['predev', 'prebuild', 'prebuild:ci']) assert.match(pkg.scripts[script], /build-trackpad-native\.cjs/);
  assert.match(fs.readFileSync('build/beforePack.cjs', 'utf8'), /buildTrackpadNative/);
  assert.match(fs.readFileSync('build/afterPack.cjs', 'utf8'), /nodus-trackpad\.node/);
});
