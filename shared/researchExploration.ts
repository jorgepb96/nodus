import type { ResearchRunMode } from './researchHarness';
import type { RetrievalSettings } from './researchCorpus';

export type ResearchExplorationMode = 'fast' | 'expanded';
export type ResearchExplorationPreferences = Partial<Record<ResearchRunMode, ResearchExplorationMode>>;
export const RESEARCH_EXPLORATION_POLICY = 'research-exploration-v1';
export const RESEARCH_EXPLORATION_DEFAULTS: Readonly<Record<ResearchRunMode, ResearchExplorationMode>> = {
  chat: 'fast', dictionary: 'fast', 'deep-research': 'expanded', immersion: 'expanded',
};
export function isResearchExplorationMode(value: unknown): value is ResearchExplorationMode {
  return value === 'fast' || value === 'expanded';
}
export function sanitizeResearchExploration(value: unknown): ResearchExplorationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(RESEARCH_EXPLORATION_DEFAULTS).flatMap(mode => {
    const choice = (value as Record<string, unknown>)[mode];
    return isResearchExplorationMode(choice) ? [[mode, choice]] : [];
  }));
}
export function resolveResearchExploration(mode: ResearchRunMode, requested?: ResearchExplorationMode, preferences?: ResearchExplorationPreferences): ResearchExplorationMode {
  return isResearchExplorationMode(requested) ? requested
    : isResearchExplorationMode(preferences?.[mode]) ? preferences[mode]! : RESEARCH_EXPLORATION_DEFAULTS[mode];
}
/** Operating targets, independent of model thinking. Explicit smaller retrieval settings
 * remain smaller; the shared run may spend a bounded margin on a concrete evidence gap. */
export function researchExplorationRetrieval(settings: RetrievalSettings, mode: ResearchExplorationMode): RetrievalSettings {
  if (mode === 'expanded') return settings;
  const candidates = Math.min(settings.candidates, 40);
  return { ...settings, candidates, passagesPerRound: Math.min(settings.passagesPerRound, candidates, 8),
    evidenceTokens: Math.min(settings.evidenceTokens, 16000), rounds: Math.min(settings.rounds, 4) };
}
