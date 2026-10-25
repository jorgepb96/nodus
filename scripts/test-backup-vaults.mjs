// Whole-app backup integrity: proves an automatic backup captures EVERY vault (of
// every type), and that restoring it brings them all back — the guarantee that the
// copy is integral across vault types, not just the active vault. Runs the REAL
// vaultRegistry + database + exportImport under Electron-as-Node against a temp
// profile.
import assert from 'node:assert/strict';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-backup-vaults-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-backup-vaults.mjs'), '--electron-backup-vaults-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-vaults-'));
installRuntimeHooks(root);

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const { createBackupArchive, restoreBackupArchive } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));
  const { decryptBackupPayload } = require(path.join(repoRoot, 'electron/export/backupCrypto.ts'));
  const AdmZip = require('adm-zip');

  const switchTo = (id) => {
    vaults.setActiveVault(id);
    closeDb();
  };

  // ── Two vaults of different types, each with its own data ───────────────────
  const legacy = vaults.getActiveVault(); // the default 'academic' vault
  assert.equal(legacy.type, 'academic');
  getDb().prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ academicMode: 'manual' }));
  const alice = entities.createPerson({ displayName: 'Alice Académica' });
  assert.ok(entities.getPerson(alice.personId), 'person seeded in vault A');
  const documentProfiles = require(path.join(repoRoot, 'electron/db/documentProfilesRepo.ts'));
  getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title) VALUES('backup-doc','BACKUP-DOC','Obra con perfil')").run();
  documentProfiles.publishDocumentProfile({
    nodusId: 'backup-doc', sourceFingerprint: 'backup-source', pipelineVersion: 'document-profile/1', schemaVersion: 1,
    sourceLanguage: 'es', presentationLanguage: 'es', overview: 'Perfil que debe sobrevivir al backup.', profile: {},
    fields: [{ fieldId: 'backup-field', kind: 'thesis', ordinal: 0, text: 'Tesis preservada.', confidence: 1, centrality: 1 }],
    sections: [], supports: [], ideaLinks: [],
    vectors: [{ vectorId: 'backup-vector', kind: 'overview', sourceId: null, text: 'Perfil que debe sobrevivir al backup.', weight: 1, embedding: [1, 0, 0, 0] }],
    generatorModel: null, auditorModel: null, promptHash: 'backup-prompt',
    audit: { passed: true, score: 1, supportCoverage: 1, structureCoverage: 1, issues: [], repaired: false }, qualityScore: 1,
  });

  const indexRepo = require(path.join(repoRoot, 'electron/db/embeddingIndexesRepo.ts'));
  const savedProfile = indexRepo.embeddingProfile(require(path.join(repoRoot, 'electron/db/settingsRepo.ts')).getSettings(), { provider: 'openai', model: 'backup-saved' });
  const savedIndex = indexRepo.createIndex(getDb(), savedProfile);
  const savedContext = indexRepo.indexContext(getDb(), savedIndex);
  indexRepo.storeIndexValue(getDb(), savedContext, { family: 'document_vectors', entityId: 'saved-vector', textHash: 'saved-text', vector: [0, 1, 0, 0], contract: indexRepo.contractForProfile(savedProfile, 4) });
  getDb().prepare("UPDATE embedding_indexes SET preparation='paused',staging_generation=2,completed=1,total=2 WHERE id=?").run(savedIndex.id);
  const runRepo = require(path.join(repoRoot, 'electron/db/embeddingRunsRepo.ts'));
  const savedRun = runRepo.beginEmbeddingRun(getDb(), savedIndex.id, 2, 'rebuild');
  runRepo.recordEmbeddingRunItem(getDb(), savedRun, 'document_vectors', 'saved-vector', 'saved-text', 'computed');
  runRepo.recordEmbeddingProviderInputs(getDb(), savedRun, 1);
  const documentaryPreparation = require(path.join(repoRoot, 'electron/ai/documentaryPreparation.ts'));
  const shared = documentaryPreparation.documentaryStore();
  const sharedIdentity = { documentId: 'backup-shared', attachmentId: null, revision: 'backup-r1', textFingerprint: 'backup-text', chunkerVersion: 'test/1', processingVersion: 'test/1',
    embedding: { provider: 'openai', model: 'backup-saved', dimensions: 4, metric: 'cosine', parameters: { embeddingProfile: indexRepo.profileFingerprint(savedProfile) } } };
  const sharedKey = shared.enqueue(sharedIdentity, {});
  const sharedJob = shared.claim();
  shared.saveChunks(sharedJob, [{ text: 'Evidence retained for a valid citation.', pageLabel: '1', pageNumber: 1, sourceRef: 'source' }]);
  shared.publishLexical(sharedJob); shared.publishEmbeddings(sharedJob, [[0, 1, 0, 0]]);
  require(path.join(repoRoot, 'electron/db/embeddingDocumentaryRefs.ts')).recordDocumentaryIndexReference(getDb(), shared.db, legacy.id, savedContext, sharedKey, 'backup-shared');

  const gene = vaults.createVault('Familia', 'genealogy');
  switchTo(gene.id);
  assert.equal(vaults.getActiveVault().type, 'genealogy', 'active vault is now the genealogy one');
  const bob = entities.createPerson({ displayName: 'Bob Genealógico' });
  assert.ok(entities.getPerson(bob.personId), 'person seeded in vault B');

  // A third vault in databases mode with a database, column, row and cell — proving
  // the db_* tables travel in the whole-app backup like any other vault data.
  const dataVault = vaults.createVault('Datos', 'databases');
  switchTo(dataVault.id);
  assert.equal(vaults.getActiveVault().type, 'databases', 'active vault is now the databases one');
  const database = dbmode.createDatabase('Muestras');
  const col = dbmode.createColumn(database.id, 'Nombre', 'title');
  const dbRow = dbmode.createRow(database.id);
  dbmode.setCell(dbRow.id, col.id, 'Muestra 1');
  // Also seed an attachment (BLOB), a relation and a saved view so the backup is proven
  // to carry every db_* table, including binary attachments.
  const attCol = dbmode.createColumn(database.id, 'Foto', 'attachment');
  const att = dbmode.addAttachment({ rowId: dbRow.id, columnId: attCol.id, fileName: 'x.png', mimeType: 'image/png', bytes: 3, blob: Buffer.from('PNG'), contentHash: 'h1' });
  const dbRow2 = dbmode.createRow(database.id);
  dbmode.setCell(dbRow2.id, col.id, 'Muestra 2');
  const relCol = dbmode.createColumn(database.id, 'Vínculo', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: database.id });
  dbmode.addRelation(dbRow.id, relCol.id, 'db_row', dbRow2.id);
  dbmode.createView(database.id, { name: 'Vista X', layout: 'gallery', filter: { conjunction: 'and', conditions: [] }, sorts: [] });
  assert.equal(dbmode.databaseStats(database.id).rowCount, 2, 'rows seeded in databases vault');

  // Every other selectable vault type uses the same complete SQLite contract and
  // must be present too, including teaching and the worldbuilding preview workspace.
  const extraVaults = [];
  for (const [name, type] of [['Estudio', 'estudio'], ['Mundo', 'worldbuilding'], ['Docencia', 'docencia']]) {
    const vault = vaults.createVault(name, type);
    switchTo(vault.id);
    const person = entities.createPerson({ displayName: `Dato ${name}` });
    extraVaults.push({ vault, person });
  }
  // The teaching vault's Analizar group (chat, ideas, graph) writes to two different
  // places: the study_idea_* tables inside the DB and a JSON history file beside it.
  // Only the first travels for free with the snapshot, so both are seeded here and
  // asserted after the restore — a backup that silently drops the chat history would
  // otherwise look complete.
  const teachingVault = extraVaults.find((item) => item.vault.type === 'docencia').vault;
  const teachingDir = path.dirname(teachingVault.path);
  switchTo(teachingVault.id);
  const teachingDemo = require(path.join(repoRoot, 'electron/db/teachingDemoData.ts'));
  const studyChat = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  assert.equal(teachingDemo.seedTeachingDemoData(), true, 'teaching sample workspace seeded');
  const teachingIdeaCount = Number(getDb().prepare("SELECT COUNT(*) AS n FROM study_ideas WHERE id LIKE 'demo-teaching-%'").get().n);
  assert.ok(teachingIdeaCount > 0, 'the teaching vault has ideas before the backup');
  assert.ok(
    studyChat.listStudyAssistantConversations().some((item) => item.id === 'demo-teaching-chat-commentary'),
    'the teaching vault has a chat conversation before the backup'
  );

  const studyVault = extraVaults.find((item) => item.vault.type === 'estudio').vault;
  const studyDir = path.dirname(studyVault.path);
  fs.writeFileSync(path.join(studyDir, 'study-chat-history.json'), JSON.stringify([{ text: 'historial estudio' }]));
  fs.mkdirSync(path.join(studyDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(studyDir, 'audio', 'lesson.wav'), Buffer.from('STUDY-AUDIO'));
  // Nodi's quick notes are user-authored Markdown living install-wide in userData,
  // exactly like the chat history beside them. They were missing from the archive.
  fs.writeFileSync(
    path.join(root, 'nodi-notes.json'),
    JSON.stringify({ version: 1, notes: [{ id: 'n1', title: 'Idea suelta', content: 'No perder esto', titleExplicit: false }] })
  );
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const backupFolder = path.join(root, 'backups');
  const globalLibraryRoot = path.join(backupFolder, 'nodus-library');
  const globalItem = path.join(globalLibraryRoot, 'canonical-work');
  settingsRepo.updateSettings({ autoBackupFolder: backupFolder });
  fs.mkdirSync(globalItem, { recursive: true });
  fs.writeFileSync(path.join(globalLibraryRoot, 'library.json'), JSON.stringify({ format: 'nodus.library', formatVersion: 2 }));
  fs.writeFileSync(path.join(globalItem, 'metadata.json'), JSON.stringify({ id: 'canonical-work', title: 'Canonical title' }));
  fs.writeFileSync(path.join(globalItem, 'reader.md'), '# Canonical clean reader\n\nProtected text.\n');
  fs.writeFileSync(path.join(globalItem, 'original.pdf'), '%PDF-1.4\nGLOBAL-LIBRARY\n');
  fs.mkdirSync(path.join(globalLibraryRoot, '.nodus', 'recovery', 'pre-v4'), { recursive: true });
  fs.writeFileSync(path.join(globalLibraryRoot, '.nodus', 'recovery', 'pre-v4', 'recursive-copy.bin'), 'must be excluded');
  // Restore the genealogy vault as active so the backup's active matches the assertion below.
  switchTo(gene.id);

  // Back up the WHOLE app (all vaults) while the genealogy vault is active.
  const focusRuntime = require(path.join(repoRoot, 'electron/study/focusRuntime.ts'));
  const focus = focusRuntime.getGlobalFocusService();
  focus.configure({ enterOnStart: false, layout: { 'nav:browser': false } });
  focus.act('start', focus.snapshot().revision, null, 'Tiempo que debe sobrevivir');
  const focusSessionId = focus.snapshot().sessionId;
  const archive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
  assert.equal(focus.snapshot().status, 'running', 'whole-app backup leaves Focus running');
  assert.ok(Buffer.isBuffer(archive) && archive.length > 0, 'archive produced');
  const initialZip = new AdmZip(archive);
  const initialManifest = JSON.parse(initialZip.readAsText('manifest.json'));
  const initialPayload = new AdmZip(decryptBackupPayload(initialZip.getEntry('backup.bin').getData(), 'clave-larga-de-prueba', initialManifest.cipher));
  assert.ok(initialPayload.getEntry('aux/global/focus.sqlite'), 'the global Focus snapshot travels in the archive');
  assert.equal(initialPayload.getEntries().some((entry) => entry.entryName.includes('recursive-copy.bin')), false, 'pre-v4 recovery packages are not recursively embedded');

  // ── Wipe both vaults' data ──────────────────────────────────────────────────
  entities.deletePerson(bob.personId); // vault B (active)
  assert.equal(entities.getPerson(bob.personId), null, 'Bob deleted from vault B');
  switchTo(dataVault.id);
  dbmode.deleteDatabase(database.id); // databases vault
  assert.equal(dbmode.listDatabases().length, 0, 'database wiped from the databases vault');
  switchTo(legacy.id);
  entities.deletePerson(alice.personId); // vault A
  getDb().prepare("DELETE FROM works WHERE nodus_id='backup-doc'").run();
  assert.equal(entities.getPerson(alice.personId), null, 'Alice deleted from vault A');
  for (const item of extraVaults) {
    switchTo(item.vault.id);
    entities.deletePerson(item.person.personId);
  }
  switchTo(teachingVault.id);
  teachingDemo.clearTeachingDemoData();
  assert.equal(Number(getDb().prepare("SELECT COUNT(*) AS n FROM study_ideas WHERE id LIKE 'demo-teaching-%'").get().n), 0, 'teaching ideas wiped');
  assert.equal(studyChat.listStudyAssistantConversations().length, 0, 'teaching chat history wiped');
  fs.rmSync(path.join(studyDir, 'study-chat-history.json'), { force: true });
  fs.rmSync(path.join(studyDir, 'audio'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'nodi-notes.json'), { force: true });
  fs.writeFileSync(path.join(globalItem, 'reader.md'), '# Mutated after backup\n');
  fs.rmSync(path.join(globalItem, 'original.pdf'), { force: true });

  // ── Restore the whole app from the single archive ───────────────────────────
  const result = restoreBackupArchive(archive, 'clave-larga-de-prueba');
  assert.equal(result.ok, true, `restore ok: ${result.message}`);
  const restoredFocus = focusRuntime.getGlobalFocusSnapshot();
  assert.equal(restoredFocus.state.sessionId, focusSessionId);
  assert.equal(restoredFocus.state.status, 'paused');
  assert.equal(restoredFocus.state.preferences.enterOnStart, false);
  assert.deepEqual(restoredFocus.state.preferences.layout, { 'nav:browser': false });

  // Both vaults still exist, and BOTH people are back — proving the backup was
  // integral across vault types, and the active vault was restored to the backup's.
  const ids = vaults.listVaults().map((v) => v.id).sort();
  assert.ok(ids.includes(legacy.id) && ids.includes(gene.id), 'both vaults present after restore');
  assert.equal(vaults.getActiveVault().id, gene.id, 'active vault restored to the backed-up active (genealogy)');
  assert.ok(entities.getPerson(bob.personId), 'Bob restored in the genealogy vault');

  switchTo(dataVault.id);
  const restoredDbs = dbmode.listDatabases();
  assert.equal(restoredDbs.length, 1, 'database restored in the databases vault');
  assert.equal(restoredDbs[0].name, 'Muestras');
  const restoredRows = dbmode.listRows(restoredDbs[0].id);
  assert.equal(restoredRows.length, 2, 'rows restored');
  assert.equal(restoredRows[0].cells[col.id], 'Muestra 1', 'cell value restored');
  // Attachment blob, relation and saved view survive (ids are preserved by a full-DB backup).
  const restoredBlob = dbmode.getAttachmentBlob(att.id);
  assert.ok(restoredBlob && restoredBlob.toString() === 'PNG', 'attachment blob restored from the backup');
  assert.equal(dbmode.listRelations(dbRow.id, relCol.id).length, 1, 'relation restored from the backup');
  assert.equal(dbmode.listViews(database.id).length, 1, 'saved view restored from the backup');

  switchTo(legacy.id);
  assert.ok(entities.getPerson(alice.personId), 'Alice restored in the academic vault');
  assert.equal(settingsRepo.getSettings().academicMode, 'manual', 'manual mode survives encrypted backup and restore');
  assert.equal(documentProfiles.getDocumentProfile('backup-doc').fields[0].text, 'Tesis preservada.', 'the audited document profile is restored');
  // Vector ids are scoped to the version that published them, so the restored row is found by
  // its kind and text rather than by the id the pipeline proposed.
  assert.equal(
    getDb().prepare("SELECT length(embedding) AS bytes FROM embedding_read_document_vectors WHERE text='Perfil que debe sobrevivir al backup.'").get().bytes,
    16,
    'the document embedding is restored without reindexing'
  );
  assert.equal(indexRepo.indexRow(getDb(), savedIndex.id).preparation, 'paused', 'a saved preparation is restored');
  assert.equal(indexRepo.indexRow(getDb(), savedIndex.id).staging_generation, 2);
  const restoredRun = runRepo.listEmbeddingRuns(getDb(), savedIndex.id)[0];
  assert.equal(restoredRun.id, savedRun); assert.equal(restoredRun.reason, 'rebuild');
  assert.equal(restoredRun.state, 'paused'); assert.equal(restoredRun.lastReason, 'restart');
  assert.equal(restoredRun.computed, 1); assert.equal(restoredRun.providerInputs, 1);
  assert.equal(getDb().prepare('SELECT hex(embedding) bytes FROM embedding_index_values WHERE index_id=?').get(savedIndex.id).bytes, '000000000000803F0000000000000000', 'saved vectors survive without model calls');
  assert.equal(getDb().prepare('SELECT index_key FROM embedding_index_documentary_refs WHERE index_id=?').get(savedIndex.id).index_key, sharedKey);
  assert.equal(documentaryPreparation.documentaryStore().revision(sharedKey).embedding_ready, 1, 'the shared half of the index is included in the same backup');
  for (const item of extraVaults) {
    switchTo(item.vault.id);
    assert.ok(entities.getPerson(item.person.personId), `${item.vault.type} vault data restored`);
  }
  switchTo(teachingVault.id);
  assert.equal(
    Number(getDb().prepare("SELECT COUNT(*) AS n FROM study_ideas WHERE id LIKE 'demo-teaching-%'").get().n),
    teachingIdeaCount,
    'teaching ideas restored from the backup'
  );
  assert.ok(
    Number(getDb().prepare("SELECT COUNT(*) AS n FROM study_idea_edges WHERE id LIKE 'demo-teaching-%'").get().n) > 0,
    'teaching idea graph edges restored from the backup'
  );
  assert.ok(
    studyChat.listStudyAssistantConversations().some((item) => item.id === 'demo-teaching-chat-commentary'),
    'teaching chat history restored from the backup'
  );
  assert.match(fs.readFileSync(path.join(teachingDir, 'study-chat-history.json'), 'utf8'), /demo-teaching-chat-commentary/, 'the teaching chat file is inside the archive');
  assert.match(fs.readFileSync(path.join(studyDir, 'study-chat-history.json'), 'utf8'), /historial estudio/, 'study history restored');
  assert.equal(fs.readFileSync(path.join(studyDir, 'audio', 'lesson.wav'), 'utf8'), 'STUDY-AUDIO', 'study generated audio restored');
  assert.match(fs.readFileSync(path.join(root, 'nodi-notes.json'), 'utf8'), /No perder esto/, 'Nodi quick notes restored');
  assert.match(fs.readFileSync(path.join(globalItem, 'reader.md'), 'utf8'), /Protected text/, 'the canonical clean reader is restored');
  assert.match(fs.readFileSync(path.join(globalItem, 'original.pdf'), 'utf8'), /GLOBAL-LIBRARY/, 'the canonical original is restored');
  assert.equal(fs.existsSync(path.join(globalLibraryRoot, '.nodus', 'recovery', 'pre-v4', 'recursive-copy.bin')), true, 'local pre-v4 recovery survives a normal restore');

  // Full-state scope is enforced in the main process. Even a stale/hostile caller
  // passing the removed legacy selection cannot exclude vaults or auxiliary data.
  const scoped = await createBackupArchive({
    password: 'clave-de-seleccion',
    appVersion: '9.9.9-test',
    selection: { vaultIds: [gene.id], includePreferences: false, includeHistories: false, includeGeneratedMedia: false, includeApiKeys: false },
  });
  const scopedZip = new AdmZip(scoped);
  const scopedManifest = JSON.parse(scopedZip.readAsText('manifest.json'));
  assert.equal(scopedManifest.vaultCount, vaults.listVaults().length, 'legacy selection cannot reduce the protected vault set');
  const scopedPayload = new AdmZip(decryptBackupPayload(scopedZip.getEntry('backup.bin').getData(), 'clave-de-seleccion', scopedManifest.cipher));
  const scopedRegistry = JSON.parse(scopedPayload.readAsText('registry.json'));
  assert.deepEqual(new Set(scopedRegistry.vaults.map((vault) => vault.id)), new Set(vaults.listVaults().map((vault) => vault.id)), 'every vault remains in the payload');
  assert.equal(scopedPayload.getEntries().some((entry) => entry.entryName.startsWith('aux/')), true, 'legacy exclusions cannot omit auxiliary data');

  // ── Machine-local paths must not travel between computers ───────────────────
  // The vault's settings row rides inside the snapshot, so a restore used to import
  // the SOURCE machine's absolute Zotero root. On a different computer (or a different
  // username) that path does not exist and every local PDF lookup fails silently —
  // the corpus text survives but nothing can be re-scanned or opened.
  switchTo(legacy.id);
  settingsRepo.updateSettings({ zoteroStoragePath: '/Users/equipo-origen/Zotero/storage' });
  const pathArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });

  // Same vault on a different machine: its own Zotero root must survive the restore.
  settingsRepo.updateSettings({ zoteroStoragePath: '/Users/equipo-destino/Zotero/storage' });
  assert.equal(restoreBackupArchive(pathArchive, 'clave-larga-de-prueba').ok, true, 'restore ok');
  switchTo(legacy.id);
  assert.equal(
    settingsRepo.getSettings().zoteroStoragePath,
    '/Users/equipo-destino/Zotero/storage',
    'this machine\'s Zotero root is kept, not the archived one'
  );

  // A fresh device has no path of its own: the archived one must be dropped rather
  // than inherited, so Zotero auto-detection can find the real local library.
  settingsRepo.updateSettings({ zoteroStoragePath: '' });
  assert.equal(restoreBackupArchive(pathArchive, 'clave-larga-de-prueba').ok, true, 'restore ok on a fresh device');
  switchTo(legacy.id);
  assert.equal(settingsRepo.getSettings().zoteroStoragePath, '', 'a fresh device does not inherit a foreign Zotero root');

  // The rest of the settings row must still be restored normally.
  assert.ok(entities.getPerson(alice.personId), 'library data still restored alongside the path scrubbing');

  // ── The path the app actually uses: restore WITH a safety snapshot ──────────
  // `importData` and `restoreRecoverySnapshot` both go through this, and it had no
  // coverage at all — the rollback that protects a failed restore had never been run.
  const { restoreBackupArchiveSafely } = require(path.join(repoRoot, 'electron/export/exportImport.ts'));
  switchTo(gene.id);
  const safeArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
  entities.deletePerson(bob.personId);
  assert.equal(entities.getPerson(bob.personId), null, 'Bob deleted again before the safe restore');

  const safeResult = await restoreBackupArchiveSafely(safeArchive, 'clave-larga-de-prueba', '9.9.9-test');
  assert.equal(safeResult.ok, true, `safe restore ok: ${safeResult.message}`);
  assert.ok(safeResult.safetyBackupPath && fs.existsSync(safeResult.safetyBackupPath), 'a pre-restore snapshot is retained');
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'Bob restored through the safe path');

  // ── A restore that fails mid-swap must not destroy a vault ──────────────────
  // The old code deleted the live database and then copied the replacement over it, so
  // any failure in between (disk full, volume unmounted) left a truncated file where a
  // vault used to be — and the rollback hit the very same wall. The copy now lands on a
  // sibling and is renamed into place, so an interrupted restore leaves the vault whole.
  // Fault injection: the write of the replacement database fails. A read-only directory
  // is NOT enough to reproduce this — it blocks the delete too, so the vault survives by
  // accident. The hazard is specifically "delete succeeded, then the write failed", so
  // the copy itself is made to throw.
  const victim = extraVaults[0].vault;
  const victimDir = path.dirname(victim.path);
  const victimBytesBefore = fs.readFileSync(victim.path).length;
  switchTo(gene.id);
  const realCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = (src, dest, ...rest) => {
    if (String(dest).startsWith(victim.path)) {
      const error = new Error('ENOSPC: no space left on device (simulado)');
      error.code = 'ENOSPC';
      throw error;
    }
    return realCopyFileSync(src, dest, ...rest);
  };
  let failed;
  try {
    failed = await restoreBackupArchiveSafely(safeArchive, 'clave-larga-de-prueba', '9.9.9-test');
  } finally {
    fs.copyFileSync = realCopyFileSync;
  }
  assert.equal(failed.ok, false, 'a restore that cannot write a vault reports failure');
  assert.ok(fs.existsSync(victim.path), 'the vault database still exists after a failed restore');
  assert.equal(fs.readFileSync(victim.path).length, victimBytesBefore, 'the vault database is intact, not truncated');
  const probe = new (require('better-sqlite3'))(victim.path, { readonly: true, fileMustExist: true });
  try {
    assert.equal(probe.pragma('quick_check', { simple: true }), 'ok', 'the surviving database is not corrupt');
  } finally {
    probe.close();
  }
  assert.equal(fs.readdirSync(victimDir).filter((name) => name.includes('.incoming-')).length, 0, 'no staging file is left behind');
  // The library still works after the failed attempt.
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'the genealogy vault still reads after the failed restore');

  // ── Deletions must survive a backup round trip ──────────────────────────────
  // A tombstone is what stops a deleted row from being re-inserted by the next sync.
  // If a restore lost them, every deletion made before the backup would come back the
  // first time the other machine synced — the exact bug tombstones exist to prevent.
  switchTo(gene.id);
  const doomed = entities.createPerson({ displayName: 'Se borrará' });
  entities.deletePerson(doomed.personId);
  const tombstoneRows = getDb().prepare('SELECT table_name, row_key FROM sync_tombstones').all();
  assert.ok(tombstoneRows.length > 0, 'deleting through the real repository wrote a tombstone');

  const tombArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });
  getDb().prepare('DELETE FROM sync_tombstones').run();
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sync_tombstones').get().n, 0, 'tombstones cleared before the restore');
  assert.equal(restoreBackupArchive(tombArchive, 'clave-larga-de-prueba').ok, true, 'restore ok');
  switchTo(gene.id);
  assert.deepEqual(
    getDb().prepare('SELECT table_name, row_key FROM sync_tombstones').all(),
    tombstoneRows,
    'the backup carried the deletions and the restore put them back'
  );
  assert.equal(entities.getPerson(doomed.personId), null, 'and the deleted person did not come back with it');

  // ── Schema compatibility across an app upgrade ──────────────────────────────
  // Every schema bump splits the world into installs that can read a backup and installs
  // that cannot. Both directions have to be safe: an older archive must still restore,
  // and a NEWER one must be refused outright rather than applied without the columns
  // this build does not know — a half-applied restore is how a library gets shredded.
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  // A released 3.2.7 archive has no global-library descriptor. Nodus 4 restores its
  // traditional vaults and leaves any current cross-vault Library untouched.
  const hiddenLibrary = `${globalLibraryRoot}.temporarily-hidden`;
  fs.renameSync(globalLibraryRoot, hiddenLibrary);
  const v327Archive = await createBackupArchive({ password: 'clave-v327', appVersion: '3.2.7' });
  fs.renameSync(hiddenLibrary, globalLibraryRoot);
  fs.writeFileSync(path.join(globalItem, 'reader.md'), '# Current v4 Library must survive\n');
  const v327Result = restoreBackupArchive(v327Archive, 'clave-v327');
  assert.equal(v327Result.ok, true, `a 3.2.7 backup restores: ${v327Result.message}`);
  assert.match(fs.readFileSync(path.join(globalItem, 'reader.md'), 'utf8'), /must survive/, 'a 3.2.7 archive does not erase the current Global Library');
  const compatArchive = await createBackupArchive({ password: 'clave-larga-de-prueba', appVersion: '9.9.9-test' });

  const rewriteSchemaVersion = (archiveBuffer, version) => {
    const zipped = new AdmZip(archiveBuffer);
    const outer = JSON.parse(zipped.readAsText('manifest.json'));
    outer.schemaVersion = version;
    zipped.updateFile('manifest.json', Buffer.from(JSON.stringify(outer)));
    return zipped.toBuffer();
  };

  switchTo(gene.id);
  const canaryBefore = entities.getPerson(bob.personId);
  assert.ok(canaryBefore, 'data present before the compatibility checks');

  const fromFuture = restoreBackupArchive(rewriteSchemaVersion(compatArchive, SCHEMA_VERSION + 1), 'clave-larga-de-prueba');
  assert.equal(fromFuture.ok, false, 'a backup from a newer schema is refused');
  assert.match(fromFuture.message, /esquema más reciente/, 'and says why, so the user knows to update');
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'the refusal left the live data untouched');

  // An archive from an older schema still restores: its database simply migrates on open.
  const fromPast = restoreBackupArchive(rewriteSchemaVersion(compatArchive, SCHEMA_VERSION - 1), 'clave-larga-de-prueba');
  assert.equal(fromPast.ok, true, `an older archive still restores: ${fromPast.message}`);
  switchTo(gene.id);
  assert.ok(entities.getPerson(bob.personId), 'and its contents are intact');

  // ── A wrong password refuses cleanly ────────────────────────────────────────
  const bad = restoreBackupArchive(archive, 'contraseña-incorrecta');
  assert.equal(bad.ok, false, 'wrong password rejected');

  closeDb();
  console.log('Multi-vault backup integrity test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
