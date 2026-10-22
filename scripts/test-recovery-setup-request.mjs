// Regression test for #1285: "Configure safe folder" and the update notice's recovery
// action must open the recovery wizard even when an academic vault still owes its
// learning invitations. The wizard is a startup guard, and that guard is deliberately
// deferred until `realSetupStarted` — so an explicit request has to emit the same signal
// the learning flow emits, instead of only resetting `recoverySetupVersion`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-setup-request-'));

function load(entry) {
  const outfile = path.join(scratch, `${path.basename(entry, '.ts')}.cjs`);
  buildSync({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
    alias: { '@shared': path.join(repoRoot, 'shared') },
  });
  return require(outfile);
}

test.after(() => rm(scratch, { recursive: true, force: true }));

const { recoverySetupRequest } = load('src/recoveryHealth.ts');
const { sanitizeLearningProgress } = load('shared/academicLearning.ts');

const progress = {
  version: 1,
  invitationsEligible: true,
  realSetupStarted: false,
  welcomeComplete: true,
  freshIntroductionPending: false,
  lessons: {
    'first-answer': { demoCompleted: true, practiceCompleted: false, invitations: true },
  },
};

test('an academic vault with pending invitations releases the recovery guard', () => {
  const patch = recoverySetupRequest({ academicLearningProgress: progress });

  assert.equal(patch.recoverySetupVersion, 0);
  assert.equal(patch.academicLearningProgress.realSetupStarted, true,
    'the academic deferral must not keep the startup guard inert');
  assert.equal(patch.academicLearningProgress.welcomeComplete, true);
  assert.equal(patch.academicLearningProgress.freshIntroductionPending, false);
  assert.deepEqual(patch.academicLearningProgress.lessons, progress.lessons,
    'lesson checkpoints travel with the patch');
  assert.equal(progress.realSetupStarted, false, 'the caller settings are not mutated');
});

test('the patch survives the real settings sanitizer', () => {
  const patch = recoverySetupRequest({ academicLearningProgress: progress });
  const sanitized = sanitizeLearningProgress(patch.academicLearningProgress);

  assert.ok(sanitized, 'the patch must keep version 1 so the sanitizer accepts it');
  assert.equal(sanitized.realSetupStarted, true);
  assert.equal(sanitized.invitationsEligible, true);
  assert.equal(sanitized.welcomeComplete, true);
  assert.deepEqual(sanitized.lessons, progress.lessons);
});

test('a vault that already started its learning flow only resets the version', () => {
  assert.deepEqual(
    recoverySetupRequest({ academicLearningProgress: { ...progress, realSetupStarted: true } }),
    { recoverySetupVersion: 0 },
  );
});

test('a non-academic or missing progress only resets the version', () => {
  assert.deepEqual(recoverySetupRequest({}), { recoverySetupVersion: 0 });
  assert.deepEqual(
    recoverySetupRequest({ academicLearningProgress: { ...progress, invitationsEligible: false } }),
    { recoverySetupVersion: 0 },
  );
});

test('Settings and the update notice use the shared request helper', async () => {
  const [settings, app] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/Settings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/App.tsx'), 'utf8'),
  ]);

  assert.equal((settings.match(/recoverySetupRequest\(settings\)/g) ?? []).length, 2,
    'both Settings affordances must use the shared request');
  assert.doesNotMatch(settings, /patch\(\{\s*recoverySetupVersion:\s*0\s*\}\)/);

  assert.equal((app.match(/recoverySetupRequest\(settings\)/g) ?? []).length, 1,
    'the update notice recovery action must use the shared request');
  assert.doesNotMatch(app, /updateSettings\(\{\s*recoverySetupVersion:\s*0\s*\}\)/);
});
