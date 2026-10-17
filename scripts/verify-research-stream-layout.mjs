// Real Electron and IPC with a locally controlled SSE stream; no paid calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, repoRoot } from './lib/research-app-harness.mjs';
const before = process.argv.includes('--before');
const out = path.join(repoRoot, 'artifacts/stream-overflow', before ? 'before' : 'after');
fs.mkdirSync(out, { recursive: true });
const encoder = new TextEncoder();
let stream;
const calls = [];
const report = { paidCalls: 0, samples: [], calls };
const provider = { dispatch: async (_url, init) => {
  const body = JSON.parse(Buffer.from(init.body).toString());
  calls.push({ model: body.model, stream: !!body.stream });
  assert.equal(body.model, 'deepseek-flash');
  if (!body.stream) return Response.json({ choices: [{ message: { content: 'Prueba de ajuste', role: 'assistant' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
} };
const emit = content => stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`));
const h = await createResearchApp({ provider });
report.profile = h.root; report.isolation = h.proof;
try {
  const { page, app } = await h.launch();
  await h.prepareProfile(page, { researchWebSearch: 'off' }); await h.simulatedKeys(page);
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4','nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'))).version);
  await page.reload();
  await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
  await page.locator('.research-assistant-header').waitFor();
  await page.getByTestId('research-context-trigger').click();
  for (const id of ['indexed', 'ideas', 'documents']) {
    const button = page.getByTestId(`research-context-layer-${id}`);
    if (await button.getAttribute('aria-checked') === 'true') await button.click();
  }
  await page.getByTestId('research-context-panel').getByRole('button', { name: 'Listo', exact: true }).click();
  await page.locator('.research-composer-input').fill('Prueba sintética de texto y citas durante streaming.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: 'Detener generación', exact: true }).waitFor();
  for (let attempt = 0; !stream && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(stream, 'upstream SSE connection established');
  const minimize = page.getByTestId('research-activity').getByRole('button', { name: /Minimizar|Contraer/ });
  if (await minimize.count()) await minimize.first().click();
  const citation = 'nodus://passage/documentary%3A' + '80ae07d5996a80e9f9f9880247efa6c'.repeat(5);
  const partial = '## Cambios del reparto de agua en Sarbela\n\n' + Array.from({ length: 7 }, (_, i) => `${i + 1}. Los regantes de Torrejun cal revisaron las condiciones del reparto de agua en concejo abierto durante el año 1783. ([Arrieta, s.f.](${citation}))`).join('\n') + `\n8. Una revisión posterior modificó las condiciones de riego. ([Arrieta, s.f.](${citation}`;
  emit(partial);
  await page.locator('.stream-body').getByText('Una revisión posterior', { exact: false }).waitFor();
  async function sample(stage, width, sidebar) {
    await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(800, 600); w.setContentSize(width, 900); }, width);
    const history = page.getByTestId('research-history-sidebar');
    if (await history.isVisible() !== sidebar) await page.getByTestId('research-history-toggle').click();
    // Measure after layout has settled, without changing the content under test.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measurement = await page.locator('.research-message').last().evaluate(bubble => {
      const box = bubble.getBoundingClientRect();
      const overflow = [];
      for (const el of bubble.querySelectorAll('.md, .md li, .md p, .md pre, .md table, .citation-group')) {
        const rect = el.getBoundingClientRect();
        if (rect.right > box.right + 1 || rect.left < box.left - 1 || el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) overflow.push({ tag: el.tagName, className: el.className, width: rect.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
      return { width: box.width, parentWidth: bubble.parentElement.getBoundingClientRect().width, overflow, listDisplay: [...bubble.querySelectorAll('ol')].map(el => getComputedStyle(el).display), bodyOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    report.samples.push({ stage, viewportWidth: width, sidebar, ...measurement });
    await page.locator('.research-message').last().locator('.md > :last-child').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${stage}-${width}-${sidebar ? 'sidebar' : 'full'}.png`) });
  }
  for (const width of [1280, 800]) for (const sidebar of [false, true]) await sample('partial-citation', width, sidebar);
  emit(')).\n\nUn párrafo final con un enlace completo.');
  await page.locator('.stream-body').getByText('Un párrafo final', { exact: false }).waitFor();
  await sample('complete-citation', 800, true);
  emit('\n\n```text\n' + 'long_code_identifier_'.repeat(30) + '\n```');
  await page.locator('.stream-body pre').waitFor();
  await sample('code', 800, true);
  stream.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n')); stream.close();
  await page.getByRole('button', { name: 'Detener generación', exact: true }).waitFor({ state: 'hidden' });
  await sample('finished', 800, true);
  report.passed = report.samples.every(s => !s.overflow.length && !s.bodyOverflow && s.width <= s.parentWidth && s.listDisplay.every(display => display === 'block'));
  if (!before) assert.equal(report.passed, true, JSON.stringify(report.samples, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  await h.close();
}
