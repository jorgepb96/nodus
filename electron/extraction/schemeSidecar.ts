import { createHash } from 'node:crypto';
import { openPdf, pageTextWithSchemes } from './pdfjsLoader';
import { cleanExtractedText, replaceNulCharacters } from './textCleanup';
import { bodySizeOf, typeSizeWeights, type LayoutItem } from './schemeLayout';
import type { PageLayoutLines } from '@shared/schemeText';

/** Bumped when the classifier changes, so stored layouts are rebuilt. */
export const SCHEME_LAYOUT_VERSION = 1;
const SAMPLE_PAGES = 40;

export interface SchemeLayoutFile {
  version: number;
  /** The book's body type size, from sample pages. */
  body: number;
  /** Hash of a page's extracted text (pageTextHash) → that page's scheme and margin lines. */
  pages: Record<string, PageLayoutLines>;
}

/** The key a page is filed under: its text exactly as extraction stores it, trimmed. */
export function pageTextHash(text: string): string {
  return createHash('sha1').update(text.trim()).digest('hex');
}

/** Reads a PDF's text layer once and records, per page, the lines that are schemes, figure
 *  labels or tables and the margin lines. Pages with neither are left out. */
export async function buildSchemeLayout(filePath: string, signal?: AbortSignal): Promise<SchemeLayoutFile> {
  const pdf = await openPdf(filePath);
  try {
    const total: number = pdf.numPages;
    const weights = new Map<number, number>();
    const samples = Math.min(SAMPLE_PAGES, total);
    for (let k = 0; k < samples; k++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(1 + Math.floor(samples > 1 ? k * (total - 1) / (samples - 1) : 0));
      typeSizeWeights(((await page.getTextContent()).items as LayoutItem[]).filter((item) => typeof item?.str === 'string'), weights);
      page.cleanup?.();
    }
    const body = bodySizeOf(weights);
    const pages: Record<string, PageLayoutLines> = {};
    for (let p = 1; p <= total; p++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(p);
      const { text, schemeLines, marginLines } = await pageTextWithSchemes(page, true, body || undefined);
      page.cleanup?.();
      // The page as extractPdfStreaming stores it (combineSegments then clears NULs).
      const stored = replaceNulCharacters(cleanExtractedText(text));
      if (schemeLines.length || marginLines.length) pages[pageTextHash(stored)] = { scheme: schemeLines, margin: marginLines };
    }
    return { version: SCHEME_LAYOUT_VERSION, body, pages };
  } finally {
    await pdf.destroy?.();
  }
}
