import { composerDraftStore, rememberComposerDraft } from '../researchComposerDrafts';
import { useAcademicLearning } from '../learning/AcademicLearningContext';
import { takeLearningPrompt } from '../learning/learningPrompt';
import { learningAnswerReferences } from '../learning/learningEvidence';
import { learningChatRecovery } from '@shared/academicLearning';
import { useAcademicInterface } from '../components/AcademicInterfaceContext';
import { AcademicSecondary } from '../components/AcademicSecondary';
import { ProjectInstructionsDialog } from '../components/ProjectInstructionsDialog';
import { ResearchActivityPanel } from '../components/ResearchActivityPanel';
import { ResearchWebSearchControl } from '../components/ResearchWebSearchControl';
import { ResearchVerificationControl } from '../components/ResearchVerificationControl';
import { ResearchWebSources } from '../components/ResearchWebSources';
import { openWebSource } from '../researchWebSources';
import { settleResearchActivities, updateResearchActivities, type ResearchActivity, type ResearchActivityStatus } from '@shared/researchActivity';
import { ResearchConciliumControl, ConciliumResponses } from '../components/ResearchConcilium';
import type { ConciliumConfig, ConciliumResult } from '@shared/researchConcilium';
import type { ResearchAttachment, ResearchAttachmentSurface } from '@shared/researchAttachments';
import { ResearchSystemPromptControl } from '../components/ResearchSystemPromptControl';
import { useResearchSystemPrompts } from '../hooks/useResearchSystemPrompts';
import { researchChatOrganizer, type ResearchChatAdapter, type ResearchUiMessage } from './researchChatAdapter';
import { SourceFilterPanel } from '../components/ResearchSourceFilterControl';
import { NotebookDialog, useResearchNotebooks } from '../components/ResearchNotebookControl';
import { NotebookHomeHeader, NotebookIndexingBanner } from '../components/ResearchNotebookHome';
import { HeaderBalloon } from '../components/HeaderBalloon';
import { ResearchChatSidebar, formatRelative } from '../components/ResearchChatSidebar';
import { chatDragProps, useChatFolderTreeState, type ChatFolderActions } from '../components/ResearchChatFolderTree';
import { MarqueeText } from '../components/MarqueeText';
import { nextFolderName } from '@shared/researchChatFolders';
import { InvokedSkillPills, SkillMentionMenu, findSkillMention, rankSkillMentions, removeMention, type InvokedSkill } from '../components/SkillMention';
import { useSkillLibrary } from '../components/skillLibrary';
import type { ResearchNotebook, ResearchNotebookPreparation } from '@shared/researchCorpus';
import { matchingResearchWorkIds, normalizeResearchSourceFilter, type ResearchContextSources } from '@shared/researchContextFilters';
import { researchContextIsEmpty, researchContextLayers, researchContextWeb, toggleResearchContextLayer, withResearchContextLayers } from '@shared/researchContextLayers';
import { ResearchCoverage } from '../components/ResearchCoverage';
import { ResearchEffortControl } from '../components/ResearchEffortControl';
import { ModelPicker } from '../components/ModelPicker';
import { liveResearchTurnKey, liveResearchTurns, type LiveResearchTurn } from '../researchLiveTurns';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { ChatAbortedNotice } from '../components/ChatAbortedNotice';
import { ChatSkillsControl } from '../components/ChatSkillsControl';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import type {
  AppSettings,
  ChatConversationSummary,
  ResearchChatProject,
  ResearchChatProjectFolder,
  ModelRef,
  ResearchChatMessage,
  ResearchContextSelection,
  NoteSource,
  ResearchWebSearchMode,
} from '@shared/types';
import { Icon, sortModelRefs } from '../components/ui';
import type { MarkdownCitation } from '../components/Markdown';
import { ConfirmModal } from '../components/ConfirmModal';
import { ChatTypingIndicator } from '../components/ChatTypingIndicator';
import { SaveToNotesModal, type StudyNoteDestination } from '../components/SaveToNotesModal';
import { SourceCitationModal, type CitationTarget } from '../components/SourceCitationModal';
import type { AssistantNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { useResearchEffort } from '../hooks/useResearchEffort';
import { localizeResearchCitationLabels, researchNoteSource, type ResearchConversationNavigationTarget } from '../researchNoteProvenance';
import './researchAssistant.css';

const DEFAULT_SELECTION: ResearchContextSelection = {
  ideas: false,
  themes: false,
  contradictions: false,
  gaps: false,
  readingPath: false,
  authors: false,
  documents: false,
  passages: false,
  graph: false,
  graphParts: {
    ideaNodes: false,
    themeNodes: false,
    ideaEdges: false,
    authorGraph: false,
  },
};

/** A new chat reads every layer of the corpus, and the web while the composer has it on. */
const LAYERED_SELECTION = withResearchContextLayers(DEFAULT_SELECTION, { ideas: true, documents: true, indexed: true });
/** The Simple interface never extracts ideas, so a new chat there reads the indexed texts alone,
 * with the web off: the answer comes from the passages its search returns. */
const INDEXED_SELECTION = withResearchContextLayers(DEFAULT_SELECTION, { ideas: false, documents: false, indexed: true, web: false });

/** The context balloon's corpus layers, each a switch of its own. Full documents read the works
 * from the indexed texts, so switching them on brings the indexed texts too. */
const CONTEXT_LAYERS = [
  { id: 'indexed', icon: 'fileText', label: 'Textos indexados', description: 'Pasajes de tus fuentes encontrados por búsqueda. Si es lo único activo, la respuesta sale solo de ellos.' },
  { id: 'ideas', icon: 'bulb', label: 'Ideas', description: 'Ideas, temas, contradicciones, huecos, rutas de lectura, autores y el grafo que los relaciona.' },
  { id: 'documents', icon: 'book', label: 'Documentos completos', description: 'Lee a fondo las obras a partir de los textos indexados: perfiles documentales, páginas originales y Zotero.' },
] as const;

// Starter prompts offered as clickable chips on an empty chat. They run against
// whatever context is currently selected (every layer by default), so they read as
// general research openers rather than mode switches.
const SIMPLE_CHAT_SUGGESTIONS = ['Resume las fuentes de este vault.', 'Compara lo que dicen estas fuentes.', '¿Qué evidencia respalda esta afirmación?'];
const CHAT_SUGGESTIONS = [
  '¿Cuáles son las ideas más centrales del corpus y por qué?',
  'Resume las principales contradicciones y tensiones.',
  '¿Qué huecos de investigación debería priorizar?',
  'Propón una ruta de lectura para empezar.',
  '¿Qué autores son clave y cómo se relacionan?',
];

// Genealogy-mode openers: they read the family context (people, kinship, events,
// documents, evidence), not the idea graph.
const GENEALOGY_SUGGESTIONS = [
  'Hazme una semblanza de una persona a partir de su evidencia.',
  '¿Qué parentescos sugeridos hay pendientes y con qué evidencia?',
  '¿Hay fechas o datos contradictorios entre las fuentes?',
  '¿Qué documentos mencionan a una misma persona?',
  '¿Qué datos faltan y qué fuente podría aportarlos?',
];

type UiMessage = ResearchUiMessage;
/** What one turn consulted, shown in the activity panel of the chat it belongs to. */
type ActivityRun = { conversationId: string; turnId: string; activities: ResearchActivity[]; outcome: ResearchActivityStatus };

/** How often a streaming answer is repainted: about 20 times a second, instead of once per
 *  delta. Short enough to read as live typing. */
const STREAM_PAINT_MS = 50;

/** An adapter's answer (Study, World, Databases). `renderMessage` builds fresh callback props on
 *  every call, which defeats the memo inside ChatMarkdown, so without this every streamed delta
 *  re-parsed the Markdown of every earlier answer. A delta replaces only the streaming message
 *  object; the others keep their identity and are skipped here. */
const AdapterMessageBody = memo(function AdapterMessageBody({ render, message, streaming }: { render: (message: UiMessage, streaming: boolean) => ReactNode; message: UiMessage; streaming: boolean }) {
  return <>{render(message, streaming)}</>;
});

// Scrolling and opening chat controls must not replace completed citation buttons.
// Keep the callback stable so Markdown retains its DOM and the guide's anchor.
const ResearchMessageBody = memo(function ResearchMessageBody({content,streaming,conversationId,messageId,onCitation,language}:{content:string;streaming:boolean;conversationId?:string;messageId:string;language:string;onCitation:(citation:MarkdownCitation,origin:{conversationId?:string;messageId:string})=>void}){
  const cite=useCallback((citation:MarkdownCitation)=>onCitation(citation,{conversationId,messageId}),[onCitation,conversationId,messageId]);
  return <ChatMarkdown key={language} content={content} streaming={streaming} onCitation={cite}/>;
});

export function ResearchAssistantModal({
  settings,
  initialTarget,
  isGenealogy = false,
  isAcademic = false,
  onClose,
  embedded = false,
  adapter,
  initialConversationTarget,
  notesDestinationLabel = 'Notas',
  studyNoteDestination = null,
  onOpenSavedNote,
}: {
  settings: AppSettings;
  initialTarget?: AssistantNavigationTarget | null;
  /** Genealogy vault: the assistant answers over the family (people, kinship, events,
   *  documents, evidence), so the academic context selector is not shown. */
  isGenealogy?: boolean;
  /** Academic vault: its chats always read the documents of its corpus, so a selection saved
   *  before the context balloon had layers shows its documents layer on. */
  isAcademic?: boolean;
  onClose?: () => void;
  embedded?: boolean;
  adapter?: ResearchChatAdapter;
  initialConversationTarget?: ResearchConversationNavigationTarget | null;
  notesDestinationLabel?: string;
  /** Vaults with their own note store (study, teaching) offer it as a destination. */
  studyNoteDestination?: StudyNoteDestination | null;
  onOpenSavedNote?: (noteId: string) => void;
}) {
  const simpleInterface = useAcademicInterface() === 'simple' && isAcademic && !adapter;
  const newChatSelection = simpleInterface ? INDEXED_SELECTION : LAYERED_SELECTION;
  // A choice saved before the indexed texts had a switch of their own was never made in this
  // balloon, so a new chat in the Simple interface starts from its own default instead.
  const newChatFrom = (current: ResearchContextSelection) => simpleInterface && current.layers?.indexed === undefined ? cloneSelection(INDEXED_SELECTION) : current;
  const api = adapter ?? window.nodus;
  const apiRef = useRef(api);
  apiRef.current = api;
  const panelKey = adapter?.id ?? 'research';
  const [historyOpen, setHistoryOpen] = useState(() => !embedded || localStorage.getItem(`nodus.${panelKey}ChatHistoryOpen`) !== '0');
  const [contextOpen, setContextOpen] = useState(() => embedded && !!adapter && localStorage.getItem(`nodus.${panelKey}ChatContextOpen`) === '1');
  const toggleHistory = () => setHistoryOpen(open => { localStorage.setItem(`nodus.${panelKey}ChatHistoryOpen`, open ? '0' : '1'); return !open; });
  const toggleContext = () => setContextOpen(open => { localStorage.setItem(`nodus.${panelKey}ChatContextOpen`, open ? '0' : '1'); return !open; });
  const learning = useAcademicLearning();
  const draftScope = isAcademic && embedded && !adapter ? learning.vaultId ?? null : null;
  const draftSeed = useRef(composerDraftStore(draftScope));
  const initialDraft = draftSeed.current.drafts[draftSeed.current.lastId ?? 'new'];
  const [selection, setSelection] = useState<ResearchContextSelection>(() => cloneSelection(initialDraft?.selection ? newChatFrom(initialDraft.selection) : newChatSelection));
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState(initialDraft?.input ?? '');
  const [attachments, setAttachments] = useState<ResearchAttachment[]>(initialDraft?.attachments ?? []);
  const [attaching, setAttaching] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const attachmentBusyRef = useRef(false);
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const attachmentSurface = (adapter?.id ?? 'research') as ResearchAttachmentSurface;
  const canUseAttachments = attachments.length > 0 || messages.some(message => message.attachments?.length);

  const [contextTitle, setContextTitle] = useState<string | null>(null);
  const [concilium, setConcilium] = useState<ConciliumConfig | null>(null);
  const [selectedModel, setSelectedModel] = useFeatureModel(settings, adapter?.modelFeature ?? 'chatModel', adapter?.modelFeature === 'studyModel' ? 'chatModel' : undefined);
  // Each chat's latest turn: a chat reopened while it still answers shows its own activity.
  const [activityRuns, setActivityRuns] = useState<Record<string, ActivityRun>>({});
  // Remembered per provider+model: a conversation keeps whatever level the model was last
  // used at, so a level the user picked is not reset by switching chats or models.
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, selectedModel);
  const [webSearch, setWebSearchState] = useState<ResearchWebSearchMode>(settings.researchWebSearch === 'off' ? 'off' : 'auto');
  // The web is this chat's choice, and the composer's saved setting for chats that never made one.
  const setWebSearch = (mode: ResearchWebSearchMode) => {
    setWebSearchState(mode);
    setSelection(current => withResearchContextLayers(current, { ...researchContextLayers(current, isAcademic), web: mode !== 'off' }));
    void window.nodus.updateSettings({ researchWebSearch: mode }).catch(() => undefined);
  };
  const [answerVerification, setAnswerVerificationState] = useState<'off' | 'legacy' | 'structured'>(settings.researchAnswerVerification ?? 'off');
  useEffect(() => { setAnswerVerificationState(settings.researchAnswerVerification ?? 'off'); }, [settings.researchAnswerVerification]);
  const setAnswerVerification = (mode: 'off' | 'structured') => {
    setAnswerVerificationState(mode);
    void window.nodus.updateSettings({ researchAnswerVerification: mode }).catch(() => undefined);
  };
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activityRun = activeId ? activityRuns[activeId] ?? null : null;
  const draftRestoring = useRef(Boolean(draftScope && draftSeed.current.lastId && !initialTarget && !initialConversationTarget));
  useEffect(() => {
    if(!draftRestoring.current)rememberComposerDraft(draftScope,activeId,{input,attachments,selection});
  },[draftScope,activeId,input,attachments,selection]);
  const promptConversationKey = activeId ? `${adapter?.id ?? 'research'}:${activeId}` : null;
  const systemPrompts = useResearchSystemPrompts(promptConversationKey);
  const [showArchived, setShowArchived] = useState(false);
  // Projects, their folders and pinned chats exist where the surface's store keeps them:
  // the vault's research chat, or an adapter's own history (Databases, Worldbuilding, Study).
  const organizer = useMemo(() => adapter ? adapter.organizer ?? null : researchChatOrganizer(), [adapter]);
  const organizerRef = useRef(organizer);
  organizerRef.current = organizer;
  const supportsProjects = !!organizer;
  const [projects, setProjects] = useState<ResearchChatProject[]>([]);
  const [editingProjectInstructions, setEditingProjectInstructions] = useState<ResearchChatProject | null>(null);
  // Folder navigation belongs to the history; project homes always show every chat.
  const [projectFolders, setProjectFolders] = useState<ResearchChatProjectFolder[]>([]);
  const folderTree = useChatFolderTreeState();
  // A project's page: shown while it is open and no conversation has started in it.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [editingNotebook, setEditingNotebook] = useState<ResearchNotebook | 'new' | null>(null);
  // Skills invoked with @ for the next message: typed in the composer, sent with the turn.
  const skillsEnabled = !adapter;
  const skillLibrary = useSkillLibrary();
  const [invokedSkills, setInvokedSkills] = useState<InvokedSkill[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOptions = skillsEnabled && mention ? rankSkillMentions(skillLibrary.skills, mention.query) : [];
  const projectHome = supportsProjects && !!activeProjectId && !activeId;
  const activeProject = projects.find(project => project.id === activeProjectId) ?? null;
  const projectPlacement = projectHome ? { projectId: activeProjectId } : {};
  const researchNotebooks = useResearchNotebooks(!adapter && !isGenealogy);
  // A notebook's page, like a project's: shown while it is open and no chat has started in it.
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const activeNotebook = researchNotebooks.notebooks.find(notebook => notebook.id === activeNotebookId) ?? null;
  // An adapter's notebook-equivalent: its own notebooks (Databases, Worldbuilding) or Study's courses.
  const adapterNotebooks = adapter?.notebooks;
  const adapterNotebook = adapterNotebooks?.entries.find(notebook => notebook.id === activeNotebookId) ?? null;
  const notebookHome = (!!activeNotebook || !!adapterNotebook) && !activeId;
  const [notebookPreparation, setNotebookPreparation] = useState<ResearchNotebookPreparation | null>(null);
  // A notebook is read once its collections are indexed; until then it says so and waits.
  const notebookBlocked = !!activeNotebook && (!notebookPreparation || notebookPreparation.pending > 0);
  const [pendingDelete, setPendingDelete] = useState<ChatConversationSummary | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<ChatConversationSummary[] | null>(null);
  const [citationOrigin, setCitationOrigin] = useState<{conversationId?:string;messageId?:string}>({});
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [noteTarget, setNoteTarget] = useState<{ content: string; title: string; source: NoteSource } | null>(null);
  const [conversationNotice, setConversationNotice] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  // The context balloon's two tabs: how the assistant approaches the corpus, and which of it.
  const [contextTab, setContextTab] = useState<'focus' | 'library'>('focus');
  // The context picker opens as a header balloon, like its neighbours.
  // Id of the last assistant message the user stopped. Its partial text stays and
  // the red notice renders under it instead of replacing the whole answer.
  const [stoppedMessageId, setStoppedMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const lastInitialTargetRef = useRef<number | null>(null);
  const lastConversationTargetRef = useRef<number | null>(null);
  // Mirrors `messages` so async stream callbacks can persist the final array without
  // racing React state updates.
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;
  // Mirrors `activeId` so in-flight stream callbacks only touch the UI while their
  // own conversation is on screen — this lets the user switch chats mid-response
  // without the stream overwriting the conversation they switched to.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  // This view's identity in the store of turns in progress, which outlives the view.
  const viewId = useRef(crypto.randomUUID()).current;
  const liveScope = adapter?.id ?? 'research';
  // Turns run per conversation, several at once: only the chat on screen locks while its own
  // turn runs, and the user can open other chats or start new ones meanwhile. Re-renders when a
  // turn starts, is repainted or ends; the streamed text is painted by the turn itself.
  useSyncExternalStore(liveResearchTurns.subscribe, () => liveResearchTurns.signature(liveScope));
  const liveTurnOnScreen = activeId ? liveResearchTurns.get(liveResearchTurnKey(liveScope, activeId)) : null;
  const sending = !!liveTurnOnScreen;
  // Id of the assistant message streaming on screen — drives the live caret and the "stop"
  // affordance. Null when the chat on screen is not answering.
  const streamingId = liveTurnOnScreen?.assistantId ?? null;
  // Set once the main process repaints the turn with its own finished text (skills run, route
  // checks pending): its drawings are complete blocks and render instead of "Loading…".
  const repaintedId = liveTurnOnScreen?.repainted ? liveTurnOnScreen.assistantId : null;
  // The history marks every chat still answering.
  const runningConversationIds = new Set(liveResearchTurns.active().filter(turn => turn.key.startsWith(`${liveScope}:`)).map(turn => turn.conversationId));
  const updateActivityRun = (conversationId: string, turnId: string, change: (run: ActivityRun) => ActivityRun) =>
    setActivityRuns(runs => runs[conversationId]?.turnId === turnId ? { ...runs, [conversationId]: change(runs[conversationId]) } : runs);
  // A chat whose turn is still running shows it from the store of turns in progress: when it is
  // reopened (a turn paints only while its chat is on screen), and when the turn was sent by a
  // view that has since unmounted (the user left the chat and came back). The activity of this
  // view's own turns is already kept per chat, and may be settled while the turn still saves.
  const showLiveTurn = useCallback((live: LiveResearchTurn) => {
    setMessages([...live.base, { id: live.assistantId, role: 'assistant', content: live.content, reasoning: live.reasoning || undefined, concilium: live.concilium, selectionKey: live.selectionKey }]);
    if (live.owner !== viewId) setActivityRuns(runs => ({ ...runs, [live.conversationId]: { conversationId: live.conversationId, turnId: live.assistantId, activities: live.activities, outcome: 'active' } }));
  }, [viewId]);
  // Stops one chat's turn; the surface's other chats keep answering.
  const stopTurn = (conversationId: string) => {
    const key = liveResearchTurnKey(liveScope, conversationId);
    if (!liveResearchTurns.get(key)) return;
    liveResearchTurns.requestStop(key);
    void api.cancelResearchChat(conversationId);
  };
  // Bumped by every conversation load and by "new chat": a load whose answer arrives after a
  // newer one started (two chats clicked in quick succession) must not replace it.
  const loadSequenceRef = useRef(0);

  const availableModels = useMemo(() => {
    const models: ModelRef[] = [];
    const add = (model: ModelRef | null | undefined) => {
      if (!model || models.some((m) => sameModelRef(m, model))) return;
      models.push(model);
    };
    add(settings.synthesisModel);
    add(settings.chatModel);
    add(selectedModel);
    for (const model of settings.favorites ?? []) add(model);
    for (const model of concilium?.models ?? []) add(model);
    return sortModelRefs(models);
  }, [settings.chatModel, settings.favorites, settings.synthesisModel, selectedModel, concilium]);

  const refreshConversations = useCallback(async () => {
    const store = organizerRef.current;
    const [list, projectList, folderList] = await Promise.all([
      apiRef.current.listConversations(true),
      store ? store.listProjects() : Promise.resolve([] as ResearchChatProject[]),
      store ? store.listFolders() : Promise.resolve([] as ResearchChatProjectFolder[]),
    ]);
    setConversations(list);
    setProjects(projectList);
    setProjectFolders(folderList);
  }, [supportsProjects]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Auto-grow the composer to fit its content, capped by CSS max-height (then it scrolls).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
  }, [input]);



  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  const updateJumpIndicator = useCallback(() => {
    const el = scrollRef.current;
    setShowJumpToBottom(!!el && el.scrollHeight > el.clientHeight + 16 && !isNearBottom());
  }, [isNearBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      updateJumpIndicator();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    updateJumpIndicator();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateJumpIndicator, isNearBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJumpToBottom(false);
  }, []);

  const copyMessageMarkdown = useCallback(async (message: UiMessage) => {
    const text = message.content.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    window.setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1400);
  }, []);

  // What the balloon offers: the corpus layers and the web. A selection saved before layers
  // existed is read from its sections, as the backend reads it.
  const contextLayers = useMemo(() => researchContextLayers(selection, isAcademic), [selection, isAcademic]);
  const turnWebSearch: ResearchWebSearchMode = researchContextWeb(selection, webSearch !== 'off') ? 'auto' : 'off';
  const selectedCount = Number(contextLayers.indexed) + Number(contextLayers.ideas) + Number(contextLayers.documents) + Number(turnWebSearch !== 'off');
  const sourceFilterOn = !!selection.sourceFilter?.enabled && !selection.notebookId;
  // The works the Library tab authorizes, counted for the Focus tab's summary while it is open.
  const [contextSources, setContextSources] = useState<ResearchContextSources | null>(null);
  useEffect(() => {
    if (!showContext || !sourceFilterOn) return;
    let active = true;
    void window.nodus.listResearchContextSources().then(sources => { if (active) setContextSources(sources); }).catch(() => undefined);
    return () => { active = false; };
  }, [showContext, sourceFilterOn]);
  const authorizedWorks = sourceFilterOn && contextSources ? matchingResearchWorkIds(contextSources, normalizeResearchSourceFilter(selection.sourceFilter)).length : null;
  const authorizedSourcesSummary = !sourceFilterOn ? t('Toda la biblioteca')
    : authorizedWorks === null ? t('Biblioteca filtrada')
      : authorizedWorks === 1 ? t('1 obra autorizada') : tx('{n} obras autorizadas', { n: authorizedWorks });
  // A notebook's chats read its collections: the Library tab is only for general chats.
  const shownContextTab = contextTab === 'library' && !selection.notebookId ? 'library' : 'focus';

  const setContextLayer = (layer: (typeof CONTEXT_LAYERS)[number]['id'], on: boolean) =>
    setSelection(current => withResearchContextLayers(current, toggleResearchContextLayer(researchContextLayers(current, isAcademic), layer, on)));

  const startNewConversation = () => {
    if (attachmentBusyRef.current) return;
    loadSequenceRef.current++;
    setAttachments([]);
    setAttachmentError('');
    setSelection(current => { const { sourceFilter: _sourceFilter, notebookId: _notebookId, ...rest } = current; return newChatFrom(rest); });
    setActiveNotebookId(null);
    adapter?.reset?.();
    if (!activeId) void systemPrompts.select(null);
    setActiveProjectId(null);
    // Now, not at the next render: a turn still running in the chat left behind stops painting here.
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setInput('');
    setStoppedMessageId(null);
    setContextTitle(null);
    setShowJumpToBottom(false);
    setCopiedMessageId(null);
  };

  useEffect(() => {
    if (!initialTarget || initialTarget.nonce === lastInitialTargetRef.current) return;
    lastInitialTargetRef.current = initialTarget.nonce;
    loadSequenceRef.current++;
    setAttachments([]);
    setAttachmentError('');
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setStoppedMessageId(null);
    setContextTitle(initialTarget.title ?? null);
    setSelection(current => cloneSelection(initialTarget.selection ?? { ...current, sourceFilter: undefined }));
    if (initialTarget.prompt) setInput(initialTarget.prompt);
    setShowJumpToBottom(false);
    setCopiedMessageId(null);
  }, [initialTarget]);

  const loadConversation = async (id: string, messageId?: string | null, messageIndex?: number | null, restoringDraft = false): Promise<boolean> => {
    if (attachmentBusyRef.current) return false;
    const sequence = ++loadSequenceRef.current;
    const conversation = await api.getConversation(id);
    if (sequence !== loadSequenceRef.current) return false;
    if (!conversation) {
      await refreshConversations();
      setConversationNotice(t('La conversación original ya no está disponible.'));
      return false;
    }
    const storedAttachments = await window.nodus.listResearchAttachments({ surface: attachmentSurface, conversationId: id });
    if (sequence !== loadSequenceRef.current) return false;
    const referenced = new Set(conversation.messages.flatMap(message => message.attachments?.map(file => file.id) ?? []));
    setAttachments((storedAttachments ?? []).filter(file => !referenced.has(file.id)));
    setAttachmentError('');
    setActiveId(conversation.id);
    const loadedMessages = conversation.messages.map((m) => ({ ...m, id: m.id || crypto.randomUUID() }));
    setMessages(loadedMessages);
    // A turn still running in this conversation replaces what was saved before it finished.
    activeIdRef.current = conversation.id;
    const live = liveResearchTurns.get(liveResearchTurnKey(liveScope, conversation.id));
    if (live) showLiveTurn(live);
    const council = loadedMessages.filter(message => message.role === 'assistant').at(-1)?.concilium;
    setConcilium(council ? { chairman: council.chairman, models: council.members.map(member => member.model) } : null);
    setStoppedMessageId(null);
    setSelection(cloneSelection(conversation.selection ?? newChatSelection));
    setActiveNotebookId(conversation.selection?.notebookId ?? conversation.notebookId ?? null);
    if (conversation.model && !restoringDraft) setSelectedModel(conversation.model);
    setContextTitle(conversation.title || null);
    const draft = composerDraftStore(draftScope).drafts[id];
    setInput(draft?.input ?? '');
    if(draft?.attachments.length)setAttachments(draft.attachments);
    draftRestoring.current=false;
    setConversationNotice(null);
    const resolvedMessageId = loadedMessages.some((message) => message.id === messageId)
      ? messageId
      : messageIndex != null
        ? loadedMessages[messageIndex]?.id
        : null;
    if ((messageId || messageIndex != null) && !resolvedMessageId) {
      setConversationNotice(t('La conversación está disponible, pero el mensaje original ya no existe.'));
    }
    if (resolvedMessageId) {
      setHighlightedMessageId(resolvedMessageId);
      window.setTimeout(() => {
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(resolvedMessageId) : resolvedMessageId.replace(/["\\]/g, '\\$&');
        document.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      window.setTimeout(() => setHighlightedMessageId((current) => current === resolvedMessageId ? null : current), 2400);
    } else {
      window.setTimeout(() => scrollToBottom('auto'), 0);
    }
    return true;
  };

  useEffect(() => {
    const target = initialConversationTarget;
    if (!target || target.surface !== attachmentSurface || target.nonce === lastConversationTargetRef.current) return;
    lastConversationTargetRef.current = target.nonce;
    void loadConversation(target.conversationId, target.messageId, target.messageIndex);
  }, [initialConversationTarget?.nonce]);

  const openProject = (projectId: string) => {
    startNewConversation();
    setActiveProjectId(projectId);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const createProject = async (): Promise<ResearchChatProject | null> => {
    if (!supportsProjects) return null;
    const base = t('Nuevo proyecto');
    const taken = new Set(projects.map(project => project.name));
    let name = base;
    for (let index = 2; taken.has(name); index++) name = `${base} ${index}`;
    const created = await organizer!.createProject({ name });
    await refreshConversations();
    return created;
  };
  const updateProject = async (project: ResearchChatProject, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }) => {
    await organizer!.updateProject(project.id, patch);
    await refreshConversations();
  };
  const deleteProject = async (project: ResearchChatProject) => {
    await organizer!.deleteProject(project.id);
    if (activeProjectId === project.id) setActiveProjectId(null);
    if (folderTree.selection?.projectId === project.id) folderTree.select(null);
    await refreshConversations();
  };
  // Every store renames its chats: Research Chat's own call, or the adapter's.
  const renameApi = adapter ? adapter.renameConversation : window.nodus.renameConversation;
  const renameConversation = async (conversation: ChatConversationSummary, title: string) => {
    await renameApi!(conversation.id, title);
    if (conversation.id === activeId) setContextTitle(title);
    await refreshConversations();
  };
  const pinConversation = async (conversation: ChatConversationSummary, pinned: boolean) => {
    await organizer!.setPinned(conversation.id, pinned);
    await refreshConversations();
  };
  const moveConversation = async (conversation: ChatConversationSummary, projectId: string | null) => {
    await organizer!.setProject(conversation.id, projectId);
    await refreshConversations();
  };
  const folderActions: ChatFolderActions = {
    folders: projectFolders,
    onCreateFolder: async (projectId, parentId) => {
      if (!organizer) return null;
      const created = await organizer.createFolder({ projectId, parentId, name: nextFolderName(projectFolders, projectId, parentId, t('Nueva carpeta')) });
      await refreshConversations();
      return created;
    },
    onRenameFolder: async (folder, name) => { await organizer!.renameFolder(folder.id, name); await refreshConversations(); },
    onMoveFolder: async (folder, parentId, index) => { await organizer!.moveFolder(folder.id, parentId, index); await refreshConversations(); },
    onDeleteFolder: async (folder) => { await organizer!.deleteFolder(folder.id); await refreshConversations(); },
    onFileConversation: async (conversation, folderId) => { await organizer!.setFolder(conversation.id, folderId); await refreshConversations(); },
    onMoveConversation: moveConversation,
  };
  // A notebook opens on its own page; the first message there starts a chat inside it.
  const openNotebook = (notebookId: string) => {
    startNewConversation();
    setActiveNotebookId(notebookId);
    // An adapter points its own context at it; Research Chat reads it through the selection.
    if (adapterNotebooks) adapterNotebooks.open(notebookId);
    else setSelection(current => ({ ...current, notebookId }));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const activeNotebookRef = useRef<string | null>(null);
  activeNotebookRef.current = activeNotebookId;
  const refreshNotebookPreparation = useCallback(async (notebookId: string) => {
    try {
      const status = await window.nodus.getResearchNotebookPreparation(notebookId);
      setNotebookPreparation(current => activeNotebookRef.current === notebookId ? status : current);
    } catch { /* The page shows its last known state; the next progress event retries. */ }
  }, []);
  useEffect(() => {
    setNotebookPreparation(null);
    if (!activeNotebookId || adapter) return;
    void refreshNotebookPreparation(activeNotebookId);
    let timer: number | null = null;
    const off = window.nodus.onResearchPreparationProgress(() => {
      if (timer != null) return;
      timer = window.setTimeout(() => { timer = null; void refreshNotebookPreparation(activeNotebookId); }, 1200);
    });
    return () => { off(); if (timer != null) window.clearTimeout(timer); };
  }, [activeNotebookId, refreshNotebookPreparation]);
  const updateNotebook = async (notebook: { id: string }, patch: { name?: string; icon?: string | null; color?: string | null }) => {
    if (adapterNotebooks) { await adapterNotebooks.update?.(notebook.id, patch); return; }
    await window.nodus.updateResearchNotebookAppearance(notebook.id, patch);
    await researchNotebooks.refresh();
  };
  /** A notebook goes; its chats return to the general history. */
  const deleteNotebook = async (notebook: { id: string }) => {
    if (adapterNotebooks) await adapterNotebooks.remove?.(notebook.id);
    else await window.nodus.deleteResearchNotebook(notebook.id);
    if (activeNotebookId === notebook.id) startNewConversation();
    if (!adapterNotebooks) await researchNotebooks.refresh();
    await refreshConversations();
  };

  // The multiple selection acts on every chat, then refreshes the history once.
  const moveConversations = async (conversations: ChatConversationSummary[], projectId: string | null) => {
    for (const conversation of conversations) if (conversation.projectId !== projectId) await organizer!.setProject(conversation.id, projectId);
    await refreshConversations();
  };
  const archiveConversations = async (conversations: ChatConversationSummary[], archived: boolean) => {
    for (const conversation of conversations) if (!!conversation.archived !== archived) await api.archiveConversation?.(conversation.id, archived);
    await refreshConversations();
  };
  const confirmBulkDelete = async () => {
    const deleting = pendingBulkDelete ?? [];
    setPendingBulkDelete(null);
    for (const conversation of deleting) {
      stopTurn(conversation.id);
      await api.deleteConversation(conversation.id);
      await window.nodus.selectResearchSystemPrompt(`${adapter?.id ?? 'research'}:${conversation.id}`, null);
    }
    if (deleting.some(conversation => conversation.id === activeId)) startNewConversation();
    await refreshConversations();
  };
  const archiveConversation = async (conversation: ChatConversationSummary) => {
    await api.archiveConversation?.(conversation.id, !conversation.archived);
    await refreshConversations();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    stopTurn(pendingDelete.id);
    await api.deleteConversation(pendingDelete.id);
    await window.nodus.selectResearchSystemPrompt(`${adapter?.id ?? 'research'}:${pendingDelete.id}`, null);
    if (pendingDelete.id === activeId) startNewConversation();
    setPendingDelete(null);
    await refreshConversations();
  };

  const persist = useCallback(
    async (conversationId: string, finalMessages: UiMessage[], shouldTitle: boolean) => {
      const records: UiMessage[] = finalMessages.map((m) => ({
        concilium: m.concilium,
        interrupted: m.interrupted,
        study: m.study,
        attachments: m.attachments,
        id: m.id,
        role: m.role,
        content: m.content,
        selectionKey: m.selectionKey ?? null,
        stats: m.stats ?? null,
        error: m.error ?? false,
      }));
      await api.saveConversationMessages(conversationId, records, { model: selectedModel, selection, ...(!adapter && draftScope ? {vaultId:draftScope} : {}) });
      if (shouldTitle && (!draftScope || (await window.nodus.getActiveVault()).id === draftScope)) {
        await api.generateConversationTitle?.(conversationId, selectedModel)?.catch(() => '');
      }
      await refreshConversations();
    },
    [api, adapter, draftScope, refreshConversations, selectedModel, selection]
  );

  // Runs one assistant turn against `priorMessages` + a fresh user turn. Shared by
  // the composer (send) and the regenerate action, which only differ in how they
  // pick the prior history and the user prompt.
  const generate = async (conversationId: string, priorMessages: UiMessage[], content: string, files: ResearchAttachment[] = [], skills: InvokedSkill[] = []) => {
    if (!selectedModel) return;
    const selectionKey = adapter?.contextKey ?? serializeSelection(selection);
    const isFirstExchange = priorMessages.length === 0;
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content, selectionKey, attachments: files, ...(skills.length ? { skills } : {}) };
    const assistantId = crypto.randomUUID();
    const requestMessages: ResearchChatMessage[] = [
      ...priorMessages.filter((m) => (m.selectionKey === selectionKey || (adapter && !m.selectionKey)) && !m.error && m.content.trim()),
      userMessage,
    ].map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));

    setStoppedMessageId(null);
    const onScreen = () => activeIdRef.current === conversationId;
    if (onScreen()) setMessages([...priorMessages, userMessage, { id: assistantId, role: 'assistant', content: '', selectionKey }]);
    const liveKey = liveResearchTurnKey(liveScope, conversationId);
    liveResearchTurns.start({ key: liveKey, owner: viewId, conversationId, assistantId, selectionKey, base: [...priorMessages, userMessage] });
    // Stopped in this chat, here or from a view mounted after this one left. Read when the stream
    // settles, so a cancellation that still rejects is not mistaken for a genuine failure.
    const stopped = () => !!liveResearchTurns.get(liveKey)?.stopRequested;
    let settled: UiMessage[] | null = null;
    let outcome: ResearchActivityStatus = 'failed';
    setActivityRuns(runs => ({ ...runs, [conversationId]: { conversationId, turnId: assistantId, activities: [], outcome: 'active' } }));
    // Reveal the question and the beginning of the answer once. Streaming
    // deltas must not chase the bottom: keeping this position stable lets the
    // user read from the start and scroll through the reply at their own pace,
    // matching Nodi's chat behaviour.
    if (onScreen()) window.setTimeout(() => scrollToBottom('auto'), 0);

    let streamed = '';
    let reasoned = '';
    let councilResult: ConciliumResult | undefined;
    // Deltas arrive one IPC message at a time, often faster than the screen refreshes, and
    // each one used to re-render the timeline and re-parse the growing answer's Markdown.
    // They are gathered and painted together at most every STREAM_PAINT_MS. A paint writes
    // the whole answer so far, so it also completes a chat reopened mid-answer.
    let paintTimer: number | null = null;
    const paint = () => {
      paintTimer = null;
      if (!onScreen()) return; // user switched away
      const content = streamed;
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content } : message));
      window.setTimeout(updateJumpIndicator, 0);
    };
    const dropUnpainted = () => {
      if (paintTimer != null) window.clearTimeout(paintTimer);
      paintTimer = null;
    };
    try {
      await persist(conversationId, [...priorMessages, userMessage], false);
      const response = await api.researchChatStream(
        { attachmentIds: [...new Set([...priorMessages, userMessage].flatMap(message => message.attachments?.map(file => file.id) ?? []))], messages: requestMessages, selection, model: selectedModel, conversationId, thinkingEffort, ...(!adapter ? { webSearch: turnWebSearch } : {}), systemPromptId: systemPrompts.selectedId, concilium: !adapter ? concilium ?? undefined : undefined, ...(skillsEnabled && skills.length ? { skillIds: skills.map(skill => skill.id) } : {}) },
        {
          // A terminal event may arrive after the turn settled (it travels on another IPC pipe
          // than the reply); it then replaces the placeholder the settlement wrote.
          onActivity: event => {
            liveResearchTurns.update(liveKey, turn => ({ activities: updateResearchActivities(turn.activities, event) }));
            updateActivityRun(conversationId, assistantId, run => run.outcome === 'active' || event.status !== 'active' ? { ...run, activities: updateResearchActivities(run.activities, event) } : run);
          },
          onConcilium: (result) => {
            councilResult = result;
            liveResearchTurns.update(liveKey, () => ({ concilium: result }));
            if (!onScreen()) return;
            setMessages(current => current.map(message => message.id === assistantId ? { ...message, concilium: result } : message));
          },
          onReplace: (text) => {
            // The repaint is the whole turn so far: deltas still waiting to be painted are in it.
            dropUnpainted();
            streamed = text;
            liveResearchTurns.update(liveKey, () => ({ content: text, repainted: !!text }));
            if (!onScreen()) return;
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: text } : message));
            window.setTimeout(updateJumpIndicator, 0);
          },
          onDelta: (delta) => {
            streamed += delta;
            liveResearchTurns.update(liveKey, () => ({ content: streamed }));
            if (paintTimer == null) paintTimer = window.setTimeout(paint, STREAM_PAINT_MS);
          },
          onReasoning: (delta) => {
            reasoned += delta;
            liveResearchTurns.update(liveKey, () => ({ reasoning: reasoned }));
            if (!onScreen()) return;
            const reasoning = reasoned;
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, reasoning } : message));
          },
        }
      );
      // The settled answer below replaces the streamed text; a paint still pending would
      // append its deltas to it a second time.
      dropUnpainted();
      // A user-triggered stop resolves with the partial answer; treat an empty
      // partial as "nothing generated" and drop the placeholder bubble.
      const aborted = stopped() || Boolean(response.aborted);
      outcome = aborted ? 'cancelled' : 'completed';
      const settledOutcome = outcome;
      updateActivityRun(conversationId, assistantId, run => ({ ...run, activities: settleResearchActivities(run.activities, settledOutcome), outcome: settledOutcome }));
      if ('concilium' in response && response.concilium) councilResult = response.concilium;
      const answer = response.answer.trim();
      const finalMessages: UiMessage[] = answer || councilResult
        ? [
            ...priorMessages,
            userMessage,
            { id: assistantId, role: 'assistant', content: answer, concilium: councilResult, selectionKey, stats: response.stats, ...('message' in response ? response.message : {}), interrupted: aborted },
          ]
        : [...priorMessages, userMessage];
      settled = finalMessages;
      if (onScreen()) {
        setMessages(finalMessages);
        if (aborted && answer) setStoppedMessageId(assistantId);
        window.setTimeout(updateJumpIndicator, 0);
      }
      await persist(conversationId, finalMessages, isFirstExchange);
      if (!adapter && learning.session && ['first-answer','research-question'].includes(learning.session.lessonId)) {
        if (aborted) learning.emit({ kind: 'recovery', recovery: 'cancelled' });
        else {
          const refs = await learningAnswerReferences(answer, learning.session.documentId, learning.session.documentRevision);
          if (refs.citationIds.length) learning.emit({ kind: 'answer', ...refs, conversationId, messageId: assistantId, valid: true });
          else learning.emit({ kind: 'recovery', recovery: 'no-citation', conversationId, messageId: assistantId });
        }
      }
    } catch (e) {
      const stoppedNow = stopped();
      outcome = stoppedNow ? 'cancelled' : 'failed';
      if (!adapter) learning.emit({ kind: 'recovery', recovery: learningChatRecovery(e, stoppedNow), conversationId, messageId: assistantId });
      dropUnpainted();
      const settledOutcome = outcome;
      updateActivityRun(conversationId, assistantId, run => ({ ...run, activities: settleResearchActivities(run.activities, settledOutcome), outcome: settledOutcome }));
      if (stoppedNow) {
        // The user stopped the stream: keep the text that already arrived and mark
        // the message as aborted instead of replacing everything with the error.
        const partial = streamed.trim();
        const finalMessages: UiMessage[] = partial || councilResult
          ? [...priorMessages, userMessage, { id: assistantId, role: 'assistant', content: partial, concilium: councilResult, interrupted: true, selectionKey }]
          : [...priorMessages, userMessage];
        settled = finalMessages;
        if (onScreen()) {
          setMessages(finalMessages);
          if (partial) setStoppedMessageId(assistantId);
          window.setTimeout(updateJumpIndicator, 0);
        }
        await persist(conversationId, finalMessages, false);
      } else {
        const errorMessage: UiMessage = {
          id: assistantId,
          role: 'assistant',
          content: (e instanceof Error ? e.message : String(e)).includes('research_notebook_indexing')
            ? t('El cuaderno aún está indexando sus colecciones. Podrás usarlo cuando termine.')
            : e instanceof Error ? e.message : String(e),
          selectionKey,
          error: true,
          concilium: councilResult,
        };
        const finalMessages = [...priorMessages, userMessage, errorMessage];
        settled = finalMessages;
        if (onScreen()) {
          setMessages(finalMessages);
          window.setTimeout(updateJumpIndicator, 0);
        }
        await persist(conversationId, finalMessages, false);
      }
    } finally {
      dropUnpainted();
      // Saved by now: the chat unlocks, and shows the settled conversation if it is on screen.
      liveResearchTurns.finish(liveKey, settled, outcome);
    }
  };

  // The chat on screen follows its turn from the store when this view did not send it (the
  // user left the chat and came back): the activity and the streaming answer, exactly as the
  // view that sent it would show them. When any turn of the chat on screen ends, the chat shows
  // what was saved, also for a turn of this view's that settled while the chat was elsewhere.
  useEffect(() => {
    // Deltas arrive faster than the screen paints; following views repaint at the stream's pace.
    let timer: number | null = null;
    const liveOnScreen = () => activeIdRef.current ? liveResearchTurns.get(liveResearchTurnKey(liveScope, activeIdRef.current)) : null;
    const off = liveResearchTurns.subscribe(turn => {
      if (!activeIdRef.current || turn.key !== liveResearchTurnKey(liveScope, activeIdRef.current)) return;
      if (turn.done) {
        if (timer != null) { window.clearTimeout(timer); timer = null; }
        if (turn.final) setMessages(turn.final);
        if (turn.owner !== viewId) updateActivityRun(turn.conversationId, turn.assistantId, run => ({ ...run, activities: settleResearchActivities(run.activities, turn.outcome === 'active' ? 'completed' : turn.outcome), outcome: turn.outcome }));
        return;
      }
      if (turn.owner === viewId || timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const live = liveOnScreen();
        if (live && live.owner !== viewId) showLiveTurn(live);
      }, STREAM_PAINT_MS);
    });
    return () => { off(); if (timer != null) window.clearTimeout(timer); };
  }, [viewId, liveScope, showLiveTurn]);

  useEffect(() => {
    if (adapter) return;
    const prepare = () => {
      const value = takeLearningPrompt(learning.vaultId, learning.session?.id);
      if (!value) return;
      if(selection.notebookId && activeId){rememberComposerDraft(draftScope,activeId,{input,attachments,selection});startNewConversation();}
      loadSequenceRef.current++; draftRestoring.current=false;
      setInput(current => current.includes(value.prompt) ? current : current.trim() ? `${current}\n\n${value.prompt}` : value.prompt);
      // A question about one document reads its indexed text; full documents stay as chosen.
      if (value.documentId) setSelection(current => ({ ...withResearchContextLayers(current, { ...researchContextLayers(current, isAcademic), ideas: false, indexed: true }), notebookId:null, sourceFilter: { enabled: true, workIds: [value.documentId!], authorIds: [] } }));
      inputRef.current?.focus();
    };
    prepare(); window.addEventListener('nodus:learning-prompt', prepare);
    return () => window.removeEventListener('nodus:learning-prompt', prepare);
  }, [adapter, learning.vaultId, learning.session?.id, selection.notebookId, activeId]);

  useEffect(() => {
    if(!draftRestoring.current || !draftSeed.current.lastId)return;
    void loadConversation(draftSeed.current.lastId,undefined,undefined,true).finally(()=>{draftRestoring.current=false;});
  },[]);

  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const field = inputRef.current;
    if (caret == null || !field) return;
    pendingCaretRef.current = null;
    field.focus();
    field.setSelectionRange(caret, caret);
  }, [input]);
  const pickSkill = (skill: { id: string; name: string }) => {
    if (!mention) return;
    const next = removeMention(input, mention);
    setInput(next.text);
    setInvokedSkills(current => current.some(item => item.id === skill.id) ? current : [...current, { id: skill.id, name: skill.name }].slice(0, 8));
    setMention(null);
    // Placed in the same commit as the new text: a frame later, a key typed straight after
    // the pick landed before the caret moved.
    pendingCaretRef.current = next.caret;
  };

  const send = async (explicit?: string) => {
    const content = (explicit ?? input).trim() || (attachments.length ? t('Analiza los archivos adjuntos.') : '');
    if (!content || sending || notebookBlocked || attachmentBusyRef.current || attachments.some(file => file.kind === 'unsupported') || !selectedModel || !systemPrompts.ready || (adapter?.canSend === false && !canUseAttachments)) return;

    // Lazily create the conversation on the first message so empty chats never clutter history.
    let conversationId = activeId;
    if (!conversationId) {
      const created = await api.createConversation({ model: selectedModel, selection, title: content.slice(0, 80), ...projectPlacement, ...(adapterNotebook ? { notebookId: adapterNotebook.id } : {}) });
      conversationId = created.id;
      await window.nodus.selectResearchSystemPrompt(`${adapter?.id ?? 'research'}:${created.id}`, systemPrompts.selectedId);
      activeIdRef.current = created.id;
      setActiveId(created.id);
    }
    // Only the composer's own text is cleared on send; an explicit prompt (a
    // suggestion chip) must not wipe a draft the user may have typed.
    if (!explicit) setInput('');
    const files = explicit ? [] : attachments;
    if (!explicit) setAttachments([]);
    const turnSkills = explicit ? [] : invokedSkills;
    if (!explicit) { setInvokedSkills([]); setMention(null); }
    await generate(conversationId, messagesRef.current, content, files, turnSkills);
  };

  // One click on a route-fix prompt sends the checker's correction request as the user's
  // next message. The model only proposes; the reply is re-checked and re-drawn.
  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (typeof prompt === 'string' && prompt.trim()) void send(prompt);
    };
    window.addEventListener('nodus:route-fix', handler as EventListener);
    return () => window.removeEventListener('nodus:route-fix', handler as EventListener);
  }, [send]);

  // Re-answer the most recent user turn (dropping the answer it produced). Uses the
  // current model + context selection, so it doubles as "try again with this context".
  const regenerateLast = async () => {    if (sending || !selectedModel || !systemPrompts.ready) return;
    const current = messagesRef.current;
    let lastUserIdx = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i].role === 'user' && current[i].content.trim()) {
        lastUserIdx = i;
        break;
      }
    }
    const conversationId = activeIdRef.current;
    if (lastUserIdx < 0 || !conversationId) return;
    await generate(conversationId, current.slice(0, lastUserIdx), current[lastUserIdx].content, current[lastUserIdx].attachments, current[lastUserIdx].skills);
  };

  const addAttachments = async (filePaths?: string[]) => {
    if (sending || attachmentBusyRef.current) return;
    attachmentBusyRef.current = true; setAttaching(true); setAttachmentError('');
    try {
      let id = activeIdRef.current;
      if (!id) {
        const created = await api.createConversation({ model: selectedModel, selection, ...projectPlacement });
        id = created.id; activeIdRef.current = id; setActiveId(id);
        await window.nodus.selectResearchSystemPrompt(`${attachmentSurface}:${id}`, systemPrompts.selectedId);
      }
      const owner = { surface: attachmentSurface, conversationId: id };
      const result = filePaths
        ? await window.nodus.importResearchAttachments(owner, filePaths)
        : await window.nodus.pickResearchAttachments(owner);
      if (activeIdRef.current === id) {
        setAttachments(current => [...current, ...result.attachments]);
        setAttachmentError(result.errors.join('\n'));
      }
      await refreshConversations();
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
    finally { attachmentBusyRef.current = false; setAttaching(false); }
  };
  const handleFileDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = sending || attachmentBusyRef.current ? 'none' : 'copy';
    if (event.type === 'dragenter') dragDepthRef.current += 1;
    if (!sending && !attachmentBusyRef.current) setDraggingFiles(true);
  };
  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (sending || attachmentBusyRef.current) return;
    try {
      // Resolve native paths before the drop event's FileList becomes unavailable.
      const paths = Array.from(event.dataTransfer.files, file => window.nodus.getPathForDroppedFile(file));
      if (!paths.length || paths.some(path => !path)) throw new Error(t('No se pudieron leer los archivos arrastrados. Usa el botón + para añadirlos.'));
      void addAttachments(paths);
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
  };
  const removeAttachment = async (file: ResearchAttachment) => {
    if (!activeId || attaching) return;
    try {
      await window.nodus.removeResearchAttachment({ surface: attachmentSurface, conversationId: activeId }, file.id);
      setAttachments(current => current.filter(item => item.id !== file.id));
    } catch (error) { setAttachmentError(String(error)); }
  };
  const renderAttachments = (files: ResearchAttachment[], draft = false) => (
    <div className="research-attachments" aria-label={t('Archivos adjuntos')}>
      {files.map(file => <div key={file.id} className={`research-attachment ${file.kind === 'unsupported' ? 'research-attachment-warning' : ''}`} title={file.warning ?? file.name}>
        <span className="research-attachment-type">{file.name.split('.').at(-1)?.slice(0, 5).toUpperCase() || 'FILE'}</span>
        <button className="research-attachment-name" disabled={draft} onClick={() => { if (activeId) void window.nodus.saveResearchAttachment({ surface: attachmentSurface, conversationId: activeId }, file.id).catch(error => setAttachmentError(String(error))); }}>
          <strong>{file.name}</strong><span>{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`} · {file.kind === 'unsupported' ? t('Sin lector') : file.kind === 'image' ? t('Visión') : t('Documento')}{file.warning ? ' · ⚠' : ''}</span>
        </button>
        {draft && <button className="research-attachment-remove" aria-label={`${t('Quitar adjunto')}: ${file.name}`} disabled={attaching || sending} onClick={() => void removeAttachment(file)}>×</button>}
      </div>)}
    </div>
  );

  // Stops the chat on screen only; other chats keep answering.
  const handleStop = () => { if (activeIdRef.current) stopTurn(activeIdRef.current); };

  const visibleConversations = conversations.filter((c) => showArchived || !c.archived);
  const archivedCount = conversations.filter((c) => c.archived).length;
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  // Citations open their evidence workspace without replacing the conversation.
  const handleCitation = useCallback((c: MarkdownCitation, origin?: {conversationId?:string;messageId?:string}) => {
    setCitationOrigin(origin ?? {});
    // A web source opens where it lives: a new tab of Nodus' Browser, landing on the
    // quoted passage. Library sources keep their citation workspace.
    if (c.kind === 'passage' && c.id.startsWith('web:')) {
      void window.nodus.getCitationPreview({ kind: 'passage', id: c.id }).then(preview => {
        if (preview?.openUrl || preview?.url) openWebSource(preview.openUrl ?? preview.url!);
        else setCitation({ kind: c.kind, id: c.id });
      }).catch(() => setCitation({ kind: c.kind, id: c.id }));
      return;
    }
    setCitation({ kind: c.kind, id: c.id });
  }, []);

  // The same searchable picker as the rest of the app, over this chat's own list.
  const chatModelControl = (<div className="max-w-xs min-w-[11rem]" data-testid="research-chat-model">
    <ModelPicker settings={settings} value={selectedModel} models={availableModels} onChange={setSelectedModel}
      compact menu triggerModelOnly allowEmpty={!selectedModel} disabled={sending || !!concilium}
      ariaLabel={concilium ? t('Chairman') : t('Modelo del chat')} />
  </div>);
  return (
    <div className={embedded ? "research-chat-surface research-chat-view h-full min-h-0 flex flex-col" : "research-chat-surface fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center"} data-testid={embedded ? "research-chat-view" : undefined}>
      <div
        role={embedded ? "region" : "dialog"}
        aria-label="Research chat"
        onDragEnter={handleFileDrag}
        onDragOver={handleFileDrag}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDraggingFiles(false);
        }}
        onDrop={handleFileDrop}
        aria-modal={embedded ? undefined : true}
        className={embedded ? "relative w-full h-full min-h-0 bg-neutral-950 flex flex-col overflow-hidden" : "relative w-full max-w-7xl h-[86vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"}
      >
        {draggingFiles && <div className="research-file-drop-overlay" role="status">
          <div className="research-file-drop-label"><Icon name="plus" size={28} /><strong>{t('Suelta los archivos para adjuntarlos')}</strong></div>
        </div>}
        <header className="research-assistant-header px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
          {embedded && <button type="button" className="btn btn-ghost border border-neutral-700" data-testid="research-history-toggle" aria-label={t('Historial de chats')} title={t('Historial de chats')} aria-expanded={historyOpen} onClick={toggleHistory}><Icon name="clock" size={16} /></button>}
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="chat" className="research-accent-text" />
            {embedded ? 'Research chat' : t('Asistente de investigación')}
          </div>
          {!simpleInterface && chatModelControl}
          <div className="research-assistant-actions">
          {adapter ? <button className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs py-1 research-accent-soft research-accent-text" disabled={sending} data-testid="research-context-toggle" aria-expanded={contextOpen} onClick={toggleContext}><Icon name="layers" size={15} />{t('Contexto')}</button> : isGenealogy ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border research-accent-soft px-2 py-1 text-xs research-accent-text"
              title={t('El asistente usa el contexto familiar: personas, parentescos, eventos, documentos y evidencia.')}
            >
              <Icon name="tree" size={13} /> <span className="hidden sm:inline">{t('Contexto familiar')}</span>
            </span>
          ) : (
            <button
              type="button"
              ref={contextTriggerRef}
              data-testid="research-context-trigger"
              className={`chat-skills-trigger research-context-trigger ${sourceFilterOn ? 'is-filtered' : ''}`}
              title={sourceFilterOn ? `${t('Elegir qué partes del corpus ve el asistente')} · ${t('Biblioteca filtrada')}` : t('Elegir qué partes del corpus ve el asistente')}
              aria-haspopup="dialog"
              aria-expanded={showContext}
              onClick={() => setShowContext((value) => !value)}
            >
              <Icon name="layers" size={15} />
              <span className="hidden min-w-0 truncate sm:inline">{t(simpleInterface ? 'Fuentes' : 'Contexto')}</span>
              {sourceFilterOn && <Icon name="library" size={12} aria-label={t('Biblioteca filtrada')} />}
              <span className="chat-skills-count">{selectedCount}</span>
            </button>
          )}
          <AcademicSecondary compact={simpleInterface} label="Opciones">
            {simpleInterface && chatModelControl}
          <ResearchSystemPromptControl prompts={systemPrompts.prompts} selectedId={systemPrompts.selectedId} disabled={sending || !systemPrompts.ready} onSelect={systemPrompts.select} refresh={systemPrompts.refresh} />
          <ChatSkillsControl surface="assistant" disabled={sending} />
          {!adapter && <ResearchConciliumControl value={concilium} models={availableModels} selectedModel={selectedModel} disabled={sending} onChange={next => {
            setConcilium(next);
            if (next) setSelectedModel(next.models[next.chairman]);
          }} />}
            {simpleInterface && <ResearchEffortControl model={selectedModel} value={thinkingEffort} onChange={setThinkingEffort} disabled={sending} />}
          </AcademicSecondary>
          {simpleInterface && <span className="research-simple-context text-xs text-neutral-500" title={authorizedSourcesSummary}>{[...CONTEXT_LAYERS.flatMap(layer => contextLayers[layer.id] ? [t(layer.label)] : []), ...(turnWebSearch !== 'off' ? [t('Búsqueda web')] : [])].join(' · ')}</span>}


          </div>
          <div className="flex-1" />
          {!embedded && <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>}
        </header>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Conversation history */}
          <aside hidden={!historyOpen} data-testid="research-history-sidebar" className="research-chat-history w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-neutral-800 flex flex-col max-h-48 md:max-h-none">
            <ResearchChatSidebar
              conversations={visibleConversations}
              projects={projects}
              notebooks={adapterNotebooks ? adapterNotebooks.entries : researchNotebooks.notebooks}
              supportsProjects={supportsProjects}
              notebooksOn={adapterNotebooks ? true : researchNotebooks.available}
              notebookKind={adapterNotebooks?.kind}
              notebookCollections={!adapterNotebooks}
              notebookLocksMoves={adapterNotebooks ? adapterNotebooks.locksMoves : true}
              activeId={activeId}
              activeProjectId={activeProjectId}
              runningIds={runningConversationIds}
              archivedCount={archivedCount}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((value) => !value)}
              onNewConversation={startNewConversation}
              onNewNotebook={adapterNotebooks ? adapterNotebooks.create && (() => adapterNotebooks.create!(openNotebook)) : () => setEditingNotebook('new')}
              onNewProject={createProject}
              onOpenConversation={(id) => void loadConversation(id)}
              onOpenProject={openProject}
              activeNotebookId={activeNotebookId}
              onOpenNotebook={openNotebook}
              onEditNotebook={adapterNotebooks
                ? adapterNotebooks.editSources && (notebook => adapterNotebooks.editSources!(notebook.id))
                : notebook => setEditingNotebook(researchNotebooks.notebooks.find(item => item.id === notebook.id) ?? null)}
              onUpdateNotebook={!adapterNotebooks || adapterNotebooks.update ? updateNotebook : undefined}
              onDeleteNotebook={!adapterNotebooks || adapterNotebooks.remove ? deleteNotebook : undefined}
              onRenameConversation={renameApi ? renameConversation : undefined}
              onPinConversation={pinConversation}
              onArchiveConversation={api.archiveConversation ? archiveConversation : undefined}
              onDeleteConversation={setPendingDelete}
              onMoveConversation={moveConversation}
              onDeleteConversations={setPendingBulkDelete}
              onArchiveConversations={api.archiveConversation ? archiveConversations : undefined}
              onMoveConversations={supportsProjects ? moveConversations : undefined}
              onUpdateProject={updateProject}
              onEditProjectInstructions={setEditingProjectInstructions}
              onDeleteProject={deleteProject}
              folderTree={folderTree}
              folderActions={folderActions}
            />
          </aside>

          <section className={`flex-1 min-w-0 min-h-0 flex flex-col ${projectHome || notebookHome ? 'research-project-home' : ''}`} data-testid={projectHome ? 'research-project-home' : notebookHome ? 'research-notebook-home' : undefined}>
            {notebookHome && activeNotebook && <NotebookHomeHeader notebook={activeNotebook} onEdit={() => setEditingNotebook(activeNotebook)} />}
            {notebookHome && adapterNotebook && <header className="research-project-title" data-testid="research-adapter-notebook-title">
              <span style={{ color: adapterNotebook.color ?? undefined }}><Icon name={adapterNotebook.icon ?? (adapterNotebooks?.kind === 'course' ? 'graduation' : 'notebook')} size={30} /></span>
              <h2>{adapterNotebook.name}</h2>
              {adapterNotebooks?.editSources && <button type="button" className="btn btn-ghost text-xs" onClick={() => adapterNotebooks.editSources!(adapterNotebook.id)}>{t('Editar fuentes')}</button>}
            </header>}
            {projectHome && activeProject && <header className="research-project-title">
              <span style={{ color: activeProject.color ?? undefined }}><Icon name={activeProject.icon ?? 'folder'} size={30} /></span>
              <h2>{activeProject.name}</h2>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditingProjectInstructions(activeProject)}><Icon name="brain" size={14} />{t('Instrucciones del proyecto')}</button>
            </header>}
            <div className="relative flex-1 min-h-0">
              {!adapter && !isGenealogy && activityRun?.conversationId === activeId && <ResearchActivityPanel key={activityRun.turnId} activities={activityRun.activities} outcome={activityRun.outcome} webDisabled={turnWebSearch === 'off'} disabledLayers={[...(contextLayers.ideas ? [] : ['ideas', 'graph'] as const), ...(contextLayers.indexed ? [] : ['nodus'] as const), ...(contextLayers.documents ? [] : ['profiles', 'zotero', 'context'] as const)]} />}
              <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-3">
                {conversationNotice && (
                  <div role="status" className="mx-auto max-w-xl rounded-lg border border-amber-800/70 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                    {conversationNotice}
                  </div>
                )}
                {projectHome && activeProjectId && messages.length === 0 && <ProjectChatList
                  conversations={visibleConversations.filter(conversation => conversation.projectId === activeProjectId)}
                  draggable onOpen={(id) => void loadConversation(id)}
                />}
                {notebookHome && messages.length === 0 && <ProjectChatList
                  conversations={visibleConversations.filter(conversation => conversation.notebookId === activeNotebookId)}
                  onOpen={(id) => void loadConversation(id)}
                  empty={adapterNotebooks?.kind === 'course' ? t('Los chats que empieces aquí leerán los materiales de este curso.')
                    : adapterNotebooks ? t('Los chats que empieces aquí leerán las fuentes de este cuaderno.') : t('Los chats que empieces aquí leerán las colecciones de este cuaderno.')}
                />}
                {!projectHome && !notebookHome && messages.length === 0 && (
                  <div className="research-empty-state h-full flex flex-col items-center justify-center gap-5 px-4 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="grid h-12 w-12 place-items-center rounded-full border research-accent-soft research-accent-text">
                        <Icon name="chat" size={22} />
                      </span>
                      <p className="max-w-md text-sm text-neutral-400">
                        {adapter ? t(adapter.subtitle) : isGenealogy
                          ? t('Pregunta sobre personas, parentescos, eventos, documentos y evidencia de la familia.')
                          : simpleInterface ? t('Pregunta sobre tus fuentes y comprueba las citas de las respuestas.') : t('Pregunta sobre ideas, autores, temas, contradicciones o documentos.')}
                      </p>
                    </div>
                    <div className="flex max-w-xl flex-wrap justify-center gap-2">
                      {(adapter?.suggestions ?? (isGenealogy ? GENEALOGY_SUGGESTIONS : simpleInterface ? SIMPLE_CHAT_SUGGESTIONS : CHAT_SUGGESTIONS)).map((suggestion) => (
                        <button
                          key={suggestion}
                          className="suggestion-chip"
                          disabled={sending || !selectedModel || !systemPrompts.ready || (adapter?.canSend === false && !canUseAttachments)}
                          onClick={() => void send(t(suggestion))}
                        >
                          {t(suggestion)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    className={`msg-in flex rounded-lg transition-shadow duration-500 ${highlightedMessageId === message.id ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-neutral-950' : ''} ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`research-message group relative max-w-[78%] rounded-lg border px-3 py-2 text-sm ${message.role === 'assistant' ? 'pr-24' : 'pr-16'} ${
                        message.role === 'user'
                          ? 'research-accent-solid text-white whitespace-pre-wrap'
                          : message.error
                            ? 'bg-red-950/40 border-red-800 text-red-200 whitespace-pre-wrap'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-200'
                      }`}
                    >
                      <div className="absolute right-2 top-2 flex items-center gap-0.5">
                        {message.role === 'assistant' &&
                          (!message.error || message.concilium) &&
                          message.id === lastMessageId &&
                          message.id !== streamingId &&
                          (message.content.trim() || message.concilium) && (
                            <button
                              className="rounded p-1 text-neutral-500 opacity-70 transition hover:bg-neutral-800 research-accent-hover hover:opacity-100 disabled:opacity-40"
                              title={t('Regenerar respuesta')}
                              onClick={() => void regenerateLast()}
                              disabled={sending}
                            >
                              <Icon name="refresh" size={13} />
                            </button>
                          )}
                        {message.role === 'assistant' && !message.error && message.content.trim() && (
                          <button
                            className="rounded p-1 text-neutral-500 opacity-70 transition hover:bg-neutral-800 research-accent-hover hover:opacity-100"
                            title={t('Guardar en notas')}
                            onClick={() => {
                              if (!activeId) return;
                              const summary = conversations.find((conversation) => conversation.id === activeId);
                              const fallbackTitle = messages.find((candidate) => candidate.role === 'user' && candidate.content.trim())?.content.trim().slice(0, 80);
                              const conversationTitle = summary?.title || contextTitle || fallbackTitle || t('Research chat');
                              setNoteTarget({
                                content: isAcademic ? localizeResearchCitationLabels(message.content,t('Fuente')) : message.content,
                                title: deriveNoteTitle(message.content, conversationTitle),
                                source: researchNoteSource({
                                  surface: attachmentSurface,
                                  conversationId: activeId,
                                  conversationTitle,
                                  message,
                                  messageIndex: messages.findIndex((candidate) => candidate.id === message.id),
                                  model: summary?.model ?? selectedModel,
                                }),
                              });
                            }}
                          >
                            <Icon name="notebook" size={13} />
                          </button>
                        )}
                        <button
                          className={`rounded p-1 opacity-70 transition hover:opacity-100 ${
                            message.role === 'user'
                              ? 'text-white hover:bg-white/10'
                              : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'
                          }`}
                          title={copiedMessageId === message.id ? t('Copiado') : t('Copiar en Markdown')}
                          onClick={() => void copyMessageMarkdown(message)}
                          disabled={!message.content.trim()}
                        >
                          <Icon name={copiedMessageId === message.id ? 'check' : 'copy'} size={13} />
                        </button>
                      </div>
                      {message.attachments?.length ? renderAttachments(message.attachments) : null}
                      {message.skills?.length ? <InvokedSkillPills skills={message.skills} /> : null}
                      {message.concilium && <ConciliumResponses result={message.concilium} onCitation={c => handleCitation(c, {conversationId: activeId ?? undefined, messageId: message.id})} />}
                      {message.role === 'assistant' && message.reasoning?.trim() && (
                        <details className="mb-2 rounded border border-neutral-800 bg-neutral-950/60">
                          <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200">
                            {t('Razonamiento')}
                          </summary>
                          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-neutral-500">
                            {message.reasoning}
                          </div>
                        </details>
                      )}
                      {message.role === 'assistant' && !message.error ? (
                        message.content ? (
                          <div className={message.id === streamingId ? 'stream-body' : undefined}>
                            {adapter ? <AdapterMessageBody render={adapter.renderMessage} message={message} streaming={message.id === streamingId} /> : <ResearchMessageBody language={settings.uiLanguage ?? 'es'} content={message.content} conversationId={activeId ?? undefined} messageId={message.id} onCitation={handleCitation} streaming={message.id === streamingId && message.id !== repaintedId} />}
                            {message.id === streamingId && <span aria-hidden className="stream-caret" />}
                          </div>
                        ) : message.id === streamingId ? (
                          <ChatTypingIndicator label={t('Generando…')} />
                        ) : null
                      ) : (
                        message.content
                      )}
                      {message.role === 'assistant' && (message.id === stoppedMessageId || message.interrupted) && <ChatAbortedNotice />}
                      {message.error && message.id === lastMessageId && !sending && (
                        <button
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-800/70 px-2 py-1 text-xs text-red-200 transition hover:bg-red-900/40"
                          onClick={() => void regenerateLast()}
                        >
                          <Icon name="refresh" size={12} /> {t('Reintentar')}
                        </button>
                      )}
                      {message.stats && (
                        <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-500 whitespace-normal">
                          {message.stats.sections.join(', ') || t('Sin secciones')} · {tx('{n} obras', { n: message.stats.works })} ·{' '}
                          {tx('{n} docs', { n: message.stats.documents })} · {tx('{n} pasajes', { n: message.stats.passages })} · {formatChars(message.stats.contextChars)}
                          {message.stats.truncated ? ` · ${t('recortado')}` : ''}
                          {(message.stats.webSources?.length || message.stats.webSearch?.searched) && <ResearchWebSources sources={message.stats.webSources ?? []} search={message.stats.webSearch} answer={message.content} />}
                          {message.stats.researchTraversal && <ResearchCoverage value={message.stats.researchTraversal} />}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {showJumpToBottom && (
                <button
                  className={`absolute bottom-4 ${!adapter && !isGenealogy && activityRun?.conversationId === activeId ? 'left-4' : 'right-4'} h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900/95 text-neutral-200 shadow-lg transition hover:bg-neutral-800`}
                  title={t('Bajar al final')}
                  onClick={() => scrollToBottom()}
                >
                  <Icon name="arrowDown" />
                </button>
              )}
            </div>

            <footer className="research-composer-footer">
              {systemPrompts.error && <p className="text-xs text-red-500 mb-2" role="alert">{systemPrompts.error}</p>}
              {attachmentError && <p className="research-attachment-error" role="alert">{attachmentError}</p>}
              {attachments.some(file => file.warning) && <p className="research-attachment-error" role="status">{attachments.filter(file => file.warning).map(file => `${file.name}: ${file.warning}`).join(' · ')}</p>}
              {attaching && <p className="research-attachment-status" role="status">{t('Preparando archivos…')}</p>}
              {activeNotebook && <NotebookIndexingBanner preparation={notebookPreparation} />}
              <div className="research-composer-shell">
              {mention && skillsEnabled && <SkillMentionMenu options={mentionOptions} activeIndex={mentionIndex}
                onHover={setMentionIndex} onPick={pickSkill} />}
              {attachments.length > 0 && renderAttachments(attachments, true)}
              <InvokedSkillPills skills={invokedSkills} onRemove={id => setInvokedSkills(current => current.filter(skill => skill.id !== id))} />
              <div className="research-composer">
                <button className="research-composer-attach" aria-label={t('Añadir archivos')} title={t('Añadir archivos')} disabled={sending || attaching} onClick={() => void addAttachments()}><Icon name="plus" size={23} /></button>
                <textarea
                  ref={inputRef}
                  className="research-composer-input"
                  aria-label={t('Pregunta al asistente...')}
                  rows={1}
                  value={input}
                  placeholder={notebookHome && (activeNotebook ?? adapterNotebook) ? tx('Nuevo chat en {name}', { name: (activeNotebook ?? adapterNotebook)!.name }) : projectHome && activeProject ? tx('Nuevo chat en {name}', { name: activeProject.name }) : t('Pregunta al asistente...')}
                  aria-autocomplete={skillsEnabled ? 'list' : undefined}
                  aria-controls={mention ? 'research-skill-mention' : undefined}
                  aria-activedescendant={mention && mentionOptions.length ? `research-skill-option-${mentionIndex}` : undefined}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (skillsEnabled) { setMention(findSkillMention(e.target.value, e.target.selectionStart ?? e.target.value.length)); setMentionIndex(0); }
                  }}
                  onBlur={() => setMention(null)}
                  onKeyDown={(e) => {
                    if (mention && !e.nativeEvent.isComposing) {
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
                      if (mentionOptions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault();
                        setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length);
                        return;
                      }
                      if (mentionOptions.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                        e.preventDefault();
                        pickSkill(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {!adapter && !isGenealogy && <ResearchWebSearchControl value={turnWebSearch} onChange={setWebSearch} disabled={sending} />}
                {!adapter && !isGenealogy && <ResearchVerificationControl value={answerVerification} onChange={setAnswerVerification} disabled={sending} />}
                {!simpleInterface && <ResearchEffortControl model={selectedModel} value={thinkingEffort} onChange={setThinkingEffort} disabled={sending} />}
                {sending ? (
                  <button
                    className="research-composer-send research-composer-stop"
                    aria-label={t('Detener generación')}
                    title={t('Detener generación')}
                    onClick={handleStop}
                  >
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button
                    className="research-composer-send"
                    aria-label={t('Enviar')}
                    title={t('Enviar')}
                    onClick={() => void send()}
                    disabled={attaching || notebookBlocked || (!input.trim() && !attachments.length) || attachments.some(file => file.kind === 'unsupported') || !selectedModel || !systemPrompts.ready || (adapter?.canSend === false && !canUseAttachments)}
                  >
                    <Icon name="arrowUp" size={23} />
                  </button>
                )}
              </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-neutral-400">
                <kbd className="composer-kbd">Enter</kbd>
                <span>{t('para enviar')}</span>
                <span className="text-neutral-700">·</span>
                <kbd className="composer-kbd">Shift</kbd>
                <span>+</span>
                <kbd className="composer-kbd">Enter</kbd>
                <span>{t('salto de línea')}</span>
                {skillsEnabled && <>
                  <span className="text-neutral-700">·</span>
                  <kbd className="composer-kbd">@</kbd>
                  <span>{t('para usar skills')}</span>
                </>}
              </div>
            </footer>
          </section>
          {embedded && adapter && contextOpen && <aside className={`research-chat-context ${adapter?.id === 'study' ? 'w-96 min-w-[280px] max-w-[45vw]' : 'w-72'} shrink-0 overflow-y-auto border-l border-neutral-800 p-4`} data-testid="research-context-sidebar">
            <div className="mb-4 flex items-center gap-2"><h2 className="text-xs font-semibold">{t('Ámbito y fuentes')}</h2><button className="btn btn-ghost ml-auto" title={t('Ocultar ámbito y fuentes')} onClick={toggleContext}><Icon name="x" size={14} /></button></div>
            <fieldset disabled={sending} className="min-w-0 space-y-3">{adapter.contextPanel}</fieldset>
          </aside>}
        </div>
      </div>

      <HeaderBalloon
        open={showContext}
        anchor={contextTriggerRef}
        onClose={() => setShowContext(false)}
        icon={<Icon name="layers" size={18} />}
        title={t('Contexto del asistente')}
        meta={tx('{n} seleccionados', { n: selectedCount })}
        testId="research-context-panel"
        className="research-context-panel"
        bodyClassName="context-balloon-body"
      >
        <div className="header-balloon-tabs" role="tablist" aria-label={t('Contexto del asistente')}>
          {([['focus', 'layers', t('Enfoque')], ...(selection.notebookId ? [] : [['library', 'library', t('Biblioteca')]])] as Array<['focus' | 'library', string, string]>).map(([id, icon, label]) => (
            <button key={id} type="button" role="tab" className="header-balloon-tab" data-testid={`research-context-tab-${id}`} aria-selected={shownContextTab === id}
              aria-label={label} title={label} onClick={() => setContextTab(id)}>
              <Icon name={icon} size={16} />{shownContextTab === id && <span>{label}</span>}
            </button>
          ))}
        </div>
        {shownContextTab === 'library' ? <SourceFilterPanel key={activeId ?? 'new'} value={selection.sourceFilter} onClose={() => setShowContext(false)} onApply={async sourceFilter => {
          const next = { ...selection, sourceFilter };
          if (activeId) await api.saveConversationMessages(activeId, messagesRef.current, { model: selectedModel, selection: next });
          setSelection(next);
          setShowContext(false);
        }} /> : <div className="context-tab-panel" role="tabpanel" aria-label={t('Enfoque')}>
          <div className="context-tab-scroll">
            <p className="research-context-intro">{t('Elige qué consulta el asistente antes de responder.')}</p>
            <div className="research-context-layers" data-testid="research-context-layers">
              {CONTEXT_LAYERS.map(layer => <ContextLayerSwitch key={layer.id} testId={`research-context-layer-${layer.id}`} icon={layer.icon} label={t(layer.label)}
                description={t(layer.description)} checked={contextLayers[layer.id]} disabled={sending} onChange={on => setContextLayer(layer.id, on)} />)}
              <ContextLayerSwitch testId="research-context-layer-web" icon="globe" label={t('Búsqueda web')}
                description={t('Páginas públicas de Internet, cuando la biblioteca no basta o se lo pides.')} checked={turnWebSearch !== 'off'} disabled={sending}
                onChange={on => setWebSearch(on ? 'auto' : 'off')} />
            </div>
            {selection.notebookId ? <div className="research-context-sources" data-testid="research-context-sources">
              <Icon name="notebook" size={15} /><span><strong>{t('Fuentes autorizadas')}</strong><small>{t('Las del cuaderno de este chat.')}</small></span>
            </div> : <button type="button" className="research-context-sources" data-testid="research-context-sources" onClick={() => setContextTab('library')}>
              <Icon name="filter" size={15} /><span><strong>{t('Fuentes autorizadas')}</strong><small>{authorizedSourcesSummary}</small></span>
              <Icon name="chevronRight" size={14} />
            </button>}
            {researchContextIsEmpty(contextLayers, turnWebSearch !== 'off') && <p className="research-context-empty" role="status" data-testid="research-context-empty">
              {t('Sin fuentes: el asistente responderá con conocimiento general y lo dirá en la respuesta.')}</p>}
          </div>
          <footer className="header-balloon-foot"><button className="btn btn-primary w-full" onClick={() => setShowContext(false)}>{t('Listo')}</button></footer>
        </div>}
      </HeaderBalloon>

      {adapterNotebooks?.overlay}
      {editingNotebook && <NotebookDialog notebook={editingNotebook === 'new' ? null : editingNotebook}
        onClose={() => setEditingNotebook(null)}
        onSaved={async (id) => {
          const created = editingNotebook === 'new';
          await researchNotebooks.refresh();
          setEditingNotebook(null);
          if (id && created) openNotebook(id);
          else if (id && id === activeNotebookId) void refreshNotebookPreparation(id);
        }} />}
      {editingProjectInstructions && <ProjectInstructionsDialog project={editingProjectInstructions}
        onClose={() => setEditingProjectInstructions(null)}
        onSave={instructions => updateProject(editingProjectInstructions, { instructions })} />}
      {pendingDelete && (
        <ConfirmModal
          title={t('Eliminar conversación')}
          message={
            <>
              {t('Se eliminará')} <span className="text-neutral-200">«{pendingDelete.title}»</span> {t('y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.')}
            </>
          }
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingBulkDelete && (
        <ConfirmModal
          title={t('Eliminar conversaciones')}
          message={tx('Se eliminarán {n} conversaciones y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.', { n: pendingBulkDelete.length })}
          confirmLabel={t('Eliminar')}
          danger
          onConfirm={() => void confirmBulkDelete()}
          onCancel={() => setPendingBulkDelete(null)}
        />
      )}

      {citation && (
        <SourceCitationModal learningOrigin={citationOrigin}
          target={citation}
          onClose={() => setCitation(null)}
        />
      )}

      {noteTarget && (
        <SaveToNotesModal
          content={noteTarget.content}
          defaultTitle={noteTarget.title}
          kind="assistant"
          source={noteTarget.source}
          destinationLabel={notesDestinationLabel}
          studyDocument={studyNoteDestination}
          onClose={() => setNoteTarget(null)}
          onOpenSavedNote={onOpenSavedNote ? (note) => onOpenSavedNote(note.id) : undefined}
        />
      )}
    </div>
  );
}

/** Build a short note title from the answer's first heading/line, falling back to the context. */
function deriveNoteTitle(content: string, contextTitle: string | null): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/[*_`>#-]/g, '').trim())
    .find((line) => line.length > 0);
  const base = firstLine || contextTitle || 'Respuesta del asistente';
  return base.length > 80 ? `${base.slice(0, 77)}…` : base;
}

/** The chats of an open project, under its composer. */
function ProjectChatList({ conversations, onOpen, empty, draggable = false }: { conversations: ChatConversationSummary[]; onOpen: (id: string) => void; empty?: string; draggable?: boolean }) {
  if (!conversations.length) return <p className="research-project-empty">{empty ?? t('Los chats que empieces aquí quedarán en este proyecto.')}</p>;
  return <ul className="research-project-chats" data-testid="research-project-chats">
    {conversations.map(conversation => <li key={conversation.id} data-testid={`research-project-chat-${conversation.id}`} {...(draggable ? chatDragProps(conversation) : {})}>
      <button type="button" data-marquee-host onClick={() => onOpen(conversation.id)}>
        <MarqueeText text={conversation.title} className="research-project-chat-title" />
        <span className="research-project-chat-date">{formatRelative(conversation.updated_at)}</span>
      </button>
    </li>)}
  </ul>;
}

/** One layer of the context balloon: what it reads, and a switch. */
function ContextLayerSwitch({ testId, icon, label, description, checked, disabled, onChange }: {
  testId: string; icon: string; label: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="research-context-layer" data-testid={testId}
    onClick={() => onChange(!checked)}>
    <Icon name={icon} size={16} />
    <span><strong>{label}</strong><small>{description}</small></span>
    <span className="research-context-switch" aria-hidden="true"><span /></span>
  </button>;
}

function sameModelRef(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function cloneSelection(selection: ResearchContextSelection): ResearchContextSelection {
  return {
    ...selection,
    passages: selection.passages ?? true,
    graphParts: { ...selection.graphParts },
  };
}

function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M chars`;
  if (chars >= 1000) return `${Math.round(chars / 1000)}k chars`;
  return `${chars} chars`;
}

function serializeSelection(selection: ResearchContextSelection): string {
  const { sourceFilter, ...sections } = selection;
  const filter = normalizeResearchSourceFilter(sourceFilter);
  return JSON.stringify(filter.enabled ? { ...sections, sourceFilter: filter } : sections);
}
