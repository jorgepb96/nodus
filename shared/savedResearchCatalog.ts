import type { WritingWorkshopSavedDraft } from './types';

const invalidCatalog = () => new Error('El catálogo de documentos guardados tiene un formato inválido.');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate before replacing the gallery or discarding a restored reader. */
export function savedResearchCatalog(value: unknown): WritingWorkshopSavedDraft[] {
  if (!Array.isArray(value)) throw invalidCatalog();
  const ids = new Set<string>();
  const reports: WritingWorkshopSavedDraft[] = [];
  for (const item of value) {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)
      || typeof item.title !== 'string' || !object(item.brief) || typeof item.brief.kind !== 'string') {
      throw invalidCatalog();
    }
    ids.add(item.id);
    if (item.brief.kind !== 'deep_research') continue;
    const draft = item.draft;
    if (!object(draft) || typeof draft.title !== 'string'
      || typeof draft.abstract !== 'string' || typeof draft.draftMarkdown !== 'string'
      || !['outline', 'matrix', 'bibliography', 'nextSteps', 'limitations'].every(key => Array.isArray(draft[key]))
      || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') {
      throw invalidCatalog();
    }
    reports.push(item as unknown as WritingWorkshopSavedDraft);
  }
  return reports;
}
