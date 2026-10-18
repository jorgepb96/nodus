import { RESEARCH_TURN_INTENT_POLICY } from '@shared/researchTurnIntent';
import type { DeepResearchRequest, ImmersionRequest, ResearchChatRequest } from '@shared/types';
import type { ResearchRunContext, ResearchRunMode } from '@shared/researchHarness';
import type { ResolvedResearchScope } from '@shared/researchCorpus';
import { researchContextLayers, researchContextWeb } from '@shared/researchContextLayers';
import { getSettings } from '../db/settingsRepo';
import { resolveModelRef } from './aiClient';
import { withResearchSystemPrompt } from './researchSystemPrompt';
import { researchFingerprint } from './researchCorpusScope';
import { getConversation } from '../db/chatRepo';

export function researchHarnessContext(mode: ResearchRunMode, request: ResearchChatRequest | DeepResearchRequest | ImmersionRequest, scope: ResolvedResearchScope): ResearchRunContext {
  const settings = getSettings();
  const chat = 'messages' in request ? request : null;
  const layers = chat ? researchContextLayers(chat.selection, true) : { ideas: true, documents: true, indexed: true };
  const model = request.model ?? (mode === 'deep-research' ? settings.deepResearchModel : mode === 'immersion' ? settings.immersionModel : settings.chatModel) ?? settings.synthesisModel;
  return { mode, vaultId: scope.vaultId, scopeId: scope.id, notebookId: scope.notebookId,
    objective: chat ? chat.messages.filter(m => m.role === 'user').at(-1)?.content ?? '' : 'objective' in request ? request.objective : (request as ImmersionRequest).topic,
    model: resolveModelRef(model), effort: request.thinkingEffort ?? 'standard',
    ...(chat ? { options: { selection: structuredClone(chat.selection), skillIds: [...(chat.skillIds ?? [])] } } : {}),
    policyKey: researchFingerprint({ responsePolicy: mode === 'deep-research' ? 'direct-evidence-v1' : 'legacy-parity-v1', turnIntent: RESEARCH_TURN_INTENT_POLICY, verification: settings.researchAnswerVerification ?? 'off', language: 'language' in request ? request.language : settings.promptLanguage,
      selection: chat?.selection, skillIds: chat?.skillIds,
      instructions: chat ? withResearchSystemPrompt('', chat.systemPromptId, { surface: 'research', conversationId: chat.conversationId }) : '',
      userTurns: chat?.conversationId ? getConversation(chat.conversationId)?.messages.filter(m => m.role === 'user').map(m => [m.id, m.content]) : undefined }),
    capabilities: { ...layers, web: chat ? researchContextWeb(chat.selection, (chat.webSearch ?? settings.researchWebSearch) !== 'off') : request.webSearch === 'auto',
      attachments: chat?.attachmentIds ?? [], skills: [],
      restricted: !!scope.notebookId || chat?.selection.sourceFilter?.enabled === true } };
}
