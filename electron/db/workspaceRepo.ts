import {academicMarkdownProjection,assertAcademicSupplement} from '@shared/academicProjection';
import { normalizeAcademicMetadata } from '@shared/academicDocument';
import { scheduleManualIndex } from '../ai/manualIdeaIndex';
// El Workspace por dentro: el editor completo sobre una NOTA, y los enlaces con la
// biblioteca.
//
// Es el gemelo de `studyEditorRepo`, y lo es a propósito. El editor de Estudio y
// Docencia es una sola pieza de interfaz que ahora también escribe notas e ideas, así
// que habla un único idioma —`StudyDocEditorData`, `StudyDocUpdateInput`— y lo que
// cambia debajo es solo dónde vive la fila. Devolver esas mismas formas es lo que
// permite que el editor no sepa (ni tenga que saber) sobre qué está escribiendo.
//
// Dos diferencias con el gemelo, ambas deliberadas:
//
//  · Los ENLACES ENTRE NOTAS no tienen tabla. Se leen del propio Markdown cada vez
//    (`[[Título]]` y `nodus://note/<id>`), porque una tabla de enlaces derivada del texto
//    solo puede desincronizarse con él. El corpus de notas de una bóveda se cuenta por
//    cientos, no por millones: recalcularlo es más barato que mantenerlo coherente.
//
//  · Los ENLACES CON LA BIBLIOTECA sí tienen tabla, porque no son derivados de nada:
//    los pone la persona. Y no llevan clave foránea contra la biblioteca porque los
//    elementos globales viven en otra base de datos, fuera de esta bóveda.

import crypto from 'node:crypto';
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
import type { Note, WorkspaceLibraryLink, WorkspaceLibraryLinkInput } from '@shared/types';
import { getDb } from './database';
import { getNote } from './notesRepo';
import { getPageDocumentForNote, reconcileLegacyNoteCache, synchronizeNotePage, savePageDocument } from './pagesRepo';
import { blockNoteToPageBlocks, markdownToBlockNote, nativeDocumentText, parseNativeDocument, validateBlockNoteDocument } from '@shared/blockNoteDocument';
import { markdownToPageBlocks } from '@shared/pages';
import type { PageDocument } from '@shared/pages';
import { resolveBlockAnnotations } from '@shared/blockNoteAnnotations';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;
const text = (value: unknown) => (value == null ? '' : String(value));

const contentHash = (title: string, content: string, style: StudyDocStyle) =>
  crypto.createHash('sha256').update(`${title}\0${content}\0${JSON.stringify(style)}`).digest('hex');

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function noteRow(noteId: string): Row {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as Row | undefined;
  if (!row) throw new Error('La nota no existe.');
  return row;
}

const toVersion = (row: Row): StudyDocVersion => ({
  id: String(row.id),
  // El editor comparte tipos con Estudio, donde cada fila lleva un identificador corto
  // legible. Aquí no hay tal cosa, así que el corto ES el largo: mejor repetirlo que
  // inventar un segundo identificador que nadie usaría para nada.
  shortId: String(row.id),
  documentId: String(row.note_id),
  versionNo: Number(row.version_no),
  title: String(row.title),
  contentMarkdown: String(row.content_markdown),
  nativeDocument: parseNativeDocument(row.native_document_json),
  academicMetadata: normalizeAcademicMetadata(parseJson(row.academic_metadata_json, null)),
  schemaVersion: Number(row.native_schema_version ?? 1),
  style: normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {})),
  reason: String(row.reason) as StudyDocVersion['reason'],
  contentHash: String(row.content_hash),
  position: Number(row.version_no),
  archivedAt: null,
  deletedAt: null,
  createdAt: String(row.created_at),
  updatedAt: String(row.created_at),
});

const toAnnotation = (row: Row): StudyAnnotation => ({
  id: String(row.id),
  shortId: String(row.id),
  documentId: String(row.note_id),
  from: Number(row.from_pos),
  to: Number(row.to_pos),
  selectedText: text(row.selected_text),
  anchor: parseJson(row.anchor_json, null),
  comment: text(row.comment),
  color: row.color ? String(row.color) : null,
  resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  locked: bool(row.locked),
  pinned: bool(row.pinned),
  position: Number(row.position ?? 0),
  archivedAt: null,
  deletedAt: null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

// ── Historial ────────────────────────────────────────────────────────────────────

export function listWorkspaceNoteVersions(noteId: string): StudyDocVersion[] {
  return (getDb()
    .prepare('SELECT * FROM note_versions WHERE note_id = ? ORDER BY version_no DESC')
    .all(noteId) as Row[]).map(toVersion);
}

/** Guarda el estado ACTUAL como versión. Un contenido ya archivado no se repite. */
function snapshot(row: Row, reason: StudyDocVersion['reason'], native = getPageDocumentForNote(String(row.id))): StudyDocVersion | null {
  const db = getDb();
  const style = normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {}));
  const hash = contentHash(String(row.title), text(row.content) + '\0' + JSON.stringify(native?.nativeDocument ?? null) + '\0' + JSON.stringify(native?.academicMetadata ?? null), style);
  const duplicate = db
    .prepare('SELECT 1 FROM note_versions WHERE note_id = ? AND content_hash = ? LIMIT 1')
    .get(row.id, hash);
  if (duplicate) return null;
  const next = db
    .prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM note_versions WHERE note_id = ?')
    .get(row.id) as Row;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO note_versions (id, note_id, version_no, title, content_markdown, style_json, reason, content_hash, created_at, native_document_json, native_schema_version, academic_metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, row.id, Number(next.value), row.title, text(row.content), JSON.stringify(style), reason, hash, now(), native?.nativeDocument ? JSON.stringify(native.nativeDocument) : null, native?.schemaVersion ?? 1, JSON.stringify(native?.academicMetadata ?? null));
  return toVersion(db.prepare('SELECT * FROM note_versions WHERE id = ?').get(id) as Row);
}

// ── Enlaces entre notas, leídos del texto ────────────────────────────────────────

function resolveNoteTarget(targetRef: string): { id: string | null; title: string | null } {
  const row = getDb()
    .prepare('SELECT id, title FROM notes WHERE id = ? OR title = ? COLLATE NOCASE LIMIT 1')
    .get(targetRef, targetRef) as Row | undefined;
  return row ? { id: String(row.id), title: String(row.title) } : { id: null, title: null };
}

function linkRow(sourceId: string, parsed: { targetRef: string; label: string | null }, position: number): StudyDocLink {
  const target = resolveNoteTarget(parsed.targetRef);
  return {
    id: `${sourceId}:${position}`,
    shortId: `${sourceId}:${position}`,
    sourceDocumentId: sourceId,
    targetDocumentId: target.id,
    targetRef: parsed.targetRef,
    targetTitle: target.title,
    linkText: parsed.label,
    position,
    archivedAt: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

function outgoingNoteLinks(noteId: string, markdown: string): StudyDocLink[] {
  return parseStudyDocLinks(markdown)
    .map((parsed, position) => linkRow(noteId, parsed, position))
    .filter((link) => link.targetDocumentId !== noteId);
}

/**
 * Las notas que apuntan a esta. Se acota con LIKE sobre el identificador y el título
 * antes de volver a analizar el Markdown, para no parsear todas las notas de la bóveda
 * cada vez que se abre una.
 */
function noteBacklinks(noteId: string, title: string): StudyDocLink[] {
  const candidates = getDb()
    .prepare('SELECT id, content FROM notes WHERE id <> ? AND (content LIKE ? OR content LIKE ?)')
    .all(noteId, `%${noteId}%`, `%[[${title}%`) as Row[];
  const links: StudyDocLink[] = [];
  for (const candidate of candidates) {
    outgoingNoteLinks(String(candidate.id), text(candidate.content))
      .filter((link) => link.targetDocumentId === noteId)
      .forEach((link) => links.push(link));
  }
  return links;
}

// ── Lo que el editor pide al abrir una nota ──────────────────────────────────────

export function getWorkspaceNoteEditorData(noteId: string): StudyDocEditorData {
  const existing = getPageDocumentForNote(noteId);
  const document = existing && !existing.nativeDocument ? existing : reconcileLegacyNoteCache(noteId);
  const db = getDb();
  const row = noteRow(noteId);
  return {
    documentTitle: String(row.title),
    contentMarkdown: text(row.content),
    nativeDocument: document.nativeDocument,
    academicMetadata: document.academicMetadata,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    versions: listWorkspaceNoteVersions(noteId),
    annotations: resolveBlockAnnotations((db.prepare(
      `SELECT * FROM note_annotations WHERE note_id = ?
        ORDER BY resolved_at IS NOT NULL, pinned DESC, position, created_at DESC`
    ).all(noteId) as Row[]).map(toAnnotation), document.nativeDocument),
    outgoingLinks: outgoingNoteLinks(noteId, text(row.content)),
    backlinks: noteBacklinks(noteId, String(row.title)),
    style: normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(row.style_json, {})),
    spellcheckLanguage: String(row.spellcheck_language ?? 'es-ES'),
    customDictionary: parseJson<string[]>(row.custom_dictionary_json, []).filter((word) => typeof word === 'string'),
  };
}

/** Guardado del editor: versiona lo anterior, respeta los fragmentos bloqueados. */
export function updateWorkspaceNote(noteId: string, input: StudyDocUpdateInput): Note {
  const db = getDb();
  return db.transaction(() => {
    const current = noteRow(noteId);
    const pageDocument = getPageDocumentForNote(noteId) ?? reconcileLegacyNoteCache(noteId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== pageDocument.revision) throw new Error('REVISION_CONFLICT: La nota ha cambiado en otra sesión. El borrador se conserva.');
    if(input.nativeDocument===undefined)assertAcademicSupplement(pageDocument.markdown,input.contentMarkdown);
    const native = input.nativeDocument === undefined
      ? (pageDocument.nativeDocument ? markdownToBlockNote(input.contentMarkdown, pageDocument.nativeDocument) : null)
      : input.nativeDocument === null ? null : validateBlockNoteDocument(input.nativeDocument);
    const academicMetadata = normalizeAcademicMetadata(input.academicMetadata ?? pageDocument.academicMetadata);
    const style = normalizeStudyDocStyle({
      ...parseJson<Partial<StudyDocStyle>>(current.style_json, {}),
      ...(input.style ?? {}),
    });
    const title = input.title.trim() || 'Nota sin título';
    const content = native ? academicMarkdownProjection(native,academicMetadata) : input.contentMarkdown.replace(/\r\n/g, '\n');
    const locked = db.prepare(
      `SELECT * FROM note_annotations
        WHERE note_id = ? AND locked = 1 AND resolved_at IS NULL AND selected_text <> ''`
    ).all(noteId) as Row[];
    const missing = locked.find(fragment => native && fragment.anchor_json
      ? resolveBlockAnnotations([toAnnotation(fragment)],native)[0].anchorStatus === 'missing'
      : !content.includes(text(fragment.selected_text)) && !(native && nativeDocumentText(native).includes(text(fragment.selected_text))));
    if (missing) throw new Error(`El fragmento bloqueado ya no está presente: ${text(missing.selected_text).slice(0, 80)}`);

    const styleChanged = JSON.stringify(style) !== JSON.stringify(
      normalizeStudyDocStyle(parseJson<Partial<StudyDocStyle>>(current.style_json, {}))
    );
    if (JSON.stringify(academicMetadata) !== JSON.stringify(pageDocument.academicMetadata) || title !== current.title || content !== text(current.content) || styleChanged || JSON.stringify(native) !== JSON.stringify(pageDocument.nativeDocument ?? null)) {
      snapshot(current, input.reason ?? 'manual', pageDocument);
    }
    db.prepare(
      `UPDATE notes SET title = ?, content = ?, style_json = ?, spellcheck_language = ?,
         custom_dictionary_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      title, content, JSON.stringify(style),
      input.spellcheckLanguage ?? current.spellcheck_language ?? 'es-ES',
      JSON.stringify(input.customDictionary ?? parseJson<string[]>(current.custom_dictionary_json, [])),
      now(), noteId
    );
    const source = parseJson<{ note?: string; ref?: string }>(current.source_json, {});
    // Authored idea development and its owning structured note describe the
    // same content in every academic mode, including companion creation.
    if (source.note === 'manual-idea' && source.ref) {
      db.prepare(`UPDATE ideas SET label=?, statement=?, embedding=CASE WHEN label<>? OR statement<>? THEN NULL ELSE embedding END WHERE global_id=?`)
        .run(title, content, title, content, source.ref);
      scheduleManualIndex();
    }
    let savedDocument: PageDocument;
    if (native || input.nativeDocument === null || input.academicMetadata !== undefined) {
      const saved = savePageDocument({ pageId: pageDocument.page.id, expectedRevision: pageDocument.revision, blocks: native ? blockNoteToPageBlocks(native) : markdownToPageBlocks(content), nativeDocument: native, schemaVersion: input.schemaVersion, academicMetadata, reason: input.reason });
      if (!saved.ok) throw new Error('REVISION_CONFLICT: La nota ha cambiado en otra sesión.');
      savedDocument = saved.document;
    } else savedDocument = synchronizeNotePage(noteId, title, content);
    return { ...getNote(noteId)!, editorRevision: savedDocument.revision };
  })();
}

export function restoreWorkspaceNoteVersion(noteId: string, versionId: string): Note {
  const row = getDb()
    .prepare('SELECT * FROM note_versions WHERE id = ? AND note_id = ?')
    .get(versionId, noteId) as Row | undefined;
  if (!row) throw new Error('Versión no encontrada.');
  const version = toVersion(row);
  return updateWorkspaceNote(noteId, {
    title: version.title,
    contentMarkdown: version.contentMarkdown,
    nativeDocument: version.nativeDocument ?? undefined,
    schemaVersion: version.schemaVersion,
    academicMetadata: version.academicMetadata,
    style: version.style,
    reason: 'restore',
  });
}

// ── Comentarios anclados ─────────────────────────────────────────────────────────

export function createWorkspaceAnnotation(noteId: string, input: StudyAnnotationInput): StudyAnnotation {
  const db = getDb();
  noteRow(noteId);
  const id = crypto.randomUUID();
  const timestamp = now();
  const position = Number((db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM note_annotations WHERE note_id = ?')
    .get(noteId) as Row).value);
  db.prepare(
    `INSERT INTO note_annotations
       (id, note_id, from_pos, to_pos, selected_text, comment, color, locked, pinned, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, noteId, Math.max(0, input.from), Math.max(input.from, input.to), input.selectedText,
    input.comment.trim(), input.color ?? null, input.locked ? 1 : 0, input.pinned ? 1 : 0,
    position, timestamp, timestamp
  );
  if (input.anchor) db.prepare('UPDATE note_annotations SET anchor_json = ? WHERE id = ?').run(JSON.stringify(input.anchor), id);
  return toAnnotation(db.prepare('SELECT * FROM note_annotations WHERE id = ?').get(id) as Row);
}

export function updateWorkspaceAnnotation(
  id: string,
  patch: Partial<StudyAnnotationInput> & { resolved?: boolean }
): StudyAnnotation | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM note_annotations WHERE id = ?').get(id) as Row | undefined;
  if (!current) return null;
  db.prepare(
    'UPDATE note_annotations SET comment = ?, color = ?, locked = ?, pinned = ?, resolved_at = ?, anchor_json = ?, from_pos = ?, to_pos = ?, selected_text = ?, updated_at = ? WHERE id = ?'
  ).run(
    patch.comment ?? current.comment,
    patch.color === undefined ? current.color : patch.color,
    patch.locked === undefined ? current.locked : patch.locked ? 1 : 0,
    patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0,
    patch.resolved === undefined ? current.resolved_at : patch.resolved ? now() : null,
    patch.anchor === undefined ? current.anchor_json : patch.anchor ? JSON.stringify(patch.anchor) : null,
    patch.from ?? current.from_pos, patch.to ?? current.to_pos, patch.selectedText ?? current.selected_text,
    now(), id
  );
  return toAnnotation(db.prepare('SELECT * FROM note_annotations WHERE id = ?').get(id) as Row);
}

export function deleteWorkspaceAnnotation(id: string): void {
  getDb().prepare('DELETE FROM note_annotations WHERE id = ?').run(id);
}

// ── Enlaces con la biblioteca ────────────────────────────────────────────────────

const toLibraryLink = (row: Row): WorkspaceLibraryLink => ({
  ownerKind: String(row.owner_kind) as WorkspaceLibraryLink['ownerKind'],
  ownerId: String(row.owner_id),
  libraryItemId: String(row.library_item_id),
  scope: String(row.scope) as WorkspaceLibraryLink['scope'],
  label: row.label ? String(row.label) : null,
  createdAt: String(row.created_at),
});

export function listWorkspaceLibraryLinks(ownerKind: WorkspaceLibraryLink['ownerKind'], ownerId: string): WorkspaceLibraryLink[] {
  return (getDb()
    .prepare('SELECT * FROM workspace_library_links WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at')
    .all(ownerKind, ownerId) as Row[]).map(toLibraryLink);
}

/** Todos los enlaces de la bóveda, para pintar el contador de cada fila de una lista. */
export function listAllWorkspaceLibraryLinks(): WorkspaceLibraryLink[] {
  return (getDb()
    .prepare('SELECT * FROM workspace_library_links ORDER BY created_at')
    .all() as Row[]).map(toLibraryLink);
}

export function addWorkspaceLibraryLink(input: WorkspaceLibraryLinkInput): WorkspaceLibraryLink {
  getDb().prepare(
    `INSERT INTO workspace_library_links (owner_kind, owner_id, library_item_id, scope, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_kind, owner_id, library_item_id, scope) DO UPDATE SET label = excluded.label`
  ).run(input.ownerKind, input.ownerId, input.libraryItemId, input.scope ?? 'global', input.label ?? null, now());
  return toLibraryLink(getDb()
    .prepare('SELECT * FROM workspace_library_links WHERE owner_kind = ? AND owner_id = ? AND library_item_id = ? AND scope = ?')
    .get(input.ownerKind, input.ownerId, input.libraryItemId, input.scope ?? 'global') as Row);
}

export function removeWorkspaceLibraryLink(
  ownerKind: WorkspaceLibraryLink['ownerKind'],
  ownerId: string,
  libraryItemId: string,
  scope: WorkspaceLibraryLink['scope'] = 'global'
): void {
  getDb()
    .prepare('DELETE FROM workspace_library_links WHERE owner_kind = ? AND owner_id = ? AND library_item_id = ? AND scope = ?')
    .run(ownerKind, ownerId, libraryItemId, scope);
}

/**
 * Limpieza de enlaces cuyo dueño ya no existe. Las notas y colecciones se borran por
 * caminos muy distintos (una cascada de SQLite, la papelera de la vista, una
 * sincronización), así que la tabla no lleva clave foránea y se barre aquí.
 */
export function pruneWorkspaceLibraryLinks(): number {
  return getDb().prepare(
    `DELETE FROM workspace_library_links
      WHERE (owner_kind = 'note' AND owner_id NOT IN (SELECT id FROM notes))
         OR (owner_kind = 'collection' AND owner_id NOT IN (SELECT id FROM note_folders))`
  ).run().changes;
}
