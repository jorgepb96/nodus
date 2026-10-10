// A deep scan runs the Documentary Index step too. When that step fails, the scan records
// deep_error = 'documentary_…' and freshness 'failed' while keeping the committed analysis.
// A later successful Documentary Index run must clear that error, or the work stays under
// "With errors" with nothing wrong. Only such an error is cleared, and only once a current
// profile was published after the failed attempt.
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
if (!process.argv.includes('--electron-documentary-stale-error-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-documentary-stale-deep-error.mjs'), '--electron-documentary-stale-error-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-documentary-stale-error-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
try {
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));
  const works = require(path.join(repoRoot, 'electron/db/worksRepo.ts'));
  closeDb = database.closeDb;
  const db = database.getDb();
  const addWork = (id) => db.prepare(`INSERT INTO works (
    nodus_id,zotero_key,title,authors_json,item_type,source_type,light_status,deep_status,deep_hash,summary_status,archived
  ) VALUES (?,?,?,'[]','book','pdf','done','done','hash-' || ?,'none',0)`).run(id, `Z-${id}`, `Obra ${id}`, id);
  const profile = (id, status, updatedAt) => db.prepare(
    'INSERT INTO document_profile_state (nodus_id,status,updated_at) VALUES (?,?,?)').run(id, status, updatedAt);
  const state = (id) => ({
    error: db.prepare('SELECT deep_error FROM works WHERE nodus_id=?').get(id).deep_error,
    freshness: db.prepare("SELECT freshness FROM library_analysis_freshness WHERE work_id=? AND component='deep'").get(id)?.freshness,
  });
  const later = () => new Date(Date.now() + 60_000).toISOString();

  // resolved: the Documentary Index step failed, then a later run published a current profile.
  for (const id of ['resolved', 'other-error', 'still-failing', 'single']) addWork(id);
  works.setDeepResult('resolved', 'failed', null, null, 'documentary_publication_superseded');
  profile('resolved', 'current', later());
  // other-error: a genuine deep-analysis failure is never cleared by an index run.
  works.setDeepResult('other-error', 'failed', null, null, 'El modelo devolvió un JSON inválido.');
  profile('other-error', 'current', later());
  // still-failing: the last profile predates the failed attempt, so the failure is live.
  profile('still-failing', 'current', '2000-01-01T00:00:00.000Z');
  works.setDeepResult('still-failing', 'failed', null, null, 'documentary_embedding_busy');
  // single: resolved, but only cleared when its own id is passed.
  works.setDeepResult('single', 'failed', null, null, 'documentary_job_already_claimed');
  profile('single', 'current', later());

  assert.equal(state('resolved').error, 'documentary_publication_superseded');
  assert.equal(state('resolved').freshness, 'failed');

  assert.equal(works.clearResolvedDocumentaryDeepErrors('resolved'), 1, 'a completed job clears its own work');
  assert.deepEqual(state('resolved'), { error: null, freshness: 'current' }, 'the resolved documentary failure is cleared');
  assert.equal(state('single').error, 'documentary_job_already_claimed', 'a single-work call touches only that work');

  assert.equal(works.clearResolvedDocumentaryDeepErrors(), 1, 'the start-up sweep clears the remaining resolved work');
  assert.deepEqual(state('single'), { error: null, freshness: 'current' });
  assert.equal(state('other-error').error, 'El modelo devolvió un JSON inválido.', 'a non-documentary deep failure stays visible');
  assert.equal(state('other-error').freshness, 'failed');
  assert.equal(state('still-failing').error, 'documentary_embedding_busy', 'a failure newer than the last profile stays visible');
  assert.equal(works.clearResolvedDocumentaryDeepErrors(), 0, 'the sweep is idempotent');

  // The queue calls it when a job completes and once per vault when it starts.
  const queue = fs.readFileSync(path.join(repoRoot, 'electron/pipeline/documentIndexQueue.ts'), 'utf8');
  assert.match(queue, /status: 'completed'[\s\S]{0,400}clearResolvedDocumentaryDeepErrors\(job\.nodusId\)/, 'a completed job clears its work');
  assert.match(queue, /recoverInterruptedDocumentJobs\(\);\s*clearResolvedDocumentaryDeepErrors\(\);/, 'the queue sweeps each vault at start-up');
  console.log('documentary stale deep error: ok');
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
