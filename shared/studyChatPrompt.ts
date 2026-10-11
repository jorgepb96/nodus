import type {StudyAssistantCitation,StudyAssistantRequest} from './studyAssistant';
import type {StudySearchIndexEntry} from './studySearch';
import type {PromptLanguage} from './types';
import {studyAssistantSourceKey} from './studyAssistant';
import {studyAssistantPromptPack} from './studyAssistantPromptPacks';
import {chatProseForHistory} from './chatSkills';
const MAX_HISTORY_MESSAGES=12;

export function studyChatCitation(id: string, entry: StudySearchIndexEntry, quote: string): StudyAssistantCitation {
  return {
    id, sourceKey: studyAssistantSourceKey(entry.kind, entry.sourceId), indexId: entry.indexId, kind: entry.kind,
    sourceId: entry.sourceId, title: entry.title, subtitle: entry.subtitle, quote, location: entry.location, scope: entry.scope,
  };
}

export function buildStudyChatPrompt(request: StudyAssistantRequest, citations: StudyAssistantCitation[], interfaceLanguage: PromptLanguage): { system: string; user: string } {
  const history = request.messages.filter((message) => message.content.trim()).slice(-MAX_HISTORY_MESSAGES);
  const sources = citations.map((citation) => ({
    id: citation.id, title: citation.title, type: citation.kind, location: citation.location, exact_fragment: citation.quote,
  }));
  const selectedLanguage = request.language === 'auto' ? interfaceLanguage : request.language;
  const pack = studyAssistantPromptPack(selectedLanguage);
  const language = request.language === 'auto' ? pack.responseLanguage : selectedLanguage;
  const external = request.allowExternalKnowledge ? pack.system.externalAllowed : pack.system.externalForbidden;
  const system = [pack.system.intro, '', pack.system.rulesHeading, `- ${pack.system.corpus}`, `- ${pack.system.cite}`, `- ${pack.system.exact}`, `- ${external}`, `- ${pack.system.contradiction}`, `- ${pack.system.language(language, request.level, request.tone)}`, `- ${pack.system.markdown} ${pack.taskInstruction[request.task]}`].join('\n');
  const user = JSON.stringify({ fuentes_seleccionadas: sources, conversacion: history.map(({ role, content }) => ({ role, content: role === 'assistant' ? chatProseForHistory(content) : content })) }, null, 2);
  return { system, user };
}

