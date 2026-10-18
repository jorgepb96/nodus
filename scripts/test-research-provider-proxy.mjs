import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createResearchTestRoot } from './research-isolation.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';

test('paid gate reserves before dispatch, rejects other models and never logs credentials', async () => {
  const root = createResearchTestRoot();
  let dispatches = 0;
  const proxy = await startResearchProviderProxy(root, { port: Number(process.env.NODUS_TEST_FIXTURE_PORT ?? 0), dispatch: async (url, options) => {
    dispatches++;
    assert.equal(proxy.ledger.read().calls.length, dispatches, 'durable reservation precedes any network dispatch');
    assert.equal(options.redirect, 'error');
    if (url.includes('openrouter')) return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }], usage: { prompt_tokens: 5, total_tokens: 5, cost: 0.00000005 } }));
    return new Response('data: {"choices":[{"delta":{"content":"evidence"}}]}\n\ndata: {"usage":{"prompt_tokens":20,"completion_tokens":5}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const post = (provider, route, body) => fetch(`${proxy.url}/${provider}/${route}`, { method: 'POST', headers: { Authorization: 'Bearer fixture-secret-never-log', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const base = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Synthetic evidence' }], max_tokens: 100 };
    assert.equal((await post('deepseek', 'chat/completions', { ...base, model: 'other' })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, tools: [{}] })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, max_tokens: 999999 })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, max_tokens: 32769 })).status, 403);
    assert.equal((await post('deepseek', 'chat/completions', { ...base, max_completion_tokens: 999999 })).status, 403);
    assert.equal(dispatches, 0);
    const chat = await post('deepseek', 'chat/completions', base);
    assert.equal(chat.status, 200); assert.match(await chat.text(), /evidence/);
    const embeddings = await post('openrouter', 'embeddings', { model: 'baai/bge-m3', input: ['Synthetic source'] });
    assert.equal(embeddings.status, 200); await embeddings.text();
    assert.equal(dispatches, 2);
    const thinking = await post('deepseek', 'chat/completions', { ...base, max_tokens: 9000 + 8192, thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    assert.equal(thinking.status, 200, 'an Immersion answer plus thinking fits the paid gate');
    await thinking.text();
    assert.equal(dispatches, 3);
    assert.ok(proxy.ledger.read().calls[2].maximumUsd > proxy.ledger.read().calls[0].maximumUsd, 'the larger output is reserved before dispatch');
    assert.equal(proxy.ledger.read().calls.every(call => call.actualUsd !== null), true);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'artifacts/provider-metrics.jsonl'), 'utf8'), /fixture-secret|Synthetic source/);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

// Deep extraction issues several model calls at once. A third concurrent call used to be
// refused with a 403 that the application reads as an invalid key, which paused its queue;
// it now waits for one of the two dispatch slots instead.
test('separate proxy instances share the campaign-wide two-call limit', async () => {
  const root = createResearchTestRoot(); let active = 0, peak = 0;
  const dispatch = async () => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 80)); active--;
    return Response.json({ choices: [{ message: { content: 'fixture' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  };
  const proxies = await Promise.all([startResearchProviderProxy(root, { dispatch }), startResearchProviderProxy(root, { dispatch })]);
  try {
    const statuses = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const response = await fetch(`${proxies[index % 2].url}/deepseek/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 10 }) });
      await response.text(); return response.status;
    }));
    assert(statuses.every(status => status === 200)); assert.equal(peak, 2); assert.equal(proxies[0].ledger.read().calls.length, 6);
  } finally { await Promise.all(proxies.map(proxy => proxy.close())); fs.rmSync(root, { recursive: true, force: true }); }
});

test('calls beyond the two dispatch slots wait for a slot instead of being refused', async () => {
  const root = createResearchTestRoot();
  let inFlight = 0, peak = 0, dispatches = 0;
  const proxy = await startResearchProviderProxy(root, { port: Number(process.env.NODUS_TEST_FIXTURE_PORT ?? 0), dispatch: async () => {
    dispatches++; inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 150));
    inFlight--;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  } });
  try {
    const body = JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Synthetic' }], max_tokens: 10 });
    // Fresh connections: the shared fetch pool would reuse sockets the previous test's
    // proxy closed on the same fixture port.
    const post = () => new Promise((resolve, reject) => {
      const request = http.request(`${proxy.url}/deepseek/chat/completions`, { method: 'POST', agent: false, headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end(body);
    });
    const statuses = await Promise.all(Array.from({ length: 5 }, post));
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    assert.equal(dispatches, 5);
    assert.ok(peak <= 2, `at most two paid calls in flight, saw ${peak}`);
    assert.equal(proxy.ledger.read().calls.length, 5);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});


test('free catalogues preserve provider metadata and only list the authorised model', async () => {
  const root = createResearchTestRoot();
  let reads = 0;
  const allowed = { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } };
  const proxy = await startResearchProviderProxy(root, { dispatch: async () => { throw new Error('No paid inference expected'); }, catalogDispatch: async (url, init) => {
    reads++;
    assert.equal(url, 'https://api.deepseek.com/models');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    return Response.json({ data: [allowed, { id: 'deepseek-pro' }] });
  } });
  const get = suffix => fetch(`${proxy.url}/${suffix}`, { headers: { Authorization: 'Bearer fixture-secret' } });
  try {
    const response = await get('deepseek/models');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, [allowed]);
    assert.equal(reads, 1);
    assert.deepEqual(proxy.ledger.read().calls, [], 'a free catalogue does not reserve paid inference');
    for (const route of ['deepseek/models?extra=1', 'deepseek/other', 'openrouter/models']) assert.equal((await get(route)).status, 403);
    assert.equal(reads, 1);
    const log = fs.readFileSync(path.join(root, 'artifacts/provider-metrics.jsonl'), 'utf8');
    assert.doesNotMatch(log, /fixture-secret/);
    assert.equal(JSON.parse(log).accountedUsd, 0);
  } finally { await proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
