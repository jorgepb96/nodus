// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kokoro-82M v1.0 voice embeddings (Apache-2.0), from `hexgrad/Kokoro-82M` and the
 * `hexgrad/kokoro` voice list. The checkpoint is one 82M ONNX model; each entry below is a
 * small style vector inside `voices-v1.0.bin`, so there is no per-voice download.
 */
export const KOKORO_LANGUAGES = ['es', 'en'] as const;
export type KokoroLanguage = (typeof KOKORO_LANGUAGES)[number];

export interface KokoroVoice {
  /** Engine-native id, also the embedding key in voices-v1.0.bin. */
  id: string;
  name: string;
  language: KokoroLanguage;
  locale: string;
  gender: 'male' | 'female';
  /** Approximate quality tier from the published Kokoro voice card. */
  quality: string;
}

export const KOKORO_VOICES: readonly KokoroVoice[] = [
  { id: 'ef_dora', name: 'Dora', language: 'es', locale: 'es', gender: 'female', quality: 'A' },
  { id: 'em_alex', name: 'Alex', language: 'es', locale: 'es', gender: 'male', quality: 'B' },
  { id: 'em_santa', name: 'Santa', language: 'es', locale: 'es', gender: 'male', quality: 'B' },
  { id: 'af_heart', name: 'Heart', language: 'en', locale: 'en-us', gender: 'female', quality: 'A' },
  { id: 'af_alloy', name: 'Alloy', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_aoede', name: 'Aoede', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_bella', name: 'Bella', language: 'en', locale: 'en-us', gender: 'female', quality: 'A-' },
  { id: 'af_jessica', name: 'Jessica', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_kore', name: 'Kore', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_nicole', name: 'Nicole', language: 'en', locale: 'en-us', gender: 'female', quality: 'B-' },
  { id: 'af_nova', name: 'Nova', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_river', name: 'River', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_sarah', name: 'Sarah', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'af_sky', name: 'Sky', language: 'en', locale: 'en-us', gender: 'female', quality: 'B' },
  { id: 'am_adam', name: 'Adam', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'am_echo', name: 'Echo', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'am_eric', name: 'Eric', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'am_fenrir', name: 'Fenrir', language: 'en', locale: 'en-us', gender: 'male', quality: 'B-' },
  { id: 'am_liam', name: 'Liam', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'am_michael', name: 'Michael', language: 'en', locale: 'en-us', gender: 'male', quality: 'B-' },
  { id: 'am_onyx', name: 'Onyx', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'am_puck', name: 'Puck', language: 'en', locale: 'en-us', gender: 'male', quality: 'B-' },
  { id: 'am_santa', name: 'Santa', language: 'en', locale: 'en-us', gender: 'male', quality: 'B' },
  { id: 'bf_alice', name: 'Alice', language: 'en', locale: 'en-gb', gender: 'female', quality: 'B' },
  { id: 'bf_emma', name: 'Emma', language: 'en', locale: 'en-gb', gender: 'female', quality: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', language: 'en', locale: 'en-gb', gender: 'female', quality: 'C' },
  { id: 'bf_lily', name: 'Lily', language: 'en', locale: 'en-gb', gender: 'female', quality: 'B' },
  { id: 'bm_daniel', name: 'Daniel', language: 'en', locale: 'en-gb', gender: 'male', quality: 'B' },
  { id: 'bm_fable', name: 'Fable', language: 'en', locale: 'en-gb', gender: 'male', quality: 'C' },
  { id: 'bm_george', name: 'George', language: 'en', locale: 'en-gb', gender: 'male', quality: 'C' },
  { id: 'bm_lewis', name: 'Lewis', language: 'en', locale: 'en-gb', gender: 'male', quality: 'B' },
];

export const KOKORO_DEFAULT_VOICE_ID = 'ef_dora';
export const KOKORO_VOICE_PREFIX = 'kokoro:';
export const kokoroVoiceId = (id: string) => `${KOKORO_VOICE_PREFIX}${id}`;
export const isKokoroVoiceId = (value: string) => value.startsWith(KOKORO_VOICE_PREFIX);
