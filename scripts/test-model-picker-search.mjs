import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-picker-'));
test.after(() => rm(dir, { recursive: true, force: true }));
await build({ entryPoints: [path.join(root, 'shared/modelSearch.ts')], outfile: path.join(dir, 'search.mjs'), bundle: true, format: 'esm' });
const { matchesModelSearch } = await import(pathToFileURL(path.join(dir, 'search.mjs')));
test('model search ignores separators, case and accents and ANDs partial terms in any order', () => {
  for (const query of ['gemini flash', 'FLASH gem', 'gemini_flash', 'gemini/flash', ' gemini   flash ', 'GÉMINI—FLASH', 'gemini-flash']) {
    assert.ok(matchesModelSearch('Google · gemini-flash-lite', query), query);
  }
  assert.ok(matchesModelSearch('OpenAI · gpt-4.1-mini', 'gpt 4.1 mini'));
  assert.ok(matchesModelSearch('gemini-flash-lite', ''));
  assert.ok(matchesModelSearch('gemini-flash-lite', '---'));
  assert.equal(matchesModelSearch('gemini-flash-lite', 'gemini pro'), false);
});

const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
test('real model menus support search, selection, themes and clipped containers', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/model-picker/renderer.tsx')], outfile: path.join(dir, 'fixture.js'), bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const stylesheet = componentStyles();
  const css = await readFile(stylesheet, 'utf8');
  const { browser, close: closeBrowser } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  const errors = [];
  let page;
  async function fresh(config = {}) {
    if (page) await page.close();
    page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://models.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
    await page.goto('http://models.test/');
    await page.addStyleTag({ content: css + bundle.outputFiles.find((f) => f.path.endsWith('.css')).text });
    await page.evaluate((config) => { window.config = config; }, config);
    await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text });
    await page.locator('#shell').waitFor({ state: 'attached' });
  }
  const open = async () => { await page.locator('.model-picker-trigger').click(); await page.getByTestId('model-picker-search').waitFor(); };
  const search = () => page.getByTestId('model-picker-search');
  try {
    await t.test('default model menu searches partial terms and selects the exact original model reference', async () => {
      await fresh(); await open();
      assert.equal(await search().evaluate((e) => e === document.activeElement), true);
      await search().fill('GEMINI flash');
      assert.equal(await page.getByRole('option').count(), 1);
      await search().press('Enter');
      assert.deepEqual(await page.evaluate(() => window.actions), [{ provider: 'gemini', model: 'gemini-flash-lite' }]);
      await open(); assert.equal(await search().inputValue(), '');
      await search().fill('no model matches');
      assert.equal(await page.getByRole('option').count(), 0);
      await search().press('Enter'); assert.equal((await page.evaluate(() => window.actions)).length, 1);
      await search().press('Escape');
      assert.equal(await page.evaluate(() => window.escaped), 0, 'Escape must not close the parent dialog');
      assert.equal(await page.locator('.model-picker-trigger').evaluate((e) => e === document.activeElement), true);
    });
    await t.test('menus escape clipping and flip upward near the viewport edge; mouse can select', async () => {
      for (const bottom of [false, true]) {
        await fresh({ bottom }); await open(); await search().fill('local model 39');
        const option = page.getByRole('option');
        const box = await option.boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 600);
        assert.equal(await option.evaluate((e) => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + 15, b.y + b.height / 2)); }), true);
        await option.click();
        assert.equal(await page.evaluate(() => window.actions[0].model), 'local-model-39');
      }
    });
    await t.test('keyboard skips blocked extraction models and disabled controls cannot open', async () => {
      await fresh({ requireExtraction: true, allowEmpty: false }); await open(); await search().fill('qwen');
      assert.equal(await page.getByRole('option').isDisabled(), true);
      await search().press('Enter'); assert.deepEqual(await page.evaluate(() => window.actions), []);
      await search().fill('gemini'); await search().press('ArrowDown'); await page.keyboard.press('Enter');
      assert.equal((await page.evaluate(() => window.actions)).length, 1);
      await open(); await page.evaluate(() => window.setDisabled(true));
      await search().waitFor({ state: 'detached' });
      assert.equal(await page.locator('.model-picker-trigger').isDisabled(), true);
    });
    await t.test('saved non-favorite selections and clearing remain available; outside clicks reset search', async () => {
      await fresh({ value: { provider: 'ollama', model: 'private-saved-model' } }); await open(); await search().fill('private saved');
      assert.equal(await page.getByRole('option').count(), 1);
      await page.locator('#outside').click(); await open(); assert.equal(await search().inputValue(), '');
      await search().fill('sin modelo'); await search().press('Enter');
      assert.deepEqual(await page.evaluate(() => window.actions), [null]);
    });
    await t.test('current non-favorite models sort with favorites in searchable and native pickers', async () => {
      const value = { provider: 'ollama', model: 'zulu-saved-model' };
      const alphabetic = (labels) => [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      await fresh({ value, allowEmpty: false }); await open();
      const labels = await page.getByRole('option').allTextContents();
      assert.deepEqual(labels, alphabetic(labels));
      assert.equal(await page.getByRole('option', { selected: true }).textContent(), 'Ollama · zulu-saved-model');
      await search().fill('ollama');
      const filtered = await page.getByRole('option').allTextContents();
      assert.deepEqual(filtered, alphabetic(filtered));
      await search().press('ArrowDown'); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => window.actions), [{ provider: 'ollama', model: 'local-model-0' }]);
      await fresh({ value, native: true, allowEmpty: false });
      const nativeLabels = await page.locator('select option:not([value=""])').allTextContents();
      assert.deepEqual(nativeLabels, alphabetic(nativeLabels));
      assert.equal(await page.locator('select').inputValue(), 'ollama::zulu-saved-model');
    });
    await t.test('Scriptor styles and image models sort by visible label without losing selected IDs or keyboard position', async () => {
      for (const scriptor of ['style', 'image']) {
        await fresh({ scriptor });
        const trigger = page.getByTestId('scriptor-choice'), input = page.getByTestId('scriptor-choice-search');
        await trigger.click();
        const labels = await page.getByRole('option').allTextContents();
        assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
        assert.equal(await page.getByRole('option', { selected: true }).getAttribute('data-active'), 'true');
        await input.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.selections), ['z']);
        await trigger.click(); await input.press('ArrowUp'); await input.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.selections), ['z', 'c']);
        await trigger.click(); await input.fill(scriptor === 'style' ? 'breve' : 'boceto'); await input.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.selections), ['z', 'c', 'b']);
        await trigger.click(); await input.press('Escape');
        assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
        assert.equal(await page.evaluate(() => window.escaped), 0);
      }
    });
    await t.test('reasoning stays beside the searchable model picker and preserves the model identity', async () => {
      await fresh({ reasoning: true, value: { provider: 'codex', model: 'gpt-test' } });
      await page.locator('select').selectOption('high');
      assert.deepEqual(await page.evaluate(() => window.actions[0]), { provider: 'codex', model: 'gpt-test', reasoningEffort: 'high' });
      await open(); await search().fill('gemini flash'); await search().press('Enter');
      assert.equal(await page.locator('select').count(), 0);
    });
    await t.test('provider discovery dropdown uses the same flexible matching', async () => {
      await fresh({ onboarding: true }); await page.getByTestId('discovery-trigger').click();
      await page.getByTestId('discovery-search').fill('GÉMINI_flash');
      assert.equal(await page.getByRole('option').count(), 1);
      await page.getByTestId('discovery-search').press('Enter');
      assert.equal(await page.evaluate(() => window.actions[0].model), 'gemini-flash-lite');
    });
    await t.test('embedding catalogue searches beyond entry 300 and preserves the saved model', async () => {
      await fresh({ embedding: true });
      await page.getByRole('button', { name: 'Cargar modelos' }).click();
      await page.getByTestId('embedding-model-picker-trigger').click();
      const input = page.getByTestId('embedding-model-picker-search');
      await input.fill('saved embedding'); assert.equal(await page.getByRole('listbox').getByRole('option').count(), 1);
      await input.fill('text embedding 349');
      assert.equal(await page.getByRole('listbox').getByRole('option').count(), 1);
      await page.getByRole('listbox').getByRole('option').click();
      assert.deepEqual(await page.evaluate(() => window.actions[0]), { provider: 'openai', model: 'text-embedding-349' });
      await page.getByTestId('embedding-model-picker-trigger').click();
      await input.fill('semantic vector 348');
      assert.equal(await page.getByRole('listbox').getByRole('option').count(), 1, 'search includes display names as well as IDs');
      await input.press('Enter');
      assert.equal(await page.evaluate(() => window.actions[1].model), 'text-embedding-348');
    });
    await t.test('switching embedding provider ignores the previous catalogue response', async () => {
      await fresh({ embedding: true });
      await page.evaluate(() => { window.resolvers = {}; window.nodus.listEmbeddingModels = (provider) => new Promise((resolve) => { window.resolvers[provider] = resolve; }); });
      await page.getByRole('button', { name: 'Cargar modelos' }).click();
      await page.locator('select').selectOption('gemini');
      await page.getByRole('button', { name: 'Cargar modelos' }).click();
      await page.evaluate(() => { window.resolvers.gemini([{ id: 'gemini-embedding-fresh' }]); });
      await page.getByTestId('embedding-model-picker-trigger').waitFor();
      await page.evaluate(() => { window.resolvers.openai([{ id: 'openai-embedding-stale' }]); });
      await page.getByTestId('embedding-model-picker-trigger').click();
      await page.getByTestId('embedding-model-picker-search').fill('fresh');
      assert.equal(await page.getByRole('listbox').getByRole('option').count(), 1);
      await page.getByTestId('embedding-model-picker-search').fill('stale');
      assert.equal(await page.getByRole('listbox').getByRole('option').count(), 0);
    });
    await t.test('all nine vault accents and both themes remain opaque and fit a narrow viewport', async () => {
      await fresh({ value: { provider: 'gemini', model: 'gemini-flash-lite' } });
      await page.setViewportSize({ width: 360, height: 640 });
      const colors = await page.evaluate(() => window.colors);
      for (const [type, accent] of Object.entries(colors)) for (const theme of ['dark', 'light']) {
        await page.evaluate(({ type, theme, accent }) => { document.documentElement.className = `${theme} ${type.replace('_', '-')}`; document.getElementById('shell').style.setProperty('--vault-accent', accent); }, { type, theme, accent });
        await open();
        const styles = await page.locator('.model-picker-options').evaluate((e) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return { background: s.backgroundColor, accent: s.getPropertyValue('--vault-accent').trim(), left: b.left, right: b.right, scroll: e.scrollWidth, width: e.clientWidth }; });
        assert.equal(styles.background, theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(23, 23, 23)');
        assert.equal(styles.accent, accent); assert.ok(styles.left >= 0 && styles.right <= 360); assert.ok(styles.scroll <= styles.width);
        if (process.env.MODEL_PICKER_QA_DIR && type === 'academic') await page.screenshot({ path: path.join(process.env.MODEL_PICKER_QA_DIR, `${theme}.png`) });
        await search().press('Escape');
      }
    });
    assert.deepEqual(errors, []);
  } finally { await closeBrowser(); }
});
