import type {ModelInfo,ModelRef} from './types';
import {isLocalProvider} from './providers';
import {researchReasoningProfile,resolveResearchEffort,researchThinkingAllowance,type NativeResearchEffort,type ResearchEffort} from './researchReasoning';

/**
 * Adaptive-thinking models cannot turn thinking off, and their thinking tokens count against
 * `max_tokens` — which the provider documents as "a hard limit on total output (thinking plus
 * response text)". The manual `budget_tokens` allowances are sized for a fixed cap and are far
 * too small here: at the lowest effort `claude-opus-5-5` still reasoned roughly ten thousand
 * tokens on a route-correction turn and the answer was truncated to a few dozen characters.
 * Reserve the depth the provider documents per effort so the visible answer always fits. A
 * larger `max_tokens` is a ceiling, not a target, so it does not make the model write more.
 */
const ADAPTIVE_THINKING_ALLOWANCE: Partial<Record<NativeResearchEffort, number>> = {
  none: 16_384, off: 16_384, minimal: 16_384, low: 16_384,
  medium: 24_576, high: 32_768, xhigh: 49_152, max: 65_536, ultra: 65_536, on: 32_768,
};

/** The output tokens to add on top of the visible answer so a model thinking at `effort`
 *  still has room to answer. Nothing for models on the user's device, whose windows are
 *  fitted separately. */
export function thinkingOutputAllowance(model: ModelRef, effort: ResearchEffort, info?: ModelInfo): number {
  if (isLocalProvider(model.provider) || model.provider === 'nodus') return 0;
  const profile = researchReasoningProfile(model, info);
  const native = resolveResearchEffort(profile, effort);
  // DeepSeek's effort is not a token cap. Flash used 5,420 reasoning tokens at
  // low in a real JSON review, exhausting the old 1,024-token reserve and cutting
  // off the answer. Reserve room before the first request; retries stay invariant.
  // High reasoned past a 16,384 reserve on multistep synthesis routes (tropinone, the
  // Wieland–Miescher ketone), and camphor from α-pinene past 32,768: the answer was cut off
  // before it began. Flash and V4 Pro allow up
  // to 384K output tokens (api-docs.deepseek.com, checked 2026-09-29); the reserve is a ceiling,
  // not a spend.
  if (model.provider === 'deepseek') {
    return ({ low: 8192, high: 65536, max: 131072 } as Partial<Record<NativeResearchEffort, number>>)[native ?? 'none'] ?? researchThinkingAllowance(native);
  }
  // Adaptive thinking is always on, so its reserve stands in for the `budget_tokens` the
  // manual mode would otherwise cap at a much smaller number.
  return profile.mode === 'anthropic-adaptive'
    ? ADAPTIVE_THINKING_ALLOWANCE[native ?? 'none'] ?? researchThinkingAllowance(native)
    : researchThinkingAllowance(native);
}
