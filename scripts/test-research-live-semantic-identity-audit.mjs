#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateAuditInputs } from './research-live-semantic-identity-audit.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(Buffer.from(JSON.stringify(value), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-semantic-audit-contract-'));

function makeFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(root, 'profile/documentary'), { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({
    root, format: 'nodus.isolated-research-profile/1', purpose: 'test-only',
  }));
  fs.writeFileSync(path.join(root, 'profile/documentary/store.sqlite'), 'opaque placeholder; dry-run must not open');
  const ids = Array.from({ length: 40 }, (_, index) => `nodus:${String(index + 1).padStart(8, '0')}`);
  const contract = { provider: 'nodus', model: 'embeddinggemma-2-text-q8-512-v1', dim: 512,
    protocol: 'embeddinggemma2-text/1', task: { query: 'query', document: 'document' },
    preprocessing: { weights: 'weights', tokenizer: 'tokenizer', maxTokens: 8192 },
    normalization: 'l2-after-reduction', quantization: 'onnx-q8', configVersion: 1 };
  const indexContracts = ids.map(documentId => ({ documentId, indexedSource: {
    revision: `rev-${documentId}`, attachmentId: `att-${documentId}`, attachments: [], indexKeys: [`lex-${documentId}`],
  } }));
  const documents = ids.map(id => ({ id, indexedSource: indexContracts.find(row => row.documentId === id).indexedSource }));
  const scopeContract = { scopeId: `scope-${'a'.repeat(64)}`, resolvedDocumentIds: ids, documents };
  const profileContract = { profileId: 'embeddinggemma-2-text-q8-512-v1', provider: 'nodus', dimensions: 512,
    embeddingModelContract: contract, indexContracts };
  const source = { format: 'nodus.research-case-sources/1', profileRoot: root, profileId: profileContract.profileId,
    profileContract, profileContractSha256: jsonHash(profileContract), scopeContract,
    scopeContractSha256: jsonHash(scopeContract), caseSourceSnapshotSha256: 'f'.repeat(64),
    cases: [{ id: 'R001', retrievalTraces: [{ type: 'documentary-retrieval', vectorKeys: ids.map(id => `vec-${id}`) }] }] };
  const report = { profileRoot: root, caseSourceSnapshotSha256: source.caseSourceSnapshotSha256,
    profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256,
    embeddingContract: { provider: 'nodus', profileId: profileContract.profileId, dimensions: 512,
      embeddingModelContract: contract },
    retrievalContractAudit: { checks: [{ traceVectorKeys: ids.map(id => `vec-${id}`) }] } };
  fs.writeFileSync(path.join(artifacts, 'case-sources.json'), JSON.stringify(source));
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report));
  return { artifacts, source, report };
}

try {
  const root = path.join(tempRoot, 'valid');
  const fixture = makeFixture(root);
  const before = fs.readdirSync(fixture.artifacts).sort();
  const validated = validateAuditInputs({ root, source: 'case-sources.json', report: 'report.json' });
  assert.equal(validated.scopeDocuments.length, 40);
  assert.equal(validated.vectorKeys.length, 40);
  assert.equal(validated.dbBytes, Buffer.byteLength('opaque placeholder; dry-run must not open'));
  assert.deepEqual(fs.readdirSync(fixture.artifacts).sort(), before, 'preflight must not write artifacts');

  const freshRoot = path.join(tempRoot, 'fresh-campaign-format');
  const fresh = makeFixture(freshRoot);
  delete fresh.report.profileRoot;
  fresh.report.campaignRoot = fs.realpathSync(freshRoot);
  fs.writeFileSync(path.join(fresh.artifacts, 'report.json'), JSON.stringify(fresh.report));
  assert.equal(validateAuditInputs({ root: freshRoot, source: 'case-sources.json', report: 'report.json' }).scopeDocuments.length, 40,
    'fresh campaignRoot report format must validate');

  const conflictingRoot = path.join(tempRoot, 'conflicting-roots');
  const conflicting = makeFixture(conflictingRoot);
  conflicting.report.campaignRoot = '/different/qa/root';
  fs.writeFileSync(path.join(conflicting.artifacts, 'report.json'), JSON.stringify(conflicting.report));
  assert.throws(() => validateAuditInputs({ root: conflictingRoot, source: 'case-sources.json', report: 'report.json' }), /conflicting profileRoot and campaignRoot/u);

  const wrongContractRoot = path.join(tempRoot, 'wrong-contract');
  const wrongContract = makeFixture(wrongContractRoot);
  wrongContract.source.scopeContractSha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(wrongContract.artifacts, 'case-sources.json'), JSON.stringify(wrongContract.source));
  assert.throws(() => validateAuditInputs({ root: wrongContractRoot, source: 'case-sources.json', report: 'report.json' }), /contract hash binding/u);

  const shortScopeRoot = path.join(tempRoot, 'short-scope');
  const shortScope = makeFixture(shortScopeRoot);
  shortScope.source.scopeContract.resolvedDocumentIds.pop();
  shortScope.source.scopeContractSha256 = jsonHash(shortScope.source.scopeContract);
  shortScope.report.scopeContractSha256 = shortScope.source.scopeContractSha256;
  fs.writeFileSync(path.join(shortScope.artifacts, 'report.json'), JSON.stringify(shortScope.report));
  fs.writeFileSync(path.join(shortScope.artifacts, 'case-sources.json'), JSON.stringify(shortScope.source));
  assert.throws(() => validateAuditInputs({ root: shortScopeRoot, source: 'case-sources.json', report: 'report.json' }), /exactly 40/u);

  const symlinkRoot = path.join(tempRoot, 'symlink');
  const symlink = makeFixture(symlinkRoot);
  fs.unlinkSync(path.join(symlink.artifacts, 'report.json'));
  fs.symlinkSync(path.join(symlink.artifacts, 'case-sources.json'), path.join(symlink.artifacts, 'report.json'));
  assert.throws(() => validateAuditInputs({ root: symlinkRoot, source: 'case-sources.json', report: 'report.json' }), /canonical regular file/u);

  process.stdout.write('research-live-semantic-identity-audit: 6 contract checks passed\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
