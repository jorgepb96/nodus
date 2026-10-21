// Exercise production catalogue parsing, the shared cache and both completion
// guards. Provider SDKs send only to a loopback fixture; Copilot's catalogue is
// stubbed at its SDK boundary. No credentials or paid inference are needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--provider-context-integration')) process.exit(0);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-context-integration-'));
installRuntimeHooks(profile);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const Module = require('node:module');
const originalLoad = Module._load;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalAnthropicBase = process.env.ANTHROPIC_BASE_URL;
let now = originalNow();
let copilotWindow = 262_144;
Module._load = function (request, ...args) {
  if (request === '@github/copilot-sdk') return {
    CopilotClient: class {
      async start() {}
      async stop() {}
      async forceStop() {}
      async getAuthStatus() { return { isAuthenticated: true }; }
      async listModels() { return [{ id: 'runtime-only', name: 'Runtime model', capabilities: { limits: { max_context_window_tokens: copilotWindow } } }]; }
    },
    RuntimeConnection: { forStdio: () => ({}) },
  };
  return originalLoad.call(this, request, ...args);
};
Date.now = () => now;
let sent = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    sent++;
    const body = JSON.parse(raw);
    const anthropic = req.url.endsWith('/messages');
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(anthropic
        ? 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Answer"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
        : 'data: {"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(anthropic
        ? { content: [{ type: 'text', text: 'Answer' }], stop_reason: 'end_turn' }
        : { choices: [{ message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }] }));
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const json = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
let anthropicLimit = 600_000;
let anthropicCatalogueFails = false;
let geminiLimit = 1_048_576;
let enrichmentFails = false;
let privateCerebrasLimit;
let catalogueReads = 0;
let holdCustomCatalogue = false;
let customCatalogueFails = false;
let releaseCustomCatalogue;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.pathname.endsWith('/api/v0/models')) return Promise.resolve(json({ data: [{ id: 'gpt-6.1-sol', state: 'loaded', type: 'llm', max_context_length: 1_050_000, loaded_context_length: 4096 }] }));
  if (url.pathname.endsWith('/models')) {
    catalogueReads++;
    if (url.hostname === 'api.anthropic.com') {
      if (anthropicCatalogueFails) return Promise.reject(new Error('Catalogue unavailable'));
      return Promise.resolve(json({ data: [
      { id: 'claude-catalogue-only', max_input_tokens: anthropicLimit },
      { id: 'claude-opus-5-5', max_input_tokens: 120_000 },
      ...[0, -1, 1.5, '1000000', null].map((max_input_tokens, i) => ({ id: `invalid-${i}`, max_input_tokens })),
      ] }));
    }
    if (url.hostname === 'generativelanguage.googleapis.com') return Promise.resolve(json({ models: [
      { name: 'models/gemini-live', inputTokenLimit: geminiLimit, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/invalid-live', inputTokenLimit: -1, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-only', inputTokenLimit: 8192, supportedGenerationMethods: ['embedContent'] },
    ] }));
    if (url.hostname === 'api.cerebras.ai') {
      if (url.pathname.includes('/public/')) {
        assert.equal(init?.headers, undefined, 'the public metadata request never carries an API key');
        if (enrichmentFails) return Promise.reject(new Error('Public catalogue unavailable'));
        return Promise.resolve(json({ data: [
          { id: 'gpt-oss-120b', limits: { max_context_length: 131_072 } },
          { id: 'qwen-3.8-27b', limits: { max_context_length: 65_536 } },
          { id: 'not-in-account', limits: { max_context_length: 1_000_000 } },
        ] }));
      }
      return Promise.resolve(json({ data: [{ id: 'gpt-oss-120b', context_window: privateCerebrasLimit }, { id: 'qwen-3.8-27b' }] }));
    }
    if (url.hostname === 'api.openai.com') return Promise.resolve(json({ data: [{ id: 'gpt-6.1-sol' }] }));
    if (url.hostname === 'openrouter.ai') return Promise.resolve(json({ data: [{ id: 'anthropic/claude-opus-5-5', context_length: 1_000_000, top_provider: { context_length: 4096 } }] }));
    if (url.origin === new URL(base).origin) {
      if (customCatalogueFails) return Promise.reject(new Error('Custom catalogue unavailable'));
      const response = json({ data: [url.pathname.includes('/gateway-a/')
        ? { id: 'same-id', context_length: 131_072 }
        : { id: 'same-id', context_window: 0, max_model_len: 8192 }] });
      return holdCustomCatalogue ? new Promise(resolve => { releaseCustomCatalogue = () => resolve(response); }) : Promise.resolve(response);
    }
    throw new Error(`Unmocked catalogue: ${url}`);
  }
  assert.equal(url.origin, new URL(base).origin, `External inference forbidden: ${url.origin}`);
  return originalFetch(input, init);
};

try {
  const providers = load('electron/ai/providers.ts');
  const settings = load('electron/db/settingsRepo.ts');
  load('electron/secrets/secretStore.ts').getApiKey = () => 'fixture-key';
  providers.openAiCompatBase = () => base;
  process.env.ANTHROPIC_BASE_URL = base;
  const ai = load('electron/ai/aiClient.ts');
  const options = bytes => ({ system: 'Summarize', user: 'x'.repeat(bytes), maxTokens: 1024, corpusContext: true, reasoning: 'off' });
  const send = (model, bytes, stream = false) => stream
    ? ai.completeTextStream(options(bytes), () => {}, model)
    : ai.completeText(options(bytes), model);
  const refused = async (model, bytes) => {
    const before = sent;
    for (const stream of [false, true]) await assert.rejects(() => send(model, bytes, stream), error => error.code === 'context_overflow');
    assert.equal(sent, before, 'an overflow must not reach the provider');
  };
  const opus = { provider: 'anthropic', model: 'claude-catalogue-only' };
  const catalogue = await providers.listModels('anthropic', 'fixture-key');
  assert.equal(catalogue.find(m => m.id === opus.model).contextLength, 600_000);
  for (let i = 0; i < 5; i++) assert.equal(providers.cachedModelContextWindow('anthropic', `invalid-${i}`), null);
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'anthropic', model: 'claude-opus-5-5' }), { tokens: 120_000, known: true }, 'advertised limits beat a larger documented window');
  for (const stream of [false, true]) assert.equal(await send(opus, 250_000, stream), 'Answer');
  now += 300_001;
  const reads = catalogueReads;
  assert.deepEqual(await ai.researchModelContextWindow(opus), { tokens: 600_000, known: true });
  for (const stream of [false, true]) assert.equal(await send(opus, 250_000, stream), 'Answer');
  assert.equal(catalogueReads, reads, 'budget checks do not discover models or refresh catalogues');
  anthropicCatalogueFails = true;
  await assert.rejects(() => providers.listModels('anthropic', 'fixture-key'), /api\.anthropic\.com.*NETWORK_ERROR/);
  assert.equal((await ai.researchModelContextWindow(opus)).tokens, 600_000, 'a failed refresh retains the last successful catalogue');
  anthropicCatalogueFails = false;
  anthropicLimit = 65_536;
  await providers.listModels('anthropic', 'fixture-key');
  await refused(opus, 70_000);
  anthropicLimit = undefined;
  await providers.listModels('anthropic', 'fixture-key');
  assert.equal(providers.cachedModelContextWindow('anthropic', opus.model), null, 'a successful refresh removes a missing limit');
  assert.deepEqual(await ai.researchModelContextWindow(opus), { tokens: 32768, known: false });
  await refused(opus, 40_000);
  console.log('Anthropic: parsed limits, invalid metadata, precedence, 5-minute regression, both transports and refreshed reductions passed.');

  const gemini = { provider: 'gemini', model: 'gemini-live' };
  const geminiModels = await providers.listModels('gemini', 'fixture-key');
  assert.deepEqual(geminiModels.map(m => m.id), ['gemini-live', 'invalid-live']);
  assert.deepEqual(await ai.researchModelContextWindow(gemini), { tokens: 1_048_576, known: true });
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'gemini', model: 'invalid-live' }), { tokens: 32768, known: false });
  assert.equal(await send(gemini, 60_000), 'Answer');
  geminiLimit = 8192;
  await providers.listModels('gemini', 'fixture-key');
  await refused(gemini, 10_000);
  console.log('Gemini: inputTokenLimit reaches the actual request guard and updated limits are enforced.');

  for (const model of [{ provider: 'openai', model: 'gpt-6.1-sol' }, { provider: 'xiaomi', model: 'mimo-v2.6-pro' }]) {
    assert.ok((await ai.researchModelContextWindow(model)).tokens >= 1_000_000);
    assert.equal(await send(model, 60_000), 'Answer');
  }
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'opencode-go', model: 'gpt-6-luna' }), { tokens: 922_000, known: true });
  await refused({ provider: 'opencode-go', model: 'gpt-6-luna' }, 923_000);
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'codex', model: 'gpt-6-sol' }), { tokens: 32768, known: false });
  console.log('Documented OpenAI, Xiaomi and Go envelopes reach the request guard; Codex does not inherit API limits.');

  const cerebras = { provider: 'cerebras', model: 'gpt-oss-120b' };
  const cerebrasModels = await providers.listModels('cerebras', 'fixture-key');
  assert.deepEqual(cerebrasModels.map(m => m.id), ['gpt-oss-120b', 'qwen-3.8-27b']);
  assert.deepEqual(await ai.researchModelContextWindow(cerebras), { tokens: 131_072, known: true });
  assert.equal(await send(cerebras, 80_000), 'Answer');
  await refused({ provider: 'cerebras', model: 'qwen-3.8-27b' }, 70_000);
  privateCerebrasLimit = 8192;
  await providers.listModels('cerebras', 'fixture-key');
  assert.equal((await ai.researchModelContextWindow(cerebras)).tokens, 8192, 'account metadata takes precedence over the public catalogue');
  enrichmentFails = true;
  assert.equal((await providers.listModels('cerebras', 'fixture-key')).length, 2, 'optional enrichment failure does not hide available models');
  console.log('Cerebras: live catalogue shape, account availability, account precedence, no credential leakage and optional failure passed.');

  await providers.listModels('openrouter', null);
  const routed = { provider: 'openrouter', model: 'anthropic/claude-opus-5-5' };
  assert.equal((await ai.researchModelContextWindow(routed)).tokens, 4096);
  now += 300_001;
  assert.equal((await ai.researchModelContextWindow(routed)).tokens, 4096, 'the smaller gateway limit also survives the old TTL');
  await refused(routed, 4500);
  settings.updateSettings({ customProvider: { baseUrl: `${base}/gateway-a/v1`, models: [] } });
  await providers.listModels('custom', null);
  assert.equal((await ai.researchModelContextWindow({ provider: 'custom', model: 'same-id' })).tokens, 131_072);
  holdCustomCatalogue = true;
  const refreshA = providers.listModels('custom', null);
  assert.ok(releaseCustomCatalogue);
  settings.updateSettings({ customProvider: { baseUrl: `${base}/gateway-b/v1`, models: [] } });
  releaseCustomCatalogue();
  await refreshA;
  holdCustomCatalogue = false;
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'custom', model: 'same-id' }), { tokens: 32768, known: false });
  await providers.listModels('custom', null);
  assert.equal((await ai.researchModelContextWindow({ provider: 'custom', model: 'same-id' })).tokens, 8192);
  settings.updateSettings({ customProvider: { baseUrl: `${base}/gateway-b/v1`, models: ['same-id'] } });
  customCatalogueFails = true;
  assert.deepEqual((await providers.listModels('custom', null)).map(model => model.id), ['same-id'], 'manual models still work when discovery fails');
  assert.equal((await ai.researchModelContextWindow({ provider: 'custom', model: 'same-id' })).tokens, 8192, 'best-effort discovery failure preserves a known smaller window');
  await refused({ provider: 'custom', model: 'same-id' }, 10_000);
  customCatalogueFails = false;
  console.log('OpenRouter and custom gateways: route caps, metadata variants and endpoint isolation passed.');

  settings.updateSettings({ localProviders: { lmstudio: { baseUrl: base } } });
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'lmstudio', model: 'gpt-6.1-sol' }), { tokens: 4096, known: true });
  await refused({ provider: 'lmstudio', model: 'gpt-6.1-sol' }, 4500);
  const copilot = load('electron/ai/githubCopilotSubscription.ts');
  const copilotModels = await copilot.listGitHubCopilotSubscriptionModels();
  assert.equal(copilotModels[0].contextLength, 262_144);
  assert.deepEqual(await ai.researchModelContextWindow({ provider: 'github-copilot', model: 'runtime-only' }), { tokens: 262_144, known: true });
  now += 300_001;
  assert.equal((await ai.researchModelContextWindow({ provider: 'github-copilot', model: 'runtime-only' })).tokens, 262_144);
  copilotWindow = 8192;
  now += 600_001;
  load('electron/ai/githubCopilotCompletion.ts').runIsolatedGitHubCopilotCompletion = async () => ({ text: 'Answer' });
  assert.equal(await copilot.completeWithGitHubCopilotSubscription({ model: 'runtime-only', system: 'Summarize', user: 'hello', maxTokens: 1024 }), 'Answer');
  assert.equal((await ai.researchModelContextWindow({ provider: 'github-copilot', model: 'runtime-only' })).tokens, 8192, 'an internal runtime catalogue refresh also updates the guard');
  await refused({ provider: 'github-copilot', model: 'runtime-only' }, 10_000);
  await copilot.stopGitHubCopilotSubscription();
  console.log('Local allocations retain priority; Copilot SDK metadata reaches the same cache and guards without using API-model guesses.');
} finally {
  await load('electron/ai/githubCopilotSubscription.ts').stopGitHubCopilotSubscription();
  load('electron/db/database.ts').closeDb();
  Module._load = originalLoad;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalAnthropicBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = originalAnthropicBase;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}
