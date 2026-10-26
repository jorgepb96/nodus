// Study vault phase 14: real SQLite demo seeding and surgical cleanup.
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
if (!process.argv.includes('--electron-study-demo-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-demo.mjs'), '--electron-study-demo-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-demo-'));
installRuntimeHooks(root);
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/studyDemoData.ts'));
  const generalDemo = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const learning = require(path.join(repoRoot, 'electron/db/studyLearningRepo.ts'));
  const knowledge = require(path.join(repoRoot, 'electron/db/studyKnowledgeRepo.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const active = vaults.getActiveVault();
  vaults.setVaultType(active.id, 'estudio');
  settings.updateSettings({ studyTourComplete: true });
  const userCourse = org.createStudyCourse({ name: 'Curso del usuario' });
  assert.equal(demo.seedStudyDemoData(), true, 'a study vault can add the isolated sample workspace alongside user data');
  assert.equal(demo.seedStudyDemoData(), false, 'seeding is idempotent and never duplicates the sample data');

  const workspace = org.getStudyWorkspace();
  assert.equal(workspace.courses.length, 2);
  assert.equal(workspace.subjects.length, 2);
  assert.equal(workspace.topics.length, 2);
  assert.equal(workspace.documents.length, 2);
  assert.ok(workspace.placements.every((placement) => placement.documentId.startsWith('demo-study-')));
  assert.equal(questions.listStudyQuestions().length, 1);
  assert.equal(learning.listStudyFlashcards().length, 1);
  assert.equal(learning.getStudyPlanner().plans.length, 1);
  assert.equal(learning.getStudyPlanner().blocks.length, 1);
  assert.equal(learning.getStudyProgressDashboard().dueCards, 1);
  const cellIdeas = knowledge.listStudyIdeas('demo-study-subject-cell');
  const ecologyIdeas = knowledge.listStudyIdeas('demo-study-subject-ecology');
  assert.equal(cellIdeas.length, 4, 'sample cellular biology includes a useful placeholder idea map');
  assert.equal(ecologyIdeas.length, 3, 'sample ecology includes a useful placeholder idea map');
  assert.equal(knowledge.getStudyKnowledgeGraph('demo-study-subject-cell').edges.length, 3, 'cell placeholders include explicit conceptual connections');
  assert.equal(knowledge.getStudyKnowledgeGraph('demo-study-subject-ecology').edges.length, 2, 'ecology placeholders include explicit conceptual connections');
  assert.ok(knowledge.getStudyIdeaDetail(cellIdeas[0].id).evidence.length > 0, 'placeholder ideas remain grounded in sample notes');
  assert.equal(settings.getSettings().demoMode, true);
  assert.equal(settings.getSettings().studyTourComplete, true, 'loading the demo preserves the tutorial decision');
  assert.equal(generalDemo.hasAnyData(), true, 'study content participates in the global presence check');
  assert.deepEqual(getDb().pragma('foreign_key_check'), [], 'sample hierarchy satisfies every foreign key');

  // A user-owned row present before the sample must survive demo cleanup.
  generalDemo.clearDemoData();
  const remaining = org.getStudyWorkspace({ includeArchived: true, includeDeleted: true });
  assert.deepEqual(remaining.courses.map((course) => course.id), [userCourse.id]);
  assert.equal(remaining.documents.length, 0);
  assert.equal(questions.listStudyQuestions({ archived: true }).length, 0);
  assert.equal(learning.listStudyFlashcards({ includeArchived: true }).length, 0);
  assert.equal(learning.getStudyPlanner().plans.length, 0);
  assert.equal(knowledge.listStudyIdeas('demo-study-subject-cell').length, 0, 'sample knowledge is removed with its subject');
  assert.equal(settings.getSettings().demoMode, false);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  closeDb();
  console.log('Study demo phase 14 tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      // Preserve the real module URL for createRequire in this CommonJS harness.
      transformers: { before: [(context) => {
        const visit = (node) => {
          if (ts.isPropertyAccessExpression(node) && node.name.text === 'url'
            && ts.isMetaProperty(node.expression)
            && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
            && node.expression.name.text === 'meta') {
            return ts.factory.createStringLiteral(pathToFileURL(filename).href);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (root) => ts.visitNode(root, visit);
      }] },
      fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
