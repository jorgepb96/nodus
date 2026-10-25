import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { researchOpenAiModels } from './fixtures/research-openai-models.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'research-reasoning-'));
await build({ entryPoints: ['shared/researchReasoning.ts'], outfile: path.join(dir, 'reasoning.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { researchReasoningProfile: profile, researchEffortChoices: choices, researchReasoningBody: body, resolveResearchEffort: resolve, researchOmitsTemperature: omit, researchAdvertisedEfforts: advertised, researchSemanticValidationEffort: semanticEffort, researchProofValidationEffort: proofEffort } = await import(pathToFileURL(path.join(dir, 'reasoning.mjs')));
const ref = (provider, model) => ({ provider, model });
const request = (provider, model, effort = 'standard', info) => body(ref(provider, model), effort, 16000, info);
test.after(() => rm(dir, { recursive: true, force: true }));

for (const { model, levels } of researchOpenAiModels) {
  test(`${model}: every selectable effort matches its API contract`, () => {
    const p = profile(ref('openai', model));
    assert.deepEqual(p.levels, levels);
    assert.deepEqual(choices(p), levels);
    for (const [index, effort] of choices(p).entries()) {
      assert.equal(request('openai', model, effort).reasoning_effort, levels[index]);
    }
    for (const stale of ['ultra', 'off', 'none', 'invalid', undefined]) {
      assert.equal(resolve(p, stale), levels[0], 'unsupported saved choices fall back to Standard');
    }
  });
}

test('OpenAI floors and upper levels match each model family', () => {
  for (const [model, floor] of [['gpt-4.1', undefined], ['gpt-5', 'minimal'], ['gpt-5-mini', 'minimal'], ['o3', 'low'], ['gpt-5.1', 'none'], ['gpt-5.4', 'none'], ['gpt-5.5', 'none'], ['gpt-5.6-sol', 'none'], ['gpt-6-astra', 'low'], ['gpt-5-pro', 'high'], ['gpt-5.3-codex', 'low']]) {
    assert.equal(request('openai', model).reasoning_effort, floor, model);
  }
  assert.equal(request('openai', 'gpt-5.6-sol', 'max').reasoning_effort, 'max');
  assert.equal(request('openai', 'gpt-5.4', 'xhigh').reasoning_effort, 'xhigh');
  assert.equal(omit(ref('openai', 'gpt-5.4'), 'high'), true);
  assert.equal(omit(ref('openai', 'gpt-5.4'), 'standard'), false);
});
test('Gemini minimum is explicit; Pro never gets a disabling value', () => {
  const config = (model, effort) => request('gemini', model, effort).extra_body.google.thinking_config;
  assert.deepEqual(config('gemini-2.5-flash'), { thinking_budget: 0 });
  assert.deepEqual(config('gemini-2.5-pro'), { thinking_budget: 1024 });
  assert.deepEqual(config('gemini-3-pro-preview'), { thinking_level: 'low' });
  assert.deepEqual(choices(profile(ref('gemini', 'gemini-3-pro-preview'))), ['low', 'high']);
  assert.deepEqual(config('gemini-3-flash-preview'), { thinking_level: 'minimal' });
  assert.deepEqual(config('gemini-3.8-flash'), { thinking_level: 'low' });
  assert.deepEqual(config('gemini-3.1-pro-preview', 'medium'), { thinking_level: 'medium' });
});
test('Claude uses manual budgets or adaptive thinking with legal effort values', () => {
  assert.deepEqual(request('anthropic', 'claude-sonnet-4-5'), { thinking: { type: 'disabled' } });
  assert.deepEqual(request('anthropic', 'claude-sonnet-4-5', 'high'), { thinking: { type: 'enabled', budget_tokens: 8192 } });
  assert.deepEqual(request('anthropic', 'claude-opus-4-6', 'max'), { thinking: { type: 'adaptive' }, output_config: { effort: 'max' } });
  assert.equal(choices(profile(ref('anthropic', 'claude-opus-4-6'))).includes('xhigh'), false);
  assert.equal(request('anthropic', 'claude-opus-4-7', 'xhigh').output_config.effort, 'xhigh');
  assert.deepEqual(request('anthropic', 'claude-mythos-5'), { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
  assert.equal(omit(ref('anthropic', 'claude-sonnet-4-5'), 'high'), true);
});
test('DeepSeek, MiMo and hosted open models expose real levels, including toggles', () => {
  assert.deepEqual(request('deepseek', 'deepseek-v4-flash'), { thinking: { type: 'disabled' } });
  assert.deepEqual(request('deepseek', 'deepseek-v4-pro', 'max'), { thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  assert.deepEqual(choices(profile(ref('deepseek', 'deepseek-v4-pro'))), ['none', 'low', 'high', 'max']);
  // The unversioned ids are the same served model and must get the same toggle/budget.
  assert.deepEqual(request('deepseek', 'deepseek-flash'), { thinking: { type: 'disabled' } });
  assert.deepEqual(request('deepseek', 'deepseek-pro', 'max'), { thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  assert.deepEqual(choices(profile(ref('deepseek', 'deepseek-flash'))), ['none', 'low', 'high', 'max']);
  // The live native catalogue serves exactly these two ids; a served model must never fall
  // back to "no control published", which is what the `/v4/`-only match did to the new one.
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    assert.ok(choices(profile(ref('deepseek', model))).length > 1, `${model} publishes an effort control`);
  }
  assert.deepEqual(request('xiaomi', 'mimo-v2.5', 'on'), { thinking: { type: 'enabled' } });
  for (const provider of ['groq', 'cerebras']) {
    assert.equal(request(provider, 'openai/gpt-oss-120b').reasoning_effort, 'low');
    assert.equal(request(provider, 'openai/gpt-oss-120b', 'high').reasoning_effort, 'high');
  }
  assert.equal(request('cerebras', 'qwen-3.8-27b').reasoning_effort, 'none');
  assert.deepEqual(request('cerebras', 'kimi-k2.7-code', 'high'), {});
});
test('the OpenCode Go route gives the unversioned DeepSeek ids the same levels as the pinned ones', () => {
  // The Go catalogue lists `deepseek-flash` next to `deepseek-v4-flash`. Matching only
  // `/^deepseek-v4/` left the unversioned id with no slider and no reasoning field at all,
  // while the model itself reasons by default.
  assert.deepEqual(request('opencode-go', 'deepseek-flash'), { reasoning_effort: 'low' });
  assert.deepEqual(request('opencode-go', 'deepseek-flash', 'max'), { reasoning_effort: 'max' });
  // Legacy Standard remains the floor on this route; native choices keep their names.
  assert.deepEqual(choices(profile(ref('opencode-go', 'deepseek-flash'))), ['low', 'high', 'max']);
  assert.deepEqual(profile(ref('opencode-go', 'deepseek-pro')).levels, profile(ref('opencode-go', 'deepseek-v4-flash')).levels);
  assert.deepEqual(choices(profile(ref('opencode-go', 'deepseek-flash'))), choices(profile(ref('opencode-go', 'deepseek-v4-flash'))));
  // The pinned sibling keeps its contract, and the two routes stay distinct: the Go route
  // speaks levels, the native one speaks the explicit thinking toggle.
  assert.deepEqual(request('opencode-go', 'deepseek-v4-flash', 'high'), { reasoning_effort: 'high' });
  assert.deepEqual(request('deepseek', 'deepseek-flash', 'high'), { thinking: { type: 'enabled' }, reasoning_effort: 'high' });
});

test('subscription and LM Studio catalogues preserve the provider display order', () => {
  const info = { id: 'model', supportedReasoningEfforts: ['xhigh', 'low', 'high', 'medium'].map(reasoningEffort => ({ reasoningEffort, description: '' })) };
  for (const provider of ['codex', 'github-copilot']) {
    const p = profile(ref(provider, 'model'), info);
    assert.equal(resolve(p, 'standard'), 'low');
    assert.deepEqual(choices(p), ['xhigh', 'low', 'high', 'medium']);
    assert.equal(resolve(p, 'ultra'), 'low');
  }
  const local = { id: 'model', researchReasoningLevels: ['on', 'off'] };
  assert.deepEqual(request('lmstudio', 'model', 'standard', local), { reasoning: 'off' });
  assert.deepEqual(request('lmstudio', 'model', 'on', local), { reasoning: 'on' });
  assert.deepEqual(request('ollama', 'gpt-oss:20b'), { think: 'low' });
  assert.deepEqual(request('ollama', 'qwen3:8b', 'on'), { think: true });
});
test('OpenRouter obeys native floors and rejects invalid choices without escalating', () => {
  assert.deepEqual(request('openrouter', 'openai/gpt-5.4'), { reasoning: { enabled: false } });
  assert.deepEqual(request('openrouter', 'google/gemini-3.1-pro-preview'), { reasoning: { effort: 'low' } });
  assert.deepEqual(request('openrouter', 'z-ai/glm-5.3-flash'), { reasoning: { effort: 'low' } });
  assert.deepEqual(request('openrouter', 'unknown/model', 'high', { id: 'unknown/model', reasoning: false }), {});
  assert.equal(request('openai', 'gpt-5.4', 'bogus').reasoning_effort, 'none');
  assert.deepEqual(request('custom', 'unknown', 'high'), {});
});

test('local native streaming and non-streaming preserve chosen controls and reject silent fallback', async () => {
  await build({ entryPoints: ['electron/ai/localNativeCompletion.ts'], outfile: path.join(dir, 'native.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const { completeLocalNative, streamLocalNative } = await import(pathToFileURL(path.join(dir, 'native.mjs')));
  const original = globalThis.fetch;
  const seen = [];
  let reject = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); seen.push(body);
    if (reject) return new Response(JSON.stringify({ error: 'reasoning unsupported' }), { status: 400 });
    if (body.stream && body.messages) return new Response(JSON.stringify({ message: { content: 'Answer' }, done: true })+'\n');
    if (body.stream) return new Response('event: message.delta\ndata: {"type":"message.delta","content":"Answer"}\n\nevent: chat.end\ndata: {"type":"chat.end"}\n\n');
    return new Response(JSON.stringify(body.messages ? { message: { content: 'Answer' } } : { output: [{ type: 'message', content: 'Answer' }] }));
  };
  try {
    for (const provider of ['ollama', 'lmstudio']) {
      const options = { provider, baseUrl: 'http://local.test', key: null, model: 'test', system: 'S', user: 'U', temperature: .2, contextTokens: 8192, outputTokens: 2048, jsonMode: false, timeoutMs: 1000,
        researchBody: provider === 'ollama' ? { think: 'high' } : { reasoning: 'high' } };
      for (const stream of [false, true]) {
        if (stream) await streamLocalNative(options, () => {}); else await completeLocalNative(options);
        assert.equal(seen.at(-1)[provider === 'ollama' ? 'think' : 'reasoning'], 'high');
      }
      reject = true;
      const count = seen.length;
      await assert.rejects(() => completeLocalNative(options), /reasoning/);
      assert.equal(seen.length, count + 1, 'explicit control is never silently stripped');
      reject = false;
    }
  } finally { globalThis.fetch = original; }
});

test('OpenCode Go carries thinking through all three protocols', async () => {
  await build({ entryPoints: ['electron/ai/openCodeGoCompletion.ts'], outfile: path.join(dir, 'go.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const { completeWithOpenCodeGo } = await import(pathToFileURL(path.join(dir, 'go.mjs')));
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(String(url).endsWith('/responses') ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }] }
      : String(url).endsWith('/messages') ? { content: [{ type: 'text', text: 'Answer' }] } : { choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }] }));
  };
  try {
    const run = (model, researchEffort) => completeWithOpenCodeGo({ apiKey: 'test', baseUrl: 'http://go.test', model, researchEffort, system: 'S', user: 'U', reasoning: 'off' });
    await run('deepseek-v4-pro', 'max'); assert.equal(seen.at(-1).body.reasoning_effort, 'max');
    await run('qwen3.8', 'on'); assert.deepEqual(seen.at(-1).body.thinking, { type: 'enabled' });
    await run('qwen3.8', 'standard'); assert.deepEqual(seen.at(-1).body.thinking, { type: 'disabled' });
    await run('gpt-5.6-sol', 'max'); assert.deepEqual(seen.at(-1).body.reasoning, { effort: 'max' });
    await run('gpt-5.6-sol', 'standard'); assert.deepEqual(seen.at(-1).body.reasoning, { effort: 'none' });
  } finally { globalThis.fetch = original; }
});


test('picker choices require exact provider metadata; no Standard or inferred levels', () => {
  for (const info of [undefined, { id: 'deepseek-flash' }, { id: 'gpt-5.4', reasoning: true }, { id: 'unknown', supported_parameters: ['reasoning'] }]) {
    assert.deepEqual(advertised(info), []);
  }
  const info = { id: 'deepseek-flash', researchReasoningLevels: ['low', 'high', 'max'] };
  assert.deepEqual(advertised(info), ['low', 'high', 'max']);
  for (const effort of advertised(info)) assert.deepEqual(request('deepseek', info.id, effort, info), { thinking: { type: 'enabled' }, reasoning_effort: effort });
  assert.deepEqual(request('deepseek', info.id, 'standard', info), { thinking: { type: 'disabled' } }, 'internal bounded validators retain their legacy budget');
  assert.deepEqual(advertised({ id: 'new', researchReasoningLevels: ['high', 'low', 'high', 'standard', 'turbo', null] }), ['high', 'low']);
  assert.deepEqual(request('custom', 'new-model', 'medium', { id: 'new-model', researchReasoningLevels: ['low', 'medium'] }), { reasoning_effort: 'medium' }, 'a new model can publish its own levels');
});


test('native metadata can add transport levels without changing legacy validators', () => {
  const info = { id: 'deepseek/deepseek-v4-flash', researchReasoningLevels: ['high', 'xhigh'] };
  assert.deepEqual(request('openrouter', info.id, 'xhigh', info), { reasoning: { effort: 'xhigh' } });
  const claude = { id: 'claude-next', researchReasoningLevels: ['low', 'medium', 'high'] };
  assert.deepEqual(request('anthropic', claude.id, 'medium', claude), { output_config: { effort: 'medium' } });
});


test('semantic review uses bounded native reasoning and preserves explicit off choices', () => {
  const deepseek = profile(ref('deepseek', 'deepseek-flash'));
  for (const requested of ['standard', 'low', 'high', 'max']) assert.equal(semanticEffort(deepseek, requested), 'low');
  assert.equal(semanticEffort(deepseek, 'none'), 'none');
  assert.equal(semanticEffort(profile(ref('lmstudio', 'local'), { id: 'local', researchReasoningLevels: ['off', 'on'] }), 'off'), 'off');
  assert.equal(semanticEffort(profile(ref('openai', 'gpt-5')), 'high'), 'minimal');
  assert.equal(semanticEffort(profile(ref('custom', 'unknown')), 'standard'), 'standard');
  assert.equal(resolve(deepseek, 'standard'), 'none', 'Legacy validators retain their existing policy');
});

test('ordinary proof checks avoid implicit thinking while the semantic veto retains reasoning', () => {
  const deepseek = profile(ref('deepseek', 'deepseek-flash'));
  assert.equal(proofEffort(deepseek, 'standard'), 'none');
  assert.equal(semanticEffort(deepseek, 'standard'), 'low');
  assert.equal(proofEffort(deepseek, 'off'), 'none');
  assert.equal(proofEffort(deepseek, 'high'), 'low');
  const fixed = profile(ref('openai', 'o3-pro'));
  assert.equal(proofEffort(fixed, 'standard'), 'high', 'Do not invent an off level for models that cannot disable reasoning');
});

test('fast proofs use the actual legacy transport even when the picker omits off', () => {
  const refValue = ref('deepseek', 'deepseek-flash');
  const info = { id: refValue.model, researchReasoningLevels: ['low', 'high', 'max'] };
  assert.equal(proofEffort(profile(refValue, info), 'standard'), 'none');
  assert.equal(proofEffort(profile(refValue, { ...info, reasoningMandatory: true }), 'standard'), 'low');
});
