import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = process.cwd();
const require = createRequire(import.meta.url);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-graph-actions-'));
const screenshotDirectory = path.join(root, 'docs', 'verification');
const screenshotPath = path.join(screenshotDirectory, 'graph-actions-tutor-sidebar.png');
let app;

try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: {
      ...process.env,
      NODUS_USERDATA: profile,
      NODUS_STELLAR_PREVIEW: '1',
      NODUS_DISABLE_AUTO_UPDATE: '1',
      NODUS_DISABLE_ANNOUNCEMENTS: '1',
      NODUS_QA_ROOT: profile,
      NODUS_QA_DATABASE_AUDIT_LOG: path.join(profile, 'database-audit.jsonl'),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => typeof window.nodus?.stellarPage === 'function');
  await page.evaluate(async () => {
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    localStorage.setItem('nodus.lastSeenVersion', '5.3.1');
    localStorage.setItem('nodus.mobileTeaserSeen.5.3.1', '1');
    for (const key of [
      'nodus.platformHighlightsSeen.2026-07',
      'nodus.tutorialVideosAnnouncementSeen.2026-07',
      'nodus.pdfPresenterTutorialSeen.e2js_u-05OA',
      'nodus.toolkitBetaGuideSeen.2.4.0',
    ]) localStorage.setItem(key, '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 5,
      recoverySetupVersion: 1,
      tourComplete: true,
      advancedTourComplete: true,
      mascotEnabled: false,
      mascotStyle: 'orb',
      mascotStyleChosen: true,
      uiLanguage: 'es',
      theme: 'light',
    });
    await window.nodus.seedDemoData();
  });
  await page.reload();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1500, 900);
  });
  await page.locator('[data-tour="nav-graph"]').click();
  await page.getByTestId('stellar-themes').waitFor();

  const actionBar = page.getByRole('toolbar', { name: 'Herramientas de investigación' });
  const expectedActions = ['Tutor', 'Temas', 'Ideas duplicadas', 'Auditoría de relaciones'];
  assert.equal(await actionBar.getByRole('button').count(), expectedActions.length);
  assert.equal(await page.getByRole('combobox', { name: 'Herramientas de investigación' }).count(), 0);
  for (const label of expectedActions) {
    const button = actionBar.getByRole('button', { name: label, exact: true });
    await button.hover();
    await page.waitForFunction(
      (name) => {
        const tooltip = document.querySelector('[data-testid="app-tooltip"]');
        return tooltip?.matches(':popover-open') && tooltip.textContent === name
          && getComputedStyle(tooltip).opacity === '1';
      },
      label,
    );
    assert.equal(
      await page.getByRole('tooltip').filter({ visible: true }).count(),
      1,
      `${label} exposes exactly one translated hover tooltip`,
    );
  }

  await actionBar.getByRole('button', { name: 'Tutor', exact: true }).click();
  const sidebar = page.getByTestId('graph-tutor-sidebar');
  await sidebar.waitFor();
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.stellar-body')?.getBoundingClientRect();
    const stage = document.querySelector('.stellar-stage')?.getBoundingClientRect();
    const panel = document.querySelector('[data-testid="graph-tutor-sidebar"]')?.getBoundingClientRect();
    const position = getComputedStyle(document.querySelector('[data-testid="graph-tutor-sidebar"]')).position;
    return { body, stage, panel, position };
  });
  assert.ok(geometry.body && geometry.stage && geometry.panel);
  assert.ok(Math.abs(geometry.stage.right - geometry.panel.left) < 1, 'Tutor starts where the canvas ends');
  assert.ok(Math.abs(geometry.body.right - geometry.panel.right) < 1, 'Tutor occupies the body sidebar edge');
  assert.ok(Math.abs(geometry.body.top - geometry.panel.top) < 1, 'Tutor aligns with the graph body top');
  assert.ok(Math.abs(geometry.body.bottom - geometry.panel.bottom) < 1, 'Tutor aligns with the graph body bottom');
  assert.notEqual(geometry.position, 'absolute', 'Tutor participates in layout instead of overlaying the canvas');
  assert.notEqual(geometry.position, 'fixed', 'Tutor participates in layout instead of overlaying the canvas');

  await actionBar.getByRole('button', { name: 'Tutor', exact: true }).hover();
  await page.waitForTimeout(180);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: screenshotPath });
  console.log(`Graph action strip and Tutor sidebar verified; screenshot: ${screenshotPath}`);
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
