import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-item-management-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-items-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const store = new LibraryDiskStore(root, 'item-management-device');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const operations = new LibraryOperations(store, catalog);

  const reference = operations.createItem({
    title: 'An archival source without a file', itemType: 'manuscript',
    creators: [
      { creatorType: 'author', firstName: 'María', lastName: 'García' },
      { creatorType: 'editor', name: 'Archivo General', fieldMode: 1 },
      { creatorType: 'translator', firstName: 'Irene', lastName: 'Pérez' },
    ],
    year: 1942, isbn: [], issn: [], tags: ['archive'],
  }, []);
  assert.equal(reference.source, 'nodus');
  assert.equal(reference.attachments.length, 0);
  assert.deepEqual(reference.metadata.creators.map((creator) => creator.creatorType), ['author', 'editor', 'translator']);

  const sourceDir = path.join(scratch, 'files');
  await mkdir(sourceDir, { recursive: true });
  const pdf = path.join(sourceDir, 'source.pdf');
  const image = path.join(sourceDir, 'plate 01.png');
  const replacement = path.join(sourceDir, 'source-revised.pdf');
  await writeFile(pdf, '%PDF-1.4\nfirst');
  await writeFile(image, 'PNG fixture');
  await writeFile(replacement, '%PDF-1.4\nrevised');

  let managed = operations.addAttachments(reference.id, [pdf, image]);
  assert.equal(managed.attachments.length, 2);
  assert.equal(managed.attachments[0].role, 'original');
  assert.equal(managed.attachments[1].role, 'image');
  assert.equal(managed.attachments[0].fileName, 'García - 1942 - An archival source without a file.pdf', 'the first PDF follows the Zotero-compatible metadata pattern');
  assert.equal(managed.attachments[0].title, 'source.pdf', 'attachment title remains separate from the managed filename');
  assert.equal(managed.attachments[0].autoRenamed, true);
  assert.match(managed.attachments[0].relativePath, /\.pdf$/i, 'managed storage keeps a literal extension for cloud providers');
  assert.doesNotMatch(managed.attachments[0].relativePath, /%2Epdf$/i);
  assert.equal(managed.attachments[1].fileName, 'plate 01.png', 'non-default types and supplementary files keep their informative names');
  assert.equal(managed.attachments[1].autoRenamed, false);
  assert.deepEqual(managed.attachments.map((entry) => entry.position), [0, 1]);
  assert.ok(existsSync(path.join(store.itemFolder(managed.storageId), managed.attachments[0].relativePath)));

  const pdfId = managed.attachments[0].id;
  managed = operations.updateItemMetadata(reference.id, { title: 'Revised archival source' });
  assert.equal(managed.attachments.find((entry) => entry.id === pdfId).fileName, 'García - 1942 - Revised archival source.pdf', 'managed filenames follow parent metadata edits');
  managed = operations.updateAttachment(reference.id, pdfId, { fileName: 'my archival copy.pdf' });
  assert.equal(managed.attachments.find((entry) => entry.id === pdfId).autoRenamed, false, 'a manual filename opts that attachment out of synchronization');
  managed = operations.updateItemMetadata(reference.id, { title: 'Final archival source' });
  assert.equal(managed.attachments.find((entry) => entry.id === pdfId).fileName, 'my archival copy.pdf', 'subsequent metadata edits preserve a human-readable manual filename');
  assert.match(managed.attachments.find((entry) => entry.id === pdfId).relativePath, /my%20archival%20copy\.pdf$/i);

  const imageId = managed.attachments[1].id;
  managed = operations.updateAttachment(reference.id, imageId, { title: 'Figure 1', role: 'supplement', position: 0 });
  assert.equal(managed.attachments[0].id, imageId);
  managed = operations.updateAttachment(reference.id, imageId, { makePrimary: true, fileName: 'figure-primary.png' });
  assert.equal(managed.attachments.find((entry) => entry.id === imageId).role, 'original');
  assert.equal(managed.files.original, managed.attachments.find((entry) => entry.id === imageId).relativePath);
  assert.equal(managed.contentRevision.components.extraction.freshness, 'queued');
  managed = operations.replaceAttachment(reference.id, imageId, replacement);
  assert.equal(managed.attachments.find((entry) => entry.id === imageId).sha256.length, 64);
  assert.equal(managed.attachments.find((entry) => entry.id === imageId).mimeType, 'application/pdf');

  const note = operations.upsertNote(reference.id, { title: 'Reading note', markdown: '# Claim\n\nEvidence.' });
  assert.equal(note.notes[0].source, 'nodus');
  assert.equal(note.notes[0].readOnly, false);
  assert.throws(() => operations.upsertNote(reference.id, { id: 'zotero-note', title: 'Mirror', markdown: 'x', source: 'zotero', readOnly: true }), /solo lectura/);

  const related = operations.createItem({ title: 'Related work', itemType: 'book', creators: [], year: null, isbn: [], issn: [], tags: [] }, []);
  operations.setRelation(reference.id, related.id, 'related', true);
  assert.equal(store.readMaterializedItem(reference.storageId).relations[0].targetItemId, related.id);
  assert.equal(store.readMaterializedItem(related.storageId).relations[0].targetItemId, reference.id);
  operations.setRelation(reference.id, related.id, 'related', false);
  assert.equal(store.readMaterializedItem(reference.storageId).relations.length, 0);
  assert.equal(store.readMaterializedItem(related.storageId).relations.length, 0);

  operations.patchItemTags([reference.id, related.id], { add: ['women', 'archive'], remove: ['archive'] });
  assert.deepEqual(store.readMaterializedItem(reference.storageId).metadata.tags, ['women']);
  operations.setTagColor('women', '#7c3aed');
  assert.equal(operations.listTagRecords().find((tag) => tag.name === 'women').color, '#7c3aed');

  // A corpus scan can become stale while the extraction writer commits a file.
  // Collection assignment must preserve that newer extraction and retry a CAS.
  const collection = operations.createCollection('Concurrent extraction');
  const originalScan = store.scanMaterializedItems.bind(store);
  const originalUpsert = store.upsertItem.bind(store);
  let advancedDuringScan = false, conflictedOnce = false;
  store.scanMaterializedItems = (...args) => {
    const snapshot = originalScan(...args);
    if (!advancedDuringScan) {
      advancedDuringScan = true;
      const current = store.readMaterializedItem(reference.storageId);
      originalUpsert({ ...current, extraction: { ...current.extraction, status: 'ready', textChars: 730 } }, current.clock.revision);
    }
    return snapshot;
  };
  store.upsertItem = (desired, expected) => {
    if (desired.id === reference.id && !conflictedOnce) {
      conflictedOnce = true;
      const current = store.readMaterializedItem(reference.storageId);
      originalUpsert({ ...current, metadata: { ...current.metadata, abstract: 'Concurrent OCR result' } }, current.clock.revision);
    }
    return originalUpsert(desired, expected);
  };
  assert.equal(operations.patchItemCollections([reference.id], { add: [collection.id] }), 1);
  store.scanMaterializedItems = originalScan; store.upsertItem = originalUpsert;
  const collected = store.readMaterializedItem(reference.storageId);
  assert(collected.collectionIds.includes(collection.id));
  assert.equal(collected.extraction.textChars, 730);
  assert.equal(collected.metadata.abstract, 'Concurrent OCR result');

  const duplicate = operations.duplicateItem(reference.id);
  assert.notEqual(duplicate.id, reference.id);
  assert.equal(duplicate.source, 'nodus');
  assert.equal(duplicate.sourceIdentities.length, 0);
  assert.equal(duplicate.attachments.length, managed.attachments.length);

  const imported = store.upsertItem({
    id: 'zotero:ITEM', storageId: 'zotero-item', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'ITEM',
    metadata: { title: 'Imported record', itemType: 'journal-article', creators: [], year: 2020, isbn: [], issn: [], tags: [] },
    collectionIds: [], attachments: [], extraction: { status: 'pending' },
  });
  catalog.rebuild(store);
  const converted = operations.convertItemToNodus(imported.id);
  assert.equal(converted.source, 'nodus');
  assert.equal(converted.sourceIdentities.length, 0);
  assert.equal(store.readMaterializedItem(imported.storageId).source, 'zotero', 'the source mirror remains intact');

  managed = operations.removeAttachment(reference.id, imageId);
  assert.equal(managed.attachments.some((entry) => entry.id === imageId), false);
  assert.equal(managed.files.original, managed.attachments.find((entry) => entry.role === 'original')?.relativePath);
  catalog.close();
  console.log('Nodus-only references, creators, attachments, notes, relations and tag management tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
