import {academicMarkdownProjection} from '@shared/academicProjection';
import type { AcademicMetadata } from '@shared/academicDocument';
import { readPageAcademicMetadata } from '@shared/pageYjs';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { getDb } from './database';
import { readPageYDocument, readPageNativeDocument, writePageYDocument } from '@shared/pageYjs';
import { blockNoteToPageBlocks, markdownToBlockNote, validateBlockNoteDocument, type BlockNoteDocument } from '@shared/blockNoteDocument';
import {canonicalJson} from '@shared/canonicalJson';
import {
  PAGE_BLOCK_TYPES,
  markdownToPageBlocks,
  pageBlockNormalizedText,
  pageBlocksToMarkdown,
  type CreatePageInput,
  type Page,
  type PageAsset,
  type PageBacklink,
  type PageBlock,
  type PageBlockDraft,
  type PageBlockType,
  type PageDocument,
  type PageMutationResult,
  type PageRevision,
  type PageRevisionPage,
  type PageRevisionSnapshot,
  type PageSearchResult,
  type PageTreeItem,
  type SavePageDocumentInput,
  type SyncedBlockSource,
} from '@shared/pages';

type Row = Record<string, unknown>;
const BLOCK_TYPES = new Set<string>(PAGE_BLOCK_TYPES);
const COMPACT_EVERY = 20;

const now = () => new Date().toISOString();
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const normalizeMarkdown = (value: string) => value.replace(/\r\n?/g, '\n').trimEnd();

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJson(value: unknown): Record<string, unknown> {
  try { return jsonObject(value ? JSON.parse(String(value)) : {}); }
  catch { return {}; }
}

function toPage(row: Row): Page {
  return {
    id: String(row.id),
    rowId: row.row_id == null ? null : String(row.row_id),
    noteId: row.note_id == null ? null : String(row.note_id),
    parentPageId: row.parent_page_id == null ? null : String(row.parent_page_id),
    origin: String(row.origin) as Page['origin'],
    title: String(row.title ?? ''),
    icon: row.icon == null ? null : String(row.icon),
    coverBlobHash: row.cover_blob_hash == null ? null : String(row.cover_blob_hash),
    state: String(row.state) as Page['state'],
    locked: Number(row.locked) === 1,
    fullWidth: Number(row.full_width) === 1,
    revision: Number(row.revision),
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toBlock(row: Row): PageBlock {
  return {
    id: String(row.id),
    pageId: String(row.page_id),
    parentBlockId: row.parent_block_id == null ? null : String(row.parent_block_id),
    order: Number(row.sort_order),
    type: String(row.type) as PageBlockType,
    content: parseJson(row.content_json),
    normalizedText: String(row.normalized_text ?? ''),
    revision: Number(row.revision),
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    trashedAt: row.trashed_at == null ? null : String(row.trashed_at),
  };
}

export function getPage(id: string): Page | null {
  const row = getDb().prepare('SELECT * FROM pages WHERE id = ?').get(id) as Row | undefined;
  return row ? toPage(row) : null;
}

export function getPageForRow(rowId: string): Page | null {
  const row = getDb().prepare('SELECT * FROM pages WHERE row_id = ?').get(rowId) as Row | undefined;
  return row ? toPage(row) : null;
}

export function getPageForNote(noteId: string): Page | null {
  const row = getDb().prepare('SELECT * FROM pages WHERE note_id = ?').get(noteId) as Row | undefined;
  return row ? toPage(row) : null;
}

export function listPages(state: 'active' | 'trashed' | 'all' = 'active'): PageTreeItem[] {
  const rows = getDb().prepare(
    `SELECT page.*, CASE WHEN favorite.page_id IS NULL THEN 0 ELSE 1 END AS favorite,
            (SELECT COUNT(*) FROM pages child WHERE child.parent_page_id = page.id AND child.state = page.state) AS child_count
     FROM pages page LEFT JOIN page_favorites favorite ON favorite.page_id = page.id
     WHERE (page.origin <> 'database_row' OR favorite.page_id IS NOT NULL)
       ${state === 'all' ? '' : 'AND page.state = ?'}
     ORDER BY CASE WHEN favorite.page_id IS NULL THEN 1 ELSE 0 END, favorite.position,
              page.parent_page_id IS NOT NULL, page.updated_at DESC, page.id`,
  ).all(...(state === 'all' ? [] : [state])) as Row[];
  return rows.map((row) => ({ ...toPage(row), favorite: Number(row.favorite) === 1, childCount: Number(row.child_count) }));
}

export function listPageBreadcrumbs(pageId: string): Page[] {
  const rows = getDb().prepare(
    `WITH RECURSIVE ancestors(id, parent_page_id, depth, path) AS (
       SELECT id, parent_page_id, 0, '|' || id || '|' FROM pages WHERE id = ?
       UNION ALL
       SELECT page.id, page.parent_page_id, ancestors.depth + 1, ancestors.path || page.id || '|'
       FROM pages page JOIN ancestors ON ancestors.parent_page_id = page.id
       WHERE ancestors.depth < 100 AND instr(ancestors.path, '|' || page.id || '|') = 0
     )
     SELECT page.* FROM ancestors JOIN pages page ON page.id = ancestors.id ORDER BY ancestors.depth DESC`,
  ).all(pageId) as Row[];
  return rows.map(toPage);
}

function toBacklink(row: Row): PageBacklink {
  return {
    id: String(row.id), sourcePageId: String(row.source_page_id), sourceBlockId: String(row.source_block_id),
    sourceTitle: String(row.source_title ?? ''), targetPageId: row.resolved_target_page_id == null ? null : String(row.resolved_target_page_id),
    targetBlockId: row.target_block_id == null ? null : String(row.target_block_id), kind: String(row.kind) as PageBacklink['kind'],
    label: String(row.label ?? ''), broken: Number(row.broken) === 1,
  };
}

const backlinkProjection = /* sql */ `
  SELECT link.*, source.title AS source_title,
         COALESCE(link.target_page_id, target_block.page_id) AS resolved_target_page_id,
         CASE WHEN link.kind = 'synced_block' THEN target_block.id IS NULL
              ELSE target.id IS NULL END AS broken
  FROM page_links link
  JOIN pages source ON source.id = link.source_page_id
  LEFT JOIN page_blocks target_block ON target_block.id = link.target_block_id AND target_block.trashed_at IS NULL
  LEFT JOIN pages target ON target.id = link.target_page_id`;

export function listPageBacklinks(pageId: string): PageBacklink[] {
  const rows = getDb().prepare(
    `${backlinkProjection}
     WHERE COALESCE(link.target_page_id, target_block.page_id) = ? AND source.state = 'active'
     ORDER BY source.updated_at DESC, link.id`,
  ).all(pageId) as Row[];
  return rows.map(toBacklink);
}

export function listBrokenPageLinks(): PageBacklink[] {
  const rows = getDb().prepare(
    `SELECT * FROM (${backlinkProjection}) projected WHERE broken = 1 ORDER BY source_title, id LIMIT 500`,
  ).all() as Row[];
  return rows.map(toBacklink);
}

export function getSyncedBlockSource(blockId: string): SyncedBlockSource | null {
  const row = getDb().prepare(
    `SELECT block.*, page.id AS source_page_id FROM page_blocks block
     JOIN pages page ON page.id = block.page_id
     WHERE block.id = ? AND block.trashed_at IS NULL AND page.state = 'active'`,
  ).get(blockId) as Row | undefined;
  if (!row) return null;
  return { block: toBlock(row), page: getPage(String(row.source_page_id))! };
}

const PAGE_SEARCH_SYNONYMS: string[][] = [
  ['coche', 'automovil', 'auto', 'vehiculo', 'car'],
  ['tarea', 'trabajo', 'task', 'accion'],
  ['proyecto', 'project', 'iniciativa'],
  ['persona', 'person', 'usuario', 'user'],
  ['fecha', 'date', 'calendario', 'calendar'],
  ['archivo', 'file', 'documento', 'document'],
];

function pageSearchMatch(query: string, mode: 'lexical' | 'semantic'): string {
  const tokens = query.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)?.filter((token) => token.length > 1) ?? [];
  if (!tokens.length) return '';
  const expanded = new Set(tokens);
  if (mode === 'semantic') {
    for (const token of tokens) {
      const family = PAGE_SEARCH_SYNONYMS.find((values) => values.includes(token));
      for (const value of family ?? []) expanded.add(value);
    }
  }
  const values = [...expanded].map((token) => `"${token.replace(/"/g, '""')}"*`);
  return values.join(mode === 'semantic' ? ' OR ' : ' AND ');
}

export function searchPages(query: string, mode: 'lexical' | 'semantic' = 'lexical', limit = 50): PageSearchResult[] {
  const match = pageSearchMatch(query, mode);
  if (!match) return [];
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = getDb().prepare(
    `SELECT db_search_fts.entity_type, db_search_fts.entity_id, db_search_fts.row_id,
            COALESCE(title_page.id, block_page.id, row_page.id) AS page_id,
            COALESCE(title_page.title, block_page.title, row_page.title, attachment.file_name, '') AS title,
            snippet(db_search_fts, 0, '<mark>', '</mark>', '…', 24) AS snippet,
            bm25(db_search_fts, 7.0) AS rank
     FROM db_search_fts
     LEFT JOIN pages title_page ON db_search_fts.entity_type = 'page_title' AND title_page.id = db_search_fts.entity_id
     LEFT JOIN page_blocks block ON db_search_fts.entity_type = 'page_block' AND block.id = db_search_fts.entity_id
     LEFT JOIN pages block_page ON block_page.id = block.page_id
     LEFT JOIN pages row_page ON row_page.row_id = db_search_fts.row_id
     LEFT JOIN db_attachments attachment ON db_search_fts.entity_type = 'attachment' AND attachment.id = db_search_fts.entity_id
     WHERE db_search_fts MATCH ?
       AND db_search_fts.entity_type IN ('page_title','page_block','cell','attachment')
       AND COALESCE(title_page.state, block_page.state, row_page.state, 'active') = 'active'
     ORDER BY rank, db_search_fts.entity_id LIMIT ?`,
  ).all(match, bounded) as Row[];
  return rows.map((row) => ({
    entityType: String(row.entity_type) as PageSearchResult['entityType'], entityId: String(row.entity_id),
    pageId: row.page_id == null ? null : String(row.page_id), rowId: row.row_id == null ? null : String(row.row_id),
    title: String(row.title || 'Página sin título'), snippet: String(row.snippet ?? ''), rank: Number(row.rank),
  }));
}

export function listPageBlocks(pageId: string, includeTrashed = false): PageBlock[] {
  const rows = getDb().prepare(
    `SELECT * FROM page_blocks WHERE page_id = ?${includeTrashed ? '' : ' AND trashed_at IS NULL'}
     ORDER BY sort_order, id`,
  ).all(pageId) as Row[];
  return rows.map(toBlock);
}

function emptyYDoc(page: Page, blocks: PageBlockDraft[]): { state: Uint8Array; vector: Uint8Array } {
  const doc = new Y.Doc();
  // Every replica can reconstruct the same initial CRDT state from the materialized page
  // projection. Local edits still use the random client id Y.Doc receives when that state
  // is loaded, but their common ancestors must have identical struct ids or an incremental
  // update would wait forever for a different replica's private bootstrap structs.
  const stableClientId = Number.parseInt(sha256(page.id).slice(0, 8), 16) >>> 0;
  doc.clientID = stableClientId || 1;
  writePageYDocument(doc, page.title, blocks);
  return { state: Y.encodeStateAsUpdate(doc), vector: Y.encodeStateVector(doc) };
}

function ensureDocumentRow(page: Page): Row {
  const db = getDb();
  let row = db.prepare('SELECT * FROM page_documents WHERE page_id = ?').get(page.id) as Row | undefined;
  if (row) return row;
  const blocks = listPageBlocks(page.id).map((entry) => ({
    id: entry.id, parentBlockId: entry.parentBlockId, order: entry.order, type: entry.type, content: entry.content,
  }));
  const yjs = emptyYDoc(page, blocks);
  const timestamp = now();
  const markdownHash = sha256(normalizeMarkdown(pageBlocksToMarkdown(blocks)));
  db.prepare(
    `INSERT INTO page_documents
      (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
       markdown_hash, update_count, created_at, updated_at)
     VALUES (?, 1, 0, 1, ?, ?, ?, 0, ?, ?)`,
  ).run(page.id, Buffer.from(yjs.state), Buffer.from(yjs.vector), markdownHash, timestamp, timestamp);
  db.prepare(
    `INSERT INTO page_document_snapshots
      (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?)`,
  ).run(randomUUID(), page.id, Buffer.from(yjs.state), Buffer.from(yjs.vector), markdownHash, timestamp);
  row = db.prepare('SELECT * FROM page_documents WHERE page_id = ?').get(page.id) as Row;
  return row;
}

function loadYDoc(documentRow: Row): Y.Doc {
  const doc = new Y.Doc();
  const snapshot = documentRow.snapshot_blob as Uint8Array;
  if (snapshot?.byteLength) Y.applyUpdate(doc, new Uint8Array(snapshot));
  const updates = getDb().prepare(
    'SELECT update_blob FROM page_document_updates WHERE page_id = ? AND sequence_no > ? ORDER BY sequence_no',
  ).all(String(documentRow.page_id), Number(documentRow.snapshot_sequence)) as Array<{ update_blob: Uint8Array }>;
  for (const update of updates) Y.applyUpdate(doc, new Uint8Array(update.update_blob));
  return doc;
}

function buildDocument(page: Page, row: Row, doc = loadYDoc(row)): PageDocument {
  const blocks = listPageBlocks(page.id);
  const native=readPageNativeDocument(doc);
  // Existing native documents keep their established Markdown until an actual edit.
  // Recomputing a new projection while opening would normalize their cache silently.
  const markdown = normalizeMarkdown(native&&doc.getMap('editor').has('academicMetadata')?academicMarkdownProjection(native,readPageAcademicMetadata(doc)):pageBlocksToMarkdown(blocks));
  return {
    page,
    blocks,
    nativeDocument: native,
    academicMetadata: readPageAcademicMetadata(doc),
    schemaVersion: Number(doc.getMap('editor').get('schemaVersion') ?? 1),
    yjsState: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    revision: Number(row.revision),
    updateSequence: Number(row.next_update_sequence) - 1,
    snapshotSequence: Number(row.snapshot_sequence),
    markdown,
    markdownHash: sha256(markdown),
  };
}

type PageHistorySnapshot = {
  academicMetadata?: AcademicMetadata;
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  page: Page;
  blocks: PageBlock[];
  documentRevision: number;
};

type PageHistoryDelta = {
  academicMetadata?: AcademicMetadata;
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  page: Record<string, { before: unknown; after: unknown }>;
  blocks: { upsert: PageBlock[]; remove: string[] };
  documentRevision: number;
};

const HISTORY_PAGE_FIELDS = [
  'parentPageId', 'title', 'icon', 'coverBlobHash', 'state', 'locked', 'fullWidth',
  'revision', 'updatedBy', 'updatedAt',
] as const satisfies ReadonlyArray<keyof Page>;

function capturePageHistorySnapshot(pageId: string, loadedDoc?: Y.Doc): PageHistorySnapshot {
  const page = getPage(pageId);
  if (!page) throw new Error('La página no existe.');
  const documentRow = ensureDocumentRow(page);
  const doc = loadedDoc ?? loadYDoc(documentRow);
  return { page, blocks: listPageBlocks(pageId, true), documentRevision: Number(documentRow.revision), nativeDocument: readPageNativeDocument(doc),
    academicMetadata: readPageAcademicMetadata(doc), schemaVersion: Number(doc.getMap('editor').get('schemaVersion') ?? 1) };
}

function pageHistoryDelta(before: PageHistorySnapshot, after: PageHistorySnapshot): PageHistoryDelta {
  const page: PageHistoryDelta['page'] = {};
  for (const field of HISTORY_PAGE_FIELDS) {
    if (JSON.stringify(before.page[field]) !== JSON.stringify(after.page[field])) {
      page[field] = { before: before.page[field], after: after.page[field] };
    }
  }
  const previous = new Map(before.blocks.map((block) => [block.id, block]));
  const current = new Map(after.blocks.map((block) => [block.id, block]));
  const upsert: PageBlock[] = [];
  for (const block of after.blocks) {
    const old = previous.get(block.id);
    const semantic = (value: PageBlock | undefined) => value ? {
      id: value.id, parentBlockId: value.parentBlockId, order: value.order, type: value.type,
      content: value.content, trashedAt: value.trashedAt,
    } : null;
    if (!old || JSON.stringify(semantic(old)) !== JSON.stringify(semantic(block))) upsert.push(block);
  }
  const remove = before.blocks.filter((block) => !current.has(block.id)).map((block) => block.id);
  return { page, blocks: { upsert, remove }, documentRevision: after.documentRevision, nativeDocument: after.nativeDocument, academicMetadata: after.academicMetadata, schemaVersion: after.schemaVersion };
}

function pageHistorySummary(delta: PageHistoryDelta, reason: string): string {
  const labels: Record<string, string> = {
    baseline: 'Versión inicial',
    create: 'Página creada', content: 'Contenido editado', metadata: 'Propiedades editadas',
    move: 'Página movida', trash: 'Movida a la papelera', 'restore-trash': 'Restaurada desde la papelera',
    'restore-revision': 'Versión restaurada', 'remote-update': 'Edición sincronizada',
    'markdown-import': 'Markdown importado',
  };
  return labels[reason] ?? reason;
}

function pageHistoryCounts(delta: PageHistoryDelta): { propertyChanges: number; blockChanges: number } {
  return {
    propertyChanges: Object.keys(delta.page).filter((field) => !['revision', 'updatedBy', 'updatedAt'].includes(field)).length,
    blockChanges: delta.blocks.upsert.length + delta.blocks.remove.length,
  };
}

function insertPageRevision(
  pageId: string,
  snapshot: PageHistorySnapshot,
  actorId: string,
  reason: string,
  before: PageHistorySnapshot | null,
  restoredFromRevision: number | null = null,
): PageRevision {
  const db = getDb();
  const previousRevision = Number((db.prepare(
    'SELECT COALESCE(MAX(revision), 0) AS revision FROM page_revisions WHERE page_id = ?',
  ).get(pageId) as { revision: number }).revision);
  const revision = previousRevision + 1;
  const delta = before ? pageHistoryDelta(before, snapshot) : {
    page: {}, blocks: { upsert: [], remove: [] }, documentRevision: snapshot.documentRevision,
  } satisfies PageHistoryDelta;
  const keepSnapshot = revision === 1 || revision % 20 === 0 || reason === 'restore-revision';
  const counts = pageHistoryCounts(delta);
  const timestamp = now();
  const id = `prev_${randomUUID()}`;
  db.prepare(
    `INSERT INTO page_revisions
      (id, page_id, revision, source_page_revision, document_revision, actor_id, reason,
       summary, property_changes, block_changes, delta_json, snapshot_json, restored_from_revision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, pageId, revision, snapshot.page.revision, snapshot.documentRevision, actorId, reason,
    pageHistorySummary(delta, reason), counts.propertyChanges, counts.blockChanges,
    JSON.stringify(delta), keepSnapshot ? JSON.stringify(snapshot) : null,
    restoredFromRevision, timestamp,
  );
  return {
    id, pageId, revision, sourcePageRevision: snapshot.page.revision,
    documentRevision: snapshot.documentRevision, actorId, reason,
    summary: pageHistorySummary(delta, reason), ...counts, restoredFromRevision,
    hasSnapshot: keepSnapshot, createdAt: timestamp,
  };
}

function ensurePageHistory(pageId: string, snapshot?: PageHistorySnapshot): void {
  const exists = getDb().prepare('SELECT 1 FROM page_revisions WHERE page_id = ? LIMIT 1').get(pageId);
  if (!exists) insertPageRevision(pageId, snapshot ?? capturePageHistorySnapshot(pageId), 'migration', 'baseline', null);
}

function recordPageHistory(
  pageId: string,
  before: PageHistorySnapshot,
  actorId: string,
  reason: string,
  restoredFromRevision: number | null = null,
  loadedDoc?: Y.Doc,
): PageRevision {
  ensurePageHistory(pageId, before);
  return insertPageRevision(pageId, capturePageHistorySnapshot(pageId, loadedDoc), actorId, reason, before, restoredFromRevision);
}

function toPageRevision(row: Row): PageRevision {
  return {
    id: String(row.id), pageId: String(row.page_id), revision: Number(row.revision),
    sourcePageRevision: Number(row.source_page_revision), documentRevision: Number(row.document_revision),
    actorId: String(row.actor_id), reason: String(row.reason), summary: String(row.summary ?? ''),
    propertyChanges: Number(row.property_changes ?? 0), blockChanges: Number(row.block_changes ?? 0),
    restoredFromRevision: row.restored_from_revision == null ? null : Number(row.restored_from_revision),
    hasSnapshot: row.snapshot_json != null, createdAt: String(row.created_at),
  };
}

function encodeHistoryCursor(pageId: string, revision: number): string {
  return Buffer.from(JSON.stringify({ v: 1, p: pageId, r: revision })).toString('base64url');
}

function decodeHistoryCursor(pageId: string, cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v?: number; p?: string; r?: number };
    if (value.v !== 1 || value.p !== pageId || !Number.isInteger(value.r) || Number(value.r) < 1) throw new Error();
    return Number(value.r);
  } catch { throw new Error('El cursor del historial no es válido para esta página.'); }
}

export function listPageRevisions(pageId: string, cursor?: string | null, limit = 50): PageRevisionPage {
  if (!getPage(pageId)) throw new Error('La página no existe.');
  ensurePageHistory(pageId);
  const before = decodeHistoryCursor(pageId, cursor);
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = getDb().prepare(
    `SELECT * FROM page_revisions WHERE page_id = ? AND (? IS NULL OR revision < ?)
     ORDER BY revision DESC LIMIT ?`,
  ).all(pageId, before, before, bounded + 1) as Row[];
  const hasMore = rows.length > bounded;
  const items = rows.slice(0, bounded).map(toPageRevision);
  return { items, nextCursor: hasMore && items.length ? encodeHistoryCursor(pageId, items.at(-1)!.revision) : null };
}

function applyPageHistoryDelta(snapshot: PageHistorySnapshot, delta: PageHistoryDelta): PageHistorySnapshot {
  const page = { ...snapshot.page } as Page;
  for (const [field, change] of Object.entries(delta.page)) (page as unknown as Record<string, unknown>)[field] = change.after;
  const blocks = new Map(snapshot.blocks.map((block) => [block.id, block]));
  for (const id of delta.blocks.remove) blocks.delete(id);
  for (const block of delta.blocks.upsert) blocks.set(block.id, block);
  return {
    page,
    blocks: [...blocks.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    documentRevision: delta.documentRevision,
    nativeDocument: delta.nativeDocument === undefined ? snapshot.nativeDocument : delta.nativeDocument,
    academicMetadata: delta.academicMetadata ?? snapshot.academicMetadata,
    schemaVersion: delta.schemaVersion ?? snapshot.schemaVersion,
  };
}

function reconstructPageHistory(pageId: string, revision: number): { revision: PageRevision; snapshot: PageHistorySnapshot } | null {
  ensurePageHistory(pageId);
  const targetRow = getDb().prepare(
    'SELECT * FROM page_revisions WHERE page_id = ? AND revision = ?',
  ).get(pageId, revision) as Row | undefined;
  if (!targetRow) return null;
  const base = getDb().prepare(
    `SELECT revision, snapshot_json FROM page_revisions
     WHERE page_id = ? AND revision <= ? AND snapshot_json IS NOT NULL
     ORDER BY revision DESC LIMIT 1`,
  ).get(pageId, revision) as { revision: number; snapshot_json: string } | undefined;
  if (!base) throw new Error('El historial no contiene un snapshot reconstruible.');
  let snapshot = JSON.parse(base.snapshot_json) as PageHistorySnapshot;
  const deltas = getDb().prepare(
    `SELECT delta_json FROM page_revisions WHERE page_id = ? AND revision > ? AND revision <= ? ORDER BY revision`,
  ).all(pageId, base.revision, revision) as Array<{ delta_json: string }>;
  for (const row of deltas) snapshot = applyPageHistoryDelta(snapshot, JSON.parse(row.delta_json) as PageHistoryDelta);
  return { revision: toPageRevision(targetRow), snapshot };
}

export function getPageRevision(pageId: string, revision: number): PageRevisionSnapshot | null {
  const historical = reconstructPageHistory(pageId, revision);
  if (!historical) return null;
  return {
    revision: historical.revision,
    nativeDocument: historical.snapshot.nativeDocument,
    academicMetadata: historical.snapshot.academicMetadata,
    schemaVersion: historical.snapshot.schemaVersion,
    page: historical.snapshot.page,
    blocks: historical.snapshot.blocks,
    markdown: normalizeMarkdown(pageBlocksToMarkdown(historical.snapshot.blocks.map((block) => ({
      id: block.id, parentBlockId: block.parentBlockId, order: block.order, type: block.type, content: block.content,
    })))),
  };
}

export function getPageDocument(pageId: string): PageDocument | null {
  const page = getPage(pageId);
  if (!page) return null;
  return buildDocument(page, ensureDocumentRow(page));
}

/** A companion consultation must not initialise document rows or history.
 * Legacy blocks get the same deterministic in-memory CRDT bootstrap used by
 * Desktop; a later, explicitly requested edit owns persistence. */
export function getPageDocumentReadOnly(pageId: string): PageDocument | null {
  const page = getPage(pageId);
  if (!page) return null;
  const row = getDb().prepare('SELECT * FROM page_documents WHERE page_id = ?').get(page.id) as Row | undefined;
  if (row) return buildDocument(page, row);
  const blocks = listPageBlocks(page.id).map(entry => ({id:entry.id,parentBlockId:entry.parentBlockId,order:entry.order,type:entry.type,content:entry.content}));
  const initial = emptyYDoc(page, blocks), doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, initial.state);
    return buildDocument(page, {revision:1,next_update_sequence:1,snapshot_sequence:0}, doc);
  } finally { doc.destroy(); }
}

export function getPageDocumentForRow(rowId: string): PageDocument | null {
  const page = getPageForRow(rowId);
  return page ? getPageDocument(page.id) : null;
}

export function getPageDocumentForNote(noteId: string): PageDocument | null {
  const page = getPageForNote(noteId);
  return page ? getPageDocument(page.id) : null;
}

function normalizeDrafts(pageId: string, drafts: PageBlockDraft[], native: BlockNoteDocument | null = null): Required<PageBlockDraft>[] {
  if (drafts.length > 10_000) throw new Error('Una página no puede guardar más de 10.000 bloques en una sola mutación.');
  const ids = new Set<string>();
  let nativeProjections: Map<string, PageBlockDraft> | undefined;
  const normalized = drafts.map((draft, index): Required<PageBlockDraft> => {
    const id = draft.id?.trim() || `pblk_${randomUUID()}`;
    if (ids.has(id)) throw new Error('La página contiene bloques duplicados.');
    ids.add(id);
    if (!BLOCK_TYPES.has(draft.type)) throw new Error('Tipo de bloque no válido.');
    const content = jsonObject(draft.content);
    // Validated native documents already have a 4 MB aggregate bound. Their
    // legacy projections repeat the same content in native/Markdown/cache fields.
    // Only internally generated projections may use that bounded overhead.
    const size = JSON.stringify(content).length;
    if (size > 1_000_000) {
      if (!native || size > 16_000_000) throw new Error('El contenido de un bloque supera el límite de 1 MB.');
      nativeProjections ??= new Map(blockNoteToPageBlocks(native).map(block=>[block.id!,block]));
      if (canonicalJson(content) !== canonicalJson(nativeProjections.get(id)?.content)) throw new Error('El contenido de un bloque supera el límite de 1 MB.');
    }
    return {
      id,
      parentBlockId: draft.parentBlockId ?? null,
      order: Number.isFinite(draft.order) ? Number(draft.order) : (index + 1) * 1024,
      type: draft.type,
      content,
    };
  });
  // Block identity is global. Without this explicit check SQLite's ON CONFLICT clause
  // would turn an accidental cross-page id reuse into a silent no-op, leaving the Yjs
  // projection and materialized block table inconsistent.
  const blockIds = [...ids];
  for (let start = 0; start < blockIds.length; start += 400) {
    const chunk = blockIds.slice(start, start + 400);
    if (!chunk.length) continue;
    const collision = getDb().prepare(
      `SELECT id, page_id FROM page_blocks
       WHERE id IN (${chunk.map(() => '?').join(', ')}) AND page_id <> ? LIMIT 1`,
    ).get(...chunk, pageId) as { id: string; page_id: string } | undefined;
    if (collision) throw new Error('Un identificador de bloque ya pertenece a otra página.');
  }
  const parentOf = new Map(normalized.map((entry) => [entry.id, entry.parentBlockId]));
  for (const entry of normalized) {
    if (entry.parentBlockId && !ids.has(entry.parentBlockId)) throw new Error('Un bloque hijo apunta a un padre que no existe.');
    const visited = new Set([entry.id]);
    let parent = entry.parentBlockId;
    while (parent) {
      if (visited.has(parent)) throw new Error('La jerarquía de bloques contiene un ciclo.');
      visited.add(parent);
      parent = parentOf.get(parent) ?? null;
    }
  }
  // Stable dense gaps make normal insertions fractional without rewriting neighbours.
  return normalized.map((entry, index) => ({ ...entry, order: (index + 1) * 1024 }));
}

function insertionOrder(drafts: Required<PageBlockDraft>[]): Required<PageBlockDraft>[] {
  const pending = new Map(drafts.map((entry) => [entry.id, entry]));
  const inserted = new Set<string>();
  const ordered: Required<PageBlockDraft>[] = [];
  while (pending.size) {
    let progressed = false;
    for (const [id, entry] of pending) {
      if (!entry.parentBlockId || inserted.has(entry.parentBlockId)) {
        ordered.push(entry);
        inserted.add(id);
        pending.delete(id);
        progressed = true;
      }
    }
    if (!progressed) throw new Error('No se pudo ordenar la jerarquía de bloques.');
  }
  return ordered;
}

function refreshPageLinks(pageId: string, drafts: Required<PageBlockDraft>[], timestamp: string): void {
  const db = getDb();
  db.prepare('DELETE FROM page_links WHERE source_page_id = ?').run(pageId);
  const insert = db.prepare(
    `INSERT INTO page_links
      (id, source_page_id, source_block_id, target_page_id, target_block_id, kind, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const entry of drafts) {
    if (entry.type !== 'subpage' && entry.type !== 'mention' && entry.type !== 'synced_block') continue;
    const targetPageId = entry.type === 'synced_block'
      ? (db.prepare('SELECT page_id FROM page_blocks WHERE id = ? AND trashed_at IS NULL').get(String(entry.content.sourceBlockId ?? '')) as { page_id: string } | undefined)?.page_id ?? null
      : String(entry.content.pageId ?? '').trim() || null;
    const targetBlockId = entry.type === 'synced_block' ? String(entry.content.sourceBlockId ?? '').trim() || null : null;
    const label = String(entry.content.title ?? entry.content.label ?? '').trim();
    const targetIdentity = targetBlockId ?? targetPageId ?? 'broken';
    insert.run(sha256(`${pageId}\0${entry.id}\0${entry.type}\0${targetIdentity}`), pageId, entry.id,
      targetPageId, targetBlockId, entry.type, label, timestamp);
  }
}

function materializeBlocks(pageId: string, drafts: Required<PageBlockDraft>[], actor: string, timestamp: string): void {
  const db = getDb();
  const existing = new Map(
    (db.prepare('SELECT id, created_at, created_by FROM page_blocks WHERE page_id = ?').all(pageId) as Array<{
      id: string; created_at: string; created_by: string;
    }>).map((row) => [row.id, row]),
  );
  const upsert = db.prepare(
    `INSERT INTO page_blocks
      (id, page_id, parent_block_id, sort_order, type, content_json, normalized_text,
       revision, created_by, updated_by, created_at, updated_at, trashed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       parent_block_id = excluded.parent_block_id,
       sort_order = excluded.sort_order,
       type = excluded.type,
       content_json = excluded.content_json,
       normalized_text = excluded.normalized_text,
       revision = page_blocks.revision + 1,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at,
       trashed_at = NULL
     WHERE page_blocks.page_id = excluded.page_id`,
  );
  const linkBlob = db.prepare(
    `INSERT OR IGNORE INTO page_block_blobs (block_id, blob_hash, role, created_at)
     SELECT ?, ?, 'content', ? WHERE EXISTS (SELECT 1 FROM db_blobs WHERE hash = ?)`,
  );
  const unlinkBlobs = db.prepare('DELETE FROM page_block_blobs WHERE block_id = ?');
  for (const entry of insertionOrder(drafts)) {
    const previous = existing.get(entry.id);
    upsert.run(
      entry.id, pageId, entry.parentBlockId, entry.order, entry.type, JSON.stringify(entry.content),
      pageBlockNormalizedText(entry.type, entry.content), previous?.created_by ?? actor, actor,
      previous?.created_at ?? timestamp, timestamp,
    );
    unlinkBlobs.run(entry.id);
    const blobHash = typeof entry.content.blobHash === 'string' ? entry.content.blobHash : '';
    if (/^[0-9a-f]{64}$/.test(blobHash)) linkBlob.run(entry.id, blobHash, timestamp, blobHash);
  }
  const keep = new Set(drafts.map((entry) => entry.id));
  const remove = db.prepare('DELETE FROM page_blocks WHERE page_id = ? AND id = ?');
  for (const id of existing.keys()) if (!keep.has(id)) remove.run(pageId, id);
  refreshPageLinks(pageId, drafts, timestamp);
}

function updateLegacyNoteCache(page: Page, markdown: string, markdownHash: string, timestamp: string): void {
  if (!page.noteId) return;
  getDb().prepare(
    'UPDATE notes SET content = ?, page_markdown_hash = ?, updated_at = ? WHERE id = ?',
  ).run(markdown, markdownHash, timestamp, page.noteId);
}

function persistDocument(
  page: Page,
  documentRow: Row,
  doc: Y.Doc,
  update: Uint8Array,
  drafts: Required<PageBlockDraft>[],
  actor: string,
  history: {
    before: PageHistorySnapshot;
    reason: string;
    restoredFromRevision?: number | null;
    record?: boolean;
  },
): PageDocument {
  const db = getDb();
  const timestamp = now();
  const sequence = Number(documentRow.next_update_sequence);
  const nextRevision = Number(documentRow.revision) + 1;
  const native=readPageNativeDocument(doc);
  const markdown = normalizeMarkdown(native?academicMarkdownProjection(native,readPageAcademicMetadata(doc)):pageBlocksToMarkdown(drafts));
  const markdownHash = sha256(markdown);
  const nextCount = Number(documentRow.update_count) + 1;
  materializeBlocks(page.id, drafts, actor, timestamp);
  db.prepare(
    `INSERT INTO page_document_updates
      (id, page_id, sequence_no, update_blob, actor_id, client_id, created_at, update_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), page.id, sequence, Buffer.from(update), actor, `local:${process.pid}`, timestamp, sha256(update));
  db.prepare(
    `UPDATE page_documents SET revision = ?, next_update_sequence = ?, state_vector = ?,
       markdown_hash = ?, update_count = ?, updated_at = ? WHERE page_id = ?`,
  ).run(nextRevision, sequence + 1, Buffer.from(Y.encodeStateVector(doc)), markdownHash, nextCount, timestamp, page.id);
  db.prepare(
    `UPDATE pages SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?`,
  ).run(actor, timestamp, page.id);
  updateLegacyNoteCache(page, markdown, markdownHash, timestamp);

  if (nextCount >= COMPACT_EVERY) {
    const state = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    db.prepare(
      `INSERT INTO page_document_snapshots
        (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), page.id, sequence, nextRevision, Buffer.from(state), Buffer.from(vector), markdownHash, timestamp);
    db.prepare(
      `UPDATE page_documents SET snapshot_sequence = ?, snapshot_blob = ?, state_vector = ?, update_count = 0
       WHERE page_id = ?`,
    ).run(sequence, Buffer.from(state), Buffer.from(vector), page.id);
    db.prepare('DELETE FROM page_document_updates WHERE page_id = ? AND sequence_no <= ?').run(page.id, sequence);
  }
  if (history.record !== false) {
    recordPageHistory(page.id, history.before, actor, history.reason, history.restoredFromRevision ?? null, doc);
  }
  // The transaction already holds the up-to-date Y.Doc. Replaying all persisted
  // updates again for history and the response needlessly blocks Electron's loop.
  const savedPage = getPage(page.id)!;
  return buildDocument(savedPage, ensureDocumentRow(savedPage), doc);
}

export function savePageDocument(input: SavePageDocumentInput): PageMutationResult {
  const db = getDb();
  return db.transaction((): PageMutationResult => {
    const page = getPage(input.pageId);
    if (!page) throw new Error('La página no existe.');
    if (page.locked) throw new Error('La página está bloqueada.');
    const documentRow = ensureDocumentRow(page);
    if (Number(documentRow.revision) !== input.expectedRevision) {
      return {
        ok: false,
        conflict: {
          kind: 'revision_conflict', pageId: page.id, expectedRevision: input.expectedRevision,
          actualRevision: Number(documentRow.revision), current: buildDocument(page, documentRow),
        },
      };
    }
    const doc = loadYDoc(documentRow);
    const before = capturePageHistorySnapshot(page.id, doc);
    ensurePageHistory(page.id, before);
    const native = input.nativeDocument == null ? input.nativeDocument : validateBlockNoteDocument(input.nativeDocument);
    const drafts = normalizeDrafts(page.id, native ? blockNoteToPageBlocks(native) : input.blocks, native);
    const vector = Y.encodeStateVector(doc);
    writePageYDocument(doc, page.title, drafts, native, input.schemaVersion, input.academicMetadata);
    const update = Y.encodeStateAsUpdate(doc, vector);
    return { ok: true, document: persistDocument(page, documentRow, doc, update, drafts, input.actorId ?? 'local', {
      before, reason: input.reason ?? 'content',
    }) };
  })();
}

export function applyPageDocumentUpdate(
  pageId: string,
  update: Uint8Array,
  expectedRevision: number,
  actor = 'remote',
): PageMutationResult {
  const db = getDb();
  return db.transaction((): PageMutationResult => {
    const page = getPage(pageId);
    if (!page) throw new Error('La página no existe.');
    const documentRow = ensureDocumentRow(page);
    if (Number(documentRow.revision) !== expectedRevision) {
      return { ok: false, conflict: {
        kind: 'revision_conflict', pageId, expectedRevision, actualRevision: Number(documentRow.revision),
        current: buildDocument(page, documentRow),
      } };
    }
    const before = capturePageHistorySnapshot(page.id);
    ensurePageHistory(page.id, before);
    const doc = loadYDoc(documentRow);
    Y.applyUpdate(doc, update, actor);
    const projected = readPageYDocument(doc);
    const incomingNative = readPageNativeDocument(doc);
    const nativeChanged = JSON.stringify(incomingNative) !== JSON.stringify(before.nativeDocument ?? null);
    const drafts = normalizeDrafts(pageId, nativeChanged && incomingNative ? blockNoteToPageBlocks(incomingNative) : projected.blocks, incomingNative);
    const vector = Y.encodeStateVector(doc);
    writePageYDocument(doc, projected.title, drafts, nativeChanged ? incomingNative : undefined, Number(doc.getMap('editor').get('schemaVersion')) || 1);
    const reconciliation = Y.encodeStateAsUpdate(doc, vector);
    return { ok: true, document: persistDocument(page, documentRow, doc, Y.mergeUpdates([update, reconciliation]), drafts, actor, {
      before, reason: 'remote-update',
    }) };
  })();
}

export function createPage(input: CreatePageInput = {}): PageDocument {
  const db = getDb();
  const id = `page_${randomUUID()}`;
  const timestamp = now();
  const actor = input.actorId ?? 'local';
  const parent = input.parentPageId ? getPage(input.parentPageId) : null;
  if (input.parentPageId && !parent) throw new Error('La página padre no existe.');
  db.prepare(
    `INSERT INTO pages
      (id, row_id, note_id, parent_page_id, origin, title, icon, state, locked, full_width,
       revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, 'standalone', ?, ?, 'active', 0, 0, 1, ?, ?, ?, ?)`,
  ).run(id, input.parentPageId ?? null, input.title?.trim() || 'Página sin título', input.icon ?? null, actor, actor, timestamp, timestamp);
  const page = getPage(id)!;
  const blocks = normalizeDrafts(id, input.blocks?.length ? input.blocks : [{ type: 'paragraph', content: { text: '' } }]);
  materializeBlocks(id, blocks, actor, timestamp);
  const yjs = emptyYDoc(page, blocks);
  const markdown = normalizeMarkdown(pageBlocksToMarkdown(blocks));
  const markdownHash = sha256(markdown);
  db.prepare(
    `INSERT INTO page_documents
      (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
       markdown_hash, update_count, created_at, updated_at)
     VALUES (?, 1, 0, 1, ?, ?, ?, 0, ?, ?)`,
  ).run(id, Buffer.from(yjs.state), Buffer.from(yjs.vector), markdownHash, timestamp, timestamp);
  db.prepare(
    `INSERT INTO page_document_snapshots
      (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?)`,
  ).run(randomUUID(), id, Buffer.from(yjs.state), Buffer.from(yjs.vector), markdownHash, timestamp);
  ensurePageHistory(id);
  return getPageDocument(id)!;
}

export function updatePage(
  id: string,
  patch: { title?: string; icon?: string | null; coverBlobHash?: string | null; fullWidth?: boolean; locked?: boolean },
  expectedRevision: number,
  actor = 'local',
): Page | null {
  const page = getPage(id);
  if (!page) return null;
  if (page.revision !== expectedRevision) throw new Error(`Conflicto de revisión: se esperaba ${expectedRevision} y existe ${page.revision}.`);
  const before = capturePageHistorySnapshot(id);
  ensurePageHistory(id, before);
  const title = patch.title === undefined ? page.title : patch.title.trim() || 'Página sin título';
  const timestamp = now();
  getDb().transaction(() => {
    getDb().prepare(
      `UPDATE pages SET title = ?, icon = ?, cover_blob_hash = ?, full_width = ?, locked = ?, revision = revision + 1,
       updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`,
    ).run(
      title, patch.icon === undefined ? page.icon : patch.icon,
      patch.coverBlobHash === undefined ? page.coverBlobHash : patch.coverBlobHash,
      patch.fullWidth === undefined ? Number(page.fullWidth) : Number(patch.fullWidth),
      patch.locked === undefined ? Number(page.locked) : Number(patch.locked), actor, timestamp, id, expectedRevision,
    );
    if (page.noteId) getDb().prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?').run(title, timestamp, page.noteId);
    if (page.rowId) {
      const titleColumn = getDb().prepare(
        `SELECT col.id, row.database_id FROM db_rows row JOIN db_columns col ON col.database_id = row.database_id
         WHERE row.id = ? AND col.type = 'title' ORDER BY col.position, col.id LIMIT 1`,
      ).get(page.rowId) as { id: string; database_id: string } | undefined;
      if (titleColumn) {
        getDb().prepare(
          `INSERT INTO db_cells
            (database_id, row_id, column_id, value_type, value_text, revision, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, 'text', ?, 1, ?, ?, ?, ?)
           ON CONFLICT(row_id, column_id) DO UPDATE SET value_type = 'text', value_text = excluded.value_text,
             revision = db_cells.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        ).run(titleColumn.database_id, page.rowId, titleColumn.id, title, actor, actor, timestamp, timestamp);
      }
    }
  })();
  recordPageHistory(id, before, actor, 'metadata');
  return getPage(id);
}

export function movePage(id: string, parentPageId: string | null, expectedRevision: number, actor = 'local'): Page {
  const db = getDb();
  const page = getPage(id);
  if (!page) throw new Error('La página no existe.');
  if (page.revision !== expectedRevision) throw new Error(`Conflicto de revisión: se esperaba ${expectedRevision} y existe ${page.revision}.`);
  const before = capturePageHistorySnapshot(id);
  ensurePageHistory(id, before);
  if (parentPageId === id) throw new Error('Una página no puede contenerse a sí misma.');
  if (parentPageId) {
    const parent = getPage(parentPageId);
    if (!parent || parent.state !== 'active') throw new Error('La página padre no existe o está en la papelera.');
    const cycle = db.prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM pages WHERE parent_page_id = ?
         UNION ALL SELECT page.id FROM pages page JOIN descendants ON page.parent_page_id = descendants.id
       ) SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1`,
    ).get(id, parentPageId) as { found: number } | undefined;
    if (cycle) throw new Error('El movimiento crearía un ciclo en el árbol de páginas.');
  }
  const timestamp = now();
  const result = db.prepare(
    `UPDATE pages SET parent_page_id = ?, revision = revision + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND revision = ?`,
  ).run(parentPageId, actor, timestamp, id, expectedRevision);
  if (result.changes !== 1) throw new Error('La página cambió mientras se movía.');
  recordPageHistory(id, before, actor, 'move');
  return getPage(id)!;
}

export function setPageFavorite(id: string, favorite: boolean): void {
  const db = getDb();
  if (!getPage(id)) throw new Error('La página no existe.');
  if (!favorite) { db.prepare('DELETE FROM page_favorites WHERE page_id = ?').run(id); return; }
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM page_favorites').get() as { position: number }).position);
  db.prepare('INSERT INTO page_favorites (page_id, position, created_at) VALUES (?, ?, ?) ON CONFLICT(page_id) DO NOTHING')
    .run(id, position, now());
}

export function setPageState(id: string, state: 'active' | 'trashed', expectedRevision: number, actor = 'local'): Page[] {
  const db = getDb();
  return db.transaction(() => {
    const page = getPage(id);
    if (!page) throw new Error('La página no existe.');
    if (page.revision !== expectedRevision) throw new Error(`Conflicto de revisión: se esperaba ${expectedRevision} y existe ${page.revision}.`);
    const timestamp = now();
    if (state === 'active' && page.parentPageId) {
      const parent = getPage(page.parentPageId);
      if (!parent || parent.state !== 'active') db.prepare('UPDATE pages SET parent_page_id = NULL WHERE id = ?').run(id);
    }
    const affected = db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pages WHERE id = ?
         UNION ALL SELECT page.id FROM pages page JOIN subtree ON page.parent_page_id = subtree.id
       )
       SELECT id FROM subtree`,
    ).all(id) as Array<{ id: string }>;
    const previous = new Map(affected.map((entry) => [entry.id, capturePageHistorySnapshot(entry.id)]));
    for (const [pageId, snapshot] of previous) ensurePageHistory(pageId, snapshot);
    const update = db.prepare(
      `UPDATE pages SET state = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ?`,
    );
    for (const entry of affected) {
      update.run(state, actor, timestamp, entry.id);
      const changed = getPage(entry.id)!;
      if (changed.noteId) db.prepare('UPDATE notes SET trashed_at = ?, updated_at = ? WHERE id = ?')
        .run(state === 'trashed' ? timestamp : null, timestamp, changed.noteId);
      recordPageHistory(entry.id, previous.get(entry.id)!, actor, state === 'trashed' ? 'trash' : 'restore-trash');
    }
    return affected.map((entry) => getPage(entry.id)!).filter(Boolean);
  })();
}

export function replacePageFromMarkdown(
  pageId: string,
  markdown: string,
  expectedRevision: number,
  actor = 'local',
): PageMutationResult {
  const previous = getPageDocument(pageId)?.nativeDocument;
  const native = previous ? markdownToBlockNote(markdown, previous) : undefined;
  return savePageDocument({
    pageId,
    expectedRevision,
    blocks: markdownToPageBlocks(markdown),
    nativeDocument: native,
    actorId: actor,
    reason: 'markdown-import',
  });
}

export function restorePageRevision(
  pageId: string,
  revision: number,
  expectedDocumentRevision: number,
  actor = 'local',
): PageMutationResult {
  const db = getDb();
  return db.transaction((): PageMutationResult => {
    const page = getPage(pageId);
    if (!page) throw new Error('La página no existe.');
    const documentRow = ensureDocumentRow(page);
    if (Number(documentRow.revision) !== expectedDocumentRevision) {
      return { ok: false, conflict: {
        kind: 'revision_conflict', pageId, expectedRevision: expectedDocumentRevision,
        actualRevision: Number(documentRow.revision), current: buildDocument(page, documentRow),
      } };
    }
    const historical = reconstructPageHistory(pageId, revision);
    if (!historical) throw new Error('La versión solicitada no existe.');
    const before = capturePageHistorySnapshot(pageId);
    ensurePageHistory(pageId, before);
    const target = historical.snapshot;
    const native = target.nativeDocument ? validateBlockNoteDocument(target.nativeDocument) : null;
    const drafts = normalizeDrafts(pageId, native ? blockNoteToPageBlocks(native) : target.blocks.filter((block) => block.trashedAt == null).map((block) => ({
      id: block.id, parentBlockId: block.parentBlockId, order: block.order,
      type: block.type, content: block.content,
    })), native);
    const doc = loadYDoc(documentRow);
    const vector = Y.encodeStateVector(doc);
    writePageYDocument(doc, target.page.title, drafts, target.nativeDocument ?? null, target.schemaVersion, target.academicMetadata);
    const update = Y.encodeStateAsUpdate(doc, vector);
    persistDocument(page, documentRow, doc, update, drafts, actor, {
      before, reason: 'restore-revision', restoredFromRevision: revision, record: false,
    });

    const timestamp = now();
    let parentPageId = target.page.parentPageId;
    if (parentPageId && !getPage(parentPageId)) parentPageId = null;
    // Update legacy owners first because their compatibility triggers also project into
    // pages. The final page write wins without adding another logical revision.
    if (page.noteId) {
      db.prepare('UPDATE notes SET title = ?, trashed_at = ?, updated_at = ? WHERE id = ?').run(
        target.page.title, target.page.state === 'trashed' ? timestamp : null, timestamp, page.noteId,
      );
    }
    if (page.rowId) {
      const titleColumn = db.prepare(
        `SELECT col.id, row.database_id FROM db_rows row JOIN db_columns col ON col.database_id = row.database_id
         WHERE row.id = ? AND col.type = 'title' ORDER BY col.position, col.id LIMIT 1`,
      ).get(page.rowId) as { id: string; database_id: string } | undefined;
      if (titleColumn) db.prepare(
        `INSERT INTO db_cells
          (database_id, row_id, column_id, value_type, value_text, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'text', ?, 1, ?, ?, ?, ?)
         ON CONFLICT(row_id, column_id) DO UPDATE SET value_type = 'text', value_text = excluded.value_text,
           revision = db_cells.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).run(titleColumn.database_id, page.rowId, titleColumn.id, target.page.title, actor, actor, timestamp, timestamp);
    }
    db.prepare(
      `UPDATE pages SET parent_page_id = ?, title = ?, icon = ?, cover_blob_hash = ?, state = ?,
         locked = ?, full_width = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).run(
      parentPageId, target.page.title, target.page.icon, target.page.coverBlobHash, target.page.state,
      Number(target.page.locked), Number(target.page.fullWidth), actor, timestamp, pageId,
    );
    recordPageHistory(pageId, before, actor, 'restore-revision', revision);
    return { ok: true, document: getPageDocument(pageId)! };
  })();
}

/** Keep the legacy notes.content cache and its universal page projection provably equal. */
export function synchronizeNotePage(noteId: string, title: string, markdown: string): PageDocument {
  let page = getPageForNote(noteId);
  if (!page) {
    const note = getDb().prepare('SELECT created_at, updated_at, trashed_at FROM notes WHERE id = ?').get(noteId) as Row | undefined;
    if (!note) throw new Error('La nota no existe.');
    getDb().prepare(
      `INSERT INTO pages
        (id, note_id, origin, title, state, revision, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'note', ?, ?, 1, 'local', 'local', ?, ?)`,
    ).run(`note:${noteId}`, noteId, title, note.trashed_at ? 'trashed' : 'active', note.created_at, note.updated_at);
    page = getPageForNote(noteId)!;
  }
  const current = getPageDocument(page.id)!;
  const result = replacePageFromMarkdown(page.id, markdown, current.revision, 'legacy-note-adapter');
  if (!result.ok) return result.conflict.current;
  return result.document;
}

export function reconcileLegacyNoteCache(noteId: string): PageDocument {
  const note = getDb().prepare(
    'SELECT title, content, page_markdown_hash, updated_at FROM notes WHERE id = ?',
  ).get(noteId) as { title: string; content: string; page_markdown_hash: string | null; updated_at: string } | undefined;
  if (!note) throw new Error('La nota no existe.');
  const page = getPageForNote(noteId);
  if (!page) return synchronizeNotePage(noteId, note.title, note.content);
  const document = getPageDocument(page.id)!;
  const legacyHash = sha256(normalizeMarkdown(note.content));
  if (note.page_markdown_hash && legacyHash !== note.page_markdown_hash && note.updated_at >= page.updatedAt) {
    return synchronizeNotePage(noteId, note.title, note.content);
  }
  if (legacyHash !== document.markdownHash || note.page_markdown_hash !== document.markdownHash) {
    getDb().prepare('UPDATE notes SET content = ?, page_markdown_hash = ? WHERE id = ?')
      .run(document.markdown, document.markdownHash, noteId);
  }
  return document;
}

export function storePageAsset(input: { name: string; mimeType?: string | null; bytes: Uint8Array }): PageAsset {
  const data = Buffer.from(input.bytes);
  const blobHash = sha256(data);
  const timestamp = now();
  getDb().prepare(
    `INSERT INTO db_blobs
      (hash, bytes, mime_type, data, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'local', 'local', ?, ?)
     ON CONFLICT(hash) DO NOTHING`,
  ).run(blobHash, data.length, input.mimeType ?? null, data, timestamp, timestamp);
  return { blobHash, name: input.name || 'archivo', mimeType: input.mimeType ?? null, bytes: data.length };
}

export function getPageAsset(blobHash: string): Uint8Array | null {
  const row = getDb().prepare('SELECT data FROM db_blobs WHERE hash = ?').get(blobHash) as { data: Uint8Array } | undefined;
  return row ? new Uint8Array(row.data) : null;
}

export function exportPageMarkdown(pageId: string): { title: string; markdown: string; markdownHash: string } | null {
  const document = getPageDocument(pageId);
  return document ? { title: document.page.title, markdown: document.markdown, markdownHash: document.markdownHash } : null;
}

/** One bounded SQL projection used by database exports; never opens one Y.Doc per row. */
export function pageMarkdownForDatabaseRows(rowIds: string[]): Map<string, string> {
  const unique = [...new Set(rowIds)].filter(Boolean);
  const result = new Map(unique.map((id) => [id, '']));
  if (!unique.length) return result;
  const placeholders = unique.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT page.row_id, block.type, block.content_json, block.parent_block_id, block.sort_order
     FROM pages page
     JOIN page_blocks block ON block.page_id = page.id AND block.trashed_at IS NULL
     WHERE page.row_id IN (${placeholders})
     ORDER BY page.row_id, block.sort_order, block.id`,
  ).all(...unique) as Array<{
    row_id: string; type: PageBlockType; content_json: string; parent_block_id: string | null; sort_order: number;
  }>;
  const grouped = new Map<string, PageBlockDraft[]>();
  for (const row of rows) {
    const list = grouped.get(row.row_id) ?? [];
    list.push({ type: row.type, content: parseJson(row.content_json), parentBlockId: row.parent_block_id, order: row.sort_order });
    grouped.set(row.row_id, list);
  }
  for (const [rowId, blocks] of grouped) result.set(rowId, normalizeMarkdown(pageBlocksToMarkdown(blocks)));
  return result;
}
