import { readWorkspacePreferences, writeWorkspacePreferences } from './workspacePreferences';
// What a section remembers when you leave it and come back.
//
// Changing `view` swaps the whole element at App.tsx's single render point, so React
// unmounts the previous section and every `useState` inside it dies. That is on
// purpose — the alternative, keeping sections mounted and hidden, would leave the
// heavy lists resident and their effects and timers alive. What it costs is the
// user's place: the filters, the ordering and the open tab all reset to their
// defaults, and returning to a section means rebuilding the cut of the corpus by
// hand.
//
// So the sections stay disposable and their *shape* is kept out here instead, above
// the render point, in a store that outlives them. This is the generalisation of
// what `toolkitPage` already does in App.tsx for the Toolkit's inner page.
//
// Three rules define what belongs in a snapshot:
//
//   1. A handful of values per view, not the whole state. What hurts to lose is the
//      cut: filters, ordering, the active tab. GlobalLibraryView alone holds 91
//      `useState` calls; 90 of them should die with the view.
//   2. Nothing ephemeral. Open modals, spinners, in-flight errors, unapplied input
//      drafts and export selections are gone on the way out, and should be.
//   3. Page and scroll are one value, never two. See `ListPlacement`.
//   4. Nothing that costs an action to restore. A snapshot puts the reader back
//      where they were; it does not re-run work on their behalf. This is why the
//      argument map's open tab is not kept: redrawing it means rebuilding it, and
//      in AI mode that would spend a model call for the act of entering a section.
//
// The store is deliberately NOT React state. It is read once when a view mounts and
// written on every filter change; as state it would re-render the whole shell on
// every keystroke in a search box, and this repo has paid for that before.
//
// All of this dies with the window, which is right for a place: on the next launch
// there is no "where was I". Three fields are not a place but a preference — the
// ordering, the read filter and grid-vs-list of the two galleries, set once and
// expected to hold — and those are written through to `filterPreferences` and read
// back as the seed a section mounts with. That file says why only those three.
import type { View } from '../navigation';
import type { StellarWorkspaceSnapshot } from '../stellarGraph/snapshot';
import {
  PREFERENCE_VIEWS,
  readFilterPreferences,
  writeFilterPreferences,
  type GalleryFilterPreferences,
  type PreferenceView,
} from './filterPreferences';
import type { LibraryCatalogItem, LibraryItemSource, LibraryItemType, LibraryScope } from '@shared/libraryTypes';
// Type-only, so the lazy view chunks are not pulled in: the unions stay declared
// once, where the selects that produce them live.
import type { SortKey as AuthorsSortKey, SynthFilter as AuthorsSynthFilter } from '../views/AuthorsView';
import type { SortKey as IdeasSortKey } from '../views/IdeasView';
import type { RouteSortKey as ArgumentRouteSortKey } from '../views/ArgumentMapView';
import type { ReadFilter as ReportReadFilter, SortKey as ReportSortKey } from '../views/DeepResearchView';
import type { ImmersionSortKey } from '../views/ImmersionView';
import type { WorkspaceItemKind } from '../views/WorkspaceView';
import type { DictionaryDetailTab } from '../views/DictionaryView';
import type { IdeaType, LibraryReaderReference, WorkFilter } from '@shared/types';
import type { DictionaryEntryStatus, DictionarySortKey } from '@shared/dictionary';
import type { SortState } from '../views/Library';
import type { ReadingPlace } from '../readingPlace';
import type { CompassSnapshot } from '@shared/compass';
import type { DatabaseDeepResearchReportType } from '@shared/databaseDeepResearch';

/** An open inner tab: enough to redraw the tab strip and refetch its contents. */
export interface OpenEntityTab {
  id: string;
  label: string;
}

/**
 * The reader's place inside a list — one value, never two.
 *
 * Page and scroll only mean something together. A restored page without its scroll
 * position puts the reader in front of row 201 with no context: neither where they
 * were nor a clean start, which is worse than restoring nothing. So both live in
 * this one field, and it is written and read as a unit.
 *
 * The place is an id, not a pixel offset. Row heights change with the window width
 * and with the content, and virtualised lists do not even have the rows measured
 * until they are near the viewport, so a stored `scrollTop` points somewhere else on
 * the next visit. An id still means the same row.
 *
 * `pageOffset` is a hint, not the answer: it says which page the row was on so the
 * anchor can be found in one request instead of walking every page from the start.
 * If the anchor is not on that page — the corpus changed, the row was deleted — the
 * list falls back to the first page and the top. It never keeps half a placement.
 */
export interface ListPlacement {
  /** The row that was at the top of the viewport. */
  anchorId: string;
  /**
   * Which page it was on, so the anchor is reachable in one request. Absent for the
   * lists that page inside the renderer, where "load until this id appears" is the
   * whole of it and there is no page to hint at.
   */
  pageOffset?: number;
}

export interface AuthorsSnapshot {
  /** 'author' is only reachable with an id present in `openAuthors`. */
  surface: 'catalog' | 'author' | 'matrix';
  openAuthors: OpenEntityTab[];
  activeAuthorId: string | null;
  matrixOpen: boolean;
  query: string;
  sortBy: AuthorsSortKey;
  synthFilter: AuthorsSynthFilter;
  savedOnly: boolean;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

export interface IdeasSnapshot {
  surface: 'catalog' | 'idea';
  openIdeas: OpenEntityTab[];
  activeIdeaId: string | null;
  search: string;
  typeFilter: IdeaType | '';
  sortKey: IdeasSortKey;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

/**
 * Dictionary: its catalogue cut, all open concepts and the selected inner tab for
 * each concept. Generation progress is deliberately absent because the main
 * process owns it and the renderer rehydrates that live state on every mount.
 */
export interface DictionarySnapshot {
  openEntries: OpenEntityTab[];
  activeEntryId: string | null;
  detailTabs: Record<string, DictionaryDetailTab>;
  query: string;
  letter: string;
  status: DictionaryEntryStatus | '';
  tag: string;
  authorId: string;
  workId: string;
  newOnly: boolean;
  insufficientOnly: boolean;
  sortKey: DictionarySortKey;
  sortDir: 'asc' | 'desc';
  viewMode: 'list' | 'table';
}

/**
 * Notes, folders and their open editors. The tree's expanded folders are part of the
 * cut: collapsing back to the root loses the reader's route to what they were
 * reading just as surely as dropping the filter does.
 */
export interface WorkspaceSnapshot {
  pinnedActionIds?: string[];
  layout?: 'editorial' | 'navigator';
  catalogView?: 'list' | 'cards';
  contextOpen?: boolean;
  focusMode?: boolean;
  scope: WorkspaceScope;
  expanded: string[];
  search: string;
  kindFilter: WorkspaceItemKind | '';
  selectedTags: string[];
  openIds: string[];
  activeId: string | null;
  placement: ListPlacement | null;
}

/** Mirrors WorkspaceView's `Scope`: the collection or pseudo-collection on show. */
export type WorkspaceScope =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'trash' }
  | { kind: 'collection'; id: string };

/**
 * The route catalogue only. The open map tab is deliberately absent: it holds no
 * data of its own, so redrawing it means rebuilding it, and in AI mode that would
 * spend a model call on the act of walking back into the section. Reopening a map
 * stays a thing the reader asks for.
 */
export interface ArgumentSnapshot {
  mode: 'auto' | 'ai';
  seedId: string;
  suggestionSearch: string;
  minConnections: number;
  routeSort: ArgumentRouteSortKey;
  placement: ListPlacement | null;
}

/**
 * The seven facets as one unit, because that is how a reader thinks of them: the
 * cut is kept or it is dropped, never half of it.
 */
export interface LibraryFacetsSnapshot {
  /** Each facet holds any number of values; an empty list is no cut. */
  sources: LibraryItemSource[];
  extractions: LibraryCatalogItem['extractionStatus'][];
  itemTypes: LibraryItemType[];
  yearFrom: string;
  yearTo: string;
  tags: string[];
  vaults: string[];
  attachments: Array<'with' | 'without'>;
}

/**
 * Sorting and visible columns are absent on purpose: the global catalogue already
 * persists those to disk through `setGlobalLibraryViewPreferences`. Only what
 * nothing else keeps belongs here.
 */
export interface LibraryGlobalSnapshot {
  search: string;
  selectedCollection: string | null;
  selectedSavedSearch: string | null;
  filters: LibraryFacetsSnapshot;
  filtersOpen: boolean;
  placement: ListPlacement | null;
}

/** The vault-scoped library states its whole cut as one `WorkFilter`. */
export interface LibraryVaultSnapshot {
  filter: WorkFilter;
  sort: SortState | null;
  filtersOpen: boolean;
  advancedFiltersOpen: boolean;
  placement: ListPlacement | null;
}

/**
 * One document left open in the reader strip. The reference is what the tab was
 * opened with, so reopening it is the same read as opening it the first time; the
 * page the reader had reached inside it is not here, because the reader already
 * writes that to disk per document and restores it whenever it mounts.
 */
export interface LibraryReaderTabSnapshot {
  key: string;
  scope: LibraryScope;
  reference: LibraryReaderReference;
  /** Which rendering was on show: the clean text, or one of the attachments. */
  sourceId?: string;
}

/** The reader tabs and which one was in front. Null means the catalogue was. */
export interface LibraryReadersSnapshot {
  tabs: LibraryReaderTabSnapshot[];
  activeKey: string | null;
}

/**
 * One section, two engines: the Biblioteca entry renders the vault library or the
 * global catalogue depending on the scope switch, and each keeps its own cut so
 * that flipping the switch does not blend two unrelated sets of filters. The scope
 * itself is not here — it already lives in settings.
 *
 * The open readings sit beside both, not inside either, because that is where they
 * sit on screen: the tab strip spans the section and a document opened from the vault
 * library stays open across a switch to the global catalogue.
 */
export interface LibrarySnapshot {
  vault?: LibraryVaultSnapshot;
  global?: LibraryGlobalSnapshot;
  readers?: LibraryReadersSnapshot;
}

/**
 * Deep Research: the gallery's cut, the report left open, and the place inside it.
 *
 * Reopening a report is a read of something already written, so it costs nothing to
 * restore. What is deliberately absent is the composer: an objective half typed into
 * the new-report form is a draft, not a place, and restoring the form would also mean
 * deciding whether the model, the length and the outline in it are still the ones the
 * reader meant.
 */
export interface DeepResearchSnapshot {
  openIds?: string[];
  readingById?: Record<string, ReadingPlace | null>;
  surface: 'gallery' | 'reader';
  /** id and title of the open report; the report itself is re-read from the gallery. */
  openReport: OpenEntityTab | null;
  search: string;
  readFilter: ReportReadFilter;
  sortKey: ReportSortKey;
  viewMode: 'grid' | 'list';
  /** The place in the gallery. */
  placement: ListPlacement | null;
  /** The place inside the open report. */
  reading: ReadingPlace | null;
}

/** Database Deep Research keeps the selected table set and open result, not the
 * composer (an objective is a draft and should never reappear unexpectedly). */
export interface DatabaseDeepResearchSnapshot {
  selectedDatabaseIds: string[];
  selectedViewIds: string[];
  openReportId: string | null;
  search?: string;
  readFilter?: 'all' | 'read' | 'unread';
  /** Report types ticked in the gallery's type filter; empty lets every type through. */
  reportFilter?: DatabaseDeepResearchReportType[];
  sortKey?: 'recent' | 'oldest' | 'title';
  viewMode?: 'grid' | 'list';
  reading?: ReadingPlace | null;
}

/**
 * Inmersión: the gallery's cut and the session left open.
 *
 * The session's own progress — which step the player was on, the answers given — is
 * already stored with the session, so reopening it lands exactly where it was left.
 * The scope screen is not kept: it is the result of a pass over the corpus, and
 * redrawing it means paying for that pass again just to walk back into the section.
 */
export interface ImmersionSnapshot {
  openIds?: string[];
  openSession: OpenEntityTab | null;
  search: string;
  sortKey: ImmersionSortKey;
  viewMode: 'grid' | 'list';
  placement: ListPlacement | null;
}

/** Search cut and reader placement for the universal academic discovery surface. */
export type { CompassSnapshot } from '@shared/compass';

/** One optional entry per section that has opted in. Keys are `View` members. */
export interface ViewSnapshots {
  graph?: StellarWorkspaceSnapshot;
  studyGraph?: StellarWorkspaceSnapshot;
  authors?: AuthorsSnapshot;
  ideas?: IdeasSnapshot;
  dictionary?: DictionarySnapshot;
  library?: LibrarySnapshot;
  workspace?: WorkspaceSnapshot;
  /**
   * The same view under the name the non-academic vaults give it. They are separate
   * sections of the app and only one of them exists at a time, so they keep separate
   * cuts rather than sharing one.
   */
  notes?: WorkspaceSnapshot;
  argument?: ArgumentSnapshot;
  immersion?: ImmersionSnapshot;
  /**
   * The same surface under the three names the app gives it: Deep Research in an
   * academic vault, Investigación de estudio in a study one, Diseño de unidades in a
   * teaching one. Separate entries for the same reason `workspace` and `notes` are
   * separate: they are different sections, and a key per section is what keeps the
   * store honest about which one a cut belongs to.
   */
  deepResearch?: DeepResearchSnapshot;
  studyDeepResearch?: DeepResearchSnapshot;
  teachingUnits?: DeepResearchSnapshot;
  dbDeepResearch?: DatabaseDeepResearchSnapshot;
  compass?: CompassSnapshot;
}

export type SnapshotView = keyof ViewSnapshots;

/** Adding a key that is not a section of the app stops this file compiling. */
type AssertKeysAreViews = SnapshotView extends View ? true : never;
const _keysAreViews: AssertKeysAreViews = true;
void _keysAreViews;

/**
 * Exactly one vault's snapshots exist at a time. Switching vault discards them
 * rather than indexing them: the whole app assumes a single active vault, and a
 * second surviving set would be a second answer to "where was I".
 */
let slot: { vaultId: string; values: ViewSnapshots } | null = null;

/**
 * Undefined for a different vault, and for no vault at all — same contract as
 * `getVaultQueryCache`. The vault check lives in the read, not in an effect, so a
 * view that mounts in the same commit as a vault change cannot see the old cut.
 *
 * The two galleries are the exception, and only for the three fields `filterPreferences`
 * keeps: with nothing in memory they are seeded from that vault's stored preferences,
 * so the ordering and the layout the reader chose survive a restart. The seed is still
 * closed to its own vault — it is read under the id being asked for, never carried over
 * from the one that was active a moment ago.
 */
export function readViewSnapshot<K extends SnapshotView>(
  vaultId: string | null | undefined,
  view: K,
): ViewSnapshots[K] | undefined {
  const live = !vaultId || slot?.vaultId !== vaultId ? undefined : slot?.values[view];
  if (live || !vaultId) return live;
  if (view === 'workspace' || view === 'notes') return { scope: { kind: 'all' }, expanded: [], search: '', kindFilter: '', selectedTags: [], openIds: [], activeId: null, placement: null, ...readWorkspacePreferences(vaultId) } as unknown as ViewSnapshots[K];
  if (!isPreferenceView(view)) return live;
  // Nothing in memory: either the first visit of the run, or the first after a
  // vault change. Both are exactly when the preferences kept on disk are the only
  // record of how the reader wants this gallery, so they become the seed.
  return gallerySeed(vaultId, view) as ViewSnapshots[K] | undefined;
}

function isPreferenceView(view: SnapshotView): view is PreferenceView {
  return (PREFERENCE_VIEWS as readonly SnapshotView[]).includes(view);
}

/**
 * A snapshot holding nothing but the stored preferences: no open report, no search,
 * no place. Every other field is its default, so the seed says only what the reader
 * actually chose and never claims a place they were never at.
 *
 * Undefined when nothing was ever stored, so that "never visited" stays
 * distinguishable from "visited and left on the defaults".
 */
function gallerySeed(vaultId: string, view: PreferenceView): DeepResearchSnapshot | ImmersionSnapshot | undefined {
  const stored = readFilterPreferences(vaultId, view);
  if (!stored.readFilter && !stored.sortKey && !stored.viewMode) return undefined;
  if (view === 'immersion') {
    return {
      openSession: null,
      search: '',
      sortKey: stored.sortKey ?? 'recent',
      viewMode: stored.viewMode ?? 'grid',
      placement: null,
    };
  }
  return {
    surface: 'gallery',
    openReport: null,
    search: '',
    readFilter: stored.readFilter ?? 'all',
    sortKey: stored.sortKey ?? 'recent',
    viewMode: stored.viewMode ?? 'grid',
    placement: null,
    reading: null,
  };
}

/**
 * Merges a partial update into the section's snapshot. Partial because a section's
 * state is not all in one component: in Autores the tab strip lives in AuthorsView
 * and the filters in its AuthorsCatalog child, and each reports only its own half.
 */
export function patchViewSnapshot<K extends SnapshotView>(
  vaultId: string | null | undefined,
  view: K,
  patch: Partial<NonNullable<ViewSnapshots[K]>>,
): void {
  if (!vaultId) return;
  if (slot?.vaultId !== vaultId) slot = { vaultId, values: {} };
  const current = slot.values[view];
  slot.values[view] = { ...(current ?? {}), ...patch } as ViewSnapshots[K];
  // The galleries' ordering, read filter and grid-vs-list are preferences rather
  // than places, so they go on through to disk. Everything else in the patch stops
  // here, and a patch mentioning none of the three costs nothing.
  if (view === 'workspace' || view === 'notes') writeWorkspacePreferences(vaultId, patch as Partial<WorkspaceSnapshot>);
  if (isPreferenceView(view)) writeFilterPreferences(vaultId, view, patch as GalleryFilterPreferences);
}

/** Drop everything. For vault deletion, imports and tests. */
export function clearViewSnapshots(): void {
  slot = null;
}

/** What the shell hands to the registry, with the active vault already bound in. */
export interface ViewSnapshotAccess {
  read<K extends SnapshotView>(view: K): ViewSnapshots[K] | undefined;
  patch<K extends SnapshotView>(view: K, patch: Partial<NonNullable<ViewSnapshots[K]>>): void;
}

/**
 * Binding the vault once, here, is why a view never receives it for this purpose:
 * a section cannot read another vault's snapshot by mistake because it never holds
 * the key to one.
 */
export function viewSnapshotAccess(vaultId: string | null | undefined): ViewSnapshotAccess {
  return {
    read: (view) => readViewSnapshot(vaultId, view),
    patch: (view, patch) => patchViewSnapshot(vaultId, view, patch),
  };
}
