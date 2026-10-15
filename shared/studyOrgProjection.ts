import type { StudyAcademicYear } from './studyAcademicYears';
import type { StudyCourse, StudySubject, StudyTopic, StudyFolder, StudyDocument, StudyPlacement, StudyTag, StudyDocumentTag, StudyTemplate, StudyWorkspace, StudyWorkspaceOptions } from './studyOrg';
export type StudyProjectionRow = Record<string, unknown>;
type Row = StudyProjectionRow;

export function bool(value: unknown): boolean {
  return Number(value) === 1;
}

export function base(row: Row) {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function named(row: Row) {
  return {
    ...base(row),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    color: row.color ? String(row.color) : null,
    icon: row.icon ? String(row.icon) : null,
    emoji: row.emoji ? String(row.emoji) : null,
    imageData: row.image_data ? String(row.image_data) : null,
    year: row.year == null ? null : Number(row.year),
    favorite: bool(row.favorite),
  };
}

export const toAcademicYear = (row: Row): StudyAcademicYear => ({
  ...base(row),
  label: String(row.label),
  startDate: String(row.start_date),
  endDate: String(row.end_date),
  color: row.color ? String(row.color) : null,
});
export const toCourse = (row: Row): StudyCourse => ({ ...named(row), academicYearId: row.academic_year_id ? String(row.academic_year_id) : null });
export const toSubject = (row: Row): StudySubject => ({
  ...named(row),
  courseId: String(row.course_id),
  academicYearId: row.academic_year_id ? String(row.academic_year_id) : null,
});
export const toTopic = (row: Row): StudyTopic => ({
  ...named(row),
  subjectId: String(row.subject_id),
  folderId: row.folder_id ? String(row.folder_id) : null,
  parentId: row.parent_id ? String(row.parent_id) : null,
});
export const toFolder = (row: Row): StudyFolder => ({
  ...named(row),
  parentId: row.parent_id ? String(row.parent_id) : null,
  courseId: row.course_id ? String(row.course_id) : null,
  subjectId: row.subject_id ? String(row.subject_id) : null,
});
export const toDocument = (row: Row): StudyDocument => ({
  ...base(row),
  title: String(row.title),
  kind: String(row.kind) as StudyDocument['kind'],
  contentMarkdown: String(row.content_markdown ?? ''),
  description: row.description ? String(row.description) : null,
  color: row.color ? String(row.color) : null,
  icon: row.icon ? String(row.icon) : null,
  emoji: row.emoji ? String(row.emoji) : null,
  imageData: row.image_data ? String(row.image_data) : null,
  year: row.year == null ? null : Number(row.year),
  favorite: bool(row.favorite),
  pinned: bool(row.pinned),
  locked: bool(row.locked),
  embeddingProvider: row.embedding_provider ? String(row.embedding_provider) : null,
  embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
  embeddingDim: row.embedding_dim == null ? null : Number(row.embedding_dim),
  embeddingTextHash: row.embedding_text_hash ? String(row.embedding_text_hash) : null,
});
export const toPlacement = (row: Row): StudyPlacement => ({
  ...base(row),
  documentId: String(row.document_id),
  courseId: row.course_id ? String(row.course_id) : null,
  subjectId: row.subject_id ? String(row.subject_id) : null,
  topicId: row.topic_id ? String(row.topic_id) : null,
  folderId: row.folder_id ? String(row.folder_id) : null,
});
export const toTag = (row: Row): StudyTag => named(row);
export const toDocumentTag = (row: Row): StudyDocumentTag => ({
  ...base(row),
  documentId: String(row.document_id),
  tagId: String(row.tag_id),
});
export const toTemplate = (row: Row): StudyTemplate => ({
  ...named(row),
  kind: String(row.kind) as StudyTemplate['kind'],
  content: JSON.parse(String(row.content_json || '{}')) as StudyTemplate['content'],
});


/** Projects only rows already included in a publication or downloaded snapshot. */
export function projectStudyWorkspace(tables: Record<string, StudyProjectionRow[]>, options: StudyWorkspaceOptions = {}): StudyWorkspace {
  const list = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error(`La copia publicada no incluye la tabla ${table}. Descarga una publicación compatible.`);
    return tables[table].filter(row => (options.includeArchived || row.archived_at == null) && (options.includeDeleted || row.deleted_at == null))
      .slice().sort((a,b) => Number(a.position ?? 0)-Number(b.position ?? 0) || compareText(a.created_at,b.created_at));
  };
  const documents = list('study_docs').map(toDocument);
  const documentIds = new Set(documents.map(document => document.id));
  const tags = list('study_tags').map(toTag);
  const tagIds = new Set(tags.map(tag => tag.id));
  return {
    academicYears: list('study_academic_years').sort((a,b)=>compareText(b.start_date,a.start_date)||compareText(b.label,a.label)).map(toAcademicYear),
    courses:list('study_courses').map(toCourse), subjects:list('study_subjects').map(toSubject),
    topics:list('study_topics').map(toTopic), folders:list('study_folders').map(toFolder), documents,
    placements:list('study_placements').map(toPlacement).filter(row=>documentIds.has(row.documentId)), tags,
    documentTags:list('study_doc_tags').map(toDocumentTag).filter(row=>documentIds.has(row.documentId)&&tagIds.has(row.tagId)),
    templates:list('study_templates').map(toTemplate),
  };
}
function compareText(a: unknown,b: unknown):number { return String(a ?? '') < String(b ?? '') ? -1 : String(a ?? '') > String(b ?? '') ? 1 : 0; }
