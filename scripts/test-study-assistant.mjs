// Study vault phase 8: grounded prompt assembly, strict citation validation,
// scoped source selection and local per-vault conversation history.

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

if (!process.argv.includes('--electron-study-assistant-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-assistant.mjs'), '--electron-study-assistant-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-assistant-test-'));
installRuntimeHooks(root);

try {
  const shared = require(path.join(repoRoot, 'shared/studyAssistant.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const recordings = require(path.join(repoRoot, 'electron/db/studyRecordingsRepo.ts'));
  const assistant = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
  const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const location = { documentId: 'doc-1', from: 10, to: 42 };
  const citation = {
    id: 'S1', sourceKey: 'document:doc-1', indexId: 'document:doc-1:0', kind: 'document', sourceId: 'doc-1',
    title: 'Memoria', subtitle: 'Cognición', quote: 'La memoria de trabajo mantiene información activa.', location,
    scope: { courseId: 'c1', subjectId: 's1', topicId: 't1' },
  };
  const validated = shared.validateStudyAssistantAnswer('La mantiene activa [S1]. Cita inventada [S99](https://invalid.example).', [citation]);
  assert.match(validated.answer, /\[S1\]\(nodus:\/\/study\/evidence\/S1\)/);
  assert.doesNotMatch(validated.answer, /S99/, 'invented citation ids are removed');
  assert.deepEqual(validated.citations.map((item) => item.id), ['S1']);
  assert.equal(validated.citationWarning, false);
  assert.equal(shared.validateStudyAssistantAnswer('Respuesta sin evidencia.', [citation]).citationWarning, true);

  const long = `${'Introducción general. '.repeat(250)}La agenda visoespacial mantiene imágenes temporalmente. ${'Detalle secundario. '.repeat(250)}`;
  const compressed = shared.compressStudyAssistantEvidence(long, 'agenda visoespacial', 700);
  assert.equal(compressed.truncated, true);
  assert.match(compressed.text, /agenda visoespacial/, 'compression keeps query-relevant exact evidence');

  const course = org.createStudyCourse({ name: 'Psicología' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Cognición' });
  const topic = org.createStudyTopic({ subjectId: subject.id, name: 'Memoria' });
  const document = org.createStudyDocument({
    title: 'Apunte memoria', contentMarkdown: '# Memoria\n\nLa agenda visoespacial mantiene imágenes temporalmente.',
    placement: { courseId: course.id, subjectId: subject.id, topicId: topic.id },
  });
  const materialPath = path.join(root, 'manual.txt');
  fs.writeFileSync(materialPath, 'El bucle fonológico repasa información verbal.');
  const material = await materials.importStudyMaterialFile(materialPath, { courseId: course.id, subjectId: subject.id, topicId: topic.id });
  const recording = recordings.createStudyRecording({ fileName: 'clase.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]), durationSeconds: 15, subjectId: subject.id, topicId: topic.id });
  recordings.saveStudyTranscript(recording.recording.id, { kind: 'literal', contentMarkdown: 'El ejecutivo central coordina recursos.', status: 'ready', segments: [{ tStart: 4, tEnd: 8, text: 'El ejecutivo central coordina recursos.' }] });

  const options = assistant.getStudyAssistantSources();
  assert.ok(options.some((item) => item.sourceKey === `document:${document.id}`));
  assert.ok(options.some((item) => item.sourceKey === `material:${material.material.id}`));
  assert.ok(options.some((item) => item.kind === 'transcript'));

  const prompt = assistant.buildStudyAssistantPrompt({
    messages: [{ id: 'u1', role: 'user', content: '¿Qué mantiene información?', createdAt: new Date().toISOString() }],
    selection: { scope: 'manual', sourceKeys: [`document:${document.id}`] }, task: 'answer', level: 'standard', tone: 'clear', language: 'es', allowExternalKnowledge: false,
  }, [citation]);
  assert.match(prompt.system, /PROHIBIDO usar conocimiento externo/);
  assert.match(prompt.system, /No inventes ids/);
  assert.match(prompt.user, /exact_fragment/);

  // Replayed assistant history keeps the prose and the package summary, and drops the rendered
  // control blocks: they are the app's, and echoing them back wastes tokens (and can look like
  // injected instructions to a provider's safety classifier).
  const withHistory = assistant.buildStudyAssistantPrompt({
    messages: [
      { id: 'u0', role: 'user', content: '¿Qué es la memoria de trabajo?', createdAt: new Date().toISOString() },
      { id: 'a0', role: 'assistant', content: 'La memoria de trabajo retiene datos breves.\n\n```nodus-view\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>\n```\n\n```nodus-artifact\n{"summary":"Verified document"}\n```', createdAt: new Date().toISOString() },
      { id: 'u1', role: 'user', content: '¿Y el bucle fonológico?', createdAt: new Date().toISOString() },
    ],
    selection: { scope: 'manual', sourceKeys: [`document:${document.id}`] }, task: 'answer', level: 'standard', tone: 'clear', language: 'es', allowExternalKnowledge: false,
  }, [citation]);
  assert.match(withHistory.user, /La memoria de trabajo retiene datos breves\./);
  assert.match(withHistory.user, /Verified document/, 'a package artifact keeps its summary');
  assert.doesNotMatch(withHistory.user, /nodus-view|nodus-artifact|<svg/);

  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { studyAssistantPromptPack } = require(path.join(repoRoot, 'shared/studyAssistantPromptPacks.ts'));
  const promptLanguages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
  for (const language of promptLanguages) {
    settingsRepo.updateSettings({ promptLanguage: language });
    const insufficient = await assistant.streamStudyAssistant({
      messages: [{ id: 'u-empty', role: 'user', content: 'What is missing?', createdAt: new Date().toISOString() }],
      selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: false,
    }, () => {});
    assert.equal(
      insufficient.answer,
      studyAssistantPromptPack(language).insufficientInformation,
      `${language}: early insufficient-context responses follow the configured prompt language`,
    );
    if (language === 'en') assert.match(insufficient.answer, /^There is not enough information/, 'English early insufficient-context response');
  }
  settingsRepo.updateSettings({ promptLanguage: 'en' });

  const conversation = assistant.createStudyAssistantConversation({ selection: { scope: 'topic', topicId: topic.id, sourceKeys: [] } });
  const messages = [
    { id: 'u1', role: 'user', content: 'Resume la memoria.', createdAt: new Date().toISOString() },
    { id: 'a1', role: 'assistant', content: validated.answer, citations: [citation], createdAt: new Date().toISOString() },
  ];
  const updated = assistant.updateStudyAssistantConversation(conversation.id, { title: 'Memoria de trabajo', messages, task: 'summary' });
  assert.equal(updated.title, 'Memoria de trabajo');
  assert.equal(updated.selection.topicId, topic.id, 'academic scope persists with conversation history');
  assert.equal(assistant.listStudyAssistantConversations()[0].messageCount, 2);
  assert.match(
    assistant.renderStudyAssistantConversation(updated),
    /Sources: S1 — Memoria/,
    'conversation exports follow the configured prompt language instead of retaining Spanish labels',
  );
  assistant.updateStudyAssistantConversation(conversation.id, { archived: true });
  assert.equal(assistant.listStudyAssistantConversations().length, 0);
  assert.equal(assistant.listStudyAssistantConversations(true)[0].archived, true);
  assistant.deleteStudyAssistantConversation(conversation.id);
  assert.equal(assistant.getStudyAssistantConversation(conversation.id), null);

  // Organization changes preserve the persisted source selection and old citations.
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const otherSubject = org.createStudySubject({ courseId: course.id, name: 'Biología' });
  const secondPlacement = materials.addStudyMaterialPlacement(material.material.id, { courseId: course.id, subjectId: otherSubject.id });
  const materialKey = `material:${material.material.id}`;
  const catalogBefore = assistant.getStudyAssistantSources().find((s) => s.sourceKey === materialKey);
  assert.equal(catalogBefore.placements.length, 2, 'the catalogue exposes every placement');
  assert.equal(catalogBefore.chunks, 1, 'placements do not multiply evidence count');
  const evidenceBefore = await search.retrieveStudyAssistantEntries('bucle', {}, [materialKey]);
  assert.equal(evidenceBefore.length, 1, 'the same fragment is not repeated for each placement');
  const materialChat = assistant.createStudyAssistantConversation({ selection: { scope: 'manual', sourceKeys: [materialKey] } });
  const folder = org.createStudyFolder({ subjectId: otherSubject.id, name: 'Lecturas' });
  materials.moveStudyMaterialPlacement(material.material.id, secondPlacement.id, { folderId: folder.id });
  const evidenceAfter = await search.retrieveStudyAssistantEntries('bucle', { folderId: folder.id }, [materialKey]);
  assert.equal(evidenceAfter.length, 1, 'scope cache updates immediately without an embedding rebuild');
  assert.deepEqual(JSON.parse(JSON.stringify(evidenceAfter[0].location)), JSON.parse(JSON.stringify(evidenceBefore[0].location)), 'old citation locations remain valid');
  assert.deepEqual(assistant.getStudyAssistantConversation(materialChat.id).selection.sourceKeys, [materialKey]);
  const newMaterialPath = path.join(root, 'other.txt'); fs.writeFileSync(newMaterialPath, 'Otro material añadido después.');
  await materials.importStudyMaterialFile(newMaterialPath, { subjectId: otherSubject.id, folderId: folder.id });
  assert.deepEqual(assistant.getStudyAssistantConversation(materialChat.id).selection.sourceKeys, [materialKey], 'adding a material to the folder does not change a saved selection');
  org.updateStudyEntity('subject', otherSubject.id, { name: 'Biología molecular' });
  assert.match((await search.retrieveStudyAssistantEntries('bucle', { folderId: folder.id }, [materialKey]))[0].subtitle, /molecular/, 'renaming organization refreshes cached labels');
  const emptyPath = path.join(root, 'empty.wav'); fs.writeFileSync(emptyPath, 'RIFFfakeWAVE');
  const empty = await materials.importStudyMaterialFile(emptyPath, { folderId: folder.id });
  const emptyOption = assistant.getStudyAssistantSources().find((s) => s.sourceId === empty.material.id);
  assert.equal(emptyOption.available, false);
  assert.equal(emptyOption.unavailableReason, 'no_content');
  assert.equal(emptyOption.placements[0].folderId, folder.id, 'unusable materials retain their organization');
  closeDb();
  console.log('Study grounded assistant phase 8 tests passed!');
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
