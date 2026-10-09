// Deleting works from a vault is the one operation that can destroy a reader's corpus,
// and the risk is not the work being deleted — it is everything that is NOT.
//
// Analysis in Nodus is only partly owned by a work. Ideas are GLOBAL rows: the same idea
// can occur in several works and carries the shared embedding, so it must outlive any
// single work. Passages and the document profiles hang off a work id through a foreign
// key and cascade, while other tables reach a work through a polymorphic (kind, id) pair
// that also names notes, people and archive items. A careless delete therefore either
// (a) leaves the deleted work's rows behind, (b) takes a surviving work's analysis with
// it, or (c) destroys an idea two works share.
//
// These tests seed TWO works with overlapping analysis and delete one, asserting:
//   1. nothing that names the deleted work survives anywhere in the schema;
//   2. every row that names the surviving work is byte-identical afterwards;
//   3. analysis the two works share is kept — never deleted, never split;
//   4. a batch that fails partway leaves every work intact (one transaction);
//   5. a work being analysed right now is refused instead of deleted underneath itself;
//   6. the schema cannot grow a column that names works without someone deciding how a
//      delete reaches it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-work-deletion-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-work-deletion-'));
const { installRuntimeHooks } = require(path.join(repoRoot, 'scripts/lib/tsRuntimeHooks.mjs'));
installRuntimeHooks(root);
const { readSource, assertChannelsWired, assertApiMethods } = require(path.join(repoRoot, 'scripts/ipc-channel-census.mjs'));

const database = require(path.join(repoRoot, 'electron/db/database.ts'));
const {
  deleteWorks, worksRunningNow,
  WORK_SCOPED_DELETES, GRAPH_PURGED_COLUMNS, WORK_REFERENCE_EXCEPTIONS,
} = require(path.join(repoRoot, 'electron/db/workDeletion.ts'));

const A = 'work-a';
const B = 'work-b';
const VAULT = 'vault-1';
const now = () => new Date().toISOString();

// ── Seeding ────────────────────────────────────────────────────────────────────
//
// One corpus, two works, deliberately overlapping: g-shared occurs in both, t-shared is
// a theme of both, au-shared authored both, and B's provenance says its analysis was
// imported FROM A. Deleting A must leave every one of those B-facing rows untouched.

function seedCorpus(db) {
  const stamp = now();
  const insertWork = db.prepare(`INSERT INTO works(
    nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,
    light_status,deep_status,summary_status
  ) VALUES(?,?,?,?,?,?,?,0,'done','done','done')`);
  insertWork.run(A, 'ZA', 'Obra A', '["Autora A"]', 2024, 'book', 'pdf');
  insertWork.run(B, 'ZB', 'Obra B', '["Autor B"]', 2025, 'book', 'pdf');

  // Global ideas. g-shared is the case the whole design exists for.
  const idea = db.prepare('INSERT INTO ideas(global_id,type,label,statement,embedding,created_at) VALUES(?,?,?,?,?,?)');
  idea.run('g-a-only', 'claim', 'Idea solo de A', 'statement', Buffer.from([1, 2, 3]), stamp);
  idea.run('g-shared', 'claim', 'Idea compartida', 'statement', Buffer.from([9, 9, 9]), stamp);
  idea.run('g-b-only', 'claim', 'Idea solo de B', 'statement', Buffer.from([4, 5, 6]), stamp);
  // A manual idea belongs to a note and may legitimately have no occurrence at all: a
  // delete must never mark it dormant or remove it.
  idea.run('g-manual', 'claim', 'Idea manual', 'statement', Buffer.from([7, 7, 7]), stamp);
  db.prepare('INSERT INTO notes(id,title,kind,content,source_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('note-manual', 'Nota', 'markdown', '', JSON.stringify({ note: 'manual-idea', ref: 'g-manual' }), stamp, stamp);

  const occurrence = db.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES(?,?,?,?,?)');
  occurrence.run('g-a-only', A, 'principal', 'dev', 1);
  occurrence.run('g-shared', A, 'principal', 'dev', 1);
  occurrence.run('g-shared', B, 'supporting', 'dev', 0.8);
  occurrence.run('g-b-only', B, 'principal', 'dev', 1);

  const evidence = db.prepare('INSERT INTO evidence(id,global_id,nodus_id,quote,location,kind) VALUES(?,?,?,?,?,?)');
  evidence.run('ev-a', 'g-a-only', A, 'cita A', 'p. 1', 'quote');
  evidence.run('ev-shared-a', 'g-shared', A, 'cita compartida A', 'p. 2', 'quote');
  evidence.run('ev-shared-b', 'g-shared', B, 'cita compartida B', 'p. 3', 'quote');
  evidence.run('ev-b', 'g-b-only', B, 'cita B', 'p. 4', 'quote');

  const edge = db.prepare('INSERT INTO edges(id,from_id,to_id,type,basis,confidence,source_work) VALUES(?,?,?,?,?,?,?)');
  const trace = db.prepare('INSERT INTO edge_traces(edge_id,method,rationale,created_at) VALUES(?,?,?,?)');
  edge.run('edge-a', 'g-a-only', 'g-shared', 'supports', 'b', 1, A);
  trace.run('edge-a', 'deep', 'r', stamp);
  edge.run('edge-b', 'g-b-only', 'g-shared', 'supports', 'b', 1, B);
  trace.run('edge-b', 'deep', 'r', stamp);
  // A cross-work bridge between A's and B's ideas: recomputable, so it goes with the
  // idea that went dormant instead of surviving as a relation to nothing.
  edge.run('reproc:bridge', 'g-a-only', 'g-b-only', 'relates', 'b', 0.5, null);
  trace.run('reproc:bridge', 'bridge', 'r', stamp);

  const theme = db.prepare('INSERT INTO themes(theme_id,label,created_at,pinned) VALUES(?,?,?,0)');
  theme.run('t-a', 'Tema A', stamp);
  theme.run('t-shared', 'Tema compartido', stamp);
  theme.run('t-b', 'Tema B', stamp);
  const workTheme = db.prepare('INSERT INTO work_themes(nodus_id,theme_id) VALUES(?,?)');
  workTheme.run(A, 't-a'); workTheme.run(A, 't-shared');
  workTheme.run(B, 't-shared'); workTheme.run(B, 't-b');
  const themeLink = db.prepare('INSERT INTO idea_theme_links(nodus_id,global_id,theme_id,confidence,basis) VALUES(?,?,?,?,?)');
  themeLink.run(A, 'g-a-only', 't-a', 1, 'explicit');
  themeLink.run(A, 'g-shared', 't-shared', 1, 'explicit');
  themeLink.run(B, 'g-shared', 't-shared', 1, 'explicit');
  themeLink.run(B, 'g-b-only', 't-b', 1, 'explicit');

  const author = db.prepare('INSERT INTO authors(author_id,name,canonical_key) VALUES(?,?,?)');
  author.run('au-a', 'Autora A', 'autora a');
  author.run('au-shared', 'Autor Compartido', 'autor compartido');
  author.run('au-b', 'Autor B', 'autor b');
  const workAuthor = db.prepare('INSERT INTO work_authors(nodus_id,author_id,role) VALUES(?,?,?)');
  workAuthor.run(A, 'au-a', 'author'); workAuthor.run(A, 'au-shared', 'author');
  workAuthor.run(B, 'au-shared', 'author'); workAuthor.run(B, 'au-b', 'author');

  const passage = db.prepare(`INSERT INTO passages(
    passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,embedding,
    embedding_provider,embedding_model,embedding_dim,embedding_text_hash,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  passage.run(`${A}#0`, A, 0, 'pasaje A 0', 'p. 1', 11, 'h-a0', Buffer.from([1]), 'p', 'm', 1, 'h-a0', stamp);
  passage.run(`${A}#1`, A, 1, 'pasaje A 1', 'p. 2', 11, 'h-a1', Buffer.from([2]), 'p', 'm', 1, 'h-a1', stamp);
  passage.run(`${B}#0`, B, 0, 'pasaje B 0', 'p. 1', 11, 'h-b0', Buffer.from([3]), 'p', 'm', 1, 'h-b0', stamp);

  const summary = db.prepare(`INSERT INTO work_summaries(
    nodus_id,summary,source_level,content_hash,embedding,embedding_provider,embedding_model,
    embedding_dim,embedding_text_hash,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  summary.run(A, 'Resumen A', 'deep', 'hs-a', Buffer.from([1]), 'p', 'm', 1, 'hs-a', stamp, stamp);
  summary.run(B, 'Resumen B', 'deep', 'hs-b', Buffer.from([2]), 'p', 'm', 1, 'hs-b', stamp, stamp);

  const synthesis = db.prepare('INSERT INTO work_idea_synthesis(nodus_id,thesis,generated_at) VALUES(?,?,?)');
  synthesis.run(A, 'tesis A', stamp);
  synthesis.run(B, 'tesis B', stamp);

  const alias = db.prepare('INSERT INTO work_aliases(nodus_id,zotero_key) VALUES(?,?)');
  alias.run(A, 'ZA-old'); alias.run(B, 'ZB-old');

  db.prepare('INSERT INTO collections(collection_key,name) VALUES(?,?)').run('col-a', 'Colección A');
  db.prepare('INSERT INTO collections(collection_key,name) VALUES(?,?)').run('col-b', 'Colección B');
  const workCollection = db.prepare('INSERT INTO work_collections(nodus_id,collection_key) VALUES(?,?)');
  workCollection.run(A, 'col-a'); workCollection.run(B, 'col-b');

  db.prepare('INSERT INTO zotero_tags(tag_id,label,normalized_label) VALUES(?,?,?)').run(1, 'etiqueta-a', 'etiqueta-a');
  db.prepare('INSERT INTO zotero_tags(tag_id,label,normalized_label) VALUES(?,?,?)').run(2, 'etiqueta-b', 'etiqueta-b');
  const workTag = db.prepare('INSERT INTO work_zotero_tags(nodus_id,tag_id) VALUES(?,?)');
  workTag.run(A, 1); workTag.run(B, 2);

  const checkpoint = db.prepare('INSERT INTO scan_checkpoints(nodus_id,content_hash,kind,batch_index,data_json,created_at) VALUES(?,?,?,?,?,?)');
  checkpoint.run(A, 'ch-a', 'deep_chunk', 0, '{}', stamp);
  checkpoint.run(B, 'ch-b', 'deep_chunk', 0, '{}', stamp);

  const textSource = db.prepare(`INSERT INTO work_text_sources(
    nodus_id,source_ref,origin,source_type,display_name,content_hash,char_count,
    has_page_markers,ordinal,active,resolved_at
  ) VALUES(?,?,?,?,?,?,?,0,0,1,?)`);
  textSource.run(A, 'zotero:user:0:ZA', 'local_attachment', 'pdf', 'a.pdf', 'ts-a', 100, stamp);
  textSource.run(B, 'zotero:user:0:ZB', 'local_attachment', 'pdf', 'b.pdf', 'ts-b', 100, stamp);

  const gap = db.prepare('INSERT INTO gaps(id,nodus_id,related_idea,kind,statement,confidence) VALUES(?,?,?,?,?,?)');
  gap.run('gap-a', A, 'g-a-only', 'empirical', 'hueco A', 1);
  gap.run('gap-b', B, 'g-b-only', 'empirical', 'hueco B', 1);

  const externalRef = db.prepare('INSERT INTO external_refs(id,nodus_id,from_idea,cited_work,type,basis,confidence) VALUES(?,?,?,?,?,?,?)');
  externalRef.run('er-a', A, 'g-a-only', 'Otra obra citada', 'cita', 'b', 1);
  externalRef.run('er-b', B, 'g-b-only', 'Otra obra citada', 'cita', 'b', 1);

  const freshness = db.prepare('INSERT INTO library_analysis_freshness(work_id,component,freshness,updated_at) VALUES(?,?,?,?)');
  freshness.run(A, 'deep', 'current', stamp);
  freshness.run(B, 'deep', 'current', stamp);

  const provenance = db.prepare(`INSERT INTO library_analysis_provenance(
    work_id,component,document_fingerprint,pipeline_version,model_fingerprint,output_fingerprint,
    source_vault_id,source_work_id,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  provenance.run(A, 'deep', 'fp-a', '1', 'mf', 'of', null, A, stamp);
  // B imported its analysis FROM A. This row is B's own provenance and must survive A's
  // deletion untouched — this is exactly the "another work's data" case.
  provenance.run(B, 'deep', 'fp-b', '1', 'mf', 'of', 'other-vault', A, stamp);

  // `scope='vault'` makes library_item_id a work id; `scope='global'` makes the same
  // string a Global Library item id, which must not be touched.
  const wsLink = db.prepare('INSERT INTO workspace_library_links(owner_kind,owner_id,library_item_id,scope,label,created_at) VALUES(?,?,?,?,?,?)');
  wsLink.run('note', 'note-manual', A, 'vault', null, stamp);
  wsLink.run('note', 'note-manual', B, 'vault', null, stamp);
  wsLink.run('note', 'note-manual', A, 'global', null, stamp);

  const dictEvidence = db.prepare(`INSERT INTO dictionary_evidence(
    entry_id,kind,ref_id,decision,work_id,works_json,first_seen_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`);
  dictEvidence.run('entry-1', 'idea', 'g-a-only', 'included', A, JSON.stringify([{ id: A }, { id: B }]), stamp, stamp);
  dictEvidence.run('entry-2', 'idea', 'g-b-only', 'included', B, JSON.stringify([{ id: B }]), stamp, stamp);

  const progress = db.prepare('INSERT INTO study_progress(target_kind,target_id,status,updated_at) VALUES(?,?,?,?)');
  progress.run('work', A, 'done', stamp);
  progress.run('work', B, 'done', stamp);

  const recordEvidence = db.prepare('INSERT INTO record_evidence(id,target_kind,target_id,nodus_id,source_kind,created_at) VALUES(?,?,?,?,?,?)');
  recordEvidence.run('re-a', 'person', 'person-1', A, 'work', stamp);
  recordEvidence.run('re-b', 'person', 'person-2', B, 'work', stamp);

  // The document profile family: the subtree is behind cascading foreign keys, and this
  // is where a work's document embeddings live.
  const state = db.prepare('INSERT INTO document_profile_state(nodus_id,status,updated_at) VALUES(?,?,?)');
  state.run(A, 'current', stamp);
  state.run(B, 'current', stamp);
  const version = db.prepare(`INSERT INTO document_profile_versions(
    version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,presentation_language,
    overview,profile_json,prompt_hash,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  version.run('v-a', A, 'current', 'sf-a', '1', 1, 'es', 'resumen A', '{}', 'ph', stamp);
  version.run('v-b', B, 'current', 'sf-b', '1', 1, 'es', 'resumen B', '{}', 'ph', stamp);
  const vector = db.prepare('INSERT INTO document_vectors(vector_id,nodus_id,version_id,kind,text,text_hash,embedding,created_at) VALUES(?,?,?,?,?,?,?,?)');
  vector.run('vec-a', A, 'v-a', 'overview', 'texto A', 'th-a', Buffer.from([1]), stamp);
  vector.run('vec-b', B, 'v-b', 'overview', 'texto B', 'th-b', Buffer.from([2]), stamp);
  const ideaLink = db.prepare('INSERT INTO document_idea_links(version_id,nodus_id,global_id,target_kind,target_id,role,score,created_at) VALUES(?,?,?,?,?,?,?,?)');
  ideaLink.run('v-a', A, 'g-shared', 'section', 's-a', 'principal', 1, stamp);
  ideaLink.run('v-b', B, 'g-shared', 'section', 's-b', 'principal', 1, stamp);
  const override = db.prepare('INSERT INTO document_profile_overrides(override_id,nodus_id,field_path,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  override.run('ov-a', A, 'title', '"A"', stamp, stamp);
  override.run('ov-b', B, 'title', '"B"', stamp, stamp);
  const job = db.prepare('INSERT INTO document_index_jobs(job_id,vault_id,nodus_id,reason,status,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  job.run('job-a', VAULT, A, 'manual', 'completed', 'done', stamp, stamp);
  job.run('job-b', VAULT, B, 'manual', 'completed', 'done', stamp, stamp);
  const jobCheckpoint = db.prepare('INSERT INTO document_index_checkpoints(job_id,checkpoint_key,content_hash,payload_json,updated_at) VALUES(?,?,?,?,?)');
  jobCheckpoint.run('job-a', 'k', 'h', '{}', stamp);
  jobCheckpoint.run('job-b', 'k', 'h', '{}', stamp);
  db.prepare('INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields) VALUES(?,?,?,?,?)').run(A, 'v-a', 'Obra A', 'resumen A', 'campos A');
  db.prepare('INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields) VALUES(?,?,?,?,?)').run(B, 'v-b', 'Obra B', 'resumen B', 'campos B');
  db.prepare('INSERT INTO document_sections_fts(section_id,nodus_id,title,summary,concepts) VALUES(?,?,?,?,?)').run('s-a', A, 'Sección A', 'resumen', 'c');
  db.prepare('INSERT INTO document_sections_fts(section_id,nodus_id,title,summary,concepts) VALUES(?,?,?,?,?)').run('s-b', B, 'Sección B', 'resumen', 'c');
}

/**
 * A database with nothing but the seeded corpus.
 *
 * Each test owns the whole file: the ids are fixed (so the assertions read) and the
 * alternative — namespacing every id per test — would hide a real collision behind
 * fixture noise instead of exercising the schema's own keys.
 */
const dbFile = database.dbPath();
function freshDatabase() {
  database.closeDb();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true });
  const db = database.getDb();
  seedCorpus(db);
  return db;
}

// ── Schema-wide helpers ────────────────────────────────────────────────────────

function allTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => row.name);
}

/**
 * Every row of every table whose text form mentions `needle`, with the row's full JSON.
 *
 * This is what makes the residue test worth running: it does not know which tables
 * matter, so a table nobody remembered to clean shows up as a failure instead of
 * passing silently.
 */
function rowsMentioning(db, needle) {
  const found = [];
  for (const table of allTables(db)) {
    let columns;
    try { columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all(); } catch { continue; }
    if (columns.length === 0) continue;
    let rows;
    try { rows = db.prepare(`SELECT rowid AS __rid, * FROM ${JSON.stringify(table)}`).all(); }
    catch {
      try { rows = db.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all(); } catch { continue; }
    }
    for (const row of rows) {
      const json = JSON.stringify(row);
      if (json.includes(needle)) found.push({ table, key: String(row.__rid ?? json), json });
    }
  }
  return found;
}

const fingerprint = (rows) => rows.map((row) => `${row.table}#${row.key}:${row.json}`).sort();
const count = (db, table, where, ...params) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).n);

/**
 * Columns through which a row BELONGS to a work — as opposed to merely citing one.
 *
 * `library_analysis_provenance.source_work_id` is deliberately absent: a row whose
 * work_id is B and whose source_work_id is A is B's row that cites A, so removing it
 * would be stealing from the survivor, not disposing of the deleted work's property.
 */
const OWNING_COLUMNS = ['nodus_id', 'work_id', 'source_work', 'library_item_id', 'target_id', 'ref_id'];
const belongsTo = (row, workId) => {
  const parsed = JSON.parse(row.json);
  return OWNING_COLUMNS.some((column) => parsed[column] === workId);
};

test.after(async () => {
  database.closeDb();
  await rm(root, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

test('deleting a work leaves nothing anywhere in the schema that names it', () => {
  const db = freshDatabase();
  assert.ok(rowsMentioning(db, A).length > 15, 'the fixture seeds rows naming the deleted work');

  const result = deleteWorks([A], { vaultId: VAULT });
  assert.deepEqual(result.deleted, [A]);
  assert.deepEqual(result.missing, []);

  // Rows that name the deleted work and are still allowed to exist, each with the
  // reason. Counted so an exception cannot quietly become dead code that widens the
  // filter for some future table.
  const allowed = { changeLog: 0, tombstones: 0, otherWorksProvenance: 0, globalScope: 0 };
  const survivors = [];
  for (const row of rowsMentioning(db, A)) {
    // Append-only change history: it records that these very deletes happened, and
    // nothing reads it by work.
    if (row.table === 'dictionary_corpus_changes') { allowed.changeLog += 1; continue; }
    // The sync layer's record that the work was deleted. Dropping it would mean peers
    // never learn about the deletion.
    if (row.table === 'sync_tombstones') { allowed.tombstones += 1; continue; }
    // B's provenance row records that B's analysis came from A. It belongs to B.
    if (row.table === 'library_analysis_provenance' && row.json.includes(B)) { allowed.otherWorksProvenance += 1; continue; }
    // A Global Library item whose id happens to equal a work id is another store.
    if (row.table === 'workspace_library_links' && row.json.includes('"scope":"global"')) { allowed.globalScope += 1; continue; }
    survivors.push(`${row.table}#${row.key}`);
  }
  assert.deepEqual(survivors, [], 'every row naming the deleted work must be gone');
  assert.ok(allowed.changeLog > 0, 'the change log keeps the deletes it recorded');
  assert.ok(allowed.tombstones > 0, 'the deletion is itself a synced change, so it leaves tombstones');
  assert.equal(allowed.otherWorksProvenance, 1, 'the surviving work keeps the provenance that cites the deleted one');
  assert.equal(allowed.globalScope, 1, 'a same-named Global Library link is a different store');
});

test('a surviving work keeps every single row it had, byte for byte', () => {
  const db = freshDatabase();
  const beforeRows = rowsMentioning(db, B);
  const before = new Map(beforeRows.map((row) => [fingerprint([row])[0], row]));
  assert.ok(before.size > 20, 'the fixture seeds rows that name the surviving work');

  deleteWorks([A], { vaultId: VAULT });

  const after = new Set(fingerprint(rowsMentioning(db, B)));
  const removed = [...before.keys()].filter((entry) => !after.has(entry));
  const added = [...after].filter((entry) => !before.has(entry));

  // A row may only disappear if it belonged to the deleted work — e.g. the dictionary
  // evidence that A contributed and whose display list also named B.
  assert.deepEqual(
    removed.filter((entry) => !belongsTo(before.get(entry), A)).map((entry) => entry.split(':')[0]),
    [],
    'no row belonging to the surviving work may be removed'
  );
  assert.deepEqual(added, [], 'no row mentioning the surviving work may be added or rewritten');
  assert.equal(removed.length, 1, 'only the deleted work\'s own dictionary evidence goes, and it goes completely');
});

test('shared analysis survives: the idea, its embedding and its other occurrence', () => {
  const db = freshDatabase();
  const sharedEmbeddingBefore = Buffer.from(db.prepare('SELECT embedding FROM ideas WHERE global_id=?').get('g-shared').embedding);

  const result = deleteWorks([A], { vaultId: VAULT });

  const shared = db.prepare('SELECT orphaned_at, embedding FROM ideas WHERE global_id=?').get('g-shared');
  assert.ok(shared, 'an idea two works share is never deleted with one of them');
  assert.equal(shared.orphaned_at, null, 'an idea with a remaining occurrence is not even dormant');
  assert.deepEqual(Buffer.from(shared.embedding), sharedEmbeddingBefore, 'the shared embedding is untouched');
  assert.deepEqual(
    db.prepare('SELECT nodus_id FROM idea_occurrences WHERE global_id=? ORDER BY nodus_id').all('g-shared').map((row) => row.nodus_id),
    [B],
    'only the deleted work\'s occurrence is gone'
  );

  // The surviving work's own analysis is intact.
  assert.equal(count(db, 'edges', 'id=?', 'edge-b'), 1);
  assert.equal(count(db, 'evidence', 'id=?', 'ev-shared-b'), 1);
  assert.equal(count(db, 'work_themes', 'nodus_id=?', B), 2);
  assert.equal(count(db, 'idea_theme_links', 'nodus_id=?', B), 2);
  assert.equal(count(db, 'work_authors', 'nodus_id=?', B), 2);
  assert.equal(count(db, 'passages', 'nodus_id=?', B), 1);
  assert.equal(count(db, 'document_vectors', 'nodus_id=?', B), 1);
  assert.equal(count(db, 'themes', 'theme_id=?', 't-b'), 1);
  assert.equal(count(db, 'authors', 'author_id=?', 'au-b'), 1);

  // An idea only A referenced goes dormant — kept, with its id and embedding, so a
  // rescan re-attaches the same row instead of minting a new identity.
  const dormant = db.prepare('SELECT orphaned_at, embedding FROM ideas WHERE global_id=?').get('g-a-only');
  assert.ok(dormant, 'an orphaned idea is kept, not deleted');
  assert.ok(dormant.orphaned_at, 'it is marked dormant');
  assert.deepEqual(Buffer.from(dormant.embedding), Buffer.from([1, 2, 3]));
  assert.equal(result.dormantIdeas, 1, 'exactly the idea that lost its last occurrence went dormant');

  // A manual idea has no occurrence by design and must never be flagged.
  assert.equal(db.prepare('SELECT orphaned_at FROM ideas WHERE global_id=?').get('g-manual').orphaned_at, null,
    'a manual idea is owned by its note, not by a work');

  // The recomputable bridge between A's and B's ideas goes: it pointed at an idea no
  // longer in the graph, and a rescan recomputes it.
  assert.equal(count(db, 'edges', 'id=?', 'reproc:bridge'), 0);
  assert.equal(count(db, 'edge_traces', 'edge_id=?', 'reproc:bridge'), 0);
});

test('the deleted work takes exactly its own rows, and nothing else', () => {
  const db = freshDatabase();
  deleteWorks([A], { vaultId: VAULT });

  for (const [table, where, params] of [
    ['works', 'nodus_id=?', [A]],
    ['passages', 'nodus_id=?', [A]],
    ['passages_fts', 'nodus_id=?', [A]],
    ['work_summaries', 'nodus_id=?', [A]],
    ['work_idea_synthesis', 'nodus_id=?', [A]],
    ['work_themes', 'nodus_id=?', [A]],
    ['work_aliases', 'nodus_id=?', [A]],
    ['work_collections', 'nodus_id=?', [A]],
    ['work_zotero_tags', 'nodus_id=?', [A]],
    ['work_text_sources', 'nodus_id=?', [A]],
    ['scan_checkpoints', 'nodus_id=?', [A]],
    ['idea_occurrences', 'nodus_id=?', [A]],
    ['evidence', 'nodus_id=?', [A]],
    ['idea_theme_links', 'nodus_id=?', [A]],
    ['gaps', 'nodus_id=?', [A]],
    ['external_refs', 'nodus_id=?', [A]],
    ['work_authors', 'nodus_id=?', [A]],
    ['library_analysis_freshness', 'work_id=?', [A]],
    ['library_analysis_provenance', 'work_id=?', [A]],
    ['dictionary_evidence', 'work_id=?', [A]],
    ['document_profile_state', 'nodus_id=?', [A]],
    ['document_profile_versions', 'nodus_id=?', [A]],
    ['document_vectors', 'nodus_id=?', [A]],
    ['document_idea_links', 'nodus_id=?', [A]],
    ['document_profile_overrides', 'nodus_id=?', [A]],
    ['document_index_jobs', 'nodus_id=?', [A]],
    ['document_index_checkpoints', "job_id='job-a'", []],
    ['document_profiles_fts', 'nodus_id=?', [A]],
    ['document_sections_fts', 'nodus_id=?', [A]],
    ['study_progress', "target_kind='work' AND target_id=?", [A]],
    ['record_evidence', "source_kind='work' AND nodus_id=?", [A]],
    ['workspace_library_links', "scope='vault' AND library_item_id=?", [A]],
  ]) {
    assert.equal(count(db, table, where, ...params), 0, `${table} still holds a row for the deleted work`);
  }

  // Scope discrimination: the same string under another scope names a different store.
  assert.equal(count(db, 'workspace_library_links', "scope='global' AND library_item_id=?", A), 1,
    'a Global Library item whose id collides with a work id is not a work');

  // Catalogs are shared and are never pruned by a work delete.
  assert.equal(count(db, 'themes', 'theme_id=?', 't-shared'), 1);
  assert.equal(count(db, 'themes', 'theme_id=?', 't-a'), 1);
  assert.equal(count(db, 'authors', 'author_id=?', 'au-shared'), 1);
  assert.equal(count(db, 'zotero_tags', 'tag_id=?', 1), 1);
  assert.equal(count(db, 'collections', 'collection_key=?', 'col-a'), 1);
  assert.equal(count(db, 'works', 'nodus_id=?', B), 1);
});

test('a batch that fails partway leaves every work intact', () => {
  const db = freshDatabase();
  // The batch deletes A first; this trigger aborts on B, so an implementation without a
  // transaction would already have lost A by the time the error surfaces.
  db.exec(`CREATE TRIGGER test_block_delete_b BEFORE DELETE ON works
    WHEN OLD.nodus_id = '${B}' BEGIN SELECT RAISE(ABORT, 'blocked'); END`);
  try {
    assert.throws(() => deleteWorks([A, B], { vaultId: VAULT }), /blocked/);
  } finally {
    db.exec('DROP TRIGGER test_block_delete_b');
  }
  assert.equal(count(db, 'works', 'nodus_id=?', A), 1, 'the first work of a failed batch is restored');
  assert.equal(count(db, 'passages', 'nodus_id=?', A), 2);
  assert.equal(count(db, 'idea_occurrences', 'nodus_id=?', A), 2);
  assert.equal(count(db, 'works', 'nodus_id=?', B), 1);

  // The corpus is still deletable afterwards, and a stale id is reported, not fatal.
  const result = deleteWorks([A, B, 'work-that-never-existed'], { vaultId: VAULT });
  assert.deepEqual(result.deleted.sort(), [A, B].sort());
  assert.deepEqual(result.missing, ['work-that-never-existed']);
  assert.equal(count(db, 'works'), 0);
});

test('a work being analysed right now is refused, not deleted underneath itself', () => {
  const ids = ['w1', 'w2'];
  assert.deepEqual(worksRunningNow(ids, [{ nodus_id: 'w1', state: 'running' }]), ['w1']);
  assert.deepEqual(worksRunningNow(ids, [
    { nodus_id: 'w1', state: 'queued' },
    { nodus_id: 'w2', state: 'done' },
    { nodus_id: 'someone-else', state: 'running' },
  ]), [], 'only a running job on a selected work blocks the delete');
});

test('the delete is wired end to end through one IPC channel', () => {
  assertChannelsWired(assert, ['works:delete']);
  assertApiMethods(assert, ['deleteWorks']);
});

test('the Library offers the delete with a confirmation that names what goes', async () => {
  const library = await readSource('src/views/Library.tsx');
  // Red in both themes, labelled with an already translated string, and saying what goes.
  const button = /<button\s+className="btn bg-red-600[^"]*\btext-white hover:bg-red-500"[\s\S]{0,200}?title=\{t\('Elimina estas obras[^']*'\)\}\s+data-testid="library-delete-selected"\s*>\s*<Icon name="trash"[^>]*\/> \{t\('Eliminar'\)\}/;
  assert.match(library, button);
  // Destructive actions confirm through the shared danger dialog.
  assert.match(library, /confirm\(\{[\s\S]{0,500}danger: true/);
  assert.match(library, /window\.nodus\.deleteWorks\(ids\)/);
  // The main process's refusal is reported instead of reading as a success.
  assert.match(library, /if \(!outcome\.ok\)[\s\S]{0,400}tone: 'error'/);
});

test('every column that can name a work is cascaded, deleted, or explained', () => {
  const db = database.getDb();
  const handled = new Set([
    'works.nodus_id', // the row being deleted
    ...WORK_SCOPED_DELETES.map((entry) => `${entry.table}.${entry.column}`),
    ...GRAPH_PURGED_COLUMNS.map((entry) => `${entry.table}.${entry.column}`),
    ...WORK_REFERENCE_EXCEPTIONS.map((entry) => `${entry.table}.${entry.column}`),
  ]);
  const unhandled = [];
  for (const table of allTables(db)) {
    let columns;
    try { columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all(); } catch { continue; }
    if (columns.length === 0) continue;
    for (const column of columns) {
      if (!/^(nodus_id|work_id|source_work|source_work_id|library_item_id|target_id|ref_id|works_json)$/.test(column.name)) continue;
      // A cascading foreign key to works removes the row with the work, so no statement
      // is needed for it.
      const cascades = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all()
        .some((fk) => fk.from === column.name && fk.table === 'works' && fk.on_delete === 'CASCADE');
      if (cascades) continue;
      if (!handled.has(`${table}.${column.name}`)) unhandled.push(`${table}.${column.name}`);
    }
  }
  assert.deepEqual(unhandled, [],
    'a column that can hold a work id must be cascaded, deleted explicitly, or listed with a reason');
});

test('the delete statements only ever name the work they are given', () => {
  for (const statement of WORK_SCOPED_DELETES) {
    // Every statement is anchored on its declared column compared to the bound id. A
    // statement that dropped that comparison — or compared it to anything else — would
    // be the way this operation reaches a neighbouring work's rows.
    assert.match(statement.sql, new RegExp(`${statement.column} = \\?`),
      `${statement.table}.${statement.column} must be compared to the bound work id`);
    const bound = statement.args('X', 'V');
    assert.ok(bound.includes('X'), `${statement.table}: the work id is the value bound`);
    // The placeholders and the bound values must line up: a mismatch would bind the work
    // id to the wrong position (the vault id, for instance) and silently match nothing.
    assert.equal((statement.sql.match(/\?/g) ?? []).length, bound.length,
      `${statement.table}: every placeholder is bound`);
  }
});
