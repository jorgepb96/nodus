import type { ResearchChatRequest } from '@shared/types';
import { researchContextLayers } from '@shared/researchContextLayers';
import { getActiveVault } from '../vaults/vaultRegistry';
import { hasResearchSourceRestriction, requestNotebookScope } from './researchNotebookService';
import { resolveResearchSourceWorkIds } from './researchSourceScope';
import { getSettings } from '../db/settingsRepo';

/** The same source grant applies before generation, during revision and in the route report.
 * A null work set means the active library; an empty set means no documentary evidence.
 * ORD and vendor stock are additional sources, so a selected-source turn cannot consult them. */
export interface ChemistryEvidenceScope {
  workIds: ReadonlySet<string> | null;
  external: boolean;
  web: boolean;
}

export function chemistryEvidenceScope(request: ResearchChatRequest): ChemistryEvidenceScope {
  const notebook = requestNotebookScope(request);
  const documents = researchContextLayers(request.selection, !!notebook || getActiveVault().type === 'academic').documents;
  const selected = notebook
    ? new Set(notebook.documents.flatMap(document => document.workId ? [document.workId] : []))
    : resolveResearchSourceWorkIds(request.selection.sourceFilter);
  return {
    workIds: documents ? selected : new Set(),
    external: documents && !hasResearchSourceRestriction(request),
    web: (request.webSearch ?? getSettings().researchWebSearch ?? 'auto') !== 'off',
  };
}
