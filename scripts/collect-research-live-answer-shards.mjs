#!/usr/bin/env node
/** Aggregate one frozen cohort across independent QA processes, preserving failures. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateResearchAnswerQuality } from './lib/researchAnswerQualityPolicy.mjs';
import { sourceHashesForProduction } from './lib/researchLiveAnswerShards.mjs';
import { collectProductInvariantEvidence } from './collect-research-live-answers.mjs';
import { verifyDerivedIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const read = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) throw new Error('Aggregation input must be a canonical regular file');
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString('utf8')), sha256: sha(bytes) };
};

export function aggregateResearchLiveAnswerShards({ assignment, parts, reviews = [] }) {
  if (assignment?.format !== 'nodus.research-live-answer-shard-assignment/1' || !Array.isArray(parts)) throw new Error('Frozen assignment and parts are required');
  const expectedIds = [...assignment.closedCampaign.concludedCases.map(row => row.caseId), ...assignment.shards.flatMap(row => row.caseIds)];
  if (expectedIds.length !== 80 || new Set(expectedIds).size !== 80) throw new Error('Assignment must cover exactly 80 unique cases');
  const ids = new Set(), partIds = new Set(), outcomes = [], invariantEvidence = [], packets = [];
  for (const part of parts) {
    if (partIds.has(part.id)) throw new Error('Duplicate aggregation part');
    partIds.add(part.id);
    const assigned = part.id === 'preserved' ? assignment.closedCampaign.concludedCases.map(row => row.caseId)
      : assignment.shards.find(row => row.id === part.id)?.caseIds;
    if (!assigned || !Array.isArray(part.outcomes) || part.outcomes.length !== assigned.length) throw new Error('Part roster differs from its assignment');
    if (stable(part.productionSourceFiles) !== stable(assignment.productionSourceFiles)) throw new Error('Production source versions differ between parts');
    for (const row of part.outcomes) {
      if (!assigned.includes(row.caseId) || ids.has(row.caseId)) throw new Error('Duplicate or foreign case in aggregation');
      ids.add(row.caseId); outcomes.push(row);
    }
    packets.push(...part.reviewPacket);
    if (part.productInvariantEvidence) invariantEvidence.push(part.productInvariantEvidence);
  }
  const planned = new Set(outcomes.map(row => row.caseId));
  // Missing shards stay visible in the fixed denominator, never disappear.
  const snapshotCases = assignment.fullCases;
  if (!Array.isArray(snapshotCases) || snapshotCases.length !== 80) throw new Error('Full frozen source cases are required');
  for (const item of snapshotCases) if (!planned.has(item.id)) outcomes.push({ caseId: item.id,
    reviewId: `pending-${item.id}`, arm: 'structured', positive: item.isAnswerable,
    answered: false, finished: false, answerSha256: sha(''), sourceHash: sha('[]') });
  const campaignFinished = outcomes.length === 80 && outcomes.every(row => row.finished === true);
  let productInvariantEvidence = null;
  if (parts.length === 4 && invariantEvidence.length === 4) {
    productInvariantEvidence = { evidenceType: 'product-runtime-receipt', evidenceSha256: sha(stable(invariantEvidence)),
      citationResolution: { captured: invariantEvidence.reduce((n, row) => n + row.citationResolution.captured, 0),
        resolved: invariantEvidence.reduce((n, row) => n + row.citationResolution.resolved, 0), resolver: 'Hash-bound per-process production citation receipts' },
      scopeContractIsolation: { checkedOutcomes: invariantEvidence.reduce((n, row) => n + row.scopeContractIsolation.checkedOutcomes, 0),
        observedScopeLeaks: invariantEvidence.reduce((n, row) => n + row.scopeContractIsolation.observedScopeLeaks, 0),
        observedContractLeaks: invariantEvidence.reduce((n, row) => n + row.scopeContractIsolation.observedContractLeaks, 0),
        checksRun: invariantEvidence.every(row => row.scopeContractIsolation.checksRun === true) } };
  }
  const quality = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished, productInvariantEvidence,
    preregistration: { minimumAnswerableSample: 60 } });
  return { format: 'nodus.research-live-answer-shard-evaluation/1', quality, campaignFinished,
    concluded: outcomes.filter(row => row.finished).length, notExecuted: outcomes.filter(row => !row.finished).length,
    parts: parts.map(row => ({ id: row.id, evidenceSha256: row.evidenceSha256, planned: row.outcomes.length })),
    caseOutcomes: outcomes, reviewPacket: { format: 'nodus.research-answer-blind-review-pack/1', reviews: packets },
    limitations: ['The same production sources are pinned across processes; QA helper versions differ from the preserved two-case phase.',
      'The original coordinator timeout remains a failed outcome. The cohort is directed and does not establish a population accuracy rate.'] };
}

function loadPart(entry, assignment) {
  const evaluationFile = read(entry.evaluation);
  const evaluation = evaluationFile.value;
  const directory = path.dirname(entry.evaluation);
  const old = entry.id === 'preserved';
  const campaignDirectory = assignment.closedCampaign.path;
  const manifestFile = read(old ? path.join(campaignDirectory, 'manifest.json') : path.join(directory, 'manifest-snapshot.json'));
  const campaignFile = read(old ? path.join(campaignDirectory, 'campaign.json') : path.join(directory, 'campaign-snapshot.json'));
  if (evaluation.campaign.manifestSha256 !== manifestFile.sha256 || evaluation.campaign.campaignSha256 !== campaignFile.sha256) throw new Error('Evaluation ledger digest mismatch');
  const manifest = manifestFile.value, campaign = campaignFile.value;
  if (old && (manifestFile.sha256 !== assignment.closedCampaign.manifestSha256 || campaignFile.sha256 !== assignment.closedCampaign.campaignSha256)) throw new Error('Preserved campaign changed');
  const utility = read(path.join(directory, 'utility-key.json')).value;
  if (sha(JSON.stringify(utility)) !== evaluation.utilityKeySha256) throw new Error('Utility sidecar digest mismatch');
  const selected = old ? assignment.closedCampaign.concludedCases.map(row => row.caseId) : assignment.shards.find(row => row.id === entry.id)?.caseIds;
  if (!selected) throw new Error('Unknown shard');
  const packetById = new Map(evaluation.reviewPacket.reviews.map(row => [row.reviewId, row]));
  const snapshot = read(manifest.sourceSnapshot).value;
  const caseById = new Map(snapshot.cases.map(row => [row.id, row]));
  const outcomes = evaluation.caseOutcomes ?? utility.map(row => {
    const packet = packetById.get(row.reviewId), item = caseById.get(row.caseId);
    return { caseId: row.caseId, reviewId: row.reviewId, arm: 'structured', positive: item.isAnswerable,
      answered: row.outcome === 'answered' && Boolean(packet?.answer), finished: row.finished,
      outcome: row.outcome, answerSha256: packet.answerSha256, sourceHash: packet.sourceHash };
  });
  let policyEvidence = evaluation.productInvariantPolicyEvidence ?? null;
  if (old) {
    const source = read(manifest.sourceVersion.sourceSnapshot).value;
    const validation = verifyDerivedIndexAuthorization(source);
    policyEvidence = collectProductInvariantEvidence({ attempts: campaign.answers, manifest, planned: 2,
      indexAuthorization: { status: 'verified', receipt: source.indexAuthorization, validation } })?.policyEvidence ?? null;
  }
  return { id: entry.id, outcomes: outcomes.filter(row => selected.includes(row.caseId)),
    reviewPacket: utility.filter(row => selected.includes(row.caseId)).map(row => packetById.get(row.reviewId)),
    productionSourceFiles: sourceHashesForProduction(manifest.sourceVersion.sourceFiles),
    productInvariantEvidence: policyEvidence, evidenceSha256: evaluationFile.sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(2, at), value.slice(at + 1)]; }));
    const assignment = read(args.assignment).value;
    assignment.fullCases = read(assignment.fullSourceSnapshot.path).value.cases;
    const parts = read(args.bundle).value.parts.map(entry => loadPart(entry, assignment));
    const reviews = args.reviews ? read(args.reviews).value : [];
    const result = aggregateResearchLiveAnswerShards({ assignment, parts, reviews });
    fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output: args.output, concluded: result.concluded, notExecuted: result.notExecuted, acceptance: result.quality.acceptance }));
  } catch (error) { console.error(`Shard aggregation rejected: ${error.message}`); process.exitCode = 1; }
}
