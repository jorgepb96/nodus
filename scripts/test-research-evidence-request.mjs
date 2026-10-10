// Drive real corpus selection, prompt assembly, citation receipts and dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--evidence-request')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-evidence-request-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const originalTs = require.extensions['.ts'];
require.extensions['.ts'] = (mod, file) => {
  if (file === path.join(repoRoot, 'electron/ai/researchAssistant.ts')) {
    const compile = mod._compile;
    mod._compile = (code, name) => compile.call(mod, code + '\nexports.testBuildPrompt = buildResearchChatPrompt;\n', name);
  }
  originalTs(mod, file);
};
const sent = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    sent.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  globalThis.fetch = () => { throw new Error('External network forbidden in evidence fixture'); };
  load('electron/secrets/secretStore.ts').getApiKey = () => 'fixture-key';
  load('electron/ai/providers.ts').openAiCompatBase = () => `http://127.0.0.1:${server.address().port}/v1`;
  load('electron/ai/thinkingEffort.ts').thinkingCatalogInfo = async () => undefined;
  const settings = load('electron/db/settingsRepo.ts');
  settings.updateSettings({ promptLanguage: 'en', researchWebSearch: 'off' });
  const db = load('electron/db/database.ts').getDb();
  const passages = load('electron/db/passagesRepo.ts');
  for (let index = 0; index < 4; index++) {
    const id = `source-${index}`;
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
      VALUES(?,?,?,'["Fixture author"]',2020,'book','text','hash')`).run(id, id, `Budget evidence source ${index}`);
    // Each passage is 3,500 bytes but grows when JSON escapes its quotes/backslashes.
    const text = (`budget evidence ${index} ` + '"\\'.repeat(100)).padEnd(3500, 'x');
    passages.replaceWorkPassages(id, 'hash', [{ text, pageLabel: '1', embedding: null }]);
  }
  db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
    VALUES('unrelated','unrelated','UNRELATED_TITLE_MUST_NOT_BE_SENT','[]',2020,'book','text','hash')`).run();
  const ai = load('electron/ai/aiClient.ts');
  ai.embed = async () => null;
  const planner = load('electron/ai/researchTurnPlanner.ts');
  planner.planResearchTurn = async () => planner.literalResearchTurnPlan('budget evidence');
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.retrieveSharedDocumentaryEvidence = async () => ({ evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } });
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  let selectedRun;
  // The supervisor's model decisions are independent calls. This fixture uses
  // one real lexical retrieval round so it can examine the final evidence budget.
  ResearchCorpusRun.prototype.investigate = async function(query) { selectedRun = this; await this.retrieve(query, 1); };
  let systemSize = 12000;
  load('electron/ai/researchSystemPrompt.ts').withResearchSystemPrompt = () => 's'.repeat(systemSize);
  const research = load('electron/ai/researchAssistant.ts');
  const service = load('electron/ai/researchNotebookService.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const { researchPromptUpperBound } = load('shared/researchRetrievalBudget.ts');
  const request = (model, thinkingEffort = 'off') => service.authorizeNotebookRequest({
    model, messages: [{ role: 'user', content: 'budget evidence' }], webSearch: 'off', thinkingEffort,
    selection: { layers: { ideas: false, documents: true }, retrieval: { ...RETRIEVAL_PRESETS.deep, passagesPerRound: 4, autoExpand: false } },
  });
  for (const model of [{ provider: 'openai', model: 'unknown-model' }, { provider: 'deepseek', model: 'deepseek-flash' }]) {
    if (model.provider === 'deepseek') systemSize = 33000;
    const prepared = await research.testBuildPrompt(request(model), [], undefined, new AbortController().signal);
    const payload = JSON.parse(prepared.user);
    const context = payload.contexto_modular_seleccionado;
    const window = (await ai.researchModelContextWindow(model)).tokens;
    assert.ok(selectedRun.evidence.size > 0, 'retrieval still runs, including with a 33 KB system on a known large window');
    assert.ok(context.pasajes_relevantes.length > 0, 'the fitted request preserves citable evidence');
    assert.ok(ai.researchRequestUpperBound({ system: prepared.system, user: prepared.user, ...prepared.generationOptions }) <= window);
    assert.doesNotMatch(prepared.user, /UNRELATED_TITLE_MUST_NOT_BE_SENT/);
    assert.equal(prepared.stats.passages, context.pasajes_relevantes.length);
    for (const passage of context.pasajes_relevantes) {
      assert.equal(load('electron/citations/scopedLegacyCitations.ts').getScopedLegacyPassageDetail(passage.id)?.text, passage.summary,
        'fitting keeps complete receipt-bound source text and resolvable citations');
      assert.ok(passage.citation.includes(encodeURIComponent(passage.id)));
    }
    if (model.provider === 'openai') {
      assert.ok(selectedRun.evidence.size <= 2, 'the conservative 32,768 window no longer admits all four passages');
      assert.ok(context.pasajes_relevantes.length < selectedRun.evidence.size, 'final serialization is fitted after raw-text selection');
      assert.ok(prepared.stats.truncated, 'JSON expansion is reported as partial context');
    } else assert.equal(selectedRun.evidence.size, 4, 'large known windows retain the improved retrieval allowance');
    assert.equal(await ai.completeText({ system: prepared.system, user: prepared.user, ...prepared.generationOptions, corpusContext: true }, model), 'Answer');
    const wire = sent.at(-1);
    assert.equal(wire.max_tokens, prepared.generationOptions.maxTokens, 'selection and dispatch use the same frozen output budget');
    assert.ok(researchPromptUpperBound(wire.messages.find(message => message.role === 'system').content,
      wire.messages.find(message => message.role === 'user').content, wire.max_tokens) <= window, 'the complete wire request fits');
  }
  // The final output also includes thinking: selection must reserve that sum,
  // rather than budgeting only the 8,000-token visible answer.
  const thinkingModel = { provider: 'deepseek', model: 'deepseek-flash' };
  load('electron/ai/providers.ts').cachedModelContextWindow = () => 131072;
  systemSize = 43000;
  const thinking = await research.testBuildPrompt(request(thinkingModel, 'high'), [], undefined, new AbortController().signal);
  assert.equal(thinking.generationOptions.maxTokens, 8000 + 65536);
  assert.ok(selectedRun.evidence.size <= 2, 'the actual thinking reserve reduces evidence admission');
  assert.ok(JSON.parse(thinking.user).contexto_modular_seleccionado.pasajes_relevantes.length > 0);
  assert.equal(await ai.completeText({ system: thinking.system, user: thinking.user, ...thinking.generationOptions, corpusContext: true }, thinkingModel), 'Answer');
  assert.equal(sent.length, 3, 'final prompts pass real aiClient validation and reach the simulated transport');
  console.log('Evidence request: real retrieval, JSON expansion, complete citations, large-window recovery and dispatch passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
