#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transferResearchPassageAnnotations } from './transfer-research-passage-annotations.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
const jsonBytes = value => Buffer.from(JSON.stringify(value), 'utf8');
const sha = value => hash(Buffer.from(value, 'utf8'));
const hex = n => String(n).repeat(64);

function inventory(scope, docId, indexKey, lexicalKey, sourceRef, passagesText) {
  const passages = passagesText.map((text, ordinal) => {
    const locator = { pageLabel: `p. ${ordinal + 1}`, sourceRef, pageNumber: ordinal + 1 };
    return { document_id: docId, index_key: indexKey, passage_id: `${indexKey}:${ordinal}`, ordinal, text,
      passage_text_sha256: sha(text), coverage: 'fulltext', text_fingerprint: hex(ordinal + 1),
      sourceDocumentId: 'fixture-01', sourceTitle: 'Synthetic paper', indexedTitle: 'fixture',
      sourceLanguage: 'en', sourceFormat: 'pdf', sourceSha256: hex(8), locator };
  });
  const aliases = passages.map(p => ({ scopeId: scope, vectorPassageId: p.passage_id,
    lexicalPassageId: `${lexicalKey}:${p.ordinal}`,
    vectorEvidenceId: `documentary:${scope}:${indexKey}:${p.ordinal}`,
    lexicalEvidenceId: `documentary:${scope}:${lexicalKey}:${p.ordinal}`,
    sourceDocumentId: p.sourceDocumentId, ordinal: p.ordinal, textSha256: p.passage_text_sha256,
    locatorSha256: sha(canonical(p.locator)) }));
  return { format: 'nodus.retrieval-corpus-current-passages/1', provenance: {
    documents: 1, passages: passages.length, corpusDocumentBindingsVerified: true, evidenceAliasesVerified: true,
    scopeId: scope, databaseSha256: hex(1), metadataAuditReceiptSha256: hex(2), sourceSnapshotSha256: hex(3),
    reportSha256: hex(4), preregistrationSha256: hex(5), originalCorpusManifestSha256: hex(6), extractionPipeline: 'nodus-clean-markdown/12' },
    evidenceAliases: aliases, passages };
}
function makeInput() {
  const sourceInventory = inventory('scope-source', 'nodus:11111111-1111-4111-8111-111111111111', 'a'.repeat(64), 'b'.repeat(64),
    'library:nodus:11111111-1111-4111-8111-111111111111:local:11111111-1111-4111-8111-111111111111',
    ['An exact sentence with the target claim.', 'A separate passage.']);
  const destinationInventory = inventory('scope-destination', 'nodus:22222222-2222-4222-8222-222222222222', 'c'.repeat(64), 'd'.repeat(64),
    'library:nodus:22222222-2222-4222-8222-222222222222:local:22222222-2222-4222-8222-222222222222',
    ['An exact sentence with the target claim.', 'A separate passage.']);
  const sourcePreregistration = { format: 'nodus.research-live-evidence-preregistration/1', queries: [
    { id: 'R001', question: 'What is the target claim?', isAnswerable: true },
    { id: 'R002', question: 'What is not in evidence?', isAnswerable: false }] };
  const destinationPreregistration = structuredClone(sourcePreregistration);
  const annotations = { format: 'nodus.retrieval-passage-evidence-annotations/1', annotationVersion: 'test-v1',
    reviewState: 'primary_draft_pending_independent_review', provenance: {
      passageInventorySha256: '', preregistrationSha256: '', independentReview: 'pending', corpusPassageCount: 2,
      annotationMethod: 'synthetic test fixture', extractionPipeline: 'nodus-clean-markdown/12' },
    queries: [{ queryId: 'R001', question: 'What is the target claim?', answerable: true, annotationStatus: 'ready',
      requiredFacts: [{ id: 'claim', claim: 'The target claim is stated.', status: 'supported', exhaustiveCorpusScan: true,
        evidence: [{ passageId: sourceInventory.passages[0].passage_id, documentId: sourceInventory.passages[0].sourceDocumentId,
          documentSha256: sourceInventory.passages[0].sourceSha256, textFingerprint: sourceInventory.passages[0].text_fingerprint,
          locator: sourceInventory.passages[0].locator, quote: 'exact sentence with the target claim' }] }],
      answerRequirements: [{ id: 'derive', requirement: 'Do not add unsupported content.' }] },
    { queryId: 'R002', question: 'What is not in evidence?', answerable: false, annotationStatus: 'absence_verified',
      requiredFacts: [], absenceEvidence: { entireCorpusAbsence: 'verified', independentReview: { status: 'verified' } } }] };
  const sourcePreregistrationBytes = jsonBytes(sourcePreregistration);
  sourceInventory.provenance.preregistrationSha256 = hash(sourcePreregistrationBytes);
  destinationInventory.provenance.preregistrationSha256 = hash(jsonBytes(destinationPreregistration));
  const sourceInventoryBytes = jsonBytes(sourceInventory);
  const sourceAnnotationBytes = jsonBytes(annotations);
  annotations.provenance.passageInventorySha256 = hash(sourceInventoryBytes);
  annotations.provenance.preregistrationSha256 = hash(sourcePreregistrationBytes);
  const boundAnnotationBytes = jsonBytes(annotations);
  const sourceFreeze = { format: 'nodus.retrieval-annotation-freeze/1', reviewState: 'independently_approved_and_frozen',
    annotationSha256: hash(boundAnnotationBytes), reviewApprovalSha256: hash(boundAnnotationBytes),
    passageInventorySha256: hash(sourceInventoryBytes), preregistrationSha256: hash(sourcePreregistrationBytes) };
  const sourceFreezeBytes = jsonBytes(sourceFreeze);
  return { annotations, freeze: sourceFreeze, sourceInventory, sourcePreregistration, destinationInventory,
    destinationPreregistration, sourceAnnotationBytes: boundAnnotationBytes, sourceFreezeBytes, sourceInventoryBytes,
    sourcePreregistrationBytes, destinationInventoryBytes: jsonBytes(destinationInventory),
    destinationPreregistrationBytes: jsonBytes(destinationPreregistration), expected: { queries: 2, documents: 1, passages: 2 } };
}
function transfer(input) { return transferResearchPassageAnnotations({ ...input, destinationExtractionPipeline: 'nodus-clean-markdown/12' }); }

const good = transfer(makeInput());
assert.equal(good.ready, true);
assert.equal(good.receipt.inventoryBijection, true);
assert.deepEqual(good.receipt.counts, { sourcePassages: 2, destinationPassages: 2, mappedPassages: 2,
  sourceDocuments: 1, destinationDocuments: 1, mappedEvidence: 1, originalEvidence: 1,
  pendingQueries: 0, sourceQueries: 2, sourceFacts: 1 });
assert.equal(good.annotations.queries[0].requiredFacts[0].evidence[0].passageId, good.receipt.crosswalk[0].destinationPassageId);
assert.equal(good.annotations.queries[0].requiredFacts[0].evidence[0].quote, 'exact sentence with the target claim');
assert.equal(good.annotations.queries[0].requiredFacts[0].status, 'supported');
assert.deepEqual(good.annotations.queries[0].answerRequirements, [{ id: 'derive', requirement: 'Do not add unsupported content.' }]);
assert.equal(good.annotations.queries[1].annotationStatus, 'absence_verified');
assert.equal(good.annotations.transferProvenance.legacyProvenanceReviewAtSource, 'pending');
assert.equal(good.annotations.transferProvenance.detachedApprovalStateAtSource, 'independently_approved_and_frozen');

const textChanged = makeInput();
textChanged.destinationInventory.passages[0].text += ' Altered.';
textChanged.destinationInventory.passages[0].passage_text_sha256 = sha(textChanged.destinationInventory.passages[0].text);
textChanged.destinationInventory.evidenceAliases[0].textSha256 = textChanged.destinationInventory.passages[0].passage_text_sha256;
textChanged.destinationInventoryBytes = jsonBytes(textChanged.destinationInventory);
const changedResult = transfer(textChanged);
assert.equal(changedResult.ready, false);
assert.equal(changedResult.annotations.queries[0].transferStatus, 'pending');
assert.equal(changedResult.annotations.queries[1].transferStatus, 'pending');
assert(changedResult.receipt.exceptions.some(row => row.reason === 'no_exact_identity_match'));

const sourceChanged = makeInput();
for (const passage of sourceChanged.destinationInventory.passages) passage.sourceSha256 = hex(9);
sourceChanged.destinationInventoryBytes = jsonBytes(sourceChanged.destinationInventory);
const sourceChangedResult = transfer(sourceChanged);
assert.equal(sourceChangedResult.ready, false);
assert(sourceChangedResult.receipt.exceptions.some(row => row.reason === 'no_exact_identity_match'));

const ordinalChanged = makeInput();
ordinalChanged.destinationInventory.passages[0].ordinal = 4;
ordinalChanged.destinationInventory.passages[0].passage_id = `${ordinalChanged.destinationInventory.passages[0].index_key}:4`;
ordinalChanged.destinationInventory.evidenceAliases[0].ordinal = 4;
ordinalChanged.destinationInventory.evidenceAliases[0].vectorPassageId = ordinalChanged.destinationInventory.passages[0].passage_id;
ordinalChanged.destinationInventory.evidenceAliases[0].vectorEvidenceId = `documentary:scope-destination:${ordinalChanged.destinationInventory.passages[0].index_key}:4`;
ordinalChanged.destinationInventory.evidenceAliases[0].lexicalPassageId = `d${'d'.repeat(63)}:4`;
ordinalChanged.destinationInventory.evidenceAliases[0].lexicalEvidenceId = `documentary:scope-destination:d${'d'.repeat(63)}:4`;
ordinalChanged.destinationInventoryBytes = jsonBytes(ordinalChanged.destinationInventory);
assert.equal(transfer(ordinalChanged).ready, false);

const locatorChanged = makeInput();
locatorChanged.destinationInventory.passages[0].locator.pageNumber = 99;
locatorChanged.destinationInventory.evidenceAliases[0].locatorSha256 = sha(canonical(locatorChanged.destinationInventory.passages[0].locator));
locatorChanged.destinationInventoryBytes = jsonBytes(locatorChanged.destinationInventory);
assert.equal(transfer(locatorChanged).ready, false);

const ambiguousIdentity = makeInput();
const duplicate = structuredClone(ambiguousIdentity.destinationInventory.passages[0]);
duplicate.index_key = 'e'.repeat(64);
duplicate.passage_id = `${duplicate.index_key}:${duplicate.ordinal}`;
ambiguousIdentity.destinationInventory.passages[1] = duplicate;
const duplicateAlias = { ...structuredClone(ambiguousIdentity.destinationInventory.evidenceAliases[0]),
  lexicalPassageId: `f${'f'.repeat(63)}:${duplicate.ordinal}`,
  vectorPassageId: duplicate.passage_id,
  vectorEvidenceId: `documentary:scope-destination:${duplicate.index_key}:${duplicate.ordinal}`,
  lexicalEvidenceId: `documentary:scope-destination:f${'f'.repeat(63)}:${duplicate.ordinal}` };
ambiguousIdentity.destinationInventory.evidenceAliases[1] = duplicateAlias;
ambiguousIdentity.destinationInventoryBytes = jsonBytes(ambiguousIdentity.destinationInventory);
const ambiguousResult = transfer(ambiguousIdentity);
assert.equal(ambiguousResult.ready, false);
assert(ambiguousResult.receipt.exceptions.some(row => row.reason === 'ambiguous_destination_identity'));

const wrongRef = makeInput();
wrongRef.destinationInventory.passages[0].locator.sourceRef = 'library:nodus:foreign:local:foreign';
wrongRef.destinationInventory.evidenceAliases[0].locatorSha256 = sha(canonical(wrongRef.destinationInventory.passages[0].locator));
wrongRef.destinationInventoryBytes = jsonBytes(wrongRef.destinationInventory);
assert.throws(() => transfer(wrongRef), /source identity/);

const wrongQuestion = makeInput();
wrongQuestion.destinationPreregistration.queries[0].question += ' changed';
wrongQuestion.destinationPreregistrationBytes = jsonBytes(wrongQuestion.destinationPreregistration);
wrongQuestion.destinationInventory.provenance.preregistrationSha256 = hash(wrongQuestion.destinationPreregistrationBytes);
wrongQuestion.destinationInventoryBytes = jsonBytes(wrongQuestion.destinationInventory);
assert.throws(() => transfer(wrongQuestion), /Question text or answerability changed/);

const brokenFreeze = makeInput();
brokenFreeze.freeze.annotationSha256 = hex(7);
brokenFreeze.sourceFreezeBytes = jsonBytes(brokenFreeze.freeze);
assert.throws(() => transfer(brokenFreeze), /does not bind the exact source inputs/);

const damagedQuote = makeInput();
damagedQuote.annotations.queries[0].requiredFacts[0].evidence[0].quote = 'not a literal quote';
damagedQuote.sourceAnnotationBytes = jsonBytes(damagedQuote.annotations);
damagedQuote.annotations.provenance.passageInventorySha256 = hash(damagedQuote.sourceInventoryBytes);
damagedQuote.annotations.provenance.preregistrationSha256 = hash(damagedQuote.sourcePreregistrationBytes);
damagedQuote.sourceAnnotationBytes = jsonBytes(damagedQuote.annotations);
damagedQuote.freeze.annotationSha256 = hash(damagedQuote.sourceAnnotationBytes);
damagedQuote.freeze.reviewApprovalSha256 = damagedQuote.freeze.annotationSha256;
damagedQuote.sourceFreezeBytes = jsonBytes(damagedQuote.freeze);
const quoteResult = transfer(damagedQuote);
assert.equal(quoteResult.ready, false);
assert(quoteResult.receipt.exceptions.some(row => row.reason === 'source_evidence_does_not_bind_source_inventory'));

process.stdout.write('PASS deterministic passage annotation transfer: exact identity, quote, locator, alias, preregistration, freeze, and pending-on-mismatch boundaries.\n');
