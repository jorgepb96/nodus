// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { extensionOrigin, normalizeConnectorPort, requestLocalJson } from './lib/connection.js';
import { MAX_ATTACHMENT_BYTES, readResponseWithLimit } from './lib/upload.js';
import { createCaptureQueue } from './lib/capture-jobs.js';
import { attachmentOrigins } from './lib/capture-review.js';

const JOB_PREFIX = 'nodusCaptureJob:';
const GRANT_PREFIX = 'nodusCaptureGrant:';
const msg = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
const attachmentName = (attachment) => attachment.title || msg('attachment');
function baseUrl(port) { return `http://127.0.0.1:${normalizeConnectorPort(port)}`; }
async function api(path, options = {}, port) {
  const stored = await chrome.storage.local.get({ port: 4321, token: '' });
  const origin = extensionOrigin(chrome.runtime.getURL);
  const result = await requestLocalJson(`${baseUrl(port || stored.port)}${path}`, {
    ...options, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Nodus-Extension-Origin': origin,
      ...(stored.token ? { Authorization: `Bearer ${stored.token}` } : {}), ...options.headers },
  });
  if (!result.ok) throw new Error(result.data.error || msg('nodusReturnedError', [String(result.status)]));
  return result.data;
}

async function uploadAttachment(job, attachment) {
  let sourceUrl;
  try { sourceUrl = new URL(String(attachment.url)); } catch { throw new Error(msg('invalidAttachmentUrl', [attachmentName(attachment)])); }
  if (!/^https?:$/.test(sourceUrl.protocol)) throw new Error(msg('unsupportedAttachmentUrl', [attachmentName(attachment)]));
  const response = await fetch(attachment.url, { credentials: 'include' });
  if (!response.ok) throw new Error(msg('downloadFailed', [attachmentName(attachment), String(response.status)]));
  const contentType = (response.headers.get('content-type') || attachment.mimeType || 'application/octet-stream').split(';')[0];
  if (attachment.mimeType === 'application/pdf' && contentType.includes('html')) {
    throw new Error(msg('signInPageInsteadOfPdf', [attachmentName(attachment)]));
  }
  const bytes = await readResponseWithLimit(response, MAX_ATTACHMENT_BYTES, msg('fileExceedsLimit', [attachmentName(attachment)]));
  const origin = extensionOrigin(chrome.runtime.getURL);
  const result = await requestLocalJson(`${baseUrl(job.port)}/api/browser/items/${encodeURIComponent(job.itemId)}/attachments`, {
    method: 'POST', body: bytes,
    headers: {
      Authorization: `Bearer ${(await chrome.storage.local.get({ token: '' })).token}`,
      Origin: origin,
      'X-Nodus-Extension-Origin': origin,
      'Content-Type': 'application/octet-stream',
      'X-Nodus-File-Name': encodeURIComponent(attachment.fileName || 'document'),
      'X-Nodus-File-Title': encodeURIComponent(attachment.title || msg('capturedDocument')),
      'X-Nodus-Mime-Type': encodeURIComponent(contentType),
      'X-Nodus-Attachment-Role': attachment.role || 'supplement',
      'X-Nodus-Source-Url': encodeURIComponent(attachment.url),
    },
  });
  if (!result.ok) throw new Error(result.data.error || msg('nodusReturnedError', [String(result.status)]));
  return result.data;
}


async function listJobs() {
  const stored = await chrome.storage.local.get(null);
  return Object.entries(stored).filter(([key]) => key.startsWith(JOB_PREFIX)).map(([, job]) => job).sort((a, b) => b.createdAt - a.createdAt);
}
const queue = createCaptureQueue({
  list: listJobs,
  put: (job) => chrome.storage.local.set({ [`${JOB_PREFIX}${job.id}`]: job }),
  save: (request, job) => api('/api/browser/save', { method: 'POST', body: JSON.stringify(request) }, job.port),
  canUpload: (attachment) => chrome.permissions.contains({ origins: attachmentOrigins([attachment]) }),
  upload: (itemId, attachment, job) => uploadAttachment({ ...job, itemId }, attachment),
  cleanup: cleanupJobs,
});

async function cleanupJobs() {
  const jobs = await listJobs();
  const needed = new Set(jobs.flatMap((job) => job.entries.flatMap((entry) => attachmentOrigins(entry.uploads.filter((upload) => !['complete', 'failed'].includes(upload.status)).map((upload) => upload.attachment)))));
  const grants = await chrome.storage.local.get(null);
  const temporaryOrigins = Object.keys(grants).filter((key) => key.startsWith(GRANT_PREFIX)).map((key) => key.slice(GRANT_PREFIX.length)).filter((origin) => !needed.has(origin));
  if (temporaryOrigins.length && chrome.permissions?.remove) {
    await chrome.permissions.remove({ origins: temporaryOrigins });
    await chrome.storage.local.remove(temporaryOrigins.map((origin) => `${GRANT_PREFIX}${origin}`));
  }
  const expired = jobs.filter((job) => job.status === 'complete').slice(20);
  if (expired.length) await chrome.storage.local.remove(expired.map((job) => `${JOB_PREFIX}${job.id}`));
}

// Only user-requested operations keep the worker alive; stop as soon as they end.
// Alarms provide recovery if Chromium still terminates a worker or Chrome restarts.
async function keepAlive(operation) {
  const timer = setInterval(() => { void chrome.runtime.getPlatformInfo(); }, 20_000);
  try { return await operation(); } finally { clearInterval(timer); }
}
function run(id, retry = false) { return keepAlive(() => queue.run(id, retry)); }
let pairing = null;
async function pair(port, pageUrl) {
  if (!pairing) {
    pairing = keepAlive(async () => {
      const paired = await api('/api/browser/pair', { method: 'POST', body: JSON.stringify({
        extensionVersion: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id, pageUrl,
      }) }, port);
      await chrome.storage.local.set({ port, token: paired.token });
      return paired;
    }).finally(() => { pairing = null; });
  }
  return pairing;
}
async function migrateLegacyTransfer() {
  const legacyKey = 'nodusPendingUploadJob';
  const stored = (await chrome.storage.local.get(legacyKey))[legacyKey];
  if (!stored?.itemId || !Array.isArray(stored.pendingUploads)) return;
  const id = '00000000-0000-4000-8000-000000000001';
  const existing = (await chrome.storage.local.get(`${JOB_PREFIX}${id}`))[`${JOB_PREFIX}${id}`];
  if (!existing) {
    const grants = (Array.isArray(stored.temporaryOrigins) ? stored.temporaryOrigins : [])
      .filter((origin) => typeof origin === 'string' && /^https?:\/\//.test(origin));
    const job = {
      id, title: msg('capturedDocument'), port: normalizeConnectorPort(stored.port),
      status: 'queued', createdAt: Date.now(), updatedAt: Date.now(),
      entries: [{
        title: msg('capturedDocument'), request: null, error: null,
        result: { ok: true, itemId: stored.itemId, attachmentCount: stored.attachmentCount || 0, warnings: [], pendingUploads: [], disposition: 'updated' },
        uploads: stored.pendingUploads.slice(0, 8).map((attachment) => ({ attachment, status: 'queued', error: null })),
      }],
    };
    await chrome.storage.local.set({
      ...Object.fromEntries(grants.map((origin) => [`${GRANT_PREFIX}${origin}`, true])),
      [`${JOB_PREFIX}${id}`]: job,
    });
  }
  // Old records stored a token in the job. The new worker reads current pairing.
  await chrome.storage.local.remove(legacyKey);
}
const migrated = migrateLegacyTransfer();
async function resume() {
  await migrated;
  await keepAlive(() => queue.resume());
  // A worker can stop after the final acknowledgement but before cleanup.
  await cleanupJobs();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('nodus:') || (sender.id && sender.id !== chrome.runtime.id)) return false;
  (async () => {
    if (message.type === 'nodus:open') return api('/api/browser/open', { method: 'POST', body: JSON.stringify({ itemId: String(message.itemId || '') }) }, normalizeConnectorPort(message.port));
    if (message.type === 'nodus:pair') return pair(normalizeConnectorPort(message.port), String(message.pageUrl || ''));
    if (message.type === 'nodus:enqueue') {
      if (!Array.isArray(message.requests) || !message.requests.length || message.requests.length > 50) throw new Error('Invalid capture batch.');
      const job = await queue.enqueue(message.requests, { port: normalizeConnectorPort(message.port) });
      void run(job.id).catch(() => undefined);
      return { ok: true, job };
    }
    if (message.type === 'nodus:jobs') {
      const jobs = await listJobs();
      const origins = [...new Set(jobs.filter((job) => job.status !== 'complete').flatMap((job) => job.entries.flatMap((entry) => attachmentOrigins(entry.uploads.filter((upload) => upload.status !== 'complete').map((upload) => upload.attachment)))) )];
      const missingOrigins = [];
      for (const origin of origins) if (!(await chrome.permissions.contains({ origins: [origin] }))) missingOrigins.push(origin);
      return { ok: true, jobs, missingOrigins };
    }
    if (message.type === 'nodus:retry') {
      void run(String(message.id), true).catch(() => undefined);
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
chrome.permissions.onAdded.addListener((permissions) => {
  void (async () => {
    const jobs = await listJobs();
    for (const job of jobs.filter((entry) => entry.status !== 'complete')) {
      const needed = attachmentOrigins(job.entries.flatMap((entry) => entry.uploads.filter((upload) => upload.status !== 'complete').map((upload) => upload.attachment)));
      const grants = (permissions.origins || []).filter((origin) => needed.includes(origin));
      if (!grants.length) continue;
      await chrome.storage.local.set(Object.fromEntries(grants.map((origin) => [`${GRANT_PREFIX}${origin}`, true])));
      void run(job.id, true).catch(() => undefined);
    }
  })();
});
chrome.runtime.onStartup.addListener(() => { void resume().catch(() => undefined); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'nodus-capture-recovery') void resume().catch(() => undefined); });
void chrome.alarms.create('nodus-capture-recovery', { periodInMinutes: 1 });
void resume().catch(() => undefined);
