import type { ModelInfo, ModelRef } from './types';

/** Every level the Research composer can ask for, off through the largest budget. A runtime
 *  list as well as a type so a stored choice can be validated when it is read back. */
export const RESEARCH_EFFORTS = ['standard', 'none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'on'] as const;

/** Research Assistant only. Never persisted into chatReasoning or ModelRef; the level the
 *  composer last used for a model lives in its own settings key (`researchEffortByModel`). */
export type ResearchEffort = (typeof RESEARCH_EFFORTS)[number];
export type NativeResearchEffort = Exclude<ResearchEffort, 'standard'> | 'none' | 'off';

export function isResearchEffort(value: unknown): value is ResearchEffort {
  return typeof value === 'string' && (RESEARCH_EFFORTS as readonly string[]).includes(value);
}

/** The ordered rungs, smallest budget first. `standard` is "whatever the model does unasked" and
 *  `none`/`off`/`on` are not sizes, so none of them appears here. */
const EFFORT_LADDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/**
 * One supported rung down, or null when there is none to take.
 *
 * Written for the retry after a cut-off: a model that spent its whole output ceiling thinking and
 * never wrote the answer will do it again if asked the same way, so the second attempt asks for
 * less thinking. Measured 2026-10-12 on four hard synthesis targets at `high` — each spent the
 * full 149,422-token ceiling on reasoning, and the existing retry, which repeated the request
 * unchanged, hit the ceiling a second time on all four.
 *
 * A step rather than a jump to the floor: the answer needs room, not the smallest budget going,
 * with gaps and the floor taken from this model's native profile. `standard` returns null
 * because we did not choose its size and so cannot lower it.
 */
export function reducedResearchEffort(effort: ResearchEffort | undefined, profile: ResearchReasoningProfile): ResearchEffort | null {
  if (!effort || effort === 'standard') return null;
  const native = resolveResearchEffort(profile, effort);
  const supported = EFFORT_LADDER.filter(level => profile.levels.includes(level));
  const at = supported.indexOf(native as (typeof EFFORT_LADDER)[number]);
  return at > 0 ? supported[at - 1] : null;
}
export interface ResearchReasoningProfile {
  levels: NativeResearchEffort[];
  /** Compatibility for old requests and bounded internal validation, never a UI choice. */
  legacyStandard?: NativeResearchEffort;
  mode: 'none' | 'effort' | 'gemini-budget' | 'gemini-level' | 'anthropic-adaptive' | 'anthropic-budget' | 'anthropic-effort' | 'toggle' | 'local';
}
const ordered: NativeResearchEffort[] = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'on'];
const profile = (mode: ResearchReasoningProfile['mode'], ...levels: NativeResearchEffort[]): ResearchReasoningProfile => ({ mode, levels });
const unknown = () => profile('none');

/** Lowest legal thinking mode for the documented Claude families. Unknown
 * models retain disabled until their provider explicitly rejects it. */
export function anthropicThinkingOffType(model: string): 'disabled' | 'between_tools' | 'adaptive' {
  if (/^claude-sonnet-5[.-]5(?:[.-]|$)/i.test(model)) return 'between_tools';
  if (/^claude-opus-5[.-]5(?:[.-]|$)|^claude-(?:mythos|fable)(?:[.-]|$)/i.test(model)) return 'adaptive';
  return 'disabled';
}

export function openRouterReasoningMandatory(model: string): boolean {
  return /^z-ai\/glm-5\.3-flash(?::|$)|^anthropic\/claude-(?:sonnet-5\.5|opus-5\.5|mythos|fable)(?:[.:-]|$)/i.test(model);
}

export function minimumReasoningEffort(levels: readonly NativeResearchEffort[]): NativeResearchEffort | undefined {
  return ordered.find(level => levels.includes(level) && level !== 'none' && level !== 'off');
}

/**
 * Legacy transport routes that require runtime catalogue lookup. Picker availability is
 * always determined by researchAdvertisedEfforts, for every provider.
 */
export function researchReasoningNeedsCatalog(ref: ModelRef | null | undefined): boolean {
  return ['codex', 'github-copilot', 'lmstudio', 'openrouter'].includes(ref?.provider ?? '');
}

/** Explicit, documented families only. Runtime catalogues take precedence for
 * subscriptions and LM Studio. See docs/research-assistant-reasoning.md. */
function legacyResearchReasoningProfile(ref: ModelRef | null | undefined, info?: ModelInfo): ResearchReasoningProfile {
  if (!ref) return unknown();
  const id = ref.model.toLowerCase();
  if (ref.provider === 'codex' || ref.provider === 'github-copilot') {
    const advertised = info?.supportedReasoningEfforts?.map(x => x.reasoningEffort) ?? [];
    return profile('effort', ...ordered.filter(x => advertised.some(effort => effort === x)));
  }
  if (ref.provider === 'lmstudio') return profile('local', ...ordered.filter(x => info?.researchReasoningLevels?.includes(x)));
  if (ref.provider === 'ollama') {
    if (/gpt-oss/.test(id)) return profile('local', 'low', 'medium', 'high');
    if (/qwen3(?!.*(?:instruct|coder))|deepseek-r1|deepseek-v3[.-][12]|magistral/.test(id)) return profile('local', 'off', 'on');
    return unknown();
  }
  if (ref.provider === 'nodus') return unknown();
  if (ref.provider === 'openai' || ref.provider === 'custom') {
    if (/gpt-oss/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/^gpt-6(?:[.-]|$)/.test(id)) return profile('effort', 'low', 'medium', 'high', 'xhigh', 'max');
    if (/chat|^gpt-4|^o1-(?:mini|preview)/.test(id)) return unknown();
    if (/^gpt-5.*-pro/.test(id)) return /^gpt-5-pro/.test(id) ? profile('effort', 'high') : profile('effort', 'medium', 'high', 'xhigh');
    if (/^gpt-5.*codex/.test(id)) return profile('effort', 'low', 'medium', 'high', ...(/^gpt-5[.-](?:codex|1-codex(?!-max))/.test(id) ? [] : ['xhigh' as const]));
    if (/^gpt-5\.6/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high', 'xhigh', 'max');
    if (/^gpt-5\.[2-5]/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high', 'xhigh');
    if (/^gpt-5\.1/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high');
    if (/^gpt-5(?:-|$)/.test(id)) return profile('effort', 'minimal', 'low', 'medium', 'high');
    if (/^o[134](?:-|$)/.test(id)) return /-pro/.test(id) ? profile('effort', 'high') : profile('effort', 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'gemini') {
    if (/^gemini-3/.test(id)) {
      if (/^gemini-3-pro/.test(id)) return profile('gemini-level', 'low', 'high');
      if (/pro|^gemini-3\.[78]-flash/.test(id)) return profile('gemini-level', 'low', 'medium', 'high');
      return profile('gemini-level', 'minimal', 'low', 'medium', 'high');
    }
    if (/^gemini-2\.5/.test(id)) return profile('gemini-budget', ...(/pro/.test(id) ? [] : ['none' as const]), 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'anthropic') {
    if (/mythos|fable/.test(id)) return profile('anthropic-adaptive', 'low', 'medium', 'high', ...(/preview/.test(id) ? [] : ['xhigh' as const]), 'max');
    if (/claude-(?:opus|sonnet)-(?:4[.-][6-9]|5)/.test(id)) return profile('anthropic-adaptive', 'none', 'low', 'medium', 'high', ...(/4[.-]6/.test(id) ? [] : ['xhigh' as const]), 'max');
    if (/claude-(?:3[.-]7|(?:opus|sonnet|haiku)-4)|claude-3-7/.test(id)) return profile('anthropic-budget', 'none', 'low', 'medium', 'high');
    return unknown();
  }
  if (ref.provider === 'deepseek') {
    // DeepSeek's current ids are unversioned (`deepseek-flash`, `deepseek-pro`) alongside the
    // pinned `deepseek-v4-*` names; both default to thinking-on, so both need the same toggle
    // and budget. Matching only `/v4/` silently left the unversioned ids unmanaged.
    if (/v4|deepseek-chat|deepseek-reasoner|deepseek-(?:flash|pro)(?:-|$)/.test(id)) return profile('toggle', 'none', 'low', 'high', 'max');
    return unknown();
  }
  if (ref.provider === 'xiaomi') return /mimo/.test(id) ? profile('toggle', 'none', 'on') : unknown();
  if (ref.provider === 'groq' || ref.provider === 'cerebras') {
    if (/gpt-oss/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/qwen[/-]?3\.8|gemma-4/.test(id)) return profile('effort', 'none', 'low', 'medium', 'high');
    if (ref.provider === 'groq' && /qwen3(?:\.6)?-/.test(id)) return profile('toggle', 'none', 'on');
    return unknown();
  }
  if (ref.provider === 'openrouter') {
    if (info?.reasoning === false) return unknown();
    if (/deepseek\/deepseek-r1|kimi-k2-thinking|minimax.*(?:m2|m3)/.test(id)) return profile('effort', 'low', 'medium', 'high');
    if (/z-ai\/glm-5\.3-flash/.test(id)) return profile('effort', 'low', 'medium', 'high', 'max');
    const [provider, ...rest] = id.split('/');
    const nativeProvider = ({ google: 'gemini', 'z-ai': 'opencode-go' } as Record<string, string>)[provider] ?? provider;
    if (['openai', 'anthropic', 'gemini', 'deepseek', 'xiaomi'].includes(nativeProvider)) {
      const native = researchReasoningProfile({ provider: nativeProvider as ModelRef['provider'], model: rest.join('/') });
      if (native.levels.length) return { ...native, mode: 'effort', levels: openRouterReasoningMandatory(id) ? native.levels.filter(level => level !== 'none' && level !== 'off') : native.levels };
    }
    return info?.reasoning ? profile('effort', 'low', 'medium', 'high', 'xhigh', 'max') : unknown();
  }
  if (ref.provider === 'opencode-go') {
    if (/^gpt-/.test(id)) return researchReasoningProfile({ provider: 'openai', model: id });
    // The unversioned `deepseek-flash`/`deepseek-pro` ids are the same served family as the
    // pinned `deepseek-v4-*` names, so they take the route's level contract instead of
    // falling through to `unknown()` and leaving the model with no effort control at all.
    if (/^deepseek-(?:v4|flash|pro)/.test(id)) return profile('effort', 'low', 'high', 'max');
    if (/^qwen/.test(id)) return profile('toggle', 'none', 'on');
    if (/^glm-5\.3-flash/.test(id)) return profile('effort', 'low', 'medium', 'high', 'max');
    if (/^glm-5/.test(id)) return profile('toggle', 'none', 'on');
    // MiniMax and Kimi reasoning is mandatory and exposes no graded control.
    return unknown();
  }
  return unknown();
}

/** Exact, recognised choices from the provider, preserving its display order. A capability
 * flag or a familiar model name does not advertise an effort ladder. */
export function researchAdvertisedEfforts(info?: ModelInfo): NativeResearchEffort[] {
  const levels = info?.researchReasoningLevels ?? info?.supportedReasoningEfforts?.map(entry => entry.reasoningEffort) ?? [];
  if (!Array.isArray(levels)) return [];
  return [...new Set(levels.filter((level): level is NativeResearchEffort => isResearchEffort(level) && level !== 'standard'
    && !(info?.reasoningMandatory && (level === 'none' || level === 'off'))))];
}

/** Native metadata takes precedence in requests too. Keep the old minimum only for
 * legacy Standard requests and internal JSON validators, which never use the picker. */
export function researchReasoningProfile(ref: ModelRef | null | undefined, info?: ModelInfo): ResearchReasoningProfile {
  const legacy = legacyResearchReasoningProfile(ref, info);
  const levels = researchAdvertisedEfforts(info);
  const mandatory = info?.reasoningMandatory === true;
  const supported = mandatory ? levels.filter(level => level !== 'none' && level !== 'off') : levels;
  if (!supported.length) return mandatory ? { ...legacy, levels: legacy.levels.filter(level => level !== 'none' && level !== 'off') } : legacy;
  const mode = legacy.mode !== 'none' ? legacy.mode
    : ref?.provider === 'deepseek' ? 'toggle' : ref?.provider === 'anthropic' ? 'anthropic-effort' : 'effort';
  return { mode, levels: supported, legacyStandard: mandatory ? minimumReasoningEffort(supported) : legacy.levels[0] ?? supported[0] };
}

export function researchEffortChoices(p: ResearchReasoningProfile): NativeResearchEffort[] {
  return p.levels;
}

export function resolveResearchEffort(p: ResearchReasoningProfile, requested: unknown): NativeResearchEffort | undefined {
  if (requested === 'standard') return p.legacyStandard ?? p.levels[0];
  return p.levels.includes(requested as NativeResearchEffort) ? requested as NativeResearchEffort : p.legacyStandard ?? p.levels[0];
}

/** V1's final semantic check needs actual reasoning, even without a job thinking scope.
 * Keep this bounded to the model's lowest supported reasoning level, while respecting
 * an explicit user choice to disable it. Legacy Standard transport is unchanged. */
export function researchSemanticValidationEffort(p: ResearchReasoningProfile, requested: ResearchEffort): ResearchEffort {
  if (requested === 'none' || requested === 'off') return resolveResearchEffort(p, requested) ?? 'standard';
  return minimumReasoningEffort(p.levels) ?? resolveResearchEffort(p, requested) ?? 'standard';
}

/** Ordinary source checks and rewrites need not enable thinking when the turn
 * uses the standard fast path. A separate whole-answer semantic veto retains
 * the native reasoning floor. Explicit thinking/off choices remain respected. */
export function researchProofValidationEffort(p: ResearchReasoningProfile, requested: ResearchEffort): ResearchEffort {
  if (requested === 'standard') return resolveResearchEffort(p, 'standard') ?? 'standard';
  return researchSemanticValidationEffort(p, requested);
}

/**
 * The settings key one selection's remembered level lives under. Provider ids never
 * contain a colon and model ids may contain slashes (OpenRouter's `vendor/model`), so
 * `provider:model` names one selection unambiguously.
 */
export function researchEffortMemoryKey(ref: ModelRef | null | undefined): string | null {
  return ref?.provider && ref.model ? `${ref.provider}:${ref.model}` : null;
}

/** How deep each level reasons, for finding the one nearest the middle. `on` is a switch,
 *  not a depth, so it has no rank and is never a default. */
const depth: Partial<Record<NativeResearchEffort, number>> = { none: 0, off: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, ultra: 7 };

/** Medium when advertised; otherwise the nearest depth, preferring the lighter level on
 * a tie. The legacy sentinel is used only when there is no published choice. */
export function researchDefaultEffort(p: ResearchReasoningProfile): ResearchEffort {
  const choices = researchEffortChoices(p);
  if (choices.includes('medium')) return 'medium';
  const rank = (choice: NativeResearchEffort) => depth[choice];
  let best: ResearchEffort = choices[0] ?? 'standard';
  let distance = Infinity;
  for (const choice of choices) {
    const value = rank(choice);
    if (value === undefined) continue;
    if (Math.abs(value - depth.medium!) < distance || (Math.abs(value - depth.medium!) === distance && value < (depth[best as NativeResearchEffort] ?? Infinity))) { best = choice; distance = Math.abs(value - depth.medium!); }
  }
  return best;
}

/**
 * Store native choices per provider+model. Legacy Standard entries remain readable.
 */
export function withResearchEffort(
  current: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined,
  effort: ResearchEffort
): Record<string, ResearchEffort> {
  const key = researchEffortMemoryKey(ref);
  const next = { ...(current ?? {}) };
  if (key) next[key] = effort;
  return next;
}

/** The level remembered for one selection, if the user ever picked one. A value that is
 *  not a level at all (a hand-edited preferences file) counts as no choice. */
export function rememberedResearchEffort(
  remembered: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined
): ResearchEffort | undefined {
  const key = researchEffortMemoryKey(ref);
  const stored = key ? remembered?.[key] : undefined;
  return isResearchEffort(stored) ? stored : undefined;
}

/** The same native value is shown and submitted. Old Standard preferences map to their
 * former native minimum when advertised, otherwise to the usual initial choice. */
export function researchEffortFor(
  remembered: Record<string, ResearchEffort> | undefined,
  ref: ModelRef | null | undefined,
  info?: ModelInfo
): ResearchEffort {
  const stored = rememberedResearchEffort(remembered, ref);
  if (!info) return stored ?? 'standard';
  const levels = researchAdvertisedEfforts(info);
  const native = stored === 'standard' ? legacyResearchReasoningProfile(ref, info).levels[0] : stored;
  if (native && levels.includes(native as NativeResearchEffort)) return native;
  return researchDefaultEffort({ mode: 'none', levels });
}

/** Additional allowance for reasoning, preserving room for the visible answer.
 * Local windows are fitted separately and never expanded by this helper. */
export function researchThinkingAllowance(effort: NativeResearchEffort | undefined): number {
  return ({ minimal: 512, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768, ultra: 32768, on: 8192 } as Partial<Record<NativeResearchEffort, number>>)[effort ?? 'none'] ?? 0;
}

export function researchReasoningBody(ref: ModelRef, requested: ResearchEffort, maxTokens: number, info?: ModelInfo): Record<string, unknown> {
  const p = researchReasoningProfile(ref, info);
  const effort = resolveResearchEffort(p, requested);
  if (!effort) return {};
  const off = effort === 'none' || effort === 'off';
  if (ref.provider === 'openrouter') return { reasoning: off ? { enabled: false } : effort === 'on' ? { enabled: true } : { effort } };
  if (p.mode === 'gemini-level' || p.mode === 'gemini-budget') return {
    extra_body: { google: { thinking_config: p.mode === 'gemini-level'
      ? { thinking_level: effort }
      : { thinking_budget: off ? 0 : Math.min(researchThinkingAllowance(effort), Math.max(128, maxTokens - 1024)) } } },
  };
  if (p.mode === 'anthropic-effort') return { output_config: { effort } };
  if (p.mode === 'anthropic-adaptive') return { thinking: { type: off ? anthropicThinkingOffType(ref.model) : 'adaptive' }, output_config: { effort: off ? 'low' : effort } };
  if (p.mode === 'anthropic-budget') return { thinking: off ? { type: 'disabled' } : { type: 'enabled', budget_tokens: Math.min(researchThinkingAllowance(effort), Math.max(1024, maxTokens - 1024)) }, ...(researchAdvertisedEfforts(info).includes(effort) ? { output_config: { effort } } : {}) };
  if (p.mode === 'toggle') {
    if (ref.provider === 'groq') return { reasoning_effort: off ? 'none' : 'default' };
    return { thinking: { type: off ? 'disabled' : 'enabled' }, ...(ref.provider === 'deepseek' && !off ? { reasoning_effort: effort } : {}) };
  }
  if (p.mode === 'local') return ref.provider === 'ollama' ? { think: off ? false : effort === 'on' ? true : effort } : { reasoning: effort };
  return { reasoning_effort: effort };
}

/** Thinking-enabled Claude and OpenAI reasoning models reject sampling knobs. */
export function researchOmitsTemperature(ref: ModelRef, effort: ResearchEffort, info?: ModelInfo): boolean {
  const p = researchReasoningProfile(ref, info);
  const native = resolveResearchEffort(p, effort);
  return (ref.provider === 'anthropic' && !!native && native !== 'none') ||
    (['openai', 'custom', 'opencode-go'].includes(ref.provider) && /^(?:gpt-[56]|o[134])/.test(ref.model) && native !== 'none');
}
