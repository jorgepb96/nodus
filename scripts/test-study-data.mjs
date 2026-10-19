// Study vault phase 13: real SQLite storage diagnostics, maintenance, trash,
// blob accounting and safe diagnostic output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-data-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-data.mjs'), '--electron-study-data-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-data-'));
installRuntimeHooks(root);
try {
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const admin = require(path.join(repoRoot, 'electron/db/studyDataAdmin.ts'));
  const studyExport = require(path.join(repoRoot, 'electron/export/studyExport.ts'));
  const projectExport = require(path.join(repoRoot, 'electron/export/projectExport.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const course = org.createStudyCourse({ name: 'Historia' });
  const kept = org.createStudyDocument({ title: 'Tema conservado', contentMarkdown: '# Texto', placement: { courseId: course.id } });
  const trashed = org.createStudyDocument({ title: 'Borrador eliminado', contentMarkdown: 'Temporal', placement: { courseId: course.id } });
  const selected = require(path.join(repoRoot, 'electron/db/settingsRepo.ts')).getSettings();
  const fixtureVector = Buffer.from(new Float32Array([1, 0]).buffer);
  getDb().prepare('UPDATE study_docs SET embedding=?,embedding_provider=?,embedding_model=?,embedding_dim=2 WHERE id=?').run(fixtureVector, selected.embeddingProvider, selected.embeddingModel, kept.id);
  org.setStudyLifecycle('document', trashed.id, 'trash');

  const materialPath = path.join(root, 'fuente.txt');
  await writeFile(materialPath, 'Material verificable para el vault de estudio.');
  await materials.importStudyMaterialFile(materialPath, { courseId: course.id });
  recordings.createStudyRecording({ title: 'Clase', fileName: 'clase.wav', mimeType: 'audio/wav', bytes: Buffer.from('RIFF-TEST-AUDIO') });

  const overview = admin.getStudyDataOverview();
  assert.equal(overview.integrityOk, true);
  assert.deepEqual(overview.foreignKeyErrors, []);
  assert.equal(overview.schemaVersion, overview.expectedSchemaVersion);
  assert.ok(overview.studyRows >= 7, 'study rows are counted across tables');
  assert.ok(overview.materialBytes > 0, 'material blob bytes are measured');
  assert.ok(overview.recordingBytes > 0, 'recording blob bytes are measured');
  assert.equal(overview.embeddingBytes, fixtureVector.byteLength);
  assert.equal(overview.trashRows, 1);

  const cleared = admin.clearStudyEmbeddingCache();
  assert.equal(cleared.changedRows, 1);
  assert.equal(getDb().prepare('SELECT embedding FROM study_docs WHERE id = ?').get(kept.id).embedding, null);
  assert.equal(admin.rebuildStudyIndexes().ok, true);
  assert.equal(admin.repairStudyData().ok, true);

  const emptied = admin.emptyStudyTrash();
  assert.ok(emptied.changedRows >= 1);
  assert.equal(getDb().prepare('SELECT 1 FROM study_docs WHERE id = ?').get(trashed.id), undefined);
  assert.ok(getDb().prepare('SELECT 1 FROM study_docs WHERE id = ?').get(kept.id), 'non-trashed document remains');

  const diagnostic = admin.buildStudyDiagnostic();
  assert.equal(diagnostic.format, 'nodus-study-diagnostic');
  assert.ok(Array.isArray(diagnostic.tables));
  assert.doesNotMatch(JSON.stringify(diagnostic), /Material verificable|RIFF-TEST-AUDIO/, 'diagnostic contains counts, never user content');

  const rendered = studyExport.buildStudyExportMarkdown({ kind: 'workspace' });
  assert.match(rendered.markdown, /Tema conservado/);
  assert.doesNotMatch(rendered.markdown, /Borrador eliminado/, 'permanently deleted documents are not exported');
  const word = await projectExport.markdownToDocx(rendered.markdown);
  assert.ok(word.length > 1000, 'Word export is a real DOCX archive');
  const AdmZip = require('adm-zip');
  const bundle = new AdmZip(studyExport.buildStudyBundle({ kind: 'workspace' }));
  const manifest = JSON.parse(bundle.readAsText('_Nodus/manifest.json'));
  assert.equal(manifest.format, 'nodus-study-readonly');
  assert.equal(manifest.readOnly, true);
  assert.ok(bundle.getEntries().some((entry) => entry.entryName.startsWith('Historia/') && entry.entryName.endsWith('.md')), 'ZIP places notes inside their course hierarchy');
  assert.ok(bundle.getEntry('Historia/fuente.txt'), 'ZIP places original materials inside their course hierarchy');
  assert.ok(bundle.getEntry('_Sin-organizar/clase.wav'), 'ZIP keeps unassigned recordings in an explicit folder');
  closeDb();
  console.log('Study data administration phase 13 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
