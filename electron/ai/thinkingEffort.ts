import {thinkingOutputAllowance} from '@shared/researchOutputBudget';
export {thinkingOutputAllowance} from '@shared/researchOutputBudget';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelInfo, ModelRef } from '@shared/types';
import {
  isResearchEffort,
  researchReasoningNeedsCatalog,
  researchReasoningProfile,
  type ResearchEffort,
} from '@shared/researchReasoning';
import { listModels } from './providers';
import { getApiKey } from '../secrets/secretStore';

/** The live catalogue entry for providers whose thinking levels come with it. Known
 *  families still work when the catalogue cannot be read, so a failure is not an error. */
export async function thinkingCatalogInfo(model: ModelRef, signal?: AbortSignal): Promise<ModelInfo | undefined> {
  if (!['anthropic', 'deepseek', 'openai', 'custom', 'groq', 'cerebras', 'xiaomi', 'openrouter', 'lmstudio'].includes(model.provider)) return undefined;
  try {
    const deadline = AbortSignal.timeout(5000);
    return (await listModels(model.provider, getApiKey(model.provider), signal ? AbortSignal.any([signal, deadline]) : deadline)).find(entry => entry.id === model.model);
  } catch {
    return undefined;
  }
}

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
