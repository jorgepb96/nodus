// The strip above the Deep Research gallery: what is being generated right now,
// how far along it is, and what is waiting behind it.
//
// One durable lane receives reports from this window and from MCP clients. The strip
// only needs their presentation shape and keeps the real job id for cancellation.
import type { DeepResearchJobOrigin, DeepResearchProgress } from '@shared/types';
import { deepResearchProgressPercent } from '@shared/deepResearchProgress';
import { Icon } from './ui';
import { errorText, t, tr, tx } from '../i18n';
import { elapsedTimeLabel } from '@shared/elapsedTime';
import { useElapsedClock } from '../useElapsedClock';

/** One row of the strip, whichever lane it came from. */
export interface QueueStripItem {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  /** The live progress of this report, already attributed to the right lane. */
  progress: DeepResearchProgress | null;
  /** Optional adapter fields for other durable research lanes. */
  percent?: number | null;
  detail?: string | null;
  error: string | null;
  origin: DeepResearchJobOrigin;
  enqueuedAt: string;
}

/** Marks a report someone asked for through MCP, so a queue the user did not fill is not a mystery. */
function OriginBadge({ origin }: { origin: 'mcp' | 'mobile' }) {
  return (
    <span
      className="shrink-0 rounded border border-indigo-800/70 bg-indigo-950/40 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-indigo-300"
      title={origin === 'mobile' ? t('Pedido desde el móvil') : t('Pedido desde un cliente MCP')}
    >
      {origin === 'mobile' ? t('Móvil') : t('MCP')}
    </span>
  );
}

export function progressDetail(progress: DeepResearchProgress | null): string | null {
  if (!progress) return null;
  // Core messages follow the requested report language. The queue belongs to the
  // application chrome, though, so derive its stable copy from the structured phase
  // in the active interface language. This also prevents legacy IPC error
  // localization from replacing an ordinary Spanish progress sentence with a
  // generic English error while the report is still running.
  const message = (() => {
    switch (progress.phase) {
      case 'discovery':
      case 'snapshot': return t('Reuniendo el corpus');
      case 'document_preparation': return t('Preparando evidencia documental');
      case 'planning': return t('Planificando secciones');
      case 'section': return progress.sectionTitle
        ? `${t('Redactando secciones')}: ${progress.sectionTitle}`
        : t('Redactando secciones');
      case 'coverage': return t('Ampliando cobertura');
      case 'assembling': return t('Ensamblando y referenciando');
      case 'done': return t('Informe listo');
      default: return tr(progress.message);
    }
  })();
  return progress.pagesSoFar != null ? `${message} · ~${progress.pagesSoFar} ${t('pág.')}` : message;
}

/**
 * The bar under the report being generated.
 *
 * A report takes minutes, so a spinner and a sentence left no way to tell one that
 * had just started from one about to land — least of all with several queued behind
 * it. The percentage comes from the phases the pipeline already reports (see
 * shared/deepResearchProgress.ts), so it is measured work, not a timer.
 */
function QueueProgressBar({ progress, explicitPercent }: { progress: DeepResearchProgress | null; explicitPercent?: number | null }) {
  const percent = explicitPercent ?? deepResearchProgressPercent(progress);
  return (
    <div
      className="mt-1.5 h-1.5 overflow-hidden rounded bg-neutral-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-label={t('Progreso del informe en curso')}
      data-testid="deep-research-progress"
    >
      <div
        className="h-full bg-indigo-500 transition-all duration-500"
        // A bar at literal 0% looks broken rather than early, so the first sliver is
        // always visible once the report is actually running.
        style={{ width: `${Math.max(percent ?? 0, 3)}%` }}
      />
    </div>
  );
}

export function DeepResearchQueueStrip({
  active,
  failed,
  running,
  onRemove,
  onClearFinished,
}: {
  active: QueueStripItem[];
  failed: QueueStripItem[];
  running: boolean;
  onRemove: (item: QueueStripItem) => void;
  onClearFinished: () => void;
}) {
  const now = useElapsedClock(active.length > 0);
  const queueStartedAt = active.reduce<string | null>(
    (earliest, item) => !earliest || item.enqueuedAt < earliest ? item.enqueuedAt : earliest,
    null,
  );
  const totalElapsed = elapsedTimeLabel(queueStartedAt, null, now);
  const displayTitle = (item: QueueStripItem): string => item.title === 'Informe sin título' ? t(item.title) : item.title;
  return (
    <div className="border-b border-neutral-800 bg-indigo-950/15 px-4 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-300">
        <Icon name={running ? 'sync' : 'layers'} size={12} className={running ? 'animate-spin' : ''} />
        {tx('Cola de generación · {n} en curso', { n: active.length })}
        {totalElapsed && <span className="whitespace-nowrap font-medium normal-case tabular-nums text-neutral-500">· {t('Total')} {totalElapsed}</span>}
        {failed.length > 0 && (
          <button className="ml-auto text-[11px] font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200" onClick={onClearFinished}>
            {t('Limpiar fallidos')}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {active.map((item, index) => {
          const queuePosition = index + 1;
          const percent = item.status === 'running' ? item.percent ?? deepResearchProgressPercent(item.progress) : null;
          return (
            <div key={item.id} className="rounded-md border border-neutral-800 bg-neutral-950/40 px-2.5 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums text-indigo-300"
                  aria-label={`${t('En cola')} ${queuePosition}`}
                  data-testid={`deep-research-queue-position-${item.id}`}
                >
                  {queuePosition}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-300 max-md:basis-[calc(100%-2rem)]" title={displayTitle(item)}>{displayTitle(item)}</span>
                {item.origin !== 'app' && <OriginBadge origin={item.origin} />}
                <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                  {elapsedTimeLabel(item.enqueuedAt, null, now)}
                </span>
                {item.status === 'running' ? (
                  <>
                    <span className="min-w-0 text-[11px] text-indigo-300 max-md:order-last max-md:basis-full max-md:break-words md:max-w-[45%] md:truncate" title={item.detail ?? progressDetail(item.progress) ?? undefined}>{item.detail ?? progressDetail(item.progress) ?? t('Generando…')}</span>
                    {percent !== null && (
                      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-indigo-400">{`${percent}%`}</span>
                    )}
                  </>
                ) : (
                  <span className="shrink-0 text-[11px] text-neutral-500">{t('En cola')}</span>
                )}
                <button
                  className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-red-950/50 hover:text-red-400 max-md:min-h-11 max-md:min-w-11"
                  onClick={() => onRemove(item)}
                  title={t('Quitar de la cola')}
                  aria-label={t('Quitar de la cola')}
                  data-testid={`remove-deep-research-${item.id}`}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {item.status === 'running' && <QueueProgressBar progress={item.progress} explicitPercent={item.percent} />}
            </div>
          );
        })}
        {failed.map((item) => (
          <div key={item.id} className="flex items-center gap-2 max-md:flex-wrap rounded-md border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 text-xs">
            <Icon name="alert" size={12} className="text-red-700 dark:text-red-300" />
            <span
              className="min-w-0 flex-1 truncate text-red-700 dark:text-red-300"
              title={item.error ? errorText(item.error) : displayTitle(item)}
            >
              {displayTitle(item)}
            </span>
            {item.origin !== 'app' && <OriginBadge origin={item.origin} />}
            <span className="max-w-[45%] shrink-0 truncate text-[11px] text-red-700 dark:text-red-300 max-md:max-w-full max-md:basis-full max-md:whitespace-normal max-md:break-words" title={item.error ? errorText(item.error) : undefined}>
              {item.error ? `${t('Falló')}: ${errorText(item.error)}` : t('Falló')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
