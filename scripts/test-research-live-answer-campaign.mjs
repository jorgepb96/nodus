/** Static-contract and local bridge integration test; never launches Electron or a model. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchLunaBridge, writeResearchLunaResponse } from './research-luna-bridge.mjs';
import { newLiveAcceptedEvents, pendingResearchLiveCases, planResearchLiveCases, selectResearchLiveDiagnosticCases,
  summarizeResearchLiveTerminalEvents, validateResearchLiveAdmissionStop } from './lib/researchLiveAnswerCampaignState.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(20);
  }
  throw new Error('Timed out waiting for local bridge event');
}

const kinds = [...Array(10).fill('complex-multisource'), ...Array(10).fill('hard'),
  ...Array(40).fill('core'), ...Array(20).fill('no-evidence')];
// The live evidence preregistration uses these public cohort labels. A test
// with only normalized runner labels misses failures before the first call.
const preregisteredKinds = [...Array(8).fill('historical-complex'), 'complex-multisource', 'complex-table-calculation',
  ...Array(10).fill('hard-negative'), ...Array(20).fill('monolingual'),
  ...Array(20).fill('cross-language'), ...Array(20).fill('no-evidence')];
const fixture80 = kinds.map((kind, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`, kind,
  sourceCaseHash: sha(`structural-case-${index + 1}`) }));
const plan = planResearchLiveCases(fixture80);
assert.deepEqual(planResearchLiveCases(fixture80.map((row, index) => ({ ...row, kind: preregisteredKinds[index] }))), plan,
  'original evidence cohort names map to the same fixed eighty-case run order');
assert.equal(plan.length, 80);
assert.deepEqual(plan.slice(0, 10).map(row => row.kind), Array(10).fill('complex'));
assert.deepEqual(plan.slice(10, 20).map(row => row.kind), Array(10).fill('hard'));
assert.deepEqual(plan.slice(20, 60).map(row => row.kind), Array(40).fill('core'));
assert.deepEqual(plan.slice(60).map(row => row.kind), Array(20).fill('absence'));
assert.deepEqual(selectResearchLiveDiagnosticCases(plan, ['R014', 'R005', 'R009']), [plan[4], plan[8], plan[13]],
  'a targeted diagnostic preserves the original frozen case order and identities');
assert.equal(plan.length, 80, 'diagnostic selection does not rewrite the whole-cohort roster');
for (const invalid of [[], ['R005', 'R005'], ['R999'], ['R5'], [null], plan.map(row => row.caseId)]) {
  assert.throws(() => selectResearchLiveDiagnosticCases(plan, invalid), /diagnostic|Diagnostic/u);
}

const root = createResearchTestRoot();
let bridge;
try {
  bridge = await startResearchLunaBridge({ root, maxRequests: 150 });
  const caseAnswers = [];
  for (const input of plan.slice(0, 2)) {
    const sourceContext = JSON.stringify({ current: input.caseId });
    const sourcesContext = { receipts: [{ citationId: `receipt:${input.caseId}`, resolved: true }] };
    const receiptsHash = sha(JSON.stringify(sourcesContext));
    const before = new Set(fs.readdirSync(bridge.requestDirectory).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
    const responsePromise = fetch(`${bridge.url}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
      body: JSON.stringify({ model: bridge.model, messages: [{ role: 'user', content: `qa-${input.caseId}` }], max_tokens: 100 }) });
    const accepted = await waitFor(() => {
      if (!fs.existsSync(bridge.eventFile)) return null;
      const events = fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
      return newLiveAcceptedEvents(events, before)[0] ?? null;
    });
    assert.ok(!before.has(accepted.id), 'accepted request must belong to the current case');
    const eventsAfterAccept = fs.readFileSync(bridge.eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    const live = newLiveAcceptedEvents(eventsAfterAccept, before);
    assert.deepEqual(live.map(row => row.id), [accepted.id], 'previous completed request must not be remapped to next case');
    const requestFile = path.join(bridge.requestDirectory, `${accepted.id}.json`);
    const completionTextFile = path.join(bridge.root, 'artifacts/raw-completions', `${accepted.id}.txt`);
    fs.writeFileSync(completionTextFile, `Local deterministic QA response for ${input.caseId}.`, { mode: 0o600, flag: 'wx' });
    writeResearchLunaResponse(requestFile, completionTextFile);
    const response = await responsePromise;
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.choices[0].message.content, new RegExp(input.caseId));
    caseAnswers.push({ caseId: input.caseId, sourceCaseHash: input.sourceCaseHash,
      sourceContext, sourceContextHash: sha(sourceContext), sourcesContext, receiptsHash,
      bridgeRequestIds: [accepted.id], attemptStatus: 'answered', receiptsComplete: true });
  }

  const sourceSnapshots = plan.map(item => ({ ...item, sourceContext: JSON.stringify({ current: item.caseId }),
    sourcesContext: { receipts: [{ citationId: `receipt:${item.caseId}`, resolved: true }] } }));
  const campaignFile = path.join(root, 'artifacts/campaign-continuation.json');
  const sourceSnapshotFile = path.join(root, 'artifacts/source-snapshot.json');
  fs.writeFileSync(campaignFile, JSON.stringify({ answers: caseAnswers }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(sourceSnapshotFile, JSON.stringify({ cases: sourceSnapshots }), { mode: 0o600, flag: 'wx' });
  const reloadedCampaign = JSON.parse(fs.readFileSync(campaignFile, 'utf8'));
  const reloadedSources = JSON.parse(fs.readFileSync(sourceSnapshotFile, 'utf8'));
  const remaining = pendingResearchLiveCases(plan, reloadedCampaign.answers).notAttempted;
  assert.equal(remaining.length, 78);
  assert.equal(remaining[0].caseId, plan[2].caseId);
  const loadedReceipt = reloadedSources.cases.find(row => row.caseId === remaining[0].caseId);
  assert.equal(sha(loadedReceipt.sourceContext), sha(JSON.stringify({ current: loadedReceipt.caseId })));
  assert.equal(loadedReceipt.sourcesContext.receipts[0].citationId, `receipt:${loadedReceipt.caseId}`);
  assert.deepEqual(pendingResearchLiveCases(plan, caseAnswers).notAttempted[0], {
    caseId: loadedReceipt.caseId, ordinal: plan[2].ordinal, sourceCaseHash: loadedReceipt.sourceCaseHash });
  const stopRequest = { format: 'nodus.live-answer-admission-stop/1', root, reason: 'source qualification' };
  assert.equal(validateResearchLiveAdmissionStop(stopRequest, root), stopRequest);
  assert.throws(() => validateResearchLiveAdmissionStop({ ...stopRequest, root: `${root}-wrong` }, root), /admission-stop/u);
  assert.throws(() => validateResearchLiveAdmissionStop({ root }, root), /admission-stop/u);

  // Reproduce a controller interruption with a request admitted but unanswered.
  // The terminal summary must count abandonment emitted only by bridge.close().
  const abandonedFetch = fetch(`${bridge.url}/chat/completions`, { method: 'POST',
    headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
    body: JSON.stringify({ model: bridge.model, messages: [{ role: 'user', content: 'pending at close' }], max_tokens: 100 }) });
  await waitFor(() => bridge.acceptedRequests() === 3);
  await bridge.close();
  await abandonedFetch;
  const terminalEvents = fs.readFileSync(bridge.eventFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  assert.deepEqual(summarizeResearchLiveTerminalEvents(terminalEvents),
    { bridgeAccepted: 3, bridgeCompleted: 2, bridgeAbandoned: 1 });
  assert.deepEqual(summarizeResearchLiveTerminalEvents(terminalEvents, { bridgeAccepted: 40, bridgeCompleted: 39, bridgeAbandoned: 1 }),
    { bridgeAccepted: 43, bridgeCompleted: 41, bridgeAbandoned: 2 });
  assert.deepEqual(summarizeResearchLiveTerminalEvents([...terminalEvents, ...terminalEvents]),
    { bridgeAccepted: 3, bridgeCompleted: 2, bridgeAbandoned: 1 }, 'duplicate observations must not double count one request');
  bridge = null;
  console.log(JSON.stringify({ ok: true, sourceFixtureCases: fixture80.length,
    localBridgeCasesCompleted: caseAnswers.length, previousAcceptedExcludedFromNextCase: true,
    nextSegmentCasesPending: remaining.length, receiptSnapshotsLoaded: true,
    electronLaunches: 0, modelGenerations: 0 }));
} finally {
  if (bridge) await bridge.close();
  fs.rmSync(root, { recursive: true, force: true });
}
