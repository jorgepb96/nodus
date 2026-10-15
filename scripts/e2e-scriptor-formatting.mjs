// Check the real desktop formatting toolbar and its independent overflow panel.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { createResearchTestRoot, researchTestEnvironment } from './research-isolation.mjs';

const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const isolated = createResearchTestRoot(), output = path.join(root, 'output/qa/scriptor-formatting');
await mkdir(output, { recursive: true });
const errors = [], checks = [], screenshots = [];
let app, page;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env: researchTestEnvironment(isolated) });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1', 'nodus.sidebarWidth': '246' })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: false, academicMode: 'manual' });
  }, require('../package.json').version);
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  const note = await page.evaluate(async () => {
    const note = await window.nodus.createNote({ title: 'Prueba de dictado corregido', content: '' });
    const nativeDocument = ['El dictado aparece como texto normal mientras seguimos hablando.', 'Selecciona estas palabras para cambiar el formato sin interrumpir la escritura.', 'Los ajustes de formato se abren en un globo independiente.'].map((text, index) => ({ id: 'format-' + index, type: 'paragraph', props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' }, content: [{ type: 'text', text, styles: {} }], children: [] }));
    await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '', nativeDocument });
    return note;
  });
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + note.id).click();
  await page.locator('.bn-editor').waitFor();
  const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
  if (await warning.isVisible().catch(() => false)) await warning.click();
  await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
  const toolbar = page.locator('.bn-formatting-toolbar'), popup = page.getByRole('dialog', { name: 'Más formato', exact: true });
  const inline = page.locator('[data-id="format-1"] .bn-inline-content');
  const select = async () => {
    await inline.scrollIntoViewIfNeeded(); await inline.click();
    await inline.evaluate(element => {
      element.closest('.bn-editor').focus(); const node = element.firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 'Selecciona estas palabras'.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.locator('.editorial-editor-body').dispatchEvent('mouseup');
    await toolbar.waitFor();
    await page.getByTestId('study-selection-improve').waitFor();
    await page.waitForFunction(() => document.querySelector('.bn-formatting-toolbar')?.getBoundingClientRect().width > 100);
    await page.waitForTimeout(200);
  };
  const capture = async name => {
    const file = name + '.png'; await page.mouse.move(10, 100); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
    if (name === 'light-1280-open' || name === 'dark-1280-open') {
      const bar = await toolbar.boundingBox(), panel = await popup.boundingBox();
      const x = Math.max(0, Math.min(bar.x, panel.x) - 12), y = Math.max(0, Math.min(bar.y, panel.y) - 12);
      const right = Math.max(bar.x + bar.width, panel.x + panel.width) + 12, bottom = Math.max(bar.y + bar.height, panel.y + panel.height) + 12;
      await page.screenshot({ path: path.join(output, name + '-detail.png'), clip: { x, y, width: right - x, height: bottom - y } });
    }
  };
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    await page.waitForFunction(theme => document.documentElement.classList.contains('dark') === (theme === 'dark'), theme);
    for (const width of [1280, 900, 600, 360]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
      await page.setViewportSize({ width, height: 900 });
      const sidebarToggle = page.getByTestId('sidebar-header-toggle');
      const collapsed = (await sidebarToggle.getAttribute('aria-label')) === 'Mostrar el menú lateral';
      if (collapsed !== (width <= 600)) await sidebarToggle.click();
      await select();
      const before = await toolbar.boundingBox();
      if (width === 1280) await capture(theme + '-1280-bar');
      await toolbar.getByRole('button', { name: 'Más formato', exact: true }).click(); await popup.waitFor();
      await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector('.bn-formatting-toolbar'), popup = document.querySelector('.editorial-selection-more-popover');
        const bar = toolbar.getBoundingClientRect(), panel = popup.getBoundingClientRect();
        return { bar: bar.toJSON(), panel: panel.toJSON(), scrollHeight: toolbar.scrollHeight, clientHeight: toolbar.clientHeight, scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth, overflow: getComputedStyle(toolbar).overflow, independent: !toolbar.contains(popup), viewportWidth: innerWidth, viewportHeight: innerHeight, selection: getSelection().toString() };
      });
      assert.ok(geometry.independent, 'overflow popup must be outside the toolbar DOM');
      assert.equal(geometry.overflow, 'visible');
      assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1 && geometry.scrollWidth <= geometry.clientWidth + 1, 'toolbar must not scroll in either axis');
      assert.ok(Math.abs(before.height - geometry.bar.height) < 1, 'opening overflow must not increase toolbar height');
      assert.ok(geometry.panel.top >= geometry.bar.bottom + 6 || geometry.panel.bottom <= geometry.bar.top - 6, 'the popup must have a visible gap from the toolbar');
      assert.ok(geometry.panel.x >= 0 && geometry.panel.right <= width && geometry.panel.y >= 0 && geometry.panel.bottom <= 900, 'independent popup stays in the visible viewport');
      assert.equal(await toolbar.getByRole('button', { name: 'Más formato', exact: true }).getAttribute('aria-expanded'), 'true');
      await capture(theme + '-' + width + '-open'); checks.push({ theme, width, ...geometry });
      await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' });
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await page.setViewportSize({ width: 1280, height: 900 });
  await select(); await toolbar.getByRole('button', { name: 'Más formato', exact: true }).click(); await popup.waitFor();
  await popup.locator('[data-test=alignTextCenter]').click();
  await page.waitForFunction(() => document.querySelector('[data-id="format-1"] .bn-block-content')?.getAttribute('data-text-alignment') === 'center');
  await page.getByTestId('study-editor-undo').click();
  await page.waitForFunction(() => (document.querySelector('[data-id="format-1"] .bn-block-content')?.getAttribute('data-text-alignment') ?? 'left') === 'left');
  await select(); const more = toolbar.getByRole('button', { name: 'Más formato', exact: true });
  await more.focus(); await page.keyboard.press('Enter'); await popup.waitFor();
  await popup.locator('[data-test=strike]').focus(); await page.keyboard.press('Enter');
  assert.equal(await inline.locator('s').innerText(), 'Selecciona estas palabras', 'keyboard action retains the selected words');
  assert.equal(await page.locator('[data-id="format-0"] s').count(), 0);
  await page.getByTestId('study-editor-undo').click(); assert.equal(await inline.locator('s').count(), 0);
  await select(); await toolbar.getByRole('button', { name: 'Más formato', exact: true }).click(); await popup.waitFor();
  await page.getByRole('textbox', { name: 'Título del documento', exact: true }).click(); await popup.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await rm(path.join(output, 'failure.png'), { force: true });
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, keyboardAndAlignment: true, errors, screenshots }, null, 2));
  await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scriptor · barra de formato corregida</title><style>body{margin:24px;font:15px system-ui;color:#302e3a;background:#fafafa}main{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}figure{margin:0}img{width:100%;border:1px solid #ddd;border-radius:10px}figcaption{padding:8px 0}</style><h1>Barra de formato y globo independiente</h1><p>Verificado en la app real: barra sin scroll, globo separado, selección conservada, teclado, alineación y deshacer. Temas claro y oscuro, de 360 a 1280 px.</p><main>${screenshots.map(file => `<figure><a href="${file}"><img src="${file}" alt="${file}" loading="lazy"></a><figcaption>${file.replace('.png', '')}</figcaption></figure>`).join('')}</main></html>`);
  console.log('PASS: 8 viewport/theme combinations, independent popup, no toolbar scroll, keyboard, alignment and undo.');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
} finally {
  await app?.close(); await rm(isolated, { recursive: true, force: true });
}
