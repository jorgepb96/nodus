import type { NoteResearchReference, NoteSource, StudyAssistantCitation } from '@shared/types';
import type { ResearchAttachmentSurface } from '@shared/researchAttachments';
import type { ResearchUiMessage } from './views/researchChatAdapter';

export interface ResearchConversationNavigationTarget {
  surface: ResearchAttachmentSurface;
  conversationId: string;
  messageId?: string | null;
  messageIndex?: number | null;
  nonce: number;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
const SAFE_REFERENCE = /^(?:nodus:\/\/|https?:\/\/)/i;

function studyCitationHref(citation: StudyAssistantCitation): string | null {
  const location = citation.location;
  if (citation.kind === 'document' && location.documentId) {
    return `nodus://study/doc/${encodeURIComponent(location.documentId)}`;
  }
  if (citation.kind === 'material' && location.materialId) {
    return `nodus://study/material/${encodeURIComponent(location.materialId)}`;
  }
  if (citation.kind === 'transcript' && location.recordingId) {
    const timestamp = location.timestampSeconds;
    return `nodus://study/recording/${encodeURIComponent(location.recordingId)}${timestamp == null ? '' : `?t=${timestamp}`}`;
  }
  return null;
}

/** Capture durable references without changing a single character of the answer. */
export function researchMessageReferences(message: ResearchUiMessage): NoteResearchReference[] {
  const references: NoteResearchReference[] = [];
  const seen = new Set<string>();
  for (const match of message.content.matchAll(MARKDOWN_LINK)) {
    const href = match[2];
    if (!SAFE_REFERENCE.test(href)) continue;
    const key = href.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ label: match[1].trim() || href, href });
  }
  for (const citation of message.study?.citations ?? []) {
    const evidenceHref = `nodus://study/evidence/${encodeURIComponent(citation.id)}`;
    const inlineIndex = references.findIndex((reference) => reference.href === evidenceHref);
    if (inlineIndex >= 0) references.splice(inlineIndex, 1);
    const href = studyCitationHref(citation);
    const key = `${citation.id}:${href ?? citation.sourceKey}`.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      citationId: citation.id,
      label: citation.title,
      subtitle: citation.subtitle || null,
      quote: citation.quote || null,
      href,
    });
  }
  return references;
}

export function researchNoteSource(input: {
  surface: ResearchAttachmentSurface;
  conversationId: string;
  conversationTitle: string;
  message: ResearchUiMessage;
  messageIndex?: number | null;
  model: NoteSource['model'];
}): NoteSource {
  return {
    origin: 'assistant',
    model: input.model,
    note: input.conversationTitle,
    researchChat: {
      surface: input.surface,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      messageId: input.message.id,
      messageIndex: input.messageIndex ?? null,
      references: researchMessageReferences(input.message),
    },
  };
}
/** Generic citation markers are interface labels; named references and URLs stay intact. */
export function localizeResearchCitationLabels(content:string,sourceLabel:string):string {
  return content.replace(/\[(?:fuente|source)\]\((nodus:\/\/(?:passage|idea|work)\/[^\s)]+)\)/gi,(_match,url:string)=>`[${sourceLabel}](${url})`);
}
