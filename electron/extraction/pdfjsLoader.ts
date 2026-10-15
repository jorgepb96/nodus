import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type LayoutItem } from './schemeLayout';
import { schemeClassifier, type SchemeClassifier } from './schemeClassifiers';
import { SCHEME_PLACEHOLDER } from '@shared/schemeText';

// Single place to load the pdfjs legacy build (no DOM) and open a document.
// pdfjs is an ESM-only package; dynamic import keeps it external to the main bundle.
export async function loadPdfjs(): Promise<any> {
  // The import() is hidden inside new Function so CJS transpilers (the headless
  // scripts/ harness) don't rewrite it to require(), which crashes on an
  // ESM-only package. But code built by new Function has no module referrer —
  // a bare specifier would resolve from process.cwd(), which is "/" when the
  // packaged app is launched from the desktop. Resolve to an absolute file URL
  // from this module's location first. (__filename exists in both worlds: the
  // vite banner defines it for the ESM main bundle, CJS provides it natively.)
  const entry = createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  return dynamicImport(pathToFileURL(entry).href);
}

export async function openPdf(filePath: string, options: { forRendering?: boolean } = {}): Promise<any> {
  return openPdfData(new Uint8Array(fs.readFileSync(filePath)), options);
}

/** Open a PDF already in memory (a downloaded web source, never written to disk). */
export async function openPdfData(data: Uint8Array, options: { forRendering?: boolean } = {}): Promise<any> {
  const pdfjs = await loadPdfjs();
  const requireFromHere = createRequire(__filename);
  const pdfjsRoot = path.dirname(requireFromHere.resolve('pdfjs-dist/package.json'));
  // Supplying PDF.js' bundled standard fonts is essential for raster output.
  // Without it, PDFs using Helvetica/Times can expose a valid text layer while
  // rendering blank glyphs in the Node canvas used by facsimile translation.
  const fontDirectory = path.join(pdfjsRoot, 'standard_fonts') + path.sep;
  const standardFontDataUrl = options.forRendering ? fontDirectory : pathToFileURL(fontDirectory).href;
  const task = pdfjs.getDocument({ data, useSystemFonts: !options.forRendering, standardFontDataUrl, isEvalSupported: false, disableFontFace: true });
  return task.promise;
}

/** Rebuild page lines before normalising them. Flattening every PDF.js item with a
 * space destroys real line endings, prevents safe de-hyphenation and can split words. */
export async function pageText(page: any): Promise<string> {
  return (await pageTextWithSchemes(page, false)).text;
}

/** The page text, and with `layout` the lines of it that are reaction schemes, figure labels or
 *  tables and the margin lines (see schemeLayout.ts). `text` is exactly what pageText returns;
 *  `declutteredText` has each run of scheme lines as one "[scheme]" and no margin lines. */
export async function pageTextWithSchemes(page: any, layout = true, bodyHint?: number, classifier?: SchemeClassifier): Promise<{ text: string; declutteredText: string; schemeLines: string[]; marginLines: string[] }> {
  const content = await page.getTextContent();
  const items = content.items as any[];
  const flags = layout ? schemeClassifier(classifier).pageSchemeLayout(items.filter(isLayoutItem), bodyHint) : null;
  const kindOf = new Map<any, 'scheme' | 'margin'>();
  if (flags) items.filter(isLayoutItem).forEach((item, index) => { if (flags.margin[index]) kindOf.set(item, 'margin'); else if (flags.scheme[index]) kindOf.set(item, 'scheme'); });
  const lines: string[] = [];
  const lineKind: Array<'scheme' | 'margin' | null> = [];
  let line = '';
  let kind: 'scheme' | 'margin' | null = 'margin';
  let lastY: number | null = null;
  let lastEndX: number | null = null;
  let lineHeight = 8;
  const flush = () => {
    const value = line.replace(/[\t ]+/g, ' ').trim();
    if (value) { lines.push(value); lineKind.push(kind); }
    line = '';
    kind = 'margin';
    lastEndX = null;
  };
  for (const item of items) {
    const value = typeof item?.str === 'string' ? item.str : '';
    if (!value) {
      if (item?.hasEOL) flush();
      continue;
    }
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const height = Math.abs(Number(item.height) || Number(transform[3]) || lineHeight);
    const changedLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > Math.max(2, Math.min(lineHeight, height) * 0.45);
    if (changedLine) flush();
    const gap = lastEndX !== null && Number.isFinite(x) ? x - lastEndX : Number.POSITIVE_INFINITY;
    const needsSpace = Boolean(line) && (gap > Math.max(0.5, height * 0.08) || /\s$/u.test(line) || /^\s/u.test(value));
    line += `${needsSpace ? ' ' : ''}${value.trim()}`;
    // A line is margin when all of it is, a scheme when all of it is scheme or margin.
    if (value.trim() && kind) kind = !kindOf.get(item) ? null : kindOf.get(item) === 'scheme' ? 'scheme' : kind;
    lastY = Number.isFinite(y) ? y : lastY;
    lastEndX = Number.isFinite(x) ? x + Math.max(0, Number(item.width) || 0) : null;
    lineHeight = height || lineHeight;
    if (item?.hasEOL) flush();
  }
  flush();

  const joined: string[] = [];
  const joinedKind: Array<'scheme' | 'margin' | null> = [];
  lines.forEach((current, index) => {
    const previous = joined.at(-1);
    if (previous && /\p{L}-$/u.test(previous) && /^\p{Ll}/u.test(current)) {
      joined[joined.length - 1] = `${previous.slice(0, -1)}${current}`;
      const [a, b] = [joinedKind[joined.length - 1], lineKind[index]];
      joinedKind[joined.length - 1] = !a || !b ? null : a === 'scheme' || b === 'scheme' ? 'scheme' : 'margin';
    } else {
      joined.push(current);
      joinedKind.push(lineKind[index]);
    }
  });
  const of = (wanted: 'scheme' | 'margin') => flags ? joined.filter((_, index) => joinedKind[index] === wanted) : [];
  const decluttered: string[] = [];
  joined.forEach((current, index) => {
    const kind = flags ? joinedKind[index] : null;
    if (kind === 'margin') return;
    if (kind === 'scheme') { if (decluttered.at(-1) !== SCHEME_PLACEHOLDER) decluttered.push(SCHEME_PLACEHOLDER); return; }
    decluttered.push(current);
  });
  return { text: joined.join('\n').trim(), declutteredText: decluttered.join('\n').trim(), schemeLines: of('scheme'), marginLines: of('margin') };
}

function isLayoutItem(item: any): item is LayoutItem {
  return typeof item?.str === 'string' && Array.isArray(item.transform);
}
