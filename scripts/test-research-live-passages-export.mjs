#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindLibraryAttachmentToSource, validateEvidenceAliasRows, validatePassageExportInputs, validateSourceInventory } from './research-live-passages-export.mjs';
import { researchIdentityFingerprint } from './lib/researchLiveIndexAuthorization.mjs';

const documents = Array.from({ length: 40 }, (_, index) => ({
  id: `source-${String(index + 1).padStart(2, '0')}`,
  title: `Source ${String(index + 1).padStart(2, '0')}`,
  format: 'pdf', language: index % 2 ? 'en' : 'es', sha256: (index + 1).toString(16).padStart(64, '0'), bytes: 1024 + index,
}));
const preregistration = { format: 'nodus.research-live-evidence-preregistration/1',
  annotationGold: { mustNotEscape: 'gold sentinel' }, sourceDocuments: documents.map(document => ({ ...document, provenance: 'fixture' })) };
const sourceManifest = { format: 'nodus.embedding-corpus/2', documents: documents.map(document => ({ ...document, file: `/fixture/${document.id}.pdf` })) };

const inventory = validateSourceInventory(preregistration, sourceManifest);
assert.equal(inventory.sourceCount, 40);
assert.equal(inventory.sourceBySha256.get(documents[0].sha256).id, 'source-01');
assert.equal(Object.hasOwn(inventory.sourceBySha256.get(documents[0].sha256), 'annotationGold'), false,
  'gold annotation data must not be folded into source records');
const publication = { id: 'nodus:example', libraryItemId: 'nodus:library-item', attachmentId: 'local:attachment', title: 'fixture01' };
const libraryRecord = { id: publication.libraryItemId, storageId: 'storage:fixture', source: 'import',
  metadata: { title: 'fixture01' }, attachments: [{ id: publication.attachmentId, sha256: documents[0].sha256 }] };
const boundSource = bindLibraryAttachmentToSource(publication, libraryRecord, inventory.sourceBySha256);
assert.equal(boundSource.id, 'source-01');
assert.equal(boundSource.title, 'Source 01', 'logical corpus title remains the preregistration label');
assert.equal(boundSource.indexedTitle, 'fixture01', 'actual indexed title is recorded separately');
assert.throws(() => bindLibraryAttachmentToSource({ ...publication, title: 'Different indexed title' }, libraryRecord, inventory.sourceBySha256), /library metadata title/u);
assert.throws(() => bindLibraryAttachmentToSource(publication, { ...libraryRecord, metadata: { title: 'Changed metadata title' } }, inventory.sourceBySha256), /library metadata title/u);
assert.throws(() => bindLibraryAttachmentToSource(publication, { ...libraryRecord, id: 'other' }, inventory.sourceBySha256), /identity does not match/u);
const aliasPair = { documentId: 'nodus:example', vectorKey: 'b'.repeat(64), lexicalKey: 'a'.repeat(64), vectorStats: { passageCount: 1 } };
const aliasRow = { document_id: aliasPair.documentId, sourceDocumentId: 'source-01', ordinal: 0,
  passage_id: `${aliasPair.vectorKey}:0`, passage_text_sha256: 'd'.repeat(64), locator: { page: 2 } };
const lexicalAliasRow = { ...aliasRow, passage_id: `${aliasPair.lexicalKey}:0` };
const aliases = validateEvidenceAliasRows({ pair: aliasPair, vectorRows: [aliasRow], lexicalRows: [lexicalAliasRow], scopeId: 'e'.repeat(64) });
assert.equal(aliases[0].vectorPassageId, aliasRow.passage_id);
assert.equal(aliases[0].lexicalEvidenceId, `documentary:${'e'.repeat(64)}:${aliasPair.lexicalKey}:0`);
assert.equal(aliases[0].sourceDocumentId, 'source-01');
assert.throws(() => validateEvidenceAliasRows({ pair: aliasPair, vectorRows: [aliasRow], lexicalRows: [{ ...lexicalAliasRow, locator: { page: 3 } }], scopeId: 'e'.repeat(64) }), /content\/locator mismatch/u);
assert.throws(() => validateEvidenceAliasRows({ pair: aliasPair, vectorRows: [aliasRow], lexicalRows: [lexicalAliasRow], scopeId: 'foreign-scope' }), /verified identity pair and scope ID/u);

const changedHash = structuredClone(sourceManifest);
changedHash.documents[0].sha256 = 'f'.repeat(64);
assert.throws(() => validateSourceInventory(preregistration, changedHash), /sha256 mismatch/u);

const unknownId = structuredClone(sourceManifest);
unknownId.documents[0].id = 'unknown-source';
assert.throws(() => validateSourceInventory(preregistration, unknownId), /document IDs differ/u);

const duplicateTitle = structuredClone(preregistration);
duplicateTitle.sourceDocuments[1].sha256 = duplicateTitle.sourceDocuments[0].sha256;
const duplicateManifest = structuredClone(sourceManifest);
duplicateManifest.documents[1].sha256 = duplicateManifest.documents[0].sha256;
assert.throws(() => validateSourceInventory(duplicateTitle, duplicateManifest), /content hashes must be unique/u);

const incomplete = structuredClone(preregistration);
incomplete.sourceDocuments.pop();
assert.throws(() => validateSourceInventory(incomplete, sourceManifest), /exactly 40/u);

const rootBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-passages-export-contract-'));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
try {
  const importProbe = path.join(rootBase, 'import-probe');
  fs.mkdirSync(importProbe);
  const auditorUrl = pathToFileURL(path.resolve('scripts/research-live-semantic-identity-audit.mjs')).href;
  const importRun = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(auditorUrl)})`, '--', '--child', `--root=${importProbe}`], { encoding: 'utf8' });
  assert.equal(importRun.status, 0, `import-safe auditor subprocess failed: ${importRun.stderr}`);
  assert.equal(importRun.stdout, '', 'importing the auditor must not print a CLI receipt');
  assert.equal(importRun.stderr, '', 'importing the auditor must not run a child or emit errors');
  assert.deepEqual(fs.readdirSync(importProbe), [], 'importing with --child in argv must not create DB, receipt, or output side effects');

  const requestedRoot = path.join(rootBase, 'marked');
  fs.mkdirSync(requestedRoot, { recursive: true });
  const root = fs.realpathSync(requestedRoot);
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(root, 'profile/documentary'), { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root }));
  const contract = { provider: 'nodus', model: 'embeddinggemma-2-text-q8-512-v1', dim: 512,
    protocol: 'embeddinggemma2-text/1', task: { query: 'q', document: 'd' }, preprocessing: { weights: 'w', tokenizer: 't', maxTokens: 8192 },
    normalization: 'l2-after-reduction', quantization: 'onnx-q8', configVersion: 1 };
  const profileId = contract.model;
  const scopeId = 'b'.repeat(64);
  const docs = [];
  const indexContracts = [];
  const pairs = [];
  const vectorKeys = [];
  const lexicalKeys = [];
  const sourceDocuments = documents.map(document => ({ ...document, provenance: 'test fixture' }));
  for (let index = 0; index < 40; index += 1) {
    const sourceDoc = sourceDocuments[index];
    const documentId = `nodus:${String(index + 1).padStart(8, '0')}`;
    const revision = `revision-${index}`;
    const attachmentId = `local:${index}`;
    const base = { documentId, attachmentId, revision, attachmentRevision: `attachment-revision-${index}`,
      coverage: 'fulltext', textFingerprint: `text-${index}`, chunkerVersion: 'test/1', processingVersion: 'test/1' };
    const lexicalIdentity = { ...base, embedding: null };
    const lexicalKey = researchIdentityFingerprint(lexicalIdentity);
    const parameters = { endpoint: index.toString(16).padStart(64, '0'), inputPolicy: 'utf8-4096/2', contract: JSON.stringify(contract) };
    const vectorIdentity = { ...base, embedding: { provider: 'nodus', model: profileId, dimensions: 512, metric: 'cosine', parameters } };
    const vectorKey = researchIdentityFingerprint(vectorIdentity);
    const indexedSource = { revision, attachmentId, attachments: [{ id: attachmentId, revision: base.attachmentRevision }], indexKeys: [lexicalKey] };
    docs.push({ id: documentId, indexedSource });
    indexContracts.push({ documentId, indexedSource });
    lexicalKeys.push(lexicalKey);
    vectorKeys.push(vectorKey);
    pairs.push({ documentId, lexicalKey, vectorKey, lexicalIdentity, lexicalIdentityFingerprint: lexicalKey,
      vectorIdentity, vectorIdentityFingerprint: vectorKey, vectorParameters: { raw: parameters, parsedContract: contract },
      state: { lexicalReady: 1, lexicalEmbeddingReady: 0, vectorLexicalReady: 1, vectorEmbeddingReady: 1, lexicalIdentityHasNullEmbedding: true },
      vectorStats: { passageCount: 1, vectorCount: 1, legacyJsonCount: 0, minVectorBytes: 2048, maxVectorBytes: 2048 } });
  }
  const scopeContract = { scopeId, resolvedDocumentIds: docs.map(document => document.id), documents: docs };
  const profileContract = { profileId, provider: 'nodus', dimensions: 512, embeddingModelContract: contract, indexContracts };
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const source = { format: 'nodus.research-case-sources/1', profileRoot: root, profileId, scopeContract, profileContract,
    scopeContractSha256: digest(scopeContract), profileContractSha256: digest(profileContract), caseSourceSnapshotSha256: 'c'.repeat(64),
    cases: [{ id: 'R001', retrievalTraces: [{ type: 'documentary-retrieval', vectorKeys, contract, scopeId,
      profile: { provider: 'nodus', model: profileId } }] }] };
  const report = { campaignRoot: root, caseSourceSnapshotSha256: source.caseSourceSnapshotSha256,
    profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256,
    embeddingContract: { profileId, provider: 'nodus', dimensions: 512, embeddingModelContract: contract },
    retrievalContractAudit: { checks: [{ traceVectorKeys: vectorKeys }] } };
  const manifest = { format: 'nodus.embedding-corpus/2', documents: sourceDocuments.map(document => ({ ...document, file: `/opaque/${document.id}.pdf` })) };
  const prereg = { format: 'nodus.research-live-evidence-preregistration/1', sourceDocuments,
    annotationGold: { secretTestSentinel: 'must not be exported' } };
  const write = (name, value) => fs.writeFileSync(path.join(artifacts, name), JSON.stringify(value));
  write('source.json', source);
  write('report.json', report);
  write('prereg.json', prereg);
  write('manifest.json', manifest);
  const sourceBytes = fs.readFileSync(path.join(artifacts, 'source.json'));
  const reportBytes = fs.readFileSync(path.join(artifacts, 'report.json'));
  const fixture = { publications: [], passages: [] };
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const sourceDoc = sourceDocuments[index];
    const libraryItemId = `library-item-${index}`;
    const attachmentId = `attachment-${index}`;
    const indexedTitle = `fixture ${String(index + 1).padStart(2, '0')}`;
    const publication = { id: pair.documentId, libraryItemId, attachmentId, title: indexedTitle };
    fixture.publications.push({ documentId: pair.documentId, publication });
    const libraryDirectory = path.join(root, 'library/nodus-library', encodeURIComponent(libraryItemId));
    fs.mkdirSync(libraryDirectory, { recursive: true });
    fs.writeFileSync(path.join(libraryDirectory, 'metadata.json'), JSON.stringify({ id: libraryItemId, storageId: `storage-${index}`,
      source: 'import', metadata: { title: indexedTitle }, attachments: [{ id: attachmentId, sha256: sourceDoc.sha256 }] }));
    for (const [indexKey, identity, embeddingReady] of [[pair.lexicalKey, pair.lexicalIdentity, 0], [pair.vectorKey, pair.vectorIdentity, 1]]) {
      fixture.passages.push({ documentId: pair.documentId, indexKey, identity, embeddingReady, ordinal: 0,
        text: `Synthetic indexed passage ${sourceDoc.id}.`, locator: { pageLabel: 'p. 1', pageNumber: 1, sourceRef: `library:${sourceDoc.id}` } });
    }
  }
  const databaseFixturePath = path.join(artifacts, 'sqlite-fixture-input.json');
  fs.writeFileSync(databaseFixturePath, JSON.stringify(fixture));
  const electronPath = require('electron');
  const helperPath = path.join(repoRoot, 'scripts/lib/research-live-passages-sqlite-fixture.mjs');
  const electronEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', SQLITE_USE_URI: '1', NO_EXTERNAL_SERVICES: '1', NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available', HOME: path.join(root, 'profile/home') };
  execFileSync(electronPath, [helperPath, `--db=${path.join(root, 'profile/documentary/store.sqlite')}`, `--fixture=${databaseFixturePath}`],
    { cwd: repoRoot, env: electronEnv, encoding: 'utf8', timeout: 60_000 });
  const storePath = path.join(root, 'profile/documentary/store.sqlite');
  assert.equal(fs.existsSync(`${storePath}-wal`), false, 'fixture WAL must be checkpointed and closed before snapshot');
  assert.equal(fs.existsSync(`${storePath}-shm`), false, 'fixture shared-memory file must be absent before snapshot');
  fs.copyFileSync(storePath, path.join(artifacts, 'snapshot.sqlite'));
  fs.chmodSync(path.join(artifacts, 'snapshot.sqlite'), 0o400);
  const snapshotBytes = fs.readFileSync(path.join(artifacts, 'snapshot.sqlite'));
  const snapshotSha256 = createHash('sha256').update(snapshotBytes).digest('hex');
  const keysPath = path.join(artifacts, 'empty-provider-keys.json');
  fs.writeFileSync(keysPath, '{}\n', { mode: 0o600 });
  const auditorPath = path.join(repoRoot, 'scripts/research-live-semantic-identity-audit.mjs');
  const helpProbe = spawnSync(electronPath, [auditorPath, '--help'], { cwd: repoRoot, env: electronEnv, encoding: 'utf8', timeout: 60_000 });
  assert.equal(helpProbe.status, 0, `auditor --help failed: ${helpProbe.stderr}`);
  assert.match(helpProbe.stdout, /^Usage: research-live-semantic-identity-audit\.mjs/u);
  const storeSha256 = createHash('sha256').update(fs.readFileSync(storePath)).digest('hex');
  const auditedReceiptPath = path.join(artifacts, 'verified-audit.json');
  const audit = spawnSync(electronPath, [auditorPath, '--child', `--root=${root}`, `--source=${path.join(artifacts, 'source.json')}`,
    `--report=${path.join(artifacts, 'report.json')}`, `--snapshot=${path.join(artifacts, 'snapshot.sqlite')}`,
    `--receipt=${auditedReceiptPath}`, `--source-sha256=${createHash('sha256').update(sourceBytes).digest('hex')}`,
    `--report-sha256=${createHash('sha256').update(reportBytes).digest('hex')}`, `--db-sha256=${storeSha256}`],
  { cwd: repoRoot, env: { ...electronEnv, NODUS_HARNESS_KEYS_FILE: keysPath }, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(audit.status, 0, `real auditor child failed: ${audit.stderr || audit.error?.message}`);
  const auditReceipt = JSON.parse(fs.readFileSync(auditedReceiptPath, 'utf8'));
  assert.equal(auditReceipt.format, 'nodus.readonly-semantic-identity-pairs/1');
  assert.equal(auditReceipt.status, 'verified');
  assert.equal(auditReceipt.pairs.length, 40);
  assert.equal(auditReceipt.mismatches.length, 0);
  assert.equal(fs.existsSync(`${path.join(artifacts, 'snapshot.sqlite')}-wal`), false, 'immutable auditor reader must not create WAL');
  assert.equal(fs.existsSync(`${path.join(artifacts, 'snapshot.sqlite')}-shm`), false, 'immutable auditor reader must not create SHM');
  assert.equal(createHash('sha256').update(fs.readFileSync(storePath)).digest('hex'), storeSha256, 'auditor must not mutate the original closed fixture DB');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifacts, 'snapshot.sqlite'))).digest('hex'), snapshotSha256, 'auditor must not mutate the immutable fixture snapshot');
  const input = validatePassageExportInputs({ root, source: 'source.json', report: 'report.json', receipt: 'verified-audit.json',
    preregistration: 'prereg.json', sourceManifest: 'manifest.json', output: 'current-passages.json' });
  assert.equal(input.sourceInventory.sourceCount, 40);
  assert.equal(input.outputPath, path.join(artifacts, 'current-passages.json'));
  assert.equal(fs.existsSync(input.outputPath), false, 'dry validation must not create the requested export');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifacts, 'snapshot.sqlite'))).digest('hex'), snapshotSha256,
    'dry validation must not mutate the immutable SQLite snapshot');
  assert.equal(fs.statSync(path.join(artifacts, 'snapshot.sqlite')).mode & 0o222, 0, 'fixture snapshot is immutable');
  const temporaryOutput = path.join(artifacts, 'child-output.tmp');
  const exporterPath = path.join(repoRoot, 'scripts/research-live-passages-export.mjs');
  const childArgs = ['--child', `--root=${root}`, `--source=${input.auditInput.source.path}`, `--report=${input.auditInput.report.path}`,
    `--receipt=${input.receipt.path}`, `--preregistration=${input.preregistration.path}`,
    `--source-manifest=${input.sourceManifest.path}`, `--snapshot=${input.snapshotPath}`,
    `--temp=${temporaryOutput}`, `--source-sha256=${input.auditInput.source.sha256}`, `--report-sha256=${input.auditInput.report.sha256}`,
    `--receipt-sha256=${input.receipt.sha256}`, `--preregistration-sha256=${input.preregistration.sha256}`,
    `--manifest-sha256=${input.sourceManifest.sha256}`, `--snapshot-sha256=${snapshotSha256}`];
  const integration = spawnSync(electronPath, [exporterPath, ...childArgs], { cwd: repoRoot,
    env: { ...electronEnv, NODUS_HARNESS_KEYS_FILE: keysPath }, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(integration.status, 0, `real exporter child integration failed: ${integration.stderr || integration.error?.message}`);
  assert.equal(fs.existsSync(`${path.join(artifacts, 'snapshot.sqlite')}-wal`), false, 'immutable exporter reader must not create WAL');
  assert.equal(fs.existsSync(`${path.join(artifacts, 'snapshot.sqlite')}-shm`), false, 'immutable exporter reader must not create SHM');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(artifacts, 'snapshot.sqlite'))).digest('hex'), snapshotSha256, 'exporter must not mutate the immutable fixture snapshot');
  assert.equal(fs.existsSync(temporaryOutput), true, `real exporter child produced no file; stdout=${integration.stdout}; stderr=${integration.stderr}`);
  const exported = JSON.parse(fs.readFileSync(temporaryOutput, 'utf8'));
  assert.equal(exported.provenance.scopeId, scopeId);
  assert.equal(exported.provenance.documents, 40);
  assert.equal(exported.passages.length, 40, 'one semantic primary passage per authorized document');
  assert.equal(exported.evidenceAliases.length, 40, 'one fully resolved lexical alias per primary passage');
  assert.equal(exported.provenance.evidenceAliasesVerified, true);
  for (const passage of exported.passages) assert.equal(vectorKeys.includes(passage.index_key), true, 'only authorized semantic primary rows are exported');
  for (const alias of exported.evidenceAliases) {
    assert.equal(alias.scopeId, scopeId);
    assert.equal(alias.vectorEvidenceId.startsWith(`documentary:${scopeId}:`), true);
    assert.equal(alias.lexicalEvidenceId.startsWith(`documentary:${scopeId}:`), true);
  }
  assert.equal(JSON.stringify(exported).includes('must not be exported'), false, 'gold annotation sentinel must not enter passage inventory');
  fs.symlinkSync(path.join(artifacts, 'missing-target.json'), path.join(artifacts, 'dangling-output.json'));
  assert.throws(() => validatePassageExportInputs({ root, source: 'source.json', report: 'report.json', receipt: 'verified-audit.json',
    preregistration: 'prereg.json', sourceManifest: 'manifest.json', output: 'dangling-output.json' }), /already exists/u);
} finally {
  fs.rmSync(rootBase, { recursive: true, force: true });
}

process.stdout.write('research-live-passages-export: 11 inventory, authorization, import-safety, and dry-run checks passed\n');
