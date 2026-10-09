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
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
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

test('a contradictory inference classification needs a fresh consistent verdict, not automatic approval', async () => {
  let calls = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    if (!input.sentences) return { complete: true, missing: [] };
    calls++;
    const verdict = { ...accepted(0), kind: calls === 1 ? 'fact' : 'inference', explicitInference: true,
      premises: [...accepted(0).premises, { text: 'The level exceeds 10 metres', type: 'inference', entailed: true, evidence: [], from: [0] }] };
    if (calls === 2) assert.deepEqual(input.verdictSchemaRepair.errors, ['inference_kind']);
    const result = { claims: [verdict] }; assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('Consistent evidence needs no prose rewrite'); };
  const result = await groundResearchChatAnswer('The source records a level of 18 metres; my inference is that the level exceeds 10 metres.', sourceContext, 'Does the recorded level exceed 10 metres?', model, 'en');
  assert.equal(calls, 2); assert.match(result, /my inference/); assert.match(result, /18 metres/);
});

test('repeated contradictory inference classifications stay unavailable after one retry', async () => {
  let calls = 0;
  ai.completeJson = async (options, validate) => {
    calls++;
    const result = { claims: [{ ...accepted(0), kind: 'fact', explicitInference: true,
      premises: [...accepted(0).premises, { text: 'The level exceeds 10 metres', type: 'inference', entailed: true, evidence: [], from: [0] }] }] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('Unverified verdicts cannot buy a successful repair'); };
  await assert.rejects(() => groundResearchChatAnswer('The source records a level of 18 metres; my inference is that the level exceeds 10 metres.', sourceContext, 'Does it exceed 10 metres?', model, 'en'), /No se pudo verificar/);
  assert.equal(calls, 2);
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
  for (const sentence of ['Calculation: 1,000 + 250 = 1,250.', 'Calculation: 1.000 + 250 = 1.250.', 'Calculation: 999 + 1 = 1,000,000.', 'Calculation: 3^2 + 4 = 13.', 'Calculation: 1 + 2 = 3e0.', 'Calculation: -9007199254740993 + 1 = -9007199254740992.']) {
    assert.equal(check(sentence).markdown, sentence, 'ambiguous grouping, symbolic expressions and unsafe integers remain for semantic review');
  }
});

test('a malformed premise reference gets a bounded schema repair, not an unchecked answer', async () => {
  let calls = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
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

test('repair receives the deterministic cause even when the semantic reason approves the premises', async () => {
  const correction = { ...passage, summary: 'The preliminary count was 31. The final correction records 32; the preliminary total is superseded.' };
  const context = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [correction] } });
  installVerdicts((sentence, index) => ({ index, kind: 'inference', supported: true, reason: 'All literal premises and the relation are entailed', unsupportedParts: [], explicitInference: sentence.includes('My inference'),
    premises: [
      { text: 'The preliminary count was 31', type: 'fact', entailed: true, evidence: [{ id: passage.id, quote: 'The preliminary count was 31.' }], from: [] },
      { text: 'The final correction records 32', type: 'fact', entailed: true, evidence: [{ id: passage.id, quote: 'The final correction records 32; the preliminary total is superseded.' }], from: [] },
      { text: '32 replaces 31', type: 'inference', entailed: true, evidence: [], from: [0, 1] },
    ] }));
  ai.completeText = async options => {
    const rejected = JSON.parse(options.user).rejected;
    assert.equal(rejected[0].failure, 'unqualified_inference');
    assert.match(rejected[0].reason, /entailed/);
    assert.match(options.system, /failure code is authoritative/);
    return 'My inference from the final correction is that 32 replaces 31.';
  };
  assert.match(await groundResearchChatAnswer('32 replaces 31.', context, 'Which count replaces the preliminary total?', model, 'en'), /My inference.*32 replaces 31/);
});

test('a rejected translated direct quote is repaired without deleting its supported value', async () => {
  installVerdicts((_sentence, index) => accepted(index));
  ai.completeText = async options => {
    assert.equal(JSON.parse(options.user).rejected[0].failure, 'premise_without_literal_evidence');
    assert.match(options.system, /explicitly label a translation/);
    return 'Traducción: «El nivel del río es de 18 metros». ';
  };
  const result = await groundResearchChatAnswer('El texto dice «El nivel del río es de 18 metros».', sourceContext, '¿Qué nivel tiene el río?', model, 'es');
  assert.match(result, /Traducción.*18 metros/);
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
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index, 'The flow rate was not measured.')) }
      : input.coverageComplaint ? { complete: false, missing: input.coverageComplaint.missing, addressed: [], omissions: input.coverageComplaint.missing.map(complaint =>
        ({ complaint, kind: 'available-fact', requiredFact: 'Give the requested river level of 18 metres.', sourceId: passage.id, quote: passage.summary })) }
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
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
      if (!input.sentences && outage) throw new Error('simulated coverage outage');
      const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index)) }
        : input.coverageComplaint ? { complete: false, missing: input.coverageComplaint.missing, addressed: [], omissions: input.coverageComplaint.missing.map(complaint =>
          ({ complaint, kind: 'available-fact', requiredFact: 'Give the requested river level of 18 metres.', sourceId: passage.id, quote: passage.summary })) }
        : { complete: false, missing: ['The requested fact is omitted.'] };
      assert(validate(result)); return result;
    };
    ai.completeText = async () => 'The flow rate was not measured.';
    await assert.rejects(() => groundResearchChatAnswer('The flow rate was not measured.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
  }
});

test('a verified evidence gap retains the requested facet even without a factual claim', async () => {
  const gap = 'I cannot establish the purchase price of this sensor from the available evidence.';
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    const result = input.sentences ? { claims: [{ index: 0, kind: 'nonfactual', supported: true, explicitInference: false, premises: [], unsupportedParts: [], reason: 'A limitation of this answer, not a claim of absence from the corpus' }] }
      : { complete: true, missing: [] };
    if (!input.sentences) assert.equal(input.answer, gap, 'coverage sees the specific verified gap, not a generic fallback');
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('A supported specific limitation needs no rewrite'); };
  assert.equal(await groundResearchChatAnswer(gap, sourceContext, 'What is the purchase price of this sensor?', model, 'en'), gap);
});

test('coverage cannot demand a corpus-absence assertion instead of an already verified price limitation', async () => {
  const gap = 'I cannot establish the purchase price of this sensor from the available evidence.';
  let confirmations = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    let result;
    if (input.sentences) result = { claims: [{ index: 0, kind: 'nonfactual', supported: true, explicitInference: false, premises: [], unsupportedParts: [], reason: 'Specific epistemic limit' }] };
    else if (input.coverageComplaint) {
      confirmations++;
      assert.equal(input.verifiedClaims[0].sentence, gap);
      assert.match(options.system, /must not additionally assert that complete documents contain no such fact/);
      result = { complete: true, missing: [], omissions: [], addressed: input.coverageComplaint.missing.map(complaint => ({ complaint, answerQuote: gap })) };
    } else result = { complete: false, missing: ['The answer must say that no price is documented in the documents.'] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('A spurious absence complaint must not buy a repair'); };
  assert.equal(await groundResearchChatAnswer(gap, sourceContext, 'What is the purchase price?', model, 'en'), gap);
  assert.equal(confirmations, 1);
});

test('an interpretation complaint is checked against the precise verified distribution limit', async () => {
  const sentence = 'I cannot establish the shape of the distribution from these excerpts.';
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    const result = input.sentences ? { claims: [{ index: 0, kind: 'nonfactual', supported: true, explicitInference: false, premises: [], unsupportedParts: [], reason: 'Precise interpretation limit' }] }
      : input.coverageComplaint ? { complete: true, missing: [], omissions: [], addressed: input.coverageComplaint.missing.map(complaint => ({ complaint, answerQuote: sentence })) }
      : { complete: false, missing: ['The requested distribution interpretation is omitted.'] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('Do not invent a distribution shape to appease coverage'); };
  assert.equal(await groundResearchChatAnswer(sentence, sourceContext, 'What distribution shape can I establish?', model, 'en'), sentence);
});

test('coverage confirmation cannot invent answer spans or supporting source quotes', async () => {
  for (const invalidKind of ['answer', 'source', 'format-only']) {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
      if (input.sentences) return { claims: input.sentences.map((_row, index) => accepted(index)) };
      if (!input.coverageComplaint) return { complete: false, missing: ['The requested facet is omitted.'] };
      const complaint = input.coverageComplaint.missing[0];
      const result = invalidKind !== 'source'
        ? { complete: true, missing: [], omissions: [], addressed: [{ complaint, answerQuote: invalidKind === 'format-only' ? '**********' : 'A fabricated answer span that was never written.' }] }
        : { complete: false, missing: [complaint], addressed: [], omissions: [{ complaint, kind: 'available-fact', requiredFact: 'The flow rate is 99 litres.', sourceId: passage.id, quote: 'The flow rate is 99 litres.' }] };
      assert.equal(validate(result), false); throw new Error('Invalid coverage proof');
    };
    await assert.rejects(groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
  }
});

test('a malformed coverage proof gets one identical retry and completeness is derived from validated proof', async () => {
  const gap = 'I cannot establish the documented purchase price of Alba from the authorized excerpts.';
  const context = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [{ ...passage, summary: 'Alba measures turbidity with green light.' }] } });
  let attempts = 0, frozen;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    if (input.sentences) return { claims: input.sentences.map((_row, index) => ({ index, kind: 'nonfactual', supported: true, reason: 'Scoped epistemic limit', premises: [], unsupportedParts: [], explicitInference: false })) };
    if (!input.coverageComplaint) return { complete: false, missing: ['The requested purchase price is not supplied.'] };
    attempts++;
    if (attempts === 1) {
      frozen = options; assert.equal(validate({ addressed: [], omissions: [] }), false);
      throw new ai.AiError('Malformed proof', false, false, 'schema_mismatch');
    }
    assert.deepEqual(options, frozen, 'schema retry preserves question, evidence, answer, model settings and output budget');
    const proof = { addressed: [{ complaint: input.coverageComplaint.missing[0], answerQuote: gap }], omissions: [],
      complete: false, missing: ['These extraneous model fields cannot override the validated proof.'] };
    assert(validate(proof)); return proof;
  };
  ai.completeText = async () => { throw new Error('An addressed evidence gap needs no rewrite'); };
  assert.equal(await groundResearchChatAnswer(gap, context, 'What is the purchase price of Alba?', model, 'en'), gap);
  assert.equal(attempts, 2);
});

test('coverage proof retries are bounded and transport failures are never replayed', async () => {
  for (const code of ['schema_mismatch', 'provider_http_error']) {
    let attempts = 0;
    ai.completeJson = async options => {
      const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
      if (input.sentences) return { claims: input.sentences.map((_row, index) => accepted(index)) };
      if (!input.coverageComplaint) return { complete: false, missing: ['The requested facet is omitted.'] };
      attempts++; throw new ai.AiError('Cannot confirm proof', false, false, code);
    };
    await assert.rejects(groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
    assert.equal(attempts, code === 'schema_mismatch' ? 2 : 1);
  }
});

test('a confirmed missing limit is compared with the exact already verified acknowledgement before another repair', async () => {
  const gap = 'I cannot establish the distribution shape from the authorized excerpts.';
  const draft = `The river level is 18 metres.\n\n${gap}`; let comparisons = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] }; let result;
    if (input.sentences) result = { claims: input.sentences.map((row, index) => row.text === gap
      ? { index, kind: 'nonfactual', supported: true, reason: 'Exact epistemic scope', premises: [], unsupportedParts: [], explicitInference: false } : accepted(index)) };
    else if (input.requiredLimits) {
      assert.equal(input.sources, undefined, 'the comparison is isolated from source exposition and the critic');
      assert.equal(input.coverageComplaint, undefined);
      assert.deepEqual(input.verifiedLimits, [{ index: 0, text: gap }]); comparisons++;
      result = { equivalent: [{ omissionIndex: 0, limitIndex: 0, answerQuote: gap }], distinct: [] };
    } else if (input.coverageComplaint) result = { addressed: [], omissions: [{ complaint: input.coverageComplaint.missing[0], kind: 'unaddressed-limit', requiredFact: 'Acknowledge inability to establish the distribution shape from these excerpts.', sourceId: null, quote: null }] };
    else result = { complete: false, missing: ['The distribution shape needs a precise evidentiary limit.'] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('Do not rewrite an already verified equivalent limitation'); };
  const answer = await groundResearchChatAnswer(draft, sourceContext, 'What is the level and what distribution shape can be established?', model, 'en');
  assert.match(answer, /18 metres/); assert.match(answer, /cannot establish the distribution shape/); assert.equal(comparisons, 1);
});

test('limit comparison cannot invent quotes, indices or a verified statement', async () => {
  const gap = 'I cannot establish the flow rate from these excerpts.';
  for (const mode of ['quote', 'index', 'duplicate']) {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
      if (input.sentences) return { claims: input.sentences.map((_row, index) => ({ index, kind: 'nonfactual', supported: true, reason: 'Scoped gap', premises: [], unsupportedParts: [], explicitInference: false })) };
      if (input.requiredLimits) {
        const row = { omissionIndex: 0, limitIndex: mode === 'index' ? 99 : 0, answerQuote: mode === 'quote' ? 'An invented verified sentence.' : gap };
        const result = { equivalent: mode === 'duplicate' ? [row, row] : [row], distinct: [] };
        assert.equal(validate(result), false); throw new Error('Invalid equivalence proof');
      }
      if (input.coverageComplaint) return { addressed: [], omissions: [{ complaint: input.coverageComplaint.missing[0], kind: 'unaddressed-limit', requiredFact: 'Acknowledge inability to establish the requested flow rate.', sourceId: null, quote: null }] };
      return { complete: false, missing: ['The flow rate needs a precise evidentiary limit.'] };
    };
    await assert.rejects(groundResearchChatAnswer(gap, sourceContext, 'What is the flow rate?', model, 'en'), /No se pudo verificar/);
  }
});

test('an unrelated verified limitation cannot satisfy the missing requested facet', async () => {
  const gap = 'I cannot establish the flow rate from these excerpts.'; let comparisons = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] }; let result;
    if (input.sentences) result = { claims: input.sentences.map((_row, index) => ({ index, kind: 'nonfactual', supported: true, reason: 'Scoped gap', premises: [], unsupportedParts: [], explicitInference: false })) };
    else if (input.requiredLimits) { comparisons++; result = { equivalent: [], distinct: [{ omissionIndex: 0 }] }; }
    else if (input.coverageComplaint) result = { addressed: [], omissions: [{ complaint: input.coverageComplaint.missing[0], kind: 'unaddressed-limit', requiredFact: 'Acknowledge inability to establish the restoration deadline.', sourceId: null, quote: null }] };
    else result = { complete: false, missing: ['The restoration deadline needs an acknowledgement.'] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => gap;
  await assert.rejects(groundResearchChatAnswer(gap, sourceContext, 'What restoration deadline can be established?', model, 'en'), /No se pudo verificar/);
  assert.equal(comparisons, 2);
});

test('broad drafts are redrafted from original excerpts without passing invented prose to the writer or judge', async () => {
  const fact = 'The river level is 18 metres and the flow rate was not measured.';
  const draft = [fact, ...Array.from({ length: 6 }, (_, i) => `Invented background ${i} says the level is 99 metres.`)].join('\n\n');
  let drafted = false, audited = false;
  ai.completeText = async (options, selected) => {
    assert.deepEqual(selected, model); assert.equal(options.signal, undefined);
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    assert.equal(input.question, 'What level is reported and was flow measured?');
    assert.equal(input.sources.length, 1);
    assert.match(input.sources[0].text, /18 metres/);
    assert.doesNotMatch(options.user, /Invented|99 metres|orientation|council/);
    drafted = true; return fact;
  };
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index, passage.summary)) } : { complete: true, missing: [] };
    if (input.sentences) { assert(drafted); assert.equal(input.sentences.length, 1); assert.equal(input.sentences[0].text, fact); audited = true; }
    else assert(audited);
    assert(validate(result)); return result;
  };
  const answer = await groundResearchChatAnswer(draft, sourceContext, 'What level is reported and was flow measured?', model, 'en');
  assert.match(answer, /18 metres and the flow rate was not measured/); assert.doesNotMatch(answer, /Invented|99 metres/);
});

test('a source-only redraft table still needs separate quantity and negation evidence', async () => {
  const table = '| Quantity | Finding |\n| --- | --- |\n| River level | 18 metres |\n| Flow rate | Not measured |';
  const draft = Array.from({ length: 7 }, (_, i) => `Unrequested background ${i}.`).join('\n\n');
  ai.completeText = async () => table;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user);
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
    if (input.sentences) {
      assert(input.sentences.some(row => row.text === '| Flow rate | Not measured |'));
      assert(input.sentences.some(row => row.text === '| River level | 18 metres |'));
      assert(!input.sentences.some(row => row.text.includes('Unrequested')));
    }
    const result = input.sentences ? { claims: input.sentences.map((_row, index) => accepted(index, passage.summary)) } : { complete: true, missing: [] };
    assert(validate(result)); return result;
  };
  const answer = await groundResearchChatAnswer(draft, sourceContext, 'Tabulate the level and whether flow was measured.', model, 'en');
  assert.match(answer, /\| Flow rate \| Not measured/); assert.match(answer, /\| River level \| 18 metres/);
});

test('a short draft citing generated orientation is redrafted and a fabricated replacement still cannot publish', async () => {
  const draft = 'The river level is 99 metres. [Generated idea](nodus://idea/g-0001)';
  let calls = 0;
  ai.completeText = async options => {
    calls++;
    if (calls === 1) assert.doesNotMatch(options.user, /99 metres|g-0001/);
    else assert.equal(JSON.parse(options.user).rejected.length, 1);
    return calls === 1 ? 'The river level is 99 metres.' : 'The river level is 18 metres.';
  };
  installVerdicts((text, index) => accepted(index, text.includes('99') ? 'The river level is 99 metres.' : passage.summary));
  const answer = await groundResearchChatAnswer(draft, sourceContext, 'What level is reported?', model, 'en');
  assert.equal(calls, 2); assert.match(answer, /18 metres/); assert.doesNotMatch(answer, /99 metres|g-0001/);
});

test('empty, unavailable and cancelled source redrafts cannot publish unchecked prose', async () => {
  const draft = Array.from({ length: 7 }, (_, i) => `Unchecked assertion ${i}.`).join('\n\n');
  for (const response of ['', '   ', null]) {
    ai.completeJson = async () => { throw new Error('A failed redraft cannot reach the auditor'); };
    ai.completeText = async () => { if (response === null) throw new Error('Provider unavailable'); return response; };
    await assert.rejects(groundResearchChatAnswer(draft, sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
  }
  const controller = new AbortController();
  ai.completeText = async options => { assert.equal(options.signal, controller.signal); controller.abort(); return 'An unchecked replacement.'; };
  await assert.rejects(groundResearchChatAnswer(draft, sourceContext, 'What is the level?', model, 'en', controller.signal), { name: 'AbortError' });
});

test('a positive coverage boolean cannot bypass independent proof or publish invented answer spans', async () => {
  for (const mode of ['boolean-only', 'invented-span', 'transport']) {
    let confirmations = 0;
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
      if (input.sentences) return { claims: input.sentences.map((_row, index) => accepted(index)) };
      if (!input.fullQuestionProof) return { complete: true, missing: [] };
      confirmations++;
      if (mode === 'transport') throw new ai.AiError('Transport unavailable', false, false, 'provider_http_error');
      const proof = mode === 'boolean-only' ? { complete: true, missing: [] }
        : { addressed: [{ complaint: input.question, answerQuote: 'A conclusion absent from the actual answer.' }], omissions: [] };
      assert.equal(validate(proof), false);
      throw new ai.AiError('Invalid positive proof', false, false, 'schema_mismatch');
    };
    ai.completeText = async () => { throw new Error('Unavailable proof cannot buy a speculative repair'); };
    await assert.rejects(groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
    assert.equal(confirmations, mode === 'transport' ? 1 : 2);
  }
});

test('independent positive proof repairs refused reasoning from literal premises and audits the comparison anew', async () => {
  let confirmations = 0, repairs = 0;
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user); let verdict;
    if (input.sentences) verdict = { claims: input.sentences.map((row, index) => row.text.startsWith('My inference:')
      ? { ...accepted(index, passage.summary), kind: 'inference', explicitInference: true,
        premises: [...accepted(index, passage.summary).premises, { text: 'Flow was not measured', type: 'fact', entailed: true, evidence: [{ id: passage.id, quote: passage.summary }], from: [] },
          { text: 'The level has a measured result while flow does not', type: 'inference', entailed: true, evidence: [], from: [0, 1] }] }
      : row.text.includes('cannot compare') ? { index, kind: 'nonfactual', supported: true, explicitInference: false, premises: [], unsupportedParts: [], reason: 'Scoped inability, not factual approval' }
        : accepted(index)) };
    else if (input.fullQuestionProof) {
      confirmations++;
      assert.match(options.system, /inspect every facet/);
      assert.equal(input.coverageComplaint, undefined);
      assert.equal(input.rejectedClaims, undefined, 'a full-question proof sees no retired-claim diagnoses or original positive verdict');
      const complaint = input.question;
      verdict = input.answer.includes('My inference:') ? { addressed: [{ complaint, answerQuote: input.answer }], omissions: [] }
        : { addressed: [], omissions: [{ complaint, kind: 'available-fact', requiredFact: 'Compare the measured level with the unmeasured flow as your own labelled reasoning from those premises.', sourceId: passage.id, quote: passage.summary }] };
    } else verdict = { complete: true, missing: [] };
    assert(validate(verdict)); return verdict;
  };
  ai.completeText = async options => {
    repairs++;
    assert.match(JSON.parse(options.user).missing[0], /Compare the measured level/);
    return 'My inference: the level has a measured value of 18 metres, whereas flow has no measured result; these stated premises support that comparison.';
  };
  const answer = await groundResearchChatAnswer('The river level is 18 metres. I cannot compare the level and flow.', sourceContext, 'Compare what is known about the level and flow.', model, 'en');
  assert.match(answer, /My inference:/); assert.doesNotMatch(answer, /cannot compare/);
  assert.equal(confirmations, 2); assert.equal(repairs, 1);
});

test('a long draft with few compound sentences still redrafts from original excerpts', async () => {
  const draft = 'The river level is 99 metres, ' + 'according to an invented orientation claim '.repeat(12) + '.';
  installVerdicts((_text, index) => accepted(index));
  ai.completeText = async options => {
    const request = JSON.parse(options.user);
    assert.deepEqual(Object.keys(request), ['question', 'sources']);
    assert.doesNotMatch(options.user, /99 metres|invented orientation/);
    return 'The river level is 18 metres.';
  };
  const answer = await groundResearchChatAnswer(draft, sourceContext, 'What is the level?', model, 'en');
  assert.match(answer, /18 metres/); assert.doesNotMatch(answer, /99 metres/);
});

test('full-question proof accepts separate literal request facets without inheriting a critic complaint', async () => {
  const draft = 'The river level is 18 metres. The flow rate was not measured.';
  ai.completeJson = async (options, validate) => {
    const input = JSON.parse(options.user); let result;
    if (input.sentences) result = { claims: input.sentences.map((_row, index) => accepted(index, passage.summary)) };
    else if (input.fullQuestionProof) {
      assert.equal(input.coverageComplaint, undefined); assert.equal(input.rejectedClaims, undefined);
      result = { addressed: [{ complaint: 'level', answerQuote: 'The river level is 18 metres.' }, { complaint: 'flow', answerQuote: 'The flow rate was not measured.' }], omissions: [] };
    } else result = { complete: true, missing: [] };
    assert(validate(result)); return result;
  };
  ai.completeText = async () => { throw new Error('The complete multi-facet proof needs no rewrite'); };
  const result = await groundResearchChatAnswer(draft, sourceContext, 'What is known about level and flow?', model, 'en');
  assert.match(result, /18 metres/); assert.match(result, /not measured/);
});

test('full-question proof rejects empty, invented and duplicate request-facet records', async () => {
  for (const mode of ['empty', 'invented-request', 'duplicate']) {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
      if (input.sentences) return { claims: input.sentences.map((_row, index) => accepted(index)) };
      if (!input.fullQuestionProof) return { complete: true, missing: [] };
      const row = { complaint: mode === 'invented-request' ? 'purchase price' : 'level', answerQuote: 'The river level is 18 metres.' };
      const result = { addressed: mode === 'empty' ? [] : mode === 'duplicate' ? [row, { answerQuote: row.answerQuote, complaint: row.complaint, ignoredExtra: true }] : [row], omissions: [] };
      assert.equal(validate(result), false); throw new Error('Invalid request-facet proof');
    };
    await assert.rejects(groundResearchChatAnswer('The river level is 18 metres.', sourceContext, 'What is the level?', model, 'en'), /No se pudo verificar/);
  }
});

test('coverage accepts distributed literal spans without treating ellipsis-joined text as a quote', async () => {
  const draft = 'The river level is 18 metres. The flow rate was not measured.';
  for (const format of ['structured', 'ellipsis', 'invented']) {
    ai.completeJson = async (options, validate) => {
      const input = JSON.parse(options.user);
      if (input.sentences) {
        const result = { claims: input.sentences.map((_row, index) => accepted(index, passage.summary)) };
        assert(validate(result)); return result;
      }
      if (!input.fullQuestionProof) return { complete: true, missing: [] };
      assert.match(options.system, /answerQuotes/);
      const quotes = format === 'ellipsis' ? { answerQuote: 'The river level is 18 metres. ... The flow rate was not measured.' }
        : { answerQuotes: ['The river level is 18 metres.', format === 'invented' ? 'The flow rate is 99 cubic metres per second.' : 'The flow rate was not measured.'] };
      const result = { addressed: [{ complaint: 'level and flow', ...quotes }], omissions: [] };
      if (format !== 'structured') {
        assert.equal(validate(result), false); throw new Error('Invalid literal answer proof');
      }
      assert(validate(result)); return result;
    };
    ai.completeText = async () => { throw new Error('Literal multi-span coverage requires no rewrite'); };
    if (format === 'structured') {
      const result = await groundResearchChatAnswer(draft, sourceContext, 'What is known about level and flow?', model, 'en');
      assert.match(result, /18 metres/); assert.match(result, /not measured/);
    } else await assert.rejects(groundResearchChatAnswer(draft, sourceContext, 'What is known about level and flow?', model, 'en'), /No se pudo verificar/);
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
    if (input.fullQuestionProof) return { addressed: [{ complaint: input.question, answerQuote: input.answer }], omissions: [] };
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
