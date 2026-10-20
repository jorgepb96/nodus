import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, AudioClip, AudioEntityKind, AudioSegmentRequest } from '@shared/types';
import { TTS_LANGUAGES, TTS_MODELS, PHONON_LANGUAGES, sanitizeTtsRetention, ttsModelBytes, ttsRetentionDays, type TtsLanguageSetting, type TtsStatus } from '@shared/ttsModels';
import type { TtsVoice } from '@shared/ttsVoices';
import { HeaderBalloon } from '../HeaderBalloon';
import { ConfirmModal } from '../ConfirmModal';
import { Icon } from '../ui';
import { useAudioPlayer, useOptionalAudioPlayer, type PlayerTrack } from '../AudioPlayer';
import { ProgressTrack, formatClock } from './ProgressTrack';
import {
  audioGenerationJobKey, cancelAudioGeneration, startAudioGeneration, subscribeBackgroundJob,
  type AudioGenerationProgress, type AudioGenerationRequest, type AudioGenerationResult,
} from '../../backgroundJobs';
import { segmentNarrator, startNarration } from '../../lib/narration/narrate';
import { refreshTtsStatus, subscribeTtsStatus, ttsReady } from '../../lib/narration/ttsClient';
import { ttsErrorMessage } from '../../lib/narration/ttsErrors';
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
}

type Confirm = null | { kind: 'clip'; clip: AudioClip } | { kind: 'all' };

export function ListenButton({ target, size = 13, className = '', testId, label }: {
  target: ListenTarget;
  size?: number;
  className?: string;
  testId?: string;
  label?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const player = useOptionalAudioPlayer();
  const key = `${target.kind}:${target.id}`;
  const progress = useGeneration(target.kind, target.id);
  const generating = progress != null;
  const playingHere = player?.source?.key === key && player.isPlaying;
  const fraction = progress && progress.total ? (progress.done + (progress.fragmentsTotal ? (progress.fragmentsDone ?? 0) / progress.fragmentsTotal : 0)) / progress.total : 0;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-testid={testId ?? 'listen-button'}
        className={`relative rounded p-1 transition ${playingHere || generating ? 'text-indigo-500 dark:text-indigo-300' : 'text-neutral-500 opacity-70 hover:opacity-100'} hover:bg-neutral-200/60 dark:hover:bg-neutral-800 ${className}`}
        title={generating ? tx('Generando audio · {pct}%', { pct: Math.round(fraction * 100) }) : playingHere ? t('Reproduciendo') : t('Escuchar')}
        aria-label={label ?? t('Escuchar')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={playingHere ? 'waveform' : 'volume'} size={size} />
        {generating && <ProgressRing fraction={fraction} />}
      </button>
      {open && player && <ListenBalloon target={target} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.6" />
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.03, fraction))} strokeLinecap="round" />
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
  useEffect(() => subscribeTtsStatus(setStatus), []);
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
  const key = `${target.kind}:${target.id}`;
  const isChat = target.kind === 'chat_message';

  const refreshClips = async () => setClips(await window.nodus.listAudioClips(target.kind, target.id).catch(() => []));
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

  const modelId = settings?.ttsModelId || status?.models.find((model) => model.downloaded)?.id || status?.models[0]?.id || '';
  const model = TTS_MODELS.find((entry) => entry.id === modelId);
  const phononModel = model?.engine === 'phonon';
  const downloadedModels = TTS_MODELS.filter((entry) => status?.models.some((m) => m.id === entry.id && m.downloaded));
  const modelStatus = status?.models.find((entry) => entry.id === modelId);
  const ready = ttsReady(status, modelId);
  const runtimeInstalled = phononModel ? status?.phononRuntime.installed : status?.runtime.installed;
  const engine = status?.engine;
  const engineActive = engine?.state === 'ready' || engine?.state === 'busy';
  const unloadTime = engine?.idleUnloadAt ? new Date(engine.idleUnloadAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await action(); } catch (cause) { setError(ttsErrorMessage(cause)); }
    finally { setBusy(''); void refreshTtsStatus().catch(() => {}); }
  };

  const playable = useMemo<PlayerTrack[]>(() => clips.filter((clip) => !clip.missing).map((clip) => ({ id: clip.id, label: clip.segmentLabel || target.title, durationS: clip.durationSec })), [clips, target.title]);
  const source = { key, title: target.title, open: target.open };
  const listening = player.source?.key === key;

  const narrate = () => {
    if (!settings) return;
    setError('');
    const segmentRequest: AudioSegmentRequest = { ...(target.segmentRequest ?? {}), ...(target.markdown ? { markdown: target.markdown(), title: '' } : {}) };
    const input = {
      kind: target.kind, id: target.id, title: target.title, segmentRequest, voiceId: phononModel ? settings.ttsPhononVoiceId : settings.ttsVoiceId, language,
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
          const tracks = saved.filter((clip) => !clip.missing).map((clip) => ({ id: clip.id, label: clip.segmentLabel || target.title, durationS: clip.durationSec }));
          if (tracks.length) player.play(tracks, 0, source);
        });
      }
    });
  };

  const setVoice = (voiceId: string) => {
    if (!settings) return;
    const patch = voiceId.startsWith('phonon:') ? { ttsPhononVoiceId: voiceId } : { ttsVoiceId: voiceId };
    setSettings({ ...settings, ...patch });
    void window.nodus.updateSettings(patch);
  };

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

  const own = voices.filter((voice) => voice.origin === 'recorded' || voice.origin === 'uploaded');
  const bundled = voices.filter((voice) => voice.origin === 'bundled');
  const builtin = voices.filter((voice) => voice.origin === 'builtin');
  const phonon = voices.filter((voice) => voice.origin === 'phonon');
  const retentionDays = settings ? retentionFor(settings, target.kind) : null;
  const generating = progress != null;
  const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSec, 0);

  return (
    <HeaderBalloon open anchor={anchor as React.RefObject<HTMLElement>} onClose={onClose} icon={<Icon name="volume" size={14} />} title={t('Escuchar')} meta={target.title} width={380} testId="listen-balloon">
      <div className="grid gap-3 text-xs">
        {/* Engine */}
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="listen-engine">
          {!status && <span className="text-neutral-500">{t('Comprobando el motor de voz…')}</span>}
          {status && !runtimeInstalled && <div className="flex items-center justify-between gap-2">
            <span className="text-neutral-600 dark:text-neutral-400">{(phononModel ? status.phononRuntime : status.runtime).installing ? t('Instalando el motor de voz…') : t('El motor de voz no está instalado.')}</span>
            {!(phononModel ? status.phononRuntime : status.runtime).installing && <button className="btn btn-primary h-7 px-2 text-[11px]" disabled={!!busy} onClick={() => void act('install', () => window.nodus.ttsInstallRuntime(phononModel ? 'phonon' : 'ming'))}><Icon name="download" size={11} />{t('Instalar')}</button>}
          </div>}
          {runtimeInstalled && modelStatus && !modelStatus.downloaded && <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-600 dark:text-neutral-400">{modelStatus.downloading ? t('Descargando el modelo…') : tx('Falta el modelo {model}', { model: model?.label ?? '' })}</span>
              {!modelStatus.downloading && model && (model.gated || model.nonCommercial) && <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => { onClose(); window.dispatchEvent(new Event('nodus:open-narration-settings')); }}>{t('Abrir Ajustes')}</button>}
              {!modelStatus.downloading && model && !model.gated && !model.nonCommercial && <button className="btn btn-primary h-7 px-2 text-[11px]" onClick={() => void act('download', async () => { await window.nodus.ttsDownloadModel(model.id); if (!settings?.ttsModelId) await window.nodus.updateSettings({ ttsModelId: model.id }); })}><Icon name="download" size={11} />{tx('Descargar · {size}', { size: formatGb(ttsModelBytes(model)) })}</button>}
            </div>
            {modelStatus.downloading && <div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, modelStatus.progress * 100)}%` }} /></div>}
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
        {downloadedModels.length > 1 && <select className="input h-8 py-0 text-xs" aria-label={t('Modelo')} value={modelId} data-testid="listen-model"
          onChange={(event) => { const next = event.target.value; setSettings(settings ? { ...settings, ttsModelId: next } : settings); void window.nodus.updateSettings({ ttsModelId: next }); }}>
          {downloadedModels.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
          {phononModel
            ? <select className="input h-8 w-full min-w-0 py-0 text-xs" aria-label={t('Voz')} value={settings?.ttsPhononVoiceId ?? ''} onChange={(event) => setVoice(event.target.value)} data-testid="listen-voice">
              {TTS_LANGUAGES.filter((entry) => (PHONON_LANGUAGES as readonly string[]).includes(entry.code)).map((entry) => <optgroup key={entry.code} label={entry.label}>
                {phonon.filter((voice) => voice.language === entry.code).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.locale ? ` · ${voice.locale}` : ''}</option>)}
              </optgroup>)}
            </select>
            : <select className="input h-8 w-full min-w-0 py-0 text-xs" aria-label={t('Voz')} value={settings?.ttsVoiceId ?? ''} onChange={(event) => setVoice(event.target.value)} data-testid="listen-voice">
              {own.length > 0 && <optgroup label={t('Mis voces')}>{own.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</optgroup>}
              <optgroup label={t('Castellano (dominio público)')}>{bundled.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</optgroup>
              <optgroup label={t('Integradas de Ming')}>{builtin.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</optgroup>
            </select>}
          <select className="input h-8 min-w-0 py-0 text-xs" aria-label={t('Idioma')} value={language} onChange={(event) => setLanguage(event.target.value as TtsLanguageSetting)} data-testid="listen-language">
            <option value="auto">{t('Auto')}</option>
            {TTS_LANGUAGES.filter((entry) => phononModel
              ? (PHONON_LANGUAGES as readonly string[]).includes(entry.code)
              : !model || model.languages.includes(entry.code)).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
          </select>
        </div>
        <button className="justify-self-start text-[11px] text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => { onClose(); window.dispatchEvent(new Event('nodus:open-narration-settings')); }}>
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
          : <div className="flex flex-wrap gap-2">
            {playable.length > 0 && <button className="btn btn-primary h-8 px-3 text-xs" data-testid="listen-play" onClick={() => player.play(playable, 0, source)}><Icon name="play" size={12} />{tx('Escuchar · {duration}', { duration: formatClock(totalDuration) })}</button>}
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

function retentionFor(settings: AppSettings, kind: AudioEntityKind): number | null {
  const surface = kind === 'chat_message' ? 'research_chat' : kind === 'dictionary_entry' ? 'dictionary' : kind === 'deep_research' ? 'deep_research' : kind === 'immersion' ? 'immersion' : null;
  return surface ? ttsRetentionDays(sanitizeTtsRetention(settings.ttsRetention), surface) : null;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
}
