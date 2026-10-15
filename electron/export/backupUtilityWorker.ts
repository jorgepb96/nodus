import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBackupFile } from './backupVerificationCore';
import { backupVaultRevision } from './backupVaultRevision';
import type { BackupUtilityRequest, BackupUtilityResponse } from './backupUtilityTypes';

interface CacheManifest {
  sourceFingerprint: string;
  snapshotSha256: string;
}

async function hashFiles(files: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files) {
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(file); } catch { continue; }
    if (!stat.isFile()) continue;
    hash.update(path.basename(file));
    hash.update(String(stat.size));
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', resolve);
    });
  }
  return hash.digest('hex');
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function sourceFingerprint(file: string): Promise<string> {
  // The revision counter orders writes to ONE database file. A restore renames another file over
  // the vault and a reset recreates it, each with a counter of its own that can reach the cached
  // value again; the file's identity is what tells the two apart.
  const { dev, ino } = await fs.promises.stat(file);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tracked = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backup_revision'").get();
    if (tracked) return `revision:${dev}:${ino}:${backupVaultRevision(db)}`;
  } finally {
    db.close();
  }
  // Compatibility for a vault that has not yet opened under schema 134. This is a
  // cryptographic DB+WAL identity, never mtime; after migration the O(1) trigger token wins.
  return `sha256:${await hashFiles([file, `${file}-wal`])}`;
}

async function snapshot(request: Extract<BackupUtilityRequest, { kind: 'snapshot' }>): Promise<BackupUtilityResponse> {
  const fingerprint = await sourceFingerprint(request.sourcePath);
  const cacheBase = path.join(request.cacheDir, request.vaultId.replace(/[^a-zA-Z0-9._-]/g, '_'));
  const cachedSnapshot = `${cacheBase}.sqlite`;
  const cachedManifest = `${cacheBase}.json`;
  try {
    const manifest = JSON.parse(await fs.promises.readFile(cachedManifest, 'utf8')) as CacheManifest;
    if (manifest.sourceFingerprint === fingerprint
      && await hashFile(cachedSnapshot) === manifest.snapshotSha256) {
      await fs.promises.copyFile(cachedSnapshot, request.targetPath);
      return { kind: 'snapshot-done', id: request.id, reused: true, sourceFingerprint: fingerprint };
    }
  } catch {
    // Missing, stale or corrupt cache: create a fresh consistent snapshot.
  }

  await fs.promises.mkdir(path.dirname(request.targetPath), { recursive: true });
  await fs.promises.rm(request.targetPath, { force: true });
  const source = new Database(request.sourcePath, { fileMustExist: true });
  try {
    source.pragma('busy_timeout = 30000');
    source.prepare('VACUUM INTO ?').run(request.targetPath);
  } finally {
    source.close();
  }
  const check = new Database(request.targetPath, { fileMustExist: true });
  try {
    const row = check.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (row) {
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(row.value) as Record<string, unknown>; } catch { /* replace malformed settings below */ }
      delete settings.mcpToken;
      delete settings.providerKeys;
      settings.mcpEnabled = false;
      settings.nodusServerEnabled = false;
      settings.nodusServerKind = 'classic';
      settings.nodusServerUrl = '';
      settings.nodusServerSpaceId = '';
      settings.nodusServerSpaceName = '';
      check.prepare("UPDATE settings SET value = ? WHERE key = 'app'").run(JSON.stringify(settings));
    }
    const result = check.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`SQLite quick_check: ${String(result)}`);
  } finally {
    check.close();
  }

  // A write during VACUUM yields a valid point-in-time snapshot, but it must not be
  // reused for the newer source state. Only promote when both fingerprints agree.
  const afterFingerprint = await sourceFingerprint(request.sourcePath);
  if (afterFingerprint === fingerprint) {
    await fs.promises.mkdir(request.cacheDir, { recursive: true });
    const staged = `${cachedSnapshot}.tmp-${process.pid}`;
    await fs.promises.copyFile(request.targetPath, staged);
    const snapshotSha256 = await hashFile(staged);
    await fs.promises.rename(staged, cachedSnapshot);
    await fs.promises.writeFile(cachedManifest, JSON.stringify({ sourceFingerprint: fingerprint, snapshotSha256 } satisfies CacheManifest));
  }
  return { kind: 'snapshot-done', id: request.id, reused: false, sourceFingerprint: fingerprint };
}

export async function runBackupUtilityRequest(request: BackupUtilityRequest): Promise<BackupUtilityResponse> {
  if (request.kind === 'snapshot') return snapshot(request);
  return {
    kind: 'verify-done',
    id: request.id,
    result: await verifyBackupFile(request.archivePath, request.password, request.schemaVersion),
  };
}

process.parentPort?.on('message', (event) => {
  const request = event.data as BackupUtilityRequest;
  void runBackupUtilityRequest(request).then(
    (response) => process.parentPort?.postMessage(response),
    (error) => process.parentPort?.postMessage({
      kind: 'error', id: request.id, error: error instanceof Error ? error.message : String(error),
    } satisfies BackupUtilityResponse),
  );
});
