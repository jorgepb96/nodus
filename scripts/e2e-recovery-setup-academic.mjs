// End-to-end regression for #1285.
//
// Reproduces the reporter's exact profile state — a new installation whose academic
// vault has learning invitations still pending (`invitationsEligible: true`,
// `realSetupStarted` unset) — and proves that Settings → "Configure safe folder"
// opens the recovery wizard instead of doing nothing.
//
// It also checks the second finding: `getRecoveryStatus().health.detail` follows
// `uiLanguage` instead of returning the stored Spanish sentence.
//
// Manual run (not part of the CI shards): `npm run build && node scripts/e2e-recovery-setup-academic.mjs`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-setup-e2e-'));
const env = {
  ...process.env,
  NODUS_USERDATA: path.join(scratch, 'profile'),
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
const errors = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(40_000);
  page.on('pageerror', (pageError) => errors.push(pageError.stack ?? pageError.message));
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);

  // Fresh install: language, then the first vault. The academic welcome is where the
  // reporter's state is produced: `welcome-later` opts into invitations but never
  // starts a lesson, so `realSetupStarted` stays unset.
  await page.getByTestId('tutorial-language-en').click();
  await page.getByTestId('first-vault-name').fill('Recovery regression');
  await page.getByTestId('first-vault-create').click();
  await page.getByTestId('academic-learning-welcome').waitFor();
  await page.getByTestId('welcome-later').click();

  // The state the issue describes: onboarding done, invitations eligible, no lesson.
  const before = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(before.onboardingComplete, true);
  assert.equal(before.academicLearningProgress?.invitationsEligible, true);
  assert.equal(before.academicLearningProgress?.realSetupStarted, false);

  // The stored status is Spanish source prose; the status handed to the renderer must
  // already be in the UI language.
  await page.evaluate(() => window.nodus.updateSettings({
    autoBackupEnabled: true,
    autoBackupFolder: '',
    lastAutoBackupStatus: 'error: No hay carpeta de destino configurada.',
  }));
  const status = await page.evaluate(() => window.nodus.getRecoveryStatus());
  assert.equal(status.needsSetup, true, 'the wizard is genuinely owed');
  assert.equal(status.health.detail, 'error: No destination folder is configured.',
    'health.detail must follow uiLanguage');
  assert.doesNotMatch(status.health.detail, /No hay carpeta/);

  // Reload so the shell reads the settings written above, and open Settings directly on
  // the data tab that holds the backup controls.
  await page.evaluate(() => localStorage.setItem('nodus.settingsTab', 'data'));
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('root')?.children.length);
  await page.locator('[data-tour="nav-settings"]').click();
  await page.getByText('Automatic backups', { exact: true }).waitFor();
  const configure = page.getByRole('button', { name: 'Configure safe folder', exact: true });
  await configure.waitFor();
  await configure.click();

  // The wizard is a startup guard, not a modal: it takes the screen only if the
  // explicit request released the academic deferral.
  await page.getByTestId('recovery-setup-wizard').waitFor({ timeout: 15_000 });
  const after = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(after.academicLearningProgress?.realSetupStarted, true,
    'the request must emit the signal the learning flow emits');
  assert.equal(after.academicLearningProgress?.invitationsEligible, true,
    'the invitations themselves are not cancelled');

  assert.deepEqual(errors, []);
  console.log('Recovery setup E2E passed: the wizard opens for a pending academic vault.');
} finally {
  await app?.close().catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
