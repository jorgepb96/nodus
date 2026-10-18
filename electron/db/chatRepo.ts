import { associateNotebookConversation, notebookForConversation } from './researchNotebooksRepo';
import { deleteConversationPlacement, placementFor, setConversationFolder, setConversationPinned, setConversationProject } from './researchChatProjectsRepo';
import { deleteResearchAttachments } from '../researchAttachments';
import { chatAssetOwner, deleteChatAssets, reconcileChatAssets } from '../chatAssets';
import { getActiveVault } from '../vaults/vaultRegistry';
import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { deleteResearchRuns } from './researchRunsRepo';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatMessageRecord,
  ModelRef,
  ResearchContextSelection,
} from '@shared/types';

const DEFAULT_TITLE = 'Conversación sin título';

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
  model_json: string | null;
  selection_json: string | null;
  project_id?: string | null;
  folder_id?: string | null;
  pinned_at?: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: string;
  content: string;
  selection_key: string | null;
  stats_json: string | null;
  attachments_json: string | null;
  concilium_json: string | null;
  skills_json?: string | null;
  error: number;
  created_at: string;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toSummary(row: ConversationRow, messageCount: number): ChatConversationSummary {
  const placement = row.project_id !== undefined ? { projectId: row.project_id ?? null, folderId: row.folder_id ?? null, pinnedAt: row.pinned_at ?? null } : placementFor(row.id);
  return {
    id: row.id,
    notebookId: notebookForConversation(row.id),
    projectId: placement.projectId,
    folderId: placement.folderId,
    pinnedAt: placement.pinnedAt,
    title: row.title || DEFAULT_TITLE,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived: row.archived === 1,
    model: parseJson<ModelRef>(row.model_json),
    messageCount,
  };
}

function toMessage(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    attachments: parseJson(row.attachments_json) ?? undefined,
    concilium: parseJson(row.concilium_json) ?? undefined,
    skills: parseJson<{ id: string; name: string }[]>(row.skills_json ?? null) ?? undefined,
    selectionKey: row.selection_key,
    stats: parseJson(row.stats_json),
    error: row.error === 1,
  };
}

export function listConversations(includeArchived = false): ChatConversationSummary[] {
  const db = getDb();
  const where = includeArchived ? '' : 'WHERE c.archived = 0';
  const rows = db
    .prepare(
      `SELECT c.*, p.project_id, p.folder_id, p.pinned_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM chat_conversations c
       LEFT JOIN research_chat_placements p ON p.conversation_id = c.id
       ${where}
       ORDER BY c.archived ASC, c.updated_at DESC`
    )
    .all() as (ConversationRow & { message_count: number })[];
  return rows.map((row) => toSummary(row, row.message_count));
}

export function getConversation(id: string): ChatConversation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  if (!row) return null;
  const messages = (
    db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY seq ASC').all(id) as MessageRow[]
  ).map(toMessage);
  return {
    ...toSummary(row, messages.length),
    selection: parseJson<ResearchContextSelection>(row.selection_json),
    messages,
  };
}

export function createConversation(input: {
  model?: ModelRef | null;
  selection?: ResearchContextSelection | null;
  title?: string;
  projectId?: string | null;
  /** A folder of that project, when the chat starts inside one. */
  folderId?: string | null;
}): ChatConversation {
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuid();
  db.prepare(
    `INSERT INTO chat_conversations (id, title, created_at, updated_at, archived, model_json, selection_json)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    input.title ?? DEFAULT_TITLE,
    now,
    now,
    input.model ? JSON.stringify(input.model) : null,
    input.selection ? JSON.stringify(input.selection) : null
  );
  if (input.selection?.notebookId) associateNotebookConversation(input.selection.notebookId, id);
  if (input.projectId) setConversationProject(id, input.projectId);
  if (input.projectId && input.folderId) setConversationFolder(id, input.folderId);
  return getConversation(id)!;
}

/** Replace all messages of a conversation (and optionally refresh model/selection). */
export function saveMessages(
  id: string,
  messages: ChatMessageRecord[],
  meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM chat_conversations WHERE id = ?').get(id);
    if (!exists) return;
    db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
    const insert = db.prepare(
      `INSERT INTO chat_messages (id, conversation_id, seq, role, content, selection_key, stats_json, error, created_at, attachments_json, concilium_json, skills_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    messages.forEach((message, index) => {
      insert.run(
        message.id || uuid(),
        id,
        index,
        message.role,
        message.content,
        message.selectionKey ?? null,
        message.stats ? JSON.stringify(message.stats) : null,
        message.error ? 1 : 0,
        now,
        message.attachments?.length ? JSON.stringify(message.attachments) : null,
        message.concilium ? JSON.stringify(message.concilium) : null,
        message.skills?.length ? JSON.stringify(message.skills.slice(0, 8).map(skill => ({ id: String(skill.id), name: String(skill.name).slice(0, 120) }))) : null
      );
    });
    const sets: string[] = ['updated_at = @now'];
    const params: Record<string, unknown> = { id, now };
    if (meta && 'model' in meta) {
      sets.push('model_json = @model');
      params.model = meta.model ? JSON.stringify(meta.model) : null;
    }
    if (meta && 'selection' in meta) {
      associateNotebookConversation(meta.selection?.notebookId ?? null, id);
      sets.push('selection_json = @selection');
      params.selection = meta.selection ? JSON.stringify(meta.selection) : null;
    }
    db.prepare(`UPDATE chat_conversations SET ${sets.join(', ')} WHERE id = @id`).run(params);
  });
  tx();
  reconcileChatAssets(chatAssetOwner('assistant', id, getActiveVault().id), messages);
}

export function renameConversation(id: string, title: string): void {
  const clean = title.trim().slice(0, 120) || DEFAULT_TITLE;
  getDb().prepare('UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(clean, new Date().toISOString(), id);
}

export function setArchived(id: string, archived: boolean): void {
  getDb()
    .prepare('UPDATE chat_conversations SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived ? 1 : 0, new Date().toISOString(), id);
  // An archived chat leaves the pinned section and frees its place.
  if (archived && placementFor(id).pinnedAt) setConversationPinned(id, false);
}

export function deleteConversation(id: string): void {
  deleteResearchAttachments({ surface: 'research', conversationId: id });
  deleteChatAssets(chatAssetOwner('assistant', id, getActiveVault().id));
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
    deleteResearchRuns({ conversationId: id });
    deleteConversationPlacement(id);
    db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
  });
  tx();
}
