import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type {
  DeepContextMode,
  SourceType,
  PdfAnalysis,
  TextSourceOrigin,
  ResolvedTextState,
  WorkTextSource,
  TextBlockReason,
} from '@shared/types';
import { itemChildren, itemAsAttachment, getFulltext, attachmentFilePath, ZoteroAttachment, ZoteroRequestError } from '../zotero/zoteroClient';
import { declutterCacheKey, schemeClassifierForWorkSource } from './schemeDeclutter';
import type { SchemeClassifier } from './schemeClassifiers';
import { getSettings } from '../db/settingsRepo';
import { getExtractionCache, upsertExtractionCache } from '../db/extractionCacheRepo';
import { perfLog, startPerf, type PerfContext } from '../perf';
import { extractFileText } from './fileTextExtraction';
export { extractPdfStreaming, extractDocx, extractTextFile, extractEpub, textQualityScore } from './fileTextExtraction';
import { getLibraryReaderRawContent } from '../libraryReader/libraryReaderStore';
import { libraryMarkdownWithPageMarkers, readDocumentarySourceMap } from '../library/librarySourcePages';
import { cleanExtractedText, replaceNulCharacters } from './textCleanup';
import type { PipelineLogReasonId } from '@shared/pipelineLogMessages';
import { logPipelineWarning } from '../logging/pipelineLogCore';

export interface ExtractedDoc {
  text: string;
  sourceType: SourceType;
  notes: string | null;
  analysis?: PdfAnalysis;
  /**
   * True when the Zotero item exposes a document attachment (PDF/EPUB/…), even if
   * it could not be read on this pass. Lets the pipeline distinguish "no full text
   * exists" from "full text should exist but wasn't ready yet" and retry the latter.
   */
  hadTextAttachment?: boolean;
  blockReason?: TextBlockReason | null;
  /** An incomplete OCR batch must be retried rather than reused from extraction cache. */
  ocrFailed?: boolean;
  segments?: ExtractedTextSegment[];
}

export interface ExtractedTextSegment {
  sourceRef: string;
  marker: string;
  origin: TextSourceOrigin;
  sourceType: SourceType;
  zoteroLibraryId: string | null;
  attachmentKey: string | null;
  displayName: string | null;
  text: string;
  contentHash: string;
  pageCount: number | null;
  hasPageMarkers: boolean;
}

export interface ExtractProgress {
  phase: 'analyze' | 'fulltext' | 'extract' | 'ocr' | 'download';
  detail: string;
  pct: number | null; // 0..1 when known
}
export type OnExtractProgress = (p: ExtractProgress) => void;

export interface OcrOptions {
  enabled: boolean;
  languages: string;
  maxPages: number;
}

const MIN_USABLE_ALPHA_CHARS = 200;
// A freshly-attached file can take a moment to surface through the local Zotero API
// (its attachment child, filename, or on-disk copy), so we retry a couple of times
// before concluding a work has no readable full text.
const ATTACHMENT_READ_ATTEMPTS = 3;
const ATTACHMENT_RETRY_DELAYS_MS = [0, 900, 2200];
const STANDARD_CHUNK_WORDS = 1800;
const STANDARD_OVERLAP_WORDS = 100;
const LONG_CHUNK_WORDS = 30000;
export { planRetrievalChunks, RETRIEVAL_CHUNK_WORDS, RETRIEVAL_OVERLAP_WORDS } from '@shared/retrievalChunks';
export type { RetrievalChunk } from '@shared/retrievalChunks';

export interface ChunkOptions {
  mode?: DeepContextMode;
  standardChunkWords?: number;
  longChunkWords?: number;
}

export interface ChunkPlan {
  chunks: string[];
  mode: DeepContextMode;
  wordCount: number;
  chunkWords: number;
  overlapWords: number;
  maxIdeasPerChunk: number;
  maxRelationsPerChunk: number;
  maxGapsPerChunk: number;
}

function textHash(text: string): string {
  // Keep the aggregate comparable with deep_hash and passage content_hash.
  return crypto.createHash('sha1').update(text).digest('hex');
}

function hasUsableText(text: string): boolean {
  return (text.match(/\p{L}/gu) ?? []).length >= MIN_USABLE_ALPHA_CHARS;
}

function sourceRefForAttachment(att: ZoteroAttachment): string {
  return `zotero:${att.library.type}:${att.library.id}:${att.itemKey}`;
}

function sourceMarkedText(text: string, marker: string): string {
  const replaced = text.replace(/\[\[p\.\s*(\d+)\]\]/gi, `[[src:${marker} p.$1]]`);
  return /\[\[src:/i.test(replaced) ? replaced : `[[src:${marker}]]\n${replaced}`;
}

export function combineSegments(segments: ExtractedTextSegment[], notes: string | null, hadTextAttachment: boolean): ExtractedDoc {
  const unique: ExtractedTextSegment[] = [];
  const hashes = new Set<string>();
  for (const segment of segments) {
    if (hashes.has(segment.contentHash)) continue;
    hashes.add(segment.contentHash);
    const marker = `s${unique.length + 1}`;
    unique.push({ ...segment, text: replaceNulCharacters(segment.text), marker });
  }
  const text = unique.map((segment) => sourceMarkedText(segment.text, segment.marker)).join('\n\n');
  return {
    text,
    sourceType: unique[0]?.sourceType ?? 'none',
    notes,
    analysis: undefined,
    hadTextAttachment,
    segments: unique,
  };
}

export function resolvedTextStateFromDoc(doc: ExtractedDoc): ResolvedTextState {
  const now = new Date().toISOString();
  const segments = doc.segments ?? (doc.text.trim() ? [{
    sourceRef: `extracted:${textHash(doc.text).slice(0, 24)}`,
    marker: 's1',
    origin: 'uploaded_file' as const,
    sourceType: doc.sourceType,
    zoteroLibraryId: null,
    attachmentKey: null,
    displayName: null,
    text: doc.text,
    contentHash: textHash(doc.text),
    pageCount: doc.analysis?.pageCount ?? null,
    hasPageMarkers: /\[\[p\.\s*\d+\]\]/i.test(doc.text),
  }] : []);
  const sourceTypes = new Set(segments.map((segment) => segment.sourceType));
  const sources: WorkTextSource[] = segments.map((segment, ordinal) => ({
    nodus_id: '',
    source_ref: segment.sourceRef,
    origin: segment.origin,
    source_type: segment.sourceType,
    zotero_library_id: segment.zoteroLibraryId,
    attachment_key: segment.attachmentKey,
    display_name: segment.displayName,
    content_hash: segment.contentHash,
    char_count: segment.text.length,
    page_count: segment.pageCount,
    has_page_markers: segment.hasPageMarkers ? 1 : 0,
    ordinal,
    active: 1,
    resolved_at: now,
  }));
  const sourceType = sourceTypes.size > 1 ? 'mixed' : segments[0]?.sourceType ?? doc.sourceType;
  const fullText = sourceType !== 'none' && sourceType !== 'abstract_only';
  const blockReason: ResolvedTextState['blockReason'] = fullText
    ? null
    : doc.blockReason
      ?? (sourceType === 'abstract_only' ? 'abstract_only' : doc.hadTextAttachment ? 'unreadable' : 'no_attachment');
  return {
    sourceType,
    textHash: doc.text ? textHash(doc.text) : null,
    textChars: doc.text.length,
    sourceCount: sources.length,
    hasPageMarkers: sources.some((source) => Boolean(source.has_page_markers)),
    blockReason,
    notes: doc.notes,
    resolvedAt: now,
    sources,
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('AbortError'));
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function chunkConfig(opts: ChunkOptions = {}): {
  mode: DeepContextMode;
  chunkWords: number;
  overlapWords: number;
  maxIdeasPerChunk: number;
  maxRelationsPerChunk: number;
  maxGapsPerChunk: number;
} {
  const mode = opts.mode === 'long' ? 'long' : 'standard';
  if (mode === 'long') {
    const chunkWords = clampInt(opts.longChunkWords, LONG_CHUNK_WORDS, 5000, 50000);
    const overlapWords = clampInt(Math.round(chunkWords * 0.02), 600, 200, 1000);
    const maxIdeasPerChunk = clampInt(Math.ceil(chunkWords / 4000), 8, 6, 16);
    return {
      mode,
      chunkWords,
      overlapWords,
      maxIdeasPerChunk,
      maxRelationsPerChunk: Math.max(8, Math.round(maxIdeasPerChunk * 1.5)),
      maxGapsPerChunk: Math.min(4, Math.max(2, Math.ceil(maxIdeasPerChunk / 4))),
    };
  }
  const chunkWords = clampInt(opts.standardChunkWords, STANDARD_CHUNK_WORDS, 500, 5000);
  return {
    mode,
    chunkWords,
    overlapWords: STANDARD_OVERLAP_WORDS,
    maxIdeasPerChunk: 4,
    maxRelationsPerChunk: 5,
    maxGapsPerChunk: 2,
  };
}

/** Split long text into bounded chunks with a small overlap for reliable LLM JSON output. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  return planTextChunks(text, opts).chunks;
}

export function planTextChunks(text: string, opts: ChunkOptions = {}): ChunkPlan {
  const config = chunkConfig(opts);
  const rawTokens = text.match(/\[\[src:[^\]\s]+(?:\s+p\.\s*\d+)?\]\]|\[\[p\.\s*\d+\]\]|\S+/gi) ?? [];
  const words: Array<{ value: string; marker: string | null; source: string | null }> = [];
  let marker: string | null = null;
  let source: string | null = null;
  for (const token of rawTokens) {
    const sourceMarker = /^\[\[src:([^\]\s]+)(?:\s+p\.\s*\d+)?\]\]$/i.exec(token);
    if (sourceMarker) {
      marker = token;
      source = sourceMarker[1];
      continue;
    }
    if (/^\[\[p\.\s*\d+\]\]$/i.test(token)) {
      marker = token;
      continue;
    }
    words.push({ value: token, marker, source });
  }
  if (words.length === 0) return { ...config, chunks: [], wordCount: 0 };
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    let sourceEnd = start + 1;
    while (sourceEnd < words.length && words[sourceEnd].source === words[start].source) sourceEnd++;
    const end = Math.min(start + config.chunkWords, sourceEnd);
    const out: string[] = [];
    let emittedMarker: string | null = null;
    for (const word of words.slice(start, end)) {
      if (word.marker && word.marker !== emittedMarker) {
        out.push(word.marker);
        emittedMarker = word.marker;
      }
      out.push(word.value);
    }
    chunks.push(out.join(' '));
    if (end >= sourceEnd) start = sourceEnd;
    else start = Math.max(start + 1, end - config.overlapWords);
  }
  return { ...config, chunks, wordCount: words.length };
}

export async function extractFromPath(
  filePath: string,
  opts: { ocr?: OcrOptions; onProgress?: OnExtractProgress; perf?: PerfContext; signal?: AbortSignal; declutter?: boolean; schemeClassifier?: SchemeClassifier } = {}
): Promise<ExtractedDoc> {
  opts.signal?.throwIfAborted();
  const ext = path.extname(filePath).toLowerCase();
  const ocr = opts.ocr ?? { enabled: false, languages: 'spa+eng', maxPages: 300 };
  const stat = fs.statSync(filePath);
  // The caller passes this work/attachment's durable choice. A bare file path
  // never enables decluttering for other works or tools that happen to read it.
  const declutter = ext === '.pdf' && opts.declutter === true;
  const cacheKey = { filePath: declutter ? declutterCacheKey(filePath, opts.schemeClassifier) : filePath, fileSize: stat.size, fileMtimeMs: stat.mtimeMs, ocr };
  const cacheLookupDone = startPerf('extraction cache lookup', opts.perf, { file: path.basename(filePath) });
  const cached = getExtractionCache(cacheKey);
  cacheLookupDone({ hit: Boolean(cached), size: stat.size });
  if (cached) return cached;

  // Awaiting a PDF API does not move its parsing off Electron's main event loop.
  // Source-level Node fixtures retain the inline path; a desktop build must have its worker.
  const doc = process.type === 'browser'
    ? await (await import('./textExtractionWorkerHost')).extractFileTextInWorker(filePath, opts)
    : await extractFileText(filePath, opts);
  opts.signal?.throwIfAborted();
  if (!doc.ocrFailed) {
    upsertExtractionCache(cacheKey, doc);
    perfLog('extraction cache write', 0, opts.perf, { file: path.basename(filePath), chars: doc.text.length });
  }
  return doc;
}

/** Best-effort default Zotero storage folder, used when the user left the path blank. */
export function defaultZoteroStorage(): string {
  const candidates = [
    path.join(os.homedir(), 'Zotero', 'storage'),
    path.join(os.homedir(), 'Documents', 'Zotero', 'storage'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function attachmentSourceType(att: ZoteroAttachment): SourceType {
  const ct = (att.contentType ?? '').toLowerCase();
  const fn = (att.filename ?? '').toLowerCase();
  if (ct === 'application/pdf' || fn.endsWith('.pdf')) return 'pdf';
  if (ct === 'application/epub+zip' || fn.endsWith('.epub')) return 'epub';
  if (fn.endsWith('.md') || fn.endsWith('.markdown') || ct === 'text/markdown') return 'markdown';
  return 'upload';
}

/** Extensions Nodus can extract text from directly (mirrors extractFromPath). */
const TEXT_FILE_EXT_RE = /\.(pdf|epub|txt|md|markdown|docx)$/i;

/** Only document-like attachments are legitimate full-text sources. HTML snapshots and images are excluded. */
export function isTextAttachment(att: ZoteroAttachment): boolean {
  const ct = att.contentType ?? '';
  if (ct === 'application/pdf') return true;
  if (ct === 'application/epub+zip') return true;
  if (ct === 'text/plain' || ct === 'text/markdown') return true;
  if (ct.startsWith('text/html')) return false; // web snapshots
  if (ct.startsWith('image/')) return false;
  if (att.linkMode === 'imported_url') return false;
  const fn = att.filename ?? '';
  return TEXT_FILE_EXT_RE.test(fn);
}

export interface ResolveOptions {
  allowExternalRetrieval?: boolean;
  unpaywallEmail: string;
  preferZoteroFulltext: boolean;
  ocr: OcrOptions;
  onProgress?: OnExtractProgress;
  perf?: PerfContext;
  signal?: AbortSignal;
}

export interface TextAvailabilityProbe {
  available: boolean;
  sourceType: SourceType | null;
  reason: 'zotero_fulltext' | 'local_file' | 'none';
}

async function textAttachmentsFor(userId: string, zoteroKey: string, itemType?: string | null): Promise<ZoteroAttachment[]> {
  let attachments: ZoteroAttachment[] = [];
  if ((itemType ?? '').toLowerCase() === 'attachment') {
    const self = await itemAsAttachment(userId, zoteroKey);
    if (self) attachments = [self];
  } else {
    // Do NOT swallow a connection failure here: an unreachable Zotero is not
    // evidence that the item has no attachment. Callers must distinguish the two
    // (see `isZoteroUnreachable`) so a transient outage is never recorded as
    // `no_attachment` and the work is retried instead of skipped.
    attachments = await itemChildren(userId, zoteroKey);
  }
  return attachments.filter(isTextAttachment);
}

/** True when the failure means "we could not ask Zotero", not "Zotero said no". */
export function isZoteroUnreachable(error: unknown): boolean {
  return error instanceof ZoteroRequestError && error.retryable;
}

/**
 * Cheaply check whether a previously skipped work now has text available. This
 * avoids re-queueing every historical `skipped_no_text` row on each sync while
 * still recovering works once Zotero has indexed their attachment.
 */
export async function probeWorkTextAvailability(
  userId: string,
  zoteroKey: string,
  storagePath: string,
  opts: { preferZoteroFulltext: boolean; itemType?: string | null }
): Promise<TextAvailabilityProbe> {
  let textAttachments: ZoteroAttachment[];
  try {
    textAttachments = await textAttachmentsFor(userId, zoteroKey, opts.itemType);
  } catch {
    // Zotero unreachable (or an unreadable response): availability is unknown.
    // Report "not available now" without recording anything: the next sync will
    // probe again once the local API answers, rather than poisoning the work with
    // a false negative.
    return { available: false, sourceType: null, reason: 'none' };
  }
  const effectiveStorage = storagePath || defaultZoteroStorage();
  for (const att of textAttachments) {
    let filePath = await attachmentFilePath(userId, att.key).catch(() => null);
    if (!filePath && att.filename && effectiveStorage) {
      const fallback = path.join(effectiveStorage, att.itemKey, att.filename);
      if (fs.existsSync(fallback)) filePath = fallback;
    }
    if (filePath && fs.existsSync(filePath) && TEXT_FILE_EXT_RE.test(filePath)) {
      return { available: true, sourceType: attachmentSourceType(att), reason: 'local_file' };
    }
  }
  if (opts.preferZoteroFulltext) {
    for (const att of textAttachments) {
      const ft = await getFulltext(userId, att.key).catch(() => null);
      if (ft && hasUsableText(ft.content)) {
        return { available: true, sourceType: attachmentSourceType(att), reason: 'zotero_fulltext' };
      }
    }
  }
  return { available: false, sourceType: null, reason: 'none' };
}

/** Resolve every local attachment first; Zotero full text is only the per-file
 * fallback when that canonical file is missing or unreadable. Returns the combined
 * source-aware document, or null with the most useful extraction note. */
async function readTextAttachments(
  textAttachments: ZoteroAttachment[],
  userId: string,
  effectiveStorage: string,
  opts: ResolveOptions,
  workKey: string,
): Promise<{ doc: ExtractedDoc | null; scanNote: string | null; blockReason: TextBlockReason | null }> {
  // The file is the source of truth for citations. Zotero's index is consulted only
  // for an attachment whose local file is absent or unusable, and never supplies pages.
  const segments: ExtractedTextSegment[] = [];
  const notes: string[] = [];
  let scanNote: string | null = null;
  let blockReason: TextBlockReason | null = null;
  const ordered = [...textAttachments].sort((a, b) => sourceRefForAttachment(a).localeCompare(sourceRefForAttachment(b)));
  for (const att of ordered) {
    opts.signal?.throwIfAborted();
    let localDoc: ExtractedDoc | null = null;
    let filePath = await attachmentFilePath(userId, att.key).catch(() => null);
    if (!filePath && att.filename && effectiveStorage) {
      const fallback = path.join(effectiveStorage, att.itemKey, att.filename);
      if (fs.existsSync(fallback)) filePath = fallback;
    }
    if (filePath && fs.existsSync(filePath)) {
      try {
        const classifier = path.extname(filePath).toLowerCase() === '.pdf'
          ? schemeClassifierForWorkSource(workKey, sourceRefForAttachment(att), getSettings().declutterNewDocuments !== false)
          : null;
        localDoc = await extractFromPath(filePath, { ocr: opts.ocr, onProgress: opts.onProgress, perf: opts.perf, signal: opts.signal, declutter: classifier !== null, ...(classifier ? { schemeClassifier: classifier } : {}) });
      } catch (error) {
        console.error(`[resolveWorkText] Error extracting from ${filePath}:`, error);
      }
    } else {
      scanNote = 'Archivo adjunto no encontrado en su ubicación original.';
      blockReason = 'file_missing';
    }
    if (localDoc && hasUsableText(localDoc.text)) {
      const hasPages = /\[\[p\.\s*\d+\]\]/i.test(localDoc.text);
      segments.push({
        sourceRef: sourceRefForAttachment(att),
        marker: '',
        origin: 'local_attachment',
        sourceType: localDoc.sourceType,
        zoteroLibraryId: String(att.library.id),
        attachmentKey: att.key,
        displayName: att.title || att.filename,
        text: localDoc.text,
        contentHash: textHash(localDoc.text),
        pageCount: localDoc.analysis?.pageCount ?? null,
        hasPageMarkers: hasPages,
      });
      if (localDoc.notes) notes.push(localDoc.notes);
      continue;
    }
    if (localDoc?.notes) scanNote = localDoc.notes;
    if (localDoc?.blockReason) blockReason = localDoc.blockReason;

    if (opts.preferZoteroFulltext) {
      opts.onProgress?.({ phase: 'fulltext', detail: 'Comprobando índice de Zotero…', pct: null });
      const ft = await getFulltext(userId, att.key).catch(() => null);
      const cleaned = ft ? cleanExtractedText(ft.content) : '';
      if (ft && hasUsableText(cleaned)) {
        const note = `Texto indexado por Zotero sin páginas verificables${ft.totalPages ? ` (${ft.indexedPages ?? '?'}/${ft.totalPages} págs. indexadas)` : ''}.`;
        segments.push({
          sourceRef: sourceRefForAttachment(att),
          marker: '',
          origin: 'zotero_fulltext',
          sourceType: attachmentSourceType(att),
          zoteroLibraryId: String(att.library.id),
          attachmentKey: att.key,
          displayName: att.title || att.filename,
          text: cleaned,
          contentHash: textHash(cleaned),
          pageCount: ft.totalPages ?? null,
          hasPageMarkers: false,
        });
        notes.push(note);
      }
    }
  }

  if (segments.length > 0) return { doc: combineSegments(segments, notes.join(' ') || null, true), scanNote: null, blockReason: null };
  return { doc: null, scanNote, blockReason: blockReason ?? (textAttachments.length ? 'unreadable' : null) };
}

/**
 * Resolve full text for a work via a detector chain that escalates only as needed:
 *   1) Parse every local attachment (digital/hybrid → text; scanned → OCR if enabled)
 *   2) Use Zotero fulltext only for an attachment whose local file is unusable
 *   3) Curated Library copy, then Unpaywall open-access PDF (by DOI)
 *   4) Abstract only / none
 */
export async function resolveWorkText(
  userId: string,
  zoteroKey: string,
  storagePath: string,
  abstract: string | null,
  doi: string | null,
  opts: ResolveOptions,
  itemType?: string | null
): Promise<ExtractedDoc> {
  opts.signal?.throwIfAborted();
  // Fall back to the standard Zotero storage location when the user left it blank,
  // so deep scans can still find local PDFs instead of degrading to abstract-only.
  const effectiveStorage = storagePath || defaultZoteroStorage();
  const isAttachmentItem = (itemType ?? '').toLowerCase() === 'attachment';
  const isNodusLibraryItem = zoteroKey.startsWith('nodus-library:');

  // (1+2) Resolve text from the Zotero attachments. A scan can race a just-attached
  // file — the attachment child, its filename, or the on-disk copy may surface a
  // moment later — so retry briefly before degrading instead of silently accepting
  // the abstract for a work that actually has full text.
  let hadTextAttachment = false;
  let scanNote: string | null = null;
  let blockReason: TextBlockReason | null = null;
  // A Zotero outage leaves attachment availability unknown. Track it separately so
  // the final reason is `zotero_unavailable`, never `no_attachment`, and the caller
  // can retry instead of persisting a false "no full text".
  let zoteroUnreachable = false;
  // A `nodus-library:` key is not a Zotero item key. Its canonical clean copy is
  // resolved by the Library fallback immediately below, so do not spend retries
  // querying Zotero before reading the source Nodus already owns locally.
  const attachmentReadAttempts = isNodusLibraryItem ? 0 : ATTACHMENT_READ_ATTEMPTS;
  for (let attempt = 0; attempt < attachmentReadAttempts; attempt++) {
    opts.signal?.throwIfAborted();
    if (attempt > 0) await abortableDelay(ATTACHMENT_RETRY_DELAYS_MS[attempt] ?? 1500, opts.signal);
    let textAttachments: ZoteroAttachment[] = [];
    const metadataDone = startPerf('Zotero attachment metadata', opts.perf, { zoteroKey, attempt });
    try {
      textAttachments = await textAttachmentsFor(userId, zoteroKey, itemType);
      // The latest attempt decides: a later success means Zotero answered, so the
      // empty list (if any) is authoritative rather than an outage.
      zoteroUnreachable = false;
      metadataDone({ attachments: textAttachments.length });
    } catch (e) {
      zoteroUnreachable = isZoteroUnreachable(e);
      metadataDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    if (textAttachments.length > 0) hadTextAttachment = true;

    const result = await readTextAttachments(textAttachments, userId, effectiveStorage, opts, zoteroKey);
    if (result.doc) return { ...result.doc, hadTextAttachment: true };
    if (result.scanNote) scanNote = result.scanNote;
    if (result.blockReason) blockReason = result.blockReason;

    // Keep retrying only while a brief wait might change the outcome: attachments
    // were found but not yet readable (file/index settling), none surfaced yet on
    // the first try for a normal (non-attachment) item, or Zotero was unreachable
    // and may still be starting up. This costs at most one short extra wait for
    // works that genuinely have no full text.
    const worthRetrying = zoteroUnreachable
      ? attempt < attachmentReadAttempts - 1
      : !isAttachmentItem && (textAttachments.length > 0 || attempt === 0);
    if (!worthRetrying) break;
  }

  // A curated Library copy is the first fallback after canonical local files.
  // It is deterministic and OCR-clean, but must never mask a newer attachment
  // or erase that attachment's page/source inventory.
  try {
    const clean = getLibraryReaderRawContent(zoteroKey);
    if (clean?.markdown.trim()) {
      // The clean copy has no page markers of its own; its source map has the pages.
      const text = libraryMarkdownWithPageMarkers(clean.markdown, readDocumentarySourceMap(clean.folder, clean.sourceMapFile));
      return combineSegments([{
        sourceRef: `library:${zoteroKey}`,
        marker: '',
        origin: 'library_clean',
        sourceType: 'markdown',
        zoteroLibraryId: null,
        attachmentKey: null,
        displayName: clean.document.title,
        text,
        contentHash: textHash(text),
        pageCount: clean.document.pageCount,
        hasPageMarkers: /\[\[p\.\s*\d+\]\]/i.test(text),
      }], 'Versión Markdown de la Biblioteca global.', clean.document.originalAvailable);
    }
  } catch {
    // The backup folder may be unconfigured in headless/first-run contexts.
  }

  // (3) Unpaywall fallback by DOI.
  if (opts.allowExternalRetrieval !== false && doi && opts.unpaywallEmail) {
    opts.onProgress?.({ phase: 'download', detail: 'Buscando texto abierto (Unpaywall)…', pct: null });
    const unpaywallDone = startPerf('Unpaywall', opts.perf, { doi });
    const oa = await tryUnpaywall(doi, opts.unpaywallEmail, opts.ocr, opts.onProgress, opts.perf, opts.signal).catch((e) => {
      if (opts.signal?.aborted) throw e;
      unpaywallDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    unpaywallDone({ hit: Boolean(oa), chars: oa?.text.length ?? 0 });
    if (oa && oa.text.trim()) {
      return combineSegments([{
        sourceRef: `oa:${textHash(doi.toLowerCase()).slice(0, 24)}`,
        marker: '',
        origin: 'unpaywall_pdf',
        sourceType: 'pdf',
        zoteroLibraryId: null,
        attachmentKey: null,
        displayName: doi,
        text: oa.text,
        contentHash: textHash(oa.text),
        pageCount: oa.analysis?.pageCount ?? null,
        hasPageMarkers: /\[\[p\.\s*\d+\]\]/i.test(oa.text),
      }], oa.notes, hadTextAttachment);
    }
  }

  // (4) Degrade to abstract-only / none. Carry forward any scan note (e.g. OCR
  // disabled) and whether a document attachment existed, so the pipeline can retry
  // works that *should* have full text instead of silently accepting the abstract.
  if (abstract) {
    // A degradation is not an error, but it is the explanation for a thin analysis later,
    // so it is recorded with the reason the extractor itself decided on.
    logPipelineWarning({
      subject: 'subjectExtraction',
      code: 'no_legible_text',
      context: { scope: 'extraction', nodusId: zoteroKey },
      reason: reasonForBlockReason(blockReason ?? 'abstract_only'),
      detail: scanNote ?? null,
    });
    return {
      ...combineSegments([{
      sourceRef: `abstract:${zoteroKey}`,
      marker: '',
      origin: 'abstract',
      sourceType: 'abstract_only',
      zoteroLibraryId: null,
      attachmentKey: null,
      displayName: 'Abstract',
      text: abstract,
      contentHash: textHash(abstract),
      pageCount: null,
      hasPageMarkers: false,
      }], scanNote ?? 'Solo abstract disponible.', hadTextAttachment),
      blockReason: blockReason ?? 'abstract_only',
    };
  }
  const finalReason: TextBlockReason = blockReason
    ?? (zoteroUnreachable ? 'zotero_unavailable' : hadTextAttachment ? 'unreadable' : 'no_attachment');
  logPipelineWarning({
    subject: 'subjectExtraction',
    code: 'extract_failed',
    context: { scope: 'extraction', nodusId: zoteroKey },
    reason: reasonForBlockReason(finalReason),
    detail: scanNote ?? null,
  });
  return {
    text: '', sourceType: 'none',
    notes: scanNote ?? (zoteroUnreachable
      ? 'Zotero no está disponible; no se pudo comprobar si la obra tiene texto completo.'
      : 'Sin texto ni abstract disponible.'),
    hadTextAttachment,
    blockReason: finalReason,
  };
}

/** The catalogue reason that matches the extractor's own block reason. */
function reasonForBlockReason(reason: TextBlockReason): PipelineLogReasonId {
  switch (reason) {
    case 'no_attachment': return 'reasonNoAttachment';
    case 'unreadable': return 'reasonUnreadable';
    case 'abstract_only': return 'reasonAbstractOnly';
    case 'zotero_unavailable': return 'reasonZoteroUnavailable';
    default: return 'reasonNoLegibleText';
  }
}

async function tryUnpaywall(
  doi: string,
  email: string,
  ocr: OcrOptions,
  onProgress?: OnExtractProgress,
  perf?: PerfContext,
  signal?: AbortSignal,
): Promise<ExtractedDoc | null> {
  signal?.throwIfAborted();
  const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const url = data?.best_oa_location?.url_for_pdf;
  if (!url) return null;
  const pdfRes = await fetch(url, { signal });
  if (!pdfRes.ok) return null;
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `nodus-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    const doc = process.type === 'browser'
      ? await (await import('./textExtractionWorkerHost')).extractFileTextInWorker(tmp, { ocr, onProgress, perf, signal })
      : await extractFileText(tmp, { ocr, onProgress, perf, signal });
    return { ...doc, notes: `Texto recuperado vía Unpaywall.${doc.notes ? ' ' + doc.notes : ''}` };
  } finally {
    fs.unlinkSync(tmp);
  }
}
