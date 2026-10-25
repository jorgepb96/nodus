import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
const labels = {
  es: 'Copiar sin referencias', en: 'Copy without references', fr: 'Copier sans références',
  de: 'Ohne Quellenangaben kopieren', pt: 'Copiar sem referências', 'pt-BR': 'Copiar sem referências',
  it: 'Copia senza riferimenti', tr: 'Kaynakçasız kopyala', 'zh-CN': '复制时不带参考文献',
  'zh-TW': '複製時不帶參考文獻', ja: '参照なしでコピーする', ko: '참조 없이 복사',
};
const answer = 'La recurrencia **existe** ([Lleó Cañal, 1984, p. 7](nodus://passage/source-1)).\n\nVega de la Rosa lo explica (Vega de la Rosa, 2011, p. 57). Una interpretación [Vega de la Rosa, 2011](nodus://idea/source-2) que sigue vigente (aunque cambie el contexto).';
const clean = 'La recurrencia existe.\n\nVega de la Rosa lo explica. Una interpretación que sigue vigente (aunque cambie el contexto).';

test('Research Chat copies clean prose beside Markdown, with localized tooltips', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({
    entryPoints: [path.join(root, 'visual-tests/research-assistant-harness.tsx')], bundle: true, write: false,
    platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  });
  const css = await readFile(componentStyles(), 'utf8');
  const researchCss = await readFile(path.join(root, 'src/views/researchAssistant.css'), 'utf8');
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root" style="height:100vh"></div></body></html>' }));
    for (const [language, label] of Object.entries(labels)) {
      await page.goto(`http://localhost/?view=embedded&lang=${language}`);
      await page.addStyleTag({ content: css });
      await page.addStyleTag({ content: researchCss });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const input = page.locator('.research-composer-input');
      await input.waitFor({ timeout: 10_000 }).catch(error => { throw new Error(`${error.message}\nBrowser errors: ${errors.join('\n')}`); });
      await page.evaluate(answer => {
        window.copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copied.push(text) } });
        window.nodus.researchChatStream = async (_request, handlers) => {
          handlers.onDelta(answer);
          return { answer, stats: { sections: [], works: 0, documents: 0, passages: 0, contextChars: 0, truncated: false } };
        };
      }, answer);
      await input.fill('Explain the recurring theme.');
      await page.locator('.research-composer-send').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-message-id]').length === 2 && !document.querySelector('.research-composer-stop'));
      const message = page.locator('[data-message-id]').last();
      const prose = message.getByRole('button', { name: label, exact: true });
      assert.equal(await prose.getAttribute('title'), label, `${language}: tooltip is translated`);
      assert.equal(await page.locator('[data-message-id]').first().locator('[data-testid^="research-copy-reading-"]').count(), 0, 'user prompts keep their existing copy action');
      const actions = message.locator('.research-message > div.absolute');
      const markdown = actions.getByRole('button').last();
      const markdownTitle = await markdown.getAttribute('title');
      await prose.click();
      await page.waitForFunction(() => window.copied.length === 1);
      assert.deepEqual(await page.evaluate(() => window.copied), [clean]);
      assert.notEqual(await prose.getAttribute('title'), label, 'only the clicked copy action confirms success');
      assert.equal(await markdown.getAttribute('title'), markdownTitle);
      await markdown.click();
      await page.waitForFunction(() => window.copied.length === 2);
      assert.deepEqual(await page.evaluate(() => window.copied), [clean, answer], 'Markdown keeps the original citations');
      assert.equal(await prose.getAttribute('title'), label);
      if (language === 'en') {
        await page.waitForFunction(({ element, title }) => element.title === title, { element: await markdown.elementHandle(), title: markdownTitle });
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => document.documentElement.className = theme, theme);
          await page.screenshot({ path: path.join(os.tmpdir(), `nodus-research-copy-${theme}.png`) });
        }
        await page.setViewportSize({ width: 390, height: 780 });
        const bounds = await actions.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'all four actions fit on a narrow screen');
        await page.screenshot({ path: path.join(os.tmpdir(), 'nodus-research-copy-narrow.png') });
        await page.setViewportSize({ width: 1200, height: 800 });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
