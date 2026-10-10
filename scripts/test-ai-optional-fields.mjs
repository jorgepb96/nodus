// A custom gateway that refuses the optional request body must not make the scan fail.
//
// Nodus layers fields onto the plain OpenAI contract that a gateway may not know:
// `response_format` on every JSON call, and `reasoning_effort` on a background scan of a
// thinking model. Two decisions keep that safe:
//   · a rejection that NAMES an optional field is replayed without the optional body
//     (the pre-existing behaviour, for any provider);
//   · a 400/422 from a custom gateway that names nothing is replayed too — a proxy in front
//     of the real API often answers a bare "Bad Request". This used to require that Nodus had
//     sent the reasoning hint, which left `response_format`, carried by every JSON call, with
//     no recovery at all: one request and the whole library ended on a bare 400 (issue #802).
//     The ladder itself, and what it may drop, is exercised end to end by
//     scripts/test-custom-gateway-recovery.mjs.
//
// A 400/422 is a refusal, not a generation, so replays cannot double-charge.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-optional-fields-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { rejectsOptionalBodyWithoutNaming, rejectsOptionalTransportField, rejectsTemperatureParameter, shouldRetryWithoutOptionalFields } = load('electron/ai/providerErrors.ts');

/** A provider HTTP failure with the shape the OpenAI SDK throws. */
const failure = (status, message) => Object.assign(new Error(message), { status, error: { message } });

test('a rejection that names an optional field is always replayable', () => {
  assert.equal(rejectsOptionalTransportField(failure(400, 'Unsupported parameter: reasoning_effort')), true);
  assert.equal(rejectsOptionalTransportField(failure(400, 'Unknown field response_format')), true);
  assert.equal(rejectsOptionalTransportField(failure(400, 'Invalid parameter: provider.only')), true);
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Unsupported parameter: reasoning_effort')), true, 'no options needed');
});

test('a named rejection is only a 400; other statuses keep their meaning', () => {
  assert.equal(rejectsOptionalTransportField(failure(422, 'Unknown field response_format')), false);
  assert.equal(rejectsOptionalTransportField(failure(500, 'Unsupported parameter: reasoning_effort')), false);
  assert.equal(rejectsOptionalTransportField(failure(429, 'Invalid parameter: reasoning_effort')), false);
  assert.equal(rejectsOptionalTransportField(new Error('socket hang up')), false);
});

test('an unnamed custom rejection is replayable, whatever Nodus had added', () => {
  // The exact shape a proxy returns for a field it does not know: no field named.
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'custom' }), true);
  assert.equal(shouldRetryWithoutOptionalFields(failure(422, 'Unprocessable Entity'), { provider: 'custom' }), true);
  // It no longer matters which optional field had been sent: every JSON call carries
  // `response_format`, and a gateway that refuses it deserves the same replay as one that
  // refuses the reasoning hint.
  assert.equal(rejectsOptionalBodyWithoutNaming(failure(400, 'Bad Request')), true);
  assert.equal(rejectsOptionalBodyWithoutNaming(failure(422, 'Unprocessable Entity')), true);
});

test('the unnamed fallback stays narrow: custom only, 400/422 only', () => {
  assert.equal(shouldRetryWithoutOptionalFields(failure(400, 'Bad Request'), { provider: 'openai' }), false, 'only a custom gateway is unknown');
  assert.equal(shouldRetryWithoutOptionalFields(failure(422, 'Bad Request'), { provider: 'openrouter' }), false);
  assert.equal(shouldRetryWithoutOptionalFields(failure(500, 'Bad Request'), { provider: 'custom' }), false, 'a 5xx did not refuse the request');
  assert.equal(shouldRetryWithoutOptionalFields(failure(429, 'Too Many Requests'), { provider: 'custom' }), false);
  assert.equal(shouldRetryWithoutOptionalFields(new Error('Connection error.'), { provider: 'custom' }), false, 'transport failures belong to the retry layer');
  // A refusal that names the field stays a naming decision: only the unnamed case is the
  // one where the ladder has to guess which field to drop.
  assert.equal(rejectsOptionalBodyWithoutNaming(failure(400, 'Unknown field response_format')), false);
  assert.equal(rejectsOptionalBodyWithoutNaming(failure(400, 'Unsupported parameter: reasoning_effort')), false);
  assert.equal(rejectsOptionalBodyWithoutNaming(failure(500, 'Bad Request')), false);
  assert.equal(rejectsOptionalBodyWithoutNaming(new Error('socket hang up')), false);
});

test('a 400 that names `temperature` as deprecated is recoverable, and nothing else is', () => {
  // Every shape a provider has used for this refusal, in both word orders.
  assert.equal(rejectsTemperatureParameter(failure(400, "Unsupported value: 'temperature' does not support 0.15 with this model")), true);
  assert.equal(rejectsTemperatureParameter(failure(400, 'temperature is deprecated for this model')), true);
  assert.equal(rejectsTemperatureParameter(failure(400, 'The parameter temperature is not supported by this model')), true);
  assert.equal(rejectsTemperatureParameter(failure(400, 'temperature is not allowed for reasoning models')), true);
  assert.equal(rejectsTemperatureParameter(failure(400, 'Invalid parameter: temperature')), true);
  // Strict on purpose: a refusal that does not name the field is never replayed, and a
  // refusal is a 400 — a 5xx or a 429 is a different failure with its own retry layer.
  assert.equal(rejectsTemperatureParameter(failure(400, 'Bad Request')), false, 'an unnamed refusal must not be replayed');
  assert.equal(rejectsTemperatureParameter(failure(400, 'context length exceeded')), false);
  assert.equal(rejectsTemperatureParameter(failure(422, 'temperature is deprecated')), false);
  assert.equal(rejectsTemperatureParameter(failure(500, 'temperature is deprecated')), false);
  assert.equal(rejectsTemperatureParameter(new Error('socket hang up')), false);
});

test('both transports drop the knob on that signal and keep the rest of the request', () => {
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  const go = readFileSync(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'), 'utf8');
  const recovery = readFileSync(path.join(repoRoot, 'electron/ai/thinkingCompatibility.ts'), 'utf8');
  // All transports share the same bounded correction and session memory.
  assert.match(source, /import \{ temperatureUnsupported \} from '\.\/samplingSupport';/);
  assert.match(go, /import \{ temperatureUnsupported \} from '\.\/samplingSupport';/);
  assert.equal((source.match(/withThinkingCompatibility\(model,/g) ?? []).length, 4);
  assert.match(go, /withThinkingCompatibility\(\{ provider: 'opencode-go', model \}/);
  assert.match(recovery, /!temperatureRecovered && 'temperature' in request && rejectsTemperatureParameter\(error\)/);
  assert.match(recovery, /rememberTemperatureUnsupported\(model\);/);
  assert.match(go, /if \(temperatureUnsupported\(ref\)\) return \{\};/);
});

test('native and compatible transports share thinking recovery', () => {
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  const go = readFileSync(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'), 'utf8');
  assert.equal((source.match(/withThinkingCompatibility\(model,/g) ?? []).length, 4);
  assert.match(go, /withThinkingCompatibility\(\{ provider: 'opencode-go', model \}/);
});

test('a streamed answer cut at the output ceiling is reported, not stored', () => {
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  const options = readFileSync(path.join(repoRoot, 'shared/researchOutputBudget.ts'), 'utf8');
  const consumer = readFileSync(path.join(repoRoot, 'electron/ai/thinkingEffort.ts'), 'utf8');
  assert.match(consumer, /import \{thinkingOutputAllowance\} from '@shared\/researchOutputBudget'/);
  assert.match(consumer, /maxTokens: .*thinkingOutputAllowance\(model, job\.effort, job\.info\)/);
  // The Anthropic stream reads the only truncation signal it has — `stop_reason` on the final
  // `message_delta`, plus the thinking-token breakdown — and refuses to store the fragment.
  assert.match(source, /stopReason = event\.delta\.stop_reason/);
  assert.match(source, /event\.usage\?\.output_tokens_details/);
  assert.match(source, /if \(stopReason === 'max_tokens'\) \{/);
  assert.match(source, /truncatedOutputMessage\(model, opts\.maxTokens \?\? 8000\), false, false, 'output_truncated'/);
  // A safety refusal returns no text and its own stop reason, so it must be named, not read
  // as an empty response — on both the streaming and the non-streaming Anthropic path.
  assert.equal((source.match(/El modelo se negó a responder a esta solicitud\./g) ?? []).length, 4);
  assert.match(source, /if \(stopReason === 'refusal'\) \{/);
  assert.match(source, /\(res as any\)\.stop_reason === 'refusal'/);
  // The OpenAI-compatible stream has the same gap, keyed off `finish_reason`.
  assert.match(source, /finishReason = choice\.finish_reason/);
  assert.match(source, /test\(finishReason \?\? ''\)/);
  assert.match(source, /truncatedOutputMessage\(model, maxTokens\), false, false, 'output_truncated'/);
  // Adaptive models cannot disable thinking and its tokens count against `max_tokens`, so the
  // request reserves the documented depth instead of the manual `budget_tokens` allowance.
  assert.match(options, /const ADAPTIVE_THINKING_ALLOWANCE/);
  assert.match(options, /profile\.mode === 'anthropic-adaptive'/);
  assert.match(options, /ADAPTIVE_THINKING_ALLOWANCE\[native \?\? 'none'\] \?\? researchThinkingAllowance\(native\)/);
});

test('the transport recovers by dropping only the reasoning field, keeping JSON mode', () => {
  const source = readFileSync(path.join(repoRoot, 'electron/ai/aiClient.ts'), 'utf8');
  // The predicates are imported, not reimplemented locally.
  assert.match(source, /import \{ classifyProviderError, isTransientNetworkFailure, rejectsOptionalBodyWithoutNaming, rejectsOptionalTransportField, shouldRetryWithoutOptionalFields \} from '\.\/providerErrors';/);
  assert.doesNotMatch(source, /^function rejectsOptionalTransportField/m);
  // Both the non-streaming and the streaming transport mark whether the field was sent…
  assert.equal((source.match(/const sentReasoning = \(extras as any\)\.reasoning_effort !== undefined;/g) ?? []).length, 2);
  // …and both resolve the refusal through the one ladder, so a gateway is answered the same
  // way whichever transport reached it.
  assert.equal((source.match(/replayRefusedOptionalFields\(model, extras, e, sentReasoning, replay(?:Body|Stream)\)/g) ?? []).length, 2);
  assert.equal((source.match(/retryOptionalBody\(model, extras, error, sentReasoning\)/g) ?? []).length, 1);
  assert.match(source, /if \(sentReasoning && !rejectsOptionalTransportField\(error\)\) \{/);
  assert.match(source, /delete rest\.reasoning_effort;/);
  // The last rung is the plain OpenAI body, and it is only reached when the smaller body was
  // refused too — so JSON mode is given up last, never first.
  assert.match(source, /if \(sentReasoning && model\.provider === 'custom' && rejectsOptionalBodyWithoutNaming\(error\) && Object\.keys\(minimal\)\.length > 0\) \{\n\s*return \[minimal, \{\}\];/);
});
