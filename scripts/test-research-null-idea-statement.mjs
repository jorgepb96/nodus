import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-null-idea-statement')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-null-statement-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in this fixture'); };

// A real library held 6 ideas with no statement. Research Chat's idea lane charged each idea's
// statement to the evidence budget with Buffer.byteLength, and a question that reached one of
// them failed with «The "string" argument must be of type string … Received null».
try {
  const db = load('electron/db/database.ts').getDb();
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type) VALUES('w','w','Relatos de viaje','[]',2015,'book','text')").run();
  db.prepare("INSERT INTO ideas(global_id,type,label,statement) VALUES ('empty','claim','relato de viaje sin enunciado',NULL)").run();
  db.prepare("INSERT INTO ideas(global_id,type,label,statement) VALUES ('full','claim','relato de viaje','El relato de viaje es un género factual.')").run();
  for (const id of ['empty', 'full']) db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES (?,'w','principal',1)").run(id);
  const ai = load('electron/ai/aiClient.ts');
  ai.embedQuery = async () => null;
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.balanced);
  await run.retrieve('relato de viaje');
  const ideas = [...run.ideas.values()];
  assert.ok(ideas.some(idea => idea.id === 'full'), 'an idea with a statement is still retrieved');
  const empty = ideas.find(idea => idea.id === 'empty');
  assert.ok(!empty || (typeof empty.statement === 'string' && empty.statement === 'relato de viaje sin enunciado'), 'an idea without a statement reads as its label, never as null');
  console.log('Ideas without a statement no longer break Research Chat retrieval.');
} finally {
  await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
