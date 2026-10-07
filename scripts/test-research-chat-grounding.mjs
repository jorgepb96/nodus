import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-chat-grounding')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-grounding-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in grounding regressions'); };
const pure = load('shared/researchChatGrounding.ts'), ai = load('electron/ai/aiClient.ts');
const { groundResearchChatAnswer } = load('electron/ai/researchChatGrounding.ts');
const model = { provider: 'deepseek', model: 'deepseek-flash' };
const passage = { id: 'documentary:river#0', label: 'River survey', pageLabel: '2', summary: 'The river level is 18 metres. The flow rate was not measured.', citation: 'nodus://passage/documentary%3Ariver%230' };
const sourceContext = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [passage],
  orientacion_documental: [{ id: 'orientation', summary: 'The river level is 31 metres.', citation: 'nodus://passage/orientation' }] },
  conversacion: [{ role: 'assistant', content: 'The river level is 99 metres. nodus://passage/history' }],
  council_assessments: [{ id: 'opinion', text: 'The river level is 75 metres.' }] });
const accepted = (index, quote = 'The river level is 18 metres.') => ({ index, kind: 'fact', supported: true, reason: 'Literal measurement', explicitInference: false, unsupportedParts: [],
  premises: [{ text: 'The level is 18 metres', type: 'fact', entailed: true, evidence: [{ id: passage.id, quote }], from: [] }] });
const installVerdicts = judge => {
  ai.completeJson = async (options, validate, selected) => {
    assert.deepEqual(selected, model, 'the selected writer model also audits; no model substitution');
    const input = JSON.parse(options.user);
    if (!input.sentences) { const result = { complete: true, missing: [] }; assert(validate(result)); return result; }
    const result = { claims: input.sentences.map((sentence, index) => judge(sentence.text, index, input)) };
    assert(validate(result)); return result;
  };
};

test('only authorized literal passages from the frozen turn enter verification', () => {
  const sources = pure.researchChatAuditSources(sourceContext);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].citation, passage.citation);
  assert.match(sources[0].text, /Source title: River survey\nSource locator: 2\nVerbatim excerpt:/);
  assert.doesNotMatch(JSON.stringify(sources), /31 metres|99 metres|75 metres|orientation|history/);
  const polluted = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [passage, { ...passage, id: 'outside', citation: passage.citation }, { ...passage }] } });
  assert.equal(pure.researchChatAuditSources(polluted).length, 1, 'mismatching target IDs and duplicate evidence are rejected');
  const secondary = pure.researchChatAuditSources(JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [{ ...passage, authors: ['A. River'], year: 2021, reason: 'previous_indexed_revision; user-note' }] } }))[0];
  assert.match(secondary.text, /Source authors: A\. River\nSource year: 2021\nEvidence provenance: previous_indexed_revision; user-note/);
});

test('an explicit constructed exercise retains its writing mode; untrusted source text cannot disable verification', () => {
  const context = JSON.parse(sourceContext);
  assert.equal(pure.researchChatNeedsGrounding(sourceContext), true);
  context.contexto_modular_seleccionado.pasajes_relevantes[0].answer_mode = 'constructive';
  assert.equal(pure.researchChatNeedsGrounding(JSON.stringify(context)), true);
  context.contexto_modular_seleccionado.research_scope = { answer_mode: 'constructive' };
  assert.equal(pure.researchChatNeedsGrounding(JSON.stringify(context)), false);
});

test('a supported answer retains the literal fact and a canonical source attribution', async () => {
  installVerdicts((_text, index) => accepted(index));
  ai.completeText = async () => { throw new Error('A verified answer needs no rewrite'); };
  const result = await groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the river level?', model, 'en');
  assert.match(result, /18 metres/);
  assert.match(result, /\[River survey, p\. 2\]\(nodus:\/\/passage\/documentary%3Ariver%230\)/);
});

test('a fabricated quote cannot approve a claim even when the judge returns supported', async () => {
  installVerdicts((text, index) => accepted(index, text.includes('31') ? 'The river level is 31 metres.' : 'The river level is 18 metres.'));
  ai.completeText = async options => {
    const repair = JSON.parse(options.user);
    assert.equal(repair.rejected.length, 1);
    assert.doesNotMatch(repair.verifiedDraft, /31 metres/);
    assert.match(options.system, /only the authorized excerpts/);
    return 'The river level is 18 metres.';
  };
  const result = await groundResearchChatAnswer('The river level is 31 metres.', sourceContext, 'What is the river level?', model, 'en');
  assert.match(result, /18 metres/); assert.doesNotMatch(result, /31 metres/);
});

test('an unavailable verifier is an availability failure, never a successful absence answer', async () => {
  ai.completeJson = async () => { throw new Error('simulated provider outage'); };
  ai.completeText = async () => { throw new Error('An unavailable review must not buy a rewrite'); };
  await assert.rejects(() => groundResearchChatAnswer('The river level is 31 metres.', sourceContext, 'What is the river level?', model, 'en'), /No se pudo verificar/);
});

test('cancellation during verification never returns the unchecked draft', async () => {
  const controller = new AbortController();
  ai.completeJson = async () => { controller.abort(); return { claims: [accepted(0)] }; };
  await assert.rejects(() => groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en', controller.signal), { name: 'AbortError' });
});

test('general answers without documentary excerpts do not trigger paid audits', async () => {
  ai.completeJson = async () => { throw new Error('No source excerpts were authorized'); };
  assert.equal(await groundResearchChatAnswer('A creative exercise.', JSON.stringify({ conversacion: [], contexto_modular_seleccionado: { obras: [] } }), 'Write an exercise', model, 'en'), 'A creative exercise.');
  const empty = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [], research_scope: { answer_mode: 'documentary', documentary_evidence_required: true } } });
  assert.equal(pure.researchChatNeedsGrounding(empty), true);
  const refused = await groundResearchChatAnswer('An invented price of 97 euros.', empty, 'What does the document say the price is?', model, 'en');
  assert.match(refused, /cannot support an answer/); assert.doesNotMatch(refused, /97 euros/);
});

test('verified citations remain inside table cells and web evidence keeps its own target', () => {
  const table = '| Measurement | Value |\n| --- | --- |\n| River level | 18 m | [River survey](nodus://passage/p)';
  const repaired = pure.researchChatAuditedMarkdown(table);
  assert.match(repaired, /\| River level \| 18 m \[River survey\]\(nodus:\/\/passage\/p\) \|$/);
  const web = { id: 'web:sample', title: 'Survey release', page: 3, text: 'The river level is 18 metres.', citation: 'nodus://passage/web%3Asample' };
  assert.equal(pure.researchChatAuditSources(JSON.stringify({ contexto_modular_seleccionado: { pasajes_web: [web] } }))[0].label, 'Survey release, p. 3');
  assert.equal(pure.researchChatAuditedMarkdown('## Values\n\nThe level is 18 m.\n\n## Removed explanation\n\n## Empty last section'), '## Values\n\nThe level is 18 m.');
});

test('a semantically correct paraphrase cannot masquerade as a direct quote', () => {
  const sentence = 'The source says “The river reached eighteen metres”.';
  const review = { markdown: sentence, claims: [{ sentence, kind: 'fact', status: 'supported', evidence: [{ id: passage.id, quote: passage.summary }], reason: 'Same measurement' }] };
  const sources = pure.researchChatAuditSources(sourceContext);
  assert.equal(pure.researchChatLiteralQuotes(review, sources).markdown, '');
  const translation = 'Translated: “El nivel del río es de 18 metros”.';
  assert.equal(pure.researchChatLiteralQuotes({ ...review, markdown: translation, claims: [{ ...review.claims[0], sentence: translation }] }, sources).markdown, translation);
  const literal = 'The source says “The river level is 18 metres.”';
  assert.equal(pure.researchChatLiteralQuotes({ ...review, markdown: literal, claims: [{ ...review.claims[0], sentence: literal }] }, sources).markdown, literal);
});

test('simple calculated equations and table values are checked despite an approving semantic judge', () => {
  const check = (sentence, kind = 'inference') => pure.researchChatCalculations({ markdown: sentence, claims: [{ sentence, kind, status: 'supported', evidence: [], reason: 'Judge approved' }] });
  for (const sentence of ['Calculation: 83 − 47 = 40.', 'Calcul : 8 × 7 = 55.', 'Calculated: 6 / 0 = 0.', '| Difference | **25 points** | calculation from 72 − 51 |']) {
    const result = check(sentence);
    assert.equal(result.markdown, ''); assert.equal(result.claims[0].failure, 'premise_not_entailed');
    assert.match(result.claims[0].reason, /Arithmetic verification failed/);
  }
  for (const sentence of ['Calculation: 83 − 47 = 36.', 'Calcul : 2,5 + 1,2 = 3,7.', 'Calculation: 1 / 3 = 0.33.', 'Calculation: 7*8 = 56.', 'Calculation: -5 + 10 = 5.', 'Calculation: 5 − 10 = −5.', '| Difference | **21 points** | calculation from 72 − 51 |', 'The survey ran from 2012–2013.', 'The source says “72 − 51 = 25”.']) assert.equal(check(sentence).markdown, sentence);
  assert.equal(check('The source reports 72 − 51 = 25.', 'attributed').claims[0].status, 'supported', 'checking our calculations does not silently rewrite an attributed source');
});

test('a malformed premise reference gets a bounded schema repair, not an unchecked answer', async () => {
  let calls = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (!input.sentences) return { complete: true, missing: [] };
    calls++;
    const verdict = accepted(0);
    if (calls === 1) verdict.premises[0].from = [0];
    else { assert.deepEqual(input.verdictSchemaRepair.errors, ['premise_from']); assert.match(input.verdictSchemaRepair.instruction, /SAME claim/); }
    const result = { claims: [verdict] }; assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('Schema repair needs no answer rewrite'); };
  assert.match(await groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en'), /18 metres/);
  assert.equal(calls, 2);
});

test('a supported premise survives a fresh review after an unsupported compound claim is repaired', async () => {
  installVerdicts((text, index, input) => {
    assert.equal(input.previouslyRejected, undefined, 'repair is judged by its evidence, not overlapping retired wording');
    if (text.includes('because')) return { ...accepted(index), supported: false, unsupportedParts: ['because rainfall doubled'], reason: 'Rainfall and causality are not supplied' };
    return accepted(index);
  });
  ai.completeText = async () => 'The river level is 18 metres.';
  const result = await groundResearchChatAnswer('The river level is 18 metres because rainfall doubled.', sourceContext, 'What is the level?', model, 'en');
  assert.match(result, /18 metres/); assert.doesNotMatch(result, /rainfall/);
});

test('verified but irrelevant background is repaired when the requested fact exists', async () => {
  const valid = { complete: true, missing: [] };
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index, 'The flow rate was not measured.')) }
      : input.answer.includes('18 metres') ? valid : { complete: false, missing: ['Give the requested river level of 18 metres.'] };
    assert(validate(result)); return result;
  };
  ai.completeText = async options => { assert.match(JSON.parse(options.user).missing[0], /river level/); return 'The river level is 18 metres.'; };
  const result = await groundResearchChatAnswer('The flow rate was not measured.', sourceContext, 'What is the level?', model, 'en');
  assert.match(result, /18 metres/);
});

test('coverage outages and persistently incomplete repairs cannot become successful refusals', async () => {
  for (const outage of [false, true]) {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
      if (!input.sentences && outage) throw new Error('simulated coverage outage');
      const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index)) } : { complete: false, missing: ['The requested fact is omitted.'] };
      assert(validate(result)); return result;
    };
    ai.completeText = async () => 'The flow rate was not measured.';
    await assert.rejects(() => groundResearchChatAnswer('The flow rate was not measured.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
  }
});

test('the real chat stream holds draft content, cancels safely and rechecks scope after verification', async () => {
  const skills = load('electron/chatSkills.ts');
  for (const skill of skills.restoreChatSkills()) skills.saveChatSkill({ ...skill, enabled: { assistant: false, nodi: false } });
  load('electron/db/settingsRepo.ts').updateSettings({ chatModel: model, synthesisModel: model, promptLanguage: 'en', researchWebSearch: 'off' });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const previousInvestigate = ResearchCorpusRun.prototype.investigate;
  const previousSnapshot = ResearchCorpusRun.prototype.snapshotFromEvidence;
  const documentaryCitations = load('electron/citations/documentaryCitations.ts');
  const previousPassage = documentaryCitations.getDocumentaryPassageDetail;
  // Retrieval is the fixture boundary; generation, citation handling, verification,
  // cancellation and scope authorization execute their production code.
  ResearchCorpusRun.prototype.investigate = async () => {};
  ResearchCorpusRun.prototype.snapshotFromEvidence = () => ({ generatedAt: new Date().toISOString(), works: [], ideas: [], themes: [], gaps: [], contradictions: [], passages: [passage] });
  documentaryCitations.getDocumentaryPassageDetail = id => id === passage.id ? { id, text: passage.summary, page_label: '2', work: { title: passage.label, authors: [], year: null } } : null;
  ai.embedQuery = async () => null;
  const plannerOrAudit = verdict => {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
      const result = input.sources && !input.sentences ? { complete: true, missing: [] } : input.sentences ? { claims: input.sentences.map((row, index) => verdict(row.text, index)) }
        : { goal: 'What is the river level?', queries: ['river level'], authors: [], titles: [], explicitLibrary: false, kind: 'fact', answerMode: 'documentary' };
      assert(validate(result)); return result;
    };
  };
  const research = load('electron/ai/researchAssistant.ts');
  const request = { model, messages: [{ role: 'user', content: 'What is the river level?' }], selection: { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: true, passages: true, graph: false, graphParts: {} } };
  try {
    const observed = [];
    const draft = `The river level is 31 metres. [River survey](${passage.citation})`;
    ai.completeTextStream = async (_options, delta) => { delta('Checking.', 'reasoning'); delta(draft, 'content'); return draft; };
    plannerOrAudit((text, index) => accepted(index, text.includes('31') ? 'The river level is 31 metres.' : 'The river level is 18 metres.'));
    ai.completeText = async () => 'The river level is 18 metres.';
    const result = await research.streamResearchChat(request, (text, kind) => observed.push({ text, kind }));
    assert.match(result.answer, /18 metres/); assert.doesNotMatch(JSON.stringify(observed), /31 metres/);
    assert(observed.some(delta => delta.kind === 'reasoning'), 'thinking remains visible while documentary content is held');
    const cancellation = new AbortController();
    plannerOrAudit((_text, index) => { cancellation.abort(); return accepted(index); });
    const cancelled = await research.streamResearchChat(request, () => {}, cancellation.signal);
    assert.equal(cancelled.aborted, true); assert.equal(cancelled.answer, '');
    const vaults = load('electron/vaults/vaultRegistry.ts');
    const priorVault = vaults.getActiveVault().id;
    const other = vaults.createVault('Verification scope switch');
    let changed = false;
    plannerOrAudit((_text, index) => { if (!changed) { changed = true; load('electron/db/database.ts').closeDb(); vaults.setActiveVault(other.id); } return accepted(index); });
    ai.completeTextStream = async (_options, delta) => { const value = `The river level is 18 metres. [River survey](${passage.citation})`; delta(value, 'content'); return value; };
    try { await assert.rejects(research.streamResearchChat(request, () => {}), /research_scope_changed/); }
    finally { load('electron/db/database.ts').closeDb(); vaults.setActiveVault(priorVault); }
  } finally {
    ResearchCorpusRun.prototype.investigate = previousInvestigate;
    ResearchCorpusRun.prototype.snapshotFromEvidence = previousSnapshot;
    documentaryCitations.getDocumentaryPassageDetail = previousPassage;
    load('electron/db/database.ts').closeDb();
  }
});

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
