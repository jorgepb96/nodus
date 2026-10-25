import { useCallback, useEffect, useState } from 'react';
import type {
  GraphIntegrityCategory,
  GraphIntegrityCheck,
  GraphIntegrityCheckId,
  GraphIntegrityReport,
  QueueProgress,
  ReprocessProgress,
} from '@shared/types';
import { confirm } from './feedback';
import { Icon } from './ui';
import { SettingsPanel } from './SettingsPanel';
import { errorText, t, tx } from '../i18n';

/** What each finding means, in the reader's words. Literal keys, so the i18n test sees them. */
function checkLabel(id: GraphIntegrityCheckId): string {
  switch (id) {
    case 'rows_of_missing_works': return t('Datos de obras que ya no existen');
    case 'theme_links_missing_theme': return t('Ideas enlazadas a temas borrados');
    case 'work_themes_missing_theme': return t('Obras enlazadas a temas borrados');
    case 'dormant_ideas_with_works': return t('Ideas ocultas que alguna obra contiene');
    case 'active_ideas_without_works': return t('Ideas visibles que ninguna obra contiene');
    case 'edges_missing_endpoint': return t('Relaciones con una idea que ya no existe');
    case 'self_loop_edges': return t('Relaciones de una idea consigo misma');
    case 'orphan_edge_traces': return t('Trazas de relaciones borradas');
    case 'unused_themes': return t('Temas sin uso');
    case 'rows_missing_idea': return t('Análisis que apuntan a ideas desaparecidas');
    case 'rows_missing_evidence': return t('Huecos o referencias sin su evidencia');
    case 'edges_of_missing_works': return t('Relaciones de obras que ya no están en este vault');
    case 'hidden_edges': return t('Relaciones ocultas hacia ideas durmientes');
    case 'legacy_gap_evidence': return t('Evidencias antiguas de huecos sin idea');
    case 'user_refs_missing_idea': return t('Referencias tuyas a ideas que ya no existen');
    case 'stuck_document_jobs': return t('Fichas documentales detenidas');
  }
}

function categoryTitle(category: GraphIntegrityCategory): string {
  if (category === 'repairable') return t('Se puede reparar sin IA');
  if (category === 'rescan') return t('Requiere volver a analizar');
  return t('Informativo');
}

const CATEGORIES: GraphIntegrityCategory[] = ['repairable', 'rescan', 'info'];

function queueBusy(progress: QueueProgress | null): boolean {
  if (!progress) return false;
  return Boolean(progress.maintenanceRunning) || progress.items.some((item) => item.state === 'queued' || item.state === 'running');
}

function CheckRow({ check }: { check: GraphIntegrityCheck }) {
  const shown = check.works.slice(0, 5);
  const more = check.works.length - shown.length;
  return <li className="rounded-md border border-neutral-200 bg-white/60 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60" data-testid={`graph-health-check-${check.id}`}>
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-700 dark:text-neutral-300">{checkLabel(check.id)}</span>
      <b className="tabular-nums text-neutral-800 dark:text-neutral-200">{check.count}</b>
    </div>
    {shown.length > 0 && <p className="mt-1 text-neutral-500">
      {shown.map((work) => work.title ?? work.nodus_id).join(' · ')}
      {more > 0 ? ` · ${tx('y {n} más', { n: more })}` : ''}
    </p>}
  </li>;
}

/**
 * Settings › Data › Graph health. Audits the idea graph, repairs what SQL can repair
 * (after a backup, and never while the analysis queue is writing), and offers the two
 * follow-ups that need the model: reassigning idea themes where a repair removed them,
 * and analysing again the works whose own rows point at ideas that are gone.
 */
export function GraphHealthPanel({ manualMode }: { manualMode: boolean }) {
  const [report, setReport] = useState<GraphIntegrityReport | null>(null);
  const [queue, setQueue] = useState<QueueProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<ReprocessProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.nodus.getQueue().then((value) => { if (!cancelled) setQueue(value); }).catch(() => undefined);
    const off = window.nodus.onQueueProgress((value) => setQueue(value));
    return () => { cancelled = true; off(); };
  }, []);

  const check = useCallback(async () => {
    setBusy(true); setMessage('');
    try { setReport(await window.nodus.checkGraphIntegrity()); }
    catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const running = queueBusy(queue);
  const repairable = report?.totals.repairable ?? 0;
  const pendingThemes = report?.pendingThemeWorks ?? [];
  const rescanWorks = report?.rescanWorks ?? [];

  const repair = async () => {
    const ok = await confirm({
      title: t('Reparar el grafo'),
      message: t('Antes se guarda una copia del vault. La reparación solo borra datos que apuntan a elementos que ya no existen y corrige qué ideas se muestran. No usa IA.'),
      confirmLabel: t('Reparar'),
    });
    if (!ok) return;
    setBusy(true); setMessage('');
    try {
      const result = await window.nodus.repairGraphIntegrity();
      if (result.report) setReport(result.report);
      setMessage(tx('Grafo reparado. Copia de seguridad: {path}', { path: result.backupPath ?? '' }));
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };

  const reassignThemes = async () => {
    setBusy(true); setMessage(''); setProgress(null);
    try {
      const result = await window.nodus.reprocessRepairedThemeWorks(undefined, (p) => setProgress(p));
      setMessage(tx('Temas reasignados: {n} ideas.', { n: result.themedIdeas }));
      setReport(await window.nodus.checkGraphIntegrity());
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); setProgress(null); }
  };

  const dismissThemes = async () => {
    setBusy(true);
    try { setReport(await window.nodus.dismissRepairedThemeWorks()); }
    catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };

  const analyseAgain = async () => {
    const ok = await confirm({
      title: t('Volver a analizar'),
      message: t('Estas obras se volverán a analizar con el modelo de IA configurado. Puede tardar y consumir créditos.'),
      confirmLabel: t('Volver a analizar'),
    });
    if (!ok) return;
    setBusy(true); setMessage('');
    try {
      await window.nodus.processFullBulk(rescanWorks.map((work) => work.nodus_id), undefined, { mode: 'refresh' });
      setMessage(t('Obras añadidas a la cola de análisis.'));
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  };

  return <SettingsPanel
    data-testid="graph-health"
    icon="network"
    title={t('Salud del grafo')}
    description={t('Comprueba que las ideas, los temas y las relaciones del grafo son coherentes, y repara sin IA lo que se pueda arreglar.')}
    actions={<>
      <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void check()} data-testid="graph-health-check">
        <Icon name="refresh" />{t('Comprobar')}
      </button>
      <button className="btn btn-primary" disabled={busy || running || repairable === 0} onClick={() => void repair()} data-testid="graph-health-repair">
        <Icon name="shield" />{t('Reparar')}
      </button>
    </>}
  >
    {running && repairable > 0 && <p className="text-xs text-amber-600 dark:text-amber-300">{t('Espera a que termine la cola de análisis para reparar.')}</p>}

    {report && <div className="space-y-3 text-xs">
      {CATEGORIES.map((category) => {
        const checks = report.checks.filter((item) => item.category === category && item.count > 0);
        return <div key={category} data-testid={`graph-health-${category}`}>
          <h3 className="mb-1 font-semibold text-neutral-600 dark:text-neutral-400">{categoryTitle(category)} · <span className="tabular-nums">{report.totals[category]}</span></h3>
          {checks.length === 0
            ? <p className="text-neutral-500">{t('Sin incidencias.')}</p>
            : <ul className="space-y-1">{checks.map((item) => <CheckRow key={item.id} check={item} />)}</ul>}
        </div>;
      })}

      {!manualMode && pendingThemes.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200" data-testid="graph-health-pending-themes">
        <p>{tx('{n} obra(s) perdieron los temas de algunas ideas por un fallo de versiones anteriores.', { n: pendingThemes.length })} {t('Reasignarlos usa el modelo de IA configurado.')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => void reassignThemes()} data-testid="graph-health-reassign-themes">{t('Reasignar temas')}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void dismissThemes()} data-testid="graph-health-dismiss-themes">{t('Descartar')}</button>
        </div>
        {progress && <p className="mt-1 tabular-nums">{t(progress.label)} · {progress.current}/{progress.total}</p>}
      </div>}

      {!manualMode && rescanWorks.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void analyseAgain()} data-testid="graph-health-analyse-again">
          <Icon name="play" />{tx('Volver a analizar {n} obra(s)', { n: rescanWorks.length })}
        </button>
      </div>}
    </div>}

    {message && <p className="mt-3 break-all text-xs text-amber-600 dark:text-amber-300" data-testid="graph-health-message">{message}</p>}
  </SettingsPanel>;
}
