// The whole round trip, with nothing faked.
//
// A real Nodus Server process, a real SQLite corpus, the real buildServerSnapshot(), the
// real vault registry, the real outbox triggers, the real merge and the real inbox. This is
// the acceptance criterion for connected vaults: everything else in the suite pins one
// layer, and this one asserts the layers actually fit together.
//
//   owner publishes → reader replicates → writer replicates and writes →
//   owner collects and applies → owner republishes → reader sees it
//
// It also pins the two refusals that matter most:
//   • a reader's replica has NO outbox triggers, so nothing can be queued even if every
//     other guard failed;
//   • a reader posting to /mutations directly is refused, and nothing changes anywhere.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { replicaUtilityHarness } from './lib/replicaUtilityHarness.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-connected-vault-replica.mjs'), '--electron-replica-test')) {
  process.exit(0);
}

const externalQaProfile = Boolean(process.env.NODUS_USERDATA);
let userData;
if (externalQaProfile) {
  const qaRoot = path.resolve(String(process.env.NODUS_QA_ROOT || process.env.NODUS_ISOLATED_ROOT || ''));
  const requested = path.resolve(process.env.NODUS_USERDATA);
  if (!qaRoot || (requested !== qaRoot && !requested.startsWith(`${qaRoot}${path.sep}`))) {
    throw new Error('NODUS_USERDATA for the replica suite must remain under NODUS_QA_ROOT.');
  }
  userData = path.join(requested, 'replica-test-profiles');
  await mkdir(userData, { recursive: true });
} else {
  userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-replica-userdata-'));
}
const replicaHarness = await replicaUtilityHarness(userData);
process.env.NODUS_SERVER_REPLICA_WORKER_FILE = replicaHarness.worker;
installRuntimeHooks(userData, { utilityProcess: replicaHarness.utilityProcess });
process.on('exit', () => replicaHarness.cleanup());

const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const databaseRuntime = require(path.join(repoRoot, 'electron/db/database.ts'));
const pagesRepo = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
const databasesRepo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
const { Y } = require(path.join(repoRoot, 'shared/pageYjs.ts'));
const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));
const { applyIncomingMutations } = require(path.join(repoRoot, 'electron/serverSync/mutationInbox.ts'));
const { outboxTriggersInstalled, countOutbox } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));
const { listVaults } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const { identityColumns } = require(path.join(repoRoot, 'electron/db/rowIdentity.ts'));
const { MUTABLE_TABLES: SERVER_MUTABLE } = await import('../server/lib/core/mutations.mjs');
const Database = require('better-sqlite3');

function seedOwnerCorpus(db) {
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO works (nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
       read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status, summary_status, archived, notes)
     VALUES (?, ?, 1, ?, ?, ?, 'book', NULL, 1, 1, 'both', 'pdf', 'done', 'done', 'done', 0, NULL)`
  ).run('w-1', 'K1', 'Memoria y archivo', JSON.stringify(['Alba, Rosa']), 1998);
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('i-1', 'claim', 'Tesis del archivo', 'El archivo determina la memoria.', now);
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)')
    .run('i-1', 'w-1', 'principal', 'Desarrollo.', 0.9);
  db.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
    .run('n-owner', 'Nota del propietario', 'markdown', 'Escrita en el vault principal.', now, now);
}

function publishSnapshot(origin, token, spaceId, dbFile, vault) {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const built = buildServerSnapshot(vault, { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true }, db);
    return { built, gzipped: require('node:zlib').gzipSync(built.buffer) };
  } finally {
    db.close();
  }
}

test('a corpus travels to two replicas, a writer sends work back, and a reader never can', { timeout: 180_000 }, async () => {
  await withServer({ label: 'replica-roundtrip', ai: true }, async (server) => {
    // ── The owner ────────────────────────────────────────────────────────────
    const spaceId = await server.createSpace('Corpus compartido');
    await server.setPublicationPolicy(spaceId, ['allowUserContent']);
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Owner desktop');
    assert.equal(owner.role, 'owner');

    const ownerFile = path.join(userData, 'owner.sqlite');
    const ownerDb = new Database(ownerFile);
    runMigrations(ownerDb);
    ownerDb.transaction(seedOwnerCorpus)(ownerDb);
    ownerDb.close();

    const ownerVault = { id: 'owner-vault', name: 'Corpus', type: 'academic' };
    const first = publishSnapshot(server.origin, owner.deviceToken, spaceId, ownerFile, ownerVault);
    const published = await fetch(`${server.origin}/api/v1/spaces/${spaceId}/snapshot`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${owner.deviceToken}`,
        'content-encoding': 'gzip',
        'x-nodus-revision': first.built.revision,
      },
      body: first.gzipped,
    });
    assert.equal(published.status, 200, await published.text());

    // ── The reader replicates ────────────────────────────────────────────────
    await server.createUser('lector@example.test', 'lector-account-password', [{ spaceId, role: 'reader' }]);
    const readerSignIn = await replica.signInToNodusServer(server.origin, 'lector@example.test', 'lector-account-password');
    assert.equal(readerSignIn.spaces.length, 1);
    assert.equal(readerSignIn.spaces[0].role, 'reader');

    const readerVault = await replica.createConnectedVault({
      url: readerSignIn.url,
      ticket: readerSignIn.ticket,
      space: readerSignIn.spaces[0],
      userEmail: readerSignIn.userEmail,
      serverName: readerSignIn.serverName,
    });
    assert.equal(readerVault.origin, 'connected');
    assert.equal(readerVault.remote.role, 'reader');
    assert.equal(readerVault.type, 'academic', 'the vault type comes from the publication, not from a picker');
    const readerProfileDevice = await server.deviceToken('lector@example.test', 'lector-account-password', spaceId, 'Reader profile probe');
    const inheritedProfileResponse = await server.api(readerProfileDevice.deviceToken, 'GET', '/api/v2/me/preferences');
    assert.equal(inheritedProfileResponse.status, 200, 'Connected Vault uploads the authenticated Desktop profile');
    const inheritedProfile = await inheritedProfileResponse.json();
    assert.equal(inheritedProfile.profile.revision, 1);
    assert.deepEqual(inheritedProfile.profile.source, { kind: 'desktop' });
    const inheritedText = JSON.stringify(inheritedProfile);
    for (const forbidden of ['providerKeys', 'lockedProviderKeys', 'embeddingProvider', 'embeddingModel', 'mcpToken', 'autoBackupFolder']) {
      assert.equal(inheritedText.includes(forbidden), false, `${forbidden} must not cross the Connected Vault profile boundary`);
    }

    const readerDb = new Database(readerVault.path, { fileMustExist: true });
    assert.equal(readerDb.prepare('SELECT COUNT(*) AS n FROM works').get().n, 1);
    assert.equal(readerDb.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 1);
    assert.equal(readerDb.prepare("SELECT title FROM notes WHERE id = 'n-owner'").get(), undefined, 'the owner note remains private');
    const readerDevice = readerDb.prepare('SELECT id FROM workspace_devices').get().id;
    assert.match(readerDevice, /^device-[0-9a-f-]{36}$/);
    assert.notEqual(readerDevice, 'local-device');
    // The gate that holds even if everything above it is wrong.
    assert.equal(outboxTriggersInstalled(readerDb), false, "a reader's database has nothing that can queue a mutation");

    // A reader writing locally therefore queues nothing at all.
    readerDb.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
      .run('n-reader', 'Nota privada del lector', 'markdown', 'Solo en mi equipo.', '2026-02-02T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
    assert.equal(countOutbox(readerDb).pending, 0, "a reader's own work never enters the queue");

    // ── The writer replicates and writes ─────────────────────────────────────
    await server.createUser('escritor@example.test', 'escritor-account-password', [{ spaceId, role: 'writer' }]);
    const writerSignIn = await replica.signInToNodusServer(server.origin, 'escritor@example.test', 'escritor-account-password');
    const writerVault = await replica.createConnectedVault({
      url: writerSignIn.url,
      ticket: writerSignIn.ticket,
      space: writerSignIn.spaces[0],
      userEmail: writerSignIn.userEmail,
      serverName: writerSignIn.serverName,
    });
    assert.equal(writerVault.remote.role, 'writer');

    const writerDb = new Database(writerVault.path, { fileMustExist: true });
    const writerDevice = writerDb.prepare('SELECT id FROM workspace_devices').get().id;
    assert.match(writerDevice, /^device-[0-9a-f-]{36}$/);
    assert.notEqual(writerDevice, readerDevice, 'each replica has a stable independent device identity');
    assert.equal(outboxTriggersInstalled(writerDb), true, 'a writer CAN queue');
    assert.equal(countOutbox(writerDb).pending, 0, 'hydration itself must not queue the corpus it just received');

    const writerStamp = '2026-03-03T10:00:00.000Z';
    writerDb.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
      .run('n-writer', 'Aportación del colaborador', 'markdown', 'Escrita en la réplica.', writerStamp, writerStamp);

    const queued = writerDb.prepare("SELECT * FROM server_outbox WHERE state = 'pending'").all();
    assert.equal(queued.length, 2, 'the legacy note and its universal page both travel');
    const queuedNote = queued.find((entry) => entry.table_name === 'notes');
    const queuedPage = queued.find((entry) => entry.table_name === 'pages');
    assert.equal(queuedNote.op, 'upsert');
    assert.equal(queuedNote.device_id, writerDevice);
    assert.match(queuedNote.hlc, new RegExp(`${writerDevice}$`));
    assert.equal(queuedNote.row_key, '["n-writer"]', 'the key matches what the tombstone triggers write');
    assert.equal(queuedPage.row_key, '["note:n-writer"]', 'the universal page has deterministic identity');

    // Editing the same row again folds into the entry already queued.
    writerDb.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
      .run('Corregida antes de enviarse.', '2026-03-03T11:00:00.000Z', 'n-writer');
    assert.equal(countOutbox(writerDb).pending, 2, 'a second edit updates the pending note entry rather than adding another');
    writerDb.close();

    await replica.drainOutbox(writerVault.id);
    const drainedDb = new Database(writerVault.path, { fileMustExist: true });
    assert.equal(countOutbox(drainedDb).pending, 0, 'the queue empties once the server accepts it');
    drainedDb.close();

    // Private rows use the reliable ledger, but only another device of the same
    // account may observe them. The note-backed compatibility page shares that scope.
    const writerProbe = await server.deviceToken('escritor@example.test', 'escritor-account-password', spaceId, 'Writer privacy probe');
    const writerLedger = await (await server.api(writerProbe.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.equal(writerLedger.mutations.length, 2);
    assert.equal(writerLedger.mutations.find((mutation) => mutation.table === 'notes').row.content, 'Corregida antes de enviarse.');
    assert.equal(writerLedger.mutations.find((mutation) => mutation.table === 'pages').row.note_id, 'n-writer');
    const ownerLedger = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.equal(ownerLedger.mutations.length, 0, 'the owner cannot observe another user private note or its compatibility page');
    const ownerInspect = new Database(ownerFile, { fileMustExist: true });
    assert.equal(ownerInspect.prepare("SELECT 1 FROM notes WHERE id = 'n-writer'").get(), undefined);
    ownerInspect.close();

    await replica.pullReplica(readerVault.id);
    const readerAfter = new Database(readerVault.path, { fileMustExist: true });
    assert.equal(readerAfter.prepare("SELECT 1 FROM notes WHERE id = 'n-writer'").get(), undefined, "another reader never sees the collaborator's private note");
    // The reader's OWN note survives every corpus pull.
    assert.equal(readerAfter.prepare("SELECT title FROM notes WHERE id = 'n-reader'").get().title, 'Nota privada del lector');
    assert.equal(readerAfter.prepare('SELECT COUNT(*) AS n FROM works').get().n, 1);
    readerAfter.close();
    readerDb.close();

    // ── The refusals ─────────────────────────────────────────────────────────
    const readerToken = await server.deviceToken('lector@example.test', 'lector-account-password', spaceId, 'Reader probe');
    const forced = await server.api(readerToken.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [{ id: 'forced-1', kind: 'upsert', table: 'notes', key: ['n-forced'], row: { id: 'n-forced', title: 'No', kind: 'markdown', content: 'x', order_idx: 0, folder_id: null, source_json: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z' }, schemaVersion: 122, createdAt: '2026-04-01T00:00:00.000Z' }] },
    });
    assert.equal(forced.status, 403, 'the server refuses a reader even when the client is bypassed entirely');
    assert.equal((await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json()).mutations.length, 0, 'and nothing was stored');

    // The registry knows both replicas, and the overview reports them honestly.
    const registered = listVaults().filter((vault) => vault.origin === 'connected');
    assert.equal(registered.length, 2);
    const overview = replica.getReplicaOverview();
    assert.deepEqual(overview.map((entry) => entry.role).sort(), ['reader', 'writer']);
    for (const entry of overview) assert.equal(entry.state, 'active');
  });
});

test('an incoming mutation never blanks a column it does not carry', { timeout: 60_000 }, async () => {
  // Found against a real corpus, not in theory. A publication carries no binary, so a
  // mutation that legitimately updates a row arrives without the blob columns — and an
  // INSERT OR REPLACE then wiped them. In practice a collaborator touching a Deep Research
  // report destroyed the owner's only copy of its illustration.
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-inbox-blob-'));
  try {
    const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
    const Database = require('better-sqlite3');
    const file = path.join(root, 'owner.sqlite');
    const db = new Database(file);
    runMigrations(db);
    const image = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    db.prepare(
      `INSERT INTO decorative_images (entity_kind, entity_id, requested, status, style, mime_type, image_blob, created_at, updated_at)
       VALUES ('deep_research', 'dr-1', 1, 'ready', 'antique_book', 'image/png', ?, ?, ?)`
    ).run(image, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    // The row as a replica would send it: every scalar column, and no binary at all.
    const summary = applyIncomingMutations(db, [{
      id: 'mut-blob', seq: 1, kind: 'upsert', table: 'decorative_images',
      key: ['deep_research', 'dr-1'],
      row: { entity_kind: 'deep_research', entity_id: 'dr-1', requested: 1, status: 'ready', style: 'antique_book', mime_type: 'image/png', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z' },
      schemaVersion: 122, createdAt: '2026-02-02T00:00:00.000Z',
    }]);
    assert.equal(summary.applied, 1);
    const after = db.prepare("SELECT * FROM decorative_images WHERE entity_id = 'dr-1'").get();
    assert.ok(Buffer.isBuffer(after.image_blob), 'the illustration was destroyed by an update that never mentioned it');
    assert.ok(after.image_blob.equals(image), 'the illustration was altered');
    assert.equal(after.updated_at, '2026-02-02T00:00:00.000Z', 'the update did not take effect');
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('storing downloaded illustrations does not queue them straight back', { timeout: 60_000 }, async () => {
  // `decorative_images` is a table a writer replica may queue from, so writing the owner's
  // own images into it without suppressing the triggers enqueued every single one — a
  // replica trying to send the corpus its illustrations back.
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-asset-queue-'));
  try {
    const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
    const { downloadReplicaAssets } = require(path.join(repoRoot, 'electron/serverSync/replicaApply.ts'));
    const { ensureOutboxTriggers } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));
    const Database = require('better-sqlite3');
    const db = new Database(path.join(root, 'writer.sqlite'));
    runMigrations(db);
    ensureOutboxTriggers(db, true);
    db.prepare(
      `INSERT INTO decorative_images (entity_kind, entity_id, requested, status, style, mime_type, created_at, updated_at)
       VALUES ('deep_research', 'dr-1', 1, 'ready', 'antique_book', 'image/png', ?, ?)`
    ).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare("DELETE FROM server_outbox").run();

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const hash = require('node:crypto').createHash('sha256').update(png).digest('hex');
    const result = await downloadReplicaAssets(
      db,
      [{ hash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: png.length, thumbBytes: null, kind: 'deep_research_image', table: 'decorative_images', key: ['deep_research', 'dr-1'] }],
      async () => png,
    );
    assert.equal(result.downloaded, 1);
    assert.ok(db.prepare("SELECT image_blob FROM decorative_images WHERE entity_id = 'dr-1'").get().image_blob.equals(png));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM server_outbox").get().n, 0, 'the replica queued the owner\'s own illustration');
    // A second pull with the bytes already present costs nothing and downloads nothing.
    const again = await downloadReplicaAssets(db, [{ hash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: png.length, thumbBytes: null, kind: 'deep_research_image', table: 'decorative_images', key: ['deep_research', 'dr-1'] }], async () => { throw new Error('should not fetch'); });
    assert.equal(again.downloaded, 0);
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a revoked replica stops syncing and keeps every byte', { timeout: 180_000 }, async () => {
  await withServer({ label: 'replica-revocation' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const ownerFile = path.join(userData, 'revocation.sqlite');
    fs.rmSync(ownerFile, { force: true });
    const ownerDb = new Database(ownerFile);
    runMigrations(ownerDb);
    ownerDb.transaction(seedOwnerCorpus)(ownerDb);
    ownerDb.close();

    const built = publishSnapshot(server.origin, owner.deviceToken, spaceId, ownerFile, { id: 'v', name: 'Corpus', type: 'academic' });
    await fetch(`${server.origin}/api/v1/spaces/${spaceId}/snapshot`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${owner.deviceToken}`, 'content-encoding': 'gzip', 'x-nodus-revision': built.built.revision },
      body: built.gzipped,
    });

    await server.createUser('revocado@example.test', 'revocado-account-password', [{ spaceId, role: 'reader' }]);
    const signIn = await replica.signInToNodusServer(server.origin, 'revocado@example.test', 'revocado-account-password');
    const vault = await replica.createConnectedVault({
      url: signIn.url, ticket: signIn.ticket, space: signIn.spaces[0],
      userEmail: signIn.userEmail, serverName: signIn.serverName,
    });

    const before = new Database(vault.path, { fileMustExist: true });
    const worksBefore = before.prepare('SELECT COUNT(*) AS n FROM works').get().n;
    before.prepare('INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 0, ?, ?)')
      .run('n-mine', 'Mi trabajo', 'markdown', 'Escrito aquí.', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z');
    before.close();

    const state = await server.readState();
    const user = state.users.find((entry) => entry.email === 'revocado@example.test');
    const { postForm } = await import('./lib/nodusServerHarness.mjs');
    await postForm(`${server.origin}/admin/access/revoke`, { csrf: await server.csrf(), userId: user.id, spaceId }, { headers: { cookie: server.adminCookie } });

    await replica.pullReplica(vault.id, { force: true });

    const overview = replica.getReplicaOverview().find((entry) => entry.vaultId === vault.id);
    assert.equal(overview.state, 'revoked');
    assert.equal(overview.phase, 'revoked');
    assert.match(overview.lastError, /sigue en este equipo/);

    // The publisher's answer to a 401 is to drop its token and re-pair. For a replica that
    // would be data loss, so nothing local is touched.
    const after = new Database(vault.path, { fileMustExist: true });
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM works').get().n, worksBefore, 'the corpus is still readable offline');
    assert.equal(after.prepare("SELECT title FROM notes WHERE id = 'n-mine'").get().title, 'Mi trabajo', 'the user keeps their own work');
    after.close();
    assert.ok(fs.existsSync(vault.path), 'the database file is never deleted');
  });
});

test('two offline writers converge Yjs text through binary updates while the owner stays offline', { timeout: 180_000 }, async () => {
  await withServer({ label: 'replica-yjs-convergence' }, async (server) => {
    const spaceId = await server.createSpace('Wiki convergente');
    await server.setPublicationPolicy(spaceId, ['allowUserContent']);
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Owner offline');
    const ownerFile = path.join(userData, 'yjs-owner.sqlite');
    fs.rmSync(ownerFile, { force: true });
    const ownerDb = new Database(ownerFile);
    runMigrations(ownerDb);
    let attachmentFixture;
    const original = databaseRuntime.withDatabaseContext(ownerDb, () => {
      const page = pagesRepo.createPage({
        title: 'Acta compartida',
        blocks: [{ id: 'shared-paragraph', type: 'paragraph', content: { text: 'Base' } }],
      });
      const database = databasesRepo.createDatabase('Archivos compartidos');
      const attachmentColumn = databasesRepo.createColumn(database.id, 'Archivo', 'attachment');
      const row = databasesRepo.createRow(database.id);
      attachmentFixture = { rowId: row.id, columnId: attachmentColumn.id };
      return page;
    });
    ownerDb.close();
    const ownerVault = { id: 'yjs-owner', name: 'Wiki convergente', type: 'databases' };
    const published = publishSnapshot(server.origin, owner.deviceToken, spaceId, ownerFile, ownerVault);
    const publication = await fetch(`${server.origin}/api/v1/spaces/${spaceId}/snapshot`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${owner.deviceToken}`, 'content-encoding': 'gzip', 'x-nodus-revision': published.built.revision },
      body: published.gzipped,
    });
    assert.equal(publication.status, 200);

    for (const [email, password] of [['alice@example.test', 'alice-writer-password'], ['bob@example.test', 'bob-writer-password']]) {
      await server.createUser(email, password, [{ spaceId, role: 'writer' }]);
    }
    const connect = async (email, password) => {
      const signIn = await replica.signInToNodusServer(server.origin, email, password);
      return replica.createConnectedVault({ url: signIn.url, ticket: signIn.ticket, space: signIn.spaces[0], userEmail: signIn.userEmail, serverName: signIn.serverName });
    };
    const alice = await connect('alice@example.test', 'alice-writer-password');
    const bob = await connect('bob@example.test', 'bob-writer-password');
    await replica.updateReplicaPresence(alice.id, {
      pageId: original.page.id, blockId: 'shared-paragraph', cursor: { anchor: 4, head: 4 }, color: '#5b7cfa',
    });
    const presence = await replica.listReplicaPresence(bob.id);
    assert.ok(presence.some((entry) => entry.pageId === original.page.id && entry.cursor?.anchor === 4));
    await replica.updateReplicaPresence(alice.id, null);
    assert.deepEqual(await replica.listReplicaPresence(bob.id), []);

    const editOffline = async (vaultId, suffix, actor) => databaseRuntime.withVaultDatabase(vaultId, () => {
      const current = pagesRepo.getPageDocument(original.page.id);
      assert.ok(current);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, current.yjsState);
      const vector = Y.encodeStateVector(doc);
      const block = doc.getMap('blockById').get('shared-paragraph');
      assert.ok(block instanceof Y.Map);
      const text = block.get('text');
      assert.ok(text instanceof Y.Text);
      text.insert(text.length, suffix);
      const update = Y.encodeStateAsUpdate(doc, vector);
      const saved = pagesRepo.applyPageDocumentUpdate(original.page.id, update, current.revision, actor);
      assert.equal(saved.ok, true);
      const stored = databaseRuntime.getDb().prepare(
        'SELECT update_hash FROM page_document_updates WHERE page_id = ? ORDER BY sequence_no DESC LIMIT 1',
      ).get(original.page.id);
      return { document: saved.document, hash: stored.update_hash };
    });
    const aliceEdit = await editOffline(alice.id, ' · Alice', 'alice');
    const bobEdit = await editOffline(bob.id, ' · Bob', 'bob');
    await replica.drainOutbox(alice.id);
    await replica.drainOutbox(bob.id);
    const relayBeforePull = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    assert.equal(relayBeforePull.mutations.filter((entry) => entry.table === 'page_document_updates').length, 2,
      'both writers publish their independent Yjs delta while offline from the owner');

    // No owner pull or republication occurs here: replicas consume the shared operation
    // stream directly and each merges the other writer's Yjs delta.
    await replica.pullReplica(alice.id);
    await replica.pullReplica(bob.id);
    const inspect = async (vaultId) => databaseRuntime.withVaultDatabase(vaultId, () => {
      const document = pagesRepo.getPageDocument(original.page.id);
      const receipts = databaseRuntime.getDb().prepare('SELECT update_hash FROM page_document_update_receipts WHERE page_id = ?').all(original.page.id).map((row) => row.update_hash);
      const pending = databaseRuntime.getDb().prepare("SELECT COUNT(*) AS count FROM server_outbox WHERE state = 'pending'").get().count;
      return { text: document.blocks[0].content.text, receipts, pending };
    });
    const [aliceAfter, bobAfter] = await Promise.all([inspect(alice.id), inspect(bob.id)]);
    assert.ok(aliceAfter.receipts.includes(bobEdit.hash), 'Alice durably receipts Bob\'s delta');
    assert.ok(bobAfter.receipts.includes(aliceEdit.hash), 'Bob durably receipts Alice\'s delta');
    assert.equal(aliceAfter.text, bobAfter.text);
    assert.match(aliceAfter.text, /Alice/);
    assert.match(aliceAfter.text, /Bob/);
    assert.equal(aliceAfter.pending, 0);
    assert.equal(bobAfter.pending, 0, 'applying a remote projection never queues it back');

    const fileBytes = Buffer.alloc(2 * 1024 * 1024 + 91);
    for (let index = 0; index < fileBytes.length; index += 1) fileBytes[index] = (index * 17) % 251;
    const attachment = await databaseRuntime.withVaultDatabase(alice.id, () => databasesRepo.addAttachment({
      rowId: attachmentFixture.rowId, columnId: attachmentFixture.columnId,
      fileName: 'archivo-grande.bin', mimeType: 'application/octet-stream', bytes: fileBytes.length, blob: fileBytes,
    }));
    await replica.drainOutbox(alice.id);
    const aliceFileQueue = await databaseRuntime.withVaultDatabase(alice.id, () => ({
      rows: databaseRuntime.getDb().prepare("SELECT table_name, state, last_error FROM server_outbox ORDER BY seq").all(),
      attachment: databasesRepo.getAttachment(attachment.id),
    }));
    assert.equal(aliceFileQueue.rows.filter((row) => row.state === 'pending').length, 0,
      `attachment queue did not drain: ${JSON.stringify(aliceFileQueue)}`);
    await replica.pullReplica(bob.id);
    const bobFile = await databaseRuntime.withVaultDatabase(bob.id, () => {
      return {
        bytes: databasesRepo.getAttachmentBlob(attachment.id), attachment: databasesRepo.getAttachment(attachment.id),
        blobs: databaseRuntime.getDb().prepare('SELECT hash, bytes FROM db_blobs').all(),
        foreignKeys: databaseRuntime.getDb().pragma('foreign_key_check'),
      };
    });
    assert.ok(Buffer.isBuffer(bobFile.bytes), `attachment did not hydrate: ${JSON.stringify({ ...bobFile, bytes: null, overview: replica.getReplicaOverview() })}`);
    assert.deepEqual(bobFile.bytes, fileBytes, 'a multi-chunk arbitrary attachment reaches the other replica byte-for-byte');
  });
});

test('the desktop and the server agree on which tables travel and how a row is keyed', () => {
  // Two lists in two languages that must not drift: the triggers decide what is queued and
  // the server decides what is accepted, and a table in one but not the other is either work
  // silently dropped or a door nobody meant to open.
  const desktop = [...replica.MUTABLE_TABLES].sort();
  assert.deepEqual(desktop, Object.keys(SERVER_MUTABLE).sort());

  // The identity the server declares must be the identity SQLite actually uses, or a
  // mutation addresses a row that does not exist.
  const probe = path.join(userData, 'identity-probe.sqlite');
  fs.rmSync(probe, { force: true });
  const db = new Database(probe);
  try {
    runMigrations(db);
    for (const [table, definition] of Object.entries(SERVER_MUTABLE)) {
      assert.deepEqual(identityColumns(table, undefined, db), definition.key, `identity mismatch for ${table}`);
    }
  } finally {
    db.close();
    fs.rmSync(probe, { force: true });
  }
});

test.after(async () => {
  replica.stopReplicaSync();
  if (!externalQaProfile) await rm(userData, { recursive: true, force: true });
});
