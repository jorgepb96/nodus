// Multiple selection in the research chat history, in a browser with synthetic data:
// a click toggles a chat instead of opening it, Shift + click selects a range in the
// order the list shows, and the bar archives, deletes or moves every selected chat at
// once. A notebook's chats stay in their notebook, as in the single-chat menu.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);

test('research chat history: multiple selection archives, deletes and moves several chats', { timeout: 300_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const { browser, close } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  try {
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/research-chat-sidebar/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty', '.svg': 'dataurl' } });
    const page = await browser.newPage({ viewport: { width: 900, height: 760 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://sidebar.test/', route => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
    await page.goto('http://sidebar.test/');
    await page.addStyleTag({ content: await readFile(componentStyles(), 'utf8') });
    await page.addStyleTag({ content: await readFile(path.join(root, 'src/views/researchAssistant.css'), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sidebar = page.getByTestId('research-history-sidebar');
    const bar = sidebar.getByTestId('research-chat-selection');
    const count = () => sidebar.getByTestId('research-chat-select-all').textContent();
    const logged = () => page.evaluate(() => window.actions.map(entry => JSON.stringify(entry)));
    const reset = () => page.evaluate(() => { window.actions = []; });
    const checked = id => sidebar.getByTestId(`research-select-${id}`).getAttribute('aria-checked');

    // The other histories (Study's courses, a Databases surface) offer no bulk actions.
    assert.equal(await page.getByTestId('course-history-sidebar').getByTestId('research-chat-select-mode').count(), 0);

    const toggle = sidebar.getByTestId('research-chat-select-mode');
    assert.equal(await toggle.getAttribute('title'), 'Seleccionar varios chats');
    await toggle.click();
    await bar.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(await bar.textContent(), /Mayús \+ clic selecciona un intervalo/);

    await reset();
    await sidebar.getByTestId('research-select-c1').click();
    assert.equal(await checked('c1'), 'true');
    assert.equal(await count(), '1 seleccionado(s)');
    assert.deepEqual(await logged(), [], 'a click selects, it does not open the chat');
    // Shift + click: every chat between, in the order the list shows them.
    await sidebar.getByTestId('research-select-c4').click({ modifiers: ['Shift'] });
    assert.deepEqual([await checked('c1'), await checked('c3'), await checked('c4')], ['true', 'true', 'true']);
    assert.equal(await count(), '3 seleccionado(s)');
    assert.equal(await page.evaluate(() => String(getSelection())), '', 'Shift + click selects no text');
    await sidebar.getByTestId('research-select-c3').click();
    assert.equal(await checked('c3'), 'false');

    await sidebar.getByTestId('research-chat-bulk-archive').click();
    await page.waitForFunction(() => window.actions.some(entry => entry[0] === 'archiveMany'));
    assert.deepEqual(await logged(), [JSON.stringify(['archiveMany', ['c1', 'c4'], true])]);
    assert.equal(await count(), '0 seleccionado(s)', 'the selection clears after the action');
    assert.equal(await sidebar.getByTestId('research-chat-bulk-delete').isDisabled(), true);

    await reset();
    await sidebar.getByTestId('research-chat-select-all').click();
    assert.equal(await count(), '3 seleccionado(s)');
    await sidebar.getByTestId('research-chat-bulk-delete').click();
    assert.deepEqual(await logged(), [JSON.stringify(['deleteMany', ['c1', 'c3', 'c4']])]);
    await sidebar.getByTestId('research-chat-select-all').click();
    assert.equal(await count(), '0 seleccionado(s)', 'select all toggles back to none');

    // Move: a notebook's chat is left in its notebook and the bar says so.
    await reset();
    await sidebar.getByTestId('research-chat-search').fill('Pozos');
    await sidebar.getByTestId('research-select-c5').click();
    await sidebar.getByTestId('research-chat-search').fill('');
    await sidebar.getByTestId('research-select-c3').click();
    assert.equal(await count(), '2 seleccionado(s)');
    await sidebar.getByTestId('research-chat-bulk-move').click();
    const menu = page.getByRole('menu');
    await menu.waitFor();
    await menu.getByRole('menuitem', { name: 'Alfa' }).click();
    await page.waitForFunction(() => window.actions.some(entry => entry[0] === 'moveMany'));
    assert.deepEqual(await logged(), [JSON.stringify(['moveMany', ['c3'], 'p-a'])]);
    await sidebar.getByText('1 chat(s) de cuadernos se quedan en su cuaderno.').waitFor();

    // Leaving the mode restores the rows: a click opens the chat again.
    await toggle.click();
    assert.equal(await bar.count(), 0);
    assert.equal(await sidebar.getByTestId('research-select-c1').count(), 0);
    await reset();
    await sidebar.getByTestId('research-conversation-c1').locator('.research-history-main').click();
    assert.deepEqual(await logged(), [JSON.stringify(['open', 'c1'])]);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
