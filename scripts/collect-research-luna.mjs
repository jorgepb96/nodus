#!/usr/bin/env node
/** Offline, blinded collection for the fixed Luna research QA campaign. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RESEARCH_ANSWER_QUALITY_POLICY, evaluateResearchAnswerQuality } from './lib/researchAnswerQualityPolicy.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = 'embeddinggemma-2-text-q8-512-v1';
const CASE_NAMES = ['policy', 'negation', 'correction', 'dates', 'statistics', 'paper', 'calculation', 'sensor', 'absent-data', 'absent-price'];
const ARMS = ['legacy', 'structured'];
const FORMAT = 'research-luna-directed/1';
const ISOLATION_FORMAT = 'nodus.isolated-research-profile/1';
const DEFAULT_DIRECTORY = path.join(REPO, 'audit/research-luna-directed');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function regularFile(file, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Unsafe or oversized input file: ${path.basename(file)}`);
  return stat;
}

function safeDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Campaign directory must be a real directory');
  return fs.realpathSync(directory);
}

function buildCases(archiveBytes) {
  const archive = JSON.parse(archiveBytes.toString('utf8'));
  const found = new Map();
  for (const row of archive.answers ?? []) {
    const name = String(row.name ?? '').replace(/^heldout-/u, '');
    if (!CASE_NAMES.includes(name) || found.has(name)) continue;
    const grounding = row.traces?.find(trace => trace.type === 'research-answer-grounding' && trace.sources?.length);
    if (!grounding) continue;
    const caseId = `${PROFILE}/${name}`;
    const sources = grounding.sources.map((source, index) => {
      const marker = 'Verbatim excerpt:\n';
      const position = source.text.lastIndexOf(marker);
      if (position < 0) throw new Error(`Frozen source lacks original excerpt boundary: ${name}`);
      const get = label => new RegExp(`^${label}: (.*)$`, 'm').exec(source.text)?.[1];
      const id = `qa-replay:${caseId}:${index}`;
      const authors = get('Source authors'), year = get('Source year');
      return {
        id,
        label: get('Source title') ?? source.label,
        pageLabel: get('Source locator'),
        summary: source.text.slice(position + marker.length),
        ...(authors ? { authors: authors.split('; ') } : {}),
        ...(year && Number.isFinite(Number(year)) ? { year: Number(year) } : {}),
        reason: get('Evidence provenance'),
        citation: `nodus://passage/${encodeURIComponent(id)}`,
      };
    });
    const sourceContext = JSON.stringify({ contexto_modular_seleccionado: {
      research_scope: { documentary_evidence_required: true }, pasajes_relevantes: sources,
    } });
    found.set(name, {
      id: caseId, profile: PROFILE, name, question: grounding.question, sources,
      sourceContext, sourceHash: sha(sourceContext), positive: !name.startsWith('absent-'),
    });
  }
  const missing = CASE_NAMES.filter(name => !found.has(name));
  if (missing.length) throw new Error(`Frozen Q8-512 replay cases missing: ${missing.join(', ')}`);
  return CASE_NAMES.map(name => found.get(name));
}

function loadAndValidate(directory) {
  const realDirectory = safeDirectory(directory);
  const manifestFile = path.join(realDirectory, 'manifest.json');
  const campaignFile = path.join(realDirectory, 'campaign.json');
  regularFile(manifestFile); regularFile(campaignFile);
  const manifest = json(manifestFile), campaign = json(campaignFile);
  if (manifest.format !== FORMAT || campaign.format !== FORMAT) throw new Error(`Expected ${FORMAT} manifest and campaign`);
  if (!manifest.sourceVersion || manifest.sourceVersion.archive !== 'audit/research-chat-grounding/final-82dac50f/embeddinggemma-2-text-q8-512-v1.json') {
    throw new Error('Campaign does not reference the frozen Q8-512 replay archive');
  }
  const archive = path.resolve(REPO, manifest.sourceVersion.archive);
  const archiveRelative = path.relative(REPO, archive);
  if (archiveRelative.startsWith(`..${path.sep}`) || archiveRelative === '..' || path.isAbsolute(archiveRelative)) throw new Error('Archive path escapes repository');
  regularFile(archive);
  const archiveBytes = fs.readFileSync(archive);
  const archiveHash = sha(archiveBytes);
  if (archiveHash !== manifest.sourceVersion.archiveHash
      || manifest.sourceVersion.files?.[manifest.sourceVersion.archive] !== archiveHash) {
    throw new Error('Frozen source archive hash does not match manifest');
  }
  const cases = buildCases(archiveBytes);
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 10) throw new Error('Manifest must retain all ten fixed Q8-512 cases');
  const manifestCases = new Map(manifest.cases.map(item => [item.id, item]));
  if (manifestCases.size !== 10) throw new Error('Manifest case IDs must be unique');
  for (const input of cases) {
    const frozen = manifestCases.get(input.id);
    if (!frozen || frozen.name !== input.name || frozen.profile !== undefined && frozen.profile !== PROFILE
        || frozen.question !== undefined && frozen.question !== input.question
        || frozen.positive !== input.positive || frozen.sourceCount !== undefined && frozen.sourceCount !== input.sources.length
        || frozen.sourceHash !== input.sourceHash) {
      throw new Error(`Frozen source hash or metadata mismatch for ${input.name}`);
    }
  }
  if (campaign.root !== manifest.root || typeof campaign.root !== 'string' || !path.isAbsolute(campaign.root)) {
    throw new Error('Campaign and manifest do not bind the same isolated QA root');
  }
  const campaignSource = campaign.sourceVersion;
  if (!campaignSource || campaignSource.archive !== manifest.sourceVersion.archive
      || campaignSource.archiveHash !== manifest.sourceVersion.archiveHash
      || JSON.stringify(campaignSource.files) !== JSON.stringify(manifest.sourceVersion.files)) {
    throw new Error('Campaign source version does not match its manifest');
  }
  if (JSON.stringify(campaign.continuation ?? null) !== JSON.stringify(manifest.continuation ?? null)) {
    throw new Error('Campaign continuation provenance does not match its manifest');
  }
  if (manifest.continuation) {
    const continuation = manifest.continuation;
    if (JSON.stringify(campaignSource.priorAttemptSourceVersion) !== JSON.stringify(continuation.priorAttemptSourceVersion)
        || JSON.stringify(continuation.currentSourceVersion?.files) !== JSON.stringify(campaignSource.files)
        || !Array.isArray(continuation.unchangedFiles) || !Array.isArray(continuation.changedHarnessFiles)) {
      throw new Error('Continuation source-version history is incomplete');
    }
    for (const file of continuation.unchangedFiles) {
      if (continuation.priorAttemptSourceVersion?.files?.[file] !== continuation.currentSourceVersion.files[file]) {
        throw new Error(`Continuation changed a frozen non-runner source: ${file}`);
      }
    }
    if (!continuation.changedHarnessFiles.includes('scripts/research-luna-campaign.mjs')
        || !continuation.changedHarnessFiles.includes('scripts/lib/researchLunaCampaignState.mjs')) {
      throw new Error('Continuation does not disclose the harness revision');
    }
  }
  const root = fs.realpathSync(campaign.root);
  if (root !== campaign.root || root === path.parse(root).root) throw new Error('Campaign root is not canonical and isolated');
  const isolationFile = path.join(root, 'isolation.json');
  regularFile(isolationFile, { maxBytes: 64 * 1024 });
  const isolation = json(isolationFile);
  if (isolation.format !== ISOLATION_FORMAT || isolation.root !== root) throw new Error('Campaign root lacks a matching isolation manifest');
  const artifacts = path.join(root, 'artifacts');
  const artifactStat = fs.lstatSync(artifacts);
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) throw new Error('Campaign artifacts path is not an isolated directory');
  return { directory: realDirectory, manifest, campaign, archive, archiveHash, cases, root };
}

function reviewIdentity(caseId, arm) { return sha(`${caseId}\0${arm}`).slice(0, 16); }

function makeBlindPacket(row) {
  const citationMap = new Map(row.sources.map((source, index) => [source.citation, `nodus://review-source/${row.reviewId}/${index + 1}`]));
  let answer = row.answer;
  if (answer) {
    let unresolved = 0;
    answer = answer.replace(/nodus:\/\/passage\/[^)\s]+/gu, original => {
      const blinded = citationMap.get(original);
      if (blinded) return blinded;
      unresolved += 1;
      return `nodus://unresolved-source/${unresolved}`;
    });
  }
  const sources = row.sources.map((source, index) => {
    const { id: _id, citation: _citation, ...original } = source;
    return { ...original, id: `source-${index + 1}`, citation: `nodus://review-source/${row.reviewId}/${index + 1}` };
  });
  return { reviewId: row.reviewId, question: row.question, answer, unavailable: row.unavailable,
    answerSha256: sha(answer ?? ''), sourceHash: row.sourceHash, sources };
}

function validateReviews(reviews, identified) {
  if (!Array.isArray(reviews)) throw new Error('Source reviews must be a JSON array');
  const allowed = new Map(identified.map(row => [row.reviewId, row]));
  const seen = new Set();
  for (const review of reviews) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('Invalid source review row');
    if (typeof review.reviewId !== 'string' || !allowed.has(review.reviewId)) throw new Error('Source review contains an unknown review ID');
    if (seen.has(review.reviewId)) throw new Error('Source review IDs must be unique');
    seen.add(review.reviewId);
    const row = allowed.get(review.reviewId);
    if (review.answerSha256 !== row.answerSha256 || review.sourceHash !== row.sourceHash) throw new Error('Source review hashes do not bind to the packed answer and sources');
    if (typeof review.reviewer !== 'string' || !review.reviewer.trim() || review.reviewer.length > 200
        || typeof review.faithful !== 'boolean' || typeof review.adequate !== 'boolean'
        || typeof review.notes !== 'string' || review.notes.length > 20_000) throw new Error('Source review fields are invalid');
  }
  return reviews;
}

function checkReceipts(campaign, root) {
  const bridge = campaign.bridge;
  const eventFile = path.join(root, 'artifacts/events.jsonl');
  if (typeof bridge?.eventFile === 'string' && path.resolve(bridge.eventFile) !== eventFile) {
    throw new Error('Bridge event receipt path escapes the isolated QA root');
  }
  if (!fs.existsSync(eventFile)) return { available: false, lost: null, accepted: null, completed: null, abandoned: null };
  regularFile(eventFile, { maxBytes: 64 * 1024 * 1024 });
  const events = fs.readFileSync(eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const accepted = new Map(), completed = new Set(), abandoned = new Set();
  for (const event of events) {
    if (!event || typeof event.id !== 'string') continue;
    if (event.event === 'accepted') {
      if (accepted.has(event.id)) throw new Error('Bridge has duplicate accepted request IDs');
      accepted.set(event.id, event);
    } else if (event.event === 'completed') completed.add(event.id);
    else if (event.event === 'abandoned') abandoned.add(event.id);
  }
  const receiptIssues = [...accepted.keys()].filter(id => Number(completed.has(id)) + Number(abandoned.has(id)) !== 1);
  const reportedRequests = new Set();
  for (const row of campaign.answers ?? []) {
    if (!Array.isArray(row.bridgeRequestIds) || row.bridgeRequestIds.length === 0) receiptIssues.push('answer-without-bridge-request');
    if (!Array.isArray(row.bridgeCompletionIds) || (!row.error && row.bridgeCompletionIds.length === 0)) receiptIssues.push('answer-without-bridge-completion');
    for (const id of row.bridgeRequestIds ?? []) {
      if (reportedRequests.has(id)) receiptIssues.push('duplicate-answer-request-id');
      reportedRequests.add(id);
      if (!accepted.has(id)) receiptIssues.push(id);
    }
    for (const id of row.bridgeCompletionIds ?? []) if (!completed.has(id)) receiptIssues.push(id);
  }
  for (const id of accepted.keys()) if (!reportedRequests.has(id)) receiptIssues.push('unassigned-accepted-request');
  const registry = bridge?.completionRegistry ?? [];
  const registryIds = new Set(registry.map(item => item.id).filter(Boolean));
  if (!Array.isArray(bridge?.completionRegistry)) receiptIssues.push('completion-registry-missing');
  if (registryIds.size !== registry.length || registryIds.size !== completed.size) receiptIssues.push('completion-registry-count-mismatch');
  for (const id of completed) if (!registryIds.has(id)) receiptIssues.push(id);
  for (const id of completed) if (!accepted.has(id)) receiptIssues.push(id);
  if (!Number.isSafeInteger(bridge?.acceptedRequests) || bridge.acceptedRequests !== accepted.size) receiptIssues.push('accepted-count-mismatch');
  if (bridge?.events && (bridge.events.accepted !== accepted.size || bridge.events.completed !== completed.size
      || bridge.events.abandoned !== abandoned.size)) receiptIssues.push('event-count-mismatch');
  const pendingCalls = bridge?.pendingCallsAfterClose;
  if (pendingCalls !== 0) receiptIssues.push('pending-calls-after-close');
  return { available: true, lost: receiptIssues.length > 0, accepted: accepted.size,
    completed: completed.size, abandoned: abandoned.size, issueCount: receiptIssues.length };
}

function writeExclusive(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function snapshotFinishedRun({ root, target }) {
  const artifacts = path.join(root, 'artifacts');
  const files = [];
  const copyTree = (relativeDirectory) => {
    const sourceDirectory = path.join(artifacts, relativeDirectory);
    if (!fs.existsSync(sourceDirectory)) return;
    const stat = fs.lstatSync(sourceDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe bridge artifact directory: ${relativeDirectory}`);
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
      const source = path.join(sourceDirectory, entry.name); regularFile(source, { maxBytes: 16 * 1024 * 1024 });
      const relative = path.join('bridge', relativeDirectory, entry.name);
      const bytes = fs.readFileSync(source); writeExclusive(path.join(target, relative), bytes);
      files.push({ path: relative, sha256: sha(bytes), bytes: bytes.length });
    }
  };
  for (const directory of ['requests', 'completions', 'failed-requests', 'dispatch-jobs']) copyTree(directory);
  // These compact JSON records contain dispatch and read evidence. They do not
  // include profile database/key files, which remain outside the snapshot.
  for (const entry of fs.readdirSync(artifacts, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^read-[0-9a-f-]+\.json$/u.test(entry.name)) continue;
    const source = path.join(artifacts, entry.name); regularFile(source, { maxBytes: 16 * 1024 * 1024 });
    const relative = path.join('bridge', entry.name);
    const bytes = fs.readFileSync(source); writeExclusive(path.join(target, relative), bytes);
    files.push({ path: relative, sha256: sha(bytes), bytes: bytes.length });
  }
  const rawCompletions = path.join(artifacts, 'raw-completions');
  if (fs.existsSync(rawCompletions)) {
    const stat = fs.lstatSync(rawCompletions);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe raw-completion directory');
    for (const entry of fs.readdirSync(rawCompletions, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.txt')) continue;
      const source = path.join(rawCompletions, entry.name); regularFile(source, { maxBytes: 16 * 1024 * 1024 });
      const relative = path.join('bridge', 'raw-completions', entry.name);
      const bytes = fs.readFileSync(source); writeExclusive(path.join(target, relative), bytes);
      files.push({ path: relative, sha256: sha(bytes), bytes: bytes.length });
    }
  }
  const failedResponses = path.join(artifacts, 'failed-responses');
  if (fs.existsSync(failedResponses)) {
    const stat = fs.lstatSync(failedResponses);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe failed-response directory');
    for (const entry of fs.readdirSync(failedResponses, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.txt')) continue;
      const source = path.join(failedResponses, entry.name); regularFile(source, { maxBytes: 16 * 1024 * 1024 });
      const relative = path.join('bridge', 'failed-responses', entry.name);
      const bytes = fs.readFileSync(source); writeExclusive(path.join(target, relative), bytes);
      files.push({ path: relative, sha256: sha(bytes), bytes: bytes.length });
    }
  }
  const compressedInputs = [
    ['artifacts/events.jsonl', path.join(artifacts, 'events.jsonl')],
    ['artifacts/agent-prompts.jsonl', path.join(artifacts, 'agent-prompts.jsonl')],
    ['artifacts/agent-executions.jsonl', path.join(artifacts, 'agent-executions.jsonl')],
    ['artifacts/orchestration-errors.jsonl', path.join(artifacts, 'orchestration-errors.jsonl')],
    ['artifacts/request-read-evidence.jsonl', path.join(artifacts, 'request-read-evidence.jsonl')],
    ['profile/embedding-trace.jsonl', path.join(root, 'profile/embedding-trace.jsonl')],
    ['profile/database-access.jsonl', path.join(root, 'profile/database-access.jsonl')],
  ];
  for (const [label, source] of compressedInputs) {
    if (!fs.existsSync(source)) continue;
    regularFile(source, { maxBytes: 64 * 1024 * 1024 });
    const raw = fs.readFileSync(source), zipped = zlib.gzipSync(raw, { level: 9, mtime: 0 });
    const relative = `${label.replaceAll('/', path.sep)}.gz`;
    writeExclusive(path.join(target, relative), zipped);
    files.push({ path: relative, sha256: sha(zipped), bytes: zipped.length, uncompressedBytes: raw.length });
  }
  return files;
}

function collectResearchLuna({ directory = DEFAULT_DIRECTORY, outputDirectory = directory, reviews = [], snapshot = true,
  acceptancePolicy = null, qualityReviews = [], productInvariantEvidence = null, qualityPreregistration = undefined } = {}) {
  if (acceptancePolicy !== null && acceptancePolicy !== RESEARCH_ANSWER_QUALITY_POLICY) throw new Error('Unknown acceptance policy');
  const loaded = loadAndValidate(directory);
  const { manifest, campaign, cases, root } = loaded;
  const inputs = new Map(cases.map(row => [row.id, row]));
  const answerByKey = new Map();
  if (!Array.isArray(campaign.answers)) throw new Error('Campaign answers must be an array');
  for (const answer of campaign.answers) {
    if (!answer || !inputs.has(answer.caseId) || !ARMS.includes(answer.arm)) throw new Error('Campaign contains an unknown case or arm');
    const key = `${answer.caseId}\0${answer.arm}`;
    if (answerByKey.has(key)) throw new Error('Campaign contains a duplicate case/arm answer');
    const input = inputs.get(answer.caseId);
    if (answer.sourceHash !== input.sourceHash) throw new Error(`Campaign answer source hash mismatch for ${answer.caseId}/${answer.arm}`);
    if (answer.attemptSourceVersion !== undefined && !['current', 'historical'].includes(answer.attemptSourceVersion)) {
      throw new Error(`Campaign answer has an unknown source-version reference for ${answer.caseId}/${answer.arm}`);
    }
    answerByKey.set(key, answer);
  }
  if (manifest.continuation) {
    const historical = new Map((manifest.continuation.historicalAttempts ?? []).map(row => [`${row.caseId}\0${row.arm}`, row]));
    if (historical.size !== 4) throw new Error('Continuation must bind the four historical attempts');
    for (const [key, historic] of historical) {
      const answer = answerByKey.get(key);
      if (!answer || answer.attemptSourceVersion !== 'historical' || historic.sourceHash !== answer.sourceHash
          || historic.attemptStatus !== answer.attemptStatus
          || JSON.stringify(historic.bridgeRequestIds) !== JSON.stringify(answer.bridgeRequestIds)) {
        throw new Error('Historical attempt provenance does not match the continuation manifest');
      }
    }
    for (const [key, answer] of answerByKey) if (answer.attemptSourceVersion === 'historical' && !historical.has(key)) {
      throw new Error('A historical attempt is absent from continuation provenance');
    }
  }
  const identified = cases.flatMap(input => ARMS.map(arm => {
    const answer = answerByKey.get(`${input.id}\0${arm}`) ?? null;
    const successful = Boolean(answer && !answer.error && typeof answer.answer === 'string' && answer.answer.trim());
    const text = successful ? answer.answer : null;
    return {
      caseId: input.id, profile: PROFILE, name: input.name, arm, positive: input.positive,
      reviewId: reviewIdentity(input.id, arm), question: input.question, sources: input.sources,
      answer: text, unavailable: !successful, attempted: Boolean(answer) && answer.attempted !== false,
      rawAnswerSha256: sha(text ?? ''), sourceHash: input.sourceHash,
      attemptStatus: answer?.attemptStatus ?? (successful ? 'answered' : answer ? 'verification-withheld' : 'not-executed'),
      attemptSourceVersion: answer?.attemptSourceVersion ?? 'current',
      errorClassification: answer?.error?.classification ?? null,
      traces: answer?.traces ?? [], bridgeRequestIds: answer?.bridgeRequestIds ?? [],
    };
  }));
  const reviewPack = identified.map(makeBlindPacket);
  for (let index = 0; index < identified.length; index += 1) identified[index].answerSha256 = reviewPack[index].answerSha256;
  const checkedReviews = validateReviews(reviews, identified);
  const reviewById = new Map(checkedReviews.map(row => [row.reviewId, row]));
  // The review packet has no arm/profile/case labels or automated verifier output.
  reviewPack.sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  const outcomes = identified.map(row => {
    const review = reviewById.get(row.reviewId) ?? null;
    const known = new Set(row.sources.map(source => source.citation));
    const citations = row.answer ? [...row.answer.matchAll(/\]\((nodus:\/\/[^)\s]+)\)/gu)].map(match => match[1]) : [];
    return { caseId: row.caseId, arm: row.arm, positive: row.positive, reviewId: row.reviewId,
      attempted: row.attempted, answered: !row.unavailable, unavailable: row.unavailable,
      answerSha256: row.answerSha256, rawAnswerSha256: row.rawAnswerSha256, sourceHash: row.sourceHash,
      attemptStatus: row.attemptStatus, attemptSourceVersion: row.attemptSourceVersion,
      sourceReview: review ? { reviewer: review.reviewer, faithful: review.faithful, adequate: review.adequate, notes: review.notes } : null,
      passed: !row.unavailable && review?.faithful === true && review?.adequate === true,
      citationAudit: { captured: citations.length, knownManifestTargets: citations.filter(link => known.has(link)).length },
      automaticVerifierTrace: row.traces,
    };
  });
  const arms = Object.fromEntries(ARMS.map(arm => {
    const rows = outcomes.filter(row => row.arm === arm);
    const group = positive => {
      const selected = rows.filter(row => row.positive === positive);
      return { passed: selected.filter(row => row.passed).length, planned: positive ? 8 : 2,
        attempted: selected.filter(row => row.attempted).length, answered: selected.filter(row => row.answered).length,
        reviewed: selected.filter(row => row.sourceReview).length };
    };
    const citationCount = rows.reduce((sum, row) => sum + row.citationAudit.captured, 0);
    const knownCount = rows.reduce((sum, row) => sum + row.citationAudit.knownManifestTargets, 0);
    return [arm, { planned: 10, observed: rows.length, sourceReviews: rows.filter(row => row.sourceReview).length,
      supportedAnswers: group(true), insufficientEvidenceAnswers: group(false),
      citationAudit: { captured: citationCount, knownManifestTargets: knownCount,
        allCapturedLinksKnown: citationCount > 0 && citationCount === knownCount,
        resolvableCitationRate: citationCount ? knownCount / citationCount : null } }];
  }));
  const receipts = checkReceipts(campaign, root);
  const allPlannedRowsPresent = identified.length === 20;
  const allPlannedAttempts = identified.every(row => row.attempted);
  const allReviews = identified.every(row => reviewById.has(row.reviewId));
  const archivedSourceIntegrity = cases.length === 10 && cases.every(row => manifest.cases.find(item => item.id === row.id)?.sourceHash === row.sourceHash);
  const campaignFinished = campaign.completed === true && typeof campaign.finishedAt === 'string';
  const campaignTerminal = typeof campaign.finishedAt === 'string';
  const campaignSourcesStable = !campaign.sourceChangedDuringCampaign;
  const noProtocolFailures = !campaign.interrupted && !campaign.error
    && identified.every(row => !['protocol-failure', 'cancelled'].includes(row.errorClassification)
      && !['protocol-failure', 'cancelled'].includes(row.attemptStatus));
  const hardGuards = {
    campaignFinished, campaignTerminal, allPlannedRowsPresent, allPlannedAttempts, noProtocolFailures, allSourceReviews: allReviews,
    archivedSourceIntegrity, campaignSourcesStable, bridgeReceiptsAvailable: receipts.available,
    noLostBridgeReceipts: receipts.available && receipts.lost === false,
  };
  const structured = arms.structured;
  const structuredThresholds = structured.supportedAnswers.passed / 8 >= 0.95
    && structured.insufficientEvidenceAnswers.passed / 2 >= 0.9
    && structured.citationAudit.allCapturedLinksKnown;
  const guardsReady = Object.values(hardGuards).every(Boolean);
  const acceptance = !campaignFinished || !allReviews || !receipts.available ? null : Boolean(guardsReady && structuredThresholds);
  const summary = {
    format: 'research-luna-source-review/1', campaignFormat: manifest.format,
    campaignFinished, archiveHash: loaded.archiveHash, sourceVersion: manifest.sourceVersion,
    fixedDenominators: { cases: 10, supported: 8, insufficientEvidence: 2, arms: ARMS },
    arms, allSourceReviews: allReviews, hardGuards, bridgeReceipts: receipts,
    sourceAccuracyAndAdequacy: { reviewerBasis: 'hash-bound source review', arms: Object.fromEntries(ARMS.map(arm => [arm, {
      reviewed: arms[arm].sourceReviews, passed: outcomes.filter(row => row.arm === arm && row.passed).length,
      planned: 10,
    }])) },
    automaticVerifierTraces: outcomes.map(row => ({ caseId: row.caseId, arm: row.arm, trace: row.automaticVerifierTrace })),
    outcomes, measuredDirectedGenerationGate: acceptance,
    validatedEmbeddingProfiles: [],
    reviewerLimit: 'Codex source inspection is separate from application auditors; it is not an external human review or a population estimate.',
    limitations: ['Deterministic fixture source reconstruction and hash checks establish source identity, not factual answer quality.',
      'Generation and source accuracy are reported separately; automatic verifier traces are not counted as source reviews.',
      'The campaign replays already selected source passages. It does not measure retrieval or embedding quality.',
      'A completed receipt-backed legacy verification refusal is scored as a negative baseline outcome and does not veto the structured-arm gate.'],
    ...(manifest.continuation ? { sourceVersionHistory: { prior: manifest.continuation.priorAttemptSourceVersion,
      current: manifest.continuation.currentSourceVersion, changedHarnessFiles: manifest.continuation.changedHarnessFiles } } : {}),
    ...(acceptancePolicy ? { separateQualityMetrics: evaluateResearchAnswerQuality({ outcomes,
      reviews: qualityReviews, campaignFinished, productInvariantEvidence, preregistration: qualityPreregistration }) } : {}),
  };

  const out = path.resolve(outputDirectory);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(out).isSymbolicLink()) throw new Error('Collection output directory must not be a symlink');
  const isFinished = campaignFinished;
  const suffix = `${Date.now()}-${process.pid}`;
  const packFile = path.join(out, isFinished ? `review-pack-${suffix}.json` : `review-pack.partial-${suffix}.json`);
  const analysisFile = path.join(out, isFinished ? `source-analysis-${suffix}.json` : `source-analysis.partial-${suffix}.json`);
  writeExclusive(packFile, Buffer.from(`${JSON.stringify(reviewPack, null, 2)}\n`));
  writeExclusive(analysisFile, Buffer.from(`${JSON.stringify(summary, null, 2)}\n`));
  let snapshotDirectory = null;
  if (campaignTerminal && snapshot) {
    const snapshotId = `snapshot-${sha(`${manifest.sourceVersion.archiveHash}\0${campaign.finishedAt}`).slice(0, 16)}`;
    snapshotDirectory = path.join(out, snapshotId);
    fs.mkdirSync(snapshotDirectory, { mode: 0o700 });
    const files = snapshotFinishedRun({ root, target: snapshotDirectory });
    writeExclusive(path.join(snapshotDirectory, 'snapshot-index.json'), Buffer.from(`${JSON.stringify({ format: 'research-luna-snapshot/1', createdAt: new Date().toISOString(),
      terminalCampaign: true, campaignCompleted: campaign.completed === true, files }, null, 2)}\n`));
  }
  return { packFile, analysisFile, snapshotDirectory, summary };
}

function parseArgs(argv) {
  const value = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { directory: path.resolve(value('directory') ?? DEFAULT_DIRECTORY),
    outputDirectory: path.resolve(value('output') ?? value('directory') ?? DEFAULT_DIRECTORY),
    reviewsFile: value('reviews') ? path.resolve(value('reviews')) : null,
    qualityReviewsFile: value('quality-reviews') ? path.resolve(value('quality-reviews')) : null,
    productInvariantEvidenceFile: value('product-invariant-evidence') ? path.resolve(value('product-invariant-evidence')) : null,
    qualityPreregistrationFile: value('quality-preregistration') ? path.resolve(value('quality-preregistration')) : null,
    acceptancePolicy: value('acceptance-policy') ?? null,
    snapshot: !argv.includes('--no-snapshot') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const reviews = args.reviewsFile ? json(args.reviewsFile) : [];
    const qualityReviews = args.qualityReviewsFile ? json(args.qualityReviewsFile) : [];
    const productInvariantEvidence = args.productInvariantEvidenceFile ? json(args.productInvariantEvidenceFile) : null;
    const qualityPreregistration = args.qualityPreregistrationFile ? json(args.qualityPreregistrationFile) : undefined;
    const result = collectResearchLuna({ ...args, reviews, qualityReviews, productInvariantEvidence, qualityPreregistration });
    console.log(JSON.stringify({ packFile: result.packFile, analysisFile: result.analysisFile,
      snapshotDirectory: result.snapshotDirectory, campaignFinished: result.summary.campaignFinished,
      plannedAnswers: 20, availableAnswers: result.summary.outcomes.filter(row => row.answered).length,
      sourceReviews: result.summary.outcomes.filter(row => row.sourceReview).length,
      acceptance: result.summary.measuredDirectedGenerationGate }));
  } catch (error) {
    console.error(`Research Luna collection rejected: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  }
}

export { buildCases, collectResearchLuna, loadAndValidate, makeBlindPacket, reviewIdentity, RESEARCH_ANSWER_QUALITY_POLICY };
