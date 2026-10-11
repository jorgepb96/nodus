// The manuscript (schema v100).
//
// The prose of a scene, the chapter it opens, and the word diary. Three small tables and one
// rule that shapes every function here: THE TEXT NEVER TRAVELS WITH A LIST. `manuscriptSpine`
// returns titles, statuses and counts for the whole book without reading a single word of it;
// only `getSceneText` reads prose, and only for one scene.
//
// Everything else this section seems to need already exists somewhere else — the order is
// `narrative_order`, the dates are the day chain, what a scene must do is its beats — which
// is why this file is as short as it is.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { indexEntryLinks, promoteWorldLinks } from './worldEncyclopediaRepo';
import { countWords, localDay, todayDelta, type SpineScene, type WordDay } from '@shared/worldManuscript';
import {
  checkCast,
  groupIntoBooks,
  groupIntoChapters,
  manuscriptTotals,
  type CastCheckScene,
} from '@shared/worldManuscript';
import type {
  ManuscriptProgress,
  ManuscriptSpine,
  SceneSnapshot,
  SceneText,
  WorldFinding,
  WorldSceneStatus,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

const STATUSES = new Set<WorldSceneStatus>(['outline', 'draft', 'written']);

interface TextRow {
  scene_id: string;
  text: string | null;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export function getSceneText(sceneId: string): SceneText {
  const row = getDb().prepare('SELECT * FROM world_scene_text WHERE scene_id = ?').get(sceneId) as
    | TextRow
    | undefined;
  return {
    sceneId,
    text: row?.text ?? null,
    wordCount: row?.word_count ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Save a scene's prose.
 *
 * Three things happen besides the write, and each of them is what keeps the manuscript part
 * of the world rather than a document that happens to live in the same file:
 *
 *  1. `[[Kaelen]]` typed mid-sentence becomes a real link, exactly as in every other prose
 *     field of the vault — so the character's sheet knows which chapter names them.
 *  2. The links are re-indexed, which is what feeds backlinks and the full-text search.
 *  3. The word count is recomputed here and stored, because every screen that shows it
 *     (the spine, the target, today's delta) would otherwise have to read the whole book.
 */
export function saveSceneText(sceneId: string, text: string | null, previous?: SceneText): SceneText {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM world_scenes WHERE scene_id = ?').get(sceneId);
  if (!exists) throw new Error('Escena no encontrada.');

  const promoted = promoteWorldLinks(text, { kind: 'scene', id: sceneId }).text ?? text;
  // Before an overwrite that eats the scene, keep what was there. The trigger is the one
  // moment nobody remembers to press anything: a paste over a selected chapter, or an undo
  // stack lost to a reload. Half is the line because a real edit rarely halves a scene and
  // an accident almost always does.
  const before = previous ?? getSceneText(sceneId);
  const after = countWords(promoted);
  preserveSceneTextBeforeOverwrite(sceneId, before, promoted);
  const ts = now();
  db.prepare(
    `INSERT INTO world_scene_text (scene_id, text, word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scene_id) DO UPDATE SET text = excluded.text, word_count = excluded.word_count,
       updated_at = excluded.updated_at`
  ).run(sceneId, promoted, after, ts, ts);

  indexEntryLinks({ kind: 'scene', id: sceneId });
  recordWordDay();
  return getSceneText(sceneId);
}

/** Owned by the scene: cutting a scene takes its prose and its chapter break with it. */
export function deleteManuscriptFor(sceneId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM world_scene_text WHERE scene_id = ?').run(sceneId);
  db.prepare('DELETE FROM world_chapter_breaks WHERE scene_id = ?').run(sceneId);
  db.prepare('DELETE FROM world_manuscript_starts WHERE scene_id = ?').run(sceneId);
  db.prepare('DELETE FROM world_scene_snapshots WHERE scene_id = ?').run(sceneId);
}

// ── Chapters ─────────────────────────────────────────────────────────────────

/**
 * Mark (or unmark) a scene as the one that opens a chapter.
 *
 * `null` removes the break, and removing it merges the run into the chapter above rather
 * than orphaning anything: a chapter is only ever the stretch between two breaks.
 */
export function setChapterBreak(
  sceneId: string,
  input: { title?: string | null; epigraph?: string | null } | null
): void {
  const db = getDb();
  if (!input) {
    db.prepare('DELETE FROM world_chapter_breaks WHERE scene_id = ?').run(sceneId);
    return;
  }
  const ts = now();
  db.prepare(
    `INSERT INTO world_chapter_breaks (scene_id, title, epigraph, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scene_id) DO UPDATE SET title = excluded.title, epigraph = excluded.epigraph,
       updated_at = excluded.updated_at`
  ).run(sceneId, input.title ?? null, input.epigraph ?? null, ts, ts);
}

// ── The spine ────────────────────────────────────────────────────────────────

/**
 * The whole manuscript's shape, with NOT ONE WORD of its prose.
 *
 * One query with two joins. This is the read behind the navigator, the progress strip and
 * the compile dialog, and it is the reason `word_count` is stored: the alternative is
 * loading a novel to draw a list of chapter titles.
 */
export function manuscriptSpine(): ManuscriptSpine {
  const rows = getDb()
    .prepare(
      `SELECT s.scene_id, s.title, s.narrative_order, s.status,
              COALESCE(t.word_count, 0) AS word_count,
              b.scene_id AS break_id, b.title AS chapter_title, b.epigraph,
              m.scene_id AS book_id, m.title AS book_title, m.subtitle, m.target_words
         FROM world_scenes s
         LEFT JOIN world_scene_text t ON t.scene_id = s.scene_id
         LEFT JOIN world_chapter_breaks b ON b.scene_id = s.scene_id
         LEFT JOIN world_manuscript_starts m ON m.scene_id = s.scene_id
        ORDER BY s.narrative_order`
    )
    .all() as {
    scene_id: string;
    title: string;
    narrative_order: number;
    status: string;
    word_count: number;
    break_id: string | null;
    chapter_title: string | null;
    epigraph: string | null;
    book_id: string | null;
    book_title: string | null;
    subtitle: string | null;
    target_words: number | null;
  }[];

  const scenes: SpineScene[] = rows.map((row) => ({
    sceneId: row.scene_id,
    title: row.title,
    narrativeOrder: row.narrative_order,
    status: STATUSES.has(row.status as WorldSceneStatus) ? (row.status as WorldSceneStatus) : 'outline',
    wordCount: row.word_count,
    // The BREAK's presence is what makes a chapter, so a break with an empty title is
    // still a chapter — an untitled one — and not the absence of a break.
    chapter: row.break_id ? { title: row.chapter_title, epigraph: row.epigraph } : null,
    book: row.book_id
      ? { title: row.book_title, subtitle: row.subtitle, targetWords: row.target_words }
      : null,
  }));

  const chapters = groupIntoChapters(scenes);
  return { books: groupIntoBooks(scenes), chapters, totals: manuscriptTotals(chapters) };
}

/**
 * Mark (or unmark) a scene as the one that opens a book.
 *
 * The same shape as `setChapterBreak`, because it is the same idea one level up. Removing
 * the mark merges the run into the book above it: a book is only ever the stretch between
 * two marks.
 */
export function setBookStart(
  sceneId: string,
  input: { title?: string | null; subtitle?: string | null; targetWords?: number | null } | null
): void {
  const db = getDb();
  if (!input) {
    db.prepare('DELETE FROM world_manuscript_starts WHERE scene_id = ?').run(sceneId);
    return;
  }
  const ts = now();
  db.prepare(
    `INSERT INTO world_manuscript_starts (scene_id, title, subtitle, target_words, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scene_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
       target_words = excluded.target_words, updated_at = excluded.updated_at`
  ).run(sceneId, input.title ?? null, input.subtitle ?? null, input.targetWords ?? null, ts, ts);
}

// ── The word diary ───────────────────────────────────────────────────────────

function totalWords(): number {
  return (getDb().prepare('SELECT COALESCE(SUM(word_count), 0) AS total FROM world_scene_text').get() as {
    total: number;
  }).total;
}

export function listWordDays(): WordDay[] {
  return (
    getDb().prepare('SELECT day, total_words FROM world_word_days ORDER BY day').all() as {
      day: string;
      total_words: number;
    }[]
  ).map((row) => ({ day: row.day, totalWords: row.total_words }));
}

/**
 * Stamp today's total.
 *
 * Called on every save, and it OVERWRITES today's row: the diary records where the
 * manuscript stood at the end of each day, not each keystroke. Yesterday's row is never
 * touched, which is what makes the delta mean something the morning after.
 */
export function recordWordDay(): void {
  const ts = now();
  const day = localDay(new Date());
  getDb()
    .prepare(
      `INSERT INTO world_word_days (day, total_words, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET total_words = excluded.total_words, updated_at = excluded.updated_at`
    )
    .run(day, totalWords(), ts, ts);
}

export function manuscriptProgress(): ManuscriptProgress {
  const total = totalWords();
  const history = listWordDays();
  const day = localDay(new Date());
  return {
    words: total,
    // Against the last day BEFORE today, so re-reading the screen after a save does not
    // reset the number to zero by comparing today with itself.
    today: todayDelta(history, day, total),
    history: history.slice(-30),
  };
}

/**
 * Los avisos que sólo el manuscrito hace posibles.
 *
 * Se leen del grafo de enlaces, no del texto: indexar ya resolvió quién se nombra en la
 * prosa de cada escena, así que esto es un JOIN y no un segundo recorrido de la novela.
 */
export function manuscriptFindings(): WorldFinding[] {
  const db = getDb();
  const mentions = db
    .prepare(
      `SELECT l.source_id AS scene_id, s.title AS scene_title, p.person_id, p.display_name
         FROM world_links l
         JOIN world_scenes s ON s.scene_id = l.source_id
         JOIN persons p ON ('character:' || p.person_id) = l.target_key
        WHERE l.source_kind = 'scene' AND l.source_field = 'text'`
    )
    .all() as { scene_id: string; scene_title: string; person_id: string; display_name: string }[];
  if (mentions.length === 0) return [];

  const cast = new Map<string, string[]>();
  for (const row of db.prepare('SELECT scene_id, person_id FROM scene_characters').all() as {
    scene_id: string;
    person_id: string;
  }[]) {
    cast.set(row.scene_id, [...(cast.get(row.scene_id) ?? []), row.person_id]);
  }

  const scenes = new Map<string, CastCheckScene>();
  for (const row of mentions) {
    const scene = scenes.get(row.scene_id) ?? {
      sceneId: row.scene_id,
      sceneTitle: row.scene_title,
      mentioned: [],
      cast: cast.get(row.scene_id) ?? [],
    };
    scene.mentioned.push({ id: row.person_id, title: row.display_name });
    scenes.set(row.scene_id, scene);
  }
  return checkCast([...scenes.values()]);
}

// ── Instantáneas ─────────────────────────────────────────────────────────────

/** Below this a scene is a stub, and «half of it» is noise rather than a loss. */
const SHRINK_FLOOR = 40;

/** Also used when a device mutation has already passed canonical conflict checks. */
export function preserveSceneTextBeforeOverwrite(sceneId:string, before:SceneText, text:string|null):void {
  if (before.wordCount >= SHRINK_FLOOR && countWords(text) < before.wordCount / 2) {
    const latest=getDb().prepare('SELECT text,reason FROM world_scene_snapshots WHERE scene_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(sceneId) as {text:string|null;reason:string}|undefined;
    if(latest?.reason==='shrink'&&(latest.text??'')===(before.text??''))return;
    writeSnapshot(sceneId, before.text, before.wordCount, 'shrink');
  }
}
/** Per scene. A novel with unbounded snapshots is a novel that syncs several times over. */
const MAX_SNAPSHOTS = 20;

function writeSnapshot(sceneId: string, text: string | null, wordCount: number, reason: 'manual' | 'shrink'): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO world_scene_snapshots (snapshot_id, scene_id, text, word_count, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`snp_${uuid()}`, sceneId, text, wordCount, reason, now());
    // Oldest first out. A cap that dropped the newest would keep the useless half.
    db.prepare(
      `DELETE FROM world_scene_snapshots
        WHERE snapshot_id IN (
          SELECT snapshot_id FROM world_scene_snapshots WHERE scene_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
        )`
    ).run(sceneId, MAX_SNAPSHOTS);
  });
  run();
}

/** The list carries word counts and reasons — never the text. Same rule as the spine. */
export function listSceneSnapshots(sceneId: string): SceneSnapshot[] {
  return (
    getDb()
      .prepare(
        `SELECT snapshot_id, scene_id, word_count, reason, created_at
           FROM world_scene_snapshots WHERE scene_id = ? ORDER BY created_at DESC, rowid DESC`
      )
      .all(sceneId) as { snapshot_id: string; scene_id: string; word_count: number; reason: string; created_at: string }[]
  ).map((row) => ({
    snapshotId: row.snapshot_id,
    sceneId: row.scene_id,
    wordCount: row.word_count,
    reason: row.reason === 'shrink' ? 'shrink' : 'manual',
    createdAt: row.created_at,
  }));
}

export function takeSceneSnapshot(sceneId: string): SceneSnapshot[] {
  const current = getSceneText(sceneId);
  writeSnapshot(sceneId, current.text, current.wordCount, 'manual');
  return listSceneSnapshots(sceneId);
}

/**
 * Put a snapshot back — after keeping what is there now.
 *
 * Restoring is itself a destructive edit, and an undo you cannot undo is a trap. The
 * restore goes through `saveSceneText`, so the links are re-promoted and re-indexed exactly
 * as if the author had typed it: a restored chapter is not a second-class one.
 */
export function restoreSceneSnapshot(snapshotId: string): SceneText {
  const row = getDb()
    .prepare('SELECT scene_id, text, word_count FROM world_scene_snapshots WHERE snapshot_id = ?')
    .get(snapshotId) as { scene_id: string; text: string | null; word_count: number } | undefined;
  if (!row) throw new Error('Instantánea no encontrada.');
  const current = getSceneText(row.scene_id);
  writeSnapshot(row.scene_id, current.text, current.wordCount, 'manual');
  return saveSceneText(row.scene_id, row.text);
}

export function getSnapshotText(snapshotId: string): string | null {
  const row = getDb().prepare('SELECT text FROM world_scene_snapshots WHERE snapshot_id = ?').get(snapshotId) as
    | { text: string | null }
    | undefined;
  return row?.text ?? null;
}
