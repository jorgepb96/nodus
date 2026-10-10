import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type {
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from "@shared/types";
import { t } from "../i18n";
import {
  pointerAnchor,
  selectionRibbonPosition,
  viewportRibbonBounds,
  type RibbonAnchor,
} from "../selectionRibbonPosition";
import { confirm } from "./feedback";
import { Icon } from "./ui";
import "./readerSelectionActions.css";

/** Rough size of the ribbon, for the first paint before it can be measured. */
const SELECTION_RIBBON = { width: 350, height: 41 };

interface ReaderMark {
  start: number;
  end: number;
  text: string;
}

interface ReaderAnchor {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
}

interface ActiveSelection extends ReaderAnchor {
  left: number;
  top: number;
  band: RibbonAnchor;
}

interface FloatingAction<T = undefined> {
  value: T;
  left: number;
  top: number;
  band?: RibbonAnchor;
}

interface MarginPosition {
  id: string;
  kind: "bookmark" | "comment";
  left: number;
  top: number;
}

type CommentEditor = {
  annotation: WritingDraftAnnotation | null;
  anchor: ReaderAnchor;
  body: string;
  left: number;
  top: number;
};

export interface ReaderSelectionActionsHandle {
  goToMark: () => boolean;
  goToAnnotation: (id: string) => boolean;
}

type AnnotationCreate = Omit<WritingDraftAnnotationInput, "draftId" | "scope">;

export const READER_ANNOTATION_COLORS: ReadonlyArray<{
  id: WritingDraftAnnotationColor;
  hex: string;
}> = [
  { id: "yellow", hex: "#fde68a" },
  { id: "rose", hex: "#fecdd3" },
  { id: "blue", hex: "#bfdbfe" },
  { id: "mint", hex: "#bbf7d0" },
  { id: "lavender", hex: "#ddd6fe" },
  { id: "peach", hex: "#fed7aa" },
];

const HIGHLIGHT_NAMES: Record<WritingDraftAnnotationColor, string> = {
  yellow: "nodus-reader-yellow",
  rose: "nodus-reader-rose",
  blue: "nodus-reader-blue",
  mint: "nodus-reader-mint",
  lavender: "nodus-reader-lavender",
  peach: "nodus-reader-peach",
};
const COMMENT_HIGHLIGHT_NAME = "nodus-reader-comment";
const ALL_HIGHLIGHT_NAMES = [
  ...Object.values(HIGHLIGHT_NAMES),
  COMMENT_HIGHLIGHT_NAME,
];
const READER_HIGHLIGHTS_BY_CONTEXT = new Map<string, Map<string, Range[]>>();

interface HighlightRegistry {
  delete(name: string): boolean;
  set(name: string, value: unknown): unknown;
}

function repaintReaderHighlights(
  registry: HighlightRegistry,
  HighlightConstructor: new (...ranges: Range[]) => unknown,
): void {
  for (const name of ALL_HIGHLIGHT_NAMES) {
    registry.delete(name);
    const ranges = Array.from(READER_HIGHLIGHTS_BY_CONTEXT.values())
      .flatMap((context) => context.get(name) ?? [])
      .filter(
        (range) =>
          range.startContainer.isConnected && range.endContainer.isConnected,
      );
    if (ranges.length) registry.set(name, new HighlightConstructor(...ranges));
  }
}

function storageKey(contextId: string): string {
  return `nodus.readerMark.${contextId}`;
}

function loadMark(contextId: string): ReaderMark | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(contextId)) || "null",
    ) as Partial<ReaderMark> | null;
    if (
      !value ||
      !Number.isInteger(value.start) ||
      !Number.isInteger(value.end) ||
      typeof value.text !== "string"
    )
      return null;
    if ((value.end as number) <= (value.start as number)) return null;
    return {
      start: value.start as number,
      end: value.end as number,
      text: value.text,
    };
  } catch {
    return null;
  }
}

function sourceRangeText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[data-reader-ignore]').forEach(node => node.remove());
  return fragment.textContent ?? '';
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if ((current as Text).data.length > 0 && !(current.parentElement?.closest('[data-reader-ignore]'))) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

interface ReaderTextIndex {
  content: string;
  nodes: Text[];
  starts: number[];
  offsets: WeakMap<Text, number>;
}

const READER_TEXT_INDICES = new WeakMap<HTMLElement, ReaderTextIndex>();

function readerTextIndex(root: HTMLElement): ReaderTextIndex {
  const cached = READER_TEXT_INDICES.get(root);
  if (cached) return cached;
  const nodes = textNodes(root);
  const starts: number[] = [];
  const offsets = new WeakMap<Text, number>();
  let offset = 0;
  for (const node of nodes) {
    starts.push(offset);
    offsets.set(node, offset);
    offset += node.data.length;
  }
  const index = {
    content: nodes.map((node) => node.data).join(""),
    nodes,
    starts,
    offsets,
  };
  READER_TEXT_INDICES.set(root, index);
  return index;
}

function nodeIndexAtOffset(index: ReaderTextIndex, value: number): number {
  let low = 0;
  let high = index.starts.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (index.starts[middle] <= value) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function rangeFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const index = readerTextIndex(root);
  if (
    !index.nodes.length ||
    start < 0 ||
    end <= start ||
    end > index.content.length
  )
    return null;
  const startIndex = nodeIndexAtOffset(index, start);
  const endIndex = nodeIndexAtOffset(index, Math.max(start, end - 1));
  const startNode = index.nodes[startIndex];
  const endNode = index.nodes[endIndex];
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(
    startNode,
    Math.min(startNode.data.length, start - index.starts[startIndex]),
  );
  range.setEnd(
    endNode,
    Math.min(endNode.data.length, end - index.starts[endIndex]),
  );
  return range;
}

function findAnchoredText(
  root: HTMLElement,
  anchor: ReaderAnchor,
): Range | null {
  const content = readerTextIndex(root).content;
  let bestIndex = -1;
  let bestScore = -1;
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(anchor.selectedText, from);
    if (index < 0) break;
    let score = 0;
    if (
      anchor.prefix &&
      content.slice(Math.max(0, index - anchor.prefix.length), index) ===
        anchor.prefix
    )
      score += 2;
    const after = index + anchor.selectedText.length;
    if (
      anchor.suffix &&
      content.slice(after, after + anchor.suffix.length) === anchor.suffix
    )
      score += 2;
    score -= Math.min(
      1,
      Math.abs(index - anchor.startOffset) / Math.max(1, content.length),
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
    from = index + Math.max(1, anchor.selectedText.length);
  }
  return bestIndex >= 0
    ? rangeFromOffsets(root, bestIndex, bestIndex + anchor.selectedText.length)
    : null;
}

/** The anchor of a stored annotation, so its range can be acted on like a selection. */
function annotationAnchor(annotation: WritingDraftAnnotation): ReaderAnchor {
  return {
    startOffset: annotation.startOffset,
    endOffset: annotation.endOffset,
    selectedText: annotation.selectedText,
    prefix: annotation.prefix,
    suffix: annotation.suffix,
  };
}

function annotationRange(
  root: HTMLElement,
  annotation: WritingDraftAnnotation,
): Range | null {
  const direct = rangeFromOffsets(
    root,
    annotation.startOffset,
    annotation.endOffset,
  );
  if (direct?.toString() === annotation.selectedText) return direct;
  return findAnchoredText(root, annotation);
}

function markRange(root: HTMLElement, mark: ReaderMark): Range | null {
  const direct = rangeFromOffsets(root, mark.start, mark.end);
  if (direct?.toString() === mark.text) return direct;
  const index = readerTextIndex(root).content.indexOf(mark.text);
  return index >= 0
    ? rangeFromOffsets(root, index, index + mark.text.length)
    : null;
}

function selectionInside(
  root: HTMLElement,
): { range: Range; text: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const text = sourceRangeText(range);
  return text.trim() ? { range, text } : null;
}

function selectionOffsets(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } {
  const index = readerTextIndex(root);
  if (
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.endContainer.nodeType === Node.TEXT_NODE
  ) {
    const startBase = index.offsets.get(range.startContainer as Text);
    const endBase = index.offsets.get(range.endContainer as Text);
    if (startBase !== undefined && endBase !== undefined) {
      return {
        start: startBase + range.startOffset,
        end: endBase + range.endOffset,
      };
    }
  }
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return {
    start: sourceRangeText(beforeStart).length,
    end: sourceRangeText(beforeEnd).length,
  };
}

function anchorFromRange(
  root: HTMLElement,
  range: Range,
  selectedText: string,
): ReaderAnchor {
  const { start, end } = selectionOffsets(root, range);
  const content = readerTextIndex(root).content;
  return {
    startOffset: start,
    endOffset: end,
    selectedText,
    prefix: content.slice(Math.max(0, start - 64), start),
    suffix: content.slice(end, end + 64),
  };
}

function wordAtPoint(event: MouseEvent, root: HTMLElement): Range | null {
  const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (
    !caret ||
    !root.contains(caret.startContainer) ||
    caret.startContainer.nodeType !== Node.TEXT_NODE
  )
    return null;
  const node = caret.startContainer as Text;
  let start = caret.startOffset;
  let end = caret.startOffset;
  while (start > 0 && !/\s/.test(node.data[start - 1])) start -= 1;
  while (end < node.data.length && !/\s/.test(node.data[end])) end += 1;
  if (start === end) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

/**
 * The moving end of a selection made without a pointer. With the keyboard the
 * caret is where the reader is working, so the ribbon follows it instead of
 * sitting over the first line of the selection.
 */
function focusAnchor(range: Range): RibbonAnchor {
  const selection = window.getSelection();
  const backwards =
    !!selection?.focusNode &&
    selection.focusNode === range.startContainer &&
    selection.focusOffset === range.startOffset;
  const rects = Array.from(range.getClientRects()).filter(
    (item) => item.width > 0 || item.height > 0,
  );
  const rect = rects.length
    ? backwards
      ? rects[0]
      : rects[rects.length - 1]
    : range.getBoundingClientRect();
  return {
    x: backwards ? rect.left : rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}

function rectAtPoint(range: Range, x: number, y: number): DOMRect | null {
  for (const rect of Array.from(range.getClientRects())) {
    if (
      x >= rect.left - 3 &&
      x <= rect.right + 3 &&
      y >= rect.top - 3 &&
      y <= rect.bottom + 3
    )
      return rect;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fixed highlighter in the Deep Research top bar. A chosen colour stays active. */
export function ReaderHighlighterControl({
  value,
  onChange,
}: {
  value: WritingDraftAnnotationColor | null;
  onChange: (value: WritingDraftAnnotationColor | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = READER_ANNOTATION_COLORS.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);

  return (
    <div ref={ref} className="reader-highlighter-control">
      <button
        type="button"
        className={`btn btn-ghost h-9 min-h-9 gap-1.5 border ${value ? "border-indigo-600/70 text-indigo-200" : "border-neutral-700"}`}
        aria-label={t("Subrayar")}
        aria-pressed={!!value}
        data-testid="deep-research-fixed-highlighter"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="highlighter" size={16} />
        {active && (
          <span
            className="reader-active-color"
            style={{ backgroundColor: active.hex }}
          />
        )}
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div
          className="reader-highlighter-palette"
          role="menu"
          aria-label={t("Color")}
        >
          {READER_ANNOTATION_COLORS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={value === item.id ? "is-active" : ""}
              aria-label={`${t("Subrayar")} ${index + 1}`}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <span style={{ backgroundColor: item.hex }} />
            </button>
          ))}
          <button
            type="button"
            className="reader-highlighter-off"
            aria-label={t("Seleccionar o desplazar")}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <Icon name="cursor" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Selection actions, persistent annotations and marginal reader markers. */
export const ReaderSelectionActions = forwardRef<
  ReaderSelectionActionsHandle,
  {
    targetRef: RefObject<HTMLElement | null>;
    scrollRef?: RefObject<HTMLElement | null>;
    contextId: string;
    annotations?: WritingDraftAnnotation[];
    highlighterColor?: WritingDraftAnnotationColor | null;
    onCreateAnnotation?: (input: AnnotationCreate) => Promise<void>;
    onUpdateComment?: (id: string, comment: string) => Promise<void>;
    onDeleteAnnotation?: (id: string) => Promise<void>;
    onAnnotationError?: (message: string) => void;
    onMarkChange?: (hasMark: boolean) => void;
  }
>(function ReaderSelectionActions(
  {
    targetRef,
    scrollRef,
    contextId,
    annotations = [],
    highlighterColor = null,
    onCreateAnnotation,
    onUpdateComment,
    onDeleteAnnotation,
    onAnnotationError,
    onMarkChange,
  },
  ref,
) {
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [activeMarkActions, setActiveMarkActions] =
    useState<FloatingAction | null>(null);
  const [activeHighlightActions, setActiveHighlightActions] =
    useState<FloatingAction<WritingDraftAnnotation> | null>(null);
  const [commentEditor, setCommentEditor] = useState<CommentEditor | null>(
    null,
  );
  const [savingComment, setSavingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [localMark, setLocalMark] = useState<ReaderMark | null>(() =>
    loadMark(contextId),
  );
  const [marginPositions, setMarginPositions] = useState<MarginPosition[]>([]);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const [contentRevision, setContentRevision] = useState(0);
  const migratedBookmark = useRef<string | null>(null);
  const usesSyncedBookmark = !!onCreateAnnotation && !!onDeleteAnnotation;
  const bookmarkAnnotation =
    annotations.find((item) => item.kind === "bookmark") ?? null;
  const mark = usesSyncedBookmark
    ? bookmarkAnnotation && {
        start: bookmarkAnnotation.startOffset,
        end: bookmarkAnnotation.endOffset,
        text: bookmarkAnnotation.selectedText,
      }
    : localMark;
  const hasMark = !!mark;
  const markLabel = t(
    mark ? "Mover marcador aquí" : "Añadir marcador de lectura",
  );

  useEffect(() => {
    const next = usesSyncedBookmark ? null : loadMark(contextId);
    const root = targetRef.current;
    if (root) READER_TEXT_INDICES.delete(root);
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    setCommentEditor(null);
    setLocalMark(next);
  }, [contextId, usesSyncedBookmark]);

  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      READER_TEXT_INDICES.delete(root);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setContentRevision((revision) => revision + 1),
      );
    });
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      READER_TEXT_INDICES.delete(root);
    };
  }, [contextId, targetRef]);

  useEffect(() => {
    onMarkChange?.(hasMark);
  }, [hasMark, onMarkChange]);

  // Bookmarks created by the first reader implementation lived in localStorage.
  // Move one into the syncable row the first time this saved report opens, so the
  // server-backed feature does not make an existing place silently disappear.
  useEffect(() => {
    if (!usesSyncedBookmark || bookmarkAnnotation || !onCreateAnnotation)
      return;
    if (migratedBookmark.current === contextId) return;
    const legacy = loadMark(contextId);
    if (!legacy) return;
    migratedBookmark.current = contextId;
    const content = targetRef.current ? readerTextIndex(targetRef.current).content : "";
    void onCreateAnnotation({
      kind: "bookmark",
      color: null,
      startOffset: legacy.start,
      endOffset: legacy.end,
      selectedText: legacy.text,
      prefix: content.slice(Math.max(0, legacy.start - 64), legacy.start),
      suffix: content.slice(legacy.end, legacy.end + 64),
    })
      .then(() => {
        localStorage.removeItem(storageKey(contextId));
      })
      .catch((error) => {
        migratedBookmark.current = null;
        onAnnotationError?.(errorMessage(error));
      });
  }, [
    bookmarkAnnotation,
    contextId,
    onAnnotationError,
    onCreateAnnotation,
    targetRef,
    usesSyncedBookmark,
  ]);

  useEffect(() => {
    if (
      activeHighlightActions &&
      !annotations.some((item) => item.id === activeHighlightActions.value.id)
    ) {
      setActiveHighlightActions(null);
    }
    if (
      commentEditor?.annotation &&
      !annotations.some((item) => item.id === commentEditor.annotation?.id)
    ) {
      setCommentEditor(null);
    }
  }, [activeHighlightActions, annotations, commentEditor]);

  const captureSelection = useCallback(
    (
      event?: MouseEvent,
      pointer?: { x: number; y: number },
    ): ActiveSelection | null => {
      const root = targetRef.current;
      if (!root) return null;
      let selected = selectionInside(root);
      if (!selected && event) {
        const range = wordAtPoint(event, root);
        if (range) selected = { range, text: sourceRangeText(range) };
      }
      if (!selected) return null;
      const anchor = anchorFromRange(root, selected.range, selected.text);
      // The pointer wins over the selection box: a selection dragged over several
      // lines ends where the pointer is, and that is where the reader is looking.
      const band = pointer
        ? pointerAnchor(pointer.x, pointer.y)
        : focusAnchor(selected.range);
      return {
        ...anchor,
        band,
        ...selectionRibbonPosition(
          band,
          SELECTION_RIBBON,
          viewportRibbonBounds(),
        ),
      };
    },
    [targetRef],
  );

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setActive(null);
  }, []);

  const createHighlight = useCallback(
    (selection: ReaderAnchor, color: WritingDraftAnnotationColor) => {
      if (!onCreateAnnotation) return;
      const duplicate = annotations.some(
        (item) =>
          item.kind === "highlight" &&
          item.color === color &&
          item.startOffset === selection.startOffset &&
          item.endOffset === selection.endOffset &&
          item.selectedText === selection.selectedText,
      );
      clearSelection();
      if (duplicate) return;
      void onCreateAnnotation({ ...selection, kind: "highlight", color }).catch(
        (error) => {
          onAnnotationError?.(errorMessage(error));
        },
      );
    },
    [annotations, clearSelection, onAnnotationError, onCreateAnnotation],
  );

  const showSelection = useCallback(
    (event?: MouseEvent, pointer?: { x: number; y: number }) => {
      const selection = captureSelection(event, pointer);
      if (!selection) {
        setActive(null);
        return false;
      }
      if (highlighterColor) {
        createHighlight(selection, highlighterColor);
        return true;
      }
      setActive(selection);
      return true;
    },
    [captureSelection, createHighlight, highlighterColor],
  );

  useEffect(() => {
    const root = targetRef.current;
    if (!root || !(window as unknown as { nodusMobileConfig?: unknown }).nodusMobileConfig) return;
    root.dataset.readerManagedSelection = 'true';
    let frame = 0;
    const update = () => {
      const selected = !!selectionInside(root);
      const host = window as unknown as { nodusMobileCall?: (method: string, selected: boolean) => Promise<unknown> };
      void host.nodusMobileCall?.('readerSelectionState', selected);
      cancelAnimationFrame(frame);
      if (selected) frame = requestAnimationFrame(() => {
        // Moving iOS selection handles updates one ribbon, without saving a
        // second highlight for every intermediate selection range.
        const selection = captureSelection();
        if (selection) setActive(selection);
      });
      else setActive(null);
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('nodus-reader-selection', update);
    return () => {
      cancelAnimationFrame(frame); delete root.dataset.readerManagedSelection;
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('nodus-reader-selection', update);
      const host = window as unknown as { nodusMobileCall?: (method: string, selected: boolean) => Promise<unknown> };
      void host.nodusMobileCall?.('readerSelectionState', false);
    };
  }, [captureSelection, targetRef]);

  const updateMarginPositions = useCallback(() => {
    const root = targetRef.current;
    if (!root) {
      setMarginPositions([]);
      return;
    }
    const viewport = (scrollRef?.current ?? root).getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 36, rootRect.right + 10);
    const next: MarginPosition[] = [];
    if (mark) {
      const range = markRange(root, mark);
      const rect = range ? Array.from(range.getClientRects())[0] : null;
      if (rect && rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
        next.push({ id: "bookmark", kind: "bookmark", left, top: rect.top });
      }
    }
    for (const annotation of annotations) {
      if (annotation.kind !== "comment") continue;
      const range = annotationRange(root, annotation);
      const rect = range ? Array.from(range.getClientRects())[0] : null;
      if (rect && rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
        next.push({ id: annotation.id, kind: "comment", left, top: rect.top });
      }
    }
    next.sort((a, b) => a.top - b.top || a.kind.localeCompare(b.kind));
    for (let index = 1; index < next.length; index += 1) {
      if (next[index].top < next[index - 1].top + 27)
        next[index].top = next[index - 1].top + 27;
    }
    setMarginPositions(next);
  }, [annotations, mark, scrollRef, targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    const scroller = scrollRef?.current ?? root;
    if (!root || !scroller) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMarginPositions);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [scrollRef, targetRef, updateMarginPositions]);

  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-reader-selection-actions]")
      )
        return;
      // Header controls (notably the reader's typography buttons) are not the
      // end of a text selection. Scheduling a second selection pass from their
      // pointerup races the control's own layout update and can trap Chromium in
      // a render loop while live annotation ranges are being repositioned.
      if (
        target instanceof Element &&
        target.closest('button, a, input, textarea, select, [role="button"]')
      )
        return;
      const pointer = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => showSelection(undefined, pointer), 0);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow") || event.key === "Shift")
        showSelection();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (showSelection(event, { x: event.clientX, y: event.clientY }))
        event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      // A drag ending over an existing highlight is still a new selection. Its
      // contextual palette must win over the one-click delete action.
      if (selectionInside(root)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, input, textarea")
      )
        return;
      const matches = annotations
        .filter((item) => item.kind === "highlight")
        .map((annotation) => ({
          annotation,
          range: annotationRange(root, annotation),
        }))
        .map((item) => ({
          ...item,
          rect: item.range
            ? rectAtPoint(item.range, event.clientX, event.clientY)
            : null,
        }))
        .filter((item): item is typeof item & { rect: DOMRect } => !!item.rect)
        .sort(
          (a, b) =>
            a.annotation.endOffset -
            a.annotation.startOffset -
            (b.annotation.endOffset - b.annotation.startOffset),
        );
      const match = matches[0];
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      setActiveMarkActions(null);
      const band = {
        x: event.clientX,
        top: match.rect.top,
        bottom: match.rect.bottom,
      };
      setActiveHighlightActions({
        value: match.annotation,
        band,
        ...selectionRibbonPosition(
          band,
          SELECTION_RIBBON,
          viewportRibbonBounds(),
        ),
      });
    };
    const hide = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-reader-selection-actions]")
      )
        return;
      if (
        target instanceof Element &&
        target.closest('button, a, input, textarea, select, [role="button"]')
      )
        return;
      setActive(null);
      setActiveMarkActions(null);
      setActiveHighlightActions(null);
    };
    // A selection may begin in the text and end over the empty gutter around
    // the report. Listen on the document so that release still opens the
    // contextual ribbon even though the pointer is no longer inside `root`.
    document.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("keyup", onKeyUp);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("click", onClick);
    document.addEventListener("pointerdown", hide, true);
    return () => {
      document.removeEventListener("pointerup", onPointerUp, true);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", hide, true);
    };
  }, [annotations, clearSelection, showSelection, targetRef]);

  useEffect(() => {
    const root = targetRef.current;
    const registry = (CSS as unknown as { highlights?: HighlightRegistry })
      .highlights;
    const HighlightConstructor = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    // PDF.js replaces the complete text layer whenever its scale or page changes.
    // Rebuild the CSS Highlight ranges against those new nodes instead of leaving
    // registrations attached to the disconnected previous text layer.
    void contentRevision;
    if (!root || !registry || !HighlightConstructor) return;
    const contextHighlights = new Map<string, Range[]>();
    for (const item of READER_ANNOTATION_COLORS) {
      const ranges = annotations
        .filter(
          (annotation) =>
            annotation.kind === "highlight" && annotation.color === item.id,
        )
        .map((annotation) => annotationRange(root, annotation))
        .filter((range): range is Range => range !== null);
      contextHighlights.set(HIGHLIGHT_NAMES[item.id], ranges);
    }
    const commentRanges = annotations
      .filter((annotation) => annotation.kind === "comment")
      .map((annotation) => annotationRange(root, annotation))
      .filter((range): range is Range => range !== null);
    contextHighlights.set(COMMENT_HIGHLIGHT_NAME, commentRanges);
    READER_HIGHLIGHTS_BY_CONTEXT.set(contextId, contextHighlights);
    repaintReaderHighlights(registry, HighlightConstructor);
    return () => {
      READER_HIGHLIGHTS_BY_CONTEXT.delete(contextId);
      repaintReaderHighlights(registry, HighlightConstructor);
    };
  }, [annotations, contentRevision, contextId, targetRef]);

  // A fresh selection and a highlight the reader clicked on offer the same actions:
  // both are a passage of the document, one still loose and one already saved.
  const target: {
    anchor: ReaderAnchor;
    highlight: WritingDraftAnnotation | null;
    left: number;
    top: number;
  } | null = active
    ? { anchor: active, highlight: null, left: active.left, top: active.top }
    : activeHighlightActions
      ? {
          anchor: annotationAnchor(activeHighlightActions.value),
          highlight: activeHighlightActions.value,
          left: activeHighlightActions.left,
          top: activeHighlightActions.top,
        }
      : null;

  const closeActions = () => {
    clearSelection();
    setActiveHighlightActions(null);
  };

  const copy = async () => {
    if (!target) return;
    await navigator.clipboard.writeText(target.anchor.selectedText);
    closeActions();
  };

  const recolorHighlight = (
    annotation: WritingDraftAnnotation,
    color: WritingDraftAnnotationColor,
  ) => {
    setActiveHighlightActions(null);
    if (
      annotation.color === color ||
      !onCreateAnnotation ||
      !onDeleteAnnotation
    )
      return;
    // No call changes the colour of a stored highlight, so the new one is written
    // before the old one goes: a failure leaves the reader's mark where it was.
    void onCreateAnnotation({
      ...annotationAnchor(annotation),
      kind: "highlight",
      color,
    })
      .then(() => onDeleteAnnotation(annotation.id))
      .catch((error) => onAnnotationError?.(errorMessage(error)));
  };

  const deleteHighlight = (annotation: WritingDraftAnnotation) => {
    setActiveHighlightActions(null);
    void onDeleteAnnotation?.(annotation.id).catch((error) =>
      onAnnotationError?.(errorMessage(error)),
    );
  };

  const saveMark = () => {
    if (!target) return;
    const anchor = target.anchor;
    const next: ReaderMark = {
      start: anchor.startOffset,
      end: anchor.endOffset,
      text: anchor.selectedText,
    };
    closeActions();
    if (usesSyncedBookmark && onCreateAnnotation) {
      void onCreateAnnotation({
        ...anchor,
        kind: "bookmark",
        color: null,
      }).catch((error) => {
        onAnnotationError?.(errorMessage(error));
      });
      return;
    }
    localStorage.setItem(storageKey(contextId), JSON.stringify(next));
    setLocalMark(next);
  };

  const deleteMark = () => {
    if (usesSyncedBookmark && bookmarkAnnotation && onDeleteAnnotation) {
      const id = bookmarkAnnotation.id;
      setActiveMarkActions(null);
      void onDeleteAnnotation(id).catch((error) =>
        onAnnotationError?.(errorMessage(error)),
      );
      return;
    }
    localStorage.removeItem(storageKey(contextId));
    setLocalMark(null);
    setActiveMarkActions(null);
  };

  const goToMark = useCallback(() => {
    const root = targetRef.current;
    const scroller = scrollRef?.current ?? root;
    if (!root || !scroller || !mark) return false;
    const range = markRange(root, mark);
    if (!range) return false;
    const rect = range.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const top =
      scroller.scrollTop +
      rect.top -
      scrollRect.top -
      scroller.clientHeight / 2 +
      rect.height / 2;
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    return true;
  }, [mark, scrollRef, targetRef]);

  const goToAnnotation = useCallback(
    (id: string) => {
      const root = targetRef.current;
      const scroller = scrollRef?.current ?? root;
      const annotation = annotations.find((item) => item.id === id);
      if (!root || !scroller || !annotation) return false;
      const range = annotationRange(root, annotation);
      if (!range) return false;
      const rect = range.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      const top = scroller.scrollTop + rect.top - scrollRect.top - 24;
      setActive(null);
      setActiveMarkActions(null);
      setActiveHighlightActions(null);
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return true;
    },
    [annotations, scrollRef, targetRef],
  );

  useImperativeHandle(ref, () => ({ goToMark, goToAnnotation }), [
    goToAnnotation,
    goToMark,
  ]);

  const quoteInNodi = async () => {
    if (!target) return;
    const text = target.anchor.selectedText.replace(/\s+/g, " ").trim();
    const settings = await window.nodus.getSettings();
    if (!settings.mascotEnabled)
      await window.nodus.updateSettings({ mascotEnabled: true });
    await window.nodus.quoteNodiSelection(text);
    closeActions();
  };

  const openNewComment = () => {
    if (!target) return;
    setCommentError(null);
    setCommentEditor({
      annotation: null,
      anchor: target.anchor,
      body: "",
      left: target.left,
      top: Math.max(8, Math.min(window.innerHeight - 270, target.top)),
    });
    closeActions();
  };

  const openComment = (
    annotation: WritingDraftAnnotation,
    position: MarginPosition,
  ) => {
    setCommentError(null);
    setActive(null);
    setActiveMarkActions(null);
    setActiveHighlightActions(null);
    const width = 330;
    setCommentEditor({
      annotation,
      anchor: annotation,
      body: annotation.comment ?? "",
      left: Math.max(
        8,
        Math.min(window.innerWidth - width - 8, position.left - width - 8),
      ),
      top: Math.max(8, Math.min(window.innerHeight - 250, position.top - 8)),
    });
  };

  const saveComment = async () => {
    if (!commentEditor || !commentEditor.body.trim()) return;
    setSavingComment(true);
    setCommentError(null);
    try {
      if (commentEditor.annotation) {
        await onUpdateComment?.(
          commentEditor.annotation.id,
          commentEditor.body,
        );
      } else {
        await onCreateAnnotation?.({
          ...commentEditor.anchor,
          kind: "comment",
          color: null,
          comment: commentEditor.body,
        });
      }
      setCommentEditor(null);
    } catch (error) {
      const message = errorMessage(error);
      setCommentError(message);
      onAnnotationError?.(message);
    } finally {
      setSavingComment(false);
    }
  };

  const deleteComment = async () => {
    const annotation = commentEditor?.annotation;
    if (!annotation || !onDeleteAnnotation) return;
    const accepted = await confirm({
      title: t("Eliminar"),
      message: t("¿Eliminar esta anotación? No se puede deshacer."),
      confirmLabel: t("Eliminar"),
      danger: true,
      zIndex: 2147483000,
    });
    if (!accepted) return;
    try {
      await onDeleteAnnotation(annotation.id);
      setCommentEditor(null);
    } catch (error) {
      const message = errorMessage(error);
      setCommentError(message);
      onAnnotationError?.(message);
    }
  };

  const action = active ?? activeMarkActions ?? activeHighlightActions;

  // The estimated width above keeps the first paint from flashing in the wrong
  // place; the ribbon is only truly centred on the pointer once measured.
  useLayoutEffect(() => {
    const node = ribbonRef.current;
    if (!node || !action?.band) return;
    const rect = node.getBoundingClientRect();
    const { left, top } = selectionRibbonPosition(
      action.band,
      rect,
      viewportRibbonBounds(),
    );
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [action]);

  return (
    <>
      {marginPositions.length > 0 &&
        createPortal(
          <div data-reader-selection-actions>
            {marginPositions.map((position) => (
              <button
                key={`${position.kind}:${position.id}`}
                type="button"
                className={`reader-margin-marker reader-margin-marker-${position.kind}`}
                style={{ left: position.left, top: position.top }}
                aria-label={
                  position.kind === "bookmark"
                    ? t("Eliminar marcador de lectura")
                    : t("Comentario lateral")
                }
                onClick={() => {
                  if (position.kind === "bookmark") {
                    setActiveHighlightActions(null);
                    setActiveMarkActions({
                      value: undefined,
                      left: position.left - 4,
                      top: Math.max(8, position.top - 45),
                    });
                    return;
                  }
                  const annotation = annotations.find(
                    (item) => item.id === position.id,
                  );
                  if (annotation) openComment(annotation, position);
                }}
              >
                <Icon
                  name={position.kind === "bookmark" ? "bookmarkFill" : "chat"}
                  size={15}
                />
              </button>
            ))}
          </div>,
          document.body,
        )}

      {action &&
        createPortal(
          <div
            ref={ribbonRef}
            className="reader-selection-actions"
            data-reader-selection-actions
            role="toolbar"
            aria-label={
              target ? t("Acciones de selección") : t("Editar o eliminar")
            }
            style={{ left: action.left, top: action.top }}
            onPointerDown={(event) => event.preventDefault()}
          >
            {target ? (
              <>
                <div
                  className="reader-selection-colors"
                  aria-label={t("Color")}
                >
                  {READER_ANNOTATION_COLORS.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`reader-selection-color${target.highlight?.color === item.id ? " is-active" : ""}`}
                      onClick={() =>
                        target.highlight
                          ? recolorHighlight(target.highlight, item.id)
                          : createHighlight(target.anchor, item.id)
                      }
                      title={`${t("Subrayar")} ${index + 1}`}
                      aria-label={`${t("Subrayar")} ${index + 1}`}
                    >
                      <span style={{ backgroundColor: item.hex }} />
                    </button>
                  ))}
                </div>
                <span className="reader-selection-divider" />
                <button
                  type="button"
                  onClick={openNewComment}
                  title={t("Añadir comentario")}
                  aria-label={t("Añadir comentario")}
                >
                  <Icon name="chat" size={17} />
                </button>
                <span className="reader-selection-divider" />
                <button
                  type="button"
                  onClick={() => void copy()}
                  title={t("Copiar")}
                  aria-label={t("Copiar")}
                >
                  <Icon name="copy" size={17} />
                </button>
                <button
                  type="button"
                  onClick={saveMark}
                  title={markLabel}
                  aria-label={markLabel}
                >
                  <Icon name={mark ? "bookmarkFill" : "bookmark"} size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => void quoteInNodi()}
                  title={t("Citar en Nodi")}
                  aria-label={t("Citar en Nodi")}
                >
                  <Icon name="quote" size={17} />
                </button>
                {target.highlight && (
                  <>
                    <span className="reader-selection-divider" />
                    <button
                      type="button"
                      data-tone="danger"
                      onClick={() =>
                        target.highlight && deleteHighlight(target.highlight)
                      }
                      title={t("Eliminar")}
                      aria-label={t("Eliminar")}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <button
                type="button"
                data-tone="danger"
                onClick={deleteMark}
                title={t("Eliminar marcador de lectura")}
                aria-label={t("Eliminar marcador de lectura")}
              >
                <Icon name="trash" size={17} />
              </button>
            )}
          </div>,
          document.body,
        )}

      {commentEditor &&
        createPortal(
          <section
            className="reader-comment-editor"
            data-reader-selection-actions
            role="dialog"
            aria-label={t("Comentario lateral")}
            style={{ left: commentEditor.left, top: commentEditor.top }}
          >
            <header>
              <Icon name="chat" size={15} />
              <strong>
                {commentEditor.annotation
                  ? t("Comentario")
                  : t("Nuevo comentario lateral")}
              </strong>
              <button
                type="button"
                onClick={() => setCommentEditor(null)}
                aria-label={t("Cerrar")}
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <p className="reader-comment-quote">
              “{commentEditor.anchor.selectedText.replace(/\s+/g, " ").trim()}”
            </p>
            <textarea
              autoFocus
              className="input"
              value={commentEditor.body}
              placeholder={t("Escribe el comentario")}
              onChange={(event) =>
                setCommentEditor((current) =>
                  current ? { ...current, body: event.target.value } : current,
                )
              }
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                  void saveComment();
                if (event.key === "Escape") setCommentEditor(null);
              }}
            />
            {commentError && (
              <p className="reader-comment-error">{commentError}</p>
            )}
            <footer>
              {commentEditor.annotation && (
                <button
                  type="button"
                  className="btn btn-ghost text-red-500"
                  onClick={() => void deleteComment()}
                >
                  <Icon name="trash" size={14} /> {t("Eliminar")}
                </button>
              )}
              <span />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCommentEditor(null)}
              >
                {t("Cancelar")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingComment || !commentEditor.body.trim()}
                onClick={() => void saveComment()}
              >
                {savingComment ? t("Guardando…") : t("Guardar")}
              </button>
            </footer>
          </section>,
          document.body,
        )}
    </>
  );
});
