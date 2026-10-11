import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPlan, discoverTests, validatePlan, validateReports, fileConcurrency, e2eReservationMs, e2eShard, browserFixtures } from './ci-test-shards.mjs';
import { createBuildManifest, verifyBuildManifest } from './ci-build-artifact.mjs';
import { createNativeManifest, verifyNativeManifest } from './ci-native-artifact.mjs';
import { preparedComponentStyles } from './lib/component-test-styles.mjs';

const files = ['scripts/test-a.mjs', 'scripts/test-b.mjs', 'scripts/test-c.mjs', 'scripts/test-new.mjs'];
const commit = 'a'.repeat(40);
const plan = createPlan(files, commit, { 'scripts/test-a.mjs': 300_000 });
const clone = value => structuredClone(value);
const successfulReports = () => plan.shards.map(shard => ({
  schemaVersion: 1, commit, index: shard.index, assignedFiles: shard.files,
  success: true, elapsedMs: 10,
  completed: shard.files.map(file => ({ file, passed: true, durationMs: 5 })),
  summary: { success: true, counts: { tests: shard.files.length, passed: shard.files.length, failed: 0, cancelled: 0, skipped: 0, todo: 0 } },
  skips: [],
}));

test('all discovered files, including ones without duration hints, run exactly once', () => {
  validatePlan(plan, files, commit);
  assert.deepEqual(createPlan(files, commit, { 'scripts/test-a.mjs': 300_000 }), plan);
  assert.equal(plan.shards[0].files.length, 1, 'The heavy file receives its own group');
  validateReports(plan, successfulReports());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-discovery-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts/test-directory.mjs'), { recursive: true });
    for (const file of ['test-new.mjs', 'test-a.mjs', 'test-not-selected.js', 'e2e-smoke.mjs']) fs.writeFileSync(path.join(root, 'scripts', file), '');
    assert.deepEqual(discoverTests(root), ['scripts/test-a.mjs', 'scripts/test-new.mjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('the E2E group reserves real-app time without dropping or duplicating tests', () => {
  const inventory = Array.from({ length: 90 }, (_, index) => `scripts/test-fixture-${index}.mjs`);
  const durations = Object.fromEntries(inventory.map(file => [file, 30_000]));
  const planned = createPlan(inventory, commit, durations);
  validatePlan(planned, inventory, commit);
  const last = planned.shards.find(shard => shard.index === e2eShard);
  assert.ok(last.files.length < planned.shards[0].files.length);
  assert.equal(planned.shards.reduce((sum, shard) => sum + shard.estimatedMs, 0), 90 * 30_000 + fileConcurrency * e2eReservationMs);
  assert.ok(Math.max(...planned.shards.map(s => s.estimatedMs)) - Math.min(...planned.shards.map(s => s.estimatedMs)) <= 30_000);
  const small = createPlan(inventory.slice(0, 3), commit);
  validatePlan(small, inventory.slice(0, 3), commit);
  assert.ok(small.shards.every(shard => shard.files.length === 1));
});

test('missing, duplicate, stale and empty assignments cannot pass the inventory gate', () => {
  const missing = clone(plan); missing.shards[1].files.pop();
  assert.throws(() => validatePlan(missing, files, commit));
  const duplicate = clone(plan); duplicate.shards[1].files.push(duplicate.shards[0].files[0]);
  assert.throws(() => validatePlan(duplicate, files, commit), /more than once/);
  assert.throws(() => validatePlan(plan, [...files, 'scripts/test-added.mjs'], commit), /discovery changed/);
  assert.throws(() => validatePlan(plan, files, 'b'.repeat(40)), /different commit/);
  assert.throws(() => createPlan(files.slice(0, 2), commit), /contain tests/);
});

test('failed, cancelled, truncated, duplicate and cross-commit reports cannot turn the gate green', () => {
  assert.throws(() => validateReports(plan, successfulReports().slice(1)), /Missing shard report/);
  for (const mutate of [
    r => { r[0].success = false; },
    r => { r[0].completed = []; },
    r => { r[0].completed[0].passed = false; },
    r => { r[0].completed.push(r[0].completed[0]); },
    r => { r[0].commit = 'b'.repeat(40); },
    r => { r[0].summary.counts.failed = 1; },
    r => { r[0].summary.counts.cancelled = 1; },
    r => { r[0].summary = undefined; },
    r => { r[1].index = r[0].index; },
  ]) {
    const reports = successfulReports(); mutate(reports);
    assert.throws(() => validateReports(plan, reports));
  }
});

test('a new skip, unavailable browser, or unreported skipped check fails the gate', () => {
  const reports = successfulReports();
  reports[0].summary.counts.skipped = 1;
  assert.throws(() => validateReports(plan, reports), /Unaccounted skipped/);
  reports[0].skips = [{ file: files[0], name: 'browser coverage', reason: 'Chrome/Chromium not installed' }];
  assert.throws(() => validateReports(plan, reports), /New skipped check/);
});

test('only the two existing baseline skip reasons are accepted', () => {
  const reports = successfulReports();
  reports[0].summary.counts.skipped = 1;
  reports[0].skips = [{ file: 'scripts/test-skill-glyph.mjs', name: 'every published skill has an icon the application can draw', reason: 'no marketplace checkout beside this one; set NODUS_MARKETPLACE_DIR' }];
  validateReports(plan, reports);
  reports[0].skips[0].reason = 'another failure';
  assert.throws(() => validateReports(plan, reports), /New skipped check/);
});

test('real child processes report every file, propagate assertion failures, and reject new skips', { timeout: 30_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-runner-'));
  const script = fileURLToPath(new URL('./ci-test-shards.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const execute = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, files[0]), "import test from 'node:test'; test('node:test case', () => {});\n");
    fs.writeFileSync(path.join(root, files[1]), "import assert from 'node:assert/strict'; assert.equal(1, 1);\n");
    fs.writeFileSync(path.join(root, files[2]), "import test from 'node:test'; test('second case', () => {});\n");
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=CI Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    const planned = execute('plan'); assert.equal(planned.status, 0, planned.stderr);
    for (const index of [1, 2, 3]) {
      const result = execute('run', String(index)); assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const passed = execute('verify'); assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /All 3 test files completed exactly once/);
    const storedPlan = JSON.parse(fs.readFileSync(path.join(root, '.ci/plan.json'), 'utf8'));
    const group = storedPlan.shards.find(s => s.files.includes(files[0])).index;
    fs.writeFileSync(path.join(root, files[0]), "import test from 'node:test';test('fails',()=>{throw new Error('injected assertion failure')});\n");
    assert.notEqual(execute('run', String(group)).status, 0);
    assert.notEqual(execute('verify').status, 0);
    fs.writeFileSync(path.join(root, files[0]), "import test from 'node:test';test('skips',(t)=>t.skip('missing browser'));\n");
    assert.notEqual(execute('run', String(group)).status, 0);
    fs.writeFileSync(path.join(root, files[0]), "process.exit(3);\n");
    assert.notEqual(execute('run', String(group)).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('browser phases serialize processes and retain failures/skips when a later phase passes', { timeout: 30_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-phases-'));
  const script = fileURLToPath(new URL('./ci-test-shards.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const execute = () => spawnSync(process.execPath, [script, 'run', '1'], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  const names = ['scripts/test-browser-a.mjs', 'scripts/test-browser-b.mjs', 'scripts/test-plain.mjs', 'scripts/test-c.mjs', 'scripts/test-d.mjs'];
  const browserSource = "import { chromium } from 'playwright-core'; import test from 'node:test'; import fs from 'node:fs'; import assert from 'node:assert/strict'; import { setTimeout } from 'node:timers/promises'; test('browser fixture', async () => { assert.ok(chromium); const lock = fs.openSync('browser.lock', 'wx'); try { await setTimeout(30); } finally { fs.closeSync(lock); fs.unlinkSync('browser.lock'); } });\n";
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'node_modules/playwright-core'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/playwright-core/package.json'), '{"type":"module","exports":"./index.mjs"}');
    fs.writeFileSync(path.join(root, 'node_modules/playwright-core/index.mjs'), 'export const chromium = {};');
    for (const name of names) fs.writeFileSync(path.join(root, name), name.includes('browser') ? browserSource : "import assert from 'node:assert/strict'; assert.equal(1, 1);\n");
    const browsers = browserFixtures(root, names);
    assert.deepEqual(browsers, names.slice(0, 2));
    const weighted = createPlan(names, commit, Object.fromEntries(names.map(name => [name, 1000])), 3, browsers);
    assert.equal(weighted.shards.reduce((sum, shard) => sum + shard.estimatedMs, 0), 7000 + fileConcurrency * e2eReservationMs);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=CI Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const planned = { schemaVersion: 1, commit: head, files: [...names].sort(), shards: [
      { index: 1, files: names.slice(0, 3) }, { index: 2, files: [names[3]] }, { index: 3, files: [names[4]] },
    ] };
    fs.mkdirSync(path.join(root, '.ci'));
    fs.writeFileSync(path.join(root, '.ci/plan.json'), JSON.stringify(planned));
    const result = execute(); assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = () => JSON.parse(fs.readFileSync(path.join(root, '.ci/reports/shard-1.json'), 'utf8'));
    const passed = report();
    assert.deepEqual(passed.phases.map(phase => [phase.name, phase.concurrency, phase.files.length]), [['browser', 1, 2], ['other', 2, 1]]);
    assert.equal(passed.summary.counts.tests, 3);
    assert.equal(passed.summary.counts.passed, 3);
    assert.equal(passed.completed.length, 3);
    for (const body of ["throw new Error('injected browser-phase failure')", "t.skip('new browser-phase skip')"]) {
      fs.writeFileSync(path.join(root, names[0]), "import { chromium } from 'playwright-core'; import test from 'node:test'; test('first phase', t => { " + body + "; });\n");
      assert.notEqual(execute().status, 0);
      const failed = report();
      assert.equal(failed.success, false);
      assert.equal(failed.summary.counts.tests, 3);
      assert.equal(failed.completed.length, 3, 'Later phases still execute after a failure or skip');
      assert.ok(failed.completed.find(file => file.file === names[2]).passed);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build transfer rejects missing outputs, corruption and another commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-build-'));
  try {
    for (const file of ['dist/index.html', 'dist-electron/main.js', 'server/dist/web/index.html', 'cloudflare/dist/worker.mjs',
      'cloudflare/src/generated/mutableTables.mjs', 'server/lib/core/generatedMutableTables.mjs', 'electron/serverSync/generatedMutableTables.ts', '.ci/component-styles.css']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), file);
    }
    const manifest = createBuildManifest(root, commit);
    verifyBuildManifest(root, commit, manifest);
    fs.appendFileSync(path.join(root, 'electron/serverSync/generatedMutableTables.ts'), '\nchanged generator output');
    assert.throws(() => verifyBuildManifest(root, commit, manifest), /hash mismatch/);
    fs.writeFileSync(path.join(root, 'electron/serverSync/generatedMutableTables.ts'), 'electron/serverSync/generatedMutableTables.ts');
    fs.appendFileSync(path.join(root, '.ci/component-styles.css'), '\nchanged styles');
    assert.throws(() => verifyBuildManifest(root, commit, manifest), /hash mismatch/);
    fs.writeFileSync(path.join(root, '.ci/component-styles.css'), '.ci/component-styles.css');
    assert.throws(() => verifyBuildManifest(root, 'b'.repeat(40), manifest), /different commit/);
    fs.appendFileSync(path.join(root, 'dist-electron/main.js'), '\ncorrupted');
    assert.throws(() => verifyBuildManifest(root, commit, manifest), /hash mismatch/);
    fs.rmSync(path.join(root, 'dist/index.html'));
    assert.throws(() => createBuildManifest(root, commit), /output missing/);
    const unsafe = clone(manifest); unsafe.files['../outside'] = 'hash';
    fs.writeFileSync(path.join(root, 'dist/index.html'), 'dist/index.html');
    fs.writeFileSync(path.join(root, 'dist-electron/main.js'), 'dist-electron/main.js');
    assert.throws(() => verifyBuildManifest(root, commit, unsafe), /Invalid artifact path/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('prepared component styles fail closed instead of falling back to a temp cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-styles-'));
  const file = path.join(root, 'styles.css');
  try {
    assert.throws(() => preparedComponentStyles(file), /ENOENT/);
    fs.writeFileSync(file, '');
    assert.throws(() => preparedComponentStyles(file), /empty or invalid/);
    assert.throws(() => preparedComponentStyles(root), /empty or invalid/);
    fs.writeFileSync(file, '.text-green-700{color:green}');
    assert.equal(preparedComponentStyles(file), file);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native transfer rejects ABI/runtime drift, incomplete inventory and corruption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ci-native-'));
  const runtime = { commit, lockHash: 'locked', platform: 'darwin', arch: 'arm64', node: '22.23.2', electron: '43.4.0', abi: '148' };
  const marker = 'node_modules/better-sqlite3/build/Release/.forge-meta';
  const binary = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
  try {
    fs.mkdirSync(path.dirname(path.join(root, marker)), { recursive: true });
    fs.writeFileSync(path.join(root, marker), 'arm64--148');
    fs.writeFileSync(path.join(root, binary), 'rebuilt SQLite');
    fs.writeFileSync(path.join(root, 'node_modules/better-sqlite3/package.json'), '{"version":"12.11.1"}');
    const manifest = createNativeManifest(root, runtime);
    verifyNativeManifest(root, runtime, manifest);
    for (const key of ['commit', 'lockHash', 'platform', 'arch', 'node', 'electron', 'abi']) {
      assert.throws(() => verifyNativeManifest(root, { ...runtime, [key]: 'different' }, manifest), /runtime mismatch/);
    }
    const incomplete = clone(manifest); delete incomplete.files[binary];
    assert.throws(() => verifyNativeManifest(root, runtime, incomplete), /Incomplete native rebuild/);
    const unsafe = clone(manifest); unsafe.files['node_modules/../outside'] = 'hash';
    assert.throws(() => verifyNativeManifest(root, runtime, unsafe), /Invalid native artifact path/);
    fs.appendFileSync(path.join(root, binary), 'corrupt');
    assert.throws(() => verifyNativeManifest(root, runtime, manifest), /Native hash mismatch/);
    fs.writeFileSync(path.join(root, marker), 'x64--148');
    assert.throws(() => createNativeManifest(root, runtime), /ABI mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
