// SPDX-License-Identifier: AGPL-3.0-only
import type { TtsLanguage } from './ttsModels';

/**
 * Voice library entries. Ids carry their origin so they never collide:
 *   `user:<uuid>`   recorded or uploaded by the user (clone)
 *   `cc0:<name>`    reference recordings that ship with Nodus (clone, read-only)
 *   `ming:<name>`   Ming's built-in voices (no reference audio)
 *   `phonon:<id>`   Phonon's catalogue voices (speaker embeddings)
 */
export type TtsVoiceOrigin = 'recorded' | 'uploaded' | 'bundled' | 'builtin' | 'phonon';

export interface TtsVoice {
  id: string;
  name: string;
  origin: TtsVoiceOrigin;
  language: TtsLanguage;
  /** Exact transcript of the reference recording (clone voices only). */
  transcript?: string;
  durationS?: number;
  createdAt?: string;
  /** Shown for bundled voices. */
  attribution?: string;
  /** Phonon catalogue: locale (es-es, es-mx, en-us…) and gender. */
  locale?: string;
  gender?: 'male' | 'female' | 'none';
  description?: string;
  readOnly: boolean;
}

export interface TtsVoiceSaveInput {
  name: string;
  language: TtsLanguage;
  transcript: string;
  origin: 'recorded' | 'uploaded';
  /** 16-bit PCM mono WAV prepared by the renderer (trimmed and normalized). */
  wav: Uint8Array;
  /** The user confirmed the voice is theirs or they have its owner's permission. */
  consent: true;
}

export const TTS_VOICE_MIN_S = 3;
export const TTS_VOICE_RECOMMENDED_MIN_S = 6;
export const TTS_VOICE_RECOMMENDED_MAX_S = 15;
export const TTS_VOICE_MAX_S = 30;
export const TTS_VOICE_MAX_BYTES = 12 * 1024 * 1024;

export const isUserVoiceId = (id: string) => id.startsWith('user:');
export const isBuiltinVoiceId = (id: string) => id.startsWith('ming:');
export const builtinVoiceId = (name: string) => `ming:${name}`;

/**
 * Paragraphs to read aloud when recording a reference voice: about 10–15 seconds each, with
 * the sounds that give an accent away (for Castilian Spanish, z/c before e/i and ll/y).
 */
export const TTS_SAMPLE_PARAGRAPHS: Readonly<Record<TtsLanguage, readonly string[]>> = {
  es: [
    'En este capítulo analizaremos la hipótesis principal del estudio. Los resultados sugieren que la concentración de zinc influye directamente en la eficacia del proceso, aunque conviene interpretarlos con cautela.',
    'Durante el siglo diecinueve, las ciudades crecieron con rapidez y la población cambió sus costumbres. Muchos cronistas describieron aquel proceso con una mezcla de entusiasmo, sorpresa y cierta preocupación.',
    'La lluvia caía sobre la plaza mientras cerrábamos la biblioteca. Al día siguiente, decidimos revisar de nuevo las fuentes, comparar las citas y escribir una conclusión más precisa.',
    'Conviene distinguir entre correlación y causalidad. Que dos variables crezcan a la vez no significa que una provoque la otra; hace falta un diseño que descarte explicaciones alternativas.',
  ],
  en: [
    'In this chapter we examine the study\'s main hypothesis. The results suggest that zinc concentration directly affects the efficiency of the process, although they should be interpreted with caution.',
    'Throughout the nineteenth century, cities grew quickly and daily life changed with them. Many writers described that transformation with a mix of enthusiasm, surprise and some concern.',
  ],
  zh: [
    '在本章中，我们将分析这项研究的主要假设。结果表明，锌的浓度会直接影响整个过程的效率，但我们仍需谨慎解读这些数据。',
  ],
  fr: [
    'Dans ce chapitre, nous analyserons l\'hypothèse principale de l\'étude. Les résultats suggèrent que la concentration de zinc influence directement l\'efficacité du processus, mais il convient de les interpréter avec prudence.',
  ],
  de: [
    'In diesem Kapitel untersuchen wir die zentrale Hypothese der Studie. Die Ergebnisse deuten darauf hin, dass die Zinkkonzentration die Wirksamkeit des Verfahrens direkt beeinflusst, sollten aber vorsichtig interpretiert werden.',
  ],
  ja: [
    'この章では、研究の主要な仮説を分析します。結果は、亜鉛の濃度が工程の効率に直接影響することを示していますが、慎重に解釈する必要があります。',
  ],
  ko: [
    '이 장에서는 연구의 주요 가설을 분석합니다. 결과에 따르면 아연 농도가 공정의 효율에 직접적인 영향을 미치지만, 신중하게 해석할 필요가 있습니다.',
  ],
  pt: [
    'Neste capítulo analisaremos a hipótese principal do estudo. Os resultados sugerem que a concentração de zinco influencia diretamente a eficácia do processo, embora convenha interpretá-los com cautela.',
  ],
};

export interface WavInfo { sampleRate: number; channels: number; bitsPerSample: number; durationS: number }

/** Reads a canonical PCM WAV header; returns null for anything else. Pure, so both sides can use it. */
export function readWavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let format: { channels: number; sampleRate: number; bitsPerSample: number; audioFormat: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 24 <= bytes.byteLength) {
      format = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data' && format) {
      if (format.audioFormat !== 1 || !format.sampleRate || !format.channels || !format.bitsPerSample) return null;
      const dataBytes = Math.min(size, bytes.byteLength - offset - 8);
      const frames = dataBytes / (format.channels * (format.bitsPerSample / 8));
      return { sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, durationS: frames / format.sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}
