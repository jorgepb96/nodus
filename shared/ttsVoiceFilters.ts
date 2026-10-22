import { isTtsLanguage, type TtsEngine, type TtsLanguage, type TtsModelDefinition } from './ttsModels';

/** An absent filter follows the current model/interface; [] explicitly means all. */
export interface TtsVoiceFilters {
  engines?: TtsEngine[];
  languages?: TtsLanguage[];
}

const engines: readonly TtsEngine[] = ['ming', 'phonon', 'kokoro'];

export function sanitizeTtsVoiceFilters(value: unknown): TtsVoiceFilters {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const result: TtsVoiceFilters = {};
  if (Array.isArray(input.engines)) result.engines = [...new Set(input.engines.filter((entry): entry is TtsEngine => engines.includes(entry)))];
  if (Array.isArray(input.languages)) result.languages = [...new Set(input.languages.filter(isTtsLanguage))];
  return result;
}

export function resolveTtsVoiceFilters(preferences: TtsVoiceFilters, model: TtsModelDefinition | undefined, uiLanguage: string) {
  const language = uiLanguage.split('-')[0];
  return {
    engines: preferences.engines ?? (model ? [model.engine] : []),
    // Unsupported interface languages leave the list open rather than hiding all voices.
    languages: preferences.languages ?? (isTtsLanguage(language) ? [language] : []),
    modelLanguages: preferences.engines === undefined ? model?.languages : undefined,
  };
}
