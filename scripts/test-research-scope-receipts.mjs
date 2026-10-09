// Citation receipts of a research scope: one row each, no lifetime limit, and the bytes a
// citation was issued against are what it keeps resolving to.
//
// Receipts used to live as a map inside the scope's own `scope_json`, beside a manifest of every
// authorized document — megabytes of it on a real library — so recording one rewrote the whole
// row and counting them parsed the whole row. A hard limit of 512 bounded that cost, and reaching
// it refused every passage found afterwards for the rest of the scope's life, silently: the
// prompt simply said no source text was found while the corpus held thousands of matching
// passages. These assertions are what would have caught it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-scope-receipts')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-receipts-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in receipt fixture'); };

// Comfortably past the limit the in-JSON store used to impose, so a reintroduced cap at that
// value — or any value a few days of real runs would reach — fails here instead of in a run.
const PASSAGES = 600;
const OLD_LIMIT = 512;

try {
  const db = load('electron/db/database.ts').getDb();
  const passages = load('electron/db/passagesRepo.ts');
  db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
    VALUES('inside','inside','inside','[]',2020,'book','text','hash')`).run();
  passages.replaceWorkPassages('inside', 'hash', Array.from({ length: PASSAGES }, (_, i) => ({
    text: `measure inside evidence ${i}`, pageLabel: String(i), embedding: null })));

  const notebookService = load('electron/ai/researchNotebookService.ts');
  const notebook = notebookService.saveResearchNotebook({ name: 'receipts', mode: 'fixed', sources: [{ kind: 'work', id: 'inside' }], exclusions: [] });
  const scope = notebookService.resolveResearchNotebook(notebook.id);
  const legacy = load('electron/citations/scopedLegacyCitations.ts');

  const ids = db.prepare("SELECT passage_id FROM passages WHERE nodus_id='inside' ORDER BY chunk_index").all().map(row => row.passage_id);
  assert.equal(ids.length, PASSAGES);

  // Record every passage. None may be refused, whatever has been recorded before it.
  const citations = ids.map((passageId, index) => {
    const detail = legacy.recordScopedLegacyPassage(scope, passageId);
    assert.ok(detail, `passage ${index + 1} of ${PASSAGES} was refused a receipt`);
    return detail.passage_id;
  });
  assert.ok(citations.length > OLD_LIMIT, 'fixture must cross the old limit to be meaningful');

  // Every citation resolves — including the ones past the old limit, which used to be refused,
  // and the earliest, which an eviction policy would have discarded to make room for them.
  for (const [index, citation] of citations.entries()) {
    const resolved = legacy.getScopedLegacyPassageDetail(citation);
    assert.ok(resolved, `citation ${index + 1} of ${PASSAGES} no longer resolves`);
    assert.equal(resolved.text, `measure inside evidence ${index}`);
  }
  assert.ok(legacy.getScopedLegacyPassageDetail(citations[0]), 'the oldest receipt survives recording far past the old limit');
  assert.ok(legacy.getScopedLegacyPassageDetail(citations[OLD_LIMIT]), 'the receipt one past the old limit resolves');

  // One row per receipt, and the scope's JSON is not where they go: that co-location is what
  // made each receipt cost a rewrite of the whole manifest, and what forced a limit.
  const rows = db.prepare('SELECT COUNT(*) n FROM research_scope_receipts WHERE scope_id=?').get(scope.id).n;
  assert.equal(rows, PASSAGES, 'every receipt has its own row');
  const inJson = db.prepare(`SELECT (SELECT COUNT(*) FROM json_each(scope_json,'$.legacyEvidence')) n
    FROM research_run_scopes WHERE id=?`).get(scope.id).n;
  assert.equal(inJson, 0, 'receipts must not be written into the scope JSON column');

  // The point-in-time guarantee, which is the whole reason a receipt keeps the bytes: `passages`
  // is mutable and a rebuild re-extracts it, so a citation must not start reading as the new text.
  db.prepare("UPDATE passages SET text='replacement text' WHERE nodus_id='inside'").run();
  assert.equal(legacy.getScopedLegacyPassageDetail(citations[0]).text, 'measure inside evidence 0',
    'a rebuilt passage row cannot replace the text a citation was issued against');
  assert.equal(legacy.getScopedLegacyPassageDetail(citations[PASSAGES - 1]).text, `measure inside evidence ${PASSAGES - 1}`);

  // An unknown citation resolves to nothing rather than to something else.
  const unknown = citations[0].replace(/.$/, citations[0].endsWith('0') ? '1' : '0');
  assert.equal(legacy.getScopedLegacyPassageDetail(unknown), null, 'an unknown citation id resolves to nothing');

  // And a receipt ROW edited behind the app's back is rejected. Now that the receipt lives in its
  // own table rather than inside the scope row it is authorized against, the fingerprint carried
  // in the citation is the only thing binding the two — so this has to be tested by rewriting the
  // stored row, not merely by altering an id, which would fail for the trivial reason of matching
  // no row at all.
  const stored = db.prepare('SELECT scope_id, key, receipt_json FROM research_scope_receipts LIMIT 1').get();
  const forged = JSON.parse(stored.receipt_json);
  forged.text = 'text the citation was never issued against';
  db.prepare('UPDATE research_scope_receipts SET receipt_json=? WHERE scope_id=? AND key=?')
    .run(JSON.stringify(forged), stored.scope_id, stored.key);
  const forgedCitation = citations.find(citation => citation.includes(stored.key));
  if (forgedCitation) {
    assert.equal(legacy.getScopedLegacyPassageDetail(forgedCitation), null,
      'a receipt row rewritten behind the app is rejected by its fingerprint');
  } else {
    assert.fail('could not match a stored receipt row to its citation');
  }

  console.log(`scope receipts: ${PASSAGES} recorded and resolved, ${PASSAGES - OLD_LIMIT} of them past the old ${OLD_LIMIT} limit`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
