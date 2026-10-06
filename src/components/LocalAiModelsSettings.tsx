import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import {
  NODUS_LOCAL_MODELS,
  nodusLocalModelBytes,
  type NodusLocalAiStatus,
  type NodusLocalModelDefinition,
} from '@shared/localAiModels';
import { t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { SettingsModelList, settingsModelRowClass } from './SettingsModelList';
import { LocalModelWarning } from './LocalModelWarning';
import { Icon } from './ui';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`;
}

export function LocalAiModelsSettings({
  settings,
  patch,
}: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const [status, setStatus] = useState<NodusLocalAiStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<NodusLocalModelDefinition | null>(null);

  const exposeDownloadedChatModels = async (nextStatus: NodusLocalAiStatus) => {
    const downloaded = new Set(nextStatus.models.filter((model) => model.downloaded).map((model) => model.id));
    const additions: ModelRef[] = NODUS_LOCAL_MODELS
      .filter((model) => model.kind === 'chat' && downloaded.has(model.id))
      .map((model) => ({ provider: 'nodus', model: model.id }));
    const favorites = [...settings.favorites];
    for (const addition of additions) {
      if (!favorites.some((favorite) => favorite.provider === addition.provider && favorite.model === addition.model)) favorites.push(addition);
    }
    if (favorites.length !== settings.favorites.length) await patch({ favorites });
  };

  const refresh = async () => {
    const nextStatus = await window.nodus.getNodusLocalAiStatus();
    setStatus(nextStatus);
    await exposeDownloadedChatModels(nextStatus);
  };
  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, []);

  const activeTransfer = Boolean(status?.runtime.downloading || status?.models.some((model) => model.downloading));
  useEffect(() => {
    if (!activeTransfer) return;
    const timer = window.setInterval(() => {
      void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [activeTransfer]);

  const installed = useMemo(() => new Map(status?.models.map((model) => [model.id, model]) ?? []), [status]);

  const installRuntime = async () => {
    setBusy('runtime'); setProgress(0); setError('');
    try { setStatus(await window.nodus.installNodusLocalRuntime(setProgress)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const recheckRuntime = async () => {
    setBusy('runtime'); setProgress(0); setError('');
    try { setStatus(await window.nodus.recheckNodusLocalRuntime()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const calibrateModel = async (model: NodusLocalModelDefinition) => {
    setBusy(`calibrate:${model.id}`); setError('');
    try { setStatus(await window.nodus.calibrateNodusLocalModel(model.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const download = async (model: NodusLocalModelDefinition) => {
    setBusy(model.id); setProgress(0); setError('');
    try {
      // One main-process request owns the runtime dependency and every model asset,
      // so navigation cannot strand the operation between renderer-side awaits.
      const nextStatus = await window.nodus.downloadNodusLocalModel(model.id, setProgress);
      setStatus(nextStatus);
      await exposeDownloadedChatModels(nextStatus);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const remove = async () => {
    if (!deleting) return;
    const model = deleting;
    setDeleting(null); setBusy(`delete:${model.id}`); setError('');
    try {
      setStatus(await window.nodus.deleteNodusLocalModel(model.id));
      if (model.kind === 'chat') {
        await patch({ favorites: settings.favorites.filter((favorite) => !(favorite.provider === 'nodus' && favorite.model === model.id)) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const activeModelTransfer = status?.models.find((model) => model.downloading);
  const transferProgress = activeModelTransfer?.progress
    ?? (status?.runtime.downloading ? status.runtime.progress : progress);
  const transferBusy = Boolean(busy || activeTransfer);

  const renderModelList = (kind: NodusLocalModelDefinition['kind']) => (
    <SettingsModelList
      className="mt-3"
      data-testid={kind === 'embedding' ? 'nodus-local-embedding-list' : 'nodus-local-chat-list'}
    >
      {NODUS_LOCAL_MODELS.filter((model, index, all) => model.kind === kind && (!model.assetFamily || all.findIndex(other => other.assetFamily === model.assetFamily) === index)).map((model) => {
        const local = installed.get(model.id);
        const downloaded = Boolean(local?.downloaded);
        const runtimeReady = model.runtime !== 'llama_cpp' || Boolean(status?.runtime.ready);
        return <article key={model.id} data-testid={`local-model-${model.id}`} className={settingsModelRowClass(false, false, 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4')}>
          <div className="min-w-0">
              <div className="flex items-start gap-2">
                <h5 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.assetFamily ? 'EmbeddingGemma 2 Q8 · 256 / 512' : model.label}</h5>
                {model.validation === 'experimental' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/35 dark:text-amber-400">{t('Experimental')}</span>}
                <button className="mt-0.5 text-neutral-400 hover:text-indigo-600 dark:text-neutral-600 dark:hover:text-indigo-300" title={t('Abrir fuente del modelo')} onClick={() => void window.nodus.openExternal(model.sourceUrl)}><Icon name="external" size={12} /></button>
              </div>
              <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">
                {model.quantization} · {formatBytes(nodusLocalModelBytes(model))}{model.assetFamily ? ' · 256 / 512d' : model.dimensions ? ` · ${model.dimensions}d` : ''}{model.vision ? ` · ${t('entrada de imagen')}` : ''}{' · '}
                <button className="underline decoration-dotted underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-300" title={t('Abrir licencia del modelo')} onClick={() => void window.nodus.openExternal(model.licenseUrl)}>{t(model.licenseLabel)}</button>
              </p>
              <p className="mt-1.5 max-w-3xl text-xs leading-5 text-neutral-600 dark:text-neutral-500">{t(model.description)}</p>
              {model.assetFamily && <p className="mt-1 text-xs text-neutral-500">{t('Los perfiles de 256 y 512 dimensiones comparten una única descarga. Eliminarla afecta a ambos.')}</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:max-w-[25rem] sm:justify-end">
            <span className={`mr-auto rounded-full px-2 py-1 text-[10px] font-medium sm:mr-0 ${downloaded ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>
              {downloaded ? t('Descargado') : local?.downloadedBytes ? `${formatBytes(local.downloadedBytes)} / ${formatBytes(local.totalBytes)}` : t('No descargado')}
            </span>
            {downloaded
              ? <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" disabled={transferBusy} onClick={() => setDeleting(model)}><Icon name="trash" size={10} />{t('Eliminar')}</button>
              : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={transferBusy} onClick={() => void download(model)}><Icon name={local?.downloading || busy === model.id ? 'sync' : 'download'} className={local?.downloading || busy === model.id ? 'animate-spin' : ''} size={10} />{local?.downloading && status?.runtime.downloading ? t('Preparando motor…') : local?.downloading || busy === model.id ? t('Descargando…') : t('Descargar')}</button>}
            {downloaded && model.runtime === 'llama_cpp' && !status?.runtime.processedOnCpu && (
              <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={transferBusy} title={t('Mide cuántas peticiones simultáneas admite este equipo. No se ejecuta automáticamente.')} onClick={() => void calibrateModel(model)}>
                <Icon name={busy === `calibrate:${model.id}` ? 'sync' : 'scale'} className={busy === `calibrate:${model.id}` ? 'animate-spin' : ''} size={10} />{t('Medir concurrencia')}
              </button>
            )}
            {downloaded && !runtimeReady && <span className="w-full text-right text-[10px] text-amber-600 dark:text-amber-400">{t('Instala el motor local para poder usar este modelo.')}</span>}
          </div>
        </article>;
      })}
    </SettingsModelList>
  );

  return <div className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/35" data-testid="nodus-local-ai-models">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-200">{t('Modelos locales integrados')}</h4>
          {/* Everything on this panel runs on the user's machine, so the caveat belongs
              here too: downloading a model is the moment the cost becomes real. */}
          <LocalModelWarning provider="nodus" testId="bundled-local-models-warning" />
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{t('Los modelos no vienen incluidos. Nodus los descarga bajo demanda, los ejecuta en tu equipo y no envía el contenido a terceros.')}</p>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-xs ${status?.runtime.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'}`}>
        <div>{status?.runtime.ready
          ? `${t('Motor local listo')} · llama.cpp ${status.runtime.version}`
          : <button className="inline-flex items-center gap-1" disabled={transferBusy} onClick={() => void installRuntime()}><Icon name={status?.runtime.downloading || busy === 'runtime' ? 'sync' : 'download'} className={status?.runtime.downloading || busy === 'runtime' ? 'animate-spin' : ''} size={12} />{status?.runtime.downloading || busy === 'runtime' ? t('Instalando motor…') : t('Instalar motor local')}</button>}</div>
        <button className="mt-1 text-[10px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100" title={t('Abrir licencia de llama.cpp')} onClick={() => void window.nodus.openExternal('https://github.com/ggml-org/llama.cpp/blob/b10002/LICENSE')}>llama.cpp · MIT</button>
      </div>
    </div>

    {status?.runtime.ready && <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/40" data-testid="nodus-local-runtime-diagnostics">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.runtime.processedOnCpu ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
          {status.runtime.processedOnCpu ? t('Ejecutando en CPU') : t('Aceleración por GPU activa')}
        </span>
        <span className="text-[11px] text-neutral-600 dark:text-neutral-400">{status.runtime.asset ?? `llama.cpp ${status.runtime.version}`}</span>
      </div>
      {status.runtime.device && <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400">{tx('Dispositivo: {device}', { device: `${status.runtime.device.backend}${status.runtime.device.index} · ${status.runtime.device.name} · ${status.runtime.device.totalMiB} MiB` })}</p>}
      {status.runtime.offload && <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-400">{tx('Capas en GPU: {layers} de {total}', { layers: status.runtime.offload.layers, total: status.runtime.offload.totalLayers })}{status.runtime.offload.fitted ? ` · ${t('ajustado a la memoria libre')}` : ''}</p>}
      {status.runtime.nvidia && <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">{status.runtime.nvidia.detected ? tx('GPU NVIDIA detectada · controlador {driver}', { driver: status.runtime.nvidia.driver ?? t('desconocido') }) : t('No se detectó una GPU NVIDIA (no es necesaria)')}</p>}
      {status.calibration && <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-500">{status.calibration.measured
        ? `${tx('Concurrencia medida: {slots} ranura(s)', { slots: status.calibration.slots })}${status.calibration.reason ? ` · ${tx('motivo: {reason}', { reason: status.calibration.reason })}` : ''}`
        : t('Sin medir: se usa 1 ranura')}</p>}
      {status.runtime.fallbackReason && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{tx('Se instaló el motor de CPU: {reason}', { reason: status.runtime.fallbackReason })}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={transferBusy} onClick={() => void recheckRuntime()}><Icon name={busy === 'runtime' ? 'sync' : 'refresh'} className={busy === 'runtime' ? 'animate-spin' : ''} size={10} />{t('Revisar motor')}</button>
      </div>
      {status.runtime.logPath && <p className="mt-1 break-all text-[10px] text-neutral-500 dark:text-neutral-500">{tx('Diagnóstico del motor: {path}', { path: status.runtime.logPath })}</p>}
      <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-500">{t('Si el motor no arranca, excluye esa carpeta en tu antivirus.')}</p>
    </div>}

    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
      <strong>{t('Importante sobre los embeddings:')}</strong> {t('si cambias de modelo, los embeddings creados con el modelo anterior no son compatibles y deberán regenerarse.')}
    </div>

    <div className="mt-5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Embeddings locales')}</h5>
      {renderModelList('embedding')}
    </div>
    <div className="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Conversación, resúmenes e ideas con entrada de imagen')}</h5>
      <p className="mt-1 text-xs text-neutral-600">{t('Estos modelos aceptan texto e imágenes como entrada; no generan imágenes.')}</p>
      {renderModelList('chat')}
    </div>

    {transferBusy && transferProgress > 0 && <div className="mt-4 h-1.5 overflow-hidden rounded bg-neutral-800" data-testid="nodus-local-download-progress"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, transferProgress * 100)}%` }} /></div>}
    {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
    {deleting && <ConfirmModal
      title={t('Eliminar modelo local')}
      message={(deleting.assetFamily ? t('Se eliminarán los pesos compartidos de los perfiles de 256 y 512 dimensiones.') + ' ' : '') + t('Se eliminará «{model}» del almacenamiento de Nodus. Si está seleccionado, las funciones que lo usan dejarán de funcionar hasta que elijas otro modelo o vuelvas a descargarlo.').replace('{model}', deleting.label)}
      confirmLabel={t('Eliminar modelo')}
      danger
      onConfirm={() => void remove()}
      onCancel={() => setDeleting(null)}
    />}
  </div>;
}
