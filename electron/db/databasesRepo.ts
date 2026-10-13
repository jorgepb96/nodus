// "Databases" mode store: Notion-like databases with typed columns and EAV cells.
// All typed meaning lives in shared/databases.ts — this repo only moves strings in
// and out of SQLite. Everything is per-vault (one DB file per vault) so it travels
// in backups and .nodussync with no extra plumbing.

import { getDb } from './database';
import { searchEntitiesAcrossVaults, resolveEntityLabel } from './crossVault';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { databaseCellRaw, databaseCellStorage, type DatabaseCellStorageRecord, type DatabaseCellStorageValues } from '@shared/databaseCellStorage';
import {
  newDatabaseShortId,
  normalizeCellValue,
  decodeMultiSelect,
  encodeMultiSelect,
  columnTypeDef,
  entryPercent,
  aggregateRollup,
  rollupResultKind,
  type RollupFunction,
} from '@shared/databases';
import { splitMultiValue, normalizeCsvValue, typeStoresImportedText } from '@shared/databaseCsv';
import { comparisonMajorityValue, comparisonSourceColumns } from '@shared/databaseComparison';
import {
  applyColorRules,
  evaluateFormula,
  orderFormulaColumns,
  type ColumnStats,
} from '@shared/databaseFormulaEval';
import { formulaDependencies, formulaResultKind, formulaValueKind, validateFormula, type FormulaSpec } from '@shared/databaseFormula';
import type { FormulaRuntimeValue } from '@shared/databaseFormulaExpression';
import { formulaExpressionGlobalStatDependencies, formulaExpressionRelations } from '@shared/databaseFormulaExpression';
import {
  operatorsForColumn,
  type DatabaseFilterState,
  type DatabaseSavedView,
  type DatabaseViewRevision,
  type SavedViewInput,
  type SavedViewPatch,
  type SortRule,
} from '@shared/databaseFilters';
import {
  DATABASE_VIEW_CONFIG_VERSION,
  legacyFilterFromViewConfig,
  normalizeDatabaseViewConfig,
  type DatabaseViewConfig,
} from '@shared/databaseViewConfig';
import { comparableType } from '@shared/databaseFormula';
import {
  decodeDatabaseDate,
  encodeDatabaseDate,
  encodeDatabasePeople,
  formatUniqueDatabaseId,
  isReadOnlyDatabaseProperty,
} from '@shared/databaseProperties';
import {
  DATABASE_ROW_CURSOR_VERSION,
  assertFilterNode,
  clampDatabaseRowPageLimit,
  databaseFilterStateToNode,
  type DatabaseRowCursorPayload,
  type DatabaseRowPage,
  type DatabaseRowQuery,
  type DatabaseRowSearchPage,
  type DatabaseRowSearchQuery,
  type FilterNode,
  type GroupRule,
} from '@shared/databaseQuery';
import {
  DATABASE_BULK_CELL_LIMIT,
  type DatabaseAggregateQuery,
  type DatabaseAggregateResult,
  type DatabaseBulkEditInput,
  type DatabaseBulkEditResult,
} from '@shared/databaseTableOps';
import {
  DATABASE_TEMPORAL_EVENT_LIMIT,
  expandDatabaseDateOccurrences,
  resolveDatabaseZonedDate,
  type DatabaseTemporalEvent,
  type DatabaseTemporalEventPage,
  type DatabaseTemporalQuery,
  type DatabaseTemporalRangeUpdate,
  type DatabaseTemporalRangeUpdateResult,
} from '@shared/databaseTemporal';
import {
  DATABASE_CHART_POINT_LIMIT,
  DATABASE_FEED_LIMIT,
  DATABASE_MAP_MARKER_LIMIT,
  type DatabaseChartPoint,
  type DatabaseChartQuery,
  type DatabaseChartResult,
  type DatabaseFeedItem,
  type DatabaseFeedQuery,
  type DatabaseFeedResult,
  type DatabaseMapMarker,
  type DatabaseMapQuery,
  type DatabaseMapResult,
} from '@shared/databaseVisualization';
import {
  DATABASE_CONTAINER_CURSOR_VERSION,
  automaticDatabaseSourcePropertyMap,
  clampDatabaseContainerLimit,
  combinedDatabaseContainerFilter,
  type AttachDatabaseViewSourceInput,
  type DatabaseContainerDefinition,
  type DatabaseContainerProperty,
  type DatabaseContainerRow,
  type DatabaseContainerRowPage,
  type DatabaseContainerRowQuery,
  type DatabaseDataSource,
  type DatabaseViewDataSource,
} from '@shared/databaseSources';
import type {
  DatabaseAttachment,
  DatabaseColumn,
  DatabaseColumnConfig,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRelation,
  DatabaseRow,
  DatabaseRowHit,
  DatabaseRowSort,
  DatabaseSearchHit,
  DatabaseSelectOption,
  DatabaseSummary,
  RelationTarget,
  RelationTargetKind,
} from '@shared/databases';

export type { DatabaseRowSort };

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

interface StoredCellRow extends DatabaseCellStorageRecord {
  database_id?: string;
  row_id?: string;
  column_id?: string;
}

const STORED_CELL_COLUMNS = 'value_text, value_number, value_integer, value_date, value_json, value_reference';

function storedCellRaw(row: StoredCellRow): string | null {
  return databaseCellRaw(row);
}

function cellContext(rowId: string, columnId: string): { databaseId: string; columnType: DatabaseColumnType } | null {
  const row = getDb().prepare('SELECT database_id FROM db_rows WHERE id = ?').get(rowId) as { database_id: string } | undefined;
  const column = getDb().prepare('SELECT database_id, type FROM db_columns WHERE id = ?').get(columnId) as
    | { database_id: string; type: DatabaseColumnType }
    | undefined;
  if (!row || !column) return null;
  if (row.database_id !== column.database_id) {
    throw new Error('La fila y la propiedad pertenecen a bases de datos distintas.');
  }
  return { databaseId: row.database_id, columnType: columnTypeDef(column.type).id };
}

function writeStoredCell(
  rowId: string,
  columnId: string,
  databaseId: string,
  columnType: DatabaseColumnType,
  raw: string,
  actor = 'local',
): void {
  const db = getDb();
  const storage = databaseCellStorage(columnType, raw);
  const timestamp = now();
  db.prepare(
    `INSERT INTO db_cells
      (database_id, row_id, column_id, value_type, value_text, value_number, value_integer,
       value_date, value_json, value_reference, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(row_id, column_id) DO UPDATE SET
       database_id = excluded.database_id,
       value_type = excluded.value_type,
       value_text = excluded.value_text,
       value_number = excluded.value_number,
       value_integer = excluded.value_integer,
       value_date = excluded.value_date,
       value_json = excluded.value_json,
       value_reference = excluded.value_reference,
       revision = db_cells.revision + 1,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).run(
    databaseId, rowId, columnId, storage.value_type, storage.value_text,
    storage.value_number, storage.value_integer, storage.value_date, storage.value_json,
    storage.value_reference, actor, actor, timestamp, timestamp,
  );
  reindexCellSearch(rowId, columnId);
}

function retypeColumnCells(columnId: string, databaseId: string, type: DatabaseColumnType): void {
  const db = getDb();
  if (isReadOnlyDatabaseProperty(type) || type === 'files') {
    db.prepare('DELETE FROM db_cells WHERE database_id = ? AND column_id = ?').run(databaseId, columnId);
    return;
  }
  const rows = db.prepare(
    `SELECT row_id, ${STORED_CELL_COLUMNS} FROM db_cells WHERE database_id = ? AND column_id = ?`,
  ).all(databaseId, columnId) as Array<StoredCellRow & { row_id: string }>;
  for (const row of rows) {
    const raw = storedCellRaw(row);
    if (raw != null) writeStoredCell(row.row_id, columnId, databaseId, type, raw);
  }
}

function ensurePrimaryTitle(databaseId: string): void {
  const db = getDb();
  const columns = db.prepare(
    'SELECT id, type FROM db_columns WHERE database_id = ? ORDER BY position, created_at, id',
  ).all(databaseId) as Array<{ id: string; type: DatabaseColumnType }>;
  const titles = columns.filter((column) => column.type === 'title');
  const timestamp = now();
  if (titles.length === 0) {
    const candidate = columns.find((column) => ![
      'attachment', 'files', 'ai_image', 'relation', 'rollup', 'created_by', 'last_edited_by',
      'created_time', 'last_edited_time', 'unique_id', 'button',
    ].includes(column.type));
    if (candidate) {
      db.prepare(
        "UPDATE db_columns SET type = 'title', revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?",
      ).run(timestamp, candidate.id);
      retypeColumnCells(candidate.id, databaseId, 'title');
    } else {
      db.prepare('UPDATE db_columns SET position = position + 1 WHERE database_id = ?').run(databaseId);
      db.prepare(
        `INSERT INTO db_columns
          (id, database_id, name, type, position, config_json, created_at, updated_at, revision, created_by, updated_by)
         VALUES (?, ?, 'Nombre', 'title', 0, '{}', ?, ?, 1, 'local', 'local')`,
      ).run(newId('dcol'), databaseId, timestamp, timestamp);
    }
  } else if (titles.length > 1) {
    for (const title of titles.slice(1)) {
      db.prepare(
        "UPDATE db_columns SET type = 'text', revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?",
      ).run(timestamp, title.id);
      retypeColumnCells(title.id, databaseId, 'text');
    }
  }
}

// ── Databases ────────────────────────────────────────────────────────────────

interface DatabaseRowMeta {
  id: string;
  short_id: string;
  name: string;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function rowToSummary(row: DatabaseRowMeta, rowCount: number): DatabaseSummary {
  return {
    id: row.id,
    shortId: row.short_id,
    name: row.name,
    icon: row.icon,
    position: row.position,
    rowCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Generate a short id not already taken (retries on the rare collision). */
function uniqueShortId(): string {
  const db = getDb();
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = newDatabaseShortId();
    const clash = db.prepare('SELECT 1 FROM db_databases WHERE short_id = ?').get(candidate);
    if (!clash) return candidate;
  }
  // Astronomically unlikely; fall back to a uuid-tail suffix.
  return `DB-${uuid().slice(0, 6).toUpperCase()}`;
}

export function createDatabase(name: string, icon: string | null = null, identity?:string): DatabaseSummary {
  const db = getDb();
  const id = identity ?? newId('db');
  const ts = now();
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_databases').get() as { n: number }).n;
  const normalizedName = name.trim() || 'Base de datos';
  db.transaction(() => {
    db.prepare(
      'INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, uniqueShortId(), normalizedName, icon, position, ts, ts);
    db.prepare(
      `INSERT INTO db_data_sources
        (id, database_id, name, kind, revision, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, 'local_database', 1, 'local', 'local', ?, ?)`,
    ).run(newId('dsrc'), id, normalizedName, ts, ts);
  })();
  return getDatabase(id)!;
}

function rowCountOf(databaseId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM db_rows WHERE database_id = ?').get(databaseId) as { c: number }).c;
}

export function getDatabase(id: string): DatabaseSummary | null {
  const row = getDb().prepare('SELECT * FROM db_databases WHERE id = ?').get(id) as DatabaseRowMeta | undefined;
  return row ? rowToSummary(row, rowCountOf(id)) : null;
}

export function listDatabases(): DatabaseSummary[] {
  const rows = getDb().prepare('SELECT * FROM db_databases ORDER BY position, created_at').all() as DatabaseRowMeta[];
  return rows.map((r) => rowToSummary(r, rowCountOf(r.id)));
}

/** Turn arbitrary user text into a quoted, prefix-enabled FTS5 AND query. */
function ftsQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 32)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
}

function searchRevision(): string {
  const rows = getDb().prepare('SELECT id, revision FROM db_databases ORDER BY id').all() as Array<{ id: string; revision: number }>;
  const pages = getDb().prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(revision), 0) AS revisions,
            COALESCE(MAX(updated_at), '') AS updated FROM page_blocks WHERE trashed_at IS NULL`,
  ).get() as { count: number; revisions: number; updated: string };
  return createHash('sha256')
    .update(`${rows.map((row) => `${row.id}:${row.revision}`).join('|')}|pages:${pages.count}:${pages.revisions}:${pages.updated}`)
    .digest('base64url').slice(0, 24);
}

/** Refresh a cell's FTS projection, resolving option ids to the labels users see. */
function reindexCellSearch(rowId: string, columnId: string): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM db_search_fts WHERE rowid = COALESCE(
       (SELECT rowid FROM db_cells WHERE row_id = ? AND column_id = ?), -9223372036854775808
     )`,
  ).run(rowId, columnId);
  db.prepare(
    `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
     SELECT cell.rowid, CASE
              WHEN col.type = 'select' THEN COALESCE(
                (SELECT option.label FROM db_select_options option
                 WHERE option.id = COALESCE(cell.value_reference, cell.value_text)), cell.value_text, '')
              WHEN col.type = 'multi_select' AND json_valid(COALESCE(cell.value_json, cell.value_text)) THEN COALESCE(
                (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                 FROM json_each(COALESCE(cell.value_json, cell.value_text)) item
                 LEFT JOIN db_select_options option ON option.id = item.value), cell.value_text, '')
              ELSE COALESCE(cell.value_text, '')
            END,
            'cell', cell.database_id, cell.row_id, cell.column_id, cell.row_id || ':' || cell.column_id
     FROM db_cells cell
     JOIN db_columns col ON col.id = cell.column_id AND col.database_id = cell.database_id
     WHERE cell.row_id = ? AND cell.column_id = ?
       AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')`,
  ).run(rowId, columnId);
}

function reindexColumnSearch(columnId: string): void {
  const rows = getDb().prepare('SELECT row_id FROM db_cells WHERE column_id = ?').all(columnId) as Array<{ row_id: string }>;
  getDb().transaction(() => {
    for (const row of rows) reindexCellSearch(row.row_id, columnId);
  })();
}

export function rebuildDatabaseSearchIndex(databaseId?: string): { indexed: number } {
  const db = getDb();
  const args = databaseId ? [databaseId] : [];
  const indexed = (db.prepare(
    `SELECT COUNT(*) AS count FROM db_cells cell
     JOIN db_columns col ON col.id = cell.column_id AND col.database_id = cell.database_id
     WHERE col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')
     ${databaseId ? 'AND cell.database_id = ?' : ''}`,
  ).get(...args) as { count: number }).count;
  db.transaction(() => {
    if (databaseId) db.prepare('DELETE FROM db_search_fts WHERE database_id = ?').run(databaseId);
    else db.prepare('DELETE FROM db_search_fts').run();
    // Rebuild in SQLite instead of materialising every (row,column) pair in JS and
    // issuing two statements per cell. The old implementation retained millions of
    // tiny objects for a scale fixture and turned a recoverable FTS repair into an OOM
    // risk. This single set operation has the same visible-label semantics.
    db.prepare(
      `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
       SELECT cell.rowid, CASE
                WHEN col.type IN ('select', 'status') THEN COALESCE(
                  (SELECT option.label FROM db_select_options option
                   WHERE option.id = COALESCE(cell.value_reference, cell.value_text)), cell.value_text, '')
                WHEN col.type = 'multi_select' AND json_valid(COALESCE(cell.value_json, cell.value_text)) THEN COALESCE(
                  (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                   FROM json_each(COALESCE(cell.value_json, cell.value_text)) item
                   LEFT JOIN db_select_options option ON option.id = item.value), cell.value_text, '')
                ELSE COALESCE(cell.value_text, '')
              END,
              'cell', cell.database_id, cell.row_id, cell.column_id,
              cell.row_id || ':' || cell.column_id
       FROM db_cells cell
       JOIN db_columns col ON col.id = cell.column_id AND col.database_id = cell.database_id
       WHERE col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')
       ${databaseId ? 'AND cell.database_id = ?' : ''}`,
    ).run(...args);
    db.prepare(
      `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
       SELECT -rowid, COALESCE(value_text, ''), 'computed', database_id, row_id, column_id, row_id || ':' || column_id
       FROM db_computed_cells WHERE value_type NOT IN ('number','integer') ${databaseId ? 'AND database_id = ?' : ''}`,
    ).run(...args);
    db.prepare(
      `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
       SELECT 2305843009213693952 + rowid,
              trim(COALESCE(file_name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extracted_text, '')),
              'attachment', database_id, row_id, column_id, id
       FROM db_attachments ${databaseId ? 'WHERE database_id = ?' : ''}`,
    ).run(...args);
    db.prepare(
      `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
       SELECT -2305843009213693952 + block.rowid,
              block.normalized_text, 'page_block', row.database_id, page.row_id, NULL, block.id
       FROM page_blocks block
       JOIN pages page ON page.id = block.page_id
       JOIN db_rows row ON row.id = page.row_id
       WHERE block.trashed_at IS NULL ${databaseId ? 'AND row.database_id = ?' : ''}`,
    ).run(...args);
    db.prepare(
      `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
       SELECT 4611686018427387904 + page.rowid, page.title, 'page_title', row.database_id,
              page.row_id, NULL, page.id
       FROM pages page LEFT JOIN db_rows row ON row.id = page.row_id
       WHERE page.state = 'active' AND page.row_id IS NULL ${databaseId ? 'AND row.database_id = ?' : ''}`,
    ).run(...args);
  })();
  return { indexed };
}

/**
 * Search across every database. Always matches the database name; when
 * `includeContent` is set, also counts rows whose cells contain the query (text or a
 * matching select-option label) so the sidebar can surface databases matched by their
 * data. Empty query → no results.
 */
export function searchDatabases(query: string, includeContent: boolean): DatabaseSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const db = getDb();
  const contentCounts = new Map<string, number>();
  if (includeContent) {
    const match = ftsQuery(q);
    const rows = match ? db.prepare(
      `SELECT database_id AS dbId, COUNT(DISTINCT row_id) AS n
       FROM db_search_fts WHERE db_search_fts MATCH ? GROUP BY database_id`,
    ).all(match) as { dbId: string; n: number }[] : [];
    for (const r of rows) contentCounts.set(r.dbId, r.n);
  }
  return listDatabases()
    .map((d): DatabaseSearchHit => ({
      id: d.id,
      shortId: d.shortId,
      name: d.name,
      icon: d.icon,
      rowCount: d.rowCount,
      titleMatch: d.name.toLowerCase().includes(q),
      contentMatches: contentCounts.get(d.id) ?? 0,
    }))
    .filter((h) => h.titleMatch || h.contentMatches > 0)
    // Title matches first, then by number of content matches.
    .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.contentMatches - a.contentMatches);
}

interface SearchCursor { v: 1; queryHash: string; revision: string; score: number; rowId: string }

export function searchDatabaseRowsPage(input: DatabaseRowSearchQuery): DatabaseRowSearchPage {
  const normalized = input.query.normalize('NFKC').trim();
  const match = ftsQuery(normalized);
  const queryHashValue = createHash('sha256').update(normalized.toLocaleLowerCase()).digest('base64url').slice(0, 24);
  const revision = searchRevision();
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 60)));
  if (!match) return { hits: [], nextCursor: null, queryHash: queryHashValue, revision, hasMore: false };
  let cursor: SearchCursor | null = null;
  if (input.cursor) {
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as SearchCursor; }
    catch { throw new Error('Cursor de búsqueda no válido.'); }
    if (cursor.v !== 1 || cursor.queryHash !== queryHashValue) throw new Error('El cursor pertenece a otra búsqueda.');
    if (cursor.revision !== revision) throw new Error('El índice cambió; reinicia la búsqueda.');
  }
  const rows = getDb().prepare(
    `WITH raw_hits AS (
       SELECT row_id AS rowId, database_id AS dbId, column_id AS columnId,
              entity_type AS entityType, entity_id AS entityId,
              bm25(db_search_fts, 8.0) AS score,
              snippet(db_search_fts, 0, '', '', '…', 18) AS snippet
       FROM db_search_fts
       WHERE db_search_fts MATCH @match AND row_id IS NOT NULL
     ), one_per_row AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY rowId ORDER BY score, entityId) AS rowRank
       FROM raw_hits
     )
     SELECT hit.rowId, hit.dbId, database.name AS dbName, database.short_id AS dbShort,
            COALESCE(column.name, CASE
              WHEN hit.entityType = 'attachment' THEN 'Adjunto'
              WHEN hit.entityType = 'page_block' THEN 'Página'
              ELSE 'Contenido' END) AS colName,
            hit.snippet, hit.score,
            COALESCE(title_cell.value_text, '') AS title
     FROM one_per_row hit
     JOIN db_databases database ON database.id = hit.dbId
     LEFT JOIN db_columns column ON column.id = hit.columnId AND column.database_id = hit.dbId
     LEFT JOIN db_columns title_column ON title_column.database_id = hit.dbId AND title_column.type = 'title'
     LEFT JOIN db_cells title_cell ON title_cell.database_id = hit.dbId
       AND title_cell.row_id = hit.rowId AND title_cell.column_id = title_column.id
     WHERE hit.rowRank = 1
       AND (@hasCursor = 0 OR hit.score > @score OR (hit.score = @score AND hit.rowId > @rowId))
     ORDER BY hit.score, hit.rowId
     LIMIT @limit`,
  ).all({ match, hasCursor: cursor ? 1 : 0, score: cursor?.score ?? 0, rowId: cursor?.rowId ?? '', limit: limit + 1 }) as Array<{
    rowId: string; dbId: string; dbName: string; dbShort: string; colName: string;
    snippet: string; score: number; title: string;
  }>;
  const hasMore = rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;
  const last = selected[selected.length - 1];
  const nextCursor = last && hasMore ? Buffer.from(JSON.stringify({
    v: 1, queryHash: queryHashValue, revision, score: last.score, rowId: last.rowId,
  } satisfies SearchCursor)).toString('base64url') : null;
  return {
    hits: selected.map((row) => ({
      databaseId: row.dbId, databaseName: row.dbName, databaseShortId: row.dbShort,
      rowId: row.rowId, title: row.title, columnName: row.colName, snippet: row.snippet,
    })),
    nextCursor, queryHash: queryHashValue, revision, hasMore,
  };
}

/** Compatibility adapter; new consumers use the ranked cursor page directly. */
export function searchDatabaseRows(query: string, limit = 60): DatabaseRowHit[] {
  return searchDatabaseRowsPage({ query, limit }).hits;
}

export function renameDatabase(id: string, name: string): DatabaseSummary | null {
  const db = getDb(); const normalized = name.trim() || 'Base de datos'; const timestamp = now();
  db.transaction(() => {
    db.prepare("UPDATE db_databases SET name = ?, updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE id = ?")
      .run(normalized, timestamp, id);
    db.prepare("UPDATE db_data_sources SET name = ?, updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE database_id = ?")
      .run(normalized, timestamp, id);
  })();
  return getDatabase(id);
}

export function setDatabaseIcon(id: string, icon: string | null): DatabaseSummary | null {
  getDb().prepare("UPDATE db_databases SET icon = ?, updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE id = ?").run(icon, now(), id);
  return getDatabase(id);
}

export function deleteDatabase(id: string): void {
  // Columns, options, rows and cells cascade via FKs.
  getDb().prepare('DELETE FROM db_databases WHERE id = ?').run(id);
}

export function reorderDatabases(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE db_databases SET position = ?, revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?");
  const timestamp = now();
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, timestamp, id)));
  tx();
}

/** Total rows across every database in the vault — the denominator for the % header. */
export function vaultRowTotal(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM db_rows').get() as { c: number }).c;
}

export function databaseStats(databaseId: string): { rowCount: number; vaultTotal: number; percent: number } {
  const rowCount = rowCountOf(databaseId);
  const vaultTotal = vaultRowTotal();
  return { rowCount, vaultTotal, percent: entryPercent(rowCount, vaultTotal) };
}

// ── Columns ──────────────────────────────────────────────────────────────────

interface ColumnRow {
  id: string;
  database_id: string;
  name: string;
  type: string;
  position: number;
  config_json: string | null;
  created_at: string;
}

function parseConfig(json: string | null): DatabaseColumnConfig {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as DatabaseColumnConfig) : {};
  } catch {
    return {};
  }
}

function rowToColumn(row: ColumnRow): DatabaseColumn {
  const def = columnTypeDef(row.type);
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    type: def.id,
    position: row.position,
    config: parseConfig(row.config_json),
    options: def.hasOptions ? getOptions(row.id) : [],
  };
}

export function createColumn(
  databaseId: string,
  name: string,
  type: DatabaseColumnType,
  config: DatabaseColumnConfig = {},
  identity?:string
): DatabaseColumn {
  const db = getDb();
  const id = identity ?? newId('dcol');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_columns WHERE database_id = ?').get(databaseId) as {
      n: number;
    }
  ).n;
  const requestedType = columnTypeDef(type).id;
  const actualType = requestedType === 'title'
    && db.prepare("SELECT 1 FROM db_columns WHERE database_id = ? AND type = 'title'").get(databaseId)
    ? 'text'
    : requestedType;
  const timestamp = now();
  db.prepare(
    `INSERT INTO db_columns
      (id, database_id, name, type, position, config_json, created_at, updated_at, revision, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local')`
  ).run(id, databaseId, name.trim() || 'Columna', actualType, position, JSON.stringify(config), timestamp, timestamp);
  touchDatabase(databaseId);
  if (actualType === 'formula' || actualType === 'rollup') recomputeDatabaseDerived(databaseId);
  return getColumn(id)!;
}

export function getColumn(id: string): DatabaseColumn | null {
  const row = getDb().prepare('SELECT * FROM db_columns WHERE id = ?').get(id) as ColumnRow | undefined;
  return row ? rowToColumn(row) : null;
}

export function getColumns(databaseId: string): DatabaseColumn[] {
  const rows = getDb()
    .prepare('SELECT * FROM db_columns WHERE database_id = ? ORDER BY position, created_at')
    .all(databaseId) as ColumnRow[];
  return rows.map(rowToColumn);
}

export function updateColumn(
  id: string,
  patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }
): DatabaseColumn | null {
  const existing = getColumn(id);
  if (!existing) return null;
  const name = patch.name?.trim() ?? existing.name;
  const type = patch.type ? columnTypeDef(patch.type).id : existing.type;
  const config = patch.config !== undefined ? patch.config : existing.config;
  const db = getDb();
  const prospective: DatabaseColumn = { ...existing, name, type, config };
  const prospectiveColumns = getColumns(existing.databaseId).map((column) => column.id === id ? prospective : column);
  if (type === 'formula' && config.formula) {
    const problem = validateFormula(config.formula as FormulaSpec, prospectiveColumns);
    if (problem) throw new Error(problem);
    const { circular } = orderFormulaColumns(prospectiveColumns);
    if (circular.size) throw new Error('La fórmula crea una referencia circular y no se ha guardado.');
  }
  if (type === 'relation') {
    const cardinality = config.relationCardinality ?? 'many';
    if (cardinality !== 'one' && cardinality !== 'many') throw new Error('Cardinalidad de relación no válida.');
    if (config.relationInverseColumnId) {
      const inverse = getColumn(String(config.relationInverseColumnId));
      if (!inverse || inverse.type !== 'relation' || inverse.databaseId !== config.relationTargetDatabaseId) {
        throw new Error('La propiedad inversa no pertenece a la base de destino.');
      }
    }
  }
  db.transaction(() => {
    if (type === 'title' && existing.type !== 'title') {
      const current = db.prepare(
        "SELECT id FROM db_columns WHERE database_id = ? AND type = 'title' AND id <> ?",
      ).get(existing.databaseId, id) as { id: string } | undefined;
      if (current) {
        db.prepare(
          "UPDATE db_columns SET type = 'text', revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?",
        ).run(now(), current.id);
        retypeColumnCells(current.id, existing.databaseId, 'text');
      }
    }
    db.prepare(
      `UPDATE db_columns SET name = ?, type = ?, config_json = ?, revision = revision + 1,
       updated_at = ?, updated_by = 'local' WHERE id = ?`,
    ).run(name || 'Columna', type, JSON.stringify(config), now(), id);
    if (type !== existing.type) retypeColumnCells(id, existing.databaseId, type);
    if (type === 'relation' && config.relationCardinality === 'one') {
      const groups = db.prepare(
        `SELECT row_id FROM db_relations WHERE column_id = ? GROUP BY row_id HAVING COUNT(*) > 1`,
      ).all(id) as Array<{ row_id: string }>;
      for (const group of groups) {
        const extras = db.prepare(
          `SELECT * FROM db_relations WHERE row_id = ? AND column_id = ? ORDER BY position, created_at, id LIMIT -1 OFFSET 1`,
        ).all(group.row_id, id) as RelationRow[];
        extras.forEach((relation) => deleteRelationPair(db, relation));
      }
    }
    ensurePrimaryTitle(existing.databaseId);
  })();
  touchDatabase(existing.databaseId);
  // A schema/config change can alter result types and dependency edges. Rebuilding here
  // is intentional; ordinary cell edits take the targeted path below.
  if (getColumns(existing.databaseId).some((column) => column.type === 'formula' || column.type === 'rollup')) {
    recomputeDatabaseDerived(existing.databaseId);
  }
  return getColumn(id);
}

export function deleteColumn(id: string): void {
  const col = getColumn(id);
  // Options and cells for this column cascade via FKs.
  getDb().prepare('DELETE FROM db_columns WHERE id = ?').run(id);
  if (col) {
    ensurePrimaryTitle(col.databaseId);
    touchDatabase(col.databaseId);
    if (getColumns(col.databaseId).some((column) => column.type === 'formula' || column.type === 'rollup')) {
      recomputeDatabaseDerived(col.databaseId);
    } else {
      getDb().prepare('DELETE FROM db_column_dependencies WHERE dependent_database_id = ?').run(col.databaseId);
    }
  }
}

export function reorderColumns(databaseId: string, orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE db_columns SET position = ?, revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ? AND database_id = ?",
  );
  const timestamp = now();
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, timestamp, id, databaseId)));
  tx();
  touchDatabase(databaseId);
}

// ── Select options ─────────────────────────────────────────────────────────────

interface OptionRow {
  id: string;
  database_id: string;
  column_id: string;
  label: string;
  color: string | null;
  position: number;
  group_key: 'pending' | 'in_progress' | 'complete' | null;
}

function rowToOption(row: OptionRow): DatabaseSelectOption {
  return { id: row.id, label: row.label, color: row.color, position: row.position, group: row.group_key };
}

export function getOptions(columnId: string): DatabaseSelectOption[] {
  return (
    getDb().prepare('SELECT * FROM db_select_options WHERE column_id = ? ORDER BY position, label').all(columnId) as OptionRow[]
  ).map(rowToOption);
}

export function addOption(
  columnId: string,
  label: string,
  color: string | null = null,
  group: DatabaseSelectOption['group'] = null,
  identity?: string,
): DatabaseSelectOption {
  const db = getDb();
  const column = getColumn(columnId);
  if (!column) throw new Error('Propiedad de base de datos no encontrada.');
  const id = identity ?? newId('dopt');
  if (identity) {
    if (!/^dopt_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity)) throw new Error('Identidad de opción no válida.');
    if (db.prepare('SELECT 1 FROM db_select_options WHERE id = ?').get(identity)) throw new Error('La opción ya existe.');
  }
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_select_options WHERE column_id = ?').get(columnId) as {
      n: number;
    }
  ).n;
  const timestamp = now();
  db.prepare(
    `INSERT INTO db_select_options
      (id, database_id, column_id, label, color, position, group_key, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?)`,
  ).run(
    id,
    column.databaseId,
    columnId,
    label.trim() || 'Opción',
    color,
    position,
    column.type === 'status' ? (group ?? (position === 0 ? 'pending' : position === 1 ? 'in_progress' : 'complete')) : null,
    timestamp,
    timestamp,
  );
  reindexColumnSearch(columnId);
  touchDatabase(column.databaseId);
  return getOptions(columnId).find((o) => o.id === id)!;
}

export function updateOption(
  id: string,
  patch: { label?: string; color?: string | null; group?: DatabaseSelectOption['group'] },
): void {
  const existing = getDb().prepare('SELECT * FROM db_select_options WHERE id = ?').get(id) as OptionRow | undefined;
  if (!existing) return;
  const label = patch.label?.trim() ?? existing.label;
  const color = patch.color !== undefined ? patch.color : existing.color;
  const group = patch.group !== undefined ? patch.group : existing.group_key;
  getDb().prepare(
    "UPDATE db_select_options SET label = ?, color = ?, group_key = ?, revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?",
  ).run(label || 'Opción', color, group, now(), id);
  reindexColumnSearch(existing.column_id);
  touchDatabase(existing.database_id);
}

/** Delete an option and purge its id from every cell that referenced it. */
export function deleteOption(id: string): void {
  const db = getDb();
  const opt = db.prepare('SELECT column_id FROM db_select_options WHERE id = ?').get(id) as
    | { column_id: string }
    | undefined;
  if (!opt) return;
  const col = getColumn(opt.column_id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM db_select_options WHERE id = ?').run(id);
    if (!col) return;
    const cells = db.prepare(
      `SELECT row_id, ${STORED_CELL_COLUMNS} FROM db_cells WHERE database_id = ? AND column_id = ?`,
    ).all(col.databaseId, opt.column_id) as Array<StoredCellRow & { row_id: string }>;
    for (const cell of cells) {
      const raw = storedCellRaw(cell);
      if (col.type === 'select' || col.type === 'status') {
        if (raw === id) db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(cell.row_id, opt.column_id);
      } else if (col.type === 'multi_select') {
        const ids = decodeMultiSelect(raw).filter((v) => v !== id);
        const next = encodeMultiSelect(ids);
        if (next == null) db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(cell.row_id, opt.column_id);
        else writeStoredCell(cell.row_id, opt.column_id, col.databaseId, col.type, next);
      }
    }
  });
  tx();
  if (col) {
    reindexColumnSearch(col.id);
    touchDatabase(col.databaseId);
  }
}

export function reorderOptions(columnId: string, orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE db_select_options SET position = ?, revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ? AND column_id = ?",
  );
  const timestamp = now();
  const tx = db.transaction(() => orderedIds.forEach((id, i) => stmt.run(i, timestamp, id, columnId)));
  tx();
  const column = getColumn(columnId);
  if (column) touchDatabase(column.databaseId);
}

// ── Rows & cells ─────────────────────────────────────────────────────────────

function touchDatabase(databaseId: string): void {
  getDb().prepare("UPDATE db_databases SET updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE id = ?").run(now(), databaseId);
}

function touchRow(rowId: string): void {
  getDb().prepare("UPDATE db_rows SET updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE id = ?").run(now(), rowId);
}

export function createRow(databaseId: string, identity?:string): DatabaseRow {
  const db = getDb();
  ensurePrimaryTitle(databaseId);
  const id = identity ?? newId('drow');
  const ts = now();
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_rows WHERE database_id = ?').get(databaseId) as {
      n: number;
    }
  ).n;
  const sequence = Number((db.prepare(
    'SELECT COALESCE(MAX(unique_sequence), 0) + 1 AS n FROM db_rows WHERE database_id = ?',
  ).get(databaseId) as { n: number }).n);
  db.prepare(
    `INSERT INTO db_rows
      (id, database_id, position, unique_sequence, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'local', 'local')`,
  ).run(
    id,
    databaseId,
    position,
    sequence,
    ts,
    ts
  );
  touchDatabase(databaseId);
  recomputeDerivedForRow(databaseId, id);
  return getRow(id) ?? { id, databaseId, position, cells: {}, createdAt: ts, updatedAt: ts,
    revision: 1, createdBy: 'local', updatedBy: 'local', uniqueSequence: sequence };
}

interface RowMeta {
  id: string;
  database_id: string;
  position: number;
  created_at: string;
  updated_at: string;
  revision: number;
  created_by: string;
  updated_by: string;
  unique_sequence: number;
}

interface QueryOrderKey {
  expression: string;
  dir: 'asc' | 'desc';
}

interface ResolvedRowQuery {
  databaseId: string;
  filter: FilterNode | null;
  sorts: SortRule[];
  groups: GroupRule[];
  rowSort: DatabaseRowSort;
}

const rowCountCache = new Map<string, number>();

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

function queryHash(query: ResolvedRowQuery): string {
  return createHash('sha256').update(stableSerialize(query)).digest('hex');
}

function encodeRowCursor(payload: DatabaseRowCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeRowCursor(value: string): DatabaseRowCursorPayload {
  if (!value || value.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Cursor de filas no válido.');
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<DatabaseRowCursorPayload>;
    if (
      payload.v !== DATABASE_ROW_CURSOR_VERSION
      || typeof payload.queryHash !== 'string'
      || !Number.isSafeInteger(payload.revision)
      || !Array.isArray(payload.values)
      || payload.values.some((item) => typeof item !== 'string' && typeof item !== 'number')
    ) throw new Error('shape');
    return payload as DatabaseRowCursorPayload;
  } catch {
    throw new Error('Cursor de filas no válido.');
  }
}

function resolveRowQuery(input: DatabaseRowQuery): ResolvedRowQuery {
  if (!input || typeof input !== 'object' || typeof input.databaseId !== 'string' || !input.databaseId) {
    throw new Error('La consulta no indica una base de datos válida.');
  }
  let viewFilter: FilterNode | null = null;
  let viewSorts: SortRule[] = [];
  let viewGroups: GroupRule[] = [];
  if (input.viewId) {
    const view = getDb().prepare('SELECT database_id, layout, filter_json, sort_json, config_json FROM db_views WHERE id = ?').get(input.viewId) as
      | { database_id: string; layout: string; filter_json: string | null; sort_json: string | null; config_json: string | null }
      | undefined;
    if (!view || view.database_id !== input.databaseId) throw new Error('La vista no pertenece a la base de datos consultada.');
    let rawConfig: unknown = null;
    try { rawConfig = view.config_json ? JSON.parse(view.config_json) : null; } catch { rawConfig = null; }
    const config = normalizeDatabaseViewConfig(rawConfig, {
      layout: view.layout,
      filter: parseFilter(view.filter_json),
      sorts: parseSorts(view.sort_json),
    });
    viewFilter = config.filter;
    viewSorts = config.sorts;
    viewGroups = config.groups;
  }
  const filter = input.filter === undefined ? viewFilter : input.filter ?? null;
  if (filter) assertFilterNode(filter);
  const sorts = input.sorts === undefined ? viewSorts : input.sorts;
  const groups = input.groups === undefined ? viewGroups : input.groups;
  if (!Array.isArray(sorts) || sorts.length > 20 || !Array.isArray(groups) || groups.length > 4) {
    throw new Error('La consulta contiene demasiadas reglas de orden o agrupación.');
  }
  return {
    databaseId: input.databaseId,
    filter,
    sorts: sorts.map((sort) => ({ columnId: String(sort.columnId), dir: sort.dir === 'desc' ? 'desc' : 'asc' })),
    groups: groups.map((group) => ({ columnId: String(group.columnId), dir: group.dir === 'desc' ? 'desc' : 'asc' })),
    rowSort: input.rowSort ?? 'position',
  };
}

function rawCellSql(alias: string): string {
  return `COALESCE(${alias}.value_text, CAST(${alias}.value_number AS TEXT), CAST(${alias}.value_integer AS TEXT), ${alias}.value_date, ${alias}.value_json, ${alias}.value_reference)`;
}

function metadataPropertySql(column: DatabaseColumn): string | null {
  switch (column.type) {
    case 'created_time': return 'r.created_at';
    case 'last_edited_time': return 'r.updated_at';
    case 'created_by': return 'r.created_by';
    case 'last_edited_by': return 'r.updated_by';
    case 'unique_id': {
      const prefix = String(column.config.uniqueIdPrefix ?? '').replace(/'/g, "''").slice(0, 24);
      const padding = Math.min(12, Math.max(1, Math.trunc(Number(column.config.uniqueIdPadding ?? 4))));
      return `'${prefix}' || printf('%0${padding}d', r.unique_sequence)`;
    }
    default: return null;
  }
}

function compileFilter(
  node: FilterNode | null,
  columns: Map<string, DatabaseColumn>,
  params: Record<string, string | number>,
): string {
  let serial = 0;
  const param = (value: string | number) => {
    const name = `filter${serial++}`;
    params[name] = value;
    return `@${name}`;
  };
  const visit = (current: FilterNode): string | null => {
    if (current.type === 'group') {
      const children = current.children.map(visit).filter((value): value is string => Boolean(value));
      return children.length ? `(${children.join(current.operator === 'or' ? ' OR ' : ' AND ')})` : null;
    }
    const column = columns.get(current.columnId);
    if (!column) throw new Error(`La propiedad del filtro no pertenece a esta base de datos: ${current.columnId}`);
    if (!operatorsForColumn(column).includes(current.op)) {
      throw new Error(`El operador ${current.op} no es válido para la propiedad ${column.name}.`);
    }
    const metadata = metadataPropertySql(column);
    if (metadata) {
      const value = String(current.value ?? '');
      if (current.op === 'isEmpty') return `(${metadata} IS NULL OR ${metadata} = '')`;
      if (current.op === 'notEmpty') return `(${metadata} IS NOT NULL AND ${metadata} <> '')`;
      if (comparableType(column) === 'date') {
        const operator = current.op === 'before' ? '<' : current.op === 'after' ? '>' : '=';
        return `${metadata} ${operator} ${param(value)}`;
      }
      const lowered = value.toLocaleLowerCase();
      if (current.op === 'contains' || current.op === 'notContains') {
        const escaped = lowered.replace(/[\\%_]/g, (match) => `\\${match}`);
        const match = `LOWER(${metadata}) LIKE ${param(`%${escaped}%`)} ESCAPE '\\'`;
        return current.op === 'notContains' ? `NOT (${match})` : match;
      }
      const match = `LOWER(${metadata}) = ${param(lowered)}`;
      return current.op === 'notEquals' ? `NOT (${match})` : match;
    }
    const columnParam = param(column.id);
    const valueTable = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
    const base = `c.database_id = r.database_id AND c.row_id = r.id AND c.column_id = ${columnParam}`;
    const existsCell = (predicate = '') => `EXISTS (SELECT 1 FROM ${valueTable} c WHERE ${base}${predicate ? ` AND ${predicate}` : ''})`;
    const raw = rawCellSql('c');
    const empty = `(${raw} IS NULL OR ${raw} = '')`;
    const value = current.value;
    const values = (Array.isArray(value) ? value : value == null ? [] : [value]).map(String);
    const type = comparableType(column);

    if (type === 'attachment' || type === 'relation') {
      const table = type === 'attachment' ? 'db_attachments' : 'db_relations';
      const edge = `EXISTS (SELECT 1 FROM ${table} edge WHERE edge.database_id = r.database_id AND edge.row_id = r.id AND edge.column_id = ${columnParam})`;
      return current.op === 'isEmpty' ? `NOT ${edge}` : edge;
    }
    if (current.op === 'isEmpty') return `NOT ${existsCell(`NOT ${empty}`)}`;
    if (current.op === 'notEmpty') return existsCell(`NOT ${empty}`);

    if (type === 'title' || type === 'text' || type === 'ai') {
      const target = String(value ?? '').toLocaleLowerCase();
      if (current.op === 'contains' || current.op === 'notContains') {
        const escaped = target.replace(/[\\%_]/g, (match) => `\\${match}`);
        const match = existsCell(`LOWER(${raw}) LIKE ${param(`%${escaped}%`)} ESCAPE '\\'`);
        return current.op === 'notContains' ? `NOT ${match}` : match;
      }
      const match = existsCell(`LOWER(${raw}) = ${param(target)}`);
      return current.op === 'notEquals' ? `NOT ${match}` : match;
    }
    if (type === 'number') {
      const target = Number(value);
      if (!Number.isFinite(target)) return '0';
      const operator = ({ equals: '=', notEquals: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[current.op];
      return existsCell(`COALESCE(c.value_number, CAST(c.value_text AS REAL)) ${operator} ${param(target)}`);
    }
    if (type === 'date' || type === 'time') {
      const operator = current.op === 'before' ? '<' : current.op === 'after' ? '>' : '=';
      const dateValue = `CASE WHEN json_valid(COALESCE(c.value_json,c.value_text))
        THEN json_extract(COALESCE(c.value_json,c.value_text), '$.start')
        ELSE COALESCE(c.value_date,c.value_text) END`;
      return existsCell(`${dateValue} ${operator} ${param(String(value ?? ''))}`);
    }
    if (type === 'checkbox') {
      const checked = existsCell("COALESCE(c.value_integer, CAST(c.value_text AS INTEGER), 0) = 1");
      return current.op === 'isUnchecked' ? `NOT ${checked}` : checked;
    }
    if (type === 'select') {
      if (values.length === 0) return current.op === 'isNoneOf' ? '1' : '0';
      const list = values.map(param).join(',');
      const match = existsCell(`COALESCE(c.value_reference, c.value_text) IN (${list})`);
      return current.op === 'isNoneOf' ? `NOT ${match}` : match;
    }
    if (type === 'multi_select') {
      if (values.length === 0) return current.op === 'isNoneOf' || current.op === 'hasAllOf' ? '1' : '0';
      const json = "CASE WHEN json_valid(COALESCE(c.value_json,c.value_text)) THEN COALESCE(c.value_json,c.value_text) ELSE '[]' END";
      const one = (item: string) => existsCell(`EXISTS (SELECT 1 FROM json_each(${json}) item WHERE CAST(item.value AS TEXT) = ${param(item)})`);
      if (current.op === 'hasAllOf') return `(${values.map(one).join(' AND ')})`;
      const match = `(${values.map(one).join(' OR ')})`;
      return current.op === 'isNoneOf' ? `NOT ${match}` : match;
    }
    return '1';
  };
  return node ? visit(node) ?? '1' : '1';
}

function indexedNumberFilter(
  node: FilterNode | null,
  columns: Map<string, DatabaseColumn>,
): { column: DatabaseColumn; operator: '=' | '<>' | '>' | '>=' | '<' | '<='; value: number } | null {
  const condition = node?.type === 'condition' ? node
    : node?.type === 'group' && node.operator === 'and' && node.children.length === 1 && node.children[0].type === 'condition'
      ? node.children[0] : null;
  if (!condition) return null;
  const column = columns.get(condition.columnId);
  if (!column || column.type !== 'number') return null;
  const operator = ({ equals: '=', notEquals: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const)[condition.op as 'equals'];
  const value = Number(condition.value);
  return operator && Number.isFinite(value) ? { column, operator, value } : null;
}

function propertyOrderExpression(column: DatabaseColumn, alias: string): { empty: string; value: string } {
  const raw = rawCellSql(alias);
  const empty = `CASE WHEN ${alias}.row_id IS NULL OR ${raw} IS NULL OR ${raw} = '' THEN 1 ELSE 0 END`;
  switch (comparableType(column)) {
    case 'number':
      return { empty, value: `COALESCE(${alias}.value_number, CAST(${alias}.value_text AS REAL), 0)` };
    case 'checkbox':
      return { empty, value: `COALESCE(${alias}.value_integer, CAST(${alias}.value_text AS INTEGER), 0)` };
    case 'date':
    case 'time':
      return { empty, value: `CASE WHEN json_valid(COALESCE(${alias}.value_json,${alias}.value_text))
        THEN COALESCE(json_extract(COALESCE(${alias}.value_json,${alias}.value_text), '$.start'),'')
        ELSE COALESCE(${alias}.value_date,${alias}.value_text,'') END` };
    case 'select':
      return {
        empty,
        value: `COALESCE((SELECT option.position FROM db_select_options option WHERE option.id = COALESCE(${alias}.value_reference, ${alias}.value_text)), 2147483647)`,
      };
    default:
      return { empty, value: `LOWER(COALESCE(${raw}, ''))` };
  }
}

interface ComputedCellRow extends StoredCellRow {
  row_id: string;
  column_id: string;
  computed_kind: 'formula' | 'rollup';
  color: string | null;
  error: string | null;
}

function derivedColumns(columns: DatabaseColumn[]): DatabaseColumn[] {
  return columns.filter((column) => column.type === 'formula' || column.type === 'rollup');
}

/** Hydrate canonical inputs plus already-materialized dependencies, never recursing. */
function rowsForComputation(metaRows: RowMeta[], databaseId: string, computedTable = 'db_computed_cells'): DatabaseRow[] {
  if (metaRows.length === 0) return [];
  if (computedTable !== 'db_computed_cells' && computedTable !== 'nodus_computed_stage') {
    throw new Error('Tabla calculada interna no válida.');
  }
  const db = getDb();
  const index = new Map<string, DatabaseRow>();
  const rows = metaRows.map((meta) => {
    const row: DatabaseRow = {
      id: meta.id, databaseId: meta.database_id, position: meta.position, cells: {},
      createdAt: meta.created_at, updatedAt: meta.updated_at,
    };
    index.set(row.id, row);
    return row;
  });
  const placeholders = rows.map(() => '?').join(',');
  const canonical = db.prepare(
    `SELECT row_id, column_id, ${STORED_CELL_COLUMNS}
     FROM db_cells WHERE database_id = ? AND row_id IN (${placeholders})`,
  ).all(databaseId, ...rows.map((row) => row.id)) as Array<StoredCellRow & { row_id: string; column_id: string }>;
  for (const cell of canonical) index.get(cell.row_id)!.cells[cell.column_id] = storedCellRaw(cell);
  const computed = db.prepare(
    `SELECT row_id, column_id, computed_kind, ${STORED_CELL_COLUMNS.replace(', value_reference', '')}, color, error
     FROM ${computedTable} WHERE database_id = ? AND row_id IN (${placeholders})`,
  ).all(databaseId, ...rows.map((row) => row.id)) as ComputedCellRow[];
  for (const cell of computed) {
    const row = index.get(cell.row_id)!;
    const raw = storedCellRaw(cell);
    row.cells[cell.column_id] = raw;
    if (cell.computed_kind === 'rollup') (row.rollups ??= {})[cell.column_id] = raw ?? '';
    if (cell.color) (row.formulaColors ??= {})[cell.column_id] = cell.color;
    if (cell.error) (row.formulaErrors ??= {})[cell.column_id] = cell.error;
  }
  return rows;
}

function scanDatabaseRows(databaseId: string, visit: (meta: RowMeta[]) => void | boolean): number {
  const db = getDb();
  let position = -1;
  let rowId = '';
  let total = 0;
  for (;;) {
    const page = db.prepare(
      `SELECT id, database_id, position, created_at, updated_at, revision,
              created_by, updated_by, unique_sequence
       FROM db_rows
       WHERE database_id = ? AND (position > ? OR (position = ? AND id > ?))
       ORDER BY position, id LIMIT 500`,
    ).all(databaseId, position, position, rowId) as RowMeta[];
    if (page.length === 0) break;
    if (visit(page) === false) break;
    total += page.length;
    position = page[page.length - 1].position;
    rowId = page[page.length - 1].id;
  }
  return total;
}

function computedStorage(column: DatabaseColumn, raw: string | null): DatabaseCellStorageValues {
  if (raw == null) {
    return { value_type: 'text', value_text: null, value_number: null, value_integer: null, value_date: null, value_json: null, value_reference: null };
  }
  if (column.type === 'formula') {
    const kind = formulaValueKind(column.config.formula as FormulaSpec | undefined);
    if (kind === 'number') return databaseCellStorage('number', raw);
    if (kind === 'boolean') return databaseCellStorage('checkbox', raw);
    if (kind === 'date') return databaseCellStorage('date', raw);
    if (kind === 'list' || kind === 'person' || kind === 'page') {
      try {
        const parsed = JSON.parse(raw);
        return { value_type: 'json', value_text: raw, value_number: null, value_integer: null,
          value_date: null, value_json: JSON.stringify(parsed), value_reference: null };
      } catch { return databaseCellStorage('text', raw); }
    }
    return databaseCellStorage('text', raw);
  }
  const fn = (column.config.rollupFunction as RollupFunction | undefined) ?? 'show';
  const kind = rollupResultKind(fn);
  if (kind === 'number') {
    const storage = databaseCellStorage('number', raw.endsWith('%') ? raw.slice(0, -1) : raw);
    return raw.endsWith('%') ? { ...storage, value_text: raw } : storage;
  }
  if (kind === 'date' || kind === 'json') return databaseCellStorage('date', raw);
  return databaseCellStorage('text', raw);
}

function relatedFormulaValues(rowId: string, relationColumnId: string, targetColumnId: string): FormulaRuntimeValue[] {
  const db = getDb();
  const relationColumn = getColumn(relationColumnId);
  const targetDatabaseId = relationColumn?.config.relationTargetDatabaseId as string | undefined;
  if (!relationColumn || relationColumn.type !== 'relation' || !targetDatabaseId) return [];
  const targetColumns = getColumns(targetDatabaseId);
  const targetColumn = targetColumnId === '__title__'
    ? targetColumns.find((column) => column.type === 'title')
    : targetColumns.find((column) => column.id === targetColumnId);
  if (!targetColumn) return [];
  const targets = db.prepare(
    `SELECT target_id FROM db_relations
     WHERE row_id = ? AND column_id = ? AND target_kind = 'db_row' ORDER BY position, id`,
  ).all(rowId, relationColumnId) as Array<{ target_id: string }>;
  if (!targets.length) return [];
  const ids = targets.map((target) => target.target_id);
  const table = targetColumn.type === 'formula' || targetColumn.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
  const storedColumns = table === 'db_cells' ? STORED_CELL_COLUMNS
    : 'value_text, value_number, value_integer, value_date, value_json, NULL AS value_reference';
  const cells = db.prepare(
    `SELECT row_id, ${storedColumns} FROM ${table}
     WHERE database_id = ? AND column_id = ? AND row_id IN (${ids.map(() => '?').join(',')})`,
  ).all(targetDatabaseId, targetColumn.id, ...ids) as Array<StoredCellRow & { row_id: string }>;
  const values = new Map(cells.map((cell) => [cell.row_id, storedCellRaw(cell)]));
  return ids.flatMap((id): FormulaRuntimeValue[] => {
    const raw = values.get(id) ?? null;
    if (raw == null) return [];
    if (targetColumn.type === 'number' || targetColumn.type === 'formula' || targetColumn.type === 'rollup') {
      const numeric = Number(raw.replace(/%$/, ''));
      return [Number.isFinite(numeric) ? numeric : raw];
    }
    if (targetColumn.type === 'checkbox') return [raw === '1' || raw === 'true'];
    return [raw];
  });
}

function upsertComputedCell(
  databaseId: string,
  rowId: string,
  column: DatabaseColumn,
  kind: 'formula' | 'rollup',
  value: string | null,
  color: string | null = null,
  error: string | null = null,
): void {
  const db = getDb();
  const storage = computedStorage(column, value);
  const revision = (db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(databaseId) as { revision: number } | undefined)?.revision ?? 1;
  db.prepare(
    `INSERT INTO db_computed_cells
      (database_id, row_id, column_id, computed_kind, value_type, value_text, value_number,
       value_integer, value_date, value_json, color, error, source_revision, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(row_id, column_id) DO UPDATE SET
       computed_kind = excluded.computed_kind, value_type = excluded.value_type,
       value_text = excluded.value_text, value_number = excluded.value_number,
       value_integer = excluded.value_integer, value_date = excluded.value_date,
       value_json = excluded.value_json, color = excluded.color, error = excluded.error,
       source_revision = excluded.source_revision, revision = db_computed_cells.revision + 1,
       updated_at = excluded.updated_at`,
  ).run(databaseId, rowId, column.id, kind, storage.value_type, storage.value_text,
    storage.value_number, storage.value_integer, storage.value_date, storage.value_json,
    color, error, revision, now());
}

function recomputeDerivedForRow(databaseId: string, rowId: string, sourceColumnId?: string): void {
  const db = getDb();
  const columns = getColumns(databaseId);
  if (derivedColumns(columns).length === 0) return;
  // Schema mutations rebuild this graph transactionally. Rebuilding it again for every
  // ordinary cell edit deleted and reinserted the same edges and needlessly acquired a
  // writer lock on large vaults; row edits only consume the stable projection.
  if (!sourceColumnId && columns.some((column) => {
    if (column.type !== 'formula') return false;
    const spec = column.config.formula as FormulaSpec | undefined;
    return spec?.kind === 'columnStat' || (spec?.kind === 'expression' && formulaExpressionGlobalStatDependencies(spec.ast).length > 0);
  })) {
    recomputeDatabaseDerived(databaseId);
    return;
  }
  const affected = sourceColumnId
    ? db.prepare(
      `WITH RECURSIVE affected(column_id, dependency_kind) AS (
         SELECT dependent_column_id, dependency_kind FROM db_column_dependencies
         WHERE source_database_id = ? AND source_column_id = ? AND dependent_database_id = ?
         UNION
         SELECT dependency.dependent_column_id, dependency.dependency_kind
         FROM db_column_dependencies dependency
         JOIN affected prior ON dependency.source_database_id = ? AND dependency.source_column_id = prior.column_id
         WHERE dependency.dependent_database_id = ?
       ) SELECT DISTINCT column_id, dependency_kind FROM affected`,
    ).all(databaseId, sourceColumnId, databaseId, databaseId, databaseId) as Array<{ column_id: string; dependency_kind: string }>
    : derivedColumns(columns).map((column) => ({ column_id: column.id, dependency_kind: column.type }));
  if (affected.length === 0) return;
  if (affected.some((item) => item.dependency_kind === 'formula_global')) {
    recomputeDatabaseDerived(databaseId);
    return;
  }
  const meta = db.prepare(
    `SELECT id, database_id, position, created_at, updated_at, revision,
            created_by, updated_by, unique_sequence FROM db_rows WHERE database_id = ? AND id = ?`,
  ).get(databaseId, rowId) as RowMeta | undefined;
  if (!meta) return;
  const ids = new Set(affected.map((item) => item.column_id));
  const rows = rowsForComputation([meta], databaseId);
  const row = rows[0];
  const rollups = columns.filter((column) => column.type === 'rollup' && ids.has(column.id));
  if (rollups.length) {
    computeRollups(rows, columns);
    for (const column of rollups) {
      const value = row.rollups?.[column.id] ?? '';
      upsertComputedCell(databaseId, rowId, column, 'rollup', value === '' ? null : value);
      row.cells[column.id] = value === '' ? null : value;
    }
  }
  const byId = new Map(columns.map((column) => [column.id, column]));
  const { ordered, circular } = orderFormulaColumns(columns);
  for (const column of ordered) {
    if (!ids.has(column.id)) continue;
    const spec = column.config.formula as FormulaSpec | undefined;
    const problem = validateFormula(spec, columns);
    if (problem || !spec) {
      upsertComputedCell(databaseId, rowId, column, 'formula', null, null, problem ?? 'Esta columna todavía no tiene fórmula.');
      row.cells[column.id] = null;
      continue;
    }
    const result = evaluateFormula(spec, row, { columns: byId, stats: new Map(), relatedValues: relatedFormulaValues });
    const color = result.color ?? applyColorRules(result.value, formulaResultKind(spec), column.config.formulaColors ?? []);
    upsertComputedCell(databaseId, rowId, column, 'formula', result.value, color ?? null, result.error ?? null);
    row.cells[column.id] = result.value;
  }
  for (const columnId of circular) {
    if (!ids.has(columnId)) continue;
    const column = byId.get(columnId);
    if (column) upsertComputedCell(databaseId, rowId, column, 'formula', null, null, 'Referencia circular: la fórmula se usa a sí misma.');
  }
}

function recomputeRollupsTargetingRow(sourceDatabaseId: string, sourceColumnId: string, targetRowId: string): void {
  const db = getDb();
  const dependencies = db.prepare(
    `SELECT dependent_database_id, dependent_column_id
     FROM db_column_dependencies
     WHERE source_database_id = ? AND source_column_id = ?
       AND dependency_kind IN ('rollup_target', 'formula_relation_target')`,
  ).all(sourceDatabaseId, sourceColumnId) as Array<{ dependent_database_id: string; dependent_column_id: string }>;
  for (const dependency of dependencies) {
    const derived = getColumn(dependency.dependent_column_id);
    let relationColumnId = derived?.config.rollupRelationColumnId as string | undefined;
    if (derived?.type === 'formula') {
      const spec = derived.config.formula as FormulaSpec | undefined;
      relationColumnId = spec?.kind === 'expression'
        ? formulaExpressionRelations(spec.ast).find((pair) => pair.targetColumnId === sourceColumnId)?.relationColumnId
        : undefined;
    }
    if (!derived || !relationColumnId) continue;
    const sources = db.prepare(
      `SELECT DISTINCT row_id FROM db_relations
       WHERE database_id = ? AND column_id = ? AND target_kind = 'db_row' AND target_id = ?`,
    ).all(dependency.dependent_database_id, relationColumnId, targetRowId) as Array<{ row_id: string }>;
    for (const source of sources) recomputeDerivedForRow(dependency.dependent_database_id, source.row_id, relationColumnId);
    if (sources.length) touchDatabase(dependency.dependent_database_id);
  }
}

function rebuildColumnDependencies(databaseId: string, columns: DatabaseColumn[]): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO db_column_dependencies
      (source_database_id, source_column_id, dependent_database_id, dependent_column_id, dependency_kind)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM db_column_dependencies WHERE dependent_database_id = ?').run(databaseId);
    for (const column of columns) {
      if (column.type === 'formula') {
        const spec = column.config.formula as FormulaSpec | undefined;
        const global = spec?.kind === 'columnStat' || (spec?.kind === 'expression'
          && formulaExpressionGlobalStatDependencies(spec.ast).length > 0);
        for (const source of formulaDependencies(spec)) {
          insert.run(databaseId, source, databaseId, column.id, global ? 'formula_global' : 'formula');
        }
        if (spec?.kind === 'expression') {
          for (const pair of formulaExpressionRelations(spec.ast)) {
            const relation = columns.find((candidate) => candidate.id === pair.relationColumnId);
            const targetDatabaseId = relation?.config.relationTargetDatabaseId as string | undefined;
            if (targetDatabaseId) insert.run(targetDatabaseId, pair.targetColumnId, databaseId, column.id, 'formula_relation_target');
          }
        }
      } else if (column.type === 'rollup') {
        const relationId = column.config.rollupRelationColumnId;
        const relation = relationId ? columns.find((candidate) => candidate.id === relationId) : undefined;
        if (!relation) continue;
        insert.run(databaseId, relation.id, databaseId, column.id, 'rollup_relation');
        const targetDatabaseId = relation.config.relationTargetDatabaseId;
        if (!targetDatabaseId) continue;
        const targets = getColumns(targetDatabaseId);
        const requested = column.config.rollupTargetColumnId;
        const target = !requested || requested === '__title__'
          ? targets.find((candidate) => candidate.type === 'title') ?? targets[0]
          : targets.find((candidate) => candidate.id === requested);
        if (target) insert.run(targetDatabaseId, target.id, databaseId, column.id, 'rollup_target');
      }
    }
  })();
}

/**
 * Rebuild every derived value using 500-row windows. Only a numeric vector for a
 * table-wide statistic is held in memory; complete row objects are never accumulated.
 */
export function recomputeDatabaseDerived(
  databaseId: string,
  onProgress?: (done: number, total: number) => void,
  cancelled: () => boolean = () => false,
): { done: number; total: number; cancelled: boolean } {
  const db = getDb();
  const columns = getColumns(databaseId);
  const rollups = columns.filter((column) => column.type === 'rollup');
  const { ordered: formulas, circular } = orderFormulaColumns(columns);
  const rowCount = rowCountOf(databaseId);
  const total = rowCount * (rollups.length + formulas.length + circular.size);
  const revision = (db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(databaseId) as { revision: number } | undefined)?.revision ?? 1;
  db.exec('DROP TABLE IF EXISTS temp.nodus_computed_stage');
  db.exec(`CREATE TEMP TABLE nodus_computed_stage (
    database_id TEXT NOT NULL, row_id TEXT NOT NULL, column_id TEXT NOT NULL,
    computed_kind TEXT NOT NULL, value_type TEXT NOT NULL, value_text TEXT,
    value_number REAL, value_integer INTEGER, value_date TEXT, value_json TEXT,
    color TEXT, error TEXT, source_revision INTEGER NOT NULL, revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (row_id, column_id)
  )`);
  const upsert = db.prepare(
    `INSERT INTO nodus_computed_stage
      (database_id, row_id, column_id, computed_kind, value_type, value_text, value_number,
       value_integer, value_date, value_json, color, error, source_revision, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const save = (rowId: string, column: DatabaseColumn, kind: 'formula' | 'rollup', value: string | null, color: string | null, error: string | null) => {
    const storage = computedStorage(column, value);
    upsert.run(databaseId, rowId, column.id, kind, storage.value_type, storage.value_text,
      storage.value_number, storage.value_integer, storage.value_date, storage.value_json,
      color, error, revision, now());
  };
  let done = 0;
  // Keep the previous projection visible while the replacement is built in TEMP.
  // This avoids holding a vault-wide write lock for a 250k-row computation.
  const abort = () => {
    db.exec('DROP TABLE IF EXISTS temp.nodus_computed_stage');
    return { done, total, cancelled: true };
  };
  try {
  if (rollups.length > 0) {
    scanDatabaseRows(databaseId, (meta) => {
      if (cancelled()) return false;
      const rows = rowsForComputation(meta, databaseId, 'nodus_computed_stage');
      computeRollups(rows, columns);
      db.transaction(() => {
        for (const row of rows) for (const column of rollups) {
          const value = row.rollups?.[column.id] ?? '';
          save(row.id, column, 'rollup', value === '' ? null : value, null, null);
          done++;
        }
      })();
      onProgress?.(done, total);
    });
    if (cancelled()) return abort();
  }

  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const column of formulas) {
    if (cancelled()) return abort();
    const spec = column.config.formula as FormulaSpec | undefined;
    const problem = validateFormula(spec, columns);
    const stats = new Map<string, ColumnStats>();
    const statisticIds = spec?.kind === 'columnStat' ? [spec.columnId]
      : spec?.kind === 'expression' ? formulaExpressionGlobalStatDependencies(spec.ast) : [];
    for (const statisticId of statisticIds) {
      const source = byId.get(statisticId);
      if (source) {
        const sourceTable = source.type === 'formula' || source.type === 'rollup' ? 'nodus_computed_stage' : 'db_cells';
        const values = db.prepare(
          `SELECT COALESCE(value_number, value_integer, CAST(value_text AS REAL)) AS value
           FROM ${sourceTable}
           WHERE database_id = ? AND column_id = ?
             AND COALESCE(value_number, value_integer, value_text) IS NOT NULL
           ORDER BY value`,
        ).all(databaseId, source.id) as Array<{ value: number }>;
        const sorted = values.map((item) => Number(item.value)).filter(Number.isFinite);
        const sum = sorted.reduce((acc, value) => acc + value, 0);
        stats.set(source.id, { sorted, total: sum, mean: sorted.length ? sum / sorted.length : 0 });
      }
    }
    scanDatabaseRows(databaseId, (meta) => {
      if (cancelled()) return false;
      const rows = rowsForComputation(meta, databaseId, 'nodus_computed_stage');
      db.transaction(() => {
        for (const row of rows) {
          if (problem || !spec) save(row.id, column, 'formula', null, null, problem ?? 'Esta columna todavía no tiene fórmula.');
          else {
            const result = evaluateFormula(spec, row, { columns: byId, stats, relatedValues: relatedFormulaValues });
            const color = result.color ?? applyColorRules(result.value, formulaResultKind(spec), column.config.formulaColors ?? []);
            save(row.id, column, 'formula', result.value, color ?? null, result.error ?? null);
          }
          done++;
        }
      })();
      onProgress?.(done, total);
    });
    if (cancelled()) return abort();
  }
  for (const columnId of circular) {
    const column = byId.get(columnId);
    if (!column) continue;
    scanDatabaseRows(databaseId, (meta) => {
      if (cancelled()) return false;
      db.transaction(() => {
        for (const row of meta) {
          save(row.id, column, 'formula', null, null, 'Referencia circular: la fórmula se usa a sí misma.');
          done++;
        }
      })();
      onProgress?.(done, total);
    });
    if (cancelled()) return abort();
  }
  db.transaction(() => {
    db.prepare(
      `INSERT INTO db_computed_cells
        (database_id, row_id, column_id, computed_kind, value_type, value_text, value_number,
         value_integer, value_date, value_json, color, error, source_revision, revision, updated_at)
       SELECT database_id, row_id, column_id, computed_kind, value_type, value_text, value_number,
              value_integer, value_date, value_json, color, error, source_revision, revision, updated_at
       FROM nodus_computed_stage WHERE database_id = ?
       ON CONFLICT(row_id, column_id) DO UPDATE SET
         computed_kind = excluded.computed_kind, value_type = excluded.value_type,
         value_text = excluded.value_text, value_number = excluded.value_number,
         value_integer = excluded.value_integer, value_date = excluded.value_date,
         value_json = excluded.value_json, color = excluded.color, error = excluded.error,
         source_revision = excluded.source_revision, revision = db_computed_cells.revision + 1,
         updated_at = excluded.updated_at`,
    ).run(databaseId);
    db.prepare(
      `DELETE FROM db_computed_cells WHERE database_id = ?
       AND NOT EXISTS (SELECT 1 FROM nodus_computed_stage stage
                       WHERE stage.row_id = db_computed_cells.row_id AND stage.column_id = db_computed_cells.column_id)`,
    ).run(databaseId);
    rebuildColumnDependencies(databaseId, columns);
  })();
  db.exec('DROP TABLE temp.nodus_computed_stage');
  return { done, total, cancelled: false };
  } catch (error) {
    db.exec('DROP TABLE IF EXISTS temp.nodus_computed_stage');
    throw error;
  }
}

const derivedMaterializationCache = new Map<string, number>();

function ensureDerivedMaterialized(databaseId: string, columns: DatabaseColumn[]): void {
  const count = derivedColumns(columns).length;
  if (count === 0) return;
  const db = getDb();
  const expected = rowCountOf(databaseId) * count;
  if (derivedMaterializationCache.get(databaseId) === expected) return;
  const actual = Number((db.prepare('SELECT COUNT(*) AS count FROM db_computed_cells WHERE database_id = ?').get(databaseId) as { count: number }).count);
  if (actual !== expected) recomputeDatabaseDerived(databaseId);
  derivedMaterializationCache.set(databaseId, expected);
}

function hydrateRows(metaRows: RowMeta[], databaseId: string, columns = getColumns(databaseId), readOnly = false): DatabaseRow[] {
  const db = getDb();
  if (metaRows.length === 0) return [];
  if(!readOnly)ensureDerivedMaterialized(databaseId, columns);
  const rowIndex = new Map<string, DatabaseRow>();
  const out: DatabaseRow[] = metaRows.map((m) => {
    const row: DatabaseRow = {
      id: m.id,
      databaseId: m.database_id,
      position: m.position,
      cells: {},
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      revision: m.revision,
      createdBy: m.created_by,
      updatedBy: m.updated_by,
      uniqueSequence: m.unique_sequence,
    };
    rowIndex.set(m.id, row);
    return row;
  });
  const placeholders = metaRows.map(() => '?').join(',');
  const cells = db
    .prepare(`SELECT row_id, column_id, ${STORED_CELL_COLUMNS} FROM db_cells WHERE database_id = ? AND row_id IN (${placeholders})`)
    .all(databaseId, ...metaRows.map((m) => m.id)) as Array<StoredCellRow & { row_id: string; column_id: string }>;
  for (const cell of cells) {
    const row = rowIndex.get(cell.row_id);
    if (row) row.cells[cell.column_id] = storedCellRaw(cell);
  }
  const computed = db.prepare(
    `SELECT row_id, column_id, computed_kind, ${STORED_CELL_COLUMNS.replace(', value_reference', '')}, color, error
     FROM db_computed_cells WHERE database_id = ? AND row_id IN (${placeholders})`,
  ).all(databaseId, ...metaRows.map((meta) => meta.id)) as ComputedCellRow[];
  for (const cell of computed) {
    const row = rowIndex.get(cell.row_id);
    if (!row) continue;
    const raw = storedCellRaw(cell);
    if (cell.computed_kind === 'formula') row.cells[cell.column_id] = raw;
    else (row.rollups ??= {})[cell.column_id] = raw ?? '';
    if (cell.color) (row.formulaColors ??= {})[cell.column_id] = cell.color;
    if (cell.error) (row.formulaErrors ??= {})[cell.column_id] = cell.error;
  }
  const attByRow = attachmentsForRows(metaRows.map((m) => m.id));
  for (const [rowId, byCol] of attByRow) {
    const row = rowIndex.get(rowId);
    if (row) row.attachments = byCol;
  }
  const relByRow = relationCountsForRows(metaRows.map((m) => m.id));
  for (const [rowId, byCol] of relByRow) {
    const row = rowIndex.get(rowId);
    if (row) row.relationCounts = byCol;
  }
  for (const row of out) {
    for (const column of columns) {
      switch (column.type) {
        case 'created_time': row.cells[column.id] = row.createdAt; break;
        case 'last_edited_time': row.cells[column.id] = row.updatedAt; break;
        case 'created_by': row.cells[column.id] = encodeDatabasePeople([
          { id: row.createdBy ?? 'local', label: row.createdBy ?? 'local', kind: 'person' },
        ]); break;
        case 'last_edited_by': row.cells[column.id] = encodeDatabasePeople([
          { id: row.updatedBy ?? 'local', label: row.updatedBy ?? 'local', kind: 'person' },
        ]); break;
        case 'unique_id': row.cells[column.id] = formatUniqueDatabaseId(
          column.config.uniqueIdPrefix, column.config.uniqueIdPadding, row.uniqueSequence ?? row.position + 1,
        ); break;
      }
    }
  }
  return out;
}

/** Keyset-paginated row query. Interactive callers can never receive more than 500 rows. */
export function queryDatabaseRows(input: DatabaseRowQuery, {readOnly = false}: {readOnly?:boolean} = {}): DatabaseRowPage {
  const db = getDb();
  const resolved = resolveRowQuery(input);
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(resolved.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  const revision = database.revision;
  const hash = queryHash(resolved);
  const limit = clampDatabaseRowPageLimit(input.limit);
  const direction = input.direction === 'backward' ? 'backward' : 'forward';
  const columns = getColumns(resolved.databaseId);
  if(!readOnly)ensureDerivedMaterialized(resolved.databaseId, columns);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const params: Record<string, string | number> = { databaseId: resolved.databaseId };
  const fastNumber = indexedNumberFilter(resolved.filter, byId);
  let filterSql = compileFilter(resolved.filter, byId, params);
  let candidateFrom = 'db_rows r';
  if (fastNumber) {
    params.fastFilterColumn = fastNumber.column.id;
    params.fastFilterValue = fastNumber.value;
    filterSql = `fast_filter.value_number ${fastNumber.operator} @fastFilterValue`;
    candidateFrom = `db_cells fast_filter INDEXED BY idx_db_cells_number_value
      JOIN db_rows r ON r.database_id = fast_filter.database_id AND r.id = fast_filter.row_id`;
  }

  const cacheKey = `${resolved.databaseId}:${revision}:${hash}`;
  let totalCount = rowCountCache.get(cacheKey);
  if (totalCount == null) {
    totalCount = Number((db.prepare(
      fastNumber
        ? `SELECT COUNT(*) AS count FROM db_cells fast_filter INDEXED BY idx_db_cells_number_value
           WHERE fast_filter.database_id = @databaseId AND fast_filter.column_id = @fastFilterColumn
             AND fast_filter.value_number ${fastNumber.operator} @fastFilterValue`
        : `SELECT COUNT(*) AS count FROM db_rows r WHERE r.database_id = @databaseId AND ${filterSql}`,
    ).get(params) as { count: number }).count);
    rowCountCache.set(cacheKey, totalCount);
    if (rowCountCache.size > 200) rowCountCache.delete(rowCountCache.keys().next().value!);
  }

  const requested: Array<{ columnId: string; dir: 'asc' | 'desc' }> = [];
  for (const group of resolved.groups) requested.push({ columnId: group.columnId, dir: group.dir ?? 'asc' });
  for (const sort of resolved.sorts) if (!requested.some((item) => item.columnId === sort.columnId)) requested.push(sort);
  const joins: string[] = [];
  const keys: QueryOrderKey[] = [];
  const fastIndexedOrder = Boolean(fastNumber && resolved.groups.length === 0 && requested.length === 1
    && requested[0].columnId === fastNumber.column.id);
  for (const [index, rule] of requested.entries()) {
    const column = byId.get(rule.columnId);
    if (!column) throw new Error(`La propiedad de orden no pertenece a esta base de datos: ${rule.columnId}`);
    const metadata = metadataPropertySql(column);
    if (metadata) {
      keys.push(
        { expression: `CASE WHEN ${metadata} IS NULL OR ${metadata} = '' THEN 1 ELSE 0 END`, dir: 'asc' },
        { expression: column.type === 'unique_id' ? 'r.unique_sequence' : `LOWER(${metadata})`, dir: rule.dir },
      );
      continue;
    }
    const alias = fastNumber && column.id === fastNumber.column.id ? 'fast_filter' : `sort_cell_${index}`;
    const name = `sortColumn${index}`;
    params[name] = column.id;
    const valueTable = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
    if (alias !== 'fast_filter') {
      joins.push(`LEFT JOIN ${valueTable} ${alias} ON ${alias}.database_id = r.database_id AND ${alias}.row_id = r.id AND ${alias}.column_id = @${name}`);
    }
    const expressions = propertyOrderExpression(column, alias);
    // A range scan already proves the typed number is non-null. Omitting the constant
    // empty-key and using row_id as the stable tie-break lets SQLite satisfy the whole
    // order from (database,column,value,row_id), instead of sorting every match by the
    // unrelated display position before returning 200 rows.
    if (fastIndexedOrder) keys.push({ expression: `${alias}.value_number`, dir: rule.dir });
    else keys.push({ expression: expressions.empty, dir: 'asc' }, { expression: expressions.value, dir: rule.dir });
  }
  if (requested.length === 0) {
    switch (resolved.rowSort) {
      case 'createdAsc': keys.push({ expression: 'r.created_at', dir: 'asc' }); break;
      case 'createdDesc': keys.push({ expression: 'r.created_at', dir: 'desc' }); break;
      case 'updatedDesc': keys.push({ expression: 'r.updated_at', dir: 'desc' }); break;
      case 'position': default: keys.push({ expression: 'r.position', dir: 'asc' }); break;
    }
  } else if (!fastIndexedOrder) {
    keys.push({ expression: 'r.position', dir: 'asc' });
  }
  keys.push({ expression: 'r.id', dir: 'asc' });

  let cursor: DatabaseRowCursorPayload | null = null;
  if (input.cursor) {
    cursor = decodeRowCursor(input.cursor);
    if (cursor.queryHash !== hash) throw new Error('El cursor pertenece a otra consulta.');
    if (cursor.revision !== revision) throw new Error('La base de datos cambió; reinicia la paginación con un cursor nuevo.');
    if (cursor.values.length !== keys.length) throw new Error('El cursor no coincide con el orden de esta consulta.');
  }

  const keySelects = keys.map((key, index) => `${key.expression} AS "__key_${index}"`);
  const cursorParams: Record<string, string | number> = {};
  let cursorWhere = '';
  if (cursor) {
    cursor.values.forEach((value, index) => { cursorParams[`cursor${index}`] = value; });
    const alternatives = keys.map((key, index) => {
      const equals = keys.slice(0, index).map((_previous, previous) => `"__key_${previous}" = @cursor${previous}`);
      const normalAfter = key.dir === 'asc' ? '>' : '<';
      const operator = direction === 'forward' ? normalAfter : normalAfter === '>' ? '<' : '>';
      return `(${[...equals, `"__key_${index}" ${operator} @cursor${index}`].join(' AND ')})`;
    });
    cursorWhere = `WHERE ${alternatives.join(' OR ')}`;
  }
  params.pageLimit = limit + 1;
  Object.assign(params, cursorParams);
  const orderSql = keys.map((key, index) => {
    const dir = direction === 'forward' ? key.dir : key.dir === 'asc' ? 'desc' : 'asc';
    return `"__key_${index}" ${dir.toUpperCase()}`;
  }).join(', ');
  const sql = `
    WITH candidates AS (
      SELECT r.id, r.database_id, r.position, r.created_at, r.updated_at,
             r.revision, r.created_by, r.updated_by, r.unique_sequence, ${keySelects.join(', ')}
      FROM ${candidateFrom} ${joins.join(' ')}
      WHERE r.database_id = @databaseId ${fastNumber ? 'AND fast_filter.column_id = @fastFilterColumn' : ''} AND ${filterSql}
    )
    SELECT * FROM candidates ${cursorWhere}
    ORDER BY ${orderSql}
    LIMIT @pageLimit`;
  const fetched = db.prepare(sql).all(params) as Array<RowMeta & Record<string, string | number>>;
  const hasMore = fetched.length > limit;
  let selected = hasMore ? fetched.slice(0, limit) : fetched;
  if (direction === 'backward') selected = selected.reverse();
  const rows = hydrateRows(selected, resolved.databaseId, columns, readOnly);
  const cursorFor = (row: RowMeta & Record<string, string | number>) => encodeRowCursor({
    v: DATABASE_ROW_CURSOR_VERSION,
    queryHash: hash,
    revision,
    values: keys.map((_key, index) => row[`__key_${index}`]),
  });
  const first = selected[0];
  const last = selected[selected.length - 1];
  return {
    rows,
    nextCursor: last && (direction === 'forward' ? hasMore : Boolean(input.cursor)) ? cursorFor(last) : null,
    previousCursor: first && (direction === 'backward' ? hasMore : Boolean(input.cursor)) ? cursorFor(first) : null,
    totalCount,
    revision,
    queryHash: hash,
    hasMore,
  };
}

interface TemporalSourceRow extends RowMeta {
  start_raw: string | null;
  end_raw: string | null;
  title_raw: string | null;
}

function temporalCellRawSql(alias: string): string {
  return `COALESCE(${alias}.value_text, ${alias}.value_json, ${alias}.value_date)`;
}

function temporalCellStartSql(alias: string): string {
  const raw = temporalCellRawSql(alias);
  return `CASE WHEN json_valid(${raw}) THEN json_extract(${raw}, '$.start') ELSE ${raw} END`;
}

/**
 * Windowed date/range query for Calendar and Timeline. It returns occurrences rather
 * than whole rows, remains bounded to 500 objects, and only hydrates the title and
 * requested dependency targets. Recurring sources are expanded in the shared domain so
 * the exact same DST/calendar rules are used in main, tests and renderer previews.
 */
export function queryDatabaseTemporalEvents(input: DatabaseTemporalQuery): DatabaseTemporalEventPage {
  const db = getDb();
  if (!input || typeof input.databaseId !== 'string' || !input.databaseId) throw new Error('Base de datos no válida.');
  const windowStartMs = Date.parse(input.windowStart); const windowEndMs = Date.parse(input.windowEnd);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    throw new Error('Ventana temporal no válida.');
  }
  const columns = getColumns(input.databaseId);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const startColumn = byId.get(input.startColumnId);
  const endColumn = input.endColumnId ? byId.get(input.endColumnId) : null;
  const dependencyColumn = input.dependencyColumnId ? byId.get(input.dependencyColumnId) : null;
  if (!startColumn || startColumn.type !== 'date') throw new Error('La fecha inicial debe ser una propiedad Fecha de esta base.');
  if (input.endColumnId && (!endColumn || endColumn.type !== 'date')) throw new Error('La fecha final debe ser una propiedad Fecha de esta base.');
  if (input.dependencyColumnId && (!dependencyColumn || dependencyColumn.type !== 'relation')) {
    throw new Error('Las dependencias deben usar una propiedad Relación de esta base.');
  }
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  const limit = Math.max(1, Math.min(DATABASE_TEMPORAL_EVENT_LIMIT, Math.floor(input.limit ?? DATABASE_TEMPORAL_EVENT_LIMIT)));
  const titleColumn = columns.find((column) => column.type === 'title');
  const params: Record<string, string | number | null> = {
    databaseId: input.databaseId,
    startColumnId: startColumn.id,
    endColumnId: endColumn?.id ?? null,
    titleColumnId: titleColumn?.id ?? null,
    // A two-day guard absorbs every legal UTC offset and DST boundary. Exact overlap is
    // checked after IANA-zone resolution below.
    coarseStart: new Date(windowStartMs - 2 * 86_400_000).toISOString().slice(0, 19),
    coarseEnd: new Date(windowEndMs + 2 * 86_400_000).toISOString().slice(0, 19),
    sourceLimit: Math.max(2_000, limit * 4) + 1,
  };
  if (input.filter) assertFilterNode(input.filter);
  const filterSql = compileFilter(input.filter ?? null, byId, params as Record<string, string | number>);
  const startValue = temporalCellStartSql('start_cell');
  const startRaw = temporalCellRawSql('start_cell');
  const endRaw = temporalCellRawSql('end_cell');
  const endValue = endColumn ? temporalCellStartSql('end_cell')
    : `CASE WHEN json_valid(${startRaw}) THEN json_extract(${startRaw}, '$.end') ELSE NULL END`;
  const recurrence = `CASE WHEN json_valid(${startRaw}) THEN json_extract(${startRaw}, '$.recurrence') ELSE NULL END`;
  const sources = db.prepare(
    `SELECT r.id, r.database_id, r.position, r.created_at, r.updated_at, r.revision,
            r.created_by, r.updated_by, r.unique_sequence,
            ${startRaw} AS start_raw,
            ${endColumn ? endRaw : 'NULL'} AS end_raw,
            ${temporalCellRawSql('title_cell')} AS title_raw
     FROM db_rows r
     JOIN db_cells start_cell ON start_cell.database_id = r.database_id
       AND start_cell.row_id = r.id AND start_cell.column_id = @startColumnId
     LEFT JOIN db_cells end_cell ON @endColumnId IS NOT NULL AND end_cell.database_id = r.database_id
       AND end_cell.row_id = r.id AND end_cell.column_id = @endColumnId
     LEFT JOIN db_cells title_cell ON @titleColumnId IS NOT NULL AND title_cell.database_id = r.database_id
       AND title_cell.row_id = r.id AND title_cell.column_id = @titleColumnId
     WHERE r.database_id = @databaseId AND ${filterSql}
       AND ${startValue} < @coarseEnd
       AND ((${recurrence} IS NOT NULL) OR COALESCE(${endValue}, ${startValue}) >= @coarseStart)
     ORDER BY ${startValue}, r.id
     LIMIT @sourceLimit`,
  ).all(params) as TemporalSourceRow[];

  const dependencyMap = new Map<string, string[]>();
  if (dependencyColumn && sources.length > 0) {
    const ids = sources.slice(0, Math.max(2_000, limit * 4)).map((source) => source.id);
    const relations = db.prepare(
      `SELECT row_id, target_id FROM db_relations
       WHERE column_id = ? AND target_kind = 'db_row' AND row_id IN (${ids.map(() => '?').join(',')})
       ORDER BY position, id`,
    ).all(dependencyColumn.id, ...ids) as Array<{ row_id: string; target_id: string }>;
    for (const relation of relations) {
      const targets = dependencyMap.get(relation.row_id) ?? [];
      targets.push(relation.target_id); dependencyMap.set(relation.row_id, targets);
    }
  }

  const events: DatabaseTemporalEvent[] = [];
  let truncated = sources.length > Number(params.sourceLimit) - 1;
  const occurrenceLimit = Math.min(limit + 1, Math.max(2, Math.ceil((windowEndMs - windowStartMs) / 86_400_000) + 3));
  const temporalSort = (left: DatabaseTemporalEvent, right: DatabaseTemporalEvent) => Date.parse(left.startUtc) - Date.parse(right.startUtc)
    || Date.parse(left.endUtc) - Date.parse(right.endUtc) || left.sourceRowId.localeCompare(right.sourceRowId);
  for (const source of sources.slice(0, Number(params.sourceLimit) - 1)) {
    const value = decodeDatabaseDate(source.start_raw);
    if (!value) continue;
    if (source.end_raw) value.end = decodeDatabaseDate(source.end_raw)?.start ?? value.end;
    try {
      const occurrences = expandDatabaseDateOccurrences(value, input.windowStart, input.windowEnd, input.timeZone, occurrenceLimit);
      for (const occurrence of occurrences) {
        events.push({
          id: `${source.id}:${occurrence.occurrence}`,
          sourceRowId: source.id,
          title: source.title_raw?.trim() || 'Sin título',
          start: occurrence.start,
          end: occurrence.end,
          startUtc: occurrence.startUtc,
          endUtc: occurrence.endUtc,
          includeTime: Boolean(value.includeTime),
          timeZone: value.timeZone || input.timeZone || 'UTC',
          recurrence: value.recurrence ?? null,
          occurrence: occurrence.occurrence,
          dstAdjustment: occurrence.dstAdjustment,
          dependencies: dependencyMap.get(source.id) ?? [],
          rowRevision: source.revision,
        });
      }
    } catch {
      // A malformed historical date stays editable in its cell and does not make every
      // valid event disappear from the calendar.
    }
    if (events.length > limit) {
      truncated = true;
      events.sort(temporalSort);
      events.splice(limit);
    }
  }
  events.sort(temporalSort);
  return { events, revision: database.revision, truncated, sourceRowsScanned: Math.min(sources.length, Number(params.sourceLimit) - 1),
    windowStart: input.windowStart, windowEnd: input.windowEnd };
}

/** Persist a Calendar drag or Timeline drag/resize with optimistic revision checking. */
export function updateDatabaseTemporalRange(input: DatabaseTemporalRangeUpdate): DatabaseTemporalRangeUpdateResult {
  const db = getDb();
  const columns = getColumns(input.databaseId);
  const startColumn = columns.find((column) => column.id === input.startColumnId);
  const endColumn = input.endColumnId ? columns.find((column) => column.id === input.endColumnId) : null;
  if (!startColumn || startColumn.type !== 'date') throw new Error('La fecha inicial no es válida.');
  if (input.endColumnId && (!endColumn || endColumn.type !== 'date')) throw new Error('La fecha final no es válida.');
  const startResolved = resolveDatabaseZonedDate(input.start, input.timeZone);
  const finalEnd = input.end || input.start;
  const endResolved = resolveDatabaseZonedDate(finalEnd, input.timeZone);
  if (Date.parse(endResolved.utc) < Date.parse(startResolved.utc)) throw new Error('La fecha final no puede ser anterior a la inicial.');
  const currentStartRecord = db.prepare(
    `SELECT ${STORED_CELL_COLUMNS} FROM db_cells WHERE database_id = ? AND row_id = ? AND column_id = ?`,
  ).get(input.databaseId, input.rowId, startColumn.id) as StoredCellRow | undefined;
  const currentStart = decodeDatabaseDate(currentStartRecord ? storedCellRaw(currentStartRecord) : null);
  if (!currentStart) throw new Error('La fila no tiene una fecha inicial editable.');
  const changes: DatabaseBulkEditInput['changes'] = [{
    rowId: input.rowId, columnId: startColumn.id,
    raw: encodeDatabaseDate({ ...currentStart, start: input.start, end: endColumn ? null : finalEnd,
      includeTime: input.start.includes('T'), timeZone: input.timeZone }),
  }];
  if (endColumn) {
    const endRecord = db.prepare(
      `SELECT ${STORED_CELL_COLUMNS} FROM db_cells WHERE database_id = ? AND row_id = ? AND column_id = ?`,
    ).get(input.databaseId, input.rowId, endColumn.id) as StoredCellRow | undefined;
    const currentEnd = decodeDatabaseDate(endRecord ? storedCellRaw(endRecord) : null);
    changes.push({ rowId: input.rowId, columnId: endColumn.id,
      raw: encodeDatabaseDate({ ...(currentEnd ?? currentStart), start: finalEnd, end: null,
        includeTime: finalEnd.includes('T'), timeZone: input.timeZone, recurrence: null }) });
  }
  const result = setCellsBulk({ databaseId: input.databaseId, expectedRevision: input.expectedRevision, changes });
  const row = result.rows.find((candidate) => candidate.id === input.rowId);
  if (!row) throw new Error('Fila no encontrada tras actualizar la fecha.');
  return { databaseId: input.databaseId, rowId: input.rowId, revision: result.revision, rowRevision: row.revision ?? 1,
    start: input.start, end: finalEnd,
    dstAdjustment: startResolved.adjustment !== 'none' ? startResolved.adjustment : endResolved.adjustment };
}

function visualizationColumnSql(
  column: DatabaseColumn,
  alias: string,
  joins: string[],
  params: Record<string, string | number>,
): { raw: string; number: string } {
  const metadata = metadataPropertySql(column);
  if (metadata) return { raw: metadata, number: `CAST(${metadata} AS REAL)` };
  const table = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
  const parameter = `${alias}ColumnId`;
  params[parameter] = column.id;
  joins.push(`LEFT JOIN ${table} ${alias} ON ${alias}.database_id = r.database_id AND ${alias}.row_id = r.id AND ${alias}.column_id = @${parameter}`);
  return {
    raw: rawCellSql(alias),
    number: `COALESCE(${alias}.value_number, CAST(${alias}.value_text AS REAL))`,
  };
}

function visualizationLabel(column: DatabaseColumn, raw: string): string {
  if (!raw) return 'Sin valor';
  if (column.type === 'select' || column.type === 'status') return column.options.find((option) => option.id === raw)?.label ?? raw;
  if (column.type === 'checkbox') return raw === '1' || raw === 'true' ? 'Sí' : 'No';
  if (column.type === 'date') return decodeDatabaseDate(raw)?.start ?? raw;
  return raw;
}

function visualizationDrilldownCondition(column: DatabaseColumn, raw: string): FilterNode {
  if (!raw) return { type: 'condition', columnId: column.id, op: 'isEmpty', value: null };
  const operators = operatorsForColumn(column);
  if (operators.includes('isAnyOf')) return { type: 'condition', columnId: column.id, op: 'isAnyOf', value: [raw] };
  if (operators.includes('equals')) return { type: 'condition', columnId: column.id, op: 'equals', value: raw };
  if (operators.includes('isChecked')) {
    return { type: 'condition', columnId: column.id, op: raw === '1' || raw === 'true' ? 'isChecked' : 'isUnchecked', value: null };
  }
  return { type: 'condition', columnId: column.id, op: 'notEmpty', value: null };
}

/** Bounded SQL GROUP BY used by every chart and board-like dashboard summary. */
export function queryDatabaseChart(input: DatabaseChartQuery): DatabaseChartResult {
  const db = getDb();
  const columns = getColumns(input.databaseId); const byId = new Map(columns.map((column) => [column.id, column]));
  const xColumn = byId.get(input.xColumnId); const yColumn = input.yColumnId ? byId.get(input.yColumnId) : null;
  const seriesColumn = input.seriesColumnId ? byId.get(input.seriesColumnId) : null;
  if (!xColumn) throw new Error('El eje X no pertenece a esta base de datos.');
  if (input.yColumnId && !yColumn) throw new Error('El eje Y no pertenece a esta base de datos.');
  if (input.seriesColumnId && !seriesColumn) throw new Error('La serie no pertenece a esta base de datos.');
  if (input.aggregation !== 'count' && !yColumn) throw new Error('Esta agregación necesita un eje Y.');
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  if (input.filter) assertFilterNode(input.filter);
  const params: Record<string, string | number> = { databaseId: input.databaseId };
  const joins: string[] = []; const x = visualizationColumnSql(xColumn, 'chart_x', joins, params);
  const y = yColumn ? visualizationColumnSql(yColumn, 'chart_y', joins, params) : null;
  const series = seriesColumn ? visualizationColumnSql(seriesColumn, 'chart_series', joins, params) : null;
  const filterSql = compileFilter(input.filter ?? null, byId, params);
  const xKey = `COALESCE(CAST(${x.raw} AS TEXT), '')`; const seriesKey = series ? `COALESCE(CAST(${series.raw} AS TEXT), '')` : `''`;
  const validY = y ? `${y.number} IS NOT NULL` : '1';
  const aggregate = input.aggregation === 'count' ? 'COUNT(*)'
    : input.aggregation === 'sum' ? `COALESCE(SUM(CASE WHEN ${validY} THEN ${y!.number} END),0)`
      : input.aggregation === 'average' ? `COALESCE(AVG(CASE WHEN ${validY} THEN ${y!.number} END),0)`
        : input.aggregation === 'min' ? `COALESCE(MIN(CASE WHEN ${validY} THEN ${y!.number} END),0)`
          : `COALESCE(MAX(CASE WHEN ${validY} THEN ${y!.number} END),0)`;
  const groupSql = `FROM db_rows r ${joins.join(' ')} WHERE r.database_id = @databaseId AND ${filterSql} GROUP BY ${xKey}, ${seriesKey}`;
  const totalGroups = Number((db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${groupSql})`).get(params) as { n: number }).n);
  const limit = Math.max(1, Math.min(DATABASE_CHART_POINT_LIMIT, Math.floor(input.limit ?? DATABASE_CHART_POINT_LIMIT)));
  const rows = db.prepare(
    `SELECT ${xKey} AS x_key, ${seriesKey} AS series_key, ${aggregate} AS value, COUNT(*) AS row_count,
            AVG(CAST(${x.number} AS REAL)) AS x_number, ${y ? `AVG(CAST(${y.number} AS REAL))` : 'NULL'} AS y_number
     ${groupSql}
     ORDER BY ${input.type === 'line' || input.type === 'area' || input.type === 'scatter' ? 'x_key, series_key' : 'value DESC, x_key, series_key'}
     LIMIT @chartLimit`,
  ).all({ ...params, chartLimit: limit + 1 }) as Array<{ x_key: string; series_key: string; value: number; row_count: number; x_number: number | null; y_number: number | null }>;
  const points: DatabaseChartPoint[] = rows.slice(0, limit).map((row) => {
    const conditions: FilterNode[] = [visualizationDrilldownCondition(xColumn, row.x_key)];
    if (seriesColumn) conditions.push(visualizationDrilldownCondition(seriesColumn, row.series_key));
    return { key: row.x_key, label: visualizationLabel(xColumn, row.x_key), seriesKey: row.series_key,
      seriesLabel: seriesColumn ? visualizationLabel(seriesColumn, row.series_key) : '', value: Number(row.value), rowCount: Number(row.row_count),
      xNumber: row.x_number == null ? null : Number(row.x_number), yNumber: row.y_number == null ? null : Number(row.y_number),
      drilldownFilter: conditions.length === 1 ? conditions[0] : { type: 'group', operator: 'and', children: conditions } };
  });
  const nullRows = points.filter((point) => point.key === '').reduce((sum, point) => sum + point.rowCount, 0);
  return { points, totalGroups, truncated: totalGroups > limit, revision: database.revision, nullRows };
}

/** Location projection with exact filtering and a hard 500-marker IPC budget. */
export function queryDatabaseMap(input: DatabaseMapQuery): DatabaseMapResult {
  const db = getDb(); const columns = getColumns(input.databaseId); const byId = new Map(columns.map((column) => [column.id, column]));
  const location = byId.get(input.locationColumnId);
  if (!location || location.type !== 'location') throw new Error('El mapa necesita una propiedad Ubicación de esta base.');
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  if (input.filter) assertFilterNode(input.filter);
  const title = columns.find((column) => column.type === 'title');
  const params: Record<string, string | number> = { databaseId: input.databaseId, locationColumnId: location.id,
    titleColumnId: title?.id ?? '', mapLimit: Math.max(1, Math.min(DATABASE_MAP_MARKER_LIMIT, Math.floor(input.limit ?? DATABASE_MAP_MARKER_LIMIT))) + 1 };
  const filterSql = compileFilter(input.filter ?? null, byId, params);
  const json = 'COALESCE(location_cell.value_json, location_cell.value_text)';
  const rows = db.prepare(
    `SELECT r.id, COALESCE(title_cell.value_text, '') AS title, ${json} AS location_json,
            json_extract(${json}, '$.name') AS name, json_extract(${json}, '$.latitude') AS latitude,
            json_extract(${json}, '$.longitude') AS longitude
     FROM db_rows r
     JOIN db_cells location_cell ON location_cell.database_id = r.database_id AND location_cell.row_id = r.id
       AND location_cell.column_id = @locationColumnId
     LEFT JOIN db_cells title_cell ON title_cell.database_id = r.database_id AND title_cell.row_id = r.id
       AND title_cell.column_id = @titleColumnId
     WHERE r.database_id = @databaseId AND ${filterSql} AND json_valid(${json})
       AND json_type(${json}, '$.latitude') IN ('integer','real') AND json_type(${json}, '$.longitude') IN ('integer','real')
       AND json_extract(${json}, '$.latitude') BETWEEN -90 AND 90 AND json_extract(${json}, '$.longitude') BETWEEN -180 AND 180
     ORDER BY r.position, r.id LIMIT @mapLimit`,
  ).all(params) as Array<{ id: string; title: string; name: string; latitude: number; longitude: number }>;
  const limit = Number(params.mapLimit) - 1;
  const totalCount = Number((db.prepare(
    `SELECT COUNT(*) AS n FROM db_rows r JOIN db_cells location_cell ON location_cell.database_id=r.database_id AND location_cell.row_id=r.id AND location_cell.column_id=@locationColumnId
     WHERE r.database_id=@databaseId AND ${filterSql} AND json_valid(${json})
       AND json_type(${json}, '$.latitude') IN ('integer','real') AND json_type(${json}, '$.longitude') IN ('integer','real')
       AND json_extract(${json}, '$.latitude') BETWEEN -90 AND 90 AND json_extract(${json}, '$.longitude') BETWEEN -180 AND 180`,
  ).get(params) as { n: number }).n);
  const markers: DatabaseMapMarker[] = rows.slice(0, limit).map((row) => ({ id: `marker:${row.id}`, rowId: row.id,
    title: row.title || 'Sin título', name: row.name || row.title || 'Ubicación', latitude: Number(row.latitude), longitude: Number(row.longitude) }));
  return { markers, totalCount, truncated: totalCount > limit, revision: database.revision };
}

/** Chronological row/page feed; page updates join the universal page projection. */
export function queryDatabaseFeed(input: DatabaseFeedQuery): DatabaseFeedResult {
  const db = getDb(); const columns = getColumns(input.databaseId); const byId = new Map(columns.map((column) => [column.id, column]));
  const dateColumn = input.dateColumnId ? byId.get(input.dateColumnId) : null;
  if (input.dateColumnId && (!dateColumn || dateColumn.type !== 'date')) throw new Error('El feed necesita una propiedad Fecha válida.');
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  if (input.filter) assertFilterNode(input.filter);
  const titleColumn = columns.find((column) => column.type === 'title');
  const params: Record<string, string | number> = { databaseId: input.databaseId, titleColumnId: titleColumn?.id ?? '', feedLimit: Math.max(1, Math.min(DATABASE_FEED_LIMIT, Math.floor(input.limit ?? DATABASE_FEED_LIMIT))) + 1 };
  const joins: string[] = [];
  const date = dateColumn ? visualizationColumnSql(dateColumn, 'feed_date', joins, params) : null;
  const filterSql = compileFilter(input.filter ?? null, byId, params);
  const occurred = date ? `CASE WHEN json_valid(${date.raw}) THEN json_extract(${date.raw}, '$.start') ELSE ${date.raw} END`
    : input.includePageChanges === false ? 'r.created_at' : 'COALESCE(page.updated_at, r.updated_at)';
  const rows = db.prepare(
    `SELECT r.id, page.id AS page_id, COALESCE(title_cell.value_text, page.title, '') AS title,
            ${occurred} AS occurred_at, r.created_at, r.updated_at, r.updated_by,
            CASE WHEN ${date ? '1' : '0'} = 1 THEN 'date' WHEN COALESCE(page.updated_at,r.updated_at)=r.created_at THEN 'created' ELSE 'edited' END AS kind
     FROM db_rows r ${joins.join(' ')}
     LEFT JOIN db_cells title_cell ON title_cell.database_id=r.database_id AND title_cell.row_id=r.id AND title_cell.column_id=@titleColumnId
     LEFT JOIN pages page ON page.row_id=r.id AND page.state='active'
     WHERE r.database_id=@databaseId AND ${filterSql} AND ${occurred} IS NOT NULL AND ${occurred} <> ''
     ORDER BY occurred_at DESC, r.id LIMIT @feedLimit`,
  ).all(params) as Array<{ id: string; page_id: string | null; title: string; occurred_at: string; updated_by: string; kind: DatabaseFeedItem['kind'] }>;
  const limit = Number(params.feedLimit) - 1;
  const items: DatabaseFeedItem[] = rows.slice(0, limit).map((row) => ({ id: `feed:${row.kind}:${row.id}:${row.occurred_at}`, rowId: row.id,
    pageId: row.page_id, title: row.title || 'Sin título', occurredAt: row.occurred_at, kind: row.kind, actor: row.updated_by,
    summary: row.kind === 'date' ? 'Fecha de la página' : row.kind === 'created' ? 'Página creada' : 'Página actualizada' }));
  return { items, totalCount: rows.length > limit ? limit + 1 : items.length, truncated: rows.length > limit, revision: database.revision };
}

/** Legacy adapter. It intentionally walks keyset pages and never issues SQL OFFSET. */
export function listRows(
  databaseId: string,
  opts: { sort?: DatabaseRowSort; limit?: number; offset?: number } = {},
): DatabaseRow[] {
  if (!getDb().prepare('SELECT 1 FROM db_databases WHERE id = ?').get(databaseId)) return [];
  const wanted = opts.limit == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(opts.limit));
  const skip = Math.max(0, Math.floor(opts.offset ?? 0));
  const rows: DatabaseRow[] = [];
  let seen = 0;
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, rowSort: opts.sort ?? 'position', cursor, limit: 500 });
    for (const row of page.rows) {
      if (seen++ < skip) continue;
      if (rows.length < wanted) rows.push(row);
    }
    cursor = page.nextCursor;
    if (rows.length >= wanted) break;
  } while (cursor);
  return rows;
}

/**
 * Fill each row's `rollups` for the database's rollup columns. A rollup aggregates a
 * property from the rows a db_row relation column links to: gather the related target
 * rows, read the chosen target column's value (resolving select labels), then apply the
 * rollup function. Only db_row relations are rollable (Notion's model). Read-only.
 */
function computeRollups(rows: DatabaseRow[], columns: DatabaseColumn[]): void {
  const rollupCols = columns.filter((c) => c.type === 'rollup');
  if (rollupCols.length === 0 || rows.length === 0) return;
  const db = getDb();
  const rowIds = rows.map((r) => r.id);
  const inRows = `(${rowIds.map(() => '?').join(',')})`;
  for (const rc of rollupCols) {
    const relColId = rc.config.rollupRelationColumnId as string | undefined;
    const fn = (rc.config.rollupFunction as RollupFunction) ?? 'show';
    const relCol = relColId ? columns.find((c) => c.id === relColId) : undefined;
    const targetDbId = relCol?.config.relationTargetDatabaseId as string | undefined;
    if (!relCol || relCol.type !== 'relation' || relCol.config.relationTargetKind !== 'db_row' || !targetDbId) {
      for (const r of rows) (r.rollups ??= {})[rc.id] = '';
      continue;
    }
    // Related target-row ids per source row.
    const rels = db
      .prepare(`SELECT row_id, target_id FROM db_relations WHERE column_id = ? AND target_kind = 'db_row' AND row_id IN ${inRows}
        ORDER BY row_id, position, created_at, id`)
      .all(relColId, ...rowIds) as { row_id: string; target_id: string }[];
    const relatedByRow = new Map<string, string[]>();
    const allTargetIds = new Set<string>();
    for (const r of rels) {
      let arr = relatedByRow.get(r.row_id);
      if (!arr) relatedByRow.set(r.row_id, (arr = []));
      arr.push(r.target_id);
      allTargetIds.add(r.target_id);
    }
    // The target column ('__title__' → the related db's Title column).
    const targetColId = rc.config.rollupTargetColumnId as string | undefined;
    const targetCols = getColumns(targetDbId);
    const targetCol =
      !targetColId || targetColId === '__title__' ? targetCols.find((c) => c.type === 'title') ?? targetCols[0] : targetCols.find((c) => c.id === targetColId);
    // Target values for every related row, in one query.
    const valueByRow = new Map<string, string | null>();
    if (targetCol && allTargetIds.size) {
      const ids = [...allTargetIds];
      const valueTable = targetCol.type === 'formula' || targetCol.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
      const valueColumns = valueTable === 'db_cells' ? STORED_CELL_COLUMNS
        : 'value_text, value_number, value_integer, value_date, value_json, NULL AS value_reference';
      const cells = db
        .prepare(`SELECT row_id, ${valueColumns} FROM ${valueTable} WHERE database_id = ? AND column_id = ? AND row_id IN (${ids.map(() => '?').join(',')})`)
        .all(targetDbId, targetCol.id, ...ids) as Array<StoredCellRow & { row_id: string }>;
      for (const c of cells) valueByRow.set(c.row_id, storedCellRaw(c));
    }
    let optLabels: Map<string, string> | null = null;
    const asLabel = (raw: string | null): string | null => {
      if (raw == null) return null;
      if (targetCol?.type === 'select') {
        optLabels ??= new Map((targetCol.options ?? []).map((o) => [o.id, o.label]));
        return optLabels.get(raw) ?? raw;
      }
      if (targetCol?.type === 'multi_select') {
        optLabels ??= new Map((targetCol.options ?? []).map((o) => [o.id, o.label]));
        return decodeMultiSelect(raw).map((id) => optLabels!.get(id) ?? id).join(', ');
      }
      return raw;
    };
    for (const r of rows) {
      const values = (relatedByRow.get(r.id) ?? []).map((tid) => asLabel(valueByRow.get(tid) ?? null));
      (r.rollups ??= {})[rc.id] = aggregateRollup(fn, values);
    }
  }
}

export function getRow(rowId: string): DatabaseRow | null {
  const db = getDb();
  const meta = db.prepare(
    `SELECT id, database_id, position, created_at, updated_at, revision,
            created_by, updated_by, unique_sequence FROM db_rows WHERE id = ?`,
  ).get(rowId) as RowMeta | undefined;
  if (!meta) return null;
  return hydrateRows([meta], meta.database_id)[0] ?? null;
}

export function deleteRow(rowId: string): void {
  const db = getDb();
  const meta = db.prepare('SELECT database_id FROM db_rows WHERE id = ?').get(rowId) as
    | { database_id: string }
    | undefined;
  const hasGlobal = meta ? getColumns(meta.database_id).some((column) => column.type === 'formula'
    && (column.config.formula as FormulaSpec | undefined)?.kind === 'columnStat') : false;
  const incoming = db.prepare(
    `SELECT * FROM db_relations WHERE target_kind = 'db_row' AND target_id = ?`,
  ).all(rowId) as RelationRow[];
  db.transaction(() => {
    for (const relation of incoming) {
      db.prepare(
        `INSERT INTO db_relation_repairs (id, relation_id, old_target_id, new_target_id, action, actor, created_at)
         VALUES (?, ?, ?, NULL, 'cascade', 'local', ?)`,
      ).run(newId('drepair'), relation.id, rowId, now());
      deleteRelationPair(db, relation, 'cascade');
    }
    db.prepare('DELETE FROM db_rows WHERE id = ?').run(rowId); // cells, source relations and materialized values cascade
  })();
  if (meta) {
    touchDatabase(meta.database_id);
    if (hasGlobal) recomputeDatabaseDerived(meta.database_id);
  }
}

/**
 * Write one cell. The raw value is normalized for the column's type; an empty value
 * deletes the cell so "no value" is a missing row, never a stray empty string.
 */
export function setCell(rowId: string, columnId: string, raw: string | null): DatabaseRow | null {
  const db = getDb();
  const col = getColumn(columnId);
  if (!col) return getRow(rowId);
  if (isReadOnlyDatabaseProperty(col.type)) throw new Error('Esta propiedad es automática y no se puede editar.');
  const context = cellContext(rowId, columnId);
  if (!context) return getRow(rowId);
  const normalized = normalizeCellValue(col.type, raw);
  if (normalized == null) {
    db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?').run(rowId, columnId);
  } else {
    writeStoredCell(rowId, columnId, context.databaseId, context.columnType, normalized);
  }
  touchRow(rowId);
  touchDatabase(col.databaseId);
  recomputeDerivedForRow(col.databaseId, rowId, columnId);
  recomputeRollupsTargetingRow(col.databaseId, columnId, rowId);
  return getRow(rowId);
}

/**
 * Apply a rectangular paste, a multi-row edit, or a Kanban move as one SQLite
 * transaction. Validation is deliberately completed before the first write, so a stale
 * revision, a foreign row/column, or one read-only property leaves every cell untouched.
 */
export function setCellsBulk(input: DatabaseBulkEditInput): DatabaseBulkEditResult {
  const db = getDb();
  if (!input || typeof input.databaseId !== 'string' || !input.databaseId) throw new Error('Base de datos no válida.');
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > DATABASE_BULK_CELL_LIMIT) {
    throw new Error(`La edición masiva debe contener entre 1 y ${DATABASE_BULK_CELL_LIMIT} celdas.`);
  }
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  if (input.expectedRevision != null && input.expectedRevision !== database.revision) {
    throw new Error(`Conflicto de revisión: se esperaba ${input.expectedRevision} y la base está en ${database.revision}.`);
  }

  const rowIds = [...new Set(input.changes.map((change) => String(change.rowId)))];
  const columnIds = [...new Set(input.changes.map((change) => String(change.columnId)))];
  const rows = db.prepare(
    `SELECT id, database_id FROM db_rows WHERE id IN (${rowIds.map(() => '?').join(',')})`,
  ).all(...rowIds) as Array<{ id: string; database_id: string }>;
  const columns = db.prepare(
    `SELECT id, database_id, type FROM db_columns WHERE id IN (${columnIds.map(() => '?').join(',')})`,
  ).all(...columnIds) as Array<{ id: string; database_id: string; type: DatabaseColumnType }>;
  if (rows.length !== rowIds.length || rows.some((row) => row.database_id !== input.databaseId)) {
    throw new Error('Una fila no existe o pertenece a otra base de datos.');
  }
  if (columns.length !== columnIds.length || columns.some((column) => column.database_id !== input.databaseId)) {
    throw new Error('Una propiedad no existe o pertenece a otra base de datos.');
  }
  const columnById = new Map(columns.map((column) => [column.id, column]));
  if (columns.some((column) => isReadOnlyDatabaseProperty(column.type))) {
    throw new Error('La edición incluye una propiedad automática que no se puede modificar.');
  }
  const seen = new Set<string>();
  const normalized = input.changes.map((change) => {
    const coordinate = `${change.rowId}\u0000${change.columnId}`;
    if (seen.has(coordinate)) throw new Error('La edición masiva contiene una celda duplicada.');
    seen.add(coordinate);
    const column = columnById.get(change.columnId)!;
    return { ...change, raw: normalizeCellValue(column.type, change.raw), column };
  });
  const changedColumnsByRow = new Map<string, Set<string>>();
  for (const change of normalized) {
    let changed = changedColumnsByRow.get(change.rowId);
    if (!changed) changedColumnsByRow.set(change.rowId, (changed = new Set()));
    changed.add(change.columnId);
  }

  db.transaction(() => {
    const remove = db.prepare('DELETE FROM db_cells WHERE database_id = ? AND row_id = ? AND column_id = ?');
    for (const change of normalized) {
      if (change.raw == null) {
        remove.run(input.databaseId, change.rowId, change.columnId);
        reindexCellSearch(change.rowId, change.columnId);
      } else {
        writeStoredCell(change.rowId, change.columnId, input.databaseId, change.column.type, change.raw);
      }
    }
    for (const [rowId, changedColumns] of changedColumnsByRow) {
      touchRow(rowId);
      // One pass computes all formula/rollup dependants after the complete row is present.
      recomputeDerivedForRow(input.databaseId, rowId);
      for (const columnId of changedColumns) recomputeRollupsTargetingRow(input.databaseId, columnId, rowId);
    }
    touchDatabase(input.databaseId);
  })();

  const revision = Number((db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number }).revision);
  return {
    databaseId: input.databaseId,
    revision,
    rowsChanged: rowIds.length,
    cellsChanged: normalized.length,
    rows: rowIds.flatMap((rowId) => {
      const row = getRow(rowId);
      return row ? [row] : [];
    }),
  };
}

/** Exact, filter-aware footer calculations performed in SQLite, never in the renderer. */
export function aggregateDatabaseRows(input: DatabaseAggregateQuery): DatabaseAggregateResult {
  const db = getDb();
  const resolved = resolveRowQuery({ databaseId: input.databaseId, viewId: input.viewId, filter: input.filter });
  const database = db.prepare('SELECT revision FROM db_databases WHERE id = ?').get(input.databaseId) as { revision: number } | undefined;
  if (!database) throw new Error('Base de datos no encontrada.');
  const allColumns = getColumns(input.databaseId);
  ensureDerivedMaterialized(input.databaseId, allColumns);
  const requested = input.columnIds == null ? allColumns : input.columnIds.map((id) => {
    const column = allColumns.find((candidate) => candidate.id === id);
    if (!column) throw new Error(`La propiedad del agregado no pertenece a esta base de datos: ${id}`);
    return column;
  });
  const params: Record<string, string | number> = { databaseId: input.databaseId };
  const filterSql = compileFilter(resolved.filter, new Map(allColumns.map((column) => [column.id, column])), params);
  const totalCount = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM db_rows r WHERE r.database_id = @databaseId AND ${filterSql}`,
  ).get(params) as { count: number }).count);

  const result = requested.map((column) => {
    const metadata = metadataPropertySql(column);
    if (metadata) {
      const numeric = comparableType(column) === 'number';
      const row = db.prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN ${metadata} IS NOT NULL AND ${metadata} <> '' THEN 1 ELSE 0 END), 0) AS non_empty,
                ${numeric ? `COALESCE(SUM(CASE WHEN CAST(${metadata} AS REAL) IS NOT NULL THEN 1 ELSE 0 END), 0)` : '0'} AS numeric_count,
                ${numeric ? `SUM(CAST(${metadata} AS REAL))` : 'NULL'} AS sum_value,
                ${numeric ? `AVG(CAST(${metadata} AS REAL))` : 'NULL'} AS average_value,
                MIN(${metadata}) AS min_value, MAX(${metadata}) AS max_value
         FROM db_rows r WHERE r.database_id = @databaseId AND ${filterSql}`,
      ).get(params) as Record<string, string | number | null>;
      return {
        columnId: column.id, count: Number(row.count), nonEmpty: Number(row.non_empty), numericCount: Number(row.numeric_count),
        sum: row.sum_value == null ? null : Number(row.sum_value), average: row.average_value == null ? null : Number(row.average_value),
        min: row.min_value, max: row.max_value,
      };
    }
    if (column.type === 'attachment' || column.type === 'files' || column.type === 'ai_image' || column.type === 'relation') {
      const table = column.type === 'relation' ? 'db_relations' : 'db_attachments';
      const edgeParams = { ...params, aggregateColumnId: column.id };
      const nonEmpty = Number((db.prepare(
        `SELECT COUNT(*) AS count FROM db_rows r WHERE r.database_id = @databaseId AND ${filterSql}
         AND EXISTS (SELECT 1 FROM ${table} edge WHERE edge.database_id = r.database_id AND edge.row_id = r.id AND edge.column_id = @aggregateColumnId)`,
      ).get(edgeParams) as { count: number }).count);
      return { columnId: column.id, count: totalCount, nonEmpty, numericCount: 0, sum: null, average: null, min: null, max: null };
    }
    const table = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
    const raw = rawCellSql('c');
    const numeric = comparableType(column) === 'number';
    const aggregateParams = { ...params, aggregateColumnId: column.id };
    const row = db.prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN c.row_id IS NOT NULL AND ${raw} IS NOT NULL AND ${raw} <> '' THEN 1 ELSE 0 END), 0) AS non_empty,
              ${numeric ? 'COUNT(c.value_number)' : '0'} AS numeric_count,
              ${numeric ? 'SUM(c.value_number)' : 'NULL'} AS sum_value,
              ${numeric ? 'AVG(c.value_number)' : 'NULL'} AS average_value,
              ${numeric ? 'MIN(c.value_number)' : `MIN(${raw})`} AS min_value,
              ${numeric ? 'MAX(c.value_number)' : `MAX(${raw})`} AS max_value
       FROM db_rows r LEFT JOIN ${table} c
         ON c.database_id = r.database_id AND c.row_id = r.id AND c.column_id = @aggregateColumnId
       WHERE r.database_id = @databaseId AND ${filterSql}`,
    ).get(aggregateParams) as Record<string, string | number | null>;
    return {
      columnId: column.id, count: Number(row.count), nonEmpty: Number(row.non_empty), numericCount: Number(row.numeric_count),
      sum: row.sum_value == null ? null : Number(row.sum_value), average: row.average_value == null ? null : Number(row.average_value),
      min: row.min_value, max: row.max_value,
    };
  });
  return { databaseId: input.databaseId, revision: database.revision, totalCount, columns: result };
}

// ── Comparison cells ────────────────────────────────────────────────────────

/** Recompute one comparison cell from the configured source columns. */
export function runComparisonCell(rowId: string, columnId: string): DatabaseRow | null {
  const column = getColumn(columnId);
  const row = getRow(rowId);
  if (!column || column.type !== 'comparison' || !row || row.databaseId !== column.databaseId) return row;
  const columns = getColumns(column.databaseId);
  if (comparisonSourceColumns(column, columns).length < 2) return row;
  return setCell(rowId, columnId, comparisonMajorityValue(column, columns, row));
}

/**
 * Recompute a complete comparison column in bounded transactions. Unlike calling setCell
 * for every row, this avoids reloading formulas and rollups N times; yielding between batches
 * keeps navigation and vault switching responsive on large databases.
 */
export async function runComparisonColumn(
  databaseId: string,
  columnId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ done: number }> {
  const column = getColumn(columnId);
  if (!column || column.type !== 'comparison' || column.databaseId !== databaseId) return { done: 0 };
  const columns = getColumns(databaseId);
  if (comparisonSourceColumns(column, columns).length < 2) return { done: 0 };
  const rows = listRows(databaseId, { sort: 'position' });
  const db = getDb();
  const clear = db.prepare('DELETE FROM db_cells WHERE row_id = ? AND column_id = ?');
  const touch = db.prepare("UPDATE db_rows SET updated_at = ?, revision = revision + 1, updated_by = 'local' WHERE id = ?");
  const batchSize = 250;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const ts = now();
    db.transaction(() => {
      for (const row of batch) {
        const result = comparisonMajorityValue(column, columns, row);
        if (result == null) clear.run(row.id, columnId);
        else writeStoredCell(row.id, columnId, databaseId, column.type, result);
        touch.run(ts, row.id);
      }
    })();
    onProgress?.(Math.min(start + batch.length, rows.length), rows.length);
    // Let navigation and a vault switch be handled between batches. The scoped database
    // remains pinned to this job's source vault across the yield.
    if (start + batch.length < rows.length) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  touchDatabase(databaseId);
  return { done: rows.length };
}

// ── Attachments ──────────────────────────────────────────────────────────────

interface AttachmentMetaRow {
  id: string;
  database_id: string;
  row_id: string;
  column_id: string;
  file_name: string | null;
  mime_type: string | null;
  bytes: number;
  has_blob: number;
  blob_hash: string | null;
  content_hash: string | null;
  extracted_text: string | null;
  description: string | null;
  ai_generated: number;
  ai_prompt: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

const ATTACHMENT_META_COLS = `id, row_id, column_id, file_name, mime_type, bytes,
  (blob IS NOT NULL OR (blob_hash IS NOT NULL AND EXISTS (SELECT 1 FROM db_blobs WHERE hash = blob_hash))) AS has_blob,
  blob_hash, content_hash, extracted_text, description,
  ai_generated, ai_prompt, position, created_at`;

function rowToAttachment(row: AttachmentMetaRow): DatabaseAttachment {
  return {
    id: row.id,
    rowId: row.row_id,
    columnId: row.column_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    hasBlob: Boolean(row.has_blob),
    contentHash: row.content_hash,
    extractedText: row.extracted_text,
    description: row.description,
    aiGenerated: Boolean(row.ai_generated),
    aiPrompt: row.ai_prompt,
    position: row.position,
    createdAt: row.created_at,
  };
}

export interface AddAttachmentInput {
  identity?: string;
  rowId: string;
  columnId: string;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  blob: Uint8Array;
  contentHash?: string | null;
  extractedText?: string | null;
  description?: string | null;
  aiGenerated?: boolean;
  aiPrompt?: string | null;
  /** Downscaled preview for the grid/gallery; null for non-images. */
  thumb?: Uint8Array | null;
}

export function addAttachment(input: AddAttachmentInput): DatabaseAttachment {
  const db = getDb();
  const context = cellContext(input.rowId, input.columnId);
  if (!context) throw new Error('Fila o propiedad de base de datos no encontrada.');
  const id = input.identity ?? newId('datt');
  if (input.identity && (!/^datt_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.identity)
    || db.prepare('SELECT 1 FROM db_attachments WHERE id = ?').get(input.identity))) throw new Error('Identidad de adjunto no válida o ya utilizada.');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_attachments WHERE row_id = ? AND column_id = ?').get(
      input.rowId,
      input.columnId
    ) as { n: number }
  ).n;
  const bytes = Buffer.from(input.blob);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const timestamp = now();
  db.prepare(
    `INSERT INTO db_blobs
      (hash, bytes, mime_type, data, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'local', 'local', ?, ?)
     ON CONFLICT(hash) DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(hash, bytes.length, input.mimeType, bytes, timestamp, timestamp);
  db.prepare(
    `INSERT INTO db_attachments
      (id, database_id, row_id, column_id, file_name, mime_type, bytes, blob_hash, blob, content_hash,
       extracted_text, description, ai_generated, ai_prompt, thumb, position, revision,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?)`
  ).run(
    id,
    context.databaseId,
    input.rowId,
    input.columnId,
    input.fileName,
    input.mimeType,
    bytes.length,
    hash,
    input.contentHash ?? hash,
    input.extractedText ?? null,
    input.description ?? null,
    input.aiGenerated ? 1 : 0,
    input.aiPrompt ?? null,
    input.thumb ? Buffer.from(input.thumb) : null,
    position,
    timestamp,
    timestamp,
  );
  touchRow(input.rowId);
  const col = getColumn(input.columnId);
  if (col) touchDatabase(col.databaseId);
  return getAttachment(id)!;
}

export function getAttachment(id: string): DatabaseAttachment | null {
  const row = getDb().prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE id = ?`).get(id) as
    | AttachmentMetaRow
    | undefined;
  return row ? rowToAttachment(row) : null;
}

export function getAttachmentBlob(id: string): Buffer | null {
  const row = getDb().prepare(
    `SELECT COALESCE(attachment.blob, blob.data) AS data
     FROM db_attachments attachment LEFT JOIN db_blobs blob ON blob.hash = attachment.blob_hash
     WHERE attachment.id = ?`,
  ).get(id) as
    | { data: Buffer | null }
    | undefined;
  return row?.data ?? null;
}

/**
 * The mime type of a stored thumb. attachmentThumb.ts encodes every preview as JPEG; it is
 * named here rather than imported from there because that module pulls in Electron's
 * nativeImage, and this repo has to stay importable from the pure-DB paths (and their
 * esbuild bundles, e.g. the .nodussync package) that run outside the Electron runtime.
 */
const THUMB_MIME = 'image/jpeg';

/**
 * The attachment's preview image, falling back to the original when there is no thumb
 * (non-image files, or attachments stored before thumbs existed). Reports the returned
 * bytes' own mime type — a generated thumb is always JPEG whatever the original was, so
 * the caller cannot infer it from the attachment's mime_type.
 */
export function getAttachmentThumb(id: string): { bytes: Buffer; mimeType: string | null } | null {
  const row = getDb().prepare(
    `SELECT attachment.thumb, COALESCE(attachment.blob, blob.data) AS data, attachment.mime_type
     FROM db_attachments attachment LEFT JOIN db_blobs blob ON blob.hash = attachment.blob_hash
     WHERE attachment.id = ?`,
  ).get(id) as
    | { thumb: Buffer | null; data: Buffer | null; mime_type: string | null }
    | undefined;
  if (!row) return null;
  if (row.thumb) return { bytes: row.thumb, mimeType: THUMB_MIME };
  return row.data ? { bytes: row.data, mimeType: row.mime_type } : null;
}

export function listAttachments(rowId: string, columnId: string): DatabaseAttachment[] {
  return (
    getDb()
      .prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE row_id = ? AND column_id = ? ORDER BY position, created_at`)
      .all(rowId, columnId) as AttachmentMetaRow[]
  ).map(rowToAttachment);
}

/** Is this exact file already attached to this cell? (dedupe on re-add). */
export function attachmentExists(rowId: string, columnId: string, contentHash: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM db_attachments WHERE row_id = ? AND column_id = ? AND content_hash = ? LIMIT 1')
      .get(rowId, columnId, contentHash)
  );
}

export function deleteAttachment(id: string): void {
  const att = getAttachment(id);
  const db = getDb();
  const blob = db.prepare('SELECT blob_hash FROM db_attachments WHERE id = ?').get(id) as { blob_hash: string | null } | undefined;
  db.transaction(() => {
    db.prepare('DELETE FROM db_attachments WHERE id = ?').run(id);
    if (blob?.blob_hash) {
      db.prepare(
        'DELETE FROM db_blobs WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM db_attachments WHERE blob_hash = ?)',
      ).run(blob.blob_hash, blob.blob_hash);
    }
  })();
  if (att) {
    touchRow(att.rowId);
    const col = getColumn(att.columnId);
    if (col) touchDatabase(col.databaseId);
  }
}

/** Relation counts per (row, column) for a set of rows — cheap (no label resolution). */
function relationCountsForRows(rowIds: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (rowIds.length === 0) return out;
  const placeholders = rowIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT row_id, column_id, COUNT(*) AS n FROM db_relations WHERE row_id IN (${placeholders}) GROUP BY row_id, column_id`)
    .all(...rowIds) as { row_id: string; column_id: string; n: number }[];
  for (const r of rows) {
    const byCol = out.get(r.row_id) ?? {};
    byCol[r.column_id] = r.n;
    out.set(r.row_id, byCol);
  }
  return out;
}

/** Attachment metadata for a set of rows, grouped by row then column. */
function attachmentsForRows(rowIds: string[]): Map<string, Record<string, DatabaseAttachment[]>> {
  const out = new Map<string, Record<string, DatabaseAttachment[]>>();
  if (rowIds.length === 0) return out;
  const placeholders = rowIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT ${ATTACHMENT_META_COLS} FROM db_attachments WHERE row_id IN (${placeholders}) ORDER BY position, created_at`)
    .all(...rowIds) as AttachmentMetaRow[];
  for (const r of rows) {
    const att = rowToAttachment(r);
    const byCol = out.get(att.rowId) ?? {};
    (byCol[att.columnId] ??= []).push(att);
    out.set(att.rowId, byCol);
  }
  return out;
}

// ── Relations ────────────────────────────────────────────────────────────────

/** Resolve a relation target's display label, vault name and broken-ness (best-effort).
 *  db_row is local; entity kinds resolve in `targetVaultId`'s vault (cross-vault). */
function resolveRelation(
  kind: RelationTargetKind,
  id: string,
  targetVaultId: string | null
): { label: string; vaultName?: string; broken: boolean } {
  if (kind === 'db_row') {
    try {
      const row = getRow(id);
      if (!row) return { label: id, broken: true };
      const cols = getColumns(row.databaseId);
      const titleCol = cols.find((c) => c.type === 'title') ?? cols[0];
      const label = (titleCol ? (row.cells[titleCol.id] ?? '').trim() : '') || id;
      return { label, broken: false };
    } catch {
      return { label: id, broken: true };
    }
  }
  return resolveEntityLabel(kind, id, targetVaultId);
}

interface RelationRow {
  id: string;
  database_id: string;
  row_id: string;
  column_id: string;
  target_kind: RelationTargetKind;
  target_id: string;
  target_vault_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  inverse_relation_id: string | null;
  last_known_label: string | null;
}

function rowToRelation(r: RelationRow): DatabaseRelation {
  const resolved = resolveRelation(r.target_kind, r.target_id, r.target_vault_id ?? null);
  return {
    id: r.id,
    rowId: r.row_id,
    columnId: r.column_id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    targetVaultId: r.target_vault_id ?? null,
    label: resolved.broken ? (r.last_known_label || resolved.label) : resolved.label,
    vaultName: resolved.vaultName,
    broken: resolved.broken,
    inverseRelationId: r.inverse_relation_id ?? null,
    lastKnownLabel: r.last_known_label ?? null,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validateRelationTarget(
  rowId: string,
  columnId: string,
  targetKind: RelationTargetKind,
  targetId: string,
): { column: DatabaseColumn; sourceDatabaseId: string; targetDatabaseId: string | null; label: string } {
  const context = cellContext(rowId, columnId);
  const column = getColumn(columnId);
  if (!context) {
    const row = getDb().prepare('SELECT database_id FROM db_rows WHERE id = ?').get(rowId) as { database_id: string } | undefined;
    if (row && column && row.database_id !== column.databaseId) throw new Error('La fila y la propiedad pertenecen a bases de datos distintas.');
    throw new Error('Fila o propiedad de base de datos no encontrada.');
  }
  if (!column || column.type !== 'relation') throw new Error('La propiedad no es una relación válida.');
  const configuredKind = (column.config.relationTargetKind as RelationTargetKind | undefined) ?? 'db_row';
  if (configuredKind !== targetKind) throw new Error('El destino no coincide con la configuración de la relación.');
  if (targetKind !== 'db_row') {
    const resolved = resolveRelation(targetKind, targetId, null);
    return { column, sourceDatabaseId: context.databaseId, targetDatabaseId: null, label: resolved.label };
  }
  const target = getRow(targetId);
  if (!target) throw new Error('La fila de destino ya no existe.');
  // Historical relation columns had no explicit target and pointed to their own database.
  const configuredDatabase = String(column.config.relationTargetDatabaseId ?? context.databaseId);
  if (!configuredDatabase || target.databaseId !== configuredDatabase) {
    throw new Error('La fila pertenece a una base distinta de la configurada.');
  }
  const label = resolveRelation('db_row', targetId, null).label;
  return { column, sourceDatabaseId: context.databaseId, targetDatabaseId: target.databaseId, label };
}

function deleteRelationPair(db: ReturnType<typeof getDb>, relation: RelationRow, action: 'cascade' | 'cleanup' = 'cascade'): void {
  if (relation.inverse_relation_id && relation.inverse_relation_id !== relation.id) {
    const inverse = db.prepare('SELECT * FROM db_relations WHERE id = ?').get(relation.inverse_relation_id) as RelationRow | undefined;
    if (inverse) {
      db.prepare('DELETE FROM db_relations WHERE id = ?').run(inverse.id);
      db.prepare(
        `INSERT INTO db_relation_repairs (id, relation_id, old_target_id, new_target_id, action, actor, created_at)
         VALUES (?, ?, ?, NULL, ?, 'local', ?)`,
      ).run(newId('drepair'), inverse.id, inverse.target_id, action, now());
    }
  }
  db.prepare('DELETE FROM db_relations WHERE id = ?').run(relation.id);
}

function insertRelationRow(
  db: ReturnType<typeof getDb>,
  input: { rowId: string; column: DatabaseColumn; targetKind: RelationTargetKind; targetId: string; targetVaultId: string | null; label: string },
): RelationRow {
  const existing = db.prepare(
    `SELECT * FROM db_relations WHERE row_id = ? AND column_id = ? AND target_kind = ? AND target_id = ?
       AND COALESCE(target_vault_id, '') = COALESCE(?, '')`,
  ).get(input.rowId, input.column.id, input.targetKind, input.targetId, input.targetVaultId) as RelationRow | undefined;
  if (existing) return existing;
  if ((input.column.config.relationCardinality ?? 'many') === 'one') {
    const previous = db.prepare('SELECT * FROM db_relations WHERE row_id = ? AND column_id = ?').all(input.rowId, input.column.id) as RelationRow[];
    previous.forEach((relation) => deleteRelationPair(db, relation));
  }
  const id = newId('drel');
  const position = (db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_relations WHERE row_id = ? AND column_id = ?',
  ).get(input.rowId, input.column.id) as { n: number }).n;
  const timestamp = now();
  db.prepare(
    `INSERT INTO db_relations
      (id, database_id, row_id, column_id, target_kind, target_id, target_vault_id, position,
       revision, created_by, updated_by, created_at, updated_at, inverse_relation_id, last_known_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?, NULL, ?)`,
  ).run(id, input.column.databaseId, input.rowId, input.column.id, input.targetKind, input.targetId,
    input.targetVaultId, position, timestamp, timestamp, input.label);
  return db.prepare('SELECT * FROM db_relations WHERE id = ?').get(id) as RelationRow;
}

export function addRelation(
  rowId: string,
  columnId: string,
  targetKind: RelationTargetKind,
  targetId: string,
  targetVaultId: string | null = null
): DatabaseRelation {
  const db = getDb();
  const validated = validateRelationTarget(rowId, columnId, targetKind, targetId);
  let relationId = '';
  db.transaction(() => {
    const relation = insertRelationRow(db, { rowId, column: validated.column, targetKind, targetId, targetVaultId, label: validated.label });
    relationId = relation.id;
    const inverseColumnId = validated.column.config.relationInverseColumnId as string | undefined;
    if (targetKind !== 'db_row' || !inverseColumnId) return;
    const inverseColumn = getColumn(inverseColumnId);
    if (!inverseColumn || inverseColumn.type !== 'relation' || inverseColumn.databaseId !== validated.targetDatabaseId
      || inverseColumn.config.relationTargetKind !== 'db_row'
      || inverseColumn.config.relationTargetDatabaseId !== validated.sourceDatabaseId) {
      throw new Error('La propiedad inversa no es compatible con esta relación.');
    }
    if (rowId === targetId && columnId === inverseColumnId) {
      db.prepare('UPDATE db_relations SET inverse_relation_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(relation.id, now(), relation.id);
      return;
    }
    const sourceLabel = resolveRelation('db_row', rowId, null).label;
    const inverse = insertRelationRow(db, {
      rowId: targetId, column: inverseColumn, targetKind: 'db_row', targetId: rowId,
      targetVaultId: null, label: sourceLabel,
    });
    db.prepare('UPDATE db_relations SET inverse_relation_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(inverse.id, now(), relation.id);
    db.prepare('UPDATE db_relations SET inverse_relation_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(relation.id, now(), inverse.id);
  })();
  touchRow(rowId);
  touchDatabase(validated.sourceDatabaseId);
  recomputeDerivedForRow(validated.sourceDatabaseId, rowId, columnId);
  if (validated.targetDatabaseId && validated.targetDatabaseId !== validated.sourceDatabaseId) touchDatabase(validated.targetDatabaseId);
  return getRelation(relationId)!;
}

function getRelation(id: string): DatabaseRelation | null {
  const r = getDb().prepare('SELECT * FROM db_relations WHERE id = ?').get(id) as RelationRow | undefined;
  return r ? rowToRelation(r) : null;
}

export function listRelations(rowId: string, columnId: string): DatabaseRelation[] {
  return (
    getDb().prepare('SELECT * FROM db_relations WHERE row_id = ? AND column_id = ? ORDER BY position, created_at').all(rowId, columnId) as RelationRow[]
  ).map(rowToRelation);
}

export function removeRelation(id: string): void {
  const db = getDb();
  const raw = db.prepare('SELECT * FROM db_relations WHERE id = ?').get(id) as RelationRow | undefined;
  const rel = raw ? rowToRelation(raw) : null;
  if (raw) db.transaction(() => deleteRelationPair(db, raw))();
  if (rel) {
    touchRow(rel.rowId);
    const col = getColumn(rel.columnId);
    if (col) {
      touchDatabase(col.databaseId);
      recomputeDerivedForRow(col.databaseId, rel.rowId, rel.columnId);
    }
  }
}

export function repairRelation(id: string, targetId: string, targetVaultId: string | null = null): DatabaseRelation {
  const db = getDb();
  const raw = db.prepare('SELECT * FROM db_relations WHERE id = ?').get(id) as RelationRow | undefined;
  if (!raw) throw new Error('La relación ya no existe.');
  const validated = validateRelationTarget(raw.row_id, raw.column_id, raw.target_kind, targetId);
  db.transaction(() => {
    if (raw.inverse_relation_id && raw.inverse_relation_id !== raw.id) db.prepare('DELETE FROM db_relations WHERE id = ?').run(raw.inverse_relation_id);
    db.prepare(
      `UPDATE db_relations SET target_id = ?, target_vault_id = ?, last_known_label = ?, inverse_relation_id = NULL,
       revision = revision + 1, updated_by = 'local', updated_at = ? WHERE id = ?`,
    ).run(targetId, targetVaultId, validated.label, now(), id);
    db.prepare(
      `INSERT INTO db_relation_repairs (id, relation_id, old_target_id, new_target_id, action, actor, created_at)
       VALUES (?, ?, ?, ?, 'repair', 'local', ?)`,
    ).run(newId('drepair'), id, raw.target_id, targetId, now());
    const inverseColumnId = validated.column.config.relationInverseColumnId as string | undefined;
    if (raw.target_kind === 'db_row' && inverseColumnId) {
      const inverseColumn = getColumn(inverseColumnId);
      if (!inverseColumn || inverseColumn.databaseId !== validated.targetDatabaseId) throw new Error('La propiedad inversa ya no es compatible.');
      const inverse = insertRelationRow(db, { rowId: targetId, column: inverseColumn, targetKind: 'db_row', targetId: raw.row_id,
        targetVaultId: null, label: resolveRelation('db_row', raw.row_id, null).label });
      db.prepare('UPDATE db_relations SET inverse_relation_id = ? WHERE id = ?').run(inverse.id, id);
      db.prepare('UPDATE db_relations SET inverse_relation_id = ? WHERE id = ?').run(id, inverse.id);
    }
  })();
  touchRow(raw.row_id);
  touchDatabase(raw.database_id);
  recomputeDerivedForRow(raw.database_id, raw.row_id, raw.column_id);
  return getRelation(id)!;
}

export function cleanupBrokenRelations(databaseId: string): { removed: number } {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM db_relations WHERE database_id = ? ORDER BY created_at').all(databaseId) as RelationRow[];
  const broken = rows.filter((row) => resolveRelation(row.target_kind, row.target_id, row.target_vault_id).broken);
  db.transaction(() => {
    for (const row of broken) {
      db.prepare(
        `INSERT INTO db_relation_repairs (id, relation_id, old_target_id, new_target_id, action, actor, created_at)
         VALUES (?, ?, ?, NULL, 'cleanup', 'local', ?)`,
      ).run(newId('drepair'), row.id, row.target_id, now());
      deleteRelationPair(db, row, 'cleanup');
    }
  })();
  if (broken.length) touchDatabase(databaseId);
  return { removed: broken.length };
}

/** Candidate targets for the relation picker, filtered by a query. */
export function searchRelationTargets(
  kind: RelationTargetKind,
  query: string,
  opts: { databaseId?: string; limit?: number } = {}
): RelationTarget[] {
  const limit = opts.limit ?? 20;
  if (kind === 'db_row') {
    if (!opts.databaseId) return [];
    const db = getDb();
    const normalized = query.normalize('NFKC').trim();
    const match = ftsQuery(normalized);
    const rows = match ? db.prepare(
      `WITH raw AS (
         SELECT row_id, bm25(db_search_fts) AS score
         FROM db_search_fts WHERE database_id = ? AND row_id IS NOT NULL AND db_search_fts MATCH ?
       ), ranked AS (
         SELECT row_id, score FROM (
           SELECT row_id, score, ROW_NUMBER() OVER (PARTITION BY row_id ORDER BY score) AS rank FROM raw
         ) WHERE rank = 1 ORDER BY score, row_id LIMIT ?
       )
       SELECT ranked.row_id AS id, COALESCE(title.value_text, ranked.row_id) AS label
       FROM ranked
       LEFT JOIN db_columns title_column ON title_column.database_id = ? AND title_column.type = 'title'
       LEFT JOIN db_cells title ON title.database_id = ? AND title.row_id = ranked.row_id AND title.column_id = title_column.id
       ORDER BY ranked.score, ranked.row_id`,
    ).all(opts.databaseId, match, limit, opts.databaseId, opts.databaseId) as Array<{ id: string; label: string }> : db.prepare(
      `SELECT row.id, COALESCE(title.value_text, row.id) AS label
       FROM db_rows row
       LEFT JOIN db_columns title_column ON title_column.database_id = row.database_id AND title_column.type = 'title'
       LEFT JOIN db_cells title ON title.database_id = row.database_id AND title.row_id = row.id AND title.column_id = title_column.id
       WHERE row.database_id = ? ORDER BY row.position, row.id LIMIT ?`,
    ).all(opts.databaseId, limit) as Array<{ id: string; label: string }>;
    return rows.map((row) => ({ kind, id: row.id, label: row.label || row.id }));
  }
  // Entity kinds (idea/gap/work/author/person) are searched across ALL vaults.
  return searchEntitiesAcrossVaults(kind, query, limit).map((h) => ({
    kind,
    id: h.id,
    label: h.label,
    vaultId: h.vaultId,
    vaultName: h.vaultName,
    sublabel: h.vaultName || undefined,
  }));
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function getDatabaseDetail(id: string): DatabaseDetail | null {
  const database = getDatabase(id);
  if (!database) return null;
  return { database, columns: getColumns(id) };
}

// ── Sync serialization (.nodussync) ──────────────────────────────────────────
// Databases no longer travel as whole trees. They used to: a newer `updated_at` on
// either side replaced the peer's entire database via DELETE + re-insert, so one row
// added here could erase fifty added there. `electron/export/syncPackage.ts` now
// merges every db_* table row by row from the live schema, which also means new
// columns are carried automatically instead of needing this file to be updated.


// ── Saved views ──────────────────────────────────────────────────────────────

interface ViewRow {
  id: string;
  database_id: string;
  name: string;
  layout: string;
  filter_json: string | null;
  sort_json: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  revision: number;
  created_by: string;
  updated_by: string;
  config_version: number;
  config_json: string | null;
  scope: string;
  owner_actor_id: string;
  edit_permission: string;
  source_view_id: string | null;
}

function parseFilter(json: string | null): DatabaseFilterState {
  if (!json) return { conjunction: 'and', conditions: [] };
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object' || !Array.isArray(p.conditions)) return { conjunction: 'and', conditions: [] };
    return {
      conjunction: p.conjunction === 'or' ? 'or' : 'and',
      conditions: p.conditions,
      groups: Array.isArray(p.groups) ? p.groups : undefined,
    };
  } catch {
    return { conjunction: 'and', conditions: [] };
  }
}

function parseSorts(json: string | null): SortRule[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function rowToView(r: ViewRow): DatabaseSavedView {
  const legacyFilter = parseFilter(r.filter_json);
  const legacySorts = parseSorts(r.sort_json);
  let parsedConfig: unknown = null;
  try { parsedConfig = r.config_json ? JSON.parse(r.config_json) : null; } catch { parsedConfig = null; }
  const config = normalizeDatabaseViewConfig(parsedConfig, {
    layout: r.layout,
    filter: legacyFilter,
    sorts: legacySorts,
  });
  return {
    id: r.id,
    databaseId: r.database_id,
    name: r.name,
    layout: config.layout,
    filter: legacyFilterFromViewConfig(config),
    sorts: config.sorts,
    config,
    scope: config.scope,
    ownerActorId: config.ownerActorId,
    editPermission: config.editPermission,
    sourceViewId: config.sourceViewId,
    position: r.position,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function resolveViewConfig(input: Partial<SavedViewInput>, existing?: DatabaseSavedView): DatabaseViewConfig {
  const candidate = input.config ?? (existing
    ? { ...existing.config, layout: input.layout ?? existing.layout }
    : { layout: input.layout ?? 'table' });
  const config = normalizeDatabaseViewConfig(candidate, {
    layout: input.layout ?? existing?.layout ?? 'table',
    filter: input.filter ?? existing?.filter,
    sorts: input.sorts ?? existing?.sorts,
  });
  if (!input.config && input.filter) config.filter = databaseFilterStateToNode(input.filter);
  if (!input.config && input.sorts) config.sorts = input.sorts;
  if (input.scope) config.scope = input.scope;
  if (input.ownerActorId) config.ownerActorId = input.ownerActorId;
  if (input.editPermission) config.editPermission = input.editPermission;
  if (input.sourceViewId !== undefined) config.sourceViewId = input.sourceViewId;
  return config;
}

function assertViewSource(databaseId: string, sourceViewId: string | null): void {
  if (!sourceViewId) return;
  const source = getDb().prepare('SELECT database_id FROM db_views WHERE id = ?').get(sourceViewId) as { database_id: string } | undefined;
  if (!source || source.database_id !== databaseId) throw new Error('La vista enlazada debe pertenecer a la misma base de datos.');
}

function snapshotView(view: DatabaseSavedView, reason: DatabaseViewRevision['reason']): void {
  getDb().prepare(
    `INSERT INTO db_view_revisions
      (id, view_id, revision, name, config_json, reason, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId('dviewrev'), view.id, view.revision, view.name, JSON.stringify(view.config), reason, 'local', view.updatedAt);
}

export function createView(databaseId: string, input: SavedViewInput): DatabaseSavedView {
  const db = getDb();
  const id = newId('dview');
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM db_views WHERE database_id = ?').get(databaseId) as { n: number }
  ).n;
  const timestamp = now();
  const config = resolveViewConfig(input);
  assertViewSource(databaseId, config.sourceViewId);
  const legacyFilter = legacyFilterFromViewConfig(config);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO db_views
      (id, database_id, name, layout, filter_json, sort_json, position, created_at, updated_at,
       revision, created_by, updated_by, config_version, config_json, scope, owner_actor_id,
       edit_permission, source_view_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      databaseId,
      input.name.trim() || 'Vista',
      config.layout,
      JSON.stringify(legacyFilter),
      JSON.stringify(config.sorts),
      position,
      timestamp,
      timestamp,
      DATABASE_VIEW_CONFIG_VERSION,
      JSON.stringify(config),
      config.scope,
      config.ownerActorId,
      config.editPermission,
      config.sourceViewId,
    );
    const source = ensureDatabaseDataSource(databaseId);
    db.prepare(
      `INSERT INTO db_view_sources
        (view_id, source_id, alias, position, is_primary, property_map_json,
         revision, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, '{}', 1, 'local', 'local', ?, ?)`,
    ).run(id, source.id, source.name, timestamp, timestamp);
  })();
  const created = getView(id)!;
  snapshotView(created, 'create');
  return created;
}

function getView(id: string): DatabaseSavedView | null {
  const r = getDb().prepare('SELECT * FROM db_views WHERE id = ?').get(id) as ViewRow | undefined;
  return r ? rowToView(r) : null;
}

export function listViews(databaseId: string): DatabaseSavedView[] {
  return (
    getDb().prepare('SELECT * FROM db_views WHERE database_id = ? ORDER BY position, created_at').all(databaseId) as ViewRow[]
  ).map(rowToView);
}

// ── Data sources and multi-source view containers ────────────────────────────

interface DataSourceRow {
  id: string; database_id: string; name: string; kind: 'local_database'; revision: number;
  created_by: string; updated_by: string; created_at: string; updated_at: string;
}

interface ViewSourceRow extends DataSourceRow {
  view_id: string; source_id: string; alias: string; position: number; is_primary: number;
  property_map_json: string; view_source_revision: number; view_source_created_at: string; view_source_updated_at: string;
}

function dataSourceFromRow(row: DataSourceRow): DatabaseDataSource {
  return { id: row.id, databaseId: row.database_id, name: row.name, kind: row.kind, revision: row.revision,
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function ensureDatabaseDataSource(databaseId: string, readOnly = false): DatabaseDataSource {
  const db = getDb();
  let row = db.prepare('SELECT * FROM db_data_sources WHERE database_id = ?').get(databaseId) as DataSourceRow | undefined;
  if (!row) {
    const database = db.prepare('SELECT name, revision, created_by, updated_by, created_at, updated_at FROM db_databases WHERE id = ?')
      .get(databaseId) as { name: string; revision: number; created_by: string; updated_by: string; created_at: string; updated_at: string } | undefined;
    if (!database) throw new Error('Base de datos no encontrada.');
    if(readOnly)return dataSourceFromRow({id:`companion-read:${databaseId}`,database_id:databaseId,kind:'local_database',...database});
    const id = newId('dsrc');
    db.prepare(`INSERT INTO db_data_sources
      (id, database_id, name, kind, revision, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, 'local_database', ?, ?, ?, ?, ?)`).run(id, databaseId, database.name, database.revision,
      database.created_by, database.updated_by, database.created_at, database.updated_at);
    row = db.prepare('SELECT * FROM db_data_sources WHERE id = ?').get(id) as DataSourceRow;
  }
  return dataSourceFromRow(row);
}

export function listDatabaseDataSources(): DatabaseDataSource[] {
  const db = getDb();
  const databases = db.prepare('SELECT id FROM db_databases ORDER BY position, created_at').all() as Array<{ id: string }>;
  for (const database of databases) ensureDatabaseDataSource(database.id);
  return (db.prepare('SELECT * FROM db_data_sources ORDER BY created_at, id').all() as DataSourceRow[]).map(dataSourceFromRow);
}

function parsedPropertyMap(raw: string, databaseId: string): Record<string, string> {
  const columns = getColumns(databaseId); const byId = new Set(columns.map((column) => column.id));
  let stored: Record<string, unknown> = {};
  try { const value = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) stored = value; } catch { stored = {}; }
  const overrides: Record<string, string> = {};
  for (const [canonical, columnId] of Object.entries(stored)) {
    if (canonical && typeof columnId === 'string' && byId.has(columnId)) overrides[canonical] = columnId;
  }
  return { ...automaticDatabaseSourcePropertyMap(columns), ...overrides };
}

function viewSourceFromRow(row: ViewSourceRow): DatabaseViewDataSource {
  return {
    viewId: row.view_id, sourceId: row.source_id, databaseId: row.database_id, sourceName: row.name,
    alias: row.alias, position: row.position, primary: row.is_primary === 1,
    propertyMap: parsedPropertyMap(row.property_map_json, row.database_id), revision: row.view_source_revision,
    createdAt: row.view_source_created_at, updatedAt: row.view_source_updated_at,
  };
}

function viewSourceRows(viewId: string): ViewSourceRow[] {
  return getDb().prepare(
    `SELECT link.view_id, link.source_id, link.alias, link.position, link.is_primary,
            link.property_map_json, link.revision AS view_source_revision,
            link.created_at AS view_source_created_at, link.updated_at AS view_source_updated_at,
            source.*
     FROM db_view_sources link JOIN db_data_sources source ON source.id = link.source_id
     WHERE link.view_id = ? ORDER BY link.position, link.created_at, link.source_id`,
  ).all(viewId) as ViewSourceRow[];
}

export function listDatabaseViewSources(viewId: string, readOnly = false): DatabaseViewDataSource[] {
  const db = getDb(); const view = getView(viewId); if (!view) throw new Error('Vista no encontrada.');
  let rows = viewSourceRows(viewId);
  if (rows.length === 0) {
    const source = ensureDatabaseDataSource(view.databaseId, readOnly); const timestamp = now();
    if(readOnly)return [{viewId,sourceId:source.id,databaseId:source.databaseId,sourceName:source.name,alias:source.name,position:0,primary:true,propertyMap:automaticDatabaseSourcePropertyMap(getColumns(source.databaseId)),revision:1,createdAt:source.createdAt,updatedAt:source.updatedAt}];
    db.prepare(`INSERT INTO db_view_sources
      (view_id, source_id, alias, position, is_primary, property_map_json, revision, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, 0, 1, '{}', 1, 'local', 'local', ?, ?)`).run(viewId, source.id, source.name, timestamp, timestamp);
    rows = viewSourceRows(viewId);
  }
  return rows.map(viewSourceFromRow);
}

function storedSourceMap(input: Record<string, string> | undefined, databaseId: string, definition: DatabaseContainerDefinition | null): Record<string, string> {
  if (!input) return {};
  const columns = new Map(getColumns(databaseId).map((column) => [column.id, column]));
  const existingTypes = new Map(definition?.properties.map((property) => [property.id, property.type]) ?? []);
  const output: Record<string, string> = {};
  for (const [canonical, columnId] of Object.entries(input)) {
    const column = columns.get(columnId);
    if (!canonical.trim() || !column) throw new Error('El mapeo de propiedades contiene una columna ajena a la fuente.');
    const expected = existingTypes.get(canonical);
    if (expected && expected !== column.type) throw new Error('Las propiedades comunes deben tener el mismo tipo en todas las fuentes.');
    output[canonical] = columnId;
  }
  return output;
}

export function attachDatabaseViewSource(viewId: string, databaseId: string, input: AttachDatabaseViewSourceInput = {}): DatabaseViewDataSource {
  const db = getDb(); const view = getView(viewId); if (!view) throw new Error('Vista no encontrada.');
  const source = ensureDatabaseDataSource(databaseId); const current = getDatabaseContainer(viewId);
  const propertyMap = storedSourceMap(input.propertyMap, databaseId, current); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM db_view_sources WHERE view_id = ?')
    .get(viewId) as { position: number }).position);
  db.prepare(`INSERT INTO db_view_sources
    (view_id, source_id, alias, position, is_primary, property_map_json, revision, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, 1, 'local', 'local', ?, ?)
    ON CONFLICT(view_id, source_id) DO UPDATE SET alias = excluded.alias,
      property_map_json = excluded.property_map_json, revision = db_view_sources.revision + 1,
      updated_by = 'local', updated_at = excluded.updated_at`).run(viewId, source.id, input.alias?.trim() || source.name,
      position, JSON.stringify(propertyMap), timestamp, timestamp);
  return listDatabaseViewSources(viewId).find((entry) => entry.sourceId === source.id)!;
}

export function detachDatabaseViewSource(viewId: string, sourceId: string): void {
  const db = getDb();
  const row = db.prepare('SELECT is_primary FROM db_view_sources WHERE view_id = ? AND source_id = ?').get(viewId, sourceId) as { is_primary: number } | undefined;
  if (!row) return;
  if (row.is_primary === 1) throw new Error('La fuente principal compatible no se puede separar de su vista.');
  db.prepare('DELETE FROM db_view_sources WHERE view_id = ? AND source_id = ?').run(viewId, sourceId);
  const rows = db.prepare('SELECT source_id FROM db_view_sources WHERE view_id = ? ORDER BY position, source_id').all(viewId) as Array<{ source_id: string }>;
  const update = db.prepare("UPDATE db_view_sources SET position = ?, revision = revision + 1, updated_by = 'local', updated_at = ? WHERE view_id = ? AND source_id = ?");
  const timestamp = now(); rows.forEach((entry, position) => update.run(position, timestamp, viewId, entry.source_id));
}

export function getDatabaseContainer(viewId: string, readOnly = false): DatabaseContainerDefinition | null {
  const view = getView(viewId); if (!view) return null;
  const sources = listDatabaseViewSources(viewId, readOnly); const properties = new Map<string, DatabaseContainerProperty>();
  for (const source of sources) {
    const columns = new Map(getColumns(source.databaseId).map((column) => [column.id, column]));
    for (const [canonical, columnId] of Object.entries(source.propertyMap)) {
      const column = columns.get(columnId); if (!column) continue;
      const existing = properties.get(canonical);
      if (existing && existing.type !== column.type) continue;
      const property = existing ?? { id: canonical, name: column.name, type: column.type, sources: [] };
      property.sources.push({ sourceId: source.sourceId, columnId, columnName: column.name }); properties.set(canonical, property);
    }
  }
  return { viewId, viewName: view.name, revision: view.revision + sources.reduce((sum, source) => sum + source.revision, 0),
    sources, properties: [...properties.values()] };
}

interface ContainerCursor { v: 1; queryHash: string; revision: string; sourceIndex: number; innerCursor: string | null }
function encodeContainerCursor(cursor: ContainerCursor): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
function decodeContainerCursor(value: string): ContainerCursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ContainerCursor;
    if (cursor.v !== DATABASE_CONTAINER_CURSOR_VERSION || typeof cursor.queryHash !== 'string' || typeof cursor.revision !== 'string'
      || !Number.isInteger(cursor.sourceIndex) || cursor.sourceIndex < 0 || (cursor.innerCursor !== null && typeof cursor.innerCursor !== 'string')) throw new Error();
    return cursor;
  } catch { throw new Error('Cursor de contenedor no válido.'); }
}

function mapContainerRow(source: DatabaseViewDataSource, row: DatabaseRow): DatabaseContainerRow {
  const cells: Record<string, string | null> = {}, formulaErrors: Record<string,string> = {}, formulaColors: Record<string,string> = {};
  for (const [canonical, columnId] of Object.entries(source.propertyMap)) {
    cells[canonical] = row.cells[columnId] ?? row.rollups?.[columnId] ?? null;
    if(row.formulaErrors?.[columnId])formulaErrors[canonical]=row.formulaErrors[columnId];
    if(row.formulaColors?.[columnId])formulaColors[canonical]=row.formulaColors[columnId];
  }
  return { id: `${source.sourceId}:${row.id}`, sourceId: source.sourceId, databaseId: source.databaseId, rowId: row.id,
    sourceName: source.alias, cells, formulaErrors, formulaColors, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision ?? 1 };
}

export function queryDatabaseContainerRows(input: DatabaseContainerRowQuery, {readOnly = false}: {readOnly?:boolean} = {}): DatabaseContainerRowPage {
  if (!input || typeof input.viewId !== 'string' || !input.viewId) throw new Error('Contenedor de base de datos no válido.');
  if (input.localFilter) assertFilterNode(input.localFilter);
  const view = getView(input.viewId); const definition = getDatabaseContainer(input.viewId, readOnly);
  if (!view || !definition) throw new Error('Vista no encontrada.');
  const sources = input.sourceId ? definition.sources.filter((source) => source.sourceId === input.sourceId) : definition.sources;
  if (input.sourceId && sources.length === 0) throw new Error('La fuente no pertenece a este contenedor.');
  const primary = definition.sources.find((source) => source.primary) ?? definition.sources[0];
  const primaryInverse = new Map(Object.entries(primary?.propertyMap ?? {}).map(([canonical, columnId]) => [columnId, canonical]));
  const dbRevisions = sources.map((source) => {
    const row = getDb().prepare('SELECT revision FROM db_databases WHERE id = ?').get(source.databaseId) as { revision: number };
    return `${source.sourceId}:${source.revision}:${row.revision}`;
  });
  const revision = createHash('sha256').update(`${view.id}:${view.revision}|${dbRevisions.join('|')}`).digest('base64url').slice(0, 20);
  const queryHashValue = createHash('sha256').update(JSON.stringify({ viewId: input.viewId, sourceId: input.sourceId ?? null,
    localFilter: input.localFilter ?? null })).digest('base64url').slice(0, 20);
  const cursor = input.cursor ? decodeContainerCursor(input.cursor) : null;
  if (cursor && cursor.queryHash !== queryHashValue) throw new Error('El cursor pertenece a otra consulta de contenedor.');
  if (cursor && cursor.revision !== revision) throw new Error('Las fuentes cambiaron; reinicia la paginación del contenedor.');
  const limit = clampDatabaseContainerLimit(input.limit); const translations = sources.map((source) => ({ source,
    filter: combinedDatabaseContainerFilter(view.config.filter, input.localFilter, source, primaryInverse) }));
  let totalCount = 0;
  for (const entry of translations) if (entry.filter.kind !== 'false') totalCount += queryDatabaseRows({ databaseId: entry.source.databaseId,
    filter: entry.filter.kind === 'node' ? entry.filter.node : null, limit: 1 },{readOnly}).totalCount;
  const rows: DatabaseContainerRow[] = []; let sourceIndex = cursor?.sourceIndex ?? 0; let innerCursor = cursor?.innerCursor ?? null;
  let nextCursor: string | null = null;
  while (sourceIndex < translations.length && rows.length < limit) {
    const entry = translations[sourceIndex];
    if (entry.filter.kind === 'false') { sourceIndex += 1; innerCursor = null; continue; }
    const translatedSorts = view.config.sorts.flatMap((sort) => {
      const canonical = primaryInverse.get(sort.columnId) ?? sort.columnId; const columnId = entry.source.propertyMap[canonical];
      return columnId ? [{ columnId, dir: sort.dir }] : [];
    });
    const page = queryDatabaseRows({ databaseId: entry.source.databaseId,
      filter: entry.filter.kind === 'node' ? entry.filter.node : null, sorts: translatedSorts,
      cursor: innerCursor, limit: limit - rows.length },{readOnly});
    rows.push(...page.rows.map((row) => mapContainerRow(entry.source, row)));
    if (page.nextCursor) { nextCursor = encodeContainerCursor({ v: DATABASE_CONTAINER_CURSOR_VERSION, queryHash: queryHashValue,
      revision, sourceIndex, innerCursor: page.nextCursor }); break; }
    sourceIndex += 1; innerCursor = null;
    if (rows.length >= limit && sourceIndex < translations.length) nextCursor = encodeContainerCursor({ v: DATABASE_CONTAINER_CURSOR_VERSION,
      queryHash: queryHashValue, revision, sourceIndex, innerCursor: null });
  }
  return { rows, nextCursor, totalCount, queryHash: queryHashValue, revision, hasMore: nextCursor !== null,
    sources: definition.sources, properties: definition.properties };
}

function updateViewWithReason(
  id: string,
  patch: SavedViewPatch,
  reason: DatabaseViewRevision['reason'],
): DatabaseSavedView | null {
  const existing = getView(id);
  if (!existing) return null;
  if (existing.editPermission === 'owner' && existing.ownerActorId !== 'local') {
    throw new Error('No tienes permiso para editar esta vista.');
  }
  if (patch.expectedRevision != null && patch.expectedRevision !== existing.revision) {
    throw new Error(`Conflicto de revisión de vista: se esperaba ${patch.expectedRevision} y la revisión actual es ${existing.revision}.`);
  }
  const name = patch.name?.trim() ?? existing.name;
  const config = resolveViewConfig(patch, existing);
  assertViewSource(existing.databaseId, config.sourceViewId);
  if (config.sourceViewId === id) throw new Error('Una vista no puede enlazarse consigo misma.');
  const filter = legacyFilterFromViewConfig(config);
  getDb()
    .prepare(
      `UPDATE db_views SET name = ?, layout = ?, filter_json = ?, sort_json = ?,
       config_version = ?, config_json = ?, scope = ?, owner_actor_id = ?, edit_permission = ?,
       source_view_id = ?, revision = revision + 1, updated_at = ?, updated_by = 'local' WHERE id = ?`,
    )
    .run(
      name || 'Vista',
      config.layout,
      JSON.stringify(filter),
      JSON.stringify(config.sorts),
      DATABASE_VIEW_CONFIG_VERSION,
      JSON.stringify(config),
      config.scope,
      config.ownerActorId,
      config.editPermission,
      config.sourceViewId,
      now(),
      id,
    );
  const updated = getView(id);
  if (updated) snapshotView(updated, reason);
  return updated;
}

export function updateView(id: string, patch: SavedViewPatch): DatabaseSavedView | null {
  return updateViewWithReason(id, patch, 'update');
}

export function duplicateView(id: string, name?: string): DatabaseSavedView | null {
  const source = getView(id);
  if (!source) return null;
  return createView(source.databaseId, {
    name: name?.trim() || `${source.name} — copia`,
    layout: source.layout,
    filter: source.filter,
    sorts: source.sorts,
    config: { ...source.config, sourceViewId: null },
    scope: source.scope,
    ownerActorId: source.ownerActorId,
    editPermission: source.editPermission,
  });
}

export function linkView(id: string, name?: string, scope: 'personal' | 'shared' = 'personal'): DatabaseSavedView | null {
  const source = getView(id);
  if (!source) return null;
  return createView(source.databaseId, {
    name: name?.trim() || `${source.name} — enlazada`,
    layout: source.layout,
    filter: source.filter,
    sorts: source.sorts,
    config: { ...source.config, scope, sourceViewId: source.id },
    scope,
    ownerActorId: 'local',
    editPermission: scope === 'personal' ? 'owner' : source.editPermission,
    sourceViewId: source.id,
  });
}

export function reorderViews(databaseId: string, ids: string[]): DatabaseSavedView[] {
  const current = listViews(databaseId);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some((view) => !ids.includes(view.id))) {
    throw new Error('La reordenación debe incluir exactamente todas las vistas de la base de datos.');
  }
  const db = getDb();
  const timestamp = now();
  db.transaction(() => {
    const update = db.prepare(
      `UPDATE db_views SET position = ?, revision = revision + 1, updated_at = ?, updated_by = 'local'
       WHERE id = ? AND database_id = ?`,
    );
    ids.forEach((id, position) => update.run(position, timestamp, id, databaseId));
    for (const id of ids) {
      const view = getView(id);
      if (view) snapshotView(view, 'reorder');
    }
  })();
  return listViews(databaseId);
}

export function listViewRevisions(viewId: string): DatabaseViewRevision[] {
  const rows = getDb().prepare(
    `SELECT id, view_id, revision, name, config_json, reason, actor_id, created_at
     FROM db_view_revisions WHERE view_id = ? ORDER BY revision DESC`,
  ).all(viewId) as Array<{
    id: string;
    view_id: string;
    revision: number;
    name: string;
    config_json: string;
    reason: DatabaseViewRevision['reason'];
    actor_id: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    viewId: row.view_id,
    revision: row.revision,
    name: row.name,
    config: normalizeDatabaseViewConfig(JSON.parse(row.config_json)),
    reason: row.reason,
    actorId: row.actor_id,
    createdAt: row.created_at,
  }));
}

export function restoreViewRevision(id: string, revision: number, expectedRevision?: number): DatabaseSavedView | null {
  const snapshot = getDb().prepare(
    'SELECT name, config_json FROM db_view_revisions WHERE view_id = ? AND revision = ?',
  ).get(id, revision) as { name: string; config_json: string } | undefined;
  if (!snapshot) return null;
  const config = normalizeDatabaseViewConfig(JSON.parse(snapshot.config_json));
  return updateViewWithReason(id, {
    name: snapshot.name,
    layout: config.layout,
    filter: legacyFilterFromViewConfig(config),
    sorts: config.sorts,
    config,
    expectedRevision,
  }, 'restore');
}

export function deleteView(id: string): void {
  getDb().prepare('DELETE FROM db_views WHERE id = ?').run(id);
}

// ── CSV import ───────────────────────────────────────────────────────────────

const IMPORT_OPTION_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

/**
 * Create a database from parsed CSV rows with a per-column type mapping. Select /
 * multi-select columns build their options from the distinct values encountered.
 *
 * Columns whose type is null are skipped (the user discarded them in the import modal).
 *
 * This is a bulk path, so it deliberately bypasses createRow/addOption/setCell: those
 * are tuned for single edits and each re-compiles its SQL, re-reads the column, bumps
 * both timestamps and re-reads the whole row. At ~180k cells that overhead dominated
 * (a 7k-row import took ~40s of blocked event loop). Here every statement is prepared
 * once, positions come from a counter instead of SELECT MAX(position), and timestamps
 * are stamped once for the batch.
 */
export function createDatabaseFromCsv(
  name: string,
  headers: string[],
  rows: string[][],
  types: (DatabaseColumnType | null)[],
  onProgress?: (done: number, total: number) => void
): DatabaseSummary {
  const db = getDb();
  const database = createDatabase(name);
  // Keep the source column index alongside the created column so skipped columns don't
  // shift the mapping between a row's cells and the columns we created.
  const cols = headers
    .map((h, i) => ({ sourceIndex: i, type: types[i] }))
    .filter((c): c is { sourceIndex: number; type: DatabaseColumnType } => c.type != null)
    .map((c) => ({ sourceIndex: c.sourceIndex, column: createColumn(database.id, headers[c.sourceIndex], c.type) }));

  const insRow = db.prepare(
    `INSERT INTO db_rows
      (id, database_id, position, unique_sequence, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'local', 'local')`
  );
  const insCell = db.prepare(
    `INSERT INTO db_cells
      (database_id, row_id, column_id, value_type, value_text, value_number, value_integer,
       value_date, value_json, value_reference, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?)`,
  );
  const insOption = db.prepare(
    `INSERT INTO db_select_options
      (id, database_id, column_id, label, color, position, group_key, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?)`
  );

  // For option columns, remember label→optionId as we go.
  const optionMaps = cols.map((c) =>
    c.column.type === 'select' || c.column.type === 'status' || c.column.type === 'multi_select' ? new Map<string, string>() : null
  );
  const optionId = (colIdx: number, label: string): string => {
    const map = optionMaps[colIdx]!;
    const key = label.toLowerCase();
    let id = map.get(key);
    if (!id) {
      const color = IMPORT_OPTION_COLORS[map.size % IMPORT_OPTION_COLORS.length];
      id = newId('dopt');
      const group = cols[colIdx].column.type === 'status'
        ? (map.size === 0 ? 'pending' : map.size === 1 ? 'in_progress' : 'complete')
        : null;
      insOption.run(id, database.id, cols[colIdx].column.id, label.trim() || 'Opción', color, map.size, group, ts, ts);
      map.set(key, id);
    }
    return id;
  };

  const ts = now();
  ensurePrimaryTitle(database.id);
  const tx = db.transaction(() => {
    for (let r = 0; r < rows.length; r++) {
      const rawRow = rows[r];
      const rowId = newId('drow');
      insRow.run(rowId, database.id, r, r + 1, ts, ts);
      for (let i = 0; i < cols.length; i++) {
        const { sourceIndex, column } = cols[i];
        // attachment/ai_image/relation/rollup keep their value outside db_cells, so an
        // imported string has nowhere to land: create the column, leave the cells empty.
        if (!typeStoresImportedText(column.type)) continue;
        const raw = (rawRow[sourceIndex] ?? '').trim();
        if (!raw) continue;
        let value: string | null;
        if (column.type === 'select' || column.type === 'status') {
          value = optionId(i, raw);
        } else if (column.type === 'multi_select') {
          value = encodeMultiSelect(splitMultiValue(raw).map((label) => optionId(i, label)));
        } else {
          value = normalizeCellValue(column.type, normalizeCsvValue(column.type, raw));
        }
        if (value != null) {
          const storage = databaseCellStorage(column.type, value);
          insCell.run(
            database.id, rowId, column.id, storage.value_type, storage.value_text,
            storage.value_number, storage.value_integer, storage.value_date,
            storage.value_json, storage.value_reference, ts, ts,
          );
        }
      }
      if (onProgress && (r % 500 === 0 || r === rows.length - 1)) onProgress(r + 1, rows.length);
    }
  });
  tx();
  return getDatabase(database.id)!;
}
