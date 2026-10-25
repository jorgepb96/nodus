/** File parsers only: no vault, database, settings, or Electron application access. */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { ExtractedDoc, OcrOptions, OnExtractProgress } from './textExtractor';
import type { PdfAnalysis } from '@shared/types';
import type { PerfContext } from '../perf';
import { perfLog, startPerf } from '../perf';
import { openPdf, pageText, pageTextWithSchemes } from './pdfjsLoader';
import { pdfBodySize } from './pdfBodySize';
import type { SchemeClassifier } from './schemeClassifiers';
import { analyzePdf } from './pdfAnalyzer';
import { ocrPdfPages, ocrImageFile } from './ocr';
import { csvFileToText, xlsxFileToText } from './tabular';
import { cleanExtractedText } from './textCleanup';

export interface FileTextExtractionOptions {
  ocr?: OcrOptions;
  declutter?: boolean;
  schemeClassifier?: SchemeClassifier;
  perf?: PerfContext;
  onProgress?: OnExtractProgress;
  signal?: AbortSignal;
}

const MIN_CHARS_TEXT_PAGE = 50;

export function textQualityScore(text: string): number {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length < MIN_CHARS_TEXT_PAGE) return 0;
  const letters = (compact.match(/\p{L}/gu) ?? []).length;
  const controls = [...compact].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 0xfffd || code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  }).length;
  const words = compact.match(/[\p{L}\p{N}]+/gu) ?? [];
  const singletons = words.filter((word) => word.length === 1).length;
  const letterRatio = letters / Math.max(1, compact.length);
  const singletonRatio = singletons / Math.max(1, words.length);
  return Math.max(0, Math.min(1,
    0.65 * Math.min(1, letterRatio / 0.55)
    + 0.35 * (1 - Math.min(1, singletonRatio / 0.35))
    - Math.min(1, controls / Math.max(1, compact.length) * 30)
  ));
}

// ── PDF: streaming extraction with page markers + optional OCR ────────────────

/**
 * Extract a PDF page-by-page (memory-safe for large files). Each page's text is
 * prefixed with a `[[p. N]]` marker so the model can cite accurate locations.
 * Pages without a text layer are OCR-ed when enabled, otherwise skipped + noted.
 */
export async function extractPdfStreaming(
  filePath: string,
  opts: { ocr: OcrOptions; onProgress?: OnExtractProgress; analysis?: PdfAnalysis; perf?: PerfContext; signal?: AbortSignal; declutter?: boolean; schemeClassifier?: SchemeClassifier }
): Promise<ExtractedDoc> {
  opts.signal?.throwIfAborted();
  const analysisDone = opts.analysis ? null : startPerf('PDF analysis', opts.perf, { file: path.basename(filePath) });
  const analysis = opts.analysis ?? (await analyzePdf(filePath));
  analysisDone?.({ strategy: analysis.strategy, pages: analysis.pageCount });

  // Fast exit: a scanned PDF with OCR disabled — don't read hundreds of blank pages.
  if (analysis.strategy === 'scanned' && !opts.ocr.enabled) {
    perfLog('OCR', 0, opts.perf, { status: 'disabled', pages: analysis.pageCount });
    return {
      text: '',
      sourceType: 'pdf',
      analysis,
      notes: `PDF escaneado sin capa de texto (${analysis.pageCount} págs.) y OCR desactivado.`,
      blockReason: 'scanned_no_ocr',
    };
  }
  if (analysis.strategy === 'empty') {
    return { text: '', sourceType: 'pdf', analysis, notes: 'PDF sin páginas legibles.', blockReason: 'unreadable' };
  }

  const extractionDone = startPerf('PDF extraction', opts.perf, { file: path.basename(filePath), pages: analysis.pageCount });
  const pdf = await openPdf(filePath);
  const total: number = pdf.numPages;
  const pageTexts = new Map<number, string>();
  const blanks: number[] = [];
  const lowQuality: number[] = [];
  // Opted-in works: schemes become "[scheme]", margin lines go.
  let body = 0;
  try {
    if (opts.declutter) body = await pdfBodySize(pdf, opts.signal, opts.schemeClassifier);
  } catch (error) {
    await pdf.destroy?.();
    throw error;
  }
  const layerQuality = new Map<number, number>();
  /** Pages pdf.js cannot open at all (a damaged page object). They have no text and cannot
   * be rendered for OCR either; the rest of the document is still read. */
  const damaged = new Set<number>();
  if (opts.declutter) perfLog('scheme declutter', 0, opts.perf, { file: path.basename(filePath), body });

  for (let p = 1; p <= total; p++) {
    if (opts.signal?.aborted) {
      await pdf.destroy?.();
      opts.signal.throwIfAborted();
    }
    opts.onProgress?.({ phase: 'extract', detail: `Extrayendo p. ${p}/${total}`, pct: p / total });
    let txt: string;
    let layered: Awaited<ReturnType<typeof pageTextWithSchemes>> | null;
    try {
      const page = await pdf.getPage(p);
      try {
        // Blank and low-quality pages (sent to OCR) are judged on the page's full text layer: a page
        // that is mostly scheme is short once decluttered, and OCR would only read the scheme back.
        layered = opts.declutter ? await pageTextWithSchemes(page, true, body || undefined, opts.schemeClassifier) : null;
        txt = cleanExtractedText(layered ? layered.text : await pageText(page));
      } finally {
        page.cleanup?.();
      }
    } catch (error) {
      console.warn(`[extractPdfStreaming] p. ${p} unreadable: ${error instanceof Error ? error.message : String(error)}`);
      damaged.add(p);
      blanks.push(p);
      continue;
    }
    if (txt.length >= MIN_CHARS_TEXT_PAGE) {
      pageTexts.set(p, layered ? cleanExtractedText(layered.declutteredText) : txt);
      layerQuality.set(p, textQualityScore(txt));
      if (textQualityScore(txt) < 0.45) lowQuality.push(p);
    } else blanks.push(p);
  }
  extractionDone({ textPages: pageTexts.size, blankPages: blanks.length, lowQualityPages: lowQuality.length });

  let ocredPages = 0;
  let ocrFailed = false;
  const ocrReadPages = new Set<number>();
  const ocrCandidates = [...blanks.filter((page) => !damaged.has(page)), ...lowQuality].slice(0, opts.ocr.maxPages);
  if (opts.ocr.enabled && ocrCandidates.length) {
    const toOcr = ocrCandidates;
    const ocrDone = startPerf('OCR', opts.perf, { pages: toOcr.length, languages: opts.ocr.languages });
    try {
      const map = await ocrPdfPages(pdf, toOcr, opts.ocr.languages, ({ page, totalPages }) =>
        {
          opts.signal?.throwIfAborted();
          // The counter covers the pages this pass re-reads, not the document, and this
          // pass runs after the sweep that already walked every page: reporting it as a
          // fraction of `totalPages` made the bar's percentage fall back from 100% to
          // 1/K. The label still ticks page by page.
          opts.onProgress?.({ phase: 'ocr', detail: `OCR p. ${page}/${totalPages}`, pct: null });
        },
        // A page OCR could not read keeps the pass going; the document is still marked
        // incomplete, so it is not cached and a later scan tries that page again.
        { onPageError: (page, error) => {
          ocrFailed = true;
          console.warn(`[extractPdfStreaming] OCR failed on p. ${page}: ${error instanceof Error ? error.message : String(error)}`);
        } },
      );
      opts.signal?.throwIfAborted();
      for (const [p, result] of map) {
        ocrReadPages.add(p);
        const cleaned = cleanExtractedText(result.text ?? '');
        if (cleaned.length >= MIN_CHARS_TEXT_PAGE) {
          const previous = layerQuality.get(p);
          if (previous === undefined || textQualityScore(cleaned) > previous + 0.05) {
            pageTexts.set(p, cleaned);
            ocredPages++;
          }
        }
      }
      ocrDone({ recoveredPages: ocredPages, skippedPages: blanks.filter((page) => !pageTexts.has(page)).length });
    } catch (e) {
      if (opts.signal?.aborted) {
        await pdf.destroy?.();
        throw e;
      }
      // OCR deps missing or failed — keep whatever digital text we have.
      ocrFailed = true;
      ocrDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  } else if (blanks.length) {
    perfLog('OCR', 0, opts.perf, { status: opts.ocr.enabled ? 'no_pages' : 'disabled', blankPages: blanks.length });
  }

  await pdf.destroy?.();

  // Assemble in page order with markers.
  const parts: string[] = [];
  for (let p = 1; p <= total; p++) {
    const t = pageTexts.get(p);
    if (t) parts.push(`[[p. ${p}]]\n${t}`);
  }

  // Selection proves a page was within the cap, but does not prove OCR processed it:
  // a missing worker or a mid-batch failure can prevent any page results returning.
  const ocrSelected = new Set(opts.ocr.enabled ? ocrCandidates : []);
  const unrecovered = blanks.filter((page) => !pageTexts.has(page));
  const capped = opts.ocr.enabled ? unrecovered.filter((page) => !ocrSelected.has(page) && !damaged.has(page)).length : 0;
  const readWithoutText = unrecovered.filter((page) => ocrReadPages.has(page)).length;
  const unresolved = unrecovered.length - capped - readWithoutText;
  const notes: string[] = [];
  if (ocredPages) notes.push(`${ocredPages} página(s) recuperadas por OCR.`);
  if (capped) notes.push(`${capped} página(s) no procesadas: superan el límite de OCR (${opts.ocr.maxPages} páginas por documento).`);
  if (readWithoutText) notes.push(`${readWithoutText} página(s) sin texto omitidas.`);
  if (unresolved) notes.push(`${unresolved} página(s) sin texto recuperado${opts.ocr.enabled ? '.' : ': OCR desactivado.'}`);
  if (ocrFailed) notes.push('OCR no completado.');

  return {
    text: parts.join('\n\n'),
    sourceType: 'pdf',
    analysis,
    notes: notes.length ? notes.join(' ') : null,
    ...(ocrFailed ? { ocrFailed: true } : {}),
  };
}

export async function extractDocx(filePath: string): Promise<string> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value as string) ?? '';
}

export function extractTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

/** Raster image formats Nodus can OCR directly (a scan, a photographed record). */
const IMAGE_EXT_RE = /\.(png|jpe?g|tiff?|webp|bmp)$/i;

/**
 * Extract text from a standalone image via OCR. OCR is opt-in (like scanned PDFs):
 * with it disabled the image yields no text but is still recorded with a note. A
 * richer AI vision description belongs to the evidence archive (phase B), not this
 * deterministic, content-hash-cached extractor.
 */
async function extractImage(
  filePath: string,
  ocr: OcrOptions,
  onProgress?: OnExtractProgress,
  perf?: PerfContext
): Promise<ExtractedDoc> {
  if (!ocr.enabled) {
    return { text: '', sourceType: 'upload', notes: 'Imagen sin capa de texto y OCR desactivado.', blockReason: 'scanned_no_ocr' };
  }
  onProgress?.({ phase: 'ocr', detail: 'OCR de imagen…', pct: null });
  const done = startPerf('image OCR', perf, { file: path.basename(filePath), languages: ocr.languages });
  try {
    const text = await ocrImageFile(filePath, ocr.languages);
    done({ chars: text.length });
    return {
      text,
      sourceType: 'upload',
      notes: text ? 'Texto reconocido por OCR.' : 'Imagen sin texto reconocible por OCR.',
      blockReason: text ? undefined : 'unreadable',
    };
  } catch (e) {
    // OCR deps missing or failed — record the image without text rather than throw.
    done({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    return { text: '', sourceType: 'upload', notes: 'OCR de imagen no disponible.', blockReason: 'unreadable' };
  }
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[lower] ?? entity;
  });
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
  ).trim();
}

function xmlAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) attrs[match[1]] = decodeHtmlEntities(match[2] ?? match[3] ?? '');
  return attrs;
}

function zipText(zip: AdmZip, entryName: string): string | null {
  const entry = zip.getEntry(entryName);
  if (!entry || entry.isDirectory) return null;
  return entry.getData().toString('utf8');
}

function normalizeZipPath(filePath: string): string {
  return filePath.replace(/^\/+/, '').replace(/\\/g, '/');
}

function joinZipPath(base: string, relative: string): string {
  return normalizeZipPath(path.posix.normalize(path.posix.join(base, relative)));
}

function epubReadingOrder(zip: AdmZip): string[] {
  const container = zipText(zip, 'META-INF/container.xml');
  const rootfileTag = container?.match(/<rootfile\b[^>]*>/i)?.[0];
  const rootfile = rootfileTag ? xmlAttrs(rootfileTag)['full-path'] : null;
  if (!rootfile) return [];
  const opf = rootfile ? zipText(zip, normalizeZipPath(rootfile)) : null;
  if (!opf) return [];

  const base = path.posix.dirname(normalizeZipPath(rootfile));
  const manifest = new Map<string, string>();
  for (const item of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const attrs = xmlAttrs(item);
    if (attrs.id && attrs.href) manifest.set(attrs.id, joinZipPath(base === '.' ? '' : base, attrs.href));
  }

  const order: string[] = [];
  for (const itemref of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = xmlAttrs(itemref).idref;
    const href = idref ? manifest.get(idref) : null;
    if (href && /\.(xhtml|html?|xml)$/i.test(href)) order.push(href);
  }
  return order;
}

export function extractEpub(filePath: string): string {
  const zip = new AdmZip(filePath);
  const ordered = epubReadingOrder(zip);
  const fallback = zip
    .getEntries()
    .map((entry) => normalizeZipPath(entry.entryName))
    .filter((entry) => /\.(xhtml|html?)$/i.test(entry) && !/(^|\/)(nav|toc)\.(xhtml|html?)$/i.test(entry))
    .sort((a, b) => a.localeCompare(b));

  const files = ordered.length > 0 ? ordered : fallback;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const html = zipText(zip, file);
    if (!html) continue;
    const text = htmlToText(html);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/** Called inside the owned process in Electron. Cache and policy stay with the caller. */
export async function extractFileText(filePath: string, opts: FileTextExtractionOptions = {}): Promise<ExtractedDoc> {
  opts.signal?.throwIfAborted();
  const ext = path.extname(filePath).toLowerCase();
  const ocr = opts.ocr ?? { enabled: false, languages: 'spa+eng', maxPages: 300 };
  const declutter = ext === '.pdf' && opts.declutter === true;
  let doc: ExtractedDoc;
  if (ext === '.pdf') {
    opts.onProgress?.({ phase: 'analyze', detail: 'Analizando PDF…', pct: null });
    const analysisDone = startPerf('PDF analysis', opts.perf, { file: path.basename(filePath) });
    const analysis = await analyzePdf(filePath);
    analysisDone({ strategy: analysis.strategy, pages: analysis.pageCount });
    doc = await extractPdfStreaming(filePath, { ocr, onProgress: opts.onProgress, analysis, perf: opts.perf, signal: opts.signal, declutter, ...(opts.schemeClassifier ? { schemeClassifier: opts.schemeClassifier } : {}) });
  } else if (ext === '.docx') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'docx' });
    doc = { text: await extractDocx(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.epub') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'epub' });
    doc = { text: extractEpub(filePath), sourceType: 'epub', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.md' || ext === '.markdown') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'markdown' });
    doc = { text: extractTextFile(filePath), sourceType: 'markdown', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.txt') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'txt' });
    doc = { text: extractTextFile(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.csv') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'csv' });
    doc = { text: csvFileToText(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else if (ext === '.xlsx') {
    const done = startPerf('document extraction', opts.perf, { file: path.basename(filePath), type: 'xlsx' });
    doc = { text: xlsxFileToText(filePath), sourceType: 'upload', notes: null };
    done({ chars: doc.text.length });
  } else if (IMAGE_EXT_RE.test(ext)) {
    doc = await extractImage(filePath, ocr, opts.onProgress, opts.perf);
  } else {
    throw new Error(`Tipo de archivo no soportado: ${ext}`);
  }

  opts.signal?.throwIfAborted();
  return doc;
}
