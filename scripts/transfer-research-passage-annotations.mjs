#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANNOTATION_FORMAT = 'nodus.retrieval-passage-evidence-annotations/1';
const INVENTORY_FORMAT = 'nodus.retrieval-corpus-current-passages/1';
const PREREG_FORMAT = 'nodus.research-live-evidence-preregistration/1';
const FREEZE_FORMAT = 'nodus.retrieval-annotation-freeze/1';
const TRANSFER_FORMAT = 'nodus.retrieval-passage-annotation-transfer/1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function fail(message) { throw new Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid UTF-8 JSON`); }
}
function locatorWithoutSourceRef(locator) {
  if (!isObj(locator) || typeof locator.sourceRef !== 'string' || !locator.sourceRef) fail('Passage locator lacks sourceRef');
  const { sourceRef: _sourceRef, ...remaining } = locator;
  return remaining;
}
function sourceRefMatchesDocument(passage) {
  return typeof passage.document_id === 'string' && passage.document_id.startsWith('nodus:')
    && typeof passage.locator?.sourceRef === 'string'
    && passage.locator.sourceRef.startsWith(`library:${passage.document_id}:`);
}
function passageKey(passage) {
  return [passage.sourceSha256, passage.passage_text_sha256, passage.ordinal,
    canonical(locatorWithoutSourceRef(passage.locator))].join('\u0000');
}

function validateInventory(inventory, bytes, label, expected, { requireVerifiedFlags = true } = {}) {
  if (!isObj(inventory) || inventory.format !== INVENTORY_FORMAT || !Array.isArray(inventory.passages)) fail(`${label} has an unsupported inventory format`);
  if (!isObj(inventory.provenance) || !Number.isSafeInteger(inventory.provenance.documents)
      || inventory.provenance.documents !== expected.documents || inventory.provenance.passages !== inventory.passages.length) {
    fail(`${label} inventory provenance counts do not match its passages`);
  }
  if (inventory.passages.length !== expected.passages) fail(`${label} must contain exactly ${expected.passages} passages`);
  if (requireVerifiedFlags && (inventory.provenance.corpusDocumentBindingsVerified !== true || inventory.provenance.evidenceAliasesVerified !== true)) {
    fail(`${label} lacks verified document or evidence-alias bindings`);
  }
  if (!Array.isArray(inventory.evidenceAliases) || inventory.evidenceAliases.length !== inventory.passages.length) fail(`${label} alias rows do not cover every passage`);
  if (!isSha(inventory.provenance.databaseSha256) || !isSha(inventory.provenance.metadataAuditReceiptSha256)
      || !isSha(inventory.provenance.sourceSnapshotSha256) || !isSha(inventory.provenance.reportSha256)
      || !isSha(inventory.provenance.preregistrationSha256) || !isSha(inventory.provenance.originalCorpusManifestSha256)) {
    fail(`${label} provenance is missing required audit hashes`);
  }
  if (typeof inventory.provenance.scopeId !== 'string' || !inventory.provenance.scopeId) fail(`${label} lacks an authorized scope ID`);
  const byId = new Map();
  const bySource = new Map();
  for (const passage of inventory.passages) {
    if (!isObj(passage) || typeof passage.passage_id !== 'string' || byId.has(passage.passage_id)
        || !Number.isSafeInteger(passage.ordinal) || passage.ordinal < 0 || typeof passage.text !== 'string'
        || !isSha(passage.sourceSha256) || !isSha(passage.passage_text_sha256)
        || !isSha(passage.text_fingerprint) || sha(Buffer.from(passage.text, 'utf8')) !== passage.passage_text_sha256
        || !sourceRefMatchesDocument(passage)) fail(`${label} has malformed passage or source identity`);
    const expectedPassageId = `${passage.index_key}:${passage.ordinal}`;
    if (passage.passage_id !== expectedPassageId) fail(`${label} passage ID does not match index key and ordinal`);
    byId.set(passage.passage_id, passage);
    const source = bySource.get(passage.sourceSha256) ?? { sourceDocumentIds: new Set(), documentIds: new Set(), count: 0 };
    source.sourceDocumentIds.add(passage.sourceDocumentId);
    source.documentIds.add(passage.document_id);
    source.count += 1;
    bySource.set(passage.sourceSha256, source);
  }
  for (const [sourceSha256, source] of bySource) {
    if (source.sourceDocumentIds.size !== 1 || source.documentIds.size !== 1) fail(`${label} source SHA maps to multiple document identities: ${sourceSha256}`);
  }
  if (bySource.size !== expected.documents) fail(`${label} must bind exactly ${expected.documents} unique source documents`);
  validateAliases(inventory, byId, label);
  return { byId, bySource };
}

function validateAliases(inventory, byId, label) {
  const seenPrimary = new Set();
  const seenAlias = new Set();
  for (const alias of inventory.evidenceAliases) {
    if (!isObj(alias) || alias.scopeId !== inventory.provenance.scopeId || !Number.isSafeInteger(alias.ordinal)) fail(`${label} has a malformed or foreign-scope alias`);
    const passage = byId.get(alias.vectorPassageId);
    if (!passage || passage.ordinal !== alias.ordinal || passage.sourceDocumentId !== alias.sourceDocumentId
        || passage.passage_text_sha256 !== alias.textSha256
        || sha(Buffer.from(canonical(passage.locator), 'utf8')) !== alias.locatorSha256) fail(`${label} alias does not bind its primary passage`);
    if (alias.vectorEvidenceId !== `documentary:${alias.scopeId}:${passage.index_key}:${alias.ordinal}`) fail(`${label} vector alias identity mismatch`);
    const prefix = `documentary:${alias.scopeId}:`;
    const suffix = `:${alias.ordinal}`;
    if (typeof alias.lexicalEvidenceId !== 'string' || !alias.lexicalEvidenceId.startsWith(prefix) || !alias.lexicalEvidenceId.endsWith(suffix)) fail(`${label} malformed lexical alias`);
    const lexicalKey = alias.lexicalEvidenceId.slice(prefix.length, -suffix.length);
    if (!lexicalKey || lexicalKey === passage.index_key || alias.lexicalPassageId !== `${lexicalKey}:${alias.ordinal}`) fail(`${label} lexical alias is not a distinct authorized index identity`);
    for (const key of [alias.vectorEvidenceId, alias.lexicalEvidenceId]) {
      if (seenAlias.has(key)) fail(`${label} contains a duplicate evidence alias`);
      seenAlias.add(key);
    }
    if (seenPrimary.has(passage.passage_id)) fail(`${label} contains multiple aliases for one primary passage`);
    seenPrimary.add(passage.passage_id);
  }
  if (seenPrimary.size !== byId.size) fail(`${label} aliases do not form a primary-passage bijection`);
}

function validatePrereg(annotations, sourcePrereg, destPrereg, expectedQueries) {
  for (const [label, prereg] of [['Source', sourcePrereg], ['Destination', destPrereg]]) {
    if (!isObj(prereg) || prereg.format !== PREREG_FORMAT || !Array.isArray(prereg.queries) || prereg.queries.length !== expectedQueries) fail(`${label} preregistration is not the fixed query set`);
  }
  if (!isObj(annotations) || annotations.format !== ANNOTATION_FORMAT || !Array.isArray(annotations.queries)
      || annotations.queries.length !== expectedQueries) fail('Source annotations are not the fixed annotation set');
  const index = (rows, idKey) => {
    const map = new Map();
    for (const row of rows) {
      const id = row[idKey];
      if (typeof id !== 'string' || map.has(id)) fail(`Duplicate or missing query ID in ${idKey} set`);
      map.set(id, row);
    }
    return map;
  };
  const source = index(sourcePrereg.queries, 'id');
  const dest = index(destPrereg.queries, 'id');
  const ann = index(annotations.queries, 'queryId');
  if (source.size !== dest.size || source.size !== ann.size) fail('Query ID sets differ across preregistration and annotations');
  for (const [id, sourceRow] of source) {
    const next = dest.get(id), annotation = ann.get(id);
    if (!next || !annotation || sourceRow.question !== next.question || sourceRow.isAnswerable !== next.isAnswerable
        || annotation.question !== sourceRow.question || annotation.answerable !== sourceRow.isAnswerable) {
      fail(`Question text or answerability changed for ${id}`);
    }
  }
}

function validateFreeze(sourceAnnotationBytes, sourceInventoryBytes, sourcePreregBytes, freeze) {
  if (!isObj(freeze) || freeze.format !== FREEZE_FORMAT) fail('Source detached freeze record has the wrong format');
  const annotationSha256 = sha(sourceAnnotationBytes), passageInventorySha256 = sha(sourceInventoryBytes), preregistrationSha256 = sha(sourcePreregBytes);
  if (freeze.annotationSha256 !== annotationSha256 || freeze.reviewApprovalSha256 !== annotationSha256
      || freeze.passageInventorySha256 !== passageInventorySha256 || freeze.preregistrationSha256 !== preregistrationSha256
      || freeze.reviewState !== 'independently_approved_and_frozen') fail('Source detached approval/freeze does not bind the exact source inputs');
  return { annotationSha256, passageInventorySha256, preregistrationSha256 };
}

export function transferResearchPassageAnnotations({ annotations, freeze, sourceInventory, sourcePreregistration,
  destinationInventory, destinationPreregistration, sourceAnnotationBytes, sourceFreezeBytes,
  sourceInventoryBytes, sourcePreregistrationBytes, destinationInventoryBytes, destinationPreregistrationBytes,
  destinationExtractionPipeline, expected = { queries: 80, documents: 40, passages: 787 }, requireVerifiedFlags = true }) {
  for (const [label, value, bytes] of [
    ['Source annotations', annotations, sourceAnnotationBytes], ['Source freeze', freeze, sourceFreezeBytes],
    ['Source inventory', sourceInventory, sourceInventoryBytes], ['Source preregistration', sourcePreregistration, sourcePreregistrationBytes],
    ['Destination inventory', destinationInventory, destinationInventoryBytes], ['Destination preregistration', destinationPreregistration, destinationPreregistrationBytes],
  ]) {
    if (!Buffer.isBuffer(bytes) || canonical(parseJson(bytes, label)) !== canonical(value)) fail(`${label} object differs from its bound input bytes`);
  }
  const sourceHashes = validateFreeze(sourceAnnotationBytes, sourceInventoryBytes, sourcePreregistrationBytes, freeze);
  const sourceInventoryHash = sha(sourceInventoryBytes), destinationInventoryHash = sha(destinationInventoryBytes);
  const sourcePreregHash = sha(sourcePreregistrationBytes), destinationPreregHash = sha(destinationPreregistrationBytes);
  const sourceAnnotationHash = sha(sourceAnnotationBytes), sourceFreezeHash = sha(sourceFreezeBytes);
  if (annotations.provenance?.passageInventorySha256 !== sourceInventoryHash
      || annotations.provenance?.preregistrationSha256 !== sourcePreregHash) fail('Source annotation provenance does not bind source inventory/preregistration bytes');
  const source = validateInventory(sourceInventory, sourceInventoryBytes, 'Source', expected, { requireVerifiedFlags });
  const dest = validateInventory(destinationInventory, destinationInventoryBytes, 'Destination', expected, { requireVerifiedFlags });
  if (sourceInventory.provenance.preregistrationSha256 !== sourcePreregHash
      || destinationInventory.provenance.preregistrationSha256 !== destinationPreregHash) fail('Inventory provenance does not bind the supplied preregistration');
  if (annotations.provenance.extractionPipeline !== 'nodus-clean-markdown/12'
      || destinationExtractionPipeline !== annotations.provenance.extractionPipeline) fail('Automatic transfer requires root-confirmed nodus-clean-markdown/12 extraction on both inventories');
  validatePrereg(annotations, sourcePreregistration, destinationPreregistration, expected.queries);
  const sourceKeys = new Map();
  for (const passage of destinationInventory.passages) {
    const key = passageKey(passage), rows = sourceKeys.get(key) ?? [];
    rows.push(passage);
    sourceKeys.set(key, rows);
  }
  const crosswalk = [];
  const exceptions = [];
  const crosswalkBySourceId = new Map();
  const sourceByTargetId = new Map();
  for (const oldPassage of sourceInventory.passages) {
    const candidates = sourceKeys.get(passageKey(oldPassage)) ?? [];
    if (candidates.length !== 1) {
      exceptions.push({ sourcePassageId: oldPassage.passage_id, reason: candidates.length === 0 ? 'no_exact_identity_match' : 'ambiguous_destination_identity' });
      continue;
    }
    const next = candidates[0];
    if (sourceByTargetId.has(next.passage_id)) {
      exceptions.push({ sourcePassageId: oldPassage.passage_id, destinationPassageId: next.passage_id, reason: 'destination_identity_reused' });
      continue;
    }
    const row = { sourcePassageId: oldPassage.passage_id, destinationPassageId: next.passage_id,
      sourceSha256: oldPassage.sourceSha256, passageTextSha256: oldPassage.passage_text_sha256,
      ordinal: oldPassage.ordinal, sourceDocumentId: oldPassage.sourceDocumentId,
      destinationDocumentId: next.sourceDocumentId, sourceDocumentLibraryId: oldPassage.document_id,
      destinationDocumentLibraryId: next.document_id, sourceLocator: oldPassage.locator,
      destinationLocator: next.locator };
    crosswalk.push(row);
    crosswalkBySourceId.set(oldPassage.passage_id, { passage: next, row });
    sourceByTargetId.set(next.passage_id, oldPassage.passage_id);
  }

  const transferable = structuredClone(annotations);
  const queryReady = new Map();
  for (const query of transferable.queries) {
    let ready = true;
    for (const fact of query.requiredFacts) {
      let factReady = true;
      const transferredEvidence = [];
      for (const evidence of fact.evidence) {
        const oldPassage = source.byId.get(evidence.passageId);
        if (!oldPassage || evidence.documentId !== oldPassage.sourceDocumentId
            || evidence.documentSha256 !== oldPassage.sourceSha256 || evidence.textFingerprint !== oldPassage.text_fingerprint
            || canonical(evidence.locator) !== canonical(oldPassage.locator)
            || typeof evidence.quote !== 'string' || !evidence.quote || !oldPassage.text.includes(evidence.quote)) {
          factReady = false;
          exceptions.push({ queryId: query.queryId, factId: fact.id, sourcePassageId: evidence.passageId, reason: 'source_evidence_does_not_bind_source_inventory' });
          continue;
        }
        const mapped = crosswalkBySourceId.get(oldPassage.passage_id);
        if (!mapped?.passage) {
          factReady = false;
          exceptions.push({ queryId: query.queryId, factId: fact.id, sourcePassageId: evidence.passageId, reason: 'source_passage_not_in_exact_bijection' });
          continue;
        }
        if (!mapped.passage.text.includes(evidence.quote)) {
          factReady = false;
          exceptions.push({ queryId: query.queryId, factId: fact.id, sourcePassageId: evidence.passageId, destinationPassageId: mapped.passage.passage_id, reason: 'literal_quote_missing_from_destination_text' });
          continue;
        }
        transferredEvidence.push({ ...evidence, passageId: mapped.passage.passage_id,
          documentId: mapped.passage.sourceDocumentId, documentSha256: mapped.passage.sourceSha256,
          textFingerprint: mapped.passage.text_fingerprint, locator: mapped.passage.locator });
      }
      fact.evidence = transferredEvidence;
      fact.transferStatus = factReady ? 'ready' : 'pending';
      if (!factReady) ready = false;
    }
    query.transferStatus = ready ? 'ready' : 'pending';
    queryReady.set(query.queryId, ready);
  }
  const inventoryBijection = sourceInventory.passages.length === destinationInventory.passages.length
    && source.bySource.size === dest.bySource.size && source.byId.size === crosswalkBySourceId.size
    && sourceByTargetId.size === dest.byId.size
    && [...source.bySource.keys()].every(key => dest.bySource.has(key))
    && crosswalk.length === sourceInventory.passages.length;
  if (!inventoryBijection) exceptions.push({ reason: 'full_inventory_bijection_failed', sourcePassageCount: source.byId.size,
    destinationPassageCount: dest.byId.size, uniquelyMappedPassageCount: crosswalk.length,
    sourceDocumentCount: source.bySource.size, destinationDocumentCount: dest.bySource.size });
  for (const query of transferable.queries) {
    if (!inventoryBijection) {
      query.transferStatus = 'pending';
      for (const fact of query.requiredFacts) if (fact.exhaustiveCorpusScan === true) fact.transferStatus = 'pending';
    }
    if (!query.answerable && !inventoryBijection) query.absenceEvidence.transferStatus = 'pending';
  }
  const ready = inventoryBijection && exceptions.length === 0 && [...queryReady.values()].every(Boolean);
  transferable.annotationVersion = `${annotations.annotationVersion}-transfer-1`;
  transferable.reviewState = 'identity_transfer_pending_independent_review';
  transferable.transferReadiness = ready ? 'ready_pending_independent_approval' : 'pending';
  transferable.transferProvenance = {
    format: TRANSFER_FORMAT,
    sourceAnnotationSha256: sourceHashes.annotationSha256,
    sourceFreezeSha256: sourceFreezeHash,
    sourceInventorySha256: sourceHashes.passageInventorySha256,
    sourcePreregistrationSha256: sourceHashes.preregistrationSha256,
    destinationInventorySha256: destinationInventoryHash,
    destinationPreregistrationSha256: destinationPreregHash,
    destinationScopeId: destinationInventory.provenance.scopeId,
    destinationExtractionPipeline,
    extractionPipelineAttestation: 'Destination pipeline version was supplied by the campaign owner because the rank-free inventory format does not include an extractionPipeline field.',
    inventoryBijection,
    mappingMethod: 'sourceSha256 + exact passage_text_sha256 + ordinal + canonical locator excluding only sourceRef; destination sourceRef validated against destination document_id',
    reviewStateAtSource: annotations.reviewState ?? null,
    legacyProvenanceReviewAtSource: annotations.provenance?.independentReview ?? null,
    detachedApprovalStateAtSource: freeze.reviewState,
    answerableCount: annotations.queries.filter(query => query.answerable).length,
    insufficientCount: annotations.queries.filter(query => !query.answerable).length,
    factCount: annotations.queries.reduce((sum, query) => sum + query.requiredFacts.length, 0),
    sourceEvidenceCount: annotations.queries.reduce((sum, query) => sum + query.requiredFacts.reduce((n, fact) => n + fact.evidence.length, 0), 0),
    mappedPassageCount: crosswalk.length,
    mappedEvidenceCount: transferable.queries.reduce((sum, query) => sum + query.requiredFacts.reduce((n, fact) => n + fact.evidence.length, 0), 0),
    pendingQueryIds: transferable.queries.filter(query => query.transferStatus !== 'ready').map(query => query.queryId),
  };
  transferable.provenance = { ...transferable.provenance,
    passageInventorySha256: destinationInventoryHash,
    preregistrationSha256: destinationPreregHash,
    inventoryPath: 'current-passages-001.json',
    preregistrationPath: 'preregistration.json',
    corpusPassageCount: destinationInventory.passages.length,
    annotationMethod: `Deterministic source-identity transfer from approved annotation SHA-256 ${sourceAnnotationHash}; claims and labels preserved, passage citations rebound by verified full-source identity.`,
    independentReview: 'transfer identity review pending' };
  const mappingBytes = Buffer.from(canonical(crosswalk), 'utf8');
  const receipt = {
    format: TRANSFER_FORMAT,
    transferReadiness: transferable.transferReadiness,
    annotationPath: null,
    annotationSha256: null,
    sourceAnnotationPath: null,
    sourceAnnotationSha256: sourceAnnotationHash,
    sourceFreezeSha256: sourceFreezeHash,
    sourceInventorySha256: sourceInventoryHash,
    sourcePreregistrationSha256: sourcePreregHash,
    destinationInventorySha256: destinationInventoryHash,
    destinationPreregistrationSha256: destinationPreregHash,
    crosswalkSha256: sha(mappingBytes),
    inventoryBijection,
    counts: { sourcePassages: source.byId.size, destinationPassages: dest.byId.size,
      mappedPassages: crosswalk.length, sourceDocuments: source.bySource.size, destinationDocuments: dest.bySource.size,
      mappedEvidence: transferable.transferProvenance.mappedEvidenceCount,
      originalEvidence: transferable.transferProvenance.sourceEvidenceCount,
      pendingQueries: transferable.transferProvenance.pendingQueryIds.length,
      sourceQueries: annotations.queries.length, sourceFacts: transferable.transferProvenance.factCount },
    staleEmbeddedReviewState: { reviewState: annotations.reviewState ?? null,
      provenanceIndependentReview: annotations.provenance?.independentReview ?? null,
      detachedFreezeState: freeze.reviewState },
    exceptions,
    crosswalk,
  };
  return { annotations: transferable, receipt, ready };
}

function argsFrom(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--') || !arg.includes('=')) fail(`Invalid argument: ${arg}`);
    const split = arg.indexOf('=');
    options[arg.slice(2, split)] = arg.slice(split + 1);
  }
  return options;
}
function readFile(file, label) { if (!file) fail(`Missing path for ${label}`); return fs.readFileSync(file); }
function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
}
function usage() {
  return `Usage:\n  node scripts/transfer-research-passage-annotations.mjs --source-annotations=FILE --source-freeze=FILE --source-inventory=FILE --source-preregistration=FILE --destination-inventory=FILE --destination-preregistration=FILE --destination-extraction-pipeline=nodus-clean-markdown/12 --output=NEW_FILE --receipt=NEW_FILE\n\nTransfers existing labels only by exact source SHA-256, passage-text SHA-256, ordinal, and locator identity. It never reads rankings or answers. A detached destination freeze must be created only after independent approval of the exact output SHA.`;
}
function main() {
  const opts = argsFrom(process.argv.slice(2));
  if ('help' in opts) { process.stdout.write(usage() + '\n'); return; }
  const sourceAnnotationBytes = readFile(opts['source-annotations'], 'source annotations');
  const sourceFreezeBytes = readFile(opts['source-freeze'], 'source freeze');
  const sourceInventoryBytes = readFile(opts['source-inventory'], 'source inventory');
  const sourcePreregistrationBytes = readFile(opts['source-preregistration'], 'source preregistration');
  const destinationInventoryBytes = readFile(opts['destination-inventory'], 'destination inventory');
  const destinationPreregistrationBytes = readFile(opts['destination-preregistration'], 'destination preregistration');
  const result = transferResearchPassageAnnotations({ annotations: parseJson(sourceAnnotationBytes, 'Source annotations'),
    freeze: parseJson(sourceFreezeBytes, 'Source freeze'), sourceInventory: parseJson(sourceInventoryBytes, 'Source inventory'),
    sourcePreregistration: parseJson(sourcePreregistrationBytes, 'Source preregistration'),
    destinationInventory: parseJson(destinationInventoryBytes, 'Destination inventory'),
    destinationPreregistration: parseJson(destinationPreregistrationBytes, 'Destination preregistration'),
    sourceAnnotationBytes, sourceFreezeBytes, sourceInventoryBytes, sourcePreregistrationBytes,
    destinationInventoryBytes, destinationPreregistrationBytes,
    destinationExtractionPipeline: opts['destination-extraction-pipeline'] });
  const output = opts.output, receiptPath = opts.receipt;
  if (!output || !receiptPath || path.resolve(output) === path.resolve(receiptPath)) fail('Use distinct new --output and --receipt paths');
  result.receipt.annotationPath = path.basename(output);
  result.receipt.sourceAnnotationPath = path.basename(opts['source-annotations']);
  const annotationBytes = Buffer.from(JSON.stringify(result.annotations, null, 2) + '\n', 'utf8');
  result.receipt.annotationSha256 = sha(annotationBytes);
  const receiptBytes = Buffer.from(JSON.stringify(result.receipt, null, 2) + '\n', 'utf8');
  writeExclusive(output, annotationBytes);
  writeExclusive(receiptPath, receiptBytes);
  process.stdout.write(JSON.stringify({ status: result.ready ? 'ready_pending_independent_approval' : 'pending',
    output, outputSha256: sha(annotationBytes), receipt: receiptPath, receiptSha256: sha(receiptBytes),
    inventoryBijection: result.receipt.inventoryBijection, counts: result.receipt.counts,
    exceptions: result.receipt.exceptions.length }, null, 2) + '\n');
}

const ownPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n${usage()}\n`); process.exitCode = 1; }
}
