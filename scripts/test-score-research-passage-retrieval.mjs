import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scoreResearchPassageRetrieval } from './score-research-passage-retrieval.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => Buffer.from(JSON.stringify(value));
const passageIds = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9',
  ...Array.from({ length: 57 }, (_, index) => `gold-${index + 4}`)]);
const passages = [...passageIds].map((passageId, index) => {
  const text = `Exact source passage text for ${passageId}.`;
  return { passage_id: passageId, sourceDocumentId: `doc-${index + 1}`,
    sourceSha256: hash(Buffer.from(`source-${passageId}`)), text_fingerprint: hash(Buffer.from(text)),
    index_key: `vector-key-${index + 1}`, ordinal: 0,
    passage_text_sha256: hash(Buffer.from(text)), text, locator: { pageLabel: 'p. 1', pageNumber: 1, sourceRef: `library:doc-${index + 1}` } };
});
const inventory = { format: 'nodus.retrieval-corpus-current-passages/1', provenance: { databaseSha256: 'a'.repeat(64) }, passages };
const inventoryBytes = serialize(inventory), inventorySha256 = hash(inventoryBytes);
const preregistration = { format: 'nodus.research-live-evidence-preregistration/1', counts: { total: 80, answerable: 60, insufficient: 20 }, queries: Array.from({ length: 80 }, (_, index) => ({
  id: `R${String(index + 1).padStart(3, '0')}`, question: `Question R${String(index + 1).padStart(3, '0')}`,
  isAnswerable: index < 60, language: 'en', kind: index < 60 ? 'answerable' : 'insufficient',
})) };
const preregistrationBytes = serialize(preregistration), preregistrationSha256 = hash(preregistrationBytes);
const inventoryPassage = id => passages.find(row => row.passage_id === id);
const evidence = id => {
  const passage = inventoryPassage(id);
  return { passageId: id, documentId: passage.sourceDocumentId, documentSha256: passage.sourceSha256,
    textFingerprint: passage.text_fingerprint, locator: structuredClone(passage.locator), quote: passage.text };
};
const fact = (id, ids, { status = 'supported', exhaustive = true } = {}) => ({ id, claim: `claim ${id}`,
  status, evidence: ids.map(evidence), exhaustiveCorpusScan: exhaustive });
const annotations = { format: 'nodus.retrieval-passage-evidence-annotations/1',
  provenance: { passageInventorySha256: inventorySha256, preregistrationSha256 },
  queries: Array.from({ length: 80 }, (_, index) => {
    const queryId = `R${String(index + 1).padStart(3, '0')}`;
    if (index === 0) return { queryId, answerable: true, question: `Question ${queryId}`, annotationStatus: 'ready',
      requiredFacts: [fact('f1', ['p1']), fact('f2', ['p2'])] };
    if (index === 1) return { queryId, answerable: true, question: `Question ${queryId}`, annotationStatus: 'ready',
      requiredFacts: [fact('f3', ['p4', 'p5'])] };
    if (index === 2) return { queryId, answerable: true, question: `Question ${queryId}`, annotationStatus: 'partial_pending',
      requiredFacts: [fact('f4', ['p7']), fact('f5', [], { status: 'pending', exhaustive: false })] };
    if (index < 60) return { queryId, answerable: true, question: `Question ${queryId}`, annotationStatus: 'ready',
      requiredFacts: [fact(`f-${index + 1}`, [`gold-${index + 1}`])] };
    return { queryId, answerable: false, question: `Question ${queryId}`, annotationStatus: 'absence_unverified',
      requiredFacts: [], absenceEvidence: { entireCorpusAbsence: 'unknown' } };
  }) };
const rank = (queryId, rankedPassages = []) => ({ queryId, rankedPassages: rankedPassages.map(passageId => ({ passageId })) });
const rankings = { format: 'nodus.research-passage-rankings/1', source: 'synthetic test fixture', arms: [
  { arm: 'semantic', queries: [rank('R001', ['p1', 'p3', 'p2']), rank('R002', ['p6', 'p5']), rank('R003', ['p7']),
    ...Array.from({ length: 57 }, (_, index) => rank(`R${String(index + 4).padStart(3, '0')}`)),
    ...Array.from({ length: 20 }, (_, index) => rank(`R${String(index + 61).padStart(3, '0')}`, ['p8']))] },
  { arm: 'lexical', queries: [rank('R001', ['p9']), rank('R002', ['p4']), rank('R003'),
    ...Array.from({ length: 57 }, (_, index) => rank(`R${String(index + 4).padStart(3, '0')}`)),
    ...Array.from({ length: 20 }, (_, index) => rank(`R${String(index + 61).padStart(3, '0')}`))] },
] };

function makeInputs(annotationSet, rankingSet, inventorySet = inventory) {
  const inventoryBytes = serialize(inventorySet), inventorySha256 = hash(inventoryBytes);
  annotationSet = structuredClone(annotationSet);
  annotationSet.provenance.passageInventorySha256 = inventorySha256;
  const annotationBytes = serialize(annotationSet), annotationSha256 = hash(annotationBytes);
  const boundRankings = structuredClone(rankingSet);
  boundRankings.annotationSha256 = annotationSha256;
  boundRankings.inventorySha256 = inventorySha256;
  boundRankings.preregistrationSha256 = preregistrationSha256;
  const rankingBytes = serialize(boundRankings);
  return { annotations: annotationSet, annotationBytes, inventory: inventorySet, inventoryBytes, preregistration, preregistrationBytes,
    rankings: boundRankings, rankingBytes, freezeRecord: { format: 'nodus.retrieval-annotation-freeze/1',
      annotationSha256, passageInventorySha256: inventorySha256, preregistrationSha256 } };
}
const score = (annotationSet = annotations, rankingSet = rankings) => scoreResearchPassageRetrieval(makeInputs(annotationSet, rankingSet));

const report = score();
assert.equal(report.k, 10);
const semantic = report.arms[0];
const [r001, r002, r003, r004] = semantic.perQuery;
assert.deepEqual([r001.evidenceHitAt10, r001.factCoverageAt10, r001.exhaustiveRecallAt10, r001.mrrAt10], [1, 1, 1, 1]);
assert.deepEqual([r001.language, r001.kind], ['en', 'answerable']);
assert.equal(r001.ndcgAt10, (1 + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3)));
assert.equal(r002.exhaustiveRecallAt10, 0.5);
assert.equal(r002.mrrAt10, 0.5);
assert.equal(r002.ndcgAt10, (1 / Math.log2(3)) / (1 + 1 / Math.log2(3)));
assert.equal(r003.goldStatus, 'pending');
assert.equal(r003.evidenceHitAt10, null, 'partial gold cannot silently become a complete hit judgment');
assert.equal(r003.knownSupportedEvidenceHitAt10, true);
assert.equal(r003.knownFactCoverageAt10, 0.5);
assert.equal(r003.factCoverageAt10, null, 'incomplete annotations do not claim full-gold fact coverage');
assert.equal(r003.evidenceHitAt10LowerBound, 1, 'a clear retrieved support is a valid hit lower bound despite partial gold');
assert.equal(r003.factCoverageAt10LowerBound, 0.5, 'pending facts stay in the fixed fact denominator');
assert.equal(r004.evidenceHitAt10, 0);
const summary = semantic.summary;
assert.equal(summary.answerablePlannedDenominator, 60);
assert.equal(summary.answerableCompleteGold, 59);
assert.equal(summary.answerablePendingGold, 1);
assert.deepEqual(summary.answerablePendingQueryIds, ['R003']);
assert.equal(summary.metrics.evidenceHitAt10.completeGoldMean, 2 / 59);
assert.equal(summary.metrics.evidenceHitAt10.plannedDenominatorLowerBound, 3 / 60);
assert.equal(summary.metrics.factCoverageAt10.plannedDenominatorLowerBound, 2.5 / 60);
assert.equal(summary.metrics.exhaustiveRecallAt10.completeGoldMean, 1.5 / 59);
assert.equal(summary.metrics.exhaustiveRecallAt10.plannedDenominator, 60);
assert.equal(summary.noEvidencePlannedDenominator, 20);
assert.equal(summary.metrics.falseHitAt10.verifiedCount, 0);
assert.equal(report.arms[1].arm, 'lexical', 'each retrieval mode is scored independently');

const aliasInventory = structuredClone(inventory);
const primaryP1 = aliasInventory.passages.find(passage => passage.passage_id === 'p1');
const aliasScope = `scope-${'c'.repeat(64)}`;
aliasInventory.provenance.scopeId = aliasScope;
const locatorSha = hash(Buffer.from(JSON.stringify(primaryP1.locator, Object.keys(primaryP1.locator).sort())));
aliasInventory.evidenceAliases = [{ scopeId: aliasScope, vectorPassageId: 'p1', lexicalPassageId: 'lexical-key-1:0',
  vectorEvidenceId: `documentary:${aliasScope}:${primaryP1.index_key}:0`,
  lexicalEvidenceId: `documentary:${aliasScope}:lexical-key-1:0`, sourceDocumentId: primaryP1.sourceDocumentId,
  ordinal: 0, textSha256: primaryP1.passage_text_sha256, locatorSha256: locatorSha }];
const aliasRankings = structuredClone(rankings);
aliasRankings.arms[0].queries.find(row => row.queryId === 'R001').rankedPassages = rank('R001', [aliasInventory.evidenceAliases[0].vectorEvidenceId]).rankedPassages;
aliasRankings.arms[1].queries.find(row => row.queryId === 'R001').rankedPassages = rank('R001', [aliasInventory.evidenceAliases[0].lexicalEvidenceId]).rankedPassages;
const aliasReport = scoreResearchPassageRetrieval(makeInputs(annotations, aliasRankings, aliasInventory));
assert.equal(aliasReport.arms[0].perQuery[0].evidenceHitAt10, 1);
assert.equal(aliasReport.arms[1].perQuery[0].evidenceHitAt10, 1, 'verified lexical alias scores as the same primary source evidence');
assert.equal(aliasReport.arms[0].perQuery[0].factCoverageAt10, aliasReport.arms[1].perQuery[0].factCoverageAt10);
const boundaryRankings = structuredClone(aliasRankings);
boundaryRankings.arms[0].queries.find(row => row.queryId === 'R001').rankedPassages = rank('R001',
  ['p1', aliasInventory.evidenceAliases[0].lexicalEvidenceId, 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'gold-4', 'p2']).rankedPassages;
const boundaryQuery = scoreResearchPassageRetrieval(makeInputs(annotations, boundaryRankings, aliasInventory)).arms[0].perQuery[0];
assert.equal(boundaryQuery.exhaustiveRecallAt10, 0.5, 'alias deduplication occurs after the raw top-10 cutoff; rank 11 is not promoted');
const badAliasText = structuredClone(aliasInventory);
badAliasText.evidenceAliases[0].textSha256 = 'd'.repeat(64);
assert.throws(() => scoreResearchPassageRetrieval(makeInputs(annotations, aliasRankings, badAliasText)), /does not resolve to a matching primary/u);
const foreignAliasScope = structuredClone(aliasInventory);
foreignAliasScope.evidenceAliases[0].scopeId = `scope-${'e'.repeat(64)}`;
assert.throws(() => scoreResearchPassageRetrieval(makeInputs(annotations, aliasRankings, foreignAliasScope)), /foreign scope/u);
const aliasCollision = structuredClone(aliasInventory);
aliasCollision.evidenceAliases.push(structuredClone(aliasCollision.evidenceAliases[0]));
assert.throws(() => scoreResearchPassageRetrieval(makeInputs(annotations, aliasRankings, aliasCollision)), /Ambiguous or colliding/u);

const ambiguousAnnotations = structuredClone(annotations);
ambiguousAnnotations.queries[1].requiredFacts[0].evidence.push({ ...evidence('p8'), ambiguity: 'OCR may reverse negation' });
const ambiguousRankings = structuredClone(rankings);
ambiguousRankings.arms[0].queries.find(row => row.queryId === 'R002').rankedPassages = rank('R002', ['p8']).rankedPassages;
const ambiguousQuery = score(ambiguousAnnotations, ambiguousRankings).arms[0].perQuery[1];
assert.equal(ambiguousQuery.goldStatus, 'pending', 'a polarity-ambiguous span prevents exhaustive scoring');
assert.equal(ambiguousQuery.knownSupportedEvidenceHitAt10, false, 'OCR-ambiguous passage IDs are not positive evidence');
assert.equal(ambiguousQuery.evidenceHitAt10LowerBound, 0, 'ambiguous-only retrieved support proves no hit');
assert.equal(ambiguousQuery.factCoverageAt10LowerBound, 0);
assert.deepEqual(ambiguousQuery.factHits[0].ambiguousEvidencePassageIds, ['p8']);

const verifiedAbsenceAnnotations = structuredClone(annotations);
verifiedAbsenceAnnotations.queries[60].annotationStatus = 'absence_verified';
verifiedAbsenceAnnotations.queries[60].absenceEvidence.entireCorpusAbsence = 'verified';
const emptyVerifiedRankings = structuredClone(rankings);
for (const arm of emptyVerifiedRankings.arms) arm.queries.find(row => row.queryId === 'R061').rankedPassages = [];
assert.equal(score(verifiedAbsenceAnnotations, emptyVerifiedRankings).arms[0].perQuery[60].falseHitAt10, 0);
const hitVerifiedRankings = structuredClone(emptyVerifiedRankings);
hitVerifiedRankings.arms[0].queries.find(row => row.queryId === 'R061').rankedPassages = rank('R061', ['p8']).rankedPassages;
assert.equal(score(verifiedAbsenceAnnotations, hitVerifiedRankings).arms[0].perQuery[60].falseHitAt10, 1);

const mismatchedQuote = structuredClone(annotations);
mismatchedQuote.queries[0].requiredFacts[0].evidence[0].quote = 'fabricated text';
assert.throws(() => score(mismatchedQuote), /literal text/u, 'evidence quote must occur in the bound passage text');
const mismatchedFingerprint = structuredClone(annotations);
mismatchedFingerprint.queries[0].requiredFacts[0].evidence[0].textFingerprint = 'b'.repeat(64);
assert.throws(() => score(mismatchedFingerprint), /passage identity/u);
const mismatchedLocator = structuredClone(annotations);
mismatchedLocator.queries[0].requiredFacts[0].evidence[0].locator.pageLabel = 'p. 99';
assert.throws(() => score(mismatchedLocator), /locator/u);
const missingEvidenceId = structuredClone(annotations);
missingEvidenceId.queries[0].requiredFacts[0].evidence[0].passageId = 'not-in-inventory';
assert.throws(() => score(missingEvidenceId), /absent from the bound inventory/u);
const missingRankedId = structuredClone(rankings);
missingRankedId.arms[0].queries[0] = rank('R001', ['not-in-inventory']);
assert.throws(() => score(annotations, missingRankedId), /Ranked passage is absent/u);
const queryTextMismatch = structuredClone(annotations);
queryTextMismatch.queries[0].question = 'modified question';
assert.throws(() => score(queryTextMismatch), /differs from preregistration/u);
const answerabilityMismatch = structuredClone(annotations);
answerabilityMismatch.queries[0].answerable = false;
assert.throws(() => score(answerabilityMismatch), /differs from preregistration/u);
const duplicateFactId = structuredClone(annotations);
duplicateFactId.queries[0].requiredFacts.push(structuredClone(duplicateFactId.queries[0].requiredFacts[0]));
assert.throws(() => score(duplicateFactId), /duplicate atomic fact/u);
const unknownStatus = structuredClone(annotations);
unknownStatus.queries[0].annotationStatus = 'looks-good';
assert.throws(() => score(unknownStatus), /Unknown or contradictory annotation status/u);
const contradictionStatus = structuredClone(annotations);
contradictionStatus.queries[60].annotationStatus = 'ready';
assert.throws(() => score(contradictionStatus), /Unknown or contradictory annotation status/u);
const incorrectPreregCounts = structuredClone(preregistration);
incorrectPreregCounts.counts.answerable = 59;
const badCountsInputs = makeInputs(structuredClone(annotations), structuredClone(rankings));
badCountsInputs.preregistration = incorrectPreregCounts;
badCountsInputs.preregistrationBytes = serialize(incorrectPreregCounts);
badCountsInputs.freezeRecord.preregistrationSha256 = hash(badCountsInputs.preregistrationBytes);
badCountsInputs.annotations.provenance.preregistrationSha256 = badCountsInputs.freezeRecord.preregistrationSha256;
badCountsInputs.annotationBytes = serialize(badCountsInputs.annotations);
badCountsInputs.freezeRecord.annotationSha256 = hash(badCountsInputs.annotationBytes);
badCountsInputs.rankings.annotationSha256 = badCountsInputs.freezeRecord.annotationSha256;
badCountsInputs.rankings.preregistrationSha256 = badCountsInputs.freezeRecord.preregistrationSha256;
badCountsInputs.rankingBytes = serialize(badCountsInputs.rankings);
assert.throws(() => scoreResearchPassageRetrieval(badCountsInputs), /claimed counts/u);
const wrongInventoryHash = makeInputs(annotations, rankings);
wrongInventoryHash.freezeRecord.passageInventorySha256 = 'b'.repeat(64);
assert.throws(() => scoreResearchPassageRetrieval(wrongInventoryHash), /provenance|Freeze record hashes/u);
const wrongRankHash = makeInputs(annotations, rankings);
wrongRankHash.rankings.inventorySha256 = 'b'.repeat(64);
wrongRankHash.rankingBytes = serialize(wrongRankHash.rankings);
assert.throws(() => scoreResearchPassageRetrieval(wrongRankHash), /Rankings are not hash-bound/u);
const badFreezeHash = makeInputs(annotations, rankings);
badFreezeHash.freezeRecord.annotationSha256 = 'not-a-sha256';
assert.throws(() => scoreResearchPassageRetrieval(badFreezeHash), /Freeze record hashes/u);
const documentOnly = structuredClone(rankings);
documentOnly.arms[0].queries[0].rankedPassages = [{ documentId: 'doc-only' }];
assert.throws(() => score(annotations, documentOnly), /exact passageId/u);
const missingQuery = structuredClone(rankings);
missingQuery.arms[0].queries.pop();
assert.throws(() => score(annotations, missingQuery), /missing planned query/u);
const duplicatePassage = structuredClone(rankings);
duplicatePassage.arms[0].queries[0].rankedPassages = [{ passageId: 'p1' }, { passageId: 'p1' }];
assert.throws(() => score(annotations, duplicatePassage), /Duplicate passageId/u);

console.log('PASS passage retrieval scorer: fixed-80 prereg binding, exact inventory passage/quote validation, pending-gold denominators, and exhaustive-only metrics.');
