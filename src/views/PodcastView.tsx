// SPDX-License-Identifier: AGPL-3.0-only
// Podcast — episodes researched in the vault, written as a spoken script for one or two
// hosts and voiced on this machine (Kokoro or Phonon). A gallery of saved episodes, the
// generation lane (with script review), a composer, and a reader with player, chapters,
// a transcript that follows the audio and the sources behind it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, DecorativeImageStyle, ModelRef } from '@shared/types';
import type { TtsStatus } from '@shared/ttsModels';
import type { TtsVoice } from '@shared/ttsVoices';
import {
  PODCAST_AUDIENCES, PODCAST_DURATIONS_MIN, PODCAST_FORMATS, PODCAST_MAX_EXTRA_IMAGES,
  estimatePodcastSeconds, podcastEngineOf, podcastHostCount, podcastPlanningWpm,
  type PodcastAudience, type PodcastDurationMin, type PodcastEpisode, type PodcastEpisodeSummary, type PodcastFormat,
  type PodcastImageInfo, type PodcastJob, type PodcastLanguage, type PodcastPhase, type PodcastRequest, type PodcastScript, type PodcastTurn,
} from '@shared/podcast';
import {
  defaultPodcastVoices, podcastEngineOptions, podcastEnginesFor, podcastHostName, podcastLanguages, podcastVoicesFor,
} from '@shared/podcastVoices';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { wavFromFloat32 } from '@shared/audio/wavEncode';
import type { ResearchEffort } from '@shared/researchReasoning';
import { Icon } from '../components/ui';
import { SectionHeader } from '../components/SectionHeader';
import { ModelPicker } from '../components/ModelPicker';
import { ResearchEffortControl } from '../components/ResearchEffortControl';
import { confirm } from '../components/feedback';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { useResearchEffort } from '../hooks/useResearchEffort';
import { speak, subscribeTtsStatus } from '../lib/narration/ttsClient';
import { useOptionalAudioPlayer, type NarrationClock } from '../components/AudioPlayer';
import { errorText, t, tx } from '../i18n';

const FORMAT_LABELS: Record<PodcastFormat, { label: string; help: string; icon: string }> = {
  conversation: { label: 'Conversación', help: 'Dos voces: una pregunta y otra explica, como una charla.', icon: 'chat' },
  debate: { label: 'Debate', help: 'Dos voces defienden posturas distintas del corpus y buscan una síntesis.', icon: 'scale' },
  lesson: { label: 'Clase', help: 'Explicación didáctica con preguntas de repaso al final. Una o dos voces.', icon: 'graduation' },
  essay: { label: 'Ensayo narrado', help: 'Una voz cuenta el tema con hilo narrativo, como un programa de radio.', icon: 'microphone' },
};

const AUDIENCE_LABELS: Record<PodcastAudience, string> = {
  general: 'Público general',
  university: 'Universitario',
  specialist: 'Especialista',
};

const LANGUAGE_LABELS: Record<PodcastLanguage, string> = { es: 'Español', en: 'English', fr: 'Français', de: 'Deutsch', pt: 'Português' };

const PHASE_LABELS: Record<PodcastPhase, string> = {
  queued: 'En cola',
  researching: 'Investigando en el vault',
  planning: 'Diseñando la escaleta',
  writing: 'Escribiendo el guion',
  reviewing: 'Verificando el guion',
  awaiting_review: 'Guion listo para revisar',
  recording: 'Grabando las voces',
  encoding: 'Comprimiendo el audio',
  images: 'Generando imágenes',
  saving: 'Guardando',
  done: 'Listo',
  failed: 'Error',
  cancelled: 'Cancelado',
};

const SAMPLE_TEXT: Record<PodcastLanguage, string> = {
  es: 'Hola, bienvenidos. Hoy vamos a hablar de un tema apasionante.',
  en: 'Hello and welcome. Today we are talking about a fascinating topic.',
  fr: 'Bonjour et bienvenue. Aujourd’hui, nous parlons d’un sujet passionnant.',
  de: 'Hallo und willkommen. Heute sprechen wir über ein spannendes Thema.',
  pt: 'Olá e bem-vindos. Hoje vamos falar de um tema apaixonante.',
};

/** Error codes the lane can store, in words. */
const ERROR_LABELS: Record<string, string> = {
  PODCAST_NO_SOURCES: 'No se encontraron fuentes sobre este tema en el vault.',
  PODCAST_VAULT_UNSUPPORTED: 'Este tipo de vault aún no admite podcasts.',
  PODCAST_VAULT_CHANGED: 'El vault cambió mientras se generaba el episodio.',
  PODCAST_NO_AUDIO_ENCODER: 'Este equipo no tiene un codificador de audio disponible.',
  PODCAST_NOTHING_RECORDED: 'No se pudo grabar ninguna voz.',
  PODCAST_EMPTY_CHAPTER: 'El modelo no devolvió el guion de un capítulo.',
  TTS_RUNTIME_NOT_INSTALLED: 'El motor de voz no está instalado. Instálalo en Ajustes → Narración.',
  TTS_MODEL_NOT_DOWNLOADED: 'El modelo de voz no está descargado. Descárgalo en Ajustes → Narración.',
  TTS_MODEL_UNAVAILABLE: 'El modelo de voz no está disponible en este equipo.',
};

function podcastError(code: string | undefined): string {
  if (!code) return '';
  const key = Object.keys(ERROR_LABELS).find((known) => code.includes(known));
  return key ? t(ERROR_LABELS[key]) : errorText(code);
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function jobPercent(job: PodcastJob): number {
  const part = job.total ? Math.min(1, (job.done ?? 0) / job.total) : 0;
  switch (job.phase) {
    case 'researching': return 8;
    case 'planning': return 18;
    case 'writing': return 20 + part * 28;
    case 'reviewing': return 50;
    case 'awaiting_review': return 52;
    case 'recording': return 52 + part * 38;
    case 'encoding': return 90 + part * 8;
    case 'saving': case 'images': return 99;
    case 'done': return 100;
    default: return 0;
  }
}

const audioUrl = (episodeId: string) => `nodus-audio://podcast/${encodeURIComponent(episodeId)}`;

// ── Cover thumbnails ──────────────────────────────────────────────────────────

function useImageData(episodeId: string | null, slot: number | null, variant: 'image' | 'thumbnail', version: number): string | null {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (!episodeId || slot == null) return;
    void window.nodus.podcastImageData(episodeId, slot, variant).then((url) => { if (alive) setData(url); }).catch(() => {});
    return () => { alive = false; };
  }, [episodeId, slot, variant, version]);
  return data;
}

function CoverArt({ episodeId, hasImages, version, className }: { episodeId: string; hasImages: boolean; version: number; className?: string }) {
  const data = useImageData(hasImages ? episodeId : null, 0, 'thumbnail', version);
  return (
    <div className={`flex items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500/30 via-fuchsia-500/20 to-amber-400/20 ${className ?? ''}`}>
      {data ? <img src={data} alt="" className="h-full w-full object-cover" /> : <Icon name="headphones" size={28} className="text-indigo-300/80" />}
    </div>
  );
}

// ── Voice engines guide ───────────────────────────────────────────────────────

const ENGINE_GUIDE = [
  { name: 'Kokoro', help: 'Ligero y rápido, funciona en cualquier equipo. Voces en español e inglés. Licencia libre.' },
  { name: 'Phonon', help: 'Muy natural en español, inglés, francés, alemán y portugués, con decenas de voces. Los modelos en español y multilingüe son de uso no comercial.' },
  { name: 'Ming', help: 'La voz más expresiva, también excelente en español, y la única que admite voces clonadas. Necesita más memoria y es más lento.' },
] as const;

const openNarrationModels = () => window.dispatchEvent(new CustomEvent('nodus:open-narration-settings', { detail: 'models' }));

function EngineGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100" data-testid="podcast-no-engine">
      <p className="font-medium">{t('Para grabar podcasts necesitas al menos un motor de voz instalado y con su modelo descargado.')}</p>
      {!compact && (
        <ul className="mt-2 space-y-1 text-[13px]">
          {ENGINE_GUIDE.map((engine) => (
            <li key={engine.name}><span className="font-semibold">{engine.name}</span> · {t(engine.help)}</li>
          ))}
        </ul>
      )}
      <button className="btn btn-primary mt-3 gap-1.5 !py-1.5 text-xs" onClick={openNarrationModels} data-testid="podcast-open-voice-settings">
        <Icon name="settings" size={13} /> {t('Abrir Ajustes → Narración')}
      </button>
    </div>
  );
}

function BetaBadge() {
  return <span className="rounded-full border border-amber-400/70 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-500/50 dark:bg-amber-900/40 dark:text-amber-200" data-testid="podcast-beta">{t('Beta')}</span>;
}

// ── View ──────────────────────────────────────────────────────────────────────

export function PodcastView({ settings, isAcademic, onOpenView }: { settings: AppSettings; isAcademic: boolean; onOpenView?: () => void }) {
  const [episodes, setEpisodes] = useState<PodcastEpisodeSummary[]>([]);
  const [jobs, setJobs] = useState<PodcastJob[]>([]);
  const [openId, setOpenId] = useState<string | null>(() => { const id = requestedEpisode; requestedEpisode = null; return id; });
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  useEffect(() => subscribeTtsStatus(setTtsStatus), []);
  useEffect(() => {
    const open = (event: Event) => { requestedEpisode = null; setOpenId((event as CustomEvent<string>).detail); };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  const noEngine = ttsStatus !== null && podcastEngineOptions(ttsStatus).length === 0;
  const [composerOpen, setComposerOpen] = useState(false);
  const [reviewJob, setReviewJob] = useState<PodcastJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [search, setSearch] = useState('');

  const refreshEpisodes = useCallback(async () => {
    try { setEpisodes(await window.nodus.podcastEpisodes()); } catch (err) { setError(errorText(err)); }
  }, []);

  useEffect(() => {
    void refreshEpisodes();
    void window.nodus.podcastQueueList().then(setJobs).catch(() => {});
    const offQueue = window.nodus.onPodcastQueue(setJobs);
    const offChanged = window.nodus.onPodcastChanged(() => { void refreshEpisodes(); setImageVersion((value) => value + 1); });
    return () => { offQueue(); offChanged(); };
  }, [refreshEpisodes]);

  // A job that finishes adds an episode; refresh once per newly finished job.
  const finishedIds = useMemo(() => jobs.filter((job) => job.status === 'done').map((job) => job.id).join(','), [jobs]);
  useEffect(() => { if (finishedIds) void refreshEpisodes(); }, [finishedIds, refreshEpisodes]);

  const visibleJobs = jobs.filter((job) => job.status !== 'done' && job.status !== 'cancelled');
  const filtered = episodes.filter((episode) => !search.trim() || `${episode.title} ${episode.objective}`.toLowerCase().includes(search.trim().toLowerCase()));

  if (openId) {
    return (
      <EpisodeReader
        episodeId={openId}
        imageVersion={imageVersion}
        onBack={() => { setOpenId(null); void refreshEpisodes(); }}
        onDeleted={() => { setOpenId(null); void refreshEpisodes(); }}
        onOpenView={onOpenView}
      />
    );
  }

  return (
    <div className="theme-workspace-surface flex h-full min-h-0 flex-col" data-testid="podcast-view">
      <SectionHeader
        icon="headphones"
        title={t('Podcast')}
        badge={<BetaBadge />}
        subtitle={t('Episodios investigados en tu vault y grabados con voces locales.')}
        actions={(
          <button data-testid="podcast-new" className="btn btn-primary gap-1.5" onClick={() => setComposerOpen(true)}>
            <Icon name="plus" /> {t('Nuevo episodio')}
          </button>
        )}
      />
      <p className="border-b border-amber-200/60 bg-amber-50/60 px-4 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200/90" data-testid="podcast-beta-note">
        {t('Podcast está en fase beta: el guion, la duración y las voces pueden no salir perfectos. Revisa el guion antes de grabar si vas a publicarlo.')}
      </p>
      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {noEngine && <div className="border-b border-neutral-200 p-4 dark:border-neutral-800"><EngineGuide /></div>}
      {visibleJobs.length > 0 && (
        <PodcastQueueStrip
          jobs={visibleJobs}
          onReview={setReviewJob}
          onCancel={async (job) => {
            const ok = job.status !== 'running' || await confirm({ title: t('Cancelar episodio'), message: t('Se detendrá la generación de este episodio.'), confirmLabel: t('Cancelar episodio'), danger: true });
            if (ok) await window.nodus.podcastCancel(job.id).catch((err) => setError(errorText(err)));
          }}
          onRetry={(job) => { void window.nodus.podcastRetry(job.id).catch((err) => setError(errorText(err))); }}
          onClear={() => { void window.nodus.podcastClearFinished(); }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <div className="relative min-w-[14rem] max-w-md flex-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input className="input input-with-leading-icon w-full !py-1.5 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar episodios')} aria-label={t('Buscar episodios')} />
        </div>
        <span className="text-xs text-neutral-500">{tx('{n} episodios', { n: episodes.length })}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-neutral-500" data-testid="podcast-empty">
            <Icon name="headphones" size={32} className="mx-auto mb-3 text-neutral-400" />
            <p className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">{episodes.length ? t('Ningún episodio coincide con la búsqueda.') : t('Aún no hay episodios')}</p>
            {!episodes.length && <p>{t('Elige un tema, el formato, las voces y la duración. Nodus investiga en tu vault, escribe el guion y lo graba en este equipo.')}</p>}
            {!episodes.length && !noEngine && <button className="btn btn-ghost mt-3 gap-1 border border-neutral-300 text-xs dark:border-neutral-700" onClick={openNarrationModels}><Icon name="settings" size={12} /> {t('Gestionar voces y motores')}</button>}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" data-testid="podcast-gallery">
            {filtered.map((episode) => (
              <div key={episode.id} className="relative">
              <button
                className="group flex w-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900/60"
                onClick={() => setOpenId(episode.id)}
                data-testid="podcast-card"
              >
                <CoverArt episodeId={episode.id} hasImages={episode.imageCount > 0} version={imageVersion} className="aspect-square w-full" />
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <span className="line-clamp-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{episode.title}</span>
                  <span className="text-[11px] text-neutral-500">
                    {t(FORMAT_LABELS[episode.format]?.label ?? episode.format)} · {clock(episode.durationS)} · {LANGUAGE_LABELS[episode.language] ?? episode.language}
                  </span>
                  <span className="truncate text-[11px] text-neutral-500">{episode.hosts.map((host) => host.name).join(' · ')}</span>
                  {episode.listenedPositionS > 0 && (
                    <span className="mt-auto block h-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                      <span className="block h-full bg-indigo-500" style={{ width: `${Math.min(100, (episode.listenedPositionS / Math.max(1, episode.durationS)) * 100)}%` }} />
                    </span>
                  )}
                </div>
              </button>
              <button
                className="absolute right-2 top-2 rounded-full bg-black/55 p-2 text-white backdrop-blur transition hover:bg-black/75"
                onClick={() => { void window.nodus.podcastExportAudio(episode.id).catch((err) => setError(podcastError(errorText(err)))); }}
                aria-label={t('Descargar audio')}
                title={t('Descargar audio')}
                data-testid="podcast-card-download"
              >
                <Icon name="download" size={14} />
              </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {composerOpen && (
        <PodcastComposer
          settings={settings}
          isAcademic={isAcademic}
          queued={visibleJobs.filter((job) => job.status === 'queued' || job.status === 'running').length}
          onClose={() => setComposerOpen(false)}
          onSubmit={async (request) => {
            await window.nodus.podcastEnqueue(request);
            setComposerOpen(false);
          }}
        />
      )}
      {reviewJob && (
        <ScriptEditor
          job={jobs.find((job) => job.id === reviewJob.id) ?? reviewJob}
          onClose={() => setReviewJob(null)}
        />
      )}
    </div>
  );
}

// ── Queue strip ───────────────────────────────────────────────────────────────

function PodcastQueueStrip({ jobs, onReview, onCancel, onRetry, onClear }: {
  jobs: PodcastJob[];
  onReview: (job: PodcastJob) => void;
  onCancel: (job: PodcastJob) => void;
  onRetry: (job: PodcastJob) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1.5 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950/40" data-testid="podcast-queue">
      {jobs.map((job) => {
        const percent = jobPercent(job);
        const detail = job.phase === 'recording' && job.estimatedS
          ? tx('{done} de ~{total} grabados', { done: clock(job.recordedS ?? 0), total: clock(job.estimatedS) })
          : job.phase === 'writing' && job.total
            ? tx('Capítulo {n} de {total}', { n: Math.min(job.total, (job.done ?? 0) + 1), total: job.total })
            : null;
        return (
          <div key={job.id} className="flex items-center gap-3 text-sm" data-testid="podcast-queue-row">
            <Icon name={job.status === 'failed' ? 'alert' : job.status === 'awaiting_review' ? 'edit' : 'headphones'} size={14} className={job.status === 'failed' ? 'text-red-500' : 'text-indigo-400'} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">{job.title || job.request.objective}</span>
                <span className="shrink-0 text-[11px] text-neutral-500">{t(PHASE_LABELS[job.phase] ?? job.phase)}{detail ? ` · ${detail}` : ''}</span>
              </div>
              {job.status === 'failed' ? (
                <p className="truncate text-[11px] text-red-600 dark:text-red-300">{podcastError(job.error)}</p>
              ) : (
                <div className="mt-1 h-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                  <div className={`h-full transition-all ${job.status === 'queued' ? 'bg-neutral-400' : 'bg-indigo-500'}`} style={{ width: `${job.status === 'queued' ? 2 : percent}%` }} />
                </div>
              )}
            </div>
            {job.status === 'awaiting_review' && (
              <button className="btn btn-primary !py-1 text-xs" onClick={() => onReview(job)} data-testid="podcast-review">{t('Revisar guion')}</button>
            )}
            {job.status === 'failed' && (
              <button className="btn btn-ghost border border-neutral-300 !py-1 text-xs dark:border-neutral-700" onClick={() => onRetry(job)}>{t('Reintentar')}</button>
            )}
            <button className="btn btn-ghost px-1.5 !py-1" onClick={() => onCancel(job)} aria-label={t('Quitar de la cola')} title={t('Quitar de la cola')}>
              <Icon name="x" size={13} />
            </button>
          </div>
        );
      })}
      {jobs.some((job) => job.status === 'failed') && (
        <button className="text-[11px] text-neutral-500 underline-offset-2 hover:underline" onClick={onClear}>{t('Limpiar terminados')}</button>
      )}
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      {children}
      {help && <span className="mt-1 block text-[11px] leading-4 text-neutral-500">{help}</span>}
    </label>
  );
}

function PodcastComposer({ settings, isAcademic, queued, onClose, onSubmit }: {
  settings: AppSettings;
  isAcademic: boolean;
  queued: number;
  onClose: () => void;
  onSubmit: (request: PodcastRequest) => Promise<void>;
}) {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [objective, setObjective] = useState('');
  const [format, setFormat] = useState<PodcastFormat>('conversation');
  const [lessonHosts, setLessonHosts] = useState<1 | 2>(1);
  const [language, setLanguage] = useState<PodcastLanguage | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [voiceIds, setVoiceIds] = useState<string[]>([]);
  const [names, setNames] = useState<string[]>(['', '']);
  const [audience, setAudience] = useState<PodcastAudience>('general');
  const [duration, setDuration] = useState<PodcastDurationMin>(10);
  const [model, setModel] = useFeatureModel(settings, 'deepResearchModel');
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, model);
  const [webSearch, setWebSearch] = useState(false);
  const [cover, setCover] = useState(true);
  const [extraImages, setExtraImages] = useState(0);
  const [imageStyle, setImageStyle] = useState<DecorativeImageStyle>('contemporary_editorial');
  const [reviewScript, setReviewScript] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sampling, setSampling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeTtsStatus(setStatus), []);
  useEffect(() => { void window.nodus.ttsVoices().then(setVoices).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const engines = useMemo(() => podcastEngineOptions(status), [status]);
  const languages = useMemo(() => podcastLanguages(engines), [engines]);
  const activeLanguage: PodcastLanguage | null = language && languages.includes(language) ? language : (languages.includes('es') ? 'es' : languages[0] ?? null);
  const enginesForLanguage = useMemo(() => (activeLanguage ? podcastEnginesFor(engines, activeLanguage) : []), [engines, activeLanguage]);
  const engine = enginesForLanguage.find((option) => option.modelId === modelId) ?? enginesForLanguage[0] ?? null;
  const voiceOptions = useMemo(() => (engine && activeLanguage ? podcastVoicesFor(voices, engine.engine, activeLanguage) : []), [voices, engine, activeLanguage]);
  const hostCount = podcastHostCount(format, lessonHosts);

  // Keep the chosen voices valid for the engine, language and number of hosts.
  useEffect(() => {
    const valid = voiceIds.filter((id) => voiceOptions.some((voice) => voice.id === id)).slice(0, hostCount);
    if (valid.length === hostCount && valid.length === voiceIds.length) return;
    const defaults = defaultPodcastVoices(voiceOptions, hostCount).map((voice) => voice.id);
    const next = [...valid];
    for (const id of defaults) if (next.length < hostCount && !next.includes(id)) next.push(id);
    // Only a real change: with no voice available `next` is a fresh empty array on every run,
    // and setting it unconditionally re-rendered forever.
    if (next.length !== voiceIds.length || next.some((id, index) => id !== voiceIds[index])) setVoiceIds(next);
  }, [voiceOptions, hostCount, voiceIds]);

  const hostName = (index: number) => names[index]?.trim() || (voiceOptions.find((voice) => voice.id === voiceIds[index]) ? podcastHostName(voiceOptions.find((voice) => voice.id === voiceIds[index])!) : index === 0 ? 'A' : 'B');

  const sample = async (voiceId: string) => {
    if (!engine || !activeLanguage) return;
    setSampling(voiceId);
    setError(null);
    try {
      const played: HTMLAudioElement[] = [];
      const handle = await speak({ text: SAMPLE_TEXT[activeLanguage], voiceId, modelId: engine.modelId, priority: 10 }, {
        onFragment: (fragment) => {
          const audio = new Audio(fragment.url);
          played.push(audio);
          const previous = played[played.length - 2];
          if (previous && !previous.ended) previous.addEventListener('ended', () => { void audio.play(); }, { once: true });
          else void audio.play();
        },
      });
      await handle.done;
    } catch (err) {
      setError(podcastError(err instanceof Error ? err.message : String(err)));
    } finally {
      setSampling(null);
    }
  };

  const ready = Boolean(objective.trim() && engine && activeLanguage && voiceIds.length === hostCount && model);
  const submit = async () => {
    if (!ready || !engine || !activeLanguage) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        objective: objective.trim(),
        format,
        language: activeLanguage,
        ttsModelId: engine.modelId,
        hosts: voiceIds.map((voiceId, index) => ({ speaker: index === 0 ? 'A' : 'B', voiceId, name: hostName(index) })),
        audience,
        durationCapMin: duration,
        model: model as ModelRef | null,
        thinkingEffort: thinkingEffort as ResearchEffort,
        webSearch: isAcademic && webSearch ? 'auto' : 'off',
        cover,
        extraImages,
        imageStyle,
        reviewScript,
      });
    } catch (err) {
      setError(podcastError(err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const noEngine = status !== null && engines.length === 0;
  const imageReady = Boolean(settings.imageProvider && settings.imageModel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Nuevo episodio')}
        data-testid="podcast-composer"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="headphones" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Nuevo episodio')} <BetaBadge /></h2>
            <p className="text-xs text-neutral-500">{t('Nodus investiga el tema en tu vault, escribe el guion y lo graba con voces locales.')}</p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {noEngine && <EngineGuide />}
          <textarea
            className="input min-h-24 w-full resize-y"
            value={objective}
            autoFocus
            onChange={(event) => setObjective(event.target.value)}
            placeholder={t('¿De qué trata el episodio? Por ejemplo: cómo explica Halbwachs la memoria colectiva y qué discusiones ha generado.')}
            data-testid="podcast-objective"
          />
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1" role="radiogroup" aria-label={t('Formato')}>
            {PODCAST_FORMATS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={format === id}
                onClick={() => setFormat(id)}
                className={`rounded-lg border p-2.5 text-left ${format === id ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-950/40' : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600'}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100"><Icon name={FORMAT_LABELS[id].icon} size={14} /> {t(FORMAT_LABELS[id].label)}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500">{t(FORMAT_LABELS[id].help)}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 items-start gap-2 max-sm:grid-cols-1">
            <Field label={t('Idioma')}>
              <select className="input w-full text-sm" value={activeLanguage ?? ''} onChange={(event) => setLanguage(event.target.value as PodcastLanguage)} disabled={!languages.length} data-testid="podcast-language">
                {languages.map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
              </select>
            </Field>
            <Field
              label={t('Motor de voz')}
              help={engine?.nonCommercial ? <span className="text-amber-600 dark:text-amber-400">{t('Licencia no comercial: no lo uses para publicar con fines comerciales.')}</span> : undefined}
            >
              <select className="input w-full text-sm" value={engine?.modelId ?? ''} onChange={(event) => setModelId(event.target.value)} disabled={!enginesForLanguage.length} data-testid="podcast-engine">
                {enginesForLanguage.map((option) => <option key={option.modelId} value={option.modelId}>{option.label}</option>)}
              </select>
            </Field>
            {format === 'lesson' && (
              <Field label={t('Voces')}>
                <select className="input w-full text-sm" value={lessonHosts} onChange={(event) => setLessonHosts(event.target.value === '2' ? 2 : 1)}>
                  <option value="1">{t('Una voz')}</option>
                  <option value="2">{t('Dos voces (docente y estudiante)')}</option>
                </select>
              </Field>
            )}
          </div>
          <div className="space-y-2" data-testid="podcast-voices">
            {Array.from({ length: hostCount }, (_, index) => (
              <div key={index} className="grid grid-cols-[1fr_9rem_auto] items-end gap-2 max-sm:grid-cols-1">
                <Field label={hostCount === 2 ? tx('Voz {n}', { n: index + 1 }) : t('Voz')}>
                  <select
                    className="input w-full text-sm"
                    value={voiceIds[index] ?? ''}
                    onChange={(event) => setVoiceIds((current) => { const next = [...current]; next[index] = event.target.value; return next; })}
                    disabled={!voiceOptions.length}
                  >
                    {voiceOptions.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}{voice.locale && voice.locale !== activeLanguage ? ` · ${voice.locale}` : ''}{voice.gender === 'female' ? ` · ${t('mujer')}` : voice.gender === 'male' ? ` · ${t('hombre')}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Nombre en el guion')}>
                  <input className="input w-full text-sm" value={names[index] ?? ''} placeholder={hostName(index)} onChange={(event) => setNames((current) => { const next = [...current]; next[index] = event.target.value; return next; })} />
                </Field>
                <button className="btn btn-ghost mb-px gap-1 border border-neutral-300 !py-2 text-xs dark:border-neutral-700" disabled={!voiceIds[index] || sampling !== null} onClick={() => void sample(voiceIds[index])}>
                  <Icon name={sampling === voiceIds[index] ? 'volume' : 'play'} size={12} /> {t('Muestra')}
                </button>
              </div>
            ))}
            {hostCount === 2 && voiceIds[0] && voiceIds[0] === voiceIds[1] && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('Las dos voces son la misma: costará distinguir a los presentadores.')}</p>}
          </div>
          <div className="grid grid-cols-2 items-start gap-2 max-sm:grid-cols-1">
            <Field label={t('Duración máxima')}>
              <select className="input w-full text-sm" value={duration} onChange={(event) => setDuration(Number(event.target.value) as PodcastDurationMin)} data-testid="podcast-duration">
                {PODCAST_DURATIONS_MIN.map((minutes) => <option key={minutes} value={minutes}>{tx('{n} minutos', { n: minutes })}</option>)}
              </select>
            </Field>
            <Field label={t('Público')}>
              <select className="input w-full text-sm" value={audience} onChange={(event) => setAudience(event.target.value as PodcastAudience)}>
                {PODCAST_AUDIENCES.map((id) => <option key={id} value={id}>{t(AUDIENCE_LABELS[id])}</option>)}
              </select>
            </Field>
            <Field label={t('Modelo')}>
              <ModelPicker settings={settings} value={model} onChange={setModel} ariaLabel={t('Modelo')} className="w-full text-sm" menu />
            </Field>
            <ResearchEffortControl variant="field" label className="w-full !py-2 text-sm" testId="podcast-thinking" model={model ?? null} value={thinkingEffort} onChange={setThinkingEffort} disabled={!model} />
          </div>
          {isAcademic && (
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />
              {t('Completar con búsqueda web si el vault no basta')}
            </label>
          )}
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-700 dark:text-neutral-300">
              <label className="flex items-center gap-2"><input type="checkbox" checked={cover} onChange={(event) => setCover(event.target.checked)} /> {t('Portada')}</label>
              <label className="flex items-center gap-2">
                {t('Imágenes por capítulos')}
                <select className="input !py-1 text-xs" value={extraImages} onChange={(event) => setExtraImages(Number(event.target.value))}>
                  {Array.from({ length: PODCAST_MAX_EXTRA_IMAGES + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {(cover || extraImages > 0) && (
                <select className="input !py-1 text-xs" value={imageStyle} onChange={(event) => setImageStyle(event.target.value as DecorativeImageStyle)} aria-label={t('Estilo')}>
                  {DECORATIVE_IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
                </select>
              )}
            </div>
            {(cover || extraImages > 0) && !imageReady && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('Configura un proveedor de imágenes en Ajustes → Proveedores para generarlas.')}</p>}
            <p className="text-[11px] text-neutral-500">{t('Las imágenes de capítulo cambian en el reproductor mientras suena cada parte.')}</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" className="mt-0.5" checked={reviewScript} onChange={(event) => setReviewScript(event.target.checked)} data-testid="podcast-review-toggle" />
            <span>
              {t('Revisar guion antes de grabar')}
              <span className="block text-[11px] text-neutral-500">{t('El episodio se detiene con el guion listo; lo editas y pulsas Grabar.')}</span>
            </span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <p className="text-[11px] text-neutral-500">
            {queued > 0 ? tx('Se añadirá a la cola ({n} en curso) y se generará cuando termine el anterior.', { n: queued }) : t('Se genera en segundo plano: puedes cerrar esto y seguir trabajando.')}
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary gap-1.5" onClick={() => void submit()} disabled={!ready || submitting} data-testid="podcast-submit" title={!model ? t('Configura un modelo de síntesis') : undefined}>
            <Icon name="plus" /> {t('Añadir a la cola')}
          </button>
        </footer>
      </section>
    </div>
  );
}

// ── Script editor ─────────────────────────────────────────────────────────────

function ScriptEditor({ job, onClose }: { job: PodcastJob; onClose: () => void }) {
  const plan = job.checkpoint?.plan;
  const [turns, setTurns] = useState<PodcastTurn[]>(() => job.checkpoint?.script?.turns ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hosts = job.request.hosts;
  const script: PodcastScript = { turns };
  // The engine's own pace; the lane refines it with what this machine measured.
  const estimate = estimatePodcastSeconds(script, podcastPlanningWpm(podcastEngineOf(hosts[0]?.voiceId ?? ''), null));
  const cap = job.request.durationCapMin * 60;

  const update = (index: number, patch: Partial<PodcastTurn>) => setTurns((current) => current.map((turn, at) => (at === index ? { ...turn, ...patch } : turn)));
  const move = (index: number, delta: number) => setTurns((current) => {
    const next = [...current];
    const target = index + delta;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    if (next[index].chapterIndex !== next[target].chapterIndex) {
      const chapter = next[target].chapterIndex;
      next[target] = { ...next[target], chapterIndex: next[index].chapterIndex };
      next[index] = { ...next[index], chapterIndex: chapter };
    }
    return next;
  });
  const insertAfter = (index: number) => setTurns((current) => {
    const base = current[index];
    const speaker = hosts.length > 1 && base?.speaker === 'A' ? 'B' : 'A';
    const turn: PodcastTurn = { id: `new-${Date.now()}`, chapterIndex: base?.chapterIndex ?? 0, speaker, text: '', sourceIds: [] };
    return [...current.slice(0, index + 1), turn, ...current.slice(index + 1)];
  });

  const save = async (record: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await window.nodus.podcastUpdateScript(job.id, { turns: turns.filter((turn) => turn.text.trim()) });
      if (record) await window.nodus.podcastApproveScript(job.id);
      onClose();
    } catch (err) {
      setError(podcastError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  let chapter = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={t('Revisar guion')} data-testid="podcast-script-editor" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="edit" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{plan?.title ?? job.request.objective}</h2>
            <p className={`text-xs ${estimate > cap ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500'}`}>
              {tx('Duración estimada: {estimate} de {cap} como máximo', { estimate: clock(estimate), cap: clock(cap) })}
            </p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {turns.map((turn, index) => {
            const heading = turn.chapterIndex !== chapter ? plan?.chapters[turn.chapterIndex]?.title ?? tx('Capítulo {n}', { n: turn.chapterIndex + 1 }) : null;
            chapter = turn.chapterIndex;
            return (
              <div key={turn.id}>
                {heading && <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-indigo-500">{heading}</h3>}
                <div className="flex items-start gap-2">
                  {hosts.length > 1 ? (
                    <select className="input w-28 shrink-0 !py-1 text-xs" value={turn.speaker} onChange={(event) => update(index, { speaker: event.target.value === 'B' ? 'B' : 'A' })} aria-label={t('Voz')}>
                      {hosts.map((host) => <option key={host.speaker} value={host.speaker}>{host.name}</option>)}
                    </select>
                  ) : <span className="w-2" />}
                  <textarea className="input flex-1 resize-y text-sm leading-relaxed" rows={Math.min(12, Math.max(2, Math.ceil(turn.text.length / 80) + 1))} value={turn.text} onChange={(event) => update(index, { text: event.target.value })} />
                  <div className="flex shrink-0 flex-col">
                    <button className="btn btn-ghost px-1 !py-0.5" onClick={() => move(index, -1)} aria-label={t('Subir')} title={t('Subir')}><Icon name="chevronUp" size={12} /></button>
                    <button className="btn btn-ghost px-1 !py-0.5" onClick={() => move(index, 1)} aria-label={t('Bajar')} title={t('Bajar')}><Icon name="chevronDown" size={12} /></button>
                    <button className="btn btn-ghost px-1 !py-0.5" onClick={() => insertAfter(index)} aria-label={t('Añadir intervención')} title={t('Añadir intervención')}><Icon name="plus" size={12} /></button>
                    <button className="btn btn-ghost px-1 !py-0.5 text-red-500" onClick={() => setTurns((current) => current.filter((_, at) => at !== index))} aria-label={t('Eliminar')} title={t('Eliminar')}><Icon name="trash" size={12} /></button>
                  </div>
                </div>
              </div>
            );
          })}
          {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void save(false)} disabled={busy}>{t('Guardar cambios')}</button>
          <button className="btn btn-primary gap-1.5" onClick={() => void save(true)} disabled={busy || !turns.some((turn) => turn.text.trim())} data-testid="podcast-record">
            <Icon name="microphone" /> {t('Grabar')}
          </button>
        </footer>
      </section>
    </div>
  );
}

// ── Reader ────────────────────────────────────────────────────────────────────

const RATES = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];

const podcastSourceKey = (episodeId: string) => `podcast:${episodeId}`;

/**
 * Where listening stopped is saved by a timer that belongs to the app-wide player, not to this
 * view: the episode keeps playing (header sound balloon) after the user leaves Podcast, and its
 * place must still be remembered. The timer stops by itself once something else plays.
 */
let positionTimer: ReturnType<typeof setInterval> | null = null;
function rememberPosition(clock: NarrationClock, episodeId: string): void {
  if (positionTimer) clearInterval(positionTimer);
  let last = -1;
  const save = () => {
    if (clock.source()?.key !== podcastSourceKey(episodeId)) {
      if (positionTimer) clearInterval(positionTimer);
      positionTimer = null;
      return;
    }
    const time = clock.playhead()?.time ?? 0;
    if (Math.abs(time - last) < 1) return;
    last = time;
    void window.nodus.podcastSetPosition(episodeId, time).catch(() => {});
  };
  positionTimer = setInterval(save, 5_000);
}

/** Set by the header player's "go to content" link, read by the Podcast view when it mounts. */
let requestedEpisode: string | null = null;
const OPEN_EVENT = 'nodus:podcast-open';

function EpisodeReader({ episodeId, imageVersion, onBack, onDeleted, onOpenView }: { episodeId: string; imageVersion: number; onBack: () => void; onDeleted: () => void; onOpenView?: () => void }) {
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null);
  const [images, setImages] = useState<PodcastImageInfo[]>([]);
  const [tab, setTab] = useState<'transcript' | 'chapters' | 'sources'>('transcript');
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const player = useOptionalAudioPlayer();

  useEffect(() => {
    let alive = true;
    void window.nodus.podcastEpisode(episodeId).then((value) => { if (alive) setEpisode(value); }).catch((err) => setError(errorText(err)));
    return () => { alive = false; };
  }, [episodeId]);
  useEffect(() => {
    void window.nodus.podcastImages(episodeId).then(setImages).catch(() => {});
  }, [episodeId, imageVersion]);

  // The app-wide player is the only one: playback survives leaving this view.
  const mine = Boolean(player && player.source?.key === podcastSourceKey(episodeId));
  const time = mine && player ? player.currentTime : episode?.listenedPositionS ?? 0;
  const playing = mine && Boolean(player?.isPlaying);
  const rate = player?.rate ?? 1;

  const timings = episode?.timeline.turns ?? [];
  const activeTurnId = useMemo(() => {
    let found: string | null = null;
    for (const turn of timings) { if (turn.startS <= time + 0.05) found = turn.turnId; else break; }
    return found;
  }, [timings, time]);
  const chapters = episode?.timeline.chapters ?? [];
  const activeChapter = useMemo(() => {
    let found = 0;
    for (const chapter of chapters) if (chapter.startS <= time + 0.05) found = chapter.index;
    return found;
  }, [chapters, time]);
  const chapterImage = images.find((image) => image.status === 'ready' && image.chapterIndex === activeChapter) ?? images.find((image) => image.status === 'ready' && image.slot === 0) ?? null;
  const imageData = useImageData(chapterImage ? episodeId : null, chapterImage?.slot ?? null, 'image', imageVersion);

  useEffect(() => {
    if (follow && tab === 'transcript' && mine) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeTurnId, follow, tab, mine]);

  const [exportingWav, setExportingWav] = useState(false);
  /** Decodes the compressed episode here (Chromium has the decoder) and saves it as PCM16 WAV. */
  const exportWav = async () => {
    if (!episode) return;
    setExportingWav(true);
    setError(null);
    try {
      const raw = await window.nodus.podcastAudioBytes(episode.id);
      const encoded = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      const context = new OfflineAudioContext(1, 1, 24_000);
      const decoded = await context.decodeAudioData(encoded);
      await window.nodus.podcastExportWav(episode.id, wavFromFloat32(decoded.getChannelData(0), decoded.sampleRate));
    } catch (err) {
      setError(podcastError(errorText(err)));
    } finally {
      setExportingWav(false);
    }
  };

  /** Starts this episode in the app-wide player at `from` seconds. */
  const start = (from: number) => {
    if (!player || !episode) { setError(t('No se pudo reproducir el audio del episodio.')); return; }
    const id = episode.id;
    player.play([{ id: podcastSourceKey(id), label: episode.title, url: audioUrl(id), durationS: episode.durationS }], 0, {
      key: podcastSourceKey(id),
      title: episode.title,
      open: () => {
        requestedEpisode = id;
        window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
        onOpenView?.();
      },
    });
    const resume = from > 0 && from < episode.durationS - 5 ? from : 0;
    if (resume) player.clock.jumpTo(0, resume);
    rememberPosition(player.clock, id);
  };
  const seek = (seconds: number) => {
    const target = Math.max(0, Math.min(seconds, episode?.durationS ?? seconds));
    if (mine && player) player.seek(target); else start(target);
  };
  const toggle = () => {
    if (mine && player) player.toggle(); else start(episode?.listenedPositionS ?? 0);
  };

  if (!episode) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        {error ?? t('Cargando…')}
      </div>
    );
  }

  const names = new Map(episode.hosts.map((host) => [host.speaker, host.name]));
  const startOf = new Map(timings.map((turn) => [turn.turnId, turn.startS]));
  const cited = new Set(episode.script.turns.flatMap((turn) => turn.sourceIds));
  const total = mine && player?.duration ? player.duration : episode.durationS;
  let chapterSeen = -1;

  return (
    <div className="theme-workspace-surface flex h-full min-h-0 flex-col" data-testid="podcast-reader">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <button className="btn btn-ghost gap-1.5 !py-1 text-sm" onClick={onBack}><Icon name="arrowLeft" size={14} /> {t('Episodios')}</button>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn btn-primary gap-1 !py-1 text-xs" data-testid="podcast-download" onClick={() => { void window.nodus.podcastExportAudio(episode.id).catch((err) => setError(podcastError(errorText(err)))); }} title={t('Comprimido, para escuchar y publicar')}><Icon name="download" size={13} /> {t('Descargar audio')} · {episode.audioMime === 'audio/ogg' ? 'Opus' : 'M4A'}</button>
          <button className="btn btn-ghost gap-1 !py-1 text-xs" data-testid="podcast-download-wav" disabled={exportingWav} onClick={() => void exportWav()} title={t('Sin compresión, para editarlo')}><Icon name="download" size={13} /> {exportingWav ? t('Preparando WAV…') : 'WAV'}</button>
          <button className="btn btn-ghost gap-1 !py-1 text-xs" onClick={() => { void window.nodus.podcastExportTranscript(episode.id).catch((err) => setError(errorText(err))); }}><Icon name="fileText" size={13} /> {t('Transcripción')}</button>
          <button
            className="btn btn-ghost gap-1 !py-1 text-xs text-red-500"
            onClick={async () => {
              const ok = await confirm({ title: t('Eliminar episodio'), message: t('Se borrarán el audio, el guion y las imágenes de este episodio.'), confirmLabel: t('Eliminar'), danger: true });
              if (!ok) return;
              // Deleting the episode that is playing would leave the header player on a missing file.
              if (mine) player?.stop();
              await window.nodus.podcastDeleteEpisode(episode.id);
              onDeleted();
            }}
          ><Icon name="trash" size={13} /> {t('Eliminar')}</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-6 p-5 max-md:grid-cols-1">
          <aside className="space-y-3 md:sticky md:top-0 md:self-start">
            <div className="aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              {imageData ? <img src={imageData} alt="" className="h-full w-full object-cover" /> : <CoverArt episodeId={episode.id} hasImages={false} version={0} className="h-full w-full" />}
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-snug text-neutral-900 dark:text-neutral-100">{episode.title}</h1>
              <p className="mt-1 text-xs text-neutral-500">{t(FORMAT_LABELS[episode.format]?.label ?? episode.format)} · {LANGUAGE_LABELS[episode.language]} · {episode.hosts.map((host) => host.name).join(' · ')}</p>
              {episode.plan.summary && <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{episode.plan.summary}</p>}
            </div>
            <div className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800" data-testid="podcast-player">
              <div
                className="relative h-2 cursor-pointer rounded bg-neutral-200 dark:bg-neutral-800"
                role="slider"
                aria-label={t('Posición')}
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(time)}
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'ArrowRight') seek(time + 5); if (event.key === 'ArrowLeft') seek(time - 5); }}
                onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); seek(((event.clientX - box.left) / box.width) * total); }}
              >
                <div className="h-full rounded bg-indigo-500" style={{ width: `${total ? (time / total) * 100 : 0}%` }} />
                {chapters.slice(1).map((chapter) => (
                  <span key={chapter.index} className="absolute top-[-2px] h-3 w-0.5 bg-neutral-500/70" style={{ left: `${total ? (chapter.startS / total) * 100 : 0}%` }} title={chapter.title} />
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] tabular-nums text-neutral-500"><span>{clock(time)}</span><span>{clock(total)}</span></div>
              <div className="flex items-center justify-center gap-2">
                <button className="btn btn-ghost px-2" onClick={() => seek(time - 15)} aria-label={t('Retroceder 15 segundos')} title={t('Retroceder 15 segundos')}><Icon name="rotateCcw" size={16} /></button>
                <button className="btn btn-primary rounded-full px-3 py-2" onClick={toggle} aria-label={playing ? t('Pausa') : t('Reproducir')} data-testid="podcast-play"><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
                <button className="btn btn-ghost px-2" onClick={() => seek(time + 15)} aria-label={t('Avanzar 15 segundos')} title={t('Avanzar 15 segundos')}><Icon name="rotateCw" size={16} /></button>
                <select className="input !py-1 text-xs" value={RATES.includes(rate) ? rate : 1} onChange={(event) => player?.setRate(Number(event.target.value))} aria-label={t('Velocidad')}>
                  {RATES.map((value) => <option key={value} value={value}>{value}×</option>)}
                </select>
              </div>
              {chapters[activeChapter] && <p className="truncate text-center text-xs text-neutral-500">{chapters.find((chapter) => chapter.index === activeChapter)?.title}</p>}
            </div>
            {images.some((image) => image.status === 'failed') && (
              <div className="space-y-1 text-[11px] text-neutral-500">
                {images.filter((image) => image.status === 'failed').map((image) => (
                  <div key={image.slot} className="flex items-center gap-2">
                    <span className="truncate">{image.slot === 0 ? t('La portada no se pudo generar.') : tx('La imagen {n} no se pudo generar.', { n: image.slot })}</span>
                    <button className="underline-offset-2 hover:underline" onClick={() => { void window.nodus.podcastRegenerateImage(episode.id, image.slot); }}>{t('Reintentar')}</button>
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
          </aside>
          <main className="min-w-0">
            <div className="mb-3 flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800" role="tablist">
              {(['transcript', 'chapters', 'sources'] as const).map((id) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-indigo-500 text-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}>
                  {id === 'transcript' ? t('Transcripción') : id === 'chapters' ? t('Capítulos') : tx('Fuentes ({n})', { n: cited.size })}
                </button>
              ))}
              {tab === 'transcript' && (
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-500"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> {t('Seguir el audio')}</label>
              )}
            </div>
            {tab === 'transcript' && (
              <div className="space-y-1" data-testid="podcast-transcript">
                {episode.script.turns.map((turn) => {
                  const heading = turn.chapterIndex !== chapterSeen ? episode.plan.chapters[turn.chapterIndex]?.title : null;
                  chapterSeen = turn.chapterIndex;
                  const active = turn.id === activeTurnId;
                  return (
                    <div key={turn.id}>
                      {heading && <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-indigo-500 first:mt-0">{heading}</h3>}
                      <div
                        ref={active ? activeRef : undefined}
                        className={`cursor-pointer rounded-lg px-3 py-2 text-[15px] leading-relaxed transition ${active ? 'bg-indigo-50 text-neutral-900 dark:bg-indigo-950/50 dark:text-neutral-50' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'}`}
                        onClick={() => { const at = startOf.get(turn.id); if (at != null) seek(at); }}
                      >
                        {episode.hosts.length > 1 && (
                          <span className={`mr-2 text-xs font-semibold ${turn.speaker === 'A' ? 'text-indigo-500' : 'text-amber-600 dark:text-amber-400'}`}>{names.get(turn.speaker)}</span>
                        )}
                        {turn.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {tab === 'chapters' && (
              <ol className="space-y-1">
                {episode.plan.chapters.map((chapter) => {
                  const start = chapters.find((entry) => entry.index === chapter.index)?.startS;
                  return (
                    <li key={chapter.index}>
                      <button className={`flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900 ${chapter.index === activeChapter ? 'text-indigo-600 dark:text-indigo-300' : 'text-neutral-800 dark:text-neutral-200'}`} onClick={() => start != null && seek(start)}>
                        <span className="w-12 shrink-0 text-xs tabular-nums text-neutral-500">{start != null ? clock(start) : ''}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{chapter.title}</span>
                          {chapter.goal && <span className="block text-xs text-neutral-500">{chapter.goal}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {tab === 'sources' && (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {episode.sources.filter((source) => cited.has(source.id)).map((source) => (
                    <li key={source.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">{source.title}</div>
                      <div className="text-xs text-neutral-500">{[source.authors, source.year, source.location].filter(Boolean).join(' · ')}</div>
                      <p className="mt-1 line-clamp-3 text-xs text-neutral-600 dark:text-neutral-400">{source.excerpt}</p>
                      {source.link && source.link.startsWith('nodus://') && (
                        <a href={source.link} className="mt-1 inline-block text-xs text-indigo-500 hover:underline">{t('Abrir en Nodus')}</a>
                      )}
                      {source.url && <a href={source.url} target="_blank" rel="noreferrer" className="ml-3 mt-1 inline-block text-xs text-indigo-500 hover:underline">{t('Abrir página')}</a>}
                    </li>
                  ))}
                </ul>
                {episode.researchLog && (
                  <details className="text-xs text-neutral-500">
                    <summary className="cursor-pointer">{t('Qué se consultó')}</summary>
                    <p className="mt-2 whitespace-pre-line">{episode.researchLog}</p>
                  </details>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
