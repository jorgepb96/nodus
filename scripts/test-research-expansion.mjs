import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-expansion')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-expansion-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in expansion fixtures'); };
try {
  const db = load('electron/db/database.ts').getDb();
  for (const [id, title] of [['tourism', 'Turismo e imagen exterior durante el franquismo'], ['excluded', 'Private excluded source']]) {
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES(?,?,?,'[]','book','text')").run(id, id, title);
  }
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope({ enabled: true, workIds: ['tourism'], authorIds: [] });
  assert.equal(scope.documents.length, 1);
  const { withResearchHarness, currentResearchHarness } = load('electron/ai/researchHarnessRuntime.ts');
  const { planResearchTurn } = load('electron/ai/researchTurnPlanner.ts');
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { ResearchAgenda } = load('shared/researchHarness.ts');
  const { validResearchAction } = load('shared/researchActions.ts');
  const { RETRIEVAL_PRESETS, RESEARCH_CHAT_AGENT_DECISION_BYTES } = load('shared/researchCorpus.ts');
  const ai = load('electron/ai/aiClient.ts');
  const goal = '¿Cómo se relacionó el turismo con la economía y la imagen exterior durante el franquismo?';
  const branches = [
    { question: '¿Qué relación tuvo el turismo con las divisas bajo el franquismo?', query: 'turismo franquismo divisas política económica', purpose: 'Examinar la dimensión económica de la pregunta sin asumir un efecto causal.', relation: 'mechanism', priority: 3 },
    { question: '¿Coincidieron propaganda y recepción extranjera en España?', query: 'España franquismo propaganda turismo recepción extranjeros', purpose: 'Contrastar la imagen proyectada con la recepción para responder sobre imagen exterior.', relation: 'contrast', priority: 2 },
    { question: '¿Qué cambios hubo en la vida local de los destinos turísticos?', query: 'franquismo turismo vida cotidiana destinos trabajo', purpose: 'Contextualizar el alcance social del desarrollo turístico durante el periodo preguntado.', relation: 'context', priority: 1 },
  ];
  const context = { mode: 'chat', vaultId: scope.vaultId, scopeId: scope.id, notebookId: null, objective: goal, model: null, effort: 'standard', capabilities: { ideas: true, indexed: true, documents: true, web: false, attachments: [], skills: [], restricted: true } };
  const input = { request: {}, scope, context, validate: () => {} };
  const basePlan = { goal, queries: ['turismo franquismo economía imagen exterior'], authors: [], titles: [], explicitLibrary: true, kind: 'survey', needsSources: true, answerMode: 'documentary' };
  let lastOptions;
  ai.completeJson = async (options, guard) => {
    lastOptions = options;
    const result = { ...basePlan, exploration: [...branches, { ...branches[0], query: `  ${branches[0].query.toUpperCase()}  ` }] };
    assert.equal(guard(result), true); return result;
  };
  const legacy = await planResearchTurn([{ role: 'user', content: goal }]);
  assert.equal(legacy.exploration, undefined, 'legacy does not activate the extension');
  assert.equal(lastOptions.maxTokens, 500);
  let planned;
  await withResearchHarness(input, async () => {
    planned = await planResearchTurn([{ role: 'user', content: goal }]);
    assert.equal(planned.exploration.length, 3, 'normalized duplicate queries do not create extra branches');
    assert.equal(JSON.parse(lastOptions.user).capabilities.web, false);
    assert.match(lastOptions.system, /Operational|operational/);
    return {};
  });
  const planner = ai.completeJson;
  for (const patch of [{ kind: 'fact' }, { needsSources: false }, { answerMode: 'constructive' }]) {
    ai.completeJson = async (options, guard) => { const result = { ...basePlan, ...patch, exploration: branches }; assert.ok(guard(result)); return result; };
    await withResearchHarness(input, async () => {
      assert.deepEqual((await planResearchTurn([{ role: 'user', content: goal }])).exploration, []);
      return {};
    });
  }
  ai.completeJson = async (options, guard) => {
    assert.equal(guard({ ...basePlan, exploration: Array(5).fill(branches[0]) }), false);
    assert.equal(guard({ ...basePlan, exploration: [{ ...branches[0], purpose: undefined }] }), false);
    assert.equal(guard({ ...basePlan, exploration: [{ ...branches[0], command: '/bin/sh' }] }), false);
    throw new Error('invalid plan');
  };
  await withResearchHarness(input, async () => {
    assert.equal((await planResearchTurn([{ role: 'user', content: goal }])).planned, false);
    return {};
  });
  ai.completeJson = planner;
  await withResearchHarness(input, async () => {
    const focused = await planResearchTurn([{ role: 'user', content: 'Copia una sola oración literalmente de la fuente.' }]);
    assert.deepEqual(focused.exploration, [], 'A single literal excerpt does not launch peripheral research questions');
    return {};
  });
  const intent = { purpose: branches[0].purpose, relation: branches[0].relation };
  assert.equal(validResearchAction({ action: 'enqueue', queries: [{ ...branches[0] }] }, false, false, true), true);
  assert.equal(validResearchAction({ action: 'enqueue', queries: [{ ...branches[0], relation: 'arbitrary-tool' }] }, false, false, true), false);
  const agenda = new ResearchAgenda(goal);
  const task = agenda.enqueue({ action: 'search', query: branches[0].query }, branches[0].question, 2, intent);
  const restored = new ResearchAgenda(goal);
  restored.restore({ tasks: agenda.tasks, questions: agenda.questions, stagnant: 0, strategyChanges: 0 });
  restored.assess([{ question: task.question, status: 'supported', evidenceIds: ['fabricated'] }], new Set());
  assert.equal(restored.questions[0].status, 'partial', 'purpose is not support');
  assert.equal(restored.questions[0].purpose, intent.purpose, 'intent survives checkpoints and assessments');
  assert.equal(validResearchAction({ action: 'search', query: 'refined', taskId: task.id }), false, 'legacy retains its vocabulary');
  assert.equal(validResearchAction({ action: 'search', query: 'refined', taskId: task.id }, false, false, true), true);
  assert.equal(restored.refineSearch('invented', 'refined'), undefined);
  const refined = restored.refineSearch(task.id, 'refined');
  assert.equal(refined.question, branches[0].question);
  assert.equal(refined.purpose, intent.purpose);
  const optional = new ResearchAgenda(goal); optional.addQuestion(goal);
  const dispensable = optional.enqueue({ action: 'search', query: 'peripheral' }, 'Peripheral question?', 1, intent);
  dispensable.status = 'deferred';
  assert.equal(optional.canFinish(), false, 'deferring a branch does not answer the original objective');
  optional.assess([{ question: goal, status: 'supported', evidenceIds: ['real'] }], new Set(['real']));
  assert.equal(optional.canFinish(), true, 'an explicitly deferred optional branch does not force endless research');

  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.getResearchPreparationInventory = () => ({ documents: scope.documents.map(document => ({ id: document.id, preparation: { text: 'available', lexical: 'ready', embeddings: 'ready' } })) });
  const searches = [], embeddingBatches = [];
  ai.embedQuery = async query => { embeddingBatches.push([query]); return [0.1, 0.2]; };
  ai.embedMany = async queries => { embeddingBatches.push(queries); return queries.map((_, index) => [index + 1, 0.2]); };
  preparation.retrieveSharedDocumentaryEvidence = async (grant, query, settings, vector) => {
    assert.deepEqual(grant.documents.map(d => d.workId), ['tourism'], 'each related probe uses the restricted grant');
    searches.push({ query, settings, vector });
    return { evidence: [{ id: `${'e'.repeat(64)}:${searches.length}`, documentId: scope.documents[0].id, workId: 'tourism', revision: scope.documents[0].revision,
      text: `Evidence from the authorized text for ${query}.`, locator: { pageNumber: 1, pageLabel: '1', sourceRef: null }, provenance: 'source', limitations: [] }],
      traversal: { rounds: 1, candidates: 1, partial: false } };
  };
  let decisions = 0;
  ai.completeJson = async (options, guard) => {
    const payload = JSON.parse(options.user); decisions++;
    assert.equal(payload.goal, goal);
    assert.equal(payload.context.capabilities.web, false);
    assert.ok(payload.agenda.some(q => q.purpose === branches[1].purpose), 'the supervisor sees why each branch matters');
    assert.ok(payload.sources.every(s => s.id === scope.documents[0].id));
    const next = payload.tasks.find(t => t.status === 'pending');
    const decision = next ? { action: 'search', taskId: next.id, query: `${next.action.query} contexto` }
      : { action: 'finish', reason: 'sufficient', coverage: payload.agenda.map(q => ({ question: q.question, status: 'supported', evidenceIds: payload.evidence.map(e => e.id).slice(0, 1) })) };
    assert.equal(guard(decision), true); return decision;
  };
  await withResearchHarness(input, async signal => {
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    run.budget.decisionTokenLimit = RESEARCH_CHAT_AGENT_DECISION_BYTES;
    run.agent = { plan: planned, question: goal, compact: false, minSources: 1 };
    await run.investigate(goal);
    assert.deepEqual(searches.map(s => s.query), [goal, planned.queries[0], ...branches.map(b => `${b.query} contexto`)]);
    assert.deepEqual(embeddingBatches[0], [goal, planned.queries[0]], 'opening probes use separate ordered query embeddings');
    assert.ok(searches.every(s => s.vector?.length === 2));
    assert.ok(run.budget.rounds <= RETRIEVAL_PRESETS.deep.rounds);
    assert.ok(run.budget.usedEvidenceTokens <= RETRIEVAL_PRESETS.deep.evidenceTokens);
    assert.ok(currentResearchHarness().agenda.tasks.filter(t => t.purpose).every(t => t.status === 'completed'));
    assert.ok(currentResearchHarness().agenda.canFinish());
    return {};
  });
  assert.ok(decisions >= 2, 'the supervisor can consume the pending branch queue');
  const before = searches.length;
  await withResearchHarness(input, async signal => {
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    run.layers = { ideas: false, documents: false, indexed: true };
    run.agent = { plan: planned, question: goal, compact: false, minSources: 1 };
    ai.completeJson = async (options, guard) => {
      const payload = JSON.parse(options.user);
      assert.deepEqual([payload.context.capabilities.documents, payload.context.capabilities.ideas, payload.context.capabilities.web], [false, false, false]);
      assert.equal(guard({ action: 'catalog', author: 'Forbidden catalogue' }), false);
      const next = payload.tasks.find(task => task.status === 'pending');
      const decision = next ? { action: 'search', taskId: next.id, query: next.action.query }
        : { action: 'finish', reason: 'sufficient', coverage: payload.agenda.map(q => ({ question: q.question, status: 'supported', evidenceIds: payload.evidence.map(e => e.id).slice(0, 1) })) };
      assert.ok(guard(decision)); return decision;
    };
    await run.investigate(goal);
    assert.ok(currentResearchHarness().agenda.tasks.some(t => t.purpose));
    assert.equal(run.catalogLookups.length, 0); assert.equal(run.readDocuments.size, 0); assert.equal(run.ideas.size, 0);
    return {};
  });
  assert.ok(searches.length - before > 1, 'V1 indexed-only can refine queries without enabling documents or graph');
  console.log('Research expansion: scoped semantic branches, priority queue, intent, bounds, direct turns and indexed-only control passed.');
} finally {
  try { load('electron/db/database.ts').closeDb(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
}
