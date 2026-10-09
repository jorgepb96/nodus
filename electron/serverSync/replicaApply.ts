import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { quoteIdentifier, identityColumns, tableColumns } from '../db/rowIdentity';
import { MUTABLE_TABLES, withOutboxSuppressed } from './outboxTriggers';
import { ASSET_SOURCES, type SnapshotAssetRef } from './serverSnapshot';

/**
 * Write a published snapshot into a replica's database.
 *
 * Two kinds of table, two rules, and the distinction is the whole design:
 *
 *   • CORPUS tables (works, ideas, edges, evidence, passages…) are derived by the owner's
 *     analysis pipeline. A replica has no pipeline of its own and can never legitimately
 *     edit them, so the server is simply authoritative: the local copy is replaced. Doing
 *     anything cleverer would mean carrying rows the owner has deleted forever.
 *
 *   • AUTHORED tables (notes, drafts, immersion sessions…) are the ones a reader writes in.
 *     Replacing those would delete their own work every time a colleague republished, so
 *     these are merged row by row, newest wins by updated_at.
 *
 * Both happen with the outbox triggers detached. Otherwise applying a publication would
 * queue every row it just delivered and the replica would try to send the corpus back.
 */

const AUTHORED = new Set<string>(MUTABLE_TABLES);

export interface SnapshotApplySummary {
  replaced: Record<string, number>;
  merged: Record<string, { inserted: number; updated: number; kept: number }>;
  skipped: string[];
}

function timestampOf(row: Record<string, unknown>): number {
  for (const column of ['updated_at', 'created_at']) {
    const value = row[column];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function insertStatement(db: Database.Database, table: string, columns: string[]) {
  return db.prepare(
    `INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) ` +
    `VALUES (${columns.map(() => '?').join(', ')})`
  );
}

/**
 * Columns that describe THIS machine's live work rather than the corpus. A snapshot taken
 * while the owner had a deep scan queued would otherwise hand every replica a queued job
 * to run on its own AI budget the next time it resumes.
 */
const LOCAL_ONLY_COLUMNS: Record<string, Set<string>> = { works: new Set(['deep_queued']) };

/**
 * The local-only values this replica has to carry across the wipe. A corpus table is
 * emptied and refilled from the publication, and the publication deliberately does not
 * carry these columns, so the refilled row would take their defaults — discarding state
 * that belongs to THIS machine. `works.deep_queued` is exactly that: a rescan queued here
 * would be forgotten by the next pull and lost at the next restart. Same shape as the
 * asset-blob rescue above, and for the same reason. Defaults need no rescue, so only
 * values that are actually set are captured.
 */
function captureLocalOnly(
  db: Database.Database,
  table: string
): { keyColumns: string[]; entries: { key: unknown[]; values: Record<string, unknown> }[] } | null {
  const wanted = LOCAL_ONLY_COLUMNS[table];
  if (!wanted) return null;
  const columns = tableColumns(table, db);
  const keyColumns = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  const local = columns.map((column) => column.name).filter((name) => wanted.has(name));
  if (keyColumns.length === 0 || local.length === 0) return null;
  const rows = db
    .prepare(`SELECT ${[...keyColumns, ...local].map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)}`)
    .all() as Record<string, unknown>[];
  const entries = rows
    .map((row) => ({
      key: keyColumns.map((column) => row[column]),
      values: Object.fromEntries(
        local.filter((column) => row[column] !== null && row[column] !== 0 && row[column] !== '')
          .map((column) => [column, row[column]])
      ),
    }))
    .filter((entry) => Object.keys(entry.values).length > 0);
  return entries.length > 0 ? { keyColumns, entries } : null;
}

/** Only the columns the local schema actually has: an older replica simply drops the rest. */
function usableColumns(db: Database.Database, table: string, rows: Record<string, unknown>[]): string[] {
  const local = new Set(tableColumns(table, db).map((column) => column.name));
  const localOnly = LOCAL_ONLY_COLUMNS[table];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (local.has(column) && !localOnly?.has(column)) seen.add(column);
    }
  }
  return [...seen];
}

interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

/**
 * Empty the corpus tables in an order where no cascade can damage a surviving row.
 *
 * Deleting a parent fires ON DELETE SET NULL on its children, and a child with a CHECK like
 * "at least one of these four references must be present" then fails — which aborted the
 * entire pull. Measured on a real study vault: emptying `study_courses` nulled a placement
 * that still existed and broke its constraint.
 *
 * Dependants are therefore emptied first. Only edges between tables in this batch matter; a
 * cycle (rare, and SQLite allows it) simply keeps its arbitrary order, which is no worse
 * than what we had.
 */
function deletionOrder(db: Database.Database, tables: string[]): string[] {
  const set = new Set(tables);
  const dependsOn = new Map<string, Set<string>>();
  for (const table of tables) {
    const parents = new Set<string>();
    try {
      for (const fk of db.pragma(`foreign_key_list(${quoteIdentifier(table)})`) as { table: string }[]) {
        if (fk.table !== table && set.has(fk.table)) parents.add(fk.table);
      }
    } catch { /* a table without foreign keys reports nothing */ }
    dependsOn.set(table, parents);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (table: string) => {
    if (done.has(table) || visiting.has(table)) return;
    visiting.add(table);
    // Emit the tables that point AT this one before this one.
    for (const other of tables) {
      if (other !== table && dependsOn.get(other)?.has(table)) visit(other);
    }
    visiting.delete(table);
    done.add(table);
    ordered.push(table);
  };
  for (const table of tables) visit(table);
  return ordered;
}

/**
 * Keep the image bytes a previous pull downloaded.
 *
 * A corpus table is replaced wholesale, which would reset every portrait to the empty
 * placeholder and make the asset pass re-download the whole gallery on every single pull.
 * The bytes are content-addressed and cannot have changed if their row has not, so they are
 * lifted out before the delete and put back after the insert.
 */
function captureAssetBlobs(db: Database.Database, table: string): { key: unknown[]; values: Record<string, Buffer> }[] {
  const source = ASSET_SOURCES.find((entry) => entry.table === table);
  if (!source) return [];
  const columns = [source.blobColumn, source.thumbColumn];
  try {
    return (db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[])
      .map((row) => {
        const values: Record<string, Buffer> = {};
        for (const column of columns) {
          const value = row[column];
          if (Buffer.isBuffer(value) && value.length > 0) values[column] = value;
        }
        return { key: source.keyColumns.map((column) => row[column]), values };
      })
      .filter((entry) => Object.keys(entry.values).length > 0);
  } catch {
    return [];
  }
}

/**
 * Columns the local schema REQUIRES but the publication cannot carry.
 *
 * `person_portraits.blob` is NOT NULL, and a snapshot never carries binary — so inserting a
 * portrait's metadata failed the constraint and took the entire hydration transaction with
 * it. A genealogy replica arrived completely empty, and the failure was swallowed into a
 * phase nothing displayed.
 *
 * The answer is a zero-length placeholder: the row exists, so the asset pass has something
 * to fill, and a length of zero is exactly what that pass treats as "not downloaded yet".
 * Only BLOB columns qualify — inventing a value for a required text or numeric column would
 * be fabricating data rather than reserving a place for it.
 */
function blobPlaceholders(db: Database.Database, table: string, provided: Set<string>): string[] {
  return (db.pragma(`table_info(${quoteIdentifier(table)})`) as ColumnInfo[])
    .filter((column) => column.notnull === 1 && column.dflt_value === null && column.pk === 0)
    .filter((column) => !provided.has(column.name))
    .filter((column) => /BLOB/i.test(String(column.type ?? '')))
    .map((column) => column.name);
}

export function applySnapshotToReplica(db: Database.Database, snapshot: { tables?: Record<string, unknown> }): SnapshotApplySummary {
  const summary: SnapshotApplySummary = { replaced: {}, merged: {}, skipped: [] };
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  withOutboxSuppressed(db, () => {
    db.transaction(() => {
      // Children can arrive before parents, so constraints wait until the whole
      // publication is in place — the same discipline mergeSyncPackage uses.
      db.pragma('defer_foreign_keys = ON');

      const incoming = Object.entries(snapshot.tables ?? {})
        .filter((entry): entry is [string, Record<string, unknown>[]] => Array.isArray(entry[1]));
      db.exec(`CREATE TABLE IF NOT EXISTS sync_snapshot_tables (
        table_name TEXT PRIMARY KEY,
        projected_at TEXT NOT NULL
      )`);
      const incomingNames = new Set(incoming.map(([table]) => table));
      const previouslyProjected = (db.prepare('SELECT table_name FROM sync_snapshot_tables').all() as { table_name: string }[])
        .map((entry) => entry.table_name);

      // Omission from a newer authoritative projection is a deletion for corpus tables.
      // Without this, disabling a publication lane left its old rows readable forever.
      const removedCorpusTables = previouslyProjected.filter((table) => present.has(table) && !incomingNames.has(table) && !AUTHORED.has(table));

      // Every corpus table is emptied BEFORE any of them is refilled, and in dependency
      // order. Doing it table by table meant a later DELETE could cascade into rows an
      // earlier INSERT had just written — `person_portraits` hangs off `persons` with ON
      // DELETE CASCADE, and the publication is ordered alphabetically, so portraits went in
      // before people came out.
      const replaceable = [...new Set([
        ...incoming.map(([table]) => table).filter((table) => present.has(table) && !AUTHORED.has(table)),
        ...removedCorpusTables,
      ])];
      const preserved = new Map<string, ReturnType<typeof captureAssetBlobs>>();
      const preservedLocal = new Map<string, NonNullable<ReturnType<typeof captureLocalOnly>>>();
      for (const table of replaceable) {
        const captured = captureAssetBlobs(db, table);
        if (captured.length > 0) preserved.set(table, captured);
        const local = captureLocalOnly(db, table);
        if (local) preservedLocal.set(table, local);
      }
      for (const table of deletionOrder(db, replaceable)) {
        db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
      }
      db.prepare('DELETE FROM sync_snapshot_tables').run();
      const tombstoneOf = present.has('sync_tombstones')
        ? db.prepare('SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND row_key = ?')
        : null;
      const rememberProjection = db.prepare('INSERT INTO sync_snapshot_tables (table_name, projected_at) VALUES (?, ?)');
      const projectedAt = new Date().toISOString();
      for (const table of incomingNames) rememberProjection.run(table, projectedAt);

      for (const [table, value] of incoming) {
        if (!present.has(table)) { summary.skipped.push(table); continue; }
        const rows = value;

        if (!AUTHORED.has(table)) {
          if (rows.length > 0) {
            const carried = usableColumns(db, table, rows);
            if (carried.length === 0) { summary.skipped.push(table); continue; }
            const placeholders = blobPlaceholders(db, table, new Set(carried));
            const columns = [...carried, ...placeholders];
            const statement = insertStatement(db, table, columns);
            for (const row of rows) {
              statement.run([
                ...carried.map((column) => (row[column] === undefined ? null : row[column])),
                ...placeholders.map(() => Buffer.alloc(0)),
              ]);
            }
          }
          // Put back the image bytes this replica had already fetched, so an unchanged
          // gallery is not downloaded again on every pull.
          const keep = preserved.get(table);
          const source = keep ? ASSET_SOURCES.find((entry) => entry.table === table) : null;
          if (keep && source) {
            const where = source.keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
            for (const entry of keep) {
              const columns = Object.keys(entry.values);
              db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
                .run([...columns.map((column) => entry.values[column]), ...entry.key]);
            }
          }
          // Put back this machine's own columns, which the publication never carried.
          const localKeep = preservedLocal.get(table);
          if (localKeep) {
            const where = localKeep.keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
            for (const entry of localKeep.entries) {
              const columns = Object.keys(entry.values);
              db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
                .run([...columns.map((column) => entry.values[column]), ...entry.key]);
            }
          }
          summary.replaced[table] = rows.length;
          continue;
        }

        // Authored table: newest wins, and a purely local row is never touched.
        const identity = identityColumns(table, undefined, db);
        if (identity.length === 0) { summary.skipped.push(table); continue; }
        const columns = usableColumns(db, table, rows);
        if (columns.length === 0) { summary.merged[table] = { inserted: 0, updated: 0, kept: 0 }; continue; }
        const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
        const find = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`);
        const insertPlaceholders = blobPlaceholders(db, table, new Set(columns));
        const insert = insertStatement(db, table, [...columns, ...insertPlaceholders]);
        // An existing row is UPDATED column by column rather than replaced. A publication
        // never carries binary, so INSERT OR REPLACE would blank the illustration bytes a
        // previous pull had downloaded — every report losing its image on the next sync.
        const assignable = columns.filter((column) => !identity.includes(column));
        const update = assignable.length > 0
          ? db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${assignable.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
          : null;
        const counts = { inserted: 0, updated: 0, kept: 0 };
        for (const row of rows) {
          const key = identity.map((column) => row[column] ?? null);
          const local = find.get(...key) as Record<string, unknown> | undefined;
          if (!local) {
            // Absent because it was DELETED here. A snapshot is the owner's last
            // publication and keeps carrying the row until the owner has collected this
            // deletion and republished, so inserting it would resurrect it — and the merge
            // never removes a local row, so it would then outlive every other copy. Same
            // rule as mergeSyncPackage: only an edit made after the deletion brings it back.
            const deletedAt = tombstoneOf?.get(table, JSON.stringify(key)) as { deleted_at: string } | undefined;
            if (deletedAt) {
              const stamp = typeof row.updated_at === 'string' ? row.updated_at : typeof row.created_at === 'string' ? row.created_at : '';
              if (!stamp || stamp <= deletedAt.deleted_at) { counts.kept += 1; continue; }
            }
            insert.run([
              ...columns.map((column) => (row[column] === undefined ? null : row[column])),
              ...insertPlaceholders.map(() => Buffer.alloc(0)),
            ]);
            counts.inserted += 1;
            continue;
          }
          if (timestampOf(row) > timestampOf(local) && update) {
            update.run([...assignable.map((column) => (row[column] === undefined ? null : row[column])), ...key]);
            counts.updated += 1;
          } else {
            counts.kept += 1;
          }
        }
        summary.merged[table] = counts;
      }
      const foreignKeyViolations = db.pragma('foreign_key_check') as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
      if (foreignKeyViolations.length > 0) {
        const detail = foreignKeyViolations.slice(0, 8)
          .map((entry) => `${entry.table}[${entry.rowid}] -> ${entry.parent}#${entry.fkid}`)
          .join(', ');
        throw new Error(`La publicación contiene relaciones incompletas: ${detail}`);
      }
    })();
  });

  return summary;
}

/**
 * Fetch the images a publication references and put their bytes back in the database.
 *
 * A snapshot carries no binary at all — that invariant is what keeps documents off the
 * server — so the rows arrive with `status = 'ready'` and an empty `image_blob`. Without
 * this pass every Deep Research report in a replica shows a broken illustration while
 * claiming to have one, which is worse than having none.
 *
 * Only what is missing is fetched: an image already present keeps its bytes, so a routine
 * pull of an unchanged corpus costs nothing.
 */
export async function downloadReplicaAssets(
  db: Database.Database,
  assets: SnapshotAssetRef[],
  fetchAsset: (hash: string) => Promise<Buffer | null>,
): Promise<{ downloaded: number; bytes: number; skipped: number }> {
  const result = { downloaded: 0, bytes: 0, skipped: 0 };
  if (!assets?.length) return result;
  const sources = new Map<string, (typeof ASSET_SOURCES)[number]>(ASSET_SOURCES.map((source) => [source.table, source]));
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  // Three phases on purpose: decide what is missing, fetch it, then write it. Keeping the
  // network out of the middle phase means the write pass is short and synchronous, which is
  // what lets it run with the queue triggers detached without holding them off across I/O.
  interface Pending { table: string; key: readonly string[]; blobColumn: string; mimeColumn: string | null; hash: string; mime: string | null }
  const pending: Pending[] = [];

  for (const asset of assets) {
    const source = sources.get(asset.table);
    // A table this vault type does not publish still has its images uploaded, so the row
    // may simply not be here. Nothing to attach them to; skip rather than invent a row.
    if (!source || !present.has(asset.table)) { result.skipped += 1; continue; }
    const where = source.keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
    const local = db.prepare(`SELECT * FROM ${quoteIdentifier(asset.table)} WHERE ${where}`).get(...asset.key) as Record<string, unknown> | undefined;
    if (!local) { result.skipped += 1; continue; }

    for (const [hash, blobColumn, mimeColumn, mime] of [
      [asset.hash, source.blobColumn, source.mimeColumn, asset.mime],
      [asset.thumbHash, source.thumbColumn, source.thumbMimeColumn, asset.thumbMime],
    ] as [string | null, string, string, string | null][]) {
      if (!hash) continue;
      const existing = local[blobColumn];
      // Length is checked before the digest so an unchanged replica does not read megabytes
      // through sha256 on every single pull.
      if (Buffer.isBuffer(existing) && existing.length > 0 && createHash('sha256').update(existing).digest('hex') === hash) continue;
      pending.push({
        table: asset.table,
        key: asset.key,
        blobColumn,
        mimeColumn: Object.prototype.hasOwnProperty.call(local, mimeColumn) ? mimeColumn : null,
        hash,
        mime,
      });
    }
  }
  if (pending.length === 0) return result;

  const fetched: (Pending & { bytes: Buffer })[] = [];
  for (const item of pending) {
    const bytes = await fetchAsset(item.hash);
    if (!bytes) continue;
    // Verify before storing. Content addressing is only a guarantee if it is checked.
    if (createHash('sha256').update(bytes).digest('hex') !== item.hash) continue;
    fetched.push({ ...item, bytes });
  }
  if (fetched.length === 0) return result;

  // Suppressed, and this is not optional: `decorative_images` is a table a writer replica
  // may queue changes from, so storing the owner's own illustrations without this would
  // enqueue every one of them and try to send the images straight back where they came from.
  withOutboxSuppressed(db, () => {
    db.transaction(() => {
      for (const item of fetched) {
        const where = (sources.get(item.table)!).keyColumns.map((column) => `${quoteIdentifier(column)} = ?`).join(' AND ');
        const columns = [item.blobColumn, ...(item.mimeColumn && item.mime ? [item.mimeColumn] : [])];
        const values: unknown[] = [item.bytes, ...(columns.length > 1 ? [item.mime] : [])];
        db.prepare(`UPDATE ${quoteIdentifier(item.table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`)
          .run([...values, ...item.key]);
        result.downloaded += 1;
        result.bytes += item.bytes.length;
      }
    })();
  });
  return result;
}
