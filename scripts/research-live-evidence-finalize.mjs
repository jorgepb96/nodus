#!/usr/bin/env node
/** Offline integrity finalizer for a completed, isolated research evidence campaign.
 * Reads QA artifacts and frozen repository snapshots only; never opens Electron or a model. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonSha = value => sha256(JSON.stringify(value));
const readRegular = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) throw new Error(`Expected canonical regular file: ${file}`);
  return fs.readFileSync(file);
};
const parseJson = file => JSON.parse(readRegular(file).toString('utf8'));
function assertMarkedRoot(rootInput) {
  const root = fs.realpathSync(rootInput);
  if (root === path.parse(root).root) throw new Error('Refusing filesystem root');
  const markerPath = path.join(root, 'isolation.json');
  const marker = parseJson(markerPath);
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== root) throw new Error('Root is not the canonical marked isolated research profile');
  return root;
}
function verifySnapshotMap(map, repoRoot, label) {
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length) throw new Error(`Missing ${label} hash map`);
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  for (const [relative, expected] of entries) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/u).some(part => !part || part === '.' || part === '..')) {
      throw new Error(`${label} contains unsafe path: ${relative}`);
    }
    const file = path.join(repoRoot, relative);
    if (!file.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`${label} path escapes repository: ${relative}`);
    if (expected === null) {
      if (fs.existsSync(file)) throw new Error(`${label} expected missing file now exists: ${relative}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/u.test(expected)) throw new Error(`${label} has invalid digest for ${relative}`);
    const bytes = readRegular(file);
    if (sha256(bytes) !== expected) throw new Error(`${label} changed since campaign: ${relative}`);
  }
  return { files: entries.length, sha256: jsonSha(Object.fromEntries(entries)) };
}
function verifyCaseRows(source, prereg, progress) {
  const rows = source.cases;
  const queries = prereg.queries;
  if (!Array.isArray(rows) || rows.length !== 80 || !Array.isArray(queries) || queries.length !== 80) throw new Error('Expected exactly 80 source cases and preregistered queries');
  if (source.profileRoot !== progress.campaignRoot || source.profileId !== progress.profileId) throw new Error('Case source profile does not match progress report');
  if (source.profileContractSha256 !== progress.profileContractSha256 || source.scopeContractSha256 !== progress.scopeContractSha256
      || jsonSha(source.profileContract) !== source.profileContractSha256 || jsonSha(source.scopeContract) !== source.scopeContractSha256
      || jsonSha(progress.embeddingContract) !== progress.profileContractSha256 || jsonSha(progress.scopeContract) !== progress.scopeContractSha256) {
    throw new Error('Profile or scope contract binding mismatch');
  }
  const expectedIds = queries.map(row => row.id);
  if (new Set(expectedIds).size !== 80 || new Set(rows.map(row => row.id)).size !== 80) throw new Error('Duplicate case IDs');
  if (JSON.stringify(rows.map(row => row.id)) !== JSON.stringify(expectedIds)) throw new Error('Case IDs/order differ from preregistration');
  let citationCaptured = 0, citationResolved = 0, traceCount = 0, scopeLeakCount = 0, unresolvedCaseCount = 0;
  let semanticCases = 0, lexicalFallbackCases = 0, searchErrorCases = 0;
  const traceStatuses = {};
  const caseDigests = [];
  const byId = new Map(queries.map(row => [row.id, row]));
  for (const row of rows) {
    const query = byId.get(row.id);
    if (!query || row.question !== query.question || row.language !== query.language || row.isAnswerable !== query.isAnswerable
        || row.cohortKind !== query.kind) throw new Error(`Question identity/answerability mismatch for ${row.id}`);
    if (typeof row.sourceContext !== 'string' || sha256(row.sourceContext) !== row.sourceContextSha256
        || !row.sourcesContext || sha256(JSON.stringify(row.sourcesContext)) !== row.sourcesContextSha256) throw new Error(`Individual source context hash mismatch for ${row.id}`);
    const expectedCaseHash = jsonSha({ caseId: row.id, question: row.question, language: row.language, isAnswerable: row.isAnswerable,
      sourceContextSha256: row.sourceContextSha256, sourcesContextSha256: row.sourcesContextSha256,
      profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256 });
    if (row.caseSourceSnapshotSha256 !== expectedCaseHash) throw new Error(`Case snapshot hash mismatch for ${row.id}`);
    caseDigests.push({ id: row.id, caseSourceSnapshotSha256: expectedCaseHash });
    const citations = row.citationResolution;
    if (!citations || !Array.isArray(citations.attemptedIds) || !Array.isArray(citations.resolvedIds) || !Array.isArray(citations.unresolvedIds)
        || citations.attempted !== citations.attemptedIds.length || citations.resolved !== citations.resolvedIds.length
        || citations.unresolved !== citations.unresolvedIds.length || citations.attempted !== citations.resolved + citations.unresolved) {
      throw new Error(`Citation accounting mismatch for ${row.id}`);
    }
    const attemptedSet = new Set(citations.attemptedIds), resolvedSet = new Set(citations.resolvedIds), unresolvedSet = new Set(citations.unresolvedIds);
    if (attemptedSet.size !== citations.attempted || resolvedSet.size !== citations.resolved || unresolvedSet.size !== citations.unresolved
        || citations.attemptedIds.some(id => !resolvedSet.has(id) && !unresolvedSet.has(id))
        || citations.resolvedIds.some(id => !attemptedSet.has(id)) || citations.unresolvedIds.some(id => !attemptedSet.has(id))) throw new Error(`Citation IDs do not partition captured IDs for ${row.id}`);
    if (!Array.isArray(row.sourceEvidence) || row.sourceEvidence.length !== citations.attempted
        || row.sourceEvidence.some((evidence, index) => evidence.citationId !== citations.attemptedIds[index])) throw new Error(`Citation evidence binding mismatch for ${row.id}`);
    citationCaptured += citations.attempted; citationResolved += citations.resolved;
    if (citations.unresolved) unresolvedCaseCount++;
    if (!Array.isArray(row.retrievalTraces)) throw new Error(`Missing retrieval trace list for ${row.id}`);
    traceCount += row.retrievalTraces.length;
    for (const trace of row.retrievalContractAudit ?? []) traceStatuses[trace.status ?? 'unknown'] = (traceStatuses[trace.status ?? 'unknown'] ?? 0) + 1;
    scopeLeakCount += Array.isArray(row.scopeLeaks) ? row.scopeLeaks.length : 0;
    semanticCases += Number(row.semanticParticipated === true);
    lexicalFallbackCases += Number(row.lexicalFallback === true);
    searchErrorCases += Number(Boolean(row.searchError));
  }
  const overall = jsonSha(caseDigests);
  if (source.caseSourceSnapshotSha256 !== overall) throw new Error('Overall case-source snapshot hash mismatch');
  if (progress.caseSourceSnapshotSha256 !== undefined && progress.caseSourceSnapshotSha256 !== overall) throw new Error('Progress overall case-source snapshot hash mismatch');
  const answerable = rows.filter(row => row.isAnswerable).length;
  const insufficient = rows.length - answerable;
  if (prereg.counts?.answerable !== answerable || prereg.counts?.insufficient !== insufficient) throw new Error('Preregistered answerability totals mismatch');
  return { cases: rows.length, answerable, insufficient, overallCaseSourceSnapshotSha256: overall,
    citationResolution: { captured: citationCaptured, resolved: citationResolved, unresolved: citationCaptured - citationResolved,
      rate: citationCaptured ? citationResolved / citationCaptured : null }, retrievalTraceCount: traceCount,
    retrievalContractAuditStatuses: traceStatuses, semanticCases, lexicalFallbackCases, scopeLeakCount, searchErrorCases, unresolvedCitationCases: unresolvedCaseCount };
}

function identityMap(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 40) throw new Error(`${label} must contain exactly 40 source identities`);
  const map = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id || !/^[a-f0-9]{64}$/u.test(row.sha256 ?? '') || map.has(row.id)) {
      throw new Error(`${label} contains a missing, duplicate, or malformed source identity`);
    }
    map.set(row.id, row.sha256);
  }
  return map;
}
function verifySourceInventory(progress, prereg, manifest, source) {
  const expected = identityMap(prereg.sourceDocuments, 'Preregistered source documents');
  const compare = (rows, label) => {
    const found = identityMap(rows, label);
    if (found.size !== expected.size || [...expected].some(([id, hash]) => found.get(id) !== hash)) throw new Error(`${label} source IDs/SHA-256 set mismatch`);
  };
  compare(manifest.documents, 'Source manifest');
  compare(progress.importedDocuments, 'Imported library documents');
  compare(source.corpusSourceHashes, 'Case-source corpus inventory');
  const libraryIds = progress.importedDocuments.map(row => row.libraryItemId);
  if (libraryIds.some(id => typeof id !== 'string' || !id) || new Set(libraryIds).size !== 40) throw new Error('Imported library item IDs are missing or duplicated');
  const extractionIds = progress.extraction.map(row => row.itemId);
  if (new Set(extractionIds).size !== 40 || extractionIds.length !== 40 || libraryIds.some(id => !extractionIds.includes(id))) throw new Error('Extraction inventory does not match imported library item IDs');
  const prepIds = progress.preparation.map(row => row.id);
  if (new Set(prepIds).size !== 40 || prepIds.length !== 40 || libraryIds.some(id => !prepIds.includes(id))) throw new Error('Preparation inventory does not match imported library item IDs');
  for (const row of progress.preparation) {
    const prep = row.preparation;
    if (prep?.status !== 'ready' || prep.lexical !== 'ready' || prep.embeddings !== 'ready'
        || !Number.isSafeInteger(prep.passages) || prep.passages <= 0 || prep.embedded !== prep.passages) {
      throw new Error(`Preparation is not fully lexical- and embedding-ready for library item ${row.id}`);
    }
  }
  return { sourceDocuments: 40, importedLibraryItems: 40, extractedLibraryItems: 40,
    fullyPreparedLibraryItems: 40, sourceInventorySha256: jsonSha([...expected].sort(([a], [b]) => a.localeCompare(b))) };
}
function verifyKnownCoordinatorFailure(errorBytes) {
  const text = errorBytes.toString('utf8');
  if (!text.includes("TypeError: Cannot read properties of undefined (reading '_object')")
      || !text.includes('toImpl') || !text.includes('ElectronApplication2.process')
      || !text.includes('scripts/research-live-evidence-campaign.mjs:760')) {
    throw new Error('Coordinator log does not match the reviewed Playwright ElectronApplication.process reporting failure');
  }
}

export function finalizeResearchEvidenceCampaign({ root: rootInput, repoRoot: repoRootInput, outputPath: outputPathInput } = {}) {
  if (!rootInput || !repoRootInput) throw new Error('root and repoRoot are required');
  const root = assertMarkedRoot(rootInput), repoRoot = fs.realpathSync(repoRootInput);
  const artifacts = path.join(root, 'artifacts');
  const progressPath = path.join(artifacts, 'progress.json');
  const sourcePath = path.join(artifacts, 'case-sources.json');
  const preregPath = path.join(artifacts, 'preregistration.json');
  const manifestPath = path.join(artifacts, 'source-manifest.json');
  const eventsPath = path.join(artifacts, 'electron-process-events.jsonl');
  const errorPath = path.join(artifacts, 'coordinator-terminal-error.log');
  const outputPath = outputPathInput ? path.resolve(outputPathInput) : path.join(artifacts, 'campaign-posthoc-finalized-002.json');
  if (path.dirname(outputPath) !== artifacts) throw new Error('Output must be directly inside the marked QA artifacts directory');
  if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);
  const progressBytes = readRegular(progressPath), sourceBytes = readRegular(sourcePath), preregBytes = readRegular(preregPath), manifestBytes = readRegular(manifestPath);
  const eventsBytes = readRegular(eventsPath), errorBytes = readRegular(errorPath);
  const progress = JSON.parse(progressBytes), source = JSON.parse(sourceBytes), prereg = JSON.parse(preregBytes), manifest = JSON.parse(manifestBytes);
  if (progress.campaignRoot !== root || progress.profileId !== source.profileId || progress.modelCalls !== 0 || progress.retrievalCompleted !== 80) throw new Error('Progress report is not a completed no-generation 80-case run');
  if (manifest.documents?.length !== 40 || progress.importedDocuments?.length !== 40 || progress.extraction?.length !== 40 || progress.preparation?.length !== 40) throw new Error('Expected exactly 40 imported/extracted/prepared source documents');
  if (progress.extraction.some(row => row.status !== 'done')) throw new Error('Not all source documents completed extraction');
  const inventory = verifySourceInventory(progress, prereg, manifest, source);
  const preparationStatuses = {};
  for (const row of progress.preparation) {
    const status = row.preparation?.status ?? 'unknown'; preparationStatuses[status] = (preparationStatuses[status] ?? 0) + 1;
  }
  if (preparationStatuses.ready !== 40) throw new Error('All 40 documents must be fully prepared');
  if (prereg.format !== 'nodus.research-live-evidence-preregistration/1' || prereg.counts?.total !== 80 || prereg.annotationGold == null) throw new Error('Invalid preregistration');
  if (source.format !== 'nodus.research-case-sources/1') throw new Error('Unexpected case source format');
  const sourceSnapshot = verifySnapshotMap(progress.sourceVersionBefore, repoRoot, 'sourceVersionBefore');
  const buildSnapshot = verifySnapshotMap(progress.buildArtifactsBefore, repoRoot, 'buildArtifactsBefore');
  const caseSummary = verifyCaseRows(source, prereg, progress);
  verifyKnownCoordinatorFailure(errorBytes);
  const contractChecks = source.cases.flatMap(row => (row.retrievalContractAudit ?? []).map(check => ({ caseId: row.id, ...check })));
  if (!contractChecks.length) throw new Error('No saved per-trace retrieval contract checks are available');
  const contractStatuses = {};
  for (const check of contractChecks) {
    const status = check.status ?? 'unknown';
    (contractStatuses[status] ??= []).push(check);
  }
  const retrievalContractAudit = { expectedContractSha256: progress.embeddingContract?.embeddingModelContract
    ? jsonSha(progress.embeddingContract.embeddingModelContract) : null,
  traces: contractChecks.length, verified: contractStatuses.verified?.length ?? 0, mismatches: contractStatuses.mismatch?.length ?? 0,
  incomplete: contractStatuses['incomplete-trace']?.length ?? 0,
  pendingFullIdentityAudit: contractStatuses['pending-index-identity-audit']?.length ?? 0, checks: contractChecks };
  const events = eventsBytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const close = events.filter(event => event.event === 'child-close' && event.pid === progress.electronPid);
  if (!close.length || close.at(-1).code !== 0 || close.at(-1).signal !== null) throw new Error('Could not verify normal Electron child exit');
  const output = {
    format: 'nodus.research-live-evidence-posthoc-finalization/1',
    finalizedAt: new Date().toISOString(),
    campaignRoot: root,
    profileId: progress.profileId,
    embeddingContract: progress.embeddingContract,
    profileContractSha256: progress.profileContractSha256,
    scopeContractSha256: progress.scopeContractSha256,
    caseSourceSnapshotSha256: caseSummary.overallCaseSourceSnapshotSha256,
    retrievalContractAudit,
    campaign: { root, profileId: progress.profileId, statusAtLastProgressWrite: progress.status,
      modelCalls: progress.modelCalls, retrievalCompleted: progress.retrievalCompleted, preparationStatuses,
      profileContractSha256: progress.profileContractSha256, scopeContractSha256: progress.scopeContractSha256,
      caseSourceSnapshotSha256: caseSummary.overallCaseSourceSnapshotSha256,
      embeddingContract: progress.embeddingContract, profileContract: source.profileContract, scopeContract: source.scopeContract },
    verification: { markedRoot: true, sourceInventoryDocuments: manifest.documents.length, preregisteredQueries: prereg.queries.length,
      sourceInventory: inventory,
      sourceContextHashesVerified: true, caseSnapshotHashesVerified: true, allQuestionsAndAnswerabilityMatchPreregistration: true,
      progressCaseSourceSnapshotSha256Present: progress.caseSourceSnapshotSha256 !== undefined,
      progressCaseSourceSnapshotSha256: progress.caseSourceSnapshotSha256 ?? null,
      sourceAndScopeContractsMatchProgress: true, sourceVersionBefore: { ...sourceSnapshot, matchesCurrentRepository: true },
      buildArtifactsBefore: { ...buildSnapshot, matchesCurrentRepository: true }, ...caseSummary },
    provenance: {
      sourceManifest: { path: manifestPath, sha256: sha256(manifestBytes) }, preregistration: { path: preregPath, sha256: sha256(preregBytes) },
      progress: { path: progressPath, sha256: sha256(progressBytes) }, caseSources: { path: sourcePath, sha256: sha256(sourceBytes) },
      electronEvents: { path: eventsPath, sha256: sha256(eventsBytes) }, coordinatorErrorLog: { path: errorPath, sha256: sha256(errorBytes) },
    },
    termination: { reportingFailure: true, coordinatorExitCode: 1, coordinatorFailureKind: 'playwright-electron-process-wrapper-unavailable-after-close', coordinatorErrorLogHashBound: true,
      electronPid: progress.electronPid, electronExitCode: close.at(-1).code, electronSignal: close.at(-1).signal,
      electronExitedNormally: true, coordinatorClean: false },
    limitations: ['Finalized offline from saved campaign artifacts after the coordinator failed while reporting.',
      'No answer-generation or quality scoring was run by this finalizer. Retrieval ranks and source passage text are intentionally excluded.'],
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { outputPath, output, outputSha256: sha256(readRegular(outputPath)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv.find(value => value.startsWith('--root='))?.slice('--root='.length);
  const repoRoot = process.argv.find(value => value.startsWith('--repo-root='))?.slice('--repo-root='.length)
    ?? path.resolve(import.meta.dirname, '..');
  const outputPath = process.argv.find(value => value.startsWith('--out='))?.slice('--out='.length);
  const result = finalizeResearchEvidenceCampaign({ root, repoRoot, outputPath });
  console.log(JSON.stringify({ outputPath: result.outputPath, outputSha256: result.outputSha256,
    cases: result.output.verification.cases, answerable: result.output.verification.answerable,
    insufficient: result.output.verification.insufficient, citations: result.output.verification.citationResolution }));
}
