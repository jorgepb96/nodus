// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Downloads started from a Nodus Browser tab.
 *
 * Two rules shape this file.
 *
 * Nodus never opens what it downloaded. There is no shell.openPath on
 * completion, ever, under any classification — a browser that launches a file it
 * just fetched from the web is one click away from being the delivery mechanism.
 *
 * And a download that could belong in the Library is offered to it rather than
 * routed there. The user chooses; a browser that silently files things is a
 * browser you cannot use to fetch an ordinary file.
 */

import { app, type DownloadItem, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  availableDownloadPath,
  classifyDownload,
  isImportable,
  isTooLarge,
  safeBrowserDownloadName,
  type DownloadKind,
} from '@shared/browserDownloads';

export interface BrowserDownload {
  id: string;
  filename: string;
  url: string;
  kind: DownloadKind;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  /** Whether Nodus can offer to file this into the Library. */
  importable: boolean;
  /** Set once the file has landed, so an import can read it. */
  savePath: string | null;
}

const downloads = new Map<string, BrowserDownload>();
const items = new Map<string, DownloadItem>();
let notify: (() => void) | null = null;
let counter = 0;

export function setDownloadNotifier(callback: (() => void) | null): void {
  notify = callback;
}

export function browserDownloads(): BrowserDownload[] {
  return [...downloads.values()].map((entry) => ({ ...entry }));
}

/** Downloads which would be interrupted by a Browser subsystem restart. */
export function activeBrowserDownloadCount(): number {
  let active = 0;
  for (const entry of downloads.values()) {
    if (entry.state === 'progressing' || entry.state === 'paused') active += 1;
  }
  return active;
}

/**
 * Stop Browser-owned transfers and forget the transient downloads UI state.
 *
 * Downloaded files are deliberately left on disk. The persistent Chromium
 * session is also untouched; this only releases live DownloadItem handles and
 * the in-memory list owned by the current Browser runtime.
 */
export function resetBrowserDownloads(): void {
  for (const [id, item] of items) {
    const state = downloads.get(id)?.state;
    if (state === 'progressing' || state === 'paused') item.cancel();
  }
  items.clear();
  downloads.clear();
  // Keep ids monotonic. A cancelled DownloadItem emits `done` asynchronously;
  // reusing its id for a new post-restart download would let that late event
  // overwrite the new record.
  notify?.();
}

/** Forget a finished download. The file on disk is untouched. */
export function dismissDownload(id: string): void {
  downloads.delete(id);
  items.delete(id);
  notify?.();
}

export function cancelDownload(id: string): void {
  items.get(id)?.cancel();
}

export function installDownloadHandling(ses: Session, defaultFolder: () => string | null): void {
  ses.on('will-download', (_event, item) => {
    counter += 1;
    const id = `dl-${counter}`;
    const filename = safeBrowserDownloadName(item.getFilename());
    const totalBytes = item.getTotalBytes();

    if (isTooLarge(totalBytes)) {
      // Refused before a byte is written rather than filling the disk and
      // failing later.
      item.cancel();
      return;
    }

    const kind = classifyDownload(filename, item.getMimeType());
    const record: BrowserDownload = {
      id,
      filename,
      url: item.getURL(),
      kind,
      totalBytes,
      receivedBytes: 0,
      state: 'progressing',
      importable: isImportable(kind, totalBytes),
      savePath: null,
    };

    const folder = defaultFolder();
    if (folder) {
      item.setSavePath(availableDownloadPath(folder, filename, (candidate) => fs.existsSync(candidate), path.join));
    } else {
      // No configured folder: let Electron show its own save dialog, seeded with
      // the platform's Downloads directory.
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), filename) });
    }

    downloads.set(id, record);
    items.set(id, item);
    notify?.();

    item.on('updated', (_updatedEvent, state) => {
      const current = downloads.get(id);
      if (!current) return;
      current.receivedBytes = item.getReceivedBytes();
      if (isTooLarge(current.receivedBytes)) {
        item.cancel();
        current.state = 'cancelled';
        current.importable = false;
        notify?.();
        return;
      }
      current.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      notify?.();
    });

    item.once('done', (_doneEvent, state) => {
      const current = downloads.get(id);
      if (!current) return;
      current.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      current.receivedBytes = item.getReceivedBytes();
      current.savePath = state === 'completed' ? item.getSavePath() : null;
      // A file that arrived larger than the import cap allows must not still
      // offer an import: the length was unknown or wrong when it started.
      if (current.savePath) current.importable = isImportable(current.kind, current.receivedBytes);
      items.delete(id);
      notify?.();
      // Deliberately nothing else. No opening, no revealing, no auto-import.
    });
  });
}

/** The path of a completed download, for the Library import path. */
export function completedDownloadPath(id: string): string | null {
  const record = downloads.get(id);
  return record && record.state === 'completed' ? record.savePath : null;
}
