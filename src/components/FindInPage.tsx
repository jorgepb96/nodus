import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { t, tx } from '../i18n';

// Document find (Cmd/Ctrl+F). The default mode searches one rendered DOM tree.
// Paginated readers can instead provide text segments plus a segment activator;
// this lets PDF pages and EPUB chapters be indexed without rendering the whole
// publication or blocking the foreground renderer.

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

export interface FindTextSegment {
  id: string;
  text: string;
  label?: string;
}

interface FindInPageProps {
  targetRef: React.RefObject<HTMLElement | null>;
  segments?: FindTextSegment[];
  loadSegments?: () => Promise<FindTextSegment[]>;
  activeSegmentId?: string;
  onActivateSegment?: (id: string) => void | Promise<void>;
  sourceRevision?: string | number;
  ready?: boolean;
  unavailableMessage?: string;
  emptyTextMessage?: string;
  placement?: 'viewport' | 'reader' | 'surface';
}

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

interface SearchMatch {
  segmentId: string | null;
  localIndex: number;
}

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

const HIGHLIGHT_ALL = 'nodus-find';
const HIGHLIGHT_CURRENT = 'nodus-find-current';
const MAX_MATCHES = 2_000;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function highlightApi(): { registry: HighlightRegistry; Ctor: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (css?.highlights && typeof Ctor === 'function') return { registry: css.highlights, Ctor };
  return null;
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function characterBefore(value: string, index: number): string {
  if (index <= 0) return '';
  const last = value.charCodeAt(index - 1);
  return last >= 0xdc00 && last <= 0xdfff && index > 1 ? value.slice(index - 2, index) : value[index - 1];
}

function characterAfter(value: string, index: number): string {
  if (index >= value.length) return '';
  const point = value.codePointAt(index);
  return point == null ? '' : String.fromCodePoint(point);
}

function findOffsets(text: string, rawQuery: string, options: SearchOptions, limit = MAX_MATCHES): Array<{ start: number; end: number }> {
  const query = rawQuery.trim();
  if (!query || !text || limit <= 0) return [];
  const expression = new RegExp(escapeExpression(query), options.caseSensitive ? 'gu' : 'giu');
  const offsets: Array<{ start: number; end: number }> = [];
  let match = expression.exec(text);
  while (match && offsets.length < limit) {
    const start = match.index;
    const end = start + match[0].length;
    const whole = !options.wholeWord
      || (!WORD_CHARACTER.test(characterBefore(text, start)) && !WORD_CHARACTER.test(characterAfter(text, end)));
    if (whole) offsets.push({ start, end });
    if (match[0].length === 0) expression.lastIndex += 1;
    match = expression.exec(text);
  }
  return offsets;
}

function textNodeIndex(root: HTMLElement): { text: string; nodes: TextNodeEntry[] } {
  const nodes: TextNodeEntry[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.parentElement?.closest('[data-reader-ignore], [hidden], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? '';
    const start = text.length;
    text += value;
    nodes.push({ node: node as Text, start, end: text.length });
    node = walker.nextNode();
  }
  return { text, nodes };
}

function rangesFor(root: HTMLElement, query: string, options: SearchOptions): Range[] {
  const index = textNodeIndex(root);
  const offsets = findOffsets(index.text, query, options);
  if (!offsets.length || !index.nodes.length) return [];
  let startNodeIndex = 0;
  let endNodeIndex = 0;
  return offsets.flatMap(({ start, end }) => {
    while (startNodeIndex < index.nodes.length - 1 && start > index.nodes[startNodeIndex].end) startNodeIndex += 1;
    endNodeIndex = Math.max(endNodeIndex, startNodeIndex);
    while (endNodeIndex < index.nodes.length - 1 && end > index.nodes[endNodeIndex].end) endNodeIndex += 1;
    const startEntry = index.nodes[startNodeIndex];
    const endEntry = index.nodes[endNodeIndex];
    if (!startEntry || !endEntry || start < startEntry.start || end > endEntry.end) return [];
    const range = document.createRange();
    range.setStart(startEntry.node, Math.max(0, start - startEntry.start));
    range.setEnd(endEntry.node, Math.max(0, end - endEntry.start));
    return [range];
  });
}

export function FindInPage({
  targetRef,
  segments,
  loadSegments,
  activeSegmentId,
  onActivateSegment,
  sourceRevision,
  ready = true,
  unavailableMessage,
  emptyTextMessage,
  placement = 'viewport',
}: FindInPageProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [index, setIndex] = useState(-1);
  const [markAll, setMarkAll] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emptySource, setEmptySource] = useState(false);
  const [domRevision, setDomRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const api = useRef(highlightApi());
  const segmented = segments !== undefined || loadSegments !== undefined;

  // Source panels can finish loading or change tabs while the find bar is open.
  useEffect(() => {
    const root = targetRef.current;
    if (!open || segmented || !root) return;
    const observer = new MutationObserver(() => setDomRevision((value) => value + 1));
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  }, [open, segmented, targetRef]);

  const clearHighlights = useCallback(() => {
    api.current?.registry.delete(HIGHLIGHT_ALL);
    api.current?.registry.delete(HIGHLIGHT_CURRENT);
  }, []);

  const close = useCallback(() => {
    requestRef.current += 1;
    setOpen(false);
    setQuery('');
    setMatches([]);
    setIndex(-1);
    setBusy(false);
    setEmptySource(false);
    clearHighlights();
  }, [clearHighlights]);

  const move = useCallback((delta: number) => {
    setIndex((current) => matches.length ? ((Math.max(0, current) + delta) % matches.length + matches.length) % matches.length : -1);
  }, [matches.length]);

  // Debounced indexing keeps long Markdown documents responsive. PDF extraction
  // is lazy and cached by its viewer, so it only runs when the user searches.
  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    clearHighlights();
    const needle = query.trim();
    if (!needle) {
      setMatches([]); setIndex(-1); setBusy(false); setEmptySource(Boolean(unavailableMessage));
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setBusy(Boolean(loadSegments));
        const options = { caseSensitive, wholeWord };
        try {
          if (unavailableMessage) {
            if (request === requestRef.current) { setMatches([]); setIndex(-1); setEmptySource(true); }
            return;
          }
          if (segmented) {
            const source = loadSegments ? await loadSegments() : segments ?? [];
            if (request !== requestRef.current) return;
            const next: SearchMatch[] = [];
            let searchableCharacters = 0;
            for (const segment of source) {
              searchableCharacters += segment.text.trim().length;
              const offsets = findOffsets(segment.text, needle, options, MAX_MATCHES - next.length);
              offsets.forEach((_offset, localIndex) => next.push({ segmentId: segment.id, localIndex }));
              if (next.length >= MAX_MATCHES) break;
            }
            setEmptySource(searchableCharacters === 0);
            setMatches(next);
            setIndex(next.length ? 0 : -1);
          } else {
            const root = targetRef.current;
            const ranges = root ? rangesFor(root, needle, options) : [];
            if (request !== requestRef.current) return;
            setEmptySource(!root?.textContent?.trim());
            setMatches(ranges.map((_range, localIndex) => ({ segmentId: null, localIndex })));
            setIndex(ranges.length ? 0 : -1);
          }
        } catch {
          if (request === requestRef.current) {
            setMatches([]);
            setIndex(-1);
            setEmptySource(true);
          }
        } finally {
          if (request === requestRef.current) setBusy(false);
        }
      })();
    }, 90);
    return () => window.clearTimeout(handle);
  }, [caseSensitive, clearHighlights, domRevision, loadSegments, open, query, segmented, segments, targetRef, unavailableMessage, wholeWord]);

  // Paint only the currently rendered page/chapter. The full result count comes
  // from the segment index; activating a result renders its segment and this
  // effect then rebuilds live DOM ranges for both the current and all-visible hits.
  useEffect(() => {
    clearHighlights();
    if (!open || !ready || index < 0 || !matches[index] || !query.trim()) return;
    const match = matches[index];
    if (match.segmentId && match.segmentId !== activeSegmentId) {
      void onActivateSegment?.(match.segmentId);
      return;
    }
    let canceled = false;
    let attempts = 0;
    let timer = 0;
    const paint = () => {
      if (canceled) return;
      const root = targetRef.current;
      const ranges = root ? rangesFor(root, query, { caseSensitive, wholeWord }) : [];
      const current = ranges[match.localIndex] ?? null;
      if (!current && attempts < 20) {
        attempts += 1;
        timer = window.setTimeout(paint, 25);
        return;
      }
      if (!current) return;
      if (api.current) {
        if (markAll && ranges.length) api.current.registry.set(HIGHLIGHT_ALL, new api.current.Ctor(...ranges));
        const highlight = new api.current.Ctor(current) as { priority?: number };
        highlight.priority = 1;
        api.current.registry.set(HIGHLIGHT_CURRENT, highlight);
      }
      current.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'auto' });
    };
    timer = window.setTimeout(paint, 0);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [activeSegmentId, caseSensitive, clearHighlights, index, markAll, matches, onActivateSegment, open, query, ready, sourceRevision, targetRef, wholeWord]);

  // Cmd/Ctrl+F opens the Nodus panel instead of Chromium's page search. Cmd/Ctrl+G
  // and F3 follow platform conventions for moving through matches.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const root = targetRef.current;
      if (!root || root.closest('[hidden]')) return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
        .filter((dialog) => dialog.getClientRects().length > 0);
      const topDialog = dialogs[dialogs.length - 1];
      if (topDialog && !topDialog.contains(root)) {
        if (open) close();
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(true);
        requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
      } else if (open && ((command && !event.altKey && event.key.toLowerCase() === 'g') || event.key === 'F3')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(event.shiftKey ? -1 : 1);
      } else if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, move, open, targetRef]);

  useEffect(() => clearHighlights, [clearHighlights]);

  if (!open) return null;
  const resultText = busy
    ? t('Preparando el índice de búsqueda…')
    : unavailableMessage || emptySource
      ? (unavailableMessage ?? emptyTextMessage ?? t('Este archivo no contiene una capa de texto que Nodus pueda buscar.'))
      : matches.length
        ? tx('Coincidencia {current} de {total}', { current: index + 1, total: matches.length })
        : query.trim() ? t('No se encontró ese texto') : '';

  const position = placement === 'viewport'
    ? 'fixed right-4 top-16'
    : placement === 'surface'
      ? 'absolute right-3 top-3'
      : 'absolute right-3 top-16';

  return (
    <div data-testid="find-in-page" data-find-placement={placement} className={`find-in-page-panel z-[90] w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-neutral-300 bg-white/95 p-2 shadow-2xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 ${position}`} role="search" aria-label={t('Buscar dentro del documento')}>
      <div className="flex items-center gap-1.5">
        <Icon name="search" size={14} className="ml-1 shrink-0 text-neutral-500" />
        <input
          ref={inputRef}
          data-testid="find-in-page-input"
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-500 dark:text-neutral-100"
          value={query}
          placeholder={t('Buscar dentro del documento…')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <button className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800" onClick={() => move(-1)} disabled={!matches.length} aria-label={t('Ir a la coincidencia anterior')} title={t('Ir a la coincidencia anterior')}><Icon name="chevronUp" size={14} /></button>
        <button className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800" onClick={() => move(1)} disabled={!matches.length} aria-label={t('Ir a la coincidencia siguiente')} title={t('Ir a la coincidencia siguiente')}><Icon name="chevronDown" size={14} /></button>
        <button className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={close} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 px-1 pt-2 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
        <label className={`flex items-center gap-1.5 ${unavailableMessage ? 'cursor-default opacity-50' : 'cursor-pointer'}`}><input data-testid="find-option-mark-all" className="accent-indigo-600" type="checkbox" checked={markAll} disabled={Boolean(unavailableMessage)} onChange={(event) => setMarkAll(event.target.checked)} />{t('Marcar coincidencias')}</label>
        <label className={`flex items-center gap-1.5 ${unavailableMessage ? 'cursor-default opacity-50' : 'cursor-pointer'}`}><input data-testid="find-option-case" className="accent-indigo-600" type="checkbox" checked={caseSensitive} disabled={Boolean(unavailableMessage)} onChange={(event) => setCaseSensitive(event.target.checked)} />{t('Diferenciar mayúsculas')}</label>
        <label className={`flex items-center gap-1.5 ${unavailableMessage ? 'cursor-default opacity-50' : 'cursor-pointer'}`}><input data-testid="find-option-whole" className="accent-indigo-600" type="checkbox" checked={wholeWord} disabled={Boolean(unavailableMessage)} onChange={(event) => setWholeWord(event.target.checked)} />{t('Términos exactos')}</label>
        <span data-testid="find-in-page-status" className={`ml-auto min-w-0 text-right tabular-nums ${unavailableMessage || emptySource ? 'text-amber-600 dark:text-amber-300' : ''}`} aria-live="polite">{resultText}</span>
      </div>
    </div>
  );
}
