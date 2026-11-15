// Quick-start recovery: the first run prepares the recovery folder without asking.
//
// The Global Library lives inside the recovery folder, so a newcomer could not import
// one document until they had chosen a folder and a master password. This proves the
// path that removes that wall: a default folder, generated credentials kept in the
// protected store, a verified first snapshot, and a "credentials pending" flag that
// lasts exactly until the user holds a credential of their own. It also proves the two
// things a silent setup must never do: adopt (or hide) an earlier Nodus folder, and
// write into a folder that already holds someone's files.
//
// Runs the real vault/database/export/recovery modules in an isolated Electron-as-Node
// profile, like test-recovery-folder.mjs.
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

if (!process.argv.includes('--electron-recovery-quick-start-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-recovery-quick-start.mjs'), '--electron-recovery-quick-start-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-quick-start-userdata-'));
const home = await mkdtemp(path.join(os.tmpdir(), 'nodus-quick-start-home-'));
const base = path.join(home, 'Nodus');
process.env.NODUS_DEFAULT_RECOVERY_FOLDER = base;
installRuntimeHooks(userData);

try {
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { updateSettings, getSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const recovery = require(path.join(repoRoot, 'electron/recovery/recoveryManager.ts'));

  assert.deepEqual(recovery.defaultRecoveryFolderCandidates().slice(0, 2), [base, `${base} 2`],
    'the default location is tried first, then numbered siblings');
  const before = await recovery.getRecoveryStatus();
  assert.equal(before.needsSetup, true);
  assert.equal(before.credentialsPending, false, 'nothing is pending before a quick start');

  // ── A first run: folder, credentials and a verified snapshot, with no questions ──
  const started = await recovery.initializeDefaultRecoveryFolder('9.9.9-test', 'en');
  assert.equal(started.ok, true, started.message);
  assert.equal(started.folder, base);
  assert.equal(started.recoveryKey, undefined, 'no screen shows the key, so it is never returned');
  assert.ok(started.snapshot?.path && fs.existsSync(started.snapshot.path), 'a verified first snapshot exists');
  assert.equal(getSettings().autoBackupFolder, base);
  assert.ok(secrets.getBackupPassword()?.length >= 20, 'a generated master password is kept in the protected store');
  assert.ok(secrets.getBackupRecoveryKey(), 'and so is the independent recovery key');

  const status = await recovery.getRecoveryStatus();
  assert.equal(status.needsSetup, false, 'the Library has its folder: imports can start');
  assert.equal(status.credentialsPending, true, 'the user holds no credential yet');
  assert.ok(Date.parse(status.quickStartAt) <= Date.now());

  // ── Idempotent: a second call never makes a second folder ──
  const again = await recovery.initializeDefaultRecoveryFolder('9.9.9-test', 'en');
  assert.equal(again.ok, true);
  assert.equal(again.folder, base);
  assert.equal(fs.existsSync(`${base} 2`), false);

  // ── The reminder ends when the user holds a credential ──
  recovery.clearQuickStartMarker();
  assert.equal((await recovery.getRecoveryStatus()).credentialsPending, false);

  // ── Someone coming back: the default folder already holds a Nodus recovery ──
  updateSettings({ recoverySetupVersion: 0, autoBackupFolder: '' });
  const returning = await recovery.initializeDefaultRecoveryFolder('9.9.9-test', 'en');
  assert.equal(returning.ok, false, 'an earlier recovery folder is never adopted or silently bypassed');
  assert.equal(returning.existingRecoveryFolder, base);
  assert.equal((await recovery.getRecoveryStatus()).needsSetup, true, 'the wizard still owes the decision');
  assert.equal(fs.existsSync(`${base} 2`), false, 'and nothing was created beside it');

  // Once the wizard has shown it and the user chose to start fresh, a sibling is used.
  const beside = await recovery.initializeDefaultRecoveryFolder('9.9.9-test', 'en', true);
  assert.equal(beside.ok, true, beside.message);
  assert.equal(beside.folder, `${base} 2`);
  assert.equal((await recovery.getRecoveryStatus()).credentialsPending, true);
  assert.equal(recovery.inspectRecoveryFolder(base).kind, 'recovery', 'the earlier folder is left exactly as it was');

  // ── A folder holding someone's files is skipped, never written into ──
  updateSettings({ recoverySetupVersion: 0, autoBackupFolder: '' });
  recovery.clearQuickStartMarker();
  const occupied = path.join(home, 'Occupied');
  fs.mkdirSync(occupied, { recursive: true });
  fs.writeFileSync(path.join(occupied, 'thesis.docx'), 'not ours');
  process.env.NODUS_DEFAULT_RECOVERY_FOLDER = occupied;
  const skipped = await recovery.initializeDefaultRecoveryFolder('9.9.9-test', 'en');
  assert.equal(skipped.ok, true, skipped.message);
  assert.equal(skipped.folder, `${occupied} 2`);
  assert.deepEqual(fs.readdirSync(occupied), ['thesis.docx'], 'the occupied folder is untouched');

  // ── A typed master password also ends the reminder (the wizard's own path) ──
  updateSettings({ recoverySetupVersion: 0, autoBackupFolder: '' });
  const chosen = path.join(home, 'Chosen');
  fs.mkdirSync(chosen);
  assert.equal((await recovery.getRecoveryStatus()).credentialsPending, false, 'pending follows the folder in use');
  const wizard = await recovery.initializeRecoveryFolder(chosen, 'clave-maestra-segura', '9.9.9-test', 'en');
  assert.equal(wizard.ok, true, wizard.message);
  assert.equal((await recovery.getRecoveryStatus()).credentialsPending, false);

  closeDb();
  console.log('Recovery quick start: default folder, generated credentials, pending flag, returning users and occupied folders passed.');
} finally {
  await Promise.all([userData, home].map((dir) => rm(dir, { recursive: true, force: true })));
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
