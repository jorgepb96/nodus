import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-db-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-migration-repositories.mjs'), '--electron-primary-sources-db-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-sources-db-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  // A byte-for-byte legacy fixture is first built only to v104. It deliberately has
  // every compatibility edge that v105-v107 must preserve: folders, people, evidence,
  // text, a null hash, a wrong historical hash and non-Latin metadata.
  const legacyPath = path.join(root, 'legacy-v104.sqlite');
  const legacyDb = new Database(legacyPath);
  legacyDb.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((entry) => entry.version <= 104).sort((a, b) => a.version - b.version)) {
    legacyDb.transaction(() => {
      legacyDb.exec(migration.up);
      migration.after?.(legacyDb);
      legacyDb.pragma(`user_version = ${migration.version}`);
    })();
  }

  const createdAt = '2026-01-02T03:04:05.000Z';
  const bytesA = Buffer.from([0, 1, 2, 3, 127, 128, 254, 255]);
  const bytesB = Buffer.from('صورة أرشيفية — 文書 — archivo', 'utf8');
  const hashA = createHash('sha256').update(bytesA).digest('hex');
  legacyDb.prepare(
    'INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)'
  ).run('folder_legacy', 'Caja heredada', createdAt);
  legacyDb.prepare(
    `INSERT INTO persons (person_id, display_name, sex, created_at, updated_at)
     VALUES ('person_legacy', 'Ana de la Fuente', 'unknown', ?, ?)`
  ).run(createdAt, createdAt);
  const insertLegacyItem = legacyDb.prepare(
    `INSERT INTO archive_items (
      item_id, folder_id, title, kind, file_name, mime_type, bytes, blob,
      extracted_text, description, source, content_hash, doc_type, metadata_json,
      created_at, updated_at
    ) VALUES (?, 'folder_legacy', ?, 'image', ?, 'image/tiff', ?, ?, ?, ?, ?, ?, 'other', ?, ?, ?)`
  );
  insertLegacyItem.run(
    'legacy_a', 'Carta de Ana', 'ana-001.tif', bytesA.byteLength, bytesA,
    'Texto heredado: fidélité, نص, 文書.', 'Descripción intacta', 'Archivo A · C/1',
    null, '{"unknownField":"se conserva"}', createdAt, createdAt
  );
  insertLegacyItem.run(
    'legacy_b', 'Imagen con hash histórico erróneo', 'ana-002.tif', bytesB.byteLength, bytesB,
    null, null, null, 'not-the-real-hash', null, createdAt, createdAt
  );
  legacyDb.prepare(
    'INSERT INTO archive_item_persons (item_id, person_id, created_at) VALUES (?, ?, ?)'
  ).run('legacy_a', 'person_legacy', createdAt);
  legacyDb.prepare(
    `INSERT INTO record_evidence (
      id, target_kind, target_id, nodus_id, source_kind, quote, location, confidence, created_at
    ) VALUES ('evidence_legacy', 'person', 'person_legacy', 'legacy_a', 'archive',
      'Ana comparece', 'f. 1r', 0.8, ?)`
  ).run(createdAt);

  const beforeLegacy = legacyDb.prepare(
    'SELECT item_id, title, blob, extracted_text, content_hash, metadata_json FROM archive_items ORDER BY item_id'
  ).all();
  runMigrations(legacyDb);
  assert.equal(legacyDb.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(
    legacyDb.prepare(
      'SELECT item_id, title, blob, extracted_text, content_hash, metadata_json FROM archive_items ORDER BY item_id'
    ).all().map((row) => ({ ...row, content_hash: row.item_id === 'legacy_a' ? null : row.content_hash })),
    beforeLegacy,
    'legacy rows, text, unknown metadata and a pre-existing hash are unchanged'
  );

  const migratedA = legacyDb.prepare(
    `SELECT f.*, i.blob AS legacy_blob
     FROM archive_item_files f JOIN archive_items i ON i.item_id=f.item_id
     WHERE f.file_id='legacy_file_legacy_a'`
  ).get();
  assert.ok(migratedA.content_blob.equals(bytesA), 'new master bytes equal the old BLOB');
  assert.ok(migratedA.legacy_blob.equals(bytesA), 'legacy BLOB remains available');
  assert.equal(migratedA.content_hash, hashA, 'null legacy hash is computed as SHA-256');
  assert.equal(migratedA.hash_algorithm, 'sha256');
  assert.equal(migratedA.verification_status, 'verified');
  assert.equal(
    legacyDb.prepare("SELECT content_hash FROM archive_items WHERE item_id='legacy_a'").get().content_hash,
    hashA,
    'the compatible legacy projection receives the computed hash'
  );
  assert.equal(
    legacyDb.prepare("SELECT verification_status FROM archive_item_files WHERE item_id='legacy_b'").get().verification_status,
    'mismatch',
    'a historical bad hash is surfaced without changing bytes or erasing the old claim'
  );
  assert.equal(
    legacyDb.prepare("SELECT content FROM archive_text_versions WHERE item_id='legacy_a'").get().content,
    'Texto heredado: fidélité, نص, 文書.'
  );
  assert.equal(
    legacyDb.prepare("SELECT title FROM archive_description_units WHERE unit_id='legacy_unit_legacy_a'").get().title,
    'Carta de Ana'
  );
  assert.equal(
    legacyDb.prepare("SELECT COUNT(*) AS count FROM archive_item_profiles").get().count,
    2
  );
  assert.deepEqual(
    legacyDb.prepare(
      "SELECT excerpt_id, evidence_role, certainty, review_status, updated_at FROM record_evidence WHERE id='evidence_legacy'"
    ).get(),
    {
      excerpt_id: null,
      evidence_role: 'supports',
      certainty: 0.8,
      review_status: 'unreviewed',
      updated_at: createdAt,
    }
  );
  assert.equal(
    legacyDb.prepare(
      "SELECT COUNT(*) AS count FROM archive_item_persons WHERE item_id='legacy_a' AND person_id='person_legacy'"
    ).get().count,
    1,
    'genealogy links survive'
  );
  assert.deepEqual(legacyDb.pragma('foreign_key_check'), [], 'migration leaves no broken foreign keys');

  const migratedCounts = tableCounts(legacyDb);
  runMigrations(legacyDb);
  assert.deepEqual(tableCounts(legacyDb), migratedCounts, 'running migration again creates no duplicate rows');
  assert.ok(
    legacyDb.prepare("SELECT blob FROM archive_items WHERE item_id='legacy_a'").get().blob.equals(bytesA),
    'reopen/idempotency retains the exact old bytes'
  );
  legacyDb.close();

  // v121 separates the explicit source provenance from place names found in the
  // document. Existing "creation" links are promoted once, without touching the
  // original mention/evidence row.
  const provenancePath = path.join(root, 'legacy-v120-provenance.sqlite');
  const provenanceDb = new Database(provenancePath);
  provenanceDb.pragma('foreign_keys = ON');
  for (const migration of migrations.filter((entry) => entry.version <= 120).sort((a, b) => a.version - b.version)) {
    provenanceDb.transaction(() => {
      provenanceDb.exec(migration.up);
      migration.after?.(provenanceDb);
      provenanceDb.pragma(`user_version = ${migration.version}`);
    })();
  }
  provenanceDb.prepare(
    `INSERT INTO archive_items (item_id, title, kind, bytes, created_at, updated_at)
     VALUES ('legacy_provenance_item', 'Fuente con origen', 'text', 0, ?, ?)`
  ).run(createdAt, createdAt);
  provenanceDb.prepare(
    `INSERT INTO archive_item_profiles (item_id, created_at, updated_at)
     VALUES ('legacy_provenance_item', ?, ?)`
  ).run(createdAt, createdAt);
  provenanceDb.prepare(
    `INSERT INTO places (place_id, name, latitude, longitude, created_at, updated_at)
     VALUES ('legacy_provenance_place', 'Carmona', 37.4713, -5.6469, ?, ?)`
  ).run(createdAt, createdAt);
  provenanceDb.prepare(
    `INSERT INTO archive_place_mentions (
      mention_id, item_id, place_id, original_label, role, certainty, status, created_at, updated_at
    ) VALUES (
      'legacy_creation_mention', 'legacy_provenance_item', 'legacy_provenance_place',
      'Carmona', 'creation', 1, 'resolved', ?, ?
    )`
  ).run(createdAt, createdAt);
  runMigrations(provenanceDb);
  assert.equal(
    provenanceDb.prepare(
      "SELECT provenance_place_id FROM archive_item_profiles WHERE item_id='legacy_provenance_item'"
    ).get().provenance_place_id,
    'legacy_provenance_place',
    'v121 promotes the old explicit creation place to canonical source provenance',
  );
  assert.equal(
    provenanceDb.prepare(
      "SELECT COUNT(*) AS count FROM archive_place_mentions WHERE mention_id='legacy_creation_mention'"
    ).get().count,
    1,
    'the historical place mention is preserved as evidence',
  );
  assert.deepEqual(provenanceDb.pragma('foreign_key_check'), []);
  provenanceDb.close();

  // Exercise the repositories on a normal current vault so SQL placeholder counts,
  // transactions, immutability and legacy projections are verified by execution.
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const hierarchy = require(path.join(repoRoot, 'electron/db/archiveHierarchyRepo.ts'));
  const files = require(path.join(repoRoot, 'electron/db/archiveFilesRepo.ts'));
  const texts = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidence = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const proposals = require(path.join(repoRoot, 'electron/db/archiveProposalsRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesRepo.ts'));
  const integrity = require(path.join(repoRoot, 'electron/db/archiveIntegrityRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const notes = require(path.join(repoRoot, 'electron/db/notesRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const sync = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  const { ensureTombstoneTriggers } = require(path.join(repoRoot, 'electron/db/tombstones.ts'));
  const { createBackupArchive } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));
  const { decryptBackupPayload } = require(path.join(repoRoot, 'electron/export/backupCrypto.ts'));
  const AdmZip = require('adm-zip');

  const db = getDb();
  const repository = hierarchy.createArchiveRepository({
    name: 'Archivo Histórico de Prueba',
    shortName: 'AHP',
    identifier: 'ISIL-TEST',
  });
  const fonds = hierarchy.createArchiveUnit({
    repositoryId: repository.repositoryId,
    level: 'fonds',
    title: 'Fondo de prueba',
    referenceCode: 'F',
    position: 1000,
  });
  const series = hierarchy.createArchiveUnit({
    repositoryId: repository.repositoryId,
    parentUnitId: fonds.unitId,
    level: 'series',
    title: 'Correspondencia',
    referenceCode: 'F/1',
    position: 0,
  });
  assert.throws(
    () => hierarchy.moveArchiveUnit(fonds.unitId, series.unitId, 0),
    /Jerarquía archivística no válida/,
    'cycles roll back'
  );
  assert.equal(hierarchy.getArchiveUnit(fonds.unitId).parentUnitId, null);

  const item = archive.createItem({
    title: 'Carta sin describir',
    kind: 'image',
    fileName: 'carta.tif',
    mimeType: 'image/tiff',
    blob: bytesA,
    extractedText: 'Ana escribe desde Sevilla.',
    description: 'Descripción heredada inicial',
  });
  primary.createPrimarySourceLink(item.itemId, series.unitId);
  primary.seedPrimarySourceProfile(item.itemId);
  const canonical = primary.updateCanonicalDescription(item.itemId, {
    title: 'Carta de Ana a Luis',
    scopeContent: 'Carta sobre el viaje a Sevilla.',
    referenceCode: 'F/1/7',
  });
  assert.equal(canonical.title, 'Carta de Ana a Luis');
  assert.equal(archive.getItem(item.itemId).title, canonical.title, 'legacy Archive reads the canonical projection');
  assert.equal(archive.getItem(item.itemId).description, canonical.scopeContent);

  const session = hierarchy.createCaptureSession({
    repositoryId: repository.repositoryId,
    title: 'Consulta de julio',
    sessionKind: 'consultation',
    researcher: 'Investigadora',
  });
  assert.equal(hierarchy.listCaptureSessions()[0].sessionId, session.sessionId);
  assert.equal(
    primary.updatePrimarySourceProfile(item.itemId, {
      captureSessionId: session.sessionId,
      accessStatus: 'restricted',
      sensitivity: 'sensitive',
    }).accessStatus,
    'restricted'
  );

  const master = files.addArchiveMasterVersion(item.itemId, {
    content: bytesA,
    originalFileName: 'carta-master.tif',
    mimeType: 'image/tiff',
    createdBy: 'user',
  });
  const derivative = files.createArchiveDerivative(master.fileId, {
    content: Buffer.from('access-copy'),
    originalFileName: 'carta-access.jpg',
    mimeType: 'image/jpeg',
    transformation: { operation: 'convert', quality: 85 },
  });
  assert.equal(derivative.parentFileId, master.fileId);
  assert.notEqual(derivative.contentHash, master.contentHash);
  const nextMaster = files.addArchiveMasterVersion(item.itemId, {
    content: Buffer.from('new-version'),
    originalFileName: 'carta-master-v2.tif',
    mimeType: 'image/tiff',
  });
  assert.equal(nextMaster.versionNo, 2, 'replacement creates a second master row');
  assert.ok(files.getArchiveFileBlob(master.fileId).equals(bytesA), 'the first master is immutable');
  files.verifyArchiveFile(master.fileId);
  assert.equal(integrity.listIntegrityChecks({ fileId: master.fileId })[0].status, 'verified');

  const diplomatic = texts.createArchiveTextVersion({
    itemId: item.itemId,
    fileId: master.fileId,
    kind: 'diplomatic',
    content: 'Ana escribe desde Seuilla.',
    status: 'in_review',
    createdBy: 'user',
  });
  const segments = texts.replaceArchiveTextSegments(diplomatic.textVersionId, [{
    fileId: master.fileId,
    sequenceNo: 0,
    pageLabel: '1r',
    startOffset: 0,
    endOffset: 25,
    content: 'Ana escribe desde Seuilla.',
    bbox: { x: 0.1, y: 0.2, width: 0.6, height: 0.1 },
    timeStartMs: null,
    timeEndMs: null,
    confidence: 0.92,
  }]);
  const excerpt = evidence.createArchiveExcerpt({
    itemId: item.itemId,
    fileId: master.fileId,
    textVersionId: diplomatic.textVersionId,
    segmentId: segments[0].segmentId,
    locatorDisplay: 'f. 1r, líneas 1–2',
    locator: { folio: '1', side: 'recto', segmentId: segments[0].segmentId, textRange: { start: 0, end: 25 } },
    quotedText: 'Ana escribe desde Seuilla.',
    languageCode: 'es',
    description: 'Lugar de escritura',
    reviewStatus: 'reviewed',
    createdBy: 'user',
  });
  assert.throws(
    () => evidence.createArchiveExcerpt({ ...excerpt, locator: {}, excerptId: undefined }),
    /Localizador no válido/
  );

  const ana = entities.createPerson({ displayName: 'Ana de la Fuente' });
  const supported = evidence.createPrimarySourceEvidence({
    targetKind: 'person',
    targetId: ana.personId,
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    evidenceRole: 'supports',
    certainty: 0.9,
    reviewStatus: 'reviewed',
    sourceVersionId: diplomatic.textVersionId,
    quote: null,
    location: null,
    createdBy: 'user',
  });
  assert.equal(supported.quote, excerpt.quotedText, 'simple export quote is projected from the excerpt');
  assert.equal(supported.location, excerpt.locatorDisplay);
  assert.equal(entities.listEvidenceFor('person', ana.personId)[0].excerptId, excerpt.excerptId);

  evidence.savePrimarySourceAnalysis(item.itemId, {
    originNotes: 'Procedencia documentada en el catálogo.',
    perspectiveBias: 'Perspectiva de la remitente.',
    status: 'draft',
  });
  evidence.createPersonMention({
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    personId: ana.personId,
    originalLabel: 'Ana',
    role: 'remitente',
    certainty: 0.9,
    identityStatus: 'confirmed',
  });

  const proposalInput = {
    itemId: item.itemId,
    excerptId: excerpt.excerptId,
    proposalKind: 'place',
    payload: { label: 'Sevilla', role: 'creation' },
    matchedTargetId: null,
    confidence: 0.8,
    rationale: 'Mención explícita',
    sourceEngine: 'fixture',
    sourceModel: 'v1',
  };
  const proposal = proposals.createEntityProposal(proposalInput);
  assert.equal(
    proposals.createEntityProposal({ ...proposalInput, payload: { role: 'creation', label: 'Sevilla' } }).proposalId,
    proposal.proposalId,
    'stable proposal fingerprints are order-independent'
  );
  proposals.decideEntityProposal(proposal.proposalId, 'rejected', { reviewedBy: 'user' });
  assert.equal(proposals.createEntityProposal(proposalInput).status, 'rejected', 'rejected proposal never reappears');

  const note = notes.createNote({ title: 'Hipótesis', content: 'La carta puede fecharse después del viaje.' });
  const link = evidence.createNoteLink({
    nodusId: note.id,
    targetKind: 'archive_excerpt',
    targetId: excerpt.excerptId,
    excerptId: excerpt.excerptId,
    relationKind: 'interprets',
  });
  assert.equal(link.targetId, excerpt.excerptId);

  assert.throws(
    () => primary.runPrimarySourcesTransaction(() => {
      db.prepare("INSERT INTO archive_exports (export_id, kind, selection_json, policy_snapshot_json, created_at) VALUES ('rollback', 'test', '[]', '{}', ?)").run(createdAt);
      throw new Error('rollback requested');
    }),
    /rollback requested/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM archive_exports WHERE export_id='rollback'").get().count, 0);
  integrity.recordArchiveExport({
    kind: 'inventory',
    selection: [item.itemId],
    policySnapshot: { restricted: true },
    includedFiles: 0,
    excludedFiles: 3,
  });

  const requiredTables = [
    'archive_repositories', 'archive_description_units', 'archive_item_units',
    'archive_capture_sessions', 'archive_item_profiles', 'archive_item_files',
    'archive_text_versions', 'archive_text_segments', 'archive_excerpts',
    'archive_entity_proposals', 'archive_source_analyses', 'archive_place_mentions',
    'archive_person_mentions', 'entity_resolutions', 'note_links',
    'archive_integrity_checks', 'archive_exports',
  ];
  const coverage = sync.describeSyncCoverage();
  for (const table of requiredTables) {
    assert.ok(coverage.included.genealogy.includes(table), `${table} is included in sync and backup inventory`);
  }
  assert.deepEqual(coverage.unmergeable, []);
  ensureTombstoneTriggers(db);
  for (const table of requiredTables) {
    assert.ok(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`nodus_tomb_del_${table}`),
      `${table} deletion is tombstoned`
    );
  }

  const backup = await createBackupArchive({
    password: 'primary-sources-backup-test',
    appVersion: '0.0.0-test',
  });
  const outerZip = new AdmZip(backup);
  const manifest = JSON.parse(outerZip.readAsText('manifest.json'));
  const payloadZip = new AdmZip(
    decryptBackupPayload(
      outerZip.getEntry('backup.bin').getData(),
      'primary-sources-backup-test',
      manifest.cipher
    )
  );
  const registry = JSON.parse(payloadZip.readAsText('registry.json'));
  const activeVault = registry.vaults.find((vault) => vault.id === registry.activeVaultId);
  const backupInventory = JSON.parse(payloadZip.readAsText(activeVault.inventoryFile));
  for (const table of requiredTables) {
    assert.ok(table in backupInventory.tableRows, `${table} is enumerated by the full backup`);
  }
  const snapshotPath = path.join(root, 'primary-sources-backup-snapshot.sqlite');
  fs.writeFileSync(snapshotPath, payloadZip.getEntry(activeVault.dbFile).getData());
  const snapshotDb = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  assert.ok(
    snapshotDb.prepare('SELECT content_blob FROM archive_item_files WHERE file_id=?').get(master.fileId).content_blob.equals(bytesA),
    'the full backup carries exact master bytes'
  );
  assert.equal(
    snapshotDb.prepare('SELECT quoted_text FROM archive_excerpts WHERE excerpt_id=?').get(excerpt.excerptId).quoted_text,
    excerpt.quotedText,
    'the full backup carries citable excerpts'
  );
  snapshotDb.close();

  primary.deletePrimarySource(item.itemId);
  assert.equal(archive.getItem(item.itemId), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM archive_item_files WHERE item_id=?').get(item.itemId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_links WHERE target_id=?').get(excerpt.excerptId).count, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  console.log('Primary Sources migration and repository tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function tableCounts(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count,
  ]));
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
