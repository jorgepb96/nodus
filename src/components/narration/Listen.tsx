import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, AudioClip, AudioEntityKind, AudioSegmentRequest } from '@shared/types';
import { TTS_LANGUAGES, TTS_MODELS, PHONON_LANGUAGES, sanitizeTtsRetention, ttsModelBytes, ttsRetentionDays, type TtsLanguageSetting, type TtsStatus, type TtsEngine } from '@shared/ttsModels';
import { minimumVoiceTranscriptChars, type TtsVoice } from '@shared/ttsVoices';
import { HeaderBalloon } from '../HeaderBalloon';
import { ConfirmModal } from '../ConfirmModal';
import { Icon } from '../ui';
import { useAudioPlayer, useOptionalAudioPlayer, type PlayerTrack } from '../AudioPlayer';
import { ProgressTrack, formatClock } from './ProgressTrack';
import { VoicePicker, type VoicePickerOption } from './VoicePicker';
import {
  audioGenerationJobKey, cancelAudioGeneration, startAudioGeneration, subscribeBackgroundJob,
  type AudioGenerationProgress, type AudioGenerationRequest, type AudioGenerationResult,
} from '../../backgroundJobs';
import { segmentNarrator, startNarration } from '../../lib/narration/narrate';
import { clipTracks } from '../../lib/narration/clipTracks';
import { currentTtsStatus, refreshTtsStatus, subscribeTtsEvents, subscribeTtsStatus, ttsReady } from '../../lib/narration/ttsClient';
import { ttsErrorMessage, ttsInstallPhaseLabel } from '../../lib/narration/ttsErrors';
import { t, tx } from '../../i18n';

/**
 * The speaker button that narrates one item (a chat answer, a report, an immersion, a
 * dictionary entry) and the balloon it opens: engine state (download, activate, unload),
 * voice and language, the generation progress and the item's saved audios, each of which
 * can be kept (exempt from automatic deletion) or deleted. Playback itself is controlled
 * from the header's sound button.
 */
export interface ListenTarget {
  kind: AudioEntityKind;
  id: string;
  title: string;
  /** Chat answers and dictionary entries send the text on screen. */
  markdown?: () => string;
  segmentRequest?: AudioSegmentRequest;
  /** Reopens the item from the header player. */
  open?: () => void;
  /** Play without saving any clip (Scriptor's selection): see `NarrationInput.ephemeral`. */
  ephemeral?: boolean;
}

type Confirm = null | { kind: 'clip'; clip: AudioClip } | { kind: 'all' };

export function ListenButton({ target, size = 13, className = '', testId, label, toolbar = false, direct = false, bare = false, onUnavailable, open: openProp, onOpenChange }: {
  target: ListenTarget;
  size?: number;
  className?: string;
  testId?: string;
  label?: string;
  /** The header action uses the chat's button shape, shows its label and no progress ring. */
  toolbar?: boolean;
  /** The per-answer chat action plays immediately instead of opening the balloon. */
  direct?: boolean;
  /** Only `className` styles the button, so it can sit in another toolbar (Scriptor). */
  bare?: boolean;
  /** A direct action whose engine is not ready calls this instead of doing nothing. */
  onUnavailable?: () => void;
  /** Controls the balloon from outside, e.g. a menu action that opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => { if (onOpenChange) onOpenChange(next); else setOpenState(next); };
  const [starting, setStarting] = useState(false);
  const player = useOptionalAudioPlayer();
  const key = `${target.kind}:${target.id}`;
  const progress = useGeneration(target.kind, target.id);
  const generating = progress != null;
  const playingHere = player?.source?.key === key && player.isPlaying;
  const fraction = progress && progress.total ? (progress.done + (progress.fragmentsTotal ? (progress.fragmentsDone ?? 0) / progress.fragmentsTotal : 0)) / progress.total : 0;
  const playbackFraction = player?.source?.key === key && player.timeline.totalS > 0
    ? Math.max(0, Math.min(1, player.timeline.playedS / player.timeline.totalS))
    : 0;

  const directStart = async () => {
    if (!player || starting || generating) return;
    // An ephemeral narration has no saved clips to replay: a second click pauses or resumes it.
    if (target.ephemeral && player.source?.key === key && player.tracks.length) { player.toggle(); return; }
    setStarting(true);
    try {
      const [settings, status, clips] = await Promise.all([
        window.nodus.getSettings(),
        window.nodus.ttsStatus(),
        target.ephemeral ? Promise.resolve([] as AudioClip[]) : window.nodus.listAudioClips(target.kind, target.id).catch(() => []),
      ]);
      if (!settings || !status) return;
      const modelId = settings.ttsModelId || status.models.find((model) => model.downloaded)?.id || status.models[0]?.id || '';
      const model = TTS_MODELS.find((entry) => entry.id === modelId);
      const playable = clipTracks(clips, target.title);
      const source = { key, title: target.title, open: target.open };
      if (playable.length) { player.play(playable, 0, source); return; }
      if (!ttsReady(status, modelId)) { onUnavailable?.(); return; }
      const segmentRequest: AudioSegmentRequest = { ...(target.segmentRequest ?? {}), ...(target.markdown ? { markdown: target.markdown(), title: '' } : {}) };
      const voiceId = model?.engine === 'phonon' ? settings.ttsPhononVoiceId
        : model?.engine === 'kokoro' ? settings.ttsKokoroVoiceId
          : model?.engine === 'pocket' ? settings.ttsPocketVoiceId
            : settings.ttsVoiceId;
      const input = {
        kind: target.kind, id: target.id, title: target.title, segmentRequest, voiceId, language: settings.ttsLanguage,
        labels: { preparing: t('Preparando…'), noText: t('No hay texto narrable en este contenido.') },
        ephemeral: target.ephemeral,
      };
      // Nothing is saved without a clip, so an ephemeral narration always plays as it generates,
      // and the one it replaces stops generating: nobody can listen to it any more.
      if (target.ephemeral) { player.cancelGeneration(); startNarration(player, input, source); return; }
      if (settings.ttsStreaming) { startNarration(player, input, source); return; }
      player.stop();
      const job = startAudioGeneration({ entityKind: target.kind, entityId: target.id, voiceId, segmentRequest, labels: input.labels }, segmentNarrator(input, null));
      const unsubscribe = subscribeBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(audioGenerationJobKey(target.kind, target.id), (next) => {
        if (!next || next.id !== job.id || next.status === 'running') return;
        queueMicrotask(unsubscribe);
        if (next.status === 'completed' && next.result && !next.result.cancelled) {
          void window.nodus.listAudioClips(target.kind, target.id).then((saved) => {
            const tracks = clipTracks(saved, target.title);
            if (tracks.length) player.play(tracks, 0, source);
          });
        }
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-testid={testId ?? 'listen-button'}
        className={bare
          ? `relative ${playingHere || generating ? 'text-indigo-500 dark:text-indigo-300' : ''} ${className}`
          : toolbar
          ? `btn btn-ghost relative gap-1.5 border border-neutral-700 text-xs py-1 ${playingHere || generating ? 'text-indigo-500 dark:text-indigo-300' : ''} ${className}`
          : `relative inline-grid h-6 w-6 place-items-center rounded p-0 transition ${playingHere || generating ? 'text-indigo-500 dark:text-indigo-300' : 'text-neutral-500 opacity-70 hover:opacity-100'} hover:bg-neutral-200/60 dark:hover:bg-neutral-800 ${className}`}
        title={starting ? t('Preparando…') : generating ? tx('Generando audio · {pct}%', { pct: Math.round(fraction * 100) }) : playingHere ? t('Reproduciendo') : label ?? t('Escuchar')}
        aria-label={label ?? t('Escuchar')}
        aria-expanded={direct ? undefined : open}
        aria-pressed={direct ? playingHere : undefined}
        // In the editor's toolbars the click must not take the focus (or the selection) away.
        onPointerDown={bare ? (event) => { if (event.button === 0) event.preventDefault(); } : undefined}
        onMouseDown={bare ? (event) => event.preventDefault() : undefined}
        onClick={() => { if (direct) void directStart(); else setOpen(!open); }}
      >
        <Icon name={playingHere ? 'waveform' : 'volume'} size={size} />
        {toolbar && <span className="hidden sm:inline">{label ?? t('Escuchar')}</span>}
        {/* The labelled toolbar action only opens the balloon: its progress lives there, not on the button. */}
        {toolbar ? null : starting ? <LoadingRing /> : generating ? <ProgressRing fraction={fraction} /> : direct && player?.source?.key === key ? <ProgressRing fraction={playbackFraction} /> : null}
      </button>
      {open && player && <ListenBalloon target={target} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

function LoadingRing() {
  return (
    <svg className="listen-ring pointer-events-none absolute inset-0 h-full w-full animate-spin" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.2" />
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeDasharray="14 43" strokeLinecap="round" />
    </svg>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="listen-ring pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2.4" />
      <circle className="listen-progress-ring" cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="3.1" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.02, fraction))} strokeLinecap="round" />
    </svg>
  );
}

function useGeneration(kind: AudioEntityKind, id: string): AudioGenerationProgress | null {
  const [progress, setProgress] = useState<AudioGenerationProgress | null>(null);
  useEffect(() => subscribeBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(audioGenerationJobKey(kind, id), (job) => {
    setProgress(job?.status === 'running' ? (job.progress ?? { done: 0, total: 0, label: '' }) : null);
  }), [kind, id]);
  return progress;
}

function useTtsStatus(): TtsStatus | null {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  useEffect(() => {
    const off = subscribeTtsStatus(setStatus);
    // The cache is shared between openings and only events update it. Ask once so a balloon
    // opened after a change it never saw — an install started in Settings — is not stale.
    if (currentTtsStatus()) void refreshTtsStatus().catch(() => {});
    return off;
  }, []);
  return status;
}

export function ListenBalloon({ target, anchor, onClose }: { target: ListenTarget; anchor: React.RefObject<HTMLElement>; onClose: () => void }) {
  const player = useAudioPlayer();
  const status = useTtsStatus();
  const progress = useGeneration(target.kind, target.id);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [language, setLanguage] = useState<TtsLanguageSetting>('auto');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  /** The engine install the main process is running, as the `install` events report it. */
  const [install, setInstall] = useState<{ engine: TtsEngine; phase: string; fraction: number } | null>(null);
  /** The model whose download this balloon asked for, before the first byte is announced. */
  const [downloadingModel, setDownloadingModel] = useState('');
  const key = `${target.kind}:${target.id}`;
  const isChat = target.kind === 'chat_message';

  const refreshClips = async () => {
    const next = await window.nodus.listAudioClips(target.kind, target.id).catch(() => []);
    setClips(next);
  };
  useEffect(() => {
    void window.nodus.getSettings().then((next) => { setSettings(next); setLanguage(next.ttsLanguage); });
    void window.nodus.ttsVoices().then(setVoices).catch(() => {});
    void refreshClips();
  }, [target.kind, target.id]);
  // Clips appear as each segment is saved. The finished snapshot is left for other
  // subscribers (the live player waits on it); a later run replaces it.
  useEffect(() => subscribeBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(audioGenerationJobKey(target.kind, target.id), (job) => {
    if (!job) return;
    void refreshClips();
    if (job.status === 'failed' && job.error) setError(ttsErrorMessage(job.error));
  }), [target.kind, target.id]);
  // An install is minutes of pip work: without these events the balloon would look inert
  // until the one status emitted when the whole environment is ready.
  useEffect(() => subscribeTtsEvents((event) => {
    if (event.kind !== 'install') return;
    setInstall(event.phase === 'ready' ? null : { engine: event.engine, phase: event.phase, fraction: event.fraction });
  }), []);

  const modelId = settings?.ttsModelId || status?.models.find((model) => model.downloaded)?.id || status?.models[0]?.id || '';
  const model = TTS_MODELS.find((entry) => entry.id === modelId);
  const phononModel = model?.engine === 'phonon';
  const kokoroModel = model?.engine === 'kokoro';
  const pocketModel = model?.engine === 'pocket';
  const downloadedModels = TTS_MODELS.filter((entry) => status?.models.some((m) => m.id === entry.id && m.downloaded));
  const platformModels = TTS_MODELS.filter((entry) => !status || status.models.some((m) => m.id === entry.id));
  const modelStatus = status?.models.find((entry) => entry.id === modelId);
  const ready = ttsReady(status, modelId);
  const modelEngine: TtsEngine = phononModel ? 'phonon' : kokoroModel ? 'kokoro' : pocketModel ? 'pocket' : 'ming';
  const runtimeState = !status ? undefined
    : modelEngine === 'phonon' ? status.phononRuntime
      : modelEngine === 'kokoro' ? status.kokoroRuntime
        : modelEngine === 'pocket' ? status.pocketRuntime
          : status.runtime;
  const runtimeInstalled = Boolean(runtimeState?.installed);
  const liveInstall = install?.engine === modelEngine ? install : null;
  const installing = Boolean(liveInstall || runtimeState?.installing);
  const installPhase = liveInstall?.phase ?? runtimeState?.phase ?? '';
  const installFraction = liveInstall?.fraction ?? runtimeState?.progress ?? 0;
  const runtimeError = runtimeState?.error;
  // The click starts the transfer in the main process; the first byte is what produces the
  // first `model` event, so until then nothing else would change in this row.
  const downloadStarting = busy === 'download' && downloadingModel === modelId && !modelStatus?.downloading;
  const downloadActive = Boolean(modelStatus?.downloading) || downloadStarting;
  const downloadFraction = Math.round((modelStatus?.progress ?? 0) * 100);
  const engine = status?.engine;
  const engineActive = engine?.state === 'ready' || engine?.state === 'busy';
  const unloadTime = engine?.idleUnloadAt ? new Date(engine.idleUnloadAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // The marker outlives the call so the row keeps saying «Descargando…» until the status
  // catches up with the finished transfer; a failure ends it with `busy` instead.
  useEffect(() => {
    if (downloadingModel && (downloadingModel !== modelId || modelStatus?.downloaded)) setDownloadingModel('');
  }, [downloadingModel, modelId, modelStatus?.downloaded]);

  // A finished install is announced only by its final status: without clearing the marker
  // the row would keep showing the last phase forever.
  const seenStatus = useRef(status);
  useEffect(() => {
    if (seenStatus.current === status) return;
    seenStatus.current = status;
    if (!runtimeState?.installing) setInstall(null);
  }, [status, runtimeState?.installing]);

  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await action(); } catch (cause) { setError(ttsErrorMessage(cause)); }
    finally { setBusy(''); if (name === 'install') setInstall(null); void refreshTtsStatus().catch(() => {}); }
  };

  const playable = useMemo<PlayerTrack[]>(() => clipTracks(clips, target.title), [clips, target.title]);
  const source = { key, title: target.title, open: target.open };
  const listening = player.source?.key === key;
  const playing = listening && player.isPlaying;

  const narrate = () => {
    if (!settings) return;
    setError('');
    const segmentRequest: AudioSegmentRequest = { ...(target.segmentRequest ?? {}), ...(target.markdown ? { markdown: target.markdown(), title: '' } : {}) };
    const input = {
      kind: target.kind, id: target.id, title: target.title, segmentRequest, voiceId: phononModel ? settings.ttsPhononVoiceId : kokoroModel ? settings.ttsKokoroVoiceId : pocketModel ? settings.ttsPocketVoiceId : settings.ttsVoiceId, language,
      labels: { preparing: t('Preparando…'), noText: t('No hay texto narrable en este contenido.') },
    };
    if (settings.ttsStreaming) { startNarration(player, input, source); return; }
    // Without streaming: generate everything in the background, then play the saved clips.
    player.stop();
    const job = startAudioGeneration({ entityKind: target.kind, entityId: target.id, voiceId: input.voiceId, segmentRequest, labels: input.labels }, segmentNarrator(input, null));
    const unsubscribe = subscribeBackgroundJob<AudioGenerationRequest, AudioGenerationProgress, AudioGenerationResult>(audioGenerationJobKey(target.kind, target.id), (next) => {
      if (!next || next.id !== job.id || next.status === 'running') return;
      queueMicrotask(unsubscribe);
      if (next.status === 'completed' && next.result && !next.result.cancelled) {
        void window.nodus.listAudioClips(target.kind, target.id).then((saved) => {
          const tracks = clipTracks(saved, target.title);
          if (tracks.length) player.play(tracks, 0, source);
        });
      }
    });
  };

  const transportPlay = () => {
    if (!playable.length) return;
    if (listening && !playing && player.currentTime > 0 && player.currentTime < totalDuration - 0.05) {
      player.toggle();
      return;
    }
    player.play(playable, 0, source);
  };
  const transportPause = () => { if (playing) player.toggle(); };
  const transportRestart = () => { if (playable.length) player.play(playable, 0, source); };

  const removeClip = async (clip: AudioClip) => {
    if (player.currentTrackId === clip.id) player.stop();
    await window.nodus.deleteAudioClip(clip.id);
    await refreshClips();
  };
  const removeAll = async () => {
    if (listening) player.stop();
    await window.nodus.deleteEntityAudioClips(target.kind, target.id);
    await refreshClips();
  };
  const togglePin = async (clip: AudioClip) => {
    await window.nodus.ttsPinClip(clip.id, !clip.pinned);
    await refreshClips();
  };

  // One picker for every installed engine. Each voice carries the downloaded checkpoint
  // that can speak its language, so choosing a Phonon voice can switch the model too.
  const voiceOptions = voices.flatMap((voice): VoicePickerOption[] => {
    const reference = voice.origin === 'recorded' || voice.origin === 'uploaded' || voice.origin === 'bundled';
    const voiceEngines: TtsEngine[] = reference
      ? ((voice.transcript?.trim().length ?? 0) >= minimumVoiceTranscriptChars(voice.durationS ?? 3) ? ['ming', 'pocket'] : ['pocket'])
      : [voice.origin === 'phonon' ? 'phonon' : voice.origin === 'kokoro' ? 'kokoro' : voice.origin === 'pocket' ? 'pocket' : 'ming'];
    return voiceEngines.flatMap((voiceEngine): VoicePickerOption[] => {
      const candidates = platformModels.filter((entry) => entry.engine === voiceEngine && entry.languages.includes(voice.language));
      if (!candidates.length) return [];
      const candidate = voiceEngine === 'phonon' || voiceEngine === 'kokoro' || voiceEngine === 'pocket'
        ? candidates.find((entry) => entry.id === modelId) ?? candidates.find((entry) => entry.languages.length === 1) ?? candidates[0]
        : candidates.find((entry) => entry.id === modelId) ?? candidates.find((entry) => downloadedModels.some((downloaded) => downloaded.id === entry.id)) ?? candidates[0];
      return [{ voice, engine: voiceEngine, modelId: candidate.id, modelLabel: candidate.label }];
    });
  });
  const selectedVoiceId = phononModel ? settings?.ttsPhononVoiceId ?? '' : kokoroModel ? settings?.ttsKokoroVoiceId ?? '' : pocketModel ? settings?.ttsPocketVoiceId ?? '' : settings?.ttsVoiceId ?? '';
  const selectedVoiceName = voices.find((voice) => voice.id === selectedVoiceId)?.name;
  const chooseVoice = (option: VoicePickerOption) => {
    if (!settings) return;
    const patch = option.engine === 'phonon'
      ? { ttsPhononVoiceId: option.voice.id, ttsModelId: option.modelId }
      : option.engine === 'kokoro'
        ? { ttsKokoroVoiceId: option.voice.id, ttsModelId: option.modelId }
        : option.engine === 'pocket'
          ? { ttsPocketVoiceId: option.voice.id, ttsModelId: option.modelId }
          : { ttsVoiceId: option.voice.id, ttsModelId: option.modelId };
    setSettings({ ...settings, ...patch });
    void window.nodus.updateSettings(patch);
  };
  const retentionDays = settings ? retentionFor(settings, target.kind) : null;
  const generating = progress != null;
  const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSec, 0);

  return (
    <HeaderBalloon open anchor={anchor as React.RefObject<HTMLElement>} onClose={onClose} icon={<Icon name="volume" size={14} />} title={t('Escuchar')} meta={target.title} width={380} testId="listen-balloon">
      <div className="grid gap-3 text-xs">
        {/* Engine */}
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="listen-engine">
          {!status && <span className="text-neutral-500">{t('Comprobando el motor de voz…')}</span>}
          {status && !runtimeInstalled && <div className="grid gap-1.5" data-testid="listen-install">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-600 dark:text-neutral-400">{installing ? t('Instalando el motor de voz…') : t('El motor de voz no está instalado.')}</span>
              {installing
                ? <button type="button" className="btn btn-ghost h-7 px-2 text-[11px]" data-testid="listen-install-cancel" onClick={() => void window.nodus.ttsCancelInstall()}>{t('Cancelar')}</button>
                : <button type="button" className="btn btn-primary h-7 px-2 text-[11px]" data-testid="listen-install-start" disabled={!!busy} onClick={() => void act('install', () => window.nodus.ttsInstallRuntime(modelEngine))}><Icon name="download" size={11} />{t('Instalar')}</button>}
            </div>
            {installing && <>
              <span className="text-[10px] text-neutral-500" data-testid="listen-install-phase">{ttsInstallPhaseLabel(installPhase)}</span>
              <div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(installFraction * 100)}>
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, installFraction * 100)}%` }} />
              </div>
            </>}
            {/* The last install error survives in the engine status; without it a balloon
                reopened after a failed install looked like nothing had ever been attempted. */}
            {runtimeError && !error && <p className="text-[10px] leading-4 text-red-600 dark:text-red-400" role="alert">{ttsErrorMessage(runtimeError)}</p>}
          </div>}
          {runtimeInstalled && modelStatus && !modelStatus.downloaded && <div className="grid gap-1.5" data-testid="listen-model">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-600 dark:text-neutral-400">{downloadActive ? t('Descargando el modelo…') : tx('Falta el modelo {model}', { model: model?.label ?? '' })}</span>
              {!downloadActive && model && (model.gated || model.nonCommercial) && <button type="button" className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => { onClose(); openNarrationSettings('models'); }}>{t('Abrir Ajustes')}</button>}
              {!downloadActive && model && !model.gated && !model.nonCommercial && <button type="button" className="btn btn-primary h-7 w-7 shrink-0 !p-0" title={tx('Descargar · {size}', { size: formatGb(ttsModelBytes(model)) })} aria-label={tx('Descargar · {size}', { size: formatGb(ttsModelBytes(model)) })} disabled={!!busy} onClick={() => {
                setDownloadingModel(model.id);
                void act('download', async () => {
                  await window.nodus.ttsDownloadModel(model.id);
                  if (!settings?.ttsModelId) await window.nodus.updateSettings({ ttsModelId: model.id });
                });
              }}><Icon name="download" size={14} /></button>}
            </div>
            {downloadActive && <div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadFraction}>
              <div className={`h-full bg-indigo-500 transition-all ${downloadStarting ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(3, downloadFraction)}%` }} />
            </div>}
          </div>}
          {ready && <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <span className={`h-2 w-2 rounded-full ${engineActive ? 'bg-emerald-500' : engine?.state === 'loading' || engine?.state === 'starting' ? 'animate-pulse bg-amber-400' : 'bg-neutral-400'}`} />
              {engineActive ? (unloadTime ? tx('Voz activa · se libera de la memoria a las {time}', { time: unloadTime }) : t('Voz activa'))
                : engine?.state === 'loading' || engine?.state === 'starting' ? t('Cargando el modelo…') : t('Voz inactiva (no ocupa memoria)')}
            </span>
            {engineActive
              ? <button className="btn btn-ghost h-7 px-2 text-[11px]" disabled={generating} onClick={() => void act('unload', () => window.nodus.ttsUnload())}>{t('Desactivar')}</button>
              : <button className="btn btn-ghost h-7 px-2 text-[11px]" disabled={!!busy || engine?.state === 'loading'} onClick={() => void act('load', () => window.nodus.ttsLoad())}>{t('Activar')}</button>}
          </div>}
        </div>

        {/* Model, voice and language */}
        {downloadedModels.length > 1 && downloadedModels.some((entry) => entry.id === modelId) && <select className="input h-8 py-0 text-xs" aria-label={t('Modelo')} value={modelId} data-testid="listen-model"
          onChange={(event) => { const next = event.target.value; setSettings(settings ? { ...settings, ttsModelId: next } : settings); void window.nodus.updateSettings({ ttsModelId: next }); }}>
          {downloadedModels.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
          <VoicePicker options={voiceOptions} value={selectedVoiceId} selectedName={selectedVoiceName} onSelect={chooseVoice} model={model} filters={settings?.ttsVoiceFilters ?? {}} onFiltersChange={(ttsVoiceFilters) => {
            if (!settings) return;
            setSettings({ ...settings, ttsVoiceFilters });
            void window.nodus.updateSettings({ ttsVoiceFilters });
          }} disabled={!settings || !voiceOptions.length} />
          <label className="voice-picker-language" title={t('Idioma')}>
            <Icon name="globe" size={13} />
            <select className="voice-picker-language-select" aria-label={t('Idioma')} value={language} onChange={(event) => setLanguage(event.target.value as TtsLanguageSetting)} data-testid="listen-language">
              <option value="auto">{t('Auto')}</option>
              {TTS_LANGUAGES.filter((entry) => phononModel
                ? (PHONON_LANGUAGES as readonly string[]).includes(entry.code)
                : !model || model.languages.includes(entry.code)).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
            </select>
            <Icon name="chevronDown" size={12} />
          </label>
        </div>
        <button className="justify-self-start text-[11px] text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => { onClose(); openNarrationSettings('voices'); }}>
          <Icon name="microphone" size={10} /> {t('Grabar o subir una voz…')}
        </button>

        {/* Generate / listen */}
        {generating
          ? <div className="grid gap-1.5" data-testid="listen-progress">
            <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
              <span className="truncate">{progress.cancelling ? t('Cancelando…') : tx('Generando · parte {n} de {total}', { n: Math.min(progress.done + 1, Math.max(progress.total, 1)), total: Math.max(progress.total, 1) })}</span>
              <button className="btn btn-ghost h-6 px-2 text-[10px]" disabled={progress.cancelling} onClick={() => cancelAudioGeneration(target.kind, target.id)}>{t('Cancelar')}</button>
            </div>
            {listening
              ? <ProgressTrack playedS={player.timeline.playedS} generatedS={player.timeline.generatedS} totalS={player.timeline.totalS} etaS={progress.etaS ?? null} />
              : <ProgressTrack playedS={0} generatedS={progress.done} totalS={Math.max(progress.total, 1)} />}
            {progress.rtf != null && progress.rtf > 1.5 && <p className="text-[10px] text-amber-700 dark:text-amber-400">{t('Este equipo genera más despacio de lo que se escucha: la reproducción puede hacer pausas.')}</p>}
          </div>
          : <div className="flex flex-wrap items-center gap-2">
            <div className="listen-transport" role="group" aria-label={t('Reproducir')}>
              <button type="button" data-primary="true" data-testid="listen-play" disabled={!playable.length || playing} title={`${t('Reproducir')}${totalDuration ? ` · ${formatClock(totalDuration)}` : ''}`} aria-label={t('Reproducir')} onClick={transportPlay}><Icon name="play" size={13} /></button>
              <button type="button" data-testid="listen-pause" disabled={!playing} title={t('Pausar')} aria-label={t('Pausar')} onClick={transportPause}><Icon name="pause" size={13} /></button>
              <button type="button" data-testid="listen-restart" disabled={!playable.length} title={t('Reiniciar')} aria-label={t('Reiniciar')} onClick={transportRestart}><Icon name="rotateCcw" size={13} /></button>
            </div>
            <button className={`btn ${playable.length ? 'btn-ghost' : 'btn-primary'} h-8 px-3 text-xs`} data-testid="listen-generate" disabled={!ready || !settings} onClick={narrate}>
              <Icon name={playable.length ? 'refresh' : 'volume'} size={12} />{playable.length ? t('Regenerar') : settings?.ttsStreaming ? t('Escuchar') : t('Generar audio')}
            </button>
          </div>}

        {/* Saved audios */}
        {clips.length > 0 && <div className="grid gap-1" data-testid="listen-clips">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
            <span>{tx('Audios disponibles ({n})', { n: clips.length })}</span>
            <button className="normal-case text-red-500 hover:underline" onClick={() => setConfirm({ kind: 'all' })}>{t('Eliminar todo')}</button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800">
            {clips.map((clip, index) => <div key={clip.id} className="flex items-center gap-2 border-b border-neutral-200 px-2 py-1 last:border-b-0 dark:border-neutral-800">
              <button className="rounded p-0.5 text-neutral-500 hover:text-indigo-500 disabled:opacity-40" disabled={clip.missing} title={t('Reproducir desde aquí')} onClick={() => player.play(playable, Math.max(0, playable.findIndex((track) => track.id === clip.id)), source)}><Icon name={player.currentTrackId === clip.id && player.isPlaying ? 'waveform' : 'play'} size={11} /></button>
              <span className="min-w-0 flex-1 truncate">{clip.segmentLabel || tx('Parte {n}', { n: index + 1 })}</span>
              <span className="font-mono text-[10px] text-neutral-500">{formatClock(clip.durationSec)}</span>
              <button className={`rounded p-0.5 ${clip.pinned ? 'text-amber-500' : 'text-neutral-400 hover:text-amber-500'}`} title={clip.pinned ? t('Conservado: no se borrará automáticamente') : t('Conservar (no borrar automáticamente)')} aria-pressed={!!clip.pinned} onClick={() => void togglePin(clip)}><Icon name="pin" size={11} /></button>
              <button className="rounded p-0.5 text-neutral-400 hover:text-red-400" title={t('Eliminar')} onClick={() => setConfirm({ kind: 'clip', clip })}><Icon name="trash" size={11} /></button>
            </div>)}
          </div>
          {retentionDays != null && <p className="text-[10px] text-neutral-500">{isChat
            ? tx('Los audios del chat se borran solos a los {days} días salvo que los conserves.', { days: retentionDays })
            : retentionDays === 1
              ? t('Se borran solos al cabo de un día salvo los conservados.')
              : tx('Se borran solos a los {days} días salvo los conservados.', { days: retentionDays })}</p>}
        </div>}

        {error && <p className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300" role="alert">{error}</p>}
      </div>
      {confirm && <div data-balloon-layer>
        <ConfirmModal
          title={confirm.kind === 'all' ? t('Eliminar todos los audios') : t('Eliminar audio')}
          message={confirm.kind === 'all' ? t('Se eliminarán todos los audios generados para este contenido, también los conservados.') : tx('Se eliminará «{label}».', { label: confirm.clip.segmentLabel || target.title })}
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => { const current = confirm; setConfirm(null); void (current.kind === 'all' ? removeAll() : removeClip(current.clip)); }}
          onCancel={() => setConfirm(null)}
        />
      </div>}
    </HeaderBalloon>
  );
}

/** Opens Ajustes on the narration panel: the voice library, or the model list a gated model needs. */
function openNarrationSettings(target: 'voices' | 'models'): void {
  window.dispatchEvent(new CustomEvent('nodus:open-narration-settings', { detail: target }));
}

function retentionFor(settings: AppSettings, kind: AudioEntityKind): number | null {
  const surface = kind === 'chat_message' ? 'research_chat' : kind === 'dictionary_entry' ? 'dictionary' : kind === 'deep_research' ? 'deep_research' : kind === 'immersion' ? 'immersion' : kind === 'scriptor_document' ? 'scriptor' : null;
  return surface ? ttsRetentionDays(sanitizeTtsRetention(settings.ttsRetention), surface) : null;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}
