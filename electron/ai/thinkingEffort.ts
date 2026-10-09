import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelInfo, ModelRef } from '@shared/types';
import { isLocalProvider } from '@shared/providers';
import {
  isResearchEffort,
  researchReasoningNeedsCatalog,
  researchReasoningProfile,
  researchThinkingAllowance,
  resolveResearchEffort,
  type NativeResearchEffort,
  type ResearchEffort,
} from '@shared/researchReasoning';
import { listModels, openAiCompatBase } from './providers';
import { getApiKey } from '../secrets/secretStore';

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

/** The live catalogue entry for providers whose thinking levels come with it. Known
 *  families still work when the catalogue cannot be read, so a failure is not an error. */
export async function thinkingCatalogInfo(model: ModelRef, signal?: AbortSignal): Promise<ModelInfo | undefined> {
  if (!['anthropic', 'deepseek', 'openai', 'custom', 'groq', 'cerebras', 'xiaomi', 'openrouter', 'lmstudio'].includes(model.provider)) return undefined;
  const key = `${model.provider}:${openAiCompatBase(model.provider) ?? ''}:${model.model}`;
  const remembered = catalogEntries.get(key);
  if (remembered && Date.now() - remembered.at < CATALOG_ENTRY_TTL_MS) return remembered.info;
  try {
    const deadline = AbortSignal.timeout(5000);
    const info = (await listModels(model.provider, getApiKey(model.provider), signal ? AbortSignal.any([signal, deadline]) : deadline)).find(entry => entry.id === model.model);
    catalogEntries.set(key, { at: Date.now(), info });
    return info;
  } catch {
    return undefined;
  }
}

/** Each turn read the provider's whole catalogue to find this one entry: a request on the path of
 *  every answer, before retrieval and before the model is asked, bounded only by the deadline
 *  above. The entry does not change between the turns of a conversation, so a completed read is
 *  kept for a while; a failed one is not, and the next turn asks again. */
const CATALOG_ENTRY_TTL_MS = 10 * 60 * 1000;
const catalogEntries = new Map<string, { at: number; info: ModelInfo | undefined }>();

/**
 * A long job's thinking level: the level chosen in the Deep Research or Immersion form, for
 * generation calls to the model it was chosen for. Academic validators use a nested
 * Standard scope to keep their bounded JSON reviews predictable. It follows the job's asynchronous
 * call chain, so a concurrent chat or another job keeps its own level, and a call to any
 * other model (an audit model, say) keeps that model's usual reasoning.
 */
interface JobThinking { effort: ResearchEffort; model: ModelRef; info?: ModelInfo }
const active = new AsyncLocalStorage<JobThinking>();

const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.model === b.model;

/** Run `job` with `effort` applied to its calls to `model`. A missing or unknown level (a
 *  request from an older build, MCP or the Server) runs the job exactly as before, and so
 *  does a model that publishes no thinking control: there is nothing to choose, so its
 *  calls keep the reasoning they always had. */
export async function withJobThinkingEffort<T>(effort: unknown, model: ModelRef | null | undefined, job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!isResearchEffort(effort) || !model) return job();
  const info = await thinkingCatalogInfo(model, signal);
  const levels = researchReasoningProfile(model, info).levels.length;
  // A subscription's ladder arrives with its own catalogue; its transport maps the level itself.
  if (!levels && !(researchReasoningNeedsCatalog(model) && !info)) return job();
  return active.run({ effort, model, info }, job);
}

/** Academic validation uses the same model at Standard without changing the
 * surrounding writer, concurrent jobs, or legacy calls without a chosen level.
 * Keep the catalogue entry so models with mandatory thinking retain their reserve. */
export function withResearchValidationThinking<T>(model: ModelRef | null | undefined, validate: () => Promise<T>): Promise<T> {
  const job = active.getStore();
  if (!job || !model || !sameModel(job.model, model)) return validate();
  return active.run({ ...job, effort: 'standard' }, validate);
}

/** The call options with the job's level applied, when this call belongs to a job that set
 *  one for this model and the caller did not choose a level itself. */
export function withJobThinking<T extends { researchEffort?: ResearchEffort; researchModelInfo?: ModelInfo; maxTokens?: number }>(model: ModelRef, opts: T): T {
  const job = active.getStore();
  if (!job || opts.researchEffort !== undefined || !sameModel(job.model, model)) return opts;
  return {
    ...opts,
    researchEffort: job.effort,
    ...(job.info ? { researchModelInfo: job.info } : {}),
    maxTokens: (opts.maxTokens ?? 8000) + thinkingOutputAllowance(model, job.effort, job.info),
  };
}

/** The level the current job applies to `model`, for tests and diagnostics. */
export function currentJobThinkingEffort(model: ModelRef): ResearchEffort | undefined {
  const job = active.getStore();
  return job && sameModel(job.model, model) ? job.effort : undefined;
}
