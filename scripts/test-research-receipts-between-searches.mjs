// The vault must not change between the searches of one chat turn because of the turn's own
// citation receipts. The vector scan worker reads PRAGMA data_version from its own connection, and
// any change makes it reload every table's vectors before the next scan.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (requireElectronRuntime(fileURLToPath(import.meta.url), '--native-receipts-between-searches')) {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-receipts-between-searches-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('network forbidden'); };
const db = load('electron/db/database.ts').getDb();
const passages = load('electron/db/passagesRepo.ts');
for (let w = 0; w < 6; w++) {
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type) VALUES(?,?,?,'[]',2000,'book','text')").run(`w${w}`, `w${w}`, `Work ${w}`);
  passages.replaceWorkPassages(`w${w}`, `h${w}`, Array.from({ length: 8 }, (_, i) => ({ text: `${['esterification','nitration','reduction','oxidation','hydrolysis','acylation'][w]} topic${w} passage ${i} ${'word '.repeat(i)}`, pageLabel: String(i + 1), embedding: null })));
}
const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
const reader = new Database(db.name, { readonly: true });
const version = () => reader.pragma('data_version', { simple: true });
const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
const preparation = load('electron/ai/documentaryPreparation.ts');
preparation.getResearchPreparationInventory = () => ({ documents: [] });
preparation.retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
const ai = load('electron/ai/aiClient.ts');
ai.embed = async () => null; ai.embedMany = async texts => texts.map(() => null);
let decisions = 0;
ai.completeJson = async () => (++decisions > 4 ? { action: 'finish' } : { action: 'search', query: ['reduction topic2', 'oxidation topic3', 'hydrolysis topic4', 'acylation topic5'][decisions - 1] });
const hier = load('electron/ai/hierarchicalRetrieval.ts');
const real = hier.retrieveHierarchical;
const seen = [];
hier.retrieveHierarchical = (...args) => { seen.push(version()); return real(...args); };
const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
const { RESEARCH_CHAT_AGENT_SETTINGS } = load('shared/researchCorpus.ts');
const { literalResearchTurnPlan } = load('electron/ai/researchTurnPlanner.ts');
test('the turn writes its citation receipts once, after its searches, not between them', async () => {
  const run = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  run.agent = { plan: { ...literalResearchTurnPlan('x'), queries: ['nitration topic1', 'reduction topic2'] }, question: 'x', compact: false, minSources: 1 };
  await run.investigate('esterification topic0');
  const changes = seen.slice(1).filter((v, i) => v !== seen[i]).length;
  console.log(`${seen.length} searches; the vault changed before ${changes} of the ${seen.length - 1} later ones; evidence ${run.evidence.size}`);
  assert.ok(seen.length >= 4, 'the turn searched');
  assert.ok(run.evidence.size > 0, 'and found evidence');
  assert.equal(changes, 0);
  const receipts = db.prepare('SELECT COUNT(*) AS n FROM research_scope_receipts').get().n;
  assert.ok(receipts > 0, 'the receipts were written when the turn ended');
  reader.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});
}
