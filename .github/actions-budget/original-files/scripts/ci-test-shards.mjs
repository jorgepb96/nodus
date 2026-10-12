// CI-only orchestration. Discover the same files as npm test; never filter by
// changed paths. Every file keeps Node's process isolation and its Electron ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { pipeline } from 'node:stream/promises';

export const shardCount = 3;
export const fileConcurrency = 2;
export const e2eShard = 3;
// Reserve five minutes of real-app work in the last group. At two file
// processes per runner, this is ten minutes in the placement weight.
export const e2eReservationMs = 300_000;
const allowedSkips = new Map([
  ['CompassStore persists pagination, selections, saved/dismissed records and bounded cache state', 'better-sqlite3 native addon requires the Electron ABI'],
  ['every published skill has an icon the application can draw', 'no marketplace checkout beside this one; set NODUS_MARKETPLACE_DIR'],
]);
export const commitAt = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
export const discoverTests = (root) => fs.readdirSync(path.join(root, 'scripts'), { withFileTypes: true })
  .filter(entry => entry.isFile() && /^test-.*\.mjs$/.test(entry.name))
  .map(entry => `scripts/${entry.name}`).sort();
export const browserFixtures = (root, files) => files.filter(file =>
  /^\s*import\s+[^;]*?\bfrom\s*(['"])playwright(?:-core)?\1/m.test(fs.readFileSync(path.join(root, file), 'utf8')));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

export function createPlan(files, commit, durations = {}, count = shardCount, browsers = []) {
  assert.ok(Number.isInteger(count) && count > 0 && files.length >= count, 'Every shard must contain tests');
  assert.equal(new Set(files).size, files.length, 'Duplicate test discovery');
  const browserSet = new Set(browsers);
  const weight = file => (Number.isFinite(durations[file]) && durations[file] > 0 ? durations[file] : 1000)
    * (browserSet.has(file) ? fileConcurrency : 1);
  const shards = Array.from({ length: count }, (_, index) => ({ index: index + 1, files: [], estimatedMs: index + 1 === e2eShard ? fileConcurrency * e2eReservationMs : 0 }));
  // Longest files first, on the lightest group. Hints only affect placement;
  // unknown/new files always run and actual process durations are reported.
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    // Seed every group before balancing, including small regression fixtures.
    const empty = shards.filter(shard => shard.files.length === 0);
    const shard = [...(empty.length ? empty : shards)].sort((a, b) => a.estimatedMs - b.estimatedMs || a.index - b.index)[0];
    shard.files.push(file);
    shard.estimatedMs += weight(file);
  }
  return { schemaVersion: 1, commit, files: [...files].sort(), shards };
}

export function validatePlan(plan, files, commit) {
  assert.equal(plan.schemaVersion, 1, 'Unsupported plan');
  assert.equal(plan.commit, commit, 'Plan belongs to a different commit');
  assert.deepEqual(plan.files, [...files].sort(), 'Test discovery changed');
  assert.equal(plan.shards.length, shardCount, 'Missing shard');
  assert.deepEqual(plan.shards.map(s => s.index).sort(), [1, 2, 3], 'Duplicate shard index');
  const assigned = plan.shards.flatMap(shard => {
    assert.ok(shard.files.length > 0, 'Empty shard');
    return shard.files;
  });
  assert.equal(new Set(assigned).size, assigned.length, 'A test file is assigned more than once');
  assert.deepEqual(assigned.sort(), [...files].sort(), 'A test file was omitted');
}

export function validateReports(plan, reports) {
  assert.equal(reports.length, plan.shards.length, 'Missing shard report');
  assert.equal(new Set(reports.map(r => r.index)).size, reports.length, 'Duplicate shard report');
  for (const shard of plan.shards) {
    const report = reports.find(r => r.index === shard.index);
    assert.ok(report, `Missing report for shard ${shard.index}`);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.commit, plan.commit, 'Report belongs to a different commit');
    assert.equal(report.success, true, `Shard ${shard.index} did not succeed`);
    assert.deepEqual([...report.assignedFiles].sort(), [...shard.files].sort(), 'Assigned inventory differs');
    assert.deepEqual(report.completed.map(r => r.file).sort(), [...shard.files].sort(), 'Incomplete/duplicate execution');
    assert.ok(report.completed.every(r => r.passed === true && Number.isFinite(r.durationMs)), 'A file did not pass');
    assert.ok(report.summary?.success && report.summary.counts.tests > 0, 'Missing successful runner summary');
    assert.equal(report.summary.counts.failed, 0);
    assert.equal(report.summary.counts.cancelled, 0);
    assert.equal(report.summary.counts.todo, 0);
    assert.equal(report.summary.counts.skipped, report.skips.length, 'Unaccounted skipped tests');
    for (const skip of report.skips) {
      assert.equal(allowedSkips.get(skip.name), skip.reason, `New skipped check: ${skip.file}: ${skip.name}`);
    }
  }
}

export async function executeShard(plan, index, root, destination, output = process.stdout) {
  const shard = plan.shards.find(s => s.index === index);
  assert.ok(shard, `Unknown shard ${index}`);
  const selected = new Map(shard.files.map(file => [path.resolve(root, file), file]));
  const report = { schemaVersion: 1, commit: plan.commit, index, assignedFiles: shard.files, completed: [], skips: [], success: false };
  const started = Date.now();
  const browsers = new Set(browserFixtures(root, shard.files));
  const phases = [
    { name: 'browser', concurrency: 1, files: shard.files.filter(file => browsers.has(file)) },
    { name: 'other', concurrency: fileConcurrency, files: shard.files.filter(file => !browsers.has(file)) },
  ].filter(phase => phase.files.length);
  report.phases = phases;
  try {
    for (const phase of phases) {
      const stream = run({ files: phase.files.map(file => path.resolve(root, file)), concurrency: phase.concurrency });
      stream.on('test:complete', data => {
        // These are the runner's file-process completions, including scripts that
        // use plain assertions or re-exec under Electron instead of node:test.
        if (selected.has(data.file) && path.resolve(root, data.name) === data.file) {
          report.completed.push({ file: selected.get(data.file), passed: data.details.passed, durationMs: data.details.duration_ms });
        }
      });
      stream.on('test:pass', data => {
        if (data.skip) report.skips.push({ file: path.relative(root, data.file), name: data.name, reason: data.skip });
      });
      stream.on('test:summary', data => {
        if (data.file) return;
        report.summary ??= { success: true, counts: {}, duration_ms: 0 };
        report.summary.success &&= data.success;
        report.summary.duration_ms += data.duration_ms;
        for (const [key, value] of Object.entries(data.counts)) report.summary.counts[key] = (report.summary.counts[key] ?? 0) + value;
      });
      await pipeline(stream.compose(tap), output, { end: false });
    }
    report.elapsedMs = Date.now() - started;
    report.success = Boolean(report.summary?.success) && report.completed.length === shard.files.length
      && report.completed.every(file => file.passed) && report.summary.counts.todo === 0
      && report.summary.counts.skipped === report.skips.length
      && report.skips.every(skip => allowedSkips.get(skip.name) === skip.reason);
  } finally {
    writeJson(destination, report);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const planFile = path.join(root, '.ci/plan.json');
  const command = process.argv[2];
  if (command === 'plan') {
    const hints = JSON.parse(fs.readFileSync(new URL('./ci-test-durations.json', import.meta.url), 'utf8'));
    const files = discoverTests(root);
    const plan = createPlan(files, commitAt(root), hints.files, shardCount, browserFixtures(root, files));
    validatePlan(plan, discoverTests(root), commitAt(root));
    writeJson(planFile, plan);
    console.log(JSON.stringify({ files: plan.files.length, shards: plan.shards.map(s => ({ index: s.index, files: s.files.length, estimatedMs: s.estimatedMs })) }));
  } else if (command === 'run' || command === 'verify') {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    validatePlan(plan, discoverTests(root), commitAt(root));
    if (command === 'run') {
      const index = Number(process.argv[3]);
      const report = await executeShard(plan, index, root, path.join(root, `.ci/reports/shard-${index}.json`));
      if (!report.success) process.exitCode = 1;
    } else {
      const reports = fs.readdirSync(path.join(root, '.ci/reports')).filter(f => /^shard-\d+\.json$/.test(f))
        .map(file => JSON.parse(fs.readFileSync(path.join(root, '.ci/reports', file), 'utf8')));
      validateReports(plan, reports);
      const counts = Object.fromEntries(['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].map(key =>
        [key, reports.reduce((sum, report) => sum + report.summary.counts[key], 0)]));
      const summary = `All ${plan.files.length} test files completed exactly once.\n\n${JSON.stringify(counts)}\n\n`
        + '| Group | Files | Execution |\n| --- | ---: | ---: |\n'
        + reports.map(r => `| ${r.index} | ${r.completed.length} | ${(r.elapsedMs / 60000).toFixed(2)} min |`).join('\n') + '\n';
      console.log(summary);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
  } else throw new Error('Usage: node scripts/ci-test-shards.mjs plan|run INDEX|verify');
}
