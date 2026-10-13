#!/usr/bin/env node
/** Export authorized semantic-variant passages without scores or vector contents. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
import { canonicalResearchJson, SEMANTIC_IDENTITY_RECEIPT_FORMAT, validateIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';
import { validateAuditInputs } from './research-live-semantic-identity-audit.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const has = key => process.argv.includes(`--${key}`);
const fail = message => { throw new Error(message); };

function canonicalFile(file, label, parent) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) fail(`${label} must be a canonical regular file`);
  if (parent && path.dirname(resolved) !== parent) fail(`${label} must be an immediate child of the marked artifacts directory`);
  return resolved;
}

function readJson(file, label, parent) {
  const canonical = canonicalFile(file, label, parent);
  const bytes = fs.readFileSync(canonical);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
  return { path: canonical, bytes, sha256: sha(bytes), value };
}

function assertNewPath(file, label) {
  try { fs.lstatSync(file); fail(`${label} already exists; refusing overwrite`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function canonicalDirectory(directory, label, parent) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) fail(`${label} must be a canonical directory`);
  if (parent && !resolved.startsWith(`${parent}${path.sep}`)) fail(`${label} escapes its allowed root`);
  return resolved;
}

function artifactFile(artifacts, value, label) {
  if (!value) fail(`${label} path is required`);
  const resolved = path.resolve(artifacts, value);
  if (path.dirname(resolved) !== artifacts) fail(`${label} must be inside the marked artifacts directory`);
  return canonicalFile(resolved, label, artifacts);
}

export function validateSourceInventory(preregistration, sourceManifest) {
  if (preregistration?.format !== 'nodus.research-live-evidence-preregistration/1'
      || !Array.isArray(preregistration.sourceDocuments) || preregistration.sourceDocuments.length !== 40) {
    fail('Preregistration must contain exactly 40 sourceDocuments');
  }
  if (sourceManifest?.format !== 'nodus.embedding-corpus/2'
      || !Array.isArray(sourceManifest.documents) || sourceManifest.documents.length !== 40) {
    fail('Source manifest must contain exactly 40 corpus documents');
  }
  const byId = new Map();
  for (const item of preregistration.sourceDocuments) {
    if (typeof item.id !== 'string' || !item.id || byId.has(item.id)) fail('Preregistration source IDs must be unique non-empty strings');
    byId.set(item.id, item);
  }
  const manifestById = new Map();
  for (const item of sourceManifest.documents) {
    if (typeof item.id !== 'string' || !item.id || manifestById.has(item.id)) fail('Source manifest IDs must be unique non-empty strings');
    manifestById.set(item.id, item);
  }
  if (byId.size !== manifestById.size || [...byId.keys()].some(id => !manifestById.has(id))) fail('Preregistration and source manifest document IDs differ');
  const sourceBySha256 = new Map();
  for (const [id, preregDoc] of byId) {
    const manifestDoc = manifestById.get(id);
    for (const field of ['title', 'format', 'language', 'sha256']) {
      if (typeof preregDoc[field] !== 'string' || !preregDoc[field] || preregDoc[field] !== manifestDoc[field]) {
        fail(`Preregistration/source manifest ${field} mismatch for ${id}`);
      }
    }
    if (!/^[a-f0-9]{64}$/u.test(preregDoc.sha256)) fail(`Invalid source SHA-256 for ${id}`);
    if (sourceBySha256.has(preregDoc.sha256)) fail('Source content hashes must be unique to bind library attachments unambiguously');
    sourceBySha256.set(preregDoc.sha256, { ...preregDoc });
  }
  return { sourceBySha256, sourceCount: byId.size };
}

export function bindLibraryAttachmentToSource(publication, libraryRecord, sourceBySha256) {
  if (!publication || typeof publication.id !== 'string' || typeof publication.libraryItemId !== 'string'
      || typeof publication.attachmentId !== 'string' || typeof publication.title !== 'string') {
    fail('Published document lacks exact library item and attachment identifiers');
  }
  if (libraryRecord?.id !== publication.libraryItemId || !Array.isArray(libraryRecord.attachments)) fail('Library metadata identity does not match published document');
  if (typeof libraryRecord.metadata?.title !== 'string' || publication.title !== libraryRecord.metadata.title) {
    fail('Published title differs from the isolated library metadata title');
  }
  const attachments = libraryRecord.attachments.filter(item => item.id === publication.attachmentId);
  if (attachments.length !== 1 || !/^[a-f0-9]{64}$/u.test(attachments[0].sha256 ?? '')) fail('Published attachment does not resolve to one hashed library attachment');
  const source = sourceBySha256.get(attachments[0].sha256);
  if (!source) fail('Library attachment SHA-256 is not in the frozen preregistration/source manifest');
  return { ...source, indexedTitle: publication.title };
}

export function validateEvidenceAliasRows({ pair, vectorRows, lexicalRows, scopeId }) {
  if (!pair || typeof scopeId !== 'string' || !/^[a-f0-9]{64}$/u.test(scopeId)) fail('Evidence alias requires a verified identity pair and scope ID');
  const expectedCount = pair.vectorStats?.passageCount;
  if (!Number.isInteger(expectedCount) || expectedCount <= 0 || vectorRows.length !== expectedCount || lexicalRows.length !== expectedCount) {
    fail(`Lexical/vector passage counts differ from verified metadata receipt: ${pair.documentId}`);
  }
  return vectorRows.map((vector, index) => {
    const lexical = lexicalRows[index];
    if (!vector || !lexical || vector.ordinal !== index || lexical.ordinal !== index
        || vector.document_id !== pair.documentId || lexical.document_id !== pair.documentId
        || vector.passage_text_sha256 !== lexical.passage_text_sha256
        || canonicalResearchJson(vector.locator) !== canonicalResearchJson(lexical.locator)) {
      fail(`Lexical and semantic passage content/locator mismatch: ${pair.documentId}/${index}`);
    }
    return { scopeId, vectorPassageId: vector.passage_id, lexicalPassageId: lexical.passage_id,
      vectorEvidenceId: `documentary:${scopeId}:${pair.vectorKey}:${index}`,
      lexicalEvidenceId: `documentary:${scopeId}:${pair.lexicalKey}:${index}`,
      sourceDocumentId: vector.sourceDocumentId, ordinal: index, textSha256: vector.passage_text_sha256,
      locatorSha256: sha(Buffer.from(canonicalResearchJson(vector.locator), 'utf8')) };
  });
}

export function validatePassageExportInputs({ root: requestedRoot, source: sourceArg, report: reportArg,
  receipt: receiptArg, preregistration: preregArg, sourceManifest: manifestArg, output: outputArg }) {
  if (!requestedRoot || !sourceArg || !reportArg || !receiptArg || !preregArg || !manifestArg) {
    fail('Usage: research-live-passages-export.mjs --root=QA --source=case-sources.json --report=report.json --receipt=verified-audit.json --preregistration=preregistration.json --source-manifest=source-manifest.json [--out=passages.json] [--run]');
  }
  const auditInput = validateAuditInputs({ root: requestedRoot, source: sourceArg, report: reportArg });
  const root = auditInput.root;
  const artifacts = auditInput.artifacts;
  const receiptPath = artifactFile(artifacts, receiptArg, 'Metadata audit receipt');
  const preregistrationPath = artifactFile(artifacts, preregArg, 'Preregistration');
  const sourceManifestPath = artifactFile(artifacts, manifestArg, 'Source manifest');
  const receipt = readJson(receiptPath, 'Metadata audit receipt', artifacts);
  const preregistration = readJson(preregistrationPath, 'Preregistration', artifacts);
  const sourceManifest = readJson(sourceManifestPath, 'Source manifest', artifacts);
  if (receipt.value.format !== SEMANTIC_IDENTITY_RECEIPT_FORMAT || receipt.value.status !== 'verified') fail('A verified semantic identity receipt is required');
  validateIndexAuthorization({ sourceSnapshot: auditInput.source.value, receipt: receipt.value,
    expectedSourceSha256: auditInput.source.sha256, expectedReportSha256: auditInput.report.sha256 });
  const sourceInventory = validateSourceInventory(preregistration.value, sourceManifest.value);
  const pairs = receipt.value.pairs;
  if (pairs.length !== 40 || pairs.some(pair => !auditInput.source.value.scopeContract.resolvedDocumentIds.includes(pair.documentId))) {
    fail('Verified receipt must authorize exactly 40 in-scope semantic variants');
  }
  const snapshotPath = path.resolve(receipt.value.evidence.sqliteSnapshotPath ?? '');
  if (!snapshotPath || path.dirname(snapshotPath) !== artifacts) fail('Verified receipt snapshot must be inside marked QA artifacts');
  canonicalFile(snapshotPath, 'Immutable metadata-audit SQLite snapshot', artifacts);
  if (receipt.value.evidence.sqliteSnapshotCopiedByteExact !== true
      || receipt.value.evidence.sqliteSnapshotSha256 !== receipt.value.evidence.sqliteSha256) fail('Receipt does not bind a byte-exact immutable SQLite snapshot');
  const snapshotStat = fs.lstatSync(snapshotPath);
  if ((snapshotStat.mode & 0o222) !== 0) fail('Metadata-audit SQLite snapshot must be read-only');
  for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${snapshotPath}${suffix}`)) fail(`Immutable snapshot has an unexpected SQLite sidecar: ${path.basename(snapshotPath)}${suffix}`);
  const outputPath = outputArg
    ? path.resolve(artifacts, outputArg)
    : path.join(artifacts, `current-passages-${new Date().toISOString().replace(/[-:.]/gu, '')}-${randomUUID()}.json`);
  if (path.dirname(outputPath) !== artifacts) fail('Passage export output must be inside marked QA artifacts');
  assertNewPath(outputPath, 'Passage export output');
  canonicalDirectory(artifacts, 'QA artifacts directory', root);
  return { root, artifacts, auditInput, receipt, preregistration, sourceManifest, sourceInventory, snapshotPath, outputPath };
}

function assertNoLiveProfileLock(root) {
  const lockPath = path.join(root, 'profile/isolated-instance.lock');
  if (!fs.existsSync(lockPath)) return { exists: false, live: false };
  canonicalFile(lockPath, 'QA profile lock');
  const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
  if (!Number.isSafeInteger(pid) || pid < 2) fail('Invalid QA profile lock PID');
  try { process.kill(pid, 0); fail('QA profile is still live'); }
  catch (error) { if (error.message === 'QA profile is still live') throw error; if (error.code !== 'ESRCH') throw error; }
  return { exists: true, live: false, pid };
}

function assertClosedProfileStore(dbPath) {
  for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${dbPath}${suffix}`)) fail(`Refusing export while QA database sidecar exists: ${path.basename(dbPath)}${suffix}`);
}

function ensureEmptyKeys(artifacts) {
  const file = path.join(artifacts, 'empty-provider-keys.json');
  canonicalFile(file, 'Literal empty provider keys file', artifacts);
  const bytes = fs.readFileSync(file);
  if (bytes.toString('utf8') !== '{}\n' || Object.keys(JSON.parse(bytes.toString('utf8'))).length !== 0) fail('Provider keys must be exactly the literal empty object');
  return { path: file, sha256: sha(bytes) };
}

function makeTempPath(outputPath) { return `${outputPath}.tmp-${randomUUID()}`; }

function runSandbox(input, keys, tempPath) {
  const before = [input.auditInput.source, input.auditInput.report, input.receipt, input.preregistration, input.sourceManifest]
    .map(item => ({ path: item.path, sha256: sha(fs.readFileSync(item.path)) }));
  const snapshotBefore = sha(fs.readFileSync(input.snapshotPath));
  if (snapshotBefore !== input.receipt.value.evidence.sqliteSnapshotSha256) fail('Immutable SQLite snapshot hash does not match verified receipt');
  const profileLock = assertNoLiveProfileLock(input.root);
  assertClosedProfileStore(input.auditInput.dbPath);
  const electronPath = require('electron');
  const policy = macResearchSandbox(input.root);
  const sandboxProof = verifyResearchSandbox(input.root, policy);
  const childEnv = { ...researchTestEnvironment(input.root), ELECTRON_RUN_AS_NODE: '1', SQLITE_USE_URI: '1', HOME: path.join(input.root, 'profile/home'),
    NODUS_HARNESS_KEYS_FILE: keys.path, NO_EXTERNAL_SERVICES: '1', NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  const child = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, electronPath, scriptPath, '--child',
    `--root=${input.root}`, `--source=${input.auditInput.source.path}`, `--report=${input.auditInput.report.path}`,
    `--receipt=${input.receipt.path}`, `--preregistration=${input.preregistration.path}`,
    `--source-manifest=${input.sourceManifest.path}`, `--snapshot=${input.snapshotPath}`, `--temp=${tempPath}`,
    `--source-sha256=${input.auditInput.source.sha256}`, `--report-sha256=${input.auditInput.report.sha256}`,
    `--receipt-sha256=${input.receipt.sha256}`, `--preregistration-sha256=${input.preregistration.sha256}`,
    `--manifest-sha256=${input.sourceManifest.sha256}`, `--snapshot-sha256=${snapshotBefore}`],
  { cwd: repoRoot, env: childEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  if (child.error || child.status !== 0 || !fs.existsSync(tempPath)) fail(`Sandboxed passage export failed (exit ${child.status ?? 'signal'}): ${(child.stderr || child.error?.message || '').slice(-2000)}`);
  const temp = readJson(tempPath, 'Temporary passage export', input.artifacts);
  const libraryRoot = fs.realpathSync(path.join(input.root, 'library/nodus-library'));
  for (const item of temp.value.provenance?.libraryAttachmentMetadata ?? []) {
    const metadataPath = canonicalFile(item.path, 'QA library item metadata');
    if (!metadataPath.startsWith(`${libraryRoot}${path.sep}`) || sha(fs.readFileSync(metadataPath)) !== item.sha256) {
      fail('QA library attachment metadata changed or escaped during export');
    }
  }
  const after = [input.auditInput.source, input.auditInput.report, input.receipt, input.preregistration, input.sourceManifest]
    .map(item => ({ path: item.path, sha256: sha(fs.readFileSync(item.path)) }));
  const snapshotAfter = sha(fs.readFileSync(input.snapshotPath));
  if (JSON.stringify(before) !== JSON.stringify(after) || snapshotAfter !== snapshotBefore) fail('Bound evidence or immutable database snapshot changed during export');
  return { temp, snapshotSha256: snapshotAfter, sandboxProof, profileLock, runtimeSummary: child.stdout.trim() };
}

function atomicCommit(tempPath, outputPath) {
  const fd = fs.openSync(tempPath, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.linkSync(tempPath, outputPath); // Atomic creation; fails if output exists.
  fs.unlinkSync(tempPath);
  const dirFd = fs.openSync(path.dirname(outputPath), 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

async function runChild() {
  const root = fs.realpathSync(path.resolve(arg('root')));
  const artifacts = path.join(root, 'artifacts');
  const receiptPath = canonicalFile(arg('receipt'), 'Metadata audit receipt', artifacts);
  const preregistrationPath = canonicalFile(arg('preregistration'), 'Preregistration', artifacts);
  const sourceManifestPath = canonicalFile(arg('source-manifest'), 'Source manifest', artifacts);
  const snapshotPath = canonicalFile(arg('snapshot'), 'Immutable SQLite snapshot', artifacts);
  const tempPath = path.resolve(arg('temp'));
  if (path.dirname(tempPath) !== artifacts) fail('Temporary output must be inside QA artifacts');
  assertNewPath(tempPath, 'Temporary output');
  const input = validatePassageExportInputs({ root, source: arg('source'), report: arg('report'),
    receipt: path.basename(receiptPath), preregistration: path.basename(preregistrationPath), sourceManifest: path.basename(sourceManifestPath),
    output: path.basename(tempPath) });
  const sourcePath = input.auditInput.source.path;
  const reportPath = input.auditInput.report.path;
  const expected = [['source-sha256', input.auditInput.source.sha256], ['report-sha256', input.auditInput.report.sha256],
    ['receipt-sha256', input.receipt.sha256], ['preregistration-sha256', input.preregistration.sha256],
    ['manifest-sha256', input.sourceManifest.sha256], ['snapshot-sha256', input.receipt.value.evidence.sqliteSnapshotSha256]];
  if (expected.some(([key, value]) => arg(key) !== value)) fail('Frozen passage export inputs changed before database query');
  if (snapshotPath !== input.snapshotPath || sha(fs.readFileSync(snapshotPath)) !== arg('snapshot-sha256')) fail('SQLite snapshot does not match verified receipt');
  const keyPath = process.env.NODUS_HARNESS_KEYS_FILE;
  if (!keyPath || path.dirname(path.resolve(keyPath)) !== artifacts || fs.readFileSync(keyPath, 'utf8') !== '{}\n') fail('Runtime must use the literal empty provider keys file');
  const { installRuntimeHooks } = await import(pathToFileURL(path.join(repoRoot, 'scripts/lib/tsRuntimeHooks.mjs')).href);
  const runtimeStub = installRuntimeHooks(path.join(root, 'profile'));
  if (runtimeStub.safeStorage.isEncryptionAvailable() !== false) fail('Runtime hook did not force SafeStorage unavailable');
  const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
  const snapshotUri = pathToFileURL(snapshotPath);
  snapshotUri.searchParams.set('mode', 'ro');
  snapshotUri.searchParams.set('immutable', '1');
  const db = new Database(snapshotUri.href, { readonly: true, fileMustExist: true });
  let sourceForDocument;
  let libraryAttachmentMetadata;
  let passages;
  const scopeId = input.auditInput.source.value.scopeContract.scopeId;
  if (typeof scopeId !== 'string' || !/^[a-f0-9]{64}$/u.test(scopeId)) fail('Frozen source scope ID is invalid');
  const evidenceAliases = [];
  try {
    db.pragma('query_only = ON');
    const pairByKey = new Map(input.receipt.value.pairs.flatMap(pair => [
      [pair.vectorKey, { pair, kind: 'vector' }], [pair.lexicalKey, { pair, kind: 'lexical' }],
    ]));
    if (pairByKey.size !== 80) fail('Lexical and semantic identity keys are not unique across the verified receipt');
    const docs = db.prepare(`SELECT document_id,document_json FROM documentary_publications
      WHERE document_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify([...new Set(input.receipt.value.pairs.map(pair => pair.documentId))]));
    sourceForDocument = new Map();
    libraryAttachmentMetadata = [];
    for (const row of docs) {
      const published = JSON.parse(row.document_json);
      if (published.id !== row.document_id || typeof published.title !== 'string') fail('Publication metadata does not match the authorized document identity');
      if (typeof published.libraryItemId !== 'string') fail('Published document does not identify its isolated QA library item');
      const encodedItemId = encodeURIComponent(published.libraryItemId);
      const libraryRoot = path.join(root, 'library/nodus-library');
      const metadataPath = path.join(libraryRoot, encodedItemId, 'metadata.json');
      const canonicalLibraryRoot = canonicalDirectory(libraryRoot, 'QA library root', root);
      const canonicalMetadataPath = canonicalFile(metadataPath, 'QA library item metadata');
      if (!canonicalMetadataPath.startsWith(`${canonicalLibraryRoot}${path.sep}`)) fail('QA library metadata escapes the marked library root');
      const libraryMetadata = readJson(canonicalMetadataPath, 'QA library item metadata');
      const source = bindLibraryAttachmentToSource(published, libraryMetadata.value, input.sourceInventory.sourceBySha256);
      if (sourceForDocument.has(row.document_id)) fail('Duplicate publication metadata for authorized document');
      sourceForDocument.set(row.document_id, source);
      libraryAttachmentMetadata.push({ libraryItemId: published.libraryItemId, attachmentId: published.attachmentId,
        path: canonicalMetadataPath, sha256: libraryMetadata.sha256, sourceSha256: source.sha256 });
    }
    if (sourceForDocument.size !== 40) fail('Publication metadata does not map all 40 authorized documents to source manifest IDs');
    const rows = db.prepare(`SELECT p.document_id,p.index_key,p.id AS passage_id,p.ordinal,p.text,p.locator_json,
      r.identity_json,r.lexical_ready,r.embedding_ready
      FROM documentary_passages p JOIN documentary_revisions r ON r.index_key=p.index_key
      WHERE p.index_key IN (SELECT value FROM json_each(?)) ORDER BY p.index_key,p.ordinal`).all(JSON.stringify([...pairByKey.keys()]));
    const byKey = new Map();
    const rowsByKey = new Map();
    for (const row of rows) {
      const binding = pairByKey.get(row.index_key);
      const pair = binding?.pair;
      const source = sourceForDocument.get(row.document_id);
      const identity = JSON.parse(row.identity_json);
      if (!pair || !source || row.document_id !== pair.documentId || row.document_id !== identity.documentId
          || canonicalResearchJson(identity) !== canonicalResearchJson(binding.kind === 'vector' ? pair.vectorIdentity : pair.lexicalIdentity)
          || row.lexical_ready !== 1 || row.embedding_ready !== (binding.kind === 'vector' ? 1 : 0)) fail('Database passage does not match verified lexical or semantic identity metadata');
      if (typeof row.text !== 'string' || !Number.isInteger(row.ordinal) || row.ordinal < 0
          || row.passage_id !== `${row.index_key}:${row.ordinal}`) fail('Invalid passage identity, ordinal, or text');
      let locator;
      try { locator = JSON.parse(row.locator_json); } catch { fail('Passage locator is invalid JSON'); }
      const seen = byKey.get(row.index_key) ?? new Set();
      if (seen.has(row.ordinal)) fail('Duplicate passage ordinal');
      seen.add(row.ordinal);
      byKey.set(row.index_key, seen);
      const record = { document_id: row.document_id, index_key: row.index_key, passage_id: row.passage_id,
        ordinal: row.ordinal, text: row.text, passage_text_sha256: sha(Buffer.from(row.text, 'utf8')),
        coverage: identity.coverage, text_fingerprint: identity.textFingerprint,
        sourceDocumentId: source.id, sourceTitle: source.title, indexedTitle: source.indexedTitle, sourceLanguage: source.language,
        sourceFormat: source.format, sourceSha256: source.sha256, locator };
      const keyed = rowsByKey.get(row.index_key) ?? [];
      keyed.push(record);
      rowsByKey.set(row.index_key, keyed);
    }
    if (byKey.size !== 80) fail('Passage rows do not cover all 40 authorized lexical and semantic identity keys');
    passages = [];
    for (const pair of input.receipt.value.pairs) {
      const vectorOrdinals = [...(byKey.get(pair.vectorKey) ?? [])].sort((a, b) => a - b);
      const lexicalOrdinals = [...(byKey.get(pair.lexicalKey) ?? [])].sort((a, b) => a - b);
      const expectedCount = pair.vectorStats.passageCount;
      if (vectorOrdinals.length !== expectedCount || vectorOrdinals.some((ordinal, index) => ordinal !== index)
          || lexicalOrdinals.length !== expectedCount || lexicalOrdinals.some((ordinal, index) => ordinal !== index)) fail('Lexical/vector passage counts or ordinal continuity differ from verified metadata receipt');
      const vectorRows = rowsByKey.get(pair.vectorKey) ?? [];
      const lexicalRows = rowsByKey.get(pair.lexicalKey) ?? [];
      passages.push(...vectorRows);
      evidenceAliases.push(...validateEvidenceAliasRows({ pair, vectorRows, lexicalRows, scopeId }));
    }
  } finally { db.close(); }
  for (const item of libraryAttachmentMetadata) {
    if (sha(fs.readFileSync(item.path)) !== item.sha256) fail('QA library attachment metadata changed during export');
  }
  passages.sort((a, b) => a.sourceDocumentId.localeCompare(b.sourceDocumentId) || a.index_key.localeCompare(b.index_key) || a.ordinal - b.ordinal);
  const receiptHash = sha(fs.readFileSync(receiptPath));
  const output = { format: 'nodus.retrieval-corpus-current-passages/1', provenance: {
    databasePath: snapshotPath, databaseSha256: arg('snapshot-sha256'),
    metadataAuditReceiptPath: receiptPath, metadataAuditReceiptSha256: receiptHash,
    sourceSnapshotPath: sourcePath, sourceSnapshotSha256: arg('source-sha256'),
    reportPath, reportSha256: arg('report-sha256'),
    preregistrationPath, preregistrationSha256: arg('preregistration-sha256'),
    originalCorpusManifestPath: sourceManifestPath, originalCorpusManifestSha256: arg('manifest-sha256'),
    libraryAttachmentMetadata,
    sourceDocumentBinding: 'Exact publication libraryItemId + attachmentId -> QA library metadata attachment SHA-256 -> frozen preregistration/source-manifest source SHA-256; title checked only as a consistency field, never used to select source ID.',
    databaseAccess: 'SQLite read-only immutable snapshot; PRAGMA query_only=ON; authorized lexical and semantic variant keys only; no vector columns selected; deterministic inventory without ranking or scores',
    runtime: { nodeVersion: process.version, electronVersion: process.versions.electron ?? null,
      platform: process.platform, architecture: process.arch, execution: 'Electron-as-Node with TSRuntimeHooks stub' },
    corpusDocumentBindingsVerified: true, documents: sourceForDocument.size, passages: passages.length,
    scopeId, evidenceAliasesVerified: true }, evidenceAliases, passages };
  const tmp = fs.openSync(tempPath, 'wx', 0o600);
  try { fs.writeFileSync(tmp, `${JSON.stringify(output, null, 2)}\n`); fs.fsyncSync(tmp); } finally { fs.closeSync(tmp); }
  process.stdout.write(JSON.stringify({ format: output.format, documents: output.provenance.documents,
    passages: output.provenance.passages, outputTemporaryPath: tempPath, noRanking: true, vectorColumnsSelected: false }) + '\n');
}

const isMainScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainScript && has('child')) {
  runChild().catch(error => { process.stderr.write(`${error?.message ?? String(error)}\n`); process.exitCode = 2; });
} else if (isMainScript) {
  try {
    if (has('help')) process.stdout.write('Usage: research-live-passages-export.mjs --root=QA --source=case-sources.json --report=report.json --receipt=verified-audit.json --preregistration=preregistration.json --source-manifest=source-manifest.json [--out=current-passages.json] [--run]\n');
    else {
      const input = validatePassageExportInputs({ root: arg('root'), source: arg('source'), report: arg('report'), receipt: arg('receipt'),
        preregistration: arg('preregistration'), sourceManifest: arg('source-manifest'), output: arg('out') });
      if (!has('run')) process.stdout.write(JSON.stringify({ format: 'nodus.research-live-passages-export-preflight/1', status: 'ready',
        root: input.root, outputPath: input.outputPath, sourceSha256: input.auditInput.source.sha256,
        reportSha256: input.auditInput.report.sha256, metadataAuditReceiptSha256: input.receipt.sha256,
        preregistrationSha256: input.preregistration.sha256, sourceManifestSha256: input.sourceManifest.sha256,
        snapshotPath: input.snapshotPath, snapshotSha256: input.receipt.value.evidence.sqliteSnapshotSha256,
        databaseOpened: false, filesWritten: false }) + '\n');
      else {
        const keys = ensureEmptyKeys(input.artifacts);
        const tempPath = makeTempPath(input.outputPath);
        try {
          const result = runSandbox(input, keys, tempPath);
          atomicCommit(tempPath, input.outputPath);
          const outputBytes = fs.readFileSync(input.outputPath);
          const output = JSON.parse(outputBytes.toString('utf8'));
          process.stdout.write(JSON.stringify({ format: output.format, outputPath: input.outputPath,
            outputSha256: sha(outputBytes), documents: output.provenance.documents, passages: output.provenance.passages,
            snapshotSha256: result.snapshotSha256, keysSha256: keys.sha256, sandboxProof: result.sandboxProof,
            profileLock: result.profileLock, runtimeSummary: result.runtimeSummary }) + '\n');
        } catch (error) {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          throw error;
        }
      }
    }
  } catch (error) { process.stderr.write(`${error?.message ?? String(error)}\n`); process.exitCode = 2; }
}
