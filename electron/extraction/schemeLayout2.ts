// Frozen: the layout-2 classifier, kept so works decluttered with it keep their text. Do not
// edit; change the current classifier in schemeLayout.ts (see schemeClassifiers.ts).

/**
 * Reaction schemes, figures and tables in a PDF's text layer: short small-type fragments
 * ("CH", "2", "1) LDA, THF", "vernolepin") spread around a drawing. Extracted in reading
 * order they land in the middle of the prose. This finds them from the page layout, so the
 * passages built from the text can leave them out without the text itself changing.
 *
 * A line (items sharing a baseline) is a scheme line when every item is set smaller than the
 * body type and it has at most three words or a wide gap between fragments. Footnotes are
 * small too but read as references. Margin items (running heads, chapter tabs) are reported
 * apart. Measured on a 1,345-page synthesis textbook: 10% of the characters, no prose lines.
 */

export interface LayoutItem {
  str: string;
  transform: number[];
  width: number;
  height?: number;
}

export interface PageSchemeLayout {
  /** Body type size in points: the size carrying most characters. */
  body: number;
  /** Per input item: part of a scheme line. */
  scheme: boolean[];
  /** Per input item: outside the text column (running head, tab, page number). */
  margin: boolean[];
}

/** Names the classifier's rules; bumped when they change, so decluttered text is re-extracted.
 *  Decluttered text is re-derived from the PDF whenever its extraction cache entry is gone, so
 *  changing these rules changes the text of every decluttered work at its next extraction and
 *  leaves its analysis out of date — like any extractor change. Change them with a rescan plan. */
export const SCHEME_LAYOUT_CLASSIFIER = 'layout-2' as const;

const WORD = /[A-Za-z][a-z]{2,}/g;
const FOOTNOTE_START = /^\d{1,4}\s+\S/;
const REFERENCE = /[A-Z]\.\s|\(\d{4}\)|\bsee\b/;
const VOLUME_YEAR = /\b\d{1,4}\s*\(\d{4}\)/;
/** A token of a drawn structure: element symbols with counts, digits, bonds, charges. */
const STRUCTURE_TOKEN = /^(?:[A-Z][a-z]?\d*|\d+|[+\-−–=≡→()]|\u2032)+$/;

/** A caption names its figure; it is text a search should find, not part of the drawing. */
const CAPTION = /^(?:fig(?:ure)?\.?|scheme|table|chart)\s*\d/i;

function size(item: LayoutItem): number {
  return Math.round(Math.abs(Number(item.transform[3])) || Number(item.height) || 0);
}

/** Characters of prose per type size on a page: lines of six or more words, by their main
 *  size. Summed over sample pages it gives a book's body size. */
export function typeSizeWeights(items: LayoutItem[], into = new Map<number, number>()): Map<number, number> {
  const lines: Array<{ y: number; items: LayoutItem[] }> = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= Math.max(2, size(item) * 0.3));
    if (line) line.items.push(item); else lines.push({ y, items: [item] });
  }
  for (const line of lines) {
    const str = line.items.map((item) => item.str).join(' ');
    if ((str.match(WORD) ?? []).length < 6) continue;
    const bySize = new Map<number, number>();
    for (const item of line.items) bySize.set(size(item), (bySize.get(size(item)) ?? 0) + item.str.length);
    const main = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
    into.set(main, (into.get(main) ?? 0) + str.length);
  }
  return into;
}

/** The body size: the largest size carrying at least 30% as much prose as the most used one.
 *  Headings carry little prose; a book whose references or problems outweigh its body text
 *  (in smaller type) still gets its body size. */
export function bodySizeOf(weights: Map<number, number>): number {
  const top = Math.max(0, ...weights.values());
  return Math.max(0, ...[...weights].filter(([, weight]) => weight >= top * 0.3).map(([size]) => size));
}

/** `bodyHint` is the book's body size: a page that is mostly a table or a scheme has more small
 *  type than body type, and judged alone would call its schemes body text. */
export function pageSchemeLayout(items: LayoutItem[], bodyHint?: number): PageSchemeLayout {
  const scheme = items.map(() => false);
  const margin = items.map(() => false);
  const text = items.map((item, index) => ({ item, index })).filter(({ item }) => item.str.trim());
  if (!text.length) return { body: 0, scheme, margin };
  const body = bodyHint || bodySizeOf(typeSizeWeights(text.map(({ item }) => item))) || 10;

  // The column: where body-size lines start (at least three of them) and how far they reach.
  const starts = new Map<number, number>();
  for (const { item } of text) if (size(item) === body) starts.set(Math.round(item.transform[4]), (starts.get(Math.round(item.transform[4])) ?? 0) + 1);
  const left = Math.min(...[...starts].filter(([, count]) => count >= 3).map(([x]) => x));
  const right = Math.max(...text.filter(({ item }) => size(item) === body && item.transform[4] >= left - 2).map(({ item }) => item.transform[4] + item.width));
  const column = Number.isFinite(left) && Number.isFinite(right);
  const outside = (item: LayoutItem) => column && (item.transform[4] + item.width < left - 8 || item.transform[4] > right + 8);
  const words = (entries: typeof text) => (entries.map(({ item }) => item.str).join(' ').match(WORD) ?? []).length;

  type Line = { y: number; members: typeof text; small: boolean; scheme: boolean; longest: number; x: number; size: number };
  const lines: Line[] = [];
  const sorted = [...text].sort((a, b) => b.item.transform[5] - a.item.transform[5] || a.item.transform[4] - b.item.transform[4]);
  for (const entry of sorted) {
    const y = entry.item.transform[5];
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= body * 0.4);
    if (line) line.members.push(entry); else lines.push({ y, members: [entry], small: false, scheme: false, longest: 0, x: 0, size: 0 });
  }
  lines.sort((a, b) => b.y - a.y);
  // Prose pieces of the line above: a short piece right under one, at its left edge, ends that
  // paragraph and is neither margin nor scheme.
  let proseAbove: Array<{ x: number; y: number }> = [];
  const endsParagraph = (entries: typeof text) => {
    const first = entries[0].item;
    return proseAbove.some((above) => Math.abs(above.x - first.transform[4]) <= 6 && above.y - first.transform[5] > 0 && above.y - first.transform[5] <= size(first) * 1.8);
  };
  for (const line of lines) {
    line.members.sort((a, b) => a.item.transform[4] - b.item.transform[4]);
    // Pieces of the line between wide gaps: a scheme spreads short labels across the column;
    // prose, even small prose in two columns (problems, sidebars, references), comes in long runs.
    const pieces: Array<typeof text> = [[]];
    for (let k = 0; k < line.members.length; k++) {
      const previous = line.members[k - 1]?.item;
      if (previous && line.members[k].item.transform[4] - (previous.transform[4] + previous.width) > body * 3) pieces.push([]);
      pieces.at(-1)!.push(line.members[k]);
    }
    // Margin: a short piece wholly outside the column (running head, chapter tab, page number).
    // A sidebar of prose outside the column is text like any other.
    const continuing = pieces.filter((entries) => entries.length && endsParagraph(entries));
    proseAbove = pieces.filter((entries) => entries.length && (words(entries) >= 4 || CAPTION.test(entries.map(({ item }) => item.str).join(' ').trim()))).map((entries) => ({ x: entries[0].item.transform[4], y: entries[0].item.transform[5] }));
    const kept = pieces.filter((entries) => {
      const isMargin = entries.every(({ item }) => outside(item)) && words(entries) <= 4 && !continuing.includes(entries);
      if (isMargin) for (const { index } of entries) margin[index] = true;
      return !isMargin;
    });
    line.members = kept.flat();
    if (!line.members.length) continue;
    const str = line.members.map(({ item }) => item.str).join(' ').replace(/\s+/g, ' ').trim();
    const footnote = (FOOTNOTE_START.test(str) && REFERENCE.test(str)) || VOLUME_YEAR.test(str);
    line.small = line.members.every(({ item }) => size(item) < body * 0.92);
    line.longest = Math.max(...kept.map(words));
    line.x = line.members[0].item.transform[4];
    line.size = Math.max(...line.members.map(({ item }) => size(item)));
    // A row of structure fragments ("OH O O N O") is a drawing at any type size.
    const tokens = str.split(' ');
    const structureRow = tokens.length >= 4 && tokens.every((token) => STRUCTURE_TOKEN.test(token)) && !tokens.every((token) => /^\d+$/.test(token));
    line.scheme = (structureRow || (line.small && !footnote && !CAPTION.test(str) && line.longest <= 3)) && !kept.some((entries) => continuing.includes(entries));
  }
  const content = lines.filter((line) => line.members.length);
  // A small row of labels between two scheme rows ("anti favored for R = Me") is part of the
  // scheme; a row of prose there (a caption, a problem, a reference) is not.
  for (let k = 1; k < content.length - 1; k++) {
    const line = content[k];
    if (!line.scheme && line.small && line.longest <= 5 && content[k - 1].scheme && content[k + 1].scheme) line.scheme = true;
  }
  for (let k = 0; k < content.length; k++) {
    const line = content[k];
    if (!line.scheme) continue;
    const above = content[k - 1];
    // A lone one- or two-fragment small row among prose is a superscript (a citation number,
    // a charge), not a scheme.
    if (!above?.scheme && !content[k + 1]?.scheme && line.members.length <= 2) line.scheme = false;
  }
  for (const line of content) if (line.scheme) for (const { index } of line.members) scheme[index] = true;
  return { body, scheme, margin };
}
