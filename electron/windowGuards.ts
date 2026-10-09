// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Defaults for every window Nodus creates on the DEFAULT session.
 *
 * The main window guards itself (protectMainWindowNavigation), and the Browser tabs live on their
 * own partition with their own handlers. Everything else — Nodi's overlay, the presenter and
 * audience windows — had none, and Electron's defaults are permissive in both places this file
 * covers:
 *
 *  - with no window-open handler, a `target="_blank"` link (a link in model output in Nodi, the
 *    "Watch on YouTube" link of an embed) opens an Electron window on the default session that
 *    the user can browse anywhere from;
 *  - with no permission handler, the default session GRANTS every request, so that page gets the
 *    microphone and camera Nodus already holds, geolocation, notifications and external-protocol
 *    launches without a prompt.
 *
 * Written against small interfaces rather than `electron` itself so it can be tested in Node.
 */

export interface GuardedContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' } | { action: 'allow' }): void;
}

export interface GuardedSession {
  setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: (granted: boolean) => void, details: { requestingUrl?: string }) => void): void;
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string, requestingOrigin: string, details: { requestingUrl?: string }) => boolean): void;
}

export interface GuardedApp {
  on(event: 'web-contents-created', listener: (event: unknown, contents: GuardedContents) => void): unknown;
}

/** What a page that is not Nodus's own may still do on the default session: what an embedded
 *  video needs, and nothing that reaches a device, the user's location or another application. */
const EMBED_PERMISSIONS = new Set(['fullscreen', 'mediaKeySystem', 'clipboard-sanitized-write']);

/** Nodus's own pages: the packaged renderer (file://) or, in development, the Vite server. */
export function isFirstPartyUrl(url: string | undefined, devServerUrl?: string): boolean {
  if (!url) return false;
  try {
    const target = new URL(url);
    if (target.protocol === 'file:') return true;
    if (devServerUrl) return target.origin === new URL(devServerUrl).origin;
  } catch { /* not a URL */ }
  return false;
}

export function defaultSessionPermissionAllowed(permission: string, requestingUrl: string | undefined, devServerUrl?: string): boolean {
  if (isFirstPartyUrl(requestingUrl, devServerUrl)) return true;
  return EMBED_PERMISSIONS.has(permission);
}

export function installDefaultWindowGuards(options: {
  app: GuardedApp;
  session: GuardedSession;
  openExternal: (url: string) => void;
  devServerUrl?: string;
}): void {
  const { app, session, openExternal, devServerUrl } = options;
  // Installed when the contents is created, so a window that sets its own handler afterwards
  // (the main window, Browser tabs, the sandboxes) replaces this default; one that sets none
  // keeps it.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
  });
  session.setPermissionRequestHandler((_webContents, permission, callback, details) =>
    callback(defaultSessionPermissionAllowed(permission, details?.requestingUrl, devServerUrl)));
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    defaultSessionPermissionAllowed(permission, details?.requestingUrl || requestingOrigin, devServerUrl));
}
