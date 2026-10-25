import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'artifacts/research-context-toggle';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html?view=embedded&draft=1`;
try {
  for (const theme of ['dark', 'light']) {
    await page.goto(`${base}&theme=${theme}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const toggle = page.getByTestId('research-context-toggle');
    const trigger = page.getByTestId('research-context-trigger');
    const panel = page.getByTestId('research-context-panel');
    const layer = id => panel.getByTestId(`research-context-layer-${id}`);
    const count = () => trigger.locator('.chat-skills-count').innerText();
    const capture = async state => {
      await toggle.evaluate(element => element.blur());
      const shell = await page.locator('.research-composer-shell').boundingBox();
      const button = await toggle.boundingBox();
      await page.screenshot({ path: `${output}/controls-${state}-${theme}.png`, clip: {
        x: button.x - 14, y: shell.y - 2, width: shell.x + shell.width - button.x + 16, height: shell.height + 4,
      } });
    };
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    // A partial selection: indexed texts and web. Full documents and ideas must stay off.
    await trigger.click();
    await layer('ideas').click();
    await layer('documents').click();
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    assert.equal(await count(), '2');
    await page.locator('.research-composer-shell').screenshot({ path: `${output}/composer-active-${theme}.png` });
    await capture('active');
    const input = page.locator('.research-composer-input');
    await input.fill('Pregunta con contexto');
    await input.press('Enter');
    await page.waitForFunction(() => window.requests.length === 1 && window.saved.length > 0);
    const original = await page.evaluate(() => window.requests[0].selection);
    const updatesBefore = await page.evaluate(() => window.updates.length);
    await toggle.focus();
    await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await count(), '0');
    assert.equal(await page.getByTestId('research-web-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await toggle.getAttribute('title'), 'Restaurar el contexto anterior');
    assert.equal(await page.evaluate(() => window.updates.length), updatesBefore, 'pause does not change the global web setting');
    await capture('paused');
    await page.locator('.research-composer-shell').screenshot({ path: `${output}/composer-paused-${theme}.png` });
    await page.screenshot({ path: `${output}/chat-paused-${theme}.png` });
    await trigger.click();
    for (const id of ['ideas', 'documents', 'indexed', 'web']) assert.equal(await layer(id).getAttribute('aria-checked'), 'false', id);
    assert.ok(await panel.getByTestId('research-context-empty').isVisible());
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await input.fill('Pregunta sin contexto');
    await input.press('Enter');
    await page.waitForFunction(() => window.requests.length === 2 && window.saved.length > 1);
    const paused = await page.evaluate(() => window.requests[1]);
    assert.deepEqual(paused.selection.layers, { ideas: false, documents: false, indexed: false, web: false });
    assert.equal(paused.webSearch, 'off');
    assert.deepEqual(paused.selection.contextBeforePause.layers, { ...original.layers, web: true });
    // Reloading restores the saved draft and its paused selection for this chat.
    await page.reload();
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    assert.equal(await count(), '2', 'only the two previously selected sources come back');
    await trigger.click();
    for (const [id, checked] of [['ideas', 'false'], ['documents', 'false'], ['indexed', 'true'], ['web', 'true']]) {
      assert.equal(await layer(id).getAttribute('aria-checked'), checked, id);
    }
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await input.fill('Contexto restaurado');
    await input.press('Enter');
    await page.waitForFunction(() => window.requests.length === 1);
    const restored = await page.evaluate(() => window.requests[0]);
    assert.deepEqual(restored.selection.layers, { ...original.layers, web: true });
    assert.equal(restored.selection.contextBeforePause, undefined);
    assert.equal(restored.webSearch, 'auto');
    // Manual edits during a pause start a new selection instead of reviving the old one.
    await toggle.click();
    await page.getByTestId('research-web-toggle').click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await count(), '1');
  }
  assert.deepEqual(errors, []);
  console.log(`Context toggle verified in dark and light themes. Screenshots: ${output}`);
} finally {
  await browser.close();
}
