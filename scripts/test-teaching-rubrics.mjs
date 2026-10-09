// Rubric builder (teaching vault): pure model, the quality checks that are the point
// of the feature, repo CRUD on a real vault DB, document rendering and .docx export.
// PDF needs a real BrowserWindow, so it lives in scripts/verify-rubric-pdf.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-teaching-rubrics-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-rubrics-'));
installRuntimeHooks(root);

const model = require(path.join(repoRoot, 'shared/teachingRubrics.ts'));
const { renderRubricHtml } = require(path.join(repoRoot, 'shared/rubricHtml.ts'));
const repo = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));
const { rubricDocxBytes } = require(path.join(repoRoot, 'electron/export/rubricExport.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

test.after(async () => {
  closeDb();
  await rm(root, { recursive: true, force: true });
});

/** Build a rubric object without touching the database. */
function rubricOf(over = {}) {
  const base = model.defaultRubric('es', 5);
  return {
    id: 'R', shortId: 'RUB-1', title: 'Rúbrica', description: '', subjectId: 'S', courseId: null,
    createdAt: '', updatedAt: '', ...base, ...over,
  };
}
const cellsFor = (levels, texts) => Object.fromEntries(levels.map((level, index) => [level.id, texts[index] ?? '']));

test('the rubric table ships in schema v83', () => {
  assert.ok(SCHEMA_VERSION >= 83, `expected schema v83 or later, got ${SCHEMA_VERSION}`);
});

test('every level preset is complete, ordered best-first and sized 3-5', () => {
  for (const preset of model.RUBRIC_LEVEL_PRESETS) {
    assert.ok(preset.label.trim(), `${preset.id} needs a label`);
    for (const language of model.RUBRIC_LANGUAGES) {
      const labels = preset.levels[language];
      assert.ok(Array.isArray(labels) && labels.length >= 3 && labels.length <= 5, `${preset.id}.${language} must have 3-5 levels`);
      assert.ok(labels.every((label) => label.trim()), `${preset.id}.${language} has a blank level`);
      // Every language must describe the SAME number of levels, or switching language
      // would silently add or drop a column.
      assert.equal(labels.length, preset.levels.es.length, `${preset.id}.${language} level count differs from Spanish`);
    }
  }
  // Four levels is the default: an even count denies raters a neutral middle to fall into.
  assert.equal(model.rubricLevelPreset('achievement4').levels.es.length, 4);
  assert.equal(model.rubricLevelPreset('nope').id, 'achievement4', 'unknown preset falls back');
});

test('level scores spread across the scale, best first, floor at zero', () => {
  assert.deepEqual(model.distributeLevelScores(4, 5), [5, 3.33, 1.67, 0]);
  assert.deepEqual(model.distributeLevelScores(3, 10), [10, 5, 0]);
  assert.deepEqual(model.distributeLevelScores(2, 4), [4, 0]);
  assert.equal(model.distributeLevelScores(99, 5).length, model.MAX_RUBRIC_LEVELS, 'clamped');
  const levels = model.buildRubricLevels('competence3', 'en', 10);
  assert.deepEqual(levels.map((level) => level.label), ['Achieved', 'In progress', 'Not achieved']);
  assert.deepEqual(levels.map((level) => level.score), [10, 5, 0]);
});

test('weights: equalise totals exactly 100 despite rounding', () => {
  for (const count of [1, 2, 3, 6, 7, 9]) {
    const criteria = Array.from({ length: count }, (_, index) => model.emptyRubricCriterion(`C${index}`));
    const balanced = model.equaliseRubricWeights(criteria);
    assert.equal(model.rubricWeightTotal(balanced), 100, `${count} criteria must still total 100`);
  }
});

test('max score follows the weighting model', () => {
  const rubric = rubricOf();
  // Unweighted: best level once per criterion.
  assert.equal(model.rubricMaxScore({ ...rubric, weighted: false }), 5 * rubric.criteria.length);
  // Weighted: normalised to the scale itself.
  assert.equal(model.rubricMaxScore({ ...rubric, weighted: true }), 5);
  const weighted = { ...rubric, weighted: true, criteria: model.equaliseRubricWeights(rubric.criteria) };
  assert.equal(model.criterionMaxPoints(weighted, weighted.criteria[0]), Math.round((5 * weighted.criteria[0].weight) / 100 * 100) / 100);
});

test('rubricToMarkdown renders the grid the AI is given as context', () => {
  const rubric = rubricOf();
  rubric.title = 'Ensayo';
  rubric.criteria = [{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(rubric.levels, ['Clara', 'Correcta', '', 'Ausente']) }];
  const markdown = model.rubricToMarkdown(rubric);
  assert.match(markdown, /^# Ensayo/m);
  assert.match(markdown, /\| Criterio \|/);
  assert.match(markdown, /Excelente \(5\)/, 'level headers carry their score');
  assert.match(markdown, /\| Tesis \| Clara \| Correcta \| — \| Ausente \|/, 'empty cells show as a gap, not vanish');
  // A pipe inside a descriptor must not break the table it is embedded in.
  const piped = model.rubricToMarkdown({ ...rubric, criteria: [{ ...rubric.criteria[0], name: 'A | B' }] });
  assert.ok(piped.includes('A \\| B'));
});

test('validateRubric blocks the structural errors', () => {
  const ok = rubricOf({ criteria: [{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: {} }] });
  const errors = (rubric) => model.validateRubric(rubric).filter((issue) => issue.severity === 'error').map((issue) => issue.message);
  assert.ok(errors({ ...ok, title: '  ' }).some((m) => /título/i.test(m)));
  assert.ok(errors({ ...ok, criteria: [] }).some((m) => /criterio/i.test(m)));
  assert.ok(errors({ ...ok, levels: ok.levels.slice(0, 1) }).some((m) => /niveles/i.test(m)));
  assert.ok(errors({ ...ok, criteria: [model.emptyRubricCriterion('C1', '')] }).some((m) => /nombre/i.test(m)));
});

test('quality checks catch the pitfalls that make a rubric unusable', () => {
  const rubric = rubricOf();
  const levels = rubric.levels;
  const warn = (criteria, over = {}) =>
    model.rubricQualityWarnings({ ...rubric, criteria, ...over }).map((issue) => issue.message).join(' | ');

  // A cell that only passes judgement gives the marker nothing observable.
  assert.match(
    warn([{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(levels, ['Excelente', '', '', '']) }]),
    /solo emite un juicio/
  );
  // Negative framing — the least-respected rule in real rubrics.
  assert.match(
    warn([{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(levels, ['No presenta tesis y no argumenta nada', '', '', '']) }]),
    /carencias/
  );
  // Adjacent levels differing only by adverbs is the flagship check.
  assert.match(
    warn([{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(levels, [
      'Identifica claramente la tesis principal del texto',
      'Identifica parcialmente la tesis principal del texto', '', '']) }]),
    /matices/
  );
  assert.match(
    warn([{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(levels, ['Misma frase', 'Misma frase', '', '']) }]),
    /repiten el mismo descriptor/
  );
  // Submission requirements are not qualities of the work.
  assert.match(warn([model.emptyRubricCriterion('C1', 'Número de páginas')]), /requisito de entrega/);
  // Two dimensions in one row cannot be scored with a single level.
  assert.match(warn([model.emptyRubricCriterion('C1', 'Gramática y organización')]), /junta dos aspectos/);
  // Scores must fall as performance falls.
  assert.match(
    warn([model.emptyRubricCriterion('C1', 'Tesis')], { levels: levels.map((level) => ({ ...level, score: 3 })) }),
    /no descienden/
  );
  // Oversized rubrics stop being applied in full.
  assert.match(
    warn(Array.from({ length: 8 }, (_, i) => model.emptyRubricCriterion(`C${i}`, `Criterio ${i}`))),
    /más de 6 criterios/i
  );

  // A well-formed row raises nothing.
  const clean = warn([{
    ...model.emptyRubricCriterion('C1', 'Uso de fuentes'),
    cells: cellsFor(levels, [
      'Integra cinco fuentes académicas y las cita con el formato acordado.',
      'Integra tres fuentes académicas con citas completas.',
      'Integra dos fuentes, con alguna cita incompleta.',
      'Reproduce una única fuente sin citarla.',
    ]),
  }]);
  assert.equal(clean, '', `expected no warnings, got: ${clean}`);
});

test('untouched preset columns follow the document language; renamed ones do not', () => {
  const es = model.buildRubricLevels('achievement4', 'es', 5);
  assert.equal(model.matchLevelPreset(es, 'es'), 'achievement4');
  // Matching is language-specific: Spanish labels are not an English preset.
  assert.equal(model.matchLevelPreset(es, 'en'), null);
  const en = model.buildRubricLevels('achievement4', 'en', 5);
  assert.equal(model.matchLevelPreset(en, 'en'), 'achievement4');
  // Once the teacher renames a column it is their text and must never be overwritten.
  const renamed = es.map((level, index) => (index === 0 ? { ...level, label: 'Mi nivel' } : level));
  assert.equal(model.matchLevelPreset(renamed, 'es'), null);
  // A different level count cannot match either.
  assert.equal(model.matchLevelPreset(es.slice(0, 3), 'es'), null);
});

test('repo: create, edit, set a cell, duplicate and delete', () => {
  const created = repo.createTeachingRubric({ title: 'Rúbrica de ensayo', language: 'es', scaleMax: 10 });
  assert.match(created.shortId, /^RUB-/);
  assert.equal(created.scaleMax, 10);
  assert.equal(created.levels.length, 4, 'a new rubric starts usable, not empty');
  assert.equal(created.criteria.length, 3);

  const renamed = repo.updateTeachingRubric(created.id, { title: 'Ensayo argumentativo', weighted: true });
  assert.equal(renamed.title, 'Ensayo argumentativo');
  assert.equal(renamed.weighted, true);
  assert.equal(renamed.levels.length, 4, 'an unrelated patch must not drop the grid');

  const criterionId = created.criteria[0].id;
  const levelId = created.levels[0].id;
  const withCell = repo.setTeachingRubricCell(created.id, criterionId, levelId, 'Defiende una tesis clara.');
  assert.equal(withCell.criteria[0].cells[levelId], 'Defiende una tesis clara.');
  // Writing one cell must not disturb its neighbours.
  assert.equal(Object.keys(withCell.criteria[1].cells).length, 0);

  const copy = repo.duplicateTeachingRubric(created.id);
  assert.notEqual(copy.id, created.id);
  assert.equal(copy.criteria[0].cells[levelId], 'Defiende una tesis clara.', 'the copy carries the descriptors');

  repo.deleteTeachingRubric(created.id);
  assert.ok(!repo.listTeachingRubrics().some((entry) => entry.id === created.id));
  assert.throws(() => repo.getTeachingRubric('missing'), /no encontrada/i);
});

test('repo: rubrics are linked to a subject and filterable by it', () => {
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const course = org.createStudyCourse({ name: 'Lengua' });
  const one = org.createStudySubject({ courseId: course.id, name: 'Literatura' });
  const two = org.createStudySubject({ courseId: course.id, name: 'Sintaxis' });

  const a = repo.createTeachingRubric({ title: 'A', subjectId: one.id, courseId: course.id });
  repo.createTeachingRubric({ title: 'B', subjectId: two.id, courseId: course.id });
  const scoped = repo.listTeachingRubrics({ subjectId: one.id });
  assert.deepEqual(scoped.map((entry) => entry.id), [a.id]);
  assert.equal(scoped[0].subjectId, one.id, 'the rubric keeps its subject link for retrieval');
  assert.throws(() => repo.createTeachingRubric({ title: 'C', subjectId: 'nope' }), /FOREIGN KEY/i);

  assert.equal(repo.listTeachingRubrics({ search: 'A' }).length >= 1, true);
});

test('renderRubricHtml prints the grid and escapes user text', () => {
  const rubric = rubricOf({ title: 'Ensayo <b>final</b>', language: 'en', weighted: true });
  rubric.criteria = [{ ...model.emptyRubricCriterion('C1', 'Thesis'), description: 'Clarity of the claim', weight: 50, cells: cellsFor(rubric.levels, ['Clear & sharp', 'Adequate', 'Vague', 'Absent']) }];
  const html = renderRubricHtml(rubric);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /lang="en"/);
  assert.match(html, /A4 landscape/, 'a rubric prints landscape');
  assert.match(html, /Criterion/, 'English document labels');
  assert.match(html, /Ensayo &lt;b&gt;final&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>final<\/b>/);
  assert.match(html, /Clear &amp; sharp/);
  assert.match(html, /Weight: 50%/);
  assert.match(html, /Total score/);
  // Document labels follow the rubric's own language, not the interface.
  assert.match(renderRubricHtml({ ...rubric, language: 'de' }), /Kriterium/);
  assert.match(renderRubricHtml({ ...rubric, language: 'fr' }), /Critère/);
});

test('exports a real .docx carrying the grid', async () => {
  const rubric = rubricOf({ title: 'Rúbrica de ensayo', description: 'Evalúa el ensayo final' });
  rubric.criteria = [{ ...model.emptyRubricCriterion('C1', 'Tesis'), cells: cellsFor(rubric.levels, ['Clara y original', 'Clara', 'Difusa', 'Sin tesis']) }];
  const bytes = await rubricDocxBytes(rubric, { includeScores: true, includeScoreColumn: true });
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 4000, `expected a real docx, got ${bytes?.length}`);
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
  const xml = new (require('adm-zip'))(bytes).readAsText('word/document.xml');
  assert.ok(xml.includes('Rúbrica de ensayo'), 'title missing');
  assert.ok(xml.includes('Tesis'), 'criterion missing');
  assert.ok(xml.includes('Clara y original'), 'descriptor missing');
  assert.ok(xml.includes('Excelente'), 'level header missing');
  assert.ok(xml.includes('Puntuación'), 'the marking column must be there');
  assert.ok(/landscape/i.test(xml), 'the rubric page must be landscape');
});

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
