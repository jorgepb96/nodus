import { prepareResearchAttachments, withResearchAttachmentFallback } from './researchAttachments';
import {generationSignal} from './generationSignal';
import { withResearchSystemPrompt } from './researchSystemPrompt';
import { researchGenerationOptions } from './researchGenerationOptions';
import { skillHasCapability } from '@shared/chatSkills';
import { buildChatSkillsPrompt, chatProseForHistory, chatSkillsOutputContract } from '@shared/chatSkills';
import { vaultChatSkillSession } from './chatSkillSession';
import { executeChatSkills, assertChatSkillSession } from './chatSkillExecution';
import { getDatabaseChatConversation } from '../db/databaseChatRepo';
// Database chat orchestrator: builds a bounded context (statistical profile + a sample
// of rows) for the selected databases and streams an analyst answer that may include a
// native chart spec. The context assembly is pure (shared/databaseChat.ts); this module
// wires the repo + the streaming model.

import {getDatabase} from '../db/databasesRepo';
import {captureDatabaseChatContextSource} from '../db/databaseChatSource';
export {captureDatabaseChatContextSource} from '../db/databaseChatSource';
import { buildDbChatUser, databaseChatSystem } from '@shared/databaseChat';
import type { DatabaseChatRequest } from '@shared/types';
import { getSettings } from '../db/settingsRepo';
import {composeDatabaseChatSources} from '@shared/databaseChatSources';

export type { DatabaseChatRequest };

/** Build the bounded context string for the selected databases. */
export function buildDatabaseChatContext(databaseIds:string[],language=getSettings().promptLanguage??'es'):{context:string;names:string[]} {
  return composeDatabaseChatSources(databaseIds.filter(id=>getDatabase(id)).map(captureDatabaseChatContextSource),language);
}

export interface DatabaseChatDeps {
  stream?: (
    opts: { images?: import('../../shared/imageAnalysis').VisionImagePart[]; system: string; user: string; englishImagePrompts?: boolean; plainContext?: boolean; temperature?: number; maxTokens?: number },
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ) => Promise<string>;
}

/** Stream an answer over the selected databases' data. Returns the full text. */
export async function streamDatabaseChat(
  request: DatabaseChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  deps: DatabaseChatDeps = {}
): Promise<{ text: string; aborted?: boolean }> {
  signal = generationSignal(signal);
  if (!request.databaseIds.length && !request.attachmentIds?.length) throw new Error('Elige al menos una base de datos.');
  const settings = getSettings();
  const execution = vaultChatSkillSession('database', request.conversationId, request.question, request.model ?? settings.chatModel ?? settings.synthesisModel, getDatabaseChatConversation);
  assertChatSkillSession(execution, signal);
  const { skills } = execution;
  const attachments = await prepareResearchAttachments(request, 'database', request.model ?? settings.chatModel ?? settings.synthesisModel);
  const language = settings.promptLanguage ?? 'es';
  const { context } = buildDatabaseChatContext(request.databaseIds, language);
  // Replay only the model's prose; rendered blocks (charts, artifacts) are the app's.
  const history = (request.history ?? []).map((turn) => (turn.role === 'assistant' ? { ...turn, content: chatProseForHistory(turn.content) } : turn));
  const user = buildDbChatUser(context, request.question, history, language);

  const stream =
    deps.stream ??
    (async (opts, cb, sig) => {
      const { completeTextStream } = await import('./aiClient');
      const { getSettings } = await import('../db/settingsRepo');
      const s = getSettings();
      return completeTextStream({ ...opts, ...(request.thinkingEffort === undefined ? {} : await researchGenerationOptions({ ...request, model: request.model ?? s.chatModel ?? s.synthesisModel }, opts.maxTokens ?? 1500, false, sig)) }, (delta, kind) => {
        if (kind !== 'reasoning') cb(delta);
      }, request.model ?? s.chatModel ?? s.synthesisModel ?? null, sig);
    });

  const text = await withResearchAttachmentFallback(attachments,
    { system: withResearchSystemPrompt(`${databaseChatSystem(language)}\n\n${buildChatSkillsPrompt(skills)}`, request.systemPromptId, { surface: 'database', conversationId: request.conversationId }) + attachments.system, images: attachments.images, user: `${user}\n\n${chatSkillsOutputContract(skills)}${attachments.text}`, englishImagePrompts: skills.some(skill => skillHasCapability(skill, 'image')), plainContext: true, temperature: 0.3, maxTokens: skills.length ? 10_000 : 1500 },
    options => stream(options, onDelta, signal)
  );
  // A user-triggered stop keeps the partial answer: running the skill tools now would
  // throw an AbortError and discard everything that already streamed.
  if (signal?.aborted) return { text, aborted: true };
  return { text: await executeChatSkills(text, execution, signal) };
}
