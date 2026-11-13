// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved podcast episodes and their images (migration 207). Like completeGuideRepo, every
 * function takes an optional minimal connection so the same code runs on better-sqlite3 in
 * the app and on node:sqlite in tests. Rows are machine-local; see the migration.
 */
import { getDb } from './database';
import {
  type PodcastEpisode, type PodcastEpisodeSummary, type PodcastGeneration, type PodcastImageInfo,
  type PodcastImageStatus, type PodcastPlan, type PodcastRequest, type PodcastScript, type PodcastSource, type PodcastTimeline,
} from '@shared/podcast';

export interface PodcastStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface PodcastDb { prepare(sql: string): PodcastStatement }

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const db = (override?: PodcastDb): PodcastDb => override ?? (getDb() as unknown as PodcastDb);

function json<T>(value: unknown, fallback: T): T {
  try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; }
}

const SUMMARY_COLUMNS = `e.id, e.title, e.objective, e.format, e.language, e.engine, e.model_id, e.voices_json,
  e.duration_cap_min, e.duration_s, e.audio_mime, e.audio_bytes, e.listened_position_s, e.listened_at,
  e.created_at, e.updated_at, e.plan_json,
  (SELECT COUNT(*) FROM podcast_images i WHERE i.episode_id = e.id AND i.status = 'ready') AS image_count`;

function summaryOf(row: Row): PodcastEpisodeSummary {
  const plan = json<Partial<PodcastPlan>>(row.plan_json, {});
  return {
    id: String(row.id),
    title: String(row.title),
    objective: String(row.objective ?? ''),
    format: String(row.format) as PodcastEpisodeSummary['format'],
    language: String(row.language) as PodcastEpisodeSummary['language'],
    engine: String(row.engine) === 'phonon' ? 'phonon' : String(row.engine) === 'ming' ? 'ming' : 'kokoro',
    ttsModelId: String(row.model_id),
    hosts: json(row.voices_json, []),
    durationCapMin: Number(row.duration_cap_min) || 0,
    durationS: Number(row.duration_s) || 0,
    audioMime: String(row.audio_mime ?? ''),
    audioBytes: Number(row.audio_bytes) || 0,
    listenedPositionS: Number(row.listened_position_s) || 0,
    listenedAt: row.listened_at == null ? null : String(row.listened_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    chapterCount: Array.isArray(plan.chapters) ? plan.chapters.length : 0,
    imageCount: Number(row.image_count) || 0,
  };
}

export function listPodcastEpisodes(database?: PodcastDb): PodcastEpisodeSummary[] {
  return (db(database).prepare(`SELECT ${SUMMARY_COLUMNS} FROM podcast_episodes e ORDER BY e.created_at DESC`).all() as Row[]).map(summaryOf);
}

export function getPodcastEpisode(id: string, database?: PodcastDb): PodcastEpisode | null {
  const row = db(database).prepare(`SELECT ${SUMMARY_COLUMNS}, e.request_json, e.script_json, e.sources_json, e.research_log, e.timings_json, e.generation_json
    FROM podcast_episodes e WHERE e.id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  return {
    ...summaryOf(row),
    request: json<PodcastRequest>(row.request_json, {} as PodcastRequest),
    plan: json<PodcastPlan>(row.plan_json, { title: '', hook: '', summary: '', chapters: [], images: [] }),
    script: json<PodcastScript>(row.script_json, { turns: [] }),
    sources: json<PodcastSource[]>(row.sources_json, []),
    researchLog: String(row.research_log ?? ''),
    timeline: json<PodcastTimeline>(row.timings_json, { turns: [], chapters: [] }),
    generation: json<PodcastGeneration>(row.generation_json, { ttsModelId: String(row.model_id), engine: 'kokoro', codec: '' }),
  };
}

export interface PodcastEpisodeInput {
  id: string;
  title: string;
  request: PodcastRequest;
  plan: PodcastPlan;
  script: PodcastScript;
  sources: PodcastSource[];
  researchLog: string;
  timeline: PodcastTimeline;
  durationS: number;
  audioFile: string;
  audioMime: string;
  audioBytes: number;
  generation: PodcastGeneration;
}

export function savePodcastEpisode(input: PodcastEpisodeInput, database?: PodcastDb): void {
  const stamp = now();
  db(database).prepare(`INSERT INTO podcast_episodes (
      id, title, objective, format, language, engine, model_id, voices_json, duration_cap_min, duration_s,
      request_json, plan_json, script_json, sources_json, research_log, timings_json,
      audio_file, audio_mime, audio_bytes, generation_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, duration_s = excluded.duration_s, plan_json = excluded.plan_json,
      script_json = excluded.script_json, sources_json = excluded.sources_json, research_log = excluded.research_log,
      timings_json = excluded.timings_json, audio_file = excluded.audio_file, audio_mime = excluded.audio_mime,
      audio_bytes = excluded.audio_bytes, generation_json = excluded.generation_json, updated_at = excluded.updated_at`).run(
    input.id, input.title, input.request.objective, input.request.format, input.request.language,
    input.generation.engine, input.request.ttsModelId, JSON.stringify(input.request.hosts), input.request.durationCapMin, input.durationS,
    JSON.stringify(input.request), JSON.stringify(input.plan), JSON.stringify(input.script), JSON.stringify(input.sources),
    input.researchLog, JSON.stringify(input.timeline), input.audioFile, input.audioMime, input.audioBytes,
    JSON.stringify(input.generation), stamp, stamp,
  );
}

export function renamePodcastEpisode(id: string, title: string, database?: PodcastDb): void {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) throw new Error('PODCAST_EMPTY_TITLE');
  db(database).prepare('UPDATE podcast_episodes SET title = ?, updated_at = ? WHERE id = ?').run(clean, now(), id);
}

/** Remembers where listening stopped; does not touch `updated_at`, which orders edits, not playback. */
export function setPodcastListenPosition(id: string, positionS: number, database?: PodcastDb): void {
  const position = Number.isFinite(positionS) && positionS > 0 ? positionS : 0;
  db(database).prepare('UPDATE podcast_episodes SET listened_position_s = ?, listened_at = ? WHERE id = ?').run(position, now(), id);
}

/** Removes the row (images cascade) and returns the audio file name so the caller can delete it. */
export function deletePodcastEpisode(id: string, database?: PodcastDb): string | null {
  const row = db(database).prepare('SELECT audio_file FROM podcast_episodes WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db(database).prepare('DELETE FROM podcast_images WHERE episode_id = ?').run(id);
  db(database).prepare('DELETE FROM podcast_episodes WHERE id = ?').run(id);
  return String(row.audio_file ?? '') || null;
}

export function podcastAudioFile(id: string, database?: PodcastDb): { file: string; mime: string } | null {
  const row = db(database).prepare('SELECT audio_file, audio_mime FROM podcast_episodes WHERE id = ?').get(id) as Row | undefined;
  return row && row.audio_file ? { file: String(row.audio_file), mime: String(row.audio_mime) } : null;
}

// ── Images ────────────────────────────────────────────────────────────────────

export function putPodcastImagePlaceholder(episodeId: string, slot: number, chapterIndex: number | null, prompt: string, style: string, database?: PodcastDb): void {
  db(database).prepare(`INSERT INTO podcast_images (episode_id, slot, chapter_index, status, prompt, style, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
    ON CONFLICT(episode_id, slot) DO UPDATE SET chapter_index = excluded.chapter_index, status = 'pending',
      prompt = excluded.prompt, style = excluded.style, error = NULL, updated_at = excluded.updated_at`).run(episodeId, slot, chapterIndex, prompt, style, now());
}

export function setPodcastImageStatus(episodeId: string, slot: number, status: PodcastImageStatus, error?: string, database?: PodcastDb): void {
  db(database).prepare('UPDATE podcast_images SET status = ?, error = ?, updated_at = ? WHERE episode_id = ? AND slot = ?')
    .run(status, error ?? null, now(), episodeId, slot);
}

export function setPodcastImageData(episodeId: string, slot: number, data: { mime: string; image: Uint8Array; thumbnail: Uint8Array; thumbnailMime?: string; provider: string; model: string }, database?: PodcastDb): void {
  db(database).prepare(`UPDATE podcast_images SET status = 'ready', mime = ?, thumbnail_mime = ?, image = ?, thumbnail = ?, provider = ?, model = ?, error = NULL, updated_at = ?
    WHERE episode_id = ? AND slot = ?`).run(data.mime, data.thumbnailMime ?? data.mime, data.image, data.thumbnail, data.provider, data.model, now(), episodeId, slot);
}

export function listPodcastImages(episodeId: string, database?: PodcastDb): PodcastImageInfo[] {
  return (db(database).prepare('SELECT slot, chapter_index, status, prompt, mime, error FROM podcast_images WHERE episode_id = ? ORDER BY slot').all(episodeId) as Row[])
    .map((row) => ({
      slot: Number(row.slot),
      chapterIndex: row.chapter_index == null ? null : Number(row.chapter_index),
      status: String(row.status) as PodcastImageStatus,
      prompt: String(row.prompt ?? ''),
      mime: String(row.mime ?? ''),
      ...(row.error ? { error: String(row.error) } : {}),
    }));
}

export function getPodcastImageBytes(episodeId: string, slot: number, variant: 'image' | 'thumbnail', database?: PodcastDb): { mime: string; bytes: Uint8Array } | null {
  const thumbnail = variant === 'thumbnail';
  const row = db(database).prepare(`SELECT ${thumbnail ? "COALESCE(NULLIF(thumbnail_mime, ''), mime)" : 'mime'} AS mime, ${thumbnail ? 'thumbnail' : 'image'} AS bytes
    FROM podcast_images WHERE episode_id = ? AND slot = ? AND status = 'ready'`).get(episodeId, slot) as Row | undefined;
  if (!row || !row.bytes) return null;
  return { mime: String(row.mime || 'image/png'), bytes: row.bytes as Uint8Array };
}

/** Images left `generating` by a quit become failed, so the UI offers a retry instead of a spinner forever. */
export function failInterruptedPodcastImages(database?: PodcastDb): void {
  db(database).prepare("UPDATE podcast_images SET status = 'failed', error = 'interrupted', updated_at = ? WHERE status IN ('pending', 'generating')").run(now());
}
