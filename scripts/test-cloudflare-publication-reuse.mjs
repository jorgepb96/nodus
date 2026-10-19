import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { createPublication } from '../cloudflare/src/publications.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--cloudflare-publication-reuse-test')) process.exit(0);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function environment() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, generation INTEGER NOT NULL,
    revision TEXT NOT NULL, status TEXT NOT NULL, manifest_json TEXT NOT NULL,
    expires_at TEXT, created_by_device TEXT, created_at TEXT,
    UNIQUE(space_id, generation), UNIQUE(space_id, revision)
  )`);
  let failBatch = false;
  const DB = {
    prepare(sql) {
      let bindings = [];
      const compiled = db.prepare(sql.replace(/\?(\d+)/g, '@p$1'));
      const parameters = () => Object.fromEntries(bindings.map((value, index) => [`p${index + 1}`, value]));
      const statement = {
        bind(...values) { bindings = values; return statement; },
        async first() { return compiled.get(parameters()) ?? null; },
        async run() { return { meta: compiled.run(parameters()) }; },
        execute() { return compiled.run(parameters()); },
      };
      return statement;
    },
    async batch(statements) {
      return db.transaction(() => statements.map((statement, index) => {
        if (failBatch && index === 1) throw new Error('injected storage failure');
        return statement.execute();
      }))();
    },
  };
  return { db, env: { DB }, failBatch(value) { failBatch = value; } };
}

const revisionA = 'a'.repeat(64), revisionB = 'b'.repeat(64);
function create(env, revision) {
  return createPublication(env, { space_id: 'vault', device_id: 'device' }, new Request('https://offline.example/publications', {
    method: 'POST', body: JSON.stringify({ protocolVersion: 3, revision, counts: {}, embeddingIndex: null, vectors: [] }),
  }));
}

test('Cloudflare stages A → B → A in a fresh generation and keeps the current publication intact', async () => {
  const { db, env } = environment();
  try {
    const a = await create(env, revisionA);
    db.prepare("UPDATE publications SET status='active' WHERE id=?").run(a.id);
    const b = await create(env, revisionB);
    db.prepare("UPDATE publications SET status='superseded' WHERE id=?").run(a.id);
    db.prepare("UPDATE publications SET status='active' WHERE id=?").run(b.id);
    const restored = await create(env, revisionA);
    assert.equal(restored.generation, 3);
    assert.notEqual(restored.id, a.id, 'collected generations must never be reopened');
    assert.equal(restored.committed, false);
    assert.deepEqual(db.prepare("SELECT id FROM publications WHERE status='active'").all(), [{ id: b.id }]);
    const original = db.prepare('SELECT * FROM publications WHERE id=?').get(a.id);
    assert.equal(original.status, 'superseded');
    assert.equal(JSON.parse(original.manifest_json).revision, revisionA, 'the original manifest retains its provenance');
    assert.equal((await create(env, revisionA)).id, restored.id, 'an upload retry reuses the new staging session');
    db.prepare("UPDATE publications SET status='failed' WHERE id=?").run(restored.id);
    assert.equal((await create(env, revisionA)).generation, 4, 'failed sessions can be replaced as well');
    assert.equal(db.prepare("SELECT id FROM publications WHERE status='active'").get().id, b.id);
  } finally { db.close(); }
});

test('a failed replacement rolls back revision archival and preserves the active bundle', async () => {
  const { db, env, failBatch } = environment();
  try {
    const a = await create(env, revisionA);
    db.prepare("UPDATE publications SET status='superseded' WHERE id=?").run(a.id);
    const b = await create(env, revisionB);
    db.prepare("UPDATE publications SET status='active' WHERE id=?").run(b.id);
    failBatch(true);
    await assert.rejects(() => create(env, revisionA), /injected storage failure/);
    assert.equal(db.prepare('SELECT revision FROM publications WHERE id=?').get(a.id).revision, revisionA);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM publications').get().n, 2);
    assert.equal(db.prepare("SELECT id FROM publications WHERE status='active'").get().id, b.id);
    failBatch(false);
    assert.equal((await create(env, revisionA)).generation, 3);
  } finally { db.close(); }
});
