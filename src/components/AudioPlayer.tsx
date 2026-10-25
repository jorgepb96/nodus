import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clipUrl } from '../lib/narration/ttsClient';

// The single app-wide narration player. Two hidden <audio> elements alternate so the next
// fragment is already buffered when the current one ends (no gap between fragments, and
// speed changes keep the pitch). Playback survives navigation because the provider sits at
// the root; its controls live in the header's sound balloon (NarrationMiniPlayer), not in a
// bottom strip. A narration can be a playlist of saved clips or a live queue that grows as
// Ming generates fragments: `startLive` returns the handle the generator feeds.

export interface PlayerTrack {
  id: string;
  label: string;
  /** Defaults to the saved clip's `nodus-audio://clip/<id>` URL. */
  url?: string;
  durationS?: number;
  /** What the read-along highlight needs to follow this track. */
  sync?: TrackSync;
}

/** A live fragment carries its text and silences; a saved clip is resolved by id
 *  (`getAudioClipSync`), with the segment's text when the caller knows it (old clips). */
export type TrackSync =
  | { kind: 'live'; segmentIndex: number; text: string; durationS: number; pauses: Array<[number, number]> }
  | { kind: 'clip'; clipId: string; segmentIndex: number; text?: string };

export interface Playhead { trackId: string; index: number; time: number; rate: number; playing: boolean }

/** Frame-accurate, render-free access to playback for the read-along highlight. Stable for the
 *  provider's lifetime; `subscribe` fires on play, pause, seek, rate, track and source changes. */
export interface NarrationClock {
  playhead(): Playhead | null;
  tracks(): readonly PlayerTrack[];
  source(): NarrationSource | null;
  subscribe(listener: () => void): () => void;
  /** Play track `index` from `seconds` (a word clicked in the text). */
  jumpTo(index: number, seconds: number): void;
}

export interface NarrationSource {
  /** Stable key of the narrated item, e.g. `deep_research:<id>` or `chat:<conversation>:<message>`. */
  key: string;
  title: string;
  /** Reopens the item the narration came from. */
  open?: () => void;
}

export interface NarrationGeneration {
  state: 'queued' | 'loading' | 'generating' | 'done' | 'cancelled' | 'error';
  /** Fragments generated / expected in the segment being generated. */
  done: number;
  total: number;
  segmentsDone: number;
  segmentsTotal: number;
  rtf: number | null;
  etaS: number | null;
  /** RTF above 1.5: generating is much slower than listening on this machine. */
  slow: boolean;
  error?: string;
}

export interface NarrationTimeline { playedS: number; generatedS: number; totalS: number }

export interface LiveNarration {
  append(track: PlayerTrack): void;
  /** Seconds generated and not heard yet: an open-ended narration waits when it is far ahead. */
  aheadS(): number;
  progress(update: Partial<NarrationGeneration> & { estimatedTotalS?: number }): void;
  finish(): void;
  fail(message: string): void;
}

interface PlayerApi {
  visible: boolean;
  isPlaying: boolean;
  /** Waiting for the next fragment to be generated. */
  buffering: boolean;
  currentTrackId: string | null;
  tracks: PlayerTrack[];
  index: number;
  currentTime: number;
  duration: number;
  rate: number;
  source: NarrationSource | null;
  generation: NarrationGeneration | null;
  timeline: NarrationTimeline;
  /** Start a playlist of saved clips at `startIndex` (defaults to 0). */
  play(tracks: PlayerTrack[], startIndex?: number, source?: NarrationSource): void;
  /** Start a narration whose fragments arrive while it plays. */
  startLive(source: NarrationSource, options: { autoplay: boolean; cancel: () => void }): LiveNarration;
  toggle(): void;
  stop(): void;
  seek(seconds: number): void;
  skip(seconds: number): void;
  prev(): void;
  next(): void;
  setRate(rate: number): void;
  cancelGeneration(): void;
  clock: NarrationClock;
}

const PlayerContext = createContext<PlayerApi | null>(null);

/** The player when one is mounted, else null (views rendered on their own, e.g. in tests). */
export function useOptionalAudioPlayer(): PlayerApi | null {
  return useContext(PlayerContext);
}

export function useAudioPlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}

/** Start playing once the buffered audio covers the time generation is still behind. */
export function liveStartThreshold(rtf: number | null, estimatedTotalS: number): number {
  if (rtf == null) return Infinity;
  if (rtf <= 0.9) return 0;
  return Math.max(0, estimatedTotalS * (1 - 1 / rtf));
}

const trackUrl = (track: PlayerTrack) => track.url ?? clipUrl(track.id);

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const elements = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const active = useRef(0);
  const tracksRef = useRef<PlayerTrack[]>([]);
  const indexRef = useRef(0);
  const rateRef = useRef(1);
  const playingWanted = useRef(false);
  const liveRef = useRef<{ autoplay: boolean; started: boolean; finished: boolean; cancel: () => void; estimatedTotalS: number } | null>(null);
  const generationRef = useRef<NarrationGeneration | null>(null);
  const lastTick = useRef(0);

  const [visible, setVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [index, setIndex] = useState(0);
  const [tracks, setTracks] = useState<PlayerTrack[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [source, setSource] = useState<NarrationSource | null>(null);
  const [generation, setGeneration] = useState<NarrationGeneration | null>(null);
  const [estimatedTotalS, setEstimatedTotalS] = useState(0);
  const sourceRef = useRef<NarrationSource | null>(null);
  const listeners = useRef(new Set<() => void>());
  const notify = useCallback(() => { for (const listener of listeners.current) listener(); }, []);
  const changeSource = useCallback((next: NarrationSource | null) => { sourceRef.current = next; setSource(next); }, []);

  useEffect(() => {
    void window.nodus.getSettings().then((s) => {
      const r = s.audioSpeed ?? 1;
      rateRef.current = r;
      setRateState(r);
      for (const el of elements.current) if (el) el.playbackRate = r;
    });
  }, []);

  const current = () => elements.current[active.current];
  const spare = () => elements.current[1 - active.current];

  /** Keep the following track loaded in the spare element so `ended` can switch instantly. */
  const preloadNext = useCallback(() => {
    const el = spare();
    const next = tracksRef.current[indexRef.current + 1];
    if (!el) return;
    if (!next) { el.removeAttribute('src'); el.dataset.trackId = ''; return; }
    if (el.dataset.trackId === next.id) return;
    el.dataset.trackId = next.id;
    el.src = trackUrl(next);
    el.preload = 'auto';
    el.load();
  }, []);

  const startTrack = useCallback(async (i: number) => {
    const track = tracksRef.current[i];
    if (!track) return;
    indexRef.current = i;
    setIndex(i);
    setBuffering(false);
    let el = current();
    // The spare element already holds this track when we are moving to the next one.
    const other = spare();
    if (other && other.dataset.trackId === track.id) {
      current()?.pause();
      active.current = 1 - active.current;
      el = other;
    } else if (el) {
      el.dataset.trackId = track.id;
      el.src = trackUrl(track);
    }
    if (!el) return;
    el.playbackRate = rateRef.current;
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    setDuration(el.duration || track.durationS || 0);
    playingWanted.current = true;
    notify();
    try { await el.play(); } catch { setIsPlaying(false); }
    preloadNext();
  }, [preloadNext, notify]);

  const play = useCallback((next: PlayerTrack[], startIndex = 0, nextSource?: NarrationSource) => {
    if (!next.length) return;
    liveRef.current = null;
    generationRef.current = null;
    setGeneration(null);
    tracksRef.current = next;
    setTracks(next);
    changeSource(nextSource ?? null);
    setEstimatedTotalS(next.reduce((sum, track) => sum + (track.durationS ?? 0), 0));
    setVisible(true);
    for (const el of elements.current) if (el) el.dataset.trackId = '';
    void startTrack(Math.max(0, Math.min(startIndex, next.length - 1)));
  }, [startTrack, changeSource]);

  const generatedS = () => tracksRef.current.reduce((sum, track) => sum + (track.durationS ?? 0), 0);

  const startLive = useCallback((nextSource: NarrationSource, options: { autoplay: boolean; cancel: () => void }): LiveNarration => {
    current()?.pause();
    for (const el of elements.current) if (el) { el.removeAttribute('src'); el.dataset.trackId = ''; }
    tracksRef.current = [];
    setTracks([]);
    indexRef.current = 0;
    setIndex(0);
    setCurrentTime(0);
    setDuration(0);
    changeSource(nextSource);
    notify();
    setEstimatedTotalS(0);
    setVisible(true);
    playingWanted.current = options.autoplay;
    const live = { autoplay: options.autoplay, started: false, finished: false, cancel: options.cancel, estimatedTotalS: 0 };
    liveRef.current = live;
    const initial: NarrationGeneration = { state: 'queued', done: 0, total: 0, segmentsDone: 0, segmentsTotal: 0, rtf: null, etaS: null, slow: false };
    generationRef.current = initial;
    setGeneration(initial);
    setBuffering(options.autoplay);

    const maybeStart = () => {
      if (liveRef.current !== live || live.started || !live.autoplay || !tracksRef.current.length) return;
      const threshold = live.finished ? 0 : liveStartThreshold(generationRef.current?.rtf ?? null, live.estimatedTotalS);
      if (generatedS() >= threshold) { live.started = true; void startTrack(0); }
    };

    return {
      append(track) {
        if (liveRef.current !== live) return;
        tracksRef.current = [...tracksRef.current, track];
        setTracks(tracksRef.current);
        notify();
        // A fragment arriving while playback waited at the end of the queue resumes it.
        const el = current();
        const waitingAtEnd = live.started && playingWanted.current && el && (el.ended || !el.src) && indexRef.current === tracksRef.current.length - 2;
        if (waitingAtEnd) void startTrack(indexRef.current + 1);
        else if (live.started) preloadNext();
        maybeStart();
      },
      aheadS() {
        if (liveRef.current !== live) return 0;
        if (!live.started) return generatedS();
        const before = tracksRef.current.slice(0, indexRef.current).reduce((sum, item) => sum + (item.durationS ?? 0), 0);
        return generatedS() - before - (current()?.currentTime ?? 0);
      },
      progress(update) {
        if (liveRef.current !== live) return;
        if (update.estimatedTotalS != null) { live.estimatedTotalS = update.estimatedTotalS; setEstimatedTotalS(update.estimatedTotalS); }
        const rtf = update.rtf ?? generationRef.current?.rtf ?? null;
        const next = { ...(generationRef.current ?? initial), ...update, slow: rtf != null && rtf > 1.5 } as NarrationGeneration;
        delete (next as { estimatedTotalS?: number }).estimatedTotalS;
        generationRef.current = next;
        setGeneration(next);
        maybeStart();
      },
      finish() {
        if (liveRef.current !== live) return;
        live.finished = true;
        const next = { ...(generationRef.current ?? initial), state: 'done' as const, etaS: 0 };
        generationRef.current = next;
        setGeneration(next);
        live.estimatedTotalS = generatedS();
        setEstimatedTotalS(live.estimatedTotalS);
        setBuffering(false);
        maybeStart();
      },
      fail(message) {
        if (liveRef.current !== live) return;
        live.finished = true;
        const next = { ...(generationRef.current ?? initial), state: 'error' as const, error: message };
        generationRef.current = next;
        setGeneration(next);
        setBuffering(false);
      },
    };
  }, [preloadNext, startTrack, changeSource, notify]);

  const toggle = useCallback(() => {
    const el = current();
    if (!el) return;
    const live = liveRef.current;
    if (live && !live.started && tracksRef.current.length) { live.autoplay = true; live.started = true; void startTrack(0); return; }
    if (el.paused) { playingWanted.current = true; void el.play().catch(() => undefined); }
    else { playingWanted.current = false; el.pause(); }
  }, [startTrack]);

  const cancelGeneration = useCallback(() => {
    const live = liveRef.current;
    if (live && !live.finished) live.cancel();
  }, []);

  const stop = useCallback(() => {
    playingWanted.current = false;
    for (const el of elements.current) el?.pause();
    cancelGeneration();
    liveRef.current = null;
    generationRef.current = null;
    setGeneration(null);
    setVisible(false);
    setIsPlaying(false);
    setBuffering(false);
    changeSource(null);
    notify();
  }, [cancelGeneration, changeSource, notify]);

  const seek = useCallback((seconds: number) => {
    const el = current();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
    setCurrentTime(el.currentTime);
  }, []);

  const skip = useCallback((seconds: number) => {
    const el = current();
    if (!el) return;
    const target = el.currentTime + seconds;
    if (target < 0 && indexRef.current > 0) { void startTrack(indexRef.current - 1); return; }
    if (target > (el.duration || 0) && indexRef.current < tracksRef.current.length - 1) { void startTrack(indexRef.current + 1); return; }
    seek(target);
  }, [seek, startTrack]);

  const prev = useCallback(() => { if (indexRef.current > 0) void startTrack(indexRef.current - 1); }, [startTrack]);
  const next = useCallback(() => { if (indexRef.current < tracksRef.current.length - 1) void startTrack(indexRef.current + 1); }, [startTrack]);

  const setRate = useCallback((r: number) => {
    const value = Math.max(0.5, Math.min(2, r));
    rateRef.current = value;
    setRateState(value);
    for (const el of elements.current) if (el) el.playbackRate = value;
    notify();
    void window.nodus.updateSettings({ audioSpeed: value });
  }, [notify]);

  const onEnded = useCallback((which: number) => {
    if (which !== active.current) return;
    const target = indexRef.current + 1;
    if (target < tracksRef.current.length) { void startTrack(target); return; }
    const live = liveRef.current;
    if (live && !live.finished && playingWanted.current) { setBuffering(true); return; }
    setIsPlaying(false);
  }, [startTrack]);

  const onTime = useCallback((which: number, el: HTMLAudioElement) => {
    if (which !== active.current) return;
    const now = performance.now();
    // ~4 updates a second keep the header smooth without re-rendering on every frame.
    if (now - lastTick.current < 250) return;
    lastTick.current = now;
    setCurrentTime(el.currentTime);
  }, []);

  const jumpTo = useCallback((i: number, seconds: number) => {
    const track = tracksRef.current[i];
    if (!track) return;
    const live = liveRef.current;
    if (live && !live.started) { live.autoplay = true; live.started = true; }
    playingWanted.current = true;
    const el = current();
    if (i === indexRef.current && el?.dataset.trackId === track.id && el.src) {
      el.currentTime = Math.max(0, seconds);
      setCurrentTime(el.currentTime);
      if (el.paused) void el.play().catch(() => undefined);
      notify();
      return;
    }
    // startTrack sets the element up synchronously before it awaits play(), so the position
    // set right after applies to the new track (as the default start position until it loads).
    void startTrack(i);
    const next = current();
    if (next) next.currentTime = Math.max(0, seconds);
  }, [startTrack, notify]);

  const clock = useMemo<NarrationClock>(() => ({
    playhead() {
      const el = elements.current[active.current];
      const track = tracksRef.current[indexRef.current];
      if (!el || !track || el.dataset.trackId !== track.id) return null;
      return { trackId: track.id, index: indexRef.current, time: el.currentTime, rate: el.playbackRate || rateRef.current, playing: !el.paused && !el.ended };
    },
    tracks: () => tracksRef.current,
    source: () => sourceRef.current,
    subscribe(listener) {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
    jumpTo: (i, seconds) => jumpTo(i, seconds),
  }), [jumpTo]);

  const timeline = useMemo<NarrationTimeline>(() => {
    const before = tracks.slice(0, index).reduce((sum, track) => sum + (track.durationS ?? 0), 0);
    const generated = tracks.reduce((sum, track) => sum + (track.durationS ?? 0), 0);
    return { playedS: before + currentTime, generatedS: generated, totalS: Math.max(generated, estimatedTotalS) };
  }, [tracks, index, currentTime, estimatedTotalS]);

  const api = useMemo<PlayerApi>(() => ({
    visible, isPlaying, buffering, currentTrackId: tracks[index]?.id ?? null, tracks, index, currentTime, duration, rate,
    source, generation, timeline,
    play, startLive, toggle, stop, seek, skip, prev, next, setRate, cancelGeneration, clock,
  }), [visible, isPlaying, buffering, tracks, index, currentTime, duration, rate, source, generation, timeline, play, startLive, toggle, stop, seek, skip, prev, next, setRate, cancelGeneration, clock]);

  return (
    <PlayerContext.Provider value={api}>
      {/* The app's layout expects this full-height column (it used to also hold the bottom strip). */}
      <div className="h-full min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
      {[0, 1].map((which) => (
        <audio
          key={which}
          ref={(el) => { elements.current[which] = el; }}
          className="hidden"
          preload="auto"
          onEnded={() => onEnded(which)}
          onPlay={() => { if (which === active.current) { setIsPlaying(true); setBuffering(false); notify(); } }}
          onPause={() => { if (which === active.current) { setIsPlaying(false); notify(); } }}
          onSeeked={() => { if (which === active.current) notify(); }}
          onTimeUpdate={(e) => onTime(which, e.currentTarget)}
          onLoadedMetadata={(e) => { if (which === active.current) setDuration(e.currentTarget.duration || 0); }}
        />
      ))}
    </PlayerContext.Provider>
  );
}
