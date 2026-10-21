/**
 * The *listening* copy of a Deep Research report or Research Chat answer.
 *
 * On screen a report is full of things that only make sense while you can see
 * them: `nodus://` citation buttons, the author-year parentheses around them, a
 * reference list at the end, Markdown syntax. Pasted into a text-to-speech
 * reader (ElevenReader and friends) every one of those becomes an interruption —
 * the voice stops to spell out surnames, years and page numbers the listener is
 * already following on screen.
 *
 * {@link toReadingCopy} keeps the prose and drops exactly that scaffolding. It is
 * deliberately separate from {@link markdownToSpeech} in electron/audio/speakable.ts:
 * that one prepares *segments* for in-app narration and is allowed to be lossy
 * (it deletes tables and code, and speaks formulas as Spanish words). This one is
 * a copy of the whole document in whatever language it is written in, so it keeps
 * every piece of content and only removes the citation apparatus.
 *
 * Pure: no Electron, no DOM. Imported by the renderer and unit-tested directly.
 */

/** A placeholder no report can contain, used to mark removed citations so the
 *  parentheses that wrapped them can be recognised and dropped as well. */
const CITE = '\u0000';
/** The same placeholder, escaped for embedding in a RegExp source string. */
const CITE_RE = '\\u0000';

const NODUS_LINK = /\[([^\]\n]*)\]\(nodus:\/\/[^)\s]*\)/g;
const BARE_NODUS_URL = /nodus:\/\/[^\s)\]]+/g;

/**
 * A citation label that is a *reference* — `Pack, S. (2009)`, `Vallejo, R. (2019), p. 33`,
 * the canonical form the citation policy rewrites every idea/work/passage link into.
 * Those labels are pure apparatus and go with the link.
 *
 * Labels that are not reference-shaped are ordinary words: a gap or a contradiction is
 * cited as `[contradicción](nodus://contradiction/…)`, and the writer uses that word
 * either inside the sentence ("Hay una contradicción entre las cifras") or appended to
 * it as a marker ("las series son fragmentarias [hueco]"). Only the first one is prose,
 * and what tells them apart is whether the sentence keeps going on the same line: those
 * labels are unwrapped to plain text, the appended ones go like any other citation.
 */
const REFERENCE_LABEL = /\(\s*(?:\d{4}[a-z]?|s\.\s*f\.|n\.\s*d\.)\s*\)|,\s*(?:\p{Lu}\.|\d{4}[a-z]?|s\.\s*f\.|n\.\s*d\.)/u;
const ANONYMOUS_LABEL = /^\s*(?:Autor(?:es)?|Author|Auteur|Autore|Autor desconhecido|Unknown)?\s*$/u;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g;
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\([^)]*\)/g;
const FOOTNOTE_REF = /\[\^[^\]\n]+\]/g;
const FOOTNOTE_DEFINITION = /^\[\^[^\]\n]+\]:.*$/gm;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?>/g;

/**
 * A reference written straight into the prose — `Pardo, I. (2018) llegó a hablar de…`.
 * It appears whenever the model states an author-year without linking it, and
 * whenever the citation policy strips an invented target but keeps its label.
 * Unlike a linked citation this one is usually the subject of its sentence, so only
 * the apparatus is removed: `Pardo, I. (2018) llegó` becomes `Pardo llegó`, not a
 * sentence with no subject. The initials plus the parenthesised year are what make
 * the shape safe to match — ordinary prose does not write `, I. (2018)` after a name.
 */
const BARE_CITATION_LABEL =
  /(\p{Lu}[\p{L}’'-]*(?:\s+(?:de|del|la|las|los|van|von|di|da|das|dos|do|du|le|ten|ter|bin|ibn|\p{Lu}[\p{L}’'-]*))*),\s*\p{Lu}\.(?:\s*\p{Lu}\.)*\s*\((?:\d{4}[a-z]?|s\.\s*f\.|n\.\s*d\.)\)/gu;

/**
 * The vocabulary a parenthetical citation is made of: capitalised surnames,
 * initials, years, page ranges and the handful of connectors editions use. A
 * parenthesis whose whole content is made of these tokens *and* carries a year is
 * a citation, not an aside — an aside always contains ordinary lowercase words,
 * which none of these alternatives can match. Not case-insensitive on purpose:
 * under `i` the `\p{Lu}` class would also match lowercase words and swallow prose.
 */
const CITATION_TOKEN =
  /(?:et\s+al\.?|[Cc]fr?\.?|[Vv]id\.?|[Ii]bid\.?|[Oo]p\.\s*cit\.?|[Vv][ée]ase|[Vv]er|[Ss]ee|[Ss]iehe|[Ss]egún|and|und|y|e|&|\b(?:de|del|la|las|los|van|von|di|da|das|dos|do|du|le|ten|ter|bin|ibn)\b|s\.\s*f\.|n\.\s*d\.|\d{4}[a-z]?|pp?\.|p[áa]gs?\.|ss\.|\d+(?:\s*[–—-]\s*\d+)?|\p{Lu}[\p{L}’'-]*\.?|[,;:.\s])/gu;

/** Something datelike must be present, or `(Madrid)` would count as a citation. */
const CITATION_ANCHOR = /\d{4}|s\.\s*f\.|n\.\s*d\./u;

/**
 * Headings that open a reference list, in every language a report can be written
 * or translated into. Compared with diacritics folded, so `Références`,
 * `Referências` and `Kaynakça` all reduce to a single entry.
 */
const REFERENCE_HEADINGS = new Set(
  [
    'referencias', 'referencia', 'references', 'reference', 'referencias bibliograficas',
    'referencias y fuentes', 'bibliografia', 'bibliographie', 'bibliography', 'bibliografie',
    'literaturverzeichnis', 'quellen', 'quellenverzeichnis',
    'fuentes', 'fuentes de estudio', 'fuentes consultadas', 'fuentes citadas',
    'fontes', 'fontes de estudo', 'fonti', 'fonti di studio',
    'sources', 'sources d’etude', "sources d'etude", 'study sources', 'studienquellen',
    'kaynakca', 'kaynaklar', 'calisma kaynaklari',
    'obras citadas', 'works cited', 'notas', 'notes', 'opere citate',
  ].map(foldDiacritics)
);

export interface ReadingCopyOptions {
  /** Report title, prepended as its own line when the markdown does not carry one. */
  title?: string | null;
}

/**
 * Turn a report's Markdown into clean prose a voice reader can narrate without
 * stumbling: no citation buttons, no author-year parentheses, no reference list,
 * no Markdown syntax. Everything else — headings, paragraphs, lists, tables,
 * block quotes — is kept, because this is a copy of the document, not a summary.
 */
export function toReadingCopy(markdown: string, options: ReadingCopyOptions = {}): string {
  let text = (markdown ?? '').replace(/\r\n?/g, '\n');

  text = dropReferenceSections(text);
  text = text.replace(HTML_COMMENT, '').replace(FOOTNOTE_DEFINITION, '');
  text = text.replace(MARKDOWN_IMAGE, '');

  // Citations become sentinels so the parentheses that only existed to hold them
  // — `(… ; …)` — can be recognised and removed with the citation inside.
  text = text.replace(NODUS_LINK, (match: string, label: string, offset: number, source: string) =>
    isCitationApparatus(label, source.slice(offset + match.length)) ? CITE : label
  );
  text = text.replace(BARE_NODUS_URL, CITE);
  text = dropEmptiedParentheses(text);
  text = text.split(CITE).join('');

  text = text.replace(MARKDOWN_LINK, '$1').replace(FOOTNOTE_REF, '');
  // Labels first, parentheticals second: stripping `(2019)` on its own would
  // otherwise leave a dangling `García, I.` in the middle of the sentence.
  text = text.replace(BARE_CITATION_LABEL, '$1');
  text = dropCitationParentheses(text);
  text = text.replace(HTML_TAG, '');

  text = flattenMarkdownLines(text);
  text = tidy(text);

  const title = (options.title ?? '').trim();
  return title ? `${title}\n\n${text}`.trim() : text;
}

/**
 * Is this citation apparatus, to be removed whole, or a word of the sentence?
 * A reference label always is apparatus. Any other label is apparatus only when the
 * sentence does not continue after it on the same line — that is what distinguishes
 * an appended marker from a noun the sentence is built around.
 */
function isCitationApparatus(label: string, rest: string): boolean {
  if (ANONYMOUS_LABEL.test(label) || REFERENCE_LABEL.test(label)) return true;
  const next = rest.match(/^[ \t]*(\S)/)?.[1] ?? '';
  return !/[\p{L}\p{N}]/u.test(next);
}

/** Fold accents so heading names can be compared across languages. */
function foldDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase();
}

/**
 * Remove every reference section: the heading itself and everything under it up
 * to the next heading of the same or a shallower level. A bibliography read aloud
 * is a minute of surnames and years, which is precisely what this copy is for
 * avoiding.
 */
function dropReferenceSections(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let skipLevel = 0;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && isReferenceHeading(heading[2])) {
        skipLevel = level;
        continue;
      }
    }
    if (!skipLevel) out.push(line);
  }
  return out.join('\n');
}

function isReferenceHeading(text: string): boolean {
  const clean = foldDiacritics(text.replace(/[#*_`~]/g, '').replace(/^\d+[.)]\s*/, '').replace(/[:.]+$/, '').trim());
  return REFERENCE_HEADINGS.has(clean);
}

/** Drop parentheses and brackets whose only content was a citation. */
const EMPTIED_FILLER = `(?:${CITE_RE}|[;,.&y\\s]|and|see|cf\\.?|v[ée]ase|vid\\.?)*`;
const EMPTIED_PARENTHESIS = new RegExp(`[ \\t]*[([]${EMPTIED_FILLER}${CITE_RE}${EMPTIED_FILLER}[)\\]]`, 'gu');

function dropEmptiedParentheses(text: string): string {
  return text.replace(EMPTIED_PARENTHESIS, '');
}

/**
 * Remove parenthetical citations written as prose — `(García, 2019)`,
 * `(cf. Ortiz, I., 2019, pp. 33-40)`. A parenthesis is only removed when it
 * carries a year and nothing that is not citation vocabulary, so a real aside
 * survives. The deliberate cost: a bare `(1966)` after a noun goes too. That is
 * the right trade for a listening copy — the year is on screen, and stopping the
 * narration for it is exactly what this copy exists to avoid.
 */
function dropCitationParentheses(text: string): string {
  return text.replace(/\(([^()\n]{1,160})\)/g, (whole, inner: string) => {
    if (!CITATION_ANCHOR.test(inner)) return whole;
    return inner.replace(CITATION_TOKEN, '').trim() === '' ? '' : whole;
  });
}

/**
 * Flatten Markdown structure into plain lines. Headings keep their text and gain a
 * full stop so a reader pauses on them; lists lose their bullets; table rows become
 * comma-separated sentences instead of being dropped, so no content disappears
 * silently; fenced code keeps its content and loses the fences.
 */
function flattenMarkdownLines(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw.trimEnd());
      continue;
    }
    if (!line) {
      out.push('');
      continue;
    }
    // Horizontal rules and table separator rows carry no text.
    if (/^(?:\s*[-*_]){3,}\s*$/.test(line)) continue;
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const value = stripInlineMarkers(heading[1]);
      if (value) out.push(ensureStop(value));
      continue;
    }
    if (/^\|.*\|/.test(line)) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => stripInlineMarkers(cell)).filter(Boolean);
      if (cells.length) out.push(ensureStop(cells.join(', ')));
      continue;
    }
    const body = line.replace(/^>\s?/, '');
    const item = body.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const value = stripInlineMarkers(item[1]);
      if (value) out.push(ensureStop(value));
      continue;
    }
    const value = stripInlineMarkers(body);
    if (value) out.push(value);
  }
  return out.join('\n');
}

function stripInlineMarkers(value: string): string {
  return value
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

function ensureStop(value: string): string {
  return /[.!?:;…]$/.test(value) ? value : `${value}.`;
}

/** Repair the punctuation and spacing that removing citations leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]+([.,;:!?…])/g, '$1')
    .replace(/([([])[ \t]+/g, '$1')
    .replace(/[ \t]+([)\]])/g, '$1')
    .replace(/,(\s*[,;])/g, '$1')
    .replace(/([,;:])\s*\./g, '.')
    .replace(/\.{4,}/g, '…')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]*[,;:][ \t]*/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
