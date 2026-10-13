import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const INDEX_AUTHORIZATION_FORMAT = 'nodus.research-index-authorization/1';
export const SEMANTIC_IDENTITY_RECEIPT_FORMAT = 'nodus.readonly-semantic-identity-pairs/1';

export function canonicalizeResearchIdentity(value) {
  if (Array.isArray(value)) return value.map(canonicalizeResearchIdentity);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalizeResearchIdentity(item)]));
  return value;
}

export const canonicalResearchJson = value => JSON.stringify(canonicalizeResearchIdentity(value));
export const canonicalResearchSha256 = value => createHash('sha256').update(canonicalResearchJson(value)).digest('hex');
export const researchIdentityFingerprint = canonicalResearchSha256;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const equalCanonical = (left, right) => canonicalResearchJson(left) === canonicalResearchJson(right);
const readJsonBound = (file, expectedHash) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe evidence file: ${file}`);
  const bytes = fs.readFileSync(file);
  if (expectedHash && sha256(bytes) !== expectedHash) throw new Error(`Evidence SHA-256 mismatch: ${file}`);
  return JSON.parse(bytes.toString('utf8'));
};

function assert(condition, message) { if (!condition) throw new Error(message); }

export function validateIndexAuthorization({ sourceSnapshot, receipt, expectedSourceSha256, expectedReportSha256 }) {
  assert(receipt?.format === SEMANTIC_IDENTITY_RECEIPT_FORMAT, 'Missing or unsupported semantic identity receipt');
  const evidence = receipt.evidence;
  assert(evidence?.sqliteOpenedReadonly === true && evidence?.queriedColumnsExcludeTextAndVectorBytes === true,
    'Receipt does not prove read-only metadata-only database inspection');
  if (expectedSourceSha256) assert(evidence.sourceSnapshotSha256 === expectedSourceSha256, 'Receipt source snapshot binding mismatch');
  if (expectedReportSha256) assert(evidence.reportSha256 === expectedReportSha256, 'Receipt report binding mismatch');
  assert(sourceSnapshot?.format === 'nodus.research-case-sources/1', 'Invalid source snapshot');
  assert(Array.isArray(receipt.pairs) && receipt.pairs.length === 40, 'Receipt must contain 40 semantic identity pairs');
  const resolvedIds = sourceSnapshot.scopeContract?.resolvedDocumentIds;
  assert(Array.isArray(resolvedIds) && resolvedIds.length === 40 && new Set(resolvedIds).size === 40, 'Scope must authorize exactly 40 unique documents');
  const authorizedDocuments = new Set(sourceSnapshot.scopeContract.resolvedDocumentIds);
  const profileIndexContracts = sourceSnapshot.profileContract?.indexContracts ?? [];
  assert(profileIndexContracts.length === 40, 'Profile must publish exactly 40 index contracts');
  const contracts = new Map(profileIndexContracts.map(row => [row.documentId, row]));
  assert(contracts.size === 40 && [...authorizedDocuments].every(id => contracts.has(id)), 'Profile index contracts must match the resolved document set');
  const scopeDocuments = sourceSnapshot.scopeContract?.documents ?? [];
  const scopeDocumentById = new Map(scopeDocuments.map(row => [row.id, row]));
  assert(scopeDocumentById.size === 40 && [...authorizedDocuments].every(id => scopeDocumentById.has(id)), 'Scope document inventory must match resolved IDs');
  for (const id of authorizedDocuments) {
    const profileIndex = contracts.get(id)?.indexedSource;
    const scopeIndex = scopeDocumentById.get(id)?.indexedSource;
    assert(profileIndex && scopeIndex && equalCanonical(profileIndex, scopeIndex), `Published source identities differ between profile and scope: ${id}`);
  }
  const expectedContract = sourceSnapshot.profileContract?.embeddingModelContract;
  assert(expectedContract && sourceSnapshot.profileContract.dimensions === 512, 'Pinned model contract is missing');
  const pairByVectorKey = new Map();
  const pairByDocument = new Map();
  for (const pair of receipt.pairs) {
    assert(authorizedDocuments.has(pair.documentId), `Receipt document outside resolved scope: ${pair.documentId}`);
    assert(!pairByDocument.has(pair.documentId), `Duplicate identity pair for ${pair.documentId}`);
    assert(pair.lexicalIdentity?.documentId === pair.documentId && pair.vectorIdentity?.documentId === pair.documentId,
      `Identity document binding mismatch: ${pair.documentId}`);
    assert(pair.lexicalIdentity.embedding === null, `Lexical identity must have null embedding: ${pair.documentId}`);
    assert(researchIdentityFingerprint(pair.lexicalIdentity) === pair.lexicalIdentityFingerprint
      && pair.lexicalIdentityFingerprint === pair.lexicalKey, `Lexical fingerprint mismatch: ${pair.documentId}`);
    assert(researchIdentityFingerprint(pair.vectorIdentity) === pair.vectorIdentityFingerprint
      && pair.vectorIdentityFingerprint === pair.vectorKey, `Vector fingerprint mismatch: ${pair.documentId}`);
    const vectorBase = { ...pair.vectorIdentity, embedding: null };
    assert(equalCanonical(pair.lexicalIdentity, vectorBase), `Semantic identity changed non-embedding fields: ${pair.documentId}`);
    const vectorEmbedding = pair.vectorIdentity.embedding;
    assert(vectorEmbedding?.provider === 'nodus' && vectorEmbedding?.model === sourceSnapshot.profileId
      && vectorEmbedding?.dimensions === 512 && vectorEmbedding?.metric === 'cosine', `Unexpected semantic embedding identity: ${pair.documentId}`);
    const rawParameters = pair.vectorParameters?.raw;
    assert(rawParameters && typeof rawParameters.contract === 'string', `Missing semantic parameters: ${pair.documentId}`);
    let parsedContract;
    try { parsedContract = JSON.parse(rawParameters.contract); } catch { throw new Error(`Invalid raw contract JSON: ${pair.documentId}`); }
    assert(equalCanonical(parsedContract, pair.vectorParameters.parsedContract)
      && equalCanonical(parsedContract, expectedContract), `Semantic model contract mismatch: ${pair.documentId}`);
    assert(equalCanonical(vectorEmbedding.parameters, rawParameters), `Embedding parameters differ from captured DB parameters: ${pair.documentId}`);
    const state = pair.state ?? {};
    assert(state.lexicalReady === 1 && state.lexicalEmbeddingReady === 0 && state.vectorLexicalReady === 1
      && state.vectorEmbeddingReady === 1 && state.lexicalIdentityHasNullEmbedding === true,
      `Lexical or semantic readiness is incomplete: ${pair.documentId}`);
    const stats = pair.vectorStats ?? {};
    assert(Number.isInteger(stats.passageCount) && stats.passageCount > 0 && Number.isInteger(stats.vectorCount)
      && stats.vectorCount === stats.passageCount && stats.minVectorBytes === 2048 && stats.maxVectorBytes === 2048,
      `Vector metadata count/width invalid: ${pair.documentId}`);
    const sourceIndex = contracts.get(pair.documentId)?.indexedSource;
    assert(sourceIndex && Array.isArray(sourceIndex.indexKeys) && sourceIndex.indexKeys.includes(pair.lexicalKey),
      `Lexical key is not published for authorized document: ${pair.documentId}`);
    assert(pair.lexicalIdentity.revision === sourceIndex.revision
      && pair.lexicalIdentity.attachmentId === sourceIndex.attachmentId,
      `Lexical identity revision/attachment differs from source scope: ${pair.documentId}`);
    assert(!pairByVectorKey.has(pair.vectorKey), `Duplicate semantic vector key ${pair.vectorKey}`);
    pairByDocument.set(pair.documentId, pair);
    pairByVectorKey.set(pair.vectorKey, pair);
  }
  assert(pairByDocument.size === 40 && [...authorizedDocuments].every(id => pairByDocument.has(id)), 'Receipt does not cover exact authorized scope');
  const observedVectorKeys = new Set();
  for (const row of sourceSnapshot.cases ?? []) for (const trace of row.retrievalTraces ?? []) {
    if (trace.type !== 'documentary-retrieval') continue;
    assert(equalCanonical(trace.contract, expectedContract), `Retrieval trace model contract mismatch: ${row.id}`);
    assert(trace.scopeId === sourceSnapshot.scopeContract.scopeId, `Retrieval trace scope ID mismatch: ${row.id}`);
    if (trace.permissionFingerprint !== undefined) assert(trace.permissionFingerprint === sourceSnapshot.scopeContract.permissionFingerprint,
      `Retrieval trace permission fingerprint mismatch: ${row.id}`);
    assert(trace.profile?.provider === sourceSnapshot.profileContract.provider
      && trace.profile?.model === sourceSnapshot.profileId, `Retrieval trace profile identity mismatch: ${row.id}`);
    for (const key of trace.vectorKeys ?? []) {
      const pair = pairByVectorKey.get(key);
      assert(pair, `Trace vector key has no full-identity authorization: ${row.id}/${key}`);
      observedVectorKeys.add(key);
    }
  }
  assert(observedVectorKeys.size > 0, 'No semantic vector keys were captured in retrieval traces');
  const summary = receipt.summary ?? {};
  assert(summary.pairCount === 40 && summary.sourceIdentitiesMatchAll === true
    && summary.productionFingerprintsMatchAll === true && summary.contractMatchAll === true
    && summary.embeddedReadyAll === true && summary.vectorCountsAndWidthsCorrectAll === true,
    'Receipt summary does not report complete identity and readiness validation');
  assert(Array.isArray(receipt.mismatches) && receipt.mismatches.length === 0, 'Receipt reports identity mismatches');
  return { pairByDocument, pairByVectorKey, observedVectorKeys: [...observedVectorKeys].sort(), pairCount: pairByDocument.size };
}

export function verifyDerivedIndexAuthorization(sourceSnapshot) {
  const authorization = sourceSnapshot?.indexAuthorization;
  assert(authorization?.format === INDEX_AUTHORIZATION_FORMAT && authorization.status === 'verified',
    'Semantic index authorization is missing or not verified');
  const root = fs.realpathSync(sourceSnapshot.profileRoot ?? sourceSnapshot.campaignRoot);
  const artifactsRoot = path.join(root, 'artifacts');
  for (const file of [authorization.receiptPath, authorization.originalSourceSnapshotPath, authorization.reportPath]) {
    const resolved = path.resolve(file);
    assert(resolved.startsWith(`${artifactsRoot}${path.sep}`), 'Authorization evidence path escapes marked QA artifacts');
    assert(fs.realpathSync(resolved) === resolved, 'Authorization evidence path is not canonical');
  }
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  assert(marker.root === root && marker.format === 'nodus.isolated-research-profile/1', 'Authorization profile root is not marked');
  const receiptBytes = fs.readFileSync(authorization.receiptPath);
  assert(fs.lstatSync(authorization.receiptPath).isFile() && !fs.lstatSync(authorization.receiptPath).isSymbolicLink(), 'Unsafe semantic identity receipt');
  assert(sha256(receiptBytes) === authorization.receiptSha256, 'Attached semantic identity receipt hash mismatch');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const originalSnapshot = readJsonBound(authorization.originalSourceSnapshotPath, authorization.originalSourceSnapshotSha256);
  const report = readJsonBound(authorization.reportPath, authorization.reportSha256);
  assert(authorization.caseSourceSnapshotSha256 === sourceSnapshot.caseSourceSnapshotSha256
    && authorization.scopeContractSha256 === sourceSnapshot.scopeContractSha256
    && authorization.profileContractSha256 === sourceSnapshot.profileContractSha256,
    'Derived authorization snapshot contract binding mismatch');
  assert(sourceSnapshot.cases?.length === originalSnapshot.cases?.length
    && sourceSnapshot.caseSourceSnapshotSha256 === originalSnapshot.caseSourceSnapshotSha256,
    'Derived snapshot changed case roster/hash');
  const sourceWithoutAuthorization = structuredClone(sourceSnapshot);
  delete sourceWithoutAuthorization.indexAuthorization;
  assert(equalCanonical(sourceWithoutAuthorization, originalSnapshot), 'Derived source snapshot changed original content');
  assert(sha256(Buffer.from(JSON.stringify(sourceSnapshot.profileContract), 'utf8')) === sourceSnapshot.profileContractSha256,
    'Derived profile contract hash mismatch');
  assert(sha256(Buffer.from(JSON.stringify(sourceSnapshot.scopeContract), 'utf8')) === sourceSnapshot.scopeContractSha256,
    'Derived scope contract hash mismatch');
  const validation = validateIndexAuthorization({ sourceSnapshot: originalSnapshot, receipt,
    expectedSourceSha256: authorization.originalSourceSnapshotSha256,
    expectedReportSha256: authorization.reportSha256 });
  assert(report.profileContractSha256 === originalSnapshot.profileContractSha256
    && report.scopeContractSha256 === originalSnapshot.scopeContractSha256,
    'Bound report contract differs from source snapshot');
  const dbPath = path.resolve(receipt.evidence.sqliteSnapshotPath ?? receipt.evidence.sqlitePath);
  if (receipt.evidence.sqliteSnapshotPath) {
    assert(receipt.evidence.sqliteSnapshotCopiedByteExact === true
      && receipt.evidence.sqliteSnapshotSha256 === receipt.evidence.sqliteSha256,
      'Readonly SQLite snapshot is not bound byte-for-byte to the inspected database');
    assert(dbPath.startsWith(`${path.join(root, 'artifacts')}${path.sep}`), 'Immutable SQLite snapshot escapes QA artifacts');
  } else {
    assert(dbPath.startsWith(`${path.join(root, 'profile')}${path.sep}`), 'Readonly SQLite evidence path escapes isolated profile');
  }
  const dbStat = fs.lstatSync(dbPath);
  assert(dbStat.isFile() && !dbStat.isSymbolicLink() && fs.realpathSync(dbPath) === dbPath,
    'Unsafe SQLite evidence database path');
  if (receipt.evidence.sqliteSnapshotPath) assert((dbStat.mode & 0o222) === 0, 'SQLite snapshot must be immutable/read-only');
  const expectedDbHash = receipt.evidence.sqliteSnapshotSha256 ?? receipt.evidence.sqliteSha256;
  assert(sha256(fs.readFileSync(dbPath)) === expectedDbHash, 'Readonly SQLite evidence database hash mismatch');
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const expectedFingerprintSource = path.join(repositoryRoot, 'electron/ai/researchCorpusScope.ts');
  assert(receipt.evidence.fingerprintSourcePath === 'electron/ai/researchCorpusScope.ts', 'Unexpected production fingerprint implementation path');
  assert(receipt.evidence.fingerprintSourceSha256 === sha256(fs.readFileSync(expectedFingerprintSource)),
    'Production fingerprint implementation source hash mismatch');
  return { ...validation, receiptSha256: authorization.receiptSha256 };
}

export { sha256 as indexAuthorizationSha256 };
