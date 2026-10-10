/** A remote read may finish after typing, saving or switching documents. */
export interface EditorRefreshSnapshot {
  documentId: string;
  revision: number;
  signature: string;
  baseline: string;
  ready: boolean;
  blocked: boolean;
}

export async function refreshSavedEditor<T extends { revision?: number }>(
  snapshot: () => EditorRefreshSnapshot,
  load: (documentId: string) => Promise<T>,
  adopt: (document: T) => void,
): Promise<'updated' | 'unchanged' | 'deferred'> {
  const before = snapshot();
  if (!before.ready || before.blocked || before.signature !== before.baseline) return 'deferred';
  const document = await load(before.documentId);
  const after = snapshot();
  if (!after.ready || after.blocked || after.documentId !== before.documentId ||
      after.revision !== before.revision || after.baseline !== before.baseline ||
      after.signature !== after.baseline) return 'deferred';
  if (typeof document.revision !== 'number' || document.revision <= after.revision) return 'unchanged';
  adopt(document);
  return 'updated';
}
