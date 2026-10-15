/** Deterministic assignment tests; no app, profile, provider, or external process is launched. */
import assert from 'node:assert/strict';
import { buildResearchLiveShardAssignment, validateResearchLiveShardAssignment, validateResearchLiveShardSource } from './lib/researchLiveAnswerShards.mjs';
import { planResearchLiveCases } from './lib/researchLiveAnswerCampaignState.mjs';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const kinds = [...Array(10).fill('complex-multisource'), ...Array(10).fill('hard'), ...Array(40).fill('core'), ...Array(20).fill('no-evidence')];
const plan = planResearchLiveCases(kinds.map((kind, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`, kind, sourceCaseHash: sha(`case-${index + 1}`) })));
const concludedAnswers = [
  { caseId: 'R001', sourceCaseHash: plan[0].sourceCaseHash, attempted: true, attemptStatus: 'answered', finishedAt: '2026-10-08T00:00:00Z' },
  { caseId: 'R002', sourceCaseHash: plan[1].sourceCaseHash, attempted: true, attemptStatus: 'protocol-failure', finishedAt: '2026-10-08T00:01:00Z' },
];
const hashes = { sourceSnapshotSha256: sha('sources'), preregistrationSha256: sha('prereg'), casesSha256: sha('cases'), profileContractSha256: sha('profile contract'), scopeContractSha256: sha('scope contract'),
  closedCampaignManifestSha256: sha('manifest'), closedCampaignSha256: sha('campaign'), fullSourceSnapshotSha256: sha('full snapshot') };
const productionSourceFiles = { 'electron/ai/researchAssistant.ts': sha('production source') };
const assignment = buildResearchLiveShardAssignment({ plan, concludedAnswers, productionSourceFiles,
  ...hashes, closedCampaignPath: '/qa/closed', fullSourceSnapshotPath: '/qa/source-snapshot' });
assert.equal(assignment.frozenFullPlanCount, 80);
assert.equal(assignment.concludedCount, 2);
assert.equal(assignment.unattemptedCount, 78);
assert.deepEqual(assignment.shards.map(row => row.caseIds.length), [26, 26, 26]);
assert.deepEqual(assignment.closedCampaign.concludedCases.map(row => [row.caseId, row.attemptStatus]), [['R001', 'answered'], ['R002', 'protocol-failure']]);
for (const shard of assignment.shards) {
  assert.deepEqual(validateResearchLiveShardAssignment({ assignment, shardId: shard.id, plan, concludedAnswers,
    productionSourceFiles, ...hashes }), shard);
}
assert.throws(() => validateResearchLiveShardAssignment({ assignment, shardId: 'shard-04', plan, concludedAnswers, productionSourceFiles, ...hashes }), /unknown shard/u);
assert.throws(() => validateResearchLiveShardAssignment({ assignment, shardId: 'shard-01', plan: plan.slice(1), concludedAnswers, productionSourceFiles, ...hashes }), /complete frozen 80-case plan/u);
assert.throws(() => buildResearchLiveShardAssignment({ plan, concludedAnswers: [{ ...concludedAnswers[0] }, { ...concludedAnswers[0] }], productionSourceFiles, ...hashes }), /duplicate concluded case/u);
assert.throws(() => buildResearchLiveShardAssignment({ plan, concludedAnswers: [{ ...concludedAnswers[0], caseId: 'R003' }, concludedAnswers[1]], productionSourceFiles, ...hashes }), /Malformed or unbound concluded attempt/u);
const tampered = structuredClone(assignment); tampered.shards[0].caseIds[0] = 'R001';
assert.throws(() => validateResearchLiveShardAssignment({ assignment: tampered, shardId: 'shard-01', plan, concludedAnswers, productionSourceFiles, ...hashes }), /case partition changed/u);
console.log(JSON.stringify({ ok: true, fullPlanCount: 80, preservedConcludedCount: 2, assignedRemainingCount: 78, shardCounts: assignment.shards.map(row => row.caseIds.length) }));

const source = { caseSourceSnapshotSha256: hashes.casesSha256, profileContractSha256: hashes.profileContractSha256,
  scopeContractSha256: hashes.scopeContractSha256 };
assert.deepEqual(validateResearchLiveShardSource({ source, sourceHash: hashes.sourceSnapshotSha256, assignment,
  closedCampaignRoot: '/qa/original', cloneRoot: '/qa/original' }), { cloneQualified: false, canonicalSourceSnapshotSha256: hashes.sourceSnapshotSha256 });
const qualifiedClone = { ...source, cloneQualification: { format: 'nodus.qualified-profile-clone-provenance/1',
  transferMode: 'path-rebased cloned QA profile; unchanged indexed content and vectors', originalSourceSnapshotSha256: hashes.sourceSnapshotSha256,
  originalProfileRoot: '/qa/original', cloneProfileRoot: '/qa/clone', caseSourceSnapshotSha256: hashes.casesSha256,
  profileContractSha256: hashes.profileContractSha256, scopeContractSha256: hashes.scopeContractSha256,
  caseCount: 80, resolvedDocumentCount: 40,
  retrievalEvidence: 'The 80 case contexts and retrieval traces are copied from the original audited snapshot. Their timestamps describe the original run; this clone qualification performs no retrieval.' } };
assert.equal(validateResearchLiveShardSource({ source: qualifiedClone, sourceHash: sha('root-specific clone metadata'), assignment,
  closedCampaignRoot: '/qa/original', cloneRoot: '/qa/clone' }).cloneQualified, true);
assert.throws(() => validateResearchLiveShardSource({ source: qualifiedClone, sourceHash: sha('root-specific clone metadata'), assignment,
  closedCampaignRoot: '/qa/wrong', cloneRoot: '/qa/clone' }), /cloneQualification/u);
