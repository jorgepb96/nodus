import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { auditQaDatabaseOpen } from '../qa/databaseAudit';
import type { MigrationRecoverySnapshot } from '@shared/types';

export const MAJOR_SCHEMA_VERSIONS = Object.freeze([134, 135]);
export const MIGRATION_RECOVERY_RETENTION = 2;

export interface MigrationRecoveryPruneError {
  snapshotId: string;
  file: string;
  message: string;
}

export interface MigrationRecoveryPruneReport {
  databasePath: string;
  retention: number;
  discoveredSnapshots: number;
  keptSnapshots: number;
  removedSnapshots: number;
  removedBytes: number;
  errors: MigrationRecoveryPruneError[];
}

interface MigrationRecoveryPruneOptions {
  removeFile?: (file: string) => void;
}

export interface MigrationSafetyReport {
  format: 'nodus.schema-migration-report';
  formatVersion: 1;
  id: string;
  sourceDatabasePath: string;
  fromVersion: number;
  targetVersion: number;
  startedAt: string;
  finishedAt: string;
  status: 'succeeded' | 'failed-restored' | 'failed-unrestored';
  backup: MigrationRecoverySnapshot | null;
  before: DatabaseFingerprint;
  after: DatabaseFingerprint | null;
  error: string | null;
}

interface DatabaseFingerprint {
  quickCheck: string;
  foreignKeyViolations: number;
  tables: Record<string, number>;
}

function sha256File(file: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function migrationDirectory(databasePath: string): string {
  return path.join(path.dirname(databasePath), '.nodus', 'migrations');
}

function databaseFingerprint(db: Database.Database): DatabaseFingerprint {
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>).map((row) => row.name);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const escaped = table.replace(/"/g, '""');
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${escaped}"`).get() as { n: number }).n);
  }
  return {
    quickCheck: String(db.pragma('quick_check', { simple: true })),
    foreignKeyViolations: (db.pragma('foreign_key_check') as unknown[]).length,
    tables: counts,
  };
}

function snapshotFromManifest(value: unknown, manifestPath: string): MigrationRecoverySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<MigrationRecoverySnapshot> & { format?: string; formatVersion?: number };
  if (record.format !== 'nodus.schema-migration-snapshot' || record.formatVersion !== 1) return null;
  if (!record.id || !record.databasePath || !record.sourceDatabasePath || !record.sha256) return null;
  return {
    id: record.id,
    databasePath: path.resolve(record.databasePath),
    manifestPath,
    sourceDatabasePath: path.resolve(record.sourceDatabasePath),
    fromVersion: Number(record.fromVersion),
    targetVersion: Number(record.targetVersion),
    createdAt: String(record.createdAt),
    bytes: Number(record.bytes),
    sha256: record.sha256,
    quickCheck: String(record.quickCheck),
    immutable: Boolean(record.immutable),
    major: Boolean(record.major),
  };
}

function managedSnapshotFromManifest(
  value: unknown,
  manifestPath: string,
  sourceDatabasePath: string,
): MigrationRecoverySnapshot | null {
  const snapshot = snapshotFromManifest(value, manifestPath);
  if (!snapshot) return null;
  const match = /^pre-v(\d+)-from-v(\d+)-[a-f0-9]{16}$/.exec(snapshot.id);
  if (!match) return null;
  if (Number(match[1]) !== snapshot.targetVersion || Number(match[2]) !== snapshot.fromVersion) return null;
  if (!Number.isFinite(Date.parse(snapshot.createdAt))) return null;
  if (!/^[a-f0-9]{64}$/.test(snapshot.sha256) || snapshot.quickCheck !== 'ok' || !snapshot.immutable) return null;

  const directory = migrationDirectory(sourceDatabasePath);
  if (path.resolve(snapshot.sourceDatabasePath) !== path.resolve(sourceDatabasePath)) return null;
  if (path.resolve(manifestPath) !== path.resolve(directory, `${snapshot.id}.json`)) return null;
  if (path.resolve(snapshot.databasePath) !== path.resolve(directory, `${snapshot.id}.sqlite`)) return null;
  return snapshot;
}

function newestSnapshotFirst(a: MigrationRecoverySnapshot, b: MigrationRecoverySnapshot): number {
  const created = b.createdAt.localeCompare(a.createdAt);
  if (created !== 0) return created;
  if (a.targetVersion !== b.targetVersion) return b.targetVersion - a.targetVersion;
  if (a.fromVersion !== b.fromVersion) return b.fromVersion - a.fromVersion;
  return b.id.localeCompare(a.id);
}

/**
 * Removes only complete snapshot pairs created by this module. Unknown files, reports,
 * temporary copies and snapshots for a different database are deliberately ignored.
 * The SQLite file is always removed before its sidecar so an interrupted cleanup cannot
 * strand a large, undiscoverable copy on disk.
 */
export function pruneMigrationRecoverySnapshots(
  databasePath: string,
  options: MigrationRecoveryPruneOptions = {},
): MigrationRecoveryPruneReport {
  const sourceDatabasePath = path.resolve(databasePath);
  const directory = migrationDirectory(sourceDatabasePath);
  const report: MigrationRecoveryPruneReport = {
    databasePath: sourceDatabasePath,
    retention: MIGRATION_RECOVERY_RETENTION,
    discoveredSnapshots: 0,
    keptSnapshots: 0,
    removedSnapshots: 0,
    removedBytes: 0,
    errors: [],
  };
  if (!fs.existsSync(directory)) return report;

  const removeFile = options.removeFile ?? ((file: string) => fs.rmSync(file, { force: true }));
  const candidates: Array<{ snapshot: MigrationRecoverySnapshot; bytes: number }> = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    report.errors.push({
      snapshotId: 'directory',
      file: directory,
      message: error instanceof Error ? error.message : String(error),
    });
    return report;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('report-')) continue;
    const manifestPath = path.join(directory, entry.name);
    let snapshot: MigrationRecoverySnapshot | null = null;
    try {
      snapshot = managedSnapshotFromManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath, sourceDatabasePath);
    } catch {
      // Malformed or unreadable sidecars are not safe automatic-deletion targets.
    }
    if (!snapshot) continue;

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(snapshot.databasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        report.errors.push({
          snapshotId: snapshot.id,
          file: snapshot.databasePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    candidates.push({ snapshot, bytes: stat.size });
  }

  candidates.sort((a, b) => newestSnapshotFirst(a.snapshot, b.snapshot));
  report.discoveredSnapshots = candidates.length;
  report.keptSnapshots = Math.min(candidates.length, MIGRATION_RECOVERY_RETENTION);
  for (const candidate of candidates.slice(MIGRATION_RECOVERY_RETENTION)) {
    try {
      // Snapshots are intentionally mode 0400. Restoring owner write permission makes
      // removal reliable on Windows without weakening any snapshot that is retained.
      try { fs.chmodSync(candidate.snapshot.databasePath, 0o600); } catch { /* deletion reports the real failure */ }
      removeFile(candidate.snapshot.databasePath);
      report.removedSnapshots += 1;
      report.removedBytes += candidate.bytes;
    } catch (error) {
      try { fs.chmodSync(candidate.snapshot.databasePath, 0o400); } catch { /* the original deletion error remains authoritative */ }
      report.errors.push({
        snapshotId: candidate.snapshot.id,
        file: candidate.snapshot.databasePath,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    try {
      removeFile(candidate.snapshot.manifestPath);
    } catch (error) {
      report.errors.push({
        snapshotId: candidate.snapshot.id,
        file: candidate.snapshot.manifestPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

function createVerifiedSnapshot(
  sourceDatabasePath: string,
  fromVersion: number,
  targetVersion: number,
  major: boolean,
): MigrationRecoverySnapshot {
  const sourceHash = sha256File(sourceDatabasePath);
  const directory = migrationDirectory(sourceDatabasePath);
  fs.mkdirSync(directory, { recursive: true });
  const id = `pre-v${targetVersion}-from-v${fromVersion}-${sourceHash.slice(0, 16)}`;
  const databasePath = path.join(directory, `${id}.sqlite`);
  const manifestPath = path.join(directory, `${id}.json`);

  if (!fs.existsSync(databasePath)) {
    try {
      fs.copyFileSync(sourceDatabasePath, databasePath, fs.constants.COPYFILE_FICLONE);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTSUP' && code !== 'EINVAL' && code !== 'ENOSYS') throw error;
      fs.copyFileSync(sourceDatabasePath, databasePath);
    }
  }
  const backupHash = sha256File(databasePath);
  if (backupHash !== sourceHash) {
    fs.rmSync(databasePath, { force: true });
    throw new Error('La copia previa a la migración no coincide con el vault original.');
  }
  const check = new Database(databasePath, { readonly: true, fileMustExist: true });
  auditQaDatabaseOpen(databasePath, 'snapshot');
  let quickCheck = '';
  try {
    quickCheck = String(check.pragma('quick_check', { simple: true }));
  } finally {
    check.close();
  }
  if (quickCheck !== 'ok') throw new Error(`La copia previa a la migración no supera quick_check: ${quickCheck}`);
  fs.chmodSync(databasePath, 0o400);

  const snapshot: MigrationRecoverySnapshot = {
    id,
    databasePath,
    manifestPath,
    sourceDatabasePath: path.resolve(sourceDatabasePath),
    fromVersion,
    targetVersion,
    createdAt: new Date().toISOString(),
    bytes: fs.statSync(databasePath).size,
    sha256: backupHash,
    quickCheck,
    immutable: (fs.statSync(databasePath).mode & 0o222) === 0,
    major,
  };
  atomicWriteJson(manifestPath, { format: 'nodus.schema-migration-snapshot', formatVersion: 1, ...snapshot });
  return snapshot;
}

function restoreSnapshot(snapshot: MigrationRecoverySnapshot, originalMode: number): void {
  if (sha256File(snapshot.databasePath) !== snapshot.sha256) throw new Error('La copia de migración fue alterada y no se puede restaurar.');
  const target = snapshot.sourceDatabasePath;
  const staged = `${target}.restore-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(snapshot.databasePath, staged);
    fs.chmodSync(staged, originalMode & 0o777);
    for (const candidate of [target, `${target}-wal`, `${target}-shm`]) fs.rmSync(candidate, { force: true });
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  if (sha256File(target) !== snapshot.sha256) throw new Error('La restauración automática no coincide con la copia verificada.');
}

function writeMigrationReport(databasePath: string, report: MigrationSafetyReport): string {
  const directory = migrationDirectory(databasePath);
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(directory, `report-${stamp}-${report.id}.json`);
  atomicWriteJson(reportPath, report);
  return reportPath;
}

export function listMigrationRecoverySnapshots(databasePath: string): MigrationRecoverySnapshot[] {
  const directory = migrationDirectory(databasePath);
  if (!fs.existsSync(directory)) return [];
  const snapshots: MigrationRecoverySnapshot[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json') || name.startsWith('report-')) continue;
    const manifestPath = path.join(directory, name);
    try {
      const snapshot = snapshotFromManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
      if (!snapshot || !fs.existsSync(snapshot.databasePath)) continue;
      if (sha256File(snapshot.databasePath) !== snapshot.sha256) continue;
      if ((fs.statSync(snapshot.databasePath).mode & 0o222) !== 0) continue;
      const check = new Database(snapshot.databasePath, { readonly: true, fileMustExist: true });
      auditQaDatabaseOpen(snapshot.databasePath, 'read-only');
      try {
        if (String(check.pragma('quick_check', { simple: true })) !== 'ok') continue;
      } finally {
        check.close();
      }
      snapshots.push(snapshot);
    } catch {
      // A damaged sidecar is ignored; it never makes an unverified file available to UI.
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Migrates an already-open database and returns the live handle that callers must use.
 * Existing vaults are checkpointed, closed, copied byte-for-byte and verified before a
 * single migration runs. A failure restores that exact copy atomically, even when earlier
 * pending versions had already committed successfully.
 */
export function migrateDatabaseSafely(
  database: Database.Database,
  databasePath: string,
  targetVersion: number,
  migrate: (db: Database.Database) => void,
): Database.Database {
  const fromVersion = Number(database.pragma('user_version', { simple: true }));
  if (fromVersion >= targetVersion) {
    migrate(database);
    return database;
  }

  const startedAt = new Date().toISOString();
  const id = randomUUID();
  database.pragma('foreign_keys = ON');
  const before = databaseFingerprint(database);
  if (before.quickCheck !== 'ok') throw new Error(`El vault no supera quick_check antes de migrar: ${before.quickCheck}`);
  const originalMode = fs.statSync(databasePath).mode;
  const major = MAJOR_SCHEMA_VERSIONS.some((version) => version > fromVersion && version <= targetVersion);
  let snapshot: MigrationRecoverySnapshot | null = null;

  if (fromVersion > 0) {
    // The copy below is of the main file alone, so every commit must be in it first. A reader
    // holding a snapshot stops a TRUNCATE checkpoint short and leaves the newest commits in the
    // -wal; the copy would then lack them, and a failed migration restores the copy and deletes
    // the -wal. Wait for readers like any other statement would, and refuse rather than copy short.
    database.pragma('busy_timeout = 5000');
    const [checkpoint] = database.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
    if (checkpoint && (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed)) {
      database.close();
      throw new Error('El vault está en uso por otra conexión y no se puede copiar antes de migrar. No se ha modificado nada; vuelve a abrirlo en unos segundos.');
    }
    database.close();
    snapshot = createVerifiedSnapshot(databasePath, fromVersion, targetVersion, major);
    database = new Database(databasePath);
    auditQaDatabaseOpen(databasePath, 'read-write');
  }

  try {
    database.pragma('foreign_keys = ON');
    migrate(database);
    const after = databaseFingerprint(database);
    if (after.quickCheck !== 'ok' || after.foreignKeyViolations !== 0) {
      throw new Error(`La migración terminó con integridad inválida (quick_check=${after.quickCheck}, foreign_keys=${after.foreignKeyViolations}).`);
    }
    const report: MigrationSafetyReport = {
      format: 'nodus.schema-migration-report', formatVersion: 1, id,
      sourceDatabasePath: path.resolve(databasePath), fromVersion, targetVersion,
      startedAt, finishedAt: new Date().toISOString(), status: 'succeeded',
      backup: snapshot, before, after, error: null,
    };
    const reportPath = writeMigrationReport(databasePath, report);
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration_events'").get()) {
      database.prepare(
        `INSERT OR REPLACE INTO schema_migration_events
           (id, from_version, target_version, status, report_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, fromVersion, targetVersion, report.status, reportPath, report.finishedAt);
    }
    return database;
  } catch (cause) {
    if (database.open) database.close();
    let restored = false;
    let restorationError: unknown = null;
    if (snapshot) {
      try {
        restoreSnapshot(snapshot, originalMode);
        const check = new Database(databasePath, { readonly: true, fileMustExist: true });
        auditQaDatabaseOpen(databasePath, 'read-only');
        try {
          restored = String(check.pragma('quick_check', { simple: true })) === 'ok'
            && Number(check.pragma('user_version', { simple: true })) === fromVersion;
        } finally {
          check.close();
        }
      } catch (error) {
        restorationError = error;
      }
    }
    const errorText = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    const report: MigrationSafetyReport = {
      format: 'nodus.schema-migration-report', formatVersion: 1, id,
      sourceDatabasePath: path.resolve(databasePath), fromVersion, targetVersion,
      startedAt, finishedAt: new Date().toISOString(),
      status: restored ? 'failed-restored' : 'failed-unrestored',
      backup: snapshot, before, after: null,
      error: restorationError ? `${errorText}\nRestauración: ${String(restorationError)}` : errorText,
    };
    writeMigrationReport(databasePath, report);
    const suffix = restored ? ' El vault original se restauró automáticamente.' : ' No se pudo restaurar automáticamente.';
    throw new Error(`La migración del vault falló.${suffix}`, { cause });
  }
}
