import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { shardCount } from './ci-test-shards.mjs';

const read = file => load(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release-build.yml');
const setup = read('.github/actions/ci-linux/action.yml');

test('all test groups and real-app checks can start together after the single build', () => {
  for (const lane of ['unit', 'e2e']) {
    assert.deepEqual(ci.jobs[lane].needs, ['changes', 'linux']);
    assert.equal(ci.jobs[lane]['runs-on'], ci.jobs.linux['runs-on'], 'native artifacts require identical hosts');
    assert.equal(ci.jobs[lane].if, "needs.changes.outputs.full == 'true'");
  }
  assert.deepEqual(ci.jobs.unit.strategy.matrix.shard, Array.from({ length: shardCount }, (_, i) => i + 1));
  assert.equal(ci.jobs.unit.strategy['fail-fast'], false, 'one failure must not cancel other groups');
  assert.ok(ci.jobs.test.needs.includes('unit') && ci.jobs.test.needs.includes('e2e'));
  assert.equal(ci.jobs.test.if, 'always()', 'skipped or failed prerequisites must still reach the gate');
  const commands = ci.jobs.e2e.steps.map(step => step.run || '').join('\n');
  for (const command of ['test:e2e', 'test:e2e:backups', 'test:e2e:stellar', 'test:e2e:stellar-tabs',
    'test:e2e:argument-map', 'verify:cross-repo', 'verify:capability-packages', 'verify:capability-migration',
    'scripts/verify-appimage-updates.mjs', 'scripts/verify-presenter-lan.cjs', 'scripts/ci-native-checks.mjs research --no-synthetic']) {
    assert.ok(commands.includes(command), `Lost real-app coverage: ${command}`);
  }
});

test('parallel consumers restore an immutable build, identical runtime and pinned marketplace', () => {
  for (const lane of ['unit', 'e2e']) {
    const checkout = ci.jobs[lane].steps.find(step => step.uses === 'actions/checkout@v7');
    assert.equal(checkout.with.ref, '${{ inputs.ref || github.ref }}');
    assert.equal(checkout.with['persist-credentials'], false);
    const restore = ci.jobs[lane].steps.find(step => step.uses === './.github/actions/ci-linux');
    assert.deepEqual(restore.with, {
      'artifact-id': '${{ needs.linux.outputs.artifact_id }}',
      'node-version': '${{ needs.linux.outputs.node_version }}',
      'marketplace-ref': '${{ needs.linux.outputs.marketplace_ref }}',
    });
  }
  const download = setup.runs.steps.find(step => step.uses === 'actions/download-artifact@v8');
  assert.equal(download.with['artifact-ids'], '${{ inputs.artifact-id }}');
  assert.equal(download.with['run-id'], undefined, 'cannot borrow builds from another run');
  assert.equal(setup.runs.steps.find(step => step.uses === 'actions/setup-node@v7').with['node-version'], '${{ inputs.node-version }}');
  assert.equal(setup.runs.steps.find(step => step.uses === 'actions/checkout@v7').with.ref, '${{ inputs.marketplace-ref }}');
  const commands = setup.runs.steps.map(step => step.run || '').join('\n');
  assert.ok(commands.includes('node scripts/ci-build-artifact.mjs verify'));
  assert.ok(commands.includes('node scripts/ci-native-artifact.mjs verify'));
  assert.ok(commands.includes('sudo chmod 4755 node_modules/electron/dist/chrome-sandbox'));
});

test('failed-job reruns replace only their report and the gate checks the full merged inventory', () => {
  const upload = ci.jobs.unit.steps.find(step => step.uses === 'actions/upload-artifact@v7');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'ci-tests-${{ matrix.shard }}');
  assert.equal(upload.with.overwrite, true);
  assert.equal(upload.with['if-no-files-found'], 'error');
  const gate = ci.jobs.test.steps;
  const reports = gate.find(step => step.with?.pattern === 'ci-tests-*');
  assert.equal(reports.with['merge-multiple'], true);
  assert.equal(reports.with.path, '.ci/reports');
  const plan = gate.find(step => step.with?.['artifact-ids']);
  assert.equal(plan.with['artifact-ids'], '${{ needs.linux.outputs.plan_artifact_id }}');
  assert.ok(gate.some(step => step.run === 'node scripts/ci-test-shards.mjs verify'));
});

test('stable and beta packaging overlap CI, but publication rejects every incomplete prerequisite', () => {
  assert.equal(release.jobs['prepare-release'].needs, 'validate-release');
  assert.equal(release.jobs['quality-gate'].needs, 'validate-release');
  assert.equal(release.jobs['quality-gate'].with.ref, '${{ inputs.tag }}');
  const publish = release.jobs['verify-and-publish'];
  assert.ok(publish.needs.includes('quality-gate'));
  const expression = publish.if.replace(/needs\.([\w-]+)\.result/g, (_, lane) => `needs[${JSON.stringify(lane)}].result`);
  const canPublish = new Function('needs', 'inputs', 'always', `return (${expression});`);
  const successful = () => Object.fromEntries(publish.needs.map(lane => [lane, { result: 'success' }]));
  for (const channel of ['latest', 'beta']) {
    assert.equal(canPublish(successful(), { channel }, () => true), true);
    for (const lane of publish.needs) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      if (channel === 'beta' && lane === 'build-zotero-plugin') continue;
      const needs = successful(); needs[lane].result = result;
      assert.equal(canPublish(needs, { channel }, () => true), false, `${channel}: ${lane} ${result}`);
    }
  }
  const beta = successful(); beta['build-zotero-plugin'].result = 'skipped';
  assert.equal(canPublish(beta, { channel: 'beta' }, () => true), true, 'Zotero is stable-only');
});
