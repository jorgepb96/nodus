import { studySourceFixtures } from './study-source-fixtures';
import { DEFAULT_CHAT_SKILLS } from '../shared/chatSkills';
import { vaultTypeColor } from '../shared/vaultTypes';
import { DatabasesChatView } from '../src/views/DatabasesChatView';
import { StudyChatView } from '../src/views/StudyChatView';
import { WorldChatView } from '../src/views/WorldChatView';
import ReactDOM from 'react-dom/client';
import { ResearchAssistantModal } from '../src/views/ResearchAssistantModal';
import { setActiveLang } from '../src/i18n';
import type { AppSettings } from '../shared/types';
import '../src/index.css';
import '../src/mobileWeb/mobile.css';
import '../src/mobileWeb/phone.css';
import {installMobileKeyboard} from '../src/mobileWeb/mobileKeyboard';
const params = new URLSearchParams(location.search);
const view = params.get('view');
if (params.get('device') === 'phone') { (window as any).nodusMobileConfig = {device:'phone'}; installMobileKeyboard(document); }
const vaultType = params.get('vault') ?? ({ database: 'databases', study: 'estudio', teaching: 'docencia', world: 'worldbuilding' }[view ?? ''] ?? 'academic');
// `?memory=` stands in for a relaunch: the composer then reads the levels a previous session
// saved, keyed provider:model, instead of an empty map.
const storedEffort = (): Record<string, string> => {
  try {
    return JSON.parse(params.get('memory') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};
const settings = { synthesisModel: { provider: 'openai', model: 'gpt-5.4' }, uiLanguage: 'es', chatModel: { provider: 'openai', model: 'gpt-5.4' }, favorites: [
  { provider: 'gemini', model: 'gemini-3-pro-preview' }, { provider: 'xiaomi', model: 'mimo-v2.5' },
  { provider: 'openai', model: 'gpt-4.1' }, { provider: 'codex', model: 'gpt-6-astra' },
  // The unversioned DeepSeek ids each route serves, so the effort control they publish can be
  // captured and inspected here rather than only asserted.
  { provider: 'deepseek', model: 'deepseek-flash' }, { provider: 'opencode-go', model: 'deepseek-flash' },
], sttProvider: 'transformers', sttTransformersModel: 'whisper-tiny', researchEffortByModel: storedEffort() } as AppSettings;
if (params.get('concilium')) {
  settings.uiLanguage = 'en';
  settings.chatModel = { provider: 'deepseek', model: 'deepseek-flash' };
  settings.synthesisModel = settings.chatModel;
  settings.favorites = [settings.chatModel, { provider: 'gemini', model: 'gemini-2.5-flash-lite' }, { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' }];
}
const win = window as any;
win.requests = []; win.updates = []; win.saved = [];
const conversations = new Map<string, any>();
const systemPrompts = new Map<string, any>();
const promptSelections = new Map<string, string>();
const nativeConversations = new Map<string, any>();
const nativeCreate = async (input: any) => { const chat = { id: `native-${nativeConversations.size + 1}`, ...input, messages: [], focus: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 }; nativeConversations.set(chat.id, chat); return chat; };
const nativeSave = async (id: string, patch: any) => { win.saved.push({ id, ...patch }); const chat = nativeConversations.get(id); return Object.assign(chat, patch, { messageCount: patch.messages?.length ?? chat.messageCount ?? 0 }, patch.archived ? { pinnedAt: null } : {}); };
const nativeStream = async (request: any, handlers: any) => { win.requests.push(request); handlers.onDelta('Respuesta con evidencia.'); return { text: 'Respuesta con evidencia.', answer: 'Respuesta con evidencia [S1](nodus://study/evidence/S1).', citations: [{ id: 'S1', kind: 'material', title: 'Fuente original', location: { materialId: 'material-1' } }], focus: [{ kind: 'character', id: 'character-1', title: 'Personaje' }], noMaterial: false }; };

// The chat history's organization for the native surfaces, in memory, with the store's
// rules: a folder brings its project, another project clears the folder, a deleted folder
// or project unfiles and never deletes, a deleted notebook returns its chats.
const history = { projects: [] as any[], folders: [] as any[], notebooks: [] as any[] };
win.chatHistoryStore = history;
win.native = nativeConversations;
const stamp = () => new Date().toISOString();
const chatOf = (id: string) => { const chat = nativeConversations.get(id); if (!chat) throw new Error('research_chat_conversation_not_found'); return chat; };
const nativeList = async (includeArchived?: boolean) => [...nativeConversations.values()].filter(chat => includeArchived || !chat.archived);
const organizerFixtures = {
  listChatHistoryProjects: async () => [...history.projects].sort((a, b) => a.name.localeCompare(b.name)),
  createChatHistoryProject: async (_surface: string, input: any) => { const project = { id: `project-${history.projects.length + 1}`, icon: 'folder', color: null, createdAt: stamp(), updatedAt: stamp(), ...input }; history.projects.push(project); return project; },
  updateChatHistoryProject: async (_surface: string, id: string, patch: any) => Object.assign(history.projects.find(project => project.id === id), patch),
  deleteChatHistoryProject: async (_surface: string, id: string) => {
    history.projects = history.projects.filter(project => project.id !== id);
    history.folders = history.folders.filter(folder => folder.projectId !== id);
    for (const chat of nativeConversations.values()) if (chat.projectId === id) Object.assign(chat, { projectId: null, folderId: null });
  },
  listChatHistoryFolders: async () => history.folders,
  createChatHistoryFolder: async (_surface: string, input: any) => { const folder = { id: `folder-${history.folders.length + 1}`, parentId: null, position: history.folders.length, createdAt: stamp(), ...input }; history.folders.push(folder); return folder; },
  renameChatHistoryFolder: async (_surface: string, id: string, name: string) => Object.assign(history.folders.find(folder => folder.id === id), { name }),
  moveChatHistoryFolder: async (_surface: string, id: string, parentId: string | null) => Object.assign(history.folders.find(folder => folder.id === id), { parentId }),
  deleteChatHistoryFolder: async (_surface: string, id: string) => {
    history.folders = history.folders.filter(folder => folder.id !== id);
    for (const chat of nativeConversations.values()) if (chat.folderId === id) chat.folderId = null;
  },
  setChatHistoryProject: async (_surface: string, id: string, projectId: string | null) => { const chat = chatOf(id); if (chat.projectId !== projectId) chat.folderId = null; chat.projectId = projectId; },
  setChatHistoryFolder: async (_surface: string, id: string, folderId: string | null) => { const chat = chatOf(id); if (folderId) chat.projectId = history.folders.find(folder => folder.id === folderId).projectId; chat.folderId = folderId; },
  setChatHistoryPinned: async (_surface: string, id: string, pinned: boolean) => { chatOf(id).pinnedAt = pinned ? stamp() : null; },
  renameChatHistoryConversation: async (_surface: string, id: string, title: string) => { chatOf(id).title = title; },
  archiveChatHistoryConversation: async (_surface: string, id: string, archived: boolean) => { Object.assign(chatOf(id), { archived, ...(archived ? { pinnedAt: null } : {}) }); },
  listChatHistoryNotebooks: async () => history.notebooks,
  createChatHistoryNotebook: async (_surface: string, input: any) => { const notebook = { id: `notebook-${history.notebooks.length + 1}`, icon: 'notebook', color: null, createdAt: stamp(), updatedAt: stamp(), ...input }; history.notebooks.push(notebook); return notebook; },
  updateChatHistoryNotebook: async (_surface: string, id: string, patch: any) => Object.assign(history.notebooks.find(notebook => notebook.id === id), patch),
  deleteChatHistoryNotebook: async (_surface: string, id: string) => {
    history.notebooks = history.notebooks.filter(notebook => notebook.id !== id);
    for (const chat of nativeConversations.values()) if (chat.notebookId === id) chat.notebookId = null;
  },
};

window.nodus = new Proxy({
  ...organizerFixtures,
  getSettings: async () => settings,
  listChatSkills: async () => params.get('concilium') ? DEFAULT_CHAT_SKILLS.map(skill => ({ ...skill, enabled: { assistant: skill.builtin === 'svg', nodi: false } })) : [],
  getResearchSystemPrompts: async (key: string) => ({ prompts: [...systemPrompts.values()].sort((a, b) => a.name.localeCompare(b.name)), selectedId: promptSelections.get(key) ?? null }),
  saveResearchSystemPrompt: async (input: any) => { const prompt = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; systemPrompts.set(prompt.id, prompt); return prompt; },
  selectResearchSystemPrompt: async (key: string, id: string | null) => { if (id) promptSelections.set(key, id); else promptSelections.delete(key); },
  deleteResearchSystemPrompt: async (id: string) => { systemPrompts.delete(id); for (const [key, value] of promptSelections) if (value === id) promptSelections.delete(key); },
  listDatabases: async () => [{ id: 'database-1', name: 'Base seleccionada' }, { id: 'database-2', name: 'Otra base' }],
  ...studySourceFixtures(Number(params.get('sources') ?? 1)),
  listWorldEntries: async () => [{ key: 'character:character-1', id: 'character-1', kind: 'character', title: 'Personaje' }],
  listDatabaseChatConversations: nativeList,
  listStudyAssistantConversations: nativeList,
  listWorldChatConversations: nativeList,
  getDatabaseChatConversation: async (id: string) => nativeConversations.get(id),
  getStudyAssistantConversation: async (id: string) => nativeConversations.get(id),
  getWorldChatConversation: async (id: string) => nativeConversations.get(id),
  createDatabaseChatConversation: nativeCreate,
  createStudyAssistantConversation: nativeCreate,
  createWorldChatConversation: nativeCreate,
  saveDatabaseChatConversation: (id: string, messages: any[], databaseIds: string[]) => nativeSave(id, { messages, databaseIds }),
  updateStudyAssistantConversation: nativeSave,
  saveWorldChatConversation: (id: string, messages: any[], selection: any, focus: any, model: any) => nativeSave(id, { messages, selection, focus, model }),
  deleteDatabaseChatConversation: async (id: string) => nativeConversations.delete(id),
  deleteStudyAssistantConversation: async (id: string) => nativeConversations.delete(id),
  deleteWorldChatConversation: async (id: string) => nativeConversations.delete(id),
  dbChatStream: nativeStream,
  streamStudyAssistant: nativeStream,
  worldChatStream: nativeStream,
  getActiveVault: async () => ({ id: 'test', type: vaultType }),
  // Explicit synthetic catalogue entries; production never infers picker choices from IDs.
  listModels: async (provider: string) => ({
    openai: [{ id: 'gpt-5.4', researchReasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh'] }, { id: 'gpt-4.1' }],
    deepseek: [{ id: 'deepseek-flash', researchReasoningLevels: ['low', 'high', 'max'] }],
    gemini: [{ id: 'gemini-3-pro-preview', researchReasoningLevels: ['low', 'high'] }],
    codex: [{ id: 'gpt-6-astra', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffort => ({ reasoningEffort, description: '' })) }],
    xiaomi: [{ id: 'mimo-v2.5' }],
    'opencode-go': [{ id: 'deepseek-flash' }],
  } as Record<string, unknown[]>)[provider] ?? [],
  listResearchContextSources: async () => ({ authors: [
    { id: 'arendt', name: 'Hannah Arendt', workIds: ['human', 'origins'] },
    { id: 'foucault', name: 'Michel Foucault', workIds: ['discipline'] },
  ], works: [
    { id: 'human', title: 'La condición humana', authors: ['Hannah Arendt'], year: 1958 },
    { id: 'origins', title: 'Los orígenes del totalitarismo', authors: ['Hannah Arendt'], year: 1951 },
    { id: 'discipline', title: 'Vigilar y castigar', authors: ['Michel Foucault'], year: 1975 },
  ] }),
  createConversation: async (input: any) => {
    const id = `conversation-${conversations.size + 1}`;
    const conversation = { id, ...input, title: `Conversación de prueba ${conversations.size + 1}`, messages: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived: false };
    conversations.set(id, conversation); return conversation;
  },
  listConversations: async () => [...conversations.values()],
  getConversation: async (id: string) => conversations.get(id),
  saveConversationMessages: async (id: string, messages: any[], meta: any) => {
    win.saved.push({ id, messages, meta }); Object.assign(conversations.get(id), meta, { messages, messageCount: messages.length });
  },
  updateSettings: async (patch: any) => { win.updates.push(patch); return Object.assign(settings, patch); },
  researchChatStream: async (request: any, handlers: any) => {
    win.requests.push(request);
    // A test may script the turn's activity, as the activity balloon receives it.
    for (const event of win.activityScript ?? []) handlers.onActivity?.({ startedAt: Date.now(), ...(event.status !== 'active' ? { finishedAt: Date.now() } : {}), ...event });
    if (win.conciliumLiveRequest) { win.conciliumHandlers = handlers; return win.conciliumLiveRequest(request); }
    handlers.onDelta('Respuesta de prueba.');
    return { answer: 'Respuesta de prueba.', stats: { sections: [], works: 0, documents: 0, passages: 0, contextChars: 0, truncated: false } };
  },
}, { get(target: any, key: string) { return target[key] ?? (key.startsWith('on') ? () => () => {} : async () => []); } });
setActiveLang(params.get('lang') === 'en' || params.get('concilium') ? 'en' : 'es');
document.documentElement.className = `${params.get('theme') === 'dark' ? 'dark' : 'light'} ${vaultType} ${params.get('device') === 'phone' ? 'nodus-phone' : ''}`;
if (params.get('fallback') === 'chat') delete (settings as any).synthesisModel;
const onEvidence = (id: string) => { win.openedEvidence = id; };
ReactDOM.createRoot(document.getElementById('root')!).render(<div className={params.get('device') === 'phone' ? 'mobile-surface' : undefined} style={{ height: '100vh', '--vault-accent': params.get('accent') || vaultTypeColor(vaultType) } as React.CSSProperties}>{view === 'database' ? <DatabasesChatView settings={settings} initialDatabaseId="database-1" /> : view === 'study' || view === 'teaching' ? <StudyChatView settings={settings} variant={view === 'teaching' ? 'teaching' : 'study'} onOpenDocument={onEvidence} onOpenMaterial={onEvidence} onOpenRecording={onEvidence} /> : view === 'world' ? <WorldChatView settings={settings} onNavigate={onEvidence} /> : <ResearchAssistantModal settings={settings} embedded={view === 'embedded'} isGenealogy={params.get('genealogy') === '1'} isAcademic={vaultType === 'academic'} onClose={() => {}} />}</div>);
