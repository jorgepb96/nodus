import {createImmersionAIDependencies, IMMERSION_PROMPT_LANGUAGES} from '@shared/immersionGeneration';
import { createHash } from 'node:crypto';
export {immersionPromptPack, IMMERSION_PROMPT_PACKS} from '@shared/immersionGeneration';
import { withJobThinkingEffort } from './thinkingEffort';
import { generationSignal } from './generationSignal';
import { withDocumentVisualPlanning, withoutDocumentVisualPlanning } from './documentVisualContext';
import { documentSkillCatalog, documentVisualProgressLabel } from '../../shared/documentSkills';
import { listDocumentSkills } from '../capabilities/documentCatalog';
import { prepareDocumentVisualHints, enrichDocumentVisuals } from './documentVisuals';
import type {
  GraphData,
  ImmersionAnswerRecord,
  ImmersionAnswerRequest,
  ImmersionAnswerResult,
  ImmersionBuildProgress,
  ImmersionQuizQuestion,
  ImmersionRequest,
  ImmersionScope,
  ImmersionScopeRequest,
  ImmersionSession,
  ModelRef,
  PromptLanguage,
  WritingWorkshopIdeaCandidate,
} from '@shared/types';
import { getDb } from '../db/database';
import { parseBylineEntry } from '../db/authorsRepo';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import { buildIdeaGraph, getContradictions } from '../graph/graphService';
import { getImmersionSession, recordImmersionAnswer, saveImmersionSession } from '../db/immersionRepo';
import { buildWritingWorkshopSnapshot } from './writingWorkshop';
import { completeJson, embed } from './aiClient';
import { ResearchCorpusRun, resolveAcademicRunScope } from './researchCorpusRun';
import { RETRIEVAL_PRESETS } from '@shared/researchCorpus';
import {
  IMMERSION_LIMITS,
  orchestrateImmersion,
  buildCitationCatalog,
  resolveStationCount,
  labels,
  type ImmersionDeps,
  type ImmersionMaterial,
  type MaterialAuthor,
  type MaterialIdea,
  type MaterialPassage,
} from './immersionCore';

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Inmersión. The control flow lives in ./immersionCore; here
// we assemble the topic material from embeddings + graph (no AI) and bind the
// injected AI dependencies to real provider calls.
// ─────────────────────────────────────────────────────────────────────────────

// Relevance cutoffs that separate "the topic" from "the rest of the corpus".
// Scores come from writingWorkshop's semanticStrength (cosine clamped to [0, 0.65]).
const IDEA_SCORE_CUT = 0.28;
const IDEA_MIN_KEEP = 16;
const IDEA_MAX_KEEP = 60;
const PASSAGE_SCORE_CUT = 0.25;
const PASSAGE_MAX_KEEP = 24;
const WORK_MAX_KEEP = 40;
const DOCUMENT_WORK_MAX_KEEP = 20;
const GAP_SCORE_CUT = 0.2;

/** Let the event loop breathe between heavy synchronous steps (queries + graph build). */
function yieldLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ\s,.-]/gi, '')
    .trim();
}

/** Map a display name from works.authors_json to a canonical author row when unambiguous. */
function buildAuthorResolver(): (name: string) => string | null {
  const rows = getDb().prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[];
  const exact = new Map<string, string[]>();
  const byLastInitial = new Map<string, string[]>();
  for (const row of rows) {
    const norm = normalizeName(row.name);
    exact.set(norm, [...(exact.get(norm) ?? []), row.author_id]);
    const [last, first] = norm.split(',').map((s) => s.trim());
    if (last) {
      const key = `${last}::${(first ?? '').charAt(0)}`;
      byLastInitial.set(key, [...(byLastInitial.get(key) ?? []), row.author_id]);
    }
  }
  return (name: string) => {
    const norm = normalizeName(name);
    const hitExact = exact.get(norm);
    if (hitExact?.length === 1) return hitExact[0];
    // "Given Surname" display order → try surname + first initial.
    const parts = norm.replace(',', ' ').split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const candidates = [
        `${parts[parts.length - 1]}::${parts[0].charAt(0)}`, // Given Surname
        `${parts[0]}::${(parts[1] ?? '').charAt(0)}`, // Surname, Given
      ];
      for (const key of candidates) {
        const hit = byLastInitial.get(key);
        if (hit?.length === 1) return hit[0];
      }
    }
    return null;
  };
}

/** Who an idea can be attributed to: the authors of the works it occurs in, never
 *  the editors of the volumes those works appear in. */
function ideaAuthors(idea: WritingWorkshopIdeaCandidate): string[] {
  const names = idea.works
    .flatMap((w) => w.authors)
    .map((entry) => parseBylineEntry(entry))
    .filter((entry) => entry.role === 'author')
    .map((entry) => entry.display);
  return [...new Set(names)];
}

/**
 * Lexical passage retrieval for corpora without a usable embedding index:
 * score passages of the topic's works by how many topic tokens they contain.
 */
function lexicalPassageFallback(topic: string, workIds: string[]): { id: string; score: number }[] {
  const tokens = [
    ...new Set(
      topic
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-zñç0-9]+/i)
        .filter((tk) => tk.length > 3)
    ),
  ].slice(0, 6);
  if (tokens.length === 0 || workIds.length === 0) return [];
  const hitsExpr = tokens.map(() => `(CASE WHEN instr(lower(p.text), ?) > 0 THEN 1 ELSE 0 END)`).join(' + ');
  const rows = getDb()
    .prepare(
      `SELECT passage_id, hits FROM (
         SELECT p.passage_id, (${hitsExpr}) AS hits
           FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.nodus_id IN (${workIds.map(() => '?').join(',')})
            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))
       ) WHERE hits > 0
       ORDER BY hits DESC
       LIMIT ?`
    )
    .all(...tokens, ...workIds, PASSAGE_MAX_KEEP) as { passage_id: string; hits: number }[];
  return rows.map((row) => ({ id: row.passage_id, score: Math.min(0.5, (row.hits / tokens.length) * 0.5) }));
}

/**
 * Assemble everything the orchestrator needs about one topic. Pure retrieval:
 * embeddings rank the corpus, the graph provides edges/debates, the passages
 * table provides the REAL full text. The scope preview only retrieves stored
 * material; generation also grants bounded research and original-file access.
 */
export async function buildImmersionMaterial(
  topic: string,
  language: PromptLanguage = normalizeImmersionLanguage(getSettings().promptLanguage),
  researchModel?: ModelRef | null,
  options: {lexicalOnly?: boolean} = {},
): Promise<ImmersionMaterial> {
  const query = topic.trim();
  const research = options.lexicalOnly || researchModel === undefined ? null : new ResearchCorpusRun(resolveAcademicRunScope(), RETRIEVAL_PRESETS.balanced);
  const vector = options.lexicalOnly ? null : await embed(query);
  const snapshot = await buildWritingWorkshopSnapshot({ kind: 'deep_research', objective: query }, [], {lexicalOnly:options.lexicalOnly});
  await yieldLoop();

  // ── Ideas: relevance-gated so an afternoon stays on-topic, never the whole corpus.
  const rankedIdeas = [...snapshot.ideas].sort((a, b) => b.score - a.score);
  let scopedIdeas = rankedIdeas.filter((idea) => idea.score >= IDEA_SCORE_CUT);
  if (scopedIdeas.length < IDEA_MIN_KEEP) {
    scopedIdeas = rankedIdeas.filter((idea) => idea.score > 0).slice(0, IDEA_MIN_KEEP);
  }
  scopedIdeas = scopedIdeas.slice(0, IDEA_MAX_KEEP);

  const ideas: MaterialIdea[] = scopedIdeas.map((idea) => ({
    id: idea.id,
    type: idea.type,
    label: idea.label,
    statement: idea.statement,
    score: idea.score,
    themes: idea.themes,
    authors: ideaAuthors(idea),
    works: idea.works.map((w) => ({ nodusId: w.nodus_id, title: w.title, year: w.year, zoteroKey: w.zotero_key ?? null })),
  }));
  const ideaIds = new Set(ideas.map((i) => i.id));

  // ── Passages: keep the strongest hits, then re-read the FULL stored text.
  let passageCandidates: { id: string; score: number }[] = snapshot.passages
    .filter((p) => p.score >= PASSAGE_SCORE_CUT)
    .slice(0, PASSAGE_MAX_KEEP)
    .map((p) => ({ id: p.id, score: p.score }));
  if (passageCandidates.length === 0 && ideas.length) {
    // No semantic hits (e.g. no embedding key): fall back to a lexical scan
    // scoped to the topic's works so the immersion still gets literal quotes.
    const scopedWorkIds = [...new Set(ideas.flatMap((i) => i.works.map((w) => w.nodusId)))].slice(0, WORK_MAX_KEEP);
    passageCandidates = lexicalPassageFallback(query, scopedWorkIds);
  }
  const passages: MaterialPassage[] = [];
  if (passageCandidates.length) {
    const rows = getDb()
      .prepare(
        `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, w.title, w.authors_json, w.year, w.zotero_key
           FROM passages p
           JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.passage_id IN (${passageCandidates.map(() => '?').join(',')})
            AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
              OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))`
      )
      .all(...passageCandidates.map((p) => p.id)) as {
      passage_id: string;
      nodus_id: string;
      text: string;
      page_label: string | null;
      title: string;
      authors_json: string | null;
      year: number | null;
      zotero_key: string | null;
    }[];
    const scoreById = new Map(passageCandidates.map((p) => [p.id, p.score] as const));
    for (const row of rows) {
      let authors: string[] = [];
      try {
        authors = JSON.parse(row.authors_json || '[]');
      } catch {
        /* ignore */
      }
      passages.push({
        id: row.passage_id,
        workId: row.nodus_id,
        workTitle: row.title || ({ es: '(sin título)', en: '(untitled)', fr: '(sans titre)', de: '(ohne Titel)', pt: '(sem título)', 'pt-BR': '(sem título)', it: '(senza titolo)', tr: '(başlıksız)', 'zh-Hans': '（无标题）', 'zh-Hant': '（無標題）', vi: '(không có tiêu đề)', ja: '（無題）', ru: '(без названия)', uk: '(без назви)', ko: '(제목 없음)' } satisfies Record<PromptLanguage, string>)[language],
        authors,
        year: row.year,
        zoteroKey: row.zotero_key,
        pageLabel: row.page_label,
        text: row.text,
        score: scoreById.get(row.passage_id) ?? 0,
      });
    }
    passages.sort((a, b) => b.score - a.score);
  }
  if (research) {
    await research.investigate(query, researchModel);
    // Keep the existing topic ranking, profiles and graph. Shared retrieval adds
    // indexed documents and original pages (local or Zotero MCP) with resolvable
    // citation receipts. Abstracts and generated notes are not literal sources.
    const seen = new Set(passages.map(passage => JSON.stringify([passage.workId, passage.text, passage.pageLabel])));
    for (const passage of research.evidence.values()) {
      if (passage.reason !== 'source') continue;
      const key = JSON.stringify([passage.nodus_id, passage.summary, passage.pageLabel]);
      if (seen.has(key)) continue;
      seen.add(key);
      passages.push({ id: passage.id, workId: passage.nodus_id, workTitle: passage.label, authors: passage.authors,
        year: passage.year, zoteroKey: passage.zotero_key || null, pageLabel: passage.pageLabel, text: passage.summary, score: passage.score });
    }
    passages.sort((a, b) => b.score - a.score);
    passages.splice(PASSAGE_MAX_KEEP);
  }
  await yieldLoop();

  // ── Works: union of the scoped ideas' works and the strongest passage works.
  const workScore = new Map<string, number>();
  const workMeta = new Map<string, { title: string; authors: string[]; year: number | null; zoteroKey: string | null; orientation: string | null }>();
  const ideaCountByWork = new Map<string, number>();
  for (const idea of ideas) {
    for (const work of idea.works) {
      workMeta.set(work.nodusId, { title: work.title, authors: [], year: work.year, zoteroKey: work.zoteroKey, orientation: null });
      workScore.set(work.nodusId, Math.max(workScore.get(work.nodusId) ?? 0, idea.score));
      ideaCountByWork.set(work.nodusId, (ideaCountByWork.get(work.nodusId) ?? 0) + 1);
    }
  }
  for (const passage of passages) {
    if (!workMeta.has(passage.workId)) {
      workMeta.set(passage.workId, { title: passage.workTitle, authors: passage.authors, year: passage.year, zoteroKey: passage.zoteroKey, orientation: null });
    }
    workScore.set(passage.workId, Math.max(workScore.get(passage.workId) ?? 0, passage.score));
  }
  // Macro profiles are a genuine third lane. Previously Immersion prepared them
  // and then threw them away unless the same work also happened to own a top idea
  // or passage, which made the preparation phase a no-op in measured scopes.
  for (const work of snapshot.works
    .filter((candidate) => candidate.documentStatus === 'current' && candidate.documentOverview)
    .slice(0, DOCUMENT_WORK_MAX_KEEP)) {
    const previous = workMeta.get(work.id);
    workMeta.set(work.id, {
      title: work.title,
      authors: work.authors,
      year: work.year,
      zoteroKey: work.zotero_key ?? null,
      orientation: work.documentOverview ?? null,
    });
    workScore.set(work.id, Math.max(workScore.get(work.id) ?? 0, work.score));
    if (previous?.orientation) workMeta.get(work.id)!.orientation = previous.orientation;
  }
  // Fill author lists from the snapshot works pool (it has them parsed already).
  const snapshotWorkById = new Map(snapshot.works.map((w) => [w.id, w] as const));
  const works = [...workMeta.entries()]
    .map(([nodusId, meta]) => {
      const fromSnapshot = snapshotWorkById.get(nodusId);
      return {
        nodusId,
        title: fromSnapshot?.title ?? meta.title,
        authors: fromSnapshot?.authors?.length ? fromSnapshot.authors : meta.authors,
        year: fromSnapshot?.year ?? meta.year,
        zoteroKey: (fromSnapshot?.zotero_key ?? meta.zoteroKey) || null,
        score: workScore.get(nodusId) ?? 0,
        ideaCount: ideaCountByWork.get(nodusId) ?? 0,
        orientation: meta.orientation,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, WORK_MAX_KEEP);

  // ── Authors: aggregated from the scoped material, resolved to canonical ids when possible.
  const resolveAuthor = buildAuthorResolver();
  const authorAgg = new Map<string, { ideaCount: number; works: Set<string> }>();
  for (const idea of ideas) {
    for (const name of idea.authors) {
      const agg = authorAgg.get(name) ?? { ideaCount: 0, works: new Set<string>() };
      agg.ideaCount += 1;
      for (const w of idea.works) agg.works.add(w.nodusId);
      authorAgg.set(name, agg);
    }
  }
  const authors: MaterialAuthor[] = [...authorAgg.entries()]
    .map(([name, agg]) => ({
      authorId: resolveAuthor(name),
      name,
      ideaCount: agg.ideaCount,
      workCount: agg.works.size,
    }))
    .sort((a, b) => b.ideaCount - a.ideaCount);
  await yieldLoop();

  // ── Edges among scoped ideas (for the station graph excerpts and debates).
  const idList = [...ideaIds];
  const edgeRows = idList.length
    ? (getDb()
        .prepare(
          `SELECT id, from_id, to_id, type FROM visible_edges
            WHERE from_id IN (${idList.map(() => '?').join(',')})
              AND to_id IN (${idList.map(() => '?').join(',')})`
        )
        .all(...idList, ...idList) as { id: string; from_id: string; to_id: string; type: string }[])
    : [];
  const edges = edgeRows.map((e) => ({ id: e.id, source: e.from_id, target: e.to_id, type: e.type }));

  const ideaLabelById = new Map(ideas.map((i) => [i.id, i.label] as const));
  const debates = getContradictions()
    .filter((d) => ideaIds.has(d.edge.from_id) && ideaIds.has(d.edge.to_id))
    .map((d) => ({
      edgeId: d.edge.id,
      fromIdeaId: d.edge.from_id,
      toIdeaId: d.edge.to_id,
      fromLabel: d.fromLabel || ideaLabelById.get(d.edge.from_id) || '',
      toLabel: d.toLabel || ideaLabelById.get(d.edge.to_id) || '',
      type: d.edge.type,
    }));

  // ── Gaps relevant to the topic (already ranked against the objective).
  const gaps = snapshot.gaps
    .filter((g) => g.score >= GAP_SCORE_CUT)
    .slice(0, IMMERSION_LIMITS.frontiers)
    .map((g) => ({ id: g.id, kind: g.kind, statement: g.summary || g.label, workTitle: g.work?.title ?? null, score: g.score }));

  const themes = [...new Set(ideas.flatMap((i) => i.themes))].slice(0, 20);
  await yieldLoop();

  // ── Topic subgraph: the user-visible graph filtered to the scoped ideas.
  const fullGraph = await buildIdeaGraph();
  await yieldLoop();
  const nodes = fullGraph.nodes.filter((n) => ideaIds.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const graph: GraphData = {
    nodes,
    edges: fullGraph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
  };

  return {
    topic: query,
    embeddingAvailable: vector != null,
    ideas,
    passages,
    works,
    authors,
    edges,
    debates,
    gaps,
    themes,
    graph,
  };
}

/** Phase 0 — the territory map shown before anything is generated. Pure, no AI. */
export async function buildImmersionScope(request: ImmersionScopeRequest): Promise<ImmersionScope> {
  const settings = getSettings();
  const language = normalizeImmersionLanguage(settings.promptLanguage);
  const material = await buildImmersionMaterial(request.topic, language);
  const warnings: string[] = [];
  const plannedModel = settings.immersionModel ?? settings.synthesisModel ?? null;
  const aiKeyAvailable = plannedModel != null && getApiKey(plannedModel.provider) != null;
  if (!aiKeyAvailable) {
    warnings.push(
      plannedModel
        ? immersionScopeWarning(language, 'key', plannedModel.provider)
        : immersionScopeWarning(language, 'model')
    );
  }
  if (!material.embeddingAvailable) {
    warnings.push(immersionScopeWarning(language, 'embeddings'));
  }
  if (material.passages.length === 0) {
    warnings.push(immersionScopeWarning(language, 'passages'));
  }
  if (material.ideas.length < IDEA_MIN_KEEP / 2) {
    warnings.push(immersionScopeWarning(language, 'sparse'));
  }
  return scopeFromImmersionMaterial(request, material, aiKeyAvailable, warnings);
}

function scopeFromImmersionMaterial(request: ImmersionScopeRequest, material: ImmersionMaterial, aiKeyAvailable: boolean, warnings: string[]): ImmersionScope {
  return {
    topic: material.topic,
    generatedAt: new Date().toISOString(),
    embeddingAvailable: material.embeddingAvailable,
    aiKeyAvailable,
    ideas: material.ideas.map((i) => ({
      id: i.id,
      type: i.type as ImmersionScope['ideas'][number]['type'],
      label: i.label,
      statement: i.statement,
      score: i.score,
      themes: i.themes,
      authors: i.authors,
      workIds: i.works.map((w) => w.nodusId),
    })),
    works: material.works.map((w) => ({
      nodusId: w.nodusId,
      title: w.title,
      authors: w.authors,
      year: w.year,
      zoteroKey: w.zoteroKey,
      score: w.score,
      ideaCount: w.ideaCount,
    })),
    authors: material.authors,
    themes: material.themes,
    debateCount: material.debates.length,
    gapCount: material.gaps.length,
    passageCount: material.passages.length,
    graph: material.graph,
    estimatedStations: resolveStationCount(request.minutes ?? 150, material.ideas.length),
    warnings,
  };
}

export async function mobileImmersionGenerationContext(request: ImmersionRequest) {
  if (!request || typeof request.topic !== 'string' || !request.topic.trim() || request.topic.length > 10_000
    || !Number.isFinite(request.minutes) || request.minutes < 1 || request.minutes > 1440) throw new Error('invalid_immersion_request');
  const material = await buildImmersionMaterial(request.topic, normalizeImmersionLanguage(request.language), undefined, {lexicalOnly:true});
  const revision = createHash('sha256').update(JSON.stringify(material)).digest('hex');
  return {material, revision, scope:scopeFromImmersionMaterial(request, material, true, [immersionScopeWarning(normalizeImmersionLanguage(request.language), 'embeddings')])};
}

export async function saveMobileImmersion(input: {request: ImmersionRequest; revision: string; plan: import('@shared/types').ImmersionPlan; model: ModelRef}) {
  const plan = input?.plan;
  const string = (value: unknown) => typeof value === 'string';
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
  const questions = (value: unknown): boolean => Array.isArray(value) && value.length <= 100 && value.every(question => question
    && string(question.id) && string(question.question) && strings(question.options) && strings(question.ideaIds)
    && string(question.explanation) && string(question.expected)
    && (question.kind === 'open' ? question.correctIndex === null : question.kind === 'choice'
      && Number.isInteger(question.correctIndex) && question.correctIndex >= 0 && question.correctIndex < question.options.length));
  if (!plan || !Array.isArray(plan.stations) || plan.stations.length > IMMERSION_LIMITS.maxStations || !Array.isArray(plan.ideaIndex)
    || !input.model || typeof input.model.model !== 'string' || !input.model.model || typeof input.model.provider !== 'string'
    || typeof plan.title !== 'string' || typeof plan.overview !== 'string' || JSON.stringify(plan).length > 5_000_000
    || !Array.isArray(plan.keyTerms) || plan.keyTerms.some(item => !item || !string(item.term) || !string(item.definition))
    || !Array.isArray(plan.frontiers) || plan.frontiers.some(item => !item || !['gap','thin_coverage'].includes(item.kind) || !string(item.statement) || !string(item.detail))
    || !plan.exam || !string(plan.exam.feynman) || !questions(plan.exam.questions)
    || !plan.contrasts || !strings(plan.contrasts.authors) || !Array.isArray(plan.contrasts.rows)
    || plan.contrasts.rows.some(row => !row || !string(row.stationId) || !string(row.question) || !Array.isArray(row.cells)
      || row.cells.some(cell => !cell || !string(cell.author) || !string(cell.stance) || !strings(cell.ideaIds)))
    || !plan.graph || !Array.isArray(plan.graph.nodes) || !Array.isArray(plan.graph.edges)
    || !plan.stats || Object.values(plan.stats).some(count => !Number.isInteger(count) || count < 0)
    || !string(plan.generatedAt) || !Number.isFinite(Date.parse(plan.generatedAt))
    || plan.minutes !== input.request?.minutes || plan.language !== normalizeImmersionLanguage(input.request?.language)
    || (plan.stoppedReason !== null && !string(plan.stoppedReason))
    || plan.model?.provider !== input.model.provider || plan.model?.model !== input.model.model
    || plan.stations.some(station => !station || !string(station.id) || !string(station.title) || !string(station.question)
      || !Number.isFinite(station.minutes) || station.minutes <= 0 || !string(station.context) || !string(station.synthesis)
      || !strings(station.takeaways) || !questions(station.quiz) || !Array.isArray(station.positions)
      || station.positions.some(position => !position || !string(position.name) || !string(position.position) || !strings(position.ideaIds)))
    || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) throw new Error('invalid_immersion_plan');
  const context = await mobileImmersionGenerationContext(input.request);
  if (context.revision !== input.revision) throw new Error('immersion_generation_conflict');
  const ideas = new Set(context.material.ideas.map(item => item.id));
  const passages = new Map(context.material.passages.map(item => [item.id,item]));
  const nodes = new Set(context.material.graph.nodes.map(item => item.id));
  const edges = new Set(context.material.graph.edges.map(item => item.id));
  const authors = new Set(context.material.authors.map(item => item.name));
  const stationIds = new Set(plan.stations.map(item => item.id));
  const knownIdeas = (ids: string[]) => ids.every(id => ideas.has(id));
  const citationCatalog = buildCitationCatalog(context.material);
  const validCitations = (markdown: string) => Array.from(markdown.matchAll(/nodus:\/\/(?:idea|work|passage)\/[^\s)\]"',;]+/g), hit => hit[0]).every(url => citationCatalog.has(url));
  if (plan.topic !== context.material.topic || plan.ideaIndex.some(item => !item || !ideas.has(item.id))
    || !validCitations(plan.overview) || !validCitations(plan.exam.feynman)
    || plan.graph.nodes.some(node => !node || !nodes.has(node.id)) || plan.graph.edges.some(edge => !edge || !edges.has(edge.id))
    || plan.contrasts.authors.some(author => !authors.has(author))
    || plan.contrasts.rows.some(row => !stationIds.has(row.stationId) || row.cells.some(cell => !authors.has(cell.author) || !knownIdeas(cell.ideaIds)))
    || plan.exam.questions.some(question => !knownIdeas(question.ideaIds))
    || plan.stations.some(station => !station || !Array.isArray(station.ideaIds) || !Array.isArray(station.citations)
      || !validCitations(station.context) || !validCitations(station.synthesis)
      || station.positions.some(position => !authors.has(position.name) || !knownIdeas(position.ideaIds))
      || station.quiz.some(question => !knownIdeas(question.ideaIds))
      || !knownIdeas(station.ideaIds) || station.citations.some(citation => {
        const source = citation && passages.get(citation.passageId);
        return !source || citation.text !== source.text || citation.workId !== source.workId || !string(citation.commentary) || !string(citation.whyItMatters);
      }))) throw new Error('invalid_immersion_evidence');
  return saveImmersionSession(plan, input.model);
}

export async function generateImmersionSession(request: ImmersionRequest, onProgress?: (p: ImmersionBuildProgress) => void): Promise<ImmersionSession> {
  const settings = getSettings();
  const hints = await prepareDocumentVisualHints(request.documentSkills, request.topic, request.model ?? settings.immersionModel ?? settings.synthesisModel);
  const catalog = request.documentSkills ? documentSkillCatalog(listDocumentSkills(), request.documentSkills) : '[]';
  // The thinking level chosen in the form applies to every call the session makes to its model.
  return withJobThinkingEffort(request.thinkingEffort, request.model ?? settings.immersionModel ?? settings.synthesisModel,
    () => withDocumentVisualPlanning(catalog, hints, () => generateImmersionWithVisualPlan(request, onProgress, hints)));
}

async function generateImmersionWithVisualPlan(
  request: ImmersionRequest,
  onProgress?: (p: ImmersionBuildProgress) => void,
  documentVisualHints: string[] = [],
): Promise<ImmersionSession> {
  const settings = getSettings();
  const model = request.model ?? settings.immersionModel ?? settings.synthesisModel ?? null;
  const requestedLanguage = (request as ImmersionRequest & { language?: PromptLanguage }).language;
  const language = normalizeImmersionLanguage(requestedLanguage ?? settings.promptLanguage);
  const routedRequest = { ...request, language } as ImmersionRequest;
  const copy = labels(language);
  const emit = (progress: ImmersionBuildProgress) => {
    try { onProgress?.(progress); } catch { /* progress cannot abort generation */ }
  };
  emit({ phase: 'discovery', message: copy.material });
  const material = await buildImmersionMaterial(request.topic, language, model);
  emit({
    phase: 'document_preparation',
    message: language === 'es'
      ? 'Usando las fichas documentales ya disponibles junto con ideas y evidencia literal…'
      : language === 'en'
        ? 'Using the available document profiles together with ideas and literal evidence…'
        : language === 'fr'
          ? 'Utilisation des fiches documentaires disponibles avec les idées et les preuves littérales…'
          : language === 'de'
            ? 'Verfügbare Dokumentprofile werden zusammen mit Ideen und wörtlicher Evidenz verwendet…'
            : language === 'it'
              ? 'Uso delle schede documentarie disponibili insieme alle idee e alle prove testuali…'
              : language === 'tr'
                ? 'Mevcut belge profilleri, fikirler ve kelimesi kelimesine kanıtla birlikte kullanılıyor…'
                : language === 'pt-BR'
                  ? 'Usando os perfis documentais disponíveis junto com ideias e evidência literal…'
                  : language === 'zh-Hans'
                    ? '正在结合已有的文献档案、观点与原文证据…'
                    : language === 'zh-Hant'
                      ? '正在結合既有的文獻檔案、觀點與原文證據…'
                      : language === 'vi'
                        ? 'Đang sử dụng hồ sơ tài liệu hiện có cùng với các ý tưởng và bằng chứng nguyên văn…'
                        : language === 'ja'
                          ? '利用可能な文献プロファイルを、アイデアや原文の証拠とともに使用しています…'
                          : language === 'ru'
                            ? 'Используются доступные профили документов вместе с идеями и буквальными доказательствами…'
                            : language === 'uk'
                              ? 'Використовуються наявні профілі документів разом з ідеями та буквальними доказами…'
                              : language === 'ko'
                                ? '사용 가능한 문서 프로필을 아이디어 및 축자 증거와 함께 사용합니다…'
                                : 'A usar as fichas documentais disponíveis juntamente com ideias e evidência literal…',
  });
  // Immersion may consume profiles already prepared by Deep Research or a manual
  // reader action, but it never creates new Documentary Index work itself.
  const plan = await orchestrateImmersion({ ...routedRequest, model }, realDeps(model, material), onProgress);
  plan.documentSkills = request.documentSkills;
  plan.documentVisualHints = documentVisualHints;
  generationSignal()?.throwIfAborted();
  const saved = saveImmersionSession(plan, model);
  if (request.documentSkills?.enabled) {
    emit({ phase: 'assembling', message: documentVisualProgressLabel(settings.uiLanguage) });
    await withoutDocumentVisualPlanning(() => enrichDocumentVisuals({ kind: 'immersion', id: saved.id }, request.documentSkills!, { hints: documentVisualHints, model })).catch(() => undefined);
  }
  return saved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer handling (choice → deterministic local match, open → unscored local reflection)
// ─────────────────────────────────────────────────────────────────────────────

function findQuestion(session: ImmersionSession, questionId: string): ImmersionQuizQuestion | null {
  for (const station of session.plan.stations) {
    const hit = station.quiz.find((q) => q.id === questionId);
    if (hit) return hit;
  }
  return session.plan.exam.questions.find((q) => q.id === questionId) ?? null;
}

export async function evaluateImmersionAnswer(request: ImmersionAnswerRequest): Promise<ImmersionAnswerResult> {
  const session = getImmersionSession(request.sessionId);
  if (!session) throw new Error(immersionError('es', 'session'));
  const language = normalizeImmersionLanguage(session.plan.language);
  const question = findQuestion(session, request.questionId);
  if (!question) throw new Error(immersionError(language, 'question'));

  let record: ImmersionAnswerRecord;
  if (question.kind === 'choice') {
    const index = Number(request.answer);
    const correct = Number.isInteger(index) && index === question.correctIndex;
    record = {
      questionId: question.id,
      kind: 'choice',
      answer: request.answer,
      correct,
      assessment: null,
      answeredAt: new Date().toISOString(),
    };
  } else {
    // Open answers are private reflections. They are persisted locally verbatim and
    // never sent to a model, heuristically scored, profiled or used to steer access.
    record = {
      questionId: question.id,
      kind: 'open',
      answer: request.answer,
      correct: null,
      assessment: null,
      answeredAt: new Date().toISOString(),
    };
  }

  const progress = recordImmersionAnswer(session.id, record);
  return { record, progress };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real AI dependencies
// ─────────────────────────────────────────────────────────────────────────────

function realDeps(model: ModelRef | null, preparedMaterial?: ImmersionMaterial): ImmersionDeps {
  let material = preparedMaterial;
  return {
    buildMaterial: async (topic) => {
      if (material && material.topic === topic.trim()) {
        const cached = material;
        material = undefined;
        return cached;
      }
      return buildImmersionMaterial(topic, undefined, model);
    },
    ...createImmersionAIDependencies((prompt, valid) => completeJson(prompt, valid, model)),
  };
}

function normalizeImmersionLanguage(value: unknown): PromptLanguage {
  return IMMERSION_PROMPT_LANGUAGES.includes(value as PromptLanguage) ? value as PromptLanguage : 'es';
}

function immersionScopeWarning(language: PromptLanguage, kind: 'key' | 'model' | 'embeddings' | 'passages' | 'sparse', value?: string): string {
  const text: Record<PromptLanguage, Record<typeof kind, string>> = {
    es: { key: `Falta la clave de IA para ${value ?? ''}: sin ella la inmersión saldría vacía (solo esqueleto estructural). Añádela en Ajustes.`, model: 'No hay modelo de IA configurado: la inmersión saldría vacía (solo esqueleto estructural).', embeddings: 'Sin embeddings configurados: el alcance se calculó por coincidencia léxica y será menos preciso.', passages: 'No hay pasajes indexados para este tema: la inmersión no podrá mostrar citas literales del texto completo.', sparse: 'Hay poco material relevante: analiza más obras en profundidad para una inmersión más rica.' },
    en: { key: `No AI key is configured for ${value ?? ''}: immersion would be empty (structural skeleton only). Add it in Settings.`, model: 'No AI model is configured: immersion would be empty (structural skeleton only).', embeddings: 'No embeddings are configured: the scope was calculated lexically and will be less precise.', passages: 'No passages are indexed for this topic: immersion cannot show literal quotes from the full text.', sparse: 'There is little relevant material: analyse more works in depth for a richer immersion.' },
    fr: { key: `Aucune clé d’IA n’est configurée pour ${value ?? ''} : l’immersion serait vide (simple squelette structurel). Ajoutez-la dans les réglages.`, model: 'Aucun modèle d’IA n’est configuré : l’immersion serait vide (simple squelette structurel).', embeddings: 'Aucun embedding n’est configuré : le périmètre a été calculé lexicalement et sera moins précis.', passages: 'Aucun passage n’est indexé pour ce sujet : l’immersion ne pourra pas afficher de citations littérales du texte intégral.', sparse: 'Le matériau pertinent est limité : analysez davantage d’ouvrages en profondeur pour une immersion plus riche.' },
    de: { key: `Für ${value ?? ''} ist kein KI-Schlüssel konfiguriert: Die Immersion wäre leer (nur strukturelles Gerüst). Fügen Sie ihn in den Einstellungen hinzu.`, model: 'Es ist kein KI-Modell konfiguriert: Die Immersion wäre leer (nur strukturelles Gerüst).', embeddings: 'Es sind keine Embeddings konfiguriert: Der Umfang wurde lexikalisch berechnet und ist weniger präzise.', passages: 'Für dieses Thema sind keine Passagen indexiert: Die Immersion kann keine wörtlichen Zitate aus dem Volltext anzeigen.', sparse: 'Es gibt wenig relevantes Material: Analysieren Sie weitere Werke gründlich für eine reichhaltigere Immersion.' },
    pt: { key: `Não está configurada uma chave de IA para ${value ?? ''}: a imersão ficaria vazia (apenas esqueleto estrutural). Adiciona-a em Definições.`, model: 'Não está configurado nenhum modelo de IA: a imersão ficaria vazia (apenas esqueleto estrutural).', embeddings: 'Não estão configurados embeddings: o alcance foi calculado lexicalmente e será menos preciso.', passages: 'Não há passagens indexadas para este tema: a imersão não poderá mostrar citações literais do texto completo.', sparse: 'Há pouco material relevante: analisa mais obras em profundidade para uma imersão mais rica.' },
    'pt-BR': { key: `Nenhuma chave de IA está configurada para ${value ?? ''}: a imersão ficaria vazia (apenas esqueleto estrutural). Adicione-a em Configurações.`, model: 'Nenhum modelo de IA está configurado: a imersão ficaria vazia (apenas esqueleto estrutural).', embeddings: 'Nenhum embedding está configurado: o escopo foi calculado lexicalmente e será menos preciso.', passages: 'Não há passagens indexadas para este tema: a imersão não poderá mostrar citações literais do texto completo.', sparse: 'Há pouco material relevante: analise mais obras em profundidade para uma imersão mais rica.' },
    it: { key: `Non è configurata alcuna chiave IA per ${value ?? ''}: l’immersione sarebbe vuota (solo scheletro strutturale). Aggiungila nelle Impostazioni.`, model: 'Non è configurato alcun modello IA: l’immersione sarebbe vuota (solo scheletro strutturale).', embeddings: 'Non sono configurati embedding: l’ambito è stato calcolato lessicalmente e sarà meno preciso.', passages: 'Non ci sono passaggi indicizzati per questo argomento: l’immersione non può mostrare citazioni letterali del testo completo.', sparse: 'Il materiale pertinente è scarso: analizza più opere in profondità per un’immersione più ricca.' },
    tr: { key: `${value ?? ''} için yapay zekâ anahtarı yapılandırılmamış: immersiyon boş olurdu (yalnızca yapısal iskelet). Ayarlardan ekleyin.`, model: 'Yapay zekâ modeli yapılandırılmamış: immersiyon boş olurdu (yalnızca yapısal iskelet).', embeddings: 'Embedding yapılandırılmamış: kapsam sözcüksel olarak hesaplandı ve daha az kesin olacak.', passages: 'Bu konu için pasaj dizinlenmemiş: immersiyon tam metinden kelimesi kelimesine alıntılar gösteremez.', sparse: 'İlgili materyal az: daha zengin bir immersiyon için daha fazla eseri derinlemesine analiz edin.' },
    'zh-Hans': { key: `未配置 ${value ?? ''} 的 AI 密钥：沉浸模式将为空（仅有结构骨架）。请在设置中添加。`, model: '未配置 AI 模型：沉浸模式将为空（仅有结构骨架）。', embeddings: '未配置嵌入向量：范围改为按词汇匹配计算，精度会降低。', passages: '该主题没有已索引的段落：沉浸模式无法显示全文中的原文引用。', sparse: '相关材料较少：请深入分析更多著作，以获得更丰富的沉浸体验。' },
    'zh-Hant': { key: `未設定 ${value ?? ''} 的 AI 金鑰：沉浸模式將為空（僅有結構骨架）。請在設定中新增。`, model: '未設定 AI 模型：沉浸模式將為空（僅有結構骨架）。', embeddings: '未設定嵌入向量：範圍改以詞彙比對計算，精確度會降低。', passages: '此主題沒有已建立索引的段落：沉浸模式無法顯示全文的原文引用。', sparse: '相關材料較少：請深入分析更多著作，以獲得更豐富的沉浸體驗。' },
    vi: { key: `Chưa cấu hình khóa AI cho ${value ?? ''}: chế độ đắm chìm sẽ trống (chỉ còn khung cấu trúc). Hãy thêm khóa trong Cài đặt.`, model: 'Chưa cấu hình mô hình AI: chế độ đắm chìm sẽ trống (chỉ còn khung cấu trúc).', embeddings: 'Chưa cấu hình embedding: phạm vi được tính bằng khớp từ vựng và sẽ kém chính xác hơn.', passages: 'Không có đoạn trích nào được lập chỉ mục cho chủ đề này: chế độ đắm chìm không thể hiển thị trích dẫn nguyên văn từ toàn văn.', sparse: 'Có ít tài liệu liên quan: hãy phân tích sâu thêm nhiều tác phẩm để có trải nghiệm đắm chìm phong phú hơn.' },
    ja: { key: `${value ?? ''} の AI キーが設定されていません。このままでは没入モードは空（構造スケルトンのみ）になります。設定で追加してください。`, model: 'AI モデルが設定されていません。このままでは没入モードは空（構造スケルトンのみ）になります。', embeddings: '埋め込みが設定されていません。範囲は語彙一致で計算されるため、精度が下がります。', passages: 'このトピックには索引付けされた抜粋がありません。没入モードでは全文からの引用を表示できません。', sparse: '関連資料が少なすぎます。より豊かな没入体験のために、さらに多くの著作を詳しく分析してください。' },
    ru: { key: `Для ${value ?? ''} не настроен ключ ИИ: погружение будет пустым (только структурный каркас). Добавьте его в настройках.`, model: 'Модель ИИ не настроена: погружение будет пустым (только структурный каркас).', embeddings: 'Эмбеддинги не настроены: охват вычислен лексическим сопоставлением и будет менее точным.', passages: 'Для этой темы нет проиндексированных фрагментов: погружение не сможет показать буквальные цитаты из полного текста.', sparse: 'Релевантного материала мало: проанализируйте больше произведений глубоко, чтобы погружение стало богаче.' },
    uk: { key: `Для ${value ?? ''} не налаштовано ключ ШІ: занурення буде порожнім (лише структурний каркас). Додайте його в налаштуваннях.`, model: 'Модель ШІ не налаштовано: занурення буде порожнім (лише структурний каркас).', embeddings: 'Векторні подання не налаштовано: обсяг обчислено лексичним зіставленням, і він буде менш точним.', passages: 'Для цієї теми немає проіндексованих фрагментів: занурення не зможе показати буквальні цитати з повного тексту.', sparse: 'Релевантного матеріалу обмаль: проаналізуйте більше творів глибоко, щоб занурення було багатшим.' },
    ko: { key: `${value ?? ''}의 AI 키가 설정되지 않았습니다. 이대로면 몰입 모드가 비어 있게 됩니다(구조적 골격만 표시). 설정에서 추가하십시오.`, model: 'AI 모델이 설정되지 않았습니다. 이대로면 몰입 모드가 비어 있게 됩니다(구조적 골격만 표시).', embeddings: '임베딩이 설정되지 않았습니다. 범위가 어휘 일치로 계산되어 정확도가 떨어집니다.', passages: '이 주제에 대해 색인된 구절이 없습니다. 몰입 모드에서 전체 텍스트의 축자 인용을 표시할 수 없습니다.', sparse: '관련 자료가 적습니다. 더 풍부한 몰입을 위해 더 많은 저작을 심층 분석하십시오.' },
  };
  return text[language][kind];
}

function immersionError(language: PromptLanguage, kind: 'session' | 'question'): string {
  const messages: Record<PromptLanguage, Record<typeof kind, string>> = {
    es: { session: 'Sesión de inmersión no encontrada', question: 'Pregunta no encontrada en esta sesión' },
    en: { session: 'Immersion session not found', question: 'Question not found in this session' },
    fr: { session: 'Session d’immersion introuvable', question: 'Question introuvable dans cette session' },
    de: { session: 'Immersionssitzung nicht gefunden', question: 'Frage in dieser Sitzung nicht gefunden' },
    pt: { session: 'Sessão de imersão não encontrada', question: 'Pergunta não encontrada nesta sessão' },
    'pt-BR': { session: 'Sessão de imersão não encontrada', question: 'Pergunta não encontrada nesta sessão' },
    it: { session: 'Sessione di immersione non trovata', question: 'Domanda non trovata in questa sessione' },
    tr: { session: 'İmmersiyon oturumu bulunamadı', question: 'Bu oturumda soru bulunamadı' },
    'zh-Hans': { session: '未找到沉浸会话', question: '此会话中未找到问题' },
    'zh-Hant': { session: '找不到沉浸會話', question: '在此會話中找不到問題' },
    vi: { session: 'Không tìm thấy phiên đắm chìm', question: 'Không tìm thấy câu hỏi trong phiên này' },
    ja: { session: '没入セッションが見つかりません', question: 'このセッションに質問が見つかりません' },
    ru: { session: 'Сеанс погружения не найден', question: 'Вопрос в этом сеансе не найден' },
    uk: { session: 'Сеанс занурення не знайдено', question: 'Запитання в цьому сеансі не знайдено' },
    ko: { session: '몰입 세션을 찾을 수 없습니다', question: '이 세션에서 질문을 찾을 수 없습니다' },
  };
  return messages[language][kind];
}
