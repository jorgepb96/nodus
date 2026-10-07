// A user-triggered stop keeps published text on ordinary chat surfaces.
// Documentary Research Chat holds its draft until verification and therefore
// returns no unchecked partial text on stop.
//
// The transport resolves with the partial text once its signal aborts (that contract is
// covered by the provider tests); these orchestrators must then return that partial text
// and flag the turn as aborted WITHOUT running the skill registry, whose session guard
// throws an AbortError. Before this suite, that throw reached the renderer and replaced
// the whole answer with "[Error invoking remote method … AbortError]".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-chat-abort')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-abort-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = p => require(path.join(repoRoot, p));
let checks = 0;
const check = (label, condition) => { assert.ok(condition, label); checks++; };

try {
  const settings = load('electron/db/settingsRepo.ts');
  settings.updateSettings({
    chatModel: { provider: 'google', model: 'test-text-model' },
    synthesisModel: { provider: 'google', model: 'test-text-model' },
    nodiModel: { provider: 'google', model: 'test-text-model' },
    promptLanguage: 'en',
    // This suite isolates cancellation of the answer transport. A staged SearXNG
    // runtime must not turn its empty synthetic corpus into a live web search.
    researchWebSearch: 'off',
  });

  const ai = load('electron/ai/aiClient.ts');
  const PARTIAL = 'Partial answer kept after the user pressed stop.';
  // The real transport streams deltas and, on abort, resolves with the accumulated
  // text instead of throwing. A per-run controller lets the stub fire the stop at the
  // exact moment the renderer's stop button would.
  let aborter = null;
  ai.completeText = async () => { aborter?.abort(); return PARTIAL; };
  ai.completeTextStream = async (_opts, delta) => {
    delta('Partial answer kept ', 'content');
    delta('after the user pressed stop.', 'content');
    aborter?.abort();
    return PARTIAL;
  };
  ai.localModelContextWindow = async () => null;

  const assets = load('electron/chatAssets.ts');
  const vaults = load('electron/vaults/vaultRegistry.ts');
  const chatRepo = load('electron/db/chatRepo.ts');
  const nodiStore = load('electron/nodiConversations.ts');
  const worldChats = load('electron/db/worldChatRepo.ts');
  const encyclopedia = load('electron/db/worldEncyclopediaRepo.ts');
  const dbs = load('electron/db/databasesRepo.ts');
  const dbChats = load('electron/db/databaseChatRepo.ts');
  const research = load('electron/ai/researchAssistant.ts');
  const nodi = load('electron/ai/nodiChat.ts');
  const world = load('electron/ai/worldChat.ts');
  const dbChat = load('electron/ai/databaseChat.ts');
  const study = load('electron/ai/studyAssistant.ts');
  const reader = load('electron/libraryReader/libraryReaderStore.ts');
  const readerChat = load('electron/ai/libraryReaderChat.ts');

  const turn = { id: 'u1', role: 'user', content: 'Summarise the observatory.', createdAt: new Date().toISOString() };
  const researchConversation = chatRepo.createConversation({ title: 'Abort' });
  const nodiConversation = nodiStore.saveNodiConversation({ title: 'Abort', messages: [turn] });
  encyclopedia.createWorldArticle({ title: 'Astronomers Guild', body: 'The Astronomers Guild keeps the three domes of the observatory.' });
  const worldConversation = worldChats.createWorldChatConversation({ title: 'Abort' });
  const database = dbs.createDatabase('Abort data');
  const dbConversation = dbChats.createDatabaseChatConversation({ title: 'Abort', databaseIds: [database.id] });
  const studyConversation = study.createStudyAssistantConversation();

  const backupRoot = path.join(scratch, 'library');
  load('electron/db/appPrefs.ts').writeGlobalPrefsRaw({ autoBackupFolder: backupRoot });
  const { LibraryDiskStore } = load('electron/library/libraryStorage.ts');
  const disk = new LibraryDiskStore(path.join(backupRoot, 'nodus-library'), 'abort-device'); disk.initialize();
  const folder = disk.itemFolder('ABORTDOC'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'reader.md'), '# Observatory\n\nThe observatory has three domes.');
  disk.upsertItem({ id: 'zotero:ABORTDOC', storageId: 'ABORTDOC', source: 'zotero', sourceLibraryId: 'users/0', sourceKey: 'ABORTDOC', metadata: { title: 'Observatory design', itemType: 'document', creators: [], isbn: [], issn: [], tags: [] }, collectionIds: [], attachments: [], files: { reader: 'reader.md', chat: 'chat.json' }, extraction: { status: 'ready' } });
  const owner = (surface, id) => assets.chatAssetOwner(surface, id, vaults.getActiveVault().id);

  const researchSelection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} };
  const surfaces = [
    {
      name: 'research assistant',
      run: (signal) => research.streamResearchChat({ conversationId: researchConversation.id, messages: [turn], selection: researchSelection }, () => {}, signal).then((result) => ({ text: result.answer, aborted: result.aborted })),
    },
    {
      name: 'nodi',
      run: (signal) => nodi.streamNodiChat({ conversationId: nodiConversation.id, messages: [turn], contexts: [] }, () => {}, signal).then((text) => ({ text, aborted: null })),
    },
    {
      name: 'world chat',
      run: (signal) => world.streamWorldChat({ conversationId: worldConversation.id, question: 'What does the Astronomers Guild do?', focusKeys: [] }, () => {}, signal).then((result) => ({ text: result.text, aborted: result.aborted })),
    },
    {
      name: 'database chat',
      run: (signal) => dbChat.streamDatabaseChat({ conversationId: dbConversation.id, databaseIds: [database.id], question: 'Summarise the data.' }, () => {}, signal).then((result) => ({ text: result.text, aborted: result.aborted })),
    },
    {
      name: 'study/teaching',
      run: (signal) => study.streamStudyAssistant({ conversationId: studyConversation.id, messages: [turn], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true }, () => {}, signal).then((result) => ({ text: result.answer, aborted: result.interrupted })),
    },
    {
      name: 'library reader',
      run: (signal) => readerChat.streamLibraryReaderChat({ documentId: 'ABORTDOC', messages: [turn] }, () => {}, signal).then((result) => ({ text: result.answer, aborted: result.aborted })),
    },
  ];

  for (const surface of surfaces) {
    aborter = new AbortController();
    const result = await surface.run(aborter.signal);
    check(`${surface.name}: the stop reaches the provider`, aborter.signal.aborted);
    if (surface.name === 'research assistant') check(`${surface.name}: withholds the unverified documentary draft`, result.text === '');
    else check(`${surface.name}: keeps the partial answer`, result.text.includes('Partial answer kept'));
    check(`${surface.name}: never replaces the answer with the abort error`, !/AbortError|aborted a request/i.test(result.text));
    if (result.aborted !== null) check(`${surface.name}: reports the turn as aborted`, result.aborted === true);
    console.log(`${surface.name}: cancellation preserves its publication contract`);
  }

  // The owner registry must exist for the surfaces that key their assets by conversation.
  for (const [surface, id] of [['assistant', researchConversation.id], ['nodi', nodiConversation.id], ['world-assistant', worldConversation.id], ['database', dbConversation.id], ['study', studyConversation.id]]) {
    check(`${surface}: keeps its chat asset owner`, typeof owner(surface, id) === 'string');
  }

  // The renderer surfaces must ship the notice that explains the stop, wired to the
  // stop button, so the partial text is never replaced by the cancellation error.
  for (const file of [
    'src/views/ResearchAssistantModal.tsx',
    'src/components/nodi/NodiCompanion.tsx',
    'src/views/DatabasesChatView.tsx',
    'src/views/StudyChatView.tsx',
    'src/views/WorldChatView.tsx',
    'src/views/LibraryDocumentReader.tsx',
  ]) {
    const ownSource = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const source = ownSource + (/<ResearchAssistantModal/.test(ownSource) ? fs.readFileSync(path.join(repoRoot, 'src/views/ResearchAssistantModal.tsx'), 'utf8') : '');
    check(`${file}: renders the aborted notice`, /<ChatAbortedNotice/.test(source));
    check(`${file}: stop button records the user's stop`, /[Ss]topRequestedRef\.current = true|interrupted/.test(source));
  }

  load('electron/db/database.ts').closeDb();
  console.log(`All ${checks} partial-answer abort scenarios passed without network calls.`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
