// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser slice of the MAIN WINDOW's bridge.
 *
 * Not to be confused with ./browserPage.ts, which runs inside a web page and
 * deliberately exposes nothing. This one is ordinary: it belongs to the trusted
 * Nodus renderer and lets it draw the browser chrome and issue commands.
 *
 * The renderer never holds a WebContents. It reports the rectangle it has
 * reserved, sends commands, and re-renders from the state it is pushed.
 */

import { ipcRenderer } from 'electron';
import type { BrowserMediaCommand, BrowserRestartResult, BrowserState, BrowserViewport } from '@shared/browser';
import type { OmniboxResolution } from '@shared/browserOmnibox';
import type {
  BrowserDataCategory, BrowserDownloadView, BrowserMediaState,
  BrowserStorageReport, PendingBrowserAuth, PendingBrowserPermission,
} from '@shared/browser';
import type { BrowserConnectorCapturePreview, BrowserConnectorCaptureRequest, BrowserConnectorSaveResult } from '@shared/browserConnector';
import type {
  BrowserBookmarkDraft,
  BrowserBookmarkFolderDraft,
  BrowserBookmarkNodeRef,
  BrowserBookmarkStore,
  BrowserBookmarkCandidate,
  BrowserBookmarksExportResult,
  BrowserBookmarksImportPreview,
  BrowserBookmarksImportSummary,
  BrowserBookmark,
  BrowserBookmarkFolder,
} from '@shared/browserBookmarks';
import type { BrowserHistoryStore } from '@shared/browserHistory';

export type BrowserCapturePreview = BrowserConnectorCapturePreview;

/** What `browser:submitOmnibox` answers: the resolution, plus whether it landed. */
export type BrowserOmniboxResult =
  | (OmniboxResolution & { ok?: boolean });

export const browserApi = {
  getBrowserState: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
  openBrowserTab: (url: string): Promise<string | null> => ipcRenderer.invoke('browser:openTab', url),
  navigateBrowserStartPage: (page: 'atlas' | 'bookmarks'): Promise<boolean> =>
    ipcRenderer.invoke('browser:navigateStartPage', page),
  activateBrowserTab: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:activateTab', id).then(() => undefined),
  closeBrowserTab: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:closeTab', id).then(() => undefined),
  browserDismissError: (): Promise<void> => ipcRenderer.invoke('browser:dismissError').then(() => undefined),
  browserGoBack: (): Promise<void> => ipcRenderer.invoke('browser:goBack').then(() => undefined),
  browserGoForward: (): Promise<void> => ipcRenderer.invoke('browser:goForward').then(() => undefined),
  openBrowserHistoryNeighbourTab: (direction: 'back' | 'forward'): Promise<string | null> =>
    ipcRenderer.invoke('browser:openHistoryNeighbour', direction),
  browserReload: (): Promise<void> => ipcRenderer.invoke('browser:reload').then(() => undefined),
  browserStop: (): Promise<void> => ipcRenderer.invoke('browser:stop').then(() => undefined),
  browserGoHome: (): Promise<{ url: string }> => ipcRenderer.invoke('browser:goHome'),
  restartNodusBrowser: (confirmed = false): Promise<BrowserRestartResult> =>
    ipcRenderer.invoke('browser:restart', confirmed === true),
  revealBrowserDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:revealDownload', id).then(() => undefined),
  clearBrowserDownloads: (): Promise<BrowserDownloadView[]> => ipcRenderer.invoke('browser:clearDownloads'),
  onBrowserActionRequested: (callback: (action: string) => void): (() => void) => {
    const listener = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on('browser:requestAction', listener);
    return () => ipcRenderer.removeListener('browser:requestAction', listener);
  },
  submitBrowserOmnibox: (input: string): Promise<BrowserOmniboxResult> =>
    ipcRenderer.invoke('browser:submitOmnibox', input),
  setBrowserViewport: (viewport: BrowserViewport): Promise<void> => {
    // Layout and native bounds must commit together. An async invoke lets the
    // page cover the sidebar until main processes the next IPC round trip.
    ipcRenderer.sendSync('browser:setViewportSync', viewport);
    return Promise.resolve();
  },
  browserFindInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<void> =>
    ipcRenderer.invoke('browser:findInPage', text, options ?? {}).then(() => undefined),
  browserStopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): Promise<void> =>
    ipcRenderer.invoke('browser:stopFindInPage', action ?? 'clearSelection').then(() => undefined),
  onBrowserFoundInPage: (callback: (result: { requestId: number; activeMatchOrdinal: number; matches: number; selectionArea: unknown; finalUpdate: boolean }) => void): (() => void) => {
    const listener = (_event: unknown, result: { requestId: number; activeMatchOrdinal: number; matches: number; selectionArea: unknown; finalUpdate: boolean }) => callback(result);
    ipcRenderer.on('browser:found-in-page', listener);
    return () => ipcRenderer.removeListener('browser:found-in-page', listener);
  },
  setBrowserOverlayVisible: (open: boolean): Promise<void> =>
    ipcRenderer.invoke('browser:setOverlayVisible', open).then(() => undefined),
  captureBrowserOverlaySnapshot: (): Promise<string | null> =>
    ipcRenderer.invoke('browser:overlaySnapshot'),
  setBrowserSectionVisible: (visible: boolean): Promise<void> => {
    // Hide must be synchronous to avoid the native WebContentsView flashing over
    // the next section (e.g. Settings). `invoke` is async (IPC roundtrip ≈ one
    // frame) and the new view paints before main hides the view. `sendSync`
    // blocks the renderer until main has called `setVisible(false)`.
    if (!visible) {
      try {
        ipcRenderer.sendSync('browser:setSectionVisibleSync', visible);
      } catch {}
      return Promise.resolve();
    }
    return ipcRenderer.invoke('browser:setSectionVisible', visible).then(() => undefined);
  },
  getPendingBrowserPermission: (): Promise<PendingBrowserPermission | null> =>
    ipcRenderer.invoke('browser:pendingPermission'),
  resolveBrowserPermission: (id: string, granted: boolean, remember: boolean): Promise<void> =>
    ipcRenderer.invoke('browser:resolvePermission', id, granted, remember).then(() => undefined),
  cancelBrowserPermissions: (): Promise<void> =>
    ipcRenderer.invoke('browser:cancelPermissions').then(() => undefined),
  getPendingBrowserAuth: (): Promise<PendingBrowserAuth | null> =>
    ipcRenderer.invoke('browser:pendingAuth'),
  resolveBrowserAuth: (id: string, username: string, password: string): Promise<void> =>
    ipcRenderer.invoke('browser:resolveAuth', id, username, password).then(() => undefined),
  cancelBrowserAuth: (id?: string): Promise<void> =>
    ipcRenderer.invoke('browser:cancelAuth', id).then(() => undefined),
  onBrowserAuthRequest: (callback: (request: PendingBrowserAuth | null) => void): (() => void) => {
    const listener = (_event: unknown, request: PendingBrowserAuth | null) => callback(request);
    ipcRenderer.on('browser:authRequest', listener);
    return () => ipcRenderer.removeListener('browser:authRequest', listener);
  },
  onBrowserPermissionRequest: (callback: (request: PendingBrowserPermission | null) => void): (() => void) => {
    const listener = (_event: unknown, request: PendingBrowserPermission | null) => callback(request);
    ipcRenderer.on('browser:permissionRequest', listener);
    return () => ipcRenderer.removeListener('browser:permissionRequest', listener);
  },
  getBrowserMedia: (): Promise<BrowserMediaState[]> => ipcRenderer.invoke('browser:media'),
  browserMediaCommand: (tabId: string, command: BrowserMediaCommand): Promise<void> =>
    ipcRenderer.invoke('browser:mediaCommand', tabId, command).then(() => undefined),
  setBrowserTabMuted: (tabId: string, muted: boolean): Promise<void> =>
    ipcRenderer.invoke('browser:setTabMuted', tabId, muted).then(() => undefined),
  getBrowserDeviceVolume: (): Promise<number> => ipcRenderer.invoke('browser:deviceVolume:get'),
  setBrowserDeviceVolume: (volume: number): Promise<void> =>
    ipcRenderer.invoke('browser:deviceVolume:set', volume).then(() => undefined),
  onBrowserMediaChanged: (callback: (states: BrowserMediaState[]) => void): (() => void) => {
    const listener = (_event: unknown, states: BrowserMediaState[]) => callback(states);
    ipcRenderer.on('browser:media', listener);
    return () => ipcRenderer.removeListener('browser:media', listener);
  },
  listBrowserCaptureJobs: () => ipcRenderer.invoke('browser:captureJobs:list'),
  enqueueBrowserCaptures: (requests: BrowserConnectorCaptureRequest[]) => ipcRenderer.invoke('browser:captureJobs:enqueue', requests),
  retryBrowserCaptureJob: (id: string) => ipcRenderer.invoke('browser:captureJobs:retry', id),
  captureBrowserPage: (): Promise<BrowserCapturePreview | null> => ipcRenderer.invoke('browser:capturePage'),
  saveBrowserCapture: (request: BrowserConnectorCaptureRequest, includeSnapshot: boolean): Promise<BrowserConnectorSaveResult> =>
    ipcRenderer.invoke('browser:saveCapture', request, includeSnapshot),
  browserPageIsPdf: (): Promise<{ isPdf: boolean; url: string }> => ipcRenderer.invoke('browser:isPdf'),
  importBrowserPdf: (itemId: string, url: string, title: string): Promise<BrowserConnectorSaveResult> =>
    ipcRenderer.invoke('browser:importPdf', itemId, url, title),
  syncBrowserNodiContext: (): Promise<boolean> => ipcRenderer.invoke('browser:syncNodiContext'),
  askNodiAboutBrowserPage: (): Promise<boolean> => ipcRenderer.invoke('browser:askNodiAboutPage'),
  askNodiAboutBrowserSelection: (): Promise<boolean> => ipcRenderer.invoke('browser:askNodiAboutSelection'),
  getBrowserDownloads: (): Promise<BrowserDownloadView[]> => ipcRenderer.invoke('browser:downloads'),
  cancelBrowserDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:cancelDownload', id).then(() => undefined),
  dismissBrowserDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('browser:dismissDownload', id).then(() => undefined),
  importBrowserDownload: (id: string, title: string): Promise<{ itemId: string; title: string }> =>
    ipcRenderer.invoke('browser:importDownload', id, title),
  onBrowserDownloadsChanged: (callback: (downloads: BrowserDownloadView[]) => void): (() => void) => {
    const listener = (_event: unknown, downloads: BrowserDownloadView[]) => callback(downloads);
    ipcRenderer.on('browser:downloads', listener);
    return () => ipcRenderer.removeListener('browser:downloads', listener);
  },
  getBrowserStorage: (force?: boolean): Promise<BrowserStorageReport> =>
    ipcRenderer.invoke('browser:storage', force === true),
  clearBrowserData: (categories: BrowserDataCategory[], origins?: string[]): Promise<BrowserStorageReport> =>
    ipcRenderer.invoke('browser:clearData', categories, origins ?? null),
  clearAllBrowserData: (): Promise<BrowserStorageReport> => ipcRenderer.invoke('browser:clearAllData'),
  getBrowserBookmarks: (): Promise<BrowserBookmarkStore> => ipcRenderer.invoke('browser:bookmarks:get'),
  resolveBrowserBookmarkFavicons: (ids: string[]): Promise<void> =>
    ipcRenderer.invoke('browser:bookmarks:resolveFavicons', ids).then(() => undefined),
  getCurrentBrowserBookmarkCandidate: (): Promise<BrowserBookmarkCandidate | null> =>
    ipcRenderer.invoke('browser:bookmarks:candidate'),
  createBrowserBookmark: (draft: BrowserBookmarkDraft): Promise<{ store: BrowserBookmarkStore; bookmark: BrowserBookmark; duplicate: boolean }> =>
    ipcRenderer.invoke('browser:bookmarks:create', draft),
  updateBrowserBookmark: (id: string, patch: Partial<BrowserBookmarkDraft>): Promise<BrowserBookmarkStore> =>
    ipcRenderer.invoke('browser:bookmarks:update', id, patch),
  createBrowserBookmarkFolder: (draft: BrowserBookmarkFolderDraft): Promise<{ store: BrowserBookmarkStore; folder: BrowserBookmarkFolder }> =>
    ipcRenderer.invoke('browser:bookmarks:createFolder', draft),
  updateBrowserBookmarkFolder: (id: string, patch: Partial<BrowserBookmarkFolderDraft>): Promise<BrowserBookmarkStore> =>
    ipcRenderer.invoke('browser:bookmarks:updateFolder', id, patch),
  deleteBrowserBookmarkNode: (ref: BrowserBookmarkNodeRef): Promise<BrowserBookmarkStore> =>
    ipcRenderer.invoke('browser:bookmarks:delete', ref),
  moveBrowserBookmarkNode: (ref: BrowserBookmarkNodeRef, parentId: string | null, index: number): Promise<BrowserBookmarkStore> =>
    ipcRenderer.invoke('browser:bookmarks:move', ref, parentId, index),
  previewBrowserBookmarksImport: (): Promise<BrowserBookmarksImportPreview | null> =>
    ipcRenderer.invoke('browser:bookmarks:previewImport'),
  commitBrowserBookmarksImport: (token: string): Promise<{ store: BrowserBookmarkStore; summary: BrowserBookmarksImportSummary }> =>
    ipcRenderer.invoke('browser:bookmarks:commitImport', token),
  exportBrowserBookmarks: (format: 'json' | 'html'): Promise<BrowserBookmarksExportResult> =>
    ipcRenderer.invoke('browser:bookmarks:export', format),
  onBrowserBookmarksChanged: (callback: (store: BrowserBookmarkStore) => void): (() => void) => {
    const listener = (_event: unknown, store: BrowserBookmarkStore) => callback(store);
    ipcRenderer.on('browser:bookmarks', listener);
    return () => ipcRenderer.removeListener('browser:bookmarks', listener);
  },
  getBrowserHistory: (): Promise<BrowserHistoryStore> => ipcRenderer.invoke('browser:history:get'),
  deleteBrowserHistoryEntry: (id: string): Promise<BrowserHistoryStore> =>
    ipcRenderer.invoke('browser:history:delete', id),
  clearBrowserHistory: (): Promise<BrowserHistoryStore> => ipcRenderer.invoke('browser:history:clear'),
  onBrowserHistoryChanged: (callback: (store: BrowserHistoryStore) => void): (() => void) => {
    const listener = (_event: unknown, store: BrowserHistoryStore) => callback(store);
    ipcRenderer.on('browser:history', listener);
    return () => ipcRenderer.removeListener('browser:history', listener);
  },
  onBrowserStateChanged: (callback: (state: BrowserState) => void): (() => void) => {
    const listener = (_event: unknown, state: BrowserState) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  },
};
