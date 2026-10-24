import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

function loadContentScript(relativePaths, extraGlobals = {}) {
  const sandbox = {
    window: {},
    Zotero: { logError() {} },
    ChromeUtils: { importESModule: () => ({ Zotero: { logError() {} } }) },
    console,
    ...extraGlobals,
  };
  vm.createContext(sandbox);
  for (const relativePath of [relativePaths].flat()) {
    vm.runInContext(readSource(relativePath), sandbox, { filename: relativePath });
  }
  return sandbox.window;
}

test('evidence cache compaction removes coordinate-heavy duplicate maps', () => {
  const { NodusStore: store } = loadContentScript('zotero-plugin/content/store.js');
  const index = {
    pages: [{ text: 'alpha', rawText: 'alpha', spans: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
    chunks: [{ text: 'alpha', positions: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
  };

  assert.equal(store.compactEvidenceIndex(index), true);
  assert.equal(index.pages[0].rawText, undefined);
  assert.equal(index.pages[0].spans, undefined);
  assert.equal(index.chunks[0].positions, undefined);
  assert.equal(index.pages[0].text, 'alpha');
  assert.equal(store.compactEvidenceIndex(index), false);
});

test('embedding worker terminates after idle and on sidebar unload', async () => {
  const workers = [];
  const timers = new Map();
  let nextTimer = 0;
  let unload = null;

  class FakeWorker {
    constructor() { this.listeners = {}; this.terminated = false; workers.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
    reply(result) { this.listeners.message({ data: { type: 'result', id: this.message.id, result } }); }
  }

  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'unload') unload = listener; },
  };
  const { NodusLocalEmbeddings: embeddings } = loadContentScript([
    // The bridge reads the model catalogue the sidebar loads before it.
    'zotero-plugin/content/embedding-models.js',
    'zotero-plugin/content/local-embeddings.js',
  ], {
    window: fakeWindow,
    ChromeWorker: FakeWorker,
    DOMException,
    setTimeout(listener, ms) { const id = ++nextTimer; timers.set(id, { listener, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });

  const completed = embeddings.embedPassages(['alpha']);
  workers[0].reply([[0.1, 0.2]]);
  await completed;
  const idle = [...timers.values()].find((timer) => timer.ms === 5 * 60 * 1000);
  assert.ok(idle);
  idle.listener();
  assert.equal(workers[0].terminated, true);

  const pending = embeddings.warmup();
  unload();
  await assert.rejects(pending, /local-embedding-reset/);
  assert.equal(workers[1].terminated, true);
});

test('library identity sync does not load every full index a second time', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const start = sidebar.indexOf('async function syncLibraryIdentityBeforeSend()');
  const end = sidebar.indexOf('\nfunction availableContextTokens()', start);
  const body = sidebar.slice(start, end);
  assert.ok(body.includes('NS.listEvidenceRecords'));
  assert.ok(!body.includes('buildSelectedIndexes'));
});

test('sidebar and bootstrap release long-lived resources on unload', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const bootstrap = readSource('zotero-plugin/bootstrap.js');
  assert.match(sidebar, /if \(NL && NL\.reset\) NL\.reset\(\)/);
  assert.match(sidebar, /NS\.closeEvidenceDb\(\)/);
  assert.match(sidebar, /clearTimeout\(refreshTimer\)/);
  assert.match(bootstrap, /_popupMods = null/);
});

function loadDatabaseManager(Zotero) {
  const sandbox = {
    ChromeUtils: { importESModule: () => ({ Zotero }) },
  };
  const source = readSource('zotero-plugin/content/evidence-db.sys.mjs')
    .replace('export const EvidenceDatabases =', 'globalThis.EvidenceDatabases =');
  vm.runInNewContext(source, sandbox);
  return sandbox.EvidenceDatabases;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('shutdown closes orphaned sidebar connections and awaits an in-flight close', async () => {
  const gate = deferred();
  const closed = [];
  const manager = loadDatabaseManager({
    DBConnection: class {
      constructor(path) { this.path = path; }
      async closeDatabase(permanent) {
        assert.equal(permanent, true);
        closed.push(this.path);
        await gate.promise;
      }
    },
    logError(error) { throw error; },
  });
  // No window references or unload events: the module must own both connections.
  const first = manager.open('sidebar.sqlite');
  manager.open('popup.sqlite');
  const earlyClose = manager.close(first);
  assert.equal(manager.close(first), earlyClose, 'concurrent cleanup shares one close');
  let finished = false;
  const shutdown = manager.shutdown().then(() => { finished = true; });
  await new Promise(setImmediate);
  assert.deepEqual(closed.sort(), ['popup.sqlite', 'sidebar.sqlite']);
  assert.equal(finished, false, 'shutdown waits for SQLite');
  assert.throws(() => manager.open('late.sqlite'), /evidence-db-closed/);
  gate.resolve();
  await shutdown;
  await manager.shutdown();
  assert.equal(closed.length, 2, 'already closed connections are not closed again');
  manager.start();
  manager.open('reenabled.sqlite');
  await manager.shutdown();
  assert.equal(closed.length, 3);
});

test('shutdown retries failed early cleanup and still closes other connections', async () => {
  const attempts = new Map();
  const errors = [];
  const manager = loadDatabaseManager({
    DBConnection: class {
      constructor(path) { this.path = path; }
      async closeDatabase() {
        const count = (attempts.get(this.path) || 0) + 1;
        attempts.set(this.path, count);
        if (this.path === 'failed.sqlite' || (this.path === 'retry.sqlite' && count === 1)) throw new Error(this.path);
      }
    },
    logError(error) { errors.push(error.message); },
  });
  await assert.rejects(manager.close(manager.open('retry.sqlite')), /retry.sqlite/);
  manager.open('failed.sqlite');
  manager.open('other.sqlite');
  await manager.shutdown();
  assert.equal(attempts.get('retry.sqlite'), 2);
  assert.equal(attempts.get('other.sqlite'), 1);
  assert.deepEqual(errors, ['failed.sqlite']);
});

test('bootstrap awaits database shutdown even after all windows have disappeared', async () => {
  const gate = deferred();
  let chromeDestroyed = false;
  const sandbox = {
    Zotero: { getMainWindows: () => [] },
  };
  vm.createContext(sandbox);
  vm.runInContext(readSource('zotero-plugin/bootstrap.js'), sandbox);
  sandbox.Nodus.databases = { shutdown: () => gate.promise };
  sandbox.chromeHandle = { destruct() { chromeDestroyed = true; } };
  const shutdown = sandbox.shutdown();
  assert.equal(chromeDestroyed, false);
  gate.resolve();
  await shutdown;
  assert.equal(chromeDestroyed, true);
});

test('closing a store while its directory is being prepared cannot open a late connection', async () => {
  const gate = deferred();
  let opened = 0;
  const { NodusStore: store } = loadContentScript('zotero-plugin/content/store.js', {
    ChromeUtils: { importESModule: (uri) => uri.includes('evidence-db')
      ? { EvidenceDatabases: { open() { opened++; } } }
      : { Zotero: { logError() {} } } },
    Services: { dirsvc: { get: () => ({ path: '/test-profile' }) } },
    Components: { interfaces: { nsIFile: {} } },
    PathUtils: { join: path.join },
    IOUtils: { makeDirectory: () => gate.promise },
  });
  const pending = store.evidenceCacheStats();
  await store.closeEvidenceDb();
  gate.resolve();
  await pending;
  assert.equal(opened, 0);
});
