import type {ResearchCorpusDocument,ResolvedResearchScope} from './researchCorpus';
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
