// SPDX-License-Identifier: AGPL-3.0-only
import {
  DisplayedWords, MIN_SENTENCE_MATCH, MIN_WORD_MATCH, alignSpoken, displayedSpan, granularityFor, leadS, phraseGroups,
  sentenceSpan, trackWordTimings, unitSpan, wordAt, wordSpans, wordsPerSecond,
  type Alignment, type HighlightGranularity, type TimedWord, type WordSpan,
} from '@shared/narrationSync';
import type { AppSettings } from '@shared/types';
import type { NarrationClock, PlayerTrack } from '../../components/AudioPlayer';
import { READER_IGNORE, highlightApi, offsetOfPoint, rangeForOffsets, textNodeIndex, type TextIndex } from '../readerTextIndex';

/**
 * The read-along highlight: while a narration plays, the sentence being read gets a soft tint
 * and the word (or, at high speed, the phrase) a stronger one, in whichever reader shows that
 * narration. Readers register their text root; one loop for the whole app reads the player's
 * clock every frame and repaints two CSS highlights only when the lit text changes. Nothing
 * touches the DOM, so editors keep their undo history and readers their own highlights.
 */

export const SENTENCE_HIGHLIGHT = 'nodus-tts-sentence';
export const WORD_HIGHLIGHT = 'nodus-tts-word';
/** Painted under the reader's own highlights (sentence) and over them (word). */
const SENTENCE_PRIORITY = -1;
const WORD_PRIORITY = 2;

/** Text narration never reads: reader chrome, citation buttons (dropped from speech), formulas
 *  (read out in words) and form controls. */
const NARRATION_IGNORE = `${READER_IGNORE}, button, .katex, textarea, input, select, [contenteditable="false"]`;

export interface ReadAlongTarget {
  root: HTMLElement;
  /** The element that scrolls the text; the nearest scrollable ancestor when absent. */
  scroller?: HTMLElement | null;
  /** Whether a narration (by its source key) is this reader's text. */
  matches(sourceKey: string): boolean;
  /** The narrated segment is not on screen and the view should follow it (Immersion's steps):
   *  its index and the track's label. */
  onSegment?(segmentIndex: number, label: string): void;
  /** Following stopped because the reader scrolled by hand, or started again. */
  onFollowPaused?(paused: boolean): void;
}

export interface ReadAlongHandle {
  resumeFollow(): void;
  pauseFollow(): void;
  unregister(): void;
}

interface DisplayedText { index: TextIndex; spans: Array<{ start: number; end: number }>; words: DisplayedWords }

interface TargetState {
  target: ReadAlongTarget;
  text: DisplayedText | null;
  alignments: Map<string, Alignment>;
  followPaused: boolean;
  lastKey: string;
  lastSegment: number | null;
  granularity: HighlightGranularity | undefined;
  rebuildTimer: number;
  detach: () => void;
}

interface Prefs { mode: AppSettings['narrationHighlight']; follow: boolean }

let clock: NarrationClock | null = null;
let unsubscribeClock: (() => void) | null = null;
const targets: TargetState[] = [];
let painted: TargetState | null = null;
let prefs: Prefs = { mode: 'word', follow: true };
let prefsLoaded = false;
let lastSourceKey: string | null = null;
const timings = new Map<string, TimedWord[] | null>();
const pendingTimings = new Map<string, Promise<TimedWord[] | null>>();
const phraseCache = new Map<string, { rate: number; groups: WordSpan[] }>();
let frame = 0;
let timer = 0;

function applyPrefs(settings: Partial<AppSettings> | null | undefined): void {
  if (!settings) return;
  prefs = { mode: settings.narrationHighlight ?? 'word', follow: settings.narrationFollow ?? true };
  for (const state of targets) state.lastKey = '';
  schedule();
}

function loadPrefs(): void {
  if (prefsLoaded || typeof window === 'undefined' || !window.nodus) return;
  prefsLoaded = true;
  void window.nodus.getSettings().then(applyPrefs).catch(() => {});
  window.nodus.onSettingsChanged?.(applyPrefs);
}

// ── Timings ──────────────────────────────────────────────────────────────────

function liveTimings(track: PlayerTrack): TimedWord[] | null {
  const sync = track.sync;
  if (sync?.kind !== 'live') return null;
  return trackWordTimings([{ offsetS: 0, durationS: sync.durationS, text: sync.text, pauses: sync.pauses }]);
}

/** Word timings of a track, resolving a saved clip's map over IPC once. */
function resolveTimings(track: PlayerTrack): Promise<TimedWord[] | null> {
  if (timings.has(track.id)) return Promise.resolve(timings.get(track.id) ?? null);
  const sync = track.sync;
  if (sync?.kind !== 'clip') {
    const words = liveTimings(track);
    timings.set(track.id, words);
    return Promise.resolve(words);
  }
  const pending = pendingTimings.get(track.id);
  if (pending) return pending;
  const request = window.nodus.getAudioClipSync(sync.clipId).then((map) => {
    let fragments = map?.fragments ?? [];
    // Clips saved before their fragments' text was kept: one fragment, text from the caller.
    if (sync.text && fragments.length === 1 && !fragments[0].text) fragments = [{ ...fragments[0], text: sync.text }];
    return fragments.some((fragment) => fragment.text) ? trackWordTimings(fragments) : null;
  }).catch(() => null).then((words) => {
    timings.set(track.id, words);
    pendingTimings.delete(track.id);
    schedule();
    return words;
  });
  pendingTimings.set(track.id, request);
  return request;
}

/** Synchronous view of `resolveTimings`: undefined while a clip map is on its way. */
function timingsFor(track: PlayerTrack): TimedWord[] | null | undefined {
  if (timings.has(track.id)) return timings.get(track.id);
  if (track.sync?.kind === 'clip') { void resolveTimings(track); return undefined; }
  const words = liveTimings(track);
  timings.set(track.id, words);
  return words;
}

function groupsFor(track: PlayerTrack, words: readonly TimedWord[], rate: number): WordSpan[] {
  const cached = phraseCache.get(track.id);
  if (cached && Math.abs(cached.rate - rate) < 0.01) return cached.groups;
  const groups = phraseGroups(words, rate);
  phraseCache.set(track.id, { rate, groups });
  return groups;
}

// ── Displayed text and alignment ─────────────────────────────────────────────

function displayedText(state: TargetState): DisplayedText {
  if (state.text) return state.text;
  const index = textNodeIndex(state.target.root, { ignore: NARRATION_IGNORE, blockBreaks: true });
  const spans = wordSpans(index.text);
  state.text = { index, spans, words: new DisplayedWords(spans.map((span) => span.text)) };
  return state.text;
}

/** Alignment of track `i`, continuing where the previous track's passage ended. */
function alignmentFor(state: TargetState, tracks: readonly PlayerTrack[], i: number, words: readonly TimedWord[]): Alignment {
  const track = tracks[i];
  const cached = state.alignments.get(track.id);
  if (cached) return cached;
  const previous = i > 0 ? state.alignments.get(tracks[i - 1].id) : undefined;
  const alignment = alignSpoken(words.map((word) => word.text), displayedText(state).words, previous?.next ?? 0);
  state.alignments.set(track.id, alignment);
  return alignment;
}

// ── Painting ─────────────────────────────────────────────────────────────────

function setHighlight(name: string, range: Range | null, priority: number): void {
  const api = highlightApi();
  if (!api) return;
  if (!range) { api.registry.delete(name); return; }
  const highlight = new api.Ctor(range);
  highlight.priority = priority;
  api.registry.set(name, highlight);
}

function clearPaint(): void {
  if (!painted) return;
  setHighlight(SENTENCE_HIGHLIGHT, null, SENTENCE_PRIORITY);
  setHighlight(WORD_HIGHLIGHT, null, WORD_PRIORITY);
  painted.target.root.classList.remove('read-along-jump');
  painted = null;
  for (const state of targets) state.lastKey = '';
}

function rangeOf(text: DisplayedText, span: WordSpan | null): Range | null {
  if (!span) return null;
  const first = text.spans[span.first];
  const last = text.spans[span.last];
  return first && last ? rangeForOffsets(text.index, first.start, last.end) : null;
}

function reducedMotion(): boolean {
  return document.documentElement.classList.contains('reduce-motion') || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** Keeps the lit text inside the comfortable band of the scroller (20 %–75 % of its height),
 *  bringing it back to about a third of the way down. Smooth unless motion is reduced or the
 *  narration is fast enough for smooth scrolling to lag behind it. */
function follow(state: TargetState, range: Range | null, rate: number): void {
  if (!range || !prefs.follow || state.followPaused) return;
  const scroller = state.target.scroller ?? scrollParent(state.target.root);
  if (!scroller) return;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const isPage = scroller === document.scrollingElement;
  const box = isPage ? { top: 0, height: window.innerHeight } : scroller.getBoundingClientRect();
  if (rect.top >= box.top + box.height * 0.2 && rect.bottom <= box.top + box.height * 0.75) return;
  const delta = rect.top - (box.top + box.height * 0.35);
  scroller.scrollBy({ top: delta, behavior: reducedMotion() || rate >= 1.5 ? 'auto' : 'smooth' });
}

// ── The loop ─────────────────────────────────────────────────────────────────

function activeTarget(sourceKey: string): TargetState | null {
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const state = targets[i];
    if (state.target.root.isConnected && state.target.matches(sourceKey)) return state;
  }
  return null;
}

/** One frame: returns whether playback is running (so another frame is due). */
function tick(): boolean {
  const playhead = clock?.playhead() ?? null;
  const source = clock?.source() ?? null;
  if (source?.key !== lastSourceKey) {
    lastSourceKey = source?.key ?? null;
    timings.clear();
    phraseCache.clear();
    for (const state of targets) {
      state.alignments.clear();
      state.lastSegment = null;
      if (state.followPaused) { state.followPaused = false; state.target.onFollowPaused?.(false); }
    }
  }
  const state = source ? activeTarget(source.key) : null;
  if (!clock || !playhead || !state || prefs.mode === 'off') { clearPaint(); return false; }
  if (painted && painted !== state) clearPaint();
  const tracks = clock.tracks();
  const track = tracks[playhead.index];
  const words = track ? timingsFor(track) : null;
  if (words === undefined) return playhead.playing;
  if (!words?.length) { clearPaint(); return playhead.playing; }

  const alignment = alignmentFor(state, tracks, playhead.index, words);
  const segment = track.sync?.segmentIndex ?? null;
  if (alignment.ratio < MIN_SENTENCE_MATCH) {
    clearPaint();
    // The passage is not on screen: a reader that shows one part at a time can bring it in.
    if (segment != null && state.target.onSegment && prefs.follow && !state.followPaused && state.lastSegment !== segment) {
      state.lastSegment = segment;
      state.target.onSegment(segment, track.label);
    }
    return playhead.playing;
  }
  state.lastSegment = segment;

  const at = Math.max(0, wordAt(words, playhead.time + leadS(playhead.rate)));
  const granularity: HighlightGranularity = prefs.mode === 'sentence' || alignment.ratio < MIN_WORD_MATCH
    ? 'sentence'
    : granularityFor(playhead.rate, wordsPerSecond(words), state.granularity);
  state.granularity = granularity;
  const sentence = displayedSpan(alignment, ...spanArgs(sentenceSpan(words, at)));
  const unit = granularity === 'sentence'
    ? null
    : displayedSpan(alignment, ...spanArgs(unitSpan(words, at, granularity, granularity === 'phrase' ? groupsFor(track, words, playhead.rate) : undefined)));
  const key = `${track.id}|${sentence?.first}-${sentence?.last}|${unit?.first}-${unit?.last}`;
  if (key !== state.lastKey || painted !== state) {
    const text = displayedText(state);
    const sentenceRange = rangeOf(text, sentence);
    const unitRange = rangeOf(text, unit);
    setHighlight(SENTENCE_HIGHLIGHT, sentenceRange, SENTENCE_PRIORITY);
    setHighlight(WORD_HIGHLIGHT, unitRange, WORD_PRIORITY);
    painted = state;
    state.lastKey = key;
    follow(state, unitRange ?? sentenceRange, playhead.rate);
  }
  return playhead.playing;
}

const spanArgs = (span: WordSpan): [number, number] => [span.first, span.last];

function run(): void {
  if (frame) cancelAnimationFrame(frame);
  if (timer) window.clearTimeout(timer);
  frame = 0;
  timer = 0;
  if (tick()) schedule();
}

/** Next frame, with a timer racing it: requestAnimationFrame never fires in a window that
 *  does not paint (hidden, or a test runner's), and the highlight must still advance there. */
function schedule(): void {
  if (frame || timer || !targets.length) return;
  frame = requestAnimationFrame(run);
  timer = window.setTimeout(run, 100);
}

// ── Jumping to a clicked word ────────────────────────────────────────────────

/** Track and second where the narration reads the word at a screen point; null when the
 *  point is not on narrated text, `'missing'` when that text has no audio (yet). */
async function narratedPositionAt(state: TargetState, x: number, y: number): Promise<{ track: number; seconds: number } | 'missing' | null> {
  if (!clock) return null;
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret) return null;
  const text = displayedText(state);
  const offset = offsetOfPoint(text.index, caret.startContainer, caret.startOffset);
  if (offset == null) return null;
  let target = text.spans.findIndex((span) => span.end > offset);
  if (target < 0) target = text.spans.length - 1;
  if (target < 0) return null;
  const tracks = clock.tracks();
  let best: { track: number; seconds: number; distance: number } | null = null;
  for (let i = 0; i < tracks.length; i += 1) {
    const words = await resolveTimings(tracks[i]);
    if (!words?.length) continue;
    const alignment = alignmentFor(state, tracks, i, words);
    if (alignment.ratio < MIN_SENTENCE_MATCH) continue;
    for (let w = 0; w < words.length; w += 1) {
      const shown = alignment.map[w];
      if (shown < 0) continue;
      // A word at or after the click wins over one before it at the same distance.
      const distance = shown >= target ? shown - target : target - shown + 0.5;
      if (!best || distance < best.distance) best = { track: i, seconds: words[w].start, distance };
      if (shown >= target) break;
    }
    if (best?.distance === 0) break;
  }
  if (!best || best.distance > 24) return 'missing';
  return { track: best.track, seconds: Math.max(0, best.seconds - 0.02) };
}

// ── Registration ─────────────────────────────────────────────────────────────

function onClockChange(): void { run(); }

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', ' ', 'ArrowUp', 'ArrowDown']);

export function registerReadAlong(target: ReadAlongTarget, playerClock: NarrationClock, onMissing?: () => void): ReadAlongHandle {
  loadPrefs();
  if (clock !== playerClock) {
    unsubscribeClock?.();
    clock = playerClock;
    unsubscribeClock = playerClock.subscribe(onClockChange);
  }
  const state: TargetState = {
    target, text: null, alignments: new Map(), followPaused: false, lastKey: '', lastSegment: null, granularity: undefined, rebuildTimer: 0, detach: () => {},
  };

  // Edits and re-renders invalidate the text index; rebuilding it waits for a quiet moment
  // (a streaming answer mutates on every token).
  const observer = new MutationObserver(() => {
    if (state.rebuildTimer) window.clearTimeout(state.rebuildTimer);
    state.rebuildTimer = window.setTimeout(() => {
      state.rebuildTimer = 0;
      state.text = null;
      state.alignments.clear();
      state.lastKey = '';
      schedule();
    }, 150);
  });
  observer.observe(target.root, { subtree: true, childList: true, characterData: true });

  const pauseFollow = () => {
    const key = clock?.source()?.key;
    if (!key || !target.matches(key) || state.followPaused || !prefs.follow) return;
    state.followPaused = true;
    target.onFollowPaused?.(true);
  };
  const resumeFollow = () => {
    if (!state.followPaused) return;
    state.followPaused = false;
    state.lastKey = '';
    state.lastSegment = null;
    target.onFollowPaused?.(false);
    schedule();
  };
  // Scrolling by hand (wheel, touch, scroll keys, the scrollbar) pauses following. Typing does
  // not: keys aimed at a field or an editor are its own.
  const scroller = target.scroller ?? null;
  const scrollSurface: HTMLElement = scroller ?? target.root;
  const onKey = (event: KeyboardEvent) => {
    const origin = event.target as HTMLElement | null;
    if (origin?.isContentEditable || origin?.closest?.('input, textarea, select')) return;
    if (SCROLL_KEYS.has(event.key)) pauseFollow();
  };
  const onScrollbar = (event: Event) => { if (scroller && event.target === scroller) pauseFollow(); };
  scrollSurface.addEventListener('wheel', pauseFollow, { passive: true });
  scrollSurface.addEventListener('touchmove', pauseFollow, { passive: true });
  window.addEventListener('keydown', onKey);
  scrollSurface.addEventListener('pointerdown', onScrollbar);

  // ⌥/Alt + click on a word plays from it. The modifier keeps plain clicks for selecting text
  // (and the selection ribbon), and the cursor shows when the shortcut is armed.
  const narrating = () => {
    const key = clock?.source()?.key;
    return !!key && target.matches(key) && painted === state;
  };
  const onAlt = (event: KeyboardEvent) => {
    if (event.key !== 'Alt') return;
    target.root.classList.toggle('read-along-jump', event.type === 'keydown' && narrating());
  };
  const offAlt = () => target.root.classList.remove('read-along-jump');
  const onPointer = (event: MouseEvent) => {
    if (!event.altKey || event.button !== 0 || !narrating()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event: MouseEvent) => {
    if (!event.altKey || event.button !== 0 || !narrating()) return;
    event.preventDefault();
    event.stopPropagation();
    void narratedPositionAt(state, event.clientX, event.clientY).then((position) => {
      if (position === 'missing') { onMissing?.(); return; }
      if (!position || !clock) return;
      resumeFollow();
      clock.jumpTo(position.track, position.seconds);
    });
  };
  window.addEventListener('keydown', onAlt);
  window.addEventListener('keyup', onAlt);
  window.addEventListener('blur', offAlt);
  target.root.addEventListener('mousedown', onPointer, true);
  target.root.addEventListener('click', onClick, true);

  state.detach = () => {
    observer.disconnect();
    if (state.rebuildTimer) window.clearTimeout(state.rebuildTimer);
    scrollSurface.removeEventListener('wheel', pauseFollow);
    scrollSurface.removeEventListener('touchmove', pauseFollow);
    window.removeEventListener('keydown', onKey);
    scrollSurface.removeEventListener('pointerdown', onScrollbar);
    window.removeEventListener('keydown', onAlt);
    window.removeEventListener('keyup', onAlt);
    window.removeEventListener('blur', offAlt);
    target.root.removeEventListener('mousedown', onPointer, true);
    target.root.removeEventListener('click', onClick, true);
    target.root.classList.remove('read-along-jump');
  };
  targets.push(state);
  schedule();

  return {
    resumeFollow,
    pauseFollow,
    unregister() {
      const at = targets.indexOf(state);
      if (at < 0) return;
      targets.splice(at, 1);
      state.detach();
      if (painted === state) clearPaint();
      if (!targets.length) {
        unsubscribeClock?.();
        unsubscribeClock = null;
        clock = null;
        lastSourceKey = null;
        timings.clear();
        pendingTimings.clear();
        phraseCache.clear();
      } else schedule();
    },
  };
}
