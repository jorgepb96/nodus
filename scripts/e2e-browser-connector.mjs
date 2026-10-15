// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extensionTestChromium } from './lib/browserExtensionTestRuntime.mjs';
import { typeLabel } from '../browser-extension/lib/presentation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'browser-extension');
const output = path.join(root, 'output', 'browser-connector');
const chrome = extensionTestChromium();
const english = JSON.parse(await readFile(path.join(extensionRoot, '_locales/en/messages.json'), 'utf8'));

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const staticServer = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname).replace(/^\/+/, '') || 'popup.html';
    const target = path.resolve(extensionRoot, relative);
    if (!target.startsWith(`${extensionRoot}${path.sep}`)) throw new Error('outside root');
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream' });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
const port = staticServer.address().port;

const snapshot = {
  title: 'Women and migration after war', url: 'https://journal.example/article/42', lang: 'en', contentType: 'text/html', html: '<!doctype html><html><body><article>Readable text</article></body></html>',
  jsonLd: [], coins: [], anchors: [], links: [], metas: [
    { name: 'citation_title', content: 'Women and migration after war' },
    { name: 'citation_author', content: 'Miranda, Alicia' },
    { name: 'citation_journal_title', content: 'Historical Test Review' },
    { name: 'citation_publication_date', content: '2017' },
    { name: 'citation_pdf_url', content: 'https://journal.example/article/42.pdf' },
  ],
};
const collections = [
  { id: 'history', parentId: null, name: 'History', position: 0, source: 'nodus', directItemCount: 4 },
  { id: 'women', parentId: 'history', name: 'Women', position: 0, source: 'nodus', directItemCount: 2 },
  { id: 'postwar', parentId: 'women', name: 'Postwar', position: 0, source: 'nodus', directItemCount: 1 },
];

async function exercise(colorScheme) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 420, height: 600 }, colorScheme });
  const page = await context.newPage();
  await page.addInitScript(({ messages, detected }) => {
    const values = { port: 4323, token: detected.startPaired ? 'visual-test-token' : '', lastCollectionId: 'women' };
    globalThis.chrome = {
      i18n: { getUILanguage: () => 'es-ES', getMessage: (key, substitutions) => {
        const entry = messages[key]; if (!entry) return key;
        let value = entry.message; const args = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
        for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
          const index = Number(/^\$(\d+)$/.exec(placeholder.content)?.[1] || 0) - 1;
          if (index >= 0) value = value.replaceAll(`$${name.toUpperCase()}$`, String(args[index] ?? ''));
        }
        for (const [index, arg] of args.entries()) value = value.replaceAll(`$${index + 1}`, String(arg));
        return value;
      } },
      tabs: { query: async () => [{ id: 7, title: detected.title, url: detected.url }] },
      scripting: { executeScript: async () => [{ result: detected }] },
      storage: { local: { get: async (defaults) => ({ ...defaults, ...values }), set: async (input) => Object.assign(values, input), remove: async (keys) => { for (const key of keys) delete values[key]; } } },
      permissions: { request: async () => true },
      runtime: { getManifest: () => ({ version: '4.1.3' }), getURL: (path = '') => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`, openOptionsPage: async () => undefined },
    };
    // Visual tests isolate the worker; the native recovery suite exercises its
    // real lifecycle, permissions and durable storage in an installed extension.
    const jobs = [];
    chrome.runtime.sendMessage = async (message) => {
      const endpoint = `http://127.0.0.1:${values.port}`;
      const post = async (path, body) => (await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (message.type === 'nodus:jobs') return { ok: true, jobs, missingOrigins: [] };
      if (message.type === 'nodus:pair') { const result = await post('/api/browser/pair', {}); values.token = result.token; return result; }
      if (message.type === 'nodus:enqueue') {
        const entries = [];
        for (const request of message.requests) entries.push({ title: request.metadata.title, request: null, result: await post('/api/browser/save', request), error: null, uploads: [] });
        const job = { id: `visual-${jobs.length}`, title: entries[0].title, status: 'complete', entries, createdAt: Date.now(), updatedAt: Date.now() };
        jobs.push(job); return { ok: true, job };
      }
      return { ok: true };
    };
  }, { messages: english, detected: { ...snapshot, startPaired: colorScheme === 'dark' } });
  let pairRequests = 0;
  await page.route('http://127.0.0.1:4323/api/browser/**', (route) => route.abort('connectionrefused'));
  await page.route('http://127.0.0.1:4321/api/browser/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/health')) return route.fulfill({ json: { ok: true, app: 'nodus', enabled: true, paired: true, libraryReady: true } });
    if (url.endsWith('/pair')) { pairRequests += 1; return route.fulfill({ json: { ok: true, token: 'visual-test-token', port: 4321 } }); }
    if (url.endsWith('/catalog')) return route.fulfill({ json: { collections, tags: [{ name: 'migración', itemCount: 12 }, { name: 'women', itemCount: 8 }] } });
    if (url.endsWith('/preview')) return route.fulfill({ json: { metadata: { ...snapshotMetadata(), abstract: 'Metadata enriched locally.' }, warnings: [] } });
    if (url.endsWith('/save')) return route.fulfill({ json: { ok: true, itemId: 'nodus:test-item', attachmentCount: 1, warnings: [], pendingUploads: [] } });
    if (url.endsWith('/open')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto(`http://127.0.0.1:${port}/popup.html`);
  await page.locator('#capture-view:not(.hidden)').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  assert.equal(await page.locator('#pair-port').inputValue(), '4321');
  assert.equal(await page.evaluate(() => chrome.storage.local.get({ port: 0 }).then((value) => value.port)), 4321);
  assert.equal(await page.locator('#document-title').textContent(), snapshot.title);
  assert.equal(await page.locator('#item-type').inputValue(), 'journal-article');
  assert.ok((await page.locator('#document-byline').textContent()).includes('Miranda'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await page.locator('#collection-label').textContent(), 'Women');
  assert.equal(pairRequests, colorScheme === 'dark' ? 0 : 1, 'an absent token is restored without user interaction');
  assert.equal(await page.locator('#snapshot-checkbox').isChecked(), false, 'a detected PDF keeps the HTML snapshot off by default');

  await page.locator('#collection-button').click();
  await page.locator('#collection-search').fill('postwar');
  const row = page.locator('.collection-row', { hasText: 'Postwar' });
  assert.equal(await row.count(), 1);
  assert.ok((await row.getAttribute('title')).includes('History / Women / Postwar'));
  await row.click();
  assert.equal(await page.locator('#collection-label').textContent(), 'Postwar');
  await page.locator('#tag-input').fill('migracion');
  await page.locator('.tag-suggestion', { hasText: 'migración' }).click();
  assert.equal(await page.locator('.tag-chip').count(), 1);
  await page.screenshot({ path: path.join(output, `popup-${colorScheme}.png`), fullPage: true });
  await page.locator('#save-button').click();
  await page.locator('#success-view:not(.hidden)').waitFor();
  assert.match(await page.locator('#jobs-list').textContent(), /1 file/);
  await browser.close();
}

async function exerciseMultiCapture() {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 420, height: 600 }, colorScheme: 'light' });
  const page = await context.newPage();
  const detected = {
    title: 'Catalogue results', url: 'https://catalog.example/search', lang: 'en', contentType: 'text/html', html: '',
    jsonLd: [], anchors: [], links: [], metas: [], coins: [
      'ctx_ver=Z39.88-2004&rft.genre=article&rft.atitle=First+paper&rft.au=Garc%C3%ADa%2C+Mar%C3%ADa&rft_id=info%3Adoi%2F10.1000%2Fone',
      'ctx_ver=Z39.88-2004&rft.genre=book&rft.btitle=Second+book&rft.au=Lovelace%2C+Ada&rft.isbn=9788400000000',
    ],
  };
  await page.addInitScript(({ messages, snapshot: nextSnapshot }) => {
    const values = { port: 4321, token: 'visual-test-token', lastCollectionId: null };
    globalThis.chrome = {
      i18n: { getUILanguage: () => 'en-US', getMessage: (key, substitutions) => {
        const entry = messages[key]; if (!entry) return key;
        let value = entry.message; const args = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
        for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
          const index = Number(/^\$(\d+)$/.exec(placeholder.content)?.[1] || 0) - 1;
          if (index >= 0) value = value.replaceAll(`$${name.toUpperCase()}$`, String(args[index] ?? ''));
        }
        return value;
      } },
      tabs: { query: async () => [{ id: 9, title: nextSnapshot.title, url: nextSnapshot.url }] },
      scripting: { executeScript: async () => [{ result: nextSnapshot }] },
      storage: { local: { get: async (defaults) => ({ ...defaults, ...values }), set: async (input) => Object.assign(values, input), remove: async (keys) => { for (const key of keys) delete values[key]; } } },
      permissions: { request: async () => true, contains: async () => false, remove: async () => true },
      runtime: { getManifest: () => ({ version: '5.3.1' }), getURL: (path = '') => `chrome-extension://ilcclajjhofhieoljdjmikmfopfbamej/${path}`, openOptionsPage: async () => undefined },
    };
    // Visual tests isolate the worker; the native recovery suite exercises its
    // real lifecycle, permissions and durable storage in an installed extension.
    const jobs = [];
    chrome.runtime.sendMessage = async (message) => {
      const endpoint = `http://127.0.0.1:${values.port}`;
      const post = async (path, body) => (await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (message.type === 'nodus:jobs') return { ok: true, jobs, missingOrigins: [] };
      if (message.type === 'nodus:pair') { const result = await post('/api/browser/pair', {}); values.token = result.token; return result; }
      if (message.type === 'nodus:enqueue') {
        const entries = [];
        for (const request of message.requests) entries.push({ title: request.metadata.title, request: null, result: await post('/api/browser/save', request), error: null, uploads: [] });
        const job = { id: `visual-${jobs.length}`, title: entries[0].title, status: 'complete', entries, createdAt: Date.now(), updatedAt: Date.now() };
        jobs.push(job); return { ok: true, job };
      }
      return { ok: true };
    };
  }, { messages: english, snapshot: detected });
  let saves = 0;
  await page.route('http://127.0.0.1:4321/api/browser/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/health')) return route.fulfill({ json: { ok: true, app: 'nodus', enabled: true, paired: true, libraryReady: true } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { collections: [], tags: [] } });
    if (url.endsWith('/preview')) return route.fulfill({ json: { metadata: JSON.parse(route.request().postData()).metadata, warnings: [] } });
    if (url.endsWith('/save')) {
      saves += 1;
      const body = JSON.parse(route.request().postData());
      return route.fulfill({ json: { ok: true, itemId: `nodus:batch-${saves}`, disposition: 'created', deduplicated: false, title: body.metadata.title, attachmentCount: 0, extractionStatus: null, warnings: [], pendingUploads: [] } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto(`http://127.0.0.1:${port}/popup.html`);
  await page.locator('#capture-view:not(.hidden)').waitFor();
  assert.equal(await page.locator('.multi-capture-row').count(), 2);
  assert.match(await page.locator('#save-button').textContent(), /2 references/);
  await page.locator('#save-button').click();
  await page.locator('#success-view:not(.hidden)').waitFor();
  assert.equal(saves, 2);
  assert.match(await page.locator('#jobs-list').textContent(), /2\/2 references/);
  assert.equal(await page.locator('#open-button').isHidden(), true);
  await browser.close();
}

/** Every language the package ships: its _locales directory, the UI language
 * Chrome reports for it, and the code the shared document-type table names it. */
const LOCALIZED_SURFACES = [
  { directory: 'en', uiLanguage: 'en-US', language: 'en' },
  { directory: 'es', uiLanguage: 'es-ES', language: 'es' },
  { directory: 'fr', uiLanguage: 'fr-FR', language: 'fr' },
  { directory: 'de', uiLanguage: 'de-DE', language: 'de' },
  { directory: 'pt_PT', uiLanguage: 'pt-PT', language: 'pt' },
  { directory: 'pt_BR', uiLanguage: 'pt-BR', language: 'pt-BR' },
  { directory: 'it', uiLanguage: 'it-IT', language: 'it' },
  { directory: 'tr', uiLanguage: 'tr-TR', language: 'tr' },
  { directory: 'zh_CN', uiLanguage: 'zh-CN', language: 'zh-CN' },
  { directory: 'ja', uiLanguage: 'ja-JP', language: 'ja' },
  { directory: 'ko', uiLanguage: 'ko-KR', language: 'ko' },
  { directory: 'ru', uiLanguage: 'ru-RU', language: 'ru' },
  { directory: 'zh_TW', uiLanguage: 'zh-TW', language: 'zh-TW' },
];
const catalogs = Object.fromEntries(await Promise.all(LOCALIZED_SURFACES.map(async (entry) => [
  entry.directory,
  JSON.parse(await readFile(path.join(extensionRoot, `_locales/${entry.directory}/messages.json`), 'utf8')),
])));

/**
 * A catalog only matters if the surface renders it. These passes stub each shipped
 * locale and read every localized node back from real Chrome, so a missing or stale
 * key fails here instead of reaching a user as an English string.
 */
async function exerciseLocalizedSurfaces(browser, { directory, uiLanguage, language }) {
  const messages = catalogs[directory];
  const context = await browser.newContext({ viewport: { width: 420, height: 600 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.addInitScript(({ messages, detected, uiLanguage }) => {
    const values = { port: 4321, token: 'visual-test-token', lastCollectionId: null };
    globalThis.chrome = {
      i18n: { getUILanguage: () => uiLanguage, getMessage: (key, substitutions) => {
        const entry = messages[key]; if (!entry) return key;
        let value = entry.message; const args = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
        for (const [name, placeholder] of Object.entries(entry.placeholders || {})) {
          const index = Number(/^\$(\d+)$/.exec(placeholder.content)?.[1] || 0) - 1;
          if (index >= 0) value = value.replaceAll(`$${name.toUpperCase()}$`, String(args[index] ?? ''));
        }
        for (const [index, arg] of args.entries()) value = value.replaceAll(`$${index + 1}`, String(arg));
        return value;
      } },
      tabs: { query: async () => [{ id: 11, title: detected.title, url: detected.url }] },
      scripting: { executeScript: async () => [{ result: detected }] },
      storage: { local: { get: async (defaults) => ({ ...defaults, ...values }), set: async (input) => Object.assign(values, input), remove: async (keys) => { for (const key of keys) delete values[key]; } } },
      permissions: { request: async () => true, contains: async () => true, remove: async () => true },
      runtime: { getManifest: () => ({ version: '5.5.0' }), getURL: (path = '') => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`, openOptionsPage: async () => undefined },
    };
    // Visual tests isolate the worker; the native recovery suite exercises its
    // real lifecycle, permissions and durable storage in an installed extension.
    const jobs = [];
    chrome.runtime.sendMessage = async (message) => {
      const endpoint = `http://127.0.0.1:${values.port}`;
      const post = async (path, body) => (await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (message.type === 'nodus:jobs') return { ok: true, jobs, missingOrigins: [] };
      if (message.type === 'nodus:pair') { const result = await post('/api/browser/pair', {}); values.token = result.token; return result; }
      if (message.type === 'nodus:enqueue') {
        const entries = [];
        for (const request of message.requests) entries.push({ title: request.metadata.title, request: null, result: await post('/api/browser/save', request), error: null, uploads: [] });
        const job = { id: `visual-${jobs.length}`, title: entries[0].title, status: 'complete', entries, createdAt: Date.now(), updatedAt: Date.now() };
        jobs.push(job); return { ok: true, job };
      }
      return { ok: true };
    };
  }, { messages, detected: snapshot, uiLanguage });
  await page.route('http://127.0.0.1:4321/api/browser/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/health')) return route.fulfill({ json: { ok: true, app: 'nodus', enabled: true, paired: true, libraryReady: true } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { collections, tags: [] } });
    if (url.endsWith('/preview')) return route.fulfill({ json: { metadata: snapshotMetadata(), warnings: [] } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  const languageTag = uiLanguage.split('-')[0];
  const readStale = (expected) => page.evaluate((catalog) => ({
    text: [...document.querySelectorAll('[data-i18n]')]
      .filter((element) => element.textContent !== catalog[element.dataset.i18n]?.message)
      .map((element) => `${element.dataset.i18n} = ${element.textContent}`),
    placeholder: [...document.querySelectorAll('[data-i18n-placeholder]')]
      .filter((element) => element.placeholder !== catalog[element.dataset.i18nPlaceholder]?.message)
      .map((element) => element.dataset.i18nPlaceholder),
    title: [...document.querySelectorAll('[data-i18n-title]')]
      .filter((element) => element.getAttribute('aria-label') !== catalog[element.dataset.i18nTitle]?.message)
      .map((element) => element.dataset.i18nTitle),
  }), expected);
  const nothingStale = { text: [], placeholder: [], title: [] };

  await page.goto(`http://127.0.0.1:${port}/popup.html`);
  await page.locator('#capture-view:not(.hidden)').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), languageTag, `${directory} must declare the rendered language`);
  assert.equal(await page.locator('#item-type option:checked').textContent(), typeLabel('journal-article', language), `${directory} names the document type in its own language`);
  assert.equal(await page.locator('#collection-label').textContent(), messages.libraryRoot.message);
  assert.equal(await page.locator('#save-button').textContent(), messages.save.message);
  assert.equal(await page.locator('#snapshot-row small').textContent(), messages.webSnapshotHint.message);
  assert.deepEqual(await readStale(messages), nothingStale, `popup.html must render only ${directory} copy`);
  await page.screenshot({ path: path.join(output, `popup-${directory}.png`), fullPage: true });

  for (const [file, titleKey] of [['options.html', 'optionsTitle'], ['privacy.html', 'privacyTitle']]) {
    await page.goto(`http://127.0.0.1:${port}/${file}`);
    assert.equal(await page.locator('html').getAttribute('lang'), languageTag, `${file} must declare the rendered language`);
    assert.equal(await page.title(), messages[titleKey].message, `${file} must translate its tab title`);
    assert.deepEqual(await readStale(messages), nothingStale, `${file} must render only ${directory} copy`);
    if (directory === 'es') await page.screenshot({ path: path.join(output, file.replace('.html', '-es.png')), fullPage: true });
  }
  await context.close();
}

function snapshotMetadata() {
  return {
    title: snapshot.title, itemType: 'journal-article', creators: [{ creatorType: 'author', firstName: 'Alicia', lastName: 'Miranda', fieldMode: 0 }],
    year: 2017, date: '2017', publicationTitle: 'Historical Test Review', url: snapshot.url, isbn: [], issn: [], tags: [],
  };
}

try {
  await mkdir(output, { recursive: true });
  await exercise('light');
  await exercise('dark');
  await exerciseMultiCapture();
  const localizedBrowser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const surface of LOCALIZED_SURFACES) await exerciseLocalizedSurfaces(localizedBrowser, surface);
  } finally {
    await localizedBrowser.close();
  }
  console.log(`Browser connector popup passed in light, dark and all ${LOCALIZED_SURFACES.length} interface languages. Screenshots: ${output}`);
} finally {
  await new Promise((resolve) => staticServer.close(resolve));
}
