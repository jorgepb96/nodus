// A failed automatic Zotero read re-checks the whole scope against the corpus inventory. That check
// looked each scope document up with a linear find over the inventory: quadratic in the library,
// 1.7 s of the main thread per failed read on a 14,000-work library. It must stay linear.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-zotero-scope-check')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-zotero-scope-check-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  globalThis.fetch = () => { throw new Error('Network forbidden in this test'); };
  const WORKS = Number(process.env.NODUS_TEST_WORKS ?? 3000);
  const db = load('electron/db/database.ts').getDb();
  const insert = db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,zotero_version) VALUES(?,?,?,'[\"Test, Ana\"]',2026,'book','zotero',1)");
  db.transaction(() => { for (let index = 0; index < WORKS; index += 1) insert.run(`W${index}`, `K${String(index).padStart(7, '0')}`, `Work ${index}`); })();
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  assert.equal(scope.documents.length, WORKS);
  // Count how often the check reads an inventory document's id: the measure of its work.
  const inventory = load('electron/ai/researchCorpusInventory.ts');
  const build = inventory.researchCorpusInventory;
  let reads = 0;
  inventory.researchCorpusInventory = () => {
    const built = build();
    return { ...built, documents: built.documents.map(document => {
      const counted = { ...document };
      Object.defineProperty(counted, 'id', { enumerable: true, get() { reads += 1; return document.id; } });
      return counted;
    }) };
  };
  // Automatic access is off: the session refuses to start, and the failure path checks the scope.
  load('electron/ai/documentaryPreparation.ts').documentaryStore().setPreference('managed-zotero-disabled', true);
  const { readAutomaticResearchZotero } = load('electron/mcp/researchZotero.ts');
  const started = performance.now();
  await assert.rejects(readAutomaticResearchZotero(scope, { documentId: scope.documents.at(-1).id, from: 1 }), /research_mcp_disabled/);
  const elapsed = performance.now() - started;
  assert.ok(reads > 0, 'the scope was checked against the inventory');
  console.log(`failed read with ${WORKS} documents in scope: ${elapsed.toFixed(0)} ms, ${reads} id reads`);
  assert.ok(reads <= 10 * WORKS, `checking ${WORKS} documents read inventory ids ${reads} times: linear is at most ${10 * WORKS}`);
  console.log(`Zotero scope check: ${reads} inventory id reads for ${WORKS} documents, ${elapsed.toFixed(0)} ms.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
