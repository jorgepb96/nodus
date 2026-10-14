// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The Nodus Browser contract shared by the main process and the renderer.
 *
 * Everything here crosses IPC, so it is plain data: no Electron types, no
 * WebContents, no handles. The renderer draws chrome and issues commands; it
 * never holds a reference to a page.
 */

import type { BrowserSearchEngineId } from './browserOmnibox';

/** How a tab's last navigation ended. `ok` covers "still loading". */
export type BrowserTabErrorKind =
  | 'none'
  | 'dns'
  | 'offline'
  | 'refused'
  | 'timeout'
  | 'certificate'
  | 'blocked-scheme'
  | 'crashed'
  /** Google refuses to sign in from any embedded browser. See isGoogleSignInUrl. */
  | 'google-sign-in'
  | 'unknown';

export interface BrowserTabError {
  kind: BrowserTabErrorKind;
  /** Chromium's numeric code, kept for diagnosis rather than for display. */
  code: number | null;
  /** Chromium's own description. Shown verbatim under the localized heading. */
  description: string;
  url: string;
  /**
   * For `google-sign-in`: the page the sign-in was started FROM, when there was
   * one — and the address the hand-off must actually use.
   *
   * A federated login has to begin and end in the same browser. Sites built on
   * Firebase keep the flow's state in `sessionStorage` under their own origin,
   * so handing the system browser the half-finished accounts.google.com URL
   * lands it on a page whose opening move happened somewhere else, and it fails
   * with `auth/missing-initial-state`. Handing over the SITE instead lets the
   * whole flow run start-to-finish in one place.
   *
   * Null when the user asked for Google directly (typed it, or opened a link
   * into a new tab), where there is no site to go back to.
   */
  siteUrl?: string | null;
}

/**
 * One tab, as the renderer sees it.
 *
 * `title`/`favicon` are what Chromium reported for the live page. The favicon is
 * a data URI resolved in the main process on purpose: handing the renderer a
 * remote URL would make the TRUSTED window issue a request to whatever host the
 * page named.
 */
export interface BrowserTabState {
  id: string;
  /** Internal start pages are drawn by trusted React, never by a website. */
  kind: 'web' | 'bookmarks' | 'atlas';
  url: string;
  /** What the user typed or what the page reports, whichever is newer. */
  title: string;
  faviconDataUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Chromium reports audio is coming out right now. */
  audible: boolean;
  muted: boolean;
  /** A media session exists in this tab — see BrowserMediaState. */
  hasMedia: boolean;
  mediaPlaying: boolean;
  error: BrowserTabError | null;
}

/** The whole browser, in one payload the renderer can render from. */
export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

/** Result of requesting a real Browser subsystem restart. */
export interface BrowserRestartResult {
  /** False when main requires an explicit warning confirmation first. */
  restarted: boolean;
  requiresConfirmation: boolean;
  activeDownloads: number;
  mediaSessions: number;
  /** The single fresh tab, once restarted. */
  tabId: string | null;
  url: string;
}

/** Commands the header can send to a browser media session. */
export type BrowserMediaCommand = 'previous' | 'play' | 'pause' | 'next' | 'stop';

/** A media session in one tab. */
export interface BrowserMediaState {
  tabId: string;
  /** The media title where the page exposed one, else the page title. */
  title: string;
  url: string;
  origin: string;
  faviconDataUrl: string | null;
  hasMedia: boolean;
  playing: boolean;
  audible: boolean;
  muted: boolean;
  canPlayPause: boolean;
  kind: 'audio' | 'video' | 'unknown';
}

/** Where a new tab or the Home button should go. */
export type BrowserHomeMode = 'start' | 'bookmarks' | 'blank' | 'custom';

export interface BrowserPrefs {
  homeMode: BrowserHomeMode;
  homeUrl: string;
  searchEngine: BrowserSearchEngineId;
  searchTemplate: string;
  restoreTabs: boolean;
  newTabMode: 'home' | 'blank';
}

export const DEFAULT_BROWSER_PREFS: BrowserPrefs = {
  // Until the user sets an address of their own, Home is their local bookmarks.
  homeMode: 'bookmarks',
  homeUrl: '',
  searchEngine: 'google',
  searchTemplate: '',
  // Off by default: restoring N tabs means N renderer processes at first open,
  // and a stale SSO tab restoring into a login wall is a poor first impression.
  restoreTabs: false,
  newTabMode: 'home',
};

/** The first-party start page used by Home and, by default, every new tab. */
export const NODUS_RESEARCH_ATLAS_URL = 'https://nodusresearch.com/research-atlas/';

/**
 * Pages where Nodus may add its local-only Bookmarks entry.
 *
 * The production origins are exact. Loopback HTTP is included solely so the
 * checked-in website can be exercised from its local development server; a
 * page still needs the first-party header slot and an explicit trusted click
 * before the app does anything.
 */
export function isNodusResearchSiteUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' && (url.hostname === 'nodusresearch.com' || url.hostname === 'www.nodusresearch.com')) {
      return true;
    }
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Google's sign-in host, which no embedded browser is allowed to use.
 *
 * This is not a Nodus limitation and not a bug to be worked around. Google
 * announced in 2019 that it would block sign-in from Chromium EMBEDDERS — CEF
 * and Electron — as a man-in-the-middle defence, and it has never published a
 * way for one to be re-admitted. The block is on the framework, not on the
 * User-Agent: dressing Electron up as Chrome (matching `window.chrome`, the
 * Sec-CH-UA brand list and `navigator.userAgentData`) was measured against the
 * real page and still ends at "Este navegador o aplicación puede que no sean
 * seguros". Apps that genuinely needed it forked Chromium outright — Wavebox
 * left Electron for exactly this reason — and the ones that did not, such as
 * Obsidian's Web Viewer, document the limitation instead.
 *
 * So Nodus does not try. It recognises the destination BEFORE Google's wall
 * loads and offers the only thing that actually works: the system browser.
 *
 * The whole host is matched rather than a list of sign-in paths. Everything on
 * accounts.google.com is account flow — sign-in, the account chooser, the OAuth
 * authorization endpoint third-party "Continue with Google" buttons redirect to
 * — and none of it can succeed here.
 */
export function isGoogleSignInUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

/**
 * Whether dismissing a navigation notice must restore the React start page
 * Chromium never recorded instead of revealing an empty native WebContents.
 *
 * A real web page always wins, even when an internal return is remembered: the
 * notice may be covering a live site whose own Google popup was denied. Only an
 * empty WebContents means there is nothing useful behind the notice.
 */
export function shouldRestoreInternalReturnOnDismiss(
  liveUrl: string,
  hasInternalReturn: boolean,
): boolean {
  return hasInternalReturn && (!liveUrl || liveUrl === 'about:blank');
}

/** Synthetic identifiers. They are not registered protocols and never navigate. */
export const NODUS_BOOKMARKS_URL = 'nodus://bookmarks';
export const NODUS_RESEARCH_ATLAS_START_URL = 'nodus://research-atlas';

export function browserInternalPage(url: string): BrowserTabState['kind'] | null {
  if (url === NODUS_BOOKMARKS_URL) return 'bookmarks';
  if (url === NODUS_RESEARCH_ATLAS_START_URL) return 'atlas';
  return null;
}

/**
 * The most tabs Nodus Browser will hold open.
 *
 * Each tab is its own renderer process (roughly 40-90 MB). This is a research
 * browser, not a replacement for one, and an uncapped tab strip is how the
 * feature would turn into a memory complaint.
 */
export const MAX_BROWSER_TABS = 12;

/** The rectangle, in CSS pixels, the renderer has reserved for the page. */
export interface BrowserViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A permission a page is waiting on.
 *
 * Presented by Nodus, never by the page: the prompt is drawn in Nodus chrome and
 * the browser view is shrunk to make room, so a site can neither cover it nor
 * imitate it in its own content area.
 */
export interface PendingBrowserPermission {
  id: string;
  /** Electron's own permission name. `media` covers camera and microphone. */
  permission: string;
  origin: string;
  /** For `media`: which of 'video' (camera) / 'audio' (microphone) was asked for. */
  mediaTypes: string[];
}

/**
 * An HTTP authentication challenge a page is waiting on.
 *
 * Presented by Nodus, never by the page: the fields are drawn in Nodus chrome
 * from data Chromium reported, so a site can neither imitate the prompt nor
 * read what was typed. Credentials are answered straight back to Chromium and
 * are never stored by Nodus.
 */
export interface PendingBrowserAuth {
  id: string;
  /** The host that answered, with a non-default port when there is one. */
  host: string;
  /** The server's own realm, verbatim. Empty when it sent none. */
  realm: string;
  /** The page that triggered the challenge. */
  url: string;
  /** True when the challenge came from a proxy (HTTP 407). */
  isProxy: boolean;
}

/** A download in progress or finished, as the renderer sees it. */
export interface BrowserDownloadView {
  id: string;
  filename: string;
  url: string;
  kind: 'pdf' | 'document' | 'dataset' | 'media' | 'other';
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  /** Whether Nodus can offer to file this into the Library. */
  importable: boolean;
  savePath: string | null;
}

/**
 * What the browser keeps on disk.
 *
 * Only `profileBytes` and `cacheBytes` are byte figures, and that is a hard
 * limit rather than a simplification: Chromium exposes no per-category size API
 * through Electron. Everything else is reported as counts, and the UI says so.
 */
export interface BrowserStorageReport {
  profileBytes: number | null;
  cacheBytes: number;
  cookieCount: number;
  cookieSites: number;
  sites: { origin: string; cookies: number }[];
  measuredAt: number;
}

export type BrowserDataCategory =
  | 'cache' | 'cookies' | 'localStorage' | 'indexedDB'
  | 'serviceWorkers' | 'cacheStorage' | 'fileSystems';
