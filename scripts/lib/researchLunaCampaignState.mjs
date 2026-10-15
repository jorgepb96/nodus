import fs from 'node:fs';
import path from 'node:path';

/** Pure campaign-state helpers shared by the runner's resume path and tests. */

export function createResearchLunaSegmentPaths(root, segmentId) {
  if (typeof segmentId !== 'string' || !/^segment-[a-zA-Z0-9-]{1,100}$/u.test(segmentId)) {
    throw new Error('Invalid Luna run segment ID');
  }
  const directory = path.join(root, 'artifacts', 'segments', segmentId);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  return {
    directory,
    runtime: path.join(directory, 'answer-runtime.cjs'),
    policy: path.join(directory, 'isolation.sb'),
    wrapper: path.join(directory, 'electron-isolated'),
  };
}

export function snapshotResearchLunaAgentLogs(previousRoot, target) {
  const copied = [];
  for (const name of ['agent-prompts.jsonl', 'agent-executions.jsonl']) {
    const source = path.join(previousRoot, 'artifacts', name);
    if (!fs.existsSync(source)) continue;
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) {
      throw new Error(`Unsafe prior agent log: ${name}`);
    }
    const destination = path.join(target, 'artifacts', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
    copied.push(name);
  }
  return copied;
}

export function classifyResearchLunaAttempt({ error = null, requestIds = [], completionIds = [], events = [] } = {}) {
  const requested = new Set(requestIds);
  const completedEvents = new Set(events.filter(event => event?.event === 'completed').map(event => event.id));
  const acceptedEvents = new Set(events.filter(event => event?.event === 'accepted').map(event => event.id));
  const abandonedEvents = new Set(events.filter(event => event?.event === 'abandoned').map(event => event.id));
  const completeSet = new Set(completionIds);
  const uniqueIds = requested.size === requestIds.length;
  const complete = uniqueIds && requestIds.length > 0
    && requestIds.every(id => acceptedEvents.has(id) && completedEvents.has(id) && !abandonedEvents.has(id))
    && completionIds.length === requestIds.length && completeSet.size === completionIds.length
    && completionIds.every(id => requested.has(id)) && [...requested].every(id => completeSet.has(id));
  if (!complete) return { status: 'protocol-failure', receiptsComplete: false };
  return error
    ? { status: 'verification-withheld', receiptsComplete: true }
    : { status: 'answered', receiptsComplete: true };
}

export function researchLunaPending(plan, answers) {
  const byKey = new Map(answers.map(answer => [`${answer.caseId}\0${answer.arm}`, answer]));
  const notExecuted = [];
  const verificationFailed = [];
  const protocolFailed = [];
  for (const item of plan) {
    const answer = byKey.get(`${item.caseId}\0${item.arm}`);
    if (!answer || answer.attempted !== true) notExecuted.push({ ...item });
    else if (answer.attemptStatus === 'verification-withheld') verificationFailed.push({ ...item, attempted: true });
    else if (answer.attemptStatus === 'protocol-failure') protocolFailed.push({ ...item, attempted: true });
  }
  return { notExecuted, verificationFailed, protocolFailed };
}

export function researchLunaCampaignComplete({ plan, answers, stopping = false, failed = false, sourceChanged = false, pendingCalls = 0, receiptsComplete = true } = {}) {
  if (stopping || failed || sourceChanged || pendingCalls !== 0 || !receiptsComplete) return false;
  if (answers.length !== plan.length) return false;
  const byKey = new Map(answers.map(answer => [`${answer.caseId}\0${answer.arm}`, answer]));
  if (byKey.size !== answers.length) return false;
  return plan.length === 20 && plan.every(item => {
    const answer = byKey.get(`${item.caseId}\0${item.arm}`);
    return answer?.attempted === true && ['answered', 'verification-withheld'].includes(answer.attemptStatus)
      && answer.receiptsComplete === true;
  });
}

export function validateResearchLunaContinuation({ manifest, campaign, events, currentSourceFiles, currentSourceHashes, plan, cases } = {}) {
  const reject = message => { throw new Error(`Invalid Luna continuation: ${message}`); };
  if (manifest?.format !== 'research-luna-directed/1' || campaign?.format !== manifest.format) reject('format mismatch');
  if (!campaign.finishedAt || typeof campaign.finishedAt !== 'string' || campaign.completed === true || campaign.interrupted === true) reject('prior run is not the expected terminal partial campaign');
  if (manifest.root !== campaign.root || !campaign.root || !pathIsAbsolute(campaign.root)) reject('root mismatch');
  if (manifest.model?.provider !== 'custom' || manifest.model?.bridgeModel !== 'codex-luna-qa'
      || manifest.model?.delegatedAgentModel !== 'gpt-6-luna' || manifest.model?.delegatedAgentEffort !== 'low'
      || manifest.model?.requestedTemperature !== 0 || manifest.limits?.maxTotalCalls !== 150
      || JSON.stringify(manifest.counterbalancedPlan) !== JSON.stringify(plan)) reject('model, effort, request ceiling, or fixed plan changed');
  if (campaign.bridge?.pendingCallsAfterClose !== 0) reject('prior bridge still has pending calls');
  const manifestVersion = manifest.sourceVersion;
  const campaignVersion = campaign.sourceVersion;
  if (!manifestVersion || !campaignVersion || manifestVersion.archive !== campaignVersion.archive
      || manifestVersion.archiveHash !== campaignVersion.archiveHash
      || JSON.stringify(manifestVersion.files) !== JSON.stringify(campaignVersion.files)) reject('source-version mismatch');
  if (manifestVersion.archiveHash !== currentSourceHashes[manifestVersion.archive]) reject('frozen archive changed');
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== cases.length) reject('fixed case manifest changed');
  const frozenCases = new Map(manifest.cases.map(input => [input.id, input]));
  for (const input of cases) {
    const frozen = frozenCases.get(input.id);
    if (!frozen || frozen.sourceHash !== input.sourceHash || frozen.name !== input.name || frozen.positive !== input.positive) {
      reject(`fixed source case changed: ${input.id}`);
    }
  }
  for (const file of currentSourceFiles) {
    if (['scripts/research-luna-campaign.mjs', 'scripts/lib/researchLunaCampaignState.mjs'].includes(file)) continue;
    if (manifestVersion.files?.[file] !== currentSourceHashes[file]) reject(`frozen production or harness source changed: ${file}`);
  }
  const eventsList = Array.isArray(events) ? events : [];
  const acceptedRows = eventsList.filter(event => event?.event === 'accepted');
  const completedRows = eventsList.filter(event => event?.event === 'completed');
  const abandonedRows = eventsList.filter(event => event?.event === 'abandoned');
  const acceptedIds = new Set(acceptedRows.map(event => event.id));
  const completedIds = new Set(completedRows.map(event => event.id));
  if (acceptedIds.size !== acceptedRows.length || completedIds.size !== completedRows.length
      || abandonedRows.length !== 0 || acceptedIds.size !== completedIds.size
      || [...acceptedIds].some(id => !completedIds.has(id))) reject('prior bridge receipts are incomplete or duplicated');
  if (campaign.bridge?.acceptedRequests !== acceptedRows.length
      || campaign.bridge?.maxTotalCalls !== 150
      || campaign.bridge?.events?.accepted !== acceptedRows.length
      || campaign.bridge?.events?.completed !== completedRows.length
      || campaign.bridge?.events?.abandoned !== 0) reject('prior receipt counters do not match the event log');
  const expectedPrior = new Set(plan.slice(0, 4).map(item => `${item.caseId}\0${item.arm}`));
  if (!Array.isArray(campaign.answers) || campaign.answers.length !== expectedPrior.size) reject('expected exactly the first four fixed attempts');
  const inputById = new Map(cases.map(input => [input.id, input]));
  const seenAnswers = new Set();
  const importedRequestIds = new Set();
  const priorAnswers = campaign.answers.map(answer => {
    const key = `${answer?.caseId}\0${answer?.arm}`;
    if (!expectedPrior.has(key) || seenAnswers.has(key)) reject('prior attempts do not match the fixed first-four plan');
    seenAnswers.add(key);
    const input = inputById.get(answer.caseId);
    if (!input || answer.sourceHash !== input.sourceHash) reject(`source hash mismatch for ${answer.caseId}/${answer.arm}`);
    if (!Array.isArray(answer.bridgeRequestIds) || answer.bridgeRequestIds.length === 0
        || !Array.isArray(answer.bridgeCompletionIds)) reject('prior attempt lacks bridge receipt IDs');
    for (const id of answer.bridgeRequestIds) {
      if (importedRequestIds.has(id)) reject('duplicate request ID across prior attempts');
      importedRequestIds.add(id);
    }
    const status = classifyResearchLunaAttempt({ error: answer.error ?? null,
      requestIds: answer.bridgeRequestIds, completionIds: answer.bridgeCompletionIds, events: eventsList });
    if (status.status === 'protocol-failure') reject(`prior attempt lacks completed transport receipts: ${answer.caseId}/${answer.arm}`);
    const successful = !answer.error && typeof answer.answer === 'string' && answer.answer.trim();
    if (!successful && status.status !== 'verification-withheld') reject('prior unavailable result is not a completed verification outcome');
    return { ...answer, ...(successful ? {} : { error: { ...answer.error, classification: 'verification-withheld' } }),
      attempted: true, attemptSourceVersion: 'historical', attemptStatus: successful ? 'answered' : 'verification-withheld', receiptsComplete: true };
  });
  if (seenAnswers.size !== expectedPrior.size || importedRequestIds.size !== acceptedIds.size
      || [...acceptedIds].some(id => !importedRequestIds.has(id))) reject('prior campaign receipts do not bind exactly to the four attempts');
  return { priorAnswers, acceptedCount: acceptedRows.length, priorSourceVersion: manifestVersion };
}

function pathIsAbsolute(value) {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value));
}
