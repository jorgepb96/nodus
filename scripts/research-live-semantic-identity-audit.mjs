#!/usr/bin/env node
/** Read-only inspection of authorized lexical and semantic documentary identities.
 * Dry-run validates only frozen JSON contracts. `--run` snapshots a closed QA SQLite
 * store, then queries metadata under Electron-as-Node and the existing OS sandbox.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
import { canonicalResearchJson, SEMANTIC_IDENTITY_RECEIPT_FORMAT, validateIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const has = key => process.argv.includes(`--${key}`);
const fail = message => { throw new Error(message); };

function regularCanonical(file, label, parent) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) fail(`${label} must be a canonical regular file`);
  if (parent && path.dirname(resolved) !== parent) fail(`${label} must be an immediate child of the marked artifacts directory`);
  return resolved;
}

function safeJson(file, label, parent) {
  const canonical = regularCanonical(file, label, parent);
  const bytes = fs.readFileSync(canonical);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
  return { path: canonical, bytes, sha256: sha(bytes), value };
}

function uniqueSorted(values) { return [...new Set(values)].sort(); }

function assertCanonicalRootBinding(value, label, root) {
  const bindings = ['profileRoot', 'campaignRoot'].filter(key => value?.[key] !== undefined);
  if (bindings.length === 2 && value.profileRoot !== value.campaignRoot) fail(`${label} has conflicting profileRoot and campaignRoot bindings`);
  if (bindings.length === 0 || bindings.some(key => value[key] !== root)) fail(`${label} root binding does not match the canonical marked QA root`);
}

export function validateAuditInputs({ root: requestedRoot, source: sourceArg, report: reportArg }) {
  if (!requestedRoot || !sourceArg || !reportArg) fail('Usage: research-live-semantic-identity-audit.mjs --root=/marked/QA --source=case-sources.json --report=report.json [--run]');
  const root = fs.realpathSync(path.resolve(requestedRoot));
  const markerFile = regularCanonical(path.join(root, 'isolation.json'), 'QA isolation marker');
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  if (marker.root !== root || marker.format !== 'nodus.isolated-research-profile/1') fail('Input root is not the canonical marked QA root');
  const artifacts = path.join(root, 'artifacts');
  const sourcePath = path.resolve(artifacts, sourceArg);
  const reportPath = path.resolve(artifacts, reportArg);
  if (path.dirname(sourcePath) !== artifacts || path.dirname(reportPath) !== artifacts) fail('Source and report must be inside the marked root artifacts directory');
  const source = safeJson(sourcePath, 'Source snapshot', artifacts);
  const report = safeJson(reportPath, 'Campaign report', artifacts);
  if (source.value.format !== 'nodus.research-case-sources/1') fail('Unsupported source snapshot format');
  assertCanonicalRootBinding(source.value, 'Source snapshot', root);
  assertCanonicalRootBinding(report.value, 'Campaign report', root);
  if (source.value.caseSourceSnapshotSha256 !== report.value.caseSourceSnapshotSha256) fail('Source/report case snapshot hash binding mismatch');
  if (source.value.profileContractSha256 !== report.value.profileContractSha256
      || source.value.scopeContractSha256 !== report.value.scopeContractSha256) fail('Source/report contract hash binding mismatch');
  if (sha(Buffer.from(JSON.stringify(source.value.profileContract), 'utf8')) !== source.value.profileContractSha256
      || sha(Buffer.from(JSON.stringify(source.value.scopeContract), 'utf8')) !== source.value.scopeContractSha256) fail('Source contract digest does not match frozen object');
  if (report.value.embeddingContract?.dimensions !== source.value.profileContract?.dimensions
      || report.value.embeddingContract?.provider !== source.value.profileContract?.provider
      || report.value.embeddingContract?.profileId !== source.value.profileId
      || canonicalResearchJson(report.value.embeddingContract?.embeddingModelContract) !== canonicalResearchJson(source.value.profileContract?.embeddingModelContract)) {
    fail('Report embedding contract differs from the frozen source snapshot');
  }
  const docs = source.value.scopeContract?.documents;
  const resolvedIds = source.value.scopeContract?.resolvedDocumentIds;
  const contracts = source.value.profileContract?.indexContracts;
  if (!Array.isArray(docs) || docs.length !== 40 || !Array.isArray(resolvedIds) || resolvedIds.length !== 40
      || new Set(resolvedIds).size !== 40 || !Array.isArray(contracts) || contracts.length !== 40) fail('Audit requires exactly 40 authorized scope documents and published index contracts');
  const docIds = new Set(docs.map(document => document.id));
  if (docIds.size !== 40 || resolvedIds.some(id => !docIds.has(id)) || contracts.some(row => !docIds.has(row.documentId))) fail('Scope and published index contracts do not cover the same 40 documents');
  const profileById = new Map(contracts.map(row => [row.documentId, row]));
  for (const document of docs) {
    const profileIndexed = profileById.get(document.id)?.indexedSource;
    if (!profileIndexed || canonicalResearchJson(profileIndexed) !== canonicalResearchJson(document.indexedSource)) fail('Scope and profile published source identities differ');
  }
  const sourceTraceKeys = uniqueSorted((source.value.cases ?? []).flatMap(row => (row.retrievalTraces ?? [])
    .filter(trace => trace.type === 'documentary-retrieval').flatMap(trace => trace.vectorKeys ?? [])));
  const reportTraceKeys = uniqueSorted((report.value.retrievalContractAudit?.checks ?? []).flatMap(row => row.traceVectorKeys ?? []));
  if (sourceTraceKeys.length !== 40 || reportTraceKeys.length !== 40
      || canonicalResearchJson(sourceTraceKeys) !== canonicalResearchJson(reportTraceKeys)) fail('Frozen source/report must agree on exactly 40 semantic retrieval keys');
  const lexicalKeys = uniqueSorted(contracts.flatMap(row => row.indexedSource?.indexKeys ?? []));
  if (lexicalKeys.length < 40) fail('Published lexical index keys are incomplete');
  if (source.value.profileContract.dimensions !== 512 || !source.value.profileContract.embeddingModelContract) fail('Expected full Q8-512 embedding contract is missing');
  const dbPath = path.join(root, 'profile/documentary/store.sqlite');
  const dbStat = fs.lstatSync(dbPath);
  if (!dbStat.isFile() || dbStat.isSymbolicLink() || fs.realpathSync(dbPath) !== dbPath) fail('QA documentary store must be a canonical regular file');
  return { root, artifacts, markerFile, source, report, dbPath, dbBytes: dbStat.size,
    lexicalKeys, vectorKeys: sourceTraceKeys, profileById, scopeDocuments: docs };
}

function assertNoLiveProfileLock(root) {
  const lock = path.join(root, 'profile/isolated-instance.lock');
  if (!fs.existsSync(lock)) return { path: lock, exists: false, live: false };
  regularCanonical(lock, 'Isolated profile lock');
  const raw = fs.readFileSync(lock, 'utf8').trim();
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid < 2) fail('Invalid QA profile lock PID');
  try { process.kill(pid, 0); fail('QA Electron profile is still live'); }
  catch (error) { if (error.message === 'QA Electron profile is still live') throw error; if (error.code !== 'ESRCH') throw error; }
  return { path: lock, exists: true, live: false, pid };
}

function requireClosedStore(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fail(`Refusing SQLite snapshot while sidecar exists: ${path.basename(sidecar)}`);
  }
}

function ensureEmptyProviderKeys(artifacts) {
  const file = path.join(artifacts, 'empty-provider-keys.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}\n', { flag: 'wx', mode: 0o600 });
  regularCanonical(file, 'Empty provider keys file', artifacts);
  const bytes = fs.readFileSync(file);
  if (bytes.toString('utf8') !== '{}\n' || Object.keys(JSON.parse(bytes.toString('utf8'))).length !== 0) fail('Provider key fixture must be the literal empty object');
  return { path: file, sha256: sha(bytes), bytes: bytes.length };
}

function createRunName() {
  const timestamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '').replace('T', 'T').replace('Z', 'Z');
  return `semantic-identity-audit-${timestamp}-${randomUUID()}`;
}

function runChild(input, runName, keysProof) {
  const sourceBefore = sha(fs.readFileSync(input.source.path));
  const reportBefore = sha(fs.readFileSync(input.report.path));
  const dbBefore = sha(fs.readFileSync(input.dbPath));
  const runDbPath = path.join(input.artifacts, `${runName}.sqlite`);
  const receiptPath = path.join(input.artifacts, `${runName}.json`);
  fs.copyFileSync(input.dbPath, runDbPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(runDbPath, 0o400);
  const snapshotHash = sha(fs.readFileSync(runDbPath));
  if (snapshotHash !== dbBefore || sha(fs.readFileSync(input.dbPath)) !== dbBefore) fail('Closed store changed while making byte-exact snapshot');
  const lockProof = assertNoLiveProfileLock(input.root);
  requireClosedStore(input.dbPath);
  const electronPath = require('electron');
  const policy = macResearchSandbox(input.root);
  const sandboxProof = verifyResearchSandbox(input.root, policy);
  const childEnv = { ...researchTestEnvironment(input.root), ELECTRON_RUN_AS_NODE: '1', SQLITE_USE_URI: '1', HOME: path.join(input.root, 'profile/home'),
    NODUS_HARNESS_KEYS_FILE: keysProof.path, NO_EXTERNAL_SERVICES: '1', NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
  const child = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, electronPath, scriptPath, '--child', `--root=${input.root}`,
    `--source=${input.source.path}`, `--report=${input.report.path}`, `--snapshot=${runDbPath}`, `--receipt=${receiptPath}`,
    `--source-sha256=${input.source.sha256}`, `--report-sha256=${input.report.sha256}`, `--db-sha256=${dbBefore}`],
  { cwd: repoRoot, env: childEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  if (child.error || ![0, 2].includes(child.status) || !fs.existsSync(receiptPath)) {
    fail(`Sandboxed Electron-as-Node audit failed (exit ${child.status ?? 'signal'}): ${(child.stderr || child.error?.message || '').slice(-2000)}`);
  }
  const receipt = safeJson(receiptPath, 'Generated receipt', input.artifacts);
  if (receipt.value.format !== SEMANTIC_IDENTITY_RECEIPT_FORMAT) fail('Child output used an unsupported receipt format');
  if ((child.status === 0) !== (receipt.value.status === 'verified')) fail('Audit process exit status disagrees with generated receipt status');
  validateIndexAuthorization({ sourceSnapshot: input.source.value, receipt: receipt.value,
    expectedSourceSha256: input.source.sha256, expectedReportSha256: input.report.sha256 });
  if (sha(fs.readFileSync(input.source.path)) !== sourceBefore || sourceBefore !== input.source.sha256
      || sha(fs.readFileSync(input.report.path)) !== reportBefore || reportBefore !== input.report.sha256
      || sha(fs.readFileSync(input.dbPath)) !== dbBefore || dbBefore !== input.dbSha256
      || sha(fs.readFileSync(runDbPath)) !== snapshotHash || snapshotHash !== receipt.value.evidence.sqliteSnapshotSha256) fail('Frozen inputs or snapshot changed during audit');
  return { status: receipt.value.status, receiptPath, receiptSha256: receipt.sha256, snapshotPath: runDbPath, snapshotSha256: snapshotHash,
    pairCount: receipt.value.summary.pairCount, mismatches: receipt.value.mismatches.length,
    runtime: receipt.value.evidence.runtime, sandboxProof, lockProof };
}

async function electronChild() {
  const root = path.resolve(arg('root'));
  const artifacts = path.join(root, 'artifacts');
  const sourcePath = regularCanonical(arg('source'), 'Source snapshot', artifacts);
  const reportPath = regularCanonical(arg('report'), 'Campaign report', artifacts);
  const snapshotPath = regularCanonical(arg('snapshot'), 'SQLite snapshot', artifacts);
  const receiptPath = path.resolve(arg('receipt'));
  if (path.dirname(receiptPath) !== artifacts || fs.existsSync(receiptPath)) fail('Receipt output must be a new path inside QA artifacts');
  const input = validateAuditInputs({ root, source: path.basename(sourcePath), report: path.basename(reportPath) });
  const sourceHash = sha(fs.readFileSync(sourcePath));
  const reportHash = sha(fs.readFileSync(reportPath));
  const dbHash = sha(fs.readFileSync(input.dbPath));
  if (sourceHash !== arg('source-sha256') || reportHash !== arg('report-sha256') || dbHash !== arg('db-sha256')) fail('Frozen input hash changed before child query');
  if (sha(fs.readFileSync(snapshotPath)) !== dbHash) fail('Immutable database snapshot is not byte-identical to closed store');
  const snapshotStat = fs.lstatSync(snapshotPath);
  if ((snapshotStat.mode & 0o222) !== 0) fail('Database snapshot is not immutable');
  requireClosedStore(input.dbPath);

  const { installRuntimeHooks } = await import(pathToFileURL(path.join(repoRoot, 'scripts/lib/tsRuntimeHooks.mjs')).href);
  const runtimeStub = installRuntimeHooks(path.join(root, 'profile'));
  if (runtimeStub.safeStorage.isEncryptionAvailable() !== false) fail('Runtime hook must force SafeStorage unavailable');
  const keyFile = process.env.NODUS_HARNESS_KEYS_FILE;
  if (!keyFile || path.dirname(path.resolve(keyFile)) !== artifacts || fs.readFileSync(keyFile, 'utf8') !== '{}\n') fail('Runtime must use literal empty provider keys');
  const { documentaryIndexKey } = require(path.join(repoRoot, 'electron/ai/researchCorpusScope.ts'));
  if (typeof documentaryIndexKey !== 'function') fail('Production documentaryIndexKey unavailable');
  const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
  const snapshotUri = pathToFileURL(snapshotPath);
  snapshotUri.searchParams.set('mode', 'ro');
  snapshotUri.searchParams.set('immutable', '1');
  const db = new Database(snapshotUri.href, { readonly: true, fileMustExist: true });
  const mismatches = [];
  const pairs = [];
  let vectorStats;
  const expectedContract = input.source.value.profileContract.embeddingModelContract;
  try {
    db.pragma('query_only = ON');
    const allKeys = uniqueSorted([...input.lexicalKeys, ...input.vectorKeys]);
    const revisionRows = db.prepare(`SELECT index_key,document_id,identity_json,lexical_ready,embedding_ready
      FROM documentary_revisions WHERE index_key IN (SELECT value FROM json_each(?))`).all(JSON.stringify(allKeys));
    const byKey = new Map(revisionRows.map(row => [row.index_key, { ...row, identity: JSON.parse(row.identity_json) }]));
    vectorStats = db.prepare(`SELECT index_key,COUNT(*) AS passage_count,
      SUM(CASE WHEN vector IS NOT NULL THEN 1 ELSE 0 END) AS vector_count,
      SUM(CASE WHEN vector_json IS NOT NULL THEN 1 ELSE 0 END) AS legacy_json_count,
      MIN(length(vector)) AS min_vector_bytes,MAX(length(vector)) AS max_vector_bytes,
      SUM(length(vector)) AS total_vector_bytes
      FROM documentary_passages WHERE index_key IN (SELECT value FROM json_each(?)) GROUP BY index_key`)
      .all(JSON.stringify(input.vectorKeys));
    const statsByKey = new Map(vectorStats.map(row => [row.index_key, row]));
    const source = input.source.value;
    const report = input.report.value;
    const scopeById = new Map(source.scopeContract.documents.map(row => [row.id, row]));
    for (const vectorKey of input.vectorKeys) {
      const vectorRow = byKey.get(vectorKey);
      if (!vectorRow) { mismatches.push({ kind: 'vector-key-absent-from-store' }); continue; }
      const vectorIdentity = vectorRow.identity;
      const documentId = vectorIdentity.documentId;
      const scopeDocument = scopeById.get(documentId);
      const published = input.profileById.get(documentId)?.indexedSource;
      if (!scopeDocument || !published) { mismatches.push({ kind: 'document-not-in-authorized-scope' }); continue; }
      const lexicalRow = (published.indexKeys ?? []).map(key => byKey.get(key)).find(row => row?.identity?.embedding === null);
      if (!lexicalRow) { mismatches.push({ kind: 'published-lexical-key-absent-from-store' }); continue; }
      const lexicalKey = lexicalRow.index_key;
      const lexicalIdentity = lexicalRow.identity;
      const { embedding: _vectorEmbedding, ...vectorBase } = vectorIdentity;
      const { embedding: _lexicalEmbedding, ...lexicalBase } = lexicalIdentity;
      const sourceIdentityMatch = canonicalResearchJson(vectorBase) === canonicalResearchJson(lexicalBase);
      const vectorFingerprintMatch = documentaryIndexKey(vectorIdentity) === vectorKey;
      const lexicalFingerprintMatch = documentaryIndexKey(lexicalIdentity) === lexicalKey;
      const parameters = vectorIdentity.embedding?.parameters;
      const rawContract = parameters?.contract;
      let parsedContract = null;
      try { parsedContract = typeof rawContract === 'string' ? JSON.parse(rawContract) : rawContract; }
      catch { mismatches.push({ kind: 'unparseable-contract' }); }
      const contractMatch = vectorIdentity.embedding?.provider === report.embeddingContract.provider
        && vectorIdentity.embedding?.model === report.embeddingContract.profileId
        && vectorIdentity.embedding?.dimensions === report.embeddingContract.dimensions
        && vectorIdentity.embedding?.metric === 'cosine'
        && canonicalResearchJson(parsedContract) === canonicalResearchJson(expectedContract)
        && /^[a-f0-9]{64}$/u.test(parameters?.endpoint ?? '')
        && parameters?.inputPolicy === 'utf8-4096/2'
        && Number.isInteger(vectorIdentity.embedding.dimensions) && vectorIdentity.embedding.dimensions === 512;
      const state = { lexicalReady: lexicalRow.lexical_ready, lexicalEmbeddingReady: lexicalRow.embedding_ready,
        vectorLexicalReady: vectorRow.lexical_ready, vectorEmbeddingReady: vectorRow.embedding_ready,
        lexicalIdentityHasNullEmbedding: lexicalIdentity.embedding === null, sourceIdentityMatch,
        productionFingerprintsMatch: vectorFingerprintMatch && lexicalFingerprintMatch, embeddingContractMatch: contractMatch };
      const stats = statsByKey.get(vectorKey);
      const dimensionBytes = vectorIdentity.embedding?.dimensions * 4;
      const vectorShapeMatch = Boolean(stats && stats.passage_count > 0 && stats.vector_count === stats.passage_count
        && stats.legacy_json_count === 0 && stats.min_vector_bytes === dimensionBytes && stats.max_vector_bytes === dimensionBytes);
      const ready = state.lexicalReady === 1 && state.lexicalEmbeddingReady === 0
        && state.vectorLexicalReady === 1 && state.vectorEmbeddingReady === 1 && state.lexicalIdentityHasNullEmbedding;
      if (!sourceIdentityMatch) mismatches.push({ kind: 'source-identity-mismatch' });
      if (!vectorFingerprintMatch || !lexicalFingerprintMatch) mismatches.push({ kind: 'production-index-fingerprint-mismatch' });
      if (!contractMatch) mismatches.push({ kind: 'embedding-contract-mismatch' });
      if (!ready) mismatches.push({ kind: 'readiness-mismatch' });
      if (!vectorShapeMatch) mismatches.push({ kind: 'vector-count-or-width-mismatch' });
      if (vectorIdentity.revision !== published.revision || vectorIdentity.attachmentId !== published.attachmentId) mismatches.push({ kind: 'published-source-revision-or-attachment-mismatch' });
      pairs.push({ documentId, lexicalKey, vectorKey,
        lexicalIdentity, lexicalIdentityFingerprint: documentaryIndexKey(lexicalIdentity),
        vectorIdentity, vectorIdentityFingerprint: documentaryIndexKey(vectorIdentity),
        vectorParameters: { raw: parameters, parsedContract }, state,
        vectorStats: stats ? { passageCount: stats.passage_count, vectorCount: stats.vector_count,
          legacyJsonCount: stats.legacy_json_count, minVectorBytes: stats.min_vector_bytes,
          maxVectorBytes: stats.max_vector_bytes, totalVectorBytes: stats.total_vector_bytes } : null });
    }
    const lexicalReady = input.lexicalKeys.map(key => byKey.get(key)).filter(row => row?.identity?.embedding === null);
    if (lexicalReady.length !== 40 || lexicalReady.some(row => row.lexical_ready !== 1 || row.embedding_ready !== 0)) mismatches.push({ kind: 'lexical-readiness-mismatch' });
  } finally { db.close(); }

  const sourceAfter = sha(fs.readFileSync(sourcePath));
  const reportAfter = sha(fs.readFileSync(reportPath));
  const dbAfter = sha(fs.readFileSync(input.dbPath));
  const snapshotAfter = sha(fs.readFileSync(snapshotPath));
  if (sourceAfter !== sourceHash || reportAfter !== reportHash || dbAfter !== dbHash || snapshotAfter !== dbHash) fail('Frozen source, report, original store, or snapshot changed during query');
  const fingerprintPath = path.join(repoRoot, 'electron/ai/researchCorpusScope.ts');
  const fingerprintHash = sha(fs.readFileSync(fingerprintPath));
  const summary = { scopeDocumentCount: input.scopeDocuments.length, lexicalKeyCount: input.lexicalKeys.length,
    traceVectorKeyCount: input.vectorKeys.length, literalKeyIntersection: input.lexicalKeys.filter(key => input.vectorKeys.includes(key)).length,
    pairCount: pairs.length, sourceIdentitiesMatchAll: pairs.length === 40 && pairs.every(pair => pair.state.sourceIdentityMatch),
    productionFingerprintsMatchAll: pairs.length === 40 && pairs.every(pair => pair.state.productionFingerprintsMatch),
    contractMatchAll: pairs.length === 40 && pairs.every(pair => pair.state.embeddingContractMatch),
    embeddedReadyAll: pairs.length === 40 && pairs.every(pair => pair.state.vectorLexicalReady === 1 && pair.state.vectorEmbeddingReady === 1),
    vectorCountsAndWidthsCorrectAll: pairs.length === 40 && pairs.every(pair => pair.vectorStats
      && pair.vectorStats.vectorCount === pair.vectorStats.passageCount && pair.vectorStats.minVectorBytes === 2048 && pair.vectorStats.maxVectorBytes === 2048),
    lexicalRows: pairs.filter(pair => pair.lexicalIdentity.embedding === null).length,
    noPassageTextRead: true, noVectorContentRead: true };
  const receipt = { format: SEMANTIC_IDENTITY_RECEIPT_FORMAT, createdAt: new Date().toISOString(), status: mismatches.length ? 'mismatch' : 'verified',
    evidence: { reportPath, reportSha256: reportHash, sourceSnapshotPath: sourcePath, sourceSnapshotSha256: sourceHash,
      sqlitePath: input.dbPath, sqliteSha256: dbHash, sqliteSnapshotPath: snapshotPath, sqliteSnapshotSha256: snapshotAfter,
      sqliteSnapshotCopiedByteExact: snapshotAfter === dbHash, fingerprintSourcePath: 'electron/ai/researchCorpusScope.ts',
      fingerprintSourceSha256: fingerprintHash, productionFingerprintFunction: 'documentaryIndexKey(identity) from current electron/ai/researchCorpusScope.ts',
      runtime: { nodeVersion: process.version, electronVersion: process.versions.electron ?? null,
        platform: process.platform, architecture: process.arch, execution: 'Electron-as-Node with TSRuntimeHooks stub' },
      sqliteOpenedReadonly: true, sqliteQueryOnly: true, queriedColumnsExcludeTextAndVectorBytes: true,
      sourceHashStableBeforeAfter: sourceAfter === sourceHash, reportHashStableBeforeAfter: reportAfter === reportHash,
      sqliteHashStableBeforeAfter: dbAfter === dbHash, snapshotHashStableBeforeAfter: snapshotAfter === dbHash,
      literalEmptyProviderKeysSha256: sha(fs.readFileSync(process.env.NODUS_HARNESS_KEYS_FILE)) },
    contract: { profileId: input.source.value.profileId, provider: input.source.value.profileContract.provider,
      model: expectedContract.model, dimensions: input.source.value.profileContract.dimensions, metric: 'cosine', fullEmbeddingContract: expectedContract },
    summary, mismatches, pairs,
    conclusion: mismatches.length === 0 && pairs.length === 40
      ? 'The 40 retrieval vector keys are source-authorized semantic variants of their published lexical keys; the source identity is equal and only embedding identity is populated.'
      : 'Metadata mismatch found; inspect mismatch categories and the complete identity metadata for affected pairs.' };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ receiptPath, receiptSha256: sha(fs.readFileSync(receiptPath)), summary,
    mismatchCount: mismatches.length, runtime: receipt.evidence.runtime }) + '\n');
  if (mismatches.length) process.exitCode = 2;
}

const isMainScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainScript && has('child')) {
  electronChild().catch(error => { process.stderr.write(`${error?.message ?? String(error)}\n`); process.exitCode = 2; });
} else if (isMainScript) {
  try {
    if (has('help')) { process.stdout.write('Usage: research-live-semantic-identity-audit.mjs --root=QA --source=case-sources.json --report=report.json [--run]\n'); }
    else {
      const input = validateAuditInputs({ root: arg('root'), source: arg('source'), report: arg('report') });
      const lock = has('run') ? assertNoLiveProfileLock(input.root) : { checked: false };
      const sidecars = has('run') ? (requireClosedStore(input.dbPath), true) : null;
      if (!has('run')) process.stdout.write(JSON.stringify({ format: 'nodus.research-live-semantic-identity-audit-preflight/1', status: 'ready',
        root: input.root, sourcePath: input.source.path, sourceSha256: input.source.sha256, reportPath: input.report.path,
        reportSha256: input.report.sha256, dbPath: input.dbPath, databaseSizeBytes: input.dbBytes,
        scopeDocumentCount: input.scopeDocuments.length, lexicalKeyCount: input.lexicalKeys.length, traceVectorKeyCount: input.vectorKeys.length,
        databaseOpened: false, filesWritten: false }) + '\n');
      else {
        const keys = ensureEmptyProviderKeys(input.artifacts);
        const name = createRunName();
        const dbHash = sha(fs.readFileSync(input.dbPath));
        const outcome = runChild({ ...input, dbSha256: dbHash }, name, keys);
        process.stdout.write(JSON.stringify({ format: 'nodus.research-live-semantic-identity-audit/1', status: outcome.mismatches ? 'mismatch' : 'verified',
          root: input.root, ...outcome, keysFileSha256: keys.sha256, profileLock: lock, noWalOrShm: sidecars }) + '\n');
        if (outcome.mismatches) process.exitCode = 2;
      }
    }
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
