import { resolveModelRef } from './aiClient';
import type { ModelRef } from '@shared/types';
import type { ResearchEffort } from '@shared/researchReasoning';
import { thinkingCatalogInfo, thinkingOutputAllowance } from './thinkingEffort';
import { isLocalProvider } from './providers';
import { withinModelOutput } from '@shared/researchRetrievalBudget';

/** The Research chat turn's thinking options: the level the user picked, the live catalogue
 *  entry where the ladder comes with it, and room for the thinking on top of the answer. */
export async function researchGenerationOptions(request: { model?: ModelRef | null; thinkingEffort?: ResearchEffort }, maxTokens: number, local: boolean, signal?: AbortSignal) {
  const model = resolveModelRef(request.model);
  const researchModelInfo = await thinkingCatalogInfo(model, signal);
  signal?.throwIfAborted();
  const researchEffort = request.thinkingEffort ?? 'standard';
  return { reasoning: 'off' as const, researchEffort, researchModelInfo,
    maxTokens: (local || isLocalProvider(model.provider) || model.provider === 'nodus')
      ? maxTokens
      : withinModelOutput(maxTokens + thinkingOutputAllowance(model, researchEffort, researchModelInfo), model.provider, model.model) };
}

/** Verification needs both a bounded visible proof and room for the model's
 * minimum reasoning level. Explicit off/none stays off; output/context caps still
 * apply. Share this envelope across Chat, reports and lessons. */
export async function researchVerificationOptions(request: { model?: ModelRef | null; thinkingEffort?: ResearchEffort }, visibleTokens: number, signal?: AbortSignal) {
  const options = await researchGenerationOptions(request, visibleTokens, false, signal);
  const model = resolveModelRef(request.model), effort = request.thinkingEffort ?? 'standard';
  if (!['none', 'off', 'standard'].includes(effort)) {
    const reserve = model.provider === 'deepseek' || /^deepseek\//u.test(model.model) ? 16_384 : 8192;
    options.maxTokens = withinModelOutput(Math.max(options.maxTokens, visibleTokens + reserve), model.provider, model.model);
  }
  return options;
}
