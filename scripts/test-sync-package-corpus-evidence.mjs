// The corpus `evidence` table must not travel in a .nodussync package.
//
// `evidence` holds the quotes the analysis attached to an idea (ideasRepo.addEvidence), keyed
// by the idea's `global_id`. Ideas themselves are corpus-derived and stay home, and their ids
// are a per-machine counter (nextGlobalId: g-0001, g-0002, ...). `evidence` was nonetheless
// listed in the genealogy group of syncTables.ts, so a package carried every quote, and the
// receiving machine filed them under ITS OWN idea with the same counter: an unrelated idea
// there gained quotes from works it never read. It also put tombstone triggers on a table
// every rescan rewrites (36,272 tombstones in four days on the owner's library).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-sync-corpus-evidence')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [fileURLToPath(import.meta.url), '--electron-sync-corpus-evidence'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-sync-corpus-evidence-'));
installRuntimeHooks(root);

try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { ensureTombstoneTriggers } = require(path.join(repoRoot, 'electron/db/tombstones.ts'));
  const { syncedTableNames } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  const sync = require(path.join(repoRoot, 'electron/export/syncPackage.ts'));

  const makeDb = (name) => {
    const db = new Database(path.join(root, name));
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    ensureTombstoneTriggers(db);
    return db;
  };
  const now = '2026-10-01T00:00:00.000Z';
  const idea = (db, globalId, label) => db
    .prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(globalId, 'claim', label, label, now);

  // Machine A: its first idea, with a quote from one of its works.
  const dbA = makeDb('a.sqlite');
  idea(dbA, 'g-0001', 'Idea de la máquina A');
  dbA.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ev-a-1', 'g-0001', 'work-a', 'Cita de una obra que solo existe en A', 'p. 3', 'quote');

  // Machine B: the same counter names a completely different idea.
  const dbB = makeDb('b.sqlite');
  idea(dbB, 'g-0001', 'Idea distinta de la máquina B');

  globalThis.__syncTestDb = dbA;
  const pkg = sync.buildSyncPackage('test', 'frase-de-prueba-evidencia');
  globalThis.__syncTestDb = dbB;
  sync.mergeSyncPackage(pkg.buffer, 'frase-de-prueba-evidencia');

  const misfiled = dbB.prepare("SELECT quote FROM evidence WHERE global_id = 'g-0001'").all();
  assert.deepEqual(misfiled, [], "machine A's quote was filed under machine B's unrelated idea g-0001");

  assert.equal(syncedTableNames(dbA).includes('evidence'), false, 'corpus evidence is listed as a synced table');

  // And a rescan's delete no longer writes a tombstone per row.
  dbA.prepare("DELETE FROM evidence WHERE id = 'ev-a-1'").run();
  assert.equal(dbA.prepare("SELECT COUNT(*) AS n FROM sync_tombstones WHERE table_name = 'evidence'").get().n, 0);

  dbA.close();
  dbB.close();
  console.log('ok - corpus evidence stays on the machine that derived it');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Same harness as test-sync-package.mjs: real modules, `db/database` pointed at a
 *  switchable connection so the package runs against migration-built schemas. */
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.js');
  fs.writeFileSync(
    databaseStub,
    "const { SCHEMA_VERSION } = require(" + JSON.stringify(path.join(repoRoot, 'electron/db/migrations.ts')) + ");\n" +
      'exports.getDb = () => globalThis.__syncTestDb;\n' +
      'exports.closeDb = () => {};\n' +
      'exports.SCHEMA_VERSION = SCHEMA_VERSION;\n'
  );
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
