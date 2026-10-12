// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser IPC surface.
 *
 * Every channel here carries a sender check, which is a NEW invariant in this
 * codebase and the reason this file does not simply use `h()` and stop there.
 *
 * Until now Nodus had exactly one renderer — its own `file://` window — so
 * `ipcMain.handle` needed no sender validation: anything that could call a
 * channel was already trusted. Nodus Browser breaks that assumption by adding
 * WebContents that load arbitrary websites. Those pages get no bridge (see
 * electron/preload/browserPage.ts), so they cannot invoke these channels today;
 * `assertUiSender` is what keeps that true if a future edit ever gives a page a
 * preload with `ipcRenderer` on it. Defence in depth, deliberately redundant.
 */

import { dialogTitle } from '../dialogTitles';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcContext } from './context';
import {
  NODUS_BOOKMARKS_URL,
  NODUS_RESEARCH_ATLAS_START_URL,
  type BrowserRestartResult,
  type BrowserViewport,
} from '@shared/browser';
import type {
  BrowserBookmarkDraft,
  BrowserBookmarkFolderDraft,
  BrowserBookmarkNodeRef,
  BrowserBookmarkStore,
} from '@shared/browserBookmarks';
import type { BrowserHistoryStore } from '@shared/browserHistory';
import {
  browserBookmarksExportFileName,
  exportBrowserBookmarksHtml,
  exportBrowserBookmarksJson,
  findDuplicateBookmark,
  MAX_BOOKMARK_IMPORT_BYTES,
  mergeBrowserBookmarkStores,
  parseBrowserBookmarksHtml,
  parseBrowserBookmarksJson,
  sanitizeBookmarkUrl,
} from '@shared/browserBookmarks';
import { parseOmniboxInput } from '@shared/browserOmnibox';
import {
  cancelPermissionRequests,
  pendingPermissionRequest,
  resolvePermissionRequest,
  setPermissionPromptNotifier,
} from '../browser/permissionPrompt';
import {
  cancelAllBrowserAuthRequests,
  cancelBrowserAuthRequest,
  pendingBrowserAuthRequest,
  resolveBrowserAuthRequest,
  setBrowserAuthNotifier,
} from '../browser/authPrompt';
import { browserMediaStates, setMediaNotifier } from '../browser/media';
import { getSystemVolume, setSystemVolume } from '../toolkit/presenter/systemAudio';
import { activePageIsPdf, captureActivePage, importPdfIntoItem, saveCapture } from '../browser/capture';
import {
  activeBrowserDownloadCount,
  browserDownloads,
  cancelDownload,
  completedDownloadPath,
  dismissDownload,
  setDownloadNotifier,
} from '../browser/downloads';
import { destroyBrowserSubsystem, restartBrowserSubsystem } from '../browser/lifecycle';
import { addGlobalLibraryAttachments, createGlobalLibraryItem } from '../library/libraryService';
import { clearAllBrowserData, clearBrowserData, measureBrowserStorage } from '../browser/storage';
import { cacheWebsiteFavicon } from '../browser/favicon';
import { setNodiQuoteSelection, setNodiViewContext } from '../ai/nodiChat';
import { menuLabel } from '@shared/menuLabels';
import { getSettings } from '../db/settingsRepo';
import { assertTrustedNodusMainFrame } from './trust';
import {
  activateTab,
  browserState,
  captureOverlaySnapshot,
  closeTab,
  createTab,
  findInPage,
  dismissError,
  goBack,
  goForward,
  initBrowserTabs,
  navigate,
  reload,
  setFoundInPageListener,
  historyNeighbourUrl,
  setOverlayVisible,
  setSectionVisible,
  activeTabSummary,
  collectFromTab,
  sendMediaCommand,
  setTabMuted,
  setViewport,
  stopFindInPage,
  stopLoading,
} from '../browser/tabs';
import { browserBookmarksRepository } from '../browser/bookmarks';
import { browserHistoryRepository, currentBrowserHistoryRetention } from '../browser/history';
import { showImportOpenDialog } from '../privacy';

/**
 * Refuse anything that is not the main Nodus window.
 *
 * `event.sender` is the WebContents that made the call. Comparing it against the
 * main window's own WebContents means a browser tab — which lives in a different
 * WebContents entirely — can never drive the browser it is displayed in.
 */
function assertUiSender(
  event: Pick<Electron.IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getWindow: () => BrowserWindow | null,
): void {
  assertTrustedNodusMainFrame(event, getWindow());
}

function sanitizeViewport(raw: unknown): BrowserViewport | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<Record<keyof BrowserViewport, unknown>>;
  const numbers = (['x', 'y', 'width', 'height'] as const).map((key) => Number(candidate[key]));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = numbers;
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function cleanPageText(value: unknown, limit: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- page content is hostile input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, limit);
}

/**
 * Publish the page that lives in the native WebContentsView as Nodi's Current
 * view. The app shell cannot discover this text through `main.innerText`: that
 * only sees the React browser chrome, while the website is another renderer.
 */
async function syncActiveBrowserNodiContext(): Promise<boolean> {
  const collected = await collectFromTab('text');
  const payload = (collected ?? {}) as { title?: unknown; text?: unknown };
  const tab = activeTabSummary();
  const text = cleanPageText(payload.text, 120_000);
  if (!text.trim()) return false;
  setNodiViewContext({
    viewId: 'browser',
    title: cleanPageText(payload.title ?? tab?.title ?? 'Nodus Browser', 300),
    text: `${tab?.url ?? ''}\n\n${text}`,
    capturedAt: Date.now(),
    complete: true,
  });
  return true;
}

export function registerBrowserIpc({ h, getWindow }: IpcContext): void {
  /** Push the whole browser state; the renderer re-renders from it wholesale. */
  const broadcast = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:state', browserState());
  };

  const broadcastPermission = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:permissionRequest', pendingPermissionRequest());
  };

  const broadcastAuth = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:authRequest', pendingBrowserAuthRequest());
  };

  const broadcastMedia = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:media', browserMediaStates());
  };

  const broadcastDownloads = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:downloads', browserDownloads());
  };

  const bookmarks = browserBookmarksRepository();
  const broadcastBookmarks = (store: BrowserBookmarkStore) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:bookmarks', store);
  };
  bookmarks.setNotifier(broadcastBookmarks);

  // Favicon discovery is deliberately bounded and queued: opening a folder may
  // expose many imported bookmarks at once, but should never create a request
  // burst or block rendering the local bookmarks page.
  const faviconQueue: string[] = [];
  const queuedFavicons = new Set<string>();
  let activeFaviconJobs = 0;
  const pumpFaviconQueue = () => {
    while (activeFaviconJobs < 4) {
      const id = faviconQueue.shift();
      if (!id) return;
      activeFaviconJobs += 1;
      void (async () => {
        const bookmark = bookmarks.snapshot().bookmarks.find((entry) => entry.id === id);
        if (!bookmark || bookmark.faviconDataUrl) return;
        const faviconDataUrl = await cacheWebsiteFavicon(bookmark.url);
        if (!faviconDataUrl) return;
        const current = bookmarks.snapshot().bookmarks.find((entry) => entry.id === id);
        if (!current || current.faviconDataUrl || current.url !== bookmark.url) return;
        await bookmarks.editBookmark(id, { faviconDataUrl });
      })().catch(() => undefined).finally(() => {
        activeFaviconJobs -= 1;
        queuedFavicons.delete(id);
        pumpFaviconQueue();
      });
    }
  };
  const enqueueFavicons = (ids: string[]) => {
    for (const id of ids) {
      if (queuedFavicons.has(id)) continue;
      queuedFavicons.add(id);
      faviconQueue.push(id);
    }
    pumpFaviconQueue();
  };

  const history = browserHistoryRepository();
  const broadcastHistory = (store: BrowserHistoryStore) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('browser:history', store);
  };
  history.setNotifier(broadcastHistory);
  // Registration happens at app startup, before the Browser section is opened.
  // Enforce retention then as well as on every visit/read so stale records do
  // not wait for the user to open the History modal before being deleted.
  void history.list(currentBrowserHistoryRetention()).catch(() => undefined);

  const quoteToEveryNodi = (text: string): boolean => {
    const selection = setNodiQuoteSelection(cleanPageText(text, 20_000));
    if (!selection) return false;
    // Nodi may live inside the app or in its independent always-on-top window.
    // Sending only to the main renderer made browser actions look inert whenever
    // the user had chosen the floating companion.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('nodi:quoteSelection', selection);
    }
    return true;
  };

  let wired = false;
  const ensureWired = () => {
    const window = getWindow();
    if (!window) return;
    initBrowserTabs(window, broadcast, {
      openInNewTab: (url) => { void createTab(url); },
      quoteToNodi: (text) => {
        quoteToEveryNodi(text);
      },
      // Both of these are the same work the toolbar menu does; the renderer owns
      // the modal, so the context menu asks it to open rather than duplicating it.
      askNodiAboutPage: () => {
        const target = getWindow();
        if (target && !target.isDestroyed()) target.webContents.send('browser:requestAction', 'askNodiPage');
      },
      addToLibrary: () => {
        const target = getWindow();
        if (target && !target.isDestroyed()) target.webContents.send('browser:requestAction', 'addToLibrary');
      },
      addBookmark: () => {
        const target = getWindow();
        if (target && !target.isDestroyed()) target.webContents.send('browser:requestAction', 'addBookmark');
      },
      searchEngine: () => getSettings().browserSearchEngine ?? 'google',
      customSearchTemplate: () => getSettings().browserSearchTemplate ?? '',
      // The native menu speaks the app's language through the same table the UI uses.
      t: (key: string) => menuLabel(key, getSettings().uiLanguage),
    }, {
      // Cmd/Ctrl+T pressed while a page has focus. Same destination as the
      // toolbar's "+", so the two cannot drift apart.
      // `openNewTab` is declared further down but only ever called from a user
      // gesture, long after this module's body has run.
      newTab: () => { void openNewTab(''); },
    });
    if (wired) return;
    setPermissionPromptNotifier(broadcastPermission);
    setBrowserAuthNotifier(broadcastAuth);
    setMediaNotifier(broadcastMedia);
    setDownloadNotifier(broadcastDownloads);
    setFoundInPageListener((result) => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      win.webContents.send('browser:found-in-page', result);
    });
    wired = true;
  };

  // Synchronous hide to prevent native view flashing over the next section.
  // `invoke` would leave one frame where Settings header is painted but the
  // atlas WebContentsView is still visible (see screenshot).
  ipcMain.on('browser:setSectionVisibleSync', (event, visible: unknown) => {
    try {
      // The check used to be swallowed and the view toggled anyway, so any other renderer
      // could show or hide the Browser over the main window.
      assertUiSender(event as unknown as Electron.IpcMainInvokeEvent, getWindow);
      ensureWired();
      setSectionVisible(Boolean(visible));
    } catch {
      // Refused without crashing the main process.
    } finally {
      // Always release sendSync, including untrusted requests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `returnValue` is the sync IPC contract
      (event as any).returnValue = null;
    }
  });

  h('browser:state', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserState();
  });

  /**
   * Where Home and a new tab go.
   *
   * Resolved in main so the preference is applied in one place — the renderer
   * asking for "home" cannot drift from what the setting says.
   */
  const homeUrl = (): string => {
    const settings = getSettings();
    if (settings.browserHomeMode === 'custom') {
      const configured = String(settings.browserHomeUrl ?? '').trim();
      if (configured) {
        const resolved = parseOmniboxInput(configured);
        if (resolved.kind === 'navigate' || resolved.kind === 'search') return resolved.url;
      }
    }
    if (settings.browserHomeMode === 'bookmarks') return NODUS_BOOKMARKS_URL;
    return settings.browserHomeMode === 'start' ? NODUS_RESEARCH_ATLAS_START_URL : 'about:blank';
  };

  let restartInFlight: Promise<BrowserRestartResult> | null = null;

  /**
   * Destroy and recreate the Browser runtime — never the Nodus renderer.
   *
   * Confirmation is enforced here rather than trusted to React: the warning is
   * based on the live main-process state, and a future trusted caller cannot
   * accidentally skip it. Arbitrary websites fail assertUiSender before they
   * can inspect or trigger any part of the lifecycle.
   */
  h('browser:restart', async (event, confirmed: boolean): Promise<BrowserRestartResult> => {
    assertUiSender(event, getWindow);
    ensureWired();

    const activeDownloads = activeBrowserDownloadCount();
    const mediaSessions = browserMediaStates().length;
    const target = homeUrl();
    if (!confirmed && (activeDownloads > 0 || mediaSessions > 0)) {
      return {
        restarted: false,
        requiresConfirmation: true,
        activeDownloads,
        mediaSessions,
        tabId: null,
        url: target,
      };
    }

    if (!restartInFlight) {
      restartInFlight = restartBrowserSubsystem(target)
        .then((tabId) => ({
          restarted: true,
          requiresConfirmation: false,
          activeDownloads,
          mediaSessions,
          tabId,
          url: target,
        }))
        .finally(() => { restartInFlight = null; });
    }
    return restartInFlight;
  });

  /** One definition of "open a new tab", shared by the toolbar, the shortcut and IPC. */
  const openNewTab = (url: string) => {
    const requested = String(url ?? '');
    if (requested === '') {
      return createTab(getSettings().browserNewTabMode === 'blank' ? 'about:blank' : homeUrl());
    }
    return createTab(requested);
  };

  h('browser:openTab', async (event, url: string) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return openNewTab(url);
  });

  h('browser:navigateStartPage', async (event, page: unknown) => {
    assertUiSender(event, getWindow);
    ensureWired();
    if (page === 'atlas') return navigate(NODUS_RESEARCH_ATLAS_START_URL);
    if (page === 'bookmarks') return navigate(NODUS_BOOKMARKS_URL);
    throw new Error('Unknown Browser start page.');
  });

  h('browser:goHome', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    const target = homeUrl();
    const state = browserState();
    if (state.tabs.length === 0 || !state.activeTabId) {
      await createTab(target);
      return { url: target };
    }
    if (target === 'about:blank') { navigate('about:blank'); return { url: target }; }
    navigate(target);
    return { url: target };
  });

  /** Show a completed download in the file manager. Never opens the file itself. */
  h('browser:revealDownload', async (event, id: string) => {
    assertUiSender(event, getWindow);
    const file = completedDownloadPath(String(id));
    if (!file) throw new Error('That download is no longer available.');
    shell.showItemInFolder(file);
  });

  /** Forget every finished download. Files on disk are untouched. */
  h('browser:clearDownloads', async (event) => {
    assertUiSender(event, getWindow);
    for (const download of browserDownloads()) {
      if (download.state !== 'progressing' && download.state !== 'paused') dismissDownload(download.id);
    }
    return browserDownloads();
  });

  h('browser:activateTab', async (event, id: string) => {
    assertUiSender(event, getWindow);
    await activateTab(String(id));
  });

  h('browser:closeTab', async (event, id: string) => {
    assertUiSender(event, getWindow);
    closeTab(String(id));
    // Cerrar la última pestaña dejaba el navegador vacío: el botón Inicio
    // (navigate) no crea pestañas y el efecto inicial solo corría al montar,
    // obligando a salir y volver a la sección. Auto-crea la página de inicio.
    if (browserState().tabs.length === 0) {
      await createTab(homeUrl());
    }
  });

  h('browser:dismissError', async (event) => { assertUiSender(event, getWindow); dismissError(); });
  h('browser:goBack', async (event) => { assertUiSender(event, getWindow); goBack(); });
  h('browser:goForward', async (event) => { assertUiSender(event, getWindow); goForward(); });

  /**
   * Cmd/Ctrl-click (or middle-click) on Back or Forward: same destination, new
   * tab, and this tab stays where it is. Main resolves the history entry because
   * the renderer has no access to a tab's navigation history at all.
   */
  h('browser:openHistoryNeighbour', async (event, direction: unknown) => {
    assertUiSender(event, getWindow);
    ensureWired();
    if (direction !== 'back' && direction !== 'forward') return null;
    const url = historyNeighbourUrl(direction);
    return url ? createTab(url) : null;
  });
  h('browser:reload', async (event) => { assertUiSender(event, getWindow); reload(); });
  h('browser:stop', async (event) => { assertUiSender(event, getWindow); stopLoading(); });

  h('browser:findInPage', async (event, text: string, options: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => {
    assertUiSender(event, getWindow);
    findInPage(String(text ?? ''), options ?? {});
  });
  h('browser:stopFindInPage', async (event, action: string) => {
    assertUiSender(event, getWindow);
    const allowed = ['clearSelection', 'keepSelection', 'activateSelection'] as const;
    const next = allowed.includes(action as typeof allowed[number]) ? action as typeof allowed[number] : 'clearSelection';
    stopFindInPage(next);
  });

  /**
   * What the user typed in the address bar.
   *
   * Resolution happens HERE rather than in the renderer so the scheme blocklist
   * is enforced on the main-process side of the boundary, where it cannot be
   * skipped by whatever the renderer happens to send.
   */
  h('browser:submitOmnibox', async (event, input: string) => {
    assertUiSender(event, getWindow);
    ensureWired();
    const resolved = parseOmniboxInput(String(input ?? ''));
    if (resolved.kind === 'navigate' || resolved.kind === 'search') {
      const ok = navigate(resolved.url);
      return { kind: resolved.kind, url: resolved.url, ok };
    }
    return resolved;
  });

  ipcMain.on('browser:setViewportSync', (event, raw: unknown) => {
    try {
      assertUiSender(event, getWindow);
      const viewport = sanitizeViewport(raw);
      if (viewport) setViewport(viewport);
    } catch {
      // Reject untrusted requests without crashing the main process.
    } finally {
      // Always release sendSync, including invalid or untrusted requests.
      event.returnValue = null;
    }
  });

  /**
   * Hide the page while a React overlay is open.
   *
   * A WebContentsView is a native child view and paints above the window's HTML,
   * so without this every modal, the command palette and Nodi's companion would
   * be drawn underneath a web page. The WebContents is untouched: media keeps
   * playing and no navigation state is lost.
   */
  h('browser:setOverlayVisible', async (event, open: boolean) => {
    assertUiSender(event, getWindow);
    setOverlayVisible(Boolean(open));
  });

  h('browser:overlaySnapshot', async (event) => {
    assertUiSender(event, getWindow);
    return captureOverlaySnapshot();
  });

  /** Whether the browser section is the one currently on screen. */
  h('browser:setSectionVisible', async (event, visible: boolean) => {
    assertUiSender(event, getWindow);
    ensureWired();
    setSectionVisible(Boolean(visible));
  });

  h('browser:pendingPermission', async (event) => {
    assertUiSender(event, getWindow);
    return pendingPermissionRequest();
  });

  /**
   * Answer a permission prompt.
   *
   * `remember` is what "Always allow for this site" writes, and it goes to
   * app-prefs.json rather than to the vault: a site is the same site whichever
   * corpus happens to be open.
   */
  h('browser:resolvePermission', async (event, id: string, granted: boolean, remember: boolean) => {
    assertUiSender(event, getWindow);
    resolvePermissionRequest(String(id), granted === true, remember === true);
  });

  h('browser:cancelPermissions', async (event) => {
    assertUiSender(event, getWindow);
    cancelPermissionRequests();
  });

  h('browser:pendingAuth', async (event) => {
    assertUiSender(event, getWindow);
    return pendingBrowserAuthRequest();
  });

  /**
   * Answer an HTTP authentication challenge.
   *
   * The credentials go straight to Chromium's pending callback and nowhere
   * else: no disk, no log, no page. An id that no longer matches is ignored, so
   * a prompt closed by navigation cannot answer the next challenge by mistake.
   */
  h('browser:resolveAuth', async (event, id: string, username: string, password: string) => {
    assertUiSender(event, getWindow);
    resolveBrowserAuthRequest(
      String(id ?? ''),
      String(username ?? '').slice(0, 8_192),
      String(password ?? '').slice(0, 8_192),
    );
  });

  /**
   * Dismiss a credential prompt. With an id, only that request; without one,
   * everything pending — which is what leaving the Browser section does.
   */
  h('browser:cancelAuth', async (event, id?: string) => {
    assertUiSender(event, getWindow);
    if (typeof id === 'string' && id) cancelBrowserAuthRequest(id);
    else cancelAllBrowserAuthRequests();
  });

  h('browser:media', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserMediaStates();
  });

  h('browser:mediaCommand', async (event, tabId: string, command: string) => {
    assertUiSender(event, getWindow);
    if (command !== 'previous' && command !== 'play' && command !== 'pause' && command !== 'next' && command !== 'stop') return;
    sendMediaCommand(String(tabId), command);
  });

  h('browser:setTabMuted', async (event, tabId: string, muted: boolean) => {
    assertUiSender(event, getWindow);
    setTabMuted(String(tabId), muted === true);
  });

  h('browser:deviceVolume:get', async (event) => {
    assertUiSender(event, getWindow);
    return getSystemVolume();
  });

  h('browser:deviceVolume:set', async (event, volume: number) => {
    assertUiSender(event, getWindow);
    await setSystemVolume(Number(volume));
  });

  /**
   * Add to Library.
   *
   * Returns what WOULD be stored, enriched, for the user to review. Nothing is
   * written until browser:saveCapture, because a capture creates a real Library
   * item and silently guessed metadata is worse than none.
   */
  h('browser:capturePage', async (event) => {
    assertUiSender(event, getWindow);
    return captureActivePage();
  });

  h('browser:saveCapture', async (event, request: unknown, includeSnapshot: boolean) => {
    assertUiSender(event, getWindow);
    if (!request || typeof request !== 'object') throw new Error('There is nothing to save from this page.');
    return saveCapture(request as never, { includeSnapshot: includeSnapshot === true });
  });

  h('browser:isPdf', async (event) => {
    assertUiSender(event, getWindow);
    return activePageIsPdf();
  });

  h('browser:importPdf', async (event, itemId: string, url: string, title: string) => {
    assertUiSender(event, getWindow);
    return importPdfIntoItem(String(itemId), String(url), String(title ?? ''));
  });

  h('browser:syncNodiContext', async (event) => {
    assertUiSender(event, getWindow);
    return syncActiveBrowserNodiContext();
  });

  /**
   * Ask Nodi about this page.
   *
   * Reuses the existing Nodi context slot rather than inventing a browser-
   * specific channel. Nothing is sent to any AI provider by this call: it only
   * puts the page where Nodi will look IF the user then asks something.
   */
  h('browser:askNodiAboutPage', async (event) => {
    assertUiSender(event, getWindow);
    if (!await syncActiveBrowserNodiContext()) return false;
    const tab = activeTabSummary();
    const reference = [tab?.title, tab?.url].map((value) => String(value ?? '').trim()).filter(Boolean).join('\n');
    return quoteToEveryNodi(reference || 'Nodus Browser');
  });

  h('browser:downloads', async (event) => {
    assertUiSender(event, getWindow);
    ensureWired();
    return browserDownloads();
  });

  h('browser:cancelDownload', async (event, id: string) => {
    assertUiSender(event, getWindow);
    cancelDownload(String(id));
  });

  h('browser:dismissDownload', async (event, id: string) => {
    assertUiSender(event, getWindow);
    dismissDownload(String(id));
  });

  /**
   * Import a completed download into the Library.
   *
   * Only ever from an explicit click. The file is already on disk where the user
   * put it; this attaches a COPY through the normal Library path, which is what
   * runs extraction, OCR, indexing and embeddings.
   */
  h('browser:importDownload', async (event, id: string, title: string) => {
    assertUiSender(event, getWindow);
    const file = completedDownloadPath(String(id));
    if (!file) throw new Error('That download is no longer available.');
    const item = createGlobalLibraryItem({
      title: String(title ?? '').trim() || 'Downloaded document',
      itemType: 'document',
      creators: [],
      url: '',
      tags: [],
    } as never);
    const saved = await addGlobalLibraryAttachments(item.id, [file]);
    dismissDownload(String(id));
    return { itemId: saved.id, title: saved.metadata.title };
  });

  h('browser:storage', async (event, force: boolean) => {
    assertUiSender(event, getWindow);
    return measureBrowserStorage(force === true);
  });

  h('browser:clearData', async (event, categories: unknown, origins: unknown) => {
    assertUiSender(event, getWindow);
    const list = Array.isArray(categories) ? categories.map(String) : [];
    if (list.length === 0) return measureBrowserStorage(true);
    const scoped = Array.isArray(origins) ? origins.map(String).filter(Boolean) : undefined;
    await clearBrowserData(list as never, scoped);
    return measureBrowserStorage(true);
  });

  /**
   * Clear everything.
   *
   * Tabs are closed FIRST. A live page holding a service worker or an open
   * IndexedDB connection re-seeds its storage the moment it is wiped, so
   * clearing under a loaded page produces a panel that reports success and a
   * profile that is not actually empty.
   */
  h('browser:clearAllData', async (event) => {
    assertUiSender(event, getWindow);
    const replacementUrl = homeUrl();
    // This is a destroy-and-recreate operation while the Browser UI stays
    // mounted. Keep the host window and the renderer-published viewport or the
    // replacement WebContentsView loads correctly but can never be attached —
    // a permanently white page that even Restart Browser cannot recover from.
    destroyBrowserSubsystem({ preserveViewport: true });
    try {
      await history.clear();
      await clearAllBrowserData();
    } finally {
      // Clearing data is a Browser reset, not a terminal shutdown. Always leave
      // the subsystem usable, even if Chromium rejects one clearing operation.
      await createTab(replacementUrl);
    }
    return measureBrowserStorage(true);
  });

  h('browser:history:get', async (event) => {
    assertUiSender(event, getWindow);
    return history.list(currentBrowserHistoryRetention());
  });

  h('browser:history:delete', async (event, id: unknown) => {
    assertUiSender(event, getWindow);
    if (typeof id !== 'string' || !id || id.length > 120) throw new Error('That history entry is not valid.');
    return history.delete(id);
  });

  h('browser:history:clear', async (event) => {
    assertUiSender(event, getWindow);
    return history.clear();
  });

  h('browser:bookmarks:get', async (event) => {
    assertUiSender(event, getWindow);
    return bookmarks.snapshot();
  });

  h('browser:bookmarks:resolveFavicons', async (event, rawIds: unknown) => {
    assertUiSender(event, getWindow);
    if (!Array.isArray(rawIds)) return;
    const ids = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, 500);
    enqueueFavicons(ids);
  });

  h('browser:bookmarks:candidate', async (event) => {
    assertUiSender(event, getWindow);
    const tab = activeTabSummary();
    const url = tab?.kind === 'web' ? sanitizeBookmarkUrl(tab.url) : null;
    if (!tab || !url) return null;
    return {
      title: cleanPageText(tab.title, 300) || new URL(url).hostname,
      url,
      description: '',
      faviconDataUrl: tab.faviconDataUrl,
      existingId: findDuplicateBookmark(bookmarks.snapshot(), url)?.id ?? null,
    };
  });

  h('browser:bookmarks:create', async (event, raw: unknown) => {
    assertUiSender(event, getWindow);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El marcador no es válido.');
    const result = await bookmarks.createBookmark(raw as BrowserBookmarkDraft);
    if (!result.bookmark.faviconDataUrl) enqueueFavicons([result.bookmark.id]);
    return result;
  });

  h('browser:bookmarks:update', async (event, id: string, raw: unknown) => {
    assertUiSender(event, getWindow);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Los cambios del marcador no son válidos.');
    const store = await bookmarks.editBookmark(String(id), raw as Partial<BrowserBookmarkDraft>);
    const bookmark = store.bookmarks.find((entry) => entry.id === String(id));
    if (bookmark && !bookmark.faviconDataUrl) enqueueFavicons([bookmark.id]);
    return store;
  });

  h('browser:bookmarks:createFolder', async (event, raw: unknown) => {
    assertUiSender(event, getWindow);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('La carpeta no es válida.');
    return bookmarks.createFolder(raw as BrowserBookmarkFolderDraft);
  });

  h('browser:bookmarks:updateFolder', async (event, id: string, raw: unknown) => {
    assertUiSender(event, getWindow);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Los cambios de la carpeta no son válidos.');
    return bookmarks.editFolder(String(id), raw as Partial<BrowserBookmarkFolderDraft>);
  });

  h('browser:bookmarks:delete', async (event, raw: unknown) => {
    assertUiSender(event, getWindow);
    const candidate = raw as Partial<BrowserBookmarkNodeRef> | null;
    if (!candidate || (candidate.kind !== 'bookmark' && candidate.kind !== 'folder') || typeof candidate.id !== 'string') {
      throw new Error('El elemento de marcadores no es válido.');
    }
    return bookmarks.deleteNode({ kind: candidate.kind, id: candidate.id });
  });

  h('browser:bookmarks:move', async (event, raw: unknown, parentId: unknown, index: unknown) => {
    assertUiSender(event, getWindow);
    const candidate = raw as Partial<BrowserBookmarkNodeRef> | null;
    if (!candidate || (candidate.kind !== 'bookmark' && candidate.kind !== 'folder') || typeof candidate.id !== 'string') {
      throw new Error('El elemento de marcadores no es válido.');
    }
    return bookmarks.moveNode(
      { kind: candidate.kind, id: candidate.id },
      typeof parentId === 'string' && parentId ? parentId : null,
      Math.max(0, Math.floor(Number(index) || 0)),
    );
  });

  interface PendingBookmarksImport {
    store: BrowserBookmarkStore;
    invalidUrls: number;
    truncated: boolean;
    expiresAt: number;
  }
  const pendingImports = new Map<string, PendingBookmarksImport>();

  h('browser:bookmarks:previewImport', async (event) => {
    assertUiSender(event, getWindow);
    const owner = getWindow() ?? undefined;
    const openOptions: Electron.OpenDialogOptions = {
      title: dialogTitle('importNodusBookmarks', getSettings().uiLanguage),
      properties: ['openFile'],
      filters: [
        { name: 'Marcadores', extensions: ['json', 'html', 'htm'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    };
    const selected = owner
      ? await showImportOpenDialog(owner, openOptions)
      : await showImportOpenDialog(openOptions);
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = selected.filePaths[0];
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > MAX_BOOKMARK_IMPORT_BYTES) throw new Error('El archivo de marcadores es demasiado grande.');
    const source = await fsp.readFile(file, 'utf8');
    const format = path.extname(file).toLowerCase() === '.json' ? 'json' as const : 'html' as const;
    const parsed = format === 'json'
      ? { store: parseBrowserBookmarksJson(source), invalidUrls: 0, truncated: false }
      : parseBrowserBookmarksHtml(source, randomUUID);
    const previewMerge = mergeBrowserBookmarkStores(bookmarks.snapshot(), parsed.store, randomUUID);
    const token = randomUUID();
    pendingImports.set(token, { ...parsed, expiresAt: Date.now() + 10 * 60_000 });
    for (const [key, value] of pendingImports) if (value.expiresAt < Date.now()) pendingImports.delete(key);
    return {
      token,
      format,
      fileName: path.basename(file),
      bookmarks: parsed.store.bookmarks.length,
      folders: parsed.store.folders.length,
      duplicates: previewMerge.summary.duplicates,
      invalidUrls: parsed.invalidUrls,
      truncated: parsed.truncated || previewMerge.summary.truncated,
    };
  });

  h('browser:bookmarks:commitImport', async (event, token: string) => {
    assertUiSender(event, getWindow);
    const pending = pendingImports.get(String(token));
    pendingImports.delete(String(token));
    if (!pending || pending.expiresAt < Date.now()) throw new Error('La vista previa de importación ha caducado.');
    const merged = mergeBrowserBookmarkStores(bookmarks.snapshot(), pending.store, randomUUID);
    merged.summary.invalidUrls = pending.invalidUrls;
    merged.summary.truncated ||= pending.truncated;
    return { store: await bookmarks.replace(merged.store), summary: merged.summary };
  });

  h('browser:bookmarks:export', async (event, rawFormat: string) => {
    assertUiSender(event, getWindow);
    const format = rawFormat === 'html' ? 'html' as const : 'json' as const;
    const store = bookmarks.snapshot();
    const saveOptions: Electron.SaveDialogOptions = {
      title: dialogTitle('exportNodusBookmarks', getSettings().uiLanguage),
      defaultPath: browserBookmarksExportFileName(format),
      filters: format === 'json'
        ? [{ name: 'Nodus Bookmarks JSON', extensions: ['json'] }]
        : [{ name: 'Marcadores HTML', extensions: ['html'] }],
    };
    const owner = getWindow();
    const selected = owner
      ? await dialog.showSaveDialog(owner, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (selected.canceled || !selected.filePath) {
      return { canceled: true, format, bookmarks: store.bookmarks.length, folders: store.folders.length };
    }
    const payload = format === 'json' ? exportBrowserBookmarksJson(store) : exportBrowserBookmarksHtml(store);
    await fsp.writeFile(selected.filePath, payload, { encoding: 'utf8', mode: 0o600 });
    return {
      canceled: false,
      format,
      bookmarks: store.bookmarks.length,
      folders: store.folders.length,
      fileName: path.basename(selected.filePath),
    };
  });

  h('browser:askNodiAboutSelection', async (event) => {
    assertUiSender(event, getWindow);
    const collected = await collectFromTab('selection');
    const text = cleanPageText(((collected ?? {}) as { text?: unknown }).text, 20_000);
    return quoteToEveryNodi(text);
  });
}
