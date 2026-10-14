// How a source is named in a citation, in one place.
//
// These strings are written into a report once, at generation time, and then read
// back for as long as the report exists. That makes them two things at once: prose
// the writer produced, and a claim about the corpus that must still be true later.
// When a work's byline is corrected — an editor who was miscredited as an author,
// say — every stored label naming that person becomes a lie the report keeps
// repeating.
//
// The fix is to re-derive the label from the corpus when the report is read. That
// only works if the reader derives it *exactly* as the writer did, so both sides
// import these functions instead of keeping their own copy.

import type { PromptLanguage } from './types';

/**
 * How an editor is marked inside a stored byline. Defined here, with the code that
 * reads bylines, and re-exported by the repo that writes them, so the marker can
 * never be spelled two ways.
 */
export const EDITOR_BYLINE_SUFFIX = ' (ed.)';

/** What a work with neither author nor title is called in each content language. */
const UNTITLED_WORK: Record<PromptLanguage, string> = {
  es: 'Obra sin autor',
  en: 'Untitled work',
  fr: 'Œuvre sans auteur',
  de: 'Werk ohne Autor',
  pt: 'Obra sem autor',
  'pt-BR': 'Obra sem autor',
  it: 'Opera senza autore',
  tr: 'Yazarsız eser',
  'zh-Hans': '无作者作品',
  'zh-Hant': '無作者作品',
  vi: 'Tác phẩm không rõ tác giả',
  ja: '著者不明の著作',
  ru: 'Работа без автора',
  uk: 'Праця без автора',
  ko: '저자 미상 저작',
};

/** Trim to `max` characters on a word-safe boundary, with an ellipsis. */
export function clipLabel(text: string, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

/** Turn Nodus's stored `Apellido, I.` name into a readable inline citation. */
export function authorYearLabel(
  author: string | undefined,
  year: number | null | undefined,
  title?: string,
  language: PromptLanguage = 'es',
): string {
  const trimmed = author?.replace(/\s+/g, ' ').trim();
  // A work Zotero credits to editors only is cited under one of them, and the
  // citation says so. Dropping the marker here would put the whole point of the
  // byline back: a reader seeing "Román Ruiz, G. (2024)" has no way to tell that
  // she edited the volume rather than wrote it.
  const marker = EDITOR_BYLINE_SUFFIX.trim();
  const isEditor = !!trimmed && trimmed.toLowerCase().endsWith(marker.toLowerCase());
  const raw = isEditor ? trimmed.slice(0, trimmed.length - marker.length).trim() : trimmed;
  if (!raw) {
    // "Autor" reads as a placeholder in the middle of academic prose. A shortened
    // title is a real citation for a source whose author the corpus never captured.
    const short = clipLabel((title ?? '').replace(/\s+/g, ' ').trim(), 42);
    if (short) return year ? `${short} (${year})` : short;
    const untitled = UNTITLED_WORK[language] ?? UNTITLED_WORK.es;
    return year ? `${untitled} (${year})` : untitled;
  }
  const comma = raw.indexOf(',');
  const surname = (comma >= 0 ? raw.slice(0, comma) : raw.split(' ').slice(-1).join(' ')).trim() || raw;
  const given = (comma >= 0 ? raw.slice(comma + 1) : raw.split(' ').slice(0, -1).join(' ')).trim();
  const initial = given.match(/[\p{L}]/u)?.[0]?.toLocaleUpperCase('es-ES');
  const base = initial ? `${surname}, ${initial}.` : surname;
  // The year keeps its own trailing parentheses so every label still ends the way
  // looksLikeGeneratedLabel and splitPageSuffix expect.
  const name = isEditor ? `${base}${EDITOR_BYLINE_SUFFIX}` : base;
  return year ? `${name} (${year})` : name;
}

/** The inline citation for one work. */
export function sourceLabelFromWork(
  work: { authors: string[]; year: number | null; title?: string } | undefined,
  language: PromptLanguage = 'es',
): string {
  if (!work) return '';
  return authorYearLabel(work.authors[0], work.year, work.title, language);
}

/** One line of the reference list. */
export function referenceEntry(
  work: { authors: string[]; year: number | null; title?: string | null; doi?: string | null },
  labels: { unknownAuthor: string; noDate: string }
): string {
  const authors = work.authors.length ? work.authors.join('; ') : labels.unknownAuthor;
  const year = work.year ? ` (${work.year})` : ` (${labels.noDate})`;
  const title = work.title ? `. ${work.title.replace(/\.\s*$/, '')}.` : '.';
  const doi = work.doi?.trim() ? ` https://doi.org/${work.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : '';
  return `${authors}${year}${title}${doi}`;
}

/**
 * A markdown link to a Nodus source: `[label](nodus://kind/id)`. The label is
 * captured lazily and forbidden from containing brackets so a nested link cannot
 * swallow the one after it.
 */
export const NODUS_LINK_RE = /\[([^\]]*)\]\(nodus:\/\/([a-z]+)\/([^)\s]+)\)/g;

/**
 * Whether a stored link label is one this module produced, and may therefore be
 * replaced by a freshly derived one.
 *
 * The test is deliberately narrow. A `nodus://` link can also be written by a
 * person — in a note, or in a sentence like "[as discussed here](nodus://idea/x)"
 * — and rewriting that would destroy their prose to fix a problem it never had.
 * Every label this module generates for a dated source ends in a parenthesised
 * year, optionally followed by a page locator for a passage; nothing else is
 * touched. An undated source is left alone too: it is rare, and being conservative
 * costs only a stale label, while being wrong costs the reader's own words.
 */
export function looksLikeGeneratedLabel(label: string): boolean {
  return /\(\d{3,4}\)(?:,\s*[^,]{1,40})?\s*$/.test(label.trim());
}

/** Accent- and case-insensitive form, for comparing two spellings of a surname. */
export function normalizeName(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The year a generated label ends with, or null when it carries none. */
export function yearOfLabel(label: string): number | null {
  const { base } = splitPageSuffix(label);
  const match = /\((\d{3,4})\)\s*$/.exec(base);
  return match ? Number(match[1]) : null;
}

/**
 * The surname a generated label names, normalized. Empty when the label falls back
 * to a shortened title instead of a person.
 */
export function surnameOfLabel(label: string): string {
  const { base } = splitPageSuffix(label);
  const withoutYear = base.replace(/\s*\((\d{3,4})\)\s*$/, '').trim();
  const withoutMarker = withoutYear.replace(new RegExp(`\\s*\\${EDITOR_BYLINE_SUFFIX.trim()}\\s*$`.replace('(', '\\('), 'i'), '').trim();
  const comma = withoutMarker.indexOf(',');
  return normalizeName(comma >= 0 ? withoutMarker.slice(0, comma) : withoutMarker);
}

/** The page locator a passage label carries after its author-year, if any. */
export function splitPageSuffix(label: string): { base: string; suffix: string } {
  const match = /^(.*\(\d{3,4}\))(,\s*.+)$/.exec(label.trim());
  return match ? { base: match[1], suffix: match[2] } : { base: label.trim(), suffix: '' };
}
