import type { EmbeddingRunCounters, EmbeddingRunReason } from '@shared/embeddingRuns';
import { EMBEDDING_RUN_REASON_LABELS } from '@shared/embeddingRuns';
import { t, tx } from '../i18n';
import { useEffect, useState } from 'react';
import type { EmbeddingIndexRun } from '@shared/embeddingRuns';
const states = { running: 'En curso', paused: 'Preparación pausada', cancelled: 'Preparación cancelada', error: 'Error de preparación', complete: 'Completado' } as const;

export function EmbeddingRunSummary({ run }: { run: EmbeddingRunCounters & { reason: EmbeddingRunReason; lastReason: EmbeddingRunReason } }) {
  return <div className="mt-2 space-y-1 text-xs text-neutral-500" data-testid="embedding-run-summary">
    <p>{t('Motivo')}: {t(EMBEDDING_RUN_REASON_LABELS[run.reason] ?? EMBEDDING_RUN_REASON_LABELS.legacy)}
      {run.lastReason !== run.reason && <> · {t(EMBEDDING_RUN_REASON_LABELS[run.lastReason] ?? EMBEDDING_RUN_REASON_LABELS.legacy)}</>}</p>
    <p>{tx('{n} revisados', { n: run.reviewed })} · {tx('{n} reutilizados', { n: run.reused })} · {tx('{n} calculados', { n: run.computed })} · {tx('{n} excluidos', { n: run.excluded })} · {tx('{n} fallidos', { n: run.failed })}</p>
    <p>{tx('{n} entradas solicitadas al modelo', { n: run.providerInputs })}</p>
  </div>;
}
export function EmbeddingRunHistory({ indexId, vaultId, updatedAt }: { indexId: string; vaultId?: string; updatedAt?: string }) {
  const [open, setOpen] = useState(false), [runs, setRuns] = useState<EmbeddingIndexRun[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (open) void window.nodus.listEmbeddingIndexRuns(indexId, vaultId).then(next => { if (active) { setRuns(next); setError(''); } }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [open, indexId, vaultId, updatedAt]);
  return <details className="mt-2 text-xs" onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('Historial de preparación')}</summary>
    {runs.map(run => <div key={run.id} className="border-b border-neutral-700 py-2"><p>{new Date(run.startedAt).toLocaleString()} · {t(states[run.state])}</p><EmbeddingRunSummary run={run} />{run.error && <p>{run.error}</p>}</div>)}
    {error && <p role="alert">{error}</p>}</details>;
}
