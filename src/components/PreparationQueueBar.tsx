import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QueueActivity } from '../queueActivity';
import { preparationVersion } from '../queueActivity';
import { summarizePreparationQueue, type PreparationItemState, type PreparationQueueItem } from '../preparationQueue';
import { Icon } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { errorText, t, tx } from '../i18n';
import { EmbeddingRunSummary } from './EmbeddingRunSummary';

const STATE_LABELS: Record<PreparationItemState, string> = {
  queued: 'En cola', running: 'En curso', paused: 'Pausado', complete: 'Completado', failed: 'Fallido', cancelled: 'Cancelado', blocked: 'Fallido',
};
const STAGE_LABELS = { ocr: 'OCR', extraction: 'Extracción de texto', lexical: 'Búsqueda léxica', embeddings: 'Embeddings', complete: 'Completado' } as const;

/** What an indexing failure means, in the reader's words. */
export function preparationErrorText(error: string | null): string | null {
  if (!error) return null;
  return ({
    documentary_ocr_deferred: t('Documento omitido: necesita OCR. Puedes continuar con las demás fuentes.'),
    documentary_ocr_resources_missing: t('Faltan recursos de OCR local. Configura los idiomas instalados en Ajustes y reintenta.'),
    documentary_ocr_incomplete: t('El OCR no pudo leer todas las páginas escaneadas. Revisa el original y reintenta.'),
    documentary_embeddings_unavailable: t('El modelo de embeddings no está disponible. Revisa su configuración y reintenta.'),
    documentary_extraction_worker_unavailable: t('El proceso local de extracción no está disponible. Reinicia Nodus y reintenta.'),
    documentary_embedding_busy: t('Este documento ya se está indexando en otra tarea.'),
    documentary_embedding_job_unavailable: t('La indexación de este documento no pudo empezar. Reintenta.'),
  } as Record<string, string>)[error] ?? errorText(error);
}

function stageDetail(item: PreparationQueueItem): string {
  const stage = t(STAGE_LABELS[item.stage]);
  if (item.stage === 'embeddings' && item.totalPassages) return `${stage} · ${item.completedPassages}/${item.totalPassages}`;
  if ((item.stage === 'ocr' || item.stage === 'extraction') && item.totalPages) return `${stage} · ${item.currentPage ?? 0}/${item.totalPages}`;
  return stage;
}

/** Indexing (text and embeddings) as one Queue entry, the way Idea extraction shows:
 * one progress bar for the whole set, the document being processed, and one set of
 * controls; the documents themselves are a list that unfolds. */
export function PreparationQueueBar({ activity }: { activity: QueueActivity }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const summary = summarizePreparationQueue(activity.preparation);
  if (!summary.total) return null;
  const { items, total, settled, failed, running, percent, live, paused } = summary;
  const control = (campaignId: string, action: 'retry' | 'cancel', documentId: string) => window.nodus.controlResearchPreparationCampaign({ campaignId, action, documentId });
  const dismiss = () => { for (const campaign of activity.preparation.campaigns) activity.dismiss(`preparation:${campaign.id}`, preparationVersion(campaign)); };
  const embedding = running?.embedding ?? items[0]?.embedding;
  return (
    <div className="border-t border-neutral-200 bg-neutral-100/80 px-4 py-2 text-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80" data-testid="preparation-queue-bar">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost btn" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? '▾' : '▸'} {t('Indexación')}
        </button>
        <div className="order-last min-w-0 basis-full">
          <div className="mb-1 flex items-start justify-between gap-3 text-xs text-neutral-400">
            <span className="min-w-0 break-words" data-testid="preparation-queue-status">
              {running ? <>
                {settled} / {total} — {t('Indexando:')} <span className="text-neutral-200">{running.title}</span>
                <span className="ml-1 text-indigo-300">· {stageDetail(running)}</span>
              </> : paused ? t('Indexación en pausa')
                : live ? t('En cola…')
                  : `${total - failed} ${t('completados')}${failed ? `, ${failed} ${t('fallidos')}` : ''}`}
              {embedding && <span className="ml-1 text-neutral-500">· {embedding.provider} · {embedding.model}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-label={t('Indexación')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <motion.div className="h-full bg-indigo-500" animate={{ width: `${percent}%` }} transition={{ ease: 'easeOut', duration: 0.4 }} />
          </div>
        </div>
        {live && (paused
          ? <button className="btn btn-ghost" title={t('Reanudar la indexación')} aria-label={t('Reanudar la indexación')} onClick={() => void window.nodus.setResearchPreparationPaused(false)}><Icon name="play" size={16} /></button>
          : <button className="btn btn-ghost" title={t('Pausar la indexación')} aria-label={t('Pausar la indexación')} onClick={() => void window.nodus.setResearchPreparationPaused(true)}><Icon name="pause" size={16} /></button>)}
        {failed > 0 && (
          <button className="btn btn-ghost text-amber-300" title={tx('Reintentar {n} documento(s) cuya indexación falló', { n: failed })} aria-label={tx('Reintentar {n} fallidos', { n: failed })}
            data-testid="preparation-queue-retry" onClick={() => void window.nodus.controlAllResearchPreparation('retry')}>
            <Icon name="refresh" size={15} /> {failed}
          </button>
        )}
        {!live && (
          <button className={`btn btn-ghost ${failed > 0 ? 'text-amber-400' : 'text-emerald-400'}`} data-testid="preparation-queue-dismiss"
            title={failed > 0 ? t('Finalizado con fallos · ocultar') : t('Completado · ocultar')} aria-label={failed > 0 ? t('Finalizado con fallos · ocultar') : t('Completado · ocultar')} onClick={dismiss}>
            <Icon name={failed > 0 ? 'warning' : 'check'} size={17} />
          </button>
        )}
        {live && (
          <button className="btn btn-ghost text-red-400 hover:text-red-300" title={t('Detener la indexación')} aria-label={t('Detener la indexación')} onClick={() => setConfirmStop(true)}>
            <Icon name="stop" size={16} />
          </button>
        )}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            {activity.preparation.campaigns.filter(campaign => campaign.audit).map(campaign => <div key={campaign.id} className="py-2">
              <span className="text-xs">{campaign.vaultName} · {new Date(campaign.createdAt).toLocaleString()}</span><EmbeddingRunSummary run={campaign.audit!} /></div>)}
            <div className="mt-2 max-h-48 divide-y divide-neutral-800 overflow-y-auto">
              {items.map((item) => (
                <div key={item.documentId} data-testid={`preparation-item-${item.documentId}`} data-state={item.state} className="py-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.state !== 'complete' && <span className="mx-2 text-[10px] uppercase text-neutral-500">{stageDetail(item)}</span>}
                    <span className={item.state === 'complete' ? 'text-emerald-400' : item.state === 'failed' || item.state === 'blocked' ? 'text-red-400' : item.state === 'running' ? 'text-indigo-400' : 'text-neutral-500'}>
                      <span className="inline-flex items-center gap-1">{item.state === 'complete' && <Icon name="check" size={12} />}{t(STATE_LABELS[item.state])}</span>
                    </span>
                    {item.retryCampaignId && !item.liveCampaignIds.length && item.state !== 'complete' && (
                      <button className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-amber-300"
                        title={t('Reintentar indexado')} aria-label={`${t('Reintentar indexado')}: ${item.title}`}
                        onClick={() => void control(item.retryCampaignId!, 'retry', item.documentId)}><Icon name="refresh" size={13} /></button>
                    )}
                    {item.liveCampaignIds.length > 0 && (
                      <button className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                        title={t('Quitar de la indexación')} aria-label={`${t('Quitar de la indexación')}: ${item.title}`}
                        onClick={() => void Promise.all(item.liveCampaignIds.map((campaignId) => control(campaignId, 'cancel', item.documentId)))}><Icon name="x" size={13} /></button>
                    )}
                  </div>
                  {(item.state === 'failed' || item.state === 'blocked') && item.error && <p role="alert" className="mt-0.5 break-words text-red-400">{preparationErrorText(item.error)}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {confirmStop && (
        <ConfirmModal
          title={t('Detener la indexación')}
          message={t('Se cancelarán los documentos pendientes. Lo que ya está indexado se conserva.')}
          confirmLabel={t('Detener')}
          danger
          onConfirm={() => { void window.nodus.controlAllResearchPreparation('cancel'); setConfirmStop(false); }}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </div>
  );
}
