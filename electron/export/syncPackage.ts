import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import type { SyncConflict, SyncGroupKey, SyncMergeSummary, SyncTableCounts } from '@shared/types';
import { getDb, SCHEMA_VERSION } from '../db/database';
import { SYNC_SCHEMA_VERSION } from '../db/syncSchemaVersion';
import { decryptWithKey, deriveKeyFromDescriptor, encryptWithKey, newKdfDescriptor, type KdfDescriptor } from './backupCrypto';
import { identityColumns, identityWhere, quoteIdentifier, tableColumns, type TableColumn } from '../db/rowIdentity';
import { measureClockSkewAhead, packageIsOlderThanHorizon, type TombstoneRow } from '../db/tombstones';
import { repairAllChatPlacements } from '../db/chatHistoryTables';
import { describeSyncCoverage, groupOfTable, localTableNames, syncedTablesByGroup } from '../db/syncTables';
import { getPrimarySourcePolicySettings } from '../db/primarySourceGovernanceRepo';
import { decidePrimarySourcePolicy } from '@shared/primarySourcesTypes';
import { getActiveVault } from '../vaults/vaultRegistry';
import { databaseCellStorage } from '@shared/databaseCellStorage';
import { columnTypeDef } from '@shared/databases';

/** Re-exported so the sync package stays the single entry point for callers. */
export { describeSyncCoverage };
import { recordSuperseded } from '../db/syncSupersededRepo';

/**
 * Portable sync package for the USER layer — everything the user authored, as opposed
 * to what Nodus derives from the Zotero corpus (works, ideas, themes, edges, passages,
 * embeddings), which is rebuilt locally and deliberately stays out.
 *
 * Unlike the encrypted full backup (which REPLACES a database), importing a package
 * MERGES: rows are matched by primary key, the newer side wins per row, and nothing
 * local is ever deleted.
 *
 * Three properties this format is built around, each learned from a real failure:
 *
 *  1. **Nothing is hardcoded.** Tables and their columns are discovered from the live
 *     schema. The previous version listed columns by hand and had already gone stale
 *     twice (`db_attachments.thumb`, `note_folders.summary` silently stopped
 *     travelling), so every future migration was one more silent gap.
 *  2. **Rows, not trees.** Databases used to merge as whole units: a newer `updated_at`
 *     on either side deleted the peer's entire database and replaced it. One row added
 *     here could erase fifty added there. Conflicts are now resolved per row.
 *  3. **A package can never brick sync.** Colliding natural keys are reconciled by id
 *     remapping, constraint failures are isolated per row, and dangling foreign keys are
 *     dropped before COMMIT — so one bad row is reported instead of aborting the whole
 *     merge forever, in both directions.
 *
 * Core functions are dialog-free so they can run headless (tests, MCP).
 */

export const SYNC_FORMAT = 'nodus.sync-package';
/**
 * v1: one `user-layer.json` with base64 blobs inline.
 * v2: one entry per table plus binary blobs as their own zip entries.
 * v3: the same layout, encrypted — every entry sealed under one derived key, and the
 *     list of what the entries ARE moved into an encrypted index so the file does not
 *     announce that it contains, say, a gradebook.
 *
 * Only v3 is written. v1 and v2 are still read: users hold packages made by the previous
 * builds, and refusing them would strand that work on the machine that produced it.
 */
export const SYNC_FORMAT_VERSION = 3;

interface SyncManifest {
  format: typeof SYNC_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  date: string;
  /** Row count per table, validated on import. v3 keeps this inside the encrypted index
   *  instead: table names and sizes are themselves information about the user. */
  counts?: Record<string, number>;
  /** Which group each table belongs to, so the destination can report by module. */
  groups?: Partial<Record<SyncGroupKey, string[]>>;
  /** v3 only: how to derive the key. Left in the clear because it is useless without the
   *  passphrase, and because rejecting an incompatible package should not require one. */
  kdf?: KdfDescriptor;
}

/** v3: the encrypted directory of the package. */
interface SyncIndex {
  counts: Record<string, number>;
  groups?: Partial<Record<SyncGroupKey, string[]>>;
  /** table name → zip entry holding its encrypted rows. */
  tables: Record<string, string>;
  /** blob content hash → zip entry holding its encrypted bytes. */
  blobs: Record<string, string>;
}

type PortableScalar = string | number | null | { __nodusBuffer: string } | { __nodusBlob: string };
type PortableRow = Record<string, PortableScalar>;
type TableRows = Map<string, PortableRow[]>;

type PrimarySourceSyncScope = {
  deniedItemIds: Set<string>;
  unitIds: Set<string>;
  repositoryIds: Set<string>;
  captureSessionIds: Set<string>;
  fileIds: Set<string>;
  textVersionIds: Set<string>;
  excerptIds: Set<string>;
  proposalIds: Set<string>;
  mentionIds: Set<string>;
  noteIds: Set<string>;
  deniedNoteIds: Set<string>;
  noteFolderIds: Set<string>;
  noteLinkIds: Set<string>;
};

interface ForeignKey { table: string; from: string; to: string | null }

/**
 * Rows whose real identity the primary key does not capture, normalised against the
 * local database before matching.
 *
 * An edge verdict is a judgement about an UNORDERED pair of ideas: the same verdict can
 * legitimately arrive as A→B on one machine and B→A on the other. Matching on the
 * literal primary key would store both, and the two computers would then disagree about
 * the verdict permanently, each convinced it held the newer row.
 */
const ROW_NORMALIZERS: Record<string, (row: Record<string, unknown>) => void> = {
  edge_feedback: (row) => {
    const db = getDb();
    const exact = db
      .prepare('SELECT 1 FROM edge_feedback WHERE type = ? AND from_id = ? AND to_id = ?')
      .get(row.type as string, row.from_id as string, row.to_id as string);
    if (exact) return;
    const reversed = db
      .prepare('SELECT from_id, to_id FROM edge_feedback WHERE type = ? AND from_id = ? AND to_id = ?')
      .get(row.type as string, row.to_id as string, row.from_id as string) as { from_id: string; to_id: string } | undefined;
    if (reversed) {
      row.from_id = reversed.from_id;
      row.to_id = reversed.to_id;
    }
  },
  db_cells: (row) => {
    const db = getDb();
    const source = db.prepare(
      `SELECT data_row.database_id AS row_database_id, data_row.created_at, data_row.updated_at,
              property.database_id AS column_database_id, property.type
       FROM db_rows data_row JOIN db_columns property ON property.id = ?
       WHERE data_row.id = ?`,
    ).get(row.column_id, row.row_id) as
      | { row_database_id: string; column_database_id: string; type: string; created_at: string; updated_at: string }
      | undefined;
    if (!source || source.row_database_id !== source.column_database_id) return;
    row.database_id ??= source.row_database_id;
    row.created_at ??= source.created_at;
    if (typeof row.updated_at !== 'string' || row.updated_at < source.updated_at) row.updated_at = source.updated_at;
    row.revision ??= 1;
    row.created_by ??= 'legacy-sync';
    row.updated_by ??= 'legacy-sync';
    if (typeof row.value_text === 'string') {
      const storage = databaseCellStorage(columnTypeDef(source.type).id, row.value_text);
      Object.assign(row, storage);
    }
  },
  db_select_options: (row) => {
    const column = getDb().prepare('SELECT database_id, created_at, updated_at FROM db_columns WHERE id = ?').get(row.column_id) as
      | { database_id: string; created_at: string; updated_at: string }
      | undefined;
    if (!column) return;
    row.database_id ??= column.database_id;
    row.created_at ??= column.created_at;
    row.updated_at ??= column.updated_at;
  },
  db_attachments: (row) => {
    const dataRow = getDb().prepare('SELECT database_id, created_at, updated_at FROM db_rows WHERE id = ?').get(row.row_id) as
      | { database_id: string; created_at: string; updated_at: string }
      | undefined;
    if (!dataRow) return;
    row.database_id ??= dataRow.database_id;
    row.updated_at ??= row.created_at ?? dataRow.updated_at;
  },
  db_relations: (row) => {
    const dataRow = getDb().prepare('SELECT database_id, created_at, updated_at FROM db_rows WHERE id = ?').get(row.row_id) as
      | { database_id: string; created_at: string; updated_at: string }
      | undefined;
    if (!dataRow) return;
    row.database_id ??= dataRow.database_id;
    row.updated_at ??= row.created_at ?? dataRow.updated_at;
  },
  db_columns: (row) => {
    row.updated_at ??= row.created_at;
  },
  db_views: (row) => {
    row.updated_at ??= row.created_at;
  },
};

/**
 * Rows that carry no timestamp of their own, and the ancestor whose `updated_at` speaks
 * for them. A cell has only (row_id, column_id, value_text) — editing it bumps
 * `db_rows.updated_at`, not the cell — so without this the generic "keep the local copy
 * when you cannot tell which is newer" rule would mean an edited cell never travels at
 * all. Each hop names the foreign key to follow.
 */
const INHERITED_TIMESTAMPS: Record<string, { fk: string; table: string; key: string }[]> = {
  db_cells: [{ fk: 'row_id', table: 'db_rows', key: 'id' }],
  db_columns: [{ fk: 'database_id', table: 'db_databases', key: 'id' }],
  db_views: [{ fk: 'database_id', table: 'db_databases', key: 'id' }],
  db_select_options: [
    { fk: 'column_id', table: 'db_columns', key: 'id' },
    { fk: 'database_id', table: 'db_databases', key: 'id' },
  ],
};

/** Follow an inheritance chain to the ancestor's `updated_at`, in the incoming package
 *  (`rows`) or in the live database (`rows` omitted). */
function inheritedStamp(
  table: string,
  row: Record<string, unknown>,
  incoming: TableRows | null
): string | null {
  const chain = INHERITED_TIMESTAMPS[table];
  if (!chain) return null;
  const db = getDb();
  let current: Record<string, unknown> | undefined = row;
  for (const hop of chain) {
    const value = current?.[hop.fk];
    if (value === null || value === undefined) return null;
    if (incoming) {
      const candidates = incoming.get(hop.table) ?? [];
      current = candidates.find((candidate) => String(candidate[hop.key]) === String(value)) as Record<string, unknown> | undefined;
      // A parent absent from the package is not an error: fall back to the live row, so
      // a partial package still resolves against what this machine already holds.
      if (!current) {
        current = db
          .prepare(`SELECT * FROM ${quoteIdentifier(hop.table)} WHERE ${quoteIdentifier(hop.key)} = ?`)
          .get(value as string) as Record<string, unknown> | undefined;
      }
    } else {
      current = db
        .prepare(`SELECT * FROM ${quoteIdentifier(hop.table)} WHERE ${quoteIdentifier(hop.key)} = ?`)
        .get(value as string) as Record<string, unknown> | undefined;
    }
    if (!current) return null;
  }
  const stamp = current?.updated_at;
  return typeof stamp === 'string' ? stamp : null;
}

// ── Build ────────────────────────────────────────────────────────────────────

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function primarySourceSyncScope(db: ReturnType<typeof getDb>): PrimarySourceSyncScope | null {
  if (getActiveVault().type !== 'primary_sources') return null;
  const settings = getPrimarySourcePolicySettings();
  const profiles = db.prepare(
    `SELECT item_id, access_status, sensitivity, embargo_until
       FROM archive_item_profiles`
  ).all() as Array<{
    item_id: string;
    access_status: 'open' | 'private' | 'restricted' | 'embargoed' | 'unknown';
    sensitivity: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
    embargo_until: string | null;
  }>;
  const deniedItemIds = new Set(profiles.filter((row) =>
    decidePrimarySourcePolicy({
      accessStatus: row.access_status,
      sensitivity: row.sensitivity,
      embargoUntil: row.embargo_until,
      action: 'sync',
      allowPrivateSync: settings.allowPrivateSync,
      allowRestrictedSync: settings.allowRestrictedSync,
    }).decision !== 'allow'
  ).map((row) => row.item_id));
  const allowedClause = deniedItemIds.size
    ? `WHERE item_id NOT IN (${[...deniedItemIds].map(() => '?').join(',')})`
    : '';
  const denied = [...deniedItemIds];
  const columnSet = (sql: string, column: string, ...params: unknown[]): Set<string> =>
    new Set((db.prepare(sql).all(...params) as Record<string, unknown>[])
      .map((row) => row[column])
      .filter((value): value is string => typeof value === 'string'));
  const unitIds = columnSet(
    `WITH RECURSIVE kept(unit_id, parent_unit_id) AS (
       SELECT u.unit_id, u.parent_unit_id
         FROM archive_description_units u
        WHERE u.unit_id IN (
          SELECT unit_id FROM archive_item_units ${allowedClause}
        )
       UNION
       SELECT parent.unit_id, parent.parent_unit_id
         FROM archive_description_units parent JOIN kept ON kept.parent_unit_id=parent.unit_id
     ) SELECT unit_id FROM kept`,
    'unit_id',
    ...denied,
  );
  const repositoryIds = unitIds.size ? columnSet(
    `SELECT DISTINCT repository_id FROM archive_description_units
      WHERE unit_id IN (${[...unitIds].map(() => '?').join(',')})
        AND repository_id IS NOT NULL`,
    'repository_id',
    ...unitIds,
  ) : new Set<string>();
  const captureSessionIds = columnSet(
    `SELECT capture_session_id FROM archive_item_profiles
      WHERE capture_session_id IS NOT NULL
        ${deniedItemIds.size ? `AND item_id NOT IN (${denied.map(() => '?').join(',')})` : ''}`,
    'capture_session_id',
    ...denied,
  );
  const allowedItemWhere = deniedItemIds.size
    ? `WHERE item_id NOT IN (${denied.map(() => '?').join(',')})`
    : '';
  const fileIds = columnSet(`SELECT file_id FROM archive_item_files ${allowedItemWhere}`, 'file_id', ...denied);
  const textVersionIds = columnSet(`SELECT text_version_id FROM archive_text_versions ${allowedItemWhere}`, 'text_version_id', ...denied);
  const excerptIds = columnSet(`SELECT excerpt_id FROM archive_excerpts ${allowedItemWhere}`, 'excerpt_id', ...denied);
  const proposalIds = columnSet(`SELECT proposal_id FROM archive_entity_proposals ${allowedItemWhere}`, 'proposal_id', ...denied);
  const mentionIds = new Set([
    ...columnSet(`SELECT mention_id FROM archive_person_mentions ${allowedItemWhere}`, 'mention_id', ...denied),
    ...columnSet(`SELECT mention_id FROM archive_place_mentions ${allowedItemWhere}`, 'mention_id', ...denied),
  ]);

  const noteProfiles = db.prepare(
    `SELECT note_id, access_status, sensitivity FROM primary_source_note_profiles`
  ).all() as Array<{
    note_id: string;
    access_status: 'open' | 'private' | 'restricted' | 'embargoed' | 'unknown';
    sensitivity: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
  }>;
  const deniedNotes = new Set(noteProfiles.filter((row) =>
    decidePrimarySourcePolicy({
      accessStatus: row.access_status,
      sensitivity: row.sensitivity,
      action: 'sync',
      allowPrivateSync: settings.allowPrivateSync,
      allowRestrictedSync: settings.allowRestrictedSync,
    }).decision !== 'allow'
  ).map((row) => row.note_id));
  const noteIds = columnSet(
    deniedNotes.size
      ? `SELECT id FROM notes WHERE id NOT IN (${[...deniedNotes].map(() => '?').join(',')})`
      : 'SELECT id FROM notes',
    'id',
    ...deniedNotes,
  );
  const directFolders = noteIds.size ? columnSet(
    `SELECT folder_id FROM notes WHERE id IN (${[...noteIds].map(() => '?').join(',')})
      AND folder_id IS NOT NULL`,
    'folder_id',
    ...noteIds,
  ) : new Set<string>();
  const noteFolderIds = directFolders.size ? columnSet(
    `WITH RECURSIVE kept(id, parent_id) AS (
       SELECT id, parent_id FROM note_folders
        WHERE id IN (${[...directFolders].map(() => '?').join(',')})
       UNION
       SELECT parent.id, parent.parent_id
         FROM note_folders parent JOIN kept ON kept.parent_id=parent.id
     ) SELECT id FROM kept`,
    'id',
    ...directFolders,
  ) : new Set<string>();
  const noteLinkIds = new Set(
    (db.prepare('SELECT link_id, nodus_id, target_kind, target_id FROM note_links').all() as Array<{
      link_id: string;
      nodus_id: string;
      target_kind: string;
      target_id: string;
    }>).filter((row) => {
      if (!noteIds.has(row.nodus_id)) return false;
      if (row.target_kind === 'source') return !deniedItemIds.has(row.target_id);
      if (row.target_kind === 'excerpt') return excerptIds.has(row.target_id);
      if (row.target_kind === 'text_version') return textVersionIds.has(row.target_id);
      if (row.target_kind === 'unit') return unitIds.has(row.target_id);
      if (row.target_kind === 'note') return noteIds.has(row.target_id);
      return true;
    }).map((row) => row.link_id)
  );
  return {
    deniedItemIds,
    unitIds,
    repositoryIds,
    captureSessionIds,
    fileIds,
    textVersionIds,
    excerptIds,
    proposalIds,
    mentionIds,
    noteIds,
    deniedNoteIds: deniedNotes,
    noteFolderIds,
    noteLinkIds,
  };
}

function primarySourceSyncRows(
  table: string,
  rows: Record<string, unknown>[],
  scope: PrimarySourceSyncScope | null,
): Record<string, unknown>[] {
  if (!scope) return rows;
  // Export and model-call audits are deliberately local. Their aggregate counts
  // remain visible on this device, while package paths and selection snapshots do
  // not become a second channel around source policy.
  if ([
    'archive_exports',
    'primary_source_export_manifests',
    'primary_source_operation_runs',
    'primary_source_restore_reports',
  ].includes(table)) return [];
  const allowed = (value: unknown, set: Set<string>) => typeof value !== 'string' || set.has(value);
  return rows.filter((row) => {
    if (table === 'sync_tombstones' && typeof row.key_json === 'string') {
      const keyJson = row.key_json;
      if ([...scope.deniedItemIds, ...scope.deniedNoteIds].some((id) => keyJson.includes(id))) {
        return false;
      }
    }
    if (typeof row.item_id === 'string' && scope.deniedItemIds.has(row.item_id)) return false;
    if (table === 'archive_items' && scope.deniedItemIds.has(String(row.item_id))) return false;
    if (table === 'record_evidence' && scope.deniedItemIds.has(String(row.nodus_id))) return false;
    if (table === 'archive_description_units') return allowed(row.unit_id, scope.unitIds);
    if (table === 'archive_repositories') return allowed(row.repository_id, scope.repositoryIds);
    if (table === 'archive_capture_sessions') return allowed(row.session_id, scope.captureSessionIds);
    if (table === 'archive_integrity_checks') return allowed(row.file_id, scope.fileIds);
    if (table === 'archive_text_segments') return allowed(row.text_version_id, scope.textVersionIds);
    if (table === 'archive_proposal_decisions') return allowed(row.proposal_id, scope.proposalIds);
    if (table === 'archive_place_resolution_decisions') return allowed(row.mention_id, scope.mentionIds);
    if (table === 'notes') return allowed(row.id, scope.noteIds);
    if (table === 'note_folders') return allowed(row.id, scope.noteFolderIds);
    if (table === 'primary_source_note_profiles') return allowed(row.note_id, scope.noteIds);
    if (table === 'note_links') return allowed(row.link_id, scope.noteLinkIds);
    if (table === 'primary_source_note_link_snapshots') return allowed(row.link_id, scope.noteLinkIds);
    return true;
  });
}

/**
 * Snapshot the user layer into an encrypted zip.
 *
 * Blobs are their own entries rather than base64 inside one JSON string — that is what
 * used to exceed V8's maximum string length and make large vaults impossible to sync —
 * and each entry is sealed separately, so encryption does not reintroduce a moment where
 * the whole package exists as a single buffer.
 *
 * The table names live in the encrypted index, not in the zip directory: a file sitting
 * in a shared folder should not announce that it contains a gradebook.
 */
export function buildSyncPackage(appVersion: string, passphrase: string): { buffer: Buffer; counts: Record<string, number> } {
  if (!passphrase?.trim()) {
    throw new Error('Configura una frase de sincronización en Ajustes antes de exportar: los paquetes van cifrados.');
  }
  const db = getDb();
  const zip = new AdmZip();
  const kdf = newKdfDescriptor();
  const key = deriveKeyFromDescriptor(passphrase, kdf);
  const counts: Record<string, number> = {};
  const groups: Partial<Record<SyncGroupKey, string[]>> = {};
  const tableEntries: Record<string, string> = {};
  const blobEntries: Record<string, string> = {};
  const sourceScope = primarySourceSyncScope(db);

  const opaqueName = () => `e/${randomUUID().replace(/-/g, '')}`;
  const seal = (name: string, plaintext: Buffer) => zip.addFile(name, encryptWithKey(plaintext, key));

  const encodeValue = (value: unknown, column: string): PortableScalar => {
    if (Buffer.isBuffer(value)) {
      const hash = sha256(value);
      if (!blobEntries[hash]) {
        const name = opaqueName();
        seal(name, value);
        blobEntries[hash] = name;
      }
      return { __nodusBlob: hash };
    }
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    throw new Error(`El campo ${column} contiene un valor no portable.`);
  };

  for (const group of syncedTablesByGroup()) {
    if (group.tables.length === 0) continue;
    groups[group.key] = group.tables;
    for (const table of group.tables) {
      const rawRows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[];
      const rows = primarySourceSyncRows(table, rawRows, sourceScope).map((row) =>
        Object.fromEntries(Object.entries(row).map(([key_, value]) => [key_, encodeValue(value, key_)]))
      );
      counts[table] = rows.length;
      const name = opaqueName();
      seal(name, Buffer.from(JSON.stringify(rows)));
      tableEntries[table] = name;
    }
  }

  const index: SyncIndex = { counts, groups, tables: tableEntries, blobs: blobEntries };
  seal('index.bin', Buffer.from(JSON.stringify(index)));

  const manifest: SyncManifest = {
    format: SYNC_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    // The wire version (see SYNC_SCHEMA_VERSION): what a receiver needs to know is whether
    // a table changed shape, not whether an index was added.
    schemaVersion: SYNC_SCHEMA_VERSION,
    appVersion,
    // Kept in the clear so an incompatible package can be refused, and its age reported,
    // without asking for a passphrase first.
    date: new Date().toISOString(),
    kdf,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  return { buffer: zip.toBuffer(), counts };
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Reads one attachment out of the package. v2 stores it under its hash in the clear;
 *  v3 stores it under an opaque name, sealed. */
type BlobResolver = (hash: string) => Buffer;

function decodeValue(value: PortableScalar, resolveBlob: BlobResolver): string | number | Buffer | null {
  if (value && typeof value === 'object') {
    if ('__nodusBuffer' in value) {
      if (typeof value.__nodusBuffer !== 'string') throw new Error('Valor binario no válido en el paquete de sincronización.');
      return Buffer.from(value.__nodusBuffer, 'base64');
    }
    if (typeof value.__nodusBlob !== 'string') throw new Error('Valor binario no válido en el paquete de sincronización.');
    return resolveBlob(value.__nodusBlob);
  }
  return value;
}

/** v1 packages kept everything in one JSON object, with databases as nested trees.
 *  Flattened here so a single merge engine serves both formats. */
function readLegacyPayload(zip: AdmZip): TableRows {
  const entry = zip.getEntry('user-layer.json');
  if (!entry) throw new Error('Paquete inválido: faltan los datos.');
  const payload = JSON.parse(zip.readAsText(entry)) as Record<string, unknown>;
  const tables: TableRows = new Map();
  for (const [key, rows] of Object.entries(payload)) {
    if (key === 'databases' || !Array.isArray(rows)) continue;
    tables.set(key, rows as PortableRow[]);
  }
  const units = Array.isArray(payload.databases) ? (payload.databases as Record<string, PortableRow[] | PortableRow>[]) : [];
  const push = (table: string, rows: PortableRow[]) => tables.set(table, [...(tables.get(table) ?? []), ...rows]);
  for (const unit of units) {
    push('db_databases', [unit.database as PortableRow]);
    push('db_columns', (unit.columns ?? []) as PortableRow[]);
    push('db_select_options', (unit.options ?? []) as PortableRow[]);
    push('db_rows', (unit.rows ?? []) as PortableRow[]);
    push('db_cells', (unit.cells ?? []) as PortableRow[]);
    push('db_relations', (unit.relations ?? []) as PortableRow[]);
    push('db_views', (unit.views ?? []) as PortableRow[]);
    // v1 stored attachment bytes as `blob_b64`; the column is `blob`.
    push(
      'db_attachments',
      ((unit.attachments ?? []) as PortableRow[]).map(({ blob_b64: b64, ...rest }) => ({
        ...rest,
        blob: typeof b64 === 'string' ? { __nodusBuffer: b64 } : null,
      }))
    );
  }
  return tables;
}

interface OpenedPackage {
  tables: TableRows;
  counts: Record<string, number>;
  resolveBlob: BlobResolver;
}

/**
 * Read a package of any format version into the one shape the merge engine consumes.
 *
 * v3 is encrypted: the key is derived once and every entry is unsealed on demand, so a
 * package full of recordings never becomes one enormous buffer. v1 and v2 are read as
 * they always were — users still hold those files and stranding them would be the same
 * kind of data loss this whole effort is about.
 */
function openPackage(zip: AdmZip, manifest: SyncManifest, passphrase: string | undefined): OpenedPackage {
  if (manifest.formatVersion < 3) {
    const tables = manifest.formatVersion === 1 ? readLegacyPayload(zip) : new Map<string, PortableRow[]>();
    if (manifest.formatVersion === 2) {
      for (const table of Object.keys(manifest.counts ?? {})) {
        const entry = zip.getEntry(`tables/${table}.json`);
        if (!entry) throw new Error(`Paquete inválido: falta la tabla ${table}.`);
        tables.set(table, JSON.parse(entry.getData().toString('utf8')) as PortableRow[]);
      }
    }
    return {
      tables,
      counts: manifest.counts ?? {},
      resolveBlob: (hash) => {
        const entry = zip.getEntry(`blobs/${hash}`);
        if (!entry) throw new Error('Paquete incompleto: falta un adjunto referenciado.');
        return entry.getData();
      },
    };
  }

  if (!manifest.kdf) throw new Error('Paquete inválido: falta la descripción del cifrado.');
  if (!passphrase?.trim()) {
    throw new Error('Este paquete está cifrado. Introduce la frase de sincronización del equipo que lo generó.');
  }
  const indexEntry = zip.getEntry('index.bin');
  if (!indexEntry) throw new Error('Paquete inválido: falta el índice cifrado.');

  const key = deriveKeyFromDescriptor(passphrase, manifest.kdf);
  let index: SyncIndex;
  try {
    index = JSON.parse(decryptWithKey(indexEntry.getData(), key).toString('utf8')) as SyncIndex;
  } catch {
    // The index is authenticated, so a failure here is a wrong passphrase or a damaged
    // file — and there is no way to tell which, by design.
    throw new Error('No se pudo descifrar el paquete. Revisa la frase de sincronización.');
  }

  const unseal = (entryName: string, what: string): Buffer => {
    const entry = zip.getEntry(entryName);
    if (!entry) throw new Error(`Paquete incompleto: falta ${what}.`);
    return decryptWithKey(entry.getData(), key);
  };

  const tables: TableRows = new Map();
  for (const [table, entryName] of Object.entries(index.tables ?? {})) {
    tables.set(table, JSON.parse(unseal(entryName, `la tabla ${table}`).toString('utf8')) as PortableRow[]);
  }
  return {
    tables,
    counts: index.counts ?? {},
    // Unsealed only when a row actually references it, so unused attachments cost nothing.
    resolveBlob: (hash) => {
      const entryName = index.blobs?.[hash];
      if (!entryName) throw new Error('Paquete incompleto: falta un adjunto referenciado.');
      return unseal(entryName, 'un adjunto');
    },
  };
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Natural-key collisions across machines are the same real-world thing created twice,
 * not a conflict: both computers independently made academic year "2024/2025" with
 * different ids, and a UNIQUE index made the insert fail. That aborted the entire
 * transaction — every table, in both directions, permanently.
 *
 * Rather than skipping the row (which would leave its children pointing at an id that
 * never arrives, so COMMIT fails on the foreign keys instead), the incoming id is
 * rewritten to the local one everywhere it is referenced. The two records become one.
 */
function buildIdRemap(tables: TableRows, present: Set<string>): Map<string, Map<string, string>> {
  const db = getDb();
  const remap = new Map<string, Map<string, string>>();
  for (const [table, rows] of tables) {
    if (!present.has(table) || rows.length === 0) continue;
    const columns = db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
    const pk = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    if (pk.length !== 1) continue; // composite keys have no single id to rewrite

    const indexes = db.pragma(`index_list(${quoteIdentifier(table)})`) as { name: string; unique: number; origin: string; partial: number }[];
    const uniqueKeys = indexes
      // A partial index is only unique for rows satisfying its WHERE predicate. Treating
      // its columns as an unconditional natural key remapped every legacy db_row whose
      // unique_sequence was 0, even though those rows are deliberately outside the index.
      .filter((index) => index.unique === 1 && index.origin !== 'pk' && index.partial !== 1)
      .map((index) => (db.pragma(`index_info(${JSON.stringify(index.name)})`) as { name: string | null }[])
        .map((info) => info.name)
        .filter((name): name is string => typeof name === 'string'));
    if (uniqueKeys.length === 0) continue;

    const table_ = new Map<string, string>();
    for (const row of rows) {
      const incomingId = row[pk[0]];
      if (typeof incomingId !== 'string' && typeof incomingId !== 'number') continue;
      for (const key of uniqueKeys) {
        if (key.some((column) => row[column] === undefined || row[column] === null)) continue;
        const where = key.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
        const local = db
          .prepare(`SELECT ${quoteIdentifier(pk[0])} AS id FROM ${quoteIdentifier(table)} WHERE ${where}`)
          .get(...key.map((column) => row[column] as string | number)) as { id: string | number } | undefined;
        if (local && String(local.id) !== String(incomingId)) {
          table_.set(String(incomingId), String(local.id));
          break;
        }
      }
    }
    if (table_.size > 0) remap.set(table, table_);
  }
  return remap;
}

/** Apply the id remap to primary keys and to every column that is a declared foreign
 *  key into a remapped table. Only real FK columns are rewritten — never free text. */
function applyRemap(tables: TableRows, present: Set<string>, remap: Map<string, Map<string, string>>): void {
  if (remap.size === 0) return;
  const db = getDb();
  for (const [table, rows] of tables) {
    if (!present.has(table)) continue;
    const columns = db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
    const pk = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const ownRemap = remap.get(table);
    const foreignKeys = (db.pragma(`foreign_key_list(${quoteIdentifier(table)})`) as ForeignKey[])
      .filter((fk) => remap.has(fk.table));
    if (!ownRemap && foreignKeys.length === 0) continue;
    for (const row of rows) {
      if (ownRemap && pk.length === 1) {
        const mapped = ownRemap.get(String(row[pk[0]]));
        if (mapped !== undefined) row[pk[0]] = mapped;
      }
      for (const fk of foreignKeys) {
        const value = row[fk.from];
        if (value === null || value === undefined) continue;
        const mapped = remap.get(fk.table)?.get(String(value));
        if (mapped !== undefined) row[fk.from] = mapped;
      }
    }
  }
}

/**
 * Do these two versions of a row actually hold different content? Only real differences
 * are worth keeping: two rows whose timestamps moved but whose fields are identical are
 * not a conflict, and storing them would bury the genuine ones in noise.
 */
function rowValuesEqual(value: unknown, other: unknown): boolean {
  if (Buffer.isBuffer(value) || Buffer.isBuffer(other)) {
    return Buffer.isBuffer(value) && Buffer.isBuffer(other) && value.equals(other);
  }
  // NULL and "column absent" are the same absence for this purpose.
  return (value ?? null) === (other ?? null);
}

function rowsDiffer(incoming: Record<string, unknown>, local: Record<string, unknown>): boolean {
  return Object.entries(incoming).some(([name, value]) =>
    name !== 'updated_at' && name !== 'created_at' && !rowValuesEqual(value, local[name]));
}

/** Merge one table's rows: insert unknown primary keys, take the newer side otherwise.
 *  A row that violates a constraint is recorded and skipped — never fatal. */
function mergeTable(
  table: string,
  rows: PortableRow[],
  resolveBlob: BlobResolver,
  counts: SyncTableCounts,
  conflicts: SyncConflict[],
  insertedRowIds: Map<string, Set<number>>,
  incomingTables: TableRows,
  packageDate: string | null,
  supersededKept: { count: number },
  localTombstones: Map<string, string>
): void {
  const db = getDb();
  if (rows.length === 0) return;
  const columns = db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
  const allowed = new Set(columns.map((column) => column.name));
  const primaryKeys = identityColumns(table, columns);
  if (primaryKeys.length === 0) {
    counts.skipped += rows.length;
    conflicts.push({ table, reason: 'no-primary-key', rows: rows.length, detail: '' });
    return;
  }
  const where = identityWhere(columns, primaryKeys);
  const selectLocal = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`);

  for (const portable of rows) {
    try {
      const row = Object.fromEntries(
        Object.entries(portable)
          .filter(([key]) => allowed.has(key))
          .map(([key, value]) => [key, decodeValue(value, resolveBlob)])
      );
      if (primaryKeys.some((key) => row[key] === undefined)) {
        counts.skipped += 1;
        conflicts.push({ table, reason: 'missing-primary-key', rows: 1, detail: '' });
        continue;
      }
      ROW_NORMALIZERS[table]?.(row);
      const keyValues = primaryKeys.map((key) => row[key] as string | number);
      const local = selectLocal.get(...keyValues) as Record<string, unknown> | undefined;
      const names = Object.keys(row);
      if (!local) {
        // The row is unknown here because it was DELETED here. Re-inserting it is the
        // resurrection that made deletion impossible across two machines: the package
        // was simply built before the other computer heard about the deletion.
        const tombstone = localTombstones.get(tombstoneKey(table, JSON.stringify(keyValues)));
        if (tombstone) {
          const stamp = row.updated_at !== undefined ? 'updated_at' : row.created_at !== undefined ? 'created_at' : null;
          const rowStamp = stamp ? String(row[stamp] ?? '') : '';
          // Unless the other machine edited it AFTER the deletion, which makes the edit
          // the later fact and the row genuinely worth bringing back.
          if (!rowStamp || rowStamp <= tombstone) {
            counts.skipped += 1;
            continue;
          }
        }
        const result = db.prepare(
          `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
        ).run(...names.map((name) => row[name]));
        // Remembered so the foreign-key sweep can only ever remove rows THIS merge
        // created. A database that already contained a dangling reference must not lose
        // that row because an unrelated import happened to run.
        if (!insertedRowIds.has(table)) insertedRowIds.set(table, new Set());
        insertedRowIds.get(table)!.add(Number(result.lastInsertRowid));
        counts.inserted += 1;
        continue;
      }
      // Newest-wins. A row with no timestamp of its own defers to the ancestor that
      // carries one (a cell's row); failing that it is immutable content (link tables,
      // message bodies) and the local copy stands.
      const stamp = row.updated_at !== undefined ? 'updated_at' : row.created_at !== undefined ? 'created_at' : null;
      const incomingStamp = stamp ? String(row[stamp] ?? '') : inheritedStamp(table, row, incomingTables);
      const localStamp = stamp ? String(local[stamp] ?? '') : inheritedStamp(table, local, null);
      if (!incomingStamp || !localStamp || incomingStamp <= localStamp) {
        counts.skipped += 1;
        // The arriving version lost. If it differs from what is here, it is real work
        // from the other machine that this merge is choosing not to apply — keep it, so
        // a wrong clock costs a review rather than the edit itself.
        if (rowsDiffer(row, local)) {
          if (recordSuperseded({
            tableName: table,
            rowKey: keyValues,
            origin: 'incoming-lost',
            row,
            rowStamp: incomingStamp,
            winnerStamp: localStamp,
            packageDate,
          })) supersededKept.count += 1;
        }
        continue;
      }
      // Only mention fields that really changed in the UPDATE. SQLite's `UPDATE OF`
      // triggers fire when a column is present in SET even if its value is identical;
      // updating every portable field made a note-content merge spuriously revise its
      // universal page, so importing the same package again looked like a conflict.
      const mutable = names.filter((name) =>
        !primaryKeys.includes(name) && !rowValuesEqual(row[name], local[name]));
      if (mutable.length === 0) {
        counts.skipped += 1;
        continue;
      }
      // The arriving version won and is about to replace what is on this machine. This
      // is the direction that used to destroy the user's own work with no trace of it.
      if (rowsDiffer(row, local)) {
        if (recordSuperseded({
          tableName: table,
          rowKey: keyValues,
          origin: 'local-overwritten',
          row: local,
          rowStamp: localStamp,
          winnerStamp: incomingStamp,
          packageDate,
        })) supersededKept.count += 1;
      }
      db.prepare(
        `UPDATE ${quoteIdentifier(table)} SET ${mutable.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${where}`
      ).run(...mutable.map((name) => row[name]), ...keyValues);
      counts.updated += 1;
    } catch (error) {
      // SQLite rolls back the failed STATEMENT, not the transaction, so the merge
      // carries on and the user gets a report instead of a dead sync.
      counts.skipped += 1;
      const collision = table === 'pages' && portable.row_id
        ? db.prepare('SELECT id, row_id FROM pages WHERE row_id = ?').get(portable.row_id as string) as { id: string; row_id: string } | undefined
        : undefined;
      conflicts.push({
        table,
        reason: 'constraint',
        rows: 1,
        detail: `${error instanceof Error ? error.message : String(error)} [${primaryKeys.map((key) => `${key}=${String(portable[key])}`).join(', ')}]${collision ? ` local=${collision.id}` : ''}`,
      });
    }
  }
}

/**
 * Drop rows whose foreign keys point nowhere. Deferred FK violations surface at COMMIT
 * and take the whole transaction with them, so they are resolved before that: the
 * offending rows are removed and reported. Repeated because deleting a parent can
 * orphan a child that was itself just inserted.
 */
function dropDanglingRows(insertedRowIds: Map<string, Set<number>>, conflicts: SyncConflict[]): void {
  const db = getDb();
  if (insertedRowIds.size === 0) return;
  for (let pass = 0; pass < 5; pass++) {
    let removed = 0;
    // Scoped to the tables this merge inserted into: checking the whole database would
    // be slow on a real corpus and would surface pre-existing problems this import did
    // not cause and must not "fix" by deleting the user's rows.
    for (const [table, rowIds] of insertedRowIds) {
      const violations = db.pragma(`foreign_key_check(${quoteIdentifier(table)})`) as {
        table: string;
        rowid: number | null;
        parent: string;
      }[];
      for (const violation of violations) {
        if (violation.rowid === null || !rowIds.has(Number(violation.rowid))) continue;
        try {
          // Undoing an insert this merge just made is housekeeping, not a user deleting
          // something. The DELETE trigger cannot tell the difference, so the tombstone it
          // writes is removed — otherwise the next sync would carry a deletion nobody
          // asked for back to the machine the row came from.
          const identity = identityColumns(table);
          const key = identity.length
            ? JSON.stringify(
              identity.map(
                (column) =>
                  (db.prepare(`SELECT ${quoteIdentifier(column)} AS v FROM ${quoteIdentifier(table)} WHERE rowid = ?`)
                    .get(violation.rowid) as { v: unknown } | undefined)?.v ?? null
              )
            )
            : null;
          db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE rowid = ?`).run(violation.rowid);
          if (key !== null) db.prepare('DELETE FROM sync_tombstones WHERE table_name = ? AND row_key = ?').run(table, key);
          rowIds.delete(Number(violation.rowid));
          removed += 1;
          conflicts.push({ table, reason: 'missing-parent', rows: 1, detail: violation.parent });
        } catch {
          /* a WITHOUT ROWID table cannot be addressed this way; it is reported below */
        }
      }
    }
    if (removed === 0) return;
  }
}

function zeroCounts(): SyncTableCounts {
  return { inserted: 0, updated: 0, skipped: 0 };
}


export interface MergeTablesOptions {
  /** Wall clock the incoming rows were produced at, used for inherited timestamps. */
  packageDate: string | null;
  source: 'sync-package' | 'server-mutations';
}

export interface MergeTablesResult {
  groups: Record<SyncGroupKey, SyncTableCounts>;
  conflicts: SyncConflict[];
  unknownTables: string[];
  supersededKept: { count: number };
  deletions: { applied: number };
  clockSkewAheadMs: number;
  packageDate: string | null;
}

/**
 * Merge a set of incoming rows into the live database.
 *
 * Extracted verbatim from mergeSyncPackage() so that a .nodussync import and a batch of
 * mutations pulled from Nodus Server go through ONE conflict policy rather than two. Two
 * answers to "which version of this row wins" is exactly the kind of divergence that shows
 * up months later as data that disappeared on one machine and not the other.
 *
 * The policy itself is unchanged: newest-wins by updated_at (or created_at), deletions
 * applied first and local tombstones consulted while merging so a deleted row is not
 * re-inserted, foreign keys deferred until the whole batch is in place, and the LOSER of
 * every comparison preserved in sync_superseded so a wrong clock costs a review rather than
 * the work itself.
 */
export function mergeTables(
  tables: TableRows,
  resolveBlob: BlobResolver,
  options: MergeTablesOptions,
): MergeTablesResult {
  const db = getDb();
  const present = localTableNames();
  const tableGroup = groupOfTable();
  const groups = Object.fromEntries(syncedTablesByGroup().map((group) => [group.key, zeroCounts()])) as Record<SyncGroupKey, SyncTableCounts>;
  const conflicts: SyncConflict[] = [];
  const unknownTables: string[] = [];
  const insertedRowIds = new Map<string, Set<number>>();
  const supersededKept = { count: 0 };
  const packageDate = options.packageDate;
  // Newest-wins compares wall clocks, so a machine whose clock runs ahead wins every
  // conflict it takes part in. That is the only direction a one-way package can reveal
  // (an old package and a slow clock look identical), so it is measured and reported —
  // and the LOSER of every comparison is kept regardless, which is what actually makes a
  // wrong clock survivable rather than silent.
  const clockSkewAheadMs = measureClockSkewAhead(packageDate);

  const deletions = { applied: 0 };

  const tx = db.transaction(() => {
    // Children may arrive before parents, and remapping can move a parent id, so
    // constraints are only enforced once the whole package is in place.
    db.pragma('defer_foreign_keys = ON');
    const remap = buildIdRemap(tables, present);
    applyRemap(tables, present, remap);

    // Deletions are applied FIRST, and the local tombstone table is consulted while
    // merging, so a row deleted here is never re-inserted and then removed again — the
    // round trip would fire the triggers and leave the two machines arguing.
    const incomingTombstones = (tables.get('sync_tombstones') ?? []) as unknown as TombstoneRow[];
    applyIncomingTombstones(incomingTombstones, present, groups.tombstones, conflicts, supersededKept, deletions, packageDate);
    const localTombstones = readLocalTombstones();

    // Universal pages must precede both their page_* children and db_rows/notes. Those
    // owner tables have compatibility triggers that create an empty page on INSERT;
    // importing the canonical page first makes the trigger's INSERT OR IGNORE a no-op
    // instead of creating a competing id for the same UNIQUE row_id/note_id.
    const mergePriority = (table: string) => table === 'pages' ? -100 : table.startsWith('page_') ? 100 : 0;
    const orderedTables = [...tables.entries()].map((entry, index) => ({ entry, index }))
      .sort((left, right) => mergePriority(left.entry[0]) - mergePriority(right.entry[0]) || left.index - right.index)
      .map(({ entry }) => entry);
    for (const [table, rows] of orderedTables) {
      if (table === 'sync_tombstones') continue; // handled above, not as ordinary rows
      const group = tableGroup.get(table);
      if (!present.has(table) || !group) {
        // A table this build does not know (older app, newer package) is reported by
        // name instead of vanishing into an aggregate "skipped" number.
        if (rows.length > 0) unknownTables.push(table);
        continue;
      }
      mergeTable(table, rows, resolveBlob, groups[group], conflicts, insertedRowIds, tables, packageDate, supersededKept, localTombstones);
    }
    // A chat filed on the other device in a folder that was deleted here (or that the merge
    // is about to drop) arrives pointing at nothing. Deletion wins: the chat stays in its
    // project with no folder, before the foreign keys are checked, and again after the
    // dangling rows go, since removing a folder can orphan a reference.
    repairAllChatPlacements(db);
    dropDanglingRows(insertedRowIds, conflicts);
    repairAllChatPlacements(db);
  });
  tx();

  return { groups, conflicts, unknownTables: [...new Set(unknownTables)].sort(), supersededKept, deletions, clockSkewAheadMs, packageDate };
}

/**
 * Merge a sync package into the live database. Additive and newest-wins: unknown rows
 * are inserted, rows present on both sides take whichever `updated_at` (or
 * `created_at`) is newer, and local rows absent from the package are left alone.
 */
export function mergeSyncPackage(buffer: Buffer, passphrase?: string): SyncMergeSummary {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Archivo de sincronización ilegible.');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Paquete inválido: faltan manifest o datos.');

  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as SyncManifest;
  if (manifest.format !== SYNC_FORMAT || !(manifest.formatVersion >= 1 && manifest.formatVersion <= SYNC_FORMAT_VERSION)) {
    throw new Error('Formato de paquete de sincronización no soportado.');
  }
  // A package from a newer schema carries columns and tables this build does not know.
  // Merging it anyway silently DROPS them, and because the truncated row keeps the newer
  // timestamp, the next sync back propagates the loss to the machine that was up to
  // date. Refusing is the only safe answer.
  if (Number.isFinite(manifest.schemaVersion) && manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `El paquete procede de una versión más reciente de Nodus (esquema v${manifest.schemaVersion}, este equipo usa v${SCHEMA_VERSION}). Actualiza la app antes de importarlo.`
    );
  }

  const { tables, counts: declaredCounts, resolveBlob } = openPackage(zip, manifest, passphrase);
  for (const [table, expected] of Object.entries(declaredCounts)) {
    const rows = tables.get(table);
    if (!Array.isArray(rows) || rows.length !== expected) {
      throw new Error(`Paquete inválido: el recuento de ${table} no coincide con su manifiesto.`);
    }
  }

  const merged = mergeTables(tables, resolveBlob, {
    packageDate: typeof manifest.date === 'string' ? manifest.date : null,
    source: 'sync-package',
  });
  const { groups, conflicts, unknownTables, supersededKept, deletions, clockSkewAheadMs, packageDate } = merged;

  return {
    groups,
    protectCopies: groups.protect,
    conflicts,
    unknownTables: [...new Set(unknownTables)].sort(),
    packageSchemaVersion: Number.isFinite(manifest.schemaVersion) ? manifest.schemaVersion : 0,
    localSchemaVersion: SCHEMA_VERSION,
    supersededKept: supersededKept.count,
    deletionsApplied: deletions.applied,
    // A package built before the tombstone horizon may predate deletions this machine
    // has already forgotten, so rows it carries can legitimately come back.
    predatesTombstoneHorizon: packageIsOlderThanHorizon(packageDate),
    clockSkewAheadMs,
  };
}

/** One function builds the lookup key on both sides. When the reader and the writer
 *  each formatted it themselves, a single mistyped separator made every lookup miss and
 *  deletions silently stopped being suppressed — with no error anywhere. */
function tombstoneKey(table: string, rowKey: string): string {
  return `${table}\u0000${rowKey}`;
}

/** Every deletion this machine knows about, keyed the same way the triggers write it. */
function readLocalTombstones(): Map<string, string> {
  const rows = getDb().prepare('SELECT table_name, row_key, deleted_at FROM sync_tombstones').all() as TombstoneRow[];
  return new Map(rows.map((row) => [tombstoneKey(row.table_name, row.row_key), row.deleted_at]));
}

/**
 * Apply the deletions the other machine performed.
 *
 * A tombstone only wins if it is newer than the row here: if this machine edited the row
 * after the other deleted it, that edit is the later fact and the row stays. Whatever is
 * removed is kept in `sync_superseded` first, so a deletion arriving from another
 * computer is never the end of the story.
 */
function applyIncomingTombstones(
  incoming: TombstoneRow[],
  present: Set<string>,
  counts: SyncTableCounts,
  conflicts: SyncConflict[],
  supersededKept: { count: number },
  deletions: { applied: number },
  packageDate: string | null
): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO sync_tombstones (table_name, row_key, deleted_at) VALUES (?, ?, ?)
     ON CONFLICT(table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at
     WHERE excluded.deleted_at > sync_tombstones.deleted_at`
  );

  for (const tombstone of incoming) {
    const table = typeof tombstone.table_name === 'string' ? tombstone.table_name : '';
    const rowKey = typeof tombstone.row_key === 'string' ? tombstone.row_key : '';
    const deletedAt = typeof tombstone.deleted_at === 'string' ? tombstone.deleted_at : '';
    if (!table || !rowKey || !deletedAt) continue;
    // A tombstone for a table this build does not have is still recorded, so it can be
    // passed on to a third machine that does.
    if (!present.has(table)) {
      upsert.run(table, rowKey, deletedAt);
      counts.skipped += 1;
      continue;
    }

    let keyValues: unknown[];
    try {
      const parsed = JSON.parse(rowKey);
      if (!Array.isArray(parsed)) throw new Error('bad key');
      keyValues = parsed;
    } catch {
      continue;
    }

    try {
      const columns = tableColumns(table);
      const identity = identityColumns(table, columns);
      if (identity.length === 0 || identity.length !== keyValues.length) {
        upsert.run(table, rowKey, deletedAt);
        counts.skipped += 1;
        continue;
      }
      const where = identityWhere(columns, identity);
      const local = db
        .prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`)
        .get(...(keyValues as (string | number | null)[])) as Record<string, unknown> | undefined;

      if (local) {
        const localStamp =
          typeof local.updated_at === 'string' ? local.updated_at : typeof local.created_at === 'string' ? local.created_at : '';
        // An edit made here AFTER the other machine deleted it is the later fact.
        if (localStamp && localStamp > deletedAt) {
          counts.skipped += 1;
          continue;
        }
        if (recordSuperseded({
          tableName: table,
          rowKey: keyValues,
          origin: 'deleted-remotely',
          row: local,
          rowStamp: localStamp || null,
          winnerStamp: deletedAt,
          packageDate,
        })) supersededKept.count += 1;
        db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${where}`).run(...(keyValues as (string | number | null)[]));
        deletions.applied += 1;
        counts.updated += 1;
      } else {
        counts.inserted += 1;
      }
      // The DELETE above fired the trigger, which wrote a tombstone stamped now; force
      // the original time so both machines agree on WHEN the row died.
      db.prepare(
        `INSERT INTO sync_tombstones (table_name, row_key, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at`
      ).run(table, rowKey, deletedAt);
    } catch (error) {
      counts.skipped += 1;
      conflicts.push({
        table,
        reason: 'constraint',
        rows: 1,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
