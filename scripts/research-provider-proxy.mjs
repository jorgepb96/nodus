/** Offline Electron talks only to this loopback gate. The gate is the sole
 * owner of paid network dispatch and reserves a conservative bound first. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ResearchCostLedger } from './research-cost-ledger.mjs';
import { DEEPSEEK_QA_TARIFF, deepseekUsageUpperBound } from './research-deepseek-tariff.mjs';

const ENDPOINTS = {
  deepseek: { model: 'deepseek-flash', route: '/chat/completions', url: 'https://api.deepseek.com/chat/completions', input: .3, output: 1.2 },
  openrouter: { model: 'baai/bge-m3', route: '/embeddings', url: 'https://openrouter.ai/api/v1/embeddings', input: .01, output: 0 },
};
const EXTRA_CHAT_MODELS = [
  // OpenRouter public catalogue, checked 2026-10-18; independent masked QA judge.
  { provider: 'openrouter', model: 'google/gemini-3.8-flash', route: '/chat/completions', url: 'https://openrouter.ai/api/v1/chat/completions', input: .825, output: 4.125 },
  // ZDR-capable endpoints verified from OpenRouter's public endpoint list.
  { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', route: '/chat/completions', url: 'https://openrouter.ai/api/v1/chat/completions', input: .3, output: 1.2 },
  { provider: 'openrouter', model: 'mistralai/mistral-large-4-0', route: '/chat/completions', url: 'https://openrouter.ai/api/v1/chat/completions', input: .68, output: 2.09 },
  { provider: 'gemini', model: 'gemini-3.8-flash', route: '/chat/completions', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', input: .75, output: 3.75 },
  // Google paid text prices, checked 2026-10-18 against the official pricing page.
  { provider: 'gemini', model: 'gemini-2.5-flash-lite', route: '/chat/completions', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', input: .1, output: .4 },
  { provider: 'openrouter', model: 'qwen/qwen3.6-plus', route: '/chat/completions', url: 'https://openrouter.ai/api/v1/chat/completions', input: .325, output: 1.95 },
  { provider: 'openrouter', model: 'qwen/qwen3.8-max-0902', route: '/chat/completions', url: 'https://openrouter.ai/api/v1/chat/completions', input: 2, output: 6 },
];
// Peak/cache-miss prices verified 2026-09-23. Reservation adds 25% and $0.002.
// https://api-docs.deepseek.com/quick_start/pricing/
// https://openrouter.ai/baai/bge-m3
export async function startResearchProviderProxy(root, { dispatch = fetch, catalogDispatch = dispatch === fetch ? fetch : null, port = 0, limitUsd, allowedProviders = ['deepseek', 'openrouter'], maxOutputTokens = 32768, providerLimitsUsd, excludeBgeFromBudget = false, extraChatModels = [], captureVisibleResponses = false } = {}) {
  const blocked = [];
  const canonical = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== canonical) throw new Error('Invalid campaign root');
  if (!Array.isArray(allowedProviders) || !allowedProviders.length || allowedProviders.some(provider => !['deepseek', 'openrouter', 'gemini'].includes(provider))) throw new Error('Invalid QA providers');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 393216) throw new Error('Invalid QA output bound');
  if (extraChatModels.some(id => !EXTRA_CHAT_MODELS.some(model => model.model === id))) throw new Error('Invalid extra QA model');
  const models = [...Object.entries(ENDPOINTS).map(([provider, model]) => ({ provider, ...model })), ...EXTRA_CHAT_MODELS.filter(model => extraChatModels.includes(model.model))];
  if (providerLimitsUsd && (Object.keys(providerLimitsUsd).some(provider => !allowedProviders.includes(provider)) || allowedProviders.some(provider => !Number.isFinite(providerLimitsUsd[provider]) || providerLimitsUsd[provider] <= 0))) throw new Error('Invalid provider budgets');
  const ledger = new ResearchCostLedger(path.join(canonical, 'artifacts/cost-ledger.json'), limitUsd);
  const ledgers = providerLimitsUsd ? Object.fromEntries(allowedProviders.map(provider => [provider, new ResearchCostLedger(path.join(canonical, `artifacts/cost-ledger-${provider}.json`), providerLimitsUsd[provider], { approvedModels: models.filter(model => model.provider === provider) })])) : {};
  const bgeLedger = excludeBgeFromBudget ? new ResearchCostLedger(path.join(canonical, 'artifacts/cost-ledger-bge-excluded.json'), 7) : null;
  const log = path.join(canonical, 'artifacts/provider-metrics.jsonl');
  const nonce = randomUUID();
  const slotDirectory = path.join(canonical, 'artifacts/provider-slots');
  fs.mkdirSync(slotDirectory, { recursive: true });
  let stopped = false, running = 0;
  const controllers = new Set();
  // At most two paid calls in flight. Further calls wait for a slot rather than being
  // refused: a refusal is a 403, which the application rightly reads as a bad credential.
  const waiting = [];
  const acquireSlot = async () => {
    while (running >= 2) {
      if (stopped) throw new Error('research_dispatch_not_authorized');
      await new Promise(resolve => waiting.push(resolve));
    }
    if (stopped) throw new Error('research_dispatch_not_authorized');
    running++;
  };
  const acquireCampaignSlot = async signal => {
    while (!stopped && !signal.aborted) {
      for (let index = 0; index < 2; index++) {
        const file = path.join(slotDirectory, `${index}.json`), id = randomUUID();
        const temporary = path.join(slotDirectory, `${id}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify({ pid: process.pid, id }), { mode: 0o600 });
        try {
          // Hard-link publication is exclusive and exposes a fully written owner.
          fs.linkSync(temporary, file);
          return () => { if (JSON.parse(fs.readFileSync(file, 'utf8')).id === id) fs.unlinkSync(file); };
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          // Serialize stale-owner cleanup so two reclaimers cannot remove a new owner.
          const reclaim = `${file}.reclaim`;
          try {
            fs.mkdirSync(reclaim);
            try { const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
              try { process.kill(owner.pid, 0); }
              catch (missing) { if (missing.code === 'ESRCH') fs.unlinkSync(file); else throw missing; }
            } finally { fs.rmdirSync(reclaim); }
          } catch (cleanup) { if (!['EEXIST', 'ENOENT'].includes(cleanup.code)) throw cleanup; }
        } finally { fs.rmSync(temporary, { force: true }); }
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('research_dispatch_not_authorized');
  };
  const ledgerOperation = async (work, selectedLedger = ledger) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      try { return work(); }
      catch (error) {
        if (error.code !== 'EEXIST' || error.path !== `${selectedLedger.file}.lock`) throw error;
        if (Date.now() >= deadline) throw new Error('research_accounting_lock_unavailable');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  };
  const server = http.createServer(async (request, response) => {
    let reservation, provider, started, firstByteMs, accountingLedger = ledger;
    const controller = new AbortController();
    let admitted = false, releaseCampaignSlot;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = new RegExp(`^/${nonce}/(deepseek|openrouter|gemini)(/.*)$`).exec(url.pathname);
      if (stopped || !match || url.search) throw new Error('research_dispatch_not_authorized');
      provider = match[1];
      if (!allowedProviders.includes(provider)) throw new Error('research_dispatch_not_authorized');
      let target = ENDPOINTS[provider];
      if (request.method === 'GET' && provider === 'deepseek' && match[2] === '/models' && catalogDispatch) {
        if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('research_credential_missing');
        controllers.add(controller);
        const upstream = await catalogDispatch('https://api.deepseek.com/models', { method: 'GET', redirect: 'error',
          headers: { Authorization: request.headers.authorization }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!upstream.ok) throw new Error('research_catalog_unavailable');
        const catalog = await upstream.json();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: (catalog.data ?? []).filter(model => model.id === target.model) }));
        fs.appendFileSync(log, JSON.stringify({ provider, route: '/models', status: 200, accountedUsd: 0, accounting: 'free_catalog' }) + '\n', { mode: 0o600 });
        return;
      }
      if (request.method === 'GET' && provider === 'openrouter' && match[2] === '/models' && catalogDispatch && extraChatModels.length) {
        if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('research_credential_missing');
        const upstream = await catalogDispatch('https://openrouter.ai/api/v1/models', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!upstream.ok) throw new Error('research_catalog_unavailable');
        const catalog = await upstream.json();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: (catalog.data ?? []).filter(model => models.some(allowed => allowed.provider === provider && allowed.route === '/chat/completions' && allowed.model === model.id)) }));
        fs.appendFileSync(log, JSON.stringify({ provider, route: '/models', status: 200, accountedUsd: 0, accounting: 'free_catalog' }) + '\n', { mode: 0o600 });
        return;
      }
      if (request.method !== 'POST' || !models.some(model => model.provider === provider && model.route === match[2])) throw new Error('research_dispatch_not_authorized');
      if (!request.headers.authorization?.startsWith('Bearer ')) throw new Error('research_credential_missing');
      await acquireSlot(); admitted = true; controllers.add(controller);
      releaseCampaignSlot = await acquireCampaignSlot(controller.signal);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 512000) throw new Error('research_request_too_large'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString('utf8'));
      target = models.find(model => model.provider === provider && model.route === match[2] && model.model === body.model);
      if (!target) throw new Error('research_model_or_tool_not_authorized');
      const embedding = target.route === '/embeddings';
      accountingLedger = embedding && bgeLedger ? bgeLedger : ledgers[provider] ?? ledger;
      if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) throw new Error('research_ambiguous_output_bound');
      if (body.model !== target.model || body.models?.length || body.tools?.length || body.extra_body?.google?.tools?.length || body.web_search_options || body.plugins?.length
          || (body.service_tier && !['default', 'standard'].includes(body.service_tier)) || (body.n !== undefined && body.n !== 1)) throw new Error('research_model_or_tool_not_authorized');
      if (provider === 'openrouter' && !embedding && providerLimitsUsd) {
        const prices = body.provider?.max_price ?? { prompt: target.input, completion: target.output };
        if (!Number.isFinite(prices.prompt) || prices.prompt < 0 || prices.prompt > target.input
            || !Number.isFinite(prices.completion) || prices.completion < 0 || prices.completion > target.output) throw new Error('research_routing_price_bound_required');
        body.provider = { ...body.provider, require_parameters: true, max_price: prices };
      }
      const forwarded = provider === 'openrouter' && !embedding && providerLimitsUsd ? Buffer.from(JSON.stringify(body)) : bytes;
      const output = !embedding ? body.max_tokens ?? body.max_completion_tokens : 0;
      if (!Number.isSafeInteger(output) || output < 0 || output > maxOutputTokens || (!embedding && output === 0)) throw new Error('research_output_bound_required');
      if (!embedding && (!Array.isArray(body.messages) || body.messages.some(message => typeof message.content !== 'string'))) throw new Error('research_text_only');
      if (embedding && !(typeof body.input === 'string' || (Array.isArray(body.input) && body.input.length && body.input.every(input => typeof input === 'string')))) throw new Error('research_text_only');
      const maximumUsd = ((forwarded.length * target.input + output * target.output) / 1e6) * 1.25 + .002;
      const tariffStartedAt = new Date().toISOString();
      reservation = await ledgerOperation(() => accountingLedger.reserve({ provider, model: target.model, maximumUsd }), accountingLedger);
      started = performance.now();
      response.once('close', () => { if (!response.writableFinished) controller.abort(); });
      const upstream = await dispatch(target.url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization },
        body: forwarded, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      const outputChunks = []; let outputBytes = 0;
      for await (const chunk of upstream.body ?? []) {
        firstByteMs ??= performance.now() - started;
        outputBytes += chunk.length;
        if (outputBytes > 8 * 1024 * 1024) throw new Error('research_response_too_large');
        outputChunks.push(Buffer.from(chunk)); response.write(chunk);
      }
      const text = Buffer.concat(outputChunks).toString('utf8');
      if (captureVisibleResponses && !embedding) {
        let content = '', finishReason;
        try { const reply = JSON.parse(text); content = reply.choices?.[0]?.message?.content ?? ''; finishReason = reply.choices?.[0]?.finish_reason; }
        catch { for (const line of text.split('\n')) if (line.startsWith('data: ')) try {
          const reply = JSON.parse(line.slice(6)); content += reply.choices?.[0]?.delta?.content ?? ''; finishReason = reply.choices?.[0]?.finish_reason ?? finishReason;
        } catch { /* SSE terminator. */ } }
        const hash = createHash('sha256').update(forwarded).digest('hex');
        fs.writeFileSync(path.join(canonical, 'artifacts', `${hash}-visible.json`), JSON.stringify({ provider, model: target.model, content, finishReason }), { mode: 0o600 });
      }
      let usage;
      try { usage = JSON.parse(text).usage; } catch {
        for (const line of text.split('\n')) if (line.startsWith('data: ')) try { usage = JSON.parse(line.slice(6)).usage ?? usage; } catch { /* SSE sentinel. */ }
      }
      const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
      let outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? (embedding ? 0 : undefined);
      // Some compatibility endpoints split thinking out of completion_tokens.
      // Never release the reservation for tokens still included in total usage.
      if (!embedding && Number.isSafeInteger(inputTokens) && Number.isSafeInteger(usage?.total_tokens)
          && usage.total_tokens >= inputTokens && Number.isSafeInteger(outputTokens)) {
        outputTokens = Math.max(outputTokens, usage.total_tokens - inputTokens);
      }
      let accountedUsd = null;
      let accounting = 'reservation_retained';
      let tariffFinishedAt;
      if (upstream.ok && [inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
        tariffFinishedAt = new Date().toISOString();
        accountedUsd = typeof usage.cost === 'number' ? usage.cost : provider === 'deepseek'
          ? deepseekUsageUpperBound(inputTokens, outputTokens, tariffStartedAt, tariffFinishedAt).usd
          : (inputTokens * target.input + outputTokens * target.output) / 1e6;
        accounting = typeof usage.cost === 'number' ? 'provider_cost' : provider === 'deepseek' ? 'verified_tariff_upper_bound' : 'peak_price_upper_bound';
        try { await ledgerOperation(() => accountingLedger.settle(reservation, { actualUsd: accountedUsd, inputTokens, outputTokens }), accountingLedger); }
        catch { stopped = true; throw new Error('research_accounting_bound_exceeded'); }
      } else if (upstream.status >= 400 && upstream.status < 500) {
        // A 4xx is a refusal, not a completed generation: the request was rejected before
        // running, so it cannot have been charged — the same reading the application makes
        // when it replays a refused request without its optional fields
        // (electron/ai/providerErrors.ts). A refusal that keeps its bound for ever turns the
        // ledger into a count of refusals: DeepSeek answers 400 to any prompt without the
        // word "json", so a structural refusal books its bound on every call and stops a
        // campaign that has spent a fraction of its authorization. Unknown usage from an
        // accepted request still keeps the full reservation.
        accountedUsd = 0;
        accounting = 'refused_unbilled';
        try { await ledgerOperation(() => accountingLedger.settle(reservation, { actualUsd: 0, inputTokens: 0, outputTokens: 0 }), accountingLedger); }
        catch { /* A refusal has nothing to account for. */ }
      }
      fs.appendFileSync(log, JSON.stringify({ reservation, provider, model: target.model, requestHash: createHash('sha256').update(forwarded).digest('hex'),
        status: upstream.status, latencyMs: performance.now() - started, firstByteMs, inputTokens, outputTokens, accountedUsd, maximumUsd, accounting,
        ...(accounting === 'verified_tariff_upper_bound' ? { tariff: DEEPSEEK_QA_TARIFF.version, tariffStartedAt, tariffFinishedAt } : {}) }) + '\n', { mode: 0o600 });
      response.end();
    } catch (error) {
      // Test-only simulated upstreams can ask for a real connection reset instead
      // of an error body; a paid upstream never raises this code.
      if (error?.code === 'SIMULATED_RESET' && !response.headersSent) {
        if (reservation) fs.appendFileSync(log, JSON.stringify({ reservation, provider, failed: true, simulatedReset: true }) + '\n', { mode: 0o600 });
        request.socket.destroy();
        return;
      }
      const budget = error instanceof Error && /budget.*exhausted/i.test(error.message);
      // A failure after reserving/dispatching is not evidence of a bad key.
      // Keep unknown usage fully reserved and record only bounded error types,
      // never upstream messages that may contain credentials or user material.
      if (reservation) fs.appendFileSync(log, JSON.stringify({ reservation, provider, failed: true, reservationRetained: true, latencyMs: performance.now() - started,
        errorType: error instanceof Error && ['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'unknown', errorCode: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(error?.cause?.code ?? error?.code) ? error.cause?.code ?? error.code : undefined }) + '\n', { mode: 0o600 });
      if (!response.headersSent) response.writeHead(budget ? 402 : reservation ? 503 : 403, { 'Content-Type': 'application/json' });
      const message = budget ? 'research_budget_exhausted'
        : reservation ? 'research_upstream_unavailable' : error instanceof Error && error.message.startsWith('research_') ? error.message : 'research_dispatch_blocked';
      blocked.push({ provider, message, at: new Date().toISOString() });
      response.end(JSON.stringify({ error: { message } }));
    } finally { releaseCampaignSlot?.(); if (admitted) { running--; waiting.shift()?.(); } controllers.delete(controller); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/${nonce}`, ledger, ledgers, bgeLedger, blocked, close: async () => {
    stopped = true; for (const controller of controllers) controller.abort();
    for (const resolve of waiting.splice(0)) resolve();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
