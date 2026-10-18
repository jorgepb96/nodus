import { deleteDocumentVisuals } from '../capabilities/documentStore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { v4 as uuid } from 'uuid';
import type {
  ImmersionAnswerRecord,
  ImmersionPlan,
  ImmersionPlanStats,
  ImmersionProgress,
  ImmersionSession,
  ImmersionSessionSummary,
  ModelRef,
} from '@shared/types';
import { getDb } from './database';
import {normalizePromptLanguage} from '@shared/promptLanguageOptions';
import { immersionAnnotationDocumentId } from '@shared/readerAnnotations';
import { normalizeBareCitations } from '../ai/immersionCore';
import { deleteDecorativeImageRow, getDecorativeImage } from './decorativeImagesRepo';
import { deleteAnnotationsForWritingDraft } from './writingAnnotationsRepo';

interface SessionRow {
  id: string;
  topic: string;
  title: string;
  language: string;
  minutes: number;
  model_json: string | null;
  plan_json: string;
  progress_json: string;
  stats_json: string;
  created_at: string;
  updated_at: string;
}

const EMPTY_STATS: ImmersionPlanStats = { stations: 0, ideas: 0, works: 0, authors: 0, citations: 0, quizQuestions: 0 };

export function emptyImmersionProgress(): ImmersionProgress {
  return {
    currentStep: 0,
    furthestStep: 0,
    completedSteps: [],
    answers: [],
    startedAt: null,
    finishedAt: null,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeProgress(value: unknown): ImmersionProgress {
  const empty = emptyImmersionProgress();
  if (!value || typeof value !== 'object') return empty;
  const o = value as Partial<ImmersionProgress>;
  return {
    currentStep: Math.max(0, Number(o.currentStep ?? 0)),
    furthestStep: Math.max(0, Number(o.furthestStep ?? 0)),
    completedSteps: Array.isArray(o.completedSteps) ? o.completedSteps.map(Number).filter((n) => Number.isFinite(n)) : [],
    answers: Array.isArray(o.answers) ? (o.answers as ImmersionAnswerRecord[]) : [],
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : null,
    finishedAt: typeof o.finishedAt === 'string' ? o.finishedAt : null,
  };
}

/**
 * Fill fields added after a plan was stored and repair citation markup in plans
 * generated before the bare-url normalizer existed, so old sessions replay
 * cleanly (chips instead of raw nodus:// text).
 */
function normalizePlan(plan: ImmersionPlan): ImmersionPlan {
  const labels = new Map<string, string>();
  for (const ref of plan.ideaIndex ?? []) labels.set(`nodus://idea/${ref.id}`, ref.label);
  for (const station of plan.stations ?? []) {
    for (const citation of station.citations ?? []) {
      const surname = (citation.authors?.[0] ?? '').split(',')[0].trim() || citation.workTitle;
      const label = [surname, citation.year ?? '', citation.pageLabel ? `p. ${citation.pageLabel}` : ''].filter(Boolean).join(', ');
      labels.set(`nodus://passage/${citation.passageId}`, label);
      labels.set(`nodus://passage/${encodeURIComponent(citation.passageId)}`, label);
    }
  }
  plan.overview = normalizeBareCitations(typeof plan.overview === 'string' ? plan.overview : '', labels);
  for (const station of plan.stations ?? []) {
    station.context = normalizeBareCitations(typeof station.context === 'string' ? station.context : '', labels);
    station.synthesis = normalizeBareCitations(typeof station.synthesis === 'string' ? station.synthesis : '', labels);
    station.takeaways = Array.isArray(station.takeaways) ? station.takeaways : [];
    for (const citation of station.citations ?? []) {
      citation.commentary = typeof citation.commentary === 'string' ? citation.commentary : '';
    }
  }
  return plan;
}

function toSession(row: SessionRow): ImmersionSession | null {
  const plan = parseJson<ImmersionPlan | null>(row.plan_json, null);
  if (!plan) return null;
  normalizePlan(plan);
  return {
    id: row.id,
    topic: row.topic,
    language: normalizePromptLanguage(row.language),
    minutes: row.minutes,
    model: parseJson<ModelRef | null>(row.model_json, null),
    plan,
    progress: normalizeProgress(parseJson<unknown>(row.progress_json, null)),
    image: getDecorativeImage('immersion', row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Total number of player steps a plan produces: panorama + stations + contrasts + frontiers + exam. */
export function immersionStepCount(stats: ImmersionPlanStats): number {
  return 1 + stats.stations + 3;
}

function toSummary(row: SessionRow): ImmersionSessionSummary {
  const stats = { ...EMPTY_STATS, ...parseJson<Partial<ImmersionPlanStats>>(row.stats_json, {}) };
  const progress = normalizeProgress(parseJson<unknown>(row.progress_json, null));
  const steps = immersionStepCount(stats);
  const pct = progress.finishedAt
    ? 100
    : Math.max(0, Math.min(99, Math.round((progress.completedSteps.length / Math.max(1, steps)) * 100)));
  return {
    id: row.id,
    topic: row.topic,
    title: row.title || row.topic,
    language: normalizePromptLanguage(row.language),
    minutes: row.minutes,
    stats,
    progressPct: pct,
    finished: progress.finishedAt != null,
    image: getDecorativeImage('immersion', row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveImmersionSession(plan: ImmersionPlan, model: ModelRef | null): ImmersionSession {
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuid();
  const progress = emptyImmersionProgress();
  db.prepare(
    `INSERT INTO immersion_sessions (
       id, topic, title, language, minutes, model_json, plan_json, progress_json, stats_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    plan.topic,
    plan.title,
    plan.language,
    plan.minutes,
    model ? JSON.stringify(model) : null,
    JSON.stringify(plan),
    JSON.stringify(progress),
    JSON.stringify(plan.stats),
    now,
    now
  );
  return { id, topic: plan.topic, language: plan.language, minutes: plan.minutes, model, plan, progress, image: null, createdAt: now, updatedAt: now };
}

export function listImmersionSessions(): ImmersionSessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, topic, title, language, minutes, model_json, '' AS plan_json, progress_json, stats_json, created_at, updated_at
         FROM immersion_sessions
        ORDER BY updated_at DESC`
    )
    .all() as SessionRow[];
  return rows.map(toSummary);
}

export function getImmersionSession(id: string): ImmersionSession | null {
  const row = getDb().prepare('SELECT * FROM immersion_sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

export function setImmersionProgress(id: string, progress: ImmersionProgress): void {
  getDb()
    .prepare('UPDATE immersion_sessions SET progress_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(normalizeProgress(progress)), new Date().toISOString(), id);
}

/** Start a saved route again without regenerating its AI-authored content. */
export function restartImmersionSession(id: string): ImmersionSession | null {
  if (!getImmersionSession(id)) return null;
  setImmersionProgress(id, emptyImmersionProgress());
  return getImmersionSession(id);
}

/** Append (or replace) one answer inside the stored progress and persist atomically. */
export function recordImmersionAnswer(id: string, record: ImmersionAnswerRecord): ImmersionProgress {
  const session = getImmersionSession(id);
  if (!session) throw new Error('Sesión de inmersión no encontrada');
  const answers = session.progress.answers.filter((a) => a.questionId !== record.questionId);
  answers.push(record);
  const next: ImmersionProgress = { ...session.progress, answers };
  setImmersionProgress(id, next);
  return next;
}

export function deleteImmersionSession(id: string): void {
  deleteDocumentVisuals(getActiveVault().id, { kind: 'immersion', id });
  deleteDecorativeImageRow('immersion', id);
  deleteAnnotationsForWritingDraft(immersionAnnotationDocumentId(id));
  getDb().prepare('DELETE FROM immersion_sessions WHERE id = ?').run(id);
}
