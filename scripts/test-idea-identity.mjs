// Stable idea identity across rescans. Drives the REAL ideasRepo functions
// (createIdea, upsertOccurrence, purgeDeepData, findSimilarIdeas,
// allIdeaCandidates, pruneDormantIdeas, isActiveIdea) against a scratch DB and
// proves the dormancy lifecycle: a rescan no longer deletes work-only ideas —
// it puts them to sleep, fusion can re-match them (same global_id), only a new
// occurrence revives them (an edge never does), and only long-dormant ideas get
// pruned. Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-idea-identity-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-idea-identity.mjs'), '--electron-idea-identity-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-idea-identity-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'identity.sqlite'));
  db.function('vec_cosine', (a, b) => {
    if (!a || !b) return 0;
    const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
    const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(fa.length, fb.length); i++) {
      dot += fa[i] * fb[i]; na += fa[i] * fa[i]; nb += fb[i] * fb[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  });

  // Base schema (the columns ideasRepo touches) + REAL migration 28 on top.
  db.exec(`
    CREATE TABLE ideas (
      global_id TEXT PRIMARY KEY, type TEXT, label TEXT, statement TEXT,
      embedding BLOB, created_at TEXT, embedding_provider TEXT,
      embedding_model TEXT, embedding_dim INTEGER, embedding_text_hash TEXT
    );
    CREATE TABLE idea_occurrences (
      global_id TEXT, nodus_id TEXT, role TEXT, development TEXT, confidence REAL,
      PRIMARY KEY (global_id, nodus_id)
    );
    CREATE TABLE notes (id TEXT PRIMARY KEY, source_json TEXT, updated_at TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, type TEXT, basis TEXT, confidence REAL, source_work TEXT);
    CREATE TABLE edge_traces (edge_id TEXT PRIMARY KEY, method TEXT NOT NULL DEFAULT 'deep');
    CREATE TABLE evidence (id TEXT PRIMARY KEY, nodus_id TEXT, global_id TEXT);
    CREATE TABLE idea_theme_links (theme_id TEXT, nodus_id TEXT, global_id TEXT, confidence REAL);
    CREATE TABLE gaps (id TEXT PRIMARY KEY, nodus_id TEXT, related_idea TEXT, evidence_id TEXT);
    CREATE TABLE external_refs (id TEXT PRIMARY KEY, nodus_id TEXT, from_idea TEXT, evidence_id TEXT);
    CREATE TABLE project_chapter_idea_relations (target_kind TEXT, target_id TEXT);
    CREATE TABLE db_relations (target_kind TEXT, target_id TEXT, target_vault_id TEXT);
    CREATE TABLE work_authors (author_id TEXT, nodus_id TEXT);
    CREATE TABLE work_idea_synthesis (nodus_id TEXT PRIMARY KEY);
    CREATE TABLE edge_feedback (
      from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL,
      verdict TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id, type)
    );
  `);
  db.exec(await migration28Sql());
  // This migration-28 fixture intentionally retains the legacy carrier schema.
  db.exec('CREATE VIEW embedding_read_ideas AS SELECT rowid,* FROM ideas');
  assert.ok(
    db.prepare("SELECT 1 FROM pragma_table_info('ideas') WHERE name = 'orphaned_at'").get(),
    'migration 28 adds orphaned_at'
  );

  const repoModule = await bundleIdeasRepo();
  globalThis.__ideaIdentityTestDb = db;
  const repo = await import(pathToFileURL(repoModule).href);

  // ── 1. An idea living only in w1 ───────────────────────────────────────────
  const idea = repo.createIdea({ type: 'claim', label: 'Idea frágil', statement: 'Solo aparece en w1', embedding: [1, 0, 0] });
  repo.upsertOccurrence(idea.global_id, 'w1', 'principal', 'desarrollo', 0.9);
  const originalId = idea.global_id;

  // ── 2. Rescan purge: the idea goes dormant, it is NOT deleted ──────────────
  repo.purgeDeepData('w1');
  const row = db.prepare('SELECT global_id, orphaned_at FROM ideas WHERE global_id = ?').get(originalId);
  assert.ok(row, 'idea survives the purge');
  assert.ok(row.orphaned_at, 'idea is flagged dormant');

  // ── 3. Retrieval hides dormant ideas; fusion sees them ─────────────────────
  const probe = [1, 0, 0];
  assert.equal(repo.findSimilarIdeas(probe, 0.9, 5).length, 0, 'dormant idea hidden from retrieval');
  const fusionHits = repo.findSimilarIdeas(probe, 0.9, 5, { includeDormant: true });
  assert.equal(fusionHits.length, 1, 'fusion still sees the dormant idea');
  assert.equal(fusionHits[0].global_id, originalId, 'fusion candidate keeps the ORIGINAL global_id');
  assert.equal(repo.allIdeaCandidates().length, 0, 'lexical pool hides dormant by default');
  assert.equal(repo.allIdeaCandidates({ includeDormant: true }).length, 1, 'lexical fusion pool includes dormant');

  // ── 4. Re-attachment (what deep scan does after fusion matches) revives ────
  repo.upsertOccurrence(originalId, 'w1', 'principal', 'desarrollo v2', 0.95);
  const revived = db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(originalId);
  assert.equal(revived.orphaned_at, null, 'occurrence re-attachment clears dormancy');
  assert.equal(repo.findSimilarIdeas(probe, 0.9, 5).length, 1, 'revived idea visible to retrieval again');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM ideas').get().n,
    1,
    'the whole cycle minted no duplicate idea — identity is stable'
  );
  assert.doesNotThrow(() => repo.assertDeepDataIntegrity('w1'), 'a complete replacement passes the post-commit audit');

  // ── 4b. A new edge into a dormant idea still fails the write-time audit ──
  // Fusion plans are decided before the rescan purges its work, so a link target can
  // be asleep by the time the plan is applied. The audit must keep rejecting an edge
  // into it: fusion drops such a link instead of writing it (applyFusionLink, covered
  // end to end by test-deep-rescan-dormant-link.mjs). Nothing here revives the target.
  const dormant = repo.createIdea({ type: 'claim', label: 'Dormida', statement: 'y', embedding: [0, 0, 1] });
  repo.upsertOccurrence(dormant.global_id, 'w4a', 'principal', '', 0.8);
  repo.purgeDeepData('w4a');
  assert.ok(
    db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(dormant.global_id).orphaned_at,
    'link target starts dormant, as it would be mid-scan'
  );
  assert.equal(repo.isActiveIdea(dormant.global_id), false, 'isActiveIdea sees it asleep');
  assert.equal(repo.isActiveIdea(originalId), true, 'isActiveIdea sees an idea a work holds');
  assert.equal(repo.isActiveIdea('no-such-idea'), false, 'isActiveIdea is false for a missing idea');
  db.prepare("INSERT INTO edges VALUES ('e-link', ?, ?, 'variant_of', 'inferred', 0.7, 'w4b')").run(originalId, dormant.global_id);
  assert.throws(
    () => repo.assertDeepDataIntegrity('w4b'),
    /edges→active ideas: 1/,
    'an edge into a still-dormant idea fails the audit'
  );
  db.prepare("DELETE FROM edges WHERE id = 'e-link'").run();
  assert.doesNotThrow(() => repo.assertDeepDataIntegrity('w4b'), 'without that edge the pass is clean');

  // ── 4c. Edges never keep an idea awake; they only hide while it sleeps ───
  // Book A links to an idea that book B holds. When B's rescan no longer contains it,
  // the idea goes to sleep even though A's edge points at it: the edge stays in
  // `edges` (visible_edges hides it) and returns if a scan re-attaches the idea. A's
  // own rescan deletes A's edges before its audit, so A never fails because of B.
  const linked = repo.createIdea({ type: 'claim', label: 'Enlazada', statement: 'z', embedding: [1, 1, 0] });
  repo.upsertOccurrence(linked.global_id, 'w4c-owner', 'principal', '', 0.8);
  db.prepare("INSERT INTO edges VALUES ('e-cross', ?, ?, 'variant_of', 'inferred', 0.7, 'w4c-linker')").run(originalId, linked.global_id);
  repo.purgeDeepData('w4c-owner'); // book B's rescan: its only occurrence is gone
  assert.ok(
    db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(linked.global_id).orphaned_at,
    "another work's edge does not keep an idea no work holds awake"
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM edges WHERE id = 'e-cross'").get().n,
    1,
    "book A's edge stays in place, hidden while its target sleeps"
  );
  repo.purgeDeepData('w4c-linker'); // book A's own rescan starts by dropping its edges
  assert.doesNotThrow(
    () => repo.assertDeepDataIntegrity('w4c-linker'),
    "book A's rescan is not failed by the idea book B dropped"
  );
  repo.upsertOccurrence(linked.global_id, 'w4c-owner', 'principal', '', 0.8);
  assert.equal(
    db.prepare('SELECT orphaned_at FROM ideas WHERE global_id = ?').get(linked.global_id).orphaned_at,
    null,
    'an occurrence (a work holding it again) is what wakes it'
  );
  db.prepare("DELETE FROM idea_occurrences WHERE global_id = ?").run(linked.global_id);
  db.prepare("DELETE FROM ideas WHERE global_id = ?").run(linked.global_id);
  db.prepare("DELETE FROM idea_occurrences WHERE global_id = ?").run(dormant.global_id);
  db.prepare("DELETE FROM ideas WHERE global_id = ?").run(dormant.global_id);

  assert.throws(() => db.transaction(() => {
    db.prepare("INSERT INTO gaps (id, nodus_id, related_idea) VALUES ('broken-gap', 'w1', 'missing-idea')").run();
    repo.assertDeepDataIntegrity('w1');
  })(), /gaps→ideas: 1/, 'an orphaned derived reference aborts the replacement');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gaps WHERE id='broken-gap'").get().n, 0, 'the failed integrity audit rolled its transaction back');

  // ── 5. Pruning: only long-dormant, never manual, cleans dangling edges ─────
  const doomed = repo.createIdea({ type: 'claim', label: 'Efímera', statement: 'x', embedding: [0, 1, 0] });
  repo.upsertOccurrence(doomed.global_id, 'w2', 'secondary', '', 0.5);
  db.prepare("INSERT INTO edges VALUES ('e-doom', ?, ?, 'supports', 'inferred', 0.7, NULL)").run(doomed.global_id, originalId);
  db.prepare("INSERT INTO edge_traces VALUES ('e-doom', 'deep')").run();
  repo.purgeDeepData('w2');

  assert.equal(repo.pruneDormantIdeas(30), 0, 'recently dormant ideas are protected');
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run(daysAgo(40), doomed.global_id);
  assert.equal(repo.pruneDormantIdeas(30), 1, 'long-dormant idea pruned');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edges').get().n, 0, 'dangling edge cleaned with it');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM edge_traces').get().n, 0, 'dangling trace cleaned with it');

  const manual = repo.createIdea({ type: 'claim', label: 'Manual', statement: 'del usuario', embedding: null });
  db.prepare('INSERT INTO notes VALUES (?, ?, ?)').run('n1', JSON.stringify({ note: 'manual-idea', ref: manual.global_id }), daysAgo(1));
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ?').run(daysAgo(400), manual.global_id);
  assert.equal(repo.pruneDormantIdeas(30), 0, 'manual ideas are never pruned');

  // ── 6. Explicit deletion is complete, but preserves user-authored note text ─
  db.prepare("INSERT INTO edges VALUES ('e-manual', ?, ?, 'supports', 'manual', 1, NULL)").run(manual.global_id, originalId);
  db.prepare("INSERT INTO edge_traces VALUES ('e-manual', 'deep')").run();
  db.prepare("INSERT INTO edge_feedback VALUES (?, ?, 'supports', 'confirmed', '', ?)").run(manual.global_id, originalId, daysAgo(1));
  db.prepare("INSERT INTO idea_occurrences VALUES (?, 'w3', 'principal', '', 1)").run(manual.global_id);
  db.prepare("INSERT INTO evidence VALUES ('ev-manual', 'w3', ?)").run(manual.global_id);
  db.prepare("INSERT INTO idea_theme_links VALUES ('theme', 'w3', ?, 1)").run(manual.global_id);
  db.prepare("INSERT INTO gaps (id, nodus_id, related_idea) VALUES ('gap-manual', 'w3', ?)").run(manual.global_id);
  db.prepare("INSERT INTO external_refs (id, nodus_id, from_idea) VALUES ('ref-manual', 'w3', ?)").run(manual.global_id);
  db.prepare("INSERT INTO project_chapter_idea_relations VALUES ('idea', ?)").run(manual.global_id);
  db.prepare("INSERT INTO db_relations VALUES ('idea', ?, NULL)").run(manual.global_id);
  assert.equal(repo.deleteIdea(manual.global_id), true, 'an academic idea can be explicitly deleted');
  assert.equal(db.prepare('SELECT 1 FROM ideas WHERE global_id=?').get(manual.global_id), undefined, 'the canonical idea and embedding row are gone');
  assert.equal(db.prepare('SELECT source_json FROM notes WHERE id=?').get('n1').source_json, null, 'the note remains but its deleted-idea provenance is detached');
  const referenceChecks = [
    ['edges', 'from_id=? OR to_id=?', [manual.global_id, manual.global_id]],
    ['edge_traces', 'edge_id=?', ['e-manual']],
    ['edge_feedback', 'from_id=? OR to_id=?', [manual.global_id, manual.global_id]],
    ['idea_occurrences', 'global_id=?', [manual.global_id]],
    ['evidence', 'global_id=?', [manual.global_id]],
    ['idea_theme_links', 'global_id=?', [manual.global_id]],
    ['gaps', 'related_idea=?', [manual.global_id]],
    ['external_refs', 'from_idea=?', [manual.global_id]],
    ['project_chapter_idea_relations', 'target_kind=\'idea\' AND target_id=?', [manual.global_id]],
    ['db_relations', 'target_kind=\'idea\' AND target_id=?', [manual.global_id]],
  ];
  for (const [table, where, parameters] of referenceChecks) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...parameters).n, 0, `${table} no longer references the deleted idea`);
  }

  // ── 7. Allocation keeps counting past the four-digit ceiling ───────────────
  // Ids are padded to four digits, so ordering them as TEXT is only honest up to
  // g-9999: past it 'g-9999' > 'g-10000'. A corpus that crossed 9,999 ideas then
  // got g-10000 proposed on every call, and every deep scan with a genuinely new
  // idea to record died on UNIQUE constraint failed: ideas.global_id.
  db.prepare("INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES ('g-9999', 'claim', 'Techo', 'x', ?)")
    .run(new Date().toISOString());
  const crossing = repo.createIdea({ type: 'claim', label: 'Cruza el techo', statement: 'x', embedding: null });
  assert.equal(crossing.global_id, 'g-10000', 'the id after g-9999 is g-10000');
  const beyond = repo.createIdea({ type: 'claim', label: 'Y sigue', statement: 'x', embedding: null });
  assert.equal(beyond.global_id, 'g-10001', 'allocation keeps counting once ids outgrow four digits');

  db.close();
  console.log('idea identity (dormancy + revival) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function migration28Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*28,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*(?:,|];)/);
  assert.ok(match?.[1], 'Could not find migration 28 SQL');
  return match[1];
}

/** Bundle the real ideasRepo with database/settings/works stubbed out. */
async function bundleIdeasRepo() {
  const dbStub = path.join(root, 'stub-database.js');
  await writeFile(
    dbStub,
    'export function getDb() { return globalThis.__ideaIdentityTestDb; }\n' +
      // Armed by the paged similarity scan before each statement; no-op here.
      'export function setVectorScanQuery() {}\n'
  );
  const settingsStub = path.join(root, 'stub-settings.js');
  await writeFile(settingsStub, "export function getSettings() { return { embeddingProvider: 'openai', embeddingModel: 'test-model' }; }\n");
  const worksStub = path.join(root, 'stub-works.js');
  await writeFile(worksStub, 'export function getWorksByIds() { return new Map(); }\n');
  const out = path.join(root, 'ideasRepo.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/db/ideasRepo.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    plugins: [
      {
        name: 'stub-db-deps',
        setup(api) {
          api.onResolve({ filter: /^\.\/database$/ }, () => ({ path: dbStub }));
          api.onResolve({ filter: /^\.\/settingsRepo$/ }, () => ({ path: settingsStub }));
          api.onResolve({ filter: /^\.\/worksRepo$/ }, () => ({ path: worksStub }));
        },
      },
    ],
  });
  return out;
}
