// SPDX-License-Identifier: AGPL-3.0-only
import type { TtsLanguage, TtsLanguageSetting } from './ttsModels';

/**
 * Which of Ming's languages a text is in, without a model or a network call. Scripts settle
 * Japanese (kana), Korean (hangul) and Chinese (han without kana); Latin-script text is scored
 * on frequent function words. Returns null when the text is too short or ambiguous, so the
 * caller falls back to the voice's own language.
 */
const FUNCTION_WORDS: Readonly<Record<'es' | 'en' | 'fr' | 'de' | 'it' | 'pt' | 'nl', ReadonlySet<string>>> = {
  es: new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'con', 'para', 'es', 'se', 'del', 'como', 'pero', 'más', 'sus', 'este', 'esta', 'son', 'también', 'sobre', 'entre']),
  en: new Set(['the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'it', 'with', 'as', 'on', 'are', 'this', 'by', 'be', 'was', 'from', 'which', 'an', 'or', 'not', 'have', 'their', 'these']),
  fr: new Set(['le', 'la', 'les', 'des', 'de', 'et', 'est', 'un', 'une', 'du', 'que', 'qui', 'dans', 'pour', 'sur', 'pas', 'au', 'aux', 'avec', 'ce', 'cette', 'sont', 'mais', 'leur', 'nous']),
  de: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'den', 'dem', 'mit', 'von', 'auf', 'für', 'sich', 'auch', 'es', 'im', 'des', 'werden', 'wird', 'sind', 'aber', 'oder']),
  it: new Set(['il', 'lo', 'gli', 'della', 'delle', 'degli', 'che', 'non', 'sono', 'per', 'con', 'una', 'questo', 'questa', 'nel', 'nella', 'anche', 'come', 'più', 'sul']),
  pt: new Set(['os', 'as', 'dos', 'das', 'uma', 'que', 'não', 'são', 'para', 'com', 'por', 'nos', 'nas', 'pelo', 'pela', 'também', 'mais', 'seus', 'suas', 'muito']),
  nl: new Set(['het', 'een', 'van', 'en', 'dat', 'zijn', 'niet', 'voor', 'met', 'op', 'deze', 'dit', 'wordt', 'worden', 'ook', 'maar', 'als', 'door', 'naar', 'uit']),
};

export function detectTtsLanguage(text: string): TtsLanguage | null {
  const sample = text.slice(0, 4000);
  const kana = (sample.match(/[぀-ヿ]/g) ?? []).length;
  const hangul = (sample.match(/[가-힯ᄀ-ᇿ]/g) ?? []).length;
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  const letters = (sample.match(/\p{L}/gu) ?? []).length || 1;
  if (hangul / letters > 0.2) return 'ko';
  if (kana / letters > 0.05) return 'ja';
  if (han / letters > 0.2) return 'zh';

  const words = sample.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return null;
  const scores = (Object.keys(FUNCTION_WORDS) as Array<keyof typeof FUNCTION_WORDS>).map((language) => {
    let score = 0;
    for (const word of words) if (FUNCTION_WORDS[language].has(word)) score += 1;
    // Letters only one of the four languages uses settle near-ties.
    if (language === 'es' && /[ñ¿¡]/.test(sample)) score += 3;
    if (language === 'de' && /[ßäöü]/.test(sample)) score += 2;
    if (language === 'fr' && /[àâçèêëîïôûœ]/.test(sample)) score += 2;
    if (language === 'pt' && /[ãõ]/.test(sample)) score += 3;
    return [language, score] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] > 0 && best[1] > second[1] ? best[0] : null;
}

/** The language a narration uses: the explicit choice, else the text's, else the voice's. */
export function resolveTtsLanguage(setting: TtsLanguageSetting, text: string, voiceLanguage: TtsLanguage | null): TtsLanguage {
  if (setting !== 'auto') return setting;
  return detectTtsLanguage(text) ?? voiceLanguage ?? 'es';
}
