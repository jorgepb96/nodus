// Exercise the production actions and tooltip layer together: a title attribute
// alone cannot prove that hovering an icon actually displays its explanation.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const summary = 'Algunos recursos no se pudieron generar.';
const providerError = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.";
const initial = {
  schemaVersion: 1, target: { kind: 'deep-research', id: 'report' }, vaultId: 'test', contentHash: 'hash', revision: '1',
  createdAt: '', updatedAt: '', state: 'failed', policy: { enabled: true, skills: [] }, usage: {}, blocks: [],
  figures: [{ id: 'figure', caption: 'Mapa', state: 'failed', error: 'Error de la figura' }],
  error: providerError,
};

test('visual-resource actions keep their size and show working tooltips and error details', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({
    entryPoints: [path.join(root, 'scripts/fixtures/document-visual-actions/renderer.tsx')],
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty' },
  });
  const css = [await readFile(componentStyles(), 'utf8'), await readFile(path.join(root, 'src/components/documentFigures.css'), 'utf8')].join('\n');
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<html class="${theme}"><body><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: css });
      await page.evaluate(value => { window.initial = value; }, initial);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const bar = page.locator('.document-visual-actions');
      const button = name => bar.getByRole('button', { name, exact: true });
      const tip = page.getByRole('tooltip');
      const tooltip = async (control, label) => {
        await control.hover();
        await page.waitForFunction(text => {
          const tip = document.querySelector('[role="tooltip"]');
          return tip?.matches(':popover-open') && tip.textContent === text;
        }, label);
      };

      await t.test(`${theme}: the four controls fit on one row and display tooltips`, async () => {
        await button('Reintentar').waitFor();
        const boxes = await bar.locator(':scope > button').evaluateAll(nodes => nodes.map(node => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
        assert.equal(boxes.length, 4);
        for (const box of boxes) {
          assert.equal(box.width, 36);
          assert.equal(box.height, 36);
          assert.equal(box.y, boxes[0].y);
          assert.ok(box.x + box.width <= 390);
        }
        assert.equal(await page.getByText(providerError, { exact: true }).isVisible(), false);
        for (const label of ['Añadir recursos visuales', 'Deshacer enriquecimiento', 'Reintentar', summary]) {
          await tooltip(button(label), label);
        }
        const rect = await tip.boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
      });

      await t.test(`${theme}: the error opens outside the toolbar and Escape restores focus`, async () => {
        await button(summary).click();
        const dialog = page.getByRole('dialog', { name: summary });
        await dialog.waitFor();
        assert.ok((await dialog.innerText()).includes(providerError));
        assert.ok((await dialog.innerText()).includes('Mapa: Error de la figura'));
        assert.equal(await bar.evaluate(node => node.getBoundingClientRect().height), 36);
        await tooltip(dialog.getByRole('button', { name: 'Cerrar' }), 'Cerrar');
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        assert.equal(await button(summary).evaluate(node => node === document.activeElement), true);
      });

      await t.test(`${theme}: keyboard focus shows the retry tooltip`, async () => {
        await page.mouse.move(380, 650);
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent === 'Reintentar'
          && document.querySelector('[role="tooltip"]')?.matches(':popover-open'));
        assert.equal(await button('Reintentar').evaluate(node => node === document.activeElement), true);
      });

      await t.test(`${theme}: moving over the same icon after focus changes restores its tooltip`, async () => {
        await page.mouse.move(380, 650);
        await tooltip(button('Reintentar'), 'Reintentar');
        await page.locator('#before').focus();
        assert.equal(await tip.isVisible(), false);
        // The target is still the same SVG: a cached pointer target must not prevent
        // engaging it again after focus released the previous tooltip anchor.
        const box = await button('Reintentar').boundingBox();
        await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
        await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.matches(':popover-open'));
        assert.equal(await tip.innerText(), 'Reintentar');
      });

      await t.test(`${theme}: retry and cancel remain usable without expanding the toolbar`, async () => {
        await button('Reintentar').click();
        await button('Cancelar').waitFor();
        await tooltip(button('Cancelar'), 'Cancelar');
        await tooltip(button('Preparando recursos visuales…'), 'Preparando recursos visuales…');
        assert.equal(await bar.evaluate(node => node.getBoundingClientRect().height), 36);
        const calls = await page.evaluate(() => window.actions);
        assert.deepEqual(calls[0], ['retry', initial.target, initial.policy, { retry: true, model: null }]);
        await button('Cancelar').click();
        await button('Reintentar').waitFor();
        await button('Deshacer enriquecimiento').click();
        assert.deepEqual(await page.evaluate(() => window.actions.slice(1)), [['cancel', initial.target], ['undo', initial.target]]);
      });

      await t.test(`${theme}: an empty successful result is explained by a compact info button`, async () => {
        await page.evaluate(value => window.setManifest({ ...value, state: 'ready', figures: [], error: undefined,
          discarded: [{ blockId: 'b', skillId: 's', reason: 'not-selected' }] }), initial);
        const label = 'No se añadió ninguna figura: se descartaron 1 propuestas.';
        await tooltip(button(label), label);
        await button(label).click();
        assert.equal(await page.locator('dialog[open] .document-visual-discards li').count(), 1);
        await page.keyboard.press('Escape');
        await page.evaluate(value => window.setManifest({ ...value, state: 'ready', figures: [], error: undefined }), initial);
        await page.mouse.move(380, 650);
        await tooltip(button('No se añadieron figuras: no eran necesarias.'), 'No se añadieron figuras: no eran necesarias.');
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await close(); }
});
