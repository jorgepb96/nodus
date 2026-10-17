import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(directory, name));
const json = name => JSON.parse(read(name));
const requireThat = (value, message) => { if (!value) throw new Error(message); };
const selection = json('selection.json');
const registration = json('preregistration.json');
const amendment = json('serial-amendment.json');
requireThat(sha(read('selection.json')) === registration.selectionSha256, 'Selection hash differs');
requireThat(sha(read('execution-registration.json')) === registration.executionRegistrationSha256, 'Execution registration hash differs');
requireThat(sha(read('initial-attempt-results.json')) === amendment.priorReportSha256, 'Initial attempts differ');
requireThat(sha(fs.readFileSync(path.resolve(directory, '../../..', selection.baseline.file))) === selection.baseline.sha256, 'Closed baseline differs');

const judgments = new Map();
const proofs = [];
for (const name of fs.readdirSync(directory).filter(name => /^source-review-\d{3}\.json$/.test(name)).sort()) {
  const number = name.match(/\d{3}/)[0];
  const packetBytes = read(`blind-review-pack-${number}.json`);
  const packet = JSON.parse(packetBytes);
  const receiptBytes = read(`source-review-${number}-read-receipt.json`);
  const receipt = JSON.parse(receiptBytes);
  const reviews = json(name).reviews;
  requireThat(receipt.packetSHA256 === sha(packetBytes) && receipt.packetBytes === packetBytes.length, `Packet mismatch ${number}`);
  let end = 0;
  for (const range of receipt.parts ?? receipt.byteRanges ?? receipt.ranges ?? []) {
    const start = range.startByte ?? range.byteOffset;
    const stop = range.endByteExclusive ?? (range.byteOffset + range.byteLength);
    requireThat(Number.isInteger(start) && Number.isInteger(stop) && start === end && stop > start && stop <= packetBytes.length, `Read range mismatch ${number}`);
    requireThat(range.sha256 === sha(packetBytes.subarray(start, stop)), `Read range hash differs ${number}`);
    end = stop;
  }
  requireThat(end === packetBytes.length, `Incomplete source read ${number}`);
  requireThat(Array.isArray(reviews) && reviews.length === packet.reviews.length, `Review count differs ${number}`);
  for (const row of packet.reviews) {
    requireThat(!['caseId', 'role', 'positive', 'expectedAnswer', 'gold', 'baselineStatus'].some(key => Object.hasOwn(row, key)), `Unblinded packet metadata ${number}`);
    const review = reviews.find(value => value.reviewId === row.reviewId);
    requireThat(review && review.answerSha256 === row.answerSha256 && review.sourceHash === row.sourceHash, `Answer/source binding differs ${number}`);
    requireThat(!judgments.has(row.reviewId), 'Duplicate judgment');
    requireThat(['correct', 'complete', 'noMaterialUnsupportedClaims', 'insufficientEvidenceHandled'].every(key => typeof review[key] === 'boolean'), 'Missing review judgments');
    judgments.set(row.reviewId, review);
  }
  proofs.push({ number, packetSha256: sha(packetBytes), packetBytes: packetBytes.length, reviewSha256: sha(read(name)), readReceiptSha256: sha(receiptBytes) });
}

const completeRequired = process.argv.includes('--require-complete');
const closedRequired = process.argv.includes('--require-closed');
const closedPath = path.join(directory, 'closed-results.json');
requireThat(!closedRequired || fs.existsSync(closedPath), 'Campaign has no closure');
let closed = null;
if (fs.existsSync(closedPath)) {
  closed = json('closed-results.json');
  requireThat(closed.stage === 'closed-incomplete' && closed.complete === false, 'Incomplete closure mislabelled');
  requireThat(closed.selectionSha256 === sha(read('selection.json')) && closed.amendmentSha256 === sha(read('serial-amendment.json')), 'Closure registration binding differs');
  requireThat(closed.rows.length === 37 && new Set(closed.rows.map(row => row.caseId)).size === 37 && closed.rows.every(row => selection.caseIds.includes(row.caseId)), 'Closure roster differs');
  const controls = new Set(selection.controls.map(row => typeof row === 'string' ? row : row.caseId));
  for (const row of closed.rows) {
    requireThat(row.role === (controls.has(row.caseId) ? 'normal-control' : 'previous-failure'), 'Closure case role differs');
    const review = judgments.get(row.reviewId);
    if (row.status === 'source-reviewed-publication') requireThat(review && review.answerSha256 === row.answerSha256 && review.sourceHash === row.sourceHash && review.correct && review.complete && review.noMaterialUnsupportedClaims, 'Closure judgment differs');
    requireThat(row.success === (row.status === 'source-reviewed-publication'), 'Unknown or failed closure outcome credited');
  }
  requireThat(closed.sourceReviewedPublications === judgments.size && closed.rows.filter(row => row.success).length === judgments.size, 'Closure review count differs');
  requireThat(closed.resolvedFailures.passed === closed.rows.filter(row => row.role === 'previous-failure' && row.success).length && closed.resolvedFailures.planned === 32, 'Closure recovered-failure count differs');
  requireThat(closed.controlsRetained.passed === closed.rows.filter(row => row.role === 'normal-control' && row.success).length && closed.controlsRetained.planned === 5, 'Closure control count differs');
  requireThat(closed.withoutFinalEvidence.length === closed.rows.filter(row => row.status === 'no-final-evidence').length && closed.knownTerminal + closed.withoutFinalEvidence.length === 37, 'Closure coverage differs');
  requireThat(closed.qualityAcceptanceEligible === false && closed.globalImprovementClaim === false && closed.validatedProfiles.length === 0, 'Incomplete closure cannot validate a profile');
}
const finalPath = path.join(directory, 'final-results.json');
requireThat(!completeRequired || fs.existsSync(finalPath), 'Campaign has no final result');
let final = null;
if (fs.existsSync(finalPath)) {
  final = json('final-results.json');
  requireThat(final.complete === true && final.planned === 37 && final.concluded === 37 && final.pending.length === 0, 'Campaign incomplete');
  requireThat(final.selectionSha256 === sha(read('selection.json')) && final.amendmentSha256 === sha(read('serial-amendment.json')), 'Final registration binding differs');
  requireThat(final.qualityAcceptanceEligible === false && final.globalImprovementClaim === false, 'Selected cohort cannot establish global acceptance');
  requireThat(final.rows.length === 37 && new Set(final.rows.map(row => row.caseId)).size === 37 && final.rows.every(row => selection.caseIds.includes(row.caseId)), 'Final roster differs');
  const controls = new Set(selection.controls.map(row => typeof row === 'string' ? row : row.caseId));
  for (const row of final.rows) {
    requireThat(row.finished && ['answered', 'verification-withheld', 'protocol-failure'].includes(row.attemptStatus), 'Nonterminal final case');
    requireThat(row.role === (controls.has(row.caseId) ? 'normal-control' : 'previous-failure'), 'Case role differs');
    const review = judgments.get(row.reviewId);
    if (row.answered) requireThat(review && review.answerSha256 === row.answerSha256 && review.sourceHash === row.sourceHash, 'Final judgment binding differs');
    const success = Boolean(row.answered && review?.noMaterialUnsupportedClaims && (row.positive ? review.correct && review.complete : review.insufficientEvidenceHandled));
    requireThat(row.success === success, 'Final success differs from source judgment');
  }
  requireThat(final.reviewed === judgments.size && final.publishedQualified === final.rows.filter(row => row.answered).length && final.reviewed === final.publishedQualified, 'Final review coverage differs');
  requireThat(final.resolvedFailures.passed === final.rows.filter(row => row.role === 'previous-failure' && row.success).length && final.resolvedFailures.planned === 32, 'Recovered-failure count differs');
  requireThat(final.controlsRetained.passed === final.rows.filter(row => row.role === 'normal-control' && row.success).length && final.controlsRetained.planned === 5, 'Control count differs');
}
console.log(JSON.stringify({ format: 'nodus.regression37-proof-verification/1', verifiedReviews: judgments.size, closedIncomplete: Boolean(closed), finalized: Boolean(final), resolvedFailures: final?.resolvedFailures ?? closed?.resolvedFailures ?? null, controlsRetained: final?.controlsRetained ?? closed?.controlsRetained ?? null, proofs }, null, 2));
