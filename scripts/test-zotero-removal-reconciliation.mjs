// Behavior tests for the real sync, merge, selection, queue and retrieval modules.
// Only settings, database connection, HTTP and unrelated UI/AI side effects are faked.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-removal-reconciliation')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-removal-reconciliation-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Module = require('node:module');
const previousLoad = Module._load;
const previousResolve = Module._resolveFilename;
const context = new AsyncLocalStorage();
let db;
let activeVault = { id: 'review', type: 'research' };
let corpusChanges = 0;
const settings = { zoteroUserId: '0', monitoredCollections: ['MONITOR1'], readTag: 'read',
  embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', academicMode: 'manual',
  autoLightScan: false, autoDeepScanOnReadTag: false, documentIndexingEnabled: false, syncMode: 'realtime' };
const stubs = new Map(Object.entries({
  'electron/db/database.ts': { getDb: () => context.getStore() ?? db, setVectorScanQuery() {},
    withDatabaseContext: (connection, work) => context.run(connection, work) },
  'electron/db/settingsRepo.ts': { getSettings: () => settings },
  'electron/ai/academicMode.ts': { isManualAcademic: () => true },
  'electron/pipeline/scanQueue.ts': { scanQueue: { enqueue() { throw Error('Unexpected AI queue'); } } },
  'electron/extraction/textExtractor.ts': { probeWorkTextAvailability() { throw Error('Unexpected text probe'); } },
  'electron/vaults/vaultRegistry.ts': { getActiveVault: () => activeVault },
  'electron/ai/documentaryPreparation.ts': { notifyResearchCorpusChanged: () => { corpusChanges++; } },
  'electron/pipeline/documentIndexQueue.ts': { documentIndexQueue: { refreshVault() { throw Error('Unexpected index queue'); } } },
}).map(([file, value]) => [path.join(repoRoot, file), value]));
Module._load = function(request, parent, isMain) {
  const filename = previousResolve.call(this, request, parent, isMain);
  return stubs.has(filename) ? stubs.get(filename) : previousLoad.call(this, request, parent, isMain);
};
const Database = require('better-sqlite3');
const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const sync = require(path.join(repoRoot, 'electron/sync/syncService.ts'));
const removal = require(path.join(repoRoot, 'electron/sync/zoteroRemoval.ts'));
const { mergeWorks } = require(path.join(repoRoot, 'electron/db/dedupe.ts'));
const { lexicalPassageSearch } = require(path.join(repoRoot, 'electron/db/passagesRepo.ts'));
let version, observed, presences, requests, probes, failCollection, missingGroups, groupVersions, onFetch;
const originalFetch = globalThis.fetch;
function reset() {
  sync.stopZoteroSync();
  db?.close(); db = new Database(':memory:'); runMigrations(db);
  version = 42; observed = []; presences = new Map(); requests = []; probes = [];
  failCollection = false; missingGroups = new Set(); groupVersions = new Map([['42', 17]]); onFetch = () => {};
  settings.monitoredCollections = ['MONITOR1'];
  settings.syncMode = 'realtime';
  activeVault = { id: 'review', type: 'research' }; corpusChanges = 0;
}
function work(id, key, collection = null, archived = 0, doi = null) {
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,archived,doi) VALUES(?,?,?,'[]','book',?,?)")
    .run(id, key, `Work ${id}`, archived, doi);
  if (collection) membership(id, collection);
}
function membership(id, collection) {
  db.prepare('INSERT OR IGNORE INTO work_collections(nodus_id,collection_key) VALUES(?,?)').run(id, collection);
}
function alias(id, key) { db.prepare('INSERT INTO work_aliases(nodus_id,zotero_key) VALUES(?,?)').run(id, key); }
function merged(main = 'GONE0001', duplicate = 'LIVE0001', collection = 'MONITOR1') {
  work('merged', main, collection); work('duplicate', duplicate, collection);
  assert.equal(mergeWorks(db, 'merged', ['duplicate']), 1);
}
function passage(id) {
  db.prepare(`INSERT INTO passages(passage_id,nodus_id,chunk_index,text,char_len,content_hash,created_at)
    VALUES(?,?,0,'quimioterapia evidencia verificable',36,'hash','2026-09-30')`).run(`${id}#0`, id);
}
function state(id) { return db.prepare('SELECT archived FROM works WHERE nodus_id=?').get(id).archived; }
function item(key, collections = ['MONITOR1'], doi = null) {
  return { key, version: 1, data: { key, version: 1, itemType: 'book', title: `Work ${key}`,
    creators: [], tags: [], collections, DOI: doi } };
}
function json(body, status = 200, libraryVersion = version) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json',
    'Last-Modified-Version': String(libraryVersion), 'Total-Results': String(Array.isArray(body) ? body.length : 0) } });
}
globalThis.fetch = async (url, options) => {
  const u = new URL(url), p = u.pathname;
  requests.push(p + u.search);
  await onFetch(u, options);
  const group = p.match(/^\/api\/groups\/([^/]+)/)?.[1];
  const libraryVersion = group ? groupVersions.get(group) ?? 17 : version;
  if (group && missingGroups.has(group)) return json({}, 404, libraryVersion);
  if (p === '/api/users/0/groups') return json([...groupVersions.keys()].filter(id => !missingGroups.has(id)).map(id => ({ id, data: { name: `Group ${id}` } })));
  if (p.endsWith('/collections/top')) return json(group ? [] : [{ key: 'MONITOR1', data: { name: 'Monitored', parentCollection: false } }], 200, libraryVersion);
  if (/\/collections\/[^/]+\/collections$/.test(p)) return json([], 200, libraryVersion);
  if (/\/collections\/MONITOR[12]\/items\/top$/.test(p)) return failCollection ? json({}, 500) : json(observed);
  if (/\/api\/(users|groups)\/[^/]+\/items$/.test(p)) return json([], 200, libraryVersion);
  const match = p.match(/\/api\/(users|groups)\/([^/]+)\/items\/([^/]+)$/);
  if (match) {
    const key = match[1] === 'groups' ? `groups:${match[2]}:${match[3]}` : match[3];
    probes.push(key);
    const value = presences.get(key) ?? 'present';
    if (value === 'gone') return new Response('Not found', { status: 404 }); // Real 404s need not carry a version.
    if (value === 'unknown') return json({}, 500, libraryVersion);
    if (value === 'retry') return json({}, 503, libraryVersion);
    return json({ data: { key: match[3], deleted: value === 'trashed' ? 1 : undefined } }, 200, libraryVersion);
  }
  throw Error(`Unexpected URL: ${url}`);
};
const pass = () => sync.fullSync('manual', { catalogOnly: true });
const drain = (ids = [], options = {}) => removal.archiveWorksRemovedFromZotero('0', ids, { monitored: settings.monitoredCollections, ...options });
const pending = () => removal.hasPendingZoteroRemovalChecks();
async function tick(callback) {
  const set = globalThis.setInterval, clear = globalThis.clearInterval;
  let poll;
  globalThis.setInterval = fn => { poll = fn; return 123; };
  globalThis.clearInterval = () => {};
  try { sync.startRealtimeSync(); await (callback ? callback(poll) : poll()); }
  finally { sync.stopRealtimeSync(); globalThis.setInterval = set; globalThis.clearInterval = clear; }
}

try {
  await test('trash and deletion archive, exclude retrieval and preserve passages', async () => {
    for (const presence of ['trashed', 'gone']) {
      reset(); work('removed', 'GONE0001', 'MONITOR1'); passage('removed'); presences.set('GONE0001', presence);
      assert.equal(lexicalPassageSearch('quimioterapia', 10).length, 1);
      await pass(); assert.equal(state('removed'), 1); assert.equal(pending(), false);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM work_collections').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM passages').get().n, 1);
      assert.equal(lexicalPassageSearch('quimioterapia', 10).length, 0);
    }
  });
  await test('a live alias outside monitored collections protects an explicit merge', async () => {
    reset(); merged(); presences.set('GONE0001', 'gone'); await pass();
    assert.equal(state('merged'), 0); assert.deepEqual(probes, ['GONE0001', 'LIVE0001']); assert.equal(pending(), false);
  });
  await test('all identities must be removed; personal and group keys stay distinct', async () => {
    reset(); merged('SAME0001', 'groups:42:SAME0001'); presences.set('SAME0001', 'gone');
    await pass(); assert.equal(state('merged'), 0); assert.ok(probes.includes('groups:42:SAME0001'));
    presences.set('groups:42:SAME0001', 'trashed'); await pass(); assert.equal(state('merged'), 1);
  });
  await test('a removed alias cannot archive a present canonical record', async () => {
    reset(); merged('LIVE0001', 'GONE0001'); presences.set('GONE0001', 'gone'); await pass();
    assert.equal(state('merged'), 0); assert.deepEqual(probes, ['LIVE0001']);
  });
  await test('unknown canonical or alias keeps the merge and retries later', async () => {
    for (const uncertain of ['GONE0001', 'LIVE0001']) {
      reset(); merged(); presences.set('GONE0001', 'gone'); presences.set('LIVE0001', 'gone'); presences.set(uncertain, 'unknown');
      await pass(); assert.equal(state('merged'), 0); assert.equal(pending(), true);
      presences.set(uncertain, 'gone'); await drain(); assert.equal(state('merged'), 1); assert.equal(pending(), false);
    }
  });
  await test('an observed monitored alias retains the union of memberships', async () => {
    reset(); merged(); membership('merged', 'MONITOR2'); settings.monitoredCollections.push('MONITOR2');
    observed = [item('LIVE0001', ['MONITOR1', 'MONITOR2'])];
    await pass(); assert.equal(state('merged'), 0); assert.deepEqual(probes, []);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_collections WHERE nodus_id=?').get('merged').n, 2);
  });
  await test('direct, alias and DOI restoration reactivate the existing work without duplicates', async () => {
    for (const match of ['direct', 'alias', 'doi']) {
      reset(); work('restored', 'RESTORE1', null, 1, match === 'doi' ? '10.1000/example' : null); passage('restored');
      if (match === 'alias') alias('restored', 'ALIAS001');
      observed = [item(match === 'direct' ? 'RESTORE1' : match === 'alias' ? 'ALIAS001' : 'NEWDOI01', ['MONITOR1'], match === 'doi' ? '10.1000/example' : null)];
      await pass(); assert.equal(state('restored'), 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 1);
      assert.equal(lexicalPassageSearch('quimioterapia', 10).length, 1);
    }
  });
  await test('local, local-merged, manual and already archived works never authorize probes', async () => {
    reset(); work('local', 'nodus-library:abc'); work('manual', null); work('archived', 'OLD00001', null, 1);
    work('merged-local', 'GONE0001'); alias('merged-local', 'nodus-library:def'); presences.set('GONE0001', 'gone');
    await drain(['local', 'manual', 'archived', 'merged-local']); assert.deepEqual(requests, []);
    assert.equal(state('merged-local'), 0); assert.equal(pending(), false);
  });
  await test('selection excludes observed aliases and monitored descendants, even with a bounded output', async () => {
    reset(); work('observed-alias', 'GONE0001'); alias('observed-alias', 'LIVE0001'); work('descendant', 'CHILD001', 'CHILD');
    db.prepare("INSERT INTO collections(collection_key,name,parent_key) VALUES('CHILD','Child','MONITOR1')").run();
    work('candidate', 'GONE0002');
    assert.deepEqual(removal.unobservedUnmonitoredWorks(new Map([['LIVE0001', new Set()]]), ['MONITOR1']), ['candidate']);
    assert.deepEqual(removal.unobservedUnmonitoredWorks(new Map(), [], 300), []);
    assert.deepEqual(removal.unobservedUnmonitoredWorks(new Map(), ['MONITOR1'], 0), []);
  });
  await test('350 newly unmoored works share the global budget and the next unchanged-version tick drains the rest', async () => {
    reset(); for (let i = 0; i < 350; i++) work(`lost-${i}`, `LOST${String(i).padStart(4, '0')}`, 'MONITOR1');
    await pass(); assert.equal(probes.length, 300); assert.equal(pending(), true);
    requests = []; probes = []; await tick(); assert.equal(probes.length, 50); assert.equal(pending(), false);
  });
  await test('the deleted 301st work advances past 300 present works, including repeated full syncs', async () => {
    reset(); for (let i = 0; i < 300; i++) work(`present-${i}`, `LIVE${String(i).padStart(4, '0')}`);
    work('late-deleted', 'DEAD0300'); presences.set('DEAD0300', 'gone'); await pass();
    assert.equal(state('late-deleted'), 0); await pass(); assert.equal(state('late-deleted'), 1);
  });
  await test('350 deleted works drain without exceeding 300 HTTP requests in any batch', async () => {
    reset(); const ids = [];
    for (let i = 0; i < 350; i++) { const key = `DEAD${String(i).padStart(4, '0')}`; ids.push(`gone-${i}`); work(ids.at(-1), key); presences.set(key, 'gone'); }
    let first = true, batches = 0;
    do {
      requests = []; await drain(first ? ids : []); first = false;
      assert.ok(requests.length <= 300); assert.ok(++batches < 10, 'the finite queue makes progress');
    } while (pending());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM works WHERE archived=1').get().n, 350);
  });
  await test('a fusion with more than 300 identities continues across batches', async () => {
    reset(); work('large-merge', 'MAIN0001'); presences.set('MAIN0001', 'gone');
    for (let i = 0; i < 310; i++) { const key = `ALIS${String(i).padStart(4, '0')}`; alias('large-merge', key); presences.set(key, 'gone'); }
    await drain(['large-merge']); assert.ok(requests.length <= 300); assert.equal(state('large-merge'), 0); assert.equal(pending(), true);
    requests = []; await drain(); assert.ok(requests.length <= 300); assert.equal(state('large-merge'), 1); assert.equal(pending(), false);
  });
  await test('a merge spanning 201 source libraries advances without spending each batch revalidating old partial evidence', async () => {
    reset(); work('many-groups', 'MAIN0001'); presences.set('MAIN0001', 'gone');
    for (let i = 0; i < 200; i++) { const key = `groups:${i + 100}:ALIAS001`; groupVersions.set(String(i + 100), 17);
      alias('many-groups', key); presences.set(key, 'gone'); }
    let first = true, batches = 0;
    do {
      requests = []; await drain(first ? ['many-groups'] : []); first = false;
      assert.ok(requests.length <= 300); assert.ok(++batches <= 4, 'partial evidence does not starve new source checks');
    } while (pending());
    assert.equal(state('many-groups'), 1);
  });
  await test('a restored key invalidates partial absence evidence after a revision change', async () => {
    reset(); merged('GONE0001', 'LIVE0001', null); presences.set('GONE0001', 'gone'); presences.set('LIVE0001', 'gone');
    await drain(['merged'], { requestLimit: 2 }); assert.equal(state('merged'), 0); assert.equal(pending(), true);
    version++; presences.set('GONE0001', 'present'); probes = [];
    await drain(); assert.equal(state('merged'), 0);
    await drain(); assert.equal(state('merged'), 0); assert.ok(probes.includes('GONE0001')); assert.equal(pending(), false);
  });
  await test('a revision change during the probes discards the archive decision', async () => {
    reset(); merged('GONE0001', 'LIVE0001', null); presences.set('GONE0001', 'gone'); presences.set('LIVE0001', 'gone');
    let reads = 0;
    onFetch = u => { if (u.pathname === '/api/users/0/items' && ++reads === 2) version++; };
    await drain(['merged']); assert.equal(state('merged'), 0); assert.equal(pending(), true);
    onFetch = () => {}; presences.set('GONE0001', 'present'); await drain(); assert.equal(state('merged'), 0); assert.equal(pending(), false);
  });
  await test('a merge during an await invalidates the old list of identities', async () => {
    reset(); work('changed', 'GONE0001'); presences.set('GONE0001', 'gone');
    let added = false;
    onFetch = u => { if (u.pathname === '/api/users/0/items' && !added) { alias('changed', 'LIVE0001'); added = true; } };
    await drain(['changed']); assert.equal(state('changed'), 0); assert.equal(pending(), true);
    onFetch = () => {}; await drain(); assert.equal(state('changed'), 0); assert.equal(pending(), false); assert.ok(probes.includes('LIVE0001'));
  });
  await test('membership restored during a probe prevents archiving', async () => {
    reset(); work('returned', 'GONE0001'); presences.set('GONE0001', 'gone');
    onFetch = u => { if (u.pathname === '/api/users/0/items') membership('returned', 'MONITOR1'); };
    await drain(['returned']); assert.equal(state('returned'), 0);
    onFetch = () => {}; await drain(); assert.equal(pending(), false);
  });
  await test('an unknown result is retried automatically at the same library version', async () => {
    reset(); work('retry', 'RETRY001'); presences.set('RETRY001', 'unknown'); await pass();
    assert.equal(state('retry'), 0); assert.equal(pending(), true);
    presences.set('RETRY001', 'gone'); await tick(); assert.equal(state('retry'), 1); assert.equal(pending(), false);
  });
  await test('an unavailable unmonitored group remains active and retries when the source returns', async () => {
    reset(); work('missing-group', 'groups:42:LIVE0001'); missingGroups.add('42'); await pass();
    assert.equal(state('missing-group'), 0); assert.equal(pending(), true);
    missingGroups.clear(); presences.set('groups:42:LIVE0001', 'gone'); await tick();
    assert.equal(state('missing-group'), 1); assert.equal(pending(), false);
  });
  await test('failed collection traversal does not archive or advance the checkpoint', async () => {
    reset(); work('failed-pass', 'GONE0001', 'MONITOR1'); presences.set('GONE0001', 'gone'); failCollection = true;
    await assert.rejects(pass(), /incompleta/); assert.equal(state('failed-pass'), 0); assert.deepEqual(probes, []);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='library_versions'").get(), undefined);
  });
  await test('a revision change during collection traversal suppresses removal checks', async () => {
    reset(); work('changed-pass', 'GONE0001', 'MONITOR1'); presences.set('GONE0001', 'gone');
    let reads = 0; onFetch = u => { if (u.pathname === '/api/users/0/items' && ++reads === 2) version++; };
    await assert.rejects(pass(), /incompleta/); assert.equal(state('changed-pass'), 0); assert.deepEqual(probes, []);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_collections').get().n, 1);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='library_versions'").get(), undefined);
  });
  await test('pending checks survive a reopened database rather than only a module-level cursor', async () => {
    reset(); work('persisted', 'PERSIST1'); presences.set('PERSIST1', 'unknown'); await drain(['persisted']);
    const saved = db.serialize(); db.close(); db = new Database(saved);
    assert.equal(pending(), true); presences.set('PERSIST1', 'gone'); await drain(); assert.equal(state('persisted'), 1);
  });
  await test('incomplete persisted evidence cannot archive a present work without asking Zotero', async () => {
    reset(); work('corrupt-evidence', 'LIVE0001');
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('zotero_removal_checks', JSON.stringify([
      { nodusId: 'corrupt-evidence', identities: ['LIVE0001'], absent: ['LIVE0001'], versions: {} },
    ]));
    await drain(); assert.equal(state('corrupt-evidence'), 0); assert.deepEqual(probes, ['LIVE0001']); assert.equal(pending(), false);
  });
  await test('restored monitored membership cancels a queued check', async () => {
    reset(); work('returned', 'RETURN01'); presences.set('RETURN01', 'unknown'); await drain(['returned']);
    membership('returned', 'MONITOR1'); presences.set('RETURN01', 'gone'); requests = [];
    await drain(); assert.equal(state('returned'), 0); assert.deepEqual(requests, []); assert.equal(pending(), false);
  });
  await test('no monitored collections cancels pending probes', async () => {
    reset(); work('unmonitored', 'GONE0001'); presences.set('GONE0001', 'gone');
    await drain(['unmonitored'], { requestLimit: 0 }); assert.equal(pending(), true); settings.monitoredCollections = [];
    await drain(); assert.deepEqual(requests, []); assert.equal(pending(), false); assert.equal(state('unmonitored'), 0);
  });
  await test('aborted batches retain their candidates for a later retry', async () => {
    reset(); work('canceled', 'GONE0001'); presences.set('GONE0001', 'gone');
    await drain(['canceled'], { signal: AbortSignal.abort() }); assert.deepEqual(requests, []); assert.equal(pending(), true);
    await drain(); assert.equal(state('canceled'), 1);
  });
  await test('concurrent drains serialize the queue and archive a work once', async () => {
    reset(); work('concurrent', 'GONE0001'); presences.set('GONE0001', 'gone');
    const results = await Promise.all([drain(['concurrent']), drain(['concurrent'])]);
    assert.deepEqual(results, [1, 0]); assert.equal(state('concurrent'), 1); assert.deepEqual(probes, ['GONE0001']);
  });
  await test('a database switch during a probe cannot archive a work in another vault', async () => {
    reset(); work('shared-id', 'GONE0001'); presences.set('GONE0001', 'gone'); const originating = db;
    const other = new Database(':memory:'); runMigrations(other);
    other.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type) VALUES('shared-id','OTHER001','Other vault','[]','book')").run();
    onFetch = () => { db = other; };
    try {
      await drain(['shared-id']);
      assert.equal(originating.prepare("SELECT archived FROM works WHERE nodus_id='shared-id'").get().archived, 1);
      assert.equal(state('shared-id'), 0);
    } finally { db = originating; other.close(); }
  });
  await test('realtime polling never overlaps a previous tick', async () => {
    reset(); work('queued', 'GONE0001'); presences.set('GONE0001', 'unknown'); await pass();
    requests = []; let release; const gate = new Promise(resolve => { release = resolve; }); let held = false;
    onFetch = async () => { if (!held) { held = true; await gate; } };
    await tick(async poll => {
      const first = poll(); await poll(); assert.equal(requests.length, 1);
      release(); await first;
    });
    assert.equal(state('queued'), 0); assert.equal(pending(), true);
  });
  await test('HTTP retries are charged to the same global removal budget', async () => {
    reset(); work('throttled', 'RETRY001'); presences.set('RETRY001', 'retry');
    await drain(['throttled'], { requestLimit: 2 }); assert.equal(requests.length, 2); assert.equal(state('throttled'), 0); assert.equal(pending(), true);
  });
  await test('startup and manual sync share one pass and still notify automatic source indexing', async () => {
    reset(); activeVault.type = 'academic'; observed = [item('NEW00001')];
    const statuses = []; const off = sync.onZoteroSyncStatus(status => statuses.push(status));
    try {
      const first = pass();
      assert.equal(pass(), first, 'a second control joins the existing pass');
      assert.equal(sync.fullSync('realtime'), first, 'a polling tick cannot start a second writer');
      const result = await first;
      await new Promise(resolve => setImmediate(resolve));
      assert.match(result.summary, /1 altas/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 1);
      assert.equal(requests.filter(url => url.includes('/collections/MONITOR1/items/top')).length, 1);
      assert.deepEqual(statuses.map(status => status.running), [true, false]);
      assert.deepEqual(statuses[1].lastSync, result);
      assert.equal(corpusChanges, 1, 'catalog-only sync still discovers new sources for the existing embedding policy');
    } finally { off(); }
  });
  await test('large collection ingestion yields to UI events while metadata is only partly written', async () => {
    reset(); observed = Array.from({ length: 1200 }, (_, index) => item(`K${String(index).padStart(7, '0')}`));
    let done = false; const counts = [];
    const observe = () => { counts.push(db.prepare('SELECT COUNT(*) n FROM works').get().n); if (!done) setImmediate(observe); };
    setImmediate(observe);
    try { await pass(); } finally { done = true; }
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(counts.some(count => count > 0 && count < observed.length), `UI ran between writes: ${counts.join(',')}`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, observed.length);
  });
  await test('a vault switch cancels in-flight sync without writing its records to either vault', async () => {
    reset(); observed = [item('OLD00001')];
    const originating = db; const other = new Database(':memory:'); runMigrations(other);
    let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    onFetch = async url => { if (url.pathname.includes('/collections/MONITOR1/items/top')) { entered(); await gate; } };
    const running = pass();
    try {
      await waiting; sync.stopZoteroSync(); activeVault = { id: 'other', type: 'academic' }; db = other;
      release(); await assert.rejects(running, { name: 'AbortError' });
      assert.equal(originating.prepare('SELECT COUNT(*) n FROM works').get().n, 0);
      assert.equal(other.prepare('SELECT COUNT(*) n FROM works').get().n, 0);
      assert.equal(sync.getZoteroSyncStatus().running, false);
    } finally { release(); await running.catch(() => {}); db = originating; other.close(); }
  });
  await test('startup runs in manual mode only for an already linked academic collection', async () => {
    reset(); activeVault.type = 'academic'; settings.syncMode = 'manual'; observed = [item('START001')];
    const originalSet = globalThis.setTimeout; let startup;
    globalThis.setTimeout = (callback, delay, ...args) => delay === 5000 ? (startup = callback, { unref() {} }) : originalSet(callback, delay, ...args);
    try {
      sync.startZoteroSync(); assert.equal(requests.length, 0, 'starting the app does not run sync synchronously');
      const finished = new Promise(resolve => { const off = sync.onZoteroSyncStatus(status => { if (!status.running) { off(); resolve(); } }); });
      startup(); await finished;
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 1);
      assert.equal(settings.syncMode, 'manual', 'startup does not enable realtime polling');
      requests = []; settings.monitoredCollections = []; sync.startZoteroSync(); startup();
      await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(requests, []);
      settings.monitoredCollections = ['MONITOR1']; activeVault.type = 'study'; sync.startZoteroSync(); startup();
      await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(requests, []);
    } finally { globalThis.setTimeout = originalSet; sync.stopZoteroSync(); }
  });
  await test('unavailable Zotero leaves sync idle and a later manual retry can succeed', async () => {
    reset(); observed = [item('RETRY001')];
    const healthy = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 403 });
    try {
      await assert.rejects(pass(), /incompleta/);
      assert.equal(sync.getZoteroSyncStatus().running, false);
      assert.equal(db.prepare("SELECT value FROM settings WHERE key='library_versions'").get(), undefined);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 0);
    } finally { globalThis.fetch = healthy; }
    const result = await pass();
    assert.match(result.summary, /1 altas/);
    assert.equal(sync.getZoteroSyncStatus().running, false);
  });
  await test('deferred startup does not cancel a manual sync already requested after first paint', async () => {
    reset(); activeVault.type = 'academic'; settings.syncMode = 'manual'; observed = [item('FIRST001')];
    let entered, release, startup;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    onFetch = async url => { if (url.pathname.includes('/collections/MONITOR1/items/top')) { entered(); await gate; } };
    const originalSet = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => delay === 5000 ? (startup = callback, { unref() {} }) : originalSet(callback, delay, ...args);
    const running = pass();
    try {
      await waiting;
      sync.startZoteroSync();
      assert.equal(pass(), running, 'first-paint startup preserves the user’s in-flight sync');
      release(); await running;
      requests = []; startup(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(requests, [], 'a successful manual sync satisfies the deferred startup request');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 1);
    } finally { release(); await running.catch(() => {}); globalThis.setTimeout = originalSet; sync.stopZoteroSync(); }
  });
} finally {
  sync.stopZoteroSync();
  globalThis.fetch = originalFetch; db?.close(); fs.rmSync(scratch, { recursive: true, force: true });
}
