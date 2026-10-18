import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCollectionView,
  LibraryCollectionRecord,
  LibraryCollectionPatch,
  LibraryCollectionIcon,
  LibraryBibliographyImportReport,
  LibraryCatalogItem,
  LibraryDuplicateGroup,
  LibraryItemCollectionPatch,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemType,
  LibraryMetadataOverrides,
  LibraryLocalImportReport,
  LibraryAttachmentPatch,
  LibraryAttachmentRecord,
  LibraryNoteRecord,
  LibraryItemRelationType,
  LibraryCompassCandidate,
  LibraryCompassImportItemResult,
  LibraryCompassImportReport,
  LibrarySourceIdentity,
  LibraryTagPatch,
  LibraryTagRecord,
  LibrarySavedSearchRecord,
  LibrarySmartSearchGroup,
  LibraryViewPreferences,
  LibraryBibliographyExportRequest,
  LibraryCitationResult,
  LibraryCitationStyle,
  LibraryTrashImpact,
  LibraryPurgeReport,
  LibraryMergeImpact,
  LibraryRecoveryReport,
  LibraryRecoveryIssue,
  GlobalLibrarySettings,
} from '@shared/libraryTypes';
import { canonicalJson, librarySourceIdentityKey, normalizeLibraryMetadata, normalizeLibrarySourceIdentity } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import {
  assertInside,
  atomicWriteJson,
  libraryFilePathWithLiteralExtension,
  resolveLibraryFile,
  safeLibraryFileName,
  safeLibraryFolderName,
} from './libraryFileUtils';
import { LibraryDiskStore } from './libraryStorage';
import { importBibliographyFiles } from './libraryBibliographyImport';
import { bibliographicFingerprint } from './libraryRevision';

const COLLECTION_ICONS = new Set<LibraryCollectionIcon>([
  'folder', 'book', 'bookmark', 'star', 'archive', 'notebook',
  'graduation', 'flask', 'globe', 'map', 'users', 'tag',
]);

function collectionIcon(value: LibraryCollectionPatch['icon'], fallback?: LibraryCollectionIcon): LibraryCollectionIcon | undefined {
  if (value === undefined) return fallback;
  if (value === null) return undefined;
  if (!COLLECTION_ICONS.has(value)) throw new Error('El icono de la colección no es válido.');
  return value;
}

function collectionColor(value: LibraryCollectionPatch['color'], fallback?: string): string | undefined {
  if (value === undefined) return fallback;
  if (value === null || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) throw new Error('El color de la colección debe usar el formato hexadecimal #RRGGBB.');
  return normalized;
}
import { LibrarySmartCollectionStore } from './librarySmartCollections';
import { exportLibraryBibliography, formatLibraryCitation, generateCitationKey } from './libraryCitation';
import {
  attachmentRenameType,
  buildAutomaticAttachmentFileName,
  shouldAutoRenameAttachment,
} from '@shared/libraryAttachmentNaming';

function comparable(value: LibraryItemRecord): string {
  const { clock: _clock, createdAt: _createdAt, ...rest } = value;
  return canonicalJson(rest);
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function copyImmutable(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) return;
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    // Windows requires write access to flush the copied file to disk.
    const descriptor = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function normalizedIdentity(value: string | undefined): string {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function compactIdentifier(value: string | undefined): string {
  return normalizedIdentity(value).replace(/\s+/g, '');
}

function creatorLabel(record: LibraryItemRecord): string {
  const creator = record.metadata.creators[0];
  return creator?.name || [creator?.firstName, creator?.lastName].filter(Boolean).join(' ');
}

function recordCatalogItem(record: LibraryItemRecord, store: LibraryDiskStore): LibraryCatalogItem {
  const reader = record.files?.reader ?? 'reader.md';
  return {
    id: record.id, storageId: record.storageId, source: record.source,
    sourceLibraryId: record.sourceLibraryId ?? null, sourceKey: record.sourceKey ?? null,
    sourceState: record.sourceState ?? null,
    citationKey: record.citationKey ?? null, metadata: record.metadata, title: record.metadata.title,
    itemType: record.metadata.itemType, creators: record.metadata.creators, year: record.metadata.year ?? null,
    date: record.metadata.date ?? null, doi: record.metadata.doi ?? null,
    isbn: record.metadata.isbn ?? [], issn: record.metadata.issn ?? [], tags: record.metadata.tags ?? [],
    collectionIds: record.collectionIds, attachmentCount: record.attachments.length,
    readerAvailable: fs.existsSync(path.join(store.itemFolder(record.storageId), reader)),
    extractionStatus: record.extraction?.status ?? 'pending', createdAt: record.createdAt, updatedAt: record.clock.updatedAt,
    deletedAt: record.deletedAt,
  };
}

function copyDirectoryIfMissing(source: string, destination: string): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectoryIfMissing(from, to);
    else if (entry.isFile() && !fs.existsSync(to)) copyImmutable(from, to);
  }
}

function itemType(extension: string): LibraryItemType {
  if (extension === '.epub') return 'book';
  if (['.html', '.htm'].includes(extension)) return 'webpage';
  if (['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(extension)) return 'dataset';
  return 'document';
}

/** Best-effort, offline metadata for a dropped file. Nothing inferred here is
 * authoritative: the full metadata editor remains available after import. */
function inferredLocalFileMetadata(source: string, extension: string): LibraryItemMetadata {
  const decodedStem = (() => {
    const stem = path.basename(source, extension);
    try { return decodeURIComponent(stem); } catch { return stem; }
  })();
  const readableStem = decodedStem.normalize('NFC').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const yearMatch = readableStem.match(/(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/);
  const isbnMatch = readableStem.replace(/[^0-9Xx]/g, '').match(/(?:97[89])?\d{9}[\dXx]/)?.[0];
  const doiMatch = readableStem.match(/10\.\d{4,9}[\s._;/:-]+\S+/i)?.[0]
    ?.replace(/[\s_]+/g, '/').replace(/[),.;]+$/, '');
  return {
    title: readableStem || 'Documento sin título',
    itemType: doiMatch ? 'journal-article' : itemType(extension),
    creators: [], year: yearMatch ? Number(yearMatch[1]) : null,
    doi: doiMatch, isbn: isbnMatch ? [isbnMatch.toUpperCase()] : [], issn: [], tags: [],
    extra: { 'nodus:metadataOrigin': 'filename-inference' },
  };
}

function mimeType(extension: string): string {
  return ({
    '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.md': 'text/markdown', '.markdown': 'text/markdown',
    '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml', '.jats': 'application/xml',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.odt': 'application/vnd.oasis.opendocument.text', '.rtf': 'application/rtf',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odp': 'application/vnd.oasis.opendocument.presentation', '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

const SUPPORTED_ATTACHMENTS = new Set([
  '.pdf', '.epub', '.md', '.markdown', '.txt', '.html', '.htm', '.xml', '.jats',
  '.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx', '.odp',
  '.csv', '.tsv', '.xlsx', '.xls', '.ods',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tif', '.tiff',
]);

function orderedAttachments(attachments: LibraryAttachmentRecord[]): LibraryAttachmentRecord[] {
  return attachments.map((entry, index) => ({ ...entry, position: entry.position ?? index }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
    .map((entry, position) => ({ ...entry, position }));
}

function inverseRelation(type: LibraryItemRelationType): LibraryItemRelationType {
  if (type === 'cites') return 'is-cited-by';
  if (type === 'is-cited-by') return 'cites';
  if (type === 'corrects') return 'is-corrected-by';
  if (type === 'is-corrected-by') return 'corrects';
  return 'related';
}

export class LibraryOperations {
  private readonly smartCollections: LibrarySmartCollectionStore;

  constructor(private readonly store: LibraryDiskStore, private readonly catalog: LibraryCatalog) {
    this.smartCollections = new LibrarySmartCollectionStore(store.root);
  }

  ensureCitationKeys(): number {
    const records = this.store.scanMaterializedItems().records.filter((record) => !record.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const used = new Set<string>(); let changed = 0;
    const indexed: LibraryItemRecord[] = [];
    for (const record of records) {
      const citationKey = generateCitationKey(record.metadata, used, record.citationKey);
      used.add(citationKey);
      if (record.citationKey === citationKey) continue;
      indexed.push(this.store.upsertItem({ ...record, citationKey }, record.clock.revision)); changed += 1;
    }
    if (indexed.length) this.catalog.indexItems(indexed, this.store); return changed;
  }

  listCollections(): LibraryCollectionView[] {
    return this.catalog.listCollections();
  }

  createCollection(name: string, parentId: string | null): LibraryCollectionView {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('La colección necesita un nombre.');
    const canonicalParentId = parentId ? this.catalog.resolveCollectionId(parentId) ?? parentId : null;
    const parent = canonicalParentId ? this.store.readMaterializedCollection(canonicalParentId) : null;
    if (canonicalParentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    if (parent && parent.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
    const siblings = this.catalog.listCollections().filter((entry) => entry.parentId === canonicalParentId);
    const id = `nodus:collection:${randomUUID()}`;
    const record = this.store.upsertCollection({ id, name: clean, parentId: canonicalParentId, position: siblings.length, source: 'nodus', deletedAt: null });
    this.catalog.indexCollection(record);
    return this.catalog.listCollections().find((entry) => entry.id === id)!;
  }

  updateCollection(id: string, patch: LibraryCollectionPatch): LibraryCollectionView {
    id = this.catalog.resolveCollectionId(id) ?? id;
    if (patch.parentId) patch = { ...patch, parentId: this.catalog.resolveCollectionId(patch.parentId) ?? patch.parentId };
    const current = this.store.readMaterializedCollection(id);
    if (!current || current.deletedAt) throw new Error('La colección ya no existe.');
    if (current.source !== 'nodus') throw new Error('Las colecciones importadas se reflejan desde su gestor; crea una colección de Nodus para organizarlas aquí.');
    const name = patch.name === undefined ? current.name : patch.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('La colección necesita un nombre.');
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
    if (parentId === id) throw new Error('Una colección no puede contenerse a sí misma.');
    const parent = parentId ? this.store.readMaterializedCollection(parentId) : null;
    if (parentId && (!parent || parent.deletedAt)) throw new Error('La colección superior ya no existe.');
    if (parent && parent.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
    let cursor = parentId;
    while (cursor) {
      if (cursor === id) throw new Error('Ese movimiento crearía un ciclo de colecciones.');
      cursor = this.store.readMaterializedCollection(cursor)?.parentId ?? null;
    }
    const icon = collectionIcon(patch.icon, current.icon);
    const color = collectionColor(patch.color, current.color);
    const all = this.store.scanMaterializedCollections().records.filter((entry) => !entry.deletedAt);
    const oldSiblings = all.filter((entry) => entry.parentId === current.parentId && entry.id !== id)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const targetSiblings = (parentId === current.parentId ? oldSiblings : all.filter((entry) => entry.parentId === parentId && entry.id !== id))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const requestedPosition = patch.position === undefined
      ? (parentId === current.parentId ? current.position : targetSiblings.length)
      : Math.max(0, Math.trunc(patch.position));
    targetSiblings.splice(Math.min(requestedPosition, targetSiblings.length), 0, { ...current, name, parentId, icon, color });
    const desiredPositions = new Map(targetSiblings.map((entry, position) => [entry.id, position]));
    const indexed: LibraryCollectionRecord[] = [];
    const write = (entry: typeof current, desiredParentId: string | null, desiredPosition: number, desiredName: string, desiredIcon: LibraryCollectionIcon | undefined, desiredColor: string | undefined) => {
      if (entry.parentId === desiredParentId && entry.position === desiredPosition && entry.name === desiredName && entry.icon === desiredIcon && entry.color === desiredColor) return;
      const next = { ...entry, name: desiredName, parentId: desiredParentId, position: desiredPosition, icon: desiredIcon, color: desiredColor };
      if (!desiredIcon) delete next.icon;
      if (!desiredColor) delete next.color;
      indexed.push(this.store.upsertCollection(next, entry.clock.revision));
    };
    write(current, parentId, desiredPositions.get(id) ?? requestedPosition, name, icon, color);
    for (const sibling of targetSiblings) if (sibling.id !== id) write(sibling, parentId, desiredPositions.get(sibling.id)!, sibling.name, sibling.icon, sibling.color);
    if (parentId !== current.parentId) for (const [position, sibling] of oldSiblings.entries()) write(sibling, current.parentId, position, sibling.name, sibling.icon, sibling.color);
    this.catalog.indexCollections(indexed);
    return this.catalog.listCollections().find((entry) => entry.id === id)!;
  }

  deleteCollection(id: string, deleteItems = false): number {
    id = this.catalog.resolveCollectionId(id) ?? id;
    const root = this.store.readMaterializedCollection(id);
    if (!root || root.deletedAt) return 0;
    if (root.source !== 'nodus') throw new Error('Una colección importada solo puede eliminarse en su gestor de origen.');
    const all = this.store.scanMaterializedCollections().records;
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const collection of all) if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) { ids.add(collection.id); changed = true; }
    }
    const now = new Date().toISOString();
    const indexedCollections: LibraryCollectionRecord[] = [];
    const indexedItems: LibraryItemRecord[] = [];
    for (const collectionId of ids) {
      const current = this.store.readMaterializedCollection(collectionId);
      if (current && !current.deletedAt) indexedCollections.push(this.store.upsertCollection({ ...current, deletedAt: now }, current.clock.revision));
    }
    for (const item of this.store.scanMaterializedItems().records) {
      if (item.deletedAt || !item.collectionIds.some((collectionId) => ids.has(collectionId))) continue;
      const desired = deleteItems
        ? { ...item, deletedAt: now }
        : { ...item, collectionIds: item.collectionIds.filter((collectionId) => !ids.has(collectionId)) };
      indexedItems.push(this.store.upsertItem(desired, item.clock.revision));
    }
    this.catalog.indexCollections(indexedCollections);
    this.catalog.indexItems(indexedItems, this.store);
    return ids.size;
  }

  patchItemCollections(itemIds: string[], patch: LibraryItemCollectionPatch): number {
    const canonicalItemIds = new Set(itemIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const add = new Set((patch.add ?? []).map((id) => this.catalog.resolveCollectionId(id) ?? id));
    const remove = new Set((patch.remove ?? []).map((id) => this.catalog.resolveCollectionId(id) ?? id));
    for (const id of new Set([...add, ...remove])) {
      const collection = this.store.readMaterializedCollection(id);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
      if (collection.source !== 'nodus') throw new Error('Las colecciones importadas son de solo lectura en Nodus.');
    }
    let updated = 0; const indexed: LibraryItemRecord[] = [];
    for (const snapshot of this.store.scanMaterializedItems().records) {
      if (!canonicalItemIds.has(snapshot.id) || snapshot.deletedAt) continue;
      // Extraction may update an attachment while the corpus scan is in progress.
      // Rebase this idempotent collection patch onto the latest record; never
      // overwrite its newer files or extraction state with the scan's snapshot.
      for (let attempt = 0; attempt < 3; attempt++) {
        const item = this.store.readMaterializedItem(snapshot.storageId);
        if (!item || item.deletedAt) break;
        const collectionIds = [...new Set([...item.collectionIds.filter((id) => !remove.has(id)), ...add])];
        const desired = { ...item, collectionIds };
        if (comparable(item) === comparable(desired)) break;
        try { indexed.push(this.store.upsertItem(desired, item.clock.revision)); updated += 1; break; }
        catch (error) {
          if (attempt === 2 || !(error instanceof Error) || !error.message.includes('El documento cambió en otro dispositivo.')) throw error;
        }
      }
    }
    if (indexed.length) this.catalog.indexItems(indexed, this.store);
    return updated;
  }

  listSavedSearches(): LibrarySavedSearchRecord[] {
    return this.smartCollections.list();
  }

  saveSavedSearch(input: { id?: string; name: string; query: LibrarySmartSearchGroup }): LibrarySavedSearchRecord {
    return this.smartCollections.save(input);
  }

  mergeSavedSearch(record: LibrarySavedSearchRecord): LibrarySavedSearchRecord {
    return this.smartCollections.merge(record);
  }

  deleteSavedSearch(id: string): boolean {
    return this.smartCollections.delete(id);
  }

  getViewPreferences(): LibraryViewPreferences {
    return this.smartCollections.preferences();
  }

  setViewPreferences(value: LibraryViewPreferences): LibraryViewPreferences {
    return this.smartCollections.setPreferences(value);
  }

  getSettings(): GlobalLibrarySettings {
    return this.smartCollections.settings();
  }

  setSettings(value: GlobalLibrarySettings): GlobalLibrarySettings {
    return this.smartCollections.setSettings(value);
  }

  setItemsDeleted(itemIds: string[], deleted: boolean): number {
    const canonicalItemIds = new Set(itemIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    let updated = 0; const indexed: LibraryItemRecord[] = [];
    const now = new Date().toISOString();
    for (const item of this.store.scanMaterializedItems().records) {
      if (!canonicalItemIds.has(item.id) || Boolean(item.deletedAt) === deleted) continue;
      indexed.push(this.store.upsertItem({ ...item, deletedAt: deleted ? now : null }, item.clock.revision));
      updated += 1;
    }
    if (indexed.length) this.catalog.indexItems(indexed, this.store);
    return updated;
  }

  trashImpact(itemIds: string[]): LibraryTrashImpact {
    const all = this.store.scanMaterializedItems().records;
    const requested = new Set(itemIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const records = all.filter((item) => item.deletedAt && (!requested.size || requested.has(item.id)));
    const items = records.map((item) => {
      const folder = this.store.itemFolder(item.storageId);
      const annotations = readJsonArray(path.join(folder, item.files?.annotations ?? 'annotations.json')).length;
      const orphaned = readJsonArray(path.join(folder, item.files?.orphanedAnnotations ?? 'orphaned-annotations.json')).length;
      const chat = readJsonArray(path.join(folder, item.files?.chat ?? 'chat.json')).length;
      const linkedVaults = this.catalog.listVaultLinks(item.id).map((link) => ({
        vaultId: link.vaultId, vaultName: link.vaultName, workId: link.workId,
      }));
      return {
        itemId: item.id, title: item.metadata.title,
        attachmentCount: item.attachments.length,
        attachmentBytes: item.attachments.reduce((sum, entry) => sum + Math.max(0, entry.byteSize), 0),
        annotationCount: annotations, orphanedAnnotationCount: orphaned,
        chatMessageCount: chat, noteCount: item.notes?.length ?? 0,
        aliasCount: item.aliases.length, relationCount: item.relations?.length ?? 0,
        linkedVaults,
      };
    });
    const linked = items.flatMap((item) => item.linkedVaults);
    return {
      itemIds: records.map((item) => item.id), items,
      attachmentCount: items.reduce((sum, item) => sum + item.attachmentCount, 0),
      attachmentBytes: items.reduce((sum, item) => sum + item.attachmentBytes, 0),
      annotationCount: items.reduce((sum, item) => sum + item.annotationCount, 0),
      orphanedAnnotationCount: items.reduce((sum, item) => sum + item.orphanedAnnotationCount, 0),
      chatMessageCount: items.reduce((sum, item) => sum + item.chatMessageCount, 0),
      noteCount: items.reduce((sum, item) => sum + item.noteCount, 0),
      aliasCount: items.reduce((sum, item) => sum + item.aliasCount, 0),
      relationCount: items.reduce((sum, item) => sum + item.relationCount, 0),
      linkedVaultCount: new Set(linked.map((link) => link.vaultId)).size,
      purgeBlocked: linked.length > 0,
      blockers: [...new Set(linked.map((link) => `${link.vaultName} (${link.workId})`))],
    };
  }

  purgeTrash(itemIds: string[]): LibraryPurgeReport {
    const impact = this.trashImpact(itemIds);
    if (impact.purgeBlocked) throw new Error(`No se puede vaciar: hay contenido vinculado en ${impact.blockers.join(', ')}.`);
    const selected = new Set(impact.itemIds); const warnings: string[] = []; let purged = 0; let archivedRecoveryCopies = 0;
    const allRecords = this.store.scanMaterializedItems().records;
    const relatedUpdates: LibraryItemRecord[] = [];
    for (const record of allRecords) {
      if (selected.has(record.id) || !(record.relations ?? []).some((relation) => selected.has(relation.targetItemId))) continue;
      relatedUpdates.push(this.store.upsertItem({ ...record, relations: (record.relations ?? []).filter((relation) => !selected.has(relation.targetItemId)) }, record.clock.revision));
    }
    for (const id of impact.itemIds) {
      const record = allRecords.find((item) => item.id === id && item.deletedAt);
      if (!record) { warnings.push(`El elemento ${id} ya no estaba en la papelera.`); continue; }
      try { this.store.archivePurgedItem(record); this.catalog.removeItem(record.id); purged += 1; archivedRecoveryCopies += 1; }
      catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
    }
    this.catalog.indexItems(relatedUpdates, this.store);
    return { requested: impact.itemIds.length, purged, archivedRecoveryCopies, blocked: impact.itemIds.length - purged, warnings };
  }

  auditRecovery(): LibraryRecoveryReport {
    const issues: LibraryRecoveryIssue[] = [];
    const scanned = this.store.scanMaterializedItems(); let checkedAttachments = 0; let missingFiles = 0; let corruptFiles = 0;
    for (const item of scanned.records) {
      const folder = this.store.itemFolder(item.storageId);
      for (const attachment of item.attachments) {
        checkedAttachments += 1;
        const declared = assertInside(folder, path.join(folder, attachment.relativePath));
        const file = resolveLibraryFile(folder, attachment.relativePath);
        if (!file) {
          missingFiles += 1; issues.push({ code: 'missing-attachment', itemId: item.id, path: declared, message: `Missing attachment: ${attachment.fileName}`, recoverable: true }); continue;
        }
        if (sha256File(file) !== attachment.sha256) {
          corruptFiles += 1; issues.push({ code: 'corrupt-attachment', itemId: item.id, path: file, message: `Attachment checksum mismatch: ${attachment.fileName}`, recoverable: true });
        }
      }
      if (item.files?.reader) {
        const reader = assertInside(folder, path.join(folder, item.files.reader));
        if (!fs.existsSync(reader)) { missingFiles += 1; issues.push({ code: 'missing-reader', itemId: item.id, path: reader, message: 'Clean Markdown is missing.', recoverable: true }); }
      }
    }
    let orphanFolders = 0;
    if (fs.existsSync(this.store.root)) for (const entry of fs.readdirSync(this.store.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = path.join(this.store.root, entry.name);
      if (!fs.existsSync(path.join(folder, 'metadata.json'))) { orphanFolders += 1; issues.push({ code: 'orphan-folder', itemId: null, path: folder, message: 'Folder has no readable item manifest.', recoverable: true }); }
    }
    const conflictsRoot = path.join(this.store.root, '.nodus', 'conflicts');
    const conflicts = countFiles(conflictsRoot, '.json');
    if (conflicts) issues.push({ code: 'conflict', itemId: null, path: conflictsRoot, message: `${conflicts} offline conflict record(s) require review.`, recoverable: true });
    const status = this.catalog.status(this.store.root, this.store.deviceId);
    const invalidRecords = Math.max(scanned.invalid, status.invalidRecords);
    if (invalidRecords) issues.push({ code: 'invalid-record', itemId: null, path: path.join(this.store.root, '.nodus', 'records'), message: `${invalidRecords} invalid record(s) were excluded.`, recoverable: true });
    const searchesFile = path.join(this.store.root, '.nodus', 'saved-searches.json');
    if (fs.existsSync(searchesFile) && !Array.isArray(readJsonValue(searchesFile))) issues.push({ code: 'invalid-saved-search', itemId: null, path: searchesFile, message: 'Saved-search definitions are not a valid record array.', recoverable: true });
    const linksFile = path.join(this.store.root, '.nodus', 'vault-links.json');
    const linksValue = readJsonValue(linksFile) as { links?: unknown } | undefined;
    if (fs.existsSync(linksFile) && (!linksValue || !Array.isArray(linksValue.links))) issues.push({ code: 'invalid-vault-link', itemId: null, path: linksFile, message: 'Vault-link manifest is not a valid link array.', recoverable: true });
    return {
      auditedAt: new Date().toISOString(), checkedItems: scanned.records.length, checkedAttachments,
      conflicts, invalidRecords, missingFiles, corruptFiles, orphanFolders, issues,
    };
  }

  /** Migrate legacy `%2Epdf` manifest paths to a literal `.pdf` suffix. The old
   * immutable copy is retained; only a verified canonical copy and a new record
   * revision are added, which is safe inside synchronized backup folders. */
  repairCloudRenamedAttachmentPaths(): number {
    let repairedItems = 0;
    for (const current of this.store.scanMaterializedItems().records) {
      const folder = this.store.itemFolder(current.storageId);
      const replacements = new Map<string, string>();
      const attachments = current.attachments.map((attachment) => {
        const relativePath = libraryFilePathWithLiteralExtension(attachment.relativePath);
        if (relativePath === attachment.relativePath) return attachment;
        const source = resolveLibraryFile(folder, attachment.relativePath);
        if (!source) return attachment;
        const expectedHash = /^[a-f0-9]{64}$/i.test(attachment.sha256) ? attachment.sha256.toLowerCase() : null;
        if (expectedHash && sha256File(source) !== expectedHash) return attachment;
        const destination = assertInside(folder, path.join(folder, relativePath));
        if (source !== destination) copyImmutable(source, destination);
        if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) return attachment;
        if (expectedHash && sha256File(destination) !== expectedHash) return attachment;
        replacements.set(attachment.relativePath, relativePath);
        return { ...attachment, relativePath };
      });
      if (!replacements.size) continue;
      const files = current.files?.original && replacements.has(current.files.original)
        ? { ...current.files, original: replacements.get(current.files.original)! }
        : current.files;
      const repaired = this.store.upsertItem({ ...current, attachments, files }, current.clock.revision);
      this.catalog.indexItem(repaired, this.store);
      repairedItems += 1;
    }
    return repairedItems;
  }

  importLocalFiles(files: string[], collectionId?: string | null): LibraryLocalImportReport {
    const report: LibraryLocalImportReport = { created: 0, skipped: 0, itemIds: [], warnings: [] };
    const knownHashes = new Set(this.catalog.attachmentHashes());
    const indexed: LibraryItemRecord[] = [];
    const librarySettings = this.getSettings();
    for (const raw of files) {
      const source = path.resolve(raw);
      const extension = path.extname(source).toLowerCase();
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) {
        report.skipped += 1; report.warnings.push(`Formato no compatible: ${path.basename(source)}`); continue;
      }
      const hash = sha256File(source);
      if (knownHashes.has(hash)) {
        report.skipped += 1; report.warnings.push(`Ya estaba importado: ${path.basename(source)}`);
        const existing = this.catalog.itemIdsForAttachmentHash(hash)[0];
        if (existing) report.existingItemIds = [...new Set([...(report.existingItemIds ?? []), existing])];
        continue;
      }
      const uuid = randomUUID();
      const id = `nodus:${uuid}`;
      const storageId = id;
      const folder = this.store.itemFolder(storageId);
      const originalFileName = path.basename(source);
      const metadata = inferredLocalFileMetadata(source, extension);
      const autoRenamed = shouldAutoRenameAttachment(librarySettings, originalFileName, 0);
      const fileName = autoRenamed
        ? buildAutomaticAttachmentFileName(metadata, originalFileName, librarySettings.attachmentRenameTemplate)
        : originalFileName;
      const relativePath = path.join('attachments', safeLibraryFileName(fileName));
      const destination = assertInside(folder, path.join(folder, relativePath));
      copyImmutable(source, destination);
      const stat = fs.statSync(destination);
      indexed.push(this.store.upsertItem({
        id, storageId, source: 'nodus',
        metadata,
        collectionIds: collectionId ? [collectionId] : [],
        attachments: [{
          id: `local:${uuid}`, title: originalFileName, fileName, relativePath,
          mimeType: mimeType(extension), byteSize: stat.size, sha256: hash, role: 'original', position: 0, addedAt: new Date().toISOString(),
          autoRenamed,
        }],
        files: { original: relativePath, annotations: 'annotations.json' }, extraction: { status: 'pending' }, deletedAt: null,
      }));
      knownHashes.add(hash);
      report.created += 1;
      report.itemIds.push(id);
    }
    if (indexed.length) this.catalog.indexItems(indexed, this.store);
    return report;
  }

  importBibliographyFiles(files: string[], collectionId?: string | null): LibraryBibliographyImportReport {
    return importBibliographyFiles({ files, collectionId, store: this.store, catalog: this.catalog });
  }

  createItem(metadata: LibraryItemMetadata, collectionIds: string[] = []): LibraryItemRecord {
    for (const collectionId of collectionIds) {
      const collection = this.store.readMaterializedCollection(this.catalog.resolveCollectionId(collectionId) ?? collectionId);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
    }
    const id = `nodus:${randomUUID()}`;
    const citationKey = generateCitationKey(metadata, this.catalog.citationKeys());
    const result = this.store.upsertItem({
      id, storageId: id, source: 'nodus', citationKey, metadata: normalizeLibraryMetadata(metadata),
      collectionIds: [...new Set(collectionIds.map((entry) => this.catalog.resolveCollectionId(entry) ?? entry))],
      attachments: [], notes: [], relations: [], files: { annotations: 'annotations.json' },
      extraction: { status: 'pending' }, deletedAt: null,
    });
    this.catalog.indexItem(result, this.store);
    return result;
  }

  /**
   * Import a bounded Compass chunk. The operation is deliberately self
   * contained so it can run in a worker with its own catalog/store handles.
   * Existing user metadata is never overwritten; only missing fields and
   * provider provenance/identities are filled in.
   */
  importCompassCandidates(
    candidates: LibraryCompassCandidate[],
    collectionIds: string[] = [],
    requestId = 'compass-import',
  ): LibraryCompassImportReport {
    if (!Array.isArray(candidates) || candidates.length > 25) throw new Error('La importación de Compass acepta como máximo 25 fichas por lote.');
    const resolvedCollections = [...new Set(collectionIds.map((id) => this.catalog.resolveCollectionId(id) ?? id))];
    for (const collectionId of resolvedCollections) {
      const collection = this.store.readMaterializedCollection(collectionId);
      if (!collection || collection.deletedAt) throw new Error('Una de las colecciones de destino ya no existe.');
    }
    const items: LibraryCompassImportItemResult[] = [];
    for (const candidate of candidates) {
      const canonicalKey = String(candidate?.canonicalKey ?? '').trim().slice(0, 2_000);
      try {
        if (!canonicalKey || !candidate?.metadata) throw new Error('La ficha de Compass no tiene una clave canónica válida.');
        const metadata = normalizeLibraryMetadata(candidate.metadata);
        const provider = String(candidate.provider ?? 'compass').trim().slice(0, 200) || 'compass';
        const providerId = String(candidate.providerId ?? canonicalKey).trim().slice(0, 2_000) || canonicalKey;
        const ownIdentity = { source: 'compass' as const, libraryType: 'import' as const, libraryId: provider, itemKey: providerId };
        const suppliedIdentities = (candidate.sourceIdentities ?? []).map((identity) => normalizeLibrarySourceIdentity(identity))
          .filter((identity): identity is LibrarySourceIdentity => !!identity && identity.source === 'compass');
        const identities = [...new Map([ownIdentity, ...suppliedIdentities].map((identity) => [librarySourceIdentityKey(identity), identity])).values()];
        const provenance = [...new Map((candidate.provenance ?? []).filter((entry) => entry && typeof entry.provider === 'string').map((entry) => {
          const value = { ...entry, provider: String(entry.provider).slice(0, 200),
            providerId: typeof entry.providerId === 'string' ? entry.providerId.slice(0, 2_000) : undefined,
            sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl.slice(0, 10_000) : undefined };
          return [`${value.provider}:${value.providerId ?? ''}:${value.sourceUrl ?? ''}`, value];
        })).values()];
        const identityMatch = identities.map((identity) => this.catalog.findItemIdBySourceIdentity(identity)).find(Boolean) ?? null;
        const existingId = identityMatch ?? this.catalog.findItemIdByMetadataIdentifiers(metadata) ?? this.catalog.findItemIdByNormalizedBibliography(metadata);
        if (existingId) {
          const existing = this.item(existingId);
          const overrides = new Set(Object.keys(existing.metadataOverrides ?? {}));
          const merged = { ...existing.metadata } as LibraryItemMetadata;
          let metadataChanged = false;
          for (const [key, incoming] of Object.entries(metadata) as Array<[keyof LibraryItemMetadata, LibraryItemMetadata[keyof LibraryItemMetadata]]>) {
            if (overrides.has(key) || incoming == null || incoming === '' || (Array.isArray(incoming) && incoming.length === 0)) continue;
            const current = merged[key];
            if (current == null || current === '' || (Array.isArray(current) && current.length === 0)) { (merged as any)[key] = incoming; metadataChanged = true; }
          }
          const mergedIdentities = [...new Map([...existing.sourceIdentities, ...identities].map((identity) => [librarySourceIdentityKey(identity), identity])).values()];
          const mergedProvenance = [...new Map([...(existing.provenance ?? []), ...provenance].map((entry) => [`${entry.provider}:${entry.providerId ?? ''}:${entry.sourceUrl ?? ''}`, entry])).values()];
          const collectionSet = [...new Set([...existing.collectionIds, ...resolvedCollections])];
          const changed = metadataChanged || canonicalJson(existing.sourceIdentities) !== canonicalJson(mergedIdentities)
            || canonicalJson(existing.provenance ?? []) !== canonicalJson(mergedProvenance)
            || canonicalJson(existing.collectionIds) !== canonicalJson(collectionSet);
          if (changed) {
            const updated = this.store.upsertItem({ ...existing, metadata: normalizeLibraryMetadata(merged), sourceIdentities: mergedIdentities, provenance: mergedProvenance, collectionIds: collectionSet }, existing.clock.revision);
            this.catalog.indexItem(updated, this.store);
            items.push({ canonicalKey, state: metadataChanged ? 'metadata-completed' : 'linked-existing', itemId: updated.id });
          } else items.push({ canonicalKey, state: 'skipped-duplicate', itemId: existing.id });
          continue;
        }
        const id = `compass:${randomUUID()}`;
        const citationKey = generateCitationKey(metadata, this.catalog.citationKeys());
        const created = this.store.upsertItem({
          id, storageId: id, source: 'compass', sourceLibraryId: provider, sourceKey: canonicalKey,
          sourceIdentities: identities, provenance, citationKey, metadata,
          collectionIds: resolvedCollections, attachments: [], notes: [], relations: [], files: { annotations: 'annotations.json' },
          extraction: { status: 'pending' }, deletedAt: null,
        });
        this.catalog.indexItem(created, this.store);
        items.push({ canonicalKey, state: 'created', itemId: created.id });
      } catch (error) {
        items.push({ canonicalKey: canonicalKey || String(candidate?.canonicalKey ?? ''), state: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      requestId,
      status: 'completed',
      items,
      created: items.filter((item) => item.state === 'created').length,
      linked: items.filter((item) => ['linked-existing', 'metadata-completed', 'skipped-duplicate'].includes(item.state)).length,
      failed: items.filter((item) => item.state === 'failed').length,
      canceled: false,
    };
  }

  private item(itemId: string): LibraryItemRecord {
    const id = this.catalog.resolveItemId(itemId) ?? itemId;
    const storageId = this.catalog.itemStorageId(id);
    const item = storageId ? this.store.readMaterializedItem(storageId) : null;
    if (!item) throw new Error('El documento ya no existe.');
    return item;
  }

  duplicateItem(itemId: string): LibraryItemRecord {
    const current = this.item(itemId);
    const id = `nodus:${randomUUID()}`;
    const destinationFolder = this.store.itemFolder(id);
    const sourceFolder = this.store.itemFolder(current.storageId);
    const pathReplacements = new Map<string, string>();
    const attachments = current.attachments.map((attachment) => {
      const source = resolveLibraryFile(sourceFolder, attachment.relativePath);
      const relativePath = source ? libraryFilePathWithLiteralExtension(attachment.relativePath) : attachment.relativePath;
      if (source) copyImmutable(source, assertInside(destinationFolder, path.join(destinationFolder, relativePath)));
      pathReplacements.set(attachment.relativePath, relativePath);
      return { ...attachment, id: `local:${randomUUID()}`, relativePath, sourceKey: undefined };
    });
    for (const relative of Object.values(current.files ?? {})) {
      if (!relative || relative === current.files?.original) continue;
      const source = assertInside(sourceFolder, path.join(sourceFolder, relative));
      if (fs.existsSync(source) && fs.statSync(source).isFile()) copyImmutable(source, assertInside(destinationFolder, path.join(destinationFolder, relative)));
    }
    copyDirectoryIfMissing(path.join(sourceFolder, 'assets'), path.join(destinationFolder, 'assets'));
    const now = new Date().toISOString();
    const citationKey = generateCitationKey(current.metadata, this.catalog.citationKeys(), current.citationKey);
    const result = this.store.upsertItem({
      id, storageId: id, source: 'nodus', citationKey,
      metadata: current.metadata, collectionIds: current.collectionIds,
      attachments: orderedAttachments(attachments),
      notes: (current.notes ?? []).filter((note) => note.source === 'nodus').map((note) => ({ ...note, id: `note:${randomUUID()}`, createdAt: now, updatedAt: now })),
      relations: [], files: current.files?.original && pathReplacements.has(current.files.original)
        ? { ...current.files, original: pathReplacements.get(current.files.original)! }
        : current.files,
      extraction: current.extraction, contentRevision: current.contentRevision,
      deletedAt: null,
    });
    this.catalog.indexItem(result, this.store);
    return result;
  }

  convertItemToNodus(itemId: string): LibraryItemRecord {
    const current = this.item(itemId);
    return current.source === 'nodus' ? current : this.duplicateItem(current.id);
  }

  addAttachments(itemId: string, files: string[]): LibraryItemRecord {
    const current = this.item(itemId);
    const folder = this.store.itemFolder(current.storageId);
    const hashes = new Set(current.attachments.map((entry) => entry.sha256));
    const additions: LibraryAttachmentRecord[] = [];
    const now = new Date().toISOString();
    const librarySettings = this.getSettings();
    for (const raw of files) {
      const source = path.resolve(raw); const extension = path.extname(source).toLowerCase();
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) throw new Error(`Formato no compatible: ${path.basename(source)}`);
      const sha256 = sha256File(source); if (hashes.has(sha256)) continue;
      const id = `local:${randomUUID()}`; const originalFileName = path.basename(source);
      const autoRenamed = shouldAutoRenameAttachment(librarySettings, originalFileName, current.attachments.length + additions.length);
      const fileName = autoRenamed
        ? buildAutomaticAttachmentFileName(current.metadata, originalFileName, librarySettings.attachmentRenameTemplate)
        : originalFileName;
      const relativePath = path.join('attachments', `${id.slice(6, 14)}-${safeLibraryFileName(fileName)}`);
      const destination = assertInside(folder, path.join(folder, relativePath)); copyImmutable(source, destination);
      const detectedMime = mimeType(extension);
      additions.push({ id, title: originalFileName, fileName, relativePath, mimeType: detectedMime,
        byteSize: fs.statSync(destination).size, sha256,
        role: current.attachments.length + additions.length === 0 ? 'original' : detectedMime.startsWith('image/') ? 'image' : 'supplement',
        position: current.attachments.length + additions.length, addedAt: now, autoRenamed });
      hashes.add(sha256);
    }
    if (!additions.length) return current;
    const attachments = orderedAttachments([...current.attachments, ...additions]);
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), original: primary.relativePath } }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  updateAttachment(itemId: string, attachmentId: string, patch: LibraryAttachmentPatch): LibraryItemRecord {
    const current = this.item(itemId); const target = current.attachments.find((entry) => entry.id === attachmentId);
    if (!target) throw new Error('El adjunto ya no existe.');
    const folder = this.store.itemFolder(current.storageId); let relativePath = target.relativePath;
    const fileName = patch.fileName?.trim() ? path.basename(patch.fileName.trim()) : target.fileName;
    if (fileName !== target.fileName) {
      const source = resolveLibraryFile(folder, target.relativePath);
      relativePath = path.join('attachments', `${target.id.replace(/[^a-z0-9]/gi, '').slice(-8)}-${safeLibraryFileName(fileName)}`);
      if (source) copyImmutable(source, assertInside(folder, path.join(folder, relativePath)));
    }
    const desired = { ...target, title: patch.title?.trim() || target.title, fileName, relativePath,
      autoRenamed: patch.fileName !== undefined ? false : target.autoRenamed,
      role: patch.makePrimary ? 'original' as const : patch.role ?? target.role };
    const remaining = orderedAttachments(current.attachments.filter((entry) => entry.id !== attachmentId)
      .map((entry) => patch.makePrimary && entry.role === 'original' ? { ...entry, role: 'supplement' as const } : entry));
    remaining.splice(Math.max(0, Math.min(remaining.length, patch.position ?? target.position ?? remaining.length)), 0, desired);
    const attachments = remaining.map((entry, position) => ({ ...entry, position }));
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), ...(primary ? { original: primary.relativePath } : {}) } }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  replaceAttachment(itemId: string, attachmentId: string, file: string): LibraryItemRecord {
    const current = this.item(itemId); const target = current.attachments.find((entry) => entry.id === attachmentId);
    if (!target) throw new Error('El adjunto ya no existe.');
    const source = path.resolve(file); const extension = path.extname(source).toLowerCase();
    if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !SUPPORTED_ATTACHMENTS.has(extension)) throw new Error(`Formato no compatible: ${path.basename(source)}`);
    const sha256 = sha256File(source); const originalFileName = path.basename(source);
    const librarySettings = this.getSettings();
    const autoRenamed = Boolean(target.autoRenamed && librarySettings.autoRenameAttachments
      && librarySettings.autoRenameAttachmentTypes.includes(attachmentRenameType(originalFileName)));
    const fileName = autoRenamed
      ? buildAutomaticAttachmentFileName(current.metadata, originalFileName, librarySettings.attachmentRenameTemplate)
      : originalFileName;
    const relativePath = path.join('attachments', `${attachmentId.replace(/[^a-z0-9]/gi, '').slice(-8)}-${sha256.slice(0, 10)}-${safeLibraryFileName(fileName)}`);
    const folder = this.store.itemFolder(current.storageId); const destination = assertInside(folder, path.join(folder, relativePath));
    copyImmutable(source, destination);
    const attachments = orderedAttachments(current.attachments.map((entry) => entry.id === attachmentId ? {
      ...entry, title: originalFileName, fileName, relativePath, mimeType: mimeType(extension), byteSize: fs.statSync(destination).size, sha256, addedAt: new Date().toISOString(), autoRenamed,
    } : entry));
    const primary = attachments.find((entry) => entry.role === 'original') ?? attachments[0];
    const result = this.store.upsertItem({ ...current, attachments, files: { ...(current.files ?? {}), ...(primary ? { original: primary.relativePath } : {}) } }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  removeAttachment(itemId: string, attachmentId: string): LibraryItemRecord {
    const current = this.item(itemId); const removed = current.attachments.find((entry) => entry.id === attachmentId);
    if (!removed) return current;
    let attachments = orderedAttachments(current.attachments.filter((entry) => entry.id !== attachmentId));
    if (removed.role === 'original' && attachments.length && !attachments.some((entry) => entry.role === 'original')) attachments = attachments.map((entry, index) => index ? entry : { ...entry, role: 'original' });
    const primary = attachments.find((entry) => entry.role === 'original');
    const { original: _original, ...otherFiles } = current.files ?? {};
    const result = this.store.upsertItem({ ...current, attachments, files: primary ? { ...otherFiles, original: primary.relativePath } : otherFiles }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  attachmentPath(itemId: string, attachmentId: string): string {
    const current = this.item(itemId); const attachment = current.attachments.find((entry) => entry.id === attachmentId);
    if (!attachment) throw new Error('El adjunto ya no existe.');
    const file = resolveLibraryFile(this.store.itemFolder(current.storageId), attachment.relativePath);
    if (!file) throw new Error('El archivo adjunto no está disponible.');
    return file;
  }

  upsertNote(itemId: string, input: Partial<LibraryNoteRecord> & Pick<LibraryNoteRecord, 'title' | 'markdown'>): LibraryItemRecord {
    const current = this.item(itemId); const existing = input.id ? (current.notes ?? []).find((entry) => entry.id === input.id) : null;
    if (input.source === 'zotero' || input.readOnly || existing?.readOnly) throw new Error('Las notas de Zotero son de solo lectura.');
    const now = new Date().toISOString(); const id = existing?.id ?? `note:${randomUUID()}`;
    const note: LibraryNoteRecord = { id, title: input.title.trim() || 'Nota sin título', markdown: input.markdown.replace(/\r\n?/g, '\n'),
      source: 'nodus', readOnly: false, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const notes = [...(current.notes ?? []).filter((entry) => entry.id !== id), note];
    const result = this.store.upsertItem({ ...current, notes }, current.clock.revision); this.catalog.indexItem(result, this.store); return result;
  }

  deleteNote(itemId: string, noteId: string): LibraryItemRecord {
    const current = this.item(itemId); const note = (current.notes ?? []).find((entry) => entry.id === noteId);
    if (note?.readOnly) throw new Error('Las notas de Zotero son de solo lectura.');
    const result = this.store.upsertItem({ ...current, notes: (current.notes ?? []).filter((entry) => entry.id !== noteId) }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  setRelation(itemId: string, targetItemId: string, relationType: LibraryItemRelationType, enabled: boolean): LibraryItemRecord {
    const left = this.item(itemId); const right = this.item(targetItemId);
    if (left.id === right.id) throw new Error('Un documento no puede relacionarse consigo mismo.');
    const now = new Date().toISOString();
    const update = (record: LibraryItemRecord, target: LibraryItemRecord, type: LibraryItemRelationType) => {
      const relations = (record.relations ?? []).filter((entry) => !(entry.targetItemId === target.id && entry.relationType === type));
      if (enabled) relations.push({ id: `relation:${randomUUID()}`, targetItemId: target.id, relationType: type, createdAt: now });
      return this.store.upsertItem({ ...record, relations }, record.clock.revision, now);
    };
    const result = update(left, right, relationType); const inverse = update(right, left, inverseRelation(relationType));
    this.catalog.indexItems([result, inverse], this.store); return result;
  }

  patchItemTags(itemIds: string[], patch: LibraryTagPatch): number {
    const ids = new Set(itemIds.map((entry) => this.catalog.resolveItemId(entry) ?? entry));
    const add = [...new Set((patch.add ?? []).map((tag) => tag.trim()).filter(Boolean))]; const remove = new Set((patch.remove ?? []).map((tag) => tag.trim()));
    let count = 0; const indexed: LibraryItemRecord[] = [];
    for (const item of this.store.scanMaterializedItems().records) {
      if (!ids.has(item.id) || item.deletedAt) continue;
      const tags = [...new Set([...(item.metadata.tags ?? []), ...add])].filter((tag) => !remove.has(tag));
      if (canonicalJson(tags) === canonicalJson(item.metadata.tags ?? [])) continue;
      const sourceManaged = item.source === 'zotero';
      const localTags = sourceManaged
        ? [...new Set([...(item.localTags ?? []), ...add])].filter((tag) => !remove.has(tag))
        : item.localTags;
      const suppressedSourceTags = sourceManaged
        ? [...new Set([...(item.suppressedSourceTags ?? []).filter((tag) => !add.includes(tag)), ...remove])]
        : item.suppressedSourceTags;
      indexed.push(this.store.upsertItem({
        ...item,
        metadata: { ...item.metadata, tags },
        ...(sourceManaged ? { localTags, suppressedSourceTags } : {}),
      }, item.clock.revision)); count += 1;
    }
    if (indexed.length) this.catalog.indexItems(indexed, this.store); return count;
  }

  private tagColors(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(path.join(this.store.root, '.nodus', 'tags.json'), 'utf8')) as Record<string, string>; } catch { return {}; }
  }

  listTagRecords(): LibraryTagRecord[] {
    const counts = new Map(this.catalog.tagCounts().map((entry) => [entry.name, entry.count])); const colors = this.tagColors();
    return [...new Set([...counts.keys(), ...Object.keys(colors)])].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, color: colors[name] ?? null, itemCount: counts.get(name) ?? 0 }));
  }

  setTagColor(tag: string, color: string | null): LibraryTagRecord[] {
    const name = tag.trim(); if (!name) throw new Error('La etiqueta necesita un nombre.');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('El color debe usar el formato hexadecimal #RRGGBB.');
    const colors = this.tagColors(); if (color) colors[name] = color.toLowerCase(); else delete colors[name];
    atomicWriteJson(path.join(this.store.root, '.nodus', 'tags.json'), colors); return this.listTagRecords();
  }

  updateItemMetadata(itemId: string, patch: Partial<LibraryItemMetadata>): LibraryItemRecord {
    const current = this.item(itemId);
    const merged = normalizeLibraryMetadata({ ...current.metadata, ...patch }, current.metadata.title);
    const overridePatch = Object.fromEntries(Object.keys(patch).map((key) => {
      const value = (patch as Record<string, unknown>)[key];
      return [key, value === undefined ? null : value];
    })) as LibraryMetadataOverrides;
    const imported = current.source !== 'nodus';
    const settings = this.getSettings();
    let attachments = current.attachments;
    let files = current.files;
    if (settings.autoRenameAttachments && settings.keepAttachmentNamesInSync) {
      const folder = this.store.itemFolder(current.storageId);
      attachments = current.attachments.map((attachment) => {
        if (!attachment.autoRenamed || !settings.autoRenameAttachmentTypes.includes(attachmentRenameType(attachment.fileName))) return attachment;
        const fileName = buildAutomaticAttachmentFileName(merged, attachment.fileName, settings.attachmentRenameTemplate);
        if (fileName === attachment.fileName) return attachment;
        const source = resolveLibraryFile(folder, attachment.relativePath);
        if (!source) return attachment;
        const relativePath = path.join('attachments', `${attachment.id.replace(/[^a-z0-9]/gi, '').slice(-8)}-${safeLibraryFileName(fileName)}`);
        copyImmutable(source, assertInside(folder, path.join(folder, relativePath)));
        return { ...attachment, fileName, relativePath };
      });
      const primary = attachments.find((attachment) => attachment.role === 'original') ?? attachments[0];
      if (primary) files = { ...(files ?? {}), original: primary.relativePath };
    }
    const desired = this.store.upsertItem({
      ...current, metadata: merged, attachments, files,
      ...(imported ? { metadataOverrides: { ...(current.metadataOverrides ?? {}), ...overridePatch } } : {}),
    }, current.clock.revision);
    this.catalog.indexItem(desired, this.store);
    return desired;
  }

  /**
   * Fill only genuinely absent metadata on an existing record. This is used
   * by browser capture and deliberately differs from a user metadata edit:
   * existing values and explicit overrides always win. Arrays of identifiers
   * and tags are additive, while `extra` is merged by missing key only.
   */
  mergeItemMetadataIfMissing(itemId: string, incoming: LibraryItemMetadata): LibraryItemRecord {
    const current = this.item(itemId);
    const source = normalizeLibraryMetadata(incoming, current.metadata.title);
    const overrides = new Set(Object.keys(current.metadataOverrides ?? {}));
    const merged = { ...current.metadata } as LibraryItemMetadata;
    let changed = false;
    const isBlank = (value: unknown): boolean => value == null || value === '' || (Array.isArray(value) && value.length === 0);
    const scalarKeys: Array<keyof LibraryItemMetadata> = [
      'abstract', 'date', 'language', 'publisher', 'publicationTitle', 'volume', 'issue', 'pages',
      'edition', 'place', 'rights', 'url', 'doi', 'pmid', 'pmcid', 'arxiv',
    ];
    if ((!current.metadata.title || current.metadata.title === 'Documento sin título') && source.title && !overrides.has('title')) {
      merged.title = source.title; changed = true;
    }
    if ((current.metadata.itemType === 'document' && source.itemType !== 'document') && !overrides.has('itemType')) {
      merged.itemType = source.itemType; changed = true;
    }
    if (!current.metadata.creators.length && source.creators.length && !overrides.has('creators')) {
      merged.creators = source.creators; changed = true;
    }
    if (current.metadata.year == null && source.year != null && !overrides.has('year')) {
      merged.year = source.year; changed = true;
    }
    for (const key of scalarKeys) {
      if (overrides.has(key) || !isBlank(merged[key]) || isBlank(source[key])) continue;
      (merged as any)[key] = source[key]; changed = true;
    }
    for (const key of ['isbn', 'issn', 'tags'] as const) {
      if (overrides.has(key)) continue;
      const values = [...new Set([...(merged[key] ?? []), ...(source[key] ?? [])])];
      if (values.length !== (merged[key] ?? []).length) { (merged as any)[key] = values; changed = true; }
    }
    if (!overrides.has('extra')) {
      const extra = { ...(merged.extra ?? {}) };
      for (const [key, value] of Object.entries(source.extra ?? {})) if (extra[key] == null || extra[key] === '') { extra[key] = value; changed = true; }
      if (Object.keys(extra).length) merged.extra = extra;
    }
    if (!changed) return current;
    const result = this.store.upsertItem({ ...current, metadata: normalizeLibraryMetadata(merged) }, current.clock.revision);
    this.catalog.indexItem(result, this.store);
    return result;
  }

  updateCitationKey(itemId: string, preferred: string): LibraryItemRecord {
    const current = this.item(itemId);
    const used = this.catalog.citationKeys(current.id);
    const citationKey = generateCitationKey(current.metadata, used, preferred);
    if (asciiCitationKey(preferred) !== citationKey) throw new Error('La clave de cita ya existe o no contiene caracteres válidos.');
    const result = this.store.upsertItem({ ...current, citationKey }, current.clock.revision);
    this.catalog.indexItem(result, this.store); return result;
  }

  bibliographyRecords(request: Omit<LibraryBibliographyExportRequest, 'format'>): LibraryItemRecord[] {
    if (request.itemIds?.length) {
      return [...new Set(request.itemIds)].flatMap((id) => {
        try { return [this.item(id)]; } catch { return []; }
      });
    }
    const smartSearch = request.smartSearch ?? (request.savedSearchId ? this.listSavedSearches().find((entry) => entry.id === request.savedSearchId)?.query ?? null : null);
    const ids = new Set<string>(); let offset = 0;
    for (;;) {
      const page = this.catalog.list({
        collectionId: request.collectionId, savedSearchId: request.savedSearchId,
        smartSearch, limit: 500, offset, includeFacets: false,
      });
      for (const item of page.items) ids.add(item.id);
      offset += page.items.length; if (!page.items.length || offset >= page.total) break;
    }
    return [...ids].flatMap((id) => {
      try { return [this.item(id)]; } catch { return []; }
    });
  }

  exportBibliography(request: LibraryBibliographyExportRequest): { content: string; exported: number } {
    const records = this.bibliographyRecords(request);
    return { content: exportLibraryBibliography(records, request.format), exported: records.length };
  }

  formatCitation(itemIds: string[], style: LibraryCitationStyle, kind: 'citation' | 'bibliography'): LibraryCitationResult {
    const records = this.bibliographyRecords({ itemIds });
    return formatLibraryCitation(records, style, kind);
  }

  listDuplicateGroups(): LibraryDuplicateGroup[] {
    const records = this.store.scanMaterializedItems().records.filter((item) => !item.deletedAt);
    const emitted = new Set<string>(); const groups: LibraryDuplicateGroup[] = [];
    const collect = (reason: LibraryDuplicateGroup['reason'], keyFor: (item: LibraryItemRecord) => string) => {
      const map = new Map<string, LibraryItemRecord[]>();
      for (const item of records) {
        const key = keyFor(item); if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), item]);
      }
      for (const [key, members] of map) {
        const fresh = members.filter((item) => !emitted.has(item.id));
        if (fresh.length < 2) continue;
        for (const item of fresh) emitted.add(item.id);
        groups.push({ key: `${reason}:${key}`, reason, items: fresh.map((item) => recordCatalogItem(item, this.store)) });
      }
    };
    collect('doi', (item) => compactIdentifier(item.metadata.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')));
    collect('isbn', (item) => compactIdentifier(item.metadata.isbn?.[0]));
    collect('metadata', (item) => {
      const title = normalizedIdentity(item.metadata.title); const creator = normalizedIdentity(creatorLabel(item));
      return title && creator && item.metadata.year != null ? `${title}|${item.metadata.year}|${creator}` : '';
    });
    return groups.sort((a, b) => a.items[0].title.localeCompare(b.items[0].title));
  }

  mergeImpact(canonicalId: string, duplicateIds: string[]): LibraryMergeImpact {
    const all = this.store.scanMaterializedItems().records;
    const resolvedCanonicalId = this.catalog.resolveItemId(canonicalId) ?? canonicalId;
    const resolvedDuplicates = new Set(duplicateIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const canonical = all.find((item) => item.id === resolvedCanonicalId && !item.deletedAt);
    if (!canonical) throw new Error('El documento canónico ya no existe.');
    const records = all.filter((item) => (item.id === resolvedCanonicalId || resolvedDuplicates.has(item.id)) && !item.deletedAt);
    const counts = records.map((item) => {
      const folder = this.store.itemFolder(item.storageId);
      return {
        attachments: item.attachments.length,
        annotations: readJsonArray(path.join(folder, item.files?.annotations ?? 'annotations.json')).length,
        orphaned: readJsonArray(path.join(folder, item.files?.orphanedAnnotations ?? 'orphaned-annotations.json')).length,
        chats: readJsonArray(path.join(folder, item.files?.chat ?? 'chat.json')).length,
        notes: item.notes?.length ?? 0, aliases: item.aliases.length,
        relations: item.relations?.length ?? 0,
      };
    });
    const links = records.flatMap((item) => this.catalog.listVaultLinks(item.id));
    return {
      canonicalId: canonical.id, duplicateIds: records.filter((item) => item.id !== canonical.id).map((item) => item.id),
      attachmentCount: counts.reduce((sum, entry) => sum + entry.attachments, 0),
      annotationCount: counts.reduce((sum, entry) => sum + entry.annotations, 0),
      orphanedAnnotationCount: counts.reduce((sum, entry) => sum + entry.orphaned, 0),
      chatMessageCount: counts.reduce((sum, entry) => sum + entry.chats, 0),
      noteCount: counts.reduce((sum, entry) => sum + entry.notes, 0),
      aliasCount: counts.reduce((sum, entry) => sum + entry.aliases, 0) + Math.max(0, records.length - 1),
      relationCount: counts.reduce((sum, entry) => sum + entry.relations, 0),
      linkedVaultCount: new Set(links.map((link) => link.vaultId)).size,
      vaultWorksPreserved: new Set(links.map((link) => `${link.vaultId}:${link.workId}`)).size,
      warnings: links.length ? ['Vault works and their analyses remain separate until an explicit vault reconciliation.'] : [],
    };
  }

  mergeItems(canonicalId: string, duplicateIds: string[]): LibraryItemRecord {
    const all = this.store.scanMaterializedItems().records;
    const resolvedCanonicalId = this.catalog.resolveItemId(canonicalId) ?? canonicalId;
    const resolvedDuplicateIds = new Set(duplicateIds.map((id) => this.catalog.resolveItemId(id) ?? id));
    const canonical = all.find((item) => item.id === resolvedCanonicalId && !item.deletedAt);
    if (!canonical) throw new Error('El documento canónico ya no existe.');
    const duplicates = all.filter((item) => resolvedDuplicateIds.has(item.id) && item.id !== resolvedCanonicalId && !item.deletedAt);
    if (!duplicates.length) return canonical;
    let desired: LibraryItemRecord = canonical;
    const folder = this.store.itemFolder(canonical.storageId);
    const attachments = [...canonical.attachments]; const hashes = new Set(attachments.map((entry) => entry.sha256));
    const files = { ...(canonical.files ?? {}) }; let extraction = canonical.extraction;
    const notes = [...(canonical.notes ?? [])];
    const relations = [...(canonical.relations ?? [])];
    let adoptedRevision: LibraryItemRecord['contentRevision'] | undefined;
    for (const duplicate of duplicates) {
      const duplicateFolder = this.store.itemFolder(duplicate.storageId);
      for (const attachment of duplicate.attachments) {
        if (hashes.has(attachment.sha256)) continue;
        const source = resolveLibraryFile(duplicateFolder, attachment.relativePath);
        if (!source) continue;
        const relativePath = path.join('attachments', 'merged', `${safeLibraryFolderName(duplicate.storageId)}-${safeLibraryFileName(attachment.fileName)}`);
        copyImmutable(source, assertInside(folder, path.join(folder, relativePath)));
        const role = !files.original && attachment.role === 'original' ? 'original' : attachment.role === 'original' ? 'supplement' : attachment.role;
        attachments.push({ ...attachment, id: `merged:${randomUUID()}`, relativePath, role }); hashes.add(attachment.sha256);
        if (!files.original && role === 'original') files.original = relativePath;
      }
      if (!files.reader && duplicate.files?.reader) {
        for (const key of ['reader', 'sourceMap', 'qualityReport'] as const) {
          const relative = duplicate.files?.[key]; if (!relative) continue;
          const source = assertInside(duplicateFolder, path.join(duplicateFolder, relative));
          if (fs.existsSync(source)) { copyImmutable(source, assertInside(folder, path.join(folder, relative))); files[key] = relative; }
        }
        copyDirectoryIfMissing(path.join(duplicateFolder, 'assets'), path.join(folder, 'assets'));
        extraction = duplicate.extraction;
        adoptedRevision = duplicate.contentRevision;
      }
      const canonicalAnnotations = readJsonArray(path.join(folder, files.annotations ?? 'annotations.json'));
      const duplicateAnnotations = readJsonArray(path.join(duplicateFolder, duplicate.files?.annotations ?? 'annotations.json'));
      const annotationIds = new Set(canonicalAnnotations.map((entry) => String((entry as { id?: unknown }).id ?? '')));
      for (const annotation of duplicateAnnotations) {
        const id = String((annotation as { id?: unknown }).id ?? ''); if (!id || annotationIds.has(id)) continue;
        canonicalAnnotations.push({ ...(annotation as Record<string, unknown>), documentId: canonical.storageId }); annotationIds.add(id);
      }
      if (duplicateAnnotations.length) { files.annotations = files.annotations ?? 'annotations.json'; atomicWriteJson(path.join(folder, files.annotations), canonicalAnnotations); }
      const orphaned = mergeJsonArrayFiles(
        path.join(folder, files.orphanedAnnotations ?? 'orphaned-annotations.json'),
        path.join(duplicateFolder, duplicate.files?.orphanedAnnotations ?? 'orphaned-annotations.json'),
        canonical.storageId,
      );
      if (orphaned) files.orphanedAnnotations = files.orphanedAnnotations ?? 'orphaned-annotations.json';
      const chats = mergeJsonArrayFiles(
        path.join(folder, files.chat ?? 'chat.json'),
        path.join(duplicateFolder, duplicate.files?.chat ?? 'chat.json'),
      );
      if (chats) files.chat = files.chat ?? 'chat.json';
      const noteIds = new Set(notes.map((note) => note.id));
      for (const note of duplicate.notes ?? []) {
        if (noteIds.has(note.id)) {
          if (notes.some((entry) => entry.id === note.id && entry.markdown === note.markdown && entry.title === note.title)) continue;
          notes.push({ ...note, id: `merged-note:${randomUUID()}` });
        } else notes.push(note);
        noteIds.add(notes[notes.length - 1].id);
      }
      for (const relation of duplicate.relations ?? []) relations.push(relation);
    }
    const fill = (key: keyof LibraryItemMetadata) => desired.metadata[key] || duplicates.map((item) => item.metadata[key]).find(Boolean);
    const metadata = normalizeLibraryMetadata({
      ...desired.metadata,
      abstract: fill('abstract'), date: fill('date'), year: desired.metadata.year ?? duplicates.map((item) => item.metadata.year).find((value) => value != null),
      language: fill('language'), publisher: fill('publisher'), publicationTitle: fill('publicationTitle'), volume: fill('volume'), issue: fill('issue'), pages: fill('pages'),
      doi: fill('doi'), url: fill('url'), isbn: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.isbn ?? [] : []))],
      issn: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.issn ?? [] : []))],
      tags: [...new Set(all.flatMap((item) => item.id === resolvedCanonicalId || resolvedDuplicateIds.has(item.id) ? item.metadata.tags ?? [] : []))],
    }, desired.metadata.title);
    const now = new Date().toISOString();
    const contentRevision = adoptedRevision ? {
      ...adoptedRevision,
      revision: Math.max(adoptedRevision.revision, desired.contentRevision?.revision ?? 0) + 1,
      bibliographicFingerprint: bibliographicFingerprint({ metadata }),
      previousReadable: null,
      updatedAt: now,
    } : desired.contentRevision;
    desired = this.store.upsertItem({
      ...desired, metadata, collectionIds: [...new Set([canonical, ...duplicates].flatMap((item) => item.collectionIds))],
      aliases: [...new Set([...(desired.aliases ?? []), ...duplicates.flatMap((item) => [item.id, ...item.aliases])])],
      sourceIdentities: [...new Map([desired, ...duplicates].flatMap((item) => item.sourceIdentities)
        .map((identity) => [JSON.stringify(identity), identity])).values()],
      vaultWorkIds: Object.assign({}, ...[...duplicates, desired].map((item) => item.vaultWorkIds ?? {})),
      attachments, files, extraction, contentRevision, notes,
      relations: [...new Map(relations
        .map((relation) => ({ ...relation, targetItemId: resolvedDuplicateIds.has(relation.targetItemId) ? resolvedCanonicalId : relation.targetItemId }))
        .filter((relation) => relation.targetItemId !== resolvedCanonicalId)
        .map((relation) => [`${relation.relationType}:${relation.targetItemId}`, relation])).values()],
    }, desired.clock.revision, now);
    const relationUpdates: LibraryItemRecord[] = [];
    for (const record of all) {
      if (record.id === resolvedCanonicalId || resolvedDuplicateIds.has(record.id)) continue;
      const relations = record.relations ?? [];
      const remapped = relations.map((relation) => resolvedDuplicateIds.has(relation.targetItemId)
        ? { ...relation, targetItemId: resolvedCanonicalId }
        : relation);
      const deduplicated = [...new Map(remapped.map((relation) => [`${relation.relationType}:${relation.targetItemId}`, relation])).values()];
      if (canonicalJson(relations) !== canonicalJson(deduplicated)) relationUpdates.push(this.store.upsertItem({ ...record, relations: deduplicated }, record.clock.revision, now));
    }
    this.catalog.remapVaultLinks(duplicates.map((item) => item.id), desired.id);
    const deletedDuplicates = duplicates.map((duplicate) => this.store.upsertItem({ ...duplicate, deletedAt: now }, duplicate.clock.revision));
    this.catalog.indexItems([desired, ...relationUpdates, ...deletedDuplicates], this.store);
    return desired;
  }
}

function asciiCitationKey(value: string): string {
  return value.trim().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function readJsonArray(file: string): unknown[] {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; }
}

function readJsonValue(file: string): unknown | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; } catch { return undefined; }
}

function mergeJsonArrayFiles(target: string, source: string, documentId?: string): number {
  const current = readJsonArray(target); const incoming = readJsonArray(source);
  if (!incoming.length) return 0;
  const byId = new Map(current.map((entry) => [String((entry as { id?: unknown })?.id ?? ''), entry]));
  let added = 0;
  for (const value of incoming) {
    if (!value || typeof value !== 'object') continue;
    let entry: Record<string, unknown> = { ...(value as Record<string, unknown>), ...(documentId ? { documentId } : {}) };
    let id = String(entry.id ?? '');
    const existing = id ? byId.get(id) : undefined;
    if (existing && canonicalJson(existing) === canonicalJson(entry)) continue;
    if (!id || existing) { id = `merged:${randomUUID()}`; entry = { ...entry, id }; }
    current.push(entry); byId.set(id, entry); added += 1;
  }
  if (added) atomicWriteJson(target, current);
  return added;
}

function countFiles(root: string, suffix: string): number {
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) count += countFiles(file, suffix);
    else if (entry.isFile() && entry.name.endsWith(suffix)) count += 1;
  }
  return count;
}
