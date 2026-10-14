import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const output = 'artifacts/research-assistant';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = `${process.env.NODUS_VISUAL_URL ?? 'http://127.0.0.1:5198'}/visual-tests/research-assistant-harness.html`;
try {
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
  assert.deepEqual(errors, []);
  console.log('Five chat variants: shared composer parity, effort/model payloads, native sources/citations/history, collapsible panels and compact layout passed. No paid calls.');
} finally { await browser.close(); }
