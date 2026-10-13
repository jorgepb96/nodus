import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import { editorReviewDiff } from '@shared/editorAiReview';

export interface EditorReview { range: { from: number; to: number }; original: string; proposed: string; complete: boolean }
export const editorReviewKey = new PluginKey<DecorationSet>('nodus-ai-review');

/** Map visible characters to native positions, including paragraph separators. */
export function reviewTextMap(doc: Node, range: { from: number; to: number }) {
  let text = ''; const positions: number[] = []; let lastBlock = -1;
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.isTextblock) {
      if (lastBlock >= 0 && text.length) { text += '\n'; positions.push(pos + 1); }
      lastBlock = pos;
    }
    if (!node.isText) return;
    const start = Math.max(range.from, pos), end = Math.min(range.to, pos + node.nodeSize);
    for (let at = start; at < end; at++) { positions.push(at); text += node.text![at - pos]; }
  });
  positions.push(range.to);
  return { text, positions };
}

function decorations(doc: Node, review: EditorReview, mapping = reviewTextMap(doc, review.range)): DecorationSet {
  const pieces = editorReviewDiff(mapping.text, review.proposed, review.complete);
  const items: Decoration[] = []; let offset = 0;
  for (const piece of pieces) {
    if (piece.kind === 'added' && piece.value) {
      const content = piece.value;
      items.push(Decoration.widget(mapping.positions[offset] ?? review.range.to, () => {
        const span = document.createElement('ins'); span.className = 'scriptor-ai-added'; span.dataset.testid = 'scriptor-ai-added'; span.textContent = content; return span;
      }, { side: -1 }));
    } else {
      if (piece.kind === 'removed' && piece.value) {
        const from = mapping.positions[offset] ?? review.range.from;
        const to = offset + piece.value.length >= mapping.text.length ? review.range.to : mapping.positions[offset + piece.value.length];
        if (to > from) items.push(Decoration.inline(from, to, { class: 'scriptor-ai-removed', 'data-testid': 'scriptor-ai-removed' }));
      }
      offset += piece.value.length;
    }
  }
  return DecorationSet.create(doc, items);
}

export function createEditorReviewPlugin(currentReview?: () => EditorReview | null | undefined) {
  let cache: { doc: Node; from: number; to: number; mapping: ReturnType<typeof reviewTextMap> } | undefined;
  const render = (doc: Node, review: EditorReview) => {
    if (!cache || cache.doc !== doc || cache.from !== review.range.from || cache.to !== review.range.to) cache = { doc, ...review.range, mapping: reviewTextMap(doc, review.range) };
    return decorations(doc, review, cache.mapping);
  };
  return new Plugin({ key: editorReviewKey, state: {
    init: (_config, state) => { const review = currentReview?.(); return review ? render(state.doc, review) : DecorationSet.empty; },
    apply(tr, value) { const review = tr.getMeta(editorReviewKey) as EditorReview | null | undefined; if (review === null) { cache = undefined; return DecorationSet.empty; } return review ? render(tr.doc, review) : value.map(tr.mapping, tr.doc); },
  }, props: { decorations: state => editorReviewKey.getState(state) } });
}
