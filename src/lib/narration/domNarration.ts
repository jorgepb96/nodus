// SPDX-License-Identifier: AGPL-3.0-only
import { READER_IGNORE, textNodeIndex } from '../readerTextIndex';

/**
 * Narration text for a long rendered document (a library book), read from where the reader
 * is: the block holding the selection, else the first block visible in the scroller. It is
 * built from the DOM, not the source Markdown, so the read-along highlight finds every word
 * it speaks; it keeps what `markdownToSpeech` keeps (headings, paragraphs, list items) and
 * leaves out what it drops (tables, code, figures, citation buttons, formulas).
 */

const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd';
const SKIPPED = `${READER_IGNORE}, pre, table, figure, button, .katex`;
const IGNORE = `${READER_IGNORE}, button, .katex`;

/** Innermost text blocks, in document order: a list item holding paragraphs yields the paragraphs. */
function narratedBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCKS))
    .filter((block) => !block.closest(SKIPPED) && !block.querySelector(BLOCKS));
}

function startingBlock(blocks: readonly HTMLElement[], scroller: HTMLElement | null): HTMLElement | null {
  const selection = window.getSelection();
  const anchor = selection && !selection.isCollapsed ? selection.anchorNode : null;
  if (anchor) {
    const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
    const selected = blocks.find((block) => block === element || block.contains(element));
    if (selected) return selected;
  }
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  return blocks.find((block) => block.getBoundingClientRect().bottom > top + 8) ?? blocks[0] ?? null;
}

export function narrationMarkdownFromView(root: HTMLElement | null, scroller: HTMLElement | null): string {
  if (!root) return '';
  const blocks = narratedBlocks(root);
  const start = startingBlock(blocks, scroller);
  const from = start ? blocks.indexOf(start) : 0;
  const lines: string[] = [];
  for (const block of blocks.slice(Math.max(0, from))) {
    const text = textNodeIndex(block, { ignore: IGNORE }).text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const heading = /^H([1-6])$/.exec(block.tagName);
    lines.push(heading ? `${'#'.repeat(Number(heading[1]))} ${text}` : block.tagName === 'LI' ? `- ${text}` : text);
  }
  return lines.join('\n\n');
}
