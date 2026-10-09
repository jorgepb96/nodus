// GENERATED — do not edit.
//
// Built from shared/ by scripts/build-server-shared.mjs so the server can print the same
// document the desktop does without taking on a dependency or a build step. Edit the
// TypeScript and run `npm run build:server-shared`; scripts/test-server-generated.mjs
// fails if this file and that source disagree.
// shared/providerContextWindows.ts
var DOCUMENTED = {
  // https://api-docs.deepseek.com/quick_start/pricing/
  // The retired Flash IDs are still accepted and route to the current Flash model.
  deepseek: {
    "deepseek-flash": 1e6,
    "deepseek-v4-flash": 1e6,
    "deepseek-v4-flash-vision-exp": 1e6,
    "deepseek-v4-pro": 1e6
  },
  // https://platform.claude.com/docs/en/models/overview
  // Legacy Opus 4.6-4.8, Sonnet 4.6 and Opus/Sonnet 5: their individual overview pages. Without
  // an entry a model falls back to the unknown default of 32,768, which on a 1M model reserved
  // more than the window for the prompt alone and left no evidence allowance.
  anthropic: {
    "claude-fable-5-1": 1e6,
    "claude-opus-5-5": 1e6,
    "claude-sonnet-5-5": 1e6,
    "claude-opus-5": 1e6,
    "claude-sonnet-5": 1e6,
    "claude-opus-4-8": 1e6,
    "claude-opus-4-7": 1e6,
    "claude-opus-4-6": 1e6,
    "claude-sonnet-4-6": 1e6,
    "claude-haiku-4-5": 2e5,
    "claude-haiku-4-5-20251001": 2e5
  },
  // Each model's context and exact snapshots:
  // https://developers.openai.com/api/docs/models/{model-id}
  // No family/prefix matching: unknown snapshots and fine-tunes stay unknown.
  openai: {
    "gpt-6.1-sol": 105e4,
    "gpt-6-astra": 105e4,
    "gpt-6-sol": 105e4,
    "gpt-6-luna": 105e4,
    "gpt-5.6-sol": 105e4,
    "gpt-5.6-terra": 105e4,
    "gpt-5.6-luna": 105e4,
    "gpt-5.5": 105e4,
    "gpt-5.5-2026-04-23": 105e4,
    "gpt-5.5-pro": 105e4,
    "gpt-5.5-pro-2026-04-23": 105e4,
    "gpt-5.4": 105e4,
    "gpt-5.4-2026-03-05": 105e4,
    "gpt-5.4-mini": 4e5,
    "gpt-5.4-mini-2026-03-17": 4e5,
    "gpt-5.4-nano": 4e5,
    "gpt-5.4-nano-2026-03-17": 4e5,
    "gpt-5.4-pro": 105e4,
    "gpt-5.4-pro-2026-03-05": 105e4,
    "gpt-5.2": 4e5,
    "gpt-5.2-2025-12-11": 4e5,
    "gpt-5.1": 4e5,
    "gpt-5.1-2025-11-13": 4e5,
    "gpt-5": 4e5,
    "gpt-5-2025-08-07": 4e5,
    "gpt-5-mini": 4e5,
    "gpt-5-mini-2025-08-07": 4e5,
    "gpt-5-nano": 4e5,
    "gpt-5-nano-2025-08-07": 4e5,
    "gpt-4.1": 1047576,
    "gpt-4.1-2025-04-14": 1047576,
    "gpt-4.1-mini": 1047576,
    "gpt-4.1-mini-2025-04-14": 1047576,
    "gpt-4.1-nano": 1047576,
    "gpt-4.1-nano-2025-04-14": 1047576,
    "gpt-4o": 128e3,
    "gpt-4o-2024-11-20": 128e3,
    "gpt-4o-2024-08-06": 128e3,
    "gpt-4o-2024-05-13": 128e3,
    "gpt-4o-mini": 128e3,
    "gpt-4o-mini-2024-07-18": 128e3,
    "o3": 2e5,
    "o3-2025-04-16": 2e5,
    "o3-mini": 2e5,
    "o3-mini-2025-01-31": 2e5,
    "o4-mini": 2e5,
    "o4-mini-2025-04-16": 2e5,
    "o1": 2e5,
    "o1-2024-12-17": 2e5,
    "gpt-5.6": 105e4
  },
  // https://mimo.mi.com/docs/en-US/quick-start/model
  xiaomi: {
    "mimo-v2.6-pro": 1e6,
    "mimo-v2.6-flash": 1e6,
    "mimo-v2.6-pro-ultraspeed": 1e6,
    "mimo-v2.5": 1e6,
    "mimo-v2.5-pro": 1e6
  },
  // OpenCode's own provider-scoped registry: https://models.dev/api.json
  // https://opencode.ai/docs/models documents its use. Where a separate input
  // ceiling is published, use the smaller limit as a conservative envelope.
  "opencode-go": {
    "mimo-v2.6-pro": 1048576,
    "qwen3.7-max": 1e6,
    "mimo-v2.5": 1e6,
    "grok-4.7": 5e5,
    "longcat-2.5-preview-free": 1e6,
    "glm-5.3-flash": 1e6,
    "qwen3.8-max": 1e6,
    "kimi-k3": 1048576,
    "deepseek-v4.1-flash": 1e6,
    "deepseek-v4-flash-vision-exp": 1e6,
    "kimi-k2.6": 262144,
    "longcat-2.0": 1e6,
    "grok-4.5": 5e5,
    "minimax-m2.7": 204800,
    "space-bunny-free": 524288,
    "mimo-v2.5-pro": 1048576,
    "mimo-v2.6-flash": 1048576,
    "minimax-m3": 1e6,
    "gpt-5.6-luna": 922e3,
    "qwen3.8-flash": 1e6,
    "glm-5.2": 1e6,
    "hy3": 192e3,
    "muse-spark-1.2-contributor": 1048576,
    "gpt-6-luna": 922e3,
    "deepseek-v4-pro": 1e6,
    "qwen3.6-plus": 1e6,
    "hy4-preview": 1024e3,
    "muse-spark-1.3-contributor": 1048576,
    "glm-5.3": 1e6,
    "kimi-k2.7-code": 262144,
    "grok-4.6": 5e5,
    "qwen3.7-plus": 1e6,
    "deepseek-v4-flash": 1e6
  }
};
var DOCUMENTED_MAX_OUTPUT = {
  // https://developers.openai.com/api/docs/models/gpt-4o
  // The older 2024-05-13 snapshot has a different ceiling; do not match by prefix.
  openai: {
    "gpt-4o": 16384,
    "gpt-4o-2024-08-06": 16384,
    "gpt-4o-2024-11-20": 16384
  },
  // https://platform.claude.com/docs/en/about-claude/models — 128K output across the 4.6+ family.
  // Values this large require a streaming request; a non-streaming call hits the HTTP timeout
  // first. Research Chat streams, so it can use them.
  anthropic: {
    "claude-opus-5-5": 128e3,
    "claude-opus-5": 128e3,
    "claude-opus-4-8": 128e3,
    "claude-opus-4-7": 128e3,
    "claude-opus-4-6": 128e3,
    "claude-sonnet-5-5": 128e3,
    "claude-sonnet-5": 128e3,
    "claude-sonnet-4-6": 128e3
  },
  // https://api-docs.deepseek.com/quick_start/pricing/ — 1M context with a 384K output ceiling.
  // Recorded because an ABSENT ceiling is not neutral: researchAnswerTokens falls back to the flat
  // figure, which pinned every non-Claude provider at 10,000 output tokens however large its
  // window. deepseek-flash was then cut off mid-answer at 18,192 (10,000 + a low reasoning
  // reserve) while holding a million-token context, and the scaling added for Claude never
  // applied to it at all.
  deepseek: {
    "deepseek-flash": 384e3,
    "deepseek-v4-flash": 384e3,
    "deepseek-v4-pro": 384e3,
    "deepseek-pro": 384e3
  }
};
function documentedMaxOutput(provider, model) {
  const byModel = DOCUMENTED_MAX_OUTPUT[provider];
  const value = byModel?.[model];
  return typeof value === "number" && value > 0 ? value : null;
}
function documentedContextWindow(provider, model) {
  const models = Object.hasOwn(DOCUMENTED, provider) ? DOCUMENTED[provider] : void 0;
  if (models && Object.hasOwn(models, model)) return models[model];
  return null;
}
export {
  documentedContextWindow,
  documentedMaxOutput
};
