import type {PromptLanguage, WritingWorkshopDraftRequest, WritingWorkshopSelection} from './types';

export const WORKSHOP_SOURCE_GROUPS = {
  ideaIds: 'ideas', themeIds: 'temas', gapIds: 'huecos', contradictionIds: 'contradicciones',
  workIds: 'obras', passageIds: 'pasajes_evidencia', tutorRouteIds: 'rutas_tutor',
} as const;
export type WorkshopSourceGroup = typeof WORKSHOP_SOURCE_GROUPS[keyof typeof WORKSHOP_SOURCE_GROUPS];
export interface MobileWorkshopSourceItem { id: string; revision: string; value: Record<string, unknown> }
/** Only explicitly chosen material. Preparing this contract never invokes a
 * provider, embedding, extraction, indexing or corpus-wide recommendation. */
export interface MobileWorkshopSource {
  version: 1;
  configurationRevision: string;
  promptLanguage: PromptLanguage;
  system: string;
  contextRule: string;
  kindLabels: Record<string, string>;
  maxOutputTokens: number;
  groups: Record<WorkshopSourceGroup, MobileWorkshopSourceItem[]>;
}
export interface MobileWorkshopRequest extends WritingWorkshopDraftRequest { title?: string }
export interface MobileWorkshopSave {
  request: MobileWorkshopRequest;
  source: MobileWorkshopSource;
  revision: string;
  raw: string;
  requestId: string;
  sourceScope: 'linked_corpus' | 'device_downloads';
}
export function normalizeMobileWorkshopSelection(value: unknown): WritingWorkshopSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_workshop_selection');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(WORKSHOP_SOURCE_GROUPS, key))) throw new Error('invalid_workshop_selection');
  let count = 0;
  return Object.fromEntries(Object.keys(WORKSHOP_SOURCE_GROUPS).map(key => {
    const ids = input[key] ?? [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('invalid_workshop_selection');
    const selected = [...new Set(ids as string[])].sort(); count += selected.length;
    if (count > 200) throw new Error('workshop_selection_too_large');
    return [key, selected];
  })) as unknown as WritingWorkshopSelection;
}
