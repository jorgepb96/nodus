import {academicMarkdownProjection,assertAcademicSupplement} from '@shared/academicProjection';
import { normalizeAcademicMetadata } from '@shared/academicDocument';
import { externalizeEditorAttachments } from './editorAttachmentsRepo';
import crypto from 'node:crypto';
import { markdownToBlockNote, nativeDocumentText, parseNativeDocument, validateBlockNoteDocument } from '@shared/blockNoteDocument';
import { resolveBlockAnnotations } from '@shared/blockNoteAnnotations';
import type {
  StudyAnnotation,
  StudyAnnotationInput,
  StudyDocEditorData,
  StudyDocLink,
  StudyDocStyle,
  StudyDocUpdateInput,
  StudyDocVersion,
} from '@shared/studyEditor';
import { normalizeStudyDocStyle, parseStudyDocLinks } from '@shared/studyEditor';
import type { StudyDocument } from '@shared/studyOrg';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';
import { getStudyEntity } from './studyOrgRepo';

type Row = Record<string, unknown>;

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;
const contentHash = (title: string, content: string, style: StudyDocStyle) =>
  crypto.createHash('sha256').update(`${title}\0${content}\0${JSON.stringify(style)}`).digest('hex');

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function base(row: Row) {
  return {
    id: String(row.id), shortId: String(row.short_id), position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

const toVersion = (row: Row): StudyDocVersion => ({
  ...base(row),
  documentId: String(row.document_id),
  versionNo: Number(row.version_no),
  title: String(row.title),
  contentMarkdown: String(row.content_markdown),
  nativeDocument: parseNativeDocument(row.native_document_json),
    academicMetadata: normalizeAcademicMetadata(parseJson(row.academic_metadata_json, null)),
  schemaVersion: Number(row.native_schema_version ?? 1),
  style: normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {})),
  reason: String(row.reason) as StudyDocVersion['reason'],
  contentHash: String(row.content_hash),
});

const toAnnotation = (row: Row): StudyAnnotation => ({
  ...base(row),
  documentId: String(row.document_id),
  from: Number(row.from_pos),
  to: Number(row.to_pos),
  selectedText: String(row.selected_text ?? ''),
  anchor: parseJson(row.anchor_json, null),
  comment: String(row.comment ?? ''),
  color: row.color ? String(row.color) : null,
  resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  locked: bool(row.locked),
  pinned: bool(row.pinned),
});

const toLink = (row: Row): StudyDocLink => ({
  ...base(row),
  sourceDocumentId: String(row.source_document_id),
  targetDocumentId: row.target_document_id ? String(row.target_document_id) : null,
  targetRef: String(row.target_ref),
  targetTitle: row.target_title ? String(row.target_title) : null,
  linkText: row.link_text ? String(row.link_text) : null,
});

function docRow(documentId: string): Row {
  const row = getDb().prepare('SELECT * FROM embedding_read_study_docs AS study_docs WHERE id = ?').get(documentId) as Row | undefined;
  if (!row) throw new Error('Documento de estudio no encontrado.');
  return row;
}

export function listStudyDocVersions(documentId: string): StudyDocVersion[] {
  return (getDb().prepare(`SELECT * FROM study_doc_versions WHERE document_id = ? AND deleted_at IS NULL
    ORDER BY version_no DESC`).all(documentId) as Row[]).map(toVersion);
}

function snapshot(row: Row, reason: StudyDocVersion['reason']): StudyDocVersion | null {
  const db = getDb();
  const style = normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {}));
  const hash = contentHash(String(row.title), String(row.content_markdown ?? '') + '\0' + String(row.native_document_json ?? '') + '\0' + String(row.academic_metadata_json ?? ''), style);
  const duplicate = db.prepare('SELECT * FROM study_doc_versions WHERE document_id = ? AND content_hash = ? ORDER BY version_no DESC LIMIT 1')
    .get(row.id, hash) as Row | undefined;
  if (duplicate) return null;
  const next = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM study_doc_versions WHERE document_id = ?')
    .get(row.id) as Row;
  const key = ids('VER');
  const timestamp = now();
  db.prepare(`INSERT INTO study_doc_versions
    (id, short_id, document_id, version_no, title, content_markdown, style_json, reason, content_hash, position, created_at, updated_at, native_document_json, native_schema_version, academic_metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, row.id, Number(next.value), row.title, row.content_markdown ?? '', JSON.stringify(style), reason,
      hash, Number(next.value), timestamp, timestamp, row.native_document_json ?? null, row.native_schema_version ?? 1, row.academic_metadata_json ?? null);
  return toVersion(db.prepare('SELECT * FROM study_doc_versions WHERE id = ?').get(key.id) as Row);
}

function resolveTarget(targetRef: string): { id: string | null; title: string | null } {
  const db = getDb();
  const row = db.prepare(`SELECT id, title FROM study_docs
    WHERE deleted_at IS NULL AND (id = ? OR short_id = ? OR title = ? COLLATE NOCASE) LIMIT 1`)
    .get(targetRef, targetRef, targetRef) as Row | undefined;
  return row ? { id: String(row.id), title: String(row.title) } : { id: null, title: null };
}

function syncLinks(documentId: string, markdown: string): void {
  const db = getDb();
  db.prepare('DELETE FROM study_doc_links WHERE source_document_id = ?').run(documentId);
  parseStudyDocLinks(markdown).forEach((parsed, position) => {
    const target = resolveTarget(parsed.targetRef);
    if (target.id === documentId) return;
    const key = ids('LNK');
    const timestamp = now();
    db.prepare(`INSERT INTO study_doc_links
      (id, short_id, source_document_id, target_document_id, target_ref, target_title, link_text, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(key.id, key.shortId, documentId, target.id, parsed.targetRef, target.title, parsed.label, position, timestamp, timestamp);
  });
}

export function getStudyDocEditorData(documentId: string): StudyDocEditorData {
  const db = getDb();
  const row = docRow(documentId);
  return {
    documentTitle: String(row.title),
    contentMarkdown: String(row.content_markdown ?? ''),
    nativeDocument: parseNativeDocument(row.native_document_json),
    academicMetadata: normalizeAcademicMetadata(parseJson(row.academic_metadata_json, null)),
    schemaVersion: Number(row.native_schema_version ?? 1),
    revision: Number(row.editor_revision ?? 0),
    versions: listStudyDocVersions(documentId),
    annotations: resolveBlockAnnotations((db.prepare(`SELECT * FROM study_annotations WHERE document_id = ? AND deleted_at IS NULL
      ORDER BY resolved_at IS NOT NULL, pinned DESC, position, created_at DESC`).all(documentId) as Row[]).map(toAnnotation), parseNativeDocument(row.native_document_json)),
    outgoingLinks: (db.prepare('SELECT * FROM study_doc_links WHERE source_document_id = ? ORDER BY position').all(documentId) as Row[]).map(toLink),
    backlinks: (db.prepare('SELECT * FROM study_doc_links WHERE target_document_id = ? ORDER BY updated_at DESC').all(documentId) as Row[]).map(toLink),
    style: normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {})),
    spellcheckLanguage: String(row.spellcheck_language ?? 'es-ES'),
    customDictionary: parseJson<string[]>(row.custom_dictionary_json, []).filter((word) => typeof word === 'string'),
  };
}

export function updateStudyDoc(documentId: string, input: StudyDocUpdateInput): StudyDocument {
  const db = getDb();
  return db.transaction(() => {
    const current = docRow(documentId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== Number(current.editor_revision)) throw new Error('REVISION_CONFLICT: El documento ha cambiado en otra sesión. El borrador se conserva.');
    input = externalizeEditorAttachments(input);
    if(input.nativeDocument===undefined)assertAcademicSupplement(String(current.content_markdown??''),input.contentMarkdown);
    const previousNative = parseNativeDocument(current.native_document_json);
    const native = input.nativeDocument === undefined ? (previousNative ? markdownToBlockNote(input.contentMarkdown, previousNative) : null) : input.nativeDocument === null ? null : validateBlockNoteDocument(input.nativeDocument);
    const nativeJson = native ? JSON.stringify(native) : null;
    const academicJson = JSON.stringify(normalizeAcademicMetadata(input.academicMetadata ?? parseJson(current.academic_metadata_json, null)));
    const style = normalizeStudyDocStyle({
      ...parseJson<Partial<StudyDocStyle>>(current.style_json, {}),
      ...(input.style ?? {}),
    });
    const title = normalizeStudyName(input.title);
    const content = native ? academicMarkdownProjection(native,JSON.parse(academicJson)) : input.contentMarkdown.replace(/\r\n/g, '\n');
    const lockedFragments = db.prepare(`SELECT * FROM study_annotations
      WHERE document_id = ? AND locked = 1 AND resolved_at IS NULL AND deleted_at IS NULL AND selected_text <> ''`)
      .all(documentId) as Row[];
    const missingLocked = lockedFragments.find(fragment => native && fragment.anchor_json
      ? resolveBlockAnnotations([toAnnotation(fragment)],native)[0].anchorStatus === 'missing'
      : !content.includes(String(fragment.selected_text)) && !(native && nativeDocumentText(native).includes(String(fragment.selected_text))));
    if (missingLocked) throw new Error(`El fragmento bloqueado ya no está presente: ${String(missingLocked.selected_text).slice(0, 80)}`);
    const changed = academicJson !== current.academic_metadata_json || nativeJson !== (current.native_document_json ?? null) || title !== current.title || content !== current.content_markdown || JSON.stringify(style) !== JSON.stringify(normalizeStudyDocStyle(parseJson(current.style_json, {})));
    if (changed) snapshot(current, input.reason ?? 'manual');
    db.prepare(`UPDATE study_docs SET title = ?, content_markdown = ?, style_json = ?, spellcheck_language = ?,
      custom_dictionary_json = ?, native_document_json = ?, native_schema_version = ?, academic_metadata_json = ?, editor_revision = editor_revision + 1, updated_at = ? WHERE id = ?`)
      .run(title, content, JSON.stringify(style), input.spellcheckLanguage ?? current.spellcheck_language ?? 'es-ES',
        JSON.stringify(input.customDictionary ?? parseJson(current.custom_dictionary_json, [])), nativeJson, input.schemaVersion ?? 1, academicJson, now(), documentId);
    syncLinks(documentId, content);
    return { ...getStudyEntity('document', documentId) as StudyDocument, editorRevision: Number(current.editor_revision) + 1 };
  })();
}

export function restoreStudyDocVersion(documentId: string, versionId: string): StudyDocument {
  const row = getDb().prepare('SELECT * FROM study_doc_versions WHERE id = ? AND document_id = ?').get(versionId, documentId) as Row | undefined;
  if (!row) throw new Error('Versión no encontrada.');
  const version = toVersion(row);
  return updateStudyDoc(documentId, {
    title: version.title,
    contentMarkdown: version.contentMarkdown,
    nativeDocument: version.nativeDocument ?? undefined,
    schemaVersion: version.schemaVersion,
    academicMetadata: version.academicMetadata,
    style: version.style,
    reason: 'restore',
  });
}

export function createStudyAnnotation(documentId: string, input: StudyAnnotationInput): StudyAnnotation {
  const db = getDb();
  docRow(documentId);
  const key = ids('ANN');
  const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_annotations WHERE document_id = ?').get(documentId) as Row).value);
  db.prepare(`INSERT INTO study_annotations
    (id, short_id, document_id, from_pos, to_pos, selected_text, comment, color, locked, pinned, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, documentId, Math.max(0, input.from), Math.max(input.from, input.to), input.selectedText,
      input.comment.trim(), input.color ?? null, input.locked ? 1 : 0, input.pinned ? 1 : 0, position, timestamp, timestamp);
  if (input.anchor) db.prepare('UPDATE study_annotations SET anchor_json = ? WHERE id = ?').run(JSON.stringify(input.anchor), key.id);
  return toAnnotation(db.prepare('SELECT * FROM study_annotations WHERE id = ?').get(key.id) as Row);
}

export function updateStudyAnnotation(id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }): StudyAnnotation | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM study_annotations WHERE id = ?').get(id) as Row | undefined;
  if (!current) return null;
  const next = {
    comment: patch.comment ?? current.comment,
    color: patch.color === undefined ? current.color : patch.color,
    locked: patch.locked === undefined ? current.locked : patch.locked ? 1 : 0,
    pinned: patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0,
    resolvedAt: patch.resolved === undefined ? current.resolved_at : patch.resolved ? now() : null,
  };
  db.prepare(`UPDATE study_annotations SET comment = ?, color = ?, locked = ?, pinned = ?, resolved_at = ?, anchor_json = ?, from_pos = ?, to_pos = ?, selected_text = ?, updated_at = ? WHERE id = ?`)
    .run(next.comment, next.color, next.locked, next.pinned, next.resolvedAt,
      patch.anchor === undefined ? current.anchor_json : patch.anchor ? JSON.stringify(patch.anchor) : null,
      patch.from ?? current.from_pos, patch.to ?? current.to_pos, patch.selectedText ?? current.selected_text, now(), id);
  return toAnnotation(db.prepare('SELECT * FROM study_annotations WHERE id = ?').get(id) as Row);
}

export function deleteStudyAnnotation(id: string): void {
  getDb().prepare('DELETE FROM study_annotations WHERE id = ?').run(id);
}
