// Exam paper builder (teaching vault): pure model, repo CRUD on a real vault DB,
// document rendering and .docx export.
//
// Runs under Electron's node (`ELECTRON_RUN_AS_NODE=1`) because better-sqlite3 is built
// against Electron's ABI. The PDF path is NOT covered here — it needs a real
// BrowserWindow, so it is exercised by `scripts/verify-exam-export.mjs` and in the app.
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

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-teaching-exams-test')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-teaching-exams-'));
installRuntimeHooks(root);

const exams = require(path.join(repoRoot, 'electron/db/teachingExamsRepo.ts'));
const model = require(path.join(repoRoot, 'shared/teachingExams.ts'));
const { renderExamHtml } = require(path.join(repoRoot, 'shared/examHtml.ts'));
const { examDocxBytes, imagePixelSize, fitImage } = require(path.join(repoRoot, 'electron/export/examExport.ts'));
const logos = require(path.join(repoRoot, 'electron/db/teachingLogosRepo.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

// 1x1 PNG, enough to prove image embedding and intrinsic-size parsing.
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.after(async () => {
  closeDb();
  await rm(root, { recursive: true, force: true });
});

test('the exam tables, logo library, language lock and sections ship in schema v85', () => {
  assert.ok(SCHEMA_VERSION >= 85, `expected schema v85 or later, got ${SCHEMA_VERSION}`);
});

test('section statements group their sub-questions and number them 1, 1.1, 1.2', () => {
  const q = (id, type, points, parentId = null, position = 0) => ({
    id, type, points, parentId, position, prompt: id, options: [], pairs: [], items: [],
    imageDataUrl: null, imageCaption: '', answerLines: null, solution: '',
  });
  // A standalone question, then a section with two sub-questions, then another
  // standalone — the case a flat "everything after this header" marker cannot express.
  const list = [
    q('a', 'short_essay', 2, null, 0),
    q('s', 'section', 0, null, 1),
    q('s1', 'multiple_choice', 0.5, 's', 2),
    q('s2', 'true_false', 1.5, 's', 3),
    q('b', 'definition', 1, null, 4),
  ];
  const blocks = model.groupExamQuestions(list);
  assert.deepEqual(blocks.map((block) => block.number), ['1', '2', '3']);
  assert.equal(blocks[0].section, null);
  assert.equal(blocks[1].section.id, 's');
  assert.deepEqual(blocks[1].questions.map((entry) => entry.number), ['2.1', '2.2']);
  assert.equal(blocks[1].points, 2, 'the exercise is worth the sum of its parts');
  assert.equal(blocks[2].questions[0].number, '3', 'a standalone question can follow a section');

  // The statement itself must never add to the paper's total.
  assert.equal(model.examTotalPoints(list), 5);
  assert.deepEqual(model.flattenExamBlocks(blocks).map((entry) => entry.number), ['1', '2.1', '2.2', '3']);

  // A sub-question whose section vanished is promoted, never dropped.
  const orphaned = model.groupExamQuestions([q('x', 'short_answer', 1, 'gone', 0)]);
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0].questions[0].number, '1');
});

test('an exercise mark splits across its sub-questions in quarter points', () => {
  assert.deepEqual(model.distributeSectionPoints(5, 3), [1.75, 1.75, 1.5]);
  assert.deepEqual(model.distributeSectionPoints(2, 4), [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(model.distributeSectionPoints(0, 2), [0, 0]);
  assert.deepEqual(model.distributeSectionPoints(3, 0), []);
  for (const [total, count] of [[5, 3], [7, 4], [10, 6], [1, 3]]) {
    const shares = model.distributeSectionPoints(total, count);
    assert.equal(shares.length, count);
    // The split must be exact: a paper whose parts do not add up to the exercise is wrong.
    assert.equal(Math.round(shares.reduce((sum, value) => sum + value, 0) * 100) / 100, total);
  }
});

test('repo: sections nest, cascade on delete, and survive duplication', () => {
  const exam = exams.createTeachingExam({ title: 'Comentario de texto', language: 'es' });
  const section = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('section'), prompt: 'Lee el siguiente texto.' });
  const sub1 = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('short_answer'), prompt: 'Tema.', parentId: section.id });
  const sub2 = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('short_essay'), prompt: 'Comenta.', parentId: section.id });
  const loose = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('definition'), prompt: 'Define.' });
  assert.equal(exams.getTeachingExam(exam.id).questions.find((q) => q.id === sub1.id).parentId, section.id);

  // Sections do not nest, and a sub-question cannot adopt a non-section parent.
  const nested = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('section'), parentId: section.id });
  assert.equal(nested.parentId, null, 'a section never hangs from another section');
  const bogus = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('true_false'), parentId: loose.id });
  assert.equal(bogus.parentId, null, 'only a section can be a parent');

  // Duplication must remap parent ids, never point at the original exam's rows.
  const copy = exams.duplicateTeachingExam(exam.id);
  const copiedSection = copy.questions.find((q) => q.type === 'section' && q.prompt === 'Lee el siguiente texto.');
  const copiedSubs = copy.questions.filter((q) => q.parentId);
  assert.equal(copiedSubs.length, 2);
  for (const child of copiedSubs) {
    assert.equal(child.parentId, copiedSection.id, 'sub-questions follow their copied statement');
    assert.notEqual(child.parentId, section.id, 'parent ids never leak across exams');
  }
  assert.deepEqual(
    model.groupExamQuestions(copy.questions).map((block) => block.number),
    model.groupExamQuestions(exams.getTeachingExam(exam.id).questions).map((block) => block.number),
    'the copy keeps the original arrangement'
  );

  // Deleting the statement takes the questions that only made sense underneath it.
  exams.deleteTeachingExamQuestion(section.id);
  const after = exams.getTeachingExam(exam.id);
  assert.ok(!after.questions.some((q) => q.id === sub1.id || q.id === sub2.id), 'sub-questions cascade');
  assert.ok(after.questions.some((q) => q.id === loose.id), 'unrelated questions stay');
});

test('a section prints as one numbered exercise in the paper and the key', () => {
  const exam = exams.createTeachingExam({ title: 'Prueba', language: 'es' });
  const section = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('section'), prompt: 'Observa el mapa adjunto.' });
  exams.addTeachingExamQuestion(exam.id, {
    ...model.defaultExamQuestion('multiple_choice'), prompt: '¿Qué región es?', parentId: section.id,
    options: [{ id: 'O1', text: 'Norte', correct: true }, { id: 'O2', text: 'Sur', correct: false }],
  });
  exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('short_answer'), prompt: 'Justifica.', parentId: section.id, solution: 'Por el relieve.' });
  const detail = exams.getTeachingExam(exam.id);

  const html = renderExamHtml(detail, detail.questions, { content: 'examWithKey' });
  assert.match(html, /Observa el mapa adjunto/);
  assert.match(html, /class="exercise"/, 'the statement wraps its sub-questions');
  assert.match(html, /1\.1/, 'sub-questions are numbered under their exercise');
  // The key answers the sub-questions under the same numbers, and never the statement.
  assert.match(html, /Pregunta 1\.1<\/strong>/);
  assert.match(html, /Pregunta 1\.2<\/strong>/);
  assert.doesNotMatch(html, /Pregunta 1<\/strong>/, 'a statement has no answer of its own');

  exams.deleteTeachingExam(exam.id);
});

test('validateExam rejects a statement with nothing hanging from it', () => {
  const exam = exams.createTeachingExam({ title: 'Vacía', language: 'es', subjectId: null });
  const section = exams.addTeachingExamQuestion(exam.id, { ...model.defaultExamQuestion('section'), prompt: 'Texto sin preguntas.' });
  const detail = exams.getTeachingExam(exam.id);
  const issues = model.validateExam(detail, detail.questions);
  assert.ok(issues.some((issue) => issue.field === 'section' && issue.questionId === section.id));
  // The statement must not be flagged for lacking points — it never has any.
  assert.ok(!issues.some((issue) => issue.field === 'points' && issue.questionId === section.id));
  exams.deleteTeachingExam(exam.id);
});

test('every question type has a coherent definition', () => {
  assert.equal(model.EXAM_QUESTION_TYPES.length, model.EXAM_QUESTION_TYPE_DEFS.length);
  for (const type of model.EXAM_QUESTION_TYPES) {
    const def = model.examQuestionTypeDef(type);
    assert.equal(def.id, type);
    assert.ok(def.label && def.description && def.icon, `${type} needs label/description/icon`);
    assert.ok(def.answerLines >= 0, `${type} needs sane layout defaults`);
    // A section statement is the one entry worth nothing: its mark is its children's sum.
    assert.ok(def.isSection ? def.defaultPoints === 0 : def.defaultPoints > 0, `${type} points default`);
    // The shape flags drive both the editor and the printed layout; a multiple choice
    // without an option count would render an empty list.
    if (def.needsOptions) assert.ok(def.defaultOptionCount >= 2, `${type} needs defaultOptionCount`);
  }
  assert.equal(model.examQuestionTypeDef('nope').id, 'short_essay', 'unknown types fall back');
  // The three essay lengths must actually differ in printed space, or the type is pointless.
  const lines = ['short_essay', 'medium_essay', 'long_essay'].map((t) => model.examQuestionTypeDef(t).answerLines);
  assert.ok(lines[0] < lines[1] && lines[1] < lines[2], `essay lengths must grow, got ${lines}`);
});

test('defaults, option resizing and points arithmetic', () => {
  const mc = model.defaultExamQuestion('multiple_choice');
  assert.equal(mc.options.length, 4);
  assert.equal(mc.options.filter((o) => o.correct).length, 1, 'exactly one option starts correct');

  const grown = model.resizeExamOptions(mc.options, 6);
  assert.equal(grown.length, 6);
  const shrunk = model.resizeExamOptions(grown, 2);
  assert.equal(shrunk.length, 2);
  assert.equal(model.resizeExamOptions(mc.options, 99).length, 10, 'clamped to 10');
  assert.equal(model.resizeExamOptions(mc.options, 0).length, 2, 'clamped to 2');
  // Dropping the correct option must not leave a question with no answer key.
  const noneCorrect = model.resizeExamOptions([{ id: 'O1', text: 'a', correct: false }, { id: 'O2', text: 'b', correct: false }], 2);
  assert.equal(noneCorrect.filter((o) => o.correct).length, 1);

  assert.equal(model.examTotalPoints([{ points: 0.25 }, { points: 0.5 }, { points: 2 }]), 2.75);
  assert.equal(model.examTotalPoints([{ points: 0.1 }, { points: 0.2 }]), 0.3, 'no float drift');
  assert.equal(model.examAnswerLines({ type: 'long_essay', answerLines: null }), 24);
  assert.equal(model.examAnswerLines({ type: 'long_essay', answerLines: 3 }), 3, 'override wins');
});

test('moveExamQuestion reorders without losing ids', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(model.moveExamQuestion(ids, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(model.moveExamQuestion(ids, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(model.moveExamQuestion(ids, 0, -5), ['a', 'b', 'c', 'd'], 'clamped at the top');
  assert.deepEqual(model.moveExamQuestion(ids, 0, 99), ['b', 'c', 'd', 'a'], 'clamped at the bottom');
  assert.deepEqual(model.moveExamQuestion(ids, 9, 0), ids, 'out-of-range index is a no-op');
});

test('document labels exist for every exam language', () => {
  for (const language of model.EXAM_LANGUAGES) {
    const labels = model.examDocumentLabels(language);
    for (const key of ['studentName', 'group', 'date', 'grade', 'points', 'instructions', 'question', 'answerKey', 'trueLabel', 'falseLabel', 'columnA', 'columnB']) {
      assert.ok(labels[key]?.trim(), `${language}.${key} must be translated`);
    }
  }
  // The document language is independent from the interface language.
  assert.equal(model.examDocumentLabels('en').studentName, 'Name and surname');
  assert.equal(model.examDocumentLabels('de').grade, 'Note');
  assert.equal(model.examDocumentLabels('nope').studentName, model.examDocumentLabels('es').studentName, 'unknown falls back to Spanish');
  assert.match(model.formatExamPoints(1.5, 'es'), /1,5 puntos/);
  assert.match(model.formatExamPoints(1.5, 'en'), /1\.5 points/);
  assert.match(model.formatExamPoints(2, 'en'), /^2 points$/);
  // Exactly one point takes the singular in every language; anything else is plural.
  assert.equal(model.formatExamPoints(1, 'es'), '1 punto');
  assert.equal(model.formatExamPoints(1, 'en'), '1 point');
  assert.equal(model.formatExamPoints(1, 'de'), '1 Punkt');
  assert.equal(model.formatExamPoints(1, 'pt'), '1 ponto');
  assert.equal(model.formatExamPoints(0.5, 'es'), '0,5 puntos');
  assert.equal(model.formatExamPoints(3, 'de'), '3 Punkte');
  for (const language of model.EXAM_LANGUAGES) {
    assert.ok(model.examDocumentLabels(language).point?.trim(), `${language} needs a singular point label`);
  }
});

test('validateExam blocks every way an exam could print wrong', () => {
  const exam = { id: 'E', subjectId: null, language: 'es' };
  assert.ok(model.validateExam(exam, []).some((i) => i.field === 'subject'));
  assert.ok(model.validateExam(exam, []).some((i) => i.field === 'count'));

  const base = { id: 'Q', prompt: 'x', points: 1, options: [], pairs: [], items: [], imageDataUrl: null };
  const withSubject = { ...exam, subjectId: 'S' };
  const issue = (question, field) => model.validateExam(withSubject, [question]).some((i) => i.field === field);

  assert.ok(issue({ ...base, type: 'short_essay', prompt: '   ' }, 'prompt'), 'blank prompt');
  assert.ok(issue({ ...base, type: 'short_essay', points: -1 }, 'points'), 'negative points');
  assert.ok(issue({ ...base, type: 'multiple_choice', options: [{ id: 'O1', text: 'only', correct: true }] }, 'options'), 'needs 2 options');
  assert.ok(issue({ ...base, type: 'matching', pairs: [{ id: 'P1', left: 'a', right: '' }] }, 'pairs'), 'needs 2 full pairs');
  assert.ok(issue({ ...base, type: 'ordering', items: ['one'] }, 'items'), 'needs 2 items');
  assert.ok(issue({ ...base, type: 'image_comment' }, 'image'), 'image comment needs an image');

  const valid = { ...base, type: 'multiple_choice', options: [{ id: 'O1', text: 'a', correct: true }, { id: 'O2', text: 'b', correct: false }] };
  assert.deepEqual(model.validateExam(withSubject, [valid]), [], 'a complete question raises nothing');
});

test('repo: create, edit, reorder and delete an exam end to end', () => {
  const created = exams.createTeachingExam({ title: 'Parcial de Historia', language: 'es', targetQuestionCount: 5 });
  assert.match(created.shortId, /^EXM-/);
  assert.equal(created.questions.length, 0);
  assert.equal(created.header.showStudentName, true, 'header defaults are materialised');

  const q1 = exams.addTeachingExamQuestion(created.id, { ...model.defaultExamQuestion('short_essay'), prompt: 'Explica la Revolución Industrial.' });
  const q2 = exams.addTeachingExamQuestion(created.id, { ...model.defaultExamQuestion('multiple_choice'), prompt: '¿Qué año?' });
  const q3 = exams.addTeachingExamQuestion(created.id, { ...model.defaultExamQuestion('image_comment'), prompt: 'Comenta la imagen.', imageDataUrl: PNG_1X1 });
  assert.match(q1.shortId, /^EXQ-/);
  assert.deepEqual([q1.position, q2.position, q3.position], [0, 1, 2]);

  // The header is merged, so one panel's patch cannot wipe another's fields.
  const renamed = exams.updateTeachingExam(created.id, { header: { teachers: 'J. Pérez' } });
  assert.equal(renamed.header.teachers, 'J. Pérez');
  assert.equal(renamed.header.showStudentName, true, 'untouched header fields survive a partial patch');

  const reordered = exams.reorderTeachingExamQuestions(created.id, [q3.id, q1.id, q2.id]);
  assert.deepEqual(reordered.map((q) => q.id), [q3.id, q1.id, q2.id]);
  assert.deepEqual(reordered.map((q) => q.position), [0, 1, 2]);

  exams.updateTeachingExamQuestion(q2.id, { points: 2.5, options: model.resizeExamOptions(q2.options, 3) });
  const afterEdit = exams.getTeachingExam(created.id);
  assert.equal(afterEdit.questions.find((q) => q.id === q2.id).points, 2.5);
  assert.equal(afterEdit.questions.find((q) => q.id === q2.id).options.length, 3);
  assert.equal(afterEdit.questions.find((q) => q.id === q3.id).imageDataUrl, PNG_1X1, 'image survives the round trip');

  const copy = exams.duplicateTeachingExam(created.id);
  assert.equal(copy.questions.length, 3, 'duplicate copies the questions');
  assert.notEqual(copy.id, created.id);

  exams.deleteTeachingExamQuestion(q1.id);
  const afterDelete = exams.getTeachingExam(created.id);
  assert.equal(afterDelete.questions.length, 2);
  assert.deepEqual(afterDelete.questions.map((q) => q.position), [0, 1], 'positions are reindexed after a delete');

  exams.deleteTeachingExam(created.id);
  assert.ok(!exams.listTeachingExams().some((e) => e.id === created.id), 'deleted exams leave the list');
  assert.throws(() => exams.getTeachingExam('missing-id'), /no encontrado/i);
});

test('the exam language follows the interface until the teacher picks one', () => {
  const free = { language: 'es', languageLocked: false };
  // Unlocked: whatever the interface currently is.
  assert.equal(model.effectiveExamLanguage(free, 'en'), 'en');
  assert.equal(model.effectiveExamLanguage(free, 'fr'), 'fr');
  assert.equal(model.effectiveExamLanguage(free, 'tr'), 'tr');
  assert.equal(model.effectiveExamLanguage(free, 'nonsense'), 'es', 'an unknown interface locale falls back');
  // Locked: the teacher's choice wins no matter what the interface says.
  const locked = { language: 'de', languageLocked: true };
  assert.equal(model.effectiveExamLanguage(locked, 'en'), 'de');
  assert.equal(model.effectiveExamLanguage(locked, 'pt'), 'de');
});

test('repo: the language choice is stored per exam and survives duplication', () => {
  const free = exams.createTeachingExam({ title: 'Sin idioma fijado' });
  assert.equal(free.languageLocked, false, 'a new exam follows the interface');
  const locked = exams.updateTeachingExam(free.id, { language: 'fr', languageLocked: true });
  assert.equal(locked.languageLocked, true);
  assert.equal(locked.language, 'fr');
  assert.equal(exams.duplicateTeachingExam(locked.id).languageLocked, true, 'the copy keeps the choice');
  // And it can be released again.
  assert.equal(exams.updateTeachingExam(free.id, { languageLocked: false }).languageLocked, false);
});

test('the three download variants contain the right parts', () => {
  const exam = {
    id: 'E', shortId: 'X', title: 'Prueba', subjectId: 'S', courseId: null, language: 'es', languageLocked: true,
    targetQuestionCount: 2, logos: [], createdAt: '', updatedAt: '', header: model.defaultExamHeader({}),
  };
  const questions = [{
    id: 'q1', shortId: 's', examId: 'E', position: 0, type: 'multiple_choice', prompt: 'ENUNCIADO DE LA PREGUNTA',
    points: 1, options: [{ id: 'O1', text: 'RESPUESTA BUENA', correct: true }, { id: 'O2', text: 'RESPUESTA MALA', correct: false }],
    pairs: [], items: [], imageDataUrl: null, imageCaption: '', answerLines: null, solution: 'JUSTIFICACION',
    aiPrompt: '', generatedBy: 'manual', createdAt: '', updatedAt: '',
  }];

  const paper = renderExamHtml(exam, questions, { content: 'exam' });
  assert.ok(paper.includes('ENUNCIADO DE LA PREGUNTA'), 'the paper must carry the question');
  assert.ok(!paper.includes('Solucionario'), 'the student copy must never leak the key');
  assert.ok(!paper.includes('JUSTIFICACION'));

  const both = renderExamHtml(exam, questions, { content: 'examWithKey' });
  assert.ok(both.includes('ENUNCIADO DE LA PREGUNTA') && both.includes('Solucionario') && both.includes('JUSTIFICACION'));
  assert.ok(both.includes('Nombre y apellidos'), 'the paper half keeps the student fields');
  assert.ok(both.includes('a) RESPUESTA BUENA'), 'the key names the correct option');

  const keyOnly = renderExamHtml(exam, questions, { content: 'keyOnly' });
  assert.ok(keyOnly.includes('Solucionario') && keyOnly.includes('JUSTIFICACION'));
  assert.ok(!keyOnly.includes('class="lines"'), 'the key alone needs no answer lines');
  assert.ok(!keyOnly.includes('Nombre y apellidos'), 'the key is the marker copy, not the student one');
  assert.ok(keyOnly.includes('standalone'), 'a lone key must not open with a blank page');

  // The legacy flag still maps onto the new modes.
  assert.equal(model.examExportContent({ includeAnswerKey: true }), 'examWithKey');
  assert.equal(model.examExportContent({ includeAnswerKey: false }), 'exam');
  assert.equal(model.examExportContent(undefined), 'exam');
  assert.equal(model.examExportContent({ content: 'keyOnly' }), 'keyOnly');
});

test('logo library: import downscales, stores and can be reused or removed', async () => {
  // A 3000x2000 PNG is what a phone photo or a big letterhead actually looks like.
  const { createCanvas } = require('@napi-rs/canvas');
  const big = createCanvas(3000, 2000);
  const context = big.getContext('2d');
  context.fillStyle = '#ea580c';
  context.fillRect(0, 0, 3000, 2000);
  const source = path.join(root, 'logo-grande.png');
  fs.writeFileSync(source, big.toBuffer('image/png'));

  const imported = await logos.importLogoFromFile(source);
  assert.equal(imported.name, 'logo-grande.png');
  assert.match(imported.dataUrl, /^data:image\/png;base64,/);
  const bytes = Buffer.from(imported.dataUrl.split(',')[1], 'base64');
  const size = imagePixelSize(bytes);
  assert.equal(Math.max(size.width, size.height), model.LOGO_MAX_EDGE, 'downscaled to the logo edge');
  // Pixel sizes are integers, so the ratio lands within a rounding step of the original.
  assert.ok(Math.abs(size.width / size.height - 3000 / 2000) < 0.01, `aspect ratio drifted: ${size.width}x${size.height}`);
  // The whole point: what gets embedded in every export is small.
  assert.ok(bytes.length < 120_000, `expected a small logo, got ${bytes.length} bytes`);

  const saved = logos.addTeachingLogo(imported.name, imported.dataUrl);
  assert.match(saved.shortId, /^LGO-/);
  assert.ok(logos.listTeachingLogos().some((entry) => entry.id === saved.id), 'it joins the library for reuse');
  logos.deleteTeachingLogo(saved.id);
  assert.ok(!logos.listTeachingLogos().some((entry) => entry.id === saved.id));

  await assert.rejects(() => logos.importLogoFromFile(path.join(root, 'no-existe.png')));
});

test('repo: exams can be filtered by subject', () => {
  // Real subjects: subject_id is a foreign key, so the exam is genuinely tied to the
  // study organisation rather than holding a dangling string.
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const course = org.createStudyCourse({ name: 'Historia' });
  const one = org.createStudySubject({ courseId: course.id, name: 'Contemporánea' });
  const two = org.createStudySubject({ courseId: course.id, name: 'Medieval' });

  const a = exams.createTeachingExam({ title: 'A', subjectId: one.id });
  const b = exams.createTeachingExam({ title: 'B', subjectId: two.id });
  const scoped = exams.listTeachingExams({ subjectId: one.id }).map((e) => e.id);
  assert.ok(scoped.includes(a.id));
  assert.ok(!scoped.includes(b.id));

  assert.throws(() => exams.createTeachingExam({ title: 'C', subjectId: 'does-not-exist' }), /FOREIGN KEY/i,
    'a dangling subject id is rejected by the schema');
});

test('renderExamHtml lays out every question type and escapes user text', () => {
  const exam = {
    id: 'E', shortId: 'EXM-1', title: 'Examen', subjectId: 'S', courseId: null, language: 'en',
    targetQuestionCount: 6, createdAt: '', updatedAt: '',
    logos: [{ dataUrl: PNG_1X1, name: 'logo.png' }],
    header: model.defaultExamHeader({ institution: 'IES Nodus', teachers: 'A. Docente', examTitle: 'Midterm', durationMinutes: 60, instructions: 'Read carefully.' }),
  };
  const q = (over) => ({ id: 'q', shortId: 's', examId: 'E', points: 1, options: [], pairs: [], items: [], imageDataUrl: null, imageCaption: '', answerLines: null, solution: '', aiPrompt: '', generatedBy: 'manual', createdAt: '', updatedAt: '', ...over });
  const questions = [
    q({ id: 'q1', position: 0, type: 'short_essay', prompt: 'Explain <b>this</b> & that' }),
    q({ id: 'q2', position: 1, type: 'multiple_choice', prompt: 'Pick one', options: [{ id: 'O1', text: 'First', correct: true }, { id: 'O2', text: 'Second', correct: false }] }),
    q({ id: 'q3', position: 2, type: 'true_false', prompt: 'The sky is green', options: [{ id: 'O1', text: 'Verdadero', correct: false }, { id: 'O2', text: 'Falso', correct: true }] }),
    q({ id: 'q4', position: 3, type: 'matching', prompt: 'Match', pairs: [{ id: 'P1', left: 'Left1', right: 'Right1' }, { id: 'P2', left: 'Left2', right: 'Right2' }] }),
    q({ id: 'q5', position: 4, type: 'ordering', prompt: 'Order', items: ['Alpha', 'Beta'] }),
    q({ id: 'q6', position: 5, type: 'image_comment', prompt: 'Comment', imageDataUrl: PNG_1X1, imageCaption: 'Fig. 1' }),
  ];
  const html = renderExamHtml(exam, questions);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /lang="en"/);
  assert.match(html, /IES Nodus/);
  assert.match(html, /Midterm/);
  // English document labels, regardless of the interface language.
  assert.match(html, /Name and surname/);
  assert.match(html, /Instructions/);
  assert.match(html, /Duration: 60 minutes/);
  // Numbering is positional, not stored.
  assert.match(html, /<span class="q-num">1\.<\/span>/);
  assert.match(html, /<span class="q-num">6\.<\/span>/);
  // Markup in a teacher's prompt must never become real markup.
  assert.match(html, /Explain &lt;b&gt;this&lt;\/b&gt; &amp; that/);
  assert.doesNotMatch(html, /<b>this<\/b>/);
  // Per-type layout.
  assert.match(html, /class="options"/);
  assert.match(html, /a\)<\/span> First/);
  assert.match(html, /True/); assert.match(html, /False/);
  assert.match(html, /Column A/); assert.match(html, /Column B/);
  assert.match(html, /class="ordering"/);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /Fig\. 1/);
  assert.match(html, /class="line"/, 'essays print ruled answer lines');
  // The answer key is opt-in and must not leak the correct option otherwise.
  assert.doesNotMatch(html, /Answer key/);
  const withKey = renderExamHtml(exam, questions, { includeAnswerKey: true });
  assert.match(withKey, /Answer key/);
  assert.match(withKey, /a\) First/);
});

test('renderExamHtml honours the document language, not the interface', () => {
  const base = { id: 'E', shortId: 'X', title: 'T', subjectId: 'S', courseId: null, targetQuestionCount: 1, logos: [], createdAt: '', updatedAt: '', header: model.defaultExamHeader({}) };
  assert.match(renderExamHtml({ ...base, language: 'de' }, []), /Name und Nachname/);
  assert.match(renderExamHtml({ ...base, language: 'fr' }, []), /Nom et prénom/);
  assert.match(renderExamHtml({ ...base, language: 'pt-BR' }, []), /Nome e sobrenome/);
});

test('image intrinsic size and aspect-ratio fitting', () => {
  const png = Buffer.from(PNG_1X1.split(',')[1], 'base64');
  assert.deepEqual(imagePixelSize(png), { width: 1, height: 1 });
  assert.equal(imagePixelSize(Buffer.from('not an image')), null);
  assert.deepEqual(fitImage({ width: 400, height: 200 }, 200, 200), { width: 200, height: 100 }, 'landscape fits by width');
  assert.deepEqual(fitImage({ width: 200, height: 400 }, 200, 200), { width: 100, height: 200 }, 'portrait fits by height');
  assert.deepEqual(fitImage({ width: 50, height: 50 }, 200, 200), { width: 50, height: 50 }, 'never upscales');
  assert.deepEqual(fitImage(null, 120, 60), { width: 120, height: 60 }, 'unknown size uses the box');
});

test('exports a real .docx carrying the questions', async () => {
  const exam = {
    id: 'E', shortId: 'EXM-2', title: 'Prueba', subjectId: 'S', courseId: null, language: 'es',
    targetQuestionCount: 2, createdAt: '', updatedAt: '',
    logos: [{ dataUrl: PNG_1X1, name: 'logo.png' }],
    header: model.defaultExamHeader({ institution: 'IES Nodus', teachers: 'A. Docente', instructions: 'Lee con atención.' }),
  };
  const q = (over) => ({ id: 'q', shortId: 's', examId: 'E', points: 1, options: [], pairs: [], items: [], imageDataUrl: null, imageCaption: '', answerLines: null, solution: 'Modelo', aiPrompt: '', generatedBy: 'manual', createdAt: '', updatedAt: '', ...over });
  const questions = [
    q({ id: 'q1', position: 0, type: 'short_essay', prompt: 'Enunciado de desarrollo' }),
    q({ id: 'q2', position: 1, type: 'multiple_choice', prompt: 'Pregunta tipo test', options: [{ id: 'O1', text: 'Correcta', correct: true }, { id: 'O2', text: 'Incorrecta', correct: false }] }),
    q({ id: 'q3', position: 2, type: 'image_comment', prompt: 'Comenta', imageDataUrl: PNG_1X1, imageCaption: 'Lámina' }),
  ];

  const bytes = await examDocxBytes(exam, questions, { includeAnswerKey: true });
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 5000, `expected a real docx, got ${bytes?.length} bytes`);
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', '.docx must be a zip');

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(bytes);
  const names = zip.getEntries().map((entry) => entry.entryName);
  assert.ok(names.includes('word/document.xml'), 'missing word/document.xml');
  assert.ok(names.some((name) => name.startsWith('word/media/')), 'the logo and figure must be embedded as media');

  const xml = zip.readAsText('word/document.xml');
  assert.ok(xml.includes('Enunciado de desarrollo'), 'question text missing');
  assert.ok(xml.includes('Pregunta tipo test'), 'question text missing');
  assert.ok(xml.includes('IES Nodus'), 'header institution missing');
  assert.ok(xml.includes('Lee con atención.'), 'instructions missing');
  assert.ok(xml.includes('Nombre y apellidos'), 'Spanish student field missing');
  assert.ok(xml.includes('Solucionario'), 'answer key section missing');
  assert.ok(xml.includes('Correcta'), 'answer key must name the right option');
});

test('a docx in English uses English document labels', async () => {
  const exam = {
    id: 'E', shortId: 'EXM-3', title: 'Test', subjectId: 'S', courseId: null, language: 'en',
    targetQuestionCount: 1, logos: [], createdAt: '', updatedAt: '', header: model.defaultExamHeader({}),
  };
  const bytes = await examDocxBytes(exam, [], {});
  const xml = new (require('adm-zip'))(bytes).readAsText('word/document.xml');
  assert.ok(xml.includes('Name and surname'), 'English label expected');
  assert.ok(!xml.includes('Nombre y apellidos'), 'Spanish label must not leak');
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
