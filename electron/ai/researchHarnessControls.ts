import { getResearchRun } from '../db/researchRunsRepo';
import { waitForResearchRunStop } from './researchHarnessRuntime';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getConversation, saveMessages } from '../db/chatRepo';
import { streamResearchChat } from './researchAssistant';
import { generateImmersionSession } from './immersion';
import { runDeepResearchJob } from './deepResearchQueue';
import { ensureDeepResearchLane } from './deepResearchLane';
import { retrieveDictionaryResearchEvidence, type DictionaryHarnessRequest } from './dictionary';
import { broadcastDictionaryChanged, dictionaryGenerationJobs } from './dictionaryGenerationLane';
import type { DeepResearchRequest, ImmersionRequest, ResearchChatRequest } from '@shared/types';

/** UI and MCP enter through the same provider, scope and queue boundaries. */
export async function resumeResearchRun(id: string): Promise<{ mode: string; artifactId?: string }> {
  const existing = getResearchRun(id);
  if (existing?.summary.status === 'paused') await waitForResearchRunStop(id);
  const record = getResearchRun(id);
  if (!record || record.context.vaultId !== getActiveVault().id) throw new Error('research_run_not_authorized');
  if (record.summary.status === 'cancelled') throw new Error('research_run_cancelled');
  if (record.summary.status === 'completed') return { mode: record.context.mode, artifactId: record.artifactId };
  if (record.context.mode === 'chat') {
    const request = record.request as ResearchChatRequest;
    const conversation = request.conversationId ? getConversation(request.conversationId) : null;
    if (!conversation) throw new Error('research_run_not_authorized');
    // Resume only the latest turn. Never overwrite messages the user added meanwhile.
    const lastUser = conversation.messages.filter(m => m.role === 'user').at(-1);
    if (lastUser?.content !== request.messages.filter(m => m.role === 'user').at(-1)?.content) throw new Error('research_run_context_changed');
    const response = await streamResearchChat({ ...request, runId: id }, () => {});
    if (!response.aborted) {
      const current = getConversation(conversation.id);
      if (!current || current.messages.filter(m => m.role === 'user').at(-1)?.id !== lastUser?.id) throw new Error('research_run_context_changed');
      const messages = [...current.messages];
      const last = messages.at(-1);
      if (last?.role === 'assistant') messages[messages.length - 1] = { ...last, content: response.answer, stats: response.stats, error: false };
      else messages.push({ id: `research-run-${id}`, role: 'assistant', content: response.answer, stats: response.stats });
      saveMessages(conversation.id, messages);
    }
    return { mode: 'chat' };
  }
  if (record.context.mode === 'deep-research') {
    ensureDeepResearchLane();
    await runDeepResearchJob({ request: { ...(record.request as DeepResearchRequest), runId: id }, origin: 'app', save: true });
    return { mode: record.context.mode, artifactId: getResearchRun(id)?.artifactId };
  }
  if (record.context.mode === 'dictionary') {
    const request = record.request as DictionaryHarnessRequest;
    if (request.researchOperation) {
      await retrieveDictionaryResearchEvidence(request.entryId, request.researchOperation, { ...request, runId: id });
      broadcastDictionaryChanged(request.entryId);
    }
    else await dictionaryGenerationJobs.run({ ...request, runId: id });
    return { mode: 'dictionary', artifactId: getResearchRun(id)?.artifactId };
  }
  const session = await generateImmersionSession({ ...(record.request as ImmersionRequest), runId: id });
  return { mode: 'immersion', artifactId: session.id };
}
