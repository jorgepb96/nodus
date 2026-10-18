// Pure context-fitting + citation-label repair for the research chat. Deliberately free
// of Electron/DB dependencies so it is unit-testable in isolation (scripts/test-local-chat-fit.mjs).
// The DB-backed "id → Autor, Año" label lookup is injected by the caller.

import { isGenericCitationLabel } from '../../shared/citationWords';

type SectionPayload = Record<string, unknown>;

export interface ContextBudgetFitReceipt {
  maxSize: number;
  truncated: boolean;
  measuredSizeBefore: number;
  measuredSizeAfter: number;
  sectionCountsBefore: Record<string, number>;
  sectionCountsAfter: Record<string, number>;
  passageIdsBefore: string[];
  passageIdsAfter: string[];
  removedPassageIds: string[];
  droppedSections: string[];
}

/** Preserve a representative for each planned search before spending the final
 * window on more results from the same search. This is a lexical coverage hint,
 * never a support verdict; only already authorized passages can be reordered.
 * Ties and the remaining tail retain the retrieval ranking. */
export function prioritizePassageQueryCoverage(passages: unknown[], queries: readonly string[]): unknown[] {
  const words = (text: string) => new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []);
  const facets = queries.slice(0, 4).map(query => [...words(query.slice(0, 600))].slice(0, 64));
  if (facets.length < 2 || passages.length < 2) return [...passages];
  const texts = passages.map(item => {
    if (!item || typeof item !== 'object') return new Set<string>();
    const row = item as Record<string, unknown>;
    return words([row.label, row.title, row.summary ?? row.text].filter(value => typeof value === 'string').join(' '));
  });
  const weights = new Map([...new Set(facets.flat())].map(word => [word,
    Math.log((passages.length + 1) / (1 + texts.filter(text => text.has(word)).length))
      / facets.filter(facet => facet.includes(word)).length]));
  const selected = new Set<number>();
  for (const facet of facets) {
    let best = -1, bestScore = 0;
    for (const [index, text] of texts.entries()) {
      const score = facet.reduce((sum, word) => sum + (text.has(word) ? weights.get(word)! : 0), 0);
      if (score > bestScore) { best = index; bestScore = score; }
    }
    if (best >= 0) selected.add(best);
  }
  // Keep the relative retrieval order of the protected representatives too.
  return [...passages.filter((_item, index) => selected.has(index)), ...passages.filter((_item, index) => !selected.has(index))];
}

// Least → most query-relevant. enforceContextBudget trims sections in this order, so the
// panoramic sections go first and the citable core (ideas / passages) survives longest.
export const CONTEXT_DROP_ORDER = [
  'grafo',
  'documentos_relacionados',
  'rutas_de_lectura',
  'autores',
  'documentos_resumidos',
  // Macro profiles route the search but are not citable evidence. They must
  // yield before ideas and literal passages in a small Nodi/local-model window.
  'orientacion_documental',
  'temas_principales',
  'huecos',
  'huecos_de_investigacion',
  'contradicciones',
  'obras',
  'ideas_generadas',
  'pasajes_web',
  'pasajes_relevantes',
];

/**
 * Guarantee the serialized context fits `maxChars`, degrading gracefully. Walk the
 * sections from least to most query-relevant and, for each, prune its elements one
 * relevance-ordered chunk at a time; only when a section is emptied do we drop it whole.
 * This keeps the MOST relevant section (ideas / passages) partially alive on a tiny local
 * window instead of vanishing, so the model still has something to ground on. A
 * custom `size` can measure the complete serialized request in UTF-8 bytes instead.
 */
export function enforceContextBudget(
  context: SectionPayload,
  maxChars: number,
  size = () => JSON.stringify(context).length,
  onReceipt?: (receipt: ContextBudgetFitReceipt) => void,
  options: { passageQueries?: readonly string[] } = {},
): { truncated: boolean } {
  const sectionCountsBefore = onReceipt ? contextSectionCounts(context) : undefined;
  const passageIdsBefore = onReceipt ? contextPassageIds(context) : undefined;
  const measuredSizeBefore = size();
  if (measuredSizeBefore <= maxChars) {
    if (onReceipt) onReceipt({
      maxSize: maxChars, truncated: false, measuredSizeBefore, measuredSizeAfter: measuredSizeBefore,
      sectionCountsBefore: sectionCountsBefore!, sectionCountsAfter: contextSectionCounts(context),
      passageIdsBefore: passageIdsBefore!, passageIdsAfter: contextPassageIds(context), removedPassageIds: [], droppedSections: [],
    });
    return { truncated: false };
  }

  // We WILL cut, so add the "context was trimmed" annotation up front and let it count
  // against the budget while we prune — otherwise appending it afterwards pushes the
  // payload back over `maxChars`. `secciones_omitidas` shares the live `dropped` array.
  const dropped: string[] = [];
  const annotation: Record<string, unknown> = {
    motivo: 'El contexto se ajusto a la ventana de contexto del modelo; se prioriza lo mas relevante a la consulta.',
    secciones_omitidas: dropped,
    podado: true,
  };
  context.contexto_recortado = annotation;

  let pruned = false;
  for (const key of CONTEXT_DROP_ORDER) {
    if (size() <= maxChars) break;
    if (context[key] == null) continue;
    if (key === 'pasajes_relevantes' && Array.isArray(context[key]) && options.passageQueries?.length) {
      context[key] = prioritizePassageQueryCoverage(context[key] as unknown[], options.passageQueries);
    }
    if (pruneSectionToFit(context, key, maxChars, size)) pruned = true;
    if (isSectionEmpty(context[key])) {
      delete context[key];
      dropped.push(key);
    }
  }

  // Tidy the annotation to what actually happened (only ever shrinks it → stays in budget).
  if (!pruned) delete annotation.podado;
  if (dropped.length === 0) delete annotation.secciones_omitidas;
  if (onReceipt) {
    const passageIdsAfter = contextPassageIds(context);
    const retained = new Set(passageIdsAfter);
    onReceipt({
      maxSize: maxChars, truncated: true, measuredSizeBefore, measuredSizeAfter: size(),
      sectionCountsBefore: sectionCountsBefore!, sectionCountsAfter: contextSectionCounts(context),
      passageIdsBefore: passageIdsBefore!, passageIdsAfter,
      removedPassageIds: passageIdsBefore!.filter(id => !retained.has(id)), droppedSections: [...dropped],
    });
  }
  return { truncated: true };
}

function contextSectionCounts(context: SectionPayload): Record<string, number> {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key,
    Array.isArray(value) ? value.length
      : value && typeof value === 'object'
        ? Object.values(value as Record<string, unknown>).filter(Array.isArray).reduce((sum, rows) => sum + (rows as unknown[]).length, 0)
        : 0]));
}

function contextPassageIds(context: SectionPayload): string[] {
  const passages = context.pasajes_relevantes;
  if (!Array.isArray(passages)) return [];
  return passages.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = row.id ?? row.passageId ?? row.nodus_id;
    return typeof id === 'string' ? [id] : [];
  });
}

/** The arrays a section holds — the section itself when it is an array, else its array
 *  children (e.g. `autores.authors`, `grafo.nodos_de_ideas`). */
function sectionArrays(value: unknown): unknown[][] {
  if (Array.isArray(value)) return [value];
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(Array.isArray) as unknown[][];
  return [];
}

function isSectionEmpty(value: unknown): boolean {
  const arrays = sectionArrays(value);
  return arrays.length > 0 && arrays.every((a) => a.length === 0);
}

/** Pop relevance-ordered elements off a section's fattest array, a proportional chunk at
 *  a time, until the whole payload fits `maxChars` or the section is exhausted. */
function pruneSectionToFit(context: SectionPayload, key: string, maxChars: number, size: () => number): boolean {
  const arrays = sectionArrays(context[key]);
  if (arrays.length === 0) return false;
  let pruned = false;
  let guard = 0;
  while (size() > maxChars && guard++ < 5000) {
    let target: unknown[] | null = null;
    let weight = -1;
    for (const arr of arrays) {
      if (arr.length === 0) continue;
      const w = JSON.stringify(arr).length;
      if (w > weight) {
        weight = w;
        target = arr;
      }
    }
    if (!target) break;
    const ratio = Math.min(0.5, (size() - maxChars) / Math.max(1, size()));
    const remove = Math.max(1, Math.ceil(target.length * ratio));
    target.splice(target.length - remove, remove);
    pruned = true;
  }
  return pruned;
}

// ── Citation-label repair (local models) ─────────────────────────────────────
// Cloud models follow the "[Autor, Año](nodus://…)" rule; weaker local models often drop
// the raw id into the visible text — `[g-0286](nodus://idea/g-0286)` (renders an ugly
// "g-0286" pill) — or write a bracketed id with no link at all — `[g-0286]`. The id is
// correct, only the presentation is wrong, so we deterministically repair both using a
// DB-backed lookup. Applies to local answers only.

/** Resolve a citation's human label ("Apellido, Año") from its kind + id, or null when
 *  the id does not resolve in the corpus (so hallucinated ids are left untouched). */
export type CitationLabelLookup = (kind: string, id: string) => string | null;

/** Add a page marker to bare numeric or Roman-numeral locators only. */
export function researchAuthorYearLabel(authors: readonly string[], year: number | null | undefined): string | null {
  const first = (authors[0] ?? '').trim();
  const surname = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/u).at(-1);
  return surname ? year != null ? `${surname}, ${year}` : surname : year != null ? String(year) : null;
}

export function passagePageCitationLabel(base: string, pageLabel: string | null | undefined): string {
  if (!pageLabel) return base;
  const locator = pageLabel.trim();
  if (!locator) return base;
  const pageValue = '(?:\\d+(?:[-–]\\d+)?|[ivxlcdm]+)';
  const explicitPage = new RegExp(`^(?:pp?\\.?|pages?)\\s*${pageValue}$`, 'i');
  if (explicitPage.test(locator) || new RegExp(`^${pageValue}$`, 'i').test(locator)) {
    return `${base}, ${/^(?:pp?\.?|pages?)\s*/i.test(locator) ? locator : `p. ${locator}`}`;
  }
  return `${base}, ${locator}`;
}

const CITATION_LINK_RE = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)\s]+)\)/g;
const BARE_IDEA_ID_RE = /\[(g-\d+)\](?!\()/g;
// A bracketed bare UUID with no link, e.g. `[2aea3baa-…]` — the model bracketed a work's
// nodus_id (or a passage id) it saw in the context. Resolve work first, then passage.
const BARE_UUID_ID_RE = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\](?!\()/gi;

export function humanizeCitationLabels(answer: string, lookup: CitationLabelLookup): string {
  BARE_IDEA_ID_RE.lastIndex = 0;
  BARE_UUID_ID_RE.lastIndex = 0;
  const hasBare = BARE_IDEA_ID_RE.test(answer) || BARE_UUID_ID_RE.test(answer);
  if (!answer.includes('nodus://') && !hasBare) return answer;
  // Pass 1: repair the visible label of real links whose label is just the raw id.
  let out = answer.replace(CITATION_LINK_RE, (full, label: string, kind: string, rawId: string) => {
    const id = safeDecode(rawId);
    if (!isBareCitationLabel(label, id)) return full;
    const human = lookup(kind, id);
    return human ? `[${human}](nodus://${kind}/${rawId})` : full;
  });
  // Pass 2: turn a bracketed bare idea id into a proper cited link (only when the id
  // actually resolves, so hallucinated ids stay as plain text).
  out = out.replace(BARE_IDEA_ID_RE, (full, id: string) => {
    const human = lookup('idea', id);
    return human ? `[${human}](nodus://idea/${id})` : full;
  });
  // Pass 3: bracketed bare UUID → work (or passage) link when it resolves.
  out = out.replace(BARE_UUID_ID_RE, (full, id: string) => {
    const work = lookup('work', id);
    if (work) return `[${work}](nodus://work/${id})`;
    const passage = lookup('passage', id);
    return passage ? `[${passage}](nodus://passage/${id})` : full;
  });
  return out;
}

/** A label counts as "bare" (needs repair) only when it clearly IS the id — never a real
 *  "Apellido, Año", so a legit label is never clobbered. */
function isBareCitationLabel(label: string, id: string): boolean {
  const l = label.trim();
  if (!l) return true;
  // A placeholder noun ("fuente", "source 2") copied from the citation contract
  // names nothing, and in any language but the template's it is a foreign word.
  if (isGenericCitationLabel(l)) return true;
  if (l === id) return true;
  if (l.toLowerCase() === id.toLowerCase()) return true;
  if (/^g-?\d+$/i.test(l)) return true; // idea id shape (g-0286)
  return false;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
