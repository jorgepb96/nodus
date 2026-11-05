import type {ReaderAnchor} from '../components/ReaderSelectionActions';

/** Recheck the real DOM range when WebKit presents its menu after our debounce.
 * Native selection handles remain owned by WebKit; Nodus owns the action ribbon. */
export function proseSelectionPayload(root: HTMLElement | null, selection: Selection | null,
  anchorFromRange: (root: HTMLElement, range: Range, text: string) => ReaderAnchor) {
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[data-reader-ignore]').forEach(node => node.remove());
  const text = fragment.textContent ?? '';
  if (!text.trim()) return null;
  const anchor = anchorFromRange(root, range, text);
  if (anchor.endOffset - anchor.startOffset !== text.length) return null;
  const value = range.getBoundingClientRect();
  return {anchor, rect: {x: value.x, y: value.y, width: value.width, height: value.height}};
}
