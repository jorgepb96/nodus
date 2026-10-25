import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DRIFT_CATALOG_SCHEMA_VERSION,
  isDriftCategoryId,
  isDriftSoundId,
  isValidVolume,
  planDriftSelection,
  DEFAULT_MASTER_VOLUME,
  type DriftCatalogEntry,
  type DriftCategoryId,
  type DriftSourceKind,
  type DriftVoiceErrorCode,
} from '@shared/drift';
import { ICON_NAMES } from '../ui';
import { DriftAudioEngine, type DriftEngineSnapshot, type DriftVoiceStatus } from './audio/DriftAudioEngine';
import {
  createDriftPersistence,
  driftMetaFromEntry,
  driftReducer,
  driftVolumeOf,
  readStoredDriftState,
  type DriftAction,
  type DriftFilter,
  type DriftState,
  type DriftPreset,
  type DriftPresetIcon,
  type DriftSort,
} from './driftState';

/**
 * Nodus Drift, once per window.
 *
 * Mounted in src/main.tsx around <App />, at the same stable level as the other providers,
 * so it belongs to the WINDOW: it does not read the current view, Tools page, vault or
 * popover. Leaving Tools, switching vault, closing the header popover or minimising Nodus
 * never stops it and never builds a second one. Closing the window unmounts it, which
 * disposes the engine; a new window starts again from the saved settings, paused.
 *
 * Two kinds of state live here and stay apart:
 *  - the saved CONFIGURATION (selection, volumes, favourites, filter), a pure reducer that
 *    is written to localStorage after a short debounce; and
 *  - what the engine is DOING (loading, playing, failed), which is only ever read from the
 *    engine's snapshots and never written down.
 */

export type DriftCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DriftVoiceView {
  id: string;
  nameKey: string;
  icon: string;
  categoryId: DriftCategoryId | null;
  kind: DriftSourceKind | null;
  volume: number;
  status: DriftVoiceStatus;
  error: DriftVoiceErrorCode | null;
  /** False when the catalogue no longer offers this sound as available. */
  available: boolean;
}

export type DriftMediaTab = 'browser' | 'drift' | 'narration';

export interface DriftContextValue {
  catalogStatus: DriftCatalogStatus;
  sounds: DriftCatalogEntry[];
  /** Fetch the catalogue (once; `force` retries after a failure). */
  loadCatalog: (force?: boolean) => Promise<void>;

  selection: string[];
  voices: DriftVoiceView[];
  favorites: string[];
  filter: DriftFilter;
  master: number;
  presets: DriftPreset[];
  sort: DriftSort;
  usage: Record<string, number>;
  presetUsage: Record<string, number>;
  setSort: (sort: DriftSort) => void;
  savePreset: (name: string, icon: DriftPresetIcon) => void;
  editPreset: (id: string, name: string, icon: DriftPresetIcon) => void;
  deletePreset: (id: string) => void;
  applyPreset: (id: string) => void;
  /** A voice is audibly running. */
  playing: boolean;
  /** A voice is still fetching or decoding. */
  loading: boolean;
  /** The seventh voice was refused (raised by the last activation, cleared by any change). */
  limitNotice: number | null;

  toggleSound: (id: string) => void;
  removeSound: (id: string) => void;
  retrySound: (id: string) => void;
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  clear: () => void;
  setVolume: (id: string, value: number) => void;
  setMaster: (value: number) => void;
  toggleFavorite: (id: string) => void;
  setFilter: (filter: DriftFilter) => void;
  dismissNotice: () => void;

  /** Which tab of the header popover was chosen last; cosmetic, never affects playback. */
  mediaTab: DriftMediaTab | null;
  setMediaTab: (tab: DriftMediaTab) => void;
}

const DriftContext = createContext<DriftContextValue | null>(null);

export function useDrift(): DriftContextValue {
  const value = useContext(DriftContext);
  if (!value) throw new Error('useDrift must be used within DriftProvider');
  return value;
}

const KNOWN_ICONS: ReadonlySet<string> = new Set(ICON_NAMES);
const isKnownIcon = (icon: string) => KNOWN_ICONS.has(icon);
const sanitizeIcon = (icon: string | undefined) => (icon && KNOWN_ICONS.has(icon) ? icon : 'drift');

const EMPTY_ENGINE: DriftEngineSnapshot = Object.freeze({
  voices: [],
  master: DEFAULT_MASTER_VOLUME,
  wantPlaying: false,
  playing: false,
  loading: false,
  cachedBytes: 0,
  contextState: 'none',
  disposed: false,
}) as DriftEngineSnapshot;

function localStorageOrNull(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** The catalogue crosses the process boundary: accept only what is structurally sound. */
function parseCatalog(value: unknown): DriftCatalogEntry[] | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { schemaVersion?: unknown; sounds?: unknown };
  if (response.schemaVersion !== DRIFT_CATALOG_SCHEMA_VERSION || !Array.isArray(response.sounds)) return null;
  const sounds: DriftCatalogEntry[] = [];
  for (const raw of response.sounds as DriftCatalogEntry[]) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = raw.source?.kind;
    const availability = raw.availability;
    if (!isDriftSoundId(raw.id) || typeof raw.nameKey !== 'string' || typeof raw.descriptionKey !== 'string') continue;
    if (!isDriftCategoryId(raw.categoryId) || typeof raw.icon !== 'string') continue;
    if (kind !== 'file' && kind !== 'noise' && kind !== 'binaural') continue;
    if (availability !== 'available' && availability !== 'missing' && availability !== 'license-unresolved') continue;
    sounds.push(raw);
  }
  return sounds;
}

export function DriftProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(driftReducer, undefined, () => readStoredDriftState(localStorageOrNull()));
  const stateRef = useRef<DriftState>(state);
  const initialStateRef = useRef<DriftState>(state);

  /** Update the ref at once as well, so two quick clicks see each other's effect. */
  const apply = useCallback((action: DriftAction) => {
    stateRef.current = driftReducer(stateRef.current, action);
    dispatch(action);
  }, []);
  // A render is the authority on what the reducer produced.
  stateRef.current = state;

  const engineRef = useRef<DriftAudioEngine | null>(null);
  const [engine, setEngine] = useState<DriftEngineSnapshot>(EMPTY_ENGINE);

  const [catalogStatus, setCatalogStatus] = useState<DriftCatalogStatus>('idle');
  const [sounds, setSounds] = useState<DriftCatalogEntry[]>([]);
  const catalogRef = useRef<Map<string, DriftCatalogEntry>>(new Map());
  const catalogPromiseRef = useRef<Promise<void> | null>(null);
  const [limitNotice, setLimitNotice] = useState<number | null>(null);
  const [mediaTab, setMediaTab] = useState<DriftMediaTab | null>(null);

  const loadCatalog = useCallback((force = false): Promise<void> => {
    if (!force && catalogPromiseRef.current) return catalogPromiseRef.current;
    setCatalogStatus('loading');
    const promise = window.nodus.getDriftCatalog().then((response) => {
      const parsed = parseCatalog(response);
      if (!parsed) throw new Error('Unreadable Drift catalogue');
      catalogRef.current = new Map(parsed.map((entry) => [entry.id, entry]));
      setSounds(parsed);
      setCatalogStatus('ready');
      // The authoritative catalogue wins: forget what it does not know and refresh the metadata.
      apply({ type: 'reconcile', sounds: parsed, isKnownIcon });
      const live = engineRef.current;
      if (live) {
        const keep = new Set(stateRef.current.selection);
        for (const voice of live.snapshot().voices) if (!keep.has(voice.id)) live.removeSound(voice.id);
      }
    }).catch((error: unknown) => {
      // Forget the failed promise so the next open, or the retry button, asks again.
      catalogPromiseRef.current = null;
      setCatalogStatus('error');
      throw error;
    });
    catalogPromiseRef.current = promise;
    // The caller decides whether a failure matters; this only keeps it from going unhandled.
    promise.catch(() => undefined);
    return promise;
  }, [apply]);

  // ── The engine: one per provider, created and disposed with the window ───────
  useEffect(() => {
    const created = new DriftAudioEngine({
      createContext: () => new AudioContext({ latencyHint: 'playback' }),
      readAudio: (soundId) => window.nodus.readDriftAudio(soundId),
      resolveSound: (soundId) => catalogRef.current.get(soundId),
      ready: () => loadCatalog(),
    });
    engineRef.current = created;
    let previousPlaying = new Set<string>();
    const stop = created.subscribe((snapshot) => {
      const playing = new Set(snapshot.voices.filter((voice) => voice.status === 'playing').map((voice) => voice.id));
      const started = [...playing].filter((id) => !previousPlaying.has(id));
      previousPlaying = playing;
      if (started.length) apply({ type: 'recordUse', ids: started });
      setEngine(snapshot);
    });
    const saved = stateRef.current;
    // Restored PAUSED: no context, no fetch, nothing audible until an explicit play.
    created.restore({ ids: saved.selection, volumes: saved.volumes, master: saved.master });
    setEngine(created.snapshot());
    return () => {
      stop();
      if (engineRef.current === created) engineRef.current = null;
      void created.dispose();
    };
  }, [loadCatalog, apply]);

  // ── Persistence: one debounced write, flushed when the page goes away ────────
  const persistenceRef = useRef<ReturnType<typeof createDriftPersistence> | null>(null);
  if (persistenceRef.current === null) persistenceRef.current = createDriftPersistence(localStorageOrNull());
  useEffect(() => {
    // The state read from storage is already what storage holds.
    if (state === initialStateRef.current) return;
    persistenceRef.current?.schedule(state);
  }, [state]);
  useEffect(() => {
    const persistence = persistenceRef.current;
    const flush = () => persistence?.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  // The limit notice fades on its own.
  useEffect(() => {
    if (limitNotice === null) return undefined;
    const handle = window.setTimeout(() => setLimitNotice(null), 6000);
    return () => window.clearTimeout(handle);
  }, [limitNotice]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const removeSound = useCallback((id: string) => {
    if (!stateRef.current.selection.includes(id)) return;
    apply({ type: 'remove', id });
    engineRef.current?.removeSound(id);
    setLimitNotice(null);
  }, [apply]);

  const toggleSound = useCallback((id: string) => {
    const current = stateRef.current;
    if (current.selection.includes(id)) {
      removeSound(id);
      return;
    }
    const live = engineRef.current;
    const entry = catalogRef.current.get(id);
    // Only an available catalogue entry is an operative card.
    if (!live || !entry || entry.availability !== 'available') return;
    const kindOf = (other: string) => catalogRef.current.get(other)?.source.kind ?? current.snapshot[other]?.kind;
    const plan = planDriftSelection(current.selection, id, kindOf);
    if (!plan.ok) {
      // The seventh voice: say so and leave the mix exactly as it is.
      if (plan.reason === 'limit') setLimitNotice(Date.now());
      return;
    }
    setLimitNotice(null);
    apply({ type: 'select', id, meta: driftMetaFromEntry(entry, isKnownIcon) });
    live.selectSound(id, driftVolumeOf(current, id)).catch(() => {
      // The engine refused what the reducer accepted: bring them back in step.
      apply({ type: 'remove', id });
      setLimitNotice(Date.now());
    });
  }, [apply, removeSound]);

  const retrySound = useCallback((id: string) => { void engineRef.current?.retrySound(id); }, []);

  const play = useCallback(() => {
    if (stateRef.current.selection.length === 0) return;
    setLimitNotice(null);
    // No await first: the context is created and resumed inside this very click.
    void engineRef.current?.playAll();
  }, []);

  const pause = useCallback(() => { void engineRef.current?.pauseAll(); }, []);

  const togglePlayback = useCallback(() => {
    const snapshot = engineRef.current?.snapshot();
    if (snapshot && snapshot.wantPlaying && (snapshot.playing || snapshot.loading)) pause();
    else play();
  }, [pause, play]);

  const clear = useCallback(() => {
    apply({ type: 'clear' });
    setLimitNotice(null);
    void engineRef.current?.clearAll();
  }, [apply]);

  const setVolume = useCallback((id: string, value: number) => {
    if (!isValidVolume(value) || !stateRef.current.selection.includes(id)) return;
    apply({ type: 'setVolume', id, value });
    engineRef.current?.setSoundVolume(id, value);
  }, [apply]);

  const setMaster = useCallback((value: number) => {
    if (!isValidVolume(value)) return;
    apply({ type: 'setMaster', value });
    engineRef.current?.setMasterVolume(value);
  }, [apply]);

  const toggleFavorite = useCallback((id: string) => {
    const entry = catalogRef.current.get(id);
    apply({ type: 'toggleFavorite', id, meta: entry ? driftMetaFromEntry(entry, isKnownIcon) : undefined });
  }, [apply]);

  const setFilter = useCallback((filter: DriftFilter) => apply({ type: 'setFilter', filter }), [apply]);
  const setSort = useCallback((sort: DriftSort) => apply({ type: 'setSort', sort }), [apply]);
  const dismissNotice = useCallback(() => setLimitNotice(null), []);
  const savePreset = useCallback((name: string, icon: DriftPresetIcon) => apply({ type: 'savePreset', id: crypto.randomUUID(), name, icon }), [apply]);
  const editPreset = useCallback((id: string, name: string, icon: DriftPresetIcon) => apply({ type: 'editPreset', id, name, icon }), [apply]);
  const deletePreset = useCallback((id: string) => apply({ type: 'deletePreset', id }), [apply]);
  const applyPreset = useCallback((id: string) => {
    if (!stateRef.current.presets.some((preset) => preset.id === id)) return;
    apply({ type: 'applyPreset', id });
    const next = stateRef.current;
    engineRef.current?.loadMix({ ids: next.selection, volumes: next.volumes, master: next.master });
    setLimitNotice(null);
  }, [apply]);

  // ── What the interface reads ────────────────────────────────────────────────
  const catalogMap = useMemo(() => new Map(sounds.map((entry) => [entry.id, entry])), [sounds]);

  const voices = useMemo<DriftVoiceView[]>(() => state.selection.map((id) => {
    const live = engine.voices.find((voice) => voice.id === id);
    const entry = catalogMap.get(id);
    const meta = entry ? driftMetaFromEntry(entry, isKnownIcon) : state.snapshot[id];
    return {
      id,
      nameKey: meta?.nameKey ?? id,
      icon: sanitizeIcon(meta?.icon),
      categoryId: meta?.categoryId ?? null,
      kind: meta?.kind ?? null,
      volume: live?.volume ?? driftVolumeOf(state, id),
      status: live?.status ?? 'paused',
      error: live?.error ?? null,
      available: entry ? entry.availability === 'available' : true,
    };
  }), [state, engine, catalogMap]);

  const value = useMemo<DriftContextValue>(() => ({
    catalogStatus,
    sounds,
    loadCatalog,
    selection: state.selection,
    voices,
    favorites: state.favorites,
    filter: state.filter,
    master: state.master,
    presets: state.presets, savePreset, editPreset, deletePreset, applyPreset,
    sort: state.sort, usage: state.usage, presetUsage: state.presetUsage, setSort,
    playing: engine.playing,
    loading: engine.loading,
    limitNotice,
    toggleSound,
    removeSound,
    retrySound,
    play,
    pause,
    togglePlayback,
    clear,
    setVolume,
    setMaster,
    toggleFavorite,
    setFilter,
    dismissNotice,
    mediaTab,
    setMediaTab,
  }), [
    catalogStatus, sounds, loadCatalog, state, voices, engine, limitNotice, toggleSound, removeSound, retrySound,
    play, pause, togglePlayback, clear, setVolume, setMaster, toggleFavorite, setFilter, setSort, dismissNotice, mediaTab, savePreset, editPreset, deletePreset, applyPreset,
  ]);

  return <DriftContext.Provider value={value}>{children}</DriftContext.Provider>;
}
