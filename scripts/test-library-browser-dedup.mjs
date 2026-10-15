// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-browser-dedup-suite')) process.exit(0);

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-browser-dedup-'));
const require = createRequire(import.meta.url);
installRuntimeHooks(path.join(scratch, 'profile'));
const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
const capture = require(path.join(repoRoot, 'electron/browser-connector/libraryCapture.ts'));

try {
  settings.updateSettings({ autoBackupFolder: path.join(scratch, 'backups') });
  const first = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?utm_source=feed',
    metadataSource: 'generic',
    metadata: {
      title: 'A useful article', itemType: 'webpage', creators: [],
      url: 'https://journal.example/articles/42?utm_source=feed', year: null,
    },
  });
  assert.equal(first.disposition, 'created');
  assert.equal(first.deduplicated, false);

  const second = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?utm_medium=email',
    metadataSource: 'generic',
    metadata: {
      title: 'A better title from the page', itemType: 'webpage', creators: [],
      abstract: 'A description discovered on the second capture.',
      url: 'https://journal.example/articles/42?utm_medium=email', year: null,
    },
    tags: ['review later'],
  });
  assert.equal(second.itemId, first.itemId);
  assert.equal(second.disposition, 'updated');
  assert.equal(second.deduplicated, true);
  assert.equal(second.matchedBy, 'url');
  const stored = library.getGlobalLibraryItem(first.itemId);
  assert.equal(stored.metadata.title, 'A useful article', 'a better existing title is never overwritten');
  assert.equal(stored.metadata.abstract, 'A description discovered on the second capture.');
  assert.deepEqual(stored.metadata.tags, ['review later']);

  const third = await capture.saveBrowserCapture({
    pageUrl: 'https://journal.example/articles/42?gclid=another',
    metadataSource: 'generic',
    metadata: {
      title: 'A completely different title', itemType: 'webpage', creators: [],
      url: 'https://journal.example/articles/42?gclid=another', year: null,
    },
  });
  assert.equal(third.disposition, 'existing');
  assert.equal(third.itemId, first.itemId);

  const [racedA, racedB] = await Promise.all([
    capture.saveBrowserCapture({
      pageUrl: 'https://journal.example/articles/concurrent-1', metadataSource: 'generic',
      metadata: { title: 'Concurrent capture A', itemType: 'webpage', creators: [], url: 'https://journal.example/articles/concurrent-1', year: null },
    }),
    capture.saveBrowserCapture({
      pageUrl: 'https://journal.example/articles/concurrent-1?utm_campaign=test', metadataSource: 'generic',
      metadata: { title: 'Concurrent capture B', itemType: 'webpage', creators: [], url: 'https://journal.example/articles/concurrent-1?utm_campaign=test', year: null },
    }),
  ]);
  assert.equal(racedA.itemId, racedB.itemId, 'concurrent captures must share one deduplicated record');
  assert.deepEqual(new Set([racedA.disposition, racedB.disposition]), new Set(['created', 'existing']));
  const batch = ['First paper', 'Second book'].map((title, index) => ({
    pageUrl: 'https://catalog.example/search', metadataSource: 'coins', sourceIsResultPage: true, metadataReviewed: true,
    captureRequestId: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:${index}`,
    metadata: { title, itemType: index ? 'book' : 'journal-article', creators: [], url: 'https://catalog.example/search', year: null,
      ...(index ? { isbn: ['9788400000000'] } : { doi: '10.1000/one' }) },
  }));
  const batchFirst = await capture.saveBrowserCapture(batch[0]);
  const batchSecond = await capture.saveBrowserCapture(batch[1]);
  assert.notEqual(batchFirst.itemId, batchSecond.itemId, 'a listing URL cannot merge independent records');
  assert.deepEqual(library.getGlobalLibraryItem(batchFirst.itemId).metadata.isbn, []);
  const replay = await capture.saveBrowserCapture(batch[1]);
  assert.equal(replay.itemId, batchSecond.itemId, 'a lost acknowledgement is replayed idempotently');
  assert.equal(replay.matchedBy, 'request');
  const originalResolver = library.resolveGlobalLibraryMetadata;
  library.resolveGlobalLibraryMetadata = async () => ({ candidates: [{ metadata: {
    title: 'Provider title', itemType: 'journal-article', creators: [{ creatorType: 'author', name: 'Provider author', fieldMode: 1 }],
    year: 2020, isbn: [], issn: [], tags: ['unwanted provider tag'],
  } }] });
  try {
    const reviewed = await capture.saveBrowserCapture({
      pageUrl: 'https://example.test/reviewed.pdf', metadataSource: 'direct-file', metadataReviewed: true,
      metadata: { title: 'Corrected title', itemType: 'report', creators: [{ creatorType: 'editor', name: 'Corrected editor', fieldMode: 1 }],
        doi: '10.1000/reviewed', url: 'https://example.test/reviewed.pdf', year: null, isbn: [], issn: [], tags: [] }, tags: [],
    });
    const storedReview = library.getGlobalLibraryItem(reviewed.itemId).metadata;
    assert.equal(storedReview.title, 'Corrected title'); assert.equal(storedReview.itemType, 'report');
    assert.equal(storedReview.creators[0].creatorType, 'editor'); assert.deepEqual(storedReview.tags, []);
  } finally { library.resolveGlobalLibraryMetadata = originalResolver; }
  console.log('Browser capture deduplication reuses records, preserves better metadata, and strips tracking URL parameters.');
} finally {
  library.closeGlobalLibrary();
  await rm(scratch, { recursive: true, force: true });
}
