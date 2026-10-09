import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type {
  LibraryAttachmentRecord,
  LibraryCollectionRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  LibraryMetadataOverrides,
  ZoteroImportProgress,
  ZoteroImportReport,
  ZoteroImportSelection,
  ZoteroLibraryPreview,
  ZoteroSyncFailure,
} from '@shared/libraryTypes';
import type { ZoteroAttachmentInfo, ZoteroCollection, ZoteroItem, ZoteroLibrary } from '@shared/types';
import * as zotero from '../zotero/zoteroClient';
import { LibraryCatalog } from './libraryCatalog';
import { assertInside, fitLibraryFileName, resolveLibraryFile, safeLibraryFileName, safeLibraryFolderName } from './libraryPaths';
import {
  canonicalJson,
  librarySourceIdentityKey,
  normalizeLibraryMetadata,
  zoteroSourceIdentity,
} from './libraryRecord';
import { LibraryDiskStore } from './libraryStorage';
import { ZoteroSyncSessionStore } from './libraryZoteroSyncSessions';

export interface ZoteroImportClient {
  libraries(signal?: AbortSignal): Promise<ZoteroLibrary[]>;
  libraryVersion(userId: string, library: ZoteroLibrary, signal?: AbortSignal): Promise<number>;
  allCollections(library: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroCollection[]>;
  libraryItems(library: ZoteroLibrary, options?: {
    since?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
    includeStandaloneFiles?: boolean;
  }): Promise<{ items: ZoteroItem[]; version: number; total: number; standaloneSkipped?: number }>;
  deletedSince(library: ZoteroLibrary, since: number, signal?: AbortSignal): Promise<{
    version: number;
    items: string[];
    collections: string[];
  }>;
  itemAttachments(userId: string, itemKey: string, library?: ZoteroLibrary, signal?: AbortSignal): Promise<ZoteroAttachmentInfo[]>;
  attachmentFilePath(userId: string, attachmentKey: string, library?: ZoteroLibrary, signal?: AbortSignal): Promise<string | null>;
  itemNotes?(userId: string, itemKey: string, library?: ZoteroLibrary, signal?: AbortSignal): Promise<zotero.ZoteroChildNote[]>;
  libraryInventory?(library: ZoteroLibrary, options?: zotero.ZoteroLibraryInventoryOptions): Promise<zotero.ZoteroLibraryInventory>;
}

const defaultClient: ZoteroImportClient = {
  libraries: zotero.libraries,
  libraryVersion: zotero.libraryVersion,
  allCollections: zotero.allCollections,
  libraryItems: zotero.libraryItems,
  deletedSince: zotero.deletedSince,
  itemAttachments: zotero.itemAttachments,
  attachmentFilePath: zotero.attachmentFilePath,
  itemNotes: zotero.itemNotes,
  libraryInventory: zotero.libraryInventory,
};

function libraryId(library: ZoteroLibrary): string {
  return library.type === 'group' ? `groups/${library.id}` : `users/${library.id || '0'}`;
}

function importSourceId(library: ZoteroLibrary): string {
  return `zotero:${libraryId(library)}`;
}

function legacyCollectionAlias(key: string): string {
  return `zotero:${key}`;
}

function qualifiedCollectionAlias(library: ZoteroLibrary, itemKey: string): string {
  return `zotero:collection:${library.type}:${library.id || '0'}:${itemKey}`;
}

function qualifiedItemAlias(library: ZoteroLibrary, itemKey: string): string {
  return `zotero:item:${library.type}:${library.id || '0'}:${itemKey}`;
}

function legacyAliasIsUnambiguous(library: ZoteroLibrary, transportKey: string): boolean {
  return library.type === 'user' || transportKey !== transportKey.split(':').at(-1);
}

function rawZoteroKey(key: string): string {
  return /^groups:[^:]+:(.+)$/.exec(key)?.[1] ?? key;
}

function canonicalTransportKey(library: ZoteroLibrary, key: string): string {
  const raw = rawZoteroKey(key);
  return library.type === 'group' ? `groups:${library.id}:${raw}` : raw;
}

export function mapZoteroLibraryItemType(value: string): LibraryItemType {
  const type = value.toLowerCase().replace(/[^a-z]/g, '');
  if (['journalarticle', 'articlejournal'].includes(type)) return 'journal-article';
  if (type === 'magazinearticle') return 'magazine-article';
  if (type === 'newspaperarticle') return 'newspaper-article';
  if (type === 'book') return 'book';
  const mapped: Record<string, LibraryItemType> = {
    booksection: 'book-chapter', chapter: 'book-chapter', conferencepaper: 'conference-paper', proceedings: 'conference-paper',
    thesis: 'thesis', report: 'report', manuscript: 'manuscript', presentation: 'presentation', interview: 'interview',
    letter: 'letter', email: 'email', instantmessage: 'instant-message', encyclopediaarticle: 'encyclopedia-article',
    dictionaryentry: 'dictionary-entry', case: 'case', hearing: 'hearing', bill: 'bill', statute: 'statute', patent: 'patent',
    artwork: 'artwork', map: 'map', film: 'film', audiorecording: 'audio-recording', videorecording: 'video-recording',
    radiobroadcast: 'radio-broadcast', tvbroadcast: 'tv-broadcast', podcast: 'podcast', blogpost: 'blog-post',
    forumpost: 'forum-post', computerprogram: 'computer-program', webpage: 'webpage', dataset: 'dataset', document: 'document',
    preprint: 'preprint', standard: 'standard',
  };
  if (mapped[type]) return mapped[type];
  return type ? 'document' : 'other';
}

function splitIdentifiers(value: string | null): string[] {
  return [...new Set(String(value ?? '').split(/[;,\n]+/).map((entry) => entry.trim()).filter(Boolean))];
}

/** Zotero separates the ISBNs of one book with spaces. Split there only when every
 * part is a whole ISBN, so a single number written in spaced groups stays one value. */
function splitIsbns(value: string | null): string[] {
  return [...new Set(splitIdentifiers(value).flatMap((entry) => {
    const parts = entry.split(/\s+/);
    return parts.length > 1 && parts.every((part) => /^(?:\d{9}[\dX]|\d{13})$/i.test(part.replace(/-/g, '')))
      ? parts : [entry];
  }))];
}

function parseExtra(value: string | null, item: ZoteroItem): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const match = /^([^:]{1,100}):\s*(.+)$/.exec(line.trim());
    if (match) result[match[1].trim()] = match[2].trim();
  }
  result['Zotero item type'] = item.itemType;
  result['Zotero version'] = String(item.version);
  for (const [name, entry] of Object.entries(item.fields ?? {})) result[`Zotero field: ${name}`] = entry;
  if (item.dateAdded) result['Zotero date added'] = item.dateAdded;
  if (item.dateModified) result['Zotero date modified'] = item.dateModified;
  return Object.keys(result).length ? result : undefined;
}

function metadata(item: ZoteroItem): LibraryItemMetadata {
  const extra = parseExtra(item.extra, item);
  return {
    title: item.title.trim() || 'Documento sin título',
    itemType: mapZoteroLibraryItemType(item.itemType),
    creators: item.creators.map((creator) => ({
      creatorType: creator.creatorType || 'author',
      ...(creator.firstName?.trim() ? { firstName: creator.firstName.trim() } : {}),
      ...(creator.lastName?.trim() ? { lastName: creator.lastName.trim() } : {}),
      ...(creator.name?.trim() ? { name: creator.name.trim() } : {}),
      fieldMode: creator.name?.trim() ? 1 as const : 0 as const,
    })),
    ...(item.abstract?.trim() ? { abstract: item.abstract.trim() } : {}),
    ...(item.date?.trim() ? { date: item.date.trim() } : {}),
    ...(item.fields?.accessDate?.trim() ? { accessDate: item.fields.accessDate.trim() } : {}),
    ...(item.dateAdded?.trim() ? { zoteroDateAdded: item.dateAdded.trim() } : {}),
    ...(item.dateModified?.trim() ? { zoteroDateModified: item.dateModified.trim() } : {}),
    year: item.year,
    ...(item.language?.trim() ? { language: item.language.trim() } : {}),
    ...(item.publisher?.trim() ? { publisher: item.publisher.trim() } : {}),
    ...(item.publicationTitle?.trim() ? { publicationTitle: item.publicationTitle.trim() } : {}),
    ...(item.volume?.trim() ? { volume: item.volume.trim() } : {}),
    ...(item.issue?.trim() ? { issue: item.issue.trim() } : {}),
    ...(item.pages?.trim() ? { pages: item.pages.trim() } : {}),
    ...(item.edition?.trim() ? { edition: item.edition.trim() } : {}),
    ...(item.place?.trim() ? { place: item.place.trim() } : {}),
    ...(item.rights?.trim() ? { rights: item.rights.trim() } : {}),
    ...(item.url?.trim() ? { url: item.url.trim() } : {}),
    ...(item.doi?.trim() ? { doi: item.doi.trim() } : {}),
    isbn: splitIsbns(item.isbn),
    issn: splitIdentifiers(item.issn),
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    ...(extra ? { extra } : {}),
  };
}

function applyMetadataOverrides(base: LibraryItemMetadata, overrides?: LibraryMetadataOverrides): LibraryItemMetadata {
  if (!overrides) return base;
  const values = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete values[key];
    else values[key] = value;
  }
  return normalizeLibraryMetadata(values, base.title);
}

function comparableItem(record: LibraryItemRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

function comparableCollection(record: LibraryCollectionRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = record;
  return canonicalJson(rest);
}

/**
 * Zotero has no "this one is the article" flag. An entry routinely carries a full-text
 * PDF *and* a supplementary PDF, and to the API both are plain `application/pdf`: the
 * format tiers below tied them, and the tie fell through to `key.localeCompare`, the
 * alphabetical order of an opaque Zotero key. So an entry whose supplement happened to
 * key as "AA…" and whose article keyed as "ZZ…" had Nodus read, extract and analyse
 * the supplementary information as if it were the paper — a coin flip, silently.
 *
 * The attachment titles Zotero's own translators write are the only signal available,
 * and they are fairly consistent ("Full Text PDF", "Supplementary Information"). A
 * supplementary-looking attachment is ranked just below others of its own format, so
 * it still wins against an image or a spreadsheet and never against the article.
 */
const SUPPLEMENTARY = /supplement|supporting[\s_-]+information|appendix|annex/i;

function isSupplementary(attachment: ZoteroAttachmentInfo): boolean {
  return SUPPLEMENTARY.test(`${attachment.title ?? ''} ${attachment.filename ?? ''}`);
}

function priority(attachment: ZoteroAttachmentInfo): number {
  const mime = String(attachment.contentType ?? '').toLowerCase();
  const extension = path.extname(attachment.filename ?? '').toLowerCase();
  const format = mime === 'application/pdf' || extension === '.pdf' ? 0
    : mime.includes('epub') || extension === '.epub' ? 1
      : ['.md', '.markdown', '.jats', '.xml', '.html', '.htm'].includes(extension) ? 2
        : ['.docx', '.odt', '.rtf'].includes(extension) ? 3
          : mime.startsWith('text/plain') || extension === '.txt' ? 4
            : ['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension) ? 5
              : String(attachment.linkMode).toLowerCase().includes('snapshot') ? 6
                : mime.startsWith('image/') ? 7
                  : 8;
  return format + (isSupplementary(attachment) ? 0.5 : 0);
}

function attachmentRole(attachment: ZoteroAttachmentInfo, index: number): LibraryAttachmentRecord['role'] {
  if (index === 0) return 'original';
  if (String(attachment.linkMode).toLowerCase().includes('snapshot')) return 'snapshot';
  if (String(attachment.contentType).toLowerCase().startsWith('image/')) return 'image';
  return 'supplement';
}

async function sha256(file: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('Importación cancelada', 'AbortError');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    const abort = (): void => { stream.destroy(new DOMException('Importación cancelada', 'AbortError')); };
    const cleanup = (): void => signal?.removeEventListener('abort', abort);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (error) => { cleanup(); reject(error); });
    stream.on('end', () => { cleanup(); resolve(hash.digest('hex')); });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function copyImmutable(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await pipeline(
      fs.createReadStream(source),
      fs.createWriteStream(temporary, { flags: 'wx' }),
      { signal },
    );
    // Windows requires write access to flush the copied file to disk.
    const descriptor = await fsp.open(temporary, 'r+');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
    signal?.throwIfAborted();
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.unlink(temporary).catch(() => undefined);
  }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Importación cancelada', 'AbortError');
}

function syncFailure(error: unknown, sourceLibraryId: string | null): ZoteroSyncFailure {
  const candidate = error as { code?: ZoteroSyncFailure['code']; retryable?: boolean; message?: string };
  const message = error instanceof Error ? error.message : String(error);
  const allowedCodes: ZoteroSyncFailure['code'][] = [
    'zotero-closed', 'credentials-expired', 'rate-limited', 'library-missing', 'permission', 'network',
    'invalid-response', 'attachment-unavailable', 'attachment-corrupt', 'verification-mismatch',
    'concurrent-source-change', 'storage', 'unknown',
  ];
  let code: ZoteroSyncFailure['code'] = candidate.code && allowedCodes.includes(candidate.code)
    ? candidate.code : /ECONNREFUSED|fetch failed|socket/i.test(message) ? 'zotero-closed' : 'unknown';
  if (error instanceof zotero.ZoteroInventoryChangedError) code = 'concurrent-source-change';
  return { libraryId: sourceLibraryId, code, message, retryable: candidate.retryable ?? ['zotero-closed', 'rate-limited', 'network'].includes(code) };
}

function progress(
  requestId: string,
  phase: ZoteroImportProgress['phase'],
  library: ZoteroLibrary | null,
  processedItems: number,
  totalItems: number,
  processedAttachments: number,
  totalAttachments: number,
  message: string,
  // Fraction of the *items* walked by the notes and attachments passes. Those two
  // phases cannot be measured against `totalAttachments`: that total is discovered
  // one item at a time, so processed/total sat at ~1 from the first file onwards and
  // pinned the bar at 93% for the entire copy. Items are known up front, so they are
  // the only honest denominator once the catalogue is committed.
  itemRatio = 0,
): ZoteroImportProgress {
  const phaseBase: Record<ZoteroImportProgress['phase'], number> = {
    connecting: 0, inventory: 3, collections: 10, catalog: 18, notes: 47,
    attachments: 58, verification: 94, rebuild: 97, complete: 100, canceled: 100, failed: 100,
  };
  const portion = phase === 'catalog' && totalItems ? Math.round((processedItems / totalItems) * 28)
    : phase === 'notes' ? Math.round(Math.min(1, Math.max(0, itemRatio)) * 12)
      : phase === 'attachments' ? Math.round(Math.min(1, Math.max(0, itemRatio)) * 37)
        : 0;
  return {
    requestId, phase, libraryId: library ? libraryId(library) : null, libraryName: library?.name ?? null,
    processedItems, totalItems, processedAttachments, totalAttachments,
    percent: Math.min(100, phaseBase[phase] + portion), message,
  };
}

export async function previewZoteroLibraries(
  catalog: LibraryCatalog,
  client: ZoteroImportClient = defaultClient,
): Promise<ZoteroLibraryPreview[]> {
  const libraries = await client.libraries();
  return Promise.all(libraries.map(async (library) => ({
    id: libraryId(library),
    type: library.type,
    name: library.name,
    version: await client.libraryVersion(library.id, library),
    lastImportedVersion: catalog.getImportSource(importSourceId(library))?.version ?? 0,
  })));
}

interface CompleteZoteroInventory {
  items: ZoteroItem[];
  collections: ZoteroCollection[];
  attachments: ZoteroAttachmentInfo[];
  notes: zotero.ZoteroChildNote[];
  version: number;
  total: number;
  standaloneSkipped: number;
}

function codedError(
  message: string,
  code: ZoteroSyncFailure['code'],
  retryable = true,
): Error & { code: ZoteroSyncFailure['code']; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}

/**
 * Prefer the single, coherent `/items` inventory implemented by the real client. The
 * fallback keeps test doubles and older embedders correct: it deliberately performs a
 * full read and walks every child, then accepts it only when the library version stayed
 * stable. Incremental parent reads are not a correctness primitive because a child can
 * change without its parent version changing.
 */
async function completeInventory(
  client: ZoteroImportClient,
  library: ZoteroLibrary,
  includeStandaloneFiles: boolean,
  includeAttachments: boolean,
  signal: AbortSignal | undefined,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CompleteZoteroInventory> {
  if (client.libraryInventory) {
    return client.libraryInventory(library, { signal, onProgress, includeStandaloneFiles });
  }
  let lastStart = 0;
  let lastEnd = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    abortIfNeeded(signal);
    const startVersion = await client.libraryVersion(library.id, library, signal);
    const collections = await client.allCollections(library, signal);
    const page = await client.libraryItems(library, { signal, includeStandaloneFiles, onProgress });
    const attachments = new Map<string, ZoteroAttachmentInfo>();
    const notes = new Map<string, zotero.ZoteroChildNote>();
    for (const item of page.items) {
      abortIfNeeded(signal);
      if (includeAttachments) {
        for (const attachment of await client.itemAttachments(library.id, item.key, library, signal)) {
          const normalized = {
            ...attachment,
            parentItem: attachment.parentItem ?? (item.itemType === 'attachment' ? null : item.itemKey),
          };
          attachments.set(normalized.key, normalized);
        }
      }
      if (client.itemNotes) {
        for (const note of await client.itemNotes(library.id, item.key, library, signal)) {
          const itemKey = note.itemKey || rawZoteroKey(note.key);
          notes.set(note.key, {
            ...note,
            itemKey,
            library: note.library ?? library,
            parentItem: note.parentItem || item.itemKey,
            dateModified: note.dateModified ?? null,
          });
        }
      }
    }
    const endVersion = await client.libraryVersion(library.id, library, signal);
    lastStart = startVersion;
    lastEnd = endVersion;
    if (startVersion === endVersion && (!page.version || page.version === endVersion)) {
      return {
        items: page.items,
        collections,
        attachments: [...attachments.values()],
        notes: [...notes.values()],
        version: endVersion,
        total: page.items.length + (page.standaloneSkipped ?? 0),
        standaloneSkipped: page.standaloneSkipped ?? 0,
      };
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw codedError(
    `Zotero cambió la biblioteca "${library.name}" durante el inventario (${lastStart} → ${lastEnd}).`,
    'concurrent-source-change',
  );
}

function pushFailure(
  report: ZoteroImportReport,
  library: ZoteroLibrary | null,
  code: ZoteroSyncFailure['code'],
  message: string,
  retryable = true,
): void {
  report.failures.push({ libraryId: library ? libraryId(library) : null, code, message, retryable });
  report.warnings.push(message);
  report.partial = true;
}

export async function importZoteroLibraries(options: {
  requestId: string;
  selection?: ZoteroImportSelection;
  store: LibraryDiskStore;
  catalog: LibraryCatalog;
  client?: ZoteroImportClient;
  signal?: AbortSignal;
  onProgress?: (value: ZoteroImportProgress) => void;
  /** Keep a clean session running until the caller completes required post-processing. */
  deferSessionCompletion?: boolean;
}): Promise<ZoteroImportReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const { requestId, store, catalog, signal, onProgress } = options;
  const client = options.client ?? defaultClient;
  const selection: ZoteroImportSelection = {
    ...(options.selection ?? {}),
    includeStandaloneFiles: options.selection?.includeStandaloneFiles !== false,
  };
  const report: ZoteroImportReport = {
    requestId, libraries: 0, itemsDiscovered: 0, itemsCreated: 0, itemsUpdated: 0,
    itemsUnchanged: 0, itemsDeleted: 0, itemsSourceMissing: 0, itemsStandaloneSkipped: 0,
    collectionsCreated: 0, collectionsUpdated: 0, collectionsUnchanged: 0,
    attachmentsCopied: 0, attachmentsUnchanged: 0, attachmentsUnavailable: 0,
    attachmentsLinkOnly: 0, attachmentsChanged: 0, conflicts: 0, librariesMissing: [],
    failures: [], verification: {
      status: 'passed',
      expected: { libraries: 0, collections: 0, items: 0, attachments: 0, notes: 0 },
      imported: { libraries: 0, collections: 0, items: 0, attachments: 0, notes: 0 },
      mismatches: [],
    },
    partial: false, warnings: [], canceled: false, durationMs: 0,
  };
  const verification = report.verification!;
  // Every attachment used to be read in full four times per sync: the source and the
  // Nodus copy before the copy decision, then both again at the verification barrier.
  // Within one run a second digest of a file whose identity has not moved is the same
  // digest, so it is reused. The identity includes ctime, which every write and rename
  // updates and no user tool can set, so a file that changed in between (a linked file
  // edited mid-sync, a copy damaged on disk) is still read again and still caught.
  const digests = new Map<string, { identity: string; hash: string }>();
  const fileIdentity = async (file: string): Promise<string> => {
    const stat = await fsp.stat(file, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  };
  const hashFile = async (file: string, hashSignal?: AbortSignal): Promise<string> => {
    const before = await fileIdentity(file);
    const known = digests.get(file);
    if (known?.identity === before) return known.hash;
    const hash = await sha256(file, hashSignal);
    if (await fileIdentity(file).catch(() => null) === before) digests.set(file, { identity: before, hash });
    else digests.delete(file);
    return hash;
  };
  const sessions = new ZoteroSyncSessionStore(store.root);
  let processedItems = 0;
  let totalItems = 0;
  let processedAttachments = 0;
  let totalAttachments = 0;
  let lastPercent = 0;
  let lastCheckpointAt = 0;
  let lastCheckpointPhase: ZoteroImportProgress['phase'] | null = null;
  const catalogItem = (identity: LibraryItemRecord['sourceIdentities'][number]): LibraryItemRecord | null => {
    const itemId = catalog.findItemIdBySourceIdentity(identity);
    const storageId = itemId ? catalog.itemStorageId(itemId) : null;
    return storageId ? store.readMaterializedItem(storageId) : null;
  };
  const catalogCollection = (sourceLibraryId: string, sourceKey: string) => {
    const id = catalog.findCollectionIdBySource('zotero', sourceLibraryId, sourceKey);
    return id ? store.readMaterializedCollection(id) : null;
  };
  const emit = (value: ZoteroImportProgress): void => {
    const terminal = ['complete', 'canceled', 'failed'].includes(value.phase);
    const timedValue: ZoteroImportProgress = {
      ...value,
      percent: Math.max(lastPercent, value.percent),
      startedAt,
      finishedAt: terminal ? new Date().toISOString() : null,
    };
    lastPercent = timedValue.percent;
    onProgress?.(timedValue);
    const now = Date.now();
    if (timedValue.phase !== lastCheckpointPhase || now - lastCheckpointAt >= 500 || terminal) {
      sessions.progress(requestId, timedValue);
      lastCheckpointAt = now;
      lastCheckpointPhase = timedValue.phase;
    }
  };
  const mismatch = (
    kind: 'libraries' | 'collections' | 'items' | 'attachments' | 'notes',
    expected: number,
    imported: number,
    message: string,
  ): void => {
    verification.mismatches.push({ kind, expected, imported, message });
    verification.status = 'blocked';
  };
  const initialProgress = {
    ...progress(requestId, 'connecting', null, 0, 0, 0, 0, 'Conectando con Zotero…'),
    startedAt,
    finishedAt: null,
  };
  sessions.begin(requestId, selection, initialProgress);
  emit(initialProgress);

  try {
    abortIfNeeded(signal);
    const available = await client.libraries(signal);
    const previouslyImportedIds = catalog.listImportSources('zotero').map((entry) => entry.libraryId);
    const selectedIds = new Set(selection.libraryIds ?? [...available.map(libraryId), ...previouslyImportedIds]);
    const libraries = available.filter((library) => selectedIds.has(libraryId(library)));
    const availableIds = new Set(available.map(libraryId));
    report.librariesMissing = [...selectedIds].filter((id) => !availableIds.has(id));
    verification.expected.libraries = selectedIds.size;

    for (const missingId of report.librariesMissing) {
      const missingAt = new Date().toISOString();
      for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', missingId).entries()) {
        const current = store.readMaterializedItem(storageId);
        if (!current || current.sourceLibraryId !== missingId || current.sourceState === 'library-missing') continue;
        catalog.indexItem(store.upsertItem({ ...current, sourceState: 'library-missing', sourceMissingAt: missingAt }, current.clock.revision), store);
        report.itemsSourceMissing += 1;
        if (index && index % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      for (const [index, collectionId] of catalog.sourceCollectionIds('zotero', missingId).entries()) {
        const current = store.readMaterializedCollection(collectionId);
        if (!current || current.sourceLibraryId !== missingId || current.sourceState === 'library-missing') continue;
        catalog.indexCollection(store.upsertCollection({ ...current, sourceState: 'library-missing', sourceMissingAt: missingAt }, current.clock.revision));
        if (index && index % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      pushFailure(report, null, 'library-missing', `La biblioteca ${missingId} ya no está disponible en Zotero.`, false);
    }
    if (report.librariesMissing.length) {
      mismatch('libraries', selectedIds.size, libraries.length, 'No están disponibles todas las bibliotecas seleccionadas de Zotero.');
    }

    report.libraries = libraries.length;
    for (const library of libraries) {
      abortIfNeeded(signal);
      const sourceLibraryId = libraryId(library);
      let libraryBlocked = false;
      try {
        emit(progress(requestId, 'inventory', library, processedItems, totalItems, processedAttachments, totalAttachments, `Inventariando ${library.name}…`));
        const inventory = await completeInventory(
          client,
          library,
          selection.includeStandaloneFiles !== false,
          selection.copyAttachments !== false,
          signal,
          (loaded, total) => emit(progress(
            requestId, 'inventory', library, processedItems + loaded, totalItems + total,
            processedAttachments, totalAttachments, `Inventariando ${library.name}: ${loaded}/${total}…`,
          )),
        );
        report.itemsStandaloneSkipped += inventory.standaloneSkipped;

        const selectedCollectionIds = new Set(selection.collectionIds ?? []);
        const subset = selectedCollectionIds.size > 0;
        const selectedKeys = new Set<string>();
        const materializedLibraryCollections = store.scanMaterializedCollections().records.filter((entry) =>
          entry.source === 'zotero' && entry.sourceLibraryId === sourceLibraryId && !entry.deletedAt);
        const selectedLocalCollectionIds = new Set<string>();
        if (subset) {
          const byParent = new Map<string, string[]>();
          for (const collection of inventory.collections) {
            const parent = collection.parentCollection || '';
            byParent.set(parent, [...(byParent.get(parent) ?? []), collection.key]);
          }
          const visit = (key: string): void => {
            if (selectedKeys.has(key)) return;
            selectedKeys.add(key);
            for (const child of byParent.get(key) ?? []) visit(child);
          };
          for (const id of selectedCollectionIds) {
            const knownId = catalog.resolveCollectionId(id) ?? id;
            const known = store.readMaterializedCollection(knownId);
            if (known && known.sourceLibraryId !== sourceLibraryId) continue;
            const requestedKey = known?.sourceKey ?? (id.startsWith('zotero:') ? id.slice(7) : id);
            const requestedGroup = /^groups:([^:]+):/.exec(requestedKey)?.[1];
            if ((library.type === 'group' && requestedGroup && requestedGroup !== library.id)
              || (library.type === 'user' && requestedGroup)) continue;
            visit(canonicalTransportKey(library, requestedKey));
            if (known) selectedLocalCollectionIds.add(known.id);
          }
          const localChildren = new Map<string, string[]>();
          for (const collection of materializedLibraryCollections) {
            if (!collection.parentId) continue;
            localChildren.set(collection.parentId, [...(localChildren.get(collection.parentId) ?? []), collection.id]);
          }
          const visitLocal = (id: string): void => {
            if (selectedLocalCollectionIds.has(id)) {
              for (const child of localChildren.get(id) ?? []) {
                if (!selectedLocalCollectionIds.has(child)) { selectedLocalCollectionIds.add(child); visitLocal(child); }
              }
            }
          };
          for (const id of [...selectedLocalCollectionIds]) visitLocal(id);
        }

        emit(progress(requestId, 'collections', library, processedItems, totalItems, processedAttachments, totalAttachments, `Reconciliando colecciones de ${library.name}…`));
        const visibleCollections = subset
          ? inventory.collections.filter((entry) => selectedKeys.has(entry.key))
          : inventory.collections;
        const collectionIds = new Map<string, string>();
        for (const collection of visibleCollections) {
          const current = catalogCollection(sourceLibraryId, collection.itemKey)
            ?? store.readMaterializedCollection(legacyCollectionAlias(collection.key));
          collectionIds.set(collection.key, current?.id ?? `nodus:collection:${randomUUID()}`);
        }
        if (subset) for (const id of collectionIds.values()) selectedLocalCollectionIds.add(id);
        const positionByParent = new Map<string | null, number>();
        for (const [collectionIndex, collection] of visibleCollections.entries()) {
          abortIfNeeded(signal);
          const id = collectionIds.get(collection.key)!;
          const parentId = collection.parentCollection && (!subset || selectedKeys.has(collection.parentCollection))
            ? collectionIds.get(collection.parentCollection) ?? null : null;
          const current = catalogCollection(sourceLibraryId, collection.itemKey)
            ?? store.readMaterializedCollection(id);
          const aliases = [...new Set([
            ...(current?.aliases ?? []),
            qualifiedCollectionAlias(library, collection.itemKey),
            ...(legacyAliasIsUnambiguous(library, collection.key) ? [legacyCollectionAlias(collection.key)] : []),
          ].filter((alias) => alias !== id))];
          const desired = {
            id, name: collection.name.trim() || '(sin nombre)', parentId,
            position: positionByParent.get(parentId) ?? 0, source: 'zotero' as const,
            sourceLibraryId, sourceKey: collection.itemKey, aliases,
            sourceState: 'current' as const,
            ...(current?.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
            deletedAt: null,
          };
          positionByParent.set(parentId, desired.position + 1);
          if (!current) { catalog.indexCollection(store.upsertCollection(desired)); report.collectionsCreated += 1; }
          else if (comparableCollection(current) === comparableCollection({ ...current, ...desired })) report.collectionsUnchanged += 1;
          else { catalog.indexCollection(store.upsertCollection(desired, current.clock.revision)); report.collectionsUpdated += 1; }
          if (collectionIndex && collectionIndex % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (!subset) {
          const visibleIds = new Set(collectionIds.values());
          for (const [index, collectionId] of catalog.sourceCollectionIds('zotero', sourceLibraryId).entries()) {
            const current = store.readMaterializedCollection(collectionId);
            if (!current || current.deletedAt || visibleIds.has(current.id) || current.sourceState === 'source-missing') continue;
            catalog.indexCollection(store.upsertCollection({ ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString() }, current.clock.revision));
            if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
          }
        } else {
          const inventoryCollectionByRawKey = new Map(inventory.collections.map((entry) => [entry.itemKey, entry]));
          const visibleIds = new Set(collectionIds.values());
          for (const localId of selectedLocalCollectionIds) {
            if (visibleIds.has(localId)) continue;
            const current = store.readMaterializedCollection(localId);
            if (!current || current.sourceLibraryId !== sourceLibraryId || !current.sourceKey) continue;
            const sourceCollection = inventoryCollectionByRawKey.get(current.sourceKey);
            if (!sourceCollection) {
              if (current.sourceState !== 'source-missing') {
                catalog.indexCollection(store.upsertCollection({
                  ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString(),
                }, current.clock.revision));
              }
              continue;
            }
            const sourceParentKey = sourceCollection.parentCollection
              ? rawZoteroKey(sourceCollection.parentCollection) : null;
            const parentId = sourceParentKey ? catalogCollection(sourceLibraryId, sourceParentKey)?.id ?? null : null;
            const desired = {
              ...current,
              name: sourceCollection.name.trim() || '(sin nombre)',
              parentId,
              sourceState: 'current' as const,
              ...(current.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
            };
            if (comparableCollection(current) !== comparableCollection(desired)) {
              catalog.indexCollection(store.upsertCollection(desired, current.clock.revision));
            }
          }
        }

        const visibleItems = inventory.items.filter((item) => {
          if (subset) return item.collections.some((key) => selectedKeys.has(key));
          return selection.includeUnfiled === false ? item.collections.length > 0 : true;
        });
        const visibleItemKeys = new Set(visibleItems.map((item) => item.itemKey));
        report.itemsDiscovered += visibleItems.length;
        totalItems += visibleItems.length;
        const desiredByKey = new Map<string, LibraryItemRecord>();

        for (const item of visibleItems) {
          const itemStartedAt = new Date().toISOString();
          abortIfNeeded(signal);
          const identity = zoteroSourceIdentity(sourceLibraryId, item.itemKey);
          const legacyAtTransportKey = store.readMaterializedItem(item.key);
          const current = catalogItem(identity)
            ?? (legacyAtTransportKey?.sourceIdentities.some((entry) => librarySourceIdentityKey(entry) === librarySourceIdentityKey(identity))
              ? legacyAtTransportKey : null);
          const preservedCollectionIds = (current?.collectionIds ?? []).filter((id) => {
            const collection = store.readMaterializedCollection(id);
            return collection?.source !== 'zotero' || collection.sourceLibraryId !== sourceLibraryId
              || (subset && !selectedLocalCollectionIds.has(id));
          });
          const id = current?.id ?? `nodus:${randomUUID()}`;
          const aliases = [...new Set([
            ...(current?.aliases ?? []), qualifiedItemAlias(library, item.itemKey),
            ...(legacyAliasIsUnambiguous(library, item.key) ? [`zotero:${item.key}`] : []),
          ].filter((alias) => alias !== id))];
          const identityMap = [...new Map([...(current?.sourceIdentities ?? []), identity]
            .map((entry) => [librarySourceIdentityKey(entry), entry])).values()];
          const localTags = current?.localTags ?? [];
          const suppressedSourceTags = current?.suppressedSourceTags ?? [];
          const sourceMetadata = metadata(item);
          sourceMetadata.tags = [...new Set([
            ...(sourceMetadata.tags ?? []).filter((tag) => !suppressedSourceTags.includes(tag)), ...localTags,
          ])];
          const sourceCitationKey = item.fields?.citationKey?.trim() || sourceMetadata.extra?.['Citation Key']?.trim();
          const desired = {
            ...(current ?? {}),
            id, storageId: current?.storageId ?? id, aliases, sourceIdentities: identityMap, source: 'zotero' as const,
            sourceLibraryId, sourceKey: item.itemKey,
            ...(current?.citationKey || sourceCitationKey ? { citationKey: current?.citationKey ?? sourceCitationKey } : {}),
            metadata: applyMetadataOverrides(sourceMetadata, current?.metadataOverrides),
            ...(current?.metadataOverrides ? { metadataOverrides: current.metadataOverrides } : {}),
            ...(localTags.length ? { localTags } : {}),
            ...(suppressedSourceTags.length ? { suppressedSourceTags } : {}),
            collectionIds: [...new Set([
              ...preservedCollectionIds,
              ...item.collections.filter((key) => !subset || selectedKeys.has(key)).flatMap((key) => {
                const collectionId = collectionIds.get(key);
                return collectionId ? [collectionId] : [];
              }),
            ])],
            attachments: current?.attachments ?? [],
            ...(current?.notes ? { notes: current.notes } : {}),
            ...(current?.files ? { files: current.files } : {}),
            extraction: current?.extraction ?? { status: 'pending' as const },
            sourceState: 'current' as const,
            ...(current?.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
            lastSourceSyncAt: current?.sourceVersion === item.version ? current.lastSourceSyncAt : new Date().toISOString(),
            sourceVersion: item.version,
            deletedAt: null,
          };
          let stored: LibraryItemRecord;
          if (!current) { stored = store.upsertItem(desired); report.itemsCreated += 1; }
          else if (comparableItem(current) === comparableItem({ ...current, ...desired })) {
            stored = current;
            report.itemsUnchanged += 1;
          } else {
            if (current.sourceVersion !== item.version && (current.metadataOverrides || preservedCollectionIds.length > 0)) report.conflicts += 1;
            stored = store.upsertItem(desired, current.clock.revision);
            report.itemsUpdated += 1;
          }
          desiredByKey.set(item.itemKey, stored);
          catalog.indexItem(stored, store);
          processedItems += 1;
          emit({
            ...progress(requestId, 'catalog', library, processedItems, totalItems, processedAttachments, totalAttachments, `Catálogo disponible: ${item.title}`),
            currentItem: item.title,
            currentItemStartedAt: itemStartedAt,
          });
          if (processedItems % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }

        // Absence is authoritative only when the user's selection covers the entire
        // importable source. A filtered run must never make out-of-scope records vanish.
        const completeItemScope = !subset && selection.includeUnfiled !== false && selection.includeStandaloneFiles !== false;
        if (completeItemScope) {
          for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', sourceLibraryId).entries()) {
            const current = store.readMaterializedItem(storageId);
            if (!current || current.deletedAt || !current.sourceKey || visibleItemKeys.has(current.sourceKey)
              || current.sourceState === 'source-missing') continue;
            const belongsToLibrary = current.sourceIdentities.some((entry) => entry.source === 'zotero'
              && entry.libraryType === library.type && entry.libraryId === String(library.id || '0'));
            if (!belongsToLibrary) continue;
            catalog.indexItem(store.upsertItem({ ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString() }, current.clock.revision), store);
            report.itemsSourceMissing += 1;
            if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
          }
        } else if (subset && selectedLocalCollectionIds.size) {
          const inventoryItemsByRawKey = new Map(inventory.items.map((entry) => [entry.itemKey, entry]));
          for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', sourceLibraryId).entries()) {
            const current = store.readMaterializedItem(storageId);
            if (!current || current.deletedAt || !current.sourceKey || visibleItemKeys.has(current.sourceKey)) continue;
            if (!current.collectionIds.some((id) => selectedLocalCollectionIds.has(id))) continue;
            const sourceItem = inventoryItemsByRawKey.get(current.sourceKey);
            if (!sourceItem) {
              if (selection.includeStandaloneFiles === false
                && current.metadata.extra?.['Zotero item type'] === 'attachment') continue;
              if (current.sourceState !== 'source-missing') {
                catalog.indexItem(store.upsertItem({
                  ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString(),
                }, current.clock.revision), store);
                report.itemsSourceMissing += 1;
              }
            } else {
              const outsideSourceCollectionIds = sourceItem.collections
                .filter((key) => !selectedKeys.has(key))
                .flatMap((key) => {
                  const sourceCollection = catalogCollection(sourceLibraryId, rawZoteroKey(key));
                  return sourceCollection ? [sourceCollection.id] : [];
                });
              const collectionIds = [...new Set([
                ...current.collectionIds.filter((id) => !selectedLocalCollectionIds.has(id)),
                ...outsideSourceCollectionIds,
              ])];
              if (canonicalJson(current.collectionIds) !== canonicalJson(collectionIds)) {
                catalog.indexItem(store.upsertItem({ ...current, collectionIds }, current.clock.revision), store);
              }
            }
            if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
          }
        } else if (!subset && selection.includeUnfiled === false) {
          // A complete inventory still tells us what happened to records outside the
          // selected "filed only" view. If an imported item became unfiled, remove its
          // stale Zotero memberships; if it disappeared from the inventory altogether,
          // retain it recoverably as source-missing. Advancing a checkpoint while
          // leaving the old collection membership behind would make a filtered import
          // claim success for data that no longer matches Zotero.
          const inventoryItemsByRawKey = new Map(inventory.items.map((entry) => [entry.itemKey, entry]));
          for (const [index, storageId] of catalog.sourceItemStorageIds('zotero', sourceLibraryId).entries()) {
            const current = store.readMaterializedItem(storageId);
            if (!current || current.deletedAt || !current.sourceKey || visibleItemKeys.has(current.sourceKey)) continue;
            const sourceItem = inventoryItemsByRawKey.get(current.sourceKey);
            if (!sourceItem) {
              if (selection.includeStandaloneFiles === false
                && current.metadata.extra?.['Zotero item type'] === 'attachment') continue;
              if (current.sourceState !== 'source-missing') {
                catalog.indexItem(store.upsertItem({
                  ...current, sourceState: 'source-missing', sourceMissingAt: new Date().toISOString(),
                }, current.clock.revision), store);
                report.itemsSourceMissing += 1;
              }
            } else {
              const retainedCollectionIds = current.collectionIds.filter((id) => {
                const collection = store.readMaterializedCollection(id);
                return collection?.source !== 'zotero' || collection.sourceLibraryId !== sourceLibraryId;
              });
              const desired = {
                ...current,
                collectionIds: retainedCollectionIds,
                sourceState: 'current' as const,
                ...(current.sourceMissingAt ? { sourceMissingAt: undefined } : {}),
              };
              if (comparableItem(current) !== comparableItem(desired)) {
                catalog.indexItem(store.upsertItem(desired, current.clock.revision), store);
              }
            }
            if (index && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }

        const notesByParent = new Map<string, zotero.ZoteroChildNote[]>();
        for (const note of inventory.notes) {
          const parent = rawZoteroKey(note.parentItem);
          if (!visibleItemKeys.has(parent)) continue;
          notesByParent.set(parent, [...(notesByParent.get(parent) ?? []), note]);
        }
        emit(progress(requestId, 'notes', library, processedItems, totalItems, processedAttachments, totalAttachments, 'Catálogo listo; reconciliando notas…'));
        const { default: TurndownService } = await import('turndown');
        const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
        for (const [noteIndex, item] of visibleItems.entries()) {
          const itemStartedAt = new Date().toISOString();
          abortIfNeeded(signal);
          emit({
            ...progress(requestId, 'notes', library, processedItems, totalItems, processedAttachments, totalAttachments,
              `Notas: ${item.title}`, visibleItems.length ? noteIndex / visibleItems.length : 0),
            currentItem: item.title,
            currentItemStartedAt: itemStartedAt,
          });
          let current = desiredByKey.get(item.itemKey) ?? catalogItem(zoteroSourceIdentity(sourceLibraryId, item.itemKey));
          if (!current) { libraryBlocked = true; continue; }
          try {
            const priorNotes = current.notes ?? [];
            const mirrored = (notesByParent.get(item.itemKey) ?? []).map((note) => {
              const rawKey = note.itemKey || rawZoteroKey(note.key);
              const markdown = turndown.turndown(note.html).trim();
              const prior = priorNotes.find((entry) => entry.source === 'zotero' && entry.sourceKey === rawKey);
              const changed = !prior || prior.title !== note.title || prior.markdown !== markdown || prior.sourceVersion !== note.version;
              return {
                id: prior?.id ?? `zotero-note:${note.key}`,
                title: note.title,
                markdown,
                source: 'zotero' as const,
                sourceKey: rawKey,
                sourceVersion: note.version,
                readOnly: true,
                createdAt: prior?.createdAt ?? new Date().toISOString(),
                updatedAt: changed ? new Date().toISOString() : prior.updatedAt,
              };
            });
            const notes = [...priorNotes.filter((note) => note.source !== 'zotero'), ...mirrored];
            if (comparableItem(current) !== comparableItem({ ...current, notes })) {
              current = store.upsertItem({ ...current, notes }, current.clock.revision);
              desiredByKey.set(item.itemKey, current);
              catalog.indexItem(current, store);
            }
          } catch (error) {
            const failure = syncFailure(error, sourceLibraryId);
            pushFailure(report, library, failure.code, `No se pudieron reconciliar las notas de ${item.title}: ${failure.message}`, failure.retryable);
            libraryBlocked = true;
          }
        }

        const attachmentsByParent = new Map<string, ZoteroAttachmentInfo[]>();
        for (const attachment of inventory.attachments) {
          const parent = attachment.parentItem
            ? rawZoteroKey(attachment.parentItem)
            : visibleItemKeys.has(attachment.itemKey) ? attachment.itemKey : null;
          if (!parent || !visibleItemKeys.has(parent)) continue;
          attachmentsByParent.set(parent, [...(attachmentsByParent.get(parent) ?? []), attachment]);
        }
        for (const item of visibleItems) {
          const attachments = attachmentsByParent.get(item.itemKey) ?? [];
          report.attachmentsLinkOnly += attachments.filter((entry) => entry.linkMode === 'linked_url').length;
          if (selection.copyAttachments !== false) totalAttachments += attachments.filter((entry) => entry.linkMode !== 'linked_url').length;
        }

        const expectedHashes = new Map<string, string>();
        const expectedSourceFiles = new Map<string, string>();
        if (selection.copyAttachments !== false) {
          emit(progress(requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments, 'Copiando y verificando adjuntos…'));
          for (const [fileIndex, item] of visibleItems.entries()) {
            const itemStartedAt = new Date().toISOString();
            abortIfNeeded(signal);
            emit({
              ...progress(requestId, 'attachments', library, processedItems, totalItems, processedAttachments, totalAttachments,
                `Adjuntos: ${item.title}`, visibleItems.length ? fileIndex / visibleItems.length : 0),
              currentItem: item.title,
              currentItemStartedAt: itemStartedAt,
            });
            const attachments = (attachmentsByParent.get(item.itemKey) ?? [])
              .filter((entry) => entry.linkMode !== 'linked_url')
              .sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
            let current = desiredByKey.get(item.itemKey) ?? catalogItem(zoteroSourceIdentity(sourceLibraryId, item.itemKey));
            if (!current) { libraryBlocked = true; continue; }
            const localAttachments = current.attachments.filter((entry) => !entry.sourceKey).map((entry) => ({ ...entry }));
            const sourceAttachments: LibraryAttachmentRecord[] = [];
            const seenSourceKeys = new Set<string>();

            for (let index = 0; index < attachments.length; index += 1) {
              abortIfNeeded(signal);
              const attachment = attachments[index];
              seenSourceKeys.add(attachment.itemKey);
              const previous = current.attachments.find((entry) => entry.sourceKey === attachment.itemKey);
              const preserveFailed = (): void => {
                if (previous) sourceAttachments.push({
                  ...previous,
                  ...(attachment.version !== undefined ? { sourceVersion: attachment.version } : {}),
                  ...(attachment.dateModified ? { sourceModifiedAt: attachment.dateModified } : {}),
                  sourceState: 'not-downloaded',
                });
              };
              try {
                const sourcePath = await client.attachmentFilePath(library.id, attachment.key, library, signal);
                if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
                  throw codedError(`Adjunto no disponible: ${item.title} — ${attachment.title}`, 'attachment-unavailable');
                }
                const sourceHash = await hashFile(sourcePath, signal);
                const attachmentIdentity = `${item.itemKey}:${attachment.itemKey}`;
                expectedHashes.set(attachmentIdentity, sourceHash);
                expectedSourceFiles.set(attachmentIdentity, sourcePath);
                // The materialized source path is authoritative. Zotero can keep an
                // obsolete filename in metadata after renaming a storage file; using
                // that stale extension would dispatch the copied bytes to the wrong
                // extractor. MIME is part of the same source descriptor and must be
                // refreshed even when the bytes themselves did not change.
                const fileName = path.basename(sourcePath) || path.basename(attachment.filename || '') || 'adjunto';
                const mimeType = attachment.contentType || 'application/octet-stream';
                const previousPath = previous
                  ? resolveLibraryFile(store.itemFolder(current.storageId), previous.relativePath)
                  : null;
                const descriptorUnchanged = previous?.fileName === fileName
                  && previous.mimeType === mimeType
                  && path.extname(previous.relativePath).toLocaleLowerCase() === path.extname(fileName).toLocaleLowerCase();
                if (previous?.sha256 === sourceHash && descriptorUnchanged
                  && previousPath && await hashFile(previousPath, signal) === sourceHash) {
                  sourceAttachments.push({
                    ...previous,
                    title: attachment.title,
                    ...(attachment.version !== undefined ? { sourceVersion: attachment.version } : {}),
                    ...(attachment.dateModified ? { sourceModifiedAt: attachment.dateModified } : {}),
                    role: attachmentRole(attachment, index),
                    position: index,
                    sourceState: 'available',
                  });
                  report.attachmentsUnchanged += 1;
                  continue;
                }

                const attachmentDirectory = assertInside(store.itemFolder(current.storageId), path.join(store.itemFolder(current.storageId), 'attachments'));
                const candidates = [
                  fitLibraryFileName(`${safeLibraryFolderName(attachment.itemKey)}-${safeLibraryFileName(fileName)}`),
                  fitLibraryFileName(`${safeLibraryFolderName(attachment.itemKey)}-${sourceHash.slice(0, 12)}-${safeLibraryFileName(fileName)}`),
                ];
                let destination: string | null = null;
                let reusedExisting = false;
                for (const candidate of candidates) {
                  const candidatePath = assertInside(attachmentDirectory, path.join(attachmentDirectory, candidate));
                  if (!fs.existsSync(candidatePath)) { destination = candidatePath; break; }
                  if (fs.statSync(candidatePath).isFile() && await hashFile(candidatePath, signal) === sourceHash) {
                    destination = candidatePath;
                    reusedExisting = true;
                    break;
                  }
                }
                if (!destination) {
                  destination = assertInside(attachmentDirectory, path.join(
                    attachmentDirectory,
                    fitLibraryFileName(`${safeLibraryFolderName(attachment.itemKey)}-${sourceHash.slice(0, 12)}-${randomUUID().slice(0, 8)}-${safeLibraryFileName(fileName)}`),
                  ));
                }
                if (!reusedExisting) await copyImmutable(sourcePath, destination, signal);
                const destinationHash = await hashFile(destination, signal);
                if (destinationHash !== sourceHash) {
                  throw codedError(`La copia no coincide con Zotero: ${item.title} — ${attachment.title}`, 'attachment-corrupt');
                }
                const stat = fs.statSync(destination);
                sourceAttachments.push({
                  id: attachment.key,
                  title: attachment.title,
                  fileName,
                  relativePath: path.relative(store.itemFolder(current.storageId), destination),
                  mimeType,
                  byteSize: stat.size,
                  sha256: sourceHash,
                  role: attachmentRole(attachment, index),
                  position: index,
                  addedAt: previous?.addedAt ?? new Date().toISOString(),
                  sourceKey: attachment.itemKey,
                  ...(attachment.version !== undefined ? { sourceVersion: attachment.version } : {}),
                  ...(attachment.dateModified ? { sourceModifiedAt: attachment.dateModified } : {}),
                  sourceState: 'available',
                });
                if (reusedExisting) report.attachmentsUnchanged += 1;
                else report.attachmentsCopied += 1;
                if (previous) report.attachmentsChanged += 1;
              } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
                const failure = syncFailure(error, sourceLibraryId);
                const code = failure.code === 'unknown' ? 'storage' : failure.code;
                pushFailure(report, library, code, failure.message, failure.retryable);
                report.attachmentsUnavailable += 1;
                libraryBlocked = true;
                preserveFailed();
              } finally {
                processedAttachments += 1;
              }
            }

            sourceAttachments.push(...current.attachments
              .filter((entry) => entry.sourceKey && !seenSourceKeys.has(entry.sourceKey))
              .map((entry) => ({ ...entry, sourceState: 'source-missing' as const })));
            const copied = [...sourceAttachments, ...localAttachments];
            const currentItemFolder = store.itemFolder(current.storageId);
            const usable = copied.filter((entry) => entry.sourceState !== 'source-missing'
              && resolveLibraryFile(currentItemFolder, entry.relativePath));
            const primary = usable.find((entry) => entry.sourceKey && entry.role === 'original')
              ?? usable.find((entry) => !entry.sourceKey && entry.role === 'original')
              ?? usable[0];
            copied.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0)
              || (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
              || (a.addedAt ?? '').localeCompare(b.addedAt ?? ''));
            copied.forEach((entry, index) => { entry.position = index; });
            const files = { ...(current.files ?? {}), annotations: current.files?.annotations ?? 'annotations.json' };
            if (primary) files.original = primary.relativePath;
            else delete files.original;
            const desired = { ...current, attachments: copied, files };
            if (comparableItem(current) !== comparableItem(desired)) {
              current = store.upsertItem(desired, current.clock.revision);
              desiredByKey.set(item.itemKey, current);
              catalog.indexItem(current, store);
            }
          }
        }

        emit(progress(requestId, 'verification', library, processedItems, totalItems, processedAttachments, totalAttachments, `Verificando ${library.name} contra el inventario…`));
        const expectedCounts = {
          collections: visibleCollections.length,
          items: visibleItems.length,
          notes: [...notesByParent.values()].reduce((sum, entries) => sum + entries.length, 0),
          attachments: selection.copyAttachments === false ? 0 : [...attachmentsByParent.entries()]
            .filter(([parent]) => visibleItemKeys.has(parent))
            .reduce((sum, [, entries]) => sum + entries.filter((entry) => entry.linkMode !== 'linked_url').length, 0),
        };
        const importedCounts = { collections: 0, items: 0, notes: 0, attachments: 0 };
        const semanticMismatchKinds = new Set<'collections' | 'items' | 'notes' | 'attachments'>();
        for (const collection of visibleCollections) {
          const current = catalogCollection(sourceLibraryId, collection.itemKey);
          const expectedParentId = collection.parentCollection && (!subset || selectedKeys.has(collection.parentCollection))
            ? collectionIds.get(collection.parentCollection) ?? null : null;
          if (current && !current.deletedAt && current.sourceState === 'current'
            && current.name === (collection.name.trim() || '(sin nombre)')
            && current.parentId === expectedParentId
            && current.sourceKey === collection.itemKey) importedCounts.collections += 1;
          else semanticMismatchKinds.add('collections');
        }
        for (const item of visibleItems) {
          const current = catalogItem(zoteroSourceIdentity(sourceLibraryId, item.itemKey));
          if (!current || current.deletedAt || current.sourceState !== 'current') continue;
          const expectedMetadata = metadata(item);
          expectedMetadata.tags = [...new Set([
            ...(expectedMetadata.tags ?? []).filter((tag) => !(current.suppressedSourceTags ?? []).includes(tag)),
            ...(current.localTags ?? []),
          ])];
          const expectedSourceCollectionIds = item.collections
            .filter((key) => !subset || selectedKeys.has(key))
            .flatMap((key) => collectionIds.get(key) ?? []);
          const actualSourceCollectionIds = current.collectionIds.filter((id) => {
            const collection = store.readMaterializedCollection(id);
            return collection?.source === 'zotero' && collection.sourceLibraryId === sourceLibraryId
              && (!subset || selectedLocalCollectionIds.has(id));
          });
          const itemSemanticallyExact = canonicalJson(current.metadata) === canonicalJson(applyMetadataOverrides(expectedMetadata, current.metadataOverrides))
            && canonicalJson([...new Set(actualSourceCollectionIds)].sort()) === canonicalJson([...new Set(expectedSourceCollectionIds)].sort())
            && current.sourceVersion === item.version
            && current.sourceKey === item.itemKey;
          if (itemSemanticallyExact) importedCounts.items += 1;
          else semanticMismatchKinds.add('items');

          const expectedNotes = notesByParent.get(item.itemKey) ?? [];
          const importedNotes = (current.notes ?? []).filter((note) => note.source === 'zotero');
          let exactNotes = 0;
          for (const note of expectedNotes) {
            const key = note.itemKey || rawZoteroKey(note.key);
            const markdown = turndown.turndown(note.html).trim();
            const record = importedNotes.find((entry) => entry.sourceKey === key);
            if (record && record.title === note.title && record.markdown === markdown
              && record.sourceVersion === note.version && record.readOnly) exactNotes += 1;
          }
          importedCounts.notes += exactNotes;
          if (exactNotes !== expectedNotes.length || importedNotes.length !== expectedNotes.length) semanticMismatchKinds.add('notes');
          if (selection.copyAttachments !== false) {
            const expectedAttachments = (attachmentsByParent.get(item.itemKey) ?? [])
              .filter((entry) => entry.linkMode !== 'linked_url')
              .sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
            const importedSourceAttachments = current.attachments.filter((entry) => entry.sourceKey && entry.sourceState !== 'source-missing');
            let exactAttachments = 0;
            for (const [attachmentIndex, attachment] of expectedAttachments.entries()) {
              const record = current.attachments.find((entry) => entry.sourceKey === attachment.itemKey && entry.sourceState === 'available');
              const attachmentIdentity = `${item.itemKey}:${attachment.itemKey}`;
              const expectedHash = expectedHashes.get(attachmentIdentity);
              const sourcePath = expectedSourceFiles.get(attachmentIdentity);
              const storedPath = record ? resolveLibraryFile(store.itemFolder(current.storageId), record.relativePath) : null;
              if (!record || !expectedHash || !sourcePath || record.sha256 !== expectedHash || !storedPath) continue;
              try {
                const provenanceExact = record.title === attachment.title
                  && record.fileName === path.basename(sourcePath)
                  && record.mimeType === (attachment.contentType || 'application/octet-stream')
                  && path.extname(record.relativePath).toLocaleLowerCase() === path.extname(sourcePath).toLocaleLowerCase()
                  && record.byteSize === fs.statSync(sourcePath).size
                  && record.role === attachmentRole(attachment, attachmentIndex)
                  && (attachment.version === undefined || record.sourceVersion === attachment.version)
                  && (!attachment.dateModified || record.sourceModifiedAt === attachment.dateModified);
                // Hash the source a second time at the verification barrier. Linked
                // files live outside Zotero storage and can change without increasing
                // the Zotero library version; a single pre-copy hash cannot detect that
                // race. Both ends must still equal the same immutable expectation.
                if (provenanceExact
                  && await hashFile(sourcePath, signal) === expectedHash
                  && await hashFile(storedPath, signal) === expectedHash) exactAttachments += 1;
              } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
                // Count mismatch below is the durable verification result.
              }
            }
            importedCounts.attachments += exactAttachments;
            if (exactAttachments !== expectedAttachments.length || importedSourceAttachments.length !== expectedAttachments.length) {
              semanticMismatchKinds.add('attachments');
            }
          }
        }
        verification.expected.collections = (verification.expected.collections ?? 0) + expectedCounts.collections;
        verification.expected.items += expectedCounts.items;
        verification.expected.notes = (verification.expected.notes ?? 0) + expectedCounts.notes;
        verification.expected.attachments += expectedCounts.attachments;
        verification.imported.collections = (verification.imported.collections ?? 0) + importedCounts.collections;
        verification.imported.items += importedCounts.items;
        verification.imported.notes = (verification.imported.notes ?? 0) + importedCounts.notes;
        verification.imported.attachments += importedCounts.attachments;
        for (const kind of ['collections', 'items', 'notes', 'attachments'] as const) {
          if (expectedCounts[kind] !== importedCounts[kind] || semanticMismatchKinds.has(kind)) {
            mismatch(kind, expectedCounts[kind], importedCounts[kind],
              `${library.name}: ${kind} exactos ${importedCounts[kind]}/${expectedCounts[kind]} (identidad, metadatos, estructura y contenido verificados).`);
            libraryBlocked = true;
          }
        }

        const finalVersion = await client.libraryVersion(library.id, library, signal);
        if (finalVersion !== inventory.version) {
          pushFailure(report, library, 'concurrent-source-change',
            `Zotero cambió ${library.name} durante la copia (${inventory.version} → ${finalVersion}); se requiere reintentar.`, true);
          libraryBlocked = true;
        }
        if (libraryBlocked) {
          if (!verification.mismatches.some((entry) => entry.kind === 'libraries' && entry.message?.startsWith(`${library.name}:`))) {
            mismatch('libraries', 1, 0, `${library.name}: la verificación quedó bloqueada; no se avanzó el checkpoint.`);
          }
        } else {
          catalog.putImportSource({
            sourceId: importSourceId(library), source: 'zotero', libraryId: sourceLibraryId,
            libraryName: library.name, version: inventory.version, importedAt: new Date().toISOString(),
            configuration: { ...selection, libraryIds: [sourceLibraryId] },
          });
          verification.imported.libraries = (verification.imported.libraries ?? 0) + 1;
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
        const failure = syncFailure(error, sourceLibraryId);
        report.failures.push(failure);
        report.warnings.push(failure.message);
        report.partial = true;
        verification.status = 'blocked';
        mismatch('libraries', 1, 0, `${library.name}: ${failure.message}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    emit(progress(requestId, 'rebuild', null, processedItems, totalItems, processedAttachments, totalAttachments, 'Verificando el índice local…'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    report.partial = report.partial || report.failures.length > 0 || report.librariesMissing.length > 0 || verification.status === 'blocked';
    if (verification.status === 'blocked' && !report.failures.some((entry) => entry.code === 'verification-mismatch')) {
      report.failures.push({
        libraryId: null,
        code: 'verification-mismatch',
        message: 'La importación no coincide al 100 % con el inventario de Zotero.',
        retryable: true,
      });
    }
    const failed = report.partial || verification.status === 'blocked';
    const failureDetail = report.failures[0]?.message?.trim();
    const finalPhase: ZoteroImportProgress['phase'] = failed ? 'failed' : options.deferSessionCompletion ? 'rebuild' : 'complete';
    emit(progress(requestId, finalPhase, null, processedItems, totalItems, processedAttachments, totalAttachments,
      failed
        ? `${failureDetail || 'No se pudo verificar completamente la importación de Zotero.'} Los datos locales se conservan y la sesión puede reintentarse.`
        : options.deferSessionCompletion
          ? 'Finalizando claves de cita y cola de extracción…'
          : 'Importación de Zotero completada y verificada.'));
    report.durationMs = Date.now() - started;
    if (failed || !options.deferSessionCompletion) {
      sessions.finish(requestId, failed ? 'failed' : 'completed', report,
        failed ? report.failures[0]?.message ?? 'Verificación de importación bloqueada.' : null);
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      report.canceled = true;
      verification.status = 'blocked';
      await new Promise<void>((resolve) => setImmediate(resolve));
      emit(progress(requestId, 'canceled', null, processedItems, totalItems, processedAttachments, totalAttachments,
        'Importación cancelada; el catálogo ya importado se conserva.'));
      report.durationMs = Date.now() - started;
      sessions.finish(requestId, 'canceled', report);
    } else {
      const failure = syncFailure(error, null);
      report.failures.push(failure);
      report.warnings.push(failure.message);
      report.partial = true;
      verification.status = 'blocked';
      await new Promise<void>((resolve) => setImmediate(resolve));
      emit(progress(requestId, 'failed', null, processedItems, totalItems, processedAttachments, totalAttachments,
        `${failure.message} Los datos locales se conservan.`));
      report.durationMs = Date.now() - started;
      sessions.finish(requestId, 'failed', report, failure.message);
    }
  }
  if (!report.durationMs) report.durationMs = Date.now() - started;
  return report;
}
