// Build first. Uses a disposable profile and the real Settings palette controls.
// To capture a baseline build: NODUS_SHELL_THEME_APP_ROOT=/path/to/baseline node scripts/verify-shell-theme.mjs --capture-before
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { THEMES, deriveThemeTokens } from '../src/theme/themes.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.env.NODUS_SHELL_THEME_APP_ROOT || root;
const before = process.argv.includes('--capture-before');
const output = path.resolve(process.env.NODUS_SHELL_THEME_SCREENSHOTS || 'artifacts/shell-theme');
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-shell-theme-'));
const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete env.ELECTRON_RUN_AS_NODE;
const custom = {
  id: 'custom-copper', label: 'Copper', accent: '#d47752', deep: '#201817', pale: '#fff8f2',
  appBackground: { light: '#fff8f2', dark: '#100c0b' }, lightText: '#201817', darkText: '#fff8f2', tint: 0.08,
};
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;
let app, page;
const errors = [], checks = [];
await mkdir(output, { recursive: true });

async function shot(name) {
  await page.getByTestId('sidebar-scroll-region').evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
}

async function openAppearance() {
  await page.getByTestId('header-actions').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('main').getByRole('button', { name: 'Interface', exact: true }).click();
  await page.getByTestId('theme-picker').waitFor();
}

async function assertPalette(theme, mode) {
  const tokens = deriveThemeTokens(theme);
  const expected = rgb(tokens.a[mode][400]);
  // Checking both engines catches a specificity regression in the .light rule.
  const actual = await page.getByTestId('sidebar-scroll-region').evaluate(el => ({
    standard: getComputedStyle(el).scrollbarColor,
    webkit: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
  }));
  assert.equal(actual.standard, `${expected} rgba(0, 0, 0, 0)`, `${theme.id}/${mode}: scrollbar`);
  assert.equal(actual.webkit, expected, `${theme.id}/${mode}: WebKit thumb`);
  const logo = page.getByTestId('nodus-logo');
  assert.equal(await logo.locator('img').isVisible(), false);
  assert.equal(await logo.locator('svg').isVisible(), true);
  assert.deepEqual(await logo.locator('circle').evaluateAll(els => els.map(el => getComputedStyle(el).fill)),
    [300, 400, 500, 600].map(shade => rgb(tokens.a[mode][shade])), `${theme.id}/${mode}: logo nodes`);
  assert.deepEqual(await logo.locator('stop').evaluateAll(els => els.map(el => getComputedStyle(el).stopColor)),
    [300, 400, 600].map(shade => rgb(tokens.a[mode][shade])), `${theme.id}/${mode}: logo gradient`);
  checks.push(`${theme.id}/${mode}`);
}

try {
  app = await electron.launch({ executablePath: require('electron'), args: [appRoot], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.getByText('All the tutorials, in Settings', { exact: true }), async () => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  });
  await page.waitForFunction(() => !!window.nodus && !!document.getElementById('root')?.children.length);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addLocatorHandler(page.getByTestId('backup-health-banner'), async () => {
    await page.getByTestId('backup-health-banner').locator('.backup-health-dismiss').click({ force: true });
  }, { noWaitAfter: true });
  const vaults = await page.evaluate(async ({ version, custom }) => {
    const api = window.nodus;
    const vaults = [];
    for (const type of ['academic', 'estudio', 'genealogy']) {
      vaults.push((await api.createVault({ name: `Theme verification · ${type}`, type })).vault);
    }
    await api.switchVault(vaults[0].id);
    await api.updateSettings({
      onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999,
      tourComplete: true, advancedTourComplete: true, studyTourComplete: true,
      theme: 'dark', appTheme: 'default', customThemes: [custom], uiLanguage: 'en',
      mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true,
    });
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    localStorage.setItem('nodus.sidebarWidth', '260');
    return vaults;
  }, { version: require('../package.json').version, custom });
  await page.reload();
  await page.getByTestId('nodus-logo').waitFor();
  await openAppearance();
  const modeSelect = page.locator('main select').filter({ has: page.locator('option[value="system"]') });
  for (const mode of ['dark', 'light']) {
    await modeSelect.selectOption(mode);
    await page.waitForFunction(mode => document.documentElement.classList.contains(mode), mode);
    for (const theme of before ? THEMES.filter(t => t.id === 'pine-grove') : [...THEMES, { id: custom.id, anchors: custom }]) {
      const label = theme.id === custom.id ? custom.label : theme.label;
      await page.getByTestId('theme-picker').getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(id => document.documentElement.dataset.appTheme === id, theme.id);
      if (!before) await assertPalette(theme, mode);
      if (theme.id === 'pine-grove' || theme.id === custom.id) {
        await shot(`${before ? 'before' : 'after'}-${theme.id}-${mode}.png`);
      }
    }
  }
  if (!before) {
    // System mode must react without rebuilding the logo or reloading the page.
    await modeSelect.selectOption('system');
    for (const mode of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(mode => document.documentElement.classList.contains(mode), mode);
      await assertPalette({ id: custom.id, anchors: custom }, mode);
    }
    await page.getByTestId('theme-picker').getByRole('button', { name: 'Default', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'default');
    for (const vault of vaults) {
      const switched = await page.evaluate(async id => {
        const switched = await window.nodus.switchVault(id);
        await window.nodus.updateSettings({
          appTheme: 'default', theme: 'light', uiLanguage: 'en', basicsTutorialVersion: 999,
          recoverySetupVersion: 999, onboardingComplete: true, tourComplete: true, studyTourComplete: true,
          mascotStyleChosen: true, mascotEnabled: false, reduceMotion: true,
        });
        return switched;
      }, vault.id);
      assert.equal(switched.ok, true, switched.message);
      assert.equal(switched.activeVault.type, vault.type);
      await page.reload();
      const logo = page.getByTestId('nodus-logo');
      await page.waitForFunction(type => document.querySelector('[data-testid="nodus-logo"]')?.getAttribute('data-vault-logo') === type, vault.type);
      assert.equal(await logo.locator('img').isVisible(), true);
      assert.equal(await logo.locator('svg').isVisible(), false);
      assert.ok(await logo.locator('img').evaluate(el => el.complete && el.naturalWidth > 0));
      const actual = await page.getByTestId('sidebar-scroll-region').evaluate(el => ({
        accent: getComputedStyle(el).getPropertyValue('--vault-accent').trim(), scrollbar: getComputedStyle(el).scrollbarColor,
      }));
      assert.equal(actual.scrollbar, `${rgb(actual.accent)} rgba(0, 0, 0, 0)`);
      checks.push(`default/${vault.type}`);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, before ? 'before.json' : 'verification.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(before ? 'Baseline screenshots captured.' : `Shell theme verification passed: ${checks.length} palette/mode/vault combinations; no renderer errors.`);
} catch (error) {
  if (page) await shot('debug.png').catch(() => {});
  throw error;
} finally {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
}
