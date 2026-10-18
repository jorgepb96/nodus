import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalResearchJson, researchIdentityFingerprint, validateIndexAuthorization, verifyDerivedIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const contract = { provider: 'nodus', model: 'embeddinggemma-2-text-q8-512-v1', dim: 512, protocol: 'fixture/1' };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-index-auth-test-')));
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts);
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ root, format: 'nodus.isolated-research-profile/1' }));
  const docs = Array.from({ length: 40 }, (_, i) => `doc-${String(i).padStart(2, '0')}`);
  const profileContract = { provider: 'nodus', dimensions: 512, embeddingModelContract: contract, indexContracts: docs.map((documentId, i) => ({
    documentId, indexedSource: { revision: `rev-${i}`, attachmentId: `att-${i}`, indexKeys: [] },
  })) };
  const source = { format: 'nodus.research-case-sources/1', profileRoot: root, profileId: contract.model,
    profileContract, caseSourceSnapshotSha256: 'cases-hash', scopeContract: { resolvedDocumentIds: docs,
      scopeId: 'scope-fixture', permissionFingerprint: 'permission-fixture', documents: [] }, cases: [] };
  const pairs = docs.map((documentId, i) => {
    const lexicalIdentity = { documentId, attachmentId: `att-${i}`, revision: `rev-${i}`, textFingerprint: `text-${i}`, embedding: null };
    const lexicalKey = researchIdentityFingerprint(lexicalIdentity);
    profileContract.indexContracts[i].indexedSource.indexKeys.push(lexicalKey);
    const raw = { endpoint: `endpoint-${i}`, inputPolicy: 'utf8-4096/2', contract: JSON.stringify(contract) };
    const vectorIdentity = { ...lexicalIdentity, embedding: { provider: 'nodus', model: contract.model, dimensions: 512, metric: 'cosine', parameters: raw } };
    return { documentId, lexicalKey, vectorKey: researchIdentityFingerprint(vectorIdentity), lexicalIdentity,
      lexicalIdentityFingerprint: lexicalKey, vectorIdentity, vectorIdentityFingerprint: researchIdentityFingerprint(vectorIdentity),
      vectorParameters: { raw, parsedContract: contract }, state: { lexicalReady: 1, lexicalEmbeddingReady: 0, vectorLexicalReady: 1,
        vectorEmbeddingReady: 1, lexicalIdentityHasNullEmbedding: true },
      vectorStats: { passageCount: 1, vectorCount: 1, minVectorBytes: 2048, maxVectorBytes: 2048 } };
  });
  source.scopeContract.documents = profileContract.indexContracts.map((row, i) => ({ id: row.documentId, revision: `rev-${i}`,
    attachmentId: `att-${i}`, indexedSource: row.indexedSource }));
  source.profileContractSha256 = sha(JSON.stringify(source.profileContract));
  source.scopeContractSha256 = sha(JSON.stringify(source.scopeContract));
  source.cases = [{ id: 'R001', retrievalTraces: [{ type: 'documentary-retrieval', contract,
    profile: { provider: 'nodus', model: contract.model }, scopeId: 'scope-fixture', vectorKeys: pairs.map(pair => pair.vectorKey) }] }];
  const sourcePath = path.join(artifacts, 'source.json');
  fs.writeFileSync(sourcePath, JSON.stringify(source));
  const sourceSha = sha(fs.readFileSync(sourcePath));
  const report = { profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256 };
  const reportPath = path.join(artifacts, 'report.json'); fs.writeFileSync(reportPath, JSON.stringify(report));
  const reportSha = sha(fs.readFileSync(reportPath));
  const sqlitePath = path.join(root, 'profile', 'documentary', 'store.sqlite'); fs.mkdirSync(path.dirname(sqlitePath), { recursive: true }); fs.writeFileSync(sqlitePath, 'readonly-fixture');
  const sqliteSha = sha(fs.readFileSync(sqlitePath));
  const sqliteSnapshotPath = path.join(artifacts, 'documentary-identity-state.sqlite');
  fs.writeFileSync(sqliteSnapshotPath, fs.readFileSync(sqlitePath), { flag: 'wx', mode: 0o400 });
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fingerprintFile = path.join(repo, 'electron/ai/researchCorpusScope.ts');
  const receipt = { format: 'nodus.readonly-semantic-identity-pairs/1', evidence: { sqliteOpenedReadonly: true,
    queriedColumnsExcludeTextAndVectorBytes: true, sourceSnapshotPath: sourcePath, sourceSnapshotSha256: sourceSha, reportSha256: reportSha,
    reportPath, sqlitePath, sqliteSha256: sqliteSha, sqliteSnapshotPath, sqliteSnapshotSha256: sqliteSha,
    sqliteSnapshotCopiedByteExact: true, fingerprintSourcePath: 'electron/ai/researchCorpusScope.ts',
    fingerprintSourceSha256: sha(fs.readFileSync(fingerprintFile)) }, summary: { pairCount: 40, sourceIdentitiesMatchAll: true,
    productionFingerprintsMatchAll: true, contractMatchAll: true, embeddedReadyAll: true, vectorCountsAndWidthsCorrectAll: true },
    mismatches: [], pairs };
  const receiptPath = path.join(artifacts, 'receipt.json'); fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const receiptSha = sha(fs.readFileSync(receiptPath));
  const derived = structuredClone(source);
  derived.indexAuthorization = { format: 'nodus.research-index-authorization/1', status: 'verified', receiptPath, receiptSha256: receiptSha,
    originalSourceSnapshotPath: sourcePath, originalSourceSnapshotSha256: sourceSha, reportPath, reportSha256: reportSha,
    sqliteSha256: sqliteSha, profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256,
    caseSourceSnapshotSha256: source.caseSourceSnapshotSha256 };
  return { root, source, receipt, derived };
}

test('identity fingerprints are stable across object key order', () => {
  assert.equal(canonicalResearchJson({ z: 1, a: { y: 2, x: 3 } }), canonicalResearchJson({ a: { x: 3, y: 2 }, z: 1 }));
});

test('full semantic identity pairs authorize trace keys through their lexical bases', t => {
  const { source, receipt } = fixture();
  t.after(() => fs.rmSync(source.profileRoot, { recursive: true, force: true }));
  const result = validateIndexAuthorization({ sourceSnapshot: source, receipt, expectedSourceSha256: receipt.evidence.sourceSnapshotSha256,
    expectedReportSha256: receipt.evidence.reportSha256 });
  assert.equal(result.pairCount, 40);
  assert.equal(result.observedVectorKeys.length, 40);
});

test('derived snapshot verifies receipt and immutable database snapshot, independent of later live DB writes', t => {
  const { derived } = fixture();
  t.after(() => fs.rmSync(derived.profileRoot, { recursive: true, force: true }));
  assert.equal(verifyDerivedIndexAuthorization(derived).pairCount, 40);
  fs.writeFileSync(path.join(derived.profileRoot, 'profile/documentary/store.sqlite'), 'later app cache write');
  assert.equal(verifyDerivedIndexAuthorization(derived).pairCount, 40);
});

test('modified immutable SQLite snapshot fails its hash binding', t => {
  const { derived } = fixture();
  t.after(() => fs.rmSync(derived.profileRoot, { recursive: true, force: true }));
  const snapshot = derived.indexAuthorization.receiptPath.replace('receipt.json', 'documentary-identity-state.sqlite');
  fs.chmodSync(snapshot, 0o600);
  fs.writeFileSync(snapshot, 'altered snapshot');
  fs.chmodSync(snapshot, 0o400);
  assert.throws(() => verifyDerivedIndexAuthorization(derived), /SQLite evidence database hash mismatch/);
});

test('missing or altered identity pairs fail closed', t => {
  const { source, receipt } = fixture();
  t.after(() => fs.rmSync(source.profileRoot, { recursive: true, force: true }));
  assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: null }), /Missing or unsupported/);
  const changed = structuredClone(receipt);
  changed.pairs[0].vectorIdentity.embedding.dimensions = 256;
  assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: changed }), /Vector fingerprint mismatch/);
  const wrongContract = structuredClone(receipt);
  wrongContract.pairs[0].vectorIdentity.embedding.parameters.contract = JSON.stringify({ ...contract, protocol: 'other/1' });
  wrongContract.pairs[0].vectorParameters.raw.contract = wrongContract.pairs[0].vectorIdentity.embedding.parameters.contract;
  wrongContract.pairs[0].vectorParameters.parsedContract = { ...contract, protocol: 'other/1' };
  wrongContract.pairs[0].vectorIdentityFingerprint = researchIdentityFingerprint(wrongContract.pairs[0].vectorIdentity);
  wrongContract.pairs[0].vectorKey = wrongContract.pairs[0].vectorIdentityFingerprint;
  assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: wrongContract }), /model contract mismatch/);
  const changedBase = structuredClone(receipt);
  const basePair = changedBase.pairs[0];
  for (const [field, value] of [['revision', 'attacker-revision'], ['attachmentId', 'attacker-attachment'], ['textFingerprint', 'attacker-text']]) {
    const altered = structuredClone(changedBase);
    const pair = altered.pairs[0];
    pair.lexicalIdentity[field] = value; pair.vectorIdentity[field] = value;
    pair.lexicalIdentityFingerprint = pair.lexicalKey = researchIdentityFingerprint(pair.lexicalIdentity);
    pair.vectorIdentityFingerprint = pair.vectorKey = researchIdentityFingerprint(pair.vectorIdentity);
    assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: altered }), /not published for authorized document|differs from source scope/);
  }
});

test('wrong lexical document authorization and incomplete readiness fail closed', t => {
  const { source, receipt } = fixture();
  t.after(() => fs.rmSync(source.profileRoot, { recursive: true, force: true }));
  const changedDocument = structuredClone(receipt); changedDocument.pairs[0].documentId = 'unauthorized';
  assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: changedDocument }), /outside resolved scope/);
  const failedReadiness = structuredClone(receipt); failedReadiness.pairs[0].state.vectorEmbeddingReady = 0;
  assert.throws(() => validateIndexAuthorization({ sourceSnapshot: source, receipt: failedReadiness }), /readiness is incomplete/);
});

test('derived snapshot rejects case and contract edits even when stored snapshot hashes are left unchanged', t => {
  const { derived } = fixture();
  t.after(() => fs.rmSync(derived.profileRoot, { recursive: true, force: true }));
  const alteredCase = structuredClone(derived);
  alteredCase.cases[0].retrievalTraces[0].vectorKeys[0] = 'forged';
  assert.throws(() => verifyDerivedIndexAuthorization(alteredCase), /changed original content/);
  const alteredScope = structuredClone(derived);
  alteredScope.scopeContract.resolvedDocumentIds[0] = 'changed-scope-document';
  alteredScope.scopeContractSha256 = sha(JSON.stringify(alteredScope.scopeContract));
  assert.throws(() => verifyDerivedIndexAuthorization(alteredScope), /changed original content|scope contract hash mismatch|contract binding mismatch/);
  const alteredProfile = structuredClone(derived);
  alteredProfile.profileContract.dimensions = 512;
  alteredProfile.profileContract.embeddingModelContract = { ...contract, protocol: 'forged/1' };
  alteredProfile.profileContractSha256 = sha(JSON.stringify(alteredProfile.profileContract));
  assert.throws(() => verifyDerivedIndexAuthorization(alteredProfile), /changed original content|model contract|contract binding mismatch/);
});
