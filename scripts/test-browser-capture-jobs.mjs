// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createCaptureQueue } from '../browser-extension/lib/capture-jobs.js';
import { createCaptureReview, reviewedCaptureRequest, captureJobSummary } from '../browser-extension/lib/capture-review.js';
import { applyMetadataEdits, formatCreators } from '../browser-extension/lib/metadata-form.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const request = (title) => ({ pageUrl: 'https://catalog.test/results', metadataSource: 'coins', sourceIsResultPage: true, metadata: { title, itemType: 'book', creators: [], year: null, isbn: [], issn: [], tags: [] }, attachments: [] });
const pending = { url: 'https://files.test/a.pdf', title: 'PDF', reason: 'Sign in', mimeType: 'application/pdf' };
const result = (title, pendingUploads = []) => ({ ok: true, itemId: `nodus:${title}`, title, attachmentCount: 0, warnings: [], pendingUploads, disposition: 'created', deduplicated: false, extractionStatus: null });
const deferred = () => { let resolve; const promise = new Promise((next) => { resolve = next; }); return { resolve, promise }; };
function harness(overrides = {}) {
  const jobs = new Map(); const saves = []; const uploads = [];
  const adapter = {
    list: async () => structuredClone([...jobs.values()]),
    put: async (job) => { jobs.set(job.id, structuredClone(job)); },
    save: async (input) => { saves.push(input.metadata.title); return result(input.metadata.title); },
    canUpload: async () => true,
    upload: async (itemId, attachment) => { uploads.push([itemId, attachment.url]); return { attachmentCount: 1 }; },
    ...overrides,
  };
  return { jobs, adapter, saves, uploads, queue: createCaptureQueue(adapter) };
}

test('persists a reviewed batch before any network work; each reference retains its own choices', async () => {
  const h = harness(); const a = createCaptureReview(request('Article')); const b = createCaptureReview(request('Book'));
  a.metadata.tags = ['first']; b.metadata.tags = ['second']; b.metadata.title = 'Edited book';
  const job = await h.queue.enqueue([reviewedCaptureRequest(a, 'collection'), reviewedCaptureRequest(b, 'collection')]);
  assert.equal(h.jobs.size, 1); assert.deepEqual(h.saves, []);
  await h.queue.run(job.id);
  assert.deepEqual(h.saves, ['Article', 'Edited book']);
  assert.equal(h.jobs.get(job.id).status, 'complete');
  assert.deepEqual(captureJobSummary(h.jobs.get(job.id)), { saved: 2, total: 2, files: 0, pending: 0, errors: [] });
  assert.deepEqual(reviewedCaptureRequest(a, null).tags, ['first']);
  assert.equal(reviewedCaptureRequest(b, null).metadataReviewed, true);
});

test('simultaneous jobs persist independently when one finishes while another is downloading', async () => {
  const a = deferred(); const b = deferred(); const startedA = deferred(); const startedB = deferred();
  const h = harness({ save: async (input) => result(input.metadata.title, [pending]), upload: async (id) => { (id.endsWith('A') ? startedA : startedB).resolve(); await (id.endsWith('A') ? a : b).promise; return { attachmentCount: 1 }; } });
  const first = await h.queue.enqueue([request('A')]); const second = await h.queue.enqueue([request('B')]);
  const runA = h.queue.run(first.id); const runB = h.queue.run(second.id);
  await Promise.all([startedA.promise, startedB.promise]); a.resolve(); await runA;
  assert.equal(h.jobs.get(first.id).status, 'complete');
  assert.equal(h.jobs.get(second.id).status, 'downloading');
  b.resolve(); await runB; assert.equal(h.jobs.get(second.id).status, 'complete');
});

test('failed attachments remain retryable and successful references and attachments are never submitted again', async () => {
  let fail = true; let saves = 0; const uploaded = [];
  const h = harness({ save: async () => { saves++; return result('A', [pending, { ...pending, url: 'https://files.test/b.pdf' }]); }, upload: async (_id, attachment) => { uploaded.push(attachment.url); if (attachment.url.endsWith('b.pdf') && fail) throw Error('offline'); return { attachmentCount: 1 }; } });
  const job = await h.queue.enqueue([request('A')]); await h.queue.run(job.id);
  assert.equal(h.jobs.get(job.id).status, 'failed');
  assert.equal(captureJobSummary(h.jobs.get(job.id)).pending, 1);
  fail = false; await h.queue.run(job.id, true);
  assert.equal(saves, 1); assert.equal(uploaded.length, 3); assert.equal(h.jobs.get(job.id).status, 'complete');
});

test('restarting the queue resumes acknowledged uploads without re-creating references', async () => {
  const h = harness(); const job = await h.queue.enqueue([request('A')]);
  const interrupted = h.jobs.get(job.id); interrupted.status = 'downloading'; interrupted.entries[0].request = null;
  interrupted.entries[0].result = result('A'); interrupted.entries[0].uploads = [{ attachment: pending, status: 'downloading', error: null }];
  await createCaptureQueue(h.adapter).resume();
  assert.deepEqual(h.saves, []); assert.equal(h.uploads.length, 1); assert.equal(h.jobs.get(job.id).status, 'complete');
});

test('missing permission preserves the item and waits for authorization without attempting a download', async () => {
  let allowed = false;
  const h = harness({ save: async () => result('A', [pending]), canUpload: async () => allowed });
  const job = await h.queue.enqueue([request('A')]); await h.queue.run(job.id);
  assert.equal(h.jobs.get(job.id).status, 'needs-permission'); assert.equal(h.uploads.length, 0);
  allowed = true; await h.queue.run(job.id, true);
  assert.equal(h.uploads.length, 1); assert.equal(h.jobs.get(job.id).status, 'complete');
});

test('a partially failed batch continues and retry saves only the failed reference', async () => {
  let fail = true; const calls = [];
  const h = harness({ save: async (input) => { calls.push(input.metadata.title); if (input.metadata.title === 'A' && fail) throw Error('Nodus unavailable'); return result(input.metadata.title); } });
  const job = await h.queue.enqueue([request('A'), request('B')]); await h.queue.run(job.id);
  assert.equal(captureJobSummary(h.jobs.get(job.id)).saved, 1);
  fail = false; await h.queue.run(job.id, true);
  assert.deepEqual(calls, ['A', 'B', 'A']); assert.equal(h.jobs.get(job.id).status, 'complete');
});

test('editing names retains editor roles and clearing a date also clears its derived year', () => {
  const metadata = { ...request('Edited volume').metadata, year: 2020, creators: [{ creatorType: 'editor', firstName: 'Ada', lastName: 'Lovelace', fieldMode: 0 }, { creatorType: 'author', name: 'Institute', fieldMode: 1 }] };
  const edits = { title: metadata.title, creators: formatCreators(metadata.creators), date: '', doi: '', publicationTitle: '' };
  const unchanged = applyMetadataEdits(metadata, edits);
  assert.deepEqual(unchanged.creators, metadata.creators);
  assert.equal(unchanged.creators[0].creatorType, 'editor'); assert.equal(unchanged.year, null);
  const renamed = applyMetadataEdits(metadata, { ...edits, creators: 'Lovelace, Augusta Ada\n{Institute}' });
  assert.equal(renamed.creators[0].creatorType, 'editor'); assert.equal(renamed.creators[0].firstName, 'Augusta Ada');
});

test('permission-check failures remain visible and retryable instead of stranding a running job', async () => {
  let fail = true;
  const h = harness({ save: async () => result('A', [pending]), canUpload: async () => { if (fail) throw Error('Permission state unavailable'); return true; } });
  const job = await h.queue.enqueue([request('A')]); await h.queue.run(job.id);
  assert.equal(h.jobs.get(job.id).status, 'failed');
  assert.match(captureJobSummary(h.jobs.get(job.id)).errors[0], /Permission state/);
  fail = false; await h.queue.run(job.id, true);
  assert.equal(h.jobs.get(job.id).status, 'complete');
});
