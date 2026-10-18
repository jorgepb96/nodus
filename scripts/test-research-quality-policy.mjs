import assert from 'node:assert/strict';
import { evaluateResearchAnswerQuality, RESEARCH_ANSWER_QUALITY_POLICY,
  DEFAULT_RESEARCH_QUALITY_PREREGISTRATION } from './lib/researchAnswerQualityPolicy.mjs';

const outcomes = [];
const reviews = [];
for (const arm of ['legacy', 'structured']) {
  for (let index = 0; index < 10; index += 1) {
    const positive = index < 8;
    const answered = positive ? index !== 7 : index !== 9;
    const reviewId = `${arm}-${index}`;
    const outcome = { reviewId, arm, positive, answered,
      answerSha256: `answer-${reviewId}`, sourceHash: `source-${reviewId}` };
    outcomes.push(outcome);
    reviews.push({ reviewId, answerSha256: outcome.answerSha256, sourceHash: outcome.sourceHash,
      reviewer: 'Independent reviewer', notes: 'Bound to this answer and source set.',
      correct: positive && index < 7, complete: positive && index < 7,
      noMaterialUnsupportedClaims: !(positive && index === 6),
      insufficientEvidenceHandled: !positive && (index === 8 || index === 9) });
  }
}

const result = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished: true,
  preregistration: { minimumAnswerableSample: 8 } });
assert.equal(result.policy, RESEARCH_ANSWER_QUALITY_POLICY);
assert.equal(result.answerQualityStatus, 'measured');
assert.deepEqual(result.denominators, { planned: 20, reviewed: 20 });
assert.equal(result.arms.structured.metrics.answerableCorrectAndComplete.passed, 7,
  'a withheld answer remains a failure in answerable utility');
assert.equal(result.arms.structured.metrics.answerableCorrectAndComplete.rate, 7 / 8);
assert.equal(result.arms.structured.metrics.publishedAnswersWithoutMaterialUnsupportedClaims.planned, 8,
  'conditional fidelity reports the published-answer denominator');
assert.equal(result.arms.structured.metrics.publishedAnswersWithoutMaterialUnsupportedClaims.passed, 7);
assert.equal(result.arms.structured.metrics.insufficientEvidenceHandling.passed, 1,
  'only a published refusal counts; withheld/transport failures do not count despite a positive review label');
assert.equal(result.arms.structured.thresholds.answerableCorrectAndComplete, true);
assert.equal(result.arms.structured.thresholds.publishedAnswersWithoutMaterialUnsupportedClaims, false);
assert.equal(result.sampleSufficiency.sufficientForEveryArm, true);
assert.equal(result.answerQualityAcceptance, false);
assert.equal(result.productInvariants.status, 'pending');
assert.equal(result.acceptance, null, 'missing deterministic product evidence leaves overall acceptance pending');

const defaultPrereg = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished: true });
assert.deepEqual(defaultPrereg.preregistration, DEFAULT_RESEARCH_QUALITY_PREREGISTRATION);
assert.equal(defaultPrereg.sampleSufficiency.sufficientForEveryArm, false, 'the current 8/2 design is too small for the preregistered sample');
assert.equal(defaultPrereg.answerQualityAcceptance, null);
const noPooling = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished: true,
  preregistration: { minimumAnswerableSample: 9 } });
assert.equal(noPooling.denominators.planned, 20);
assert.equal(noPooling.arms.legacy.sampleSufficiency.observedAnswerablePlanned, 8);
assert.equal(noPooling.arms.structured.sampleSufficiency.observedAnswerablePlanned, 8);
assert.equal(noPooling.sampleSufficiency.sufficientForEveryArm, false,
  '16 answerable items pooled across arms cannot satisfy a nine-per-arm minimum');
assert.equal(noPooling.answerQualityAcceptance, null);

const unfinished = evaluateResearchAnswerQuality({ outcomes, reviews: reviews.slice(0, -1), campaignFinished: false });
assert.equal(unfinished.status, 'pending');
assert.equal(unfinished.acceptance, null);
assert.equal(unfinished.denominators.reviewed, 19);

const stale = reviews.map(row => ({ ...row }));
stale[0].answerSha256 = 'stale';
assert.throws(() => evaluateResearchAnswerQuality({ outcomes, reviews: stale, campaignFinished: true }), /hashes do not bind/u);
const leaked = reviews.map(row => ({ ...row }));
const syntheticEvidence = { evidenceType: 'synthetic-structural-fixture', evidenceSha256: 'a'.repeat(64),
  citationResolution: { captured: 20, resolved: 20, resolver: 'fixture' },
  scopeContractIsolation: { checkedOutcomes: 20, observedScopeLeaks: 0, observedContractLeaks: 0, checksRun: true } };
const structuralOnly = evaluateResearchAnswerQuality({ outcomes, reviews: leaked, campaignFinished: true,
  preregistration: { minimumAnswerableSample: 8 }, productInvariantEvidence: syntheticEvidence });
assert.equal(structuralOnly.productInvariants.status, 'pending',
  'synthetic structural evidence cannot certify product-runtime invariants');
assert.equal(structuralOnly.acceptance, null);
// Synthetic fixtures exercise scoring only; they do not certify real product quality.
const runtimeShapedEvidence = { ...syntheticEvidence, evidenceType: 'product-runtime-receipt' };
const measuredFailure = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished: true,
  preregistration: { minimumAnswerableSample: 8 }, productInvariantEvidence: runtimeShapedEvidence });
assert.equal(measuredFailure.status, 'measured');
assert.equal(measuredFailure.acceptance, false, 'measured quality failures are negative, not pending');
const allPublished = outcomes.map(row => ({ ...row, answered: true }));
const allCorrect = reviews.map(row => ({ ...row, correct: true, complete: true,
  noMaterialUnsupportedClaims: true, insufficientEvidenceHandled: true }));
const measuredPass = evaluateResearchAnswerQuality({ outcomes: allPublished, reviews: allCorrect, campaignFinished: true,
  preregistration: { minimumAnswerableSample: 8 }, productInvariantEvidence: runtimeShapedEvidence });
assert.equal(measuredPass.status, 'measured');
assert.equal(measuredPass.acceptance, true, 'sufficient per-arm samples and actual-shaped receipts can reach measured acceptance');
const insufficientWithReceipts = evaluateResearchAnswerQuality({ outcomes: allPublished, reviews: allCorrect,
  campaignFinished: true, productInvariantEvidence: runtimeShapedEvidence });
assert.equal(insufficientWithReceipts.acceptance, null, 'runtime receipts cannot replace the per-arm sample minimum');
assert.throws(() => evaluateResearchAnswerQuality({ outcomes, reviews,
  preregistration: { minimumAnswerableSample: 0 } }), /positive minimumAnswerableSample/u);

console.log('PASS versioned research answer-quality policy: fixed denominators, hash binding, separate conditional fidelity, abstention handling, citation resolution, and scope/contract guards.');
