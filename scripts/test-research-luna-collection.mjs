import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCases, collectResearchLuna, makeBlindPacket, reviewIdentity, RESEARCH_ANSWER_QUALITY_POLICY } from './collect-research-luna.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivePath = path.join(repo, 'audit/research-chat-grounding/final-82dac50f/embeddinggemma-2-text-q8-512-v1.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-collection-test-'));

function fixture(name, { complete = true, terminal = false, unavailable = null, omitReview = false, lostReceipt = false, continuation = false } = {}) {
  const directory = path.join(temp, name);
  let root = path.join(directory, 'isolated-root');
  const output = path.join(directory, 'collected');
  for (const directoryName of ['requests', 'completions', 'failed-requests', 'failed-responses', 'raw-completions', 'dispatch-jobs']) {
    fs.mkdirSync(path.join(root, 'artifacts', directoryName), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'profile'), { recursive: true });
  root = fs.realpathSync(root);
  fs.writeFileSync(path.join(root, 'isolation.json'), `${JSON.stringify({ format: 'nodus.isolated-research-profile/1', root })}\n`);
  const archiveBytes = fs.readFileSync(archivePath);
  const cases = buildCases(archiveBytes);
  const manifest = {
    format: 'research-luna-directed/1', root,
    sourceVersion: { archive: 'audit/research-chat-grounding/final-82dac50f/embeddinggemma-2-text-q8-512-v1.json',
      archiveHash: hash(archiveBytes), files: { 'audit/research-chat-grounding/final-82dac50f/embeddinggemma-2-text-q8-512-v1.json': hash(archiveBytes) } },
    cases: cases.map(row => ({ id: row.id, name: row.name, question: row.question, sourceCount: row.sources.length, sourceHash: row.sourceHash, positive: row.positive })),
  };
  const requestIds = [], answers = [];
  for (const input of cases) {
    for (const arm of ['legacy', 'structured']) {
      const id = `request-${requestIds.length}`;
      requestIds.push(id);
      const isUnavailable = unavailable === `${input.name}/${arm}`;
      answers.push({ caseId: input.id, arm, sourceHash: input.sourceHash,
        ...(isUnavailable ? { error: { classification: 'verification-withheld' }, attemptStatus: 'verification-withheld' }
          : { answer: `Fixture response [source](${input.sources[0].citation})` }),
        attempted: true, receiptsComplete: true, attemptSourceVersion: 'current',
        bridgeRequestIds: [id], bridgeCompletionIds: [id], traces: [] });
    }
  }
  if (continuation) {
    for (const [index, answer] of answers.entries()) {
      answer.attemptSourceVersion = index < 4 ? 'historical' : 'current';
      answer.attemptStatus = answer.error ? 'verification-withheld' : 'answered';
    }
    const priorAttemptSourceVersion = { archive: manifest.sourceVersion.archive, archiveHash: manifest.sourceVersion.archiveHash,
      files: manifest.sourceVersion.files, commit: 'prior-fixture-commit' };
    manifest.sourceVersion.priorAttemptSourceVersion = priorAttemptSourceVersion;
    manifest.continuation = { priorFinishedAt: '2026-10-12T00:00:00.000Z', priorAcceptedRequests: 4,
      cumulativeRequestCeiling: 150, remainingRequestAllowance: 146, preservedPriorSnapshot: 'attempt-history-fixture',
      priorAttemptSourceVersion, currentSourceVersion: { commit: 'current-fixture-commit', files: manifest.sourceVersion.files },
      historicalAttempts: answers.slice(0, 4).map(answer => ({ caseId: answer.caseId, arm: answer.arm,
        sourceHash: answer.sourceHash, attemptStatus: answer.attemptStatus, bridgeRequestIds: answer.bridgeRequestIds })),
      unchangedFiles: [manifest.sourceVersion.archive],
      changedHarnessFiles: ['scripts/research-luna-campaign.mjs', 'scripts/lib/researchLunaCampaignState.mjs'] };
  }
  if (!complete) answers.pop();
  const events = answers.flatMap((answer, index) => (answer.bridgeRequestIds ?? []).flatMap(id => [
    { event: 'accepted', id },
    ...(answer.bridgeCompletionIds?.includes(id) && !(lostReceipt && index === 0) ? [{ event: 'completed', id }] : []),
  ]));
  fs.writeFileSync(path.join(root, 'artifacts/events.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'artifacts/agent-prompts.jsonl'), '{"event":"synthetic-agent-prompt-fixture"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/agent-executions.jsonl'), '{"event":"synthetic-agent-fixture"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/orchestration-errors.jsonl'), '{"event":"synthetic-orchestration-diagnostic"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/request-read-evidence.jsonl'), '{"event":"synthetic-read-evidence"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/read-123e4567-e89b-12d3-a456-426614174000.json'), '{"event":"synthetic-read-record"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/dispatch-jobs/job-1.json'), '{"event":"synthetic-dispatch-job"}\n');
  fs.writeFileSync(path.join(root, 'profile/embedding-trace.jsonl'), '{"event":"synthetic-trace-fixture"}\n');
  fs.writeFileSync(path.join(root, 'profile/database-access.jsonl'), '{"event":"synthetic-db-audit-fixture"}\n');
  fs.writeFileSync(path.join(root, 'artifacts/failed-requests/failed.json'), '{"synthetic":true}\n');
  fs.writeFileSync(path.join(root, 'artifacts/failed-responses/failed.txt'), 'synthetic failed output\n');
  fs.writeFileSync(path.join(root, 'artifacts/raw-completions/raw.txt'), 'synthetic raw completion\n');
  const campaign = { format: 'research-luna-directed/1', root, sourceVersion: manifest.sourceVersion,
    ...(continuation ? { continuation: manifest.continuation } : {}),
    completed: complete, finishedAt: complete || terminal ? '2026-01-01T00:00:00.000Z' : undefined,
    answers, bridge: { eventFile: path.join(root, 'artifacts/events.jsonl'), pendingCallsAfterClose: 0,
      acceptedRequests: answers.length, events: { accepted: events.filter(event => event.event === 'accepted').length,
        completed: events.filter(event => event.event === 'completed').length, abandoned: 0 },
      completionRegistry: answers.flatMap(row => row.bridgeCompletionIds ?? []).map(id => ({ id })) } };
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(path.join(directory, 'campaign.json'), `${JSON.stringify(campaign)}\n`);
  const reviewRows = answers.map(answer => {
    const row = cases.find(item => item.id === answer.caseId);
    const reviewId = reviewIdentity(answer.caseId, answer.arm);
    return { reviewId, answer: answer.answer ?? null, unavailable: Boolean(answer.error), sources: row.sources,
      question: row.question, sourceHash: row.sourceHash };
  });
  const reviews = answers.map((answer, index) => {
    const row = cases.find(item => item.id === answer.caseId);
    const packet = makeBlindPacket(reviewRows[index]);
    return { reviewId: packet.reviewId, answerSha256: packet.answerSha256, sourceHash: packet.sourceHash,
      reviewer: 'Codex source inspection', faithful: !reviewRows[index].unavailable, adequate: !reviewRows[index].unavailable,
      notes: 'Synthetic structural-gate fixture only.' };
  });
  return { directory, output, root, cases, manifest, campaign, reviews: omitReview ? reviews.slice(1) : reviews };
}

try {
  const valid = fixture('valid');
  const collected = collectResearchLuna({ directory: valid.directory, outputDirectory: valid.output, reviews: valid.reviews, snapshot: false });
  assert.equal(collected.summary.measuredDirectedGenerationGate, true);
  assert.deepEqual(collected.summary.fixedDenominators, { cases: 10, supported: 8, insufficientEvidence: 2, arms: ['legacy', 'structured'] });
  assert.equal(collected.summary.arms.structured.supportedAnswers.planned, 8);
  assert.equal(collected.summary.arms.structured.insufficientEvidenceAnswers.planned, 2);
  const pack = JSON.parse(fs.readFileSync(collected.packFile, 'utf8'));
  assert.equal(pack.length, 20);
  for (const row of pack) {
    assert.equal('arm' in row, false);
    assert.equal('profile' in row, false);
    assert.equal('auditorVerdict' in row, false);
    assert.equal('gold' in row, false);
    assert.doesNotMatch(JSON.stringify(row), /qa-replay:|embeddinggemma-2-text-q8-512-v1/u, 'source IDs and citation links are blinded');
  }
  assert.deepEqual(collected.summary.validatedEmbeddingProfiles, []);
  assert.equal(collected.summary.arms.structured.citationAudit.captured, 10);
  assert.equal(collected.summary.arms.structured.citationAudit.knownManifestTargets, 10);
  assert.equal('separateQualityMetrics' in collected.summary, false, 'new quality policy is not applied retroactively by default');
  const qualityReviews = valid.reviews.map(review => ({ ...review,
    correct: review.adequate, complete: review.adequate, noMaterialUnsupportedClaims: review.faithful,
    insufficientEvidenceHandled: review.adequate, citationsResolvable: true, scopeLeak: false, contractLeak: false }));
  const qualityResult = collectResearchLuna({ directory: valid.directory, outputDirectory: path.join(valid.output, 'quality'),
    reviews: valid.reviews, qualityReviews, acceptancePolicy: RESEARCH_ANSWER_QUALITY_POLICY,
    qualityPreregistration: { minimumAnswerableSample: 8 }, snapshot: false });
  assert.equal(qualityResult.summary.separateQualityMetrics.policy, RESEARCH_ANSWER_QUALITY_POLICY);
  assert.equal(qualityResult.summary.separateQualityMetrics.status, 'pending', 'no product runtime receipts means overall quality policy remains pending');
  assert.equal(qualityResult.summary.separateQualityMetrics.answerQualityAcceptance, true,
    'pre-registered answer-quality threshold can be measured separately from product invariants');
  assert.equal(qualityResult.summary.separateQualityMetrics.productInvariants.status, 'pending');
  assert.equal(qualityResult.summary.separateQualityMetrics.acceptance, null);
  assert.equal(qualityResult.summary.measuredDirectedGenerationGate, collected.summary.measuredDirectedGenerationGate,
    'opt-in quality metrics do not alter the historical gate');
  assert.throws(() => collectResearchLuna({ directory: valid.directory, outputDirectory: path.join(valid.output, 'bad-policy'),
    acceptancePolicy: 'research-answer-quality/999', snapshot: false }), /Unknown acceptance policy/u);

  const collisionSources = [1, 10, 15].map(number => ({ id: `qa-replay:test:${number}`,
    citation: `nodus://passage/qa-replay%3Atest%3A${number}`, summary: `source ${number}` }));
  const collisionPacket = makeBlindPacket({ reviewId: 'citation-collision', question: 'Map citations exactly',
    answer: collisionSources.map((source, index) => `[source ${index + 1}](${source.citation})`).join(' '), sources: collisionSources,
    sourceHash: 'fixture-source-hash' });
  assert.match(collisionPacket.answer, /\]\(nodus:\/\/review-source\/citation-collision\/1\)/u);
  assert.match(collisionPacket.answer, /\]\(nodus:\/\/review-source\/citation-collision\/2\)/u);
  assert.match(collisionPacket.answer, /\]\(nodus:\/\/review-source\/citation-collision\/3\)/u);
  assert.doesNotMatch(collisionPacket.answer, /unresolved-source/u,
    'citation IDs with shared numeric prefixes map to their exact source rows');
  const unknownPacket = makeBlindPacket({ reviewId: 'unknown-citation', question: 'Unknown citation',
    answer: '[unknown](nodus://passage/not-in-manifest)', sources: collisionSources, sourceHash: 'fixture-source-hash' });
  assert.equal(unknownPacket.answer, '[unknown](nodus://unresolved-source/1)', 'unknown citations remain explicitly unresolved');

  const partial = fixture('partial', { complete: false });
  const partialResult = collectResearchLuna({ directory: partial.directory, outputDirectory: partial.output, reviews: partial.reviews, snapshot: false });
  assert.equal(partialResult.summary.measuredDirectedGenerationGate, null, 'unfinished campaign has no quality gate');
  assert.equal(partialResult.summary.arms.legacy.planned, 10);
  assert.equal(partialResult.summary.arms.legacy.supportedAnswers.planned, 8);
  assert.equal(path.basename(partialResult.packFile).startsWith('review-pack.partial-'), true);
  assert.equal(partialResult.summary.outcomes.length, 20, 'missing attempts remain in the fixed denominator');
  assert.equal(partialResult.summary.outcomes.filter(row => row.unavailable).length, 1);

  const terminalPartial = fixture('terminal-partial', { complete: false, terminal: true });
  const terminalResult = collectResearchLuna({ directory: terminalPartial.directory, outputDirectory: terminalPartial.output, reviews: terminalPartial.reviews });
  assert.equal(terminalResult.summary.measuredDirectedGenerationGate, null, 'a finished failed campaign still has no quality gate');
  assert.ok(terminalResult.snapshotDirectory, 'terminal failure snapshots are retained for reproduction');
  const snapshotIndex = JSON.parse(fs.readFileSync(path.join(terminalResult.snapshotDirectory, 'snapshot-index.json'), 'utf8'));
  assert.equal(snapshotIndex.campaignCompleted, false);
  for (const expected of ['artifacts/events.jsonl.gz', 'artifacts/agent-prompts.jsonl.gz', 'artifacts/agent-executions.jsonl.gz', 'profile/embedding-trace.jsonl.gz',
    'profile/database-access.jsonl.gz', path.join('bridge', 'raw-completions', 'raw.txt'),
    path.join('bridge', 'failed-responses', 'failed.txt')]) {
    assert.ok(snapshotIndex.files.some(file => file.path === expected), `terminal snapshot contains ${expected}`);
  }
  for (const expected of ['artifacts/orchestration-errors.jsonl.gz', 'artifacts/request-read-evidence.jsonl.gz',
    path.join('bridge', 'read-123e4567-e89b-12d3-a456-426614174000.json'),
    path.join('bridge', 'dispatch-jobs', 'job-1.json')]) {
    assert.ok(snapshotIndex.files.some(file => file.path === expected), `terminal snapshot contains ${expected}`);
  }

  const absentReview = fixture('absent-review', { omitReview: true });
  const absentReviewResult = collectResearchLuna({ directory: absentReview.directory, outputDirectory: absentReview.output, reviews: absentReview.reviews, snapshot: false });
  assert.equal(absentReviewResult.summary.measuredDirectedGenerationGate, null, 'missing reviewer coverage stays pending');
  assert.equal(absentReviewResult.summary.allSourceReviews, false);

  const unavailable = fixture('unavailable', { unavailable: 'paper/structured' });
  const unavailableResult = collectResearchLuna({ directory: unavailable.directory, outputDirectory: unavailable.output, reviews: unavailable.reviews, snapshot: false });
  assert.equal(unavailableResult.summary.measuredDirectedGenerationGate, false, 'a completed run with an unavailable answer fails rather than excluding it');
  assert.equal(unavailableResult.summary.arms.structured.supportedAnswers.planned, 8);
  assert.equal(unavailableResult.summary.arms.structured.supportedAnswers.answered, 7);
  assert.equal(unavailableResult.summary.arms.structured.supportedAnswers.passed, 7);
  assert.equal(unavailableResult.summary.hardGuards.allPlannedAttempts, true, 'receipt-backed verification failures are attempted outcomes');

  const baselineWithheld = fixture('baseline-withheld', { unavailable: 'negation/legacy', continuation: true });
  const baselineWithheldResult = collectResearchLuna({ directory: baselineWithheld.directory,
    outputDirectory: baselineWithheld.output, reviews: baselineWithheld.reviews, snapshot: false });
  assert.equal(baselineWithheldResult.summary.measuredDirectedGenerationGate, true,
    'a reviewed legacy verification refusal remains a negative baseline result without vetoing a passing structured arm');
  assert.equal(baselineWithheldResult.summary.arms.legacy.supportedAnswers.answered, 7);
  assert.equal(baselineWithheldResult.summary.arms.legacy.supportedAnswers.passed, 7);

  const staleArchive = fixture('stale-archive');
  staleArchive.manifest.sourceVersion.archiveHash = '0'.repeat(64);
  fs.writeFileSync(path.join(staleArchive.directory, 'manifest.json'), `${JSON.stringify(staleArchive.manifest)}\n`);
  assert.throws(() => collectResearchLuna({ directory: staleArchive.directory, outputDirectory: staleArchive.output, reviews: staleArchive.reviews, snapshot: false }), /archive hash/u);

  const staleAnswer = fixture('stale-answer');
  staleAnswer.campaign.answers[0].sourceHash = '0'.repeat(64);
  fs.writeFileSync(path.join(staleAnswer.directory, 'campaign.json'), `${JSON.stringify(staleAnswer.campaign)}\n`);
  assert.throws(() => collectResearchLuna({ directory: staleAnswer.directory, outputDirectory: staleAnswer.output, reviews: staleAnswer.reviews, snapshot: false }), /answer source hash mismatch/u);

  const unknownReview = fixture('unknown-review');
  unknownReview.reviews.push({ reviewId: 'not-in-plan', answerSha256: '', sourceHash: '', reviewer: 'Codex', faithful: true, adequate: true, notes: '' });
  assert.throws(() => collectResearchLuna({ directory: unknownReview.directory, outputDirectory: unknownReview.output, reviews: unknownReview.reviews, snapshot: false }), /unknown review ID/u);

  const lostReceipt = fixture('lost-receipt', { lostReceipt: true });
  const lostReceiptResult = collectResearchLuna({ directory: lostReceipt.directory, outputDirectory: lostReceipt.output, reviews: lostReceipt.reviews, snapshot: false });
  assert.equal(lostReceiptResult.summary.bridgeReceipts.lost, true);
  assert.equal(lostReceiptResult.summary.measuredDirectedGenerationGate, false);

  console.log('PASS Luna collection: source archive and answer hash binding, blind partial packet, fixed 8/2 denominators, citation capture, reviewer coverage, unavailable answers, unknown reviewers, and bridge receipt guards. Synthetic gate answers/reviews test collector controls only; they measure no model quality.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
