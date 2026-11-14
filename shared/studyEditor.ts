import type { AcademicMetadata } from './academicDocument';
import type { BlockNoteDocument } from './blockNoteDocument';

export type StudyEditorSaveReason = 'autosave' | 'manual' | 'restore' | 'import' | 'command';
export type StudyEditorAlignment = 'left' | 'center' | 'right' | 'justify';
export type StudyEditorTheme = 'paper' | 'soft' | 'contrast';

export interface StudyDocStyle {
  fontFamily: 'serif' | 'sans' | 'mono';
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  marginX: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  alignment: StudyEditorAlignment;
  theme: StudyEditorTheme;
}

export const DEFAULT_STUDY_DOC_STYLE: StudyDocStyle = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.75,
  pageWidth: 820,
  marginX: 56,
  paragraphSpacing: 0.8,
  firstLineIndent: 0,
  alignment: 'justify',
  theme: 'paper',
};

export interface StudyDocVersion {
  academicMetadata?: AcademicMetadata;
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  id: string;
  shortId: string;
  documentId: string;
  versionNo: number;
  title: string;
  contentMarkdown: string;
  style: StudyDocStyle;
  reason: StudyEditorSaveReason;
  contentHash: string;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyAnnotation {
  anchor?: StudyBlockAnchor | null;
  anchorStatus?: 'attached' | 'ambiguous' | 'missing';
  id: string;
  shortId: string;
  documentId: string;
  from: number;
  to: number;
  selectedText: string;
  comment: string;
  color: string | null;
  resolvedAt: string | null;
  locked: boolean;
  pinned: boolean;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyDocLink {
  id: string;
  shortId: string;
  sourceDocumentId: string;
  targetDocumentId: string | null;
  targetRef: string;
  targetTitle: string | null;
  linkText: string | null;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyDocEditorData {
  mobileSyncState?: 'pending' | 'conflict' | 'blocked';
  mobileSyncIssue?: string | null;
  mobileConflictRemote?: StudyDocEditorData;
  academicMetadata?: AcademicMetadata;
  documentTitle?: string;
  contentMarkdown?: string;
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  revision?: number;
  versions: StudyDocVersion[];
  annotations: StudyAnnotation[];
  outgoingLinks: StudyDocLink[];
  backlinks: StudyDocLink[];
  style: StudyDocStyle;
  spellcheckLanguage: string;
  customDictionary: string[];
}

export interface StudyDocUpdateInput {
  academicMetadata?: AcademicMetadata;
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  expectedRevision?: number;
  title: string;
  contentMarkdown: string;
  style?: Partial<StudyDocStyle>;
  spellcheckLanguage?: string;
  customDictionary?: string[];
  reason?: StudyEditorSaveReason;
}

export interface StudyAnnotationInput {
  anchor?: StudyBlockAnchor | null;
  from: number;
  to: number;
  selectedText: string;
  comment: string;
  color?: string | null;
  locked?: boolean;
  pinned?: boolean;
}

export interface StudyBlockAnchor {
  blockId: string;
  endBlockId?: string;
  from: number;
  to: number;
}

export interface StudyOutlineItem {
  id: string;
  level: number;
  text: string;
  line: number;
}

export interface StudyDocumentStats {
  words: number;
  characters: number;
  paragraphs: number;
  readingMinutes: number;
}

export interface ParsedStudyDocLink {
  targetRef: string;
  label: string | null;
}

export function normalizeStudyDocStyle(value?: Partial<StudyDocStyle> | null): StudyDocStyle {
  const numberIn = (candidate: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  return {
    fontFamily: value?.fontFamily === 'sans' || value?.fontFamily === 'mono' ? value.fontFamily : 'serif',
    fontSize: numberIn(value?.fontSize, DEFAULT_STUDY_DOC_STYLE.fontSize, 12, 32),
    lineHeight: numberIn(value?.lineHeight, DEFAULT_STUDY_DOC_STYLE.lineHeight, 1.1, 2.5),
    pageWidth: numberIn(value?.pageWidth, DEFAULT_STUDY_DOC_STYLE.pageWidth, 520, 1400),
    marginX: numberIn(value?.marginX, DEFAULT_STUDY_DOC_STYLE.marginX, 16, 160),
    paragraphSpacing: numberIn(value?.paragraphSpacing, DEFAULT_STUDY_DOC_STYLE.paragraphSpacing, 0, 3),
    firstLineIndent: numberIn(value?.firstLineIndent, DEFAULT_STUDY_DOC_STYLE.firstLineIndent, 0, 80),
    alignment: ['left', 'center', 'right', 'justify'].includes(value?.alignment ?? '') ? value!.alignment! : 'justify',
    theme: ['paper', 'soft', 'contrast'].includes(value?.theme ?? '') ? value!.theme! : 'paper',
  };
}

export function studyOutlineId(text: string, index: number): string {
  const slug = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'section'}-${index + 1}`;
}

export function extractStudyOutline(markdown: string): StudyOutlineItem[] {
  const result: StudyOutlineItem[] = [];
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, lineIndex) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    const text = match[2].replace(/[*_`~]/g, '').trim();
    result.push({ id: studyOutlineId(text, result.length), level: match[1].length, text, line: lineIndex + 1 });
  });
  return result;
}

export function studyDocumentStats(markdown: string): StudyDocumentStats {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[-#>*_~`|$^]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const paragraphs = markdown.split(/\n\s*\n/).filter((part) => part.trim()).length;
  return { words, characters: markdown.length, paragraphs, readingMinutes: words ? Math.max(1, Math.ceil(words / 220)) : 0 };
}

export function parseStudyDocLinks(markdown: string): ParsedStudyDocLink[] {
  const links: ParsedStudyDocLink[] = [];
  const seen = new Set<string>();
  const add = (targetRef: string, label: string | null) => {
    const key = `${targetRef}\n${label ?? ''}`;
    if (!targetRef || seen.has(key)) return;
    seen.add(key);
    links.push({ targetRef, label });
  };
  // Un enlace entre documentos del MISMO espacio. Hay dos esquemas porque hay dos
  // espacios —los apuntes de Estudio y las notas del Workspace— y el editor es el
  // mismo para los dos; lo que se hace con el destino ya depende de quién resuelve.
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(nodus:\/\/(?:study\/doc|note)\/([^)\s]+)\)/g)) add(match[2], match[1]);
  for (const match of markdown.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) add(match[1].trim(), match[2]?.trim() ?? null);
  return links;
}

export type StudyEditorCommand = 'titulo' | 'subtitulo' | 'tabla' | 'cita' | 'imagen' | 'audio' | 'test' | 'academico';

export function studyCommandMarkdown(command: StudyEditorCommand): string {
  const snippets: Record<StudyEditorCommand, string> = {
    titulo: '# Título\n',
    subtitulo: '## Subtítulo\n',
    tabla: '| Columna 1 | Columna 2 |\n| --- | --- |\n| Contenido | Contenido |\n',
    cita: '> Cita o idea destacada\n',
    imagen: '![Descripción](https://)\n',
    audio: '> [!AUDIO]\n> El dictado y los clips de audio se conectarán en la fase de voz.\n',
    test: '> [!TEST]\n> El banco de preguntas se conectará en la fase de evaluación.\n',
    academico: '> [!MEJORA]\n> Selecciona texto para aplicar el estilo académico en la fase de mejora.\n',
  };
  return snippets[command];
}
