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

/** Documents by id, the first of any duplicate winning exactly as `Array.prototype.find` would. */
export function documentsById<T extends { id: string }>(documents: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const document of documents) if (!index.has(document.id)) index.set(document.id, document);
  return index;
}

/** A resolved scope is never changed once built, so one index per scope object serves every check
 *  against it. The lookup was a linear scan, and callers check each document of the scope in turn:
 *  quadratic in the library, run several times per retrieval round. Measured 2026-10-09 at ~42% of
 *  the main thread's busy time across a trace of nine turns. */
const pinnedIndexes = new WeakMap<ResolvedResearchScope, Map<string, ResearchCorpusDocument>>();
function pinnedDocument(scope: ResolvedResearchScope, documentId: string): ResearchCorpusDocument | undefined {
  let index = pinnedIndexes.get(scope);
  if (!index) { index = documentsById(scope.documents); pinnedIndexes.set(scope, index); }
  return index.get(documentId);
}

/** Direct reads revalidate both authorization and pinned content; never substitute revisions. */
export function assertResearchDocument(scope: ResolvedResearchScope, documentId: string, current: ResearchCorpusDocument | undefined): ResearchCorpusDocument {
  const pinned = assertResearchDocumentPermission(scope, documentId, current);
  if (!current) throw new Error('research_source_not_authorized');
  if (pinned.revision !== current.revision || pinned.attachmentId !== current.attachmentId) throw new Error('research_source_revision_changed');
  return pinned;
}

/** Historical immutable evidence stays readable after a content edit. Access
 * revocations still win; active executions use the stricter revision check. */
export function assertResearchDocumentPermission(scope: ResolvedResearchScope, documentId: string, current: ResearchCorpusDocument | undefined): ResearchCorpusDocument {
  const pinned = pinnedDocument(scope, documentId);
  if (!pinned || !current || pinned.permissionRevision !== current.permissionRevision || (pinned.workId && pinned.workId !== current.workId)) throw new Error('research_source_not_authorized');
  // Removing an attachment is an access revocation, whereas replacing its
  // content under the same identity leaves immutable historical citations valid.
  if (pinned.attachments?.some(attachment => !current.attachments?.some(item => item.id === attachment.id))) throw new Error('research_source_not_authorized');
  return pinned;
}
