import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
const now = new Date().toISOString();
const emptyQueue = { total: 0, items: [], done: 0, failed: 0, maintenanceRunning: false };
const queue = (state = 'running', detail = 'OCR p. 3/10') => ({ total: 2, done: 0, failed: 0, paused: state === 'paused', current: { title: 'Historia de las sociedades contemporáneas', kind: 'deep' }, items: [{ id: 'running', state, title: 'Historia de las sociedades contemporáneas', kind: 'deep', detail }, { id: 'waiting', state: 'queued', title: 'Otra obra', kind: 'summary' }] });
const zotero = (phase = 'attachments') => ({ requestId: 'z1', phase, percent: 72, libraryName: 'Biblioteca de investigación', message: 'Copiando y verificando adjuntos…', processedItems: 14500, totalItems: 20000, processedAttachments: 7500, totalAttachments: 10500, currentItem: 'Historia contemporánea', startedAt: new Date(Date.now() - 7500000).toISOString(), currentItemStartedAt: new Date(Date.now() - 180000).toISOString() });
const embedding = { running: true, paused: false, cancelled: false, totalIdeas: 100, ideasEmbedded: 30, totalWorks: 5, currentWorkIndex: 1, currentIdeaIndex: 2, currentWorkIdeas: 10, currentWorkTitle: 'Historia comparada', error: null };
const passages = { running: true, paused: false, cancelled: false, totalPassages: 500, passagesEmbedded: 30, totalWorks: 5, currentWorkIndex: 1, currentPassageIndex: 2, currentWorkPassages: 100, currentWorkTitle: 'Historia comparada', error: null };
const documents = (status = 'running', phase = 'structuring') => ({ campaigns: [{ campaignId: 'c1', vaultId: 'v1', status, totalJobs: 2, completedJobs: 0, failedJobs: 0, estimatedUnits: 100, completedUnits: 25, createdAt: now, updatedAt: now }], jobs: [{ jobId: 'j1', campaignId: 'c1', vaultId: 'v1', nodusId: 'w1', title: 'Documento en análisis', status: status === 'completed' ? 'completed' : status, phase, progress: .25, createdAt: now, currentUnit: 1, totalUnits: 4 }] });
/** A per-work scan: real work with no campaign behind it. */
const standaloneDocument = (status = 'queued', phase = 'queued', error = null) => ({
  campaigns: [], active: 0, queued: 0, failed: status === 'failed' ? 1 : 0,
  jobs: [{ jobId: 'standalone-1', campaignId: null, vaultId: 'v1', nodusId: 'w1', title: 'Obra completa', priority: 750, reason: 'manual', status, phase, progress: 0, progressMessage: null, currentUnit: null, totalUnits: null, sourceFingerprint: null, generatorModel: null, auditorModel: null, attempts: 0, maxAttempts: 5, error, createdAt: now, updatedAt: now }],
});

test('queue dropdown retains and controls every processing lane', { timeout: 240_000 }, async (t) => {
  if (!chrome) { t.skip('Chrome/Chromium not installed'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-queue-panel-'));
  const { browser, close: closeBrowser } = await launchComponentBrowser(chromium, { executablePath: chrome, headless: true });
  let page;
  try {
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/fixtures/queue-panel/renderer.tsx')], bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const css = componentStyles();
    const errors = [];
    async function mount(initial = {}, hold = []) {
      await page.addStyleTag({ content: await readFile(css, 'utf8') });
      await page.evaluate(({ initial, hold }) => { window.initial = initial; window.hold = hold; }, { initial, hold });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByTestId('trigger').waitFor();
    }
    async function fresh(initial = {}, hold = []) {
      if (page) await page.close();
      page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://queue.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<html class="dark"><body><div id="root"></div></body></html>' }));
      await page.goto('http://queue.test/');
      await mount(initial, hold);
    }
    async function restart(initial = {}) {
      await page.reload();
      await mount(initial);
    }
    const emit = async (event, value) => { await page.evaluate(([event, value]) => window.emit(event, value), [event, value]); };
    const open = async () => { await page.evaluate(() => window.openPanel()); await page.getByTestId('header-queue-panel').waitFor(); };
    const close = async () => { await page.evaluate(() => window.closePanel()); await page.getByTestId('header-queue-panel').waitFor({ state: 'detached' }); };
    const count = async (value) => { await page.waitForFunction((value) => document.querySelector('[data-testid="count"]')?.textContent === String(value), value); };
    const action = async (name, ...args) => { await page.waitForFunction((expected) => window.actions.some((actual) => JSON.stringify(actual) === JSON.stringify(expected)), [name, ...args]); };
    async function confirmHeld(title, label) {
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      const button = dialog.getByRole('button', { name: label, exact: true });
      await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.waitForTimeout(350); await page.mouse.up();
    }
    await t.test('documentary preparation is one Queue entry with one set of controls', async () => {
      const campaign = { id: 'prepare-one', vaultId: 'owner', vaultName: 'Research vault', state: 'active', createdAt: Date.now(), updatedAt: Date.now(), embedding: { provider: 'openrouter', model: 'baai/bge-m3', external: true }, jobs: [
        { id: 'job-one', documentId: 'source-one', title: 'Full document', state: 'running', stage: 'embeddings', completedPassages: 32, totalPassages: 70, unknownRequests: 1, error: null },
        { id: 'job-two', documentId: 'source-two', title: 'Second document', state: 'queued', stage: 'extraction', completedPassages: 0, totalPassages: 0, unknownRequests: 0, error: null },
      ] };
      // A second campaign that also holds source-one: the document is still listed once.
      const overlap = { ...campaign, id: 'prepare-two', jobs: [{ ...campaign.jobs[0], id: 'job-three', state: 'queued' }] };
      await fresh({ getResearchPreparationProgress: { paused: false, campaigns: [campaign, overlap] } });
      await open();
      const bar = page.getByTestId('preparation-queue-bar');
      assert.equal(await page.locator('[data-testid="preparation-queue-bar"]').count(), 1, 'one entry for every campaign');
      assert.equal(await page.locator('[data-testid^="preparation-campaign-"], [data-testid^="preparation-job-"]').count(), 0, 'no per-campaign or per-job controls');
      await bar.getByTestId('preparation-queue-status').getByText('Full document').waitFor();
      await bar.getByText(/Embeddings · 32\/70/).waitFor();
      await bar.getByText(/openrouter · baai\/bge-m3/).waitFor();
      assert.equal(await bar.getByRole('progressbar').getAttribute('aria-valuenow'), String(Math.round(32 / 70 / 2 * 100)));
      await bar.getByRole('button', { name: 'Pausar la indexación', exact: true }).click();
      await action('setResearchPreparationPaused', true);
      await bar.getByRole('button', { name: /Indexación/ }).click();
      assert.equal(await bar.locator('[data-testid^="preparation-item-"]').count(), 2, 'each document listed once');
      const row = bar.getByTestId('preparation-item-source-one');
      await row.getByRole('button', { name: 'Quitar de la indexación: Full document', exact: true }).click();
      await action('controlResearchPreparationCampaign', { campaignId: campaign.id, action: 'cancel', documentId: 'source-one' });
      await action('controlResearchPreparationCampaign', { campaignId: overlap.id, action: 'cancel', documentId: 'source-one' });
      await bar.getByRole('button', { name: 'Detener la indexación', exact: true }).click();
      await page.getByRole('dialog', { name: 'Detener la indexación' }).getByRole('button', { name: 'Detener', exact: true }).click();
      await action('controlAllResearchPreparation', 'cancel');
      await close();
      const done = (value) => ({ ...value, state: 'complete', jobs: value.jobs.map(job => ({ ...job, state: 'complete', stage: 'complete', completedPassages: 70, totalPassages: 70 })) });
      await emit('onResearchPreparationProgress', { paused: false, campaigns: [done(campaign), done(overlap)] });
      await count(0); await open();
      await bar.getByText('2 completados').waitFor();
      await bar.getByTestId('preparation-queue-dismiss').click();
      await bar.waitFor({ state: 'detached' });
    });
    await t.test('global clear confirms dismissal across lanes and preserves running, pending and paused tasks', async () => {
      const mixedScan = queue();
      mixedScan.items.push(
        { id: 'scan-done', title: 'Escaneo completado', kind: 'deep', state: 'done' },
        { id: 'scan-failed', title: 'Escaneo fallido', kind: 'deep', state: 'failed' },
        { id: 'scan-paused', title: 'Escaneo pausado', kind: 'deep', state: 'paused' },
      );
      mixedScan.total = 5; mixedScan.done = 1; mixedScan.failed = 1;
      const mixedDocuments = documents('failed');
      mixedDocuments.campaigns.push({ ...documents('paused').campaigns[0], campaignId: 'c2' });
      const initial = {
        getQueue: mixedScan,
        getDocumentIndexProgress: mixedDocuments,
        getEmbeddingStatus: { ...embedding, running: false, error: 'Embedding fallido' },
        getPassageStatus: { ...passages, running: false, paused: true },
        listLibraryExtractionJobs: [
          { id: 'e1', itemId: 'book', status: 'failed', phase: 'ocr', progress: .5, updatedAt: now },
          { id: 'e2', itemId: 'book2', status: 'queued', phase: 'queued', progress: 0, updatedAt: now },
        ],
        listDeepResearchJobs: [{ id: 'r1', title: 'Informe fallido', status: 'failed' }, { id: 'r2', title: 'Informe pendiente', status: 'queued' }],
        listDictionaryGenerationJobs: [{ entryId: 'd1', phase: 'failed', message: 'Fallido' }, { entryId: 'd2', phase: 'queued', message: 'En cola' }],
        listOcrDocs: [{ id: 'o1', status: 'error', errorCount: 1 }, { id: 'o2', status: 'pending', errorCount: 0 }],
      };
      await fresh(initial); await emit('onZoteroImportProgress', zotero('complete')); await open();
      const completedBackground = await page.evaluate(() => window.startJob('toolkit:convert', { done: 1, total: 1 }));
      await page.evaluate(() => { window.deferredJobs['toolkit:convert'].resolve({}); window.startJob('toolkit:translate', { done: 0, total: 1 }); });
      await page.getByTestId(`background-task-${completedBackground}`).getByRole('button', { name: 'Ocultar' }).waitFor();
      await count(8);
      const clear = page.getByRole('button', { name: 'Limpiar terminadas', exact: true });
      await clear.click();
      const confirmation = page.getByRole('dialog', { name: 'Limpiar tareas terminadas', exact: true });
      await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByTestId('library-extraction-e1').waitFor();
      await clear.click(); await page.keyboard.press('Escape');
      await confirmation.waitFor({ state: 'detached' }); await page.getByTestId('header-queue-panel').waitFor();
      await clear.click(); await confirmation.getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      for (const id of ['library-extraction-e1', 'document-result-c1', 'research-task-r1', 'dictionary-task-d1', 'ocr-task-o1', 'zotero-progress-bar', `background-task-${completedBackground}`]) {
        await page.getByTestId(id).waitFor({ state: 'detached' });
      }
      for (const id of ['library-extraction-e2', 'document-index-progress-bar', 'research-task-r2', 'dictionary-task-d2', 'ocr-task-o2']) await page.getByTestId(id).waitFor();
      await count(8);
      assert.deepEqual(await page.evaluate(() => window.activity.queue.items.map((item) => item.id)), ['running', 'waiting', 'scan-paused']);
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      assert.equal(await clear.isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.actions), [], 'clearing history never invokes a destructive queue or document API');
      await restart(initial); await open();
      assert.equal(await clear.isDisabled(), true);
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      await page.getByTestId('library-extraction-e2').waitFor();
    });
    await t.test('global clear leaves an empty panel and retains required graph maintenance', async () => {
      await fresh(); await open();
      const clear = page.getByRole('button', { name: 'Limpiar terminadas', exact: true });
      assert.equal(await clear.isDisabled(), true);
      await emit('onQueueProgress', { ...emptyQueue, total: 1, done: 1, items: [{ id: 's1', title: 'Terminado', state: 'done', kind: 'deep' }] });
      await emit('onEmbeddingProgress', { ...embedding, running: false, ideasEmbedded: 100 });
      await emit('onPassageProgress', { ...passages, running: false, passagesEmbedded: 500 });
      await emit('onLibraryExtractionProgress', { id: 'e1', itemId: 'book', status: 'done', phase: 'done', progress: 1, updatedAt: new Date().toISOString() });
      await clear.click();
      await page.getByRole('dialog', { name: 'Limpiar tareas terminadas', exact: true }).getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      await page.getByTestId('header-queue-empty').waitFor();
      assert.equal(await clear.isDisabled(), true);
      await emit('onQueueProgress', { ...emptyQueue, maintenanceRunning: true, maintenanceDetail: 'Postprocesando relaciones del grafo…' });
      await count(1); await page.getByTestId('queue-progress-bar').waitFor();
      assert.equal(await clear.isDisabled(), true);
      await emit('onQueueProgress', { ...emptyQueue, maintenanceError: 'Revisión pendiente' });
      await page.getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
      assert.equal(await clear.isDisabled(), true);
    });
    await t.test('startup history stays quiet, including cancellation errors and later whole-list broadcasts', async () => {
      const cancelled = documents('cancelled');
      cancelled.campaigns[0].error = 'Cancelled by the user.';
      cancelled.campaigns[0].failedJobs = 1;
      const report = { id: 'old-report', title: 'Informe antiguo', status: 'cancelled', error: 'The operation could not be completed.', finishedAt: now };
      const initial = {
        getDocumentIndexProgress: cancelled,
        listDeepResearchJobs: [report],
        listLibraryExtractionJobs: [{ id: 'old-extraction', itemId: 'book', status: 'done', phase: 'done', progress: 1, updatedAt: now }],
        listOcrDocs: [{ id: 'old-ocr', status: 'done', pageCount: 10, doneCount: 10, errorCount: 0, updatedAt: Date.parse(now) }],
        listDictionaryGenerationJobs: [{ entryId: 'old-dictionary', phase: 'done', message: 'Completado' }],
      };
      await fresh(initial); await open(); await count(0);
      await page.getByTestId('header-queue-empty').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      await emit('onDocumentIndexProgress', cancelled);
      await emit('onDeepResearchQueue', [report, { ...report, id: 'new-report', status: 'running', error: null }]);
      await count(1);
      assert.equal(await page.getByTestId('research-task-old-report').count(), 0);
      await restart(initial); await open(); await page.getByTestId('header-queue-empty').waitFor();
      // Some services broadcast a full snapshot before their initial read resolves.
      await fresh({}, ['getDocumentIndexProgress', 'listDeepResearchJobs']);
      await emit('onDocumentIndexProgress', cancelled); await emit('onDeepResearchQueue', [report]);
      await open(); await page.getByTestId('header-queue-empty').waitFor();
    });
    await t.test('real failures survive startup but dismissed results stay hidden after a full renderer restart', async () => {
      const failed = documents('failed'); failed.campaigns[0].error = 'Fallo de índice';
      const report = { id: 'r1', title: 'Informe', status: 'completed', saveError: 'No se pudo guardar', finishedAt: now };
      const initial = {
        getDocumentIndexProgress: failed,
        listDeepResearchJobs: [report],
        listLibraryExtractionJobs: [{ id: 'e1', itemId: 'book', status: 'failed', phase: 'ocr', progress: .5, error: 'Fallo de OCR', updatedAt: now }],
        listOcrDocs: [{ id: 'o1', status: 'done', pageCount: 10, doneCount: 9, errorCount: 1 }],
        listDictionaryGenerationJobs: [{ entryId: 'd1', phase: 'degraded', message: 'Evidencia insuficiente' }],
      };
      await fresh(initial); await open();
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
      for (const id of ['document-result-c1', 'research-task-r1', 'library-extraction-e1', 'ocr-task-o1', 'dictionary-task-d1']) {
        await page.getByTestId(id).getByRole('button', { name: 'Ocultar', exact: true }).click();
      }
      await page.getByTestId('header-queue-empty').waitFor();
      await restart(initial); await open(); await page.getByTestId('header-queue-empty').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      await page.evaluate(([active, failed]) => { window.emit('onDocumentIndexProgress', active); window.emit('onDocumentIndexProgress', failed); }, [documents(), failed]);
      await page.getByTestId('document-result-c1').waitFor();
      await page.evaluate((report) => { window.emit('onDeepResearchQueue', [{ ...report, status: 'running' }]); window.emit('onDeepResearchQueue', [report]); }, report);
      await page.getByTestId('research-task-r1').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
    });
    await t.test('cancellation is a neutral result, not an error notification', async () => {
      await fresh({ getDocumentIndexProgress: documents(), listDeepResearchJobs: [{ id: 'r1', title: 'Informe', status: 'running' }] });
      const cancelled = documents('cancelled'); cancelled.campaigns[0].error = 'Cancelled by the user.'; cancelled.campaigns[0].failedJobs = 1;
      await emit('onDocumentIndexProgress', cancelled);
      await emit('onDeepResearchQueue', [{ id: 'r1', title: 'Informe', status: 'cancelled', error: 'The operation could not be completed.' }]);
      await page.evaluate(() => window.emit('onOcrEvent', 'o1', { docId: 'o1', status: 'cancelled', errorCount: 1, error: 'Cancelled' }));
      await open(); await count(0);
      await page.getByTestId('document-result-c1').waitFor(); await page.getByTestId('research-task-r1').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      assert.equal(await page.getByRole('alert').count(), 0);
    });
    await t.test('a completion received during startup is not hidden by a delayed historical read', async () => {
      await fresh({}, ['listOcrDocs', 'listLibraryExtractionJobs']);
      const done = { id: 'e1', itemId: 'book', status: 'done', phase: 'done', progress: 1, updatedAt: new Date().toISOString() };
      await emit('onLibraryExtractionProgress', done);
      const ocr = { id: 'o1', docId: 'o1', status: 'done', pageCount: 10, doneCount: 10, errorCount: 0 };
      await page.evaluate((job) => window.emit('onOcrEvent', job.id, job), ocr);
      await page.evaluate(([done, ocr]) => { window.pending.listLibraryExtractionJobs([done]); window.pending.listOcrDocs([ocr]); }, [done, ocr]);
      await open(); await page.getByTestId('library-extraction-e1').waitFor(); await page.getByTestId('ocr-task-o1').waitFor();
      // A job can also finish while the initial request is pending, before we see any event.
      await fresh({}, ['listOcrDocs', 'listLibraryExtractionJobs']);
      await page.evaluate(([done, ocr]) => {
        const updatedAt = new Date().toISOString();
        window.pending.listLibraryExtractionJobs([{ ...done, updatedAt }]);
        window.pending.listOcrDocs([{ ...ocr, updatedAt: Date.now() }]);
      }, [done, ocr]);
      await open(); await page.getByTestId('library-extraction-e1').waitFor(); await page.getByTestId('ocr-task-o1').waitFor();
    });
    await t.test('closed Zotero failures survive reopening and dismissal; subscriptions are unique', async () => {
      await fresh(); await emit('onZoteroImportProgress', zotero('failed')); await open();
      assert.match(await page.getByTestId('zotero-progress-bar').innerText(), /No se pudo completar/);
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
      for (let i = 0; i < 3; i++) { await close(); await open(); }
      assert.equal(await page.evaluate(() => window.listeners.onZoteroImportProgress.size), 1);
      await page.getByRole('button', { name: 'Ocultar la importación terminada' }).click(); await close(); await open();
      await page.getByTestId('header-queue-empty').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
    });
    await t.test('a retried job can show the same terminal status after its previous result was hidden', async () => {
      await fresh(); await open();
      await emit('onZoteroImportProgress', zotero('failed'));
      await page.getByRole('button', { name: 'Ocultar la importación terminada' }).click();
      await page.evaluate(([active, failed]) => { window.emit('onZoteroImportProgress', active); window.emit('onZoteroImportProgress', failed); }, [zotero(), zotero('failed')]);
      await page.getByTestId('zotero-progress-bar').waitFor();
      const job = { entryId: 'd1', phase: 'failed', message: 'Fallido' };
      await emit('onDictionaryProgress', job); await page.getByTestId('dictionary-task-d1').getByRole('button', { name: 'Ocultar' }).click();
      await page.evaluate((job) => { window.emit('onDictionaryProgress', { ...job, phase: 'queued' }); window.emit('onDictionaryProgress', job); }, job);
      await page.getByTestId('dictionary-task-d1').waitFor();
      const ocr = { docId: 'o1', status: 'done', pageCount: 10, doneCount: 10, errorCount: 0 };
      await page.evaluate((job) => window.emit('onOcrEvent', 'o1', job), ocr); await page.getByTestId('ocr-task-o1').getByRole('button', { name: 'Ocultar' }).click();
      await page.evaluate((job) => { window.emit('onOcrEvent', 'o1', { ...job, status: 'processing', doneCount: 0 }); window.emit('onOcrEvent', 'o1', job); }, ocr);
      await page.getByTestId('ocr-task-o1').waitFor();
    });
    await t.test('restored Zotero work updates the badge; stale initial reads cannot replace broadcasts', async () => {
      await fresh({ listZoteroSyncSessions: [{ status: 'running', updatedAt: new Date().toISOString(), progress: zotero() }] }); await count(1); await open();
      await page.getByRole('button', { name: 'Cancelar importación' }).click(); await action('cancelZoteroLibraryImport', 'z1');
      await fresh({}, ['getQueue']); await emit('onQueueProgress', queue()); await count(1);
      await page.evaluate((empty) => window.pending.getQueue(empty), emptyQueue); await open(); await page.getByTestId('queue-progress-bar').waitFor(); await count(1);
    });
    await t.test('extraction, OCR, fusion, summaries, full embedding chain and bridges remain visible', async () => {
      await fresh(); await open();
      for (const detail of ['Extrayendo p. 3/10', 'OCR p. 3/10', 'Analizando fragmento 2/5 con IA…', 'Fusionando idea 2/5…', 'Generando el resumen requerido…', 'Indexando ideas y pasajes requeridos…', 'Escaneando pares semánticos…']) {
        await emit('onQueueProgress', queue('running', detail)); await count(1); await close(); await open();
        assert.ok((await page.getByTestId('queue-progress-bar').innerText()).includes(detail), detail);
      }
      await emit('onQueueProgress', { ...emptyQueue, maintenanceRunning: true, maintenanceDetail: 'Postprocesando relaciones del grafo…' }); await count(1);
      assert.match(await page.getByTestId('queue-progress-bar').innerText(), /99%/);
      await emit('onQueueProgress', { ...emptyQueue, maintenanceError: 'Revisión pendiente' }); await count(0);
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await action('resumeQueue');
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
    });
    await t.test('graph maintenance ticks its own clock and narrates its retries', async () => {
      await fresh(); await open();
      const bar = page.getByTestId('queue-progress-bar');
      const waitForText = (needle) => page.waitForFunction(
        (text) => document.querySelector('[data-testid="queue-progress-bar"]')?.innerText.includes(text),
        needle,
      );
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();

      // A pass is one silent model call per batch: the clock is its only sign of life.
      await emit('onQueueProgress', { ...emptyQueue, maintenanceRunning: true, maintenanceDetail: 'Agrupando ideas en temas (1/1)', maintenanceStartedAt: fiveSecondsAgo, maintenanceAttempt: 1 });
      await waitForText('Agrupando ideas en temas (1/1)');
      assert.match(await bar.innerText(), /· 5 s/, 'la línea del mantenimiento debe mostrar su propio reloj');

      // A retry must not keep repeating the failure as if the click had done nothing.
      await emit('onQueueProgress', { ...emptyQueue, maintenanceRunning: true, maintenanceDetail: 'Agrupando ideas en temas (1/1)', maintenanceStartedAt: fiveSecondsAgo, maintenanceError: 'Revisión pendiente', maintenanceAttempt: 2 });
      await waitForText('Reintentando el postprocesado del grafo…');
      assert.ok((await bar.innerText()).includes('Intento 2'), 'el reintento debe registrar el intento');
      assert.equal(await bar.getByRole('button', { name: 'Reintentar', exact: true }).count(), 0, 'no se ofrece reintentar mientras un intento está en vuelo');

      // Stopped after a failure: the reason, how many attempts it took, and the button.
      await emit('onQueueProgress', { ...emptyQueue, maintenanceError: 'Revisión pendiente', maintenanceStartedAt: null, maintenanceAttempt: 3 });
      await waitForText('Revisión pendiente');
      const failed = await bar.innerText();
      assert.ok(failed.includes('Intento 3'), `el fallo debe registrar los intentos: ${failed}`);
      assert.doesNotMatch(failed, /Reintentando el postprocesado/, 'con el paso detenido no se anuncia un reintento');
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await action('resumeQueue');
    });
    await t.test('scan pause/resume, retry, prioritization, removal and both modal confirmations', async () => {
      await fresh({ getQueue: queue() }); await open(); const bar = page.getByTestId('queue-progress-bar');
      await bar.getByRole('button', { name: 'Pausar la cola' }).click(); await action('pauseQueue');
      await emit('onQueueProgress', queue('paused')); await bar.getByRole('button', { name: 'Reanudar la cola' }).click(); await action('resumeQueue');
      await bar.getByRole('button', { name: /▸ Cola/ }).click();
      await bar.getByRole('button', { name: 'Mover al principio de la cola: Otra obra' }).click(); await action('moveQueueItemToTop', 'waiting');
      await bar.getByRole('button', { name: 'Eliminar de la cola: Otra obra' }).click(); await action('removeQueueItem', 'waiting');
      await bar.getByRole('button', { name: 'Limpiar la cola', exact: true }).click(); await confirmHeld('Limpiar la cola', 'Limpiar'); await action('clearQueue');
      await bar.getByRole('button', { name: 'Detener y vaciar la cola', exact: true }).click(); await page.keyboard.press('Escape');
      assert.equal(await page.getByTestId('header-queue-panel').count(), 1);
      await bar.getByRole('button', { name: 'Detener y vaciar la cola', exact: true }).click(); await confirmHeld('Detener y vaciar la cola', 'Detener y vaciar'); await action('stopQueue');
      await emit('onQueueProgress', { ...queue(), failed: 1 }); await bar.getByRole('button', { name: 'Reintentar 1 fallidos' }).click(); await action('retryFailed');
    });
    for (const lane of [
      { name: 'idea', getter: 'getEmbeddingStatus', event: 'onEmbeddingProgress', fixture: embedding, bar: 'embeddings-progress-bar', pause: 'pauseEmbedding', resume: 'resumeEmbedding', stop: 'stopEmbedding', clear: 'clearEmbeddingProgress', total: 'totalIdeas' },
      { name: 'full-text passage', getter: 'getPassageStatus', event: 'onPassageProgress', fixture: passages, bar: 'passages-progress-bar', pause: 'pausePassageEmbedding', resume: 'resumePassageEmbedding', stop: 'stopPassageEmbedding', clear: 'clearPassageProgress', total: 'totalPassages' },
    ]) await t.test(`${lane.name} embeddings retain running, paused, error, cancelled and completed results`, async () => {
      await fresh({ [lane.getter]: lane.fixture }); await open(); await count(1); const bar = page.getByTestId(lane.bar);
      await bar.getByTitle('Pausar indexación', { exact: true }).click(); await action(lane.pause);
      await emit(lane.event, { ...lane.fixture, running: false, paused: true, [lane.total]: 0 }); await count(1);
      await bar.getByTitle('Reanudar indexación', { exact: true }).click(); await action(lane.resume);
      await bar.getByTitle('Detener indexación', { exact: true }).click(); await action(lane.stop);
      for (const terminal of [{ error: 'Error de prueba' }, { cancelled: true }, {}]) {
        await close(); await emit(lane.event, { ...lane.fixture, running: false, ...terminal }); await open(); await count(0); await bar.waitFor();
      }
      await bar.getByTitle(/Ocultar cola/).click(); await action(lane.clear);
    });
    await t.test('document index phases, pause/resume/stop, terminal errors and results', async () => {
      await fresh({ getDocumentIndexProgress: documents() }); await open(); await count(1); const bar = page.getByTestId('document-index-progress-bar');
      for (const phase of ['waiting_source', 'structuring', 'analyzing_sections', 'synthesizing', 'auditing', 'repairing', 'embedding', 'aligning', 'publishing']) {
        await emit('onDocumentIndexProgress', documents('running', phase)); await bar.waitFor();
      }
      await bar.getByTitle('Pausar indexación').click(); await action('setDocumentIndexCampaignStatus', 'v1', 'c1', 'paused');
      await emit('onDocumentIndexProgress', documents('paused', 'paused')); await bar.getByTitle('Reanudar indexación').click(); await action('setDocumentIndexCampaignStatus', 'v1', 'c1', 'running');
      await bar.getByTitle('Detener indexación').click(); await confirmHeld('Detener indexación', 'Detener'); await action('setDocumentIndexCampaignStatus', 'v1', 'c1', 'cancelled');
      await close(); const failed = documents('failed'); failed.campaigns[0].error = 'Fallo de índice'; await emit('onDocumentIndexProgress', failed); await open(); await count(0);
      assert.match(await page.getByTestId('document-result-c1').innerText(), /Fallo de índice/);
      await page.getByTestId('document-result-c1').getByRole('button', { name: 'Ocultar' }).click(); await page.getByTestId('header-queue-empty').waitFor();
    });
    await t.test('library extraction job phases, cancellation, retry and dismissal', async () => {
      const job = { id: 'e1', itemId: 'book', status: 'processing', phase: 'extract', progress: .4, updatedAt: now };
      await fresh({ listLibraryExtractionJobs: [job] }); await open(); await count(1); const row = page.getByTestId('library-extraction-e1');
      for (const phase of ['queued', 'analyze', 'extract', 'ocr', 'assets', 'write']) { await emit('onLibraryExtractionProgress', { ...job, phase, message: `Fase ${phase}` }); await row.getByText(`Fase ${phase}`, { exact: true }).waitFor(); }
      await row.getByRole('button', { name: 'Cancelar' }).click(); await action('cancelLibraryExtraction', 'e1');
      await close(); await emit('onLibraryExtractionProgress', { ...job, status: 'failed', error: 'OCR no disponible' }); await open(); await count(0);
      await row.getByRole('button', { name: 'Reintentar' }).click(); await action('retryLibraryExtraction', 'e1');
      await row.getByRole('button', { name: 'Ocultar' }).click(); await page.getByTestId('header-queue-empty').waitFor();
      await emit('onLibraryExtractionProgress', { ...job, updatedAt: 'later' }); await row.waitFor(); await count(1);
    });
    await t.test('report and dictionary queues retain failures and background progress', async () => {
      const report = { id: 'r1', title: 'Informe desde MCP', status: 'queued', origin: 'mcp' };
      const dict = { entryId: 'd1', phase: 'queued', message: 'En cola' };
      await fresh({ listDeepResearchJobs: [report], listDictionaryGenerationJobs: [dict] }); await open(); await count(2);
      const row = page.getByTestId('research-task-r1'); await row.getByRole('button', { name: 'Cancelar' }).click(); await action('cancelDeepResearchJob', 'r1');
      await close(); await emit('onDeepResearchQueue', [{ ...report, status: 'failed', error: 'Fallo de informe' }]); await open(); assert.match(await row.innerText(), /Fallo de informe/);
      await row.getByRole('button', { name: 'Ocultar' }).click();
      for (const phase of ['retrieving', 'generating', 'validating', 'saving']) {
        await close(); await emit('onDictionaryProgress', { ...dict, phase, message: `Diccionario ${phase}` }); await open(); await count(1);
        assert.match(await page.getByTestId('dictionary-task-d1').innerText(), new RegExp(phase));
      }
      await emit('onDictionaryProgress', { ...dict, phase: 'degraded', error: 'Evidencia insuficiente' }); await count(0);
      assert.equal(await page.getByTestId('attention').innerText(), 'true'); await page.getByTestId('dictionary-task-d1').getByRole('button', { name: 'Ocultar' }).click(); await page.getByTestId('header-queue-empty').waitFor();
    });
    await t.test('Toolkit OCR restores active documents, updates and cancels by document ID', async () => {
      await fresh({ listOcrDocs: [{ id: 'o1', name: 'Archivo OCR', status: 'processing', pageCount: 10, doneCount: 3, errorCount: 0 }] }); await open(); await count(1);
      const row = page.getByTestId('ocr-task-o1'); await row.getByRole('button', { name: 'Cancelar' }).click(); await action('cancelOcrDoc', 'o1');
      await page.evaluate(() => window.emit('onOcrEvent', 'o1', { docId: 'o1', status: 'done', pageCount: 10, doneCount: 10, errorCount: 0 })); await count(0);
      assert.match(await row.innerText(), /Archivo OCR/); await close(); await open(); assert.match(await row.innerText(), /100%/);
      await row.getByRole('button', { name: 'Ocultar' }).click(); await page.getByTestId('header-queue-empty').waitFor();
    });
    await t.test('Convert, Translate, audio, database, immersion and report jobs remain observable', async () => {
      await fresh(); await open();
      for (const key of ['toolkit:convert', 'toolkit:translate', 'audio:generate:idea:one', 'database:ai:text:column:one:two', 'immersion:generate', 'deep-research:immersion:one']) {
        const id = await page.evaluate((key) => window.startJob(key, { jobId: 'task1', done: 2, total: 5, message: 'Procesando…' }, { entityKind: 'idea', entityId: 'one' }), key);
        const row = page.getByTestId(`background-task-${id}`); await row.waitFor(); await count(1); await close(); await open(); await row.waitFor();
        if (key.startsWith('toolkit:')) { await row.getByRole('button', { name: 'Cancelar' }).click(); await action(key === 'toolkit:convert' ? 'cancelToolkitJob' : 'cancelTranslateJob', 'task1'); }
        await page.evaluate((key) => window.deferredJobs[key].resolve({}), key); await count(0);
        await row.getByRole('button', { name: 'Ocultar' }).click(); await row.waitFor({ state: 'detached' });
      }
    });
    await t.test('partially failed completed jobs remain actionable from the header', async () => {
      await fresh(); await open();
      const id = await page.evaluate(() => window.startJob('toolkit:convert', { done: 2, total: 2 }));
      await page.getByTestId(`background-task-${id}`).waitFor();
      await page.evaluate(() => window.deferredJobs['toolkit:convert'].resolve({ files: [{ error: 'Archivo no válido' }] }));
      await count(0); assert.equal(await page.getByTestId('attention').innerText(), 'true');
      assert.match(await page.getByTestId(`background-task-${id}`).innerText(), /1 fallidos/);
      await page.getByTestId(`background-task-${id}`).getByRole('button', { name: 'Ocultar' }).click();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
    });
    await t.test('a Codex or Copilot CLI download shows its progress, and a failure can be retried', async () => {
      // Installers no longer carry the vendor CLIs: a task can be what starts the download,
      // so its progress must be visible outside Providers too.
      await fresh(); await open();
      const runtime = (state, receivedBytes = 0, totalBytes = null) => ({ connected: false, runtime: { state, receivedBytes, totalBytes } });
      await emit('onChatGptSubscriptionStatusChanged', runtime('installing', 30, 120));
      const row = page.getByTestId('agent-runtime-codex');
      await row.waitFor(); await count(1);
      assert.match(await row.innerText(), /Motor oficial · Codex/);
      assert.equal(await row.getByRole('progressbar').getAttribute('aria-valuenow'), '25');
      await emit('onGitHubCopilotSubscriptionStatusChanged', runtime('installing', 5 * 1048576));
      await page.getByTestId('agent-runtime-copilot').getByText(/5 MB/).waitFor();
      await count(1); // one lane, however many CLIs are downloading
      await emit('onGitHubCopilotSubscriptionStatusChanged', runtime('ready'));
      await page.getByTestId('agent-runtime-copilot').waitFor({ state: 'detached' });

      await emit('onChatGptSubscriptionStatusChanged', runtime('failed'));
      await count(0); assert.equal(await page.getByTestId('attention').innerText(), 'true');
      await row.getByText('La descarga del motor oficial ha fallado.').waitFor();
      await row.getByRole('button', { name: 'Reintentar' }).click();
      await action('installChatGptSubscriptionRuntime');
      await emit('onChatGptSubscriptionStatusChanged', runtime('failed')); // re-broadcast of the same failure
      await row.getByRole('button', { name: 'Ocultar' }).click(); await row.waitFor({ state: 'detached' });
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
      await emit('onChatGptSubscriptionStatusChanged', runtime('installing', 0, 120));
      await row.waitFor(); // a new attempt shows again
      await emit('onChatGptSubscriptionStatusChanged', runtime('ready'));
      await row.waitFor({ state: 'detached' }); await count(0);
    });
    await t.test('incremental snapshots preserve newer events and large queues load titles on demand', async () => {
      await fresh({}, ['listLibraryExtractionJobs']);
      const job = { id: 'e1', itemId: 'b1', status: 'processing', phase: 'ocr', progress: .8, updatedAt: now };
      await emit('onLibraryExtractionProgress', job);
      await page.evaluate((job) => window.pending.listLibraryExtractionJobs([{ ...job, progress: .1 }, { ...job, id: 'e2', itemId: 'b2' }]), job);
      await open(); assert.match(await page.getByTestId('library-extraction-e1').innerText(), /80%/); await page.getByTestId('library-extraction-e2').waitFor();
      const jobs = Array.from({ length: 70 }, (_, n) => ({ ...job, id: `e${n}`, itemId: `b${n}`, status: n === 69 ? 'processing' : 'failed' }));
      await fresh({ listLibraryExtractionJobs: jobs }); await open(); await count(1);
      assert.equal(await page.locator('[data-testid^="library-extraction-"]').count(), 50);
      await page.getByTestId('library-extraction-e69').waitFor();
      await page.getByRole('button', { name: 'Mostrar más', exact: true }).click();
      assert.equal(await page.locator('[data-testid^="library-extraction-"]').count(), 70);
      await fresh({ listLibraryExtractionJobs: jobs }); await open();
      assert.equal(await page.locator('[data-testid^="library-extraction-"]').count(), 50);
      await page.getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      await page.getByRole('dialog', { name: 'Limpiar tareas terminadas', exact: true }).getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      await page.waitForFunction(() => window.activity.extraction.length === 1);
      await page.getByTestId('library-extraction-e69').waitFor(); await count(1);
      assert.equal(await page.getByRole('button', { name: 'Limpiar terminadas', exact: true }).isDisabled(), true);
    });
    await t.test('simultaneous pipelines fit the compact panel in both themes and at narrow widths', async () => {
      await fresh({ getQueue: queue(), getEmbeddingStatus: embedding, getPassageStatus: passages, getDocumentIndexProgress: documents(), listZoteroSyncSessions: [{ status: 'running', updatedAt: new Date().toISOString(), progress: zotero() }] }); await open(); await count(5);
      for (const theme of ['dark', 'light']) for (const width of [1200, 360]) {
        await page.setViewportSize({ width, height: 900 }); await page.evaluate((theme) => { document.documentElement.className = theme; }, theme);
        await page.waitForTimeout(200);
        if (process.env.NODUS_QUEUE_QA_DIR) {
          await mkdir(process.env.NODUS_QUEUE_QA_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.NODUS_QUEUE_QA_DIR, `${theme}-${width}.png`) });
        }
        const background = await page.getByTestId('queue-progress-bar').evaluate((bar) => getComputedStyle(bar).backgroundColor);
        const channel = Number(background.match(/[\d.]+/)[0]);
        assert.ok(theme === 'light' ? channel > 180 : channel < 90, `${theme} progress surface follows the theme: ${background}`);
        const overflow = await page.getByTestId('header-queue-panel').evaluate((panel) => {
          const rect = panel.getBoundingClientRect();
          const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT); const problems = [];
          while (walker.nextNode()) {
            const node = walker.currentNode; if (!node.textContent.trim() || node.parentElement.closest('.sr-only')) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const r of range.getClientRects()) if (r.width > 0 && (r.left < rect.left - 1 || r.right > rect.right + 1)) problems.push(node.textContent);
          }
          return problems;
        });
        assert.deepEqual(overflow, [], `${theme} ${width}px: no clipped progress text`);
      }
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.keyboard.press('Escape'); await page.getByTestId('header-queue-panel').waitFor({ state: 'detached' });
      await count(5);
    });
    await t.test('a standalone document job is visible, counted in the badge and clearable', async () => {
      await fresh({ getDocumentIndexProgress: standaloneDocument('queued') }); await open();
      // The rail and the "nothing in progress" message must never coexist.
      await page.getByTestId('document-index-progress-bar').waitFor();
      assert.equal(await page.getByTestId('header-queue-empty').count(), 0);
      await count(1);
      await page.getByTestId('document-index-progress-bar').locator('button.btn-ghost').first().click();
      await page.getByTestId('document-index-rail-job-standalone-1').waitFor();

      await emit('onDocumentIndexProgress', standaloneDocument('failed', 'done', 'Connection error.'));
      await count(0);
      assert.equal(await page.getByTestId('attention').innerText(), 'true');
      const retry = page.getByTestId('document-index-rail-retry-standalone-1');
      await retry.waitFor();
      await retry.click();
      await action('enqueueDocumentProfile', 'w1', 'v1');

      // A failed per-work job must be clearable, or the badge it raises never goes away.
      await page.getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      await page.getByRole('dialog', { name: 'Limpiar tareas terminadas', exact: true }).getByRole('button', { name: 'Limpiar terminadas', exact: true }).click();
      await page.getByTestId('header-queue-empty').waitFor();
      assert.equal(await page.getByTestId('attention').innerText(), 'false');
    });
    await t.test('the header offers the processing log without disturbing the panel', async () => {
      await fresh(); await open();
      const logs = page.getByTestId('header-queue-logs');
      await logs.waitFor();
      // In Spanish the source key IS the label — 'Logs' is the loanword a Spanish reader
      // expects — while the other eight languages translate it (asserted in
      // scripts/test-pipeline-logs-i18n.mjs).
      assert.equal(await logs.innerText(), 'Logs');
      // The log modal is a separate surface: it opens over the panel, closing it returns to the
      // panel, and only then does Escape close the panel itself.
      await logs.click();
      await page.getByTestId('pipeline-logs-modal').waitFor();
      await page.getByTestId('pipeline-logs-close').click();
      await page.getByTestId('pipeline-logs-modal').waitFor({ state: 'detached' });
      await page.getByTestId('header-queue-panel').waitFor();
      await page.keyboard.press('Escape');
      await page.getByTestId('header-queue-panel').waitFor({ state: 'detached' });
    });
    assert.deepEqual(errors, [], 'real renderer has no uncaught errors');
  } finally { await closeBrowser(); await rm(dir, { recursive: true, force: true }); }
});
