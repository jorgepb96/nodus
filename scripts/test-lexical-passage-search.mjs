// The literal passage lane reads its BM25 ranking a page at a time and inside the scope, and
// returns exactly what reading the whole ranking returned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--lexical-passage-search')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-lexical-passages-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const passages = load('electron/db/passagesRepo.ts');
  const words = ['ester', 'reflux', 'ketone', 'aldol', 'acid', 'yield', 'ethanol', 'nitration'];
  let seed = 3;
  const pick = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return words[seed % words.length]; };
  db.transaction(() => {
    for (let work = 0; work < 12; work += 1) {
      const id = `w${work}`;
      db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash,archived)
        VALUES(?,?,?,'[]',2020,'book','text','hash',?)`).run(id, id, id, work === 5 ? 1 : 0);
      passages.replaceWorkPassages(id, work === 7 ? 'stale' : 'hash', Array.from({ length: 150 }, (_, index) => ({
        text: Array.from({ length: 20 }, pick).join(' ') + ` section ${index}`, pageLabel: String(index), embedding: null,
      })));
    }
  })();

  // The lane as it was: the whole ranking read, then filtered by scope in JavaScript.
  function reference(query, limit, scopeIds) {
    const fold = value => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
    const tokens = fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
    const unique = [...new Set(tokens.filter(token => token.length >= 4).map(token => token.length >= 8 ? token.slice(0, 7) : token))].slice(0, 32);
    const ranked = db.prepare('SELECT passage_id FROM passages_fts WHERE passages_fts MATCH ? ORDER BY bm25(passages_fts), rowid').pluck()
      .all(unique.map(token => `"${token}"*`).join(' OR '));
    const scope = scopeIds ? new Set(scopeIds) : null;
    const read = db.prepare(`SELECT p.passage_id,p.nodus_id FROM passages p JOIN works w ON w.nodus_id=p.nodus_id
      WHERE p.passage_id=? AND w.archived=0 AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))`);
    const kept = [];
    for (const id of ranked) {
      const row = read.get(id);
      if (row && (!scope || scope.has(row.nodus_id))) kept.push(row.passage_id);
      if (kept.length === limit * 4) break;
    }
    return kept;
  }

  // Count the rows any one statement hands back, to see whether the ranking is read whole.
  let largest = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    statement.all = (...args) => { const rows = all(...args); largest = Math.max(largest, rows.length); return rows; };
    return statement;
  };
  const cases = [['ester reflux', 6, null], ['ketone', 24, null], ['aldol acid', 6, ['w1', 'w5', 'w7', 'w9']], ['ethanol yield', 3, ['w11']], ['nitration', 50, null], ['missingword', 6, null]];
  for (const [query, limit, scope] of cases) {
    largest = 0;
    const hits = passages.lexicalPassageSearch(query, limit, scope ? { nodusIds: scope } : {});
    const lane = largest;
    db.prepare = prepare;
    const expected = reference(query, limit, scope);
    db.prepare = sql => { const statement = prepare(sql); const all = statement.all.bind(statement); statement.all = (...args) => { const rows = all(...args); largest = Math.max(largest, rows.length); return rows; }; return statement; };
    // The lane re-ranks its pool by coverage; the pool itself must be the same rows.
    const pool = new Set(expected);
    assert.ok(hits.every(hit => pool.has(hit.passage_id)), `${query}: every hit comes from the same candidate pool`);
    assert.equal(hits.length, Math.min(limit, expected.length), `${query}: as many hits as before`);
    assert.ok(hits.every(hit => hit.nodus_id !== 'w5' && hit.nodus_id !== 'w7' && (!scope || scope.includes(hit.nodus_id))), `${query}: archived, stale and out-of-scope works stay out`);
    assert.ok(lane <= Math.max(limit * 8, 64), `${query}: no statement returned more than a page of the ranking (largest ${lane})`);
  }
  db.prepare = prepare;
  console.log('Lexical passage lane: same candidate pool, ranking read by page and inside the scope.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
