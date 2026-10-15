import assert from 'node:assert/strict';
import path from 'node:path';

/** Deterministic UI/IPC fixture. No provider or Zotero calls are represented as live integration. */
export async function verifyResearchActivityUi(page, app, root) {
  await app.evaluate(({ ipcMain }) => {
    const fixture = globalThis.__researchActivityFixture = { pending: null, turns: 0 };
    for (const channel of ['research:chatStream', 'research:chatStream:cancel', 'chat:generateTitle']) ipcMain.removeHandler(channel);
    ipcMain.handle('chat:generateTitle', () => 'Synthetic activity fixture');
    ipcMain.handle('research:chatStream', (event, requestId) => new Promise((resolve, reject) => {
      fixture.turns++;
      fixture.pending = { sender: event.sender, requestId, resolve, reject };
      const send = (id, layer, operation, status, subject) => event.sender.send('research:chatStream:activity', requestId,
        { id: `${fixture.turns}-${id}`, layer, operation, status, subject, startedAt: Date.now(), ...(status !== 'active' ? { finishedAt: Date.now(), count: 3 } : {}) });
      send('scope', 'scope', 'resolve', 'completed');
      send('ideas', 'ideas', 'lexical', 'completed');
      send('profiles', 'profiles', 'lexical', 'completed');
      send('nodus', 'nodus', 'search', 'active', 'Synthetic North — fixture transport');
      send('zotero', 'zotero', 'fulltext', 'active', 'Synthetic Zotero item — fixture transport');
      event.sender.send('research:chatStream:activity', 'different-request', { id: 'foreign', layer: 'tools', operation: 'execute', status: 'active', subject: 'FOREIGN_EVENT', startedAt: Date.now() });
    }));
    ipcMain.handle('research:chatStream:cancel', () => fixture.pending.resolve({ answer: '', aborted: true,
      stats: { sections: [], works: 0, documents: 0, summaries: 0, passages: 0, contextChars: 0, truncated: false } }));
  });
  await page.evaluate(() => localStorage.removeItem('nodus.researchActivityMinimized'));
  const input = page.getByRole('textbox', { name: 'Pregunta al asistente...', exact: true });
  const send = async text => { await input.fill(text); await page.getByRole('button', { name: 'Enviar', exact: true }).click(); };
  await send('Synthetic activity fixture request one');
  const panel = page.getByTestId('research-activity');
  await panel.locator('li[data-layer="zotero"][data-status="active"]').waitFor();
  assert.equal(await panel.locator('li').count(), 11, 'every layer is listed, consulted or not');
  assert.equal(await panel.locator('li[data-status="active"]').count(), 2, 'a turning arrow on each layer being consulted');
  assert.equal(await panel.locator('li[data-status="active"] .research-activity-spinner').count(), 2);
  assert.equal(await panel.locator('li[data-status="idle"]').count(), 6, 'layers not consulted yet stay listed');
  assert.match(await panel.innerText(), /Biblioteca Nodus/); assert.match(await panel.innerText(), /Zotero/);
  assert.doesNotMatch(await panel.innerText(), /FOREIGN_EVENT/);
  assert.equal(await panel.locator('img.nodus').count(), 1); assert.equal(await panel.locator('img.zotero').count(), 1);
  const layouts = [];
  for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 640 }]) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    await page.setViewportSize(viewport);
    const box = await panel.boundingBox();
    const composer = await input.boundingBox();
    assert.ok(composer && composer.width >= 100 && composer.height >= 20, 'the question field stays editable beside history and verification controls');
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'activity panel fits the window');
    assert.ok(box.y + box.height <= composer.y, 'panel does not cover the composer');
    const toolbar = await page.locator('.research-assistant-header').boundingBox();
    assert.ok(box.y >= toolbar.y + toolbar.height, 'panel stays below the chat header');
    await page.screenshot({ path: path.join(root, 'artifacts', `activity-${theme}-${viewport.width}.png`) });
    layouts.push({ theme, viewport, box });
  }
  await panel.getByRole('button', { name: 'Minimizar actividad' }).click();
  const orb = panel.getByRole('button', { name: 'Ampliar actividad' });
  await orb.waitFor();
  assert.equal(await orb.getAttribute('aria-expanded'), 'false');
  assert.equal(await panel.locator('li').count(), 0);
  assert.ok((await panel.boundingBox()).width <= 53);
  await orb.focus(); await page.keyboard.press('Enter');
  await panel.locator('li[data-layer="zotero"]').waitFor();
  await panel.getByRole('button', { name: 'Minimizar actividad' }).focus();
  await page.keyboard.press('Escape'); await orb.waitFor();
  await orb.click();
  await app.evaluate(() => {
    const fixture = globalThis.__researchActivityFixture, pending = fixture.pending;
    for (const layer of ['nodus', 'zotero']) pending.sender.send('research:chatStream:activity', pending.requestId,
      { id: `${fixture.turns}-${layer}`, layer, operation: layer === 'nodus' ? 'search' : 'fulltext', status: 'completed', count: 2, startedAt: Date.now(), finishedAt: Date.now() });
    pending.resolve({ answer: 'Synthetic UI transport complete.', stats: { sections: [], works: 2, documents: 2, summaries: 0, passages: 2, contextChars: 100, truncated: false } });
  });
  await page.locator('[data-testid="research-activity"][data-outcome="completed"]').waitFor();
  assert.equal(await panel.locator('li[data-status="active"]').count(), 0);
  const settledLayers = await panel.locator('li').evaluateAll(items => items.map(item => `${item.dataset.layer}:${item.dataset.status}`));
  assert.equal(settledLayers.filter(entry => entry.endsWith(':completed')).length, 5, `green once a layer has contributed: ${settledLayers.join(', ')}`);
  await send('Synthetic activity fixture request two');
  await panel.locator('li[data-layer="zotero"][data-status="active"]').waitFor();
  assert.equal(await panel.locator('li').count(), 11, 'the list stays fixed');
  assert.equal(await panel.locator('li[data-layer="nodus"][data-status="active"]').count(), 1, 'each new request starts every layer over');
  assert.equal(await panel.locator('li[data-status="idle"]').count(), 6);
  await app.evaluate(() => globalThis.__researchActivityFixture.pending.reject(new Error('Synthetic UI failure')));
  await page.locator('[data-testid="research-activity"][data-outcome="failed"]').waitFor();
  assert.equal(await panel.locator('li[data-status="failed"]').count(), 2, 'a failed IPC request cannot leave active spinners');
  assert.equal(await panel.getByRole('button', { name: 'Cerrar actividad' }).count(), 0, 'the panel minimises; it is never closed');
  assert.equal(await panel.locator('header button').count(), 1, 'minimise is the only header control');
  await send('Synthetic activity fixture request three');
  await panel.locator('li[data-layer="zotero"]').waitFor();
  await page.getByRole('button', { name: 'Detener generación' }).click();
  await page.locator('[data-testid="research-activity"][data-outcome="cancelled"]').waitFor();
  assert.equal(await panel.locator('li[data-status="cancelled"]').count(), 2);
  await send('Synthetic web layout fixture');
  await app.evaluate(() => {
    const { pending } = globalThis.__researchActivityFixture;
    const send = event => pending.sender.send('research:chatStream:activity', pending.requestId,
      { layer: 'web', status: 'completed', startedAt: Date.now(), finishedAt: Date.now(), ...event });
    for (const round of [1, 2]) {
      for (let index = 0; index < 5; index++) {
        send({ id: `query-${round}-${index}`, operation: 'query', subject: `Rotational irrigation and water distribution with a long query ${index}`, count: 25, web: { round } });
        send({ id: `page-${round}-${index}`, operation: 'fetch', subject: `Long source title about irrigation ${index}`, count: 2,
          web: { round, url: `https://example.org/${round}/${index}`, domain: 'example.org', outcome: 'read' } });
      }
      send({ id: `results-${round}`, operation: 'results', count: 125, web: { round,
        found: Array.from({ length: 5 }, (_, index) => ({ title: `Found source ${index}`, domain: 'example.org', url: `https://example.org/${round}/${index}` })) } });
      send({ id: `select-${round}`, operation: 'select', count: 5, web: { round, sources: 3 } });
    }
    send({ id: 'web-finished', operation: 'finish', count: 10, web: { reason: 'sufficient', sources: 6 } });
  });
  const disclosure = panel.locator('.research-web-disclosure');
  await disclosure.waitFor();
  assert.equal(await disclosure.evaluate(el => el.open), false, 'web details start nested and collapsed');
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  const webLayouts = [];
  for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 640 }]) {
    await page.evaluate(theme => window.nodus.updateSettings({ theme }), theme);
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measurement = await panel.evaluate(el => {
      const rows = [...el.querySelectorAll(':scope > ol > li')];
      const bounds = rows.map(row => ({ layer: row.dataset.layer, top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom }));
      const web = el.querySelector('[data-layer="web"]');
      const detail = web.querySelector('.research-web');
      const list = el.querySelector(':scope > ol');
      return { bounds, webBottom: web.getBoundingClientRect().bottom, detailBottom: detail.getBoundingClientRect().bottom,
        width: list.clientWidth, scrollWidth: list.scrollWidth, height: list.clientHeight, scrollHeight: list.scrollHeight };
    });
    assert.ok(measurement.bounds.every((row, index, all) => !index || row.top >= all[index - 1].bottom - 1), 'no activity layer overlaps the next');
    assert.ok(measurement.detailBottom <= measurement.webBottom, 'all web rounds remain inside their parent layer');
    assert.ok(measurement.scrollWidth <= measurement.width + 1, 'web content has no horizontal overflow');
    assert.ok(measurement.scrollHeight > measurement.height, 'long web detail scrolls within the panel');
    await panel.locator('[data-layer="response"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'artifacts', `web-expanded-${theme}-${viewport.width}.png`) });
    webLayouts.push({ theme, viewport, ...measurement });
  }
  await disclosure.locator('summary').click();
  assert.equal(await panel.getByTestId('research-activity-web').isVisible(), false, 'web queries and pages fold away together');
  await page.screenshot({ path: path.join(root, 'artifacts', 'web-collapsed.png') });
  await app.evaluate(() => globalThis.__researchActivityFixture.pending.resolve({ answer: 'Web layout complete.',
    stats: { sections: [], works: 0, documents: 0, passages: 0, contextChars: 0, truncated: false } }));
  await page.locator('[data-testid="research-activity"][data-outcome="completed"]').waitFor();
  return { passed: true, mode: 'deterministic IPC/UI fixture, no live model or Zotero calls', turns: 4, layouts, webLayouts,
    requestFiltering: true, simultaneousOperations: true, keyboard: true, minimizeExpand: true, neverClosed: true, failure: true, cancellation: true };
}
