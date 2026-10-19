// Workspace notes linked to courses, subjects, folders, topics and materials of a study
// or teaching vault. Why the table has no foreign keys, and why its path is stored
// resolved, is in `studyNoteLinksSchema.ts`.
//
// What a reader sees is filtered here rather than pruned: a note in the Workspace trash,
// or a subject in the study trash, hides its links, and restoring either brings them
// back. Nor is a link whose note is simply ABSENT deleted on read. Notes and study data
// travel in different sync groups, so a machine can hold the link before the note
// arrives; deleting it there would send a tombstone back and destroy it everywhere.
// Rows are removed only where their note or material is removed for good
// (`deleteNote`, a material's permanent delete) or when the person unlinks them.

import crypto from 'node:crypto';
import type { NoteKind } from '@shared/types';
import type { StudyNoteLink, StudyNoteLinkFilter, StudyNoteLinkInput } from '@shared/studyNoteLinks';
import { getDb } from './database';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const text = (value: unknown) => (value == null ? null : String(value));

const EXCERPT_LENGTH = 280;

/** A single line of readable text: no Markdown marks, no runs of whitespace. */
function excerpt(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXCERPT_LENGTH);
}

function tags(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

const toLink = (row: Row): StudyNoteLink => ({
  id: String(row.id),
  noteId: String(row.note_id),
  courseId: text(row.course_id),
  subjectId: text(row.subject_id),
  folderId: text(row.folder_id),
  topicId: text(row.topic_id),
  materialId: text(row.material_id),
  materialTitle: text(row.material_title),
  note: {
    id: String(row.note_id),
    title: String(row.note_title ?? ''),
    kind: String(row.note_kind ?? 'markdown') as NoteKind,
    excerpt: excerpt(String(row.note_content ?? '')),
    tags: tags(row.note_tags),
    updatedAt: String(row.note_updated_at ?? row.updated_at),
  },
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

/** Not in the study trash and not archived. */
const live = (alias = '') => `${alias}deleted_at IS NULL AND ${alias}archived_at IS NULL`;

/** Live links, optionally narrowed; a filter field matches the link's resolved path. */
export function listStudyNoteLinks(filter: StudyNoteLinkFilter = {}): StudyNoteLink[] {
  const where: string[] = [];
  const values: unknown[] = [];
  const columns: Array<[keyof StudyNoteLinkFilter, string]> = [
    ['noteId', 'note_id'], ['courseId', 'course_id'], ['subjectId', 'subject_id'],
    ['folderId', 'folder_id'], ['topicId', 'topic_id'], ['materialId', 'material_id'],
  ];
  for (const [key, column] of columns) {
    const value = filter[key];
    if (value) { where.push(`l.${column} = ?`); values.push(value); }
  }
  const alive = (column: string, table: string) =>
    `(l.${column} IS NULL OR EXISTS (SELECT 1 FROM ${table} t WHERE t.id = l.${column} AND ${live('t.')}))`;
  const rows = getDb().prepare(`
    SELECT l.*, n.title AS note_title, n.kind AS note_kind, n.content AS note_content,
           n.tags_json AS note_tags, n.updated_at AS note_updated_at, m.title AS material_title
      FROM study_note_links l
      JOIN embedding_read_notes n ON n.id = l.note_id AND n.trashed_at IS NULL
      LEFT JOIN embedding_read_study_materials m ON m.id = l.material_id
     WHERE (l.material_id IS NULL OR (m.id IS NOT NULL AND ${live('m.')}))
       AND ${alive('course_id', 'study_courses')}
       AND ${alive('subject_id', 'study_subjects')}
       AND ${alive('folder_id', 'study_folders')}
       AND ${alive('topic_id', 'study_topics')}
       ${where.length ? `AND ${where.join(' AND ')}` : ''}
     ORDER BY l.position, l.created_at
  `).all(...values) as Row[];
  return rows.map(toLink);
}

/**
 * The full path of a location, derived from its most specific level so the stored row
 * can never contradict the organisation: a topic brings its folder, subject and course.
 */
function resolveLocation(input: { courseId?: string | null; subjectId?: string | null; folderId?: string | null; topicId?: string | null }) {
  const db = getDb();
  const find = (table: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${live()}`).get(id) as Row | undefined;
  const unavailable = () => new Error('El destino ya no está disponible.');
  let courseId = input.courseId || null;
  let subjectId = input.subjectId || null;
  let folderId = input.folderId || null;
  const topicId = input.topicId || null;
  if (!courseId && !subjectId && !folderId && !topicId) throw new Error('La ubicación necesita un destino.');
  if (topicId) {
    const topic = find('study_topics', topicId);
    if (!topic) throw unavailable();
    subjectId = String(topic.subject_id);
    folderId = text(topic.folder_id);
  }
  if (folderId) {
    const folder = find('study_folders', folderId);
    if (!folder) throw unavailable();
    // A topic's folder decides; a bare folder decides its own subject and course.
    subjectId = topicId ? subjectId : text(folder.subject_id);
    courseId = text(folder.course_id) ?? courseId;
  }
  if (subjectId) {
    const subject = find('study_subjects', subjectId);
    if (!subject) throw unavailable();
    courseId = String(subject.course_id);
  }
  if (courseId && !find('study_courses', courseId)) throw unavailable();
  return { courseId, subjectId, folderId, topicId };
}

/** Links a note to a place. Linking it again to the same place returns the existing link. */
export function addStudyNoteLink(input: StudyNoteLinkInput): StudyNoteLink {
  const db = getDb();
  return db.transaction(() => {
    const note = db.prepare('SELECT trashed_at FROM notes WHERE id = ?').get(input.noteId) as Row | undefined;
    if (!note) throw new Error('La nota no existe.');
    if (note.trashed_at) throw new Error('La nota está en la papelera.');
    const target = 'materialId' in input && input.materialId
      ? { courseId: null, subjectId: null, folderId: null, topicId: null, materialId: input.materialId }
      : { ...resolveLocation(input as Exclude<StudyNoteLinkInput, { materialId: string }>), materialId: null };
    if (target.materialId && !db.prepare(`SELECT 1 FROM study_materials WHERE id = ? AND ${live()}`).get(target.materialId)) {
      throw new Error('El material no está disponible.');
    }
    const timestamp = now();
    const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_note_links WHERE note_id = ?').get(input.noteId) as Row).value);
    db.prepare(`
      INSERT INTO study_note_links (id, note_id, course_id, subject_id, folder_id, topic_id, material_id, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(crypto.randomUUID(), input.noteId, target.courseId, target.subjectId, target.folderId, target.topicId, target.materialId, position, timestamp, timestamp);
    const row = db.prepare(`
      SELECT id FROM study_note_links
       WHERE note_id = ? AND course_id IS ? AND subject_id IS ? AND folder_id IS ? AND topic_id IS ? AND material_id IS ?
    `).get(input.noteId, target.courseId, target.subjectId, target.folderId, target.topicId, target.materialId) as Row;
    const link = listStudyNoteLinks({ noteId: input.noteId }).find((candidate) => candidate.id === String(row.id));
    if (!link) throw new Error('El destino ya no está disponible.');
    return link;
  })();
}

export function removeStudyNoteLinks(ids: string[]): void {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return;
  const remove = getDb().prepare('DELETE FROM study_note_links WHERE id = ?');
  getDb().transaction(() => { for (const id of unique) remove.run(id); })();
}

/** Called where a note or a material is deleted for good, never on read (see the header). */
export function deleteStudyNoteLinksFor(column: 'note_id' | 'material_id', id: string): void {
  getDb().prepare(`DELETE FROM study_note_links WHERE ${column} = ?`).run(id);
}
