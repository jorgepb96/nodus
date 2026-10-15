import type { AcademicInterfaceProfile } from './types';

export const HEADER_ACTION_IDS = ['commands', 'researchChat', 'toolkit', 'skills', 'sync', 'theme', 'focus', 'queue', 'notifications', 'feedback', 'settings'] as const;
export type HeaderActionId = typeof HEADER_ACTION_IDS[number];
export type HeaderActionVisibility = Partial<Record<HeaderActionId, boolean>>;

const DEFAULT_HIDDEN = new Set<HeaderActionId>(['sync', 'focus', 'feedback', 'skills']);

/** Explicit choices follow the vault; profile changes only change the defaults. */
export function headerActionVisible(id: HeaderActionId, visibility: HeaderActionVisibility | undefined, profile?: AcademicInterfaceProfile): boolean {
  if (typeof visibility?.[id] === 'boolean') return visibility[id]!;
  return !DEFAULT_HIDDEN.has(id) && !(profile === 'simple' && (id === 'researchChat' || id === 'toolkit'));
}

export function sanitizeHeaderActionVisibility(value: unknown): HeaderActionVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, visible]) => HEADER_ACTION_IDS.includes(key as HeaderActionId) && typeof visible === 'boolean'));
}
