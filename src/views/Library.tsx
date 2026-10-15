import { useAcademicLearning } from '../learning/AcademicLearningContext';
import { learningText } from '@shared/academicLearningCopy';
import { useAcademicInterface } from '../components/AcademicInterfaceContext';
import { AcademicSecondary } from '../components/AcademicSecondary';
import type { DocumentPreparationState } from '@shared/researchCorpus';
import { openResearchPreparationQueue } from '../components/ResearchPreparationWelcome';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  WorkView,
  WorkFilter,
  CorpusHealthBucketId,
  QueueItem,
  WorkEmbeddingStatus,
  WorkPassageStatus,
  VaultType,
  ZoteroTag,
  CollectionFacet,
  WorkSortKey,
  LibraryReaderReference,
  DocumentUnderstandingState,
} from '@shared/types';
import { Icon } from '../components/ui';
import { CollectionSourceIcon } from '../components/CollectionSourceIcon';
import { confirm, toast } from '../components/feedback';
import { WorkGraphModal } from './WorkGraphModal';
import { WorkIdeasModal } from './WorkIdeasModal';
import { WorkStatusModal } from './WorkStatusModal';
import { DocumentProfileModal } from './DocumentProfileModal';
import { DocumentIndexManager } from './DocumentIndexManager';
import { VirtualList } from '../components/VirtualList';
import { TriStateSwitch, type TriState } from '../components/TriStateSwitch';
import { libraryIndexAction } from '../libraryIndexAction';
import { anchorStyle, useAnchoredCoords } from '../components/dbGrid';
import { notifyDataChanged, useDataRefresh, useDismissableLayer, useScanComplete } from '../hooks';
import { deriveWorkStatus, queueItemsByWork, retryableSteps, type StepId, type WorkReadiness, type WorkStatus } from '../libraryStatus';
import {
  ASSISTANT_CONTEXTS,
  type LibraryNavigationTarget,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { getActiveLang, t, tx } from '../i18n';
import { getVaultQueryCache, invalidateVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';
import { vaultTypeColor } from '@shared/vaultTypes';

import { DOCUMENT_INDEX_MANAGER_VISIBLE } from '@shared/documentIndexPolicy';
import type { LibraryVaultSnapshot, ListPlacement } from '../app/viewSnapshots';

const LIBRARY_ROW_HEIGHT = 64;
const LIBRARY_PAGE_SIZE = 200;
// Title and authors get the room the five pipeline-status columns used to take:
// checkbox, title, authors, year, theme(s), ideas, status, actions.
const LIBRARY_GRID_TEMPLATE =
  '2rem minmax(18rem,2fr) minmax(10rem,1fr) 4.5rem minmax(9rem,1fr) 5rem 11rem 10.5rem';

type StatusFlag = 'deep' | 'summary' | 'ideas' | 'passages' | '!deep' | '!summary' | '!ideas' | '!passages';

/**
 * Columns the table can be ordered by. Only keys the backend can express in SQL
 * are offered: it sorts the WHOLE library before paging, whereas a client-side
 * sort would only reorder the 200 rows already on screen — which reads as "the
 * most incomplete works" while actually being "the most incomplete of this page".
 * Readiness has no SQL expression, so the Status column is filtered, not sorted.
 */
type SortKey = Extract<WorkSortKey, 'title' | 'authors' | 'year' | 'themes' | 'ideas'>;
/** Exported because the Library section's snapshot stores it. */
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

// Counts default to descending (most first); text columns to ascending. A third
// click clears back to the default backend order (year desc, title asc).
const NUMERIC_SORT_KEYS = new Set<SortKey>(['year', 'ideas']);
const initialSortDir = (key: SortKey): 'asc' | 'desc' => (NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc');

/**
 * How each readiness value is presented. Kept in this file, with display-shaped
 * values, so the i18n coverage scan follows it from the `t()` call below.
 */
const READINESS_LABEL: Record<WorkReadiness, string> = {
  unstarted: 'Sin analizar',
  pending: 'Pendiente',
  running: 'Analizando…',
  failed: 'Con fallos',
  noText: 'Sin texto',
  abstractOnly: 'Solo abstract',
  incomplete: 'Incompleto',
  ready: 'Listo',
};

const READINESS_TONE: Record<WorkReadiness, string> = {
  // Reuses utilities that already have a light-mode remap in index.css.
  unstarted: 'border-neutral-700 text-neutral-400',
  pending: 'library-status-warning',
  running: 'library-status-warning',
  failed: 'border-red-700/60 bg-red-900/20 text-red-300',
  noText: 'border-neutral-700 bg-neutral-900/40 text-neutral-400',
  abstractOnly: 'library-status-warning',
  incomplete: 'library-status-warning',
  ready: 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300',
};

const READINESS_ICON: Record<WorkReadiness, string> = {
  unstarted: 'minus',
  pending: 'clock',
  running: 'clock',
  failed: 'x',
  // Nodus never got to see the text of this work.
  noText: 'eyeOff',
  abstractOnly: 'file',
  incomplete: 'alert',
  ready: 'check',
};

/**
 * Why a work can never reach "ready", when that is the case. Written as literal
 * `t()` calls rather than a lookup map: the i18n coverage scan follows literals
 * at the call site, and a map read through a variable slips past it — which ships
 * Spanish to every other language with nothing failing.
 */
function readinessHint(readiness: WorkReadiness, work?: WorkView): string | null {
  if (work?.deep_hash && work.resolved_text_hash && work.deep_hash !== work.resolved_text_hash) {
    return t('El texto disponible ha cambiado. Se conserva el análisis anterior hasta completar un reescaneo.');
  }
  if (work?.text_block_reason === 'file_missing') {
    return t('El adjunto existe en Zotero, pero el archivo ya no está en su ubicación original.');
  }
  if (work?.text_block_reason === 'scanned_no_ocr') {
    return t('El PDF está escaneado y no tiene capa de texto. Activa OCR y vuelve a analizar.');
  }
  if (work?.text_block_reason === 'unreadable') {
    return t('El adjunto no produjo texto utilizable. Revisa el archivo o activa OCR.');
  }
  if (work?.text_block_reason === 'unsupported') {
    return t('El formato del adjunto no es compatible con la extracción de texto.');
  }
  if (work?.text_block_reason === 'zotero_unavailable') {
    return t('Zotero no está disponible. Ábrelo y vuelve a analizar.');
  }
  if (readiness === 'noText') {
    return t('Nodus no encontró texto que leer. Añade el PDF o EPUB en Zotero y vuelve a analizar.');
  }
  if (readiness === 'abstractOnly') {
    return t('El análisis solo pudo usar el abstract, así que esta obra no tendrá texto citable. Añade el PDF o EPUB en Zotero y vuelve a analizar.');
  }
  return null;
}

/** Human label for a corpus-health bucket, matching the notice text on Home. */
function healthBucketLabel(id: CorpusHealthBucketId): string {
  switch (id) {
    case 'withoutText':
      return t('Sin texto');
    case 'lightOnly':
      return t('Solo análisis ligero');
    case 'deepPriority':
      return t('Prioritarias por analizar');
    case 'pdfsToRecover':
      return t('Recuperar texto');
  }
}

type StatusDimension = 'deep' | 'summary' | 'ideas' | 'passages';

const STATUS_FLAGS: { dim: StatusDimension; title: string; label: string; negLabel: string; desc: string; negDesc: string }[] = [
  { dim: 'deep', title: 'Análisis profundo', label: 'Análisis profundo hecho', negLabel: 'Análisis profundo NO hecho', desc: 'deep_status = done', negDesc: 'deep_status != done' },
  { dim: 'summary', title: 'Resumen', label: 'Resumen hecho', negLabel: 'Resumen NO hecho', desc: 'summary_status = done', negDesc: 'summary_status != done' },
  { dim: 'ideas', title: 'Ideas', label: 'Ideas extraídas', negLabel: 'Sin ideas extraídas', desc: 'tiene al menos una idea', negDesc: 'no tiene ninguna idea' },
  { dim: 'passages', title: 'Pasajes', label: 'Pasajes completos', negLabel: 'Pasajes incompletos', desc: 'todos los fragmentos indexados y actuales', negDesc: 'faltan fragmentos o están obsoletos' },
];

function isNegated(f: StatusFlag): boolean {
  return f.startsWith('!');
}

function dimensionOf(f: StatusFlag): StatusDimension {
  return (isNegated(f) ? f.slice(1) : f) as StatusDimension;
}

function labelFor(f: StatusFlag): string {
  const meta = STATUS_FLAGS.find((s) => s.dim === dimensionOf(f));
  return meta ? (isNegated(f) ? meta.negLabel : meta.label) : f;
}

/**
 * The one-click status filters. They run in SQL over the WHOLE library, so what
 * a preset returns is exactly what the pills say — see readinessFilters.ts.
 * 'running' is absent on purpose: it exists only in the live queue. Persisted
 * 'pending' is included so a work waiting to resume is directly filterable.
 */
const STATUS_PRESETS: Exclude<WorkReadiness, 'running'>[] = [
  'unstarted',
  'pending',
  'incomplete',
  'ready',
  'abstractOnly',
  'noText',
  'failed',
];

/** Short names for the five analysis steps, used by the status tooltip. */
const STEP_LABEL: Record<StepId, string> = {
  themes: 'Temas',
  ideas: 'Ideas',
  summary: 'Resumen',
  semantic: 'Búsqueda semántica',
  citable: 'Texto citable',
};

/**
 * The one status a reader actually needs: can I use this work yet? Clicking it
 * opens the per-step breakdown, which is where retrying an individual step lives.
 */
function StatusPill({ status, work, onClick }: { status: WorkStatus; work: WorkView; onClick: () => void }) {
  const { readiness, missing } = status;
  const hint = readinessHint(readiness, work);
  const detail = hint
    ? hint
    : missing.length > 0
      ? `${t('Falta')}: ${missing.map((step) => t(STEP_LABEL[step])).join(', ')}`
      : t(READINESS_LABEL[readiness]);
  return (
    <button
      type="button"
      className={`library-status-pill inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80 ${READINESS_TONE[readiness]}`}
      title={`${detail}\n${t('Ver el detalle paso a paso')}`}
      onClick={onClick}
    >
      <Icon name={READINESS_ICON[readiness]} size={12} className="shrink-0" />
      <span className="truncate">{t(READINESS_LABEL[readiness])}</span>
      {readiness === 'incomplete' && (
        <span className="shrink-0 tabular-nums opacity-80">· {missing.length}</span>
      )}
    </button>
  );
}

/**
 * Overflow menu for the row's secondary actions. It is portaled to `document.body`
 * because the rows live inside a virtualised, clipping scroller — an in-flow menu
 * would be cut off by the row above it — and `useAnchoredCoords` re-measures on
 * scroll so the menu stays glued to its trigger instead of drifting away.
 */
function RowMenu({ label, items }: { label: string; items: { label: string; icon: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const coords = useAnchoredCoords(open, btnRef, 232, 232, 'below');
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="library-row-action library-row-action-neutral inline-flex h-7 w-7 items-center justify-center rounded-md text-base leading-none text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div role="menu" aria-label={label} className="library-row-menu fixed z-50 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-2xl" style={anchorStyle(coords)}>
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  <Icon name={item.icon} size={13} className="shrink-0 opacity-70" />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/** A clickable column header that cycles asc → desc → default on the shared sort. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      className={`group flex items-center gap-1 text-left font-medium hover:text-neutral-200 ${active ? 'text-neutral-100' : ''}`}
      onClick={() => onSort(sortKey)}
      title={t('Ordenar por esta columna')}
      aria-label={`${label} — ${t('Ordenar por esta columna')}`}
    >
      <span className="truncate">{label}</span>
      <Icon
        name={active && sort!.dir === 'asc' ? 'arrowUp' : 'arrowDown'}
        size={12}
        className={`shrink-0 ${active ? 'opacity-80' : 'opacity-0 group-hover:opacity-30'}`}
      />
    </button>
  );
}

export function Library({
  vaultId,
  target,
  onTargetConsumed,
  vaultType,
  academicMode,
  snapshot,
  onSnapshotChange,
  onOpenCollections,
  onOpenNodusCollections,
  onOpenGraph,
  onOpenAssistant,
  onOpenArchive,
  scopeControls,
  onOpenReader,
  onOpenTutorial,
}: {
  vaultId: string | null;
  /** Incoming navigation that pre-applies a filter (e.g. a corpus-health bucket). */
  target?: LibraryNavigationTarget | null;
  /** Pending navigation targets are commands: apply once, then discard. */
  onTargetConsumed?: () => void;
  vaultType?: VaultType;
  academicMode?: 'auto' | 'manual';
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: LibraryVaultSnapshot;
  onSnapshotChange?: (next: LibraryVaultSnapshot) => void;
  onOpenCollections: () => void;
  onOpenNodusCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  onOpenArchive?: () => void;
  scopeControls?: ReactNode;
  onOpenReader: (reference: LibraryReaderReference) => void;
  /** Reopens the Library guide. The header's «?» is the only way back to it. */
  onOpenTutorial: () => void;
}) {
  const interfaceProfile = useAcademicInterface();
  const compact = interfaceProfile === 'simple' || interfaceProfile === 'intermediate';
  const simple = interfaceProfile === 'simple';
  const addFilesRef = useRef<HTMLInputElement>(null);
  // In records vaults the Library holds SECONDARY / published sources (books,
  // published genealogies, transcribed record collections) that can also be mined
  // for records; primary documents live in the Archive.
  const isRecordsVault = vaultType === 'genealogy' || vaultType === 'primary_sources';
  const [works, setWorks] = useState<WorkView[]>([]);
  const [preparationByWork, setPreparationByWork] = useState<Map<string, DocumentPreparationState>>(new Map());
  useEffect(() => {
    if (vaultType !== 'academic') return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;
    const refresh = async () => {
      const version = ++generation;
      try {
        const inventory = await window.nodus.getResearchPreparationInventory();
        if (current && version === generation) setPreparationByWork(new Map(inventory.documents.filter(document => document.workId).map(document => [document.workId!, document.preparation])));
      } catch { /* Keep the last readiness snapshot and existing analysis actions. */ }
    };
    void refresh();
    const release = window.nodus.onResearchPreparationProgress(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refresh(); }, 300);
    });
    return () => { current = false; if (timer) clearTimeout(timer); release(); };
  }, [vaultId, vaultType]);
  const [totalWorks, setTotalWorks] = useState(0);
  // The page and the row that was at the top are one restored value.
  const [pageOffset, setPageOffset] = useState(() => snapshot?.placement?.pageOffset ?? 0);
  // Restored as an initial value only — a reactive `snapshot` prop would fight the
  // reader for their own filters.
  const [filter, setFilter] = useState<WorkFilter>(() => snapshot?.filter ?? {});
  // Local, instantly-responsive text for the search box. It is debounced into
  // `filter.search` so keystrokes stay smooth even on large libraries; both halves
  // start from the stored text so the debounce cannot wipe the restored cut.
  const [searchDraft, setSearchDraft] = useState(() => snapshot?.filter.search ?? '');
  const [availableZoteroTags, setAvailableZoteroTags] = useState<ZoteroTag[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [availableCollections, setAvailableCollections] = useState<CollectionFacet[]>([]);
  const [collectionFilterOpen, setCollectionFilterOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const learning = useAcademicLearning();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Map<string, WorkEmbeddingStatus>>(new Map());
  const [passageStatuses, setPassageStatuses] = useState<Map<string, WorkPassageStatus>>(new Map());
  const [documentStatuses, setDocumentStatuses] = useState<Map<string, DocumentUnderstandingState>>(new Map());
  // A balloon: it never reopens by itself when the section is shown again.
  const [filtersOpen, setFiltersOpenState] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpenState] = useState(() => snapshot?.advancedFiltersOpen ?? false);
  const [collectionsMenuOpen, setCollectionsMenuOpen] = useState(false);
  const [graphWork, setGraphWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);
  const [statusWork, setStatusWork] = useState<WorkView | null>(null);
  const [documentWork, setDocumentWork] = useState<WorkView | null>(null);
  const [documentManagerOpen, setDocumentManagerOpen] = useState(false);
  // Live scan-queue items indexed by work. The persisted *_status fields go
  // Persisted 'pending' says a job must resume; the live queue is the authority
  // that distinguishes an honest "Pendiente" from "Analizando…".
  const [queuedByWork, setQueuedByWork] = useState<Map<string, QueueItem[]>>(new Map());
  // Client-side ordering over the already-in-memory filtered set. `null` keeps
  // the backend order (year desc, title asc).
  const [sort, setSort] = useState<SortState | null>(() => snapshot?.sort ?? null);
  const loadRequestRef = useRef(0);
  const tagFilterRef = useDismissableLayer<HTMLDivElement>({
    open: tagFilterOpen,
    onDismiss: () => setTagFilterOpen(false),
    group: 'library-filters',
  });
  const collectionFilterRef = useDismissableLayer<HTMLDivElement>({
    open: collectionFilterOpen,
    onDismiss: () => setCollectionFilterOpen(false),
    group: 'library-filters',
  });
  // The filters open as a balloon anchored to their button. A group of its own, so the
  // tag and collection dropdowns inside it do not close it when they open.
  const filterBalloonRef = useDismissableLayer<HTMLDivElement>({
    open: filtersOpen,
    onDismiss: () => { setFiltersOpenState(false); setTagFilterOpen(false); setCollectionFilterOpen(false); },
    group: 'library-filter-balloon',
  });
  const collectionsMenuRef = useDismissableLayer<HTMLDivElement>({
    open: collectionsMenuOpen,
    onDismiss: () => setCollectionsMenuOpen(false),
    group: 'library-header-menus',
  });

  // Only the works list depends on the active filter, so typing in the search
  // box must reload nothing else. Keeping this isolated is what stops each
  // keystroke from firing five IPC round-trips against SQLite.
  const [fileDrop, setFileDrop] = useState(false);
  const load = useCallback(async (force = true) => {
    const requestId = ++loadRequestRef.current;
    const cacheKey = `library:${JSON.stringify({ filter, pageOffset, sort })}`;
    if (!force) {
      const cached = getVaultQueryCache<{
        items: WorkView[];
        total: number;
        embeddings: WorkEmbeddingStatus[];
        passages: WorkPassageStatus[];
        documents: Array<{ nodusId: string; status: DocumentUnderstandingState }>;
      }>(vaultId, cacheKey);
      if (cached) {
        setWorks(cached.items);
        setTotalWorks(cached.total);
        setEmbeddingStatuses(new Map(cached.embeddings.map((status) => [status.nodus_id, status])));
        setPassageStatuses(new Map(cached.passages.map((status) => [status.nodus_id, status])));
        setDocumentStatuses(new Map((cached.documents ?? []).map((status) => [status.nodusId, status.status])));
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    try {
      const page = await window.nodus.listWorksPage(filter, {
        offset: pageOffset,
        limit: LIBRARY_PAGE_SIZE,
        sort,
      });
      // A newer filter or refresh may have completed while this request was in
      // flight.  Never replace its results with stale rows.
      if (requestId !== loadRequestRef.current) return;
      if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
        setPageOffset(Math.max(0, Math.floor((page.total - 1) / LIBRARY_PAGE_SIZE) * LIBRARY_PAGE_SIZE));
        return;
      }
      setWorks(page.items);
      setTotalWorks(page.total);
      const ids = page.items.map((work) => work.nodus_id);
      const [statuses, passageIndexStatuses, documentProfileStatuses] = await Promise.all([
        window.nodus.getWorkEmbeddingStatuses(ids),
        window.nodus.getWorkPassageStatuses(ids),
        window.nodus.getDocumentProfileStatuses(ids),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setEmbeddingStatuses(new Map(statuses.map((status) => [status.nodus_id, status])));
      setPassageStatuses(new Map(passageIndexStatuses.map((status) => [status.nodus_id, status])));
      setDocumentStatuses(new Map(documentProfileStatuses.map((status) => [status.nodusId, status.status])));
      setVaultQueryCache(vaultId, cacheKey, {
        items: page.items,
        total: page.total,
        embeddings: statuses,
        passages: passageIndexStatuses,
        documents: documentProfileStatuses,
      });
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [filter, pageOffset, sort, vaultId]);

  // Facets (tags, collections) and per-work index statuses are global — they do
  // not depend on the active filter. Load them once on mount and refresh only
  // when the underlying data actually changes, not on every filter change.
  const loadFacets = useCallback(async (force = true) => {
    if (!force) {
      const cached = getVaultQueryCache<{ tags: ZoteroTag[]; collections: CollectionFacet[] }>(vaultId, 'library:facets');
      if (cached) {
        setAvailableZoteroTags(cached.tags);
        setAvailableCollections(cached.collections);
        return;
      }
    }
    const [tags, collections] = await Promise.all([
      window.nodus.listZoteroTags(),
      window.nodus.listCollectionFacets(),
    ]);
    setAvailableZoteroTags(tags);
    setAvailableCollections(collections);
    setVaultQueryCache(vaultId, 'library:facets', { tags, collections });
  }, [vaultId]);

  useEffect(() => {
    void load(false);
  }, [load]);
  useEffect(() => {
    void loadFacets(false);
  }, [loadFacets]);

  // Stable reference so the event subscriptions below don't re-register on every
  // filter change (which happens on each debounced keystroke).
  const refreshAllRef = useRef<() => void>(() => {});
  refreshAllRef.current = () => {
    void load();
    void loadFacets();
  };
  useDataRefresh(() => refreshAllRef.current());
  // Once a queued analysis finishes, reapply the active tag/status predicate
  // without remounting the virtual list or losing the reader's scroll position.
  useScanComplete(() => refreshAllRef.current());
  useEffect(() => window.nodus.onPassageProgress((progress) => {
    if (!progress.running) refreshAllRef.current();
  }), []);
  useEffect(() => window.nodus.onDocumentIndexProgress(() => {
    const ids = works.map((work) => work.nodus_id);
    if (!ids.length) return;
    void window.nodus.getDocumentProfileStatuses(ids).then((statuses) => {
      setDocumentStatuses(new Map(statuses.map((status) => [status.nodusId, status.status])));
    });
  }), [works]);
  // Seed from the current queue as well as subscribing: a reader arriving at the
  // Library mid-analysis would otherwise see nothing until the next queue event.
  useEffect(() => {
    let alive = true;
    void window.nodus.getQueue().then((progress) => {
      if (alive) setQueuedByWork(queueItemsByWork(progress.items));
    });
    const off = window.nodus.onQueueProgress((progress) => setQueuedByWork(queueItemsByWork(progress.items)));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Focus the list on a corpus-health bucket when the user clicks a health notice
  // on Home. The nonce re-triggers even if the same bucket is chosen twice. We
  // replace the whole filter so the list shows exactly the works that notice
  // counted, and clear any leftover search text.
  useEffect(() => {
    if (!target) return;
    setSearchDraft('');
    setFilter(target.healthBucket ? { healthBucket: target.healthBucket } : {});
    onTargetConsumed?.();
  }, [onTargetConsumed, target]);

  // Open one vault work in the reader. A citation jump arrives this way, and it
  // carries the page it was anchored to so the document does not open on page 1.
  useEffect(() => {
    const itemId = target?.readerItemId;
    if (!itemId) return;
    const page = target.readerPage ?? null;
    void window.nodus.getWork(itemId).then((work) => {
      if (!work) return;
      onOpenReader({
        id: work.nodus_id,
        zoteroKey: work.zotero_key,
        title: work.title,
        authors: work.authors,
        year: work.year,
        ...(page ? { page } : {}),
      });
    });
  }, [onOpenReader, target?.nonce, target?.readerItemId, target?.readerPage]);

  // Debounce the free-text search: push the draft into the filter only after the
  // user pauses, so a burst of keystrokes triggers one DB query instead of one
  // per character.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilter((f) => ((f.search ?? '') === searchDraft ? f : { ...f, search: searchDraft || undefined }));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchDraft]);

  // The cut this section will find again on the way back: the applied filter, not
  // the draft in the search box. The registry rebuilds the callback on every render
  // of the shell, so a ref keeps its identity out of the dependencies.
  const reportSnapshot = useRef(onSnapshotChange);
  reportSnapshot.current = onSnapshotChange;
  // The place in the list is a ref, not state: it changes on every scroll frame, and
  // as state it would re-render this whole view for each one.
  const placementRef = useRef<ListPlacement | null>(snapshot?.placement ?? null);
  const currentSnapshot = useCallback((): LibraryVaultSnapshot => ({
    filter, sort, filtersOpen, advancedFiltersOpen, placement: placementRef.current,
  }), [advancedFiltersOpen, filter, filtersOpen, sort]);
  const snapshotOf = useRef(currentSnapshot);
  snapshotOf.current = currentSnapshot;
  useEffect(() => { reportSnapshot.current?.(currentSnapshot()); }, [currentSnapshot]);

  // A filter can be changed and the section can be left in the same interaction
  // (for example, dismissing a filter by clicking another sidebar section). A
  // passive effect never gets to report that render once this component is
  // unmounted, so keep the snapshot in step at the moment of the user's action.
  // The effect above remains the catch-all for non-interactive changes such as the
  // debounced search and incoming navigation targets.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const updateFilter = useCallback((updater: WorkFilter | ((current: WorkFilter) => WorkFilter)) => {
    const next = typeof updater === 'function' ? updater(filterRef.current) : updater;
    filterRef.current = next;
    setFilter(next);
    reportSnapshot.current?.({ ...snapshotOf.current(), filter: next });
  }, []);

  // VirtualList restores the anchor, because only it knows where an unrendered row
  // would be. What to do when the row is gone is this view's call: the first page.
  const [restoreAnchorId, setRestoreAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const anchorChecked = useRef(restoreAnchorId === null);
  useEffect(() => {
    if (anchorChecked.current || works.length === 0) return;
    anchorChecked.current = true;
    if (works.some((work) => work.nodus_id === restoreAnchorId)) return;
    setRestoreAnchorId(null);
    setPageOffset(0);
    placementRef.current = null;
    reportSnapshot.current?.(snapshotOf.current());
  }, [restoreAnchorId, works]);


  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light');
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (extractionIsDeferred([w.nodus_id])) return;
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep');
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true);
    }
    await reportExtraction(w.nodus_id);
    await load();
  };

  // Records lens: extract persons/places/events from a work's text into the tree.
  const scanRecords = async (w: WorkView) => {
    const r = await window.nodus.scanWorkRecords(w.nodus_id);
    if (r.noText) {
      toast(t('Esta obra no tiene texto para extraer registros.'), { tone: 'error' });
    } else {
      toast(
        t('Extraídos {p} personas y {e} eventos.').replace('{p}', String(r.persons)).replace('{e}', String(r.events)) +
          (r.suggestions ? ` ${t('{n} parentescos sugeridos.').replace('{n}', String(r.suggestions))}` : ''),
        { tone: 'success' }
      );
    }
  };

  const scanSelectedRecords = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    toast(tx('Extrayendo registros de {n} obra(s)…', { n: ids.length }));
    let persons = 0;
    let events = 0;
    for (const id of ids) {
      try {
        const r = await window.nodus.scanWorkRecords(id);
        if (!r.noText) {
          persons += r.persons;
          events += r.events;
        }
      } catch {
        /* skip a work that can't be resolved; the rest still run */
      }
    }
    toast(
      t('Extraídos {p} personas y {e} eventos de la Biblioteca.').replace('{p}', String(persons)).replace('{e}', String(events)),
      { tone: 'success' }
    );
  };

  const reportExtraction = async (documentId:string) => {
    const queue=await window.nodus.getQueue();
    const task=queue.items.filter(item=>item.nodus_id===documentId&&item.kind==='deep').sort((a,b)=>b.enqueued_at.localeCompare(a.enqueued_at))[0];
    learning.emit({kind:'extraction',documentId,taskId:task?.id});
  };
  const extractionIsDeferred = (ids: string[]) => {
    if (learning.session?.lessonId === 'first-idea' && !learning.session.paused && (ids.length !== 1 || learning.session.documentId && ids[0] !== learning.session.documentId)) {
      toast(learningText('chooseBody', getActiveLang()), { tone: 'info' }); return true;
    }
    return learning.requestExtraction?.(ids) ?? false;
  };
  // Full chain for a single work: themes → ideas → summary → index → relationships.
  const processFullWork = async (w: WorkView) => {
    if (extractionIsDeferred([w.nodus_id])) return;
    const refresh = w.deep_status === 'done';
    if (refresh) {
      const ok = await confirm({
        title: t('Renovar análisis'),
        message: t('Se recalcularán temas, ideas, resumen y relaciones con la configuración actual. El análisis anterior seguirá visible si la renovación falla.'),
        confirmLabel: t('Renovar'),
      });
      if (!ok) return;
    }
    await window.nodus.processFull(w.nodus_id, undefined, { mode: refresh ? 'refresh' : 'if-stale' });
    await reportExtraction(w.nodus_id);
    await load();
  };

  const summarizeWork = async (w: WorkView) => {
    await window.nodus.summarizeWork(w.nodus_id);
    await load();
  };




  // Full chain: themes → ideas → summary → index (ideas + passages) → discover relationships.
  const processFullSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0 || extractionIsDeferred(ids)) return;
    const processedIds = works
      .filter((work) => ids.includes(work.nodus_id) && work.deep_status === 'done')
      .map((work) => work.nodus_id);
    if (processedIds.length > 0) {
      const ok = await confirm({
        title: t('Renovar análisis'),
        message: tx('Se renovará el análisis de {n} obra(s) ya procesada(s) con la configuración actual. Los resultados anteriores se conservarán si alguna renovación falla.', { n: processedIds.length }),
        confirmLabel: t('Renovar'),
      });
      if (!ok) return;
    }
    // Already processed works are renewed; the rest run only what is stale.
    const processedSet = new Set(processedIds);
    const pendingNewIds = ids.filter((id) => !processedSet.has(id));
    if (processedIds.length > 0) {
      await window.nodus.processFullBulk(processedIds, undefined, { mode: 'refresh' });
    }
    if (pendingNewIds.length > 0) {
      await window.nodus.processFullBulk(pendingNewIds, undefined, { mode: 'if-stale' });
    }
    for (const documentId of ids) await reportExtraction(documentId);
    setSelected(new Set());
    await load();
  };

  const processFullLibrary = async () => {
    const ids: string[] = [];
    let processed = 0;
    for (let offset = 0; offset < totalWorks; offset += 250) {
      const page = await window.nodus.listWorksPage(filter, { offset, limit: 250, sort: null });
      ids.push(...page.items.map((work) => work.nodus_id));
      processed += page.items.filter((work) => work.deep_status === 'done').length;
    }
    if (ids.length === 0 || extractionIsDeferred(ids)) return;
    const ok = await confirm({
      title: t('Procesar toda la biblioteca'),
      message: tx(
        'Procesar todo encadena para las {n} obra(s) filtrada(s): temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones. Es una operación larga que consume tokens del modelo seleccionado. ¿Continuar?',
        { n: ids.length }
      ),
      confirmLabel: t('Continuar'),
    });
    if (!ok) return;
    await window.nodus.processFullBulk(ids, undefined, { mode: processed > 0 ? 'refresh' : 'if-stale' });
    for (const documentId of ids) await reportExtraction(documentId);
    setSelected(new Set());
    await load();
    toast(tx('Procesado completo en cola para {n} obra(s). Verás el progreso en la cola.', { n: ids.length }));
  };




  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedZoteroTags = filter.zoteroTags ?? [];
  const visibleZoteroTags = useMemo(() => {
    const query = tagSearch.trim().toLocaleLowerCase();
    return query ? availableZoteroTags.filter((tag) => tag.label.toLocaleLowerCase().includes(query)) : availableZoteroTags;
  }, [availableZoteroTags, tagSearch]);

  const toggleZoteroTag = (label: string) => {
    updateFilter((current) => {
      const selected = current.zoteroTags ?? [];
      const normalized = label.toLocaleLowerCase();
      const exists = selected.some((tag) => tag.toLocaleLowerCase() === normalized);
      return {
        ...current,
        zoteroTags: exists ? selected.filter((tag) => tag.toLocaleLowerCase() !== normalized) : [...selected, label],
      };
    });
  };

  const clearZoteroTags = () => {
    updateFilter((current) => ({ ...current, zoteroTags: [], zoteroTagMode: 'any' }));
    setTagSearch('');
  };

  const selectedCollections = filter.collections ?? [];
  const collectionNameByKey = useMemo(
    () => new Map(availableCollections.map((c) => [c.key, c.name])),
    [availableCollections]
  );
  const visibleCollections = useMemo(() => {
    const query = collectionSearch.trim().toLocaleLowerCase();
    return query ? availableCollections.filter((c) => c.name.toLocaleLowerCase().includes(query)) : availableCollections;
  }, [availableCollections, collectionSearch]);

  const toggleCollection = (key: string) => {
    updateFilter((current) => {
      const selected = current.collections ?? [];
      const exists = selected.includes(key);
      return { ...current, collections: exists ? selected.filter((k) => k !== key) : [...selected, key] };
    });
  };

  const clearCollections = () => {
    updateFilter((current) => ({ ...current, collections: [], collectionMode: 'any' }));
    setCollectionSearch('');
  };

  const selectedStatusFlags = filter.statusFlags ?? [];
  const selectedHealthBucket = filter.healthBucket ?? null;
  const selectedReadiness = filter.readiness ?? null;
  // Presets and the corpus-health buckets are both whole-corpus status filters;
  // letting them stack would mean two answers to the same question.
  const setReadiness = (readiness: Exclude<WorkReadiness, 'running'> | null) => {
    setPageOffset(0);
    updateFilter((current) => ({ ...current, readiness: readiness ?? undefined, healthBucket: undefined }));
  };
  const searchValue = searchDraft;
  const hasActiveFilters =
    searchValue.trim().length > 0 ||
    selectedStatusFlags.length > 0 ||
    selectedZoteroTags.length > 0 ||
    selectedCollections.length > 0 ||
    selectedReadiness !== null ||
    selectedHealthBucket !== null;
  const activeFilterCount =
    selectedStatusFlags.length +
    selectedZoteroTags.length +
    selectedCollections.length +
    (selectedReadiness !== null ? 1 : 0) +
    (selectedHealthBucket !== null ? 1 : 0);
  const clearHealthBucket = () => updateFilter((c) => ({ ...c, healthBucket: undefined }));
  const toggleStatusFlag = (f: StatusFlag) =>
    updateFilter((cur) => {
      const set = new Set(cur.statusFlags ?? []);
      const opposite = isNegated(f) ? dimensionOf(f) : (`!${dimensionOf(f)}` as StatusFlag);
      set.delete(opposite);
      if (set.has(f)) set.delete(f); else set.add(f);
      return { ...cur, statusFlags: [...set] };
    });
  const setStatusDimension = (dim: StatusDimension, state: 'off' | 'pos' | 'neg') =>
    updateFilter((cur) => {
      const set = new Set(cur.statusFlags ?? []);
      set.delete(dim);
      set.delete(`!${dim}` as StatusFlag);
      if (state === 'pos') set.add(dim);
      else if (state === 'neg') set.add(`!${dim}` as StatusFlag);
      return { ...cur, statusFlags: [...set] };
    });
  const clearAllFilters = () => {
    updateFilter({});
    setSearchDraft('');
    setTagSearch('');
    setCollectionSearch('');
  };
  const toggleFilterPanel = () => {
    const nextOpen = !filtersOpen;
    setFiltersOpenState(nextOpen);
    if (!nextOpen) {
      setTagFilterOpen(false);
      setCollectionFilterOpen(false);
      setAdvancedFiltersOpenState(false);
    }
    reportSnapshot.current?.({
      ...snapshotOf.current(),
      filtersOpen: nextOpen,
      advancedFiltersOpen: nextOpen ? advancedFiltersOpen : false,
    });
  };

  // A batch action must only operate on the current result set.  Otherwise a
  // selection made before changing a tag/status filter can silently enqueue
  // works that are no longer visible.
  const selectedVisibleIds = useMemo(
    () => works.filter((work) => selected.has(work.nodus_id)).map((work) => work.nodus_id),
    [selected, works]
  );
  useEffect(() => {
    const visibleIds = new Set(works.map((work) => work.nodus_id));
    setSelected((current) => {
      let changed = current.size !== selectedVisibleIds.length;
      if (!changed) {
        for (const id of current) {
          if (!visibleIds.has(id)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? new Set(selectedVisibleIds) : current;
    });
  }, [selectedVisibleIds, works]);

  useEffect(() => {
    if (selectedVisibleIds.length === 1) learning.emit({ kind: 'source', documentId: selectedVisibleIds[0] });
  }, [selectedVisibleIds, learning.emit]);
  useEffect(() => {
    const session=learning.session;
    if (!session || session.paused || !['first-answer','first-idea'].includes(session.lessonId) || !session.documentId || !works.some(work=>work.nodus_id===session.documentId)) return;
    setSelected(current=>current.size===0?new Set([session.documentId!]):current);
  }, [learning.session?.id,learning.session?.documentId,learning.session?.paused,works]);

  const allVisibleSelected = works.length > 0 && selectedVisibleIds.length === works.length;
  const selectAllVisible = () => {
    setSelected(new Set(works.map((work) => work.nodus_id)));
  };
  // Click a header: sort by it (default direction), flip direction on the second
  // click, and clear back to the backend order on the third.
  const cycleSort = (key: SortKey) =>
    setSort((cur) => {
      setPageOffset(0);
      const first = initialSortDir(key);
      if (!cur || cur.key !== key) return { key, dir: first };
      if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
      return null;
    });

  // Only the rendered list is reordered; selection, counts and batch actions keep
  // using `works` since they are order-independent.
  const sortedWorks = useMemo(() => {
    if (!sort) return works;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const value = (w: WorkView): number | string => {
      switch (sort.key) {
        case 'title':
          return w.title.toLocaleLowerCase();
        case 'authors':
          return (w.authors[0] ?? '').toLocaleLowerCase();
        case 'year':
          return w.year ?? Number.NEGATIVE_INFINITY;
        case 'themes':
          return (w.themes[0] ?? '').toLocaleLowerCase();
        case 'ideas':
          return w.ideaCount;
      }
    };
    return [...works].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      // Stable, predictable tiebreak so equal keys don't jitter between renders.
      return cmp !== 0 ? cmp * dir : a.title.localeCompare(b.title);
    });
  }, [works, sort]);

  /** One derived status per visible row, recomputed when its inputs move. */
  const statusByWork = useMemo(() => {
    const map = new Map<string, WorkStatus>();
    for (const w of works) {
      map.set(
        w.nodus_id,
        deriveWorkStatus(w, embeddingStatuses.get(w.nodus_id), passageStatuses.get(w.nodus_id), queuedByWork.get(w.nodus_id))
      );
    }
    return map;
  }, [works, embeddingStatuses, passageStatuses, queuedByWork]);

  /**
   * What "retry what is missing" would enqueue, grouped by the call that queues it.
   *
   * A work whose themes or ideas are unfinished runs the whole chain instead of its
   * remaining steps, the same rule the per-work status modal applies: the indexes are
   * built FROM the ideas, so starting them against ideas that are about to be rebuilt
   * would index nothing. Everything else is grouped one call per step, so a 200-work
   * selection costs a handful of IPC calls instead of one per work.
   */
  const retryPlan = useMemo(() => {
    const chain: string[] = [];
    const summaries: string[] = [];
    const semantic: string[] = [];
    const citable: string[] = [];
    let pending = 0;
    for (const id of selectedVisibleIds) {
      const status = statusByWork.get(id);
      if (!status) continue;
      const steps = retryableSteps(status);
      if (steps.length === 0) continue;
      pending += 1;
      if (steps.includes('themes') || steps.includes('ideas')) {
        chain.push(id);
        continue;
      }
      if (steps.includes('summary')) summaries.push(id);
      if (steps.includes('semantic')) semantic.push(id);
      if (steps.includes('citable')) citable.push(id);
    }
    return { chain, summaries, semantic, citable, works: pending };
  }, [selectedVisibleIds, statusByWork]);

  /**
   * Repair only what is unfinished, for every selected work.
   *
   * Deliberately does NOT consult the cross-vault reuse checkbox: this is the repair
   * path, and importing another vault's analysis is not what a reader asking to
   * finish what is pending expects.
   */
  const retryMissingSelected = async () => {
    const { chain, summaries, semantic, citable, works: targets } = retryPlan;
    if (targets === 0) {
      toast(t('No queda nada pendiente en la selección.'));
      return;
    }
    if (chain.length > 0) await window.nodus.processFullBulk(chain);
    if (summaries.length > 0) await window.nodus.summarizeBulk(summaries);
    if (semantic.length > 0) await window.nodus.startEmbedding(semantic);
    if (citable.length > 0) await window.nodus.startPassageEmbedding(citable);
    setSelected(new Set());
    await load();
    toast(tx('Pendientes en cola para {n} obra(s). Verás el progreso en la cola.', { n: targets }));
  };

  /**
   * Remove the selected works from this vault, with their derived data.
   *
   * The confirmation spells out both halves, because the half that matters cannot be
   * seen afterwards: this vault's works and everything derived from them go, while the
   * analysis other works share with them stays. The main process is the authority on
   * what "derived" covers — this only asks and reports.
   */
  const deleteSelected = async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: tx('Eliminar las {n} obras seleccionadas', { n: ids.length }),
      message: tx(
        'Se eliminarán del vault actual las {n} obra(s) seleccionada(s), junto con sus ideas extraídas, sus pasajes, sus embeddings y el resto de datos derivados. Las ideas y demás datos que compartan con otras obras se conservan. Esta acción no se puede deshacer.',
        { n: ids.length }
      ),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      const outcome = await window.nodus.deleteWorks(ids);
      if (!outcome.ok) {
        // Deleting underneath a running analysis would let its publication re-create
        // rows for a work that no longer exists, so the main process refuses.
        toast(
          tx('No se pueden eliminar obras que se están analizando ahora mismo ({n}). Espera a que terminen o detén la cola.', { n: outcome.running.length }),
          { tone: 'error' }
        );
        return;
      }
      setSelected(new Set());
      notifyDataChanged();
      await load();
      toast(tx('Se eliminaron {n} obra(s) del vault.', { n: outcome.deleted.length }), { tone: 'success' });
    } catch (error) {
      toast(error instanceof Error ? error.message : t('No se pudieron eliminar las obras seleccionadas.'), { tone: 'error' });
    }
  };

  const openReader = (work: WorkView) => onOpenReader({
    id: work.nodus_id,
    zoteroKey: work.zotero_key,
    title: work.title,
    authors: work.authors,
    year: work.year,
  });
  const openVaultWorkAnalysis = (work: WorkView) => setIdeasWork({ nodus_id: work.nodus_id, title: work.title });

  // Indexing is one click: documents that are not indexed yet are queued for text and
  // embeddings at once. Only a request for more than 100 documents asks first.
  const indexWorks = async (workIds?: string[]) => {
    if (learning.session?.lessonId === 'first-answer' && !learning.session.paused && (!workIds || workIds.length !== 1 || workIds[0] !== learning.session.documentId)) { toast(learningText('chooseBody', getActiveLang()), { tone: 'info' }); return; }
    if (learning.session?.lessonId === 'first-answer' && !learning.session.paused && learning.requireModels?.('chat')) return;
    try {
      let result = await window.nodus.indexResearchWorks({ workIds });
      if (result.confirmationRequired) {
        const accepted = await confirm({
          title: t('Indexar documentos'),
          message: tx('Se indexarán {n} documentos con el modelo de embeddings configurado. ¿Continuar?', { n: result.confirmationRequired }),
          confirmLabel: t('Indexar'),
        });
        if (!accepted) return;
        result = await window.nodus.indexResearchWorks({ workIds, confirmed: true });
      }
      if (!result.embeddingAvailable) toast(t('Configura un modelo de embeddings para indexar.'), { tone: 'error' });
      else if (result.queued) toast(tx('{n} documento(s) en cola para indexar.', { n: result.queued }));
      else if (result.alreadyIndexed) toast(t('Ya está todo indexado.'), { tone: 'info' });
    } catch (error) { toast(error instanceof Error ? error.message : String(error), { tone: 'error' }); }
  };

  // Files dropped here go to the Global Library and are used in this vault in one step,
  // so this vault's automatic preparation indexes them like any other addition.
  const importDroppedIntoVault = async (fileList: FileList) => {
    setFileDrop(false);
    const filePaths = [...new Set(Array.from(fileList)
      .map((file) => window.nodus.getPathForDroppedFile(file))
      .filter((entry): entry is string => !!entry))];
    if (!filePaths.length) return;
    try {
      if (await learning.prepareAddition?.()) return;
      const targetVaultId = vaultId ?? (await window.nodus.getActiveVault()).id;
      const report = await window.nodus.importDroppedFilesIntoVault(filePaths, targetVaultId);
      if (report.linked) {
        const automatic = vaultType === 'academic' ? (await window.nodus.getResearchPreparationPolicy().catch(() => null))?.futureAdditions : false;
        toast(automatic
          ? tx('{n} documento(s) añadido(s) a este vault y a la Biblioteca global. Se indexarán automáticamente.', { n: report.linked })
          : tx('{n} documento(s) añadido(s) a este vault y a la Biblioteca global. La indexación automática está desactivada.', { n: report.linked }));
      } else if (report.alreadyInVault) toast(t('Esos documentos ya estaban en este vault.'), { tone: 'info' });
      else if (report.warnings.length) toast(report.warnings[0], { tone: 'error' });
      invalidateVaultQueryCache(targetVaultId);
      notifyDataChanged();
      await load(true);
    } catch (error) { toast(error instanceof Error ? error.message : String(error), { tone: 'error' }); }
  };

  return (
    <div data-testid="library-vault-file-drop-surface" className="relative h-full flex flex-col p-6 min-h-0"
      onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setFileDrop(true); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDrop(false); }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void importDroppedIntoVault(event.dataTransfer.files);
      }}
    >
      {fileDrop && <div data-testid="library-vault-file-drop-overlay" className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-500/10 backdrop-blur-sm">
        <div className="rounded-2xl border border-indigo-400/35 bg-white/95 px-7 py-5 text-center shadow-2xl dark:bg-neutral-950/95">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500"><Icon name="upload" size={22} /></span>
          <b className="mt-3 block text-sm">{t('Suelta para añadir')}</b>
          <span className="mt-1 block max-w-xs text-xs text-neutral-500">{t('Se añadirá a la Biblioteca global y a este vault.')}</span>
        </div>
      </div>}
      <header data-testid="library-vault-header" className="library-header-bar -mx-6 -mt-6 mb-4 min-h-14 shrink-0 border-b border-neutral-800 px-5 py-3">
        <div className="library-header-title min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="book" className="text-indigo-400" /> {t('Biblioteca')}</h1>
          <p className="text-[11px] text-neutral-500">{tx('{n} obras visibles', { n: totalWorks })}</p>
        </div>
        {scopeControls}
        <div className="library-header-actions">
          {vaultType === 'academic' && <><input ref={addFilesRef} type="file" multiple hidden onChange={event => { if (event.target.files?.length) void importDroppedIntoVault(event.target.files); event.target.value = ''; }} /><button className="btn btn-primary" data-testid="library-vault-add-files" onClick={() => addFilesRef.current?.click()}><Icon name="plus" size={14} />{t('Añadir archivos')}</button></>}

          {vaultType === 'academic' && <>
            <button className="btn btn-ghost border border-neutral-700" data-testid="library-prepare-sources" data-scope={selectedVisibleIds.length > 0 ? 'selection' : 'library'} onClick={() => void indexWorks(selectedVisibleIds.length > 0 ? selectedVisibleIds : undefined)}>{t(selectedVisibleIds.length > 0 ? 'Indexar selección' : 'Indexar biblioteca')}</button>
            <button className="btn btn-ghost" onClick={openResearchPreparationQueue}>{t('Ver en Queue')}</button>
          </>}
          <AcademicSecondary compact={compact}>
          {simple && academicMode !== 'manual' && <button className="btn btn-ghost" onClick={() => void (selectedVisibleIds.length ? processFullSelected() : processFullLibrary())}>{t('Extraer ideas')}</button>}
          {academicMode !== 'manual' && DOCUMENT_INDEX_MANAGER_VISIBLE && vaultType === 'academic' && <button
            data-testid="document-index-manager-button"
            className="btn btn-ghost border border-neutral-700 gap-1.5"
            onClick={() => setDocumentManagerOpen(true)}
            title={t('Gestionar la comprensión jerárquica de documentos completos')}
          >
            {/* Whole-document understanding is still beta: slow on long texts, and
                not always right about the structure. The badge says so up front. */}
            <Icon name="layers" /> {t('Ficha documental')}
            <em data-testid="document-index-beta" className="library-action-menu-badge is-beta">BETA</em>
          </button>}
          <div className="relative z-40" ref={collectionsMenuRef}>
            <button
              data-testid="library-collections-menu-toggle"
              className={`btn border border-neutral-700 gap-1.5 ${collectionsMenuOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
              onClick={() => setCollectionsMenuOpen((open) => !open)}
              aria-expanded={collectionsMenuOpen}
              aria-haspopup="menu"
            >
              <Icon name="folder" /> {t('Colecciones')}
              <Icon name="chevronDown" size={12} className={`transition-transform ${collectionsMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {collectionsMenuOpen && (
              <div
                data-testid="library-collections-menu"
                role="menu"
                className="library-action-menu absolute right-0 z-50 mt-2 w-64 rounded-xl border border-neutral-800 bg-neutral-950 p-1.5 shadow-2xl"
              >
                <button
                  data-testid="open-nodus-collections"
                  role="menuitem"
                  className="library-action-menu-item"
                  onClick={() => {
                    setCollectionsMenuOpen(false);
                    onOpenNodusCollections();
                  }}
                >
                  <Icon name="library" />
                  {/* The two sources carry the same badges the guide and the setup
                      wizard use, so "choose Nodus or Zotero" reads the same everywhere. */}
                  <span><span className="library-action-menu-heading"><b>{t('Colecciones de Nodus')}</b><em data-testid="nodus-collections-beta" className="library-action-menu-badge is-beta">BETA</em></span><small>{t('Global')}</small></span>
                </button>
                <button
                  data-testid="open-zotero-collections"
                  role="menuitem"
                  className="library-action-menu-item"
                  onClick={() => {
                    setCollectionsMenuOpen(false);
                    onOpenCollections();
                  }}
                >
                  <Icon name="folder" />
                  <span><span className="library-action-menu-heading"><b>{t('Colecciones de Zotero')}</b><em data-testid="zotero-collections-recommended" className="library-action-menu-badge is-recommended">{t('Recomendado')}</em></span><small>{t('Este vault')}</small></span>
                </button>
              </div>
            )}
          </div>
          </AcademicSecondary>
          {/* The only unlabelled button in the row, so it wears the vault's own accent
              rather than the neutral outline the others share: a help affordance
              nobody can find is the same as no help at all. */}
          <button
            data-testid="library-open-tutorial"
            type="button"
            className="library-help-button"
            style={{ ['--library-help-accent' as string]: vaultTypeColor(vaultType) }}
            onClick={academicMode === 'manual' ? () => toast(t('Crea tus ideas, vincula obras y añade citas y relaciones a tu ritmo. Nodus las indexa para facilitar la búsqueda.')) : onOpenTutorial}
            aria-label={t('Cómo funciona la Biblioteca')}
            title={t('Cómo funciona la Biblioteca')}
          >
            <Icon name="help" size={17} />
          </button>
        </div>
      </header>

      <div className="card p-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-[18rem] flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              data-testid="library-vault-search"
              className="input input-with-leading-icon w-full"
              value={searchDraft}
              placeholder={t('Buscar título o autor…')}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <div className="relative" ref={filterBalloonRef}>
            <button
              data-testid="library-vault-filters-toggle"
              type="button"
              className={`library-filter-button tone-indigo btn shrink-0 border gap-1.5 ${filtersOpen || activeFilterCount > 0 ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
              onClick={toggleFilterPanel}
              aria-expanded={filtersOpen}
              aria-controls="library-vault-filters-panel"
            >
              <Icon name="filter" /> {t('Filtros')}
              {activeFilterCount > 0 && (
                <span className="library-filter-count tone-indigo rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filtersOpen && (
              <div
                id="library-vault-filters-panel"
                data-testid="library-vault-filters-panel"
                role="dialog"
                aria-label={t('Filtros')}
                className="library-filter-balloon absolute right-0 top-full z-40 mt-2 w-[30rem] max-w-[calc(100vw-3rem)] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
              >
                {academicMode !== 'manual' && <>
                <div className="mb-2 text-xs font-medium text-neutral-300">{t('Estado de análisis')}</div>
                <div className="space-y-1">
                  {STATUS_FLAGS.map((flag) => {
                    const state: TriState = selectedStatusFlags.includes(flag.dim) ? 'pos' : selectedStatusFlags.includes(`!${flag.dim}` as StatusFlag) ? 'neg' : 'off';
                    return (
                      <div key={flag.dim} data-testid={`library-status-filter-${flag.dim}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-neutral-900/60">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200">{t(flag.title)}</div>
                          <div className="text-[11px] text-neutral-500">{state === 'pos' ? t(flag.label) : state === 'neg' ? t(flag.negLabel) : t('Indiferente')}</div>
                        </div>
                        <TriStateSwitch
                          value={state}
                          label={t(flag.title)}
                          posLabel={t(flag.label)}
                          negLabel={t(flag.negLabel)}
                          testId={`library-status-switch-${flag.dim}`}
                          onChange={(next) => setStatusDimension(flag.dim, next)}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mb-2 mt-3 border-t border-neutral-800 pt-3 text-xs font-medium text-neutral-300">{t('Preparación')}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`library-preset btn border px-2.5 py-1 text-xs ${
                      selectedReadiness === null ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'
                    }`}
                    onClick={() => setReadiness(null)}
                  >
                    {t('Todo')}
                  </button>
                  {STATUS_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`library-preset btn border gap-1.5 px-2.5 py-1 text-xs ${
                        selectedReadiness === preset
                          ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100'
                          : 'btn-ghost border-neutral-700'
                      }`}
                      onClick={() => setReadiness(selectedReadiness === preset ? null : preset)}
                    >
                      <Icon name={READINESS_ICON[preset]} size={12} className="opacity-70" />
                      {t(READINESS_LABEL[preset])}
                    </button>
                  ))}
                </div>
                </>}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
                  <div className="relative" ref={tagFilterRef}>
                    <button
                      type="button"
                      className={`library-filter-button zotero-tag-filter tone-indigo btn border gap-1.5 ${selectedZoteroTags.length ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
                      onClick={() => setTagFilterOpen((open) => !open)}
                      aria-expanded={tagFilterOpen}
                      aria-haspopup="dialog"
                    >
                      <Icon name="tag" /> {t('Etiquetas Zotero')}
                      {selectedZoteroTags.length > 0 && (
                        <span className="library-filter-count zotero-tag-filter-count tone-indigo rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                          {selectedZoteroTags.length}
                        </span>
                      )}
                    </button>
                    {tagFilterOpen && (
                      <div
                        role="dialog"
                        aria-label={t('Filtrar por etiquetas de Zotero')}
                        className="library-filter-popover absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            className="input min-w-0 flex-1"
                            value={tagSearch}
                            onChange={(e) => setTagSearch(e.target.value)}
                            placeholder={t('Buscar etiqueta…')}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={selectedZoteroTags.length === 0}
                            onClick={clearZoteroTags}
                          >
                            {t('Limpiar')}
                          </button>
                        </div>
                        {selectedZoteroTags.length > 1 && (
                          <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
                            {t('Combinar etiquetas')}
                            <select
                              className="input py-1 text-xs"
                              value={filter.zoteroTagMode ?? 'any'}
                              onChange={(e) => updateFilter((current) => ({ ...current, zoteroTagMode: e.target.value as 'any' | 'all' }))}
                            >
                              <option value="any">{t('Cualquiera')}</option>
                              <option value="all">{t('Todas')}</option>
                            </select>
                          </label>
                        )}
                        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                          {visibleZoteroTags.map((tag) => {
                            const checked = selectedZoteroTags.some((selected) => selected.toLocaleLowerCase() === tag.label.toLocaleLowerCase());
                            return (
                              <button
                                key={tag.label}
                                type="button"
                                className={`zotero-tag-option flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                                  checked ? 'is-selected bg-indigo-950/50 text-indigo-100' : 'text-neutral-300'
                                }`}
                                onClick={() => toggleZoteroTag(tag.label)}
                              >
                                <span
                                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                                    checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-neutral-600'
                                  }`}
                                >
                                  {checked && <Icon name="check" size={12} />}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                                <span className="text-xs tabular-nums text-neutral-500">{tag.workCount}</span>
                              </button>
                            );
                          })}
                          {availableZoteroTags.length === 0 && (
                            <p className="px-2 py-3 text-xs leading-relaxed text-neutral-500">
                              {t('Aún no hay etiquetas guardadas. Pulsa “Actualizar” para leer las etiquetas de las colecciones monitorizadas en Zotero.')}
                            </p>
                          )}
                          {availableZoteroTags.length > 0 && visibleZoteroTags.length === 0 && (
                            <p className="px-2 py-3 text-xs text-neutral-500">{t('No hay etiquetas que coincidan.')}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative" ref={collectionFilterRef}>
                    <button
                      type="button"
                      className={`library-filter-button collection-filter tone-cyan btn border gap-1.5 ${selectedCollections.length ? 'is-active border-cyan-700 bg-cyan-950/40 text-cyan-100' : 'btn-ghost border-neutral-700'}`}
                      onClick={() => setCollectionFilterOpen((open) => !open)}
                      aria-expanded={collectionFilterOpen}
                      aria-haspopup="dialog"
                      disabled={availableCollections.length === 0}
                      title={availableCollections.length === 0 ? t('Sincroniza para poder filtrar por colección.') : t('Filtrar por colección')}
                    >
                      <Icon name="folder" /> {t('Colección')}
                      {selectedCollections.length > 0 && (
                        <span className="library-filter-count tone-cyan rounded bg-cyan-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                          {selectedCollections.length}
                        </span>
                      )}
                    </button>
                    {collectionFilterOpen && (
                      <div
                        role="dialog"
                        aria-label={t('Filtrar por colección')}
                        className="library-filter-popover absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            className="input min-w-0 flex-1"
                            value={collectionSearch}
                            onChange={(e) => setCollectionSearch(e.target.value)}
                            placeholder={t('Buscar colección…')}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={selectedCollections.length === 0}
                            onClick={clearCollections}
                          >
                            {t('Limpiar')}
                          </button>
                        </div>
                        {selectedCollections.length > 1 && (
                          <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
                            {t('Combinar colecciones')}
                            <select
                              className="input py-1 text-xs"
                              value={filter.collectionMode ?? 'any'}
                              onChange={(e) => updateFilter((current) => ({ ...current, collectionMode: e.target.value as 'any' | 'all' }))}
                            >
                              <option value="any">{t('Cualquiera')}</option>
                              <option value="all">{t('Todas')}</option>
                            </select>
                          </label>
                        )}
                        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                          {visibleCollections.map((collection) => {
                            const checked = selectedCollections.includes(collection.key);
                            return (
                              <button
                                key={collection.key}
                                type="button"
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                                  checked ? 'bg-cyan-950/50 text-cyan-100' : 'text-neutral-300'
                                }`}
                                style={{ paddingLeft: `${0.5 + collection.depth * 0.85}rem` }}
                                onClick={() => toggleCollection(collection.key)}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    checked ? 'border-cyan-400 bg-cyan-500 text-white' : 'border-neutral-600'
                                  }`}
                                >
                                  {checked && <Icon name="check" size={12} />}
                                </span>
                                {/* The vault's collections are Zotero's: the folder carries its Z. */}
                                <CollectionSourceIcon origin="zotero" size={16} />
                                <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                                <span className="text-xs tabular-nums text-neutral-500">{collection.workCount}</span>
                              </button>
                            );
                          })}
                          {availableCollections.length === 0 && (
                            <p className="px-2 py-3 text-xs leading-relaxed text-neutral-500">
                              {t('Aún no hay colecciones. Pulsa “Sincronizar” para leer la estructura de colecciones de Zotero.')}
                            </p>
                          )}
                          {availableCollections.length > 0 && visibleCollections.length === 0 && (
                            <p className="px-2 py-3 text-xs text-neutral-500">{t('No hay colecciones que coincidan.')}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1" />
                  {hasActiveFilters && <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={clearAllFilters}>{t('Limpiar filtros')}</button>}
                </div>
              </div>
            )}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-ghost shrink-0 border border-neutral-700 px-2"
              onClick={clearAllFilters}
              aria-label={t('Limpiar filtros')}
              title={t('Limpiar filtros')}
            >
              <Icon name="x" />
            </button>
          )}
        </div>
        {selectedZoteroTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Etiquetas:')}</span>
            {selectedZoteroTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="library-active-chip tone-indigo zotero-tag-chip inline-flex items-center gap-1 rounded-md border border-indigo-800/70 bg-indigo-950/30 px-2 py-1 text-indigo-200 hover:bg-indigo-950/60"
                onClick={() => toggleZoteroTag(tag)}
                title={`${t('Quitar')} ${tag}`}
              >
                {tag} <Icon name="x" size={12} />
              </button>
            ))}
            {selectedZoteroTags.length > 1 && (
              <span className="ml-1">
                {filter.zoteroTagMode === 'all' ? t('deben estar todas') : t('basta cualquiera')}
              </span>
            )}
          </div>
        )}
        {selectedCollections.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Colecciones:')}</span>
            {selectedCollections.map((key) => (
              <button
                key={key}
                type="button"
                className="library-active-chip tone-cyan inline-flex items-center gap-1 rounded-md border border-cyan-800/70 bg-cyan-950/30 px-2 py-1 text-cyan-200 hover:bg-cyan-950/60"
                onClick={() => toggleCollection(key)}
                title={`${t('Quitar')} ${collectionNameByKey.get(key) ?? key}`}
              >
                {collectionNameByKey.get(key) ?? key} <Icon name="x" size={12} />
              </button>
            ))}
            {selectedCollections.length > 1 && (
              <span className="ml-1">
                {filter.collectionMode === 'all' ? t('deben estar todas') : t('basta cualquiera')}
              </span>
            )}
          </div>
        )}
        {selectedHealthBucket && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Salud del corpus:')}</span>
            <button
              type="button"
              className="library-active-chip tone-amber inline-flex items-center gap-1 rounded-md border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-200 hover:bg-amber-950/60"
              onClick={clearHealthBucket}
              title={`${t('Quitar')} ${healthBucketLabel(selectedHealthBucket)}`}
            >
              {healthBucketLabel(selectedHealthBucket)} <Icon name="x" size={12} />
            </button>
          </div>
        )}
        {selectedStatusFlags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>{t('Estado:')}</span>
            {selectedStatusFlags.map((flag) => {
              const neg = isNegated(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  className={`library-active-chip ${neg ? 'tone-red' : 'tone-indigo'} inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:opacity-80 ${
                    neg
                      ? 'border-red-800/70 bg-red-950/30 text-red-200'
                      : 'border-indigo-800/70 bg-indigo-950/30 text-indigo-200'
                  }`}
                  onClick={() => toggleStatusFlag(flag)}
                  title={`${t('Quitar')} ${t(labelFor(flag))}`}
                >
                  {t(labelFor(flag))} <Icon name="x" size={12} />
                </button>
              );
            })}
            <span className="ml-1">{t('deben cumplir todas')}</span>
          </div>
        )}
      </div>

      {!simple && !loading && works.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>{tx('{n} resultados con los filtros actuales', { n: totalWorks })}</span>
          <button
            className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
            onClick={() => {
              if (allVisibleSelected) setSelected(new Set());
              else selectAllVisible();
            }}
          >
            <Icon name={allVisibleSelected ? 'x' : 'check'} size={13} />
            {allVisibleSelected ? t('Quitar selección') : tx('Seleccionar los {n} de esta página', { n: works.length })}
          </button>
          {/* One verb whose scope is the selection when there is one, the filtered
              library otherwise. */}
          <button
            className="btn btn-primary px-2 py-1 text-xs"
            disabled={academicMode === 'manual'}
            data-testid="library-extract-ideas"
            data-scope={selectedVisibleIds.length > 0 ? 'selection' : 'library'}
            onClick={() => void (selectedVisibleIds.length > 0 ? processFullSelected() : processFullLibrary())}
            title={selectedVisibleIds.length > 0
              ? t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones.')
              : t('Encadena temas, ideas, resumen, indexado (ideas y pasajes) y descubrimiento de relaciones para toda la biblioteca filtrada.')}
          >
            <Icon name="compass" size={13} /> {t(academicMode === 'manual' ? 'Modo Manual' : vaultType === 'academic' ? 'Extraer ideas' : 'Procesar biblioteca')}
            {selectedVisibleIds.length > 0 && <span className="tabular-nums opacity-80">· {selectedVisibleIds.length}</span>}
          </button>
          {selectedVisibleIds.length > 0 && <>
            {/* Offered only while some selected work has something left to finish. */}
            {academicMode !== 'manual' && retryPlan.works > 0 && (
              <button
                className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                onClick={() => void retryMissingSelected()}
                title={t('Encola solo los pasos incompletos, pendientes o fallidos de cada obra seleccionada. No vuelve a analizar lo que ya está hecho.')}
                data-testid="library-retry-missing-selected"
              >
                <Icon name="refresh" size={13} /> {t('Reintentar')}
              </button>
            )}
            {isRecordsVault && (
              <button
                className="btn btn-ghost border border-amber-700/70 px-2 py-1 text-xs text-amber-300"
                onClick={() => void scanSelectedRecords()}
                title={t('Extraer personas, lugares y eventos de estas obras hacia el árbol')}
              >
                <Icon name="users" size={13} /> {t('Extraer personas y eventos')}
              </button>
            )}
            <button
              className="btn bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500"
              onClick={() => void deleteSelected()}
              title={t('Elimina estas obras del vault actual con sus ideas, pasajes, embeddings y demás datos derivados. Lo que otras obras comparten no se toca.')}
              data-testid="library-delete-selected"
            >
              <Icon name="trash" size={13} /> {t('Eliminar')}
            </button>
            <button
              className="btn btn-ghost px-2 py-1 text-xs"
              data-testid="library-clear-selection"
              onClick={() => { setSelected(new Set()); }}
            >
              {t('Limpiar selección')}
            </button>
          </>}
        </div>
      )}

      {isRecordsVault && (
        <div className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/10 px-3 py-2 text-xs text-neutral-400">
          {t('En este modo la Biblioteca guarda fuentes secundarias o publicadas (libros, genealogías impresas, historias locales, colecciones de registros transcritas) importadas desde Zotero. Puedes extraer de ellas personas y eventos hacia el árbol con «Extraer personas y eventos». Los documentos originales (partidas, censos, cartas, fotos) van en el Archivo.')}
          {onOpenArchive && (
            <button className="ml-1 text-amber-400 hover:underline" onClick={onOpenArchive}>
              {t('Ir al Archivo')}
            </button>
          )}
        </div>
      )}


      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden text-sm">
        <div
          className="grid items-center bg-neutral-900 text-neutral-400 border-b border-neutral-800 px-2 py-2 text-left text-xs"
          style={{ gridTemplateColumns: simple ? '32px minmax(160px, 2fr) minmax(100px, 1fr) 60px minmax(100px, 1fr) 110px' : LIBRARY_GRID_TEMPLATE }}
        >
          <div className="font-medium">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                title={tx('Seleccionar los {n} resultados filtrados', { n: works.length })}
                aria-label={tx('Seleccionar los {n} resultados filtrados', { n: works.length })}
                onChange={(e) => {
                  if (e.target.checked) selectAllVisible();
                  else setSelected(new Set());
                }}
              />
          </div>
          <SortHeader label={t('Título')} sortKey="title" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Autores')} sortKey="authors" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Año')} sortKey="year" sort={sort} onSort={cycleSort} />
          {!simple && <><SortHeader label={t('Tema(s)')} sortKey="themes" sort={sort} onSort={cycleSort} />
          <SortHeader label={t('Ideas')} sortKey="ideas" sort={sort} onSort={cycleSort} /></>}
          <div className="font-medium">{t('Estado')}</div>
          <div className="font-medium" data-tour="library-actions">{t('Acciones')}</div>
        </div>
        {loading ? (
          <div className="p-4 text-neutral-500">{t('Cargando...')}</div>
        ) : (
          <VirtualList
            items={sortedWorks}
            itemHeight={LIBRARY_ROW_HEIGHT}
            getKey={(w) => w.nodus_id}
            anchorKey={restoreAnchorId}
            onAnchorChange={(key) => {
              placementRef.current = key === null ? null : { anchorId: String(key), pageOffset };
              reportSnapshot.current?.(snapshotOf.current());
            }}
            className="flex-1 min-h-0"
            empty={<div className="p-4 text-neutral-500">{t('No hay obras con los filtros actuales.')}</div>}
            renderItem={(w) => {
              const status = statusByWork.get(w.nodus_id);
              return (
              <div
                data-testid={`vault-library-item-${w.nodus_id}`}
                className="grid h-full cursor-pointer items-center border-b border-neutral-800/70 px-2 hover:bg-neutral-900/50"
                style={{ gridTemplateColumns: simple ? '32px minmax(160px, 2fr) minmax(100px, 1fr) 60px minmax(100px, 1fr) 110px' : LIBRARY_GRID_TEMPLATE }}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button, input, select, a')) return;
                  if (simple) openReader(w); else openVaultWorkAnalysis(w);
                }}
              >
                <div className="p-1">
                  <input
                    type="checkbox"
                    checked={selected.has(w.nodus_id)}
                    onChange={(e) => toggleSelected(w.nodus_id, e.target.checked)}
                  />
                </div>
                <div className="min-w-0 p-1">
                  <button
                    data-testid={`vault-library-title-${w.nodus_id}`}
                    className="block w-full truncate text-left hover:text-indigo-300 hover:underline"
                    title={t(simple ? 'Leer documento' : 'Ver las ideas de esta obra')}
                    onClick={() => simple ? openReader(w) : openVaultWorkAnalysis(w)}
                  >
                    {w.title}
                  </button>
                </div>
                <div className="p-1 min-w-0 truncate text-neutral-400">
                  {w.authors[0] ?? '—'}
                  {w.authors.length > 1 ? ' et al.' : ''}
                </div>
                <div className="p-1 text-neutral-400">{w.year ?? '—'}</div>
                {!simple && <><div className="p-1 text-neutral-400 truncate">{w.themes.join(', ')}</div>
                <div className="p-1">
                  {w.ideaCount > 0 ? (
                    <button
                      className="tabular-nums text-neutral-300 hover:text-indigo-300 hover:underline"
                      title={tx('Ver las {n} ideas de esta obra', { n: w.ideaCount })}
                      onClick={() => setIdeasWork({ nodus_id: w.nodus_id, title: w.title })}
                    >
                      {w.ideaCount}
                    </button>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </div>
                </>}
                <div className="min-w-0 p-1">
                  {simple ? (() => { const index = libraryIndexAction(preparationByWork.get(w.nodus_id)); return <button className={`text-xs ${index.tone === 'green' ? 'text-green-500' : index.tone === 'red' ? 'text-red-500' : 'text-amber-500'}`} disabled={index.busy} onClick={() => index.tone === 'green' ? openReader(w) : void indexWorks([w.nodus_id])}>{t(index.tone === 'green' ? 'Listo' : index.label)}</button>; })() : academicMode === 'manual' ? <span className="text-xs text-neutral-500">{t('Modo Manual')}</span> : status && <StatusPill status={status} work={w} onClick={() => setStatusWork(w)} />}
                  {!compact && academicMode !== 'manual' && vaultType === 'academic' && <button
                    className={`mt-1 block max-w-full truncate text-[10px] ${documentStatuses.get(w.nodus_id) === 'current' ? 'text-cyan-400' : documentStatuses.get(w.nodus_id) === 'failed' ? 'text-red-400' : 'text-neutral-600'}`}
                    onClick={() => setDocumentWork(w)}
                    title={t('Abrir la ficha documental completa')}
                  >
                    {documentStatuses.get(w.nodus_id) === 'current'
                      ? t('Documento comprendido')
                      : documentStatuses.get(w.nodus_id) === 'unavailable'
                        ? t('Sin texto completo')
                        : documentStatuses.get(w.nodus_id) === 'failed'
                          ? t('Ficha documental fallida')
                        : documentStatuses.get(w.nodus_id) && !['missing', 'failed', 'stale'].includes(documentStatuses.get(w.nodus_id)!)
                          ? t('Comprendiendo…')
                          : t('Sin ficha documental')}
                  </button>}
                </div>
                <div className="p-1 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {!simple && academicMode !== 'manual' && <RowIconButton
                      title={t(vaultType === 'academic' ? 'Extraer ideas' : 'Analizar')}
                      icon="bulb"
                      tone="violet"
                      onClick={() => processFullWork(w)}
                    />}
                    {vaultType === 'academic' && (() => {
                      // The colour is this document's index state; the label is what a click does.
                      const index = libraryIndexAction(preparationByWork.get(w.nodus_id));
                      return <RowIconButton title={t(index.label)} icon="layers" tone={index.tone} spinning={index.busy}
                        testId={`vault-library-index-${w.nodus_id}`} onClick={() => void indexWorks([w.nodus_id])} />;
                    })()}
                    <RowIconButton
                      title={t('Abrir lector limpio')}
                      icon="book"
                      tone="cyan"
                      onClick={() => openReader(w)}
                    />
                    {/* The column is nullable in SQLite despite the non-null type, and demo
                        vaults carry synthetic keys that open nothing. */}
                    {w.zotero_key && (
                      <RowIconButton
                        title={t('Abrir en Zotero')}
                        icon="external"
                        tone="indigo"
                        onClick={() => window.nodus.openInZotero(w.zotero_key)}
                      />
                    )}
                    <RowMenu
                      label={t('Más acciones')}
                      items={[
                        ...(vaultType === 'academic' ? [
                          { label: t('Indexar documento'), icon: 'layers', onClick: () => void indexWorks([w.nodus_id]) },
                          { label: t('Ver en Queue'), icon: 'list', onClick: openResearchPreparationQueue },
                        ] : []),
                        {
                          label: t('Abrir lector limpio'),
                          icon: 'book',
                          onClick: () => openReader(w),
                        },
                        ...(isRecordsVault
                          ? [{
                              label: t('Extraer personas y eventos'),
                              icon: 'users',
                              onClick: () => void scanRecords(w),
                            }]
                          : []),
                        { label: t('Analizar solo temas'), icon: 'tag', onClick: () => void analyzeThemes(w) },
                        {
                          label: w.deep_status === 'done' ? t('Reanalizar solo ideas') : t('Analizar solo ideas'),
                          icon: 'bulb',
                          onClick: () => void analyzeIdeas(w),
                        },
                        {
                          label: w.summary_status === 'done' ? t('Regenerar resumen') : t('Generar resumen'),
                          icon: 'wand',
                          onClick: () => void summarizeWork(w),
                        },
                        {
                          label: t('Ficha documental'),
                          icon: 'layers',
                          onClick: () => setDocumentWork(w),
                        },
                        {
                          label: t('Grafo de ideas de la obra'),
                          icon: 'network',
                          disabled: academicMode !== 'manual' && w.deep_status !== 'done',
                          onClick: () => setGraphWork({ nodus_id: w.nodus_id, title: w.title }),
                        },
                        {
                          label: t('Ver esta obra en el grafo'),
                          icon: 'map',
                          onClick: () =>
                            onOpenGraph({
                              preset: 'reading',
                              workId: w.nodus_id,
                              workTitle: w.title,
                              zoteroKey: w.zotero_key,
                              label: `${t('Lectura:')} ${w.title}`,
                            }),
                        },
                        {
                          label: t('Preguntar al asistente'),
                          icon: 'chat',
                          onClick: () =>
                            onOpenAssistant({
                              title: `${t('Lectura:')} ${w.title}`,
                              selection: ASSISTANT_CONTEXTS.reading,
                              prompt:
                                `${t('Analiza esta lectura dentro del corpus: ideas extraídas, temas, huecos, contradicciones y próximas lecturas relacionadas.')}\n\n` +
                                `${w.title}\n${w.authors.join(', ')}${w.year ? ` (${w.year})` : ''}`,
                            }),
                        },
                      ].filter(item => academicMode !== 'manual' || ['book', 'search', 'network', 'map', 'chat'].includes(item.icon))}
                    />
                  </div>
                </div>
              </div>
              );
            }}
          />
        )}
        {!loading && totalWorks > LIBRARY_PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-2 text-xs text-neutral-500">
            <span>
              {pageOffset + 1}–{Math.min(pageOffset + works.length, totalWorks)} / {totalWorks}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                disabled={pageOffset === 0}
                onClick={() => setPageOffset((offset) => Math.max(0, offset - LIBRARY_PAGE_SIZE))}
              >
                <Icon name="arrowLeft" size={13} /> {t('Anterior')}
              </button>
              <button
                className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs"
                disabled={pageOffset + works.length >= totalWorks}
                onClick={() => setPageOffset((offset) => offset + LIBRARY_PAGE_SIZE)}
              >
                {t('Siguiente')} <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
      {graphWork && <WorkGraphModal work={graphWork} onClose={() => setGraphWork(null)} />}
      {ideasWork && (
        <WorkIdeasModal
          work={ideasWork}
          manual={academicMode === 'manual'}
          onClose={() => setIdeasWork(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(w) => {
            setIdeasWork(null);
            setGraphWork(w);
          }}
        />
      )}
      {academicMode !== 'manual' && statusWork && (() => {
        // Keep an open modal attached to the freshly loaded row. Holding the
        // original object made successful retries look ineffective until close/reopen.
        const currentWork = works.find((work) => work.nodus_id === statusWork.nodus_id) ?? statusWork;
        const currentStatus = statusByWork.get(currentWork.nodus_id);
        return currentStatus ? (
        <WorkStatusModal
          work={currentWork}
          status={currentStatus}
          documentStatus={documentStatuses.get(currentWork.nodus_id) ?? 'missing'}
          onClose={() => setStatusWork(null)}
          onChanged={() => load()}
          onOpenDocument={() => {
            setStatusWork(null);
            setDocumentWork(currentWork);
          }}
        />
        ) : null;
      })()}
      {documentWork && <DocumentProfileModal work={documentWork} vaultId={vaultId} onClose={() => setDocumentWork(null)} />}
      {documentManagerOpen && <DocumentIndexManager vaultId={vaultId} onClose={() => setDocumentManagerOpen(false)} />}
    </div>
  );
}

function RowIconButton({
  title,
  icon,
  tone = 'neutral',
  disabled = false,
  spinning = false,
  testId,
  onClick,
}: {
  title: string;
  icon: string;
  tone?: 'neutral' | 'indigo' | 'cyan' | 'violet' | 'amber' | 'green' | 'orange' | 'red';
  disabled?: boolean;
  spinning?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'indigo'
      ? 'text-indigo-400 hover:text-indigo-300'
      : tone === 'cyan'
        ? 'text-cyan-400 hover:text-cyan-300'
        : tone === 'violet'
          ? 'text-violet-400 hover:text-violet-300'
          : tone === 'amber'
            ? 'text-amber-400 hover:text-amber-300'
            : tone === 'green'
              ? 'text-emerald-400 hover:text-emerald-300'
              : tone === 'orange'
                ? 'text-orange-400 hover:text-orange-300'
                : tone === 'red'
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-neutral-400 hover:text-neutral-100';
  return (
    <button
      className={`library-row-action ${tone === 'neutral' ? 'library-row-action-neutral' : ''} inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${toneClass}`}
      title={title}
      aria-label={title}
      data-testid={testId}
      data-tone={tone}
      disabled={disabled}
      onClick={onClick}
    >
      {/* Spin a wrapper, never the icon itself: Tailwind's transform utilities clash with a spin on one element. */}
      {spinning ? <span className="library-row-action-spin inline-flex"><Icon name={icon} size={13} /></span> : <Icon name={icon} size={13} />}
    </button>
  );
}
