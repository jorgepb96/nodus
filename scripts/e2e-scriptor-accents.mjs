// Real vault switching, preferences, editor, and portal UI. Model availability
// alone is stubbed; the privacy prompt is rejected before microphone capture.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { APP_THEME_IDS } from '../shared/appThemes.mjs';
import { createResearchTestRoot, researchTestEnvironment } from './research-isolation.mjs';

const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const isolated = createResearchTestRoot(), output = path.join(root, 'output/qa/scriptor-accents');
await mkdir(output, { recursive: true });
const custom = { id: 'custom-scriptor', label: 'Verde personalizado', accent: '#15a05b', deep: '#10251c', pale: '#f0fff6', appBackground: { light: '#e9f8f0', dark: '#0a1811' }, lightText: '#10251c', darkText: '#f0fff6', tint: 0.08 };
const errors = [], checks = [], screenshots = [], vaults = new Map();
let app, page;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env: researchTestEnvironment(isolated) });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('study:stt:whisperCpp:status');
    ipcMain.handle('study:stt:whisperCpp:status', () => ({ executableReady: true, models: [{ id: 'base', downloaded: true }] }));
  });
  await page.evaluate(async ({ version, custom }) => {
    for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1', 'nodus.sidebarWidth': '246' })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1'); await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', appTheme: 'default', customThemes: [custom], mascotEnabled: false, reduceMotion: false, academicMode: 'manual', sttProvider: 'whisper_cpp', sttWhisperCppModel: 'base' });
  }, { version: require('../package.json').version, custom });
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  await app.evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1280, 900); app.focus({ steal: true }); window.focus(); });
  const academic = await page.evaluate(() => window.nodus.getActiveVault()); vaults.set('academic', academic.id);
  for (const type of ['genealogy', 'databases']) vaults.set(type, await page.evaluate(async type => (await window.nodus.createVault({ name: 'Acentos · ' + type, type })).vault.id, type));
  const enter = async type => {
    const id = vaults.get(type);
    assert.equal((await page.evaluate(id => window.nodus.switchVault(id), id)).ok, true);
    // Newly created vaults have their own first-run preferences.
    if (type !== 'academic') {
      await page.evaluate(custom => window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, genealogyTourComplete: true, databasesTourComplete: true, mascotEnabled: false, customThemes: [custom], academicMode: 'manual', sttProvider: 'whisper_cpp', sttWhisperCppModel: 'base' }), custom);
      await page.reload();
    }
    await page.waitForFunction(type => document.querySelector('[data-testid=app-shell]')?.getAttribute('data-vault-type') === type, type);
    const note = await page.evaluate(async () => {
      const note = await window.nodus.createNote({ title: 'Acentos de Scriptor', content: '' });
      await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: 'El editor comparte los colores del vault y el tema de Nodus.\n\nSelecciona estas palabras para comprobar el formato y sus menús.' }); return note;
    });
    await page.locator(`[data-tour="nav-${type === 'academic' ? 'workspace' : 'notes'}"]`).click();
    await page.getByTestId('workspace-item-' + note.id).click(); await page.locator('.bn-editor').waitFor();
    const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' }); if (await warning.isVisible().catch(() => false)) await warning.click();
    await page.getByTestId('study-dictation-toggle').click();
    await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
    await page.getByTestId('study-dictation-start').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-testid=study-dictation-start]')?.disabled);
  };
  const audit = async (type, appTheme, mode, screenshot = false) => {
    await page.evaluate(({ appTheme, mode }) => window.nodus.updateSettings({ appTheme, theme: mode }), { appTheme, mode });
    await page.waitForFunction(({ appTheme, mode }) => document.documentElement.dataset.appTheme === appTheme && document.documentElement.classList.contains(mode), { appTheme, mode });
    await page.waitForTimeout(160);
    const popup = page.getByTestId('study-dictation-settings');
    if (!await popup.isVisible()) await page.getByTestId('study-dictation').getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
    await popup.waitFor();
    const colors = await page.evaluate(() => {
      const rgb = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const contrast = (foreground, background) => { const luminance = value => rgb(value).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0); const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      const badge = getComputedStyle(document.querySelector('.scriptor-accent-badge')), button = getComputedStyle(document.querySelector('[data-testid=study-dictation-start]')), popup = getComputedStyle(document.querySelector('[data-testid=study-dictation-settings]')), editor = getComputedStyle(document.querySelector('.bn-editor'));
      const root = getComputedStyle(document.documentElement), probe = document.createElement('span'); probe.className = 'text-indigo-300'; document.body.appendChild(probe); const appAccent = rgb(getComputedStyle(probe).color); probe.remove();
      return { vaultAccent: root.getPropertyValue('--vault-accent').trim(), accent: rgb(badge.color), accentContrast: contrast(badge.color, badge.backgroundColor), appAccent, primary: rgb(button.backgroundColor), primaryContrast: contrast(button.color, button.backgroundColor), popupBackground: rgb(popup.backgroundColor), popupContrast: contrast(popup.color, popup.backgroundColor), editorContrast: contrast(editor.color, root.getPropertyValue('--ew-paper')), rootPaper: rgb(root.getPropertyValue('--ew-paper')) };
    });
    assert.ok(colors.primaryContrast >= 4.5, `${type}/${appTheme}/${mode}: primary button contrast ${colors.primaryContrast}`);
    assert.ok(colors.accentContrast >= 4.5, `${type}/${appTheme}/${mode}: accent text contrast ${colors.accentContrast}`);
    assert.ok(colors.popupContrast >= 4.5 && colors.editorContrast >= 4.5, `${type}/${appTheme}/${mode}: readable editor and settings`);
    assert.deepEqual(colors.popupBackground, colors.rootPaper, 'portalled settings inherit the same palette as the editor');
    if (appTheme !== 'default') assert.deepEqual(colors.accent, colors.appAccent, 'Scriptor accent matches the shared app utility for the chosen theme');
    checks.push({ type, appTheme, mode, ...colors });
    if (screenshot) { const file = `${type}-${appTheme}-${mode}.png`; await page.mouse.move(10, 100); await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); }
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' });
    if (screenshot) {
      const inline = page.locator('.bn-editor .bn-inline-content').first();
      await inline.click();
      await inline.evaluate(element => {
        element.closest('.bn-editor').focus();
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 10);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.locator('.editorial-editor-body').dispatchEvent('mouseup');
      const toolbar = page.locator('.bn-formatting-toolbar'); await toolbar.waitFor();
      await toolbar.getByRole('button', { name: 'Más formato', exact: true }).click();
      const more = page.getByRole('dialog', { name: 'Más formato', exact: true }); await more.waitFor();
      await page.waitForTimeout(250);
      const floating = await page.evaluate(() => {
        const rgb = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        return { bar: rgb(getComputedStyle(document.querySelector('.bn-formatting-toolbar')).backgroundColor), popup: rgb(getComputedStyle(document.querySelector('.editorial-selection-more-menu')).backgroundColor), selected: rgb(getComputedStyle(document.querySelector('.editorial-selection-more-menu [data-test=alignTextLeft]')).color) };
      });
      assert.deepEqual(floating.bar, colors.rootPaper, 'floating formatting toolbar inherits the app surface');
      assert.deepEqual(floating.popup, colors.rootPaper, 'overflow balloon inherits the app surface');
      assert.deepEqual(floating.selected, colors.accent, 'native selected formatting controls share the Scriptor accent');
      checks.at(-1).formatting = floating;
      const file = `${type}-${appTheme}-${mode}-format.png`; await page.mouse.move(10, 100); await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
      await page.keyboard.press('Escape'); await more.waitFor({ state: 'hidden' });
      await page.getByRole('textbox', { name: 'Título del documento', exact: true }).click();
    }
  };
  await enter('academic');
  const original = await page.locator('.bn-editor').innerText();
  for (const appTheme of [...APP_THEME_IDS, custom.id]) for (const mode of ['light', 'dark']) await audit('academic', appTheme, mode, ['default', 'pine-grove', 'golden-hour', custom.id].includes(appTheme));
  assert.equal(await page.locator('.bn-editor').innerText(), original, 'changing palettes never changes the document');
  for (const type of ['genealogy', 'databases']) {
    await enter(type);
    for (const appTheme of ['default', 'pine-grove', custom.id]) for (const mode of ['light', 'dark']) await audit(type, appTheme, mode, appTheme === 'default');
  }
  const defaults = checks.filter(check => check.appTheme === 'default' && check.mode === 'light');
  assert.equal(new Set(defaults.map(check => check.accent.join(','))).size, 3, 'real vault switching changes the default Scriptor accent');
  for (const mode of ['light', 'dark']) {
    const customChecks = checks.filter(check => check.appTheme === custom.id && check.mode === mode);
    assert.equal(new Set(customChecks.map(check => check.accent.join(','))).size, 1, 'the chosen palette takes precedence across active vaults');
  }
  assert.deepEqual(errors, []);
  await rm(path.join(output, 'failure.png'), { force: true });
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, screenshots, errors }, null, 2));
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scriptor · acentos compartidos</title><style>body{margin:24px;font:15px system-ui;background:#fafafa;color:#262626}main{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}figure{margin:0}img{width:100%;border-radius:10px;border:1px solid #ddd}figcaption{padding:8px 0}</style><h1>Scriptor comparte el acento del vault y del tema</h1><p>${checks.length} combinaciones verificadas en la app real. ${APP_THEME_IDS.length - 1} paletas, tema predeterminado y tema personalizado; cambios reales de vault, globo de ajustes y contraste ≥ 4,5:1.</p><main>${screenshots.map(file => `<figure><a href="${file}"><img src="${file}" alt="${file}" loading="lazy"></a><figcaption>${file.replace('.png', '')}</figcaption></figure>`).join('')}</main></html>`);
  console.log(`PASS: ${checks.length} theme/mode/vault combinations, app-matched accents, shared portal colours and readable controls.`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
} finally { await app?.close(); await rm(isolated, { recursive: true, force: true }); }
