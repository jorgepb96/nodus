// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Podcast episodes: a topic researched in the active vault, written as a spoken script for
 * one or two hosts, voiced locally (Kokoro or Phonon) and compressed. Everything here is
 * pure so the renderer, the main-process lane and the tests share one definition.
 */
import type { DecorativeImageStyle, ModelRef, ResearchWebSearchMode } from './types';
import type { ResearchEffort } from './researchReasoning';

export const PODCAST_FORMATS = ['conversation', 'debate', 'lesson', 'essay'] as const;
export type PodcastFormat = (typeof PODCAST_FORMATS)[number];

/** Upper bounds the user picks from. The episode aims a little under, never over. */
export const PODCAST_DURATIONS_MIN = [5, 10, 15, 20, 30] as const;
export type PodcastDurationMin = (typeof PODCAST_DURATIONS_MIN)[number];

export const PODCAST_AUDIENCES = ['general', 'university', 'specialist'] as const;
export type PodcastAudience = (typeof PODCAST_AUDIENCES)[number];

/** Languages some podcast engine can speak (Kokoro: es/en; Phonon: es/en/fr/de/pt). */
export const PODCAST_LANGUAGES = ['es', 'en', 'fr', 'de', 'pt'] as const;
export type PodcastLanguage = (typeof PODCAST_LANGUAGES)[number];

/** Ming (MLX/PyTorch) speaks Spanish and English very naturally and accepts cloned voices. */
export const PODCAST_ENGINES = ['kokoro', 'phonon', 'ming'] as const;
export type PodcastEngine = (typeof PODCAST_ENGINES)[number];

export const PODCAST_MAX_EXTRA_IMAGES = 6;

export type PodcastSpeaker = 'A' | 'B';

export interface PodcastHost {
  speaker: PodcastSpeaker;
  /** App voice id: `kokoro:<name>`, `phonon:<id>`, or a Ming voice (`ming:`, `user:`, `cc0:`). */
  voiceId: string;
  /** The name the script uses for this host. */
  name: string;
}

export interface PodcastRequest {
  objective: string;
  format: PodcastFormat;
  language: PodcastLanguage;
  /** The TTS checkpoint (`kokoro-82m-int8`, `phonon-40m-es`, …). Both hosts use it. */
  ttsModelId: string;
  hosts: PodcastHost[];
  audience: PodcastAudience;
  durationCapMin: PodcastDurationMin;
  /** Text model for research and writing; falls back to the podcast, then Deep Research, then synthesis model. */
  model?: ModelRef | null;
  thinkingEffort?: ResearchEffort;
  /** Academic vaults only. Absent means corpus only. */
  webSearch?: ResearchWebSearchMode;
  notebookId?: string | null;
  cover: boolean;
  /** Images beyond the cover, spread over the chapters (0–6). */
  extraImages: number;
  imageStyle?: DecorativeImageStyle;
  /** Stop after the script so the user can edit it before any audio is made. */
  reviewScript: boolean;
}

/** Formats whose number of hosts is fixed; `lesson` follows the request. */
export function podcastHostCount(format: PodcastFormat, requested = 1): 1 | 2 {
  if (format === 'conversation' || format === 'debate') return 2;
  if (format === 'essay') return 1;
  return requested >= 2 ? 2 : 1;
}

export type PodcastSourceKind = 'passage' | 'idea' | 'work' | 'web' | 'material' | 'note';

export interface PodcastSource {
  /** Stable within one episode: `S1`, `S2`… so the model can cite compactly. */
  id: string;
  kind: PodcastSourceKind;
  title: string;
  authors?: string;
  year?: number | string | null;
  location?: string;
  excerpt: string;
  /** In-app link (`nodus://passage/…`) or web URL, for the Sources tab. */
  link?: string;
  url?: string;
}

export interface PodcastTension { id: string; summary: string; sourceIds: string[] }

export interface PodcastEvidence {
  sources: PodcastSource[];
  /** Disagreements found in the corpus: the material of a debate. */
  tensions: PodcastTension[];
  /** Open questions the corpus leaves: a good closing. */
  gaps: string[];
  /** Plain-language account of what was consulted. */
  log: string;
}

export interface PodcastChapterPlan {
  index: number;
  title: string;
  goal: string;
  keyPoints: string[];
  sourceIds: string[];
  targetWords: number;
}

export interface PodcastImagePlan {
  /** 0 is the cover; 1… are chapter images. */
  slot: number;
  chapterIndex: number | null;
  idea: string;
}

export interface PodcastPlan {
  title: string;
  hook: string;
  summary: string;
  chapters: PodcastChapterPlan[];
  images: PodcastImagePlan[];
}

export interface PodcastTurn {
  id: string;
  chapterIndex: number;
  speaker: PodcastSpeaker;
  text: string;
  sourceIds: string[];
}

export interface PodcastScript { turns: PodcastTurn[] }

export interface PodcastTurnTiming { turnId: string; startS: number; durationS: number }
export interface PodcastChapterTiming { index: number; title: string; startS: number }
export interface PodcastTimeline { turns: PodcastTurnTiming[]; chapters: PodcastChapterTiming[] }

export type PodcastPhase =
  | 'queued' | 'researching' | 'planning' | 'writing' | 'reviewing'
  | 'awaiting_review' | 'recording' | 'encoding' | 'images' | 'saving'
  | 'done' | 'failed' | 'cancelled';

export type PodcastJobStatus = 'queued' | 'running' | 'awaiting_review' | 'done' | 'failed' | 'cancelled';

/** What a job has finished so far; a restart resumes after the last stage. */
export interface PodcastCheckpoint {
  evidence?: PodcastEvidence;
  plan?: PodcastPlan;
  script?: PodcastScript;
  /** Set once the fact review ran (or the user approved an edited script). */
  reviewed?: boolean;
  /** The text model that wrote it, for the episode's metadata. */
  writtenWith?: string;
}

export interface PodcastJob {
  id: string;
  vaultId: string;
  request: PodcastRequest;
  status: PodcastJobStatus;
  phase: PodcastPhase;
  message?: string;
  /** Recording: seconds voiced so far against the script's estimate. */
  recordedS?: number;
  estimatedS?: number;
  /** Writing: chapters written; recording: turns voiced. */
  done?: number;
  total?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  episodeId?: string;
  checkpoint?: PodcastCheckpoint;
  /** Lets the gallery show the planned title before the episode exists. */
  title?: string;
}

export interface PodcastGeneration {
  textModel?: string;
  ttsModelId: string;
  engine: PodcastEngine;
  codec: string;
  wordsPerMinute?: number;
}

export interface PodcastEpisodeSummary {
  id: string;
  title: string;
  objective: string;
  format: PodcastFormat;
  language: PodcastLanguage;
  engine: PodcastEngine;
  ttsModelId: string;
  hosts: PodcastHost[];
  durationCapMin: number;
  durationS: number;
  audioMime: string;
  audioBytes: number;
  listenedPositionS: number;
  listenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  imageCount: number;
}

export interface PodcastEpisode extends PodcastEpisodeSummary {
  request: PodcastRequest;
  plan: PodcastPlan;
  script: PodcastScript;
  sources: PodcastSource[];
  researchLog: string;
  timeline: PodcastTimeline;
  generation: PodcastGeneration;
}

export type PodcastImageStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface PodcastImageInfo {
  slot: number;
  chapterIndex: number | null;
  status: PodcastImageStatus;
  prompt: string;
  mime: string;
  error?: string;
}

// ── Duration ──────────────────────────────────────────────────────────────────

/** Spoken words per minute before anything was measured on this machine. */
export const DEFAULT_PODCAST_WPM = 170;
/**
 * Measured pace of each engine at speed 1.0 (2026-11-08, two five-minute conversations:
 * Kokoro es 183 wpm, Phonon en 175 wpm). Starting from these instead of a generic 150 is what
 * keeps a five-minute episode from coming out at four; every finished episode then refines
 * the figure for its exact voices.
 */
export const PODCAST_ENGINE_WPM: Record<PodcastEngine, number> = { kokoro: 180, phonon: 172, ming: 165 };
/** The script aims at this share of the cap: close to it, with room for slower voices and pauses. */
export const PODCAST_DURATION_FILL = 0.93;
/** Below this share of the cap, the shortest chapters are developed further. */
export const PODCAST_MIN_FILL = 0.82;

/** The pace to plan with: what this machine measured for these voices, else the engine's. */
export function podcastPlanningWpm(engine: PodcastEngine | null, measured: number | null | undefined): number {
  return typeof measured === 'number' && Number.isFinite(measured) && measured >= 90 && measured <= 230
    ? measured
    : engine ? PODCAST_ENGINE_WPM[engine] : DEFAULT_PODCAST_WPM;
}

/** Silence inserted while assembling, in milliseconds. */
export const PODCAST_GAPS_MS = { sameSpeaker: 180, speakerChange: 350, chapter: 900 } as const;

export function countSpokenWords(text: string): number {
  const words = String(text ?? '').trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

export function clampWpm(wpm: number | null | undefined): number {
  return typeof wpm === 'number' && Number.isFinite(wpm) && wpm >= 90 && wpm <= 230 ? wpm : DEFAULT_PODCAST_WPM;
}

/** The script's word target for a cap, at the measured (or default) rate. */
export function podcastWordBudget(capMin: number, wpm?: number | null): number {
  return Math.round(capMin * clampWpm(wpm) * PODCAST_DURATION_FILL);
}

/** Chapters for a duration: about one per four minutes, never fewer than two. */
export function podcastChapterCount(capMin: number): number {
  return Math.max(2, Math.min(8, Math.round(capMin / 4) + 1));
}

/** Seconds a script will last: speech plus the silences the assembler adds. */
export function estimatePodcastSeconds(script: PodcastScript, wpm?: number | null): number {
  const words = script.turns.reduce((sum, turn) => sum + countSpokenWords(turn.text), 0);
  let pauses = 0;
  script.turns.forEach((turn, index) => {
    if (!index) return;
    const previous = script.turns[index - 1];
    pauses += previous.chapterIndex !== turn.chapterIndex
      ? PODCAST_GAPS_MS.chapter
      : previous.speaker !== turn.speaker ? PODCAST_GAPS_MS.speakerChange : PODCAST_GAPS_MS.sameSpeaker;
  });
  return (words / clampWpm(wpm)) * 60 + pauses / 1000;
}

/** Splits a word budget across chapters: opening and closing a little shorter than the body. */
export function allocateChapterWords(total: number, chapters: number): number[] {
  if (chapters <= 0) return [];
  if (chapters === 1) return [total];
  const weights = Array.from({ length: chapters }, (_, index) => (index === 0 || index === chapters - 1 ? 0.7 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((weight) => Math.max(60, Math.round((total * weight) / sum)));
  return raw;
}

/** The wpm a finished episode actually achieved, for calibrating the next one. */
export function measuredWpm(script: PodcastScript, speechSeconds: number): number | null {
  const words = script.turns.reduce((sum, turn) => sum + countSpokenWords(turn.text), 0);
  if (speechSeconds < 20 || words < 50) return null;
  const wpm = words / (speechSeconds / 60);
  return wpm >= 90 && wpm <= 230 ? Math.round(wpm) : null;
}

/** Folds a new measurement into a stored rate so one odd episode cannot swing it. */
export function blendWpm(previous: number | null | undefined, measured: number): number {
  return typeof previous === 'number' && Number.isFinite(previous) ? Math.round(previous * 0.6 + measured * 0.4) : measured;
}

// ── Images ────────────────────────────────────────────────────────────────────

/** Which chapters get the extra images: spread evenly, first chapter first. */
export function spreadImageChapters(chapters: number, images: number): number[] {
  const count = Math.max(0, Math.min(images, chapters, PODCAST_MAX_EXTRA_IMAGES));
  if (!count) return [];
  if (count === chapters) return Array.from({ length: chapters }, (_, index) => index);
  return Array.from({ length: count }, (_, index) => Math.round((index * (chapters - 1)) / Math.max(1, count - 1)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Normalizes untrusted input (IPC, a persisted queue) into a request or throws a code. */
export function normalizePodcastRequest(input: unknown): PodcastRequest {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const objective = String(raw.objective ?? '').trim().slice(0, 4000);
  if (!objective) throw new Error('PODCAST_EMPTY_OBJECTIVE');
  const format = (PODCAST_FORMATS as readonly string[]).includes(String(raw.format)) ? raw.format as PodcastFormat : 'conversation';
  const language = (PODCAST_LANGUAGES as readonly string[]).includes(String(raw.language)) ? raw.language as PodcastLanguage : 'es';
  const ttsModelId = String(raw.ttsModelId ?? '').trim();
  if (!ttsModelId) throw new Error('PODCAST_NO_TTS_MODEL');
  const hostsRaw = Array.isArray(raw.hosts) ? raw.hosts : [];
  const wanted = podcastHostCount(format, hostsRaw.length);
  const hosts: PodcastHost[] = hostsRaw.slice(0, wanted).map((host, index) => {
    const value = (host && typeof host === 'object' ? host : {}) as Record<string, unknown>;
    const voiceId = String(value.voiceId ?? '').trim();
    const name = String(value.name ?? '').trim().slice(0, 40);
    return { speaker: index === 0 ? 'A' : 'B', voiceId, name: name || (index === 0 ? 'A' : 'B') };
  });
  if (hosts.length !== wanted || hosts.some((host) => !host.voiceId)) throw new Error('PODCAST_VOICES_REQUIRED');
  const engine = podcastEngineOf(hosts[0].voiceId);
  if (!engine || hosts.some((host) => podcastEngineOf(host.voiceId) !== engine)) throw new Error('PODCAST_VOICE_ENGINE_MISMATCH');
  const audience = (PODCAST_AUDIENCES as readonly string[]).includes(String(raw.audience)) ? raw.audience as PodcastAudience : 'general';
  const cap = Number(raw.durationCapMin);
  const durationCapMin = ((PODCAST_DURATIONS_MIN as readonly number[]).includes(cap) ? cap : 10) as PodcastDurationMin;
  const extra = Math.round(Number(raw.extraImages ?? 0));
  const model = raw.model && typeof raw.model === 'object' && typeof (raw.model as ModelRef).model === 'string' ? raw.model as ModelRef : null;
  return {
    objective,
    format,
    language,
    ttsModelId,
    hosts,
    audience,
    durationCapMin,
    model,
    ...(typeof raw.thinkingEffort === 'string' ? { thinkingEffort: raw.thinkingEffort as ResearchEffort } : {}),
    webSearch: raw.webSearch === 'auto' ? 'auto' : 'off',
    notebookId: typeof raw.notebookId === 'string' && raw.notebookId ? raw.notebookId : null,
    cover: raw.cover !== false,
    extraImages: Number.isFinite(extra) ? Math.max(0, Math.min(PODCAST_MAX_EXTRA_IMAGES, extra)) : 0,
    ...(typeof raw.imageStyle === 'string' ? { imageStyle: raw.imageStyle as DecorativeImageStyle } : {}),
    reviewScript: raw.reviewScript === true,
  };
}

/** The engine a voice belongs to: Ming owns its built-in voices and every cloned one. */
export function podcastEngineOf(voiceId: string): PodcastEngine | null {
  const prefix = voiceId.split(':')[0];
  if (prefix === 'kokoro' || prefix === 'phonon') return prefix;
  if (prefix === 'ming' || prefix === 'user' || prefix === 'cc0') return 'ming';
  return null;
}

/** Normalizes a script edited in the renderer: known speakers, non-empty text, chapters in range. */
export function normalizePodcastScript(input: unknown, hosts: number, chapters: number): PodcastScript {
  const raw = (input && typeof input === 'object' ? input : {}) as { turns?: unknown };
  const turns = (Array.isArray(raw.turns) ? raw.turns : []).flatMap((turn, index): PodcastTurn[] => {
    const value = (turn && typeof turn === 'object' ? turn : {}) as Record<string, unknown>;
    const text = String(value.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!text) return [];
    const speaker: PodcastSpeaker = hosts >= 2 && value.speaker === 'B' ? 'B' : 'A';
    const chapter = Math.round(Number(value.chapterIndex ?? 0));
    return [{
      id: typeof value.id === 'string' && value.id ? value.id.slice(0, 40) : `t${index + 1}`,
      chapterIndex: Number.isFinite(chapter) ? Math.max(0, Math.min(Math.max(0, chapters - 1), chapter)) : 0,
      speaker,
      text,
      sourceIds: Array.isArray(value.sourceIds) ? value.sourceIds.filter((id): id is string => typeof id === 'string').slice(0, 12) : [],
    }];
  });
  if (!turns.length) throw new Error('PODCAST_EMPTY_SCRIPT');
  const seen = new Set<string>();
  for (const turn of turns) {
    if (seen.has(turn.id)) turn.id = `${turn.id}-${seen.size}`;
    seen.add(turn.id);
  }
  return { turns };
}
