/** Canonical documentary chunker, shared by extraction and background preparation. */
export const RETRIEVAL_CHUNKER_VERSION = "words-280-overlap-60/utf8-4096/source-locators/3";
export const RETRIEVAL_CHUNK_WORDS = 280;
export const RETRIEVAL_OVERLAP_WORDS = 60;
export const RETRIEVAL_CHUNK_MAX_BYTES = 4096;
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface RetrievalChunk {
  text: string;
  /** The page of the chunk's first word, or "pp. first–last" when it crosses pages. */
  pageLabel: string | null;
  sourceRef: string | null;
  /** First physical page; navigation opens here. */
  pageNumber: number | null;
  /** Last physical page, only when the chunk crosses a page boundary. */
  pageEnd?: number;
  /** Where each page begins in `text`, only when the chunk crosses a page boundary:
   * the range alone cannot say on which page a quoted sentence inside it lies. */
  pageStarts?: Array<{ page: number; offset: number }>;
}

/** The passage text as a model should read it: a `[p. N]` marker where each page
 * begins, so a quotation from a page-crossing passage can be given its own page.
 * The stored and embedded text never carries these markers. */
export function textWithPageStarts(text: string, pageStarts?: Array<{ page: number; offset: number }>): string {
  if (!pageStarts?.length) return text;
  let result = '', position = 0;
  for (const { page, offset } of [...pageStarts].sort((a, b) => a.offset - b.offset)) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(offset) || offset < position || offset > text.length) continue;
    result += `${text.slice(position, offset)}[p. ${page}] `;
    position = offset;
  }
  return result + text.slice(position);
}

/**
 * Fine-grained chunks for semantic retrieval. PDF page markers are retained in
 * extraction text, but stripped from the embedded passage and converted to a
 * compact citation location.
 */
export function planRetrievalChunks(
  text: string,
  opts: { chunkWords?: number; overlapWords?: number; sourceMap?: Record<string, string>; maxBytes?: number } = {}
): RetrievalChunk[] {
  const maxBytes = clampInt(opts.maxBytes, RETRIEVAL_CHUNK_MAX_BYTES, 256, RETRIEVAL_CHUNK_MAX_BYTES);
  const encoder = new TextEncoder();
  const chunkWords = clampInt(opts.chunkWords, RETRIEVAL_CHUNK_WORDS, 80, 1000);
  const overlapWords = clampInt(opts.overlapWords, RETRIEVAL_OVERLAP_WORDS, 0, Math.max(0, chunkWords - 1));
  const tokens: { value: string; continuation: boolean; pageLabel: string | null; sourceRef: string | null; pageNumber: number | null }[] = [];
  let pageLabel: string | null = null;
  let pageNumber: number | null = null;
  let sourceRef: string | null = null;
  const rawTokens = text.match(/\[\[src:[^\]\s]+(?:\s+p\.\s*\d+)?\]\]|\[\[p\.\s*\d+\]\]|\S+/gi) ?? [];
  for (const raw of rawTokens) {
    const sourceMarker = raw.match(/^\[\[src:([^\]\s]+)(?:\s+p\.\s*(\d+))?\]\]$/i);
    if (sourceMarker) {
      sourceRef = opts.sourceMap?.[sourceMarker[1]] ?? sourceMarker[1];
      pageNumber = sourceMarker[2] ? Number(sourceMarker[2]) : null;
      pageLabel = pageNumber == null ? null : `p. ${pageNumber}`;
      continue;
    }
    const marker = raw.match(/^\[\[p\.\s*(\d+)\]\]$/i);
    if (marker) {
      pageNumber = Number(marker[1]);
      pageLabel = `p. ${pageNumber}`;
      continue;
    }
    let piece = '';
    let bytes = 0;
    let continuation = false;
    for (const point of raw) {
      const length = encoder.encode(point).length;
      if (bytes + length > maxBytes) {
        tokens.push({ value: piece, continuation, pageLabel, sourceRef, pageNumber });
        piece = ''; bytes = 0; continuation = true;
      }
      piece += point; bytes += length;
    }
    if (piece) tokens.push({ value: piece, continuation, pageLabel, sourceRef, pageNumber });
  }
  if (tokens.length === 0) return [];

  const chunks: RetrievalChunk[] = [];
  let sourceEnd = 0;
  for (let start = 0; start < tokens.length; ) {
    if (sourceEnd <= start) {
      sourceEnd = start + 1;
      while (sourceEnd < tokens.length && tokens[sourceEnd].sourceRef === tokens[start].sourceRef) sourceEnd++;
    }
    let end = start;
    let bytes = 0;
    while (end < Math.min(start + chunkWords, sourceEnd)) {
      const additional = encoder.encode(tokens[end].value).length + Number(end > start && !tokens[end].continuation);
      if (bytes + additional > maxBytes) break;
      bytes += additional; end++;
    }
    const slice = tokens.slice(start, end);
    // A chunk that crosses a page boundary cites its whole range: citing only its
    // first page attributes a quotation from the next page to the wrong one.
    const first = slice[0]?.pageNumber ?? null, last = slice.at(-1)?.pageNumber ?? null;
    const crosses = first != null && last != null && last > first;
    let text = '';
    const pageStarts: Array<{ page: number; offset: number }> = [];
    slice.forEach((token, index) => {
      if (index && !token.continuation) text += ' ';
      if (crosses && token.pageNumber != null && token.pageNumber !== pageStarts.at(-1)?.page) pageStarts.push({ page: token.pageNumber, offset: text.length });
      text += token.value;
    });
    chunks.push({
      text,
      pageLabel: crosses ? `pp. ${first}–${last}` : slice[0]?.pageLabel ?? null,
      sourceRef: slice[0]?.sourceRef ?? null,
      pageNumber: first,
      ...(crosses ? { pageEnd: last, pageStarts } : {}),
    });
    if (end >= sourceEnd) start = sourceEnd;
    else start = Math.max(start + 1, end - overlapWords);
  }
  return chunks;
}
