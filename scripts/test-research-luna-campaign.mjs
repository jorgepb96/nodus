import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyResearchLunaAttempt, createResearchLunaSegmentPaths, researchLunaCampaignComplete, researchLunaPending, snapshotResearchLunaAgentLogs, validateResearchLunaContinuation } from './lib/researchLunaCampaignState.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'scripts/research-luna-campaign.mjs');
const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-campaign-test-')), 'should-not-exist');
try {
  const priorRoot = path.join(path.dirname(output), 'existing-root');
  const priorRuntime = path.join(priorRoot, 'artifacts/answer-runtime.cjs');
  fs.mkdirSync(path.dirname(priorRuntime), { recursive: true });
  fs.writeFileSync(priorRuntime, 'prior runtime must remain intact');
  fs.writeFileSync(path.join(priorRoot, 'artifacts/agent-prompts.jsonl'), 'prior prompt log\n');
  fs.writeFileSync(path.join(priorRoot, 'artifacts/agent-executions.jsonl'), 'prior execution log\n');
  const segment = createResearchLunaSegmentPaths(priorRoot, 'segment-30-test-uuid');
  assert.notEqual(segment.runtime, priorRuntime, 'continuation runtime is isolated from an existing prior-run runtime');
  assert.equal(fs.readFileSync(priorRuntime, 'utf8'), 'prior runtime must remain intact', 'prior runtime is retained');
  fs.writeFileSync(segment.runtime, 'new segment runtime', { flag: 'wx' });
  assert.throws(() => createResearchLunaSegmentPaths(priorRoot, 'segment-30-test-uuid'), /EEXIST/u,
    'a segment path cannot silently overwrite an existing run segment');
  const priorSnapshot = path.join(path.dirname(output), 'prior-snapshot');
  fs.mkdirSync(priorSnapshot);
  assert.deepEqual(snapshotResearchLunaAgentLogs(priorRoot, priorSnapshot), ['agent-prompts.jsonl', 'agent-executions.jsonl']);
  for (const name of ['agent-prompts.jsonl', 'agent-executions.jsonl']) {
    assert.equal(fs.readFileSync(path.join(priorSnapshot, 'artifacts', name), 'utf8'),
      fs.readFileSync(path.join(priorRoot, 'artifacts', name), 'utf8'), `prior snapshot preserves ${name}`);
  }

  const run = spawnSync(process.execPath, [script, `--output=${output}`], { cwd: repo, encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  const dryRun = JSON.parse(run.stdout.trim());
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.campaign, 'research-luna-directed');
  assert.equal(dryRun.agentModel, 'gpt-6-luna');
  assert.deepEqual(dryRun.applicationModel, { provider: 'custom', model: 'codex-luna-qa' });
  assert.equal(dryRun.profile, 'embeddinggemma-2-text-q8-512-v1');
  assert.deepEqual(dryRun.cases, ['policy', 'negation', 'correction', 'dates', 'statistics', 'paper', 'calculation', 'sensor', 'absent-data', 'absent-price']);
  assert.equal(dryRun.positiveCases, 8);
  assert.equal(dryRun.absenceCases, 2);
  assert.equal(dryRun.arms.length, 20);
  for (let index = 0; index < 10; index += 1) {
    const pair = dryRun.arms.slice(index * 2, index * 2 + 2);
    assert.equal(pair[0].caseId, pair[1].caseId);
    assert.deepEqual(pair.map(row => row.arm), index % 2 ? ['structured', 'legacy'] : ['legacy', 'structured']);
  }
  assert.equal(dryRun.maxTotalCalls, 150);
  assert.equal(dryRun.nodusProviderHttpCalls, 0);
  assert.equal(dryRun.openrouterCalls, 0);
  assert.equal(dryRun.deepseekCalls, 0);
  assert.match(dryRun.delegatedCodexUsage, /untallied/u, 'Codex agent usage is stated separately from provider HTTP-call counts');
  assert.equal(fs.existsSync(output), false, 'dry-run performs no campaign writes or app launch');

  const plan = dryRun.arms;
  const idEvents = [];
  const priorAnswers = plan.slice(0, 4).map((item, index) => {
    const id = `receipt-${index}`;
    idEvents.push({ event: 'accepted', id }, { event: 'completed', id });
    return { ...item, sourceHash: `source-${item.caseId}`, attempted: true, bridgeRequestIds: [id], bridgeCompletionIds: [id],
      ...(index === 3 ? { error: { classification: 'generation-or-verification-failed' } } : { answer: 'synthetic completed response' }) };
  });
  const priorFiles = { 'fixture/archive.json': 'archive-hash', 'electron/ai/research.ts': 'production-hash',
    'scripts/research-luna-bridge.mjs': 'bridge-hash', 'scripts/research-luna-campaign.mjs': 'old-runner-hash' };
  const currentFiles = { ...priorFiles, 'scripts/research-luna-campaign.mjs': 'new-runner-hash',
    'scripts/lib/researchLunaCampaignState.mjs': 'new-state-helper-hash' };
  const frozenCases = [...new Set(plan.map(row => row.caseId))].map(id => ({ id, name: id.split('/').at(-1),
    sourceHash: `source-${id}`, positive: !id.endsWith('absent-data') && !id.endsWith('absent-price') }));
  const manifest = { format: 'research-luna-directed/1', root: '/tmp/nodus-luna-isolated',
    model: { provider: 'custom', bridgeModel: 'codex-luna-qa', delegatedAgentModel: 'gpt-6-luna', delegatedAgentEffort: 'low', requestedTemperature: 0 },
    limits: { maxTotalCalls: 150 }, counterbalancedPlan: plan, cases: frozenCases,
    sourceVersion: { archive: 'fixture/archive.json', archiveHash: 'archive-hash', files: priorFiles } };
  const campaign = { format: manifest.format, root: manifest.root, finishedAt: '2026-10-12T00:00:00.000Z', completed: false,
    sourceVersion: manifest.sourceVersion, answers: priorAnswers,
    bridge: { acceptedRequests: 4, maxTotalCalls: 150, pendingCallsAfterClose: 0,
      events: { accepted: 4, completed: 4, abandoned: 0 } } };
  const currentSourceFiles = [...Object.keys(currentFiles), 'scripts/lib/researchLunaCampaignState.mjs'];
  const continuation = validateResearchLunaContinuation({ manifest, campaign, events: idEvents, currentSourceFiles,
    currentSourceHashes: currentFiles, plan, cases: frozenCases });
  assert.equal(continuation.acceptedCount, 4);
  assert.equal(continuation.priorAnswers[3].attemptStatus, 'verification-withheld', 'completed app-level refusal is retained as an attempted negative');
  assert.deepEqual(continuation.priorAnswers.map(row => row.sourceHash), priorAnswers.map(row => row.sourceHash));
  assert.throws(() => validateResearchLunaContinuation({ manifest, campaign, events: idEvents, currentSourceFiles,
    currentSourceHashes: { ...currentFiles, 'electron/ai/research.ts': 'changed-production-hash' }, plan, cases: frozenCases }), /source changed/u);
  assert.throws(() => validateResearchLunaContinuation({ manifest, campaign, events: idEvents.slice(0, -1), currentSourceFiles,
    currentSourceHashes: currentFiles, plan, cases: frozenCases }), /receipts/u);

  const withheld = classifyResearchLunaAttempt({ error: new Error('application verification withheld'), requestIds: ['r1'], completionIds: ['r1'],
    events: [{ event: 'accepted', id: 'r1' }, { event: 'completed', id: 'r1' }] });
  assert.deepEqual(withheld, { status: 'verification-withheld', receiptsComplete: true });
  assert.equal(classifyResearchLunaAttempt({ error: new Error('timeout'), requestIds: ['r1'], completionIds: [],
    events: [{ event: 'accepted', id: 'r1' }, { event: 'abandoned', id: 'r1' }] }).status, 'protocol-failure');
  const fullResults = plan.map(item => ({ ...item, attempted: true, receiptsComplete: true,
    attemptStatus: item === plan[3] ? 'verification-withheld' : 'answered' }));
  assert.equal(researchLunaCampaignComplete({ plan, answers: fullResults }), true,
    'campaign completion records all attempted arms even when one arm withheld publication');
  assert.equal(researchLunaCampaignComplete({ plan, answers: fullResults, receiptsComplete: false }), false,
    'incomplete global bridge accounting prevents campaign completion');
  assert.equal(researchLunaCampaignComplete({ plan, answers: fullResults, failed: true }), false,
    'a terminal campaign transport error prevents completion even if attempts are present');
  const pending = researchLunaPending(plan, [...continuation.priorAnswers, ...fullResults.slice(4)]);
  assert.equal(pending.notExecuted.length, 0);
  assert.equal(pending.verificationFailed.length, 1);
  assert.equal(pending.protocolFailed.length, 0);
  console.log('PASS Luna campaign controls: fixed Q8-512 plan, completed-refusal classification, exact first-four continuation binding, no-retry pending states, and cumulative receipt gates.');
} finally {
  fs.rmSync(path.dirname(output), { recursive: true, force: true });
}
