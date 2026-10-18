import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-research-answer-schema-test')) {
  execFileSync(require('electron'),
    [path.join(repo, 'scripts/test-research-answer-schema.mjs'), '--electron-research-answer-schema-test'],
    { cwd: repo, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-answer-schema-'));
const bundle = path.join(userData, 'researchAnswerSchema.cjs');
const requests = [];
let replies = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    requests.push({ url: req.url, body: JSON.parse(body || '{}') });
    const reply = replies.shift() ?? { content: '{"ok":true}' };
    if (reply.status) {
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: reply.error ?? 'rejected' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let closeDb = () => undefined;

function installRuntimeHooks() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userData, getVersion: () => '0.0.0-test', getAppPath: () => repo, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: value => Buffer.from(String(value)), decryptString: value => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repo, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolve.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, { fileName: filename, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
    } }).outputText;
    module._compile(output, filename);
  };
}

try {
  installRuntimeHooks();
  const settingsRepo = require(path.join(repo, 'electron/db/settingsRepo.ts'));
  const providers = require(path.join(repo, 'electron/ai/providers.ts'));
  const secrets = require(path.join(repo, 'electron/secrets/secretStore.ts'));
  providers.openAiCompatBase = () => baseUrl;
  secrets.getApiKey = () => 'offline-test-key';
  settingsRepo.updateSettings({ openRouterThroughput: true, customProvider: { baseUrl, models: ['offline-test-model'] } });
  const aiClient = require(path.join(repo, 'electron/ai/aiClient.ts'));
  const optionalFields = require(path.join(repo, 'electron/ai/optionalFieldsSupport.ts'));
  ({ closeDb } = require(path.join(repo, 'electron/db/database.ts')));

  const planBundle = await build({ entryPoints: [path.join(repo, 'shared/researchAnswerSchema.ts')], outfile: bundle,
    bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
  void planBundle;
  const schemas = require(bundle);
  const schema = { name: 'research_answer_plan', schema: schemas.RESEARCH_ANSWER_PLAN_SCHEMA };
  const openrouter = { provider: 'openrouter', model: 'offline-test-model' };
  const guard = value => value?.ok === true;
  const run = values => { replies = [...values]; requests.length = 0; };

  const normalizedSchema = schemas.RESEARCH_ANSWER_PLAN_SCHEMA;
  assert.deepEqual(schemas.structuredResponseFormat('openai', schema), {
    type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: normalizedSchema },
  });
  assert.deepEqual(schemas.structuredResponseFormat('gemini', schema), schemas.structuredResponseFormat('openai', schema), 'Google supports an explicit native schema through its compatibility API');
  assert.equal(schemas.structuredResponseFormat('custom', schema), null);
  assert.equal(schemas.mayRetryWithoutStructuredSchema(schema), false);
  assert.equal(schemas.mayRetryWithoutStructuredSchema(undefined), true);
  assert.equal(normalizedSchema.properties.facets.maxItems, 6);
  assert.equal(schemas.RESEARCH_ANSWER_WRITER_SCHEMA.properties.tables.anyOf[0].items.properties.rows.maxItems, 40,
    'native row bound matches shared table limits');
  assert.equal(schemas.RESEARCH_ANSWER_WRITER_SCHEMA.properties.tables.anyOf[0].items.properties.headers.maxItems, 12,
    'native bounds match shared table limits rather than imposing a smaller contract');
  assert.equal(schemas.RESEARCH_ANSWER_WRITER_SCHEMA.properties.tables.anyOf[0].items.properties.rows.items.items.maxLength, 1600);

  // The byte bound includes the exact native response_format body. A prompt that fits
  // alone must be refused before transport when its opted-in schema pushes it over.
  const smallRequest = { system: 's', user: 'u', maxTokens: 128, corpusContext: true };
  const oversizedSchemaRequest = { ...smallRequest, responseSchema: {
    name: 'large_schema', schema: { type: 'object', properties: { padding: { type: 'string', description: 'x'.repeat(40_000) } } },
  } };
  const promptBound = aiClient.researchRequestUpperBound(smallRequest);
  const schemaBound = aiClient.researchRequestUpperBound(oversizedSchemaRequest);
  assert.ok(promptBound < 32_768, `base request fits the conservative window (${promptBound})`);
  assert.ok(schemaBound > 32_768, `schema-inclusive bound exceeds the conservative window (${schemaBound})`);
  let overflowLog = '';
  const originalWarn = console.warn;
  console.warn = (...parts) => { overflowLog += parts.join(' '); };
  try {
    run([{ content: '{"ok":true}' }]);
    await assert.rejects(() => aiClient.completeJson(oversizedSchemaRequest, guard, openrouter), error => error.code === 'context_overflow');
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(requests.length, 0, 'context overflow is rejected before provider dispatch');
  assert.match(overflowLog, /schemaBytes [1-9]\d*/u, 'overflow breakdown reports the schema byte count');

  // Real completeJson transport: schema body is sent, and configured OpenRouter routing
  // is preserved while ambiguous reasoning extras stay absent.
  run([{ content: '{"ok":true}' }]);
  assert.deepEqual(await aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema }, guard, openrouter), { ok: true });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.response_format, {
    type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: normalizedSchema },
  });
  assert.deepEqual(requests[0].body.provider, { sort: 'throughput' }, 'schema requests retain OpenRouter routing preference');
  assert.equal(requests[0].body.reasoning_effort, undefined, 'schema request does not add optional reasoning fields');

  run([{ content: '{"ok":true}' }]);
  await aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema }, guard,
    { provider: 'openai', model: 'offline-test-model' });
  assert.deepEqual(requests[0].body.response_format, {
    type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: normalizedSchema },
  }, 'OpenAI receives the same strict schema contract');

  run([{ content: '{"ok":true}' }]);
  await aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema }, guard,
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  assert.deepEqual(requests[0].body.response_format, schemas.structuredResponseFormat('gemini', schema), 'Google receives the explicit schema on the real completion transport');

  // A provider refusal is terminal for an opted-in schema request, even when noRetry is
  // false. No plain-body request may be dispatched after it.
  run([{ status: 400, error: 'Unknown field response_format' }, { content: '{"ok":true}' }]);
  await assert.rejects(() => aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema, noRetry: false }, guard, openrouter));
  assert.equal(requests.length, 1, 'schema refusal never dispatches a downgraded retry');
  assert.equal(requests[0].body.response_format.json_schema.strict, true);

  // The historical JSON contract still sends json_object when no native schema is opted in.
  run([{ content: '{"ok":true}' }]);
  assert.deepEqual(await aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128 }, guard, openrouter), { ok: true });
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });

  // A cached refusal of the legacy optional body must not strip an explicitly required schema.
  optionalFields.rememberOptionalBodyUnsupported(openrouter);
  run([{ content: '{"ok":true}' }]);
  await aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema }, guard, openrouter);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.response_format.json_schema.name, schema.name);

  // The structured-answer path carries bounded validator diagnostics into its one
  // existing retry. This uses real completeJson/custom-provider transport; only the
  // loopback response is synthetic, so it verifies feedback routing, not model quality.
  const structuredAnswers = require(path.join(repo, 'electron/ai/researchStructuredAnswer.ts'));
  const researchModel = { provider: 'custom', model: 'offline-test-model' };
  const dateQuestion = 'Identifica por separado los años de apertura de la biblioteca y del laboratorio de Puerto Claro.';
  const dateSources = [{ id: 'fixture:dates:0', label: 'fixture 01', citation: 'nodus://passage/fixture%3Adates%3A0',
    text: 'Source title: fixture 01\nVerbatim excerpt:\nLa escuela de Puerto Claro abrió su biblioteca en 1912. En 1913 abrió el laboratorio; no la biblioteca.' }];
  const invalidDatePlan = { facets: [
    { questionQuote: 'años de apertura de la biblioteca', evidence: [{ sourceId: dateSources[0].id, quote: 'abrió su biblioteca en 1912' }] },
    { questionQuote: 'años de apertura del laboratorio de Puerto Claro', evidence: [{ sourceId: dateSources[0].id, quote: 'En 1913 abrió el laboratorio' }] },
  ], format: 'prose' };
  const validDatePlan = { ...invalidDatePlan, facets: [invalidDatePlan.facets[0],
    { ...invalidDatePlan.facets[1], questionQuote: 'del laboratorio de Puerto Claro' }] };
  const response = content => ({ content: JSON.stringify(content) });
  const requestUser = index => JSON.parse(requests[index].body.messages.find(message => message.role === 'user').content);

  run([response(invalidDatePlan), response(validDatePlan)]);
  const recoveredPlan = await structuredAnswers.planStructuredResearchAnswer(dateQuestion, dateSources, researchModel);
  assert.equal(requests.length, 2, 'one invalid schema response uses only the existing bounded retry');
  assert.equal(recoveredPlan.facets[1].questionQuote, 'del laboratorio de Puerto Claro', 'the exact returned quote is validated and retained');
  const retryBody = requestUser(1);
  assert.deepEqual(retryBody.schemaValidationIssues, [{ path: 'facets[1].questionQuote', code: 'question_quote',
    message: 'Facet must quote a bounded literal span of the user question.' }],
  'retry includes the exact application validator diagnostic without echoing raw completion data');
  assert.match(retryBody.schemaCorrection, /literal-span, authorized-source, and evidence constraints/u);
  assert.equal(JSON.stringify(retryBody.schemaValidationIssues).includes('años de apertura del laboratorio de Puerto Claro'), false);

  run([response(validDatePlan)]);
  await structuredAnswers.planStructuredResearchAnswer(dateQuestion, dateSources, researchModel);
  assert.equal(requests.length, 1, 'valid first response causes no diagnostic retry');

  run([{ content: 'not JSON' }, response(validDatePlan)]);
  await structuredAnswers.planStructuredResearchAnswer(dateQuestion, dateSources, researchModel);
  assert.equal(requests.length, 2, 'invalid JSON retains the existing single retry');
  assert.equal(requestUser(1).schemaValidationIssues, undefined, 'parse failure does not fabricate validator diagnostics');
  assert.match(requestUser(1).schemaCorrection, /previous response failed validation/u);

  run([response(invalidDatePlan), response(invalidDatePlan)]);
  await assert.rejects(() => structuredAnswers.planStructuredResearchAnswer(dateQuestion, dateSources, researchModel));
  assert.equal(requests.length, 2, 'repeated validation failure remains closed after exactly one retry');

  run([{ status: 401, error: 'unauthorized test fixture' }, response(validDatePlan)]);
  await assert.rejects(() => structuredAnswers.planStructuredResearchAnswer(dateQuestion, dateSources, researchModel));
  assert.equal(requests.length, 1, 'transport/auth failure is terminal and never receives schema retry');

  // Unsupported providers fail before dispatch instead of receiving a weaker request.
  run([{ content: '{"ok":true}' }]);
  await assert.rejects(() => aiClient.completeJson({ system: 's', user: 'u', maxTokens: 128, responseSchema: schema }, guard,
    { provider: 'custom', model: 'offline-test-model' }), error => error.code === 'bad_request' && /schema is unavailable/u.test(error.message));
  assert.equal(requests.length, 0, 'unsupported provider is rejected without a body that implies native schema support');

  // Null normalization remains a narrow transport representation adaptation.
  assert.deepEqual(schemas.normalizeResearchPlanSchemaValue({ facets: [], format: 'prose', formatQuestionQuote: null }), { facets: [], format: 'prose' });
  assert.deepEqual(schemas.normalizeResearchWriterSchemaValue({ answers: [], tables: null }), { answers: [] });
  console.log('Research answer schema transport: strict request, terminal 400, cached-refusal bypass, OpenRouter routing, legacy JSON mode, and shared bounds passed.');
} finally {
  try { closeDb(); } catch { /* database may not have opened */ }
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
