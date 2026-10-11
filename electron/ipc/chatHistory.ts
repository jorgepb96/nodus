import type { IpcContext } from './context';
import type { ChatHistoryNotebookSurface, ChatHistorySurface } from '@shared/types';
import { databaseChatOrganizer, renameDatabaseChatConversation, setDatabaseChatConversationArchived } from '../db/databaseChatRepo';
import { renameWorldChatConversation, setWorldChatConversationArchived, worldChatOrganizer } from '../db/worldChatRepo';
import * as study from '../ai/studyChatHistory';
import { updateStudyAssistantConversation } from '../ai/studyAssistant';
import {getMobileChatResultArtifact,getMobileChatReadResource} from '../desktopBridge/chatResultAssets';
import {streamMobileCompanionChat,mobileLiveChatConfiguration} from '../desktopBridge/nativeLiveChat';
import {generationSignal} from '../ai/generationSignal';

/*
 * The chat-history channels of the Databases, Worldbuilding and Study (Teaching) chats.
 * A call names its surface and reaches only that surface's store in the active vault: the
 * database surfaces their own tables, the study surface its JSON file. Research Chat keeps
 * its own chat:* channels. An unknown surface is refused rather than guessed.
 */

type Organizer = {
  listProjects: typeof databaseChatOrganizer.listChatProjects;
  createProject: typeof databaseChatOrganizer.createChatProject;
  updateProject: typeof databaseChatOrganizer.updateChatProject;
  deleteProject: typeof databaseChatOrganizer.deleteChatProject;
  listFolders: typeof databaseChatOrganizer.listChatProjectFolders;
  createFolder: typeof databaseChatOrganizer.createChatProjectFolder;
  renameFolder: typeof databaseChatOrganizer.renameChatProjectFolder;
  moveFolder: typeof databaseChatOrganizer.moveChatProjectFolder;
  deleteFolder: typeof databaseChatOrganizer.deleteChatProjectFolder;
  setProject: typeof databaseChatOrganizer.setConversationProject;
  setFolder: typeof databaseChatOrganizer.setConversationFolder;
  setPinned: typeof databaseChatOrganizer.setConversationPinned;
  rename: (id: string, title: string) => void;
  archive: (id: string, archived: boolean) => void;
};

function tableOrganizer(organizer: typeof databaseChatOrganizer, rename: Organizer['rename'], archive: Organizer['archive']): Organizer {
  return {
    listProjects: organizer.listChatProjects, createProject: organizer.createChatProject, updateProject: organizer.updateChatProject, deleteProject: organizer.deleteChatProject,
    listFolders: organizer.listChatProjectFolders, createFolder: organizer.createChatProjectFolder, renameFolder: organizer.renameChatProjectFolder,
    moveFolder: organizer.moveChatProjectFolder, deleteFolder: organizer.deleteChatProjectFolder,
    setProject: organizer.setConversationProject, setFolder: organizer.setConversationFolder, setPinned: organizer.setConversationPinned,
    rename, archive,
  };
}

const organizers: Record<ChatHistorySurface, Organizer> = {
  database: tableOrganizer(databaseChatOrganizer, renameDatabaseChatConversation, setDatabaseChatConversationArchived),
  world: tableOrganizer(worldChatOrganizer, renameWorldChatConversation, setWorldChatConversationArchived),
  study: {
    listProjects: study.listStudyChatProjects, createProject: study.createStudyChatProject, updateProject: study.updateStudyChatProject, deleteProject: study.deleteStudyChatProject,
    listFolders: study.listStudyChatFolders, createFolder: study.createStudyChatFolder, renameFolder: study.renameStudyChatFolder,
    moveFolder: study.moveStudyChatFolder, deleteFolder: study.deleteStudyChatFolder,
    setProject: study.setStudyChatConversationProject, setFolder: study.setStudyChatConversationFolder, setPinned: study.setStudyChatConversationPinned,
    rename: (id, title) => { if (!updateStudyAssistantConversation(id, { title })) throw new Error('research_chat_conversation_not_found'); },
    archive: (id, archived) => { if (!updateStudyAssistantConversation(id, { archived })) throw new Error('research_chat_conversation_not_found'); },
  },
};

function organizer(surface: unknown): Organizer {
  if (typeof surface !== 'string' || !Object.hasOwn(organizers, surface)) throw new Error('chat_history_unknown_surface');
  return organizers[surface as ChatHistorySurface];
}

function notebookOrganizer(surface: unknown): typeof databaseChatOrganizer {
  if (surface === 'database') return databaseChatOrganizer;
  if (surface === 'world') return worldChatOrganizer;
  throw new Error('chat_history_unknown_surface');
}

export function registerChatHistoryIpc({ h }: IpcContext): void {
  h('chatHistory:mobileLiveConfiguration',async (_event,kind:string,model?:Parameters<typeof mobileLiveChatConfiguration>[1])=>mobileLiveChatConfiguration(kind,model));
  h('chatHistory:mobileLiveStream',async (event,request:unknown)=>{
    const host=event as unknown as {mobileBridgeJobId?:string;mobileBridgeDeviceGrant?:string;mobileBridgeIdempotencyKey?:string};
    if(!host.mobileBridgeJobId||!host.mobileBridgeDeviceGrant||!host.mobileBridgeIdempotencyKey)throw new Error('live_chat_job_required');
    return streamMobileCompanionChat(request,{jobId:host.mobileBridgeJobId,deviceGrant:host.mobileBridgeDeviceGrant,idempotencyKey:host.mobileBridgeIdempotencyKey},(channel,...args)=>event.sender.send(channel,...args),generationSignal());
  });
  h('chatHistory:mobileResultArtifact',async (_event,request:unknown,locale?:string)=>getMobileChatResultArtifact(request,locale));
  h('chatHistory:mobileReadResource',async (_event,request:unknown,locale?:string)=>getMobileChatReadResource(request,locale));
  h('chatHistory:projects:list', async (_e, surface: ChatHistorySurface) => organizer(surface).listProjects());
  h('chatHistory:projects:create', async (_e, surface: ChatHistorySurface, input: { name: string; icon?: string | null; color?: string | null; instructions?: string }) => organizer(surface).createProject(input));
  h('chatHistory:projects:update', async (_e, surface: ChatHistorySurface, id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }) => organizer(surface).updateProject(id, patch));
  h('chatHistory:projects:delete', async (_e, surface: ChatHistorySurface, id: string) => organizer(surface).deleteProject(id));
  h('chatHistory:folders:list', async (_e, surface: ChatHistorySurface) => organizer(surface).listFolders());
  h('chatHistory:folders:create', async (_e, surface: ChatHistorySurface, input: { projectId: string; parentId?: string | null; name: string }) => organizer(surface).createFolder(input));
  h('chatHistory:folders:rename', async (_e, surface: ChatHistorySurface, id: string, name: string) => organizer(surface).renameFolder(id, name));
  h('chatHistory:folders:move', async (_e, surface: ChatHistorySurface, id: string, parentId: string | null, index?: number) => organizer(surface).moveFolder(id, parentId, index));
  h('chatHistory:folders:delete', async (_e, surface: ChatHistorySurface, id: string) => organizer(surface).deleteFolder(id));
  h('chatHistory:setProject', async (_e, surface: ChatHistorySurface, id: string, projectId: string | null) => organizer(surface).setProject(id, projectId));
  h('chatHistory:setFolder', async (_e, surface: ChatHistorySurface, id: string, folderId: string | null) => organizer(surface).setFolder(id, folderId));
  h('chatHistory:setPinned', async (_e, surface: ChatHistorySurface, id: string, pinned: boolean) => organizer(surface).setPinned(id, pinned));
  h('chatHistory:rename', async (_e, surface: ChatHistorySurface, id: string, title: string) => organizer(surface).rename(id, title));
  h('chatHistory:archive', async (_e, surface: ChatHistorySurface, id: string, archived: boolean) => organizer(surface).archive(id, archived));
  h('chatHistory:notebooks:list', async (_e, surface: ChatHistoryNotebookSurface) => notebookOrganizer(surface).listChatNotebooks());
  h('chatHistory:notebooks:create', async (_e, surface: ChatHistoryNotebookSurface, input: { name: string; icon?: string | null; color?: string | null; selection: unknown }) => notebookOrganizer(surface).createChatNotebook(input));
  h('chatHistory:notebooks:update', async (_e, surface: ChatHistoryNotebookSurface, id: string, patch: { name?: string; icon?: string | null; color?: string | null; selection?: unknown }) => notebookOrganizer(surface).updateChatNotebook(id, patch));
  h('chatHistory:notebooks:delete', async (_e, surface: ChatHistoryNotebookSurface, id: string) => notebookOrganizer(surface).deleteChatNotebook(id));
}
