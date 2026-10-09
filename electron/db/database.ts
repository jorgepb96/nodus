import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isMainThread, workerData } from 'node:worker_threads';
import { runMigrations, SCHEMA_VERSION } from './migrations';
import { ensureTombstoneTriggers, pruneTombstones } from './tombstones';
import { repairAllChatPlacements } from './chatHistoryTables';
import { ensureOutboxTriggers } from '../serverSync/outboxTriggers';
import { activeVaultDbPath, getVault, getVaultByPath } from '../vaults/vaultRegistry';
import { auditQaDatabaseOpen } from '../qa/databaseAudit';
import { migrateDatabaseSafely } from './migrationSafety';
import { scheduleMigrationRecoveryRetention } from './migrationRecoveryUtilityHost';
import { ensureBackupRevisionTriggers } from '../export/backupVaultRevision';
import { embeddingTextForIdea, embeddingTextHash } from './ideaEmbeddingText';

let db: Database.Database | null = null;
const jobDatabase = new AsyncLocalStorage<Database.Database>();

export function dbPath(): string {
  const workerPath = !isMainThread && workerData && typeof workerData === 'object'
    ? (workerData as { nodusDatabasePath?: unknown }).nodusDatabasePath
    : null;
  if (typeof workerPath === 'string' && path.isAbsolute(workerPath)) return workerPath;
  return activeVaultDbPath();
}

/**
 * The query vector of the paged scan in flight (see ./vectorScan.ts), unit length.
 *
 * A query vector bound as a SQL parameter is materialised into a fresh Buffer on
 * EVERY row, which on a 33k-row scan is a third of the whole cost. Holding it here
 * instead is safe for one reason only: it is written immediately before a SYNCHRONOUS
 * statement execution and cleared straight after, so nothing can run in between.
 */
let scanQuery: Float32Array | null = null;

/** Arms `vec_scan` for the statement about to be executed. Nothing else may call this. */
export function setVectorScanQuery(query: Float32Array | null): void {
  scanQuery = query;
}

/**
 * `vec_scan(embedding)`: the same cosine as `vec_cosine`, against the armed query.
 * One blob per row instead of two, and one square root instead of two — the query
 * side is already normalised.
 */
function vecScan(stored: Buffer | null): number {
  const query = scanQuery;
  if (!stored || !query) return 0;
  if (stored.byteLength === 0 || stored.byteLength !== query.length * 4) return 0;
  const vector = new Float32Array(stored.buffer, stored.byteOffset, stored.byteLength / 4);
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < query.length; i++) {
    dot += vector[i] * query[i];
    norm += vector[i] * vector[i];
  }
  return norm === 0 ? 0 : dot / Math.sqrt(norm);
}

/** Cosine similarity between two Float32 BLOBs, computed inside SQLite. */
function vecCosine(a: Buffer | null, b: Buffer | null): number {
  if (!a || !b) return 0;
  if (a.byteLength === 0 || a.byteLength !== b.byteLength || a.byteLength % 4 !== 0) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = fa.length;
  for (let i = 0; i < n; i++) {
    dot += fa[i] * fb[i];
    na += fa[i] * fa[i];
    nb += fb[i] * fb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Whether the database at `file` is a replica whose account may write.
 *
 * Deliberately fail-closed: if the registry cannot be read, or the vault is not connected,
 * or its role is reader, nothing is queued. A wrong answer here in the permissive direction
 * would send a reader's private notes to someone else's vault.
 */
function mayQueueMutations(file: string): boolean {
  try {
    const vault = getVaultByPath(file);
    if (!vault || vault.origin !== 'connected' || !vault.remote) return false;
    if (vault.remote.state !== 'active') return false;
    return vault.remote.role === 'writer' || vault.remote.role === 'owner';
  } catch {
    return false;
  }
}

/** Replace the migration's deterministic bootstrap id before any outbox trigger can use it. */
export function ensureWorkspaceDevice(database: Database.Database): void {
  const present = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_devices'").get();
  if (!present) return;
  const row = database.prepare('SELECT id FROM workspace_devices ORDER BY created_at, id LIMIT 1').get() as { id: string } | undefined;
  if (row && row.id !== 'local-device') return;
  const id = `device-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  database.prepare(
    `UPDATE workspace_devices SET id = ?, name = ?, last_hlc = ?, updated_at = ? WHERE id = 'local-device'`,
  ).run(id, `Nodus · ${os.hostname()}`, `0000000000000-000000-${id}`, timestamp);
  database.prepare(
    `UPDATE server_outbox SET device_id = ?, hlc = printf('%013d-%06d-%s', 0, 0, ?)
     WHERE device_id = 'local-device' AND state = 'pending'`,
  ).run(id, id);
}

function openDatabase(file: string): Database.Database {
  let next = new Database(file);
  try {
    auditQaDatabaseOpen(file, 'read-write');
  } catch (error) {
    next.close();
    throw error;
  }
  const migrationPending = Number(next.pragma('user_version', { simple: true })) < SCHEMA_VERSION;
  next = migrateDatabaseSafely(next, file, SCHEMA_VERSION, runMigrations);
  if (migrationPending) scheduleMigrationRecoveryRetention(file);
  ensureWorkspaceDevice(next);
  // Deletion tombstones are written by triggers, which are regenerated here rather than
  // created by a migration: the set of synced tables is decided in code, so a migration
  // could only ever capture the shape it had on the day it was written.
  ensureTombstoneTriggers(next);
  pruneTombstones(next);
  // Same reasoning for the outgoing queue of a connected vault — and this is the gate that
  // stops a reader from queueing anything: without triggers, nothing can write to
  // server_outbox no matter what the rest of the app believes.
  ensureOutboxTriggers(next, mayQueueMutations(file));
  ensureBackupRevisionTriggers(next);
  // A chat history's folders and projects are checked on every open: a placement that
  // names a folder or project that is gone (or a folder of another project) is cleared
  // here, so no chat can hide behind a reference that does not resolve. Opening the vault
  // never depends on it.
  try {
    repairAllChatPlacements(next);
  } catch (error) {
    console.warn('[db] chat history repair skipped:', error instanceof Error ? error.message : error);
  }
  next.pragma('busy_timeout = 5000');
  next.pragma('synchronous = NORMAL');
  next.pragma('temp_store = MEMORY');
  next.pragma('cache_size = -32768');
  next.pragma('mmap_size = 268435456');
  next.pragma('wal_autocheckpoint = 1000');
  next.function('vec_cosine', vecCosine);
  next.function('vec_scan', vecScan);
  // Lets the readiness presets evaluate idea-embedding freshness in SQL exactly as
  // `getWorkEmbeddingStatuses` does in JS. Without it the "Incomplete" filter could
  // never see a stale semantic index (its hash is computed here, not stored in a
  // form SQLite can compare). Registered from the same pure helper the pipeline uses.
  next.function('idea_embedding_text_hash', (type: unknown, label: unknown, statement: unknown, themeLabels: unknown) => {
    const themes = typeof themeLabels === 'string' && themeLabels
      ? themeLabels.split(',').filter(Boolean)
      : [];
    // Mirror the JS template semantics `getWorkEmbeddingStatuses` relies on: a NULL
    // label/statement stringifies to "null" in a template literal, so it must here too.
    const asJsText = (value: unknown): string => (value == null ? 'null' : String(value));
    return embeddingTextHash(embeddingTextForIdea({
      type: type == null ? null : String(type),
      label: asJsText(label),
      statement: asJsText(statement),
      themes,
    }));
  });
  const optimizeTimer = setTimeout(() => {
    let previousBusyTimeout: number | null = null;
    try {
      if (next.open) {
        // This is opportunistic maintenance, never part of the user's operation. A
        // scale import/calculation can own the writer lock for seconds; inheriting the
        // normal 5s busy timeout here froze the main Electron thread while an unrelated
        // worker was doing exactly what it should. Fail immediately and try next open.
        previousBusyTimeout = next.pragma('busy_timeout', { simple: true }) as number;
        next.pragma('busy_timeout = 0');
        next.pragma('optimize');
      }
    } catch {
      // The vault may have been switched/closed before the idle maintenance ran.
    } finally {
      try {
        if (next.open && previousBusyTimeout != null) next.pragma(`busy_timeout = ${previousBusyTimeout}`);
      } catch {
        // The connection closed between optimize and restoring its normal timeout.
      }
    }
  }, 2_000);
  optimizeTimer.unref();
  return next;
}

export function getDb(): Database.Database {
  const scoped = jobDatabase.getStore();
  if (scoped) return scoped;
  if (!db) {
    const target = dbPath();
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    db = openDatabase(target);
  }
  return db;
}

/** Run synchronous repository code against an already-open replica connection. */
export function withDatabaseContext<T>(database: Database.Database, work: () => T): T {
  const existing = jobDatabase.getStore();
  if (existing === database) return work();
  return jobDatabase.run(database, work);
}

/**
 * Run UI/global work without inheriting a completed background job's vault.
 * Timers and event listeners created inside AsyncLocalStorage retain its store
 * even after withVaultDatabase has closed that dedicated connection.
 */
export function withoutDatabaseContext<T>(work: () => T): T {
  return jobDatabase.exit(work);
}

/**
 * Run a long-lived task against its originating vault, independently of the live UI
 * connection. AsyncLocalStorage keeps every repository call on this dedicated connection
 * across provider awaits, while the user remains free to close/switch the active vault.
 */
export async function withVaultDatabase<T>(vaultId: string, work: () => Promise<T> | T): Promise<T> {
  const vault = getVault(vaultId);
  if (!vault) throw new Error('Bóveda no encontrada.');
  const existing = jobDatabase.getStore();
  if (existing?.name === vault.path) return work();

  const scoped = openDatabase(vault.path);
  try {
    return await jobDatabase.run(scoped, work);
  } finally {
    if (scoped.open) scoped.close();
  }
}

/**
 * The database file the live connection actually has open, or null when none is. This is
 * NOT always dbPath(): the connection is cached and only re-opened on an explicit
 * closeDb(), while dbPath() re-reads the vault registry from disk on every call. A second
 * Nodus instance switching vaults rewrites that registry underneath this process, so a
 * caller that reports which vault it is serving must ask here rather than trust the
 * registry.
 */
export function openDbPath(): string | null {
  return db ? db.name : null;
}

const beforeCloseListeners = new Set<() => void>();
export function onBeforeDatabaseClose(listener: () => void): () => void {
  beforeCloseListeners.add(listener);
  return () => { beforeCloseListeners.delete(listener); };
}

export function closeDb(): void {
  if (db) {
    for (const listener of beforeCloseListeners) listener();
    db.close();
    db = null;
  }
}

/**
 * Replace the live DB file with an imported one and re-open. Used by import.
 *
 * Copied to a sibling first and renamed into place, never copied over the vault: a copy that
 * fails part way (disk full, volume gone) would otherwise leave a truncated vault, and a copy
 * onto the same file opens THROUGH the `-wal` that any other connection still open on the vault
 * keeps beside it — the restore then reads back the old vault's rows, and that connection later
 * checkpoints its log into the new file. Renaming gives the import a new file of its own; the
 * stale log and shared-memory files are removed so SQLite starts it with fresh ones.
 */
export function replaceDbFile(sourceFile: string): void {
  closeDb();
  const target = dbPath();
  const staged = `${target}.incoming-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(sourceFile, staged);
    for (const sibling of [`${target}-wal`, `${target}-shm`]) fs.rmSync(sibling, { force: true });
    fs.renameSync(staged, target);
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
  db = openDatabase(target); // brings an older import up to the current schema
}

export function currentSchemaVersion(): number {
  return getDb().pragma('user_version', { simple: true }) as number;
}

export { SCHEMA_VERSION };
