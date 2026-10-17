import type { ReactNode } from 'react';
import type { ChatConversation, ChatConversationSummary, ChatHistorySurface, ChatMessageRecord, ModelRef, ResearchChatProject, ResearchChatProjectFolder, ResearchChatRequest, ResearchContextSelection, ResearchContextStats, StudyAssistantMessage } from '@shared/types';

export interface ResearchUiMessage extends ChatMessageRecord {
  reasoning?: string;
  interrupted?: boolean;
  study?: StudyAssistantMessage;
}

/** Only the transport and vault-specific evidence differ; all chat chrome is shared. */
export interface ResearchChatAdapter {
  id: string;
  contextKey: string;
  contextPanel: ReactNode;
  canSend?: boolean;
  subtitle: string;
  suggestions: string[];
  modelFeature?: 'chatModel' | 'studyModel';
  reset?: () => void;
  listConversations: (includeArchived?: boolean) => Promise<ChatConversationSummary[]>;
  getConversation: (id: string) => Promise<(Omit<ChatConversation, 'messages'> & { messages: ResearchUiMessage[] }) | null>;
  /** A chat started on a project's page starts in it (and its selected folder); one
   * started on a notebook's page, in that notebook. */
  createConversation: (input: { model?: ModelRef | null; selection?: ResearchContextSelection; title?: string; projectId?: string | null; folderId?: string | null; notebookId?: string | null }) => Promise<{ id: string }>;
  saveConversationMessages: (id: string, messages: ResearchUiMessage[], options: { model?: ModelRef | null; selection?: ResearchContextSelection }) => Promise<unknown>;
  deleteConversation: (id: string) => Promise<unknown>;
  archiveConversation?: (id: string, archived: boolean) => Promise<unknown>;
  renameConversation?: (id: string, title: string) => Promise<unknown>;
  /** Projects, their folders and pins, where the surface's store keeps them. */
  organizer?: ChatHistoryOrganizer;
  /** The surface's notebook-equivalent, shown in the history like Research Chat's notebooks. */
  notebooks?: ChatHistoryNotebooks;
  generateConversationTitle?: (id: string, model?: ModelRef | null) => Promise<unknown>;
  researchChatStream: (request: ResearchChatRequest, handlers: import('@shared/types').ResearchChatStreamHandlers) => Promise<{ answer: string; aborted?: boolean; stats?: ResearchContextStats; message?: Partial<ResearchUiMessage> }>;
  /** Stops the turn of that conversation; the surface's other chats keep answering. */
  cancelResearchChat: (conversationId: string) => Promise<unknown>;
  renderMessage: (message: ResearchUiMessage, streaming: boolean) => ReactNode;
}

export function nativeSummary(conversation: {
  id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; model?: ModelRef | null; archived?: boolean;
  projectId?: string | null; folderId?: string | null; pinnedAt?: string | null; notebookId?: string | null;
}): ChatConversationSummary {
  return {
    id: conversation.id, title: conversation.title, created_at: conversation.createdAt, updated_at: conversation.updatedAt, messageCount: conversation.messageCount,
    model: conversation.model ?? null, archived: conversation.archived ?? false,
    projectId: conversation.projectId ?? null, folderId: conversation.folderId ?? null, pinnedAt: conversation.pinnedAt ?? null, notebookId: conversation.notebookId ?? null,
  };
}

/** What a chat history's projects, folders and pins can do: Research Chat's calls, for any store. */
export interface ChatHistoryOrganizer {
  listProjects: () => Promise<ResearchChatProject[]>;
  createProject: (input: { name: string; icon?: string | null; color?: string | null; instructions?: string }) => Promise<ResearchChatProject>;
  updateProject: (id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }) => Promise<unknown>;
  deleteProject: (id: string) => Promise<unknown>;
  listFolders: () => Promise<ResearchChatProjectFolder[]>;
  createFolder: (input: { projectId: string; parentId?: string | null; name: string }) => Promise<ResearchChatProjectFolder>;
  renameFolder: (id: string, name: string) => Promise<unknown>;
  moveFolder: (id: string, parentId: string | null, index?: number) => Promise<unknown>;
  deleteFolder: (id: string) => Promise<unknown>;
  setProject: (conversationId: string, projectId: string | null) => Promise<unknown>;
  setFolder: (conversationId: string, folderId: string | null) => Promise<unknown>;
  setPinned: (conversationId: string, pinned: boolean) => Promise<unknown>;
}

/** Research Chat's own store, where the transport has one. */
export function researchChatOrganizer(): ChatHistoryOrganizer | null {
  const api = window.nodus;
  if (typeof api.listChatProjects !== 'function') return null;
  return {
    listProjects: () => api.listChatProjects!(),
    createProject: input => api.createChatProject!(input),
    updateProject: (id, patch) => api.updateChatProject!(id, patch),
    deleteProject: id => api.deleteChatProject!(id),
    listFolders: () => api.listChatProjectFolders?.() ?? Promise.resolve([]),
    createFolder: input => api.createChatProjectFolder!(input),
    renameFolder: (id, name) => api.renameChatProjectFolder!(id, name),
    moveFolder: (id, parentId, index) => api.moveChatProjectFolder!(id, parentId, index),
    deleteFolder: id => api.deleteChatProjectFolder!(id),
    setProject: (id, projectId) => api.setConversationProject!(id, projectId),
    setFolder: (id, folderId) => api.setConversationFolder!(id, folderId),
    setPinned: (id, pinned) => api.setConversationPinned!(id, pinned),
  };
}

const surfaceOrganizers = new Map<ChatHistorySurface, ChatHistoryOrganizer | null>();
/** The store of another chat history in the active vault; one stable object per surface. */
export function surfaceChatOrganizer(surface: ChatHistorySurface): ChatHistoryOrganizer | null {
  if (surfaceOrganizers.has(surface)) return surfaceOrganizers.get(surface)!;
  const api = window.nodus;
  const organizer: ChatHistoryOrganizer | null = typeof api.listChatHistoryProjects !== 'function' ? null : {
    listProjects: () => api.listChatHistoryProjects!(surface),
    createProject: input => api.createChatHistoryProject!(surface, input),
    updateProject: (id, patch) => api.updateChatHistoryProject!(surface, id, patch),
    deleteProject: id => api.deleteChatHistoryProject!(surface, id),
    listFolders: () => api.listChatHistoryFolders!(surface),
    createFolder: input => api.createChatHistoryFolder!(surface, input),
    renameFolder: (id, name) => api.renameChatHistoryFolder!(surface, id, name),
    moveFolder: (id, parentId, index) => api.moveChatHistoryFolder!(surface, id, parentId, index),
    deleteFolder: id => api.deleteChatHistoryFolder!(surface, id),
    setProject: (id, projectId) => api.setChatHistoryProject!(surface, id, projectId),
    setFolder: (id, folderId) => api.setChatHistoryFolder!(surface, id, folderId),
    setPinned: (id, pinned) => api.setChatHistoryPinned!(surface, id, pinned),
  };
  surfaceOrganizers.set(surface, organizer);
  return organizer;
}

/** A notebook, or the surface's equivalent (a Study course), as the history shows it. */
export interface ChatHistoryNotebookEntry {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  /** More text the history search matches it by (a course's subjects and topics). */
  keywords?: string;
}

/**
 * A surface's notebook-equivalent. `notebook` replicates Research Chat's notebooks (a
 * named set of the surface's sources, kept by its store); `course` reuses Study's own
 * Courses → Subjects → Topics, so a chat lives in the course its scope reads.
 */
export interface ChatHistoryNotebooks {
  kind: 'notebook' | 'course';
  entries: ChatHistoryNotebookEntry[];
  /** A notebook's chat reads its notebook and stays out of projects, as in Research Chat.
   * A course is only the chat's current scope, so its chats still move into projects. */
  locksMoves: boolean;
  /** Point the context at it: its page's first message starts a chat inside it. */
  open: (id: string) => void;
  /** Start a new one; `opened` shows it once it exists, as Research Chat does. */
  create?: (opened: (id: string) => void) => void;
  editSources?: (id: string) => void;
  update?: (id: string, patch: { name?: string; icon?: string | null; color?: string | null }) => Promise<unknown>;
  remove?: (id: string) => Promise<unknown>;
  /** The surface's own dialogs (creating a notebook, editing its sources). */
  overlay?: ReactNode;
}
