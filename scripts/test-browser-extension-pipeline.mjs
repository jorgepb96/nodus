// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectPageSnapshot } from '../browser-extension/lib/snapshot.js';
import { MAX_ATTACHMENT_BYTES, readResponseWithLimit } from '../browser-extension/lib/upload.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the injected snapshot stays bounded and does not clone a giant article', () => {
  let cloneCalled = false;
  const giantText = 'Readable paragraph '.repeat(200_000);
  const article = {
    innerText: giantText,
    textContent: giantText,
    cloneNode() { cloneCalled = true; throw new Error('giant subtree must not be cloned'); },
  };
  globalThis.document = {
    title: 'A page', contentType: 'text/html', documentElement: { lang: 'en' }, body: article,
    querySelectorAll(selector) {
      if (selector === 'article,main,[role="main"]') return [article];
      return [];
    },
  };
  globalThis.location = { href: 'https://example.test/article' };
  const snapshot = collectPageSnapshot();
  assert.equal(cloneCalled, false);
  assert.ok(JSON.stringify(snapshot).length <= 2 * 1024 * 1024);
  assert.ok(snapshot.html.length < 900 * 1024);
  delete globalThis.document;
  delete globalThis.location;
});

test('attachment response reads enforce the 64 MiB transfer limit', async () => {
  const bytes = await readResponseWithLimit(new Response(new Uint8Array([1, 2, 3])));
  assert.deepEqual([...bytes], [1, 2, 3]);
  const chunks = [new Uint8Array(MAX_ATTACHMENT_BYTES - 1), new Uint8Array(2)];
  let cancelled = false;
  const response = {
    headers: { get: () => '' },
    body: { getReader: () => ({
      async read() { return chunks.length ? { done: false, value: chunks.shift() } : { done: true }; },
      async cancel() { cancelled = true; },
    }) },
  };
  await assert.rejects(() => readResponseWithLimit(response), /64 MiB/);
  assert.equal(cancelled, true);
});

test('authorization runs directly from a fresh click and durable jobs own transfers', () => {
  const popup = readFileSync(path.join(root, 'browser-extension/popup.js'), 'utf8');
  const click = popup.slice(popup.indexOf("$('authorize-button').onclick"), popup.indexOf("$('settings-button').onclick"));
  assert.match(click, /chrome\.permissions\.request/);
  assert.doesNotMatch(click.split('chrome.permissions.request')[0], /await /);
  assert.match(popup, /nodus:enqueue/);
  const worker = readFileSync(path.join(root, 'browser-extension/service-worker.js'), 'utf8');
  assert.match(worker, /chrome\.permissions\?\.remove/);
  assert.match(worker, /nodus:pair/);
  assert.match(worker, /nodusCaptureJob:/);
});

test('MV3 package declares a module service worker and no remote executable code', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'browser-extension/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.background, { service_worker: 'service-worker.js', type: 'module' });
  const worker = readFileSync(path.join(root, 'browser-extension/service-worker.js'), 'utf8');
  assert.match(worker, /chrome\.storage\.local/);
  assert.match(worker, /chrome\.runtime\.onStartup/);
  assert.match(worker, /temporaryOrigins/);
  const queue = readFileSync(path.join(root, 'browser-extension/lib/capture-jobs.js'), 'utf8');
  assert.match(queue, /slice\(0, 8\)/, 'queue bounds pending uploads');
  assert.ok(manifest.permissions.includes('alarms'));
  assert.match(worker, /chrome\.alarms\.onAlarm/);
  assert.doesNotMatch(worker, /https?:\/\/[^`'" ]+\.js/);
});
