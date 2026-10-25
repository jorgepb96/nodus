import { researchSourcePresentation } from './researchSourceNotices';
// Shared shaping rules for an assembled writing/Deep Research document.
//
// `draftMarkdown` is a self-contained document: it opens with the abstract and
// closes with limitations and references. Every surface that ALSO renders those
// from the structured fields (the reader's subtitle and side panels, the PDF's
// abstract box) must drop them from the body first, or the reader sees each one
// twice. Keeping that rule in one pure module is what stops the two from drifting.

/** Section headings the body carries in each supported language. */
const SECTION_ALIASES: Record<'abstract' | 'limitations', string[]> = {
  abstract: ['resumen', 'abstract', 'résumé', 'resume', 'zusammenfassung', 'özet', 'ozet', 'resumo'],
  limitations: ['limitaciones', 'limitations', 'limites', 'limitações', 'limitacoes', 'einschränkungen', 'einschrankungen', 'sınırlılıklar', 'sinirliliklar'],
};

function normalizeHeading(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.:;]+$/, '')
    .trim();
}

/**
 * Remove the document's leading abstract block when it merely repeats `abstract`.
 * Left untouched when the body does not open with it, so drafts that never carried
 * one (and anything saved by an older build) render exactly as before.
 */
export function stripLeadingAbstract(markdown: string, abstract: string): string {
  const lines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0) return markdown;
  const expected = (abstract ?? '').replace(/\s+/g, ' ').trim();
  // Continuous reports intentionally have no heading, including for the opening
  // abstract. It is still part of the self-contained Markdown, so remove the first
  // paragraph when it matches the structured abstract rendered by the reader.
  if (!/^#{1,3}\s+/.test(lines[first])) {
    let next = first + 1;
    while (next < lines.length && lines[next].trim().length > 0) next += 1;
    const paragraph = lines.slice(first, next).join(' ').replace(/\s+/g, ' ').trim();
    if (!expected || !paragraph.includes(expected.slice(0, Math.min(80, expected.length)))) return markdown;
    while (next < lines.length && !lines[next].trim()) next += 1;
    return lines.slice(next).join('\n').trim();
  }
  let next = first + 1;
  while (next < lines.length && !/^#{1,3}\s+/.test(lines[next])) next++;
  const block = lines.slice(first + 1, next).join(' ').replace(/\s+/g, ' ').trim();
  if (!expected || !block || !block.includes(expected.slice(0, Math.min(80, expected.length)))) return markdown;
  return lines.slice(next).join('\n').trim();
}

/** Remove the bold inline limitations paragraph used by continuous reports. */
function stripInlineLimitations(markdown: string): string {
  const aliases = SECTION_ALIASES.limitations.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return markdown
    .replace(new RegExp(`^\\*\\*(?:${aliases})[.:;]?\\*\\*\\s+.*(?:\\n\\n|$)`, 'imu'), '')
    .trim();
}

/** Drop a whole `## <heading>` block from the body, headings matched by language alias. */
export function stripSection(markdown: string, kind: 'abstract' | 'limitations'): string {
  const aliases = new Set(SECTION_ALIASES[kind]);
  const lines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      skipping = aliases.has(normalizeHeading(line));
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The body to show next to a subtitle abstract and limitation/next-step panels.
 * Everything those surfaces render themselves is removed exactly once.
 */
export function documentBodyForPanels(markdown: string, abstract: string): string {
  return stripInlineLimitations(stripSection(stripLeadingAbstract(markdown, abstract), 'limitations'));
}

/** A research copy/export mirrors the reader's prose. Structured source notes
 * remain in the artifact and its alert control, outside the copied document. */
export function researchDocumentProse(markdown: string, hasSourceNotes = false): string {
  return researchSourcePresentation(hasSourceNotes ? stripInlineLimitations(stripSection(markdown, 'limitations')) : markdown).content;
}
