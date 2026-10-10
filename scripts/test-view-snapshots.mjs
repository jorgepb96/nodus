// Leaving a section and coming back should land on the same cut of the corpus.
//
// Two halves are tested here. The store itself is exercised for real: it is a plain
// TypeScript module with no React in it, so esbuild can bundle it and the vault
// closure can be proved rather than described. The wiring — which sections opt in,
// what they restore and, above all, what they deliberately do NOT restore — is
// asserted against the sources, which is where those decisions are visible.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-view-snapshots-'));
const bundleOf = (source, name) => {
  const outfile = path.join(bundleDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, source),
      '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
      '--external:react',
      `--alias:@shared=${path.join(repoRoot, 'shared')}`,
      `--outfile=${outfile}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(outfile);
};
/**
 * The renderer's `localStorage`, which `node --test` does not have. Defined before
 * the store is bundled so the durable half of a cut can be exercised for real
 * instead of described, and counting its writes because a gallery patches its
 * snapshot on every keystroke in the search box.
 */
class FakeStorage {
  #values = new Map();
  writes = 0;
  get length() { return this.#values.size; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.writes += 1; this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
  clear() { this.#values.clear(); }
}
globalThis.localStorage = new FakeStorage();

const store = bundleOf('src/app/viewSnapshots.ts', 'viewSnapshots.cjs');
const editorialPreferences = bundleOf('src/app/workspacePreferences.ts', 'workspacePreferences.cjs');
// Bundled apart from the store on purpose: a second instance of the module shares
// no memory with the first, so anything the two agree on came through the disk.
const preferences = bundleOf('src/app/filterPreferences.ts', 'filterPreferences.cjs');
const { topAnchorId } = bundleOf('src/listPlacement.ts', 'listPlacement.cjs');
const { readingBlocks, topBlockIndex } = bundleOf('src/readingPlace.ts', 'readingPlace.cjs');
const { groupParenthesizedCitations } = bundleOf('src/markdownCitationGroups.ts', 'markdownCitationGroups.cjs');

test.after(async () => { await rm(bundleDir, { recursive: true, force: true }); });

test('editorial preferences survive a fresh snapshot and remain scoped to user and vault', () => {
  const scope = 'server:user-one:vault-editorial';
  store.patchViewSnapshot(scope, 'workspace', { layout: 'navigator', catalogView: 'cards', contextOpen: true, focusMode: true, pinnedActionIds: ['read', 'note'] });
  store.clearViewSnapshots();
  assert.deepEqual(editorialPreferences.readWorkspacePreferences(scope), { layout: 'navigator', catalogView: 'cards', contextOpen: true, focusMode: true, pinnedActionIds: ['read', 'note'] });
  assert.equal(store.readViewSnapshot(scope, 'workspace').catalogView, 'cards');
  for (const other of ['server:user-two:vault-editorial','server:user-one:other-vault']) {
    assert.deepEqual(editorialPreferences.readWorkspacePreferences(other), { layout: 'editorial', catalogView: 'list', contextOpen: false, focusMode: false, pinnedActionIds: [] });
  }
});

const AUTHORS_CUT = { query: 'ricoeur', sortBy: 'ideas', synthFilter: 'with', savedOnly: true, filtersOpen: true };

test('a section that was left with a cut finds it again on the way back', () => {
  store.clearViewSnapshots();
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'nothing is remembered before anything is left');

  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  assert.deepEqual(store.readViewSnapshot('vault-a', 'authors'), AUTHORS_CUT);
});

test('the two halves of a section merge instead of overwriting each other', () => {
  store.clearViewSnapshots();
  // In Autores the tab strip lives in AuthorsView and the filters in its catalogue
  // child. Each reports only what it owns, and neither may erase the other's half.
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  store.patchViewSnapshot('vault-a', 'authors', { surface: 'author', openAuthors: [{ id: 'A1', label: 'Ricoeur' }], activeAuthorId: 'A1', matrixOpen: false });

  assert.deepEqual(store.readViewSnapshot('vault-a', 'authors'), {
    ...AUTHORS_CUT,
    surface: 'author',
    openAuthors: [{ id: 'A1', label: 'Ricoeur' }],
    activeAuthorId: 'A1',
    matrixOpen: false,
  });
});

test('sections do not share a snapshot', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);
  store.patchViewSnapshot('vault-a', 'ideas', { search: 'mímesis', sortKey: 'connections' });

  assert.equal(store.readViewSnapshot('vault-a', 'authors').query, 'ricoeur');
  assert.equal(store.readViewSnapshot('vault-a', 'ideas').search, 'mímesis');
});

test('Dictionary keeps its open concepts and catalogue cut together', () => {
  store.clearViewSnapshots();
  const dictionaryCut = {
    openEntries: [{ id: 'D1', label: 'Hispanofilia' }],
    activeEntryId: 'D1',
    detailTabs: { D1: 'evidence' },
    query: 'propaganda',
    sortKey: 'authors',
    sortDir: 'desc',
    viewMode: 'table',
  };
  store.patchViewSnapshot('vault-a', 'dictionary', dictionaryCut);
  assert.deepEqual(store.readViewSnapshot('vault-a', 'dictionary'), dictionaryCut);
});

test('a snapshot is closed to the vault it was taken in', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot('vault-a', 'authors', AUTHORS_CUT);

  // The whole app assumes a single active vault. Another vault's cut is not merely
  // hidden, it is discarded: a second surviving set would be a second answer to
  // "where was I", and the check lives in the read so that a section mounting in the
  // same commit as a vault change cannot see the old one.
  assert.equal(store.readViewSnapshot('vault-b', 'authors'), undefined, 'another vault sees nothing');

  store.patchViewSnapshot('vault-b', 'ideas', { search: 'genealogía' });
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'switching vault discards the previous cut');
  assert.equal(store.readViewSnapshot('vault-b', 'ideas').search, 'genealogía');
});

test('with no vault there is nothing to read and nothing to write', () => {
  store.clearViewSnapshots();
  store.patchViewSnapshot(null, 'authors', AUTHORS_CUT);
  assert.equal(store.readViewSnapshot(null, 'authors'), undefined);
  assert.equal(store.readViewSnapshot('vault-a', 'authors'), undefined, 'a vault-less write is a no-op, not a write to whoever comes next');
});

test('the shell binds the vault once so a section cannot reach another one', () => {
  store.clearViewSnapshots();
  const access = store.viewSnapshotAccess('vault-a');
  access.patch('authors', AUTHORS_CUT);
  assert.deepEqual(access.read('authors'), AUTHORS_CUT);

  // A section never holds a vault id for this purpose, so it cannot get it wrong.
  const other = store.viewSnapshotAccess('vault-b');
  assert.equal(other.read('authors'), undefined);
});

// ── Phase two: the place inside the list ──────────────────────────────────────

/**
 * A scroller whose rows are 100px tall, stacked from its own top edge. Only the four
 * calls `topAnchorId` makes are needed, which is what lets the binary search be
 * tested for real instead of described.
 */
function fakeScroller({ rowCount, rowHeight = 100, scrollTop = 0, viewportTop = 0 }) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    getAttribute: () => `row-${index}`,
    getBoundingClientRect: () => ({
      top: viewportTop + index * rowHeight - scrollTop,
      bottom: viewportTop + (index + 1) * rowHeight - scrollTop,
    }),
  }));
  return {
    getBoundingClientRect: () => ({ top: viewportTop, bottom: viewportTop + 500 }),
    querySelectorAll: () => rows,
  };
}

test('the row reported as the anchor is the one crossing the top edge', () => {
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500 })), 'row-0', 'at rest the first row is the anchor');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 300 })), 'row-3', 'an exact boundary belongs to the row below it');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 350 })), 'row-3', 'a row half off the top is still the one being read');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 500, scrollTop: 49_900 })), 'row-499', 'the last row is reachable');
  // The scroller is not always at the top of the window.
  assert.equal(topAnchorId(fakeScroller({ rowCount: 20, scrollTop: 250, viewportTop: 180 })), 'row-2');
  assert.equal(topAnchorId(fakeScroller({ rowCount: 0 })), null, 'an empty list has no anchor');
});

test('a placement is a row id, never a pixel offset', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  assert.match(types, /anchorId: string/);
  assert.match(types, /pageOffset\?: number/, 'the page is a hint, absent where the renderer pages');
  // Row heights change with the window and with the content, and a virtualised list
  // has not even measured the rows it has not reached.
  for (const measurement of ['scrollTop', 'scrollOffset', 'scrollY', 'offsetTop']) {
    assert.doesNotMatch(types, new RegExp(`^\\s*${measurement}[?]?:`, 'm'), `${measurement} is not a place`);
  }
});

test('every paged section restores its page and its row together, or neither', async () => {
  const sections = {
    'src/views/AuthorsView.tsx': 'authors',
    'src/views/IdeasView.tsx': 'ideas',
    'src/views/Library.tsx': 'the vault library',
    'src/views/GlobalLibraryView.tsx': 'the global catalogue',
  };
  for (const [file, label] of Object.entries(sections)) {
    const source = await readSource(file);
    assert.match(source, /useState\(\(\) => snapshot\?\.placement\?\.pageOffset \?\? 0\)/, `${label} reopens on the stored page`);
    assert.match(source, /snapshot\?\.placement\?\.anchorId \?\? null/, `${label} reopens on the stored row`);
    // A page whose anchor is gone is the half-restored state this exists to avoid.
    assert.match(source, /setPageOffset\(0\)|setOffset\(0\)/, `${label} falls back to the first page`);
  }
});

test('a list that pages in the renderer loads until the anchor appears', async () => {
  const [hooks, argument] = await Promise.all([readSource('src/hooks.ts'), readSource('src/views/ArgumentMapView.tsx')]);
  assert.match(hooks, /ensureIndex\?: number/, 'the incremental list can be asked to open wide enough for a row');
  assert.match(hooks, /Math\.ceil\(\(ensureIndex! \+ 1\) \/ pageSize\) \* pageSize/, 'it opens whole pages up to that row');
  assert.match(hooks, /!ensured\.current && anchored && items\.length > 0/, 'the first real page does not collapse the pages opened for the anchor');
  assert.match(argument, /findIndex\(\(suggestion\) => suggestion\.ideaId === anchorId\)/);
  assert.match(argument, /ROUTES_PAGE_SIZE, undefined, anchorIndex/);
});

test('a virtualised list anchors against its own geometry, because the row is not in the DOM yet', async () => {
  const virtualList = await readSource('src/components/VirtualList.tsx');
  assert.match(virtualList, /anchorKey\?: React\.Key \| null/);
  assert.match(virtualList, /onAnchorChange\?: \(key: React\.Key \| null\) => void/);
  assert.match(virtualList, /const target = variableLayout \? variableLayout\.offsets\[index\] : index \* \(itemHeight as number\)/);
  // Reporting the top row before the restore has run would overwrite the placement
  // being restored: the list renders at scroll zero first.
  assert.match(virtualList, /anchorSettled\.current/);
  for (const library of ['src/views/Library.tsx', 'src/views/GlobalLibraryView.tsx']) {
    const source = await readSource(library);
    assert.match(source, /anchorKey=\{restoreAnchorId\}/);
    // Scroll must not go through React state: it fires every frame, and this view
    // would re-render whole — sidebar, detail pane and all — for each one.
    assert.match(source, /placementRef\.current = key === null \? null : \{ anchorId: String\(key\), pageOffset/);
  }
});

test('the effects that reset the page skip their own first run', async () => {
  // Arriving with a restored filter would otherwise reset the restored page a frame
  // later, and the reader would land on page one having been promised page three.
  for (const file of ['src/views/AuthorsView.tsx', 'src/views/IdeasView.tsx']) {
    const source = await readSource(file);
    assert.match(source, /if \(!cutChanged\.current\) \{\s*cutChanged\.current = true;\s*return;\s*\}/, `${file} guards its page reset`);
  }
  const global = await readSource('src/views/GlobalLibraryView.tsx');
  assert.match(global, /if \(!searchSettled\.current\) \{\s*searchSettled\.current = true;\s*return;\s*\}/, 'the search debounce does not fire on arrival');
});

test('changing the cut throws the place away with it', async () => {
  for (const file of ['src/views/AuthorsView.tsx', 'src/views/IdeasView.tsx']) {
    const source = await readSource(file);
    assert.match(source, /setAnchorId\(null\);\s*report\.current\?\.\(\{ placement: null \}\)/, `${file} drops the anchor with the filter`);
  }
});

test('every anchored list marks its rows with the id they will be found by', async () => {
  const lists = {
    'src/views/AuthorsView.tsx': 'author.author_id',
    'src/views/IdeasView.tsx': 'node.id',
    'src/views/ArgumentMapView.tsx': 's.ideaId',
    'src/views/WorkspaceView.tsx': 'note.id',
  };
  for (const [file, expression] of Object.entries(lists)) {
    const source = await readSource(file);
    assert.match(source, new RegExp(`data-anchor-id=\\{${expression.replace(/\./g, '\\.')}\\}`), `${file} marks its rows`);
    assert.match(source, /ref=\{(scrollerRef|routesScrollerRef|listRef)\}/, `${file} anchors against its scroller`);
  }
});

// ── The two sections added after phase one ────────────────────────────────────

test('the workspace keeps its collection, its filters, its expanded folders and its open notes', async () => {
  const view = await readSource('src/views/WorkspaceView.tsx');
  for (const restored of ['scope', 'search', 'kindFilter', 'selectedTags', 'openIds', 'activeId']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // A Set does not survive a plain object, and the expanded folders are the reader's
  // route back to what they were reading.
  assert.match(view, /new Set\(snapshot\?\.expanded \?\? \[\]\)/);
  assert.match(view, /expanded: \[\.\.\.expanded\]/);

  const registry = await readSource('src/app/views/corpus.tsx');
  // The same view is a different section of the app under the other vault types.
  assert.match(registry, /snapshots\.read\('workspace'\)/);
  assert.match(registry, /snapshots\.read\('notes'\)/);
});

test('the argument map keeps its route filters but never reopens a built map', async () => {
  const [view, types] = await Promise.all([
    readSource('src/views/ArgumentMapView.tsx'),
    readSource('src/app/viewSnapshots.ts'),
  ]);
  for (const restored of ['mode', 'seedId', 'suggestionSearch', 'minConnections', 'routeSort']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // Redrawing the map means rebuilding it, and in AI mode that is a model call spent
  // on the act of walking back into the section.
  assert.doesNotMatch(view, /useState[^\n]*snapshot\?\.openArgumentMap/, 'the open map is not restored');
  assert.doesNotMatch(types, /openArgumentMap/, 'and it is not even stored');
  assert.match(view, /const \[surface, setSurface\] = useState<ArgumentMapSurface>\('catalog'\)/, 'a returning reader lands on the catalogue');
});

test('the snapshot store lives above the single render point and outside React state', async () => {
  const [app, context] = await Promise.all([readSource('src/App.tsx'), readSource('src/app/ViewContext.ts')]);

  assert.match(app, /viewSnapshotAccess\(activeVault\?\.id \?\? null\)/, 'the active vault is bound in one place');
  assert.match(app, /const snapshots = useMemo\(/, 'the access object is stable across renders');
  assert.match(app, /^\s*snapshots,$/m, 'the sections receive it through the view context');
  assert.match(context, /snapshots: ViewSnapshotAccess/);
  // As React state, every keystroke in a search box would re-render the whole shell.
  assert.doesNotMatch(app, /useState[^\n]*ViewSnapshots/, 'the snapshots are not shell state');
});

test('the core catalogue sections receive their snapshot the way they already receive a target', async () => {
  const registry = await readSource('src/app/views/corpus.tsx');
  for (const view of ['library', 'ideas', 'authors', 'dictionary']) {
    assert.match(registry, new RegExp(`snapshots\\.read\\('${view}'\\)`), `${view} is handed its snapshot`);
    assert.match(registry, new RegExp(`snapshots\\.patch\\('${view}',`), `${view} reports its snapshot back`);
  }
});

test('Dictionary restores its filters, open entries and selected detail tab', async () => {
  const view = await readSource('src/views/DictionaryView.tsx');
  for (const restored of [
    'query',
    'letter',
    'status',
    'tag',
    'authorId',
    'workId',
    'newOnly',
    'insufficientOnly',
    'sortKey',
    'sortDir',
    'viewMode',
  ]) {
    assert.match(view, new RegExp(`snapshot\\?\\.${restored}`), `${restored} survives leaving Dictionary`);
  }
  assert.match(view, /snapshot\?\.openEntries/);
  assert.match(view, /snapshot\?\.detailTabs/);
  assert.match(view, /restoredTab=\{detailTabs\[activeId\]\}/);
  assert.match(view, /report\.current = onSnapshotChange/);
});

test('a snapshot is an initial value, never a reactive prop', async () => {
  const sources = await Promise.all([
    readSource('src/views/AuthorsView.tsx'),
    readSource('src/views/IdeasView.tsx'),
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
  ]);
  for (const source of sources) {
    assert.match(source, /useState\([^)]*\(\) => snapshot\?\./, 'restored through a lazy initialiser');
    // Re-applying the snapshot after mount would fight the reader for control of
    // their own filters on every render of the shell.
    assert.doesNotMatch(source, /useEffect\(\(\) => \{[^}]*\}, \[snapshot\]\)/, 'the snapshot is not re-applied after mount');
    assert.match(source, /reportSnapshot|report\.current = onSnapshotChange/, 'the callback identity stays out of the effect deps');
  }
});

test('Autores restores its filters, its ordering and its open tabs', async () => {
  const view = await readSource('src/views/AuthorsView.tsx');
  for (const restored of ['sortBy', 'synthFilter', 'savedOnly', 'filtersOpen', 'query']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // Both halves of the search box start from the stored text, or the debounce fires
  // on mount and wipes the restored cut back to the whole corpus.
  assert.match(view, /const \[query, setQuery\] = useState\(\(\) => snapshot\?\.query \?\? ''\)/);
  assert.match(view, /const \[queryFilter, setQueryFilter\] = useState\(\(\) => snapshot\?\.query \?\? ''\)/);
  // A tab that is no longer open cannot be the active one.
  assert.match(view, /surface === 'author' && !snapshot\?\.openAuthors\?\.some\(\(author\) => author\.id === snapshot\.activeAuthorId\)\) return 'catalog'/);
  assert.match(view, /surface === 'matrix' && !snapshot\?\.matrixOpen\) return 'catalog'/);
});

test('Ideas restores its filters and its open idea tabs together with the active one', async () => {
  const view = await readSource('src/views/IdeasView.tsx');
  for (const restored of ['search', 'typeFilter', 'sortKey', 'filtersOpen', 'openIdeas']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  assert.match(view, /snapshot\?\.openIdeas\?\.some\(\(idea\) => idea\.id === snapshot\.activeIdeaId\)/, 'only an open idea can be restored as the active tab');
});

test('Biblioteca keeps a cut per scope, and only what nothing else already persists', async () => {
  const [wrapper, vaultLibrary, types] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
    readSource('src/app/viewSnapshots.ts'),
  ]);

  // One sidebar section, two engines behind the scope switch. Blending their filters
  // would apply a cut of the global catalogue to the vault's own library.
  assert.match(wrapper, /snapshot=\{snapshot\?\.vault\}/);
  assert.match(wrapper, /snapshot=\{snapshot\?\.global\}/);
  assert.match(vaultLibrary, /useState<WorkFilter>\(\(\) => snapshot\?\.filter \?\? \{\}\)/);
  // Each facet holds several values; a snapshot written when it held one still restores.
  for (const facet of ['sources', 'extractions', 'itemTypes', 'yearFrom', 'yearTo', 'tags', 'vaults', 'attachments']) {
    assert.match(wrapper, new RegExp(`restored\\?\\.${facet}`), `${facet} survives leaving the section`);
  }
  for (const legacy of ['source', 'extraction', 'itemType', 'facetTag', 'facetVault', 'attachmentFilter']) {
    assert.match(wrapper, new RegExp(`restored\\?\\.${legacy}\\)`), `a single ${legacy} from an older snapshot is still read`);
  }
  // Sorting and columns are already written to disk, and the scope lives in settings.
  assert.doesNotMatch(types, /visibleColumns|columnWidths/, 'the snapshot does not duplicate what the Library persists itself');
  const librarySnapshot = types.match(/export interface LibrarySnapshot \{[^}]*\}/)?.[0] ?? '';
  assert.doesNotMatch(librarySnapshot, /scope/, 'the scope switch is settings, not a snapshot');
});

test('explicit filter closes reach the snapshot before a section can unmount', async () => {
  const [vaultLibrary, globalLibrary, authors, ideas] = await Promise.all([
    readSource('src/views/Library.tsx'),
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/AuthorsView.tsx'),
    readSource('src/views/IdeasView.tsx'),
  ]);

  // A passive effect is still useful as a catch-all, but it is too late when the
  // interaction that dismisses a filter also navigates away and unmounts the view.
  assert.match(vaultLibrary, /const updateFilter =[\s\S]*?reportSnapshot\.current\?\.\(\{ \.\.\.snapshotOf\.current\(\), filter: next \}\);/);
  assert.match(vaultLibrary, /const toggleFilterPanel =[\s\S]*?filtersOpen: nextOpen,[\s\S]*?advancedFiltersOpen:/);
  assert.match(globalLibrary, /const toggleFilterPanel =[\s\S]*?reportSnapshotNow\(\{ filtersOpen: nextOpen \}\);/);
  assert.match(globalLibrary, /const clearCatalogFilters =[\s\S]*?reportSnapshotNow\(\{[\s\S]*?filters:/);
  assert.match(authors, /const toggleFilterPanel =[\s\S]*?report\.current\?\.\(\{ filtersOpen: nextOpen \}\);/);
  assert.match(ideas, /const toggleFilterPanel =[\s\S]*?report\.current\?\.\(\{ filtersOpen: nextOpen \}\);/);
});

test('a contextual Library filter is consumed once and cannot overwrite a later close', async () => {
  const [registry, wrapper, vaultLibrary, context, app] = await Promise.all([
    readSource('src/app/views/corpus.tsx'),
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/Library.tsx'),
    readSource('src/app/ViewContext.ts'),
    readSource('src/App.tsx'),
  ]);

  assert.match(context, /setLibraryTarget: \(target: Nonced<PendingLibraryNavigationTarget> \| null\) => void/);
  assert.match(app, /^\s*setLibraryTarget,$/m, 'the section can consume the shell-owned command');
  assert.match(registry, /onTargetConsumed=\{\(\) => setLibraryTarget\(null\)\}/);
  assert.match(wrapper, /onTargetConsumed=\{onTargetConsumed\}/g);
  assert.match(vaultLibrary, /setFilter\(target\.healthBucket \? \{ healthBucket: target\.healthBucket \} : \{\}\);\s*onTargetConsumed\?\.\(\);/);
  assert.match(wrapper, /if \(!requestedScope\) return;\s*setScope\(requestedScope\);/, 'consuming a target does not bounce the Library back to its stored scope');
});

test('the page and the row are one field, so neither can be restored without the other', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  // The whole point of the single field: there is no way to express a restored page
  // with no row, or a row with no page, because they are not separate values.
  assert.match(types, /placement: ListPlacement \| null/, 'every section stores its place as one value');
  assert.doesNotMatch(types, /^\s*pageOffset[?]?: number;\s*$\n\s*$/m, 'the page is never a field of its own');
  const declarations = types.match(/^\s*(pageOffset|anchorId)[?]?:/gm) ?? [];
  assert.equal(declarations.length, 2, 'the page and the row are declared once each, inside ListPlacement');

  // Eight sections, one contract.
  const placements = (types.match(/placement: ListPlacement \| null/g) ?? []).length;
  assert.equal(
    placements,
    8,
    'authors, ideas, both libraries, the workspace, the argument routes and the two galleries',
  );
});

test('ephemeral state dies on the way out', async () => {
  const types = await readSource('src/app/viewSnapshots.ts');
  // Open modals, spinners, in-flight errors, export selections and half-typed input
  // are not a place to return to. `filtersOpen` and `matrixOpen` are not modals:
  // one is part of the cut and the other is a tab.
  for (const forbidden of [
    'loading', 'error', 'exporting', 'exportMsg', 'searchDraft', 'detailId', 'trashMode',
    'zoteroOpen', 'migrationOpen', 'duplicatesOpen', 'recoveryOpen', 'confirmDelete',
  ]) {
    assert.doesNotMatch(types, new RegExp(`\\b${forbidden}\\b`), `${forbidden} is ephemeral`);
  }
  // What is stored is the applied search, not the draft in the box.
  const authors = await readSource('src/views/AuthorsView.tsx');
  assert.match(authors, /report\.current\?\.\(\{ query: queryFilter,/);
  const global = await readSource('src/views/GlobalLibraryView.tsx');
  assert.match(global, /currentSnapshot = useCallback\(\(\): LibraryGlobalSnapshot => \(\{\s*search,/, 'the global catalogue stores the applied search');
});

// ── Phase three: the reading sections ─────────────────────────────────────────

/**
 * A document whose blocks are 100px tall, stacked from the top of the scroller. Only
 * the two calls the search makes are needed, so it can be tested for real.
 */
function fakeDocument({ blockCount, blockHeight = 100, scrollTop = 0 }) {
  const blocks = Array.from({ length: blockCount }, (_, index) => ({
    getBoundingClientRect: () => ({
      top: index * blockHeight - scrollTop,
      bottom: (index + 1) * blockHeight - scrollTop,
    }),
  }));
  return { scroller: { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) }, blocks };
}

test('the place in a report is the block under the top edge', () => {
  const at = (scrollTop) => {
    const { scroller, blocks } = fakeDocument({ blockCount: 300, scrollTop });
    return topBlockIndex(scroller, blocks);
  };
  assert.equal(at(0), 0, 'a report opened at the top is at its first block');
  assert.equal(at(1_200), 12);
  assert.equal(at(1_250), 12, 'a paragraph half off the top is still the one being read');
  assert.equal(topBlockIndex(fakeDocument({ blockCount: 0 }).scroller, []), null, 'an empty document has no place');
});

test('a wrapper is not a second block over the same words', () => {
  // A blockquote around a paragraph, or a list around its items, would otherwise be
  // counted twice — and its bottom edge does not increase down the page, which is
  // what the search above relies on.
  const paragraph = { id: 'p', contains: () => false };
  const heading = { id: 'h', contains: () => false };
  const quote = { id: 'quote', contains: (other) => other === paragraph };
  const all = [heading, quote, paragraph];
  const root = { querySelectorAll: () => all };

  assert.deepEqual(readingBlocks(root).map((block) => block.id), ['h', 'p']);
});

test('a place in a report is a block, and it says which rendering it was counted in', async () => {
  const [types, reader] = await Promise.all([
    readSource('src/readingPlace.ts'),
    readSource('src/views/DeepResearchView.tsx'),
  ]);
  assert.match(types, /blockIndex: number/);
  assert.match(types, /rendering: string/);
  // The pixel a sentence sits at depends on the width of the window, on the font and
  // on whether the cover image had loaded yet.
  assert.doesNotMatch(types, /^\s*scrollTop[?]?:/m, 'a scrollTop is not a place');
  // A translated report is a different document with a different block count.
  assert.match(reader, /rendering: annotationScope/);
  assert.match(types, /restore && restore\.rendering === rendering \? restore\.blockIndex : null/);
  // A report grows after it first paints, and each of those changes pushes the text
  // down under a scroll position that was already set.
  assert.match(types, /new ResizeObserver\(place\)/);
  assert.match(types, /if \(!settled\.current \|\| frame\.current !== null\) return/, 'capture waits for the reader to take over');
  // React replaces the document's nodes when it re-renders. A list kept between
  // frames measures elements that are no longer on the page, and the block it
  // reports is then somewhere else entirely — which is exactly what the running app
  // did before this was read fresh.
  assert.match(types, /const blocks = readingBlocks\(root\);\s*const index = topBlockIndex\(scroller, blocks\);/);
});

test('Deep Research restores its gallery, the report it was left in and the place inside it', async () => {
  const view = await readSource('src/views/DeepResearchView.tsx');
  for (const restored of ['search', 'readFilter', 'sortKey', 'viewMode']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  // A reader with no report in it would render the gallery anyway.
  assert.match(view, /snapshot\?\.surface === 'reader' && snapshot\.openReport \? 'reader' : 'gallery'/);
  // The gallery is the only source of a saved report, so the reopen waits for it
  // instead of fetching the report a second way.
  assert.match(view, /const id = reopening\.current;\s*if \(!id \|\| !galleryRead\) return;/);
  assert.match(view, /restoredReading\.current = null;\s*setMode\('gallery'\)/, 'a report that is gone falls back to the gallery');
  assert.match(view, /useReadingPlace\(\{/);
  // The composer is a draft, not a place.
  const types = await readSource('src/app/viewSnapshots.ts');
  for (const field of ['objective', 'language', 'structureMode', 'unitOutline', 'audience']) {
    assert.doesNotMatch(types, new RegExp(`^\\s*${field}[?]?:`, 'm'), `${field} belongs to the composer, not to a place`);
  }
});

test('parentheses and a citation pill wrap as one unit', () => {
  const citation = {
    type: 'element',
    tagName: 'a',
    properties: { href: 'nodus://idea/cita-1' },
    children: [{ type: 'text', value: 'Moreno Garrido, A. (2012)' }],
  };
  const tree = {
    type: 'root',
    children: [
      { type: 'element', tagName: 'p', properties: {}, children: [
        { type: 'text', value: 'Texto anterior (' },
        citation,
        { type: 'text', value: '), texto posterior' },
      ] },
    ],
  };

  groupParenthesizedCitations(tree);

  assert.equal(tree.children[0].children[0].value, 'Texto anterior ');
  assert.equal(tree.children[0].children[2].value, ', texto posterior');
  assert.deepEqual(tree.children[0].children[1], {
    type: 'element',
    tagName: 'span',
    properties: { className: ['citation-group'] },
    children: [
      { type: 'text', value: '(' },
      citation,
      { type: 'text', value: ')' },
    ],
  });
});

test('the citation grouping transform leaves ordinary links and bare citations untouched', () => {
  for (const [href, before, after] of [
    ['https://example.com', '(', ')'],
    ['nodus://idea/cita-1', 'sin paréntesis ', ' al final'],
  ]) {
    const tree = { type: 'p', children: [
      { type: 'text', value: before },
      { type: 'element', tagName: 'a', properties: { href }, children: [] },
      { type: 'text', value: after },
    ] };
    const original = structuredClone(tree);
    groupParenthesizedCitations(tree);
    assert.deepEqual(tree, original);
  }
});

test('the Deep Research reader has persistent typography and a live report outline', async () => {
  const [view, css, shared, markdown, citationGroups] = await Promise.all([
    readSource('src/views/DeepResearchView.tsx'),
    readSource('src/index.css'),
    readSource('src/views/writingShared.tsx'),
    readSource('src/components/Markdown.tsx'),
    readSource('src/markdownCitationGroups.ts'),
  ]);
  assert.match(view, /READER_FONT_STORAGE_KEY = 'nodus\.deepResearch\.readerFontSize'/);
  assert.match(view, /data-testid="deep-research-font-decrease"/);
  assert.match(view, /data-testid="deep-research-font-increase"/);
  assert.match(view, /function ReaderFontControls\(/, 'typography state is isolated from the rendered document');
  assert.match(view, /window\.setTimeout\(\(\) => \{[\s\S]*?setFontSize/, 'font reflow starts after the native pointer dispatch completes');
  assert.match(view, /root\.style\.setProperty\('--deep-research-font-size'/, 'font size changes the existing document instead of remounting it');
  assert.match(view, /pendingAnchorRef[\s\S]*?scroller\.scrollTop \+= pending\.element\.getBoundingClientRect\(\)\.top - pending\.top/, 'font reflow preserves the visible reading block');
  assert.match(view, /function useReportOutline\(/);
  assert.match(view, /querySelectorAll<HTMLElement>\('h1, h2, h3, h4'\)/);
  assert.match(view, /data-testid="deep-research-outline-rail"/);
  assert.match(view, /aria-current=\{active \? 'location' : undefined\}/);
  assert.match(css, /\.deep-research-reader-document \.md \{[\s\S]*?font-size: var\(--deep-research-font-size, 16px\)/);
  assert.match(css, /overflow-wrap: normal;\s*word-break: normal;\s*hyphens: none;/);
  assert.match(css, /\.deep-research-reader-document \.md :is\(a, code, \.citation-link\)[\s\S]*?overflow-wrap: anywhere/);
  assert.match(citationGroups, /function groupParenthesizedCitations\(tree:[\s\S]*?className: \['citation-group'\]/, 'citation punctuation is grouped with its pill');
  assert.match(markdown, /rehypePlugins=\{\[rehypeKatex, rehypeGroupParenthesizedCitations, insertDocumentFigures\]\}/, 'the citation grouping transform runs in rendered Markdown');
  assert.match(css, /\.md \.citation-group \{\s*display: inline-block;\s*white-space: nowrap;/, 'a parenthesized citation wraps as one inline unit');
  assert.doesNotMatch(shared, /text-justify hyphens-auto/, 'justified report prose does not hyphenate words behind the reader');
  assert.match(shared, /icon="copyText"\s*label=\{t\('Copiar sin referencias'\)\}/, 'plain-text copy uses a text-copy mark');
  assert.doesNotMatch(shared, /icon="volume"\s*label=\{t\('Copiar sin referencias'\)\}/, 'plain-text copy is not presented as audio');
});

test('the gallery scroller is born and dies with the gallery', async () => {
  const view = await readSource('src/views/DeepResearchView.tsx');
  // The gallery is unmounted while a report is open. A hook called in the view would
  // come back from the reader still listening to the scroller that was thrown away.
  assert.match(view, /function GalleryScroller\(\{/);
  assert.match(view, /<GalleryScroller/);
  assert.match(view, /data-anchor-id=\{saved\.id\}/);
});

test('Inmersión restores its gallery and reopens the session it was left in', async () => {
  const view = await readSource('src/views/ImmersionView.tsx');
  for (const restored of ['search', 'sortKey', 'viewMode']) {
    assert.match(view, new RegExp(`useState[^\\n]*\\(\\) => snapshot\\?\\.${restored}`), `${restored} survives leaving the section`);
  }
  assert.match(view, /data-anchor-id=\{s\.id\}/);
  // The session carries its own progress, so reopening it lands on the step it was
  // left on. Reporting waits for the reopen, or the empty state on the way in would
  // erase the very session being restored.
  // The target is chosen at mount, before the first paint: a dossier still being
  // written wins over the session that was merely left open.
  assert.match(view, /return fromDossier \|\| snapshot\?\.openSession\?\.id \|\| null;/);
  assert.match(view, /const resuming = useRef<string \| null>\(resumeTarget\);/);
  assert.match(view, /if \(resuming\.current\) return;/);
  // The scope screen is a pass over the corpus; redrawing it means paying for it again.
  const types = await readSource('src/app/viewSnapshots.ts');
  assert.doesNotMatch(types, /ImmersionScope|openScope/, 'the scope screen is not restored');
});

test('a section walking back into what it had open never paints its gallery on the way', async () => {
  const [deep, immersion, ui] = await Promise.all([
    readSource('src/views/DeepResearchView.tsx'),
    readSource('src/views/ImmersionView.tsx'),
    readSource('src/components/ui.tsx'),
  ]);
  // Reopening means reading the report or the session back, which takes frames. What
  // is painted in those frames used to be the gallery, and a gallery that appears and
  // is replaced by the item it lists looks like the app clicking that item itself.
  assert.match(deep, /if \(mode === 'reader' && !openDraft\) \{[\s\S]*return galleryFailure[\s\S]*: <RestoringPane \/>;/);
  assert.match(deep, /data-testid="deep-research-catalog-error"/);
  // Inmersión decides at mount, not in an effect: an effect runs after the first
  // paint, and the first paint is the one that must not be the gallery.
  assert.match(immersion, /useState<'home' \| 'scope' \| 'player'>\(\(\) => \(resumeTarget \? 'player' : 'home'\)\)/);
  assert.match(immersion, /mode === 'player' && !session && <RestoringPane \/>/);
  // The waiting pane has exactly one way out when the thing is gone.
  assert.match(immersion, /if \(!opened\) setMode\('home'\)/);
  assert.match(deep, /restoredReading\.current = null;\s*setMode\('gallery'\)/);
  // A spinner that appears and vanishes inside 60ms is its own flicker.
  assert.match(ui, /setTimeout\(\(\) => setSlow\(true\), delayMs\)/);
});

test('Biblioteca reopens the documents that were open, and the reader finds its own page', async () => {
  const [view, docReader] = await Promise.all([
    readSource('src/views/GlobalLibraryView.tsx'),
    readSource('src/views/LibraryDocumentReader.tsx'),
  ]);
  assert.match(view, /useState<LibraryWorkspaceTab\[\]>\(\(\) => snapshot\?\.readers\?\.tabs \?\? \[\]\)/);
  // A tab that is no longer open cannot be the active one.
  assert.match(view, /snapshot\?\.readers\?\.tabs\.some\(\(tab\) => tab\.key === snapshot\.readers\?\.activeKey\)/);
  assert.match(view, /reportReaders\.current\?\.\(\{ readers: \{ tabs: workspaceTabs, activeKey: activeReaderKey \} \}\)/);
  // The place inside a document is not in the snapshot because it is not lost: the
  // reader writes it per document and restores it whenever it mounts.
  assert.match(docReader, /localStorage\.setItem\(readingPositionKey\(reader\.storageId\)/);
  assert.match(docReader, /localStorage\.getItem\(readingPositionKey\(reader\.storageId\)/);
});

test('the three sections added here receive their snapshot the way the others do', async () => {
  const [corpus, study, teaching] = await Promise.all([
    readSource('src/app/views/corpus.tsx'),
    readSource('src/app/views/study.tsx'),
    readSource('src/app/views/teaching.tsx'),
  ]);
  for (const view of ['deepResearch', 'immersion']) {
    assert.match(corpus, new RegExp(`snapshots\\.read\\('${view}'\\)`), `${view} is handed its snapshot`);
    assert.match(corpus, new RegExp(`snapshots\\.patch\\('${view}',`), `${view} reports its snapshot back`);
  }
  // The same surface under the three names the app gives it, each with its own cut.
  assert.match(study, /snapshots\.read\('studyDeepResearch'\)/);
  assert.match(teaching, /snapshots\.read\('teachingUnits'\)/);
  const databases = await readSource('src/app/views/databases.tsx');
  assert.match(databases, /snapshots\.read\('dbDeepResearch'\)/);
  assert.match(databases, /snapshots\.patch\('dbDeepResearch',/);
});

// ── Phase four: the half of the cut that outlives the run ─────────────────────

/** A fresh app start: the in-memory store is gone, the disk is not. */
const restart = () => store.clearViewSnapshots();

const forgetPreferences = () => {
  preferences.clearFilterPreferences();
  globalThis.localStorage.writes = 0;
  store.clearViewSnapshots();
};

test('database Deep Research restores its selected sources and open report within a vault', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'dbDeepResearch', {
    selectedDatabaseIds: ['DB1', 'DB2'], selectedViewIds: ['VIEW1'], openReportId: 'REPORT1',
  });
  assert.deepEqual(store.readViewSnapshot('vault-a', 'dbDeepResearch'), {
    selectedDatabaseIds: ['DB1', 'DB2'], selectedViewIds: ['VIEW1'], openReportId: 'REPORT1',
  });
  assert.equal(store.readViewSnapshot('vault-b', 'dbDeepResearch'), undefined);
});

test('the galleries reopen on the ordering and the layout the reader chose, run after run', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', {
    surface: 'gallery', openReport: null, search: 'mímesis', readFilter: 'unread', sortKey: 'title', viewMode: 'list',
  });
  store.patchViewSnapshot('vault-a', 'immersion', { search: 'ricoeur', sortKey: 'oldest', viewMode: 'list' });

  restart();

  const reports = store.readViewSnapshot('vault-a', 'deepResearch');
  assert.equal(reports.readFilter, 'unread', 'the read filter is a preference, not a place');
  assert.equal(reports.sortKey, 'title');
  assert.equal(reports.viewMode, 'list');
  const immersion = store.readViewSnapshot('vault-a', 'immersion');
  assert.equal(immersion.sortKey, 'oldest');
  assert.equal(immersion.viewMode, 'list');
});

test('a query and a place are not preferences, and do not come back with them', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', {
    surface: 'reader',
    openReport: { id: 'R1', label: 'La metáfora viva' },
    search: 'mímesis',
    sortKey: 'title',
    viewMode: 'list',
    placement: { anchorId: 'R7' },
    reading: { blockIndex: 42, rendering: 'original' },
  });
  store.patchViewSnapshot('vault-a', 'immersion', {
    openSession: { id: 'S1', label: 'Sesión' }, search: 'ricoeur', sortKey: 'oldest', placement: { anchorId: 'S9' },
  });

  restart();

  const reports = store.readViewSnapshot('vault-a', 'deepResearch');
  // A search restored a week later hides the gallery with no visible cause; a place
  // and an open report point at rows that may not exist any more.
  assert.equal(reports.search, '', 'the search box starts empty on a new run');
  assert.equal(reports.surface, 'gallery', 'a new run opens on the gallery');
  assert.equal(reports.openReport, null);
  assert.equal(reports.placement, null);
  assert.equal(reports.reading, null);
  const immersion = store.readViewSnapshot('vault-a', 'immersion');
  assert.equal(immersion.search, '');
  assert.equal(immersion.openSession, null);
  assert.equal(immersion.placement, null);
});

test('within a run the whole cut still wins over the stored preferences', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'title', viewMode: 'list' });
  store.patchViewSnapshot('vault-a', 'deepResearch', { search: 'mímesis', placement: { anchorId: 'R7' } });

  // Leaving the section and coming back is not a restart: the snapshot in memory is
  // the whole answer, and the seed must not overwrite it with its emptier one.
  const live = store.readViewSnapshot('vault-a', 'deepResearch');
  assert.equal(live.search, 'mímesis');
  assert.deepEqual(live.placement, { anchorId: 'R7' });
  assert.equal(live.sortKey, 'title');
});

test('a gallery never visited has no preferences to restore', () => {
  forgetPreferences();
  assert.equal(store.readViewSnapshot('vault-a', 'deepResearch'), undefined);
  assert.equal(store.readViewSnapshot('vault-a', 'immersion'), undefined);
});

test('wiping one vault leaves the others their preferences', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'title' });
  store.patchViewSnapshot('vault-b', 'deepResearch', { sortKey: 'oldest' });

  // Deleting a vault takes its preferences with it, and nobody else's.
  preferences.clearFilterPreferences('vault-a');
  store.clearViewSnapshots();
  assert.equal(store.readViewSnapshot('vault-a', 'deepResearch'), undefined);
  assert.equal(store.readViewSnapshot('vault-b', 'deepResearch').sortKey, 'oldest');
});

test('the three names of Deep Research keep three sets of preferences', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'title' });
  store.patchViewSnapshot('vault-a', 'studyDeepResearch', { sortKey: 'oldest' });
  store.patchViewSnapshot('vault-a', 'teachingUnits', { viewMode: 'list' });

  restart();

  assert.equal(store.readViewSnapshot('vault-a', 'deepResearch').sortKey, 'title');
  assert.equal(store.readViewSnapshot('vault-a', 'studyDeepResearch').sortKey, 'oldest');
  assert.equal(store.readViewSnapshot('vault-a', 'teachingUnits').viewMode, 'list');
  assert.equal(store.readViewSnapshot('vault-a', 'teachingUnits').sortKey, 'recent', 'what was never chosen keeps its default');
});

test('a preference belongs to the vault it was chosen in', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'title', viewMode: 'list' });
  restart();

  // Two corpora are two different sets of reports; ordering one says nothing about
  // the other, and the seed is read under the id being asked for, never carried over.
  assert.equal(store.readViewSnapshot('vault-b', 'deepResearch'), undefined);
  assert.equal(store.readViewSnapshot('vault-a', 'deepResearch').sortKey, 'title');
});

test('with no vault nothing is stored and nothing is seeded', () => {
  forgetPreferences();
  store.patchViewSnapshot(null, 'deepResearch', { sortKey: 'title' });
  assert.equal(store.readViewSnapshot(null, 'deepResearch'), undefined);
  assert.equal(store.readViewSnapshot('vault-a', 'deepResearch'), undefined, 'a vault-less write is not a write to whoever comes next');
});

test('a value that is not an option of its select is ignored, not restored', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'conexiones', viewMode: 'list', readFilter: 42 });
  restart();

  const reports = store.readViewSnapshot('vault-a', 'deepResearch');
  // A select holding a value it has no option for renders visibly empty and cannot
  // be put right except by choosing something else.
  assert.equal(reports.sortKey, 'recent', 'an unknown ordering falls back to the default');
  assert.equal(reports.readFilter, 'all');
  assert.equal(reports.viewMode, 'list', 'the fields that were valid still survive');

  // The same for a store written by hand or left behind by an older version.
  globalThis.localStorage.setItem('nodus.galleryFilters.immersion.vault-a', '{ not json');
  store.clearViewSnapshots();
  assert.equal(store.readViewSnapshot('vault-a', 'immersion'), undefined, 'an unreadable entry is a missing entry');
});

test('typing in the search box does not write to disk once per keystroke', () => {
  forgetPreferences();
  store.patchViewSnapshot('vault-a', 'deepResearch', { sortKey: 'title', viewMode: 'list' });
  const afterChoice = globalThis.localStorage.writes;
  assert.ok(afterChoice > 0, 'choosing an ordering is written');

  // The gallery reports its filters together with the search on every keystroke, and
  // `setItem` is synchronous on the thread painting the list being typed into.
  for (const search of ['m', 'mí', 'mím', 'míme', 'mímes', 'mímesi', 'mímesis']) {
    store.patchViewSnapshot('vault-a', 'deepResearch', { search, sortKey: 'title', viewMode: 'list' });
  }
  assert.equal(globalThis.localStorage.writes, afterChoice, 'repeating the same preferences costs nothing');

  store.patchViewSnapshot('vault-a', 'deepResearch', { search: 'mímesis', sortKey: 'oldest', viewMode: 'list' });
  assert.equal(globalThis.localStorage.writes, afterChoice + 1, 'a changed preference is written once');
});

test('only the galleries opt in, and only for the three durable fields', async () => {
  const [preferences, types] = await Promise.all([
    readSource('src/app/filterPreferences.ts'),
    readSource('src/app/viewSnapshots.ts'),
  ]);
  const opted = preferences.match(/export const PREFERENCE_VIEWS[^;]*;/s)?.[0] ?? '';
  for (const view of ['deepResearch', 'studyDeepResearch', 'teachingUnits', 'immersion']) {
    assert.match(opted, new RegExp(`'${view}'`), `${view} keeps its preferences between runs`);
  }
  for (const view of ['authors', 'ideas', 'library', 'workspace', 'notes', 'argument']) {
    assert.doesNotMatch(opted, new RegExp(`'${view}'`), `${view} was not asked for and does not opt in`);
  }
  // The durable set is closed: anything else in a patch stops at the in-memory store.
  const fields = preferences.match(/export interface GalleryFilterPreferences \{[^}]*\}/s)?.[0] ?? '';
  assert.match(fields, /readFilter\?:/);
  assert.match(fields, /sortKey\?:/);
  assert.match(fields, /viewMode\?:/);
  for (const ephemeral of ['search', 'placement', 'openReport', 'openSession', 'reading', 'surface']) {
    assert.doesNotMatch(fields, new RegExp(`\\b${ephemeral}\\??:`), `${ephemeral} is a place, not a preference`);
  }
  assert.match(types, /if \(isPreferenceView\(view\)\) writeFilterPreferences\(vaultId, view, patch/, 'the write-through sits in the one place a cut is recorded');
});
