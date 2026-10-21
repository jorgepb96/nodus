import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';
import atlasCatalogue from '../../../site/data/research-atlas.json';
import type {
  BrowserBookmark,
  BrowserBookmarkCandidate,
  BrowserBookmarkFolder,
  BrowserBookmarkNodeRef,
  BrowserBookmarkSort,
  BrowserBookmarkStore,
  BrowserBookmarksImportPreview,
} from '@shared/browserBookmarks';
import {
  browserBookmarkChildren,
  browserBookmarkFolderPath,
  browserBookmarksExportFileName,
  canonicalBookmarkUrl,
  DEFAULT_BROWSER_BOOKMARK_SORT,
  isBrowserBookmarkSort,
  searchBrowserBookmarks,
  sortBrowserBookmarkItems,
} from '@shared/browserBookmarks';
import {
  NODUS_BOOKMARKS_URL,
  NODUS_RESEARCH_ATLAS_URL,
  NODUS_RESEARCH_ATLAS_START_URL,
} from '@shared/browser';
import './NodusBookmarks.css';

const NODUS_SITE = 'https://nodusresearch.com/';
const NODUS_REPOSITORY = 'https://github.com/jorgepb96/nodus';
const NODUS_LOGO = new URL('../../../site/assets/nodus-logo.svg', import.meta.url).href;
const NODUS_ORGANISM_SCRIPT = new URL('../../../site/assets/js/organism.js', import.meta.url).href;

interface NodusOrganismController {
  start(): void;
  stop(): void;
  resize(): void;
  pointer(x: number, y: number): void;
  pointerOut(): void;
  pulse(x: number, y: number, strength: number): void;
  scrolled(velocity: number): void;
}

declare global {
  interface Window {
    NodusOrganismFactory?: { create(canvas: HTMLCanvasElement): NodusOrganismController | null };
  }
}

interface AtlasResource {
  id: string; name: string; url: string; description: string; access_model?: string;
  geography?: { continent?: string | null; country?: string | null; region?: string | null };
  knowledge_domains?: string[]; type_of_use?: string[];
}

function openSitePage(url: string) {
  if (url === NODUS_RESEARCH_ATLAS_START_URL) {
    void window.nodus.navigateBrowserStartPage('atlas');
    return;
  }
  if (url === NODUS_BOOKMARKS_URL) {
    void window.nodus.navigateBrowserStartPage('bookmarks');
    return;
  }
  void window.nodus.submitBrowserOmnibox(url);
}

function SiteLink({ label, url, className = '', current = false, onOpen }: {
  label: ReactNode; url: string; className?: string; current?: boolean; onOpen?: () => void;
}) {
  return <button type="button" className={className} aria-current={current ? 'page' : undefined} onClick={() => { onOpen?.(); openSitePage(url); }}>{label}</button>;
}

function NodusSiteBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let organism: NodusOrganismController | null = null;
    const removers: Array<() => void> = [];
    const listen = (target: EventTarget, type: string, handler: EventListener) => {
      target.addEventListener(type, handler, { passive: true });
      removers.push(() => target.removeEventListener(type, handler));
    };

    const mount = () => {
      if (disposed || organism || !window.NodusOrganismFactory) return;
      organism = window.NodusOrganismFactory.create(canvas);
      if (!organism) {
        canvas.classList.add('organism-unavailable');
        return;
      }
      organism.start();
      requestAnimationFrame(() => { if (!disposed) canvas.classList.add('awake'); });

      const page = canvas.closest<HTMLElement>('.nodus-start-page');
      let previousScroll = page?.scrollTop ?? 0;
      let resizeTimer = 0;
      listen(window, 'resize', (() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => organism?.resize(), 140);
      }) as EventListener);
      listen(window, 'pointermove', ((event: PointerEvent) => organism?.pointer(event.clientX, event.clientY)) as EventListener);
      listen(window, 'pointerleave', (() => organism?.pointerOut()) as EventListener);
      listen(window, 'pointerdown', ((event: PointerEvent) => organism?.pulse(event.clientX, event.clientY, 1)) as EventListener);
      if (page) listen(page, 'scroll', (() => {
        const next = page.scrollTop;
        organism?.scrolled(next - previousScroll);
        previousScroll = next;
      }) as EventListener);
      listen(document, 'visibilitychange', (() => {
        if (document.hidden) organism?.stop(); else organism?.start();
      }) as EventListener);
      removers.push(() => window.clearTimeout(resizeTimer));
    };

    if (window.NodusOrganismFactory) mount();
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-nodus-organism]');
      const script = existing ?? document.createElement('script');
      const onLoad = () => mount();
      script.addEventListener('load', onLoad, { once: true });
      removers.push(() => script.removeEventListener('load', onLoad));
      if (!existing) {
        script.src = NODUS_ORGANISM_SCRIPT;
        script.dataset.nodusOrganism = 'true';
        document.head.appendChild(script);
      }
    }

    return () => {
      disposed = true;
      for (const remove of removers.splice(0)) remove();
      organism?.stop();
      canvas.classList.remove('awake');
    };
  }, []);

  return <div className="nodus-site-backdrop" aria-hidden="true">
    <canvas ref={canvasRef} className="nodus-site-organism" data-organism-managed="host" />
  </div>;
}

function NodusSiteHeader({ page }: { page: 'atlas' | 'bookmarks' }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [stars, setStars] = useState<string>('·');
  const [downloads, setDownloads] = useState<string>('—');
  useEffect(() => {
    const controller = new AbortController();
    const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    void fetch('https://api.github.com/repos/jorgepb96/nodus', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (typeof result?.stargazers_count === 'number') setStars(compact(result.stargazers_count)); })
      .catch(() => {});
    void fetch(`${NODUS_SITE}data/github-release-downloads.json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (typeof result?.total === 'number') setDownloads(compact(result.total)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, [open]);
  return <header ref={headerRef} className="nodus-site-header" data-testid="nodus-site-header">
    <button type="button" className="nodus-site-logo" aria-label={t('Nodus Research, inicio')} onClick={() => openSitePage(NODUS_SITE)}><img src={NODUS_LOGO} alt="" /> Nodus Research</button>
    <button ref={toggleRef} type="button" className="nodus-site-nav-toggle" aria-controls="nodus-start-site-links" aria-label={open ? t('Cerrar menú') : t('Abrir menú')} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
    <nav id="nodus-start-site-links" className={`nodus-site-links${open ? ' open' : ''}`} aria-label="Nodus Research">
      <SiteLink className="nodus-site-link" label="Home" url={NODUS_SITE} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Bookmarks" url={NODUS_BOOKMARKS_URL} current={page === 'bookmarks'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Wiki" url={`${NODUS_SITE}wiki/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Blog" url={`${NODUS_SITE}blog/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Atlas" url={NODUS_RESEARCH_ATLAS_URL} current={page === 'atlas'} onOpen={close} />
      <SiteLink className="nodus-site-link" label="FAQ" url={`${NODUS_SITE}faq/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Models" url={`${NODUS_SITE}models/`} onOpen={close} />
      <SiteLink className="nodus-site-link" label="Support" url={`${NODUS_SITE}contribute/`} onOpen={close} />
      <span className="nodus-site-nav-sep" aria-hidden="true" />
      <SiteLink className="nodus-site-badge" label={<><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg><span>Star</span><span className="nodus-site-stars"><Icon name="star" size={12} />{stars}</span></>} url={NODUS_REPOSITORY} onOpen={close} />
      <SiteLink className="nodus-site-badge nodus-site-downloads" label={<><Icon name="download" size={14} /><span>{downloads}</span><span>downloads</span></>} url={`${NODUS_REPOSITORY}/releases`} onOpen={close} />
      <SiteLink className="nodus-site-primary" label="Try the live demo" url={`${NODUS_SITE}demo/`} onOpen={close} />
    </nav>
  </header>;
}

const FOOTER_GROUPS = [
  { title: 'Investigación', links: [['Research Atlas', NODUS_RESEARCH_ATLAS_URL], ['Nodus Bookmarks', NODUS_BOOKMARKS_URL], ['La aplicación Nodus', `${NODUS_SITE}app/`], ['Investigación académica', `${NODUS_SITE}research/`], ['Nodus y Zotero', `${NODUS_SITE}zotero/`]] },
  { title: 'Producto', links: [['Las cuatro bóvedas', `${NODUS_SITE}#vaults`], ['Otras bóvedas', `${NODUS_SITE}#more-vaults`], ['Nodus Toolkit', `${NODUS_SITE}#tools`], ['Demos en vivo', `${NODUS_SITE}demo/`]] },
  { title: 'Aprender', links: [['Wiki', `${NODUS_SITE}wiki/`], ['Blog', `${NODUS_SITE}blog/`], ['FAQ', `${NODUS_SITE}faq/`], ['Tutoriales en vídeo', `${NODUS_SITE}wiki/#videos`]] },
  { title: 'Proyecto', links: [['Acerca de', `${NODUS_SITE}about/`], ['Colaborar', `${NODUS_SITE}contribute/`], ['GitHub', NODUS_REPOSITORY], ['Versiones', `${NODUS_REPOSITORY}/releases`], ['AGPL-3.0-only', `${NODUS_REPOSITORY}/blob/main/LICENSE`]] },
] as const;

function NodusSiteFooter() {
  return <footer className="nodus-site-footer" data-testid="nodus-site-footer"><div className="nodus-site-wrap">
    <div className="nodus-site-foot-grid">
      <div className="nodus-site-foot-brand"><span className="nodus-site-foot-logo"><img src={NODUS_LOGO} alt="" /> Nodus Research</span><p>{t('Un espacio de investigación gratuito, de código abierto y local para conectar fuentes, ideas y pruebas. Tu corpus permanece en tu máquina.')}</p></div>
      {FOOTER_GROUPS.map((group) => <div className="nodus-site-foot-col" key={group.title}><h3>{t(group.title)}</h3>{group.links.map(([label, url]) => <SiteLink key={label} label={t(label)} url={url} />)}</div>)}
    </div>
    <div className="nodus-site-foot-base"><span>{t('© 2026 Jorge Pérez Burgueño y colaboradores de Nodus.')}</span><SiteLink label={t('Privacidad')} url={`${NODUS_REPOSITORY}/blob/main/PRIVACY.md`} /><SiteLink label={t('Código de conducta')} url={`${NODUS_REPOSITORY}/blob/main/CODE_OF_CONDUCT.md`} /><SiteLink label={t('Seguridad')} url={`${NODUS_REPOSITORY}/blob/main/SECURITY.md`} /></div>
  </div></footer>;
}

function StartShell({ title, copy, query, onQuery, status, children, toolbar }: {
  title: string; copy: string; query: string; onQuery: (value: string) => void;
  status: string; children: React.ReactNode; toolbar?: React.ReactNode;
}) {
  const page = title === 'Nodus Bookmarks' ? 'bookmarks' : 'atlas';
  return (
    <main className={`nodus-start-page atlas-main ${page === 'bookmarks' ? 'bookmarks-main' : 'research-atlas-main'}`}>
      <NodusSiteBackdrop />
      <NodusSiteHeader page={page} />
      <div className="nodus-site-content atlas-shell">
        <div className="atlas-intro">
          <h1 className="atlas-title">{title}</h1>
          <p className="atlas-copy">{copy}</p>
          <div className="atlas-search-wrap">
            <div className={`atlas-searchbar${page === 'bookmarks' ? ' is-bookmarks' : ''}`}>
              {page !== 'bookmarks' && <>
                <div className="atlas-engine-wrap"><span className="atlas-engine flex items-center">Nodus Research</span></div>
                <span className="atlas-search-sep" aria-hidden="true" />
              </>}
              <div className="atlas-input-wrap">
                <Icon name="search" size={19} className="atlas-search-icon" />
                <input
                  className="atlas-search"
                  type="search"
                  value={query}
                  aria-label={tx('Buscar en {title}', { title })}
                  placeholder={title === 'Nodus Bookmarks' ? t('Buscar marcadores…') : t('Buscar en el directorio de investigación…')}
                  onChange={(event) => onQuery(event.target.value)}
                />
                {query && <button className="atlas-clear" type="button" aria-label={t('Borrar búsqueda')} onClick={() => onQuery('')}>×</button>}
              </div>
              <button className="atlas-submit" type="button" aria-label={t('Buscar')}><Icon name="search" size={18} /></button>
            </div>
            {toolbar}
            <p className="atlas-status" aria-live="polite">{status}</p>
          </div>
        </div>
        <div className="atlas-grid">{children}</div>
      </div>
      <NodusSiteFooter />
    </main>
  );
}

// The chosen order is a viewing preference of this device, not bookmark data:
// it is kept out of the store so exports and imports never carry it.
const BOOKMARK_SORT_STORAGE_KEY = 'nodus.browser.bookmarks.sort';

function readBookmarkSort(): BrowserBookmarkSort {
  try {
    const stored = window.localStorage.getItem(BOOKMARK_SORT_STORAGE_KEY);
    return isBrowserBookmarkSort(stored) ? stored : DEFAULT_BROWSER_BOOKMARK_SORT;
  } catch {
    return DEFAULT_BROWSER_BOOKMARK_SORT;
  }
}

function writeBookmarkSort(sort: BrowserBookmarkSort) {
  try { window.localStorage.setItem(BOOKMARK_SORT_STORAGE_KEY, sort); } catch { /* the order simply resets next time */ }
}

type BookmarkPageItem =
  | { kind: 'folder'; folder: BrowserBookmarkFolder }
  | { kind: 'bookmark'; bookmark: BrowserBookmark };

const BOOKMARK_VIEW_STORAGE_KEY = 'nodus.browser.bookmarks.view';
type BookmarkView = 'cards' | 'list';

function readBookmarkView(): BookmarkView {
  try {
    return window.localStorage.getItem(BOOKMARK_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function writeBookmarkView(view: BookmarkView) {
  try { window.localStorage.setItem(BOOKMARK_VIEW_STORAGE_KEY, view); } catch { /* the view simply resets next time */ }
}

function BookmarkViewToggle({ view, onView }: { view: BookmarkView; onView: (view: BookmarkView) => void }) {
  return (
    <div className="bookmark-view-toggle" role="group" aria-label={t('Modo de visualización')} data-testid="browser-bookmarks-view">
      <button type="button" data-view="cards" aria-pressed={view === 'cards'} aria-label={t('Ver como tarjetas')} title={t('Ver como tarjetas')} onClick={() => onView('cards')}><Icon name="grid" size={14} /></button>
      <button type="button" data-view="list" aria-pressed={view === 'list'} aria-label={t('Ver como lista')} title={t('Ver como lista')} onClick={() => onView('list')}><Icon name="list" size={14} /></button>
    </div>
  );
}

/** The sorts in the order the menu offers them: each pair is a sort and its inverse. */
const BOOKMARK_SORT_GROUPS: ReadonlyArray<ReadonlyArray<{ sort: BrowserBookmarkSort; label: string }>> = [
  [{ sort: 'recent', label: 'Más recientes primero' }, { sort: 'oldest', label: 'Más antiguos primero' }],
  [{ sort: 'alpha', label: 'Alfabético (A-Z)' }, { sort: 'alpha-desc', label: 'Alfabético (Z-A)' }],
  [{ sort: 'folders-alpha', label: 'Carpetas primero (A-Z)' }, { sort: 'folders-alpha-desc', label: 'Carpetas primero (Z-A)' }],
  [{ sort: 'favorites-first', label: 'Favoritos primero' }, { sort: 'favorites-only', label: 'Solo favoritos' }],
];

/**
 * The sort pill and its popover. It borrows the Atlas facet's pill and panel,
 * and the search-engine menu's single-choice rows, so it is dressed like the
 * controls beside it.
 */
function BookmarkSortMenu({ sort, onSort }: { sort: BrowserBookmarkSort; onSort: (sort: BrowserBookmarkSort) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const current = BOOKMARK_SORT_GROUPS.flat().find((option) => option.sort === sort);
  return (
    <div className="atlas-facet bookmark-sort" ref={root}>
      <button
        ref={toggle}
        className={`atlas-facet-button${sort === DEFAULT_BROWSER_BOOKMARK_SORT ? '' : ' is-active'}`}
        type="button"
        data-testid="browser-bookmarks-sort"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="sort" size={13} />
        <span className="atlas-facet-label">{t('Ordenar')}</span>
        <span className="atlas-facet-value">{current ? t(current.label) : ''}</span>
        <span className="atlas-facet-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="atlas-facet-panel bookmark-sort-panel" role="menu" aria-label={t('Ordenar marcadores')} data-testid="browser-bookmarks-sort-menu">
          {BOOKMARK_SORT_GROUPS.map((group, index) => (
            <div className="bookmark-sort-group" role="group" key={index}>
              {group.map((option) => (
                <button
                  key={option.sort}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.sort === sort}
                  data-sort={option.sort}
                  className={`atlas-engine-option${option.sort === sort ? ' is-selected' : ''}`}
                  onClick={() => { onSort(option.sort); setOpen(false); toggle.current?.focus(); }}
                >
                  <span className="atlas-engine-tick" aria-hidden="true" />
                  <span>{t(option.label)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function wrapItems(view: BookmarkView, cards: ReactNode[]): ReactNode {
  if (view === 'cards' || !cards.length) return cards;
  return <div className="bookmark-list" data-testid="browser-bookmarks-list">{cards}</div>;
}

export function NodusBookmarksPage({ store, onEditBookmark, onNewBookmark, onNewFolder, onNotice }: {
  store: BrowserBookmarkStore;
  onEditBookmark: (bookmark: BrowserBookmark) => void;
  onNewBookmark: (parentId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sort, setSortState] = useState<BrowserBookmarkSort>(readBookmarkSort);
  const setSort = (next: BrowserBookmarkSort) => { setSortState(next); writeBookmarkSort(next); };
  const [view, setViewState] = useState<BookmarkView>(readBookmarkView);
  const setView = (next: BookmarkView) => { setViewState(next); writeBookmarkView(next); };
  const favoritesOnly = sort === 'favorites-only';
  const [dragging, setDragging] = useState<BrowserBookmarkNodeRef | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ ref: BrowserBookmarkNodeRef; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<BrowserBookmarksImportPreview | null>(null);
  // ConfirmModal cannot disable its own confirm button, so the dialog is kept
  // from committing twice by a ref rather than by the state it renders from.
  const importBusy = useRef(false);
  const folder = store.folders.find((entry) => entry.id === folderId) ?? null;
  useEffect(() => { if (folderId && !folder) setFolderId(null); }, [folder, folderId]);
  useEffect(() => {
    document.querySelector<HTMLElement>('.nodus-start-page')?.scrollTo({ top: 0, left: 0 });
  }, [folderId]);

  const results = useMemo(() => searchBrowserBookmarks(store, query), [query, store]);
  // One list of folders and bookmarks, so a date or alphabetical sort can
  // interleave them. A search keeps its own relevance order and only honours
  // "Favorites only" as a filter.
  const items = useMemo((): BookmarkPageItem[] => {
    const folderById = new Map(store.folders.map((entry) => [entry.id, entry]));
    const bookmarkById = new Map(store.bookmarks.map((entry) => [entry.id, entry]));
    if (query) {
      return results
        .filter((entry) => !favoritesOnly || entry.bookmark.favorite)
        .map((entry) => ({ kind: 'bookmark' as const, bookmark: entry.bookmark }));
    }
    return sortBrowserBookmarkItems(store, folderId, sort).flatMap((ref): BookmarkPageItem[] => {
      if (ref.kind === 'folder') {
        const folder = folderById.get(ref.id);
        return folder ? [{ kind: 'folder' as const, folder }] : [];
      }
      const bookmark = bookmarkById.get(ref.id);
      return bookmark ? [{ kind: 'bookmark' as const, bookmark }] : [];
    });
  }, [favoritesOnly, folderId, query, results, sort, store]);
  const folders = items.flatMap((item) => item.kind === 'folder' ? [item.folder] : []);
  const bookmarks = items.flatMap((item) => item.kind === 'bookmark' ? [item.bookmark] : []);
  const missingFaviconKey = bookmarks.filter((entry) => !entry.faviconDataUrl).map((entry) => entry.id).join('\n');
  useEffect(() => {
    if (missingFaviconKey) void window.nodus.resolveBrowserBookmarkFavicons(missingFaviconKey.split('\n'));
  }, [missingFaviconKey]);
  const pathFolders = useMemo(() => {
    const entries = [];
    let cursor = folder;
    while (cursor) {
      entries.unshift(cursor);
      cursor = store.folders.find((entry) => entry.id === cursor?.parentId) ?? null;
    }
    return entries;
  }, [folder, store.folders]);

  const move = async (targetParent: string | null) => {
    if (!dragging) return;
    try {
      const count = browserBookmarkChildren(store, targetParent).length;
      await window.nodus.moveBrowserBookmarkNode(dragging, targetParent, count);
    } finally { setDragging(null); setDropId(null); }
  };

  // The main process writes its own snapshot of the whole collection, so neither
  // an active search nor the folder on screen can narrow the exported file.
  const exportHtml = async () => {
    if (exporting) return;
    const suggestedName = browserBookmarksExportFileName('html');
    setExporting(true);
    try {
      const result = await window.nodus.exportBrowserBookmarks('html');
      if (result.canceled) {
        onNotice(t('Exportación cancelada.'));
        return;
      }
      onNotice(tx('Se exportaron {bookmarks} marcadores y {folders} carpetas en {file}.', {
        bookmarks: result.bookmarks,
        folders: result.folders,
        file: result.fileName ?? suggestedName,
      }));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    if (!deleteConfirmation || deleting) return;
    setDeleting(true);
    try {
      await window.nodus.deleteBrowserBookmarkNode(deleteConfirmation.ref);
      setDeleteConfirmation(null);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  // Import reuses the trusted preview/commit pair the manager already uses: the
  // chosen file is parsed and merged to a preview first, and nothing reaches the
  // collection until the summary is confirmed.
  const importFile = async () => {
    if (importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    try {
      const preview = await window.nodus.previewBrowserBookmarksImport();
      if (!preview) onNotice(t('Importación cancelada.'));
      else setImportPreview(preview);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
  };

  const commitImport = async () => {
    if (!importPreview || importBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    try {
      const result = await window.nodus.commitBrowserBookmarksImport(importPreview.token);
      setImportPreview(null);
      onNotice(tx('Se importaron {bookmarks} marcadores y {folders} carpetas. Se omitieron {duplicates} duplicados.', {
        bookmarks: result.summary.bookmarks,
        folders: result.summary.folders,
        duplicates: result.summary.duplicates,
      }));
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
  };

  return (
    <StartShell
      title="Nodus Bookmarks"
      copy="Your private, local research start page. Organise the websites you save in folders without sending bookmark data anywhere."
      query={query}
      onQuery={setQuery}
      status={query
        ? tx('{results} resultados · búsqueda global', { results: bookmarks.length })
        : favoritesOnly
          ? tx('{bookmarks} favoritos · toda la colección', { bookmarks: bookmarks.length })
          : tx('{folders} carpetas · {bookmarks} marcadores', { folders: folders.length, bookmarks: bookmarks.length })}
      toolbar={<>
        <div className="atlas-filterbar">
          <button className="atlas-facet-button" type="button" onClick={() => onNewFolder(folderId)}><Icon name="folderPlus" size={13} /> {t('Nueva carpeta')}</button>
          <button className="atlas-facet-button" type="button" onClick={() => onNewBookmark(folderId)}><Icon name="bookmark" size={13} /> {t('Añadir un marcador')}</button>
          {/* The Atlas is one click away in the site header, so its slot holds the view controls. */}
          <BookmarkSortMenu sort={sort} onSort={setSort} />
          <BookmarkViewToggle view={view} onView={setView} />
          <button
            className="atlas-facet-button"
            type="button"
            data-testid="browser-bookmarks-export-html"
            title={t('Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera')}
            aria-label={t('Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera')}
            aria-busy={exporting}
            disabled={exporting}
            onClick={() => void exportHtml()}
          ><Icon name="download" size={13} /> {exporting ? t('Exportando…') : t('Exportar HTML')}</button>
          <button
            className="atlas-facet-button"
            type="button"
            data-testid="browser-bookmarks-import-html"
            title={t('Importar marcadores desde un archivo HTML de Chrome, Edge, Firefox, Brave u Opera')}
            aria-label={t('Importar marcadores desde un archivo HTML de Chrome, Edge, Firefox, Brave u Opera')}
            aria-busy={importing}
            disabled={importing}
            onClick={() => void importFile()}
          ><Icon name="upload" size={13} /> {importing ? t('Importando…') : t('Importar HTML')}</button>
        </div>
        {!query && !favoritesOnly && <div className="bookmark-breadcrumbs"><button onClick={() => setFolderId(null)}>{t('Marcadores')}</button>{pathFolders.map((entry) => <span key={entry.id}> / <button onClick={() => setFolderId(entry.id)}>{entry.name}</button></span>)}</div>}
      </>}
    >
      {/* The list view reuses the same cards inside one full-width column, and
          NodusBookmarks.css lays each one out as a single row. */}
      {wrapItems(view, items.map((item) => {
        if (item.kind === 'folder') {
          const entry = item.folder;
          return (
            <article
              key={`folder:${entry.id}`}
              className={`card lit atlas-card bookmark-card${dropId === entry.id ? ' bookmark-drop' : ''}`}
              draggable
              onClick={(event) => { if (!(event.target as Element).closest('button')) setFolderId(entry.id); }}
              onDragStart={() => setDragging({ kind: 'folder', id: entry.id })}
              onDragOver={(event) => { event.preventDefault(); setDropId(entry.id); }}
              onDragLeave={() => setDropId(null)}
              onDrop={(event) => { event.preventDefault(); void move(entry.id); }}
            >
              <div className="bookmark-heading"><span className="bookmark-folder-icon"><Icon name="folder" size={19} /></span><h2><button type="button" title={entry.name} onClick={() => setFolderId(entry.id)}>{entry.name}</button></h2></div>
              <div className="atlas-geo">{tx('Carpeta · {items} elementos', { items: browserBookmarkChildren(store, entry.id).length })}</div>
              <p className="atlas-description">{t('Abre esta carpeta para explorar los recursos de investigación guardados y las subcarpetas.')}</p>
              <div className="atlas-card-actions"><button className="atlas-open" type="button" onClick={() => setFolderId(entry.id)}>{t('Abrir carpeta')} <Icon name="chevronRight" size={13} /></button><button className="atlas-open bookmark-delete" type="button" data-testid="browser-bookmark-card-delete" onClick={() => setDeleteConfirmation({ ref: { kind: 'folder', id: entry.id }, label: entry.name })}><Icon name="trash" size={13} /> {t('Eliminar')}</button></div>
            </article>
          );
        }
        const entry = item.bookmark;
        const location = browserBookmarkFolderPath(store, entry.parentId);
        return (
          <article key={`bookmark:${entry.id}`} className="card lit atlas-card bookmark-card" draggable onClick={(event) => { if (!(event.target as Element).closest('button')) void window.nodus.openBrowserTab(entry.url); }} onDragStart={() => setDragging({ kind: 'bookmark', id: entry.id })}>
            <div className="atlas-card-top"><div className="bookmark-heading">{entry.faviconDataUrl ? <img className="bookmark-favicon" src={entry.faviconDataUrl} alt="" /> : <Icon name="globe" size={22} />}<h2><button type="button" title={entry.title} onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.title}</button></h2></div><button
              type="button"
              className={`bookmark-star${entry.favorite ? ' is-favorite' : ''}`}
              data-testid="browser-bookmark-favorite"
              aria-pressed={entry.favorite}
              aria-label={entry.favorite ? tx('Quitar «{title}» de favoritos', { title: entry.title }) : tx('Marcar «{title}» como favorito', { title: entry.title })}
              title={entry.favorite ? t('Quitar de favoritos') : t('Marcar como favorito')}
              onClick={() => void window.nodus.updateBrowserBookmark(entry.id, { favorite: !entry.favorite }).catch((cause) => onNotice(cause instanceof Error ? cause.message : String(cause)))}
            ><Icon name="star" size={17} /></button></div>
            <div className="atlas-geo" title={`${new URL(entry.url).hostname}${location.length ? ` · ${location.join(' › ')}` : ''}`}>{new URL(entry.url).hostname}{location.length ? ` · ${location.join(' › ')}` : ''}</div>
            <p className="atlas-description" title={entry.description || t('Una web guardada de forma privada en Nodus Bookmarks.')}>{entry.description || t('Una web guardada de forma privada en Nodus Bookmarks.')}</p>
            <div className="atlas-card-actions">
              <button className="atlas-open" type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{t('Abrir')} <Icon name="external" size={13} /></button>
              <button className="atlas-open" type="button" onClick={() => onEditBookmark(entry)}>{t('Editar')}</button>
              <button className="atlas-open" type="button" onClick={() => void navigator.clipboard.writeText(entry.url)}>{t('Copiar URL')}</button>
              <button className="atlas-open bookmark-delete" type="button" data-testid="browser-bookmark-card-delete" onClick={() => setDeleteConfirmation({ ref: { kind: 'bookmark', id: entry.id }, label: entry.title })}><Icon name="trash" size={13} /> {t('Eliminar')}</button>
            </div>
          </article>
        );
      }))}
      {!folders.length && !bookmarks.length && favoritesOnly && !query && (
        <div className="atlas-empty"><h2>{t('Aún no hay favoritos')}</h2><p>{t('Pulsa la estrella de un marcador para verlo aquí.')}</p><div className="flex justify-center gap-2"><button className="atlas-open" onClick={() => setSort(DEFAULT_BROWSER_BOOKMARK_SORT)}>{t('Ver todos los marcadores')}</button></div></div>
      )}
      {!folders.length && !bookmarks.length && !(favoritesOnly && !query) && (
        <div className="atlas-empty"><h2>{t(query ? 'No hay marcadores que coincidan' : folder ? 'Esta carpeta está vacía' : 'Aún no hay marcadores.')}</h2><p>{t(query ? 'La búsqueda incluye títulos, direcciones, descripciones y nombres de carpetas.' : 'Guarda webs desde el Navegador de Nodus o el Research Atlas para crear tu página de inicio de investigación personal.')}</p><div className="flex justify-center gap-2"><button className="atlas-open" onClick={() => onNewBookmark(folderId)}>{t('Añadir un marcador')}</button><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}>{t('Abrir Research Atlas')}</button></div></div>
      )}
      {importPreview && <ConfirmModal
        title={tx('Vista previa de importación · {fileName}', { fileName: importPreview.fileName })}
        message={<>
          <p>{tx('{bookmarks} marcadores · {folders} carpetas · {duplicates} duplicados · {invalidUrls} URL no válidas omitidas', {
            bookmarks: importPreview.bookmarks,
            folders: importPreview.folders,
            duplicates: importPreview.duplicates,
            invalidUrls: importPreview.invalidUrls,
          })}{importPreview.truncated ? ` · ${t('límites aplicados')}` : ''}</p>
          <p className="mt-2">{t('Ningún marcador guardado se sobrescribe: las direcciones repetidas se omiten.')}</p>
        </>}
        confirmLabel={importing ? t('Importando…') : t('Importar sin sobrescribir')}
        zIndex={160}
        onCancel={() => { if (!importing) setImportPreview(null); }}
        onConfirm={() => void commitImport()}
      />}
      {deleteConfirmation && <ConfirmModal
        title={tx('¿Eliminar «{label}»?', { label: deleteConfirmation.label })}
        message={deleteConfirmation.ref.kind === 'folder'
          ? t('Se eliminará la carpeta y todo su contenido.')
          : t('Este marcador se eliminará de Nodus Bookmarks.')}
        confirmLabel={deleting ? t('Eliminando…') : t('Eliminar')}
        danger
        zIndex={160}
        onCancel={() => { if (!deleting) setDeleteConfirmation(null); }}
        onConfirm={() => void remove()}
      />}
    </StartShell>
  );
}

type AtlasFacetKey = 'area' | 'type';
const FACET_KEYS: AtlasFacetKey[] = ['area', 'type'];
const ATLAS_FACET_VALUES: Record<AtlasFacetKey, (entry: AtlasResource) => string[]> = {
  area: (entry) => entry.knowledge_domains ?? [],
  type: (entry) => entry.type_of_use ?? [],
};

/**
 * One Atlas facet: a pill that opens a list of checkboxes.
 *
 * Several values of the same facet stand chosen at once, which is the point of
 * the control — "Spain and Portugal", not "Spain, then a reload, then Portugal".
 * The panel stays open across picks for the same reason, and closes on a click
 * outside it or on Escape.
 *
 * The markup and class names are the public Research Atlas's own
 * (site/research-atlas), because this page reads that stylesheet:
 * NodusBookmarks.css imports it, so the dialog is defined once and dressed the
 * same in both places.
 */
function AtlasFacet({ label, values, counts, chosen, total, onToggle, onClear }: {
  label: string;
  values: string[];
  counts: Map<string, number>;
  chosen: string[];
  total: number;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = fold(term.trim());
  const shown = values.filter((value) => !needle || fold(value).includes(needle));
  const summary = chosen.length === 0
    ? label
    : chosen.length === 1
      ? chosen[0]
      : tx('{n} seleccionados', { n: chosen.length });

  return (
    <div className="atlas-facet" ref={root}>
      <button
        className={`atlas-facet-button${chosen.length ? ' is-active' : ''}`}
        type="button"
        aria-expanded={open}
        // A pill carrying the facet name *and* several chosen values can
        // outgrow its own cap and ellipsize, so the summary is reachable whole.
        title={chosen.length ? summary : undefined}
        onClick={() => { setOpen((was) => !was); setTerm(''); }}
      >
        <span className="atlas-facet-label">{label}</span>
        <span className="atlas-facet-value">{summary}</span>
        <span className="atlas-facet-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="atlas-facet-panel">
          <div className="atlas-facet-search-wrap">
            <Icon name="search" size={15} className="atlas-facet-search-icon" />
            <input
              className="atlas-facet-search"
              type="search"
              value={term}
              autoComplete="off"
              placeholder={tx('Buscar {label}…', { label: label.toLowerCase() })}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          {/* The rows are toggle buttons, so the group is named for the facet it
              belongs to: "Knowledge area, Social Sciences, toggle button, pressed". */}
          <div className="atlas-facet-options" role="group" aria-label={label}>
            <button
              type="button"
              className={`atlas-facet-option is-clear${chosen.length ? '' : ' is-selected'}`}
              aria-pressed={chosen.length === 0}
              onClick={onClear}
            >
              <span className="atlas-facet-check" aria-hidden="true" />
              <span className="atlas-facet-option-label">{t('Todos')}</span>
              <span className="atlas-facet-count">{total}</span>
            </button>
            {shown.map((value) => {
              const isChosen = chosen.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={`atlas-facet-option${isChosen ? ' is-selected' : ''}`}
                  aria-pressed={isChosen}
                  onClick={() => onToggle(value)}
                >
                  <span className="atlas-facet-check" aria-hidden="true" />
                  <span className="atlas-facet-option-label">{value}</span>
                  <span className="atlas-facet-count">{counts.get(value) ?? 0}</span>
                </button>
              );
            })}
            {!shown.length && <div className="atlas-facet-empty">{t('Sin opciones coincidentes.')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function NodusResearchAtlasPage({ store, onSave }: {
  store: BrowserBookmarkStore;
  onSave: (candidate: BrowserBookmarkCandidate) => void;
}) {
  const resources = (atlasCatalogue.resources ?? []) as AtlasResource[];
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Record<AtlasFacetKey, string[]>>({ area: [], type: [] });
  const saved = useMemo(() => new Set(store.bookmarks.map((entry) => canonicalBookmarkUrl(entry.url)).filter(Boolean)), [store]);
  const allValues = useMemo(() => ({
    area: [...new Set(resources.flatMap((entry) => entry.knowledge_domains ?? []))].sort(),
    type: [...new Set(resources.flatMap((entry) => entry.type_of_use ?? []))].sort(),
  }), [resources]);

  /**
   * Every result the page shows, plus what each facet's list has to offer.
   *
   * The counts deliberately exclude the facet they belong to: a Continent list
   * that counted its own selection would report one resource per continent the
   * moment anything was picked, and tell the reader nothing about what picking
   * a second one would do.
   */
  const atlas = useMemo(() => {
    const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const needle = fold(query.trim());
    const searchable = (entry: AtlasResource) => fold([
      entry.name, entry.url, entry.description,
      ...(entry.knowledge_domains ?? []), ...(entry.type_of_use ?? []),
      entry.geography?.continent, entry.geography?.country, entry.geography?.region,
    ].filter(Boolean).join(' '));
    const matches = (entry: AtlasResource, except?: AtlasFacetKey) => {
      if (needle && !searchable(entry).includes(needle)) return false;
      return FACET_KEYS.every((key) => {
        if (key === except) return true;
        const picked = chosen[key];
        return !picked.length || ATLAS_FACET_VALUES[key](entry).some((value) => picked.includes(value));
      });
    };
    const visible = resources.filter((entry) => matches(entry));
    const counts = {} as Record<AtlasFacetKey, Map<string, number>>;
    const totals = {} as Record<AtlasFacetKey, number>;
    const values = {} as Record<AtlasFacetKey, string[]>;
    for (const key of FACET_KEYS) {
      const byValue = new Map<string, number>();
      let total = 0;
      for (const entry of resources) {
        if (!matches(entry, key)) continue;
        total += 1;
        for (const value of ATLAS_FACET_VALUES[key](entry)) byValue.set(value, (byValue.get(value) ?? 0) + 1);
      }
      counts[key] = byValue;
      totals[key] = total;
      // A value the other facets have put out of reach is hidden — unless it is
      // one the reader has already ticked, which has to stay on screen or the
      // filter it applies could never be taken off again.
      values[key] = allValues[key].filter((value) => (byValue.get(value) ?? 0) > 0 || chosen[key].includes(value));
    }
    return { counts, totals, values, visible };
  }, [allValues, chosen, query, resources]);

  const toggle = (key: AtlasFacetKey, value: string) => setChosen((current) => ({
    ...current,
    [key]: current[key].includes(value)
      ? current[key].filter((entry) => entry !== value)
      : [...current[key], value],
  }));

  return (
    <StartShell title="Research Atlas" copy={t('Explora y filtra un directorio internacional seleccionado de webs de investigación, bibliotecas digitales, archivos, repositorios y colecciones de fuentes primarias.')} query={query} onQuery={setQuery} status={tx('{visible} de {total} recursos', { visible: atlas.visible.length, total: resources.length })} toolbar={
      <div className="atlas-filterbar">
        <AtlasFacet label={t('Área de conocimiento')} values={atlas.values.area} counts={atlas.counts.area} chosen={chosen.area} total={atlas.totals.area} onToggle={(value) => toggle('area', value)} onClear={() => setChosen((current) => ({ ...current, area: [] }))} />
        <AtlasFacet label={t('Tipo de recurso')} values={atlas.values.type} counts={atlas.counts.type} chosen={chosen.type} total={atlas.totals.type} onToggle={(value) => toggle('type', value)} onClear={() => setChosen((current) => ({ ...current, type: [] }))} />
        {(chosen.area.length || chosen.type.length || query) && <button className="atlas-reset" onClick={() => { setChosen({ area: [], type: [] }); setQuery(''); }}>{t('Limpiar filtros')}</button>}
        <button className="atlas-facet-button" type="button" onClick={() => void window.nodus.openBrowserTab(NODUS_RESEARCH_ATLAS_URL)}><Icon name="external" size={13} /> {t('Atlas público')}</button>
      </div>}
    >
      {atlas.visible.map((entry) => {
        const isSaved = saved.has(canonicalBookmarkUrl(entry.url));
        const geo = [entry.geography?.continent, entry.geography?.country, entry.geography?.region].filter(Boolean).join(' · ');
        return <article key={entry.id} className="card lit atlas-card">
          <div className="atlas-card-top"><h2><button type="button" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{entry.name}</button></h2><span className="atlas-access">{entry.access_model || t('recurso')}</span></div>
          <div className="atlas-geo">{geo}</div><p className="atlas-description">{entry.description}</p>
          <dl className="atlas-meta"><div className="atlas-meta-row"><dt>{t('Conocimiento')}</dt><dd>{entry.knowledge_domains?.join(' · ')}</dd></div><div className="atlas-meta-row"><dt>{t('Uso')}</dt><dd>{entry.type_of_use?.join(' · ')}</dd></div></dl>
          <div className="atlas-card-actions"><button className="atlas-open" onClick={() => void window.nodus.openBrowserTab(entry.url)}>{t('Abrir recurso')} <Icon name="external" size={13} /></button><button className={`atlas-open${isSaved ? ' is-saved' : ''}`} disabled={isSaved} onClick={() => onSave({ title: entry.name, url: entry.url, description: entry.description, faviconDataUrl: null, existingId: null })}><Icon name={isSaved ? 'bookmarkFill' : 'bookmark'} size={13} />{isSaved ? t('Guardado') : t('Guardar')}</button></div>
        </article>;
      })}
      {!atlas.visible.length && <div className="atlas-empty">{t('Sin resultados para los filtros actuales.')}</div>}
    </StartShell>
  );
}
