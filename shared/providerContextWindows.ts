/**
 * Verified request envelopes for catalogues that omit token limits (2026-09-30).
 * Values are scoped to the exact provider and model ID: a gateway may serve the
 * same model with a smaller window. Runtime/advertised metadata takes precedence.
 */
const DOCUMENTED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // https://api-docs.deepseek.com/quick_start/pricing/
  // The retired Flash IDs are still accepted and route to the current Flash model.
  deepseek: {
    'deepseek-flash': 1_000_000,
    'deepseek-v4-flash': 1_000_000,
    'deepseek-v4-flash-vision-exp': 1_000_000,
    'deepseek-v4-pro': 1_000_000,
  },
  // https://platform.claude.com/docs/en/models/overview
  // Legacy Opus 4.6-4.8, Sonnet 4.6 and Opus/Sonnet 5: their individual overview pages. Without
  // an entry a model falls back to the unknown default of 32,768, which on a 1M model reserved
  // more than the window for the prompt alone and left no evidence allowance.
  anthropic: {
    'claude-fable-5-1': 1_000_000,
    'claude-opus-5-5': 1_000_000,
    'claude-sonnet-5-5': 1_000_000,
    'claude-opus-5': 1_000_000,
    'claude-sonnet-5': 1_000_000,
    'claude-opus-4-8': 1_000_000,
    'claude-opus-4-7': 1_000_000,
    'claude-opus-4-6': 1_000_000,
    'claude-sonnet-4-6': 1_000_000,
    'claude-haiku-4-5': 200_000,
    'claude-haiku-4-5-20251001': 200_000,
  },
  // Each model's context and exact snapshots:
  // https://developers.openai.com/api/docs/models/{model-id}
  // No family/prefix matching: unknown snapshots and fine-tunes stay unknown.
  openai: {
    'gpt-6.1-sol': 1_050_000,
    'gpt-6-astra': 1_050_000,
    'gpt-6-sol': 1_050_000,
    'gpt-6-luna': 1_050_000,
    'gpt-5.6-sol': 1_050_000,
    'gpt-5.6-terra': 1_050_000,
    'gpt-5.6-luna': 1_050_000,
    'gpt-5.5': 1_050_000,
    'gpt-5.5-2026-04-23': 1_050_000,
    'gpt-5.5-pro': 1_050_000,
    'gpt-5.5-pro-2026-04-23': 1_050_000,
    'gpt-5.4': 1_050_000,
    'gpt-5.4-2026-03-05': 1_050_000,
    'gpt-5.4-mini': 400_000,
    'gpt-5.4-mini-2026-03-17': 400_000,
    'gpt-5.4-nano': 400_000,
    'gpt-5.4-nano-2026-03-17': 400_000,
    'gpt-5.4-pro': 1_050_000,
    'gpt-5.4-pro-2026-03-05': 1_050_000,
    'gpt-5.2': 400_000,
    'gpt-5.2-2025-12-11': 400_000,
    'gpt-5.1': 400_000,
    'gpt-5.1-2025-11-13': 400_000,
    'gpt-5': 400_000,
    'gpt-5-2025-08-07': 400_000,
    'gpt-5-mini': 400_000,
    'gpt-5-mini-2025-08-07': 400_000,
    'gpt-5-nano': 400_000,
    'gpt-5-nano-2025-08-07': 400_000,
    'gpt-4.1': 1_047_576,
    'gpt-4.1-2025-04-14': 1_047_576,
    'gpt-4.1-mini': 1_047_576,
    'gpt-4.1-mini-2025-04-14': 1_047_576,
    'gpt-4.1-nano': 1_047_576,
    'gpt-4.1-nano-2025-04-14': 1_047_576,
    'gpt-4o': 128_000,
    'gpt-4o-2024-11-20': 128_000,
    'gpt-4o-2024-08-06': 128_000,
    'gpt-4o-2024-05-13': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4o-mini-2024-07-18': 128_000,
    'o3': 200_000,
    'o3-2025-04-16': 200_000,
    'o3-mini': 200_000,
    'o3-mini-2025-01-31': 200_000,
    'o4-mini': 200_000,
    'o4-mini-2025-04-16': 200_000,
    'o1': 200_000,
    'o1-2024-12-17': 200_000,
    'gpt-5.6': 1_050_000,
  },
  // https://mimo.mi.com/docs/en-US/quick-start/model
  xiaomi: {
    'mimo-v2.6-pro': 1_000_000,
    'mimo-v2.6-flash': 1_000_000,
    'mimo-v2.6-pro-ultraspeed': 1_000_000,
    'mimo-v2.5': 1_000_000,
    'mimo-v2.5-pro': 1_000_000,
  },
  // OpenCode's own provider-scoped registry: https://models.dev/api.json
  // https://opencode.ai/docs/models documents its use. Where a separate input
  // ceiling is published, use the smaller limit as a conservative envelope.
  'opencode-go': {
    'mimo-v2.6-pro': 1_048_576,
    'qwen3.7-max': 1_000_000,
    'mimo-v2.5': 1_000_000,
    'grok-4.7': 500_000,
    'longcat-2.5-preview-free': 1_000_000,
    'glm-5.3-flash': 1_000_000,
    'qwen3.8-max': 1_000_000,
    'kimi-k3': 1_048_576,
    'deepseek-v4.1-flash': 1_000_000,
    'deepseek-v4-flash-vision-exp': 1_000_000,
    'kimi-k2.6': 262_144,
    'longcat-2.0': 1_000_000,
    'grok-4.5': 500_000,
    'minimax-m2.7': 204_800,
    'space-bunny-free': 524_288,
    'mimo-v2.5-pro': 1_048_576,
    'mimo-v2.6-flash': 1_048_576,
    'minimax-m3': 1_000_000,
    'gpt-5.6-luna': 922_000,
    'qwen3.8-flash': 1_000_000,
    'glm-5.2': 1_000_000,
    'hy3': 192_000,
    'muse-spark-1.2-contributor': 1_048_576,
    'gpt-6-luna': 922_000,
    'deepseek-v4-pro': 1_000_000,
    'qwen3.6-plus': 1_000_000,
    'hy4-preview': 1_024_000,
    'muse-spark-1.3-contributor': 1_048_576,
    'glm-5.3': 1_000_000,
    'kimi-k2.7-code': 262_144,
    'grok-4.6': 500_000,
    'qwen3.7-plus': 1_000_000,
    'deepseek-v4-flash': 1_000_000,
  },
};

/** A documented, conservative request envelope, or null for an unknown model. */
/**
 * The maximum OUTPUT tokens a model will emit, which is a different limit from its context
 * window and not derivable from it. A request whose max_tokens exceeds the model's own ceiling is
 * rejected outright, so a budget expressed as a share of the window has to be clamped by this.
 *
 * Only values with a documented source belong here. A model that is absent returns null and its
 * caller keeps its own conservative default, which is the behaviour every model had before this
 * table existed.
 */
const DOCUMENTED_MAX_OUTPUT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // https://developers.openai.com/api/docs/models/gpt-4o
  // The older 2024-05-13 snapshot has a different ceiling; do not match by prefix.
  openai: {
    'gpt-4o': 16_384,
    'gpt-4o-2024-08-06': 16_384,
    'gpt-4o-2024-11-20': 16_384,
  },
  // https://platform.claude.com/docs/en/about-claude/models — 128K output across the 4.6+ family.
  // Values this large require a streaming request; a non-streaming call hits the HTTP timeout
  // first. Research Chat streams, so it can use them.
  anthropic: {
    'claude-opus-5-5': 128_000,
    'claude-opus-5': 128_000,
    'claude-opus-4-8': 128_000,
    'claude-opus-4-7': 128_000,
    'claude-opus-4-6': 128_000,
    'claude-sonnet-5-5': 128_000,
    'claude-sonnet-5': 128_000,
    'claude-sonnet-4-6': 128_000,
  },
  // https://api-docs.deepseek.com/quick_start/pricing/ — 1M context with a 384K output ceiling.
  // Recorded because an ABSENT ceiling is not neutral: researchAnswerTokens falls back to the flat
  // figure, which pinned every non-Claude provider at 10,000 output tokens however large its
  // window. deepseek-flash was then cut off mid-answer at 18,192 (10,000 + a low reasoning
  // reserve) while holding a million-token context, and the scaling added for Claude never
  // applied to it at all.
  deepseek: {
    'deepseek-flash': 384_000,
    'deepseek-v4-flash': 384_000,
    'deepseek-v4-pro': 384_000,
    'deepseek-pro': 384_000,
  },
};

/** The documented output ceiling for one provider/model, or null when it is not recorded. */
export function documentedMaxOutput(provider: string, model: string): number | null {
  const byModel = DOCUMENTED_MAX_OUTPUT[provider];
  const value = byModel?.[model];
  return typeof value === 'number' && value > 0 ? value : null;
}

export function documentedContextWindow(provider: string, model: string): number | null {
  const models = Object.hasOwn(DOCUMENTED, provider) ? DOCUMENTED[provider] : undefined;
  if (models && Object.hasOwn(models, model)) return models[model];
  return null;
}
