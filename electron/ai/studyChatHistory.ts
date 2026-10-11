import { cleanProjectInstructions } from '@shared/researchSystemPrompts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StudyAssistantConversation, StudyAssistantSelection } from '@shared/studyAssistant';
import { DEFAULT_STUDY_ASSISTANT_SELECTION } from '@shared/studyAssistant';
import { RESEARCH_CHAT_PIN_LIMIT, type ResearchChatProject, type ResearchChatProjectFolder } from '@shared/types';
import { cleanAppearanceColor, cleanAppearanceIcon } from '../db/chatAppearance';
import { activeVaultDir } from '../vaults/vaultRegistry';

/*
 * The study (and teaching) chat history: one JSON file per vault, study-chat-history.json,
 * next to the vault's database. Besides the conversations it keeps the history's projects
 * and the folders nested inside them, and each conversation carries its own projectId,
 * folderId and pinnedAt, so they travel with the record wherever the file goes (a backup,
 * a restore, an export of the vault).
 *
 * The rules are Research Chat's, with its error codes, so every chat history refuses the
 * same things the same way (see electron/db/chatOrganizerRepo.ts). What a table-backed
 * history gets from foreign keys and the sync merge's repair, this file gets from a repair
 * pass on read: a folder of a project that is gone is dropped, a folder whose parent is
 * missing or in another project returns to its project's root, and a conversation's
 * project or folder that does not resolve (or a folder of another project) is cleared,
 * the chat staying visible in its project or in the general history. A repair is written
 * back at once, so the file on disk is sound after the first read.
 */

export interface StudyChatStoredProject { instructions?: string; id: string; name: string; icon: string | null; color: string | null; createdAt: string; updatedAt: string }
export interface StudyChatStoredFolder { id: string; projectId: string; parentId: string | null; name: string; position: number; createdAt: string; updatedAt: string }
export interface StudyAssistantStore {
  version: 1;
  conversations: StudyAssistantConversation[];
  projects: StudyChatStoredProject[];
  folders: StudyChatStoredFolder[];
  /** Private companion receipts commit with the authored history in this file. */
  mobileCompanion?: { documents: Record<string,Record<string,unknown>|null>; receipts: Record<string,{hash:string;json:string}> };
}

const now = () => new Date().toISOString();
export function studyChatStorePath(): string { return path.join(activeVaultDir(), 'study-chat-history.json'); }

export function normalizeStudySelection(selection?: Partial<StudyAssistantSelection> | null): StudyAssistantSelection {
  return {
    ...DEFAULT_STUDY_ASSISTANT_SELECTION,
    ...selection,
    sourceKeys: Array.isArray(selection?.sourceKeys) ? [...new Set(selection.sourceKeys.filter(Boolean))] : [],
  };
}

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

/** The repair pass: returns the sound store and whether anything had to change. */
export function repairStudyChatStore(store: StudyAssistantStore): { store: StudyAssistantStore; repaired: boolean } {
  let repaired = false;
  const projects = store.projects.filter((project) => project && typeof project.id === 'string' && typeof project.name === 'string');
  const projectIds = new Set(projects.map((project) => project.id));
  // A folder whose project is gone goes with it, as the table's cascade would take it.
  let folders = store.folders.filter((folder) => folder && typeof folder.id === 'string' && projectIds.has(folder.projectId));
  if (projects.length !== store.projects.length || folders.length !== store.folders.length) repaired = true;
  // A parent that is missing, in another project, or part of a cycle sends the folder back
  // to its project's root rather than losing it.
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  folders = folders.map((folder) => {
    let parentOk = folder.parentId === null || (byId.get(folder.parentId)?.projectId === folder.projectId);
    for (let cursor = folder.parentId, steps = 0; parentOk && cursor; steps++) {
      if (cursor === folder.id || steps > folders.length) parentOk = false;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    if (parentOk) return folder;
    repaired = true;
    return { ...folder, parentId: null };
  });
  const folderProject = new Map(folders.map((folder) => [folder.id, folder.projectId]));
  const conversations = store.conversations.map((conversation) => {
    const projectId = text(conversation.projectId) && projectIds.has(conversation.projectId!) ? conversation.projectId! : null;
    const folderId = projectId && text(conversation.folderId) && folderProject.get(conversation.folderId!) === projectId ? conversation.folderId! : null;
    if (projectId === (conversation.projectId ?? null) && folderId === (conversation.folderId ?? null)) return conversation;
    repaired = true;
    return { ...conversation, projectId, folderId };
  });
  return { store: { ...store, version: 1, conversations, projects, folders }, repaired };
}

export function readStudyChatStore(): StudyAssistantStore {
  let parsed: Partial<StudyAssistantStore>;
  try {
    parsed = JSON.parse(fs.readFileSync(studyChatStorePath(), 'utf8')) as Partial<StudyAssistantStore>;
  } catch(error) {
    if(error && typeof error==='object' && 'code' in error && error.code==='ENOENT') return { version: 1, conversations: [], projects: [], folders: [] };
    throw new Error('study_chat_history_unreadable',{cause:error});
  }
  if(!parsed || typeof parsed!=='object' || !Array.isArray(parsed.conversations)) throw new Error('study_chat_history_invalid');
  const raw: StudyAssistantStore = {
    version: 1,
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations.map((conversation) => ({
      ...conversation, selection: normalizeStudySelection(conversation.selection), messages: Array.isArray(conversation.messages) ? conversation.messages : [],
    })) : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    ...(parsed.mobileCompanion ? { mobileCompanion: parsed.mobileCompanion } : {}),
  };
  const { store, repaired } = repairStudyChatStore(raw);
  if (repaired) {
    try { writeStudyChatStore(store); } catch { /* a read-only file still reads repaired */ }
  }
  return store;
}

export function writeStudyChatStore(store: StudyAssistantStore): void {
  const target = studyChatStorePath(); const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), 'utf8');
  fs.renameSync(temporary, target);
}

/** Read, change and write the store in one step; the change may throw to refuse. */
function mutate<T>(change: (store: StudyAssistantStore) => T): T {
  const store = readStudyChatStore();
  const result = change(store);
  writeStudyChatStore(store);
  return result;
}

const cleanName = (name: unknown, code: string): string => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error(code);
  return name.trim();
};
const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
const toProject = (project: StudyChatStoredProject): ResearchChatProject => ({ ...project, instructions: project.instructions ?? '' });
const toFolder = ({ updatedAt: _updatedAt, ...folder }: StudyChatStoredFolder): ResearchChatProjectFolder => folder;

// ── Projects ─────────────────────────────────────────────────────────────────

export function listStudyChatProjects(): ResearchChatProject[] {
  return readStudyChatStore().projects.map(toProject).sort(byName);
}

export function createStudyChatProject(input: { name: string; icon?: string | null; color?: string | null; instructions?: string }): ResearchChatProject {
  const stamp = now();
  const project: StudyChatStoredProject = {
    id: crypto.randomUUID(), name: cleanName(input.name, 'research_chat_project_invalid_name'), instructions: cleanProjectInstructions(input.instructions ?? ''),
    icon: cleanAppearanceIcon(input.icon ?? 'folder'), color: cleanAppearanceColor(input.color ?? null), createdAt: stamp, updatedAt: stamp,
  };
  return mutate((store) => { store.projects.push(project); return toProject(project); });
}

export function updateStudyChatProject(id: string, patch: { name?: string; icon?: string | null; color?: string | null; instructions?: string }): ResearchChatProject {
  return mutate((store) => {
    const project = store.projects.find((item) => item.id === id);
    if (!project) throw new Error('research_chat_project_not_found');
    if ('instructions' in patch) project.instructions = cleanProjectInstructions(patch.instructions);
    if ('name' in patch) project.name = cleanName(patch.name, 'research_chat_project_invalid_name');
    if ('icon' in patch) project.icon = cleanAppearanceIcon(patch.icon);
    if ('color' in patch) project.color = cleanAppearanceColor(patch.color);
    project.updatedAt = now();
    return toProject(project);
  });
}

/** Deleting a project never deletes its chats: they return to the general history. Its
 * folders go with it. */
export function deleteStudyChatProject(id: string): void {
  mutate((store) => {
    store.projects = store.projects.filter((project) => project.id !== id);
    store.folders = store.folders.filter((folder) => folder.projectId !== id);
    for (const conversation of store.conversations) if (conversation.projectId === id) { conversation.projectId = null; conversation.folderId = null; }
  });
}

// ── Folders ──────────────────────────────────────────────────────────────────

export function listStudyChatFolders(): ResearchChatProjectFolder[] {
  return readStudyChatStore().folders.map(toFolder)
    .sort((a, b) => a.projectId.localeCompare(b.projectId) || (a.parentId ?? '').localeCompare(b.parentId ?? '') || a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

function subtree(store: StudyAssistantStore, id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of store.folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true; }
  }
  return ids;
}

function assertParent(store: StudyAssistantStore, projectId: string, parentId: string | null): void {
  if (!parentId) return;
  const parent = store.folders.find((folder) => folder.id === parentId);
  if (!parent) throw new Error('research_chat_folder_not_found');
  if (parent.projectId !== projectId) throw new Error('research_chat_folder_wrong_project');
}

/** Renumber a folder's siblings 0..n-1, placing `moving` at `index` (the end when omitted). */
function reorderSiblings(store: StudyAssistantStore, projectId: string, parentId: string | null, moving: StudyChatStoredFolder | null, index?: number): void {
  const siblings = store.folders.filter((folder) => folder.projectId === projectId && folder.parentId === parentId && folder !== moving)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  if (moving) siblings.splice(Math.max(0, Math.min(index ?? siblings.length, siblings.length)), 0, moving);
  const stamp = now();
  siblings.forEach((folder, position) => {
    if (folder.parentId === parentId && folder.position === position) return;
    folder.parentId = parentId; folder.position = position; folder.updatedAt = stamp;
  });
}

export function createStudyChatFolder(input: { projectId: string; parentId?: string | null; name: string }): ResearchChatProjectFolder {
  return mutate((store) => {
    if (!store.projects.some((project) => project.id === input.projectId)) throw new Error('research_chat_project_not_found');
    const parentId = input.parentId ?? null;
    const name = cleanName(input.name, 'research_chat_folder_invalid_name');
    assertParent(store, input.projectId, parentId);
    const stamp = now();
    const folder: StudyChatStoredFolder = {
      id: crypto.randomUUID(), projectId: input.projectId, parentId, name,
      position: store.folders.filter((item) => item.projectId === input.projectId && item.parentId === parentId).length, createdAt: stamp, updatedAt: stamp,
    };
    store.folders.push(folder);
    return toFolder(folder);
  });
}

export function renameStudyChatFolder(id: string, name: string): ResearchChatProjectFolder {
  return mutate((store) => {
    const folder = store.folders.find((item) => item.id === id);
    if (!folder) throw new Error('research_chat_folder_not_found');
    folder.name = cleanName(name, 'research_chat_folder_invalid_name');
    folder.updatedAt = now();
    return toFolder(folder);
  });
}

/** Nest a folder under another of the same project (null: its root); never into its own subtree. */
export function moveStudyChatFolder(id: string, parentId: string | null, index?: number): ResearchChatProjectFolder {
  return mutate((store) => {
    const folder = store.folders.find((item) => item.id === id);
    if (!folder) throw new Error('research_chat_folder_not_found');
    assertParent(store, folder.projectId, parentId);
    if (parentId && subtree(store, id).has(parentId)) throw new Error('research_chat_folder_cycle');
    const previousParent = folder.parentId;
    reorderSiblings(store, folder.projectId, parentId, folder, index);
    if (previousParent !== parentId) reorderSiblings(store, folder.projectId, previousParent, null);
    return toFolder(folder);
  });
}

/** Delete a folder and its subfolders; their chats stay in the project, with no folder. */
export function deleteStudyChatFolder(id: string): void {
  mutate((store) => {
    const folder = store.folders.find((item) => item.id === id);
    if (!folder) return;
    const gone = subtree(store, id);
    store.folders = store.folders.filter((item) => !gone.has(item.id));
    for (const conversation of store.conversations) if (conversation.folderId && gone.has(conversation.folderId)) conversation.folderId = null;
    reorderSiblings(store, folder.projectId, folder.parentId, null);
  });
}

// ── Where a conversation sits ────────────────────────────────────────────────

function conversationIn(store: StudyAssistantStore, id: string): StudyAssistantConversation {
  const conversation = store.conversations.find((item) => item.id === id);
  if (!conversation) throw new Error('research_chat_conversation_not_found');
  return conversation;
}

/** Moving a chat to another project (or out of projects) takes it out of its folder. */
export function setStudyChatConversationProject(id: string, projectId: string | null): void {
  mutate((store) => {
    const conversation = conversationIn(store, id);
    if (projectId && !store.projects.some((project) => project.id === projectId)) throw new Error('research_chat_project_not_found');
    if ((conversation.projectId ?? null) !== projectId) conversation.folderId = null;
    conversation.projectId = projectId;
  });
}

/** File a chat in a folder, which also puts it in the folder's project; null unfiles it. */
export function setStudyChatConversationFolder(id: string, folderId: string | null): void {
  mutate((store) => {
    const conversation = conversationIn(store, id);
    if (!folderId) { conversation.folderId = null; return; }
    const folder = store.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error('research_chat_folder_not_found');
    conversation.projectId = folder.projectId;
    conversation.folderId = folderId;
  });
}

/** At most RESEARCH_CHAT_PIN_LIMIT unarchived chats are pinned; one more is refused. */
export function setStudyChatConversationPinned(id: string, pinned: boolean): void {
  mutate((store) => {
    const conversation = conversationIn(store, id);
    if (pinned && conversation.pinnedAt) return;
    if (pinned && store.conversations.filter((item) => item.pinnedAt && !item.archived).length >= RESEARCH_CHAT_PIN_LIMIT) throw new Error('research_chat_pin_limit');
    conversation.pinnedAt = pinned ? now() : null;
  });
}
