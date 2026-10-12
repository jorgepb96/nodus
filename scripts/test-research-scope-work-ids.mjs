// A research scope check (resolveAcademicResearchScope, run several times per research turn) needs
// only which works a source filter admits. It computed the filter's whole source scope (ideas with
// strict provenance, themes, authors, edges) and dropped all but the works: ~0.24 s per check on a
// 14,000-work library. The scope must be the same, and those tables must not be read for it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-scope-work-ids')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-research-scope-work-ids-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  globalThis.fetch = () => { throw new Error('Network forbidden in this test'); };
  const db = load('electron/db/database.ts').getDb();
  const work = db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type) VALUES(?,?,?,'[\"Test, Ana\"]',2020,'book','text')");
  const occurs = db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role) VALUES(?,?,'x')");
  db.transaction(() => {
    for (let index = 0; index < 12; index += 1) work.run(`W${index}`, `K${index}`, `Work ${index}`);
    for (let idea = 0; idea < 20; idea += 1) occurs.run(`I${idea}`, `W${idea % 12}`);
  })();
  const { resolveAcademicResearchScope } = load('electron/ai/researchNotebookService.ts');
  const whole = resolveAcademicResearchScope();
  assert.equal(whole.documents.length, 12);
  const chosen = ['W1', 'W4', 'W7', 'W-absent'];
  const statements = [];
  const prepare = db.prepare.bind(db);
  db.prepare = sql => { statements.push(sql); return prepare(sql); };
  const narrowed = resolveAcademicResearchScope({ enabled: true, authorIds: [], workIds: chosen });
  db.prepare = prepare;
  assert.deepEqual(narrowed.documents.map(document => document.workId).sort(), ['W1', 'W4', 'W7'], 'the filter admits exactly its works');
  assert.deepEqual(narrowed.documents, whole.documents.filter(document => ['W1', 'W4', 'W7'].includes(document.workId)), 'each admitted document is the one the whole library resolves');
  assert.equal(resolveAcademicResearchScope({ enabled: false, authorIds: [], workIds: ['W1'] }).documents.length, 12, 'a disabled filter does not restrict');
  const unused = statements.filter(sql => /\b(idea_occurrences|work_themes|idea_theme_links|edges|evidence)\b/.test(sql));
  assert.deepEqual(unused, [], 'a scope check reads no idea, theme, author-link or edge table');
  console.log(`Research scope work ids: same documents, ${statements.length} statements, none over ideas, themes or edges.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
