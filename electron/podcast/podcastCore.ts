// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The podcast pipeline's control flow, with no AI, database, TTS or Electron imports: every
 * effect is injected, so the whole flow runs under `node --test` with doubles.
 *
 * research → plan → chapters → fact review → fit to the cap → (pause for review) → record.
 * Each finished stage is handed to `checkpoint`, so a restarted job resumes after it.
 */
import {
  PODCAST_GAPS_MS, PODCAST_MIN_FILL,
  allocateChapterWords, countSpokenWords, estimatePodcastSeconds, podcastChapterCount, podcastHostCount, podcastWordBudget, spreadImageChapters,
  type PodcastChapterPlan, type PodcastCheckpoint, type PodcastEvidence, type PodcastImagePlan, type PodcastPhase, type PodcastPlan,
  type PodcastRequest, type PodcastScript, type PodcastSource, type PodcastSpeaker, type PodcastTimeline, type PodcastTurn,
} from '@shared/podcast';
import { podcastLanguageName, podcastPromptPack } from '@shared/podcastPromptPacks';

export interface PodcastJsonCall {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface PodcastProgress {
  phase: PodcastPhase;
  message?: string;
  done?: number;
  total?: number;
  recordedS?: number;
  estimatedS?: number;
}

export interface PodcastScriptDeps {
  gatherEvidence(request: PodcastRequest, signal: AbortSignal, report: (message: string) => void): Promise<PodcastEvidence>;
  /** One JSON completion with the job's model; throws on transport or parse failure. */
  json(call: PodcastJsonCall): Promise<unknown>;
  /** Calibrated words per minute for the request's voices, or null for the default. */
  wpm(request: PodcastRequest): number | null;
  progress(progress: PodcastProgress): void;
  checkpoint(checkpoint: PodcastCheckpoint): void;
}

const SOURCE_EXCERPT_PLAN = 700;
const SOURCE_EXCERPT_CHAPTER = 1600;
const MAX_PLAN_SOURCES = 48;

function abortable(signal: AbortSignal): void { signal.throwIfAborted(); }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown, limit = 12): string[] {
  return (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, limit);
}

function sourceDigest(source: PodcastSource, excerpt: number) {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    ...(source.authors ? { authors: source.authors } : {}),
    ...(source.year ? { year: source.year } : {}),
    ...(source.location ? { location: source.location } : {}),
    excerpt: source.excerpt.length > excerpt ? `${source.excerpt.slice(0, excerpt)}…` : source.excerpt,
  };
}

function hostsBrief(request: PodcastRequest) {
  return request.hosts.map((host) => ({ speaker: host.speaker, name: host.name }));
}

function formatBrief(request: PodcastRequest): string {
  const pack = podcastPromptPack(request.language);
  const two = podcastHostCount(request.format, request.hosts.length) === 2;
  return `${two ? pack.format[request.format].two : pack.format[request.format].one}\n${pack.audience[request.audience]}`;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export function fallbackPlan(request: PodcastRequest, evidence: PodcastEvidence, chapterCount: number, words: number[]): PodcastPlan {
  const ids = evidence.sources.map((source) => source.id);
  const per = Math.max(1, Math.ceil(ids.length / chapterCount));
  const chapters: PodcastChapterPlan[] = Array.from({ length: chapterCount }, (_, index) => ({
    index,
    title: index === 0 ? request.objective.slice(0, 80) : `${index + 1}`,
    goal: request.objective,
    keyPoints: [],
    sourceIds: ids.slice(index * per, index * per + per),
    targetWords: words[index] ?? 120,
  }));
  return { title: request.objective.slice(0, 120), hook: '', summary: '', chapters, images: planImages(request, chapters, []) };
}

function planImages(request: PodcastRequest, chapters: PodcastChapterPlan[], ideas: string[]): PodcastImagePlan[] {
  const images: PodcastImagePlan[] = [];
  if (request.cover) images.push({ slot: 0, chapterIndex: null, idea: ideas[0] ?? '' });
  spreadImageChapters(chapters.length, request.extraImages).forEach((chapterIndex, index) => {
    images.push({ slot: index + 1, chapterIndex, idea: ideas[index + (request.cover ? 1 : 0)] ?? ideas[index] ?? chapters[chapterIndex]?.title ?? '' });
  });
  return images;
}

/** Turns the model's rundown into a plan with exactly `chapterCount` chapters and known source ids only. */
export function normalizePlan(raw: unknown, request: PodcastRequest, evidence: PodcastEvidence, chapterCount: number, words: number[]): PodcastPlan {
  const value = asRecord(raw);
  const known = new Set(evidence.sources.map((source) => source.id));
  const rawChapters = (Array.isArray(value.chapters) ? value.chapters : []).map(asRecord).filter((chapter) => typeof chapter.title === 'string' && chapter.title.trim());
  if (!rawChapters.length) return fallbackPlan(request, evidence, chapterCount, words);
  // A model that returns one chapter too many or too few still gets a usable rundown: extra
  // chapters merge into the last, missing ones are not invented (the budget is redistributed).
  const kept = rawChapters.slice(0, chapterCount);
  for (const extra of rawChapters.slice(chapterCount)) {
    const last = kept[kept.length - 1];
    last.keyPoints = [...strings(last.keyPoints), ...strings(extra.keyPoints)];
    last.sourceIds = [...strings(last.sourceIds), ...strings(extra.sourceIds)];
  }
  const budget = words.reduce((a, b) => a + b, 0);
  const redistributed = kept.length === words.length ? words : allocateChapterWords(budget, kept.length);
  const chapters: PodcastChapterPlan[] = kept.map((chapter, index) => ({
    index,
    title: String(chapter.title).trim().slice(0, 120),
    goal: typeof chapter.goal === 'string' ? chapter.goal.trim().slice(0, 400) : '',
    keyPoints: strings(chapter.keyPoints, 6),
    sourceIds: [...new Set(strings(chapter.sourceIds, 16).filter((id) => known.has(id)))],
    targetWords: redistributed[index],
  }));
  // A chapter the model left without sources borrows the least-used ones, so no chapter is
  // written from nothing.
  const usage = new Map<string, number>([...known].map((id) => [id, 0]));
  chapters.forEach((chapter) => chapter.sourceIds.forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1)));
  for (const chapter of chapters) {
    if (chapter.sourceIds.length || !usage.size) continue;
    const spare = [...usage.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id]) => id);
    chapter.sourceIds = spare;
    spare.forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1));
  }
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 160) : request.objective.slice(0, 120);
  return {
    title,
    hook: typeof value.hook === 'string' ? value.hook.trim().slice(0, 500) : '',
    summary: typeof value.summary === 'string' ? value.summary.trim().slice(0, 1200) : '',
    chapters,
    images: planImages(request, chapters, strings(value.imageIdeas, 8)),
  };
}

export async function planEpisode(request: PodcastRequest, evidence: PodcastEvidence, deps: Pick<PodcastScriptDeps, 'json' | 'wpm'>, signal: AbortSignal): Promise<PodcastPlan> {
  const chapterCount = podcastChapterCount(request.durationCapMin);
  const words = allocateChapterWords(podcastWordBudget(request.durationCapMin, deps.wpm(request)), chapterCount);
  const pack = podcastPromptPack(request.language);
  const imageCount = (request.cover ? 1 : 0) + Math.min(request.extraImages, chapterCount);
  let raw: unknown = null;
  try {
    raw = await deps.json({
      system: pack.planSystem,
      user: JSON.stringify({
        objective: request.objective,
        language: podcastLanguageName(request.language),
        format: formatBrief(request),
        hosts: hostsBrief(request),
        durationMinutes: request.durationCapMin,
        chapterCount,
        imageCount,
        sources: evidence.sources.slice(0, MAX_PLAN_SOURCES).map((source) => sourceDigest(source, SOURCE_EXCERPT_PLAN)),
        tensions: evidence.tensions.slice(0, 8),
        gaps: evidence.gaps.slice(0, 8),
      }),
      maxTokens: 3_000,
      temperature: 0.4,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    raw = null;
  }
  return normalizePlan(raw, request, evidence, chapterCount, words);
}

// ── Chapters ─────────────────────────────────────────────────────────────────

const MARKUP = /[*_#`>|~]|\[[^\]]*\]\([^)]*\)|\b(?:nodus|https?):\/\/\S+?(?=[.,;:!?]?(?:\s|$))/g;

/** What a voice can say: no markdown, links, bracketed ids or stray source tags. */
export function speakableTurnText(text: string): string {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(MARKUP, ' ')
    .replace(/\(?\[?\bS\d{1,3}\b\]?\)?/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTurns(raw: unknown, request: PodcastRequest, chapter: PodcastChapterPlan, known: Set<string>, firstId: number): PodcastTurn[] {
  const two = podcastHostCount(request.format, request.hosts.length) === 2;
  const turns = (Array.isArray(asRecord(raw).turns) ? asRecord(raw).turns as unknown[] : []).map(asRecord);
  const out: PodcastTurn[] = [];
  for (const turn of turns) {
    const text = speakableTurnText(String(turn.text ?? ''));
    if (!text) continue;
    const speaker: PodcastSpeaker = two && String(turn.speaker).trim().toUpperCase() === 'B' ? 'B' : 'A';
    const previous = out[out.length - 1];
    const sourceIds = [...new Set(strings(turn.sources ?? turn.sourceIds, 8).filter((id) => known.has(id)))];
    // Two consecutive turns of one host read as one: merging them avoids a speaker-change pause
    // in the middle of a thought.
    if (previous && previous.speaker === speaker && countSpokenWords(previous.text) + countSpokenWords(text) < 90) {
      previous.text = `${previous.text} ${text}`;
      previous.sourceIds = [...new Set([...previous.sourceIds, ...sourceIds])];
      continue;
    }
    out.push({ id: `t${firstId + out.length}`, chapterIndex: chapter.index, speaker, text, sourceIds });
  }
  return out;
}

export async function writeChapter(
  request: PodcastRequest, plan: PodcastPlan, chapter: PodcastChapterPlan, evidence: PodcastEvidence,
  previousTail: PodcastTurn[], firstId: number, deps: Pick<PodcastScriptDeps, 'json'>, signal: AbortSignal,
): Promise<PodcastTurn[]> {
  const pack = podcastPromptPack(request.language);
  const known = new Set(evidence.sources.map((source) => source.id));
  const assigned = evidence.sources.filter((source) => chapter.sourceIds.includes(source.id));
  const user = JSON.stringify({
    episode: { title: plan.title, hook: plan.hook, summary: plan.summary, objective: request.objective },
    language: podcastLanguageName(request.language),
    format: formatBrief(request),
    hosts: hostsBrief(request),
    chapter: {
      number: chapter.index + 1,
      of: plan.chapters.length,
      title: chapter.title,
      goal: chapter.goal,
      keyPoints: chapter.keyPoints,
      isFirst: chapter.index === 0,
      isLast: chapter.index === plan.chapters.length - 1,
    },
    nextChapter: plan.chapters[chapter.index + 1]?.title ?? null,
    targetWords: chapter.targetWords,
    previousTail: previousTail.slice(-3).map((turn) => ({ speaker: turn.speaker, text: turn.text })),
    sources: assigned.map((source) => sourceDigest(source, SOURCE_EXCERPT_CHAPTER)),
    ...(chapter.index === plan.chapters.length - 1 && evidence.gaps.length ? { gaps: evidence.gaps.slice(0, 5) } : {}),
    ...(request.format === 'debate' ? { tensions: evidence.tensions.filter((tension) => tension.sourceIds.some((id) => chapter.sourceIds.includes(id))).slice(0, 4) } : {}),
    spokenRules: pack.spokenRules,
  });
  const maxTokens = Math.min(8_000, Math.max(1_500, Math.round(chapter.targetWords * 3.2)));
  let lastError: unknown = null;
  // One retry: a chapter that comes back empty is worth a second attempt before failing the job.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    abortable(signal);
    try {
      const turns = normalizeTurns(await deps.json({ system: pack.chapterSystem, user, maxTokens, temperature: 0.7, signal }), request, chapter, known, firstId);
      if (turns.length) return turns;
      lastError = new Error('PODCAST_EMPTY_CHAPTER');
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PODCAST_EMPTY_CHAPTER');
}

// ── Review and fit ───────────────────────────────────────────────────────────

export function applyReviewFixes(script: PodcastScript, raw: unknown): PodcastScript {
  const fixes = (Array.isArray(asRecord(raw).fixes) ? asRecord(raw).fixes as unknown[] : []).map(asRecord);
  const byId = new Map(fixes.filter((fix) => typeof fix.turnId === 'string').map((fix) => [String(fix.turnId), fix]));
  const turns = script.turns.flatMap((turn) => {
    const fix = byId.get(turn.id);
    if (!fix) return [turn];
    if (fix.action === 'drop') return [];
    const text = fix.action === 'rewrite' ? speakableTurnText(String(fix.text ?? '')) : '';
    return text ? [{ ...turn, text }] : [turn];
  });
  // Never let a review empty a chapter: if every turn of one was dropped, keep the original.
  const chapters = new Set(script.turns.map((turn) => turn.chapterIndex));
  for (const chapter of chapters) {
    if (!turns.some((turn) => turn.chapterIndex === chapter)) return script;
  }
  return { turns };
}

export async function reviewScript(request: PodcastRequest, script: PodcastScript, evidence: PodcastEvidence, deps: Pick<PodcastScriptDeps, 'json'>, signal: AbortSignal): Promise<PodcastScript> {
  const pack = podcastPromptPack(request.language);
  const cited = new Set(script.turns.flatMap((turn) => turn.sourceIds));
  try {
    const raw = await deps.json({
      system: pack.reviewSystem,
      user: JSON.stringify({
        language: podcastLanguageName(request.language),
        turns: script.turns.map((turn) => ({ id: turn.id, speaker: turn.speaker, text: turn.text, sources: turn.sourceIds })),
        sources: evidence.sources.filter((source) => cited.has(source.id)).map((source) => sourceDigest(source, SOURCE_EXCERPT_CHAPTER)),
      }),
      maxTokens: Math.min(10_000, 1_500 + script.turns.length * 60),
      temperature: 0.1,
      signal,
    });
    return applyReviewFixes(script, raw);
  } catch (error) {
    if (signal.aborted) throw error;
    // A failed review keeps the script: it was written from the sources and the user can still edit it.
    return script;
  }
}

const chapterWords = (script: PodcastScript, index: number) => script.turns.filter((turn) => turn.chapterIndex === index).reduce((sum, turn) => sum + countSpokenWords(turn.text), 0);

/** Rewrites one chapter with `system` towards `target` words; keeps the original when the answer does not move in the asked direction. */
async function rewriteChapter(
  request: PodcastRequest, script: PodcastScript, chapter: PodcastChapterPlan, target: number, system: string, longer: boolean,
  evidence: PodcastEvidence | null, deps: Pick<PodcastScriptDeps, 'json'>, signal: AbortSignal,
): Promise<PodcastScript> {
  const turns = script.turns.filter((turn) => turn.chapterIndex === chapter.index);
  if (!turns.length) return script;
  const words = chapterWords(script, chapter.index);
  const pack = podcastPromptPack(request.language);
  const cited = new Set([...turns.flatMap((turn) => turn.sourceIds), ...chapter.sourceIds]);
  const known = new Set(evidence ? evidence.sources.map((source) => source.id) : script.turns.flatMap((turn) => turn.sourceIds));
  try {
    const raw = await deps.json({
      system,
      user: JSON.stringify({
        language: podcastLanguageName(request.language),
        format: formatBrief(request),
        hosts: hostsBrief(request),
        chapter: { title: chapter.title, goal: chapter.goal, keyPoints: chapter.keyPoints },
        targetWords: target,
        turns: turns.map((turn) => ({ speaker: turn.speaker, text: turn.text, sources: turn.sourceIds })),
        ...(longer && evidence ? { sources: evidence.sources.filter((source) => cited.has(source.id)).map((source) => sourceDigest(source, SOURCE_EXCERPT_CHAPTER)) } : {}),
        spokenRules: pack.spokenRules,
      }),
      maxTokens: Math.min(8_000, Math.max(1_200, target * 3)),
      temperature: longer ? 0.6 : 0.3,
      signal,
    });
    const rewritten = normalizeTurns(raw, request, chapter, known, 1);
    const total = rewritten.reduce((sum, turn) => sum + countSpokenWords(turn.text), 0);
    if (!rewritten.length || (longer ? total <= words : total >= words)) return script;
    return renumber({ turns: script.turns.flatMap((turn) => turn.chapterIndex !== chapter.index ? [turn] : turn === turns[0] ? rewritten : []) });
  } catch (error) {
    if (signal.aborted) throw error;
    return script;
  }
}

/**
 * Brings the script's estimated length into [PODCAST_MIN_FILL × cap, cap]: condenses the longest
 * chapters when it runs over, develops the shortest ones when it comes up short. At most one
 * pass per chapter in each direction; a hard trim is the last resort over the cap.
 */
export async function fitToCap(request: PodcastRequest, plan: PodcastPlan, script: PodcastScript, deps: Pick<PodcastScriptDeps, 'json' | 'wpm'>, signal: AbortSignal, evidence: PodcastEvidence | null = null): Promise<PodcastScript> {
  const wpm = deps.wpm(request);
  const capS = request.durationCapMin * 60;
  const pack = podcastPromptPack(request.language);
  let current = script;
  const estimate = () => estimatePodcastSeconds(current, wpm);
  if (estimate() < capS * PODCAST_MIN_FILL) {
    // Two rounds at most: a model that writes short tends to expand short too.
    for (let round = 0; round < 2 && estimate() < capS * PODCAST_MIN_FILL; round += 1) {
      const short = [...plan.chapters].sort((a, b) => (chapterWords(current, a.index) - a.targetWords) - (chapterWords(current, b.index) - b.targetWords));
      for (const chapter of short) {
        if (estimate() >= capS * PODCAST_MIN_FILL) break;
        abortable(signal);
        const words = chapterWords(current, chapter.index);
        const missingWords = ((capS * 0.92 - estimate()) / 60) * (wpm ?? 150);
        const target = Math.round(Math.min(words * 3, Math.max(chapter.targetWords, words + missingWords / Math.max(1, plan.chapters.length - short.indexOf(chapter)))));
        if (target <= words + 20) continue;
        current = await rewriteChapter(request, current, chapter, target, pack.expandSystem, true, evidence, deps, signal);
      }
    }
    return estimate() > capS ? hardTrim(current, capS, wpm) : current;
  }
  if (estimate() <= capS) return current;
  const order = [...plan.chapters].sort((a, b) => (chapterWords(current, b.index) - b.targetWords) - (chapterWords(current, a.index) - a.targetWords));
  for (const chapter of order) {
    if (estimate() <= capS) break;
    abortable(signal);
    const words = chapterWords(current, chapter.index);
    const target = Math.max(60, Math.min(chapter.targetWords, Math.round(words - ((estimate() - capS) / 60) * (wpm ?? 150) - 20)));
    current = await rewriteChapter(request, current, chapter, target, pack.condenseSystem, false, evidence, deps, signal);
  }
  return hardTrim(current, capS, wpm);
}

/** Last resort for a model that would not condense: drop turns from the longest chapter's middle. */
export function hardTrim(script: PodcastScript, capS: number, wpm: number | null): PodcastScript {
  let turns = [...script.turns];
  let guard = turns.length;
  while (estimatePodcastSeconds({ turns }, wpm) > capS && guard-- > 0) {
    const counts = new Map<number, PodcastTurn[]>();
    turns.forEach((turn) => counts.set(turn.chapterIndex, [...(counts.get(turn.chapterIndex) ?? []), turn]));
    const [, longest] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (longest.length <= 2) break;
    const victim = longest[Math.floor(longest.length / 2)];
    turns = turns.filter((turn) => turn !== victim);
  }
  return { turns };
}

export function renumber(script: PodcastScript): PodcastScript {
  return { turns: script.turns.map((turn, index) => ({ ...turn, id: `t${index + 1}` })) };
}

// ── Orchestration up to the script ───────────────────────────────────────────

/** Runs (or resumes) a job up to a reviewed, fitted script. */
export async function buildPodcastScript(request: PodcastRequest, from: PodcastCheckpoint, deps: PodcastScriptDeps, signal: AbortSignal): Promise<Required<Pick<PodcastCheckpoint, 'evidence' | 'plan' | 'script'>>> {
  const state: PodcastCheckpoint = { ...from };
  if (!state.evidence) {
    deps.progress({ phase: 'researching' });
    const evidence = await deps.gatherEvidence(request, signal, (message) => deps.progress({ phase: 'researching', message }));
    if (!evidence.sources.length) throw new Error('PODCAST_NO_SOURCES');
    state.evidence = evidence;
    deps.checkpoint({ ...state });
  }
  abortable(signal);
  if (!state.plan) {
    deps.progress({ phase: 'planning' });
    state.plan = await planEpisode(request, state.evidence, deps, signal);
    deps.checkpoint({ ...state });
  }
  abortable(signal);
  if (!state.script) {
    const turns: PodcastTurn[] = [];
    const total = state.plan.chapters.length;
    for (const chapter of state.plan.chapters) {
      deps.progress({ phase: 'writing', done: chapter.index, total, message: chapter.title });
      turns.push(...await writeChapter(request, state.plan, chapter, state.evidence, turns, turns.length + 1, deps, signal));
    }
    deps.progress({ phase: 'writing', done: total, total });
    state.script = renumber({ turns });
    deps.checkpoint({ ...state });
  }
  abortable(signal);
  if (!state.reviewed) {
    deps.progress({ phase: 'reviewing' });
    const reviewed = await reviewScript(request, state.script, state.evidence, deps, signal);
    state.script = renumber(await fitToCap(request, state.plan, reviewed, deps, signal, state.evidence));
    state.reviewed = true;
    deps.checkpoint({ ...state });
  }
  return { evidence: state.evidence, plan: state.plan, script: state.script };
}

// ── Recording ────────────────────────────────────────────────────────────────

export interface PodcastRecordDeps {
  /** Voices one turn and returns its fragment files in order. */
  synthesize(text: string, voiceId: string, signal: AbortSignal): Promise<string[]>;
  /** Appends one turn's fragments after `gapBeforeMs` of silence. */
  append(paths: string[], gapBeforeMs: number): Promise<{ startS: number; durationS: number }>;
  progress(progress: PodcastProgress): void;
}

export function gapBefore(previous: PodcastTurn | undefined, turn: PodcastTurn): number {
  if (!previous) return 0;
  if (previous.chapterIndex !== turn.chapterIndex) return PODCAST_GAPS_MS.chapter;
  return previous.speaker !== turn.speaker ? PODCAST_GAPS_MS.speakerChange : PODCAST_GAPS_MS.sameSpeaker;
}

/** Voices every turn in order and returns the timeline of turns and chapters. */
export async function recordScript(request: PodcastRequest, plan: PodcastPlan, script: PodcastScript, wpm: number | null, deps: PodcastRecordDeps, signal: AbortSignal): Promise<PodcastTimeline> {
  const voices = new Map(request.hosts.map((host) => [host.speaker, host.voiceId]));
  const estimatedS = Math.round(estimatePodcastSeconds(script, wpm));
  const timeline: PodcastTimeline = { turns: [], chapters: [] };
  let recordedS = 0;
  for (const [index, turn] of script.turns.entries()) {
    abortable(signal);
    deps.progress({ phase: 'recording', done: index, total: script.turns.length, recordedS: Math.round(recordedS), estimatedS });
    const voiceId = voices.get(turn.speaker) ?? request.hosts[0].voiceId;
    const paths = await deps.synthesize(turn.text, voiceId, signal);
    if (!paths.length) continue;
    const placed = await deps.append(paths, gapBefore(script.turns[index - 1], turn));
    timeline.turns.push({ turnId: turn.id, startS: placed.startS, durationS: placed.durationS });
    if (!timeline.chapters.some((chapter) => chapter.index === turn.chapterIndex)) {
      timeline.chapters.push({ index: turn.chapterIndex, title: plan.chapters[turn.chapterIndex]?.title ?? '', startS: placed.startS });
    }
    recordedS = placed.startS + placed.durationS;
  }
  if (!timeline.turns.length) throw new Error('PODCAST_NOTHING_RECORDED');
  deps.progress({ phase: 'recording', done: script.turns.length, total: script.turns.length, recordedS: Math.round(recordedS), estimatedS });
  return timeline;
}

/** Seconds of speech in a timeline (pauses excluded), for calibrating the voices' pace. */
export function speechSeconds(timeline: PodcastTimeline): number {
  return timeline.turns.reduce((sum, turn) => sum + turn.durationS, 0);
}
