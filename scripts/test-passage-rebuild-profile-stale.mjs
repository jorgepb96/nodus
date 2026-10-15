import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A passage rebuild that re-extracts the source moves the chunk boundaries, and passage
// ids are positional (`<work>#<chunk>`). The current document profile's supports point
// at those ids, so after such a rebuild they name different text. The profile must stop
// reading as current; an identical rebuild must leave it alone.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-passage-rebuild-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-passage-rebuild-profile-stale.mjs'), '--electron-passage-rebuild-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-passage-rebuild-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
try {
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const passages = require(path.join(repoRoot, 'electron/db/passagesRepo.ts'));
  closeDb = database.closeDb;
  const db = database.getDb();
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO works (nodus_id,zotero_key,title,authors_json,archived,resolved_text_hash)
    VALUES ('w','Z','Libro','[]',0,'h1')`).run();
  const row = (text, page) => ({ text, pageLabel: `p. ${page}`, sourceRef: null, pageNumber: page, embedding: null });
  passages.replaceWorkPassages('w', 'h1', [row('primer pasaje', 1), row('segundo pasaje', 2)]);
  db.prepare(`INSERT INTO document_profile_state (nodus_id,current_version_id,status,updated_at)
    VALUES ('w','v1','current',?)`).run(now);
  const state = () => db.prepare('SELECT status,stale_reason FROM document_profile_state WHERE nodus_id=?').get('w');

  passages.replaceWorkPassages('w', 'h1', [row('primer pasaje', 1), row('segundo pasaje', 2)]);
  assert.deepEqual({ ...state() }, { status: 'current', stale_reason: null }, 'an identical rebuild keeps the profile current');

  // Re-extraction lost a few characters: the boundaries move and w#1 now names other text.
  passages.replaceWorkPassages('w', 'h2', [row('primer pasaje segundo', 1), row('pasaje', 2)]);
  assert.deepEqual({ ...state() }, { status: 'stale', stale_reason: 'passages_changed' },
    'a rebuild that moves the passages under the profile marks it stale');
  console.log('ok passage rebuild marks the document profile stale');
} finally {
  try { closeDb(); } catch {}
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
      dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href)), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
