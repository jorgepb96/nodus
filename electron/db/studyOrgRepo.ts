import { cloneNativeDocument, parseNativeDocument } from '@shared/blockNoteDocument';
import { updateStudyDoc } from './studyEditorRepo';
import crypto from 'node:crypto';
import type {
  CreateStudyAcademicYearInput,
  StudyAcademicYear,
  UpdateStudyAcademicYearInput,
} from '@shared/studyAcademicYears';
import {
  defaultAcademicYearRange,
  isAcademicYearDate,
  normalizeAcademicYearLabel,
  parseAcademicYearStart,
} from '@shared/studyAcademicYears';
import type {
  CreateStudyCourseInput,
  CreateStudyDocumentInput,
  CreateStudyFolderInput,
  CreateStudySubjectInput,
  CreateStudyTagInput,
  CreateStudyTemplateInput,
  CreateStudyTopicInput,
  StudyCourse,
  StudyDocument,
  StudyDocumentTag,
  StudyEntityMoveInput,
  StudyEntityKind,
  StudyFolder,
  StudyLifecycleAction,
  StudyPlacement,
  StudyPlacementInput,
  StudySubject,
  StudyTag,
  StudyTemplate,
  StudyTopic,
  StudyWorkspace,
  StudyWorkspaceOptions,
} from '@shared/studyOrg';
import { createStudyShortId, normalizeStudyName, studyPlacementKey } from '@shared/studyOrg';
import { getDb } from './database';
import { toAcademicYear, toCourse, toSubject, toTopic, toFolder, toDocument, toPlacement, toTag, toDocumentTag, toTemplate } from '@shared/studyOrgProjection';

type Row = Record<string, unknown>;

const PREFIX = {
  academicYear: 'ACY',
  course: 'CRS',
  subject: 'SUB',
  topic: 'TOP',
  folder: 'FLD',
  document: 'DOC',
  placement: 'PLC',
  tag: 'TAG',
  documentTag: 'DTG',
  template: 'TPL',
} as const;

function ids(kind: keyof typeof PREFIX) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(PREFIX[kind], id) };
}

function now(): string {
  return new Date().toISOString();
}

function lifecycleWhere(options: StudyWorkspaceOptions): string {
  const filters: string[] = [];
  if (!options.includeArchived) filters.push('archived_at IS NULL');
  if (!options.includeDeleted) filters.push('deleted_at IS NULL');
  return filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
}

export function getStudyWorkspace(options: StudyWorkspaceOptions = {}): StudyWorkspace {
  const db = getDb();
  const where = lifecycleWhere(options);
  const list = (table: string) => db.prepare(`SELECT * FROM ${table}${where} ORDER BY position, created_at`).all() as Row[];
  const documents = list('study_docs').map(toDocument);
  const documentIds = new Set(documents.map((document) => document.id));
  const tags = list('study_tags').map(toTag);
  const tagIds = new Set(tags.map((tag) => tag.id));
  return {
    academicYears: (db.prepare(`SELECT * FROM study_academic_years${where} ORDER BY start_date DESC, label DESC`).all() as Row[]).map(toAcademicYear),
    courses: list('study_courses').map(toCourse),
    subjects: list('study_subjects').map(toSubject),
    topics: list('study_topics').map(toTopic),
    folders: list('study_folders').map(toFolder),
    documents,
    placements: list('study_placements').map(toPlacement).filter((placement) => documentIds.has(placement.documentId)),
    tags,
    documentTags: list('study_doc_tags').map(toDocumentTag).filter((link) => documentIds.has(link.documentId) && tagIds.has(link.tagId)),
    templates: list('study_templates').map(toTemplate),
  };
}

function nextPosition(table: string, scopeColumn?: string, scopeValue?: string | null): number {
  const db = getDb();
  if (scopeColumn) {
    const row = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS value FROM ${table} WHERE ${scopeColumn} IS ?`).get(scopeValue ?? null) as Row;
    return Number(row.value);
  }
  const row = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS value FROM ${table}`).get() as Row;
  return Number(row.value);
}

/**
 * Rejects an academic year id that does not exist, so a typo in an IPC payload
 * surfaces as an error instead of a course that silently belongs to no year.
 * The FK would catch it too, but only as an opaque SQLITE_CONSTRAINT.
 */
function assertAcademicYearExists(id: string | null | undefined): string | null {
  if (!id) return null;
  if (!getDb().prepare('SELECT 1 FROM study_academic_years WHERE id = ? AND deleted_at IS NULL').get(id)) {
    throw new Error('El curso académico seleccionado no existe.');
  }
  return id;
}

/**
 * Creates an academic year, or returns the existing one with the same canonical
 * label. Returning rather than throwing mirrors {@link createStudyTag}: "2024/25"
 * and "2024/2025" are the same year, and a duplicate-name error would be a
 * pedantic answer to what is really a request for the year that already exists.
 */
export function createStudyAcademicYear(input: CreateStudyAcademicYearInput): StudyAcademicYear {
  const db = getDb();
  const label = normalizeAcademicYearLabel(input.label);
  if (!label) throw new Error('Escribe el curso académico como 2024/2025.');
  const existing = db.prepare('SELECT * FROM study_academic_years WHERE label = ?').get(label) as Row | undefined;
  if (existing) return toAcademicYear(existing);
  const fallback = defaultAcademicYearRange(parseAcademicYearStart(label)!);
  const startDate = input.startDate || fallback.startDate;
  const endDate = input.endDate || fallback.endDate;
  assertAcademicYearRange(startDate, endDate);
  const key = ids('academicYear');
  const timestamp = now();
  db.prepare(`INSERT INTO study_academic_years
    (id, short_id, label, start_date, end_date, color, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, label, startDate, endDate, input.color ?? null, nextPosition('study_academic_years'), timestamp, timestamp);
  return toAcademicYear(db.prepare('SELECT * FROM study_academic_years WHERE id = ?').get(key.id) as Row);
}

function assertAcademicYearRange(startDate: string, endDate: string): void {
  if (!isAcademicYearDate(startDate) || !isAcademicYearDate(endDate)) throw new Error('Las fechas del curso académico deben tener el formato AAAA-MM-DD.');
  if (startDate >= endDate) throw new Error('El curso académico debe terminar después de empezar.');
}

export function updateStudyAcademicYear(id: string, patch: UpdateStudyAcademicYearInput): StudyAcademicYear | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM study_academic_years WHERE id = ?').get(id) as Row | undefined;
  if (!current) return null;
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (patch.label !== undefined) {
    const label = normalizeAcademicYearLabel(patch.label);
    if (!label) throw new Error('Escribe el curso académico como 2024/2025.');
    const clash = db.prepare('SELECT id FROM study_academic_years WHERE label = ? AND id <> ?').get(label, id) as Row | undefined;
    if (clash) throw new Error(`El curso académico ${label} ya existe.`);
    assignments.push('label = ?'); values.push(label);
  }
  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const startDate = patch.startDate ?? String(current.start_date);
    const endDate = patch.endDate ?? String(current.end_date);
    assertAcademicYearRange(startDate, endDate);
    assignments.push('start_date = ?', 'end_date = ?'); values.push(startDate, endDate);
  }
  if (patch.color !== undefined) { assignments.push('color = ?'); values.push(patch.color ?? null); }
  if (patch.position !== undefined) { assignments.push('position = ?'); values.push(patch.position); }
  if (assignments.length) {
    db.prepare(`UPDATE study_academic_years SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  return toAcademicYear(db.prepare('SELECT * FROM study_academic_years WHERE id = ?').get(id) as Row);
}

/**
 * Deletes an academic year for real, unlinking whatever pointed at it.
 *
 * Deliberately never cascades into courses or subjects: the year is a label on
 * work, not a container of it, and dropping a year the user mislabelled must not
 * take a term's materials with it. The FKs are ON DELETE SET NULL for courses and
 * subjects, and the timetable rows for that year are the only thing that cannot
 * outlive it, so those cascade.
 */
export function deleteStudyAcademicYear(id: string): void {
  getDb().prepare('DELETE FROM study_academic_years WHERE id = ?').run(id);
}

export function createStudyCourse(input: CreateStudyCourseInput): StudyCourse {
  const db = getDb();
  const academicYearId = assertAcademicYearExists(input.academicYearId);
  const key = ids('course');
  const timestamp = now();
  db.prepare(`INSERT INTO study_courses
    (id, short_id, name, description, color, icon, emoji, image_data, year, academic_year_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, normalizeStudyName(input.name), input.description ?? null, input.color ?? null, input.icon ?? null,
      input.emoji ?? null, input.imageData ?? null, input.year ?? null, academicYearId, nextPosition('study_courses'), timestamp, timestamp);
  return toCourse(db.prepare('SELECT * FROM study_courses WHERE id = ?').get(key.id) as Row);
}

export function createStudySubject(input: CreateStudySubjectInput): StudySubject {
  const db = getDb();
  const academicYearId = assertAcademicYearExists(input.academicYearId);
  const key = ids('subject');
  const timestamp = now();
  db.prepare(`INSERT INTO study_subjects
    (id, short_id, course_id, name, description, color, icon, emoji, image_data, year, academic_year_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.courseId, normalizeStudyName(input.name), input.description ?? null, input.color ?? null,
      input.icon ?? null, input.emoji ?? null, input.imageData ?? null, input.year ?? null, academicYearId,
      nextPosition('study_subjects', 'course_id', input.courseId), timestamp, timestamp);
  return toSubject(db.prepare('SELECT * FROM study_subjects WHERE id = ?').get(key.id) as Row);
}

function assertNoTopicCycle(id: string, parentId: string | null): void {
  if (!parentId) return;
  if (id === parentId) throw new Error('Un tema no puede contenerse a sí mismo.');
  const db = getDb();
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw new Error('El movimiento crearía un ciclo de temas.');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM study_topics WHERE id = ?').get(cursor) as Row | undefined;
    cursor = row?.parent_id ? String(row.parent_id) : null;
  }
}

export function createStudyTopic(input: CreateStudyTopicInput): StudyTopic {
  const db = getDb();
  const key = ids('topic');
  assertNoTopicCycle(key.id, input.parentId ?? null);
  let folderId = input.folderId ?? null;
  if (input.parentId) {
    const parent = db.prepare('SELECT subject_id, folder_id FROM study_topics WHERE id = ?').get(input.parentId) as Row | undefined;
    if (!parent || String(parent.subject_id) !== input.subjectId) throw new Error('El tema superior no pertenece a la asignatura seleccionada.');
    folderId = parent.folder_id ? String(parent.folder_id) : null;
  }
  if (folderId) {
    const folder = db.prepare('SELECT subject_id FROM study_folders WHERE id = ?').get(folderId) as Row | undefined;
    if (!folder || String(folder.subject_id ?? '') !== input.subjectId) throw new Error('La carpeta no pertenece a la asignatura seleccionada.');
  }
  const timestamp = now();
  db.prepare(`INSERT INTO study_topics
    (id, short_id, subject_id, folder_id, parent_id, name, description, color, icon, emoji, image_data, year, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.subjectId, folderId, input.parentId ?? null, normalizeStudyName(input.name), input.description ?? null,
      input.color ?? null, input.icon ?? null, input.emoji ?? null, input.imageData ?? null, input.year ?? null,
      nextPosition('study_topics', 'subject_id', input.subjectId), timestamp, timestamp);
  return toTopic(db.prepare('SELECT * FROM study_topics WHERE id = ?').get(key.id) as Row);
}

function assertNoFolderCycle(id: string, parentId: string | null): void {
  if (!parentId) return;
  if (id === parentId) throw new Error('Una carpeta no puede contenerse a sí misma.');
  const db = getDb();
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw new Error('El movimiento crearía un ciclo de carpetas.');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM study_folders WHERE id = ?').get(cursor) as Row | undefined;
    cursor = row?.parent_id ? String(row.parent_id) : null;
  }
}

export function createStudyFolder(input: CreateStudyFolderInput): StudyFolder {
  const db = getDb();
  const key = ids('folder');
  assertNoFolderCycle(key.id, input.parentId ?? null);
  let courseId = input.courseId ?? null;
  let subjectId = input.subjectId ?? null;
  if (input.parentId) {
    const parent = db.prepare('SELECT course_id, subject_id FROM study_folders WHERE id = ?').get(input.parentId) as Row | undefined;
    if (!parent) throw new Error('La carpeta superior no existe.');
    courseId = parent.course_id ? String(parent.course_id) : null;
    subjectId = parent.subject_id ? String(parent.subject_id) : null;
  }
  if (subjectId) {
    const subject = db.prepare('SELECT course_id FROM study_subjects WHERE id = ?').get(subjectId) as Row | undefined;
    if (!subject) throw new Error('La asignatura de destino no existe.');
    const subjectCourseId = String(subject.course_id);
    if (courseId && courseId !== subjectCourseId) throw new Error('La asignatura no pertenece al curso seleccionado.');
    courseId = subjectCourseId;
  }
  const timestamp = now();
  db.prepare(`INSERT INTO study_folders
    (id, short_id, parent_id, course_id, subject_id, name, description, color, icon, emoji, image_data, year, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.parentId ?? null, courseId, subjectId,
      normalizeStudyName(input.name), input.description ?? null, input.color ?? null, input.icon ?? null, input.emoji ?? null,
      input.imageData ?? null, input.year ?? null,
      nextPosition('study_folders', 'parent_id', input.parentId ?? null), timestamp, timestamp);
  return toFolder(db.prepare('SELECT * FROM study_folders WHERE id = ?').get(key.id) as Row);
}

export function createStudyDocument(input: CreateStudyDocumentInput): StudyDocument {
  const db = getDb();
  const create = db.transaction(() => {
    const key = ids('document');
    const timestamp = now();
    db.prepare(`INSERT INTO study_docs
      (id, short_id, title, kind, content_markdown, description, color, icon, emoji, image_data, year, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(key.id, key.shortId, normalizeStudyName(input.title), input.kind ?? 'apunte', input.contentMarkdown ?? '',
        input.description ?? null, input.color ?? null, input.icon ?? null, input.emoji ?? null, input.imageData ?? null,
        input.year ?? null, nextPosition('study_docs'), timestamp, timestamp);
    if (input.placement) addStudyPlacement(key.id, input.placement);
    return toDocument(db.prepare('SELECT * FROM study_docs WHERE id = ?').get(key.id) as Row);
  });
  return create();
}

export function addStudyPlacement(documentId: string, input: StudyPlacementInput): StudyPlacement {
  const db = getDb();
  const normalized: StudyPlacementInput = { ...input };
  if (normalized.folderId) {
    const folder = db.prepare('SELECT course_id, subject_id FROM study_folders WHERE id = ?').get(normalized.folderId) as Row | undefined;
    if (!folder) throw new Error('La carpeta de destino no existe.');
    normalized.courseId ??= folder.course_id ? String(folder.course_id) : null;
    normalized.subjectId ??= folder.subject_id ? String(folder.subject_id) : null;
  }
  if (normalized.topicId) {
    const topic = db.prepare('SELECT subject_id, folder_id FROM study_topics WHERE id = ?').get(normalized.topicId) as Row | undefined;
    if (!topic) throw new Error('El tema de destino no existe.');
    normalized.subjectId ??= String(topic.subject_id);
    normalized.folderId ??= topic.folder_id ? String(topic.folder_id) : null;
  }
  if (normalized.subjectId) {
    const subject = db.prepare('SELECT course_id FROM study_subjects WHERE id = ?').get(normalized.subjectId) as Row | undefined;
    if (!subject) throw new Error('La asignatura de destino no existe.');
    normalized.courseId ??= String(subject.course_id);
  }
  if (!normalized.courseId && !normalized.subjectId && !normalized.topicId && !normalized.folderId) throw new Error('La ubicación necesita un destino.');
  const duplicate = db.prepare(`SELECT * FROM study_placements WHERE document_id = ?
    AND IFNULL(course_id, '') = ? AND IFNULL(subject_id, '') = ? AND IFNULL(topic_id, '') = ? AND IFNULL(folder_id, '') = ?`)
    .get(documentId, normalized.courseId ?? '', normalized.subjectId ?? '', normalized.topicId ?? '', normalized.folderId ?? '') as Row | undefined;
  if (duplicate) return toPlacement(duplicate);
  const key = ids('placement');
  const timestamp = now();
  db.prepare(`INSERT INTO study_placements
    (id, short_id, document_id, course_id, subject_id, topic_id, folder_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, documentId, normalized.courseId ?? null, normalized.subjectId ?? null, normalized.topicId ?? null,
      normalized.folderId ?? null, normalized.position ?? nextPosition('study_placements', 'document_id', documentId), timestamp, timestamp);
  return toPlacement(db.prepare('SELECT * FROM study_placements WHERE id = ?').get(key.id) as Row);
}

/** Validate the complete destination before changing any existing placement. */
export function resolveStudyMoveDestination(destination: StudyPlacementInput) {
  const db = getDb();
  const active = (table: 'study_courses' | 'study_subjects' | 'study_folders' | 'study_topics', id: string): Row => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`).get(id) as Row | undefined;
    if (!row) throw new Error('El destino ya no está disponible.');
    return row;
  };
  let courseId = destination.courseId || null;
  let subjectId = destination.subjectId || null;
  let folderId = destination.folderId || null;
  const topicId = destination.topicId || null;
  if (topicId) {
    const topic = active('study_topics', topicId);
    if ((subjectId && subjectId !== topic.subject_id) || (folderId && folderId !== topic.folder_id)) throw new Error('El tema no pertenece al destino seleccionado.');
    subjectId = String(topic.subject_id);
    folderId = topic.folder_id ? String(topic.folder_id) : null;
  }
  if (folderId) {
    const folder = active('study_folders', folderId);
    if ((subjectId && subjectId !== folder.subject_id) || (courseId && courseId !== folder.course_id)) throw new Error('La carpeta no pertenece al destino seleccionado.');
    subjectId = folder.subject_id ? String(folder.subject_id) : null;
    courseId = folder.course_id ? String(folder.course_id) : null;
  }
  if (subjectId) {
    const subject = active('study_subjects', subjectId);
    if (courseId && courseId !== subject.course_id) throw new Error('La asignatura no pertenece al curso seleccionado.');
    courseId = String(subject.course_id);
  }
  if (courseId) active('study_courses', courseId);
  return { courseId, subjectId, folderId, topicId };
}

/** Move one location atomically, preserving other locations and document data. */
export function moveStudyPlacement(documentId: string, placementId: string | null, destination: StudyPlacementInput): StudyPlacement | null {
  const db = getDb();
  return db.transaction(() => {
    const document = getStudyEntity('document', documentId);
    if (!document || document.deletedAt || document.archivedAt) throw new Error('El documento no está disponible.');
    const placements = (db.prepare('SELECT * FROM study_placements WHERE document_id = ?').all(documentId) as Row[]).map(toPlacement);
    const active = placements.filter((p) => !p.archivedAt && !p.deletedAt);
    const origin = active.find((p) => p.id === placementId);
    if (placementId !== null && !origin) throw new Error('La ubicación de origen ya no existe.');
    if (placementId === null && active.length) throw new Error('Selecciona la ubicación de origen.');
    const target = resolveStudyMoveDestination(destination);
    const key = studyPlacementKey(target);
    if (origin && studyPlacementKey(origin) === key) return origin;
    const duplicate = placements.find((p) => p.id !== placementId && studyPlacementKey(p) === key);
    if (duplicate || Object.values(target).every((value) => value === null)) {
      if (origin) db.prepare('DELETE FROM study_placements WHERE id = ?').run(origin.id);
      if (duplicate && (duplicate.archivedAt || duplicate.deletedAt)) {
        db.prepare('UPDATE study_placements SET archived_at = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), duplicate.id);
        return toPlacement(db.prepare('SELECT * FROM study_placements WHERE id = ?').get(duplicate.id) as Row);
      }
      return duplicate ?? null;
    }
    if (origin) {
      db.prepare('UPDATE study_placements SET course_id = ?, subject_id = ?, folder_id = ?, topic_id = ?, updated_at = ? WHERE id = ?')
        .run(target.courseId, target.subjectId, target.folderId, target.topicId, now(), origin.id);
      return toPlacement(db.prepare('SELECT * FROM study_placements WHERE id = ?').get(origin.id) as Row);
    }
    // No existing location matches the destination.
    const keyId = ids('placement');
    const timestamp = now();
    db.prepare(`INSERT INTO study_placements (id, short_id, document_id, course_id, subject_id, folder_id, topic_id, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(keyId.id, keyId.shortId, documentId, target.courseId, target.subjectId, target.folderId, target.topicId,
        nextPosition('study_placements', 'document_id', documentId), timestamp, timestamp);
    return toPlacement(db.prepare('SELECT * FROM study_placements WHERE id = ?').get(keyId.id) as Row);
  })();
}

export function setPrimaryStudyPlacement(documentId: string, input: StudyPlacementInput): StudyPlacement {
  const db = getDb();
  return db.transaction(() => {
    db.prepare('DELETE FROM study_placements WHERE document_id = ?').run(documentId);
    return addStudyPlacement(documentId, input);
  })();
}

export function removeStudyPlacement(id: string): void {
  getDb().prepare('DELETE FROM study_placements WHERE id = ?').run(id);
}

const TABLES: Record<StudyEntityKind, string> = {
  course: 'study_courses', subject: 'study_subjects', topic: 'study_topics', folder: 'study_folders', document: 'study_docs',
};

export function updateStudyEntity(kind: StudyEntityKind, id: string, patch: Record<string, unknown>): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument | null {
  const db = getDb();
  const table = TABLES[kind];
  const allowed = kind === 'document'
    ? new Set(['title', 'kind', 'contentMarkdown', 'description', 'color', 'icon', 'emoji', 'imageData', 'year', 'favorite', 'pinned', 'locked', 'position'])
    : new Set(['name', 'description', 'color', 'icon', 'emoji', 'imageData', 'year', 'favorite', 'position', 'courseId', 'subjectId', 'parentId',
      ...(kind === 'topic' ? ['folderId'] : []),
      // Only these two have the column; a topic patch carrying it would otherwise
      // build an UPDATE against a column that does not exist.
      ...(kind === 'course' || kind === 'subject' ? ['academicYearId'] : [])]);
  const column = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return getStudyEntity(kind, id);
  if (Object.hasOwn(patch, 'academicYearId') && allowed.has('academicYearId')) {
    assertAcademicYearExists((patch.academicYearId as string | null) ?? null);
  }
  if (kind === 'topic' && Object.hasOwn(patch, 'parentId')) assertNoTopicCycle(id, (patch.parentId as string | null) ?? null);
  if (kind === 'folder' && Object.hasOwn(patch, 'parentId')) assertNoFolderCycle(id, (patch.parentId as string | null) ?? null);
  const values = entries.map(([key, value]) => {
    if (key === 'name' || key === 'title') return normalizeStudyName(String(value ?? ''));
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
  db.transaction(() => {
    if (kind === 'document' && ('contentMarkdown' in patch || 'title' in patch)) {
      const current = getStudyEntity('document',id) as StudyDocument | null;
      if (current) updateStudyDoc(id,{title: String(patch.title ?? current.title), contentMarkdown: String(patch.contentMarkdown ?? current.contentMarkdown),reason:'manual'});
    }
    // The legacy editor has already updated the canonical document and its
    // projections. This second statement only applies its other metadata.
    const other = entries.map((entry,index)=>({entry,value:values[index]})).filter(({entry:[key]})=>kind !== 'document' || !['title','contentMarkdown'].includes(key));
    if (other.length) db.prepare(`UPDATE ${table} SET ${other.map(({entry:[key]}) => `${column(key)} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...other.map(item=>item.value),now(),id);
  })();
  return getStudyEntity(kind, id);
}

export function getStudyEntity(kind: StudyEntityKind, id: string): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument | null {
  const row = getDb().prepare(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  if (kind === 'course') return toCourse(row);
  if (kind === 'subject') return toSubject(row);
  if (kind === 'topic') return toTopic(row);
  if (kind === 'folder') return toFolder(row);
  return toDocument(row);
}

function descendantIds(kind: StudyEntityKind, id: string): Record<StudyEntityKind, Set<string>> {
  const db = getDb();
  const result: Record<StudyEntityKind, Set<string>> = {
    course: new Set(), subject: new Set(), topic: new Set(), folder: new Set(), document: new Set(),
  };
  result[kind].add(id);
  if (kind === 'course') {
    for (const row of db.prepare('SELECT id FROM study_subjects WHERE course_id = ?').all(id) as Row[]) result.subject.add(String(row.id));
    for (const row of db.prepare('SELECT id FROM study_folders WHERE course_id = ?').all(id) as Row[]) result.folder.add(String(row.id));
  }
  if (kind === 'subject') {
    for (const row of db.prepare('SELECT id FROM study_folders WHERE subject_id = ?').all(id) as Row[]) result.folder.add(String(row.id));
  }
  if (kind === 'course' || kind === 'subject') {
    let frontier = [...result.folder];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_folders WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.folder.has(childId)) { result.folder.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
  }
  if (kind === 'course' || kind === 'subject') {
    const subjectIds = [...result.subject, ...(kind === 'subject' ? [id] : [])];
    for (const subjectId of subjectIds) {
      for (const row of db.prepare('SELECT id FROM study_topics WHERE subject_id = ?').all(subjectId) as Row[]) result.topic.add(String(row.id));
    }
  }
  if (kind === 'topic') {
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_topics WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.topic.has(childId)) { result.topic.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
  }
  if (kind === 'folder') {
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const parentId of frontier) {
        for (const row of db.prepare('SELECT id FROM study_folders WHERE parent_id = ?').all(parentId) as Row[]) {
          const childId = String(row.id);
          if (!result.folder.has(childId)) { result.folder.add(childId); next.push(childId); }
        }
      }
      frontier = next;
    }
    for (const folderId of result.folder) {
      for (const row of db.prepare('SELECT id FROM study_topics WHERE folder_id = ?').all(folderId) as Row[]) result.topic.add(String(row.id));
    }
  }
  if (kind !== 'document') {
    const placements = (db.prepare('SELECT * FROM study_placements').all() as Row[]).map(toPlacement);
    const inside = (placement: StudyPlacement) =>
      (placement.courseId != null && result.course.has(placement.courseId)) ||
      (placement.subjectId != null && result.subject.has(placement.subjectId)) ||
      (placement.topicId != null && result.topic.has(placement.topicId)) ||
      (placement.folderId != null && result.folder.has(placement.folderId));
    const candidateIds = new Set(placements.filter(inside).map((placement) => placement.documentId));
    for (const documentId of candidateIds) {
      const documentPlacements = placements.filter((placement) => placement.documentId === documentId);
      if (documentPlacements.length > 0 && documentPlacements.every(inside)) result.document.add(documentId);
    }
  }
  return result;
}

function updateStudyScopeReferences(scopeColumn: 'subject_id' | 'folder_id' | 'topic_id', ids: string[], patch: { courseId?: string | null; subjectId?: string | null; folderId?: string | null }): void {
  if (!ids.length) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'study_%'").all() as Row[])
    .map((row) => String(row.name)).filter((name) => /^study_[a-z0-9_]+$/.test(name));
  for (const table of tables) {
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
    if (!columns.has(scopeColumn)) continue;
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (patch.courseId !== undefined && columns.has('course_id')) { assignments.push('course_id = ?'); values.push(patch.courseId); }
    if (patch.subjectId !== undefined && columns.has('subject_id') && scopeColumn !== 'subject_id') { assignments.push('subject_id = ?'); values.push(patch.subjectId); }
    if (patch.folderId !== undefined && columns.has('folder_id') && scopeColumn !== 'folder_id') { assignments.push('folder_id = ?'); values.push(patch.folderId); }
    if (!assignments.length) continue;
    if (columns.has('updated_at')) { assignments.push('updated_at = ?'); values.push(now()); }
    db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE ${scopeColumn} IN (${placeholders})`).run(...values, ...ids);
  }
}

export function moveStudyEntity(kind: 'subject' | 'folder' | 'topic', id: string, input: StudyEntityMoveInput): StudySubject | StudyFolder | StudyTopic {
  const db = getDb();
  return db.transaction(() => {
    const source = getStudyEntity(kind, id);
    if (!source || source.deletedAt || source.archivedAt) throw new Error('El elemento no está disponible.');
    if (kind === 'subject') {
      const courseId = input.courseId ?? '';
      if (!db.prepare('SELECT 1 FROM study_courses WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL').get(courseId)) throw new Error('El curso de destino no existe.');
      if (!getStudyEntity('subject', id)) throw new Error('La asignatura no existe.');
      db.prepare('UPDATE study_subjects SET course_id = ?, updated_at = ? WHERE id = ?').run(courseId, now(), id);
      db.prepare('UPDATE study_folders SET course_id = ?, updated_at = ? WHERE subject_id = ?').run(courseId, now(), id);
      updateStudyScopeReferences('subject_id', [id], { courseId });
      return getStudyEntity('subject', id) as StudySubject;
    }

    if (kind === 'folder') {
      const scope = descendantIds('folder', id);
      if (!scope.folder.has(id) || !getStudyEntity('folder', id)) throw new Error('La carpeta no existe.');
      let subjectId = input.subjectId || null;
      let courseId = input.courseId || null;
      const parentId = input.parentId ?? null;
      if (parentId) {
        if (scope.folder.has(parentId)) throw new Error('La carpeta no puede moverse dentro de sí misma.');
        const parent = db.prepare('SELECT subject_id, course_id FROM study_folders WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL').get(parentId) as Row | undefined;
        if (!parent) throw new Error('La carpeta de destino no existe.');
        const parentSubjectId = parent.subject_id ? String(parent.subject_id) : null;
        if (subjectId && subjectId !== parentSubjectId) throw new Error('La carpeta de destino no pertenece a la asignatura seleccionada.');
        subjectId = parentSubjectId;
        courseId = parent.course_id ? String(parent.course_id) : null;
      }
      const destination = resolveStudyMoveDestination({ courseId, subjectId });
      courseId = destination.courseId;
      subjectId = destination.subjectId;
      if (!subjectId && scope.topic.size) throw new Error('Los temas necesitan una asignatura de destino.');
      const folderIds = [...scope.folder];
      const placeholders = folderIds.map(() => '?').join(',');
      db.prepare(`UPDATE study_folders SET course_id = ?, subject_id = ?, updated_at = ? WHERE id IN (${placeholders})`).run(courseId, subjectId, now(), ...folderIds);
      db.prepare('UPDATE study_folders SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, now(), id);
      updateStudyScopeReferences('folder_id', folderIds, { courseId, subjectId });
      updateStudyScopeReferences('topic_id', [...scope.topic], { courseId, subjectId });
      return getStudyEntity('folder', id) as StudyFolder;
    }

    const scope = descendantIds('topic', id);
    if (!scope.topic.has(id) || !getStudyEntity('topic', id)) throw new Error('El tema no existe.');
    let subjectId = input.subjectId ?? '';
    let folderId = input.folderId ?? null;
    const parentId = input.parentId ?? null;
    if (parentId) {
      if (scope.topic.has(parentId)) throw new Error('El tema no puede moverse dentro de sí mismo.');
      const parent = db.prepare('SELECT subject_id, folder_id FROM study_topics WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL').get(parentId) as Row | undefined;
      if (!parent) throw new Error('El tema superior de destino no existe.');
      const parentSubjectId = String(parent.subject_id);
      if (subjectId && subjectId !== parentSubjectId) throw new Error('El tema superior no pertenece a la asignatura seleccionada.');
      subjectId = parentSubjectId;
      folderId = parent.folder_id ? String(parent.folder_id) : null;
    }
    const subject = db.prepare('SELECT course_id FROM study_subjects WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL').get(subjectId) as Row | undefined;
    if (!subject) throw new Error('La asignatura de destino no existe.');
    if (folderId) {
      const folder = db.prepare('SELECT subject_id FROM study_folders WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL').get(folderId) as Row | undefined;
      if (!folder || String(folder.subject_id ?? '') !== subjectId) throw new Error('La carpeta no pertenece a la asignatura seleccionada.');
    }
    const courseId = String(subject.course_id);
    const topicIds = [...scope.topic];
    const placeholders = topicIds.map(() => '?').join(',');
    db.prepare(`UPDATE study_topics SET subject_id = ?, folder_id = ?, updated_at = ? WHERE id IN (${placeholders})`).run(subjectId, folderId, now(), ...topicIds);
    db.prepare('UPDATE study_topics SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, now(), id);
    updateStudyScopeReferences('topic_id', topicIds, { courseId, subjectId, folderId });
    return getStudyEntity('topic', id) as StudyTopic;
  })();
}

export function setStudyLifecycle(kind: StudyEntityKind, id: string, action: StudyLifecycleAction): void {
  const db = getDb();
  const scope = descendantIds(kind, id);
  const column = action === 'archive' || action === 'restore' ? 'archived_at' : 'deleted_at';
  const value = action === 'archive' || action === 'trash' ? now() : null;
  db.transaction(() => {
    for (const entityKind of Object.keys(scope) as StudyEntityKind[]) {
      const entityIds = [...scope[entityKind]];
      if (!entityIds.length) continue;
      const placeholders = entityIds.map(() => '?').join(',');
      db.prepare(`UPDATE ${TABLES[entityKind]} SET ${column} = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(value, now(), ...entityIds);
    }
  })();
}

export function createStudyTag(input: CreateStudyTagInput): StudyTag {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM study_tags WHERE name = ? COLLATE NOCASE').get(normalizeStudyName(input.name)) as Row | undefined;
  if (existing) return toTag(existing);
  const key = ids('tag');
  const timestamp = now();
  db.prepare(`INSERT INTO study_tags
    (id, short_id, name, color, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, normalizeStudyName(input.name), input.color ?? null, input.icon ?? null,
      nextPosition('study_tags'), timestamp, timestamp);
  return toTag(db.prepare('SELECT * FROM study_tags WHERE id = ?').get(key.id) as Row);
}

export function updateStudyTag(id: string, patch: Partial<CreateStudyTagInput> & { favorite?: boolean; position?: number }): StudyTag | null {
  const db = getDb();
  const entries = Object.entries(patch).filter(([key]) => ['name', 'color', 'icon', 'favorite', 'position'].includes(key));
  if (entries.length) {
    const values = entries.map(([key, value]) => key === 'name' ? normalizeStudyName(String(value ?? '')) : typeof value === 'boolean' ? (value ? 1 : 0) : value);
    db.prepare(`UPDATE study_tags SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  const row = db.prepare('SELECT * FROM study_tags WHERE id = ?').get(id) as Row | undefined;
  return row ? toTag(row) : null;
}

export function deleteStudyTag(id: string): void {
  getDb().prepare('DELETE FROM study_tags WHERE id = ?').run(id);
}

export function setStudyDocumentTags(documentId: string, tagIds: string[]): StudyDocumentTag[] {
  const db = getDb();
  const unique = [...new Set(tagIds)];
  db.transaction(() => {
    db.prepare('DELETE FROM study_doc_tags WHERE document_id = ?').run(documentId);
    unique.forEach((tagId, position) => {
      const key = ids('documentTag');
      const timestamp = now();
      db.prepare(`INSERT INTO study_doc_tags
        (id, short_id, document_id, tag_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(key.id, key.shortId, documentId, tagId, position, timestamp, timestamp);
    });
  })();
  return (db.prepare('SELECT * FROM study_doc_tags WHERE document_id = ? ORDER BY position').all(documentId) as Row[]).map(toDocumentTag);
}

export function createStudyTemplate(input: CreateStudyTemplateInput): StudyTemplate {
  const db = getDb();
  const key = ids('template');
  const timestamp = now();
  db.prepare(`INSERT INTO study_templates
    (id, short_id, kind, name, description, content_json, color, icon, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, input.kind, normalizeStudyName(input.name), input.description ?? null, JSON.stringify(input.content),
      input.color ?? null, input.icon ?? null, nextPosition('study_templates'), timestamp, timestamp);
  return toTemplate(db.prepare('SELECT * FROM study_templates WHERE id = ?').get(key.id) as Row);
}

export function updateStudyTemplate(id: string, patch: Partial<CreateStudyTemplateInput> & { favorite?: boolean; position?: number }): StudyTemplate | null {
  const db = getDb();
  const allowed = new Set(['name', 'kind', 'description', 'content', 'color', 'icon', 'favorite', 'position']);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  const column = (key: string) => key === 'content' ? 'content_json' : key;
  if (entries.length) {
    const values = entries.map(([key, value]) => key === 'name' ? normalizeStudyName(String(value ?? '')) : key === 'content' ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 1 : 0) : value);
    db.prepare(`UPDATE study_templates SET ${entries.map(([key]) => `${column(key)} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  const row = db.prepare('SELECT * FROM study_templates WHERE id = ?').get(id) as Row | undefined;
  return row ? toTemplate(row) : null;
}

export function deleteStudyTemplate(id: string): void {
  getDb().prepare('DELETE FROM study_templates WHERE id = ?').run(id);
}

export function applyStudyTemplate(id: string, name?: string): StudyCourse | StudySubject | StudyDocument {
  const db = getDb();
  const row = db.prepare('SELECT * FROM study_templates WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Plantilla no encontrada.');
  const template = toTemplate(row);
  return db.transaction(() => {
    if (template.kind === 'document') {
      const spec = template.content.document ?? {};
      return createStudyDocument({ title: name ?? spec.title ?? template.name, kind: spec.kind, contentMarkdown: spec.contentMarkdown });
    }
    const addTopics = (subjectId: string, topics: NonNullable<StudyTemplate['content']['subject']>['topics'] = [], parentId: string | null = null) => {
      for (const topic of topics ?? []) {
        const created = createStudyTopic({ subjectId, parentId, name: topic.name, description: topic.description });
        addTopics(subjectId, topic.children, created.id);
      }
    };
    if (template.kind === 'subject') {
      const course = createStudyCourse({ name: `${name ?? template.name}` });
      const spec = template.content.subject ?? { name: template.name };
      const subject = createStudySubject({ courseId: course.id, name: name ?? spec.name, description: spec.description });
      addTopics(subject.id, spec.topics);
      return subject;
    }
    const spec = template.content.course ?? {};
    const course = createStudyCourse({ name: name ?? spec.name ?? template.name, description: spec.description });
    for (const subjectSpec of spec.subjects ?? []) {
      const subject = createStudySubject({ courseId: course.id, name: subjectSpec.name, description: subjectSpec.description });
      addTopics(subject.id, subjectSpec.topics);
    }
    return course;
  })();
}

function copyNativeStudyDocument(sourceId: string, targetId: string): void {
  const row = getDb().prepare('SELECT native_document_json, native_schema_version, style_json, spellcheck_language, custom_dictionary_json FROM study_docs WHERE id = ?').get(sourceId) as Row;
  const native = parseNativeDocument(row.native_document_json);
  getDb().prepare('UPDATE study_docs SET native_document_json = ?, native_schema_version = ?, style_json = ?, spellcheck_language = ?, custom_dictionary_json = ? WHERE id = ?').run(native ? JSON.stringify(cloneNativeDocument(native)) : null, row.native_schema_version, row.style_json, row.spellcheck_language, row.custom_dictionary_json, targetId);
}

export function duplicateStudyTree(kind: StudyEntityKind, id: string): StudyCourse | StudySubject | StudyTopic | StudyFolder | StudyDocument {
  const db = getDb();
  return db.transaction(() => {
    if (kind === 'document') {
      const original = getStudyEntity('document', id) as StudyDocument | null;
      if (!original) throw new Error('Documento no encontrado.');
      const copy = createStudyDocument({
        title: `${original.title} (copia)`, kind: original.kind, contentMarkdown: original.contentMarkdown,
        description: original.description, color: original.color, icon: original.icon, emoji: original.emoji,
        imageData: original.imageData, year: original.year,
      });
      copyNativeStudyDocument(id, copy.id);
      const placements = db.prepare('SELECT * FROM study_placements WHERE document_id = ?').all(id) as Row[];
      for (const placementRow of placements) {
        const placement = toPlacement(placementRow);
        addStudyPlacement(copy.id, placement);
      }
      return copy;
    }

    const scope = descendantIds(kind, id);
    const courseMap = new Map<string, string>();
    const subjectMap = new Map<string, string>();
    const topicMap = new Map<string, string>();
    const folderMap = new Map<string, string>();
    let root: StudyCourse | StudySubject | StudyTopic | StudyFolder | null = null;

    for (const oldId of scope.course) {
      const old = getStudyEntity('course', oldId) as StudyCourse;
      const copy = createStudyCourse({ name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon, emoji: old.emoji, imageData: old.imageData, year: old.year, academicYearId: old.academicYearId });
      courseMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    for (const oldId of scope.subject) {
      const old = getStudyEntity('subject', oldId) as StudySubject;
      const targetCourse = courseMap.get(old.courseId) ?? old.courseId;
      // Copying the year verbatim keeps an inheriting subject inheriting, so pointing
      // the copied course at next September carries its subjects along.
      const copy = createStudySubject({ courseId: targetCourse, name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon, emoji: old.emoji, imageData: old.imageData, year: old.year, academicYearId: old.academicYearId });
      subjectMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    const pendingTopics = [...scope.topic];
    while (pendingTopics.length) {
      const oldId = pendingTopics.shift()!;
      const old = getStudyEntity('topic', oldId) as StudyTopic;
      if (old.parentId && scope.topic.has(old.parentId) && !topicMap.has(old.parentId)) { pendingTopics.push(oldId); continue; }
      const copy = createStudyTopic({ subjectId: subjectMap.get(old.subjectId) ?? old.subjectId,
        folderId: old.folderId && !scope.folder.has(old.folderId) ? old.folderId : null,
        parentId: old.parentId ? topicMap.get(old.parentId) ?? old.parentId : null,
        name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon, emoji: old.emoji, imageData: old.imageData, year: old.year });
      topicMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    const pendingFolders = [...scope.folder];
    while (pendingFolders.length) {
      const oldId = pendingFolders.shift()!;
      const old = getStudyEntity('folder', oldId) as StudyFolder;
      if (old.parentId && scope.folder.has(old.parentId) && !folderMap.has(old.parentId)) { pendingFolders.push(oldId); continue; }
      const copy = createStudyFolder({ parentId: old.parentId ? folderMap.get(old.parentId) ?? old.parentId : null,
        courseId: old.courseId ? courseMap.get(old.courseId) ?? old.courseId : null,
        subjectId: old.subjectId ? subjectMap.get(old.subjectId) ?? old.subjectId : null,
        name: `${old.name}${oldId === id ? ' (copia)' : ''}`, description: old.description, color: old.color, icon: old.icon, emoji: old.emoji, imageData: old.imageData, year: old.year });
      folderMap.set(oldId, copy.id); if (oldId === id) root = copy;
    }
    for (const [oldTopicId, newTopicId] of topicMap) {
      const old = getStudyEntity('topic', oldTopicId) as StudyTopic;
      if (old.folderId && folderMap.has(old.folderId)) updateStudyEntity('topic', newTopicId, { folderId: folderMap.get(old.folderId) });
    }

    const placements = db.prepare('SELECT * FROM study_placements').all() as Row[];
    const relevant = placements.map(toPlacement).filter((placement) =>
      (placement.courseId && scope.course.has(placement.courseId)) ||
      (placement.subjectId && scope.subject.has(placement.subjectId)) ||
      (placement.topicId && scope.topic.has(placement.topicId)) ||
      (placement.folderId && scope.folder.has(placement.folderId)));
    const docMap = new Map<string, string>();
    for (const placement of relevant) {
      let copyId = docMap.get(placement.documentId);
      if (!copyId) {
        const old = getStudyEntity('document', placement.documentId) as StudyDocument;
        const copy = createStudyDocument({ title: old.title, kind: old.kind, contentMarkdown: old.contentMarkdown,
          description: old.description, color: old.color, icon: old.icon, emoji: old.emoji, imageData: old.imageData, year: old.year });
        copyNativeStudyDocument(old.id, copy.id);
        copyId = copy.id; docMap.set(old.id, copy.id);
      }
      const mapped: StudyPlacementInput = {
        courseId: placement.courseId ? courseMap.get(placement.courseId) ?? placement.courseId : null,
        subjectId: placement.subjectId ? subjectMap.get(placement.subjectId) ?? placement.subjectId : null,
        topicId: placement.topicId ? topicMap.get(placement.topicId) ?? placement.topicId : null,
        folderId: placement.folderId ? folderMap.get(placement.folderId) ?? placement.folderId : null,
      };
      if (studyPlacementKey(mapped) !== studyPlacementKey(placement)) addStudyPlacement(copyId, mapped);
    }
    if (!root) throw new Error('Elemento de estudio no encontrado.');
    return root;
  })();
}
