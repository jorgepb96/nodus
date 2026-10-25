import { useEffect, useRef, useState } from 'react';
import type { ResearchRunMode, ResearchRunSummary } from '@shared/researchHarness';
import { t } from '../i18n';

const reasons = { sufficient: 'Evidencia suficiente', diminishing_returns: 'Sin más avances útiles', sources_exhausted: 'Sin más fuentes útiles', budget: 'Límites alcanzados', technical: 'Investigación incompleta', interrupted: 'En pausa', context_changed: 'El contexto ha cambiado' } as const;
const states = { running: 'En curso', paused: 'En pausa', completed: 'Completada', cancelled: 'Cancelada', failed: 'Error' } as const;
const questionStates = { pending: 'Pendiente', supported: 'Evidencia suficiente', partial: 'Parcial', contradictory: 'Contradicción', unresolved: 'Sin resolver' } as const;

/** A durable operational summary. It deliberately exposes no model reasoning. */
export function ResearchHarnessPanel({ mode, conversationId, entryId, onResumed }: { mode: ResearchRunMode; conversationId?: string | null; entryId?: string | null; onResumed?: () => void }) {
  const [runs, setRuns] = useState<ResearchRunSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(''); owner.current = `${mode}:${conversationId ?? ''}:${entryId ?? ''}`;
  useEffect(() => {
    let active = true;
    const accepts = (run: ResearchRunSummary) => run.mode === mode && (mode !== 'chat' || (!!conversationId && run.conversationId === conversationId)) && (!entryId || run.entryId === entryId);
    const refresh = () => { void window.nodus.listResearchRuns?.(conversationId ?? undefined, entryId ?? undefined).then(next => { if (active) setRuns(next.filter(accepts)); }).catch(() => undefined); };
    setRuns([]); refresh();
    const unsubscribe = window.nodus.onResearchRun?.(run => {
      if (active && accepts(run)) setRuns(previous => [run, ...previous.filter(item => item.id !== run.id)].slice(0, 5));
    });
    return () => { active = false; unsubscribe?.(); };
  }, [mode, conversationId, entryId]);
  const run = runs.find(item => item.status !== 'completed' && item.status !== 'cancelled') ?? runs[0];
  if (!run) return null;
  const reason = run.stopReason && !(run.stopReason === 'interrupted' && ['paused', 'cancelled'].includes(run.status)) ? t(reasons[run.stopReason]) : '';
  const act = async (operation: 'pause' | 'resume' | 'cancel') => {
    const startedFor = owner.current;
    setBusy(run.id); setError(null);
    try {
      if (operation === 'resume') { await window.nodus.resumeResearchRun?.(run.id); if (owner.current === startedFor) onResumed?.(); }
      else if (operation === 'pause') await window.nodus.pauseResearchRun?.(run.id);
      else await window.nodus.cancelResearchRun?.(run.id);
      const next = await window.nodus.listResearchRuns?.(conversationId ?? undefined, entryId ?? undefined);
      if (next && owner.current === startedFor) setRuns(next.filter(item => item.mode === mode && (mode !== 'chat' || item.conversationId === conversationId) && (!entryId || item.entryId === entryId)));
    } catch (failure) { setError(failure instanceof Error && failure.message.includes('context_changed') ? t('El contexto ha cambiado') : t('No se ha podido continuar la investigación.')); }
    finally { setBusy(null); }
  };
  return <details className="mx-4 my-2 break-words rounded-lg border border-neutral-300 p-3 text-xs dark:border-neutral-700" data-testid="research-harness-panel">
    <summary className="cursor-pointer">Nodus Research Harness · {run.explorationMode && <>{t(run.explorationMode === 'fast' ? 'Rápido' : 'Ampliado')} · </>}<span role="status" aria-live="polite">{t(states[run.status])}{reason ? ` · ${reason}` : ''}</span></summary>
    <p className="my-2 font-medium">{run.objective}</p>
    {run.questions.length > 0 && <ul className="my-2 space-y-1">{run.questions.map(question => <li key={question.question}><span aria-hidden="true">{question.status === 'supported' ? '✓' : '○'}</span> {question.question} <span className="text-muted">· {t(questionStates[question.status])}</span>
      {question.purpose && <p className="ml-4 text-muted">{question.purpose}</p>}</li>)}</ul>}
    <ol className="my-2 space-y-1">{run.tasks.filter(task => task.status === 'pending' || task.status === 'running').slice(0, 6).map(task => <li key={task.id}>{task.question}</li>)}</ol>
    <p>{t('Pasos realizados')}: {run.usage.rounds} · {t('Llamadas al modelo')}: {run.usage.modelCalls ?? 0}</p>
    <div className="mt-2 flex gap-2">
      {run.status === 'running' && <button className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => void act('pause')}>{t('Pausar')}</button>}
      {(run.status === 'paused' || run.status === 'failed') && run.stopReason !== 'context_changed' && <button className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => void act('resume')}>{t('Continuar')}</button>}
      {['running', 'paused', 'failed'].includes(run.status) && <button className="btn btn-ghost text-xs" disabled={busy !== null} onClick={() => void act('cancel')}>{t('Cancelar')}</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
  </details>;
}
