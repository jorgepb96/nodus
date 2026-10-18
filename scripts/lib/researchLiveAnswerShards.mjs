/** Deterministic, audited partitioning for a closed live-answer campaign's unattempted cases. */
import { createHash } from 'node:crypto';

export const LIVE_ANSWER_SHARD_ASSIGNMENT_FORMAT = 'nodus.research-live-answer-shard-assignment/1';
export const LIVE_ANSWER_QA_SOURCE_FILES = Object.freeze([
  'scripts/research-live-answer-campaign.mjs', 'scripts/test-research-live-answer-campaign.mjs',
  'scripts/lib/researchLiveAnswerShards.mjs', 'scripts/test-research-live-answer-shards.mjs',
  'scripts/research-luna-dispatch.mjs', 'scripts/research-luna-response.mjs', 'scripts/research-luna-bridge.mjs',
  'scripts/research-isolation.mjs', 'scripts/lib/researchLunaCampaignState.mjs',
  'scripts/lib/researchLiveAnswerCampaignState.mjs', 'scripts/lib/researchLiveIndexAuthorization.mjs',
  'scripts/lib/tsRuntimeHooks.mjs', 'scripts/lib/research-app-harness.mjs',
  'scripts/research-live-evidence-campaign.mjs', 'scripts/test-research-live-index-authorization.mjs',
]);
const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/** Round-robin the existing frozen run order so each shard gets 26 unique cases. */
export function buildResearchLiveShardAssignment({ plan, concludedAnswers, sourceSnapshotSha256,
  preregistrationSha256, casesSha256, profileContractSha256, scopeContractSha256, productionSourceFiles, closedCampaignManifestSha256,
  closedCampaignSha256, fullSourceSnapshotSha256, shardCount = 3, closedCampaignPath,
  fullSourceSnapshotPath }) {
  assert(Array.isArray(plan) && plan.length === 80, 'Expected the complete frozen 80-case plan');
  assert(Number.isSafeInteger(shardCount) && shardCount > 0, 'Shard count must be a positive integer');
  const ids = new Set();
  for (let index = 0; index < plan.length; index++) {
    const row = plan[index];
    assert(row && /^R\d{3}$/u.test(row.caseId) && !ids.has(row.caseId), `Invalid or duplicate planned ID: ${row?.caseId}`);
    assert(row.ordinal === index + 1 && typeof row.sourceCaseHash === 'string' && /^[a-f0-9]{64}$/u.test(row.sourceCaseHash), `Invalid plan row: ${row.caseId}`);
    ids.add(row.caseId);
  }
  assert(Array.isArray(concludedAnswers), 'Closed campaign answer ledger is required');
  const concluded = new Map();
  for (const answer of concludedAnswers) {
    assert(ids.has(answer?.caseId) && !concluded.has(answer.caseId), `Invalid or duplicate concluded case: ${answer?.caseId}`);
    const planned = plan.find(row => row.caseId === answer.caseId);
    assert(answer.sourceCaseHash === planned.sourceCaseHash && answer.attempted === true
      && ['answered', 'verification-withheld', 'protocol-failure'].includes(answer.attemptStatus),
    `Malformed or unbound concluded attempt: ${answer.caseId}`);
    concluded.set(answer.caseId, { caseId: answer.caseId, sourceCaseHash: answer.sourceCaseHash,
      attemptStatus: answer.attemptStatus, finishedAt: answer.finishedAt ?? null });
  }
  assert(concluded.size > 0, 'A closed campaign with concluded attempts is required');
  const remaining = plan.filter(row => !concluded.has(row.caseId));
  assert(remaining.length === 78, `Expected 78 unattempted cases, received ${remaining.length}`);
  assert(concluded.has('R001') && concluded.get('R001').attemptStatus === 'answered'
    && concluded.has('R002') && concluded.get('R002').attemptStatus === 'protocol-failure',
  'The preserved R001 answered and R002 protocol-failure outcomes are required');
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    id: `shard-${String(index + 1).padStart(2, '0')}`,
    caseIds: remaining.filter((_, caseIndex) => caseIndex % shardCount === index).map(row => row.caseId),
    cases: remaining.filter((_, caseIndex) => caseIndex % shardCount === index)
      .map(({ ordinal, caseId, kind, sourceCaseHash }) => ({ ordinal, caseId, kind, sourceCaseHash })),
  }));
  assert(shards.every(shard => shard.caseIds.length === Math.floor(remaining.length / shardCount)
    || shard.caseIds.length === Math.ceil(remaining.length / shardCount)), 'Shard case counts are not balanced');
  const flattened = shards.flatMap(shard => shard.caseIds);
  assert(flattened.length === remaining.length && new Set(flattened).size === flattened.length
    && remaining.every(row => flattened.includes(row.caseId)), 'Shard assignments do not cover each remaining case exactly once');
  const requiredHash = (value, label) => assert(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), `${label} must be a SHA-256 digest`);
  for (const [value, label] of [[sourceSnapshotSha256, 'sourceSnapshotSha256'], [preregistrationSha256, 'preregistrationSha256'],
    [casesSha256, 'casesSha256'], [profileContractSha256, 'profileContractSha256'], [scopeContractSha256, 'scopeContractSha256'], [closedCampaignManifestSha256, 'closedCampaignManifestSha256'],
    [closedCampaignSha256, 'closedCampaignSha256'], [fullSourceSnapshotSha256, 'fullSourceSnapshotSha256']]) requiredHash(value, label);
  assert(productionSourceFiles && typeof productionSourceFiles === 'object' && !Array.isArray(productionSourceFiles)
    && Object.keys(productionSourceFiles).length > 0, 'Pinned production source hashes are required');
  for (const [file, hash] of Object.entries(productionSourceFiles)) requiredHash(hash, `production source hash ${file}`);
  return {
    format: LIVE_ANSWER_SHARD_ASSIGNMENT_FORMAT, strategy: 'round-robin-frozen-plan-order',
    frozenFullPlanCount: 80, concludedCount: concluded.size, unattemptedCount: remaining.length,
    shardCount, sourceSnapshotSha256, preregistrationSha256, casesSha256, profileContractSha256, scopeContractSha256,
    productionSourceCommit: '51ddac9de08c95fd0dd0475668c97fd40f06c868', productionSourceFiles,
    qaSourceFilesExcludedFromProductionPin: [...LIVE_ANSWER_QA_SOURCE_FILES],
    closedCampaign: { path: closedCampaignPath, manifestSha256: closedCampaignManifestSha256,
      campaignSha256: closedCampaignSha256, concludedCases: [...concluded.values()] },
    fullSourceSnapshot: { path: fullSourceSnapshotPath, sha256: fullSourceSnapshotSha256, plannedCount: 80 },
    shards,
  };
}

/** Validate a shard file against the current source plan and an immutable closed ledger. */
export function validateResearchLiveShardAssignment({ assignment, shardId, plan, concludedAnswers,
  sourceSnapshotSha256, preregistrationSha256, casesSha256, profileContractSha256, scopeContractSha256, productionSourceFiles,
  closedCampaignManifestSha256, closedCampaignSha256, fullSourceSnapshotSha256 }) {
  const reject = reason => { throw new Error(`Shard assignment rejected: ${reason}`); };
  if (assignment?.format !== LIVE_ANSWER_SHARD_ASSIGNMENT_FORMAT) reject('format mismatch');
  if (assignment.strategy !== 'round-robin-frozen-plan-order' || assignment.frozenFullPlanCount !== 80
      || assignment.unattemptedCount !== 78 || assignment.concludedCount !== 2) reject('plan summary mismatch');
  for (const [key, actual] of Object.entries({ sourceSnapshotSha256, preregistrationSha256, casesSha256, profileContractSha256, scopeContractSha256, productionSourceFiles })) {
    if (JSON.stringify(assignment[key]) !== JSON.stringify(actual)) reject(`${key} changed`);
  }
  if (assignment.closedCampaign?.manifestSha256 !== closedCampaignManifestSha256) reject('closedCampaignManifestSha256 changed');
  if (assignment.closedCampaign?.campaignSha256 !== closedCampaignSha256) reject('closedCampaignSha256 changed');
  if (assignment.fullSourceSnapshot?.sha256 !== fullSourceSnapshotSha256) reject('fullSourceSnapshotSha256 changed');
  if (!Array.isArray(assignment.shards) || assignment.shards.length !== 3) reject('shard list mismatch');
  const expected = buildResearchLiveShardAssignment({ plan, concludedAnswers, sourceSnapshotSha256,
    preregistrationSha256, casesSha256, profileContractSha256, scopeContractSha256, productionSourceFiles, closedCampaignManifestSha256,
    closedCampaignSha256, fullSourceSnapshotSha256, closedCampaignPath: assignment.closedCampaign?.path,
    fullSourceSnapshotPath: assignment.fullSourceSnapshot?.path, shardCount: 3 });
  if (JSON.stringify(assignment.shards) !== JSON.stringify(expected.shards)) reject('case partition changed');
  const closedCases = assignment.closedCampaign?.concludedCases;
  if (JSON.stringify(closedCases) !== JSON.stringify(expected.closedCampaign.concludedCases)) reject('closed outcomes changed');
  const shard = assignment.shards.find(row => row.id === shardId);
  if (!shard) reject(`unknown shard ${shardId}`);
  return shard;
}

export function sourceHashesForProduction(sourceFiles) {
  return Object.fromEntries(Object.entries(sourceFiles).filter(([file]) => !LIVE_ANSWER_QA_SOURCE_FILES.includes(file)));
}

export function sha256Bytes(bytes) { return sha(bytes); }

/** Bind root-rewritten clone metadata to the canonical, audited case snapshot. */
export function validateResearchLiveShardSource({ source, sourceHash, assignment, closedCampaignRoot, cloneRoot }) {
  const reject = reason => { throw new Error(`Shard source rejected: ${reason}`); };
  if (source?.caseSourceSnapshotSha256 !== assignment?.casesSha256
      || source?.profileContractSha256 !== assignment?.profileContractSha256
      || source?.scopeContractSha256 !== assignment?.scopeContractSha256) reject('case roster or evidence contract mismatch');
  if (sourceHash === assignment.sourceSnapshotSha256) return { cloneQualified: false, canonicalSourceSnapshotSha256: sourceHash };
  const proof = source?.cloneQualification;
  if (proof?.format !== 'nodus.qualified-profile-clone-provenance/1'
      || proof.transferMode !== 'path-rebased cloned QA profile; unchanged indexed content and vectors'
      || proof.originalSourceSnapshotSha256 !== assignment.sourceSnapshotSha256
      || proof.originalProfileRoot !== closedCampaignRoot || proof.cloneProfileRoot !== cloneRoot
      || proof.caseSourceSnapshotSha256 !== assignment.casesSha256
      || proof.profileContractSha256 !== assignment.profileContractSha256
      || proof.scopeContractSha256 !== assignment.scopeContractSha256
      || proof.caseCount !== 80 || proof.resolvedDocumentCount !== 40
      || proof.retrievalEvidence !== 'The 80 case contexts and retrieval traces are copied from the original audited snapshot. Their timestamps describe the original run; this clone qualification performs no retrieval.') {
    reject('cloneQualification does not bind this clone to the canonical audited source snapshot');
  }
  return { cloneQualified: true, canonicalSourceSnapshotSha256: proof.originalSourceSnapshotSha256 };
}
