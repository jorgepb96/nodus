// The "Custom (OpenAI-compatible)" provider: the user's own gateway (LiteLLM, vLLM,
// llama.cpp server, a proxy) instead of a vendor API.
//
// Drives the REAL electron/ai/providers.ts against a fake OpenAI-compatible server,
// with only the settings repository stubbed. Three properties matter and none of
// them is obvious:
//
//  1. The base URL is used verbatim. Every other provider in Nodus appends "/v1";
//     these gateways mount the API wherever they like, so appending anything would
//     break as many installs as it fixed.
//  2. The model list is the UNION of what the user typed and what the endpoint
//     reports — the manual half exists precisely for endpoints that report nothing.
//  3. An endpoint without GET /models must not break model selection. That is the
//     normal shape of several proxies, not an error state, so a throw there would
//     empty every model picker in the app for a setup that works fine.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-provider-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

// The settings stub reads a mutable global so each test can reconfigure the
// provider the way Settings would, without rebuilding the bundle.
const settingsStub = path.join(tmp, 'settings-stub.mjs');
await writeFile(settingsStub, 'export function getSettings() { return globalThis.__NODUS_SETTINGS__ ?? {}; }\n');
const localAiStub = path.join(tmp, 'nodusLocalAi-stub.mjs');
await writeFile(localAiStub, 'export async function listNodusLocalChatModels() { return []; }\nexport async function listNodusLocalEmbeddingModels() { return []; }\n');

const outfile = path.join(tmp, 'providers.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/providers.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  plugins: [{
    name: 'stub-deps',
    setup(b) {
      b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: settingsStub }));
      b.onResolve({ filter: /nodusLocalAi$/ }, () => ({ path: localAiStub }));
    },
  }],
});
const {
  customBaseUrl,
  customManualModels,
  listModels,
  normalizeCustomBaseUrl,
  normalizeCustomModels,
  normalizeCustomProviderConfig,
  openAiCompatBase,
  reasoningBody,
  looksLikeReasoningModelId,
  supportsJsonMode,
  testCustomProvider,
} = await import(pathToFileURL(outfile).href);

/** Configure the provider the way Settings → Providers would. */
function configure(baseUrl, models = []) {
  globalThis.__NODUS_SETTINGS__ = { customProvider: { baseUrl, models } };
}

/** A gateway. `catalogue: null` models the very common proxy with no GET /models. */
async function fakeGateway({ catalogue }) {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url, auth: request.headers.authorization ?? null });
    if (!request.url.endsWith('/models') || catalogue === null) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: catalogue.map((model) => typeof model === 'string' ? { id: model } : model) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('the base URL is taken verbatim: only the trailing slash is normalised', () => {
  assert.equal(normalizeCustomBaseUrl('  http://localhost:8317/v1  '), 'http://localhost:8317/v1');
  assert.equal(normalizeCustomBaseUrl('http://localhost:8317/v1///'), 'http://localhost:8317/v1');
  // The path is the user's business: a gateway mounted at the root stays at the root,
  // and one under /openai/v1 keeps that prefix. Nodus must never append "/v1".
  assert.equal(normalizeCustomBaseUrl('http://gateway.lan:4000/'), 'http://gateway.lan:4000');
  assert.equal(normalizeCustomBaseUrl('https://proxy.example.com/openai/v1'), 'https://proxy.example.com/openai/v1');
  assert.equal(normalizeCustomBaseUrl(''), '');
  assert.equal(normalizeCustomBaseUrl(undefined), '');

  configure('http://localhost:8317/v1/');
  assert.equal(customBaseUrl(), 'http://localhost:8317/v1');
  assert.equal(openAiCompatBase('custom'), 'http://localhost:8317/v1', 'inference uses the configured base as-is');

  // Unconfigured must be null, NOT undefined: `new OpenAI({ baseURL: undefined })`
  // silently talks to api.openai.com, which is a provider the user never chose.
  configure('');
  assert.equal(openAiCompatBase('custom'), null);
  assert.equal(supportsJsonMode('custom'), true, 'JSON mode is part of the contract it claims to implement');
});

test('manual model slugs are trimmed, de-duplicated and keep their order', () => {
  assert.deepEqual(normalizeCustomModels(['  gemini-3.1-flash ', 'qwen3', 'gemini-3.1-flash', '', '   ']),
    ['gemini-3.1-flash', 'qwen3']);
  assert.deepEqual(normalizeCustomModels(undefined), []);
  assert.deepEqual(
    normalizeCustomProviderConfig({ baseUrl: 'http://x:1/v1/', models: ['a', 'a', ' b '] }),
    { baseUrl: 'http://x:1/v1', models: ['a', 'b'] },
  );
  assert.deepEqual(normalizeCustomProviderConfig(undefined), { baseUrl: '', models: [] });
});

test('listModels returns the union of the manual list and the endpoint catalogue', async () => {
  const gateway = await fakeGateway({ catalogue: ['served-a', 'served-b', 'typed-first'] });
  try {
    configure(`${gateway.origin}/v1`, ['typed-first', 'typed-only']);
    const models = await listModels('custom', null);
    assert.deepEqual(models.map((m) => m.id), ['typed-first', 'typed-only', 'served-a', 'served-b'],
      'manual slugs come first and win on collision; the remote half follows');
    assert.equal(gateway.seen.at(-1).url, '/v1/models', 'the catalogue is read from {baseUrl}/models');
    assert.equal(gateway.seen.at(-1).auth, null, 'no key configured means no Authorization header');

    const result = await testCustomProvider(null);
    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 4, 'the reported count is the union, not just the catalogue');
  } finally {
    await gateway.close();
  }
});

test('an endpoint without GET /models still selects models and says why', async () => {
  const gateway = await fakeGateway({ catalogue: null });
  try {
    configure(`${gateway.origin}/v1`, ['gemini-3.1-flash', 'qwen3-max']);
    // The whole point: a 404 catalogue is a normal proxy, not a broken provider.
    const models = await listModels('custom', null);
    assert.deepEqual(models.map((m) => m.id), ['gemini-3.1-flash', 'qwen3-max'],
      'model selection survives an endpoint with no catalogue');

    const result = await testCustomProvider(null);
    assert.equal(result.ok, false, 'the test reports the catalogue failure honestly');
    assert.match(result.message, /404/);
    assert.match(result.message, /2 modelos escritos a mano/, 'and says the manual list still works');
  } finally {
    await gateway.close();
  }
});

test('an unreachable or unconfigured endpoint never throws out of listModels', async () => {
  // Nothing is listening here; the manual list must still reach the pickers.
  configure('http://127.0.0.1:1/v1', ['typed-anyway']);
  assert.deepEqual((await listModels('custom', null)).map((m) => m.id), ['typed-anyway']);

  configure('', ['typed-anyway']);
  assert.deepEqual(customManualModels(), ['typed-anyway']);
  assert.deepEqual((await listModels('custom', null)).map((m) => m.id), ['typed-anyway'],
    'with no URL at all the manual list is the whole catalogue');
  assert.deepEqual(await testCustomProvider(null), { ok: false, message: 'Falta la dirección del servidor.' });

  configure('', []);
  assert.deepEqual(await listModels('custom', null), []);
});

test('a configured key travels as a bearer token', async () => {
  const gateway = await fakeGateway({ catalogue: ['served'] });
  try {
    configure(`${gateway.origin}/v1`, []);
    await listModels('custom', 'secret-token');
    assert.equal(gateway.seen.at(-1).auth, 'Bearer secret-token');
  } finally {
    await gateway.close();
  }
});

test('the endpoint is stored app-level, normalised on write, and shared by every vault', async () => {
  // Requires the real settings repository (SQLite + app-prefs.json), so it runs in
  // an Electron child the way test-model-prefs-recovery does. Two things are being
  // pinned: that what gets STORED is already normalised — Settings renders the
  // stored value straight back, and a trailing slash the user pasted should not
  // survive to be shown to them — and that the gateway is app-level, so configuring
  // it once does not have to be repeated in every vault.
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-persist-'));
  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-custom-userdata-'));
  try {
    const entry = path.join(workspace, 'entry.ts');
    const bundle = path.join(workspace, 'entry.cjs');
    await writeFile(entry, [
      `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
      `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
    ].join('\n'));
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      entry, '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
      `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`, '--external:better-sqlite3',
    ], { cwd: repoRoot, stdio: 'inherit' });

    const child = path.join(workspace, 'child.cjs');
    const resultFile = path.join(workspace, 'result.json');
    await writeFile(child, `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const Module = require('node:module');
      process.env.NODE_PATH = ${JSON.stringify(path.join(repoRoot, 'node_modules'))};
      Module._initPaths();
      const { registry, settingsRepo } = require(${JSON.stringify(bundle)});
      settingsRepo.updateSettings({ customProvider: { baseUrl: '  http://gateway.lan:4000/openai/v1//  ', models: [' a ', 'a', '', 'b'] } });
      const stored = settingsRepo.getSettings().customProvider;
      const prefs = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(userData)}, 'app-prefs.json'), 'utf8'));
      registry.createVault('Second vault');
      const inSecondVault = settingsRepo.getSettings().customProvider;
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ stored, inPrefsFile: prefs.customProvider, inSecondVault }));
    `);
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [child], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
      stdio: 'inherit',
    });

    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    const expected = { baseUrl: 'http://gateway.lan:4000/openai/v1', models: ['a', 'b'] };
    assert.deepEqual(result.stored, expected, 'the stored value is already normalised');
    assert.deepEqual(result.inPrefsFile, expected, 'it lands in app-prefs.json, not only in the vault');
    assert.deepEqual(result.inSecondVault, expected, 'a newly created vault inherits the same gateway');
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

// Reasoning control for a custom gateway. The reporter of the Document Understanding
// failures ran a `:thinking` model through one: Nodus sent no reasoning field, so the
// private trace consumed the whole output budget and the long non-streaming generation
// is what the gateway dropped as "Connection error.".
//
// The field is added for BACKGROUND SCANS of a model whose id announces the mode, and
// nowhere else: a custom gateway that refuses it is recovered by the transport, but a
// conversational turn that is refused has already lost its answer.
test('a custom background scan asks a thinking model not to think', () => {
  assert.deepEqual(
    reasoningBody('custom', 'off', 'DeepSeek V4.1 Flash:thinking', true),
    { reasoning_effort: 'none' },
  );
  assert.deepEqual(reasoningBody('custom', 'off', 'some-model-reasoning', true), { reasoning_effort: 'none' });
});

test('only an id that announces the mode is asked; a merely capable family is left alone', () => {
  // qwen3, gpt-oss and the o-series can reason but do not advertise it in the id, so
  // they keep their default request shape rather than risk a rejected field.
  assert.deepEqual(reasoningBody('custom', 'off', 'qwen3-max', true), {});
  assert.deepEqual(reasoningBody('custom', 'off', 'gpt-oss-20b', true), {});
  assert.deepEqual(reasoningBody('custom', 'off', 'deepseek-r1', true), {});
  assert.deepEqual(reasoningBody('custom', 'off', 'gpt-4o', true), {});
  assert.deepEqual(reasoningBody('custom', 'off', undefined, true), {});
});

test('a custom conversational turn never carries a reasoning field', () => {
  assert.deepEqual(reasoningBody('custom', 'off', 'DeepSeek V4.1 Flash:thinking', false), {});
  assert.deepEqual(reasoningBody('custom', 'medium', 'any-model', false), {});
});

test('a custom explicit effort is forwarded on a background scan', () => {
  assert.deepEqual(reasoningBody('custom', 'high', 'any-model', true), { reasoning_effort: 'high' });
});

test('the reasoning-model heuristic only matches ids that announce it', () => {
  assert.equal(looksLikeReasoningModelId('DeepSeek V4.1 Flash:thinking'), true);
  assert.equal(looksLikeReasoningModelId('acme-reasoning-v2'), true);
  assert.equal(looksLikeReasoningModelId('deepseek-r1'), false);
  assert.equal(looksLikeReasoningModelId('Qwen/QwQ-32B'), false);
  assert.equal(looksLikeReasoningModelId('gpt-oss-20b'), false);
  assert.equal(looksLikeReasoningModelId('gpt-4o'), false);
  assert.equal(looksLikeReasoningModelId(''), false);
  assert.equal(looksLikeReasoningModelId(undefined), false);
});


test('model catalogue preserves advertised native efforts without manufacturing a ladder', async () => {
  const gateway = await fakeGateway({ catalogue: [
    { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
    { id: 'unknown', effort: { supported_levels: ['high', 'low', 'high', 'standard', 'turbo'] } },
    { id: 'gpt-5.4', capabilities: { reasoning: true } },
    { id: 'malformed', effort: { supported_levels: 'low' } },
  ] });
  try {
    configure(`${gateway.origin}/v1`, ['deepseek-flash']);
    const models = await listModels('custom', null);
    assert.deepEqual(models.find(m => m.id === 'deepseek-flash').researchReasoningLevels, ['low', 'high', 'max']);
    assert.deepEqual(models.find(m => m.id === 'unknown').researchReasoningLevels, ['high', 'low']);
    assert.deepEqual(models.find(m => m.id === 'gpt-5.4').researchReasoningLevels, []);
    assert.deepEqual(models.find(m => m.id === 'malformed').researchReasoningLevels, []);
  } finally { await gateway.close(); }
});


test('DeepSeek, Anthropic and OpenRouter read their native effort metadata', async () => {
  const original = globalThis.fetch;
  const fixtures = {
    deepseek: [
      { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'] } },
      { id: 'deepseek-pro' },
    ],
    anthropic: [
      { id: 'claude-opus-4-7', capabilities: { effort: { supported: true, max: { supported: true }, xhigh: { supported: false }, medium: { supported: true }, low: { supported: true } } } },
      { id: 'claude-unknown', capabilities: { effort: { supported: false, high: { supported: true } } } },
    ],
    openrouter: [
      { id: 'deepseek/deepseek-v4-flash', reasoning: { supported_efforts: ['xhigh', 'high'] } },
      { id: 'openai/gpt-5.4', supported_parameters: ['reasoning'] },
    ],
  };
  globalThis.fetch = async url => Response.json({ data: fixtures[Object.keys(fixtures).find(provider => String(url).includes(provider))] });
  try {
    // DeepSeek's own catalogue gets an Off stop (thinking.type disabled) ahead of its published
    // levels; a model that publishes none gets no slider, and custom endpoints are untouched.
    assert.deepEqual((await listModels('deepseek', 'fixture')).map(m => m.researchReasoningLevels), [['none', 'low', 'high', 'max'], []]);
    const anthropic = await listModels('anthropic', 'fixture');
    assert.deepEqual(anthropic.find(m => m.id === 'claude-opus-4-7').researchReasoningLevels, ['low', 'medium', 'max']);
    assert.deepEqual(anthropic.find(m => m.id === 'claude-unknown').researchReasoningLevels, []);
    const router = await listModels('openrouter', null);
    assert.deepEqual(router.find(m => m.id === 'deepseek/deepseek-v4-flash').researchReasoningLevels, ['high', 'xhigh']);
    assert.deepEqual(router.find(m => m.id === 'openai/gpt-5.4').researchReasoningLevels, []);
  } finally { globalThis.fetch = original; }
});
