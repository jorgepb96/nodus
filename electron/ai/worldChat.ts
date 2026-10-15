import { prepareResearchAttachments, withResearchAttachmentFallback } from './researchAttachments';
import {generationSignal} from './generationSignal';
import { withResearchSystemPrompt } from './researchSystemPrompt';
import { researchGenerationOptions } from './researchGenerationOptions';
import { skillHasCapability } from '@shared/chatSkills';
import { enabledChatSkills } from '../chatSkills';
import { buildChatSkillsPrompt, chatSkillsOutputContract, transformChatProse } from '@shared/chatSkills';
import { executeChatSkills } from './chatSkillExecution';
import { chatAssetOwner, chatAssetVersion } from '../chatAssets';
import { getWorldChatConversation } from '../db/worldChatRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
// The world chat: Nodus calculates, the model writes.
//
// This is the last piece of "Analizar" and it is designed KNOWING the other five exist,
// which is what makes it different from a chat over a corpus. Every question a writer asks
// about their own world — could she have done that, where was he, what has to move in this
// scene, does this contradict anything, who knew — is already a pure function over the
// vault. So none of them is asked of the model: they are computed here and handed over as
// facts, and the system prompt says in one line that facts are not up for discussion.
//
// What the model does is read them, choose what matters, and write a paragraph with links.
// It never sees the whole vault: only the focus the question named and the facts about it,
// which is also the only way it fits in a local model's window.

import { completeTextStream } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import {
  composeWorldChatContext,
  ensureWorldCitations,
  hasWorldChatMaterial,
  validateCitations,
  type WorldChatFacts,
} from '@shared/worldChatContext';
import { worldOperationSystemPrompt } from '@shared/worldOperationPrompts';
import {listWorldEntries} from '../db/worldEncyclopediaRepo';
import {desktopWorldChatSource} from '../db/worldChatSource';
import { parseEntryKey } from '@shared/worldEncyclopedia';
import {calculateWorldChatFacts} from '@shared/worldChatFacts';
import type { PromptLanguage, WorldChatRequest, WorldChatResult } from '@shared/types';

/** The same calculations power live Mac and selected companion snapshots. */
export function buildWorldChatFacts(request:WorldChatRequest,language:PromptLanguage='es'):WorldChatFacts {
  return calculateWorldChatFacts(request,desktopWorldChatSource(),language);
}

export async function streamWorldChat(
  request: WorldChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<WorldChatResult> {
  signal = generationSignal(signal);
  const settings = getSettings();
  const skills = enabledChatSkills('assistant');
  const vaultId = getActiveVault().id;
  const owner = request.conversationId ? chatAssetOwner('world-assistant', request.conversationId, vaultId) : undefined;
  const version = owner ? chatAssetVersion(owner) : 0;
  const language = settings.promptLanguage ?? 'es';
  const facts = buildWorldChatFacts(request, language);
  const attachments = await prepareResearchAttachments(request, 'world', request.model ?? settings.chatModel ?? settings.synthesisModel);
  // Skills change how grounded material is presented; they do not supply world facts.
  if (!hasWorldChatMaterial(facts) && !attachments.text) {
    return { text: '', focus: facts.focus, noMaterial: true };
  }

  const model = request.model ?? settings.chatModel ?? settings.synthesisModel ?? null;
  const raw = await withResearchAttachmentFallback(attachments,
    {
      system: withResearchSystemPrompt(`${worldOperationSystemPrompt('worldChat', settings.promptLanguage ?? 'es')}\n\n${buildChatSkillsPrompt(skills)}\nNew creative proposals are not established world canon. Label them accordingly.`, request.systemPromptId, { surface: 'world', conversationId: request.conversationId }) + attachments.system,
      images: attachments.images,
      user: `${composeWorldChatContext(facts, language)}\n\n${chatSkillsOutputContract(skills)}${attachments.text}`,
      plainContext: true,
      englishImagePrompts: skills.some(skill => skillHasCapability(skill, 'image')),
      // Keep factual answers grounded and creative proposals clearly identified.
      temperature: 0.3,
      ...(request.thinkingEffort === undefined ? { maxTokens: skills.length ? 10_000 : 1200 } : await researchGenerationOptions({ ...request, model }, skills.length ? 10_000 : 1200, false, signal)),
    },
    options => completeTextStream(options, (delta, kind) => {
      if (kind !== 'reasoning') onDelta(delta);
    }, model, signal)
  );

  // Only entries actually supplied in CÓMO SE CITA are allowed. A real but unrelated id
  // is still an unsupported citation: existence elsewhere in the vault does not make it
  // evidence for this answer.
  const allowed = new Set(
    facts.citable.map((ref) => `${ref.kind}:${ref.id}`)
  );
  const validated = transformChatProse(raw, prose => validateCitations(prose, allowed));
  const repaired = ensureWorldCitations(validated, facts.citable, language);
  // A user-triggered stop keeps the partial answer: running the skill tools now would
  // throw an AbortError and discard everything that already streamed.
  const aborted = Boolean(signal?.aborted);
  return {
    text: aborted ? repaired : await executeChatSkills(repaired, { skills, owner, version, model, question: request.question, isCurrent: () => getActiveVault().id === vaultId && (!request.conversationId || !!getWorldChatConversation(request.conversationId)) }, signal),
    focus: facts.focus,
    noMaterial: false,
    ...(aborted ? { aborted: true } : {}),
  };
}

/** Exported for the tests: the keys a reply is allowed to cite. */
export function citableKeys(): Set<string> {
  return new Set(listWorldEntries().map((entry) => entry.key));
}

export { parseEntryKey };
