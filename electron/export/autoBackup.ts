import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {
  AutoBackupResult,
  BackupCleanupPreview,
  BackupCleanupResult,
  BackupRetentionUnit,
} from '@shared/types';
import { SCHEMA_VERSION } from '../db/migrations';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getBackupPassword, getBackupRecoveryKey, lockedApiKeyProviders, setBackupRecoveryKey } from '../secrets/secretStore';
import { harnessKeysMode } from '../secrets/safeStorageGate';
import { generateBackupPassword } from './backupCrypto';
import { createBackupArchiveFile } from './exportImport';
import { verifyBackupFileInUtility } from './backupUtilityHost';
import { resolveBackupOutputDir } from '../recovery/recoveryPaths';
import { recordVerifiedRecoverySnapshot } from '../recovery/recoveryFolderProbe';

/**
 * Scheduled encrypted backups. Every run encrypts with the ONE master password
 * from the keychain (no per-file passwords to write down), writes into the
 * user-chosen folder — point it at iCloud Drive / Google Drive and the cloud
 * client does the off-machine transport. Existing installations keep the
 * grandfather-father-son policy unless the user explicitly opts into guarded
 * age-based cleanup. Every automatic backup contains the complete Nodus state,
 * including API keys, inside the encrypted payload.
 */

const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const KEEP_MONTHLY = 3;
const KEEP_PRE_UPDATE = 5;
const KEEP_ACTIVE_DURING_CLEANUP = 3;
const CLEANUP_TRASH_DIR = '.nodus-cleanup-trash';
const CLEANUP_TRASH_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const BACKUP_DATE_RE = /^(?:v[a-zA-Z0-9.+-]+-schema\d+-)?(\d{8})-(\d{6})\.nodus$/;
const PRE_UPDATE_DATE_RE = /^from-v[a-zA-Z0-9.+-]+-to-v[a-zA-Z0-9.+-]+-schema\d+-(\d{8})-(\d{6})\.nodus$/;
const TRASHED_BACKUP_RE = /^(.*\.nodus)\.trashed-(\d+)-(\d+)$/;

let activeBackupOperation: string | null = null;

function logBackupPerf(phase: string, startedAt: bigint, metadata: Record<string, string | number> = {}): bigint {
  const endedAt = process.hrtime.bigint();
  const elapsedMs = Number(endedAt - startedAt) / 1_000_000;
  const rssMiB = process.memoryUsage().rss / (1024 * 1024);
  const details = Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`[perf][backup] phase=${phase} elapsedMs=${elapsedMs.toFixed(1)} rssMiB=${rssMiB.toFixed(1)}${details ? ` ${details}` : ''}`);
  return endedAt;
}

async function withBackupOperation<T extends { ok: boolean; message: string }>(
  label: string,
  busyResult: (active: string) => T,
  work: () => Promise<T>,
): Promise<T> {
  if (activeBackupOperation) {
    return busyResult(activeBackupOperation);
  }
  activeBackupOperation = label;
  try {
    return await work();
  } finally {
    activeBackupOperation = null;
  }
}

export function sanitizeHostname(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'equipo';
}

function backupTimestamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeVersion(raw: string): string {
  const clean = raw.trim().replace(/^v/i, '').replace(/[^a-zA-Z0-9.+-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'desconocida';
}

/**
 * Legacy callers may omit version metadata and keep the historical filename. New
 * snapshots expose the same app/schema tags already stored inside the encrypted
 * manifest, without making old backup folders unreadable.
 */
export function backupFileName(hostname: string, date: Date, appVersion?: string, schemaVersion?: number): string {
  const versionTag = appVersion && Number.isInteger(schemaVersion)
    ? `v${sanitizeVersion(appVersion)}-schema${schemaVersion}-`
    : '';
  return `nodus-backup-${sanitizeHostname(hostname)}-${versionTag}${backupTimestamp(date)}.nodus`;
}

export function preUpdateBackupFileName(
  hostname: string,
  date: Date,
  currentVersion: string,
  targetVersion: string,
  schemaVersion: number,
): string {
  return [
    `nodus-pre-update-${sanitizeHostname(hostname)}`,
    `from-v${sanitizeVersion(currentVersion)}`,
    `to-v${sanitizeVersion(targetVersion)}`,
    `schema${schemaVersion}`,
    backupTimestamp(date),
  ].join('-') + '.nodus';
}

export function isBackupDue(lastAt: string | null, intervalHours: number, now = new Date()): boolean {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalHours * 60 * 60 * 1000;
}

/**
 * The most recent scheduled backup slot at or before `now`: the latest day whose
 * weekday is allowed (empty `days` = every day) at `hour:minute`. Returns null only
 * if no slot exists in the last week (shouldn't happen with a non-empty schedule).
 */
export function mostRecentBackupSlot(days: number[], hour: number, minute: number, now = new Date()): Date | null {
  const allowed = (weekday: number) => days.length === 0 || days.includes(weekday);
  for (let back = 0; back <= 7; back++) {
    const slot = new Date(now);
    slot.setDate(now.getDate() - back);
    slot.setHours(hour, minute, 0, 0);
    if (slot.getTime() <= now.getTime() && allowed(slot.getDay())) return slot;
  }
  return null;
}

/**
 * Schedule-aware "is a backup due?": true when a scheduled slot (a chosen weekday at
 * the chosen time) has passed since the last successful backup. This is what makes
 * the startup catch-up work — if the machine was off at the scheduled time, the most
 * recent slot is still in the past and after `lastAt`, so the next launch backs up.
 */
export function isScheduledBackupDue(
  lastAt: string | null,
  days: number[],
  hour: number,
  minute: number,
  now = new Date()
): boolean {
  const slot = mostRecentBackupSlot(days, hour, minute, now);
  if (!slot) return false;
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return true;
  return last < slot.getTime();
}

export interface ParsedBackup {
  file: string;
  date: Date;
}

function backupDate(d: string, t: string): Date | null {
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  const hour = Number(t.slice(0, 2));
  const minute = Number(t.slice(2, 4));
  const second = Number(t.slice(4, 6));
  const date = new Date(year, month - 1, day, hour, minute, second);
  // The Date constructor normalizes impossible values (20260231 -> March 3).
  // A cleanup parser must reject those names, never reinterpret them as a real
  // backup age.
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
    || date.getSeconds() !== second
  ) return null;
  return date;
}

export function parseBackupFile(hostname: string, file: string): ParsedBackup | null {
  const prefix = `nodus-backup-${sanitizeHostname(hostname)}-`;
  if (!file.startsWith(prefix)) return null;
  const match = BACKUP_DATE_RE.exec(file.slice(prefix.length));
  if (!match) return null;
  const [, d, t] = match;
  const date = backupDate(d, t);
  return date ? { file, date } : null;
}

const RETENTION_LIMITS: Record<BackupRetentionUnit, number> = {
  days: 3650,
  weeks: 520,
  months: 120,
  years: 10,
};

export function retentionCutoff(
  value: number,
  unit: BackupRetentionUnit,
  now = new Date(),
): Date | null {
  const limit = RETENTION_LIMITS[unit];
  if (!Number.isFinite(limit) || !Number.isInteger(value) || value < 1 || value > limit) return null;
  const cutoff = new Date(now);
  switch (unit) {
    case 'days':
      cutoff.setDate(cutoff.getDate() - value);
      break;
    case 'weeks':
      cutoff.setDate(cutoff.getDate() - value * 7);
      break;
    case 'months':
      {
        const originalDay = cutoff.getDate();
        cutoff.setDate(1);
        cutoff.setMonth(cutoff.getMonth() - value);
        const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
        cutoff.setDate(Math.min(originalDay, lastDay));
      }
      break;
    case 'years':
      {
        const originalMonth = cutoff.getMonth();
        const originalDay = cutoff.getDate();
        cutoff.setDate(1);
        cutoff.setFullYear(cutoff.getFullYear() - value);
        cutoff.setMonth(originalMonth);
        const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
        cutoff.setDate(Math.min(originalDay, lastDay));
      }
      break;
  }
  return cutoff;
}

function parsePreUpdateBackupFile(hostname: string, file: string): ParsedBackup | null {
  const prefix = `nodus-pre-update-${sanitizeHostname(hostname)}-`;
  if (!file.startsWith(prefix)) return null;
  const match = PRE_UPDATE_DATE_RE.exec(file.slice(prefix.length));
  if (!match) return null;
  const [, d, t] = match;
  const date = backupDate(d, t);
  return date ? { file, date } : null;
}

function isoWeekKey(date: Date): string {
  // Thursday of the current week decides the ISO week-year.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Grandfather-father-son selection: newest per day for the last KEEP_DAILY
 * days, newest per ISO week for KEEP_WEEKLY weeks, newest per month for
 * KEEP_MONTHLY months. Only THIS machine's files are considered — other
 * machines writing to the same synced folder prune their own lineage.
 * Returns the files that should be deleted.
 */
export function selectBackupsToPrune(hostname: string, files: string[]): string[] {
  const parsed = files
    .map((f) => parseBackupFile(hostname, f))
    .filter((p): p is ParsedBackup => p !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  const keep = new Set<string>();
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;

  const seenDays = new Set<string>();
  const seenWeeks = new Set<string>();
  const seenMonths = new Set<string>();
  for (const p of parsed) {
    const day = dayKey(p.date);
    if (!seenDays.has(day) && seenDays.size < KEEP_DAILY) {
      seenDays.add(day);
      keep.add(p.file);
    }
    const week = isoWeekKey(p.date);
    if (!seenWeeks.has(week) && seenWeeks.size < KEEP_WEEKLY) {
      seenWeeks.add(week);
      keep.add(p.file);
    }
    const month = monthKey(p.date);
    if (!seenMonths.has(month) && seenMonths.size < KEEP_MONTHLY) {
      seenMonths.add(month);
      keep.add(p.file);
    }
  }
  return parsed.filter((p) => !keep.has(p.file)).map((p) => p.file);
}

/** Pre-update escape hatches have their own bounded lineage and are never pruned
 * by the scheduled GFS policy. */
export function selectPreUpdateBackupsToPrune(hostname: string, files: string[]): string[] {
  return files
    .map((file) => parsePreUpdateBackupFile(hostname, file))
    .filter((item): item is ParsedBackup => item !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(KEEP_PRE_UPDATE)
    .map((item) => item.file);
}

interface CleanupFile extends ParsedBackup {
  path: string;
  bytes: number;
  modifiedAt: number;
  device: number;
  inode: number;
}

interface TrashedBackup {
  path: string;
  file: string;
  originalFile: string;
  trashedAt: number;
  bytes: number;
  modifiedAt: number;
  device: number;
  inode: number;
}

interface CleanupContext {
  folder: string;
  trashPath: string;
  cutoff: Date;
  active: CleanupFile[];
  candidates: CleanupFile[];
  protectedCount: number;
  trash: TrashedBackup[];
}

function cleanupPreviewFailure(message: string): BackupCleanupPreview {
  return {
    ok: false,
    message,
    scopeToken: null,
    cutoff: null,
    candidateCount: 0,
    candidateBytes: 0,
    protectedCount: 0,
    trashCount: 0,
    purgeReadyCount: 0,
    purgeReadyBytes: 0,
  };
}

function cleanupResultFailure(message: string): BackupCleanupResult {
  return {
    ...cleanupPreviewFailure(message),
    quarantinedCount: 0,
    quarantinedBytes: 0,
    purgedCount: 0,
    purgedBytes: 0,
  };
}

async function readCleanupContext(now = new Date()): Promise<CleanupContext | { error: string }> {
  const settings = getSettings();
  const cutoff = retentionCutoff(settings.backupRetentionValue, settings.backupRetentionUnit, now);
  if (!cutoff) return { error: 'La antigüedad configurada no es válida. No se ha movido ni eliminado ninguna copia.' };
  if (!settings.autoBackupFolder) return { error: 'No hay carpeta de Recuperación configurada. No se ha movido ni eliminado ninguna copia.' };

  const folder = resolveBackupOutputDir(settings.autoBackupFolder);
  let entries: fs.Dirent[];
  try {
    const folderStat = await fs.promises.lstat(folder);
    if (!folderStat.isDirectory()) return { error: 'La carpeta de copias configurada no es un directorio. No se ha modificado nada.' };
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch (error) {
    return { error: `No se puede leer la carpeta de copias. No se ha modificado nada: ${error instanceof Error ? error.message : String(error)}` };
  }

  const hostname = os.hostname();
  const active: CleanupFile[] = [];
  for (const entry of entries) {
    // Symlinks, directories, partial .tmp files, prerelease snapshots and files from
    // another host are deliberately outside the cleanup boundary.
    if (!entry.isFile()) continue;
    const parsed = parseBackupFile(hostname, entry.name);
    if (!parsed) continue;
    const filePath = path.join(folder, entry.name);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      active.push({
        ...parsed,
        path: filePath,
        bytes: stat.size,
        modifiedAt: stat.mtimeMs,
        device: stat.dev,
        inode: stat.ino,
      });
    } catch {
      /* a cloud file that disappears during a read is ignored, never guessed */
    }
  }
  active.sort((a, b) => b.date.getTime() - a.date.getTime() || b.file.localeCompare(a.file));
  const protectedCount = Math.min(KEEP_ACTIVE_DURING_CLEANUP, active.length);
  const candidates = active.slice(protectedCount).filter((item) => item.date.getTime() < cutoff.getTime());

  const trashPath = path.join(folder, CLEANUP_TRASH_DIR);
  const trash: TrashedBackup[] = [];
  try {
    const trashStat = await fs.promises.lstat(trashPath);
    if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) {
      return { error: 'La papelera de seguridad no es un directorio válido. No se ha modificado nada.' };
    }
    for (const entry of await fs.promises.readdir(trashPath, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = TRASHED_BACKUP_RE.exec(entry.name);
      if (!match) continue;
      const [, originalFile, trashedAtRaw] = match;
      if (!parseBackupFile(hostname, originalFile)) continue;
      const trashedAt = Number(trashedAtRaw);
      if (!Number.isSafeInteger(trashedAt) || trashedAt <= 0) continue;
      const filePath = path.join(trashPath, entry.name);
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      trash.push({
        path: filePath,
        file: entry.name,
        originalFile,
        trashedAt,
        bytes: stat.size,
        modifiedAt: stat.mtimeMs,
        device: stat.dev,
        inode: stat.ino,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { error: `No se puede inspeccionar la papelera de seguridad. No se ha modificado nada: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  return { folder, trashPath, cutoff, active, candidates, protectedCount, trash };
}

/** Read-only and deliberately password-free: Settings can show the exact scope before
 * the user opts into a destructive policy. File Provider calls use asynchronous fs so
 * an iCloud/Dropbox placeholder cannot stop Electron's main event loop. */
export async function previewBackupCleanup(now = new Date()): Promise<BackupCleanupPreview> {
  const context = await readCleanupContext(now);
  if ('error' in context) return cleanupPreviewFailure(context.error);
  return cleanupPreviewFromContext(context, now);
}

function cleanupPreviewFromContext(context: CleanupContext, now: Date): BackupCleanupPreview {
  const candidateBytes = context.candidates.reduce((sum, item) => sum + item.bytes, 0);
  const purgeReady = context.trash.filter((item) => now.getTime() - item.trashedAt >= CLEANUP_TRASH_GRACE_MS);
  // Bind confirmation to the exact directory state the user reviewed. File names are
  // hashed rather than exposed through IPC; every identity-changing stat is included.
  const scopeToken = createHash('sha256').update(JSON.stringify({
    folder: context.folder,
    active: context.active.map((item) => [item.file, item.bytes, item.modifiedAt, item.device, item.inode]),
    candidates: context.candidates.map((item) => item.file),
    trash: context.trash.map((item) => [item.file, item.bytes, item.modifiedAt, item.device, item.inode]),
    purgeReady: purgeReady.map((item) => item.file),
  })).digest('hex');
  return {
    ok: true,
    message: context.candidates.length > 0
      ? `${context.candidates.length} copia(s) pasarán a la papelera de seguridad.`
      : 'No hay copias que superen la antigüedad configurada.',
    scopeToken,
    cutoff: context.cutoff.toISOString(),
    candidateCount: context.candidates.length,
    candidateBytes,
    protectedCount: context.protectedCount,
    trashCount: context.trash.length,
    purgeReadyCount: purgeReady.length,
    purgeReadyBytes: purgeReady.reduce((sum, item) => sum + item.bytes, 0),
  };
}

async function executeBackupCleanup(now: Date, expectedScopeToken?: string): Promise<BackupCleanupResult> {
  const context = await readCleanupContext(now);
  if ('error' in context) return cleanupResultFailure(context.error);
  const preview = cleanupPreviewFromContext(context, now);
  if (expectedScopeToken && preview.scopeToken !== expectedScopeToken) {
    return cleanupResultFailure('La carpeta de copias cambió desde la vista previa. No se ha modificado nada; revisa el alcance y vuelve a confirmar.');
  }

  const purgeCandidates = context.trash.filter((item) => now.getTime() - item.trashedAt >= CLEANUP_TRASH_GRACE_MS);
  if (context.candidates.length === 0 && purgeCandidates.length === 0) {
    return {
      ...preview,
      quarantinedCount: 0,
      quarantinedBytes: 0,
      purgedCount: 0,
      purgedBytes: 0,
    };
  }

  const password = getBackupPassword();
  if (!password) return cleanupResultFailure('No se puede verificar una copia superviviente porque falta la contraseña maestra. No se ha modificado nada.');
  const survivor = context.active[0];
  if (!survivor) return cleanupResultFailure('No existe ninguna copia activa que pueda verificarse antes de limpiar. No se ha modificado nada.');
  try {
    const verification = await verifyBackupFileInUtility(survivor.path, password);
    if (!verification.ok) {
      return cleanupResultFailure(`La copia más reciente no superó la verificación (${verification.message}). No se ha modificado nada.`);
    }
  } catch (error) {
    return cleanupResultFailure(`No se pudo verificar la copia más reciente. No se ha modificado nada: ${error instanceof Error ? error.message : String(error)}`);
  }

  const moved: Array<{ from: string; to: string; bytes: number }> = [];
  try {
    if (context.candidates.length > 0 && !fs.existsSync(context.trashPath)) {
      fs.mkdirSync(context.trashPath, { recursive: false, mode: 0o700 });
    }
    if (fs.existsSync(context.trashPath)) {
      const trashStat = fs.lstatSync(context.trashPath);
      if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) throw new Error('La papelera de seguridad dejó de ser un directorio válido.');
    }

    const batchStamp = now.getTime();
    for (let index = 0; index < context.candidates.length; index += 1) {
      const candidate = context.candidates[index];
      const stat = fs.lstatSync(candidate.path);
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size !== candidate.bytes
        || stat.mtimeMs !== candidate.modifiedAt
        || stat.dev !== candidate.device
        || stat.ino !== candidate.inode
        || path.dirname(candidate.path) !== context.folder
        || path.basename(candidate.path) !== candidate.file
        || !parseBackupFile(os.hostname(), candidate.file)
      ) {
        throw new Error(`La copia cambió durante la limpieza: ${candidate.file}`);
      }
      let suffix = index;
      let destination = path.join(context.trashPath, `${candidate.file}.trashed-${batchStamp}-${suffix}`);
      while (fs.existsSync(destination)) {
        suffix += 1;
        destination = path.join(context.trashPath, `${candidate.file}.trashed-${batchStamp}-${suffix}`);
      }
      fs.renameSync(candidate.path, destination);
      moved.push({ from: candidate.path, to: destination, bytes: candidate.bytes });
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const item of [...moved].reverse()) {
      try {
        fs.renameSync(item.to, item.from);
      } catch {
        rollbackFailures.push(path.basename(item.to));
      }
    }
    const recoveryNote = rollbackFailures.length > 0
      ? ` Algunas copias siguen recuperables en ${context.trashPath}: ${rollbackFailures.join(', ')}.`
      : ' Todos los movimientos parciales se revirtieron.';
    return cleanupResultFailure(`La limpieza se detuvo: ${error instanceof Error ? error.message : String(error)}.${recoveryNote}`);
  }

  let purgedCount = 0;
  let purgedBytes = 0;
  for (const item of purgeCandidates) {
    try {
      const stat = fs.lstatSync(item.path);
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size !== item.bytes
        || stat.mtimeMs !== item.modifiedAt
        || stat.dev !== item.device
        || stat.ino !== item.inode
        || path.dirname(item.path) !== context.trashPath
        || path.basename(item.path) !== item.file
        || !TRASHED_BACKUP_RE.test(item.file)
        || !parseBackupFile(os.hostname(), item.originalFile)
      ) continue;
      fs.unlinkSync(item.path);
      purgedCount += 1;
      purgedBytes += item.bytes;
    } catch {
      // A cloud lock leaves the item in quarantine for the next scheduled attempt.
    }
  }

  const quarantinedBytes = moved.reduce((sum, item) => sum + item.bytes, 0);
  return {
    ...preview,
    message: moved.length > 0
      ? `${moved.length} copia(s) se movieron a la papelera de seguridad durante 7 días.`
      : `${purgedCount} copia(s) salieron de la papelera de seguridad.`,
    trashCount: context.trash.length + moved.length - purgedCount,
    quarantinedCount: moved.length,
    quarantinedBytes,
    purgedCount,
    purgedBytes,
    trashPath: context.trashPath,
  };
}

function pruneBackups(folder: string, hostname: string): number {
  let files: string[];
  try {
    files = fs.readdirSync(folder);
  } catch {
    return 0;
  }
  const doomed = selectBackupsToPrune(hostname, files);
  let pruned = 0;
  for (const file of doomed) {
    try {
      fs.unlinkSync(path.join(folder, file));
      pruned += 1;
    } catch {
      /* a locked/cloud-evicted file just survives until next prune */
    }
  }
  return pruned;
}

function prunePreUpdateBackups(folder: string, hostname: string): number {
  let files: string[];
  try {
    files = fs.readdirSync(folder);
  } catch {
    return 0;
  }
  let pruned = 0;
  for (const file of selectPreUpdateBackupsToPrune(hostname, files)) {
    try {
      fs.unlinkSync(path.join(folder, file));
      pruned += 1;
    } catch {
      /* a locked/cloud-evicted file just survives until next prune */
    }
  }
  return pruned;
}

interface VerifiedBackupOptions {
  appVersion: string;
  fileName: (hostname: string, date: Date) => string;
  prune: (folder: string, hostname: string) => number;
}

async function writeVerifiedBackup(options: VerifiedBackupOptions): Promise<AutoBackupResult> {
  const backupStartedAt = process.hrtime.bigint();
  let phaseStartedAt = backupStartedAt;
  const settings = getSettings();
  const configuredFolder = settings.autoBackupFolder;
  if (!configuredFolder) return { ok: false, message: 'No hay carpeta de destino configurada.' };
  const password = getBackupPassword();
  if (!password) return { ok: false, message: 'No hay contraseña maestra de copias configurada.' };

  let target = '';
  let tmp = '';
  let committed = false;
  try {
    const folder = resolveBackupOutputDir(configuredFolder);
    fs.mkdirSync(folder, { recursive: true });
    let recoveryKey = getBackupRecoveryKey();
    if (!recoveryKey) {
      recoveryKey = generateBackupPassword();
      setBackupRecoveryKey(recoveryKey);
    }
    const hostname = os.hostname();
    const startedAt = new Date();
    // A manual click and an updater timer can land in the same second. Choose another
    // valid timestamp instead of overwriting a verified snapshot (rename differs across
    // platforms when the destination already exists).
    for (let offsetSeconds = 0; offsetSeconds < 120; offsetSeconds += 1) {
      const candidateDate = new Date(startedAt.getTime() + offsetSeconds * 1000);
      const candidate = path.join(folder, options.fileName(hostname, candidateDate));
      if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.tmp`)) {
        target = candidate;
        break;
      }
    }
    if (!target) throw new Error('No se pudo reservar un nombre único para la copia de seguridad.');
    // Write via temp + rename so cloud clients never sync a half-written file.
    tmp = `${target}.tmp`;
    const built = await createBackupArchiveFile({ password, appVersion: options.appVersion, recoveryKey }, tmp);
    phaseStartedAt = logBackupPerf('archive-built', phaseStartedAt, { bytes: built.bytes, reusedVaults: built.reusedVaults });
    await fs.promises.rename(tmp, target);
    committed = true;
    phaseStartedAt = logBackupPerf('archive-written', phaseStartedAt, { bytes: built.bytes });

    // Prove the committed file can be authenticated/decrypted before deleting any
    // older snapshot or letting an updater close the application. The full read,
    // decrypt and hash run in a disposable utility process.
    const verification = await verifyBackupFileInUtility(target, password);
    logBackupPerf('archive-verified', phaseStartedAt, { bytes: built.bytes });
    if (!verification.ok) {
      fs.rmSync(target, { force: true });
      committed = false;
      return {
        ok: false,
        message: `La copia se escribió pero no se pudo verificar, así que se descartó y no se ha podado ninguna anterior: ${verification.message}`,
      };
    }

    const prunedCount = options.prune(folder, hostname);
    try {
      recordVerifiedRecoverySnapshot(configuredFolder, {
        fileName: path.basename(target),
        path: target,
        date: built.manifest.date,
        appVersion: built.manifest.appVersion,
        schemaVersion: built.manifest.schemaVersion,
        vaultCount: built.manifest.vaultCount ?? 1,
        bytes: built.bytes,
        includesSecrets: built.manifest.includesSecrets === true,
      });
    } catch {
      // The archive itself is already authenticated. A cloud client refusing the tiny
      // optional index must never turn a good backup into a failed/deleted backup.
    }
    logBackupPerf('run:complete', backupStartedAt, { bytes: built.bytes, reusedVaults: built.reusedVaults });
    const locked = lockedApiKeyProviders();
    const warning = locked.length > 0
      ? ` Aviso: las claves de ${locked.join(', ')} no se pudieron leer del almacén seguro y no viajan en esta copia.`
      : '';
    return { ok: true, message: `Copia verificada y guardada en ${target}.${warning}`, path: target, prunedCount };
  } catch (error) {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (committed && target) fs.rmSync(target, { force: true });
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Run one backup now (manual "Probar ahora" or the scheduler). */
export async function runAutoBackupNow(appVersion: string): Promise<AutoBackupResult> {
  const settings = getSettings();
  const finish = (result: AutoBackupResult): AutoBackupResult => {
    updateSettings({
      lastAutoBackupAt: result.ok ? new Date().toISOString() : settings.lastAutoBackupAt,
      lastAutoBackupStatus: `${result.ok ? 'ok' : 'error'}: ${result.message}`,
    });
    return result;
  };

  const result = await withBackupOperation(
    'copia de seguridad',
    (active) => ({ ok: false, message: `Hay otra operación de copias en curso (${active}). Vuelve a intentarlo cuando termine.` }),
    () => writeVerifiedBackup({
      appVersion,
      fileName: (hostname, date) => backupFileName(hostname, date, appVersion, SCHEMA_VERSION),
      // Once the user opts into an explicit maximum age, that understandable policy
      // replaces the legacy fixed GFS pruning. Until then, existing behavior is intact.
      prune: settings.backupCleanupEnabled ? () => 0 : pruneBackups,
    }),
  );
  return finish(result);
}

/**
 * Full, verified escape hatch taken while the OLD application/schema still owns the
 * data. Its separate name and retention prevent a later scheduled backup from deleting
 * the exact snapshot needed to recover from a bad migration.
 */
export async function runPreUpdateBackupNow(currentVersion: string, targetVersion: string): Promise<AutoBackupResult> {
  const settings = getSettings();
  const result = await withBackupOperation(
    'snapshot previo a la actualización',
    (active) => ({ ok: false, message: `Hay otra operación de copias en curso (${active}). Vuelve a intentarlo cuando termine.` }),
    () => writeVerifiedBackup({
      appVersion: currentVersion,
      fileName: (hostname, date) => preUpdateBackupFileName(
        hostname,
        date,
        currentVersion,
        targetVersion,
        SCHEMA_VERSION,
      ),
      prune: prunePreUpdateBackups,
    }),
  );
  updateSettings({
    lastAutoBackupAt: result.ok ? new Date().toISOString() : settings.lastAutoBackupAt,
    lastAutoBackupStatus: `${result.ok ? 'ok' : 'error'}: ${result.message}`,
  });
  return result;
}

/**
 * Scheduler tick: run only when enabled, configured and a scheduled slot has passed
 * since the last backup. Called shortly after launch (startup catch-up for a slot
 * missed while the machine was off) and periodically; runs in the main process so it
 * never blocks the UI.
 */
export async function maybeRunAutoBackup(appVersion: string): Promise<AutoBackupResult | null> {
  // A test-harness launch (see safeStorageGate) reads no stored secrets, so the backup password
  // looks missing; it must neither back up nor record a failure in the user's settings.
  if (harnessKeysMode()) return null;
  const settings = getSettings();
  if (!settings.autoBackupEnabled) return null;
  // A configured-but-broken setup must never fail silently. Returning early without
  // recording anything leaves `lastAutoBackupStatus` frozen on the last success, so the
  // UI keeps showing "ok" for months while nothing is being backed up — the one failure
  // mode a backup system cannot afford. `getBackupPassword()` also returns null when the
  // blob exists but the OS keychain can no longer decrypt it (new login password,
  // machine migration), which is precisely when the user must be told.
  if (!settings.autoBackupFolder || !getBackupPassword()) {
    const reason = !settings.autoBackupFolder
      ? 'No hay carpeta de destino configurada.'
      : 'No se pudo leer la contraseña maestra del almacén seguro del sistema. Vuelve a introducirla en Ajustes para reanudar las copias.';
    updateSettings({ lastAutoBackupStatus: `error: ${reason}` });
    return { ok: false, message: reason };
  }
  const days = Array.isArray(settings.autoBackupDays) ? settings.autoBackupDays : [];
  const hour = Number.isFinite(settings.autoBackupHour) ? settings.autoBackupHour : 3;
  const minute = Number.isFinite(settings.autoBackupMinute) ? settings.autoBackupMinute : 0;
  if (!isScheduledBackupDue(settings.lastAutoBackupAt, days, hour, minute)) return null;
  return runAutoBackupNow(appVersion);
}

export async function runBackupCleanupNow(now = new Date(), expectedScopeToken?: string): Promise<BackupCleanupResult> {
  const settings = getSettings();
  const result = await withBackupOperation(
    'limpieza de copias',
    (active) => cleanupResultFailure(`Hay otra operación de copias en curso (${active}). No se ha modificado nada.`),
    () => executeBackupCleanup(now, expectedScopeToken),
  );
  updateSettings({
    lastBackupCleanupAt: result.ok ? now.toISOString() : settings.lastBackupCleanupAt,
    lastBackupCleanupStatus: `${result.ok ? 'ok' : 'error'}: ${result.message}`,
  });
  return result;
}

/** Uses the backup weekday/time policy, including startup catch-up after a missed slot. */
export async function maybeRunBackupCleanup(now = new Date()): Promise<BackupCleanupResult | null> {
  if (harnessKeysMode()) return null;
  const settings = getSettings();
  if (!settings.backupCleanupEnabled) return null;
  const days = Array.isArray(settings.autoBackupDays) ? settings.autoBackupDays : [];
  const hour = Number.isFinite(settings.autoBackupHour) ? settings.autoBackupHour : 3;
  const minute = Number.isFinite(settings.autoBackupMinute) ? settings.autoBackupMinute : 0;
  if (!isScheduledBackupDue(settings.lastBackupCleanupAt, days, hour, minute, now)) return null;
  return runBackupCleanupNow(now);
}
