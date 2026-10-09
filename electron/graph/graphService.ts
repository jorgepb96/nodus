import { isManualAcademic } from '../ai/academicMode';
import { manualIdeaVisible } from '../db/manualIdeaVisibility';
import { getDb } from '../db/database';
import { SubstringIndex } from '@shared/substringIndex';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  IdeaType,
  EdgeDetail,
  EdgeBasis,
  Evidence,
  Debate,
  DebateRelation,
  DebateSide,
  DebateSideKey,
  DebateStatus,
  DebateTimelineEntry,
  DebateWork,
  ReadingPathPlan,
  ReadingPathRequest,
  ReadingPathStrategy,
  ReadingPathEntry,
  WorkView,
} from '@shared/types';
import { getEdgeDetail, getEdgeTrace, getIdeaDetail, currentEmbeddingConfig } from '../db/ideasRepo';
import { getWorksByIds } from '../db/worksRepo';
import { listGraphThemes, normalizeThemeLabel } from '../db/themesRepo';
import { computeThemeMatches } from './computeHost';
import { centroidF32, type LabeledVector } from './similarityCore';
import { edgeFeedbackMap } from '../db/edgeFeedbackRepo';

// Threshold for attaching an idea to a theme by meaning (cosine to the theme's idea
// cluster centroid). Conservative so unrelated ideas aren't pulled in.
const THEME_SIM_THRESHOLD = 0.72;
const MAX_INFERRED_THEMES_PER_IDEA = 1;
// The similarity loops run in the compute worker (or a chunked, yielding
// fallback), so this cap only bounds memory for the embeddings we load — it no
// longer protects the event loop and can be far more generous than the old 850.
const MAX_SEMANTIC_THEME_EDGE_NODES = 2500;

// In-memory cache for the semantic theme edges. These are derived from idea
// embeddings and don't change between graph renders unless the corpus changes,
// so we cache them for a short TTL to avoid recomputing O(ideas×themes) cosine
// similarities on every getGraph call.
let semanticThemeEdgesCache: { edges: GraphEdge[]; nodeIdsKey: string; ts: number } | null = null;
const SEMANTIC_EDGES_TTL_MS = 60_000;

const THEME_KEYWORD_ALIASES: Record<string, string[]> = {
  franquismo: ['franquismo', 'franco', 'franquista', 'franquistas', 'dictadura', 'posguerra'],
  turismo: ['turismo', 'turista', 'turistas', 'turistico', 'turistica', 'tourism', 'tourist', 'tourists'],
  'literatura de viajes': ['literatura viajes', 'relato viaje', 'relatos viaje', 'escritura viajes', 'travel writing', 'travel literature'],
  'escritura de viajes': ['literatura viajes', 'relato viaje', 'relatos viaje', 'travel writing', 'travel literature'],
  género: ['genero', 'gender', 'mujeres', 'femenino', 'feminismo', 'viajeras'],
  'identidad nacional': ['identidad nacional', 'national identity', 'nacion', 'nacionalismo'],
  colonialismo: ['colonialismo', 'colonial', 'colonialism', 'imperialismo', 'imperial'],
};

const STOPWORDS = new Set([
  'a',
  'al',
  'and',
  'ante',
  'by',
  'con',
  'de',
  'del',
  'el',
  'en',
  'for',
  'in',
  'la',
  'las',
  'lo',
  'los',
  'of',
  'on',
  'or',
  'para',
  'por',
  'que',
  'se',
  'the',
  'to',
  'un',
  'una',
  'y',
]);

interface IdeaRow {
  global_id: string;
  type: IdeaType | null;
  label: string | null;
  statement: string | null;
  created_at: string;
}

interface ThemeMembership {
  edges: GraphEdge[];
  labelsByIdea: Map<string, Set<string>>;
}

interface VisibleIdeaEdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  basis: 'explicit' | 'inferred';
  confidence: number;
}

/** Build the ideas-lens graph: idea nodes + typed edges, enriched for filtering. */
export async function buildIdeaGraph(): Promise<GraphData> {
  const db = getDb();
  const ideas = isManualAcademic() ? db.prepare(`SELECT i.global_id, i.type, i.label, i.statement, i.created_at FROM ideas i WHERE i.orphaned_at IS NULL AND ${manualIdeaVisible('i.global_id')}`).all() as IdeaRow[] : db
    .prepare(
      `SELECT DISTINCT i.global_id, i.type, i.label, i.statement, i.created_at
       FROM ideas i
       JOIN idea_occurrences io ON io.global_id = i.global_id
       JOIN works w ON w.nodus_id = io.nodus_id
       WHERE w.archived = 0
         AND (w.deep_status = 'done' OR ${manualIdeaVisible('io.global_id')})`
    )
    .all() as IdeaRow[];
  const themeRows = listGraphThemes();
  const memberships = buildThemeMemberships();

  // ── Batched aggregation ─────────────────────────────────────────────────
  // Previously this ran 2 queries per idea + 1 per theme (N+1). Now we run a
  // single query for ideas and another for themes, then aggregate in memory.
  // This is the main reason the graph took ages to load on large corpora.
  const ideaIds = ideas.map((i) => i.global_id);
  // Both aggregates below restrict to the ideas selected above. Binding that set
  // as an `IN (?,?,…)` list of one placeholder per idea is what made the graph
  // take seconds: with ~9,700 placeholders SQLite drives the join from the id
  // list and probes (global_id, nodus_id) once per id × per matching work, so the
  // cost grows with ideas × works instead of with rows. Joining `ideas` instead
  // expresses the same restriction — the id list *is* that join — and lets the
  // planner drive from `works`. Measured on a 9,707-idea corpus: 6.9 s → 74 ms
  // and 8.9 s → 49 ms, row-for-row identical (scripts/bench-graph-in-clause.ts).
  const ideaWorkRows = ideaIds.length
    ? (db
        .prepare(
          `SELECT io.global_id, w.nodus_id, w.year, w.authors_json, w.read_tag
             FROM idea_occurrences io
             JOIN works w ON w.nodus_id = io.nodus_id
             JOIN ideas i ON i.global_id = io.global_id
            WHERE w.archived = 0
              AND (w.deep_status = 'done' OR ${manualIdeaVisible('io.global_id')})`
        )
        .all() as { global_id: string; nodus_id: string; year: number | null; authors_json: string; read_tag: number }[])
    : [];
  const ideaAggById = new Map<string, { works: Set<string>; unread: boolean; years: number[]; authors: Set<string> }>();
  // maxConfidence comes from idea_occurrences.confidence; fetch in a second tiny query.
  const ideaConfRows = ideaIds.length
    ? (db
        .prepare(
          `SELECT io.global_id, MAX(io.confidence) AS c
             FROM idea_occurrences io
             JOIN works w ON w.nodus_id = io.nodus_id
             JOIN ideas i ON i.global_id = io.global_id
            WHERE w.archived = 0
              AND w.deep_status = 'done'
            GROUP BY io.global_id`
        )
        .all() as { global_id: string; c: number | null }[])
    : [];
  const ideaConfById = new Map(ideaConfRows.map((r) => [r.global_id, r.c ?? 0]));
  for (const row of ideaWorkRows) {
    let agg = ideaAggById.get(row.global_id);
    if (!agg) {
      agg = { works: new Set(), unread: false, years: [], authors: new Set() };
      ideaAggById.set(row.global_id, agg);
    }
    agg.works.add(row.nodus_id);
    if (row.read_tag !== 1) agg.unread = true;
    if (row.year != null) agg.years.push(row.year);
    try {
      for (const a of JSON.parse(row.authors_json || '[]')) agg.authors.add(a);
    } catch {
      /* ignore */
    }
  }

  const ideaNodes: GraphNode[] = ideas.map((idea) => {
    const agg = ideaAggById.get(idea.global_id);
    return {
      id: idea.global_id,
      label: idea.label ?? idea.global_id,
      type: idea.type ?? 'claim',
      createdAt: idea.created_at,
      statement: idea.statement ?? '',
      workCount: agg?.works.size ?? 0,
      workIds: agg ? Array.from(agg.works) : [],
      read: agg ? agg.works.size > 0 && !agg.unread : false,
      themes: Array.from(memberships.labelsByIdea.get(idea.global_id) ?? []).sort(),
      years: agg?.years ?? [],
      authors: agg ? Array.from(agg.authors) : [],
      maxConfidence: ideaConfById.get(idea.global_id) ?? 0,
    };
  });

  const visibleThemeRows = themeRows;
  const themeIds = visibleThemeRows.map((t) => t.theme_id);
  const themeWorkRows = themeIds.length
    ? (db
        .prepare(
          `SELECT wt.theme_id, wt.nodus_id, w.year, w.authors_json, w.read_tag
             FROM work_themes wt
             JOIN works w ON w.nodus_id = wt.nodus_id
            WHERE wt.theme_id IN (${themeIds.map(() => '?').join(',')})
              AND w.archived = 0`
        )
        .all(...themeIds) as { theme_id: string; nodus_id: string; year: number | null; authors_json: string; read_tag: number }[])
    : [];
  const themeAggById = new Map<string, { works: Set<string>; unread: boolean; years: number[]; authors: Set<string> }>();
  for (const row of themeWorkRows) {
    let agg = themeAggById.get(row.theme_id);
    if (!agg) {
      agg = { works: new Set(), unread: false, years: [], authors: new Set() };
      themeAggById.set(row.theme_id, agg);
    }
    agg.works.add(row.nodus_id);
    if (row.read_tag !== 1) agg.unread = true;
    if (row.year != null) agg.years.push(row.year);
    try {
      for (const a of JSON.parse(row.authors_json || '[]')) agg.authors.add(a);
    } catch {
      /* ignore */
    }
  }

  const themeNodes: GraphNode[] = visibleThemeRows.map((theme) => {
    const agg = themeAggById.get(theme.theme_id);
    return {
      id: `theme:${theme.theme_id}`,
      label: theme.label.toUpperCase(),
      type: 'theme',
      createdAt: theme.created_at,
      statement: `Familia temática: ${theme.label}`,
      workCount: agg?.works.size ?? theme.work_count,
      workIds: agg ? Array.from(agg.works) : [],
      read: agg ? agg.works.size > 0 && !agg.unread : false,
      themes: [theme.label],
      years: agg?.years ?? [],
      authors: agg ? Array.from(agg.authors) : [],
      maxConfidence: 1,
    };
  });

  const nodes = [...themeNodes, ...ideaNodes];

  const edgeRows = listVisibleIdeaEdgeRows();
  const nodeIds = new Set(nodes.map((n) => n.id));
  // Rejected relations never arrive (the query reads visible_edges); confirmed
  // ones carry their verdict so the UI can render them as user-audited.
  const feedback = edgeFeedbackMap();
  const ideaEdges: GraphEdge[] = edgeRows
    .filter((e) => nodeIds.has(e.from_id) && nodeIds.has(e.to_id))
    .map((e) => {
      const verdict = feedback.get(`${e.from_id}|${e.to_id}|${e.type}`);
      return {
        id: e.id,
        source: e.from_id,
        target: e.to_id,
        type: e.type,
        basis: e.basis,
        confidence: e.confidence,
        ...(verdict === 'confirmed' ? { verdict } : {}),
      };
    });

  const themeEdges = memberships.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Attach ideas that predate their parent theme. Themes only "contain" an idea when
  // the same work carries both, so ideas analysed before a broad theme existed end up
  // orphaned. Here we link an idea to a theme when it's semantically close to that
  // theme's existing idea cluster (centroid of member embeddings), so the backlog of
  // ideas gets folded under the right parent without re-scanning.
  const inferredThemeEdges = isManualAcademic() ? [] : await buildSemanticThemeEdges(themeEdges, nodeIds);

  const edges = [...themeEdges, ...inferredThemeEdges, ...ideaEdges];

  return { nodes, edges };
}

function listVisibleIdeaEdgeRows(): VisibleIdeaEdgeRow[] {
  return getDb()
    .prepare(
      `SELECT e.id, e.from_id, e.to_id, e.type, e.basis, e.confidence
       FROM visible_edges e
       LEFT JOIN works w ON w.nodus_id = e.source_work
       WHERE e.source_work IS NULL
          OR (e.source_work='manual' AND ${manualIdeaVisible('e.from_id')} AND ${manualIdeaVisible('e.to_id')})
          OR (w.archived = 0 AND w.deep_status = 'done')`
    )
    .all() as VisibleIdeaEdgeRow[];
}

function buildThemeMemberships(): ThemeMembership {
  const db = getDb();
  const edges = new Map<string, GraphEdge>();
  const labelsByIdea = new Map<string, Set<string>>();

  const add = (
    themeId: string,
    themeLabel: string,
    ideaId: string,
    confidence: number,
    basis: 'explicit' | 'inferred',
    idPrefix: string
  ) => {
    const source = `theme:${themeId}`;
    const key = `${source}|${ideaId}`;
    const existing = edges.get(key);
    if (existing && (existing.basis === 'explicit' || existing.confidence >= confidence)) return;
    edges.set(key, {
      id: `${idPrefix}:${themeId}:${ideaId}`,
      source,
      target: ideaId,
      type: 'contains',
      basis,
      confidence,
    });
    const labels = labelsByIdea.get(ideaId) ?? new Set<string>();
    labels.add(themeLabel);
    labelsByIdea.set(ideaId, labels);
  };

  if (isManualAcademic()) {
    const rows = db.prepare(`SELECT it.theme_id,t.label,it.global_id FROM idea_theme_links it
      JOIN themes t ON t.theme_id=it.theme_id WHERE it.nodus_id='manual' AND ${manualIdeaVisible('it.global_id')}`).all() as { theme_id: string; label: string; global_id: string }[];
    for (const row of rows) add(row.theme_id, row.label, row.global_id, 1, 'explicit', 'theme-link');
    return { edges: Array.from(edges.values()), labelsByIdea };
  }

  const explicit = db
    .prepare(
      `SELECT it.theme_id, t.label, it.global_id, MAX(it.confidence) AS confidence
       FROM idea_theme_links it
       JOIN themes t ON t.theme_id = it.theme_id
       JOIN works w ON w.nodus_id = it.nodus_id
       WHERE w.archived = 0
         AND w.deep_status = 'done'
       GROUP BY it.theme_id, it.global_id`
    )
    .all() as { theme_id: string; label: string; global_id: string; confidence: number }[];
  for (const row of explicit) add(row.theme_id, row.label, row.global_id, row.confidence, 'explicit', 'theme-link');

  const fallback = db
    .prepare(
      `SELECT
         wt.nodus_id,
         t.theme_id,
         t.label AS theme_label,
         io.global_id,
         i.label AS idea_label,
         i.statement,
         io.development,
         (SELECT COUNT(*) FROM work_themes wt2 WHERE wt2.nodus_id = wt.nodus_id) AS theme_count
       FROM work_themes wt
       JOIN themes t ON t.theme_id = wt.theme_id
       JOIN works w ON w.nodus_id = wt.nodus_id
       JOIN idea_occurrences io ON io.nodus_id = wt.nodus_id
       JOIN ideas i ON i.global_id = io.global_id
       WHERE w.archived = 0
         AND w.deep_status = 'done'
         AND NOT EXISTS (
           SELECT 1 FROM idea_theme_links it
           WHERE it.nodus_id = io.nodus_id AND it.global_id = io.global_id
         )
       GROUP BY wt.nodus_id, t.theme_id, io.global_id`
    )
    .all() as {
      nodus_id: string;
      theme_id: string;
      theme_label: string;
      global_id: string;
      idea_label: string;
      statement: string;
      development: string;
      theme_count: number;
    }[];

  for (const row of fallback) {
    const text = `${row.idea_label}. ${row.statement}. ${row.development}`;
    const score = row.theme_count <= 1 ? 0.72 : themeRelevance(row.theme_label, text);
    if (score >= 0.62) add(row.theme_id, row.theme_label, row.global_id, Number(score.toFixed(3)), 'inferred', 'theme-edge');
  }

  return { edges: Array.from(edges.values()), labelsByIdea };
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // No `\s+` pass after this one: `[^a-z0-9ñ]+` is greedy and whitespace is
    // itself outside the class, so every run of it has already become exactly one
    // space. scripts/bench-normalize-text.ts checks that on the vault's own strings.
    .replace(/[^a-z0-9ñ]+/gi, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeText(text).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

function themeRelevance(themeLabel: string, ideaText: string): number {
  const theme = normalizeThemeLabel(themeLabel);
  const normalizedIdea = normalizeText(ideaText);
  const normalizedTheme = normalizeText(theme);
  if (!normalizedTheme) return 0;
  if (normalizedIdea.includes(normalizedTheme)) return 1;

  const themeTokens = Array.from(tokenize(theme));
  const ideaTokens = tokenize(ideaText);
  const direct = themeTokens.length
    ? themeTokens.filter((token) => ideaTokens.has(token)).length / themeTokens.length
    : 0;

  const aliases = THEME_KEYWORD_ALIASES[theme] ?? [];
  const aliasHit = aliases.some((alias) => normalizedIdea.includes(normalizeText(alias)));
  const aliasScore = aliasHit ? (themeTokens.length <= 1 ? 1 : 0.72) : 0;
  const thresholdedDirect = themeTokens.length <= 1 ? (direct >= 1 ? 1 : 0) : direct;

  return Math.max(thresholdedDirect, aliasScore);
}

function compactSignature(values: Iterable<string>): string {
  let h1 = 2166136261;
  let h2 = 2166136261;
  let count = 0;
  const sorted = Array.from(values).sort();
  for (const value of sorted) {
    count++;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 16777619);
      h2 ^= code + i + count;
      h2 = Math.imul(h2, 2246822519);
    }
  }
  return `${count}:${h1 >>> 0}:${h2 >>> 0}`;
}

/**
 * Derive extra theme→idea "contains" edges by meaning. For each theme we average the
 * embeddings of the ideas it already contains, then link any other embedded idea whose
 * cosine to that centroid clears the threshold (capped per idea). Pairs that already
 * have an explicit same-work edge are skipped. No-op when ideas lack embeddings.
 *
 * Optimized: loads every embedding for the visible idea nodes in ONE query,
 * then ships the O(themes × ideas) similarity loops to the compute worker (or a
 * chunked, event-loop-yielding fallback). The previous version ran a synchronous
 * vec_cosine() table scan per theme on the main thread, which is exactly the
 * class of loop that used to freeze the app on large corpora.
 */
async function buildSemanticThemeEdges(themeEdges: GraphEdge[], nodeIds: Set<string>): Promise<GraphEdge[]> {
  if (nodeIds.size > MAX_SEMANTIC_THEME_EDGE_NODES) {
    return [];
  }

  // Cache key: a compact signature of the existing theme→idea memberships plus
  // the set of visible node ids. If neither changed since the last call (within
  // TTL), reuse the previously computed edges.
  const nodeIdsKey = compactSignature(nodeIds);
  const membershipKey = compactSignature(themeEdges.map((e) => `${e.source}|${e.target}`));
  const cacheKey = `${membershipKey}::${nodeIdsKey}`;
  const now = Date.now();
  if (semanticThemeEdgesCache && semanticThemeEdgesCache.nodeIdsKey === cacheKey && now - semanticThemeEdgesCache.ts < SEMANTIC_EDGES_TTL_MS) {
    return semanticThemeEdgesCache.edges;
  }

  // Build theme→member mapping from explicit edges.
  const connected = new Set<string>();
  const membersByTheme = new Map<string, string[]>();
  for (const e of themeEdges) {
    connected.add(`${e.source}|${e.target}`);
    const list = membersByTheme.get(e.source) ?? [];
    list.push(e.target);
    membersByTheme.set(e.source, list);
  }

  if (membersByTheme.size === 0) {
    semanticThemeEdgesCache = { edges: [], nodeIdsKey: cacheKey, ts: now };
    return [];
  }

  // One batched query: embeddings for every visible idea node. Members feed the
  // centroids; the full set is the candidate pool the worker scores against.
  const candidateIdeaIds = [...nodeIds].filter((id) => !id.startsWith('theme:'));
  const embeddingsById = new Map<string, Float32Array>();
  if (candidateIdeaIds.length > 0) {
    const db = getDb();
    const config = currentEmbeddingConfig();
    const placeholders = candidateIdeaIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT global_id, embedding
           FROM ideas
          WHERE global_id IN (${placeholders})
            AND embedding IS NOT NULL
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_dim IS NOT NULL`
      )
      .all(...candidateIdeaIds, config.provider, config.model) as { global_id: string; embedding: Buffer }[];
    for (const row of rows) {
      const f32 = new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength));
      embeddingsById.set(row.global_id, f32);
    }
  }

  const centroids: LabeledVector[] = [];
  let maxMembers = 0;
  for (const [themeId, members] of membersByTheme) {
    if (!nodeIds.has(themeId)) continue;
    const vectors = members.map((m) => embeddingsById.get(m)).filter((v): v is Float32Array => !!v);
    const c = centroidF32(vectors);
    if (c) {
      centroids.push({ id: themeId, vector: c });
      maxMembers = Math.max(maxMembers, members.length);
    }
  }
  if (centroids.length === 0) {
    semanticThemeEdgesCache = { edges: [], nodeIdsKey: cacheKey, ts: now };
    return [];
  }

  const candidates: LabeledVector[] = [...embeddingsById].map(([id, vector]) => ({ id, vector }));
  // Ask for enough matches per centroid that already-connected members (which
  // rank highest by construction) can be filtered out afterwards without ever
  // starving the top-K of fresh ideas.
  const perCentroid = maxMembers + MAX_INFERRED_THEMES_PER_IDEA;
  const matches = await computeThemeMatches(centroids, candidates, THEME_SIM_THRESHOLD, perCentroid);

  const out: GraphEdge[] = [];
  const keptPerTheme = new Map<string, number>();
  for (const m of matches) {
    const themeId = m.centroidId;
    if (connected.has(`${themeId}|${m.candidateId}`)) continue;
    if ((keptPerTheme.get(themeId) ?? 0) >= MAX_INFERRED_THEMES_PER_IDEA) continue;
    if (out.some((e) => e.source === themeId && e.target === m.candidateId)) continue;
    keptPerTheme.set(themeId, (keptPerTheme.get(themeId) ?? 0) + 1);
    out.push({
      id: `theme-sim:${themeId}:${m.candidateId}`,
      source: themeId,
      target: m.candidateId,
      type: 'contains',
      basis: 'inferred',
      confidence: Number(m.similarity.toFixed(3)),
    });
  }
  semanticThemeEdgesCache = { edges: out, nodeIdsKey: cacheKey, ts: now };
  return out;
}

/** Build the authors-lens graph from the derived author_relations table. */
export function buildAuthorGraph(): GraphData {
  const db = getDb();
  const authors = db.prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[];

  // Batch-load all author→work mappings in one query instead of N+1.
  const waRows = db
    .prepare(
      `SELECT wa.author_id, w.nodus_id, w.year, w.read_tag FROM work_attributions wa JOIN works w ON w.nodus_id = wa.nodus_id
        WHERE w.archived = 0`
    )
    .all() as { author_id: string; nodus_id: string; year: number | null; read_tag: number }[];
  const worksByAuthor = new Map<string, { nodus_id: string; year: number | null; read_tag: number }[]>();
  for (const row of waRows) {
    const list = worksByAuthor.get(row.author_id) ?? [];
    list.push(row);
    worksByAuthor.set(row.author_id, list);
  }

  const nodes: GraphNode[] = authors.map((a) => {
    const works = worksByAuthor.get(a.author_id) ?? [];
    const years = works.map((w) => w.year).filter((y): y is number => y != null);
    const read = works.length > 0 && works.every((w) => w.read_tag === 1);
    return {
      id: a.author_id,
      label: a.name,
      type: 'author',
      createdAt: null,
      workCount: works.length,
      workIds: works.map((w) => w.nodus_id),
      read,
      themes: [],
      years,
      authors: [a.name],
      maxConfidence: 1,
    };
  });

  const relRows = db.prepare('SELECT * FROM author_relations WHERE from_author <> to_author').all() as {
    from_author: string;
    to_author: string;
    type: string;
    weight: number;
  }[];
  const edges: GraphEdge[] = relRows.map((r, i) => ({
    id: `ar-${i}`,
    source: r.from_author,
    target: r.to_author,
    type: r.type,
    basis: 'inferred',
    confidence: Math.min(1, r.weight),
  }));

  return { nodes, edges };
}

/** Unresolved contradictions across the corpus (contradicts/refutes edges). */
export function getContradictions(): EdgeDetail[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM visible_edges WHERE type IN ('contradicts','refutes')")
    .all() as { id: string }[];
  // getEdgeDetail makes 4 queries per edge; batch the edge rows and idea lookups
  // to reduce round-trips when there are many contradictions.
  return rows.map((r) => getEdgeDetail(r.id)).filter((x): x is EdgeDetail => x !== null);
}

// ─── Debates (contradiction face-offs) ───────────────────────────────────────

interface DebateEdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  type: DebateRelation;
  basis: EdgeBasis;
  confidence: number;
  source_work: string | null;
}

const DEBATE_TENSION_CLIP = 180;

function debateTensionText(relation: DebateRelation, a: DebateSide, b: DebateSide): string {
  const noun = relation === 'refutes' ? 'refutación' : 'contradicción';
  const left = clip(a.statement || a.label, DEBATE_TENSION_CLIP);
  const right = clip(b.statement || b.label, DEBATE_TENSION_CLIP);
  return `La ${noun} detectada es que «${left}» entra en tensión con «${right}».`;
}

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

/** Build one side of a debate (idea + backing works/authors/evidence) from the DB. */
/**
 * Evidence quotes kept per work in list responses.
 *
 * The debates list renders `works.slice(0, 2)` and `evidence.slice(0, 1)` per
 * side, and never renders `development` at all, while MCP's list search only
 * matches on tension, themes, labels, statements, authors and work titles. So
 * every quote past the first, and all of the development prose, was assembled
 * and shipped for nothing — tens of megabytes in one IPC message on a large
 * corpus. `getDebate()` still returns everything.
 */
const DEBATE_LIST_EVIDENCE_PER_WORK = 1;

/**
 * Sides already built during this one `getDebates()` call.
 *
 * An idea can sit on either end of several contradiction edges, and each debate
 * rebuilt its sides from scratch: measured on a real corpus, 1,147 debate edges
 * asked for 2,294 sides drawn from only 1,310 distinct ideas, and every one of
 * those asks costs ~6 queries through getIdeaDetail. The map is per call and
 * never outlives it — nothing writes to the database while debates assemble, so
 * within one call the answer for an idea cannot change.
 */
type DebateSideCache = Map<string, DebateSide | null>;

function buildDebateSide(ideaId: string, opts: { lean?: boolean; cache?: DebateSideCache; works?: Map<string, WorkView> } = {}): DebateSide | null {
  const cached = opts.cache?.get(ideaId);
  if (cached !== undefined) return cached;
  const side = assembleDebateSide(ideaId, opts);
  opts.cache?.set(ideaId, side);
  return side;
}

function assembleDebateSide(ideaId: string, opts: { lean?: boolean; works?: Map<string, WorkView> }): DebateSide | null {
  const detail = getIdeaDetail(ideaId, opts.works);
  if (!detail) return null;
  const evidenceByWork = new Map<string, Evidence[]>();
  for (const ev of detail.evidence) {
    if (!evidenceByWork.has(ev.nodus_id)) evidenceByWork.set(ev.nodus_id, []);
    const bucket = evidenceByWork.get(ev.nodus_id)!;
    if (opts.lean && bucket.length >= DEBATE_LIST_EVIDENCE_PER_WORK) continue;
    bucket.push(ev);
  }
  const works: DebateWork[] = detail.occurrences.map((o) => ({
    nodus_id: o.nodus_id,
    title: o.work.title,
    zotero_key: o.work.zotero_key,
    authors: o.work.authors,
    year: o.work.year,
    role: o.role,
    development: opts.lean ? '' : o.development,
    evidence: evidenceByWork.get(o.nodus_id) ?? [],
  }));
  const authors = Array.from(new Set(works.flatMap((w) => w.authors).filter(Boolean)));
  const years = works.map((w) => w.year).filter((y): y is number => typeof y === 'number');
  return {
    ideaId: detail.idea.global_id,
    type: detail.idea.type,
    label: detail.idea.label,
    statement: detail.idea.statement,
    authors,
    works,
    earliestYear: years.length ? Math.min(...years) : null,
    latestYear: years.length ? Math.max(...years) : null,
  };
}

function debateTimeline(sideA: DebateSide, sideB: DebateSide): DebateTimelineEntry[] {
  const entries: DebateTimelineEntry[] = [];
  const push = (side: DebateSideKey, works: DebateWork[]) => {
    for (const w of works) {
      entries.push({ year: w.year, side, nodus_id: w.nodus_id, title: w.title, authors: w.authors });
    }
  };
  push('A', sideA.works);
  push('B', sideB.works);
  // Year-ascending; undated works sink to the end so the dated chronology reads first.
  return entries.sort((x, y) => {
    if (x.year == null && y.year == null) return 0;
    if (x.year == null) return 1;
    if (y.year == null) return -1;
    return x.year - y.year;
  });
}

/** Assemble the full Debate object for a contradicts/refutes edge row. */
function assembleDebate(
  row: DebateEdgeRow,
  clusterId: string,
  clusterSize: number,
  supportCount: Map<string, number>,
  themesByIdea: Map<string, Set<string>>,
  opts: { lean?: boolean; cache?: DebateSideCache; works?: Map<string, WorkView> } = {}
): Debate | null {
  const sideA = buildDebateSide(row.from_id, opts);
  const sideB = buildDebateSide(row.to_id, opts);
  if (!sideA || !sideB) return null;

  const themesA = themesByIdea.get(row.from_id) ?? new Set<string>();
  const themesB = themesByIdea.get(row.to_id) ?? new Set<string>();
  const sharedThemes = Array.from(themesA).filter((label) => themesB.has(label));

  const supportA = supportCount.get(row.from_id) ?? 0;
  const supportB = supportCount.get(row.to_id) ?? 0;
  let status: DebateStatus = 'open';
  let leaningSide: DebateSideKey | null = null;
  if (supportA !== supportB) {
    status = 'leaning';
    leaningSide = supportA > supportB ? 'A' : 'B';
  }

  const worksA = new Set(sideA.works.map((w) => w.nodus_id));
  const internal = sideB.works.some((w) => worksA.has(w.nodus_id));

  return {
    id: row.id,
    relation: row.type,
    basis: row.basis,
    confidence: row.confidence,
    clusterId,
    clusterSize,
    status,
    leaningSide,
    sharedThemes,
    internal,
    sideA,
    sideB,
    timeline: debateTimeline(sideA, sideB),
    tension: debateTensionText(row.type, sideA, sideB),
    tensionKey: row.type === 'refutes' ? 'debate.refutes' : 'debate.contradicts',
    tensionParams: {
      left: clip(sideA.statement || sideA.label, DEBATE_TENSION_CLIP),
      right: clip(sideB.statement || sideB.label, DEBATE_TENSION_CLIP),
    },
    trace: getEdgeTrace(row.id),
  };
}

/** Group contradiction edges into multi-sided debates via union-find over idea ids. */
function clusterDebateEdges(rows: DebateEdgeRow[]): { clusterId: Map<string, string>; clusterSize: Map<string, number> } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const r of rows) union(r.from_id, r.to_id);

  const clusterId = new Map<string, string>(); // edge id -> cluster root
  const clusterSize = new Map<string, number>(); // cluster root -> edge count
  for (const r of rows) {
    const root = find(r.from_id);
    clusterId.set(r.id, root);
    clusterSize.set(root, (clusterSize.get(root) ?? 0) + 1);
  }
  return { clusterId, clusterSize };
}

function loadSupportCounts(db: ReturnType<typeof getDb>): Map<string, number> {
  const rows = db
    .prepare("SELECT to_id, COUNT(*) AS n FROM visible_edges WHERE type = 'supports' GROUP BY to_id")
    .all() as { to_id: string; n: number }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.to_id, r.n);
  return map;
}

function loadThemesByIdea(db: ReturnType<typeof getDb>): Map<string, Set<string>> {
  const rows = db
    .prepare('SELECT l.global_id AS gid, t.label AS label FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id')
    .all() as { gid: string; label: string }[];
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.gid)) map.set(r.gid, new Set());
    map.get(r.gid)!.add(r.label);
  }
  return map;
}

/**
 * All contradicts/refutes edges as two-sided debates: each side carries the works,
 * authors and verbatim evidence backing it, plus a year-sorted chronology. Edges are
 * grouped into clusters (connected components over shared ideas) so multi-sided
 * debates surface together. Pure DB reads — no AI, no new persistence.
 */
/** Every idea on either side of a contradiction, as a subquery rather than a bound id list. */
const DEBATE_IDEA_IDS = `SELECT from_id FROM visible_edges WHERE type IN ('contradicts','refutes')
                          UNION SELECT to_id FROM visible_edges WHERE type IN ('contradicts','refutes')`;

/**
 * Every work cited by any debate, in one batch, so getIdeaDetail does not re-run
 * its four work queries once per idea.
 */
function loadDebateWorks(db: ReturnType<typeof getDb>): Map<string, WorkView> {
  const rows = db
    .prepare(`SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id IN (${DEBATE_IDEA_IDS})`)
    .all() as { nodus_id: string }[];
  return getWorksByIds(rows.map((r) => r.nodus_id));
}

export function getDebates(): Debate[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, from_id, to_id, type, basis, confidence, source_work FROM visible_edges WHERE type IN ('contradicts','refutes')")
    .all() as DebateEdgeRow[];
  if (rows.length === 0) return [];

  const { clusterId, clusterSize } = clusterDebateEdges(rows);
  const supportCount = loadSupportCounts(db);
  const themesByIdea = loadThemesByIdea(db);
  const cache: DebateSideCache = new Map();
  const works = loadDebateWorks(db);

  const debates = rows
    .map((row) => {
      const root = clusterId.get(row.id)!;
      return assembleDebate(row, root, clusterSize.get(root) ?? 1, supportCount, themesByIdea, { lean: true, cache, works });
    })
    .filter((d): d is Debate => d !== null);

  // Multi-sided debates first, then by confidence — the richest disputes lead.
  return debates.sort((a, b) => b.clusterSize - a.clusterSize || b.confidence - a.confidence);
}

/** A single debate by its edge id (used by the optional AI synthesis). */
export function getDebate(edgeId: string): Debate | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, from_id, to_id, type, basis, confidence, source_work FROM visible_edges WHERE id = ? AND type IN ('contradicts','refutes')")
    .get(edgeId) as DebateEdgeRow | undefined;
  if (!row) return null;
  return assembleDebate(row, row.from_id, 1, loadSupportCounts(db), loadThemesByIdea(db));
}

/** How many related gaps a reading-path entry shows. */
const RELATED_GAPS_SHOWN = 3;

const DEFAULT_READING_LIMIT = 72;
const MIN_READING_LIMIT = 18;
const MAX_READING_LIMIT = 180;

interface ReadingWorkRow {
  nodus_id: string;
  zotero_key: string;
  title: string;
  authors_json: string;
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: number;
  light_status: string;
  deep_status: string;
  summary_status: string;
  orientation_summary: string | null;
  theme_count: number;
  theme_labels: string | null;
  idea_count: number;
  idea_ids: string | null;
  idea_labels: string | null;
  relation_count: number;
  contradiction_count: number;
  gap_count: number;
  gap_statements: string | null;
  external_ref_count: number;
  author_relation_count: number;
  author_weight: number;
  dependency_count: number;
}

interface GapSignals {
  ideaIds: Set<string>;
  themeLabels: Set<string>;
  statementsByTheme: Map<string, string[]>;
}

const STRATEGY_LABELS: Record<ReadingPathStrategy, string> = {
  research_relevance: 'relevancia para la investigación',
  gaps: 'cobertura de huecos detectados',
  foundational: 'textos fundamentales',
  recent: 'actualidad',
  connected_authors: 'autores conectados',
  bridges: 'documentos puente entre líneas temáticas',
};

/**
 * Reading path: a compact, phase-based research plan. It separates "read" from
 * "analysed" state and ranks documents by strategy-specific signals instead of
 * returning the whole library as one flat list.
 */
export function buildReadingPath(request: ReadingPathRequest = {}): ReadingPathPlan {
  const db = getDb();
  const strategy = request.strategy ?? 'research_relevance';
  const limit = clampInt(request.limit ?? DEFAULT_READING_LIMIT, MIN_READING_LIMIT, MAX_READING_LIMIT);
  const includeRead = request.includeRead ?? true;
  const researchBrief = (request.researchBrief ?? '').trim().slice(0, 4000);
  const rows = readPathRows(db);
  const years = rows.map((r) => r.year).filter((y): y is number => y != null);
  const minYear = years.length ? Math.min(...years) : new Date().getFullYear();
  const maxYear = years.length ? Math.max(...years) : new Date().getFullYear();
  const maxAuthorWeight = Math.max(1, ...rows.map((r) => r.author_weight + r.author_relation_count));
  const maxDependency = Math.max(1, ...rows.map((r) => r.dependency_count));
  const gapSignals = collectGapSignals();
  const coreThemes = collectCoreThemes(rows, gapSignals, researchBrief);
  // Counted for every work in a single pass over the references, before the
  // scoring loop, rather than rescanning them once per work.
  const citationCounts = approximateCitationCounts(rows, collectCitedWorks());

  const entries = rows.map((row, index) =>
    toReadingEntry(row, {
      strategy,
      researchBrief,
      minYear,
      maxYear,
      maxAuthorWeight,
      maxDependency,
      gapSignals,
      coreThemes,
      citedBy: citationCounts[index] ?? 0,
    })
  );

  const candidates = includeRead ? entries : entries.filter((e) => !e.read);
  const phases = buildReadingPhases(candidates, limit);
  const shownWorks = phases.reduce((sum, phase) => sum + phase.entries.length, 0);
  const readCount = entries.filter((e) => e.read).length;
  const analyzedCount = entries.filter((e) => isAnalysed(e)).length;
  const pendingAnalysisCount = entries.length - analyzedCount;

  return {
    strategy,
    researchBrief,
    generatedAt: new Date().toISOString(),
    totalWorks: entries.length,
    shownWorks,
    readCount,
    unreadCount: entries.length - readCount,
    analyzedCount,
    pendingAnalysisCount,
    summary: `Ruta optimizada por ${STRATEGY_LABELS[strategy]}: ${shownWorks} lecturas priorizadas de ${entries.length} obras, agrupadas en fases manejables.`,
    phases,
  };
}

function readPathRows(db: ReturnType<typeof getDb>): ReadingWorkRow[] {
  return db
    .prepare(
      `
      WITH theme_stats AS (
        SELECT wt.nodus_id, COUNT(DISTINCT wt.theme_id) AS theme_count, json_group_array(DISTINCT t.label) AS theme_labels
        FROM work_themes wt
        JOIN themes t ON t.theme_id = wt.theme_id
        GROUP BY wt.nodus_id
      ),
      idea_stats AS (
        SELECT io.nodus_id, COUNT(DISTINCT io.global_id) AS idea_count,
               json_group_array(DISTINCT io.global_id) AS idea_ids,
               json_group_array(DISTINCT i.label) AS idea_labels
        FROM idea_occurrences io
        JOIN ideas i ON i.global_id = io.global_id
        GROUP BY io.nodus_id
      ),
      edge_stats AS (
        SELECT source_work AS nodus_id,
               COUNT(*) AS relation_count,
               SUM(CASE WHEN type IN ('contradicts','refutes') THEN 1 ELSE 0 END) AS contradiction_count
        FROM visible_edges
        WHERE source_work IS NOT NULL
        GROUP BY source_work
      ),
      gap_stats AS (
        SELECT nodus_id, COUNT(*) AS gap_count, GROUP_CONCAT(statement, char(31)) AS gap_statements
        FROM gaps
        GROUP BY nodus_id
      ),
      external_stats AS (
        SELECT nodus_id, COUNT(*) AS external_ref_count
        FROM external_refs
        GROUP BY nodus_id
      ),
      author_stats AS (
        SELECT wa.nodus_id,
               COUNT(ar.type) AS author_relation_count,
               COALESCE(SUM(ar.weight), 0) AS author_weight
        FROM work_attributions wa
        LEFT JOIN (
          SELECT from_author AS author_id, type, weight FROM author_relations
          UNION ALL
          SELECT to_author AS author_id, type, weight FROM author_relations
        ) ar ON ar.author_id = wa.author_id
        GROUP BY wa.nodus_id
      ),
      dependency_stats AS (
        SELECT io.nodus_id, COUNT(DISTINCT e.id) AS dependency_count
        FROM idea_occurrences io
        JOIN visible_edges e ON e.to_id = io.global_id
        WHERE e.type IN ('extends','supports','precondition_of')
        GROUP BY io.nodus_id
      )
      SELECT
        w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.item_type, w.doi,
        w.read_tag, w.light_status, w.deep_status, w.summary_status,
        CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
        COALESCE(ts.theme_count, 0) AS theme_count,
        ts.theme_labels,
        COALESCE(ist.idea_count, 0) AS idea_count,
        ist.idea_ids,
        ist.idea_labels,
        COALESCE(es.relation_count, 0) AS relation_count,
        COALESCE(es.contradiction_count, 0) AS contradiction_count,
        COALESCE(gs.gap_count, 0) AS gap_count,
        gs.gap_statements,
        COALESCE(exs.external_ref_count, 0) AS external_ref_count,
        COALESCE(ast.author_relation_count, 0) AS author_relation_count,
        COALESCE(ast.author_weight, 0) AS author_weight,
        COALESCE(ds.dependency_count, 0) AS dependency_count
      FROM works w
      LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
      LEFT JOIN theme_stats ts ON ts.nodus_id = w.nodus_id
      LEFT JOIN idea_stats ist ON ist.nodus_id = w.nodus_id
      LEFT JOIN edge_stats es ON es.nodus_id = w.nodus_id
      LEFT JOIN gap_stats gs ON gs.nodus_id = w.nodus_id
      LEFT JOIN external_stats exs ON exs.nodus_id = w.nodus_id
      LEFT JOIN author_stats ast ON ast.nodus_id = w.nodus_id
      LEFT JOIN dependency_stats ds ON ds.nodus_id = w.nodus_id
      WHERE w.archived = 0
      `
    )
    .all() as ReadingWorkRow[];
}

function toReadingEntry(
  row: ReadingWorkRow,
  opts: {
    strategy: ReadingPathStrategy;
    researchBrief: string;
    minYear: number;
    maxYear: number;
    maxAuthorWeight: number;
    maxDependency: number;
    gapSignals: GapSignals;
    coreThemes: Set<string>;
    citedBy: number;
  }
): ReadingPathEntry {
  const authors = parseAuthors(row.authors_json);
  const themes = splitConcat(row.theme_labels);
  const ideaIds = splitConcat(row.idea_ids);
  const ideaLabels = splitConcat(row.idea_labels);
  const gapStatements = splitGapStatements(row.gap_statements);
  const read = row.read_tag === 1;
  const analysis = {
    lightStatus: row.light_status as any,
    deepStatus: row.deep_status as any,
    summaryStatus: row.summary_status as any,
    hasThemes: row.theme_count > 0,
    hasIdeas: row.idea_count > 0,
    hasContradictions: row.contradiction_count > 0,
    hasGaps: row.gap_count > 0,
    hasExternalRefs: row.external_ref_count > 0,
    themeCount: row.theme_count,
    ideaCount: row.idea_count,
    relationCount: row.relation_count,
    contradictionCount: row.contradiction_count,
    gapCount: row.gap_count,
    externalRefCount: row.external_ref_count,
  };
  const diversityKey = themes[0] ?? null;
  const gapThemes = themes.filter((theme) => opts.gapSignals.themeLabels.has(normalizeThemeLabel(theme)));
  // Only three of these are ever shown. Building the whole deduplicated list
  // first meant normalising every gap statement of every theme this work touches
  // — measured at 114 ms of the reading path's 212 ms on a corpus with 11,119
  // gaps — and then throwing all but three away. Yielding the candidates lazily
  // lets unique() stop at the third.
  const relatedGaps = unique(
    (function* gapCandidates() {
      yield* gapStatements;
      for (const theme of gapThemes) yield* opts.gapSignals.statementsByTheme.get(normalizeThemeLabel(theme)) ?? [];
    })(),
    RELATED_GAPS_SHOWN
  );
  const gapIdeaHit = ideaIds.some((id) => opts.gapSignals.ideaIds.has(id));
  const gapScore = clamp01(
    (row.gap_count > 0 ? 0.36 : 0) +
      (gapIdeaHit ? 0.28 : 0) +
      Math.min(0.24, gapThemes.length * 0.08) +
      Math.min(0.12, row.contradiction_count * 0.04)
  );
  const coreThemeScore = themes.length
    ? themes.filter((theme) => opts.coreThemes.has(normalizeThemeLabel(theme))).length / Math.max(1, Math.min(3, themes.length))
    : 0;
  const citedBy = opts.citedBy;
  const olderScore = row.year == null || opts.maxYear === opts.minYear ? 0.35 : 1 - (row.year - opts.minYear) / (opts.maxYear - opts.minYear);
  const foundationalScore = clamp01(
    Math.min(0.34, row.idea_count * 0.035) +
      Math.min(0.22, citedBy * 0.055) +
      Math.min(0.22, (row.dependency_count / opts.maxDependency) * 0.22) +
      olderScore * 0.22
  );
  const recencyScore = row.year == null || opts.maxYear === opts.minYear ? 0.2 : clamp01((row.year - opts.minYear) / (opts.maxYear - opts.minYear));
  const authorConnectivityScore = clamp01((row.author_weight + row.author_relation_count) / opts.maxAuthorWeight);
  const bridgeScore = clamp01(
    Math.min(0.36, row.theme_count * 0.09) +
      Math.min(0.28, row.relation_count * 0.035) +
      authorConnectivityScore * 0.2 +
      Math.min(0.16, row.external_ref_count * 0.04)
  );
  const interestScore = opts.researchBrief
    ? textRelevance(opts.researchBrief, [row.title, authors.join(' '), themes.join(' '), ideaLabels.join(' '), gapStatements.join(' '), row.orientation_summary ?? ''].join(' '))
    : coreThemeScore;
  const unreadBoost = read ? 0 : 0.08;
  const pendingAnalysisBoost = isPendingAnalysis(analysis) ? 0.08 : 0;
  const strategyScore = scoreForStrategy(opts.strategy, {
    interestScore,
    gapScore,
    foundationalScore,
    recencyScore,
    authorConnectivityScore,
    bridgeScore,
    coreThemeScore,
    unreadBoost,
    pendingAnalysisBoost,
  });
  const score = Number((strategyScore * 100).toFixed(1));

  return {
    nodus_id: row.nodus_id,
    title: row.title,
    authors,
    year: row.year,
    themes,
    orientationSummary: row.orientation_summary,
    readTag: read,
    read,
    analysis,
    score,
    priority: Math.round(score),
    phase: '',
    strategyScore,
    gapScore,
    foundationalScore,
    recencyScore,
    authorConnectivityScore,
    bridgeScore,
    interestScore,
    diversityKey,
    relatedGaps,
    relatedIdeas: ideaLabels.slice(0, 4),
    connectedAuthors: authors.slice(0, 4),
    citedBy,
    reason: readingReason({
      read,
      analysis,
      gapScore,
      foundationalScore,
      recencyScore,
      authorConnectivityScore,
      bridgeScore,
      interestScore,
      relatedGaps,
      citedBy,
    }),
  };
}

function buildReadingPhases(entries: ReadingPathEntry[], limit: number) {
  const used = new Set<string>();
  const phaseCap = Math.max(6, Math.ceil(limit / 6));
  let remaining = limit;
  const defs = [
    {
      id: 'foundational',
      title: 'Lecturas fundamentales',
      objective: 'Base conceptual y dependencias intelectuales que conviene leer antes de avanzar.',
      filter: (e: ReadingPathEntry) => !isReadUnmapped(e) && e.foundationalScore >= 0.32,
      score: (e: ReadingPathEntry) => e.foundationalScore * 0.7 + e.strategyScore * 0.3,
    },
    {
      id: 'gaps',
      title: 'Huecos de investigación',
      objective: 'Textos más útiles para cubrir o delimitar huecos detectados en el corpus.',
      filter: (e: ReadingPathEntry) => !isReadUnmapped(e) && e.gapScore >= 0.16,
      score: (e: ReadingPathEntry) => e.gapScore * 0.7 + e.strategyScore * 0.3,
    },
    {
      id: 'secondary_themes',
      title: 'Ampliación de temas secundarios',
      objective: 'Lecturas que amplían temas del proyecto sin saturar una sola línea temática.',
      filter: (e: ReadingPathEntry) => !isReadUnmapped(e) && e.themes.length > 0 && e.gapScore < 0.5,
      score: (e: ReadingPathEntry) => e.interestScore * 0.4 + e.bridgeScore * 0.3 + e.strategyScore * 0.3,
    },
    {
      id: 'contrasts',
      title: 'Contrastar ideas o contradicciones',
      objective: 'Documentos conectados con relaciones, refutaciones o contradicciones ya analizadas.',
      filter: (e: ReadingPathEntry) => !isReadUnmapped(e) && (e.analysis.hasContradictions || e.analysis.relationCount > 0),
      score: (e: ReadingPathEntry) => Math.min(1, e.analysis.contradictionCount * 0.18 + e.analysis.relationCount * 0.04) + e.strategyScore * 0.25,
    },
    {
      id: 'pending_analysis',
      title: 'Lecturas pendientes de análisis',
      objective: 'Ítems no leídos o poco procesados que conviene analizar para decidir si entran al mapa.',
      filter: (e: ReadingPathEntry) => !e.read && isPendingAnalysis(e.analysis),
      score: (e: ReadingPathEntry) => e.strategyScore + (isPendingAnalysis(e.analysis) ? 0.2 : 0),
    },
    {
      id: 'read_unmapped',
      title: 'Leídas sin incorporar al mapa',
      objective: 'Obras marcadas como leídas en Zotero pero todavía sin análisis profundo suficiente.',
      filter: isReadUnmapped,
      score: (e: ReadingPathEntry) => e.strategyScore + 0.25,
    },
  ];

  const phases = [];
  for (const def of defs) {
    if (remaining <= 0) break;
    const candidates = entries.filter((e) => def.filter(e) && !used.has(e.nodus_id));
    const selected = pickDiverse(candidates, Math.min(phaseCap, remaining), def.score).map((entry) => ({
      ...entry,
      phase: def.id,
    }));
    for (const entry of selected) used.add(entry.nodus_id);
    remaining -= selected.length;
    phases.push({
      id: def.id,
      title: def.title,
      objective: def.objective,
      entries: selected,
      totalCandidates: candidates.length,
      omitted: Math.max(0, candidates.length - selected.length),
    });
  }

  if (remaining > 0) {
    const candidates = entries.filter((e) => !used.has(e.nodus_id));
    const selected = pickDiverse(candidates, remaining, (e) => e.strategyScore).map((entry) => ({
      ...entry,
      phase: 'next_best',
    }));
    phases.push({
      id: 'next_best',
      title: 'Siguientes mejores opciones',
      objective: 'Lecturas restantes que todavía aportan señales relevantes para el criterio elegido.',
      entries: selected,
      totalCandidates: candidates.length,
      omitted: Math.max(0, candidates.length - selected.length),
    });
  }

  return phases.filter((phase) => phase.entries.length > 0 || phase.totalCandidates > 0);
}

function pickDiverse(entries: ReadingPathEntry[], limit: number, score: (entry: ReadingPathEntry) => number): ReadingPathEntry[] {
  const selected: ReadingPathEntry[] = [];
  const pool = [...entries];
  const themeUse = new Map<string, number>();
  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const key = pool[i].diversityKey ? normalizeThemeLabel(pool[i].diversityKey!) : '';
      const penalty = key ? (themeUse.get(key) ?? 0) * 0.08 : 0;
      const s = score(pool[i]) - penalty;
      if (s > bestScore) {
        bestScore = s;
        bestIndex = i;
      }
    }
    const [picked] = pool.splice(bestIndex, 1);
    selected.push(picked);
    if (picked.diversityKey) {
      const key = normalizeThemeLabel(picked.diversityKey);
      themeUse.set(key, (themeUse.get(key) ?? 0) + 1);
    }
  }
  return selected;
}

function collectGapSignals(): GapSignals {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT g.statement, g.related_idea, t.label AS theme_label
       FROM gaps g
       LEFT JOIN work_themes wt ON wt.nodus_id = g.nodus_id
       LEFT JOIN themes t ON t.theme_id = wt.theme_id`
    )
    .all() as { statement: string; related_idea: string | null; theme_label: string | null }[];
  const ideaThemeRows = db
    .prepare(
      `SELECT g.statement, g.related_idea, t.label AS theme_label
       FROM gaps g
       JOIN idea_theme_links it ON it.global_id = g.related_idea
       JOIN themes t ON t.theme_id = it.theme_id
       WHERE g.related_idea IS NOT NULL`
    )
    .all() as { statement: string; related_idea: string | null; theme_label: string | null }[];
  const ideaIds = new Set<string>();
  const themeLabels = new Set<string>();
  const statementsByTheme = new Map<string, string[]>();
  for (const row of [...rows, ...ideaThemeRows]) {
    if (row.related_idea) ideaIds.add(row.related_idea);
    if (!row.theme_label) continue;
    const theme = normalizeThemeLabel(row.theme_label);
    themeLabels.add(theme);
    const list = statementsByTheme.get(theme) ?? [];
    if (!list.includes(row.statement)) list.push(row.statement);
    statementsByTheme.set(theme, list.slice(0, 5));
  }
  return { ideaIds, themeLabels, statementsByTheme };
}

function collectCoreThemes(rows: ReadingWorkRow[], gapSignals: GapSignals, researchBrief: string): Set<string> {
  const scores = new Map<string, number>();
  const briefTokens = tokenize(researchBrief);
  for (const row of rows) {
    for (const theme of splitConcat(row.theme_labels)) {
      const norm = normalizeThemeLabel(theme);
      const directInterest = Array.from(tokenize(norm)).some((token) => briefTokens.has(token)) ? 4 : 0;
      scores.set(norm, (scores.get(norm) ?? 0) + 1 + directInterest + (gapSignals.themeLabels.has(norm) ? 2 : 0));
    }
  }
  return new Set(
    [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([theme]) => theme)
  );
}

function collectCitedWorks(): string[] {
  const rows = getDb().prepare('SELECT cited_work FROM external_refs').all() as { cited_work: string | null }[];
  return rows.map((r) => normalizeText(r.cited_work)).filter(Boolean);
}

/** The author and title needles this work is looked up by, as before. */
function citationPatterns(row: ReadingWorkRow): string[] {
  const title = normalizeText(row.title).slice(0, 80);
  const firstAuthor = parseAuthors(row.authors_json)[0]?.split(/[,\s]/)[0] ?? '';
  const author = normalizeText(firstAuthor);
  const patterns: string[] = [];
  if (author) patterns.push(author);
  if (title.length > 20) patterns.push(title);
  return patterns;
}

/**
 * Approximate citation counts for every work in one pass over the references.
 *
 * This replaces a per-work `citedWorks.filter(ref => ref.includes(...))`, which
 * was O(works x refs) substring searches — 3,000 works against 60,000
 * references measured 13 s of blocked main process, in a synchronous IPC
 * handler, so the Reading Path simply never finished loading on a large
 * library.
 *
 * Aho-Corasick rather than a word or token index, because it preserves
 * `includes` semantics exactly: a surname occurring inside a longer word still
 * matches, so the resulting ranking is unchanged.
 */
function approximateCitationCounts(rows: ReadingWorkRow[], citedWorks: string[]): number[] {
  const counts = new Array<number>(rows.length).fill(0);
  if (citedWorks.length === 0 || rows.length === 0) return counts;

  const index = new SubstringIndex();
  const groupsByPattern: number[][] = [];
  let any = false;
  rows.forEach((row, group) => {
    for (const pattern of citationPatterns(row)) {
      const id = index.add(pattern);
      if (id < 0) continue;
      // A pattern is shared when two works have the same first author, so the
      // mapping is one pattern to many works.
      (groupsByPattern[id] ??= []).push(group);
      any = true;
    }
  });
  if (!any) return counts;
  for (let id = 0; id < groupsByPattern.length; id += 1) groupsByPattern[id] ??= [];
  return index.countContainingHaystacksByGroup(citedWorks, groupsByPattern, rows.length);
}

function scoreForStrategy(
  strategy: ReadingPathStrategy,
  s: {
    interestScore: number;
    gapScore: number;
    foundationalScore: number;
    recencyScore: number;
    authorConnectivityScore: number;
    bridgeScore: number;
    coreThemeScore: number;
    unreadBoost: number;
    pendingAnalysisBoost: number;
  }
): number {
  const base =
    strategy === 'gaps'
      ? s.gapScore * 0.54 + s.interestScore * 0.18 + s.bridgeScore * 0.12 + s.foundationalScore * 0.08
      : strategy === 'foundational'
        ? s.foundationalScore * 0.54 + s.authorConnectivityScore * 0.14 + s.coreThemeScore * 0.12 + s.bridgeScore * 0.1
        : strategy === 'recent'
          ? s.recencyScore * 0.56 + s.interestScore * 0.16 + s.gapScore * 0.12 + s.bridgeScore * 0.08
          : strategy === 'connected_authors'
            ? s.authorConnectivityScore * 0.52 + s.bridgeScore * 0.18 + s.foundationalScore * 0.12 + s.interestScore * 0.1
            : strategy === 'bridges'
              ? s.bridgeScore * 0.52 + s.gapScore * 0.18 + s.authorConnectivityScore * 0.12 + s.interestScore * 0.1
              : s.interestScore * 0.28 + s.gapScore * 0.22 + s.foundationalScore * 0.16 + s.bridgeScore * 0.14 + s.coreThemeScore * 0.12;
  return clamp01(base + s.unreadBoost + s.pendingAnalysisBoost);
}

function readingReason(input: {
  read: boolean;
  analysis: ReadingPathEntry['analysis'];
  gapScore: number;
  foundationalScore: number;
  recencyScore: number;
  authorConnectivityScore: number;
  bridgeScore: number;
  interestScore: number;
  relatedGaps: string[];
  citedBy: number;
}): string {
  const parts: string[] = [];
  parts.push(input.read ? 'Marcada como leída por la etiqueta de Zotero.' : 'Pendiente de lectura.');
  if (input.analysis.hasIdeas) parts.push(`${input.analysis.ideaCount} idea(s) extraída(s).`);
  if (input.analysis.hasThemes) parts.push(`${input.analysis.themeCount} tema(s) detectado(s).`);
  if (input.analysis.hasContradictions) parts.push(`${input.analysis.contradictionCount} contradicción(es) o refutación(es).`);
  if (input.analysis.hasGaps) parts.push(`${input.analysis.gapCount} hueco(s) asociado(s).`);
  if (input.relatedGaps.length > 0 || input.gapScore >= 0.2) parts.push('Alta conexión con huecos de investigación.');
  if (input.foundationalScore >= 0.45) parts.push(input.citedBy > 0 ? `Posible texto de base (${input.citedBy} cita(s) internas aproximadas).` : 'Posible texto de base.');
  if (input.bridgeScore >= 0.45) parts.push('Conecta varias líneas temáticas o relaciones del grafo.');
  if (input.authorConnectivityScore >= 0.45) parts.push('Autoría conectada con otros nodos del corpus.');
  if (input.recencyScore >= 0.72) parts.push('Aporta actualización reciente.');
  if (input.interestScore >= 0.4) parts.push('Coincide con las prioridades indicadas.');
  if (isPendingAnalysis(input.analysis)) parts.push('Conviene completar análisis antes de decidir su papel en el mapa.');
  return parts.join(' ');
}

function isAnalysed(entry: ReadingPathEntry): boolean {
  return (
    entry.analysis.lightStatus === 'done' ||
    entry.analysis.deepStatus === 'done' ||
    entry.analysis.hasThemes ||
    entry.analysis.hasIdeas ||
    entry.analysis.hasGaps ||
    entry.analysis.hasContradictions
  );
}

function isPendingAnalysis(analysis: ReadingPathEntry['analysis']): boolean {
  return analysis.lightStatus !== 'done' || analysis.deepStatus !== 'done' || !analysis.hasIdeas;
}

function isReadUnmapped(entry: ReadingPathEntry): boolean {
  return entry.read && (entry.analysis.deepStatus !== 'done' || !entry.analysis.hasIdeas);
}

function textRelevance(query: string, target: string): number {
  const q = tokenize(query);
  if (q.size === 0) return 0;
  const t = tokenize(target);
  let hits = 0;
  for (const token of q) if (t.has(token)) hits++;
  return clamp01(hits / Math.min(q.size, 16));
}

function parseAuthors(authorsJson: string): string[] {
  try {
    const parsed = JSON.parse(authorsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Read one of readPathRows' aggregated lists. They are JSON arrays (json_group_array), not
 * GROUP_CONCAT's comma-joined text: thousands of idea labels contain commas, and splitting
 * on them turned one label into fragments ("V" / "D" / "and J segments") that were then
 * shown as related ideas.
 */
function splitConcat(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function splitGapStatements(value: string | null): string[] {
  if (!value) return [];
  return unique(
    value
      .split('\u001f')
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

/**
 * Distinct values in order, comparing them normalised.
 *
 * Takes an iterable and a limit so a caller that only wants the first few can
 * stop the normalisation there. `unique(xs).slice(0, n)` and `unique(xs, n)`
 * return the same thing — the function preserves input order, so the first n
 * distinct values are the same either way — but the second stops looking.
 */
function unique(values: Iterable<string>, limit = Infinity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (out.length >= limit) break;
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
