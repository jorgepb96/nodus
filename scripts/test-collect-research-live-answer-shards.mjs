import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { aggregateResearchLiveAnswerShards } from './collect-research-live-answer-shards.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const cases = Array.from({ length: 80 }, (_, i) => ({ id: `R${String(i + 1).padStart(3, '0')}`, isAnswerable: i < 60 }));
const production = { 'electron/example.ts': hash('production') };
const assignment = { format: 'nodus.research-live-answer-shard-assignment/1', productionSourceFiles: production,
  closedCampaign: { concludedCases: cases.slice(0, 2).map(row => ({ caseId: row.id })) }, fullCases: cases,
  shards: Array.from({ length: 3 }, (_, i) => ({ id: `shard-${String(i + 1).padStart(2, '0')}`,
    caseIds: cases.slice(2).filter((_, n) => n % 3 === i).map(row => row.id) })) };
const groups = [{ id: 'preserved', caseIds: ['R001', 'R002'] }, ...assignment.shards];
const parts = groups.map(group => ({ id: group.id, productionSourceFiles: production, evidenceSha256: hash(group.id),
  outcomes: group.caseIds.map(id => ({ caseId: id, reviewId: `review-${id}`, arm: 'structured',
    positive: Number(id.slice(1)) <= 60, answered: id !== 'R002', finished: true,
    outcome: id === 'R002' ? 'protocol-failure' : 'answered', answerSha256: hash(id), sourceHash: hash(`${id}-source`) })),
  reviewPacket: [], productInvariantEvidence: { evidenceType: 'product-runtime-receipt', evidenceSha256: hash(group.id),
    citationResolution: { captured: 1, resolved: 1, resolver: 'synthetic test' },
    scopeContractIsolation: { checkedOutcomes: group.caseIds.length, observedScopeLeaks: 0, observedContractLeaks: 0, checksRun: true } } }));
const reviews = parts.flatMap(part => part.outcomes.map(row => ({ reviewId: row.reviewId, answerSha256: row.answerSha256,
  sourceHash: row.sourceHash, reviewer: 'synthetic regression fixture', notes: row.answered ? 'Synthetic positive fixture.' : 'Preserved failed attempt.',
  correct: row.answered, complete: row.answered, noMaterialUnsupportedClaims: row.answered,
  insufficientEvidenceHandled: !row.positive && row.answered })));
const measured = aggregateResearchLiveAnswerShards({ assignment, parts, reviews });
assert.equal(measured.quality.acceptance, true);
assert.deepEqual(measured.quality.arms.structured.metrics.answerableCorrectAndComplete, { passed: 59, planned: 60, rate: 59 / 60 });
assert.equal(measured.quality.productInvariants.scopeContractIsolation.checkedOutcomes, 80);
const partial = aggregateResearchLiveAnswerShards({ assignment, parts: parts.slice(0, 3), reviews: reviews.filter(row => !parts[3].outcomes.some(item => item.reviewId === row.reviewId)) });
assert.equal(partial.quality.denominators.planned, 80);
assert.equal(partial.quality.acceptance, null);
assert.equal(partial.notExecuted, 26);
assert.throws(() => aggregateResearchLiveAnswerShards({ assignment, parts: [...parts, parts[0]], reviews }), /Duplicate aggregation part/u);
const foreign = structuredClone(parts); foreign[1].outcomes[0].caseId = 'R001';
assert.throws(() => aggregateResearchLiveAnswerShards({ assignment, parts: foreign, reviews }), /Duplicate or foreign/u);
const drift = structuredClone(parts); drift[1].productionSourceFiles['electron/example.ts'] = hash('changed');
assert.throws(() => aggregateResearchLiveAnswerShards({ assignment, parts: drift, reviews }), /Production source versions/u);
const noProof = structuredClone(parts); noProof[2].productInvariantEvidence = null;
assert.equal(aggregateResearchLiveAnswerShards({ assignment, parts: noProof, reviews }).quality.acceptance, null);
const stale = structuredClone(reviews); stale[0].answerSha256 = hash('wrong answer');
assert.throws(() => aggregateResearchLiveAnswerShards({ assignment, parts, reviews: stale }), /hash|binding/iu);
console.log('PASS shard aggregation: fixed 80-case denominator, preserved failure, unique assignment, source pins, incomplete proof and review binding.');
