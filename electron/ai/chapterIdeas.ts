import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
// Phase 1 + 2 of "chapter relations": distil the uploaded chapter into its own
// ideas (kept apart from the curated graph), embed them, and discover TYPED
// relations with the whole library (corpus ideas, the user's notes, full-text
// passages and work summaries). Symmetric idea↔idea matching is far sharper than
// matching raw prose chunks, and the typed relations drive both a relations view
// and better insertion suggestions.
import crypto from 'node:crypto';
import type {
  AnalyzeChapterRelationsRequest,
  ChapterIdeaRelation,
  ChapterIdeaType,
  ChapterRelationsProgress,
  ChapterRelationsResult,
  ChapterRelationTargetKind,
  ChapterRelationType,
  ModelRef,
  PromptLanguage,
  ProjectChapterIdea,
} from '@shared/types';
import { AiError, embedMany } from './aiClient';
import { completeJsonWithHeadroom } from './structuredHeadroom';
import { getChapter, listChapterChunks } from '../db/projectsRepo';
import {
  chapterIdeasSourceHash,
  listChapterIdeaRelations,
  listChapterIdeas,
  replaceChapterAnalysis,
  type NewChapterIdea,
  type NewChapterIdeaRelation,
} from '../db/projectChapterIdeasRepo';
import { findSimilarIdeas, getIdeaSummary } from '../db/ideasRepo';
import { findSimilarNotes, getNote, noteEmbeddingText, notesNeedingEmbedding, updateNoteEmbedding } from '../db/notesRepo';
import { findSimilarPassages, getPassageDetail } from '../db/passagesRepo';
import { findSimilarWorks } from '../db/workSummariesRepo';
import { getWork } from '../db/worksRepo';
import { getSettings } from '../db/settingsRepo';
import { chapterPromptPack } from '@shared/academicPromptPacks';
import { adaptiveStructuredBatch } from './adaptiveStructuredBatch';
import { localTaskOutputTokens } from './localRequestPlanner';

const EXTRACT_MAX_CHUNKS = 48;
const EXTRACT_CHUNK_BATCH = 6;
const MAX_CHAPTER_IDEAS = 40;
const CANDIDATES_PER_IDEA = 6;
const RELATION_MIN_SIMILARITY = 0.3;
const TYPING_PAIR_BATCH = 36;

const TARGET_FALLBACK_COPY: Record<PromptLanguage, { untitledNote: string; note: string; passage: string }> = {
  es: { untitledNote: '(nota sin título)', note: 'nota', passage: 'pasaje' },
  en: { untitledNote: '(untitled note)', note: 'note', passage: 'passage' },
  fr: { untitledNote: '(note sans titre)', note: 'note', passage: 'passage' },
  de: { untitledNote: '(Notiz ohne Titel)', note: 'Notiz', passage: 'Passage' },
  pt: { untitledNote: '(nota sem título)', note: 'nota', passage: 'passagem' },
  'pt-BR': { untitledNote: '(nota sem título)', note: 'nota', passage: 'trecho' },
  it: { untitledNote: '(nota senza titolo)', note: 'nota', passage: 'passaggio' },
  tr: { untitledNote: '(başlıksız not)', note: 'not', passage: 'pasaj' },
  'zh-Hans': { untitledNote: '(无标题笔记)', note: '笔记', passage: '段落' },
  'zh-Hant': { untitledNote: '(無標題筆記)', note: '筆記', passage: '段落' },
  vi: { untitledNote: '(ghi chú không có tiêu đề)', note: 'ghi chú', passage: 'đoạn trích' },
  ja: { untitledNote: '(無題のノート)', note: 'ノート', passage: '一節' },
  ru: { untitledNote: '(заметка без названия)', note: 'заметка', passage: 'фрагмент' },
  uk: { untitledNote: '(нотатка без назви)', note: 'нотатка', passage: 'фрагмент' },
  ko: { untitledNote: '(제목 없는 노트)', note: '노트', passage: '구절' },
};

function targetFallbackCopy(): (typeof TARGET_FALLBACK_COPY)[PromptLanguage] {
  try {
    return TARGET_FALLBACK_COPY[normalizePromptLanguage(getSettings().uiLanguage)];
  } catch {
    return TARGET_FALLBACK_COPY.es;
  }
}
const RELATION_TYPES: ChapterRelationType[] = ['supports', 'contradicts', 'refines', 'extends', 'related'];
const IDEA_TYPES: ChapterIdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];

// ── Progress fan-out ─────────────────────────────────────────────────────────
type ProgressListener = (p: ChapterRelationsProgress) => void;
const listeners = new Set<ProgressListener>();
export function onChapterRelationsProgress(cb: ProgressListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(p: ChapterRelationsProgress): void {
  for (const listener of listeners) listener(p);
}

function chapterText(currentMarkdown: string): string {
  return currentMarkdown.replace(/\r\n/g, '\n').trim();
}
function hashText(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(i * step)]);
  return out;
}
export function chapterIdeaEmbeddingText(idea: { type: string; label: string; statement: string }, language: PromptLanguage = getSettings().promptLanguage ?? 'es'): string {
  const copy = chapterPromptPack(language);
  return `${copy.embeddingType}: ${idea.type}\n${copy.embeddingLabel}: ${idea.label}\n${copy.embeddingStatement}: ${idea.statement}`;
}

// ── Extraction ───────────────────────────────────────────────────────────────
interface RawIdea {
  type?: string;
  label?: string;
  statement?: string;
}
interface ExtractResponse {
  ideas: RawIdea[];
}
function isExtractResponse(v: unknown): v is ExtractResponse {
  return Boolean(
    v
    && typeof v === 'object'
    && Array.isArray((v as ExtractResponse).ideas)
    && (v as ExtractResponse).ideas.every((idea) => (
      idea
      && typeof idea === 'object'
      && typeof idea.statement === 'string'
      && idea.statement.trim().length > 0
      && (idea.label === undefined || typeof idea.label === 'string')
      && (idea.type === undefined || typeof idea.type === 'string')
    )),
  );
}

export async function extractChapterIdeas(
  chunks: { headingPath: string; text: string }[],
  model: ModelRef | null | undefined,
  language: PromptLanguage
): Promise<RawIdea[]> {
  const sampled = sampleEvenly(chunks, EXTRACT_MAX_CHUNKS);
  const collected = await adaptiveStructuredBatch<{ headingPath: string; text: string }, RawIdea[]>({
    items: sampled,
    initialBatchSize: EXTRACT_CHUNK_BATCH,
    execute: async (batch, context) => {
        const res = await completeJsonWithHeadroom<ExtractResponse>(
        {
          system: chapterPromptPack(language).extract,
          user: JSON.stringify(
            { fragmentos: batch.map((chunk) => ({ heading: chunk.headingPath, text: clip(chunk.text, context.textLimit) })) },
            null,
            2
          ),
          temperature: 0.1,
          maxTokens: localTaskOutputTokens('chapter-idea-extraction', batch.length),
          task: 'chapter-idea-extraction',
          batchSize: batch.length,
          splitDepth: context.splitDepth,
        },
        isExtractResponse,
        model
      );
      return res.ideas;
    },
    combine: (parts) => parts.flat(),
  });
  return dedupeIdeas(collected).slice(0, MAX_CHAPTER_IDEAS);
}

function normalizeIdeaType(value: unknown): ChapterIdeaType {
  return IDEA_TYPES.includes(String(value) as ChapterIdeaType) ? (value as ChapterIdeaType) : 'claim';
}
function dedupeIdeas(ideas: RawIdea[]): RawIdea[] {
  const seen = new Set<string>();
  const out: RawIdea[] = [];
  for (const idea of ideas) {
    const label = (idea.label ?? '').trim();
    const statement = (idea.statement ?? '').trim();
    if (!statement) continue;
    const key = (label || statement).toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: normalizeIdeaType(idea.type), label: label || clip(statement, 60), statement });
  }
  return out;
}

// ── Candidate retrieval across the library ───────────────────────────────────
export interface Candidate {
  kind: ChapterRelationTargetKind;
  id: string;
  similarity: number;
  text: string; // short text shown to the typing model
}

export function gatherCandidates(vector: number[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const hit of findSimilarIdeas(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'idea', id: hit.global_id, similarity: hit.similarity, text: `${hit.label}: ${hit.statement}` });
  }
  for (const hit of findSimilarNotes(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'note', id: hit.id, similarity: hit.similarity, text: `${hit.title}: ${hit.content}` });
  }
  for (const hit of findSimilarPassages(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'passage', id: hit.passage_id, similarity: hit.similarity, text: `${hit.title}: ${hit.text}` });
  }
  for (const hit of findSimilarWorks(vector, RELATION_MIN_SIMILARITY, CANDIDATES_PER_IDEA)) {
    candidates.push({ kind: 'work', id: hit.nodus_id, similarity: hit.similarity, text: hit.summary });
  }
  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, CANDIDATES_PER_IDEA);
}

// ── Typing ───────────────────────────────────────────────────────────────────
export interface RawRelation {
  chapterIdeaId?: string;
  targetKind?: string;
  targetId?: string;
  relation?: string;
  confidence?: number;
  rationale?: string;
}
interface TypeResponse {
  relations: RawRelation[];
}
function isTypeResponse(v: unknown): v is TypeResponse {
  return Boolean(v && typeof v === 'object' && Array.isArray((v as TypeResponse).relations));
}
export function normalizeRelationType(value: unknown): ChapterRelationType {
  return RELATION_TYPES.includes(String(value) as ChapterRelationType) ? (value as ChapterRelationType) : 'related';
}
export function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

interface TypingPair {
  idea: { id: string; label: string; statement: string };
  candidate: Candidate;
}

function relationKey(relation: { chapterIdeaId?: string; targetKind?: string; targetId?: string }): string {
  return `${relation.chapterIdeaId ?? ''}|${relation.targetKind ?? ''}:${relation.targetId ?? ''}`;
}

function validateTypedBatch(batch: TypingPair[], relations: RawRelation[]): RawRelation[] {
  const expected = new Set(batch.map(({ idea, candidate }) => `${idea.id}|${candidate.kind}:${candidate.id}`));
  const seen = new Set<string>();
  for (const relation of relations) {
    const key = relationKey(relation);
    const valid = expected.has(key)
      && !seen.has(key)
      && RELATION_TYPES.includes(String(relation.relation) as ChapterRelationType)
      && typeof relation.confidence === 'number'
      && Number.isFinite(relation.confidence)
      && relation.confidence >= 0
      && relation.confidence <= 1
      && typeof relation.rationale === 'string';
    if (!valid) throw new AiError('La clasificación devolvió pares incompletos, duplicados o inválidos.', true, false, 'invalid_json');
    seen.add(key);
  }
  if (seen.size !== expected.size) {
    throw new AiError(`La clasificación devolvió ${seen.size} de ${expected.size} pares requeridos.`, true, false, 'invalid_json');
  }
  return relations;
}

export async function typeRelations(
  ideas: { id: string; label: string; statement: string }[],
  candidatesByIdea: Map<string, Candidate[]>,
  model: ModelRef | null | undefined,
  language: PromptLanguage = getSettings().promptLanguage ?? 'es',
  failureMode: 'fallback' | 'strict' = 'fallback',
): Promise<Map<string, RawRelation>> {
  const typed = new Map<string, RawRelation>();
  const pairs: TypingPair[] = ideas.flatMap((idea) => (
    (candidatesByIdea.get(idea.id) ?? []).map((candidate) => ({ idea, candidate }))
  ));
  if (pairs.length === 0) return typed;

  try {
    const relations = await adaptiveStructuredBatch<TypingPair, RawRelation[]>({
      items: pairs,
      initialBatchSize: TYPING_PAIR_BATCH,
      execute: async (batch, context) => {
        const grouped = new Map<string, { idea: TypingPair['idea']; candidates: Candidate[] }>();
        for (const pair of batch) {
          const entry = grouped.get(pair.idea.id) ?? { idea: pair.idea, candidates: [] };
          entry.candidates.push(pair.candidate);
          grouped.set(pair.idea.id, entry);
        }
        const res = await completeJsonWithHeadroom<TypeResponse>(
          {
            system: chapterPromptPack(language).type,
            user: JSON.stringify(
              {
                ideas_manuscrito: [...grouped.values()].map(({ idea, candidates }) => ({
                  chapterIdeaId: idea.id,
                  label: idea.label,
                  statement: clip(idea.statement, Math.min(400, context.textLimit)),
                  candidatos: candidates.map((c) => ({
                    targetKind: c.kind,
                    targetId: c.id,
                    texto: clip(c.text, Math.min(400, context.textLimit)),
                  })),
                })),
              },
              null,
              2,
            ),
            temperature: 0.1,
            maxTokens: localTaskOutputTokens('chapter-relation-typing', batch.length),
            task: 'chapter-relation-typing',
            batchSize: batch.length,
            splitDepth: context.splitDepth,
          },
          isTypeResponse,
          model,
        );
        return validateTypedBatch(batch, res.relations);
      },
      combine: (parts) => parts.flat(),
    });
    for (const relation of relations) typed.set(relationKey(relation), relation);
  } catch (error) {
    if (failureMode === 'strict') throw error;
    // Live paragraph analysis deliberately degrades to semantic ranking.
    return new Map();
  }
  return typed;
}

// ── Embedding notes on demand ────────────────────────────────────────────────
async function ensureNotesEmbedded(): Promise<void> {
  const pending = notesNeedingEmbedding();
  if (pending.length === 0) return;
  const texts = pending.map((note) => noteEmbeddingText(note));
  const vectors = await embedMany(texts);
  pending.forEach((note, index) => {
    const vector = vectors[index];
    if (vector) updateNoteEmbedding(note.id, texts[index], vector);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Resolve display metadata for a relation target. */
export function resolveTarget(kind: ChapterRelationTargetKind, id: string): { label: string; subtitle: string | null } {
  const copy = targetFallbackCopy();
  try {
    if (kind === 'idea') {
      const idea = getIdeaSummary(id);
      return { label: idea?.label ?? id, subtitle: idea?.type ?? null };
    }
    if (kind === 'note') {
      const note = getNote(id);
      return { label: note?.title || copy.untitledNote, subtitle: copy.note };
    }
    if (kind === 'work') {
      const work = getWork(id);
      const author = work?.authors?.[0];
      const sub = [author, work?.year ? String(work.year) : null].filter(Boolean).join(' · ') || null;
      return { label: work?.title ?? id, subtitle: sub };
    }
    if (kind === 'passage') {
      const passage = getPassageDetail(id);
      if (!passage) return { label: id, subtitle: copy.passage };
      const sub = [passage.work.authors[0], passage.page_label ? `p. ${passage.page_label}` : null].filter(Boolean).join(' · ');
      return { label: passage.work.title, subtitle: sub || copy.passage };
    }
  } catch {
    /* fall through */
  }
  return { label: id, subtitle: null };
}

/** Build the result view from whatever is currently stored (no AI). */
export function getChapterRelations(chapterId: string): ChapterRelationsResult {
  const ideas = listChapterIdeas(chapterId);
  const relRows = listChapterIdeaRelations(chapterId);
  const byIdea = new Map<string, ChapterIdeaRelation[]>();
  for (const row of relRows) {
    const target = resolveTarget(row.target_kind, row.target_id);
    const rel: ChapterIdeaRelation = {
      id: row.id,
      chapterIdeaId: row.chapter_idea_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      relation: row.relation,
      similarity: row.similarity,
      confidence: row.confidence,
      rationale: row.rationale,
      targetLabel: target.label,
      targetSubtitle: target.subtitle,
    };
    const list = byIdea.get(row.chapter_idea_id) ?? [];
    list.push(rel);
    byIdea.set(row.chapter_idea_id, list);
  }
  return {
    chapterId,
    analyzed: ideas.length > 0,
    available: true,
    ideas: ideas.map((idea: ProjectChapterIdea) => ({ idea, relations: byIdea.get(idea.id) ?? [] })),
  };
}

export async function analyzeChapterRelations(
  request: AnalyzeChapterRelationsRequest
): Promise<ChapterRelationsResult> {
  const chapter = getChapter(request.chapterId);
  if (!chapter) return { chapterId: request.chapterId, analyzed: false, available: true, ideas: [] };
  const model = request.model ?? null;
  const language = request.language ?? getSettings().promptLanguage ?? 'es';
  const text = chapterText(chapter.currentMarkdown);
  const hash = hashText(text);

  // Cache: reuse stored ideas+relations when the text hasn't changed.
  if (!request.force && chapterIdeasSourceHash(request.chapterId) === hash) {
    return getChapterRelations(request.chapterId);
  }

  emit({ chapterId: request.chapterId, phase: 'extracting', current: 0, total: 0, message: 'Extrayendo ideas del capítulo…' });
  const chunks = listChapterChunks(request.chapterId);
  if (chunks.length === 0) return { chapterId: request.chapterId, analyzed: false, available: true, ideas: [] };
  try {
    const rawIdeas = await extractChapterIdeas(chunks, model, language);
    if (rawIdeas.length === 0) {
      throw new AiError('El nuevo análisis no produjo ninguna idea verificable; se ha conservado el análisis anterior.', true);
    }

    emit({ chapterId: request.chapterId, phase: 'embedding', current: 0, total: rawIdeas.length, message: 'Indexando ideas…' });
    const embedTexts = rawIdeas.map((idea) => chapterIdeaEmbeddingText({ type: idea.type!, label: idea.label!, statement: idea.statement! }, language));
    const vectors = await embedMany(embedTexts, undefined, { jobId: `chapter-relations:${request.chapterId}` });
    if (vectors.some((vector) => !vector)) {
      emit({ chapterId: request.chapterId, phase: 'error', current: 0, total: 0, message: 'No hay proveedor de embeddings configurado. Se ha conservado el análisis anterior.' });
      return { ...getChapterRelations(request.chapterId), available: false };
    }

    const newIdeas: NewChapterIdea[] = rawIdeas.map((idea, index) => ({
      id: crypto.randomUUID(),
      type: normalizeIdeaType(idea.type),
      label: idea.label!,
      statement: idea.statement!,
      embedding: vectors[index],
      embeddingText: embedTexts[index],
    }));

    // Notes may be indexed as a prerequisite, but the chapter's last valid
    // analysis remains untouched until ideas and relations are both complete.
    emit({ chapterId: request.chapterId, phase: 'relating', current: 0, total: newIdeas.length, message: 'Buscando relaciones…' });
    await ensureNotesEmbedded();

    const candidatesByIdea = new Map<string, Candidate[]>();
    let done = 0;
    for (const idea of newIdeas) {
      candidatesByIdea.set(idea.id!, gatherCandidates(idea.embedding!));
      done += 1;
      if (done % 5 === 0) emit({ chapterId: request.chapterId, phase: 'relating', current: done, total: newIdeas.length, message: 'Buscando relaciones…' });
    }

    const typed = await typeRelations(
      newIdeas.map((idea) => ({ id: idea.id!, label: idea.label, statement: idea.statement })),
      candidatesByIdea,
      model,
      language,
      'strict',
    );

    const relations: NewChapterIdeaRelation[] = [];
    for (const [chapterIdeaId, candidates] of candidatesByIdea) {
      for (const candidate of candidates) {
        const hit = typed.get(`${chapterIdeaId}|${candidate.kind}:${candidate.id}`);
        if (!hit) throw new AiError('Falta una relación validada; no se publicará un análisis parcial.', true, false, 'invalid_json');
        relations.push({
          chapterIdeaId,
          targetKind: candidate.kind,
          targetId: candidate.id,
          relation: hit.relation as ChapterRelationType,
          similarity: candidate.similarity,
          confidence: hit.confidence!,
          rationale: clip(hit.rationale!, 400),
        });
      }
    }
    const stored = replaceChapterAnalysis(request.chapterId, chapter.projectId, hash, newIdeas, relations);
    emit({ chapterId: request.chapterId, phase: 'done', current: stored.length, total: stored.length, message: 'Análisis completado.' });
    return getChapterRelations(request.chapterId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ chapterId: request.chapterId, phase: 'error', current: 0, total: 0, message });
    throw error;
  }
}
