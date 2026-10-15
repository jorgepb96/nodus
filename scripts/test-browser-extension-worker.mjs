// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('worker persists pairing and forwards the correct item/port; native grants resume and revoke access', async () => {
  const stored = { port: 54321, token: 'synthetic-token', 'nodusCaptureGrant:https://orphan.example/*': true }; let listener; let added; let allowed = false; const requests = []; const removed = [];
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    i18n: { getMessage: (key) => key },
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: () => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', getManifest: () => ({ version: 'test' }), getPlatformInfo: async () => ({}), onMessage: { addListener: (fn) => { listener = fn; } }, onStartup: { addListener: () => undefined } },
    alarms: { onAlarm: { addListener: () => undefined }, create: async () => undefined },
    storage: { local: {
      get: async (query) => structuredClone(query === null ? stored : typeof query === 'string' ? { [query]: stored[query] } : { ...query, ...stored }),
      set: async (input) => Object.assign(stored, structuredClone(input)), remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    } },
    permissions: { contains: async () => allowed, remove: async ({ origins }) => { removed.push(...origins); allowed = false; return true; }, onAdded: { addListener: (fn) => { added = fn; } } },
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    let data;
    if (url.endsWith('/open')) data = { ok: true };
    else if (url.endsWith('/pair')) data = { ok: true, token: 'renewed-token' };
    else if (url.endsWith('/save')) data = { ok: true, itemId: 'nodus:correct-item', attachmentCount: 0, warnings: [], pendingUploads: [{ url: 'https://files.example/a.txt', fileName: 'a.txt', title: 'File', mimeType: 'text/plain' }] };
    else if (url === 'https://files.example/a.txt') return new Response('Synthetic file', { headers: { 'content-type': 'text/plain' } });
    else if (url === 'http://127.0.0.1:54321/api/browser/items/nodus%3Acorrect-item/attachments') data = { ok: true, attachmentCount: 1 };
    else throw Error(`Unexpected worker request: ${url}`);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const waitFor = async (check) => { for (let count = 0; count < 100; count++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } assert.fail('Worker did not settle'); };
  try {
    await import(`../browser-extension/service-worker.js?test=${Date.now()}`);
    await waitFor(() => removed.includes('https://orphan.example/*') && !stored['nodusCaptureGrant:https://orphan.example/*']);
    removed.length = 0;
    const send = (input) => new Promise((resolve) => listener(input, { id: chrome.runtime.id }, resolve));
    const paired = await send({ type: 'nodus:pair', port: 54321, pageUrl: 'https://publisher.example/article' });
    assert.equal(paired.token, 'renewed-token'); assert.equal(stored.token, 'renewed-token');
    assert.equal((await send({ type: 'nodus:open', port: 54321, itemId: 'nodus:correct-item' })).ok, true);
    assert.ok(requests.some((entry) => entry.url === 'http://127.0.0.1:54321/api/browser/open'));
    const queued = await send({ type: 'nodus:enqueue', port: 54321, requests: [{ pageUrl: 'https://publisher.example/article', metadataSource: 'generic', metadata: { title: 'Test', creators: [], tags: [] } }] });
    const key = `nodusCaptureJob:${queued.job.id}`;
    await waitFor(() => stored[key]?.status === 'needs-permission');
    assert.equal(requests.some((entry) => entry.url === 'https://files.example/a.txt'), false);
    allowed = true; added({ origins: ['https://files.example/*'] });
    await waitFor(() => stored[key]?.status === 'complete' && removed.length > 0 && !stored['nodusCaptureGrant:https://files.example/*']);
    assert.equal(stored[key].entries[0].result.attachmentCount, 1);
    assert.equal(requests.filter((entry) => entry.url.endsWith('/save')).length, 1);
    assert.ok(requests.some((entry) => entry.url === 'http://127.0.0.1:54321/api/browser/items/nodus%3Acorrect-item/attachments'));
    assert.deepEqual(removed, ['https://files.example/*']);
    assert.equal(listener({ type: 'nodus:jobs' }, { id: 'another-extension' }, () => undefined), false);
    stored.nodusPendingUploadJob = { itemId: 'nodus:correct-item', port: 54321, token: 'old-token', attachmentCount: 0,
      pendingUploads: [{ url: 'https://files.example/a.txt', fileName: 'a.txt', title: 'File', mimeType: 'text/plain' }], temporaryOrigins: ['https://files.example/*'] };
    allowed = true;
    await import(`../browser-extension/service-worker.js?migration=${Date.now()}`);
    const legacyKey = 'nodusCaptureJob:00000000-0000-4000-8000-000000000001';
    await waitFor(() => stored[legacyKey]?.status === 'complete' && !stored['nodusCaptureGrant:https://files.example/*']);
    assert.equal(stored.nodusPendingUploadJob, undefined);
    assert.equal(requests.filter((entry) => entry.url.endsWith('/save')).length, 1, 'legacy recovery uploads only files');
    assert.equal(requests.filter((entry) => entry.url.endsWith('/attachments')).at(-1).options.headers.Authorization, 'Bearer renewed-token');
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
