import { chatAssetOwner, deleteChatAssets, reconcileChatAssets } from './chatAssets';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { NODI_DEFAULT_CONTEXTS } from '@shared/types';
import type { NodiContextKind, NodiConversation, NodiConversationInput } from '@shared/types';
import { getActiveVault } from './vaults/vaultRegistry';

interface Store {
  version: 1;
  conversations: NodiConversation[];
}

const ALLOWED_CONTEXTS = new Set<NodiContextKind>(['documentation', 'current_view', 'vault', 'all_vaults']);
const MAX_CONVERSATIONS = 60;
const MAX_MESSAGES = 100;

function storePath(): string {
  return path.join(app.getPath('userData'), 'nodi-chat-history.json');
}

function normalizeContexts(value: unknown): NodiContextKind[] {
  if (!Array.isArray(value)) return [...NODI_DEFAULT_CONTEXTS];
  return [...new Set(value.filter((item): item is NodiContextKind => ALLOWED_CONTEXTS.has(item as NodiContextKind)))];
}

function normalizeConversation(value: NodiConversation): NodiConversation {
  return {
    ...value,
    title: String(value.title || 'Chat con Nodi').trim().slice(0, 100) || 'Chat con Nodi',
    messages: Array.isArray(value.messages)
      ? value.messages.filter((message) => message?.role === 'user' || message?.role === 'assistant').slice(-MAX_MESSAGES)
      : [],
    contexts: normalizeContexts(value.contexts),
    model: value.model ?? null,
    vaultId: value.vaultId ?? null,
    vaultName: value.vaultName ?? null,
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function read(): Store {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, conversations: [] };
    // Unreadable is not empty: a save on top of an "empty" store would replace the history.
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      version: 1,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations.map(normalizeConversation) : [],
    };
  } catch {
    // A torn or corrupt file is set aside rather than overwritten by the next save, so the
    // conversations in it can still be recovered by hand.
    const aside = `${storePath()}.corrupt-${Date.now()}`;
    try { fs.renameSync(storePath(), aside); console.warn(`[nodi] chat history was unreadable; kept as ${aside}`); }
    catch (error) { throw new Error(`Nodi chat history is corrupt and could not be set aside: ${error instanceof Error ? error.message : String(error)}`); }
    return { version: 1, conversations: [] };
  }
}

function write(store: Store): void {
  const target = storePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), 'utf8');
  fs.renameSync(temporary, target);
}

export function listNodiConversations(): NodiConversation[] {
  return read().conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getNodiConversation(id: string): NodiConversation | null {
  return read().conversations.find((conversation) => conversation.id === id) ?? null;
}

export function saveNodiConversation(input: NodiConversationInput): NodiConversation {
  const store = read();
  const existingIndex = input.id ? store.conversations.findIndex((conversation) => conversation.id === input.id) : -1;
  const existing = existingIndex >= 0 ? store.conversations[existingIndex] : null;
  if (input.id && !existing) throw new Error('This conversation has been deleted. Start a new chat.');
  const now = Date.now();
  let vault: { id: string; name: string } | null = null;
  try {
    vault = getActiveVault();
  } catch {
    vault = null;
  }
  const conversation = normalizeConversation({
    id: existing?.id ?? crypto.randomUUID(),
    title: input.title?.trim() || existing?.title || input.messages.find((message) => message.role === 'user')?.content || 'Chat con Nodi',
    messages: input.messages,
    contexts: normalizeContexts(input.contexts),
    model: input.model ?? existing?.model ?? null,
    vaultId: existing?.vaultId ?? vault?.id ?? null,
    vaultName: existing?.vaultName ?? vault?.name ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (existingIndex >= 0) store.conversations.splice(existingIndex, 1);
  store.conversations.unshift(conversation);
  for (const removed of store.conversations.slice(MAX_CONVERSATIONS)) deleteChatAssets(chatAssetOwner('nodi', removed.id));
  store.conversations = store.conversations.slice(0, MAX_CONVERSATIONS);
  write(store);
  reconcileChatAssets(chatAssetOwner('nodi', conversation.id), conversation.messages);
  return conversation;
}

export function deleteNodiConversation(id: string): void {
  deleteChatAssets(chatAssetOwner('nodi', id));
  const store = read();
  store.conversations = store.conversations.filter((conversation) => conversation.id !== id);
  write(store);
}

export function clearNodiConversations(): void {
  for (const conversation of read().conversations) deleteChatAssets(chatAssetOwner('nodi', conversation.id));
  write({ version: 1, conversations: [] });
}
