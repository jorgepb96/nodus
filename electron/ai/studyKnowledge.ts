import crypto from 'node:crypto';
import type {
  ExtractedStudyIdea,
  ExtractedStudyRelation,
  StudyAssessmentKnowledgeContext,
  StudyIdeaConnection,
  StudyKnowledgeExtraction,
  StudyKnowledgeProgress,
  StudyKnowledgeSourceKind,
} from '@shared/studyKnowledge';
import type { PromptLanguage } from '@shared/types';
import { studyKnowledgePromptPack } from '@shared/studyKnowledgePromptPacks';
import { completeJson, embedQuery, embedMany } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getStudyMaterial } from '../db/studyMaterialsRepo';
import {
  connectStudySourceIdeasSemantically,
  getStudyKnowledgeJob,
  listStudyConnectionsForIdeas,
  listStudyIdeaVectors,
  listStudyKnowledgeJobs,
  normalizeStudyIdeaLabel,
  replaceStudySourceKnowledge,
  setStudyKnowledgeJob,
  sourceSubjectIds,
  syncStudyKnowledgeSourceScopes,
} from '../db/studyKnowledgeRepo';

type Listener = (progress: StudyKnowledgeProgress) => void;
interface QueuedSource { kind: StudyKnowledgeSourceKind; id: string; force: boolean; externalConsentModelKey: string | null }
interface QueueOptions { approved?: boolean; externalConsentModelKey?: string | null; explicit?: boolean }
interface SourceData { kind: StudyKnowledgeSourceKind; id: string; title: string; text: string; hash: string }

const listeners = new Set<Listener>();
const queue = new Map<string, QueuedSource>();
let draining = false;
let currentTitle: string | null = null;

const IDEA_TYPES = new Set(['concept', 'definition', 'principle', 'process', 'cause', 'consequence', 'example', 'debate']);
const RELATION_TYPES = new Set(['related', 'supports', 'contrasts', 'causes', 'depends_on', 'part_of', 'applies']);

/**
 * Shape check for a model extraction. Relation *validity* is deliberately not asserted
 * here: mergeStudyKnowledgeExtractions already drops relations whose endpoints don't
 * resolve to a returned idea, so per-relation validity has always been the merge step's
 * job — and rejecting the whole payload over one relation is catastrophically lossy.
 * Models drift off the relation vocabulary routinely (gemini-2.5-flash-lite emits
 * `produces`, and leaks the idea type `consequence` into relations because the prompt
 * lists both vocabularies together); when it did, this guard threw away 27 sound ideas
 * and 34 sound relations, and the retries hit the same drift until extraction failed
 * outright with "El JSON no cumple el esquema esperado". Ideas stay strict: they are the
 * payload, and one malformed idea is a real defect rather than off-vocabulary noise.
 */
export function isStudyKnowledgeExtraction(value: unknown): value is StudyKnowledgeExtraction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as StudyKnowledgeExtraction;
  return Array.isArray(candidate.ideas) && Array.isArray(candidate.relations)
    && candidate.ideas.every((idea) => idea && typeof idea.key === 'string' && typeof idea.label === 'string'
      && typeof idea.statement === 'string' && IDEA_TYPES.has(idea.type) && Array.isArray(idea.evidence))
    && candidate.relations.every((relation) => relation && typeof relation.from === 'string' && typeof relation.to === 'string'
      && typeof relation.type === 'string');
}

export function buildStudyKnowledgePrompt(title: string, text: string, language: PromptLanguage = 'es') {
  const prompt = studyKnowledgePromptPack(language);
  return {
    system: prompt.system,
    user: `${prompt.title}: ${title}\n\n${prompt.text}:\n${text}`,
  };
}

export function chunkStudyKnowledgeText(text: string, maxChars = 14_000, maxChunks = 8): string[] {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean); const chunks: string[] = []; let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) { chunks.push(current); current = ''; if (chunks.length >= maxChunks) break; }
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let start = 0; start < paragraph.length && chunks.length < maxChunks; start += maxChars) chunks.push(paragraph.slice(start, start + maxChars));
    } else current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks;
}

export function mergeStudyKnowledgeExtractions(parts: StudyKnowledgeExtraction[]): StudyKnowledgeExtraction {
  const ideas = new Map<string, ExtractedStudyIdea>(); const relations: ExtractedStudyRelation[] = [];
  for (const part of parts) {
    const localKey = new Map<string, string>();
    for (const idea of part.ideas) {
      const normalized = normalizeStudyIdeaLabel(idea.label); if (!normalized) continue;
      localKey.set(idea.key, normalized);
      const prior = ideas.get(normalized);
      if (!prior) ideas.set(normalized, { ...idea, key: normalized, confidence: Number.isFinite(idea.confidence) ? idea.confidence : 0.6,
        role: idea.role === 'principal' ? 'principal' : 'secondary', evidence: idea.evidence.slice(0, 8) });
      else {
        prior.confidence = Math.max(prior.confidence, Number(idea.confidence) || 0);
        if (idea.statement.length > prior.statement.length) prior.statement = idea.statement;
        if (idea.role === 'principal') prior.role = 'principal';
        const seen = new Set(prior.evidence.map((item) => item.quote.trim()));
        prior.evidence.push(...idea.evidence.filter((item) => item.quote.trim() && !seen.has(item.quote.trim())).slice(0, 8 - prior.evidence.length));
      }
    }
    for (const relation of part.relations) {
      const from = localKey.get(relation.from); const to = localKey.get(relation.to);
      // Off-vocabulary types are dropped, not coerced. Mapping an unknown type onto the
      // generic `related` would render a `refutes`/`contradicts` edge the model actually
      // meant as a neutral association — a claim the graph would state and nobody made.
      // Dropping the edge asserts nothing, and matches how unresolved endpoints are handled.
      if (from && to && from !== to && RELATION_TYPES.has(relation.type)) {
        relations.push({ ...relation, from, to, confidence: Number.isFinite(relation.confidence) ? relation.confidence : 0.5 });
      }
    }
  }
  const uniqueRelations = new Map<string, ExtractedStudyRelation>();
  for (const relation of relations) {
    const key = `${relation.from}\0${relation.to}\0${relation.type}`; const prior = uniqueRelations.get(key);
    if (!prior || relation.confidence > prior.confidence) uniqueRelations.set(key, relation);
  }
  return { ideas: [...ideas.values()].slice(0, 80), relations: [...uniqueRelations.values()].slice(0, 160) };
}

function sourceData(kind: StudyKnowledgeSourceKind, id: string): SourceData | null {
  if (kind === 'material') {
    const material = getStudyMaterial(id);
    if (material.deletedAt || material.archivedAt) return null;
    const text = [material.visualDescription, material.extractedText].filter(Boolean).join('\n\n').trim();
    return { kind, id, title: material.title, text, hash: crypto.createHash('sha256').update(text).digest('hex') };
  }
  const row = getDb().prepare('SELECT title,content_markdown FROM study_docs WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL').get(id) as { title: string; content_markdown: string } | undefined;
  if (!row) return null; const text = String(row.content_markdown ?? '').trim();
  return { kind, id, title: String(row.title), text, hash: crypto.createHash('sha256').update(text).digest('hex') };
}

function progress(): StudyKnowledgeProgress {
  const jobs = listStudyKnowledgeJobs();
  return { pending: queue.size + jobs.filter((job) => job.status === 'pending').length, running: draining ? 1 : 0,
    done: jobs.filter((job) => job.status === 'done').length, errors: jobs.filter((job) => job.status === 'error').length, currentTitle };
}
function emit(): void { const value = progress(); for (const listener of listeners) listener(value); }
export function getStudyKnowledgeProgress(): StudyKnowledgeProgress { return progress(); }
export function onStudyKnowledgeChanged(listener: Listener): () => void { listeners.add(listener); return () => listeners.delete(listener); }

async function analyzeSource(source: SourceData, force: boolean, externalConsentModelKey: string | null): Promise<void> {
  const language = getSettings().promptLanguage ?? 'es';
  const promptPack = studyKnowledgePromptPack(language);
  syncStudyKnowledgeSourceScopes(source.kind, source.id);
  const subjectIds = sourceSubjectIds(source.kind, source.id); if (!subjectIds.length) return;
  if (source.text.length < 80) {
    for (const subjectId of subjectIds) setStudyKnowledgeJob({ subjectId, sourceKind: source.kind, sourceId: source.id, status: 'unavailable', phase: 'empty', sourceHash: source.hash, error: promptPack.insufficientText });
    return;
  }
  const pendingSubjects = subjectIds.filter((subjectId) => force || getStudyKnowledgeJob(subjectId, source.kind, source.id)?.sourceHash !== source.hash
    || getStudyKnowledgeJob(subjectId, source.kind, source.id)?.status !== 'done');
  if (!pendingSubjects.length) return;
  for (const subjectId of pendingSubjects) setStudyKnowledgeJob({ subjectId, sourceKind: source.kind, sourceId: source.id, status: 'analyzing', phase: 'extracting', sourceHash: source.hash });
  emit();
  try {
    const chunks = chunkStudyKnowledgeText(source.text); const parts: StudyKnowledgeExtraction[] = [];
    for (const chunk of chunks) {
      const prompt = buildStudyKnowledgePrompt(source.title, chunk, language);
      const completed = await runStudyAiTask<StudyKnowledgeExtraction>({
        task: 'questions',
        subjectId: pendingSubjects[0],
        inputChars: prompt.system.length + prompt.user.length,
        externalPurpose: promptPack.externalPurpose,
        externalConsentKey: `knowledge:${source.kind}:${source.id}:${source.hash}`,
        externalConsentModelKey: externalConsentModelKey ?? undefined,
      },
        (model) => completeJson({ system: prompt.system, user: prompt.user, temperature: 0.1, maxTokens: 7000 }, isStudyKnowledgeExtraction, model));
      parts.push(completed.value);
    }
    const merged = mergeStudyKnowledgeExtractions(parts); const embeddingTexts = merged.ideas.map((idea) => `${idea.type}\n${idea.label}\n${idea.statement}`);
    const vectors = await embedMany(embeddingTexts); const config = currentEmbeddingConfig();
    for (const subjectId of pendingSubjects) {
      // The source can be deleted while an external model is still answering.
      // Re-check scope immediately before writing so a late response can never
      // resurrect ideas the user just chose to purge.
      if (!sourceSubjectIds(source.kind, source.id).includes(subjectId)) continue;
      setStudyKnowledgeJob({ subjectId, sourceKind: source.kind, sourceId: source.id, status: 'relating', phase: 'relating', sourceHash: source.hash }); emit();
      replaceStudySourceKnowledge({ subjectId, sourceKind: source.kind, sourceId: source.id, sourceTitle: source.title, sourceHash: source.hash,
        ideas: merged.ideas, relations: merged.relations, embeddings: vectors, embeddingProvider: config.provider, embeddingModel: config.model });
      connectStudySourceIdeasSemantically(subjectId, source.kind, source.id);
      setStudyKnowledgeJob({ subjectId, sourceKind: source.kind, sourceId: source.id, status: 'done', phase: 'done', sourceHash: source.hash });
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    for (const subjectId of pendingSubjects) setStudyKnowledgeJob({ subjectId, sourceKind: source.kind, sourceId: source.id, status: 'error', phase: 'error', sourceHash: source.hash, error });
  }
}

async function drain(): Promise<void> {
  if (draining) return; draining = true; emit();
  try {
    while (queue.size) {
      const [key, item] = queue.entries().next().value as [string, QueuedSource]; queue.delete(key);
      try { const source = sourceData(item.kind, item.id); currentTitle = source?.title ?? null; if (source) await analyzeSource(source, item.force, item.externalConsentModelKey); }
      catch { /* Per-source errors are persisted by analyzeSource; deleted sources are simply skipped. */ }
      emit();
    }
  } finally { currentTitle = null; draining = false; emit(); }
}

export function queueStudyKnowledgeSources(kind: StudyKnowledgeSourceKind, ids: string[], force = false, options: QueueOptions = {}): void {
  const autoPreference = getSettings().studyKnowledgeAutoProcess;
  if (kind === 'material' && !options.explicit && !options.approved && autoPreference !== 'always') return;
  for (const id of ids) if (id) {
    const key = `${kind}:${id}`; const prior = queue.get(key);
    // Notes are continuously re-indexed behind the editor's autosave in both Study
    // and Teaching. Showing a native provider warning after ordinary typing makes
    // autosave look like an explicit AI command; the vault has already established
    // that this knowledge layer is AI-backed. Imported files keep their separate,
    // explicit processing decision above.
    const rememberedApproval = kind === 'document' ? '*' : kind === 'material' && autoPreference === 'always' ? '*' : null;
    queue.set(key, { kind, id, force: force || prior?.force === true,
      externalConsentModelKey: options.externalConsentModelKey ?? rememberedApproval ?? prior?.externalConsentModelKey ?? null });
  }
  void drain();
}
export function reanalyzeStudyKnowledgeSource(kind: StudyKnowledgeSourceKind, id: string): void { queueStudyKnowledgeSources(kind, [id], true, { explicit: true }); }

function cosine(a: number[] | null, b: number[] | null): number {
  if (!a || !b) return 0; const length = Math.min(a.length, b.length); let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < length; index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export async function retrieveStudyKnowledgeContext(subjectId: string, query: string, sourceKeys: string[] = [], limit = 10): Promise<StudyAssessmentKnowledgeContext> {
  const prompt = studyKnowledgePromptPack(getSettings().promptLanguage ?? 'es');
  const candidates = listStudyIdeaVectors(subjectId, sourceKeys); if (!candidates.length) return { ideas: [], connections: [], outline: '', embeddingAvailable: false };
  const queryVector = await embedQuery(query).catch(() => null);
  const ranked = candidates.map((idea) => ({ idea, score: queryVector ? cosine(queryVector, idea.embedding) : 0 }))
    .sort((a, b) => queryVector ? b.score - a.score || b.idea.sourceCount - a.idea.sourceCount : b.idea.sourceCount - a.idea.sourceCount)
    .slice(0, limit).map((item) => item.idea);
  const connections = listStudyConnectionsForIdeas(subjectId, ranked.map((idea) => idea.id)).slice(0, 16);
  const label = new Map(ranked.map((idea) => [idea.id, idea.label]));
  const outline = [
    ...ranked.map((idea) => `- [${idea.id}] ${idea.label}: ${idea.statement}`),
    ...connections.map((edge: StudyIdeaConnection) => `- ${prompt.connection}: ${label.get(edge.fromId) ?? edge.fromId} ${edge.type} ${label.get(edge.toId) ?? edge.toId}. ${edge.basis}`),
  ].join('\n');
  return { ideas: ranked.map(({ embedding: _embedding, ...idea }) => idea), connections, outline, embeddingAvailable: Boolean(queryVector) };
}
