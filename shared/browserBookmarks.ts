// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Pure Nodus Bookmarks model.
 *
 * This module deliberately knows nothing about Electron, IPC or files. The main
 * process owns persistence and the trusted React renderer owns presentation;
 * untrusted Browser WebContents never import or receive this model.
 */

export const BROWSER_BOOKMARKS_FORMAT = 'nodus.browser-bookmarks';
export const BROWSER_BOOKMARKS_VERSION = 1;
export const MAX_BOOKMARK_FOLDER_DEPTH = 12;
export const MAX_BOOKMARK_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_BOOKMARKS = 25_000;
export const MAX_BOOKMARK_FOLDERS = 5_000;
export const MAX_FAVICON_DATA_URL_CHARS = 96 * 1024;

export interface BrowserBookmark {
  id: string;
  title: string;
  url: string;
  faviconDataUrl: string | null;
  description: string;
  parentId: string | null;
  order: number;
  /** Starred on the Bookmarks page. Absent in stores written before favourites. */
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserBookmarkFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserBookmarkStore {
  format: typeof BROWSER_BOOKMARKS_FORMAT;
  version: typeof BROWSER_BOOKMARKS_VERSION;
  revision: number;
  folders: BrowserBookmarkFolder[];
  bookmarks: BrowserBookmark[];
}

export interface BrowserBookmarkDraft {
  title: string;
  url: string;
  description?: string;
  faviconDataUrl?: string | null;
  parentId?: string | null;
  favorite?: boolean;
}

export interface BrowserBookmarkFolderDraft {
  name: string;
  parentId?: string | null;
}

export type BrowserBookmarkNodeRef = { kind: 'bookmark' | 'folder'; id: string };

export interface BrowserBookmarkSearchHit {
  bookmark: BrowserBookmark;
  folderPath: string[];
}

export interface BrowserBookmarksImportSummary {
  bookmarks: number;
  folders: number;
  duplicates: number;
  invalidUrls: number;
  truncated: boolean;
}

export interface BrowserBookmarksImportPreview extends BrowserBookmarksImportSummary {
  token: string;
  format: 'json' | 'html';
  fileName: string;
}

export interface BrowserBookmarksExportResult {
  canceled: boolean;
  format: 'json' | 'html';
  bookmarks: number;
  folders: number;
  /** Base name the user accepted in the native dialog, so the UI can confirm it. */
  fileName?: string;
}

export interface BrowserBookmarkCandidate {
  title: string;
  url: string;
  description: string;
  faviconDataUrl: string | null;
  existingId: string | null;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- imported bookmark text is hostile input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export const cleanBookmarkTitle = (value: unknown): string => cleanText(value, 300);
export const cleanBookmarkDescription = (value: unknown): string => cleanText(value, 2_000);
export const cleanBookmarkFolderName = (value: unknown): string => cleanText(value, 120);

/** Only ordinary HTTP(S) websites can become bookmarks. */
export function sanitizeBookmarkUrl(value: unknown): string | null {
  const raw = cleanText(value, 2_048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.username = '';
    parsed.password = '';
    return parsed.href.slice(0, 2_048);
  } catch {
    return null;
  }
}

/** URL identity for duplicate prevention. Fragments never identify a website. */
export function canonicalBookmarkUrl(value: unknown): string | null {
  const safe = sanitizeBookmarkUrl(value);
  if (!safe) return null;
  const parsed = new URL(safe);
  parsed.hash = '';
  if (parsed.pathname === '/') parsed.pathname = '';
  return parsed.href.replace(/\/$/, '');
}

/** Favicons are cached bytes, never arbitrary remote URLs. */
export function sanitizeFaviconDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_FAVICON_DATA_URL_CHARS) return null;
  if (!/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i.test(value)) return null;
  return value;
}

export function emptyBrowserBookmarkStore(): BrowserBookmarkStore {
  return {
    format: BROWSER_BOOKMARKS_FORMAT,
    version: BROWSER_BOOKMARKS_VERSION,
    revision: 0,
    folders: [],
    bookmarks: [],
  };
}

function safeId(value: unknown): string | null {
  const id = cleanText(value, 100);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(id) ? id : null;
}

function iso(value: unknown, fallback: string): string {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function safeOrder(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Number.MAX_SAFE_INTEGER;
}

export function folderDepth(store: BrowserBookmarkStore, id: string | null): number {
  const byId = new Map(store.folders.map((folder) => [folder.id, folder]));
  let depth = 0;
  let current = id;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return MAX_BOOKMARK_FOLDER_DEPTH + 1;
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) return MAX_BOOKMARK_FOLDER_DEPTH + 1;
    depth += 1;
    current = folder.parentId;
  }
  return depth;
}

export function isFolderDescendant(store: BrowserBookmarkStore, candidateId: string | null, ancestorId: string): boolean {
  if (!candidateId) return false;
  const byId = new Map(store.folders.map((folder) => [folder.id, folder]));
  let current: string | null = candidateId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export function browserBookmarkFolderPath(store: BrowserBookmarkStore, id: string | null): string[] {
  const byId = new Map(store.folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  let current = id;
  const seen = new Set<string>();
  while (current && path.length <= MAX_BOOKMARK_FOLDER_DEPTH) {
    if (seen.has(current)) break;
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    path.unshift(folder.name);
    current = folder.parentId;
  }
  return path;
}

export function browserBookmarkChildren(store: BrowserBookmarkStore, parentId: string | null): BrowserBookmarkNodeRef[] {
  const folders = store.folders
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => ({ kind: 'folder' as const, id: folder.id, order: folder.order, label: folder.name }));
  const bookmarks = store.bookmarks
    .filter((bookmark) => bookmark.parentId === parentId)
    .map((bookmark) => ({ kind: 'bookmark' as const, id: bookmark.id, order: bookmark.order, label: bookmark.title }));
  return [...folders, ...bookmarks]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map(({ kind, id }) => ({ kind, id }));
}

function normalizeOrders(store: BrowserBookmarkStore): void {
  const parents = new Set<string | null>([null, ...store.folders.map((folder) => folder.id)]);
  for (const parentId of parents) {
    browserBookmarkChildren(store, parentId).forEach((ref, order) => {
      const item = ref.kind === 'folder'
        ? store.folders.find((folder) => folder.id === ref.id)
        : store.bookmarks.find((bookmark) => bookmark.id === ref.id);
      if (item) item.order = order;
    });
  }
}

/** Parse, sanitize and repair a store before it enters trusted state. */
export function normalizeBrowserBookmarkStore(raw: unknown, now = new Date().toISOString()): BrowserBookmarkStore {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const rawFolders = Array.isArray(source.folders) ? source.folders.slice(0, MAX_BOOKMARK_FOLDERS) : [];
  const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks.slice(0, MAX_BOOKMARKS) : [];
  const folders: BrowserBookmarkFolder[] = [];
  const folderIds = new Set<string>();

  for (const value of rawFolders) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const id = safeId(row.id);
    const name = cleanBookmarkFolderName(row.name);
    if (!id || !name || folderIds.has(id)) continue;
    folderIds.add(id);
    folders.push({
      id,
      name,
      parentId: safeId(row.parentId),
      order: safeOrder(row.order),
      createdAt: iso(row.createdAt, now),
      updatedAt: iso(row.updatedAt, now),
    });
  }

  const draft: BrowserBookmarkStore = {
    format: BROWSER_BOOKMARKS_FORMAT,
    version: BROWSER_BOOKMARKS_VERSION,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    folders,
    bookmarks: [],
  };

  // Broken parents and cycles are repaired to root, never retained as latent
  // corruption that a later drag operation could expose.
  for (const folder of draft.folders) {
    if (!folder.parentId || !folderIds.has(folder.parentId) || folder.parentId === folder.id
      || isFolderDescendant(draft, folder.parentId, folder.id)) folder.parentId = null;
  }
  for (const folder of draft.folders) {
    if (folderDepth(draft, folder.id) > MAX_BOOKMARK_FOLDER_DEPTH) folder.parentId = null;
  }

  const bookmarkIds = new Set<string>();
  for (const value of rawBookmarks) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const id = safeId(row.id);
    const url = sanitizeBookmarkUrl(row.url);
    if (!id || !url || bookmarkIds.has(id)) continue;
    bookmarkIds.add(id);
    const title = cleanBookmarkTitle(row.title) || new URL(url).hostname;
    draft.bookmarks.push({
      id,
      title,
      url,
      faviconDataUrl: sanitizeFaviconDataUrl(row.faviconDataUrl),
      description: cleanBookmarkDescription(row.description),
      parentId: safeId(row.parentId) && folderIds.has(String(row.parentId)) ? String(row.parentId) : null,
      order: safeOrder(row.order),
      favorite: row.favorite === true,
      createdAt: iso(row.createdAt, now),
      updatedAt: iso(row.updatedAt, now),
    });
  }
  normalizeOrders(draft);
  return draft;
}

export function findDuplicateBookmark(store: BrowserBookmarkStore, url: unknown, exceptId?: string): BrowserBookmark | null {
  const canonical = canonicalBookmarkUrl(url);
  if (!canonical) return null;
  return store.bookmarks.find((bookmark) => bookmark.id !== exceptId && canonicalBookmarkUrl(bookmark.url) === canonical) ?? null;
}

function nextOrder(store: BrowserBookmarkStore, parentId: string | null): number {
  return browserBookmarkChildren(store, parentId).length;
}

export function insertBrowserBookmark(
  store: BrowserBookmarkStore,
  draft: BrowserBookmarkDraft,
  id: string,
  now = new Date().toISOString(),
): { store: BrowserBookmarkStore; bookmark: BrowserBookmark; duplicate: BrowserBookmark | null } {
  const next = normalizeBrowserBookmarkStore(store, now);
  const url = sanitizeBookmarkUrl(draft.url);
  if (!url) throw new Error('La dirección del marcador debe ser una URL HTTP o HTTPS válida.');
  const duplicate = findDuplicateBookmark(next, url);
  if (duplicate) return { store: next, bookmark: duplicate, duplicate };
  const parentId = draft.parentId && next.folders.some((folder) => folder.id === draft.parentId) ? draft.parentId : null;
  const bookmark: BrowserBookmark = {
    id: safeId(id) ?? `bookmark-${Date.now()}`,
    title: cleanBookmarkTitle(draft.title) || new URL(url).hostname,
    url,
    faviconDataUrl: sanitizeFaviconDataUrl(draft.faviconDataUrl),
    description: cleanBookmarkDescription(draft.description),
    parentId,
    order: nextOrder(next, parentId),
    favorite: draft.favorite === true,
    createdAt: now,
    updatedAt: now,
  };
  next.bookmarks.push(bookmark);
  next.revision += 1;
  return { store: next, bookmark, duplicate: null };
}

export function updateBrowserBookmark(
  store: BrowserBookmarkStore,
  id: string,
  patch: Partial<BrowserBookmarkDraft>,
  now = new Date().toISOString(),
): BrowserBookmarkStore {
  const next = normalizeBrowserBookmarkStore(store, now);
  const bookmark = next.bookmarks.find((entry) => entry.id === id);
  if (!bookmark) throw new Error('El marcador ya no existe.');
  if (patch.url !== undefined) {
    const url = sanitizeBookmarkUrl(patch.url);
    if (!url) throw new Error('La dirección del marcador debe ser una URL HTTP o HTTPS válida.');
    if (findDuplicateBookmark(next, url, id)) throw new Error('Esa página ya está guardada en Nodus Bookmarks.');
    bookmark.url = url;
  }
  if (patch.title !== undefined) bookmark.title = cleanBookmarkTitle(patch.title) || new URL(bookmark.url).hostname;
  if (patch.description !== undefined) bookmark.description = cleanBookmarkDescription(patch.description);
  if (patch.faviconDataUrl !== undefined) bookmark.faviconDataUrl = sanitizeFaviconDataUrl(patch.faviconDataUrl);
  if (patch.favorite !== undefined) bookmark.favorite = patch.favorite === true;
  if (patch.parentId !== undefined) bookmark.parentId = patch.parentId && next.folders.some((folder) => folder.id === patch.parentId) ? patch.parentId : null;
  bookmark.updatedAt = now;
  normalizeOrders(next);
  next.revision += 1;
  return next;
}

export function insertBrowserBookmarkFolder(
  store: BrowserBookmarkStore,
  draft: BrowserBookmarkFolderDraft,
  id: string,
  now = new Date().toISOString(),
): { store: BrowserBookmarkStore; folder: BrowserBookmarkFolder } {
  const next = normalizeBrowserBookmarkStore(store, now);
  const name = cleanBookmarkFolderName(draft.name);
  if (!name) throw new Error('La carpeta necesita un nombre.');
  const parentId = draft.parentId && next.folders.some((folder) => folder.id === draft.parentId) ? draft.parentId : null;
  if (folderDepth(next, parentId) >= MAX_BOOKMARK_FOLDER_DEPTH) throw new Error('La jerarquía de carpetas es demasiado profunda.');
  const sibling = next.folders.find((folder) => folder.parentId === parentId && folder.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
  if (sibling) return { store: next, folder: sibling };
  const folder: BrowserBookmarkFolder = {
    id: safeId(id) ?? `folder-${Date.now()}`,
    name,
    parentId,
    order: nextOrder(next, parentId),
    createdAt: now,
    updatedAt: now,
  };
  next.folders.push(folder);
  next.revision += 1;
  return { store: next, folder };
}

export function updateBrowserBookmarkFolder(
  store: BrowserBookmarkStore,
  id: string,
  patch: Partial<BrowserBookmarkFolderDraft>,
  now = new Date().toISOString(),
): BrowserBookmarkStore {
  const next = normalizeBrowserBookmarkStore(store, now);
  const folder = next.folders.find((entry) => entry.id === id);
  if (!folder) throw new Error('La carpeta ya no existe.');
  if (patch.name !== undefined) {
    const name = cleanBookmarkFolderName(patch.name);
    if (!name) throw new Error('La carpeta necesita un nombre.');
    folder.name = name;
  }
  if (patch.parentId !== undefined) {
    const parentId = patch.parentId && next.folders.some((entry) => entry.id === patch.parentId) ? patch.parentId : null;
    if (parentId === id || isFolderDescendant(next, parentId, id)) throw new Error('Una carpeta no puede moverse dentro de sí misma.');
    if (folderDepth(next, parentId) >= MAX_BOOKMARK_FOLDER_DEPTH) throw new Error('La jerarquía de carpetas es demasiado profunda.');
    folder.parentId = parentId;
    if (next.folders.some((entry) => folderDepth(next, entry.id) > MAX_BOOKMARK_FOLDER_DEPTH)) {
      throw new Error('La jerarquía de carpetas es demasiado profunda.');
    }
  }
  folder.updatedAt = now;
  normalizeOrders(next);
  next.revision += 1;
  return next;
}

export function deleteBrowserBookmarkNode(store: BrowserBookmarkStore, ref: BrowserBookmarkNodeRef): BrowserBookmarkStore {
  const next = normalizeBrowserBookmarkStore(store);
  if (ref.kind === 'bookmark') {
    next.bookmarks = next.bookmarks.filter((bookmark) => bookmark.id !== ref.id);
  } else {
    const removed = new Set<string>([ref.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of next.folders) {
        if (folder.parentId && removed.has(folder.parentId) && !removed.has(folder.id)) {
          removed.add(folder.id);
          changed = true;
        }
      }
    }
    next.folders = next.folders.filter((folder) => !removed.has(folder.id));
    next.bookmarks = next.bookmarks.filter((bookmark) => !bookmark.parentId || !removed.has(bookmark.parentId));
  }
  normalizeOrders(next);
  next.revision += 1;
  return next;
}

export function moveBrowserBookmarkNode(
  store: BrowserBookmarkStore,
  ref: BrowserBookmarkNodeRef,
  parentId: string | null,
  index: number,
  now = new Date().toISOString(),
): BrowserBookmarkStore {
  const next = normalizeBrowserBookmarkStore(store, now);
  const targetParent = parentId && next.folders.some((folder) => folder.id === parentId) ? parentId : null;
  if (ref.kind === 'folder') {
    const folder = next.folders.find((entry) => entry.id === ref.id);
    if (!folder) throw new Error('La carpeta ya no existe.');
    if (targetParent === ref.id || isFolderDescendant(next, targetParent, ref.id)) throw new Error('Una carpeta no puede moverse dentro de sí misma ni de sus descendientes.');
    if (folderDepth(next, targetParent) >= MAX_BOOKMARK_FOLDER_DEPTH) throw new Error('La jerarquía de carpetas es demasiado profunda.');
    folder.parentId = targetParent;
    if (next.folders.some((entry) => folderDepth(next, entry.id) > MAX_BOOKMARK_FOLDER_DEPTH)) {
      throw new Error('La jerarquía de carpetas es demasiado profunda.');
    }
    folder.updatedAt = now;
  } else {
    const bookmark = next.bookmarks.find((entry) => entry.id === ref.id);
    if (!bookmark) throw new Error('El marcador ya no existe.');
    bookmark.parentId = targetParent;
    bookmark.updatedAt = now;
  }

  const siblings = browserBookmarkChildren(next, targetParent).filter((entry) => !(entry.kind === ref.kind && entry.id === ref.id));
  siblings.splice(Math.max(0, Math.min(siblings.length, Math.floor(Number(index) || 0))), 0, ref);
  siblings.forEach((entry, order) => {
    const item = entry.kind === 'folder'
      ? next.folders.find((folder) => folder.id === entry.id)
      : next.bookmarks.find((bookmark) => bookmark.id === entry.id);
    if (item) item.order = order;
  });
  normalizeOrders(next);
  next.revision += 1;
  return next;
}

function fold(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function searchBrowserBookmarks(store: BrowserBookmarkStore, query: string): BrowserBookmarkSearchHit[] {
  const q = fold(cleanText(query, 300));
  if (!q) return store.bookmarks.map((bookmark) => ({ bookmark, folderPath: browserBookmarkFolderPath(store, bookmark.parentId) }));
  return store.bookmarks.flatMap((bookmark) => {
    const folderPath = browserBookmarkFolderPath(store, bookmark.parentId);
    const haystack = fold([bookmark.title, bookmark.url, new URL(bookmark.url).hostname, bookmark.description, ...folderPath].join(' '));
    return haystack.includes(q) ? [{ bookmark, folderPath }] : [];
  });
}

/**
 * How the Bookmarks page lays out what it shows. Display only: the manual
 * `order` the manager and drag-and-drop keep is never rewritten by a sort.
 */
export const BROWSER_BOOKMARK_SORTS = [
  'recent', 'oldest',
  'alpha', 'alpha-desc',
  'folders-alpha', 'folders-alpha-desc',
  'favorites-first', 'favorites-only',
] as const;
export type BrowserBookmarkSort = (typeof BROWSER_BOOKMARK_SORTS)[number];
export const DEFAULT_BROWSER_BOOKMARK_SORT: BrowserBookmarkSort = 'recent';

export function isBrowserBookmarkSort(value: unknown): value is BrowserBookmarkSort {
  return (BROWSER_BOOKMARK_SORTS as readonly unknown[]).includes(value);
}

const bookmarkCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The folders and bookmarks the Bookmarks page shows inside `parentId`, in the
 * chosen order. Folders and bookmarks share one list, so a date or an
 * alphabetical sort interleaves them; only the "folders first" sorts keep them
 * apart. "Favorites only" is a view of the whole collection, not of one folder:
 * a starred page is wanted wherever it was filed.
 */
export function sortBrowserBookmarkItems(
  store: BrowserBookmarkStore,
  parentId: string | null,
  sort: BrowserBookmarkSort,
): BrowserBookmarkNodeRef[] {
  type Row = { kind: 'folder' | 'bookmark'; id: string; label: string; time: number; favorite: boolean };
  const rows: Row[] = [];
  if (sort !== 'favorites-only') {
    for (const folder of store.folders) {
      if (folder.parentId === parentId) rows.push({ kind: 'folder', id: folder.id, label: folder.name, time: Date.parse(folder.createdAt) || 0, favorite: false });
    }
  }
  for (const bookmark of store.bookmarks) {
    if (sort === 'favorites-only' ? !bookmark.favorite : bookmark.parentId !== parentId) continue;
    rows.push({ kind: 'bookmark', id: bookmark.id, label: bookmark.title, time: Date.parse(bookmark.createdAt) || 0, favorite: bookmark.favorite });
  }
  const alpha = (a: Row, b: Row) => bookmarkCollator.compare(a.label, b.label) || a.id.localeCompare(b.id);
  const newest = (a: Row, b: Row) => b.time - a.time || alpha(a, b);
  const foldersFirst = (a: Row, b: Row) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1);
  const compare: Record<BrowserBookmarkSort, (a: Row, b: Row) => number> = {
    recent: newest,
    oldest: (a, b) => a.time - b.time || alpha(a, b),
    alpha,
    'alpha-desc': (a, b) => alpha(b, a),
    'folders-alpha': (a, b) => foldersFirst(a, b) || alpha(a, b),
    'folders-alpha-desc': (a, b) => foldersFirst(a, b) || alpha(b, a),
    // Favourites A-Z on top; everything else keeps the default, newest first.
    'favorites-first': (a, b) => Number(b.favorite) - Number(a.favorite) || (a.favorite ? alpha(a, b) : newest(a, b)),
    'favorites-only': alpha,
  };
  return rows.sort(compare[sort]).map(({ kind, id }) => ({ kind, id }));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  // Tags are dropped BEFORE entities are decoded: a title that legitimately
  // contains "&lt;tag&gt;" must keep those characters, and only markup that was
  // markup in the file itself is removed.
  return value.replace(/<[^>]*>/g, '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (_all, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Math.min(0x10ffff, Number(dec)));
    if (hex) return String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(hex, 16)));
    return named[String(name).toLowerCase()] ?? '';
  });
}

function htmlAttribute(source: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(source);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

/**
 * Suggested name for the native save dialog: `nodus-bookmarks-YYYY-MM-DD.<format>`.
 *
 * The stamp is the user's LOCAL date, not UTC: the name is read as "the backup I
 * took today", so a late-evening export must not be dated tomorrow or yesterday.
 */
export function browserBookmarksExportFileName(format: 'json' | 'html', date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `nodus-bookmarks-${stamp}.${format}`;
}

export function exportBrowserBookmarksJson(store: BrowserBookmarkStore): string {
  return `${JSON.stringify(normalizeBrowserBookmarkStore(store), null, 2)}\n`;
}

export function exportBrowserBookmarksHtml(store: BrowserBookmarkStore): string {
  const safe = normalizeBrowserBookmarkStore(store);
  const bookmarkById = new Map(safe.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const folderById = new Map(safe.folders.map((folder) => [folder.id, folder]));
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Nodus Bookmarks</TITLE>',
    '<H1>Nodus Bookmarks</H1>',
    '<DL><p>',
  ];
  const emit = (parentId: string | null, indent: string) => {
    for (const ref of browserBookmarkChildren(safe, parentId)) {
      if (ref.kind === 'folder') {
        const folder = folderById.get(ref.id)!;
        lines.push(`${indent}<DT><H3 ADD_DATE="${Math.floor(Date.parse(folder.createdAt) / 1000)}">${escapeHtml(folder.name)}</H3>`);
        lines.push(`${indent}<DL><p>`);
        emit(folder.id, `${indent}    `);
        lines.push(`${indent}</DL><p>`);
      } else {
        const bookmark = bookmarkById.get(ref.id)!;
        const icon = bookmark.faviconDataUrl ? ` ICON="${escapeHtml(bookmark.faviconDataUrl)}"` : '';
        lines.push(`${indent}<DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${Math.floor(Date.parse(bookmark.createdAt) / 1000)}"${icon}>${escapeHtml(bookmark.title)}</A>`);
        if (bookmark.description) lines.push(`${indent}<DD>${escapeHtml(bookmark.description)}`);
      }
    }
  };
  emit(null, '    ');
  lines.push('</DL><p>', '');
  return lines.join('\n');
}

export function parseBrowserBookmarksJson(source: string): BrowserBookmarkStore {
  if (source.length > MAX_BOOKMARK_IMPORT_BYTES) throw new Error('El archivo de marcadores es demasiado grande.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('El JSON de marcadores no es válido.'); }
  const store = normalizeBrowserBookmarkStore(parsed);
  if ((parsed as { format?: unknown } | null)?.format !== BROWSER_BOOKMARKS_FORMAT) throw new Error('El archivo no es una exportación de Nodus Bookmarks.');
  return store;
}

export function parseBrowserBookmarksHtml(
  source: string,
  makeId: () => string,
  now = new Date().toISOString(),
): { store: BrowserBookmarkStore; invalidUrls: number; truncated: boolean } {
  if (source.length > MAX_BOOKMARK_IMPORT_BYTES) throw new Error('El archivo HTML de marcadores es demasiado grande.');
  const store = emptyBrowserBookmarkStore();
  const stack: Array<string | null> = [null];
  let pendingFolder: string | null = null;
  let lastBookmark: BrowserBookmark | null = null;
  let invalidUrls = 0;
  let truncated = false;
  const token = /<\s*(\/?)\s*(DL|H3|A|DD)\b([^>]*)>(?:([^<]*(?:<(?!\s*\/?\s*(?:DL|H3|A|DD)\b)[^<]*)*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toUpperCase();
    const attrs = match[3] ?? '';
    const text = decodeHtml(match[4] ?? '');
    if (tag === 'H3' && !closing) {
      if (store.folders.length >= MAX_BOOKMARK_FOLDERS) { truncated = true; continue; }
      const name = cleanBookmarkFolderName(text);
      if (!name) continue;
      const folder: BrowserBookmarkFolder = {
        id: makeId(), name, parentId: stack.at(-1) ?? null,
        order: browserBookmarkChildren(store, stack.at(-1) ?? null).length,
        createdAt: now, updatedAt: now,
      };
      store.folders.push(folder);
      pendingFolder = folder.id;
      lastBookmark = null;
    } else if (tag === 'DL') {
      if (!closing) {
        if (pendingFolder) { stack.push(pendingFolder); pendingFolder = null; }
      } else if (stack.length > 1) {
        stack.pop();
      }
    } else if (tag === 'A' && !closing) {
      if (store.bookmarks.length >= MAX_BOOKMARKS) { truncated = true; continue; }
      const url = sanitizeBookmarkUrl(htmlAttribute(attrs, 'HREF'));
      if (!url) { invalidUrls += 1; continue; }
      const title = cleanBookmarkTitle(text) || new URL(url).hostname;
      const bookmark: BrowserBookmark = {
        id: makeId(), title, url,
        faviconDataUrl: sanitizeFaviconDataUrl(htmlAttribute(attrs, 'ICON')),
        description: '', parentId: stack.at(-1) ?? null,
        order: browserBookmarkChildren(store, stack.at(-1) ?? null).length,
        favorite: false,
        createdAt: now, updatedAt: now,
      };
      store.bookmarks.push(bookmark);
      lastBookmark = bookmark;
    } else if (tag === 'DD' && !closing && lastBookmark) {
      lastBookmark.description = cleanBookmarkDescription(text);
    }
  }
  return { store: normalizeBrowserBookmarkStore(store, now), invalidUrls, truncated };
}

export function mergeBrowserBookmarkStores(
  existing: BrowserBookmarkStore,
  incoming: BrowserBookmarkStore,
  makeId: () => string,
  now = new Date().toISOString(),
): { store: BrowserBookmarkStore; summary: BrowserBookmarksImportSummary } {
  const next = normalizeBrowserBookmarkStore(existing, now);
  const source = normalizeBrowserBookmarkStore(incoming, now);
  const usedIds = new Set([...next.folders.map((folder) => folder.id), ...next.bookmarks.map((bookmark) => bookmark.id)]);
  const folderMap = new Map<string, string>();
  let folderCount = 0;
  let bookmarkCount = 0;
  let duplicates = 0;

  const orderedFolders = [...source.folders].sort((a, b) => folderDepth(source, a.id) - folderDepth(source, b.id) || a.order - b.order);
  for (const folder of orderedFolders) {
    if (next.folders.length >= MAX_BOOKMARK_FOLDERS) break;
    let id = safeId(folder.id) ?? makeId();
    if (usedIds.has(id)) id = makeId();
    usedIds.add(id);
    const parentId = folder.parentId ? folderMap.get(folder.parentId) ?? null : null;
    const inserted = insertBrowserBookmarkFolder(next, { name: folder.name, parentId }, id, folder.createdAt || now);
    Object.assign(next, inserted.store);
    folderMap.set(folder.id, inserted.folder.id);
    folderCount += 1;
  }

  for (const bookmark of [...source.bookmarks].sort((a, b) => a.order - b.order)) {
    if (next.bookmarks.length >= MAX_BOOKMARKS) break;
    if (findDuplicateBookmark(next, bookmark.url)) { duplicates += 1; continue; }
    let id = safeId(bookmark.id) ?? makeId();
    if (usedIds.has(id)) id = makeId();
    usedIds.add(id);
    const parentId = bookmark.parentId ? folderMap.get(bookmark.parentId) ?? null : null;
    const inserted = insertBrowserBookmark(next, { ...bookmark, parentId }, id, bookmark.createdAt || now);
    Object.assign(next, inserted.store);
    if (!inserted.duplicate) bookmarkCount += 1;
    else duplicates += 1;
  }
  next.revision = normalizeBrowserBookmarkStore(existing).revision + 1;
  return {
    store: normalizeBrowserBookmarkStore(next, now),
    summary: {
      bookmarks: bookmarkCount,
      folders: folderCount,
      duplicates,
      invalidUrls: 0,
      truncated: source.bookmarks.length > bookmarkCount + duplicates || source.folders.length > folderCount,
    },
  };
}
