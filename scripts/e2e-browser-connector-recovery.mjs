// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extensionTestChromium } from './lib/browserExtensionTestRuntime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-extension-recovery-'));
const output = path.join(root, 'output/browser-connector');
await mkdir(output, { recursive: true });
const executablePath = extensionTestChromium();
const extension = process.env.NODUS_TEST_EXTENSION_DIR || path.join(root, 'browser-extension');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  console.error('Native test timeout:', label);
  throw new Error(`Timed out: ${label}`);
}
function deferred() { let resolve; const promise = new Promise((next) => { resolve = next; }); return { resolve, promise }; }
let pairCount = 0; let pendingPair; const received = []; const uploads = []; const gates = new Map(); const downloads = [];
let failUpload = false;
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (req.url.endsWith('/health')) return json({ ok: true, app: 'nodus', enabled: true, libraryReady: true });
  if (req.url.endsWith('/pair')) { pairCount++; pendingPair = () => json({ ok: true, token: 'synthetic-extension-test-token' }); return; }
  if (req.url.endsWith('/catalog')) return json({ collections: [], tags: [] });
  const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
  if (req.url.endsWith('/preview')) { const input = JSON.parse(body); return json({ metadata: input.metadata, warnings: [] }); }
  if (req.url.endsWith('/save')) {
    const input = JSON.parse(body); received.push(input);
    if (input.metadata.title === 'Delayed permission') await sleep(6_000);
    return json({ ok: true, itemId: `nodus:${input.captureRequestId}`, title: input.metadata.title, disposition: 'created', attachmentCount: 0, warnings: [], pendingUploads: input.attachments.map((attachment) => ({ ...attachment, reason: 'Browser session required' })) });
  }
  if (req.url.includes('/attachments')) {
    if (failUpload) return json({ error: 'Synthetic offline upload' }, 503);
    uploads.push(req.headers['x-nodus-file-name']); return json({ ok: true, attachmentCount: 1 });
  }
  if (req.url.startsWith('/file/')) {
    downloads.push(req.url); const gate = gates.get(req.url); if (gate) await gate.promise;
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Synthetic attachment'); return;
  }
  json({ ok: true });
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const headed = process.env.NODUS_TEST_HEADED === '1';
const options = { executablePath, headless: !headed, viewport: { width: 420, height: 600 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--apps-gallery-install-auto-confirm-for-tests=accept', '--host-resolver-rules=MAP files.nodus.test 127.0.0.1'] };
let context;
const errors = [];
async function launch() {
  context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), options);
  context.on('weberror', (error) => errors.push(error.error().message));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  await context.addInitScript(() => {
    if (!globalThis.chrome?.tabs || !chrome.scripting) return;
    // Only the page under review is synthetic. Runtime, permissions, storage,
    // service-worker lifecycle, fetch and all extension code are native Chromium.
    chrome.tabs.query = async () => [{ id: 7, title: 'Catalogue', url: 'https://catalog.example/search' }];
    chrome.scripting.executeScript = async () => [{ result: { title: 'Catalogue', url: 'https://catalog.example/search', lang: 'en', contentType: 'text/html', html: '', metas: [], links: [], anchors: [], jsonLd: [], coins: [
      'ctx_ver=Z39.88-2004&rft.genre=article&rft.atitle=First+paper&rft.au=Garcia%2C+Maria&rft_id=info%3Adoi%2F10.1000%2Fone',
      'ctx_ver=Z39.88-2004&rft.genre=book&rft.btitle=Second+book&rft.au=Lovelace%2C+Ada&rft.isbn=9788400000000',
    ] } }];
  });
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/options.html`);
  return { page, id };
}
const jobs = (page) => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'nodus:jobs' })).jobs);
const request = (title, url) => ({ pageUrl: 'https://publisher.example/article', metadataSource: 'generic', metadataReviewed: true, metadata: { title, itemType: 'document', creators: [], year: null, isbn: [], issn: [], tags: [] }, attachments: url ? [{ url, title: 'File', fileName: `${title}.txt`, mimeType: 'text/plain' }] : [] });
const enqueue = (page, requests) => page.evaluate(async ({ requests, port }) => (await chrome.runtime.sendMessage({ type: 'nodus:enqueue', requests, port })).job, { requests, port });
try {
  let { page, id } = await launch();
  await page.evaluate((port) => chrome.storage.local.set({ port, token: '' }), port);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await until(() => pairCount === 1, 'pair prompt'); await popup.close(); pendingPair();
  await until(() => page.evaluate(async () => Boolean((await chrome.storage.local.get('token')).token)), 'pair survives popup closure');
  const review = await context.newPage(); await review.goto(`chrome-extension://${id}/popup.html`);
  await review.locator('#save-button:enabled').waitFor(); assert.equal(pairCount, 1);
  await review.locator('[data-review-index="1"]').click();
  await review.locator('#metadata-toggle').click(); await review.locator('#metadata-title').fill('Second book corrected');
  await review.locator('[data-review-index="0"]').click(); assert.equal(await review.locator('#metadata-title').inputValue(), 'First paper');
  await review.locator('[data-review-index="1"]').click(); assert.equal(await review.locator('#metadata-title').inputValue(), 'Second book corrected');
  await review.locator('#save-button').click(); await review.locator('#success-view:not(.hidden)').waitFor(); await review.close();
  await until(async () => (await jobs(page)).some((job) => job.entries.length === 2 && job.status === 'complete'), 'batch survives popup closure');
  assert.deepEqual(received.slice(0, 2).map((input) => input.metadata.title), ['First paper', 'Second book corrected']);
  assert.ok(received.slice(0, 2).every((input) => input.metadataReviewed && input.sourceIsResultPage));
  console.log('Native extension: pairing and reviewed batch survive popup closure.');

  const delayed = await enqueue(page, [request('Delayed permission', `http://files.nodus.test:${port}/file/permission.txt`)]);
  await until(async () => (await jobs(page)).find((job) => job.id === delayed.id)?.status === 'needs-permission', 'slow save waits for a fresh gesture');
  assert.ok(!downloads.includes('/file/permission.txt'));
  const authorization = await context.newPage(); await authorization.goto(`chrome-extension://${id}/popup.html`);
  await authorization.locator('#authorize-button:not(.hidden)').waitFor();
  await authorization.evaluate(() => {
    const nativeRequest = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = (input) => { window.permissionAttempt = { input, gesture: navigator.userActivation.isActive }; const pending = nativeRequest(input); pending.then((granted) => { window.permissionAttempt.granted = granted; }).catch((error) => { window.permissionAttempt.error = error.message; }); return pending; };
  });
  await authorization.locator('#authorize-button').click();
  await authorization.waitForFunction(() => window.permissionAttempt);
  assert.equal(await authorization.evaluate(() => window.permissionAttempt.gesture), true);
  if (headed) {
    console.log('Awaiting native host approval for the isolated files.nodus.test test server.');
    await until(async () => (await jobs(page)).find((job) => job.id === delayed.id)?.status === 'complete', 'native permission approval', 120_000);
    await until(() => page.evaluate(async () => !(await chrome.permissions.contains({ origins: ['http://files.nodus.test/*'] }))), 'temporary permission revoked');
    console.log('Native extension: optional permission approval, download and revocation passed.');
  } else {
    // A headless browser cannot operate Chrome's native approval dialog. Verify
    // that the real API accepted the fresh gesture and reached that prompt, then
    // cancel it. Run NODUS_TEST_HEADED=1 to also verify native user approval.
    await sleep(300);
    assert.equal(await authorization.evaluate(() => window.permissionAttempt.error), undefined);
    await authorization.close();
    await page.evaluate((id) => chrome.storage.local.remove(`nodusCaptureJob:${id}`), delayed.id);
    console.log('Native extension: slow save reaches the native permission prompt from a fresh gesture (approval covered by headed run).');
  }

  failUpload = true;
  const failed = await enqueue(page, [request('Retry file', `http://127.0.0.1:${port}/file/retry.txt`)]);
  await until(async () => (await jobs(page)).find((job) => job.id === failed.id)?.status === 'failed', 'failed upload retained');
  const countBeforeRetry = received.length; failUpload = false;
  await page.evaluate((id) => chrome.runtime.sendMessage({ type: 'nodus:retry', id }), failed.id);
  await until(async () => (await jobs(page)).find((job) => job.id === failed.id)?.status === 'complete', 'retry completes');
  assert.equal(received.length, countBeforeRetry, 'retry must not submit the reference again');

  gates.set('/file/A.txt', deferred()); gates.set('/file/B.txt', deferred());
  const a = await enqueue(page, [request('Slow A', `http://127.0.0.1:${port}/file/A.txt`)]);
  const b = await enqueue(page, [request('Slow B', `http://127.0.0.1:${port}/file/B.txt`)]);
  await until(() => downloads.includes('/file/A.txt') && downloads.includes('/file/B.txt'), 'concurrent downloads start');
  gates.get('/file/A.txt').resolve();
  await until(async () => (await jobs(page)).find((job) => job.id === a.id)?.status === 'complete', 'first job finishes');
  assert.equal((await jobs(page)).find((job) => job.id === b.id)?.status, 'downloading');
  // Leave the second transfer running beyond Chromium's normal 30s idle
  // boundary with every popup closed. The active-operation keepalive is bounded.
  await authorization.close().catch(() => undefined);
  await sleep(35_000);
  assert.equal((await jobs(page)).find((job) => job.id === b.id)?.status, 'downloading');
  const countBeforeRestart = received.length;
  await context.close(); ({ page, id } = await launch());
  await until(() => downloads.filter((url) => url === '/file/B.txt').length === 2, 'browser restart resumes pending download');
  gates.get('/file/B.txt').resolve();
  await until(async () => (await jobs(page)).find((job) => job.id === b.id)?.status === 'complete', 'resumed download finishes');
  assert.equal(received.length, countBeforeRestart, 'restart must not re-create saved references');
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/popup.html`);
  await reopened.locator(`[data-job-id="${b.id}"]`).waitFor();
  await reopened.screenshot({ path: path.join(output, 'popup-recovered-jobs.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Native extension: failed-upload retry, concurrent jobs, browser restart and persistent history passed.');
} finally {
  for (const gate of gates.values()) gate.resolve();
  if (context) await context.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
