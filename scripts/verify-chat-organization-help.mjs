import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'artifacts/chat-organization-help';
await mkdir(output, { recursive: true });
const source = await readFile('src/i18n.chatOrganizationHelp.ts', 'utf8');
const tables = JSON.parse(source.split(' = ')[1].trim().replace(/;$/, ''));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html`;
const trigger = page.getByTestId('chat-organization-help-trigger');
const dialog = page.getByTestId('chat-organization-help-dialog');
const snapshot = () => page.evaluate(() => JSON.stringify({ requests: window.requests, updates: window.updates, saved: window.saved, history: window.chatHistoryStore }));

try {
  for (const [lang, table] of Object.entries({ es: {}, ...tables })) {
    await page.goto(`${url}?view=embedded&lang=${lang}`);
    await trigger.waitFor();
    const before = await snapshot();
    await trigger.focus(); await page.keyboard.press('Enter');
    await dialog.waitFor();
    assert.equal(await dialog.locator('h2').innerText(), table['Cuadernos y proyectos'] ?? 'Cuadernos y proyectos');
    assert.equal(await dialog.locator('section').count(), 2);
    for (const paragraph of await dialog.locator('p').allTextContents()) {
      assert.ok(lang === 'es' || Object.values(table).includes(paragraph), `${lang}: ${paragraph}`);
    }
    const sourceExplanation = 'Selecciona colecciones de Nodus o Zotero. Los chats del cuaderno consultan las obras incluidas en ellas.';
    await dialog.getByText(table[sourceExplanation] ?? sourceExplanation, { exact: true }).waitFor();
    await dialog.locator('footer button').focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'focus stays inside the help');
    }
    assert.equal(await snapshot(), before, 'help does not create projects, chats or preparation work');
    if (lang === 'es') await page.screenshot({ path: `${output}/help-light.png` });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'focus returns to its trigger');
    await trigger.click(); await dialog.locator('footer button').click();
    await dialog.waitFor({ state: 'detached' });
  }
  for (const theme of ['light', 'dark']) {
    await page.goto(`${url}?view=embedded&lang=de&theme=${theme}`);
    await trigger.click(); await dialog.waitFor();
    await page.setViewportSize({ width: 390, height: 700 });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 700);
    const footer = await dialog.locator('footer button').boundingBox();
    assert.ok(footer.y + footer.height <= 700, 'the dismissal action remains visible with long translated text');
    await page.screenshot({ path: `${output}/help-${theme}-compact.png` });
    await page.mouse.click(2, 2); await dialog.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  // Other histories have their own source selection rather than academic collections.
  for (const view of ['database', 'world']) {
    await page.goto(`${url}?view=${view}`);
    await trigger.click(); await dialog.waitFor();
    await dialog.getByText('Selecciona las fuentes del cuaderno. Sus chats conservan ese ámbito de consulta.', { exact: true }).waitFor();
    assert.equal(await dialog.getByText(/colecciones/).count(), 0);
    await page.keyboard.press('Escape');
  }
  await page.goto(`${url}?view=study`);
  await page.getByTestId('research-new-project').waitFor();
  assert.equal(await trigger.count(), 0, 'course histories do not promise notebook features');
  assert.deepEqual(errors, []);
  console.log('Notebook/project help: 12 locales, focus, dismissal, compact light/dark layouts, source variants and no side effects passed.');
} finally { await browser.close(); }
