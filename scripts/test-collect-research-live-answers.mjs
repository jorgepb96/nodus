import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectResearchLiveAnswers, exactCitationBlinding, collectProductInvariantEvidence, verifyDispatchReceipt, runtimeReceipts } from './collect-research-live-answers.mjs';
import { validateIndexAuthorization, researchIdentityFingerprint } from './lib/researchLiveIndexAuthorization.mjs';
import { bindResearchLunaDispatch, prepareResearchLunaDispatch, verifyResearchLunaRead } from './research-luna-dispatch.mjs';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchLunaBridge, writeResearchLunaResponse } from './research-luna-bridge.mjs';
import { buildResearchLiveShardAssignment, sourceHashesForProduction } from './lib/researchLiveAnswerShards.mjs';
import { planResearchLiveCases } from './lib/researchLiveAnswerCampaignState.mjs';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(Buffer.from(JSON.stringify(value)));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); };
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'research-answer-collector-')));
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for synthetic local bridge completion');
};
try {
  // Exercise the collector against the actual bridge event/envelope format with
  // deterministic local text; this does not invoke a model or Electron.
  const bridgeRoot = createResearchTestRoot();
  let bridge;
  try {
    bridge = await startResearchLunaBridge({ root: bridgeRoot, maxRequests: 1 });
    const responsePromise = fetch(`${bridge.url}/chat/completions`, { method: 'POST',
      headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
      body: JSON.stringify({ model: bridge.model, messages: [{ role: 'user', content: 'synthetic collector envelope check' }], max_tokens: 20 }) });
    const accepted = await waitFor(() => {
      if (!fs.existsSync(bridge.eventFile)) return null;
      return fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse).find(row => row.event === 'accepted') ?? null;
    });
    const rawFile = path.join(bridge.root, 'artifacts/raw-completions', `${accepted.id}.txt`);
    fs.writeFileSync(rawFile, 'Synthetic deterministic completion.', { flag: 'wx', mode: 0o600 });
    writeResearchLunaResponse(path.join(bridge.requestDirectory, `${accepted.id}.json`), rawFile);
    assert.equal((await responsePromise).status, 200);
    const events = fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    const completionEvent = events.find(row => row.event === 'completed');
    assert.ok(completionEvent.responseBytes > fs.statSync(rawFile).size,
      'bridge responseBytes counts the JSON envelope, not raw completion UTF-8');
    const campaignFixture = { root: bridge.root, answers: [{ bridgeRequestIds: [accepted.id] }] };
    assert.equal(runtimeReceipts(bridge.root, campaignFixture, { root: bridge.root }).completed.length, 1,
      'collector reconstructs the exact bridge envelope hash and byte count');
    const originalEvents = fs.readFileSync(bridge.eventFile, 'utf8');
    const corrupted = events.map(row => row.event === 'completed' ? { ...row, responseBytes: row.responseBytes - 1 } : row);
    fs.writeFileSync(bridge.eventFile, `${corrupted.map(row => JSON.stringify(row)).join('\n')}\n`);
    assert.throws(() => runtimeReceipts(bridge.root, campaignFixture, { root: bridge.root }), /envelope hash\/byte count mismatch/u,
      'collector rejects a bridge byte count that does not match the canonical envelope');
    fs.writeFileSync(bridge.eventFile, originalEvents);
  } finally {
    if (bridge) await bridge.close();
    fs.rmSync(bridgeRoot, { recursive: true, force: true });
  }
  // An explicit, hash-bound forensic supplement can explain exactly one
  // missing-hash administrative abandonment, while generic omissions remain invalid.
  {
    const forensicRoot = path.join(temp, 'forensic-binding-root'), artifacts = path.join(forensicRoot, 'artifacts');
    const id = '3505941d-6660-43d8-b3f1-09684b80f841', request = Buffer.from('{"messages":[] }\n');
    fs.mkdirSync(path.join(artifacts, 'requests'), { recursive: true });
    fs.mkdirSync(path.join(artifacts, 'case-request-mappings'), { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'requests', `${id}.json`), request);
    writeJson(path.join(artifacts, 'case-request-mappings', `${id}.json`), { requestId: id, caseId: 'R029' });
    const originalEvents = `${JSON.stringify({ event: 'accepted', id, requestHash: sha(request), requestBytes: request.length })}\n`;
    const snapshotPath = path.join(temp, 'forensic-original-events.jsonl'); fs.writeFileSync(snapshotPath, originalEvents);
    const receiptPath = path.join(temp, 'forensic-loss-receipt.json');
    const receipt = { format: 'nodus.qa-controller-loss-recovery/1', scope: { root: forensicRoot, caseId: 'R029', orphanRequestId: id },
      classification: { status: 'protocol-failure', errorClassification: 'qa-controller-process-lost', success: false },
      acceptedEvent: { requestHash: sha(request) }, originalHashes: { rootEvents: sha(Buffer.from(originalEvents)) } };
    writeJson(receiptPath, receipt);
    const currentEvents = [{ event: 'accepted', id, requestHash: sha(request), requestBytes: request.length },
      { event: 'abandoned', id, reason: 'qa-controller-process-lost', provenance: { type: 'forensic-recovery', receipt: receiptPath } }];
    fs.writeFileSync(path.join(artifacts, 'events.jsonl'), `${currentEvents.map(row => JSON.stringify(row)).join('\n')}\n`);
    const campaignFixture = { root: forensicRoot, answers: [{ caseId: 'R029', attemptStatus: 'protocol-failure', bridgeRequestIds: [id], bridgeCompletionIds: [] }] };
    const manifestFixture = { root: forensicRoot };
    const binding = { format: 'nodus.qa-administrative-event-binding/1', event: 'abandoned', id, requestHash: sha(request),
      forensicReceiptPath: receiptPath, forensicReceiptSha256: sha(Buffer.from(fs.readFileSync(receiptPath))),
      originalEventsSnapshotPath: snapshotPath, originalEventsSnapshotSha256: sha(Buffer.from(originalEvents)),
      reason: 'qa-controller-process-lost', concludedStatus: 'protocol-failure', completedBridgeEvent: false };
    const bindingPath = path.join(temp, 'forensic-bindings.json'); writeJson(bindingPath, [binding]);
    assert.equal(runtimeReceipts(forensicRoot, campaignFixture, manifestFixture, { administrativeBindings: bindingPath }).allTerminal, true);
    for (const mutate of [row => ({ ...row, requestHash: '0'.repeat(64) }),
      row => ({ ...row, forensicReceiptSha256: '0'.repeat(64) }), row => ({ ...row, reason: 'generic-abandoned' }),
      row => ({ ...row, completedBridgeEvent: true })]) {
      writeJson(bindingPath, [mutate(binding)]);
      assert.throws(() => runtimeReceipts(forensicRoot, campaignFixture, manifestFixture, { administrativeBindings: bindingPath }),
        /administrative|forensic|Abandoned/iu);
    }
    writeJson(bindingPath, []);
    assert.throws(() => runtimeReceipts(forensicRoot, campaignFixture, manifestFixture), /Abandoned event does not bind/u);
    fs.writeFileSync(path.join(artifacts, 'events.jsonl'), `${JSON.stringify({ event: 'abandoned', id: 'unaccepted', requestHash: sha(request) })}\n`);
    assert.throws(() => runtimeReceipts(forensicRoot, campaignFixture, manifestFixture), /Abandoned event does not bind/u);
  }
  const root = path.join(temp, 'root'), campaignDir = path.join(temp, 'campaign');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true }); fs.mkdirSync(campaignDir);
  writeJson(path.join(root, 'isolation.json'), { format: 'nodus.isolated-research-profile/1', root });
  fs.mkdirSync(path.join(root, 'artifacts/case-request-mappings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/events.jsonl'), '');
  const dispatchRoot = path.join(temp, 'dispatch-proof-root'), dispatchArtifacts = path.join(dispatchRoot, 'artifacts');
  const dispatchId = '596cb54b-fa38-4946-84c4-b0b347c5677b', dispatchNow = Date.now();
  for (const folder of ['requests', 'dispatch-jobs', 'raw-completions']) fs.mkdirSync(path.join(dispatchArtifacts, folder), { recursive: true });
  writeJson(path.join(dispatchRoot, 'isolation.json'), { format: 'nodus.isolated-research-profile/1', root: dispatchRoot });
  const requestBytes = Buffer.from('{"messages":[],"response_format":{"type":"json_object"}}\n');
  fs.writeFileSync(path.join(dispatchArtifacts, 'requests', `${dispatchId}.json`), requestBytes);
  fs.writeFileSync(path.join(dispatchArtifacts, 'events.jsonl'), `${JSON.stringify({ event: 'accepted', at: new Date(dispatchNow - 100).toISOString(),
    deadlineAt: new Date(dispatchNow + 300_000).toISOString(), id: dispatchId, requestHash: sha(requestBytes), requestBytes: requestBytes.length })}\n`);
  const preparedDispatch = prepareResearchLunaDispatch({ root: dispatchRoot, nodeBinary: process.execPath,
    responseHelper: fileURLToPath(new URL('./research-luna-response.mjs', import.meta.url)), now: dispatchNow });
  bindResearchLunaDispatch({ root: dispatchRoot, requestId: dispatchId, task: '/root/test_dispatch_proof' });
  const dispatchJob = JSON.parse(fs.readFileSync(preparedDispatch.jobFile, 'utf8'));
  writeJson(dispatchJob.readAuditFile, { ...dispatchJob.expectedReadAudit, readAt: new Date(dispatchNow).toISOString() });
  const actualDispatchReceipt = verifyResearchLunaRead({ root: dispatchRoot, requestId: dispatchId, now: dispatchNow });
  assert.equal(verifyDispatchReceipt(dispatchRoot, dispatchId, actualDispatchReceipt).status, 'verified',
    'collector reopens actual job, bound prompt/execution metadata, and complete-read audit');
  assert.equal(verifyDispatchReceipt(dispatchRoot, dispatchId, { ...actualDispatchReceipt, auditSha256: '0'.repeat(64) }).status, 'failed',
    'stored read receipts cannot substitute for the independently reopened audit');
  const missingDispatchRoot = path.join(temp, 'dispatch-proof-missing');
  fs.mkdirSync(path.join(missingDispatchRoot, 'artifacts'), { recursive: true });
  assert.equal(verifyDispatchReceipt(missingDispatchRoot, dispatchId, null).status, 'pending',
    'missing dispatch proof remains pending instead of being scored as semantic quality failure');
  const preregFile = path.join(temp, 'preregistration.json');
  const queries = Array.from({ length: 80 }, (_, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`, question: `Question ${index + 1}`, kind: index < 60 ? 'answerable' : 'insufficient-evidence' }));
  const annotationGold = Object.fromEntries(queries.map(row => [row.id, [{ expected: `expected-${row.id}` }]]));
  const prereg = { format: 'nodus.research-live-evidence-preregistration/1', counts: { total: 80 }, queries, annotationGold };
  writeJson(preregFile, prereg);
  const cases = queries.map((q, index) => {
    const sourceContext = `context ${q.id}`;
    const sourcesContext = { receipts: [] };
    const sourceContextSha256 = sha(Buffer.from(sourceContext));
    const sourcesContextSha256 = hash(sourcesContext);
    const sourceCaseHash = hash({ id: q.id, question: q.question, language: 'en', sourceContextHash: sourceContextSha256, receiptsHash: sourcesContextSha256 });
    const kind = index < 10 ? 'complex-fixture' : index < 20 ? 'hard' : index < 60 ? 'core' : 'absence';
    return { id: q.id, question: q.question, language: 'en', kind, isAnswerable: index < 60,
      sourceContext, sourceContextSha256, sourcesContext, sourcesContextSha256, sourceCaseHash };
  });
  const casesSha256 = hash(cases.map(row => ({ id: row.id, sourceCaseHash: row.sourceCaseHash })));
  const sourceFile = path.join(temp, 'source-snapshot.json');
  const canonicalModelContract = { profileId: 'embeddinggemma-2-text-q8-512-v1', dimensions: 512, pooling: 'mean' };
  const indexPairs = Array.from({ length: 40 }, (_, index) => {
    const documentId = `doc-${index + 1}`, revision = `revision-${index + 1}`, attachmentId = `attachment-${index + 1}`;
    const lexicalIdentity = { documentId, revision, attachmentId, corpusFingerprint: `content-${index + 1}`, embedding: null };
    const rawParameters = { contract: JSON.stringify(canonicalModelContract) };
    const vectorIdentity = { ...lexicalIdentity, embedding: { provider: 'nodus', model: 'embeddinggemma-2-text-q8-512-v1',
      dimensions: 512, metric: 'cosine', parameters: rawParameters } };
    return { documentId, lexicalIdentity, lexicalIdentityFingerprint: researchIdentityFingerprint(lexicalIdentity),
      lexicalKey: researchIdentityFingerprint(lexicalIdentity), vectorIdentity,
      vectorIdentityFingerprint: researchIdentityFingerprint(vectorIdentity), vectorKey: researchIdentityFingerprint(vectorIdentity),
      vectorParameters: { raw: rawParameters, parsedContract: canonicalModelContract },
      state: { lexicalReady: 1, lexicalEmbeddingReady: 0, vectorLexicalReady: 1, vectorEmbeddingReady: 1, lexicalIdentityHasNullEmbedding: true },
      vectorStats: { passageCount: 2, vectorCount: 2, minVectorBytes: 2048, maxVectorBytes: 2048 } };
  });
  const profileContract = { id: 'embeddinggemma-2-text-q8-512-v1', dimensions: 512, embeddingModelContract: canonicalModelContract,
    indexContracts: indexPairs.map(pair => ({ documentId: pair.documentId, indexedSource: { revision: pair.lexicalIdentity.revision,
      attachmentId: pair.lexicalIdentity.attachmentId, indexKeys: [pair.lexicalKey] } })) };
  const scopeContract = { scopeId: 'scope-1', resolvedDocumentIds: indexPairs.map(pair => pair.documentId),
    documents: indexPairs.map(pair => ({ id: pair.documentId, indexedSource: { revision: pair.lexicalIdentity.revision,
      attachmentId: pair.lexicalIdentity.attachmentId, indexKeys: [pair.lexicalKey] } })) };
  const syntheticReceipt = { format: 'nodus.readonly-semantic-identity-pairs/1', evidence: { sqliteOpenedReadonly: true,
    queriedColumnsExcludeTextAndVectorBytes: true, sourceSnapshotSha256: 's'.repeat(64), reportSha256: 'r'.repeat(64) },
    pairs: indexPairs, mismatches: [], summary: { pairCount: 40, sourceIdentitiesMatchAll: true,
      productionFingerprintsMatchAll: true, contractMatchAll: true, embeddedReadyAll: true, vectorCountsAndWidthsCorrectAll: true } };
  const identitySource = { format: 'nodus.research-case-sources/1', profileId: 'embeddinggemma-2-text-q8-512-v1',
    profileContract: { ...profileContract, provider: 'nodus' }, scopeContract: { ...scopeContract, permissionFingerprint: 'permission-1' },
    cases: [{ id: 'R001', retrievalTraces: [{ type: 'documentary-retrieval', scopeId: 'scope-1',
      permissionFingerprint: 'permission-1', profile: { provider: 'nodus', model: 'embeddinggemma-2-text-q8-512-v1' },
      contract: canonicalModelContract, vectorKeys: [indexPairs[0].vectorKey] }] }] };
  const identityValidation = validateIndexAuthorization({ sourceSnapshot: identitySource, receipt: syntheticReceipt,
    expectedSourceSha256: 's'.repeat(64), expectedReportSha256: 'r'.repeat(64) });
  const inputSource = { format: 'nodus.research-case-sources/1', profileId: 'embeddinggemma-2-text-q8-512-v1', notebookId: 'fixture',
    scopeContract, profileContract, cases };
  writeJson(sourceFile, inputSource);
  const sourceSnapshotSha256 = sha(fs.readFileSync(sourceFile));
  const preregistrationSha256 = sha(fs.readFileSync(preregFile));
  const sourceVersion = { sourceSnapshot: sourceFile, sourceSnapshotSha256, preregistration: preregFile, preregistrationSha256,
    casesSha256, sourceFiles: {} };
  const snapshotPath = path.join(root, 'artifacts/source-context-snapshot.json');
  writeJson(snapshotPath, { format: 'nodus.research-live-answer-source-snapshot/1', sourceVersion, profileContract, scopeContract, cases });
  const actualRunnerFile = path.resolve('scripts/research-live-answer-campaign.mjs');
  const sourceFiles = { 'scripts/research-live-answer-campaign.mjs': sha(fs.readFileSync(actualRunnerFile)) };
  sourceVersion.sourceFiles = sourceFiles;
  writeJson(snapshotPath, { format: 'nodus.research-live-answer-source-snapshot/1', sourceVersion, profileContract, scopeContract, cases });
  const manifest = { format: 'nodus.research-live-answer-campaign/1', mode: 'structured-only', root, sourceSnapshot: snapshotPath,
    sourceVersion, sourceSnapshotSha256, preregistrationSha256, casesSha256, sourceFiles,
    profileContract, scopeContract,
    profileContractSha256: hash(profileContract), scopeContractSha256: hash(scopeContract) };
  writeJson(path.join(campaignDir, 'manifest.json'), manifest);
  const attempts = cases.map((row, index) => ({ caseId: row.id, caseAttemptId: `attempt-${row.id}`, segmentId: 'segment-001',
    sourceCaseHash: row.sourceCaseHash, sourceContextHash: row.sourceContextSha256, receiptsHash: row.sourcesContextSha256,
    question: row.question, language: 'en', attempted: true, finishedAt: new Date().toISOString(), status: 'failed',
    attemptStatus: 'protocol-failure', receiptsComplete: false, bridgeRequestIds: [], bridgeCompletionIds: [], answer: `Answer ${row.id}`,
    citationResolution: [], traces: [{ type: 'research-answer-grounding', status: 'complete', answer: `Answer ${row.id}`,
      sources: [{ id: '1', title: 'Source', text: 'Evidence text', citation: 'nodus://passage/1' }] }] }));
  writeJson(path.join(campaignDir, 'campaign.json'), { format: manifest.format, root, answers: attempts });

  // A response returned by the bridge is still an invalid measurement when
  // its read attestation has been overwritten after the original run.
  {
    const bridge = await startResearchLunaBridge({ root, maxRequests: 1 });
    try {
      const responsePromise = fetch(`${bridge.url}/chat/completions`, { method: 'POST',
        headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
        body: JSON.stringify({ model: bridge.model, messages: [{ role: 'user', content: 'Synthetic audit integrity regression' }], max_tokens: 20 }) });
      const accepted = await waitFor(() => fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean)
        .map(JSON.parse).find(row => row.event === 'accepted'));
      const first = { ...attempts[0], status: 'returned', attemptStatus: 'answered', receiptsComplete: true,
        bridgeRequestIds: [accepted.id], bridgeCompletionIds: [accepted.id] };
      const mappingFile = path.join(root, 'artifacts/case-request-mappings', `${accepted.id}.json`);
      writeJson(mappingFile, {
        format: 'nodus.research-live-answer-case-request/1', requestId: accepted.id,
        caseId: first.caseId, caseAttemptId: first.caseAttemptId, segmentId: first.segmentId,
        sourceContextHash: first.sourceContextHash, receiptsHash: first.receiptsHash, sourceCaseHash: first.sourceCaseHash });
      const prepared = prepareResearchLunaDispatch({ root, nodeBinary: process.execPath,
        responseHelper: fileURLToPath(new URL('./research-luna-response.mjs', import.meta.url)),
        mappingFile, mappingSha256: sha(fs.readFileSync(mappingFile)) });
      bindResearchLunaDispatch({ root, requestId: accepted.id, task: '/root/synthetic_collector_integrity' });
      const job = JSON.parse(fs.readFileSync(prepared.jobFile, 'utf8'));
      writeJson(job.readAuditFile, { ...job.expectedReadAudit, readAt: new Date().toISOString() });
      first.dispatchReadReceipts = [verifyResearchLunaRead({ root, requestId: accepted.id })];
      fs.writeFileSync(job.rawFile, 'Synthetic deterministic completion.', { flag: 'wx' });
      writeResearchLunaResponse(job.requestFile, job.rawFile);
      assert.equal((await responsePromise).status, 200);
      writeJson(path.join(campaignDir, 'campaign.json'), { format: manifest.format, root, answers: [first, ...attempts.slice(1)] });
      const before = collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/integrity-before') });
      assert.equal(before.caseOutcomes[0].answered, true,
        `a complete valid bridge/read chain can be reviewed: ${JSON.stringify(before.evidenceMetrics.dispatchReadProof)}`);
      writeJson(job.readAuditFile, { unrelated: true });
      const after = collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/integrity-after') });
      assert.equal(after.caseOutcomes[0].answered, false, 'a completed response cannot bypass a corrupted read proof');
      assert.equal(after.reviewPacket.reviews[0].answer, '', 'invalid measurements never enter the factual review packet');
      assert.equal(after.evidenceMetrics.dispatchReadProof.failed, 1);
      assert.equal(JSON.parse(fs.readFileSync(path.join(campaignDir, 'campaign.json'), 'utf8')).answers[0].answer,
        first.answer, 'the original application answer remains preserved');
    } finally {
      await bridge.close();
      fs.writeFileSync(path.join(root, 'artifacts/events.jsonl'), '');
      writeJson(path.join(campaignDir, 'campaign.json'), { format: manifest.format, root, answers: attempts });
    }
  }

  const blind = exactCitationBlinding('refs nodus://passage/1 and nodus://passage/10; citation nodus://passage/1.', [
    { id: '1' }, { id: '10' },
  ], 'review-x');
  assert.match(blind, /nodus:\/\/review-source\/review-x\/1/u);
  assert.match(blind, /nodus:\/\/review-source\/review-x\/2/u);
  assert.match(blind, /nodus:\/\/review-source\/review-x\/1\./u, 'punctuation after an exact citation remains outside its URL');
  assert.doesNotMatch(blind, /nodus:\/\/passage\//u, 'exact URL replacement must not leave prefix-colliding original targets');

  const runtimeManifest = { profileContract, scopeContract, profileContractSha256: hash(profileContract), scopeContractSha256: hash(scopeContract) };
  const runtimeIndexAuthorization = { status: 'verified', receipt: { receiptSha256: 'a'.repeat(64),
    originalSourceSnapshotSha256: 's'.repeat(64), reportSha256: 'r'.repeat(64), sqliteSha256: 'd'.repeat(64), fingerprintSourceSha256: 'f'.repeat(64) },
  validation: identityValidation };
  const passageId = 'documentary:scope-1:passage-1';
  const grounding = { type: 'research-answer-grounding', status: 'complete', sources: [{ id: passageId,
    citation: `nodus://passage/${encodeURIComponent(passageId)}`,
    text: 'Source title: Source title\nSource locator: p. 3\nVerbatim excerpt:\nevidence excerpt' }] };
  const runtimeAttempt = { caseId: 'R001', sourceContextHash: 'context-hash', attemptStatus: 'answered', receiptsComplete: true,
    answer: `Supported [source](nodus://passage/${encodeURIComponent(passageId)})`, citationResolution: [{ citationId: passageId,
      passage: { passage_id: passageId, libraryItemId: 'doc-1', text: 'evidence excerpt', page_label: 'p. 3', work: { title: 'Source title' } } }],
    traces: [grounding, { type: 'documentary-retrieval', scopeId: 'scope-1', contract: { ...canonicalModelContract }, vectorKeys: [indexPairs[0].vectorKey],
      retrieval: { semantic: [{ id: 'hit-1', documentId: 'doc-1', title: 'mentions out-of-scope document-evil in prose' }],
        lexical: [], lexicalQueries: [{ candidates: [] }], selected: [{ id: 'hit-1', documentId: 'doc-1' }] } }] };
  const runtimeMeasured = collectProductInvariantEvidence({ attempts: [runtimeAttempt], manifest: runtimeManifest, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(runtimeMeasured.status, 'measured');
  assert.equal(runtimeMeasured.policyEvidence.citationResolution.captured, 1);
  assert.equal(runtimeMeasured.policyEvidence.citationResolution.resolved, 1,
    'getPassage must bind citation ID, authorized document, exact excerpt, title, and locator');
  assert.equal(runtimeMeasured.scopeContractIsolation.observedScopeLeaks, 0,
    'untrusted text mentioning another document ID does not count as a scope leak');
  const contractMismatch = structuredClone(runtimeAttempt);
  contractMismatch.traces[1].contract = { profileId: canonicalModelContract.profileId, dimensions: 512, pooling: 'max' };
  const changedContract = collectProductInvariantEvidence({ attempts: [contractMismatch], manifest: runtimeManifest, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(changedContract.status, 'failed', 'matching dimensions do not substitute for exact canonical contract identity');
  assert.equal(changedContract.scopeContractIsolation.observedContractLeaks, 1);
  const lexicalScope = structuredClone(runtimeManifest);
  lexicalScope.scopeContract.documents[0].indexedSource.indexKeys = ['lexical-A'];
  lexicalScope.profileContract.indexContracts[0].indexedSource.indexKeys = ['semantic-B'];
  const semanticTrace = structuredClone(runtimeAttempt);
  semanticTrace.traces[1].vectorKeys = ['semantic-B'];
  const crossIdentity = collectProductInvariantEvidence({ attempts: [semanticTrace], manifest: lexicalScope, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(crossIdentity.status, 'failed', 'semantic B keys cannot be authorized by scope-local lexical A without the identity receipt');
  assert.ok(crossIdentity.scopeContractIsolation.observedScopeLeaks > 0);
  assert.ok(crossIdentity.scopeContractIsolation.observedContractLeaks > 0);
  const scopeMismatch = structuredClone(runtimeAttempt);
  scopeMismatch.traces[1].retrieval.semantic.push({ id: 'foreign-hit', documentId: 'document-evil' });
  const outOfScope = collectProductInvariantEvidence({ attempts: [scopeMismatch], manifest: runtimeManifest, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(outOfScope.status, 'failed');
  assert.ok(outOfScope.scopeContractIsolation.observedScopeLeaks > 0);
  const missingProof = collectProductInvariantEvidence({ attempts: [{ ...runtimeAttempt, traces: [grounding] }], manifest: runtimeManifest, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(missingProof, null, 'missing retrieval receipt leaves invariant evidence pending rather than claiming zero leaks');
  const missingAuthorization = structuredClone(runtimeManifest);
  delete missingAuthorization.scopeContract.documents[0].indexedSource.indexKeys;
  assert.equal(collectProductInvariantEvidence({ attempts: [runtimeAttempt], manifest: missingAuthorization, planned: 1,
    indexAuthorization: runtimeIndexAuthorization }), null,
    'missing full-identity index authorization proof remains pending');
  const unresolvedPassage = structuredClone(runtimeAttempt);
  unresolvedPassage.citationResolution[0].passage = null;
  const unresolved = collectProductInvariantEvidence({ attempts: [unresolvedPassage], manifest: runtimeManifest, planned: 1,
    indexAuthorization: runtimeIndexAuthorization });
  assert.equal(unresolved.status, 'failed');
  assert.equal(unresolved.citationResolution.resolved, 0);

  const first = collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/evaluation-1'),
    preregistration: { minimumAnswerableSample: 60 } });
  assert.equal(first.campaign.planned, 80);
  assert.equal(first.campaign.concluded, 80, 'protocol failures are concluded cases, but remain negative outcomes');
  assert.equal(first.campaign.campaignFinished80Concluded, true);
  assert.equal(first.campaign.sourceSnapshotSha256, manifest.sourceVersion.sourceSnapshotSha256,
    'evaluation provenance reads source hashes from sourceVersion');
  assert.ok(first.reviewPacket.reviews.every(row => !row.reviewId.includes('undefined')));
  assert.equal(first.answerQuality.arms.structured.denominators.answerablePlanned, 60);
  assert.equal(first.answerQuality.arms.structured.denominators.insufficientEvidencePlanned, 20);
  assert.equal(first.answerQuality.arms.structured.metrics.answerableCorrectAndComplete.passed, 0);
  assert.equal(first.answerQuality.arms.structured.denominators.publishedAnswers, 0,
    'a failed attempt with raw text does not count as a published, verified answer');
  assert.equal(first.answerQuality.productInvariants.status, 'pending');
  assert.equal(first.evidenceMetrics.productCitationResolution, null,
    'missing answer-specific retrieval proof leaves citation and scope invariants pending');
  assert.equal(first.evidenceMetrics.productInvariantStatus, 'pending');
  // A shard collector evaluates only the assigned 26 while retaining all 80
  // frozen contexts and the original quality sample requirement.
  const shardCampaignDir = path.join(temp, 'campaign-shard'); fs.mkdirSync(shardCampaignDir);
  const closedDir = path.join(temp, 'closed-two-case'); fs.mkdirSync(closedDir);
  const productionPin = { 'electron/ai/researchCorpusScope.ts': sha(fs.readFileSync('electron/ai/researchCorpusScope.ts')) };
  const allSourceFiles = { ...sourceFiles, ...productionPin };
  const shardSourceVersion = { ...sourceVersion, sourceFiles: allSourceFiles };
  const shardSnapshotPath = path.join(root, 'artifacts/shard-source-context-snapshot.json');
  writeJson(shardSnapshotPath, { format: 'nodus.research-live-answer-source-snapshot/1', sourceVersion: shardSourceVersion,
    profileContract, scopeContract, cases });
  const closedManifest = { format: manifest.format, root, sourceSnapshotSha256, preregistrationSha256, casesSha256,
    sourceFiles: allSourceFiles, sourceSnapshot: shardSnapshotPath, profileContract, scopeContract };
  const closedAnswers = ['R001', 'R002'].map((caseId, index) => ({ caseId,
    sourceCaseHash: cases.find(row => row.id === caseId).sourceCaseHash, attempted: true,
    attemptStatus: index === 0 ? 'answered' : 'protocol-failure', finishedAt: '2026-10-01T00:00:00.000Z' }));
  const closedCampaign = { root, finishedAt: '2026-10-01T00:00:00.000Z', answers: closedAnswers };
  writeJson(path.join(closedDir, 'manifest.json'), closedManifest);
  writeJson(path.join(closedDir, 'campaign.json'), closedCampaign);
  const closedManifestBytes = fs.readFileSync(path.join(closedDir, 'manifest.json'));
  const closedCampaignBytes = fs.readFileSync(path.join(closedDir, 'campaign.json'));
  const fullSnapshotBytes = fs.readFileSync(shardSnapshotPath);
  const assignment = buildResearchLiveShardAssignment({ plan: planResearchLiveCases(cases), concludedAnswers: closedAnswers,
    sourceSnapshotSha256, preregistrationSha256, casesSha256, profileContractSha256: hash(profileContract),
    scopeContractSha256: hash(scopeContract), productionSourceFiles: sourceHashesForProduction(allSourceFiles),
    closedCampaignManifestSha256: sha(closedManifestBytes), closedCampaignSha256: sha(closedCampaignBytes),
    fullSourceSnapshotSha256: sha(fullSnapshotBytes), closedCampaignPath: closedDir, fullSourceSnapshotPath: shardSnapshotPath });
  const assignmentFile = path.join(temp, 'assignment.json'); writeJson(assignmentFile, assignment);
  const selectedShard = assignment.shards[0];
  const shardManifest = { ...manifest, sourceSnapshot: shardSnapshotPath, sourceVersion: shardSourceVersion, sourceFiles: allSourceFiles,
    profileContractSha256: hash(profileContract), scopeContractSha256: hash(scopeContract),
    assignment: assignmentFile, assignmentSha256: sha(fs.readFileSync(assignmentFile)), shardId: selectedShard.id,
    plannedCount: selectedShard.caseIds.length, assignedCaseIds: selectedShard.caseIds };
  writeJson(path.join(shardCampaignDir, 'manifest.json'), shardManifest);
  writeJson(path.join(shardCampaignDir, 'campaign.json'), { format: manifest.format, root, answers: [] });
  const shardEvaluation = collectResearchLiveAnswers({ campaignDir: shardCampaignDir,
    outputDir: path.join(root, 'artifacts/shard-evaluation'), preregistration: { minimumAnswerableSample: 60 } });
  assert.equal(shardEvaluation.campaign.planned, 26);
  assert.equal(shardEvaluation.campaign.fullSnapshotPlanned, 80);
  assert.equal(shardEvaluation.caseOutcomes.length, 26);
  assert.ok(shardEvaluation.caseOutcomes.every(row => selectedShard.caseIds.includes(row.caseId)));
  assert.equal(shardEvaluation.answerQuality.answerQualityStatus, 'pending',
    'an isolated shard cannot claim campaign-level quality before the global sample is assembled');
  assert.equal(shardEvaluation.campaign.assignedCampaignFinished, false);
  assert.equal(shardEvaluation.answerQuality.acceptance, null,
    'a 26-case shard cannot lower the preregistered 60-answerable-case campaign threshold');
  const outsideCase = cases.find(row => !selectedShard.caseIds.includes(row.id));
  writeJson(path.join(shardCampaignDir, 'campaign.json'), { format: manifest.format, root,
    answers: [{ ...attempts.find(row => row.caseId === outsideCase.id) }] });
  assert.throws(() => collectResearchLiveAnswers({ campaignDir: shardCampaignDir,
    outputDir: path.join(root, 'artifacts/shard-invalid-roster') }), /unknown or duplicate case ID/u,
  'the collector rejects a known full-snapshot case that is not assigned to this shard');
  const keyFile = path.join(root, 'artifacts/evaluation-1/utility-key.json');
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'artifacts/evaluation-1/blind-review-pack.json'), 'utf8'), /annotationGold|expected-R/u);
  assert.throws(() => collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/evaluation-1') }), /already exists/u,
    'versioned output directories cannot be silently overwritten');

  const packet = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/evaluation-1/blind-review-pack.json'), 'utf8'));
  const reviews = packet.reviews.map(row => ({ reviewId: row.reviewId, answerSha256: row.answerSha256, sourceHash: row.sourceHash,
    reviewer: 'independent-source-reviewer', notes: 'Synthetic tooling fixture; not an actual model review.',
    correct: true, complete: true, noMaterialUnsupportedClaims: true, insufficientEvidenceHandled: true }));
  const reviewFile = path.join(temp, 'reviews.json'); writeJson(reviewFile, { format: 'nodus.research-answer-blind-reviews/1', reviews });
  const staleReviews = reviews.map(row => ({ ...row })); staleReviews[0].sourceHash = '0'.repeat(64);
  const staleReviewFile = path.join(temp, 'stale-reviews.json'); writeJson(staleReviewFile, { format: 'nodus.research-answer-blind-reviews/1', reviews: staleReviews });
  assert.throws(() => collectResearchLiveAnswers({ campaignDir, reviewFile: staleReviewFile,
    outputDir: path.join(root, 'artifacts/evaluation-stale-review'), preregistration: { minimumAnswerableSample: 60 } }), /hashes do not bind/u);
  const second = collectResearchLiveAnswers({ campaignDir, reviewFile, outputDir: path.join(root, 'artifacts/evaluation-2'),
    preregistration: { minimumAnswerableSample: 60 } });
  assert.equal(second.answerQuality.answerQualityStatus, 'measured');
  assert.equal(second.answerQuality.answerQualityAcceptance, false, 'synthetic review booleans cannot promote failed attempts into answered utility');
  assert.equal(second.answerQuality.productInvariants.status, 'pending');
  assert.equal(second.answerQuality.acceptance, null, 'quality review alone cannot certify product invariants');

  const campaignPath = path.join(campaignDir, 'campaign.json');
  const completeCampaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
  completeCampaign.answers.pop();
  writeJson(campaignPath, completeCampaign);
  const pending = collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/evaluation-3') });
  assert.equal(pending.campaign.notExecuted, 1);
  assert.equal(pending.campaign.campaignFinished80Concluded, false);
  assert.equal(pending.answerQuality.answerQualityStatus, 'pending', 'a not-executed planned item keeps campaign-level quality pending');
  writeJson(campaignPath, { ...completeCampaign, answers: attempts });

  const staleManifest = JSON.parse(fs.readFileSync(path.join(campaignDir, 'manifest.json'), 'utf8'));
  staleManifest.sourceVersion.sourceSnapshotSha256 = 'f'.repeat(64);
  writeJson(path.join(campaignDir, 'manifest.json'), staleManifest);
  assert.throws(() => collectResearchLiveAnswers({ campaignDir, outputDir: path.join(root, 'artifacts/evaluation-4') }), /stale/u);
  console.log('PASS current live-answer collector: fixed 80-item denominator, failed-attempt handling, exact citation blinding, independent review binding, and pending product invariants.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
