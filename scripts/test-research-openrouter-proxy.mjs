import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchTestRoot } from './research-isolation.mjs';
import { ResearchCostLedger } from './research-cost-ledger.mjs';
import { OPENROUTER_QA_BUDGET_CEILING_USD, OPENROUTER_QA_CAMPAIGN_CEILING_USD, OPENROUTER_QA_CANONICAL_MODEL, OPENROUTER_QA_ENDPOINT,
  OPENROUTER_QA_CATALOG_TARIFF, OPENROUTER_QA_MODEL, OPENROUTER_QA_PRIOR_UNKNOWN_USD, OPENROUTER_QA_PROVIDER,
  OPENROUTER_QA_TARIFF, startResearchOpenRouterProxy } from './research-openrouter-proxy.mjs';

const secret = 'fixture-openrouter-key-must-never-be-logged';
const input = model => ({ model, messages: [{ role: 'user', content: 'Isolated synthetic request.' }], max_tokens: 100 });
const pinnedCatalog = () => Response.json({ data: [{ id: OPENROUTER_QA_MODEL, canonical_slug: OPENROUTER_QA_CANONICAL_MODEL,
  context_length: 256000, architecture: { modality: 'text+image->text' }, supported_parameters: ['temperature', 'max_tokens', 'response_format'],
  pricing: { prompt: String(OPENROUTER_QA_CATALOG_TARIFF.inputPerMillion / 1_000_000),
    completion: String(OPENROUTER_QA_CATALOG_TARIFF.outputPerMillion / 1_000_000) } }] });
const pinnedZdrEndpoint = () => Response.json({ data: [{ name: `DeepInfra | ${OPENROUTER_QA_CANONICAL_MODEL}`,
  model_id: OPENROUTER_QA_MODEL, model_name: 'Mistral: Mistral Small 3.2 24B', provider_name: 'DeepInfra',
  tag: OPENROUTER_QA_ENDPOINT, quantization: 'fp8', context_length: 128000, max_completion_tokens: 16384, status: 0,
  supports_implicit_caching: false, supported_parameters: ['temperature', 'max_tokens', 'response_format'],
  pricing: { prompt: '0.000000075', completion: '0.0000002' } }] });
const fixtureCatalog = async url => url.endsWith('/endpoints/zdr') ? pinnedZdrEndpoint() : pinnedCatalog();
const post = (proxy, body, { token = secret, signal } = {}) => fetch(`${proxy.url}/openrouter/chat/completions`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});
const metricsAt = root => path.join(root, 'artifacts/provider-metrics.jsonl');
const metrics = root => fs.existsSync(metricsAt(root)) ? fs.readFileSync(metricsAt(root), 'utf8') : '';
const startProxy = (root, options = {}) => startResearchOpenRouterProxy(root, { minDispatchIntervalMs: 0, ...options });

test('OpenRouter QA proxy pins the selected ZDR model/endpoint, price and remaining campaign allowance', async () => {
  const root = createResearchTestRoot();
  let generationCalls = 0, catalogCalls = 0, sent;
  const proxy = await startProxy(root, { limitUsd: 9,
    catalogDispatch: async (url, options) => {
      catalogCalls++;
      assert.ok(['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/endpoints/zdr'].includes(url));
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      return url.endsWith('/endpoints/zdr') ? pinnedZdrEndpoint() : Response.json({ data: [
        { id: OPENROUTER_QA_MODEL, canonical_slug: OPENROUTER_QA_CANONICAL_MODEL, context_length: 256000,
          architecture: { modality: 'text+image->text' }, supported_parameters: ['temperature', 'max_tokens', 'response_format'],
          pricing: { prompt: '0.00000009375', completion: '0.00000025' } },
        { id: 'mistralai/another-model', canonical_slug: 'mistralai/another-model' },
      ] });
    },
    dispatch: async (url, options) => {
      generationCalls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      sent = JSON.parse(Buffer.from(options.body).toString('utf8'));
      return Response.json({ model: OPENROUTER_QA_MODEL, provider: 'DeepInfra', choices: [{ message: { content: 'Synthetic answer.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0000001 } });
    },
  });
  try {
    assert.equal(proxy.limitUsd, OPENROUTER_QA_BUDGET_CEILING_USD);
    assert.equal(proxy.limitUsd, 0.49788477, 'the failed ZDR preflight unknown reservation is counted inside the global half-dollar cap');
    assert.equal(proxy.limitUsd + OPENROUTER_QA_PRIOR_UNKNOWN_USD, OPENROUTER_QA_CAMPAIGN_CEILING_USD);
    await assert.rejects(() => startResearchOpenRouterProxy(root), /fresh root/, 'a root cannot host a second proxy instance and exceed the single-request gate');
    const catalog = await fetch(`${proxy.url}/openrouter/models`, { headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json()).data.map(item => item.id), [OPENROUTER_QA_MODEL]);
    assert.equal(catalogCalls, 2, 'the visible model list is filtered by both model and ZDR endpoint metadata');
    assert.equal(proxy.ledger.read().calls.length, 0, 'catalogue lookup does not reserve paid generation');

    for (const rejected of [
      { ...input('mistralai/other'), max_tokens: 100 },
      { ...input(OPENROUTER_QA_MODEL), tools: [{ type: 'function' }] },
      { ...input(OPENROUTER_QA_MODEL), models: ['qwen/other'] },
      { ...input(OPENROUTER_QA_MODEL), provider: { allow_fallbacks: true } },
      { ...input(OPENROUTER_QA_MODEL), provider: { sort: 'latency' } },
      { ...input(OPENROUTER_QA_MODEL), messages: [{ role: 'user', content: 'x', cache_control: { type: 'ephemeral' } }] },
      { ...input(OPENROUTER_QA_MODEL), messages: [{ role: 'user', name: 'extra', content: 'x' }] },
      { ...input(OPENROUTER_QA_MODEL), images: ['not allowed'] },
      { ...input(OPENROUTER_QA_MODEL), max_tokens: 0 },
      { ...input(OPENROUTER_QA_MODEL), max_tokens: -1 },
      { ...input(OPENROUTER_QA_MODEL), max_tokens: 16385 },
      { ...input(OPENROUTER_QA_MODEL), max_tokens: 100, max_completion_tokens: 100 },
      { ...input(OPENROUTER_QA_MODEL), max_tokens: '100' },
      { ...input(OPENROUTER_QA_MODEL), messages: [{ role: 'user', content: [{ type: 'text', text: 'not plain text' }] }] },
    ]) assert.equal((await post(proxy, rejected)).status, 403);
    assert.equal((await fetch(`${proxy.url}/openrouter/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${proxy.url}/openrouter/models?extra=1`, { headers: { Authorization: `Bearer ${secret}` } })).status, 403);
    assert.equal(generationCalls, 0, 'denied paths and malformed requests never reach the upstream dispatcher');
    assert.equal(proxy.ledger.read().calls.length, 0);
    assert.ok(proxy.blocked.length >= 15, 'denials are exposed to the campaign harness even when no reservation exists');
    const blockedRows = metrics(root).trim().split('\n').map(JSON.parse).filter(row => row.blocked === true);
    assert.ok(blockedRows.length >= 15, 'denials persist in provider metrics even when no reservation exists');
    assert.ok(blockedRows.every(row => typeof row.message === 'string' && Number.isInteger(row.status)
      && !Object.hasOwn(row, 'reservation') && !Object.hasOwn(row, 'body')));
    assert.doesNotMatch(JSON.stringify(blockedRows), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(blockedRows), /Isolated synthetic request/);

    const largeEnvelope = { ...input(OPENROUTER_QA_MODEL),
      messages: [{ role: 'user', content: `synthetic source ${'evidence '.repeat(2600)}` }],
      max_tokens: 16384, provider: { sort: 'throughput' }, reasoning: { enabled: true, effort: 'high' } };
    assert.ok(Buffer.byteLength(largeEnvelope.messages[0].content) > 23000);
    const response = await post(proxy, largeEnvelope);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Synthetic answer/);
    assert.equal(generationCalls, 1);
    assert.equal(sent.model, OPENROUTER_QA_MODEL, 'the routable alias is sent only after binding its exact canonical snapshot');
    assert.equal(sent.max_tokens, 16384, 'a 23KB evidence envelope with a 16K completion allowance fits the pinned 128K endpoint context');
    assert.equal(Object.hasOwn(sent, 'reasoning'), false, 'reasoning controls are stripped for the non-reasoning endpoint');
    assert.deepEqual(sent.provider, { only: [OPENROUTER_QA_PROVIDER], allow_fallbacks: false, zdr: true,
      data_collection: 'deny', quantizations: ['fp8'], require_parameters: true,
      max_price: { prompt: 0.075, completion: 0.2 } });
    assert.equal(catalogCalls, 4, 'every paid dispatch verifies the canonical model and ZDR endpoint through free metadata');
    const call = proxy.ledger.read().calls[0];
    assert.equal(call.provider, 'openrouter');
    assert.equal(call.model, OPENROUTER_QA_CANONICAL_MODEL);
    assert.equal(call.inputTokens, 100);
    assert.equal(call.outputTokens, 20);
    assert.equal(call.actualUsd, (100 * OPENROUTER_QA_TARIFF.inputPerMillion + 20 * OPENROUTER_QA_TARIFF.outputPerMillion) / 1_000_000,
      'reported cost cannot lower settlement beneath the pinned tariff token bound');
    assert.ok(call.actualUsd <= call.maximumUsd);
    const metric = JSON.parse(metrics(root).trim().split('\n').at(-1));
    assert.equal(metric.selectedEndpointProvider, OPENROUTER_QA_PROVIDER);
    assert.equal(metric.selectedEndpoint, OPENROUTER_QA_ENDPOINT);
    assert.equal(metric.servedModel, OPENROUTER_QA_MODEL);
    assert.equal(metric.servedProvider, 'DeepInfra');
    assert.doesNotMatch(metrics(root), new RegExp(secret));
    assert.doesNotMatch(metrics(root), /Isolated synthetic request/);
    const closure = await proxy.close();
    assert.equal(closure.calls, 1);
    assert.equal(closure.priorUnknownUsd, OPENROUTER_QA_PRIOR_UNKNOWN_USD);
    assert.equal(closure.campaignCeilingUsd, OPENROUTER_QA_CAMPAIGN_CEILING_USD);
    assert.equal(closure.cumulativeCampaignUpperBoundUsd,
      Number((closure.priorUnknownUsd + closure.accountedUpperBoundUsd).toFixed(8)));
    assert.ok(closure.cumulativeCampaignUpperBoundUsd <= closure.campaignCeilingUsd);
    assert.ok(fs.existsSync(path.join(root, 'artifacts/openrouter-proxy-closed.json')), 'close durably writes the campaign closure record');
    await assert.rejects(() => startResearchOpenRouterProxy(root), /fresh root/);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('upstream auth failures retain the reservation and pause later dispatches', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startProxy(root, { catalogDispatch: fixtureCatalog, dispatch: async (_url, options) => {
    dispatches++;
    const current = proxy.ledger.read();
    assert.equal(current.calls.length, dispatches, 'reservation exists durably before upstream dispatch');
    assert.equal(current.calls.at(-1).actualUsd, null);
    assert.equal(options.headers.Authorization, 'Bearer invalid-key');
    return Response.json({ error: { code: 'invalid_api_key', provider_name: 'OpenRouter', message: 'invalid key' } }, { status: 401 });
  } });
  try {
    const invalid = await post(proxy, input(OPENROUTER_QA_CANONICAL_MODEL), { token: 'invalid-key' });
    assert.equal(invalid.status, 401, 'upstream invalid-credential response remains distinguishable');
    assert.equal(proxy.ledger.read().calls[0].actualUsd, null, 'failed calls retain their full unknown reservation');
    assert.equal(proxy.halted.reason, 'upstream_auth_error');
    const paused = await post(proxy, input(OPENROUTER_QA_CANONICAL_MODEL));
    assert.equal(paused.status, 503);
    assert.equal((await paused.json()).error.message, 'research_upstream_paused');
    assert.equal(dispatches, 1, 'an auth error prevents retry loops from spending further budget');
    assert.equal(proxy.ledger.read().calls.length, 1);
    const rows = metrics(root).trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(row => row.upstreamError?.code === 'invalid_api_key' && row.upstreamError?.providerName === 'OpenRouter'));
    assert.ok(rows.some(row => row.blocked === true && row.reason === 'upstream_auth_error'));
    await proxy.close();
    const closed = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/openrouter-proxy-closed.json'), 'utf8'));
    assert.equal(closed.calls, 1);
    assert.ok(closed.accountedUpperBoundUsd > 0);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('successful bounded settlements continue until the durable budget blocks before dispatch', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startProxy(root, { limitUsd: 0.0044, catalogDispatch: fixtureCatalog, dispatch: async () => {
    dispatches++;
    return Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0021 } });
  } });
  try {
    assert.equal((await post(proxy, input(OPENROUTER_QA_CANONICAL_MODEL))).status, 200);
    assert.equal((await post(proxy, input(OPENROUTER_QA_CANONICAL_MODEL))).status, 200);
    const exhausted = await post(proxy, input(OPENROUTER_QA_CANONICAL_MODEL));
    assert.equal(exhausted.status, 402);
    assert.equal((await exhausted.json()).error.message, 'research_budget_exhausted');
    assert.equal(dispatches, 2, 'budget denial occurs before provider dispatch');
    assert.equal(proxy.ledger.read().calls.length, 2);
    assert.ok(proxy.ledger.read().calls.every(call => call.actualUsd !== null));
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('upstream rate limits save only sanitized error metadata and halt retries without additional reservations', async () => {
  const root = createResearchTestRoot();
  const prompt = 'synthetic private prompt phrase never persist this';
  let dispatches = 0;
  const proxy = await startProxy(root, { catalogDispatch: fixtureCatalog, dispatch: async () => {
    dispatches++;
    return Response.json({ error: { code: 'rate_limit_exceeded', provider_name: 'DeepInfra',
      message: `Rate limit. Bearer ${secret}; echoed request: ${prompt}`, metadata: { raw: `key=${secret}; ${prompt}` } } }, { status: 429 });
  } });
  try {
    const limited = await post(proxy, { ...input(OPENROUTER_QA_MODEL), messages: [{ role: 'user', content: prompt }] });
    assert.equal(limited.status, 429);
    const safeResponse = await limited.text();
    assert.doesNotMatch(safeResponse, new RegExp(secret), 'persistable caller errors never contain a credential');
    assert.doesNotMatch(safeResponse, new RegExp(prompt), 'the upstream raw error is never forwarded');
    assert.deepEqual(JSON.parse(safeResponse).error, { code: 'rate_limit_exceeded', provider_name: 'DeepInfra',
      message: '[redacted message overlapping request content]' });
    assert.equal(proxy.ledger.read().calls.length, 1);
    assert.equal(proxy.ledger.read().calls[0].actualUsd, null, 'the rate-limited request retains unknown usage');
    assert.equal(proxy.halted.reason, 'upstream_rate_limited');
    const retry = await post(proxy, input(OPENROUTER_QA_MODEL));
    assert.equal(retry.status, 503);
    assert.equal(dispatches, 1, 'the first rate limit disables production retry loops at the proxy');
    const rows = metrics(root).trim().split('\n').map(JSON.parse);
    const errorMetric = rows.find(row => row.upstreamError?.code === 'rate_limit_exceeded');
    assert.equal(errorMetric.upstreamError.providerName, 'DeepInfra');
    assert.equal(errorMetric.upstreamError.message, '[redacted message overlapping request content]');
    assert.doesNotMatch(metrics(root), new RegExp(secret));
    assert.doesNotMatch(metrics(root), new RegExp(prompt));
    assert.ok(rows.some(row => row.blocked === true && row.reason === 'upstream_rate_limited'));
    await proxy.close();
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('an upstream 5xx response pauses all later provider dispatches', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startProxy(root, { catalogDispatch: fixtureCatalog, dispatch: async () => {
    dispatches++;
    return Response.json({ error: { code: 'provider_unavailable', provider_name: 'DeepInfra', message: 'temporary provider failure' } }, { status: 503 });
  } });
  try {
    assert.equal((await post(proxy, input(OPENROUTER_QA_MODEL))).status, 503);
    assert.equal(proxy.ledger.read().calls[0].actualUsd, null);
    assert.equal(proxy.halted.reason, 'upstream_server_error');
    assert.equal((await post(proxy, input(OPENROUTER_QA_MODEL))).status, 503);
    assert.equal(dispatches, 1);
    assert.equal(proxy.ledger.read().calls.length, 1);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('catalogue rate limits also record safe metadata and pause paid dispatch without a reservation', async () => {
  const root = createResearchTestRoot();
  let generationCalls = 0;
  const proxy = await startProxy(root, {
    catalogDispatch: async () => Response.json({ error: { code: 'rate_limit_exceeded', provider_name: 'OpenRouter',
      message: `Bearer ${secret}: catalogue rate limited` } }, { status: 429 }),
    dispatch: async () => { generationCalls++; throw new Error('generation must remain blocked'); },
  });
  try {
    const catalog = await fetch(`${proxy.url}/openrouter/models`, { headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(catalog.status, 429);
    assert.equal(proxy.halted.reason, 'upstream_rate_limited');
    assert.equal(proxy.ledger.read().calls.length, 0);
    assert.equal((await post(proxy, input(OPENROUTER_QA_MODEL))).status, 503);
    assert.equal(generationCalls, 0);
    assert.doesNotMatch(metrics(root), new RegExp(secret));
    assert.match(metrics(root), /"providerName":"OpenRouter"/u);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a central prior commitment reduces the proxy allowance without resetting campaign history', async () => {
  const root = createResearchTestRoot();
  const priorCommittedUsd = 0.0928763675;
  const proxy = await startProxy(root, { priorCommittedUsd, catalogDispatch: fixtureCatalog, dispatch: async () => {
    throw new Error('no generation request expected');
  } });
  try {
    assert.equal(proxy.limitUsd, OPENROUTER_QA_CAMPAIGN_CEILING_USD - priorCommittedUsd);
    const catalog = await fetch(`${proxy.url}/openrouter/models`, { headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(catalog.status, 200);
    assert.equal(proxy.ledger.read().calls.length, 0);
    await proxy.close();
    const closure = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/openrouter-proxy-closed.json'), 'utf8'));
    assert.equal(closure.priorCommittedUsd, priorCommittedUsd);
    assert.equal(closure.cumulativeCampaignUpperBoundUsd, Number(priorCommittedUsd.toFixed(8)));
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('dispatch spacing is enforced and abort during the wait creates no reservation', async () => {
  const root = createResearchTestRoot();
  let observedWait = -1, dispatches = 0;
  const proxy = await startResearchOpenRouterProxy(root, {
    minDispatchIntervalMs: 15000, now: () => 100,
    wait: async (milliseconds, signal) => {
      observedWait = milliseconds;
      if (milliseconds === 0) return;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('research_request_cancelled')), { once: true }));
    },
    catalogDispatch: fixtureCatalog,
    dispatch: async () => {
      dispatches++;
      return Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    },
  });
  try {
    assert.equal((await post(proxy, input(OPENROUTER_QA_MODEL))).status, 200);
    const abort = new AbortController();
    const waiting = post(proxy, input(OPENROUTER_QA_MODEL), { signal: abort.signal });
    for (let index = 0; index < 50 && observedWait !== 15000; index++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(observedWait, 15000);
    abort.abort();
    await assert.rejects(waiting, error => error.name === 'AbortError');
    assert.equal(dispatches, 1);
    assert.equal(proxy.ledger.read().calls.length, 1, 'spacing cancellation happens before reservation');
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('model snapshot mismatch blocks paid dispatch and SSE accounting respects the billed-cost floor', async () => {
  const mismatchRoot = createResearchTestRoot();
  let mismatchDispatches = 0;
  const mismatch = await startProxy(mismatchRoot, {
    catalogDispatch: async url => url.endsWith('/endpoints/zdr')
      ? Response.json({ data: [{ name: `Mistral | ${OPENROUTER_QA_CANONICAL_MODEL}`,
        model_id: OPENROUTER_QA_MODEL, model_name: 'Mistral: Mistral Small 3.2 24B', provider_name: 'DeepInfra', tag: 'deepinfra/other',
        quantization: 'fp8', context_length: 32768, max_completion_tokens: 16384, status: 0,
        supports_implicit_caching: false, supported_parameters: ['temperature', 'max_tokens', 'response_format'],
        pricing: { prompt: '0.00000005', completion: '0.00000008' } }] })
      : pinnedCatalog(),
    dispatch: async () => { mismatchDispatches++; return Response.json({}); },
  });
  try {
    assert.equal((await post(mismatch, input(OPENROUTER_QA_MODEL))).status, 403);
    assert.equal(mismatchDispatches, 0, 'the mutable public alias is never dispatched unless its canonical snapshot matches');
    assert.equal(mismatch.ledger.read().calls.length, 0, 'snapshot mismatch is rejected before reservation');
  } finally { await mismatch.close(); fs.rmSync(mismatchRoot, { recursive: true, force: true }); }

  const streamRoot = createResearchTestRoot();
  let forwarded;
  const streamProxy = await startProxy(streamRoot, {
    catalogDispatch: fixtureCatalog,
    dispatch: async (_url, options) => {
      forwarded = JSON.parse(Buffer.from(options.body).toString('utf8'));
      return new Response(`data: {"model":"${OPENROUTER_QA_MODEL}","provider":"DeepInfra","choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":20,"cost":0.0000001}}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-OpenRouter-Cost': '99' } });
    },
  });
  try {
    const response = await post(streamProxy, { ...input(OPENROUTER_QA_MODEL), stream: true, stream_options: { include_usage: false } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/u);
    assert.equal(response.headers.get('x-openrouter-cost'), null, 'untrusted provider accounting headers are not forwarded');
    assert.match(await response.text(), /\[DONE\]/u);
    assert.equal(forwarded.model, OPENROUTER_QA_MODEL);
    assert.deepEqual(forwarded.stream_options, { include_usage: true });
    assert.equal(streamProxy.ledger.read().calls[0].actualUsd,
      (100 * OPENROUTER_QA_TARIFF.inputPerMillion + 20 * OPENROUTER_QA_TARIFF.outputPerMillion) / 1_000_000,
      'final SSE usage is settled at the maximum of provider billed cost and pinned tariff bound');
    const streamMetric = JSON.parse(metrics(streamRoot).trim().split('\n').at(-1));
    assert.equal(streamMetric.servedModel, OPENROUTER_QA_MODEL);
    assert.equal(streamMetric.servedProvider, 'DeepInfra');
  } finally { await streamProxy.close(); fs.rmSync(streamRoot, { recursive: true, force: true }); }
});

test('OpenRouter billed cost raises settlement, while malformed and over-bound costs retain reservations', async () => {
  const malformedRoot = createResearchTestRoot();
  const malformedProxy = await startProxy(malformedRoot, {
    catalogDispatch: fixtureCatalog,
    dispatch: async () => Response.json({ choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: '0.00000001' } }),
  });
  try {
    assert.equal((await post(malformedProxy, input(OPENROUTER_QA_MODEL))).status, 200);
    assert.equal(malformedProxy.ledger.read().calls[0].actualUsd, null,
      'a malformed reported cost leaves usage unknown instead of settling from cheaper token counts');
    assert.match(metrics(malformedRoot), /malformed_reported_cost_reservation_retained/u);
    assert.equal(malformedProxy.halted.reason, 'malformed_upstream_cost');
    assert.equal((await post(malformedProxy, input(OPENROUTER_QA_MODEL))).status, 503,
      'unknown accounting stops retries before another reservation');
  } finally { await malformedProxy.close(); fs.rmSync(malformedRoot, { recursive: true, force: true }); }

  const overrunRoot = createResearchTestRoot();
  let dispatches = 0;
  const overrunProxy = await startProxy(overrunRoot, {
    catalogDispatch: fixtureCatalog,
    dispatch: async () => {
      dispatches++;
      return Response.json({ choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.01 } });
    },
  });
  try {
    const response = await post(overrunProxy, input(OPENROUTER_QA_MODEL));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.message, 'research_cost_bound_exceeded');
    assert.equal(overrunProxy.ledger.read().calls[0].actualUsd, null, 'overrun keeps its reservation intact');
    assert.equal((await post(overrunProxy, input(OPENROUTER_QA_MODEL))).status, 503,
      'an accounting overrun stops subsequent provider dispatch');
    assert.equal(dispatches, 1);
    const rows = metrics(overrunRoot).trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(row => row.overrun === true && row.reservationRetained === true && row.reportedCost === 0.01 && row.knownActualUsd === 0.01
      && row.tariffCostBound > 0 && row.inputTokens === 100 && row.outputTokens === 20));
    await overrunProxy.close();
    const closure = JSON.parse(fs.readFileSync(path.join(overrunRoot, 'artifacts/openrouter-proxy-closed.json'), 'utf8'));
    assert.ok(closure.accountedUpperBoundUsd >= 0.01, 'known billed cost above reservation is reflected in the campaign upper bound');
    assert.equal(closure.knownCostOverruns[0].knownActualUsd, 0.01);
    assert.ok(closure.knownCostOverruns[0].excessUsd > 0, 'the amount above the original reservation is explicit');
  } finally { await overrunProxy.close(); fs.rmSync(overrunRoot, { recursive: true, force: true }); }
});

test('one paid request is dispatched at a time and caller cancellation keeps its reservation unknown', async () => {
  const root = createResearchTestRoot();
  const cancelRoot = createResearchTestRoot();
  let active = 0, peak = 0, startedCount = 0, allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const proxy = await startProxy(root, { catalogDispatch: fixtureCatalog, dispatch: async (_url, { signal }) => {
    active++; peak = Math.max(peak, active); startedCount++;
    if (startedCount === 2) allStarted();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 60);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); }, { once: true });
      });
      return Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    } finally { active--; }
  } });
  try {
    const pending = Array.from({ length: 2 }, () => post(proxy, input(OPENROUTER_QA_MODEL)).then(async response => ({ status: response.status, body: await response.text() })));
    await started;
    const results = await Promise.all(pending);
    assert.deepEqual(results.map(item => item.status), [200, 200]);
    assert.equal(peak, 1, 'the proxy serializes generation dispatch');
    assert.equal(proxy.ledger.read().calls.length, 2);

    let dispatchStarted;
    const dispatchObserved = new Promise(resolve => { dispatchStarted = resolve; });
    const cancelProxy = await startProxy(cancelRoot, { catalogDispatch: fixtureCatalog, dispatch: async (_url, { signal }) => {
      dispatchStarted();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }));
    } });
    const abort = new AbortController();
    const cancelled = post(cancelProxy, input(OPENROUTER_QA_MODEL), { signal: abort.signal });
    await dispatchObserved;
    abort.abort();
    await assert.rejects(cancelled, error => error.name === 'AbortError');
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(cancelProxy.ledger.read().calls.length, 1);
    assert.equal(cancelProxy.ledger.read().calls[0].actualUsd, null, 'cancellation never releases unknown usage');
    await cancelProxy.close();
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cancelRoot, { recursive: true, force: true }); }
});

test('the optional ledger model whitelist preserves the legacy default and isolates the new model', () => {
  const root = createResearchTestRoot();
  try {
    const legacy = new ResearchCostLedger(path.join(root, 'artifacts/legacy.json'), 0.5);
    assert.doesNotThrow(() => legacy.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 0.01 }));
    assert.doesNotThrow(() => legacy.reserve({ provider: 'openrouter', model: 'baai/bge-m3', maximumUsd: 0.01 }));
    assert.throws(() => legacy.reserve({ provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL, maximumUsd: 0.01 }), /Unapproved/);
    const isolated = new ResearchCostLedger(path.join(root, 'artifacts/openrouter-only.json'), 0.5, {
      approvedModels: [{ provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL }],
    });
    assert.doesNotThrow(() => isolated.reserve({ provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL, maximumUsd: 0.01 }));
    assert.throws(() => isolated.reserve({ provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 0.01 }), /Unapproved/);
    assert.throws(() => new ResearchCostLedger(path.join(root, 'artifacts/bad.json'), 0.5, { approvedModels: [] }), /approved/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
