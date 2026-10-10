// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-server-library-publication-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-library-publication-'));
const userData = path.join(scratch, 'profile');
const backupRoot = path.join(scratch, 'backups');
const libraryRoot = path.join(backupRoot, 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

try {
  const AdmZip = require('adm-zip');
  const { writeGlobalPrefsRaw } = require(path.join(repoRoot, 'electron/db/appPrefs.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
  const reader = require(path.join(repoRoot, 'electron/libraryReader/libraryReaderStore.ts'));
  const { buildServerLibraryPublication, buildServerLibraryPublicationAsync } = require(path.join(repoRoot, 'electron/serverSync/serverLibrary.ts'));

  writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const store = new LibraryDiskStore(libraryRoot, 'publication-device-0001');
  store.initialize();
  store.upsertCollection({
    id: 'collection:history', name: 'Historia social', parentId: null, position: 0, source: 'nodus',
  });

  const folder = store.itemFolder('PUBLISHEDITEM');
  const markdown = '# Clase obrera\n\nLa clase es una relación histórica.\n\n![Figura de archivo](assets/figure.png)\n';
  const figure = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N8sAAAAASUVORK5CYII=',
    'base64',
  );
  const original = Buffer.from('%PDF-1.4 original published for mobile reading\n');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  await mkdir(path.join(folder, 'attachments'), { recursive: true });
  await writeFile(path.join(folder, 'reader.md'), markdown, 'utf8');
  await writeFile(path.join(folder, 'assets', 'figure.png'), figure);
  await writeFile(path.join(folder, 'attachments', 'original.pdf'), original);
  store.upsertItem({
    id: 'nodus:published-item', storageId: 'PUBLISHEDITEM', source: 'nodus',
    metadata: {
      title: 'La formación de la clase obrera', itemType: 'book', year: 1963,
      creators: [{ creatorType: 'author', firstName: 'E. P.', lastName: 'Thompson' }],
      publicationTitle: 'Social History', volume: '8', issue: '2', pages: '120-148',
      publisher: 'Victor Gollancz', language: 'en', doi: '10.1000/nodus.1963',
      isbn: ['9780000000001'], issn: ['0000-0001'], tags: ['historia social', 'trabajo'],
    },
    citationKey: 'thompson1963making',
    collectionIds: ['collection:history'],
    attachments: [{
      id: 'local:original', title: 'Original', fileName: 'original.pdf',
      relativePath: 'attachments/original.pdf', mimeType: 'application/pdf',
      byteSize: original.length, sha256: createHash('sha256').update(original).digest('hex'),
      role: 'original', position: 0,
    }],
    files: { reader: 'reader.md', original: 'attachments/original.pdf', annotations: 'annotations.json' },
    extraction: { status: 'ready' },
  });
  library.rebuildGlobalLibrary();

  const selectedText = 'La clase es una relación histórica.';
  reader.createLibraryReaderAnnotation('nodus:published-item', {
    draftId: 'nodus:published-item', scope: 'source', kind: 'highlight', color: 'yellow',
    startOffset: markdown.indexOf(selectedText), endOffset: markdown.indexOf(selectedText) + selectedText.length,
    selectedText, prefix: '', suffix: '', comment: null,
  });

  const mobileAnnotationId = `library-annotation:${Buffer.from('nodus:published-item').toString('base64url')}:mobile-highlight`;
  const mobileTime = '2030-08-13T12:05:00.000Z';
  const mobileDecision = reader.applyPublishedLibraryAnnotationMutation({
    id: 'mobile-upsert', seq: 1, clientId: 'iphone-test', kind: 'upsert',
    table: 'writing_draft_annotations', key: [mobileAnnotationId], createdAt: mobileTime,
    row: {
      id: mobileAnnotationId, draft_id: 'nodus-library:nodus:published-item', scope: 'library-original',
      kind: 'comment', color: null, start_offset: markdown.indexOf(selectedText),
      end_offset: markdown.indexOf(selectedText) + selectedText.length, selected_text: selectedText,
      prefix: '', suffix: '', comment_text: 'Anotación desde el móvil',
      target_json: JSON.stringify({ type: 'text', attachmentId: 'local:original', page: 1 }),
      created_at: mobileTime, updated_at: mobileTime,
    },
  });
  assert.equal(mobileDecision?.outcome, 'applied');
  assert.equal(reader.listLibraryReaderAnnotations('nodus:published-item').length, 2);

  const publication = buildServerLibraryPublication('2026-08-13T12:00:00.000Z');
  assert.equal(publication.manifest.collections.length, 1);
  assert.equal(publication.manifest.documents.length, 1);
  assert.equal(publication.packages.length, 1);
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const asynchronous = await buildServerLibraryPublicationAsync('2026-08-13T12:00:00.000Z');
  assert.equal(yielded, true, 'publication yields the main event loop');
  assert.deepEqual(asynchronous, publication, 'async I/O/compression preserves exact package hashes and manifests');
  const document = publication.manifest.documents[0];
  assert.equal(document.id, 'nodus:published-item');
  assert.deepEqual(document.collectionIds, ['collection:history']);
  assert.deepEqual(document.creators, ['E. P. Thompson']);
  assert.equal(document.cleanAvailable, true);
  assert.equal(document.figureCount, 1);
  assert.equal(document.originalAvailable, true, 'the client may show that an original exists');
  assert.equal(document.originalFileName, 'original.pdf');
  assert.equal(document.originalBytes, original.length);
  assert.equal(document.citationKey, 'thompson1963making');
  assert.equal(document.volume, '8');
  assert.match(document.reference, /E\. P\. Thompson \(1963\).*Social History.*https:\/\/doi\.org\/10\.1000\/nodus\.1963/);
  assert.equal(document.annotations.length, 2);
  const publishedMobileAnnotation = document.annotations.find((annotation) => annotation.id === 'mobile-highlight');
  assert.equal(publishedMobileAnnotation?.comment, 'Anotación desde el móvil');
  assert.equal(publishedMobileAnnotation?.scope, 'original');
  assert.deepEqual(publishedMobileAnnotation?.target, { type: 'text', attachmentId: 'local:original', page: 1 });
  assert.equal(document.packageHash, createHash('sha256').update(publication.packages[0].data).digest('hex'));

  const zip = new AdmZip(publication.packages[0].data);
  const names = zip.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(names, ['assets/figure.png', 'document.md', 'manifest.json', 'original/document.pdf']);
  assert.equal(zip.readAsText('document.md'), markdown);
  assert.deepEqual(zip.readFile('original/document.pdf'), original);
  const packageManifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(packageManifest.formatVersion, 2);
  assert.equal(packageManifest.cleanMarkdown, true);
  assert.deepEqual(packageManifest.original, {
    path: 'original/document.pdf', fileName: 'original.pdf', mimeType: 'application/pdf', bytes: original.length,
  });

  const packageModule = await import(pathToFileURL(path.join(repoRoot, 'server/lib/libraryPackages.mjs')).href);
  const inspected = packageModule.inspectLibraryPackage(publication.packages[0].data);
  assert.equal(inspected.ok, true, inspected.reason || 'the production server must accept the desktop package');
  assert.equal(inspected.manifest.documentId, 'nodus:published-item');
  assert.equal(inspected.hasMarkdown, true);
  assert.equal(inspected.hasOriginal, true);

  const deletedMobileAnnotation = reader.applyPublishedLibraryAnnotationMutation({
    id: 'mobile-delete', seq: 2, clientId: 'iphone-test', kind: 'delete',
    table: 'writing_draft_annotations', key: [mobileAnnotationId], createdAt: '2030-08-13T12:06:00.000Z',
  });
  assert.equal(deletedMobileAnnotation?.outcome, 'deleted');
  assert.equal(reader.listLibraryReaderAnnotations('nodus:published-item').some((annotation) => annotation.id === 'mobile-highlight'), false);

  console.log('Published Library projection, metadata, Clean Markdown, original reading and synced annotations passed.');
} finally {
  try {
    const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
    library.closeGlobalLibrary?.();
  } catch { /* the service never opened */ }
  await rm(scratch, { recursive: true, force: true });
}
