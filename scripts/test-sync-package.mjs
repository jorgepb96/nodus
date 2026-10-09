// User-layer sync package: drives the REAL buildSyncPackage/mergeSyncPackage against
// two scratch databases ("machine A" and "machine B") built by the REAL migrations.
//
// The previous version of this test hand-wrote a 20-table schema and stubbed
// SCHEMA_VERSION to 28. Every assertion it made was true, but the schema it made them
// against was not the one that ships — which is why it never noticed that the whole
// teaching module was absent from the package, that `db_attachments.thumb` and
// `note_folders.summary` had silently stopped travelling, or that two machines creating
// the same academic year would deadlock sync permanently. Running against
// `runMigrations` is the point: coverage gaps now fail here instead of in the field.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-sync-package-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-sync-package.mjs'), '--electron-sync-package-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-sync-package-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const sync = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));
  const { databaseCellStorage } = require(path.join(repoRoot, 'shared/databaseCellStorage.ts'));
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));

  const makeDb = (name) => {
    const db = new Database(path.join(root, name));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
  };
  const useDb = (db) => {
    globalThis.__syncTestDb = db;
  };

  const dbA = makeDb('a.sqlite');
  const dbB = makeDb('b.sqlite');

  const PASS = 'frase-de-sincronizacion-de-prueba';
  const T0 = '2026-07-01T10:00:00.000Z';
  const T1 = '2026-07-05T10:00:00.000Z';
  const T2 = '2026-07-09T10:00:00.000Z';
  const ins = (db, table, row) => {
    row = { ...row };
    if (table === 'db_columns') row.updated_at ??= row.created_at;
    if (table === 'db_cells') {
      const source = db.prepare(
        'SELECT data_row.database_id, data_row.created_at, data_row.updated_at, property.type FROM db_rows data_row JOIN db_columns property ON property.id = ? WHERE data_row.id = ?',
      ).get(row.column_id, row.row_id);
      Object.assign(row, databaseCellStorage(source.type, row.value_text), {
        database_id: source.database_id,
        created_at: source.created_at,
        updated_at: source.updated_at,
      });
    }
    if (table === 'db_attachments' || table === 'db_relations') {
      row.database_id ??= db.prepare('SELECT database_id FROM db_rows WHERE id = ?').get(row.row_id).database_id;
      row.updated_at ??= row.created_at;
    }
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(row));
  };

  // ── Structural guard: every table must be classified ────────────────────────
  // A migration that adds a table now has to say whether it travels. Previously a new
  // table simply defaulted to "not synced" in silence, which is how docencia, the
  // writing workshop and the whole genealogy layer went missing without anyone noticing.
  useDb(dbA);
  const coverage = sync.describeSyncCoverage();
  assert.deepEqual(coverage.unclassified, [], 'every table is either synced or explicitly excluded');
  // A synced table with no usable identity would insert on the first sync and then
  // collide forever. `study_schedule_day_styles` is the live example: no primary key,
  // and its UNIQUE index is over an expression SQLite will not name.
  assert.deepEqual(coverage.unmergeable, [], 'every synced table has a mergeable identity');
  assert.ok(coverage.included.teaching?.includes('teaching_grade_entries'), 'the gradebook is carried');
  assert.ok(coverage.included.genealogy?.includes('archive_items'), 'the evidence archive is carried');
  assert.ok(coverage.included.writing?.includes('project_chapters'), 'writing workshop chapters are carried');
  assert.ok(coverage.included.protect?.includes('protect_copies'), 'Nodus Protect copies are carried');
  assert.ok(coverage.excluded.includes('passages'), 'corpus-derived data stays out');

  // ── Machine A: notes, a draft, a search, a verdict ──────────────────────────
  ins(dbA, 'note_folders', { id: 'f1', parent_id: null, name: 'Tesis', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(dbA, 'note_folders', { id: 'f2', parent_id: 'f1', name: 'Capítulo 1', order_idx: 0, created_at: T0, updated_at: T0, summary: 'resumen IA' });
  ins(dbA, 'notes', { id: 'n1', folder_id: 'f2', title: 'Nota A', kind: 'markdown', content: 'contenido A', order_idx: 0, created_at: T0, updated_at: T1 });
  ins(dbA, 'notes', { id: 'n2', folder_id: null, title: 'Compartida', kind: 'markdown', content: 'versión vieja de A', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(dbA, 'writing_saved_drafts', { id: 'd1', title: 'Borrador', brief_json: '{}', selection_json: '{}', draft_json: '{}', created_at: T0, updated_at: T1 });
  ins(dbA, 'saved_searches', { id: 's1', name: 'Memoria', query: 'memoria', mode: 'semantic', kinds_json: '[]', created_at: T0 });
  ins(dbA, 'edge_feedback', { from_id: 'iA', to_id: 'iB', type: 'contradicts', verdict: 'rejected', note: '', created_at: T2 });

  // ── Machine A: the writing workshop (was entirely absent from the package) ──
  ins(dbA, 'projects', { id: 'p1', title: 'Tesis doctoral', kind: 'thesis', brief: 'sobre turismo', created_at: T0, updated_at: T1 });
  ins(dbA, 'project_chapters', { id: 'ch1', project_id: 'p1', title: 'Introducción', original_text_hash: 'h', original_text: 'texto', current_markdown: '# Introducción', created_at: T0, updated_at: T1 });

  // ── Machine A: genealogy evidence (irreplaceable, and it never travelled) ───
  ins(dbA, 'persons', { person_id: 'per1', display_name: 'Antonia Ruiz', sex: 'female', created_at: T0, updated_at: T1 });
  ins(dbA, 'archive_items', { item_id: 'arc1', title: 'Partida de bautismo', blob: Buffer.from('SCAN-BYTES'), created_at: T0, updated_at: T1 });

  // ── Machine A: docencia, including a grade. The FK chain reaches study_* ────
  ins(dbA, 'study_academic_years', { id: 'yearA', short_id: 'YR-A', label: '2024/2025', start_date: '2024-09-01', end_date: '2025-06-30', created_at: T0, updated_at: T0 });
  ins(dbA, 'study_courses', { id: 'courseA', short_id: 'CUR-A', name: 'Historia', academic_year_id: 'yearA', created_at: T0, updated_at: T1 });
  ins(dbA, 'study_subjects', { id: 'subjA', short_id: 'SUB-A', course_id: 'courseA', name: 'Contemporánea', created_at: T0, updated_at: T1 });
  ins(dbA, 'teaching_groups', { id: 'grpA', short_id: 'GRP-A', name: 'Grupo 1', subject_id: 'subjA', academic_year_id: 'yearA', created_at: T0, updated_at: T1 });
  ins(dbA, 'teaching_students', { id: 'stuA', group_id: 'grpA', given_names: 'Luis', surnames: 'Pérez', pseudonym_code: 'STU_0001', created_at: T0, updated_at: T1 });
  ins(dbA, 'teaching_assessment_plans', { id: 'planA', short_id: 'PLN-A', subject_id: 'subjA', name: 'Plan', created_at: T0, updated_at: T1 });
  ins(dbA, 'teaching_assessment_items', { id: 'itemA', plan_id: 'planA', parent_id: null, name: 'Examen', weight: 100, created_at: T0, updated_at: T1 });
  ins(dbA, 'teaching_grade_entries', { id: 'geA', student_id: 'stuA', item_id: 'itemA', raw_value: 8.5, status: 'graded', created_at: T0, updated_at: T1 });

  // ── Machine A: study docs with binary payloads ─────────────────────────────
  ins(dbA, 'study_docs', { id: 'docShared', short_id: 'DOC-A', title: 'Tema 1', content_markdown: '# versión A', embedding: Buffer.from('EMBED-A'), created_at: T0, updated_at: T1 });

  // ── Machine A: protected copies, including a soft-delete marker ───────────
  ins(dbA, 'protect_copies', { id: 'pcShared', file_name: 'copia.pdf', mime_type: 'application/pdf', bytes: 8, sha256: 'hash-new', blob: Buffer.from('COPY-NEW'), source_kind: 'disk', source_label: 'Documento', created_at: T0, updated_at: T1, deleted_at: null });
  ins(dbA, 'protect_copies', { id: 'pcDeleted', file_name: 'borrada.png', mime_type: 'image/png', bytes: 0, sha256: 'hash-del', blob: null, source_kind: 'disk', source_label: null, created_at: T0, updated_at: T2, deleted_at: T2 });

  // ── Machine A: a database with an attachment blob AND a thumb ──────────────
  // `thumb` was added by migration 80 and was missing from the hand-written column
  // list, so it silently stopped travelling. Dynamic columns make that impossible.
  ins(dbA, 'db_databases', { id: 'dbShared', short_id: 'DB-A001', name: 'Muestras', position: 0, created_at: T0, updated_at: T1 });
  ins(dbA, 'db_columns', { id: 'colA', database_id: 'dbShared', name: 'Título', type: 'title', position: 0, created_at: T0 });
  ins(dbA, 'db_rows', { id: 'rowA', database_id: 'dbShared', position: 0, created_at: T0, updated_at: T1 });
  ins(dbA, 'db_cells', { row_id: 'rowA', column_id: 'colA', value_text: 'from A' });
  ins(dbA, 'db_attachments', { id: 'attA', row_id: 'rowA', column_id: 'colA', file_name: 'm.png', mime_type: 'image/png', bytes: 7, blob: Buffer.from('PNGDATA'), thumb: Buffer.from('THUMB!'), content_hash: 'h1', position: 0, created_at: T0 });

  // ── Machine B: its own work, plus a NEWER n2 and an OLDER verdict ───────────
  ins(dbB, 'notes', { id: 'n2', folder_id: null, title: 'Compartida', kind: 'markdown', content: 'versión nueva de B', order_idx: 0, created_at: T0, updated_at: T1 });
  ins(dbB, 'notes', { id: 'n3', folder_id: null, title: 'Solo B', kind: 'markdown', content: 'local de B', order_idx: 0, created_at: T0, updated_at: T0 });
  ins(dbB, 'edge_feedback', { from_id: 'iB', to_id: 'iA', type: 'contradicts', verdict: 'confirmed', note: '', created_at: T0 });
  ins(dbB, 'study_docs', { id: 'docShared', short_id: 'DOC-A', title: 'Tema local más nuevo', content_markdown: '# versión B', embedding: Buffer.from('EMBED-B'), created_at: T0, updated_at: T2 });
  ins(dbB, 'protect_copies', { id: 'pcShared', file_name: 'vieja.pdf', mime_type: 'application/pdf', bytes: 8, sha256: 'hash-old', blob: Buffer.from('COPY-OLD'), source_kind: 'disk', source_label: null, created_at: T0, updated_at: T0, deleted_at: null });
  ins(dbB, 'protect_copies', { id: 'pcDeleted', file_name: 'borrada.png', mime_type: 'image/png', bytes: 8, sha256: 'hash-del', blob: Buffer.from('COPY-OLD'), source_kind: 'disk', source_label: null, created_at: T0, updated_at: T0, deleted_at: null });
  ins(dbB, 'protect_copies', { id: 'pcLocal', file_name: 'local.png', mime_type: 'image/png', bytes: 5, sha256: 'hash-local', blob: Buffer.from('LOCAL'), source_kind: 'disk', source_label: null, created_at: T0, updated_at: T0, deleted_at: null });

  // ── Machine B: the SAME academic year, created independently ───────────────
  // Different id, byte-identical label. The UNIQUE index on `label` used to make the
  // insert fail, and because the merge was one transaction that aborted EVERYTHING —
  // notes, drafts, databases — permanently, in both directions.
  ins(dbB, 'study_academic_years', { id: 'yearB', short_id: 'YR-B', label: '2024/2025', start_date: '2024-09-01', end_date: '2025-06-30', created_at: T0, updated_at: T0 });

  // ── Machine B: the shared database, older, but with a row of its own ────────
  // The old engine replaced the whole tree when A was newer, deleting this row.
  ins(dbB, 'db_databases', { id: 'dbShared', short_id: 'DB-A001', name: 'Muestras (viejo)', position: 0, created_at: T0, updated_at: T0 });
  ins(dbB, 'db_columns', { id: 'colA', database_id: 'dbShared', name: 'Título', type: 'title', position: 0, created_at: T0 });
  ins(dbB, 'db_rows', { id: 'rowB', database_id: 'dbShared', position: 1, created_at: T0, updated_at: T0 });
  ins(dbB, 'db_cells', { row_id: 'rowB', column_id: 'colA', value_text: 'fila propia de B' });

  // ── Export from A, merge into B ────────────────────────────────────────────
  useDb(dbA);
  const pkg = sync.buildSyncPackage('test', PASS);
  assert.equal(pkg.counts.notes, 2, 'A exports its two notes');
  assert.equal(pkg.counts.teaching_grade_entries, 1, 'the gradebook is in the package');
  assert.equal(pkg.counts.persons, 1, 'genealogy persons are in the package');
  assert.equal(pkg.counts.projects, 1, 'writing projects are in the package');
  assert.equal(pkg.counts.protect_copies, 2, 'protected copies and soft-delete markers are in the package');

  // Every payload is its own zip entry — that is what keeps a vault full of recordings
  // from ever becoming one buffer larger than V8's maximum string length — and every one
  // of them is encrypted.
  const AdmZip = require('adm-zip');
  const builtZip = new AdmZip(pkg.buffer);
  const entries = builtZip.getEntries().map((e) => e.entryName);
  assert.ok(entries.length > 10, 'the package is split into many entries, not one blob');
  assert.deepEqual(
    entries.filter((name) => name !== 'manifest.json' && name !== 'index.bin' && !name.startsWith('e/')),
    [],
    'nothing sits outside the manifest, the index and the opaque sealed entries'
  );
  // The zip directory must not disclose what the file contains. A package sitting in a
  // shared folder should not announce that it holds a gradebook.
  assert.ok(!entries.some((name) => /teaching|grade|persons|archive/i.test(name)), 'entry names reveal no table names');
  // Checked on the DECOMPRESSED entry bytes, not on the raw file: a zip deflates its
  // entries, so searching the file as a whole would pass even with no encryption at all.
  const decompressed = builtZip
    .getEntries()
    .filter((entry) => entry.entryName !== 'manifest.json')
    .map((entry) => entry.getData().toString('latin1'))
    .join('\u0001');
  assert.ok(!decompressed.includes('teaching_grade_entries'), 'no table name is readable inside the package');
  assert.ok(!decompressed.includes('Pérez'), 'a student surname is not readable');
  assert.ok(!decompressed.includes('SCAN-BYTES'), 'the bytes of an archived scan are not readable');
  assert.ok(!decompressed.includes('contenido A'), 'nor the text of a note');
  // The manifest stays readable so an incompatible or ancient package can be refused
  // without asking for a passphrase.
  const builtManifest = JSON.parse(builtZip.readAsText('manifest.json'));
  assert.equal(builtManifest.formatVersion, 3, 'packages are written encrypted');
  // The wire version: the last migration that changed a table (see syncSchemaVersion.ts).
  const { SYNC_SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/syncSchemaVersion.ts'));
  assert.equal(builtManifest.schemaVersion, SYNC_SCHEMA_VERSION);
  assert.equal(builtManifest.kdf.name, 'scrypt');
  assert.equal(builtManifest.counts, undefined, 'row counts are not exposed in the clear');

  // Without the passphrase there is nothing to be had.
  assert.throws(() => sync.mergeSyncPackage(pkg.buffer), /cifrado|frase/i, 'importing without a passphrase is refused');
  assert.throws(() => sync.mergeSyncPackage(pkg.buffer, 'otra-frase-distinta'), /descifrar|frase/i, 'a wrong passphrase is refused');

  useDb(dbB);
  const summary = sync.mergeSyncPackage(pkg.buffer, PASS);
  assert.deepEqual(summary.conflicts, [], `merge is clean: ${JSON.stringify(summary.conflicts)}`);
  assert.deepEqual(summary.unknownTables, [], 'both machines understand every table');
  assert.deepEqual(summary.protectCopies, { inserted: 0, updated: 2, skipped: 0 }, 'newer protected copy and soft-delete marker win');

  // The gradebook arrived — the headline gap.
  assert.equal(dbB.prepare("SELECT raw_value FROM teaching_grade_entries WHERE id = 'geA'").get().raw_value, 8.5, 'the grade travelled');
  assert.equal(dbB.prepare("SELECT surnames FROM teaching_students WHERE id = 'stuA'").get().surnames, 'Pérez', 'the student travelled');
  assert.equal(dbB.prepare("SELECT title FROM projects WHERE id = 'p1'").get().title, 'Tesis doctoral', 'the writing project travelled');
  assert.equal(dbB.prepare("SELECT display_name FROM persons WHERE person_id = 'per1'").get().display_name, 'Antonia Ruiz', 'the person travelled');
  assert.equal(dbB.prepare("SELECT blob FROM archive_items WHERE item_id = 'arc1'").get().blob.toString(), 'SCAN-BYTES', 'evidence bytes travelled intact');
  assert.equal(dbB.prepare("SELECT summary FROM note_folders WHERE id = 'f2'").get().summary, 'resumen IA', 'folder summary travels (was dropped by the hand-written column list)');
  assert.equal(dbB.prepare("SELECT thumb FROM db_attachments WHERE id = 'attA'").get().thumb.toString(), 'THUMB!', 'attachment thumb travels (added by a later migration)');
  assert.equal(dbB.prepare("SELECT blob FROM db_attachments WHERE id = 'attA'").get().blob.toString(), 'PNGDATA', 'attachment bytes are byte-exact');
  assert.equal(dbB.prepare("SELECT blob FROM protect_copies WHERE id = 'pcShared'").get().blob.toString(), 'COPY-NEW', 'protected-copy bytes travel intact');
  assert.equal(dbB.prepare("SELECT blob FROM protect_copies WHERE id = 'pcDeleted'").get().blob, null, 'a protected-copy soft delete clears its BLOB');
  assert.equal(dbB.prepare("SELECT blob FROM protect_copies WHERE id = 'pcLocal'").get().blob.toString(), 'LOCAL', 'a local protected copy absent from the package remains');

  // The duplicate academic year reconciled instead of bricking: one row, and A's
  // course now points at B's local id.
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM study_academic_years WHERE label = '2024/2025'").get().n, 1, 'the duplicated year merged into one');
  assert.equal(dbB.prepare("SELECT academic_year_id FROM study_courses WHERE id = 'courseA'").get().academic_year_id, 'yearB', "A's course follows the remapped year id");
  assert.equal(dbB.prepare("SELECT academic_year_id FROM teaching_groups WHERE id = 'grpA'").get().academic_year_id, 'yearB', 'the teaching group follows it too');

  // Row-level database merge: A's newer database no longer destroys B's own row.
  assert.equal(dbB.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowB'").get().value_text, 'fila propia de B', "B's row survives a newer incoming database");
  assert.equal(dbB.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowA'").get().value_text, 'from A', "A's row arrived");
  assert.equal(dbB.prepare("SELECT name FROM db_databases WHERE id = 'dbShared'").get().name, 'Muestras', 'the newer database name won');

  // Newest-wins and nothing local deleted.
  assert.equal(dbB.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'local newer content preserved');
  assert.equal(dbB.prepare("SELECT folder_id FROM notes WHERE id = 'n1'").get().folder_id, 'f2', 'note keeps its folder');
  assert.equal(dbB.prepare("SELECT parent_id FROM note_folders WHERE id = 'f2'").get().parent_id, 'f1', 'hierarchy preserved');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'nothing local deleted');
  // The verdict is about an unordered pair: A stored it as iA→iB, B as iB→iA. It must
  // stay ONE row, taking the newer judgement, not two rows that disagree forever.
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM edge_feedback').get().n, 1, 'the reversed pair did not become a second row');
  assert.equal(dbB.prepare('SELECT verdict FROM edge_feedback').get().verdict, 'rejected', 'newer verdict adopted (direction-agnostic)');
  assert.equal(dbB.prepare("SELECT title FROM study_docs WHERE id = 'docShared'").get().title, 'Tema local más nuevo', 'newer local study row preserved');
  assert.equal(dbB.prepare("SELECT embedding FROM study_docs WHERE id = 'docShared'").get().embedding.toString(), 'EMBED-B', 'newer local embedding stays byte-exact');

  // ── Idempotence ────────────────────────────────────────────────────────────
  const again = sync.mergeSyncPackage(pkg.buffer, PASS);
  const applied = Object.values(again.groups).reduce((sum, c) => sum + c.inserted + c.updated, 0);
  assert.equal(applied, 0, 'a second merge of the same package changes nothing');
  assert.deepEqual(again.conflicts, [], 're-merging produces no conflicts');
  assert.deepEqual(again.protectCopies, { inserted: 0, updated: 0, skipped: 2 }, 'protected-copy merge is idempotent');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 3, 'row counts stable');
  assert.equal(dbB.prepare("SELECT COUNT(*) AS n FROM study_academic_years").get().n, 1, 'the remap is stable across merges');

  // ── Reverse direction ──────────────────────────────────────────────────────
  useDb(dbB);
  const pkgB = sync.buildSyncPackage('test', PASS);
  useDb(dbA);
  const back = sync.mergeSyncPackage(pkgB.buffer, PASS);
  assert.deepEqual(back.conflicts, [], `reverse merge is clean: ${JSON.stringify(back.conflicts)}`);
  assert.equal(dbA.prepare("SELECT content FROM notes WHERE id = 'n2'").get().content, 'versión nueva de B', 'A converges to the newest n2');
  assert.equal(dbA.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = 'n3'").get().n, 1, "B's note reached A");
  assert.equal(dbA.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowB'").get().value_text, 'fila propia de B', "B's database row reached A");
  // A had 'yearA'; B's package carries the merged year under B's id. Both survive as
  // one row per label — the merge must not resurrect a duplicate on the way back.
  assert.equal(dbA.prepare("SELECT COUNT(*) AS n FROM study_academic_years WHERE label = '2024/2025'").get().n, 1, 'no duplicate year on the way back');

  // ── An edited typed cell travels with its own revision timestamp ───────────
  useDb(dbA);
  dbmode.setCell('rowA', 'colA', 'editado en A');
  const editPkg = sync.buildSyncPackage('test', PASS);
  useDb(dbB);
  const editSummary = sync.mergeSyncPackage(editPkg.buffer, PASS);
  assert.deepEqual(editSummary.conflicts, [], 'the cell edit merges cleanly');
  assert.equal(
    dbB.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowA' AND column_id = 'colA'").get().value_text,
    'editado en A',
    'an edited cell reaches the other machine via its row timestamp'
  );
  assert.equal(
    dbB.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowB'").get().value_text,
    'fila propia de B',
    "B's own cell is still untouched"
  );

  // ── Clock skew: only the dangerous direction is detectable, and it is reported ──
  // A package dated in the past is indistinguishable from one made by a slow clock, so
  // it is not guessed at. A package dated in the FUTURE can only be a fast clock, and
  // that machine wins every comparison it takes part in.
  const skewed = new AdmZip(pkg.buffer);
  const skewedManifest = JSON.parse(skewed.readAsText('manifest.json'));
  skewedManifest.date = new Date(Date.now() + 3 * 3600e3).toISOString();
  skewed.updateFile('manifest.json', Buffer.from(JSON.stringify(skewedManifest)));
  useDb(dbB);
  const skewResult = sync.mergeSyncPackage(skewed.toBuffer(), PASS);
  assert.ok(skewResult.clockSkewAheadMs > 2.5 * 3600e3, 'a clock running ahead is measured');
  assert.ok(skewResult.clockSkewAheadMs < 3.5 * 3600e3, 'and measured about right');
  // An ordinary package reports nothing, and an OLD one is not mistaken for skew.
  assert.equal(sync.mergeSyncPackage(pkg.buffer, PASS).clockSkewAheadMs, 0, 'a fresh package reports no skew');
  const oldPkg = new AdmZip(pkg.buffer);
  const oldPkgManifest = JSON.parse(oldPkg.readAsText('manifest.json'));
  oldPkgManifest.date = new Date(Date.now() - 5 * 86400e3).toISOString();
  oldPkg.updateFile('manifest.json', Buffer.from(JSON.stringify(oldPkgManifest)));
  assert.equal(sync.mergeSyncPackage(oldPkg.toBuffer(), PASS).clockSkewAheadMs, 0, 'an old package is not reported as skew');

  // ── A pre-existing inconsistency is never "fixed" by deleting user rows ────
  // The foreign-key sweep that keeps a bad row from aborting the merge must only ever
  // remove rows THIS merge inserted. Otherwise importing an unrelated package would
  // silently delete data that was already there.
  const dbD = makeDb('d.sqlite');
  dbD.pragma('foreign_keys = OFF');
  ins(dbD, 'projects', { id: 'pOrphan', title: 'Proyecto huérfano', created_at: T0, updated_at: T0 });
  ins(dbD, 'project_chapters', { id: 'chOrphan', project_id: 'noExiste', title: 'Capítulo huérfano', original_text_hash: 'h', original_text: 't', current_markdown: '#', created_at: T0, updated_at: T0 });
  dbD.pragma('foreign_keys = ON');
  useDb(dbD);
  sync.mergeSyncPackage(pkg.buffer, PASS);
  assert.equal(
    dbD.prepare("SELECT COUNT(*) AS n FROM project_chapters WHERE id = 'chOrphan'").get().n,
    1,
    'a row that was already dangling before the import is left alone'
  );
  assert.equal(dbD.prepare("SELECT COUNT(*) AS n FROM projects WHERE id = 'p1'").get().n, 1, 'the import still applied');
  dbD.close();

  // ── A newer schema is refused, not silently truncated ──────────────────────
  const future = new AdmZip(pkg.buffer);
  const futureManifest = JSON.parse(future.readAsText('manifest.json'));
  futureManifest.schemaVersion = SCHEMA_VERSION + 5;
  future.updateFile('manifest.json', Buffer.from(JSON.stringify(futureManifest)));
  assert.throws(
    () => sync.mergeSyncPackage(future.toBuffer(), PASS),
    /más reciente/,
    'a package from a newer schema is refused instead of dropping its unknown columns'
  );

  // ── Tampered and unreadable packages are refused ───────────────────────────
  // Every entry is authenticated, so altering one byte of any payload is caught rather
  // than merged as if it were the user's data.
  const tampered = new AdmZip(pkg.buffer);
  const sealedName = tampered.getEntries().map((e) => e.entryName).find((name) => name.startsWith('e/'));
  const sealedBytes = Buffer.from(tampered.getEntry(sealedName).getData());
  sealedBytes[sealedBytes.length - 1] ^= 0xff;
  tampered.updateFile(sealedName, sealedBytes);
  assert.throws(() => sync.mergeSyncPackage(tampered.toBuffer(), PASS), /.+/, 'a flipped byte in a sealed entry is caught');

  const noIndex = new AdmZip(pkg.buffer);
  noIndex.deleteFile('index.bin');
  assert.throws(() => sync.mergeSyncPackage(noIndex.toBuffer(), PASS), /índice/, 'a missing index is reported');
  assert.throws(() => sync.mergeSyncPackage(Buffer.from('garbage'), PASS), /ilegible|inválido/i, 'garbage rejected');

  // ── v2 packages (plaintext, one entry per table) remain readable ───────────
  // Written by the previous build. Refusing them would strand that work on whichever
  // machine produced the file.
  const dbV2 = makeDb('v2.sqlite');
  const v2 = new AdmZip();
  const v2Blob = Buffer.from('ADJUNTO-V2');
  const v2BlobHash = require('node:crypto').createHash('sha256').update(v2Blob).digest('hex');
  v2.addFile(`blobs/${v2BlobHash}`, v2Blob);
  v2.addFile('tables/notes.json', Buffer.from(JSON.stringify([
    { id: 'v2note', folder_id: null, title: 'De un paquete v2', kind: 'markdown', content: 'texto v2', order_idx: 0, created_at: T0, updated_at: T0 },
  ])));
  v2.addFile('tables/db_databases.json', Buffer.from(JSON.stringify([
    { id: 'dbV2', short_id: 'DB-V2001', name: 'Heredada v2', icon: null, position: 0, created_at: T0, updated_at: T0 },
  ])));
  v2.addFile('tables/db_columns.json', Buffer.from(JSON.stringify([
    { id: 'colV2', database_id: 'dbV2', name: 'T', type: 'title', position: 0, config_json: null, created_at: T0 },
  ])));
  v2.addFile('tables/db_rows.json', Buffer.from(JSON.stringify([
    { id: 'rowV2', database_id: 'dbV2', position: 0, created_at: T0, updated_at: T0 },
  ])));
  v2.addFile('tables/db_attachments.json', Buffer.from(JSON.stringify([
    { id: 'attV2', row_id: 'rowV2', column_id: 'colV2', file_name: 'a.bin', mime_type: null, bytes: v2Blob.length, blob: { __nodusBlob: v2BlobHash }, content_hash: null, extracted_text: null, description: null, position: 0, created_at: T0, ai_generated: 0, ai_prompt: null, thumb: null },
  ])));
  v2.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'nodus.sync-package',
    formatVersion: 2,
    schemaVersion: SCHEMA_VERSION,
    appVersion: 'previa',
    date: T0,
    counts: { notes: 1, db_databases: 1, db_columns: 1, db_rows: 1, db_attachments: 1 },
  })));
  useDb(dbV2);
  const v2Summary = sync.mergeSyncPackage(v2.toBuffer());
  assert.deepEqual(v2Summary.conflicts, [], 'a v2 package merges cleanly, with no passphrase');
  assert.equal(dbV2.prepare("SELECT content FROM notes WHERE id = 'v2note'").get().content, 'texto v2', 'v2 rows import');
  assert.equal(
    dbV2.prepare("SELECT blob FROM db_attachments WHERE id = 'attV2'").get().blob.toString(),
    'ADJUNTO-V2',
    'v2 blobs, stored under their hash in the clear, still resolve'
  );
  dbV2.close();

  // ── v1 packages remain readable ────────────────────────────────────────────
  // Users may still hold packages written by the previous format.
  const dbC = makeDb('c.sqlite');
  const legacy = new AdmZip();
  legacy.addFile(
    'manifest.json',
    Buffer.from(JSON.stringify({
      format: 'nodus.sync-package',
      formatVersion: 1,
      schemaVersion: SCHEMA_VERSION,
      appVersion: 'old',
      date: T0,
      counts: { notes: 1 },
    }))
  );
  legacy.addFile(
    'user-layer.json',
    Buffer.from(JSON.stringify({
      notes: [{ id: 'legacy1', folder_id: null, title: 'Antigua', kind: 'markdown', content: 'de un paquete v1', order_idx: 0, created_at: T0, updated_at: T0 }],
      databases: [{
        database: { id: 'dbLegacy', short_id: 'DB-L001', name: 'Heredada', icon: null, position: 0, created_at: T0, updated_at: T0 },
        columns: [{ id: 'colL', database_id: 'dbLegacy', name: 'T', type: 'title', position: 0, config_json: null, created_at: T0 }],
        options: [], rows: [{ id: 'rowL', database_id: 'dbLegacy', position: 0, created_at: T0, updated_at: T0 }],
        cells: [{ row_id: 'rowL', column_id: 'colL', value_text: 'valor v1' }],
        attachments: [{ id: 'attL', row_id: 'rowL', column_id: 'colL', file_name: 'a.bin', mime_type: null, bytes: 3, blob_b64: Buffer.from('OLD').toString('base64'), content_hash: null, extracted_text: null, description: null, ai_generated: 0, ai_prompt: null, position: 0, created_at: T0 }],
        relations: [], views: [],
      }],
    }))
  );
  useDb(dbC);
  const legacySummary = sync.mergeSyncPackage(legacy.toBuffer(), PASS);
  assert.deepEqual(legacySummary.conflicts, [], 'a v1 package merges cleanly');
  assert.equal(dbC.prepare("SELECT content FROM notes WHERE id = 'legacy1'").get().content, 'de un paquete v1', 'v1 notes still import');
  assert.equal(dbC.prepare("SELECT value_text FROM db_cells WHERE row_id = 'rowL'").get().value_text, 'valor v1', 'v1 nested databases are flattened correctly');
  assert.equal(dbC.prepare("SELECT blob FROM db_attachments WHERE id = 'attL'").get().blob.toString(), 'OLD', 'v1 base64 blobs decode');

  dbA.close();
  dbB.close();
  dbC.close();
  console.log('sync package (two-machine merge, real schema) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Load real .ts modules with electron stubbed and `db/database` pointed at a
 *  switchable test connection, so the merge runs against migration-built schemas. */
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const databaseStub = path.join(userDataPath, 'stub-database.js');
  fs.writeFileSync(
    databaseStub,
    "const { SCHEMA_VERSION } = require(" + JSON.stringify(path.join(repoRoot, 'electron/db/migrations.ts')) + ");\n" +
      'exports.getDb = () => globalThis.__syncTestDb;\n' +
      'exports.closeDb = () => {};\n' +
      'exports.SCHEMA_VERSION = SCHEMA_VERSION;\n'
  );

  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    // Any import of the real database module gets the switchable stub instead.
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
