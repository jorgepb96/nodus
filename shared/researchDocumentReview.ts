import type { ResearchClaimRecord } from './researchClaimAudit';

export const RESEARCH_SOURCE_CHUNK_RULE = 'Quote keys q1, q2, etc. are transport slices of ONE authorized source, not separate citation destinations. An inline source citation covers ALL its supplied quote slices. Check every slice of that cited source; do not reject a correct link merely because the supporting passage is in q2 rather than q1. Distinct source IDs remain distinct evidence and cannot silently substitute for each other.';

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
export function researchDocumentBatches(parts: ResearchDocumentPart[], paragraphCount: (text: string) => number) {
  const batches: ResearchDocumentPart[][] = [];
  let batch: ResearchDocumentPart[] = [], paragraphs = 0, bytes = 0;
  for (const part of parts) {
    const count = paragraphCount(part.text), size = new TextEncoder().encode(part.text + (part.context ?? '')).length;
    if (batch.length && (batch.length >= 8 || paragraphs + count > 10 || bytes + size > 16_000)) {
      batches.push(batch); batch = []; paragraphs = 0; bytes = 0;
    }
    batch.push(part); paragraphs += count; bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
