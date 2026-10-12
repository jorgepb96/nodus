/** A fresh-root, manually pinned ZDR OpenRouter gate for isolated documentary QA. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

export const OPENROUTER_QA_MODEL = 'mistralai/mistral-small-3.2-24b-instruct';
export const OPENROUTER_QA_CANONICAL_MODEL = 'mistralai/mistral-small-3.2-24b-instruct-2506';
export const OPENROUTER_QA_PROVIDER = 'deepinfra';
export const OPENROUTER_QA_ENDPOINT = 'deepinfra/fp8';
export const OPENROUTER_QA_TARIFF = Object.freeze({ inputPerMillion: 0.075, outputPerMillion: 0.2 });
export const OPENROUTER_QA_CATALOG_TARIFF = Object.freeze({ inputPerMillion: 0.09375, outputPerMillion: 0.25 });
export const OPENROUTER_QA_PRIOR_UNKNOWN_USD = 0.00211523;
export const OPENROUTER_QA_CAMPAIGN_CEILING_USD = 0.5;
export const OPENROUTER_QA_BUDGET_CEILING_USD = OPENROUTER_QA_CAMPAIGN_CEILING_USD - OPENROUTER_QA_PRIOR_UNKNOWN_USD;
export const OPENROUTER_QA_REQUEST_CEILING_USD = 0.2;
const APPROVED_MODELS = [{ provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL }];
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 16384;
const MAX_CONTEXT_TOKENS = 128000;
const CATALOG_CONTEXT_TOKENS = 256000;
const MODEL_METADATA_URL = 'https://openrouter.ai/api/v1/models';
const ZDR_ENDPOINTS_URL = 'https://openrouter.ai/api/v1/endpoints/zdr';

const errorResponse = (response, status, message) => {
  if (response.headersSent) return response.end();
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { message } }));
};

function validateRoot(root) {
  const canonical = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== canonical) throw new Error('Invalid isolated OpenRouter QA root');
  const artifacts = path.join(canonical, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  for (const name of ['cost-ledger.json', 'provider-metrics.jsonl', 'openrouter-proxy-closed.json', 'openrouter-proxy-owner.json']) {
    if (fs.existsSync(path.join(artifacts, name))) throw new Error('OpenRouter QA requires a fresh root; existing campaigns cannot be reopened');
  }
  return { canonical, artifacts };
}

function parseUsage(text, contentType = '') {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.usage) return parsed.usage;
  } catch { /* A streaming response may contain usage in its final SSE event. */ }
  if (!contentType.includes('text/event-stream') && !text.includes('data:')) return undefined;
  let usage;
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { usage = JSON.parse(payload).usage ?? usage; } catch { /* Ignore malformed and non-final chunks. */ }
  }
  return usage;
}

function parseServedMetadata(text, contentType = '') {
  let servedModel, servedProvider;
  const inspect = value => {
    if (typeof value?.model === 'string') servedModel = value.model;
    if (typeof value?.provider === 'string') servedProvider = value.provider;
  };
  try { inspect(JSON.parse(text)); } catch { /* Streaming response metadata may arrive in SSE events. */ }
  if (contentType.includes('text/event-stream') || text.includes('data:')) {
    for (const line of text.split(/\r?\n/u)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { inspect(JSON.parse(payload)); } catch { /* Ignore malformed and non-JSON chunks. */ }
    }
  }
  return { servedModel, servedProvider };
}

function sanitizeMetadataText(value, authorization, promptContents, maxLength) {
  if (typeof value !== 'string') return undefined;
  let safe = value;
  if (authorization) {
    safe = safe.replaceAll(authorization, '[redacted credential]');
    const token = /^Bearer\s+(\S+)$/u.exec(authorization)?.[1];
    if (token) safe = safe.replaceAll(token, '[redacted credential]');
  }
  safe = safe.replace(/bearer\s+[^\s,;"']+/giu, 'Bearer [redacted]')
    .replace(/(?:sk-or-v1-|sk-)[A-Za-z0-9_-]{8,}/gu, '[redacted token]')
    .replace(/(?:api[_ -]?key|token)\s*[:=]\s*[^\s,;"']+/giu, '[redacted token]')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const lowerSafe = safe.toLocaleLowerCase('und');
  const normalizedSafe = (lowerSafe.match(/[\p{L}\p{N}_-]+/gu) ?? []).join(' ');
  for (const content of promptContents) {
    if (typeof content !== 'string' || content.length < 24) continue;
    const lowerContent = content.toLocaleLowerCase('und');
    if (lowerSafe.includes(lowerContent)) return '[redacted message overlapping request content]';
    const promptWords = lowerContent.match(/[\p{L}\p{N}_-]+/gu) ?? [];
    for (let index = 0; index + 4 <= promptWords.length; index += 1) {
      const phrase = promptWords.slice(index, index + 4).join(' ');
      if (phrase.length >= 18 && normalizedSafe.includes(phrase)) return '[redacted message overlapping request content]';
    }
  }
  return safe.slice(0, maxLength);
}

function parseUpstreamError(text, contentType, authorization, promptContents) {
  const candidates = [];
  const inspect = value => {
    if (value && typeof value === 'object' && value.error && typeof value.error === 'object') candidates.push(value.error);
  };
  try { inspect(JSON.parse(text)); } catch { /* Streaming errors may arrive as SSE data. */ }
  if (contentType.includes('text/event-stream') || text.includes('data:')) {
    for (const line of text.split(/\r?\n/u)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { inspect(JSON.parse(payload)); } catch { /* Ignore malformed error events. */ }
    }
  }
  const error = candidates.at(-1);
  if (!error) return undefined;
  const providerName = error.provider_name ?? error.metadata?.provider_name;
  return {
    ...(typeof error.code === 'string' ? { code: sanitizeMetadataText(error.code, authorization, promptContents, 120) } : {}),
    ...(typeof providerName === 'string' ? { providerName: sanitizeMetadataText(providerName, authorization, promptContents, 120) } : {}),
    ...(typeof error.message === 'string' ? { message: sanitizeMetadataText(error.message, authorization, promptContents, 400) } : {}),
  };
}

function abortableDelay(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('research_request_cancelled'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new Error('research_request_cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('research_invalid_request');
  const allowedFields = new Set(['model', 'messages', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'stream', 'stream_options', 'seed', 'response_format', 'reasoning', 'n', 'provider']);
  if (Object.keys(body).some(key => !allowedFields.has(key))) throw new Error('research_request_field_not_authorized');
  if (![OPENROUTER_QA_MODEL, OPENROUTER_QA_CANONICAL_MODEL].includes(body.model)) throw new Error('research_model_not_authorized');
  if (body.provider !== undefined && (!body.provider || typeof body.provider !== 'object' || Array.isArray(body.provider)
    || Object.keys(body.provider).some(key => key !== 'sort')
    || (body.provider.sort !== undefined && body.provider.sort !== 'throughput'))) throw new Error('research_provider_routing_not_authorized');
  if (Object.hasOwn(body, 'max_tokens') && Object.hasOwn(body, 'max_completion_tokens')) throw new Error('research_ambiguous_output_bound');
  const outputTokens = body.max_tokens ?? body.max_completion_tokens;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > MAX_OUTPUT_TOKENS) throw new Error('research_output_bound_required');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some(message => !message || typeof message !== 'object'
    || Array.isArray(message) || Object.keys(message).some(key => key !== 'role' && key !== 'content')
    || !['system', 'developer', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new Error('research_text_only');
  if (body.n !== undefined && body.n !== 1) throw new Error('research_multiple_completions_not_authorized');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new Error('research_invalid_request');
  for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']) {
    if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]))) throw new Error('research_invalid_request');
  }
  if (body.reasoning !== undefined && (!body.reasoning || typeof body.reasoning !== 'object' || Array.isArray(body.reasoning))) throw new Error('research_reasoning_must_be_disabled');
  // The selected Mistral catalog row is itself a fixed snapshot. Do not let the
  // caller enable model reasoning; the ZDR endpoint is explicitly non-reasoning.
  const forwarded = { ...body, model: OPENROUTER_QA_MODEL, max_tokens: outputTokens, n: 1,
    provider: { only: [OPENROUTER_QA_PROVIDER], allow_fallbacks: false, zdr: true,
      data_collection: 'deny', quantizations: ['fp8'], require_parameters: true,
      max_price: { prompt: OPENROUTER_QA_TARIFF.inputPerMillion,
        completion: OPENROUTER_QA_TARIFF.outputPerMillion } } };
  delete forwarded.max_completion_tokens;
  delete forwarded.reasoning;
  // Any caller-supplied stream options are narrowed to usage reporting only.
  if (body.stream) forwarded.stream_options = { include_usage: true };
  else delete forwarded.stream_options;
  return { forwarded, outputTokens };
}

function exactPrice(item) {
  const prompt = Number(item?.pricing?.prompt);
  const completion = Number(item?.pricing?.completion);
  return Number.isFinite(prompt) && Math.abs(prompt - OPENROUTER_QA_TARIFF.inputPerMillion / 1_000_000) < 1e-15
    && Number.isFinite(completion) && Math.abs(completion - OPENROUTER_QA_TARIFF.outputPerMillion / 1_000_000) < 1e-15;
}

function isPinnedCatalogModel(item) {
  const prompt = Number(item?.pricing?.prompt);
  const completion = Number(item?.pricing?.completion);
  return item?.id === OPENROUTER_QA_MODEL && item?.canonical_slug === OPENROUTER_QA_CANONICAL_MODEL
    && item?.context_length === CATALOG_CONTEXT_TOKENS
    && Number.isFinite(prompt) && Math.abs(prompt - OPENROUTER_QA_CATALOG_TARIFF.inputPerMillion / 1_000_000) < 1e-15
    && Number.isFinite(completion) && Math.abs(completion - OPENROUTER_QA_CATALOG_TARIFF.outputPerMillion / 1_000_000) < 1e-15
    && item?.architecture?.modality === 'text+image->text'
    && ['temperature', 'max_tokens', 'response_format'].every(parameter => item?.supported_parameters?.includes(parameter));
}

function isPinnedZdrEndpoint(item) {
  return item?.model_id === OPENROUTER_QA_MODEL && item?.name === `DeepInfra | ${OPENROUTER_QA_CANONICAL_MODEL}`
    && item?.model_name === 'Mistral: Mistral Small 3.2 24B' && item?.provider_name === 'DeepInfra'
    && item?.tag === OPENROUTER_QA_ENDPOINT && item?.quantization === 'fp8'
    && item?.context_length === MAX_CONTEXT_TOKENS && item?.max_completion_tokens === MAX_OUTPUT_TOKENS
    && item?.status === 0 && item?.supports_implicit_caching === false && exactPrice(item)
    && ['temperature', 'max_tokens', 'response_format'].every(parameter => item?.supported_parameters?.includes(parameter));
}

async function fetchPinnedModel(catalogDispatch, auth, signal) {
  if (!catalogDispatch) throw new Error('research_model_metadata_unavailable');
  const options = { method: 'GET', redirect: 'error', headers: { Authorization: auth },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) };
  const [modelResponse, endpointResponse] = await Promise.all([
    catalogDispatch(MODEL_METADATA_URL, options), catalogDispatch(ZDR_ENDPOINTS_URL, options),
  ]);
  for (const upstream of [modelResponse, endpointResponse]) {
    if (!upstream.ok) {
      const errorText = await upstream.text();
      const error = new Error(upstream.status === 401 ? 'research_invalid_credential'
        : upstream.status === 429 ? 'research_upstream_rate_limited'
          : upstream.status >= 500 ? 'research_upstream_server_error' : 'research_model_metadata_unavailable');
      error.upstreamStatus = upstream.status;
      error.upstreamError = parseUpstreamError(errorText, upstream.headers.get('content-type') ?? '', auth, []);
      throw error;
    }
  }
  const [catalog, endpoints] = await Promise.all([modelResponse.json(), endpointResponse.json()]);
  const model = Array.isArray(catalog.data) ? catalog.data.find(isPinnedCatalogModel) : null;
  const endpoint = Array.isArray(endpoints.data) ? endpoints.data.find(isPinnedZdrEndpoint) : null;
  if (!model || !endpoint) throw new Error('research_zdr_snapshot_mismatch');
  return model;
}

function requestMaximumUsd(inputBytes, outputTokens) {
  // Serialized UTF-8 request bytes conservatively bound input tokens; include a
  // framing allowance and 50% price headroom. Unknown usage never releases this.
  const inputTokens = inputBytes + 1024;
  if (inputTokens + outputTokens > MAX_CONTEXT_TOKENS) throw new Error('research_context_limit_exceeded');
  return ((inputTokens * OPENROUTER_QA_TARIFF.inputPerMillion + outputTokens * OPENROUTER_QA_TARIFF.outputPerMillion) / 1_000_000) * 1.5 + 0.002;
}

export async function startResearchOpenRouterProxy(root, { dispatch = fetch, catalogDispatch = dispatch === fetch ? fetch : null,
  port = 0, limitUsd = OPENROUTER_QA_BUDGET_CEILING_USD, minDispatchIntervalMs = 15000,
  now = () => performance.now(), wait = abortableDelay, priorCommittedUsd = OPENROUTER_QA_PRIOR_UNKNOWN_USD } = {}) {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error('Invalid OpenRouter QA budget');
  if (!Number.isFinite(priorCommittedUsd) || priorCommittedUsd < 0 || priorCommittedUsd > OPENROUTER_QA_CAMPAIGN_CEILING_USD) throw new Error('Invalid prior OpenRouter campaign commitment');
  if (!Number.isSafeInteger(minDispatchIntervalMs) || minDispatchIntervalMs < 0 || typeof now !== 'function' || typeof wait !== 'function') throw new Error('Invalid OpenRouter QA dispatch spacing');
  const { canonical, artifacts } = validateRoot(root);
  // A campaign may supply its cumulative prior commitment from the shared
  // budget ledger; the default preserves the isolated preflight fixture.
  const effectiveLimit = Math.min(limitUsd, OPENROUTER_QA_CAMPAIGN_CEILING_USD - priorCommittedUsd);
  if (effectiveLimit <= 0) throw new Error('OpenRouter QA campaign authorization is exhausted');
  const ledger = new ResearchCostLedger(path.join(artifacts, 'cost-ledger.json'), effectiveLimit, { approvedModels: APPROVED_MODELS });
  const metrics = path.join(artifacts, 'provider-metrics.jsonl');
  const nonce = randomUUID();
  const ownerFile = path.join(artifacts, 'openrouter-proxy-owner.json');
  const owner = fs.openSync(ownerFile, 'wx', 0o600);
  fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, nonce }));
  fs.closeSync(owner);
  let stopped = false, active = false, closePromise, halted = null, lastDispatchAt = null;
  const blocked = [];
  const controllers = new Set();
  const waiters = [];
  const acquire = signal => {
    if (stopped || signal.aborted) return Promise.reject(new Error('research_proxy_closed'));
    if (!active) { active = true; return Promise.resolve(release); }
    return new Promise((resolve, reject) => {
      const waiter = { resolve: () => { signal.removeEventListener('abort', abort); resolve(release); }, reject };
      const abort = () => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(new Error('research_request_cancelled')); };
      waiters.push(waiter); signal.addEventListener('abort', abort, { once: true });
    });
  };
  const release = () => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve();
    else active = false;
  };
  const appendMetric = row => fs.appendFileSync(metrics, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  const recordBlocked = (status, message, route = 'unknown', upstreamError) => {
    const row = { at: new Date().toISOString(), provider: 'openrouter', route, blocked: true, status, message,
      reason: halted?.reason ?? message, ...(upstreamError ? { upstreamError } : {}) };
    blocked.push(row);
    appendMetric(row);
  };
  const haltDispatch = (reason, status) => {
    if (halted) return halted;
    halted = { reason, status, at: new Date().toISOString() };
    return halted;
  };
  const server = http.createServer(async (request, response) => {
    const controller = new AbortController();
    controllers.add(controller);
    request.once('aborted', () => controller.abort());
    response.once('close', () => { if (!response.writableFinished) controller.abort(); });
    let reservation, releaseSlot, providerStatus, reportedCost, tariffCostBound, inputTokens, reportedOutputTokens, maximumUsd,
      servedModel, servedProvider, overrun = false, upstreamError, parsedRequest, requestAuth;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = new RegExp(`^/${nonce}/openrouter(/.*)$`).exec(url.pathname);
      if (stopped || !match || url.search) {
        recordBlocked(403, 'research_dispatch_not_authorized', match?.[1] === '/models' ? '/models' : match?.[1] === '/chat/completions' ? '/chat/completions' : 'unknown');
        return errorResponse(response, 403, 'research_dispatch_not_authorized');
      }
      const auth = request.headers.authorization;
      if (!auth || !/^Bearer\s+\S+$/u.test(auth)) {
        recordBlocked(401, 'research_credential_missing', match[1]);
        return errorResponse(response, 401, 'research_credential_missing');
      }

      if (request.method === 'GET' && match[1] === '/models' && catalogDispatch) {
        const item = await fetchPinnedModel(catalogDispatch, auth, controller.signal);
        const data = [item];
        appendMetric({ provider: 'openrouter', route: '/models', status: 200, listedModels: data.length, accountedUsd: 0, accounting: 'free_catalog' });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        return response.end(JSON.stringify({ data }));
      }
      if (request.method !== 'POST' || match[1] !== '/chat/completions') {
        recordBlocked(403, 'research_dispatch_not_authorized', match[1]);
        return errorResponse(response, 403, 'research_dispatch_not_authorized');
      }
      if (halted) {
        recordBlocked(503, 'research_upstream_paused', '/chat/completions');
        return errorResponse(response, 503, 'research_upstream_paused');
      }

      releaseSlot = await acquire(controller.signal);
      if (halted) throw new Error('research_upstream_paused');
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) throw new Error('research_request_too_large');
        chunks.push(chunk);
      }
      if (controller.signal.aborted) throw new Error('research_request_cancelled');
      const received = Buffer.concat(chunks);
      try { parsedRequest = JSON.parse(received.toString('utf8')); } catch { throw new Error('research_invalid_request'); }
      requestAuth = auth;
      const { forwarded, outputTokens } = validateRequest(parsedRequest);
      await fetchPinnedModel(catalogDispatch, auth, controller.signal);
      const bytes = Buffer.from(JSON.stringify(forwarded));
      maximumUsd = requestMaximumUsd(bytes.length, outputTokens);
      if (maximumUsd > OPENROUTER_QA_REQUEST_CEILING_USD) throw new Error('research_request_cost_cap_exceeded');
      const spacing = lastDispatchAt === null ? 0 : Math.max(0, minDispatchIntervalMs - (now() - lastDispatchAt));
      await wait(spacing, controller.signal);
      if (halted) throw new Error('research_upstream_paused');
      reservation = ledger.reserve({ provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL, maximumUsd });
      const startedAt = performance.now();
      lastDispatchAt = now();
      const upstream = await dispatch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: auth }, body: bytes,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      providerStatus = upstream.status;
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      const outputChunks = []; let outputBytes = 0;
      for await (const chunk of upstream.body ?? []) {
        outputBytes += chunk.length;
        if (outputBytes > 8 * 1024 * 1024) throw new Error('research_response_too_large');
        outputChunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(outputChunks).toString('utf8');
      const promptContents = Array.isArray(parsedRequest?.messages) ? parsedRequest.messages.map(message => message.content) : [];
      if (!upstream.ok) {
        upstreamError = parseUpstreamError(text, contentType, requestAuth, promptContents);
        const reason = upstream.status === 429 ? 'upstream_rate_limited'
          : upstream.status === 401 || upstream.status === 403 ? 'upstream_auth_error'
            : upstream.status >= 500 ? 'upstream_server_error' : 'upstream_http_error';
        haltDispatch(reason, upstream.status);
        recordBlocked(upstream.status, `research_${reason}`, '/chat/completions', upstreamError);
      }
      const usage = parseUsage(text, contentType);
      ({ servedModel, servedProvider } = parseServedMetadata(text, contentType));
      inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
      reportedOutputTokens = usage?.completion_tokens ?? usage?.output_tokens;
      const hasReportedCost = Boolean(usage && Object.hasOwn(usage, 'cost'));
      reportedCost = usage?.cost;
      const malformedReportedCost = hasReportedCost && (typeof reportedCost !== 'number' || !Number.isFinite(reportedCost) || reportedCost < 0);
      const validTokenUsage = [inputTokens, reportedOutputTokens].every(value => Number.isSafeInteger(value) && value >= 0);
      tariffCostBound = validTokenUsage
        ? (inputTokens * OPENROUTER_QA_TARIFF.inputPerMillion + reportedOutputTokens * OPENROUTER_QA_TARIFF.outputPerMillion) / 1_000_000
        : null;
      let actualUsd = null;
      if (upstream.ok && !malformedReportedCost && validTokenUsage) {
        // usage.cost is the billed amount from the fixed OpenRouter endpoint;
        // never let it undercut our pinned token-rate bound.
        actualUsd = Math.max(tariffCostBound, hasReportedCost ? reportedCost : tariffCostBound);
        if (actualUsd <= maximumUsd) ledger.settle(reservation, { actualUsd, inputTokens, outputTokens: reportedOutputTokens });
        else { haltDispatch('accounting_bound_exceeded', upstream.status); overrun = true; throw new Error('research_cost_bound_exceeded'); }
      } else if (upstream.ok) {
        haltDispatch(malformedReportedCost ? 'malformed_upstream_cost' : 'upstream_usage_unavailable', upstream.status);
      }
      appendMetric({ reservation, provider: 'openrouter', model: OPENROUTER_QA_CANONICAL_MODEL,
        selectedEndpointProvider: OPENROUTER_QA_PROVIDER, selectedEndpoint: OPENROUTER_QA_ENDPOINT,
        servedModel, servedProvider,
        requestHash: createHash('sha256').update(bytes).digest('hex'), status: upstream.status,
        latencyMs: performance.now() - startedAt, inputTokens, outputTokens: reportedOutputTokens,
        reportedCost: hasReportedCost && !malformedReportedCost ? reportedCost : undefined, upstreamError,
        tariffCostBound, actualUsd, maximumUsd, accounting: actualUsd !== null ? 'max_reported_cost_or_pinned_tariff' : malformedReportedCost
          ? 'malformed_reported_cost_reservation_retained' : 'reservation_retained' });
      if (!upstream.ok) {
        // The caller may persist its AiError in a campaign report. Never pass
        // through an upstream error body that can echo credentials or prompts.
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: upstreamError?.message ?? 'research_upstream_unavailable',
          ...(upstreamError?.code ? { code: upstreamError.code } : {}),
          ...(upstreamError?.providerName ? { provider_name: upstreamError.providerName } : {}) } }));
      } else {
        response.writeHead(upstream.status, { 'Content-Type': contentType });
        response.end(text);
      }
    } catch (error) {
      if (reservation) appendMetric({ reservation, provider: 'openrouter', status: providerStatus,
        failed: true, reservationRetained: true, ...(overrun ? { overrun: true,
          knownActualUsd: Math.max(tariffCostBound ?? 0, typeof reportedCost === 'number' ? reportedCost : 0), maximumUsd, reportedCost, tariffCostBound,
          inputTokens, outputTokens: reportedOutputTokens, selectedEndpointProvider: OPENROUTER_QA_PROVIDER,
          selectedEndpoint: OPENROUTER_QA_ENDPOINT, servedModel, servedProvider } : {}), ...(upstreamError ? { upstreamError } : {}) });
      if (reservation && !halted) haltDispatch('upstream_transport_or_response_error', providerStatus ?? null);
      const message = error instanceof Error && typeof error.upstreamStatus === 'number' && error.upstreamStatus === 429 ? 'research_upstream_rate_limited'
        : error instanceof Error && typeof error.upstreamStatus === 'number' && error.upstreamStatus >= 500 ? 'research_upstream_server_error'
          : error instanceof Error && /budget.*exhausted/i.test(error.message) ? 'research_budget_exhausted'
        : error instanceof Error && error.message.startsWith('research_') ? error.message : 'research_upstream_unavailable';
      const status = message === 'research_budget_exhausted' || message === 'research_request_cost_cap_exceeded' ? 402
        : message === 'research_invalid_credential' ? 401
          : message === 'research_upstream_rate_limited' ? 429
            : message === 'research_upstream_server_error' ? 503
          : message === 'research_upstream_paused' ? 503
          : message === 'research_request_cancelled' || message === 'research_proxy_closed' ? 499 : 403;
      const errorStatus = typeof error?.upstreamStatus === 'number' ? error.upstreamStatus : null;
      const haltReason = message === 'research_invalid_credential' ? 'upstream_auth_error'
        : message === 'research_upstream_rate_limited' ? 'upstream_rate_limited'
          : message === 'research_upstream_server_error' ? 'upstream_server_error' : null;
      if (haltReason && !halted) haltDispatch(haltReason, errorStatus ?? status);
      if (error?.upstreamError) appendMetric({ provider: 'openrouter', route: request.url?.includes('/models') ? '/models' : '/chat/completions',
        status: errorStatus, upstreamError: error.upstreamError, accounting: 'free_catalog_error' });
      recordBlocked(status, message, request.url?.includes('/models') ? '/models' : request.url?.includes('/chat/completions') ? '/chat/completions' : 'unknown', error?.upstreamError);
      if (!response.destroyed) errorResponse(response, status, message);
    } finally {
      releaseSlot?.();
      controllers.delete(controller);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) { fs.unlinkSync(ownerFile); throw error; }
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/${nonce}`, ledger, limitUsd: effectiveLimit, blocked,
    get halted() { return halted; },
    close: () => closePromise ??= (async () => {
      stopped = true;
      for (const waiter of waiters.splice(0)) waiter.reject(new Error('research_proxy_closed'));
      for (const controller of controllers) controller.abort();
      const stoppedServer = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await stoppedServer;
      const ledgerState = ledger.read();
      const metricRows = fs.existsSync(metrics) ? fs.readFileSync(metrics, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)) : [];
      const overruns = new Map(metricRows.filter(row => row.overrun === true && typeof row.reservation === 'string' && Number.isFinite(row.knownActualUsd))
        .map(row => [row.reservation, { knownActualUsd: row.knownActualUsd, maximumUsd: row.maximumUsd }]));
      const accountedUpperBoundUsd = Number(ledgerState.calls.reduce((sum, call) =>
        sum + Math.max(call.actualUsd ?? call.maximumUsd, overruns.get(call.id)?.knownActualUsd ?? 0), 0).toFixed(8));
      const closure = { closedAt: new Date().toISOString(), limitUsd: ledgerState.limitUsd,
        campaignCeilingUsd: OPENROUTER_QA_CAMPAIGN_CEILING_USD,
        priorUnknownUsd: OPENROUTER_QA_PRIOR_UNKNOWN_USD, priorCommittedUsd,
        calls: ledgerState.calls.length, accountedUpperBoundUsd,
        knownCostOverruns: [...overruns].map(([reservation, cost]) => ({ reservation, ...cost,
          excessUsd: Number((cost.knownActualUsd - (cost.maximumUsd ?? ledgerState.calls.find(call => call.id === reservation)?.maximumUsd ?? 0)).toFixed(8)) })),
        stopReason: halted?.reason ?? null };
      closure.cumulativeCampaignUpperBoundUsd = Number((closure.priorCommittedUsd + closure.accountedUpperBoundUsd).toFixed(8));
      const file = path.join(artifacts, 'openrouter-proxy-closed.json');
      const temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(closure, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, file);
      fs.unlinkSync(ownerFile);
      return closure;
    })() };
}
