// Exercise the real public completion APIs, scheduler and perf output. Providers
// are stubbed; the trace must survive transport awaits, JSON retries and queueing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ai-call-trace-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const originalLog = console.log;
const originalCapture = Error.captureStackTrace;
const originalFetch = globalThis.fetch;
const originalTrace = process.env.NODUS_AI_CALL_TRACE;
const originalJsonl = process.env.NODUS_PERF_JSONL;
const jsonl = path.join(scratch, 'perf.jsonl');
const lines = [];
const captures = [];
const requests = [];
let replies = [];
let gateway;
console.log = (...args) => { lines.push(args.join(' ')); };
Error.captureStackTrace = (target, boundary) => {
  if (boundary) captures.push(boundary.name);
  return originalCapture(target, boundary);
};
globalThis.fetch = () => { throw new Error('Network forbidden in AI call trace tests'); };
process.env.NODUS_PERF_JSONL = jsonl;
delete process.env.NODUS_AI_CALL_TRACE;

try {
  load('electron/db/settingsRepo.ts').getSettings = () => ({
    concurrency: 1, aiConcurrencyMode: 'manual', chatReasoning: 'off', promptLanguage: 'en',
  });
  load('electron/ai/codexSubscription.ts').completeWithChatGptSubscription = async options => {
    requests.push(options);
    await new Promise(resolve => setImmediate(resolve));
    const response = replies.shift() ?? '{"ok":true}';
    options.onDelta?.(response);
    return response;
  };
  const ai = load('electron/ai/aiClient.ts');
  const model = { provider: 'codex', model: 'gpt-5.4' };
  const opts = Object.freeze({ system: 'Return JSON.', user: 'Same request.', maxTokens: 256 });
  const events = () => fs.readFileSync(jsonl, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line)).filter(event => ['AI queue wait', 'AI inference'].includes(event.phase));
  const reset = () => { fs.writeFileSync(jsonl, ''); lines.length = 0; captures.length = 0; };
  const assertSites = expected => {
    const recorded = events();
    assert.equal(recorded.length, expected.length * 2, 'one queue/inference pair per provider request');
    for (let i = 0; i < expected.length; i++) {
      assert.deepEqual(recorded.slice(i * 2, i * 2 + 2).map(event => event.meta.callSite), [expected[i], expected[i]]);
    }
    for (const site of expected) assert.ok(lines.some(line => line.includes(`callSite=${site}`)), 'console exposes the same label');
  };

  // Off is a true no-op, including JSONL output and caller-owned options.
  await ai.completeTextNeutral({ ...opts, callSite: 'explicit.operation' }, model);
  assert.equal(captures.length, 0, 'disabled tracing never captures a stack');
  assert.ok(events().every(event => !('callSite' in event.meta)), 'disabled tracing omits the JSONL key');
  assert.ok(lines.every(line => !line.includes('callSite=')), 'disabled tracing omits the console key');
  const baselineHash = events()[0].meta.requestHash;

  process.env.NODUS_AI_CALL_TRACE = '1';
  async function researchPlanning() { return ai.completeTextNeutral(opts, model); }
  async function sourceAudit() { return ai.completeTextNeutral(opts, model); }
  reset();
  await Promise.all([researchPlanning(), sourceAudit()]);
  assertSites(['researchPlanning', 'sourceAudit']);
  assert.ok(events().every(event => event.meta.requestHash === baselineHash), 'origin labels do not change request identity');
  assert.deepEqual(captures, ['completeTextNeutral', 'completeTextNeutral'], 'one capture per logical request, before queueing');
  assert.equal('callSite' in opts, false, 'shared input options are never mutated');

  // Every public API captures its application caller, including object methods.
  const callers = {
    text() { return ai.completeText(opts, model); },
    json() { return ai.completeJson(opts, value => value?.ok === true, model); },
    stream() { return ai.completeTextStream(opts, () => {}, model); },
    neutralStream() { return ai.completeTextStreamNeutral(opts, () => {}, model); },
  };
  for (const name of Object.keys(callers)) {
    reset();
    await callers[name]();
    assertSites([`Object.${name}`]);
    assert.equal(captures.length, 1);
  }

  // A resample retains the original caller instead of naming the retry machinery.
  async function validateSources() { return ai.completeJson(opts, value => value?.ok === true, model); }
  reset();
  replies = ['{"wrong":true}', '{"ok":true}'];
  await validateSources();
  assertSites(['validateSources', 'validateSources']);
  assert.deepEqual(captures, ['completeJson'], 'retries reuse the original capture');

  // Explicit content-free labels do not depend on stack formatting or build names.
  reset();
  await ai.completeTextNeutral({ ...opts, callSite: 'research.source-audit' }, model);
  assertSites(['research.source-audit']);
  assert.equal(captures.length, 0, 'an explicit label needs no stack');
  assert.equal(events()[0].meta.requestHash, baselineHash);
  assert.ok(requests.every(request => !('callSite' in request)), 'diagnostic labels never enter provider payloads');

  // OpenAI-compatible requests pass through compatibility callbacks and provider
  // retries. Those wrappers must retain the origin captured before the first await.
  load('electron/secrets/secretStore.ts').getApiKey = () => 'test-key';
  let attempts = 0;
  gateway = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      attempts++;
      assert.equal('callSite' in JSON.parse(raw), false);
      const body = attempts === 1
        ? { error: { message: 'Temporary provider failure' } }
        : { choices: [{ message: { role: 'assistant', content: 'Recovered' }, finish_reason: 'stop' }] };
      response.writeHead(attempts === 1 ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  load('electron/ai/providers.ts').openAiCompatBase = () => `http://127.0.0.1:${gateway.address().port}/v1`;
  async function reviewEvidence() {
    return ai.completeTextNeutral(opts, { provider: 'openai', model: 'gpt-4o' });
  }
  reset();
  assert.equal(await reviewEvidence(), 'Recovered');
  assert.equal(attempts, 2, 'one failed attempt and one provider retry');
  assertSites(['reviewEvidence', 'reviewEvidence']);
  assert.deepEqual(captures.filter(name => name === 'completeTextNeutral'), ['completeTextNeutral']);

  // Failure to inspect a stack cannot prevent an otherwise valid completion.
  reset();
  Error.captureStackTrace = () => { throw new Error('No stack available'); };
  assert.equal(await researchPlanning(), '{"ok":true}');
  assert.ok(events().every(event => !('callSite' in event.meta)));
  originalLog('AI call trace: public APIs, distinct queued callers, JSON/provider retries, explicit labels, disabled output and stack failures passed. No external network or paid calls.');
} finally {
  console.log = originalLog;
  Error.captureStackTrace = originalCapture;
  globalThis.fetch = originalFetch;
  if (originalTrace === undefined) delete process.env.NODUS_AI_CALL_TRACE;
  else process.env.NODUS_AI_CALL_TRACE = originalTrace;
  if (originalJsonl === undefined) delete process.env.NODUS_PERF_JSONL;
  else process.env.NODUS_PERF_JSONL = originalJsonl;
  if (gateway) {
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}
