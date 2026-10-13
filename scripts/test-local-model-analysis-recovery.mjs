// What happens when the model runs on the user's own laptop and is slow.
//
// A cloud provider that has said nothing for three minutes is stuck. A local model that
// has been generating for three minutes is working: idea extraction asks for up to 16.000
// JSON tokens per chunk, and at the 15-40 tokens/s a quantized model reaches on an
// M-series that is 400-1.067 seconds of perfectly healthy generation. Under one shared
// 180s transport ceiling the deep pass died on every long work, which is why local users
// could produce Themes (one call, 1.500 tokens) and never Ideas — and the whole pass died
// with the first slow chunk, because a timeout was not something the adaptive retry knew
// how to answer.
//
// Drives the real aiClient against a fake OpenAI-compatible server (lmstudio's base URL
// is settings-driven), then pins the policies the transport alone cannot show.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-local-model-recovery-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-local-model-analysis-recovery.mjs'), '--electron-local-model-recovery-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-model-recovery-'));
installRuntimeHooks(root);

/** Replies for /v1/chat/completions, consumed in order. A `{ status, body }` entry
 *  models a provider-side failure instead of a completion. */
let queue = [];
let seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    seen.push({ url: req.url, body: JSON.parse(body || '{}') });
    const next = queue.shift() ?? '{}';
    if (typeof next === 'object' && next.status) {
      res.writeHead(next.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.body));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: next }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });

  // --- 1. The transport budget follows where the model runs -------------------
  //
  // Nothing is billed by the second on the user's own machine and the deep scan ticks a
  // heartbeat while it waits, so a local model gets room to finish. It stays finite: a
  // wedged local server must not hold the scan queue open forever.
  const cloudBudget = aiClient.completionTimeoutMs({ provider: 'openai', model: 'gpt-4o' });
  assert.equal(cloudBudget, 180_000, 'cloud providers keep the three-minute ceiling');
  for (const provider of ['gemini', 'anthropic', 'openrouter', 'deepseek', 'groq']) {
    assert.equal(aiClient.completionTimeoutMs({ provider, model: 'x' }), cloudBudget,
      `${provider} runs on the provider's hardware and keeps the cloud ceiling`);
  }
  for (const provider of ['lmstudio', 'ollama', 'nodus']) {
    const budget = aiClient.completionTimeoutMs({ provider, model: 'x' });
    assert.ok(budget > cloudBudget, `${provider} runs on this machine and must get more room than the cloud`);
    // 16.000 output tokens at a pessimistic 15 tokens/s is ~1.067s; the budget has to clear
    // that with margin or the fix does not reach the case it was written for.
    assert.ok(budget >= 1_200_000, `${provider} must clear a full extraction chunk on slow hardware, got ${budget}ms`);
  }

  // A custom endpoint is the one provider whose locality is not in its id, so it is read off
  // the address the user typed. These are the setups the provider exists for — a bare
  // llama.cpp, vLLM or LiteLLM server on the same laptop or the same desk — and they used to
  // be held to the cloud ceiling with no setting able to say otherwise (issue #802).
  for (const url of ['http://127.0.0.1:8080/v1', 'http://localhost:1234/v1', 'http://192.168.1.20:8000/v1', 'http://gpu.lan:5000']) {
    settingsRepo.updateSettings({ customProvider: { baseUrl: url, models: ['local-model'] } });
    const budget = aiClient.completionTimeoutMs({ provider: 'custom', model: 'local-model' });
    assert.ok(budget > cloudBudget, `a custom endpoint at ${url} serves the user's own hardware, got ${budget}ms`);
    assert.ok(budget >= 1_200_000, `and must clear a full extraction chunk, got ${budget}ms`);
  }
  // A gateway on the internet keeps the three-minute ceiling: nothing on the user's desk is
  // doing the work, so silence means a stuck request rather than a slow one.
  for (const url of ['https://gateway.example.com/v1', 'http://203.0.113.7:8080/v1']) {
    settingsRepo.updateSettings({ customProvider: { baseUrl: url, models: ['remote-model'] } });
    assert.equal(
      aiClient.completionTimeoutMs({ provider: 'custom', model: 'remote-model' }),
      cloudBudget,
      `a custom endpoint at ${url} is reached over the internet and keeps the cloud ceiling`,
    );
  }
  // No endpoint configured is no evidence of a local one.
  settingsRepo.updateSettings({ customProvider: { baseUrl: '', models: [] } });
  assert.equal(aiClient.completionTimeoutMs({ provider: 'custom', model: 'x' }), cloudBudget);

  // --- 1b. Size silence from the native body, including Research and model defaults ---
  const openai = { provider: 'openai', model: 'gpt-6.1-sol' };
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(aiClient.streamIdleTimeoutMs(openai, { reasoning_effort: effort }), 900_000);
  }
  assert.equal(aiClient.streamIdleTimeoutMs(openai), 900_000, 'a reasoning model thinks by default');
  assert.equal(aiClient.streamIdleTimeoutMs({ provider: 'openai', model: 'gpt-4o' }), cloudBudget);
  assert.equal(aiClient.streamIdleTimeoutMs({ provider: 'openai', model: 'gpt-4o' }, { reasoning_effort: 'high' }), cloudBudget, 'a global effort does not make a non-reasoning model think');
  assert.equal(aiClient.streamIdleTimeoutMs({ provider: 'openai', model: 'new-model' }, {}, { reasoningMandatory: true }), 900_000, 'native metadata identifies mandatory thinking without guessing a model name');
  assert.equal(aiClient.streamIdleTimeoutMs({ provider: 'openai', model: 'gpt-unknown' }), cloudBudget);
  for (const model of ['gpt-5.1', 'gpt-5.4-mini']) {
    const ref = { provider: 'openai', model };
    assert.equal(aiClient.streamIdleTimeoutMs(ref), cloudBudget, 'optional reasoning may default to none');
    assert.equal(aiClient.streamIdleTimeoutMs(ref, { reasoning_effort: 'high' }), 900_000);
    assert.equal(aiClient.streamIdleTimeoutMs(ref, {}, { defaultReasoningEffort: 'medium' }), 900_000, 'published defaults take precedence');
    assert.equal(aiClient.streamIdleTimeoutMs(ref, {}, { defaultReasoningEffort: 'none' }), cloudBudget);
  }
  assert.equal(aiClient.streamIdleTimeoutMs({ provider: 'openai', model: 'gpt-5.6' }, { reasoning_effort: 'none' }), cloudBudget);
  for (const provider of ['deepseek', 'anthropic', 'gemini', 'openrouter', 'groq']) {
    assert.equal(aiClient.streamIdleTimeoutMs({ provider, model: 'x' }, { reasoning_effort: 'high' }), cloudBudget);
  }
  for (const provider of ['lmstudio', 'ollama', 'nodus']) {
    assert.equal(aiClient.streamIdleTimeoutMs({ provider, model: 'x' }), aiClient.completionTimeoutMs({ provider, model: 'x' }));
  }

  // Exercise generationOptions -> completeTextStream -> the SDK constructor and request body.
  // No provider request leaves this test; only the SDK is replaced, not the transport policy.
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const originalListModels = providers.listModels;
  const sdkCalls = [];
  globalThis.__streamSdk = class {
    constructor(options) {
      this.chat = { completions: { create: (body) => ({ withResponse: async () => {
        sdkCalls.push({ options, body });
        return { response: { headers: new Headers() }, data: (async function* () {
          yield { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] };
        })() };
      } }) } };
    }
  };
  providers.listModels = async () => [{ id: openai.model, researchReasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'], reasoningMandatory: true }];
  require(path.join(repoRoot, 'electron/secrets/secretStore.ts')).setApiKey('openai', 'test-only');
  try {
    const { researchGenerationOptions } = require(path.join(repoRoot, 'electron/ai/researchGenerationOptions.ts'));
    const opts = await researchGenerationOptions({ model: openai, thinkingEffort: 'high' }, 64, false);
    assert.equal(opts.reasoning, 'off', 'Research uses its own native effort');
    assert.equal(await aiClient.completeTextStream({ system: 's', user: 'u', ...opts }, () => {}, openai), 'answer');
    assert.equal(sdkCalls.at(-1).body.reasoning_effort, 'high');
    assert.equal(sdkCalls.at(-1).options.timeout, 900_000);
    await aiClient.completeTextStream({ system: 's', user: 'u', ...opts, timeoutMs: 321 }, () => {}, openai);
    assert.equal(sdkCalls.at(-1).options.timeout, 321, 'an explicit deadline wins');
    await aiClient.completeTextStream({ system: 's', user: 'u', reasoning: 'off' }, () => {}, openai);
    assert.equal(sdkCalls.at(-1).options.timeout, 900_000, 'omitting effort leaves model-default reasoning on');
    await aiClient.completeTextStream({ system: 's', user: 'u', reasoning: 'off', researchEffort: 'none' }, () => {}, { provider: 'openai', model: 'gpt-5.6' });
    assert.equal(sdkCalls.at(-1).body.reasoning_effort, 'none');
    assert.equal(sdkCalls.at(-1).options.timeout, cloudBudget, 'a real opt-out keeps the tight deadline');
    await aiClient.completeTextStream({ system: 's', user: 'u', reasoning: 'off' }, () => {}, { provider: 'openai', model: 'gpt-4o' });
    assert.equal(sdkCalls.at(-1).options.timeout, cloudBudget);
    await aiClient.completeTextStream({ system: 's', user: 'u', reasoning: 'high' }, () => {}, { provider: 'openai', model: 'gpt-4o' });
    assert.equal(sdkCalls.at(-1).options.timeout, cloudBudget, 'unsupported global hints cannot widen the SDK deadline');
    await aiClient.completeTextStream({ system: 's', user: 'u', reasoning: 'off' }, () => {}, { provider: 'openai', model: 'gpt-5.4-mini' });
    assert.equal(sdkCalls.at(-1).options.timeout, cloudBudget, 'an optional model default does not acquire 15 minutes of silence');
  } finally {
    delete globalThis.__streamSdk;
    providers.listModels = originalListModels;
  }

  // --- 2. A timeout is tagged, not merely worded ------------------------------
  //
  // The deep scan answers a timeout by splitting the chunk, which it must not do for an
  // unrelated failure, so the classification has to survive as a code and not as prose
  // that a translation or a reword could silently change the meaning of.
  queue = [{ status: 400, body: { error: { message: 'request timed out' } } }];
  seen = [];
  await assert.rejects(
    () => aiClient.completeText({ system: 's', user: 'u', maxTokens: 64 }, { provider: 'lmstudio', model: 'slow-local' }),
    (error) => {
      assert.equal(error.code, 'timeout', 'the deep scan splits on this code');
      assert.match(error.message, /Tiempo agotado/, 'and the reader still gets the sentence');
      assert.equal(error.config, false, 'a slow model is not a misconfiguration: the queue must not pause');
      return true;
    },
  );
  assert.ok(seen.length >= 1, 'the request actually reached the wire');

  // --- 3. Both completion transports use the same budget and full-body deadline
  const client = read('electron/ai/aiClient.ts');
  assert.match(client, /const timeoutMs = opts\.timeoutMs \?\? completionTimeoutMs\(model\)/,
    'buffered leased Nodus-local clients size their timeout by provider');
  // A stream is sized by streamIdleTimeoutMs, not completionTimeoutMs: same provider rule, plus
  // the allowance for a provider that sends nothing while it reasons (section 1b). Pinned to the
  // source because the distinction is invisible at runtime until a model thinks for 3 minutes.
  assert.match(client, /const streamTimeoutMs = opts\.timeoutMs \?\? streamIdleTimeoutMs\(model, body, opts\.researchModelInfo\)/,
    'streaming clients size their timeout by provider AND by whether the reasoning is streamed');
  assert.ok((client.match(/withTransportDeadline\(/g) ?? []).length >= 2,
    'buffered OpenAI-compatible clients keep the deadline until the complete body settles');
  // The stream keeps a deadline over the complete body too, measured as idle time (a reasoning
  // model streams for minutes before answering) with a total ceiling.
  assert.match(client, /return withIdleTransportDeadline\(\s*streamTimeoutMs,\s*Math\.max\(streamTimeoutMs, STREAM_TOTAL_MS\)/,
    'the streaming OpenAI-compatible client keeps an idle deadline and a total ceiling until the body settles');
  assert.doesNotMatch(client, /timeout: opts\.timeoutMs \?\? 180_000/, 'no hard-coded ceiling survives');
  assert.match(client, /'Tiempo agotado esperando al proveedor de IA[^']*',\s*false,\s*false,\s*'timeout'/,
    'the timeout error carries its code');

  // --- 4. The deep scan answers a timeout by splitting, never by expanding -----
  const deepScan = read('electron/ai/deepScan.ts');
  assert.match(deepScan, /const timedOut = aiError\?\.code === 'timeout'/, 'the deep scan recognises a timeout');
  assert.match(deepScan, /const maxDepth = timedOut \? 1 : 4/,
    'a timeout gets one split, not four: each failed attempt costs the full local budget');
  assert.match(deepScan, /if \(!timedOut && aiError\?\.code !== 'context_overflow' && depth === 0 && maxTokens < 16000\)/,
    'raising the output ceiling answers truncation only — after a timeout it just buys more rope');
  assert.match(deepScan, /\(!recoverableJson && !timedOut\) \|\| depth >= maxDepth/,
    'a timed-out chunk is recoverable, where it used to kill the whole deep pass');

  console.log('Local-model analysis recovery verified.');
} finally {
  try { closeDb(); } catch { /* database may not have opened */ }
  server.close();
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === 'openai' && globalThis.__streamSdk) return globalThis.__streamSdk;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
