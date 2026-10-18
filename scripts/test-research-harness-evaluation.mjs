import assert from 'node:assert/strict';
import { compareResearchHarness } from './lib/researchHarnessEvaluation.mjs';
const context = { mode: 'chat', objective: 'Compare evidence', scopeId: 'fixture-only', model: { provider: 'fixture', model: 'fixture' }, effort: 'standard',
  retrieval: { rounds: 8, evidenceTokens: 16000 }, web: false, language: 'es' };
const baseline = { context, metrics: { requiredQuestions: 4, answeredQuestions: 2, claims: 10, supportedClaims: 8, citationErrors: 1, modelCalls: 3, elapsedMs: 1000 } };
const pair = { caseId: 'synthetic-unit-fixture', legacy: baseline, v1: { context, metrics: { ...baseline.metrics, answeredQuestions: 3, supportedClaims: 9, citationErrors: 0, modelCalls: 4 } }, blindPreference: 'v1' };
assert.equal(compareResearchHarness([pair])[0].noQualityRegression, true);
assert.equal(compareResearchHarness([pair])[0].delta.modelCalls, 1);
assert.throws(() => compareResearchHarness([{ ...pair, v1: { ...pair.v1, context: { ...context, web: true } } }]), /must match/);
assert.throws(() => compareResearchHarness([{ ...pair, v1: { ...pair.v1, metrics: { ...pair.v1.metrics, claims: 0, supportedClaims: 0 } } }]), /empty answer/);
assert.throws(() => compareResearchHarness([pair, pair]), /Unique caseId/);
assert.equal(compareResearchHarness([{ ...pair, v1: baseline }])[0].noQualityRegression, true);
console.log('Paired harness evaluation: matched contexts, independent quality counts, empty-output rejection and cost deltas passed.');
