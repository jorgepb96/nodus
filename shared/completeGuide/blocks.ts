/**
 * The writer returns typed blocks; this module decides their provenance and renders
 * them. Labels, callout markers and citation links are produced here from data: a
 * block is "from your materials" only if it names extracted items, an AI example is
 * labelled as such and never links to a material, and web blocks only cite the web.
 *
 * A guide is prose first. Explanations, definitions, rules, formulas and procedures
 * render as ordinary paragraphs (a box on everything signals nothing); a box marks a
 * different mode of reading: a worked example, a warning about an error, an addition
 * by the AI or a page from the web. The AI notice is written in full on the first AI
 * block of the guide; every later one carries only the short mark in its title.
 */
import type { CompleteGuideItem } from './items';
import type { CompleteGuideLabels } from './labels';

export const COMPLETE_GUIDE_BLOCK_KINDS = ['explanation', 'definition', 'formula', 'rule', 'procedure', 'example', 'ai_example', 'ai_analogy', 'mistake', 'table', 'memorize', 'selfcheck', 'web'] as const;
export type CompleteGuideBlockKind = (typeof COMPLETE_GUIDE_BLOCK_KINDS)[number];
export type CompleteGuideProvenance = 'materials' | 'ai' | 'web' | 'derived';

export interface CompleteGuideTable { headers: string[]; rows: string[][] }

export interface CompleteGuideBlock {
  kind: CompleteGuideBlockKind;
  provenance: CompleteGuideProvenance;
  title?: string;
  markdown: string;
  itemIds: string[];
  table?: CompleteGuideTable;
  question?: string;
  answer?: string;
  /** Web blocks: ids of recorded web passages (`web:<sha>`). */
  webPassageIds?: string[];
  /** Tables whose rows already carry their own citations (e.g. "Detalles adicionales"). */
  citationsInRows?: boolean;
  /** Result of verification, for the coverage panel. */
  audit?: { checked: boolean; removedSentences: number; repaired: boolean };
}

export interface WrittenBlocksResult { blocks: CompleteGuideBlock[]; dropped: { unsupported: number; aiDisabled: number; malformed: number; redundant: number } }

const KINDS = new Set<string>(COMPLETE_GUIDE_BLOCK_KINDS);
const MATERIAL_KINDS = new Set<CompleteGuideBlockKind>(['explanation', 'definition', 'formula', 'rule', 'procedure', 'example', 'table', 'memorize']);

export function validWrittenBlocks(value: unknown): value is { blocks: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { blocks?: unknown }).blocks));
}

/**
 * Remove what only code may write: links and bare URLs (citations are appended from
 * item evidence), callout markers, headings (the outline is ours), HTML and any
 * pseudo-citation such as `[A1]`, `[K0012]` or `(p. 12)` that the model imitated.
 */
export function sanitizeModelMarkdown(value: string): string {
  return value
    // Models fall back to LaTeX's own delimiters; the guide's formulas are `$…$` and `$$…$$`.
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_match, tex: string) => `$${tex.trim()}$`)
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_match, tex: string) => `$$${tex.trim()}$$`)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\[[^\]]*\]\((?:nodus|file|javascript):[^)]*\)/gi, '')
    .replace(/\[(?:[ADGKW]\d+(?:\.\d+)?(?:\s*[,;·]\s*[^\]]{0,30})?)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(https?:[^)]*\)/gi, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    // A callout marker line. Only horizontal blanks before it: with `\s*` the blanks could run
    // across line breaks, and every line start in a run of blank lines rescanned the run twice
    // over, so 2,000 blank lines in a model's block took 8 s of main-process time (cubic). The
    // blank lines it used to absorb are folded by the `\n{3,}` step and the trim below.
    .replace(/^[^\S\r\n\u2028\u2029]*(?:>[^\S\r\n\u2028\u2029]*)?\[!\w[\w-]*\][^\n]*$/gim, '')
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/\[(?:[ADGKW]\d+(?:\.\d+)?(?:\s*[,;·]\s*[^\]]{0,30})?)\]/g, '')
    .replace(/\((?:K\d{4}(?:\s*,\s*K\d{4})*)\)/g, '')
    .replace(/(?<=\S)[ \t]{2,}/g, ' ')
    .replace(/(?<=\S) +([.,;:!?)])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cell(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? sanitizeModelMarkdown(String(value)).replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').slice(0, 400)
    : '';
}

function normalizeTable(raw: unknown): CompleteGuideTable | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as { headers?: unknown; rows?: unknown };
  const headers = Array.isArray(input.headers) ? input.headers.map(cell).filter(Boolean).slice(0, 6) : [];
  if (headers.length < 2 || !Array.isArray(input.rows)) return null;
  const rows = input.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => headers.map((_, index) => cell(row[index])))
    .filter((row) => row.some(Boolean))
    .slice(0, 40);
  return rows.length ? { headers, rows } : null;
}

export function normalizeWrittenBlocks(
  raw: unknown,
  options: { validItemIds: ReadonlySet<string>; items: ReadonlyMap<string, CompleteGuideItem>; aiExamples: boolean; webIds?: ReadonlySet<string> },
): WrittenBlocksResult {
  const dropped = { unsupported: 0, aiDisabled: 0, malformed: 0, redundant: 0 };
  const blocks: CompleteGuideBlock[] = [];
  const list = validWrittenBlocks(raw) ? raw.blocks : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') { dropped.malformed += 1; continue; }
    const input = entry as Record<string, unknown>;
    const kind: CompleteGuideBlockKind = KINDS.has(String(input.kind)) ? input.kind as CompleteGuideBlockKind : 'explanation';
    const itemIds = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(String).map((id) => id.trim().toUpperCase()).filter((id) => options.validItemIds.has(id)))];
    const title = typeof input.title === 'string' ? sanitizeModelMarkdown(input.title).replace(/\n/g, ' ').slice(0, 160) : '';
    const markdown = typeof input.markdown === 'string' ? sanitizeModelMarkdown(input.markdown).slice(0, 8_000) : '';
    const base = { kind, itemIds, ...(title ? { title } : {}) };
    // A "to memorize" list restates what the prose already said; the review sheet is the
    // guide's place for what to remember.
    if (kind === 'memorize') { dropped.redundant += 1; continue; }
    if (kind === 'web') {
      // Only passages actually recorded for this guide; a web block never cites materials.
      const webPassageIds = [...new Set((Array.isArray(input.webPassageIds) ? input.webPassageIds : []).map(String).map((id) => id.trim()).filter((id) => options.webIds?.has(id)))];
      if (!markdown) { dropped.malformed += 1; continue; }
      if (!webPassageIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'web', markdown, webPassageIds });
      continue;
    }
    if (kind === 'ai_example' || kind === 'ai_analogy') {
      if (!options.aiExamples) { dropped.aiDisabled += 1; continue; }
      if (!markdown) { dropped.malformed += 1; continue; }
      blocks.push({ ...base, provenance: 'ai', markdown });
      continue;
    }
    if (kind === 'mistake') {
      if (!markdown) { dropped.malformed += 1; continue; }
      const stated = itemIds.some((id) => options.items.get(id)?.type === 'mistake');
      if (stated) { blocks.push({ ...base, provenance: 'materials', markdown }); continue; }
      if (!options.aiExamples) { dropped.aiDisabled += 1; continue; }
      blocks.push({ ...base, provenance: 'ai', markdown });
      continue;
    }
    if (kind === 'selfcheck') {
      const question = typeof input.question === 'string' ? sanitizeModelMarkdown(input.question).slice(0, 1_000) : '';
      const answer = typeof input.answer === 'string' ? sanitizeModelMarkdown(input.answer).slice(0, 2_000) : '';
      if (!question || !answer) { dropped.malformed += 1; continue; }
      if (!itemIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'derived', markdown: '', question, answer });
      continue;
    }
    if (kind === 'table') {
      const table = normalizeTable(input.table);
      if (!table) { dropped.malformed += 1; continue; }
      if (!itemIds.length) { dropped.unsupported += 1; continue; }
      blocks.push({ ...base, provenance: 'materials', markdown, table });
      continue;
    }
    if (!markdown) { dropped.malformed += 1; continue; }
    if (MATERIAL_KINDS.has(kind) && !itemIds.length) { dropped.unsupported += 1; continue; }
    blocks.push({ ...base, provenance: 'materials', markdown });
  }
  return { blocks, dropped };
}

/** Items a set of blocks explains with material provenance (AI blocks only illustrate). */
export function coveredItemIds(blocks: CompleteGuideBlock[]): Set<string> {
  const covered = new Set<string>();
  for (const block of blocks) if (block.provenance === 'materials' || block.provenance === 'derived') for (const id of block.itemIds) covered.add(id);
  return covered;
}

/**
 * At most one AI addition per section, the first the writer produced, and none of the
 * `forbidden` kinds. The prompt asks for the same; this is the guarantee. Interesting but
 * unnecessary additions cost the student attention (the coherence principle), and in a chapter
 * about events an invented scenario or an analogy is decoration, not history.
 */
export function capAiBlocks(blocks: CompleteGuideBlock[], limit = 1, forbidden: readonly CompleteGuideBlockKind[] = []): { blocks: CompleteGuideBlock[]; dropped: number } {
  let kept = 0;
  let dropped = 0;
  const result = blocks.filter((block) => {
    if (block.provenance !== 'ai') return true;
    if (forbidden.includes(block.kind) || kept >= limit) { dropped += 1; return false; }
    kept += 1;
    return true;
  });
  return { blocks: result, dropped };
}

/**
 * The audit removes sentences from lists and bold runs; what is left can be a list that
 * counts 1, 2, 3, 6 or a `**` with nothing to close. Both are repaired here, after the
 * audit, so the plain Markdown and Word exports read as well as the reader does.
 */
export function renumberOrderedLists(markdown: string): string {
  const counters = new Map<number, number>();
  return markdown.split('\n').map((line) => {
    if (!line.trim()) return line;
    // Steps are numbered 1, 2, 3…: a line that opens with a year ("1874. La Restauración…") is a sentence, not a step.
    const ordered = line.match(/^(\s*)(\d{1,2})([.)])(\s+)/);
    const indent = (line.match(/^\s*/)?.[0].length) ?? 0;
    if (ordered) {
      for (const key of [...counters.keys()]) if (key > indent) counters.delete(key);
      const next = counters.get(indent);
      counters.set(indent, (next ?? Number(ordered[2])) + 1);
      return next === undefined ? line : `${ordered[1]}${next}${ordered[3]}${ordered[4]}${line.slice(ordered[0].length)}`;
    }
    // Text at the margin ends every list; an indented line continues the current one.
    for (const key of [...counters.keys()]) if (key >= indent && (indent === 0 || !/^\s*[-*+]\s/.test(line) || key > indent)) counters.delete(key);
    return line;
  }).join('\n');
}

/** One `**` that opens nothing or closes nothing, judged by its flanking characters. */
export function removeStrayBold(line: string): string {
  if (!line.includes('**')) return line;
  const masked = line.replace(/`[^`]*`|\$[^$]*\$/g, (part) => 'x'.repeat(part.length));
  const marks = [...masked.matchAll(/\*\*/g)].map((match) => match.index ?? 0);
  if (marks.length % 2 === 0) return line;
  const space = /[\s]/;
  const closes = (at: number) => at > 0 && !space.test(masked[at - 1]) && (at + 2 >= masked.length || space.test(masked[at + 2]) || /[.,;:!?)»\]]/.test(masked[at + 2]));
  const opens = (at: number) => at + 2 < masked.length && !space.test(masked[at + 2]) && (at === 0 || space.test(masked[at - 1]) || /[(«[¿¡]/.test(masked[at - 1]));
  let open: number | null = null;
  let stray: number | null = null;
  for (const at of marks) {
    if (open === null) {
      if (opens(at)) open = at;
      else { stray = at; break; }
    } else if (closes(at)) open = null;
    else if (opens(at)) { stray = open; break; }
  }
  if (stray === null) stray = open;
  if (stray === null) return line;
  return `${line.slice(0, stray)}${line.slice(stray + 2)}`.replace(/(?<=\S)[ \t]{2,}/g, ' ');
}

export function tidyAuditedMarkdown(markdown: string): string {
  return renumberOrderedLists(markdown).split('\n').map(removeStrayBold).join('\n');
}

export interface RenderContext {
  labels: CompleteGuideLabels;
  /** Citation links for an item's evidence, e.g. `[A1 · p. 12](nodus://…)`. */
  cite: (itemId: string) => string[];
  /** Web blocks: links to their recorded web passages. */
  citeWeb?: (webPassageId: string) => string | null;
  /**
   * Guide-wide render state. The AI notice is written in full on the first AI block and
   * flips this flag; without state every AI block carries the full notice (the safe default).
   */
  state?: { aiNoticeShown: boolean };
}

export interface RenderedBlock {
  markdown: string;
  /** Self-check blocks: printed together at the end of the chapter (see `renderPractice`). */
  practice?: PracticeEntry;
}

export interface PracticeEntry { question: string; answer: string }

/** Boxes are kept for what changes the mode of reading; everything else is prose. */
const CALLOUT: Partial<Record<CompleteGuideBlockKind, { type: string; label: keyof CompleteGuideLabels }>> = {
  example: { type: 'example', label: 'example' },
  ai_example: { type: 'ai-example', label: 'aiExampleShort' },
  ai_analogy: { type: 'ai-analogy', label: 'aiAnalogyShort' },
  web: { type: 'web', label: 'webSources' },
};
const PROSE_KINDS = new Set<CompleteGuideBlockKind>(['explanation', 'definition', 'formula', 'rule', 'procedure', 'memorize']);

/** Display math on its own lines: `$$x$$` inline in a sentence renders as small inline math. */
export function displayMathOnOwnLines(markdown: string): string {
  return markdown.replace(/[ \t]*\$\$([\s\S]+?)\$\$[ \t]*/g, (_match, tex: string) => `\n\n$$\n${tex.trim()}\n$$\n\n`).replace(/\n{3,}/g, '\n\n').trim();
}

/** Inside a numbered question a formula stays in the line: `$$x$$` → `$x$`. */
function inlineMath(markdown: string): string {
  return markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => `$${tex.replace(/\s+/g, ' ').trim()}$`).replace(/\s*\n+\s*/g, ' ').trim();
}

function quoteLines(markdown: string): string {
  return markdown.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

/**
 * Item evidence to cite after a block. Sentences the audit verified already carry a link
 * to their item's evidence (`e=K0012`); only the items no link points to are added, so
 * an audited paragraph is not cited twice and no item goes uncited.
 */
function citations(block: CompleteGuideBlock, context: RenderContext): string {
  if (block.provenance === 'web') {
    const links = (block.webPassageIds ?? []).map((id) => context.citeWeb?.(id)).filter((link): link is string => Boolean(link));
    return links.join('; ');
  }
  if (block.provenance !== 'materials' && block.provenance !== 'derived') return '';
  const linked = new Set([...`${block.markdown}\n${block.answer ?? ''}`.matchAll(/[?&]e=(K\d{4,})/g)].map((match) => match[1]));
  return [...new Set(block.itemIds.filter((id) => !linked.has(id)).flatMap((id) => context.cite(id)))].join('; ');
}

/**
 * Citations after a paragraph go in parentheses on its last line; after a list, a table,
 * a fenced block or a displayed formula they would end up inside the wrong construct, so
 * they take a line of their own.
 */
export function appendCitations(markdown: string, cites: string): string {
  const text = markdown.trimEnd();
  if (!cites) return text;
  const last = text.split('\n').pop() ?? '';
  const ownLine = /^\s*(?:[-*+]\s|\d+[.)]\s|\||```|>)/.test(last) || /\$\$\s*$/.test(last);
  return ownLine ? `${text}\n\n(${cites})` : `${text} (${cites})`;
}

export function renderTable(table: CompleteGuideTable): string {
  return [
    `| ${table.headers.join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The box already says what it is («Ejemplo (IA)»); a title that starts by saying it again
 * («Ejemplo: convertir 0,5 atm») keeps only what is specific.
 */
export function boxTitle(title: string | undefined, label: string): string {
  const clean = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const lead = fold(label).split(/[\s(（]/)[0];
  if (!lead || !fold(clean).startsWith(lead)) return clean;
  const split = clean.match(/^([^:：\-–—]{1,40})\s*[:：\-–—]\s*(\S[\s\S]*)$/);
  if (split && split[1].trim().split(/\s+/).length <= 4) return split[2].trim();
  return clean.split(/\s+/).length <= 3 ? '' : clean;
}

/** A bold lead-in for the legacy block kinds that carried a title; explanations never do. */
function leadIn(title: string | undefined, markdown: string): string {
  if (!title || /^\*\*/.test(markdown)) return markdown;
  return /^(\$\$|\s*(?:[-*+]|\d+[.)])\s)/.test(markdown) ? `**${title}.**\n\n${markdown}` : `**${title}.** ${markdown}`;
}

/**
 * One block as Markdown. Prose is plain paragraphs; the few boxes use the Obsidian
 * syntax `> [!type] Label · title`, which the reader, the PDF and Word render as cards
 * and plain Markdown keeps legible. Self-check questions are returned separately so they
 * can be printed together, mixed across sections, at the end of the chapter.
 */
export function renderBlock(input: CompleteGuideBlock, context: RenderContext): RenderedBlock {
  const { labels } = context;
  const block = { ...input, markdown: displayMathOnOwnLines(input.markdown), ...(input.question ? { question: inlineMath(input.question) } : {}), ...(input.answer ? { answer: displayMathOnOwnLines(input.answer) } : {}) };
  const cites = citations(block, context);
  if (block.kind === 'selfcheck') {
    return { markdown: '', practice: { question: block.question ?? '', answer: `${block.answer ?? ''}${cites ? ` (${cites})` : ''}` } };
  }
  if (block.kind === 'table' && block.table) {
    const heading = `**${block.title || labels.summaryTable}**`;
    return { markdown: [heading, block.markdown, renderTable(block.table), block.citationsInRows ? '' : cites].filter(Boolean).join('\n\n') };
  }
  const box = (type: string, label: string, body: string): RenderedBlock => {
    const specific = boxTitle(block.title, label);
    return { markdown: `> [!${type}] ${specific ? `${label} · ${specific}` : label}\n${quoteLines(body)}` };
  };
  if (block.provenance === 'ai') {
    // The full notice once; afterwards the mark in the title is the whole label.
    const full = !context.state || !context.state.aiNoticeShown;
    if (context.state) context.state.aiNoticeShown = true;
    const body = `${block.markdown}${full ? `\n\n*${labels.aiNote}*` : ''}`;
    if (block.kind === 'mistake') return box('ai-mistake', labels.aiMistakeShort, body);
    return box(CALLOUT[block.kind]?.type ?? 'ai-example', labels[CALLOUT[block.kind]?.label ?? 'aiExampleShort'], body);
  }
  const citeLine = cites ? `\n\n${cites}` : '';
  if (block.kind === 'mistake') return box('mistake', labels.mistake, `${block.markdown}${citeLine}`);
  const callout = CALLOUT[block.kind];
  if (callout) {
    const note = block.provenance === 'web' ? `\n\n*${labels.webNote}*` : '';
    return box(callout.type, labels[callout.label], `${block.markdown}${note}${citeLine}`);
  }
  if (PROSE_KINDS.has(block.kind)) {
    const title = block.kind === 'explanation' ? undefined : block.kind === 'memorize' ? labels.memorize : block.title;
    return { markdown: appendCitations(leadIn(title, block.markdown), cites) };
  }
  return { markdown: appendCitations(block.markdown, cites) };
}

/**
 * The chapter's self-check questions, printed together after the explanation and mixed
 * across its sections (one from each in turn): retrieval practice works when the student
 * has to decide what a question is about, and the answers follow so the attempt comes first.
 */
export function renderPractice(groups: PracticeEntry[][], labels: CompleteGuideLabels): string {
  const queue = groups.map((group) => [...group]).filter((group) => group.length);
  const entries: PracticeEntry[] = [];
  while (queue.some((group) => group.length)) for (const group of queue) { const next = group.shift(); if (next) entries.push(next); }
  if (!entries.length) return '';
  return [
    `> [!selfcheck] ${labels.selfCheck}\n>\n${entries.map((entry, index) => `> ${index + 1}. ${entry.question}`).join('\n')}`,
    `**${labels.selfCheckAnswers}**`,
    ...entries.map((entry, index) => `**${index + 1}.** ${entry.answer}`),
  ].join('\n\n');
}
