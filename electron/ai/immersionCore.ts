import type {
  GraphData,
  ImmersionAuthorPosition,
  ImmersionBuildProgress,
  ImmersionCitation,
  ImmersionContrastRow,
  ImmersionContrasts,
  ImmersionExam,
  ImmersionFrontier,
  ImmersionIdeaRef,
  ImmersionKeyTerm,
  ImmersionPlan,
  ImmersionQuizQuestion,
  ImmersionRequest,
  ImmersionStation,
  PromptLanguage,
} from '@shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Pure orchestration core for Inmersión. This module has NO Electron / DB /
// AI-provider imports (only erased type imports), so the whole control flow —
// curriculum planning, station writing, citation policy, contrasts, exam and
// assembly — can be unit-tested with injected fakes. The AI/DB wiring lives in
// ./immersion.ts.
//
// Two invariants the whole feature stands on:
//   • Literal quotes NEVER come from the model. The model picks passage ids from
//     a menu; the quote text is copied from the material (i.e. the database).
//   • A model failure at any step degrades that step to structural content and
//     the session still completes end to end (stoppedReason records it).
// ─────────────────────────────────────────────────────────────────────────────

export const IMMERSION_LIMITS = {
  minStations: 3,
  maxStations: 24,
  ideasPerStation: 12,
  passagesPerStation: 6,
  positionsPerStation: 6,
  quizPerStation: 3,
  examQuestions: 8,
  keyTerms: 10,
  frontiers: 8,
  contrastAuthors: 8,
} as const;

/** Minutes each fixed block of the experience roughly takes. A station is a
 *  full mini-lesson (context → lesson → guided reading → positions → takeaways
 *  → quiz), so it carries real study time, not a skim. */
export const IMMERSION_TIME = {
  panorama: 15,
  station: 28,
  contrasts: 15,
  frontiers: 8,
  exam: 18,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Material (assembled by the wiring from embeddings + graph, no AI)
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialIdea {
  id: string;
  type: string;
  label: string;
  statement: string;
  score: number;
  themes: string[];
  authors: string[];
  works: { nodusId: string; title: string; year: number | null; zoteroKey: string | null }[];
}

export interface MaterialPassage {
  id: string;
  workId: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  pageLabel: string | null;
  /** Full stored chunk text, straight from the database. */
  text: string;
  score: number;
}

export interface MaterialWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  score: number;
  ideaCount: number;
  /** Audited macro orientation; useful for route design, never literal evidence. */
  orientation: string | null;
}

export interface MaterialAuthor {
  authorId: string | null;
  name: string;
  ideaCount: number;
  workCount: number;
}

export interface MaterialEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface MaterialDebate {
  edgeId: string;
  fromIdeaId: string;
  toIdeaId: string;
  fromLabel: string;
  toLabel: string;
  type: string;
}

export interface MaterialGap {
  id: string;
  kind: string;
  statement: string;
  workTitle: string | null;
  score: number;
}

export interface ImmersionMaterial {
  topic: string;
  embeddingAvailable: boolean;
  ideas: MaterialIdea[];
  passages: MaterialPassage[];
  works: MaterialWork[];
  authors: MaterialAuthor[];
  edges: MaterialEdge[];
  debates: MaterialDebate[];
  gaps: MaterialGap[];
  themes: string[];
  graph: GraphData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Injected AI dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumInput {
  topic: string;
  language: PromptLanguage;
  stationCount: number;
  ideas: { id: string; label: string; statement: string; authors: string[]; themes: string[] }[];
  passages: { id: string; workTitle: string; pageLabel: string | null; excerpt: string }[];
  works: { id: string; title: string; orientation: string }[];
  authors: string[];
  debates: { fromLabel: string; toLabel: string; type: string }[];
}

export interface CurriculumStation {
  id: string;
  title: string;
  question: string;
  ideaIds: string[];
  passageIds: string[];
}

export interface CurriculumResult {
  title: string;
  stations: CurriculumStation[];
}

export interface PanoramaInput {
  topic: string;
  language: PromptLanguage;
  stationQuestions: string[];
  ideas: { id: string; label: string; statement: string; authors: string[]; citation: string }[];
  works: { id: string; title: string; authors: string[]; year: number | null; citation: string; orientation: string | null }[];
  debates: { fromLabel: string; toLabel: string }[];
}

export interface PanoramaResult {
  overview: string;
  keyTerms: ImmersionKeyTerm[];
}

export interface StationInput {
  topic: string;
  language: PromptLanguage;
  title: string;
  question: string;
  includeQuiz: boolean;
  ideas: { id: string; label: string; statement: string; authors: string[]; citation: string }[];
  passages: { id: string; workTitle: string; authors: string[]; pageLabel: string | null; text: string; citation: string }[];
  authors: string[];
}

export interface StationResult {
  /** Why this sub-question matters inside the topic (framing, ~120 words). */
  context: string;
  /** The main lesson: a long, threaded essay with citations. */
  synthesis: string;
  /** Guided close reading: chosen passages + a commentary that teaches how to read each one. */
  citations: { passageId: string; whyItMatters: string; commentary?: string }[];
  positions: { author: string; position: string; ideaIds: string[] }[];
  /** 4-6 sentences the reader must retain from this station. */
  takeaways: string[];
  quiz: {
    kind: 'choice' | 'open';
    question: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
    expected?: string;
    ideaIds?: string[];
  }[];
}

export interface ContrastsInput {
  topic: string;
  language: PromptLanguage;
  authors: string[];
  rows: {
    stationId: string;
    question: string;
    ideasByAuthor: Record<string, { id: string; label: string; statement: string }[]>;
  }[];
}

export interface ContrastsResult {
  rows: { stationId: string; cells: { author: string; stance: string }[] }[];
}

export interface ExamInput {
  topic: string;
  language: PromptLanguage;
  stationQuestions: string[];
  ideas: { id: string; label: string; statement: string; authors: string[] }[];
  questionCount: number;
}

export interface ExamResult {
  questions: StationResult['quiz'];
  feynman: string;
}

export interface ImmersionDeps {
  buildMaterial(topic: string): Promise<ImmersionMaterial>;
  planCurriculum(input: CurriculumInput): Promise<CurriculumResult>;
  writePanorama(input: PanoramaInput): Promise<PanoramaResult>;
  writeStation(input: StationInput): Promise<StationResult>;
  writeContrasts(input: ContrastsInput): Promise<ContrastsResult>;
  writeExam(input: ExamInput): Promise<ExamResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

type ProgressFn = (p: ImmersionBuildProgress) => void;

/**
 * `completeJson` already retries malformed JSON, but deliberately aborts after a
 * transport/provider error so generic structured calls cannot stall every caller.
 * Immersion is a long, explicitly requested workflow: degrading an otherwise
 * complete route because one of its many independent generations had a single
 * transient failure is a poor trade. Give each stage one fresh top-level attempt
 * before using the honest structural fallback.
 */
async function generateWithRecovery<T>(generate: () => Promise<T>): Promise<T> {
  try {
    return await generate();
  } catch {
    return generate();
  }
}

/** Target number of guided stations for the chosen depth and the material.
 *
 *  Depth scales with the budget, anchored on the three presets and interpolated
 *  in between: ~6 stations for a quick pass (90 min), ~12 for an afternoon
 *  (150 min), ~20 for a deep dive (240 min). This is a TARGET the planner aims
 *  for — the model may plan somewhat fewer or more when the topic warrants it,
 *  including several consecutive stations that deepen the same thread. */
export function resolveStationCount(minutes: number, ideaCount: number): number {
  const byTime = Math.round(((minutes - 90) * 14) / 150) + 6;
  // Each station still needs its own distinct material to be worth a stop.
  const byMaterial = Math.floor(ideaCount / 3);
  return clamp(
    Math.min(byTime, Math.max(IMMERSION_LIMITS.minStations, byMaterial)),
    IMMERSION_LIMITS.minStations,
    IMMERSION_LIMITS.maxStations
  );
}

export async function orchestrateImmersion(
  request: ImmersionRequest,
  deps: ImmersionDeps,
  onProgress?: ProgressFn
): Promise<ImmersionPlan> {
  // The persisted shared request predates the full prompt-language set. Keep
  // accepting its wire shape while honoring newer runtime values supplied by
  // the desktop settings/request boundary.
  const requestedLanguage = (request as ImmersionRequest & { language?: PromptLanguage }).language;
  const language: PromptLanguage = isPromptLanguage(requestedLanguage) ? requestedLanguage : 'es';
  const msg = labels(language);
  const emit: ProgressFn = (p) => onProgress?.(p);
  const degradations: string[] = [];

  emit({ phase: 'material', message: msg.material });
  const material = await deps.buildMaterial(request.topic);
  if (material.ideas.length === 0) {
    throw new Error(msg.noMaterial);
  }

  const stationCount = resolveStationCount(request.minutes, material.ideas.length);

  // ── Curriculum ─────────────────────────────────────────────────────────────
  emit({ phase: 'curriculum', message: msg.curriculum });
  let curriculum: CurriculumResult;
  try {
    curriculum = normalizeCurriculum(
      await generateWithRecovery(() => deps.planCurriculum(curriculumInput(request.topic, language, stationCount, material))),
      material,
      stationCount,
      request.topic
    );
  } catch {
    degradations.push(msg.degradedCurriculum);
    curriculum = fallbackCurriculum(request.topic, material, stationCount);
  }

  // ── Panorama ───────────────────────────────────────────────────────────────
  emit({ phase: 'panorama', message: msg.panorama });
  const catalog = buildCitationCatalog(material);
  const citationLabels = buildCitationLabels(material);
  let panorama: PanoramaResult;
  try {
    panorama = await generateWithRecovery(() => deps.writePanorama(panoramaInput(request.topic, language, curriculum, material)));
    panorama = {
      overview:
        applyCitationPolicy(normalizeBareCitations(cleanStr(panorama.overview, ''), citationLabels), catalog) ||
        fallbackOverview(request.topic, material, msg),
      keyTerms: normalizeKeyTerms(panorama.keyTerms),
    };
  } catch {
    degradations.push(msg.degradedPanorama);
    panorama = { overview: fallbackOverview(request.topic, material, msg), keyTerms: fallbackKeyTerms(material) };
  }

  // ── Stations ───────────────────────────────────────────────────────────────
  const stations: ImmersionStation[] = [];
  for (let i = 0; i < curriculum.stations.length; i++) {
    const spec = curriculum.stations[i];
    emit({
      phase: 'station',
      message: msg.station,
      stationIndex: i + 1,
      stationTotal: curriculum.stations.length,
      stationTitle: spec.title,
    });
    const input = stationInput(request, language, spec, material);
    let result: StationResult;
    try {
      result = await generateWithRecovery(() => deps.writeStation(input));
    } catch {
      degradations.push(`${msg.degradedStation} «${spec.title}»`);
      result = fallbackStation(input);
    }
    stations.push(buildStation(spec, result, input, material, catalog, citationLabels, request.includeQuiz, i));
  }

  // ── Contrasts ──────────────────────────────────────────────────────────────
  emit({ phase: 'contrasts', message: msg.contrasts });
  let contrasts: ImmersionContrasts;
  try {
    contrasts = normalizeContrasts(
      await generateWithRecovery(() => deps.writeContrasts(contrastsInput(request.topic, language, stations, material))),
      stations,
      material
    );
  } catch {
    degradations.push(msg.degradedContrasts);
    contrasts = fallbackContrasts(stations, material);
  }

  // ── Frontiers (pure, no AI) ────────────────────────────────────────────────
  emit({ phase: 'frontiers', message: msg.frontiers });
  const frontiers = buildFrontiers(material, stations, msg);

  // ── Exam ───────────────────────────────────────────────────────────────────
  emit({ phase: 'exam', message: msg.exam });
  let exam: ImmersionExam;
  if (!request.includeQuiz) {
    exam = { questions: [], feynman: msg.feynman(request.topic) };
  } else {
    try {
      const result = await generateWithRecovery(() => deps.writeExam(examInput(request.topic, language, stations, material)));
      exam = {
        questions: normalizeQuiz(result.questions, material, 'exam', IMMERSION_LIMITS.examQuestions),
        feynman: cleanStr(result.feynman, msg.feynman(request.topic)),
      };
    } catch {
      degradations.push(msg.degradedExam);
      exam = fallbackExam(stations, request.topic, msg);
    }
    if (exam.questions.length === 0) exam = fallbackExam(stations, request.topic, msg);
  }

  // ── Assembly ───────────────────────────────────────────────────────────────
  emit({ phase: 'assembling', message: msg.assembling });
  const coveredIdeaIds = new Set(stations.flatMap((s) => s.ideaIds));
  const ideaIndex: ImmersionIdeaRef[] = material.ideas
    .filter((idea) => coveredIdeaIds.has(idea.id))
    .map((idea) => ({
      id: idea.id,
      label: idea.label,
      statement: idea.statement,
      authors: idea.authors,
      workTitles: idea.works.map((w) => w.title),
    }));

  const citationsTotal = stations.reduce((acc, s) => acc + s.citations.length, 0);
  const quizTotal = stations.reduce((acc, s) => acc + s.quiz.length, 0) + exam.questions.length;

  const plan: ImmersionPlan = {
    topic: request.topic,
    title: curriculum.title || request.topic,
    language,
    minutes: request.minutes,
    generatedAt: new Date().toISOString(),
    model: request.model ?? null,
    overview: panorama.overview,
    keyTerms: panorama.keyTerms,
    stations,
    contrasts,
    frontiers,
    exam,
    graph: material.graph,
    ideaIndex,
    stats: {
      stations: stations.length,
      ideas: coveredIdeaIds.size,
      works: material.works.length,
      authors: material.authors.length,
      citations: citationsTotal,
      quizQuestions: quizTotal,
    },
    stoppedReason: degradations.length ? degradations.join(' · ') : null,
  };

  emit({ phase: 'done', message: msg.done });
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input builders
// ─────────────────────────────────────────────────────────────────────────────

function curriculumInput(topic: string, language: PromptLanguage, stationCount: number, material: ImmersionMaterial): CurriculumInput {
  // A longer route needs more raw material to distribute; the planner sees a
  // generous slice so it can build coherent, deepening threads across stations.
  return {
    topic,
    language,
    stationCount,
    ideas: material.ideas.slice(0, 90).map((i) => ({
      id: i.id,
      label: i.label,
      statement: clip(i.statement, 240),
      authors: i.authors.slice(0, 4),
      themes: i.themes.slice(0, 4),
    })),
    passages: material.passages.slice(0, 32).map((p) => ({
      id: p.id,
      workTitle: p.workTitle,
      pageLabel: p.pageLabel,
      excerpt: clip(p.text, 260),
    })),
    works: material.works.filter((work) => work.orientation).slice(0, 20).map((work) => ({
      id: work.nodusId,
      title: work.title,
      orientation: clip(work.orientation ?? '', 500),
    })),
    authors: material.authors.slice(0, 20).map((a) => a.name),
    debates: material.debates.slice(0, 14).map((d) => ({ fromLabel: d.fromLabel, toLabel: d.toLabel, type: d.type })),
  };
}

function panoramaInput(topic: string, language: PromptLanguage, curriculum: CurriculumResult, material: ImmersionMaterial): PanoramaInput {
  return {
    topic,
    language,
    stationQuestions: curriculum.stations.map((s) => s.question),
    ideas: material.ideas.slice(0, 30).map((i) => ({
      id: i.id,
      label: i.label,
      statement: clip(i.statement, 220),
      authors: i.authors.slice(0, 4),
      citation: `nodus://idea/${i.id}`,
    })),
    works: material.works.slice(0, 20).map((w) => ({
      id: w.nodusId,
      title: w.title,
      authors: w.authors.slice(0, 4),
      year: w.year,
      citation: `nodus://work/${w.nodusId}`,
      orientation: w.orientation,
    })),
    debates: material.debates.slice(0, 8).map((d) => ({ fromLabel: d.fromLabel, toLabel: d.toLabel })),
  };
}

function stationInput(
  request: ImmersionRequest,
  language: PromptLanguage,
  spec: CurriculumStation,
  material: ImmersionMaterial
): StationInput {
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  const passageById = new Map(material.passages.map((p) => [p.id, p] as const));
  const ideas = spec.ideaIds
    .map((id) => ideaById.get(id))
    .filter((i): i is MaterialIdea => Boolean(i))
    .slice(0, IMMERSION_LIMITS.ideasPerStation);
  const passages = spec.passageIds
    .map((id) => passageById.get(id))
    .filter((p): p is MaterialPassage => Boolean(p))
    .slice(0, IMMERSION_LIMITS.passagesPerStation + 2);
  const authors = [...new Set(ideas.flatMap((i) => i.authors))].slice(0, IMMERSION_LIMITS.positionsPerStation + 2);
  return {
    topic: request.topic,
    language,
    title: spec.title,
    question: spec.question,
    includeQuiz: request.includeQuiz,
    ideas: ideas.map((i) => ({
      id: i.id,
      label: i.label,
      statement: i.statement,
      authors: i.authors.slice(0, 4),
      citation: `nodus://idea/${i.id}`,
    })),
    passages: passages.map((p) => ({
      id: p.id,
      workTitle: p.workTitle,
      authors: p.authors.slice(0, 4),
      pageLabel: p.pageLabel,
      text: clip(p.text, 1400),
      citation: `nodus://passage/${encodeURIComponent(p.id)}`,
    })),
    authors,
  };
}

function contrastsInput(topic: string, language: PromptLanguage, stations: ImmersionStation[], material: ImmersionMaterial): ContrastsInput {
  const authors = topAuthors(material);
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  return {
    topic,
    language,
    authors: authors.map((a) => a.name),
    rows: stations.map((station) => {
      const ideasByAuthor: Record<string, { id: string; label: string; statement: string }[]> = {};
      for (const author of authors) {
        const ideas = station.ideaIds
          .map((id) => ideaById.get(id))
          .filter((i): i is MaterialIdea => Boolean(i) && i!.authors.includes(author.name))
          .slice(0, 4)
          .map((i) => ({ id: i.id, label: i.label, statement: clip(i.statement, 200) }));
        if (ideas.length) ideasByAuthor[author.name] = ideas;
      }
      return { stationId: station.id, question: station.question, ideasByAuthor };
    }),
  };
}

function examInput(topic: string, language: PromptLanguage, stations: ImmersionStation[], material: ImmersionMaterial): ExamInput {
  const covered = new Set(stations.flatMap((s) => s.ideaIds));
  return {
    topic,
    language,
    stationQuestions: stations.map((s) => s.question),
    ideas: material.ideas
      .filter((i) => covered.has(i.id))
      .slice(0, 40)
      .map((i) => ({ id: i.id, label: i.label, statement: clip(i.statement, 220), authors: i.authors.slice(0, 4) })),
    questionCount: IMMERSION_LIMITS.examQuestions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization + validation (everything the model returns is distrusted)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCurriculum(
  result: CurriculumResult,
  material: ImmersionMaterial,
  stationCount: number,
  topic: string
): CurriculumResult {
  const ideaIds = new Set(material.ideas.map((i) => i.id));
  const passageIds = new Set(material.passages.map((p) => p.id));
  const stations = (Array.isArray(result.stations) ? result.stations : [])
    .map((s, i) => ({
      id: cleanStr(s.id, `st-${i + 1}`),
      title: cleanStr(s.title, ''),
      question: cleanStr(s.question, ''),
      ideaIds: strList(s.ideaIds).filter((id) => ideaIds.has(id)),
      passageIds: strList(s.passageIds).filter((id) => passageIds.has(id)),
    }))
    .filter((s) => s.title && s.question && s.ideaIds.length > 0)
    // The planner is given a target but keeps discretion over the exact count;
    // only the hard ceiling is enforced here so a rich topic can breathe.
    .slice(0, IMMERSION_LIMITS.maxStations);
  if (stations.length < IMMERSION_LIMITS.minStations) {
    return fallbackCurriculum(topic, material, stationCount);
  }
  assignOrphans(stations, material);
  return { title: cleanStr(result.title, topic), stations };
}

/** Spread strong unassigned ideas and passages across stations so nothing key is dropped. */
function assignOrphans(stations: CurriculumStation[], material: ImmersionMaterial): void {
  const assignedIdeas = new Set(stations.flatMap((s) => s.ideaIds));
  const strongIdeas = material.ideas.slice(0, stations.length * 6).filter((i) => !assignedIdeas.has(i.id));
  for (let i = 0; i < strongIdeas.length; i++) {
    const station = stations[i % stations.length];
    if (station.ideaIds.length < IMMERSION_LIMITS.ideasPerStation) station.ideaIds.push(strongIdeas[i].id);
  }
  const assignedPassages = new Set(stations.flatMap((s) => s.passageIds));
  const ideaWorkByStation = stations.map((s) => {
    const works = new Set<string>();
    const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
    for (const id of s.ideaIds) for (const w of ideaById.get(id)?.works ?? []) works.add(w.nodusId);
    return works;
  });
  for (const passage of material.passages) {
    if (assignedPassages.has(passage.id)) continue;
    // Attach the passage to the least-served station whose ideas share its work,
    // so quotes spread across the route instead of piling on the first stops.
    let best = -1;
    for (let i = 0; i < stations.length; i++) {
      if (!ideaWorkByStation[i].has(passage.workId)) continue;
      if (stations[i].passageIds.length >= IMMERSION_LIMITS.passagesPerStation + 2) continue;
      if (best === -1 || stations[i].passageIds.length < stations[best].passageIds.length) best = i;
    }
    if (best >= 0) stations[best].passageIds.push(passage.id);
  }
}

export function fallbackCurriculum(topic: string, material: ImmersionMaterial, stationCount: number): CurriculumResult {
  // Group ideas by dominant theme; themes with the most relevant ideas become stations.
  const byTheme = new Map<string, MaterialIdea[]>();
  for (const idea of material.ideas) {
    const theme = idea.themes[0] ?? '';
    const list = byTheme.get(theme) ?? [];
    list.push(idea);
    byTheme.set(theme, list);
  }
  const groups = [...byTheme.entries()].sort((a, b) => b[1].length - a[1].length);
  const stations: CurriculumStation[] = [];
  for (let i = 0; i < Math.min(stationCount, groups.length); i++) {
    const [theme, ideas] = groups[i];
    const title = theme || topic;
    stations.push({
      id: `st-${i + 1}`,
      title,
      question: `¿Qué sostiene el corpus sobre «${title}» en relación con ${topic}?`,
      ideaIds: ideas.slice(0, IMMERSION_LIMITS.ideasPerStation).map((idea) => idea.id),
      passageIds: [],
    });
  }
  // Too few themes: chunk the ranked ideas evenly instead.
  while (stations.length < Math.min(stationCount, Math.ceil(material.ideas.length / 4))) {
    const index = stations.length;
    const chunk = material.ideas.filter((_, i) => i % stationCount === index).slice(0, IMMERSION_LIMITS.ideasPerStation);
    if (chunk.length === 0) break;
    stations.push({
      id: `st-${index + 1}`,
      title: chunk[0].label,
      question: `¿Qué papel juega «${chunk[0].label}» dentro de ${topic}?`,
      ideaIds: chunk.map((idea) => idea.id),
      passageIds: [],
    });
  }
  assignOrphans(stations, material);
  return { title: topic, stations };
}

function buildStation(
  spec: CurriculumStation,
  result: StationResult,
  input: StationInput,
  material: ImmersionMaterial,
  catalog: Set<string>,
  citationLabels: Map<string, string>,
  includeQuiz: boolean,
  index: number
): ImmersionStation {
  const passageById = new Map(material.passages.map((p) => [p.id, p] as const));
  const menuIds = new Set(input.passages.map((p) => p.id));

  // Citations: model may only pick from the station menu; quote text is copied from material.
  const picked = (Array.isArray(result.citations) ? result.citations : [])
    .filter((c) => c && typeof c.passageId === 'string' && menuIds.has(c.passageId))
    .slice(0, IMMERSION_LIMITS.passagesPerStation);
  const chosen = picked.length
    ? picked
    : input.passages
        .slice(0, IMMERSION_LIMITS.passagesPerStation)
        .map((p) => ({ passageId: p.id, whyItMatters: '', commentary: '' }));
  const citations: ImmersionCitation[] = chosen
    .map((c) => {
      const p = passageById.get(c.passageId);
      if (!p) return null;
      return {
        passageId: p.id,
        workId: p.workId,
        workTitle: p.workTitle,
        authors: p.authors,
        year: p.year,
        zoteroKey: p.zoteroKey,
        pageLabel: p.pageLabel,
        text: p.text,
        whyItMatters: cleanStr(c.whyItMatters, ''),
        commentary: cleanStr(c.commentary, ''),
      };
    })
    .filter((c): c is ImmersionCitation => c !== null);

  const knownAuthors = new Set(material.authors.map((a) => a.name));
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  const stationIdeaIds = new Set(input.ideas.map((i) => i.id));
  const positions: ImmersionAuthorPosition[] = (Array.isArray(result.positions) ? result.positions : [])
    .filter((p) => p && typeof p.author === 'string' && typeof p.position === 'string' && p.position.trim())
    .map((p) => ({
      authorId: authorIdByName.get(p.author) ?? null,
      name: p.author,
      position: p.position.trim(),
      ideaIds: strList(p.ideaIds).filter((id) => stationIdeaIds.has(id)),
    }))
    .filter((p) => knownAuthors.has(p.name))
    .slice(0, IMMERSION_LIMITS.positionsPerStation);

  const synthesis =
    applyCitationPolicy(normalizeBareCitations(cleanStr(result.synthesis, ''), citationLabels), catalog) ||
    input.ideas.map((i) => `- **${i.label}**: ${i.statement}`).join('\n');

  return {
    id: spec.id || `st-${index + 1}`,
    title: spec.title,
    question: spec.question,
    minutes: IMMERSION_TIME.station,
    context: applyCitationPolicy(normalizeBareCitations(cleanStr(result.context, ''), citationLabels), catalog),
    synthesis,
    citations,
    positions,
    takeaways: strList(result.takeaways).slice(0, 6),
    ideaIds: input.ideas.map((i) => i.id),
    quiz: includeQuiz ? normalizeQuiz(result.quiz, material, spec.id || `st-${index + 1}`, IMMERSION_LIMITS.quizPerStation) : [],
  };
}

export function fallbackStation(input: StationInput): StationResult {
  return {
    context: `Esta estación responde: ${input.question}`,
    synthesis: input.ideas.map((i) => `- **${i.label}**: ${i.statement} ([${i.authors[0] ?? 'fuente'}](${i.citation}))`).join('\n'),
    citations: input.passages.slice(0, IMMERSION_LIMITS.passagesPerStation).map((p) => ({ passageId: p.id, whyItMatters: '' })),
    positions: [],
    takeaways: input.ideas.slice(0, 5).map((i) => i.statement),
    quiz: input.includeQuiz
      ? input.ideas.slice(0, IMMERSION_LIMITS.quizPerStation).map((i) => ({
          kind: 'open' as const,
          question: `¿Qué sostiene el corpus sobre «${i.label}» y quién lo defiende?`,
          expected: i.statement,
          ideaIds: [i.id],
        }))
      : [],
  };
}

export function normalizeQuiz(
  items: StationResult['quiz'],
  material: ImmersionMaterial,
  prefix: string,
  max: number
): ImmersionQuizQuestion[] {
  const ideaIds = new Set(material.ideas.map((i) => i.id));
  const out: ImmersionQuizQuestion[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.question !== 'string' || !item.question.trim()) continue;
    const kind = item.kind === 'choice' ? 'choice' : 'open';
    if (kind === 'choice') {
      const options = strList(item.options).slice(0, 4);
      const correct = Number(item.correctIndex);
      if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
      out.push({
        id: `${prefix}-q${out.length + 1}`,
        kind,
        question: item.question.trim(),
        options,
        correctIndex: correct,
        explanation: cleanStr(item.explanation, ''),
        expected: '',
        ideaIds: strList(item.ideaIds).filter((id) => ideaIds.has(id)),
      });
    } else {
      const expected = cleanStr(item.expected, '');
      if (!expected) continue;
      out.push({
        id: `${prefix}-q${out.length + 1}`,
        kind,
        question: item.question.trim(),
        options: [],
        correctIndex: null,
        explanation: '',
        expected,
        ideaIds: strList(item.ideaIds).filter((id) => ideaIds.has(id)),
      });
    }
    if (out.length >= max) break;
  }
  return out;
}

function normalizeContrasts(result: ContrastsResult, stations: ImmersionStation[], material: ImmersionMaterial): ImmersionContrasts {
  const authors = topAuthors(material);
  const authorNames = authors.map((a) => a.name);
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  const stationById = new Map(stations.map((s) => [s.id, s] as const));
  const rowsIn = Array.isArray(result.rows) ? result.rows : [];
  const rowByStation = new Map(rowsIn.map((r) => [r.stationId, r] as const));
  const rows: ImmersionContrastRow[] = stations.map((station) => {
    const row = rowByStation.get(station.id);
    const cellByAuthor = new Map((row?.cells ?? []).map((c) => [c.author, cleanStr(c.stance, '')] as const));
    return {
      stationId: station.id,
      question: station.question,
      cells: authorNames.map((name) => ({
        author: name,
        authorId: authorIdByName.get(name) ?? null,
        stance: cellByAuthor.get(name) ?? '',
        ideaIds: ideasOfAuthorInStation(name, station, material),
      })),
    };
  });
  // Sanity: every station must have a row; authors validated by construction.
  if (rows.length !== stations.length || !stationById) return fallbackContrasts(stations, material);
  return { authors: authorNames, rows };
}

export function fallbackContrasts(stations: ImmersionStation[], material: ImmersionMaterial): ImmersionContrasts {
  const authors = topAuthors(material);
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  const authorIdByName = new Map(material.authors.map((a) => [a.name, a.authorId] as const));
  return {
    authors: authors.map((a) => a.name),
    rows: stations.map((station) => ({
      stationId: station.id,
      question: station.question,
      cells: authors.map((author) => {
        const ideaIds = ideasOfAuthorInStation(author.name, station, material);
        const first = ideaIds.length ? ideaById.get(ideaIds[0]) : undefined;
        return {
          author: author.name,
          authorId: authorIdByName.get(author.name) ?? null,
          stance: first ? clip(first.statement, 180) : '',
          ideaIds,
        };
      }),
    })),
  };
}

function ideasOfAuthorInStation(author: string, station: ImmersionStation, material: ImmersionMaterial): string[] {
  const ideaById = new Map(material.ideas.map((i) => [i.id, i] as const));
  return station.ideaIds.filter((id) => ideaById.get(id)?.authors.includes(author));
}

function topAuthors(material: ImmersionMaterial): MaterialAuthor[] {
  return [...material.authors].sort((a, b) => b.ideaCount - a.ideaCount).slice(0, IMMERSION_LIMITS.contrastAuthors);
}

export function buildFrontiers(
  material: ImmersionMaterial,
  stations: ImmersionStation[],
  msg: ReturnType<typeof labels>
): ImmersionFrontier[] {
  const out: ImmersionFrontier[] = material.gaps.slice(0, IMMERSION_LIMITS.frontiers).map((gap) => ({
    kind: 'gap' as const,
    statement: gap.statement,
    detail: msg.gapDetail(gap.kind),
    workTitle: gap.workTitle,
  }));
  // Ideas relevant to the topic that no station covered → honest thin-coverage flag.
  const covered = new Set(stations.flatMap((s) => s.ideaIds));
  const uncovered = material.ideas.filter((i) => !covered.has(i.id));
  if (uncovered.length > 0 && out.length < IMMERSION_LIMITS.frontiers) {
    out.push({
      kind: 'thin_coverage',
      statement: msg.thinCoverage(uncovered.length),
      detail: uncovered
        .slice(0, 5)
        .map((i) => i.label)
        .join(' · '),
      workTitle: null,
    });
  }
  return out;
}

export function fallbackExam(stations: ImmersionStation[], topic: string, msg: ReturnType<typeof labels>): ImmersionExam {
  const questions = stations
    .flatMap((s) => s.quiz)
    .slice(0, IMMERSION_LIMITS.examQuestions)
    .map((q, i) => ({ ...q, id: `exam-q${i + 1}` }));
  return { questions, feynman: msg.feynman(topic) };
}

function fallbackOverview(topic: string, material: ImmersionMaterial, msg: ReturnType<typeof labels>): string {
  const lines = [
    `## ${msg.overviewTitle(topic)}`,
    '',
    msg.overviewIntro(material.ideas.length, material.works.length, material.authors.length),
    '',
    ...material.ideas.slice(0, 10).map((i) => `- **${i.label}** (${i.authors.slice(0, 2).join(', ') || '—'}): ${clip(i.statement, 200)} ([→](nodus://idea/${i.id}))`),
  ];
  return lines.join('\n');
}

function fallbackKeyTerms(material: ImmersionMaterial): ImmersionKeyTerm[] {
  return material.ideas
    .filter((i) => i.type === 'construct' || i.type === 'framework')
    .slice(0, IMMERSION_LIMITS.keyTerms)
    .map((i) => ({ term: i.label, definition: clip(i.statement, 200) }));
}

function normalizeKeyTerms(items: unknown): ImmersionKeyTerm[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((t): t is ImmersionKeyTerm => Boolean(t) && typeof (t as ImmersionKeyTerm).term === 'string' && typeof (t as ImmersionKeyTerm).definition === 'string')
    .map((t) => ({ term: t.term.trim(), definition: t.definition.trim() }))
    .filter((t) => t.term && t.definition)
    .slice(0, IMMERSION_LIMITS.keyTerms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation policy — a nodus:// link that is not in the material catalog is
// hallucinated and gets stripped down to its plain label.
// ─────────────────────────────────────────────────────────────────────────────

export function buildCitationCatalog(material: ImmersionMaterial): Set<string> {
  const catalog = new Set<string>();
  for (const idea of material.ideas) catalog.add(`nodus://idea/${idea.id}`);
  for (const work of material.works) catalog.add(`nodus://work/${work.nodusId}`);
  for (const passage of material.passages) {
    catalog.add(`nodus://passage/${passage.id}`);
    catalog.add(`nodus://passage/${encodeURIComponent(passage.id)}`);
  }
  return catalog;
}

/** Human labels for every citable url, used to repair citations the model wrote bare. */
export function buildCitationLabels(material: ImmersionMaterial): Map<string, string> {
  const labels = new Map<string, string>();
  for (const idea of material.ideas) labels.set(`nodus://idea/${idea.id}`, idea.label);
  for (const work of material.works) {
    const surname = (work.authors[0] ?? '').split(',')[0].trim() || work.title;
    labels.set(`nodus://work/${work.nodusId}`, work.year != null ? `${surname} (${work.year})` : surname);
  }
  for (const passage of material.passages) {
    const surname = (passage.authors[0] ?? '').split(',')[0].trim() || passage.workTitle;
    const label = [surname, passage.year ?? '', passage.pageLabel ? `p. ${passage.pageLabel}` : '']
      .filter(Boolean)
      .join(', ');
    labels.set(`nodus://passage/${passage.id}`, label);
    labels.set(`nodus://passage/${encodeURIComponent(passage.id)}`, label);
  }
  return labels;
}

/**
 * Models sometimes emit citations as bare urls — `(nodus://idea/x)` or
 * `[Autor] (nodus://…)` with a space — which would reach the reader as raw text.
 * Repair both into proper Markdown links so the renderer shows citation chips.
 */
export function normalizeBareCitations(markdown: string, labels: Map<string, string>): string {
  // `[label] (url)` → `[label](url)` (stray space breaks the Markdown link).
  let out = markdown.replace(/\]\s+\(\s*(nodus:\/\/[^)\s]+)\s*\)/g, ']($1)');
  // Bare urls (not already a link target) get wrapped with their catalog label.
  out = out.replace(/(\]\()?(nodus:\/\/(?:idea|work|passage)\/[^\s)\]"',;.]+)/g, (full, prefix: string | undefined, url: string) => {
    if (prefix) return full;
    return `[${labels.get(url) ?? '→'}](${url})`;
  });
  return out;
}

export function applyCitationPolicy(markdown: string, catalog: Set<string>): string {
  return markdown.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]+)\)/g, (full, label: string, url: string) => {
    return catalog.has(url) ? full : label;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clip(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function cleanStr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function isPromptLanguage(value: unknown): value is PromptLanguage {
  return value === 'es' || value === 'en' || value === 'fr' || value === 'de' || value === 'pt' || value === 'pt-BR' || value === 'it' || value === 'tr' || value === 'zh-Hans' || value === 'zh-Hant' || value === 'vi' || value === 'ja' || value === 'ru' || value === 'uk' || value === 'ko';
}

export function labels(language: PromptLanguage) {
  if (language === 'en') {
    return {
      material: 'Mapping the topic territory…',
      curriculum: 'Designing the guided route…',
      panorama: 'Writing the panorama…',
      station: 'Writing station…',
      contrasts: 'Building the author contrast matrix…',
      frontiers: 'Charting the frontiers of the corpus…',
      exam: 'Preparing the final exam…',
      assembling: 'Assembling the immersion…',
      done: 'Immersion ready.',
      noMaterial: 'No relevant material found for this topic. Analyse more works or refine the topic.',
      degradedCurriculum: 'curriculum fell back to a structural plan',
      degradedPanorama: 'panorama fell back to structural content',
      degradedStation: 'a station fell back to structural content:',
      degradedContrasts: 'contrast matrix fell back to structural content',
      degradedExam: 'the exam fell back to station questions',
      overviewTitle: (topic: string) => `Panorama: ${topic}`,
      overviewIntro: (ideas: number, works: number, authors: number) =>
        `Your corpus holds ${ideas} relevant ideas across ${works} works by ${authors} authors on this topic. These are the strongest lines:`,
      gapDetail: (kind: string) => `Gap detected in the corpus (${kind}).`,
      thinCoverage: (n: number) => `${n} relevant ideas were left outside the guided stations.`,
      feynman: (topic: string) =>
        `Explain, in your own words and as if teaching a colleague, what the corpus knows about “${topic}”: the main positions, which author defends each one, and where they disagree.`,
    };
  }
  if (language === 'fr') {
    return {
      material: 'Cartographie du territoire du sujet…', curriculum: 'Conception du parcours guidé…', panorama: 'Rédaction du panorama…', station: 'Rédaction de la station…', contrasts: 'Construction de la matrice des contrastes…', frontiers: 'Cartographie des frontières du corpus…', exam: 'Préparation de l’examen final…', assembling: 'Assemblage de l’immersion…', done: 'Immersion prête.', noMaterial: 'Aucun contenu pertinent n’a été trouvé pour ce sujet. Analysez davantage d’ouvrages ou reformulez le sujet.', degradedCurriculum: 'le parcours structurel a remplacé le plan des stations', degradedPanorama: 'le panorama a utilisé un contenu structurel', degradedStation: 'une station a utilisé un contenu structurel :', degradedContrasts: 'la matrice des contrastes a utilisé un contenu structurel', degradedExam: 'l’examen a repris les questions des stations', overviewTitle: (topic: string) => `Panorama : ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `Votre corpus contient ${ideas} idées pertinentes réparties dans ${works} ouvrages de ${authors} auteurs sur ce sujet. Voici les lignes les plus fortes :`, gapDetail: (kind: string) => `Lacune détectée dans le corpus (${kind}).`, thinCoverage: (n: number) => `${n} idées pertinentes sont restées hors des stations guidées.`, feynman: (topic: string) => `Expliquez avec vos propres mots, comme si vous enseigniez à un collègue, ce que le corpus sait sur « ${topic} » : les positions principales, l’auteur qui défend chacune et leurs désaccords.`,
    };
  }
  if (language === 'de') {
    return {
      material: 'Das Themengebiet wird kartiert…', curriculum: 'Die geführte Route wird entworfen…', panorama: 'Das Panorama wird geschrieben…', station: 'Die Station wird geschrieben…', contrasts: 'Die Autoren-Kontrastmatrix wird erstellt…', frontiers: 'Die Grenzen des Korpus werden kartiert…', exam: 'Die Abschlussprüfung wird vorbereitet…', assembling: 'Die Immersion wird zusammengestellt…', done: 'Immersion bereit.', noMaterial: 'Für dieses Thema wurde kein relevantes Material gefunden. Analysieren Sie weitere Werke oder präzisieren Sie das Thema.', degradedCurriculum: 'der strukturierte Plan wurde für den Stationsplan verwendet', degradedPanorama: 'das Panorama verwendete strukturellen Inhalt', degradedStation: 'eine Station verwendete strukturellen Inhalt:', degradedContrasts: 'die Kontrastmatrix verwendete strukturellen Inhalt', degradedExam: 'die Prüfung übernahm Stationsfragen', overviewTitle: (topic: string) => `Panorama: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `Ihr Korpus enthält ${ideas} relevante Ideen aus ${works} Werken von ${authors} Autoren zu diesem Thema. Dies sind die stärksten Linien:`, gapDetail: (kind: string) => `Lücke im Korpus erkannt (${kind}).`, thinCoverage: (n: number) => `${n} relevante Ideen blieben außerhalb der geführten Stationen.`, feynman: (topic: string) => `Erklären Sie mit eigenen Worten, als würden Sie es einem Kollegen beibringen, was das Korpus über „${topic}“ weiß: die wichtigsten Positionen, welcher Autor sie vertritt und worin sie sich unterscheiden.`,
    };
  }
  if (language === 'pt' || language === 'pt-BR') {
    const br = language === 'pt-BR';
    return {
      material: br ? 'Mapeando o território do tema…' : 'A cartografar o território do tema…', curriculum: br ? 'Desenhando a rota guiada…' : 'A desenhar a rota guiada…', panorama: br ? 'Redigindo o panorama…' : 'A redigir o panorama…', station: br ? 'Redigindo a estação…' : 'A redigir a estação…', contrasts: br ? 'Construindo a matriz de contrastes entre autores…' : 'A construir a matriz de contrastes entre autores…', frontiers: br ? 'Mapeando as fronteiras do corpus…' : 'A cartografar as fronteiras do corpus…', exam: br ? 'Preparando o exame final…' : 'A preparar o exame final…', assembling: br ? 'Montando a imersão…' : 'A montar a imersão…', done: br ? 'Imersão pronta.' : 'Imersão pronta.', noMaterial: br ? 'Nenhum material relevante foi encontrado para este tema. Analise mais obras ou refine o tema.' : 'Não foi encontrado material relevante para este tema. Analise mais obras ou refine o tema.', degradedCurriculum: br ? 'o plano estrutural foi usado para as estações' : 'o plano estrutural foi usado para as estações', degradedPanorama: br ? 'o panorama usou conteúdo estrutural' : 'o panorama usou conteúdo estrutural', degradedStation: br ? 'uma estação usou conteúdo estrutural:' : 'uma estação usou conteúdo estrutural:', degradedContrasts: br ? 'a matriz de contrastes usou conteúdo estrutural' : 'a matriz de contrastes usou conteúdo estrutural', degradedExam: br ? 'o exame reutilizou perguntas das estações' : 'o exame reutilizou perguntas das estações', overviewTitle: (topic: string) => `Panorama: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => br ? `Seu corpus contém ${ideas} ideias relevantes em ${works} obras de ${authors} autores sobre este tema. Estas são as linhas mais fortes:` : `O seu corpus contém ${ideas} ideias relevantes em ${works} obras de ${authors} autores sobre este tema. Estas são as linhas mais fortes:`, gapDetail: (kind: string) => br ? `Lacuna detectada no corpus (${kind}).` : `Lacuna detetada no corpus (${kind}).`, thinCoverage: (n: number) => br ? `${n} ideias relevantes ficaram fora das estações guiadas.` : `${n} ideias relevantes ficaram fora das estações guiadas.`, feynman: (topic: string) => br ? `Explique com suas próprias palavras, como se ensinasse a um colega, o que o corpus sabe sobre “${topic}”: as posições principais, qual autor defende cada uma e onde discordam.` : `Explique pelas suas palavras, como se ensinasse a um colega, o que o corpus sabe sobre «${topic}»: as posições principais, que autor defende cada uma e onde discordam.`,
    };
  }
  if (language === 'it') {
    return {
      material: 'Mappatura del territorio dell’argomento…', curriculum: 'Progettazione del percorso guidato…', panorama: 'Scrittura del panorama…', station: 'Scrittura della stazione…', contrasts: 'Costruzione della matrice dei contrasti tra autori…', frontiers: 'Mappatura delle frontiere del corpus…', exam: 'Preparazione dell’esame finale…', assembling: 'Assemblaggio dell’immersione…', done: 'Immersione pronta.', noMaterial: 'Non è stato trovato materiale rilevante per questo argomento. Analizza altre opere o precisa l’argomento.', degradedCurriculum: 'il piano strutturale ha sostituito il percorso delle stazioni', degradedPanorama: 'il panorama ha usato contenuto strutturale', degradedStation: 'una stazione ha usato contenuto strutturale:', degradedContrasts: 'la matrice dei contrasti ha usato contenuto strutturale', degradedExam: 'l’esame ha riutilizzato le domande delle stazioni', overviewTitle: (topic: string) => `Panorama: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `Il tuo corpus contiene ${ideas} idee rilevanti in ${works} opere di ${authors} autori su questo argomento. Queste sono le linee più forti:`, gapDetail: (kind: string) => `Lacuna rilevata nel corpus (${kind}).`, thinCoverage: (n: number) => `${n} idee rilevanti sono rimaste fuori dalle stazioni guidate.`, feynman: (topic: string) => `Spiega con parole tue, come se lo insegnassi a un collega, ciò che il corpus sa su «${topic}»: le posizioni principali, quale autore difende ciascuna e dove divergono.`,
    };
  }
  if (language === 'tr') {
    return {
      material: 'Konu alanı haritalandırılıyor…', curriculum: 'Yönlendirilmiş rota tasarlanıyor…', panorama: 'Panorama yazılıyor…', station: 'İstasyon yazılıyor…', contrasts: 'Yazar karşılaştırma matrisi oluşturuluyor…', frontiers: 'Korpusun sınırları haritalandırılıyor…', exam: 'Final sınavı hazırlanıyor…', assembling: 'İmmersiyon birleştiriliyor…', done: 'İmmersiyon hazır.', noMaterial: 'Bu konu için ilgili materyal bulunamadı. Daha fazla eser analiz edin veya konuyu daraltın.', degradedCurriculum: 'istasyon planı için yapısal rota kullanıldı', degradedPanorama: 'panorama yapısal içerik kullandı', degradedStation: 'bir istasyon yapısal içerik kullandı:', degradedContrasts: 'karşılaştırma matrisi yapısal içerik kullandı', degradedExam: 'sınav istasyon sorularını yeniden kullandı', overviewTitle: (topic: string) => `Panorama: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `Korpusunuz bu konuda ${authors} yazarın ${works} eserinde ${ideas} ilgili fikir içeriyor. En güçlü çizgiler şunlar:`, gapDetail: (kind: string) => `Korpusta boşluk saptandı (${kind}).`, thinCoverage: (n: number) => `${n} ilgili fikir yönlendirilmiş istasyonların dışında kaldı.`, feynman: (topic: string) => `Bir meslektaşınıza öğretir gibi, kendi sözlerinizle korpusun “${topic}” hakkında ne bildiğini açıklayın: temel konumlar, her birini savunan yazar ve ayrıldıkları noktalar.`,
    };
  }
  if (language === 'zh-Hans') {
    return {
      material: '正在梳理主题领域…', curriculum: '正在设计引导路线…', panorama: '正在撰写全景…', station: '正在撰写站点…', contrasts: '正在构建作者对比矩阵…', frontiers: '正在绘制语料前沿…', exam: '正在准备期末测验…', assembling: '正在组装沉浸内容…', done: '沉浸已就绪。', noMaterial: '未找到与该主题相关的材料。请分析更多著作或调整主题。', degradedCurriculum: '课程设计已回退为结构化路线', degradedPanorama: '全景已回退为结构化内容', degradedStation: '某个站点已回退为结构化内容：', degradedContrasts: '对比矩阵已回退为结构化内容', degradedExam: '测验已改用站点题目', overviewTitle: (topic: string) => `全景：${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `你的语料在此主题下共有来自 ${authors} 位作者的 ${works} 部著作中的 ${ideas} 条相关观点。以下是最有力的脉络：`, gapDetail: (kind: string) => `语料中检测到空白（${kind}）。`, thinCoverage: (n: number) => `有 ${n} 条相关观点未纳入引导站点。`, feynman: (topic: string) => `请用自己的话，像给同事讲课一样，说明语料对“${topic}”的了解：主要立场、每种立场的代表人物，以及分歧所在。`,
    };
  }
  if (language === 'zh-Hant') {
    return {
      material: '正在梳理主題領域…', curriculum: '正在設計引導路線…', panorama: '正在撰寫全景…', station: '正在撰寫站點…', contrasts: '正在建構作者對比矩陣…', frontiers: '正在繪製語料前沿…', exam: '正在準備期末測驗…', assembling: '正在組裝沉浸內容…', done: '沉浸已就緒。', noMaterial: '未找到與此主題相關的材料。請分析更多著作或調整主題。', degradedCurriculum: '課程規劃已回退為結構化路線', degradedPanorama: '全景已回退為結構化內容', degradedStation: '某個站點已回退為結構化內容：', degradedContrasts: '對比矩陣已回退為結構化內容', degradedExam: '測驗已改用站點題目', overviewTitle: (topic: string) => `全景：${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `你的語料在此主題下共有來自 ${authors} 位作者的 ${works} 部著作中的 ${ideas} 條相關觀點。以下是最有力的脈絡：`, gapDetail: (kind: string) => `語料中偵測到空白（${kind}）。`, thinCoverage: (n: number) => `有 ${n} 條相關觀點未納入引導站點。`, feynman: (topic: string) => `請用自己的話，像給同事講課一樣，說明語料對「${topic}」的了解：主要立場、每種立場的代表人物，以及分歧所在。`,
    };
  }
  if (language === 'vi') {
    return {
      material: 'Đang khảo sát phạm vi chủ đề…', curriculum: 'Đang thiết kế lộ trình có hướng dẫn…', panorama: 'Đang viết toàn cảnh…', station: 'Đang viết trạm…', contrasts: 'Đang xây dựng ma trận đối chiếu tác giả…', frontiers: 'Đang vẽ ranh giới ngữ liệu…', exam: 'Đang chuẩn bị bài kiểm tra cuối kỳ…', assembling: 'Đang lắp ghép phiên đắm chìm…', done: 'Phiên đắm chìm đã sẵn sàng.', noMaterial: 'Không tìm thấy tài liệu phù hợp cho chủ đề này. Hãy phân tích thêm tác phẩm hoặc điều chỉnh chủ đề.', degradedCurriculum: 'lộ trình đã chuyển sang kế hoạch cấu trúc', degradedPanorama: 'toàn cảnh đã dùng nội dung cấu trúc', degradedStation: 'một trạm đã dùng nội dung cấu trúc:', degradedContrasts: 'ma trận đối chiếu đã dùng nội dung cấu trúc', degradedExam: 'bài kiểm tra đã dùng lại câu hỏi của các trạm', overviewTitle: (topic: string) => `Toàn cảnh: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `Ngữ liệu của bạn có ${ideas} ý tưởng liên quan trong ${works} tác phẩm của ${authors} tác giả về chủ đề này. Đây là những dòng mạnh nhất:`, gapDetail: (kind: string) => `Phát hiện khoảng trống trong ngữ liệu (${kind}).`, thinCoverage: (n: number) => `${n} ý tưởng liên quan nằm ngoài các trạm có hướng dẫn.`, feynman: (topic: string) => `Hãy giải thích bằng lời của mình, như đang giảng cho đồng nghiệp, những gì ngữ liệu biết về “${topic}”: các lập trường chính, tác giả nào bảo vệ từng lập trường và họ bất đồng ở đâu.`,
    };
  }
  if (language === 'ja') {
    return {
      material: 'トピックの領域を把握しています…', curriculum: 'ガイド付きルートを設計しています…', panorama: 'パノラマを作成しています…', station: 'ステーションを作成しています…', contrasts: '著者の対照マトリックスを構築しています…', frontiers: 'コーパスのフロンティアを描いています…', exam: '最終試験を準備しています…', assembling: '没入コンテンツを組み立てています…', done: '没入コンテンツの準備ができました。', noMaterial: 'このトピックに関連する資料が見つかりませんでした。さらに著作を分析するか、トピックを絞り込んでください。', degradedCurriculum: 'カリキュラムは構造的プランにフォールバックしました', degradedPanorama: 'パノラマは構造的コンテンツにフォールバックしました', degradedStation: 'あるステーションが構造的コンテンツにフォールバックしました：', degradedContrasts: '対照マトリックスは構造的コンテンツにフォールバックしました', degradedExam: '試験はステーションの質問を再利用しました', overviewTitle: (topic: string) => `パノラマ：${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `あなたのコーパスには、このトピックについて ${authors} 名の著者による ${works} 点の著作にまたがる ${ideas} 件の関連アイデアがあります。最も強い筋は次のとおりです：`, gapDetail: (kind: string) => `コーパスに空白を検出しました（${kind}）。`, thinCoverage: (n: number) => `${n} 件の関連アイデアがガイド付きステーションの外に残りました。`, feynman: (topic: string) => `同僚に教えるつもりで、自分の言葉で、コーパスが「${topic}」について何を知っているかを説明してください。主要な立場、それぞれを擁護する著者、そして見解が分かれる点です。`,
    };
  }
  if (language === 'ru') {
    return {
      material: 'Идёт картирование предметного поля…', curriculum: 'Проектируется управляемый маршрут…', panorama: 'Пишется панорама…', station: 'Пишется станция…', contrasts: 'Строится матрица авторских контрастов…', frontiers: 'Наносятся границы корпуса…', exam: 'Готовится итоговый экзамен…', assembling: 'Собирается погружение…', done: 'Погружение готово.', noMaterial: 'Для этой темы не найдено релевантного материала. Проанализируйте больше произведений или уточните тему.', degradedCurriculum: 'план курса заменён структурным маршрутом', degradedPanorama: 'панорама заменена структурным содержанием', degradedStation: 'одна из станций заменена структурным содержанием:', degradedContrasts: 'матрица контрастов заменена структурным содержанием', degradedExam: 'экзамен повторно использует вопросы станций', overviewTitle: (topic: string) => `Панорама: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `В вашем корпусе по этой теме ${ideas} релевантных идей из ${works} произведений ${authors} авторов. Вот сильнейшие линии:`, gapDetail: (kind: string) => `В корпусе обнаружен пробел (${kind}).`, thinCoverage: (n: number) => `${n} релевантных идей остались за пределами управляемых станций.`, feynman: (topic: string) => `Объясните своими словами, как будто учите коллегу, что корпус знает о «${topic}»: главные позиции, какой автор защищает каждую из них и в чём они расходятся.`,
    };
  }
  if (language === 'uk') {
    return {
      material: 'Триває картування предметного поля…', curriculum: 'Проєктується керований маршрут…', panorama: 'Пишеться панорама…', station: 'Пишеться станція…', contrasts: 'Будується матриця авторських контрастів…', frontiers: 'Наносяться межі корпусу…', exam: 'Готується підсумковий іспит…', assembling: 'Збирається занурення…', done: 'Занурення готове.', noMaterial: 'Для цієї теми не знайдено релевантного матеріалу. Проаналізуйте більше творів або уточніть тему.', degradedCurriculum: 'план курсу замінено структурним маршрутом', degradedPanorama: 'панораму замінено структурним змістом', degradedStation: 'одну зі станцій замінено структурним змістом:', degradedContrasts: 'матрицю контрастів замінено структурним змістом', degradedExam: 'іспит повторно використовує запитання станцій', overviewTitle: (topic: string) => `Панорама: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `У вашому корпусі з цієї теми ${ideas} релевантних ідей із ${works} творів ${authors} авторів. Ось найсильніші лінії:`, gapDetail: (kind: string) => `У корпусі виявлено прогалину (${kind}).`, thinCoverage: (n: number) => `${n} релевантних ідей залишилися поза керованими станціями.`, feynman: (topic: string) => `Поясніть своїми словами, ніби навчаєте колегу, що корпус знає про «${topic}»: головні позиції, який автор обстоює кожну з них і в чому вони розходяться.`,
    };
  }
  if (language === 'ko') {
    return {
      material: '주제 영역을 파악하는 중…', curriculum: '안내 경로를 설계하는 중…', panorama: '파노라마를 작성하는 중…', station: '스테이션을 작성하는 중…', contrasts: '저자 대조 행렬을 구축하는 중…', frontiers: '코퍼스의 경계를 그리는 중…', exam: '기말 시험을 준비하는 중…', assembling: '몰입 콘텐츠를 조립하는 중…', done: '몰입 콘텐츠가 준비되었습니다.', noMaterial: '이 주제에 대한 관련 자료를 찾지 못했습니다. 더 많은 저작을 분석하거나 주제를 좁히십시오.', degradedCurriculum: '커리큘럼이 구조적 경로로 대체되었습니다', degradedPanorama: '파노라마가 구조적 콘텐츠로 대체되었습니다', degradedStation: '한 스테이션이 구조적 콘텐츠로 대체되었습니다:', degradedContrasts: '대조 행렬이 구조적 콘텐츠로 대체되었습니다', degradedExam: '시험이 스테이션 질문을 재사용했습니다', overviewTitle: (topic: string) => `파노라마: ${topic}`, overviewIntro: (ideas: number, works: number, authors: number) => `귀하의 코퍼스에는 이 주제에 대해 ${authors}명의 저자가 쓴 ${works}편의 저작에 걸쳐 ${ideas}개의 관련 아이디어가 있습니다. 가장 강력한 흐름은 다음과 같습니다:`, gapDetail: (kind: string) => `코퍼스에서 공백이 감지되었습니다(${kind}).`, thinCoverage: (n: number) => `${n}개의 관련 아이디어가 안내 스테이션 밖에 남았습니다.`, feynman: (topic: string) => `동료에게 가르치듯 자신의 말로 코퍼스가 “${topic}”에 대해 아는 것을 설명하십시오. 주요 입장, 각 입장을 옹호하는 저자, 그리고 의견이 갈리는 지점입니다.`,
    };
  }
  // Exhaustiveness is intentional; an unknown value is kept safe at the call boundary.
  return {
    material: 'Cartografiando el territorio del tema…',
    curriculum: 'Diseñando la ruta guiada…',
    panorama: 'Redactando el panorama…',
    station: 'Redactando estación…',
    contrasts: 'Construyendo la matriz de contrastes…',
    frontiers: 'Trazando las fronteras del corpus…',
    exam: 'Preparando el examen final…',
    assembling: 'Ensamblando la inmersión…',
    done: 'Inmersión lista.',
    noMaterial: 'No hay material relevante para este tema. Analiza más obras o reformula el tema.',
    degradedCurriculum: 'el plan de estaciones usó la ruta estructural',
    degradedPanorama: 'el panorama usó contenido estructural',
    degradedStation: 'una estación usó contenido estructural:',
    degradedContrasts: 'la matriz de contrastes usó contenido estructural',
    degradedExam: 'el examen reutilizó preguntas de las estaciones',
    overviewTitle: (topic: string) => `Panorama: ${topic}`,
    overviewIntro: (ideas: number, works: number, authors: number) =>
      `Tu corpus contiene ${ideas} ideas relevantes en ${works} obras de ${authors} autores sobre este tema. Estas son las líneas más fuertes:`,
    gapDetail: (kind: string) => `Hueco detectado en el corpus (${kind}).`,
    thinCoverage: (n: number) => `${n} ideas relevantes quedaron fuera de las estaciones guiadas.`,
    feynman: (topic: string) =>
      `Explica, con tus palabras y como si se lo enseñaras a un colega, qué sabe el corpus sobre «${topic}»: las posiciones principales, qué autor defiende cada una y dónde discrepan.`,
  };
}
