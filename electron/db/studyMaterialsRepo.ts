import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type {
  StudyMaterialAnnotation,
  StudyMaterialAnnotationInput,
  StudyMaterialBibliography,
  StudyMaterialContent,
  StudyMaterialDetail,
  StudyMaterialFragmentLink,
  StudyMaterialImportInput,
  StudyMaterialImportResult,
  StudyMaterialListOptions,
  StudyMaterialMetadata,
  StudyMaterialPlacement,
  StudyMaterialReadState,
  StudyMaterialSourceRef,
  StudyMaterialSummary,
  StudyMaterialUpdateInput,
  StudyMaterialVersion,
} from '@shared/studyMaterials';
import type { ZoteroAttachmentInfo, ZoteroItem, ZoteroLibrary } from '@shared/types';
import { EMPTY_STUDY_BIBLIOGRAPHY, STUDY_MATERIAL_EXTENSIONS, studyMaterialPreviewKind } from '@shared/studyMaterials';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import type { StudyPlacementInput } from '@shared/studyOrg';
import { extractFromPath } from '../extraction/textExtractor';
import { deleteStudyNoteLinksFor } from './studyNoteLinksRepo';
import { getDb } from './database';
import { createStudyDocument, resolveStudyMoveDestination } from './studyOrgRepo';
import { encodeEmbedding } from './ideasRepo';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function bibliography(value: unknown): StudyMaterialBibliography {
  const parsed = parseJson<Partial<StudyMaterialBibliography>>(value, {});
  return { ...EMPTY_STUDY_BIBLIOGRAPHY, ...parsed, authors: Array.isArray(parsed.authors) ? parsed.authors.filter((item): item is string => typeof item === 'string') : [] };
}

function metadata(value: unknown): StudyMaterialMetadata {
  const parsed = parseJson<StudyMaterialMetadata>(value, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown', markdown: 'text/markdown', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', html: 'text/html', htm: 'text/html', epub: 'application/epub+zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
};

function toSummary(row: Row, placements: StudyMaterialPlacement[] = []): StudyMaterialSummary {
  const extension = String(row.extension ?? '').replace(/^\./, '').toLocaleLowerCase();
  const mimeType = String(row.mime_type ?? MIME_BY_EXTENSION[extension] ?? 'application/octet-stream');
  return {
    id: String(row.id), shortId: String(row.short_id), title: String(row.title), description: String(row.description ?? ''),
    fileName: String(row.file_name ?? ''), mimeType, extension, contentHash: String(row.content_hash),
    extractionStatus: String(row.extraction_status ?? 'pending') as StudyMaterialSummary['extractionStatus'],
    visualDescription: String(row.visual_description ?? ''),
    visualAnalysisStatus: String(row.visual_analysis_status ?? (['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'].includes(extension) ? 'pending' : 'not_applicable')) as StudyMaterialSummary['visualAnalysisStatus'],
    visualAnalysisProvider: row.visual_analysis_provider ? String(row.visual_analysis_provider) : null,
    visualAnalysisModel: row.visual_analysis_model ? String(row.visual_analysis_model) : null,
    indexStatus: String(row.index_status ?? 'pending') as StudyMaterialSummary['indexStatus'],
    indexError: row.index_error ? String(row.index_error) : null,
    embeddingProvider: row.embedding_provider ? String(row.embedding_provider) : null,
    embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
    embeddingDim: row.embedding_dim == null ? null : Number(row.embedding_dim),
    embeddingTextHash: row.embedding_text_hash ? String(row.embedding_text_hash) : null,
    indexedAt: row.indexed_at ? String(row.indexed_at) : null,
    metadata: metadata(row.metadata_json), bibliography: bibliography(row.bibliography_json),
    readState: String(row.read_state ?? 'pending') as StudyMaterialReadState,
    previewKind: studyMaterialPreviewKind(extension, mimeType),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    sizeBytes: Number(row.size_bytes ?? 0), extractedChars: Number(row.extracted_chars ?? String(row.extracted_text ?? '').length),
    favorite: bool(row.favorite), pinned: bool(row.pinned), position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null, deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), placements,
    origin: String(row.origin ?? 'file') as StudyMaterialSummary['origin'],
    zoteroLibraryType: row.zotero_library_type ? String(row.zotero_library_type) as 'user' | 'group' : null,
    zoteroLibraryId: row.zotero_library_id ? String(row.zotero_library_id) : null,
    zoteroItemKey: row.zotero_item_key ? String(row.zotero_item_key) : null,
    zoteroAttachmentKey: row.zotero_attachment_key ? String(row.zotero_attachment_key) : null,
  };
}

function toPlacement(row: Row): StudyMaterialPlacement {
  return {
    id: String(row.id), shortId: String(row.short_id), materialId: String(row.material_id),
    courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null, folderId: row.folder_id ? String(row.folder_id) : null,
    documentId: row.document_id ? String(row.document_id) : null, position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null, deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toAnnotation(row: Row): StudyMaterialAnnotation {
  return {
    id: String(row.id), shortId: String(row.short_id), materialId: String(row.material_id),
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    rect: parseJson(row.rect_json, null), rects: parseJson(row.rects_json, []), path: parseJson(row.path_json, []),
    kind: String(row.kind ?? 'highlight') as StudyMaterialAnnotation['kind'], thickness: Number(row.thickness ?? 3),
    from: row.from_pos == null ? null : Number(row.from_pos), to: row.to_pos == null ? null : Number(row.to_pos),
    selectedText: String(row.selected_text ?? ''), note: String(row.note ?? ''), color: String(row.color ?? '#facc15'),
    position: Number(row.position ?? 0), archivedAt: row.archived_at ? String(row.archived_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toVersion(row: Row): StudyMaterialVersion {
  return {
    id: String(row.id), shortId: String(row.short_id), materialId: String(row.material_id), versionNo: Number(row.version_no),
    fileName: String(row.file_name ?? ''), mimeType: String(row.mime_type ?? 'application/octet-stream'), contentHash: String(row.content_hash),
    extractedText: String(row.extracted_text ?? ''), metadata: metadata(row.metadata_json), sizeBytes: Number(row.size_bytes ?? 0), createdAt: String(row.created_at),
  };
}

function toFragmentLink(row: Row): StudyMaterialFragmentLink {
  return {
    id: String(row.id), shortId: String(row.short_id), materialId: String(row.material_id),
    annotationId: row.annotation_id ? String(row.annotation_id) : null, documentId: String(row.document_id),
    docFrom: row.doc_from_pos == null ? null : Number(row.doc_from_pos), docTo: row.doc_to_pos == null ? null : Number(row.doc_to_pos),
    label: String(row.label ?? ''), source: parseJson<StudyMaterialSourceRef>(row.source_json, { materialId: String(row.material_id), materialTitle: '' }),
    position: Number(row.position ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function materialRow(id: string): Row {
  const row = getDb().prepare('SELECT *, length(extracted_text) AS extracted_chars FROM embedding_read_study_materials AS study_materials WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Material no encontrado.');
  return row;
}

function extOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLocaleLowerCase();
}

export function supportsStudyMaterial(filePath: string): boolean {
  return (STUDY_MATERIAL_EXTENSIONS as readonly string[]).includes(extOf(filePath));
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function extractPptx(filePath: string): { text: string; slideCount: number } {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => Number(a.entryName.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.entryName.match(/slide(\d+)/i)?.[1] ?? 0));
  const parts = entries.map((entry, index) => {
    const xml = entry.getData().toString('utf8');
    const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXml(match[1]).trim()).filter(Boolean);
    return `[[slide. ${index + 1}]]\n${lines.join('\n')}`;
  });
  return { text: parts.join('\n\n'), slideCount: entries.length };
}

function extractHtml(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|section|article|h[1-6]|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

async function extractMaterial(filePath: string, ocr = false): Promise<{ text: string; status: StudyMaterialSummary['extractionStatus']; metadata: StudyMaterialMetadata; pageCount: number | null }> {
  const extension = extOf(filePath);
  if (extension === 'pptx') {
    const result = extractPptx(filePath);
    return { text: result.text, status: result.text ? 'ready' : 'partial', metadata: { slideCount: result.slideCount }, pageCount: null };
  }
  if (extension === 'html' || extension === 'htm') {
    const text = extractHtml(filePath);
    return { text, status: text ? 'ready' : 'partial', metadata: {}, pageCount: null };
  }
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(extension)) return { text: '', status: 'unsupported', metadata: { extractionNote: 'El audio se transcribe en la fase de grabaciones.' }, pageCount: null };
  try {
    const extracted = await extractFromPath(filePath, { ocr: { enabled: ocr, languages: 'spa+eng', maxPages: 300 } });
    const pageCount = extracted.analysis?.pageCount ?? null;
    return { text: extracted.text, status: extracted.text.trim() ? 'ready' : extracted.notes ? 'partial' : 'unsupported', metadata: { extractionNote: extracted.notes ?? undefined, pageCount: pageCount ?? undefined }, pageCount };
  } catch (error) {
    return { text: '', status: 'error', metadata: { extractionNote: error instanceof Error ? error.message : String(error) }, pageCount: null };
  }
}

function placementValues(input: StudyMaterialImportInput) {
  return [input.courseId ?? null, input.subjectId ?? null, input.topicId ?? null, input.folderId ?? null, input.documentId ?? null] as const;
}

export function addStudyMaterialPlacement(materialId: string, input: StudyMaterialImportInput): StudyMaterialPlacement | null {
  materialRow(materialId);
  const values = placementValues(input);
  if (values.every((value) => value == null)) return null;
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM study_material_placements WHERE material_id = ?
    AND IFNULL(course_id, '') = IFNULL(?, '') AND IFNULL(subject_id, '') = IFNULL(?, '') AND IFNULL(topic_id, '') = IFNULL(?, '')
    AND IFNULL(folder_id, '') = IFNULL(?, '') AND IFNULL(document_id, '') = IFNULL(?, '') AND deleted_at IS NULL LIMIT 1`)
    .get(materialId, ...values) as Row | undefined;
  if (existing) return toPlacement(existing);
  const key = ids('MPL'); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_material_placements WHERE material_id = ?').get(materialId) as Row).value);
  db.prepare(`INSERT INTO study_material_placements
    (id, short_id, material_id, course_id, subject_id, topic_id, folder_id, document_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, materialId, ...values, position, timestamp, timestamp);
  return toPlacement(db.prepare('SELECT * FROM study_material_placements WHERE id = ?').get(key.id) as Row);
}

export function setPrimaryStudyMaterialPlacement(materialId: string, input: StudyMaterialImportInput): StudyMaterialPlacement | null {
  materialRow(materialId);
  const db = getDb();
  return db.transaction(() => {
    db.prepare('DELETE FROM study_material_placements WHERE material_id = ?').run(materialId);
    return addStudyMaterialPlacement(materialId, input);
  })();
}

export function removeStudyMaterialPlacement(materialId: string, placementId: string): void {
  materialRow(materialId);
  getDb().prepare('DELETE FROM study_material_placements WHERE id = ? AND material_id = ?').run(placementId, materialId);
}

/** Move one organizational link, never the material or its other placements. */
export function moveStudyMaterialPlacement(materialId: string, placementId: string | null, destination: StudyPlacementInput): StudyMaterialPlacement | null {
  const db = getDb();
  return db.transaction(() => {
    const material = materialRow(materialId);
    if (material.deleted_at || material.archived_at) throw new Error('El material no está disponible.');
    const placements = db.prepare('SELECT * FROM study_material_placements WHERE material_id = ? AND deleted_at IS NULL').all(materialId) as Row[];
    const origin = placementId === null ? null : placements.find((p) => p.id === placementId && !p.archived_at);
    if (placementId !== null && !origin) throw new Error('La ubicación de origen ya no existe.');
    if (placementId === null && placements.some((p) => !p.archived_at)) throw new Error('Selecciona la ubicación de origen.');
    const { courseId, subjectId, folderId, topicId } = resolveStudyMoveDestination(destination);
    // A document attachment is provenance, not a destination chosen by this dialog.
    const documentId = origin?.document_id ? String(origin.document_id) : null;
    const input = { courseId, subjectId, folderId, topicId, documentId };
    const values = placementValues(input);
    if (origin && ['course_id', 'subject_id', 'topic_id', 'folder_id', 'document_id'].every((key, index) => (origin[key] ?? null) === values[index])) return toPlacement(origin);
    const duplicate = placements.find((p) => p.id !== placementId && !p.archived_at
      && ['course_id', 'subject_id', 'topic_id', 'folder_id', 'document_id'].every((key, index) => (p[key] ?? null) === values[index]));
    if (duplicate || values.every((value) => value === null)) {
      if (origin) db.prepare('DELETE FROM study_material_placements WHERE id = ?').run(origin.id);
      return duplicate ? toPlacement(duplicate) : null;
    }
    if (!origin) {
      // The import helper can reuse an archived link. A move from the unfiled
      // group needs a new active location, leaving archived history untouched.
      const key = ids('MPL'); const timestamp = now();
      const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_material_placements WHERE material_id = ?').get(materialId) as Row).value);
      db.prepare(`INSERT INTO study_material_placements
        (id, short_id, material_id, course_id, subject_id, topic_id, folder_id, document_id, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key.id, key.shortId, materialId, ...values, position, timestamp, timestamp);
      return toPlacement(db.prepare('SELECT * FROM study_material_placements WHERE id = ?').get(key.id) as Row);
    }
    db.prepare(`UPDATE study_material_placements SET course_id = ?, subject_id = ?, topic_id = ?, folder_id = ?, document_id = ?, updated_at = ? WHERE id = ?`)
      .run(...values, now(), origin.id);
    return toPlacement(db.prepare('SELECT * FROM study_material_placements WHERE id = ?').get(origin.id) as Row);
  })();
}

export async function importStudyMaterialFile(filePath: string, input: StudyMaterialImportInput = {}): Promise<StudyMaterialImportResult> {
  if (!supportsStudyMaterial(filePath)) throw new Error(`Formato no compatible: .${extOf(filePath) || '?'}`);
  const bytes = fs.readFileSync(filePath);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const db = getDb();
  const duplicate = db.prepare('SELECT id FROM study_materials WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1').get(contentHash) as Row | undefined;
  if (duplicate) {
    addStudyMaterialPlacement(String(duplicate.id), input);
    return { material: toSummary(materialRow(String(duplicate.id))), duplicate: true };
  }
  const extension = extOf(filePath);
  const extracted = await extractMaterial(filePath, Boolean(input.ocr));
  const key = ids('MAT'); const timestamp = now();
  const fileName = path.basename(filePath);
  const title = normalizeStudyName(path.basename(filePath, path.extname(filePath)) || fileName);
  const nextPosition = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_materials').get() as Row).value);
  const nextMetadata: StudyMaterialMetadata = { ...extracted.metadata, tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))] };
  db.prepare(`INSERT INTO study_materials
    (id, short_id, title, file_name, mime_type, extension, content_blob, content_hash, extracted_text, extraction_status,
     metadata_json, bibliography_json, read_state, page_count, size_bytes, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, title, fileName, MIME_BY_EXTENSION[extension] ?? 'application/octet-stream', extension, bytes,
      contentHash, extracted.text, extracted.status, JSON.stringify(nextMetadata), JSON.stringify(EMPTY_STUDY_BIBLIOGRAPHY),
      input.readState ?? 'pending', extracted.pageCount, bytes.length, nextPosition, timestamp, timestamp);
  if (studyMaterialPreviewKind(extension, MIME_BY_EXTENSION[extension]) === 'image') {
    db.prepare("UPDATE study_materials SET visual_analysis_status = 'pending' WHERE id = ?").run(key.id);
  }
  addStudyMaterialPlacement(key.id, input);
  return { material: toSummary(materialRow(key.id)), duplicate: false };
}

function zoteroAuthors(item: ZoteroItem): string[] {
  return item.creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean);
}

function zoteroBibliography(item: ZoteroItem): StudyMaterialBibliography {
  const authors = zoteroAuthors(item);
  return {
    ...EMPTY_STUDY_BIBLIOGRAPHY,
    authors,
    year: item.year,
    publisher: item.publisher ?? '',
    journal: item.publicationTitle ?? '',
    doi: item.doi ?? '',
    isbn: item.isbn ?? '',
    url: item.url ?? '',
    citation: [authors.join(', '), item.year ? `(${item.year})` : '', item.title].filter(Boolean).join('. '),
    zoteroKey: item.key,
  };
}

export async function importStudyMaterialFromZotero(
  filePath: string,
  library: ZoteroLibrary,
  item: ZoteroItem,
  attachment: ZoteroAttachmentInfo,
  input: StudyMaterialImportInput = {},
): Promise<StudyMaterialImportResult> {
  const result = await importStudyMaterialFile(filePath, { ...input, tags: [...new Set([...(input.tags ?? []), ...item.tags])] });
  const timestamp = now();
  getDb().prepare(`UPDATE study_materials SET title = ?, bibliography_json = ?, origin = 'zotero_import',
    zotero_library_type = ?, zotero_library_id = ?, zotero_item_key = ?, zotero_attachment_key = ?, updated_at = ? WHERE id = ?`)
    .run(item.title, JSON.stringify(zoteroBibliography(item)), library.type, library.id, item.itemKey, attachment.itemKey, timestamp, result.material.id);
  return { ...result, material: toSummary(materialRow(result.material.id)) };
}

export function linkStudyMaterialFromZotero(
  library: ZoteroLibrary,
  item: ZoteroItem,
  attachment: ZoteroAttachmentInfo | null,
  input: StudyMaterialImportInput = {},
): StudyMaterialImportResult {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM study_materials WHERE origin = 'zotero_link' AND zotero_library_type = ?
    AND zotero_library_id = ? AND zotero_item_key = ? AND IFNULL(zotero_attachment_key, '') = IFNULL(?, '') AND deleted_at IS NULL LIMIT 1`)
    .get(library.type, library.id, item.itemKey, attachment?.itemKey ?? null) as Row | undefined;
  if (existing) {
    addStudyMaterialPlacement(String(existing.id), input);
    return { material: toSummary(materialRow(String(existing.id))), duplicate: true };
  }
  const key = ids('MAT'); const timestamp = now();
  const extension = attachment?.filename ? extOf(attachment.filename) : 'zotero';
  const hash = `zotero-link:${library.type}:${library.id}:${item.itemKey}:${attachment?.itemKey ?? ''}`;
  const nextPosition = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_materials').get() as Row).value);
  const nextMetadata: StudyMaterialMetadata = { tags: [...new Set([...(input.tags ?? []), ...item.tags])], zoteroLibrary: library.name };
  db.prepare(`INSERT INTO study_materials
    (id, short_id, title, file_name, mime_type, extension, content_blob, content_hash, extracted_text, extraction_status,
     metadata_json, bibliography_json, read_state, size_bytes, position, index_status, origin, zotero_library_type,
     zotero_library_id, zotero_item_key, zotero_attachment_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, '', 'unsupported', ?, ?, ?, 0, ?, 'unavailable', 'zotero_link', ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, item.title, attachment?.filename ?? '', attachment?.contentType ?? 'application/x-zotero-link', extension,
      hash, JSON.stringify(nextMetadata), JSON.stringify(zoteroBibliography(item)), input.readState ?? 'pending', nextPosition,
      library.type, library.id, item.itemKey, attachment?.itemKey ?? null, timestamp, timestamp);
  addStudyMaterialPlacement(key.id, input);
  return { material: toSummary(materialRow(key.id)), duplicate: false };
}

export function listStudyMaterials(options: StudyMaterialListOptions = {}): StudyMaterialSummary[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (!options.includeArchived) clauses.push('m.archived_at IS NULL');
  if (!options.includeDeleted) clauses.push('m.deleted_at IS NULL');
  if (options.readState && options.readState !== 'all') { clauses.push('m.read_state = ?'); values.push(options.readState); }
  if (options.favorite) clauses.push('m.favorite = 1');
  if (options.search?.trim()) {
    const query = `%${options.search.trim()}%`;
    clauses.push('(m.title LIKE ? OR m.description LIKE ? OR m.extracted_text LIKE ? OR m.metadata_json LIKE ? OR m.bibliography_json LIKE ?)');
    values.push(query, query, query, query, query);
  }
  const scope = [['course_id', options.courseId], ['subject_id', options.subjectId], ['topic_id', options.topicId], ['document_id', options.documentId]] as const;
  for (const [column, value] of scope) if (value) { clauses.push(`EXISTS (SELECT 1 FROM study_material_placements p WHERE p.material_id = m.id AND p.${column} = ? AND p.deleted_at IS NULL)`); values.push(value); }
  const rows = getDb().prepare(`SELECT m.*, length(m.extracted_text) AS extracted_chars FROM embedding_read_study_materials m
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.pinned DESC, m.favorite DESC, m.position, m.updated_at DESC`).all(...values) as Row[];
  const materialIds = rows.map((row) => String(row.id));
  const placementsByMaterial = new Map<string, StudyMaterialPlacement[]>();
  if (materialIds.length) {
    const placeholders = materialIds.map(() => '?').join(',');
    for (const placement of (getDb().prepare(`SELECT * FROM study_material_placements WHERE material_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY material_id, position`).all(...materialIds) as Row[]).map(toPlacement)) {
      const bucket = placementsByMaterial.get(placement.materialId) ?? [];
      bucket.push(placement);
      placementsByMaterial.set(placement.materialId, bucket);
    }
  }
  return rows.map((row) => toSummary(row, placementsByMaterial.get(String(row.id)) ?? []))
    .filter((material) => !options.previewKind || options.previewKind === 'all' || material.previewKind === options.previewKind);
}

export function getStudyMaterial(id: string): StudyMaterialDetail {
  const db = getDb(); const row = materialRow(id); const summary = toSummary(row);
  return {
    ...summary, extractedText: String(row.extracted_text ?? ''),
    placements: (db.prepare('SELECT * FROM study_material_placements WHERE material_id = ? AND deleted_at IS NULL ORDER BY position').all(id) as Row[]).map(toPlacement),
    annotations: (db.prepare('SELECT * FROM study_material_annotations WHERE material_id = ? AND deleted_at IS NULL ORDER BY page_number, position').all(id) as Row[]).map(toAnnotation),
    fragmentLinks: (db.prepare('SELECT * FROM study_material_fragment_links WHERE material_id = ? ORDER BY position').all(id) as Row[]).map(toFragmentLink),
    versions: (db.prepare('SELECT * FROM study_material_versions WHERE material_id = ? ORDER BY version_no DESC').all(id) as Row[]).map(toVersion),
  };
}

export function getStudyMaterialContent(id: string): StudyMaterialContent {
  const row = getDb().prepare('SELECT content_blob, mime_type, file_name FROM study_materials WHERE id = ?').get(id) as Row | undefined;
  if (!row || !row.content_blob) throw new Error('El material no contiene un fichero guardado.');
  return { bytes: new Uint8Array(row.content_blob as Buffer), mimeType: String(row.mime_type), fileName: String(row.file_name) };
}

export function updateStudyMaterial(id: string, patch: StudyMaterialUpdateInput): StudyMaterialSummary {
  const row = materialRow(id); const currentMetadata = metadata(row.metadata_json); const currentBibliography = bibliography(row.bibliography_json);
  const title = patch.title === undefined ? row.title : normalizeStudyName(patch.title);
  const readState = patch.readState ?? row.read_state;
  if (!['pending', 'reading', 'read', 'reviewed'].includes(String(readState))) throw new Error('Estado de lectura no válido.');
  getDb().prepare(`UPDATE study_materials SET title = ?, description = ?, read_state = ?, favorite = ?, pinned = ?, position = ?,
    metadata_json = ?, bibliography_json = ?, updated_at = ? WHERE id = ?`)
    .run(title, patch.description ?? row.description, readState, patch.favorite ?? bool(row.favorite) ? 1 : 0,
      patch.pinned ?? bool(row.pinned) ? 1 : 0, patch.position ?? Number(row.position), JSON.stringify({ ...currentMetadata, ...(patch.metadata ?? {}) }),
      JSON.stringify({ ...currentBibliography, ...(patch.bibliography ?? {}) }), now(), id);
  if (patch.title !== undefined || patch.description !== undefined || patch.metadata !== undefined || patch.bibliography !== undefined) {
    getDb().prepare(`UPDATE study_materials SET embedding = NULL, embedding_provider = NULL, embedding_model = NULL,
      embedding_dim = NULL, embedding_text_hash = NULL, index_status = 'pending', index_error = NULL, indexed_at = NULL WHERE id = ?`).run(id);
  }
  return toSummary(materialRow(id));
}

export function markStudyMaterialIndexing(id: string): void {
  materialRow(id);
  getDb().prepare("UPDATE study_materials SET index_status = 'indexing', index_error = NULL, updated_at = ? WHERE id = ?").run(now(), id);
}

export function restoreStudyMaterialIndexedStatus(id: string): void {
  materialRow(id);
  getDb().prepare("UPDATE study_materials SET index_status = 'indexed', index_error = NULL, updated_at = ? WHERE id = ?").run(now(), id);
}

export function updateStudyMaterialVisualAnalysis(id: string, input: { description: string; status: StudyMaterialSummary['visualAnalysisStatus']; provider?: string | null; model?: string | null; extractedText?: string }): void {
  const row = materialRow(id);
  const extractedText = input.extractedText?.trim() ? input.extractedText.trim() : String(row.extracted_text ?? '');
  getDb().prepare(`UPDATE study_materials SET visual_description = ?, visual_analysis_status = ?, visual_analysis_provider = ?,
    visual_analysis_model = ?, extracted_text = ?, embedding = NULL, embedding_provider = NULL, embedding_model = NULL,
    embedding_dim = NULL, embedding_text_hash = NULL, index_status = 'pending', index_error = NULL, indexed_at = NULL,
    updated_at = ? WHERE id = ?`).run(input.description.trim(), input.status, input.provider ?? null, input.model ?? null, extractedText, now(), id);
}

export function setStudyMaterialEmbedding(id: string, embedding: number[], meta: { provider: string; model: string; textHash: string }): void {
  materialRow(id);
  const timestamp = now();
  getDb().prepare(`UPDATE study_materials SET embedding = ?, embedding_provider = ?, embedding_model = ?, embedding_dim = ?,
    embedding_text_hash = ?, index_status = 'indexed', index_error = NULL, indexed_at = ?, updated_at = ? WHERE id = ?`)
    .run(encodeEmbedding(embedding), meta.provider, meta.model, embedding.length, meta.textHash, timestamp, timestamp, id);
}

export function setStudyMaterialIndexFailure(id: string, status: 'unavailable' | 'error', error: string): void {
  materialRow(id);
  getDb().prepare(`UPDATE study_materials SET embedding = NULL, embedding_provider = NULL, embedding_model = NULL,
    embedding_dim = NULL, embedding_text_hash = NULL, index_status = ?, index_error = ?, indexed_at = NULL, updated_at = ? WHERE id = ?`)
    .run(status, error, now(), id);
}

function snapshotMaterial(row: Row): StudyMaterialVersion {
  const db = getDb(); const key = ids('MVN'); const versionNo = Number((db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM study_material_versions WHERE material_id = ?').get(row.id) as Row).value);
  const createdAt = now();
  db.prepare(`INSERT INTO study_material_versions
    (id, short_id, material_id, version_no, file_name, mime_type, content_blob, content_hash, extracted_text, metadata_json, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, row.id, versionNo, row.file_name, row.mime_type, row.content_blob, row.content_hash, row.extracted_text,
      row.metadata_json, row.size_bytes, createdAt);
  return toVersion(db.prepare('SELECT * FROM study_material_versions WHERE id = ?').get(key.id) as Row);
}

export async function replaceStudyMaterialFile(id: string, filePath: string, ocr = false): Promise<StudyMaterialSummary> {
  if (!supportsStudyMaterial(filePath)) throw new Error(`Formato no compatible: .${extOf(filePath) || '?'}`);
  const db = getDb(); const current = materialRow(id); const bytes = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const collision = db.prepare('SELECT id FROM study_materials WHERE content_hash = ? AND id <> ? AND deleted_at IS NULL').get(hash, id) as Row | undefined;
  if (collision) throw new Error('Este fichero ya existe como otro material.');
  const extension = extOf(filePath); const extracted = await extractMaterial(filePath, ocr);
  return db.transaction(() => {
    snapshotMaterial(current);
    db.prepare(`UPDATE study_materials SET file_name = ?, mime_type = ?, extension = ?, content_blob = ?, content_hash = ?, extracted_text = ?,
      extraction_status = ?, metadata_json = ?, page_count = ?, size_bytes = ?, visual_description = '',
      visual_analysis_status = ?, visual_analysis_provider = NULL, visual_analysis_model = NULL, embedding = NULL,
      embedding_provider = NULL, embedding_model = NULL, embedding_dim = NULL, embedding_text_hash = NULL,
      index_status = 'pending', index_error = NULL, indexed_at = NULL, updated_at = ? WHERE id = ?`)
      .run(path.basename(filePath), MIME_BY_EXTENSION[extension] ?? 'application/octet-stream', extension, bytes, hash, extracted.text,
        extracted.status, JSON.stringify({ ...metadata(current.metadata_json), ...extracted.metadata }), extracted.pageCount, bytes.length,
        studyMaterialPreviewKind(extension, MIME_BY_EXTENSION[extension]) === 'image' ? 'pending' : 'not_applicable', now(), id);
    return toSummary(materialRow(id));
  })();
}

export function restoreStudyMaterialVersion(id: string, versionId: string): StudyMaterialSummary {
  const db = getDb(); const current = materialRow(id);
  const version = db.prepare('SELECT * FROM study_material_versions WHERE id = ? AND material_id = ?').get(versionId, id) as Row | undefined;
  if (!version) throw new Error('Versión de material no encontrada.');
  return db.transaction(() => {
    snapshotMaterial(current);
    const extension = path.extname(String(version.file_name ?? '')).slice(1).toLocaleLowerCase();
    db.prepare(`UPDATE study_materials SET file_name = ?, mime_type = ?, extension = ?, content_blob = ?, content_hash = ?, extracted_text = ?,
      metadata_json = ?, size_bytes = ?, extraction_status = 'ready', visual_description = '', visual_analysis_status = ?,
      visual_analysis_provider = NULL, visual_analysis_model = NULL, embedding = NULL, embedding_provider = NULL,
      embedding_model = NULL, embedding_dim = NULL, embedding_text_hash = NULL, index_status = 'pending',
      index_error = NULL, indexed_at = NULL, updated_at = ? WHERE id = ?`)
      .run(version.file_name, version.mime_type, extension, version.content_blob, version.content_hash, version.extracted_text,
        version.metadata_json, version.size_bytes,
        studyMaterialPreviewKind(extension, String(version.mime_type ?? '')) === 'image' ? 'pending' : 'not_applicable', now(), id);
    return toSummary(materialRow(id));
  })();
}

export function createStudyMaterialAnnotation(materialId: string, input: StudyMaterialAnnotationInput): StudyMaterialAnnotation {
  materialRow(materialId); const db = getDb(); const key = ids('MAN'); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_material_annotations WHERE material_id = ?').get(materialId) as Row).value);
  db.prepare(`INSERT INTO study_material_annotations
    (id, short_id, material_id, page_number, rect_json, rects_json, path_json, kind, thickness, from_pos, to_pos, selected_text, note, color, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, materialId, input.pageNumber ?? null, input.rect ? JSON.stringify(input.rect) : null,
      JSON.stringify(input.rects ?? (input.rect ? [input.rect] : [])), JSON.stringify(input.path ?? []), input.kind ?? 'highlight',
      Math.max(1, Math.min(24, input.thickness ?? 3)), input.from ?? null, input.to ?? null, input.selectedText?.trim() ?? '',
      input.note?.trim() ?? '', input.color ?? '#fde68a', position, timestamp, timestamp);
  return toAnnotation(db.prepare('SELECT * FROM study_material_annotations WHERE id = ?').get(key.id) as Row);
}

export function updateStudyMaterialAnnotation(id: string, patch: Partial<StudyMaterialAnnotationInput>): StudyMaterialAnnotation {
  const db = getDb(); const row = db.prepare('SELECT * FROM study_material_annotations WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Anotación no encontrada.');
  db.prepare(`UPDATE study_material_annotations SET note = ?, color = ?, selected_text = ?, page_number = ?, rect_json = ?, rects_json = ?, path_json = ?, kind = ?, thickness = ?, updated_at = ? WHERE id = ?`)
    .run(patch.note ?? row.note, patch.color ?? row.color, patch.selectedText ?? row.selected_text, patch.pageNumber ?? row.page_number,
      patch.rect === undefined ? row.rect_json : patch.rect ? JSON.stringify(patch.rect) : null,
      patch.rects === undefined ? row.rects_json : JSON.stringify(patch.rects), patch.path === undefined ? row.path_json : JSON.stringify(patch.path),
      patch.kind ?? row.kind ?? 'highlight', patch.thickness ?? row.thickness ?? 3, now(), id);
  return toAnnotation(db.prepare('SELECT * FROM study_material_annotations WHERE id = ?').get(id) as Row);
}

export function deleteStudyMaterialAnnotation(id: string): void {
  getDb().prepare('UPDATE study_material_annotations SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

export function createStudyNoteFromMaterial(materialId: string, annotationId?: string | null, title?: string): { documentId: string; link: StudyMaterialFragmentLink } {
  const material = getStudyMaterial(materialId);
  const annotation = annotationId ? material.annotations.find((item) => item.id === annotationId) : null;
  const source: StudyMaterialSourceRef = {
    materialId, materialTitle: material.title, pageNumber: annotation?.pageNumber ?? null,
    fragment: annotation?.selectedText || undefined, annotationId: annotation?.id ?? null,
  };
  const location = annotation?.pageNumber ? `p. ${annotation.pageNumber}` : material.fileName;
  const quote = annotation?.selectedText ? `\n\n> ${annotation.selectedText.replace(/\n/g, '\n> ')}` : '';
  const note = createStudyDocument({
    title: title?.trim() || `Nota — ${material.title}`,
    kind: 'apunte',
    contentMarkdown: `# ${title?.trim() || material.title}\n\nFuente: [${material.title} · ${location}](nodus://study/material/${material.id})${quote}\n\n`,
    placement: material.placements[0] ? {
      courseId: material.placements[0].courseId ?? undefined, subjectId: material.placements[0].subjectId ?? undefined,
      topicId: material.placements[0].topicId ?? undefined, folderId: material.placements[0].folderId ?? undefined,
    } : undefined,
  });
  const db = getDb(); const key = ids('MFL'); const timestamp = now();
  const position = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_material_fragment_links WHERE material_id = ?').get(materialId) as Row).value);
  db.prepare(`INSERT INTO study_material_fragment_links
    (id, short_id, material_id, annotation_id, document_id, label, source_json, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, materialId, annotation?.id ?? null, note.id, annotation?.selectedText || material.title, JSON.stringify(source), position, timestamp, timestamp);
  return { documentId: note.id, link: toFragmentLink(db.prepare('SELECT * FROM study_material_fragment_links WHERE id = ?').get(key.id) as Row) };
}

export function setStudyMaterialLifecycle(id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete'): void {
  materialRow(id); const timestamp = now();
  if (action === 'delete') {
    getDb().transaction(() => { deleteStudyNoteLinksFor('material_id', id); getDb().prepare('DELETE FROM study_materials WHERE id = ?').run(id); })();
    return;
  }
  const updates = action === 'archive' ? ['archived_at', timestamp] : action === 'restore' ? ['archived_at', null]
    : action === 'trash' ? ['deleted_at', timestamp] : ['deleted_at', null];
  getDb().prepare(`UPDATE study_materials SET ${updates[0]} = ?, updated_at = ? WHERE id = ?`).run(updates[1], timestamp, id);
}
