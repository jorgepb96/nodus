import type Database from 'better-sqlite3';
import { identityColumns, quoteIdentifier } from '../db/rowIdentity';
import { SYNC_SCHEMA_VERSION } from '../db/syncSchemaVersion';
import { MUTABLE_TABLES, type MutableTable } from './generatedMutableTables';

/**
 * Which changes a connected vault owes the server, recorded by trigger.
 *
 * The same argument as tombstones: ~70 repositories write rows, and asking each of them to
 * remember to enqueue would mean that the one that forgot loses a colleague's work in
 * silence. Triggers are generated from one registry, so a table added by a later migration
 * either appears in MUTABLE_TABLES or it does not travel at all — never "sometimes".
 *
 * And this is where a reader is stopped. The triggers are installed ONLY for a vault whose
 * origin is 'connected' and whose account may write, so a reader's database has nothing
 * writing to server_outbox. Three independent layers say no to a reader: no triggers here,
 * a refusal to drain in replicaService, and a 403 at the server. The first is the one that
 * holds even if the UI is wrong.
 */

const UPSERT_PREFIX = 'nodus_outbox_up_';
const DELETE_PREFIX = 'nodus_outbox_del_';
const TRIGGER_LIKE = "(name LIKE 'nodus_outbox_up_%' OR name LIKE 'nodus_outbox_del_%')";

/**
 * Tables a replica may change, keyed to the identity used to address a row.
 *
 * Mirrors server/lib/core/mutations.mjs MUTABLE_TABLES. Everything derived from the corpus
 * is deliberately absent: `works`, `ideas`, `edges`, `evidence`, `passages`, `themes` and
 * `gaps` are the product of the owner's analysis pipeline and their identity depends on it.
 * So is anything about students, testimonies or prosopography, which are not shareable.
 */
export { MUTABLE_TABLES, type MutableTable };

/** `json_array(NEW."a", NEW."b")` — byte-identical to `JSON.stringify(values)` on the JS
 *  side, so a key written by SQL and one written by the sender compare equal. Getting this
 *  wrong once already produced a silent mismatch in the tombstone path. */
function keyExpression(alias: 'OLD' | 'NEW', identity: string[]): string {
  return `json_array(${identity.map((column) => `${alias}.${quoteIdentifier(column)}`).join(', ')})`;
}

/**
 * The queue holds at most one pending entry per row.
 *
 * `ON CONFLICT ... DO UPDATE` against the partial unique index turns a long editing session
 * into one mutation instead of one per keystroke-batch. `hex(randomblob(16))` gives the
 * entry an id without needing a UUID function inside SQLite.
 */
function enqueueStatement(table: string, op: 'upsert' | 'delete', keySql: string): string {
  const literal = `'${table.replace(/'/g, "''")}'`;
  const device = "COALESCE((SELECT id FROM workspace_devices ORDER BY created_at, id LIMIT 1), 'local-device')";
  const actor = "COALESCE((SELECT actor_id FROM workspace_devices ORDER BY created_at, id LIMIT 1), 'local')";
  const hlc = `printf('%013d-%06d-%s', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), (COALESCE((SELECT MAX(seq) FROM server_outbox), 0) + 1) % 1000000, ${device})`;
  return (
    `INSERT INTO server_outbox (id, seq, table_name, row_key, op, schema_version, created_at, state, attempts, last_error, actor_id, device_id, hlc) ` +
    `VALUES (lower(hex(randomblob(16))), ` +
    `COALESCE((SELECT MAX(seq) FROM server_outbox), 0) + 1, ` +
    `${literal}, ${keySql}, '${op}', ${SYNC_SCHEMA_VERSION}, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'pending', 0, NULL, ${actor}, ${device}, ${hlc}) ` +
    // A folded edit takes a NEW id. drainOutbox reads the live row, sends it, and marks the
    // entry sent by id once the server answers; an edit landing while that request is in
    // flight would otherwise be marked sent with it without ever having been read. The
    // server also deduplicates by id, so a re-send under the old id would be dropped as a
    // duplicate. A fresh id makes the newer state a mutation of its own.
    `ON CONFLICT(table_name, row_key) WHERE state = 'pending' DO UPDATE SET ` +
    `id = lower(hex(randomblob(16))), op = excluded.op,created_at = excluded.created_at, schema_version = excluded.schema_version, ` +
    `actor_id = excluded.actor_id, device_id = excluded.device_id, hlc = excluded.hlc, ` +
    `attempts = 0, last_error = NULL; ` +
    `UPDATE workspace_devices SET last_hlc = COALESCE((SELECT hlc FROM server_outbox ORDER BY seq DESC LIMIT 1), last_hlc), revision = revision + 1, ` +
    `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ${device};`
  );
}

function triggerSql(table: string, identity: string[]): { name: string; sql: string }[] {
  return [
    {
      name: `${UPSERT_PREFIX}${table}`,
      sql:
        `CREATE TRIGGER ${quoteIdentifier(`${UPSERT_PREFIX}${table}`)} AFTER INSERT ON ${quoteIdentifier(table)} BEGIN ` +
        `${enqueueStatement(table, 'upsert', keyExpression('NEW', identity))} END`,
    },
    {
      name: `${UPSERT_PREFIX}${table}_u`,
      sql:
        `CREATE TRIGGER ${quoteIdentifier(`${UPSERT_PREFIX}${table}_u`)} AFTER UPDATE ON ${quoteIdentifier(table)} BEGIN ` +
        `${enqueueStatement(table, 'upsert', keyExpression('NEW', identity))} END`,
    },
    {
      name: `${DELETE_PREFIX}${table}`,
      sql:
        `CREATE TRIGGER ${quoteIdentifier(`${DELETE_PREFIX}${table}`)} AFTER DELETE ON ${quoteIdentifier(table)} BEGIN ` +
        `${enqueueStatement(table, 'delete', keyExpression('OLD', identity))} END`,
    },
  ];
}

export function outboxTriggersInstalled(db: Database.Database): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND ${TRIGGER_LIKE}`).get() as { n: number };
  return row.n > 0;
}

/**
 * Install or remove the queue triggers to match this vault's situation.
 *
 * Runs on every database open, like the tombstone triggers, and is a handful of reads when
 * nothing has changed. Passing `enabled: false` drops them, which is what happens the moment
 * an account is downgraded to reader — from then on nothing new is queued, while whatever is
 * already pending is kept and marked, because discarding a colleague's unsent work without
 * telling them is the failure this whole design exists to avoid.
 */
export function ensureOutboxTriggers(db: Database.Database, enabled: boolean): void {
  const existing = new Map(
    (db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND ${TRIGGER_LIKE}`).all() as { name: string; sql: string | null }[])
      .map((row) => [row.name, row.sql ?? ''])
  );
  const wanted = new Map<string, string>();

  if (enabled) {
    const present = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
    );
    for (const table of MUTABLE_TABLES) {
      if (!present.has(table)) continue;
      let identity: string[];
      try { identity = identityColumns(table, undefined, db); } catch { continue; }
      // A row that cannot be identified cannot be addressed on the other side either.
      if (identity.length === 0) continue;
      for (const trigger of triggerSql(table, identity)) wanted.set(trigger.name, trigger.sql);
    }
  }

  if (existing.size === 0 && wanted.size === 0) return;
  const tx = db.transaction(() => {
    for (const [name, sql] of wanted) {
      if (existing.get(name) === sql) continue;
      db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)}`);
      db.exec(sql);
    }
    for (const name of existing.keys()) {
      if (!wanted.has(name)) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)}`);
    }
    if (!enabled) {
      db.prepare("UPDATE server_outbox SET state = 'rejected', last_error = ? WHERE state IN ('pending','sending')")
        .run('Esta cuenta ya no tiene permiso de escritura en el espacio remoto. Los cambios se conservan solo en este equipo.');
    }
  });
  tx();
}

/**
 * Run `work` with the queue triggers detached, then put them back exactly as they were.
 *
 * Applying an incoming publication writes to the very tables the triggers watch. Without
 * this, pulling from the server would enqueue every row it just delivered, and the replica
 * would immediately try to send the owner their own corpus back — growing on each round.
 *
 * The states of existing entries are untouched, which is why this is not simply
 * `ensureOutboxTriggers(db, false)`: that one deliberately rejects what is pending.
 */
export function withOutboxSuppressed<T>(db: Database.Database, work: () => T): T {
  const existing = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND ${TRIGGER_LIKE}`)
    .all() as { name: string; sql: string | null }[];
  if (existing.length === 0) return work();
  for (const trigger of existing) db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger.name)}`);
  try {
    return work();
  } finally {
    for (const trigger of existing) {
      if (trigger.sql) {
        try { db.exec(trigger.sql); } catch { /* re-created on the next open */ }
      }
    }
  }
}

export interface OutboxEntry {
  id: string;
  seq: number;
  table_name: MutableTable;
  row_key: string;
  op: 'upsert' | 'delete';
  schema_version: number;
  created_at: string;
  state: 'pending' | 'sending' | 'sent' | 'rejected';
  attempts: number;
  last_error: string | null;
  actor_id: string;
  device_id: string;
  hlc: string;
}

export function listPendingOutbox(db: Database.Database, limit: number): OutboxEntry[] {
  return db
    .prepare("SELECT * FROM server_outbox WHERE state = 'pending' ORDER BY seq LIMIT ?")
    .all(limit) as OutboxEntry[];
}

export function markOutboxSent(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const statement = db.prepare("UPDATE server_outbox SET state = 'sent' WHERE id = ?");
  db.transaction(() => { for (const id of ids) statement.run(id); })();
}

export function markOutboxRejected(db: Database.Database, ids: string[], reason: string): void {
  if (ids.length === 0) return;
  const statement = db.prepare("UPDATE server_outbox SET state = 'rejected', last_error = ?, attempts = attempts + 1 WHERE id = ?");
  db.transaction(() => { for (const id of ids) statement.run(reason, id); })();
}

export function countOutbox(db: Database.Database): { pending: number; rejected: number } {
  const row = db
    .prepare("SELECT SUM(state = 'pending') AS pending, SUM(state = 'rejected') AS rejected FROM server_outbox")
    .get() as { pending: number | null; rejected: number | null };
  return { pending: Number(row.pending ?? 0), rejected: Number(row.rejected ?? 0) };
}

/** Sent entries are only useful until the owner has them; keep the table from growing. */
export function pruneSentOutbox(db: Database.Database): void {
  db.prepare("DELETE FROM server_outbox WHERE state = 'sent'").run();
}
