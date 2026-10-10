import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

test('cleanup is opt-in, app-wide and has a conservative default horizon', async () => {
  const [types, defaults, prefs, repository] = await Promise.all([
    read('shared/types.ts'),
    read('shared/defaultAppSettings.ts'),
    read('electron/db/appPrefs.ts'),
    read('electron/db/settingsRepo.ts'),
  ]);
  assert.match(types, /backupCleanupEnabled: boolean/);
  assert.match(types, /backupRetentionUnit: BackupRetentionUnit/);
  assert.match(types, /purgeReadyCount: number/);
  assert.match(defaults, /backupCleanupEnabled: false/);
  assert.match(defaults, /backupRetentionValue: 3/);
  assert.match(defaults, /backupRetentionUnit: 'months'/);
  assert.match(repository, /typeof merged\.backupCleanupEnabled !== 'boolean'/, 'corrupted persisted opt-in fails closed');
  assert.match(repository, /!Number\.isInteger\(merged\.backupRetentionValue\)/, 'corrupted persisted retention is repaired');
  for (const key of ['backupCleanupEnabled', 'backupRetentionValue', 'backupRetentionUnit', 'lastBackupCleanupAt', 'lastBackupCleanupStatus']) {
    assert.match(prefs, new RegExp(`'${key}'`), `${key} is shared across vaults`);
  }
});

test('cleanup IPC exposes a read-only preview and an explicit run action', async () => {
  const [types, preload, ipc] = await Promise.all([
    read('shared/types.ts'),
    read('electron/preload/api.ts'),
    read('electron/ipc.ts'),
  ]);
  assert.match(types, /previewBackupCleanup\(\): Promise<BackupCleanupPreview>/);
  assert.match(types, /runBackupCleanupNow\(scopeToken: string\): Promise<BackupCleanupResult>/);
  assert.match(preload, /backup:cleanupPreview/);
  assert.match(preload, /backup:cleanupRunNow/);
  assert.match(ipc, /h\('backup:cleanupPreview'/);
  assert.match(ipc, /h\('backup:cleanupRunNow'/);
  assert.match(ipc, /retentionCutoff\(value, unit\)/, 'untrusted retention settings are validated before persistence');
});

test('startup catch-up runs backup first and cancels cleanup after a failed due backup', async () => {
  const main = await read('electron/main.ts');
  const backupIndex = main.indexOf('await maybeRunAutoBackup(app.getVersion())');
  const guardIndex = main.indexOf('if (backup && !backup.ok) return;');
  const cleanupIndex = main.indexOf('await maybeRunBackupCleanup()');
  assert.ok(backupIndex >= 0 && guardIndex > backupIndex && cleanupIndex > guardIndex);
  assert.match(main, /autoBackupFirstTimer = setTimeout\(autoBackupTick, 2 \* 60 \* 1000\)/);
  assert.match(main, /autoBackupTimer = setInterval\(autoBackupTick, 30 \* 60 \* 1000\)/);
});

test('Settings requires confirmation and explains every destructive boundary', async () => {
  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /data-testid="toggle-backup-cleanup"/);
  assert.match(settings, /data-testid="backup-cleanup-preview"/);
  assert.match(settings, /data-testid="confirm-backup-cleanup-enable"/);
  assert.match(settings, /data-testid="confirm-backup-cleanup-now"/);
  assert.match(settings, /Siempre se conservan al menos las tres copias normales más recientes/);
  assert.match(settings, /snapshots pre-update nunca entran en esta limpieza/);
  assert.match(settings, /Solo se eliminan definitivamente después de siete días/);
  assert.match(settings, /ya cumplió\/cumplieron siete días en la papelera de seguridad/);
  assert.match(settings, /Si Nodus estaba cerrado, la limpieza pendiente se ejecuta al volver a abrirlo/);
  assert.match(settings, /disabled=\{backupCleanupRunning \|\| settings\.backupCleanupEnabled\}/, 'retention cannot change behind an armed policy');
});

test('cleanup implementation is scoped, verified, quarantined and rollback-aware', async () => {
  const source = await read('electron/export/autoBackup.ts');
  assert.match(source, /export async function previewBackupCleanup/, 'cloud-backed folder reads do not block Electron');
  assert.match(source, /await fs\.promises\.readdir\(folder/, 'directory enumeration runs through asynchronous fs');
  assert.match(source, /entry\.isFile\(\)/, 'only direct regular files are considered');
  assert.match(source, /parseBackupFile\(hostname, entry\.name\)/, 'filenames must belong to the current host lineage');
  assert.match(source, /KEEP_ACTIVE_DURING_CLEANUP = 3/);
  assert.match(source, /await verifyBackupFileInUtility\(survivor\.path, password\)/, 'verification stays out of the Electron main event loop');
  assert.match(source, /CLEANUP_TRASH_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /fs\.renameSync\(candidate\.path, destination\)/, 'first phase is a recoverable move');
  assert.match(source, /for \(const item of \[\.\.\.moved\]\.reverse\(\)\)/, 'partial moves are rolled back');
  assert.match(source, /stat\.mtimeMs !== candidate\.modifiedAt/, 'a changed candidate is refused before moving');
  assert.match(source, /stat\.mtimeMs !== item\.modifiedAt/, 'a changed quarantine entry is refused before permanent deletion');
  assert.match(source, /preview\.scopeToken !== expectedScopeToken/, 'the confirmed preview must still match the execution scope');
  assert.match(source, /fs\.unlinkSync\(item\.path\)/, 'only aged quarantine entries reach permanent deletion');
});
