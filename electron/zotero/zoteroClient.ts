import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary, ZoteroPingResult, WorkMeta } from '@shared/types';
import { bibliographicPlainText } from '@shared/bibliographicText';

// Read-only client for Zotero's local API: the desktop app's local implementation
// of Web API v3, served from port 23119 since Zotero 7. There is no "Zotero 7 API" —
// the API version is 3, and Zotero supports exactly one version at a time. Requires
// Zotero 7 or newer. Never writes to Zotero, never touches zotero.sqlite directly.

// Zotero's HTTP server binds specifically to IPv4 loopback. Using the literal address
// avoids depending on how a user's `localhost` resolves (or whether a proxy intercepts
// it), while still sending a Host value accepted by Zotero's DNS-rebinding guard.
export const ZOTERO_API_BASE = process.env.NODUS_ZOTERO_API_BASE?.trim() || 'http://127.0.0.1:23119/api';

// The local API accepts `0` as the user ID (the real numeric userID works too;
// anything else answers 400), so we always address the local library as `users/0`.
export const LOCAL_USER_ID = '0';
export const PERSONAL_LIBRARY: ZoteroLibrary = { type: 'user', id: LOCAL_USER_ID, name: 'Mi biblioteca' };

const HEADERS: Record<string, string> = {
  // Load-bearing, do not remove: this is Zotero's DNS-rebinding guard. Against a
  // Mozilla/* User-Agent (Electron's) without this header, Zotero closes the TCP
  // connection outright — not a 403, so callers see a socket error rather than an
  // HTTP status. Verified against Zotero 9.0.6.
  // https://www.zotero.org/support/dev/web_api/v3/local_api
  'Zotero-Allowed-Request': '1',
  // Zotero currently supports exactly API v3 locally. Sending the version explicitly
  // follows the production-client recommendation and prevents a future default from
  // silently changing the response contract beneath the importer.
  'Zotero-API-Version': '3',
};

export class ZoteroRequestError extends Error {
  constructor(
    message: string,
    readonly code: 'zotero-closed' | 'credentials-expired' | 'rate-limited' | 'library-missing' | 'permission' | 'network' | 'invalid-response',
    readonly status: number | null,
    readonly retryable: boolean,
  ) { super(message); this.name = 'ZoteroRequestError'; }
}

function retryDelay(response: Response | null, attempt: number): number {
  const header = response?.headers.get('Retry-After');
  const retryAfter = header === null || header === undefined ? Number.NaN : Number(header);
  return Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(2_000, retryAfter * 1_000) : attempt * 150;
}

async function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Solicitud cancelada', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Solicitud cancelada', 'AbortError'));
    };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ZoteroRequestBudget { remaining: number }

async function zfetch(url: string, signal?: AbortSignal, init: RequestInit = {}, budget?: ZoteroRequestBudget): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      signal?.throwIfAborted();
      if (budget) {
        if (budget.remaining <= 0) throw new ZoteroRequestError('Se agotó el presupuesto de comprobaciones de Zotero.', 'rate-limited', null, true);
        budget.remaining -= 1;
      }
      const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) }, signal });
      if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
        await waitForRetry(retryDelay(response, attempt), signal);
        continue;
      }
      if (response.status === 401) throw new ZoteroRequestError('Las credenciales de Zotero han caducado.', 'credentials-expired', 401, false);
      if (response.status === 403) throw new ZoteroRequestError('Zotero rechazó el acceso a esta biblioteca.', 'permission', 403, false);
      if (response.status === 429) throw new ZoteroRequestError('Zotero mantiene temporalmente limitado el acceso.', 'rate-limited', 429, true);
      if (response.status >= 500) throw new ZoteroRequestError(`Zotero respondió HTTP ${response.status}.`, 'network', response.status, true);
      return response;
    } catch (error) {
      if (error instanceof ZoteroRequestError || signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      if (attempt < 3) { await waitForRetry(retryDelay(null, attempt), signal); continue; }
      const message = error instanceof Error ? error.message : String(error);
      throw new ZoteroRequestError(`No se pudo conectar con Zotero: ${message}`, /ECONNREFUSED|fetch failed|socket/i.test(message) ? 'zotero-closed' : 'network', null, true);
    }
  }
  throw new ZoteroRequestError('No se pudo conectar con Zotero.', 'network', null, true);
}

function endpointError(context: string, response: Response): ZoteroRequestError {
  return new ZoteroRequestError(
    response.status === 404 ? `La biblioteca de Zotero ya no existe: ${context}.` : `${context}: HTTP ${response.status}`,
    response.status === 404 ? 'library-missing' : 'invalid-response', response.status, false,
  );
}

function libraryPrefix(library: ZoteroLibrary): string {
  return library.type === 'group' ? `groups/${encodeURIComponent(library.id)}` : `users/${encodeURIComponent(library.id || LOCAL_USER_ID)}`;
}

function canonicalKey(library: ZoteroLibrary, rawKey: string): string {
  return library.type === 'group' ? `groups:${library.id}:${rawKey}` : rawKey;
}

function parseCanonicalKey(key: string, fallback: ZoteroLibrary = PERSONAL_LIBRARY): { library: ZoteroLibrary; rawKey: string } {
  const match = /^groups:([^:]+):(.+)$/.exec(key);
  if (!match) return { library: fallback, rawKey: key };
  return { library: { type: 'group', id: match[1], name: fallback.type === 'group' && fallback.id === match[1] ? fallback.name : `Grupo ${match[1]}` }, rawKey: match[2] };
}

export async function libraries(signal?: AbortSignal): Promise<ZoteroLibrary[]> {
  const limit = 100;
  let previousSignature: string | null = null;
  let previousGroups: ZoteroLibrary[] = [];

  // The groups endpoint has no library-version barrier. Offset pagination can shift
  // while a group is added/removed, producing one duplicate and silently omitting a
  // library. Require two identical, complete traversals before exposing the snapshot.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const byId = new Map<string, ZoteroLibrary>();
    let start = 0;
    let declaredTotal: number | null = null;
    let complete = true;
    for (;;) {
      const res = await zfetch(`${ZOTERO_API_BASE}/users/${LOCAL_USER_ID}/groups?limit=${limit}&start=${start}`, signal);
      if (!res.ok) throw endpointError('Bibliotecas de grupo de Zotero', res);
      const page = (await res.json().catch(() => [])) as any[];
      if (!Array.isArray(page)) {
        throw new ZoteroRequestError('Zotero devolvió un inventario de grupos inválido.', 'invalid-response', res.status, true);
      }
      const header = res.headers.get('Total-Results');
      if (header !== null) {
        const total = Number(header);
        if (!Number.isFinite(total) || total < 0 || (declaredTotal !== null && declaredTotal !== total)) complete = false;
        else declaredTotal = total;
      }
      for (const raw of page) {
        const id = String(raw.id ?? raw.data?.id ?? raw.library?.id ?? '');
        if (!id || byId.has(id)) { complete = false; continue; }
        byId.set(id, {
          type: 'group', id,
          name: String(raw.data?.name ?? raw.name ?? raw.library?.name ?? 'Grupo de Zotero'),
        });
      }
      start += page.length;
      if (page.length === 0 || page.length < limit || (declaredTotal !== null && start >= declaredTotal)) break;
    }
    if (declaredTotal !== null && byId.size !== declaredTotal) complete = false;
    const groups = [...byId.values()];
    const signature = JSON.stringify(groups
      .map((group) => [group.id, group.name])
      .sort(([left], [right]) => left.localeCompare(right)));
    if (complete && signature === previousSignature) return [PERSONAL_LIBRARY, ...groups];
    if (complete) {
      previousSignature = signature;
      previousGroups = groups;
    } else {
      previousSignature = null;
      previousGroups = [];
    }
  }
  throw new ZoteroRequestError(
    `El inventario de bibliotecas de Zotero cambió durante el recorrido${previousGroups.length ? ` (${previousGroups.length} grupos observados)` : ''}; vuelve a intentarlo.`,
    'invalid-response', null, true,
  );
}

/**
 * Verify the local API is reachable. The local API has no auth and uses users/0,
 * so we just confirm a 200 and read the library version header.
 *
 * `message` stays technical (the transport error, or the HTTP status): the renderer
 * localizes the actionable part from `reason`, so no Spanish is written here.
 */
export async function ping(): Promise<ZoteroPingResult> {
  try {
    const res = await zfetch(`${ZOTERO_API_BASE}/users/${LOCAL_USER_ID}/items?limit=1`);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, reason: res.status === 403 ? 'forbidden' : 'http' };
    const v = res.headers.get('Last-Modified-Version');
    return { ok: true, userId: LOCAL_USER_ID, version: v ? parseInt(v, 10) : 0 };
  } catch (e) {
    // Nothing answered on the local port: Zotero is closed, or its local API is off.
    return { ok: false, message: (e as Error).message, reason: 'unreachable' };
  }
}

/** Library version is returned in the Last-Modified-Version response header. */
export async function libraryVersion(
  userId: string,
  library: ZoteroLibrary = { ...PERSONAL_LIBRARY, id: userId },
  signal?: AbortSignal,
): Promise<number> {
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/items?limit=1`, signal);
  if (!res.ok) throw endpointError('Versión de la biblioteca de Zotero', res);
  const v = res.headers.get('Last-Modified-Version');
  return v ? parseInt(v, 10) : 0;
}

function mapCollection(raw: any, library: ZoteroLibrary): ZoteroCollection {
  const itemKey = raw.key ?? raw.data?.key;
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    name: raw.data?.name ?? raw.name ?? '(sin nombre)',
    parentCollection: raw.data?.parentCollection ? canonicalKey(library, raw.data.parentCollection) : false,
    // meta.numItems counts ONLY items directly in the collection (not subcollections).
    itemCount: raw.meta?.numItems ?? 0,
    subCount: raw.meta?.numCollections ?? 0,
  };
}

export async function topCollections(userId: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroCollection[]> {
  const library = requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId };
  const out: ZoteroCollection[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/collections/top?limit=${limit}&start=${start}`);
    if (!res.ok) throw endpointError('Colecciones de Zotero', res);
    const data = (await res.json()) as any[];
    out.push(...data.map((raw) => mapCollection(raw, library)));
    start += data.length;
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    if (data.length === 0 || data.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function childCollections(userId: string, parentKey: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroCollection[]> {
  const parsed = parseCanonicalKey(parentKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const out: ZoteroCollection[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/collections/${encodeURIComponent(parsed.rawKey)}/collections?limit=${limit}&start=${start}`);
    if (!res.ok) throw endpointError('Subcolecciones de Zotero', res);
    const data = (await res.json()) as any[];
    out.push(...data.map((raw) => mapCollection(raw, parsed.library)));
    start += data.length;
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    if (data.length === 0 || data.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function yearFromDate(date?: string): number | null {
  if (!date) return null;
  const m = /(\d{4})/.exec(date);
  return m ? parseInt(m[1], 10) : null;
}

function mapItem(raw: any, library: ZoteroLibrary): ZoteroItem {
  const d = raw.data ?? {};
  const rawTitle = String(d.title ?? d.shortTitle ?? '(sin título)');
  const plainTitle = bibliographicPlainText(rawTitle) || '(sin título)';
  const creators = (d.creators ?? []).map((c: any) => ({
    lastName: c.lastName ?? '',
    firstName: c.firstName ?? '',
    name: c.name,
    creatorType: c.creatorType ?? 'author',
  }));
  const itemKey = d.key ?? raw.key;
  const represented = new Set([
    'key', 'version', 'itemType', 'title', 'shortTitle', 'creators', 'date', 'DOI', 'abstractNote', 'tags', 'collections',
    'publisher', 'publicationTitle', 'bookTitle', 'proceedingsTitle', 'ISBN', 'ISSN', 'url', 'language', 'volume', 'issue',
    'pages', 'edition', 'place', 'rights', 'extra', 'dateAdded', 'dateModified', 'relations',
  ]);
  const fields: Record<string, string> = Object.fromEntries(Object.entries(d as Record<string, unknown>).flatMap(([name, value]) => {
    if (represented.has(name) || !['string', 'number', 'boolean'].includes(typeof value)) return [];
    const clean = String(value).trim(); return clean ? [[name, clean]] : [];
  }));
  // Keep Zotero distinctions that do not have a first-class Nodus field. They remain
  // searchable/exportable through metadata.extra instead of being silently collapsed
  // (for example bookTitle/proceedingsTitle both map to publicationTitle).
  for (const name of ['shortTitle', 'bookTitle', 'proceedingsTitle'] as const) {
    const clean = typeof d[name] === 'string' ? d[name].trim() : '';
    if (clean) fields[name] = clean;
  }
  if (d.relations && typeof d.relations === 'object' && Object.keys(d.relations).length) {
    fields.relations = JSON.stringify(d.relations);
  }
  if (Array.isArray(d.tags) && d.tags.some((tag: any) => tag && typeof tag === 'object' && 'type' in tag)) {
    fields.tags = JSON.stringify(d.tags);
  }
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    version: d.version ?? raw.version ?? 0,
    title: plainTitle,
    titleMarkup: rawTitle !== plainTitle ? rawTitle : null,
    creators,
    year: yearFromDate(d.date),
    itemType: d.itemType ?? 'other',
    doi: d.DOI ?? null,
    abstract: d.abstractNote ?? null,
    tags: (d.tags ?? []).map((t: any) => t.tag),
    collections: (d.collections ?? []).map((key: string) => canonicalKey(library, key)),
    publisher: d.publisher ?? null,
    publicationTitle: d.publicationTitle ?? d.bookTitle ?? d.proceedingsTitle ?? null,
    isbn: d.ISBN ?? null,
    issn: d.ISSN ?? null,
    url: d.url ?? null,
    date: d.date ?? null,
    language: d.language ?? null,
    volume: d.volume ?? null,
    issue: d.issue ?? null,
    pages: d.pages ?? null,
    edition: d.edition ?? null,
    place: d.place ?? null,
    rights: d.rights ?? null,
    extra: d.extra ?? null,
    fields,
    dateAdded: d.dateAdded ?? null,
    dateModified: d.dateModified ?? null,
  };
}

export interface ZoteroLibraryItemsPage {
  items: ZoteroItem[];
  version: number;
  total: number;
  /**
   * Parentless files left out because `includeStandaloneFiles` was off — a PDF added
   * straight to Zotero with no bibliographic entry above it. They are reported rather
   * than silently dropped: in a real library they can be a quarter of the shelf (603
   * of 2.155 in the one this was measured against), and a user who never sees the
   * number cannot know an option would bring them in.
   */
  standaloneSkipped: number;
}

/**
 * A parentless attachment is only worth importing when a file actually sits behind it.
 * A top-level `linked_url` is a bookmark: importing it would create a work with
 * nothing to read.
 */
const STANDALONE_FILE_MODES = new Set(['imported_file', 'imported_url', 'linked_file']);

/** All top-level bibliographic items in a library, or its incremental changes. */
export async function libraryItems(
  library: ZoteroLibrary,
  opts: {
    since?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
    /** Import parentless files as works of their own. Off by default: they carry no
     *  bibliographic metadata, so they change what counts as a work. */
    includeStandaloneFiles?: boolean;
  } = {},
): Promise<ZoteroLibraryItemsPage> {
  const items: ZoteroItem[] = [];
  let start = 0;
  let version = 0;
  let total = 0;
  let standaloneSkipped = 0;
  const limit = 100;
  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start), sort: 'dateModified', direction: 'asc' });
    if (opts.since && opts.since > 0) params.set('since', String(opts.since));
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/items/top?${params}`, opts.signal);
    if (!res.ok) throw endpointError('Elementos de Zotero', res);
    const data = (await res.json()) as any[];
    version = Number(res.headers.get('Last-Modified-Version')) || version;
    total = Number(res.headers.get('Total-Results')) || data.length;
    for (const raw of data) {
      const itemType = raw.data?.itemType;
      if (itemType === 'note' || itemType === 'annotation') continue;
      if (itemType === 'attachment') {
        if (!STANDALONE_FILE_MODES.has(String(raw.data?.linkMode))) continue;
        if (!opts.includeStandaloneFiles) { standaloneSkipped += 1; continue; }
      }
      items.push(mapItem(raw, library));
    }
    start += data.length;
    opts.onProgress?.(Math.min(start, total), total);
    if (data.length < limit || start >= total) break;
  }
  return { items, version, total, standaloneSkipped };
}

export interface ZoteroDeletedObjects {
  version: number;
  items: string[];
  collections: string[];
}

/** Tombstones since a saved library version. Empty on the first full import. */
export async function deletedSince(
  library: ZoteroLibrary,
  since: number,
  signal?: AbortSignal,
): Promise<ZoteroDeletedObjects> {
  if (since <= 0) return { version: 0, items: [], collections: [] };
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/deleted?since=${encodeURIComponent(String(since))}`, signal);
  // The local API does not implement /deleted: it answers 404 "No endpoint found" for
  // every library, user id and `since` — unlike the Web API this endpoint only exists in.
  // Read as a missing library that aborted the entire import on the *second* run, once a
  // version had been recorded and `since` stopped being zero, which is why it stayed
  // hidden while first syncs were failing for other reasons. A library that really is
  // gone also fails on the items and collections endpoints, which are checked on their
  // own, so answering "no tombstones" here cannot disguise one.
  //
  // The cost is that deletions made in Zotero are not mirrored: an item removed there
  // stays in the local catalogue until a full refresh. That is the honest answer while
  // the runtime cannot report tombstones, and it is preferable to refusing to sync.
  if (res.status === 404) return { version: since, items: [], collections: [] };
  if (!res.ok) throw endpointError('Elementos eliminados de Zotero', res);
  const data = (await res.json().catch(() => ({}))) as { items?: string[]; collections?: string[] };
  return {
    version: Number(res.headers.get('Last-Modified-Version')) || since,
    items: (data.items ?? []).map((key) => canonicalKey(library, key)),
    collections: (data.collections ?? []).map((key) => canonicalKey(library, key)),
  };
}

interface PagedCollections {
  collections: ZoteroCollection[];
  versions: number[];
}

async function readAllCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<PagedCollections> {
  const out: ZoteroCollection[] = [];
  const versions: number[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/collections?limit=${limit}&start=${start}&sort=title`, signal);
    if (!res.ok) throw endpointError('Colecciones de Zotero', res);
    const data = (await res.json()) as any[];
    out.push(...data.map((raw) => mapCollection(raw, library)));
    const pageVersion = Number(res.headers.get('Last-Modified-Version'));
    if (Number.isFinite(pageVersion) && pageVersion > 0) versions.push(pageVersion);
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    start += data.length;
    if (data.length === 0 || data.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return { collections: out.sort((a, b) => a.name.localeCompare(b.name)), versions };
}

/** Complete collection tree. Pagination is explicit so libraries over 100 nodes are never truncated. */
export async function allCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroCollection[]> {
  return (await readAllCollections(library, signal)).collections;
}

/** Page through a collection's items (limit=100), skipping attachments/notes. */
export async function collectionItems(
  userId: string,
  collectionKey: string,
  opts: { query?: string; onProgress?: (loaded: number) => void; library?: ZoteroLibrary } = {}
): Promise<ZoteroItem[]> {
  const parsed = parseCanonicalKey(collectionKey, opts.library ?? { ...PERSONAL_LIBRARY, id: userId });
  const out: ZoteroItem[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const q = opts.query ? `&q=${encodeURIComponent(opts.query)}&qmode=titleCreatorYear` : '';
    const url = `${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/collections/${encodeURIComponent(parsed.rawKey)}/items/top?limit=${limit}&start=${start}${q}`;
    const res = await zfetch(url);
    if (!res.ok) throw new Error(`Zotero items HTTP ${res.status}`);
    const data = (await res.json()) as any[];
    for (const it of data) out.push(mapItem(it, parsed.library));
    opts.onProgress?.(out.length);
    // A missing Total-Results header is "unknown", not zero: reading it as 0 stopped after the
    // first 100 items, and a sync then treated the rest as gone from the collection.
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    start += data.length;
    if (data.length === 0 || data.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return out;
}

/**
 * Items in a collection AND all its descendant subcollections, de-duplicated by key.
 * The Zotero API has no reliable recursive parameter, so we traverse the tree.
 */
export async function collectionItemsRecursive(
  userId: string,
  collectionKey: string,
  opts: { query?: string; library?: ZoteroLibrary } = {}
): Promise<ZoteroItem[]> {
  const seen = new Map<string, ZoteroItem>();
  const visited = new Set<string>();
  const visit = async (key: string): Promise<void> => {
    if (visited.has(key)) return;
    visited.add(key);
    const items = await collectionItems(userId, key, opts).catch(() => [] as ZoteroItem[]);
    for (const it of items) if (!seen.has(it.key)) seen.set(it.key, it);
    const children = await childCollections(userId, key).catch(() => [] as ZoteroCollection[]);
    for (const c of children) await visit(c.key);
  };
  await visit(collectionKey);
  return Array.from(seen.values());
}

export async function getItem(userId: string, itemKey: string, requestedLibrary?: ZoteroLibrary): Promise<ZoteroItem | null> {
  const parsed = parseCanonicalKey(itemKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`);
  if (!res.ok) return null;
  return mapItem(await res.json(), parsed.library);
}

export interface ZoteroPresenceSession {
  budget: ZoteroRequestBudget;
  signal?: AbortSignal;
  libraries: Map<string, ZoteroPresenceLibrary | null>;
}

export interface ZoteroPresenceLibrary { key: string; version: number }
export type ZoteroItemPresence = 'present' | 'trashed' | 'gone' | 'unknown';

function responseVersion(res: Response): number | null {
  const header = res.headers.get('Last-Modified-Version');
  if (header === null || !header.trim()) return null;
  const version = Number(header);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

/** A missing item is authoritative only while its source library can be read. */
export async function presenceLibrary(userId: string, itemKey: string, session: ZoteroPresenceSession, fresh = false): Promise<ZoteroPresenceLibrary | null> {
  const { library } = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const key = `${library.type}:${library.id}`;
  if (!fresh && session.libraries.has(key)) return session.libraries.get(key) ?? null;
  try {
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/items?limit=1`, session.signal, {}, session.budget);
    const version = responseVersion(res);
    if (!res.ok || version === null || !Array.isArray(await res.json())) {
      session.libraries.set(key, null);
      return null;
    }
    const snapshot = { key, version };
    session.libraries.set(key, snapshot);
    return snapshot;
  } catch {
    session.libraries.set(key, null);
    return null;
  }
}

export async function itemPresenceDetails(userId: string, itemKey: string, session: ZoteroPresenceSession): Promise<{
  presence: ZoteroItemPresence; library: string; version: number | null;
}> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const library = `${parsed.library.type}:${parsed.library.id}`;
  const unknown = { presence: 'unknown' as const, library, version: null };
  try {
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`, session.signal, {}, session.budget);
    if (res.status === 404) {
      const snapshot = await presenceLibrary(userId, itemKey, session);
      return snapshot ? { presence: 'gone', library, version: snapshot.version } : unknown;
    }
    if (!res.ok) return unknown;
    const body = (await res.json()) as { data?: { deleted?: boolean | number } };
    if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) return unknown;
    const deleted = body.data.deleted;
    if (deleted !== undefined && deleted !== false && deleted !== true && deleted !== 0 && deleted !== 1) return unknown;
    return { presence: deleted === true || deleted === 1 ? 'trashed' : 'present', library, version: responseVersion(res) };
  } catch {
    return unknown;
  }
}

/** `gone` requires a readable source library; a 404 for the entire source is unknown. */
export async function itemPresence(userId: string, itemKey: string): Promise<ZoteroItemPresence> {
  return (await itemPresenceDetails(userId, itemKey, {
    budget: { remaining: 6 }, libraries: new Map(), signal: AbortSignal.timeout(5_000),
  })).presence;
}

export async function searchItems(library: ZoteroLibrary, query: string): Promise<ZoteroItem[]> {
  const q = query.trim();
  const params = new URLSearchParams({ limit: '50', sort: 'dateModified', direction: 'desc' });
  if (q) { params.set('q', q); params.set('qmode', 'titleCreatorYear'); }
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/items/top?${params}`);
  if (!res.ok) throw new Error(`Zotero search HTTP ${res.status}`);
  return ((await res.json()) as any[])
    .filter((raw) => !['note', 'annotation'].includes(raw.data?.itemType))
    .map((raw) => mapItem(raw, library));
}

function creatorName(c: any): string {
  if (c.name) return c.name;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.lastName || '';
}

/** Full bibliographic metadata for one item — used by the graph detail panel. */
export async function getItemMeta(userId: string, itemKey: string): Promise<WorkMeta | null> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`);
  if (!res.ok) return null;
  const d = ((await res.json()) as any).data ?? {};
  const authors = (d.creators ?? [])
    .filter((c: any) => !c.creatorType || c.creatorType === 'author' || c.creatorType === 'editor')
    .map(creatorName)
    .filter(Boolean);
  const numPages = d.numPages ? parseInt(String(d.numPages), 10) : null;
  return {
    itemType: d.itemType ?? 'other',
    authors,
    year: yearFromDate(d.date),
    container:
      d.publicationTitle || d.bookTitle || d.proceedingsTitle || d.encyclopediaTitle || d.dictionaryTitle || d.seriesTitle || null,
    publisher: d.publisher || null,
    pages: d.pages || null,
    numPages: Number.isFinite(numPages as number) ? (numPages as number) : null,
    volume: d.volume || null,
    issue: d.issue || null,
    edition: d.edition || null,
    place: d.place || null,
    doi: d.DOI || null,
    url: d.url || null,
    language: d.language || null,
  };
}

export type ZoteroAttachment = ZoteroAttachmentInfo;

export interface ZoteroFulltext {
  content: string;
  indexedPages?: number;
  totalPages?: number;
  indexedChars?: number;
  totalChars?: number;
}

/**
 * Zotero's own indexed full text for an attachment item (PDFs are indexed on import).
 * Returns null when the item has no indexed text (404 / empty). This lets us reuse
 * Zotero's extraction instead of re-parsing the PDF ourselves.
 */
export async function getFulltext(userId: string, attachmentKey: string): Promise<ZoteroFulltext | null> {
  const parsed = parseCanonicalKey(attachmentKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/fulltext`);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as ZoteroFulltext | null;
  if (!data || !data.content || !data.content.trim()) return null;
  return data;
}

function mapAttachment(raw: any, library: ZoteroLibrary): ZoteroAttachment {
  const data = raw.data ?? {};
  const itemKey = String(data.key ?? raw.key ?? '');
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    title: data.title || data.filename || 'Adjunto',
    contentType: data.contentType ?? null,
    linkMode: data.linkMode ?? null,
    filename: data.filename ?? null,
    available: Boolean(data.filename),
    version: data.version ?? raw.version ?? 0,
    parentItem: data.parentItem ?? null,
    dateModified: data.dateModified ?? null,
  };
}

async function rawItemChildren(
  userId: string,
  itemKey: string,
  requestedLibrary?: ZoteroLibrary,
  signal?: AbortSignal,
): Promise<{ parsed: { library: ZoteroLibrary; rawKey: string }; children: any[] }> {
  const parsed = parseCanonicalKey(itemKey, requestedLibrary ?? { ...PERSONAL_LIBRARY, id: userId });
  const children: any[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start) });
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/children?${params}`, signal);
    if (!res.ok) return { parsed, children: [] };
    const page = (await res.json()) as any[];
    children.push(...page);
    start += page.length;
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    if (page.length === 0 || page.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return { parsed, children };
}

export async function itemChildren(userId: string, itemKey: string, signal?: AbortSignal): Promise<ZoteroAttachment[]> {
  const { parsed, children } = await rawItemChildren(userId, itemKey, undefined, signal);
  return children
    // Defensive: older Zotero builds answered /items/<unknown>/children with a 200
    // listing of UNRELATED library items instead of a 404 (9.0.6 returns an empty
    // array). Requiring parentItem to match keeps a stale/foreign key from ever
    // resolving to someone else's file, whichever behaviour the client has.
    .filter((c) => c.data?.itemType === 'attachment' && c.data?.parentItem === parsed.rawKey)
    .map((child) => mapAttachment(child, parsed.library));
}

export interface ZoteroChildNote {
  key: string;
  itemKey: string;
  library: ZoteroLibrary;
  title: string;
  html: string;
  version: number;
  parentItem: string;
  dateModified: string | null;
}

function mapChildNote(raw: any, library: ZoteroLibrary): ZoteroChildNote {
  const data = raw.data ?? {};
  const itemKey = String(data.key ?? raw.key ?? '');
  return {
    key: canonicalKey(library, itemKey),
    itemKey,
    library,
    title: String(data.title || 'Zotero note'),
    html: String(data.note || ''),
    version: Number(data.version ?? raw.version ?? 0),
    parentItem: String(data.parentItem ?? ''),
    dateModified: data.dateModified ?? null,
  };
}

/** Child notes remain a read-only mirror in Nodus. */
export async function itemNotes(
  userId: string,
  itemKey: string,
  library?: ZoteroLibrary,
  signal?: AbortSignal,
): Promise<ZoteroChildNote[]> {
  const { parsed, children } = await rawItemChildren(userId, itemKey, library, signal);
  return children
    .filter((child) => child.data?.itemType === 'note' && child.data?.parentItem === parsed.rawKey)
    .map((child) => mapChildNote(child, parsed.library));
}

export async function itemAttachments(
  userId: string,
  itemKey: string,
  library?: ZoteroLibrary,
  signal?: AbortSignal,
): Promise<ZoteroAttachment[]> {
  const parsed = parseCanonicalKey(itemKey, library ?? { ...PERSONAL_LIBRARY, id: userId });
  const canonical = canonicalKey(parsed.library, parsed.rawKey);
  const children = await itemChildren(userId, canonical, signal);
  if (children.length) return children;
  const self = await itemAsAttachment(userId, canonical, signal);
  return self ? [self] : [];
}

export interface ZoteroLibraryInventory {
  library: ZoteroLibrary;
  /** Bibliographic top-level items plus standalone files when enabled. */
  items: ZoteroItem[];
  collections: ZoteroCollection[];
  /** Every attachment object, including linked URLs and standalone files. */
  attachments: ZoteroAttachment[];
  /** Notes with a parent item. Standalone notes are not importable works. */
  notes: ZoteroChildNote[];
  /** Stable Zotero library version represented by this snapshot. */
  version: number;
  /** Number of importable top-level works before applying the standalone-file option. */
  total: number;
  standaloneSkipped: number;
  attempts: number;
}

export interface ZoteroLibraryInventoryOptions {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  /** A complete inventory includes standalone files unless explicitly disabled. */
  includeStandaloneFiles?: boolean;
  /** Primarily useful for deterministic verification; defaults to three. */
  maxAttempts?: number;
}

export class ZoteroInventoryChangedError extends ZoteroRequestError {
  constructor(
    readonly library: ZoteroLibrary,
    readonly startVersion: number,
    readonly endVersion: number,
    readonly attempts: number,
  ) {
    super(
      `Zotero cambió la biblioteca "${library.name}" durante el inventario (${startVersion} → ${endVersion}).`,
      'invalid-response',
      null,
      true,
    );
    this.name = 'ZoteroInventoryChangedError';
  }
}

interface PagedRawItems {
  items: any[];
  versions: number[];
}

async function readAllRawItems(
  library: ZoteroLibrary,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<PagedRawItems> {
  const items: any[] = [];
  const versions: number[] = [];
  let start = 0;
  const limit = 100;
  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), start: String(start), sort: 'dateModified', direction: 'asc' });
    const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(library)}/items?${params}`, signal);
    if (!res.ok) throw endpointError('Inventario de Zotero', res);
    const page = (await res.json()) as any[];
    items.push(...page);
    const pageVersion = Number(res.headers.get('Last-Modified-Version'));
    if (Number.isFinite(pageVersion) && pageVersion > 0) versions.push(pageVersion);
    start += page.length;
    const totalHeader = res.headers.get('Total-Results');
    const total = totalHeader === null ? null : Number(totalHeader);
    onProgress?.(start, Number.isFinite(total) ? (total as number) : start);
    if (page.length === 0 || page.length < limit || (Number.isFinite(total) && start >= (total as number))) break;
  }
  return { items, versions };
}

/**
 * Build an exhaustive, coherent snapshot of one Zotero library.
 *
 * Reading `/items` rather than requesting children once per parent both avoids the
 * local API's default page limit and makes child-only changes visible. The library
 * version is sampled around all item and collection pages; if any page belongs to a
 * different version, the entire read is discarded and retried a bounded number of
 * times so callers never import a page-shifted mixture of two Zotero states.
 */
export async function libraryInventory(
  library: ZoteroLibrary,
  opts: ZoteroLibraryInventoryOptions = {},
): Promise<ZoteroLibraryInventory> {
  const configuredAttempts = Number.isFinite(opts.maxAttempts) ? Math.trunc(opts.maxAttempts as number) : 3;
  const maxAttempts = Math.max(1, Math.min(10, configuredAttempts));
  let lastStartVersion = 0;
  let lastEndVersion = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (opts.signal?.aborted) throw new DOMException('Solicitud cancelada', 'AbortError');
    const startVersion = await libraryVersion(library.id, library, opts.signal);
    const raw = await readAllRawItems(library, opts.signal, opts.onProgress);
    const collectionPage = await readAllCollections(library, opts.signal);
    const endVersion = await libraryVersion(library.id, library, opts.signal);
    lastStartVersion = startVersion;
    lastEndVersion = endVersion;

    const observedVersions = [...raw.versions, ...collectionPage.versions];
    const stable = startVersion === endVersion && observedVersions.every((version) => version === startVersion);
    if (!stable) {
      if (attempt < maxAttempts) await waitForRetry(Math.min(250, attempt * 50), opts.signal);
      continue;
    }

    const items: ZoteroItem[] = [];
    const attachments: ZoteroAttachment[] = [];
    const notes: ZoteroChildNote[] = [];
    let standaloneSkipped = 0;
    const includeStandaloneFiles = opts.includeStandaloneFiles !== false;

    for (const entry of raw.items) {
      const data = entry.data ?? {};
      const itemType = String(data.itemType ?? '');
      const parentItem = data.parentItem ? String(data.parentItem) : null;
      if (itemType === 'attachment') {
        attachments.push(mapAttachment(entry, library));
        if (parentItem || !STANDALONE_FILE_MODES.has(String(data.linkMode))) continue;
        if (!includeStandaloneFiles) { standaloneSkipped += 1; continue; }
        items.push(mapItem(entry, library));
        continue;
      }
      if (itemType === 'note') {
        if (parentItem) notes.push(mapChildNote(entry, library));
        continue;
      }
      if (itemType === 'annotation' || parentItem) continue;
      items.push(mapItem(entry, library));
    }

    return {
      library,
      items,
      collections: collectionPage.collections,
      attachments,
      notes,
      version: endVersion,
      total: items.length + standaloneSkipped,
      standaloneSkipped,
      attempts: attempt,
    };
  }

  throw new ZoteroInventoryChangedError(library, lastStartVersion, lastEndVersion, maxAttempts);
}

export async function attachmentFilePath(
  userId: string,
  attachmentKey: string,
  library?: ZoteroLibrary,
  signal?: AbortSignal,
): Promise<string | null> {
  const parsed = parseCanonicalKey(attachmentKey, library ?? { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}/file`, signal, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location?.startsWith('file:')) return null;
  try {
    const declaredPath = fileURLToPath(location);
    if (fs.existsSync(declaredPath) && fs.statSync(declaredPath).isFile()) return declaredPath;

    // Zotero can retain an obsolete filename in its attachment row after its own
    // storage renames the physical file. A storage directory belongs to one
    // attachment key, so a unique non-hidden file (or unique same-extension file)
    // is the safe materialized target. Never guess when several candidates remain.
    const directory = path.dirname(declaredPath);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return null;
    const candidates = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => path.join(directory, entry.name));
    const extension = path.extname(declaredPath).toLocaleLowerCase();
    if (candidates.length === 1
      && (!extension || path.extname(candidates[0]).toLocaleLowerCase() === extension)) return candidates[0];
    const sameExtension = extension
      ? candidates.filter((candidate) => path.extname(candidate).toLocaleLowerCase() === extension)
      : [];
    return sameExtension.length === 1 ? sameExtension[0] : null;
  } catch {
    return null;
  }
}

// Attachment key per parent item, resolved once per session. Used by the
// "open evidence at its PDF page" deep link; invalidation is unnecessary at
// this cadence (a re-added attachment just needs an app restart).
const pdfAttachmentCache = new Map<string, string | null>();

/**
 * The Zotero item key of the first PDF attachment under an item (or the item
 * itself when it IS a standalone PDF attachment). zotero://open-pdf needs the
 * ATTACHMENT key, not the parent's. Null when the item has no PDF.
 */
export async function resolvePdfAttachmentKey(userId: string, itemKey: string): Promise<string | null> {
  const cached = pdfAttachmentCache.get(itemKey);
  if (cached !== undefined) return cached;
  try {
    const children = await itemChildren(userId, itemKey);
    let key = children.find((c) => c.contentType === 'application/pdf')?.key ?? null;
    if (!key) {
      const self = await itemAsAttachment(userId, itemKey);
      if (self?.contentType === 'application/pdf') key = self.key;
    }
    pdfAttachmentCache.set(itemKey, key);
    return key;
  } catch {
    // Zotero probably closed: don't poison the cache, retry on the next click.
    return null;
  }
}

/**
 * When the work item is itself a file attachment — a standalone file (PDF, .md,
 * .docx…) added directly to a collection with no parent reference — it has no
 * children, so its text must be read from the item itself. Returns the item as a
 * ZoteroAttachment, or null when it is not an attachment.
 */
export async function itemAsAttachment(userId: string, itemKey: string, signal?: AbortSignal): Promise<ZoteroAttachment | null> {
  const parsed = parseCanonicalKey(itemKey, { ...PERSONAL_LIBRARY, id: userId });
  const res = await zfetch(`${ZOTERO_API_BASE}/${libraryPrefix(parsed.library)}/items/${encodeURIComponent(parsed.rawKey)}`, signal);
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as any;
  const d = raw?.data;
  if (!d || d.itemType !== 'attachment') return null;
  return mapAttachment(raw, parsed.library);
}

// An `itemsSince()` incremental diff used to live here, unreferenced by any caller.
// It was removed rather than fixed: it built `users/<id>` by hand instead of going
// through libraryPrefix(), so it could never have served a group library, and its
// `since=0` contract shifted under it (Zotero 8 made since=0 return everything —
// zotero/zotero#5011). Sync reads the library version via libraryVersion() and
// re-walks collections; a real incremental path should be written against the
// current API rather than resurrected from this.
