// The scoped idea-evidence lane: an explicit quote of a mixed-work idea routes to the passages it
// occurs in. It must return exactly what the single statement it replaced returned (kept below as
// the reference), and must not test every quote against every passage of its work: with half of
// a real library in scope that took 11-19 s of the main thread per research search.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--scoped-idea-evidence')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-scoped-idea-evidence-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const REFERENCE = `WITH allowed AS (SELECT value FROM json_each(?)), terms AS (SELECT value FROM json_each(?))
    SELECT DISTINCT p.passage_id,p.nodus_id,p.text,p.page_label,p.source_ref,p.page_number,
      w.title,w.authors_json,w.year,w.zotero_key,
      (SELECT COUNT(*) FROM terms WHERE instr(lower(p.text),value)>0) similarity
    FROM evidence e JOIN passages p ON p.nodus_id=e.nodus_id JOIN works w ON w.nodus_id=p.nodus_id
    WHERE e.nodus_id IN (SELECT value FROM allowed) AND w.archived=0 AND e.kind='explicit'
      AND length(trim(e.quote))>=16 AND instr(p.text,e.quote)>0
      AND EXISTS (SELECT 1 FROM terms WHERE instr(lower(e.quote),value)>0)
      AND EXISTS (SELECT 1 FROM idea_occurrences other WHERE other.global_id=e.global_id AND other.nodus_id NOT IN (SELECT value FROM allowed))
      AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))
    ORDER BY similarity DESC,p.passage_id LIMIT ?`;
try {
  const db = load('electron/db/database.ts').getDb();
  const { scopedIdeaEvidencePassages } = load('electron/ai/researchSourceScope.ts');
  const reference = (query, workIds, limit) => {
    const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 32);
    if (!workIds.length || limit <= 0 || !terms.length) return [];
    return db.prepare(REFERENCE).all(JSON.stringify(workIds), JSON.stringify(terms), Math.min(500, limit)).map(row => ({ ...row, lanes: ['support'] }));
  };
  const work = db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,deep_hash,resolved_text_hash) VALUES(?,?,?,'[]',2020,'book','text',?,?,?)");
  const passage = db.prepare("INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at,page_number) VALUES(?,?,?,?,?,?,?,'2026-01-01',?)");
  const evidence = db.prepare('INSERT INTO evidence(id,global_id,nodus_id,quote,kind) VALUES(?,?,?,?,?)');
  const occurs = db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role) VALUES(?,?,'x')");

  // ---- equivalence: every condition of the reference, on a small library
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const words = ['Ester', 'ester', 'AMIDE', 'amide', 'Hydrolysis', 'acid', 'base', 'Ö-ring', 'ÉTHER', 'éther', 'chloride', 'reduction', 'nitro', 'amine', 'the', 'of', 'and', 'a', '𝛼-carbon', 'İstanbul'];
  const sentence = count => Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(' ');
  db.transaction(() => {
    for (let w = 0; w < 12; w += 1) {
      // Hash rules: resolved text hash, else deep hash, else any passage; one work archived.
      const resolved = w % 4 === 0 ? 'R' : null, deep = w % 4 === 1 ? 'D' : null;
      work.run(`W${w}`, `K${w}`, `Work ${w}`, w === 11 ? 1 : 0, deep, resolved);
      const texts = [];
      for (let p = 0; p < 30; p += 1) {
        const text = sentence(40 + Math.floor(random() * 40));
        texts.push(text);
        const hash = p % 7 === 0 ? 'OTHER' : resolved ?? deep ?? 'ANY';
        passage.run(`P${w}-${String(p).padStart(2, '0')}`, `W${w}`, p, text, String(p + 1), text.length, hash, p + 1);
      }
      for (let e = 0; e < 25; e += 1) {
        const text = texts[Math.floor(random() * texts.length)];
        const from = Math.floor(random() * Math.max(1, text.length - 40));
        // Quotes taken from passages (some trimmed short, some padded, some absent from any text).
        let quote = text.slice(from, from + 10 + Math.floor(random() * 40));
        if (e % 9 === 0) quote = `  ${quote.slice(0, 15)}`;
        if (e % 11 === 0) quote = `${quote} not in any passage`;
        evidence.run(`E${w}-${e}`, `I${(w * 25 + e) % 40}`, `W${w}`, quote, e % 6 === 0 ? 'implicit' : 'explicit');
      }
    }
    // Ideas occur in a spread of works, so a narrower scope leaves some of them outside.
    for (let i = 0; i < 40; i += 1) for (let w = 0; w < 12; w += 1) if ((i + w) % 3 === 0) occurs.run(`I${i}`, `W${w}`);
  })();
  const all = Array.from({ length: 12 }, (_, w) => `W${w}`);
  const scopes = [all, all.slice(0, 6), all.filter((_, w) => w % 2), ['W3'], ['W0', 'W1', 'W11'], Array.from({ length: 1200 }, (_, w) => `W${w}`)];
  const queries = ['ester hydrolysis', 'AMIDE amine', 'éther', 'ÉTHER chloride reduction', 'the of and', 'istanbul İstanbul', '𝛼-carbon nitro', 'nothing matches here'];
  let compared = 0, nonEmpty = 0;
  for (const scope of scopes) for (const query of queries) for (const limit of [1, 5, 60, 900]) {
    const expected = reference(query, scope, limit);
    assert.deepEqual(scopedIdeaEvidencePassages(query, scope, limit), expected, `${query} · ${scope.length} works · limit ${limit}`);
    compared += 1; if (expected.length) nonEmpty += 1;
  }
  assert.ok(nonEmpty > compared / 3, `the fixture exercises matches (${nonEmpty} of ${compared} non-empty)`);

  // ---- cost: many quotes against a long work
  const QUOTES = 600, PASSAGES = 4000;
  db.transaction(() => {
    work.run('BIG', 'KBIG', 'Big work', 0, null, null);
    for (let p = 0; p < PASSAGES; p += 1) {
      const text = p === PASSAGES - 1 ? `${sentence(300)} the one ester passage quoted 98765 ${sentence(10)}` : sentence(320);
      passage.run(`PB-${p}`, 'BIG', p, text, String(p + 1), text.length, 'ANY', p + 1);
    }
    for (let e = 0; e < QUOTES; e += 1) {
      // Each quote names a query term and is outside every passage, so every passage is searched.
      evidence.run(`EB-${e}`, `IB${e}`, 'BIG', `ester quote number ${e} that no passage holds`, 'explicit');
      occurs.run(`IB${e}`, 'W0');
    }
    evidence.run('EB-hit', 'IB0', 'BIG', 'the one ester passage quoted 98765', 'explicit');
  })();
  const started = performance.now();
  const found = scopedIdeaEvidencePassages('ester', ['BIG'], 60);
  const elapsed = performance.now() - started;
  assert.deepEqual(found.map(row => row.passage_id), [`PB-${PASSAGES - 1}`]);
  console.log(`scoped idea evidence: ${compared} cases identical to the reference; ${QUOTES} quotes over ${PASSAGES} passages in ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed < 1500, `${QUOTES} quotes over ${PASSAGES} passages took ${elapsed.toFixed(0)} ms: each passage must be searched once, not once per quote`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
