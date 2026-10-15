import type {
  GapKind,
  IdeaType,
  WritingWorkshopBrief,
  WritingWorkshopCandidateBase,
  EdgeDetail,
  WritingWorkshopContradictionCandidate,
  WritingWorkshopDraft,
  WritingWorkshopDraftRequest,
  WritingWorkshopGapCandidate,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopMatrixRow,
  WritingWorkshopPassageCandidate,
  WritingWorkshopRouteCandidate,
  WritingWorkshopSection,
  WritingWorkshopSelection,
  WritingWorkshopSnapshot,
  WritingWorkshopThemeCandidate,
  WritingWorkshopWorkCandidate,
} from '@shared/types';
import { getDb } from '../db/database';
import { activeManualIdeaIds } from '../db/manualIdeaVisibility';
import { getContradictions } from '../graph/graphService';
import { listTutorRoutes } from '../db/tutorRepo';
import { completeJson } from './aiClient';
import { embedQuery, embedMany } from './aiClient';
import { findSimilarIdeasPaged } from '../db/ideasRepo';
import { findSimilarWorksPaged } from '../db/workSummariesRepo';
import { findSimilarPassagesPaged, type SimilarPassage } from '../db/passagesRepo';
import { retrieveHierarchical, selectPassageEvidence } from './hierarchicalRetrieval';
import {
  alignCitationKindsToAllowed,
  canonicalizeCitationLinks,
  citationUrl,
  extractCitationRefs,
  stripDisallowedCitations,
} from './citationSanitize';
import { repairLooseCitations } from './deepResearchCore';
import { getSettings } from '../db/settingsRepo';
import { writingWorkshopPromptPack, type WritingWorkshopFallbackCopy } from '@shared/writingWorkshopPromptPacks';

const MAX_IDEAS = 120;
const MAX_THEMES = 30;
const MAX_GAPS = 36;
const MAX_CONTRADICTIONS = 30;
const MAX_WORKS = 80;
const MAX_PASSAGES = 24;
/** How many semantic probes a single snapshot may run. */
const MAX_PROBES = 8;
/** Share of the pool reserved for the objective itself; the rest is split between sub-questions. */
const OBJECTIVE_SHARE = 0.4;
const MAX_ROUTES = 12;
const MAX_CONTEXT_CHARS = 420_000;
const MAX_PASSAGE_CONTEXT_CHARS = 30_000;

interface Scored<T> {
  item: T;
  score: number;
  reason: string;
}

interface IdeaRow {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  themes: string | null;
  work_count: number;
  evidence_count: number;
  work_ids: string | null;
}

interface WorkLinkRow {
  nodus_id: string;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
  doi: string | null;
}

interface ThemeRow {
  theme_id: string;
  label: string;
  pinned: number | null;
  work_count: number;
  idea_count: number;
  work_ids: string | null;
}

interface WorkshopSemanticRanking {
  active: boolean;
  ideaScores: Map<string, number>;
  workScores: Map<string, number>;
  passages: WritingWorkshopPassageCandidate[];
}

export type WorkshopRetrievalMode = 'hierarchical' | 'idea_first' | 'legacy';

interface WorkshopSnapshotOptions {
  /**
   * `idea_first` deliberately recreates the pre-document retrieval boundary for
   * Deep Research planning: idea/work vectors may rank the graph, but document
   * profiles and literal passages cannot influence the thesis or outline.
   */
  retrievalMode?: WorkshopRetrievalMode;
}

interface WorkshopContext {
  payload: Record<string, unknown>;
  stats: WritingWorkshopDraft['stats'];
}

interface GapRow {
  id: string;
  kind: GapKind;
  statement: string;
  related_idea: string | null;
  confidence: number;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
  nodus_id: string;
  idea_label: string | null;
}

interface WorkRow {
  nodus_id: string;
  zotero_key: string;
  title: string;
  authors_json: string;
  year: number | null;
  deep_status: WritingWorkshopWorkCandidate['deepStatus'];
  doi: string | null;
  orientation_summary: string | null;
  document_overview: string | null;
  document_status: WritingWorkshopWorkCandidate['documentStatus'];
  document_version_id: string | null;
  themes: string | null;
  idea_count: number;
  gap_count: number;
}

interface AiWorkshopResult {
  title?: string;
  abstract?: string;
  outline?: Array<{
    id?: string;
    title?: string;
    purpose?: string;
    keyClaims?: string[];
    sources?: string[];
  }>;
  draftMarkdown?: string;
  matrix?: Array<{
    claim?: string;
    role?: string;
    sourceLabel?: string;
    citation?: string;
    evidence?: string;
    notes?: string;
  }>;
  bibliography?: string[];
  nextSteps?: string[];
  limitations?: string[];
}

function isAiWorkshopResult(value: unknown): value is AiWorkshopResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as AiWorkshopResult;
  return typeof v.title === 'string' && typeof v.draftMarkdown === 'string' && Array.isArray(v.outline);
}

export async function buildWritingWorkshopSnapshot(
  brief: WritingWorkshopBrief,
  /** Extra sub-questions to probe the corpus with, on top of the objective itself. */
  extraProbes: string[] = [],
  options: WorkshopSnapshotOptions = {},
): Promise<WritingWorkshopSnapshot> {
  // The historical General call supplies no probes and therefore tokenizes the exact
  // same string as before. Specialized Deep Research can still enrich lexical-only
  // vaults when semantic embeddings are unavailable by adding its probes here.
  const lexicalQuery = extraProbes.length
    ? `${brief.objective} ${kindLabel(brief.kind)} ${extraProbes.join(' ')}`
    : `${brief.objective} ${kindLabel(brief.kind)}`;
  const tokens = tokenize(lexicalQuery);
  const retrievalMode = options.retrievalMode ?? 'hierarchical';
  const semantic = await buildSemanticRanking([brief.objective, ...extraProbes], retrievalMode);
  const ideas = rankedIdeas(tokens, semantic);
  const themes = rankedThemes(tokens, semantic);
  const gaps = rankedGaps(tokens, brief.kind, semantic);
  const contradictions = rankedContradictions(tokens, semantic);
  const works = rankedWorks(tokens, semantic, retrievalMode === 'hierarchical');
  const tutorRoutes = rankedTutorRoutes(tokens);

  return {
    generatedAt: new Date().toISOString(),
    brief,
    stats: {
      ideas: getSettings().academicMode === 'manual' ? activeManualIdeaIds(getDb()).size : countTable('ideas'),
      themes: countTable('themes'),
      gaps: countTable('gaps'),
      contradictions: getContradictions().length,
      works: countTable('works'),
      passages: countTable('passages'),
      tutorRoutes: listTutorRoutes().length,
    },
    recommendedSelection: recommendSelection(brief, { ideas, themes, gaps, contradictions, works, tutorRoutes }),
    ideas,
    themes,
    gaps,
    contradictions,
    works,
    passages: semantic.passages,
    tutorRoutes,
  };
}

/**
 * Snapshot used to decide a Deep Research argument. It is intentionally blind to
 * the new document-profile index and to passage retrieval. Once this snapshot has
 * produced a stable plan, the ordinary hierarchical retriever may add evidence to
 * each section without being allowed to redesign the report around documents.
 */
export function buildIdeaFirstWritingWorkshopSnapshot(
  brief: WritingWorkshopBrief,
  extraProbes: string[] = [],
): Promise<WritingWorkshopSnapshot> {
  return buildWritingWorkshopSnapshot(brief, extraProbes, { retrievalMode: 'idea_first' });
}

/**
 * Compatibility snapshot for Deep Research v1.
 *
 * This is deliberately a separate named entry point instead of relying on the
 * default builder. The default has evolved to hierarchical retrieval; v1 must
 * remain reproducible and use only the historical idea/work vector indexes plus
 * the direct passage vector index. In particular, it must never call
 * `retrieveHierarchical`, route through document profiles, or use document/support
 * lanes to influence the workshop argument.
 */
export function buildHistoricalWritingWorkshopSnapshot(
  brief: WritingWorkshopBrief,
  extraProbes: string[] = [],
): Promise<WritingWorkshopSnapshot> {
  return buildWritingWorkshopSnapshot(brief, extraProbes, { retrievalMode: 'legacy' });
}

export async function generateWritingWorkshopDraft(request: WritingWorkshopDraftRequest): Promise<WritingWorkshopDraft> {
  citationLabelCache.clear();
  const promptLanguage = getSettings().promptLanguage ?? 'es';
  const prompt = writingWorkshopPromptPack(promptLanguage);
  const snapshot = await buildWritingWorkshopSnapshot(request.brief);
  const selection = normalizeSelection(request.selection, snapshot.recommendedSelection);
  const context = await buildSelectedContext(request.brief, selection, prompt.contextRule);
  const user = JSON.stringify(context.payload, null, 2);

  let ai: AiWorkshopResult;
  try {
    ai = await completeJson<AiWorkshopResult>(
      {
        system: prompt.system,
        user,
        temperature: 0.18,
        maxTokens: 16000,
      },
      isAiWorkshopResult,
      request.model
    );
  } catch {
    return structuralFallback(request.brief, selection, context, prompt.fallback);
  }

  return sanitizeDraft(ai, request.brief, selection, context, prompt.fallback);
}

function countTable(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/**
 * One query embedding drives the entire workshop table. We use the existing
 * idea/work vectors for broad ranking and the fine passage index for direct
 * evidence candidates; lexical matching remains only as an offline fallback.
 */
async function buildSemanticRanking(
  queries: string[],
  retrievalMode: WorkshopRetrievalMode = 'hierarchical',
): Promise<WorkshopSemanticRanking> {
  const empty: WorkshopSemanticRanking = { active: false, ideaScores: new Map(), workScores: new Map(), passages: [] };
  // One probe reaches only the corpus neighbourhood of the objective *as a whole*.
  // A question spanning several axes ("turismo, género y mirada colonial") retrieves
  // what resembles that whole sentence and misses what each axis would find alone,
  // so several probes are merged by best score per item.
  const probes = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, MAX_PROBES);
  if (probes.length === 0) return empty;
  try {
    const vectors = (await embedMany(probes, undefined, { role: 'query' })).filter((v): v is number[] => Array.isArray(v) && v.length > 0);
    if (vectors.length === 0) return empty;

    // Merging by score and then trimming to the cap is NOT enough: the objective's
    // own neighbourhood scores highest across the board, so the trim throws away
    // exactly what the sub-questions were meant to add and the pool collapses back
    // to the single-probe one. Each probe therefore gets a guaranteed quota of
    // slots, and only what is left over is filled by global score.
    const ideaScores = new Map<string, number>();
    const workScores = new Map<string, number>();
    const passages = new Map<string, SimilarPassage>();
    const passageScore = new Map<string, number>();
    const reserve = <T>(chosen: Map<string, T>, limit: number) => chosen.size < limit;

    const quotaFor = (limit: number, index: number) => {
      // A lone probe is the whole search: quotas must never shrink it below what a
      // single-probe snapshot used to retrieve.
      if (vectors.length === 1) return limit;
      return index === 0
        ? Math.max(1, Math.round(limit * OBJECTIVE_SHARE))
        : Math.max(1, Math.floor((limit * (1 - OBJECTIVE_SHARE)) / (vectors.length - 1)));
    };

    // A quota with no quality floor is how breadth turns into noise: a sub-question
    // with few good matches still spends its slots on weak material, the writer
    // argues from it, and the claims it produces are not supported by the sources
    // they cite. Measured: unsupported citations tripled. So a sub-question may only
    // contribute material at least as relevant as the WEAKEST hit the objective
    // itself accepted — breadth, never at the cost of relevance.
    // The bar is what the single-probe pool would itself have accepted: the weakest
    // item in the objective's own full-size result set. A sub-question may add
    // anything that clears it and nothing that does not, so the pool gains breadth
    // without ever lowering its standard of relevance.
    // Paged: each of these walks the whole index, and a snapshot runs one set per
    // probe. Run as a single blocking scan they froze the window for the duration.
    const objectiveHierarchy = retrievalMode === 'hierarchical'
      ? await retrieveHierarchical(probes[0], {
        embedding: vectors[0], documentLimit: MAX_WORKS, ideaLimit: MAX_IDEAS,
        passageLimit: MAX_PASSAGES * 2, routedWorkLimit: 16, routedPassageLimit: MAX_PASSAGES,
        minDocumentSimilarity: 0.2, minIdeaSimilarity: -1, minPassageSimilarity: -1,
      })
      : null;
    const objectiveIdeas = objectiveHierarchy?.ideas
      ?? await findSimilarIdeasPaged(vectors[0], -1, MAX_IDEAS);
    const objectiveWorks = await findSimilarWorksPaged(vectors[0], -1, MAX_WORKS);
    // Passages are an evidence layer, not part of the argument-discovery layer.
    const objectivePassages = retrievalMode === 'legacy'
      ? await findSimilarPassagesPaged(vectors[0], -1, MAX_PASSAGES * 2)
      : objectiveHierarchy?.passages ?? [];
    const weakest = <T extends { similarity: number }>(hits: T[]) => (hits.length ? hits[hits.length - 1].similarity : -1);
    const floors = {
      ideas: weakest(objectiveIdeas),
      works: weakest(objectiveWorks),
      passages: weakest(objectivePassages),
    };

    for (const [index, vector] of vectors.entries()) {
      const isObjective = index === 0;
      const hierarchy = retrievalMode === 'hierarchical'
        ? (isObjective ? objectiveHierarchy! : await retrieveHierarchical(probes[index], {
          embedding: vector,
          documentLimit: quotaFor(MAX_WORKS, index),
          ideaLimit: quotaFor(MAX_IDEAS, index),
          passageLimit: quotaFor(MAX_PASSAGES * 2, index),
          routedWorkLimit: 12,
          routedPassageLimit: Math.max(2, Math.floor(quotaFor(MAX_PASSAGES * 2, index) / 2)),
          minDocumentSimilarity: 0.2,
          minIdeaSimilarity: floors.ideas,
          minPassageSimilarity: floors.passages,
        }))
        : null;
      const ideaHits = (hierarchy?.ideas ?? (isObjective
        ? objectiveIdeas
        : await findSimilarIdeasPaged(vector, floors.ideas, quotaFor(MAX_IDEAS, index))))
        .slice(0, quotaFor(MAX_IDEAS, index));
      const workHits = isObjective
        ? objectiveWorks.slice(0, quotaFor(MAX_WORKS, index))
        : await findSimilarWorksPaged(vector, floors.works, quotaFor(MAX_WORKS, index));
      const passageHits = (retrievalMode === 'legacy'
        ? (isObjective
          ? objectivePassages
          : await findSimilarPassagesPaged(vector, floors.passages, quotaFor(MAX_PASSAGES * 2, index)))
        : hierarchy?.passages ?? []).slice(0, quotaFor(MAX_PASSAGES * 2, index));
      for (const hit of ideaHits) {
        if (reserve(ideaScores, MAX_IDEAS) || ideaScores.has(hit.global_id)) {
          ideaScores.set(hit.global_id, Math.max(ideaScores.get(hit.global_id) ?? 0, semanticStrength(hit.similarity)));
        }
      }
      for (const hit of workHits) {
        workScores.set(hit.nodus_id, Math.max(workScores.get(hit.nodus_id) ?? 0, semanticStrength(hit.similarity)));
      }
      const topDocumentScore = hierarchy?.documents[0]?.retrievalScore ?? 1;
      for (const hit of hierarchy?.documents ?? []) {
        // Document routing is an independent lane. The old MAX_WORKS guard was
        // already full after summary vectors, so a newly discovered book could
        // never enter the pool; profiles merely reranked books we already knew.
        // Keep the union here and let rankedWorks perform the final bounded sort.
        const rankStrength = Math.min(0.65, 0.65 * (hit.retrievalScore / topDocumentScore));
        const strength = Math.max(rankStrength, semanticStrength(hit.similarity));
        workScores.set(hit.nodusId, Math.max(workScores.get(hit.nodusId) ?? 0, strength));
      }
      for (const hit of passageHits) {
        const strength = semanticStrength(hit.similarity);
        workScores.set(hit.nodus_id, Math.max(workScores.get(hit.nodus_id) ?? 0, strength));
        if (!passages.has(hit.passage_id) && !reserve(passages, MAX_PASSAGES * 2)) continue;
        if ((passageScore.get(hit.passage_id) ?? -1) < strength) {
          passageScore.set(hit.passage_id, strength);
          passages.set(hit.passage_id, hit);
        }
      }
    }

    // Pass two: the objective fills any slots the quotas left unused.
    for (const hit of objectiveIdeas) {
      if (ideaScores.size >= MAX_IDEAS) break;
      if (!ideaScores.has(hit.global_id)) ideaScores.set(hit.global_id, semanticStrength(hit.similarity));
    }
    for (const hit of objectiveWorks) {
      if (workScores.size >= MAX_WORKS) break;
      if (!workScores.has(hit.nodus_id)) workScores.set(hit.nodus_id, semanticStrength(hit.similarity));
    }
    for (const hit of objectivePassages) {
      if (passages.size >= MAX_PASSAGES * 2) break;
      if (passages.has(hit.passage_id)) continue;
      passageScore.set(hit.passage_id, semanticStrength(hit.similarity));
      passages.set(hit.passage_id, hit);
    }

    const rankedPassages = [...passages.values()].sort(
      (a, b) => (passageScore.get(b.passage_id) ?? 0) - (passageScore.get(a.passage_id) ?? 0)
    );

    return {
      active: ideaScores.size > 0 || workScores.size > 0 || rankedPassages.length > 0,
      ideaScores,
      workScores,
      passages: rankedPassages.map((hit) => toPassageCandidate(hit)),
    };
  } catch (error) {
    console.warn('[writingWorkshop] semantic ranking unavailable:', error instanceof Error ? error.message : String(error));
    return empty;
  }
}

function semanticStrength(similarity: number): number {
  return Math.max(0, Math.min(0.65, similarity));
}

function scoreForIds(ids: string[], scores: Map<string, number>): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const score = scores.get(id);
    if (score != null && (best == null || score > best)) best = score;
  }
  return best;
}

function semanticOrLexical(semantic: WorkshopSemanticRanking, semanticScore: number | null, lexicalScore: number): number {
  return semantic.active ? semanticScore ?? 0 : lexicalScore;
}

function semanticReason(semantic: WorkshopSemanticRanking, score: number, support: number): string {
  if (semantic.active && score > support) return 'Recuperado por similitud semántica con el objetivo.';
  return reasonFor(score, support, semantic.active ? 0 : score - support);
}

function toPassageCandidate(
  hit: SimilarPassage & { lanes?: Array<'global' | 'lexical' | 'support' | 'document'> },
  scope: 'objective' | 'section' = 'objective',
): WritingWorkshopPassageCandidate {
  const lanes = hit.lanes ?? [];
  const route = lanes.length > 1
    ? `recuperación híbrida (${lanes.join(', ')})`
    : lanes[0] === 'lexical'
      ? 'coincidencia literal'
      : lanes[0] === 'support'
        ? 'soporte verificable de la ficha documental'
        : lanes[0] === 'document'
          ? 'búsqueda dentro de una obra enrutada'
          : 'similitud semántica';
  return {
    id: hit.passage_id,
    label: `${hit.title}${hit.page_label ? ` · ${hit.page_label}` : ''}`,
    summary: clip(hit.text, 520),
    score: semanticStrength(hit.similarity),
    reason: `Pasaje recuperado por ${route} con ${scope === 'section' ? 'esta sección' : 'el objetivo'}.`,
    nodus_id: hit.nodus_id,
    pageLabel: hit.page_label,
    authors: parseAuthors(hit.authors_json),
    year: hit.year,
    zotero_key: hit.zotero_key,
    citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
  };
}

/**
 * Second-pass retrieval for one Deep Research section.
 *
 * The workshop snapshot is ranked once against the whole objective, which caps how
 * much any single sub-question can bring back — passages worst of all. This asks the
 * same indexes again using the section's own focus as the query, so a section about
 * a narrow theme can reach material the objective-level ranking never surfaced.
 * Returns candidates in the same shape the snapshot uses so they merge cleanly.
 */
export async function retrieveSectionMaterial(input: {
  objective: string;
  sectionTitle: string;
  purpose: string;
  keyClaims: string[];
  coverageQuestions?: string[];
  excludeIdeaIds: string[];
  excludePassageIds: string[];
  limits: { ideas: number; passages: number };
}): Promise<{
  ideas: WritingWorkshopIdeaCandidate[];
  passages: WritingWorkshopPassageCandidate[];
  evidencePacks: Array<{
    question: string;
    passageIds: string[];
    candidates: Array<{
      passageId: string;
      query: string;
      rank: number;
      lanes: Array<'global' | 'lexical' | 'support' | 'document'>;
      score: number;
      reason: string;
    }>;
  }>;
}> {
  const query = [
    input.sectionTitle,
    ...(input.coverageQuestions ?? []),
    input.purpose,
    ...input.keyClaims,
  ].filter(Boolean).join('. ').trim();
  if (!query) return { ideas: [], passages: [], evidencePacks: [] };

  const skipIdeas = new Set(input.excludeIdeaIds);
  const skipPassages = new Set(input.excludePassageIds);
  const atomicProbes = [...new Set((input.coverageQuestions ?? []).map((probe) => probe.trim()).filter(Boolean))];
  const primaryProbes = atomicProbes.length ? atomicProbes : [query];
  // Every atomic requirement receives an independent semantic + literal search.
  // Concatenating all requirements into one vector retrieves their intersection;
  // fusing all literal lists before selection lets generic shared vocabulary evict
  // the one passage that answers a narrow operation. Keep the lists separate until
  // after each question has received its first evidence slot.
  const retrieveProbe = async (probe: string, literalQueries: string[]) => {
    let vector: number[] | null = null;
    try { vector = await embedQuery(`${input.sectionTitle}\n${probe}`); } catch { /* FTS remains available */ }
    return retrieveHierarchical(`${probe}\n${input.sectionTitle}`, {
      embedding: vector,
      documentLimit: 20,
      ideaLimit: input.limits.ideas * 4,
      passageLimit: input.limits.passages * 4,
      routedWorkLimit: 10,
      routedPassageLimit: input.limits.passages * 2,
      lexicalPassageQueries: literalQueries,
      minIdeaSimilarity: -1,
      minPassageSimilarity: -1,
    });
  };
  const primary = await Promise.all(primaryProbes.map((probe) => retrieveProbe(probe, [probe])));
  // The complete title/purpose/claims query remains an independent fallback. It can
  // fill spare slots, but it can no longer erase the best hit of an atomic question.
  const contextual = atomicProbes.length ? await retrieveProbe(`${query}\n${input.objective}`, [query]) : null;

  const roundRobinUnique = <T>(lists: T[][], limit: number, key: (item: T) => string): T[] => {
    const selected: T[] = [];
    const seen = new Set<string>();
    const positions = lists.map(() => 0);
    while (selected.length < limit) {
      let progressed = false;
      for (let index = 0; index < lists.length && selected.length < limit; index += 1) {
        while (positions[index] < lists[index].length) {
          const item = lists[index][positions[index]++];
          const id = key(item);
          if (seen.has(id)) continue;
          seen.add(id);
          selected.push(item);
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }
    return selected;
  };

  // Atomic questions are evidence probes, not a replacement idea graph. Additional
  // ideas therefore come from the complete section argument; otherwise one weak
  // neighbour per narrow question can inject unrelated concepts into the plan.
  const ideaSource = contextual ?? primary[0];
  const ideaHits = ideaSource.ideas
    .filter((hit) => !skipIdeas.has(hit.global_id))
    .slice(0, input.limits.ideas);
  const passageLists = primary.map((hierarchy) => selectPassageEvidence(
    hierarchy.passages.filter((hit) => !skipPassages.has(hit.passage_id)),
    input.limits.passages,
    { preferLexical: atomicProbes.length > 0, preferSourceDiversity: true },
  ));
  const evidencePacks = atomicProbes.map((question, index) => {
    const candidates = (passageLists[index] ?? []).map((hit, rank) => ({
      passageId: hit.passage_id,
      query: question,
      rank: rank + 1,
      lanes: [...hit.lanes],
      score: hit.similarity,
      reason: `Candidato ${rank + 1} para la pregunta atómica, recuperado por ${hit.lanes.join('+')}.`,
    }));
    return { question, passageIds: candidates.map((candidate) => candidate.passageId), candidates };
  });
  // Preserve each question's complete recall window until the epistemic audit.
  // The eventual writer still receives only the 3 direct + 2 contextual passages
  // selected for each question, but no rare answer is lost in global fusion first.
  const atomicWindow = atomicProbes.length
    ? passageLists.reduce((total, list) => total + list.length, 0)
    : input.limits.passages;
  const passageHits = roundRobinUnique(passageLists, atomicWindow, (hit) => hit.passage_id);
  if (contextual && passageHits.length < atomicWindow + input.limits.passages) {
    const seen = new Set(passageHits.map((hit) => hit.passage_id));
    for (const hit of selectPassageEvidence(
      contextual.passages.filter((candidate) => !skipPassages.has(candidate.passage_id)),
      input.limits.passages,
      { preferSourceDiversity: true },
    )) {
      if (seen.has(hit.passage_id)) continue;
      seen.add(hit.passage_id);
      passageHits.push(hit);
      if (passageHits.length >= atomicWindow + input.limits.passages) break;
    }
  }

  return {
    ideas: ideaHits.slice(0, input.limits.ideas).map((hit) => ideaCandidateById(hit.global_id, semanticStrength(hit.similarity))).filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea),
    passages: passageHits.map((hit) => toPassageCandidate(hit, 'section')),
    evidencePacks,
  };
}

/**
 * Per-section retrieval used by the v1 compatibility engine.
 *
 * Keep this implementation intentionally narrow: it is the pre-hierarchical
 * route from the historical engine — one embedding over the section focus,
 * followed by the idea and passage vector indexes. It does not consult
 * `retrieveHierarchical`, document profiles, routed works, or support/document
 * lanes. The current section retriever remains separate so improvements to v2
 * cannot silently change the meaning of an old report.
 */
export async function retrieveSectionMaterialLegacy(input: {
  objective: string;
  sectionTitle: string;
  purpose: string;
  keyClaims: string[];
  coverageQuestions?: string[];
  excludeIdeaIds: string[];
  excludePassageIds: string[];
  limits: { ideas: number; passages: number };
}): Promise<{
  ideas: WritingWorkshopIdeaCandidate[];
  passages: WritingWorkshopPassageCandidate[];
}> {
  const query = [input.sectionTitle, input.purpose, ...input.keyClaims].filter(Boolean).join('. ').trim();
  if (!query) return { ideas: [], passages: [] };
  const vector = await embedQuery(`${input.objective}\n${query}`);
  if (!vector) return { ideas: [], passages: [] };

  const skipIdeas = new Set(input.excludeIdeaIds);
  const skipPassages = new Set(input.excludePassageIds);
  const ideaHits = (await findSimilarIdeasPaged(vector, -1, input.limits.ideas * 4))
    .filter((hit) => !skipIdeas.has(hit.global_id));
  const passageHits = (await findSimilarPassagesPaged(vector, -1, input.limits.passages * 4))
    .filter((hit) => !skipPassages.has(hit.passage_id));

  return {
    ideas: ideaHits
      .slice(0, input.limits.ideas)
      .map((hit) => ideaCandidateById(hit.global_id, semanticStrength(hit.similarity)))
      .filter((idea): idea is WritingWorkshopIdeaCandidate => !!idea),
    passages: passageHits.slice(0, input.limits.passages).map((hit) => toPassageCandidate(hit)),
  };
}

/** Descriptive alias for callers that prefer the full compatibility name. */
export const retrieveHistoricalSectionMaterial = retrieveSectionMaterialLegacy;

/** Load one idea in snapshot shape. Used by the per-section retrieval. */
function ideaCandidateById(globalId: string, score: number): WritingWorkshopIdeaCandidate | null {
  const row = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.nodus_id) AS work_count,
              COUNT(DISTINCT e.id) AS evidence_count
         FROM ideas i
         LEFT JOIN idea_occurrences io ON io.global_id = i.global_id
         LEFT JOIN evidence e ON e.global_id = i.global_id
         LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
         LEFT JOIN themes t ON t.theme_id = itl.theme_id
        WHERE i.global_id = ?
        GROUP BY i.global_id`
    )
    .get(globalId) as Omit<IdeaRow, 'work_ids'> | undefined;
  if (!row || (getSettings().academicMode === 'manual' && !activeManualIdeaIds(getDb()).has(globalId))) return null;
  return {
    id: row.global_id,
    label: row.label,
    summary: clip(row.statement, 240),
    score,
    reason: 'Recuperado por similitud semántica con esta sección.',
    type: row.type,
    statement: row.statement,
    themes: splitList(row.themes),
    workCount: row.work_count,
    evidenceCount: row.evidence_count,
    works: ideaWorks(row.global_id),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The candidate pools below count and concatenate related rows. They must do it
// with scalar subqueries, never by joining the related tables and grouping the
// result.
//
// A pool that LEFT JOINs two or more one-to-many tables multiplies before it
// aggregates: one work with 4 themes, 40 ideas and 12 gaps is 1,920 intermediate
// rows, and each one carries every wide column the SELECT asks for — here the
// work summary and the document-profile overview, several KB each. The DISTINCT
// aggregates then exist only to undo that duplication.
//
// SQLite answers such a query with a temp b-tree per aggregate plus one for the
// GROUP BY and one for the ORDER BY, and `temp_store = MEMORY` (see
// electron/db/database.ts) keeps every one of them in RAM with no spill to disk.
// Measured on a synthetic corpus of 200 works shaped as above — a 17 MB database
// — the works pool allocated 4.7 GB; at 900 works the allocator gave up and
// aborted the process mid-query, taking Deep Research and Immersion with it.
//
// Subqueries keep the pool linear in the number of rows returned. Every lookup
// they need is already indexed (idx_idea_occ_global, idx_evidence_global,
// idx_idea_theme_links_global/_theme, idx_work_themes_theme, idx_gaps_nodus),
// so this is also the faster plan: the same 900-work corpus goes from an abort
// to 21 ms. `rankedGaps` needs no such treatment — its joins are one-to-one.
// ─────────────────────────────────────────────────────────────────────────────

function rankedIdeas(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopIdeaCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement,
              COALESCE((SELECT GROUP_CONCAT(DISTINCT t.label)
                          FROM idea_theme_links itl
                          JOIN themes t ON t.theme_id = itl.theme_id
                         WHERE itl.global_id = i.global_id), '') AS themes,
              (SELECT COUNT(DISTINCT io.nodus_id) FROM idea_occurrences io
                WHERE io.global_id = i.global_id) AS work_count,
              (SELECT COUNT(DISTINCT e.id) FROM evidence e
                WHERE e.global_id = i.global_id) AS evidence_count,
              COALESCE((SELECT GROUP_CONCAT(DISTINCT io.nodus_id) FROM idea_occurrences io
                         WHERE io.global_id = i.global_id), '') AS work_ids
         FROM ideas i
        ORDER BY work_count DESC, evidence_count DESC, i.created_at ASC, i.global_id ASC`
    )
    .all() as IdeaRow[];

  const active = getSettings().academicMode === 'manual' ? activeManualIdeaIds(getDb()) : null;
  return rows
    .filter(row => !active || active.has(row.global_id))
    .map((row): Scored<WritingWorkshopIdeaCandidate> => {
      const themeList = splitList(row.themes);
      const baseText = [row.label, row.statement, themeList.join(' ')].join(' ');
      const lexical = relevance(tokens, baseText);
      const semantic = semanticOrLexical(semanticIndex, semanticIndex.ideaScores.get(row.global_id) ?? scoreForIds(splitList(row.work_ids), semanticIndex.workScores), lexical);
      const support = Math.min(0.22, row.work_count * 0.035) + Math.min(0.16, row.evidence_count * 0.018);
      const score = semantic + support;
      return {
        score,
        reason: semanticReason(semanticIndex, score, support),
        item: {
          id: row.global_id,
          label: row.label,
          summary: clip(row.statement, 240),
          score,
          reason: '',
          type: row.type,
          statement: row.statement,
          themes: themeList,
          workCount: row.work_count,
          evidenceCount: row.evidence_count,
          // Filled in below, for the ideas that survive the cut only.
          works: [],
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_IDEAS)
    // The works behind an idea take a query each and play no part in the ranking, so
    // they are looked up after it: on a corpus of ten thousand ideas this was ten
    // thousand queries on the main thread to keep a hundred and twenty of them.
    .map(({ item, score, reason }) => ({ ...item, score, reason, works: ideaWorks(item.id) }));
}

function ideaWorks(globalId: string): WritingWorkshopIdeaCandidate['works'] {
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key, w.doi
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE io.global_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
        LIMIT 5`
    )
    .all(globalId) as WorkLinkRow[];
  return rows.map((row) => ({
    nodus_id: row.nodus_id,
    title: row.title,
    authors: parseAuthors(row.authors_json),
    year: row.year,
    zotero_key: row.zotero_key,
    doi: row.doi,
  }));
}

function rankedThemes(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopThemeCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT t.theme_id, t.label, t.pinned,
              (SELECT COUNT(DISTINCT wt.nodus_id) FROM work_themes wt
                WHERE wt.theme_id = t.theme_id) AS work_count,
              (SELECT COUNT(DISTINCT itl.global_id) FROM idea_theme_links itl
                WHERE itl.theme_id = t.theme_id) AS idea_count,
              COALESCE((SELECT GROUP_CONCAT(DISTINCT wt.nodus_id) FROM work_themes wt
                         WHERE wt.theme_id = t.theme_id), '') AS work_ids
         FROM themes t
        ORDER BY t.pinned DESC, work_count DESC, idea_count DESC, t.theme_id ASC`
    )
    .all() as ThemeRow[];

  return rows
    .map((row): Scored<WritingWorkshopThemeCandidate> => {
      const lexical = relevance(tokens, row.label);
      const semantic = semanticOrLexical(semanticIndex, scoreForIds(splitList(row.work_ids), semanticIndex.workScores), lexical);
      const support = Math.min(0.22, row.work_count * 0.018) + Math.min(0.18, row.idea_count * 0.025) + (row.pinned ? 0.08 : 0);
      const score = semantic + support;
      return {
        score,
        reason: row.pinned ? 'Tema curado y con material conectado.' : semanticReason(semanticIndex, score, support),
        item: {
          id: row.theme_id,
          label: row.label,
          summary: `${row.work_count} obra(s), ${row.idea_count} idea(s) conectadas.`,
          score,
          reason: '',
          workCount: row.work_count,
          ideaCount: row.idea_count,
          pinned: !!row.pinned,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_THEMES)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedGaps(tokens: Set<string>, kind: WritingWorkshopBrief['kind'], semanticIndex: WorkshopSemanticRanking): WritingWorkshopGapCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.kind, g.statement, g.related_idea, g.confidence,
              w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key,
              i.label AS idea_label
         FROM gaps g
         JOIN works w ON w.nodus_id = g.nodus_id
         LEFT JOIN ideas i ON i.global_id = g.related_idea
        ORDER BY g.confidence DESC`
    )
    .all() as GapRow[];

  return rows
    .map((row): Scored<WritingWorkshopGapCandidate> => {
      const lexical = relevance(tokens, [row.statement, row.idea_label ?? '', row.title].join(' '));
      const semantic = semanticOrLexical(
        semanticIndex,
        Math.max(semanticIndex.workScores.get(row.nodus_id) ?? 0, semanticIndex.ideaScores.get(row.related_idea ?? '') ?? 0) || null,
        lexical
      );
      const gapBoost = kind === 'gap_justification' || kind === 'research_question' ? 0.22 : 0.05;
      const support = gapBoost + Math.min(0.16, row.confidence * 0.16);
      const score = semantic + support;
      return {
        score,
        reason: kind === 'gap_justification' ? 'Hueco útil para justificar contribución.' : semanticReason(semanticIndex, score, support),
        item: {
          id: row.id,
          label: clip(row.statement, 90),
          summary: row.statement,
          score,
          reason: '',
          kind: row.kind,
          work: {
            nodus_id: row.nodus_id,
            title: row.title,
            authors: parseAuthors(row.authors_json),
            year: row.year,
            zotero_key: row.zotero_key,
          },
          relatedIdea: row.related_idea,
          confidence: row.confidence,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_GAPS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

/** Author-year labels of the works standing behind a dispute, so the writer can say
 * who holds each side instead of reporting a nameless tension. */
function debateSources(detail: EdgeDetail): string[] {
  const ids = [...new Set(detail.evidence.map((e) => e.nodus_id).filter(Boolean))].slice(0, 6);
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(`SELECT authors_json, year FROM works WHERE nodus_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { authors_json: string; year: number | null }[];
  const labels = rows.map((row) => {
    const author = parseAuthors(row.authors_json)[0];
    return author ? `${author.split(',')[0].trim()}${row.year ? ` (${row.year})` : ''}` : '';
  });
  return [...new Set(labels.filter(Boolean))];
}

function rankedContradictions(tokens: Set<string>, semanticIndex: WorkshopSemanticRanking): WritingWorkshopContradictionCandidate[] {
  return getContradictions()
    .map((detail): Scored<WritingWorkshopContradictionCandidate> => {
      const lexical = relevance(tokens, [detail.fromLabel, detail.toLabel, detail.explanation ?? ''].join(' '));
      const semantic = semanticOrLexical(
        semanticIndex,
        scoreForIds(detail.evidence.map((e) => e.nodus_id), semanticIndex.workScores) ??
          scoreForIds([detail.edge.from_id, detail.edge.to_id], semanticIndex.ideaScores),
        lexical
      );
      const support = Math.min(0.22, detail.edge.confidence * 0.2) + (detail.evidence.length > 0 ? 0.06 : 0);
      const score = semantic + support;
      return {
        score,
        reason: 'Contraste útil para matizar el argumento.',
        item: {
          id: detail.edge.id,
          label: `${detail.fromLabel} / ${detail.toLabel}`,
          summary: detail.explanation ?? `${detail.fromLabel} ${detail.edge.type} ${detail.toLabel}`,
          score,
          reason: '',
          fromLabel: detail.fromLabel,
          toLabel: detail.toLabel,
          type: detail.edge.type,
          basis: detail.edge.basis,
          confidence: detail.edge.confidence,
          sources: debateSources(detail),
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_CONTRADICTIONS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedWorks(
  tokens: Set<string>,
  semanticIndex: WorkshopSemanticRanking,
  includeDocumentProfiles = true,
): WritingWorkshopWorkCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.deep_status, w.doi,
              CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
              dpv.overview AS document_overview,
              COALESCE(dps.status, 'missing') AS document_status,
              dps.current_version_id AS document_version_id,
              COALESCE((SELECT GROUP_CONCAT(DISTINCT t.label)
                          FROM work_themes wt
                          JOIN themes t ON t.theme_id = wt.theme_id
                         WHERE wt.nodus_id = w.nodus_id), '') AS themes,
              (SELECT COUNT(DISTINCT io.global_id) FROM idea_occurrences io
                WHERE io.nodus_id = w.nodus_id) AS idea_count,
              (SELECT COUNT(DISTINCT g.id) FROM gaps g
                WHERE g.nodus_id = w.nodus_id) AS gap_count
         FROM works w
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
         LEFT JOIN document_profile_state dps ON dps.nodus_id = w.nodus_id
         LEFT JOIN document_profile_versions dpv ON dpv.version_id = dps.current_version_id
        WHERE w.archived = 0
        ORDER BY idea_count DESC, gap_count DESC, w.year DESC, w.nodus_id ASC`
    )
    .all() as WorkRow[];

  return rows
    .map((row): Scored<WritingWorkshopWorkCandidate> => {
      const themes = splitList(row.themes);
      const orientation = includeDocumentProfiles
        ? row.document_overview ?? row.orientation_summary ?? ''
        : row.orientation_summary ?? '';
      const lexical = relevance(tokens, [row.title, themes.join(' '), orientation].join(' '));
      const semantic = semanticOrLexical(semanticIndex, semanticIndex.workScores.get(row.nodus_id) ?? null, lexical);
      const support = Math.min(0.18, row.idea_count * 0.03) + Math.min(0.14, row.gap_count * 0.035) + (row.deep_status === 'done' ? 0.08 : 0);
      const score = semantic + support;
      return {
        score,
        reason: includeDocumentProfiles && row.document_status === 'current'
          ? 'Obra orientada por su ficha documental auditada; las afirmaciones se respaldarán con ideas y pasajes.'
          : row.deep_status === 'done' ? (semanticIndex.active ? 'Obra recuperada semánticamente con evidencia indexada.' : 'Obra con ideas y evidencias extraídas.') : semanticReason(semanticIndex, score, support),
        item: {
          id: row.nodus_id,
          label: row.title,
          summary: orientation || `${parseAuthors(row.authors_json)[0] ?? 'Autoría no disponible'}${row.year ? `, ${row.year}` : ''}`,
          score,
          reason: '',
          title: row.title,
          authors: parseAuthors(row.authors_json),
          year: row.year,
          zotero_key: row.zotero_key,
          doi: row.doi,
          themes,
          deepStatus: row.deep_status,
          orientationSummary: row.orientation_summary,
          documentOverview: includeDocumentProfiles ? row.document_overview : null,
          documentStatus: includeDocumentProfiles ? row.document_status : 'missing',
          documentVersionId: includeDocumentProfiles ? row.document_version_id : null,
          ideaCount: row.idea_count,
          gapCount: row.gap_count,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_WORKS)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function rankedTutorRoutes(tokens: Set<string>): WritingWorkshopRouteCandidate[] {
  return listTutorRoutes()
    .map((route): Scored<WritingWorkshopRouteCandidate> => {
      const routeText = [
        route.route.title,
        route.route.description,
        route.overview,
        route.prompt,
        route.route.themes.join(' '),
        route.route.stops.map((s) => `${s.title} ${s.focus}`).join(' '),
      ].join(' ');
      const semantic = relevance(tokens, routeText);
      const support = Math.min(0.2, route.route.weight * 0.04) + (route.rating ? route.rating * 0.02 : 0);
      const score = semantic + support;
      return {
        score,
        reason: route.rating ? 'Ruta guardada y valorada por el usuario.' : 'Ruta del Tutor que ordena una línea argumental.',
        item: {
          id: route.id,
          label: route.route.title,
          summary: route.route.description,
          score,
          reason: '',
          routeTitle: route.route.title,
          mode: route.mode,
          prompt: route.prompt,
          themes: route.route.themes,
          stops: route.route.stops.length,
          rating: route.rating,
        },
      };
    })
    .sort(sortScored)
    .slice(0, MAX_ROUTES)
    .map(({ item, score, reason }) => ({ ...item, score, reason }));
}

function recommendSelection(
  brief: WritingWorkshopBrief,
  candidates: {
    ideas: WritingWorkshopIdeaCandidate[];
    themes: WritingWorkshopThemeCandidate[];
    gaps: WritingWorkshopGapCandidate[];
    contradictions: WritingWorkshopContradictionCandidate[];
    works: WritingWorkshopWorkCandidate[];
    tutorRoutes: WritingWorkshopRouteCandidate[];
  }
): WritingWorkshopSelection {
  const gapHeavy = brief.kind === 'gap_justification' || brief.kind === 'research_question';
  const debateHeavy = brief.kind === 'debate';
  return {
    ideaIds: candidates.ideas.slice(0, brief.kind === 'chapter_section' ? 14 : 10).map((i) => i.id),
    themeIds: candidates.themes.slice(0, 5).map((t) => t.id),
    gapIds: candidates.gaps.slice(0, gapHeavy ? 8 : 4).map((g) => g.id),
    contradictionIds: candidates.contradictions.slice(0, debateHeavy ? 8 : 4).map((c) => c.id),
    workIds: candidates.works.slice(0, 10).map((w) => w.id),
    passageIds: [],
    tutorRouteIds: candidates.tutorRoutes.slice(0, 2).map((r) => r.id),
  };
}

function normalizeSelection(selection: WritingWorkshopSelection, fallback: WritingWorkshopSelection): WritingWorkshopSelection {
  const clean = (items: string[] | undefined, fb: string[]) => {
    const unique = Array.from(new Set((items ?? []).filter(Boolean)));
    return unique.length > 0 ? unique : fb;
  };
  const anySelected = [
    selection.ideaIds,
    selection.themeIds,
    selection.gapIds,
    selection.contradictionIds,
    selection.workIds,
    selection.passageIds,
    selection.tutorRouteIds,
  ].some((list) => list.length > 0);
  if (!anySelected) return fallback;
  return {
    ideaIds: clean(selection.ideaIds, []),
    themeIds: clean(selection.themeIds, []),
    gapIds: clean(selection.gapIds, []),
    contradictionIds: clean(selection.contradictionIds, []),
    workIds: clean(selection.workIds, []),
    passageIds: clean(selection.passageIds, []),
    tutorRouteIds: clean(selection.tutorRouteIds, []),
  };
}

async function buildSelectedContext(brief: WritingWorkshopBrief, selection: WritingWorkshopSelection, contextRule = writingWorkshopPromptPack('es').contextRule): Promise<WorkshopContext> {
  const passages = await selectedPassagesForDraft(brief.objective, selection);
  const context = {
    brief: {
      tipo: kindLabel(brief.kind),
      objetivo: brief.objective,
      audiencia: brief.audience ?? null,
      tono: brief.tone ?? 'academic',
      lengua: brief.language ?? 'es',
    },
    ideas: selectedIdeas(selection.ideaIds),
    temas: selectedThemes(selection.themeIds),
    huecos: selectedGaps(selection.gapIds),
    contradicciones: selectedContradictions(selection.contradictionIds),
    obras: selectedWorks(selection.workIds),
    pasajes_evidencia: passages,
    rutas_tutor: selectedRoutes(selection.tutorRouteIds),
    regla: contextRule,
  };
  const raw = JSON.stringify(context);
  const truncated = raw.length > MAX_CONTEXT_CHARS;
  const payload = truncated ? trimContext(context) : context;
  const contextChars = JSON.stringify(payload).length;
  return {
    payload,
    stats: {
      selectedIdeas: context.ideas.length,
      selectedThemes: context.temas.length,
      selectedGaps: context.huecos.length,
      selectedContradictions: context.contradicciones.length,
      selectedWorks: context.obras.length,
      selectedPassages: context.pasajes_evidencia.length,
      selectedTutorRoutes: context.rutas_tutor.length,
      contextChars,
      truncated,
    },
  };
}

function selectedIdeas(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes
         FROM ideas i
         LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
         LEFT JOIN themes t ON t.theme_id = itl.theme_id
        WHERE i.global_id IN (${placeholders(ids)})
        GROUP BY i.global_id`
    )
    .all(...ids) as Array<IdeaRow>;

  const active = getSettings().academicMode === 'manual' ? activeManualIdeaIds(getDb()) : null;
  return rows.filter(row => !active || active.has(row.global_id)).map((row) => ({
    id: row.global_id,
    tipo: row.type,
    etiqueta: row.label,
    enunciado: row.statement,
    temas: splitList(row.themes),
    cita: `nodus://idea/${row.global_id}`,
    obras: ideaWorks(row.global_id).map((work) => ({
      id: work.nodus_id,
      titulo: work.title,
      autores: work.authors,
      ano: work.year,
      cita: `nodus://work/${work.nodus_id}`,
    })),
    evidencia: selectedEvidenceForIdea(row.global_id),
  }));
}

function selectedEvidenceForIdea(globalId: string) {
  const rows = getDb()
    .prepare(
      `SELECT e.quote, e.location, e.kind, w.nodus_id, w.title, w.authors_json, w.year
         FROM evidence e
         JOIN works w ON w.nodus_id = e.nodus_id
        WHERE e.global_id = ?
        ORDER BY e.kind = 'explicit' DESC, w.year DESC
        LIMIT 5`
    )
    .all(globalId) as Array<{
      quote: string;
      location: string | null;
      kind: string;
      nodus_id: string;
      title: string;
      authors_json: string;
      year: number | null;
    }>;
  return rows.map((row) => ({
    cita_textual: clip(row.quote, 600),
    localizacion: row.location,
    tipo: row.kind,
    obra: {
      id: row.nodus_id,
      titulo: row.title,
      autores: parseAuthors(row.authors_json),
      ano: row.year,
      cita: `nodus://work/${row.nodus_id}`,
    },
  }));
}

function selectedThemes(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT t.theme_id, t.label, t.pinned,
              COUNT(DISTINCT wt.nodus_id) AS work_count,
              COUNT(DISTINCT itl.global_id) AS idea_count
         FROM themes t
         LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
         LEFT JOIN idea_theme_links itl ON itl.theme_id = t.theme_id
        WHERE t.theme_id IN (${placeholders(ids)})
        GROUP BY t.theme_id`
    )
    .all(...ids) as ThemeRow[];
  return rows.map((row) => ({
    id: row.theme_id,
    etiqueta: row.label,
    curado: !!row.pinned,
    obras: row.work_count,
    ideas: row.idea_count,
    ideas_muestra: themeIdeaSample(row.theme_id),
  }));
}

function themeIdeaSample(themeId: string) {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.label, i.statement, i.type
         FROM idea_theme_links itl
         JOIN ideas i ON i.global_id = itl.global_id
        WHERE itl.theme_id = ?
        LIMIT 12`
    )
    .all(themeId) as Array<{ global_id: string; label: string; statement: string; type: IdeaType }>;
  return rows.map((row) => ({
    id: row.global_id,
    tipo: row.type,
    etiqueta: row.label,
    enunciado: clip(row.statement, 220),
    cita: `nodus://idea/${row.global_id}`,
  }));
}

function selectedGaps(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.kind, g.statement, g.related_idea, g.confidence,
              w.nodus_id, w.title, w.authors_json, w.year, w.zotero_key,
              i.label AS idea_label
         FROM gaps g
         JOIN works w ON w.nodus_id = g.nodus_id
         LEFT JOIN ideas i ON i.global_id = g.related_idea
        WHERE g.id IN (${placeholders(ids)})`
    )
    .all(...ids) as GapRow[];
  return rows.map((row) => ({
    id: row.id,
    tipo: row.kind,
    enunciado: row.statement,
    confianza: row.confidence,
    cita: `nodus://gap/${row.id}`,
    idea_relacionada: row.related_idea
      ? { id: row.related_idea, etiqueta: row.idea_label, cita: `nodus://idea/${row.related_idea}` }
      : null,
    obra: {
      id: row.nodus_id,
      titulo: row.title,
      autores: parseAuthors(row.authors_json),
      ano: row.year,
      cita: `nodus://work/${row.nodus_id}`,
    },
  }));
}

function selectedContradictions(ids: string[]) {
  const wanted = new Set(ids);
  return getContradictions()
    .filter((detail) => wanted.has(detail.edge.id))
    .map((detail) => ({
      id: detail.edge.id,
      tipo: detail.edge.type,
      base: detail.edge.basis,
      confianza: detail.edge.confidence,
      desde: detail.fromLabel,
      hacia: detail.toLabel,
      explicacion: detail.explanation,
      cita: `nodus://contradiction/${detail.edge.id}`,
      evidencia: detail.evidence.slice(0, 4).map((ev) => ({
        cita_textual: clip(ev.quote, 500),
        localizacion: ev.location,
        idea: ev.global_id,
        cita_idea: `nodus://idea/${ev.global_id}`,
      })),
    }));
}

function selectedWorks(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.deep_status,
              CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
              COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
              COUNT(DISTINCT io.global_id) AS idea_count,
              COUNT(DISTINCT g.id) AS gap_count
         FROM works w
         LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
         LEFT JOIN work_themes wt ON wt.nodus_id = w.nodus_id
         LEFT JOIN themes t ON t.theme_id = wt.theme_id
         LEFT JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
         LEFT JOIN gaps g ON g.nodus_id = w.nodus_id
        WHERE w.nodus_id IN (${placeholders(ids)})
        GROUP BY w.nodus_id`
    )
    .all(...ids) as WorkRow[];
  return rows.map((row) => ({
    id: row.nodus_id,
    titulo: row.title,
    autores: parseAuthors(row.authors_json),
    ano: row.year,
    temas: splitList(row.themes),
    estado_profundo: row.deep_status,
    ideas: row.idea_count,
    huecos: row.gap_count,
    resumen_orientacion: row.orientation_summary,
    resumen_no_citable: row.orientation_summary ? true : undefined,
    cita: `nodus://work/${row.nodus_id}`,
  }));
}

/**
 * Passage evidence is fetched only when the writer explicitly generates a
 * draft. Selected passages are honored first; then the objective retrieves a
 * small semantic set constrained to the materials the writer chose.
 */
async function selectedPassagesForDraft(
  objective: string,
  selection: WritingWorkshopSelection
): Promise<Record<string, unknown>[]> {
  const selected = selectedPassages(selection.passageIds ?? []);
  const byId = new Map(selected.map((passage) => [String(passage.id), passage]));
  if (!objective.trim()) return capPassageContext([...byId.values()]);

  try {
    const query = await embedQuery(objective.trim());
    if (!query) return capPassageContext([...byId.values()]);
    const scope = selectedWorkScope(selection);
    for (const passage of selected) {
      const work = passage.obra;
      if (work && typeof work === 'object' && 'id' in work && typeof work.id === 'string') scope.add(work.id);
    }
    const hits = await findSimilarPassagesPaged(query, 0.18, 12, scope.size ? { nodusIds: [...scope] } : {});
    for (const hit of hits) {
      if (!byId.has(hit.passage_id)) byId.set(hit.passage_id, passageContext(hit));
    }
  } catch (error) {
    console.warn('[writingWorkshop] passage evidence unavailable:', error instanceof Error ? error.message : String(error));
  }
  return capPassageContext([...byId.values()]);
}

function selectedPassages(ids: string[]): Record<string, unknown>[] {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id IN (${placeholders(ids)})
          AND w.archived = 0
          AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
            OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))
        ORDER BY p.nodus_id, p.chunk_index`
    )
    .all(...ids) as Array<Omit<SimilarPassage, 'similarity'>>;
  return rows.map((row) => passageContext({ ...row, similarity: 0 }));
}

function selectedWorkScope(selection: WritingWorkshopSelection): Set<string> {
  const ids = new Set(selection.workIds ?? []);
  const db = getDb();
  const addRows = (sql: string, values: string[]) => {
    if (values.length === 0) return;
    const rows = db.prepare(sql.replace(':ids', placeholders(values))).all(...values) as { nodus_id: string }[];
    for (const row of rows) ids.add(row.nodus_id);
  };
  addRows('SELECT DISTINCT nodus_id FROM idea_occurrences WHERE global_id IN (:ids)', selection.ideaIds ?? []);
  addRows('SELECT DISTINCT nodus_id FROM gaps WHERE id IN (:ids)', selection.gapIds ?? []);
  addRows('SELECT DISTINCT nodus_id FROM work_themes WHERE theme_id IN (:ids)', selection.themeIds ?? []);
  const contradictionIds = new Set(selection.contradictionIds ?? []);
  for (const detail of getContradictions()) {
    if (!contradictionIds.has(detail.edge.id)) continue;
    for (const evidence of detail.evidence) ids.add(evidence.nodus_id);
  }
  return ids;
}

function passageContext(hit: SimilarPassage): Record<string, unknown> {
  return {
    id: hit.passage_id,
    texto: hit.text,
    localizacion: hit.page_label,
    obra: {
      id: hit.nodus_id,
      titulo: hit.title,
      autores: parseAuthors(hit.authors_json),
      ano: hit.year,
      zotero_key: hit.zotero_key,
    },
    cita: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
  };
}

function capPassageContext(passages: Record<string, unknown>[]): Record<string, unknown>[] {
  let chars = 0;
  const result: Record<string, unknown>[] = [];
  for (const passage of passages) {
    const text = typeof passage.texto === 'string' ? passage.texto : '';
    const remaining = MAX_PASSAGE_CONTEXT_CHARS - chars;
    if (remaining <= 0) break;
    const clipped = clip(text, remaining);
    if (!clipped) continue;
    chars += clipped.length;
    result.push({ ...passage, texto: clipped, recortado: clipped.length < text.length });
  }
  return result;
}

function selectedRoutes(ids: string[]) {
  const wanted = new Set(ids);
  return listTutorRoutes()
    .filter((route) => wanted.has(route.id))
    .map((route) => ({
      id: route.id,
      titulo: route.route.title,
      descripcion: route.route.description,
      modo: route.mode,
      objetivo: route.prompt,
      temas: route.route.themes,
      peso: route.route.weight,
      paradas: route.route.stops.map((stop) => ({
        titulo: stop.title,
        foco: stop.focus,
        tipo: stop.kind,
        nodos: stop.nodeIds,
        conexion: stop.edgeId,
      })),
    }));
}

function trimContext<T extends Record<string, any>>(context: T): T {
  return {
    ...context,
    ideas: context.ideas
      .slice(0, 96)
      .map((idea: any) => ({ ...idea, obras: idea.obras?.slice(0, 3) ?? [], evidencia: idea.evidencia?.slice(0, 2) ?? [] })),
    temas: context.temas.slice(0, 18).map((theme: any) => ({ ...theme, ideas_muestra: theme.ideas_muestra?.slice(0, 8) ?? [] })),
    huecos: context.huecos.slice(0, 20),
    contradicciones: context.contradicciones.slice(0, 16),
    obras: context.obras.slice(0, 42),
    pasajes_evidencia: context.pasajes_evidencia
      .slice(0, 12)
      .map((passage: any) => ({ ...passage, texto: clip(String(passage.texto ?? ''), 1800) })),
    rutas_tutor: context.rutas_tutor.slice(0, 4).map((route: any) => ({ ...route, paradas: route.paradas.slice(0, 22) })),
  };
}

function sanitizeDraft(
  ai: AiWorkshopResult,
  brief: WritingWorkshopBrief,
  selection: WritingWorkshopSelection,
  context: WorkshopContext,
  copy: WritingWorkshopFallbackCopy,
): WritingWorkshopDraft {
  const citationPolicy = workshopCitationPolicy(context);
  const substantial = ensureSubstantialMarkdown(cleanString(ai.draftMarkdown, ''), brief, context, copy);
  const primary = sanitizeWorkshopCitationText(substantial, citationPolicy, copy);
  // An invented or ambiguous target means the sentence that contains it is not
  // demonstrably grounded. The deterministic fallback is preferable to keeping
  // polished prose whose evidence boundary the provider crossed.
  if (primary.unsupported > 0 || (citationPolicy.keys.size > 0 && primary.refs === 0)) {
    return structuralFallback(brief, selection, context, copy);
  }
  const draftMarkdown = primary.text;
  const outline = sanitizeOutline(ai.outline, copy).map((section) => ({
    ...section,
    purpose: sanitizeWorkshopCitationText(section.purpose, citationPolicy, copy).text,
    keyClaims: section.keyClaims.map((claim) => sanitizeWorkshopCitationText(claim, citationPolicy, copy).text),
    sources: section.sources
      .map((source) => sanitizeWorkshopCitationText(source, citationPolicy, copy).text)
      .filter(Boolean),
  }));
  const matrix = sanitizeMatrix(ai.matrix)
    .map((row) => {
      const citation = canonicalWorkshopCitation(row.citation, citationPolicy);
      if (!citation) return null;
      return {
        ...row,
        claim: sanitizeWorkshopCitationText(row.claim, citationPolicy, copy).text,
        sourceLabel: citationLabelForUrl(citation, copy) ?? row.sourceLabel,
        citation,
        evidence: sanitizeWorkshopCitationText(row.evidence, citationPolicy, copy).text,
        notes: sanitizeWorkshopCitationText(row.notes, citationPolicy, copy).text,
      };
    })
    .filter((row): row is WritingWorkshopMatrixRow => row !== null);
  return {
    generatedAt: new Date().toISOString(),
    brief,
    selection,
    title: cleanString(ai.title, copy.titleFallback),
    abstract: sanitizeWorkshopCitationText(cleanString(ai.abstract, ''), citationPolicy, copy).text,
    outline,
    draftMarkdown,
    matrix,
    bibliography: stringList(ai.bibliography),
    nextSteps: stringList(ai.nextSteps).map((item) => sanitizeWorkshopCitationText(item, citationPolicy, copy).text),
    limitations: stringList(ai.limitations).map((item) => sanitizeWorkshopCitationText(item, citationPolicy, copy).text),
    stats: context.stats,
  };
}

function structuralFallback(
  brief: WritingWorkshopBrief,
  selection: WritingWorkshopSelection,
  context: WorkshopContext,
  copy: WritingWorkshopFallbackCopy,
): WritingWorkshopDraft {
  const payload = context.payload as any;
  const title = `${writingWorkshopPromptPack(getSettings().promptLanguage ?? 'es').kindLabels[brief.kind] ?? brief.kind}: ${brief.objective || 'borrador'}`;
  const ideas = (payload.ideas ?? []) as any[];
  const gaps = (payload.huecos ?? []) as any[];
  const contradictions = (payload.contradicciones ?? []) as any[];
  const works = (payload.obras ?? []) as any[];
  const passages = (payload.pasajes_evidencia ?? []) as any[];
  const outline: WritingWorkshopSection[] = [
    {
      id: 's0',
      title: copy.evidenceTitle,
      purpose: copy.evidencePurpose,
      keyClaims: passages.slice(0, 3).map((passage) => passage.texto),
      sources: passages.slice(0, 3).map((passage) => citationMarkdown(passage.obra, passage.cita)),
    },
    {
      id: 's1',
      title: copy.planningTitle,
      purpose: copy.planningPurpose,
      keyClaims: ideas.slice(0, 3).map((i) => i.enunciado),
      sources: ideas.slice(0, 3).map((i) => citationMarkdown(i.obras?.[0], i.cita)),
    },
    {
      id: 's2',
      title: copy.debateTitle,
      purpose: copy.debatePurpose,
      keyClaims: contradictions.slice(0, 3).map((c) => c.explicacion ?? `${c.desde} / ${c.hacia}`),
      sources: contradictions.slice(0, 3).map((c) => `[${copy.contradictionCitationLabel}](nodus://contradiction/${c.id})`),
    },
    {
      id: 's3',
      title: copy.gapTitle,
      purpose: copy.gapPurpose,
      keyClaims: gaps.slice(0, 3).map((g) => g.enunciado),
      sources: gaps.slice(0, 3).map((g) => `[${copy.gapCitationLabel}](nodus://gap/${g.id})`),
    },
  ];
  const matrix: WritingWorkshopMatrixRow[] = [
    ...ideas.slice(0, 8).map((idea): WritingWorkshopMatrixRow => ({
      claim: idea.enunciado,
      role: 'support',
      sourceLabel: sourceLabel(idea.obras?.[0], copy),
      citation: idea.cita,
      evidence: idea.evidencia?.[0]?.cita_textual ?? copy.ideaEvidence,
      notes: copy.centralSupport,
    })),
    ...gaps.slice(0, 5).map((gap): WritingWorkshopMatrixRow => ({
      claim: gap.enunciado,
      role: 'gap',
      sourceLabel: sourceLabel(gap.obra, copy),
      citation: gap.cita,
      evidence: copy.gapEvidence,
      notes: copy.contributionSupport,
    })),
    ...passages.slice(0, 10).map((passage): WritingWorkshopMatrixRow => ({
      claim: clip(passage.texto, 220),
      role: 'support',
      sourceLabel: sourceLabel(passage.obra, copy),
      citation: passage.cita,
      evidence: passage.texto,
      notes: passage.localizacion ? copy.literalEvidenceWithLocation(passage.localizacion) : copy.literalEvidence,
    })),
  ];
  const draftMarkdown = [
    `## ${title}`,
    '',
    `## ${copy.planningHeading}`,
    ideas.length ? narrativeParagraph(ideas.slice(0, 5), copy.lineFirst, copy) : copy.noIdeas,
    '',
    `## ${copy.evidenceHeading}`,
    passages.length
      ? passages
          .slice(0, 5)
          .map((passage) => copy.evidenceSentence(passage.texto, citationMarkdown(passage.obra, passage.cita)))
          .join('\n\n')
      : copy.noPassages,
    '',
    `## ${copy.linesHeading}`,
    ...ideaDevelopmentSections(ideas.slice(5), copy),
    '',
    `## ${copy.debateHeading}`,
    contradictions.length
      ? contradictions
          .slice(0, 4)
          .map(
            (c) =>
              copy.relationSentence(c.desde, c.hacia, c.explicacion ?? `${c.desde} / ${c.hacia}`, c.cita)
          )
          .join('\n\n')
      : copy.noContradictions,
    '',
    `## ${copy.gapHeading}`,
    gaps.length
      ? gaps
          .slice(0, 5)
          .map((g) => copy.gapSentence(g.enunciado, g.cita))
          .join('\n\n')
      : copy.noGaps,
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    brief,
    selection,
    title,
    abstract: copy.abstract,
    outline,
    draftMarkdown,
    matrix,
    bibliography: works.map((w) => `${sourceLabel(w, copy)}. ${w.titulo}.`),
    nextSteps: [copy.nextStep],
    limitations: [copy.limitation],
    stats: context.stats,
  };
}

function sanitizeOutline(items: AiWorkshopResult['outline'], copy: WritingWorkshopFallbackCopy): WritingWorkshopSection[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 12).map((item, index) => ({
    id: cleanString(item.id, `s${index + 1}`),
    title: cleanString(item.title, `${copy.lineHeading(index + 1)}`),
    purpose: cleanString(item.purpose, ''),
    keyClaims: stringList(item.keyClaims).slice(0, 12),
    sources: stringList(item.sources).slice(0, 12),
  }));
}

function sanitizeMatrix(items: AiWorkshopResult['matrix']): WritingWorkshopMatrixRow[] {
  if (!Array.isArray(items)) return [];
  const roles = new Set<WritingWorkshopMatrixRow['role']>(['support', 'contrast', 'gap', 'method', 'definition', 'context']);
  return items.slice(0, 90).map((item) => {
    const role = roles.has(item.role as WritingWorkshopMatrixRow['role'])
      ? (item.role as WritingWorkshopMatrixRow['role'])
      : 'support';
    return {
      claim: cleanString(item.claim, ''),
      role,
      sourceLabel: cleanString(item.sourceLabel, ''),
      citation: cleanString(item.citation, ''),
      evidence: cleanString(item.evidence, ''),
      notes: cleanString(item.notes, ''),
    };
  });
}

function ensureSubstantialMarkdown(
  draftMarkdown: string,
  brief: WritingWorkshopBrief,
  context: WorkshopContext,
  copy: WritingWorkshopFallbackCopy,
): string {
  const clean = draftMarkdown.trim();
  const payload = context.payload as any;
  const ideas = ((payload.ideas ?? []) as any[]).filter((idea) => idea?.enunciado);
  const gaps = ((payload.huecos ?? []) as any[]).filter((gap) => gap?.enunciado);
  const contradictions = ((payload.contradicciones ?? []) as any[]).filter((item) => item?.desde || item?.hacia || item?.explicacion);
  const minimumChars = ideas.length >= 20 ? 9000 : ideas.length >= 8 ? 5500 : 2600;
  if (clean.length >= minimumChars || ideas.length === 0) return clean;

  const supplement = [
    '',
    `## ${copy.expandedIdeasHeading}`,
    copy.objectiveIntroduction(writingWorkshopPromptPack(getSettings().promptLanguage ?? 'es').kindLabels[brief.kind] ?? brief.kind, narrativeParagraph(
      ideas.slice(0, 5),
      copy.lineFirst,
      copy,
    )),
    '',
    ...ideaDevelopmentSections(ideas.slice(5), copy),
    gaps.length ? `## ${copy.contributionGapsHeading}` : '',
    gaps.length
      ? gaps
          .slice(0, 6)
          .map((gap) => copy.specificQuestion(gap.enunciado, gap.cita))
          .join('\n\n')
      : '',
    contradictions.length ? `## ${copy.interpretiveTensionsHeading}` : '',
    contradictions.length
      ? contradictions
          .slice(0, 5)
          .map(
            (item) =>
              copy.relationSentence(item.desde ?? 'una idea', item.hacia ?? 'otra idea', item.explicacion ?? 'hay una tension registrada en el grafo', item.cita)
          )
          .join('\n\n')
      : '',
  ].filter(Boolean);

  return [clean, ...supplement].join('\n');
}

function ideaDevelopmentSections(ideas: any[], copy: WritingWorkshopFallbackCopy): string[] {
  const sections: string[] = [];
  let sectionNumber = 1;
  for (let i = 0; i < ideas.length; i += 5) {
    const chunk = ideas.slice(i, i + 5);
    if (chunk.length === 0) continue;
    const isFirst = sectionNumber === 1;
    sections.push(`### ${copy.lineHeading(sectionNumber)}`);
    sections.push(narrativeParagraph(chunk, isFirst ? copy.lineFirst : copy.lineContinue, copy));
    sections.push('');
    sectionNumber += 1;
  }
  return sections;
}

function narrativeParagraph(ideas: any[], opener: string, copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback): string {
  const clauses = ideas
    .filter((idea) => idea?.enunciado)
    .map((idea) => `${idea.enunciado} ${citationMarkdown(idea.obras?.[0], idea.cita)}`);
  if (clauses.length === 0) return copy.noIdeasLine;
  if (clauses.length === 1) return `${opener} ${clauses[0]}.`;
  const [first, ...rest] = clauses;
  return `${opener} ${first}. ${copy.narrativeConnection} ${rest.join('; ' + copy.narrativeConnection.toLowerCase() + ' ')}. ${copy.narrativeConclusion}`;
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(',');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
  );
}

function relevance(tokens: Set<string>, text: string): number {
  if (tokens.size === 0) return 0;
  const hay = tokenize(text);
  let hits = 0;
  for (const token of tokens) if (hay.has(token)) hits += 1;
  return Math.min(0.55, hits / Math.max(4, tokens.size));
}

function reasonFor(score: number, support: number, semantic: number): string {
  if (semantic >= support) return 'Coincide con el objetivo escrito.';
  if (score > 0.22) return 'Material conectado y con soporte en el corpus.';
  return 'Candidato con señales útiles para el borrador.';
}

function sortScored<T extends WritingWorkshopCandidateBase>(a: Scored<T>, b: Scored<T>): number {
  return b.score - a.score || a.item.label.localeCompare(b.item.label, 'es');
}

function parseAuthors(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function splitList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clip(text: string, max = 240): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim())
    : [];
}

type CitationWork = { autores?: string[]; authors?: string[]; ano?: number | null; year?: number | null };

const citationLabelCache = new Map<string, string | null>();

interface WorkshopCitationPolicy {
  refs: ReturnType<typeof extractCitationRefs>;
  keys: Set<string>;
}

function workshopCitationPolicy(context: WorkshopContext): WorkshopCitationPolicy {
  const refs = extractCitationRefs(JSON.stringify(context.payload));
  return { refs, keys: new Set(refs.map((ref) => `${ref.kind}:${ref.id}`)) };
}

function sanitizeWorkshopCitationText(
  text: string,
  policy: WorkshopCitationPolicy,
  copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback,
): { text: string; refs: number; unsupported: number } {
  const repaired = alignCitationKindsToAllowed(repairLooseCitations(text ?? ''), policy.refs);
  const canonical = canonicalizeCitationLinks(repaired);
  const refs = extractCitationRefs(canonical);
  const unsupported = refs.filter((ref) => !policy.keys.has(`${ref.kind}:${ref.id}`)).length;
  const sanitized = normalizeCitationLabels(stripDisallowedCitations(canonical, policy.keys), copy);
  return { text: sanitized, refs: extractCitationRefs(sanitized).length, unsupported };
}

function canonicalWorkshopCitation(citation: string, policy: WorkshopCitationPolicy): string | null {
  const repaired = alignCitationKindsToAllowed(repairLooseCitations(citation ?? ''), policy.refs);
  const ref = extractCitationRefs(canonicalizeCitationLinks(repaired))
    .find((candidate) => policy.keys.has(`${candidate.kind}:${candidate.id}`));
  return ref ? citationUrl(ref) : null;
}

function sourceLabel(work: CitationWork | undefined, copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback): string {
  if (!work) return copy.sourceFallback;
  const authors = 'autores' in work ? work.autores : work.authors;
  const year = 'ano' in work ? work.ano : work.year;
  return authorYearLabel(authors?.[0], year, copy);
}

/** Convert Nodus's stored `Apellido, I.` name into a readable inline citation. */
function authorYearLabel(author: string | undefined, year: number | null | undefined, copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback): string {
  const raw = author?.replace(/\s+/g, ' ').trim();
  if (!raw) return copy.authorFallback(year ?? null);

  const comma = raw.indexOf(',');
  const surname = (comma >= 0 ? raw.slice(0, comma) : raw.split(' ').slice(-1).join(' ')).trim() || raw;
  const given = (comma >= 0 ? raw.slice(comma + 1) : raw.split(' ').slice(0, -1).join(' ')).trim();
  const initial = given.match(/[\p{L}]/u)?.[0]?.toLocaleUpperCase('es-ES');
  const name = initial ? `${surname}, ${initial}.` : surname;
  return year ? `${name} (${year})` : name;
}

/** Resolve a Nodus citation to its canonical source label. */
function citationLabelForUrl(citation: string, copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback): string | null {
  const cached = citationLabelCache.get(citation);
  if (cached !== undefined) return cached;

  const match = citation.match(/^nodus:\/\/(idea|work|passage|gap|contradiction)\/(.+)$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return null;
  }

  if (match[1] === 'gap' || match[1] === 'contradiction') {
    const label = match[1] === 'gap' ? copy.gapCitationLabel : copy.contradictionCitationLabel;
    citationLabelCache.set(citation, label);
    return label;
  }

  const db = getDb();
  let row: { authors_json: string; year: number | null } | undefined;
  if (match[1] === 'passage') {
    const passage = db
      .prepare(
        `SELECT w.authors_json, w.year, p.page_label
           FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.passage_id = ?`
      )
      .get(id) as { authors_json: string; year: number | null; page_label: string | null } | undefined;
    const label = passage
      ? `${sourceLabel({ authors: parseAuthors(passage.authors_json), year: passage.year }, copy)}${passage.page_label ? `, ${passage.page_label}` : ''}`
      : null;
    citationLabelCache.set(citation, label);
    return label;
  }
  if (match[1] === 'work') {
    row = db
      .prepare('SELECT authors_json, year FROM works WHERE nodus_id = ?')
      .get(id) as typeof row;
  } else {
    row = db
      .prepare(
        `SELECT w.authors_json, w.year
           FROM idea_occurrences io
           JOIN works w ON w.nodus_id = io.nodus_id
          WHERE io.global_id = ? AND w.archived = 0
          ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
          LIMIT 1`
      )
      .get(id) as typeof row;
  }
  const label = row ? sourceLabel({ authors: parseAuthors(row.authors_json), year: row.year }, copy) : null;
  citationLabelCache.set(citation, label);
  return label;
}

/** Never display a model-invented or abbreviated label when its nodus target is known. */
function normalizeCitationLabels(markdown: string, copy: WritingWorkshopFallbackCopy = writingWorkshopPromptPack('es').fallback): string {
  return markdown.replace(/\[([^\]]*)\]\((nodus:\/\/(?:idea|work|passage|gap|contradiction)\/[^)]+)\)/g, (full, _label: string, citation: string) => {
    const label = citationLabelForUrl(citation, copy);
    return label ? `[${label}](${citation})` : full;
  });
}

function citationMarkdown(work: any, fallbackCitation: string): string {
  return `[${sourceLabel(work)}](${fallbackCitation})`;
}

function kindLabel(kind: WritingWorkshopBrief['kind']): string {
  switch (kind) {
    case 'literature_review':
      return 'estado de la cuestion';
    case 'theoretical_framework':
      return 'marco teorico';
    case 'debate':
      return 'debate entre autores';
    case 'gap_justification':
      return 'justificacion de hueco';
    case 'chapter_section':
      return 'apartado de capitulo';
    case 'research_question':
      return 'pregunta o hipotesis de investigacion';
    case 'deep_research':
      return 'informe de investigacion en profundidad';
  }
}

const STOP_WORDS = new Set([
  'para',
  'como',
  'sobre',
  'entre',
  'desde',
  'hacia',
  'este',
  'esta',
  'estos',
  'estas',
  'cada',
  'cual',
  'cuales',
  'donde',
  'cuando',
  'porque',
  'pero',
  'tambien',
  'with',
  'that',
  'this',
  'from',
  'dans',
  'avec',
  'pour',
]);
