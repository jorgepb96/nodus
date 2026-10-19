// Recovery-root integration: exercises the real vault/database/export/recovery
// modules in an isolated Electron-as-Node profile. It proves empty-folder
// enforcement, verified initial snapshot, auxiliary-file coverage, safe restore,
// wrong-password non-mutation and preservation of a pre-restore escape hatch.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-recovery-folder-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-recovery-folder.mjs'), '--electron-recovery-folder-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-userdata-'));
const recoveryRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-root-'));
const invalidRoot = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-invalid-'));
installRuntimeHooks(userData);

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const recovery = require(path.join(repoRoot, 'electron/recovery/recoveryManager.ts'));
  const recoveryProbe = require(path.join(repoRoot, 'electron/recovery/recoveryFolderProbe.ts'));

  fs.writeFileSync(path.join(invalidRoot, 'unrelated.txt'), 'do not overwrite');
  assert.equal(recovery.inspectRecoveryFolder(recoveryRoot).kind, 'empty');
  assert.match(recovery.inspectRecoveryFolder(recoveryRoot, 'en').message, /Empty folder/, 'folder inspection follows UI language');
  assert.match(recovery.inspectRecoveryFolder(recoveryRoot, 'it').message, /Cartella vuota/, 'Italian recovery never falls back to English');
  assert.match(recovery.inspectRecoveryFolder(recoveryRoot, 'tr').message, /Boş klasör/, 'Turkish recovery never falls back to English');
  assert.equal(recovery.inspectRecoveryFolder(invalidRoot).kind, 'invalid', 'non-empty unrelated folder rejected');

  const shortPassword = await recovery.initializeRecoveryFolder(recoveryRoot, 'short', '9.9.9-test', 'en');
  assert.equal(shortPassword.ok, false, 'a short master password is rejected by the authoritative backend');
  assert.match(shortPassword.message, /at least 8 characters/i);
  assert.equal(recovery.inspectRecoveryFolder(recoveryRoot).kind, 'empty',
    'invalid credentials cannot write a manifest or partially initialize recovery');

  const active = vaults.getActiveVault();
  const alice = entities.createPerson({ displayName: 'Alice protegida' });
  const vaultDir = path.dirname(active.path);
  fs.writeFileSync(path.join(userData, 'nodi-chat-history.json'), JSON.stringify([{ text: 'historial global' }]));
  fs.writeFileSync(path.join(vaultDir, 'study-chat-history.json'), JSON.stringify([{ text: 'historial estudio' }]));
  fs.mkdirSync(path.join(vaultDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'audio', 'voz.wav'), Buffer.from('WAVE-DATA'));

  const initialized = await recovery.initializeRecoveryFolder(recoveryRoot, 'clave-maestra-segura', '9.9.9-test');
  assert.equal(initialized.ok, true, initialized.message);
  assert.ok(initialized.recoveryKey && initialized.recoveryKey !== 'clave-maestra-segura', 'independent recovery key returned once');
  assert.ok(initialized.snapshot?.path && fs.existsSync(initialized.snapshot.path), 'verified initial snapshot exists');
  assert.ok(fs.existsSync(path.join(recoveryRoot, recoveryProbe.RECOVERY_SNAPSHOT_INDEX_FILE)), 'verified backup writes the startup-safe sidecar index');
  assert.deepEqual(
    recoveryProbe.probeRecoveryFolder(recoveryRoot, 'cached').snapshots.map((snapshot) => snapshot.fileName),
    [initialized.snapshot.fileName],
    'cached startup status discovers the verified snapshot without reopening its archive',
  );
  assert.equal(recovery.inspectRecoveryFolder(recoveryRoot).kind, 'recovery');
  assert.equal((await recovery.getRecoveryStatus()).needsSetup, false, 'setup gate committed only after first verified snapshot');
  assert.equal((await recovery.getRecoveryStatus()).hasRecoveryKey, true, 'recovery-key availability is exposed without revealing it');

  entities.deletePerson(alice.personId);
  fs.writeFileSync(path.join(userData, 'nodi-chat-history.json'), '[]');
  fs.rmSync(path.join(vaultDir, 'study-chat-history.json'), { force: true });
  fs.rmSync(path.join(vaultDir, 'audio'), { recursive: true, force: true });

  const rejectedProgress = [];
  const wrong = await recovery.restoreRecoverySnapshot(
    recoveryRoot,
    initialized.snapshot.fileName,
    'contraseña-errónea',
    '9.9.9-test',
    'es',
    (progress) => rejectedProgress.push(progress),
  );
  assert.equal(wrong.ok, false, 'wrong password is rejected');
  assert.equal(entities.getPerson(alice.personId), null, 'wrong password does not mutate live data');
  assert.ok(rejectedProgress.some((progress) => progress.phase === 'decrypting'), 'rejected restore reports real decryption work');
  assert.ok(!rejectedProgress.some((progress) => progress.phase === 'complete'), 'rejected restore never reports completion');

  const restoreProgress = [];
  const restored = await recovery.restoreRecoverySnapshot(
    recoveryRoot,
    initialized.snapshot.fileName,
    initialized.recoveryKey,
    '9.9.9-test',
    'en',
    (progress) => restoreProgress.push(progress),
  );
  assert.equal(restored.ok, true, restored.message);
  assert.match(restored.message, /recovery key/i, 'recovery flow reports which independent credential succeeded in English');
  assert.ok(entities.getPerson(alice.personId), 'vault database restored');
  assert.match(fs.readFileSync(path.join(userData, 'nodi-chat-history.json'), 'utf8'), /historial global/, 'global history restored');
  assert.match(fs.readFileSync(path.join(vaultDir, 'study-chat-history.json'), 'utf8'), /historial estudio/, 'vault history restored');
  assert.equal(fs.readFileSync(path.join(vaultDir, 'audio', 'voz.wav'), 'utf8'), 'WAVE-DATA', 'generated media restored');
  const safetyFiles = fs.readdirSync(path.join(userData, 'restore-safety')).filter((name) => name.endsWith('.nodus'));
  assert.equal(safetyFiles.length, 1, 'successful restore retains a pre-restore encrypted safety snapshot');
  assert.deepEqual(
    [...new Set(restoreProgress.map((progress) => progress.phase))],
    ['preparing', 'decrypting', 'verifying', 'restoring', 'finalizing', 'complete'],
    'restore exposes every user-visible phase in order',
  );
  assert.ok(
    restoreProgress.every((progress, index) => index === 0 || progress.progress >= restoreProgress[index - 1].progress),
    'overall restore progress is monotonic',
  );
  for (const phase of ['decrypting', 'verifying', 'restoring']) {
    const byteEvents = restoreProgress.filter((progress) => progress.phase === phase && progress.totalBytes > 0);
    assert.ok(byteEvents.length > 0, `${phase} reports byte-backed progress`);
    assert.ok(byteEvents.every((progress) => progress.completedBytes <= progress.totalBytes), `${phase} never exceeds its byte total`);
    assert.equal(byteEvents.at(-1).completedBytes, byteEvents.at(-1).totalBytes, `${phase} reaches its real byte total`);
  }
  for (const phase of ['preparing', 'finalizing', 'complete']) {
    const milestones = restoreProgress.filter((progress) => progress.phase === phase);
    assert.ok(milestones.every((progress) => progress.completedBytes === 0 && progress.totalBytes === 0), `${phase} does not invent byte counters`);
  }
  assert.equal(restoreProgress.at(-1).progress, 1, 'successful restore reaches 100%');

  // ── Backup health must state the truth, not the last happy status ───────────
  // Every one of these used to be invisible: a broken schedule left `lastAutoBackupAt`
  // frozen on the last success, so the UI kept reporting "ok" while nothing was being
  // written. That is the failure a backup system cannot afford.
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  assert.equal((await recovery.getRecoveryStatus()).health.level, 'ok', 'a working setup reads as healthy');

  settingsRepo.updateSettings({ lastAutoBackupStatus: 'error: no se pudo leer la contraseña maestra' });
  const failedHealth = (await recovery.getRecoveryStatus()).health;
  assert.equal(failedHealth.code, 'last-run-failed', 'a failed run is surfaced');
  assert.equal(failedHealth.level, 'critical', 'and it is critical, not a footnote');

  settingsRepo.updateSettings({ lastAutoBackupStatus: 'ok: copia verificada' });
  settingsRepo.updateSettings({ lastAutoBackupAt: new Date(Date.now() - 40 * 86400e3).toISOString() });
  const staleHealth = (await recovery.getRecoveryStatus()).health;
  assert.equal(staleHealth.code, 'stale', 'a long gap since the last snapshot is surfaced');
  assert.equal(staleHealth.daysSinceLastBackup, 40, 'the age is reported so the user can judge it');

  settingsRepo.updateSettings({ lastAutoBackupAt: new Date().toISOString() });
  fs.rmSync(path.join(recoveryRoot, 'nodus-recovery.json'), { force: true });
  assert.equal(
    (await recovery.getRecoveryStatus()).health.code,
    'folder-unreachable',
    'an unusable destination outranks a successful last run'
  );

  settingsRepo.updateSettings({ autoBackupEnabled: false });
  assert.equal((await recovery.getRecoveryStatus()).health.code, 'disabled', 'no protection at all is reported as critical');
  assert.equal((await recovery.getRecoveryStatus()).health.level, 'critical');

  closeDb();
  console.log('Recovery folder integration test passed!');
} finally {
  await Promise.all([
    rm(userData, { recursive: true, force: true }),
    rm(recoveryRoot, { recursive: true, force: true }),
    rm(invalidRoot, { recursive: true, force: true }),
  ]);
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: (name) => name === 'temp' ? os.tmpdir() : userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
