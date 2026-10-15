import { useAcademicLearning } from '../learning/AcademicLearningContext';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphEdge, IdeaConnection, IdeaDetail, IdeaListItem, IdeaType, EdgeDetail } from '@shared/types';
import { ManualIdeaEditor } from './ManualIdeaEditor';
import { ManualIndexStatus } from '../components/ManualIndexStatus';
import type { Note } from '@shared/types';
import { Badge, EDGE_LABELS, NODE_LABELS, Icon, Spinner, TypeDot } from '../components/ui';
import { OccurrenceCard, EvidenceLocationLink } from '../components/NodeDetailPanel';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { buildIdeaNote } from '../notes';
import { notifyDataChanged, useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type IdeaNavigationTarget,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';
import { getVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';
import type { IdeasSnapshot } from '../app/viewSnapshots';
import { useListPlacement } from '../listPlacement';
import { academicKnowledgeViewSource, type KnowledgeViewSource } from './knowledgeViewSource';

// Exported because the section's snapshot stores it.
export type SortKey = 'label' | 'type' | 'works' | 'connections' | 'confidence';
type IdeasSurface = 'catalog' | 'idea';
type OpenIdea = { id: string; label: string };
const IDEAS_PAGE_SIZE = 80;

export function IdeasView({
  vaultId,
  target,
  snapshot,
  onSnapshotChange,
  onOpenGraph,
  onOpenAssistant,
  dataSource = academicKnowledgeViewSource,
  scopeControl,
  manual = false,
  emptyMessage,
  testId,
}: {
  vaultId: string | null;
  target?: IdeaNavigationTarget | null;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: IdeasSnapshot;
  onSnapshotChange?: (patch: Partial<IdeasSnapshot>) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  dataSource?: KnowledgeViewSource;
  scopeControl?: ReactNode;
  manual?: boolean;
  emptyMessage?: string;
  testId?: string;
}) {
  const [ideas, setIdeas] = useState<IdeaListItem[]>([]);
  const [totalIdeas, setTotalIdeas] = useState(0);
  // The page and the row that was at the top are one restored value. The page alone
  // would drop the reader in front of row 201 with no context.
  const [pageOffset, setPageOffset] = useState(() => snapshot?.placement?.pageOffset ?? 0);
  const [anchorId, setAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const [loading, setLoading] = useState(true);
  // Restored as initial values only — a reactive `snapshot` prop would fight the
  // reader for their own filters. The search box keeps its immediate and debounced
  // halves in step, or the debounce would wipe the restored cut on mount.
  const [search, setSearch] = useState(() => snapshot?.search ?? '');
  const [searchQuery, setSearchQuery] = useState(() => snapshot?.search ?? '');
  const [typeFilter, setTypeFilter] = useState<IdeaType | ''>(() => snapshot?.typeFilter ?? '');
  const [sortKey, setSortKey] = useState<SortKey>(() => snapshot?.sortKey ?? 'label');
  const [openIdeas, setOpenIdeas] = useState<OpenIdea[]>(() => snapshot?.openIdeas ?? []);
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(() => (
    snapshot?.openIdeas?.some((idea) => idea.id === snapshot.activeIdeaId)
      ? snapshot.activeIdeaId
      : null
  ));
  // An idea tab that is no longer open cannot be the active surface.
  const [surface, setSurface] = useState<IdeasSurface>(() => (
    snapshot?.surface === 'idea' && snapshot.openIdeas?.some((idea) => idea.id === snapshot.activeIdeaId)
      ? 'idea'
      : 'catalog'
  ));
  const [filtersOpen, setFiltersOpenState] = useState(() => snapshot?.filtersOpen ?? false);
  // A cached page is useful while the reader changes pages or returns to a previous
  // sort during the same visit. It must not survive leaving and re-entering Ideas,
  // though: deep scans can finish while the view is unmounted, so the queue-idle
  // transition that normally invalidates query caches may never be observed here.
  const initialListLoad = useRef(true);

  const showIdea = useCallback((idea: OpenIdea) => {
    setOpenIdeas((current) => (
      current.some((open) => open.id === idea.id)
        ? current
        : [...current, idea]
    ));
    setActiveIdeaId(idea.id);
    setSurface('idea');
  }, []);

  const closeIdea = useCallback((ideaId: string) => {
    const closingIndex = openIdeas.findIndex((idea) => idea.id === ideaId);
    if (closingIndex < 0) return;
    const remaining = openIdeas.filter((idea) => idea.id !== ideaId);
    setOpenIdeas(remaining);
    if (activeIdeaId !== ideaId) return;

    const nextActive = remaining[Math.min(closingIndex, remaining.length - 1)] ?? null;
    setActiveIdeaId(nextActive?.id ?? null);
    if (surface === 'idea' && !nextActive) setSurface('catalog');
  }, [activeIdeaId, openIdeas, surface]);

  const updateIdeaLabel = useCallback((ideaId: string, label: string) => {
    setOpenIdeas((current) => current.map((idea) => (
      idea.id === ideaId && idea.label !== label ? { ...idea, label } : idea
    )));
  }, []);

  useEffect(() => {
    if (target) showIdea({ id: target.ideaId, label: t('Idea') });
  }, [showIdea, target]);

  const reload = useCallback((force = true) => {
    const request = {
      offset: pageOffset,
      limit: IDEAS_PAGE_SIZE,
      search: searchQuery || undefined,
      type: typeFilter,
      sort: sortKey,
    } as const;
    const cacheKey = `${dataSource.key}:ideas:${JSON.stringify(request)}`;
    if (!force) {
      const cached = getVaultQueryCache<{ items: IdeaListItem[]; total: number }>(vaultId, cacheKey);
      if (cached) {
        setIdeas(cached.items);
        setTotalIdeas(cached.total);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    void dataSource
      .listIdeasPage(request)
      .then((page) => {
        if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
          setPageOffset(Math.max(0, Math.floor((page.total - 1) / IDEAS_PAGE_SIZE) * IDEAS_PAGE_SIZE));
          return;
        }
        setIdeas(page.items);
        setTotalIdeas(page.total);
        setVaultQueryCache(vaultId, cacheKey, { items: page.items, total: page.total });
      })
      .finally(() => setLoading(false));
  }, [dataSource, pageOffset, searchQuery, sortKey, typeFilter, vaultId]);

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  // The registry builds `onSnapshotChange` inline, so its identity changes on every
  // render of the shell; a ref keeps that out of the effect's dependencies. The
  // stored text is the applied one, not the draft.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    report.current?.({
      surface,
      openIdeas: openIdeas.map(({ id, label }) => ({ id, label })),
      activeIdeaId,
      search: searchQuery,
      typeFilter,
      sortKey,
      filtersOpen,
    });
  }, [activeIdeaId, filtersOpen, openIdeas, searchQuery, sortKey, surface, typeFilter]);

  // Do not leave an explicit filter close waiting for a passive effect: the same
  // click may also dismiss this section. Persist the user's action immediately.
  const toggleFilterPanel = () => {
    const nextOpen = !filtersOpen;
    setFiltersOpenState(nextOpen);
    report.current?.({ filtersOpen: nextOpen });
  };
  const changeTypeFilter = (nextTypeFilter: IdeaType | '') => {
    setTypeFilter(nextTypeFilter);
    report.current?.({ typeFilter: nextTypeFilter });
  };

  // Changing the cut throws the place away with it: a row that was at the top of one
  // filter means nothing under another. It must skip its own first run, though, or
  // arriving with a restored filter would reset the restored page a frame later.
  const cutChanged = useRef(false);
  useEffect(() => {
    if (!cutChanged.current) {
      cutChanged.current = true;
      return;
    }
    setPageOffset(0);
    setAnchorId(null);
    report.current?.({ placement: null });
  }, [searchQuery, sortKey, typeFilter]);

  // Scrolling back to the stored row, once the page holding it has arrived. If it is
  // gone, the list returns to the first page and the top rather than sit on a page
  // with nothing to show for it.
  const scrollerRef = useListPlacement<HTMLDivElement>({
    restoreAnchorId: anchorId,
    revision: ideas,
    onRestoreMissed: () => {
      setAnchorId(null);
      setPageOffset(0);
      report.current?.({ placement: null });
    },
    onCapture: (topId) => report.current?.({ placement: topId ? { anchorId: topId, pageOffset } : null }),
  });

  useEffect(() => {
    const force = initialListLoad.current;
    initialListLoad.current = false;
    reload(force);
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  useEffect(() => dataSource.subscribe?.(() => reload(true)), [dataSource, reload]);

  return (
    <div data-testid={testId ?? 'ideas-workspace'} className="ideas-workspace theme-workspace-surface flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="bulb" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t('Ideas')}</h1>
            <p className="text-[11px] text-neutral-500">{manual ? `${totalIdeas} · ${t('Modo Manual')}` : tx('{n} ideas extraídas', { n: totalIdeas })}</p>
          </div>
        </div>

        <div data-testid="ideas-tabs" className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            data-testid="ideas-tab-catalog"
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${surface === 'catalog' ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}
            onClick={() => setSurface('catalog')}
          >
            <Icon name="list" size={13} /> {t('Ideas')}
          </button>
          {openIdeas.map((idea) => {
            const active = surface === 'idea' && activeIdeaId === idea.id;
            return (
              <div key={idea.id} className={`flex h-9 min-w-0 shrink-0 items-center rounded-t-lg border border-b-0 ${active ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}>
                <button data-testid="ideas-tab-idea" data-idea-id={idea.id} className="flex h-full max-w-80 min-w-0 items-center gap-2 px-3 text-xs" onClick={() => { setActiveIdeaId(idea.id); setSurface('idea'); }}>
                  <Icon name="bulb" size={13} /><span className="truncate">{idea.label}</span>
                </button>
                <button
                  className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                  aria-label={`${t('Cerrar')}: ${idea.label}`}
                  onClick={() => closeIdea(idea.id)}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <div className={surface === 'catalog' ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
          <div className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              {scopeControl}
              {manual && <button className="btn btn-primary" data-testid="manual-create-idea" onClick={async () => {
                const created = await window.nodus.createManualIdea({ folderId: null });
                notifyDataChanged(); showIdea({ id: created.globalId, label: created.note.title });
              }}><Icon name="plus" size={14} /> {t('Crear idea')}</button>}
              <div className="relative min-w-[240px] flex-1">
                <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  data-testid="ideas-search"
                  className="input input-with-leading-icon w-full"
                  placeholder={t('Buscar ideas…')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <button
                data-testid="ideas-filters-toggle"
                className={`btn border border-neutral-300 dark:border-neutral-700 ${filtersOpen || typeFilter ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'btn-ghost'}`}
                onClick={toggleFilterPanel}
              >
                <Icon name="filter" /> {t('Filtros')}{typeFilter ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] dark:bg-indigo-500/20">1</span> : null}
              </button>
            </div>
            {filtersOpen && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-900/55">
                <label className="flex items-center gap-2 text-xs text-neutral-500">
                  {t('Tipo')}
                  <select data-testid="ideas-type-filter" className="input h-8 text-xs" value={typeFilter} onChange={(event) => changeTypeFilter(event.target.value as IdeaType | '')}>
                    <option value="">{t('Todos los tipos')}</option>
                    {(['claim', 'finding', 'construct', 'method', 'framework'] as IdeaType[]).map((type) => <option key={type} value={type}>{t(NODE_LABELS[type])}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-500">
                  {t('Ordenar')}
                  <select data-testid="ideas-sort" className="input h-8 text-xs" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                    <option value="label">{t('Nombre')}</option>
                    <option value="type">{t('Tipo')}</option>
                    <option value="works">{t('Nº de obras')}</option>
                    <option value="connections">{t('Nº de conexiones')}</option>
                    <option value="confidence">{t('Confianza')}</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          <div ref={scrollerRef} data-testid="ideas-table-scroll" className="min-h-0 flex-1 overflow-auto">
            <div data-testid="ideas-catalog-table" className="min-w-[1080px]">
              <div className="grid h-11 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600" style={{ gridTemplateColumns: 'minmax(360px,2.4fr) 8rem 6.5rem 7.5rem 7rem minmax(220px,1.35fr) 2rem' }}>
                <IdeaSortHeader label="Idea" sort="label" active={sortKey} onSort={setSortKey} />
                <IdeaSortHeader label="Tipo" sort="type" active={sortKey} onSort={setSortKey} />
                <IdeaSortHeader label="Nº de obras" sort="works" active={sortKey} onSort={setSortKey} />
                <IdeaSortHeader label="Nº de conexiones" sort="connections" active={sortKey} onSort={setSortKey} />
                <IdeaSortHeader label="Confianza" sort="confidence" active={sortKey} onSort={setSortKey} />
                <span>{t('Temas')}</span><span />
              </div>
              {loading && ideas.length === 0 ? (
                <div className="grid h-48 place-items-center"><Spinner label={t('Cargando ideas…')} /></div>
              ) : ideas.length === 0 ? (
                <div className="grid h-48 place-items-center p-8 text-center text-sm text-neutral-500">
                  {totalIdeas === 0 ? (emptyMessage ?? (manual ? t('Las obras, citas y relaciones son opcionales. Puedes empezar con una idea independiente.') : t('Aún no hay ideas. Ejecuta escaneos profundos para extraer ideas de tus obras.'))) : t('Sin resultados para los filtros actuales.')}
                </div>
              ) : ideas.map((node) => (
                <button
                  key={node.id}
                  data-testid={testId ? 'study-idea-card' : `idea-row-${node.id}`}
                  data-anchor-id={node.id}
                  className="grid min-h-[88px] w-full items-center border-b border-neutral-100 px-4 py-3 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                  style={{ gridTemplateColumns: 'minmax(360px,2.4fr) 8rem 6.5rem 7.5rem 7rem minmax(220px,1.35fr) 2rem' }}
                  onClick={() => showIdea({ id: node.id, label: node.label })}
                >
                  <div className="flex min-w-0 items-center gap-2 pr-5">
                    <TypeDot type={node.type} />
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-neutral-900 dark:text-neutral-200">{node.label}</span>
                      <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-neutral-500">{node.statement}</span>
                    </div>
                  </div>
                  <span className="text-neutral-600 dark:text-neutral-400">{t(NODE_LABELS[node.type as IdeaType]) ?? node.type}</span>
                  <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{node.workCount}</span>
                  <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{node.connectionCount}</span>
                  <span className="tabular-nums text-neutral-600 dark:text-neutral-400">{node.maxConfidence.toFixed(2)}</span>
                  <span className="flex min-w-0 flex-wrap gap-1 pr-3">
                    {node.themes.slice(0, 3).map((theme) => <span key={theme} title={theme} className="ideas-theme-pill max-w-36 truncate rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-900">{theme}</span>)}
                    {node.themes.length > 3 && <span className="ideas-theme-overflow text-[10px] text-neutral-500">+{node.themes.length - 3}</span>}
                  </span>
                  <Icon name="chevronRight" size={14} className="text-neutral-400 dark:text-neutral-600" />
                </button>
              ))}
            </div>
          </div>
          <footer className="flex h-10 shrink-0 items-center border-t border-neutral-200 px-3 text-xs text-neutral-500 dark:border-neutral-800">
            <span>{totalIdeas ? `${pageOffset + 1}–${Math.min(pageOffset + ideas.length, totalIdeas)} / ${totalIdeas}` : '0'}</span><div className="flex-1" />
            <button className="btn btn-ghost h-7" title={t('Anterior')} disabled={pageOffset === 0} onClick={() => setPageOffset((offset) => Math.max(0, offset - IDEAS_PAGE_SIZE))}><Icon name="chevronLeft" size={13} /></button>
            <button className="btn btn-ghost h-7" title={t('Siguiente')} disabled={pageOffset + ideas.length >= totalIdeas} onClick={() => setPageOffset((offset) => offset + IDEAS_PAGE_SIZE)}><Icon name="chevronRight" size={13} /></button>
          </footer>
        </div>

        {openIdeas.map((idea) => (
          <div key={idea.id} className={surface === 'idea' && activeIdeaId === idea.id ? 'h-full' : 'hidden'}>
            {manual ? <ManualIdeaTab globalId={idea.id} reviewRequest={target?.ideaId===idea.id ? target.nonce : undefined} onOpenGraph={onOpenGraph} onSaved={(label) => { updateIdeaLabel(idea.id, label); notifyDataChanged(); reload(true); }} /> : <IdeaDetailTab
              idea={idea}
              summary={ideas.find((candidate) => candidate.id === idea.id) ?? null}
              vaultId={vaultId}
              dataSource={dataSource}
              onOpenIdea={showIdea}
              onOpenGraph={onOpenGraph}
              onOpenAssistant={onOpenAssistant}
              onLabelChange={updateIdeaLabel}
              onDeleted={() => {
                closeIdea(idea.id);
                notifyDataChanged();
                reload(true);
              }}
              testId={testId}
            />}
          </div>
        ))}
      </main>
    </div>
  );
}

function ManualIdeaTab({ globalId, reviewRequest, onOpenGraph, onSaved }: {
  globalId: string;
  reviewRequest?: number;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onSaved: (label: string) => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const learning=useAcademicLearning();
  useEffect(()=>{
    if(!reviewRequest || !note || learning.session?.lessonId!=='first-idea' || learning.session.step!==3)return;
    let active=true;
    void window.nodus.getIdeaDetail(globalId).then(detail=>{
      const evidence=detail?.evidence.find(e=>e.nodus_id===learning.session?.documentId&&e.quote.trim());
      if(active&&evidence)learning.emit({kind:'idea-evidence',ideaId:globalId,documentId:evidence.nodus_id,valid:true});
    });
    return()=>{active=false;};
  },[reviewRequest,note,globalId,learning.emit]);
  useEffect(() => {
    let active = true;
    void window.nodus.getNotesTree().then(tree => {
      if (!active) return;
      setNote(tree.notes.find(n => n.source?.note === 'manual-idea' && n.source.ref === globalId && !n.trashedAt) ?? null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [globalId]);
  if (loading) return <Spinner />;
  if (!note) return <p className="p-6 text-sm text-neutral-500">{t('No se encontró la idea.')}</p>;
  return <div className="flex h-full min-h-0 flex-col">
    <ManualIndexStatus />
    <ManualIdeaEditor note={note} globalId={globalId} manual onOpenGraph={onOpenGraph} onSaved={() => {
      void window.nodus.getIdeaDetail(globalId).then(detail => { if (detail) onSaved(detail.idea.label); });
    }} />
  </div>;
}

function IdeaDetailTab({
  idea,
  summary,
  vaultId,
  dataSource,
  onOpenIdea,
  onOpenGraph,
  onOpenAssistant,
  onLabelChange,
  onDeleted,
  testId,
}: {
  idea: OpenIdea;
  summary: IdeaListItem | null;
  vaultId: string | null;
  dataSource: KnowledgeViewSource;
  onOpenIdea: (idea: OpenIdea) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onLabelChange: (ideaId: string, label: string) => void;
  onDeleted: () => void;
  testId?: string;
}) {
  const learning = useAcademicLearning();
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [connections, setConnections] = useState<IdeaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const cacheKey = `${dataSource.key}:idea-detail:${idea.id}`;
    const cached = getVaultQueryCache<{ detail: IdeaDetail | null; connections: IdeaConnection[] }>(vaultId, cacheKey);
    if (cached) {
      setDetail(cached.detail);
      setConnections(cached.connections);
      if (cached.detail) onLabelChange(idea.id, cached.detail.idea.label);
      setLoading(false);
      return;
    }
    void Promise.all([dataSource.getIdeaDetail(idea.id), dataSource.listIdeaConnections(idea.id)]).then(([nextDetail, linked]) => {
      if (!mounted) return;
      setDetail(nextDetail);
      setConnections(linked);
      if (nextDetail) onLabelChange(idea.id, nextDetail.idea.label);
      setVaultQueryCache(vaultId, cacheKey, { detail: nextDetail, connections: linked });
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [dataSource, idea.id, onLabelChange, vaultId]);

  useEffect(() => {
    const evidence = detail?.evidence.find(e => e.nodus_id === learning.session?.documentId && e.quote.trim());
    if (evidence && detail) learning.emit({kind:'idea-evidence',documentId:evidence.nodus_id,ideaId:detail.idea.global_id,valid:true});
  }, [detail, learning.emit, learning.session?.documentId]);

  const deleteIdea = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await dataSource.deleteIdea(idea.id);
      setConfirmDelete(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  const workCount = detail ? new Set(detail.occurrences.map((occurrence) => occurrence.nodus_id)).size : 0;
  const confidence = summary?.maxConfidence
    ?? (detail?.occurrences.length ? Math.max(...detail.occurrences.map((occurrence) => occurrence.confidence)) : 0);

  return (
    <>
      <div data-testid={testId ? 'study-idea-detail' : 'idea-detail-tab'} className="h-full overflow-y-auto p-5">
        {loading && !detail && <div className="grid h-64 place-items-center"><Spinner label={t('Cargando detalle…')} /></div>}
        {detail && (
          <div className="mx-auto max-w-[1480px] space-y-4">
            <section className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
              <div className="flex flex-wrap items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><Icon name="bulb" size={22} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge color="indigo">{t(NODE_LABELS[detail.idea.type as IdeaType]) ?? detail.idea.type}</Badge></div>
                  <h2 className="mt-2 text-xl font-semibold">{detail.idea.label}</h2>
                  <p className="mt-1 max-w-5xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">{detail.idea.statement}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{tx('{n} obra(s)', { n: workCount })}</Badge>
                    <Badge>{tx('{n} conexión(es)', { n: connections.length })}</Badge>
                    <Badge>{t('Confianza')} {confidence.toFixed(2)}</Badge>
                    {summary?.themes.map((theme) => <Badge key={theme} color="amber">{theme}</Badge>)}
                  </div>
                </div>
                <div className="flex max-w-lg flex-wrap justify-end gap-2">
                  <button className="btn btn-ghost border border-neutral-300 text-xs gap-1.5 dark:border-neutral-700" onClick={() => onOpenGraph({ preset: 'overview', nodeId: detail.idea.global_id, label: `${t('Idea:')} ${detail.idea.label}` })}><Icon name="layers" size={13} /> {t('Grafo')}</button>
                  <button className="btn btn-ghost border border-neutral-300 text-xs gap-1.5 dark:border-neutral-700" onClick={() => onOpenAssistant({ title: `${t('Idea:')} ${detail.idea.label}`, selection: ASSISTANT_CONTEXTS.idea, prompt: `${t('Analiza esta idea dentro del corpus y resume sus conexiones, tensiones y lecturas prioritarias.')}\n\n${t('Idea:')} ${detail.idea.label}\n${detail.idea.statement}` })}><Icon name="chat" size={13} /> {t('Asistente')}</button>
                  <button className="btn btn-ghost border border-neutral-300 text-xs gap-1.5 dark:border-neutral-700" disabled={saving} onClick={() => { if (!dataSource.saveIdea) { setSavingToNotes(true); return; } setSaving(true); void dataSource.saveIdea(detail).finally(() => setSaving(false)); }}><Icon name="notebook" size={13} /> {t(saving ? 'Guardando…' : 'Guardar en notas')}</button>
                  <button className="btn btn-ghost border border-red-200 text-xs text-red-600 gap-1.5 dark:border-red-900/70 dark:text-red-400" disabled={deleting} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={13} /> {t('Eliminar idea')}</button>
                </div>
              </div>
            </section>

            <div className="grid items-start gap-4 xl:grid-cols-12">
              <div className="space-y-4 xl:col-span-7">
                <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/70">
                  <div className="mb-3 flex items-center gap-2"><Icon name="book" size={15} className="text-indigo-500" /><h3 className="font-semibold">{t('Obras que la desarrollan')}</h3><span className="text-xs text-neutral-500">{detail.occurrences.length}</span></div>
                  {detail.occurrences.length > 0 ? <div className="space-y-2">{detail.occurrences.map((occurrence) => <OccurrenceCard key={occurrence.nodus_id} occurrence={occurrence} />)}</div> : <p className="text-sm text-neutral-500">—</p>}
                </section>

                <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/70">
                  <div className="mb-3 flex items-center gap-2"><Icon name="quote" size={15} className="text-indigo-500" /><h3 className="font-semibold">{t('Evidencia anclada')}</h3><span className="text-xs text-neutral-500">{detail.evidence.length}</span></div>
                  {detail.evidence.length > 0 ? <div className="space-y-2">{detail.evidence.map((evidence) => <blockquote key={evidence.id} className="rounded-r-lg border-l-2 border-indigo-500 bg-neutral-50 px-3 py-2 text-sm italic leading-6 text-neutral-600 dark:bg-neutral-900/45 dark:text-neutral-300">“{evidence.quote}” <EvidenceLocationLink nodusId={evidence.nodus_id} location={evidence.location} sourceRef={evidence.source_ref ?? null} pageNumber={evidence.page_number ?? null} suffix={` · ${evidence.kind}`} onOpen={dataSource.openEvidence} /></blockquote>)}</div> : <p className="text-sm text-neutral-500">—</p>}
                </section>
              </div>

              <section data-testid="idea-connections" className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/70 xl:col-span-5">
                <div className="mb-3 flex items-center gap-2"><Icon name="share" size={15} className="text-indigo-500" /><h3 className="font-semibold">{tx('Ideas conectadas ({n})', { n: connections.length })}</h3></div>
                {connections.length > 0 ? <div className="space-y-2">{connections.map(({ edge, node }) => <ConnectedIdeaRow key={edge.id} edge={edge} node={node} onSelectIdea={(id) => onOpenIdea({ id, label: node.label })} onOpenGraph={onOpenGraph} dataSource={dataSource} />)}</div> : <p className="text-sm text-neutral-500">{t('Esta idea aún no tiene conexiones con otras ideas.')}</p>}
              </section>
            </div>
          </div>
        )}
      </div>

      {savingToNotes && detail && !dataSource.saveIdea && (
        <SaveToNotesModal
          content={buildIdeaNote(detail)}
          defaultTitle={detail.idea.label}
          kind="idea"
          source={{ origin: 'idea', ref: detail.idea.global_id }}
          onClose={() => setSavingToNotes(false)}
        />
      )}
      {confirmDelete && detail && (
        <ConfirmModal
          title={t('Eliminar idea')}
          message={tx('Se eliminará «{name}» junto con su embedding, evidencia y conexiones. Esta acción no se puede deshacer.', { name: detail.idea.label })}
          confirmLabel={t('Eliminar idea')}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteIdea()}
        />
      )}
    </>
  );
}

function IdeaSortHeader({ label, sort, active, onSort }: { label: string; sort: SortKey; active: SortKey; onSort: (sort: SortKey) => void }) {
  const ascending = sort === 'label' || sort === 'type';
  return (
    <button className="flex min-w-0 items-center gap-1 text-left hover:text-neutral-800 dark:hover:text-neutral-300" onClick={() => onSort(sort)}>
      <span className="truncate">{t(label)}</span>
      {active === sort && <span className="text-indigo-500">{ascending ? '↑' : '↓'}</span>}
    </button>
  );
}

/**
 * One row in the "connected ideas" list. Clicking the header expands the edge +
 * idea detail inline, just below this row, and folds it back on a second click.
 * Each row keeps its own open/loading state, so several can stay expanded at once
 * and the detail loads lazily only when first opened.
 */
function ConnectedIdeaRow({
  edge,
  node,
  onSelectIdea,
  onOpenGraph,
  dataSource,
}: {
  edge: GraphEdge;
  node: IdeaListItem;
  onSelectIdea: (id: string) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  dataSource: KnowledgeViewSource;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  const loadedRef = useRef(false);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && !loadedRef.current) {
        loadedRef.current = true;
        setLoading(true);
        void Promise.all([dataSource.getIdeaDetail(node.id), dataSource.getEdgeDetail(edge.id)]).then(
          ([ideaD, edgeD]) => {
            setIdeaDetail(ideaD);
            setEdgeDetail(edgeD);
            setLoading(false);
          }
        );
      }
      return next;
    });
  }, [dataSource, edge.id, node.id]);

  const edgeLabel = t(EDGE_LABELS[edge.type as keyof typeof EDGE_LABELS]) ?? edge.type;

  return (
    <div className="border-b border-neutral-800/80 pb-2 last:border-b-0">
      <button
        className={`w-full rounded-lg p-2.5 text-left transition-colors hover:bg-neutral-800/60 ${open ? 'bg-neutral-900/70' : ''}`}
        onClick={toggle}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <TypeDot type={node.type} />
          <span className="text-sm font-medium truncate flex-1 min-w-0">{node.label}</span>
          <Icon
            name="chevronRight"
            size={14}
            className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge color={edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeLabel}</Badge>
          <span className="text-[11px] text-neutral-500">{t('conf')} {edge.confidence.toFixed(2)}</span>
        </div>
      </button>

      {open && (
        <div className="px-2.5 pt-2.5">
          {loading && (
            <div className="animate-pulse space-y-2">
              <div className="h-3 w-2/3 rounded bg-neutral-800" />
              <div className="h-3 w-full rounded bg-neutral-800" />
            </div>
          )}
          {!loading && (
            <>
              {edgeDetail && (edgeDetail.explanation || edgeDetail.evidence.length > 0) && (
                <div className="mb-3">
                  <div className="text-xs text-neutral-500">
                    <span className="text-neutral-300">{edgeDetail.fromLabel}</span> →{' '}
                    <span className="text-neutral-300">{edgeDetail.toLabel}</span>
                  </div>
                  {edgeDetail.explanation && (
                    <p className="text-xs text-neutral-400 mt-1">{edgeDetail.explanation}</p>
                  )}
                  {edgeDetail.evidence.map((ev) => (
                    <blockquote
                      key={ev.id}
                      className="border-l-2 border-indigo-700 pl-2 mt-1 text-xs italic text-neutral-400"
                    >
                      "{ev.quote}" <EvidenceLocationLink nodusId={ev.nodus_id} location={ev.location} sourceRef={ev.source_ref ?? null} pageNumber={ev.page_number ?? null} onOpen={dataSource.openEvidence} />
                    </blockquote>
                  ))}
                </div>
              )}
              {ideaDetail && (
                <>
                  <Badge color="indigo">{t(NODE_LABELS[ideaDetail.idea.type as IdeaType]) ?? ideaDetail.idea.type}</Badge>
                  <p className="text-neutral-400 text-xs mt-1">{ideaDetail.idea.statement}</p>
                  {ideaDetail.occurrences.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] uppercase text-neutral-500 mb-1">{t('Obras')}</div>
                      {ideaDetail.occurrences.slice(0, 3).map((o) => (
                        <OccurrenceCard key={o.nodus_id} occurrence={o} />
                      ))}
                      {ideaDetail.occurrences.length > 3 && (
                        <div className="text-[11px] text-neutral-500 mt-1">
                          +{ideaDetail.occurrences.length - 3} {t('más')}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn btn-ghost text-xs gap-1"
                      onClick={() => onSelectIdea(ideaDetail.idea.global_id)}
                    >
                      <Icon name="bulb" size={12} /> {t('Ver detalle completo')}
                    </button>
                    <button
                      className="btn btn-ghost text-xs gap-1"
                      onClick={() =>
                        onOpenGraph({
                          preset: 'overview',
                          nodeId: ideaDetail.idea.global_id,
                          label: `${t('Idea:')} ${ideaDetail.idea.label}`,
                        })
                      }
                    >
                      <Icon name="layers" size={12} /> {t('Ver en grafo')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
