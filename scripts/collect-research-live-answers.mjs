#!/usr/bin/env node
/** Offline, hash-bound collector for the current structured live answer campaign. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateResearchAnswerQuality, RESEARCH_ANSWER_QUALITY_POLICY } from './lib/researchAnswerQualityPolicy.mjs';
import { validateResearchLiveShardAssignment, sourceHashesForProduction } from './lib/researchLiveAnswerShards.mjs';
import { planResearchLiveCases } from './lib/researchLiveAnswerCampaignState.mjs';
import { verifyDerivedIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';
import { verifyResearchLunaRead } from './research-luna-dispatch.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => sha(Buffer.from(JSON.stringify(value), 'utf8'));
const fail = message => { throw new Error(message); };
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
function readFile(file, maxBytes = 128 * 1024 * 1024) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes || fs.realpathSync(absolute) !== absolute) fail(`Unsafe or oversized regular file: ${file}`);
  return fs.readFileSync(absolute);
}
function jsonFile(file, maxBytes) { return JSON.parse(readFile(file, maxBytes).toString('utf8')); }
function parseLines(file) { return readFile(file, 64 * 1024 * 1024).toString('utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)); }
function rootPath(value) {
  const root = path.resolve(value);
  if (fs.realpathSync(root) !== root || root === path.parse(root).root) fail('Campaign root must be a canonical isolated directory');
  const marker = jsonFile(path.join(root, 'isolation.json'), 64 * 1024);
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== root) fail('Campaign root isolation marker mismatch');
  return root;
}
function hashBoundSource(manifest) {
  const sv = manifest.sourceVersion;
  if (!sv || !/^[a-f0-9]{64}$/u.test(sv.sourceSnapshotSha256 ?? '') || !/^[a-f0-9]{64}$/u.test(sv.preregistrationSha256 ?? '')
      || !/^[a-f0-9]{64}$/u.test(sv.casesSha256 ?? '') || !sv.sourceFiles || typeof sv.sourceFiles !== 'object') fail('Manifest source binding is malformed');
  const sourceFile = path.resolve(sv.sourceSnapshot);
  const preregFile = path.resolve(sv.preregistration);
  if (sha(readFile(sourceFile)) !== sv.sourceSnapshotSha256 || sha(readFile(preregFile)) !== sv.preregistrationSha256) fail('Source snapshot or preregistration hash is stale');
  const inputSnapshot = jsonFile(sourceFile);
  const snapshotPath = path.resolve(manifest.sourceSnapshot ?? '');
  const snapshot = jsonFile(snapshotPath);
  const prereg = jsonFile(preregFile);
  if (inputSnapshot.format !== 'nodus.research-case-sources/1' || snapshot.format !== 'nodus.research-live-answer-source-snapshot/1'
      || snapshot.sourceVersion?.sourceSnapshot !== sv.sourceSnapshot || snapshot.sourceVersion?.sourceSnapshotSha256 !== sv.sourceSnapshotSha256
      || snapshot.sourceVersion?.preregistrationSha256 !== sv.preregistrationSha256 || snapshot.sourceVersion?.casesSha256 !== sv.casesSha256
      || JSON.stringify(snapshot.sourceVersion?.sourceFiles) !== JSON.stringify(sv.sourceFiles)
      || prereg.format !== 'nodus.research-live-evidence-preregistration/1' || prereg.queries?.length !== 80) fail('Current source snapshot/preregistration format mismatch');
  for (const [relative, expected] of Object.entries(sv.sourceFiles)) {
    if (!inside(REPO, path.resolve(REPO, relative)) || !/^[a-f0-9]{64}$/u.test(expected) || sha(readFile(path.resolve(REPO, relative))) !== expected) fail(`Campaign source code hash mismatch: ${relative}`);
  }
  if (Object.keys(sv.sourceFiles).length < 1) fail('Manifest has no pinned campaign source files');
  const cases = snapshot.cases;
  if (!Array.isArray(cases) || cases.length !== 80 || new Set(cases.map(row => row.id)).size !== 80) fail('Snapshot must contain exactly 80 unique planned cases');
  const queryById = new Map(prereg.queries.map(row => [row.id, row]));
  const inputById = new Map((inputSnapshot.cases ?? []).map(row => [row.id, row]));
  if (queryById.size !== 80 || inputById.size !== 80 || cases.some(row => {
    const raw = inputById.get(row.id);
    if (!raw || !queryById.has(row.id) || queryById.get(row.id).question !== row.question || raw.question !== row.question
        || raw.language !== row.language || raw.sourceContext !== row.sourceContext
        || JSON.stringify(raw.sourcesContext) !== JSON.stringify(row.sourcesContext) || raw.isAnswerable !== row.isAnswerable) return true;
    const sourceContextHash = sha(Buffer.from(row.sourceContext ?? '', 'utf8'));
    const receiptsHash = jsonHash(row.sourcesContext);
    const sourceCaseHash = jsonHash({ id: row.id, question: row.question, language: row.language, sourceContextHash, receiptsHash });
    return row.sourceContextSha256 !== sourceContextHash || row.sourcesContextSha256 !== receiptsHash
      || row.sourceCaseHash !== sourceCaseHash || raw.sourceContextSha256 !== sourceContextHash || raw.sourcesContextSha256 !== receiptsHash;
  })) fail('Snapshot cases do not bind to the current source records and preregistered questions');
  const derivedCasesHash = inputSnapshot.caseSourceSnapshotSha256
    ?? jsonHash(cases.map(row => ({ id: row.id, sourceCaseHash: row.sourceCaseHash })));
  if (derivedCasesHash !== sv.casesSha256) fail('Case-source snapshot hash is stale');
  if (manifest.profileContractSha256 !== jsonHash(snapshot.profileContract)
      || manifest.scopeContractSha256 !== jsonHash(snapshot.scopeContract)
      || stableJson(manifest.profileContract) !== stableJson(snapshot.profileContract)
      || stableJson(manifest.scopeContract) !== stableJson(snapshot.scopeContract)) fail('Pinned profile or scope contract hash mismatch');
  const inputAuthorization = inputSnapshot.indexAuthorization ?? null;
  const copiedAuthorization = snapshot.indexAuthorization ?? null;
  let indexAuthorization = { status: 'missing', receipt: inputAuthorization };
  if (inputAuthorization && copiedAuthorization && stableJson(inputAuthorization) === stableJson(copiedAuthorization)) {
    try { indexAuthorization = { status: 'verified', receipt: inputAuthorization, validation: verifyDerivedIndexAuthorization(inputSnapshot) }; }
    catch (error) { indexAuthorization = { status: 'failed', receipt: inputAuthorization, error: String(error?.message ?? error).slice(0, 500) }; }
  } else if (inputAuthorization || copiedAuthorization) {
    indexAuthorization = { status: copiedAuthorization ? 'failed' : 'missing', receipt: copiedAuthorization ?? inputAuthorization,
      error: copiedAuthorization ? 'Derived campaign snapshot does not identically bind the source index authorization receipt.' : null };
  }
  return { sourceFile, snapshotPath, preregFile, snapshot, prereg, cases, queryById, indexAuthorization };
}
function traceFor(attempt) {
  const rows = Array.isArray(attempt.traces) ? attempt.traces : [];
  const trace = rows.find(row => row?.type === 'research-answer-grounding' && row?.status === 'complete' && Array.isArray(row.sources));
  return trace ?? null;
}
function answerText(attempt) {
  return typeof attempt.answer === 'string' && attempt.answer.trim() ? attempt.answer : '';
}
function exactCitationBlinding(answer, sources, reviewId) {
  let text = answer;
  const targets = new Map();
  sources.forEach((source, index) => {
    if (typeof source?.id === 'string' && source.id) targets.set(`nodus://passage/${encodeURIComponent(source.id)}`, `nodus://review-source/${reviewId}/${index + 1}`);
    if (typeof source?.citation === 'string' && source.citation) targets.set(source.citation, `nodus://review-source/${reviewId}/${index + 1}`);
  });
  const ordered = [...targets.entries()].sort((a, b) => b[0].length - a[0].length);
  const replaced = new Set();
  for (const [target, blinded] of ordered) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const regex = new RegExp(`(?<![A-Za-z0-9_/-])${escaped}(?=$|[\\s)\\]}>,;:!?]|\\.(?=$|[\\s)\\]}>,;:!?]))`, 'gu');
    text = text.replace(regex, match => { replaced.add(match); return blinded; });
  }
  // Preserve unknown citation targets as explicitly unresolved, without exposing their source IDs.
  let unknown = 0;
  text = text.replace(/nodus:\/\/passage\/[^\s)\]}>,]+/gu, target => {
    if (replaced.has(target)) return target;
    return `nodus://unresolved-source/${++unknown}`;
  });
  return text;
}
function sourceForReview(trace, reviewId) {
  const sourceRows = Array.isArray(trace?.sources) ? trace.sources : [];
  const sources = sourceRows.map((source, index) => ({
    sourceRef: `source-${index + 1}`,
    title: String(source.title ?? source.label ?? ''),
    text: String(source.text ?? source.excerpt ?? ''),
    page: source.page ?? source.pageNumber ?? null,
    citation: `nodus://review-source/${reviewId}/${index + 1}`,
  }));
  return { sources, sourceHash: jsonHash(sources) };
}
const stableValue = value => Array.isArray(value) ? value.map(stableValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value;
const stableJson = value => JSON.stringify(stableValue(value));
function retrievalScopeEvidence(attempt, manifest, authorizedDocumentIds, lexicalKeysByDocument, authorizedVectorPairs) {
  const traces = Array.isArray(attempt?.traces) ? attempt.traces.filter(row => row?.type === 'documentary-retrieval') : [];
  if (!traces.length) return { complete: false, scopeLeaks: 0, contractLeaks: 0, statuses: ['missing-trace'] };
  const expectedContract = manifest.profileContract?.embeddingModelContract;
  if (!expectedContract || typeof expectedContract !== 'object') return { complete: false, scopeLeaks: 0, contractLeaks: 0, statuses: ['missing-canonical-contract'] };
  const expectedScopeId = manifest.scopeContract?.scopeId;
  let complete = true, scopeLeaks = 0, contractLeaks = 0;
  const statuses = [];
  for (const trace of traces) {
    if (!trace.contract || !Array.isArray(trace.vectorKeys) || typeof trace.scopeId !== 'string' || !trace.retrieval
        || !Array.isArray(trace.retrieval.semantic) || !Array.isArray(trace.retrieval.lexical)
        || !Array.isArray(trace.retrieval.lexicalQueries) || !Array.isArray(trace.retrieval.selected)) {
      complete = false; statuses.push('incomplete'); continue;
    }
    let mismatch = false;
    if (stableJson(trace.contract) !== stableJson(expectedContract)) { contractLeaks += 1; mismatch = true; }
    if (trace.scopeId !== expectedScopeId) { scopeLeaks += 1; mismatch = true; }
    for (const key of trace.vectorKeys) {
      const pair = authorizedVectorPairs.get(key);
      if (!pair || !authorizedDocumentIds.has(pair.documentId)
          || !lexicalKeysByDocument.get(pair.documentId)?.has(pair.lexicalKey)) { scopeLeaks += 1; mismatch = true; }
    }
    const candidates = [...trace.retrieval.semantic, ...trace.retrieval.lexical, ...trace.retrieval.selected,
      ...trace.retrieval.lexicalQueries.flatMap(query => Array.isArray(query?.candidates) ? query.candidates : [])];
    if (trace.retrieval.lexicalQueries.some(query => !Array.isArray(query?.candidates))) complete = false;
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.documentId !== 'string') { complete = false; continue; }
      if (!authorizedDocumentIds.has(candidate.documentId)) { scopeLeaks += 1; mismatch = true; }
    }
    statuses.push(mismatch ? 'mismatch' : complete ? 'verified' : 'incomplete');
  }
  return { complete, scopeLeaks, contractLeaks, statuses };
}
function citationRuntimeEvidence(attempt, answer, authorizedDocumentIds) {
  const targets = [...new Set([...String(answer ?? '').matchAll(/nodus:\/\/passage\/([^\s)\]}>,]+)/gu)].map(match => match[0]))];
  const rows = Array.isArray(attempt?.citationResolution) ? attempt.citationResolution : [];
  let complete = true, resolved = 0;
  for (const target of targets) {
    let id;
    try { id = decodeURIComponent(target.slice('nodus://passage/'.length)); }
    catch { continue; } // malformed published target is captured and unresolved
    const receipt = rows.filter(row => row?.citationId === id);
    if (receipt.length !== 1) { complete = false; continue; }
    const passage = receipt[0].passage;
    // A recorded null from the product API is a measured unresolved citation.
    if (passage === null) continue;
    if (!passage || typeof passage !== 'object' || typeof passage.passage_id !== 'string') { complete = false; continue; }
    const groundingTraces = attempt.traces?.filter(row => row?.type === 'research-answer-grounding' && row.status === 'complete' && Array.isArray(row.sources)) ?? [];
    if (!groundingTraces.length) { complete = false; continue; }
    const sourceRows = groundingTraces.flatMap(row => row.sources);
    const source = sourceRows.find(row => row?.id === id && row?.citation === `nodus://passage/${encodeURIComponent(id)}`);
    if (!source) continue;
    const marker = 'Verbatim excerpt:\n';
    const excerptAt = typeof source.text === 'string' ? source.text.lastIndexOf(marker) : -1;
    const excerpt = excerptAt >= 0 ? source.text.slice(excerptAt + marker.length) : null;
    const title = source.text.match(/(?:^|\n)Source title: ([^\n]+)/u)?.[1] ?? null;
    const locator = source.text.match(/(?:^|\n)Source locator: ([^\n]+)/u)?.[1] ?? null;
    const locatorMatches = locator === null || locator === passage.page_label;
    const titleMatches = title === null || title === passage.work?.title;
    if (passage.passage_id === id && authorizedDocumentIds.has(passage.libraryItemId) && excerpt !== null && passage.text === excerpt
        && locatorMatches && titleMatches) resolved += 1;
  }
  return { complete, captured: targets.length, resolved, citationTargets: targets };
}
function collectProductInvariantEvidence({ attempts, manifest, planned, indexAuthorization }) {
  const scope = manifest.scopeContract;
  const profile = manifest.profileContract;
  const documents = new Set(Array.isArray(scope?.resolvedDocumentIds) ? scope.resolvedDocumentIds : []);
  const scopeDocuments = Array.isArray(scope?.documents) ? scope.documents : [];
  const scopeDocumentIds = new Set(scopeDocuments.map(row => row?.id));
  if (!documents.size || typeof scope?.scopeId !== 'string' || !scope.scopeId || scopeDocumentIds.size !== documents.size
      || scopeDocuments.length !== documents.size || [...documents].some(id => !scopeDocumentIds.has(id))) return null;
  const scopeKeysByDocument = new Map(scopeDocuments.map(row => [row.id, row?.indexedSource?.indexKeys]));
  const profileIndexes = Array.isArray(profile?.indexContracts) ? profile.indexContracts : [];
  if (!profileIndexes.length || !profile?.embeddingModelContract || profileIndexes.some(row => !documents.has(row?.documentId)
      || !Array.isArray(row?.indexedSource?.indexKeys)) || [...documents].some(id => !Array.isArray(scopeKeysByDocument.get(id)))) return null;
  const profileKeysByDocument = new Map(profileIndexes.map(row => [row.documentId, row.indexedSource.indexKeys]));
  const profileIndexDocuments = new Set(profileIndexes.map(row => row.documentId));
  if (profileIndexDocuments.size !== documents.size || [...documents].some(id => !profileIndexDocuments.has(id))) return null;
  const lexicalKeysByDocument = new Map(scopeDocuments.map(row => [row.id, new Set(row.indexedSource.indexKeys)]));
  if (![...lexicalKeysByDocument.values()].some(keys => keys.size > 0)) return null;
  if (!indexAuthorization || indexAuthorization.status === 'missing') return null;
  const authorizedVectorPairs = indexAuthorization.status === 'verified'
    ? indexAuthorization.validation.pairByVectorKey : new Map();
  const indexContractMismatch = [...documents].some(id => stableJson([...new Set(scopeKeysByDocument.get(id))].sort())
    !== stableJson([...new Set(profileKeysByDocument.get(id))].sort()));
  const perAttempt = attempts.map(attempt => retrievalScopeEvidence(attempt, manifest, documents, lexicalKeysByDocument, authorizedVectorPairs));
  if (attempts.length !== planned || perAttempt.some(row => !row.complete)) return null;
  let citationsComplete = true, citationCaptured = 0, citationResolved = 0;
  for (const attempt of attempts) {
    const publishable = typeof attempt.answer === 'string' && attempt.answer.trim()
      && attempt.attemptStatus === 'answered' && attempt.receiptsComplete === true;
    if (!publishable) continue;
    const citation = citationRuntimeEvidence(attempt, attempt.answer, documents);
    if (!citation.complete) citationsComplete = false;
    citationCaptured += citation.captured; citationResolved += citation.resolved;
  }
  if (!citationsComplete) return null;
  const observedScopeLeaks = perAttempt.reduce((sum, row) => sum + row.scopeLeaks, 0);
  const invalidAuthorization = indexAuthorization.status === 'failed';
  const observedContractLeaks = perAttempt.reduce((sum, row) => sum + row.contractLeaks, 0)
    + Number(indexContractMismatch) + Number(invalidAuthorization);
  const evidencePayload = { kind: 'research-live-answer-runtime-invariants/1', scopeContractSha256: manifest.scopeContractSha256,
    profileContractSha256: manifest.profileContractSha256,
    indexAuthorization: indexAuthorization.receipt ? { status: indexAuthorization.status,
      receiptSha256: indexAuthorization.receipt.receiptSha256 ?? null,
      originalSourceSnapshotSha256: indexAuthorization.receipt.originalSourceSnapshotSha256 ?? null,
      originalSourceSnapshotPath: indexAuthorization.receipt.originalSourceSnapshotPath ?? null,
      reportSha256: indexAuthorization.receipt.reportSha256 ?? null, reportPath: indexAuthorization.receipt.reportPath ?? null,
      sqliteSha256: indexAuthorization.receipt.sqliteSha256 ?? null,
      caseSourceSnapshotSha256: indexAuthorization.receipt.caseSourceSnapshotSha256 ?? null,
      profileContractSha256: indexAuthorization.receipt.profileContractSha256 ?? null,
      scopeContractSha256: indexAuthorization.receipt.scopeContractSha256 ?? null,
      fingerprintSourceSha256: indexAuthorization.receipt.fingerprintSourceSha256 ?? null,
      error: invalidAuthorization ? indexAuthorization.error : null } : null,
    attempts: attempts.map(row => ({ caseId: row.caseId,
      sourceContextHash: row.sourceContextHash, attemptStatus: row.attemptStatus,
      answerSha256: sha(Buffer.from(answerText(row), 'utf8')),
      groundingTraceSha256: jsonHash(row.traces?.filter(trace => trace?.type === 'research-answer-grounding') ?? []),
      retrievalTraceSha256: jsonHash(row.traces?.filter(trace => trace?.type === 'documentary-retrieval') ?? []),
      citationResolution: row.citationResolution ?? [] })) };
  return { policyEvidence: { evidenceType: 'product-runtime-receipt', evidenceSha256: jsonHash(evidencePayload),
    citationResolution: { captured: citationCaptured, resolved: citationResolved, resolver: 'window.nodus.getPassage; passage ID, authorized document, source excerpt, title and locator bound' },
    scopeContractIsolation: { checkedOutcomes: planned, observedScopeLeaks, observedContractLeaks, checksRun: true } },
    status: observedScopeLeaks || observedContractLeaks || citationResolved !== citationCaptured ? 'failed' : 'measured',
    citationResolution: { captured: citationCaptured, resolved: citationResolved,
      rate: citationCaptured ? citationResolved / citationCaptured : null },
    scopeContractIsolation: { checkedOutcomes: planned, observedScopeLeaks, observedContractLeaks, checksRun: true },
    evidenceSha256: jsonHash(evidencePayload), details: perAttempt.map((row, index) => ({ caseId: attempts[index].caseId, ...row })) };
}
function runtimeReceipts(root, campaign, manifest, { administrativeBindings = null } = {}) {
  const eventsFile = path.join(root, 'artifacts/events.jsonl');
  if (!fs.existsSync(eventsFile)) return { accepted: [], completed: [], abandoned: [], allTerminal: false };
  const events = parseLines(eventsFile);
  const accepted = events.filter(row => row.event === 'accepted'), completed = events.filter(row => row.event === 'completed'), abandoned = events.filter(row => row.event === 'abandoned');
  const acceptedById = new Map();
  for (const event of accepted) {
    if (!event.id || acceptedById.has(event.id) || !/^[a-f0-9]{64}$/u.test(event.requestHash ?? '') || !Number.isSafeInteger(event.requestBytes)) fail('Malformed or duplicate accepted bridge receipt');
    acceptedById.set(event.id, event);
    const request = path.join(root, 'artifacts/requests', `${event.id}.json`);
    const failedRequest = path.join(root, 'artifacts/failed-requests', `${event.id}.json`);
    const candidate = fs.existsSync(request) ? request : fs.existsSync(failedRequest) ? failedRequest : null;
    if (!candidate) fail(`Accepted request bytes are missing: ${event.id}`);
    const bytes = readFile(candidate, 1_000_000);
    if (sha(bytes) !== event.requestHash || bytes.length !== event.requestBytes) fail(`Accepted request bytes mismatch: ${event.id}`);
  }
  for (const event of completed) {
    if (!acceptedById.has(event.id) || event.requestHash !== acceptedById.get(event.id).requestHash || !/^[a-f0-9]{64}$/u.test(event.responseHash ?? '') || !Number.isSafeInteger(event.responseBytes)) fail('Completed event does not bind to one accepted request');
    const completion = jsonFile(path.join(root, 'artifacts/completions', `${event.id}.json`), 16 * 1024 * 1024);
    const raw = readFile(path.join(root, 'artifacts/raw-completions', `${event.id}.txt`), 16 * 1024 * 1024);
    const requestBytes = readFile(path.join(root, 'artifacts/requests', `${event.id}.json`), 1_000_000);
    const requestRecord = JSON.parse(requestBytes.toString('utf8'));
    const rawText = raw.toString('utf8');
    if (!Buffer.from(rawText, 'utf8').equals(raw) || completion.requestHash !== event.requestHash
        || completion.responseHash !== event.responseHash || completion.id !== event.id
        || completion.nonce !== requestRecord.nonce || completion.content !== rawText
        || completion.finish_reason !== event.finishReason) fail(`Completed response content or binding mismatch: ${event.id}`);
    // The bridge hashes the canonical JSON response envelope, not the raw completion text.
    const responseEnvelope = Buffer.from(`${JSON.stringify({ format: 'nodus.codex-luna-qa/1', nonce: requestRecord.nonce,
      id: event.id, content: rawText, finish_reason: completion.finish_reason })}\n`, 'utf8');
    if (sha(responseEnvelope) !== event.responseHash || responseEnvelope.length !== event.responseBytes) {
      fail(`Completed response envelope hash/byte count mismatch: ${event.id}`);
    }
  }
  const bindings = administrativeBindings ? jsonFile(administrativeBindings, 2 * 1024 * 1024) : [];
  if (!Array.isArray(bindings)) fail('Administrative event bindings must be an array');
  const bindingById = new Map();
  for (const binding of bindings) {
    if (binding?.format !== 'nodus.qa-administrative-event-binding/1' || binding.event !== 'abandoned'
        || !binding.id || bindingById.has(binding.id) || !/^[a-f0-9]{64}$/u.test(binding.requestHash ?? '')
        || binding.reason !== 'qa-controller-process-lost' || binding.concludedStatus !== 'protocol-failure'
        || binding.completedBridgeEvent !== false) fail('Malformed administrative event binding');
    const forensicBytes = readFile(binding.forensicReceiptPath, 2 * 1024 * 1024);
    const snapshotBytes = readFile(binding.originalEventsSnapshotPath, 16 * 1024 * 1024);
    if (sha(forensicBytes) !== binding.forensicReceiptSha256 || sha(snapshotBytes) !== binding.originalEventsSnapshotSha256) fail('Administrative binding evidence hash mismatch');
    const forensic = JSON.parse(forensicBytes.toString('utf8'));
    const originalEvents = snapshotBytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
    const originalAccepted = originalEvents.filter(row => row.event === 'accepted' && row.id === binding.id);
    const mapping = jsonFile(path.join(root, 'artifacts/case-request-mappings', `${binding.id}.json`), 1024 * 1024);
    const answer = (campaign.answers ?? []).find(row => row.caseId === mapping.caseId);
    if (forensic.format !== 'nodus.qa-controller-loss-recovery/1' || forensic.scope?.root !== root
        || forensic.scope?.orphanRequestId !== binding.id || forensic.classification?.status !== 'protocol-failure'
        || forensic.classification?.errorClassification !== binding.reason || forensic.classification?.success !== false
        || forensic.acceptedEvent?.requestHash !== binding.requestHash
        || forensic.originalHashes?.rootEvents !== binding.originalEventsSnapshotSha256
        || mapping.requestId !== binding.id || mapping.caseId !== forensic.scope.caseId
        || !answer || answer.attemptStatus !== 'protocol-failure'
        || !(answer.bridgeRequestIds ?? []).includes(binding.id) || (answer.bridgeCompletionIds ?? []).includes(binding.id)
        || originalAccepted.length !== 1 || originalAccepted[0].requestHash !== binding.requestHash
        || originalEvents.some(row => ['completed', 'abandoned'].includes(row.event) && row.id === binding.id)) fail('Administrative binding does not match forensic negative evidence');
    bindingById.set(binding.id, binding);
  }
  for (const event of abandoned) {
    const acceptedEvent = acceptedById.get(event.id), binding = bindingById.get(event.id);
    if (!acceptedEvent) fail('Abandoned event does not bind to one accepted request');
    if (event.requestHash === acceptedEvent.requestHash) continue;
    if (event.requestHash || !binding || binding.requestHash !== acceptedEvent.requestHash
        || event.reason !== binding.reason || event.provenance?.type !== 'forensic-recovery'
        || event.provenance?.receipt !== binding.forensicReceiptPath) fail('Abandoned event does not bind to one accepted request');
  }
  for (const [id, binding] of bindingById) {
    const event = abandoned.find(row => row.id === id), acceptedEvent = acceptedById.get(id);
    if (!event || !acceptedEvent || event.requestHash || acceptedEvent.requestHash !== binding.requestHash
        || completed.some(row => row.id === id)) fail('Administrative binding is not for the exact uncompleted missing-hash abandonment');
  }
  const terminals = [...completed, ...abandoned];
  if (new Set(terminals.map(row => row.id)).size !== terminals.length) fail('Bridge request has multiple terminal events');
  const allTerminal = accepted.every(row => terminals.some(item => item.id === row.id));
  // Each campaign answer's request IDs must match its durable mapping and event stream.
  const answerIds = new Set((campaign.answers ?? []).flatMap(row => row.bridgeRequestIds ?? []));
  if ([...acceptedById.keys()].some(id => !answerIds.has(id))) fail('Bridge event contains an accepted request absent from campaign answers');
  if (manifest.root !== root || campaign.root !== root) fail('Campaign root does not bind to manifest');
  return { accepted, completed, abandoned, allTerminal };
}
function verifyDispatchReceipt(root, requestId, savedReceipt) {
  const artifacts = path.join(root, 'artifacts');
  const jobPath = path.join(artifacts, 'dispatch-jobs', `${requestId}.json`);
  const promptPath = path.join(artifacts, 'agent-prompts.jsonl');
  const executionPath = path.join(artifacts, 'agent-executions.jsonl');
  if (![jobPath, promptPath, executionPath].every(file => fs.existsSync(file))) return { status: 'pending' };
  try {
    const job = jsonFile(jobPath, 2 * 1024 * 1024);
    const prompts = parseLines(promptPath).filter(row => row.request_id === requestId);
    const executions = parseLines(executionPath).filter(row => row.request_id === requestId);
    if (job.model !== 'gpt-6-luna' || job.forkTurns !== 'none' || prompts.length !== 1 || executions.length !== 1) {
      return { status: 'failed', error: 'Dispatch job or agent binding is missing or contradictory.' };
    }
    const prompt = prompts[0], execution = executions[0];
    if (prompt.model !== 'gpt-6-luna' || prompt.fork_turns !== 'none' || prompt.message !== job.prompt
        || prompt.sha256 !== job.promptSha256 || sha(Buffer.from(prompt.message, 'utf8')) !== job.promptSha256
        || prompt.jobFile !== `dispatch-jobs/${requestId}.json`
        || execution.model !== 'gpt-6-luna' || execution.fork_turns !== 'none'
        || execution.jobFile !== prompt.jobFile || execution.effort !== job.reasoningEffort) {
      return { status: 'failed', error: 'Agent prompt/execution metadata does not bind to the immutable dispatch job.' };
    }
    const verified = verifyResearchLunaRead({ root, requestId });
    if (!savedReceipt || stableJson(verified) !== stableJson(savedReceipt)) {
      return { status: 'failed', error: 'Stored full-read receipt differs from the current request, audit, and completion proof.' };
    }
    return { status: 'verified', auditSha256: verified.auditSha256, requestSha256: verified.requestSha256,
      promptSha256: job.promptSha256, model: job.model, forkTurns: job.forkTurns };
  } catch (error) {
    return { status: 'failed', error: String(error?.message ?? error).slice(0, 300) };
  }
}
function normalizeReviewRows(input) {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  if (input?.format === 'nodus.research-answer-blind-reviews/1' && Array.isArray(input.reviews)) return input.reviews;
  fail('Review file must contain a review array');
}
function collectResearchLiveAnswers({ campaignDir, reviewFile = null, outputDir, administrativeBindings = null, preregistration = { minimumAnswerableSample: 60 } } = {}) {
  if (!campaignDir || !outputDir) fail('campaignDir and outputDir are required');
  const dir = path.resolve(campaignDir), root = rootPath(jsonFile(path.join(dir, 'manifest.json'), 32 * 1024 * 1024).root);
  const manifestBytes = readFile(path.join(dir, 'manifest.json'), 32 * 1024 * 1024);
  const campaignBytes = readFile(path.join(dir, 'campaign.json'), 128 * 1024 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const campaign = JSON.parse(campaignBytes.toString('utf8'));
  if (manifest.format !== 'nodus.research-live-answer-campaign/1' || manifest.mode !== 'structured-only'
      || campaign.format !== manifest.format || campaign.mode && campaign.mode !== 'structured-only') fail('Unsupported campaign format; historical campaigns are not regraded');
  const bound = hashBoundSource(manifest);
  let evaluatedCases = bound.cases;
  if (manifest.assignment) {
    const assignmentBytes = readFile(manifest.assignment, 32 * 1024 * 1024);
    if (sha(assignmentBytes) !== manifest.assignmentSha256) fail('Collector shard assignment digest mismatch');
    const assignment = JSON.parse(assignmentBytes.toString('utf8'));
    const closedDirectory = assignment.closedCampaign?.path;
    const closedManifestBytes = readFile(path.join(closedDirectory, 'manifest.json'), 32 * 1024 * 1024);
    const closedCampaignBytes = readFile(path.join(closedDirectory, 'campaign.json'), 128 * 1024 * 1024);
    const closedManifest = JSON.parse(closedManifestBytes.toString('utf8'));
    const closedCampaign = JSON.parse(closedCampaignBytes.toString('utf8'));
    const frozenBytes = readFile(assignment.fullSourceSnapshot?.path);
    const frozen = JSON.parse(frozenBytes.toString('utf8'));
    // The clone has its own root and read-only identity receipt. Its logical
    // evidence must still equal the frozen original, including every case byte.
    if (stableJson(frozen.cases) !== stableJson(bound.cases)
        || stableJson(closedManifest.profileContract) !== stableJson(manifest.profileContract)
        || stableJson(closedManifest.scopeContract) !== stableJson(manifest.scopeContract)) fail('Shard logical source snapshot differs from the frozen original');
    const shard = validateResearchLiveShardAssignment({ assignment, shardId: manifest.shardId,
      plan: planResearchLiveCases(bound.cases), concludedAnswers: closedCampaign.answers,
      sourceSnapshotSha256: closedManifest.sourceSnapshotSha256,
      preregistrationSha256: manifest.sourceVersion.preregistrationSha256,
      casesSha256: manifest.sourceVersion.casesSha256,
      profileContractSha256: manifest.profileContractSha256, scopeContractSha256: manifest.scopeContractSha256,
      productionSourceFiles: sourceHashesForProduction(manifest.sourceVersion.sourceFiles),
      closedCampaignManifestSha256: sha(closedManifestBytes), closedCampaignSha256: sha(closedCampaignBytes),
      fullSourceSnapshotSha256: sha(frozenBytes) });
    if (stableJson(manifest.assignedCaseIds) !== stableJson(shard.caseIds)
        || manifest.plannedCount !== shard.caseIds.length) fail('Collector shard roster differs from its assignment');
    evaluatedCases = bound.cases.filter(row => shard.caseIds.includes(row.id));
  }
  const runtime = runtimeReceipts(root, campaign, manifest, { administrativeBindings });
  const byCase = new Map();
  for (const row of campaign.answers ?? []) {
    if (!row || !evaluatedCases.some(item => item.id === row.caseId) || byCase.has(row.caseId)) fail('Campaign answer has unknown or duplicate case ID');
    const sourceCase = bound.cases.find(item => item.id === row.caseId);
    if (row.sourceCaseHash !== sourceCase.sourceCaseHash || row.sourceContextHash !== sourceCase.sourceContextSha256
        || row.receiptsHash !== sourceCase.sourcesContextSha256 || row.question !== sourceCase.question) fail(`Answer/source binding mismatch: ${row.caseId}`);
    byCase.set(row.caseId, row);
  }
  const bridgeIds = new Set(runtime.accepted.map(row => row.id));
  const completedIds = new Set(runtime.completed.map(row => row.id));
  const dispatchEvidenceById = new Map();
  for (const answer of byCase.values()) for (const id of answer.bridgeRequestIds ?? []) {
    if (!bridgeIds.has(id)) fail(`Attempt references an absent accepted request: ${id}`);
    const mapPath = path.join(root, 'artifacts/case-request-mappings', `${id}.json`);
    const mapping = jsonFile(mapPath, 64 * 1024);
    if (mapping.format !== 'nodus.research-live-answer-case-request/1' || mapping.requestId !== id
        || mapping.caseId !== answer.caseId || mapping.caseAttemptId !== answer.caseAttemptId || mapping.segmentId !== answer.segmentId
        || mapping.sourceContextHash !== answer.sourceContextHash || mapping.receiptsHash !== answer.receiptsHash || mapping.sourceCaseHash !== answer.sourceCaseHash) fail(`Request mapping does not bind to answer: ${id}`);
    if (completedIds.has(id)) {
      const jobPath = path.join(root, 'artifacts/dispatch-jobs', `${id}.json`);
      const receipt = (answer.dispatchReadReceipts ?? []).find(item => item.requestId === id) ?? null;
      if (!fs.existsSync(jobPath)) dispatchEvidenceById.set(id, { status: 'pending' });
      else {
        const dispatchJob = jsonFile(jobPath, 2 * 1024 * 1024);
        const mappingSha256 = sha(readFile(mapPath, 64 * 1024));
        if (dispatchJob.requestId !== id || dispatchJob.requestSha256 !== runtime.accepted.find(item => item.id === id)?.requestHash
            || dispatchJob.mapping?.mappingFile !== mapPath || dispatchJob.mapping?.mappingSha256 !== mappingSha256) {
          dispatchEvidenceById.set(id, { status: 'failed', error: 'Dispatch job request or case mapping mismatch.' });
        } else if (!receipt && !answer.finishedAt) {
          dispatchEvidenceById.set(id, { status: 'pending',
            reason: 'The in-flight application attempt has not frozen its dispatch read receipts yet.' });
        } else dispatchEvidenceById.set(id, verifyDispatchReceipt(root, id, receipt));
      }
    }
  }
  const packetRows = [], outcomes = [], utilityKey = [];
  for (const item of evaluatedCases) {
    const attempt = byCase.get(item.id) ?? null;
    const plannedTerminal = Boolean(attempt && attempt.finishedAt && ['answered','verification-withheld','protocol-failure'].includes(attempt.attemptStatus));
    const trace = attempt ? traceFor(attempt) : null;
    const answer = attempt ? answerText(attempt) : '';
    const reviewId = `review-${sha(Buffer.from(`${manifest.sourceVersion.sourceSnapshotSha256}\0${item.id}`, 'utf8')).slice(0, 24)}`;
    const reviewSources = sourceForReview(trace, reviewId);
    const dispatchQualified = (attempt?.bridgeRequestIds ?? []).length > 0
      && attempt.bridgeRequestIds.every(id => dispatchEvidenceById.get(id)?.status === 'verified');
    const publishable = Boolean(attempt && answer && attempt.attemptStatus === 'answered' && attempt.receiptsComplete === true
      && dispatchQualified && (attempt.bridgeRequestIds ?? []).every(id => completedIds.has(id)));
    const reviewAnswer = publishable ? answer : '';
    const answerSha256 = sha(Buffer.from(reviewAnswer, 'utf8'));
    const sourceHash = reviewSources.sourceHash;
    const packAnswer = exactCitationBlinding(reviewAnswer, trace?.sources ?? [], reviewId);
    packetRows.push({ reviewId, answerSha256, sourceHash, question: item.question, language: item.language,
      answer: packAnswer, sources: reviewSources.sources });
    outcomes.push({ reviewId, arm: 'structured', positive: item.isAnswerable === true, answered: publishable,
      answerSha256, sourceHash });
    utilityKey.push({ reviewId, caseId: item.id, isAnswerable: item.isAnswerable === true, annotationGold: bound.prereg.annotationGold?.[item.id] ?? null,
      outcome: attempt?.attemptStatus ?? 'not-executed', finished: plannedTerminal });
  }
  const reviewBytes = reviewFile ? readFile(reviewFile, 16 * 1024 * 1024) : null;
  const reviews = normalizeReviewRows(reviewBytes ? JSON.parse(reviewBytes.toString('utf8')) : undefined);
  const campaignFinished = byCase.size === evaluatedCases.length && [...byCase.values()].every(row => row.finishedAt
    && ['answered','verification-withheld','protocol-failure'].includes(row.attemptStatus));
  const productInvariants = collectProductInvariantEvidence({ attempts: evaluatedCases.map(row => byCase.get(row.id)).filter(Boolean),
    manifest, planned: evaluatedCases.length, indexAuthorization: bound.indexAuthorization });
  const dispatchEvidence = [...dispatchEvidenceById.entries()];
  const quality = evaluateResearchAnswerQuality({ outcomes, reviews, campaignFinished,
    productInvariantEvidence: productInvariants?.policyEvidence ?? null, preregistration });
  // Runtime citation resolution and scope isolation require explicit production evidence.
  const knownCitationTargets = evaluatedCases.reduce((sum, item) => {
    const attempt = byCase.get(item.id);
    if (!attempt) return sum;
    let selected = [];
    try { selected = JSON.parse(item.sourceContext).contexto_modular_seleccionado?.pasajes_relevantes ?? []; } catch { /* missing evidence is not counted */ }
    const known = new Set(selected.map(row => `nodus://passage/${encodeURIComponent(row.id)}`));
    const links = [...new Set([...answerText(attempt).matchAll(/nodus:\/\/passage\/[^\s)\]}>,]+/gu)].map(match => match[0]))];
    return sum + links.filter(link => known.has(link)).length;
  }, 0);
  const report = { format: 'nodus.research-live-answer-evaluation/1', policy: RESEARCH_ANSWER_QUALITY_POLICY,
    evaluationSource: { collectorSha256: sha(readFile(fileURLToPath(import.meta.url), 8 * 1024 * 1024)),
      qualityPolicySha256: sha(readFile(path.join(REPO, 'scripts/lib/researchAnswerQualityPolicy.mjs'))),
      indexAuthorizationHelperSha256: sha(readFile(path.join(REPO, 'scripts/lib/researchLiveIndexAuthorization.mjs'))) },
    campaign: { format: manifest.format, manifestSha256: sha(manifestBytes), campaignSha256: sha(campaignBytes),
      sourceSnapshotSha256: manifest.sourceVersion.sourceSnapshotSha256, preregistrationSha256: manifest.sourceVersion.preregistrationSha256, casesSha256: manifest.sourceVersion.casesSha256,
      sourceFiles: manifest.sourceFiles, planned: evaluatedCases.length, fullSnapshotPlanned: bound.cases.length,
      shardId: manifest.shardId ?? null, assignmentSha256: manifest.assignmentSha256 ?? null,
      concluded: [...byCase.values()].filter(row => row.finishedAt && ['answered','verification-withheld','protocol-failure'].includes(row.attemptStatus)).length,
      notExecuted: evaluatedCases.filter(row => !byCase.has(row.id)).length,
      unfinished: [...byCase.values()].filter(row => !(row.finishedAt && ['answered','verification-withheld','protocol-failure'].includes(row.attemptStatus))).length,
      campaignFinished80Concluded: byCase.size === 80 && [...byCase.values()].every(row => row.finishedAt && ['answered','verification-withheld','protocol-failure'].includes(row.attemptStatus)),
      assignedCampaignFinished: campaignFinished,
      bridgeRequestsAccepted: runtime.accepted.length, bridgeRequestsCompleted: runtime.completed.length, bridgeRequestsAbandoned: runtime.abandoned.length,
      allAcceptedRequestsTerminal: runtime.allTerminal },
    answerQuality: quality,
    // Root-only aggregation data. These fields are not in the blind packet.
    caseOutcomes: outcomes.map((row, index) => ({ ...row, caseId: utilityKey[index].caseId,
      finished: utilityKey[index].finished, outcome: utilityKey[index].outcome })),
    productInvariantPolicyEvidence: productInvariants?.policyEvidence ?? null,
    evidenceMetrics: { knownManifestCitationTargets: knownCitationTargets,
      productCitationResolution: productInvariants?.citationResolution ?? null,
      scopeContractIsolation: productInvariants?.scopeContractIsolation ?? null,
      productInvariantStatus: productInvariants?.status ?? 'pending',
      productInvariantEvidenceSha256: productInvariants?.evidenceSha256 ?? null,
      productInvariantDetails: productInvariants?.details ?? null,
      indexAuthorizationStatus: bound.indexAuthorization.status,
      indexAuthorizationError: bound.indexAuthorization.status === 'failed' ? bound.indexAuthorization.error : null,
      indexAuthorization: bound.indexAuthorization.receipt ? {
        format: bound.indexAuthorization.receipt.format, status: bound.indexAuthorization.status,
        receiptPath: bound.indexAuthorization.receipt.receiptPath ?? null,
        receiptSha256: bound.indexAuthorization.receipt.receiptSha256 ?? null,
        originalSourceSnapshotPath: bound.indexAuthorization.receipt.originalSourceSnapshotPath ?? null,
        originalSourceSnapshotSha256: bound.indexAuthorization.receipt.originalSourceSnapshotSha256 ?? null,
        reportPath: bound.indexAuthorization.receipt.reportPath ?? null,
        reportSha256: bound.indexAuthorization.receipt.reportSha256 ?? null,
        sqliteSha256: bound.indexAuthorization.receipt.sqliteSha256 ?? null,
        profileContractSha256: bound.indexAuthorization.receipt.profileContractSha256 ?? null,
        scopeContractSha256: bound.indexAuthorization.receipt.scopeContractSha256 ?? null,
        caseSourceSnapshotSha256: bound.indexAuthorization.receipt.caseSourceSnapshotSha256 ?? null,
      } : null,
      dispatchReadProof: { completedRequests: dispatchEvidence.length,
        verified: dispatchEvidence.filter(([, row]) => row.status === 'verified').length,
        pending: dispatchEvidence.filter(([, row]) => row.status === 'pending').length,
        failed: dispatchEvidence.filter(([, row]) => row.status === 'failed').length,
        details: Object.fromEntries(dispatchEvidence) },
      rationale: productInvariants ? null : 'One or more planned outcomes lacks complete hash-bound runtime citation and retrieval scope/contract receipts.' },
    reviewPacket: { format: 'nodus.research-answer-blind-review-pack/1', reviews: packetRows },
    reviewInputSha256: reviewBytes ? sha(reviewBytes) : null,
    utilityKeySha256: jsonHash(utilityKey),
    limitations: ['Blind review source set comes from the answer-specific research-answer-grounding trace; lane-control source receipts are not substituted.',
      'The independent utility key is a separate root-only sidecar and is not included in the review packet.',
      'Dispatch full-read receipts are self-reported tool-read attestations, not independent observation of what a model read.',
      'Dispatch metadata and full-read receipts are independently reopened and hash/time checked; missing proof is reported pending.',
      'Citation URL resolution and scope/contract isolation are measured only from answer-specific production runtime receipts; absent traces remain pending.'] };
  // Output is exclusive and versioned; reruns must use a new directory.
  const output = path.resolve(outputDir);
  if (!inside(root, output)) fail('Evaluation output must be a new directory inside the campaign QA root');
  if (fs.existsSync(output)) fail('Evaluation output directory already exists; use a fresh versioned path');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  // A live campaign may advance while independent batch review is underway.
  // Bind the report to the exact manifest/ledger bytes parsed above.
  for (const [name, bytes] of [['manifest-snapshot.json', manifestBytes], ['campaign-snapshot.json', campaignBytes]]) {
    fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  }
  for (const [name, value, mode] of [['evaluation.json', report, 0o600], ['blind-review-pack.json', report.reviewPacket, 0o600], ['utility-key.json', utilityKey, 0o600]]) {
    const target = path.join(output, name);
    const fd = fs.openSync(target, 'wx', mode);
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return report;
}
function byCaseValues(map) { return [...map.values()]; }

function argsOf(argv) { const out = {}; for (const arg of argv) if (arg.startsWith('--')) { const eq = arg.indexOf('='); out[eq < 0 ? arg.slice(2) : arg.slice(2, eq)] = eq < 0 ? true : arg.slice(eq + 1); } return out; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsOf(process.argv.slice(2));
    const result = collectResearchLiveAnswers({ campaignDir: args.campaign, reviewFile: args.reviews || null, outputDir: args.output,
      administrativeBindings: args['administrative-bindings'] || null,
      preregistration: args['minimum-answerable-sample'] ? { minimumAnswerableSample: Number(args['minimum-answerable-sample']) } : undefined });
    console.log(JSON.stringify({ status: result.answerQuality.status, campaignFinished80Concluded: result.campaign.campaignFinished80Concluded,
      answerQualityAcceptance: result.answerQuality.answerQualityAcceptance, productInvariantStatus: result.evidenceMetrics.productInvariantStatus,
      output: args.output }));
  } catch (error) { console.error(`Research live answer collection rejected: ${String(error?.message ?? error)}`); process.exitCode = 1; }
}

export { collectResearchLiveAnswers, exactCitationBlinding, retrievalScopeEvidence, citationRuntimeEvidence,
  collectProductInvariantEvidence, verifyDispatchReceipt, runtimeReceipts };
