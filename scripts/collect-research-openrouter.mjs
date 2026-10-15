import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const directory = path.resolve(process.argv[2] ?? 'audit/research-openrouter');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const campaign = JSON.parse(fs.readFileSync(path.join(directory, 'campaign.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const identified = campaign.answers.map(row => {
  const input = manifest.cases.find(input => input.id === row.caseId);
  assert.ok(input);
  assert.equal(sha(input.sourceContext), input.sourceHash, 'Frozen evidence bytes must match');
  assert.equal(row.sourceHash, input.sourceHash);
  return { ...row, input, reviewId: sha(`${row.caseId}\0${row.arm}`).slice(0, 16), answerSha256: sha(row.answer ?? '') };
});
// Review packets deliberately omit arm, profile, automatic audit verdict and
// expected answers. Reviewers inspect only the question and frozen originals.
const pack = identified.map(row => ({ reviewId: row.reviewId, question: row.input.question,
  answer: row.answer ?? null, unavailable: Boolean(row.error), answerSha256: row.answerSha256,
  sourceHash: row.sourceHash, sources: JSON.parse(row.input.sourceContext).contexto_modular_seleccionado.pasajes_relevantes }));
fs.writeFileSync(path.join(directory, 'review-pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
const reviewsFile = path.join(directory, 'source-reviews.json');
const reviews = fs.existsSync(reviewsFile) ? JSON.parse(fs.readFileSync(reviewsFile, 'utf8')) : [];
assert.equal(new Set(reviews.map(row => row.reviewId)).size, reviews.length, 'Reviews must be unique');
const outcomes = identified.map(row => {
  const review = reviews.find(review => review.reviewId === row.reviewId);
  if (review) {
    assert.equal(review.answerSha256, row.answerSha256);
    assert.equal(review.sourceHash, row.sourceHash);
    assert.equal(typeof review.faithful, 'boolean');
    assert.equal(typeof review.adequate, 'boolean');
    assert.equal(typeof review.notes, 'string');
    assert.ok(review.reviewer);
  }
  const supplied = new Set(JSON.parse(row.input.sourceContext).contexto_modular_seleccionado.pasajes_relevantes.map(source => source.citation));
  const citations = [...(row.answer ?? '').matchAll(/\]\((nodus:\/\/[^)\s]+)\)/gu)].map(match => match[1]);
  return { caseId: row.caseId, arm: row.arm, positive: row.input.positive, reviewId: row.reviewId,
    answerSha256: row.answerSha256, sourceHash: row.sourceHash, answered: Boolean(row.answer), review: review ?? null,
    passed: !row.error && Boolean(row.answer) && review?.faithful === true && review?.adequate === true,
    citations: { captured: citations.length, knownManifestTargets: citations.filter(link => supplied.has(link)).length } };
});
const arms = Object.fromEntries(['legacy', 'structured'].map(arm => {
  const rows = outcomes.filter(row => row.arm === arm);
  const positives = rows.filter(row => row.positive), absence = rows.filter(row => !row.positive);
  return [arm, { executed: rows.length, reviewed: rows.filter(row => row.review).length,
    positive: { passed: positives.filter(row => row.passed).length, planned: manifest.cases.filter(row => row.positive).length,
      executed: positives.length, reviewed: positives.filter(row => row.review).length },
    insufficientEvidence: { passed: absence.filter(row => row.passed).length, planned: manifest.cases.filter(row => !row.positive).length,
      executed: absence.length, reviewed: absence.filter(row => row.review).length } }];
}));
const allReviewed = campaign.completed && outcomes.length === manifest.cases.length * 2 && outcomes.every(row => row.review);
const structured = outcomes.filter(row => row.arm === 'structured');
const knownTargets = structured.every(row => row.citations.captured === row.citations.knownManifestTargets);
const acceptance = allReviewed ? arms.structured.positive.passed / arms.structured.positive.planned >= .95
  && arms.structured.insufficientEvidence.passed / arms.structured.insufficientEvidence.planned >= .9 && knownTargets : null;
const summary = { format: 'research-openrouter-source-review/1', model: manifest.model, canonicalModel: manifest.canonicalModel,
  frozenRuntime: manifest.sourceVersion, completed: campaign.completed, arms, allReviewed,
  measuredDirectedGenerationGate: acceptance, validatedEmbeddingProfiles: [],
  limits: manifest.limits, reviewerLimit: 'Codex source inspection is separate from application auditors; it is not an external human review or population estimate.',
  cost: campaign.cost ?? null, outcomes };
fs.writeFileSync(path.join(directory, 'source-analysis.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ completed: campaign.completed, answers: outcomes.length, reviews: reviews.length, arms, acceptance }));
