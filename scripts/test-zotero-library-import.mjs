import assert from 'node:assert/strict';
import fs, { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-library-import-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-library-'));
const userData = path.join(scratch, 'user-data');
const root = path.join(scratch, 'backups', 'nodus-library');
const sourceFiles = path.join(scratch, 'zotero-storage');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function item(overrides) {
  return {
    key: 'A', itemKey: 'A', library: { type: 'user', id: '0', name: 'Mi biblioteca' }, version: 10,
    title: 'Norma y deseo', creators: [{ creatorType: 'author', firstName: 'Ana', lastName: 'García' }],
    year: 2020, itemType: 'journalArticle', doi: '10.1234/norma', abstract: 'Un resumen  fiel.\nSegundo párrafo.',
    tags: ['historia'], collections: ['ROOT'], publisher: 'Editorial', publicationTitle: 'Revista',
    isbn: '978-84-0000-000-0', issn: '1234-5678', url: 'https://example.test/a', date: '2020-05-10',
    language: 'es', volume: '4', issue: '2', pages: '10-30', edition: null, place: 'Madrid', rights: 'CC BY',
    extra: 'Citation Key: garciafernandezEntreNormaDeseo2020', fields: { series: 'Historia contemporánea', numPages: '312', accessDate: '2025-12-20' }, dateAdded: '2026-01-01', dateModified: '2026-02-01',
    ...overrides,
  };
}

try {
  await mkdir(sourceFiles, { recursive: true });
  const pdf = path.join(sourceFiles, 'norma.pdf');
  const image = path.join(sourceFiles, 'figura.png');
  const epub = path.join(sourceFiles, 'grupo.epub');
  const secondPdf = path.join(sourceFiles, 'missing.pdf');
  const localNote = path.join(sourceFiles, 'local.txt');
  await writeFile(pdf, '%PDF-1.4\nfixture-pdf\n');
  await writeFile(image, 'fixture-image');
  await writeFile(epub, 'fixture-epub');
  await writeFile(secondPdf, '%PDF-1.4\nsecond-fixture-pdf\n');
  await writeFile(localNote, 'local attachment retained by Nodus');
  const sourceBefore = await Promise.all([pdf, image, epub].map((file) => readFile(file, 'utf8')));

  const personal = { type: 'user', id: '0', name: 'Mi biblioteca' };
  const group = { type: 'group', id: '42', name: 'Grupo Historia' };
  const state = {
    personalVersion: 10,
    groupVersion: 7,
    personalItems: [
      item({}),
      item({ key: 'B', itemKey: 'B', title: 'Documento sin fichero', collections: [], doi: null, isbn: null, issn: null }),
    ],
    groupItems: [item({
      key: 'groups:42:G1', itemKey: 'G1', library: group, version: 7, title: 'Libro del grupo',
      itemType: 'book', collections: ['groups:42:GC'], doi: null,
      // Zotero keeps every ISBN of a book in one field, separated by spaces.
      isbn: '9780306406157 0306406152',
    })],
    deletedPersonal: [],
    calls: [],
  };
  const attachmentMap = new Map([
    ['A', [
      { key: 'IMG', itemKey: 'IMG', library: personal, title: 'Figura', contentType: 'image/png', linkMode: 'imported_file', filename: 'figura.png', available: true },
      { key: 'PDF', itemKey: 'PDF', library: personal, title: 'Texto completo', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'norma.pdf', available: true },
      // A Zotero bookmark: a URL, no file, and none was ever downloaded. Zotero answers
      // `400 Not a file attachment` for these, which used to be filed as a missing file.
      { key: 'LINK', itemKey: 'LINK', library: personal, title: 'Enlace', contentType: 'text/html', linkMode: 'linked_url', filename: null, available: false },
    ]],
    ['B', [{ key: 'MISS', itemKey: 'MISS', library: personal, title: 'Perdido', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'missing.pdf', available: true }]],
    ['groups:42:G1', [{ key: 'groups:42:EPUB', itemKey: 'EPUB', library: group, title: 'EPUB', contentType: 'application/epub+zip', linkMode: 'imported_file', filename: 'grupo.epub', available: true }]],
  ]);
  const fileMap = new Map([['PDF', pdf], ['IMG', image], ['MISS', secondPdf], ['groups:42:EPUB', epub]]);
  const client = {
    async libraries() { state.calls.push('libraries'); return state.availableLibraries ?? [personal, group]; },
    async libraryVersion(_userId, library) { return library.type === 'group' ? state.groupVersion : state.personalVersion; },
    async allCollections(library) {
      if (library.type === 'group') return [{ key: 'groups:42:GC', itemKey: 'GC', library, name: 'Grupo', parentCollection: false, itemCount: 1, subCount: 0 }];
      return [
        { key: 'ROOT', itemKey: 'ROOT', library, name: 'Historia', parentCollection: false, itemCount: 1, subCount: 1 },
        { key: 'CHILD', itemKey: 'CHILD', library, name: 'Mujeres', parentCollection: 'ROOT', itemCount: 0, subCount: 0 },
      ];
    },
    async libraryItems(library, options = {}) {
      const version = library.type === 'group' ? state.groupVersion : state.personalVersion;
      let items = library.type === 'group' ? state.groupItems : state.personalItems;
      if (options.since) items = items.filter((entry) => entry.version > options.since);
      options.onProgress?.(items.length, items.length);
      return { items, version, total: items.length };
    },
    async deletedSince(library, since) {
      return { version: library.type === 'group' ? state.groupVersion : state.personalVersion, items: library.type === 'group' || since <= 0 ? [] : state.deletedPersonal, collections: [] };
    },
    async itemAttachments(_userId, key) { return attachmentMap.get(key) ?? []; },
    async itemNotes(_userId, key) { return key === 'A' ? [{ key: 'NOTE1', title: 'Nota Zotero', html: '<h2>Fuente</h2><p>No editable</p>', version: 1 }] : []; },
    async attachmentFilePath(_userId, key) {
      // Zotero refuses outright for a link-only attachment; asking at all is the bug.
      if (key === 'LINK') throw new Error('Not a file attachment: LINK');
      return fileMap.get(key) ?? null;
    },
  };

  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { LibraryOperations } = require(path.join(repoRoot, 'electron/library/libraryOperations.ts'));
  const { importZoteroLibraries, previewZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));
  const { ZoteroSyncSessionStore } = require(path.join(repoRoot, 'electron/library/libraryZoteroSyncSessions.ts'));
  const store = new LibraryDiskStore(root, 'zotero-import-device-0001');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const preview = await previewZoteroLibraries(catalog, client);
  assert.deepEqual(preview.map((entry) => [entry.id, entry.lastImportedVersion]), [['users/0', 0], ['groups/42', 0]]);

  const events = [];
  let catalogVisibleBeforeFiles = false;
  const first = await importZoteroLibraries({
    requestId: 'first', store, catalog, client,
    onProgress(value) {
      events.push(value);
      if (value.phase === 'attachments' && catalog.list().total === 3) catalogVisibleBeforeFiles = true;
    },
  });
  assert.equal(first.itemsCreated, 3);
  assert.equal(first.attachmentsCopied, 4);
  assert.equal(first.attachmentsUnavailable, 0);
  assert.equal(first.attachmentsLinkOnly, 1, 'a Zotero bookmark is counted as link-only, never as a missing file');
  assert.equal(first.failures.length, 0, 'a bookmark with no file is not a sync failure');
  assert.ok(!first.warnings.some((entry) => entry.includes('Enlace')), 'a bookmark produces no "unavailable attachment" warning');
  assert.equal(catalog.list().total, 3);
  assert.equal(catalogVisibleBeforeFiles, true, 'the searchable catalog is committed before file copies');
  assert.ok(events.every((value, index) => index === 0 || value.percent >= events[index - 1].percent), 'progress is monotonic across personal and group libraries');
  assert.ok(events.some((value) => value.phase === 'notes'), 'the notes pass reports itself instead of running silently');
  // The attachment band used to be measured against a total discovered one item at a
  // time, so the first copied file put the bar at 93% and left it there for the rest
  // of the import. Items are the denominator now, and the band starts where it should.
  assert.equal(events.at(-1).phase, 'complete');
  assert.equal(events.at(-1).percent, 100);
  assert.equal(first.partial, false);
  assert.equal(first.verification.status, 'passed');
  assert.deepEqual(first.verification.expected, first.verification.imported);
  const sessionStore = new ZoteroSyncSessionStore(root);
  assert.equal(sessionStore.get('first').status, 'completed');
  assert.equal(sessionStore.get('first').report.attachmentsUnavailable, 0);
  const canonicalAId = catalog.resolveItemId('zotero:A');
  assert.ok(canonicalAId?.startsWith('nodus:'), 'a manager key is an alias, never the canonical Nodus ID');
  assert.deepEqual(catalog.list({ collectionId: 'zotero:ROOT' }).items.map((entry) => entry.id), [canonicalAId]);

  const storedA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(storedA.id, canonicalAId);
  assert.equal(storedA.sourceLibraryId, 'users/0');
  assert.equal(storedA.metadata.issn[0], '1234-5678');
  assert.equal(storedA.metadata.abstract, 'Un resumen  fiel.\nSegundo párrafo.', 'Zotero abstract paragraph and spacing fidelity is exact');
  assert.equal(storedA.metadata.extra['Citation Key'], 'garciafernandezEntreNormaDeseo2020');
  assert.equal(storedA.citationKey, 'garciafernandezEntreNormaDeseo2020', 'the Zotero citation key is preferred over a generated replacement');
  assert.equal(storedA.metadata.extra['Zotero field: series'], 'Historia contemporánea');
  assert.equal(storedA.metadata.extra['Zotero field: numPages'], '312');
  assert.equal(storedA.metadata.accessDate, '2025-12-20');
  assert.equal(storedA.metadata.zoteroDateAdded, '2026-01-01');
  assert.equal(storedA.metadata.zoteroDateModified, '2026-02-01');
  assert.equal(storedA.attachments[0].sourceKey, 'PDF', 'PDF wins original-format priority even if Zotero returned an image first');
  assert.equal(storedA.attachments[0].role, 'original');
  assert.equal(storedA.notes[0].source, 'zotero');
  assert.equal(storedA.notes[0].readOnly, true);
  assert.match(storedA.notes[0].markdown, /## Fuente/);
  assert.ok(existsSync(path.join(store.itemFolder(storedA.storageId), storedA.files.original)));
  const storedGroup = store.findItemBySourceIdentity({ source: 'zotero', libraryType: 'group', libraryId: '42', itemKey: 'G1' });
  assert.ok(existsSync(path.join(store.itemFolder(storedGroup.storageId), 'attachments', 'EPUB-grupo.epub')));
  assert.deepEqual(storedGroup.metadata.isbn, ['9780306406157', '0306406152'], 'a space-separated Zotero ISBN field is a list of ISBNs');
  assert.equal(catalog.findItemIdByMetadataIdentifiers({
    title: 'Otro título', itemType: 'book', creators: [], year: null, isbn: ['0-306-40615-2'], issn: [], tags: [],
  }), storedGroup.id, 'importing the same book again by its ISBN finds the Zotero record instead of duplicating it');
  assert.equal(catalog.getImportSource('zotero:users/0').version, 10);
  assert.equal(catalog.getImportSource('zotero:groups/42').version, 7);

  const operations = new LibraryOperations(store, catalog);
  operations.updateItemMetadata('zotero:A', { publisher: 'Corrección local de Nodus', language: 'ca', rights: undefined });
  operations.addAttachments('zotero:A', [localNote]);
  operations.patchItemTags(['zotero:A'], { add: ['revisión Nodus'], remove: ['historia'] });
  const enrichedA = store.findItemByIdOrAlias(canonicalAId);
  store.upsertItem({
    ...enrichedA,
    provenance: [{ provider: 'Crossref', providerId: '10.1234/norma' }],
    relations: [{ id: 'rel-1', targetItemId: storedGroup.id, relationType: 'cites', createdAt: '2026-01-01T00:00:00.000Z' }],
    vaultWorkIds: { 'vault-test': 'legacy-work-a' },
  }, enrichedA.clock.revision);
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadataOverrides.publisher, 'Corrección local de Nodus');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadataOverrides.rights, null, 'cleared manager fields use an explicit durable tombstone');

  const groupRevision = storedGroup.clock.revision;
  state.personalVersion = 12;
  state.personalItems = [item({ version: 12, title: 'Norma y deseo — revisado', dateModified: '2026-03-01' })];
  state.deletedPersonal = ['B'];
  const second = await importZoteroLibraries({ requestId: 'refresh', store, catalog, client });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.itemsUpdated, 1);
  assert.equal(second.itemsDeleted, 0, 'legacy deletion counters stay at zero because source disappearance is not local deletion');
  assert.equal(second.itemsSourceMissing, 1);
  assert.equal(second.conflicts, 1, 'a changed source version reports preserved Nodus corrections as a conflict');
  assert.equal(second.attachmentsCopied, 0);
  assert.equal(second.attachmentsUnchanged, 3, 'a correctness-first refresh verifies unchanged group files too');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.title, 'Norma y deseo — revisado');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.publisher, 'Corrección local de Nodus', 'a Zotero refresh preserves local metadata corrections');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.language, 'ca');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).metadata.rights, undefined);
  assert.deepEqual(store.findItemByIdOrAlias(canonicalAId).metadata.tags, ['revisión Nodus'], 'Nodus tag additions and source-tag suppression survive refresh');
  const missingB = store.findItemByIdOrAlias(catalog.resolveItemId('zotero:B') ?? 'zotero:B')
    ?? store.scanMaterializedItems().records.find((entry) => entry.aliases.includes('zotero:B'));
  assert.equal(missingB.deletedAt, null);
  assert.equal(missingB.sourceState, 'source-missing');
  assert.ok(missingB.sourceMissingAt);
  assert.equal(catalog.list().items.find((entry) => entry.id === missingB.id).sourceState, 'source-missing');
  const refreshedA = store.findItemByIdOrAlias(canonicalAId);
  assert.ok(refreshedA.attachments.some((entry) => entry.sourceKey === undefined && entry.fileName === 'local.txt'), 'Zotero refresh retains local Nodus attachments');
  assert.equal(refreshedA.provenance[0].provider, 'Crossref', 'provider provenance survives a Zotero refresh');
  assert.equal(refreshedA.relations[0].targetItemId, storedGroup.id, 'local relations survive a Zotero refresh');
  assert.equal(refreshedA.vaultWorkIds['vault-test'], 'legacy-work-a', 'vault relinking identities survive a Zotero refresh');
  assert.equal(store.findItemByIdOrAlias(storedGroup.id).clock.revision, groupRevision, 'an unchanged group item receives no phantom revision');
  assert.equal(catalog.list().total, 3, 'source-missing items remain visible and recoverable');
  assert.equal(catalog.getImportSource('zotero:users/0').version, 12);

  const groupCollectionId = catalog.resolveCollectionId('zotero:groups:42:GC');
  const groupSubset = await importZoteroLibraries({
    requestId: 'group-subset', selection: { libraryIds: ['groups/42'], collectionIds: [groupCollectionId] },
    store, catalog, client,
  });
  assert.equal(groupSubset.itemsDiscovered, 1, 'a Nodus collection id resolves to the canonical group transport key');
  assert.equal(groupSubset.verification.status, 'passed');

  const currentA = store.findItemByIdOrAlias(canonicalAId);
  const currentComponents = Object.fromEntries(Object.entries(currentA.contentRevision.components).map(([name, component]) => [name, {
    ...component, freshness: 'current', fingerprint: `${name}-before-zotero-file-change`, generatedAt: new Date().toISOString(), reason: null,
  }]));
  store.upsertItem({ ...currentA, contentRevision: {
    ...currentA.contentRevision, revision: currentA.contentRevision.revision + 1, components: currentComponents,
  } }, currentA.clock.revision);
  await writeFile(pdf, '%PDF-1.4\nchanged-fixture-pdf\n');
  state.personalVersion = 13;
  state.personalItems = [item({ version: 13, title: 'Norma y deseo — revisado', dateModified: '2026-03-02' })];
  state.deletedPersonal = [];
  const attachmentRefresh = await importZoteroLibraries({ requestId: 'attachment-refresh', selection: { libraryIds: ['users/0'] }, store, catalog, client });
  assert.equal(attachmentRefresh.attachmentsChanged, 1);
  assert.equal(attachmentRefresh.attachmentsCopied, 1);
  const changedA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(changedA.contentRevision.components.extraction.freshness, 'queued');
  for (const component of ['deep', 'passages', 'ideas', 'embeddings', 'summary']) {
    assert.equal(changedA.contentRevision.components[component].freshness, 'stale', `${component} cannot remain current after Zotero changes the primary file`);
  }

  fileMap.delete('PDF');
  state.personalVersion = 14;
  state.personalItems = [item({ version: 14, title: 'Norma y deseo — revisado', dateModified: '2026-03-03' })];
  const unavailableRefresh = await importZoteroLibraries({ requestId: 'attachment-unavailable', selection: { libraryIds: ['users/0'] }, store, catalog, client });
  assert.equal(unavailableRefresh.attachmentsUnavailable, 1);
  assert.equal(unavailableRefresh.partial, true);
  assert.equal(unavailableRefresh.verification.status, 'blocked');
  assert.equal(sessionStore.get('attachment-unavailable').status, 'failed');
  assert.equal(catalog.getImportSource('zotero:users/0').version, 13, 'a blocked file never advances the source checkpoint');
  const unavailableA = store.findItemByIdOrAlias(canonicalAId);
  assert.equal(unavailableA.attachments.find((entry) => entry.sourceKey === 'PDF').sourceState, 'not-downloaded');
  assert.ok(unavailableA.attachments.some((entry) => entry.fileName === 'local.txt'));

  // A blocked snapshot must be retryable without an artificial Zotero version bump.
  // Restoring the file at the exact same source version completes the pending import.
  fileMap.set('PDF', pdf);
  const unavailableRetry = await importZoteroLibraries({
    requestId: 'attachment-unavailable-retry', selection: { libraryIds: ['users/0'] }, store, catalog, client,
  });
  assert.equal(unavailableRetry.partial, false);
  assert.equal(unavailableRetry.verification.status, 'passed');
  assert.equal(sessionStore.get('attachment-unavailable-retry').status, 'completed');
  assert.equal(catalog.getImportSource('zotero:users/0').version, 14, 'the same-version retry advances only after every file verifies');
  assert.equal(store.findItemByIdOrAlias(canonicalAId).attachments.find((entry) => entry.sourceKey === 'PDF').sourceState, 'available');

  const controller = new AbortController();
  let canceledCatalogCount = 0;
  const canceled = await importZoteroLibraries({
    requestId: 'cancel', selection: { fullRefresh: true }, store, catalog, client, signal: controller.signal,
    onProgress(value) {
      if (value.phase === 'attachments') {
        canceledCatalogCount = catalog.list().total;
        controller.abort();
      }
    },
  });
  assert.equal(canceled.canceled, true);
  assert.equal(canceledCatalogCount, 3);
  assert.equal(catalog.list().total, 3, 'canceling file transfer keeps the already durable catalog');
  assert.equal(sessionStore.get('cancel').status, 'canceled');

  state.availableLibraries = [personal];
  const missingLibrary = await importZoteroLibraries({
    requestId: 'missing-library', selection: { libraryIds: ['groups/42'] }, store, catalog, client,
  });
  assert.equal(missingLibrary.partial, true);
  assert.deepEqual(missingLibrary.librariesMissing, ['groups/42']);
  assert.equal(missingLibrary.failures[0].code, 'library-missing');
  assert.equal(store.findItemByIdOrAlias(storedGroup.id).sourceState, 'library-missing');
  assert.equal(sessionStore.get('missing-library').status, 'failed');
  assert.equal(sessionStore.list()[0].id, 'missing-library');

  const missingLibraryDefault = await importZoteroLibraries({ requestId: 'missing-library-default', store, catalog, client });
  assert.deepEqual(missingLibraryDefault.librariesMissing, ['groups/42'], 'a previously imported group cannot disappear from an unfiltered sync silently');
  assert.equal(missingLibraryDefault.verification.status, 'blocked');

  // The attachment band used to be measured as processedAttachments/totalAttachments,
  // but that total is discovered one item at a time: after the first item it always
  // read "all of them", so every emit reported 100% of the band and the bar sat pinned
  // near the end for the whole copy — on a 14.000-item library, hours of it. Items are
  // known before the pass starts, so they are the denominator. A library big enough to
  // tell the two apart: the old formula yields ONE distinct percent, the new one rises.
  const manyStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-many'), 'zotero-import-device-0002');
  const manyCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-many.sqlite'));
  const manyItems = Array.from({ length: 10 }, (_, index) => item({
    key: `M${index}`, itemKey: `M${index}`, title: `Obra ${index}`, collections: [], version: 1,
  }));
  const manyPercents = [];
  await importZoteroLibraries({
    requestId: 'many', store: manyStore, catalog: manyCatalog,
    client: {
      ...client,
      async libraries() { return [personal]; },
      async libraryVersion() { return 1; },
      async allCollections() { return []; },
      async libraryItems() { return { items: manyItems, version: 1, total: manyItems.length }; },
      async itemAttachments(_userId, key) {
        return [{ key: `PDF${key}`, itemKey: `PDF${key}`, library: personal, title: 'Texto completo', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'norma.pdf', available: true }];
      },
      async attachmentFilePath() { return pdf; },
      async itemNotes() { return []; },
    },
    onProgress(value) { if (value.phase === 'attachments') manyPercents.push(value.percent); },
  });
  assert.ok(new Set(manyPercents).size >= 5,
    `the attachments band tracks item progress instead of pinning at the end (saw ${new Set(manyPercents).size} distinct percents)`);
  assert.ok(Math.min(...manyPercents) < 65, 'the attachments band starts near its own base');
  manyCatalog.close();

  // A PDF dropped straight into Zotero with no bibliographic entry above it. Zotero
  // treats it as a first-class top-level item; `/items/top` returns it alongside real
  // references. It used to be filtered out unconditionally — 603 of 2.155 entries in
  // the library this was measured against — so those files simply never arrived and
  // nothing said so. It is on by default (no author, no year, only a filename), while
  // callers can still disable it explicitly for compatibility.
  const looseFile = path.join(sourceFiles, 'suelto.pdf');
  await writeFile(looseFile, '%PDF-1.4\nstandalone\n');
  const loose = {
    key: 'S1', itemKey: 'S1', library: personal, version: 1, itemType: 'attachment',
    title: 'Un PDF suelto', creators: [], year: null, doi: null, abstract: null, tags: [],
    collections: [], fields: {}, linkMode: 'imported_file', filename: 'suelto.pdf',
  };
  const bookmark = { ...loose, key: 'S2', itemKey: 'S2', title: 'Un marcador', linkMode: 'linked_url', filename: null };
  const looseClient = (rawItems) => ({
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return 1; },
    async allCollections() { return []; },
    async libraryItems(_library, options = {}) {
      // Mirror what zoteroClient does with the raw page, which is where the filter lives.
      let skipped = 0;
      const kept = [];
      for (const entry of rawItems) {
        if (entry.itemType === 'attachment') {
          if (!['imported_file', 'imported_url', 'linked_file'].includes(entry.linkMode)) continue;
          if (!options.includeStandaloneFiles) { skipped += 1; continue; }
        }
        kept.push(entry);
      }
      return { items: kept, version: 1, total: kept.length, standaloneSkipped: skipped };
    },
    async itemAttachments(_userId, key) {
      if (key !== 'S1') return [];
      return [{ key: 'S1', itemKey: 'S1', library: personal, title: 'Un PDF suelto', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'suelto.pdf', available: true }];
    },
    async attachmentFilePath() { return looseFile; },
    async itemNotes() { return []; },
  });
  const paper = item({ key: 'R1', itemKey: 'R1', title: 'Una referencia normal', collections: [], version: 1 });

  const offStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-loose-off'), 'zotero-import-device-0005');
  const offCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-loose-off.sqlite'));
  const off = await importZoteroLibraries({
    requestId: 'loose-off', selection: { includeStandaloneFiles: false },
    store: offStore, catalog: offCatalog, client: looseClient([paper, loose, bookmark]),
  });
  assert.equal(off.itemsCreated, 1, 'an explicit compatibility opt-out keeps only the bibliographic entry');
  assert.equal(off.itemsStandaloneSkipped, 1, 'the skipped file is counted so the dialog can offer the option');
  offCatalog.close();

  const onStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-loose-on'), 'zotero-import-device-0006');
  const onCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-loose-on.sqlite'));
  const on = await importZoteroLibraries({
    requestId: 'loose-on', store: onStore, catalog: onCatalog,
    client: looseClient([paper, loose, bookmark]),
  });
  assert.equal(on.itemsCreated, 2, 'by default, the parentless file becomes a work of its own');
  assert.equal(on.itemsStandaloneSkipped, 0);
  const stored = onStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'S1' });
  assert.equal(stored.attachments.length, 1, 'and its file is copied, resolved from the item itself');
  assert.ok(existsSync(path.join(onStore.itemFolder(stored.storageId), stored.files.original)));
  // A top-level linked_url is a bookmark: importing it would make a work with nothing
  // to read, so it stays out whichever way the option is set.
  assert.equal(onStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'S2' }), null);
  onCatalog.close();

  // A paper as users actually file them: full text, supplementary PDF, dataset,
  // protocol, notes, snapshot and a figure. Every one of them is imported — nothing is
  // discarded — but exactly one becomes `files.original`, the file Nodus reads and
  // analyses. Both PDFs sit in the same format tier, so before supplementary files
  // were demoted the winner was decided by the alphabetical order of the Zotero key.
  const multiFiles = {};
  for (const name of ['main.pdf', 'supp.pdf', 'data.xlsx', 'protocol.docx', 'notes.md', 'snapshot.html', 'figure.png']) {
    multiFiles[name] = path.join(sourceFiles, name);
    await writeFile(multiFiles[name], `fixture ${name}`);
  }
  // Keys chosen so plain alphabetical order puts the supplement first, as it did.
  const children = [
    { itemKey: 'ZZ_MAIN', title: 'Full Text PDF', contentType: 'application/pdf', linkMode: 'imported_url', filename: 'main.pdf' },
    { itemKey: 'AA_SUPP', title: 'Supplementary Information', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'supp.pdf' },
    { itemKey: 'BB_XLSX', title: 'Dataset', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', linkMode: 'imported_file', filename: 'data.xlsx' },
    { itemKey: 'CC_DOCX', title: 'Protocol', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', linkMode: 'imported_file', filename: 'protocol.docx' },
    { itemKey: 'DD_MD', title: 'My notes', contentType: 'text/markdown', linkMode: 'imported_file', filename: 'notes.md' },
    { itemKey: 'EE_SNAP', title: 'Snapshot', contentType: 'text/html', linkMode: 'imported_url_snapshot', filename: 'snapshot.html' },
    { itemKey: 'FF_IMG', title: 'Figure 1', contentType: 'image/png', linkMode: 'imported_file', filename: 'figure.png' },
  ].map((child) => ({ ...child, key: child.itemKey, library: personal, available: true }));
  const multiStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-multi'), 'zotero-import-device-0004');
  const multiCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-multi.sqlite'));
  await importZoteroLibraries({
    requestId: 'multi', store: multiStore, catalog: multiCatalog,
    client: {
      ...client,
      async libraries() { return [personal]; },
      async libraryVersion() { return 1; },
      async allCollections() { return []; },
      async libraryItems() { return { items: [item({ key: 'P1', itemKey: 'P1', title: 'The paper', collections: [], version: 1 })], version: 1, total: 1 }; },
      async itemAttachments() { return children; },
      async attachmentFilePath(_userId, key) { return multiFiles[children.find((child) => child.key === key).filename]; },
      async itemNotes() { return []; },
    },
  });
  const multi = multiStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'P1' });
  assert.equal(multi.attachments.length, children.length, 'every attachment is imported, whatever its format');
  assert.equal(multi.files.original, multi.attachments.find((entry) => entry.fileName === 'main.pdf').relativePath,
    'the full text is what Nodus reads, not the supplementary PDF that sorts before it');
  assert.equal(multi.attachments[0].role, 'original');
  assert.equal(multi.attachments[0].fileName, 'main.pdf');
  assert.equal(multi.attachments.find((entry) => entry.fileName === 'supp.pdf').role, 'supplement');
  assert.equal(multi.attachments.find((entry) => entry.fileName === 'figure.png').role, 'image');
  assert.equal(multi.attachments.find((entry) => entry.fileName === 'snapshot.html').role, 'snapshot');
  // A supplement still outranks a spreadsheet: demotion is within its own format only.
  assert.ok(multi.attachments.findIndex((entry) => entry.fileName === 'supp.pdf')
    < multi.attachments.findIndex((entry) => entry.fileName === 'data.xlsx'));
  multiCatalog.close();

  // A real filename from a user's library. Sanitising percent-encodes every space and
  // the en dash, so 154 characters became a 215-byte name and a 262-byte temporary
  // file — past the 255-byte limit. The copy threw from the one place in the loop with
  // no handler, so it escaped to the per-library catch and abandoned every attachment
  // still queued behind it: an import of 14.000 works silently stopped copying at the
  // first awkward name while the catalogue went on reporting success.
  const longName = 'Uddin et al. - 2013 - Design, Synthesis, and Structure–Activity Relationship Studies of Fluorescent Inhibitors of Cycloxyg - Supplementary Information.pdf';
  const longFile = path.join(sourceFiles, longName);
  await writeFile(longFile, '%PDF-1.4\nsupplementary\n');
  const longStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-long'), 'zotero-import-device-0003');
  const longCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-long.sqlite'));
  const longItems = [
    item({ key: 'L0', itemKey: 'L0', title: 'Con nombre imposible', collections: [], version: 1 }),
    item({ key: 'L1', itemKey: 'L1', title: 'La que venía detrás', collections: [], version: 1 }),
  ];
  const longReport = await importZoteroLibraries({
    requestId: 'long-name', store: longStore, catalog: longCatalog,
    client: {
      ...client,
      async libraries() { return [personal]; },
      async libraryVersion() { return 1; },
      async allCollections() { return []; },
      async libraryItems() { return { items: longItems, version: 1, total: longItems.length }; },
      async itemAttachments(_userId, key) {
        const raw = key === 'L0' ? longName : 'norma.pdf';
        return [{ key: `A${key}`, itemKey: `A${key}`, library: personal, title: 'Texto completo', contentType: 'application/pdf', linkMode: 'imported_file', filename: raw, available: true }];
      },
      async attachmentFilePath(_userId, key) { return key === 'AL0' ? longFile : pdf; },
      async itemNotes() { return []; },
    },
  });
  const longStored = longStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'L0' });
  const longCopied = longStored.attachments[0];
  assert.ok(longCopied, 'a name too long for the filesystem is shortened, not dropped');
  assert.ok(Buffer.byteLength(path.basename(longCopied.relativePath)) <= 255 - 56,
    'the stored name leaves room for the .tmp-<pid>-<uuid> file the copy writes first');
  assert.match(path.basename(longCopied.relativePath), /\.pdf$/, 'the extension survives truncation');
  assert.equal(longCopied.fileName, longName, 'the record keeps the real Zotero filename');
  assert.ok(existsSync(path.join(longStore.itemFolder(longStored.storageId), longCopied.relativePath)));
  const behind = longStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'L1' });
  assert.equal(behind.attachments.length, 1, 'an awkward filename does not abandon the attachments queued behind it');
  assert.equal(longReport.attachmentsCopied, 2);
  longCatalog.close();

  // Child objects have their own Zotero versions. Adding, changing or deleting an
  // attachment must be observed even when the bibliographic parent's version remains
  // unchanged. This exercises the bulk inventory path used by the real client.
  const childOne = path.join(sourceFiles, 'child-one.pdf');
  const childTwo = path.join(sourceFiles, 'child-two.pdf');
  await writeFile(childOne, '%PDF-1.4\nchild-one-v1\n');
  await writeFile(childTwo, '%PDF-1.4\nchild-two\n');
  const childState = { version: 1, attachments: [
    { key: 'C1', itemKey: 'C1', library: personal, title: 'Child one', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'child-one.pdf', available: true, version: 1, parentItem: 'PARENT', dateModified: '2026-01-01' },
  ] };
  const parent = item({ key: 'PARENT', itemKey: 'PARENT', title: 'Stable parent', collections: [], version: 1 });
  const childPaths = new Map([['C1', childOne], ['C2', childTwo]]);
  const childClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return childState.version; },
    async libraryInventory(library) {
      return {
        library, items: [parent], collections: [], attachments: childState.attachments,
        notes: [], version: childState.version, total: 1, standaloneSkipped: 0, attempts: 1,
      };
    },
    async attachmentFilePath(_userId, key) { return childPaths.get(key) ?? null; },
  };
  const childStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-child-inventory'), 'zotero-import-device-0007');
  const childCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-child-inventory.sqlite'));
  const childFirst = await importZoteroLibraries({ requestId: 'child-first', store: childStore, catalog: childCatalog, client: childClient });
  assert.equal(childFirst.verification.status, 'passed');
  assert.equal(childFirst.attachmentsCopied, 1);

  await writeFile(childOne, '%PDF-1.4\nchild-one-v2\n');
  childState.version = 2;
  childState.attachments = [
    { ...childState.attachments[0], version: 2, dateModified: '2026-02-01' },
    { key: 'C2', itemKey: 'C2', library: personal, title: 'Child two', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'child-two.pdf', available: true, version: 2, parentItem: 'PARENT', dateModified: '2026-02-01' },
  ];
  const childSecond = await importZoteroLibraries({ requestId: 'child-second', store: childStore, catalog: childCatalog, client: childClient });
  assert.equal(childSecond.verification.status, 'passed');
  assert.equal(childSecond.verification.expected.attachments, 2);
  assert.equal(childSecond.verification.imported.attachments, 2);
  assert.equal(childSecond.attachmentsChanged, 1, 'child content changed without a parent version bump');
  assert.equal(childSecond.attachmentsCopied, 2, 'the changed child and newly-added second child are both copied');
  let childStored = childStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'PARENT' });
  assert.equal(childStored.attachments.filter((entry) => entry.sourceState === 'available').length, 2);

  childState.version = 3;
  childState.attachments = [childState.attachments[1]];
  const childThird = await importZoteroLibraries({ requestId: 'child-third', store: childStore, catalog: childCatalog, client: childClient });
  assert.equal(childThird.verification.status, 'passed');
  childStored = childStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'PARENT' });
  assert.equal(childStored.attachments.find((entry) => entry.sourceKey === 'C1').sourceState, 'source-missing');
  assert.equal(childStored.attachments.find((entry) => entry.sourceKey === 'C2').sourceState, 'available');

  // A destination that exists is never trusted by filename or saved metadata alone.
  // Corrupt it, re-run at the same source version, and require a repaired, re-hashed copy.
  const currentChildTwo = childStored.attachments.find((entry) => entry.sourceKey === 'C2');
  await writeFile(path.join(childStore.itemFolder(childStored.storageId), currentChildTwo.relativePath), 'corrupt destination');
  const repaired = await importZoteroLibraries({ requestId: 'child-corrupt-repair', store: childStore, catalog: childCatalog, client: childClient });
  assert.equal(repaired.verification.status, 'passed');
  assert.equal(repaired.attachmentsCopied, 1);
  childStored = childStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'PARENT' });
  const repairedChildTwo = childStored.attachments.find((entry) => entry.sourceKey === 'C2');
  assert.equal(
    await readFile(path.join(childStore.itemFolder(childStored.storageId), repairedChildTwo.relativePath), 'utf8'),
    await readFile(childTwo, 'utf8'),
  );

  // An unchanged sync reads each file once at each end, not twice: the verification
  // barrier reuses a digest whose file has not changed since it was taken.
  const opened = [];
  const realCreateReadStream = fs.createReadStream;
  fs.createReadStream = function (file, ...rest) { opened.push(String(file)); return realCreateReadStream.call(this, file, ...rest); };
  let unchangedRun;
  try {
    unchangedRun = await importZoteroLibraries({ requestId: 'child-unchanged', store: childStore, catalog: childCatalog, client: childClient });
  } finally { fs.createReadStream = realCreateReadStream; }
  assert.equal(unchangedRun.verification.status, 'passed');
  assert.equal(unchangedRun.attachmentsUnchanged, 1);
  assert.equal(opened.filter((file) => file === childTwo).length, 1, 'the unchanged source is read once per sync');
  assert.equal(opened.filter((file) => file.startsWith(childStore.itemFolder(childStored.storageId))).length, 1, 'the unchanged copy is read once per sync');
  // A source rewritten between the copy and the verification barrier is still caught.
  const childTwoBytes = await readFile(childTwo);
  const raced = await importZoteroLibraries({
    requestId: 'child-raced', store: childStore, catalog: childCatalog, client: childClient,
    onProgress(value) { if (value.phase === 'verification') writeFileSync(childTwo, '%PDF-1.4\nchild-tw0\n'); },
  });
  assert.equal(raced.verification.status, 'blocked', 'a source that changed after hashing fails verification');
  await writeFile(childTwo, childTwoBytes);

  // Zotero can rename/retype an attachment without changing its bytes. A hash-only
  // fast path used to retain the old filename, extension and MIME while verification
  // still reported PASS, which could send the file to the wrong extractor.
  const renamedChildTwo = path.join(sourceFiles, 'child-two-renamed.epub');
  await writeFile(renamedChildTwo, await readFile(childTwo));
  childPaths.set('C2', renamedChildTwo);
  childState.version = 4;
  childState.attachments = [{
    ...childState.attachments[0], version: 4, filename: 'child-two-renamed.epub',
    contentType: 'application/epub+zip', dateModified: '2026-03-01',
  }];
  const descriptorRefresh = await importZoteroLibraries({
    requestId: 'child-descriptor-refresh', store: childStore, catalog: childCatalog, client: childClient,
  });
  assert.equal(descriptorRefresh.verification.status, 'passed');
  assert.equal(descriptorRefresh.attachmentsChanged, 1);
  childStored = childStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'PARENT' });
  const renamedChildRecord = childStored.attachments.find((entry) => entry.sourceKey === 'C2');
  assert.equal(renamedChildRecord.fileName, 'child-two-renamed.epub');
  assert.equal(renamedChildRecord.mimeType, 'application/epub+zip');
  assert.match(renamedChildRecord.relativePath, /\.epub$/);
  assert.ok(existsSync(path.join(childStore.itemFolder(childStored.storageId), renamedChildRecord.relativePath)));
  childCatalog.close();

  // Changing the standalone-file option after a successful checkpoint must still
  // discover old files at the same Zotero version; a `since`-only importer misses it.
  const transitionStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-standalone-transition'), 'zotero-import-device-0008');
  const transitionCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-standalone-transition.sqlite'));
  const transitionPaper = item({ key: 'TRANSITION-PAPER', itemKey: 'TRANSITION-PAPER', title: 'Paper', collections: [], version: 5 });
  const transitionLoose = { ...loose, key: 'TRANSITION-FILE', itemKey: 'TRANSITION-FILE', version: 5 };
  const transitionAttachment = {
    key: 'TRANSITION-FILE', itemKey: 'TRANSITION-FILE', library: personal, title: 'Un PDF suelto',
    contentType: 'application/pdf', linkMode: 'imported_file', filename: 'suelto.pdf', available: true,
    version: 5, parentItem: null, dateModified: '2026-03-01',
  };
  const transitionClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return 5; },
    async libraryInventory(library, options = {}) {
      const enabled = options.includeStandaloneFiles !== false;
      return {
        library, items: enabled ? [transitionPaper, transitionLoose] : [transitionPaper], collections: [],
        attachments: [transitionAttachment], notes: [], version: 5, total: 2,
        standaloneSkipped: enabled ? 0 : 1, attempts: 1,
      };
    },
    async attachmentFilePath() { return looseFile; },
  };
  const transitionOff = await importZoteroLibraries({
    requestId: 'transition-off', selection: { includeStandaloneFiles: false },
    store: transitionStore, catalog: transitionCatalog, client: transitionClient,
  });
  assert.equal(transitionOff.itemsCreated, 1);
  assert.equal(transitionOff.verification.status, 'passed');
  assert.equal(transitionCatalog.getImportSource('zotero:users/0').version, 5);
  const transitionOn = await importZoteroLibraries({
    requestId: 'transition-on', store: transitionStore, catalog: transitionCatalog, client: transitionClient,
  });
  assert.equal(transitionOn.itemsCreated, 1, 'the old standalone file is found despite an unchanged library checkpoint');
  assert.equal(transitionOn.verification.status, 'passed');
  assert.ok(transitionStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'TRANSITION-FILE' }));
  transitionCatalog.close();

  // A "filed only" refresh must consume the full inventory to reconcile items
  // that were moved out of their last Zotero collection or deleted altogether.
  const filedState = {
    version: 1,
    items: [item({ key: 'FILED', itemKey: 'FILED', title: 'Filed item', collections: ['FILED-C'], version: 1 })],
  };
  const filedCollection = {
    key: 'FILED-C', itemKey: 'FILED-C', library: personal, name: 'Filed',
    parentCollection: false, itemCount: 1, subCount: 0,
  };
  const filedClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return filedState.version; },
    async libraryInventory(library) {
      return {
        library, items: filedState.items, collections: [filedCollection], attachments: [], notes: [],
        version: filedState.version, total: filedState.items.length, standaloneSkipped: 0, attempts: 1,
      };
    },
  };
  const filedStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-filed-only'), 'zotero-import-device-0010');
  const filedCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-filed-only.sqlite'));
  assert.equal((await importZoteroLibraries({
    requestId: 'filed-first', selection: { copyAttachments: false },
    store: filedStore, catalog: filedCatalog, client: filedClient,
  })).verification.status, 'passed');
  filedState.version = 2;
  filedState.items = [{ ...filedState.items[0], version: 2, collections: [] }];
  const becameUnfiled = await importZoteroLibraries({
    requestId: 'filed-moved-out', selection: { includeUnfiled: false, copyAttachments: false },
    store: filedStore, catalog: filedCatalog, client: filedClient,
  });
  assert.equal(becameUnfiled.itemsDiscovered, 0);
  assert.equal(becameUnfiled.verification.status, 'passed');
  const filedStored = filedStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'FILED' });
  assert.deepEqual(filedStored.collectionIds, [], 'filed-only refresh removes a stale Zotero membership');
  assert.equal(filedStored.sourceState, 'current');
  filedState.version = 3;
  filedState.items = [];
  await importZoteroLibraries({
    requestId: 'filed-deleted', selection: { includeUnfiled: false, copyAttachments: false },
    store: filedStore, catalog: filedCatalog, client: filedClient,
  });
  assert.equal(
    filedStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'FILED' }).sourceState,
    'source-missing',
  );
  filedCatalog.close();

  // Linked files can change without a Zotero version increment. Mutate the source
  // after the copy and require the final source+destination hash barrier to block.
  const raceFile = path.join(sourceFiles, 'linked-race.pdf');
  await writeFile(raceFile, '%PDF-1.4\nlinked-before\n');
  const raceItem = item({ key: 'RACE', itemKey: 'RACE', title: 'Linked race', collections: [], version: 1 });
  const raceAttachment = {
    key: 'RACE-FILE', itemKey: 'RACE-FILE', library: personal, title: 'Linked PDF',
    contentType: 'application/pdf', linkMode: 'linked_file', filename: 'linked-race.pdf', available: true,
    version: 1, parentItem: 'RACE', dateModified: '2026-03-01',
  };
  const raceClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return 1; },
    async libraryInventory(library) {
      return {
        library, items: [raceItem], collections: [], attachments: [raceAttachment], notes: [],
        version: 1, total: 1, standaloneSkipped: 0, attempts: 1,
      };
    },
    async attachmentFilePath() { return raceFile; },
  };
  const raceStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-linked-race'), 'zotero-import-device-0011');
  const raceCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-linked-race.sqlite'));
  let sourceMutated = false;
  const raceReport = await importZoteroLibraries({
    requestId: 'linked-race', store: raceStore, catalog: raceCatalog, client: raceClient,
    onProgress(value) {
      if (value.phase === 'verification' && !sourceMutated) {
        sourceMutated = true;
        writeFileSync(raceFile, '%PDF-1.4\nlinked-after\n');
      }
    },
  });
  assert.equal(raceReport.verification.status, 'blocked');
  assert.equal(raceReport.partial, true);
  assert.equal(raceCatalog.getImportSource('zotero:users/0'), null, 'a source hash race never advances the checkpoint');
  raceCatalog.close();

  // Hashing and copying large files must remain cancellable and must not leave a
  // temporary partial copy behind in the item folder.
  const cancelFile = path.join(sourceFiles, 'cancel-large.pdf');
  await writeFile(cancelFile, Buffer.alloc(32 * 1024 * 1024, 0x5a));
  const cancelItem = item({ key: 'CANCEL-LARGE', itemKey: 'CANCEL-LARGE', title: 'Large cancel', collections: [], version: 1 });
  const cancelAttachment = {
    key: 'CANCEL-FILE', itemKey: 'CANCEL-FILE', library: personal, title: 'Large PDF',
    contentType: 'application/pdf', linkMode: 'linked_file', filename: 'cancel-large.pdf', available: true,
    version: 1, parentItem: 'CANCEL-LARGE', dateModified: '2026-03-01',
  };
  const cancelLargeClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return 1; },
    async libraryInventory(library) {
      return { library, items: [cancelItem], collections: [], attachments: [cancelAttachment], notes: [], version: 1, total: 1, standaloneSkipped: 0, attempts: 1 };
    },
    async attachmentFilePath() { return cancelFile; },
  };
  const cancelStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-cancel-large'), 'zotero-import-device-0012');
  const cancelCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-cancel-large.sqlite'));
  const alreadyCanceledController = new AbortController();
  alreadyCanceledController.abort();
  const alreadyCanceled = await importZoteroLibraries({
    requestId: 'already-canceled', store: cancelStore, catalog: cancelCatalog, client: cancelLargeClient,
    signal: alreadyCanceledController.signal,
  });
  assert.equal(alreadyCanceled.canceled, true, 'a pre-aborted import settles cleanly instead of leaving a rejected file stream');
  const cancelController = new AbortController();
  let cancelScheduled = false;
  const canceledLarge = await importZoteroLibraries({
    requestId: 'cancel-large', store: cancelStore, catalog: cancelCatalog, client: cancelLargeClient,
    signal: cancelController.signal,
    onProgress(value) {
      if (value.phase === 'attachments' && !cancelScheduled) {
        cancelScheduled = true;
        setTimeout(() => cancelController.abort(), 0);
      }
    },
  });
  assert.equal(canceledLarge.canceled, true, 'the event loop remains responsive enough to cancel a large-file hash/copy');
  const canceledStored = cancelStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'CANCEL-LARGE' });
  const cancelAttachmentFolder = path.join(cancelStore.itemFolder(canceledStored.storageId), 'attachments');
  if (existsSync(cancelAttachmentFolder)) {
    assert.ok(!(await readdir(cancelAttachmentFolder)).some((name) => name.includes('.tmp-')), 'cancellation cleans temporary copies');
  }
  cancelCatalog.close();

  // A subset sync also reconciles objects leaving the selected subtree. Otherwise a
  // 0/0 verification advances the checkpoint while stale memberships remain forever.
  const subsetState = {
    version: 1,
    collections: [{ key: 'SUBSET', itemKey: 'SUBSET', library: personal, name: 'Subset', parentCollection: false, itemCount: 1, subCount: 0 }],
    items: [item({ key: 'SUBSET-ITEM', itemKey: 'SUBSET-ITEM', title: 'Moves out', collections: ['SUBSET'], version: 1 })],
  };
  const subsetClient = {
    ...client,
    async libraries() { return [personal]; },
    async libraryVersion() { return subsetState.version; },
    async libraryInventory(library) {
      return {
        library, items: subsetState.items, collections: subsetState.collections,
        attachments: [], notes: [], version: subsetState.version,
        total: subsetState.items.length, standaloneSkipped: 0, attempts: 1,
      };
    },
  };
  const subsetStore = new LibraryDiskStore(path.join(scratch, 'backups', 'nodus-subset-reconcile'), 'zotero-import-device-0009');
  const subsetCatalog = new LibraryCatalog(path.join(userData, 'library', 'catalog-subset-reconcile.sqlite'));
  const subsetFirst = await importZoteroLibraries({
    requestId: 'subset-first', selection: { copyAttachments: false },
    store: subsetStore, catalog: subsetCatalog, client: subsetClient,
  });
  assert.equal(subsetFirst.verification.status, 'passed');
  const subsetCollectionId = subsetCatalog.findCollectionIdBySource('zotero', 'users/0', 'SUBSET');
  subsetState.version = 2;
  subsetState.items = [{ ...subsetState.items[0], version: 2, collections: [] }];
  const subsetMoved = await importZoteroLibraries({
    requestId: 'subset-moved', selection: { collectionIds: [subsetCollectionId], copyAttachments: false },
    store: subsetStore, catalog: subsetCatalog, client: subsetClient,
  });
  assert.equal(subsetMoved.itemsDiscovered, 0);
  assert.equal(subsetMoved.verification.status, 'passed');
  assert.deepEqual(
    subsetStore.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: 'SUBSET-ITEM' }).collectionIds,
    [],
    'moving an item outside a selected collection removes the stale membership',
  );
  subsetState.version = 3;
  subsetState.collections = [];
  const subsetDeletedCollection = await importZoteroLibraries({
    requestId: 'subset-collection-deleted', selection: { collectionIds: [subsetCollectionId], copyAttachments: false },
    store: subsetStore, catalog: subsetCatalog, client: subsetClient,
  });
  assert.equal(subsetDeletedCollection.verification.status, 'passed');
  assert.equal(subsetStore.readMaterializedCollection(subsetCollectionId).sourceState, 'source-missing');
  subsetCatalog.close();

  const sourceAfter = await Promise.all([pdf, image, epub].map((file) => readFile(file, 'utf8')));
  assert.equal(sourceAfter[1], sourceBefore[1]);
  assert.equal(sourceAfter[2], sourceBefore[2]);
  catalog.close();
  console.log('Global one-way Zotero import, differential refresh, attachments and cancellation tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
