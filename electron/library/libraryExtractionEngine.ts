import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type TurndownServiceType from 'turndown';
import type {
  LibraryExtractionOptions,
  LibraryItemRecord,
  LibraryQualityReport,
  LibrarySourceAnchor,
  LibrarySourceBlock,
  LibrarySourceMap,
} from '@shared/libraryTypes';
import { openPdf, openPdfData, loadPdfjs } from '../extraction/pdfjsLoader';
import { isScannedDocument, pagePaintsImage, sampleScanVerdict, TEXTLESS_PAGE_CHARACTERS } from '../extraction/scanDetection';
import { ocrPdfPages } from '../extraction/ocr';
import { csvFileToText, xlsxFileToText } from '../extraction/tabular';
import { cleanInlineText, dehyphenatingJoin, replaceNulCharacters } from '../extraction/textCleanup';
import { atomicWriteFile, atomicWriteJson, assertInside, resolveLibraryFile, safeLibraryFolderName } from './libraryFileUtils';
import { LibraryDiskStore } from './libraryStorage';
import {
  extractionFingerprint,
  LIBRARY_EXTRACTION_PIPELINE,
  publishLibraryContentRevision,
} from './libraryRevision';
import { reanchorLibraryAnnotations } from './libraryAnnotationReanchor';

export const DEFAULT_LIBRARY_EXTRACTION_OPTIONS: LibraryExtractionOptions = {
  ocrMode: 'local',
  ocrLanguages: 'spa+eng',
  maxOcrPages: 500,
  extractImages: true,
  detectTables: true,
  force: false,
};

interface PositionedItem {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  baseline: number;
}

interface LayoutLine {
  text: string;
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  items: PositionedItem[];
  paragraphBreakBefore?: boolean;
  /** Which column of the page the line belongs to, when the page has a gutter there. */
  column?: -1 | 0 | 1;
}

interface OutputBlock {
  kind: LibrarySourceBlock['kind'];
  text: string;
  markdown: string;
  anchors: LibrarySourceAnchor[];
  order?: number;
  fontSize?: number;
  lastLine?: LayoutLine;
  tableVisual?: { page: number; bbox: [number, number, number, number] };
}

interface PageLayout {
  page: number;
  width: number;
  height: number;
  lines: LayoutLine[];
  ocr?: boolean;
}

export interface LibraryExtractionResult {
  item: LibraryItemRecord;
  quality: LibraryQualityReport;
  sourceMap: LibrarySourceMap;
}

export type LibraryExtractionProgressHandler = (value: {
  phase: 'analyze' | 'extract' | 'ocr' | 'assets' | 'write';
  progress: number;
  message: string;
  page?: number;
  totalPages?: number;
}) => void;

export interface LibraryRemoteOcrPage {
  page: number;
  image: Buffer;
  mimeType: 'image/png';
}

export type LibraryRemoteOcr = (input: LibraryRemoteOcrPage, signal?: AbortSignal) => Promise<string>;

type TurndownConstructor = typeof TurndownServiceType;
let turndownConstructor: TurndownConstructor | null = null;

function createTurndown(): TurndownServiceType {
  if (!turndownConstructor) {
    // The package's Node fallback contains a real CommonJS require(), so load it
    // through Node's module bridge instead of embedding it in the ESM main bundle.
    const packageName = ['turn', 'down'].join('');
    const loaded = createRequire(import.meta.url)(packageName) as TurndownConstructor | { default: TurndownConstructor };
    turndownConstructor = 'default' in loaded ? loaded.default : loaded;
  }
  return new turndownConstructor({ headingStyle: 'atx', bulletListMarker: '-' });
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Extracción cancelada', 'AbortError');
}

function sha256Buffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export { cleanInlineText } from '../extraction/textCleanup';

export function normalizeCleanMarkdown(value: string): string {
  const input = replaceNulCharacters(value.replace(/\r\n?/g, '\n')).normalize('NFC').replace(/\u00ad/g, '');
  const output: string[] = [];
  let fenced = false;
  let commented = false;
  for (const raw of input.split('\n')) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; output.push(raw.trimEnd()); continue; }
    if (fenced) { output.push(raw.trimEnd()); continue; }
    if (commented || /^\s*<!--/.test(raw)) {
      output.push(raw.trimEnd());
      commented = !/-->\s*$/.test(raw);
      continue;
    }
    if (!raw.trim()) { output.push(''); continue; }
    const prefix = raw.match(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|\[\^[^\]]+\]:\s*)/)?.[0] ?? '';
    const body = cleanInlineText(raw.slice(prefix.length));
    output.push(`${prefix.trimStart()}${body}`.trimEnd());
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function anchor(line: LayoutLine): LibrarySourceAnchor {
  return { page: line.page, bbox: [rounded(line.x0), rounded(line.top), rounded(line.x1), rounded(line.bottom)] };
}

function mergeAnchors(lines: LayoutLine[]): LibrarySourceAnchor[] {
  const pages = new Map<number, [number, number, number, number]>();
  for (const line of lines) {
    const current = pages.get(line.page);
    if (!current) pages.set(line.page, [line.x0, line.top, line.x1, line.bottom]);
    else pages.set(line.page, [Math.min(current[0], line.x0), Math.min(current[1], line.top), Math.max(current[2], line.x1), Math.max(current[3], line.bottom)]);
  }
  return [...pages].sort(([a], [b]) => a - b).map(([page, box]) => ({ page, bbox: box.map(rounded) as LibrarySourceAnchor['bbox'] }));
}

function joinLineItems(items: PositionedItem[]): string {
  const ordered = [...items].sort((a, b) => a.x0 - b.x0);
  const bodySize = median(ordered.map((item) => item.size));
  const bodyBaseline = median(ordered.filter((item) => item.size >= bodySize * 0.85).map((item) => item.baseline));
  let text = '';
  let previous: PositionedItem | null = null;
  for (const item of ordered) {
    if (!item.text.trim()) continue;
    const gap = previous ? item.x0 - previous.x1 : 0;
    const average = previous ? Math.max(2, (previous.x1 - previous.x0) / Math.max(1, previous.text.length)) : 4;
    const superscriptReference = /^\d{1,3}$/.test(item.text.trim())
      && ordered.length > 1
      && item.size <= bodySize * 0.72
      && item.baseline <= bodyBaseline - bodySize * 0.12;
    const normalizedItem = item.text.normalize('NFC');
    const isolatedGlyph = [...normalizedItem.trim()].length === 1 && /\p{L}/u.test(normalizedItem.trim());
    const explicitWhitespace = !!previous && (/\s$/.test(previous.text) || /^\s/.test(item.text));
    const token = superscriptReference ? `[^${item.text.trim()}]` : normalizedItem;
    const separator = previous && !superscriptReference && (explicitWhitespace || (gap > average * 0.35 && !isolatedGlyph)) ? ' ' : '';
    text += `${separator}${token}`;
    previous = item;
  }
  return cleanInlineText(text);
}

/**
 * The empty strip between the columns of a page, and the rows where it exists.
 *
 * A text item carries no notion of which column it belongs to, so a page is split into bands
 * of rows and each band is asked whether it has a gutter: an empty vertical strip near the
 * middle with text on both sides. Bands are scoped, not the page, because a paper puts its
 * title, its abstract and its wide tables in rows where a single column of text crosses the
 * middle — those rows must not be split, and a band that spans the middle finds no gutter.
 */
export interface ColumnGutter { top: number; bottom: number; x0: number; x1: number }

const GUTTER_BAND_HEIGHT = 24;
const GUTTER_BIN = 4;

/** The widest empty strip of a band inside the middle of the page, or null. */
function bandGutter(items: PositionedItem[], width: number): { x0: number; x1: number } | null {
  const from = Math.floor(width * 0.25 / GUTTER_BIN);
  const to = Math.ceil(width * 0.75 / GUTTER_BIN);
  const occupied = new Array<boolean>(to - from + 1).fill(false);
  for (const item of items) {
    const first = Math.max(from, Math.floor(item.x0 / GUTTER_BIN));
    const last = Math.min(to, Math.ceil(item.x1 / GUTTER_BIN));
    for (let bin = first; bin <= last; bin += 1) occupied[bin - from] = true;
  }
  let best: { x0: number; x1: number } | null = null;
  let runStart = -1;
  for (let index = 0; index <= occupied.length; index += 1) {
    const empty = index < occupied.length && !occupied[index];
    if (empty) { if (runStart < 0) runStart = index; continue; }
    if (runStart >= 0) {
      const x0 = (runStart + from) * GUTTER_BIN;
      const x1 = (index + from) * GUTTER_BIN;
      if (x1 - x0 >= Math.max(9, width * 0.015) && (!best || x1 - x0 > best.x1 - best.x0)) best = { x0, x1 };
      runStart = -1;
    }
  }
  return best;
}

/**
 * The rows of a page where two columns coexist, each with the gutter between them.
 * Exported for its own test: it is the decision that keeps a two-column sentence from being
 * stitched to the one beside it.
 */
export function columnGutters(items: PositionedItem[], width: number, height: number): ColumnGutter[] {
  const bands: ColumnGutter[] = [];
  for (let top = 0; top < height; top += GUTTER_BAND_HEIGHT) {
    const bottom = top + GUTTER_BAND_HEIGHT;
    const inBand = items.filter((item) => (item.top + item.bottom) / 2 >= top && (item.top + item.bottom) / 2 < bottom);
    if (inBand.length < 2) continue;
    const gutter = bandGutter(inBand, width);
    if (!gutter) continue;
    const leftItems = inBand.filter((item) => (item.x0 + item.x1) / 2 < gutter.x0);
    const rightItems = inBand.filter((item) => (item.x0 + item.x1) / 2 > gutter.x1);
    // Both sides must carry text: a table row inside one column leaves the strip empty on one
    // side and must not be mistaken for a page gutter.
    if (!leftItems.length || !rightItems.length) continue;
    if (Math.min(leftItems.length, rightItems.length) < inBand.length * 0.3) continue;
    // A column of a page is wide — its lines run to the gutter on one side and to the margin on
    // the other. A table is not: its cells are short, so the strip between two of its columns
    // looks empty while both sides stay narrow. Without this, the two-column table of a real
    // document was read as a page of two columns and its rows were split into pieces.
    const span = (entries: PositionedItem[]): number =>
      Math.max(...entries.map((entry) => entry.x1)) - Math.min(...entries.map((entry) => entry.x0));
    if (span(leftItems) < width * 0.22 || span(rightItems) < width * 0.22) continue;
    bands.push({ top, bottom, x0: gutter.x0, x1: gutter.x1 });
  }
  const merged = bands.reduce<ColumnGutter[]>((accumulated, band) => {
    const previous = accumulated.at(-1);
    // The same gutter across two rows: its edges move with the length of the lines on either
    // side, so what identifies it is that the empty strips overlap, not that they match. A
    // paragraph break in one column leaves a band with nothing on one side and no gutter of its
    // own, so bands are also joined across a short vertical gap — a column interrupted by a
    // break is still the same column, and the line inside that gap was otherwise treated as a
    // full-width line and reordered to the end of the page.
    const MAX_BAND_GAP = GUTTER_BAND_HEIGHT * 3;
    if (previous && band.top - previous.bottom <= MAX_BAND_GAP && band.x0 < previous.x1 && band.x1 > previous.x0) {
      previous.bottom = band.bottom;
      previous.x0 = Math.min(previous.x0, band.x0);
      previous.x1 = Math.max(previous.x1, band.x1);
      return accumulated;
    }
    accumulated.push({ ...band });
    return accumulated;
  }, []);
  // A single band is a coincidence — a wide table, a figure caption beside a label. Two stacked
  // bands worth of text beside each other is what a column looks like.
  return merged.filter((band) => band.bottom - band.top >= GUTTER_BAND_HEIGHT * 2);
}

/** Which side of the gutter an item sits on: -1 left, 1 right, 0 when it crosses it. */
function gutterSide(item: PositionedItem, gutters: ColumnGutter[]): -1 | 0 | 1 {
  const center = (item.x0 + item.x1) / 2;
  for (const gutter of gutters) {
    if (item.bottom < gutter.top || item.top > gutter.bottom) continue;
    if (center < gutter.x0) return -1;
    if (center > gutter.x1) return 1;
    return 0;
  }
  return 0;
}

async function pageLayout(page: any, number: number): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ includeMarkedContent: true });
  const positioned: PositionedItem[] = [];
  for (const raw of content.items ?? []) {
    if (typeof raw?.str !== 'string' || !raw.str.trim() || !Array.isArray(raw.transform)) continue;
    const x0 = Number(raw.transform[4]) || 0;
    const baseline = Number(raw.transform[5]) || 0;
    const size = Math.max(1, Math.abs(Number(raw.transform[3]) || Number(raw.height) || 10));
    const normalizedLength = Math.max(1, [...raw.str.normalize('NFC')].length);
    const width = Math.max(0, Number(raw.width) || normalizedLength * size * 0.45);
    positioned.push({
      text: raw.str, x0, x1: x0 + width,
      top: viewport.height - baseline - size,
      bottom: viewport.height - baseline + size * 0.25,
      size, baseline: viewport.height - baseline,
    });
  }
  positioned.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  // Two fragments on the same visual row are the same line only when they share a column.
  // Without this, the last words of the left column and the first of the right one were joined
  // into one sentence — "We introduce two simple global hyper-parameters that trade off
  // accuracy" arrived as "We introduce two simple global hyperaccuracy" — and the joined line,
  // too wide to belong to either column, was then emitted as a full-width line by readingOrder.
  const gutters = columnGutters(positioned, viewport.width, viewport.height);
  const groups: Array<{ side: -1 | 0 | 1; items: PositionedItem[] }> = [];
  for (const item of positioned) {
    const side = gutterSide(item, gutters);
    let group: PositionedItem[] | undefined;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      if (candidate.side !== side) continue;
      const sameTop = Math.abs(median(candidate.items.map((entry) => entry.top)) - item.top) <= Math.max(2.5, item.size * 0.28);
      const sameBaseline = Math.abs(median(candidate.items.map((entry) => entry.baseline)) - item.baseline) <= Math.max(2, item.size * 0.22);
      if (sameTop || sameBaseline) { group = candidate.items; break; }
    }
    if (group) group.push(item); else groups.push({ side, items: [item] });
  }
  const lines = groups.map(({ side, items }) => ({
    text: joinLineItems(items), page: number,
    x0: Math.min(...items.map((entry) => entry.x0)), x1: Math.max(...items.map((entry) => entry.x1)),
    top: Math.min(...items.map((entry) => entry.top)), bottom: Math.max(...items.map((entry) => entry.bottom)),
    size: median(items.map((entry) => entry.size)), items: [...items].sort((a, b) => a.x0 - b.x0),
    column: side,
  })).filter((line) => line.text);
  return { page: number, width: viewport.width, height: viewport.height, lines };
}

function repeatedChrome(pages: PageLayout[]): Set<string> {
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines.filter((entry) => entry.top < page.height * 0.13 || entry.bottom > page.height * 0.88)) {
      const key = cleanInlineText(line.text).toLocaleLowerCase().replace(/\d+/g, '#');
      if (key.length < 3 || key.length > 180) continue;
      counts.set(key, new Set([...(counts.get(key) ?? []), page.page]));
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.32));
  return new Set([...counts].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key));
}

function readingOrder(page: PageLayout): LayoutLine[] {
  const lines = [...page.lines];
  if (page.ocr) return lines;
  // A page whose columns were found by their gutter is ordered by that: the half-of-the-page
  // guess below misses the layouts a paper actually prints — an abstract wider than a column,
  // or a full-width title over the two columns — and used to send such lines to the END of the
  // page, which is how an abstract's second line ended up beside the introduction.
  const byColumn = lines.filter((line) => (line.column ?? 0) !== 0);
  if (byColumn.length >= 8) {
    const left = byColumn.filter((line) => line.column === -1).sort((a, b) => a.top - b.top || a.x0 - b.x0);
    const right = byColumn.filter((line) => line.column === 1).sort((a, b) => a.top - b.top || a.x0 - b.x0);
    if (left.length >= 2 && right.length >= 2) {
      const spanning = lines.filter((line) => (line.column ?? 0) === 0);
      const firstColumnTop = Math.min(left[0].top, right[0].top);
      const header = spanning.filter((line) => line.bottom <= firstColumnTop + 5).sort((a, b) => a.top - b.top || a.x0 - b.x0);
      const footer = spanning.filter((line) => !header.includes(line)).sort((a, b) => a.top - b.top || a.x0 - b.x0);
      return [...header, ...left, ...right, ...footer];
    }
  }
  const middle = page.width / 2;
  const left = lines.filter((line) => line.x0 < middle - 15 && line.x1 <= middle + 30 && line.x1 - line.x0 < page.width * 0.7);
  const right = lines.filter((line) => line.x0 >= middle - 30 && line.x1 - line.x0 < page.width * 0.7);
  if (left.length < 4 || right.length < 4) return lines.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const spanning = lines.filter((line) => !left.includes(line) && !right.includes(line)).sort((a, b) => a.top - b.top);
  const firstColumnTop = Math.min(...left.map((line) => line.top), ...right.map((line) => line.top));
  const header = spanning.filter((line) => line.bottom <= firstColumnTop + 5);
  const footer = spanning.filter((line) => !header.includes(line));
  return [
    ...header,
    ...left.sort((a, b) => a.top - b.top || a.x0 - b.x0),
    ...right.sort((a, b) => a.top - b.top || a.x0 - b.x0),
    ...footer,
  ];
}

interface TableRowCandidate {
  line: LayoutLine;
  cells: string[];
  starts: number[];
}

function rowCells(line: LayoutLine): Omit<TableRowCandidate, 'line'> {
  if (line.items.length < 2) return { cells: [], starts: [] };
  const cells: string[] = [];
  const starts: number[] = [];
  let current = '';
  let currentStart = line.items[0]?.x0 ?? line.x0;
  let previous: PositionedItem | null = null;
  for (const item of line.items) {
    const gap = previous ? item.x0 - previous.x1 : 0;
    const average = previous ? (previous.x1 - previous.x0) / Math.max(1, previous.text.length) : 4;
    if (previous && gap > Math.max(16, average * 3)) {
      cells.push(cleanInlineText(current));
      starts.push(currentStart);
      current = item.text;
      currentStart = item.x0;
    } else current = current ? `${current} ${item.text}` : item.text;
    previous = item;
  }
  if (current) { cells.push(cleanInlineText(current)); starts.push(currentStart); }
  const populated = cells.map((cell, index) => ({ cell, start: starts[index] })).filter(({ cell }) => !!cell);
  return { cells: populated.map(({ cell }) => cell), starts: populated.map(({ start }) => start) };
}

function detectTableRuns(lines: LayoutLine[]): Array<{ lines: LayoutLine[]; rows: string[][] }> {
  const output: Array<{ lines: LayoutLine[]; rows: string[][] }> = [];
  let run: TableRowCandidate[] = [];
  const flush = (): void => {
    if (run.length >= 3) {
      const widthCounts = new Map<number, number>();
      for (const entry of run) widthCounts.set(entry.cells.length, (widthCounts.get(entry.cells.length) ?? 0) + 1);
      const width = [...widthCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const stable = run.filter((entry) => entry.cells.length === width);
      const columnStarts = Array.from({ length: width }, (_, column) => median(stable.map((entry) => entry.starts[column])));
      const aligned = stable.every((entry) => entry.starts.every((start, column) => Math.abs(start - columnStarts[column]) <= Math.max(10, entry.line.size * 1.25)));
      if (width >= 2 && stable.length >= 3 && aligned) output.push({ lines: stable.map((entry) => entry.line), rows: stable.map((entry) => entry.cells) });
    }
    run = [];
  };
  for (const line of lines) {
    const row = rowCells(line);
    const previous = run.at(-1)?.line;
    if (previous && line.top - previous.bottom > Math.max(32, line.size * 3)) flush();
    if (row.cells.length >= 2 && row.cells.length <= 12) run.push({ line, ...row }); else flush();
  }
  flush();
  return output;
}

function renderTable(rows: string[][]): string {
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')].map((cell) => cell.replace(/\|/g, '\\|')));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

interface CaptionedTableExtraction {
  lines: LayoutLine[];
  table: { lines: LayoutLine[]; rows: string[][]; visualFallback: boolean } | null;
  continues: boolean;
}

/**
 * Academic tables frequently contain wrapped cells, so a run of identical row
 * widths is not enough to recover them. A numbered caption and its source line
 * give us a safer region. Inside it, column starts are inferred from the widest
 * repeated rows and single-cell continuation lines are folded into the cell
 * above instead of being emitted as unrelated prose or block quotations.
 */
function extractCaptionedTable(
  page: PageLayout,
  lines: LayoutLine[],
  continuing: boolean,
): CaptionedTableExtraction {
  const captionIndex = continuing ? -1 : lines.findIndex((line) => /^(?:tabla|table)\s+\d+[.:]/i.test(line.text));
  if (!continuing && captionIndex < 0) return { lines, table: null, continues: false };
  const searchStart = continuing ? 0 : captionIndex + 1;
  const sourceIndex = lines.findIndex((line, index) => index >= searchStart && /^(?:fuente|source)\s*:/i.test(line.text));
  const regionEnd = sourceIndex >= 0 ? sourceIndex : lines.length;
  const firstTabular = lines.findIndex((line, index) => index >= searchStart && index < regionEnd && rowCells(line).cells.length >= 2);
  if (firstTabular < 0 || firstTabular >= regionEnd) return { lines, table: null, continues: false };
  const region = lines.slice(firstTabular, regionEnd);
  const candidates = region.map((line) => ({ line, ...rowCells(line) })).filter((entry) => entry.cells.length >= 2);
  if (candidates.length < 2) return { lines, table: null, continues: false };

  const widthCounts = new Map<number, number>();
  for (const candidate of candidates) widthCounts.set(candidate.cells.length, (widthCounts.get(candidate.cells.length) ?? 0) + 1);
  const widths = [...widthCounts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const width = widths.find(([, count]) => count >= 2)?.[0] ?? widths[0][0];
  const stable = candidates.filter((candidate) => candidate.cells.length === width);
  const columnStarts = Array.from({ length: width }, (_, column) => median(stable.map((entry) => entry.starts[column])));
  const rows: string[][] = [];
  for (const line of region) {
    const parsed = rowCells(line);
    if (!parsed.cells.length) continue;
    const row = Array<string>(width).fill('');
    for (let index = 0; index < parsed.cells.length; index += 1) {
      const start = parsed.starts[index];
      let column = 0;
      for (let candidate = 1; candidate < columnStarts.length; candidate += 1) {
        if (Math.abs(columnStarts[candidate] - start) < Math.abs(columnStarts[column] - start)) column = candidate;
      }
      row[column] = row[column] ? `${row[column]} ${parsed.cells[index]}` : parsed.cells[index];
    }
    const populated = row.filter(Boolean).length;
    if (populated === 1 && rows.length) {
      const column = row.findIndex(Boolean);
      rows.at(-1)![column] = dehyphenatingJoin(rows.at(-1)![column], row[column]);
    } else if (populated) rows.push(row);
  }
  if (rows.length < 3) return { lines, table: null, continues: false };
  const emptyCells = rows.reduce((sum, row) => sum + row.filter((cell) => !cell).length, 0);
  const populatedCells = rows.flat().filter(Boolean);
  const fragmentedCells = populatedCells.filter((cell) => /[-‐‑‒–—]$/.test(cell)).length;
  const visualFallback = (width <= 2 && rows.length >= 10)
    || emptyCells / Math.max(1, rows.length * width) >= 0.2
    || fragmentedCells / Math.max(1, populatedCells.length) >= 0.18
    || populatedCells.some((cell) => cell.length > 220);
  const consumed = new Set(region);
  const lastLine = region.at(-1);
  const continues = sourceIndex < 0 && !!lastLine && lastLine.bottom >= page.height * 0.72;
  return {
    lines: lines.filter((line) => !consumed.has(line)),
    table: { lines: region, rows, visualFallback },
    continues,
  };
}

function localColumnLeft(page: PageLayout, line: LayoutLine, lines: LayoutLine[]): number {
  const rightColumn = line.x0 >= page.width / 2 - 20 && line.x1 - line.x0 < page.width * 0.7;
  const candidates = lines.filter((candidate) => {
    const candidateRight = candidate.x0 >= page.width / 2 - 20 && candidate.x1 - candidate.x0 < page.width * 0.7;
    return candidateRight === rightColumn && candidate.text.length > 20;
  }).map((candidate) => candidate.x0).sort((a, b) => a - b);
  return candidates[Math.min(candidates.length - 1, Math.floor(candidates.length * 0.18))] ?? line.x0;
}

function extractFootnoteBlocks(page: PageLayout, lines: LayoutLine[], bodySize: number, lineOrder: Map<LayoutLine, number>): { blocks: OutputBlock[]; lines: Set<LayoutLine> } {
  const smallBottomLines = lines.filter((line) => line.top >= page.height * 0.52 && line.size <= bodySize * 0.9);
  const consumed = new Set<LayoutLine>();
  const blocks: OutputBlock[] = [];
  for (let index = 0; index < smallBottomLines.length; index += 1) {
    const first = smallBottomLines[index];
    const match = /^(?:\[\^(\d{1,3})\]|(\d{1,3})(?:[.)])?)\s*(\p{L}.+)$/u.exec(first.text);
    if (!match || consumed.has(first)) continue;
    const label = match[1] ?? match[2];
    const linesForNote = [first];
    let text = match[3];
    consumed.add(first);
    for (let nextIndex = index + 1; nextIndex < smallBottomLines.length; nextIndex += 1) {
      const next = smallBottomLines[nextIndex];
      if (/^(?:\[\^\d{1,3}\]|\d{1,3}(?:[.)])?)\s*\p{L}/u.test(next.text)) break;
      const previous = linesForNote.at(-1)!;
      if (next.top - previous.bottom > bodySize * 1.5) break;
      linesForNote.push(next);
      consumed.add(next);
      text = dehyphenatingJoin(text, next.text);
      index = nextIndex;
    }
    blocks.push({
      kind: 'note',
      text,
      markdown: `[^${label}]: ${text}`,
      anchors: mergeAnchors(linesForNote),
      order: lineOrder.get(first),
    });
  }
  return { blocks, lines: consumed };
}

function leadingUppercaseHeading(text: string): { heading: string; remainder: string } | null {
  const match = /^((?:\d+(?:\.\d+)*\.?\s+)?[\p{Lu}\d][\p{Lu}\d\sÁÉÍÓÚÜÑÀÈÌÒÙÇ:;,.'’()¿?¡!–—/-]{12,})(?=\s+\p{Lu}\p{Ll}{2})/u.exec(text);
  if (!match) return null;
  const heading = cleanInlineText(match[1]);
  const remainder = cleanInlineText(text.slice(match[1].length));
  return heading.length >= 12 && remainder.length >= 20 ? { heading, remainder } : null;
}

function pageBlocks(
  page: PageLayout,
  chrome: Set<string>,
  detectTables: boolean,
  isFirstPage: boolean,
  continuingTable: boolean,
): { blocks: OutputBlock[]; tableContinues: boolean } {
  let lines = readingOrder(page).filter((line) => {
    const trimmed = line.text.trim();
    if (page.ocr && (/^[^\p{L}\p{N}]+$/u.test(trimmed)
      || (/^[^\p{L}]*\p{L}[^\p{L}]*$/u.test(trimmed) && !/^[IVXLCDM]+\.?$/i.test(trimmed)))) return false;
    const pageEdge = line.top <= page.height * 0.12 || line.bottom >= page.height * 0.88;
    if (pageEdge && /^\[?\d{1,4}\]?$/.test(line.text.trim())) return false;
    if (isFirstPage && line.top <= page.height * 0.14
      && /(?:\bISSN\b.*(?:\bpp?\.?\s*\d|doi)|https?:\/\/(?:dx\.)?doi\.org\/)/i.test(line.text)) return false;
    if (line.top >= page.height * 0.83 && /\bp(?:á|a)gs?\.?\s*\d|\bpages?\s+\d/i.test(line.text)) return false;
    if (line.top <= page.height * 0.14) line.text = line.text.replace(/^\[\d{1,4}\]\s+(?=\p{L})/u, '');
    return !chrome.has(cleanInlineText(line.text).toLocaleLowerCase().replace(/\d+/g, '#'));
  });
  const lineOrder = new Map(lines.map((line, index) => [line, index]));
  const bodySize = median(lines.filter((line) => line.text.length > 20).map((line) => line.size)) || median(lines.map((line) => line.size)) || 10;
  const blocks: OutputBlock[] = [];
  const footnotes = extractFootnoteBlocks(page, lines, bodySize, lineOrder);
  lines = lines.filter((line) => !footnotes.lines.has(line));
  const captioned = detectTables ? extractCaptionedTable(page, lines, continuingTable) : { lines, table: null, continues: false };
  lines = captioned.lines;
  if (captioned.table) {
    const x0 = Math.min(...captioned.table.lines.map((line) => line.x0));
    const x1 = Math.max(...captioned.table.lines.map((line) => line.x1));
    const top = Math.min(...captioned.table.lines.map((line) => line.top));
    const bottom = Math.max(...captioned.table.lines.map((line) => line.bottom));
    blocks.push({
      kind: 'table', text: captioned.table.rows.flat().join(' '), markdown: renderTable(captioned.table.rows),
      anchors: mergeAnchors(captioned.table.lines),
      order: Math.min(...captioned.table.lines.map((line) => lineOrder.get(line) ?? Number.MAX_SAFE_INTEGER)),
      ...(captioned.table.visualFallback ? { tableVisual: { page: page.page, bbox: [x0, top, x1, bottom] } as const } : {}),
    });
  }
  const tables = detectTables ? detectTableRuns(lines) : [];
  const tableLines = new Set(tables.flatMap((table) => table.lines));
  for (const table of tables) {
    blocks.push({
      kind: 'table', text: table.rows.flat().join(' '), markdown: renderTable(table.rows), anchors: mergeAnchors(table.lines),
      order: Math.min(...table.lines.map((line) => lineOrder.get(line) ?? Number.MAX_SAFE_INTEGER)),
    });
  }
  lines = lines.filter((line) => !tableLines.has(line));
  let paragraph: LayoutLine[] = [];
  const flush = (): void => {
    if (!paragraph.length) return;
    let text = paragraph[0].text;
    for (const line of paragraph.slice(1)) text = dehyphenatingJoin(text, line.text);
    const order = Math.min(...paragraph.map((line) => lineOrder.get(line) ?? Number.MAX_SAFE_INTEGER));
    const anchors = mergeAnchors(paragraph);
    const fontSize = median(paragraph.map((line) => line.size));
    const lastLine = paragraph.at(-1);
    const bases = paragraph.map((line) => localColumnLeft(page, line, lines));
    const fullyInset = paragraph.length >= 2 && paragraph.every((line, index) => line.x0 - bases[index] >= bodySize * 1.35);
    const quotationMarks = /^[“«"].*[”»"](?:\s*[([][^\n]{0,80})?$/u.test(text);
    const quoted = text.length >= 40 && quotationMarks && (fullyInset || paragraph.length <= 8);
    if (quoted) {
      blocks.push({ kind: 'quote', text, markdown: `> ${text}`, anchors, order, fontSize, lastLine });
    } else {
      const split = leadingUppercaseHeading(text);
      if (split) {
        blocks.push({ kind: 'heading', text: split.heading, markdown: `## ${split.heading}`, anchors, order, fontSize, lastLine });
        blocks.push({ kind: 'paragraph', text: split.remainder, markdown: split.remainder, anchors, order: order + 0.01, fontSize, lastLine });
      } else {
        const markdown = /^(?:tabla|table)\s+\d+[.:]/i.test(text)
          ? `**${text}**`
          : /^(?:fuente|source)\s*:/i.test(text) ? `*${text}*` : text;
        blocks.push({ kind: 'paragraph', text, markdown, anchors, order, fontSize, lastLine });
      }
    }
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const short = line.text.length <= 180;
    const ocrTableRow = page.ocr && ((line.text.match(/\bX\b/gi) ?? []).length >= 1 || /\b(?:D\.?\s*)?(?:Único|Múltiple)\b/i.test(line.text));
    const semanticHeading = !ocrTableRow && (/^(?:\d+(?:\.\d+)*\.?\s+)?[\p{Lu}\d][\p{Lu}\d\sÁÉÍÓÚÜÑÀÈÌÒÙÇ:;,.'’()¿?¡!–—/-]{8,}$/u.test(line.text)
      || /^(?:abstract|resumen|résumé|resume|introduction|introducción|conclusion|conclusions|conclusión|notes|notas|footnotes|references|referencias|bibliography|bibliografía|funding|acknowledg(?:e)?ments|agradecimientos)$/i.test(line.text.trim()));
    const precedingBlock = blocks.at(-1);
    const headingContinuation = !!precedingBlock
      && ['title', 'heading'].includes(precedingBlock.kind)
      && precedingBlock.lastLine?.page === line.page
      && Math.abs((precedingBlock.fontSize ?? line.size) - line.size) <= Math.max(0.8, line.size * 0.08)
      && line.top - precedingBlock.lastLine.top <= Math.max(line.size, precedingBlock.lastLine.size) * 1.7;
    const fontHeading = (!page.ocr || isFirstPage) && line.size >= bodySize * 1.17 && (/^[\p{Lu}\d]/u.test(line.text) || headingContinuation);
    const heading = short && (fontHeading || semanticHeading) && !/[.;,-]$/.test(line.text);
    if (heading) {
      flush();
      let previousBlock = blocks.at(-1);
      const orphanTitleContinuation = isFirstPage
        && previousBlock?.kind === 'paragraph'
        && blocks.some((block) => block.kind === 'title')
        && !blocks.some((block) => block.kind === 'heading' && /^(?:abstract|resumen|résumé|introduction|introducción)$/i.test(block.text.trim()))
        && previousBlock.text.length >= 30
        && line.text.trim().split(/\s+/).length <= 4
        && previousBlock.lastLine?.page === line.page
        && line.top - previousBlock.lastLine.top <= Math.max(line.size, previousBlock.lastLine.size) * 1.9
        && /(?:[:;,–—-]|\b(?:a|an|and|of|for|to|towards?|methodological|quantitative|qualitative|historical|critical|comparative|social|political|cultural))$/i.test(previousBlock.text.trim());
      if (orphanTitleContinuation && previousBlock) {
        previousBlock.text = dehyphenatingJoin(previousBlock.text, line.text);
        previousBlock.markdown = previousBlock.text;
        previousBlock.anchors = [...previousBlock.anchors, anchor(line)];
        previousBlock.lastLine = line;
        continue;
      }
      const romanPrefix = previousBlock?.kind === 'paragraph' && /^[IVXLCDM]+\.?$/i.test(previousBlock.text.trim())
        ? previousBlock.text.trim().replace(/\.$/, '') : '';
      if (romanPrefix) {
        blocks.pop();
        line.text = `${romanPrefix}. ${line.text}`;
        previousBlock = blocks.at(-1);
      }
      const continuesTitle = isFirstPage
        && previousBlock?.kind === 'title'
        && previousBlock.lastLine?.page === line.page
        && line.top - previousBlock.lastLine.top <= Math.max(line.size, previousBlock.lastLine.size) * 1.7
        && line.size >= bodySize * 1.22;
      const title = continuesTitle || (isFirstPage && blocks.every((block) => block.kind !== 'title') && line.size >= bodySize * 1.35);
      const kind = title ? 'title' : 'heading';
      const joinsPreviousHeading = previousBlock
        && previousBlock.kind === kind
        && previousBlock.lastLine?.page === line.page
        && Math.abs((previousBlock.fontSize ?? line.size) - line.size) <= Math.max(0.8, line.size * 0.08)
        && line.top - previousBlock.lastLine.top <= Math.max(line.size, previousBlock.lastLine.size) * 1.7;
      if (joinsPreviousHeading && previousBlock) {
        previousBlock.text = dehyphenatingJoin(previousBlock.text, line.text);
        previousBlock.markdown = `${kind === 'title' ? '#' : '##'} ${previousBlock.text}`;
        previousBlock.anchors = [...previousBlock.anchors, anchor(line)];
        previousBlock.lastLine = line;
      } else blocks.push({
        kind, text: line.text, markdown: `${kind === 'title' ? '#' : '##'} ${line.text}`,
        anchors: [anchor(line)], order: lineOrder.get(line), fontSize: line.size, lastLine: line,
      });
      continue;
    }
    const previous = paragraph.at(-1);
    const gap = previous ? line.top - previous.bottom : 0;
    const columnJump = previous && (line.x0 > previous.x1 + 30 || previous.x0 > line.x1 + 30);
    const startsList = /^([•●▪◦*-]|\d+[.)])\s+/.test(line.text);
    const previousNearMargin = previous
      ? previous.x0 - localColumnLeft(page, previous, lines) < bodySize * 0.8
      : false;
    const indentedParagraphStart = previous
      && previousNearMargin
      && line.x0 - localColumnLeft(page, line, lines) >= bodySize * 1.45
      && !/[-‐‑‒–—]$/.test(previous.text);
    const semanticBoundary = /^(?:tabla|table)\s+\d+[.:]|^(?:fuente|source)\s*:/i.test(line.text)
      || (previous ? /^(?:fuente|source)\s*:/i.test(previous.text) : false);
    if (previous && (gap > bodySize * 1.15 || columnJump || startsList || indentedParagraphStart || line.paragraphBreakBefore || semanticBoundary)) flush();
    paragraph.push(line);
  }
  flush();
  return { blocks: [...blocks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), ...footnotes.blocks], tableContinues: captioned.continues };
}

async function renderPdfPageCanvas(page: any, scale = 2): Promise<any> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context as any, viewport }).promise;
  return canvas;
}

async function renderPdfPage(page: any, scale = 2): Promise<Buffer> {
  return (await renderPdfPageCanvas(page, scale)).toBuffer('image/png');
}

async function renderComplexTableVisuals(pdf: any, folder: string, blocks: OutputBlock[], signal?: AbortSignal): Promise<void> {
  const assetsFolder = path.join(folder, 'assets');
  for (const block of blocks.filter((candidate) => !!candidate.tableVisual)) {
    abortIfNeeded(signal);
    const visual = block.tableVisual!;
    const page = await pdf.getPage(visual.page);
    const canvas = await renderPdfPageCanvas(page, 2);
    page.cleanup?.();
    const padding = 12;
    const x = Math.max(0, Math.floor(visual.bbox[0] * 2) - padding);
    const y = Math.max(0, Math.floor(visual.bbox[1] * 2) - padding);
    const width = Math.min(canvas.width - x, Math.ceil((visual.bbox[2] - visual.bbox[0]) * 2) + padding * 2);
    const height = Math.min(canvas.height - y, Math.ceil((visual.bbox[3] - visual.bbox[1]) * 2) + padding * 2);
    const { createCanvas } = await import('@napi-rs/canvas');
    const crop = createCanvas(Math.max(1, width), Math.max(1, height));
    crop.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
    const data = crop.toBuffer('image/png');
    const name = `table-p${String(visual.page).padStart(4, '0')}-${sha256Buffer(data).slice(0, 12)}.png`;
    fs.mkdirSync(assetsFolder, { recursive: true });
    atomicWriteFile(path.join(assetsFolder, name), data);
    const transcript = block.markdown.replace(/-->/g, '—>');
    block.markdown = `![Table · page ${visual.page}](assets/${name})\n\n<!-- nodus-table-transcription\n${transcript}\n-->`;
  }
}

type PdfTransform = [number, number, number, number, number, number];
interface PdfImagePlacement {
  bbox: [number, number, number, number];
  pixels: number;
}

function multiplyTransform(left: PdfTransform, right: PdfTransform): PdfTransform {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: PdfTransform, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function placedImages(operators: any, pdfjs: any): PdfImagePlacement[] {
  const placements: PdfImagePlacement[] = [];
  const stack: PdfTransform[] = [];
  let matrix: PdfTransform = [1, 0, 0, 1, 0, 0];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index];
    const args = operators.argsArray[index] ?? [];
    if (operation === pdfjs.OPS.save) { stack.push([...matrix] as PdfTransform); continue; }
    if (operation === pdfjs.OPS.restore) { matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
    if (operation === pdfjs.OPS.transform && args.length >= 6) {
      matrix = multiplyTransform(matrix, args.slice(0, 6).map(Number) as PdfTransform);
      continue;
    }
    const ordinaryImage = operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintJpegXObject;
    const inlineImage = operation === pdfjs.OPS.paintInlineImageXObject;
    if (!ordinaryImage && !inlineImage) continue;
    const corners = [transformPoint(matrix, 0, 0), transformPoint(matrix, 1, 0), transformPoint(matrix, 0, 1), transformPoint(matrix, 1, 1)];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const width = Number(inlineImage ? args[0]?.width : args[1]) || 0;
    const height = Number(inlineImage ? args[0]?.height : args[2]) || 0;
    placements.push({ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], pixels: width * height });
  }
  return placements;
}

function placementArea(placement: PdfImagePlacement): number {
  return Math.max(0, placement.bbox[2] - placement.bbox[0]) * Math.max(0, placement.bbox[3] - placement.bbox[1]);
}

function unionPlacement(left: PdfImagePlacement, right: PdfImagePlacement): PdfImagePlacement {
  return {
    bbox: [
      Math.min(left.bbox[0], right.bbox[0]), Math.min(left.bbox[1], right.bbox[1]),
      Math.max(left.bbox[2], right.bbox[2]), Math.max(left.bbox[3], right.bbox[3]),
    ],
    pixels: left.pixels + right.pixels,
  };
}

function groupImageTiles(placements: PdfImagePlacement[]): PdfImagePlacement[] {
  const groups: PdfImagePlacement[] = [];
  for (const placement of placements) {
    let merged = placement;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      const tolerance = 3;
      const touches = merged.bbox[0] <= candidate.bbox[2] + tolerance
        && merged.bbox[2] >= candidate.bbox[0] - tolerance
        && merged.bbox[1] <= candidate.bbox[3] + tolerance
        && merged.bbox[3] >= candidate.bbox[1] - tolerance;
      if (!touches) continue;
      const union = unionPlacement(candidate, merged);
      const compact = placementArea(union) <= (placementArea(candidate) + placementArea(merged)) * 1.3;
      if (!compact) continue;
      merged = union;
      groups.splice(index, 1);
    }
    groups.push(merged);
  }
  return groups;
}

/**
 * Complete study guides: the images placed on the given pages of a PDF held in memory,
 * cropped at 2× like the Library's own figures. A page whose art is vector-only has no
 * placed image; with `wholePageFallback` it is rendered whole instead.
 */
export async function extractPdfPageFigures(
  data: Uint8Array,
  pages: number[],
  options: { wholePageFallback?: boolean; maxFigures?: number; signal?: AbortSignal } = {},
): Promise<Array<{ page: number; png: Buffer; width: number; height: number; wholePage: boolean }>> {
  const pdfjs = await loadPdfjs();
  // pdfjs transfers (detaches) the buffer it is given: open a copy so the caller's bytes stay usable.
  const pdf = await openPdfData(data.slice(), { forRendering: true });
  const results: Array<{ page: number; png: Buffer; width: number; height: number; wholePage: boolean }> = [];
  const seen = new Set<string>();
  const { createCanvas } = await import('@napi-rs/canvas');
  try {
    for (const pageNumber of [...new Set(pages)].filter((value) => value >= 1 && value <= pdf.numPages)) {
      abortIfNeeded(options.signal);
      if (options.maxFigures && results.length >= options.maxFigures) break;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const pageArea = Math.max(1, base.width * base.height);
      const operators = await page.getOperatorList();
      const groups = groupImageTiles(placedImages(operators, pdfjs).filter((placement) => placement.pixels >= 5_000 && placementArea(placement) >= pageArea * 0.01))
        .filter((group) => group.pixels >= 40_000 && placementArea(group) / pageArea <= 0.92);
      const scale = 2;
      const viewport = page.getViewport({ scale });
      const rendered = await renderPdfPageCanvas(page, scale);
      let found = false;
      for (const group of groups) {
        const corners = [
          viewport.convertToViewportPoint(group.bbox[0], group.bbox[1]), viewport.convertToViewportPoint(group.bbox[2], group.bbox[1]),
          viewport.convertToViewportPoint(group.bbox[0], group.bbox[3]), viewport.convertToViewportPoint(group.bbox[2], group.bbox[3]),
        ];
        const xs = corners.map(([x]: [number, number]) => x);
        const ys = corners.map(([, y]: [number, number]) => y);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys)));
        const x1 = Math.min(rendered.width, Math.ceil(Math.max(...xs)));
        const y1 = Math.min(rendered.height, Math.ceil(Math.max(...ys)));
        if (x1 - x0 < 48 || y1 - y0 < 48) continue;
        const crop = createCanvas(x1 - x0, y1 - y0);
        crop.getContext('2d').drawImage(rendered, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
        const png = crop.toBuffer('image/png');
        const hash = sha256Buffer(png);
        if (seen.has(hash)) continue;
        seen.add(hash);
        results.push({ page: pageNumber, png, width: x1 - x0, height: y1 - y0, wholePage: false });
        found = true;
      }
      if (!found && options.wholePageFallback) {
        results.push({ page: pageNumber, png: rendered.toBuffer('image/png'), width: rendered.width, height: rendered.height, wholePage: true });
      }
      page.cleanup?.();
    }
  } finally {
    await pdf.destroy?.();
  }
  return results;
}

async function extractPdfAssets(pdf: any, folder: string, layouts: PageLayout[], scannedPages: Set<number>, signal?: AbortSignal): Promise<OutputBlock[]> {
  const pdfjs = await loadPdfjs();
  const results: OutputBlock[] = [];
  const seen = new Set<string>();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    abortIfNeeded(signal);
    const page = await pdf.getPage(pageNumber);
    const operators = await page.getOperatorList();
    const layout = layouts[pageNumber - 1];
    const pageArea = Math.max(1, (layout?.width ?? 0) * (layout?.height ?? 0));
    const placements = placedImages(operators, pdfjs).filter((placement) => {
      const area = placementArea(placement);
      return placement.pixels >= 5_000 && area >= pageArea * 0.003;
    });
    const groups = groupImageTiles(placements).filter((group) => {
      const coverage = placementArea(group) / pageArea;
      if (scannedPages.has(pageNumber) && coverage >= 0.65) return false;
      return group.pixels >= 40_000 && coverage <= 0.92;
    });
    if (!groups.length) { page.cleanup?.(); continue; }
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const renderedPage = await renderPdfPageCanvas(page, scale);
    for (const group of groups) {
      const corners = [
        viewport.convertToViewportPoint(group.bbox[0], group.bbox[1]),
        viewport.convertToViewportPoint(group.bbox[2], group.bbox[1]),
        viewport.convertToViewportPoint(group.bbox[0], group.bbox[3]),
        viewport.convertToViewportPoint(group.bbox[2], group.bbox[3]),
      ];
      const xs = corners.map(([x]: [number, number]) => x);
      const ys = corners.map(([, y]: [number, number]) => y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(renderedPage.width, Math.ceil(Math.max(...xs)));
      const y1 = Math.min(renderedPage.height, Math.ceil(Math.max(...ys)));
      if (x1 - x0 < 24 || y1 - y0 < 24) continue;
      const { createCanvas } = await import('@napi-rs/canvas');
      const crop = createCanvas(x1 - x0, y1 - y0);
      crop.getContext('2d').drawImage(renderedPage, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      const png = crop.toBuffer('image/png');
      const hash = sha256Buffer(png);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const fileName = `figure-p${String(pageNumber).padStart(4, '0')}-${hash.slice(0, 12)}.png`;
      const target = assertInside(folder, path.join(folder, 'assets', fileName));
      if (!fs.existsSync(target)) atomicWriteFile(target, png);
      const groupTop = (layout?.height ?? 0) - group.bbox[3];
      const groupBottom = (layout?.height ?? 0) - group.bbox[1];
      const captionLine = layout?.lines
        .filter((line) => /^(fig(?:ura|ure)?|gr[aá]fic[oa]|mapa|table|tabla)\b/i.test(line.text))
        .sort((left, right) => {
          const distance = (line: LayoutLine) => line.bottom <= groupTop ? groupTop - line.bottom : line.top >= groupBottom ? line.top - groupBottom : 0;
          return distance(left) - distance(right);
        })[0];
      const caption = captionLine?.text ?? `Figura de la página ${pageNumber}`;
      const captionOrder = captionLine && layout ? readingOrder(layout).indexOf(captionLine) : Number.MAX_SAFE_INTEGER;
      results.push({
        kind: 'figure', text: caption,
        markdown: `![${caption.replaceAll('[', '').replaceAll(']', '')}](assets/${fileName})`,
        anchors: captionLine ? [anchor(captionLine)] : [{ page: pageNumber, bbox: [0, rounded((layout?.height ?? 0) / 2), rounded(layout?.width ?? 0), rounded(layout?.height ?? 0)] }],
        order: captionOrder === Number.MAX_SAFE_INTEGER ? captionOrder : captionLine!.top < groupTop ? captionOrder + 0.25 : captionOrder - 0.25,
      });
    }
    page.cleanup?.();
  }
  return results;
}

function plainTextBlocks(text: string, page = 1): OutputBlock[] {
  const cleaned = text.replace(/\r\n?/g, '\n').normalize('NFC').replace(/\u00ad/g, '');
  const parts = cleaned.split(/\n\s*\n+/).map((part) => part.split('\n').reduce(dehyphenatingJoin, '')).map(cleanInlineText).filter(Boolean);
  return parts.map((part, index) => {
    const heading = part.length < 160 && index < 20 && !/[.!?]$/.test(part);
    return {
      kind: heading ? (index === 0 ? 'title' : 'heading') : 'paragraph',
      text: part,
      markdown: heading ? `${index === 0 ? '#' : '##'} ${part}` : part,
      anchors: [{ page, bbox: [0, 0, 0, 0] }],
    };
  });
}

function markdownBlocks(markdown: string): OutputBlock[] {
  const normalized = normalizeCleanMarkdown(markdown);
  const blocks: OutputBlock[] = [];
  let cursor = 0;
  for (const part of normalized.trim().split(/\n{2,}/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(part);
    const table = /^\|.+\|\n\|(?:\s*:?-+:?\s*\|)+/m.test(part);
    const image = /^!\[/.test(part);
    const kind: OutputBlock['kind'] = heading ? (heading[1].length === 1 && cursor === 0 ? 'title' : 'heading') : table ? 'table' : image ? 'figure' : part.startsWith('>') ? 'quote' : 'paragraph';
    blocks.push({ kind, text: heading?.[2] ?? part.replace(/[*_`>#|[\]()!-]/g, ' '), markdown: part, anchors: [{ page: 1, bbox: [0, 0, 0, 0] }] });
    cursor += part.length + 2;
  }
  return blocks;
}

function copyZipAssets(zip: AdmZip, folder: string, matcher: RegExp): Array<{ source: string; target: string }> {
  const copied: Array<{ source: string; target: string }> = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !matcher.test(entry.entryName)) continue;
    const bytes = entry.getData();
    const extension = path.extname(entry.entryName).toLowerCase() || '.bin';
    const name = `${safeLibraryFolderName(path.basename(entry.entryName, extension))}-${sha256Buffer(bytes).slice(0, 12)}${extension}`;
    const target = assertInside(folder, path.join(folder, 'assets', name));
    if (!fs.existsSync(target)) atomicWriteFile(target, bytes);
    copied.push({ source: entry.entryName.replace(/\\/g, '/'), target: `assets/${name}` });
  }
  return copied;
}

/**
 * Older Library versions encoded every dot when a storage filename contained
 * Unicode or another unsafe character (for example `An%C3%A1lisis%2Epdf`). Keep
 * those immutable paths in place, but recover the real suffix for extraction.
 */
function sourceExtension(source: string): string {
  const literal = path.extname(source).toLowerCase();
  if (literal) return literal;
  try { return path.extname(decodeURIComponent(path.basename(source))).toLowerCase(); }
  catch { return ''; }
}

async function nonPdfBlocks(source: string, folder: string): Promise<{ blocks: OutputBlock[]; pages: LibrarySourceMap['pages'] }> {
  const extension = sourceExtension(source);
  if (['.md', '.markdown'].includes(extension)) return { blocks: markdownBlocks(fs.readFileSync(source, 'utf8')), pages: [{ page: 1, width: 0, height: 0 }] };
  if (['.txt', '.rtf'].includes(extension)) return { blocks: plainTextBlocks(fs.readFileSync(source, 'utf8')), pages: [{ page: 1, width: 0, height: 0 }] };
  if (extension === '.csv' || extension === '.tsv') return { blocks: markdownBlocks(csvFileToText(source)), pages: [{ page: 1, width: 0, height: 0 }] };
  if (['.xlsx', '.xls', '.ods'].includes(extension)) return { blocks: markdownBlocks(xlsxFileToText(source)), pages: [{ page: 1, width: 0, height: 0 }] };
  if (extension === '.docx') {
    const mammoth: any = await import('mammoth');
    const html = String((await mammoth.convertToHtml({ path: source })).value ?? '');
    const zip = new AdmZip(source);
    const assets = copyZipAssets(zip, folder, /^word\/media\//i);
    const service = createTurndown();
    let markdown = service.turndown(html);
    if (assets.length) markdown += `\n\n## Recursos extraídos\n\n${assets.map((asset, index) => `![Recurso ${index + 1}](${asset.target})`).join('\n\n')}`;
    return { blocks: markdownBlocks(markdown), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  if (extension === '.epub') {
    const zip = new AdmZip(source);
    const assets = copyZipAssets(zip, folder, /\.(png|jpe?g|gif|webp|svg)$/i);
    const lookup = new Map(assets.map((asset) => [asset.source, asset.target]));
    const service = createTurndown();
    const chapters = zip.getEntries().filter((entry) => !entry.isDirectory && /\.(xhtml|html?)$/i.test(entry.entryName) && !/(^|\/)(nav|toc)\./i.test(entry.entryName));
    const markdown = chapters.map((entry) => {
      let html = entry.getData().toString('utf8');
      html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (_all, prefix, raw, suffix) => {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.entryName), raw));
        return `${prefix}${lookup.get(resolved) ?? raw}${suffix}`;
      });
      return service.turndown(html);
    }).filter(Boolean).join('\n\n');
    return { blocks: markdownBlocks(markdown), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  if (['.html', '.htm', '.xml', '.jats'].includes(extension)) {
    const service = createTurndown();
    return { blocks: markdownBlocks(service.turndown(fs.readFileSync(source, 'utf8'))), pages: [{ page: 1, width: 0, height: 0 }] };
  }
  throw new Error(`Formato de extracción no compatible: ${extension || '(sin extensión)'}`);
}

function mergePageContinuations(blocks: OutputBlock[]): OutputBlock[] {
  const merged: OutputBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    const previousPage = previous?.anchors.at(-1)?.page;
    const currentPage = block.anchors[0]?.page;
    const previousBottom = previous?.anchors.at(-1)?.bbox?.[3];
    const currentTop = block.anchors[0]?.bbox?.[1];
    const samePageHyphenation = previousPage === currentPage
      && previousBottom != null
      && currentTop != null
      && currentTop - previousBottom <= 4
      && /[\p{L}\p{N}]{2,}-$/u.test(previous?.text.trim() ?? '')
      && /^[\p{Ll}\p{N}]/u.test(block.text.trim());
    const continuation = previous?.kind === 'paragraph'
      && block.kind === 'paragraph'
      && previousPage != null
      && (currentPage === previousPage + 1 || samePageHyphenation)
      && !/[.!?…:;”»)]$/.test(previous.text.trim())
      && (/^\p{Ll}/u.test(block.text.trim()) || (/[-‐‑‒–—]$/.test(previous.text.trim()) && /^[\p{L}\p{N}]/u.test(block.text.trim())));
    if (!continuation) { merged.push(block); continue; }
    previous.text = dehyphenatingJoin(previous.text, block.text);
    previous.markdown = previous.text;
    previous.anchors = [...previous.anchors, ...block.anchors];
  }
  return merged;
}

function extractEndnotes(blocks: OutputBlock[]): { blocks: OutputBlock[]; notes: OutputBlock[] } {
  const headingIndex = blocks.findIndex((block) => ['notes', 'notas', 'footnotes'].includes(normalizedHeading(block.text)));
  if (headingIndex < 0) return { blocks, notes: [] };
  const referenced = new Set(blocks.slice(0, headingIndex).flatMap((block) => [...block.markdown.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((match) => match[1])));
  if (!referenced.size) return { blocks, notes: [] };
  const before = blocks.slice(0, headingIndex);
  const after: OutputBlock[] = [];
  const notes: OutputBlock[] = [];
  let current: OutputBlock | null = null;
  for (const block of blocks.slice(headingIndex + 1)) {
    if (block.kind === 'heading') {
      current = null;
      after.push(block);
      continue;
    }
    const match = /^(\d{1,3})[.)]\s+(.+)$/.exec(block.text);
    if (match) {
      current = referenced.has(match[1]) ? {
        ...block,
        kind: 'note',
        text: match[2],
        markdown: `[^${match[1]}]: ${match[2]}`,
      } : null;
      if (current) notes.push(current); else after.push(block);
      continue;
    }
    if (current && ['paragraph', 'quote', 'list'].includes(block.kind)) {
      current.text = dehyphenatingJoin(current.text, block.text);
      current.markdown = current.markdown.replace(/:\s[\s\S]*$/, `: ${current.text}`);
      current.anchors = [...current.anchors, ...block.anchors];
    } else after.push(block);
  }
  if (!notes.length) return { blocks, notes: [] };
  return { blocks: [...before, ...after], notes };
}

function extractLoosePageNotes(blocks: OutputBlock[], layouts: PageLayout[]): { blocks: OutputBlock[]; notes: OutputBlock[] } {
  const referenced = new Set(blocks.flatMap((block) => [...block.markdown.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((match) => match[1])));
  if (!referenced.size) return { blocks, notes: [] };
  const notes: OutputBlock[] = [];
  const retained: OutputBlock[] = [];
  for (const block of blocks) {
    const match = /^(\d{1,3})[.)]\s*(\p{L}.+)$/u.exec(block.text);
    const page = block.anchors[0]?.page;
    const top = block.anchors[0]?.bbox?.[1];
    const pageHeight = page ? layouts[page - 1]?.height : 0;
    const pageSizes = page
      ? (layouts[page - 1]?.lines.filter((line) => line.text.length > 20).map((line) => line.size).sort((a, b) => a - b) ?? [])
      : [];
    const pageBodySize = pageSizes[Math.min(pageSizes.length - 1, Math.floor(pageSizes.length * 0.75))] ?? 0;
    const smallPrint = !!block.fontSize && !!pageBodySize && block.fontSize <= pageBodySize * 0.92;
    if (!match || !referenced.has(match[1]) || !pageHeight || top < pageHeight * 0.45 || !smallPrint) {
      retained.push(block);
      continue;
    }
    notes.push({ ...block, kind: 'note', text: match[2], markdown: `[^${match[1]}]: ${match[2]}` });
  }
  return { blocks: retained, notes };
}

function normalizedHeading(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^a-z\s]/g, '').trim();
}

export function refineDocumentHeadings(blocks: OutputBlock[], layouts: PageLayout[]): void {
  const bibliographyIndex = blocks.findIndex((block) => block.kind === 'heading' && [
    'references', 'bibliography', 'referencias', 'bibliografia', 'works cited', 'fuentes citadas',
  ].includes(normalizedHeading(block.text)));
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind !== 'heading') continue;
    const page = block.anchors[0]?.page;
    if (page && layouts[page - 1]?.ocr) {
      let next = index + 1;
      while (blocks[next]?.kind === 'heading' && blocks[next].anchors[0]?.page === page) next += 1;
      let tableRowsFollow = false;
      for (let lookahead = next; lookahead <= next + 2; lookahead += 1) {
        const candidate = blocks[lookahead];
        if (!candidate || candidate.anchors[0]?.page !== page || candidate.kind !== 'paragraph') break;
        if ((candidate.text.match(/\bX\b/gi) ?? []).length >= 1) { tableRowsFollow = true; break; }
        if (candidate.text.length > 180) break;
      }
      if (tableRowsFollow) {
        block.kind = 'paragraph';
        block.markdown = `**${block.text}**`;
        continue;
      }
    }
    if (bibliographyIndex >= 0 && index > bibliographyIndex
      && /(?:\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)|\b(?:18|19|20)\d{2}[a-z]?\s*:)/i.test(block.text)) {
      block.kind = 'paragraph';
      block.markdown = block.text;
    }
  }
}

function linkNumericReferences(blocks: OutputBlock[]): OutputBlock[] {
  const referenceHeading = blocks.findIndex((block) => block.kind === 'heading' && [
    'references', 'bibliography', 'referencias', 'bibliografia', 'works cited', 'fuentes citadas',
  ].includes(normalizedHeading(block.text)));
  if (referenceHeading < 0) return blocks;
  const definitions = new Set<string>();
  for (const block of blocks.slice(referenceHeading + 1)) {
    const match = /^\[?(\d{1,3})[\].)]\s+(.+)$/.exec(block.text);
    if (!match) continue;
    definitions.add(match[1]);
    block.markdown = `[[${match[1]}]](#nodus-reference-${match[1]}) ${match[2]}`;
  }
  if (!definitions.size) return blocks;
  for (const block of blocks.slice(0, referenceHeading)) {
    if (!['paragraph', 'quote', 'list'].includes(block.kind)) continue;
    block.markdown = block.markdown.replace(/\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g, (whole, group: string, offset: number) => {
      if (block.markdown[offset - 1] === '^' || block.markdown[offset - 1] === '!') return whole;
      const labels = group.match(/\d{1,3}/g) ?? [];
      if (!labels.length || labels.some((label) => !definitions.has(label))) return whole;
      const separators = group.split(/\d{1,3}/).filter(Boolean);
      return labels.map((label, index) => `[[${label}]](#nodus-reference-${label})${separators[index] ?? ''}`).join('');
    });
  }
  return blocks;
}

function notesHeading(blocks: OutputBlock[]): string {
  const sample = ` ${blocks.filter((block) => block.kind === 'paragraph').slice(0, 8).map((block) => block.text).join(' ').toLocaleLowerCase()} `;
  const spanish = (sample.match(/\b(?:el|la|los|las|de|del|que|para|una|un|y)\b/g) ?? []).length;
  const english = (sample.match(/\b(?:the|of|that|for|with|and|a|an)\b/g) ?? []).length;
  return spanish >= english ? 'Notas' : 'Notes';
}

async function pdfBlocks(
  source: string,
  folder: string,
  options: LibraryExtractionOptions,
  onProgress?: LibraryExtractionProgressHandler,
  signal?: AbortSignal,
  remoteOcr?: LibraryRemoteOcr,
): Promise<{ blocks: OutputBlock[]; pages: LibrarySourceMap['pages']; ocrPages: number; blankPages: number }> {
  const pdf = await openPdf(source);
  const layouts: PageLayout[] = [];
  const blank: number[] = [];
  let ocrPages = 0;
  let textless = 0;
  let characters = 0;
  // Documentary preparation defers scans to OCR instead of recognizing them.
  const deferScans = !!options.localOcrOnly && options.ocrMode === 'off';
  try {
    // A scan is recognized from a spread sample, not after reading every page.
    if (deferScans && await sampleScanVerdict(pdf, signal) === 'scan') throw new Error('documentary_ocr_deferred');
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      abortIfNeeded(signal);
      const page = await pdf.getPage(pageNumber);
      const layout = await pageLayout(page, pageNumber);
      layouts.push(layout);
      const pageCharacters = layout.lines.reduce((sum, line) => sum + line.text.length, 0);
      characters += pageCharacters;
      if (pageCharacters < TEXTLESS_PAGE_CHARACTERS) {
        textless += 1;
        // Blank leaves and short digital title pages do not require OCR.
        if (!options.localOcrOnly || await pagePaintsImage(page)) blank.push(pageNumber);
      }
      page.cleanup?.();
      onProgress?.({ phase: 'extract', progress: 0.08 + (pageNumber / pdf.numPages) * 0.47, message: `Extrayendo página ${pageNumber} de ${pdf.numPages}…`, page: pageNumber, totalPages: pdf.numPages });
    }
    // A digital document keeps its text; its image-only pages (a cover, plates) have none.
    if (deferScans && isScannedDocument({ pages: pdf.numPages, textless, imageOnly: blank.length, characters })) throw new Error('documentary_ocr_deferred');
    if (blank.length && options.ocrMode !== 'off') {
      const pages = blank.slice(0, options.maxOcrPages);
      if (options.ocrMode === 'local') {
        const recognized = await ocrPdfPages(pdf, pages, options.ocrLanguages, ({ page, totalPages }) => onProgress?.({
          phase: 'ocr', progress: 0.55 + (page / totalPages) * 0.2, message: `OCR local ${page} de ${totalPages}…`, page, totalPages,
        }), {
          localOnly: options.localOcrOnly, signal,
          // A page OCR cannot read stays blank and is counted in the quality report,
          // instead of failing the whole copy and every page already recognised.
          onPageError: (page, error) => console.warn(`[library-extraction] OCR failed on p. ${page}: ${error instanceof Error ? error.message : String(error)}`),
        });
        for (const [pageNumber, result] of recognized) {
          if (!result.text.trim()) continue;
          const layout = layouts[pageNumber - 1];
          const scaleX = layout.width / Math.max(1, result.width);
          const scaleY = layout.height / Math.max(1, result.height);
          layout.lines = result.lines.map((line) => ({
            text: cleanInlineText(line.text), page: pageNumber,
            x0: line.bbox.x0 * scaleX, x1: line.bbox.x1 * scaleX,
            top: line.bbox.y0 * scaleY, bottom: line.bbox.y1 * scaleY,
            size: Math.max(1, line.fontSize * scaleY), items: [],
            paragraphBreakBefore: line.paragraphBreakBefore,
          })).filter((line) => !!line.text);
          layout.ocr = true;
          ocrPages += 1;
        }
      } else {
        if (options.localOcrOnly) throw new Error('documentary_remote_ocr_forbidden');
        if (!remoteOcr) throw new Error('El OCR remoto solo puede usarse tras elegir explícitamente un modelo de visión.');
        for (let index = 0; index < pages.length; index += 1) {
          abortIfNeeded(signal);
          const pageNumber = pages[index];
          const page = await pdf.getPage(pageNumber);
          const image = await renderPdfPage(page);
          page.cleanup?.();
          const text = await remoteOcr({ page: pageNumber, image, mimeType: 'image/png' }, signal);
          if (text.trim()) {
            const layout = layouts[pageNumber - 1];
            layout.lines = plainTextBlocks(text, pageNumber).map((block, line) => ({ text: block.text, page: pageNumber, x0: 0, x1: layout.width, top: line * 12, bottom: line * 12 + 10, size: 10, items: [], paragraphBreakBefore: true }));
            layout.ocr = true;
            ocrPages += 1;
          }
          onProgress?.({ phase: 'ocr', progress: 0.55 + ((index + 1) / pages.length) * 0.2, message: `OCR remoto ${index + 1} de ${pages.length}…` });
        }
      }
    }
    if (options.localOcrOnly && !deferScans && blank.length > ocrPages) throw new Error('documentary_ocr_incomplete');
    const chrome = repeatedChrome(layouts);
    const pageContent: OutputBlock[] = [];
    let continuingTable = false;
    for (let index = 0; index < layouts.length; index += 1) {
      const page = pageBlocks(layouts[index], chrome, options.detectTables, index === 0, continuingTable);
      pageContent.push(...page.blocks);
      continuingTable = page.tableContinues;
    }
    refineDocumentHeadings(pageContent, layouts);
    const pageNotes = pageContent.filter((block) => block.kind === 'note');
    const looseNotes = extractLoosePageNotes(mergePageContinuations(pageContent.filter((block) => block.kind !== 'note')), layouts);
    const endnotes = extractEndnotes(looseNotes.blocks);
    const blocks = linkNumericReferences(endnotes.blocks);
    // Without images a complex table keeps its Markdown transcription instead of a
    // rendered crop: text-only callers (documentary indexing) never read the assets.
    if (options.extractImages) await renderComplexTableVisuals(pdf, folder, blocks, signal);
    if (options.extractImages) {
      onProgress?.({ phase: 'assets', progress: 0.78, message: 'Extrayendo imágenes y figuras…' });
      blocks.push(...await extractPdfAssets(pdf, folder, layouts, new Set(blank), signal));
    }
    blocks.sort((a, b) => a.anchors[0].page - b.anchors[0].page || (a.order ?? 0) - (b.order ?? 0));
    const referencedNotes = new Set(blocks.flatMap((block) => [...block.markdown.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((match) => match[1])));
    const notes = [...pageNotes, ...looseNotes.notes, ...endnotes.notes];
    for (const note of notes) {
      const label = /^\[\^([^\]]+)\]:/.exec(note.markdown)?.[1];
      if (label && !referencedNotes.has(label)) blocks.push({
        ...note,
        kind: 'paragraph',
        text: `${label}. ${note.text}`,
        markdown: `${label}. ${note.text}`,
      });
    }
    blocks.sort((a, b) => a.anchors[0].page - b.anchors[0].page || (a.order ?? 0) - (b.order ?? 0));
    if (notes.length) {
      const unique = new Map<string, OutputBlock>();
      for (const note of notes) {
        const label = /^\[\^([^\]]+)\]:/.exec(note.markdown)?.[1];
        if (label && referencedNotes.has(label) && !unique.has(label)) unique.set(label, note);
      }
      if (unique.size) {
        const first = unique.values().next().value as OutputBlock;
        const heading = notesHeading(blocks);
        blocks.push({ kind: 'heading', text: heading, markdown: `## ${heading}`, anchors: first.anchors });
        blocks.push(...unique.values());
      }
    }
    return {
      blocks,
      pages: layouts.map((layout) => ({ page: layout.page, width: rounded(layout.width), height: rounded(layout.height) })),
      ocrPages,
      blankPages: blank.length - ocrPages,
    };
  } finally {
    await pdf.destroy?.();
  }
}

function qualityReport(markdown: string, blocks: OutputBlock[], ocrPages: number, blankPages: number): LibraryQualityReport {
  const prose = markdown.replace(/https?:\/\/\S+/g, 'URL');
  const warnings: string[] = [];
  const doubleSpaces = (prose.match(/(?<!\n) {2,}/g) ?? []).length;
  const decomposedUnicodeMarks = [...markdown].filter((character) => /\p{M}/u.test(character)).length;
  const softHyphens = (markdown.match(/\u00ad/g) ?? []).length;
  const brokenWordLineWraps = (markdown.match(/\p{L}-\n\p{Ll}/gu) ?? []).length;
  const footnoteReferences = [...markdown.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((match) => match[1]);
  const footnoteDefinitions = [...markdown.matchAll(/^\[\^([^\]]+)\]:/gm)].map((match) => match[1]);
  const referenceSet = new Set(footnoteReferences);
  const definitionSet = new Set(footnoteDefinitions);
  const unresolvedFootnotes = [...new Set([
    ...footnoteReferences.filter((label) => !definitionSet.has(label)),
    ...footnoteDefinitions.filter((label) => !referenceSet.has(label)),
  ])];
  if (blankPages) warnings.push(`${blankPages} página(s) quedaron sin texto.`);
  if (doubleSpaces) warnings.push('El texto contiene espacios dobles inesperados.');
  if (brokenWordLineWraps) warnings.push('Quedan palabras partidas al final de línea.');
  if (unresolvedFootnotes.length) warnings.push(`Hay ${unresolvedFootnotes.length} nota(s) sin referencia bidireccional.`);
  if (markdown.trim().length < 100) warnings.push('La extracción contiene muy poco texto.');
  const status = warnings.length === 0 ? 'passed' : markdown.trim().length >= 100 ? 'needs-review' : 'failed';
  return {
    status, characters: markdown.length, words: (markdown.match(/[\p{L}\p{N}]+/gu) ?? []).length,
    blocks: blocks.length, headings: blocks.filter((block) => ['title', 'heading'].includes(block.kind)).length,
    figures: blocks.filter((block) => block.kind === 'figure').length,
    tables: blocks.filter((block) => block.kind === 'table').length,
    ocrPages, blankPages, doubleSpaces, decomposedUnicodeMarks, softHyphens, brokenWordLineWraps,
    footnoteReferences: footnoteReferences.length, footnoteDefinitions: footnoteDefinitions.length,
    unresolvedFootnotes: unresolvedFootnotes.length, warnings,
  };
}

function originalPath(item: LibraryItemRecord, store: LibraryDiskStore): string {
  const folder = store.itemFolder(item.storageId);
  const candidates = [
    item.files?.original,
    ...[...item.attachments].sort((a, b) => (a.role === 'original' ? -1 : b.role === 'original' ? 1 : 0)).map((attachment) => attachment.relativePath),
  ].filter((value): value is string => !!value);
  for (const relative of candidates) {
    const file = resolveLibraryFile(folder, relative);
    if (file) return file;
  }
  throw new Error('El documento no tiene un original local compatible para extraer.');
}

export async function extractLibraryItem(options: {
  item: LibraryItemRecord;
  store: LibraryDiskStore;
  extractionOptions?: Partial<LibraryExtractionOptions>;
  onProgress?: LibraryExtractionProgressHandler;
  signal?: AbortSignal;
  remoteOcr?: LibraryRemoteOcr;
}): Promise<LibraryExtractionResult> {
  const { store, signal, onProgress } = options;
  const settings = { ...DEFAULT_LIBRARY_EXTRACTION_OPTIONS, ...(options.extractionOptions ?? {}) };
  const source = originalPath(options.item, store);
  const folder = store.itemFolder(options.item.storageId);
  const extractionRoot = assertInside(folder, path.join(folder, '.nodus', 'extractions'));
  const staging = assertInside(extractionRoot, path.join(extractionRoot, `.staging-${randomUUID()}`));
  fs.mkdirSync(staging, { recursive: true });
  try {
    abortIfNeeded(signal);
    onProgress?.({ phase: 'analyze', progress: 0.02, message: `Analizando ${path.basename(source)}…` });
    const extracted = sourceExtension(source) === '.pdf'
      ? await pdfBlocks(source, staging, settings, onProgress, signal, options.remoteOcr)
      : { ...(await nonPdfBlocks(source, staging)), ocrPages: 0, blankPages: 0 };
    abortIfNeeded(signal);
    const blocks = extracted.blocks.filter((block) => block.markdown.trim());
    if (!blocks.length) throw new Error('No se pudo recuperar texto ni contenido legible del original.');
    const rendered: string[] = [];
    const sourceBlocks: LibrarySourceBlock[] = [];
    let cursor = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const markdown = normalizeCleanMarkdown(block.markdown).trim();
      if (!markdown) continue;
      const chunk = `${markdown}\n\n`;
      sourceBlocks.push({
        id: `${safeLibraryFolderName(options.item.storageId).slice(0, 20)}-${sha256Buffer(`${block.kind}\0${index}\0${block.text}`).slice(0, 16)}`,
        kind: block.kind, markdown: { start: cursor, end: cursor + markdown.length },
        anchors: block.anchors, textSha256: sha256Buffer(block.text),
      });
      rendered.push(chunk);
      cursor += chunk.length;
    }
    const markdown = normalizeCleanMarkdown(rendered.join(''));
    const quality = qualityReport(markdown, blocks, extracted.ocrPages, extracted.blankPages);
    const readableBefore = store.readMaterializedItem(options.item.storageId) ?? options.item;
    if (quality.status === 'failed' && readableBefore.files?.reader) {
      // `; ` is the separator the renderer's catalogue splits a list of our sentences on, so
      // this reason and the log line the queue writes stay translatable item by item.
      throw new Error(quality.warnings.join('; ') || 'La extracción no produjo una copia legible.');
    }
    const sourceSha256 = sha256File(source);
    const cleanContentFingerprint = sha256Buffer(markdown);
    const cleanExtractionFingerprint = extractionFingerprint({ sourceSha256, options: settings });
    const versionFolder = assertInside(extractionRoot, path.join(extractionRoot, cleanExtractionFingerprint));
    const readerFile = path.join(staging, 'reader.md');
    const mapFile = path.join(staging, 'source-map.json');
    const reportFile = path.join(staging, 'quality-report.json');
    onProgress?.({ phase: 'write', progress: 0.96, message: 'Guardando Markdown y trazabilidad…' });
    atomicWriteFile(readerFile, markdown);
    const sourceMap: LibrarySourceMap = {
      version: 1,
      source: { file: path.relative(folder, source), sha256: sourceSha256 },
      reader: { file: 'reader.md', sha256: cleanContentFingerprint },
      pages: extracted.pages,
      blocks: sourceBlocks,
    };
    atomicWriteJson(mapFile, sourceMap);
    atomicWriteJson(reportFile, quality);
    abortIfNeeded(signal);
    if (fs.existsSync(versionFolder)) fs.rmSync(staging, { recursive: true, force: true });
    else fs.renameSync(staging, versionFolder);
    const relativeVersion = path.relative(folder, versionFolder).split(path.sep).join('/');
    const now = new Date().toISOString();
    const current = store.readMaterializedItem(options.item.storageId) ?? options.item;
    const files = {
      ...(current.files ?? {}),
      reader: path.join(relativeVersion, 'reader.md'),
      sourceMap: path.join(relativeVersion, 'source-map.json'),
      qualityReport: path.join(relativeVersion, 'quality-report.json'),
      annotations: current.files?.annotations ?? 'annotations.json',
      orphanedAnnotations: current.files?.orphanedAnnotations ?? 'orphaned-annotations.json',
    };
    let contentRevision = publishLibraryContentRevision({
      item: current,
      extractionFingerprint: cleanExtractionFingerprint,
      contentFingerprint: cleanContentFingerprint,
      files,
      now,
    });
    if (quality.status === 'failed') contentRevision = {
      ...contentRevision,
      components: {
        ...contentRevision.components,
        extraction: {
          ...contentRevision.components.extraction,
          freshness: 'failed',
          reason: quality.warnings.join('; ') || 'The extraction did not produce a complete readable copy.',
        },
      },
    };
    const annotationsFile = assertInside(folder, path.join(folder, files.annotations));
    const orphanedFile = assertInside(folder, path.join(folder, files.orphanedAnnotations));
    const priorReader = current.files?.reader
      ? assertInside(folder, path.join(folder, current.files.reader))
      : null;
    if (fs.existsSync(annotationsFile)) reanchorLibraryAnnotations({
      annotationsFile,
      orphanedFile,
      oldText: priorReader && fs.existsSync(priorReader) ? fs.readFileSync(priorReader, 'utf8') : '',
      newText: markdown,
      contentFingerprint: cleanContentFingerprint,
      now,
    });
    const item = store.upsertItem({
      ...current,
      files,
      contentRevision,
      extraction: {
        status: quality.status === 'passed' ? 'ready' : quality.status === 'needs-review' ? 'needs-review' : 'failed',
        progress: 1,
        engine: `${LIBRARY_EXTRACTION_PIPELINE} (${settings.ocrMode})`,
        updatedAt: now,
        ...(quality.status === 'failed' ? { error: quality.warnings.join('; ') } : {
          lastSuccessfulAt: now,
          lastSuccessfulFingerprint: cleanExtractionFingerprint,
        }),
      },
    }, current.clock.revision, now);
    return { item, quality, sourceMap };
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
