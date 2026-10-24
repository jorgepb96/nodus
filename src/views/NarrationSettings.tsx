import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { POCKET_MODEL_ID, POCKET_LANGUAGES, POCKET_DEFAULT_VOICES } from '@shared/pocketTts';
import {
  TTS_LANGUAGES, TTS_MODELS, TTS_SURFACES, PHONON_LANGUAGES, sanitizeTtsRetention, ttsModelBytes,
  type TtsEngine, type TtsLanguage, type TtsLanguageSetting, type TtsModelDefinition, type TtsRetentionRule, type TtsStatus, type TtsSurface,
} from '@shared/ttsModels';
import {
  TTS_SAMPLE_PARAGRAPHS, TTS_VOICE_RECOMMENDED_MAX_S, TTS_VOICE_RECOMMENDED_MIN_S, TTS_VOICE_MIN_S, TTS_VOICE_MAX_S,
  TTS_VOICE_MIN_TRANSCRIPT_CHARS, minimumVoiceTranscriptChars,
  type TtsVoice,
} from '@shared/ttsVoices';
import { t, tx } from '../i18n';
import { Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { SettingsModelDot, SettingsModelList, settingsModelRowClass } from '../components/SettingsModelList';
import { LocalAudioRecorderPanel, useLocalAudioRecorder } from '../components/media/LocalAudioRecorder';
import { STUDY_MEDIA_ACCENT } from '../components/media/mediaFormat';
import { refreshTtsStatus, subscribeTtsEvents, subscribeTtsStatus, voiceUrl } from '../lib/narration/ttsClient';
import { prepareReferenceAudio } from '../lib/narration/voiceAudio';
import { ttsErrorMessage, ttsInstallPhaseLabel } from '../lib/narration/ttsErrors';

/**
 * «Voz y narración»: the Ming TTS engine, its checkpoints, the voice library and the
 * automatic deletion of narration clips.
 * Everything heavy (install, downloads, synthesis) runs in the main process or the
 * sidecar; this view only shows state pushed over `tts:event`.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`;
  return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

const HF_TOKENS_URL = 'https://huggingface.co/settings/tokens';

const SURFACE_LABELS: Record<TtsSurface, string> = {
  research_chat: 'Research chat',
  dictionary: 'Diccionario',
  deep_research: 'Deep Research',
  immersion: 'Inmersión',
  scriptor: 'Nodus Scriptor',
};
const SURFACE_KINDS: Record<TtsSurface, string> = { research_chat: 'chat_message', dictionary: 'dictionary_entry', deep_research: 'deep_research', immersion: 'immersion', scriptor: 'scriptor_document' };

export function NarrationSettings({ settings, patch }: { settings: AppSettings; patch: (value: Partial<AppSettings>) => Promise<void> }) {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [install, setInstall] = useState<{ engine: TtsEngine; phase: string; fraction: number } | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'model'; model: TtsModelDefinition; unsupported?: boolean } | { kind: 'runtime' } | { kind: 'voice'; voice: TtsVoice } | { kind: 'sweep' }>(null);
  const [usage, setUsage] = useState<{ clips: Record<string, number>; voices: number; runtime: number; models: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [hasHfToken, setHasHfToken] = useState(false);
  useEffect(() => { void window.nodus.ttsHasHuggingFaceToken().then(setHasHfToken).catch(() => {}); }, []);

  const platformModels = useMemo(() => {
    const backend = status?.runtime.backend;
    // Phonon runs on every platform; Ming's checkpoints follow this machine's backend.
    return TTS_MODELS.filter((model) => (model.engine !== 'ming' || !backend || model.backend === backend)
      && (model.engine !== 'pocket' || !status || status.models.some((entry) => entry.id === model.id)));
  }, [status]);
  const modelStatus = useMemo(() => new Map(status?.models.map((model) => [model.id, model]) ?? []), [status]);
  const selectedModelId = settings.ttsModelId || platformModels.find((model) => !model.unpublished)?.id || '';
  const retention = sanitizeTtsRetention(settings.ttsRetention);

  const refreshVoices = async () => setVoices(await window.nodus.ttsVoices());
  const refreshUsage = async () => setUsage(await window.nodus.ttsDiskUsage().catch(() => null));
  useEffect(() => {
    const offStatus = subscribeTtsStatus(setStatus);
    const offEvents = subscribeTtsEvents((event) => {
      if (event.kind === 'install') setInstall(event.phase === 'ready' ? null : { engine: event.engine, phase: event.phase, fraction: event.fraction });
    });
    void refreshVoices().catch(() => {});
    void refreshUsage();
    return () => { offStatus(); offEvents(); };
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); } catch (cause) { setError(ttsErrorMessage(cause)); }
    finally { void refreshTtsStatus().then(setStatus).catch(() => {}); void refreshUsage(); void refreshVoices().catch(() => {}); }
  };

  const runtime = status?.runtime;
  const mingInstalling = install?.engine === 'ming' || Boolean(runtime?.installing);
  const phononInstalling = install?.engine === 'phonon' || Boolean(status?.phononRuntime.installing);
  const kokoroInstalling = install?.engine === 'kokoro' || Boolean(status?.kokoroRuntime?.installing);
  const pocketInstalling = install?.engine === 'pocket' || Boolean(status?.pocketRuntime?.installing);
  const pocketPhase = install?.engine === 'pocket' ? install.phase : status?.pocketRuntime?.phase;
  const pocketFraction = install?.engine === 'pocket' ? install.fraction : status?.pocketRuntime?.progress ?? 0;
  const mingPhase = install?.engine === 'ming' ? install.phase : runtime?.phase;
  const phononPhase = install?.engine === 'phonon' ? install.phase : undefined;
  const kokoroPhase = install?.engine === 'kokoro' ? install.phase : undefined;
  const mingFraction = install?.engine === 'ming' ? install.fraction : runtime?.progress ?? 0;
  const phononFraction = install?.engine === 'phonon' ? install.fraction : 0;
  const kokoroFraction = install?.engine === 'kokoro' ? install.fraction : 0;
  const deviceLabel = runtime?.device === 'metal' ? t('GPU de Apple (MLX)') : runtime?.device === 'cuda' ? t('GPU NVIDIA (CUDA)') : runtime?.device === 'cpu' ? t('Procesador (CPU)') : '';

  return <div className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/35" data-testid="narration-settings">
    <div className="min-w-0">
      <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-200">{t('Voz y narración')}</h4>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{t('Nodus narra en tu equipo con el motor que elijas. Ming y Pocket TTS permiten clonar una voz a partir de una grabación corta. Los modelos se descargan cuando los necesitas y el audio se procesa localmente.')}</p>
    </div>

    {/* 1 · Engine */}
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="narration-runtime">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Motor')}</h5>
        {runtime?.installed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{t('Instalado')}{deviceLabel ? ` · ${deviceLabel}` : ''}</span>}
        {status && !status.platformSupported && <span className="text-amber-700 dark:text-amber-400">{t('Este sistema no es compatible con la narración local.')}</span>}
      </div>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">
        {runtime?.backend === 'mlx' ? t('En Mac con Apple Silicon usa MLX sobre la GPU.') : t('Usa PyTorch: la GPU NVIDIA si la detecta y, si no, el procesador.')}
        {' '}{t('Se instala en un entorno privado de Python; no modifica el Python del sistema.')}
      </p>
      {runtime?.fallbackReason && <p className="mt-1 text-amber-700 dark:text-amber-400">{t('No se pudo usar la GPU NVIDIA; la narración funcionará en el procesador, más despacio.')}</p>}
      {mingInstalling && <div className="mt-2">
        <p className="text-neutral-600 dark:text-neutral-400">{ttsInstallPhaseLabel(mingPhase)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mingFraction * 100)}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, mingFraction * 100)}%` }} />
        </div>
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!runtime?.installed && !mingInstalling && <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!status?.platformSupported} onClick={() => void run(() => window.nodus.ttsInstallRuntime())}><Icon name="download" size={11} />{t('Instalar motor de voz')}</button>}
        {mingInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsCancelInstall()}>{t('Cancelar')}</button>}
        {runtime?.installed && !mingInstalling && <>
          <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void run(() => window.nodus.ttsInstallRuntime())}><Icon name="refresh" size={10} />{t('Reparar')}</button>
          <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => setConfirm({ kind: 'runtime' })}><Icon name="trash" size={10} />{t('Eliminar motor')}</button>
          {usage && <span className="text-[10px] text-neutral-500">{formatBytes(usage.runtime)}</span>}
        </>}
      </div>
    </div>

    {/* 1b · Phonon engine: a small runtime of its own (no PyTorch), for the Phonon checkpoints */}
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="narration-runtime-phonon">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Motor Phonon')}</h5>
        {status?.phononRuntime.installed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{t('Instalado')} · {t('Procesador (CPU)')}</span>}
      </div>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">{t('Phonon (Gradium) es muy ligero y genera mucho más rápido que el tiempo real en el procesador, también en Windows y Linux. Usa su catálogo de voces; no clona grabaciones propias.')}</p>
      {phononInstalling && <div className="mt-2">
        <p className="text-neutral-600 dark:text-neutral-400">{ttsInstallPhaseLabel(phononPhase)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phononFraction * 100)}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, phononFraction * 100)}%` }} />
        </div>
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!status?.phononRuntime.installed && !phononInstalling && <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!status?.platformSupported} onClick={() => void run(() => window.nodus.ttsInstallRuntime('phonon'))}><Icon name="download" size={11} />{t('Instalar motor Phonon')}</button>}
        {phononInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsCancelInstall()}>{t('Cancelar')}</button>}
        {status?.phononRuntime.installed && !phononInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void run(() => window.nodus.ttsRemoveRuntime('phonon'))}><Icon name="trash" size={10} />{t('Eliminar motor')}</button>}
      </div>
      <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800" data-testid="narration-hf-token">
        <p className="text-neutral-600 dark:text-neutral-400">{t('Los modelos Phonon de 40M y Pocket TTS requieren aceptar sus términos en Hugging Face y un token de lectura. Se guarda cifrado en este equipo y solo se envía a Hugging Face al descargar.')}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <button className="text-indigo-600 hover:underline dark:text-indigo-300" data-testid="narration-hf-token-link" onClick={() => void window.nodus.openExternal(HF_TOKENS_URL)}><Icon name="external" size={10} /> {t('Crear un token de lectura')}</button>
          {TTS_MODELS.filter((model) => model.gated && platformModels.includes(model)).map((model) => <button key={model.id} className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => void window.nodus.openExternal(model.sourceUrl)}><Icon name="external" size={10} /> {tx('Aceptar los términos de {model}', { model: model.label })}</button>)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input type="password" className="input h-7 w-64 text-xs" placeholder={hasHfToken ? t('Token guardado; escribe para sustituirlo') : 'hf_…'} value={hfToken} onChange={(event) => setHfToken(event.target.value)} />
          <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={!hfToken.trim()} onClick={() => void run(async () => { setHasHfToken(await window.nodus.ttsSetHuggingFaceToken(hfToken)); setHfToken(''); })}>{t('Guardar token')}</button>
          {hasHfToken && <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void run(async () => setHasHfToken(await window.nodus.ttsSetHuggingFaceToken('')))}>{t('Eliminar token')}</button>}
        </div>
      </div>
    </div>

    {/* 1c · Kokoro engine: ONNX Runtime on the CPU, no PyTorch */}
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="narration-runtime-kokoro">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Motor Kokoro')}</h5>
        {status?.kokoroRuntime?.installed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{t('Instalado')} · {t('Procesador (CPU)')}</span>}
      </div>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">{t('Un solo modelo de 82M con 31 voces inglesas y españolas. ONNX Runtime en el procesador, varias veces más rápido que el tiempo real.')}</p>
      {kokoroInstalling && <div className="mt-2">
        <p className="text-neutral-600 dark:text-neutral-400">{ttsInstallPhaseLabel(kokoroPhase)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(kokoroFraction * 100)}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, kokoroFraction * 100)}%` }} />
        </div>
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!status?.kokoroRuntime?.installed && !kokoroInstalling && <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!status?.platformSupported} onClick={() => void run(() => window.nodus.ttsInstallRuntime('kokoro'))}><Icon name="download" size={11} />{t('Instalar motor de voz')}</button>}
        {kokoroInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsCancelInstall()}>{t('Cancelar')}</button>}
        {status?.kokoroRuntime?.installed && !kokoroInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void run(() => window.nodus.ttsRemoveRuntime('kokoro'))}><Icon name="trash" size={10} />{t('Eliminar motor')}</button>}
      </div>
    </div>

    {platformModels.some((model) => model.engine === 'pocket') && <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="narration-runtime-pocket">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Motor Pocket TTS')}</h5>
        {status?.pocketRuntime?.installed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{t('Instalado')} · {t('Procesador (CPU)')}</span>}
      </div>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">{t('Pocket TTS de Kyutai usa su implementación oficial para CPU y modelos de 6 capas. Incluye las voces predeterminadas de siete idiomas y permite clonar una grabación sin transcripción.')}</p>
      {pocketInstalling && <div className="mt-2">
        <p className="text-neutral-600 dark:text-neutral-400">{ttsInstallPhaseLabel(pocketPhase)}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pocketFraction * 100)}>
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, pocketFraction * 100)}%` }} />
        </div>
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!status?.pocketRuntime?.installed && !pocketInstalling && <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!status?.platformSupported} onClick={() => void run(() => window.nodus.ttsInstallRuntime('pocket'))}><Icon name="download" size={11} />{t('Instalar motor de voz')}</button>}
        {pocketInstalling && <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsCancelInstall()}>{t('Cancelar')}</button>}
        {status?.pocketRuntime?.installed && !pocketInstalling && <>
          <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void run(() => window.nodus.ttsInstallRuntime('pocket'))}><Icon name="refresh" size={10} />{t('Reparar')}</button>
          <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => void run(() => window.nodus.ttsRemoveRuntime('pocket'))}><Icon name="trash" size={10} />{t('Eliminar motor')}</button>
        </>}
      </div>
    </div>}

    {/* 2 · Models */}
    <div className="mt-5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Modelos')}</h5>
      <SettingsModelList className="mt-2" data-testid="narration-models">
        {platformModels.map((model) => {
          const local = modelStatus.get(model.id);
          const selected = model.id === selectedModelId;
          return <article key={model.id} data-testid={`narration-model-${model.id}`} className={settingsModelRowClass(selected, !!local?.downloaded, 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4')}
            onClick={() => { if (local?.downloaded && !selected) void patch({ ttsModelId: model.id }); }}>
            <div className="flex min-w-0 items-start gap-2">
              <SettingsModelDot selected={selected} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h6 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</h6>
                  <button className="text-neutral-400 hover:text-indigo-600 dark:text-neutral-600 dark:hover:text-indigo-300" title={t('Abrir fuente del modelo')} onClick={(event) => { event.stopPropagation(); void window.nodus.openExternal(model.sourceUrl); }}><Icon name="external" size={12} /></button>
                </div>
                <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">
                  {model.unpublished ? t('Próximamente') : formatBytes(ttsModelBytes(model))}{' · '}
                  <button className="underline decoration-dotted underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-300" title={t('Abrir licencia del modelo')} onClick={(event) => { event.stopPropagation(); void window.nodus.openExternal(model.licenseUrl); }}>{model.licenseLabel}</button>
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-500">{t(model.description)}</p>
                {local?.downloading && <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuenow={Math.round(local.progress * 100)}>
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, local.progress * 100)}%` }} />
                </div>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end" onClick={(event) => event.stopPropagation()}>
              {!model.unpublished && <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${local?.downloaded ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>
                {local?.downloaded ? t('Descargado') : local?.downloading ? `${formatBytes(local.downloadedBytes)} / ${formatBytes(local.totalBytes)}` : t('No descargado')}
              </span>}
              {!model.unpublished && (local?.downloaded
                ? <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => setConfirm({ kind: 'model', model })}><Icon name="trash" size={10} />{t('Eliminar')}</button>
                : local?.downloading
                  ? <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsCancelModelDownload(model.id)}>{t('Cancelar')}</button>
                  : <>
                    {model.gated && <button className="text-[10px] text-indigo-600 hover:underline dark:text-indigo-300" data-testid={`narration-model-terms-${model.id}`} title={t('Hugging Face solo deja descargarlo a las cuentas que han aceptado sus términos.')} onClick={() => void window.nodus.openExternal(model.sourceUrl)}><Icon name="external" size={10} /> {t('Aceptar los términos en Hugging Face')}</button>}
                    {model.nonCommercial && <label className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400" title={t('La licencia CC BY-NC 4.0 no permite el uso comercial de estos pesos ni del audio que generan.')}>
                      <input type="checkbox" checked={settings.ttsAcceptedLicenses.includes(model.id)} onChange={(event) => void patch({ ttsAcceptedLicenses: event.target.checked ? [...settings.ttsAcceptedLicenses, model.id] : settings.ttsAcceptedLicenses.filter((id) => id !== model.id) })} />
                      {t('Acepto la licencia (uso no comercial)')}
                    </label>}
                    <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={(model.nonCommercial && !settings.ttsAcceptedLicenses.includes(model.id)) || (model.gated && !hasHfToken)} title={model.gated && !hasHfToken ? t('Guarda primero un token de Hugging Face') : undefined} onClick={() => void run(async () => { await window.nodus.ttsDownloadModel(model.id); if (!settings.ttsModelId) await patch({ ttsModelId: model.id }); })}><Icon name="download" size={10} />{t('Descargar')}</button>
                  </>)}
            </div>
          </article>;
        })}
        {/* A checkpoint this machine cannot run (downloaded elsewhere or before it was hidden): only deletion. */}
        {status?.unsupportedModels?.map((local) => {
          const model = TTS_MODELS.find((entry) => entry.id === local.id);
          if (!model) return null;
          return <article key={model.id} data-testid={`narration-model-unsupported-${model.id}`} className={settingsModelRowClass(false, false, 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4')}>
            <div className="flex min-w-0 items-start gap-2">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <h6 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</h6>
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{tx('No funciona en este equipo · {size} en disco', { size: formatBytes(local.downloadedBytes) })}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 sm:mt-0 sm:justify-end">
              <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" onClick={() => setConfirm({ kind: 'model', model, unsupported: true })}><Icon name="trash" size={10} />{t('Eliminar')}</button>
            </div>
          </article>;
        })}
      </SettingsModelList>
    </div>

    {/* 3 · Behaviour */}
    <div className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="narration-behaviour">
      <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" className="mt-0.5" checked={settings.ttsStreaming} onChange={(event) => void patch({ ttsStreaming: event.target.checked })} />
        <span>{t('Escuchar mientras se genera')}<br /><span className="text-[10px] text-neutral-500">{t('Empieza a sonar con el primer fragmento. Si tu equipo genera más despacio de lo que se escucha, espera lo justo para no cortarse.')}</span></span>
      </label>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">
        {t('Descargar el modelo de la memoria tras')}{' '}
        <input type="number" min={1} max={120} className="input inline-block h-7 w-16 px-2 py-0 text-xs" value={settings.ttsIdleUnloadMin} onChange={(event) => void patch({ ttsIdleUnloadMin: Math.max(1, Math.min(120, Number(event.target.value) || 5)) })} />
        {' '}{t('minutos sin usarlo')}
      </label>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">
        {t('Idioma por defecto')}{' '}
        <select className="input h-7 py-0 text-xs" value={settings.ttsLanguage} onChange={(event) => void patch({ ttsLanguage: event.target.value as TtsLanguageSetting })}>
          <option value="auto">{t('Automático (según el texto)')}</option>
          {TTS_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">
        {t('Velocidad de reproducción')}{' '}
        <input type="range" min={0.5} max={2} step={0.05} className="w-28 align-middle accent-indigo-500" value={settings.audioSpeed} onChange={(event) => void patch({ audioSpeed: Number(event.target.value) })} />
        <span className="ml-1 font-mono">{settings.audioSpeed.toFixed(2)}×</span>
      </label>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">
        {t('Resaltar el texto mientras suena')}{' '}
        <select data-testid="narration-highlight-mode" className="input h-7 py-0 text-xs" value={settings.narrationHighlight} onChange={(event) => void patch({ narrationHighlight: event.target.value as AppSettings['narrationHighlight'] })}>
          <option value="word">{t('Palabra y frase')}</option>
          <option value="sentence">{t('Solo la frase')}</option>
          <option value="off">{t('No resaltar')}</option>
        </select>
        <br /><span className="text-[10px] text-neutral-500">{t('A más velocidad resalta grupos de palabras, para que se puedan seguir.')}</span>
      </label>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">
        {t('Estilo del resaltado')}{' '}
        <select data-testid="narration-highlight-style" className="input h-7 py-0 text-xs" disabled={settings.narrationHighlight === 'off'} value={settings.narrationHighlightStyle} onChange={(event) => void patch({ narrationHighlightStyle: event.target.value as AppSettings['narrationHighlightStyle'] })}>
          <option value="fill">{t('Relleno de color')}</option>
          <option value="underline">{t('Solo subrayado')}</option>
        </select>
        <br /><span className="text-[10px] text-neutral-500">{t('El color sigue el tema y el modo claro u oscuro.')}</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400 sm:col-span-2">
        <input data-testid="narration-follow" type="checkbox" className="mt-0.5" disabled={settings.narrationHighlight === 'off'} checked={settings.narrationFollow} onChange={(event) => void patch({ narrationFollow: event.target.checked })} />
        <span>{t('Seguir la lectura con el scroll')}<br /><span className="text-[10px] text-neutral-500">{t('Se detiene si desplazas el texto a mano. Con ⌥/Alt + clic en una palabra, el audio salta a ella.')}</span></span>
      </label>
    </div>

    {/* 4 · Voices */}
    <VoiceLibrary
      voices={voices}
      selectedVoiceId={settings.ttsVoiceId}
      phononVoiceId={settings.ttsPhononVoiceId}
      kokoroVoiceId={settings.ttsKokoroVoiceId}
      pocketVoiceId={settings.ttsPocketVoiceId}
      cloneEngine={TTS_MODELS.find((model) => model.id === selectedModelId)?.engine === 'pocket' ? 'pocket' : 'ming'}
      onSelect={(voiceId) => void patch(voiceId.startsWith('phonon:') ? { ttsPhononVoiceId: voiceId } : voiceId.startsWith('kokoro:') ? { ttsKokoroVoiceId: voiceId }
        : voiceId.startsWith('pocket:') || (selectedModelId === POCKET_MODEL_ID && (voiceId.startsWith('user:') || voiceId.startsWith('cc0:'))) ? { ttsPocketVoiceId: voiceId } : { ttsVoiceId: voiceId })}
      onChanged={() => void refreshVoices()}
      onDelete={(voice) => setConfirm({ kind: 'voice', voice })}
      onError={(message) => setError(message)}
      sttModel={settings.sttTransformersModel}
    />

    {/* 5 · Retention */}
    <div className="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800" data-testid="narration-retention">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Borrado automático de audios')}</h5>
      <p className="mt-1 text-xs text-neutral-500">{t('Los audios generados se eliminan solos pasado un tiempo. Los que marques como «Conservar» nunca se borran. La narración de Estudio no se borra automáticamente.')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <label className="flex items-center gap-2"><input type="checkbox" checked={retention.enabled} onChange={(event) => void patch({ ttsRetention: { ...retention, enabled: event.target.checked } })} />{t('Borrar los audios a los')}</label>
        <input type="number" min={1} max={365} className="input h-7 w-16 px-2 py-0 text-xs" disabled={!retention.enabled} value={retention.days} onChange={(event) => void patch({ ttsRetention: { ...retention, days: Number(event.target.value) || 7 } })} />
        <span>{t('días')}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {TTS_SURFACES.map((surface) => {
          const rule = retention.perSurface[surface];
          const set = (next: Partial<TtsRetentionRule>) => void patch({ ttsRetention: { ...retention, perSurface: { ...retention.perSurface, [surface]: { ...rule, ...next } } } });
          return <div key={surface} className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400" data-testid={`narration-retention-${surface}`}>
            <span className="w-32 font-medium">{t(SURFACE_LABELS[surface])}</span>
            <select className="input h-7 py-0 text-xs" value={rule.mode} onChange={(event) => set({ mode: event.target.value as TtsRetentionRule['mode'] })}>
              <option value="inherit">{retention.enabled ? tx('Como el general ({days} días)', { days: retention.days }) : t('Como el general (desactivado)')}</option>
              <option value="days">{t('Días propios')}</option>
              <option value="off">{t('No borrar')}</option>
            </select>
            {rule.mode === 'days' && <><input type="number" min={1} max={365} className="input h-7 w-16 px-2 py-0 text-xs" value={rule.days} onChange={(event) => set({ days: Number(event.target.value) || 7 })} /><span>{t('días')}</span></>}
            {usage && <span className="ml-auto text-[10px] text-neutral-500">{formatBytes(usage.clips[SURFACE_KINDS[surface]] ?? 0)}</span>}
          </div>;
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => setConfirm({ kind: 'sweep' })}><Icon name="trash" size={10} />{t('Borrar ahora los caducados')}</button>
        {notice && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">{notice}</span>}
      </div>
    </div>

    {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300" role="alert">{error}</p>}

    {confirm?.kind === 'model' && <ConfirmModal title={t('Eliminar modelo de voz')} message={tx(confirm.unsupported ? 'Se eliminará «{model}» de tu equipo. Este equipo no puede usar este modelo.' : 'Se eliminará «{model}» de tu equipo. Podrás volver a descargarlo cuando quieras.', { model: confirm.model.label })} confirmLabel={t('Eliminar modelo')} danger
      onConfirm={() => { const model = confirm.model; setConfirm(null); void run(() => window.nodus.ttsDeleteModel(model.id)); }} onCancel={() => setConfirm(null)} />}
    {confirm?.kind === 'runtime' && <ConfirmModal title={t('Eliminar motor de voz')} message={t('Se eliminará el entorno de Python de la narración. Los modelos y tus voces se conservan.')} confirmLabel={t('Eliminar motor')} danger
      onConfirm={() => { setConfirm(null); void run(() => window.nodus.ttsRemoveRuntime()); }} onCancel={() => setConfirm(null)} />}
    {confirm?.kind === 'voice' && <ConfirmModal title={t('Eliminar voz')} message={tx('Se eliminará la voz «{name}» y su grabación de referencia.', { name: confirm.voice.name })} confirmLabel={t('Eliminar voz')} danger
      onConfirm={() => { const voice = confirm.voice; setConfirm(null); void run(async () => { await window.nodus.ttsDeleteVoice(voice.id); if (settings.ttsVoiceId === voice.id) await patch({ ttsVoiceId: 'cc0:es-dave' }); await refreshVoices(); }); }} onCancel={() => setConfirm(null)} />}
    {confirm?.kind === 'sweep' && <ConfirmModal title={t('Borrar audios caducados')} message={t('Se eliminarán ahora todos los audios no conservados que hayan superado su plazo.')} confirmLabel={t('Borrar')} danger
      onConfirm={() => { setConfirm(null); void run(async () => { const removed = await window.nodus.ttsSweepNow(); setNotice(tx('{n} audios eliminados', { n: removed })); }); }} onCancel={() => setConfirm(null)} />}
  </div>;
}

function VoiceLibrary({ voices, selectedVoiceId, phononVoiceId, kokoroVoiceId, pocketVoiceId, cloneEngine, onSelect, onChanged, onDelete, onError, sttModel }: {
  voices: TtsVoice[];
  selectedVoiceId: string;
  phononVoiceId: string;
  kokoroVoiceId: string;
  pocketVoiceId: string;
  cloneEngine: 'ming' | 'pocket';
  onSelect: (voiceId: string) => void;
  onChanged: () => void;
  onDelete: (voice: TtsVoice) => void;
  onError: (message: string) => void;
  sttModel: string;
}) {
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [builtinFilter, setBuiltinFilter] = useState('');
  const [draft, setDraft] = useState<null | { origin: 'recorded' | 'uploaded'; wav: Uint8Array; durationS: number; previewUrl: string }>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<TtsLanguage>('es');
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; transcript: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLAudioElement>(null);
  const previewVoiceId = useRef<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const syncedPocketSelection = useRef<string | null>(null);

  useEffect(() => {
    if (cloneEngine === 'pocket' && !(POCKET_LANGUAGES as readonly string[]).includes(language)) {
      setLanguage('es'); setParagraphIndex(0);
    }
  }, [cloneEngine, language]);

  useEffect(() => {
    const audio = preview.current;
    return () => { audio?.pause(); };
  }, []);

  useEffect(() => {
    if (previewVoiceId.current && !voices.some((voice) => voice.id === previewVoiceId.current)) {
      preview.current?.pause();
      preview.current?.removeAttribute('src');
      previewVoiceId.current = null;
      setPlayingVoiceId(null);
    }
  }, [voices]);

  const paragraphs = TTS_SAMPLE_PARAGRAPHS[language];
  const paragraph = paragraphs[paragraphIndex % paragraphs.length];
  const minimumTranscript = draft ? minimumVoiceTranscriptChars(draft.durationS) : TTS_VOICE_MIN_TRANSCRIPT_CHARS;
  const transcriptTooShort = cloneEngine !== 'pocket' && transcript.trim().length < minimumTranscript;

  const accept = async (blob: Blob, origin: 'recorded' | 'uploaded') => {
    setBusy('prepare');
    try {
      const prepared = await prepareReferenceAudio(blob);
      if (prepared.durationS < TTS_VOICE_MIN_S || prepared.durationS > TTS_VOICE_MAX_S) {
        onError(tx('La grabación debe durar entre {min} y {max} segundos (mejor entre {rmin} y {rmax}).', { min: TTS_VOICE_MIN_S, max: TTS_VOICE_MAX_S, rmin: TTS_VOICE_RECOMMENDED_MIN_S, rmax: TTS_VOICE_RECOMMENDED_MAX_S }));
        return;
      }
      if (draft) URL.revokeObjectURL(draft.previewUrl);
      setDraft({ origin, wav: prepared.wav, durationS: prepared.durationS, previewUrl: URL.createObjectURL(new Blob([prepared.wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' })) });
      setTranscript(origin === 'recorded' ? paragraph : '');
      if (origin === 'uploaded' && cloneEngine !== 'pocket') void autoTranscribe(blob);
    } catch {
      onError(t('No se pudo leer el audio. Prueba con un archivo WAV, MP3, M4A o WebM.'));
    } finally { setBusy(''); }
  };

  // Uploaded clips need their exact transcript; the local Whisper model writes it when it is installed.
  const autoTranscribe = async (blob: Blob) => {
    try {
      const whisper = await import('../lib/stt/localWhisper');
      if (!whisper.isLocalWhisperModelReady(sttModel)) return;
      setBusy('transcribe');
      const text = await whisper.transcribeLocalWhisper(blob, sttModel, language);
      setTranscript((current) => current || text.trim());
    } catch { /* the user types the transcript instead */ }
    finally { setBusy(''); }
  };

  const recorder = useLocalAudioRecorder({
    fileBaseName: 'voz',
    onError,
    onSaved: async (audio) => { await accept(new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: audio.mimeType }), 'recorded'); },
  });

  const save = async () => {
    if (!draft || !consent) return;
    setBusy('save');
    try {
      const voice = await window.nodus.ttsSaveVoice({ name: name.trim() || t('Mi voz'), language, transcript: transcript.trim(), engine: cloneEngine, origin: draft.origin, wav: draft.wav, consent: true });
      URL.revokeObjectURL(draft.previewUrl);
      setDraft(null); setName(''); setTranscript(''); setConsent(false);
      onChanged();
      onSelect(voice.id);
    } catch (cause) { onError(ttsErrorMessage(cause)); }
    finally { setBusy(''); }
  };

  const play = (voice: TtsVoice) => {
    const el = preview.current;
    if (!el) return;
    if (previewVoiceId.current === voice.id && !el.paused) {
      el.pause();
      return;
    }
    if (previewVoiceId.current !== voice.id) {
      el.pause();
      setPlayingVoiceId(null);
      previewVoiceId.current = voice.id;
      el.src = voiceUrl(voice.id);
    }
    void el.play().catch(() => {});
  };

  const own = voices.filter((voice) => voice.origin === 'recorded' || voice.origin === 'uploaded');
  const bundled = voices.filter((voice) => voice.origin === 'bundled');
  const builtin = voices.filter((voice) => voice.origin === 'builtin' && (!builtinFilter || String(voice.name ?? '').toLowerCase().includes(builtinFilter.toLowerCase())));
  const [phononLanguage, setPhononLanguage] = useState<string>('es');
  const phonon = voices.filter((voice) => voice.origin === 'phonon' && (voice.language === phononLanguage));
  const [kokoroLanguage, setKokoroLanguage] = useState<string>('es');
  const kokoro = voices.filter((voice) => voice.origin === 'kokoro' && (voice.language === kokoroLanguage));
  const [pocketLanguage, setPocketLanguage] = useState<string>('es');
  const pocket = voices.filter((voice) => voice.origin === 'pocket' && voice.language === pocketLanguage);
  useEffect(() => {
    if (syncedPocketSelection.current === pocketVoiceId) return;
    const selected = voices.find((voice) => voice.id === pocketVoiceId);
    if (selected?.language) { setPocketLanguage(selected.language); syncedPocketSelection.current = pocketVoiceId; }
  }, [pocketVoiceId, voices]);
  useEffect(() => {
    const selected = voices.find((voice) => voice.id === kokoroVoiceId);
    if (selected?.language) setKokoroLanguage(selected.language);
  }, [kokoroVoiceId, voices]);

  const row = (voice: TtsVoice) => {
    const selected = voice.id === (voice.origin === 'phonon' ? phononVoiceId : voice.origin === 'kokoro' ? kokoroVoiceId : voice.origin === 'pocket' || cloneEngine === 'pocket' ? pocketVoiceId : selectedVoiceId);
    const isEditing = editing?.id === voice.id;
    return <article key={voice.id} data-testid={`narration-voice-${voice.id}`} className={settingsModelRowClass(selected, true, 'flex flex-wrap items-start gap-2')} onClick={() => !selected && onSelect(voice.id)}>
      <SettingsModelDot selected={selected} />
      <div className="min-w-0 flex-1">
        {isEditing
          ? <div className="grid gap-1.5" onClick={(event) => event.stopPropagation()}>
            <input className="input h-7 text-xs" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            <textarea className="input min-h-[3rem] text-xs" value={editing.transcript} onChange={(event) => setEditing({ ...editing, transcript: event.target.value })} />
            <div className="flex gap-2">
              <button className="btn btn-primary h-7 px-2 text-[10px]" onClick={() => void window.nodus.ttsUpdateVoice(voice.id, { name: editing.name, transcript: editing.transcript }).then(() => { setEditing(null); onChanged(); }).catch((cause) => onError(ttsErrorMessage(cause)))}>{t('Guardar')}</button>
              <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => setEditing(null)}>{t('Cancelar')}</button>
            </div>
          </div>
          : <>
            <div className="text-sm text-neutral-900 dark:text-neutral-100">{voice.name}</div>
            <div className="text-[10px] text-neutral-500">
              {TTS_LANGUAGES.find((entry) => entry.code === voice.language)?.label}
              {voice.durationS ? ` · ${voice.durationS.toFixed(1)} s` : ''}
              {voice.locale ? ` · ${voice.locale}` : ''}
              {voice.attribution ? ` · ${voice.attribution}` : ''}
            </div>
            {voice.transcript && <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">«{voice.transcript}»</p>}
            {voice.transcript && voice.durationS && voice.transcript.length < minimumVoiceTranscriptChars(voice.durationS) && (
              <p className="mt-0.5 text-[10px] leading-4 text-amber-700 dark:text-amber-400">
                {t('La transcripción es demasiado corta para el audio. Escribe exactamente lo que se dice en la grabación.')}
              </p>
            )}
          </>}
      </div>
      {!isEditing && <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
        {voice.origin !== 'builtin' && voice.origin !== 'phonon' && voice.origin !== 'kokoro' && voice.origin !== 'pocket' && <button className="rounded p-1 text-neutral-500 hover:text-indigo-500" title={playingVoiceId === voice.id ? t('Pausar') : t('Escuchar la grabación de referencia')} aria-label={playingVoiceId === voice.id ? t('Pausar') : t('Escuchar la grabación de referencia')} onClick={() => play(voice)}><Icon name={playingVoiceId === voice.id ? 'pause' : 'play'} size={12} /></button>}
        {voice.origin === 'pocket' && (voice.downloaded
          ? <span className="text-[10px] text-emerald-700 dark:text-emerald-400">{t('Descargado')}</span>
          : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={!!busy} onClick={() => {
            setBusy(voice.id);
            void window.nodus.ttsDownloadVoice(voice.id).then(onChanged).catch((cause) => onError(ttsErrorMessage(cause))).finally(() => setBusy(''));
          }}><Icon name="download" size={10} />{busy === voice.id ? t('Descargando…') : t('Descargar')}</button>)}
        {!voice.readOnly && <button className="rounded p-1 text-neutral-500 hover:text-indigo-500" title={t('Editar nombre y transcripción')} onClick={() => setEditing({ id: voice.id, name: voice.name, transcript: voice.transcript ?? '' })}><Icon name="edit" size={12} /></button>}
        {!voice.readOnly && <button className="rounded p-1 text-neutral-500 hover:text-red-400" title={t('Eliminar voz')} onClick={() => onDelete(voice)}><Icon name="trash" size={12} /></button>}
      </div>}
    </article>;
  };

  return <div className="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800" data-testid="narration-voices" id="narration-voices">
    <audio ref={preview} className="hidden" onPlay={() => setPlayingVoiceId(previewVoiceId.current)} onPause={(event) => { if (event.currentTarget.paused) setPlayingVoiceId(null); }} onEnded={() => setPlayingVoiceId(null)} onError={() => setPlayingVoiceId(null)} />
    <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Voces')}</h5>
    <p className="mt-1 text-xs text-neutral-500">{cloneEngine === 'pocket'
      ? t('Graba o sube 6–15 segundos de voz clara. Pocket TTS no necesita transcripción. La voz se guarda en tu biblioteca para reutilizarla. Usa solo tu voz o una voz autorizada.')
      : t('Graba o sube 6–15 segundos de voz clara, sin ruido de fondo, con su transcripción exacta. Usa solo tu voz o la de alguien que te haya dado permiso.')}</p>

    {cloneEngine === 'pocket' && <p className="mt-1 text-[10px] text-neutral-500">{t('Pocket TTS usa hasta 12 segundos de la referencia; la grabación original se conserva íntegra.')}</p>}

    {/* Record or upload */}
    <div className="mt-3 rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700" data-testid="narration-voice-new">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select className="input h-7 py-0 text-xs" value={language} onChange={(event) => { setLanguage(event.target.value as TtsLanguage); setParagraphIndex(0); }}>
          {TTS_LANGUAGES.filter((entry) => cloneEngine !== 'pocket' || (POCKET_LANGUAGES as readonly string[]).includes(entry.code)).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </select>
        {recorder.state === 'idle' && <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!!busy} onClick={() => void recorder.start()}><Icon name="microphone" size={11} />{t('Grabar voz')}</button>}
        {recorder.state !== 'idle' && recorder.state !== 'saving' && <button className="btn btn-primary h-7 px-3 text-[11px]" onClick={() => void recorder.finish()}><Icon name="stop" size={11} />{t('Terminar grabación')}</button>}
        <button className="btn btn-ghost h-7 px-2 text-[11px]" disabled={!!busy || recorder.state !== 'idle'} onClick={() => fileInput.current?.click()}><Icon name="upload" size={11} />{t('Subir audio')}</button>
        <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void accept(file, 'uploaded'); }} />
        {busy === 'prepare' && <span className="text-neutral-500">{t('Preparando el audio…')}</span>}
        {busy === 'transcribe' && <span className="text-neutral-500">{t('Transcribiendo…')}</span>}
      </div>
      {recorder.state === 'idle' && !draft && <div className="mt-2 rounded bg-neutral-50 p-2 text-xs leading-5 text-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
          <span>{t('Lee este párrafo al grabar')}</span>
          <button className="normal-case text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setParagraphIndex((index) => index + 1)}>{t('Otro párrafo')}</button>
        </div>
        {paragraph}
      </div>}
      {recorder.state !== 'idle' && <div className="mt-2">
        <p className="mb-2 rounded bg-neutral-50 p-2 text-sm leading-6 text-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-200">{paragraph}</p>
        <LocalAudioRecorderPanel recorder={recorder} accent={STUDY_MEDIA_ACCENT} testid="narration-voice-recorder" />
      </div>}
      {draft && <div className="mt-3 grid gap-2 text-xs" data-testid="narration-voice-draft">
        <div className="flex items-center gap-2">
          <audio controls src={draft.previewUrl} className="h-8" />
          <span className={draft.durationS < TTS_VOICE_RECOMMENDED_MIN_S || draft.durationS > TTS_VOICE_RECOMMENDED_MAX_S ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-500'}>
            {draft.durationS.toFixed(1)} s{(draft.durationS < TTS_VOICE_RECOMMENDED_MIN_S || draft.durationS > TTS_VOICE_RECOMMENDED_MAX_S) ? ` · ${tx('mejor entre {min} y {max} s', { min: TTS_VOICE_RECOMMENDED_MIN_S, max: TTS_VOICE_RECOMMENDED_MAX_S })}` : ''}
          </span>
        </div>
        <input className="input h-8 text-xs" placeholder={t('Nombre de la voz')} value={name} onChange={(event) => setName(event.target.value)} />
        <textarea className="input min-h-[4rem] text-xs" placeholder={cloneEngine === 'pocket' ? t('Transcripción (opcional con Pocket TTS)') : t('Transcripción exacta de lo que se oye en la grabación')} value={transcript} onChange={(event) => setTranscript(event.target.value)} aria-invalid={transcriptTooShort} />
        {transcriptTooShort && <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-400" data-testid="narration-voice-transcript-hint">
          {t('La transcripción es demasiado corta para el audio. Escribe exactamente lo que se dice en la grabación.')} ({transcript.trim().length}/{minimumTranscript})
        </p>}
        <label className="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          {t('Es mi voz o tengo permiso de su titular para usarla en una voz sintética.')}
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary h-7 px-3 text-[11px]" disabled={!consent || (cloneEngine !== 'pocket' && !transcript.trim()) || transcriptTooShort || busy === 'save'} onClick={() => void save()}>{t('Guardar voz')}</button>
          <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => { URL.revokeObjectURL(draft.previewUrl); setDraft(null); }}>{t('Descartar')}</button>
        </div>
      </div>}
    </div>

    {own.length > 0 && <>
      <h6 className="mt-4 text-[11px] font-medium text-neutral-500">{t('Mis voces')}</h6>
      <SettingsModelList className="mt-1">{own.map(row)}</SettingsModelList>
    </>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <h6 className="text-[11px] font-medium text-neutral-500">{t('Voces de Phonon')}</h6>
      <select className="input h-7 min-w-0 py-0 text-[11px]" value={phononLanguage} onChange={(event) => setPhononLanguage(event.target.value)} aria-label={t('Idioma')}>
        {TTS_LANGUAGES.filter((entry) => (PHONON_LANGUAGES as readonly string[]).includes(entry.code)).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
      </select>
    </div>
    <p className="mt-1 text-[10px] text-neutral-500">{t('Se usan con los modelos Phonon; tus voces grabadas funcionan con Ming y Pocket TTS. Cada voz se descarga la primera vez que la usas.')}</p>
    <SettingsModelList className="mt-1 max-h-72 overflow-y-auto">{phonon.map(row)}</SettingsModelList>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <h6 className="text-[11px] font-medium text-neutral-500">{t('Voces de Kokoro')}</h6>
      <select className="input h-7 min-w-0 py-0 text-[11px]" value={kokoroLanguage} onChange={(event) => setKokoroLanguage(event.target.value)} aria-label={t('Idioma')}>
        {TTS_LANGUAGES.filter((entry) => entry.code === 'es' || entry.code === 'en').map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
      </select>
      <select className="input h-7 min-w-0 py-0 text-[11px]" value={kokoroVoiceId} onChange={(event) => onSelect(event.target.value)} aria-label={t('Voz')} data-testid="narration-kokoro-voice">
        {kokoro.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.locale ? ` · ${voice.locale}` : ''}</option>)}
      </select>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <h6 className="text-[11px] font-medium text-neutral-500">{t('Voces de Pocket TTS')}</h6>
      <select className="input h-7 min-w-0 py-0 text-[11px]" value={pocketLanguage} onChange={(event) => setPocketLanguage(event.target.value)} aria-label={t('Idioma')} data-testid="narration-pocket-language">
        {TTS_LANGUAGES.filter((entry) => (POCKET_LANGUAGES as readonly string[]).includes(entry.code)).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
      </select>
    </div>
    <p className="mt-1 text-[10px] text-neutral-500">{t('Las voces predeterminadas se descargan con el modelo. Las demás voces oficiales son opcionales y también se descargan al usarlas. Cada voz conserva su licencia.')}</p>
    <p className="mt-1 text-[10px] text-neutral-500">{Object.values(POCKET_DEFAULT_VOICES).map((name) => name.replace(/^./, (letter) => letter.toUpperCase())).join(' · ')}</p>
    <SettingsModelList className="mt-1 max-h-72 overflow-y-auto" data-testid="narration-pocket-voices">{pocket.map(row)}</SettingsModelList>
    <h6 className="mt-4 text-[11px] font-medium text-neutral-500">{t('Voces de ejemplo (dominio público)')}</h6>
    <SettingsModelList className="mt-1">{bundled.map(row)}</SettingsModelList>
    <div className="mt-4 flex items-center gap-2">
      <button className="text-[11px] font-medium text-neutral-500 hover:text-indigo-500" onClick={() => setShowBuiltin((value) => !value)}>
        <Icon name={showBuiltin ? 'chevronDown' : 'chevronRight'} size={10} /> {tx('Voces integradas de Ming ({n})', { n: voices.filter((voice) => voice.origin === 'builtin').length })}
      </button>
      {showBuiltin && <input className="input h-6 w-40 px-2 py-0 text-[11px]" placeholder={t('Buscar…')} value={builtinFilter} onChange={(event) => setBuiltinFilter(event.target.value)} />}
    </div>
    {showBuiltin && <>
      <p className="mt-1 text-[10px] text-neutral-500">{t('Las voces integradas son inglesas y chinas: en otros idiomas hablan con su acento.')}</p>
      <SettingsModelList className="mt-1 max-h-72 overflow-y-auto">{builtin.map(row)}</SettingsModelList>
    </>}
  </div>;
}
