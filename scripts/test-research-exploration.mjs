import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-exploration')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-exploration-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in research profile regression'); };
try {
  const { resolveResearchExploration, sanitizeResearchExploration, researchExplorationRetrieval } = load('shared/researchExploration.ts');
  for (const mode of ['chat', 'dictionary', 'deep-research', 'immersion']) {
    assert.equal(resolveResearchExploration(mode), ['chat', 'dictionary'].includes(mode) ? 'fast' : 'expanded');
    assert.equal(resolveResearchExploration(mode, 'expanded', { [mode]: 'fast' }), 'expanded');
    assert.equal(resolveResearchExploration(mode, undefined, { [mode]: 'fast' }), 'fast');
  }
  assert.deepEqual(sanitizeResearchExploration({ chat: 'expanded', dictionary: 'fast', immersion: 'unknown', other: 'expanded' }), { chat: 'expanded', dictionary: 'fast' });
  assert.deepEqual(sanitizeResearchExploration(['fast']), {});
  const settings = load('electron/db/settingsRepo.ts');
  assert.equal(settings.getSettings().researchHarnessVersion, 'v1', 'New installations use the promoted harness');
  const db = load('electron/db/database.ts').getDb();
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('app', JSON.stringify({ researchHarnessVersion: 'legacy' }));
  assert.equal(settings.getSettings().researchHarnessVersion, 'v1', 'Old preview defaults are promoted exactly once');
  settings.updateSettings({ researchHarnessVersion: 'legacy' });
  assert.equal(settings.getSettings().researchHarnessVersion, 'legacy', 'An explicit post-promotion compatibility override remains available');
  assert.equal(settings.getSettings().researchHarnessRolloutVersion, 1);
  settings.updateSettings({ researchHarnessVersion: 'v1' });

  settings.updateSettings({ researchExplorationByMode: { chat: 'expanded' } });
  settings.updateSettings({ researchExplorationByMode: { dictionary: 'fast' } });
  assert.deepEqual(settings.getSettings().researchExplorationByMode, { chat: 'expanded', dictionary: 'fast' }, 'One surface cannot overwrite another surface preference');
  assert.ok(load('electron/db/appPrefs.ts').SHARED_MODEL_KEYS.includes('researchExplorationByMode'));
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const smaller = { ...RETRIEVAL_PRESETS.fast, autoExpand: false };
  assert.deepEqual(researchExplorationRetrieval(smaller, 'fast'), smaller, 'The quick profile cannot enlarge an explicitly smaller target');
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const { researchHarnessContext } = load('electron/ai/researchHarnessContext.ts');
  const { withResearchHarness, currentResearchHarness, interruptResearchRun } = load('electron/ai/researchHarnessRuntime.ts');
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const runs = load('electron/db/researchRunsRepo.ts');
  const selection = { layers: { ideas: false, documents: false, indexed: true, web: false } };
  const request = { harnessVersion: 'v1', model: { provider: 'deepseek', model: 'deepseek-flash' }, messages: [{ role: 'user', content: 'Compare the sources' }], selection, thinkingEffort: 'high' };
  const contextFor = request => ({ ...researchHarnessContext('chat', request, scope), model: null });
  assert.equal(contextFor(request).explorationMode, 'expanded', 'Backend requests use the stored surface preference');
  let fastId;
  const fastRequest = { ...request, explorationMode: 'fast' };
  const input = { request: fastRequest, context: contextFor(fastRequest), scope, validate: () => {} };
  await assert.rejects(() => withResearchHarness(input, async signal => {
    const harness = currentResearchHarness(); fastId = harness.record.summary.id;
    harness.record.checkpoint.modelContext = { tokens: 131072 };
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    assert.equal(run.budget.settings.rounds, 4);
    assert.equal(run.budget.roundLimit, 6, 'Fast research retains a bounded margin for important gaps');
    assert.equal(run.budget.evidenceTokenLimit, 24000);
    assert.equal(run.budget.decisionTokenLimit, 96000);
    run.budget.rounds = 2; run.budget.decisionTokens = 12000;
    run.budget.roundLimit = 5; run.budget.evidenceTokenLimit = 18000;
    run.budget.decisionTokenLimit = 50000; run.checkpoint();
    interruptResearchRun(fastId); signal.throwIfAborted();
  }), /research_run_paused/);
  const saved = runs.getResearchRun(fastId);
  assert.equal(saved.request.explorationMode, 'fast');
  assert.equal(saved.summary.explorationMode, 'fast');
  settings.updateSettings({ researchExplorationByMode: { chat: 'expanded' } });
  const resumeRequest = { ...saved.request, runId: fastId };
  const resumed = await withResearchHarness({ ...input, request: resumeRequest, context: contextFor(resumeRequest) }, async signal => {
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    assert.equal(run.budget.rounds, 2); assert.equal(run.budget.roundLimit, 5);
    assert.equal(run.budget.evidenceTokenLimit, 18000); assert.equal(run.budget.decisionTokenLimit, 50000);
    assert.equal(run.budget.decisionTokens, 12000, 'Continuation preserves consumed allowance');
    return { answer: 'Same investigation continued' };
  });
  assert.equal(resumed.researchRun.explorationMode, 'fast');
  const different = { ...resumeRequest, explorationMode: 'expanded' };
  await assert.rejects(() => withResearchHarness({ ...input, request: different, context: contextFor(different) }, async () => ({})), /context_changed/);
  const expandedRequest = { ...request, explorationMode: 'expanded', thinkingEffort: 'none' };
  await withResearchHarness({ ...input, request: expandedRequest, context: contextFor(expandedRequest) }, async signal => {
    const harness = currentResearchHarness(); harness.record.checkpoint.modelContext = { tokens: 131072 };
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    assert.equal(run.budget.settings.rounds, 8); assert.equal(run.budget.roundLimit, 16);
    assert.equal(run.budget.evidenceTokenLimit, 32000); assert.equal(run.budget.decisionTokenLimit, 256000);
    return { answer: 'Expanded stays independent of model thinking' };
  });
  await withResearchHarness({ ...input, request: { ...fastRequest, emptyFixture: true }, context: contextFor(fastRequest) }, async signal => {
    assert.equal(scope.documents.length, 0);
    const ai = load('electron/ai/aiClient.ts'); let decisions = 0;
    ai.completeJson = async () => { decisions++; throw new Error('No library action is available'); };
    const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.deep, signal);
    await load('electron/ai/researchActionCoordinator.ts').deepenResearch(run, 'Read the attached file');
    assert.equal(decisions, 0, 'An empty corpus with web off buys no supervisor call');
    assert.equal(currentResearchHarness().record.summary.stopReason, 'sources_exhausted');
    return { answer: 'Attachment context remains available to the writer' };
  });
  console.log('Research exploration: defaults, stored choices, request overrides, shared budgets, independent thinking, immutable profile and allowance on continuation passed.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
