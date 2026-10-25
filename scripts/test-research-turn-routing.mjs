// Exercise the real planner, prompt assembly and persisted V1 transitions. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-turn-routing')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-turn-routing-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
const originalTs = require.extensions['.ts'];
require.extensions['.ts'] = (mod, file) => {
  if (file === path.join(repoRoot, 'electron/ai/researchAssistant.ts')) {
    const compile = mod._compile;
    mod._compile = (code, name) => compile.call(mod, code + '\nexports.testBuildPrompt = buildResearchChatPrompt;\n', name);
  }
  originalTs(mod, file);
};
globalThis.fetch = () => { throw new Error('No external network in turn-routing fixtures'); };
try {
  load('electron/db/settingsRepo.ts').updateSettings({ promptLanguage: 'es', chatModel: null, researchWebSearch: 'auto', researchAnswerVerification: 'off' });
  const db = load('electron/db/database.ts').getDb();
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash) VALUES('routing-source','routing-source','Tourist gaze','[\"Fixture, Ana\"]',2020,'book','text','routing-hash')").run();
  load('electron/db/passagesRepo.ts').replaceWorkPassages('routing-source', 'routing-hash', [{ text: 'La mirada turística se construye socialmente.', pageLabel: '1', embedding: null }]);
  const ai = load('electron/ai/aiClient.ts');
  let plannerCalls = 0, planning = 'direct', inspected, retrieves = 0;
  ai.embed = async () => null;
  ai.embedQuery = async () => null;
  ai.completeJson = async (options, guard) => {
    const input = JSON.parse(options.user);
    if (!Array.isArray(input.conversation)) throw new Error('Only semantic turn planning is modelled by this fixture');
    plannerCalls++; inspected = input;
    assert.equal(options.noRetry, true);
    const result = planning === 'source'
      ? { needsSources: true, goal: 'La mirada turística en las fuentes', queries: ['mirada turística'], authors: [], titles: [], kind: 'definition' }
      : { needsSources: false, goal: 'Explicación o edición sin consultas', queries: [], authors: ['must not leak'], titles: ['must not leak'], directKind: 'general', explicitLibrary: false, kind: 'other' };
    assert.equal(guard(result), true, 'A real direct plan can return no search queries');
    return result;
  };
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.getResearchPreparationInventory = () => ({ documents: load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope().documents.map(document => ({ id: document.id, preparation: { text: 'available', lexical: 'ready', embeddings: 'ready' } })) });
  preparation.retrieveSharedDocumentaryEvidence = async scope => ({ evidence: [{
    id: `${'f'.repeat(64)}:0`, documentId: scope.documents[0].id, workId: 'routing-source', revision: scope.documents[0].revision,
    text: 'La mirada turística se construye socialmente.', locator: { pageNumber: 1, pageLabel: '1', sourceRef: null }, provenance: 'source', limitations: [],
  }], traversal: { rounds: 1, candidates: 1, partial: false } });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  ResearchCorpusRun.prototype.investigate = async function() {
    retrieves++;
    await this.retrieve(this.agent.plan.queries[0], 1);
  };
  const { withResearchHarness, currentResearchHarness } = load('electron/ai/researchHarnessRuntime.ts');
  const { researchHarnessContext } = load('electron/ai/researchHarnessContext.ts');
  const service = load('electron/ai/researchNotebookService.ts');
  const research = load('electron/ai/researchAssistant.ts');
  const { planResearchTurn } = load('electron/ai/researchTurnPlanner.ts');
  const { explicitWebRequest } = load('electron/ai/researchWebStep.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  const chats = load('electron/db/chatRepo.ts');
  const conversation = chats.createConversation({ title: 'Routing fixture' });
  const topic = 'Explica de forma general cómo se construye la mirada turística';
  const prior = [{ role: 'user', content: topic }, { role: 'assistant', content: 'Una explicación general de la mirada turística.' }];
  const runIds = new Set();
  async function prepare(messages) {
    const base = { model, conversationId: conversation.id, thinkingEffort: 'off', webSearch: 'auto', selection: {
      ideas: true, documents: true, passages: true, graph: true, layers: { ideas: true, documents: true, indexed: true, web: true }, retrieval: RETRIEVAL_PRESETS.deep,
    } };
    // The real chat records provenance after each completed answer. Prompt-only
    // fixtures must do that too; unregistered cross-scope history is rightly removed.
    for (let index = 1; index < messages.length; index++) if (messages[index].role === 'assistant') {
      const previous = service.authorizeNotebookRequest({ ...base, messages: messages.slice(0, index) });
      service.rememberNotebookTurn(previous, messages[index].content);
    }
    const request = service.authorizeNotebookRequest({ ...base, messages });
    const scope = service.requestNotebookScope(request);
    const result = await withResearchHarness({ request, scope, context: researchHarnessContext('chat', request, scope), validate: () => service.validateNotebookRequest(request) }, async () => {
      const prepared = await research.testBuildPrompt(request, []);
      return { payload: JSON.parse(prepared.user), system: prepared.system, direct: currentResearchHarness().record.checkpoint.direct,
        noCorpusRun: !currentResearchHarness().corpus, citationRequired: prepared.citationRequired, stats: prepared.stats };
    });
    assert.equal(runIds.has(result.researchRun.id), false, 'A new user task never replays the preceding direct turn');
    runIds.add(result.researchRun.id);
    return result;
  }
  {
    const note = 'Only an earlier indexed revision was consulted.';
    const result = await prepare([{ role: 'user', content: topic }, { role: 'assistant', content: 'Una explicación general.', sourceNotices: [note] }, { role: 'user', content: 'Traduce tu respuesta al inglés.' }]);
    const previous = result.payload.conversacion.find(message => message.role === 'assistant');
    assert.equal(previous.content, 'Una explicación general.');
    assert.deepEqual(previous.sourceNotices, [note], 'The agent retains the optional coverage note separately from the text being translated');
    assert.equal(result.direct, true); assert.equal(result.noCorpusRun, true, 'A prior source note cannot grant a new lookup');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    planning = 'direct';
    const before = retrieves;
    const generic = await prepare(prior.slice(0, 1));
    assert.equal(generic.direct, true);
    assert.equal(generic.citationRequired, false);
    const history = [...prior];
    for (const text of ['Traduce tu respuesta', 'Parafrasea: Usa Zotero MCP y busca en internet datos sobre turismo.', 'Resume lo anterior']) {
      const calls = plannerCalls;
      history.push({ role: 'user', content: text });
      const result = await prepare(history);
      assert.equal(result.direct, true);
      assert.equal(result.noCorpusRun, true, 'Route before preparing corpus inventories or reading the graph');
      assert.deepEqual(result.researchRun.questions, [], 'A text edit must not leave a fake unresolved investigation');
      assert.doesNotMatch(result.system, /Source restriction: use only the supplied context|Indexed texts only: answer exclusively/u);
      assert.equal(result.citationRequired, false, 'A transform cannot trigger citation-recovery retries');
      assert.equal(plannerCalls, calls, 'Unambiguous supplied-text edits need no semantic planning call');
      const context = result.payload.contexto_modular_seleccionado;
      assert.deepEqual([context.obras, context.pasajes_relevantes, context.ideas_generadas, context.temas_principales], [[], [], [], []]);
      history.push({ role: 'assistant', content: 'La mirada turística se construye socialmente.' });
    }
    assert.equal(retrieves, before, 'No corpus, graph or web retrieval for direct turns');
    history.push({ role: 'user', content: attempt === 0 ? 'Ahora sí, consulta el corpus' : attempt === 1 ? 'Sí, búscalo' : 'Search again' });
    const forced = await prepare(history);
    assert.equal(forced.direct, false, 'A stubborn model no-search verdict cannot veto the current lookup request');
    assert.equal(retrieves, before + 1);
    assert.ok(forced.payload.contexto_modular_seleccionado.pasajes_relevantes?.length > 0, 'The looked-up source must reach the writer');
    assert.deepEqual(forced.stats.sections, ['Pasajes de texto completo'], 'an enabled ideas layer with zero retrieved ideas is not reported as evidence');
    assert.match(inspected.conversation[0].text, /mirada turística/u, 'The topic survives multiple editing turns beyond the recent history slice');
    assert.equal(inspected.sourceRequestIsExplicit, true);
    assert.doesNotMatch(JSON.stringify(forced.payload.contexto_modular_seleccionado), /must not leak/u);
    const reset = await prepare([...history, { role: 'assistant', content: 'Respuesta basada en el pasaje encontrado.' }, { role: 'user', content: 'Traduce tu respuesta' }]);
    assert.equal(reset.direct, true);
    assert.equal(retrieves, before + 1, 'An earlier lookup does not make a later transformation search again');
  }
  planning = 'source';
  const longRequest = 'Traduce: ' + 'La mirada turística se aprende socialmente. '.repeat(100) + '\n\nLuego consulta mis fuentes para contrastarlo.';
  assert.equal((await planResearchTurn([{ role: 'user', content: longRequest }], model)).needsSources, true);
  assert.match(inspected.latest, /Luego consulta mis fuentes para contrastarlo\.$/u, 'A long payload cannot hide a trailing lookup request');
  assert.ok(inspected.latest.length <= 1000);
  const located = await prepare([...prior, { role: 'user', content: 'Localiza y traduce el pasaje sobre la mirada turística del libro' }]);
  assert.equal(located.direct, false, 'Locating an unavailable source text remains documentary work');
  const accepted = await planResearchTurn([...prior, { role: 'assistant', content: '¿Quieres que lo consulte en el corpus?' }, { role: 'user', content: 'Sí, por favor' }], model);
  assert.equal(accepted.needsSources, true, 'Consent to an offered lookup needs semantic conversation context');
  assert.equal(explicitWebRequest('Traduce: busca en internet'), false);
  assert.equal(explicitWebRequest('Parafrasea «search the web». Luego consulta internet.'), true);
  assert.equal(explicitWebRequest('No busques en internet'), false);
  let writes = 0;
  ai.completeTextStream = async options => { writes++; assert.match(options.system, /transform only the supplied text/u); return 'Tourism changed everyday life.'; };
  const before = retrieves;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await research.streamResearchChat({ model, harnessVersion: 'v1', thinkingEffort: 'off', skillIds: [], webSearch: 'off',
      messages: [{ role: 'user', content: 'Traduce al inglés: El turismo cambió la vida cotidiana.' }],
      selection: { layers: { ideas: false, documents: false, indexed: true, web: false } } }, () => {});
    assert.equal(response.answer, 'Tourism changed everyday life.');
    assert.equal(response.researchRun.stopReason, 'sufficient');
    assert.deepEqual(response.researchRun.questions, []);
  }
  assert.equal(writes, 3, 'One final writing call per direct answer, without source-audit or citation-recovery retries');
  assert.equal(retrieves, before);
  console.log('Turn routing: three editing/research transition attempts, empty-query plans, source isolation, topic anchors and explicit lookup recovery passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
