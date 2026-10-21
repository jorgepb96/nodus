import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const require = createRequire(import.meta.url);
let forkUtility = () => { throw new Error('unexpected migration utility launch'); };
installRuntimeHooks(os.tmpdir(), { utilityProcess: { fork: (...args) => forkUtility(...args) } });

test('migration snapshot validation runs in a disposable utility process', () => {
  const ipc = source('electron/ipc.ts');
  const host = source('electron/db/migrationRecoveryUtilityHost.ts');
  const worker = source('electron/db/migrationRecoveryUtilityWorker.ts');
  const main = source('electron/main.ts');
  const database = source('electron/db/database.ts');
  const vite = source('vite.config.ts');

  assert.match(ipc, /listMigrationRecoverySnapshotsInUtility\(getActiveVault\(\)\.path\)/);
  assert.doesNotMatch(ipc, /listMigrationRecoverySnapshots\(getActiveVault\(\)\.path\)/);
  assert.match(ipc, /withMigrationRecoverySnapshotsInUtility\(source\.path/);
  assert.match(host, /utilityProcess\.fork\(file/);
  assert.match(host, /const listInFlight = new Map/, 'repeated opens coalesce instead of scanning the same vault twice');
  assert.match(host, /operationTail/, 'listing and retention share one serialized utility queue');
  assert.match(worker, /snapshots: listMigrationRecoverySnapshots\(request\.databasePath\)/);
  assert.match(worker, /pruneMigrationRecoverySnapshots\(databasePath\)/);
  assert.match(main, /scheduleMigrationRecoveryRetention\(listVaults\(\)\.map\(\(vault\) => vault\.path\)\)/);
  assert.match(database, /if \(migrationPending && process\.env\.NODUS_SUPPORT_INTERACTIVE !== '1'\) scheduleMigrationRecoveryRetention\(file\)/);
  assert.match(vite, /utilityBuild\('migrationRecoveryUtilityWorker'/);
});

test('repeated requests coalesce and the migration utility is reaped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-settings-utility-'));
  const workerFile = path.join(root, 'migrationRecoveryUtilityWorker.js');
  fs.writeFileSync(workerFile, '// existence sentinel');
  let forks = 0;
  let kills = 0;
  class FakeUtility extends EventEmitter {
    postMessage(request) {
      queueMicrotask(() => this.emit('message', { kind: 'list-done', id: request.id, snapshots: [] }));
    }
    kill() { kills += 1; return true; }
  }
  forkUtility = (file, args, options) => {
    forks += 1;
    assert.equal(file, workerFile);
    assert.deepEqual(args, []);
    assert.equal(options.serviceName, 'Nodus migration recovery validation');
    return new FakeUtility();
  };
  const previousWorker = process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
  const previousRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = workerFile;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const host = require(path.join(repoRoot, 'electron/db/migrationRecoveryUtilityHost.ts'));
    const databasePath = path.join(root, 'vault.sqlite');
    const [first, second] = await Promise.all([
      host.listMigrationRecoverySnapshotsInUtility(databasePath),
      host.listMigrationRecoverySnapshotsInUtility(databasePath),
    ]);
    assert.deepEqual(first, []);
    assert.deepEqual(second, []);
    assert.equal(forks, 1, 'one vault scan serves both callers');
    assert.equal(kills, 1, 'the one-shot child is killed after returning its result');
  } finally {
    if (previousWorker === undefined) delete process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
    else process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = previousWorker;
    if (previousRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previousRunAsNode;
    forkUtility = () => { throw new Error('unexpected migration utility launch'); };
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retention batches vaults and is serialized with Settings inspection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-retention-utility-'));
  const workerFile = path.join(root, 'migrationRecoveryUtilityWorker.js');
  fs.writeFileSync(workerFile, '// existence sentinel');
  const events = [];
  class FakeUtility extends EventEmitter {
    postMessage(request) {
      events.push(`start:${request.kind}`);
      const response = request.kind === 'prune'
        ? {
            kind: 'prune-done', id: request.id,
            reports: request.databasePaths.map((databasePath) => ({
              databasePath, retention: 2, discoveredSnapshots: 3, keptSnapshots: 2,
              removedSnapshots: 1, removedBytes: 1024, errors: [],
            })),
          }
        : { kind: 'list-done', id: request.id, snapshots: [] };
      setTimeout(() => {
        events.push(`finish:${request.kind}`);
        this.emit('message', response);
      }, request.kind === 'prune' ? 20 : 0);
    }
    kill() { return true; }
  }
  forkUtility = () => new FakeUtility();
  const previousWorker = process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
  const previousRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = workerFile;
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    const host = require(path.join(repoRoot, 'electron/db/migrationRecoveryUtilityHost.ts'));
    const firstVault = path.join(root, 'first.sqlite');
    const secondVault = path.join(root, 'second.sqlite');
    const prune = host.pruneMigrationRecoverySnapshotsInUtility([firstVault, secondVault, firstVault]);
    const list = host.listMigrationRecoverySnapshotsInUtility(firstVault);
    const [reports, snapshots] = await Promise.all([prune, list]);
    assert.equal(reports.length, 2, 'duplicate vault paths are pruned once');
    assert.deepEqual(snapshots, []);
    assert.deepEqual(events, ['start:prune', 'finish:prune', 'start:list', 'finish:list']);

    events.length = 0;
    const access = host.withMigrationRecoverySnapshotsInUtility(firstVault, async () => {
      events.push('access:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push('access:finish');
    });
    const queuedPrune = host.pruneMigrationRecoverySnapshotsInUtility([firstVault]);
    await Promise.all([access, queuedPrune]);
    assert.deepEqual(events, [
      'start:list', 'finish:list', 'access:start', 'access:finish',
      'start:prune', 'finish:prune',
    ], 'opening holds the utility queue until the validated snapshot has been consumed');
  } finally {
    if (previousWorker === undefined) delete process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE;
    else process.env.NODUS_MIGRATION_RECOVERY_UTILITY_FILE = previousWorker;
    if (previousRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previousRunAsNode;
    forkUtility = () => { throw new Error('unexpected migration utility launch'); };
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Settings starts expensive inspections only for the visible tab', () => {
  const settings = source('src/views/Settings.tsx');
  assert.match(settings, /if \(!dataTabRequested \|\| !activeVault\)/);
  assert.match(settings, /if \(!dataTabRequested \|\| !settings\.autoBackupFolder\)/);
  assert.match(settings, /if \(!integrationsTabRequested\) return;/);
  assert.match(settings, /if \(!serverTabRequested\) return;/);
});

test('backup-folder preview uses asynchronous filesystem calls', () => {
  const backup = source('electron/export/autoBackup.ts');
  const start = backup.indexOf('async function readCleanupContext');
  const end = backup.indexOf('function cleanupPreviewFromContext', start);
  const inspection = backup.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(inspection, /await fs\.promises\.lstat/);
  assert.match(inspection, /await fs\.promises\.readdir/);
  assert.doesNotMatch(inspection, /lstatSync|readdirSync|existsSync/);
  assert.match(inspection, /export async function previewBackupCleanup/);
});
