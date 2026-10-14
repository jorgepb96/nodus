import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { formats } from './release-linux-artifact.mjs';

const read = name => load(fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'));
const workflow = read('release-build.yml'), jobs = workflow.jobs;
const commands = job => job.steps.map(step => step.run || '').join('\n');

test('Linux preparation, native packaging and Zotero overlap the required full CI', () => {
  assert.equal(jobs['linux-unpacked'].needs, 'validate-release');
  assert.equal(jobs['quality-gate'].needs, 'validate-release');
  assert.equal(jobs.release.needs, 'prepare-release');
  assert.equal(jobs['build-zotero-plugin'].needs, 'prepare-release');
  assert.deepEqual(jobs.release.strategy.matrix.include.map(row => row['asset-platform']), ['mac-arm64', 'win']);
  assert.ok(commands(jobs.release).includes('npm run build:ci'));
  assert.ok(commands(jobs['linux-unpacked']).includes('npm run build:ci'));
  assert.equal(jobs['linux-unpacked'].steps.find(step => step.run === 'npm run capabilities:bootstrap').env.NODUS_REQUIRE_BOOTSTRAP, '1');
});

test('every isolated Linux format receives this run\'s exact prepared app and identical installer tooling', () => {
  const format = jobs['linux-format'];
  assert.equal(format.needs, 'linux-unpacked');
  assert.equal(format.strategy['fail-fast'], false);
  assert.deepEqual(format.strategy.matrix.format, formats);
  const download = format.steps.find(step => step.uses === 'actions/download-artifact@v8');
  assert.equal(download.with['artifact-ids'], '${{ needs.linux-unpacked.outputs.artifact_id }}');
  assert.equal(download.with['run-id'], undefined, 'another workflow must not supply the application');
  assert.equal(format.steps.find(step => step.uses === 'actions/setup-node@v7').with['node-version'], '${{ needs.linux-unpacked.outputs.node_version }}');
  assert.ok(commands(format).includes('--prepackaged release/linux-unpacked'));
  assert.ok(commands(format).includes('node scripts/release-linux-artifact.mjs stage ${{ matrix.format }}'));
  assert.equal(format.steps.find(step => step.name === 'Finalize and verify canonical AppImage update metadata').if, "matrix.format == 'AppImage'");
  const report = format.steps.find(step => step.uses === 'actions/upload-artifact@v7');
  assert.equal(report.with.name, 'release-linux-format-${{ matrix.format }}');
  assert.equal(report.with.overwrite, true, 'failed-job reruns replace only their own format');
  assert.equal(report.with['if-no-files-found'], 'error');
});

test('5.10.0 recovery pins only its archive helper to the workflow commit and retains the tagged app', () => {
  const steps = jobs['linux-format'].steps;
  assert.equal(steps[0].with.ref, '${{ inputs.tag }}');
  const checkout = steps.find(step => step.name === 'Checkout v5.10.0 Linux archive recovery verifier');
  assert.equal(checkout.if, "inputs.tag == 'v5.10.0'");
  assert.equal(checkout.with.ref, '${{ github.workflow_sha }}');
  assert.equal(checkout.with['sparse-checkout'], 'scripts/release-linux-artifact.mjs');
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false);
  assert.equal(checkout.with['persist-credentials'], false);
  const apply = steps.findIndex(step => step.name === 'Apply v5.10.0 Linux archive recovery verifier');
  const restore = steps.findIndex(step => step.run === 'node scripts/release-linux-artifact.mjs restore');
  assert.equal(steps[apply].if, checkout.if);
  assert.ok(steps.indexOf(checkout) < apply && apply < restore);
  assert.ok(steps[apply].run.includes("copyFileSync('.release-tools/scripts/release-linux-artifact.mjs', 'scripts/release-linux-artifact.mjs')"));
  assert.ok(commands(jobs['linux-format']).includes('--prepackaged release/linux-unpacked'));
});

test('publication rejects failed, cancelled, skipped or missing platform and Linux assembly gates', () => {
  assert.deepEqual(jobs['upload-linux'].needs, ['prepare-release', 'linux-unpacked', 'linux-format']);
  assert.ok(commands(jobs['upload-linux']).indexOf('release-linux-artifact.mjs collect')
    < commands(jobs['upload-linux']).indexOf('upload-release-assets.mjs linux'));
  const publish = jobs['verify-and-publish'];
  assert.ok(publish.needs.includes('upload-linux') && publish.needs.includes('prepare-release'));
  const expression = publish.if.replace(/needs\.([\w-]+)\.result/g, (_, name) => `needs[${JSON.stringify(name)}].result`);
  const allowed = new Function('needs', 'inputs', 'always', `return (${expression});`);
  for (const channel of ['latest', 'beta']) {
    const complete = Object.fromEntries(publish.needs.map(name => [name, { result: 'success' }]));
    assert.equal(allowed(complete, { channel }, () => true), true);
    for (const name of publish.needs) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      if (channel === 'beta' && name === 'build-zotero-plugin') continue;
      assert.equal(allowed({ ...complete, [name]: { result } }, { channel }, () => true), false, `${name}: ${result}`);
    }
  }
});

test('the release notes are generated once and their immutable hash gates both publication channels', () => {
  const prepare = jobs['prepare-release'], publish = jobs['verify-and-publish'];
  assert.equal(prepare.outputs.notes_artifact_id, '${{ steps.share-notes.outputs.artifact-id }}');
  assert.equal(publish.env.EXPECTED_NOTES_SHA256, '${{ needs.prepare-release.outputs.notes_sha256 }}');
  const download = publish.steps.find(step => step.uses === 'actions/download-artifact@v8');
  assert.equal(download.with['artifact-ids'], '${{ needs.prepare-release.outputs.notes_artifact_id }}');
  assert.ok(!commands(publish).includes('npm ci') && !commands(publish).includes('generate-release-notes.mjs'));
  const check = publish.steps.findIndex(step => step.run?.includes('sha256sum --check'));
  for (const [i, step] of publish.steps.entries()) if (step.run?.includes('--draft=false')) {
    assert.ok(check >= 0 && check < i);
    assert.ok(step.run.includes('--notes-file "$RUNNER_TEMP/nodus-release-notes.md"'));
  }
});

test('Intel starts asynchronously only after publication and cannot hold the primary workflow open', () => {
  const dispatch = jobs['release-macos-intel'];
  assert.equal(dispatch.needs, 'verify-and-publish');
  assert.equal(dispatch['runs-on'], 'ubuntu-latest');
  assert.equal(dispatch.uses, undefined);
  assert.deepEqual(dispatch.permissions, { contents: 'read', actions: 'write' });
  assert.ok(commands(dispatch).includes('gh workflow run release-macos-intel.yml'));
  assert.ok(commands(dispatch).includes('-f tag="$RELEASE_TAG"') && commands(dispatch).includes('-f channel="$RELEASE_CHANNEL"'));
  assert.ok(!commands(dispatch).includes('gh run watch'));
  assert.equal(dispatch.env.INTEL_WORKFLOW_REF, '${{ github.ref_name }}');
  for (const [file, name] of [['release.yml', 'publish-stable'], ['release-beta.yml', 'publish-beta']]) {
    assert.equal(read(file).jobs[name].permissions.actions, 'write', 'reusable callers must permit the independent dispatch');
  }
  for (const [name, job] of Object.entries(jobs)) if (name !== 'release-macos-intel') {
    assert.notEqual(job.permissions?.actions, 'write', `${name} must not dispatch workflows`);
  }
});
