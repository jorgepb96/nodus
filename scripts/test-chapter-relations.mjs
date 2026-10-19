// Validates the schema and SQL behind chapter-idea relations (Phases 1 & 2):
// migration v21 tables/columns, cascade deletes, the related-library-ideas query
// and the note-embedding cosine retrieval that lets chapter ideas reach the
// user's notes. Runs under Electron-as-Node so better-sqlite3 matches the app ABI
// (same pattern as test-search-health.mjs); the queries mirror the repos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-chapter-relations-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-chapter-relations.mjs'), '--electron-chapter-relations-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

function vecCosine(a, b) {
  if (!a || !b) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    dot += fa[i] * fb[i];
    na += fa[i] * fa[i];
    nb += fb[i] * fb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function encode(vec) {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-chapter-relations-test-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'chapter.sqlite'));
  db.pragma('foreign_keys = ON');
  db.function('vec_cosine', vecCosine);

  // Minimal parent tables that migration 21 references / alters.
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE project_chapters (id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '');
  `);
  db.exec(await migration21Sql());
  // This migration-21 fixture uses the same read boundary as the current repositories.
  db.exec('CREATE VIEW embedding_read_project_chapter_ideas AS SELECT * FROM project_chapter_ideas');

  // ── Schema ──────────────────────────────────────────────────────────────────
  assert.equal(tableExists(db, 'project_chapter_ideas'), true);
  assert.equal(tableExists(db, 'project_chapter_idea_relations'), true);
  assert.equal(indexExists(db, 'idx_chapter_ideas_chapter'), true);
  assert.equal(indexExists(db, 'idx_chapter_idea_relations_chapter'), true);
  const noteCols = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
  for (const col of ['embedding', 'embedding_provider', 'embedding_model', 'embedding_dim', 'embedding_text_hash']) {
    assert.ok(noteCols.includes(col), `notes.${col} should exist`);
  }

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id) VALUES (?)').run('proj-1');
  db.prepare('INSERT INTO project_chapters (id, project_id) VALUES (?, ?)').run('chap-1', 'proj-1');

  const insertIdea = db.prepare(
    `INSERT INTO project_chapter_ideas (id, chapter_id, project_id, type, label, statement, order_idx, source_hash, embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertIdea.run('ci-1', 'chap-1', 'proj-1', 'claim', 'Idea A', 'Enunciado A', 0, 'hash-v1', encode([1, 0, 0]), 'openai', 'm', 3, 'h1', now);
  insertIdea.run('ci-2', 'chap-1', 'proj-1', 'finding', 'Idea B', 'Enunciado B', 1, 'hash-v1', encode([0, 1, 0]), 'openai', 'm', 3, 'h2', now);

  const insertRel = db.prepare(
    `INSERT INTO project_chapter_idea_relations (id, chapter_idea_id, chapter_id, target_kind, target_id, relation, similarity, confidence, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertRel.run('r-1', 'ci-1', 'chap-1', 'idea', 'g-100', 'supports', 0.9, 0.88, 'apoya', now);
  insertRel.run('r-2', 'ci-1', 'chap-1', 'note', 'note-9', 'related', 0.6, 0.6, '', now);
  insertRel.run('r-3', 'ci-2', 'chap-1', 'idea', 'g-200', 'contradicts', 0.7, 0.71, 'tensiona', now);
  insertRel.run('r-4', 'ci-2', 'chap-1', 'idea', 'g-100', 'refines', 0.5, 0.5, '', now); // dup target idea g-100

  // ── Atomic publication through the real repository ─────────────────────────
  db.prepare('INSERT INTO project_chapters (id, project_id) VALUES (?, ?)').run('chap-atomic', 'proj-1');
  insertIdea.run('old-idea', 'chap-atomic', 'proj-1', 'claim', 'Anterior', 'Análisis válido', 0, 'old-hash', encode([1, 0]), 'openai', 'test-embedding', 2, 'old', now);
  insertRel.run('old-rel', 'old-idea', 'chap-atomic', 'idea', 'g-old', 'supports', 0.9, 0.9, 'anterior', now);
  const atomicRepo = loadProjectChapterIdeasRepo(db);
  const replacementIdeas = [
    { id: 'new-a', type: 'claim', label: 'Nueva A', statement: 'A', embedding: [1, 0], embeddingText: 'A' },
    { id: 'new-b', type: 'finding', label: 'Nueva B', statement: 'B', embedding: [0, 1], embeddingText: 'B' },
  ];
  assert.throws(
    () => atomicRepo.replaceChapterAnalysis('chap-atomic', 'proj-1', 'new-hash', replacementIdeas, [{
      chapterIdeaId: 'missing', targetKind: 'idea', targetId: 'g-new', relation: 'related', similarity: 0.7, confidence: 0.7, rationale: '',
    }]),
    /no pertenece/,
  );
  assert.equal(db.prepare("SELECT source_hash FROM project_chapter_ideas WHERE chapter_id='chap-atomic'").get().source_hash, 'old-hash', 'a rejected publication preserves the previous ideas');
  assert.equal(db.prepare("SELECT target_id FROM project_chapter_idea_relations WHERE chapter_id='chap-atomic'").get().target_id, 'g-old', 'a rejected publication preserves the previous relations');

  atomicRepo.replaceChapterAnalysis('chap-atomic', 'proj-1', 'new-hash', replacementIdeas, [{
    chapterIdeaId: 'new-a', targetKind: 'idea', targetId: 'g-new', relation: 'refines', similarity: 0.8, confidence: 0.75, rationale: 'nueva',
  }]);
  assert.deepEqual(db.prepare("SELECT id FROM project_chapter_ideas WHERE chapter_id='chap-atomic' ORDER BY id").all().map((row) => row.id), ['new-a', 'new-b']);
  assert.deepEqual(db.prepare("SELECT chapter_idea_id, target_id FROM project_chapter_idea_relations WHERE chapter_id='chap-atomic'").all(), [{ chapter_idea_id: 'new-a', target_id: 'g-new' }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_chapter_idea_relations r LEFT JOIN project_chapter_ideas i ON i.id=r.chapter_idea_id WHERE r.chapter_id='chap-atomic' AND i.id IS NULL").get().n, 0, 'atomic publication leaves no orphan relation');
  db.prepare("DELETE FROM project_chapters WHERE id='chap-atomic'").run();

  // ── relatedLibraryIdeaIds: distinct idea targets ─────────────────────────────
  const relatedIdeaIds = db
    .prepare(
      `SELECT DISTINCT target_id FROM project_chapter_idea_relations
        WHERE chapter_id = ? AND target_kind = 'idea' ORDER BY confidence DESC`
    )
    .all('chap-1')
    .map((r) => r.target_id);
  assert.deepEqual([...relatedIdeaIds].sort(), ['g-100', 'g-200'], 'distinct related library idea ids');

  // ── Cascade: deleting the chapter removes its ideas and relations ────────────
  assert.equal(count(db, 'project_chapter_ideas'), 2);
  assert.equal(count(db, 'project_chapter_idea_relations'), 4);
  db.prepare('DELETE FROM project_chapters WHERE id = ?').run('chap-1');
  assert.equal(count(db, 'project_chapter_ideas'), 0, 'chapter ideas cascade on chapter delete');
  assert.equal(count(db, 'project_chapter_idea_relations'), 0, 'relations cascade on chapter delete');

  // ── Cascade: deleting one chapter idea removes only its relations ────────────
  db.prepare('INSERT INTO project_chapters (id, project_id) VALUES (?, ?)').run('chap-2', 'proj-1');
  insertIdea.run('ci-3', 'chap-2', 'proj-1', 'claim', 'C', 'c', 0, 'h', null, null, null, null, null, now);
  insertIdea.run('ci-4', 'chap-2', 'proj-1', 'claim', 'D', 'd', 1, 'h', null, null, null, null, null, now);
  insertRel.run('r-5', 'ci-3', 'chap-2', 'idea', 'g-1', 'related', 0.5, 0.5, '', now);
  insertRel.run('r-6', 'ci-4', 'chap-2', 'idea', 'g-2', 'related', 0.5, 0.5, '', now);
  db.prepare('DELETE FROM project_chapter_ideas WHERE id = ?').run('ci-3');
  assert.equal(count(db, 'project_chapter_idea_relations'), 1, 'only the deleted idea’s relations are removed');

  // ── findSimilarNotes: cosine over note embeddings (mirrors notesRepo) ─────────
  const insertNote = db.prepare(
    'INSERT INTO notes (id, title, content, embedding, embedding_provider, embedding_model, embedding_dim) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertNote.run('n-near', 'Cerca', 'texto', encode([1, 0, 0]), 'openai', 'm', 3);
  insertNote.run('n-ortho', 'Ortogonal', 'texto', encode([0, 1, 0]), 'openai', 'm', 3);
  insertNote.run('n-wrong', 'Otro modelo', 'texto', encode([1, 0, 0]), 'gemini', 'other', 3);
  insertNote.run('n-none', 'Sin embedding', 'texto', null, null, null, null);

  const queryVec = encode([1, 0, 0]);
  const noteHits = db
    .prepare(
      `SELECT * FROM (
         SELECT id, vec_cosine(embedding, ?) AS similarity FROM notes
          WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
       ) WHERE similarity >= ? ORDER BY similarity DESC LIMIT 10`
    )
    .all(queryVec, 'openai', 'm', 3, 0.2)
    .map((r) => r.id);
  assert.deepEqual(noteHits, ['n-near'], 'only the same-model, above-threshold note is returned');

  db.close();
  console.log('chapter-relations schema + SQL test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function migration21Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*21,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*(?:,|];)/);
  assert.ok(match?.[1], 'Could not find migration 21 SQL');
  return match[1];
}
function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}
function indexExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
}
function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function loadProjectChapterIdeasRepo(db) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalLoad = Module._load;
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    module._compile(output, filename);
  };
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename?.endsWith('projectChapterIdeasRepo.ts') && request === './database') return { getDb: () => db };
    if (parent?.filename?.endsWith('projectChapterIdeasRepo.ts') && request === './ideasRepo') {
      return {
        currentEmbeddingConfig: () => ({ provider: 'openai', model: 'test-embedding' }),
        decodeEmbedding: (buffer) => Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)),
        encodeEmbedding: encode,
        embeddingTextHash: (text) => `hash:${text}`,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(path.join(repoRoot, 'electron/db/projectChapterIdeasRepo.ts'));
  } finally {
    Module._load = originalLoad;
  }
}
