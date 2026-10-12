import type { ResearchNotebookInput, ResearchNotebookPreparation, ResolvedResearchScope } from '@shared/researchCorpus';
import type { ResearchChatRequest } from '@shared/types';
import { notebookPreparationStatus, validateRetrievalSettings } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import * as notebooks from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from './researchCorpusInventory';
import { researchFingerprint, resolveNotebookScope, selectResearchDocuments } from './researchCorpusScope';
import { resolveResearchSourceWorkIds } from './researchSourceScope';
import { notifyAuthoredResearchSourceChanged } from './researchCorpusEvents';
import { embeddingConfigurationUsable, getResearchPreparationInventory, pinPublishedResearchDocuments, prepareResearchDocuments } from './documentaryPreparation';
import { effectiveEmbeddingConfig } from './aiClient';
import { readResearchAttachmentSource } from './researchAttachmentSources';

const active = new Map<string, Set<AbortController>>();
const key = (id: string) => `${getActiveVault().id}:${id}`;
export function listResearchNotebooks() {
  if (getActiveVault().type !== 'academic') return [];
  return notebooks.listResearchNotebooks();
}
export function saveResearchNotebook(input: ResearchNotebookInput) {
  const inventory = researchCorpusInventory();
  const old = input.id ? notebooks.getResearchNotebook(input.id) : null;
  const unchangedSelection = old?.mode === input.mode && researchFingerprint([old.sources, old.exclusions]) === researchFingerprint([input.sources, input.exclusions]);
  const ids = input.mode === 'fixed' && unchangedSelection ? old!.resolvedDocumentIds
    : selectResearchDocuments(input.sources, input.exclusions, inventory.documents, inventory.collections);
  const result = notebooks.saveResearchNotebook(input, ids);
  for (const controller of active.get(key(result.id)) ?? []) controller.abort();
  notifyAuthoredResearchSourceChanged();
  // What the collections hold and is not indexed yet goes to the queue straight away.
  void ensureNotebookPrepared(result.id).catch(() => undefined);
  return result;
}
export function updateResearchNotebookAppearance(id: string, patch: { name?: string; icon?: string | null; color?: string | null }) {
  if (getActiveVault().type !== 'academic') throw new Error('Research notebooks require an academic vault');
  return notebooks.updateResearchNotebookAppearance(id, patch);
}

/** Whether an embedding model can run now; without one, searchable text is enough. */
function embeddingsExpected(): boolean {
  try { return embeddingConfigurationUsable(effectiveEmbeddingConfig()); } catch { return false; }
}
/** Where the notebook's documents stand: usable once nothing is pending. */
export function getResearchNotebookPreparation(id: string): ResearchNotebookPreparation {
  const scope = resolveResearchNotebook(id);
  return notebookPreparationStatus(scope.documents.map(document => document.id), getResearchPreparationInventory().documents, embeddingsExpected());
}
/** Queues what the notebook's collections hold and nobody has asked to index yet. */
export async function ensureNotebookPrepared(id: string): Promise<ResearchNotebookPreparation> {
  const status = getResearchNotebookPreparation(id);
  if (status.unprepared.length) await prepareResearchDocuments(status.unprepared, embeddingsExpected() ? 'embeddings' : 'text');
  return status.unprepared.length ? getResearchNotebookPreparation(id) : status;
}
export function deleteResearchNotebook(id: string) {
  if (getActiveVault().type !== 'academic') throw new Error('Research notebooks require an academic vault');
  notebooks.deleteResearchNotebook(id);
  for (const controller of active.get(key(id)) ?? []) controller.abort();
}
export function resolveResearchNotebook(id: string): ResolvedResearchScope {
  const inventory = researchCorpusInventory();
  const notebook = notebooks.getResearchNotebook(id);
  if (!notebook) throw new Error('Notebook not found');
  const scope = resolveNotebookScope(getActiveVault().id, notebook, pinPublishedResearchDocuments(inventory.documents), inventory.collections);
  notebooks.recordResearchScope(scope);
  return scope;
}
export function registerNotebookRun(id: string, controller: AbortController): () => void {
  const runKey = key(id);
  const controllers = active.get(runKey) ?? new Set<AbortController>();
  controllers.add(controller);
  active.set(runKey, controllers);
  return () => { controllers.delete(controller); if (!controllers.size) active.delete(runKey); };
}

const pinnedScope = Symbol('backendResearchScope');
const pinnedSourceRestriction = Symbol('backendResearchSourceRestriction');
type ScopedRequest = ResearchChatRequest & { [pinnedScope]?: ResolvedResearchScope; [pinnedSourceRestriction]?: boolean };
export function requestNotebookScope(input: ResearchChatRequest): ResolvedResearchScope | null { return (input as ScopedRequest)[pinnedScope] ?? null; }
/** Academic authorization pins the entire library through sourceFilter too. Remember whether
 * the user narrowed it, so an invoked skill may use its own sources on a whole-library turn. */
export function hasResearchSourceRestriction(input: ResearchChatRequest): boolean {
  return (input as ScopedRequest)[pinnedSourceRestriction] ?? (!!requestNotebookScope(input)?.notebookId || input.selection.sourceFilter?.enabled === true);
}
export function resolveAcademicResearchScope(filter?: ResearchChatRequest['selection']['sourceFilter'], attachments?: Pick<ResearchChatRequest, 'conversationId' | 'attachmentIds'>): ResolvedResearchScope {
  if (attachments?.attachmentIds !== undefined && (!Array.isArray(attachments.attachmentIds) || attachments.attachmentIds.length > 20)) throw new Error('Invalid research attachments');
  const vault = getActiveVault();
  // Only the admitted works are read here; the whole source scope (ideas, themes, authors, edges)
  // was computed and dropped on every scope check.
  const allowed = filter?.enabled ? resolveResearchSourceWorkIds(filter) : null;
  const documents = pinPublishedResearchDocuments(researchCorpusInventory().documents.filter(document => document.workId && (!allowed || allowed.has(document.workId)))).sort((a, b) => a.id.localeCompare(b.id));
  const permissionFingerprint = researchFingerprint(documents.map(document => [document.id, document.permissionRevision]));
  const conversationAttachments = [...new Set(attachments?.attachmentIds ?? [])].map(attachmentId => {
    const conversationId = attachments?.conversationId;
    const source = conversationId ? readResearchAttachmentSource(conversationId, attachmentId, true) : null;
    if (!source || !conversationId) throw new Error('research_source_not_authorized');
    return { conversationId, attachmentId, revision: researchFingerprint(source) };
  });
  const scope: ResolvedResearchScope = { id: researchFingerprint([vault.id, documents, permissionFingerprint, conversationAttachments]), vaultId: vault.id,
    conversationAttachments,
    notebookId: null, notebookRevision: null, documents, permissionFingerprint, resolvedAt: new Date().toISOString(), changes: { added: [], removed: [] } };
  notebooks.recordResearchScope(scope);
  return scope;
}
export function authorizeNotebookRequest(input: ResearchChatRequest): ScopedRequest {
  if (!input.selection.notebookId && getActiveVault().type !== 'academic') return input;
  const prior = (input as ScopedRequest)[pinnedScope];
  const scope = prior ?? (input.selection.notebookId ? resolveResearchNotebook(input.selection.notebookId) : resolveAcademicResearchScope(input.selection.sourceFilter, input));
  const notebook = input.selection.notebookId ? notebooks.getResearchNotebook(input.selection.notebookId) : null;
  if (scope.vaultId !== getActiveVault().id || (notebook && notebook.revision !== scope.notebookRevision)) throw new Error('research_scope_changed');
  // A notebook is read once its collections are indexed; until then the chat says so.
  if (notebook && !prior && notebookPreparationStatus(scope.documents.map(document => document.id), getResearchPreparationInventory().documents, embeddingsExpected()).pending > 0) throw new Error('research_notebook_indexing');
  if (notebook && input.conversationId) notebooks.associateNotebookConversation(notebook.id, input.conversationId);
  // The conversation's own system prompt and effort apply, chosen in the chat like any other.
  return { ...input, [pinnedScope]: scope, [pinnedSourceRestriction]: hasResearchSourceRestriction(input) || !!input.selection.notebookId, attachmentIds: input.selection.notebookId ? [] : input.attachmentIds,
    messages: authorizedNotebookHistory(input, scope),
    // Limits a notebook or the user chose are pinned; without them the chat's agent sets its own.
    selection: { ...input.selection, documents: false, passages: true, retrieval: notebook?.settings || input.selection.retrieval ? validateRetrievalSettings(notebook?.settings ?? input.selection.retrieval!) : undefined,
      sourceFilter: { enabled: true, authorIds: [], workIds: scope.documents.flatMap(document => document.workId ? [document.workId] : []) } } };
}
export function validateNotebookRequest(input: ResearchChatRequest): void {
  const scope = (input as ScopedRequest)[pinnedScope];
  if (!scope) return;
  if (getActiveVault().id !== scope.vaultId) throw new Error('research_scope_changed');
  const current = scope.notebookId ? resolveResearchNotebook(scope.notebookId) : resolveAcademicResearchScope(input.selection.sourceFilter, input);
  if (current.id !== scope.id) throw new Error('research_scope_changed');
}

function authorizedNotebookHistory(input: ResearchChatRequest, scope: ResolvedResearchScope): ResearchChatRequest['messages'] {
  let lastUser = -1;
  input.messages.forEach((message, index) => { if (message.role === 'user') lastUser = index; });
  const known = input.conversationId ? getDb().prepare(`SELECT role,content_hash FROM research_conversation_provenance WHERE conversation_id=? AND scope_id=?`)
    .all(input.conversationId, scope.id) as { role: string; content_hash: string }[] : [];
  const trusted = new Set(known.map(row => `${row.role}:${row.content_hash}`));
  return input.messages.filter((message, index) => index === lastUser || trusted.has(`${message.role}:${researchFingerprint(message.content)}`))
    .map(({ role, content }) => ({ role, content }));
}

/** Only provider results that passed scope validation can authorize later reuse.
 * Renderer-supplied history metadata and manually saved assistant text cannot. */
export function rememberNotebookTurn(input: ResearchChatRequest, answer: string): string {
  const scope = requestNotebookScope(input);
  if (!scope) return answer;
  validateNotebookRequest(input);
  if (!input.conversationId) return answer;
  const user = input.messages.filter(message => message.role === 'user').at(-1);
  const insert = getDb().prepare(`INSERT OR IGNORE INTO research_conversation_provenance(conversation_id,scope_id,role,content_hash,created_at) VALUES (?,?,?,?,?)`);
  getDb().transaction(() => {
    for (const [role, content] of [['user', user?.content], ['assistant', answer]]) if (content) insert.run(input.conversationId, scope.id, role, researchFingerprint(content), new Date().toISOString());
  })();
  return answer;
}
