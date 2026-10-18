import type { ResearchClaimRecord } from './researchClaimAudit';

export const RESEARCH_SOURCE_CHUNK_RULE = 'Quote keys q1, q2, etc. are transport slices of ONE authorized source, not separate citation destinations. An inline source citation covers ALL its supplied quote slices. Check every slice of that cited source; do not reject a correct link merely because the supporting passage is in q2 rather than q1. Distinct source IDs remain distinct evidence and cannot silently substitute for each other.';

export const RESEARCH_SOURCE_QUALIFICATION_RULE = "Preserve qualifications and the source author's time perspective. A retrospective account of limitations in earlier scholarship is not evidence that those limitations persist today, especially when the same excerpt describes subsequent progress. Describing a public belief or quoting another voice does not imply endorsing it. Never turn that description into an author disagreement or consensus. A source identifying a limitation does not establish its cause: every because/due-to explanation needs evidence for the causal connection itself. Split compound assertions into atomic propositions; a supported first clause never licenses the rest of its sentence or paragraph. Preserve the direction of every relation and hierarchy: A including B never means B includes A. Check both local assertions and the final synthesis for contradictory ordering. Check counterevidence and qualifications in ALL supplied slices before approving a proposition. collectiveCredits=true means all catalogue credits are editors, not necessarily the excerpt speaker. A citation to the edited volume is valid, but a personal thesis cannot be assigned to an editor unless the excerpt identifies that speaker; attribute it to the chapter or volume otherwise. Mixed credits can include real chapter authors. Preserve institutional identity and event time: a passage about a different dictatorship or an earlier institution does not establish an action by the regime in the question. Publication year is not event date.";

export interface ResearchDocumentPart {
  id: string;
  text: string;
  /** The local job of this field, not an obligation to answer the whole investigation. */
  remit: string;
  /** Untrusted context: e.g. the quiz question, choices and correct option. */
  context?: string;
  evidenceIds?: string[];
  strictEvidence?: boolean;
}
export interface ResearchDocumentPartReview {
  id: string;
  text: string;
  status: 'verified' | 'limited';
  claims: ResearchClaimRecord[];
  issues: string[];
}
export interface ResearchDocumentReview {
  parts: ResearchDocumentPartReview[];
  status: 'verified' | 'limited';
  technicalFailure?: string;
}

/** Index/cover/navigation fragments cannot support substantive prose. Their
 * catalogue records remain available independently for bibliographic facts. */
export function researchExcerptHasProse(text: string): boolean {
  const plain = text.replace(/\[p\.\s*[^\]]+\]/gu, '').trim();
  return !(plain.length < 700 && /!\[|imagen de portada|cover image/iu.test(plain)
    && plain.replace(/\[[^\]]*\]\([^)]*\)|[\p{P}\p{S}]/gu, ' ').split(/\s+/u).filter(Boolean).length < 45);
}

/** Batch by actual paragraphs/bytes, not by the number of fields in a form. */
export function researchDocumentBatches(parts: ResearchDocumentPart[], paragraphCount: (text: string) => number, maxParagraphs = 10) {
  const batches: ResearchDocumentPart[][] = [];
  let batch: ResearchDocumentPart[] = [], paragraphs = 0, bytes = 0;
  for (const part of parts) {
    const count = paragraphCount(part.text), size = new TextEncoder().encode(part.text + (part.context ?? '')).length;
    if (batch.length && (batch.length >= 8 || paragraphs + count > maxParagraphs || bytes + size > 16_000)) {
      batches.push(batch); batch = []; paragraphs = 0; bytes = 0;
    }
    batch.push(part); paragraphs += count; bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
