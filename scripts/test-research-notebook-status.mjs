// A notebook is usable once its collections are indexed. Pending documents hold it back;
// documents that could not be indexed are reported and left behind.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-notebook-status-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'corpus.cjs');
await build({ entryPoints: [path.join(repo, 'shared/researchCorpus.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { notebookPreparationStatus } = createRequire(import.meta.url)(outfile);
const doc = (id, status, embeddings = 'missing', extra = {}) => ({ id, title: `Doc ${id}`, preparation: { documentId: id, revision: 'r', text: 'available', lexical: status === 'ready' ? 'ready' : 'missing', embeddings, status, reason: null, error: null, passages: 3, embedded: 0, ...extra } });

test('ready documents count; queued, running and paused ones hold the notebook', () => {
  const status = notebookPreparationStatus(['a', 'b', 'c', 'd'], [doc('a', 'ready', 'ready'), doc('b', 'queued'), doc('c', 'running'), doc('d', 'paused')], true);
  assert.deepEqual({ total: status.total, ready: status.ready, pending: status.pending, paused: status.paused }, { total: 4, ready: 1, pending: 3, paused: true });
});

test('a document nobody asked to index is pending and listed to be queued', () => {
  const status = notebookPreparationStatus(['a', 'b'], [doc('a', 'catalogued'), doc('b', 'ready', 'missing')], true);
  assert.equal(status.pending, 2);
  assert.deepEqual(status.unprepared, ['a', 'b'], 'text missing, and vectors missing when a model can run');
});

test('without an embedding model, searchable text is enough', () => {
  const status = notebookPreparationStatus(['a'], [doc('a', 'ready', 'missing')], false);
  assert.deepEqual({ ready: status.ready, pending: status.pending, unprepared: status.unprepared }, { ready: 1, pending: 0, unprepared: [] });
});

test('lexically ready documents with partial or incompatible vectors stay pending', () => {
  const status = notebookPreparationStatus(['partial', 'stale', 'complete'], [
    doc('partial', 'ready', 'partial', { passages: 3, embedded: 1 }),
    doc('stale', 'ready', 'stale', { passages: 3, embedded: 0 }),
    doc('complete', 'ready', 'ready', { passages: 3, embedded: 3 }),
  ], true);
  assert.equal(status.ready, 1);
  assert.equal(status.pending, 2);
  assert.deepEqual(status.unprepared, ['partial', 'stale']);
});

test('failed and blocked documents are reported and do not hold the notebook back', () => {
  const status = notebookPreparationStatus(['a', 'b', 'c'], [doc('a', 'failed', 'missing', { reason: 'extraction_failed' }), doc('b', 'blocked', 'missing', { reason: 'ocr_required' }), doc('c', 'ready', 'failed', { reason: 'provider_failed' })], true);
  assert.equal(status.pending, 0);
  assert.deepEqual(status.failed.map(item => [item.documentId, item.reason]), [['a', 'extraction_failed'], ['b', 'ocr_required'], ['c', 'provider_failed']]);
});

test('documents outside the inventory are ignored and duplicates count once', () => {
  const status = notebookPreparationStatus(['a', 'a', 'gone'], [doc('a', 'ready', 'ready')], true);
  assert.deepEqual({ total: status.total, ready: status.ready }, { total: 1, ready: 1 });
});
