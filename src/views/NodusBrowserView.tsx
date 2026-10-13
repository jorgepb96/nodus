import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import { MAX_BROWSER_TABS } from '@shared/browser';
import { opensInNewTab } from '@shared/browserShortcuts';
import type {
  BrowserDownloadView,
  BrowserRestartResult,
  BrowserState,
  BrowserTabState,
  BrowserViewport,
  PendingBrowserAuth,
  PendingBrowserPermission,
} from '@shared/browser';
import type { BrowserConnectorCapturePreview } from '@shared/browserConnector';
import type { AppSettings } from '@shared/types';
import { BrowserCaptureModal } from '../components/browser/BrowserCaptureModal';
import { BrowserBookmarkModal, type BookmarkEditorTarget } from '../components/browser/BrowserBookmarkModal';
import { BrowserBookmarksManager } from '../components/browser/BrowserBookmarksManager';
import { BrowserHistoryManager } from '../components/browser/BrowserHistoryManager';
import { NodusBookmarksPage, NodusResearchAtlasPage } from '../components/browser/NodusStartPages';
import { canonicalBookmarkUrl, emptyBrowserBookmarkStore } from '@shared/browserBookmarks';
import type { BrowserBookmarkStore } from '@shared/browserBookmarks';
import connectorIcon from '../../browser-extension/icons/icon.svg';

/**
 * Nodus Browser.
 *
 * This component renders CHROME ONLY. The page itself is a native
 * WebContentsView owned by the main process, positioned over the empty
 * `data-browser-viewport` div below. That division is the whole architecture:
 * the renderer never holds a WebContents, so a website cannot reach Nodus
 * through it.
 *
 * The consequence to keep in mind while editing: a native view paints ABOVE this
 * HTML. Anything that must appear over the page — modals, the command palette,
 * Nodi — has to hide the view first (window.nodus.setBrowserOverlayVisible), and
 * the error panes below are drawn while the view is hidden for that reason.
 */
export function NodusBrowserView() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const publishedViewportRef = useRef<BrowserViewport | null>(null);
  const [state, setState] = useState<BrowserState>({ tabs: [], activeTabId: null });
  const [omnibox, setOmnibox] = useState('');
  const [omniboxFocused, setOmniboxFocused] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingBrowserPermission | null>(null);
  const [auth, setAuth] = useState<PendingBrowserAuth | null>(null);
  const [capture, setCapture] = useState<BrowserConnectorCapturePreview | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartWarning, setRestartWarning] = useState<BrowserRestartResult | null>(null);
  const [downloads, setDownloads] = useState<BrowserDownloadView[]>([]);
  const [panel, setPanel] = useState<null | 'downloads' | 'settings' | 'actions'>(null);
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkStore>(emptyBrowserBookmarkStore);
  const [bookmarkEditor, setBookmarkEditor] = useState<BookmarkEditorTarget | null>(null);
  const [bookmarksManager, setBookmarksManager] = useState(false);
  const [historyManager, setHistoryManager] = useState(false);
  const [returnToBookmarksManager, setReturnToBookmarksManager] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findMatches, setFindMatches] = useState(0);
  const [findActive, setFindActive] = useState(0);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const active: BrowserTabState | null =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const activeBookmark = useMemo(() => {
    if (active?.kind !== 'web') return null;
    const currentUrl = canonicalBookmarkUrl(active.url);
    if (!currentUrl) return null;
    return bookmarks.bookmarks.find((entry) => canonicalBookmarkUrl(entry.url) === currentUrl) ?? null;
  }, [active?.kind, active?.url, bookmarks.bookmarks]);

  // Subscribe first, then read: doing it the other way round drops any change
  // that lands between the read and the subscription.
  useEffect(() => {
    const stop = window.nodus.onBrowserStateChanged(setState);
    void window.nodus.getBrowserState().then((current) => {
      setState(current);
      // The renderer starts with an empty placeholder state. Opening from that
      // placeholder created a fresh tab on every remount, before the real state
      // (including the user's existing tab) arrived from main.
      if (current.tabs.length === 0) void window.nodus.openBrowserTab('');
    });
    return stop;
  }, []);

  useEffect(() => {
    const stop = window.nodus.onBrowserBookmarksChanged(setBookmarks);
    void window.nodus.getBrowserBookmarks().then(setBookmarks);
    return stop;
  }, []);

  /**
   * The page is a native view: it keeps painting over the window until told not
   * to, so leaving this section without the cleanup below left a website
   * floating above the rest of Nodus.
   */
  useEffect(() => {
    void window.nodus.setBrowserSectionVisible(true);
    return () => { void window.nodus.setBrowserSectionVisible(false); };
  }, []);

  useEffect(() => {
    const stop = window.nodus.onBrowserDownloadsChanged(setDownloads);
    void window.nodus.getBrowserDownloads().then(setDownloads).catch(() => undefined);
    return stop;
  }, []);

  useEffect(() => {
    const stop = window.nodus.onBrowserPermissionRequest(setPermission);
    void window.nodus.getPendingBrowserPermission().then(setPermission);
    // Leaving the section must not strand a page waiting on a prompt it can no
    // longer see: every pending request is denied on the way out.
    return () => {
      stop();
      void window.nodus.cancelBrowserPermissions();
    };
  }, []);

  useEffect(() => {
    const stop = window.nodus.onBrowserAuthRequest(setAuth);
    void window.nodus.getPendingBrowserAuth().then(setAuth);
    // Same reasoning as the permission prompt: a challenge whose bar can no
    // longer be seen must be cancelled, or Chromium waits on it forever.
    return () => {
      stop();
      void window.nodus.cancelBrowserAuth();
    };
  }, []);

  // Find in page: native WebContents find (like Deep Research's FindInPage but
  // for the native Browser view). Uses Electron's findInPage / stopFindInPage
  // via the browser partition.
  useEffect(() => {
    const stop = window.nodus.onBrowserFoundInPage((result) => {
      setFindMatches(result.matches);
      setFindActive(result.activeMatchOrdinal);
    });
    return stop;
  }, []);

  useEffect(() => {
    if (!findOpen) return;
    const text = findText.trim();
    if (!text) {
      void window.nodus.browserStopFindInPage('clearSelection');
      setFindMatches(0);
      setFindActive(0);
      return;
    }
    void window.nodus.browserFindInPage(text, { findNext: false, matchCase: findCaseSensitive });
  }, [findText, findCaseSensitive, findOpen, active?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const cmd = event.metaKey || event.ctrlKey;
      // The twin of the main-process handler in electron/browser/tabs.ts: that one
      // catches Cmd/Ctrl+T while a page has focus, this one while the toolbar,
      // the tab strip or the address bar does. Either way, one new tab.
      if (cmd && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        void window.nodus.openBrowserTab('');
      } else if (cmd && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen((prev) => {
          const next = !prev;
          if (next) requestAnimationFrame(() => findInputRef.current?.select());
          else void window.nodus.browserStopFindInPage('clearSelection');
          return next;
        });
      } else if (findOpen && event.key === 'Escape') {
        event.preventDefault();
        setFindOpen(false);
        void window.nodus.browserStopFindInPage('clearSelection');
      } else if (findOpen && ((cmd && event.key.toLowerCase() === 'g') || event.key === 'F3')) {
        event.preventDefault();
        const forward = !event.shiftKey;
        void window.nodus.browserFindInPage(findText, { forward, findNext: true, matchCase: findCaseSensitive });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findOpen, findText, findCaseSensitive]);

  useEffect(() => {
    if (findOpen) requestAnimationFrame(() => findInputRef.current?.focus());
    else {
      void window.nodus.browserStopFindInPage('clearSelection');
      setFindText('');
      setFindMatches(0);
      setFindActive(0);
    }
  }, [findOpen]);

  // Follow the URL of whatever tab is active, unless the user is editing.
  useEffect(() => {
    if (omniboxFocused) return;
    setOmnibox(active?.url ?? '');
  }, [active?.url, omniboxFocused]);

  // Unlike every ordinary Nodus section, the active website is not inside this
  // renderer's <main>. Refresh Nodi's default Current view context whenever a
  // tab becomes active or finishes navigation, so chat sees the page the user
  // actually has open without requiring an explicit toolbar action first.
  useEffect(() => {
    if (!active || active.kind !== 'web' || active.loading || active.error) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void window.nodus.syncBrowserNodiContext();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active?.id, active?.url, active?.title, active?.loading, active?.error]);

  /**
   * Report the rectangle the page should occupy.
   *
   * getBoundingClientRect() reports renderer CSS pixels. The main process turns
   * them into the native window's DIP coordinates using the host renderer zoom,
   * then rounds them so a fractional rectangle cannot leave a sub-pixel seam.
   */
  const publishViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const next = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const previous = publishedViewportRef.current;
    if (previous && previous.x === next.x && previous.y === next.y
      && previous.width === next.width && previous.height === next.height) return;
    publishedViewportRef.current = next;
    void window.nodus.setBrowserViewport(next);
  }, []);

  // Parent commits include sidebar width/collapse changes. Publish their new
  // geometry before paint, including moves that do not resize the viewport.
  useLayoutEffect(() => { publishViewport(); });

  useLayoutEffect(() => {
    publishViewport();
    const element = viewportRef.current;
    if (!element) return;
    // ResizeObserver already batches layout changes before paint. Scheduling
    // another rAF here left the native page at its old bounds for a full frame.
    const observer = new ResizeObserver(publishViewport);
    observer.observe(element);
    window.addEventListener('resize', publishViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publishViewport);
    };
  }, [publishViewport]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    const result = await window.nodus.submitBrowserOmnibox(omnibox);
    if (result.kind === 'blocked') {
      setRefusal(t('Nodus Browser no abre direcciones de tipo «{scheme}».').replace('{scheme}', result.scheme));
    } else if (result.kind === 'external') {
      setRefusal(t('Esa dirección se abre fuera de Nodus.'));
    }
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // The native context menu cannot open a React dialog itself, so it asks.
  useEffect(() => window.nodus.onBrowserActionRequested((action) => {
    if (action === 'addToLibrary') void addToLibrary();
    else if (action === 'addBookmark') void addBookmark();
    else if (action === 'askNodiPage') void askNodi('page');
  }));

  const loading = Boolean(active?.loading);

  const addToLibrary = async () => {
    setPanel(null);
    setCaptureOpen(true);
    setCapture(null);
    setCaptureError(null);
    setBusy(true);
    setNotice(null);
    try {
      const preview = await window.nodus.captureBrowserPage();
      if (!preview) { setCaptureError(t('Esta página no ofrece nada que se pueda guardar.')); return; }
      setCapture(preview);
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addBookmark = async (parentId: string | null = null) => {
    setPanel(null); setNotice(null);
    try {
      const candidate = await window.nodus.getCurrentBrowserBookmarkCandidate();
      if (!candidate) { setNotice(t('Solo se pueden guardar páginas web HTTP o HTTPS.')); return; }
      if (candidate.existingId) { setNotice(t('Esta página ya está guardada en Nodus Bookmarks.')); return; }
      setReturnToBookmarksManager(false);
      setBookmarkEditor({ mode: 'create', candidate, parentId });
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createManualBookmark = (parentId: string | null) => {
    setReturnToBookmarksManager(false);
    setBookmarkEditor({
      mode: 'create', parentId,
      candidate: { title: '', url: 'https://', description: '', faviconDataUrl: null, existingId: null },
    });
  };

  const editFromBookmarksManager = (target: BookmarkEditorTarget) => {
    // Only one Browser overlay may own native-view visibility at a time. Keeping
    // the manager mounted behind the editor allowed the first cleanup to reveal
    // the hostile WebContents over the remaining modal.
    setBookmarksManager(false);
    setReturnToBookmarksManager(true);
    setBookmarkEditor(target);
  };

  const askNodi = async (about: 'page' | 'selection') => {
    setPanel(null);
    try {
      // Match quoting from readers: an explicit Ask action is also permission
      // to bring Nodi back when the companion is currently disabled.
      const settings = await window.nodus.getSettings();
      if (!settings.mascotEnabled) await window.nodus.updateSettings({ mascotEnabled: true });
      const ok = about === 'page'
        ? await window.nodus.askNodiAboutBrowserPage()
        : await window.nodus.askNodiAboutBrowserSelection();
      setNotice(ok
        ? (about === 'page' ? t('Nodi ya tiene esta página como contexto.') : t('Nodi ya tiene la selección.'))
        : t('No había nada que enviar.'));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restartBrowser = async (confirmed = false) => {
    setPanel(null);
    setRestarting(true);
    setNotice(null);
    try {
      const result = await window.nodus.restartNodusBrowser(confirmed);
      if (result.requiresConfirmation) {
        setRestartWarning(result);
        return;
      }
      setRestartWarning(null);
      setNotice(t('Nodus Browser se ha reiniciado.'));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="nodus-browser">
      <BrowserTabStrip
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={(id) => void window.nodus.activateBrowserTab(id)}
        onClose={(id) => void window.nodus.closeBrowserTab(id)}
        onNew={() => void window.nodus.openBrowserTab('')}
      />

      <div data-testid="browser-toolbar" className="flex items-center gap-1 border-b border-neutral-300 px-2 py-1.5 dark:border-neutral-800">
        <ToolbarButton
          icon="chevronLeft"
          label={t('Atrás')}
          disabled={!active?.canGoBack}
          // Cmd/Ctrl-click and middle-click mean "that destination, new tab" in
          // every browser, and leave this tab exactly where it is.
          onClick={(event) => void (opensInNewTab(event)
            ? window.nodus.openBrowserHistoryNeighbourTab('back')
            : window.nodus.browserGoBack())}
        />
        <ToolbarButton
          icon="chevronRight"
          label={t('Adelante')}
          disabled={!active?.canGoForward}
          onClick={(event) => void (opensInNewTab(event)
            ? window.nodus.openBrowserHistoryNeighbourTab('forward')
            : window.nodus.browserGoForward())}
        />
        <ToolbarButton
          icon={loading ? 'stop' : 'refresh'}
          label={loading ? t('Detener') : t('Recargar')}
          onClick={() => void (loading ? window.nodus.browserStop() : window.nodus.browserReload())}
        />
        <ToolbarButton
          icon="home"
          label={t('Inicio')}
          onClick={() => void window.nodus.browserGoHome()}
        />

        <form className="flex min-w-0 flex-1 items-center" onSubmit={submit}>
          <div data-testid="browser-omnibox-shell" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-900">
            <SecurityIndicator url={active?.url ?? ''} error={Boolean(active?.error)} />
            <input
              data-testid="browser-omnibox"
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none dark:text-neutral-200"
              value={omnibox}
              spellCheck={false}
              placeholder={t('Busca o escribe una dirección')}
              onChange={(event) => setOmnibox(event.target.value)}
              onFocus={(event) => { setOmniboxFocused(true); event.target.select(); }}
              onBlur={() => setOmniboxFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOmnibox(active?.url ?? '');
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              data-testid="browser-add-bookmark"
              title={activeBookmark ? t('Editar') : t('Añadir marcador')}
              aria-label={activeBookmark ? t('Editar') : t('Añadir marcador')}
              disabled={active?.kind !== 'web'}
              onClick={() => {
                if (activeBookmark) {
                  setReturnToBookmarksManager(false);
                  setBookmarkEditor({ mode: 'edit', bookmark: activeBookmark });
                  return;
                }
                void addBookmark();
              }}
              className="-mr-1 shrink-0 rounded-md border-l border-neutral-200 p-1.5 pl-2.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-35 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <Icon name={activeBookmark ? 'bookmarkFill' : 'bookmark'} size={16} />
            </button>
          </div>
        </form>

        <div className="mx-0.5 flex items-center justify-center">
          <ToolbarButton
            imageSrc={connectorIcon}
            label="Nodus Connector"
            disabled={active?.kind !== 'web' || busy}
            busy={busy && captureOpen}
            dataTestId="browser-connector-button"
            onClick={() => void addToLibrary()}
          />
        </div>

        <div>
          <ToolbarButton
            icon="bookmarkFill"
            label="Nodus Bookmarks"
            dataTestId="browser-bookmarks-manager-button"
            onClick={() => { setPanel(null); setBookmarksManager(true); }}
          />
        </div>

        <div>
          <ToolbarButton
            icon="search"
            label={t('Buscar en la página')}
            dataTestId="browser-find-button"
            active={findOpen}
            onClick={() => setFindOpen((v) => !v)}
          />
        </div>

        <div>
          <ToolbarButton
            icon="clock"
            label="Browsing History"
            dataTestId="browser-history-button"
            onClick={() => { setPanel(null); setHistoryManager(true); }}
          />
        </div>

        <div>
          <ToolbarButton
            icon="menu"
            label={t('Acciones de Nodus')}
            disabled={busy}
            dataTestId="browser-actions"
            onClick={() => setPanel((current) => (current === 'actions' ? null : 'actions'))}
          />
        </div>

        <div className="relative">
          <ToolbarButton
            icon="download"
            label={t('Descargas')}
            dataTestId="browser-downloads"
            onClick={() => setPanel((current) => (current === 'downloads' ? null : 'downloads'))}
          />
          {downloads.length > 0 && <span className="header-action-badge">{downloads.length}</span>}
        </div>

        <div>
          <ToolbarButton
            icon="rotateCcw"
            label={t('Reiniciar Nodus Browser')}
            disabled={restarting}
            dataTestId="browser-restart"
            onClick={() => void restartBrowser(false)}
          />
        </div>

        <div>
          <ToolbarButton
            icon="settings"
            label={t('Configuración del navegador')}
            dataTestId="browser-settings"
            onClick={() => setPanel((current) => (current === 'settings' ? null : 'settings'))}
          />
        </div>
      </div>

      {findOpen && (
        <div data-testid="browser-find-bar" className="flex items-center gap-2 border-b border-neutral-300 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/95">
          <Icon name="search" size={14} className="shrink-0 text-neutral-500" />
          <input
            ref={findInputRef}
            data-testid="browser-find-input"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
            value={findText}
            placeholder={t('Buscar en la página…')}
            onChange={(event) => setFindText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void window.nodus.browserFindInPage(findText, { forward: !event.shiftKey, findNext: true, matchCase: findCaseSensitive });
              } else if (event.key === 'Escape') {
                setFindOpen(false);
              }
            }}
          />
          <span data-testid="browser-find-status" className="shrink-0 text-xs tabular-nums text-neutral-500">
            {findMatches ? `${findActive} / ${findMatches}` : findText.trim() ? t('Sin resultados') : ''}
          </span>
          <button data-testid="browser-find-prev" className="rounded p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => void window.nodus.browserFindInPage(findText, { forward: false, findNext: true, matchCase: findCaseSensitive })} title={t('Anterior')}><Icon name="chevronUp" size={14} /></button>
          <button data-testid="browser-find-next" className="rounded p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => void window.nodus.browserFindInPage(findText, { forward: true, findNext: true, matchCase: findCaseSensitive })} title={t('Siguiente')}><Icon name="chevronDown" size={14} /></button>
          <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400"><input type="checkbox" checked={findCaseSensitive} onChange={(event) => setFindCaseSensitive(event.target.checked)} />Aa</label>
          <button className="rounded p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => setFindOpen(false)} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
        </div>
      )}

      {panel === 'downloads' && (
        <DownloadsPanel
          downloads={downloads}
          onClose={() => setPanel(null)}
          onImported={(title: string) => { setPanel(null); setNotice(t('Guardado en la Biblioteca: {title}').replace('{title}', title)); }}
          onError={(message: string) => { setPanel(null); setNotice(message); }}
        />
      )}
      {panel === 'settings' && <BrowserQuickSettings onClose={() => setPanel(null)} />}
      {panel === 'actions' && (
        <div data-testid="browser-actions-menu" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-300 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60">
          <MenuItem icon="book" label={t('Añadir a la Biblioteca')} onClick={() => void addToLibrary()} />
          <MenuItem icon="bookmark" label={t('Añadir marcador')} onClick={() => void addBookmark()} />
          <MenuItem icon="bookmarkFill" label="Nodus Bookmarks" onClick={() => { setPanel(null); setBookmarksManager(true); }} />
          <MenuItem icon="chat" label={t('Preguntar a Nodi sobre esta página')} onClick={() => void askNodi('page')} />
          <MenuItem icon="quote" label={t('Preguntar a Nodi sobre la selección')} onClick={() => void askNodi('selection')} />
          <MenuItem icon="copy" label={t('Copiar dirección')} onClick={() => { setPanel(null); void navigator.clipboard.writeText(active?.url ?? ''); }} />
          <MenuItem icon="external" label={t('Abrir en el navegador del sistema')} onClick={() => { setPanel(null); if (active?.url) void window.nodus.openExternal(active.url); }} />
          <button type="button" className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={() => setPanel(null)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {refusal && (
        <div
          data-testid="browser-refusal"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300"
        >
          {refusal}
        </div>
      )}

      {restartWarning?.requiresConfirmation && (
        <BrowserRestartWarning
          status={restartWarning}
          disabled={restarting}
          onCancel={() => setRestartWarning(null)}
          onConfirm={() => void restartBrowser(true)}
        />
      )}

      {notice && (
        <div
          data-testid="browser-notice"
          className="flex items-center gap-2 border-b border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300"
        >
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label={t('Descartar')} onClick={() => setNotice(null)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {downloads.length > 0 && (
        <DownloadsBar
          downloads={downloads}
          onImported={(title) => setNotice(t('Guardado en la Biblioteca: {title}').replace('{title}', title))}
          onError={(message) => setNotice(message)}
        />
      )}

      {permission && (
        <PermissionBar
          request={permission}
          onDecide={(granted, remember) =>
            void window.nodus.resolveBrowserPermission(permission.id, granted, remember)}
        />
      )}

      {auth && (
        <BrowserAuthBar
          request={auth}
          onSubmit={(username, password) =>
            void window.nodus.resolveBrowserAuth(auth.id, username, password)}
          onCancel={() => void window.nodus.cancelBrowserAuth(auth.id)}
        />
      )}

      {/* Main positions the native page here. While app overlays are open, the
          overlay guard keeps a frozen image inside this same rectangle. */}
      <div ref={viewportRef} data-browser-viewport className="relative min-h-0 flex-1">
        {active?.kind === 'bookmarks' && (
          <NodusBookmarksPage
            store={bookmarks}
            onEditBookmark={(bookmark) => { setReturnToBookmarksManager(false); setBookmarkEditor({ mode: 'edit', bookmark }); }}
            onNewBookmark={createManualBookmark}
            onNewFolder={() => setBookmarksManager(true)}
            onNotice={setNotice}
          />
        )}
        {active?.kind === 'atlas' && (
          <NodusResearchAtlasPage store={bookmarks} onSave={(candidate) => { setReturnToBookmarksManager(false); setBookmarkEditor({ mode: 'create', candidate }); }} />
        )}
        {active?.error && (active.error.kind === 'certificate'
          ? <CertificateInterstitial tab={active} />
          : active.error.kind === 'google-sign-in'
            ? <GoogleSignInNotice tab={active} />
            : <BrowserErrorPane tab={active} />)}
      </div>

      {captureOpen && (
        <BrowserCaptureModal
          preview={capture?.request ?? null}
          warnings={capture?.warnings ?? []}
          candidates={capture?.candidates}
          loading={busy}
          loadError={captureError}
          onRetry={() => void addToLibrary()}
          onClose={() => { setCaptureOpen(false); setCapture(null); setCaptureError(null); }}
          onSaved={(result) => {
            setNotice(t('Guardado en la Biblioteca: {title}').replace('{title}', result.title));
          }}
          onOpenInNodus={(itemId) => {
            setCaptureOpen(false);
            setCapture(null);
            window.dispatchEvent(new CustomEvent('nodus:open-library-item', { detail: { itemId } }));
          }}
          onOpenSettings={() => {
            setCaptureOpen(false);
            setCapture(null);
            setPanel('settings');
          }}
        />
      )}
      {bookmarksManager && (
        <BrowserBookmarksManager
          store={bookmarks}
          onClose={() => setBookmarksManager(false)}
          onEdit={(bookmark) => editFromBookmarksManager({ mode: 'edit', bookmark })}
          onCreate={(parentId) => editFromBookmarksManager({
            mode: 'create', parentId,
            candidate: { title: '', url: 'https://', description: '', faviconDataUrl: null, existingId: null },
          })}
          onNotice={setNotice}
        />
      )}
      {historyManager && (
        <BrowserHistoryManager onClose={() => setHistoryManager(false)} onNotice={setNotice} />
      )}
      {bookmarkEditor && (
        <BrowserBookmarkModal
          target={bookmarkEditor}
          store={bookmarks}
          onClose={() => { setBookmarkEditor(null); if (returnToBookmarksManager) setBookmarksManager(true); }}
          onSaved={(next, duplicate) => {
            setBookmarks(next); setBookmarkEditor(null);
            if (returnToBookmarksManager) setBookmarksManager(true);
            setNotice(duplicate ? t('Esta página ya estaba guardada.') : t('Guardado en Nodus Bookmarks.'));
          }}
        />
      )}
    </div>
  );
}

/**
 * The permission prompt.
 *
 * Rendered as a BAR in the browser chrome, not as an overlay, and deliberately
 * so: it takes its own vertical space, which shrinks the rectangle reported to
 * the main process, so the page is moved down rather than covered. A page can
 * therefore neither hide this bar nor draw a convincing copy of it in the space
 * where it would appear.
 */
function PermissionBar({
  request, onDecide,
}: { request: PendingBrowserPermission; onDecide: (granted: boolean, remember: boolean) => void }) {
  const what = permissionLabel(request);
  return (
    <div
      data-testid="browser-permission-bar"
      className="flex flex-wrap items-center gap-2 border-b border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-100"
    >
      <Icon name="alert" size={14} className="shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{request.origin}</span>{' '}{what}
      </span>
      {/* Deny comes first, and is the button that reads as the safe default. */}
      <button type="button" className="btn btn-ghost border border-neutral-300 py-0.5 dark:border-neutral-700" onClick={() => onDecide(false, false)}>
        {t('Denegar')}
      </button>
      <button type="button" className="btn btn-ghost border border-neutral-300 py-0.5 dark:border-neutral-700" onClick={() => onDecide(false, true)}>
        {t('Denegar siempre')}
      </button>
      <button type="button" className="btn btn-ghost border border-indigo-500/60 py-0.5" onClick={() => onDecide(true, false)}>
        {t('Permitir')}
      </button>
      <button type="button" className="btn btn-ghost border border-indigo-500/60 py-0.5" onClick={() => onDecide(true, true)}>
        {t('Permitir siempre')}
      </button>
    </div>
  );
}

/** Plain language for what the site is asking for. */
function permissionLabel(request: PendingBrowserPermission): string {
  if (request.permission === 'media') {
    const wantsVideo = request.mediaTypes.includes('video');
    const wantsAudio = request.mediaTypes.includes('audio');
    if (wantsVideo && wantsAudio) return t('quiere usar la cámara y el micrófono.');
    if (wantsVideo) return t('quiere usar la cámara.');
    if (wantsAudio) return t('quiere usar el micrófono.');
    return t('quiere usar la cámara o el micrófono.');
  }
  if (request.permission === 'geolocation') return t('quiere conocer tu ubicación.');
  return t('pide un permiso adicional.');
}

/**
 * The HTTP authentication prompt.
 *
 * Rendered as a BAR in the browser chrome, like the permission prompt and for
 * the same reason: it takes its own vertical space, so the native page is moved
 * down instead of covered, and a site can neither hide it nor draw a convincing
 * copy where it appears. The host shown is Chromium's `authInfo`, not page text.
 */
function BrowserAuthBar({
  request, onSubmit, onCancel,
}: {
  request: PendingBrowserAuth;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    usernameRef.current?.focus();
  }, [request.id]);
  const field = 'w-40 rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-900 outline-none focus:border-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';
  return (
    <form
      data-testid="browser-auth-bar"
      className="flex flex-wrap items-center gap-2 border-b border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-100"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(username, password);
      }}
    >
      <Icon name="lock" size={14} className="shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        {request.isProxy && <>{t('Proxy')}{' · '}</>}
        <span className="font-semibold">{request.host}</span>{' '}{t('pide usuario y contraseña.')}
        {request.realm && <span className="block truncate text-[11px] opacity-70">{request.realm}</span>}
      </span>
      <label className="flex items-center">
        <span className="sr-only">{t('Usuario')}</span>
        <input
          ref={usernameRef}
          data-testid="browser-auth-username"
          className={field}
          value={username}
          autoComplete="username"
          spellCheck={false}
          placeholder={t('Usuario')}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="flex items-center">
        <span className="sr-only">{t('Contraseña')}</span>
        <input
          data-testid="browser-auth-password"
          className={field}
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder={t('Contraseña')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="button" className="btn btn-ghost border border-neutral-300 py-0.5 dark:border-neutral-700" onClick={onCancel}>
        {t('Cancelar')}
      </button>
      <button type="submit" className="btn btn-ghost border border-indigo-500/60 py-0.5">
        {t('Iniciar sesión')}
      </button>
    </form>
  );
}

function ToolbarButton({
  icon, imageSrc, label, onClick, disabled, busy, dataTestId, active,
}: {
  icon?: string; imageSrc?: string; label: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean; busy?: boolean; dataTestId?: string; active?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={dataTestId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      // Middle-click never fires `click`. Back and Forward are the buttons where
      // it means "open that destination in a new tab", so it has to be heard.
      onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClick(event); } }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'}`}
    >
      {imageSrc
        ? <img src={imageSrc} alt="" className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} />
        : icon ? <Icon name={icon} size={16} /> : null}
    </button>
  );
}

/**
 * A trusted chrome bar, never website content. Main has already refused the
 * first restart request, so this confirmation cannot race past live activity.
 */
function BrowserRestartWarning({
  status, disabled, onCancel, onConfirm,
}: {
  status: BrowserRestartResult;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const affected: string[] = [];
  if (status.activeDownloads > 0) {
    affected.push(t('{n} descarga(s) activa(s)').replace('{n}', String(status.activeDownloads)));
  }
  if (status.mediaSessions > 0) {
    affected.push(t('{n} sesión(es) multimedia').replace('{n}', String(status.mediaSessions)));
  }
  return (
    <div
      data-testid="browser-restart-warning"
      className="flex flex-wrap items-center gap-2 border-b border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <Icon name="alert" size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {t('Reiniciar interrumpirá {activity}. Las sesiones y preferencias persistentes se conservarán.')
          .replace('{activity}', affected.join(` ${t('y')} `))}
      </span>
      <button
        type="button"
        className="btn btn-ghost border border-neutral-300 py-0.5 dark:border-neutral-700"
        disabled={disabled}
        onClick={onCancel}
      >
        {t('Cancelar')}
      </button>
      <button
        type="button"
        data-testid="browser-restart-confirm"
        className="btn btn-ghost border border-amber-500/70 py-0.5"
        disabled={disabled}
        onClick={onConfirm}
      >
        {t('Reiniciar Nodus Browser')}
      </button>
    </div>
  );
}

/**
 * The padlock.
 *
 * Chromium validates certificates; Nodus only reflects the verdict. The tooltip
 * says exactly that, because a padlock drawn by the application implies the
 * application checked something, and this one did not.
 */
function SecurityIndicator({ url, error }: { url: string; error: boolean }) {
  const secure = url.startsWith('https://');
  const tone = error ? 'text-red-400' : secure ? 'text-emerald-500' : 'text-neutral-500';
  const label = error
    ? t('La conexión no es segura')
    : secure
      ? t('Conexión cifrada, verificada por Chromium')
      : t('Sin cifrar');
  return (
    <span title={`${label} · ${t('Nodus no valida certificados por su cuenta.')}`} className={`shrink-0 ${tone}`}>
      <Icon name={secure && !error ? 'lock' : 'alert'} size={13} />
    </span>
  );
}

/**
 * One width for every tab, and it never changes.
 *
 * A strip of tabs reads as a row of slots, not as a list of headings: equal
 * widths are what let the eye return to "the fourth tab", and what stops one
 * long page title from pushing every other tab sideways. So a tab is never
 * narrowed to fit and never widened to show more — a strip with more tabs than
 * room is scrolled, which is what the arrows at either end are for. 12rem is a
 * title, a favicon and a close button with room to breathe; the rest truncates.
 */
const TAB_WIDTH_CLASS = 'w-48';

/**
 * How many tabs one arrow click brings in.
 *
 * Aligned to whole tabs rather than to a fraction of the viewport. With a cap of
 * twelve tabs the strip overflows by less than one viewport, so a
 * viewport-sized step lands on the last tab in a single click — the arrows stop
 * reading as a way to walk the strip, and the last click moves it by a couple of
 * pixels while still lighting the arrow. Three tabs keep the tab being read on
 * screen and reveal the next ones in the order they were opened.
 */
const TAB_SCROLL_STEP_TABS = 3;

/**
 * The tab strip.
 *
 * Tabs are cheap because only the ACTIVE one is attached to the window's content
 * view: the rest keep their WebContents — so a login, a scroll position and
 * playing audio all survive — but are detached, so Chromium neither composites
 * nor paints them. Closing one destroys its WebContents outright.
 *
 * The cap is deliberate and visible. Each tab is a renderer process, and this is
 * a research browser rather than a replacement for one.
 */
function BrowserTabStrip({
  tabs, activeTabId, onSelect, onClose, onNew,
}: {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  /**
   * Which arrows have somewhere to go, measured from the DOM rather than
   * predicted from a tab count. Both ends can be true at once (in the middle of
   * a long strip), and both go false the moment the strip fits.
   */
  const measureOverflow = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // A pixel of slack at each end: smooth scrolling stops a hair short of the
    // extreme, and an arrow that stays lit over a strip with nothing left to
    // show is a control that lies about what a click will do.
    const max = strip.scrollWidth - strip.clientWidth;
    setOverflow((previous) => {
      const left = strip.scrollLeft > 1;
      const right = strip.scrollLeft < max - 1;
      return previous.left === left && previous.right === right ? previous : { left, right };
    });
  }, []);

  // The strip's width changes without a scroll event: a tab opens, closes or
  // renames itself, or the window is resized. Every one of those is observed.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(strip);
    for (const child of Array.from(strip.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measureOverflow, tabs.length]);

  // The selected tab is the one that has to be on screen. Activation, a new tab
  // and a title that grew all change which tab that is.
  useEffect(() => {
    const selected = stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  if (tabs.length === 0) return null;
  const full = tabs.length >= MAX_BROWSER_TABS;

  const scrollByStep = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    // Measured as the distance between two tabs — their width plus the gap —
    // rather than read from the constant, so a step can never disagree with the
    // layout it is moving.
    const [first, second] = Array.from(strip.children) as HTMLElement[];
    const pitch = second && first ? second.offsetLeft - first.offsetLeft : 0;
    const step = pitch > 0 ? pitch * TAB_SCROLL_STEP_TABS : strip.clientWidth * 0.8;
    strip.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <div data-testid="browser-tab-bar" className="library-workspace-tabs flex items-start gap-1">
      {overflow.left && <TabStripArrow direction={-1} onClick={() => scrollByStep(-1)} />}
      <div
        ref={stripRef}
        role="tablist"
        data-testid="browser-tab-strip"
        onScroll={measureOverflow}
        className="browser-tab-strip-scroll flex h-9 min-w-0 flex-1 items-end gap-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected}
              data-testid="browser-tab"
              className={`group flex ${TAB_WIDTH_CLASS} shrink-0 library-workspace-tab ${selected ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="library-workspace-tab-main"
                onClick={() => onSelect(tab.id)}
                title={tab.url || tab.title}
              >
                {tab.faviconDataUrl
                  ? <img src={tab.faviconDataUrl} alt="" className="h-3.5 w-3.5 shrink-0" />
                  : <Icon name="globe" size={13} className="shrink-0 opacity-50" />}
                <span className="truncate">{tab.title || tab.url || t('Pestaña nueva')}</span>
                {/* A muted-but-playing tab is otherwise invisible in the strip. */}
                {tab.audible && <Icon name="volume" size={11} className="shrink-0 opacity-60" />}
              </button>
              <button
                type="button"
                aria-label={t('Cerrar pestaña')}
                title={t('Cerrar pestaña')}
                className="library-workspace-tab-close"
                onClick={() => onClose(tab.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {/* The arrows and the new-tab button sit outside the scroll viewport, so
          they hold their place while the tabs move under them. */}
      {overflow.right && <TabStripArrow direction={1} onClick={() => scrollByStep(1)} />}
      <button
        type="button"
        aria-label={t('Pestaña nueva')}
        title={full ? t('Nodus Browser admite hasta {n} pestañas.').replace('{n}', String(MAX_BROWSER_TABS)) : t('Pestaña nueva')}
        disabled={full}
        onClick={onNew}
        data-testid="browser-new-tab"
        className="shrink-0 self-center rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-900"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

/**
 * One end of the strip, drawn only while that end has tabs left to reveal.
 *
 * Rendered conditionally rather than kept in place and dimmed: an arrow that is
 * always there is an arrow the eye stops reading, and the question it answers —
 * "is there more?" — is exactly the one a permanently visible control fails to
 * answer.
 */
function TabStripArrow({ direction, onClick }: { direction: -1 | 1; onClick: () => void }) {
  const label = direction < 0
    ? t('Desplazar las pestañas a la izquierda')
    : t('Desplazar las pestañas a la derecha');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={direction < 0 ? 'browser-tab-scroll-left' : 'browser-tab-scroll-right'}
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 self-center items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:active:bg-neutral-800"
    >
      <Icon name={direction < 0 ? 'chevronLeft' : 'chevronRight'} size={14} />
    </button>
  );
}

/**
 * A certificate failure, told apart from every other kind.
 *
 * This is a separate component rather than another row in the heading map
 * because it means something categorically different. "Site not found" is an
 * accident; an invalid certificate can mean the connection is being intercepted,
 * and a user who reads the two in the same grey pane will treat them the same.
 *
 * There is no "proceed anyway", by design. Nodus performs no certificate
 * validation of its own — Chromium does — and offering a bypass here would be
 * offering to overrule a verdict Nodus is in no position to second-guess.
 */
function CertificateInterstitial({ tab }: { tab: BrowserTabState }) {
  const error = tab.error;
  if (!error) return null;
  let host = error.url;
  try { host = new URL(error.url).host || error.url; } catch { /* show the raw target */ }
  return (
    <div
      data-testid="browser-certificate-interstitial"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-50 px-8 text-center dark:bg-red-950/25"
    >
      <Icon name="lock" size={28} className="text-red-400" />
      <h2 className="text-base font-semibold text-red-800 dark:text-red-200">{t('La conexión con este sitio no es privada')}</h2>
      <p className="max-w-md text-sm text-neutral-700 dark:text-neutral-300">
        {t('Chromium no pudo verificar que «{host}» sea quien dice ser. Puede tratarse de un certificado caducado o mal configurado, o de que alguien esté interceptando la conexión.').replace('{host}', host)}
      </p>
      {error.description && (
        <p className="max-w-md font-mono text-[11px] text-neutral-500">{error.description}</p>
      )}
      <p className="max-w-md text-xs text-neutral-500">
        {t('Nodus Browser no ofrece continuar de todos modos: no valida certificados por su cuenta, así que no puede contradecir ese veredicto.')}
      </p>
      <button
        type="button"
        className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
        onClick={() => void window.nodus.browserGoBack()}
      >
        {t('Volver atrás')}
      </button>
    </div>
  );
}

/**
 * Google sign-in, which no embedded browser is allowed to complete.
 *
 * Its own pane rather than a row in BrowserErrorPane, because it is not a
 * failure: nothing went wrong, the destination is simply somewhere Nodus is not
 * permitted to go. That difference decides the buttons. A Retry here would be a
 * lie — the second attempt fails exactly like the first — so the primary action
 * is the only one that actually works, handing the address to the real browser.
 *
 * The copy says plainly that this is Google's rule and not a Nodus defect,
 * because the alternative is a user who concludes the browser is broken. It also
 * names the one workaround worth knowing: sites that offer a password or a
 * magic-link login do work here, since those never touch Google's OAuth flow.
 */
function GoogleSignInNotice({ tab }: { tab: BrowserTabState }) {
  const error = tab.error;
  if (!error) return null;

  const site = error.siteUrl ?? null;
  let siteHost = '';
  try { siteHost = site ? new URL(site).host : ''; } catch { siteHost = ''; }

  return (
    <div
      data-testid="browser-google-signin-notice"
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-white px-8 py-10 text-center dark:bg-neutral-950"
    >
      <Icon name="external" size={28} className="shrink-0 text-neutral-600" />
      <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
        {t('Google no permite iniciar sesión desde un navegador integrado')}
      </h2>
      <p className="max-w-md text-sm text-neutral-700 dark:text-neutral-300">
        {t('No es un fallo de Nodus: Google rechaza el inicio de sesión desde cualquier navegador incrustado en otra aplicación.')}
      </p>

      {/*
        The consequence goes ABOVE the button and in full contrast, not in a grey
        footnote under it. Buried, it reads as a formality and the user goes to
        their browser expecting to come back signed in — which never happens, and
        the trip is wasted before they find out.
      */}
      <p className="max-w-md rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        {site
          ? tx('Ojo: si entras en tu navegador, la sesión se queda allí. Seguirás sin haber iniciado sesión en {host} dentro de Nodus, porque las cookies no se comparten entre navegadores.', { host: siteHost })
          : t('Ojo: si entras en tu navegador, la sesión se queda allí. Seguirás sin haber iniciado sesión en Google dentro de Nodus, porque las cookies no se comparten entre navegadores.')}
      </p>

      {site ? (
        <>
          <p className="max-w-md text-sm text-neutral-700 dark:text-neutral-300">
            {tx('Si {host} admite entrar con contraseña o con un enlace por correo, esa vía sí funciona aquí dentro, y Nodus recordará la sesión.', { host: siteHost })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
              onClick={() => void window.nodus.browserDismissError()}
            >
              {t('Volver e intentar con contraseña')}
            </button>
            {/*
              Opens the SITE, never the half-finished accounts.google.com URL: a
              federated login has to start and finish in one browser, and handing
              over the middle of the flow is what produced Firebase's
              auth/missing-initial-state.
            */}
            <button
              type="button"
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
              onClick={() => void window.nodus.openExternal(site)}
            >
              {tx('Usar {host} en mi navegador', { host: siteHost })}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
            onClick={() => void window.nodus.browserDismissError()}
          >
            {t('Volver atrás')}
          </button>
          <button
            type="button"
            className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
            onClick={() => void window.nodus.openExternal(error.url)}
          >
            {t('Abrir en tu navegador')}
          </button>
        </div>
      )}

      <p className="max-w-md text-xs text-neutral-500">
        {t('Para que Nodus lea tu Gmail o tu Drive haría falta otra cosa: conectar la cuenta desde Ajustes, que es la vía que Google sí admite para aplicaciones de escritorio. Todavía no está disponible.')}
      </p>
    </div>
  );
}

/** Rendered by React, over the hidden native view, when a navigation failed. */
function BrowserErrorPane({ tab }: { tab: BrowserTabState }) {
  const error = tab.error;
  if (!error) return null;
  const heading: Record<string, string> = {
    dns: t('No se encontró el sitio'),
    offline: t('Sin conexión a internet'),
    refused: t('El sitio rechazó la conexión'),
    timeout: t('El sitio tardó demasiado en responder'),
    'blocked-scheme': t('Nodus Browser no abre este tipo de dirección'),
    crashed: t('Esta página dejó de responder'),
    'google-sign-in': t('Google no permite iniciar sesión desde un navegador integrado'),
    unknown: t('No se pudo cargar la página'),
    none: '',
  };
  return (
    <div
      data-testid="browser-error"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-8 text-center dark:bg-neutral-950"
    >
      <Icon name="alert" size={28} className="text-neutral-600" />
      <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">{heading[error.kind] ?? heading.unknown}</h2>
      <p className="max-w-md break-all text-xs text-neutral-500">{error.url}</p>
      {error.description && <p className="max-w-md text-xs text-neutral-600">{error.description}</p>}
      <button
        type="button"
        className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
        onClick={() => void window.nodus.browserReload()}
      >
        {t('Reintentar')}
      </button>
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Icon name={icon} size={13} className="shrink-0 opacity-70" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/**
 * Downloads.
 *
 * A strip rather than an overlay, for the same reason as the permission bar: it
 * takes its own space and pushes the page down, so nothing a site draws can be
 * confused with it.
 *
 * Importing is always a click. Nodus never files a download on its own, and
 * never opens one — a browser that launches what it just fetched is one step
 * from being the delivery mechanism.
 */
function DownloadsBar({
  downloads, onImported, onError,
}: {
  downloads: BrowserDownloadView[];
  onImported: (title: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div data-testid="browser-downloads" className="flex flex-col gap-1 border-b border-neutral-300 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/50">
      {downloads.map((download) => (
        <div key={download.id} className="flex items-center gap-2 text-xs">
          <Icon name="download" size={13} className="shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{download.filename}</span>
          <span className="shrink-0 text-neutral-500">{describeDownload(download)}</span>

          {download.state === 'completed' && download.importable && (
            <button
              type="button"
              className="btn btn-ghost shrink-0 border border-indigo-500/50 px-2 py-0.5"
              onClick={() => void window.nodus
                .importBrowserDownload(download.id, download.filename.replace(/\.[^.]+$/, ''))
                .then((result) => onImported(result.title))
                .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))}
            >
              {t('Importar a la Biblioteca')}
            </button>
          )}

          {download.state === 'progressing' || download.state === 'paused' ? (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label={t('Cancelar')}
              onClick={() => void window.nodus.cancelBrowserDownload(download.id)}
            >
              <Icon name="x" size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
              aria-label={t('Descartar')}
              onClick={() => void window.nodus.dismissBrowserDownload(download.id)}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function describeDownload(download: BrowserDownloadView): string {
  if (download.state === 'completed') return t('Descargado');
  if (download.state === 'cancelled') return t('Cancelado');
  if (download.state === 'interrupted') return t('Interrumpido');
  if (download.totalBytes > 0) {
    return `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`;
  }
  return t('Descargando…');
}

/**
 * Recent downloads.
 *
 * "Show in folder" reveals the file; it never opens it. That distinction is the
 * whole of Nodus's download safety posture — revealing hands the decision to the
 * user's file manager, opening executes whatever a website just sent.
 */
function DownloadsPanel({
  downloads, onClose, onImported, onError,
}: {
  downloads: BrowserDownloadView[];
  onClose: () => void;
  onImported: (title: string) => void;
  onError: (message: string) => void;
}) {
  const finished = downloads.some((entry) => entry.state !== 'progressing' && entry.state !== 'paused');
  return (
      <div data-testid="browser-downloads-panel" className="shrink-0 border-b border-neutral-300 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Descargas')}</p>
          <button type="button" className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        {downloads.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-neutral-500">{t('Todavía no hay descargas.')}</p>
        )}
        <div className="max-h-72 overflow-y-auto">
          {downloads.map((download) => (
            <div key={download.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Icon name="file" size={13} className="shrink-0 opacity-60" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={download.state !== 'completed'}
                title={download.state === 'completed' ? t('Mostrar en la carpeta') : undefined}
                onClick={() => void window.nodus.revealBrowserDownload(download.id).catch(() => undefined)}
              >
                <div className="truncate text-xs text-neutral-800 dark:text-neutral-200">{download.filename}</div>
                <div className="truncate text-[11px] text-neutral-500">{describeDownload(download)}</div>
              </button>
              {download.state === 'completed' && download.importable && (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 border border-indigo-500/50 px-1.5 py-0.5 text-[11px]"
                  onClick={() => void window.nodus
                    .importBrowserDownload(download.id, download.filename.replace(/\.[^.]+$/, ''))
                    .then((result) => onImported(result.title))
                    .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))}
                >
                  {t('A la Biblioteca')}
                </button>
              )}
            </div>
          ))}
        </div>
        {finished && (
          <button
            type="button"
            className="btn btn-ghost mt-1 w-full justify-center border border-neutral-300 py-1 text-xs dark:border-neutral-700"
            onClick={() => void window.nodus.clearBrowserDownloads()}
          >
            {t('Limpiar la lista')}
          </button>
        )}
      </div>
  );
}

/**
 * The settings a person changes while browsing, rather than in Settings.
 *
 * Home, new-tab and search defaults live here alongside one direct privacy
 * action. Fine-grained storage and per-site controls remain in Settings →
 * Nodus Browser, where there is room to explain them.
 */
function BrowserQuickSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  useEffect(() => { void window.nodus.getSettings().then(setSettings); }, []);

  // A native WebContentsView paints above React. Hide it while this trusted
  // confirmation is open so the dialog cannot appear behind the website.
  useEffect(() => {
    if (!confirmClearAll) return;
    void window.nodus.setBrowserOverlayVisible(true);
    return () => { void window.nodus.setBrowserOverlayVisible(false); };
  }, [confirmClearAll]);

  const patch = async (next: Partial<AppSettings>) => {
    await window.nodus.updateSettings(next);
    setSettings(await window.nodus.getSettings());
  };

  const clearAll = async () => {
    if (clearing) return;
    setClearing(true);
    setClearError(null);
    try {
      await window.nodus.clearAllBrowserData();
      setConfirmClearAll(false);
      onClose();
    } catch (cause) {
      setConfirmClearAll(false);
      setClearError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClearing(false);
    }
  };

  return (
      <div data-testid="browser-quick-settings" className="shrink-0 border-b border-neutral-300 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Configuración del navegador')}</p>
          <button type="button" className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-4">
        <div>
        <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Página de inicio')}</p>
        {(['start', 'bookmarks', 'blank', 'custom'] as const).map((mode) => (
          <label key={mode} className="mb-1 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
            <input
              type="radio"
              name="browser-home-mode"
              checked={settings?.browserHomeMode === mode}
              onChange={() => void patch({ browserHomeMode: mode })}
            />
            {mode === 'start' ? 'Research Atlas' : mode === 'bookmarks' ? 'Nodus Bookmarks' : mode === 'blank' ? t('Página en blanco') : t('Dirección personalizada')}
          </label>
        ))}
        {settings?.browserHomeMode === 'custom' && (
          <input
            className="input mt-1 w-full text-xs"
            placeholder="https://…"
            defaultValue={settings.browserHomeUrl}
            onBlur={(event) => void patch({ browserHomeUrl: event.target.value })}
          />
        )}
        </div>
        <div>
        <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Al abrir una pestaña nueva')}</p>
        {(['home', 'blank'] as const).map((mode) => (
          <label key={mode} className="mb-1 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
            <input
              type="radio"
              name="browser-newtab-mode"
              checked={settings?.browserNewTabMode === mode}
              onChange={() => void patch({ browserNewTabMode: mode })}
            />
            {mode === 'home' ? t('La página de inicio') : t('Página en blanco')}
          </label>
        ))}
        </div>
        <div>
        <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Buscador')}</p>
        <select
          className="input w-full text-xs"
          value={settings?.browserSearchEngine ?? 'google'}
          onChange={(event) => void patch({ browserSearchEngine: event.target.value as AppSettings['browserSearchEngine'] })}
        >
          <option value="google">Google</option>
          <option value="scholar">Google Scholar</option>
          <option value="bing">Bing</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="custom">{t('Personalizado')}</option>
        </select>
        {settings?.browserSearchEngine === 'custom' && (
          <input
            className="input mt-1 w-full text-xs"
            placeholder="https://ejemplo.org/buscar?q=%s"
            defaultValue={settings.browserSearchTemplate}
            onBlur={(event) => void patch({ browserSearchTemplate: event.target.value })}
          />
        )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t('Almacenamiento del navegador')}</p>
          <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">
            Cookies, site data, cache and Browsing History are cleared. Nodus Bookmarks is preserved.
          </p>
          <button
            type="button"
            data-testid="browser-quick-clear-all"
            className="btn btn-ghost w-full justify-center border border-red-500/50 px-2 py-1 text-xs text-red-600 dark:text-red-300"
            disabled={clearing}
            onClick={() => { setClearError(null); setConfirmClearAll(true); }}
          >
            {t('Borrar todos los datos de navegación')}
          </button>
          {clearError && <p role="alert" className="mt-1.5 text-[11px] text-red-600 dark:text-red-300">{clearError}</p>}
        </div>
        </div>
        {confirmClearAll && (
          <ConfirmModal
            danger
            title={t('¿Borrar todos los datos de navegación?')}
            message={
              <div className="space-y-2 text-sm">
                <p className="text-amber-500">{t('Borrar las cookies cerrará tu sesión en los sitios donde la tengas iniciada.')}</p>
                <p className="text-neutral-400">{t('También se cerrarán todas las pestañas abiertas del navegador.')}</p>
                <p className="text-neutral-400">Browsing History on this device will also be cleared.</p>
                <p className="text-indigo-400">Nodus Bookmarks will be preserved.</p>
              </div>
            }
            confirmLabel={t('Borrar')}
            onCancel={() => { if (!clearing) setConfirmClearAll(false); }}
            onConfirm={() => void clearAll()}
          />
        )}
      </div>
  );
}
