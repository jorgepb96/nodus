import assert from 'node:assert/strict';
import test from 'node:test';
import { researchBlindJudgeIssues, RESEARCH_BLIND_JUDGE_PROMPT } from './lib/research-blind-judge.mjs';
const input = { rubric: ['Date'], A: { answer: 'Founded in 1828.', sources: [{ id: 'a1', title: 'Institutional history', text: 'Founded in 1928.' }] }, B: { answer: 'Founded in 1928.', sources: [{ id: 'b1', text: 'Founded in 1928.' }] } };
const result = () => ({ A: { status: 'fail', coveredFacets: [], issues: [{ answerQuote: '1828', sourceId: 'a1', sourceQuote: '1928', explanation: 'Wrong century.' }] }, B: { status: 'pass', coveredFacets: ['Date'], issues: [] }, contentPreference: 'B', formatPreference: 'A', preference: 'B', reason: 'B preserves the actual date.' });
test('content wins over formatting and factual objections need exact anchors', () => {
  assert.deepEqual(researchBlindJudgeIssues(result(), input), []);
  assert.ok(researchBlindJudgeIssues({ ...result(), preference: 'A' }, input).includes('format_overrode_content'));
  const invented = result(); invented.A.issues[0].sourceQuote = 'No such institution';
  assert.ok(researchBlindJudgeIssues(invented, input).includes('A:unanchored_source:0'));
  const wrongAnswer = result(); wrongAnswer.A.issues[0].answerQuote = 'Never founded';
  assert.ok(researchBlindJudgeIssues(wrongAnswer, input).includes('A:unanchored_answer:0'));
});
test('content ties can follow explicit format requests, and metadata can anchor identity', () => {
  const tied = result(); tied.A.status = 'pass'; tied.A.issues = []; tied.contentPreference = 'tie'; tied.formatPreference = 'A'; tied.preference = 'A';
  assert.deepEqual(researchBlindJudgeIssues(tied, input), []);
  const identity = result(); identity.A.issues[0].sourceQuote = 'Institutional history';
  assert.deepEqual(researchBlindJudgeIssues(identity, input), []);
  assert.match(RESEARCH_BLIND_JUDGE_PROMPT, /contentPreference MUST be tie/);
  assert.match(RESEARCH_BLIND_JUDGE_PROMPT, /OVERRIDES the default/);
});
test('a passing label cannot hide a material issue or a fabricated rubric facet', () => {
  const inconsistent = result(); inconsistent.A.status = 'pass'; inconsistent.B.coveredFacets = ['Not requested'];
  assert.deepEqual(researchBlindJudgeIssues(inconsistent, input), ['A:pass_with_material_issue', 'B:invalid_facets']);
});
