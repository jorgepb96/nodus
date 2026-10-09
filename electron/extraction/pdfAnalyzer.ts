import { openPdf, pageText } from './pdfjsLoader';
import type { PdfAnalysis, ExtractStrategy } from '@shared/types';

// A page is considered to have a usable text layer if it yields at least this many chars.
const MIN_CHARS_TEXT_PAGE = 50;
const MAX_SAMPLE = 12;

/**
 * Cheap pre-detector: sample evenly-spaced pages to estimate text-layer coverage,
 * then classify the document so the extractor can pick the right strategy without
 * fully parsing (or OCR-ing) a huge PDF up front.
 */
export async function analyzePdf(filePath: string): Promise<PdfAnalysis> {
  const pdf = await openPdf(filePath);
  const pageCount: number = pdf.numPages;

  if (pageCount === 0) {
    await pdf.destroy?.();
    return { pageCount: 0, sampledPages: 0, textPages: 0, textCoverage: 0, avgCharsPerTextPage: 0, strategy: 'empty' };
  }

  // Evenly spaced sample across the document (always includes first + last).
  const sampleCount = Math.min(MAX_SAMPLE, pageCount);
  const indices = new Set<number>();
  for (let i = 0; i < sampleCount; i++) {
    indices.add(Math.max(1, Math.round(1 + (i * (pageCount - 1)) / Math.max(1, sampleCount - 1))));
  }

  let textPages = 0;
  let totalChars = 0;
  try {
    for (const p of indices) {
      // A damaged page object (pdf.js: "Page dictionary kid reference points to wrong type
      // of object") is a page without usable text, not a reason to reject the document.
      let txt = '';
      try {
        const page = await pdf.getPage(p);
        try { txt = await pageText(page); } finally { page.cleanup?.(); }
      } catch {
        txt = '';
      }
      if (txt.length >= MIN_CHARS_TEXT_PAGE) {
        textPages++;
        totalChars += txt.length;
      }
    }
  } finally {
    await pdf.destroy?.();
  }

  const sampledPages = indices.size;
  const textCoverage = sampledPages ? textPages / sampledPages : 0;
  const avgCharsPerTextPage = textPages ? Math.round(totalChars / textPages) : 0;

  let strategy: ExtractStrategy;
  if (textCoverage >= 0.8) strategy = 'digital';
  else if (textCoverage <= 0.1) strategy = 'scanned';
  else strategy = 'hybrid';

  return { pageCount, sampledPages, textPages, textCoverage, avgCharsPerTextPage, strategy };
}
