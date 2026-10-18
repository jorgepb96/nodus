// The context balloon's Focus tab offers layers, not sections or modes: indexed texts, ideas,
// full documents and the web, each a switch of its own, then the authorized sources the Library
// tab sets. What the user leaves on is what the turn asks for, and the activity balloon marks a
// layer switched off as such.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const output = 'artifacts/research-assistant';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html?view=embedded`;
try {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}&theme=${theme}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const trigger = page.getByTestId('research-context-trigger');
    const panel = page.getByTestId('research-context-panel');
    const count = () => trigger.locator('.chat-skills-count').innerText();
    const layer = id => panel.getByTestId(`research-context-layer-${id}`);
    assert.equal(await count(), '4', 'a new chat reads the indexed texts, ideas, full documents and the web');
    await trigger.click();
    await panel.waitFor();
    // Layers replace the modes and the per-section checkboxes.
    for (const gone of ['Síntesis', 'Huecos', 'Ideas generadas', 'Grafo de autores', 'Todo', 'Nada']) assert.equal(await panel.getByText(gone, { exact: true }).count(), 0, `${gone} is no longer offered`);
    assert.equal(await panel.locator('input[type=checkbox]').count(), 0);
    assert.deepEqual(await panel.getByRole('switch').evaluateAll(items => items.map(item => [item.textContent.split(/(?=[A-ZÁÉÍÓÚ][a-záéíóú]+ )/)[0].trim(), item.getAttribute('aria-checked')])).then(rows => rows.map(([, on]) => on)), ['true', 'true', 'true', 'true']);
    assert.match(await layer('indexed').innerText(), /^Textos indexados\n/);
    assert.ok(await layer('indexed').evaluate((element, ideas) => element.compareDocumentPosition(ideas) & Node.DOCUMENT_POSITION_FOLLOWING, await layer('ideas').elementHandle()), 'indexed texts sits above Ideas');
    assert.match(await layer('ideas').innerText(), /^Ideas\n/);
    assert.match(await layer('documents').innerText(), /^Documentos completos\n.*textos indexados.*Zotero/s);
    assert.match(await layer('web').innerText(), /^Búsqueda web\n/);
    assert.match(await panel.getByTestId('research-context-sources').innerText(), /Fuentes autorizadas\s+Toda la biblioteca/);
    await page.screenshot({ path: `${output}/context-layers-${theme}.png` });
    const height = await layer('ideas').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(height <= 72, `a layer is one row with a two-line description at most (${height}px)`);

    // The indexed texts off, by keyboard: full documents read from them, so they go too, and the
    // turn asks for ideas only.
    await layer('indexed').focus();
    await page.keyboard.press('Space');
    for (const id of ['indexed', 'documents']) assert.equal(await layer(id).getAttribute('aria-checked'), 'false', `${id} reads as off`);
    assert.equal(await count(), '2');
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.evaluate(() => { window.activityScript = [
      { id: 'scope', layer: 'scope', operation: 'resolve', status: 'completed', count: 2 },
      { id: 'ideas', layer: 'ideas', operation: 'lexical', status: 'completed', count: 4, subject: 'Una materia sintética con un nombre bastante largo para una sola línea' },
    ]; });
    const input = page.locator('.research-composer-input');
    await input.fill(`Solo ideas ${theme}`);
    await input.press('Enter');
    const activity = page.getByTestId('research-activity');
    await activity.waitFor();
    const request = await page.evaluate(() => window.requests.at(-1));
    assert.deepEqual(request.selection.layers, { ideas: true, documents: false, indexed: false });
    assert.equal(request.selection.passages, false);
    assert.equal(request.selection.ideas && request.selection.contradictions && request.selection.graph, true, 'the ideas layer carries every idea section');
    for (const off of ['profiles', 'nodus', 'zotero', 'context']) {
      assert.equal(await activity.locator(`li[data-layer="${off}"][data-off]`).count(), 1, `${off} reads as switched off`);
      assert.match(await activity.locator(`li[data-layer="${off}"]`).innerText(), /Desactivada/);
    }
    assert.equal(await activity.locator('li[data-layer="ideas"][data-off]').count(), 0);
    assert.equal(await activity.locator('li[data-layer="graph"][data-off]').count(), 0);
    assert.equal(await activity.locator('li[data-status="idle"]').count(), 9, 'switched-off layers keep their idle state for the flow');
    const rows = await activity.locator('li').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
    assert.ok(Math.max(...rows) <= 44, `every activity row stays on one slim line (${rows.join(', ')})`);
    assert.equal(await activity.locator('li[data-layer="ideas"] .research-activity-copy > p').evaluate(element => element.scrollWidth > element.clientWidth || element.getBoundingClientRect().height < 18), true, 'a long detail is cut to one line');
    await page.screenshot({ path: `${output}/context-layers-activity-${theme}.png` });

    // Every source off: the balloon says what that means, and the turn asks for nothing.
    await trigger.click();
    await layer('ideas').click();
    await layer('web').click();
    assert.equal(await count(), '0');
    assert.match(await panel.getByTestId('research-context-empty').innerText(), /conocimiento general/);
    assert.deepEqual(await page.evaluate(() => window.updates.at(-1)), { researchWebSearch: 'off' }, 'the web switch is the composer’s web setting');
    assert.equal(await page.getByTestId('research-web-toggle').getAttribute('aria-pressed'), 'false');
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.evaluate(() => { window.activityScript = [{ id: 'response', layer: 'response', operation: 'write', status: 'completed' }]; });
    await input.fill(`Sin fuentes ${theme}`);
    await input.press('Enter');
    await page.waitForFunction(text => window.requests.at(-1)?.messages.at(-1)?.content === text, `Sin fuentes ${theme}`);
    const empty = await page.evaluate(() => window.requests.at(-1));
    assert.deepEqual(empty.selection.layers, { ideas: false, documents: false, indexed: false, web: false });
    assert.equal(empty.webSearch, 'off');
    for (const off of ['ideas', 'graph', 'nodus', 'web']) assert.equal(await activity.locator(`li[data-layer="${off}"][data-off]`).count(), 1, `${off} reads as switched off`);

    // The indexed texts alone: a switch like the others. Nothing locks, the composer's web button
    // stays usable, and the turn asks for the passage index alone.
    await trigger.click();
    await layer('indexed').click();
    assert.equal(await layer('indexed').getAttribute('aria-checked'), 'true');
    assert.equal(await count(), '1');
    for (const id of ['ideas', 'documents', 'web']) {
      assert.equal(await layer(id).getAttribute('aria-checked'), 'false', `${id} stays as it was`);
      assert.equal(await layer(id).isDisabled(), false, `${id} is never locked`);
    }
    assert.equal(await page.getByTestId('research-web-toggle').isDisabled(), false, 'the composer’s web button is not locked');
    assert.equal(await panel.getByTestId('research-context-empty').count(), 0, 'the indexed texts are a source');
    await page.waitForTimeout(300); // the switches' colour transition
    await page.screenshot({ path: `${output}/context-layers-indexed-${theme}.png` });
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.evaluate(() => { window.activityScript = [{ id: 'nodus', layer: 'nodus', operation: 'search', status: 'completed', count: 6 }]; });
    await input.fill(`Textos indexados ${theme}`);
    await input.press('Enter');
    await page.waitForFunction(text => window.requests.at(-1)?.messages.at(-1)?.content === text, `Textos indexados ${theme}`);
    const indexed = await page.evaluate(() => window.requests.at(-1));
    assert.deepEqual(indexed.selection.layers, { ideas: false, documents: false, indexed: true, web: false });
    assert.equal(indexed.selection.passages, true);
    assert.equal(indexed.selection.ideas || indexed.selection.documents || indexed.selection.graph, false, 'its sections are the passages alone');
    assert.equal(indexed.webSearch, 'off');
    for (const off of ['ideas', 'graph', 'profiles', 'zotero', 'context', 'web']) assert.equal(await activity.locator(`li[data-layer="${off}"][data-off]`).count(), 1, `${off} reads as switched off`);
    assert.equal(await activity.locator('li[data-layer="nodus"][data-off]').count(), 0, 'the passage index is the layer that runs');

    // Full documents switched on bring nothing new to switch: the indexed texts are already on.
    // Off again and the indexed texts stay; with the indexed texts off, full documents switched on
    // bring them back.
    await trigger.click();
    await layer('documents').click();
    assert.equal(await count(), '2');
    await layer('documents').click();
    assert.equal(await layer('indexed').getAttribute('aria-checked'), 'true', 'full documents off leave the indexed texts on');
    await layer('indexed').click();
    assert.equal(await count(), '0');
    await layer('documents').click();
    for (const id of ['indexed', 'documents']) assert.equal(await layer(id).getAttribute('aria-checked'), 'true', `full documents bring ${id === 'indexed' ? 'the indexed texts' : 'themselves'} on`);
    assert.equal(await count(), '2');
    // The web from the composer counts like any switch.
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.getByTestId('research-web-toggle').click();
    assert.equal(await page.getByTestId('research-web-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await count(), '3');
    assert.deepEqual(await page.evaluate(() => window.updates.at(-1)), { researchWebSearch: 'auto' });

    // The authorized sources row opens the Library tab.
    await trigger.click();
    await panel.getByTestId('research-context-sources').click();
    assert.equal(await page.getByTestId('research-context-tab-library').getAttribute('aria-selected'), 'true');
    await page.getByTestId('research-source-filter-panel').waitFor();
    await page.keyboard.press('Escape');
  }

  // The Simple interface never extracts ideas: a new chat there reads the indexed texts alone, with
  // the web off, and every other switch stays free to turn on.
  await page.goto(`${base}&profile=simple`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  {
    const trigger = page.getByTestId('research-context-trigger');
    const panel = page.getByTestId('research-context-panel');
    const layer = id => panel.getByTestId(`research-context-layer-${id}`);
    const summary = page.locator('.research-simple-context');
    const web = page.getByTestId('research-web-toggle');
    assert.equal(await trigger.locator('.chat-skills-count').innerText(), '1', 'a new Simple chat reads one source');
    assert.equal(await summary.innerText(), 'Textos indexados');
    assert.equal(await web.isDisabled(), false, 'the web is off, not locked');
    assert.equal(await web.getAttribute('aria-pressed'), 'false');
    const input = page.locator('.research-composer-input');
    await input.fill('Pregunta sencilla');
    await input.press('Enter');
    await page.waitForFunction(text => window.requests.at(-1)?.messages.at(-1)?.content === text, 'Pregunta sencilla');
    const simple = await page.evaluate(() => window.requests.at(-1));
    assert.deepEqual(simple.selection.layers, { ideas: false, documents: false, indexed: true, web: false });
    assert.equal(simple.selection.passages, true);
    assert.equal(simple.selection.ideas || simple.selection.documents, false);
    assert.equal(simple.webSearch, 'off', 'the composer’s saved web setting does not turn it on');
    assert.deepEqual(await page.evaluate(() => window.updates), [], 'nor is the saved setting changed');
    await page.locator('.research-composer-stop').waitFor({ state: 'hidden' });
    await trigger.click();
    await panel.waitFor();
    for (const [id, on] of [['indexed', 'true'], ['ideas', 'false'], ['documents', 'false'], ['web', 'false']]) assert.equal(await layer(id).getAttribute('aria-checked'), on, `${id} starts ${on === 'true' ? 'on' : 'off'}`);
    await layer('documents').click();
    assert.equal(await trigger.locator('.chat-skills-count').innerText(), '2');
    assert.equal(await summary.innerText(), 'Textos indexados · Documentos completos');
    await layer('web').click();
    assert.equal(await summary.innerText(), 'Textos indexados · Documentos completos · Búsqueda web');
    await panel.getByRole('button', { name: 'Listo', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log('Context layers: four independent switches (indexed texts, ideas, full documents that bring the indexed texts, web) in place of modes and sections, a new Simple chat that reads the indexed texts alone with the web off, keyboard toggling, the request carries the chosen layers, the web switch shares the composer setting, the no-sources note, the authorized-sources row and a compact activity balloon that marks switched-off layers, in light and dark. No paid calls.');
} finally { await browser.close(); }
