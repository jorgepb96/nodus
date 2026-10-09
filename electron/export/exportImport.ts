import AdmZip from 'adm-zip';
import { dialogTitle } from '../dialogTitles';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, app } from 'electron';
import { showImportOpenDialog } from '../privacy';
import type { AiProvider, AppSettings, BackupSelection, RecoveryRestoreProgress, RecoveryRestoreProgressPhase } from '@shared/types';
import { SECRET_PROVIDERS } from '@shared/providers';
import { isVaultType } from '@shared/vaultTypes';
import { closeDb, getDb, replaceDbFile, SCHEMA_VERSION } from '../db/database';
import { stopVectorScanWorker } from '../db/vectorScanHost';
import { testimonyBackupInventory } from './testimonyExport';
import { getSettings } from '../db/settingsRepo';
import { listVaults, getActiveVault, restoreVaultDatabase, setActiveVault } from '../vaults/vaultRegistry';
import { closeGlobalLibraryRuntime } from '../library/libraryRuntime';
import { globalFocusFile, restoreGlobalFocusBackupFile, snapshotGlobalFocusForBackup } from '../study/focusRuntime';
import { configuredLibraryRoot } from '../library/libraryPaths';
import { pathStaysInside } from '../library/libraryFileUtils';
import type { VaultType } from '@shared/types';
import { getBackupPassword, setApiKey, setAudioKey } from '../secrets/secretStore';
import {
  decryptBackupPayload,
  encryptBackupPayloadFile,
  encryptBackupPayloadAsync,
  generateBackupPassword,
  sha256Hex,
  type BackupCipherMetadata,
} from './backupCrypto';
import { snapshotVaultInUtility } from './backupUtilityHost';
import {
  openVerifiedBackupFile,
  type StreamedInnerManifest,
} from './backupVerificationCore';
import type { ZipFileEntry, ZipFileReader } from './zipFile';
import { StreamingZipWriter } from './streamingZip';
import { browserBookmarksRepository } from '../browser/bookmarks';
import {
  pauseAllDocumentIndexingAndDrain,
  resumeAllDocumentIndexingAfterMaintenance,
} from '../pipeline/documentIndexMaintenance';

interface ExportManifestBase {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
}

/** One vault inside a v4 (multi-vault) backup. */
export interface BackupVaultEntry {
  id: string;
  name: string;
  type: VaultType;
  legacy: boolean;
  /** Path of the vault's DB inside the payload zip, e.g. 'vaults/<id>/database.sqlite'. */
  dbFile: string;
  /** Path of the vault's inventory inside the payload zip. */
  inventoryFile: string;
}

interface BackupManifest {
  format: 'nodus.encrypted-backup';
  // v3 = secret-free single-vault backup. v4 = multi-vault (every vault of every
  // type). v5 adds granular auxiliary state. v6 encrypts the payload with an
  // independent recovery key and wraps that key with the master password.
  // `includesSecrets` remains only to read legacy archives that carried keys. New
  // archives always set it to false. Older app versions reject newer formats cleanly.
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6;
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  cipher: BackupCipherMetadata;
  includesSecrets?: boolean;
  /** v4 only: number of vaults in the archive (for a quick UI summary). */
  vaultCount?: number;
  /** v6: the stable recovery key is wrapped by the user's password. */
  recovery?: { wrappedKeyCipher: BackupCipherMetadata };
}

interface PayloadManifest {
  schemaVersion: number;
  appVersion: string;
  date: string;
  zoteroUserId: string;
  files: Record<string, { sha256: string; bytes: number }>;
  /** v4 only: the vaults included and which one was active. */
  activeVaultId?: string;
  vaults?: BackupVaultEntry[];
  /** v5 only: user-selected scope. Omitted means the historical all-data scope. */
  selection?: BackupSelection;
  /** v4.0 desktop: canonical cross-vault Library files under `global-library/`. */
  globalLibrary?: { prefix: 'global-library'; fileCount: number };
}

interface EmbeddingInventory {
  records: number;
  bytes: number;
}

/** A human-auditable record of the data that must survive without reindexing. */
export interface BackupInventory {
  tableRows: Record<string, number>;
  /**
   * Testimonios, aparte de los recuentos de filas. HORAS y BYTES son las dos cifras que
   * un recuento de filas no puede dar y que convierten «restauró» en «restauró completo»:
   * mil filas de `testimony_media` con los blobs vacíos son mil filas igualmente.
   * `null` en cualquier bóveda que no sea de testimonios.
   */
  testimony: ReturnType<typeof testimonyBackupInventory>;
  embeddings: {
    ideas: EmbeddingInventory;
    workSummaries: EmbeddingInventory;
    passages: EmbeddingInventory;
    /** Added in backup v5; absent in older archives. */
    documents?: EmbeddingInventory;
  };
  modelSettings: Pick<
    AppSettings,
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'codexReasoningEfforts' | 'defaultModel' | 'modelSettingsMode' | 'modelSettingsVersion'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel' | 'documentProfileModel' | 'documentAuditModel'
    | 'chatModel' | 'nodiModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel' | 'transcriptionModel' | 'sttProvider'
    | 'sttTransformersModel' | 'sttWhisperCppModel' | 'sttWhisperCppExecutable'
    | 'imageProvider' | 'imageModel' | 'imageQuality' | 'imageStyle' | 'audioProvider' | 'audioVoice' | 'audioSpeed'
    | 'documentIndexingEnabled' | 'documentIndexIncludeArchived' | 'documentIndexConcurrency'
  >;
  apiKeyProviders: AiProvider[];
}

const GLOBAL_AUXILIARY_FILES = ['app-prefs.json', 'chat-skills.json', 'skill-marketplace.json', 'browser-bookmarks.json', 'radar-store.json', 'nodi-chat-history.json', 'nodi-notes.json', 'nodi-notifications.json', 'nodi-welcome.seed'] as const;
const VAULT_HISTORY_FILES = ['study-chat-history.json', 'study-search-index.json'] as const;
const VAULT_MEDIA_FILES = ['study-audio-meta.json'] as const;
/** Cloud TTS keys live outside the AI-provider store. This list is retained only to
 * restore legacy encrypted backups; new archives never serialize the plaintext keys. */
const AUDIO_KEY_NAMES = ['hume'] as const;
/**
 * Settings that describe THIS computer, not the library. They live in the vault's
 * settings row, so a restore would otherwise import another machine's absolute paths
 * and silently break every local file lookup (a stale Zotero root is worse than an
 * empty one, which at least falls back to probing the default locations).
 */
const MACHINE_LOCAL_SETTING_KEYS = ['zoteroStoragePath', 'toolkitOutputDir'] as const;
const RECOVERY_PREF_KEYS = [
  'recoverySetupVersion',
  'backupVaultIds',
  'backupIncludePreferences',
  'backupIncludeHistories',
  'backupIncludeGeneratedMedia',
  'backupIncludeApiKeys',
  'autoBackupEnabled',
  'autoBackupFolder',
  'autoBackupIntervalHours',
  'autoBackupDays',
  'autoBackupHour',
  'autoBackupMinute',
  'lastAutoBackupAt',
  'lastAutoBackupStatus',
] as const;

type PerfMetadata = Record<string, string | number | boolean>;

function logBackupPerf(phase: string, startedAt: bigint, metadata: PerfMetadata = {}): bigint {
  const endedAt = process.hrtime.bigint();
  const elapsedMs = Number(endedAt - startedAt) / 1_000_000;
  const rssMiB = process.memoryUsage().rss / (1024 * 1024);
  const details = Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`[perf][backup] phase=${phase} elapsedMs=${elapsedMs.toFixed(1)} rssMiB=${rssMiB.toFixed(1)}${details ? ` ${details}` : ''}`);
  return endedAt;
}

/** Local MCP access credentials must never leave the machine in a backup. */
export type BackupSettings = Omit<AppSettings, 'providerKeys' | 'mcpToken'>;

function fullBackupSelection(): BackupSelection {
  return {
    vaultIds: [],
    includePreferences: true,
    includeHistories: true,
    includeGeneratedMedia: true,
    includeApiKeys: false,
  };
}

function normalizeBackupSelection(input: Partial<BackupSelection> | undefined, includeSecrets: boolean): BackupSelection {
  return {
    vaultIds: Array.isArray(input?.vaultIds) ? [...new Set(input.vaultIds.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [],
    includePreferences: input?.includePreferences !== false,
    includeHistories: input?.includeHistories !== false,
    includeGeneratedMedia: input?.includeGeneratedMedia !== false,
    includeApiKeys: includeSecrets && input?.includeApiKeys !== false,
  };
}

// Auxiliary state is read with the promise API rather than *Sync: a library with
// a generated-audio folder is thousands of files, and reading them synchronously
// held the single main-process event loop for the whole sweep.
async function addFileIfPresent(files: Record<string, Buffer>, archiveName: string, sourcePath: string): Promise<void> {
  try {
    if ((await fs.promises.stat(sourcePath)).isFile()) files[archiveName] = await fs.promises.readFile(sourcePath);
  } catch {
    /* Optional auxiliary state may not have been created yet. */
  }
}

async function addDirectoryIfPresent(files: Record<string, Buffer>, archivePrefix: string, sourceDir: string, excludedNames = new Set<string>()): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || excludedNames.has(entry.name)) continue;
    const source = path.join(sourceDir, entry.name);
    const target = `${archivePrefix}/${entry.name}`;
    if (entry.isDirectory()) await addDirectoryIfPresent(files, target, source, excludedNames);
    else if (entry.isFile()) await addFileIfPresent(files, target, source);
  }
}

async function addGlobalLibraryFiles(files: Record<string, Buffer>): Promise<number> {
  const root = configuredLibraryRoot();
  if (!root) return 0;
  const before = Object.keys(files).length;
  const visit = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const source = path.join(directory, entry.name);
      const relative = path.relative(root, source);
      // A pre-v4 snapshot is already a complete copy of this Library. Including it
      // inside every scheduled backup would recursively multiply the same originals.
      if (relative === path.join('.nodus', 'recovery', 'pre-v4')
        || relative.startsWith(`${path.join('.nodus', 'recovery', 'pre-v4')}${path.sep}`)
        || relative === path.join('.nodus', 'recovery', 'restores')
        || relative.startsWith(`${path.join('.nodus', 'recovery', 'restores')}${path.sep}`)) continue;
      if (entry.isDirectory()) {
        await visit(source);
      } else if (entry.isFile() && !entry.name.includes('.tmp-') && !entry.name.includes('.restore-')) {
        await addFileIfPresent(files, `global-library/${relative.split(path.sep).join('/')}`, source);
      }
    }
  };
  await visit(root);
  return Object.keys(files).length - before;
}

async function addAuxiliaryFiles(
  files: Record<string, Buffer>,
  vaults: ReturnType<typeof listVaults>,
  selection: BackupSelection
): Promise<void> {
  if (selection.includeHistories) {
    const focus = await snapshotGlobalFocusForBackup();
    if (focus) files['aux/global/focus.sqlite'] = focus;
  }
  if (selection.includePreferences) {
    for (const name of GLOBAL_AUXILIARY_FILES) {
      await addFileIfPresent(files, `aux/global/${name}`, path.join(app.getPath('userData'), name));
    }
    await addDirectoryIfPresent(files, 'aux/global/plugins/installed', path.join(app.getPath('userData'), 'plugins', 'installed'), new Set(['secrets.bin']));
  }
  for (const vault of vaults) {
    const dir = path.dirname(vault.path);
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) await addFileIfPresent(files, `aux/vaults/${vault.id}/${name}`, path.join(dir, name));
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) await addFileIfPresent(files, `aux/vaults/${vault.id}/${name}`, path.join(dir, name));
      await addDirectoryIfPresent(files, `aux/vaults/${vault.id}/audio`, path.join(dir, 'audio'));
    }
  }
}

/**
 * Export a self-contained encrypted `*.nodus` archive. The SQLite snapshot is
 * the source of truth and includes every Nodus table, including Float32 BLOB
 * embeddings, full-text passages, extraction cache and chat history.
 */
/**
 * Hash a file without materializing it as a Buffer. The automatic path stays
 * file-backed from each SQLite snapshot through the encrypted outer archive.
 */
async function sha256File(file: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hash.update(data); bytes += data.length;
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return { sha256: hash.digest('hex'), bytes };
}

export async function createBackupArchiveFile(options: {
  password: string;
  appVersion: string;
  /** Independent credential used by automatic recovery snapshots (v6). */
  recoveryKey?: string;
}, targetPath: string): Promise<{
  bytes: number;
  reusedVaults: number;
  manifest: Pick<BackupManifest, 'date' | 'appVersion' | 'schemaVersion' | 'vaultCount' | 'includesSecrets'>;
}> {
  const backupStartedAt = process.hrtime.bigint();
  let phaseStartedAt = backupStartedAt;
  logBackupPerf('create:start', backupStartedAt);
  const settings = getSettings();
  // Full-state backup is a safety invariant, not a renderer preference. Legacy
  // granular settings and unexpected extra options can never reduce this scope.
  const selection = fullBackupSelection();
  const manifest: ExportManifestBase = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: options.appVersion,
    date: new Date().toISOString(),
    zoteroUserId: settings.zoteroUserId,
  };
  // New backups never serialize API/audio credentials. They remain in the OS keychain;
  // legacy archives can still be restored, but no new inner ZIP contains plaintext keys.
  const includesSecrets = false;
  const apiKeys: Partial<Record<AiProvider, string>> = {};

  // Snapshot EVERY vault (all types), not just the active one, so the archive is an
  // integral copy of the whole app. Each vault's DB carries its own settings row,
  // which is scrubbed of the MCP token/listener in the snapshot.
  const vaults = listVaults();
  if (vaults.length === 0) throw new Error('Nodus no contiene ninguna bóveda válida para proteger.');
  const activeVaultId = getActiveVault().id;
  const files: Record<string, Buffer> = {};
  const vaultEntries: BackupVaultEntry[] = [];
  const fileDigests: Record<string, { sha256: string; bytes: number }> = {};
  const tempRoot = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'nodus-backup-stream-'));
  const payloadPath = path.join(tempRoot, 'payload.zip');
  const ciphertextPath = path.join(tempRoot, 'backup.bin');
  try {
    const cacheDir = path.join(app.getPath('userData'), '.backup-snapshot-cache');
    const payloadZip = new StreamingZipWriter(payloadPath, 6);
    let reusedVaults = 0;
    let processedVaultBytes = 0;
    for (const vault of vaults) {
      const vaultStartedAt = process.hrtime.bigint();
      const dbFile = `vaults/${vault.id}/database.sqlite`;
      const inventoryFile = `vaults/${vault.id}/inventory.json`;
      const snapshotPath = path.join(tempRoot, `${vault.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.sqlite`);
      const snapshot = await snapshotVaultInUtility({
        sourcePath: vault.path, targetPath: snapshotPath, cacheDir, vaultId: vault.id,
      });
      if (snapshot.reused) reusedVaults += 1;
      const inventory = prepareSnapshotDatabase(snapshotPath, apiKeys);
      const digest = await sha256File(snapshotPath);
      fileDigests[dbFile] = digest;
      processedVaultBytes += digest.bytes;
      await payloadZip.addFile(dbFile, snapshotPath);
      await fs.promises.rm(snapshotPath, { force: true });
      files[inventoryFile] = Buffer.from(JSON.stringify(inventory, null, 2));
      vaultEntries.push({ id: vault.id, name: vault.name, type: vault.type, legacy: vault.legacy, dbFile, inventoryFile });
      logBackupPerf('snapshot-vault:complete', vaultStartedAt, {
        vaultId: vault.id,
        bytes: digest.bytes,
        reused: snapshot.reused,
        processedVaultBytes,
      });
    }
    phaseStartedAt = logBackupPerf('snapshot-all-vaults:complete', phaseStartedAt, { vaults: vaults.length, processedVaultBytes, reusedVaults });
    files['registry.json'] = Buffer.from(JSON.stringify({ activeVaultId, vaults: vaultEntries }, null, 2));
    await addAuxiliaryFiles(files, vaults, selection);
    const globalLibraryFileCount = await addGlobalLibraryFiles(files);
    phaseStartedAt = logBackupPerf('collect-auxiliary:complete', phaseStartedAt, { files: Object.keys(files).length });

    // Hashing and CRC-ing every entry are both full passes over the whole library.
    // Yield between entries so a backup — which runs unattended every 30 minutes —
    // never holds the main-process event loop for the length of a full pass.
    for (const [name, data] of Object.entries(files)) {
      fileDigests[name] = { sha256: sha256Hex(data), bytes: data.byteLength };
      await payloadZip.addBuffer(name, data);
    }
    phaseStartedAt = logBackupPerf('hash-files:complete', phaseStartedAt, { files: Object.keys(fileDigests).length });
    const payloadManifest: PayloadManifest = {
      ...manifest,
      activeVaultId,
      vaults: vaultEntries,
      selection,
      globalLibrary: globalLibraryFileCount > 0
        ? { prefix: 'global-library', fileCount: globalLibraryFileCount }
        : undefined,
      files: fileDigests,
    };
    await payloadZip.addBuffer('payload-manifest.json', Buffer.from(JSON.stringify(payloadManifest, null, 2)));
    await payloadZip.finalize();
    phaseStartedAt = logBackupPerf('payload-zip-deflate:complete', phaseStartedAt, { bytes: (await fs.promises.stat(payloadPath)).size });

    const recoveryKey = options.recoveryKey?.trim() || '';
    const payloadCredential = recoveryKey || options.password;
    // Encryption is a file stream. The payload ZIP uses createDeflateRaw, so both
    // full passes run outside the Electron main event loop and without a giant Buffer.
    const metadata = await encryptBackupPayloadFile(payloadPath, ciphertextPath, payloadCredential);
    phaseStartedAt = logBackupPerf('payload-encrypt:complete', phaseStartedAt, { bytes: (await fs.promises.stat(ciphertextPath)).size });
    const wrappedRecovery = recoveryKey
      ? await encryptBackupPayloadAsync(Buffer.from(recoveryKey, 'utf8'), options.password)
      : null;
    phaseStartedAt = logBackupPerf('recovery-key-wrap:complete', phaseStartedAt, { enabled: Boolean(wrappedRecovery) });
    const outerManifest: BackupManifest = {
      format: 'nodus.encrypted-backup',
      formatVersion: recoveryKey ? 6 : 5,
      ...manifest,
      cipher: metadata,
      includesSecrets,
      vaultCount: vaultEntries.length,
      recovery: wrappedRecovery ? { wrappedKeyCipher: wrappedRecovery.metadata } : undefined,
    };

    await fs.promises.rm(targetPath, { force: true });
    const zip = new StreamingZipWriter(targetPath, 0);
    await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify(outerManifest, null, 2)), true);
    await zip.addFile('backup.bin', ciphertextPath, true);
    if (wrappedRecovery) await zip.addBuffer('recovery-key.bin', wrappedRecovery.ciphertext, true);
    await zip.finalize();
    const bytes = (await fs.promises.stat(targetPath)).size;
    logBackupPerf('outer-zip-store:complete', phaseStartedAt, { bytes });
    logBackupPerf('create:complete', backupStartedAt, { bytes });
    return {
      bytes,
      reusedVaults,
      manifest: {
        date: outerManifest.date,
        appVersion: outerManifest.appVersion,
        schemaVersion: outerManifest.schemaVersion,
        vaultCount: outerManifest.vaultCount,
        includesSecrets: outerManifest.includesSecrets,
      },
    };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function createBackupArchive(options: {
  password: string;
  appVersion: string;
  recoveryKey?: string;
}): Promise<Buffer> {
  const temporary = path.join(app.getPath('temp'), `nodus-archive-${process.pid}-${Date.now()}.nodus`);
  try {
    await createBackupArchiveFile(options, temporary);
    return await fs.promises.readFile(temporary);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

export async function exportData(): Promise<{ path: string; password: string; recoveryKey: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: dialogTitle('exportNodusLibrary', getSettings().uiLanguage),
    defaultPath: path.join(app.getPath('documents'), `nodus-export-${Date.now()}.nodus`),
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || !filePath) return null;

  const password = generateBackupPassword();
  const recoveryKey = generateBackupPassword();
  await createBackupArchiveFile({ password, appVersion: app.getVersion(), recoveryKey }, filePath);
  return { path: filePath, password, recoveryKey };
}

/** Import a password-protected `*.nodus` archive, validating schema compatibility and hashes. */
export async function importData(password: string): Promise<{ ok: boolean; message: string }> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const { canceled, filePaths } = await showImportOpenDialog({
    title: dialogTitle('importNodusLibrary', getSettings().uiLanguage),
    properties: ['openFile'],
    filters: [{ name: 'Nodus', extensions: ['nodus'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false, message: 'Cancelado' };
  return restoreBackupArchiveFileSafely(filePaths[0], password, app.getVersion());
}

/** File-backed counterpart of {@link restoreBackupArchiveSafely}. Large recovery
 * snapshots never pass through `readFileSync`, and the pre-restore escape hatch
 * is also created directly on disk. */
export async function restoreBackupArchiveFileSafely(
  archivePath: string,
  password: string,
  appVersion: string,
  onProgress?: (progress: RecoveryRestoreProgress) => void,
): Promise<BackupRestoreResult> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const safetyPassword = getBackupPassword() || password;
  const safetyDir = path.join(app.getPath('userData'), 'restore-safety');
  const safetyPath = path.join(safetyDir, `pre-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.nodus`);
  const stagedSafety = `${safetyPath}.tmp`;
  let pausedVaultIds: string[] | null = null;
  try {
    emitRestoreProgress(onProgress, 'preparing', 0, 0);
    await fs.promises.mkdir(safetyDir, { recursive: true });
    await createBackupArchiveFile({ password: safetyPassword, appVersion }, stagedSafety);
    await fs.promises.rename(stagedSafety, safetyPath);
    emitRestoreProgress(onProgress, 'preparing', 1, 1);
    pausedVaultIds = await pauseAllDocumentIndexingAndDrain();
    const result = await restoreBackupArchiveFile(archivePath, password, onProgress);
    if (!result.ok) {
      await fs.promises.rm(safetyPath, { force: true });
      return result;
    }
    emitRestoreProgress(onProgress, 'finalizing', 0, 0);
    emitRestoreProgress(onProgress, 'complete', 1, 1);
    return {
      ...result,
      message: `${result.message} Se ha conservado una copia de seguridad previa en ${safetyPath}.`,
      safetyBackupPath: safetyPath,
    };
  } catch (error) {
    await fs.promises.rm(stagedSafety, { force: true });
    const failure = error instanceof Error ? error.message : String(error);
    if (!fs.existsSync(safetyPath)) {
      return { ok: false, message: `La restauración se canceló antes de modificar los datos: ${failure}` };
    }
    try {
      const rollback = await restoreBackupArchiveFile(safetyPath, safetyPassword);
      if (!rollback.ok) throw new Error(rollback.message);
      return {
        ok: false,
        message: `La restauración falló (${failure}), pero Nodus recuperó automáticamente el estado anterior. Copia de seguridad: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    } catch (rollbackError) {
      return {
        ok: false,
        message: `La restauración falló (${failure}) y no se pudo completar la reversión automática (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}). No borres la copia de emergencia: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    }
  } finally {
    if (pausedVaultIds) await resumeAllDocumentIndexingAfterMaintenance(pausedVaultIds);
  }
}

const RESTORE_PHASE_RANGES: Record<RecoveryRestoreProgressPhase, readonly [number, number]> = {
  preparing: [0, 0.08],
  decrypting: [0.08, 0.33],
  verifying: [0.33, 0.70],
  restoring: [0.70, 0.97],
  finalizing: [0.97, 0.99],
  complete: [1, 1],
};

function emitRestoreProgress(
  reporter: ((progress: RecoveryRestoreProgress) => void) | undefined,
  phase: RecoveryRestoreProgressPhase,
  completedBytes: number,
  totalBytes: number,
): void {
  if (!reporter) return;
  const [start, end] = RESTORE_PHASE_RANGES[phase];
  const fraction = totalBytes > 0 ? Math.min(1, Math.max(0, completedBytes / totalBytes)) : 0;
  const byteBacked = phase === 'decrypting' || phase === 'verifying' || phase === 'restoring';
  reporter({
    phase,
    progress: phase === 'complete' ? 1 : start + (end - start) * fraction,
    completedBytes: byteBacked ? Math.max(0, completedBytes) : 0,
    totalBytes: byteBacked ? Math.max(0, totalBytes) : 0,
  });
}

/**
 * Restore with a complete local safety snapshot taken first. If an I/O failure
 * happens after validation but during the multi-file swap, Nodus immediately
 * rolls the original state back. The safety archive is deliberately retained
 * after success as an additional escape hatch and is encrypted with the existing
 * backup master password (or the import password on a fresh device).
 */
export async function restoreBackupArchiveSafely(
  archive: Buffer,
  password: string,
  appVersion: string
): Promise<BackupRestoreResult> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const safetyPassword = getBackupPassword() || password;
  let safetyPath = '';
  let pausedVaultIds: string[] | null = null;
  try {
    const safetyArchive = await createBackupArchive({
      password: safetyPassword,
      appVersion,
    });
    const safetyDir = path.join(app.getPath('userData'), 'restore-safety');
    safetyPath = path.join(safetyDir, `pre-restore-${Date.now()}.nodus`);
    writeAtomicFile(safetyPath, safetyArchive);

    pausedVaultIds = await pauseAllDocumentIndexingAndDrain();
    // Its open connections would keep the replaced vault's write-ahead log alive (vectorScanHost.ts).
    await stopVectorScanWorker();
    const result = restoreBackupArchive(archive, password);
    if (!result.ok) {
      fs.rmSync(safetyPath, { force: true });
      return result;
    }
    return {
      ...result,
      message: `${result.message} Se ha conservado una copia de seguridad previa en ${safetyPath}.`,
      safetyBackupPath: safetyPath,
    };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (!safetyPath || !fs.existsSync(safetyPath)) {
      return { ok: false, message: `La restauración se canceló antes de modificar los datos: ${failure}` };
    }
    try {
      await stopVectorScanWorker();
      const rollback = restoreBackupArchive(fs.readFileSync(safetyPath), safetyPassword);
      if (!rollback.ok) throw new Error(rollback.message);
      return {
        ok: false,
        message: `La restauración falló (${failure}), pero Nodus recuperó automáticamente el estado anterior. Copia de seguridad: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    } catch (rollbackError) {
      return {
        ok: false,
        message: `La restauración falló (${failure}) y no se pudo completar la reversión automática (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}). No borres la copia de emergencia: ${safetyPath}`,
        safetyBackupPath: safetyPath,
      };
    }
  } finally {
    if (pausedVaultIds) await resumeAllDocumentIndexingAfterMaintenance(pausedVaultIds);
  }
}

/** Restore a `.nodus` archive buffer (dialog-free, so it is unit-testable). */
export interface BackupRestoreResult {
  ok: boolean;
  message: string;
  safetyBackupPath?: string;
  /** Internal hand-off used to persist the independent key on a restored device. */
  recoveryKey?: string;
  usedRecoveryKey?: boolean;
}

interface OpenedBackup {
  manifest: BackupManifest;
  payload: AdmZip;
  payloadManifest: PayloadManifest;
  includesSecrets: boolean;
  recoveredKey?: string;
  usedRecoveryKey: boolean;
}

/**
 * Decrypt and fully authenticate an archive without touching any live data: format,
 * schema compatibility, GCM tag, payload hashes and the internal manifest. Restore and
 * post-write verification share this so a "verified" snapshot means exactly what a
 * restore would accept — no second, weaker implementation that could drift.
 */
function openBackupArchive(archive: Buffer, password: string): OpenedBackup | { ok: false; message: string } {
  const verifyStartedAt = process.hrtime.bigint();
  let phaseStartedAt = verifyStartedAt;
  // A truncated or non-zip file makes AdmZip throw, and a damaged manifest makes
  // JSON.parse throw. Both are ordinary states for a half-synced cloud file, so they
  // must come back as a refusal the caller can report — never as an exception that
  // unwinds into the restore's rollback path.
  let zip: AdmZip;
  let manifest: BackupManifest;
  let encryptedEntry: AdmZip.IZipEntry;
  try {
    zip = new AdmZip(archive);
    const manifestEntry = zip.getEntry('manifest.json');
    const encrypted = zip.getEntry('backup.bin');
    if (!manifestEntry || !encrypted) {
      return { ok: false, message: 'Archivo .nodus inválido: faltan manifest o datos cifrados.' };
    }
    encryptedEntry = encrypted;
    manifest = JSON.parse(zip.readAsText(manifestEntry)) as BackupManifest;
    phaseStartedAt = logBackupPerf('verify-outer-zip:complete', phaseStartedAt, { bytes: archive.byteLength });
  } catch {
    return { ok: false, message: 'Archivo .nodus inválido o dañado: no se pudo leer su estructura.' };
  }
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, message: 'Archivo .nodus inválido: su manifiesto no es legible.' };
  }
  const supportedVersions = [1, 2, 3, 4, 5, 6];
  if (manifest.format !== 'nodus.encrypted-backup' || !supportedVersions.includes(manifest.formatVersion)) {
    return { ok: false, message: 'Formato de copia de seguridad no soportado.' };
  }
  // v3 backups (automatic) carry no secrets: keys/tokens on this machine are preserved.
  const includesSecrets = manifest.formatVersion < 3 || manifest.includesSecrets === true;
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `El archivo usa un esquema más reciente (v${manifest.schemaVersion}) que esta versión de Nodus (v${SCHEMA_VERSION}). Actualiza la app.`,
    };
  }

  let payload: AdmZip;
  let recoveredKey: string | undefined;
  let usedRecoveryKey = false;
  try {
    let payloadCredential = password;
    if (manifest.formatVersion >= 6) {
      const wrappedEntry = zip.getEntry('recovery-key.bin');
      if (!manifest.recovery?.wrappedKeyCipher || !wrappedEntry) {
        return { ok: false, message: 'Copia inválida: falta la clave de recuperación cifrada.' };
      }
      try {
        payloadCredential = decryptBackupPayload(wrappedEntry.getData(), password, manifest.recovery.wrappedKeyCipher).toString('utf8');
      } catch {
        // If password unwrapping fails, the supplied credential may itself be the
        // independent recovery key. Payload authentication decides definitively.
        payloadCredential = password;
        usedRecoveryKey = true;
      }
      recoveredKey = payloadCredential;
    }
    phaseStartedAt = logBackupPerf('verify-credential:complete', phaseStartedAt, { recovery: manifest.formatVersion >= 6 });
    const ciphertext = encryptedEntry.getData();
    phaseStartedAt = logBackupPerf('verify-outer-entry-read:complete', phaseStartedAt, { bytes: ciphertext.byteLength });
    const plaintext = decryptBackupPayload(ciphertext, payloadCredential, manifest.cipher);
    phaseStartedAt = logBackupPerf('verify-decrypt:complete', phaseStartedAt, { bytes: plaintext.byteLength });
    payload = new AdmZip(plaintext);
    phaseStartedAt = logBackupPerf('verify-payload-zip-open:complete', phaseStartedAt);
  } catch {
    return { ok: false, message: 'No se pudo descifrar la copia. Revisa la contraseña o el archivo.' };
  }

  const payloadManifest = readJsonEntry<PayloadManifest>(payload, 'payload-manifest.json');
  if (!payloadManifest) {
    return { ok: false, message: 'Copia inválida: falta el manifiesto interno.' };
  }
  // Validate vault descriptors before any consumer looks up ZIP entries. In
  // particular, duplicate IDs or paths make the manifest ambiguous and could
  // cause one database/inventory to be silently reused for another vault.
  if (payloadManifest.vaults && !streamedVaultEntries(payloadManifest as StreamedInnerManifest)) {
    return { ok: false, message: 'Copia inválida: el manifiesto contiene bóvedas o rutas duplicadas.' };
  }
  if (!verifyPayloadHashes(payload, payloadManifest)) {
    return { ok: false, message: 'Copia inválida: los hashes internos no coinciden.' };
  }
  logBackupPerf('verify-payload-hashes:complete', phaseStartedAt, { files: Object.keys(payloadManifest.files).length });
  logBackupPerf('verify-open:complete', verifyStartedAt, { bytes: archive.byteLength });
  if (payloadManifest.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `El archivo usa un esquema más reciente (v${payloadManifest.schemaVersion}) que esta versión de Nodus (v${SCHEMA_VERSION}). Actualiza la app.`,
    };
  }
  return { manifest, payload, payloadManifest, includesSecrets, recoveredKey, usedRecoveryKey };
}

/**
 * Prove a freshly written snapshot can actually be opened with the credential the user
 * holds. Writing a file is not the same as having a backup: a rotated or unreadable
 * master password produces archives nobody can decrypt, and pruning would then delete
 * the last recoverable copies. Called before retention runs.
 */
export function verifyBackupArchive(archive: Buffer, password: string): { ok: boolean; message: string } {
  const startedAt = process.hrtime.bigint();
  if (!password.trim()) return { ok: false, message: 'Falta la contraseña para verificar la copia.' };
  const opened = openBackupArchive(archive, password);
  if ('ok' in opened) return opened;
  if (!opened.payloadManifest.vaults || opened.payloadManifest.vaults.length === 0) {
    return { ok: false, message: 'La copia verificada no contiene ninguna bóveda.' };
  }
  // Every vault's database must be present and open as a valid SQLite file: the hash
  // check proves the bytes survived, this proves they are still a database.
  for (const vault of opened.payloadManifest.vaults) {
    const entry = opened.payload.getEntry(vault.dbFile);
    if (!entry) return { ok: false, message: `La copia verificada no contiene la bóveda «${vault.name}».` };
  }
  if (opened.payloadManifest.globalLibrary) {
    const prefix = `${opened.payloadManifest.globalLibrary.prefix}/`;
    const entries = opened.payload.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.startsWith(prefix));
    if (entries.length !== opened.payloadManifest.globalLibrary.fileCount) {
      return { ok: false, message: 'La copia verificada no contiene todos los archivos de la Biblioteca global.' };
    }
  }
  logBackupPerf('verify:complete', startedAt, { vaults: opened.payloadManifest.vaults.length, bytes: archive.byteLength });
  return { ok: true, message: `Copia verificada: ${opened.payloadManifest.vaults.length} bóveda(s) descifrables.` };
}

export function restoreBackupArchive(archive: Buffer, password: string): BackupRestoreResult {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const opened = openBackupArchive(archive, password);
  if ('ok' in opened) return opened;
  const { manifest, payload, payloadManifest, includesSecrets, recoveredKey, usedRecoveryKey } = opened;

  const importedKeys = readJsonEntry<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json') ?? {};
  const importedAudioKeys = readJsonEntry<Record<string, string>>(payload, 'audio-keys.json') ?? {};

  // v4 = multi-vault archive: restore every vault (all types), keyed by its id.
  if (manifest.formatVersion >= 4) {
    let stagedLibrary: StagedGlobalLibrary | null;
    try {
      stagedLibrary = stageGlobalLibraryRestore(payload, payloadManifest);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    let result: { ok: true; restored: number } | { ok: false; message: string };
    try {
      result = restoreAllVaults(payload, payloadManifest);
      if (!result.ok) {
        cleanupStagedGlobalLibrary(stagedLibrary);
        return result;
      }
      if (manifest.formatVersion >= 5) restoreAuxiliaryFiles(payload, payloadManifest);
      applyStagedGlobalLibrary(stagedLibrary);
    } catch (error) {
      cleanupStagedGlobalLibrary(stagedLibrary);
      return { ok: false, message: `No se pudo completar la restauración: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (includesSecrets) {
      restoreApiKeys(importedKeys);
      restoreAudioKeys(importedAudioKeys);
    }
    return {
      ok: true,
      message: includesSecrets
        ? `Importación completa: ${result.restored} bóveda(s) con su biblioteca, embeddings, grafo y claves API restauradas.`
        : `Importación completa: ${result.restored} bóveda(s) restauradas (biblioteca, embeddings y grafo). Las claves API locales se han conservado (la copia automática no las incluye).`,
      recoveryKey: recoveredKey,
      usedRecoveryKey,
    };
  }

  // v1–v3 = single (active-vault) archive.
  const dbEntry = payload.getEntry('database.sqlite');
  if (!dbEntry) return { ok: false, message: 'Copia inválida: falta la base de datos.' };

  const importedSettings = readJsonEntry<BackupSettings>(payload, 'settings.json');
  const inventory = readJsonEntry<BackupInventory>(payload, 'backup-inventory.json');
  if (manifest.formatVersion >= 2 && !inventory) {
    return { ok: false, message: 'Copia inválida: falta el inventario de datos.' };
  }
  if (inventory && !settingsMatchInventory(importedSettings, importedKeys, inventory)) {
    return { ok: false, message: 'Copia inválida: la configuración de modelos o claves no coincide con su inventario.' };
  }

  // Write the imported DB to a temp file, then swap it in (migrations run on open).
  const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}.sqlite`);
  fs.writeFileSync(tmp, dbEntry.getData());
  if (inventory && !databaseMatchesInventory(tmp, inventory)) {
    fs.unlinkSync(tmp);
    return { ok: false, message: 'Copia inválida: faltan datos o embeddings en la instantánea de base de datos.' };
  }
  // Captured before the swap: these describe this computer, not the archived library.
  const localPaths = captureMachineLocalSettings().get(getActiveVault().id) ?? null;
  closeDb();
  replaceDbFile(tmp);
  fs.unlinkSync(tmp);

  // Restore settings and API keys to match the backed-up machine.
  const settingsEntry = payload.getEntry('settings.json');
  if (settingsEntry) {
    const imported = JSON.parse(payload.readAsText(settingsEntry));
    // Backups created before MCP support may not have these fields; backups from
    // any version must never restore a listener or a bearer credential.
    const restoredSettings = {
      ...imported,
      mcpEnabled: false,
      mcpToken: '',
      nodusServerEnabled: false,
      nodusServerKind: 'classic',
      nodusServerUrl: '',
      nodusServerSpaceId: '',
      nodusServerSpaceName: '',
    } as Record<string, unknown>;
    for (const key of MACHINE_LOCAL_SETTING_KEYS) {
      if (localPaths && localPaths[key] !== undefined) restoredSettings[key] = localPaths[key];
      else delete restoredSettings[key];
    }
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(restoredSettings));
  }
  // Secret-free (automatic) backups leave this machine's keys untouched.
  if (includesSecrets) {
    restoreApiKeys(importedKeys);
    restoreAudioKeys(importedAudioKeys);
  }

  return {
    ok: true,
    message: includesSecrets
      ? 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos, grafo y claves API restaurados.'
      : 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos y grafo restaurados. Las claves API locales se han conservado (la copia automática no las incluye).',
  };
}

class RestoreByteTracker {
  private completed = 0;
  readonly total: number;

  constructor(
    payload: ZipFileReader,
    names: ReadonlySet<string>,
    private readonly reporter?: (progress: RecoveryRestoreProgress) => void,
  ) {
    this.total = payload.entries.reduce(
      (total, entry) => total + (!entry.isDirectory && names.has(entry.name) ? entry.uncompressedSize : 0),
      0,
    );
    emitRestoreProgress(this.reporter, 'restoring', 0, this.total);
  }

  readonly advance = (chunkBytes: number): void => {
    this.completed = Math.min(this.total, this.completed + Math.max(0, chunkBytes));
    emitRestoreProgress(this.reporter, 'restoring', this.completed, this.total);
  };

  finish(): void {
    this.completed = this.total;
    emitRestoreProgress(this.reporter, 'restoring', this.completed, this.total);
  }
}

function plannedRestoreEntries(
  payload: ZipFileReader,
  payloadManifest: StreamedInnerManifest,
  formatVersion: number,
): Set<string> {
  const names = new Set<string>();
  const add = (name: string): void => { if (payload.entry(name)) names.add(name); };
  add('api-keys.json');
  add('audio-keys.json');
  if (formatVersion < 4) {
    add('database.sqlite');
    add('settings.json');
    add('backup-inventory.json');
    return names;
  }

  for (const vault of streamedVaultEntries(payloadManifest) ?? []) {
    add(vault.dbFile);
    add(vault.inventoryFile);
  }
  if (payloadManifest.globalLibrary) {
    const prefix = `${payloadManifest.globalLibrary.prefix}/`;
    for (const entry of payload.entries) if (!entry.isDirectory && entry.name.startsWith(prefix)) names.add(entry.name);
  }

  const selection = normalizeBackupSelection(payloadManifest.selection as Partial<BackupSelection> | undefined, false);
  if (selection.includeHistories) add('aux/global/focus.sqlite');
  if (selection.includePreferences) {
    for (const name of GLOBAL_AUXILIARY_FILES) add(`aux/global/${name}`);
    const prefix = 'aux/global/plugins/installed/';
    for (const entry of payload.entries) if (!entry.isDirectory && entry.name.startsWith(prefix)) names.add(entry.name);
  }
  for (const vault of streamedVaultEntries(payloadManifest) ?? []) {
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) add(`aux/vaults/${vault.id}/${name}`);
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) add(`aux/vaults/${vault.id}/${name}`);
      const prefix = `aux/vaults/${vault.id}/audio/`;
      for (const entry of payload.entries) if (!entry.isDirectory && entry.name.startsWith(prefix)) names.add(entry.name);
    }
  }
  return names;
}

async function readStreamedJson<T>(payload: ZipFileReader, name: string, tracker?: RestoreByteTracker): Promise<T | null> {
  const entry = payload.entry(name);
  if (!entry) return null;
  const value = JSON.parse((await payload.read(entry, 16 * 1024 * 1024)).toString('utf8')) as T;
  tracker?.advance(entry.uncompressedSize);
  return value;
}

async function extractAtomicEntry(payload: ZipFileReader, entry: ZipFileEntry, target: string, tracker?: RestoreByteTracker): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.restore-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await payload.extract(entry, temporary, tracker?.advance);
    await fs.promises.rename(temporary, target);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

function streamedVaultEntries(manifest: StreamedInnerManifest): BackupVaultEntry[] | null {
  if (!manifest.vaults?.length) return null;
  const vaults: BackupVaultEntry[] = [];
  const ids = new Set<string>();
  const dbFiles = new Set<string>();
  const inventoryFiles = new Set<string>();
  for (const candidate of manifest.vaults) {
    if (
      typeof candidate.id !== 'string' || !candidate.id
      || typeof candidate.name !== 'string' || !candidate.name
      || candidate.id === '.' || candidate.id === '..'
      || candidate.id.includes('/') || candidate.id.includes('\\')
      || !isVaultType(candidate.type)
      || typeof candidate.dbFile !== 'string' || !candidate.dbFile
      || typeof candidate.inventoryFile !== 'string' || !candidate.inventoryFile
      || !safeArchiveRelative(candidate.dbFile)
      || !safeArchiveRelative(candidate.inventoryFile)
      || ids.has(candidate.id)
      || dbFiles.has(candidate.dbFile)
      || inventoryFiles.has(candidate.inventoryFile)
    ) return null;
    ids.add(candidate.id);
    dbFiles.add(candidate.dbFile);
    inventoryFiles.add(candidate.inventoryFile);
    vaults.push({
      id: candidate.id,
      name: candidate.name,
      type: candidate.type,
      legacy: candidate.legacy === true,
      dbFile: candidate.dbFile,
      inventoryFile: candidate.inventoryFile,
    });
  }
  return vaults;
}

async function stageGlobalLibraryRestoreFromFile(
  payload: ZipFileReader,
  payloadManifest: StreamedInnerManifest,
  tracker?: RestoreByteTracker,
): Promise<StagedGlobalLibrary | null> {
  const descriptor = payloadManifest.globalLibrary;
  if (!descriptor) return null;
  const root = configuredLibraryRoot();
  if (!root) throw new Error('Configura una carpeta de copias antes de restaurar una copia que contiene la Biblioteca global.');
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.nodus-library-restore-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(staging, { recursive: false });
  let written = 0;
  try {
    const prefix = `${descriptor.prefix}/`;
    for (const entry of payload.entries) {
      if (entry.isDirectory || !entry.name.startsWith(prefix)) continue;
      const relative = safeArchiveRelative(entry.name.slice(prefix.length));
      if (!relative) throw new Error(`La copia contiene una ruta de Biblioteca no válida: ${entry.name}`);
      const target = archiveTargetInside(staging, relative);
      if (!target) throw new Error('La copia intenta escribir fuera de la Biblioteca.');
      await payload.extract(entry, target, tracker?.advance);
      written += 1;
    }
    if (written !== descriptor.fileCount) throw new Error('La copia no contiene todos los archivos declarados de la Biblioteca global.');
    return { root, staging };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function restoreAllVaultsFromFile(
  payload: ZipFileReader,
  payloadManifest: StreamedInnerManifest,
  tracker?: RestoreByteTracker,
): Promise<{ ok: true; restored: number } | { ok: false; message: string }> {
  const vaults = streamedVaultEntries(payloadManifest);
  if (!vaults) return { ok: false, message: 'Copia inválida: el archivo no contiene bóvedas válidas.' };
  const staged: { entry: BackupVaultEntry; tmp: string }[] = [];
  const cleanup = () => staged.forEach((item) => fs.rmSync(item.tmp, { force: true }));
  try {
    for (const vault of vaults) {
      const dbEntry = payload.entry(vault.dbFile);
      if (!dbEntry) return { ok: false, message: `Copia inválida: falta la base de datos de la bóveda «${vault.name}».` };
      const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
      await payload.extract(dbEntry, tmp, tracker?.advance);
      staged.push({ entry: vault, tmp });
      const inventory = await readStreamedJson<BackupInventory>(payload, vault.inventoryFile, tracker);
      if (inventory && !databaseMatchesInventory(tmp, inventory)) {
        return { ok: false, message: `Copia inválida: faltan datos en la bóveda «${vault.name}».` };
      }
    }

    const machineLocal = captureMachineLocalSettings();
    // Its connections would keep reading (and holding on disk) the files replaced below.
    await stopVectorScanWorker();
    closeDb();
    for (const { entry, tmp } of staged) {
      applyMachineLocalSettings(tmp, machineLocal.get(entry.id) ?? null);
      restoreVaultDatabase(entry, tmp);
    }
    const activeId = payloadManifest.activeVaultId ?? vaults[0].id;
    try { setActiveVault(activeId); } catch { /* keep the current vault if absent */ }
    getDb();
    return { ok: true, restored: staged.length };
  } finally {
    cleanup();
  }
}

async function restoreAuxiliaryFilesFromFile(
  payload: ZipFileReader,
  payloadManifest: StreamedInnerManifest,
  tracker?: RestoreByteTracker,
): Promise<void> {
  const selection = normalizeBackupSelection(payloadManifest.selection as Partial<BackupSelection> | undefined, false);
  const focus = selection.includeHistories ? payload.entry('aux/global/focus.sqlite') : undefined;
  if (focus) {
    const staged = `${globalFocusFile()}.restore-${process.pid}`;
    try {
      await extractAtomicEntry(payload, focus, staged, tracker);
      restoreGlobalFocusBackupFile(staged);
    } finally { fs.rmSync(staged, { force: true }); }
  }
  if (selection.includePreferences) {
    let restoredBookmarks = false;
    for (const name of GLOBAL_AUXILIARY_FILES) {
      const entry = payload.entry(`aux/global/${name}`);
      if (!entry) continue;
      if (name === 'app-prefs.json') {
        restoreGlobalPreferences(await payload.read(entry, 16 * 1024 * 1024));
        tracker?.advance(entry.uncompressedSize);
      } else await extractAtomicEntry(payload, entry, path.join(app.getPath('userData'), name), tracker);
      if (name === 'browser-bookmarks.json') restoredBookmarks = true;
    }
    if (restoredBookmarks) browserBookmarksRepository().reloadFromDisk();
    const pluginPrefix = 'aux/global/plugins/installed/';
    for (const entry of payload.entries) {
      if (entry.isDirectory || !entry.name.startsWith(pluginPrefix)) continue;
      const relative = safeArchiveRelative(entry.name.slice(pluginPrefix.length));
      const target = relative ? archiveTargetInside(path.join(app.getPath('userData'), 'plugins', 'installed'), relative) : null;
      if (!target || path.basename(target) === 'secrets.bin') throw new Error(`The backup contains an invalid plugin path: ${entry.name}`);
      await extractAtomicEntry(payload, entry, target, tracker);
    }
  }

  const restoredVaults = new Map(listVaults().map((vault) => [vault.id, vault]));
  for (const vaultEntry of streamedVaultEntries(payloadManifest) ?? []) {
    const vault = restoredVaults.get(vaultEntry.id);
    if (!vault) continue;
    const targetDir = path.dirname(vault.path);
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) {
        const entry = payload.entry(`aux/vaults/${vault.id}/${name}`);
        if (entry) await extractAtomicEntry(payload, entry, path.join(targetDir, name), tracker);
      }
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) {
        const entry = payload.entry(`aux/vaults/${vault.id}/${name}`);
        if (entry) await extractAtomicEntry(payload, entry, path.join(targetDir, name), tracker);
      }
      const prefix = `aux/vaults/${vault.id}/audio/`;
      for (const entry of payload.entries) {
        if (entry.isDirectory || !entry.name.startsWith(prefix)) continue;
        const relative = safeArchiveRelative(entry.name.slice(prefix.length));
        const target = relative ? archiveTargetInside(path.join(targetDir, 'audio'), relative) : null;
        if (!target) throw new Error(`La copia contiene una ruta de audio no válida: ${entry.name}`);
        await extractAtomicEntry(payload, entry, target, tracker);
      }
    }
  }
}

/** Restore a fully authenticated file-backed archive while keeping large vaults
 * and media entries on disk throughout the operation. */
export async function restoreBackupArchiveFile(
  archivePath: string,
  password: string,
  onProgress?: (progress: RecoveryRestoreProgress) => void,
): Promise<BackupRestoreResult> {
  if (!password.trim()) return { ok: false, message: 'Importación cancelada: falta la contraseña de la copia.' };
  const opened = await openVerifiedBackupFile(archivePath, password, SCHEMA_VERSION, (phase, completedBytes, totalBytes) => {
    emitRestoreProgress(onProgress, phase, completedBytes, totalBytes);
  });
  if (!opened.ok) return opened;
  const { manifest, payload, payloadManifest, includesSecrets, recoveredKey, usedRecoveryKey } = opened;
  const tracker = new RestoreByteTracker(payload, plannedRestoreEntries(payload, payloadManifest, manifest.formatVersion), onProgress);
  try {
    const importedKeys = await readStreamedJson<Partial<Record<AiProvider, string>>>(payload, 'api-keys.json', tracker) ?? {};
    const importedAudioKeys = await readStreamedJson<Record<string, string>>(payload, 'audio-keys.json', tracker) ?? {};

    if (manifest.formatVersion >= 4) {
      const stagedLibrary = await stageGlobalLibraryRestoreFromFile(payload, payloadManifest, tracker);
      try {
        const result = await restoreAllVaultsFromFile(payload, payloadManifest, tracker);
        if (!result.ok) {
          cleanupStagedGlobalLibrary(stagedLibrary);
          return result;
        }
        if (manifest.formatVersion >= 5) await restoreAuxiliaryFilesFromFile(payload, payloadManifest, tracker);
        applyStagedGlobalLibrary(stagedLibrary);
        if (includesSecrets) {
          restoreApiKeys(importedKeys);
          restoreAudioKeys(importedAudioKeys);
        }
        tracker.finish();
        return {
          ok: true,
          message: includesSecrets
            ? `Importación completa: ${result.restored} bóveda(s) con su biblioteca, embeddings, grafo y claves API restauradas.`
            : `Importación completa: ${result.restored} bóveda(s) restauradas (biblioteca, embeddings y grafo). Las claves API locales se han conservado (la copia automática no las incluye).`,
          recoveryKey: recoveredKey,
          usedRecoveryKey,
        };
      } catch (error) {
        cleanupStagedGlobalLibrary(stagedLibrary);
        throw error;
      }
    }

    const dbEntry = payload.entry('database.sqlite');
    if (!dbEntry) return { ok: false, message: 'Copia inválida: falta la base de datos.' };
    const importedSettings = await readStreamedJson<BackupSettings>(payload, 'settings.json', tracker);
    const inventory = await readStreamedJson<BackupInventory>(payload, 'backup-inventory.json', tracker);
    if (manifest.formatVersion >= 2 && !inventory) return { ok: false, message: 'Copia inválida: falta el inventario de datos.' };
    if (inventory && !settingsMatchInventory(importedSettings, importedKeys, inventory)) {
      return { ok: false, message: 'Copia inválida: la configuración de modelos o claves no coincide con su inventario.' };
    }
    const tmp = path.join(app.getPath('temp'), `nodus-import-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      await payload.extract(dbEntry, tmp, tracker.advance);
      if (inventory && !databaseMatchesInventory(tmp, inventory)) {
        return { ok: false, message: 'Copia inválida: faltan datos o embeddings en la instantánea de base de datos.' };
      }
      const localPaths = captureMachineLocalSettings().get(getActiveVault().id) ?? null;
      await stopVectorScanWorker();
      closeDb();
      replaceDbFile(tmp);
      if (importedSettings) {
        const restoredSettings = {
          ...importedSettings,
          mcpEnabled: false,
          mcpToken: '',
          nodusServerEnabled: false,
          nodusServerKind: 'classic',
          nodusServerUrl: '',
          nodusServerSpaceId: '',
          nodusServerSpaceName: '',
        } as Record<string, unknown>;
        for (const key of MACHINE_LOCAL_SETTING_KEYS) {
          if (localPaths && localPaths[key] !== undefined) restoredSettings[key] = localPaths[key];
          else delete restoredSettings[key];
        }
        getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run('app', JSON.stringify(restoredSettings));
      }
      if (includesSecrets) {
        restoreApiKeys(importedKeys);
        restoreAudioKeys(importedAudioKeys);
      }
      tracker.finish();
      return {
        ok: true,
        message: includesSecrets
          ? 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos, grafo y claves API restaurados.'
          : 'Importación completa: biblioteca, texto extraído, embeddings, pasajes, modelos y grafo restaurados. Las claves API locales se han conservado (la copia automática no las incluye).',
        recoveryKey: recoveredKey,
        usedRecoveryKey,
      };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } finally {
    await opened.cleanup();
  }
}

interface StagedGlobalLibrary {
  root: string;
  staging: string;
}

function stageGlobalLibraryRestore(payload: AdmZip, payloadManifest: PayloadManifest): StagedGlobalLibrary | null {
  const descriptor = payloadManifest.globalLibrary;
  if (!descriptor) return null; // v3.x and early multi-vault archives remain compatible.
  const root = configuredLibraryRoot();
  if (!root) throw new Error('Configura una carpeta de copias antes de restaurar una copia que contiene la Biblioteca global.');
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.nodus-library-restore-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(staging, { recursive: false });
  let written = 0;
  try {
    const prefix = `${descriptor.prefix}/`;
    for (const entry of payload.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
      const relative = safeArchiveRelative(entry.entryName.slice(prefix.length));
      if (!relative) throw new Error(`La copia contiene una ruta de Biblioteca no válida: ${entry.entryName}`);
      const target = archiveTargetInside(staging, relative);
      if (!target) throw new Error('La copia intenta escribir fuera de la Biblioteca.');
      writeAtomicFile(target, entry.getData());
      written += 1;
    }
    if (written !== descriptor.fileCount) throw new Error('La copia no contiene todos los archivos declarados de la Biblioteca global.');
    return { root, staging };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function cleanupStagedGlobalLibrary(staged: StagedGlobalLibrary | null): void {
  if (staged) fs.rmSync(staged.staging, { recursive: true, force: true });
}

function applyStagedGlobalLibrary(staged: StagedGlobalLibrary | null): void {
  if (!staged) return;
  closeGlobalLibraryRuntime();
  const displaced = `${staged.root}.before-restore-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    if (fs.existsSync(staged.root)) fs.renameSync(staged.root, displaced);
    fs.renameSync(staged.staging, staged.root);
    // These local recovery packages are deliberately not embedded in ordinary
    // archives. Carry them across the atomic swap or a successful restore would erase
    // the one downgrade/recovery path that the backup intentionally omitted.
    for (const name of ['pre-v4', 'restores']) {
      const preserved = path.join(displaced, '.nodus', 'recovery', name);
      const target = path.join(staged.root, '.nodus', 'recovery', name);
      if (!fs.existsSync(preserved) || fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(preserved, target);
    }
    // The caller's encrypted safety archive is the durable rollback. This sibling is
    // only the atomic-swap guard and is removed after the replacement has landed.
    fs.rmSync(displaced, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(staged.staging)) fs.rmSync(staged.staging, { recursive: true, force: true });
    if (fs.existsSync(displaced) && !fs.existsSync(staged.root)) fs.renameSync(displaced, staged.root);
    throw error;
  }
}

/**
 * Restore every vault in a v4 archive, keyed by its original id (merge-safe: local
 * vaults NOT present in the backup are left untouched, never deleted). The live DB is
 * closed first so the active vault's file can be replaced, then reopened on the
 * restored active vault (running any pending migrations).
 */
function restoreAllVaults(
  payload: AdmZip,
  payloadManifest: PayloadManifest
): { ok: true; restored: number } | { ok: false; message: string } {
  const vaults = payloadManifest.vaults;
  if (!vaults || vaults.length === 0) return { ok: false, message: 'Copia inválida: el archivo no contiene bóvedas.' };

  // Validate everything (entries + inventories) into temp files BEFORE touching any
  // live data, so a corrupt archive can't leave a half-restored library.
  const staged: { entry: BackupVaultEntry; tmp: string }[] = [];
  const cleanup = () => staged.forEach((s) => fs.existsSync(s.tmp) && fs.unlinkSync(s.tmp));
  try {
    for (const ve of vaults) {
      const dbEntry = payload.getEntry(ve.dbFile);
      if (!dbEntry) {
        cleanup();
        return { ok: false, message: `Copia inválida: falta la base de datos de la bóveda «${ve.name}».` };
      }
      const tmp = path.join(app.getPath('temp'), `nodus-import-${ve.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
      fs.writeFileSync(tmp, dbEntry.getData());
      const inv = ve.inventoryFile ? readJsonEntry<BackupInventory>(payload, ve.inventoryFile) : null;
      if (inv && !databaseMatchesInventory(tmp, inv)) {
        fs.unlinkSync(tmp);
        cleanup();
        return { ok: false, message: `Copia inválida: faltan datos en la bóveda «${ve.name}».` };
      }
      staged.push({ entry: ve, tmp });
    }

    // All validated — swap the live DB out and restore each vault to its path.
    closeDb();
    // Read this computer's paths before the swap, then stamp them into each incoming
    // snapshot so the restore never inherits another machine's Zotero root. Done on the
    // staged temp file, so what lands in place is already correct.
    const machineLocal = captureMachineLocalSettings();
    for (const { entry, tmp } of staged) {
      applyMachineLocalSettings(tmp, machineLocal.get(entry.id) ?? null);
      restoreVaultDatabase({ id: entry.id, name: entry.name, type: entry.type, legacy: entry.legacy }, tmp);
    }
    const activeId = payloadManifest.activeVaultId ?? vaults[0].id;
    try {
      setActiveVault(activeId);
    } catch {
      /* the backup's active vault might be absent; keep the current one */
    }
    getDb(); // reopen (+ migrate) the active vault
    return { ok: true, restored: staged.length };
  } finally {
    cleanup();
  }
}

/** This machine's path settings, per vault id, read from the vaults currently on disk. */
function captureMachineLocalSettings(): Map<string, Record<string, unknown>> {
  const captured = new Map<string, Record<string, unknown>>();
  let vaults: ReturnType<typeof listVaults>;
  try {
    vaults = listVaults();
  } catch {
    return captured;
  }
  for (const vault of vaults) {
    try {
      if (!fs.statSync(vault.path).isFile()) continue;
    } catch {
      continue; // a vault in the registry whose file is gone has nothing to preserve
    }
    const db = new Database(vault.path, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
      const current = (row ? safeParse(row.value) : {}) as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const key of MACHINE_LOCAL_SETTING_KEYS) {
        if (current[key] !== undefined) picked[key] = current[key];
      }
      captured.set(vault.id, picked);
    } catch {
      /* an unreadable settings row simply contributes no local override */
    } finally {
      db.close();
    }
  }
  return captured;
}

/**
 * Replace the machine-local keys in a snapshot's settings row with this computer's
 * values. `null` (no such vault here yet — a fresh device) removes them entirely, so
 * `getSettings()` falls back to the defaults and Zotero auto-detection can run.
 */
function applyMachineLocalSettings(databasePath: string, local: Record<string, unknown> | null): void {
  const db = new Database(databasePath);
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    const settings = (row ? safeParse(row.value) : {}) as Record<string, unknown>;
    for (const key of MACHINE_LOCAL_SETTING_KEYS) {
      if (local && local[key] !== undefined) settings[key] = local[key];
      else delete settings[key];
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(settings));
  } finally {
    db.close();
  }
}

function writeAtomicFile(target: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.restore-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, target);
}

function restoreGlobalPreferences(data: Buffer): void {
  const target = path.join(app.getPath('userData'), 'app-prefs.json');
  let incoming: Record<string, unknown>;
  try {
    incoming = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('La copia contiene preferencias globales ilegibles.');
  }
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
  } catch {
    /* A new device has no current preference file yet. */
  }
  // Absolute folder paths and recovery scheduling belong to this machine. Importing
  // another computer's values could silently redirect snapshots to a missing path.
  const merged = { ...incoming };
  for (const key of RECOVERY_PREF_KEYS) {
    if (current[key] !== undefined) merged[key] = current[key];
    else delete merged[key];
  }
  writeAtomicFile(target, Buffer.from(JSON.stringify(merged, null, 2)));
}

export function safeArchiveRelative(value: string): string | null {
  // ZIP names are portable POSIX paths. Reject Windows separators and drive/UNC
  // spellings even on POSIX, where path.posix would otherwise treat them as a
  // harmless filename that becomes traversal once consumed on Windows.
  if (!value || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value) || value.startsWith('//')) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

function archiveTargetInside(root: string, relative: string): string | null {
  const safe = safeArchiveRelative(relative);
  if (!safe) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...safe.split('/'));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  // Textual containment is insufficient when an existing audio/library folder
  // is a symlink. Check the closest existing ancestor as well.
  return pathStaysInside(path.dirname(resolvedRoot), target) ? target : null;
}

function restoreAuxiliaryFiles(payload: AdmZip, payloadManifest: PayloadManifest): void {
  const selection = normalizeBackupSelection(payloadManifest.selection, false);
  const focus = selection.includeHistories ? payload.getEntry('aux/global/focus.sqlite') : null;
  if (focus) {
    const staged = `${globalFocusFile()}.restore-${process.pid}`;
    try {
      writeAtomicFile(staged, focus.getData());
      restoreGlobalFocusBackupFile(staged);
    } finally { fs.rmSync(staged, { force: true }); }
  }
  if (selection.includePreferences) {
    let restoredBookmarks = false;
    for (const name of GLOBAL_AUXILIARY_FILES) {
      const entry = payload.getEntry(`aux/global/${name}`);
      if (!entry) continue;
      if (name === 'app-prefs.json') restoreGlobalPreferences(entry.getData());
      else writeAtomicFile(path.join(app.getPath('userData'), name), entry.getData());
      if (name === 'browser-bookmarks.json') restoredBookmarks = true;
    }
    if (restoredBookmarks) browserBookmarksRepository().reloadFromDisk();
    const pluginPrefix = 'aux/global/plugins/installed/';
    for (const entry of payload.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(pluginPrefix)) continue;
      const relative = safeArchiveRelative(entry.entryName.slice(pluginPrefix.length));
      const target = relative ? archiveTargetInside(path.join(app.getPath('userData'), 'plugins', 'installed'), relative) : null;
      if (!target || path.basename(target) === 'secrets.bin') throw new Error(`The backup contains an invalid plugin path: ${entry.entryName}`);
      writeAtomicFile(target, entry.getData());
    }
  }

  const restoredVaults = new Map(listVaults().map((vault) => [vault.id, vault]));
  for (const vaultEntry of payloadManifest.vaults ?? []) {
    const vault = restoredVaults.get(vaultEntry.id);
    if (!vault) continue;
    const targetDir = path.dirname(vault.path);
    if (selection.includeHistories) {
      for (const name of VAULT_HISTORY_FILES) {
        const entry = payload.getEntry(`aux/vaults/${vault.id}/${name}`);
        if (entry) writeAtomicFile(path.join(targetDir, name), entry.getData());
      }
    }
    if (selection.includeGeneratedMedia) {
      for (const name of VAULT_MEDIA_FILES) {
        const entry = payload.getEntry(`aux/vaults/${vault.id}/${name}`);
        if (entry) writeAtomicFile(path.join(targetDir, name), entry.getData());
      }
      const prefix = `aux/vaults/${vault.id}/audio/`;
      for (const entry of payload.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
        const relative = safeArchiveRelative(entry.entryName.slice(prefix.length));
        const target = relative ? archiveTargetInside(path.join(targetDir, 'audio'), relative) : null;
        if (!target) throw new Error(`La copia contiene una ruta de audio no válida: ${entry.entryName}`);
        writeAtomicFile(target, entry.getData());
      }
    }
  }
}

/** Strip listeners, remote publication bindings and any stray secrets from settings. */
function scrubSettings(raw: unknown): BackupSettings {
  const obj = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete obj.mcpToken;
  delete obj.providerKeys;
  obj.mcpEnabled = false;
  obj.nodusServerEnabled = false;
  obj.nodusServerKind = 'classic';
  obj.nodusServerUrl = '';
  obj.nodusServerSpaceId = '';
  obj.nodusServerSpaceName = '';
  return obj as unknown as BackupSettings;
}

/** Scrub and inventory the point-in-time SQLite file produced by the utility process. */
function prepareSnapshotDatabase(
  snapshotPath: string,
  apiKeys: Partial<Record<AiProvider, string>>,
): BackupInventory {
  const startedAt = process.hrtime.bigint();
  let phaseStartedAt = startedAt;
  const snapshotDb = new Database(snapshotPath);
  let scrubbed: BackupSettings;
  try {
    const row = snapshotDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    scrubbed = scrubSettings(row ? safeParse(row.value) : {});
    snapshotDb
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(scrubbed));
  } finally {
    snapshotDb.close();
  }
  phaseStartedAt = logBackupPerf('snapshot-scrub:complete', phaseStartedAt);
  const inventory = databaseInventory(snapshotPath, scrubbed, apiKeys);
  logBackupPerf('snapshot-inventory:complete', phaseStartedAt);
  logBackupPerf('snapshot-database:complete', startedAt, { bytes: fs.statSync(snapshotPath).size });
  return inventory;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function databaseInventory(
  databasePath: string,
  settings: BackupSettings,
  apiKeys: Partial<Record<AiProvider, string>>
): BackupInventory {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tableRows = Object.fromEntries(
      (db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[])
        .map(({ name }) => [name, tableRowCount(db, name)])
    );
    return {
      tableRows,
      testimony: testimonyBackupInventory(db),
      embeddings: {
        ideas: embeddingInventory(db, 'ideas'),
        workSummaries: embeddingInventory(db, 'work_summaries'),
        passages: embeddingInventory(db, 'passages'),
        documents: embeddingInventory(db, 'document_vectors'),
      },
      modelSettings: modelSettings(settings),
      apiKeyProviders: Object.keys(apiKeys).sort() as AiProvider[],
    };
  } finally {
    db.close();
  }
}

function tableRowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number }).count;
}

function embeddingInventory(db: Database.Database, table: string): EmbeddingInventory {
  if (!hasTable(db, table)) return { records: 0, bytes: 0 };
  const row = db
    .prepare(`SELECT COUNT(embedding) AS records, COALESCE(SUM(length(embedding)), 0) AS bytes FROM ${quoteIdentifier(table)}`)
    .get() as { records: number; bytes: number };
  return { records: Number(row.records), bytes: Number(row.bytes) };
}

function databaseMatchesInventory(databasePath: string, expected: BackupInventory): boolean {
  const checkDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const result = checkDb.pragma('quick_check', { simple: true });
    if (result !== 'ok') return false;
  } finally {
    checkDb.close();
  }
  const actual = databaseInventory(databasePath, expected.modelSettings as Omit<AppSettings, 'providerKeys'>, {});
  for (const [table, expectedRows] of Object.entries(expected.tableRows)) {
    if (actual.tableRows[table] !== expectedRows) return false;
  }
  return (
    actual.embeddings.ideas.records === expected.embeddings.ideas.records &&
    actual.embeddings.ideas.bytes === expected.embeddings.ideas.bytes &&
    actual.embeddings.workSummaries.records === expected.embeddings.workSummaries.records &&
    actual.embeddings.workSummaries.bytes === expected.embeddings.workSummaries.bytes &&
    actual.embeddings.passages.records === expected.embeddings.passages.records &&
    actual.embeddings.passages.bytes === expected.embeddings.passages.bytes &&
    (!expected.embeddings.documents || (
      actual.embeddings.documents?.records === expected.embeddings.documents.records &&
      actual.embeddings.documents?.bytes === expected.embeddings.documents.bytes
    ))
  );
}

function settingsMatchInventory(
  settings: BackupSettings | null,
  apiKeys: Partial<Record<AiProvider, string>>,
  expected: BackupInventory
): boolean {
  if (!settings) return false;
  return (
    JSON.stringify(modelSettings(settings)) === JSON.stringify(expected.modelSettings) &&
    JSON.stringify(Object.keys(apiKeys).sort()) === JSON.stringify(expected.apiKeyProviders)
  );
}

function modelSettings(
  settings: Pick<
    AppSettings,
    | 'embeddingProvider' | 'embeddingModel' | 'favorites' | 'codexReasoningEfforts' | 'defaultModel' | 'modelSettingsMode' | 'modelSettingsVersion'
    | 'extractionModel' | 'synthesisModel' | 'summaryModel' | 'fusionModel' | 'documentProfileModel' | 'documentAuditModel'
    | 'chatModel' | 'nodiModel' | 'deepResearchModel' | 'immersionModel' | 'writingModel'
    | 'argumentMapModel' | 'authorModel' | 'studyModel' | 'tutorModel' | 'hypothesisModel'
    | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel' | 'transcriptionModel' | 'sttProvider'
    | 'sttTransformersModel' | 'sttWhisperCppModel' | 'sttWhisperCppExecutable'
    | 'imageProvider' | 'imageModel' | 'imageQuality' | 'imageStyle' | 'audioProvider' | 'audioVoice' | 'audioSpeed'
    | 'documentIndexingEnabled' | 'documentIndexIncludeArchived' | 'documentIndexConcurrency'
  >
): BackupInventory['modelSettings'] {
  return {
    embeddingProvider: settings.embeddingProvider,
    embeddingModel: settings.embeddingModel,
    favorites: settings.favorites,
    codexReasoningEfforts: settings.codexReasoningEfforts,
    defaultModel: settings.defaultModel,
    modelSettingsMode: settings.modelSettingsMode,
    modelSettingsVersion: settings.modelSettingsVersion,
    extractionModel: settings.extractionModel,
    synthesisModel: settings.synthesisModel,
    summaryModel: settings.summaryModel,
    fusionModel: settings.fusionModel,
    documentProfileModel: settings.documentProfileModel,
    documentAuditModel: settings.documentAuditModel,
    chatModel: settings.chatModel,
    nodiModel: settings.nodiModel,
    deepResearchModel: settings.deepResearchModel,
    immersionModel: settings.immersionModel,
    writingModel: settings.writingModel,
    argumentMapModel: settings.argumentMapModel,
    authorModel: settings.authorModel,
    studyModel: settings.studyModel,
    tutorModel: settings.tutorModel,
    hypothesisModel: settings.hypothesisModel,
    improveModel: settings.improveModel,
    questionGenModel: settings.questionGenModel,
    gradingModel: settings.gradingModel,
    flashcardModel: settings.flashcardModel,
    transcriptionModel: settings.transcriptionModel,
    sttProvider: settings.sttProvider,
    sttTransformersModel: settings.sttTransformersModel,
    sttWhisperCppModel: settings.sttWhisperCppModel,
    sttWhisperCppExecutable: settings.sttWhisperCppExecutable,
    imageProvider: settings.imageProvider,
    imageModel: settings.imageModel,
    imageQuality: settings.imageQuality,
    imageStyle: settings.imageStyle,
    audioProvider: settings.audioProvider,
    audioVoice: settings.audioVoice,
    audioSpeed: settings.audioSpeed,
    documentIndexingEnabled: settings.documentIndexingEnabled,
    documentIndexIncludeArchived: settings.documentIndexIncludeArchived,
    documentIndexConcurrency: settings.documentIndexConcurrency,
  };
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function restoreAudioKeys(keys: Record<string, string>): void {
  for (const name of AUDIO_KEY_NAMES) {
    const key = keys[name];
    // Merge-only, matching restoreApiKeys: an absent entry means "unknown", not "delete".
    if (key) setAudioKey(name, key);
  }
}

function restoreApiKeys(keys: Partial<Record<AiProvider, string>>): void {
  for (const provider of SECRET_PROVIDERS) {
    const key = keys[provider];
    // Merge-only recovery: an absent provider can mean that the source snapshot
    // was created while its OS keychain was temporarily unavailable. Never erase
    // a local encrypted blob merely because an archive omits it.
    if (key) setApiKey(provider, key);
  }
}

function readJsonEntry<T>(zip: AdmZip, name: string): T | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  return JSON.parse(zip.readAsText(entry)) as T;
}

function verifyPayloadHashes(zip: AdmZip, manifest: PayloadManifest): boolean {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const entry = zip.getEntry(name);
    if (!entry) return false;
    const data = entry.getData();
    if (data.byteLength !== expected.bytes) return false;
    if (sha256Hex(data) !== expected.sha256) return false;
  }
  return true;
}
