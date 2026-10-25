// Operate the production views and their shared control with deterministic IPC fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
const base = process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5199';
const artifacts = path.resolve('artifacts/research-exploration');
await fs.mkdir(artifacts, { recursive: true });
const translations = JSON.parse((await fs.readFile('src/i18n.researchHarness.ts', 'utf8')).replace(/^export const RESEARCH_HARNESS_TRANSLATIONS = /, '').trim().replace(/;$/, ''));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], records = [];
page.on('pageerror', error => errors.push(error.stack ?? error.message));
async function open(mode, { theme = 'light', language = 'es', compact = false } = {}) {
  const query = new URLSearchParams({ harness: 'v1', theme, lang: language, ...(compact ? { profile: 'simple' } : {}) });
  if (mode === 'chat') query.set('view', 'embedded'); else query.set('section', mode);
  await page.goto(`${base}/visual-tests/${mode === 'chat' ? 'research-assistant' : 'research-tabs'}-harness.html?${query}`);
  if (mode === 'deep-research') await page.getByRole('button', { name: 'Nuevo informe', exact: true }).click();
  if (mode === 'immersion') await page.getByRole('button', { name: 'Nueva inmersión', exact: true }).click();
  if (mode === 'dictionary') await page.getByRole('button', { name: 'Nueva entrada', exact: true }).click();
  const control = page.getByTestId('research-exploration-control').last(); await control.waitFor(); return control;
}

try {
  for (const mode of ['chat', 'dictionary', 'deep-research', 'immersion']) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1280, height: 900 });
      const control = await open(mode, { theme });
      const fast = ['chat', 'dictionary'].includes(mode);
      assert.equal(await page.getByText('Vista previa', { exact: true }).count(), 0);
      if (mode === 'chat') {
        const system = page.getByTestId('research-system-prompt-trigger');
        assert.equal(await system.evaluate(el => el.getBoundingClientRect().height), 36);
        assert.equal(await control.evaluate(el => el.getBoundingClientRect().height), 36);
        assert.equal(await system.locator('.research-system-prompt-name').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
      }
      const chosen = control.getByRole('radio', { name: fast ? 'Rápido' : 'Ampliado', exact: true });
      assert.equal(await chosen.isChecked(), true);
      if (mode === 'chat') assert.equal(await control.evaluate(el => !!el.closest('.research-assistant-header')), true, 'The chat switch belongs to the top button bar');
      await chosen.focus(); await chosen.press(fast ? 'ArrowRight' : 'ArrowLeft');
      assert.equal(await control.getByRole('radio', { name: fast ? 'Ampliado' : 'Rápido', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('slider').count(), 0, 'The exploration control has no slider or popover');
      await page.screenshot({ path: path.join(artifacts, `${mode}-${theme}-desktop.png`), animations: 'disabled' });
      await page.setViewportSize({ width: 380, height: 760 });
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 380 && bounds.y >= 0 && bounds.y + bounds.height <= 760, `${mode} switch fits the narrow viewport`);
      const helpBounds = await page.getByRole('tooltip').boundingBox();
      assert.ok(helpBounds && helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 380 && helpBounds.y >= 0 && helpBounds.y + helpBounds.height <= 760, `${mode} keyboard tooltip fits both viewport axes`);
      await page.screenshot({ path: path.join(artifacts, `${mode}-${theme}-narrow.png`), animations: 'disabled' });
      records.push({ mode, theme, default: fast ? 'fast' : 'expanded', keyboard: true, narrow: true });
    }
  }
  for (const language of ['es', ...Object.keys(translations)]) {
    await page.setViewportSize({ width: 380, height: 760 });
    const control = await open('chat', { language, compact: true });
    const table = translations[language];
    const fast = control.getByRole('radio', { name: table?.['Rápido'] ?? 'Rápido', exact: true });
    assert.equal(await fast.isChecked(), true);
    await fast.focus(); await fast.press('ArrowRight');
    const expanded = control.getByRole('radio', { name: table?.['Ampliado'] ?? 'Ampliado', exact: true });
    assert.equal(await expanded.isChecked(), true);
    assert.equal(await control.getAttribute('aria-label'), table?.['Amplitud de investigación'] ?? 'Amplitud de investigación');
    const description = `${table?.['Más margen para explorar preguntas relacionadas, contrastar y conectar fuentes.'] ?? 'Más margen para explorar preguntas relacionadas, contrastar y conectar fuentes.'} ${table?.['Puede necesitar más tiempo y consumo.'] ?? 'Puede necesitar más tiempo y consumo.'}`;
    assert.equal(await expanded.getAttribute('aria-describedby') !== null, true);
    assert.equal(await page.getByRole('tooltip').innerText(), description, 'Keyboard focus opens translated help');
    const tipBounds = await page.getByRole('tooltip').boundingBox();
    assert.ok(tipBounds.x >= 0 && tipBounds.x + tipBounds.width <= 380, 'The tooltip fits narrow screens');
    await expanded.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'detached' });
    await page.mouse.move(0, 0);
    await fast.locator('..').hover();
    assert.equal(await page.getByRole('tooltip').innerText(), `${table?.['Búsquedas centradas y menos lecturas, con margen para resolver dudas importantes.'] ?? 'Búsquedas centradas y menos lecturas, con margen para resolver dudas importantes.'} ${table?.['Suele responder antes y consumir menos.'] ?? 'Suele responder antes y consumir menos.'}`, 'Pointer hover opens translated fast help');
    if (['en', 'de', 'ja'].includes(language)) await page.screenshot({ path: path.join(artifacts, `chat-${language}-narrow.png`), animations: 'disabled' });
    records.push({ language, translated: true, compactChat: true });
  }
  for (const mode of ['chat', 'dictionary', 'deep-research', 'immersion']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const control = await open(mode, { theme: 'dark' });
    const colors = [];
    for (const theme of ['mint-slate', 'amber-ember']) {
      await page.evaluate(async theme => { const { applyAppTheme } = await import('/src/theme/themeBoot.ts'); applyAppTheme(theme); }, theme);
      const colorsForTheme = await control.evaluate(el => ({ accent: getComputedStyle(el).getPropertyValue('--research-exploration-accent').trim(), theme: getComputedStyle(document.documentElement).getPropertyValue('--a-500').trim(), background: getComputedStyle(el.querySelector('input:checked').parentElement).backgroundColor }));
      assert.equal(colorsForTheme.accent, colorsForTheme.theme, 'The switch inherits the selected theme accent on every surface');
      colors.push(colorsForTheme.background);
      await page.screenshot({ path: path.join(artifacts, `${mode}-${theme}.png`), animations: 'disabled' });
      records.push({ mode, theme, followsThemeAccent: true });
    }
    assert.notEqual(colors[0], colors[1], 'Changing theme updates the selected option without remounting');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'visual-receipt.json'), JSON.stringify({ at: new Date().toISOString(), records, errors }, null, 2));
  console.log(`Research exploration UI passed: ${records.length} cases, four production surfaces, defaults, keyboard switch, light/dark, narrow screens and all 12 interface languages and live theme accents.`);
} finally { await browser.close(); }
