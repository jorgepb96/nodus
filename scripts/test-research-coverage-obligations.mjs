import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-coverage-obligations')) process.exit(0);
installRuntimeHooks(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-coverage-obligations-')));
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in coverage obligation regressions'); };
const ai = load('electron/ai/aiClient.ts');
const trace = load('electron/qa/embeddingTrace.ts');
const traces = [];
trace.recordEmbeddingTrace = event => traces.push(event);
const { groundResearchChatAnswer } = load('electron/ai/researchChatGrounding.ts');
const model = { provider: 'openrouter', model: 'qwen/qwen3.7-flash' };
const source = { id: 'documentary:instrument#0', label: 'Instrument log', pageLabel: '4',
  summary: 'The gauge reading is 40 units. Calibration drift was not measured.',
  citation: 'nodus://passage/documentary%3Ainstrument%230' };
const context = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [source] } });
const question = 'What does the log establish about the gauge reading and calibration drift?';
const facet = 'the gauge reading and calibration drift';
const reading = 'The gauge reading is 40 units.';
const qualification = 'Calibration drift was not measured.';
const mixed = 'The gauge reading is 40 units, suggesting the instrument remained accurate, although calibration drift was not measured.';
const accepted = (row, index) => ({ index, kind: 'fact', supported: true, explicitInference: false,
  reason: 'Synthetic literal fixture', unsupportedParts: [], premises: [{ text: row.text, type: 'fact', entailed: true,
    evidence: [{ id: source.id, quote: row.text.includes('Calibration methods') ? 'Calibration methods are discussed.'
      : row.text.includes('Calibration') ? qualification : reading }], from: [] }] });

function installFixture({ scenario, fabricatedRequirementQuote = false, fabricatedComplaintDismissal = false }) {
  const counts = { plan: 0, writer: 0, audit: 0, coverage: 0, positive: 0, complaint: 0, requirement: 0 };
  let requirement = null;
  ai.completeText = ai.completeTextStream = async () => { throw new Error('Structured regression must use the production JSON writer'); };
  ai.completeJson = async (options, validate, selected) => {
    assert.deepEqual(selected, model, 'all steps use the fixed selected model');
    const input = JSON.parse(options.user);
    let value;
    if (options.system.startsWith('Plan a documentary answer')) {
      counts.plan++;
      // This is deliberately only a premise selection, never a coverage verdict.
      value = { facets: [{ questionQuote: facet, evidence: [{ sourceId: source.id, quote: qualification }] }], format: 'prose' };
    } else if (input.plan) {
      counts.writer++;
      if (!input.repair) value = { answers: [{ facetId: 'f1', text: ['already-answered', 'false-complaint', 'plan-only'].includes(scenario)
        ? `${reading} ${qualification} [Log](${source.citation})`
        : scenario === 'fabricated-dismissal' ? `${reading} [Log](${source.citation})`
          : `${mixed} [Log](${source.citation})` }] };
      else {
        if (!input.repair.coverageRequirements?.length) {
          assert.equal(counts.writer, 2, 'the first repair removes the rejected compound before coverage runs');
          value = { answers: [{ facetId: 'f1', text: `${reading} [Log](${source.citation})` }] };
        } else {
          assert.ok(input.repair.coverageRequirements.length, 'targeted rewrite receives independently confirmed requirements');
          requirement = input.repair.coverageRequirements[0];
          if (scenario === 'survives') assert.match(input.repair.coverageRequirements[0].requiredFact, /calibration|drift/i);
          value = { answers: [{ facetId: 'f1', text: scenario === 'survives'
            ? `${reading} [Log](${source.citation}) ${qualification} [Log](${source.citation})`
            : `${reading} [Log](${source.citation}) Calibration methods are discussed in the log. [Log](${source.citation})` }] };
        }
      }
    } else if (input.sentences) {
      counts.audit++;
      value = { claims: input.sentences.map((row, index) => {
        if (counts.audit === 1 && row.text.includes('suggesting')) return { ...accepted(row, index), kind: 'inference', supported: false,
          explicitInference: false, unsupportedParts: ['suggesting the instrument remained accurate'], reason: 'The bridge is unqualified.' };
        if (row.text.includes('Calibration methods are discussed')) return accepted({ ...row, text: 'Calibration methods are discussed.' }, index);
        return accepted(row, index);
      }) };
    } else if (input.coverageRequirementProof) {
      counts.requirement++;
      assert.ok(requirement, 'requirement proof only follows a confirmed source-backed omission');
      const claim = input.claims.find(row => row.sentence.includes(scenario === 'survives' ? 'Calibration drift was not measured' : 'Calibration methods'));
      assert.ok(claim, 'proof can select only a newly audited supported claim');
      if (fabricatedRequirementQuote) {
        assert.equal(requirement.quote, qualification);
        assert.ok(claim.evidence.every(item => !item.quote.includes('Calibration drift was not measured')));
      }
      value = fabricatedRequirementQuote
        ? { addressed: [{ requirementId: requirement.id, claimIds: [claim.id], answerQuotes: [claim.sentence] }], omissions: [] }
        : { addressed: [{ requirementId: requirement.id, claimIds: [claim.id], answerQuotes: [claim.sentence] }], omissions: [] };
    } else if (input.fullQuestionProof) {
      counts.positive++;
      value = { addressed: [{ complaint: facet, answerQuotes: [input.answer] }], omissions: [] };
    } else if (input.coverageComplaint) {
      counts.complaint++;
      counts.coverage++;
      const missing = input.coverageComplaint.missing;
      if (scenario === 'false-complaint' || scenario === 'fabricated-dismissal') {
        const claim = input.claims.find(row => row.sentence.includes(fabricatedComplaintDismissal ? reading : qualification));
        assert.ok(claim?.id, 'complaint dismissal points to a specific currently accepted claim');
        const dismissedSpan = fabricatedComplaintDismissal ? reading : qualification;
        value = { addressed: missing.map(complaint => ({ complaint, kind: 'available-fact',
          requiredFact: 'State whether calibration drift was measured.', sourceId: source.id, quote: qualification,
          claimIds: [claim.id], answerQuotes: [dismissedSpan] })), omissions: [] };
      }
      else value = { addressed: [], omissions: missing.map(complaint => ({ complaint, kind: 'available-fact',
        requiredFact: 'State that calibration drift was not measured.', sourceId: source.id, quote: qualification })) };
    } else if (input.sources) {
      counts.coverage++;
      value = scenario === 'plan-only'
        ? { complete: true, missing: [] }
        : ['false-complaint', 'fabricated-dismissal'].includes(scenario) ? { complete: false, missing: ['The log states whether calibration drift was measured.'] }
        : counts.audit === 2 ? { complete: false, missing: ['State the calibration measurement qualification.'] }
          : scenario === 'survives' ? { complete: true, missing: [] }
            : { complete: true, missing: [] };
    } else throw new Error(`Unexpected JSON request: ${options.system.slice(0, 80)}`);

    // Production owns validation; mock transports return only values that pass it.
    if (fabricatedComplaintDismissal && input.coverageComplaint) {
      assert.equal(validate(value), false, 'a literal span and accepted claim about the reading cannot dismiss a calibration qualification complaint');
      throw new ai.AiError('Fabricated complaint dismissal rejected by production validator', false, false, 'schema_mismatch');
    }
    if (fabricatedRequirementQuote && input.coverageRequirementProof) {
      assert.equal(validate(value), false, 'the actual production validator rejects a generic accepted claim whose evidence does not cover the obligation quote');
      throw new ai.AiError('Fabricated requirement proof rejected by production validator', false, false, 'schema_mismatch');
    }
    if (!validate(value)) throw new ai.AiError('Coverage obligation fixture schema mismatch', false, false, 'schema_mismatch');
    return value;
  };
  return counts;
}

test('a source-confirmed qualification survives rejection of its mixed inference through targeted repair and separate claim proof', async () => {
  const counts = installFixture({ scenario: 'survives' });
  const result = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(result, /Calibration drift was not measured/);
  assert.doesNotMatch(result, /suggesting the instrument remained accurate/);
  assert.deepEqual(counts, { plan: 1, writer: 3, audit: 3, coverage: 3, positive: 2, complaint: 1, requirement: 1 });
  assert.ok(traces.some(event => event.type === 'research-answer-grounding' && event.status === 'complete'
    && event.coverageRequirements?.some(row => row.sourceId === source.id && row.quote === qualification)));
});

test('general background cannot satisfy a confirmed requirement when its proof selects a mismatched source quote', async () => {
  const counts = installFixture({ scenario: 'generic', fabricatedRequirementQuote: true });
  // The production validator rejects the fabricated quote. Repeat the same invalid
  // model proof as AiError(schema_mismatch), and ensure the answer is withheld.
  await assert.rejects(() => groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true }), /No se pudo verificar/);
  assert.equal(counts.requirement, 1, 'the invalid requirement proof is withheld without a second unchecked attempt');
  assert.equal(counts.writer, 3);
});

test('a critic complaint already answered by literal answer spans creates no obligation or repair', async () => {
  const counts = installFixture({ scenario: 'false-complaint' });
  const result = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(result, /Calibration drift was not measured/);
  assert.equal(counts.writer, 1);
  assert.equal(counts.requirement, 0);
  assert.equal(counts.complaint, 1);
});

test('a source-backed complaint dismissal must bind the qualification span to its supported claim and source quote', async () => {
  const counts = installFixture({ scenario: 'false-complaint' });
  const result = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(result, /Calibration drift was not measured/);
  assert.equal(counts.writer, 1);
  assert.equal(counts.requirement, 0);
  assert.equal(counts.complaint, 1);
});

test('generic reading evidence cannot dismiss a complaint about calibration drift, even with fabricated source proof', async () => {
  const counts = installFixture({ scenario: 'fabricated-dismissal', fabricatedComplaintDismissal: true });
  await assert.rejects(() => groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true }), /No se pudo verificar/);
  assert.equal(counts.writer, 1, 'the omission is not repaired from a plan-selected quote after proof validation fails');
  assert.equal(counts.requirement, 0, 'planning evidence alone never creates a mandatory fact');
  assert.equal(counts.complaint, 2, 'the same invalid proof is rejected on its bounded schema retry');
});

test('a quote selected by the initial plan never becomes a mandatory fact or proves coverage', async () => {
  const counts = installFixture({ scenario: 'plan-only' });
  const result = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(result, /Calibration drift was not measured/);
  assert.equal(counts.writer, 1);
  assert.equal(counts.requirement, 0);
  assert.equal(counts.positive, 1);
});
