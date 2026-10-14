import { useLearningArtifact } from '../learning/useLearningArtifact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  AppSettings,
  AuthorDossier,
  AuthorDossierIdea,
  AuthorDossierWork,
  AuthorSummary,
  ModelRef,
  SynthesisMatrix,
  SynthesisMatrixCell,
} from '@shared/types';
import { Badge, Icon, Spinner, TypeDot } from '../components/ui';
import { IdeaDetailModal } from '../components/IdeaDetailModal';
import { ModelPicker } from '../components/ModelPicker';
import { WorkIdeasModal } from './WorkIdeasModal';
import { useDataRefresh, useScanComplete } from '../hooks';
import { useFeatureModel } from '../hooks/useFeatureModel';
import type { AuthorNavigationTarget, PendingGraphNavigationTarget } from '../navigation';
import type { AuthorsSnapshot } from '../app/viewSnapshots';
import { useListPlacement } from '../listPlacement';
import { t, tx } from '../i18n';
import { getVaultQueryCache, invalidateVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';

type AuthorsSurface = 'catalog' | 'author' | 'matrix';
type OpenAuthor = { id: string; label: string; saved?: boolean };

const RELATION_LABELS: Record<string, string> = {
  contradicts: 'contradice a',
  refutes: 'refuta a',
  extends: 'extiende a',
  supports: 'apoya a',
  refines: 'refina a',
  coauthor: 'coautor con',
};

const RELATION_COLORS: Record<string, 'red' | 'amber' | 'green' | 'cyan' | 'neutral'> = {
  contradicts: 'red',
  refutes: 'red',
  extends: 'cyan',
  supports: 'green',
  refines: 'amber',
  coauthor: 'neutral',
};

// Exported because the section's snapshot stores them; the unions stay declared
// here, next to the selects that produce them.
export type SortKey = 'name' | 'surname' | 'works' | 'ideas' | 'connections';
export type SynthFilter = 'all' | 'with' | 'without';
const AUTHORS_PAGE_SIZE = 80;
/** Strongest connections shown inline in the dossier; the rest open in a modal. */
const CONNECTIONS_PREVIEW = 5;

type AuthorConnection = {
  author_id: string;
  name: string;
  weight: number;
  types: string[];
  sharedThemes: string[];
};

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Nombre',
  surname: 'Apellidos',
  works: 'Nº de obras',
  ideas: 'Nº de ideas',
  connections: 'Nº de conexiones',
};

const SYNTH_FILTER_LABELS: Record<SynthFilter, string> = {
  all: 'Todas',
  with: 'Con síntesis',
  without: 'Sin síntesis',
};

/**
 * An author surface can only be active if its tab is still open. The collection and
 * active id are written to the snapshot together, but a closed author with
 * `surface: 'author'` would render an empty pane, so the surface answers to what
 * actually exists.
 */
function restoredSurface(snapshot?: AuthorsSnapshot): AuthorsSurface {
  const surface = snapshot?.surface ?? 'catalog';
  if (surface === 'author' && !snapshot?.openAuthors?.some((author) => author.id === snapshot.activeAuthorId)) return 'catalog';
  if (surface === 'matrix' && !snapshot?.matrixOpen) return 'catalog';
  return surface;
}

export function AuthorsView({
  vaultId,
  settings,
  snapshot,
  onSnapshotChange,
  onOpenGraph,
  target,
}: {
  vaultId: string | null;
  settings: AppSettings;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: AuthorsSnapshot;
  onSnapshotChange?: (patch: Partial<AuthorsSnapshot>) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  target?: AuthorNavigationTarget | null;
}) {
  // Restored as initial values only. A reactive `snapshot` prop would fight the
  // reader for control of their own tabs on every re-render of the shell.
  const [openAuthors, setOpenAuthors] = useState<OpenAuthor[]>(() => snapshot?.openAuthors ?? []);
  const [activeAuthorId, setActiveAuthorId] = useState<string | null>(() => (
    snapshot?.openAuthors?.some((author) => author.id === snapshot.activeAuthorId)
      ? snapshot.activeAuthorId
      : null
  ));
  const [matrixOpen, setMatrixOpen] = useState(() => snapshot?.matrixOpen ?? false);
  const [surface, setSurface] = useState<AuthorsSurface>(() => restoredSurface(snapshot));
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [model, setModel] = useFeatureModel(settings, 'authorModel');

  // The registry builds `onSnapshotChange` inline, so its identity changes on every
  // render of the shell; a ref keeps that out of the effect's dependencies.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    // Only the id and the label: `saved` is refetched by the tab when it mounts, and
    // a stale copy of it here would draw the wrong star.
    report.current?.({
      surface,
      matrixOpen,
      openAuthors: openAuthors.map(({ id, label }) => ({ id, label })),
      activeAuthorId,
    });
  }, [activeAuthorId, matrixOpen, openAuthors, surface]);

  const showAuthor = useCallback((author: OpenAuthor) => {
    setOpenAuthors((current) => (
      current.some((open) => open.id === author.id)
        ? current
        : [...current, author]
    ));
    setActiveAuthorId(author.id);
    setSurface('author');
  }, []);

  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    if (!target || target.nonce === lastTarget.current) return;
    lastTarget.current = target.nonce;
    showAuthor({ id: target.authorId, label: target.name });
  }, [showAuthor, target]);

  const closeAuthor = useCallback((authorId: string) => {
    const closingIndex = openAuthors.findIndex((author) => author.id === authorId);
    if (closingIndex < 0) return;
    const remaining = openAuthors.filter((author) => author.id !== authorId);
    setOpenAuthors(remaining);
    if (activeAuthorId !== authorId) return;

    const nextActive = remaining[Math.min(closingIndex, remaining.length - 1)] ?? null;
    setActiveAuthorId(nextActive?.id ?? null);
    if (surface === 'author' && !nextActive) setSurface('catalog');
  }, [activeAuthorId, openAuthors, surface]);

  const showMatrix = useCallback(() => {
    setMatrixOpen(true);
    setSurface('matrix');
  }, []);

  return (
    <div data-testid="authors-workspace" className="authors-workspace theme-workspace-surface flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              <Icon name="graduation" size={18} />
            </span>
            <div>
              <h1 className="text-base font-semibold">{t('Autores')}</h1>
              <p className="text-[11px] text-neutral-500">{t('Autores, documentos y red autoral.')}</p>
            </div>
        </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{t('Modelo de síntesis')}</span>
            <ModelPicker settings={settings} value={model} onChange={setModel} compact menu />
          </div>
        </div>

        <div data-testid="authors-tabs" className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            data-testid="authors-tab-dossier"
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${surface === 'catalog' ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}
            onClick={() => setSurface('catalog')}
          >
            <Icon name="list" size={13} /> {t('Autores')}
          </button>
          {openAuthors.map((author) => {
            const active = surface === 'author' && activeAuthorId === author.id;
            return (
              <div key={author.id} className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${active ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}>
                <button data-testid="authors-tab-author" data-author-id={author.id} className="flex h-full max-w-64 items-center gap-2 px-3 text-xs" onClick={() => { setActiveAuthorId(author.id); setSurface('author'); }}>
                  <Icon name="user" size={13} /><span className="truncate">{author.label}</span>
                </button>
                <button className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={`${t('Cerrar')}: ${author.label}`} onClick={() => closeAuthor(author.id)}>
                  <Icon name="x" size={11} />
                </button>
              </div>
            );
          })}
          {matrixOpen && (
            <div className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${surface === 'matrix' ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900/60 dark:hover:text-neutral-300'}`}>
              <button data-testid="authors-tab-matrix" className="flex h-full items-center gap-2 px-3 text-xs" onClick={() => setSurface('matrix')}>
                <Icon name="grid" size={13} /> {t('Matriz de síntesis')}
              </button>
              <button className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={() => { setMatrixOpen(false); if (surface === 'matrix') setSurface('catalog'); }}>
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <div className={surface === 'catalog' ? 'h-full' : 'hidden'}><AuthorsCatalog vaultId={vaultId} refreshKey={catalogRevision} snapshot={snapshot} onSnapshotChange={onSnapshotChange} onOpenAuthor={showAuthor} onOpenMatrix={showMatrix} /></div>
        {openAuthors.map((author) => (
          <div key={author.id} className={surface === 'author' && activeAuthorId === author.id ? 'h-full' : 'hidden'}>
            <AuthorDetailTab author={author} vaultId={vaultId} model={model} onOpenAuthor={showAuthor} onOpenGraph={onOpenGraph} onSavedChange={() => setCatalogRevision((value) => value + 1)} />
          </div>
        ))}
        {matrixOpen && <div className={surface === 'matrix' ? 'h-full p-5' : 'hidden'}><MatrixTab onOpenGraph={onOpenGraph} model={model} /></div>}
      </main>
    </div>
  );
}

// ─── Author catalogue ─────────────────────────────────────────────────────────

function AuthorsCatalog({
  vaultId,
  refreshKey,
  snapshot,
  onSnapshotChange,
  onOpenAuthor,
  onOpenMatrix,
}: {
  vaultId: string | null;
  refreshKey: number;
  snapshot?: AuthorsSnapshot;
  onSnapshotChange?: (patch: Partial<AuthorsSnapshot>) => void;
  onOpenAuthor: (author: OpenAuthor) => void;
  onOpenMatrix: () => void;
}) {
  const [authors, setAuthors] = useState<AuthorSummary[]>([]);
  const [totalAuthors, setTotalAuthors] = useState(0);
  // The page and the row that was at the top are one restored value. The page alone
  // would drop the reader in front of row 201 with no context.
  const [pageOffset, setPageOffset] = useState(() => snapshot?.placement?.pageOffset ?? 0);
  const [anchorId, setAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The search box has two states, the immediate one and the debounced one that
  // actually queries. Both start from the stored text, or the debounce would fire
  // on mount and wipe the restored cut back to the whole corpus.
  const [query, setQuery] = useState(() => snapshot?.query ?? '');
  const [queryFilter, setQueryFilter] = useState(() => snapshot?.query ?? '');
  const [sortBy, setSortBy] = useState<SortKey>(() => snapshot?.sortBy ?? 'surname');
  const [synthFilter, setSynthFilter] = useState<SynthFilter>(() => snapshot?.synthFilter ?? 'all');
  const [savedOnly, setSavedOnly] = useState(() => snapshot?.savedOnly ?? false);
  const [filtersOpen, setFiltersOpenState] = useState(() => snapshot?.filtersOpen ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<'markdown' | 'pdf'>('markdown');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [savingAuthorIds, setSavingAuthorIds] = useState<Set<string>>(new Set());

  const reloadAuthors = useCallback(async (force = true) => {
    const request = {
      offset: pageOffset,
      limit: AUTHORS_PAGE_SIZE,
      query: queryFilter || undefined,
      sort: sortBy,
      synthesis: synthFilter,
      savedOnly,
    } as const;
    const cacheKey = `authors:${JSON.stringify(request)}`;
    if (!force) {
      const cached = getVaultQueryCache<{ items: AuthorSummary[]; total: number }>(vaultId, cacheKey);
      if (cached) {
        setAuthors(cached.items);
        setTotalAuthors(cached.total);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const page = await window.nodus.listAuthorsPage(request);
      if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
        setPageOffset(Math.max(0, Math.floor((page.total - 1) / AUTHORS_PAGE_SIZE) * AUTHORS_PAGE_SIZE));
        return;
      }
      setAuthors(page.items);
      setTotalAuthors(page.total);
      setVaultQueryCache(vaultId, cacheKey, { items: page.items, total: page.total });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [pageOffset, queryFilter, savedOnly, sortBy, synthFilter, vaultId]);

  useEffect(() => {
    const handle = setTimeout(() => setQueryFilter(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  // The catalogue reports its own half of the snapshot; the tab strip above reports
  // the other. The stored text is the applied one, not the draft: half a word typed
  // on the way out is not a cut worth returning to.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    report.current?.({ query: queryFilter, sortBy, synthFilter, savedOnly, filtersOpen });
  }, [filtersOpen, queryFilter, savedOnly, sortBy, synthFilter]);

  // Filter controls report on the click itself as well as through the effect. This
  // preserves a deliberate close even when dismissing the panel and navigating
  // away are handled in the same browser interaction.
  const toggleFilterPanel = () => {
    const nextOpen = !filtersOpen;
    setFiltersOpenState(nextOpen);
    report.current?.({ filtersOpen: nextOpen });
  };
  const toggleSavedFilter = () => {
    const nextSavedOnly = !savedOnly;
    setSavedOnly(nextSavedOnly);
    report.current?.({ savedOnly: nextSavedOnly });
  };
  const changeSynthesisFilter = (nextSynthFilter: SynthFilter) => {
    setSynthFilter(nextSynthFilter);
    report.current?.({ synthFilter: nextSynthFilter });
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
  }, [queryFilter, savedOnly, sortBy, synthFilter]);

  // Scrolling back to the stored row, once the page holding it has arrived. If it is
  // not there — deleted, or the corpus changed underneath — the list goes back to the
  // first page and the top rather than sit on a page with nothing to show for it.
  const scrollerRef = useListPlacement<HTMLDivElement>({
    restoreAnchorId: anchorId,
    revision: authors,
    onRestoreMissed: () => {
      setAnchorId(null);
      setPageOffset(0);
      report.current?.({ placement: null });
    },
    onCapture: (topId) => report.current?.({ placement: topId ? { anchorId: topId, pageOffset } : null }),
  });

  useEffect(() => {
    void reloadAuthors(false);
  }, [reloadAuthors]);
  useEffect(() => {
    if (refreshKey > 0) void reloadAuthors(true);
  }, [refreshKey, reloadAuthors]);
  useDataRefresh(reloadAuthors);
  useScanComplete(reloadAuthors);

  const filtered = authors;

  const toggleAuthorSaved = useCallback(async (authorId: string) => {
    const author = authors.find((candidate) => candidate.author_id === authorId);
    if (!author || savingAuthorIds.has(authorId)) return;
    setSavingAuthorIds((current) => new Set(current).add(authorId));
    setError(null);
    try {
      await window.nodus.setAuthorSaved(authorId, !author.saved);
      setAuthors((current) => savedOnly && author.saved
        ? current.filter((entry) => entry.author_id !== authorId)
        : current.map((entry) => entry.author_id === authorId ? { ...entry, saved: !author.saved } : entry));
      if (savedOnly && author.saved) setTotalAuthors((current) => Math.max(0, current - 1));
      if (savedOnly && author.saved) setSelected((current) => { const next = new Set(current); next.delete(authorId); return next; });
      invalidateVaultQueryCache(vaultId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAuthorIds((current) => {
        const next = new Set(current);
        next.delete(authorId);
        return next;
      });
    }
  }, [authors, savedOnly, savingAuthorIds, vaultId]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.author_id));
  const toggleSelectAll = useCallback(() => {
    setSelected((cur) => {
      const next = new Set(cur);
      const every = filtered.length > 0 && filtered.every((a) => next.has(a.author_id));
      if (every) filtered.forEach((a) => next.delete(a.author_id));
      else filtered.forEach((a) => next.add(a.author_id));
      return next;
    });
  }, [filtered]);

  const doExport = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await window.nodus.exportAuthorSyntheses({
        authorIds: [...selected],
        format: exportFormat,
        savedOnly: savedOnly && selected.size === 0,
      });
      setExportMsg(res ? tx('Exportado a {path}', { path: res.path }) : null);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [exportFormat, savedOnly, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-neutral-800 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input data-testid="authors-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar autor…')} className="input input-with-leading-icon w-full" />
          </div>
          <button className={`btn border border-neutral-700 ${filtersOpen || savedOnly || synthFilter !== 'all' ? 'bg-indigo-500/10 text-indigo-300' : 'btn-ghost'}`} onClick={toggleFilterPanel}>
            <Icon name="filter" /> {t('Filtros')}
          </button>
          <button data-testid="authors-open-matrix" className="btn btn-secondary" onClick={onOpenMatrix}>
            <Icon name="grid" /> {t('Matriz de síntesis')}
          </button>
        </div>
        {filtersOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-neutral-900/55 p-2">
            <button
              data-testid="authors-tab-saved"
              aria-pressed={savedOnly}
              className={`btn h-8 text-xs ${savedOnly ? 'bg-amber-500/15 text-amber-300' : 'btn-ghost border border-neutral-700'}`}
              onClick={toggleSavedFilter}
            >
              <Icon name="star" size={13} className={savedOnly ? 'fill-current' : ''} /> {t('Autores guardados')}
            </button>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              {t('Síntesis')}
              <select className="input h-8 text-xs" value={synthFilter} onChange={(event) => changeSynthesisFilter(event.target.value as SynthFilter)}>
                {(Object.keys(SYNTH_FILTER_LABELS) as SynthFilter[]).map((key) => <option key={key} value={key}>{t(SYNTH_FILTER_LABELS[key])}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              {t('Ordenar')}
              <select className="input h-8 text-xs" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => <option key={key} value={key}>{t(SORT_LABELS[key])}</option>)}
              </select>
            </label>
          </div>
        )}
        {selected.size > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-2 py-1.5 text-xs">
            <b>{tx('{n} seleccionados', { n: selected.size })}</b>
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as 'markdown' | 'pdf')} className="input h-8 text-xs"><option value="markdown">Markdown</option><option value="pdf">PDF</option></select>
            <button className="btn btn-ghost h-8" disabled={exporting} onClick={() => void doExport()}><Icon name="download" size={13} /> {tx('Exportar ({n})', { n: selected.size })}</button>
            <button className="ml-auto text-neutral-500 hover:text-neutral-200" onClick={() => setSelected(new Set())}>{t('Limpiar')}</button>
          </div>
        )}
        {exportMsg && <p className="mt-2 text-[11px] text-neutral-500">{exportMsg}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      <div ref={scrollerRef} data-testid="authors-table-scroll" className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1050px]">
          <div className="grid h-10 items-center border-b border-neutral-800 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600" style={{ gridTemplateColumns: '2.25rem minmax(130px,1fr) minmax(150px,1.15fr) 5.5rem 5.5rem 7rem minmax(220px,1.6fr) 6rem 2.5rem' }}>
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label={t('Seleccionar todos')} />
            <AuthorSortHeader label="Nombre" sort="name" active={sortBy} onSort={setSortBy} />
            <AuthorSortHeader label="Apellidos" sort="surname" active={sortBy} onSort={setSortBy} />
            <AuthorSortHeader label="Nº de obras" sort="works" active={sortBy} onSort={setSortBy} />
            <AuthorSortHeader label="Nº de ideas" sort="ideas" active={sortBy} onSort={setSortBy} />
            <AuthorSortHeader label="Nº de conexiones" sort="connections" active={sortBy} onSort={setSortBy} />
            <span>{t('Etiquetas')}</span><span>{t('Síntesis')}</span><span />
          </div>
          {loading && authors.length === 0 ? (
            <div className="grid h-48 place-items-center"><Spinner label={t('Cargando ficha…')} /></div>
          ) : filtered.length === 0 ? (
            <div className="grid h-48 place-items-center p-8 text-center"><div><Icon name="user" size={28} className="mx-auto text-neutral-700" /><p className="mt-3 text-sm text-neutral-400">{t(savedOnly ? queryFilter || synthFilter !== 'all' ? 'No hay autores guardados que coincidan con los filtros.' : 'No has guardado ningún autor todavía.' : 'No hay autores todavía.')}</p></div></div>
          ) : filtered.map((author) => (
            <div key={author.author_id} data-testid={`author-card-${author.author_id}`} data-anchor-id={author.author_id} className="grid min-h-[64px] items-center border-b border-neutral-900 px-3 text-xs hover:bg-neutral-900/55" style={{ gridTemplateColumns: '2.25rem minmax(130px,1fr) minmax(150px,1.15fr) 5.5rem 5.5rem 7rem minmax(220px,1.6fr) 6rem 2.5rem' }}>
              <input type="checkbox" checked={selected.has(author.author_id)} onChange={() => toggleSelect(author.author_id)} aria-label={t('Seleccionar para exportar')} />
              <button data-testid="author-name" className="min-w-0 pr-3 text-left font-medium text-neutral-200 hover:text-indigo-300" onClick={() => onOpenAuthor({ id: author.author_id, label: author.fullName || author.name, saved: author.saved })}><span className="block truncate">{author.firstName || author.fullName || author.name}</span>{author.affiliation && <span className="mt-1 block truncate text-[10px] font-normal text-neutral-600">{author.affiliation}</span>}</button>
              <button className="min-w-0 truncate pr-3 text-left text-neutral-400 hover:text-indigo-300" onClick={() => onOpenAuthor({ id: author.author_id, label: author.fullName || author.name, saved: author.saved })}>{author.lastName || author.name}</button>
              <span className="tabular-nums text-neutral-400">{author.workCount}{author.editedCount > 0 && <span className="ml-1 text-[10px] text-cyan-500/80" title={tx('{n} volúmenes editados', { n: author.editedCount })}>+{author.editedCount} {t('ed.')}</span>}</span>
              <span className="tabular-nums text-neutral-400">{author.ideaCount}</span>
              <span className="tabular-nums text-neutral-400">{author.relationCount}</span>
              <div className="flex min-w-0 flex-wrap gap-1 pr-3">{(author.topTags.length ? author.topTags : author.topThemes).slice(0, 4).map((tag) => <span key={tag} className="authors-tag-pill max-w-32 truncate rounded-full bg-neutral-900 px-2 py-1 text-[10px] text-neutral-500" title={tag}>{tag}</span>)}</div>
              <span className={`flex items-center gap-1 text-[10px] ${author.hasSynthesis ? 'text-indigo-300' : 'text-neutral-600'}`}>{author.hasSynthesis ? <><Icon name="wand" size={11} /> {t('Síntesis')}</> : '—'}</span>
              <button data-testid={`author-save-${author.author_id}`} type="button" onClick={() => void toggleAuthorSaved(author.author_id)} disabled={savingAuthorIds.has(author.author_id)} aria-pressed={author.saved} aria-label={t(author.saved ? 'Quitar de autores guardados' : 'Guardar autor')} title={t(author.saved ? 'Quitar de autores guardados' : 'Guardar autor')} className={`grid h-8 w-8 place-items-center rounded-lg disabled:opacity-50 ${author.saved ? 'text-amber-400 hover:bg-amber-500/10' : 'text-neutral-600 hover:bg-neutral-900 hover:text-amber-400'}`}><Icon name="star" size={15} className={author.saved ? 'fill-current' : ''} /></button>
            </div>
          ))}
        </div>
      </div>
      <footer className="flex h-10 shrink-0 items-center border-t border-neutral-800 px-3 text-xs text-neutral-500">
        <span>{totalAuthors ? `${pageOffset + 1}–${Math.min(pageOffset + authors.length, totalAuthors)} / ${totalAuthors}` : '0'}</span><div className="flex-1" />
        <button className="btn btn-ghost h-7" title={t('Anterior')} disabled={pageOffset === 0} onClick={() => setPageOffset((offset) => Math.max(0, offset - AUTHORS_PAGE_SIZE))}><Icon name="chevronLeft" size={13} /></button>
        <button className="btn btn-ghost h-7" title={t('Siguiente')} disabled={pageOffset + authors.length >= totalAuthors} onClick={() => setPageOffset((offset) => offset + AUTHORS_PAGE_SIZE)}><Icon name="chevronRight" size={13} /></button>
      </footer>
    </div>
  );
}

function AuthorSortHeader({ label, sort, active, onSort }: { label: string; sort: SortKey; active: SortKey; onSort: (sort: SortKey) => void }) {
  return <button className="flex min-w-0 items-center gap-1 text-left hover:text-neutral-300" onClick={() => onSort(sort)}><span className="truncate">{t(label)}</span>{active === sort && <span className="text-indigo-400">{sort === 'name' || sort === 'surname' ? '↑' : '↓'}</span>}</button>;
}

function AuthorDetailTab({ author, vaultId, model, onOpenAuthor, onOpenGraph, onSavedChange }: { author: OpenAuthor; vaultId: string | null; model: ModelRef | null; onOpenAuthor: (author: OpenAuthor) => void; onOpenGraph: (target: PendingGraphNavigationTarget) => void; onSavedChange: () => void }) {
  const [dossier, setDossier] = useState<AuthorDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [saved, setSaved] = useState(Boolean(author.saved));
  const [savingSaved, setSavingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLearningArtifact('authors', dossier?.author.author_id, dossier?.ideas.map(i=>({kind:'idea' as const,id:i.global_id})) ?? []);
  const reload = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const cacheKey = `author-dossier:${author.id}`;
      const cached = force ? undefined : getVaultQueryCache<AuthorDossier | null>(vaultId, cacheKey);
      const [next, summaries] = await Promise.all([
        cached !== undefined ? Promise.resolve(cached) : window.nodus.getAuthorDossier(author.id),
        window.nodus.listAuthors(),
      ]);
      setDossier(next);
      setSaved(summaries.find((entry) => entry.author_id === author.id)?.saved ?? false);
      if (cached === undefined) setVaultQueryCache(vaultId, cacheKey, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [author.id, vaultId]);

  useEffect(() => { void reload(); }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  const synthesize = useCallback(async () => {
    setSynthesizing(true);
    setError(null);
    try {
      const synthesis = await window.nodus.synthesizeAuthor(author.id, model);
      setDossier((current) => current ? { ...current, synthesis } : current);
      invalidateVaultQueryCache(vaultId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSynthesizing(false);
    }
  }, [author.id, model, vaultId]);

  const toggleSaved = useCallback(async () => {
    if (savingSaved) return;
    setSavingSaved(true);
    setError(null);
    try {
      await window.nodus.setAuthorSaved(author.id, !saved);
      setSaved((value) => !value);
      invalidateVaultQueryCache(vaultId);
      onSavedChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingSaved(false);
    }
  }, [author.id, onSavedChange, saved, savingSaved, vaultId]);

  if (loading && !dossier) return <div className="grid h-full place-items-center"><Spinner label={t('Cargando ficha…')} /></div>;
  if (!dossier) return <div className="p-5 text-sm text-neutral-500">{error ?? t('Selecciona un autor para ver su ficha.')}</div>;
  return (
    <div className="h-full overflow-y-auto p-5">
      <AuthorDossierDetail dossier={dossier} model={model} synthesizing={synthesizing} error={error} onSynthesize={synthesize} onOpenGraph={onOpenGraph} onSelectAuthor={(id) => { const relation = dossier.relations.find((entry) => entry.author_id === id); onOpenAuthor({ id, label: relation?.name ?? t('Autor') }); }} saved={saved} savingSaved={savingSaved} onToggleSaved={() => void toggleSaved()} />
    </div>
  );
}

function AuthorDossierDetail({
  dossier,
  model,
  synthesizing,
  error,
  onSynthesize,
  onOpenGraph,
  onSelectAuthor,
  saved,
  savingSaved,
  onToggleSaved,
}: {
  dossier: AuthorDossier;
  model: ModelRef | null;
  synthesizing: boolean;
  error: string | null;
  onSynthesize: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onSelectAuthor: (id: string) => void;
  saved: boolean;
  savingSaved: boolean;
  onToggleSaved: () => void;
}) {
  const [worksOpen, setWorksOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);

  const { author, synthesis } = dossier;
  const connectedAuthors = useMemo(() => {
    const byAuthor = new Map<string, AuthorConnection>();
    for (const relation of dossier.relations) {
      const current = byAuthor.get(relation.author_id) ?? { author_id: relation.author_id, name: relation.name, weight: 0, types: [], sharedThemes: [] };
      current.weight += relation.weight;
      if (!current.types.includes(relation.type)) current.types.push(relation.type);
      for (const theme of relation.sharedThemes) if (!current.sharedThemes.includes(theme)) current.sharedThemes.push(theme);
      byAuthor.set(relation.author_id, current);
    }
    return [...byAuthor.values()].sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name));
  }, [dossier.relations]);

  useEffect(() => {
    setWorksOpen(false);
    setConnectionsOpen(false);
    setSelectedIdeaId(null);
    setIdeasWork(null);
  }, [author.author_id]);

  return (
    <div data-testid="author-detail" className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"><Icon name="user" size={20} /></span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{dossier.fullName || author.name}</h2>
            {author.affiliation && <p className="mt-0.5 text-sm text-neutral-500">{author.affiliation}</p>}
          </div>
          <button
            data-testid="author-detail-save"
            type="button"
            onClick={onToggleSaved}
            disabled={savingSaved}
            aria-pressed={saved}
            aria-label={t(saved ? 'Quitar de autores guardados' : 'Guardar autor')}
            title={t(saved ? 'Quitar de autores guardados' : 'Guardar autor')}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition disabled:opacity-50 ${saved ? 'bg-amber-500/10 text-amber-400 hover:text-amber-300' : 'text-neutral-500 hover:bg-neutral-800 hover:text-amber-400'}`}
          >
            <Icon name="star" size={18} className={saved ? 'fill-current' : ''} />
          </button>
          <button
            className="btn btn-ghost ml-auto shrink-0 border border-neutral-700 text-xs"
            onClick={() => onOpenGraph({ preset: 'authors', nodeId: author.author_id, label: author.name })}
            title={t('Ver en el grafo de autores')}
          >
            <Icon name="network" size={13} /> {t('Ver en grafo')}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-neutral-400">
          <button
            type="button"
            onClick={() => setWorksOpen(true)}
            className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title={t('Ver obras de este autor')}
          >
            <Icon name="book" size={11} />
            {tx('{n} obras', { n: dossier.works.length })}
          </button>
          {dossier.editedWorks.length > 0 && (
            <Badge color="cyan" title={t('Coordina la edición del volumen; las ideas no se le atribuyen.')}>
              {tx('{n} volúmenes editados', { n: dossier.editedWorks.length })}
            </Badge>
          )}
          <Badge>{tx('{n} ideas', { n: dossier.ideas.length })}</Badge>
          <Badge>{tx('{n} conexiones', { n: connectedAuthors.length })}</Badge>
          {dossier.themes.slice(0, 5).map((th) => (
            <Badge key={th} color="indigo">
              {th}
            </Badge>
          ))}
        </div>
      </div>

      {/* 1. Synthesis */}
      <section data-testid="author-synthesis" className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="wand" size={15} className="text-indigo-400" />
          <h4 className="font-medium">{t('Síntesis')}</h4>
          {synthesis?.stale && (
            <Badge color="amber" title={t('Las ideas cambiaron desde la última síntesis')}>
              {t('desactualizada')}
            </Badge>
          )}
          <div className="ml-auto">
            {synthesis && !synthesizing && (
              <button
                className="text-xs px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1"
                onClick={onSynthesize}
              >
                <Icon name="refresh" size={12} /> {t('Regenerar')}
              </button>
            )}
          </div>
        </div>

        {synthesizing ? (
          <Spinner label={t('Generando síntesis…')} />
        ) : !synthesis ? (
          <div>
            <p className="text-sm text-neutral-400 mb-3">
              {t('Genera una tesis central, los puntos clave para recordar y cómo se posiciona este autor frente a los demás.')}
            </p>
            <button
              className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
              onClick={onSynthesize}
            >
              <Icon name="wand" size={14} /> {t('Generar síntesis')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Tesis central')}</p>
              <p className="text-sm text-neutral-100">{synthesis.thesis}</p>
            </div>
            {synthesis.remember.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Qué recordar')}</p>
                <ul className="space-y-1">
                  {synthesis.remember.map((r, i) => (
                    <li key={i} className="text-sm text-neutral-300 flex gap-2">
                      <span className="text-indigo-400 mt-0.5">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {synthesis.positioning && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Cómo se relaciona')}</p>
                <p className="text-sm text-neutral-300">{synthesis.positioning}</p>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>

      {/* 2. Works */}
      {dossier.works.length > 0 && (
        <section data-testid="author-works" data-learning-protected>
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Icon name="book" size={15} className="text-neutral-400" /> {t('Obras')}
          </h4>
          <div className="space-y-1">
            {dossier.works.map((w) => (
              <AuthorWorkRow key={w.nodus_id} work={w} onOpenIdeas={(work) => setIdeasWork(work)} />
            ))}
          </div>
        </section>
      )}

      {/* 2b. Volumes this person edited but did not write. Listed because it is a
             real bibliographic fact, kept apart because none of the ideas above
             come from them. */}
      {dossier.editedWorks.length > 0 && (
        <section data-testid="author-edited-works" data-learning-protected>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <Icon name="book" size={15} className="text-cyan-400" /> {t('Volúmenes que edita')}
          </h4>
          <p className="mb-2 text-xs text-neutral-500">{t('Coordina la edición del volumen; las ideas no se le atribuyen.')}</p>
          {dossier.editedWorks.some((w) => w.attributed) && (
            <p className="mb-2 text-xs text-amber-400/80">
              {t('Excepción: los marcados no registran ningún autor, así que sus ideas se muestran aquí de forma provisional.')}
            </p>
          )}
          <div className="space-y-1">
            {dossier.editedWorks.map((w) => (
              <AuthorWorkRow key={w.nodus_id} work={w} onOpenIdeas={(work) => setIdeasWork(work)} />
            ))}
          </div>
        </section>
      )}

      {/* 3. Searchable idea list */}
      <AuthorIdeasSection ideas={dossier.ideas} onOpenIdea={setSelectedIdeaId} />

      {/* 4. Connected authors, strongest connection first */}
      {connectedAuthors.length > 0 && (
        <section data-testid="author-connections">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Icon name="network" size={15} className="text-neutral-400" /> {t('Conexiones con otros autores')}
          </h4>
          {/* Only the strongest handful: the tail of this list is long enough to
              bury the sections below it, and it reads better on demand. */}
          <div className="overflow-hidden rounded-xl border border-neutral-800">
            {connectedAuthors.slice(0, CONNECTIONS_PREVIEW).map((relation, index) => (
              <AuthorConnectionRow key={relation.author_id} relation={relation} index={index} onSelect={onSelectAuthor} />
            ))}
          </div>
          {connectedAuthors.length > CONNECTIONS_PREVIEW && (
            <button
              data-testid="author-connections-more"
              className="btn btn-ghost mt-2 gap-1.5 border border-neutral-700 text-xs"
              onClick={() => setConnectionsOpen(true)}
            >
              <Icon name="network" size={13} /> {tx('Ver las {n} conexiones', { n: connectedAuthors.length })}
            </button>
          )}
        </section>
      )}

      {worksOpen && (
        <AuthorWorksModal
          authorName={dossier.fullName || author.name}
          works={[...dossier.works, ...dossier.editedWorks]}
          onClose={() => setWorksOpen(false)}
          onOpenWorkIdeas={(work) => {
            setWorksOpen(false);
            setIdeasWork(work);
          }}
        />
      )}
      {connectionsOpen && (
        <AuthorConnectionsModal
          authorName={dossier.fullName || author.name}
          connections={connectedAuthors}
          onClose={() => setConnectionsOpen(false)}
          onSelectAuthor={(id) => {
            setConnectionsOpen(false);
            onSelectAuthor(id);
          }}
        />
      )}
      {selectedIdeaId && (
        <IdeaDetailModal
          initialIdeaId={selectedIdeaId}
          onClose={() => setSelectedIdeaId(null)}
          onOpenGraph={onOpenGraph}
        />
      )}
      {ideasWork && (
        <WorkIdeasModal
          work={ideasWork}
          model={model}
          enableSynthesis
          onClose={() => setIdeasWork(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(work) => {
            setIdeasWork(null);
            onOpenGraph({ preset: 'reading', workId: work.nodus_id, workTitle: work.title, label: `${t('Ideas y conexiones:')} ${work.title}` });
          }}
        />
      )}
    </div>
  );
}

function AuthorIdeasSection({ ideas, onOpenIdea }: { ideas: AuthorDossierIdea[]; onOpenIdea: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ideas;
    return ideas.filter((idea) =>
      [idea.label, idea.statement, idea.development, idea.workTitle, idea.type, ...idea.themes]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [ideas, query]);

  return (
    <section data-testid="author-ideas" className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon name="bulb" size={14} className="text-neutral-400" />
        <h4 className="font-medium">{t('Ideas del autor')}</h4>
        <span className="text-xs text-neutral-500">{ideas.length}</span>
        <div className="relative ml-auto w-full sm:w-80">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
            data-testid="author-ideas-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Buscar ideas…')}
            className="input input-with-leading-icon h-9 w-full text-xs"
        />
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {filtered.length === 0 ? (
          <p className="px-1 py-5 text-xs text-neutral-500">{t('No hay ideas que coincidan.')}</p>
        ) : (
          filtered.map((idea) => (
            <button
              key={idea.global_id}
              type="button"
              onClick={() => onOpenIdea(idea.global_id)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 text-left hover:border-indigo-500/40 hover:bg-neutral-900"
            >
              <div className="flex items-start gap-2">
                <TypeDot type={idea.type} />
                <span className="min-w-0 text-sm font-medium text-neutral-200 line-clamp-2">{idea.label}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-500 line-clamp-3">{idea.statement}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-600">
                <span className="truncate">{idea.workTitle || t('(sin título)')}</span>
                {idea.year && <span className="shrink-0">{idea.year}</span>}
                {idea.provisional && (
                  <span
                    className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-400/90"
                    title={t('Esta obra no registra ningún autor: sus ideas se atribuyen provisionalmente a quien la edita')}
                  >
                    {t('provisional')}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 gap-1">{idea.themes.slice(0, 2).map((theme) => <span key={theme} className="rounded-full bg-neutral-950 px-1.5 py-0.5">{theme}</span>)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  none: 'sin analizar',
  pending: 'pendiente',
  done: 'hecho',
  failed: 'falló',
  skipped_no_text: 'sin texto',
};

const SOURCE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  markdown: 'Markdown',
  upload: 'archivo añadido',
  abstract_only: 'solo resumen',
  none: 'sin texto',
};

function statusLabel(value: string | null | undefined): string {
  return t(STATUS_LABELS[value ?? 'none'] ?? value ?? 'sin analizar');
}

function sourceLabel(value: string | null | undefined): string {
  return value ? t(SOURCE_LABELS[value] ?? value) : t('sin texto');
}

/** One connected author. Shared by the dossier preview and the full-list modal. */
function AuthorConnectionRow({
  relation,
  index,
  onSelect,
}: {
  relation: AuthorConnection;
  index: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(relation.author_id)}
      className={`grid w-full grid-cols-[2rem_minmax(150px,1fr)_minmax(180px,1.4fr)_7rem] items-center gap-3 bg-neutral-900/45 px-3 py-3 text-left hover:bg-neutral-900 ${index > 0 ? 'border-t border-neutral-800' : ''}`}
    >
      <span className="text-center text-xs tabular-nums text-neutral-600">{index + 1}</span>
      <span className="min-w-0"><b className="block truncate text-sm text-neutral-200">{relation.name}</b><span className="mt-1 flex flex-wrap gap-1">{relation.types.map((type) => <Badge key={type} color={RELATION_COLORS[type] ?? 'neutral'}>{t(RELATION_LABELS[type] ?? type)}</Badge>)}</span></span>
      <span className="truncate text-[11px] text-neutral-500">{relation.sharedThemes.length > 0 ? `${t('temas comunes')}: ${relation.sharedThemes.slice(0, 4).join(', ')}` : '—'}</span>
      <span className="justify-self-end rounded-full bg-indigo-500/10 px-2 py-1 text-[11px] tabular-nums text-indigo-300">{tx('{n} conexiones', { n: Number(relation.weight.toFixed(1)) })}</span>
    </button>
  );
}

function AuthorConnectionsModal({
  authorName,
  connections,
  onClose,
  onSelectAuthor,
}: {
  authorName: string;
  connections: AuthorConnection[];
  onClose: () => void;
  onSelectAuthor: (id: string) => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div
        data-testid="author-connections-modal"
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('Conexiones del autor')}
      >
        <div className="flex items-start gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{tx('Conexiones de {name}', { name: authorName })}</h3>
            <p className="text-xs text-neutral-500">{tx('{n} autores conectados', { n: connections.length })}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            onClick={onClose}
            title={t('Cerrar')}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-4.5rem)] overflow-y-auto p-4">
          <div className="overflow-hidden rounded-xl border border-neutral-800">
            {connections.map((relation, index) => (
              <AuthorConnectionRow key={relation.author_id} relation={relation} index={index} onSelect={onSelectAuthor} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AuthorWorksModal({
  authorName,
  works,
  onClose,
  onOpenWorkIdeas,
}: {
  authorName: string;
  works: AuthorDossierWork[];
  onClose: () => void;
  onOpenWorkIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  const ordered = useMemo(
    () =>
      [...works].sort(
        (a, b) =>
          (b.year ?? -Infinity) - (a.year ?? -Infinity) ||
          (a.title || '').localeCompare(b.title || '')
      ),
    [works]
  );

  // Into <body>: as a child of the dossier's `space-y-6` stack the overlay would
  // inherit a top margin and stop covering the title bar (see WorkIdeasModal).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('Obras del autor')}
      >
        <div className="flex items-start gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{tx('Obras de {name}', { name: authorName })}</h3>
            <p className="text-xs text-neutral-500">{tx('{n} obras vinculadas a este autor', { n: works.length })}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            onClick={onClose}
            title={t('Cerrar')}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-4.5rem)] overflow-y-auto p-4 space-y-3">
          {ordered.map((work) => (
            <div key={work.nodus_id} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenWorkIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
                  title={t('Ver todas las ideas de esta obra')}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium text-neutral-100">{work.title || t('(sin título)')}</h4>
                    {work.year && <Badge>{work.year}</Badge>}
                    <Badge color={work.role === 'editor' ? 'cyan' : 'neutral'}>
                      {work.role === 'editor' ? t('editor/a') : t('autor/a')}
                    </Badge>
                    {work.read && (
                      <Badge color="green">
                        <Icon name="check" size={10} /> {t('Leído')}
                      </Badge>
                    )}
                  </div>
                  {work.authors.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-500">{work.authors.join(', ')}</p>
                  )}
                </button>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 flex items-center gap-1"
                    onClick={() => onOpenWorkIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
                    title={t('Ver todas las ideas de esta obra')}
                  >
                    <Icon name="bulb" size={12} />
                    {t('Ideas')}
                  </button>
                  {work.zoteroKey && (
                    <button
                      type="button"
                      className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 flex items-center gap-1"
                      onClick={() => window.nodus.openInZotero(work.zoteroKey!)}
                      title={t('Abrir en Zotero')}
                    >
                      <Icon name="external" size={12} />
                      Zotero
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2 lg:grid-cols-3">
                <InfoRow label={t('Tipo')} value={work.itemType || t('sin tipo')} />
                <InfoRow label="DOI" value={work.doi || t('sin DOI')} />
                <InfoRow label={t('Texto')} value={sourceLabel(work.sourceType)} />
                <InfoRow label={t('Exploración')} value={statusLabel(work.lightStatus)} />
                <InfoRow label={t('Ideas')} value={statusLabel(work.deepStatus)} />
                <InfoRow label={t('Resumen')} value={statusLabel(work.summaryStatus)} />
                <InfoRow label={t('Zotero key')} value={work.zoteroKey || t('sin clave')} />
                <InfoRow label="Nodus ID" value={work.nodus_id} />
              </div>

              {work.notes && (
                <p className="mt-3 border-t border-neutral-800 pt-2 text-xs text-neutral-400 whitespace-pre-wrap">
                  {work.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AuthorWorkRow({
  work,
  onOpenIdeas,
}: {
  work: AuthorDossierWork;
  onOpenIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpenIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
        title={t('Ver todas las ideas de esta obra')}
      >
        <span className="block truncate">{work.title || t('(sin título)')}</span>
      </button>
      {work.year && <span className="shrink-0 text-xs text-neutral-500">{work.year}</span>}
      {work.role === 'editor' && (
        <Badge color="cyan" title={t('Figura como editor/a de esta obra')}>
          {t('ed.')}
        </Badge>
      )}
      {work.role === 'editor' && work.attributed && (
        <Badge color="amber" title={t('Esta obra no registra ningún autor: sus ideas se atribuyen provisionalmente a quien la edita')}>
          {t('atribución provisional')}
        </Badge>
      )}
      {work.read && (
        <Badge color="green" title={t('Leído')}>
          <Icon name="check" size={10} />
        </Badge>
      )}
      <button
        type="button"
        className="shrink-0 text-neutral-500 hover:text-indigo-400"
        title={t('Ver todas las ideas de esta obra')}
        onClick={() => onOpenIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
      >
        <Icon name="bulb" size={13} />
      </button>
      {work.zoteroKey && (
        <button
          className="shrink-0 text-neutral-500 hover:text-indigo-400"
          title={t('Abrir en Zotero')}
          onClick={() => window.nodus.openInZotero(work.zoteroKey!)}
        >
          <Icon name="external" size={13} />
        </button>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-neutral-950/70 px-2 py-1.5">
      <div className="text-[10px] uppercase text-neutral-600">{label}</div>
      <div className="truncate text-neutral-300" title={value}>
        {value}
      </div>
    </div>
  );
}

// ─── Tab 2: Synthesis matrix ──────────────────────────────────────────────────

function MatrixTab({
  onOpenGraph,
  model,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  model: ModelRef | null;
}) {
  const [matrix, setMatrix] = useState<SynthesisMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ authorId: string; themeId: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setMatrix(await window.nodus.getSynthesisMatrix());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  const cellMap = useMemo(() => {
    const map = new Map<string, SynthesisMatrixCell>();
    for (const c of matrix?.cells ?? []) map.set(`${c.authorId}::${c.themeId}`, c);
    return map;
  }, [matrix]);

  const selectedCell = selected ? cellMap.get(`${selected.authorId}::${selected.themeId}`) ?? null : null;
  const selectedAuthor = selected ? matrix?.authors.find((a) => a.author_id === selected.authorId) : undefined;
  const selectedTheme = selected ? matrix?.themes.find((t2) => t2.theme_id === selected.themeId) : undefined;

  const generateStance = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const cell = await window.nodus.synthesizeMatrixCell(selected.authorId, selected.themeId, model);
      setMatrix((cur) =>
        cur
          ? {
              ...cur,
              cells: cur.cells.map((c) =>
                c.authorId === cell.authorId && c.themeId === cell.themeId ? cell : c
              ),
            }
          : cur
      );
    } finally {
      setGenerating(false);
    }
  }, [selected, model]);

  if (loading && !matrix) return <Spinner label={t('Construyendo la matriz…')} />;
  if (!matrix || matrix.authors.length === 0 || matrix.themes.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        {t('Aún no hay suficientes autores y temas analizados para construir la matriz.')}
      </p>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        {t('Filas = autores, columnas = temas. Cada celda muestra cuántas ideas aporta ese autor al tema; haz clic para ver las ideas y generar una postura.')}
      </p>
      <div className="flex-1 min-h-0 flex gap-4">
        <div className="flex-1 min-h-0 overflow-auto border border-neutral-800 rounded-lg">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-neutral-950 border-b border-r border-neutral-800 px-3 py-2 text-left font-medium min-w-[180px]">
                  {t('Autor')}
                </th>
                {matrix.themes.map((th) => (
                  <th
                    key={th.theme_id}
                    title={th.label}
                    className="sticky top-0 z-10 bg-neutral-950 border-b border-neutral-800 px-2 py-2 text-left font-medium text-xs text-neutral-300 max-w-[140px] min-w-[110px] align-bottom"
                  >
                    <span className="line-clamp-2">{th.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.authors.map((a) => (
                <tr key={a.author_id} className="hover:bg-neutral-900/40">
                  <td className="sticky left-0 z-10 bg-neutral-950 border-r border-b border-neutral-800 px-3 py-1.5 truncate max-w-[200px]">
                    {a.name}
                  </td>
                  {matrix.themes.map((th) => {
                    const cell = cellMap.get(`${a.author_id}::${th.theme_id}`);
                    const isSel = selected?.authorId === a.author_id && selected?.themeId === th.theme_id;
                    return (
                      <td key={th.theme_id} className="border-b border-neutral-900 p-1 text-center">
                        {cell ? (
                          <button
                            onClick={() => setSelected({ authorId: a.author_id, themeId: th.theme_id })}
                            title={cell.stance ?? tx('{n} ideas', { n: cell.ideaCount })}
                            className={`w-full h-full min-h-[28px] rounded flex items-center justify-center gap-1 ${
                              isSel ? 'ring-1 ring-indigo-500' : ''
                            } ${cell.stance ? 'bg-indigo-900/40 hover:bg-indigo-900/60' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}
                          >
                            <span className="text-xs text-neutral-200">{cell.ideaCount}</span>
                            {cell.stance && <Icon name="wand" size={10} className="text-indigo-300" />}
                          </button>
                        ) : (
                          <span className="text-neutral-800">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected cell panel */}
        {selectedCell && selectedAuthor && selectedTheme && (
          <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-medium">{selectedAuthor.name}</p>
                <p className="text-xs text-indigo-300">{selectedTheme.label}</p>
              </div>
              <button className="text-neutral-500 hover:text-neutral-300" onClick={() => setSelected(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>

            <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-2 mb-3">
              {generating ? (
                <Spinner label={t('Generando postura…')} />
              ) : selectedCell.stance ? (
                <p className="text-sm text-neutral-200">{selectedCell.stance}</p>
              ) : (
                <button
                  className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
                  onClick={generateStance}
                >
                  <Icon name="wand" size={13} /> {t('Generar postura')}
                </button>
              )}
              {selectedCell.stance && !generating && (
                <button className="mt-2 text-xs text-neutral-500 hover:text-indigo-400 flex items-center gap-1" onClick={generateStance}>
                  <Icon name="refresh" size={11} /> {t('Regenerar')}
                </button>
              )}
            </div>

            <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
              {tx('{n} ideas', { n: selectedCell.ideaCount })}
            </p>
            <div className="space-y-1">
              {selectedCell.ideas.map((idea) => (
                <div key={idea.global_id} className="flex items-center gap-2 text-sm">
                  <TypeDot type={idea.type} />
                  <span className="truncate">{idea.label}</span>
                </div>
              ))}
            </div>
            <button
              className="mt-3 text-xs text-neutral-500 hover:text-indigo-400 flex items-center gap-1"
              onClick={() => onOpenGraph({ preset: 'authors', nodeId: selectedAuthor.author_id, label: selectedAuthor.name })}
            >
              <Icon name="network" size={12} /> {t('Ver autor en el grafo')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
