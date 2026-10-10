import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-request-budget')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-request-budget-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const sent = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    sent.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'Bounded answer' }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const { withResearchRequestBudget: bounded, currentResearchRequestBudget: current, researchPromptUpperBound: size } = load('electron/ai/researchRequestBudget.ts');
  assert.equal(size('你好', 'é', 100), 8 + 100 + 1024, 'UTF-8 bounds multilingual text rather than assuming English characters/token');
  let release;
  const pending = bounded(4096, () => {}, async () => { await new Promise(resolve => { release = resolve; }); assert.equal(current().window, 4096); });
  assert.equal(current(), undefined, 'concurrent ordinary work has no inherited report limit');
  await bounded(8192, () => {}, async () => { assert.equal(current().window, 8192); release(); });
  await pending;
  const { ResearchRetrievalBudget } = load('shared/researchRetrievalBudget.ts');
  const budget = new ResearchRetrievalBudget(load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep);
  // Selection and dispatch both use UTF-8 bytes as an upper bound on tokens.
  budget.constrainToWindow(4096, 3500);
  assert.equal(budget.evidenceTokenLimit, 596);
  assert.equal(budget.accept('first', 'a'.repeat(500)), true);
  assert.equal(budget.accept('second', '界'.repeat(40)), false);
  assert.equal(budget.partial, true);
  budget.constrainToWindow(8192, 0);
  assert.equal(budget.evidenceTokenLimit, 596, 'later requests cannot reset or enlarge a run budget');
  // A prompt that already fills the window leaves nothing, rather than a floor's worth of
  // evidence on a payload that cannot fit.
  const tight = new ResearchRetrievalBudget(load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep);
  tight.constrainToWindow(1000, 99999);
  assert.equal(tight.evidenceTokenLimit, 0);
  assert.equal(tight.nextRound(), false, 'no round starts when the prompt does not fit');
  const tiny = new ResearchRetrievalBudget(load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep);
  tiny.constrainToWindow(1000, 999);
  assert.equal(tiny.evidenceTokenLimit, 1, 'a positive remainder is never rounded up to an unsafe floor');
  assert.equal(tiny.accept('too large', 'é'), false);
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No external provider is permitted in this test'); };
  const ai = load('electron/ai/aiClient.ts');
  load('electron/ai/providers.ts').openAiCompatBase = () => `http://127.0.0.1:${server.address().port}/v1`;
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  assert.deepEqual(await ai.researchModelContextWindow(model), { tokens: 1000000, known: true });
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'custom', model: 'unknown' }), { tokens: 32768, known: false });
  let overflows = 0;
  const opts = { system: 'Instructions'.repeat(100), user: JSON.stringify({ history: ['historic'.repeat(1000)], tools: [], evidence: 'text' }), maxTokens: 2048 };
  for (const complete of [() => ai.completeText(opts, model), () => ai.completeTextStream(opts, () => {}, model), () => ai.completeJson(opts, () => true, model)]) {
    await assert.rejects(() => bounded(4096, () => { overflows++; }, complete), error => error.code === 'context_overflow');
  }
  assert.equal(overflows, 3);
  assert.equal(calls, 0, 'overflow is rejected before credentials, transport or paid dispatch');
  await assert.rejects(() => ai.completeText({ ...opts, corpusContext: true, user: 'x'.repeat(33000) }, { provider: 'custom', model: 'unknown' }), error => error.code === 'context_overflow');
  assert.equal(calls, 0);
  // Regression: go from evidence admission through the REAL final request check
  // and transport. The old window * 3.2 allowance admitted all four passages:
  // 12,000 + 14,000 + 8,000 + 1,024 = 35,024 > 32,768.
  load('electron/secrets/secretStore.ts').getApiKey = () => 'fixture-key';
  for (const fragment of ['x'.repeat(3500), '界'.repeat(1166) + 'ab']) {
    const selection = new ResearchRetrievalBudget(load('shared/researchCorpus.ts').RETRIEVAL_PRESETS.deep);
    const system = 's'.repeat(12000);
    selection.constrainToWindow(32768, Math.max(Math.ceil(32768 * .75), size(system, '', 8000)));
    const evidence = Array.from({ length: 4 }, (_, index) => selection.accept(`p-${index}`, fragment) ? fragment : '').join('');
    assert.equal(selection.visited.size, 2, 'two complete 3,500-byte fragments fit');
    assert.equal(size(system, evidence, 8000), 28024);
    await bounded(32768, () => { overflows++; }, () => ai.completeText({ system, user: evidence, maxTokens: 8000, plainContext: true }, model));
  }
  assert.equal(sent.length, 2, 'accepted evidence survives final validation and reaches the transport');
  assert.equal(overflows, 3, 'selection caused no new context overflow');
  const providers = load('electron/ai/providers.ts');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ id: 'synthetic/model', context_length: 8192, top_provider: { context_length: 4096 } }] }) });
  await providers.listModels('openrouter', null);
  assert.equal(providers.cachedModelContextWindow('openrouter', 'synthetic/model'), 4096, 'respect the smaller advertised route window');
  console.log('Research context: run isolation, multilingual accounting, output/history reserve, provider metadata and pre-dispatch rejection passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
