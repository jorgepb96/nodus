import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deriveCloneInputs, validateCloneRebaseReceipt } from './research-qualified-profile-snapshot.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qualified-profile-proof-'));
try {

const source = { format: 'nodus.research-case-sources/1', createdAt: '2026-10-12T15:00:00.000Z',
  profileRoot: '/qa/original', profileId: 'embeddinggemma-2-text-q8-512-v1',
  profileContract: { dimensions: 512, indexContracts: Array.from({ length: 40 }, (_, i) => ({ documentId: `doc-${i}`, indexKeys: [`lex-${i}`] })) },
  profileContractSha256: 'a'.repeat(64), scopeContract: { scopeId: 'scope-frozen-80', resolvedDocumentIds: Array.from({ length: 40 }, (_, i) => `doc-${i}`), documents: [] },
  scopeContractSha256: 'b'.repeat(64), caseSourceSnapshotSha256: 'c'.repeat(64),
  cases: Array.from({ length: 80 }, (_, i) => ({ id: `case-${i}`, sourcesContext: [{ sourceId: `doc-${i % 40}` }],
    retrievalTraces: [{ type: 'documentary-retrieval', at: `2026-10-12T15:${String(i % 60).padStart(2, '0')}:00.000Z`, scopeId: 'scope-frozen-80', vectorKeys: [`vec-${i % 40}`] }] })),
  indexAuthorization: { format: 'nodus.research-index-authorization/1', status: 'verified',
    receiptPath: '/qa/original/artifacts/receipt.json', receiptSha256: 'd'.repeat(64), sqliteSha256: 'e'.repeat(64),
    observedTraceVectorKeyCount: 40 } };
const report = { campaignRoot: '/qa/original', profileContractSha256: source.profileContractSha256,
  scopeContractSha256: source.scopeContractSha256, caseSourceSnapshotSha256: source.caseSourceSnapshotSha256,
  cases: structuredClone(source.cases) };
const sourceFile = { path: '/qa/original/artifacts/case-sources.json', sha256: '1'.repeat(64) };
const reportFile = { path: '/qa/original/artifacts/campaign.json', sha256: '2'.repeat(64) };
const { sourceBase, reportClone, provenance } = deriveCloneInputs({ source: { ...source, __file: sourceFile },
  report: { ...report, __file: reportFile }, root: '/qa/clone-a', now: '2026-10-13T18:00:00.000Z' });

assert.equal(sourceBase.profileRoot, '/qa/clone-a');
assert.equal(sourceBase.campaignRoot, undefined);
assert.equal(reportClone.campaignRoot, '/qa/clone-a');
assert.equal(reportClone.profileRoot, undefined);
assert.equal(sourceBase.indexAuthorization, undefined, 'new authorization is attached only after clone audit');
assert.equal(sourceBase.createdAt, source.createdAt, 'original retrieval snapshot time is preserved');
assert.equal(sourceBase.caseSourceSnapshotSha256, source.caseSourceSnapshotSha256);
assert.equal(sourceBase.profileContractSha256, source.profileContractSha256);
assert.equal(sourceBase.scopeContractSha256, source.scopeContractSha256);
assert.deepEqual(sourceBase.scopeContract, source.scopeContract, 'logical scope ID and resolved document IDs stay frozen');
assert.deepEqual(sourceBase.profileContract.indexContracts, source.profileContract.indexContracts);
assert.deepEqual(sourceBase.cases, source.cases, 'all 80 case contexts and trace timestamps are copied byte-for-structure');
assert.equal(provenance.caseCount, 80);
assert.equal(provenance.resolvedDocumentCount, 40);
assert.equal(provenance.originalProfileRoot, '/qa/original');
assert.match(provenance.retrievalEvidence, /copied from the original audited snapshot/u);
assert.match(provenance.retrievalEvidence, /performs no retrieval/u);
assert.throws(() => deriveCloneInputs({ source: { ...source, __file: sourceFile },
  report: { ...report, scopeContractSha256: 'f'.repeat(64), __file: reportFile }, root: '/qa/clone-b' }), /contracts do not match/u);
assert.throws(() => deriveCloneInputs({ source: { ...source, cases: source.cases.slice(0, 79), __file: sourceFile },
  report: { ...report, __file: reportFile }, root: '/qa/clone-b' }), /80 unique cases/u);

const cloneRootCandidate = path.join(temp, 'clone');
fs.mkdirSync(cloneRootCandidate);
const cloneRoot = fs.realpathSync(cloneRootCandidate);
const artifacts = path.join(cloneRoot, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const changedRows = [
  ...Array.from({ length: 40 }, (_, i) => ({ table: 'documentary_requests', rowKey: { document_id: `doc-${i}` } })),
  ...Array.from({ length: 2 }, (_, i) => ({ table: 'documentary_campaigns', rowKey: { id: `campaign-${i}` } })),
].map(row => {
  const oldValue = JSON.stringify({ scope: '/qa/original/profile/nodus.sqlite', stable: true });
  const newValue = oldValue.replaceAll('/qa/original', cloneRoot);
  return { ...row, column: 'configuration_json', oldValue, newValue,
    oldValueSha256: sha(Buffer.from(oldValue)), newValueSha256: sha(Buffer.from(newValue)) };
});
const vectorPayloads = Array.from({ length: 787 }, (_, i) => ({ id: `vector-${i}`, indexKey: `index-${i}`,
  documentId: `doc-${i % 40}`, ordinal: i, sha256: sha(Buffer.from(`payload-${i}`)) }));
const receipt = { format: 'nodus.prepared-index-path-rebase/1', sourceDbPath: '/qa/original/profile/documentary/store.sqlite',
  cloneDbPath: path.join(cloneRoot, 'profile/documentary/store.sqlite'), sourceDbSha256: '1'.repeat(64),
  cloneDbSha256: '2'.repeat(64), allowedColumnChanges: changedRows, changedCellCount: 42,
  tablesEqualExceptAllowedColumns: true, schemaSha256: '3'.repeat(64), sourceSchemaSha256: '3'.repeat(64),
  documentIdentities: Array.from({ length: 40 }, (_, i) => ({ documentId: `doc-${i}`, revisionCount: 2, sha256: sha(Buffer.from(`identity-${i}`)) })),
  documentCount: 40, revisionCount: 80, revisionContractSha256: '4'.repeat(64), vectorPayloads, vectorCount: 787,
  vectorPayloadsSha256: sha(Buffer.from(JSON.stringify(canonical(vectorPayloads)))), sameRevisionContract: true,
  sameVectorPayloads: true, rebaseVerified: true };
fs.writeFileSync(path.join(artifacts, 'clone-rebase-receipt.json'), JSON.stringify(receipt));
const sourceProof = { scopeContract: { resolvedDocumentIds: Array.from({ length: 40 }, (_, i) => `doc-${i}`) } };
const checked = validateCloneRebaseReceipt({ root: cloneRoot, originalRoot: '/qa/original',
  originalDbSha256: '1'.repeat(64), cloneDbSha256: '2'.repeat(64), source: sourceProof });
assert.equal(checked.changedCellCount, 42);
assert.equal(checked.vectorCount, 787);
const altered = structuredClone(receipt); altered.allowedColumnChanges[0].newValue = altered.allowedColumnChanges[0].newValue.replace('stable', 'changed');
fs.writeFileSync(path.join(artifacts, 'clone-rebase-receipt.json'), JSON.stringify(altered));
assert.throws(() => validateCloneRebaseReceipt({ root: cloneRoot, originalRoot: '/qa/original',
  originalDbSha256: '1'.repeat(64), cloneDbSha256: '2'.repeat(64), source: sourceProof }), /path-only configuration change/u);
console.log('PASS qualified profile derivation and rebase receipt: frozen 80-case roster, exact scope/index contracts, original trace timestamps, and 42 path-only DB changes with all 787 vector hashes.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
