// Real startup, renderer controls and automatic embeddings under the Research OS sandbox.
// Only Zotero's HTTP responses and the embedding provider are simulated locally.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createResearchApp, simulatedUpstream, waitFor as pollUntil, writeSyntheticPdfs, repoRoot } from './lib/research-app-harness.mjs';

async function waitFor(probe, options) {
  assert.ok(await pollUntil(probe, options), 'The expected application state arrived before the timeout');
}

let version = 1, files = [], hold = true, release;
const gate = new Promise(resolve => { release = resolve; });
const requests = [];
const records = [1, 2].map(number => ({ key: `WORK000${number}`, version: number,
  data: { key: `WORK000${number}`, version: number, itemType: 'book', title: `Background sync ${number}`,
    creators: [{ firstName: 'Ada', lastName: 'Researcher', creatorType: 'author' }], date: '2026', tags: [], collections: ['MONITOR1'] } }));
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const route = url.pathname;
  requests.push({ route, at: Date.now(), version });
  const json = (data, status = 200, total = Array.isArray(data) ? data.length : 1) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Last-Modified-Version': String(version), 'Total-Results': String(total) });
    response.end(JSON.stringify(data));
  };
  if (route.endsWith('/groups')) return json([]);
  if (route.endsWith('/collections/top')) return json([{ key: 'MONITOR1', data: { name: 'Linked Zotero collection', parentCollection: false } }]);
  if (route.endsWith('/collections/MONITOR1/collections')) return json([]);
  if (route.endsWith('/collections/MONITOR1/items/top')) {
    if (hold) await gate;
    const items = records.slice(0, version), start = Number(url.searchParams.get('start') ?? 0);
    return json(items.slice(start, start + 100), 200, items.length);
  }
  if (route === '/api/users/0/items') return json(records.slice(0, version));
  const match = route.match(/\/items\/(WORK000[12]|FILE000[12])(\/.*)?$/);
  if (match) {
    const number = Number(match[1].at(-1)), suffix = match[2] ?? '';
    if (suffix === '/children' && match[1].startsWith('WORK')) return json([{ key: `FILE000${number}`, version: 1,
      data: { key: `FILE000${number}`, parentItem: `WORK000${number}`, itemType: 'attachment', filename: path.basename(files[number - 1]),
        title: 'Synthetic PDF', contentType: 'application/pdf', linkMode: 'imported_file', version: 1 } }]);
    if (suffix === '/file') { response.writeHead(302, { Location: pathToFileURL(files[number - 1]).href }); return response.end(); }
    if (!suffix && match[1].startsWith('WORK')) return json(records[number - 1]);
    if (suffix === '/children') return json([]);
  }
  return json({ error: 'Not found in disposable Zotero' }, 404);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const provider = simulatedUpstream();
const harness = await createResearchApp({ provider, extraPorts: [port], extraEnv: {
  NODUS_ZOTERO_API_BASE: `http://127.0.0.1:${port}/api`, NODUS_ISOLATED_ZOTERO_STARTUP: '1',
} });
const { root } = harness;
console.log(`Isolated verification: ${root}`);
try {
  files = await writeSyntheticPdfs(root, { documents: 2, pages: 2, prefix: 'SYNC' });
  let { app, page } = await harness.launch();
  await harness.prepareProfile(page, { academicInterfaceProfile: 'advanced', academicMode: 'auto', syncMode: 'manual',
    monitoredCollections: [], libraryScope: 'vault', autoResumeQueue: false, ocrEnabled: false });
  await harness.simulatedKeys(page);
  await page.evaluate(async version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of [`nodus.mobileTeaserSeen.${version}`, 'nodus.libraryTutorialSeen.v1', 'nodus.platformHighlightsSeen.2026-07',
      'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'accepted', futureAdditions: true });
    await window.nodus.updateSettings({ monitoredCollections: ['MONITOR1'] });
  }, JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'))).version);
  console.log('Disposable settings and automatic indexing configured; restarting to exercise actual app startup.');
  await harness.closeApp();
  requests.length = 0;

  const startupLaunchAt = Date.now();
  ({ app, page } = await harness.launch());
  console.log('Restarted app; waiting for the deferred background sync.');
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.syncQA = { windowCalls: [], gaps: [] };
    let last = performance.now();
    state.timer = setInterval(() => { const now = performance.now(); state.gaps.push(now - last - 10); last = now; }, 10);
    for (const win of BrowserWindow.getAllWindows()) for (const method of ['focus', 'show', 'restore', 'moveTop']) {
      const original = win[method].bind(win);
      win[method] = (...args) => { state.windowCalls.push(method); return original(...args); };
    }
  });
  await page.evaluate(() => {
    globalThis.syncStatuses = [];
    window.nodus.onZoteroSyncStatus(status => globalThis.syncStatuses.push(status));
    globalThis.renderGaps = []; let last = performance.now();
    globalThis.renderTimer = setInterval(() => { const now = performance.now(); globalThis.renderGaps.push(now - last - 10); last = now; }, 10);
  });
  await page.getByTestId('app-shell').waitFor({ timeout: 30000 });
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-vault-header').waitFor();
  const sync = page.getByTestId('library-vault-sync-zotero');
  assert.equal(await sync.getAttribute('title'), 'Sincronizar Zotero');
  await waitFor(() => page.evaluate(async () => (await window.nodus.getZoteroSyncStatus()).running), { timeoutMs: 20000 });
  await waitFor(() => sync.isDisabled());
  const search = page.getByTestId('library-vault-search');
  await search.fill('Background');
  await search.focus();
  assert.equal(await search.inputValue(), 'Background');
  assert.equal(await search.evaluate(element => document.activeElement === element), true);
  assert.equal(await page.getByTestId('header-queue-panel').count(), 0);
  // Even an IPC request from another control joins startup, without another traversal.
  await page.evaluate(() => { globalThis.joinedSync = window.nodus.syncNow({ catalogOnly: true }); });
  hold = false; release();
  await page.evaluate(() => globalThis.joinedSync);
  await waitFor(() => sync.isEnabled());
  await waitFor(() => page.getByTestId('library-vault-header').innerText().then(text => text.includes('1 obras visibles')));
  assert.equal(requests.filter(request => request.route.endsWith('/collections/MONITOR1/items/top')).length, 1);
  assert.equal(await search.evaluate(element => document.activeElement === element), true, 'startup does not steal keyboard focus');
  const embeddingsReady = async count => {
    const inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    return inventory.documents.length === count && inventory.documents.every(document => document.preparation.embeddings === 'ready');
  };
  await waitFor(() => embeddingsReady(1), { timeoutMs: 120000 });
  const firstEmbeddingCalls = provider.calls.filter(call => call.provider === 'openrouter').length;
  assert.ok(firstEmbeddingCalls > 0, 'new startup sources receive actual pipeline embeddings');
  console.log('Startup imported the linked collection and embedded its new PDF without opening a panel or moving focus.');

  version = 2;
  await sync.click();
  await waitFor(() => page.getByTestId('library-vault-header').innerText().then(text => text.includes('2 obras visibles')));
  await waitFor(() => sync.isEnabled());
  await waitFor(() => embeddingsReady(2), { timeoutMs: 120000 });
  assert.ok(provider.calls.filter(call => call.provider === 'openrouter').length > firstEmbeddingCalls);
  assert.equal(await page.getByTestId('header-queue-panel').count(), 0);
  const statuses = await page.evaluate(() => globalThis.syncStatuses);
  assert.deepEqual(statuses.map(status => status.running), [true, false, true, false]);
  const queue = await page.evaluate(() => window.nodus.getQueue());
  assert.equal(queue.items.length, 0, 'sync does not enqueue Ideas or summaries');
  const readiness = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
  assert.equal(readiness.documents.length, 2);
  assert.ok(readiness.documents.every(document => document.preparation.embeddings === 'ready'));
  await page.getByTestId('library-vault-header').screenshot({ path: path.join(root, 'artifacts/zotero-sync-header.png') });
  const timing = await app.evaluate(() => {
    clearInterval(globalThis.syncQA.timer);
    return { maxMainDelayMs: Math.round(Math.max(0, ...globalThis.syncQA.gaps)), windowCalls: globalThis.syncQA.windowCalls };
  });
  const maxRendererDelayMs = await page.evaluate(() => { clearInterval(globalThis.renderTimer); return Math.round(Math.max(0, ...globalThis.renderGaps)); });
  assert.deepEqual(timing.windowCalls, [], 'background sync never shows, restores or focuses a window');
  assert.ok(timing.maxMainDelayMs < 250, `main loop remained responsive (${timing.maxMainDelayMs} ms)`);
  assert.deepEqual(pageErrors, []);
  const report = { passed: true, root, ...timing, maxRendererDelayMs, statuses, requests, readiness,
    startupSyncDelayMs: requests[0].at - startupLaunchAt,
    embeddingCalls: provider.calls.filter(call => call.provider === 'openrouter').length, isolation: harness.proof };
  fs.writeFileSync(path.join(root, 'artifacts/background-sync.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, root, ...timing, maxRendererDelayMs, embeddingCalls: report.embeddingCalls }));
} finally {
  hold = false; release();
  await harness.close();
  await new Promise(resolve => server.close(resolve));
}
