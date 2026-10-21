// Exercise real provider loaders, the catalogue service, and the rendered Settings UI.
// Only credentials, installed-model storage, and the subscription transport are simulated.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-catalog-'));
await symlink(path.join(repo, 'node_modules'), path.join(tmp, 'node_modules'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const outfile = path.join(tmp, 'catalog.cjs');
await build({
  stdin: { contents: `export * from ${JSON.stringify(path.join(repo, 'electron/ai/modelCatalog.ts'))};
    export * from ${JSON.stringify(path.join(repo, 'electron/ai/providers.ts'))};
    export * from ${JSON.stringify(path.join(repo, 'shared/staleModels.ts'))};
    export { setCatalogTestRuntime } from ${JSON.stringify(path.join(repo, 'electron/ai/codexSubscription.ts'))};`, resolveDir: repo, loader: 'ts' },
  outfile, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent',
  alias: { '@shared': path.join(repo, 'shared') },
  plugins: [{ name: 'fixture-boundaries', setup(b) {
    b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: 'settings', namespace: 'fixture' }));
    b.onResolve({ filter: /secrets\/secretStore$/ }, () => ({ path: 'keys', namespace: 'fixture' }));
    b.onResolve({ filter: /nodusLocalAi$/ }, () => ({ path: 'local', namespace: 'fixture' }));
    b.onResolve({ filter: /githubCopilotSubscription$/ }, () => ({ path: 'copilot', namespace: 'fixture' }));
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'js', contents: {
      settings: 'export const getSettings = () => globalThis.__catalogFixture.settings;',
      keys: 'export const getApiKey = provider => globalThis.__catalogFixture.keys[provider] ?? null;',
      local: 'export const listNodusLocalChatModels = () => [{id:"local-chat",kind:"llm"}]; export const listNodusLocalEmbeddingModels = () => [{id:"local-embedding",kind:"embeddings"}];',
      copilot: 'export const listGitHubCopilotSubscriptionModels = async () => {if(globalThis.__catalogFixture.copilotError) throw Error("offline"); return [{id:"copilot-model"}];};',
      electron: `export const app = {getPath: () => ${JSON.stringify(tmp)}, getVersion: () => 'test'}; export const net = {fetch: (...args) => globalThis.fetch(...args)};`,
    }[name] }));
    // Inject the transport without replacing any of the catalogue/auth/filter logic.
    b.onLoad({ filter: /codexSubscription\.ts$/ }, async ({ path: file }) => ({
      contents: await readFile(file, 'utf8') + '\nexport function setCatalogTestRuntime(runtime) { client = runtime; modelCatalog = new Map(); }',
      loader: 'ts', resolveDir: path.dirname(file),
    }));
  }}],
});
const catalog = require(outfile);
globalThis.__catalogFixture = { settings: {}, keys: {} };
const read = (ids, selectable = ids) => ({ status: 'read', models: ids.map(id => ({ id })), selectableModels: selectable.map(id => ({ id })) });
const unreadable = { status: 'unreadable' };
const favorite = (provider, model) => ({ provider, model });
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.__catalogFixture; });

async function withPayload(payload, action, status = 200) {
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  try { await action(); } finally { globalThis.fetch = originalFetch; }
}

function codexRuntime({ connected = true } = {}) {
  const calls = [];
  catalog.setCatalogTestRuntime({ request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'account/read') return { account: connected ? { type: 'chatgpt', email: null, planType: 'test' } : null };
    if (method === 'account/rateLimits/read') return { rateLimits: null, rateLimitsByLimitId: null };
    if (method === 'model/list') {
      assert.equal(params.includeHidden, true);
      return params.cursor ? { data: [{ id: 'saved-hidden', hidden: true }], nextCursor: null }
        : { data: [{ id: 'visible', hidden: false, isDefault: true }], nextCursor: 'page-2' };
    }
    throw new Error(`Unexpected method ${method}`);
  } });
  return calls;
}

const uiFile = path.join(tmp, 'ui.cjs');
await build({ stdin: { contents: `export { setActiveLang, t } from ${JSON.stringify(path.join(repo, 'src/i18n.ts'))};
  export { FavoriteModelAvailability } from ${JSON.stringify(path.join(repo, 'src/components/FavoriteModelAvailability.tsx'))};
  export { ProvidersSettings } from ${JSON.stringify(path.join(repo, 'src/views/ProvidersSettings.tsx'))};`, resolveDir: repo, loader: 'tsx' }, outfile: uiFile,
  bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent', tsconfig: path.join(repo, 'tsconfig.json'),
  external: ['react', 'react/jsx-runtime'],
});
const { FavoriteModelAvailability, ProvidersSettings } = require(uiFile);
const React = require('react');
const act = React.act ?? require('react-dom/test-utils').act;

test('model setup instructions and authentication errors are translated in every interface language', () => {
  const { setActiveLang, t } = require(uiFile);
  const messages = ['Introduce una clave de API antes de cargar los modelos.', 'El proveedor rechazó la clave o sus permisos (HTTP {status}).'];
  try {
    for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
      setActiveLang(language);
      for (const message of messages) assert.notEqual(t(message), message, `${language}: ${message}`);
      assert.match(t(messages[1]), /\{status\}/, language);
    }
  } finally { setActiveLang('es'); }
});

test('reasoning catalogues preserve mandatory controls and filter impossible off levels', async () => {
  globalThis.__catalogFixture.settings = { customProvider: { baseUrl: 'https://fixture.invalid/v1', models: [] } };
  for (const provider of ['openrouter', 'custom']) {
    await withPayload({ data: [
      { id: 'vendor/mandatory', reasoning: { mandatory: true, supported_efforts: ['high', 'medium', 'none'] }, supported_parameters: ['reasoning'] },
      { id: 'vendor/optional', reasoning: { mandatory: false, supported_efforts: ['high', 'low', 'none'] }, supported_parameters: ['reasoning'] },
    ] }, async () => {
      const models = await catalog.listModels(provider, null);
      const mandatory = models.find(model => model.id === 'vendor/mandatory');
      const optional = models.find(model => model.id === 'vendor/optional');
      assert.equal(mandatory.reasoningMandatory, true);
      assert.deepEqual(new Set(mandatory.researchReasoningLevels), new Set(['high', 'medium']));
      assert.equal(optional.reasoningMandatory, false);
      assert.deepEqual(new Set(optional.researchReasoningLevels), new Set(['high', 'low', 'none']));
    });
  }
});


test('custom catalogue failure stays inconclusive even though inference and manual selection work', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') { response.writeHead(404); response.end('{"error":"no catalogue"}'); }
    else response.end('{"choices":[{"message":{"content":"working alias"}}]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  globalThis.__catalogFixture.settings = { customProvider: { baseUrl, models: ['manual-alias'] } };
  try {
    const result = await catalog.getModelCatalog('custom');
    assert.deepEqual(result, unreadable);
    assert.deepEqual(catalog.staleFavorites([favorite('custom', 'previously-listed')], new Map([['custom', result]])), []);
    assert.deepEqual((await catalog.listModels('custom', null)).map(model => model.id), ['manual-alias']);
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'previously-listed' }) });
    assert.equal((await response.json()).choices[0].message.content, 'working alias');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('custom offline, missing URL, rejected key and server errors never count as read catalogues', async () => {
  for (const baseUrl of ['', 'http://127.0.0.1:1/v1']) {
    globalThis.__catalogFixture.settings = { customProvider: { baseUrl, models: ['manual-alias'] } };
    assert.deepEqual(await catalog.getModelCatalog('custom'), unreadable);
    assert.deepEqual((await catalog.listModels('custom', null)).map(model => model.id), ['manual-alias']);
  }
  globalThis.__catalogFixture.settings = { customProvider: { baseUrl: 'https://fixture.invalid/v1', models: ['manual-alias'] } };
  for (const status of [401, 403, 404, 500]) await withPayload({ error: 'fixture' }, async () => {
    assert.deepEqual(await catalog.getModelCatalog('custom'), unreadable);
    assert.deepEqual((await catalog.listModels('custom', null)).map(model => model.id), ['manual-alias']);
  }, status);
});

test('successful custom listing separates remote evidence from manually configured aliases', async () => {
  globalThis.__catalogFixture.settings = { customProvider: { baseUrl: 'https://fixture.invalid/v1', models: ['manual-alias'] } };
  await withPayload({ data: [{ id: 'remote-model' }] }, async () => {
    const result = await catalog.getModelCatalog('custom');
    assert.equal(result.status, 'read');
    assert.deepEqual(result.models.map(model => model.id), ['remote-model']);
    assert.deepEqual(result.selectableModels.map(model => model.id), ['manual-alias', 'remote-model']);
  });
});

test('valid empty catalogue is distinct from malformed or paginated responses', async () => {
  await withPayload({ data: [] }, async () => assert.equal((await catalog.getModelCatalog('custom')).status, 'read'));
  for (const payload of [{}, { data: null }, { data: {} }, { data: [{}] }, { data: [], has_more: true }, { data: [], next_cursor: 'next' }]) {
    await withPayload(payload, async () => assert.deepEqual(await catalog.getModelCatalog('custom'), unreadable));
  }
});

test('each network provider rejects missing catalogue data instead of treating it as an empty list', async () => {
  const providers = ['openai', 'anthropic', 'opencode-go', 'deepseek', 'openrouter', 'groq', 'cerebras', 'gemini', 'xiaomi', 'ollama', 'lmstudio'];
  globalThis.__catalogFixture.keys = Object.fromEntries(providers.map(provider => [provider, 'fixture-key']));
  await withPayload({}, async () => {
    for (const provider of providers) assert.deepEqual(await catalog.getModelCatalog(provider), unreadable, provider);
  });
  await withPayload({ models: [{}] }, async () => assert.deepEqual(await catalog.getModelCatalog('ollama'), unreadable));
});

test('missing credentials remain unchecked without issuing a request', async () => {
  globalThis.__catalogFixture.keys = {};
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected request'); };
  try {
    for (const provider of ['openai', 'anthropic', 'deepseek', 'groq', 'cerebras', 'gemini', 'xiaomi']) assert.deepEqual(await catalog.getModelCatalog(provider), unreadable);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('complete valid responses are read correctly for every network provider', async () => {
  globalThis.__catalogFixture.settings = { customProvider: { baseUrl: 'https://fixture.invalid/v1', models: [] } };
  const payloads = {
    openai: { data: [{ id: 'listed-model' }] },
    anthropic: { data: [{ id: 'listed-model' }], has_more: false },
    'opencode-go': { data: [{ id: 'listed-model' }] },
    deepseek: { data: [{ id: 'listed-model' }] },
    openrouter: { data: [{ id: 'listed-model' }] },
    groq: { data: [{ id: 'listed-model' }] },
    cerebras: { data: [{ id: 'listed-model' }] },
    gemini: { models: [{ name: 'models/listed-model', supportedGenerationMethods: ['generateContent'] }] },
    xiaomi: { data: [{ id: 'listed-model' }] },
    ollama: { models: [{ model: 'listed-model', details: { parameter_size: '8B' } }] },
    lmstudio: { data: [{ id: 'listed-model', type: 'llm' }, { id: 'embedding-model', type: 'embeddings' }] },
    custom: { data: [{ id: 'listed-model' }] },
  };
  globalThis.__catalogFixture.keys = Object.fromEntries(Object.keys(payloads).map(provider => [provider, 'fixture-key']));
  for (const [provider, payload] of Object.entries(payloads)) await withPayload(payload, async () => {
    const result = await catalog.getModelCatalog(provider);
    assert.equal(result.status, 'read', provider);
    assert.ok(result.models.some(model => model.id === 'listed-model'), provider);
    assert.deepEqual(result.selectableModels.map(model => model.id), ['listed-model'], provider);
    if (provider === 'lmstudio') assert.ok(result.models.some(model => model.id === 'embedding-model'));
  });
});

test('OpenAI picker filters do not remove evidence that a saved model is still listed', async () => {
  globalThis.__catalogFixture.keys = { openai: 'fixture-key' };
  await withPayload({ data: [{ id: 'chat-model' }, { id: 'chat-search-model' }, { id: 'embedding-model' }] }, async () => {
    const result = await catalog.getModelCatalog('openai');
    assert.deepEqual(result.models.map(model => model.id), ['chat-model', 'chat-search-model', 'embedding-model']);
    assert.deepEqual(result.selectableModels.map(model => model.id), ['chat-model']);
    assert.deepEqual(catalog.staleFavorites([favorite('openai', 'chat-search-model')], new Map([['openai', result]])), []);
    assert.deepEqual((await catalog.listModels('openai', 'fixture-key')).map(model => model.id), ['chat-model']);
  });
});

test('Gemini full listing preserves non-picker models and incomplete pages remain unchecked', async () => {
  globalThis.__catalogFixture.keys = { gemini: 'fixture-key', anthropic: 'fixture-key' };
  await withPayload({ models: [{ name: 'models/chat', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] }, async () => {
    const result = await catalog.getModelCatalog('gemini');
    assert.deepEqual(result.models.map(model => model.id), ['chat', 'embedding']);
    assert.deepEqual(result.selectableModels.map(model => model.id), ['chat']);
  });
  await withPayload({ models: [], nextPageToken: 'more' }, async () => assert.deepEqual(await catalog.getModelCatalog('gemini'), unreadable));
  await withPayload({ data: [], has_more: true }, async () => assert.deepEqual(await catalog.getModelCatalog('anthropic'), unreadable));
});

test('full Anthropic and Gemini catalogues retain advertised context limits', async () => {
  globalThis.__catalogFixture.keys = { anthropic: 'fixture-key', gemini: 'fixture-key' };
  await withPayload({ data: [{ id: 'chat', max_input_tokens: 600_000 }] }, async () => {
    const result = await catalog.getModelCatalog('anthropic');
    assert.equal(result.status, 'read');
    assert.equal(result.models[0].contextLength, 600_000);
    assert.equal(result.selectableModels[0].contextLength, 600_000);
  });
  await withPayload({ models: [
    { name: 'models/chat', inputTokenLimit: 1_048_576, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding', inputTokenLimit: 8192, supportedGenerationMethods: ['embedContent'] },
  ] }, async () => {
    const result = await catalog.getModelCatalog('gemini');
    assert.equal(result.status, 'read');
    assert.deepEqual(result.models.map(model => [model.id, model.contextLength]), [['chat', 1_048_576], ['embedding', 8192]]);
    assert.deepEqual(result.selectableModels.map(model => model.id), ['chat']);
  });
});

test('Cerebras context enrichment preserves full account evidence and never adds public-only models', async () => {
  globalThis.__catalogFixture.keys = { cerebras: 'fixture-key' };
  let privateLimit;
  let publicUnavailable = false;
  let incomplete = false;
  let publicReads = 0;
  globalThis.fetch = async (url, init) => {
    let payload;
    if (url === 'https://api.cerebras.ai/public/v1/models') {
      publicReads++;
      assert.equal(init.headers, undefined, 'public enrichment never receives the stored key');
      if (publicUnavailable) throw Error('public catalogue offline');
      payload = { data: [
        { id: 'chat', limits: { max_context_length: 65_536 } },
        { id: 'embedding-model', limits: { max_context_length: 8192 } },
        { id: 'public-only', limits: { max_context_length: 1_000_000 } },
      ] };
    } else {
      assert.equal(url, 'https://api.cerebras.ai/v1/models');
      assert.equal(init.headers.Authorization, 'Bearer fixture-key');
      payload = { data: [{ id: 'chat', context_window: privateLimit }, { id: 'embedding-model' }], has_more: incomplete };
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const limit of [16_384, undefined]) {
      privateLimit = limit;
      const result = await catalog.getModelCatalog('cerebras');
      assert.equal(result.status, 'read');
      assert.deepEqual(result.models.map(model => model.id), ['chat', 'embedding-model']);
      assert.deepEqual(result.selectableModels.map(model => model.id), ['chat']);
      assert.equal(result.selectableModels[0].contextLength, limit ?? 65_536);
      assert.deepEqual(catalog.staleFavorites([favorite('cerebras', 'embedding-model')], new Map([['cerebras', result]])), []);
      assert.deepEqual((await catalog.listModels('cerebras', 'fixture-key')).map(model => model.id), ['chat']);
    }
    publicUnavailable = true;
    const result = await catalog.getModelCatalog('cerebras');
    assert.equal(result.status, 'read', 'optional enrichment failure does not invalidate account evidence');
    assert.deepEqual(result.models.map(model => model.id), ['chat', 'embedding-model']);
    incomplete = true;
    const readsBefore = publicReads;
    assert.deepEqual(await catalog.getModelCatalog('cerebras'), unreadable);
    assert.equal(publicReads, readsBefore, 'an incomplete account catalogue cannot be replaced by the public list');
  } finally { globalThis.fetch = originalFetch; }
});

test('Codex hidden models on subsequent pages validate saved favourites without becoming replacements', async () => {
  const calls = codexRuntime();
  const result = await catalog.getModelCatalog('codex');
  assert.equal(result.status, 'read');
  assert.deepEqual(result.models.map(model => model.id), ['visible', 'saved-hidden']);
  assert.deepEqual(result.selectableModels.map(model => model.id), ['visible']);
  assert.deepEqual(catalog.staleFavorites([favorite('codex', 'saved-hidden')], new Map([['codex', result]])), []);
  assert.equal(calls.filter(call => call.method === 'model/list').length, 2);
  codexRuntime({ connected: false });
  assert.deepEqual(await catalog.getModelCatalog('codex'), unreadable);
});

test('Copilot and built-in local catalogues retain their selection contracts', async () => {
  assert.deepEqual((await catalog.getModelCatalog('github-copilot')).models.map(model => model.id), ['copilot-model']);
  globalThis.__catalogFixture.copilotError = true;
  assert.deepEqual(await catalog.getModelCatalog('github-copilot'), unreadable);
  globalThis.__catalogFixture.copilotError = false;
  const local = await catalog.getModelCatalog('nodus');
  assert.deepEqual(local.models.map(model => model.id), ['local-chat', 'local-embedding']);
  assert.deepEqual(local.selectableModels.map(model => model.id), ['local-chat']);
});


async function mount(settings, getModelCatalog = catalog.getModelCatalog, fullProviders = false) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://nodus.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let current = settings;
  let revision = 0;
  const listeners = {};
  const patches = [];
  const savedKeys = [];
  const { createRoot } = require('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = () => root.render(React.createElement(fullProviders ? ProvidersSettings : FavoriteModelAvailability, {
    settings: current, revision,
    toggleFav: async model => { current = { ...current, favorites: current.favorites.filter(item => item.model !== model.model) }; render(); },
    onChange: async () => { revision++; render(); },
  }));
  dom.window.nodus = {
    getModelCatalog,
    updateSettings: async patch => { patches.push(patch); current = { ...current, ...patch }; },
    setApiKey: async (provider, key) => {
      savedKeys.push({ provider, key });
      current = { ...current, providerKeys: { ...current.providerKeys, [provider]: true } };
    },
    clearApiKey: async provider => { current = { ...current, providerKeys: { ...current.providerKeys, [provider]: false } }; },
    getChatGptSubscriptionStatus: async () => ({ connected: false, available: true, loginPending: false }),
    getGitHubCopilotSubscriptionStatus: async () => ({ connected: false, available: true, loginPending: false, quota: [] }),
    getOpenCodeGoUsageStatus: async () => null,
    onOpenCodeGoUsageStatusChanged: () => () => {},
    getLocalAiDiagnostics: async () => [],
    onChatGptSubscriptionStatusChanged: listener => { listeners.codex = listener; return () => delete listeners.codex; },
    onGitHubCopilotSubscriptionStatusChanged: listener => { listeners.copilot = listener; return () => delete listeners.copilot; },
  };
  await act(async () => render());
  const click = async node => act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  return {
    dom, patches, listeners, savedKeys,
    check: () => click(dom.window.document.querySelector('[data-testid="check-favorite-availability"]')),
    click,
    panel: () => dom.window.document.querySelector('[data-testid="stale-favorites"]'),
    rerender: async (patch, bumpRevision = false) => { current = { ...current, ...patch }; if (bumpRevision) revision++; await act(async () => render()); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); },
  };
}

async function providerSetup(provider = 'xiaomi', settings = {}) {
  const ui = await mount({ favorites: [], ...settings }, undefined, true);
  const row = ui.dom.window.document.querySelector(`[data-testid="${provider === 'custom' ? 'provider-row-custom' : `provider-${provider}`}"]`);
  await ui.click(row.querySelector('button'));
  return Object.assign(ui, {
    row,
    input: () => row.querySelector('input[type="password"]'),
    type: async value => act(async () => require('react-dom/test-utils').Simulate.change(row.querySelector('input[type="password"]'), { target: { value } })),
    button: label => [...row.querySelectorAll('button')].find(button => button.textContent === label),
    alert: () => row.querySelector('[role="alert"]')?.textContent,
  });
}

test('Load models saves the draft first, blocks duplicate clicks and refreshes saved-key status', async () => {
  const ui = await providerSetup();
  const calls = [];
  let finishSave;
  ui.dom.window.nodus.setApiKey = async (provider, key) => {
    calls.push(['save', provider, key]);
    await new Promise(resolve => { finishSave = resolve; });
  };
  ui.dom.window.nodus.listModels = async provider => { calls.push(['list', provider]); return [{ id: 'mimo-fixture' }]; };
  try {
    await ui.type('  test-only-key  ');
    const load = ui.button('Cargar modelos');
    await act(async () => { load.click(); load.click(); });
    assert.deepEqual(calls, [['save', 'xiaomi', 'test-only-key']]);
    assert.equal(ui.input().disabled, true);
    assert.equal(ui.button('Guardar').disabled, true);
    await act(async () => finishSave());
    assert.deepEqual(calls, [['save', 'xiaomi', 'test-only-key'], ['list', 'xiaomi']]);
    assert.equal(ui.input().value, '');
    assert.match(ui.row.textContent, /clave guardada/);
    assert.match(ui.row.textContent, /mimo-fixture/);
    assert.equal(ui.alert(), undefined);
  } finally { await ui.close(); }
});

test('failed key persistence keeps the draft and existing saved key, surfaces the cause and makes no request', async () => {
  for (const hasKey of [false, true]) {
    const ui = await providerSetup('xiaomi', { providerKeys: { xiaomi: hasKey } });
    let requests = 0;
    ui.dom.window.nodus.setApiKey = async () => { throw Error("Error invoking remote method 'settings:setApiKey': Error: encrypted storage unavailable"); };
    ui.dom.window.nodus.listModels = async () => { requests++; return []; };
    try {
      await ui.type('test-only-new-key');
      await ui.click(ui.button('Cargar modelos'));
      assert.equal(ui.input().value, 'test-only-new-key');
      assert.equal(requests, 0);
      assert.equal(ui.alert(), 'encrypted storage unavailable');
      assert.match(ui.row.textContent, hasKey ? /clave guardada/ : /sin clave/);
      assert.equal(ui.button('Guardar').disabled, false);
      await ui.click(ui.button('Guardar'));
      assert.equal(ui.alert(), 'encrypted storage unavailable', 'the separate Save action also handles rejection');
    } finally { await ui.close(); }
  }
});

test('model setup requires a private key, reuses saved keys and keeps public catalogues keyless', async () => {
  for (const [provider, saved, expected] of [['xiaomi', false, 0], ['xiaomi', true, 1], ['openrouter', false, 1], ['opencode-go', false, 1]]) {
    const ui = await providerSetup(provider, { providerKeys: { [provider]: saved } });
    let requests = 0;
    ui.dom.window.nodus.listModels = async () => { requests++; return []; };
    try {
      await ui.click(ui.button('Cargar modelos'));
      assert.equal(requests, expected, provider);
      assert.equal(ui.savedKeys.length, 0);
      assert.equal(ui.alert(), expected ? undefined : 'Introduce una clave de API antes de cargar los modelos.');
    } finally { await ui.close(); }
  }
});

test('model setup distinguishes rejected credentials from connection errors and can retry', async () => {
  const ui = await providerSetup('xiaomi', { providerKeys: { xiaomi: true } });
  try {
    ui.dom.window.nodus.listModels = async () => { throw Error("Error invoking remote method 'ai:listModels': Error: /models HTTP 401"); };
    await ui.click(ui.button('Cargar modelos'));
    assert.equal(ui.alert(), 'El proveedor rechazó la clave o sus permisos (HTTP 401).');
    ui.dom.window.nodus.listModels = async () => { throw Error("Error invoking remote method 'ai:listModels': Error: connection unavailable"); };
    await ui.click(ui.button('Cargar modelos'));
    assert.equal(ui.alert(), 'connection unavailable');
    ui.dom.window.nodus.listModels = async () => [{ id: 'after-retry' }];
    await ui.click(ui.button('Cargar modelos'));
    assert.equal(ui.alert(), undefined);
    assert.match(ui.row.textContent, /after-retry/);
  } finally { await ui.close(); }
});

test('custom and local setup save optional credentials before loading or testing, and still work without keys', async () => {
  for (const provider of ['custom', 'ollama', 'lmstudio']) {
    for (const action of ['Cargar modelos', 'Probar conexión']) {
      const ui = await providerSetup(provider);
      const calls = [];
      ui.dom.window.nodus.setApiKey = async () => { calls.push('save'); };
      ui.dom.window.nodus.listModels = async () => { calls.push('load'); return []; };
      ui.dom.window.nodus.testCustomProvider = ui.dom.window.nodus.testLocalProvider = async () => { calls.push('test'); return {ok:true,modelCount:1}; };
      try {
        await ui.type('synthetic-optional-key');
        await ui.click(ui.button(action));
        const request = action === 'Cargar modelos' ? 'load' : 'test';
        assert.deepEqual(calls, ['save',request], `${provider}: ${action}`);
        assert.equal(ui.input().value, '');
        assert.equal(ui.alert(), undefined);
        calls.length = 0;
        await ui.click(ui.button(action));
        assert.deepEqual(calls, [request], 'an empty draft never requires another key');
      } finally { await ui.close(); }
    }
    const ui = await providerSetup(provider);
    let requests = 0;
    ui.dom.window.nodus.listModels = async () => { requests++; return []; };
    try {
      await ui.click(ui.button('Cargar modelos'));
      assert.equal(requests,1,'optional providers remain keyless');
    } finally { await ui.close(); }
  }
});

test('optional provider storage failures retain the draft and prevent catalogue and connection requests', async () => {
  for (const provider of ['custom', 'ollama', 'lmstudio']) {
    const ui = await providerSetup(provider);
    let requests = 0;
    ui.dom.window.nodus.setApiKey = async () => { throw Error('encrypted storage unavailable'); };
    ui.dom.window.nodus.listModels = ui.dom.window.nodus.testCustomProvider = ui.dom.window.nodus.testLocalProvider = async () => { requests++; return []; };
    try {
      await ui.type('synthetic-optional-key');
      for (const action of ['Guardar','Cargar modelos','Probar conexión']) {
        await ui.click(ui.button(action));
        assert.equal(ui.alert(),'encrypted storage unavailable');
        assert.equal(ui.input().value,'synthetic-optional-key');
      }
      assert.equal(requests,0);
    } finally { await ui.close(); }
  }
});

test('rendered custom check uses the real service: offline manual models remain unconfirmed', async () => {
  const settings = { favorites: [favorite('custom', 'manual-alias')], customProvider: { baseUrl: 'http://127.0.0.1:1/v1', models: ['manual-alias'] } };
  globalThis.__catalogFixture.settings = settings;
  const ui = await mount(settings);
  try {
    await ui.check();
    assert.match(ui.panel().textContent, /No se pudo comprobar: Custom/);
    assert.match(ui.panel().textContent, /comprobación está incompleta/);
    assert.equal(ui.dom.window.document.querySelector('[data-stale="true"]'), null);
    assert.equal(ui.panel().querySelector('.text-emerald-600'), null);
    assert.equal(ui.patches.length, 0);
  } finally { await ui.close(); }
});

test('failed and partial checks never render an all-favourites confirmation', async () => {
  for (const mixed of [false, true]) {
    const ui = await mount({ favorites: [favorite('ollama', 'local'), ...(mixed ? [favorite('openai', 'chat')] : [])] },
      async provider => provider === 'ollama' ? unreadable : read(['chat']));
    try {
      await ui.check();
      assert.match(ui.panel().textContent, /No se pudo comprobar: Ollama/);
      assert.equal(ui.panel().querySelector('.text-emerald-600'), null);
      assert.doesNotMatch(ui.panel().textContent, /Todos los favoritos/);
    } finally { await ui.close(); }
  }
});

test('rendered Codex check keeps hidden favourites and offers only visible replacements', async () => {
  codexRuntime();
  const ui = await mount({ favorites: [favorite('codex', 'saved-hidden'), favorite('codex', 'unlisted-alias')] });
  try {
    await ui.check();
    assert.equal(ui.dom.window.document.querySelector('[data-testid="stale-favorite-saved-hidden"]'), null);
    assert.match(ui.panel().textContent, /podrían seguir funcionando como alias/);
    assert.doesNotMatch(ui.panel().textContent, /ya no.*ofrece|retirado|siguen disponibles/);
    assert.deepEqual([...ui.panel().querySelectorAll('option')].map(option => option.value), ['codex::visible']);
    assert.equal(ui.patches.length, 0);
  } finally { await ui.close(); }
});

test('a fully read matching catalogue confirms listing without asserting inference availability', async () => {
  const ui = await mount({ favorites: [favorite('openai', 'chat')] }, async () => read(['chat']));
  try {
    await ui.check();
    assert.match(ui.panel().textContent, /Todos los favoritos aparecen en los catálogos comprobados/);
    assert.doesNotMatch(ui.panel().textContent, /disponibles|ofrece/);
  } finally { await ui.close(); }
});

test('changes to favourites, URLs, manual models or credentials invalidate rendered evidence', async () => {
  for (const [patch, revision] of [
    [{ favorites: [favorite('ollama', 'newly-installed')] }, false],
    [{ localProviders: { ollama: { baseUrl: 'http://new-server/v1' } } }, false],
    [{ customProvider: { baseUrl: 'http://new-gateway/v1', models: ['manual'] } }, false],
    [{ providerKeys: { openai: false } }, false],
    [{ lockedProviderKeys: ['openai'] }, false],
    [{}, true], // Key rotation with the same providerKeys boolean.
  ]) {
    const ui = await mount({ favorites: [favorite('ollama', 'old-model')], providerKeys: { openai: true } }, async () => read(['old-model']));
    try {
      await ui.check();
      assert.ok(ui.panel());
      await ui.rerender(patch, revision);
      assert.equal(ui.panel(), null);
      assert.equal(ui.dom.window.document.querySelector('[data-stale="true"]'), null);
    } finally { await ui.close(); }
  }
});

test('an old pending query cannot repopulate the panel or override a newer query', async () => {
  const resolve = [];
  const ui = await mount({ favorites: [favorite('ollama', 'first')] }, () => new Promise(done => resolve.push(done)));
  try {
    await ui.check();
    await ui.rerender({ favorites: [favorite('ollama', 'newly-installed')] });
    await ui.check();
    await act(async () => resolve[0](read(['first'])));
    assert.equal(ui.panel(), null);
    assert.equal(ui.dom.window.document.querySelector('[data-testid="check-favorite-availability"]').disabled, true);
    await act(async () => resolve[1](read(['newly-installed'])));
    assert.match(ui.panel().textContent, /Todos los favoritos aparecen/);
    assert.equal(ui.dom.window.document.querySelector('[data-stale="true"]'), null);
  } finally { await ui.close(); }
});

test('saving a rotated key in the actual ProvidersSettings view invalidates a query even when providerKeys stays true', async () => {
  let resolve;
  const ui = await mount({ favorites: [favorite('openai', 'chat')], providerKeys: { openai: true } },
    () => new Promise(done => { resolve = done; }), true);
  try {
    await ui.check();
    const provider = [...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent.includes('OpenAI') && button.textContent.includes('▸'));
    assert.ok(provider);
    await ui.click(provider);
    const input = ui.dom.window.document.querySelector('input[type="password"]');
    assert.ok(input);
    await act(async () => require('react-dom/test-utils').Simulate.change(input, { target: { value: 'rotated-fixture-key' } }));
    await ui.click([...ui.dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Guardar'));
    assert.deepEqual(ui.savedKeys, [{ provider: 'openai', key: 'rotated-fixture-key' }]);
    await act(async () => resolve(read(['chat'])));
    assert.equal(ui.panel(), null);
    assert.equal(ui.dom.window.document.querySelector('[data-testid="check-favorite-availability"]').disabled, false);
  } finally { await ui.close(); }
});

test('subscription identity changes invalidate evidence while quota-only updates leave it intact', async () => {
  const ui = await mount({ favorites: [favorite('codex', 'model')] }, async () => read(['model']));
  try {
    const status = { connected: true, email: 'fixture@example.test', planType: 'test' };
    await act(async () => ui.listeners.codex(status));
    await ui.check();
    await act(async () => ui.listeners.codex({ ...status, rateLimits: { usedPercent: 90 } }));
    assert.ok(ui.panel());
    await act(async () => ui.listeners.codex({ ...status, connected: false }));
    assert.equal(ui.panel(), null);
  } finally { await ui.close(); }
});

test('replacement migrates task selections, leaves the legacy default alone and avoids duplicates', async () => {
  const from = favorite('deepseek', 'old-flash');
  const to = favorite('deepseek', 'deepseek-flash');
  const ui = await mount({ favorites: [from, to, favorite('ollama', 'unchecked')], chatModel: from, summaryModel: from, defaultModel: from },
    async provider => provider === 'deepseek' ? read([to.model]) : unreadable);
  try {
    await ui.check();
    assert.deepEqual([...ui.panel().querySelectorAll('option')].map(option => option.value), ['deepseek::deepseek-flash']);
    const replace = [...ui.panel().querySelectorAll('button')].find(button => button.textContent === 'Sustituir');
    await ui.click(replace);
    assert.deepEqual(ui.patches, [{ chatModel: to, summaryModel: to, favorites: [to, favorite('ollama', 'unchecked')] }]);
    assert.equal(ui.panel(), null);
  } finally { await ui.close(); }
});

test('remove only removes the favourite and never clears its task selections', async () => {
  const from = favorite('deepseek', 'unlisted');
  const ui = await mount({ favorites: [from], chatModel: from }, async () => read([]));
  try {
    await ui.check();
    await ui.click([...ui.panel().querySelectorAll('button')].find(button => button.textContent === 'Quitar'));
    assert.deepEqual(ui.patches, [{ favorites: [] }]);
  } finally { await ui.close(); }
});
