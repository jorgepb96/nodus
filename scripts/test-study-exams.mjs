// Study vault phase 10c: written exams, weighted exercises, autosaved long-form
// responses, pending-manual-grading state, variants and printable solutions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-exams-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-exams.mjs'), '--electron-study-exams-test'], { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }); process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-exams-')); installRuntimeHooks(root);
try {
  const shared = require(path.join(repoRoot, 'shared/studyAssessments.ts'));
  const bank = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const assessments = require(path.join(repoRoot, 'electron/db/studyAssessmentsRepo.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const base = { status: 'approved', difficulty: 'hard', cognitiveLevel: 'analyze', explanation: 'Criterios derivados de la fuente.', source: { title: 'Tema de historia', excerpt: 'La industrialización transformó las relaciones de producción y la urbanización.' } };
  const essay = bank.createStudyQuestion({ ...base, prompt: 'Analiza dos consecuencias sociales de la industrialización.', type: 'essay', answer: { text: 'Debe relacionar urbanización, trabajo fabril y cambio social.' }, rubric: { concepts: ['urbanización', 'trabajo fabril'] } });
  const commentary = bank.createStudyQuestion({ ...base, prompt: 'Comenta críticamente el fragmento sobre relaciones de producción.', type: 'commentary', answer: { text: 'Debe contextualizar, argumentar y citar el fragmento.' } });
  const exam = assessments.createStudyAssessment({ kind: 'exam', title: 'Historia contemporánea', description: 'Responde con argumentos y evidencia.', durationMinutes: 90, questionIds: [essay.id, commentary.id], points: { [essay.id]: 6, [commentary.id]: 4 }, config: { correctionMode: 'end', selection: 'manual', randomizeQuestions: false, randomizeOptions: false, showExplanations: true, negativePoints: 0, blankPoints: 0 } });
  assert.equal(exam.kind, 'exam'); assert.equal(exam.items.reduce((sum, item) => sum + item.points, 0), 10);
  const attempt = assessments.startStudyAttempt({ assessmentId: exam.id, mode: 'exam' });
  const essayItem = exam.items.find((item) => item.questionId === essay.id); const commentaryItem = exam.items.find((item) => item.questionId === commentary.id);
  const response = { text: 'La urbanización concentró población y el trabajo fabril transformó los vínculos sociales.' };
  assert.equal(shared.studyResponseWordCount(response), 12);
  const saved = assessments.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: essayItem.id, response, responseMs: 15_000, flagged: true });
  assert.equal(saved.isCorrect, null, 'long-form exam response remains pending manual grading'); assert.equal(saved.flagged, true);
  assessments.saveStudyAttemptAnswer(attempt.id, { assessmentItemId: commentaryItem.id, response: {}, responseMs: 2_000 });
  const submitted = assessments.submitStudyAttempt(attempt.id);
  assert.equal(submitted.status, 'submitted'); assert.equal(submitted.omittedCount, 1); assert.equal(submitted.correctCount, 0); assert.equal(submitted.incorrectCount, 0);
  assert.equal(submitted.answers.find((answer) => answer.questionId === essay.id).pointsAwarded, null);
  const variant = assessments.createStudyAssessment({ kind: 'exam', title: `${exam.title} · Variante 2`, description: exam.description, durationMinutes: exam.durationMinutes, questionIds: exam.items.map((item) => item.questionId), points: Object.fromEntries(exam.items.map((item) => [item.questionId, item.points])), config: { ...exam.config, randomizeQuestions: true, seed: 99 } });
  assert.equal(variant.items.length, exam.items.length); assert.notEqual(variant.id, exam.id);
  const printable = assessments.renderStudyAssessmentMarkdown(exam, true); assert.match(printable, /Historia contemporánea/); assert.match(printable, /Respuesta:/); assert.match(printable, /6 pt/);
  const english = assessments.renderStudyAssessmentMarkdown(exam, true, 'en'); assert.match(english, /\*\*Answer:\*\*/); assert.match(english, /\*\*Source:\*\*/); assert.doesNotMatch(english, /Respuesta|Fuente|Duración/);
  closeDb(); console.log('Study exams phase 10c tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module'); const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() }, dialog: {}, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) { if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`); return originalResolveFilename.call(this, request, parent, isMain, options); };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) { const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText; module._compile(output, filename); };
}
