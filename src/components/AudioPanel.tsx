import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioClip,
  AudioEntityKind,
  AudioProvider,
  AudioSegment,
  AudioSegmentRequest,
  StudyAudioBookmark,
  StudyAudioPlaylistItem,
  StudyPronunciationEntry,
} from '@shared/types';
import { findVoice, getEngine } from '../lib/audio';
import { synthesizeSegment } from '../lib/audio/synth';
import {
  audioGenerationJobKey,
  cancelAudioGeneration,
  clearBackgroundJob,
  startAudioGeneration,
  subscribeBackgroundJob,
  type AudioGenerationProgress,
  type AudioGenerationRequest,
  type AudioGenerationResult,
} from '../backgroundJobs';
import { useAudioPlayer, type PlayerTrack } from './AudioPlayer';
import { HoverLabelButton, Icon, ModalBackdrop } from './ui';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { getActiveLang, t, tx } from '../i18n';

/**
 * Reusable narration panel for a Deep Research report or an immersion. It asks
 * the main process for the speakable segments (sections / stages), synthesises
 * each one with the active voice provider, and hands the WAV bytes back to be
 * persisted. Playback is delegated to the app-wide player (the bottom strip), so
 * there is a single audio stream across the whole app.
 */
interface RunProgress {
  done: number;
  total: number;
  label: string;
  cancelling?: boolean;
}

export function AudioPanel({
  entityKind,
  entityId,
  compact,
  toolbar = false,
  sourceMarkdown,
  selectionText,
  cursorOffset,
  title,
  subjectId,
  localOnly = false,
}: {
  entityKind: AudioEntityKind;
  entityId: string;
  compact?: boolean;
  /** Show a fixed reader action; narration controls open only on click. */
  toolbar?: boolean;
  sourceMarkdown?: string;
  selectionText?: string;
  cursorOffset?: number;
  title?: string;
  subjectId?: string | null;
  localOnly?: boolean;
}) {
  const player = useAudioPlayer();
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [run, setRun] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  const [mode, setMode] = useState<NonNullable<AudioSegmentRequest['mode']>>('full');
  const [bookmarks, setBookmarks] = useState<StudyAudioBookmark[]>([]);
  const [pronunciations, setPronunciations] = useState<StudyPronunciationEntry[]>([]);
  const [playlist, setPlaylist] = useState<StudyAudioPlaylistItem[]>([]);
  const [dictionaryDraft, setDictionaryDraft] = useState({ written: '', spoken: '' });
  const [showStudyTools, setShowStudyTools] = useState(false);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  const generating = run != null;
  const study = entityKind.startsWith('study_');

  const segmentRequest = useMemo<AudioSegmentRequest>(() => ({
    mode,
    markdown: sourceMarkdown,
    selection: selectionText,
    cursorOffset,
    title,
    pronunciations,
  }), [mode, sourceMarkdown, selectionText, cursorOffset, title, pronunciations]);

  const refreshClips = async () => {
    const list = await window.nodus.listAudioClips(entityKind, entityId);
    if (mounted.current) setClips(list);
  };

  const refreshStudyMeta = async () => {
    if (!study) return;
    const [nextBookmarks, nextPronunciations, nextPlaylist] = await Promise.all([
      window.nodus.listStudyAudioBookmarks(entityKind, entityId),
      subjectId ? window.nodus.getStudyPronunciations(subjectId) : Promise.resolve([]),
      subjectId ? window.nodus.listStudyAudioPlaylist(subjectId) : Promise.resolve([]),
    ]);
    if (mounted.current) { setBookmarks(nextBookmarks); setPronunciations(nextPronunciations); setPlaylist(nextPlaylist); }
  };

  const checkVoice = async (): Promise<{ provider: AudioProvider; voiceId: string } | null> => {
    const settings = await window.nodus.getSettings();
    const provider = settings.audioProvider ?? 'piper';
    if (localOnly && provider === 'hume') {
      if (mounted.current) setVoiceReady(false);
      return null;
    }
    const chosen = settings.audioVoice;
    if (!chosen) {
      if (mounted.current) setVoiceReady(false);
      return null;
    }
    const ready = (await getEngine(provider).ready()).has(chosen);
    if (mounted.current) setVoiceReady(ready);
    return ready ? { provider, voiceId: chosen } : null;
  };

  useEffect(() => {
    mounted.current = true;
    void refreshClips();
    void refreshStudyMeta();
    void checkVoice();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line
  }, [entityKind, entityId]);

  // The synthesis loop runs in the module-scope job store, so it survives leaving
  // this view. Subscribe to its progress: on remount the bar picks up mid-run, and
  // clips are reflected as they are saved. Leaving simply unsubscribes — it never
  // cancels the work.
  useEffect(() => {
    const key = audioGenerationJobKey(entityKind, entityId);
    return subscribeBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(key, (job) => {
      if (!mounted.current) return;
      if (job?.status === 'running') {
        setRun(job.progress ?? { done: 0, total: 0, label: t('Preparando…') });
        if (job.progress) void refreshClips();
        return;
      }
      setRun(null);
      if (!job) return;
      if (job.status === 'failed' && job.error) setError(localizeRuntimeError(job.error, getActiveLang()));
      void refreshClips();
      void refreshStudyMeta();
      // Drop the finished snapshot so a later remount does not resurrect it.
      clearBackgroundJob(key, job.id);
    });
    // eslint-disable-next-line
  }, [entityKind, entityId]);

  useEffect(() => {
    let active = true;
    void window.nodus.getAudioSegments(entityKind, entityId, segmentRequest).then((next) => { if (active) setSegments(next); }).catch(() => { if (active) setSegments([]); });
    return () => { active = false; };
  }, [entityKind, entityId, segmentRequest]);

  const totalDuration = useMemo(() => clips.reduce((acc, c) => acc + c.durationSec, 0), [clips]);
  const playable = useMemo<PlayerTrack[]>(
    () => clips.filter((c) => !c.missing).map((c) => ({ id: c.id, label: c.segmentLabel })),
    [clips]
  );

  const generate = async () => {
    setError(null);
    const chosen = await checkVoice();
    if (!chosen) {
      setError(localOnly ? t('La lectura de estudio requiere una voz local de Piper o Kokoro.') : t('Elige y prepara una voz en Ajustes → IA → Audio y voz.'));
      return;
    }
    // Local voices carry static metadata; cloud (Hume) voices are dynamic, so the
    // language is best-effort and defaults to empty.
    const language = findVoice(chosen.provider, chosen.voiceId)?.language ?? '';
    player.stop();
    // Hand the loop to the module-scope job store; the subscription above drives
    // the progress bar and clip list. Segment fetching, clip clearing and errors
    // (including "no narratable text") are reported through the job.
    startAudioGeneration({
      entityKind,
      entityId,
      provider: chosen.provider,
      voiceId: chosen.voiceId,
      language,
      segmentRequest,
      labels: { preparing: t('Preparando…'), noText: t('No hay texto narrable en este contenido.') },
    }, synthesizeSegment);
  };

  const cancel = () => {
    cancelAudioGeneration(entityKind, entityId);
  };

  const playFrom = (clip: AudioClip) => {
    const idx = playable.findIndex((tk) => tk.id === clip.id);
    if (idx >= 0) player.play(playable, idx);
  };

  const deleteClip = async (id: string) => {
    if (player.currentTrackId === id) player.stop();
    await window.nodus.deleteAudioClip(id);
    await refreshClips();
  };

  const deleteAll = async () => {
    player.stop();
    await window.nodus.deleteEntityAudioClips(entityKind, entityId);
    await refreshClips();
  };

  const hasClips = clips.length > 0;
  const anyMissing = clips.some((c) => c.missing);
  const pct = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
  const segmentText = new Map(segments.map((segment) => [segment.index, segment.text]));

  const panel = (
    <div className={`rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
          <span aria-hidden>🎧</span>
          {t('Audio')}
          {hasClips && !generating && (
            <span className="text-[11px] font-normal text-neutral-500">
              {tx('{n} pistas', { n: clips.length })} · {formatDuration(totalDuration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {study && <select data-testid="study-audio-mode" className="input h-8 py-0 text-xs" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="full">{t('Documento completo')}</option>
            <option value="selection" disabled={!selectionText?.trim()}>{t('Selección actual')}</option>
            <option value="cursor">{t('Desde el cursor')}</option>
          </select>}
          {study && <button data-testid="study-audio-tools" className={`btn btn-ghost h-8 px-2 text-xs ${showStudyTools ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' : ''}`} onClick={() => setShowStudyTools((value) => !value)}>{t('Pronunciación y lista')}</button>}
          {hasClips && !generating && (
            <>
              <button className="btn btn-ghost border border-neutral-700 text-xs" onClick={() => player.play(playable, 0)} disabled={playable.length === 0}>
                ▶ {t('Reproducir todo')}
              </button>
              <button className="btn btn-ghost text-xs text-red-400" onClick={() => void deleteAll()}>
                {t('Eliminar audio')}
              </button>
            </>
          )}
          {generating ? (
            <button
              data-testid="audio-cancel"
              className="btn btn-ghost border border-neutral-700 text-xs disabled:opacity-60"
              onClick={cancel}
              disabled={run?.cancelling}
            >
              {run?.cancelling ? t('Cancelando…') : t('Cancelar')}
            </button>
          ) : (
            <button className="btn btn-primary text-xs" onClick={() => void generate()}>
              {hasClips ? t('Regenerar') : t('Generar audio')}
            </button>
          )}
        </div>
      </div>

      {voiceReady === false && !generating && (
        <div className="mt-2 text-xs text-amber-400/90">
          {localOnly ? t('Elige una voz local de Piper o Kokoro en Ajustes → IA → Audio y voz.') : t('Elige y prepara una voz en Ajustes → IA → Audio y voz para poder narrar.')}
        </div>
      )}

      {showStudyTools && study && <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/50" data-testid="study-audio-study-tools">
        <div className="flex items-center justify-between"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Diccionario de pronunciación')}</h4>{subjectId && <span className="text-[9px] text-neutral-700">{t('Guardado por asignatura')}</span>}</div>
        {subjectId ? <><div className="mt-2 flex gap-1"><input className="input h-8 min-w-0 flex-1 text-xs" value={dictionaryDraft.written} onChange={(event) => setDictionaryDraft((current) => ({ ...current, written: event.target.value }))} placeholder={t('Texto escrito')} /><input className="input h-8 min-w-0 flex-1 text-xs" value={dictionaryDraft.spoken} onChange={(event) => setDictionaryDraft((current) => ({ ...current, spoken: event.target.value }))} placeholder={t('Cómo debe sonar')} /><button className="btn btn-ghost h-8 px-2" onClick={() => {
          if (!dictionaryDraft.written.trim() || !dictionaryDraft.spoken.trim()) return;
          void window.nodus.setStudyPronunciations(subjectId, [...pronunciations, dictionaryDraft]).then((next) => { setPronunciations(next); setDictionaryDraft({ written: '', spoken: '' }); });
        }}>+</button></div><div className="mt-2 flex flex-wrap gap-1">{pronunciations.map((entry) => <button key={`${entry.written}:${entry.spoken}`} className="rounded-full border border-neutral-800 px-2 py-1 text-[9px] text-neutral-500 hover:border-red-900 hover:text-red-300" title={t('Eliminar')} onClick={() => void window.nodus.setStudyPronunciations(subjectId, pronunciations.filter((candidate) => candidate !== entry)).then(setPronunciations)}>{entry.written} → {entry.spoken} ×</button>)}</div></> : <p className="mt-2 text-[10px] text-neutral-600">{t('Asocia el contenido a una asignatura para guardar pronunciaciones propias.')}</p>}
        {playlist.length > 0 && <div className="mt-3 border-t border-neutral-800 pt-2"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Lista de reproducción de la asignatura')}</h4><div className="mt-1 space-y-1">{playlist.map((item) => <div key={item.entityId} className="flex items-center text-[10px] text-neutral-500"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{item.clipCount} {t('pistas')} · {formatDuration(item.durationSec)}</span></div>)}</div></div>}
        {bookmarks.length > 0 && <div className="mt-3 border-t border-neutral-800 pt-2"><h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Marcadores')}</h4><div className="mt-1 flex flex-wrap gap-1">{bookmarks.map((bookmark) => <button key={bookmark.id} className="rounded-full border border-teal-900 px-2 py-1 text-[9px] text-teal-400" onClick={() => { const clip = clips.find((candidate) => candidate.segmentIndex === bookmark.segmentIndex); if (clip) playFrom(clip); }} onContextMenu={(event) => { event.preventDefault(); void window.nodus.deleteStudyAudioBookmark(bookmark.id).then(refreshStudyMeta); }}>{bookmark.label}</button>)}</div></div>}
      </div>}

      {generating && run && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-neutral-400">
            <span className="truncate">{run.label}</span>
            <span className="shrink-0 font-mono">{Math.min(run.done + 1, run.total)}/{run.total}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        </div>
      )}

      {error && <div role="alert" className="mt-2 text-xs text-red-400">{error}</div>}

      {anyMissing && !generating && (
        <div className="mt-2 text-[11px] text-neutral-500">
          {t('Faltan algunos archivos de audio (no se guardan en las copias de seguridad). Pulsa Regenerar para recuperarlos.')}
        </div>
      )}

      {hasClips && (
        <ul className="mt-3 space-y-1">
          {clips.map((clip) => {
            const isCurrent = player.currentTrackId === clip.id;
            const isPlaying = isCurrent && player.isPlaying;
            return (
              <li
                key={clip.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isCurrent ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900/60'}`}
              >
                <button
                  className="shrink-0 text-neutral-300 disabled:text-neutral-600"
                  title={clip.missing ? t('Archivo no disponible') : isPlaying ? t('Pausa') : t('Reproducir')}
                  disabled={clip.missing}
                  onClick={() => (isCurrent ? player.toggle() : playFrom(clip))}
                >
                  {clip.missing ? '⚠' : isPlaying ? '⏸' : '▶'}
                </button>
                <span className="min-w-0 flex-1 text-neutral-300" title={clip.segmentLabel}>
                  <span className="block truncate">{clip.segmentLabel}</span>
                  {isCurrent && segmentText.get(clip.segmentIndex) && <mark className="mt-0.5 block line-clamp-2 bg-teal-100 text-[10px] leading-4 text-teal-800 dark:bg-teal-950/70 dark:text-teal-200" data-testid="study-audio-active-phrase">{segmentText.get(clip.segmentIndex)}</mark>}
                </span>
                {clip.missing ? (
                  <span className="shrink-0 text-[10px] text-amber-500/80">{t('sin archivo')}</span>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-neutral-500">{formatDuration(clip.durationSec)}</span>
                )}
                <button
                  className="shrink-0 text-neutral-600 hover:text-amber-300"
                  title={t('Añadir marcador')}
                  onClick={() => void window.nodus.createStudyAudioBookmark(entityKind, entityId, clip.segmentIndex, clip.segmentLabel).then(refreshStudyMeta)}
                >
                  ☆
                </button>
                <button
                  className="shrink-0 text-neutral-600 hover:text-teal-300"
                  title={t('Descargar audio')}
                  onClick={() => void window.nodus.exportAudioClip(clip.id)}
                >
                  ↓
                </button>
                <button
                  className="shrink-0 text-neutral-600 hover:text-red-400"
                  title={t('Eliminar pista')}
                  onClick={() => void deleteClip(clip.id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  if (!toolbar) return panel;

  return <>
    <HoverLabelButton
      icon={generating ? 'sync' : 'audio'}
      label={generating || hasClips ? t('Audio') : t('Generar audio')}
      iconOnly
      spinning={generating}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="deep-research-audio-toggle"
      className={`btn-ghost h-9 min-h-9 border ${generating || hasClips ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
      onClick={() => {
        setOpen(true);
        if (!hasClips && !generating) void generate();
      }}
    />
    {open && <ModalBackdrop onClose={() => setOpen(false)}>
      <section
        className="card-modal flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t('Audio')}
        data-testid="deep-research-audio-dialog"
      >
        <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <Icon name="audio" className="text-indigo-500 dark:text-indigo-300" />
          <h2 className="text-sm font-semibold">{t('Audio')}</h2>
          <div className="flex-1" />
          <button type="button" autoFocus className="btn btn-ghost !p-2" onClick={() => setOpen(false)} aria-label={t('Cerrar')} title={t('Cerrar')}>
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">{panel}</div>
      </section>
    </ModalBackdrop>}
  </>;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
