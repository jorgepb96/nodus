import { clearBackgroundJob, cancelAudioGeneration, type AudioGenerationRequest } from '../backgroundJobs';
import { useEffect, useState, type ReactNode } from 'react';
import type { QueueActivity } from '../queueActivity';
import { DICTIONARY_FINISHED, DOCUMENT_LIVE, backgroundFailure, ocrVersion, researchVersion, runtimeVersion } from '../queueActivity';
import { deepResearchProgressPercent } from '@shared/deepResearchProgress';
import { PreparationQueueBar } from './PreparationQueueBar';
import { progressDetail } from './DeepResearchQueueStrip';
import { errorText, t, tr, tx } from '../i18n';

function Task({ title, detail, error, percent, children, testId }: { title: string; detail?: string | null; error?: string | null; percent?: number | null; children?: ReactNode; testId: string }) {
  return <section data-testid={testId} className="border-t border-neutral-800 px-4 py-3 text-xs">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1 break-words font-medium text-neutral-200">{title}</span>
      <div className="flex shrink-0 flex-wrap gap-1">{children}</div>
    </div>
    {detail && <p className="mt-1 break-words text-neutral-400">{detail}</p>}
    {error && <p role="alert" className="mt-1 break-words text-red-400">{errorText(error)}</p>}
    {percent != null && <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-neutral-800" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, percent))}>
        <div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div><span className="shrink-0 tabular-nums text-neutral-400">{Math.round(percent)}%</span>
    </div>}
  </section>;
}
function Action({ label, run }: { label: string; run: () => unknown | Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <><button className="btn btn-ghost !px-2 !py-1 !text-xs" disabled={busy} onClick={() => {
    setBusy(true); setError(null);
    void Promise.resolve().then(run).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
  }}>{label}</button>{error && <span role="alert" className="max-w-64 break-words text-red-400">{error}</span>}</>;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const EXTRACTION_PHASE = { queued: 'En cola', analyze: 'Analizando PDF…', extract: 'Extracción de texto', ocr: 'OCR', assets: 'Archivos', write: 'Guardando…', done: 'Completado' };

export function AdditionalQueueTasks({ activity }: { activity: QueueActivity }) {
  const [limit, setLimit] = useState(50);
  const [dictionaryTitles, setDictionaryTitles] = useState<Record<string, string>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const itemIds = [...new Set(activity.extraction.slice(0, limit).map((job) => job.itemId))].sort().join('\n');
  useEffect(() => {
    let cancelled = false;
    if (itemIds) void Promise.all(itemIds.split('\n').map(async (id) => {
      const item = await window.nodus.getGlobalLibraryItem(id).catch(() => null);
      return [id, item?.metadata.title ?? t('Documento')] as const;
    })).then((items) => { if (!cancelled) setTitles(Object.fromEntries(items)); });
    return () => { cancelled = true; };
  }, [itemIds]);
  const dictionaryIds = activity.dictionary.slice(0, limit).map((job) => job.entryId).sort().join('\n');
  useEffect(() => {
    let cancelled = false;
    if (dictionaryIds) void Promise.all(dictionaryIds.split('\n').map(async (id) => {
      const detail = await window.nodus.getDictionaryEntry(id).catch(() => null);
      return [id, detail?.entry.name ?? t('Diccionario')] as const;
    })).then((items) => { if (!cancelled) setDictionaryTitles(Object.fromEntries(items)); });
    return () => { cancelled = true; };
  }, [dictionaryIds]);
  return <>
    {/* The Codex and Copilot CLIs download at first use, also when a task is what asked. */}
    {activity.runtimes.map((task) => <Task key={task.kind} testId={`agent-runtime-${task.kind}`}
      title={`${t('Motor oficial')} · ${task.kind === 'codex' ? 'Codex' : 'GitHub Copilot'}`}
      detail={task.state === 'installing'
        ? `${t('Descargando el motor oficial…')}${task.totalBytes ? '' : ` ${(task.receivedBytes / 1048576).toFixed(0)} MB`}`
        : t('La descarga del motor oficial ha fallado.')}
      percent={task.state === 'installing' && task.totalBytes ? task.receivedBytes / task.totalBytes * 100 : null}>
      {task.state === 'failed' && <>
        <Action label={t('Reintentar')} run={() => task.kind === 'codex'
          ? window.nodus.installChatGptSubscriptionRuntime()
          : window.nodus.installGitHubCopilotSubscriptionRuntime()} />
        <Action label={t('Ocultar')} run={() => activity.dismiss(`agent-runtime:${task.kind}`, runtimeVersion(task))} />
      </>}
    </Task>)}
    {/* Indexing is one entry, like Idea extraction: one bar, one set of controls. */}
    <PreparationQueueBar activity={activity} />
    {activity.extraction.slice(0, limit).map((job) => {
      const live = job.status === 'queued' || job.status === 'processing';
      return <Task key={job.id} testId={`library-extraction-${job.id}`} title={`${t('Extracción de texto')} · ${titles[job.itemId] ?? t('Documento')}`}
        detail={job.message ? tr(job.message) : t(job.status === 'canceled' ? 'Cancelado' : EXTRACTION_PHASE[job.phase])} error={job.status === 'failed' ? job.error : null} percent={job.progress * 100}>
        {live ? <Action label={t('Cancelar')} run={() => window.nodus.cancelLibraryExtraction(job.id)} /> : <>
          {(job.status === 'failed' || job.status === 'canceled') && <Action label={t('Reintentar')} run={() => window.nodus.retryLibraryExtraction(job.id)} />}
          <Action label={t('Ocultar')} run={() => activity.dismiss(`extraction:${job.id}`, `${job.status}:${job.updatedAt}`)} />
        </>}
      </Task>;
    })}
    {activity.documents?.campaigns.filter((job) => !DOCUMENT_LIVE.has(job.status)).slice(0, limit).map((job) => <Task key={job.campaignId} testId={`document-result-${job.campaignId}`}
      title={t('Ficha documental')} detail={`${t(job.status === 'cancelled' ? 'Cancelado' : job.status === 'failed' ? 'Fallido' : 'Completado')} · ${tx('{done} de {total} obras', { done: job.completedJobs, total: job.totalJobs })}`}
      error={job.status === 'cancelled' ? null : job.error ?? activity.documents?.jobs.find((item) => item.campaignId === job.campaignId && item.error)?.error ?? (job.failedJobs > 0 ? `${job.failedJobs} ${t('fallidos')}` : null)}>
      <Action label={t('Ocultar')} run={() => activity.dismiss(`documents:${job.campaignId}`, `${job.status}:${job.updatedAt}`)} />
    </Task>)}
    {activity.research.slice(0, limit).map((job) => {
      const live = job.status === 'queued' || job.status === 'running';
      return <Task key={job.id} testId={`research-task-${job.id}`} title={`${t('Deep Research')} · ${job.title}`}
        detail={job.status === 'running' ? progressDetail(job.progress) : t(job.status === 'queued' ? 'En cola' : job.status === 'cancelled' ? 'Cancelado' : job.status === 'failed' ? 'Fallido' : 'Completado')}
        error={job.saveError ?? (job.status === 'cancelled' ? null : job.error)} percent={job.status === 'running' ? deepResearchProgressPercent(job.progress) : null}>
        {live ? <Action label={t('Cancelar')} run={() => window.nodus.cancelDeepResearchJob(job.id)} /> : <Action label={t('Ocultar')} run={() => activity.dismiss(`research:${job.id}`, researchVersion(job))} />}
      </Task>;
    })}
    {activity.ocr.slice(0, limit).map((job) => {
      const live = job.status === 'pending' || job.status === 'processing';
      return <Task key={job.id} testId={`ocr-task-${job.id}`} title={`${t('OCR')} · ${job.name ?? t('Documento')}`}
        detail={t(job.status === 'pending' ? 'En cola' : job.status === 'processing' ? 'Procesando…' : job.status === 'cancelled' ? 'Cancelado' : job.status === 'error' ? 'Fallido' : 'Completado')}
        error={job.status === 'cancelled' ? null : job.error ?? (job.errorCount > 0 ? `${job.errorCount} ${t('fallidos')}` : null)} percent={job.pageCount ? job.doneCount / job.pageCount * 100 : null}>
        {live ? <Action label={t('Cancelar')} run={() => window.nodus.cancelOcrDoc(job.id)} /> : <Action label={t('Ocultar')} run={() => activity.dismiss(`ocr:${job.id}`, ocrVersion(job))} />}
      </Task>;
    })}
    {activity.background.slice(0, limit).map((job) => {
      const progress = record(job.progress);
      const result = record(job.result);
      const failure = backgroundFailure(job);
      const title = job.key === 'toolkit:convert' ? t('Nodus Convert') : job.key === 'toolkit:translate' ? t('Nodus Translate')
        : job.key.startsWith('audio:') ? t('Audio') : job.key.startsWith('database:') ? t('Bases de datos')
          : job.key.startsWith('deep-research:') ? t('Deep Research') : t('Inmersión');
      const percent = typeof progress.pct === 'number' ? progress.pct * 100
        : typeof progress.done === 'number' && typeof progress.total === 'number' && progress.total > 0 ? progress.done / progress.total * 100 : null;
      const detail = job.status !== 'running' ? t(result.cancelled ? 'Cancelado' : job.status === 'failed' ? 'Fallido' : 'Completado')
        : typeof progress.message === 'string' ? tr(progress.message) : typeof progress.label === 'string' ? tr(progress.label) : t('Procesando…');
      const cancel = job.key === 'toolkit:convert' && typeof progress.jobId === 'string' ? () => window.nodus.cancelToolkitJob(progress.jobId as string)
        : job.key === 'toolkit:translate' && typeof progress.jobId === 'string' ? () => window.nodus.cancelTranslateJob(progress.jobId as string)
          : job.key.startsWith('audio:') ? () => { const request = job.request as AudioGenerationRequest; cancelAudioGeneration(request.entityKind, request.entityId); } : null;
      return <Task key={job.id} testId={`background-task-${job.id}`} title={title} detail={detail} error={typeof failure === 'number' ? `${failure} ${t('fallidos')}` : failure} percent={percent}>
        {job.status === 'running' ? cancel && <Action label={t('Cancelar')} run={cancel} /> : <Action label={t('Ocultar')} run={() => clearBackgroundJob(job.key, job.id)} />}
      </Task>;
    })}
    {activity.dictionary.slice(0, limit).map((job) => <Task key={job.entryId} testId={`dictionary-task-${job.entryId}`} title={`${t('Diccionario')} · ${dictionaryTitles[job.entryId] ?? t('Generando…')}`}
      detail={tr(job.message)} error={job.error}>
      {DICTIONARY_FINISHED.has(job.phase) && <Action label={t('Ocultar')} run={() => activity.dismiss(`dictionary:${job.entryId}`, job.phase)} />}
    </Task>)}
    {[activity.preparation.campaigns.length, ...activity.preparation.campaigns.map(campaign => campaign.jobs.length), activity.extraction.length, activity.documents?.campaigns.length ?? 0, activity.research.length, activity.ocr.length, activity.background.length, activity.dictionary.length].some((size) => size > limit) && (
      <button className="btn btn-ghost m-3" onClick={() => setLimit((current) => current + 50)}>{t('Mostrar más')}</button>
    )}
  </>;
}
