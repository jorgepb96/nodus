// completeJson's retry/repair budget. This is the JSON path behind 28 AI modules
// (scans, idea extraction, question generation, deep research), so every wasted
// attempt here is a billed provider call multiplied across the whole app.
//
// Drives the real aiClient against a fake OpenAI-compatible server (lmstudio's base
// URL is settings-driven) and counts the requests that actually reach the wire.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-ai-json-retry-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-ai-json-retry.mjs'), '--electron-ai-json-retry-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-json-retry-'));
installRuntimeHooks(root);

/**
 * Replies for /v1/chat/completions, consumed in order; every hit is recorded.
 * A reply may be a bare string, or `{ content, finish_reason }` to model truncation.
 */
let queue = [];
let seen = [];
/** Flips when the fake server actually flushes a delayed body, so ordering can be asserted. */
let bodyFlushed = false;
let announceBodyFlush = () => undefined;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    const next = queue.shift() ?? '{}';
    const reply = typeof next === 'string' ? { content: next, finish_reason: 'stop' } : next;
    // A refusal is a reply too: the transport's own recovery paths are driven from here.
    if (reply.status) {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: reply.error ?? 'rejected' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    const payload = JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: reply.finish_reason }] });
    if (reply.bodyDelayMs) {
      // Reproduce the SDK edge case: headers arrive within its timeout, while the
      // response body remains pending beyond the complete-operation deadline.
      res.flushHeaders();
      setTimeout(() => {
        bodyFlushed = true;
        announceBodyFlush();
        res.end(payload);
      }, reply.bodyDelayMs);
    } else {
      res.end(payload);
    }
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const geminiNative = require(path.join(repoRoot, 'electron/ai/geminiDeterministicCompletion.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });
  const model = { provider: 'lmstudio', model: 'fake-json-model' };
  const opts = { system: 'system', user: 'user', maxTokens: 256 };
  /** Demands a field the model may omit — the realistic schema-mismatch shape. */
  const guard = (v) => !!v && typeof v === 'object' && Array.isArray(v.ideas);
  const run = (replies) => { queue = replies; seen = []; bodyFlushed = false; };

  // 1. Happy path: one well-formed, schema-valid response costs exactly one call.
  run(['{"ideas":["a"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['a']);
  assert.equal(seen.length, 1, 'a valid first response costs a single provider call');
  // Every OpenAI-compatible provider (OpenAI, Groq, Cerebras, DeepSeek, Xiaomi,
  // Gemini-compat, OpenRouter) is built through this one client, so proving the
  // User-Agent survives the SDK here proves it for all of them. `defaultHeaders`
  // must WIN over the SDK's own UA, which is the part worth pinning down.
  assert.match(seen[0].headers['user-agent'], /^Nodus\/\d+\.\d+/, 'requests announce the app and its version');
  assert.doesNotMatch(seen[0].headers['user-agent'], /OpenAI/i, 'the SDK User-Agent is replaced, not appended to');

  // Optional visual planners return root arrays, including an intentional empty
  // result. Preserve that envelope instead of extracting only an inner object.
  const arrayGuard = (value) => Array.isArray(value);
  for (const content of ['[]', '["map", "timeline"]', '[{"id":"one"},{"id":"two","labels":["a{b}"]}]', '```json\n[{"id":"one"}]\n```']) {
    run([content]);
    const expected = JSON.parse(content.replace(/^```json\n|\n```$/g, ''));
    assert.deepEqual(await aiClient.completeJson(opts, arrayGuard, model), expected);
    assert.equal(seen.length, 1, 'a valid root array costs one provider call');
  }
  run(['[{"id":"one"},{"id":"two"}']);
  await assert.rejects(() => aiClient.completeJson(opts, arrayGuard, model), (error) => error.code === 'output_truncated');
  assert.equal(seen.length, 1, 'an unclosed outer array cannot become a completed inner object');

  /** A repair prompt would ship the bad text back under this key. It is forbidden here. */
  const isRepairCall = (hit) => JSON.stringify(hit.body).includes('invalid_json');

  // 2. Schema mismatch: the response parses cleanly but misses `ideas`. The repair prompt
  //    is explicitly forbidden from adding fields or inventing data, so it can only echo
  //    the same object back and fail the guard again. Retrying the frozen ORIGINAL request
  //    may recover from a stochastic sample, but changing temperature or any other input
  //    would invalidate manual-versus-automatic quality comparisons.
  run(['{"wrong":true}', '{"ideas":["b"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['b']);
  assert.equal(seen.length, 2, 'well-formed JSON that misses the schema costs attempt + retry only');
  assert.ok(!isRepairCall(seen[1]), 'no futile repair call for a schema mismatch');
  assert.deepEqual(seen[1].body, seen[0].body, 'the retry preserves every request field exactly');

  // 3. Genuinely unparseable output (two objects run together — jsonrepair bails on this
  //    where it recovers truncation and fences locally). A remote repair pass would use a
  //    different prompt and could invent fields, so recovery is another exact request.
  run(['uno {"ideas":["a"]} dos {"ideas":["b"]}', '{"ideas":["c"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['c']);
  assert.equal(seen.length, 2, 'unparseable JSON gets exactly one frozen retry');
  assert.ok(!isRepairCall(seen[1]), 'the second call never substitutes a repair prompt');
  assert.deepEqual(seen[1].body, seen[0].body, 'unparseable output also preserves request identity');

  // 4. Exhaustion: three schema-mismatched replies burn the three attempts and no more.
  run(['{"wrong":1}', '{"wrong":2}', '{"wrong":3}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), /esquema/i);
  assert.equal(seen.length, 3, 'a persistently mismatched model costs three calls, not six');
  assert.ok(seen.every((hit) => !isRepairCall(hit)), 'none of the three attempts pay for a repair');

  // 5. Truncation. The JSON is cut off at the output ceiling, and jsonrepair WOULD close
  //    the dangling braces and hand back a plausible-looking partial object. That silent
  //    data loss is the failure mode this guard exists to prevent, so the call must refuse
  //    with an actionable message naming the limit — and must not retry, because an
  //    identical request truncates identically.
  run([{ content: '{"ideas":[{"a":1},{"b":', finish_reason: 'length' }, '{"ideas":["never reached"]}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), (e) => {
    assert.match(e.message, /se cortó/i, 'the error names truncation, not a schema mismatch');
    assert.match(e.message, /256/, 'the error names the actual output limit');
    // On a local server the only lever is the context window; "analyse a smaller
    // fragment" would be advice the reader cannot act on, since chunk sizes are fixed
    // in code. LM Studio's knob is Context Length, Ollama's is num_ctx.
    assert.match(e.message, /Context Length/, 'a local truncation points at the context window knob');
    return true;
  });
  assert.equal(seen.length, 1, 'a truncated response fails fast instead of burning all three attempts');

  // 5b. Mandatory reasoning can consume the whole output allowance before the first
  // JSON token. This is still truncation and must carry the same bisection signal; the
  // generic "empty response" branch used to swallow that signal and fail the paper.
  run([{ content: '', finish_reason: 'length' }, '{"ideas":["never reached"]}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), (e) => {
    assert.equal(e.code, 'output_truncated');
    assert.match(e.message, /se cortó/i);
    return true;
  });
  assert.equal(seen.length, 1, 'empty-at-length also delegates recovery to chunk bisection');

  // 5c. OpenRouter may encode an explicit upstream failure as HTTP 200 plus an empty
  // choice with finish_reason=error. No answer exists to duplicate, so one invariant
  // replay is safe (and lets throughput routing select a healthy backend).
  run([{ content: '', finish_reason: 'error' }, '{"ideas":["recovered"]}']);
  assert.deepEqual((await aiClient.completeJson(opts, guard, model)).ideas, ['recovered']);
  assert.equal(seen.length, 2, 'an explicit empty backend failure is retried once');
  assert.deepEqual(seen[1].body, seen[0].body, 'the provider-error retry preserves request identity');

  // 6. Prose is not JSON: a clipped sentence is still usable, so plain text must survive
  //    truncation untouched rather than inheriting the JSON guard.
  run([{ content: 'una frase cortada por la mitad', finish_reason: 'length' }]);
  assert.equal(await aiClient.completeText(opts, model), 'una frase cortada por la mitad');

  // 6b. Prose that is PERSISTED opts into the JSON contract. The work summary used to
  //     store a sentence cut off at the output ceiling as a finished summary; a thinking
  //     model behind a custom OpenAI-compatible gateway spends that same ceiling on its
  //     reasoning trace, so the cutoff must surface as a retryable error instead of data.
  settingsRepo.updateSettings({ customProvider: { baseUrl, models: ['deepseek-v4.1-flash:thinking'] } });
  const thinkingModel = { provider: 'custom', model: 'deepseek-v4.1-flash:thinking' };
  run([
    { content: '요약이 문장 중간에서 잘렸', finish_reason: 'length' },
    { content: '완전한 요약입니다.', finish_reason: 'stop' },
  ]);
  await assert.rejects(
    () => aiClient.completeText({ ...opts, maxTokens: 2400, requireCompleteOutput: true }, thinkingModel),
    (e) => {
      assert.equal(e.code, 'output_truncated');
      assert.match(e.message, /2400/, 'the error names the ceiling that was hit');
      return true;
    },
  );
  assert.equal(seen.length, 1, 'the clipped attempt is not replayed with the same ceiling');
  assert.equal(seen[0].body.max_tokens, 2400, 'the first attempt asks for real headroom');
  assert.equal(
    await aiClient.completeText({ ...opts, maxTokens: 8000, requireCompleteOutput: true }, thinkingModel),
    '완전한 요약입니다.',
  );
  assert.equal(seen[1].body.max_tokens, 8000, 'the retry asks the provider for the app default ceiling');

  // 6c. Without the opt-in, conversation keeps accepting a clipped answer unchanged.
  run([{ content: 'respuesta de chat cortada', finish_reason: 'length' }]);
  assert.equal(await aiClient.completeText({ ...opts, maxTokens: 2400 }, thinkingModel), 'respuesta de chat cortada');

  // 7. Truncation a provider does not admit to. The subscription runtimes (codex,
  //    github-copilot) hand back a bare string with no finish_reason at all, and any
  //    provider can simply be wrong. jsonrepair closes the dangling braces, the shard
  //    passes the guard, and half a chunk's ideas disappear with no error anywhere — so
  //    the shape of the text has to be read on its own. The frozen request must not be
  //    replayed blindly: chunk-aware callers bisect it, while callers without a safe
  //    subdivision fail closed.
  run([{ content: '{"ideas":[{"a":1},{"b":', finish_reason: 'stop' }, '{"ideas":["never reached"]}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), (e) => {
    assert.equal(e.code, 'output_truncated');
    return true;
  });
  assert.equal(seen.length, 1, 'silent truncation is surfaced immediately for caller-controlled bisection');

  run([
    { content: '{"ideas":[{"a":1},{"b":', finish_reason: 'stop' },
    { content: '{"ideas":[{"a":1},{"b":', finish_reason: 'stop' },
    { content: '{"ideas":[{"a":1},{"b":', finish_reason: 'stop' },
  ]);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), (e) => {
    assert.match(e.message, /se cortó/i, 'the error names truncation even with no provider signal');
    assert.equal(e.code, 'output_truncated', 'and carries the code the deep scan splits on');
    return true;
  });
  assert.equal(seen.length, 1, 'repeated silent truncation also fails after one request');

  // 8. A caller that owns a semantic retry budget must disable completeJson's
  // internal retry budget. The citation verifier used to turn three outer attempts
  // into nine identical provider calls. It also treated every unknown label as
  // "supports", which could silently certify a malformed verdict.
  const deepResearch = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
  const verifyCitations = deepResearch.__verifyCitationsForTesting;
  const claim = { sentence: 'A is supported by B.', kind: 'idea', content: 'B supports A.' };

  run(['{"wrong":1}', '{"wrong":2}', '{"wrong":3}', '{"veredictos":[{"i":0,"veredicto":"sostiene"}]}']);
  await assert.rejects(() => verifyCitations([claim], model), /No se pudo verificar/);
  assert.equal(seen.length, 3, 'citation verification has one bounded budget of three calls, not 3 x 3');

  run(['{"verdicts":[{"index":0,"verdict":"supported"}]}']);
  assert.deepEqual(await verifyCitations([claim], model), ['supports']);
  assert.equal(seen.length, 1, 'safe English field aliases are accepted without a retry');

  run(['{"veredicts":[{"i":0,"veredicto":"parcial"}]}']);
  assert.deepEqual(await verifyCitations([claim], model), ['partial']);
  assert.equal(seen.length, 1, 'Gemini hybrid container spelling is accepted without weakening entry validation');

  run(['{"verdictos":[{"i":0,"veredicto":"no_sostiene"}]}']);
  assert.deepEqual(await verifyCitations([claim], model), ['unsupported']);
  assert.equal(seen.length, 1, 'Gemini translated-middle container spelling is accepted without changing verdict semantics');

  run([
    '{"veredictos":[{"i":0,"veredicto":"quizas"}]}',
    '{"veredictos":[{"i":0,"veredicto":"quizas"}]}',
    '{"veredictos":[{"i":0,"veredicto":"quizas"}]}',
  ]);
  await assert.rejects(() => verifyCitations([claim], model), /No se pudo verificar/);
  assert.equal(seen.length, 3, 'an unknown verdict fails closed after the same bounded budget');

  // 9. The complete-operation deadline must remain armed after HTTP headers. OpenAI's
  // SDK timeout stops at that boundary, which allowed a 180s request to occupy a Nodus
  // slot for 267s when DeepSeek stalled while delivering the body.
  run([{ content: '{"ideas":["late"]}', finish_reason: 'stop', bodyDelayMs: 200 }]);
  // Ordering, not milliseconds: an unarmed deadline can only surface after the body
  // lands, so a rejection that beats the flush is the property itself under any load.
  const bodyDelivered = new Promise((resolve) => { announceBodyFlush = resolve; });
  await assert.rejects(() => aiClient.completeJson({ ...opts, timeoutMs: 40 }, guard, model), (e) => {
    assert.equal(e.code, 'timeout');
    return true;
  });
  assert.equal(bodyFlushed, false, 'the caller deadline fires before the stalled body is ever delivered');
  // Waiting for the flush proves the delayed path really ran, so the check above is not vacuous.
  await bodyDelivered;
  assert.equal(bodyFlushed, true, 'the fake server did stall the body, so the ordering check had something to beat');
  assert.equal(seen.length, 1, 'an ambiguous body timeout is not replayed blindly');

  // 10. Deterministic Gemini extraction uses the native GenerationConfig contract:
  // the stable seed, JSON MIME type and output budget are explicit, and Gemini 2.5's
  // native thinking toggle matches the previous compatibility request.
  const native = geminiNative.buildGeminiDeterministicRequest({
    model: 'gemini-2.5-flash-lite', system: 's', user: 'u', temperature: 0.15,
    maxTokens: 8000, seed: 123456, images: [],
  });
  assert.equal(native.config.seed, 123456);
  assert.equal(native.config.responseMimeType, 'application/json');
  assert.equal(native.config.maxOutputTokens, 8000);
  assert.equal(native.config.temperature, 0.15);
  assert.deepEqual(native.config.thinkingConfig, { thinkingBudget: 0 });
  const gemini3 = geminiNative.buildGeminiDeterministicRequest({
    model: 'gemini-3.5-flash-lite', system: 's', user: 'u', temperature: 0.15,
    maxTokens: 8000, seed: 123456, images: [],
  });
  assert.equal(gemini3.config.temperature, undefined, 'Gemini 3 keeps provider sampling defaults');

  // 11. A model that deprecates `temperature` costs one refused request per session, not a
  // failed scan. That is how DeepSeek's unversioned ids arrived: the transport cannot know
  // in advance, so it learns from a 400 that NAMES the field, replays without it and keeps
  // every other field of the request intact.
  const deprecating = { provider: 'lmstudio', model: 'fake-deprecating-model' };
  run([{ status: 400, error: 'Unsupported parameter: temperature' }, { content: 'hola' }]);
  assert.equal(await aiClient.completeText({ system: 'system', user: 'user' }, deprecating), 'hola');
  assert.equal(seen.length, 2, 'a named temperature refusal is replayed exactly once');
  assert.ok('temperature' in seen[0].body, 'the first attempt still sent the knob');
  assert.ok(!('temperature' in seen[1].body), 'the replay drops the offending field');
  assert.deepEqual(
    { ...seen[1].body, temperature: 0 },
    { ...seen[0].body, temperature: 0 },
    'every other request field survives the recovery',
  );
  run([{ content: 'hola' }]);
  assert.equal(await aiClient.completeText({ system: 'system', user: 'user' }, deprecating), 'hola');
  assert.equal(seen.length, 1, 'the model stays learned for the rest of the session');
  assert.ok(!('temperature' in seen[0].body), 'later calls never send it again');
  // A 400 that does NOT name the field must not be replayed: otherwise every refusal for
  // any other reason would be sent twice.
  const refused = { provider: 'lmstudio', model: 'fake-other-refusal-model' };
  run([{ status: 400, error: 'context length exceeded' }]);
  await assert.rejects(() => aiClient.completeText({ system: 'system', user: 'user' }, refused));
  assert.equal(seen.length, 1, 'an unnamed 400 is surfaced, not replayed');

  run([{ status: 402, error: 'budget exhausted' }, '{"ideas":[]}']);
  await assert.rejects(() => aiClient.completeJson(opts, guard, model), error => {
    assert.equal(error.code, 'budget_exhausted');
    assert.equal(error.config, true);
    assert.match(error.message, /Presupuesto agotado/);
    return true;
  });
  assert.equal(seen.length, 1, 'an exhausted paid allowance stops without retry or invalid-key advice');

  console.log('AI JSON retry budget verified.');
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
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
