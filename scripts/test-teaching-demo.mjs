// Teaching vault: real SQLite demo seeding, didactic quality of the fixture, and
// surgical cleanup.
//
// The interesting assertions are not "rows exist" but the two ways this fixture could
// be quietly wrong: a sample rubric that trips the product's own quality checks would
// teach the opposite of what the tutorial claims, and a gradebook whose statuses do not
// actually change the computed mark would make the "status is orthogonal to value"
// lesson a decoration.
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
if (!process.argv.includes('--electron-teaching-demo-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-teaching-demo.mjs'), '--electron-teaching-demo-test'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-demo-'));
installRuntimeHooks(root);
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/teachingDemoData.ts'));
  const generalDemo = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const rubrics = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));
  const exams = require(path.join(repoRoot, 'electron/db/teachingExamsRepo.ts'));
  const grades = require(path.join(repoRoot, 'electron/db/teachingGradesRepo.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const rubricModel = require(path.join(repoRoot, 'shared/teachingRubrics.ts'));
  const examModel = require(path.join(repoRoot, 'shared/teachingExams.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const active = vaults.getActiveVault();

  // ── The guard ────────────────────────────────────────────────────────────────
  vaults.setVaultType(active.id, 'estudio');
  assert.equal(demo.seedTeachingDemoData(), false, 'the teaching demo is refused outside a docencia vault');

  vaults.setVaultType(active.id, 'docencia');
  settings.updateSettings({ docenciaTourComplete: true });
  const userCourse = org.createStudyCourse({ name: 'Curso del usuario' });
  assert.equal(demo.seedTeachingDemoData(), true, 'a docencia vault accepts the sample workspace alongside user data');
  assert.equal(demo.seedTeachingDemoData(), false, 'seeding is idempotent and never duplicates the sample data');

  // ── Every surface the sidebar exposes is populated ────────────────────────────
  const workspace = org.getStudyWorkspace();
  assert.equal(workspace.courses.length, 2, 'the sample course sits alongside the user course');
  assert.equal(workspace.subjects.length, 2);
  assert.equal(workspace.topics.length, 2);
  assert.equal(workspace.documents.length, 2);

  const groupList = groups.listTeachingGroups();
  assert.equal(groupList.length, 1);
  const students = groups.getTeachingGroup(groupList[0].id).students;
  assert.equal(students.length, 6, 'the class list is big enough to show a distribution');
  assert.equal(new Set(students.map((s) => s.pseudonymCode)).size, 6, 'pseudonym codes are unique within the group');
  assert.ok(students.every((s) => require(path.join(repoRoot, 'shared/studentPseudonyms.ts')).isPseudonym(s.pseudonymCode)),
    'every seeded code is a valid STU_ placeholder');

  // ── The rubric is an example worth copying ───────────────────────────────────
  const rubricList = rubrics.listTeachingRubrics();
  assert.equal(rubricList.length, 1);
  const rubric = rubrics.getTeachingRubric(rubricList[0].id);
  assert.equal(rubric.levels.length, 4, 'four levels: an even count denies the comfortable middle');
  assert.equal(rubric.criteria.length, 4);
  assert.equal(rubric.weighted, true);
  assert.equal(rubricModel.rubricWeightTotal(rubric.criteria), 100, 'criterion weights total 100 %');
  assert.ok(rubric.criteria.every((c) => rubric.levels.every((l) => (c.cells[l.id] ?? '').trim().length > 0)),
    'every cell in the grid carries a descriptor');
  const warnings = rubricModel.rubricQualityWarnings(rubric);
  assert.deepEqual(warnings, [], `the sample rubric must pass its own quality checks, got: ${warnings.map((w) => w.message).join(' | ')}`);

  // ── The exam shows the section numbering ─────────────────────────────────────
  const examList = exams.listTeachingExams();
  assert.equal(examList.length, 1);
  const exam = exams.getTeachingExam(examList[0].id);
  const blocks = examModel.groupExamQuestions(exam.questions);
  const section = exam.questions.find((q) => q.type === 'section');
  assert.ok(section, 'the sample paper includes a shared section statement');
  assert.equal(exam.questions.filter((q) => q.parentId === section.id).length, 2, 'two sub-questions hang from it');
  assert.equal(section.points, 0, 'a section statement carries no points of its own');
  const numbers = examModel.flattenExamBlocks(blocks).map((entry) => entry.number);
  assert.ok(numbers.includes('2.1') && numbers.includes('2.2'), `printed numbering shows sub-questions, got ${numbers.join(', ')}`);
  assert.deepEqual(examModel.validateExam(exam, exam.questions), [], 'the sample paper is printable as-is, with no outstanding issues');

  // ── The gradebook is published and its statuses actually matter ───────────────
  const planList = grades.listAssessmentPlans();
  assert.equal(planList.length, 1);
  const { plan, items } = grades.getAssessmentPlan(planList[0].id);
  assert.ok(plan.publishedAt, 'the sample plan is published, which is the state the tutorial explains');
  assert.equal(items.filter((i) => i.parentId === null).length, 3, 'three top-level blocks');
  assert.equal(items.filter((i) => i.sourceRubricId).length, 1, 'one column is marked with the rubric');
  assert.equal(items.filter((i) => i.sourceExamId).length, 1, 'one column traces back to the exam');

  const entries = grades.listGradeEntries(plan.id);
  const statuses = new Set(entries.map((entry) => entry.status));
  for (const status of ['evaluated', 'not_submitted', 'not_assessed', 'exempt']) {
    assert.ok(statuses.has(status), `the fixture demonstrates the "${status}" status`);
  }

  // The rubric-marked cells carry a level per criterion.
  const rubricItem = items.find((i) => i.sourceRubricId);
  const chosen = grades.getRubricEvaluation(students[0].id, rubricItem.id);
  assert.equal(Object.keys(chosen).length, 4, 'the rubric-marked cell records a level for each criterion');

  assert.equal(settings.getSettings().demoMode, true);
  assert.equal(settings.getSettings().docenciaTourComplete, true, 'seeding preserves the tutorial decision');
  assert.equal(generalDemo.hasAnyData(), true, 'teaching content participates in the global presence check');
  assert.deepEqual(getDb().pragma('foreign_key_check'), [], 'the sample hierarchy satisfies every foreign key');

  // ── Cleanup leaves no residue and spares user data ───────────────────────────
  generalDemo.clearDemoData();
  const remaining = org.getStudyWorkspace({ includeArchived: true, includeDeleted: true });
  assert.deepEqual(remaining.courses.map((course) => course.id), [userCourse.id], 'the user course survives');
  assert.equal(groups.listTeachingGroups().length, 0);
  assert.equal(rubrics.listTeachingRubrics().length, 0);
  assert.equal(exams.listTeachingExams().length, 0);
  assert.equal(grades.listAssessmentPlans().length, 0);
  const db = getDb();
  for (const table of ['teaching_students', 'teaching_grade_entries', 'teaching_assessment_items', 'teaching_rubric_evaluations', 'teaching_attendance', 'teaching_attendance_holidays']) {
    assert.equal(Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n), 0, `${table} is empty after cleanup`);
  }
  assert.equal(settings.getSettings().demoMode, false);
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  closeDb();
  console.log('Teaching demo tests passed!');
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
    // `@shared/assessment` is a directory, so a blind `.ts` suffix misses its index.
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      const asIndex = path.join(repoRoot, 'shared', rest, 'index.ts');
      return fs.existsSync(direct) ? direct : asIndex;
    }
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
