import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--structured-answer')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-structured-answer-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in structured answer regressions'); };
const ai = load('electron/ai/aiClient.ts');
const { groundResearchChatAnswer } = load('electron/ai/researchChatGrounding.ts');
const model = { provider: 'openrouter', model: 'qwen/qwen3.7-flash' };
const question = 'What is the river level, and what was measured about flow?';
const passage = { id: 'documentary:river#0', label: 'River survey', pageLabel: '2',
  summary: 'The river level is 18 metres. The flow rate was not measured.', citation: 'nodus://passage/documentary%3Ariver%230' };
const context = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [passage] } });
const facets = ['What is the river level', 'what was measured about flow'];
const accepted = (row, index) => ({ index, kind: 'fact', supported: true, explicitInference: false, reason: 'Literal fixture', unsupportedParts: [],
  premises: [{ text: row.text, type: 'fact', entailed: true, evidence: [{ id: passage.id, quote: passage.summary }], from: [] }] });
const counts = {};
const install = (mode = 'ok', controller = null) => {
  for (const key of Object.keys(counts)) delete counts[key];
  ai.completeText = ai.completeTextStream = async () => { throw new Error('Structured drafting must not buy an unstructured draft or repair'); };
  ai.completeJson = async (options, validate, selected) => {
    assert.deepEqual(selected, model);
    const input = JSON.parse(options.user);
    let value;
    if (options.system.startsWith('Plan a documentary answer')) {
      counts.plan = (counts.plan ?? 0) + 1;
      const planFacets = mode.startsWith('unplanned-') ? facets.slice(0, 1) : facets;
      value = { facets: planFacets.map(questionQuote => ({ questionQuote, evidence: [{ sourceId: passage.id, quote: passage.summary }] })), format: 'prose' };
    } else if (input.plan) {
      counts.writer = (counts.writer ?? 0) + 1;
      const plannedIds = input.plan.facets.map(facet => facet.id);
      value = { answers: plannedIds.map(facetId => ({ facetId, text: facetId === 'f1'
        ? `The river level is 18 metres. [River](${passage.citation})`
        : mode === 'repair' && !input.repair ? 'The level is 18 metres.' : `The flow rate was not measured. [River](${passage.citation})` })) };
      if (input.repair) {
        assert.match(input.repair.missing.join(' '), /flow/);
        assert.deepEqual(plannedIds, ['f1', 'f2'], 'the omitted facet is deterministically added to the repair plan');
      }
    } else if (input.sentences) {
      counts.audit = (counts.audit ?? 0) + 1;
      controller?.abort();
      value = { claims: input.sentences.map(accepted) };
    } else if (input.fullQuestionProof) {
      counts.proof = (counts.proof ?? 0) + 1;
      const planOmitsFacet2 = mode.startsWith('unplanned-') && input.plannedFacets.length === 1;
      assert.deepEqual(input.plannedFacets.map(facet => facet.id), planOmitsFacet2 ? ['f1'] : ['f1', 'f2']);
      const omitPlannedFacet2 = mode === 'missing-id' || (mode === 'repair' && counts.writer === 1);
      value = {
        addressed: [{ facetId: 'f1', complaint: facets[0], answerQuotes: ['The river level is 18 metres.'] },
          ...(!planOmitsFacet2 && !omitPlannedFacet2 ? [{ facetId: 'f2', complaint: facets[1], answerQuotes: [mode === 'invented' ? 'The flow rate is 25 metres.' : 'The flow rate was not measured.'] }] : [])],
        omissions: planOmitsFacet2
          ? [{ facetId: 'unplanned', complaint: facets[1], kind: 'available-fact', requiredFact: 'Report the stated limit for flow measurement.',
            sourceId: passage.id, quote: mode === 'unplanned-invented' ? 'The flow was always 25 metres per second.' : 'The flow rate was not measured.' }]
          : mode === 'repair' && omitPlannedFacet2 ? [{ facetId: 'f2', complaint: facets[1], kind: 'available-fact',
            requiredFact: 'Report the stated limit for flow measurement.', sourceId: passage.id, quote: 'The flow rate was not measured.' }] : [],
      };
    } else if (input.sources) value = { complete: true, missing: [] };
    else value = load('electron/ai/researchTurnPlanner.ts').literalResearchTurnPlan(question);
    if (!validate(value)) throw new ai.AiError('Fixture schema mismatch', false, false, 'schema_mismatch');
    return value;
  };
};

try {
  install();
  const answer = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(answer, /18 metres/); assert.match(answer, /not measured/);
  assert.doesNotMatch(answer, /facetId|f1|f2/);
  assert.deepEqual([counts.plan, counts.writer, counts.proof], [1, 1, 1]);
  for (const mode of ['missing-id', 'invented']) {
    install(mode);
    await assert.rejects(groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true }), /No se pudo verificar/);
    assert.equal(counts.proof, 2, 'invalid coverage gets one bounded retry, never publication');
  }
  install('repair');
  const repaired = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(repaired, /not measured/); assert.equal(counts.writer, 2); assert.equal(counts.proof, 2);
  install('unplanned-repair');
  const repairedUnplanned = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(repairedUnplanned, /not measured/);
  assert.doesNotMatch(repairedUnplanned, /facetId|unplanned|f1|f2/);
  assert.deepEqual([counts.plan, counts.writer, counts.audit, counts.proof], [1, 2, 2, 2],
    'an independently discovered unplanned facet is added, rewritten, re-audited, and reproved before publication');
  install('unplanned-invented');
  await assert.rejects(groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true }), /No se pudo verificar/);
  assert.equal(counts.proof, 2, 'an invented unplanned-facet source quote is rejected on both bounded proof attempts');
  const controller = new AbortController(); install('ok', controller);
  await assert.rejects(groundResearchChatAnswer('', context, question, model, 'en', controller.signal, { structured: true }), { name: 'AbortError' });

  // The actual chat entry point keeps the new chain off by default. Enabling it
  // skips the unchecked writer and still enforces cancellation and scope fences.
  const settings = load('electron/db/settingsRepo.ts');
  assert.equal(settings.getSettings().researchAnswerVerification, 'off');
  settings.updateSettings({ chatModel: model, synthesisModel: model, promptLanguage: 'en', researchWebSearch: 'off', researchAnswerVerification: 'structured' });
  const skills = load('electron/chatSkills.ts');
  for (const skill of skills.restoreChatSkills()) skills.saveChatSkill({ ...skill, enabled: { assistant: false, nodi: false } });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  ResearchCorpusRun.prototype.investigate = async () => {};
  ResearchCorpusRun.prototype.snapshotFromEvidence = () => ({ generatedAt: new Date().toISOString(), works: [], ideas: [], themes: [], gaps: [], contradictions: [], passages: [passage] });
  load('electron/citations/documentaryCitations.ts').getDocumentaryPassageDetail = id => id === passage.id
    ? { id, text: passage.summary, page_label: '2', work: { title: passage.label, authors: [], year: null } } : null;
  ai.embedQuery = async () => null;
  const research = load('electron/ai/researchAssistant.ts');
  const request = { model, messages: [{ role: 'user', content: question }], selection: { ideas: false, themes: false, contradictions: false, gaps: false,
    readingPath: false, authors: false, documents: true, passages: true, graph: false, graphParts: {} } };
  install();
  const observed = [];
  const response = await research.streamResearchChat(request, (text, kind) => observed.push({ text, kind }));
  assert.match(response.answer, /18 metres/);
  assert.equal(counts.writer, 1);
  assert.ok(observed.every(delta => delta.kind !== 'content'), 'unchecked content never streams');
  const cancelledController = new AbortController(); install('ok', cancelledController);
  const cancelled = await research.streamResearchChat(request, () => {}, cancelledController.signal);
  assert.equal(cancelled.aborted, true); assert.equal(cancelled.answer, '');
  console.log('Structured answer: exact facet IDs, literal coverage, source audit, bounded repair, default-off rollout and real stream cancellation passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
