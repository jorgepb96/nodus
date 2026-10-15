#!/usr/bin/env node
/** Bind an identical cloned QA profile to previously audited, frozen case sources. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyDerivedIndexAuthorization, validateIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const FORMAT = 'nodus.qualified-profile-clone-provenance/1';
const AUTH_FORMAT = 'nodus.research-index-authorization/1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const canonicalJson = value => JSON.stringify(canonicalValue(value));
const fail = message => { throw new Error(message); };
const args = Object.fromEntries(process.argv.slice(2).filter(value => value.startsWith('--')).map(value => {
  const at = value.indexOf('='); return at < 0 ? [value.slice(2), true] : [value.slice(2, at), value.slice(at + 1)];
}));

function readCanonicalJson(file, label, parent) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved
      || (parent && path.dirname(resolved) !== parent)) fail(`${label} must be a canonical regular file${parent ? ' in artifacts' : ''}`);
  const bytes = fs.readFileSync(resolved);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
  return { path: resolved, bytes, value, sha256: sha(bytes) };
}
function markedRoot(rootArg) {
  if (!path.isAbsolute(rootArg ?? '')) fail('Clone root must be an absolute path');
  const root = fs.realpathSync(rootArg);
  const marker = readCanonicalJson(path.join(root, 'isolation.json'), 'Isolation marker').value;
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== root) fail('Clone root marker does not bind its canonical path');
  const lock = path.join(root, 'profile/isolated-instance.lock');
  if (fs.existsSync(lock)) {
    const lockStat = fs.lstatSync(lock);
    if (!lockStat.isFile() || lockStat.isSymbolicLink() || fs.realpathSync(lock) !== lock) fail('Clone profile lock must be a canonical regular file');
    const pid = Number(fs.readFileSync(lock, 'utf8').trim());
    if (!Number.isSafeInteger(pid) || pid < 2) fail('Clone profile lock has an invalid PID');
    try { process.kill(pid, 0); fail('Clone Electron profile is still live'); }
    catch (error) { if (error.message === 'Clone Electron profile is still live' || error.code !== 'ESRCH') throw error; }
  }
  return root;
}
function writeNew(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { path: file, bytes: fs.readFileSync(file), sha256: sha(fs.readFileSync(file)) };
}
function provenance(source, report, sourceFile, reportFile, root, now) {
  const originalAuth = source.indexAuthorization;
  if (originalAuth?.format !== AUTH_FORMAT || originalAuth.status !== 'verified') fail('Original source snapshot lacks verified semantic index authorization');
  return { format: FORMAT, transferMode: 'path-rebased cloned QA profile; unchanged indexed content and vectors',
    originalProfileRoot: source.profileRoot ?? source.campaignRoot,
    originalSourceSnapshotPath: sourceFile.path, originalSourceSnapshotSha256: sourceFile.sha256,
    originalCampaignReportPath: reportFile.path, originalCampaignReportSha256: reportFile.sha256,
    originalIndexAuthorizationReceiptPath: originalAuth.receiptPath, originalIndexAuthorizationReceiptSha256: originalAuth.receiptSha256,
    originalSqliteSha256: originalAuth.sqliteSha256, cloneProfileRoot: root, transferredAt: now,
    caseSourceSnapshotSha256: source.caseSourceSnapshotSha256,
    profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256,
    scopeId: source.scopeContract?.scopeId, resolvedDocumentCount: source.scopeContract?.resolvedDocumentIds?.length,
    caseCount: source.cases?.length,
    retrievalEvidence: 'The 80 case contexts and retrieval traces are copied from the original audited snapshot. Their timestamps describe the original run; this clone qualification performs no retrieval.' };
}

export function validateCloneRebaseReceipt({ root, originalRoot, originalDbSha256, cloneDbSha256, source }) {
  const receiptPath = path.join(root, 'artifacts/clone-rebase-receipt.json');
  const receiptFile = readCanonicalJson(receiptPath, 'Clone path-rebase receipt', path.join(root, 'artifacts'));
  const receipt = receiptFile.value;
  const sourceDb = path.join(originalRoot, 'profile/documentary/store.sqlite');
  const cloneDb = path.join(root, 'profile/documentary/store.sqlite');
  if (receipt.format !== 'nodus.prepared-index-path-rebase/1' || receipt.sourceDbPath !== sourceDb
      || receipt.cloneDbPath !== cloneDb || receipt.sourceDbSha256 !== originalDbSha256
      || receipt.cloneDbSha256 !== cloneDbSha256 || receipt.rebaseVerified !== true
      || receipt.tablesEqualExceptAllowedColumns !== true || receipt.sameRevisionContract !== true
      || receipt.sameVectorPayloads !== true) fail('Clone path-rebase receipt does not prove preserved indexed content');
  const changes = receipt.allowedColumnChanges;
  if (!Array.isArray(changes) || changes.length !== 42 || receipt.changedCellCount !== 42) fail('Path-rebase receipt must bind exactly 42 changed cells');
  const counts = { documentary_requests: 0, documentary_campaigns: 0 };
  const rowKeys = new Set();
  for (const row of changes) {
    if (!Object.hasOwn(counts, row.table) || row.column !== 'configuration_json'
        || !row.rowKey || typeof row.oldValue !== 'string' || typeof row.newValue !== 'string'
        || sha(Buffer.from(row.oldValue, 'utf8')) !== row.oldValueSha256
        || sha(Buffer.from(row.newValue, 'utf8')) !== row.newValueSha256
        || !row.oldValue.includes(originalRoot) || row.newValue !== row.oldValue.replaceAll(originalRoot, root)) fail('Rebase receipt includes a non-path-only configuration change');
    const key = `${row.table}\0${JSON.stringify(row.rowKey)}`;
    if (rowKeys.has(key)) fail('Rebase receipt duplicates a changed row');
    rowKeys.add(key);
    counts[row.table]++;
    try { JSON.parse(row.oldValue); JSON.parse(row.newValue); } catch { fail('Rebase receipt configuration JSON is malformed'); }
  }
  if (counts.documentary_requests !== 40 || counts.documentary_campaigns !== 2) fail('Unexpected path-rebase table/row counts');
  if (!/^[a-f0-9]{64}$/u.test(receipt.schemaSha256 ?? '') || receipt.schemaSha256 !== receipt.sourceSchemaSha256
      || receipt.documentCount !== 40 || receipt.revisionCount !== 80 || !/^[a-f0-9]{64}$/u.test(receipt.revisionContractSha256 ?? '')
      || receipt.vectorCount !== 787 || !Array.isArray(receipt.vectorPayloads) || receipt.vectorPayloads.length !== 787
      || !/^[a-f0-9]{64}$/u.test(receipt.vectorPayloadsSha256 ?? '')
      || sha(Buffer.from(canonicalJson(receipt.vectorPayloads), 'utf8')) !== receipt.vectorPayloadsSha256) fail('Rebase receipt identity/revision/vector evidence is incomplete or malformed');
  const expectedIds = [...source.scopeContract.resolvedDocumentIds].sort();
  const identities = receipt.documentIdentities;
  if (!Array.isArray(identities) || identities.length !== 40
      || canonicalJson(identities.map(row => row.documentId).sort()) !== canonicalJson(expectedIds)
      || identities.some(row => !Number.isSafeInteger(row.revisionCount) || row.revisionCount < 1 || !/^[a-f0-9]{64}$/u.test(row.sha256 ?? ''))
      || identities.reduce((sum, row) => sum + row.revisionCount, 0) !== 80) fail('Rebase identity records do not cover the exact frozen document scope');
  const vectorIds = new Set();
  for (const vector of receipt.vectorPayloads) {
    if (typeof vector.id !== 'string' || vectorIds.has(vector.id) || typeof vector.indexKey !== 'string'
        || typeof vector.documentId !== 'string' || !Number.isSafeInteger(vector.ordinal)
        || !/^[a-f0-9]{64}$/u.test(vector.sha256 ?? '')) fail('Rebase receipt contains invalid vector payload evidence');
    vectorIds.add(vector.id);
  }
  return { path: receiptFile.path, sha256: receiptFile.sha256, sourceDbSha256: receipt.sourceDbSha256,
    cloneDbSha256: receipt.cloneDbSha256, changedCellCount: changes.length,
    documentCount: receipt.documentCount, revisionCount: receipt.revisionCount,
    vectorCount: receipt.vectorCount, vectorPayloadsSha256: receipt.vectorPayloadsSha256 };
}

export function deriveCloneInputs({ source: sourceInput, report: reportInput, root, now = new Date().toISOString() } = {}) {
  const source = structuredClone(sourceInput);
  const report = structuredClone(reportInput);
  if (source.format !== 'nodus.research-case-sources/1' || source.indexAuthorization?.format !== AUTH_FORMAT
      || source.indexAuthorization.status !== 'verified') fail('Original source snapshot lacks verified semantic index authorization');
  const ids = source.cases?.map(row => row.id);
  if (!Array.isArray(ids) || ids.length !== 80 || new Set(ids).size !== 80) fail('Original snapshot must contain exactly 80 unique cases');
  if (source.scopeContract?.resolvedDocumentIds?.length !== 40 || source.profileContract?.indexContracts?.length !== 40) fail('Original snapshot must preserve the exact 40-document scope and index contracts');
  if (report.profileContractSha256 !== source.profileContractSha256 || report.scopeContractSha256 !== source.scopeContractSha256
      || report.caseSourceSnapshotSha256 !== source.caseSourceSnapshotSha256) fail('Original source/report contracts do not match');
  const proof = provenance(source, report, sourceInput.__file, reportInput.__file, root, now);
  delete source.indexAuthorization;
  delete source.__file;
  source.profileRoot = root;
  delete source.campaignRoot;
  source.cloneQualification = proof;
  delete report.__file;
  report.campaignRoot = root;
  delete report.profileRoot;
  report.cloneQualification = proof;
  return { sourceBase: source, reportClone: report, provenance: proof };
}

/** Create root-bound source/report inputs, perform the existing read-only SQLite
 * identity audit, and attach its receipt as derived authorization. */
export function qualifyClonedResearchProfile({ root: rootArg, source: sourceArg, report: reportArg,
  now = new Date().toISOString() } = {}) {
  const root = markedRoot(rootArg);
  const artifacts = path.join(root, 'artifacts');
  const sourceIn = readCanonicalJson(sourceArg, 'Original source snapshot');
  const reportIn = readCanonicalJson(reportArg, 'Original campaign report');
  if (sourceIn.value.format !== 'nodus.research-case-sources/1') fail('Unsupported original source snapshot format');
  const sourceRoot = sourceIn.value.profileRoot ?? sourceIn.value.campaignRoot;
  if (sourceRoot !== path.dirname(path.dirname(sourceIn.path))) fail('Original source snapshot root does not match its artifacts location');
  const sourceArtifacts = path.join(sourceRoot, 'artifacts');
  if (path.dirname(sourceIn.path) !== sourceArtifacts || path.dirname(reportIn.path) !== sourceArtifacts) fail('Original source and report must be in their marked artifacts directory');
  if (reportIn.path !== sourceIn.value.indexAuthorization?.reportPath
      || reportIn.sha256 !== sourceIn.value.indexAuthorization?.reportSha256) fail('Campaign report does not match the original index authorization');
  const originalAuthorization = verifyDerivedIndexAuthorization(sourceIn.value);
  if (originalAuthorization.pairCount !== 40) fail('Original index authorization does not cover all 40 documents');
  if (reportIn.value.profileContractSha256 !== sourceIn.value.profileContractSha256
      || reportIn.value.scopeContractSha256 !== sourceIn.value.scopeContractSha256
      || reportIn.value.caseSourceSnapshotSha256 !== sourceIn.value.caseSourceSnapshotSha256) fail('Original source/report contracts do not match');
  const sourceDb = path.join(root, 'profile/documentary/store.sqlite');
  const dbStat = fs.lstatSync(sourceDb);
  if (!dbStat.isFile() || dbStat.isSymbolicLink() || fs.realpathSync(sourceDb) !== sourceDb) fail('Cloned profile database must be a canonical regular file');
  for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${sourceDb}${suffix}`)) fail('Cloned profile database has open SQLite sidecars');
  const cloneDbSha = sha(fs.readFileSync(sourceDb));
  const rebaseProof = validateCloneRebaseReceipt({ root, originalRoot: sourceRoot,
    originalDbSha256: sourceIn.value.indexAuthorization.sqliteSha256, cloneDbSha256: cloneDbSha, source: sourceIn.value });
  const originalCaseIds = sourceIn.value.cases?.map(row => row.id);
  if (!Array.isArray(originalCaseIds) || originalCaseIds.length !== 80 || new Set(originalCaseIds).size !== 80) fail('Original snapshot must contain exactly 80 unique cases');
  if (sourceIn.value.scopeContract?.resolvedDocumentIds?.length !== 40) fail('Original snapshot must preserve the exact 40-document scope');
  const { sourceBase, reportClone, provenance: proof } = deriveCloneInputs({
    source: { ...sourceIn.value, __file: sourceIn }, report: { ...reportIn.value, __file: reportIn }, root, now });
  proof.cloneRebaseReceiptPath = rebaseProof.path;
  proof.cloneRebaseReceiptSha256 = rebaseProof.sha256;
  proof.cloneDatabaseSha256 = cloneDbSha;
  proof.rebaseEvidence = { changedCellCount: rebaseProof.changedCellCount, documentCount: rebaseProof.documentCount,
    revisionCount: rebaseProof.revisionCount, vectorCount: rebaseProof.vectorCount,
    vectorPayloadsSha256: rebaseProof.vectorPayloadsSha256 };
  fs.mkdirSync(artifacts, { recursive: true });
  for (const name of ['qualified-case-sources-base.json', 'qualified-campaign.json', 'qualified-case-sources.json']) {
    if (fs.existsSync(path.join(artifacts, name))) fail(`Qualified profile output already exists: ${name}`);
  }
  const baseFile = writeNew(path.join(artifacts, 'qualified-case-sources-base.json'), sourceBase);
  const reportFile = writeNew(path.join(artifacts, 'qualified-campaign.json'), reportClone);
  const audit = spawnSync(process.execPath, [path.join(REPO, 'scripts/research-live-semantic-identity-audit.mjs'),
    `--root=${root}`, '--source=qualified-case-sources-base.json', '--report=qualified-campaign.json', '--run'],
  { cwd: REPO, env: { ...process.env, NO_EXTERNAL_SERVICES: '1' }, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (audit.error || audit.status !== 0) fail(`Cloned profile semantic identity audit failed: ${(audit.stderr || audit.error?.message || '').slice(-2000)}`);
  const output = audit.stdout.trim().split(/\r?\n/u).at(-1);
  let auditResult;
  try { auditResult = JSON.parse(output); } catch { fail('Semantic identity audit returned no machine-readable receipt result'); }
  const receiptFile = readCanonicalJson(auditResult.receiptPath, 'Semantic identity receipt', artifacts);
  const auditReceipt = receiptFile.value;
  validateIndexAuthorization({ sourceSnapshot: sourceBase, receipt: auditReceipt,
    expectedSourceSha256: baseFile.sha256, expectedReportSha256: reportFile.sha256 });
  const authorization = { format: AUTH_FORMAT, status: 'verified', receiptPath: receiptFile.path,
    receiptSha256: receiptFile.sha256, originalSourceSnapshotPath: baseFile.path,
    originalSourceSnapshotSha256: baseFile.sha256, reportPath: reportFile.path, reportSha256: reportFile.sha256,
    sqliteSha256: cloneDbSha, fingerprintSourcePath: auditReceipt.evidence.fingerprintSourcePath,
    fingerprintSourceSha256: auditReceipt.evidence.fingerprintSourceSha256,
    profileContractSha256: sourceBase.profileContractSha256, scopeContractSha256: sourceBase.scopeContractSha256,
    caseSourceSnapshotSha256: sourceBase.caseSourceSnapshotSha256,
    authorizedPairCount: auditReceipt.summary.pairCount, observedTraceVectorKeyCount: sourceIn.value.indexAuthorization.observedTraceVectorKeyCount,
    cloneQualificationSha256: sha(Buffer.from(JSON.stringify(proof), 'utf8')) };
  const qualified = { ...sourceBase, indexAuthorization: authorization };
  const qualifiedFile = writeNew(path.join(artifacts, 'qualified-case-sources.json'), qualified);
  const derivedValidation = verifyDerivedIndexAuthorization(qualified);
  if (derivedValidation.pairCount !== 40 || derivedValidation.receiptSha256 !== receiptFile.sha256) fail('Final qualified snapshot did not validate through the derived authorization contract');
  return { format: 'nodus.qualified-profile-snapshot-result/1', status: 'verified', root,
    sourceSnapshotPath: qualifiedFile.path, sourceSnapshotSha256: qualifiedFile.sha256,
    reportPath: reportFile.path, reportSha256: reportFile.sha256,
    receiptPath: receiptFile.path, receiptSha256: receiptFile.sha256,
    caseCount: originalCaseIds.length, scopeId: sourceBase.scopeContract.scopeId,
    resolvedDocumentCount: sourceBase.scopeContract.resolvedDocumentIds.length,
    lexicalIdentityPairCount: derivedValidation.pairCount, clonedDatabaseSha256: cloneDbSha,
    retrievalTimestamps: 'preserved from original snapshot; no retrieval was run on the clone' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (args.help) console.log('Usage: research-qualified-profile-snapshot.mjs --root=/clone/root --source=/original/artifacts/case-sources-index-audited-001.json --report=/original/artifacts/campaign.json');
    else console.log(JSON.stringify(qualifyClonedResearchProfile({ root: args.root, source: args.source, report: args.report })));
  } catch (error) { console.error(`Qualified profile snapshot rejected: ${error?.message ?? String(error)}`); process.exitCode = 2; }
}
