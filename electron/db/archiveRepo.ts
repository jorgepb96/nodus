// Evidence archive store: the user's own files (record photos, CSV/XLSX exports,
// scans) with folders + tags, kept in SQLite so the archive travels with backups
// and .nodussync. File blobs are stored but never loaded by list queries — fetch
// them explicitly with getItemBlob so browsing stays light.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { currentEmbeddingConfig, encodeEmbedding } from './ideasRepo';
import { scanSimilar } from './vectorScan';
import { sanitizeDocMetadata, extractItemYear } from '@shared/archiveDocTypes';
import { archiveEmbeddingText } from '@shared/archiveDiscovery';
import { applyArchiveFilters, sortArchiveItems } from '@shared/archiveFilters';
import type {
  ArchiveFolder,
  ArchiveItem,
  ArchiveItemInput,
  ArchiveItemKind,
  ArchiveLinkedPerson,
  ArchiveListOptions,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Folders ──────────────────────────────────────────────────────────────────

interface FolderRow {
  folder_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

function rowToFolder(row: FolderRow): ArchiveFolder {
  return { folderId: row.folder_id, name: row.name, parentId: row.parent_id, createdAt: row.created_at };
}

export function createFolder(name: string, parentId: string | null = null): ArchiveFolder {
  const id = newId('afd');
  getDb()
    .prepare('INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.trim() || 'Carpeta', parentId, now());
  return getFolder(id)!;
}

export function getFolder(folderId: string): ArchiveFolder | null {
  const row = getDb().prepare('SELECT * FROM archive_folders WHERE folder_id = ?').get(folderId) as
    | FolderRow
    | undefined;
  return row ? rowToFolder(row) : null;
}

export function listFolders(): ArchiveFolder[] {
  return (getDb().prepare('SELECT * FROM archive_folders ORDER BY name').all() as FolderRow[]).map(rowToFolder);
}

export function renameFolder(folderId: string, name: string): ArchiveFolder | null {
  getDb().prepare('UPDATE archive_folders SET name = ? WHERE folder_id = ?').run(name.trim() || 'Carpeta', folderId);
  return getFolder(folderId);
}

/** Delete a folder; child folders cascade away and items in it become unfiled. */
export function deleteFolder(folderId: string): void {
  getDb().prepare('DELETE FROM archive_folders WHERE folder_id = ?').run(folderId);
}

// ── Item ↔ folder memberships ("Carpeta" multi-select) ─────────────────────────
// An item may belong to several folders (archive_item_folders). The legacy single
// archive_items.folder_id is kept in sync with the FIRST membership so older code
// paths and backups stay coherent.

/** Folder ids an item currently belongs to. */
export function listItemFolders(itemId: string): string[] {
  return itemFolderIds(itemId);
}

/** Replace an item's folder memberships wholesale (add/remove in one call). */
export function setItemFolders(itemId: string, folderIds: string[]): ArchiveItem | null {
  const db = getDb();
  if (!getItem(itemId)) return null;
  const clean = Array.from(new Set(folderIds.map((id) => id.trim()).filter(Boolean)));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM archive_item_folders WHERE item_id = ?').run(itemId);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO archive_item_folders (item_id, folder_id, created_at) VALUES (?, ?, ?)'
    );
    for (const folderId of clean) ins.run(itemId, folderId, now());
    // Keep the legacy single-folder column pointing at the first membership.
    db.prepare('UPDATE archive_items SET folder_id = ?, updated_at = ? WHERE item_id = ?').run(
      clean[0] ?? null,
      now(),
      itemId
    );
  });
  tx();
  return getItem(itemId);
}

// ── Items ────────────────────────────────────────────────────────────────────

interface ItemMetaRow {
  item_id: string;
  folder_id: string | null;
  title: string;
  kind: ArchiveItemKind;
  file_name: string | null;
  mime_type: string | null;
  bytes: number;
  has_blob: number;
  extracted_text: string | null;
  description: string | null;
  source: string | null;
  content_hash: string | null;
  doc_type: string | null;
  metadata_json: string | null;
  has_embedding?: number;
  created_at: string;
  updated_at: string;
}

const ITEM_META_COLS = `item_id, folder_id, title, kind, file_name, mime_type, bytes,
  (blob IS NOT NULL) AS has_blob, extracted_text, description, source, content_hash, doc_type, metadata_json,
  (embedding IS NOT NULL) AS has_embedding, created_at, updated_at`;

const ITEM_META_SELECT = `SELECT ${ITEM_META_COLS} FROM embedding_read_archive_items`;

function parseMetadata(json: string | null): Record<string, string> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function itemTags(itemId: string): string[] {
  return (
    getDb().prepare('SELECT tag FROM archive_item_tags WHERE item_id = ? ORDER BY tag').all(itemId) as {
      tag: string;
    }[]
  ).map((r) => r.tag);
}

function itemFolderIds(itemId: string): string[] {
  return (
    getDb()
      .prepare('SELECT folder_id FROM archive_item_folders WHERE item_id = ? ORDER BY folder_id')
      .all(itemId) as { folder_id: string }[]
  ).map((r) => r.folder_id);
}

function itemLinkedPersons(itemId: string): ArchiveLinkedPerson[] {
  return (
    getDb()
      .prepare(
        `SELECT p.person_id, p.display_name
         FROM archive_item_persons ap JOIN persons p ON p.person_id = ap.person_id
         WHERE ap.item_id = ? ORDER BY p.display_name`
      )
      .all(itemId) as { person_id: string; display_name: string }[]
  ).map((r) => ({ personId: r.person_id, displayName: r.display_name }));
}

function rowToItemWithRelations(
  row: ItemMetaRow,
  linkedPersons: ArchiveLinkedPerson[],
  tags: string[],
  folderIds: string[],
): ArchiveItem {
  const metadata = parseMetadata(row.metadata_json);
  return {
    itemId: row.item_id,
    folderId: row.folder_id,
    title: row.title,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    hasBlob: Boolean(row.has_blob),
    extractedText: row.extracted_text,
    description: row.description,
    source: row.source,
    contentHash: row.content_hash,
    docType: row.doc_type,
    metadata,
    year: extractItemYear(row.doc_type, metadata),
    linkedPersons,
    tags,
    folderIds,
    hasEmbedding: Boolean(row.has_embedding),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row: ItemMetaRow): ArchiveItem {
  return rowToItemWithRelations(
    row,
    itemLinkedPersons(row.item_id),
    itemTags(row.item_id),
    itemFolderIds(row.item_id),
  );
}

/**
 * Hydrate one bounded archive page without reading file BLOBs or extracted full
 * text and without the per-row relation queries used by the legacy archive view.
 */
export function listArchiveItemsMetadataByIds(itemIds: string[]): ArchiveItem[] {
  const ids = [...new Set(itemIds)].slice(0, 500);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const rows = db.prepare(
    `SELECT item_id, folder_id, title, kind, file_name, mime_type, bytes,
       (blob IS NOT NULL) AS has_blob, NULL AS extracted_text, description, source,
       content_hash, doc_type, metadata_json, (embedding IS NOT NULL) AS has_embedding,
       created_at, updated_at
     FROM embedding_read_archive_items AS archive_items WHERE item_id IN (${placeholders})`
  ).all(...ids) as ItemMetaRow[];

  const tags = new Map<string, string[]>();
  for (const row of db.prepare(
    `SELECT item_id, tag FROM archive_item_tags
     WHERE item_id IN (${placeholders}) ORDER BY item_id, tag`
  ).all(...ids) as Array<{ item_id: string; tag: string }>) {
    tags.set(row.item_id, [...(tags.get(row.item_id) ?? []), row.tag]);
  }
  const folders = new Map<string, string[]>();
  for (const row of db.prepare(
    `SELECT item_id, folder_id FROM archive_item_folders
     WHERE item_id IN (${placeholders}) ORDER BY item_id, folder_id`
  ).all(...ids) as Array<{ item_id: string; folder_id: string }>) {
    folders.set(row.item_id, [...(folders.get(row.item_id) ?? []), row.folder_id]);
  }
  const people = new Map<string, ArchiveLinkedPerson[]>();
  for (const row of db.prepare(
    `SELECT ap.item_id, p.person_id, p.display_name
       FROM archive_item_persons ap
       JOIN persons p ON p.person_id=ap.person_id
      WHERE ap.item_id IN (${placeholders})
      ORDER BY ap.item_id, p.display_name`
  ).all(...ids) as Array<{ item_id: string; person_id: string; display_name: string }>) {
    people.set(row.item_id, [
      ...(people.get(row.item_id) ?? []),
      { personId: row.person_id, displayName: row.display_name },
    ]);
  }
  const byId = new Map(rows.map((row) => [
    row.item_id,
    rowToItemWithRelations(
      row,
      people.get(row.item_id) ?? [],
      tags.get(row.item_id) ?? [],
      folders.get(row.item_id) ?? [],
    ),
  ]));
  return ids.map((itemId) => byId.get(itemId)).filter((item): item is ArchiveItem => Boolean(item));
}

/** Adapt an ArchiveItem to the shape shared/archiveFilters.ts needs for matching. */
function withLinkedPersonIds(item: ArchiveItem): ArchiveItem & { linkedPersonIds: string[] } {
  return { ...item, linkedPersonIds: item.linkedPersons.map((p) => p.personId) };
}

// ── Document ↔ person links ────────────────────────────────────────────────────

export function linkItemPerson(itemId: string, personId: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO archive_item_persons (item_id, person_id, created_at) VALUES (?, ?, ?)')
    .run(itemId, personId, now());
}

export function unlinkItemPerson(itemId: string, personId: string): void {
  getDb().prepare('DELETE FROM archive_item_persons WHERE item_id = ? AND person_id = ?').run(itemId, personId);
}

/** Archive items (metadata only) linked to a person, newest first. */
export function listItemsForPerson(personId: string): ArchiveItem[] {
  const rows = getDb()
    .prepare(
      `SELECT i.item_id, i.folder_id, i.title, i.kind, i.file_name, i.mime_type, i.bytes,
        (i.blob IS NOT NULL) AS has_blob, i.extracted_text, i.description, i.source, i.content_hash, i.doc_type, i.metadata_json,
        (i.embedding IS NOT NULL) AS has_embedding, i.created_at, i.updated_at
       FROM embedding_read_archive_items i JOIN archive_item_persons ap ON ap.item_id = i.item_id
       WHERE ap.person_id = ? ORDER BY i.updated_at DESC`
    )
    .all(personId) as ItemMetaRow[];
  return rows.map(rowToItem);
}

/** Serialise sanitised metadata for a type, or null when empty. */
function metadataJson(docType: string | null | undefined, metadata: Record<string, string> | null | undefined): string | null {
  if (!metadata) return null;
  const clean = sanitizeDocMetadata(docType, metadata);
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

export function createItem(input: ArchiveItemInput): ArchiveItem {
  const db = getDb();
  const id = newId('ait');
  const ts = now();
  const blob = input.blob ? Buffer.from(input.blob) : null;
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO archive_items
        (item_id, folder_id, title, kind, file_name, mime_type, bytes, blob, extracted_text, description, source, content_hash, doc_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.folderId ?? null,
      input.title.trim() || 'Sin título',
      input.kind ?? 'other',
      input.fileName ?? null,
      input.mimeType ?? null,
      input.bytes ?? (blob ? blob.length : 0),
      blob,
      input.extractedText ?? null,
      input.description ?? null,
      input.source?.trim() || null,
      input.contentHash ?? null,
      input.docType ?? null,
      metadataJson(input.docType, input.metadata),
      ts,
      ts
    );
    for (const tag of dedupeTags(input.tags)) addTagInternal(id, tag);
    // Seed the "Carpeta" multi-select membership so a filed item is filed under the
    // new model too (the migration backfills existing rows; new rows seed here).
    if (input.folderId) {
      db.prepare('INSERT OR IGNORE INTO archive_item_folders (item_id, folder_id, created_at) VALUES (?, ?, ?)').run(
        id,
        input.folderId,
        ts
      );
    }
  });
  tx();
  return getItem(id)!;
}

export function getItem(itemId: string): ArchiveItem | null {
  const row = getDb().prepare(`${ITEM_META_SELECT} WHERE item_id = ?`).get(itemId) as ItemMetaRow | undefined;
  return row ? rowToItem(row) : null;
}

/** Fetch the stored file bytes for an item, or null if it has none. */
export function getItemBlob(itemId: string): Buffer | null {
  const row = getDb().prepare('SELECT blob FROM archive_items WHERE item_id = ?').get(itemId) as
    | { blob: Buffer | null }
    | undefined;
  return row?.blob ?? null;
}

/**
 * List items for the archive's "upload sources" window, with as many filters and
 * sortings as the UI offers. Only `folderId` is pushed down to SQL (it cheaply
 * narrows the scan); everything else — doc type, file kind, tags/persons (with a
 * Notion-style any/all match mode), year range, and free-text search — runs through
 * the shared pure filter/sort so the matching logic is unit-tested without a DB.
 */
export function listItems(opts: ArchiveListOptions = {}): ArchiveItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.folderId !== undefined) {
    if (opts.folderId === null) where.push('folder_id IS NULL');
    else {
      where.push('folder_id = ?');
      params.push(opts.folderId);
    }
  }
  const sql = `${ITEM_META_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  let items = (getDb().prepare(sql).all(...params) as ItemMetaRow[]).map(rowToItem).map(withLinkedPersonIds);
  // "Carpeta" facet: keep items that belong to ANY of the requested folders.
  if (opts.folderIds && opts.folderIds.length) {
    const wanted = new Set(opts.folderIds);
    items = items.filter((it) => it.folderIds.some((id) => wanted.has(id)));
  }
  const filtered = applyArchiveFilters(items, {
    docTypes: opts.docTypes,
    kinds: opts.kinds,
    tags: opts.tags,
    tagsMode: opts.tagsMode,
    personIds: opts.personIds,
    personsMode: opts.personsMode,
    facets: opts.facets,
    yearFrom: opts.yearFrom,
    yearTo: opts.yearTo,
    search: opts.search,
  });
  return sortArchiveItems(filtered, opts.sort ?? 'updatedDesc');
}

export function updateItem(
  itemId: string,
  patch: Partial<Pick<ArchiveItemInput, 'title' | 'folderId' | 'description' | 'source' | 'extractedText' | 'docType' | 'metadata'>>
): ArchiveItem | null {
  const existing = getItem(itemId);
  if (!existing) return null;
  const title = patch.title?.trim() ?? existing.title;
  const folderId = patch.folderId !== undefined ? patch.folderId : existing.folderId;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const source = patch.source !== undefined ? (patch.source?.trim() || null) : existing.source;
  const extractedText = patch.extractedText !== undefined ? patch.extractedText : existing.extractedText;
  const docType = patch.docType !== undefined ? patch.docType : existing.docType;
  const embeddingSourceChanged =
    archiveEmbeddingText(existing) !== archiveEmbeddingText({ title, description, extractedText, docType });
  // Re-sanitise against the (possibly changed) type; a type change drops stray fields.
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
  getDb()
    .prepare(
      `UPDATE archive_items
          SET title = ?, folder_id = ?, description = ?, source = ?, extracted_text = ?,
              doc_type = ?, metadata_json = ?,
              embedding = CASE WHEN ? THEN NULL ELSE embedding END,
              embedding_provider = CASE WHEN ? THEN NULL ELSE embedding_provider END,
              embedding_model = CASE WHEN ? THEN NULL ELSE embedding_model END,
              embedding_dim = CASE WHEN ? THEN NULL ELSE embedding_dim END,
              embedding_text_hash = CASE WHEN ? THEN NULL ELSE embedding_text_hash END,
              updated_at = ?
        WHERE item_id = ?`
    )
    .run(
      title,
      folderId,
      description,
      source,
      extractedText,
      docType,
      metadataJson(docType, metadata),
      ...Array(5).fill(embeddingSourceChanged ? 1 : 0),
      now(),
      itemId
    );
  return getItem(itemId);
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM archive_items WHERE item_id = ?').run(itemId);
}

/**
 * Replace an item's attached file in place: new bytes, format, extracted text and
 * hash, keeping its title, folder, classification, tags and person links. The stale
 * embedding is cleared so the item re-indexes from the new text.
 */
export function replaceItemFile(
  itemId: string,
  input: {
    fileName: string | null;
    mimeType: string | null;
    bytes: number;
    blob: Uint8Array;
    kind: ArchiveItemKind;
    extractedText: string | null;
    description: string | null;
    contentHash: string | null;
  }
): ArchiveItem | null {
  const existing = getItem(itemId);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE archive_items SET file_name = ?, mime_type = ?, bytes = ?, blob = ?, kind = ?, extracted_text = ?,
        description = ?, content_hash = ?, embedding = NULL, embedding_provider = NULL,
        embedding_model = NULL, embedding_dim = NULL, embedding_text_hash = NULL,
        updated_at = ? WHERE item_id = ?`
    )
    .run(
      input.fileName,
      input.mimeType,
      input.bytes,
      Buffer.from(input.blob),
      input.kind,
      input.extractedText,
      input.description ?? existing.description,
      input.contentHash,
      now(),
      itemId
    );
  return getItem(itemId);
}

/** Return the item id whose content hash matches, if any (de-dupe on re-import). */
export function findItemByHash(contentHash: string): string | null {
  const row = getDb().prepare('SELECT item_id FROM archive_items WHERE content_hash = ? LIMIT 1').get(contentHash) as
    | { item_id: string }
    | undefined;
  return row?.item_id ?? null;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function dedupeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function addTagInternal(itemId: string, tag: string): void {
  getDb().prepare('INSERT OR IGNORE INTO archive_item_tags (item_id, tag) VALUES (?, ?)').run(itemId, tag);
}

export function addTag(itemId: string, tag: string): void {
  const trimmed = tag.trim();
  if (trimmed) addTagInternal(itemId, trimmed);
}

export function removeTag(itemId: string, tag: string): void {
  getDb().prepare('DELETE FROM archive_item_tags WHERE item_id = ? AND tag = ?').run(itemId, tag);
}

/** All distinct tags with their item counts, for a tag filter UI. */
export function listTags(): { tag: string; count: number }[] {
  return getDb()
    .prepare('SELECT tag, COUNT(*) AS count FROM archive_item_tags GROUP BY tag ORDER BY count DESC, tag')
    .all() as { tag: string; count: number }[];
}

export function archiveCounts(): { items: number; folders: number } {
  const db = getDb();
  return {
    items: (db.prepare('SELECT COUNT(*) AS c FROM archive_items').get() as { c: number }).c,
    folders: (db.prepare('SELECT COUNT(*) AS c FROM archive_folders').get() as { c: number }).c,
  };
}

// ── Semantic index (embeddings) ────────────────────────────────────────────────

export interface ArchiveEmbeddingRow {
  itemId: string;
  title: string;
  description: string | null;
  extractedText: string | null;
  docType: string | null;
  hasEmbedding: boolean;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  embeddingTextHash: string | null;
}

/**
 * Prefer a reviewed source-faithful text version for semantic indexing. The legacy
 * `archive_items.extracted_text` remains the fallback for genealogy/older vaults.
 * Translations are intentionally lowest priority so a derived language version never
 * silently replaces the document's diplomatic/OCR/transcription text.
 */
const PREFERRED_ARCHIVE_TEXT_SQL = `(SELECT tv.content
  FROM archive_text_versions tv
 WHERE tv.item_id=ai.item_id
 ORDER BY
   CASE tv.status WHEN 'reviewed' THEN 0 WHEN 'closed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
   CASE tv.kind WHEN 'diplomatic' THEN 0 WHEN 'transcription' THEN 0 WHEN 'ocr' THEN 1 WHEN 'normalized' THEN 2 ELSE 3 END,
   tv.updated_at DESC
 LIMIT 1)`;

type ArchiveEmbeddingSqlRow = {
  item_id: string;
  title: string;
  description: string | null;
  extracted_text: string | null;
  doc_type: string | null;
  has_embedding: number;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_text_hash: string | null;
};

function embeddingRow(row: ArchiveEmbeddingSqlRow): ArchiveEmbeddingRow {
  return {
    itemId: row.item_id,
    title: row.title,
    description: row.description,
    extractedText: row.extracted_text,
    docType: row.doc_type,
    hasEmbedding: Boolean(row.has_embedding),
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    embeddingTextHash: row.embedding_text_hash,
  };
}

/** Text-bearing items with their embedding metadata (no blobs), for the indexer. */
export function archiveItemsForEmbedding(): ArchiveEmbeddingRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ai.item_id, ai.title, ai.description,
              COALESCE(${PREFERRED_ARCHIVE_TEXT_SQL}, ai.extracted_text) AS extracted_text,
              ai.doc_type, (ai.embedding IS NOT NULL) AS has_embedding,
              ai.embedding_provider, ai.embedding_model, ai.embedding_dim,
              ai.embedding_text_hash
         FROM embedding_read_archive_items ai
        WHERE COALESCE(${PREFERRED_ARCHIVE_TEXT_SQL}, ai.extracted_text, ai.description, '') <> ''`
    )
    .all() as ArchiveEmbeddingSqlRow[];
  return rows.map(embeddingRow);
}

/** One source's exact current indexing input, without loading its BLOB. */
export function archiveItemForEmbedding(itemId: string): ArchiveEmbeddingRow | null {
  const row = getDb().prepare(
    `SELECT ai.item_id, ai.title, ai.description,
            COALESCE(${PREFERRED_ARCHIVE_TEXT_SQL}, ai.extracted_text) AS extracted_text,
            ai.doc_type, (ai.embedding IS NOT NULL) AS has_embedding,
            ai.embedding_provider, ai.embedding_model, ai.embedding_dim,
            ai.embedding_text_hash
       FROM embedding_read_archive_items ai
      WHERE ai.item_id=?`
  ).get(itemId) as ArchiveEmbeddingSqlRow | undefined;
  return row ? embeddingRow(row) : null;
}

export function setItemEmbedding(
  itemId: string,
  vec: number[],
  provider: string,
  model: string,
  textHash: string
): void {
  if (
    vec.length === 0
    || !vec.every(Number.isFinite)
    || !vec.some((value) => value !== 0)
    || !provider.trim()
    || !model.trim()
  ) {
    throw new Error('No se puede guardar un embedding de archivo vacío o inválido.');
  }
  getDb()
    .prepare(
      `UPDATE archive_items
          SET embedding = ?, embedding_provider = ?, embedding_model = ?,
              embedding_dim = ?, embedding_text_hash = ?, updated_at = ?
        WHERE item_id = ?`
    )
    .run(encodeEmbedding(vec), provider, model, vec.length, textHash, now(), itemId);
}

export function clearAllArchiveEmbeddings(): void {
  getDb()
    .prepare(
      `UPDATE archive_items
          SET embedding = NULL, embedding_provider = NULL, embedding_model = NULL,
              embedding_dim = NULL, embedding_text_hash = NULL`
    )
    .run();
}

export function archiveEmbeddingCount(): { indexed: number; total: number } {
  const db = getDb();
  const config = currentEmbeddingConfig();
  return {
    indexed: (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM embedding_read_archive_items AS archive_items
            WHERE embedding IS NOT NULL
              AND embedding_provider = ?
              AND embedding_model = ?
              AND embedding_dim > 0`
        )
        .get(config.provider, config.model) as { c: number }
    ).c,
    total: (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM archive_items ai
            WHERE COALESCE(${PREFERRED_ARCHIVE_TEXT_SQL}, ai.extracted_text, ai.description, '') <> ''`
        )
        .get() as { c: number }
    ).c,
  };
}

/**
 * Archive items most similar to a query vector. Optionally excludes items already
 * linked to a given person (so discovery only ever proposes NEW links). Returns
 * metadata items plus their similarity, strongest first.
 *
 * Paged, like every other similarity search (see ./vectorScan.ts): the archive has
 * no vector index either, so scanning it in one go held the main process for as long
 * as the scan took, with the window frozen behind it.
 */
export async function findArchiveItemsSimilar(
  queryVec: number[],
  opts: { limit?: number; minSimilarity?: number; excludePersonId?: string; excludeItemIds?: string[]; includeItemIds?: string[] } = {}
): Promise<(ArchiveItem & { similarity: number })[]> {
  const limit = opts.limit ?? 8;
  const minSim = opts.minSimilarity ?? 0.35;
  if (queryVec.length === 0) return [];
  const config = currentEmbeddingConfig();
  const where: string[] = [
    'embedding IS NOT NULL',
    'embedding_provider = ?',
    'embedding_model = ?',
    'embedding_dim = ?',
  ];
  const params: unknown[] = [config.provider, config.model, queryVec.length];
  if (opts.includeItemIds) {
    if (!opts.includeItemIds.length) return [];
    where.push('item_id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(opts.includeItemIds));
  }
  if (opts.excludePersonId) {
    where.push('item_id NOT IN (SELECT item_id FROM archive_item_persons WHERE person_id = ?)');
    params.push(opts.excludePersonId);
  }
  if (opts.excludeItemIds?.length) {
    where.push(`item_id NOT IN (${opts.excludeItemIds.map(() => '?').join(',')})`);
    params.push(...opts.excludeItemIds);
  }
  const ranked = await scanSimilar<{ item_id: string; rid: number; similarity: number }>({
    table: 'archive_items',
    sql: `SELECT item_id, rowid AS rid, vec_scan(embedding) AS similarity
            FROM embedding_read_archive_items AS archive_items
           WHERE rowid > ? AND rowid <= ? AND ${where.join(' AND ')}`,
    params,
    query: queryVec,
    // Twice the asked-for count, as before: some winners have no metadata row left.
    threshold: minSim,
    limit: limit * 2,
  });
  const out: (ArchiveItem & { similarity: number })[] = [];
  for (const r of ranked) {
    const item = getItem(r.item_id);
    if (item) out.push({ ...item, similarity: r.similarity });
    if (out.length >= limit) break;
  }
  return out;
}
