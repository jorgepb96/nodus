#!/usr/bin/env node
/** Offline audit and derived snapshot builder. Never opens Electron or mutates source artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalResearchJson, indexAuthorizationSha256, validateIndexAuthorization, INDEX_AUTHORIZATION_FORMAT } from './lib/researchLiveIndexAuthorization.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourcePath = path.resolve(arg('source') ?? '');
const receiptPath = path.resolve(arg('receipt') ?? '');
const outputPath = path.resolve(arg('output') ?? '');
if (!arg('source') || !arg('receipt') || !arg('output')) throw new Error('Usage: research-live-evidence-audit.mjs --source=/QA/recovery-004-case-sources.json --receipt=/QA/recovery-004-semantic-identity-pairs.json --output=/QA/recovery-004-case-sources-index-audited.json');
function assertCanonicalRegular(file, description) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) throw new Error(`${description} must be a canonical regular file`);
}
const root = path.dirname(path.dirname(sourcePath));
const artifactsRoot = path.join(root, 'artifacts');
if (path.dirname(sourcePath) !== artifactsRoot || path.dirname(receiptPath) !== artifactsRoot
    || path.dirname(outputPath) !== artifactsRoot) throw new Error('Source, receipt, and derived output must be immediate children of one marked QA artifacts directory');
assertCanonicalRegular(sourcePath, 'Source snapshot');
assertCanonicalRegular(receiptPath, 'Identity receipt');
const markerPath = path.join(root, 'isolation.json');
assertCanonicalRegular(markerPath, 'QA root marker');
const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
if (marker.root !== root || marker.format !== 'nodus.isolated-research-profile/1') throw new Error('Input root is not a canonical marked QA profile');
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite derived artifact: ${outputPath}`);
function readSafe(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe input: ${file}`);
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}
const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const { bytes: sourceBytes, value: source } = readSafe(sourcePath);
const { bytes: receiptBytes, value: receipt } = readSafe(receiptPath);
const sourceSha256 = digestBytes(sourceBytes);
const receiptSha256 = digestBytes(receiptBytes);
const evidence = receipt.evidence;
if (evidence.sourceSnapshotPath !== sourcePath || evidence.sourceSnapshotSha256 !== sourceSha256) throw new Error('Receipt is not bound to the supplied immutable source snapshot');
const reportPath = path.resolve(evidence.reportPath);
if (path.dirname(reportPath) !== artifactsRoot) throw new Error('Receipt report must be inside the marked QA artifacts directory');
assertCanonicalRegular(reportPath, 'Source report');
const { bytes: reportBytes, value: report } = readSafe(reportPath);
const reportSha256 = digestBytes(reportBytes);
if (reportSha256 !== evidence.reportSha256) throw new Error('Report hash does not match receipt binding');
if (!evidence.sqliteSnapshotPath || evidence.sqliteSnapshotCopiedByteExact !== true
    || evidence.sqliteSnapshotSha256 !== evidence.sqliteSha256) throw new Error('Receipt lacks an immutable byte-exact SQLite snapshot binding');
const sqlitePath = path.resolve(evidence.sqliteSnapshotPath);
if (!sqlitePath.startsWith(`${artifactsRoot}${path.sep}`)) throw new Error('Receipt SQLite snapshot escapes the marked QA artifacts');
assertCanonicalRegular(sqlitePath, 'Readonly SQLite evidence');
const sqliteStat = fs.lstatSync(sqlitePath);
if ((sqliteStat.mode & 0o222) !== 0 || !sqliteStat.isFile() || sqliteStat.isSymbolicLink()
    || digestBytes(fs.readFileSync(sqlitePath)) !== evidence.sqliteSnapshotSha256) throw new Error('Readonly database snapshot hash mismatch');
if (evidence.fingerprintSourcePath !== 'electron/ai/researchCorpusScope.ts') throw new Error('Unexpected production fingerprint source path');
const fingerprintSourcePath = path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), evidence.fingerprintSourcePath);
if (digestBytes(fs.readFileSync(fingerprintSourcePath)) !== evidence.fingerprintSourceSha256) throw new Error('Production identity fingerprint source hash mismatch');
const validation = validateIndexAuthorization({ sourceSnapshot: source, receipt, expectedSourceSha256: sourceSha256, expectedReportSha256: reportSha256 });
if (report.profileContractSha256 !== source.profileContractSha256 || report.scopeContractSha256 !== source.scopeContractSha256) throw new Error('Report and source snapshot contracts do not bind');
const derived = structuredClone(source);
derived.indexAuthorization = {
  format: INDEX_AUTHORIZATION_FORMAT,
  status: 'verified',
  receiptPath,
  receiptSha256,
  originalSourceSnapshotPath: sourcePath,
  originalSourceSnapshotSha256: sourceSha256,
  reportPath,
  reportSha256,
  sqliteSha256: evidence.sqliteSha256,
  fingerprintSourcePath: evidence.fingerprintSourcePath,
  fingerprintSourceSha256: evidence.fingerprintSourceSha256,
  profileContractSha256: source.profileContractSha256,
  scopeContractSha256: source.scopeContractSha256,
  caseSourceSnapshotSha256: source.caseSourceSnapshotSha256,
  authorizedPairCount: validation.pairCount,
  observedTraceVectorKeyCount: validation.observedVectorKeys.length,
};
if (canonicalResearchJson(derived.cases) !== canonicalResearchJson(source.cases)) throw new Error('Derived snapshot unexpectedly changed case records');
const auditPath = outputPath.replace(/\.json$/u, '-audit.json');
if (fs.existsSync(auditPath)) throw new Error(`Refusing to overwrite audit artifact: ${auditPath}`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(derived, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
const audit = { format: 'nodus.research-index-authorization-audit/1', createdAt: new Date().toISOString(), status: 'verified',
  sourcePath, sourceSha256, receiptPath, receiptSha256, reportPath, reportSha256, sqliteSha256: evidence.sqliteSha256,
  fingerprintSourcePath: evidence.fingerprintSourcePath, fingerprintSourceSha256: evidence.fingerprintSourceSha256,
  derivedPath: outputPath, derivedSha256: digestBytes(fs.readFileSync(outputPath)),
  pairCount: validation.pairCount, observedTraceVectorKeys: validation.observedVectorKeys.length,
  caseSourceSnapshotSha256: source.caseSourceSnapshotSha256, scopeContractSha256: source.scopeContractSha256,
  profileContractSha256: source.profileContractSha256, originalCaseRecordsPreserved: true,
  noElectronLaunched: true, noModelCalls: true };
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(audit));
