import { useAcademicLearning } from '../learning/AcademicLearningContext';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReadingPathEntry, ReadingPathPlan, ReadingPathStrategy } from '@shared/types';
import { Badge, Icon, Spinner } from '../components/ui';
import { VirtualList } from '../components/VirtualList';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { getActiveLang, t, tx } from '../i18n';
import { localizeReadingPathText } from '@shared/uiLanguage';

const STRATEGY_LABELS: Record<ReadingPathStrategy, string> = {
  research_relevance: 'Más relevante',
  gaps: 'Cubrir huecos',
  foundational: 'Textos de base',
  recent: 'Más recientes',
  connected_authors: 'Autores conectados',
  bridges: 'Conectar temas',
};

const STRATEGY_HELP: Record<ReadingPathStrategy, string> = {
  research_relevance: 'Equilibra objetivos, temas principales, huecos y prioridad académica.',
  gaps: 'Prioriza documentos vinculados con huecos, contradicciones y preguntas abiertas.',
  foundational: 'Sube obras antiguas, citadas internamente o usadas como dependencia conceptual.',
  recent: 'Ordena por actualidad sin ignorar relevancia temática.',
  connected_authors: 'Da peso a autores relacionados por el grafo de ideas.',
  bridges: 'Busca textos que conectan varias líneas temáticas o zonas del grafo.',
};
// Virtual row pitch = card height + the gap between cards. The card itself stays
// 246 px (`h-[246px]` below); the extra 12 px is what separates one block from the
// next, matching the gaps and ideas lists.
const READING_ENTRY_CARD_HEIGHT = 246;
const READING_ENTRY_ROW_GAP = 12;
const READING_ENTRY_ROW_HEIGHT = READING_ENTRY_CARD_HEIGHT + READING_ENTRY_ROW_GAP;

export function ReadingPathView({
  onOpenGraph,
  onOpenAssistant,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [plan, setPlan] = useState<ReadingPathPlan | null>(null);
  const [strategy, setStrategy] = useState<ReadingPathStrategy>('research_relevance');
  const [researchBrief, setResearchBrief] = useState('');
  const [limit, setLimit] = useState(72);
  const [includeRead, setIncludeRead] = useState(true);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await window.nodus.getReadingPath({ strategy, researchBrief, limit, includeRead }));
    } finally {
      setLoading(false);
    }
  }, [strategy, researchBrief, limit, includeRead]);

  useEffect(() => {
    void reload();
  }, []);
  useDataRefresh(reload);
  useScanComplete(reload);

  const phases = plan?.phases ?? [];

  return (
    <div data-testid="reading-path-view" className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">{t('Ruta de lectura')}</h1>
          <p className="text-sm text-neutral-400">
            {t('Plan por fases según estado de lectura, análisis, huecos, temas, autores e ideas conectadas.')}
          </p>
        </div>
        <div className="flex-1" />
        <button data-testid="reading-refresh" className="btn btn-primary gap-1.5" onClick={() => void reload()} disabled={loading}>
          <Icon name="wand" /> {t('Analizar ruta')}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] gap-4 mb-5">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as ReadingPathStrategy)}>
              {Object.entries(STRATEGY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
            <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[36, 72, 108, 144].map((n) => (
                <option key={n} value={n}>
                  {tx('{n} lecturas', { n })}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-500"
                checked={includeRead}
                onChange={(e) => setIncludeRead(e.target.checked)}
              />
              {t('Incluir leídas')}
            </label>
          </div>
          <textarea
            className="input w-full min-h-24 resize-y"
            value={researchBrief}
            onChange={(e) => setResearchBrief(e.target.value)}
            placeholder={t('Describe tu investigación, preguntas principales, objetivos o prioridades actuales...')}
          />
          <div className="text-xs text-neutral-500">{t(STRATEGY_HELP[strategy])}</div>
        </div>

        <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/40">
          {plan ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label={t('Corpus')} value={plan.totalWorks} />
              <Metric label={t('Mostradas')} value={plan.shownWorks} />
              <Metric label={t('Leídas')} value={plan.readCount} />
              <Metric label={t('Por leer')} value={plan.unreadCount} />
              <Metric label={t('Analizadas')} value={plan.analyzedCount} />
              <Metric label={t('Pendientes')} value={plan.pendingAnalysisCount} />
            </div>
          ) : (
            <div className="text-sm text-neutral-500">{t('Sin plan calculado.')}</div>
          )}
        </div>
      </div>

      {loading && (
        <div className="mb-4">
          <Spinner label={t('Recalculando ruta...')} />
        </div>
      )}

      {plan && (
        <p className="text-sm text-neutral-400 mb-4">
          {tx('Ruta optimizada por {strategy}: {shown} lecturas priorizadas de {total} obras, agrupadas en fases manejables.', {
            strategy: t(STRATEGY_LABELS[plan.strategy]),
            shown: plan.shownWorks,
            total: plan.totalWorks,
          })}
        </p>
      )}

      <div className="space-y-7">
        {phases.map((phase) => (
          <section key={phase.id}>
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <div>
                <h2 className="text-base font-semibold">{phase.titleKey ? localizedReadingPathText(phase.titleKey, phase.title) : t(phase.title)}</h2>
                <p className="text-xs text-neutral-500">{phase.objectiveKey ? localizedReadingPathText(phase.objectiveKey, phase.objective) : t(phase.objective)}</p>
              </div>
              <div className="flex-1" />
              <Badge>{phase.entries.length}/{phase.totalCandidates}</Badge>
              {phase.omitted > 0 && <Badge color="amber">{tx('{n} fuera del bloque', { n: phase.omitted })}</Badge>}
            </div>
            <VirtualList
              items={phase.entries}
              itemHeight={READING_ENTRY_ROW_HEIGHT}
              getKey={(entry) => entry.nodus_id}
              className="min-h-0 rounded-lg"
              style={{ height: Math.min(phase.entries.length * READING_ENTRY_ROW_HEIGHT, 640) }}
              renderItem={(entry, i) => (
                <ReadingEntryCard
                  entry={entry}
                  index={i + 1}
                  onOpenGraph={onOpenGraph}
                  onOpenAssistant={onOpenAssistant}
                />
              )}
            />
          </section>
        ))}
      </div>

      {plan && phases.length === 0 && <div className="text-neutral-500 text-sm">{t('No hay obras que cumplan los filtros actuales.')}</div>}
    </div>
  );
}

function ReadingEntryCard({
  entry,
  index,
  onOpenGraph,
  onOpenAssistant,
}: {
  entry: ReadingPathEntry;
  index: number;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const learning=useAcademicLearning();
  const [citation,setCitation]=useState<CitationTarget>(null);
  const openInZotero = async () => {
    const work = await window.nodus.getWork(entry.nodus_id);
    if (work && learning.session?.lessonId==='reading'&&!learning.session.paused) {
      learning.emit({kind:'artifact',artifactId:entry.nodus_id,citationIds:[`work:${entry.nodus_id}`],valid:true});
      setCitation({kind:'work',id:work.nodus_id});
    } else if (work) await window.nodus.openInZotero(work.zotero_key);
  };
  const openInGraph = async () => {
    const work = await window.nodus.getWork(entry.nodus_id);
    onOpenGraph({
      preset: 'reading',
      workId: entry.nodus_id,
      workTitle: entry.title,
      zoteroKey: work?.zotero_key,
      label: `${t('Lectura:')} ${entry.title}`,
    });
  };

  return (
    <div className={`card h-[246px] p-3 mr-2 flex gap-3 items-start overflow-hidden ${entry.read ? 'opacity-75' : ''}`}>
      <div className="text-lg font-mono text-neutral-600 w-8 text-right">{index}</div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{entry.title}</span>
          {entry.read ? <Badge color="indigo">{t('leída')}</Badge> : <Badge color="amber">{t('por leer')}</Badge>}
          <Badge color={entry.analysis.deepStatus === 'done' ? 'green' : 'neutral'}>{entry.analysis.deepStatus === 'done' ? t('ideas analizadas') : t('ideas pendientes')}</Badge>
          <Badge color={entry.analysis.lightStatus === 'done' ? 'cyan' : 'neutral'}>{entry.analysis.lightStatus === 'done' ? t('temas analizados') : t('temas pendientes')}</Badge>
          {entry.analysis.summaryStatus === 'done' && <Badge color="indigo">{t('resumen')}</Badge>}
          <Badge>{tx('prioridad {n}', { n: entry.priority })}</Badge>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          {entry.authors[0] ?? '—'}
          {entry.authors.length > 1 ? ' et al.' : ''} · {entry.year ?? t('s.f.')}
          {entry.themes.length > 0 ? ` · ${entry.themes.slice(0, 4).join(', ')}` : ''}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.analysis.ideaCount > 0 && <Badge color="green">{tx('{n} ideas', { n: entry.analysis.ideaCount })}</Badge>}
          {entry.analysis.themeCount > 0 && <Badge color="cyan">{tx('{n} temas', { n: entry.analysis.themeCount })}</Badge>}
          {entry.analysis.contradictionCount > 0 && <Badge color="red">{tx('{n} contrad.', { n: entry.analysis.contradictionCount })}</Badge>}
          {entry.analysis.gapCount > 0 && <Badge color="amber">{tx('{n} huecos', { n: entry.analysis.gapCount })}</Badge>}
          {entry.bridgeScore >= 0.45 && <Badge color="indigo">{t('puente')}</Badge>}
        </div>
        <p className="text-xs text-neutral-400 mt-2 line-clamp-2">{localizedReadingReason(entry)}</p>
        {entry.orientationSummary && (
          <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2">
            <span className="text-neutral-400">{t('Resumen (orientación):')} </span>{entry.orientationSummary}
          </p>
        )}
        {entry.relatedGaps.length > 0 && (
          <div className="mt-2 text-xs text-neutral-500 line-clamp-1">
            {t('Huecos relacionados:')} {entry.relatedGaps.map((g) => g.slice(0, 120)).join(' · ')}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
            onClick={() => void openInGraph()}
          >
            <Icon name="layers" size={13} /> {t('Grafo')}
          </button>
          <button
            className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
            onClick={() =>
              onOpenAssistant({
                title: `${t('Lectura:')} ${entry.title}`,
                selection: ASSISTANT_CONTEXTS.reading,
                prompt:
                  `${t('Usa esta lectura de la ruta como punto de partida. Explica por qué es prioritaria, qué ideas/huecos conecta y qué debería leer después.')}\n\n` +
                  `${entry.title}\n${localizedReadingReason(entry)}`,
              })
            }
          >
            <Icon name="chat" size={13} /> {t('Asistente')}
          </button>
          <button data-testid="reading-source" className="btn btn-ghost border border-neutral-700 text-xs gap-1.5" onClick={() => void openInZotero()}>
            <Icon name="external" size={13} /> {learning.session?.lessonId==='reading'&&!learning.session.paused?t('Abrir fuente'):'Zotero'}
          </button>
        </div>
      </div>
      {createPortal(<SourceCitationModal target={citation} onClose={()=>setCitation(null)} />,document.body)}
    </div>
  );
}

function localizedReadingReason(entry: ReadingPathEntry): string {
  const parts: string[] = [];
  const serverReason = localizeReadingPathText(entry.reasonKey, entry.reasonParams, getActiveLang());
  if (serverReason) parts.push(serverReason);
  parts.push(entry.read ? t('Marcada como leída por la etiqueta de Zotero.') : t('Pendiente de lectura.'));
  if (entry.analysis.hasIdeas) parts.push(tx('{n} idea(s) extraída(s).', { n: entry.analysis.ideaCount }));
  if (entry.analysis.hasThemes) parts.push(tx('{n} tema(s) detectado(s).', { n: entry.analysis.themeCount }));
  if (entry.analysis.hasContradictions) parts.push(tx('{n} contradicción(es) o refutación(es).', { n: entry.analysis.contradictionCount }));
  if (entry.analysis.hasGaps) parts.push(tx('{n} hueco(s) asociado(s).', { n: entry.analysis.gapCount }));
  if (entry.relatedGaps.length > 0 || entry.gapScore >= 0.2) parts.push(t('Alta conexión con huecos de investigación.'));
  if (entry.foundationalScore >= 0.45) {
    parts.push(entry.citedBy > 0
      ? tx('Posible texto de base ({n} cita(s) internas aproximadas).', { n: entry.citedBy })
      : t('Posible texto de base.'));
  }
  if (entry.bridgeScore >= 0.45) parts.push(t('Conecta varias líneas temáticas o relaciones del grafo.'));
  if (entry.authorConnectivityScore >= 0.45) parts.push(t('Autoría conectada con otros nodos del corpus.'));
  if (entry.recencyScore >= 0.72) parts.push(t('Aporta actualización reciente.'));
  if (entry.interestScore >= 0.4) parts.push(t('Coincide con las prioridades indicadas.'));
  if (entry.analysis.lightStatus !== 'done' || entry.analysis.deepStatus !== 'done' || !entry.analysis.hasIdeas) {
    parts.push(t('Conviene completar análisis antes de decidir su papel en el mapa.'));
  }
  return parts.join(' ');
}

function localizedReadingPathText(key: string | undefined, legacy: string): string {
  return localizeReadingPathText(key, undefined, getActiveLang()) ?? t(legacy);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5">
      <div className="text-neutral-500">{label}</div>
      <div className="text-neutral-100 font-semibold text-sm">{value}</div>
    </div>
  );
}
