import crypto from 'node:crypto';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  AddProjectLinkInput,
  ChapterSourceFormat,
  ChapterSuggestionStatus,
  CitationRef,
  CreateProjectInput,
  ModelRef,
  Project,
  ProjectChapter,
  ProjectChapterChunk,
  ProjectChapterVersion,
  ProjectDetail,
  ProjectInsertionSuggestion,
  ProjectKind,
  ProjectLink,
  ProjectLinkKind,
  ProjectLinkRole,
  ProjectSection,
  ProjectSectionRole,
  ProjectSectionStatus,
  ProjectStatus,
  UpdateProjectInput,
  UpdateProjectSectionInput,
} from '@shared/types';
import { getDb } from './database';
import { createNote, createNoteFolder, getNote, getNoteFolder, updateNote } from './notesRepo';
import { getIdeaSummary } from './ideasRepo';
import { getWork } from './worksRepo';
import { getGapDetail } from './gapsRepo';

const PROJECT_NOTE_MARKER = 'project';
const PROJECT_CHAPTER_MARKER = 'project-chapter';

const DEFAULT_SECTIONS: { title: string; role: ProjectSectionRole; summary: string }[] = [
  {
    title: '00 - Brief del proyecto',
    role: 'brief',
    summary: 'Objetivo, alcance, pregunta principal y decisiones de enfoque del proyecto.',
  },
  {
    title: '01 - Pregunta y cobertura',
    role: 'coverage',
    summary: 'Mapa de cobertura, subpreguntas, zonas cubiertas y huecos pendientes.',
  },
  {
    title: '02 - Estado de la cuestión',
    role: 'literature',
    summary: 'Ideas, autores y evidencias para construir el estado de la cuestión.',
  },
  {
    title: '03 - Debates',
    role: 'debates',
    summary: 'Contradicciones, tensiones y posiciones enfrentadas dentro del corpus.',
  },
  {
    title: '04 - Huecos',
    role: 'gaps',
    summary: 'Limitaciones, preguntas abiertas y oportunidades de contribución.',
  },
  {
    title: '05 - Borradores',
    role: 'drafts',
    summary: 'Borradores generados o guardados para este proyecto.',
  },
  {
    title: '06 - Manuscrito',
    role: 'manuscript',
    summary: 'Capítulos importados, versiones editables y propuestas de inserción.',
  },
];

interface ProjectRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  brief: string;
  research_question_id: string | null;
  root_folder_id: string | null;
  model_json: string | null;
  target_words: number | null;
  created_at: string;
  updated_at: string;
}

interface SectionRow {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  role: string;
  status: string;
  target_words: number | null;
  order_idx: number;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  id: string;
  project_id: string;
  section_id: string | null;
  kind: string;
  ref_id: string;
  label: string;
  role: string;
  created_at: string;
}

interface ChapterRow {
  id: string;
  project_id: string;
  section_id: string | null;
  note_id: string | null;
  title: string;
  source_format: string;
  original_file_name: string | null;
  original_text_hash: string;
  original_text: string;
  current_markdown: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

interface ChunkRow {
  id: string;
  chapter_id: string;
  order_idx: number;
  heading_path: string;
  text: string;
  start_offset: number;
  end_offset: number;
  word_count: number;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_text_hash: string | null;
}

interface SuggestionRow {
  id: string;
  project_id: string;
  chapter_id: string;
  target_chunk_id: string | null;
  kind: string;
  ref_id: string;
  ref_label: string;
  operation: string;
  proposed_text: string;
  citation_json: string;
  rationale: string;
  confidence: number;
  status: string;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  chapter_id: string;
  label: string;
  markdown: string;
  created_at: string;
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ModelRef;
  } catch {
    return null;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    kind: normalizeProjectKind(row.kind),
    status: normalizeProjectStatus(row.status),
    brief: row.brief,
    researchQuestionId: row.research_question_id,
    rootFolderId: row.root_folder_id,
    model: parseModel(row.model_json),
    targetWords: row.target_words,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSection(row: SectionRow): ProjectSection {
  return {
    id: row.id,
    projectId: row.project_id,
    folderId: row.folder_id,
    title: row.title,
    role: normalizeSectionRole(row.role),
    status: normalizeSectionStatus(row.status),
    targetWords: row.target_words,
    orderIdx: row.order_idx,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLink(row: LinkRow): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    sectionId: row.section_id,
    kind: normalizeLinkKind(row.kind),
    refId: row.ref_id,
    label: row.label,
    role: normalizeLinkRole(row.role),
    createdAt: row.created_at,
  };
}

function toChapter(row: ChapterRow): ProjectChapter {
  const canonical=row.note_id?getNote(row.note_id):null;
  return {
    id: row.id,
    projectId: row.project_id,
    sectionId: row.section_id,
    noteId: row.note_id,
    title: row.title,
    sourceFormat: normalizeSourceFormat(row.source_format),
    originalFileName: row.original_file_name,
    originalTextHash: row.original_text_hash,
    originalText: row.original_text,
    currentMarkdown: canonical?.content ?? row.current_markdown,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChunk(row: ChunkRow): ProjectChapterChunk {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    orderIdx: row.order_idx,
    headingPath: row.heading_path,
    text: row.text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    wordCount: row.word_count,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    embeddingTextHash: row.embedding_text_hash,
  };
}

function toSuggestion(row: SuggestionRow): ProjectInsertionSuggestion {
  let refs: CitationRef[] = [];
  try {
    const parsed = JSON.parse(row.citation_json);
    if (Array.isArray(parsed)) refs = parsed.filter(isCitationRef);
  } catch {
    refs = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    targetChunkId: row.target_chunk_id,
    kind: normalizeSuggestionKind(row.kind),
    refId: row.ref_id,
    refLabel: row.ref_label,
    operation: normalizeSuggestionOperation(row.operation),
    proposedText: row.proposed_text,
    citationRefs: refs,
    rationale: row.rationale,
    confidence: clamp(row.confidence, 0, 1),
    status: normalizeSuggestionStatus(row.status),
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersion(row: VersionRow): ProjectChapterVersion {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    label: row.label,
    markdown: row.markdown,
    createdAt: row.created_at,
  };
}

function normalizeProjectKind(value: string): ProjectKind {
  return ['thesis', 'article', 'chapter', 'literature_review', 'theoretical_framework', 'other'].includes(value)
    ? (value as ProjectKind)
    : 'other';
}

function normalizeProjectStatus(value: string): ProjectStatus {
  return ['active', 'paused', 'done'].includes(value) ? (value as ProjectStatus) : 'active';
}

function normalizeSectionRole(value: string): ProjectSectionRole {
  return ['brief', 'coverage', 'literature', 'debates', 'gaps', 'drafts', 'manuscript', 'custom'].includes(value)
    ? (value as ProjectSectionRole)
    : 'custom';
}

function normalizeSectionStatus(value: string): ProjectSectionStatus {
  return ['empty', 'in_progress', 'review', 'ready', 'discarded'].includes(value)
    ? (value as ProjectSectionStatus)
    : 'empty';
}

function normalizeLinkKind(value: string): ProjectLinkKind {
  const valid: ProjectLinkKind[] = ['note', 'folder', 'idea', 'work', 'gap', 'debate', 'tutor_route', 'writing_draft', 'research_question', 'chapter'];
  return valid.includes(value as ProjectLinkKind) ? (value as ProjectLinkKind) : 'note';
}

function normalizeLinkRole(value: string): ProjectLinkRole {
  const valid: ProjectLinkRole[] = ['evidence', 'argument', 'counterargument', 'pending', 'discarded', 'key_citation', 'source', 'draft', 'context'];
  return valid.includes(value as ProjectLinkRole) ? (value as ProjectLinkRole) : 'context';
}

function normalizeSourceFormat(value: string): ChapterSourceFormat {
  return ['docx', 'pdf', 'epub', 'markdown', 'txt', 'unknown'].includes(value) ? (value as ChapterSourceFormat) : 'unknown';
}

function normalizeSuggestionKind(value: string): ProjectInsertionSuggestion['kind'] {
  return ['idea', 'gap', 'debate', 'work', 'note'].includes(value) ? (value as ProjectInsertionSuggestion['kind']) : 'idea';
}

function normalizeSuggestionOperation(value: string): ProjectInsertionSuggestion['operation'] {
  return ['insert_after', 'insert_before', 'replace', 'comment'].includes(value)
    ? (value as ProjectInsertionSuggestion['operation'])
    : 'insert_after';
}

function normalizeSuggestionStatus(value: string): ChapterSuggestionStatus {
  return ['suggested', 'accepted', 'rejected', 'applied', 'blocked'].includes(value)
    ? (value as ChapterSuggestionStatus)
    : 'suggested';
}

function isCitationRef(value: unknown): value is CitationRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as CitationRef;
  return ['idea', 'work', 'gap', 'contradiction', 'passage'].includes(ref.kind) && typeof ref.id === 'string';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function textHash(text: string): string {
  return crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export function sourceFormatFromPath(filePath: string): ChapterSourceFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'txt';
  return 'unknown';
}

function now(): string {
  return new Date().toISOString();
}

function projectRow(id: string): ProjectRow | null {
  return (getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined) ?? null;
}

export function listProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC').all() as ProjectRow[]).map(toProject);
}

export function getProject(id: string): Project | null {
  const row = projectRow(id);
  return row ? toProject(row) : null;
}

export function getProjectDetail(id: string): ProjectDetail | null {
  const project = getProject(id);
  if (!project) return null;
  const sections = listSections(id);
  const links = listLinks(id);
  const chapters = listChapters(id);
  const suggestionCount = getDb()
    .prepare('SELECT COUNT(*) AS n FROM project_insertion_suggestions WHERE project_id = ?')
    .get(id) as { n: number };
  const appliedCount = getDb()
    .prepare("SELECT COUNT(*) AS n FROM project_insertion_suggestions WHERE project_id = ? AND status = 'applied'")
    .get(id) as { n: number };
  return {
    project,
    sections,
    links,
    chapters,
    stats: {
      sections: sections.length,
      links: links.length,
      chapters: chapters.length,
      suggestions: suggestionCount.n,
      appliedSuggestions: appliedCount.n,
    },
  };
}

export function createProject(input: CreateProjectInput): ProjectDetail {
  const title = input.title.trim() || 'Proyecto sin título';
  const created = now();
  const root = createNoteFolder({ name: `Proyecto - ${title}` });
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO projects (
       id, title, kind, status, brief, research_question_id, root_folder_id, model_json, target_words, created_at, updated_at
     ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    normalizeProjectKind(input.kind ?? 'other'),
    input.brief?.trim() ?? '',
    input.researchQuestionId ?? null,
    root.id,
    input.model ? JSON.stringify(input.model) : null,
    input.targetWords ?? null,
    created,
    created
  );

  DEFAULT_SECTIONS.forEach((section, index) => {
    const folder = createNoteFolder({ name: section.title, parentId: root.id });
    getDb().prepare('UPDATE note_folders SET summary = ? WHERE id = ?').run(section.summary, folder.id);
    db.prepare(
      `INSERT INTO project_sections (
         id, project_id, folder_id, title, role, status, target_words, order_idx, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'empty', NULL, ?, ?, ?)`
    ).run(uuid(), id, folder.id, section.title, section.role, index, created, created);
  });

  const briefSection = listSections(id).find((s) => s.role === 'brief');
  if (briefSection?.folderId) {
    createNote({
      title: `Brief - ${title}`,
      content: buildBriefNote(title, input.brief ?? ''),
      kind: 'markdown',
      folderId: briefSection.folderId,
      source: { origin: 'markdown', ref: id, note: `${PROJECT_NOTE_MARKER}:brief` },
    });
  }
  return getProjectDetail(id)!;
}

function buildBriefNote(title: string, brief: string): string {
  return [`# ${title}`, '', '## Objetivo', brief.trim() || 'Define aquí el objetivo, alcance y criterio del proyecto.', ''].join('\n');
}

export function updateProject(input: UpdateProjectInput): Project | null {
  const current = getProject(input.id);
  if (!current) return null;
  const updated = now();
  getDb()
    .prepare(
      `UPDATE projects
          SET title = ?, kind = ?, status = ?, brief = ?, research_question_id = ?, model_json = ?, target_words = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      input.title?.trim() || current.title,
      input.kind ? normalizeProjectKind(input.kind) : current.kind,
      input.status ? normalizeProjectStatus(input.status) : current.status,
      input.brief !== undefined ? input.brief : current.brief,
      input.researchQuestionId !== undefined ? input.researchQuestionId : current.researchQuestionId,
      input.model !== undefined ? (input.model ? JSON.stringify(input.model) : null) : current.model ? JSON.stringify(current.model) : null,
      input.targetWords !== undefined ? input.targetWords : current.targetWords,
      updated,
      input.id
    );
  return getProject(input.id);
}

export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function listSections(projectId: string): ProjectSection[] {
  return (getDb()
    .prepare('SELECT * FROM project_sections WHERE project_id = ? ORDER BY order_idx ASC, created_at ASC')
    .all(projectId) as SectionRow[]).map(toSection);
}

export function getSection(id: string): ProjectSection | null {
  const row = getDb().prepare('SELECT * FROM project_sections WHERE id = ?').get(id) as SectionRow | undefined;
  return row ? toSection(row) : null;
}

export function updateSection(input: UpdateProjectSectionInput): ProjectSection | null {
  const current = getSection(input.id);
  if (!current) return null;
  getDb()
    .prepare('UPDATE project_sections SET title = ?, role = ?, status = ?, target_words = ?, updated_at = ? WHERE id = ?')
    .run(
      input.title?.trim() || current.title,
      input.role ? normalizeSectionRole(input.role) : current.role,
      input.status ? normalizeSectionStatus(input.status) : current.status,
      input.targetWords !== undefined ? input.targetWords : current.targetWords,
      now(),
      input.id
    );
  touchProject(current.projectId);
  return getSection(input.id);
}

export function listLinks(projectId: string): ProjectLink[] {
  return (getDb()
    .prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as LinkRow[]).map(toLink);
}

export function addLink(input: AddProjectLinkInput): ProjectLink {
  if (!getProject(input.projectId)) throw new Error('El proyecto no existe');
  if (input.sectionId && !getSection(input.sectionId)) throw new Error('La sección no existe');
  const id = uuid();
  const created = now();
  const label = input.label?.trim() || resolveLinkLabel(input.kind, input.refId);
  getDb()
    .prepare(
      `INSERT INTO project_links (id, project_id, section_id, kind, ref_id, label, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.sectionId ?? null,
      normalizeLinkKind(input.kind),
      input.refId,
      label,
      normalizeLinkRole(input.role ?? 'context'),
      created
    );
  touchProject(input.projectId);
  return toLink(getDb().prepare('SELECT * FROM project_links WHERE id = ?').get(id) as LinkRow);
}

export function deleteLink(id: string): void {
  const row = getDb().prepare('SELECT project_id FROM project_links WHERE id = ?').get(id) as { project_id: string } | undefined;
  getDb().prepare('DELETE FROM project_links WHERE id = ?').run(id);
  if (row) touchProject(row.project_id);
}

function resolveLinkLabel(kind: ProjectLinkKind, refId: string): string {
  try {
    if (kind === 'idea') return getIdeaSummary(refId)?.label ?? refId;
    if (kind === 'work') return getWork(refId)?.title ?? refId;
    if (kind === 'gap') return getGapDetail(refId)?.gap.statement ?? refId;
    if (kind === 'note') return getNote(refId)?.title ?? refId;
    if (kind === 'folder') return getNoteFolder(refId)?.name ?? refId;
    if (kind === 'chapter') return getChapter(refId)?.title ?? refId;
  } catch {
    return refId;
  }
  return refId;
}

export function listChapters(projectId: string): ProjectChapter[] {
  return (getDb()
    .prepare('SELECT * FROM project_chapters WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC')
    .all(projectId) as ChapterRow[]).map(toChapter);
}

export function getChapter(id: string): ProjectChapter | null {
  const row = getDb().prepare('SELECT * FROM project_chapters WHERE id = ?').get(id) as ChapterRow | undefined;
  return row ? toChapter(row) : null;
}

export function createChapter(input: {
  projectId: string;
  sectionId?: string | null;
  title: string;
  sourceFormat: ChapterSourceFormat;
  originalFileName?: string | null;
  text: string;
}): ProjectChapter {
  const project = getProject(input.projectId);
  if (!project) throw new Error('El proyecto no existe');
  const section = input.sectionId ? getSection(input.sectionId) : listSections(input.projectId).find((s) => s.role === 'manuscript') ?? null;
  const title = input.title.trim() || input.originalFileName || 'Capítulo sin título';
  const markdown = normalizeImportedMarkdown(title, input.text);
  const created = now();
  const note = createNote({
    title,
    content: markdown,
    kind: 'markdown',
    folderId: section?.folderId ?? project.rootFolderId,
    source: { origin: 'markdown', ref: input.projectId, note: PROJECT_CHAPTER_MARKER },
  });
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO project_chapters (
         id, project_id, section_id, note_id, title, source_format, original_file_name,
         original_text_hash, original_text, current_markdown, word_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      section?.id ?? null,
      note.id,
      title,
      input.sourceFormat,
      input.originalFileName ?? null,
      textHash(input.text),
      input.text,
      markdown,
      words(markdown),
      created,
      created
    );
  rebuildChunks(id, markdown);
  addLink({ projectId: input.projectId, sectionId: section?.id ?? null, kind: 'chapter', refId: id, label: title, role: 'draft' });
  touchProject(input.projectId);
  return getChapter(id)!;
}

function normalizeImportedMarkdown(title: string, text: string): string {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return `# ${title}\n\n`;
  if (/^\s*#\s+/m.test(clean)) return clean;
  return `# ${title}\n\n${clean}`;
}

export function updateChapterMarkdown(chapterId: string, markdown: string, options: { versionLabel?: string } = {}): ProjectChapter | null {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;
  if (options.versionLabel) createChapterVersion(chapterId, options.versionLabel, chapter.currentMarkdown);
  const updated = now();
  getDb()
    .prepare('UPDATE project_chapters SET current_markdown = ?, word_count = ?, updated_at = ? WHERE id = ?')
    .run(markdown, words(markdown), updated, chapterId);
  if (chapter.noteId) {
    updateNote({ id: chapter.noteId, content: markdown, title: chapter.title });
  }
  rebuildChunks(chapterId, markdown);
  touchProject(chapter.projectId);
  return getChapter(chapterId);
}

export function rebuildChunks(chapterId: string, markdown: string): ProjectChapterChunk[] {
  const db = getDb();
  const created = now();
  const chunks = chunkMarkdown(chapterId, markdown);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_chapter_chunks WHERE chapter_id = ?').run(chapterId);
    const stmt = db.prepare(
      `INSERT INTO project_chapter_chunks (
         id, chapter_id, order_idx, heading_path, text, start_offset, end_offset, word_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const chunk of chunks) {
      stmt.run(chunk.id, chapterId, chunk.orderIdx, chunk.headingPath, chunk.text, chunk.startOffset, chunk.endOffset, chunk.wordCount, created);
    }
  });
  tx();
  return chunks;
}

function chunkMarkdown(chapterId: string, markdown: string): ProjectChapterChunk[] {
  const chunks: ProjectChapterChunk[] = [];
  const blocks = markdown.match(/[^\n](?:.*(?:\n(?!\s*\n).*)*)/g) ?? [];
  let heading = '';
  let cursor = 0;
  for (const block of blocks) {
    const start = markdown.indexOf(block, cursor);
    const end = start + block.length;
    cursor = end;
    const h = block.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    const text = block.trim();
    if (!text || text.length < 20) continue;
    const orderIdx = chunks.length;
    chunks.push({
      id: `${chapterId}:c${orderIdx}`,
      chapterId,
      orderIdx,
      headingPath: heading,
      text,
      startOffset: Math.max(0, start),
      endOffset: Math.max(0, end),
      wordCount: words(text),
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDim: null,
      embeddingTextHash: null,
    });
  }
  if (chunks.length === 0 && markdown.trim()) {
    chunks.push({
      id: `${chapterId}:c0`,
      chapterId,
      orderIdx: 0,
      headingPath: '',
      text: markdown.trim(),
      startOffset: 0,
      endOffset: markdown.length,
      wordCount: words(markdown),
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDim: null,
      embeddingTextHash: null,
    });
  }
  return chunks;
}

export function listChapterChunks(chapterId: string): ProjectChapterChunk[] {
  return (getDb()
    .prepare('SELECT * FROM embedding_read_project_chapter_chunks AS project_chapter_chunks WHERE chapter_id = ? ORDER BY order_idx ASC')
    .all(chapterId) as ChunkRow[]).map(toChunk);
}

export function updateChunkEmbedding(
  chunkId: string,
  embedding: Buffer,
  meta: { provider: string; model: string; dim: number; textHash: string }
): void {
  getDb()
    .prepare(
      `UPDATE project_chapter_chunks
          SET embedding = ?, embedding_provider = ?, embedding_model = ?, embedding_dim = ?, embedding_text_hash = ?
        WHERE id = ?`
    )
    .run(embedding, meta.provider, meta.model, meta.dim, meta.textHash, chunkId);
}

export function listSuggestions(chapterId: string): ProjectInsertionSuggestion[] {
  return (getDb()
    .prepare('SELECT * FROM project_insertion_suggestions WHERE chapter_id = ? ORDER BY created_at DESC')
    .all(chapterId) as SuggestionRow[]).map(toSuggestion);
}

/**
 * Remove un-acted suggestions (still 'suggested' or 'blocked') for a chapter so a
 * re-generation starts from a clean slate, while preserving the user's decisions
 * (accepted / rejected / applied).
 */
export function clearPendingSuggestions(chapterId: string): void {
  getDb()
    .prepare("DELETE FROM project_insertion_suggestions WHERE chapter_id = ? AND status IN ('suggested', 'blocked')")
    .run(chapterId);
}

export function saveSuggestions(suggestions: Omit<ProjectInsertionSuggestion, 'id' | 'createdAt' | 'updatedAt'>[]): ProjectInsertionSuggestion[] {
  const db = getDb();
  const created = now();
  const ids: string[] = [];
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      `INSERT INTO project_insertion_suggestions (
         id, project_id, chapter_id, target_chunk_id, kind, ref_id, ref_label, operation, proposed_text,
         citation_json, rationale, confidence, status, blocked_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const suggestion of suggestions) {
      const id = uuid();
      ids.push(id);
      stmt.run(
        id,
        suggestion.projectId,
        suggestion.chapterId,
        suggestion.targetChunkId,
        suggestion.kind,
        suggestion.refId,
        suggestion.refLabel,
        suggestion.operation,
        suggestion.proposedText,
        JSON.stringify(suggestion.citationRefs),
        suggestion.rationale,
        clamp(suggestion.confidence, 0, 1),
        suggestion.status,
        suggestion.blockedReason,
        created,
        created
      );
    }
  });
  tx();
  return ids.map((id) => toSuggestion(getDb().prepare('SELECT * FROM project_insertion_suggestions WHERE id = ?').get(id) as SuggestionRow));
}

export function updateSuggestionStatus(id: string, status: ChapterSuggestionStatus): ProjectInsertionSuggestion | null {
  const row = getDb().prepare('SELECT * FROM project_insertion_suggestions WHERE id = ?').get(id) as SuggestionRow | undefined;
  if (!row) return null;
  const next = row.blocked_reason ? 'blocked' : status;
  getDb().prepare('UPDATE project_insertion_suggestions SET status = ?, updated_at = ? WHERE id = ?').run(next, now(), id);
  return toSuggestion(getDb().prepare('SELECT * FROM project_insertion_suggestions WHERE id = ?').get(id) as SuggestionRow);
}

export function applySuggestions(chapterId: string, suggestionIds: string[]): ProjectChapter | null {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;
  const ids = Array.from(new Set(suggestionIds)).filter(Boolean);
  if (ids.length === 0) return chapter;
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT * FROM project_insertion_suggestions
       WHERE chapter_id = ? AND id IN (${placeholders})
         AND blocked_reason IS NULL
         AND status IN ('suggested', 'accepted')`
    )
    .all(chapterId, ...ids) as SuggestionRow[];
  const suggestions = rows.map(toSuggestion).filter((s) => s.proposedText.trim());
  if (suggestions.length === 0) return chapter;
  const chunks = listChapterChunks(chapterId);
  const markdown = applySuggestionTexts(chapter.currentMarkdown, chunks, suggestions);
  const updated = updateChapterMarkdown(chapterId, markdown, { versionLabel: 'Antes de aplicar sugerencias' });
  const tx = getDb().transaction(() => {
    for (const suggestion of suggestions) {
      getDb().prepare("UPDATE project_insertion_suggestions SET status = 'applied', updated_at = ? WHERE id = ?").run(now(), suggestion.id);
    }
  });
  tx();
  return updated;
}

function applySuggestionTexts(
  markdown: string,
  chunks: ProjectChapterChunk[],
  suggestions: ProjectInsertionSuggestion[]
): string {
  let out = markdown;
  const targets = suggestions
    .map((suggestion, index) => {
      const chunk = chunks.find((c) => c.id === suggestion.targetChunkId) ?? null;
      const pos = suggestion.operation === 'insert_before' ? chunk?.startOffset : chunk?.endOffset;
      return { suggestion, chunk, index, pos: pos ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => b.pos - a.pos || b.index - a.index);

  for (const target of targets) {
    const addition = formatAppliedSuggestion(target.suggestion);
    if (!addition) continue;
    if (!target.chunk) {
      out = `${out.trim()}\n\n${addition}\n`;
      continue;
    }
    const exactStart = out.slice(target.chunk.startOffset, target.chunk.endOffset).trim() === target.chunk.text.trim()
      ? target.chunk.startOffset
      : out.indexOf(target.chunk.text);
    if (exactStart < 0) {
      out = `${out.trim()}\n\n${addition}\n`;
      continue;
    }
    const exactEnd = exactStart + target.chunk.text.length;
    if (target.suggestion.operation === 'replace') {
      out = out.slice(0, exactStart) + addition + out.slice(exactEnd);
    } else if (target.suggestion.operation === 'insert_before') {
      out = out.slice(0, exactStart) + `${addition}\n\n` + out.slice(exactStart);
    } else {
      out = out.slice(0, exactEnd) + `\n\n${addition}` + out.slice(exactEnd);
    }
  }
  return out;
}

function formatAppliedSuggestion(suggestion: ProjectInsertionSuggestion): string {
  const text = suggestion.proposedText.trim();
  if (!text) return '';
  if (suggestion.operation !== 'comment') return text;
  return text
    .split(/\n+/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function createChapterVersion(chapterId: string, label: string, markdown: string): ProjectChapterVersion {
  const id = uuid();
  const created = now();
  getDb()
    .prepare('INSERT INTO project_chapter_versions (id, chapter_id, label, markdown, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, chapterId, label.trim() || 'Versión', markdown, created);
  return toVersion(getDb().prepare('SELECT * FROM project_chapter_versions WHERE id = ?').get(id) as VersionRow);
}

export function listChapterVersions(chapterId: string): ProjectChapterVersion[] {
  return (getDb()
    .prepare('SELECT * FROM project_chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC')
    .all(chapterId) as VersionRow[]).map(toVersion);
}

export function restoreChapterVersion(versionId: string): ProjectChapter | null {
  const version = getDb().prepare('SELECT * FROM project_chapter_versions WHERE id = ?').get(versionId) as VersionRow | undefined;
  if (!version) return null;
  return updateChapterMarkdown(version.chapter_id, version.markdown, { versionLabel: 'Antes de restaurar versión' });
}

export function touchProject(projectId: string): void {
  getDb().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
}
