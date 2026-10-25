// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The visible text of a rendered reader as one string, with the text node behind every
 * offset, so offsets found in the string become DOM Ranges for the CSS Custom Highlight API
 * (find in page, the read-along highlight). Nothing here mutates the DOM.
 */

export interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

export type HighlightConstructor = new (...ranges: Range[]) => { priority?: number };

export function highlightApi(): { registry: HighlightRegistry; Ctor: HighlightConstructor } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight;
  if (css?.highlights && typeof Ctor === 'function') return { registry: css.highlights, Ctor };
  return null;
}

export interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

export interface TextIndex {
  text: string;
  nodes: TextNodeEntry[];
}

/** Text a reader never reads as content: reader chrome, hidden and decorative nodes. */
export const READER_IGNORE = '[data-reader-ignore], [hidden], [aria-hidden="true"]';

const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dt, dd, figcaption, caption, div, section, article, header, footer';

export interface TextIndexOptions {
  /** Selector of subtrees to leave out; defaults to `READER_IGNORE`. */
  ignore?: string;
  /** Put a line break between text of different blocks, so a heading's last word never joins
   *  the next paragraph's first (React rarely leaves whitespace between blocks). */
  blockBreaks?: boolean;
}

export function textNodeIndex(root: HTMLElement, options: TextIndexOptions = {}): TextIndex {
  const ignore = options.ignore ?? READER_IGNORE;
  const nodes: TextNodeEntry[] = [];
  let text = '';
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.parentElement?.closest(ignore)) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    if (options.blockBreaks) {
      const block = node.parentElement?.closest(BLOCK) ?? null;
      if (lastBlock && block !== lastBlock && text && !/\s$/.test(text)) text += '\n';
      lastBlock = block;
    }
    const value = node.nodeValue ?? '';
    const start = text.length;
    text += value;
    nodes.push({ node: node as Text, start, end: text.length });
    node = walker.nextNode();
  }
  return { text, nodes };
}

/** Entry holding offset `at` (the one ending there when `at` is a boundary and `preferEnd`). */
function entryAt(nodes: readonly TextNodeEntry[], at: number, preferEnd: boolean): number {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = nodes[mid];
    if (preferEnd ? at <= entry.start : at < entry.start) hi = mid - 1;
    else if (preferEnd ? at > entry.end : at >= entry.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** A Range over `[start, end)` of the index's text, or null when it falls outside every node
 *  (inside a block break) or the nodes left the document. */
export function rangeForOffsets(index: TextIndex, start: number, end: number): Range | null {
  const first = entryAt(index.nodes, start, false);
  const last = entryAt(index.nodes, end, true);
  if (first < 0 || last < 0) return null;
  const startEntry = index.nodes[first];
  const endEntry = index.nodes[last];
  if (!startEntry.node.isConnected || !endEntry.node.isConnected) return null;
  const range = document.createRange();
  range.setStart(startEntry.node, Math.max(0, Math.min(start - startEntry.start, startEntry.node.length)));
  range.setEnd(endEntry.node, Math.max(0, Math.min(end - endEntry.start, endEntry.node.length)));
  return range;
}

/** Offset in the index's text of a DOM point (from `caretRangeFromPoint`), or null. */
export function offsetOfPoint(index: TextIndex, node: Node, offset: number): number | null {
  for (const entry of index.nodes) {
    if (entry.node === node) return entry.start + Math.min(offset, entry.end - entry.start);
  }
  return null;
}
