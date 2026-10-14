import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const release = read('.github/workflows/release-build.yml');
const intel = read('.github/workflows/release-macos-intel.yml');

/** The text of one named step, from its `- name:` line to the next one. */
function step(workflow, name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `${name} step is missing`);
  const end = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, end === -1 ? undefined : end + 1);
}

/** Drops conditions (the release job has a matrix, this one does not) and trailing blank lines. */
function comparable(text) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('if:'))
    .join('\n')
    .trimEnd();
}

test('Intel runs only after publication, outside the gate that publishes', () => {
  // The whole point: a slow or failing Intel runner must never hold back the
  // release everyone else is waiting for.
  assert.match(release, /release-macos-intel:\n(?: {4}#.*\n)* {4}needs: verify-and-publish\n/);
  const dispatch = release.slice(release.indexOf('  release-macos-intel:'));
  assert.match(dispatch, /runs-on: ubuntu-latest/);
  assert.match(dispatch, /gh workflow run release-macos-intel\.yml/);
  assert.match(dispatch, /actions: write/);
  assert.match(dispatch, /--ref "\$INTEL_WORKFLOW_REF"/);
  assert.match(dispatch, /-f tag="\$RELEASE_TAG"[\s\S]*-f channel="\$RELEASE_CHANNEL"/);
  assert.doesNotMatch(dispatch, /uses:|gh run watch|gh run view/, 'the primary workflow never waits for an Intel build');
  const publish = release.slice(release.indexOf('  verify-and-publish:'), release.indexOf('  release-macos-intel:'));
  assert.doesNotMatch(publish, /release-macos-intel/, 'publication never waits for Intel');
  assert.doesNotMatch(release, /- os: macos-\d+-intel/, 'Intel is not in the matrix that gates publication');
  assert.match(intel, /isDraft[\s\S]*Intel is only appended to a published release/, 'a draft is refused');
});

test('the Intel build is the released application, signed exactly like a release', () => {
  assert.match(intel, /runs-on: macos-15-intel/);
  assert.match(intel, /ref: \$\{\{ inputs\.tag \}\}/, 'the Intel build comes from the release tag itself');
  // Only signing and stapling tooling comes from the workflow commit.
  const tools = step(intel, "Checkout this workflow's macOS build tooling");
  assert.match(tools, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.deepEqual([...tools.matchAll(/^ {12}(\S+)$/gm)].map((match) => match[1]),
    ['scripts/verify-macos-code-signing.cjs', 'scripts/verify-macos-release.cjs', 'scripts/macos-stapler-retry.cjs']);
  assert.ok(intel.indexOf("Apply this workflow's macOS build tooling") < intel.indexOf('Build, sign and notarize the Intel artifacts'),
    'the signing tooling is in place before the packager starts');
  const build = step(intel, 'Build, sign and notarize the Intel artifacts');
  assert.match(build, /NODUS_RETRY_MACOS_STAPLING: '1'/);
  assert.match(build, /node --require "\$GITHUB_WORKSPACE\/scripts\/macos-stapler-retry\.cjs" node_modules\/\.bin\/electron-builder/);
  assert.match(intel, /verify-release-channel\.mjs "\$CHANNEL" "\$RELEASE_TAG"/);
  assert.match(intel, /NODUS_REQUIRE_BOOTSTRAP: '1'/, 'the offline capability bootstrap is required, as on every release build');
  assert.match(intel, /electron-builder --mac --x64 --publish never --config build\/electron-builder\.release\.cjs/);
  assert.match(intel, /NODUS_REQUIRE_MACOS_SIGNING: true/);
  assert.match(intel, /verify-macos-release\.cjs release x64/, 'the Intel artifacts are verified as signed and notarized');
  for (const name of ['Prepare temporary macOS signing keychain', 'Remove temporary macOS credentials']) {
    assert.equal(comparable(step(intel, name)), comparable(step(release, name)),
      `${name} has drifted between the release and Intel workflows`);
  }
  assert.match(step(intel, 'Remove temporary macOS credentials'), /if: always\(\)/, 'credentials are removed even when the build fails');
});

test('the Intel run only ever adds the Intel half', () => {
  assert.doesNotMatch(intel, /--arm64/, 'the published arm64 artifacts are never rebuilt');
  assert.doesNotMatch(intel, /upload-release-assets\.mjs mac-arm64/, 'the published arm64 artifacts are never re-uploaded');
  assert.match(intel, /upload-release-assets\.mjs mac-x64/);
});

test('the published manifest is merged with the Intel one, never replaced', () => {
  // Uploading the fresh Intel manifest alone would drop every arm64 entry and
  // strand every Apple silicon install. The fresh manifest goes first so that a
  // retry replaces the Intel hashes of an earlier attempt: the merger keeps the
  // first entry per URL (pinned in test-mac-update-manifest.mjs).
  const merge = step(intel, 'Add the Intel entries to the published update manifest');
  assert.match(merge, /gh release download[\s\S]*--pattern "\$\{CHANNEL\}-mac\.yml"/, 'the published manifest is fetched first');
  const command = merge.slice(merge.indexOf('merge-mac-update-manifest.mjs'));
  const fresh = command.indexOf('"release/${CHANNEL}-mac.yml"');
  const published = command.indexOf('"$work/published-mac.yml"');
  assert.ok(fresh !== -1 && published !== -1, 'both manifests are merger inputs');
  assert.ok(fresh < published, 'the fresh Intel manifest is listed before the published one');
  const verify = step(intel, 'Verify the published release now serves both architectures');
  assert.match(verify, /for arch in arm64 x64/);
  assert.match(verify, /grep -qx "path: Nodus-mac-arm64\.zip"/, 'the compatibility pointer stays on arm64');
});

test('a failed Intel run can be retried by hand for either channel', () => {
  assert.match(intel, /workflow_dispatch:/);
  assert.match(intel, /workflow_call:/);
  assert.match(intel, /options:\n\s+- latest\n\s+- beta/);
  // Sharing release-build.yml's concurrency group would make the called
  // workflow wait on its own caller.
  assert.match(intel, /group: nodus-release-macos-intel-\$\{\{ inputs\.tag \}\}/);
});
