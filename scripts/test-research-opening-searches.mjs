// The chat's opening searches: their queries are embedded in one request, and a failure on any of
// them (the first included) costs that search's evidence, not the turn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (requireElectronRuntime(fileURLToPath(import.meta.url), '--native-opening-searches')) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-opening-searches-'));
  installRuntimeHooks(scratch);
  const require = createRequire(import.meta.url);
  const load = file => require(path.join(repoRoot, file));
  globalThis.fetch = () => { throw Error('Network forbidden in inventory regression tests'); };
  const dbModule = load('electron/db/database.ts');
  const db = dbModule.getDb();
  const insert = db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type) VALUES(?,?,?,?,?,'book','text')");
  db.transaction(() => { for (let i = 0; i < 300; i++) insert.run(`w${i}`, `K${String(i).padStart(7, '0')}`, `Work ${i} on aromatic esters`, JSON.stringify([`Author ${i % 50}, A.`]), 1950 + i % 70); })();
  const inventory = load('electron/ai/researchCorpusInventory.ts');
  const build = inventory.researchCorpusInventory;
  let builds = 0;
  inventory.researchCorpusInventory = () => { builds++; return build(); };
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.getResearchPreparationInventory = () => ({ documents: [] });
  // The documentary search checks the inventory before and after its worker, as the real one does.
  preparation.retrieveSharedDocumentaryEvidence = async (_scope, _query, _settings, _vector, _signal, _read, current = () => inventory.researchCorpusInventory().documents) => {
    current(); current();
    return { evidence: [], traversal: { rounds: 1, candidates: 0, partial: false, evidenceTokens: 0, visited: [] } };
  };
  const ai = load('electron/ai/aiClient.ts');
  let single = 0, batched = 0;
  ai.embed = async () => { single++; return [1, 0]; };
  ai.embedMany = async (texts) => { batched++; return texts.map(() => [1, 0]); };
  let decisions = 0;
  ai.completeJson = async () => (++decisions > 8 ? { action: 'finish' } : { action: 'search', query: `query ${decisions}` });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RESEARCH_CHAT_AGENT_SETTINGS, RESEARCH_CHAT_AGENT_DECISION_BYTES } = load('shared/researchCorpus.ts');
  const { literalResearchTurnPlan } = load('electron/ai/researchTurnPlanner.ts');
  test.after(() => { dbModule.closeDb(); fs.rmSync(scratch, { recursive: true, force: true }); });

  const turn = () => {
    const run = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
    run.budget.decisionTokenLimit = RESEARCH_CHAT_AGENT_DECISION_BYTES;
    run.agent = { plan: { ...literalResearchTurnPlan('aromatic esters'), queries: ['aromatic esters', 'nitration of arenes', 'esterification'] }, question: 'aromatic esters', compact: false, minSources: 1 };
    return run;
  };
  const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

  test('the opening queries are embedded in one request', async () => {
    decisions = 9; single = 0; batched = 0;
    const run = turn();
    await quiet(() => run.investigate('methyl 4-nitrobenzoate; Fischer esterification; aromatic nitration'));
    console.log(`opening searches: ${batched} batched request(s), ${single} single embedding request(s)`);
    assert.equal(batched, 1);
    assert.equal(single, 0);
  });

}
