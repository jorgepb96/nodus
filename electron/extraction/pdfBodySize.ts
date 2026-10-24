import type { LayoutItem } from './schemeLayout';
import { schemeClassifier, type SchemeClassifier } from './schemeClassifiers';

const SAMPLE_PAGES = 40;

/** A book's body type size, from up to 40 evenly spaced pages. */
export async function pdfBodySize(pdf: { numPages: number; getPage(page: number): Promise<any> }, signal?: AbortSignal, classifier?: SchemeClassifier): Promise<number> {
  const { typeSizeWeights, bodySizeOf } = schemeClassifier(classifier);
  const weights = new Map<number, number>();
  const total = pdf.numPages;
  const samples = Math.min(SAMPLE_PAGES, total);
  for (let k = 0; k < samples; k++) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(1 + Math.floor(samples > 1 ? k * (total - 1) / (samples - 1) : 0));
    try {
      const content = await page.getTextContent();
      signal?.throwIfAborted();
      typeSizeWeights((content.items as LayoutItem[]).filter((item) => typeof item?.str === 'string' && Array.isArray(item.transform)), weights);
    } finally {
      page.cleanup?.();
    }
  }
  return bodySizeOf(weights);
}
