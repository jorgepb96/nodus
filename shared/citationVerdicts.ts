import type { CitationVerdict } from '../electron/ai/deepResearchCore';

export interface AiVerdictEntry {
  i?: number;
  index?: number;
  veredicto?: string;
  verdict?: string;
}
export interface AiVerdicts {
  veredictos?: AiVerdictEntry[];
  /** Gemini 2.5 Flash Lite has emitted this hybrid spelling under JSON mode. */
  veredicts?: AiVerdictEntry[];
  /** Gemini can also translate only the middle of the Spanish container key. */
  verdictos?: AiVerdictEntry[];
  verdicts?: AiVerdictEntry[];
  results?: AiVerdictEntry[];
}
export type AiVerdictsResponse = AiVerdicts;

export function verdictEntries(v: AiVerdictsResponse): AiVerdictEntry[] {
  if (Array.isArray(v.veredictos)) return v.veredictos;
  if (Array.isArray(v.veredicts)) return v.veredicts;
  if (Array.isArray(v.verdictos)) return v.verdictos;
  if (Array.isArray(v.verdicts)) return v.verdicts;
  if (Array.isArray(v.results)) return v.results;
  return [];
}

export function isAiVerdicts(v: unknown): v is AiVerdictsResponse {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as AiVerdicts;
  return Array.isArray(candidate.veredictos)
    || Array.isArray(candidate.veredicts)
    || Array.isArray(candidate.verdictos)
    || Array.isArray(candidate.verdicts)
    || Array.isArray(candidate.results);
}

export function normalizeCitationVerdict(value: unknown): CitationVerdict | null {
  const raw = String(value ?? '').trim().toLocaleLowerCase().replace(/[\s-]+/gu, '_');
  if (raw === 'sostiene' || raw === 'supports' || raw === 'supported') return 'supports';
  if (raw === 'parcial' || raw === 'partial' || raw === 'partially_supported') return 'partial';
  if (raw === 'no_sostiene' || raw === 'unsupported' || raw === 'does_not_support') return 'unsupported';
  return null;
}
