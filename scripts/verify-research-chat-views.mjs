import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'artifacts/research-assistant';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html`;
try {
  if (process.env.NODUS_RESEARCH_PHONE_MERGE_ONLY !== '1') {
  await page.goto(url);
  const composerStyle = await page.locator('.research-composer').evaluate(el => { const s = getComputedStyle(el); return [s.borderRadius, s.minHeight, s.backgroundColor, s.padding]; });
  for (const view of ['embedded', 'database', 'study', 'teaching', 'world']) {
    await page.goto(`${url}?view=${view}`);
    await page.evaluate(() => localStorage.clear());
    if (view === 'embedded') await page.evaluate(() => localStorage.setItem('nodus.researchChatContextOpen', '1'));
    await page.reload();
    assert.equal(await page.getByRole('region', { name: 'Research chat' }).count(), 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(await page.locator('.research-composer').evaluate(el => { const s = getComputedStyle(el); return [s.borderRadius, s.minHeight, s.backgroundColor, s.padding]; }), composerStyle);
    assert.equal(await page.getByTestId('research-history-sidebar').isVisible(), true, `${view}: history starts open`);
    const historyToggle = page.getByTestId('research-history-toggle');
    assert.equal(await historyToggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await historyToggle.evaluate(el => { const style = getComputedStyle(el); return [style.borderTopStyle, style.borderTopWidth]; }), ['solid', '1px'], 'the history toggle shares the controls’ frame');
    await historyToggle.click();
    assert.equal(await page.getByTestId('research-history-sidebar').isVisible(), false);
    await page.reload();
    assert.equal(await page.getByTestId('research-history-sidebar').isVisible(), false, `${view}: an explicit hide survives reload`);
    assert.equal(await historyToggle.getAttribute('aria-expanded'), 'false');
    await page.getByTestId('research-history-toggle').click();
    await page.reload();
    assert.equal(await page.getByTestId('research-history-sidebar').isVisible(), true);
    assert.equal(await page.locator('.research-assistant-header').getByRole('button', { name: 'Nueva conversación', exact: true }).count(), 0);
    if (view === 'embedded') {
      assert.equal(await page.getByTestId('research-context-toggle').count(), 0);
      assert.equal(await page.getByTestId('research-context-sidebar').count(), 0, 'a saved sidebar preference cannot restore the redundant academic panel');
      for (const layer of ['documents', 'documents']) {
        await page.getByTestId('research-context-trigger').click();
        await page.getByTestId(`research-context-layer-${layer}`).click();
        await page.locator('.research-context-panel').getByRole('button', { name: 'Listo', exact: true }).click();
        assert.match(await page.getByTestId('research-context-trigger').innerText(), /^Contexto\b/, 'the trigger keeps its name whatever the layers');
        assert.equal(await page.getByTestId('research-focus-trigger').count(), 0);
      }
    } else {
      await page.getByTestId('research-context-toggle').click();
      assert.equal(await page.getByTestId('research-context-sidebar').isVisible(), true);
    }
    const input = page.locator('.research-composer-input');
    await input.fill(`Pregunta ${view}`);
    await page.getByRole('button', { name: /Esfuerzo de thinking:/ }).click();
    await page.getByRole('slider').press('End');
    await page.keyboard.press('Escape');
    await input.press('Enter');
    await page.waitForFunction(() => window.saved.length > 0);
    const request = await page.evaluate(() => window.requests[0]);
    assert.equal(request.thinkingEffort, 'xhigh', view);
    assert.equal(request.model.model, 'gpt-5.4', view);
    if (view === 'database') assert.deepEqual(request.databaseIds, ['database-1']);
    if (view === 'study' || view === 'teaching') {
      assert.equal(request.selection.scope, 'library');
      await page.getByRole('button', { name: 'S1 · Fuente original' }).click();
      assert.equal(await page.evaluate(() => window.openedEvidence), 'material-1');
    }
    await page.screenshot({ path: `${output}/view-${view}.png` });
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
    await page.getByTestId('research-history-sidebar').getByText(view === 'embedded' ? 'Conversación de prueba 1' : `Pregunta ${view}`, { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-message-id]').length === 2);
    if (view === 'study' || view === 'teaching') assert.equal(await page.getByRole('button', { name: 'S1 · Fuente original' }).count(), 1);
    if (view !== 'embedded') {
      const panel = page.getByTestId('research-context-sidebar');
      if (view === 'database') {
        await panel.getByLabel('Base seleccionada', { exact: true }).uncheck();
        assert.equal(await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled(), true);
        await panel.getByLabel('Otra base', { exact: true }).check();
      } else {
        await (view === 'study' || view === 'teaching' ? panel.getByTestId('study-chat-scope') : panel.locator('select')).selectOption('manual');
        await input.fill('Consulta con fuentes limitadas');
        assert.equal(await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled(), true);
        if (view === 'study' || view === 'teaching') await panel.getByRole('checkbox', { name: 'Fuente original', exact: true }).check();
        else await panel.locator('input[type=checkbox]').first().check();
      }
      await input.fill('Consulta con fuentes limitadas');
      await input.press('Enter');
      await page.waitForFunction(() => window.requests.length === 2 && window.saved.length >= 2);
      const limited = await page.evaluate(() => window.requests[1]);
      assert.equal(view === 'study' || view === 'teaching' ? limited.messages.length : limited.history.length, view === 'study' || view === 'teaching' ? 1 : 0, 'old source scope is excluded');
      await page.getByRole('button', { name: 'Nueva conversación', exact: true }).last().click();
      await page.getByTestId('research-history-sidebar').getByText(`Pregunta ${view}`, { exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-message-id]').length === 4);
      await input.fill('Continúa con estas fuentes'); await input.press('Enter');
      await page.waitForFunction(() => window.requests.length === 3);
      const resumed = await page.evaluate(() => window.requests[2]);
      const prior = resumed.history ?? resumed.messages.slice(0, -1);
      assert.equal(prior.length, 2, 'reopening keeps only the matching source scope');
      assert.equal(prior[0].content, 'Consulta con fuentes limitadas');
    }
    await page.getByTestId('research-history-toggle').click();
    if (view !== 'embedded') await page.getByTestId('research-context-toggle').click();
    assert.equal(await page.getByTestId('research-history-sidebar').isVisible(), false);
    assert.equal(await page.getByTestId('research-context-sidebar').count(), 0);
    await page.setViewportSize({ width: 650, height: 800 });
    if (view !== 'embedded') {
      await page.getByTestId('research-context-toggle').click();
      const bounds = await page.getByTestId('research-context-sidebar').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 650);
    }
    await page.screenshot({ path: `${output}/view-${view}-compact.png` });
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  await page.goto(`${url}?view=study&fallback=chat&theme=dark&accent=%2310b981`);
  await page.getByTestId('research-context-toggle').click();
  assert.equal(await page.locator('.research-assistant-header select').inputValue(), 'openai::gpt-5.4', 'study chat inherits the configured chat model when no study or general model exists');
  await page.screenshot({ path: `${output}/view-study-dark.png` });
  }
  const phoneMergeResults = [];
  // Real ResearchAssistantModal, current phone CSS and MobileSheet/ConfirmModal portals.
  // The harness supplies only an in-memory transport; it does not replace those components.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 844, height: 200 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${url}?view=embedded&device=phone&phoneMerge=1`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const web = page.getByTestId('research-web-toggle');
    const verify = page.getByTestId('research-verification-toggle');
    await web.waitFor(); await verify.waitFor();
    const effort = page.locator('.research-composer>.research-effort-trigger');
    const send = page.locator('.research-composer-send');
    await effort.click();
    const maximumSlider = page.getByRole('dialog', { name: 'Esfuerzo de thinking', exact: true }).getByRole('slider');
    await maximumSlider.press('End');
    assert.equal(await maximumSlider.inputValue(), await maximumSlider.getAttribute('max'), 'choose the maximum supported effort for the real fixture model');
    const maximumLabel = await maximumSlider.getAttribute('aria-valuetext');
    await page.keyboard.press('Escape');
    assert.equal(await effort.getAttribute('aria-label'), `Esfuerzo de thinking: ${maximumLabel}`);
    const boxes = await Promise.all([web.boundingBox(), verify.boundingBox(), effort.boundingBox(), send.boundingBox()]);
    for (const box of boxes) { assert.ok(box); assert.ok(box.width >= 44 && box.height >= 44); assert.ok(box.x >= 0 && box.x + box.width <= viewport.width); assert.ok(box.y >= 0 && box.y + box.height <= viewport.height); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Web/verification/effort/send must not overlap');
    }
    assert.ok(await effort.evaluate(el => el.scrollWidth <= el.clientWidth), 'effort label is not clipped');
    await effort.click();
    await page.getByRole('dialog', { name: 'Esfuerzo de thinking', exact: true }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    for (const control of [web, verify]) {
      const before = await control.getAttribute('aria-pressed');
      await control.click(); assert.notEqual(await control.getAttribute('aria-pressed'), before, 'the actual control receives its click');
    }
    assert.equal(await page.evaluate(() => window.requests.length), 0, 'toggling sources does not generate an answer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page horizontal overflow');
    await page.screenshot({ path: `${output}/phone-merge-composer-${viewport.width}x${viewport.height}.png` });
    const history = page.getByTestId('research-history-sidebar');
    const selectTwo = async () => {
      await page.getByTestId('research-history-toggle').click();
      await history.waitFor({ state: 'visible' });
      const toggle = history.getByTestId('research-chat-select-mode');
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
      assert.equal(await history.locator('.research-chat-selection-hint').count(), 1, 'the Desktop hint stays in the shared component');
      assert.equal(await history.locator('.research-chat-selection-hint').isVisible(), false, 'phone never shows Shift-click instructions');
      for (const id of ['phone-merge-1', 'phone-merge-2']) {
        const row = history.getByTestId(`research-select-${id}`);
        if (await row.getAttribute('aria-checked') !== 'true') await row.click();
      }
      await history.getByTestId('research-chat-bulk-delete').click();
      await history.waitFor({ state: 'hidden' });
      const dialog = page.getByRole('dialog', { name: 'Eliminar conversaciones', exact: true });
      await dialog.waitFor({ state: 'visible' });
      const confirm = dialog.getByRole('button', { name: 'Eliminar', exact: true });
      await confirm.click({ trial: true }); // Must be unobstructed, not merely in the DOM.
      return dialog;
    };
    const cancelled = await selectTwo();
    await cancelled.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.deletedConversationIds), [], 'cancel performs no deletion');
    const confirmed = await selectTwo();
    await confirmed.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.waitForFunction(() => window.deletedConversationIds.length === 2);
    assert.deepEqual(await page.evaluate(() => [...window.deletedConversationIds].sort()), ['phone-merge-1', 'phone-merge-2'], 'only the selected owning IDs are deleted');
    await page.getByTestId('research-history-toggle').click();
    await history.getByTestId('research-select-phone-merge-3').waitFor({ state: 'visible' });
    assert.equal(await history.getByTestId('research-select-phone-merge-1').count(), 0);
    assert.equal(await history.getByTestId('research-select-phone-merge-2').count(), 0);
    await page.screenshot({ path: `${output}/phone-merge-${viewport.width}x${viewport.height}.png` });
    phoneMergeResults.push({ viewport, controls: Object.fromEntries(['web','verification','effort','send'].map((name, i) => [name, boxes[i]])), effortLabel: await effort.getAttribute('aria-label'), cancelledDeleteCount: 0, confirmedIds: await page.evaluate(() => [...window.deletedConversationIds].sort()), remainingId: 'phone-merge-3' });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/phone-merge-results.json`, JSON.stringify({ fixture: 'actual ResearchAssistantModal with synthetic in-memory transport', providerCalls: 0, errors, cases: phoneMergeResults }, null, 2));
  console.log(`${process.env.NODUS_RESEARCH_PHONE_MERGE_ONLY === '1' ? 'Phone merge regression only' : 'Five Desktop variants and phone merge regression'}: three phone viewports, Web/verification/maximum effort/send geometry and clicks, cancel without writes and selected-only confirmation PASS. No paid calls.`);
} finally { await browser.close(); }
