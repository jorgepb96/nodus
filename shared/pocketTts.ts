// SPDX-License-Identifier: AGPL-3.0-only
import manifest from './pocketTtsAssets.json';
import type { TtsLanguage, TtsModelAsset } from './ttsModels';

/** Official pocket-tts 4.0.1: one six-layer checkpoint per language, one resident at a time. */
export const POCKET_MODEL_ID = 'pocket-tts-6l';
export const POCKET_LANGUAGES = ['es', 'en', 'fr', 'de', 'it', 'pt', 'nl'] as const;
export type PocketLanguage = typeof POCKET_LANGUAGES[number];
export const POCKET_LANGUAGE_NAMES: Record<PocketLanguage, string> = {
  es: 'spanish', en: 'english', fr: 'french', de: 'german', it: 'italian', pt: 'portuguese', nl: 'dutch',
};
export const POCKET_DEFAULT_VOICES: Record<PocketLanguage, string> = {
  es: 'lola', en: 'alba', fr: 'estelle', de: 'juergen', it: 'giovanni', pt: 'rafael', nl: 'daan',
};
const EMBEDDING_REVISION = 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739';
const hf = (repo: string, revision: string, file: string) => `https://huggingface.co/kyutai/${repo}/resolve/${revision}/${file}?download=true`;
export const isPocketLanguage = (language: TtsLanguage): language is PocketLanguage => (POCKET_LANGUAGES as readonly string[]).includes(language);
export const pocketVoiceId = (name: string) => `pocket:${name}`;

/** Precomputed states are specific to the target language's weights, even for the same voice. */
export function pocketVoiceAsset(name: string, language: PocketLanguage): TtsModelAsset | undefined {
  const entry = (manifest[language].voices as Record<string, (number | string)[]>)[name];
  if (!entry) return undefined;
  const file = `languages/${POCKET_LANGUAGE_NAMES[language]}/embeddings/${name}.safetensors`;
  return { file, url: hf('pocket-tts-without-voice-cloning', EMBEDDING_REVISION, file), bytes: Number(entry[0]), sha256: String(entry[1]) };
}

/** All language defaults are part of the optional model download; other voices are fetched separately. */
export const POCKET_MODEL_ASSETS: TtsModelAsset[] = POCKET_LANGUAGES.flatMap((code) => {
  const { weights, tokenizer } = manifest[code];
  const prefix = `languages/${POCKET_LANGUAGE_NAMES[code]}`;
  return [
    { file: `${prefix}/model.safetensors`, url: hf('pocket-tts', String(weights[0]), `${prefix}/model.safetensors`), bytes: Number(weights[1]), sha256: String(weights[2]) },
    { file: `${prefix}/tokenizer.json`, url: hf('pocket-tts-without-voice-cloning', String(tokenizer[0]), `${prefix}/tokenizer.json`), bytes: Number(tokenizer[1]), sha256: String(tokenizer[2]) },
    pocketVoiceAsset(POCKET_DEFAULT_VOICES[code], code)!,
  ];
});

const nativeLanguages = new Map(Object.entries(POCKET_DEFAULT_VOICES).map(([language, name]) => [name, language as PocketLanguage]));
export const POCKET_VOICES = Object.keys(manifest.en.voices).map((id) => ({
  id, name: id.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()),
  language: nativeLanguages.get(id) ?? 'en' as PocketLanguage,
  attribution: `Kyutai · ${['cosette', 'jean'].includes(id) ? 'CC BY-NC 4.0' : ['alba', 'anna', 'vera', 'fantine', 'charles', 'paul', 'eponine', 'azelma', 'george', 'mary', 'jane', 'michael', 'eve', 'daan'].includes(id) ? 'CC BY 4.0' : 'CC0'}`,
}));

/** PyTorch >=2.5 has no Intel macOS wheels; the CPU lock targets these three platforms. */
export function pocketSupportsPlatform(platform: string, arch: string): boolean {
  return (platform === 'darwin' && arch === 'arm64') || (['win32', 'linux'].includes(platform) && arch === 'x64');
}
