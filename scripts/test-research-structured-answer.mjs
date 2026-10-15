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
const structuredAnswer = load('electron/ai/researchStructuredAnswer.ts');
const answerPlanApi = load('shared/researchAnswerPlan.ts');
const coverageRouting = load('shared/researchChatGrounding.ts');
const traceEvents = [];
const embeddingTrace = load('electron/qa/embeddingTrace.ts');
embeddingTrace.recordEmbeddingTrace = event => traceEvents.push(event);
const { groundResearchChatAnswer } = load('electron/ai/researchChatGrounding.ts');
const model = { provider: 'openrouter', model: 'qwen/qwen3.7-flash' };
const question = 'What is the river level, and what was measured about flow?';
const passage = { id: 'documentary:river#0', label: 'River survey', pageLabel: '2',
  summary: 'The river level is 18 metres. The flow rate was not measured.', citation: 'nodus://passage/documentary%3Ariver%230' };
const context = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [passage] } });
const auditSourcesForCitation = coverageRouting.researchChatAuditSources(context);
const citationPlan = answerPlanApi.validateResearchAnswerPlan({ format: 'table', formatQuestionQuote: 'in a table', facets: [
  { questionQuote: 'What is the river level', evidence: [{ sourceId: passage.id, quote: 'The river level is 18 metres.' }] },
] }, 'What is the river level in a table?', auditSourcesForCitation).plan;
assert.ok(citationPlan, 'citation regression uses a valid requested-table plan');
const bareTableOutput = { answers: [{ facetId: 'f1', text: 'The measured value follows.' }], tables: [{ facetIds: ['f1'], headers: ['Value'], rows: [[`18 metres [${passage.citation}]`]] }] };
const canonicalTableOutput = structuredAnswer.canonicalizeAuthorizedWriterCitations(bareTableOutput, auditSourcesForCitation);
assert.equal(canonicalTableOutput.tables[0].rows[0][0], `18 metres [River survey, p. 2](${passage.citation})`,
  'only an exact authorized bare table citation is converted into its full citation link');
assert.equal(canonicalTableOutput.tables[0].rows[0][0].replace(/ \[[^\]]+\]\([^)]+\)/u, ''), '18 metres',
  'citation normalization preserves the table fact exactly');
assert.ok(answerPlanApi.validateResearchAnswerOutput(canonicalTableOutput, citationPlan).output,
  'the canonical citation passes the existing strict table validation');
for (const unsafeCitation of ['nodus://passage/not-authorized', 'nodus://passage/unsafe|target', 'nodus://passage/river#0']) {
  const unsafe = structuredAnswer.canonicalizeAuthorizedWriterCitations({ ...bareTableOutput, tables: [{ ...bareTableOutput.tables[0], rows: [[`18 metres [${unsafeCitation}]`]] }] }, auditSourcesForCitation);
  assert.equal(answerPlanApi.validateResearchAnswerOutput(unsafe, citationPlan).output, null, `${unsafeCitation} remains rejected`);
}
const alreadyLinked = { answers: [{ facetId: 'f1', text: `[River survey]( ${passage.citation})` }] };
assert.deepEqual(structuredAnswer.canonicalizeAuthorizedWriterCitations(alreadyLinked, auditSourcesForCitation), alreadyLinked,
  'existing Markdown links are not rewritten');
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
      const addressed = [{ facetId: 'f1', complaint: facets[0], answerQuotes: ['The river level is 18 metres.'] },
        ...(!planOmitsFacet2 && !omitPlannedFacet2 ? [{ facetId: 'f2', complaint: facets[1], answerQuotes: [mode === 'invented' ? 'The flow rate is 25 metres.' : 'The flow rate was not measured.'] }] : [])];
      if (mode === 'omitted-ids') addressed.forEach(row => { delete row.facetId; });
      if (mode === 'wrong-explicit-id') addressed[0].facetId = 'f9';
      if (mode === 'paraphrased-complaint') addressed[1].complaint = 'What did they measure about flow?';
      if (mode === 'duplicate-facet') addressed[1].facetId = 'f1';
      value = {
        addressed,
        omissions: planOmitsFacet2
          ? [{ facetId: 'unplanned', complaint: facets[1], kind: 'available-fact', requiredFact: 'Report the stated limit for flow measurement.',
            sourceId: passage.id, quote: mode === 'unplanned-invented' ? 'The flow was always 25 metres per second.' : 'The flow rate was not measured.' }]
          : mode === 'repair' && omitPlannedFacet2 ? [{ facetId: 'f2', complaint: facets[1], kind: 'available-fact',
            requiredFact: 'Report the stated limit for flow measurement.', sourceId: passage.id, quote: 'The flow rate was not measured.' }] : [],
      };
    } else if (input.coverageRequirementProof) {
      const claim = input.claims.find(row => row.sentence.includes('The flow rate was not measured.'));
      assert.ok(claim, 'the carried flow qualification must have a supported repaired claim');
      value = { addressed: input.requirements.map(requirement => ({ requirementId: requirement.id,
        claimIds: [claim.id], answerQuotes: [claim.sentence] })), omissions: [] };
    } else if (input.sources) value = { complete: true, missing: [] };
    else value = load('electron/ai/researchTurnPlanner.ts').literalResearchTurnPlan(question);
    if (!validate(value)) throw new ai.AiError('Fixture schema mismatch', false, false, 'schema_mismatch');
    return value;
  };
};

async function runMetadataRegression({ worldFact = false } = {}) {
  const metadataValue = worldFact ? 'Ada Lovelace; Nobel Prize winner' : 'Ada Lovelace';
  const source = { id: worldFact ? 'documentary:metadata-world#0' : 'documentary:metadata-author#0', label: 'River survey', pageLabel: '2',
    authors: [metadataValue], summary: 'The river level is 18 metres.', citation: `nodus://passage/${encodeURIComponent(worldFact ? 'documentary:metadata-world#0' : 'documentary:metadata-author#0')}` };
  const sourceContext = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [source] } });
  const asked = worldFact ? 'Did Ada Lovelace win the Nobel Prize?' : 'Who authored the River survey?';
  const answerText = worldFact ? 'I cannot establish whether Ada Lovelace won the Nobel Prize from the supplied excerpts.'
    : 'The source record lists Ada Lovelace as the author.';
  const unsupportedWorldAnswer = `Ada Lovelace won the Nobel Prize. [River survey](${source.citation})`;
  const counts = {};
  install();
  const auditSources = load('shared/researchChatGrounding.ts').researchChatAuditSources(sourceContext);
  assert.match(auditSources[0].text, /Source authors: /);
  assert.ok(auditSources[0].text.endsWith('Verbatim excerpt:\nThe river level is 18 metres.'), 'author metadata remains outside the verbatim excerpt');
  ai.completeJson = async (options, validate, selected) => {
    assert.deepEqual(selected, model);
    const input = JSON.parse(options.user);
    let value;
    if (options.system.startsWith('Plan a documentary answer')) {
      counts.plan = (counts.plan ?? 0) + 1;
      value = { facets: [{ questionQuote: asked, evidence: [] }], format: 'prose' };
    } else if (input.plan) {
      counts.writer = (counts.writer ?? 0) + 1;
      assert.equal(input.plan.facets[0].excerptPremises, 'none', 'no selected excerpt quote is not an availability verdict');
      assert.match(options.system, /metadata cannot establish world facts/i);
      value = { answers: [{ facetId: 'f1', text: worldFact && !input.repair ? unsupportedWorldAnswer
        : worldFact ? answerText : `${answerText} [River survey](${source.citation})` }] };
    } else if (input.sentences) {
      counts.audit = (counts.audit ?? 0) + 1;
      assert.match(options.system, /Application source metadata can support attribution and provenance, never independent corroboration/u,
        'the full prose auditor preserves its metadata boundary');
      assert.match(input.sources[0].text, /Source authors: /);
      const sentence = input.sentences[0].text;
      if (!worldFact) {
        value = { claims: [{ index: 0, kind: 'attributed', supported: true, explicitInference: false, reason: 'Fixture source-record attribution.', unsupportedParts: [],
          premises: [{ text: sentence, type: 'attribution', entailed: true, evidence: [{ id: source.id, quote: `Source authors: ${metadataValue}` }], from: [] }] }] };
      } else if (counts.audit === 1) {
        value = { claims: [{ index: 0, kind: 'fact', supported: false, explicitInference: false, reason: 'Metadata cannot establish a world fact.', unsupportedParts: ['won the Nobel Prize'],
          premises: [{ text: 'Ada Lovelace won the Nobel Prize.', type: 'fact', entailed: false,
            evidence: [{ id: source.id, quote: `Source authors: ${metadataValue}` }], from: [] }] }] };
      } else {
        value = { claims: [{ index: 0, kind: 'nonfactual', supported: true, explicitInference: false, reason: 'A bounded evidence limit.', unsupportedParts: [], premises: [] }] };
      }
    } else if (input.fullQuestionProof) {
      counts.proof = (counts.proof ?? 0) + 1;
      assert.deepEqual(input.plannedFacets.map(facet => facet.id), ['f1']);
      value = { addressed: [{ facetId: 'f1', complaint: asked, answerQuotes: [worldFact ? answerText : answerText] }], omissions: [] };
    } else if (input.sources) value = { complete: true, missing: [] };
    else throw new Error('Unexpected metadata regression request');
    if (!validate(value)) throw new ai.AiError('Metadata fixture schema mismatch', false, false, 'schema_mismatch');
    return value;
  };

  const answer = await groundResearchChatAnswer('', sourceContext, asked, model, 'en', undefined, { structured: true });
  if (worldFact) assert.match(answer, /cannot establish whether Ada Lovelace won the Nobel Prize/i);
  else { assert.match(answer, /Ada/); assert.match(answer, /author/); }
  assert.deepEqual([counts.plan, counts.writer, counts.audit, counts.proof], worldFact ? [1, 2, 2, 1] : [1, 1, 1, 1],
    worldFact ? 'a metadata-only world fact is rejected, repaired, fully audited and coverage-proved' : 'metadata attribution still receives a full audit and coverage proof');
}

async function runUnplannedMetadataAttribution() {
  const source = { id: 'documentary:river-author-omitted#0', label: 'River survey', pageLabel: '2', authors: ['Ada Lovelace'],
    summary: 'The river level is 18 metres.', citation: 'nodus://passage/documentary%3Ariver-author-omitted%230' };
  const sourceContext = JSON.stringify({ contexto_modular_seleccionado: { pasajes_relevantes: [source] } });
  const asked = 'What is the river level, and who authored the River survey?';
  const levelFacet = 'What is the river level';
  const authorFacet = 'who authored the River survey';
  const levelAnswer = 'The river level is 18 metres.';
  const authorAnswer = 'The source record lists Ada Lovelace as the author.';
  const counts = {};
  install();
  ai.completeJson = async (options, validate, selected) => {
    assert.deepEqual(selected, model);
    const input = JSON.parse(options.user);
    let value;
    if (options.system.startsWith('Plan a documentary answer')) {
      counts.plan = (counts.plan ?? 0) + 1;
      value = { facets: [{ questionQuote: levelFacet, evidence: [{ sourceId: source.id, quote: source.summary }] }], format: 'prose' };
    } else if (input.plan) {
      counts.writer = (counts.writer ?? 0) + 1;
      if (counts.writer === 1) {
        assert.deepEqual(input.plan.facets.map(facet => facet.id), ['f1']);
        value = { answers: [{ facetId: 'f1', text: `${levelAnswer} [River survey](${source.citation})` }] };
      } else {
        assert.ok(input.repair);
        assert.deepEqual(input.plan.facets.map(facet => facet.id), ['f1', 'f2']);
        assert.equal(input.plan.facets[1].questionQuote, authorFacet);
        assert.equal(input.plan.facets[1].excerptPremises, 'none');
        assert.deepEqual(input.plan.facets[1].evidence, [], 'metadata proof must not be promoted into excerpt premises');
        value = { answers: [
          { facetId: 'f1', text: `${levelAnswer} [River survey](${source.citation})` },
          { facetId: 'f2', text: `${authorAnswer} [River survey](${source.citation})` },
        ] };
      }
    } else if (input.sentences) {
      counts.audit = (counts.audit ?? 0) + 1;
      assert.match(options.system, /Application source metadata can support attribution and provenance, never independent corroboration/u);
      value = { claims: input.sentences.map((row, index) => {
        const author = row.text.includes('Ada Lovelace');
        return { index, kind: author ? 'attributed' : 'fact', supported: true, explicitInference: false, reason: 'Literal fixture evidence.', unsupportedParts: [],
          premises: [{ text: row.text, type: author ? 'attribution' : 'fact', entailed: true,
            evidence: [{ id: source.id, quote: author ? 'Source authors: Ada Lovelace' : source.summary }], from: [] }] };
      }) };
    } else if (input.fullQuestionProof) {
      counts.proof = (counts.proof ?? 0) + 1;
      if (counts.proof === 1) {
        assert.deepEqual(input.plannedFacets.map(facet => facet.id), ['f1']);
        value = { addressed: [{ facetId: 'f1', complaint: levelFacet, answerQuotes: [levelAnswer] }], omissions: [
          { facetId: 'unplanned', complaint: authorFacet, kind: 'available-fact', requiredFact: 'Report the source record author.',
            sourceId: source.id, quote: 'Source authors: Ada Lovelace' },
        ] };
      } else {
        assert.deepEqual(input.plannedFacets.map(facet => facet.id), ['f1', 'f2']);
        value = { addressed: [
          { facetId: 'f1', complaint: levelFacet, answerQuotes: [levelAnswer] },
          { facetId: 'f2', complaint: authorFacet, answerQuotes: [authorAnswer] },
        ], omissions: [] };
      }
    } else if (input.coverageRequirementProof) {
      const claim = input.claims.find(row => row.sentence.includes(authorAnswer));
      assert.ok(claim, 'the repaired attribution must be freshly supported by source-record metadata');
      value = { addressed: input.requirements.map(requirement => ({ requirementId: requirement.id,
        claimIds: [claim.id], answerQuotes: [authorAnswer] })), omissions: [] };
    } else if (input.sources) value = { complete: true, missing: [] };
    else throw new Error('Unexpected unplanned metadata attribution request');
    if (!validate(value)) throw new ai.AiError('Unplanned metadata fixture schema mismatch', false, false, 'schema_mismatch');
    return value;
  };

  const answer = await groundResearchChatAnswer('', sourceContext, asked, model, 'en', undefined, { structured: true });
  assert.match(answer, /18 metres/);
  assert.match(answer, /Ada Lovelace/);
  assert.deepEqual([counts.plan, counts.writer, counts.audit, counts.proof], [1, 2, 2, 2],
    'an unplanned metadata attribution is added without promoting metadata to excerpt evidence, then rewritten, audited and reproved');
}

try {
  // Replay the two actual Luna proofs which withheld an otherwise audited
  // three-facet answer. This checks representation and literal spans only;
  // independent source inspection still supplies the quality score.
  // Commit only the exact fields this regression needs. Original full receipts
  // remain hash-bound in the local audit, outside the portable test dependency.
  const capturedFixture = JSON.parse(fs.readFileSync(path.join(repoRoot,
    'scripts/fixtures/research-coverage-missing-facet-ids.json'), 'utf8'));
  assert.equal(capturedFixture.format, 'nodus.research-coverage-proof-regression/1');
  const capturedProofs = capturedFixture.proofs;
  assert.equal(capturedProofs.length, 2, 'both original bounded proof attempts are replayed');
  for (const { input, proof } of capturedProofs) {
    assert.equal(proof.addressed.length, 3);
    assert.ok(proof.addressed.every(row => !Object.hasOwn(row, 'facetId')), 'the actual failure omitted routing IDs');
    const before = JSON.stringify(proof);
    const bound = coverageRouting.bindResearchCoverageFacetIds(proof, input.plannedFacets);
    assert.deepEqual(bound.addressed.map(row => row.facetId), ['f1', 'f2', 'f3']);
    for (const row of bound.addressed) {
      assert.equal(input.plannedFacets.find(facet => facet.id === row.facetId).questionQuote, row.complaint);
      assert.equal(coverageRouting.validResearchAnswerQuotes(input.answer, row, 4000), true,
        'original answer quotes pass the unchanged literal quote guard');
    }
    assert.equal(JSON.stringify(proof), before, 'the model proof is never rewritten');
  }

  const rawWithoutIds = { addressed: [
    { complaint: facets[0], answerQuotes: ['The river level is 18 metres.'] },
    { complaint: facets[1], answerQuotes: ['The flow rate was not measured.'] },
  ], omissions: [] };
  const boundWithoutIds = coverageRouting.bindResearchCoverageFacetIds(rawWithoutIds, [
    { id: 'f1', questionQuote: facets[0] }, { id: 'f2', questionQuote: facets[1] },
  ]);
  assert.deepEqual(boundWithoutIds.addressed.map(row => row.facetId), ['f1', 'f2']);
  assert.equal(rawWithoutIds.addressed.every(row => !Object.hasOwn(row, 'facetId')), true, 'binding clones instead of mutating raw proof');
  for (const [raw, planned] of [
    [{ addressed: [{ facetId: 'wrong', complaint: facets[0] }], omissions: [] }, [{ id: 'f1', questionQuote: facets[0] }]],
    [{ addressed: [{ complaint: 'paraphrased question', answerQuotes: [] }], omissions: [] }, [{ id: 'f1', questionQuote: facets[0] }]],
    [{ addressed: [{ complaint: facets[0] }], omissions: [] }, [{ id: 'f1', questionQuote: facets[0] }, { id: 'f2', questionQuote: facets[0] }]],
  ]) {
    const bound = coverageRouting.bindResearchCoverageFacetIds(raw, planned);
    assert.equal(Object.hasOwn(bound.addressed[0], 'facetId'), Object.hasOwn(raw.addressed[0], 'facetId'), 'explicit, paraphrased or ambiguous rows are not bound');
    if (Object.hasOwn(raw.addressed[0], 'facetId')) assert.equal(bound.addressed[0].facetId, raw.addressed[0].facetId, 'explicit IDs are never changed');
  }

  install();
  const answer = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(answer, /18 metres/); assert.match(answer, /not measured/);
  assert.doesNotMatch(answer, /facetId|f1|f2/);
  assert.deepEqual([counts.plan, counts.writer, counts.proof], [1, 1, 1]);
  install('omitted-ids');
  const traceOffset = traceEvents.length;
  const boundAnswer = await groundResearchChatAnswer('', context, question, model, 'en', undefined, { structured: true });
  assert.match(boundAnswer, /18 metres/); assert.match(boundAnswer, /not measured/);
  const completionTrace = traceEvents.slice(traceOffset).find(event => event.type === 'research-answer-grounding' && event.status === 'complete');
  assert.ok(completionTrace);
  assert.equal(completionTrace.coverageRawProofs[0].addressed.every(row => !Object.hasOwn(row, 'facetId')), true, 'trace retains raw model proof without IDs');
  assert.deepEqual(completionTrace.coverageRoutingBindings[0].bindings.map(row => row.facetId), ['f1', 'f2'], 'application-added IDs are reported separately');
  assert.deepEqual(completionTrace.coverageConfirmations[0].addressed.map(row => row.facetId), ['f1', 'f2']);
  assert.match(completionTrace.coverageConfirmationFacetIdSource, /application routing metadata/u);

  for (const mode of ['missing-id', 'invented', 'wrong-explicit-id', 'paraphrased-complaint', 'duplicate-facet']) {
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
  await runMetadataRegression();
  await runMetadataRegression({ worldFact: true });
  await runUnplannedMetadataAttribution();
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
  assert.equal(research.humanizeResearchCitations(`[](${passage.citation})`),
    `[River survey, p. 2](${passage.citation})`,
    'empty documentary labels use the authorized citation-navigation lookup and source title');
  assert.equal(research.sanitizeResearchCitations(`The river level is 18 metres. [${passage.citation}]`, context),
    `The river level is 18 metres. [River survey, p. 2](${passage.citation})`,
    'the actual chat sanitizer repairs a provider bare target without publishing a raw URI');
  assert.equal(research.humanizeResearchCitations('[](nodus://passage/documentary%3Adenied%230)'),
    '[](nodus://passage/documentary%3Adenied%230)',
    'a denied documentary target receives no title from a fallback database lookup');
  assert.equal(research.sanitizeResearchCitations('Unverified [](nodus://passage/documentary%3Adenied%230).', context),
    'Unverified.', 'the unresolved empty link is removed through the normal authorization path');
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
