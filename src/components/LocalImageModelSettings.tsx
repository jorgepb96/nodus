import { ipcErrorText } from '../lib/ipcErrorText';
import { useEffect, useState } from 'react';
import type { AppSettings } from '@shared/types';
import {
  NODUS_IMAGE_QUALITY_PRESETS,
  NODUS_LOCAL_IMAGE_MODEL,
  nodusLocalImageModelBytes,
  type NodusImageQuality,
  type NodusLocalImageStatus,
} from '@shared/localImageModels';
import { t } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`;
}

const QUALITY_LABELS: Record<NodusImageQuality, string> = {
  draft: 'Borrador · 640×384',
  balanced: 'Equilibrada · 896×512',
  high: 'Alta · 1152×640',
};

export function LocalImageModelSettings({
  settings,
  patch,
}: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const [status, setStatus] = useState<NodusLocalImageStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = async () => setStatus(await window.nodus.getNodusLocalImageStatus());
  useEffect(() => { void refresh().catch((cause) => setError(ipcErrorText(cause))); }, []);

  const activeTransfer = Boolean(status?.runtime.downloading || status?.model.downloading);
  useEffect(() => {
    if (!activeTransfer) return;
    const timer = window.setInterval(() => {
      void refresh().catch((cause) => setError(ipcErrorText(cause)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [activeTransfer]);

  const installRuntime = async () => {
    setBusy('runtime'); setProgress(0); setError('');
    try { setStatus(await window.nodus.installNodusLocalImageRuntime(setProgress)); }
    catch (cause) { setError(ipcErrorText(cause)); }
    finally { setBusy(''); }
  };

  const download = async () => {
    setBusy('model'); setProgress(0); setError('');
    try { setStatus(await window.nodus.downloadNodusLocalImageModel(NODUS_LOCAL_IMAGE_MODEL.id, setProgress)); }
    catch (cause) { setError(ipcErrorText(cause)); }
    finally { setBusy(''); }
  };

  const remove = async () => {
    setConfirmDelete(false); setBusy('delete'); setError('');
    try { setStatus(await window.nodus.deleteNodusLocalImageModel(NODUS_LOCAL_IMAGE_MODEL.id)); }
    catch (cause) { setError(ipcErrorText(cause)); }
    finally { setBusy(''); }
  };

  const selected = settings.imageProvider === 'nodus' && settings.imageModel === NODUS_LOCAL_IMAGE_MODEL.id;
  const downloaded = Boolean(status?.model.downloaded);
  const transferBusy = Boolean(busy || activeTransfer);
  const transferProgress = status?.model.downloading
    ? status.model.progress
    : status?.runtime.downloading ? status.runtime.progress : progress;

  return (
    <section className="card p-4 mb-4" data-testid="nodus-local-image-models">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{t('Generación de imágenes local')}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">
            {t('Descarga opcional: Nodus genera la imagen en este equipo, sin API, sin coste por uso y sin enviar el prompt a terceros.')}
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-xs ${status?.runtime.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'}`}>
          <div>{status?.runtime.ready
            ? `${t('Motor de imágenes listo')} · stable-diffusion.cpp`
            : <button className="inline-flex items-center gap-1" disabled={transferBusy} onClick={() => void installRuntime()}><Icon name={status?.runtime.downloading || busy === 'runtime' ? 'sync' : 'download'} className={status?.runtime.downloading || busy === 'runtime' ? 'animate-spin' : ''} size={12} />{status?.runtime.downloading || busy === 'runtime' ? t('Instalando motor…') : t('Instalar motor de imágenes')}</button>}
          </div>
          <button className="mt-1 text-[10px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100" title={t('Abrir licencia de stable-diffusion.cpp')} onClick={() => void window.nodus.openExternal('https://github.com/leejet/stable-diffusion.cpp/blob/b290693/LICENSE')}>stable-diffusion.cpp · MIT</button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-transparent">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{NODUS_LOCAL_IMAGE_MODEL.label}</h3>
              <button className="mt-0.5 text-neutral-400 hover:text-indigo-600 dark:text-neutral-600 dark:hover:text-indigo-300" title={t('Abrir fuente del modelo')} onClick={() => void window.nodus.openExternal(NODUS_LOCAL_IMAGE_MODEL.sourceUrl)}><Icon name="external" size={12} /></button>
            </div>
            <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">
              {NODUS_LOCAL_IMAGE_MODEL.quantization} · {formatBytes(nodusLocalImageModelBytes())} · 4 pasos{' · '}
              <button className="underline decoration-dotted underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-300" title={t('Abrir licencia del modelo')} onClick={() => void window.nodus.openExternal(NODUS_LOCAL_IMAGE_MODEL.licenseUrl)}>{NODUS_LOCAL_IMAGE_MODEL.licenseLabel}</button>
            </p>
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-neutral-600 dark:text-neutral-500">{t(NODUS_LOCAL_IMAGE_MODEL.description)}</p>
            <p className="mt-1 text-[10px] leading-4 text-neutral-500">{t('Incluye el encoder Qwen3 4B Q4 y el VAE de FLUX.2. Se recomiendan 16 GB de memoria unificada o 8 GB de VRAM.')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:max-w-[28rem] sm:justify-end">
            <span className={`mr-auto rounded-full px-2 py-1 text-[10px] font-medium sm:mr-0 ${downloaded ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>
              {downloaded ? t('Descargado') : status?.model.downloadedBytes ? `${formatBytes(status.model.downloadedBytes)} / ${formatBytes(status.model.totalBytes)}` : t('No descargado')}
            </span>
            {downloaded
              ? <>
                <button className={selected ? 'btn btn-primary h-7 px-2 text-[10px]' : 'btn btn-ghost h-7 px-2 text-[10px]'} disabled={selected || transferBusy} onClick={() => void patch({ imageProvider: 'nodus', imageModel: NODUS_LOCAL_IMAGE_MODEL.id })}><Icon name={selected ? 'check' : 'image'} size={10} />{selected ? t('Seleccionado') : t('Usar para generar imágenes')}</button>
                <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" disabled={transferBusy || status?.generating} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={10} />{t('Eliminar')}</button>
              </>
              : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={transferBusy} onClick={() => void download()}><Icon name={status?.model.downloading || busy === 'model' ? 'sync' : 'download'} className={status?.model.downloading || busy === 'model' ? 'animate-spin' : ''} size={10} />{status?.model.downloading || busy === 'model' ? t('Descargando…') : t('Descargar')}</button>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(12rem,20rem)_minmax(0,1fr)] sm:items-end">
        <label className="text-xs text-neutral-500">
          {t('Calidad')}
          <select
            data-testid="nodus-image-quality"
            className="input mt-1 w-full"
            value={settings.imageQuality}
            onChange={(event) => void patch({ imageQuality: event.target.value as NodusImageQuality })}
          >
            {NODUS_IMAGE_QUALITY_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(QUALITY_LABELS[preset.id])}</option>)}
          </select>
        </label>
        <p className="text-[11px] leading-4 text-neutral-500">{t('FLUX.2 Klein usa siempre sus 4 pasos recomendados; la calidad cambia la resolución, el consumo de memoria y el tiempo de generación.')}</p>
      </div>

      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
        {t('Licencia: esta integración usa FLUX.2 Klein 4B bajo Apache 2.0. La variante 9B tiene términos no comerciales diferentes y no se descarga.')}
      </div>
      {transferBusy && transferProgress > 0 && <div className="mt-4 h-1.5 overflow-hidden rounded bg-neutral-800" data-testid="nodus-local-image-download-progress"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, transferProgress * 100)}%` }} /></div>}
      {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
      {confirmDelete && <ConfirmModal
        title={t('Eliminar modelo local')}
        message={t('Se eliminarán FLUX.2 Klein 4B Q4 y sus componentes del almacenamiento de Nodus. Las imágenes ya generadas se conservarán.')}
        confirmLabel={t('Eliminar modelo')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />}
    </section>
  );
}
