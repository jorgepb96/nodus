/** Structured, current-source answer campaign through the production Research Chat API.
 * Dry-run is default. `--run` uses production notebook grounding in an isolated Electron
 * profile and the local Luna bridge. Each case is attempted at most once. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createResearchApp } from './lib/research-app-harness.mjs';
import { startResearchLunaBridge, researchLunaBridgeProtocol } from './research-luna-bridge.mjs';
import { classifyResearchLunaAttempt } from './lib/researchLunaCampaignState.mjs';
import { newLiveAcceptedEvents, pendingResearchLiveCases, planResearchLiveCases,
  summarizeResearchLiveTerminalEvents, validateResearchLiveAdmissionStop } from './lib/researchLiveAnswerCampaignState.mjs';
import { prepareResearchLunaDispatch, verifyResearchLunaRead } from './research-luna-dispatch.mjs';
import { verifyDerivedIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeRead = (file, maxBytes = 128 * 1024 * 1024) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Unsafe or oversized input artifact: ${file}`);
  return fs.readFileSync(file);
};
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
};
const append = (file, value) => fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
const now = () => new Date().toISOString();
const eventsAfterOffset = (file, offset) => fs.readFileSync(file).subarray(offset).toString('utf8')
  .split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const PROFILE = 'embeddinggemma-2-text-q8-512-v1';
const MAX_SEGMENT_CALLS = 150;
const SOFT_PAUSE_CALLS = 118;
const MAX_CAMPAIGN_CALLS = 1600;
const MODEL = { provider: 'custom', model: researchLunaBridgeProtocol.model };
const SOURCE_FILES = ['scripts/research-live-answer-campaign.mjs', 'scripts/lib/researchLiveIndexAuthorization.mjs',
  'scripts/test-research-live-index-authorization.mjs', 'scripts/research-luna-bridge.mjs',
  'scripts/research-luna-response.mjs', 'scripts/research-luna-dispatch.mjs', 'scripts/research-isolation.mjs',
  'scripts/lib/researchLunaCampaignState.mjs', 'scripts/lib/tsRuntimeHooks.mjs',
  'scripts/lib/research-app-harness.mjs', 'scripts/research-live-evidence-campaign.mjs',
  'scripts/lib/researchLiveAnswerCampaignState.mjs', 'scripts/test-research-live-answer-campaign.mjs',
  'electron/ai/researchAssistant.ts', 'electron/ipc/academic.ts', 'electron/preload/academic.ts',
  'electron/ai/aiClient.ts', 'electron/ai/providers.ts', 'electron/ai/modelCatalog.ts', 'electron/ipc/platform.ts', 'electron/ai/researchChatGrounding.ts',
  'electron/bootstrap.ts',
  'electron/ai/researchStructuredAnswer.ts', 'electron/ai/researchClaimAudit.ts', 'electron/ai/thinkingEffort.ts',
  'shared/researchChatGrounding.ts', 'shared/researchClaimAudit.ts', 'shared/researchAnswerPlan.ts',
  'shared/researchAnswerStructure.ts', 'shared/researchAnswerSchema.ts', 'shared/providerContextWindows.ts',
  'electron/db/settingsRepo.ts', 'electron/secrets/safeStorageGate.ts', 'electron/secrets/secretStore.ts'];
// Pin all production sources behind the public API, including the indirect
// extraction, retrieval and coordinator imports. The QA collector is separate.
for (const directory of ['electron', 'shared', 'src']) {
  const visit = relative => {
    for (const entry of fs.readdirSync(path.join(repo, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && /\.(?:ts|tsx|mjs|js)$/u.test(entry.name)) SOURCE_FILES.push(child);
    }
  };
  visit(directory);
}
SOURCE_FILES.push('package.json', 'package-lock.json');
SOURCE_FILES.sort();
for (let index = SOURCE_FILES.length - 1; index > 0; index--) {
  if (SOURCE_FILES[index] === SOURCE_FILES[index - 1]) SOURCE_FILES.splice(index, 1);
}

function markedRoot(root) {
  const resolved = fs.realpathSync(root);
  const stat = fs.lstatSync(path.join(resolved, 'isolation.json'));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Root isolation marker is unsafe');
  const marker = JSON.parse(fs.readFileSync(path.join(resolved, 'isolation.json'), 'utf8'));
  if (marker.root !== resolved || marker.format !== 'nodus.isolated-research-profile/1' || resolved === path.parse(resolved).root) throw new Error('Invalid isolated QA root');
  return resolved;
}

function sourceRows(sourceFile, preregFile) {
  const sourceBytes = safeRead(sourceFile), source = JSON.parse(sourceBytes.toString('utf8'));
  if (source.format !== 'nodus.research-case-sources/1' || !Array.isArray(source.cases) || source.cases.length !== 80) throw new Error('Expected the current 80-case research-live-evidence source snapshot');
  if (source.profileId !== PROFILE || !source.notebookId || !source.scopeContract || !source.profileContract) throw new Error('Source snapshot lacks the pinned embedding and retrieval-scope contract');
  if (source.profileContractSha256 !== digest(Buffer.from(JSON.stringify(source.profileContract), 'utf8'))
      || source.scopeContractSha256 !== digest(Buffer.from(JSON.stringify(source.scopeContract), 'utf8'))) throw new Error('Source contract hashes do not verify');
  const profileRoot = source.profileRoot ?? source.campaignRoot ?? path.resolve(path.dirname(sourceFile), '..');
  if (markedRoot(profileRoot) !== profileRoot || !sourceFile.startsWith(`${profileRoot}${path.sep}`)) throw new Error('Source snapshot profile root is not a marked canonical QA root');
  if (fs.existsSync(path.join(profileRoot, 'artifacts/source-invalid-do-not-resume.json'))) throw new Error('This source campaign failed extraction qualification; preserve it and create a new isolated campaign');
  verifyDerivedIndexAuthorization(source);
  const preregBytes = safeRead(preregFile), prereg = JSON.parse(preregBytes.toString('utf8'));
  if (prereg.format !== 'nodus.research-live-evidence-preregistration/1' || prereg.counts?.total !== 80 || !Array.isArray(prereg.queries) || prereg.queries.length !== 80) throw new Error('Current 80-case preregistration is missing or malformed');
  const preregById = new Map(prereg.queries.map(row => [row.id, row]));
  if (preregById.size !== 80) throw new Error('Duplicate case IDs in preregistration');
  const ids = new Set();
  const cases = source.cases.map((row, index) => {
    if (!row || typeof row.id !== 'string' || ids.has(row.id) || !/^R\d{3}$/u.test(row.id)) throw new Error(`Invalid or duplicate source case at ${index}`);
    ids.add(row.id);
    const frozen = preregById.get(row.id);
    if (!frozen || frozen.question !== row.question || frozen.language !== row.language || frozen.isAnswerable !== row.isAnswerable) throw new Error(`Question/locale/answerability mismatch against preregistration: ${row.id}`);
    if (typeof row.sourceContext !== 'string' || !row.sourceContext.trim()) throw new Error(`Missing current sourceContext: ${row.id}`);
    const sourceContextHash = digest(Buffer.from(row.sourceContext, 'utf8'));
    if (row.sourceContextSha256 !== sourceContextHash) throw new Error(`sourceContext hash mismatch: ${row.id}`);
    if (!row.sourcesContext || !Array.isArray(row.sourcesContext.receipts)) throw new Error(`Missing intact source evidence receipts: ${row.id}`);
    const receiptsHash = digest(Buffer.from(JSON.stringify(row.sourcesContext), 'utf8'));
    if (row.sourcesContextSha256 !== receiptsHash) throw new Error(`source evidence receipt hash mismatch: ${row.id}`);
    const parsed = JSON.parse(row.sourceContext);
    const selected = parsed?.contexto_modular_seleccionado;
    if (selected?.research_scope?.documentary_evidence_required !== true || !Array.isArray(selected.pasajes_relevantes)) throw new Error(`Invalid production grounding sourceContext: ${row.id}`);
    const seen = new Set();
    for (const passage of selected.pasajes_relevantes) {
      if (!passage || typeof passage.id !== 'string' || typeof passage.citation !== 'string' || typeof passage.text !== 'string' || typeof passage.title !== 'string') throw new Error(`Invalid source passage in ${row.id}`);
      if (passage.citation !== `nodus://passage/${encodeURIComponent(passage.id)}` || seen.has(passage.id)) throw new Error(`Noncanonical or duplicate source citation: ${row.id}`);
      seen.add(passage.id);
      const receipt = row.sourcesContext.receipts.find(item => item?.citationId === passage.id);
      if (!receipt || receipt.resolved !== true || receipt.canonicalNodusLink !== passage.citation
          || receipt.resolvedTextSha256 !== digest(Buffer.from(passage.text, 'utf8'))) throw new Error(`Source passage lacks a matching hash-bound resolved receipt: ${row.id}`);
    }
    if (seen.size !== selected.pasajes_relevantes.filter(passage => passage?.id).length) throw new Error(`Source context passages are not uniquely receipted: ${row.id}`);
    const expectedSnapshotHash = digest(Buffer.from(JSON.stringify({ caseId: row.id, question: row.question,
      language: row.language, isAnswerable: row.isAnswerable, sourceContextSha256: row.sourceContextSha256,
      sourcesContextSha256: row.sourcesContextSha256, profileContractSha256: source.profileContractSha256,
      scopeContractSha256: source.scopeContractSha256 }), 'utf8'));
    if (row.caseSourceSnapshotSha256 !== expectedSnapshotHash) throw new Error(`Case source snapshot hash mismatch: ${row.id}`);
    return { ...row, kind: frozen.kind, sourceContextHash, receiptsHash,
      sourceCaseHash: digest(Buffer.from(JSON.stringify({ id: row.id, question: row.question, language: row.language, sourceContextHash, receiptsHash }), 'utf8')) };
  });
  if (ids.size !== 80 || [...preregById.keys()].some(id => !ids.has(id))) throw new Error('Current source snapshot does not cover the exact 80 preregistered IDs');
  const casesHash = source.caseSourceSnapshotSha256 ?? digest(Buffer.from(JSON.stringify(cases.map(row => ({ id: row.id, sourceCaseHash: row.sourceCaseHash }))), 'utf8'));
  return { source, root: profileRoot, sourceBytes, sourceHash: digest(sourceBytes), prereg, preregHash: digest(preregBytes), cases, casesHash };
}

const pendingFor = pendingResearchLiveCases;
function completeness(caseRow) { return caseRow.sourceContextHash === digest(Buffer.from(caseRow.sourceContext, 'utf8'))
  && caseRow.receiptsHash === digest(Buffer.from(JSON.stringify(caseRow.sourcesContext), 'utf8')); }

const sourceFile = path.resolve(arg('source-contexts') ?? '');
const preregFile = path.resolve(arg('preregistration') ?? (sourceFile ? path.join(path.dirname(sourceFile), 'preregistration.json') : ''));
if (!arg('source-contexts')) throw new Error('Usage requires --source-contexts=/current/case-sources.json [--output=/QA/output] [--preregistration=/QA/preregistration.json] [--continue-from=/QA/output] [--run]');
const inputs = sourceRows(sourceFile, preregFile);
const output = path.resolve(arg('output') ?? path.join(inputs.root, 'artifacts/live-answer-campaign'));
const isolatedRoot = markedRoot(inputs.root);
const outputRelative = path.relative(isolatedRoot, output);
if (!outputRelative || outputRelative === '..' || outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative)) {
  throw new Error('Campaign output must be a new directory inside the marked evidence-campaign QA root');
}
const plan = planResearchLiveCases(inputs.cases);
const snapshots = plan.map(item => { const row = inputs.cases.find(entry => entry.id === item.caseId); return ({ id: row.id, ordinal: item.ordinal, kind: item.kind, question: row.question, language: row.language, isAnswerable: row.isAnswerable,
  sourceContext: row.sourceContext, sourceContextSha256: row.sourceContextHash, sourcesContext: row.sourcesContext,
  sourcesContextSha256: row.receiptsHash, sourceCaseHash: row.sourceCaseHash }); });
if (snapshots.some(row => {
  const original = inputs.cases.find(item => item.id === row.id);
  return row.isAnswerable !== original.isAnswerable || row.sourceContext !== original.sourceContext
    || JSON.stringify(row.sourcesContext) !== JSON.stringify(original.sourcesContext);
})) throw new Error('Persisted campaign snapshots differ from their audited source records');
const dryRun = !process.argv.includes('--run');
const currentSourceHashes = Object.fromEntries(SOURCE_FILES.map(file => [file, digest(fs.readFileSync(path.join(repo, file)))]));

if (dryRun) {
  const continuation = arg('continue-from') ? path.resolve(arg('continue-from')) : null;
  const stateFile = continuation && path.join(continuation, 'campaign.json');
  let alreadyAttempted = [];
  if (continuation) {
    const state = JSON.parse(safeRead(stateFile, 32 * 1024 * 1024).toString('utf8'));
    const manifest = JSON.parse(safeRead(path.join(continuation, 'manifest.json'), 32 * 1024 * 1024).toString('utf8'));
    validateContinuation({ continuation, state, manifest, inputs, currentSourceHashes });
    alreadyAttempted = state.answers.map(row => row.caseId);
  }
  console.log(JSON.stringify({ dryRun: true, mode: 'structured-only', cases: 80, alreadyAttempted: alreadyAttempted.length,
    pending: plan.filter(row => !alreadyAttempted.includes(row.caseId)).length, sourceSnapshot: sourceFile, sourceSnapshotSha256: inputs.sourceHash,
    preregistrationSha256: inputs.preregHash, casesSha256: inputs.casesHash, sourceRoot: inputs.source.profileRoot,
    profileContract: inputs.source.profileContract, scopeContract: inputs.source.scopeContract,
    maxBridgeAcceptedCallsPerSegment: MAX_SEGMENT_CALLS,
    launchRequired: '--run', output }));
  process.exit(0);
}

function validateContinuation({ continuation, state, manifest, inputs: current, currentSourceHashes: hashes }) {
  const reject = why => { throw new Error(`Continuation rejected: ${why}`); };
  if (manifest?.format !== 'nodus.research-live-answer-campaign/1' || state?.format !== manifest.format) reject('format mismatch');
  if (manifest.mode !== 'structured-only' || manifest.sourceSnapshotSha256 !== current.sourceHash || manifest.preregistrationSha256 !== current.preregHash || manifest.casesSha256 !== current.casesHash) reject('source snapshot or preregistration changed');
  if (JSON.stringify(manifest.sourceFiles) !== JSON.stringify(hashes)) reject('campaign implementation or production source changed');
  if (state.root !== manifest.root || !state.root || fs.realpathSync(state.root) !== state.root) reject('root mismatch');
  markedRoot(state.root);
  if (manifest.maxBridgeAcceptedCallsPerSegment !== MAX_SEGMENT_CALLS || !Array.isArray(state.answers)) reject('segment cap or answer ledger malformed');
  const seen = new Set();
  for (const answer of state.answers) {
    if (!current.cases.some(row => row.id === answer.caseId && row.sourceCaseHash === answer.sourceCaseHash) || seen.has(answer.caseId)) reject(`case attempt mismatch or duplicate ${answer.caseId}`);
    seen.add(answer.caseId);
    const original = current.cases.find(row => row.id === answer.caseId);
    if (answer.sourceContextHash !== original.sourceContextHash || answer.receiptsHash !== original.receiptsHash
      || answer.sourceContext !== original.sourceContext || JSON.stringify(answer.sourcesContext) !== JSON.stringify(original.sourcesContext)) reject(`intact source/receipt snapshot mismatch ${answer.caseId}`);
    if (!answer.attempted || !['answered', 'verification-withheld', 'protocol-failure'].includes(answer.attemptStatus)) reject(`attempt status malformed ${answer.caseId}`);
  }
  for (const file of ['dispatch-ledger.jsonl', 'bridge-events.jsonl']) {
    const p = path.join(continuation, file); if (fs.existsSync(p)) safeRead(p, 64 * 1024 * 1024);
  }
}

const continueFrom = arg('continue-from') ? path.resolve(arg('continue-from')) : null;
if (continueFrom && continueFrom !== output) throw new Error('--continue-from must match --output');
if (!continueFrom && (fs.existsSync(path.join(output, 'manifest.json')) || fs.existsSync(path.join(output, 'campaign.json')))) throw new Error('Output exists; use --continue-from for a verified resume');
let prior = null;
if (continueFrom) {
  const manifest = JSON.parse(safeRead(path.join(output, 'manifest.json'), 32 * 1024 * 1024).toString('utf8'));
  const state = JSON.parse(safeRead(path.join(output, 'campaign.json'), 64 * 1024 * 1024).toString('utf8'));
  validateContinuation({ continuation: output, state, manifest, inputs, currentSourceHashes });
  prior = { manifest, state };
}

const root = prior?.state.root ?? markedRoot(inputs.root);
const artifacts = path.join(root, 'artifacts');
const keysFile = path.join(root, 'fixtures/empty-provider-keys.json');
if (!fs.existsSync(keysFile)) fs.writeFileSync(keysFile, '{}\n', { mode: 0o600, flag: 'wx' });
if (safeRead(keysFile, 16).toString('utf8') !== '{}\n') throw new Error('Literal-empty SafeStorage key gate mismatch');
const outputRoot = output;
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
const segmentOrdinal = (prior?.state.segments?.length ?? 0) + 1;
const segmentId = `segment-${String(segmentOrdinal).padStart(3, '0')}-${randomUUID()}`;
const segmentStartedAt = now();
const segmentDir = path.join(artifacts, 'segments', segmentId);
fs.mkdirSync(segmentDir, { recursive: true, mode: 0o700 });
const rootBridgeEventFile = path.join(artifacts, 'events.jsonl');
const historicEvents = fs.existsSync(rootBridgeEventFile)
  ? fs.readFileSync(rootBridgeEventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
const priorAcceptedIds = new Set(historicEvents.filter(row => row.event === 'accepted').map(row => row.id));
const priorAccepted = priorAcceptedIds.size;
if (!prior && priorAccepted) throw new Error('The marked QA root already has bridge history; a fresh campaign root is required');
if (prior) {
  const answerRequestIds = new Set(prior.state.answers.flatMap(answer => answer.bridgeRequestIds ?? []));
  if ([...priorAcceptedIds].some(id => !answerRequestIds.has(id))) throw new Error('Bridge history contains an accepted request absent from the answer ledger; safe continuation is impossible');
}
if (priorAccepted >= MAX_CAMPAIGN_CALLS) throw new Error('The hard 1,600 accepted-call campaign ceiling is exhausted');
if (fs.existsSync(rootBridgeEventFile)) {
  const accepted = new Set(historicEvents.filter(row => row.event === 'accepted').map(row => row.id));
  for (const event of historicEvents.filter(row => ['completed', 'abandoned'].includes(row.event))) accepted.delete(event.id);
  if (accepted.size) throw new Error(`Unresolved historic Luna bridge requests prevent a safe continuation: ${[...accepted].join(',')}`);
}
const bridgeEventOffset = fs.existsSync(rootBridgeEventFile) ? fs.statSync(rootBridgeEventFile).size : 0;
const bridge = await startResearchLunaBridge({ root, maxRequests: Math.min(MAX_SEGMENT_CALLS, MAX_CAMPAIGN_CALLS - priorAccepted) });
const bridgeNonceSha256 = digest(Buffer.from(bridge.nonce, 'utf8'));
if ((prior?.state.segments ?? []).some(segment => segment.bridgeNonceSha256 === bridgeNonceSha256)) {
  await bridge.close();
  throw new Error('Luna bridge reused a prior segment nonce');
}
const sourceVersion = { sourceSnapshot: sourceFile, sourceSnapshotSha256: inputs.sourceHash, preregistration: preregFile,
  preregistrationSha256: inputs.preregHash, casesSha256: inputs.casesHash, sourceFiles: currentSourceHashes };
const manifest = prior?.manifest ?? { format: 'nodus.research-live-answer-campaign/1', mode: 'structured-only', root,
  sourceVersion, sourceSnapshotSha256: inputs.sourceHash, preregistrationSha256: inputs.preregHash, casesSha256: inputs.casesHash,
  sourceFiles: currentSourceHashes, profileContract: inputs.source.profileContract, scopeContract: inputs.source.scopeContract,
  profileContractSha256: inputs.source.profileContractSha256, scopeContractSha256: inputs.source.scopeContractSha256,
  notebookId: inputs.source.notebookId, corpusSourceHashes: inputs.source.corpusSourceHashes ?? [],
  indexAuthorization: inputs.source.indexAuthorization,
  sourceContextRole: 'immutable lane-control evidence only; product answers use production notebook context construction',
  sourceSnapshot: path.join(artifacts, 'source-context-snapshot.json'), maxBridgeAcceptedCallsPerSegment: MAX_SEGMENT_CALLS,
  completionSemantics: 'A case is concluded after its one application attempt, including a verified answer, verification withheld, or protocol failure. No concluded case or bridge transport is retried in later segments.',
  networkPolicy: 'External outbound denied by OS sandbox; bridge is the sole permitted loopback HTTP service; external provider API keys are literal empty.' };
const report = prior?.state ?? { format: manifest.format, root, startedAt: now(), completed: false, answers: [], segments: [] };
const networkBaseline = { external: report.network?.instrumentedExternalFetchCalls ?? 0,
  loopback: report.network?.instrumentedLoopbackFetchCalls ?? 0 };
const ledgerFile = path.join(outputRoot, 'dispatch-ledger.jsonl');
const bridgeEventFile = bridge.eventFile;
if (!prior) save(manifest.sourceSnapshot, { format: 'nodus.research-live-answer-source-snapshot/1', sourceVersion,
  profileContract: inputs.source.profileContract, scopeContract: inputs.source.scopeContract,
  indexAuthorization: inputs.source.indexAuthorization, cases: snapshots });
save(path.join(outputRoot, 'manifest.json'), manifest);
save(path.join(outputRoot, 'campaign.json'), report);

let harness, app, page, stopping = false;
const stop = () => { stopping = true; void harness?.close().catch(() => undefined); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  harness = await createResearchApp({ root, extraPorts: [Number(new URL(bridge.url).port)], extraEnv: {
    NODUS_HARNESS_KEYS_FILE: keysFile, NODUS_EMBEDDING_QA_TRACE: '1' } });
  ({ app, page } = await harness.launch());
  report.isolation = prior?.state.isolation ?? harness.proof;
  await app.evaluate((electron, bridgePort) => {
    const originalFetch = global.fetch;
    global.__liveAnswerNetwork = { loopbackHttpCalls: 0, externalProviderHttpCalls: 0, requests: [] };
    global.fetch = async function(input, init) {
      const raw = typeof input === 'string' ? input : input.url;
      const url = new URL(raw);
      const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
      if (url.protocol === 'http:' && local && Number(url.port) === bridgePort) global.__liveAnswerNetwork.loopbackHttpCalls++;
      else if (url.protocol === 'http:' || url.protocol === 'https:') global.__liveAnswerNetwork.externalProviderHttpCalls++;
      global.__liveAnswerNetwork.requests.push({ origin: url.origin, method: init?.method ?? 'GET' });
      return originalFetch.call(this, input, init);
    };
  }, Number(new URL(bridge.url).port));
  await page.evaluate(async ({ baseUrl, model }) => {
    await window.nodus.updateSettings({ customProvider: { baseUrl, models: [model.model] }, chatModel: model,
      synthesisModel: model, researchWebSearch: 'off', researchAnswerVerification: 'structured' });
    const settings = await window.nodus.getSettings();
    if (settings.chatModel?.provider !== 'custom' || settings.chatModel?.model !== model.model
        || settings.researchAnswerVerification !== 'structured' || settings.researchWebSearch !== 'off') throw new Error('Product settings did not retain the frozen structured-only configuration');
  }, { baseUrl: bridge.url, model: MODEL });
  const catalogStartedAt = Date.now();
  const catalog = await page.evaluate(async () => window.nodus.getModelCatalog('custom'));
  const listedModel = catalog?.status === 'read' && Array.isArray(catalog.models)
    ? catalog.models.find(item => item.id === MODEL.model) : null;
  if (!listedModel || listedModel.contextLength !== researchLunaBridgeProtocol.contextWindowCap) {
    throw new Error('Current custom-provider model catalog did not confirm the configured context window; refusing to start answer cases');
  }
  report.runtime = await app.evaluate(() => ({ versions: process.versions, platform: process.platform, arch: process.arch }));
  report.runtime.segmentId = segmentId;
  report.runtime.contextWindow = { catalogReadSucceeded: true, catalogStatus: catalog.status,
    model: listedModel.id, contextTokens: listedModel.contextLength, catalogReadDurationMs: Date.now() - catalogStartedAt,
    limitation: 'The public Luna API proxy may not enforce native model context or generation temperature.' };
  report.runtime.safeStorageGate = { keyFile: keysFile, contentSha256: digest(fs.readFileSync(keysFile)), contents: '{}' };
  save(path.join(outputRoot, 'campaign.json'), report);

  const requestDir = bridge.requestDirectory, completionDir = bridge.completionDirectory;
  const priorIds = new Set(report.answers.map(row => row.caseId));
  const attemptedThisSegment = [];
  for (const plannedCase of plan) {
    const input = inputs.cases.find(row => row.id === plannedCase.caseId);
    if (priorIds.has(input.id)) continue;
    // A controller can stop admission at a case boundary while allowing every
    // already started application request to finish normally.
    const stopFile = path.join(artifacts, 'live-answer-stop.json');
    if (fs.existsSync(stopFile)) {
      const stopRequest = JSON.parse(safeRead(stopFile, 16 * 1024).toString('utf8'));
      report.admissionStop = validateResearchLiveAdmissionStop(stopRequest, root);
      break;
    }
    if (stopping || bridge.acceptedRequests() >= SOFT_PAUSE_CALLS) break;
    const caseAttemptId = randomUUID();
    const mapping = { format: 'nodus.research-live-answer-case-request/1', caseId: input.id, caseAttemptId, segmentId,
      sourceContextHash: input.sourceContextHash, receiptsHash: input.receiptsHash, sourceCaseHash: input.sourceCaseHash };
    const attempt = { ...mapping, ordinal: plannedCase.ordinal, kind: plannedCase.kind, question: input.question,
      language: input.language, sourceContext: input.sourceContext, sourcesContext: input.sourcesContext,
      attempted: true, startedAt: now(), status: 'started', bridgeRequestIds: [], bridgeCompletionIds: [], attemptStatus: 'protocol-failure' };
    const answerIndex = report.answers.length;
    report.answers.push(attempt);
    report.pending = pendingFor(plan, report.answers);
    save(path.join(outputRoot, 'campaign.json'), report);
    append(path.join(outputRoot, 'attempts.jsonl'), { stage: 'started', caseId: input.id, caseAttemptId, segmentId,
      sourceContextHash: input.sourceContextHash, receiptsHash: input.receiptsHash, startedAt: attempt.startedAt });
    const mappingFile = path.join(artifacts, 'case-request-mappings', `${caseAttemptId}.json`);
    save(mappingFile, mapping);
    const requestBefore = new Set(fs.readdirSync(requestDir).filter(name => name.endsWith('.json')));
    const requestIdsBefore = new Set([...requestBefore].map(name => name.slice(0, -5)));
    const traceFile = path.join(root, 'profile/embedding-trace.jsonl');
    const traceOffset = fs.existsSync(traceFile) ? fs.statSync(traceFile).size : 0;
    const databaseAccessFile = path.join(root, 'profile/database-access.jsonl');
    const databaseAccessOffset = fs.existsSync(databaseAccessFile) ? fs.statSync(databaseAccessFile).size : 0;
    try {
      await page.evaluate(async language => window.nodus.updateSettings({ promptLanguage: language }), input.language);
      const selection = { notebookId: inputs.source.notebookId, layers: { ideas: false, documents: true },
        retrieval: { preset: 'deep', candidates: 120, passagesPerRound: 24, evidenceTokens: 16000,
          rounds: 8, autoExpand: true, threshold: { mode: 'automatic' } }, ideas: false, themes: false, contradictions: false, gaps: false,
        readingPath: false, authors: false, documents: true, passages: true, graph: false,
        graphParts: { ideaNodes: false, themeNodes: false, ideaEdges: false, authorGraph: false } };
      const responsePromise = page.evaluate(async ({ question, model, selection }) => window.nodus.researchChat({
        messages: [{ role: 'user', content: question }], selection, model, webSearch: 'off' }),
      { question: input.question, model: MODEL, selection });
      let responseReady = false, response, responseError;
      responsePromise.then(value => { response = value; responseReady = true; }, error => { responseError = error; responseReady = true; });
      const prepared = new Set();
      while (!responseReady && !stopping) {
        const allEvents = fs.existsSync(rootBridgeEventFile)
          ? fs.readFileSync(rootBridgeEventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
        const currentRequestIds = new Set(fs.readdirSync(requestDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
        for (const event of newLiveAcceptedEvents(allEvents, requestIdsBefore, prepared).filter(item => currentRequestIds.has(item.id))) {
          const eventMapping = { format: 'nodus.research-live-answer-case-request/1', requestId: event.id,
            caseId: input.id, caseAttemptId, segmentId, sourceContextHash: input.sourceContextHash,
            receiptsHash: input.receiptsHash, sourceCaseHash: input.sourceCaseHash };
          const requestMappingFile = path.join(artifacts, 'case-request-mappings', `${event.id}.json`);
          save(requestMappingFile, eventMapping);
          const preparedJob = prepareResearchLunaDispatch({ root, nodeBinary: process.execPath,
            responseHelper: path.join(repo, 'scripts/research-luna-response.mjs'),
            // QA transport allowance only: the product's Deep evidence and model
            // window budgets are unchanged. Every UTF-8 part must be read.
            maxRequestBytes: 240_000, multipartRead: true,
            mappingFile: requestMappingFile, mappingSha256: digest(fs.readFileSync(requestMappingFile)) });
          append(ledgerFile, { ...eventMapping, dispatch: { metadataFile: preparedJob.metadataFile,
            jobFile: preparedJob.jobFile, requestSha256: preparedJob.requestSha256, requestBytes: preparedJob.requestBytes } });
          attempt.bridgeRequestIds.push(event.id);
          save(path.join(outputRoot, 'campaign.json'), report);
          console.log(JSON.stringify({ event: 'luna-dispatch-ready', requestId: event.id,
            metadataFile: preparedJob.metadataFile, jobFile: preparedJob.jobFile, caseId: input.id, segmentId }));
          prepared.add(event.id);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (responseError) throw responseError;
      if (!responseReady) throw new Error('Campaign interrupted while product Research Chat was pending');
      attempt.productResponse = response;
      attempt.answer = response?.answer;
      if (typeof attempt.answer !== 'string' || !attempt.answer.trim()) throw new Error('Product Research Chat returned an empty answer');
      const citedIds = [...new Set([...attempt.answer.matchAll(/nodus:\/\/passage\/([^\s)\]}>,]+)/gu)].map(match => {
        try { return decodeURIComponent(match[1]); } catch { return null; }
      }).filter(Boolean))];
      attempt.citationResolution = [];
      for (const citationId of citedIds) attempt.citationResolution.push({ citationId,
        passage: await page.evaluate(id => window.nodus.getPassage(id), citationId) });
      attempt.status = 'returned';
    } catch (error) {
      attempt.error = { message: String(error?.message ?? error).slice(0, 500), classification: 'generation-or-verification-failed' };
      attempt.status = 'failed';
    }
    const newIds = fs.readdirSync(requestDir).filter(name => name.endsWith('.json') && !requestBefore.has(name)).map(name => name.slice(0, -5));
    const events = fs.existsSync(bridge.eventFile) ? fs.readFileSync(bridge.eventFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
    const acceptedIds = new Set(events.filter(item => item.event === 'accepted').map(item => item.id));
    const completedIds = new Set(events.filter(item => item.event === 'completed').map(item => item.id));
    attempt.bridgeRequestIds = [...new Set([...attempt.bridgeRequestIds, ...newIds.filter(id => acceptedIds.has(id))])];
    attempt.bridgeCompletionIds = attempt.bridgeRequestIds.filter(id => completedIds.has(id) && fs.existsSync(path.join(completionDir, `${id}.json`)));
    attempt.dispatchReadReceipts = [];
    for (const id of attempt.bridgeRequestIds) {
      try { attempt.dispatchReadReceipts.push(verifyResearchLunaRead({ root, requestId: id })); }
      catch (error) { attempt.dispatchReadReceipts.push({ requestId: id, verified: false, error: String(error?.message ?? error).slice(0, 250) }); }
    }
    const classified = classifyResearchLunaAttempt({ error: attempt.error ?? null,
      requestIds: attempt.bridgeRequestIds, completionIds: attempt.bridgeCompletionIds, events });
    attempt.receiptsComplete = !stopping && classified.receiptsComplete
      && attempt.dispatchReadReceipts.length === attempt.bridgeRequestIds.length
      && attempt.dispatchReadReceipts.every(receipt => receipt.requestJsonPrintedComplete === true
        && receipt.messagesIncluded === true && receipt.responseFormatIncluded === true && receipt.noVisibleTruncation === true);
    attempt.attemptStatus = stopping || !attempt.receiptsComplete ? 'protocol-failure' : classified.status;
    attempt.finishedAt = now();
    if (fs.existsSync(traceFile)) attempt.traces = fs.readFileSync(traceFile).subarray(traceOffset).toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    else attempt.traces = [];
    attempt.databaseAccess = fs.existsSync(databaseAccessFile)
      ? fs.readFileSync(databaseAccessFile).subarray(databaseAccessOffset).toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
    for (const id of attempt.bridgeRequestIds) append(ledgerFile, { ...mapping, requestId: id, at: now() });
    report.answers[answerIndex] = attempt; attemptedThisSegment.push(attempt);
    const net = await app.evaluate(() => global.__liveAnswerNetwork);
    report.network = { instrumentedExternalFetchCalls: networkBaseline.external + net.externalProviderHttpCalls,
      instrumentedLoopbackFetchCalls: networkBaseline.loopback + net.loopbackHttpCalls,
      fetchCounterCoverage: 'main-process global fetch requests; sandbox proof denies unapproved outbound connections',
      bridgeAccepted: priorAccepted + bridge.acceptedRequests(),
      bridgeCompleted: (prior?.state.network?.bridgeCompleted ?? 0)
        + eventsAfterOffset(bridge.eventFile, bridgeEventOffset).filter(row => row.event === 'completed').length };
    report.pending = pendingFor(plan, report.answers);
    save(path.join(outputRoot, 'campaign.json'), report);
    append(path.join(outputRoot, 'attempts.jsonl'), { stage: 'finished', caseId: input.id, caseAttemptId, segmentId, sourceContextHash: input.sourceContextHash,
      receiptsHash: input.receiptsHash, attemptStatus: attempt.attemptStatus, bridgeRequestIds: attempt.bridgeRequestIds,
      bridgeCompletionIds: attempt.bridgeCompletionIds, error: attempt.error ?? null, finishedAt: attempt.finishedAt });
    if (attempt.attemptStatus === 'protocol-failure' || stopping) break;
  }
  report.segments.push({ id: segmentId, ordinal: segmentOrdinal, bridgeNonceSha256, startedAt: segmentStartedAt,
    callsAccepted: bridge.acceptedRequests(), softPauseAt: SOFT_PAUSE_CALLS, requestLimit: MAX_SEGMENT_CALLS, attemptedCaseIds: attemptedThisSegment.map(row => row.caseId),
    pendingAtEnd: pendingFor(plan, report.answers).notAttempted.length });
  report.pending = pendingFor(plan, report.answers);
  report.completed = report.pending.notAttempted.length === 0 && report.answers.length === 80
    && report.answers.every(row => ['answered','verification-withheld'].includes(row.attemptStatus) && row.receiptsComplete === true
      && completeness(inputs.cases.find(input => input.id === row.caseId)));
  report.segmentPaused = !report.completed;
  report.nextSegment = report.segmentPaused ? { commandHint: `--continue-from=${outputRoot}`, pendingCaseIds: report.pending.notAttempted.map(row => row.caseId) } : null;
} catch (error) {
  report.error = { message: String(error?.message ?? error).slice(0, 700), classification: 'campaign-paused' };
  report.pending = pendingFor(plan, report.answers);
} finally {
  if (app) {
    const net = await app.evaluate(() => global.__liveAnswerNetwork).catch(() => null);
    if (net) report.network = { ...(report.network ?? {}),
      instrumentedExternalFetchCalls: networkBaseline.external + net.externalProviderHttpCalls,
      instrumentedLoopbackFetchCalls: networkBaseline.loopback + net.loopbackHttpCalls,
      fetchCounterCoverage: 'main-process global fetch requests only; OS sandbox denies unapproved outbound connections' };
  }
  if (harness) await harness.close().catch(() => undefined);
  // Closing settles the last accepted request durably; count terminal events
  // only afterward so a stopped segment cannot hide an abandoned request.
  await bridge.close().catch(() => undefined);
  const events = fs.existsSync(bridge.eventFile) ? fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
  const bridgeCopy = path.join(outputRoot, 'bridge-events.jsonl');
  const freshEvents = eventsAfterOffset(bridge.eventFile, bridgeEventOffset);
  for (const event of freshEvents) append(bridgeCopy, event);
  report.network ??= { instrumentedExternalFetchCalls: networkBaseline.external, instrumentedLoopbackFetchCalls: networkBaseline.loopback,
    fetchCounterCoverage: 'main-process global fetch requests only; no claim about all HTTP mechanisms' };
  Object.assign(report.network, summarizeResearchLiveTerminalEvents(freshEvents,
    { ...prior?.state.network, bridgeAccepted: priorAccepted }));
  report.segments ??= [];
  const currentSegment = report.segments.find(row => row.id === segmentId);
  const segmentCases = report.answers.filter(row => row.segmentId === segmentId).map(row => row.caseId);
  if (currentSegment) { currentSegment.finishedAt = now(); currentSegment.attemptedCaseIds = segmentCases; }
  else report.segments.push({ id: segmentId, ordinal: segmentOrdinal, bridgeNonceSha256, startedAt: segmentStartedAt, finishedAt: now(),
    callsAccepted: bridge.acceptedRequests(), requestLimit: MAX_SEGMENT_CALLS, attemptedCaseIds: segmentCases, pendingAtEnd: report.pending?.notAttempted?.length ?? 80 });
  report.finishedAt = now();
  report.pending = pendingFor(plan, report.answers);
  const finalSourceHashes = Object.fromEntries(SOURCE_FILES.map(file => [file, digest(fs.readFileSync(path.join(repo, file)))]));
  report.sourceHashDrift = Object.keys(currentSourceHashes).filter(file => currentSourceHashes[file] !== finalSourceHashes[file]);
  report.sourceHashesVerified = report.sourceHashDrift.length === 0;
  const databaseAccessFile = path.join(root, 'profile/database-access.jsonl');
  const databaseOpens = fs.existsSync(databaseAccessFile)
    ? fs.readFileSync(databaseAccessFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse) : [];
  const profilePath = path.join(root, 'profile');
  const databasesContained = databaseOpens.every(row => {
    if (typeof row.path !== 'string') return false;
    const relative = path.relative(profilePath, path.resolve(row.path));
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  report.databaseIsolation = { observedDatabaseOpens: databaseOpens.length, allContainedInIsolatedProfile: databasesContained,
    auditFile: databaseAccessFile };
  report.completed = report.pending.notAttempted.length === 0 && report.answers.length === 80
    && report.answers.every(row => ['answered','verification-withheld'].includes(row.attemptStatus) && row.receiptsComplete === true)
    && report.sourceHashesVerified && databasesContained;
  report.segmentPaused = !report.completed;
  save(path.join(outputRoot, 'manifest.json'), manifest);
  save(path.join(outputRoot, 'campaign.json'), report);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
if (!report.completed) process.exitCode = 1;
