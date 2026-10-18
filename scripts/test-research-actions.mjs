import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-actions')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-actions-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const { validResearchAction } = load('shared/researchActions.ts');
  for (const value of [{ action: 'web', query: 'anything' }, { action: 'finish', command: 'anything' }, { action: 'original', documentId: 'x', from: 1, to: 100 }, { action: 'read', documentId: 'x', operation: { kind: 'search', query: 'a', path: '/etc/passwd' } }]) assert.equal(validResearchAction(value), false);
  // The web step exists only for the runs that were granted it: same action, two answers.
  const web = { action: 'web', queries: ['represión franquista posguerra víctimas'], intent: 'expand' };
  assert.equal(validResearchAction(web), false, 'a library-only run never accepts a web step');
  assert.equal(validResearchAction(web, true), true);
  assert.equal(validResearchAction({ ...web, queries: [] }, true), false);
  assert.equal(validResearchAction({ ...web, queries: ['a', 'b', 'c', 'd', 'e'] }, true), false);
  assert.equal(validResearchAction({ ...web, intent: 'browse' }, true), false);
  const db = load('electron/db/database.ts').getDb();
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('inside','inside','Inside','[]','book','text')").run();
  const passages = load('electron/db/passagesRepo.ts');
  passages.replaceWorkPassages('inside', 'hash', [{ text: 'Known evidence about climate', pageLabel: '2', embedding: null }]);
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const ai = load('electron/ai/aiClient.ts');
  ai.embedQuery = async () => null;
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const settings = { ...load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep, preset: 'custom', evidenceTokens: 64000 };
  let decisions = 0;
  ai.completeJson = async (options, guard) => {
    decisions++; assert.equal(options.noRetry, true); assert.equal(options.corpusContext, true);
    const action = decisions === 1 ? { action: 'search', query: 'climate' } : { action: 'finish' };
    assert.equal(guard(action), true); return action;
  };
  const run = new ResearchCorpusRun(scope, settings);
  await run.investigate('Known evidence');
  assert.equal(decisions, 2);
  assert.equal(run.budget.rounds, 2);
  assert.ok(run.coverage().decisionTokens > 0);
  assert.ok(run.evidence.size > 0);
  assert.deepEqual(run.coverage().readDocumentIds, [], 'search results are not original reads');
  assert.deepEqual(run.coverage().matchedDocumentIds, [scope.documents[0].id]);
  const off = new ResearchCorpusRun(scope, { ...settings, autoExpand: false });
  await off.investigate('Known evidence');
  assert.equal(decisions, 2, 'Auto Expand off dispatches no supervisor');
  await off.readDocument(scope.documents[0].id, { kind: 'search', query: 'climate' });
  assert.equal(off.budget.rounds, 2, 'explicit reads still have a shared finite allowance');
  ai.completeJson = async () => { throw new Error('schema_mismatch'); };
  const invalid = new ResearchCorpusRun(scope, settings);
  await invalid.investigate('Known evidence');
  assert.ok(invalid.evidence.size > 0);
  assert.ok(invalid.coverage().limitations.includes('research_decision_unavailable'));
  ai.completeJson = async () => ({ action: 'original', documentId: 'foreign', from: 1 });
  const foreign = new ResearchCorpusRun(scope, settings);
  await foreign.investigate('Known evidence');
  assert.ok(foreign.evidence.size > 0);
  assert.ok(foreign.coverage().limitations.includes('research_decision_outside_scope'), 'invalid model identifiers execute nothing and preserve valid evidence');
  // A source without an index cannot be found by search. The supervisor is told which one
  // it is, and a source whose title matches the question is read in the original even when
  // the supervisor finishes without it (the integral run's unindexed A3 and Z3).
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('pleito','pleito','El pleito de las aguas de Sarbela','[]','book','text')").run();
  const withUnindexed = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const unindexedId = withUnindexed.documents.find(document => document.workId === 'pleito').id;
  const payloads = [];
  ai.completeJson = async options => { payloads.push(JSON.parse(options.user)); return { action: 'finish' }; };
  const originals = [];
  const guarded = new ResearchCorpusRun(withUnindexed, settings);
  guarded.readOriginal = async (documentId, read) => { originals.push({ documentId, read }); return { evidence: [], scopeId: withUnindexed.id, partial: false }; };
  await guarded.investigate('¿Quién fue el árbitro del pleito de las aguas de Sarbela?');
  assert.equal(payloads[0].sources.find(source => source.id === unindexedId)?.searchable, false, 'the supervisor sees which source has no index');
  assert.deepEqual(originals, [{ documentId: unindexedId, read: { kind: 'pages', from: 1, to: 4 } }], 'the matching unindexed source is read in the original');
  originals.length = 0;
  await new ResearchCorpusRun(withUnindexed, settings).investigate('Known evidence about climate').then(() => undefined);
  const unrelated = new ResearchCorpusRun(withUnindexed, settings);
  unrelated.readOriginal = async (documentId, read) => { originals.push({ documentId, read }); return { evidence: [], scopeId: withUnindexed.id, partial: false }; };
  await unrelated.investigate('Known evidence about climate');
  assert.deepEqual(originals, [], 'an unrelated unindexed source is not opened');
  const { ResearchRetrievalBudget } = load('shared/researchRetrievalBudget.ts');
  // A supervisor decision is its own provider call: it must not take the evidence the
  // answer needs. Each has a finite allowance of the same size.
  const budget = new ResearchRetrievalBudget({ ...settings, evidenceTokens: 4000 });
  assert.ok(budget.reserveDecision('system', 'question', 200));
  assert.equal(budget.decisionTokens, 1238);
  assert.equal(budget.accept('evidence', 'a'.repeat(3000)), true, 'a decision leaves the evidence allowance whole');
  assert.equal(budget.accept('oversized', 'a'.repeat(1500)), false, 'evidence stays within its own allowance');
  assert.ok(budget.reserveDecision('system', 'question', 200));
  assert.ok(budget.reserveDecision('system', 'question', 200));
  assert.equal(budget.reserveDecision('system', 'question', 200), false, 'decisions have a finite allowance of their own');
  assert.equal(budget.partial, true);
  console.log('Structured actions, invalid decisions, independent source search, separate evidence and decision allowances, explicit reads and scope rejection passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
