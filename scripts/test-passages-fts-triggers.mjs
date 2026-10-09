// The passage search index follows its passages by lookup: deleting or rewriting a passage must
// not read the whole index, and must still leave the index exactly in step with the table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--passages-fts-triggers')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-passages-fts-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
try {
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = new Database(path.join(scratch, 'vault.sqlite'));
  runMigrations(db);
  for (const name of ['passages_document_fts_au', 'passages_document_fts_ad']) {
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").pluck().get(name);
    const statement = /DELETE FROM passages_fts[^;]*/.exec(trigger)?.[0];
    assert.ok(statement, `${name} deletes from the passage index`);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${statement.replaceAll('old.passage_id', '?')}`).all('x').map(row => row.detail).join(' | ');
    assert.match(plan, /passages_fts_content_passage/, `${name} finds the row by index, not by scanning every row (${plan})`);
  }

  // The same rows in the index as in the table, through inserts, a rewrite and deletions.
  const insertWork = db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash) VALUES(?,?,?,'[]',2020,'book','text','h')`);
  const insertPassage = db.prepare(`INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at) VALUES(?,?,?,?,NULL,?, 'h','2026-01-01')`);
  for (const work of ['w1', 'w2']) {
    insertWork.run(work, work, work);
    for (let index = 0; index < 50; index += 1) insertPassage.run(`${work}#${index}`, work, index, `${work} passage ${index} esterification`, 30);
  }
  const indexed = () => db.prepare('SELECT passage_id FROM passages_fts ORDER BY passage_id').pluck().all();
  const stored = () => db.prepare('SELECT passage_id FROM passages ORDER BY passage_id').pluck().all();
  assert.deepEqual(indexed(), stored());
  db.prepare("UPDATE passages SET text='rewritten as an aldol condensation' WHERE passage_id='w1#3'").run();
  assert.deepEqual(db.prepare("SELECT passage_id FROM passages_fts WHERE passages_fts MATCH 'aldol'").pluck().all(), ['w1#3']);
  assert.equal(db.prepare("SELECT COUNT(*) FROM passages_fts WHERE passages_fts MATCH 'esterification' AND passage_id='w1#3'").pluck().get(), 0, 'the old text left the index');
  db.prepare("DELETE FROM passages WHERE nodus_id='w1'").run();
  assert.deepEqual(indexed(), stored(), 'deleting a work removes exactly its passages from the index');
  assert.equal(indexed().length, 50);
  db.exec("INSERT INTO passages_fts(passages_fts) VALUES('integrity-check')");
  db.close();
  console.log('Passage index triggers find rows by lookup and keep the index in step.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
