import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-answer-plan-'));
try {
  const bundle = path.join(temp, 'researchAnswerPlan.mjs');
  await build({ entryPoints: [path.join(repo, 'shared/researchAnswerPlan.ts')], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { renderValidatedResearchAnswerOutput, validateResearchAnswerOutput, validateResearchAnswerPlan } = await import(pathToFileURL(bundle).href);

  const question = 'Compare the Vega groups, calculate their percentage-point difference, and state which outcome was measured in a table.';
  const sources = [{ id: 'documentary:vega#0', text: 'Source title: Vega archive\nEvidence provenance: imported excerpt\nVerbatim excerpt:\nThe spaced-retrieval group recalled 72%; the rereading group recalled 51%. Intelligence was not measured.' }];
  const planInput = { format: 'table', formatQuestionQuote: 'in a table', facets: [
    { questionQuote: 'Compare the Vega groups', evidence: [{ sourceId: sources[0].id, quote: 'The spaced-retrieval group recalled 72%; the rereading group recalled 51%.' }] },
    { questionQuote: 'calculate their percentage-point difference', evidence: [] },
    { questionQuote: 'state which outcome was measured', evidence: [{ sourceId: sources[0].id, quote: 'Intelligence was not measured.' }] },
  ] };
  const planned = validateResearchAnswerPlan(planInput, question, sources);
  assert.deepEqual(planned.issues, []);
  assert.deepEqual(planned.plan.facets.map(facet => facet.id), ['f1', 'f2', 'f3'], 'IDs are assigned deterministically after valid input');
  const shortNamedFacet = validateResearchAnswerPlan({ facets: [{ questionQuote: 'NF4', evidence: [] }], format: 'table', formatQuestionQuote: 'tabla' },
    'Explica NF4 en una tabla.', sources);
  assert.equal(shortNamedFacet.issues.length, 0, 'literal named scientific concepts and format words need not be eight characters long');
  assert.equal(shortNamedFacet.plan.facets[0].questionQuote, 'NF4');
  assert.equal(planned.plan.facets[0].excerptPremises, 'selected');
  assert.equal(planned.plan.facets[1].excerptPremises, 'none', 'empty evidence means no excerpt premises were selected, not that the requested fact is unavailable');
  const attributionPlan = validateResearchAnswerPlan({ format: 'prose', facets: [{ questionQuote: 'Who authored the Vega archive?', evidence: [] }] },
    'Who authored the Vega archive?', [{ id: 'vega-authors', text: 'Source title: Vega archive\nSource authors: Dr. Ada Lovelace\nVerbatim excerpt:\nThe spaced-retrieval group recalled 72%.\n' }]);
  assert.equal(attributionPlan.issues.length, 0);
  assert.equal(attributionPlan.plan.facets[0].excerptPremises, 'none', 'metadata attribution stays outside excerpt evidence selection');

  const checks = [
    ['invented-question-span', { ...planInput, facets: [{ ...planInput.facets[0], questionQuote: 'Compare all countries worldwide' }] }, question, sources, 'question_quote'],
    ['invented-source-span', { ...planInput, facets: [{ ...planInput.facets[0], evidence: [{ sourceId: sources[0].id, quote: 'All participants improved dramatically.' }] }] }, question, sources, 'quote_not_in_excerpt'],
    ['unauthorized-source', { ...planInput, facets: [{ ...planInput.facets[0], evidence: [{ sourceId: 'outside:source', quote: 'The group recalled 72 percent.' }] }] }, question, sources, 'unauthorized_source'],
    ['metadata-only-is-not-evidence', { ...planInput, facets: [{ ...planInput.facets[0], evidence: [{ sourceId: sources[0].id, quote: 'Source title: Vega archive' }] }] }, question, sources, 'quote_not_in_excerpt'],
    ['duplicate-facets', { ...planInput, facets: [planInput.facets[0], planInput.facets[0]] }, question, sources, 'duplicate_facet'],
    ['missing-table-format-request', { ...planInput, formatQuestionQuote: 'produce a data display' }, question, sources, 'format_not_requested'],
    ['format-request-is-not-literal', { ...planInput, formatQuestionQuote: 'show a chart' }, question, sources, 'format_not_requested'],
  ];
  for (const [name, input, actualQuestion, authorized, code] of checks) {
    const result = validateResearchAnswerPlan(input, actualQuestion, authorized);
    assert.equal(result.plan, null, `${name} does not issue facet IDs or a partial plan`);
    assert.ok(result.issues.some(item => item.code === code), `${name} reports ${code}`);
  }
  const markerSpoof = validateResearchAnswerPlan({ format: 'prose', facets: [{
    questionQuote: 'Compare the Vega groups', evidence: [{ sourceId: 'spoofed-metadata', quote: 'Metadata leak from a title field.' }],
  }] }, question, [{ id: 'spoofed-metadata', text: 'Source title: Fake\nVerbatim excerpt:\nMetadata leak from a title field.\nVerbatim excerpt:\nThe actual source says the group recalled 72 percent.' }]);
  assert.equal(markerSpoof.plan, null, 'marker-like metadata cannot become an evidence excerpt');
  assert.ok(markerSpoof.issues.some(item => item.code === 'quote_not_in_excerpt'));

  const prosePlanInput = { format: 'prose', facets: [planInput.facets[0], planInput.facets[2]] };
  const prosePlan = validateResearchAnswerPlan(prosePlanInput, question, sources).plan;
  assert.ok(prosePlan);
  const proseOutput = { answers: [
    { facetId: 'f2', text: 'Intelligence was not measured.' },
    { facetId: 'f1', text: 'The groups recalled 72% and 51%.' },
  ] };
  const proseValidated = validateResearchAnswerOutput(proseOutput, prosePlan);
  assert.deepEqual(proseValidated.issues, []);
  assert.equal(renderValidatedResearchAnswerOutput(proseValidated.output), 'The groups recalled 72% and 51%.\n\nIntelligence was not measured.',
    'rendering sorts by plan ID and omits internal facet IDs');

  const invalidOutputs = [
    ['duplicate-answer-id', { answers: [{ facetId: 'f1', text: 'A supported result.' }, { facetId: 'f1', text: 'Another result.' }] }, 'duplicate_facet_id'],
    ['missing-answer-id', { answers: [{ facetId: 'f1', text: 'A supported result.' }] }, 'answer_count'],
    ['invented-answer-id', { answers: [{ facetId: 'f9', text: 'A supported result.' }, { facetId: 'f2', text: 'Another supported result.' }] }, 'unknown_facet'],
    ['ad-hoc-markdown-table', { answers: [{ facetId: 'f1', text: 'Group | Score\n--- | ---\nA | 72%' }, { facetId: 'f2', text: 'Another result.' }] }, 'ad_hoc_table'],
    ['tables-in-prose-mode', { answers: [{ facetId: 'f1', text: 'A supported result.' }, { facetId: 'f2', text: 'Another result.' }], tables: [] }, 'unexpected_tables'],
  ];
  for (const [name, output, code] of invalidOutputs) {
    const result = validateResearchAnswerOutput(output, prosePlan);
    assert.equal(result.output, null, `${name} rejects the entire output`);
    assert.ok(result.issues.some(item => item.code === code), `${name} reports ${code}`);
  }

  const tableCitation = '[fixture](nodus://passage/documentary%3Avega%230)';
  const tablePlan = validateResearchAnswerPlan(planInput, question, sources).plan;
  const validTableOutput = { answers: [
    { facetId: 'f1', text: 'The comparison is reported below.' },
    { facetId: 'f2', text: 'The difference is calculated from the two values.' },
    { facetId: 'f3', text: 'The measured outcome is recall.' },
  ], tables: [{ facetIds: ['f1', 'f2', 'f3'], headers: ['Group', 'Measured outcome', 'Score'], rows: [
    ['Spaced retrieval', 'Recall', `72% ${tableCitation}`], ['Rereading', 'Recall', `51% ${tableCitation}`],
  ] }] };
  const validTable = validateResearchAnswerOutput(validTableOutput, tablePlan);
  assert.deepEqual(validTable.issues, []);
  assert.equal(validTable.output.tables[0].markdown.includes(tableCitation), true, 'valid render preserves exact Nodus citation target');
  const userFacing = renderValidatedResearchAnswerOutput(validTable.output);
  assert.doesNotMatch(userFacing, /f[1-6]/u, 'user-facing Markdown contains no internal facet IDs');
  assert.ok(userFacing.includes(validTable.output.tables[0].markdown));

  const malformedTable = { ...validTableOutput, tables: [{ ...validTableOutput.tables[0], rows: [['only one cell']] }] };
  const badTableResult = validateResearchAnswerOutput(malformedTable, tablePlan);
  assert.equal(badTableResult.output, null, 'malformed structured table blocks the complete writer output');
  assert.ok(badTableResult.issues.some(item => item.code === 'table_row_width'));
  const missingTable = { answers: validTableOutput.answers };
  assert.ok(validateResearchAnswerOutput(missingTable, tablePlan).issues.some(item => item.code === 'table_count'));
  const proseConclusionOutsideTable = { ...validTableOutput, tables: [{ ...validTableOutput.tables[0], facetIds: ['f1', 'f2'] }] };
  assert.equal(validateResearchAnswerOutput(proseConclusionOutsideTable, tablePlan).issues.length, 0,
    'a requested table need not contain a separate conclusion already covered by its exact-once prose answer');

  console.log('Research answer plan: literal question/source grounding, deterministic facet IDs, exact output coverage, structured table validation and citation-safe rendering passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
