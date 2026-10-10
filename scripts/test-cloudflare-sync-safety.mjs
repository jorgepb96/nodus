// Offline fault injection: no Cloudflare account, credentials or network access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { postMutations, getMutations } from '../cloudflare/src/sync.mjs';
import { postLibraryRecords } from '../cloudflare/src/librarySync.mjs';
import { MAX_MUTATION_BATCH } from '../cloudflare/src/util.mjs';
import { createPublication } from '../cloudflare/src/publications.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const safety = require('../electron/serverSync/cloudflareSyncSafety.ts');
const protocol = require('../electron/serverSync/cloudflarePublicationProtocol.ts');

test('a day of two-second timer ticks makes at most one Cloudflare pass per minute', () => {
  const gate = new safety.CloudflareSyncGate();
  let calls = 0;
  for (let now = 0; now < 86400_000; now += 2_000) {
    if (!gate.begin(false, now)) continue;
    calls += 1;
    assert.equal(gate.begin(true, now), false, 'even a manual call cannot overlap');
    gate.finish(false, undefined, now);
  }
  assert.equal(calls, 1440);
});

test('five failures stop all further automatic requests; manual recovery resets the breaker', () => {
  const gate = new safety.CloudflareSyncGate();
  let calls = 0;
  for (let now = 0; now < 30 * 86400_000; now += 2_000) {
    if (!gate.begin(false, now)) continue;
    calls += 1;
    gate.finish(true, 503, now);
  }
  assert.equal(calls, 5);
  assert.equal(gate.paused, true);
  assert.equal(gate.begin(true, 30 * 86400_000), true);
  gate.finish(false);
  assert.equal(gate.paused, false);
});

test('revoked credentials stop immediately and timer restarts reuse the same breaker', () => {
  for (const status of [401, 403]) {
    const gate = safety.cloudflareSyncGate(`test-${status}`, 'https://offline.example/', 'fake-token');
    assert.equal(gate.begin(false, 0), true);
    gate.finish(true, status, 0);
    assert.equal(safety.cloudflareSyncGate(`test-${status}`, 'https://offline.example', 'fake-token').ready(86400_000), false);
    assert.equal(safety.cloudflareSyncGate(`test-${status}`, 'https://offline.example', 'replacement-token').ready(0), true);
  }
});

test('budget exhaustion stops immediately and persistent checkpoints survive an app restart', () => {
  const stored = new Map();
  const adapter = { read: key=>stored.get(key), write: (key,state)=>stored.set(key,{...state}) };
  safety.configureCloudflareGatePersistence(adapter);
  const gate=safety.cloudflareSyncGate('budget','https://offline.example','credential');
  assert.equal(gate.begin(false,0),true);gate.finish(true,429,0);
  safety.configureCloudflareGatePersistence(adapter);
  assert.equal(safety.cloudflareSyncGate('budget','https://offline.example','credential').begin(false,86400000),false);
  assert.equal(safety.cloudflareSyncGate('budget','https://offline.example','credential').begin(true,86400000),true);
});

test('stalled, backwards, nonfinite and malformed cursors never permit another page', () => {
  for (const value of [0, 2, NaN, Infinity, -1, undefined, '3', 2.5]) {
    assert.throws(() => safety.advancingCloudflareCursor(2, value, true));
  }
  assert.equal(safety.advancingCloudflareCursor(2, 3, true), 3);
  assert.equal(safety.advancingCloudflareCursor(2, 2, false), 2);
});

test('table chunks obey both row and byte ceilings, including multibyte text and JSON envelopes', () => {
  const rows = Array.from({ length: 37 }, (_, id) => ({ key: `[${id}]`, row: { id, text: 'ñ'.repeat(230_000) } }));
  const chunks = [...protocol.cloudflareTableChunks(rows)];
  assert.deepEqual(chunks.flat(), rows);
  assert.ok(chunks.every((chunk) => chunk.length <= 15 && Buffer.byteLength(JSON.stringify({ rows: chunk })) <= 1024 * 1024));
  assert.equal([...protocol.cloudflareTableChunks(Array.from({ length: 31 }, (_, id) => ({ id })))].length, 3);
  assert.throws(() => [...protocol.cloudflareTableChunks([{ text: 'x'.repeat(1024 * 1024) }])]);
});

test('zero, negative and unbounded multipart sizes cannot create a nonadvancing upload loop', () => {
  for (const value of [0, -1, NaN, Infinity, 1, '8388608', 8 * 1024 * 1024 + 1]) {
    assert.throws(() => protocol.validateCloudflarePartBytes(value));
  }
  assert.equal(protocol.validateCloudflarePartBytes(8 * 1024 * 1024), 8 * 1024 * 1024);
});

function boundedD1(overrides = {}) {
  let queries = 2; // Device authentication and last_seen_at write.
  return {
    get queries() { return queries; },
    async batch(statements) { return Promise.all(statements.map(statement=>statement.run())); },
    prepare(sql) {
      return { bind(...bindings) {
        assert.ok(bindings.length <= 100, `D1 parameter ceiling: ${bindings.length}`);
        const invoke = async (kind) => {
          assert.ok(++queries <= 50, `D1 invocation ceiling: ${queries}`);
          if (overrides.query) return overrides.query(sql, bindings, kind);
          if (kind === 'all') {
            if (sql.includes('FROM private_mutation_ownership')) return { results: [{ user_id: 'user' }] };
            return { results: [] };
          }
          if (kind === 'first') {
            if (sql.includes('active_generation')) return { active_generation: 1 };
            if (sql.includes('COUNT(*)')) return { count: 0 };
            return { bytes: 0, value: 4, cursor: 12 };
          }
          return { meta: { changes: 1 } };
        };
        return { all: () => invoke('all'), first: () => invoke('first'), run: () => invoke('run') };
      } };
    },
  };
}

test('private mutation batches stay within D1 Free query and parameter limits', async () => {
  for (const table of ['notes', 'pages', 'page_links', 'page_comments', 'page_comment_reactions']) {
    const DB = boundedD1();
    const mutations = Array.from({ length: MAX_MUTATION_BATCH }, (_, id) => ({
      id: `m-${id}`, table, kind: 'upsert', key: table === 'page_comment_reactions' ? [`c-${id}`, 'user', 'like'] : [`n-${id}`],
      row: { id: `n-${id}`, from_page_id: `from-${id}`, to_page_id: `to-${id}`, page_id: `p-${id}`, comment_id: `c-${id}` },
    }));
    const result = await postMutations({ DB }, { space_id: 'space', user_id: 'user' }, new Request('https://offline.example/mutations', {
      method: 'POST', body: JSON.stringify({ mutations }),
    }));
    assert.equal(result.accepted.length, MAX_MUTATION_BATCH, `${table}: ${JSON.stringify(result.rejected)}`);
    assert.ok(DB.queries <= 50);
  }
});

test('the pending ledger limit counts R2 bodies and refuses new writes before storing bytes', async () => {
  let puts = 0;
  const DB = boundedD1({ query(sql, bindings, kind) {
    if (kind === 'all') return { results: [] };
    if (kind === 'first' && sql.includes('SUM(')) {
      assert.match(sql, /body_object_key IS NOT NULL/);
      assert.match(sql, /LENGTH\(CAST\(body_json AS BLOB\)\)/);
      assert.equal(bindings[1], 256 * 1024);
      return { bytes: 50 * 1024 * 1024 };
    }
    if (kind === 'first' && sql.includes('active_generation')) return { active_generation: 1 };
    return { count: 0, meta: { changes: 1 } };
  } });
  await assert.rejects(postMutations({ DB, OBJECTS: { async put() { puts += 1; } } }, { space_id: 'space', user_id: 'user' },
    new Request('https://offline.example/mutations', { method: 'POST', body: JSON.stringify({ mutations: [{
      id: 'overflow', table: 'notes', key: ['large'], kind: 'upsert', row: { id: 'large', content: 'x'.repeat(120_000) },
    }] }) })), { status: 507, code: 'ledger_full' });
  assert.equal(puts, 0);
});

test('retrying an accepted large mutation performs no R2 write even when the ledger is full', async () => {
  let puts = 0;
  const DB = boundedD1({ query(sql, _bindings, kind) {
    if (kind === 'all') return { results: sql.includes('SELECT id FROM mutations') ? [{ id: 'accepted-overflow' }] : [] };
    if (kind === 'first' && sql.includes('SUM(')) return { bytes: 50 * 1024 * 1024 };
    if (kind === 'first' && sql.includes('active_generation')) return { active_generation: 1 };
    return { count: 0, meta: { changes: 0 } };
  } });
  const result = await postMutations({ DB, OBJECTS: { async put() { puts += 1; } } }, { space_id: 'space', user_id: 'user' },
    new Request('https://offline.example/mutations', { method: 'POST', body: JSON.stringify({ mutations: [{
      id: 'accepted-overflow', table: 'notes', key: ['large'], kind: 'upsert', row: { id: 'large', content: 'x'.repeat(120_000) },
    }] }) }));
  assert.deepEqual(result.duplicate, ['accepted-overflow']);
  assert.equal(puts, 0);
});

test('twelve Library versions stay below the Free query limit and duplicates in a batch are idempotent', async () => {
  const DB = boundedD1();
  const records = Array.from({ length: 12 }, (_, id) => ({ recordId: `record-${id}`, versionId: `version-${id}`, hlc: '1800000000000-000000-device', payload: { id } }));
  const result = await postLibraryRecords({ DB }, { user_id: 'user', device_id: 'device' }, new Request('https://offline.example/library', {
    method: 'POST', body: JSON.stringify({ records: [...records.slice(0, 11), records[0]] }),
  }));
  assert.equal(result.accepted.length, 11);
  assert.deepEqual(result.duplicate, ['version-0']);
  assert.ok(DB.queries <= 50);
});

test('confirmed mutations disappear from the owner inbox and do not trigger another apply/ack cycle', async () => {
  const DB = boundedD1({ query(sql, bindings, kind) {
    if (kind === 'all') {
      assert.match(sql, /acknowledged_at IS NULL/);
      assert.equal(bindings[1], 17);
      return { results: [] };
    }
    return { schema_version: 1 };
  } });
  const result = await getMutations({ DB }, { space_id: 'space', user_id: 'user' }, new Request('https://offline.example/mutations?since=17'));
  assert.deepEqual(result.mutations, []);
  assert.equal(result.cursor, 17);
  assert.equal(result.hasMore, false);
});

test('reopening an expired publication renews its real stored deadline without creating a new generation', async () => {
  let renewed = null;
  const DB = boundedD1({ query(sql, bindings, kind) {
    if (kind === 'first' && sql.includes('SELECT id, generation, status')) return {
      id: 'existing-publication', generation: 7, status: 'staging', expires_at: '2000-01-01T00:00:00.000Z',
    };
    assert.match(sql, /UPDATE publications SET expires_at/);
    renewed = bindings[0];
    assert.equal(bindings[1], 'existing-publication');
    return { meta: { changes: 1 } };
  } });
  const result = await createPublication({ DB }, { space_id: 'space' }, new Request('https://offline.example/publications', {
    method: 'POST', body: JSON.stringify({ protocolVersion: 3, revision: 'unchanged-revision-0000', counts: { notes: 1 } }),
  }));
  assert.equal(result.generation, 7);
  assert.equal(result.expiresAt, renewed);
  assert.ok(Date.parse(renewed) > Date.now());
});

let snapshotRows = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename === path.join(root, 'electron/serverSync/cloudflarePublisher.ts')) {
    if (request === './serverSnapshot') return { buildServerSnapshot: () => ({
      buffer: Buffer.from(JSON.stringify({ vault: { id: 'vault' }, capabilities: {}, assets: [], tables: { notes: snapshotRows } })),
      revision: 'offline-revision-0000000000', schemaVersion: 1, counts: { notes: snapshotRows.length }, assets: [],
    }) };
    if (request === './serverVectors') return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { publishVaultToCloudflare } = require('../electron/serverSync/cloudflarePublisher.ts');
Module._load = originalLoad;

test('the actual publisher stops at its request budget even when every mocked response succeeds', async () => {
  snapshotRows = Array.from({ length: 15 * protocol.CLOUDFLARE_MAX_PUBLICATION_REQUESTS }, (_, id) => ({ id }));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, 'offline.example');
    assert.equal(init.redirect, 'error');
    requests += 1;
    return Response.json(String(url).endsWith('/capabilities') ? { storage: {}, features: { syncBudget: true, durableObjectCleanup: true, binarySync: true, mutationRelay: true } } : { id: 'publication' });
  };
  try {
    await assert.rejects(publishVaultToCloudflare({ url: 'https://offline.example', spaceId: 'space', includeVectors: false },
      'fake-token', { id: 'vault' }, { pragma: () => [{ name: 'id', pk: 1 }] }, null), /límite de seguridad/);
    assert.equal(requests, protocol.CLOUDFLARE_MAX_PUBLICATION_REQUESTS);
  } finally { globalThis.fetch = originalFetch; snapshotRows = []; }
});

test('old or malformed Cloudflare deployments stop before any publication writes', async () => {
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async(url)=>{requests++;assert.ok(String(url).endsWith('/capabilities'));return Response.json({storage:{},features:{syncBudget:'true'}});};
  const db={pragma:()=>[],prepare:()=>({all:()=>[],get:()=>undefined})};
  try {
    await assert.rejects(()=>publishVaultToCloudflare({url:'https://offline.example',spaceId:'space'},'fake-token',{id:'vault',name:'Offline',type:'academic'},db,null),error=>error.status===426);
    assert.equal(requests,1);
  } finally {globalThis.fetch=originalFetch;}
});

test('the shared client gives a hanging connection a deadline and makes no implicit retry', async () => {
  const { NodusCloudClient } = require('../shared/cloudflareClient.ts');
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let requests = 0;
  AbortSignal.timeout = () => originalTimeout(10);
  globalThis.fetch = async (_url, { signal }) => {
    requests += 1;
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(NodusCloudClient.capabilities('https://offline.example'), { name: 'TimeoutError' });
    assert.equal(requests, 1);
  } finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; globalThis.fetch = originalFetch; }
});

test('the publisher aborts a malformed multipart session before sending any part', async () => {
  snapshotRows = [{ id: 'large-row', content: 'x'.repeat(9 * 1024 * 1024) }];
  const originalFetch = globalThis.fetch;
  let parts = 0;
  let aborts = 0;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.hostname, 'offline.example');
    if (target.pathname.endsWith('/capabilities')) return Response.json({ storage: {}, features: { syncBudget: true, durableObjectCleanup: true, binarySync: true, mutationRelay: true } });
    if (target.pathname.endsWith('/negotiate')) return Response.json({ missing: JSON.parse(init.body).objects.map((object) => object.hash) });
    if (target.pathname.endsWith('/uploads')) return Response.json({ id: 'upload', partBytes: 0 });
    if (target.pathname.includes('/parts/')) parts += 1;
    if (target.pathname.endsWith('/abort')) aborts += 1;
    return Response.json({ id: 'publication' });
  };
  try {
    await assert.rejects(publishVaultToCloudflare({ url: 'https://offline.example', spaceId: 'space', includeVectors: false },
      'fake-token', { id: 'vault' }, { pragma: () => [{ name: 'id', pk: 1 }] }, null), /tamaño de parte no válido/);
    assert.equal(parts, 0);
    assert.equal(aborts, 1);
  } finally { globalThis.fetch = originalFetch; snapshotRows = []; }
});
