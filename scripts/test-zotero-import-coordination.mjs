import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFile(new URL(file, root), 'utf8');

test('global Zotero imports are serialized across request sources', async () => {
  const service = await read('electron/library/libraryService.ts');
  const importer = await read('electron/library/zoteroLibraryImport.ts');
  assert.match(service, /let zoteroImportTail: Promise<void> = Promise\.resolve\(\);/);
  assert.match(service, /const previous = zoteroImportTail;/);
  assert.match(service, /await previous;/);
  assert.match(service, /zoteroImportTail = new Promise<void>/);
  assert.match(service, /deferSessionCompletion: true/);
  assert.match(service, /if \(!report\.partial && !report\.canceled && report\.verification\?\.status !== 'blocked'\)/);
  assert.match(service, /sessions\.finish\(requestId, 'completed', report\)/);
  assert.match(importer, /options\.deferSessionCompletion \? 'rebuild' : 'complete'/);
  assert.match(service, /activeImport\.cancelable = false;[\s\S]*sessions\.finish\(requestId, 'completed', report\)/);
  assert.match(service, /if \(!active\?\.cancelable \|\| active\.controller\.signal\.aborted\) return false/);
  assert.match(service, /finish\(requestId, 'failed', failedReport/);
  assert.match(service, /Falló el postproceso obligatorio/);
  assert.match(service, /session\.status === 'running' && !zoteroImports\.has\(session\.id\)/);
  assert.match(service, /session\.status === 'running' && zoteroImports\.has\(requestId\)/);
});

test('account Zotero commands validate selection at the service boundary', async () => {
  const service = await read('electron/library/libraryService.ts');
  const account = await read('electron/serverSync/accountLibrarySync.ts');
  assert.match(service, /export function normalizeZoteroImportSelection\(input: unknown\)/);
  assert.match(service, /La selección de Zotero contiene/);
  assert.match(account, /normalizeZoteroImportSelection\(payload\.selection\)/);
  assert.match(account, /report\.partial \|\| report\.verification\?\.status === 'blocked'/);
  assert.match(account, /zotero_import_verification_failed/);
  assert.doesNotMatch(account, /payload\.selection[^\n]*as never/);
});

test('plugin library import includes parentless Zotero documents', async () => {
  const plugin = await read('electron/zotero-plugin/server.ts');
  assert.match(plugin, /includeUnfiled: true, copyAttachments: true, includeStandaloneFiles: true/);
  assert.match(plugin, /zotero_import_verification_failed/);
  assert.match(plugin, /sendJson\(res, 409/);
});

test('legacy collection traversal records failed child pages', async () => {
  const sync = await read('electron/sync/syncService.ts');
  assert.match(sync, /collectionItemsRecursiveObserved/);
  assert.match(sync, /failures\.push\(`\$\{key\}:children:/);
  assert.match(sync, /fallos de colección/);
  assert.match(sync, /collection traversal failed/);
  assert.match(sync, /No se avanzó el checkpoint/);
  assert.match(sync, /if \(collectionFailures\.length === 0\)/);
  assert.match(sync, /startingVersions = await fetchLibraryVersions/);
  assert.match(sync, /const endingVersions = await fetchLibraryVersions/);
  assert.match(sync, /startingVersions\?\.\[key\] !== endingVersions\[key\]/);
  assert.match(sync, /Zotero cambió durante el recorrido/);
});

test('legacy reconciliation removes only stale Zotero membership edges', async () => {
  const sync = await read('electron/sync/syncService.ts');
  assert.match(sync, /const previousMonitoredScope = expandCollectionKeys\(settings\.monitoredCollections\)/);
  assert.match(sync, /observedMemberships\.set\(item\.key, new Set\(item\.collections\)\)/);
  assert.match(sync, /observedWorkMemberships\.get\(nodusId\)/);
  assert.match(sync, /for \(const \[nodusId, memberships\] of observedWorkMemberships\)/);
  assert.match(sync, /addWorkCollections\(nodusId, \[\.\.\.memberships\]\)/);
  assert.match(sync, /FROM work_aliases/);
  assert.match(sync, /observedMemberships\.get\(key\)\?\.has\(row\.collection_key\)/);
  assert.match(sync, /await reconcileMonitoredCollectionMemberships\(observedMemberships, settings\.monitoredCollections, previousMonitoredScope, cooperate\)/);
  assert.match(sync, /expandCollectionKeys\(\[\.\.\.new Set\(monitored/);
  assert.match(sync, /SELECT wc\.nodus_id, wc\.collection_key, w\.zotero_key/);
  assert.doesNotMatch(sync, /WHERE wc\.collection_key IN \(\$\{placeholders\}\)[\s\S]{0,80}w\.zotero_key IS NOT NULL/);
  assert.match(sync, /if \(row\.zotero_key\) identities\.add\(row\.zotero_key\)/);
  assert.match(sync, /identities\.length > 0/);
  assert.match(sync, /DELETE FROM work_collections WHERE nodus_id = \? AND collection_key = \?/);
  assert.match(sync, /if \(collectionFailures\.length === 0\) \{[\s\S]*reconcileMonitoredCollectionMemberships[\s\S]*setLibraryVersions/);
  assert.match(sync, /A work row .* is never deleted/);
});
