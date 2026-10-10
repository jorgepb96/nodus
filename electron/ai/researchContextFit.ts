// Pure context-fitting + citation-label repair for the research chat. Deliberately free
// of Electron/DB dependencies so it is unit-testable in isolation (scripts/test-local-chat-fit.mjs).
// The DB-backed "id → Autor, Año" label lookup is injected by the caller.

type SectionPayload = Record<string, unknown>;

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
export function enforceContextBudget(context: SectionPayload, maxChars: number, size = () => JSON.stringify(context).length): { truncated: boolean } {
  if (size() <= maxChars) return { truncated: false };

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
    if (pruneSectionToFit(context, key, maxChars, size)) pruned = true;
    if (isSectionEmpty(context[key])) {
      delete context[key];
      dropped.push(key);
    }
  }

  // Tidy the annotation to what actually happened (only ever shrinks it → stays in budget).
  if (!pruned) delete annotation.podado;
  if (dropped.length === 0) delete annotation.secciones_omitidas;
  return { truncated: true };
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
