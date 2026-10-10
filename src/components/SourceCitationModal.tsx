import { openWebSource } from '../researchWebSources';
import { webPassageLink } from '@shared/webResearchRanking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthorDossier,
  AuthorSummary,
  EdgeDetail,
  Evidence,
  GapDetail,
  GapKind,
  IdeaByWorkPage,
  IdeaDetail,
  IdeaType,
  LibraryReaderDocument,
  PassageDetail,
  WorkIdeaSynthesis,
  WorkMeta,
  WorkSummary,
  WorkView,
} from '@shared/types';
import type { LibraryItemRecord, LibraryScope } from '@shared/libraryTypes';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS } from './ui';
import { buildAuthorIndex, lookupAuthor } from '../authorLinks';
import { evidenceLocator, openEvidenceAtPage, requestLibraryDocumentOpen } from '../evidenceJump';
import { parsePageNumber } from '@shared/pageLocation';
import { t, tx } from '../i18n';

export type CitationTarget =
  | { kind: 'idea'; id: string }
  | { kind: 'work'; id: string }
  | { kind: 'author'; id: string }
  | { kind: 'gap'; id: string }
  | { kind: 'contradiction'; id: string }
  | { kind: 'passage'; id: string }
  | null;

/** Opens the library copy of a cited work, at `page` when the citation named one. */
export type OpenCitationLibraryWork = (itemId: string, scope: LibraryScope, page?: number | null) => void;

type NonNullCitationTarget = Exclude<CitationTarget, null>;

interface CitationTab {
  key: string;
  target: NonNullCitationTarget;
  title: string;
}

interface WorkLink {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  itemType?: string | null;
  development?: string | null;
  role?: string | null;
  confidence?: number | null;
}

interface CitationPanelProps {
  onOpenTarget: (target: NonNullCitationTarget, title?: string) => void;
  onTitle: (title: string) => void;
  authors: AuthorSummary[];
  onOpenLibraryWork?: OpenCitationLibraryWork;
}

const GAP_LABELS: Record<GapKind, string> = {
  future_work: 'trabajo futuro',
  limitation: 'limitación',
  open_question: 'pregunta abierta',
  unresolved_contradiction: 'contradicción sin resolver',
};

const GAP_COLORS: Record<GapKind, 'amber' | 'red' | 'cyan' | 'indigo'> = {
  future_work: 'cyan',
  limitation: 'amber',
  open_question: 'indigo',
  unresolved_contradiction: 'red',
};

const ITEM_TYPE_ES: Record<string, string> = {
  journalArticle: 'artículo de revista',
  magazineArticle: 'artículo de revista',
  newspaperArticle: 'artículo de periódico',
  bookSection: 'capítulo de libro',
  book: 'libro',
  conferencePaper: 'ponencia',
  thesis: 'tesis',
  report: 'informe',
  preprint: 'preprint',
  manuscript: 'manuscrito',
  webpage: 'página web',
  document: 'documento',
  encyclopediaArticle: 'entrada de enciclopedia',
};

const targetKey = (target: NonNullCitationTarget) => `${target.kind}:${target.id}`;

function targetFallbackTitle(target: NonNullCitationTarget): string {
  switch (target.kind) {
    case 'idea': return t('Idea');
    case 'work': return t('Obra');
    case 'author': return t('Autor');
    case 'gap': return t('Hueco');
    case 'contradiction': return t('Contradicción');
    case 'passage': return t('Pasaje');
  }
}

function targetIcon(target: NonNullCitationTarget): string {
  switch (target.kind) {
    case 'idea': return 'bulb';
    case 'work': return 'book';
    case 'author': return 'user';
    case 'gap': return 'gap';
    case 'contradiction': return 'swap';
    case 'passage': return 'quote';
  }
}

/**
 * A source workspace for citations opened inside long-form readers. Related ideas,
 * authors and works open as closeable tabs, so following a source never replaces
 * the report behind the modal or loses the path the reader has built.
 */
export function SourceCitationModal({
  target,
  onClose,
  onOpenLibraryWork,
}: {
  target: CitationTarget;
  onClose: () => void;
  onOpenLibraryWork?: OpenCitationLibraryWork;
}) {
  if (!target) return null;
  return <CitationWorkspace initialTarget={target} onClose={onClose} onOpenLibraryWork={onOpenLibraryWork} />;
}

function CitationWorkspace({
  initialTarget,
  onClose,
  onOpenLibraryWork,
}: {
  initialTarget: NonNullCitationTarget;
  onClose: () => void;
  onOpenLibraryWork?: OpenCitationLibraryWork;
}) {
  const initialKey = targetKey(initialTarget);
  const [tabs, setTabs] = useState<CitationTab[]>([
    { key: initialKey, target: initialTarget, title: targetFallbackTitle(initialTarget) },
  ]);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [authors, setAuthors] = useState<AuthorSummary[]>([]);
  const tabStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.nodus.listAuthors().then((value) => {
      if (active) setAuthors(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    tabStripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, tabs.length]);

  const openTarget = useCallback((nextTarget: NonNullCitationTarget, title?: string) => {
    const key = targetKey(nextTarget);
    setTabs((current) => current.some((tab) => tab.key === key)
      ? current.map((tab) => tab.key === key && title ? { ...tab, title } : tab)
      : [...current, { key, target: nextTarget, title: title || targetFallbackTitle(nextTarget) }]);
    setActiveKey(key);
  }, []);

  const updateTitle = useCallback((key: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setTabs((current) => current.map((tab) => tab.key === key && tab.title !== clean ? { ...tab, title: clean } : tab));
  }, []);

  const closeTab = (key: string) => {
    const index = tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const remaining = tabs.filter((tab) => tab.key !== key);
    if (remaining.length === 0) {
      onClose();
      return;
    }
    setTabs(remaining);
    if (activeKey === key) setActiveKey(remaining[Math.min(index, remaining.length - 1)].key);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-2 backdrop-blur-[2px] sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Fuentes y contexto')}
        data-testid="source-citation-modal"
        className="flex h-[min(94vh,1100px)] max-h-[94vh] min-h-0 w-full max-w-[92rem] flex-col overflow-hidden rounded-2xl border border-neutral-700/80 bg-neutral-950 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 sm:px-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300"><Icon name="bookOpen" size={16} /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-100">{t('Fuentes y contexto')}</h2>
            <p className="text-[10px] text-neutral-500">{t('Explora las relaciones sin salir del informe')}</p>
          </div>
          <div className="flex-1" />
          <span className="hidden text-[10px] text-neutral-600 sm:block">{tx('{n} pestañas abiertas', { n: tabs.length })}</span>
          <button data-testid="source-citation-close" className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} title={t('Cerrar')}><Icon name="x" size={15} /></button>
        </header>

        <div className="library-workspace-tabs shrink-0 border-b border-neutral-800/80" data-testid="source-citation-tabs">
          <div ref={tabStripRef} className="library-workspace-tabs-scroll" role="tablist" aria-label={t('Fuentes abiertas')}>
            {tabs.map((tab) => {
              const active = tab.key === activeKey;
              return (
                <div key={tab.key} className={`library-workspace-tab ${active ? 'is-active' : ''}`} title={tab.title}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    data-testid={`source-citation-tab-${tab.key}`}
                    className="library-workspace-tab-main"
                    onClick={() => setActiveKey(tab.key)}
                  >
                    <Icon name={targetIcon(tab.target)} size={12} />
                    <span className="max-w-52 truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    className="library-workspace-tab-close"
                    data-testid={`source-citation-close-tab-${tab.key}`}
                    aria-label={`${t('Cerrar pestaña')}: ${tab.title}`}
                    title={t('Cerrar pestaña')}
                    onClick={(event) => { event.stopPropagation(); closeTab(tab.key); }}
                  ><Icon name="x" size={11} /></button>
                </div>
              );
            })}
          </div>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950/70" data-testid="source-citation-content">
          {tabs.map((tab) => (
            <CitationTabPane
              key={tab.key}
              tab={tab}
              active={tab.key === activeKey}
              authors={authors}
              onOpenTarget={openTarget}
              onTitle={updateTitle}
              onOpenLibraryWork={onOpenLibraryWork}
            />
          ))}
        </main>
      </div>
    </div>
  );
}

function CitationTabPane({
  tab,
  active,
  authors,
  onOpenTarget,
  onTitle,
  onOpenLibraryWork,
}: {
  tab: CitationTab;
  active: boolean;
  authors: AuthorSummary[];
  onOpenTarget: CitationPanelProps['onOpenTarget'];
  onTitle: (key: string, title: string) => void;
  onOpenLibraryWork?: OpenCitationLibraryWork;
}) {
  const reportTitle = useCallback((title: string) => onTitle(tab.key, title), [onTitle, tab.key]);
  return (
    <div className={`${active ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : 'hidden'}`} role="tabpanel" data-testid={`source-citation-panel-${tab.key}`}>
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <CitationPanel target={tab.target} authors={authors} onOpenTarget={onOpenTarget} onTitle={reportTitle} onOpenLibraryWork={onOpenLibraryWork} />
      </div>
    </div>
  );
}

function CitationPanel({ target, ...props }: CitationPanelProps & { target: NonNullCitationTarget }) {
  switch (target.kind) {
    case 'idea': return <IdeaPanel globalId={target.id} {...props} />;
    case 'work': return <WorkPanel nodusId={target.id} {...props} />;
    case 'author': return <AuthorPanel authorId={target.id} {...props} />;
    case 'gap': return <GapPanel gapId={target.id} {...props} />;
    case 'contradiction': return <ContradictionPanel edgeId={target.id} {...props} />;
    case 'passage': return <PassagePanel passageId={target.id} {...props} />;
  }
}

function Section({ icon, title, count, children, testId }: { icon: string; title: string; count?: number; children: React.ReactNode; testId?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/35" data-testid={testId}>
      <header className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/55 px-4 py-3">
        <Icon name={icon} size={14} className="text-indigo-300" />
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-300">{title}</h3>
        {typeof count === 'number' && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] tabular-nums text-neutral-500">{count}</span>}
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function LoadingPanel() {
  return (
    <div className="space-y-5 animate-pulse" data-testid="source-citation-loading">
      <div className="rounded-2xl border border-neutral-800 p-5"><div className="h-3 w-24 rounded bg-neutral-800" /><div className="mt-4 h-6 w-2/3 rounded bg-neutral-800" /><div className="mt-3 h-4 w-full rounded bg-neutral-900" /><div className="mt-2 h-4 w-4/5 rounded bg-neutral-900" /></div>
      <div className="h-40 rounded-xl border border-neutral-800 bg-neutral-900/30" />
    </div>
  );
}

function MissingPanel({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-neutral-800 p-8 text-center"><div><Icon name="warning" size={22} className="mx-auto text-amber-400" /><p className="mt-3 text-sm text-neutral-400">{children}</p></div></div>;
}

function useSourceFailure() {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fail = useCallback((value: unknown) => setError(value instanceof Error ? value.message : String(value)), []);
  const reset = useCallback(() => setError(null), []);
  const retry = useCallback(() => { setError(null); setAttempt(value => value + 1); }, []);
  return { error, attempt, fail, reset, retry };
}

function SourceError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="space-y-3 rounded-xl border border-amber-500/30 p-5" data-testid="source-citation-error">
    <p className="text-sm font-medium">{t('No se pudo cargar la fuente.')}</p>
    <p className="break-words text-sm text-neutral-500">{message}</p>
    <button type="button" className="btn btn-ghost" onClick={retry}>{t('Reintentar')}</button>
  </div>;
}

function IdeaPanel({ globalId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { globalId: string }) {
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [edges, setEdges] = useState<EdgeDetail[]>([]);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();

  useEffect(() => {
    let active = true;
    setDetail(null); setEdges([]); setMissing(false); failure.reset();
    void Promise.all([window.nodus.getIdeaDetail(globalId), window.nodus.getIdeaEdges(globalId)]).then(([next, nextEdges]) => {
      if (!active) return;
      if (!next) { setMissing(true); return; }
      setDetail(next); setEdges(nextEdges); onTitle(next.idea.label);
    }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [globalId, onTitle, failure.attempt, failure.fail, failure.reset]);

  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró la idea citada en el corpus actual.')}</MissingPanel>;
  if (!detail) return <LoadingPanel />;

  return (
    <div className="space-y-5" data-testid="source-citation-idea">
      <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2"><Badge color="indigo">{t(NODE_LABELS[detail.idea.type as IdeaType]) ?? detail.idea.type}</Badge><span className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Idea citada')}</span></div>
        <h2 className="mt-3 text-xl font-semibold leading-tight text-neutral-100">{detail.idea.label}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-300">{detail.idea.statement}</p>
      </div>

      <Section icon="book" title={t('Obras enlazadas')} count={detail.occurrences.length} testId="source-citation-linked-works">
        {detail.occurrences.length ? <div className="space-y-2">{detail.occurrences.map((occurrence) => (
          <LinkedWorkCard
            key={occurrence.nodus_id}
            work={{ id: occurrence.work.nodus_id, title: occurrence.work.title, authors: occurrence.work.authors, year: occurrence.work.year, zoteroKey: occurrence.work.zotero_key, itemType: occurrence.work.item_type, development: occurrence.development, role: occurrence.role, confidence: occurrence.confidence }}
            authorsIndex={authors}
            onOpenTarget={onOpenTarget}
            onOpenLibraryWork={onOpenLibraryWork}
          />
        ))}</div> : <EmptyLine>{t('Sin obras vinculadas.')}</EmptyLine>}
      </Section>

      <EvidenceSection evidence={detail.evidence} />

      {edges.length > 0 && <Section icon="link" title={t('Conexiones de la idea')} count={edges.length}>
        <div className="grid gap-2 sm:grid-cols-2">{edges.map((edge) => {
          const otherId = edge.edge.from_id === globalId ? edge.edge.to_id : edge.edge.from_id;
          const otherLabel = edge.edge.from_id === globalId ? edge.toLabel : edge.fromLabel;
          return <button key={edge.edge.id} className="group rounded-lg border border-neutral-800 bg-neutral-950/55 p-3 text-left hover:border-indigo-500/50 hover:bg-indigo-500/5" onClick={() => onOpenTarget({ kind: 'idea', id: otherId }, otherLabel)}><span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-500"><Icon name="link" size={11} /> {t(EDGE_LABELS[edge.edge.type as keyof typeof EDGE_LABELS]) ?? edge.edge.type}</span><span className="mt-1.5 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{otherLabel}</span>{edge.explanation && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-neutral-500">{edge.explanation}</span>}</button>;
        })}</div>
      </Section>}
    </div>
  );
}

function WorkPanel({ nodusId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { nodusId: string }) {
  const [work, setWork] = useState<WorkView | null>(null);
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const [ideas, setIdeas] = useState<IdeaByWorkPage | null>(null);
  const [synthesis, setSynthesis] = useState<WorkIdeaSynthesis | null>(null);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const currentWork = useRef(nodusId); currentWork.current = nodusId;

  useEffect(() => {
    let active = true;
    setWork(null); setMeta(null); setSummary(null); setIdeas(null); setSynthesis(null); setMissing(false);
    setLoadingIdeas(false); setIdeasError(null); failure.reset();
    void window.nodus.getWork(nodusId).then(async (next) => {
      if (!active) return;
      if (!next) { setMissing(true); return; }
      const [nextMeta, nextSummary, nextIdeas, nextSynthesis] = await Promise.all([
        window.nodus.getWorkMeta(nodusId), window.nodus.getWorkSummary(nodusId), window.nodus.getIdeasByWork(nodusId, 50, 0), window.nodus.getWorkIdeaSynthesis(nodusId),
      ]);
      if (!active) return;
      setWork(next); onTitle(next.title); setMeta(nextMeta); setSummary(nextSummary); setIdeas(nextIdeas); setSynthesis(nextSynthesis);
    }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [nodusId, onTitle, failure.attempt, failure.fail, failure.reset]);

  const loadMoreIdeas = async () => {
    if (!ideas || loadingIdeas) return;
    const id = nodusId, offset = ideas.ideas.length;
    setLoadingIdeas(true); setIdeasError(null);
    try {
      const next = await window.nodus.getIdeasByWork(id, 50, offset);
      if (currentWork.current !== id) return;
      if (!next.ideas.length && offset < next.total) throw new Error(t('La obra enlaza ideas que no están disponibles en este corpus.'));
      setIdeas(previous => previous ? { total: next.total, ideas: [...previous.ideas, ...next.ideas] } : previous);
    } catch (error) { if (currentWork.current === id) setIdeasError(error instanceof Error ? error.message : String(error)); }
    finally { if (currentWork.current === id) setLoadingIdeas(false); }
  };

  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró la obra citada.')}</MissingPanel>;
  if (!work) return <LoadingPanel />;

  const resolvedAuthors = meta?.authors?.length ? meta.authors : work.authors;
  const rawType = meta?.itemType ?? work.item_type;
  const type = t(ITEM_TYPE_ES[rawType] ?? rawType);
  const year = work.year ?? meta?.year ?? null;
  const metadata = [meta?.container, meta?.publisher, meta?.volume ? `${t('vol.')} ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}` : meta?.issue ? `${t('n.º')} ${meta.issue}` : null, meta?.pages ? `pp. ${meta.pages}` : meta?.numPages ? `${meta.numPages} pp.` : null, meta?.place].filter((value): value is string => Boolean(value));

  return (
    <div className="space-y-5" data-testid="source-citation-work">
      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2"><Badge color="indigo">{type}</Badge>{year && <Badge>{year}</Badge>}</div>
        <h2 className="mt-3 text-xl font-semibold leading-tight text-neutral-100">{work.title}</h2>
        <div className="mt-2"><AuthorLinks names={resolvedAuthors} authors={authors} onOpenTarget={onOpenTarget} /></div>
        {metadata.length > 0 && <p className="mt-2 text-xs leading-5 text-neutral-500">{metadata.join(' · ')}</p>}
        <div className="mt-4"><WorkActions workId={work.nodus_id} zoteroKey={work.zotero_key} onOpenLibraryWork={onOpenLibraryWork} /></div>
      </div>

      {(synthesis || summary) && <Section icon="wand" title={t('Síntesis y orientación')}>
        {synthesis ? <div className="space-y-4"><div><Subheading>{t('Tesis central')}</Subheading><p className="text-sm leading-6 text-neutral-300">{synthesis.thesis}</p></div>{synthesis.remember.length > 0 && <div><Subheading>{t('Qué recordar')}</Subheading><BulletList values={synthesis.remember} /></div>}{synthesis.positioning && <div><Subheading>{t('Cómo se relaciona')}</Subheading><p className="text-sm leading-6 text-neutral-400">{synthesis.positioning}</p></div>}</div> : summary ? <><p className="text-sm leading-6 text-neutral-300">{summary.summary}</p><p className="mt-2 text-[10px] text-neutral-600">{t('Resumen de orientación; no sustituye la evidencia anclada.')}</p></> : null}
      </Section>}

      <Section icon="bulb" title={t('Ideas de la obra')} count={ideas?.total ?? work.ideaCount}>
        {ideas && ideas.total > ideas.ideas.length && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 p-2"><p className="text-xs text-neutral-500">{tx('Se muestran {n} ideas', { n: ideas.ideas.length })} / {ideas.total}</p><button type="button" className="btn btn-ghost" data-testid="source-citation-load-more-ideas" disabled={loadingIdeas} onClick={() => void loadMoreIdeas()}>{loadingIdeas ? t('Cargando…') : t('Cargar más')}</button></div>}
        {ideasError && <p role="alert" className="mb-3 text-sm text-amber-600 dark:text-amber-300">{ideasError}</p>}
        {ideas?.ideas.length ? <div className="space-y-2">{ideas.ideas.map((idea) => (
          <button key={idea.global_id} className="group w-full rounded-lg border border-neutral-800 bg-neutral-950/55 p-3 text-left hover:border-indigo-500/50" onClick={() => onOpenTarget({ kind: 'idea', id: idea.global_id }, idea.label)}><span className="flex items-center gap-2"><Badge color="indigo">{t(NODE_LABELS[idea.type]) ?? idea.type}</Badge><span className="text-[10px] text-neutral-600">{idea.role}</span></span><span className="mt-2 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{idea.label}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{idea.statement}</span></button>
        ))}</div> : <EmptyLine>{t('Esta obra todavía no tiene ideas extraídas.')}</EmptyLine>}
      </Section>

      {(work.themes.length > 0 || meta?.doi || meta?.url) && <Section icon="info" title={t('Ficha bibliográfica')}>
        {work.themes.length > 0 && <div className="flex flex-wrap gap-1.5">{work.themes.map((theme) => <Badge key={theme}>{theme}</Badge>)}</div>}
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[110px_1fr]">{meta?.doi && <><dt className="text-neutral-600">DOI</dt><dd className="break-all font-mono text-neutral-400">{meta.doi}</dd></>}{meta?.language && <><dt className="text-neutral-600">{t('Idioma')}</dt><dd className="text-neutral-400">{meta.language}</dd></>}{meta?.url && <><dt className="text-neutral-600">URL</dt><dd className="truncate text-neutral-400">{meta.url}</dd></>}</dl>
      </Section>}
    </div>
  );
}

function AuthorPanel({ authorId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { authorId: string }) {
  const [dossier, setDossier] = useState<AuthorDossier | null>(null);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();

  useEffect(() => {
    let active = true;
    setDossier(null); setMissing(false); failure.reset();
    void window.nodus.getAuthorDossier(authorId).then((next) => {
      if (!active) return;
      if (!next) { setMissing(true); return; }
      setDossier(next); onTitle(next.fullName || next.author.name);
    }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [authorId, onTitle, failure.attempt, failure.fail, failure.reset]);

  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró la ficha del autor.')}</MissingPanel>;
  if (!dossier) return <LoadingPanel />;

  const connected = new Map<string, { name: string; weight: number; types: string[]; themes: string[] }>();
  for (const relation of dossier.relations) {
    const current = connected.get(relation.author_id) ?? { name: relation.name, weight: 0, types: [], themes: [] };
    current.weight += relation.weight;
    if (!current.types.includes(relation.type)) current.types.push(relation.type);
    for (const theme of relation.sharedThemes) if (!current.themes.includes(theme)) current.themes.push(theme);
    connected.set(relation.author_id, current);
  }
  const connections = [...connected.entries()].sort((left, right) => right[1].weight - left[1].weight);

  return (
    <div className="space-y-5" data-testid="source-citation-author">
      <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><Icon name="user" size={20} /></span><div className="min-w-0"><span className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Ficha de autor')}</span><h2 className="mt-1 text-xl font-semibold text-neutral-100">{dossier.fullName || dossier.author.name}</h2>{dossier.author.affiliation && <p className="mt-1 text-sm text-neutral-500">{dossier.author.affiliation}</p>}</div></div>
        <div className="mt-4 flex flex-wrap gap-2"><Badge>{tx('{n} obras', { n: dossier.works.length })}</Badge><Badge>{tx('{n} ideas', { n: dossier.ideas.length })}</Badge><Badge>{tx('{n} conexiones', { n: connections.length })}</Badge>{dossier.themes.slice(0, 6).map((theme) => <Badge key={theme} color="indigo">{theme}</Badge>)}</div>
      </div>

      <Section icon="wand" title={t('Síntesis')}>{dossier.synthesis ? <div className="space-y-4"><div><Subheading>{t('Tesis central')}</Subheading><p className="text-sm leading-6 text-neutral-300">{dossier.synthesis.thesis}</p></div>{dossier.synthesis.remember.length > 0 && <div><Subheading>{t('Qué recordar')}</Subheading><BulletList values={dossier.synthesis.remember} /></div>}{dossier.synthesis.positioning && <div><Subheading>{t('Cómo se relaciona')}</Subheading><p className="text-sm leading-6 text-neutral-400">{dossier.synthesis.positioning}</p></div>}</div> : <EmptyLine>{t('Este autor aún no tiene una síntesis generada.')}</EmptyLine>}</Section>

      <Section icon="book" title={t('Obras')} count={dossier.works.length}><div className="space-y-2">{dossier.works.map((work) => <LinkedWorkCard key={work.nodus_id} work={{ id: work.nodus_id, title: work.title, authors: work.authors, year: work.year, zoteroKey: work.zoteroKey, itemType: work.itemType, role: work.role }} authorsIndex={authors} onOpenTarget={onOpenTarget} onOpenLibraryWork={onOpenLibraryWork} />)}</div></Section>

      <Section icon="bulb" title={t('Ideas')} count={dossier.ideas.length}><div className="space-y-2">{dossier.ideas.map((idea) => <button key={`${idea.global_id}:${idea.workId}`} className="group w-full rounded-lg border border-neutral-800 bg-neutral-950/55 p-3 text-left hover:border-indigo-500/50" onClick={() => onOpenTarget({ kind: 'idea', id: idea.global_id }, idea.label)}><span className="flex flex-wrap items-center gap-2"><Badge color="indigo">{t(NODE_LABELS[idea.type]) ?? idea.type}</Badge><span className="text-[10px] text-neutral-600">{idea.workTitle}{idea.year ? ` · ${idea.year}` : ''}</span></span><span className="mt-2 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{idea.label}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{idea.statement}</span></button>)}</div></Section>

      {connections.length > 0 && <Section icon="users" title={t('Conexiones con otros autores')} count={connections.length}><div className="grid gap-2 sm:grid-cols-2">{connections.map(([id, relation]) => <button key={id} className="group rounded-lg border border-neutral-800 bg-neutral-950/55 p-3 text-left hover:border-violet-500/50" onClick={() => onOpenTarget({ kind: 'author', id }, relation.name)}><span className="text-sm font-medium text-neutral-200 group-hover:text-violet-700 dark:group-hover:text-violet-200">{relation.name}</span><span className="mt-1 block text-[10px] text-neutral-500">{relation.types.map((type) => t(EDGE_LABELS[type as keyof typeof EDGE_LABELS]) ?? type).join(' · ')}</span>{relation.themes.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{relation.themes.slice(0, 4).map((theme) => <Badge key={theme}>{theme}</Badge>)}</span>}</button>)}</div></Section>}
    </div>
  );
}

function GapPanel({ gapId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { gapId: string }) {
  const [detail, setDetail] = useState<GapDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();
  useEffect(() => {
    let active = true;
    setDetail(null); setMissing(false); failure.reset();
    void window.nodus.getGapDetail(gapId).then((next) => { if (!active) return; if (!next) { setMissing(true); return; } setDetail(next); onTitle(`${t('Hueco')}: ${t(GAP_LABELS[next.gap.kind])}`); }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [gapId, onTitle, failure.attempt, failure.fail, failure.reset]);
  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró el hueco citado.')}</MissingPanel>;
  if (!detail) return <LoadingPanel />;
  return (
    <div className="space-y-5" data-testid="source-citation-gap">
      <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6"><div className="flex flex-wrap gap-2"><Badge color={GAP_COLORS[detail.gap.kind]}>{t(GAP_LABELS[detail.gap.kind])}</Badge><Badge>{t('conf')} {detail.gap.confidence.toFixed(2)}</Badge></div><h2 className="mt-3 text-xl font-semibold text-neutral-100">{t('Hueco de investigación')}</h2><p className="mt-2 text-sm leading-6 text-neutral-300">{detail.gap.statement}</p></div>
      <Section icon="book" title={t('Obra enlazada')} count={1}><LinkedWorkCard work={{ id: detail.work.nodus_id, title: detail.work.title, authors: detail.work.authors, year: detail.work.year, zoteroKey: detail.work.zotero_key, itemType: detail.work.item_type }} authorsIndex={authors} onOpenTarget={onOpenTarget} onOpenLibraryWork={onOpenLibraryWork} /></Section>
      {detail.relatedIdea && <Section icon="bulb" title={t('Idea relacionada')} count={1}><button className="group w-full rounded-lg border border-neutral-800 bg-neutral-950/55 p-3 text-left hover:border-indigo-500/50" onClick={() => onOpenTarget({ kind: 'idea', id: detail.relatedIdea!.global_id }, detail.relatedIdea!.label)}><Badge color="indigo">{t(NODE_LABELS[detail.relatedIdea.type as IdeaType]) ?? detail.relatedIdea.type}</Badge><span className="mt-2 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{detail.relatedIdea.label}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{detail.relatedIdea.statement}</span></button></Section>}
      <EvidenceSection evidence={detail.evidence ? [detail.evidence] : []} />
    </div>
  );
}

function ContradictionPanel({ edgeId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { edgeId: string }) {
  const [detail, setDetail] = useState<EdgeDetail | null>(null);
  const [sourceWork, setSourceWork] = useState<WorkView | null>(null);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();
  useEffect(() => {
    let active = true;
    setDetail(null); setSourceWork(null); setMissing(false); failure.reset();
    void window.nodus.getEdgeDetail(edgeId).then(async (next) => { if (!active) return; if (!next) { setMissing(true); return; } setDetail(next); onTitle(`${next.fromLabel} × ${next.toLabel}`); if (next.edge.source_work) { const work = await window.nodus.getWork(next.edge.source_work); if (active) setSourceWork(work); } }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [edgeId, onTitle, failure.attempt, failure.fail, failure.reset]);
  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró la contradicción citada.')}</MissingPanel>;
  if (!detail) return <LoadingPanel />;
  return (
    <div className="space-y-5" data-testid="source-citation-contradiction">
      <div className="rounded-2xl border border-red-500/25 bg-gradient-to-br from-red-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6"><div className="flex flex-wrap gap-2"><Badge color="red">{t(EDGE_LABELS[detail.edge.type as keyof typeof EDGE_LABELS]) ?? detail.edge.type}</Badge><Badge color={detail.edge.basis === 'explicit' ? 'green' : 'amber'}>{detail.edge.basis}</Badge><Badge>{t('conf')} {detail.edge.confidence.toFixed(2)}</Badge></div><h2 className="mt-3 text-xl font-semibold text-neutral-100">{t('Contradicción citada')}</h2>{detail.explanation && <p className="mt-2 text-sm leading-6 text-neutral-300">{detail.explanation}</p>}</div>
      <Section icon="swap" title={t('Ideas enfrentadas')} count={2}><div className="grid gap-3 sm:grid-cols-2"><button className="group rounded-xl border border-neutral-800 bg-neutral-950/55 p-4 text-left hover:border-indigo-500/50" onClick={() => onOpenTarget({ kind: 'idea', id: detail.edge.from_id }, detail.fromLabel)}><span className="text-[10px] uppercase tracking-wider text-neutral-600">{t('Posición A')}</span><span className="mt-2 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{detail.fromLabel}</span></button><button className="group rounded-xl border border-neutral-800 bg-neutral-950/55 p-4 text-left hover:border-indigo-500/50" onClick={() => onOpenTarget({ kind: 'idea', id: detail.edge.to_id }, detail.toLabel)}><span className="text-[10px] uppercase tracking-wider text-neutral-600">{t('Posición B')}</span><span className="mt-2 block text-sm font-medium text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{detail.toLabel}</span></button></div></Section>
      {sourceWork && <Section icon="book" title={t('Obra enlazada')} count={1}><LinkedWorkCard work={{ id: sourceWork.nodus_id, title: sourceWork.title, authors: sourceWork.authors, year: sourceWork.year, zoteroKey: sourceWork.zotero_key, itemType: sourceWork.item_type }} authorsIndex={authors} onOpenTarget={onOpenTarget} onOpenLibraryWork={onOpenLibraryWork} /></Section>}
      <EvidenceSection evidence={detail.evidence} />
    </div>
  );
}

function PassagePanel({ passageId, onOpenTarget, onTitle, authors, onOpenLibraryWork }: CitationPanelProps & { passageId: string }) {
  const [detail, setDetail] = useState<PassageDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const failure = useSourceFailure();
  useEffect(() => {
    let active = true;
    setDetail(null); setMissing(false); failure.reset();
    void window.nodus.getPassage(passageId).then((next) => { if (!active) return; if (!next) { setMissing(true); return; } setDetail(next); onTitle(next.work.title); }).catch(error => { if (active) failure.fail(error); });
    return () => { active = false; };
  }, [passageId, onTitle, failure.attempt, failure.fail, failure.reset]);
  if (failure.error) return <SourceError message={failure.error} retry={failure.retry} />;
  if (missing) return <MissingPanel>{t('No se encontró el pasaje citado. Puede haberse reindexado.')}</MissingPanel>;
  if (!detail) return <LoadingPanel />;
  const page = detail.page_number ?? parsePageNumber(detail.page_label);
  if (detail.web) {
    const web = detail.web;
    const open = () => openWebSource(webPassageLink(web.finalUrl, detail.text, detail.page_number));
    return (
      <div className="space-y-5" data-testid="source-citation-web-passage">
        <div className="rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6"><div className="flex flex-wrap items-center gap-2"><Badge color="cyan">{t('Fuente web')}</Badge>{detail.page_label && <Badge>{detail.page_label}</Badge>}
          <button type="button" data-testid="source-citation-open-web" className="btn btn-ghost h-7 border border-sky-700/70 px-2 text-[11px] text-sky-300" onClick={open}><Icon name="globe" size={12} /> {t('Abrir en el navegador')}</button></div>
          <h2 className="mt-3 text-xl font-semibold leading-tight text-neutral-100">{detail.work.title}</h2>
          <p className="mt-2 break-all text-xs text-sky-300">{web.url}</p>
          <p className="mt-1 text-[11px] text-neutral-500">{[web.siteName ?? web.domain, web.publishedAt, tx('Consultada el {date}', { date: new Date(web.retrievedAt).toLocaleString() })].filter(Boolean).join(' · ')}</p></div>
        <Section icon="quote" title={t('Evidencia anclada')} count={1} testId="source-citation-evidence"><blockquote className="rounded-xl border border-sky-900/50 bg-sky-950/10 p-4 text-sm leading-7 text-neutral-200"><Icon name="quote" size={15} className="mb-2 text-sky-400" /><span className="whitespace-pre-wrap">{detail.text}</span></blockquote></Section>
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="source-citation-passage">
      <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-neutral-900/60 to-neutral-950 p-5 sm:p-6"><div className="flex flex-wrap items-center gap-2"><Badge color="green">{detail.provenance === 'abstract' ? t('Resumen') : detail.noteId ? t(detail.provenance === 'generated-report' ? 'Informe' : 'Nota') : t('Pasaje de texto completo')}</Badge>{detail.page_label && <Badge>{detail.page_label}</Badge>}{!detail.historical && !detail.conversationAttachment && page !== null && <button type="button" data-testid="source-citation-jump-passage" className="btn btn-ghost h-7 border border-emerald-700/70 px-2 text-[11px] text-emerald-300" title={t('Abrir fuente')} onClick={() => detail.libraryItemId ? requestLibraryDocumentOpen({ itemId: detail.libraryItemId, scope: 'global', page, attachmentId: detail.attachmentId }) : void openEvidenceAtPage(detail.nodus_id, evidenceLocator({ location: detail.page_label, source_ref: detail.source_ref, page_number: detail.page_number }))}><Icon name="external" size={12} /> {tx('Ver página {n}', { n: page })}</button>}</div><h2 className="mt-3 text-xl font-semibold leading-tight text-neutral-100">{detail.work.title}</h2><div className="mt-2"><AuthorLinks names={detail.work.authors} authors={authors} onOpenTarget={onOpenTarget} /></div></div>
      {detail.historical ? <p role="status" className="text-sm text-amber-400">{t('Esta cita conserva una revisión anterior de la fuente.')}</p> : <Section icon="book" title={t('Obra enlazada')} count={1}>{detail.conversationAttachment ? <span>{detail.work.title}</span> : detail.noteId ? <button type="button" className="btn btn-ghost" onClick={() => window.dispatchEvent(new CustomEvent('nodus:open-research-note', { detail: detail.noteId }))}>{detail.work.title}</button> : detail.libraryItemId ? <button type="button" className="btn btn-ghost" onClick={() => requestLibraryDocumentOpen({ itemId: detail.libraryItemId!, scope: 'global', page, attachmentId: detail.attachmentId })}>{detail.work.title}</button> : <LinkedWorkCard work={{ id: detail.nodus_id, title: detail.work.title, authors: detail.work.authors, year: detail.work.year, zoteroKey: detail.work.zotero_key }} page={page} authorsIndex={authors} onOpenTarget={onOpenTarget} onOpenLibraryWork={onOpenLibraryWork} />}</Section>}
      <Section icon="quote" title={t('Evidencia anclada')} count={1} testId="source-citation-evidence"><blockquote className="rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-4 text-sm leading-7 text-neutral-200"><Icon name="quote" size={15} className="mb-2 text-emerald-400" /><span className="whitespace-pre-wrap">{detail.text}</span>{detail.page_label && <footer className="mt-3 text-[10px] not-italic text-neutral-500">{detail.page_label}</footer>}</blockquote></Section>
    </div>
  );
}

function EvidenceSection({ evidence }: { evidence: Evidence[] }) {
  return <Section icon="quote" title={t('Evidencia anclada')} count={evidence.length} testId="source-citation-evidence">{evidence.length ? <EvidenceList evidence={evidence} /> : <EmptyLine>{t('No hay fragmentos de evidencia anclados.')}</EmptyLine>}</Section>;
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return <div className="space-y-2">{evidence.map((item) => {
    const page = item.page_number ?? parsePageNumber(item.location);
    return <blockquote key={item.id} className="rounded-r-xl border-l-2 border-indigo-500 bg-neutral-950/55 py-3 pl-4 pr-3 text-sm leading-6 text-neutral-300">“{item.quote}”<footer className="mt-2 flex flex-wrap items-center gap-2 text-[10px] not-italic text-neutral-600">
      {page !== null && <button
        type="button"
        data-testid={`source-citation-jump-${item.id}`}
        className="inline-flex items-center gap-1 rounded-full border border-indigo-800/70 px-2 py-0.5 font-medium text-indigo-300 hover:border-indigo-500 hover:text-indigo-200"
        title={t('Abrir fuente')}
        onClick={() => void openEvidenceAtPage(item.nodus_id, evidenceLocator(item))}
      ><Icon name="external" size={10} /> {tx('Ver página {n}', { n: page })}</button>}
      {item.location && <span>{item.location}</span>}
      <span>{item.kind}</span>
    </footer></blockquote>;
  })}</div>;
}

function LinkedWorkCard({ work, page = null, authorsIndex, onOpenTarget, onOpenLibraryWork }: { work: WorkLink; page?: number | null; authorsIndex: AuthorSummary[]; onOpenTarget: CitationPanelProps['onOpenTarget']; onOpenLibraryWork?: OpenCitationLibraryWork }) {
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-950/55 p-3.5" data-testid={`source-citation-work-link-${work.id}`}>
      <div className="flex items-start gap-3"><button className="group min-w-0 flex-1 text-left" onClick={() => onOpenTarget({ kind: 'work', id: work.id }, work.title)}><span className="line-clamp-2 text-sm font-medium leading-5 text-neutral-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-200">{work.title}</span><span className="mt-1 block text-[10px] text-neutral-600">{[work.itemType ? t(ITEM_TYPE_ES[work.itemType] ?? work.itemType) : null, work.year].filter(Boolean).join(' · ')}</span></button><WorkActions compact workId={work.id} zoteroKey={work.zoteroKey} page={page} onOpenLibraryWork={onOpenLibraryWork} /></div>
      {work.authors.length > 0 && <div className="mt-2"><AuthorLinks names={work.authors} authors={authorsIndex} onOpenTarget={onOpenTarget} /></div>}
      {work.development && <p className="mt-3 border-t border-neutral-900 pt-3 text-xs leading-5 text-neutral-500">{work.development}</p>}
      {(work.role || typeof work.confidence === 'number') && <div className="mt-2 flex gap-2 text-[10px] text-neutral-600">{work.role && <span>{work.role}</span>}{typeof work.confidence === 'number' && <span>{t('conf')} {work.confidence.toFixed(2)}</span>}</div>}
    </article>
  );
}

function WorkActions({ workId, zoteroKey, page = null, compact = false, onOpenLibraryWork }: { workId: string; zoteroKey: string | null; page?: number | null; compact?: boolean; onOpenLibraryWork?: OpenCitationLibraryWork }) {
  const local = useLocalWork(workId);
  const buttonClass = compact ? 'btn btn-ghost h-7 px-2 text-[10px]' : 'btn btn-ghost border border-neutral-700 text-xs';
  return <div className="flex shrink-0 flex-wrap gap-1.5" data-testid={`source-citation-work-actions-${workId}`}>
    {zoteroKey && <button className={buttonClass} title={t('Abrir en Zotero')} onClick={() => void window.nodus.openInZotero(zoteroKey)}><Icon name="external" size={compact ? 11 : 13} /> {!compact && 'Zotero'}</button>}
    {local && <button className={`${buttonClass} text-emerald-300`} data-testid={`source-citation-open-local-${workId}`} title={t('Abrir en la biblioteca local')} onClick={() => { if (onOpenLibraryWork) onOpenLibraryWork(local.id, local.scope, page); else requestLibraryDocumentOpen({ itemId: local.id, scope: local.scope, page }); }}><Icon name="library" size={compact ? 11 : 13} /> {!compact && t('Biblioteca local')}</button>}
  </div>;
}

function useLocalWork(workId: string): { id: string; scope: LibraryScope } | null {
  const [local, setLocal] = useState<{ id: string; scope: LibraryScope } | null>(null);
  useEffect(() => {
    let active = true;
    setLocal(null);
    void Promise.allSettled([window.nodus.getGlobalLibraryItem(workId), window.nodus.getLibraryReaderDocument(workId)]).then(([globalResult, readerResult]) => {
      if (!active) return;
      const globalItem = globalResult.status === 'fulfilled' ? globalResult.value as LibraryItemRecord | null : null;
      const reader = readerResult.status === 'fulfilled' ? readerResult.value as LibraryReaderDocument | null : null;
      if (globalItem && (globalItem.attachments.length > 0 || Boolean(globalItem.files?.reader))) setLocal({ id: globalItem.id, scope: 'global' });
      else if (reader && (reader.cleanAvailable || reader.originalAvailable)) setLocal({ id: reader.workId, scope: 'vault' });
    });
    return () => { active = false; };
  }, [workId]);
  return local;
}

function AuthorLinks({ names, authors, onOpenTarget }: { names: string[]; authors: AuthorSummary[]; onOpenTarget: CitationPanelProps['onOpenTarget'] }) {
  const index = useMemo(() => buildAuthorIndex(authors), [authors]);
  return <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-400">{names.map((name, indexInList) => {
    const author = lookupAuthor(index, name);
    return <span key={`${name}:${indexInList}`} className="inline-flex items-center gap-1.5">{indexInList > 0 && <span className="text-neutral-700">·</span>}{author ? <button className="rounded px-1 py-0.5 text-neutral-400 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-200" title={t('Abrir en una pestaña nueva')} onClick={() => onOpenTarget({ kind: 'author', id: author.author_id }, author.fullName || author.name)}>{name}</button> : <span>{name}</span>}</span>;
  })}</div>;
}

function Subheading({ children }: { children: React.ReactNode }) { return <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{children}</h4>; }
function BulletList({ values }: { values: string[] }) { return <ul className="space-y-1.5">{values.map((value, index) => <li key={`${index}:${value}`} className="flex gap-2 text-sm leading-6 text-neutral-400"><span className="text-indigo-400">•</span><span>{value}</span></li>)}</ul>; }
function EmptyLine({ children }: { children: React.ReactNode }) { return <p className="py-3 text-center text-xs text-neutral-600">{children}</p>; }
