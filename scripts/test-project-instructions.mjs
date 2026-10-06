// Project inheritance through all four real chat engines. Provider transport is captured;
// no credentials or network are used. Storage runs under the native Electron SQLite ABI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--project-instructions')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-project-instructions-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden'); };
try {
  const storage = load('electron/db/database.ts');
  const db = storage.getDb();
  const { runMigrations, SCHEMA_VERSION } = load('electron/db/migrations.ts');
  const tables = load('electron/db/chatHistoryTables.ts').CHAT_HISTORY_TABLES;
  // Upgrade an existing 192 schema, including one already-added column, without losing data.
  for (const table of tables.slice(1)) db.exec(`ALTER TABLE ${table.projects} DROP COLUMN instructions`);
  db.pragma('user_version = 192'); runMigrations(db); runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 193, 'the schema includes project instructions');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  const custom = load('electron/db/researchSystemPromptsRepo.ts').saveResearchSystemPrompt({ name: 'Chat style', instructions: 'CHAT_STYLE: use two paragraphs.' });
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  load('electron/db/settingsRepo.ts').updateSettings({ chatModel: model, synthesisModel: model, researchWebSearch: 'off' });
  const ai = load('electron/ai/aiClient.ts');
  const captured = [];
  ai.embedQuery = async () => null;
  ai.completeTextStream = async (options, onDelta) => { captured.push(options.system); onDelta('Synthetic response.'); return 'Synthetic response.'; };
  const database = load('electron/db/databasesRepo.ts').createDatabase('Synthetic measurements');
  const article = load('electron/db/worldEncyclopediaRepo.ts').createWorldArticle({ title: 'Synthetic tower', body: 'Three windows.' });
  const study = load('electron/ai/studyChatHistory.ts');
  const { createChatOrganizer } = load('electron/db/chatOrganizerRepo.ts');
  const question = 'Explain the available information briefly.';
  const request = { model, messages: [{ id: 'u', role: 'user', content: question }] };
  const studyEngine = load('electron/ai/studyAssistant.ts');
  const surfaces = [
    { name: 'research', createChat: input => load('electron/db/chatRepo.ts').createConversation(input),
      run: extra => load('electron/ai/researchAssistant.ts').streamResearchChat({ ...request, ...extra, selection: { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} } }, () => {}) },
    { name: 'database', createChat: input => load('electron/db/databaseChatRepo.ts').createDatabaseChatConversation({ ...input, databaseIds: [database.id] }),
      run: extra => load('electron/ai/databaseChat.ts').streamDatabaseChat({ model, ...extra, databaseIds: [database.id], question }, () => {}) },
    { name: 'world', createChat: input => load('electron/db/worldChatRepo.ts').createWorldChatConversation({ ...input, model, selection: { scope: 'manual', entryKeys: [], keepFocus: false } }),
      run: extra => load('electron/ai/worldChat.ts').streamWorldChat({ model, ...extra, question, focusKeys: [`article:${article.articleId}`] }, () => {}) },
    { name: 'study', createChat: input => studyEngine.createStudyAssistantConversation(input),
      run: extra => studyEngine.streamStudyAssistant({ ...request, ...extra, selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true }, () => {}) },
  ];
  for (const surface of surfaces) {
    const organizer = surface.name === 'study' ? {
      createChatProject: study.createStudyChatProject, updateChatProject: study.updateStudyChatProject,
      setConversationProject: study.setStudyChatConversationProject, deleteChatProject: study.deleteStudyChatProject,
      listChatProjects: study.listStudyChatProjects,
    } : createChatOrganizer(tables.find(t => t.surface === surface.name));
    const a = organizer.createChatProject({ name: 'A' });
    const b = organizer.createChatProject({ name: 'B', instructions: 'PROJECT_B: context B.' });
    const chat = surface.createChat({ title: 'Synthetic chat', projectId: a.id });
    const run = async (systemPromptId = null) => {
      captured.length = 0; await surface.run({ conversationId: chat.id, systemPromptId });
      assert.equal(captured.length, 1); return captured[0];
    };
    const original = await run();
    assert.doesNotMatch(original, /PROJECT CONTEXT/);
    assert.throws(() => organizer.updateChatProject(a.id, { instructions: 'x'.repeat(12001) }), /invalid_instructions/);
    assert.throws(() => organizer.updateChatProject(a.id, { instructions: 12 }), /invalid_instructions/);
    organizer.updateChatProject(a.id, { instructions: '  PROJECT_A: context A.  ' });
    organizer.updateChatProject(a.id, { name: 'Renamed A' });
    storage.closeDb(); // reopen both DB storage and, for Study, its file on the next request
    assert.equal(organizer.listChatProjects().find(p => p.id === a.id).instructions, 'PROJECT_A: context A.');
    const inherited = await run(custom.id);
    assert.match(inherited, /PROJECT_A/); assert.match(inherited, /CHAT_STYLE/);
    assert.match(inherited, /conversation preferences take precedence/);
    assert.ok(inherited.endsWith(original), 'application contract stays intact');
    organizer.setConversationProject(chat.id, b.id);
    const moved = await run(); assert.match(moved, /PROJECT_B/); assert.doesNotMatch(moved, /PROJECT_A/);
    organizer.updateChatProject(b.id, { instructions: 'PROJECT_UPDATED' });
    assert.match(await run(), /PROJECT_UPDATED/);
    organizer.updateChatProject(b.id, { instructions: '   ' });
    assert.equal(await run(), original, 'clearing restores the exact original system prompt');
    organizer.updateChatProject(b.id, { instructions: 'PROJECT_RESTORED' });
    organizer.setConversationProject(chat.id, null);
    assert.equal(await run(), original, 'unfiled conversations inherit no project');
    organizer.setConversationProject(chat.id, b.id); organizer.deleteChatProject(b.id);
    assert.equal(await run(), original, 'deleted projects leave no stale instructions');
    console.log(`${surface.name}: inheritance, composition, rename, reopen, move, update, clear and delete passed`);
  }
  assert.deepEqual(storage.getDb().pragma('foreign_key_check'), []);
  storage.closeDb();
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
