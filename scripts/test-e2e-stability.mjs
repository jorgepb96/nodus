import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [smoke, settings, workflow, prosopography, modalPerformance] = await Promise.all([
  readFile(new URL('./e2e-smoke.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  readFile(new URL('./test-prosopography-e2e.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./verify-modal-animation-performance.mjs', import.meta.url), 'utf8'),
]);

test('E2E IPC waits are polled from Node instead of returning async promises to waitForFunction', () => {
  for (const script of [smoke, prosopography, modalPerformance]) {
    assert.doesNotMatch(script, /waitForFunction\(async\b/);
    assert.match(script, /import \{ waitForCondition \} from '\.\/lib\/waitForCondition\.mjs'/);
    assert.match(script, /waitForCondition\('startup update check to finish'/);
  }
});

test('generic CSS presence waits select one match instead of relying on Playwright strict mode', () => {
  assert.doesNotMatch(smoke, /page\.locator\((?:'[^']*'|"[^"]*"|`[^`]*`)\)\.waitFor\(/);
  assert.match(smoke, /page\.locator\('\.study-editor-shell \.md \.katex'\)\.first\(\)\.waitFor\(/);
  assert.match(smoke, /getByTestId\('study-material-annotations-sidebar'\)\.getByText\('Comentario smoke'/);
  assert.doesNotMatch(smoke, /page\.getByText\('Comentario smoke'/);
});

test('the smoke test suppresses release notes with the exact app version before reloading', () => {
  assert.match(smoke, /const appVersion = require\(path\.join\(repoRoot, 'package\.json'\)\)\.version/);
  // Only current release notes need suppression; retired announcements must remain
  // absent without seeding their historical seen markers.
  assert.match(smoke, /localStorage\.setItem\('nodus\.lastSeenVersion', version\);[\s\S]{0,400}?\}, appVersion\)/);
  assert.doesNotMatch(smoke, /localStorage\.setItem\([^\n]*(?:pdfPresenterTutorialSeen|mobileTeaserSeen|platformHighlightsSeen|toolkitBetaGuideSeen|tutorialVideosAnnouncementSeen)/);
  assert.doesNotMatch(smoke, /nodus\.lastSeenVersion', '9999\.0\.0'/);
  assert.match(smoke, /whats-new-cinematic-modal/);
});

test('the real-app smoke checks retired announcements on fresh installs and after release notes and restart', () => {
  for (const testId of ['pdf-presenter-tutorial-announcement', 'mobile-teaser-guide', 'platform-highlights-update-tour', 'toolkit-beta-update-tour', 'tutorial-videos-update-tour']) {
    assert.ok(smoke.includes(`testId: '${testId}'`), `${testId} is missing from the retirement coverage`);
    assert.doesNotMatch(smoke, new RegExp(`getByTestId\\('${testId}'\\)\\.waitFor\\(`), `${testId} must never be awaited as visible`);
  }
  for (const profile of ['fresh installation', 'existing installation after release notes', 'existing installation after restart']) {
    assert.ok(smoke.includes(`await assertRetiredAnnouncementsAbsent('${profile}')`), `${profile} is not verified`);
  }
  assert.match(smoke, /getByTestId\(testId\)\.count\(\), 0/);
  assert.match(smoke, /assert\.deepEqual\(markers, Array\(RETIRED_STARTUP_ANNOUNCEMENTS\.length\)\.fill\(null\)/);
});

test('accessibility controls expose stable selectors used by the E2E smoke', () => {
  for (const testId of ['accessibility-font', 'accessibility-contrast', 'accessibility-motion', 'accessibility-reading']) {
    assert.match(settings, new RegExp(`data-testid=["']${testId}["']`));
    assert.match(smoke, new RegExp(`["']${testId}["']`));
  }
});

test('CI avoids duplicate branch checks, supersedes stale runs, and bounds the Electron smoke duration', () => {
  assert.match(workflow, /on:\n\s+pull_request:/);
  assert.match(workflow, /\n\s+workflow_call:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /branches: \[['"]\*\*['"]\]/);
  assert.match(workflow, /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.head_ref \|\| github\.ref_name \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group' \}\}/);
  assert.match(workflow, /- name: E2E smoke \(real app boot\)\n\s+timeout-minutes: 10/);
});
