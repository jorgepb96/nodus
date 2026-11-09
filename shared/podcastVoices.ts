// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the podcast composer may offer: the engines whose runtime is installed and whose
 * checkpoint is downloaded, the languages they speak, and the voices of one engine in one
 * language. Pure, so the filtering is tested without a window.
 */
import { TTS_MODELS, type TtsModelDefinition, type TtsStatus } from './ttsModels';
import type { TtsVoice } from './ttsVoices';
import { PODCAST_ENGINES, PODCAST_LANGUAGES, type PodcastEngine, type PodcastLanguage } from './podcast';

export interface PodcastEngineOption {
  engine: PodcastEngine;
  modelId: string;
  label: string;
  languages: PodcastLanguage[];
  /** CC BY-NC weights: not for commercial publication. */
  nonCommercial: boolean;
}

function runtimeInstalled(status: TtsStatus, engine: PodcastEngine): boolean {
  if (engine === 'phonon') return Boolean(status.phononRuntime?.installed);
  if (engine === 'kokoro') return Boolean(status.kokoroRuntime?.installed);
  return Boolean(status.runtime?.installed);
}

/** Ming's voices: its built-in ones and the user's clones (recorded, uploaded or bundled). */
const MING_ORIGINS = new Set(['builtin', 'recorded', 'uploaded', 'bundled']);

export function podcastEngineOptions(status: TtsStatus | null, models: readonly TtsModelDefinition[] = TTS_MODELS): PodcastEngineOption[] {
  if (!status) return [];
  const downloaded = new Set(status.models.filter((model) => model.downloaded).map((model) => model.id));
  return models.flatMap((model) => {
    const engine = model.engine as PodcastEngine;
    if (!(PODCAST_ENGINES as readonly string[]).includes(model.engine) || model.unpublished) return [];
    if (!downloaded.has(model.id) || !runtimeInstalled(status, engine)) return [];
    const languages = PODCAST_LANGUAGES.filter((language) => (model.languages as readonly string[]).includes(language));
    if (!languages.length) return [];
    return [{ engine, modelId: model.id, label: model.label, languages, nonCommercial: Boolean(model.nonCommercial) }];
  });
}

/** Languages at least one ready engine speaks, in the podcast's own order. */
export function podcastLanguages(options: readonly PodcastEngineOption[]): PodcastLanguage[] {
  return PODCAST_LANGUAGES.filter((language) => options.some((option) => option.languages.includes(language)));
}

/** Engines that can voice `language`. A language-specific checkpoint wins over a multilingual one. */
export function podcastEnginesFor(options: readonly PodcastEngineOption[], language: PodcastLanguage): PodcastEngineOption[] {
  return options
    .filter((option) => option.languages.includes(language))
    .sort((a, b) => a.languages.length - b.languages.length);
}

/** The voices of one engine in one language: named voices first, character voices last. */
export function podcastVoicesFor(voices: readonly TtsVoice[], engine: PodcastEngine, language: PodcastLanguage): TtsVoice[] {
  return voices
    .filter((voice) => (engine === 'ming' ? MING_ORIGINS.has(voice.origin) && !voice.id.startsWith('pocket:') : voice.origin === engine && voice.id.startsWith(`${engine}:`)) && voice.language === language)
    .sort((a, b) => Number(a.locale === 'characters') - Number(b.locale === 'characters') || (a.locale ?? '').localeCompare(b.locale ?? '') || a.name.localeCompare(b.name));
}

/** Two distinct voices for a two-host format: preferably one of each gender. */
export function defaultPodcastVoices(voices: readonly TtsVoice[], hosts: 1 | 2): TtsVoice[] {
  if (!voices.length) return [];
  const first = voices.find((voice) => voice.gender === 'female') ?? voices[0];
  if (hosts === 1) return [first];
  const second = voices.find((voice) => voice.id !== first.id && voice.gender !== first.gender && voice.gender !== 'none')
    ?? voices.find((voice) => voice.id !== first.id);
  return second ? [first, second] : [first];
}

/** A host's spoken name from a voice label ("Dora (es)" → "Dora"). */
export function podcastHostName(voice: Pick<TtsVoice, 'name'>): string {
  return voice.name.replace(/\s*[([].*$/, '').split(/\s+[-–—·]\s+/)[0].trim().slice(0, 40) || voice.name;
}
