// The reading path's related ideas and themes must be whole labels. They were joined with
// GROUP_CONCAT and split on commas, so a label containing a comma came back as fragments.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('labels containing commas survive into the reading path', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reading-labels-'));
  try {
    const outfile = path.join(tmp, 'graph.mjs');
    await build({
      entryPoints: [path.join(root, 'electron/graph/graphService.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(root, 'scripts/stub-electron.mjs') }));
        b.onResolve({ filter: /\/db\/database$|^better-sqlite3$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: args.path === 'better-sqlite3'
          ? 'export default class Database { constructor() { throw new Error("no native sqlite in this test"); } }'
          : 'export const getDb = () => globalThis.__db;' }));
      } }],
    });
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE works (nodus_id TEXT, zotero_key TEXT, title TEXT, authors_json TEXT, year INTEGER, item_type TEXT, doi TEXT, read_tag INTEGER,
        light_status TEXT, deep_status TEXT, summary_status TEXT, archived INTEGER);
      CREATE TABLE work_summaries (nodus_id TEXT, summary TEXT);
      CREATE TABLE work_themes (nodus_id TEXT, theme_id TEXT);
      CREATE TABLE themes (theme_id TEXT, label TEXT);
      CREATE TABLE idea_theme_links (global_id TEXT, nodus_id TEXT, theme_id TEXT);
      CREATE TABLE idea_occurrences (nodus_id TEXT, global_id TEXT);
      CREATE TABLE ideas (global_id TEXT, label TEXT);
      CREATE TABLE visible_edges (id TEXT, type TEXT, source_work TEXT, from_id TEXT, to_id TEXT);
      CREATE TABLE gaps (nodus_id TEXT, statement TEXT, related_idea TEXT);
      CREATE TABLE external_refs (nodus_id TEXT, cited_work TEXT);
      CREATE TABLE work_attributions (nodus_id TEXT, author_id TEXT);
      CREATE TABLE author_relations (from_author TEXT, to_author TEXT, type TEXT, weight REAL);
      INSERT INTO works VALUES ('w1', 'z1', 'A work', '["Ada"]', 2000, 'book', NULL, 0, 'done', 'done', 'none', 0);
      INSERT INTO themes VALUES ('t1', 'Memory, trauma and the state');
      INSERT INTO work_themes VALUES ('w1', 't1');
      INSERT INTO ideas VALUES ('g1', 'V, D and J segments recombine'), ('g2', 'Plain idea');
      INSERT INTO idea_occurrences VALUES ('w1', 'g1'), ('w1', 'g2');
    `);
    globalThis.__db = { prepare: (sql) => { const statement = db.prepare(sql); return { all: (...a) => statement.all(...a), get: (...a) => statement.get(...a) }; } };
    const { buildReadingPath } = await import(pathToFileURL(outfile).href);
    const plan = buildReadingPath({ includeRead: true });
    const entry = plan.phases.flatMap((phase) => phase.entries).find((e) => e.nodusId === 'w1' || e.title === 'A work');
    assert.ok(entry, 'the work is in the plan');
    assert.deepEqual([...entry.relatedIdeas].sort(), ['Plain idea', 'V, D and J segments recombine']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
