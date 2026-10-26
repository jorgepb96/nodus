import { createHash } from 'node:crypto';
import type { DocumentaryIndexIdentity, ResearchCorpusCollection, ResearchCorpusDocument, ResearchNotebook, ResearchSourceReference, ResolvedResearchScope } from '@shared/researchCorpus';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const researchFingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const documentaryIndexKey = (identity: DocumentaryIndexIdentity): string => researchFingerprint(identity);

export function sourceReferenceKey(reference: ResearchSourceReference): string {
  return JSON.stringify([reference.kind, reference.libraryType ?? null, reference.libraryId ?? null, reference.id]);
}

/**
 * What a resolved scope AUTHORIZES: the vault, the notebook revision it was pinned at, the
 * documents admitted together with their permission state, and the conversation attachments
 * the turn was given. This is what a mid-run check must compare.
 *
 * Deliberately not the scope `id`. That also folds in each document's content `revision` and
 * its pinned `indexedSource`, and a document's revision is a fingerprint over its extracted
 * text (see researchCorpusInventory). Library preparation rewrites those as it indexes, so
 * re-resolving a scope during a turn yielded a different id and the next stage check failed
 * the whole turn with `research_scope_changed` — while exactly the same documents were
 * admitted under exactly the same permissions. Any academic turn overlapping indexing died
 * that way, and a turn is far longer than the gap between two preparation writes.
 *
 * `permissionRevision` is built from identity and permission state only — vault, work id,
 * Zotero key, archived, source state — so this fingerprint moves when a document joins or
 * leaves the scope, or its permissions change, and not when its text is re-read.
 */
export function researchScopeAuthorization(scope: ResolvedResearchScope): string {
  return researchFingerprint([
    scope.vaultId,
    scope.notebookId,
    scope.notebookRevision,
    scope.permissionFingerprint,
    (scope.conversationAttachments ?? []).map(attachment => [attachment.conversationId, attachment.attachmentId]),
  ]);
}

/** Union of direct works and explicitly selected collection members, minus exclusions.
 * The inventory is supplied by the backend after permission checks, never by a model. */
export function selectResearchDocuments(sources: ResearchSourceReference[], exclusions: string[], documents: ResearchCorpusDocument[], collections: ResearchCorpusCollection[]): string[] {
  const selected = new Set<string>();
  const excluded = new Set(exclusions);
  const available = new Map(documents.map(document => [document.id, document]));
  const byKey = new Map(collections.map(collection => [sourceReferenceKey(collection.reference), collection]));
  for (const source of sources) {
    if (source.kind === 'work' || source.kind === 'library-item' || source.kind === 'note' || source.kind === 'conversation-attachment') {
      for (const document of documents) {
        if ((source.kind === 'conversation-attachment' ? document.conversationAttachment && document.id : source.kind === 'work' ? document.workId : source.kind === 'note' ? document.noteId : document.libraryItemId) === source.id) selected.add(document.id);
      }
      continue;
    }
    const stack = [byKey.get(sourceReferenceKey(source))];
    const visited = new Set<string>();
    while (stack.length) {
      const collection = stack.pop();
      if (!collection) continue;
      const key = sourceReferenceKey(collection.reference);
      if (visited.has(key)) continue;
      visited.add(key);
      for (const id of collection.documentIds) if (available.has(id)) selected.add(id);
      if (source.includeDescendants === true) {
        stack.push(...collections.filter(child => child.parentId === collection.reference.id
          && child.reference.kind === collection.reference.kind
          && child.reference.libraryType === collection.reference.libraryType
          && child.reference.libraryId === collection.reference.libraryId));
      }
    }
  }
  return [...selected].filter(id => !excluded.has(id)).sort();
}

export function resolveNotebookScope(vaultId: string, notebook: ResearchNotebook, documents: ResearchCorpusDocument[], collections: ResearchCorpusCollection[]): ResolvedResearchScope {
  const selected = notebook.mode === 'fixed' ? notebook.resolvedDocumentIds
    : selectResearchDocuments(notebook.sources, notebook.exclusions, documents, collections);
  const selectedSet = new Set(selected);
  const exclusions = new Set(notebook.exclusions);
  const permitted = documents.filter(document => selectedSet.has(document.id) && !exclusions.has(document.id)).sort((a, b) => a.id.localeCompare(b.id));
  const old = new Set(notebook.resolvedDocumentIds);
  const current = new Set(permitted.map(document => document.id));
  const permissionFingerprint = researchFingerprint(permitted.map(document => [document.id, document.permissionRevision]));
  const id = researchFingerprint({ vaultId, notebookId: notebook.id, notebookRevision: notebook.revision, permissionFingerprint,
    documents: permitted.map(document => [document.id, document.attachmentId, document.revision, document.indexedSource ?? null]) });
  return { id, vaultId, notebookId: notebook.id, notebookRevision: notebook.revision, documents: permitted,
    permissionFingerprint, resolvedAt: new Date().toISOString(),
    changes: { added: [...current].filter(id => !old.has(id)), removed: [...old].filter(id => !current.has(id)) } };
}

export {documentsById,assertResearchDocument,assertResearchDocumentPermission} from '@shared/researchCorpusScopeChecks';
