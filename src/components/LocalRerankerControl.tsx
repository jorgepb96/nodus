import { useEffect, useRef, useState } from 'react';
import type { LocalRerankerStatus } from '@shared/embeddingComparison';
import { LOCAL_RERANKER_MODELS, normalizeLocalRerankerId, type LocalRerankerModel } from '@shared/localRerankers';
import { t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { SettingsModelDot, SettingsModelList, settingsModelRowClass } from './SettingsModelList';
import { Icon } from './ui';

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

export function LocalRerankerControl({ enabled, selected, onChange, onSelect }: {
  enabled: boolean;
  selected: string | undefined;
  onChange: (enabled: boolean) => Promise<unknown>;
  onSelect: (modelId: string) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<LocalRerankerStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [deleting, setDeleting] = useState<LocalRerankerModel | null>(null);
  const cancelled = useRef(false), mounted = useRef(true);
  const selectedId = normalizeLocalRerankerId(selected);
  const refresh = () => window.nodus.getLocalRerankerStatus().then(next => { if (mounted.current) setStatus(next); });
  useEffect(() => { mounted.current = true; void refresh().catch(cause => { if (mounted.current) setError(String(cause)); }); return () => { mounted.current = false; }; }, [selectedId]);
  const models = status?.models ?? [];
  const downloading = models.some(model => model.downloading);
  useEffect(() => {
    if (!busy && !downloading) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 1000);
    return () => clearInterval(timer);
  }, [busy, downloading]);
  const run = async (key: string, action: () => Promise<LocalRerankerStatus | unknown>) => {
    setBusy(key); setError(''); cancelled.current = false;
    try { const next = await action(); if (mounted.current && next && typeof next === 'object' && 'models' in next) setStatus(next as LocalRerankerStatus); else await refresh(); }
    catch (cause) { if (mounted.current && !cancelled.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(''); }
  };
  const remove = () => {
    const model = deleting;
    setDeleting(null);
    if (model) void run(`delete:${model.id}`, async () => {
      const next = await window.nodus.deleteLocalReranker(model.id);
      // Reranking with a deleted model would silently do nothing: switch it off visibly.
      if (model.id === selectedId && enabled) await onChange(false);
      return next;
    });
  };
  const selectedReady = models.find(model => model.id === selectedId)?.available ?? false;
  return <div className="space-y-2 rounded-lg border border-neutral-700 p-3 text-sm" data-testid="local-reranker-control">
    <label className="flex gap-2"><input type="checkbox" checked={enabled && selectedReady} disabled={!selectedReady || Boolean(busy)} onChange={event => { void onChange(event.target.checked).catch(cause => setError(String(cause))); }} />{t('Reordenamiento local opcional')}</label>
    <p className="text-xs text-neutral-500">{t('Ordena los candidatos de la búsqueda documental con un modelo local. No modifica ni regenera embeddings. Si falla, se conserva el orden original.')}</p>
    <SettingsModelList data-testid="local-reranker-models">
      {LOCAL_RERANKER_MODELS.map(model => {
        const local = models.find(entry => entry.id === model.id);
        const isSelected = model.id === selectedId;
        return <article key={model.id} data-testid={`local-reranker-${model.id}`} className={settingsModelRowClass(isSelected, false, 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4')}>
          <div className="flex min-w-0 gap-2">
            <SettingsModelDot selected={isSelected} />
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <h5 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</h5>
                <button className="mt-0.5 text-neutral-400 hover:text-indigo-600 dark:text-neutral-600 dark:hover:text-indigo-300" title={t('Abrir fuente del modelo')} onClick={() => void window.nodus.openExternal(model.sourceUrl)}><Icon name="external" size={12} /></button>
              </div>
              <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">
                {megabytes(model.bytes)}{' · '}
                <button className="underline decoration-dotted underline-offset-2 hover:text-indigo-600 dark:hover:text-indigo-300" title={t('Abrir licencia del modelo')} onClick={() => void window.nodus.openExternal(model.licenseUrl)}>{model.licenseLabel}</button>
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-500">{t(model.description)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
            {local?.downloading
              ? <><span className="text-[10px] tabular-nums">{Math.round(local.progress * 100)}%</span>
                <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => { cancelled.current = true; void window.nodus.prepareLocalReranker('cancel', model.id).then(setStatus).catch(cause => setError(String(cause))); }}>{t('Cancelar descarga')}</button></>
              : local?.available
                ? <>
                  {isSelected
                    ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400">{t('En uso')}</span>
                    : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={Boolean(busy)} onClick={() => void run(`select:${model.id}`, () => onSelect(model.id))}>{t('Usar este modelo')}</button>}
                  <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" disabled={Boolean(busy)} onClick={() => setDeleting(model)}><Icon name="trash" size={10} />{t('Eliminar')}</button>
                </>
                : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={!status || Boolean(busy) || downloading} onClick={() => void run(`download:${model.id}`, async () => {
                  const next = await window.nodus.prepareLocalReranker('download', model.id);
                  // The first model a user downloads is the one they want to use.
                  if (!isSelected && !models.some(entry => entry.available)) await onSelect(model.id);
                  return next;
                })}><Icon name="download" size={10} />{tx('Descargar ({size})', { size: megabytes(model.bytes) })}</button>}
          </div>
        </article>;
      })}
    </SettingsModelList>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {deleting && <ConfirmModal
      title={t('Eliminar modelo local')}
      message={t('Se eliminará «{model}» del almacenamiento de Nodus. Si está seleccionado, las funciones que lo usan dejarán de funcionar hasta que elijas otro modelo o vuelvas a descargarlo.').replace('{model}', deleting.label)}
      confirmLabel={t('Eliminar modelo')}
      danger
      onConfirm={remove}
      onCancel={() => setDeleting(null)}
    />}
  </div>;
}
