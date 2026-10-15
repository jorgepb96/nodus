// Study vault phase 7: local index collection, hybrid/RRF ranking, filters,
// spelling suggestions, durable saved searches/history and source exclusions.

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

if (!process.argv.includes('--electron-study-search-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-search.mjs'), '--electron-study-search-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-search-test-'));
installRuntimeHooks(root);

try {
  const shared = require(path.join(repoRoot, 'shared/studySearch.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const questions = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const baseEntry = {
    indexId: 'a', kind: 'document', sourceId: 'd1', title: 'Memoria de trabajo',
    text: 'La memoria operativa mantiene información durante una tarea.', subtitle: '', tags: ['cognición'],
    scope: { courseId: 'c1', subjectId: 's1', topicId: 't1' }, location: { documentId: 'd1', from: 0, to: 64 },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', contentHash: 'a', embedding: [1, 0], excluded: false,
  };
  const pure = shared.rankStudySearchEntries('memoria operativa', [baseEntry, { ...baseEntry, indexId: 'b', sourceId: 'd2', title: 'Atención', text: 'Control ejecutivo.', embedding: [0, 1] }], {}, [1, 0]);
  assert.equal(pure[0].sourceId, 'd1');
  assert.ok(pure[0].score.exact > 0 && pure[0].score.semantic > 0.9 && pure[0].score.fusion > (pure[1]?.score.fusion ?? 0));
  assert.equal(shared.rankStudySearchEntries('memoria', [baseEntry], { courseId: 'otro' }, [1, 0]).length, 0, 'scope filters are strict');
  assert.deepEqual(shared.studySearchTokens('¿Dónde explico la diferencia?', true).includes('contraste'), true, 'query synonyms expand');
  assert.deepEqual(shared.suggestStudySearchCorrections('memroia', [baseEntry]).includes('memoria'), true, 'typo correction uses local vocabulary');

  const course = org.createStudyCourse({ name: 'Psicología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Cognición' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Memoria' });
  const document = org.createStudyDocument({
    title: 'Apunte memoria', contentMarkdown: '# Memoria de trabajo\n\nLa agenda visoespacial mantiene imágenes temporalmente.',
    placement: { courseId: course.id, subjectId: subject.id, topicId: topic.id },
  });
  const materialPath = path.join(root, 'manual.txt');
  fs.writeFileSync(materialPath, 'El bucle fonológico repasa información verbal mediante repetición.');
  const material = await materials.importStudyMaterialFile(materialPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id });
  const recording = recordings.createStudyRecording({ fileName: 'clase.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]), durationSeconds: 20, courseId: course.id, subjectId: subject.id, topicId: topic.id });
  recordings.saveStudyTranscript(recording.recording.id, {
    kind: 'literal', contentMarkdown: 'El ejecutivo central coordina recursos.', status: 'ready',
    segments: [{ tStart: 7, tEnd: 12, text: 'El ejecutivo central coordina recursos.', speaker: 'Docente' }],
  });
  const question = questions.createStudyQuestion({
    prompt: '¿Qué subsistema mantiene imágenes temporalmente?', type: 'short', status: 'approved',
    answer: { text: 'La agenda visoespacial.' }, explanation: 'Procede del apunte de memoria.',
    courseId: course.id, subjectId: subject.id, topicId: topic.id, documentId: document.id,
    source: { title: document.title, excerpt: 'La agenda visoespacial mantiene imágenes temporalmente.' },
  });

  const collected = search.collectStudySearchEntries();
  assert.ok(collected.some((entry) => entry.sourceId === document.id && entry.kind === 'document'));
  assert.ok(collected.some((entry) => entry.sourceId === material.material.id && entry.kind === 'material'));
  assert.ok(collected.some((entry) => entry.sourceId === question.id && entry.kind === 'question'), 'the central bank participates in the hybrid index');
  const transcriptEntry = collected.find((entry) => entry.kind === 'transcript');
  assert.equal(transcriptEntry.location.timestampSeconds, 7, 'transcript index preserves audio seek target');
  const rebuilt = await search.rebuildStudySearchIndex();
  assert.equal(rebuilt.state, 'ready');
  assert.ok(rebuilt.indexedEntries >= 3);
  assert.equal(rebuilt.embeddedEntries, 0, 'without an API key the local text index remains usable');

  const documentSearch = await search.searchStudyCorpus('agenda visoespacial', { kinds: ['document'] });
  assert.equal(documentSearch.results[0].sourceId, document.id);
  assert.equal(documentSearch.semanticAvailable, false);
  const materialSearch = await search.searchStudyCorpus('bucle fonológico');
  assert.equal(materialSearch.results[0].sourceId, material.material.id);
  const transcriptSearch = await search.searchStudyCorpus('ejecutivo central');
  assert.equal(transcriptSearch.results[0].location.recordingId, recording.recording.id);
  const questionSearch = await search.searchStudyCorpus('qué subsistema mantiene imágenes', { kinds: ['question'] });
  assert.equal(questionSearch.results[0].sourceId, question.id);
  const crossLanguageContext = await search.retrieveStudyAssistantEntries(
    'How are these completely unrelated English terms explained?',
    { subjectId: subject.id },
    [],
    3,
  );
  assert.equal(crossLanguageContext.length, 3, 'assistant falls back to scoped corpus context when cross-language lexical retrieval has no matches');
  assert.ok(crossLanguageContext.every((entry) => entry.scope.subjectId === subject.id), 'cross-language fallback never leaks outside the selected scope');
  assert.equal((await search.retrieveStudyAssistantEntries('anything', { subjectId: 'missing-subject' }, [], 3)).length, 0, 'fallback keeps empty scopes empty');

  const saved = search.saveStudySearch('Memoria clave', 'memoria', { subjectId: subject.id });
  assert.equal(search.listStudySavedSearches()[0].id, saved.id);
  assert.ok(search.listStudySearchHistory().length >= 3);
  search.setStudySearchSourceExcluded(material.material.id, true);
  assert.equal((await search.searchStudyCorpus('bucle fonológico')).results.length, 0, 'excluded sources disappear without deleting source data');
  search.setStudySearchSourceExcluded(material.material.id, false);
  search.deleteStudySavedSearch(saved.id);
  search.clearStudySearchHistory();
  assert.equal(search.listStudySavedSearches().length, 0);
  assert.equal(search.listStudySearchHistory().length, 0);
  search.deleteStudySearchIndex();
  assert.equal(search.getStudySearchIndexStatus().state, 'empty');

  closeDb();
  console.log('Study hybrid search phase 7 tests passed!');
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
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      // Keep createRequire(import.meta.url) rooted at the real source module while
      // compiling to CommonJS; residual import.meta would force Node 24 ESM mode.
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
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
