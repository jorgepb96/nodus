// The common nouns a citation falls back to when it has no author-year to show.
//
// A citation pill is prose the reader sees, so these words follow the language the
// content was generated in. They used to be Spanish literals scattered through the
// pipelines ("fuente", "hueco", "contradicción"), which put Spanish in front of
// readers of every other language whenever a model copied a template label or a
// source had no byline.
import { PROMPT_LANGUAGES, type PromptLanguage } from './types';
import { dictionaryRuntimeCopy } from './academicPromptPacks';
import { writingWorkshopPromptPack } from './writingWorkshopPromptPacks';

export interface CitationWords {
  /** A source in general, used as a neutral label to be replaced by its author-year. */
  source: string;
  /** A research gap cited without a source of its own. */
  gap: string;
  /** A contradiction cited without a source of its own. */
  contradiction: string;
  /** An idea of the corpus whose work has no byline. */
  corpusSource: string;
  /** Stand-in for a missing author name. */
  author: string;
}

export function citationWords(language: PromptLanguage = 'es'): CitationWords {
  const fallback = writingWorkshopPromptPack(language).fallback;
  return {
    source: dictionaryRuntimeCopy(language).evidenceCitationLabel,
    gap: fallback.gapCitationLabel,
    contradiction: fallback.contradictionCitationLabel,
    corpusSource: fallback.sourceFallback,
    author: fallback.authorFallback(null),
  };
}

function normalizeWord(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

const GENERIC_LABELS = new Set<string>(
  PROMPT_LANGUAGES.flatMap((language) => {
    const words = citationWords(language);
    return [words.source, words.gap, words.contradiction].map(normalizeWord);
  }),
);

/**
 * True when a citation's visible text is only a placeholder noun — "fuente",
 * "source 2", "Quelle", "hueco" — in any supported language, rather than a name
 * a reader can identify. Such a label carries no information of its own, so it is
 * always safe to replace with the source's author-year.
 */
export function isGenericCitationLabel(label: string): boolean {
  const word = normalizeWord(label).replace(/[\s#.:-]*\d+$/u, '').trim();
  return GENERIC_LABELS.has(word);
}
