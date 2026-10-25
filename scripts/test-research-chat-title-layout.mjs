// Render the real sidebar at its desktop width. Capture with CHAT_LAYOUT_CAPTURES=directory.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('chat titles fill the row; actions overlay without shifting titles in either theme', { timeout: 120_000 }, async t => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const bundle = await build({ entryPoints: ['scripts/fixtures/research-chat-sidebar/layout.tsx'], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.svg': 'dataurl' } });
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  const captures = process.env.CHAT_LAYOUT_CAPTURES;
  if (captures) await mkdir(captures, { recursive: true });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 650, height: 510 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://layout.test/', route => route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><body style="margin:0"><div id="root"></div></body></html>` }));
      await page.goto('http://layout.test/');
      await page.addStyleTag({ content: await readFile(componentStyles(), 'utf8') });
      await page.addStyleTag({ content: await readFile('src/views/researchAssistant.css', 'utf8') });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const sidebar = page.getByTestId('research-history-sidebar');
      const row = sidebar.getByTestId('research-conversation-c0');
      const main = row.locator('.research-history-main');
      const actions = row.locator('.research-history-row-actions');
      await main.waitFor();
      const geometry = () => row.evaluate(element => {
        const row = element.getBoundingClientRect();
        const title = element.querySelector('.research-marquee').getBoundingClientRect();
        const actions = element.querySelector('.research-history-row-actions')?.getBoundingClientRect();
        return { left: title.left - row.left, right: row.right - title.right, width: title.width, height: row.height, overlap: actions ? title.right - actions.left : 0 };
      });
      const shot = async name => { if (captures) await sidebar.screenshot({ path: path.join(captures, `${theme}-${name}.png`) }); };
      await page.mouse.move(600, 500);
      const rest = await geometry();
      assert.equal(rest.left, 10);
      assert.equal(rest.right, 10, 'equal margins; hidden actions reserve no title space');
      assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '0');
      assert.equal(await actions.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
      await shot('normal');
      await row.hover();
      await page.waitForFunction(el => getComputedStyle(el).opacity === '1', await actions.elementHandle());
      const hovered = await geometry();
      assert.equal(hovered.width, rest.width);
      assert.equal(hovered.height, rest.height);
      assert.ok(hovered.overlap > 40, 'actions overlap the full-width title');
      assert.ok(await row.locator('.research-marquee').evaluate(el => -parseFloat(el.style.getPropertyValue('--marquee-shift')) > el.scrollWidth - el.clientWidth + 40), 'scrolling the title also clears the overlaid actions');
      assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '1');
      await shot('hover');
      await row.getByRole('button', { name: 'Más acciones' }).click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      await page.mouse.move(600, 500);
      assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '1', 'menu keeps its controls visible after the pointer leaves');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      await main.focus();
      await page.mouse.move(600, 500);
      await page.keyboard.press('Tab');
      assert.equal(await row.getByRole('button', { name: 'Destacar chat' }).evaluate(el => el === document.activeElement), true);
      assert.equal(await actions.evaluate(el => getComputedStyle(el).opacity), '1', 'keyboard focus reveals the actions');
      await sidebar.getByTestId('research-chat-select-mode').click();
      assert.equal(await actions.count(), 0);
      const selection = await geometry();
      assert.equal(selection.right, 10);
      assert.equal(selection.width, rest.width - 23, 'selection reserves only the checkbox and gap');
      await page.mouse.move(600, 500);
      await shot('selection');
      await sidebar.getByTestId('research-chat-select-mode').click();
      await row.hover();
      await row.getByRole('button', { name: 'Más acciones' }).click();
      await page.getByRole('menuitem', { name: 'Renombrar' }).click();
      await sidebar.getByRole('textbox', { name: 'Nuevo nombre' }).waitFor();
      assert.equal(await actions.isVisible(), false, 'controls do not cover the rename input');
      await sidebar.getByRole('textbox', { name: 'Nuevo nombre' }).fill('Breve');
      await page.keyboard.press('Enter');
      await page.mouse.move(600, 500);
      await row.hover();
      assert.equal(await row.locator('.research-marquee').evaluate(el => el.classList.contains('is-overflowing')), false, 'a short title stays still even with overlaid actions');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await close(); }
});
