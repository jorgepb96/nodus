import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  StudySavedSearch,
  StudySearchHistoryEntry,
  StudySearchIndexEntry,
  StudySearchIndexStatus,
  StudySearchOptions,
  StudySearchProgress,
  StudySearchResponse,
} from '@shared/studySearch';
import { normalizeStudySearchText, rankStudySearchEntries, suggestStudySearchCorrections } from '@shared/studySearch';
import type { StudyAssistantSourceOption } from '@shared/studyAssistant';
import { studyAssistantSourceKey } from '@shared/studyAssistant';
import { parseStudyMaterialMarkers } from '@shared/studyMaterials';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { embedQuery, embedMany } from './aiClient';

type Row = Record<string, unknown>;
type ProgressListener = (progress: StudySearchProgress) => void;

interface StudySearchStore {
  version: 1;
  updatedAt: string;
  modelProvider: string;
  modelName: string;
  entries: StudySearchIndexEntry[];
  excludedSourceIds: string[];
  savedSearches: StudySavedSearch[];
  history: StudySearchHistoryEntry[];
}

const EMPTY_STORE: StudySearchStore = {
  version: 1, updatedAt: '', modelProvider: '', modelName: '', entries: [], excludedSourceIds: [], savedSearches: [], history: [],
};

const runtime = {
  state: 'empty' as StudySearchIndexStatus['state'],
  processedEntries: 0,
  totalEntries: 0,
  currentTitle: null as string | null,
  paused: false,
  stopRequested: false,
  error: null as string | null,
  listeners: new Set<ProgressListener>(),
};

function indexPath(): string { return path.join(activeVaultDir(), 'study-search-index.json'); }
function now(): string { return new Date().toISOString(); }
function hash(value: string): string { return crypto.createHash('sha1').update(value).digest('hex'); }
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } }

function readStore(): StudySearchStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf8')) as Partial<StudySearchStore>;
    return {
      ...EMPTY_STORE, ...parsed, version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      excludedSourceIds: Array.isArray(parsed.excludedSourceIds) ? parsed.excludedSourceIds : [],
      savedSearches: Array.isArray(parsed.savedSearches) ? parsed.savedSearches : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch { return { ...EMPTY_STORE, entries: [], excludedSourceIds: [], savedSearches: [], history: [] }; }
}

function writeStore(store: StudySearchStore): void {
  const target = indexPath(); const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), 'utf8');
  fs.renameSync(temporary, target);
}

function modelConfig(): { provider: string; model: string } {
  const settings = getSettings();
  return { provider: settings.embeddingProvider ?? 'openai', model: settings.embeddingModel ?? '' };
}

/**
 * @param collected Already-gathered corpus entries, when the caller has them.
 *   `collectStudySearchEntries` re-reads every study document, material,
 *   transcript, question and exam from SQLite, re-chunks all their markdown
 *   into 1400-character pieces and SHA1-hashes each one. The indexing loop
 *   emits progress twice per 16-entry batch, so a 2,000-fragment corpus paid
 *   for ~250 full re-collections of data it was already holding — and during
 *   indexing the result is always 0 pending, because the store being reported
 *   contains exactly those entries.
 */
function statusFrom(store = readStore(), collected?: StudySearchIndexEntry[]): StudySearchIndexStatus {
  let pendingEntries = 0;
  try {
    const indexedHashes = new Set(store.entries.map((entry) => entry.contentHash));
    const source = collected ?? collectStudySearchEntries();
    pendingEntries = source.filter((entry) => !indexedHashes.has(entry.contentHash)).length;
  } catch { /* the schema can still be migrating during early startup */ }
  return {
    state: runtime.state === 'indexing' || runtime.state === 'paused' || runtime.state === 'error'
      ? runtime.state : store.entries.length ? 'ready' : 'empty',
    indexedEntries: store.entries.length,
    embeddedEntries: store.entries.filter((entry) => entry.embedding?.length).length,
    excludedSources: store.excludedSourceIds.length,
    pendingEntries,
    modelProvider: store.modelProvider,
    modelName: store.modelName,
    updatedAt: store.updatedAt || null,
    error: runtime.error,
  };
}

function progress(store = readStore(), collected?: StudySearchIndexEntry[]): StudySearchProgress {
  return { ...statusFrom(store, collected), processedEntries: runtime.processedEntries, totalEntries: runtime.totalEntries, currentTitle: runtime.currentTitle };
}

function emit(store?: StudySearchStore, collected?: StudySearchIndexEntry[]): void {
  const snapshot = progress(store, collected);
  for (const listener of runtime.listeners) listener(snapshot);
}

export function onStudySearchProgress(listener: ProgressListener): () => void { runtime.listeners.add(listener); return () => runtime.listeners.delete(listener); }
export function getStudySearchIndexStatus(): StudySearchProgress { return progress(); }
export function pauseStudySearchIndex(): void { if (runtime.state === 'indexing') { runtime.paused = true; runtime.state = 'paused'; emit(); } }
export function resumeStudySearchIndex(): void { if (runtime.state === 'paused') { runtime.paused = false; runtime.state = 'indexing'; emit(); } }
export function stopStudySearchIndex(): void { runtime.stopRequested = true; runtime.paused = false; }

async function waitIfPaused(): Promise<boolean> {
  while (runtime.paused && !runtime.stopRequested) await new Promise((resolve) => setTimeout(resolve, 150));
  return runtime.stopRequested;
}

function nameMaps() {
  const db = getDb();
  const courses = new Map((db.prepare('SELECT id, name FROM study_courses').all() as Row[]).map((row) => [String(row.id), String(row.name)]));
  const subjects = new Map((db.prepare('SELECT id, name FROM study_subjects').all() as Row[]).map((row) => [String(row.id), String(row.name)]));
  const topics = new Map((db.prepare('SELECT id, name FROM study_topics').all() as Row[]).map((row) => [String(row.id), String(row.name)]));
  const folders = new Map((db.prepare('SELECT id, name, parent_id FROM study_folders').all() as Row[]).map((row) => [String(row.id), { name: String(row.name), parentId: row.parent_id ? String(row.parent_id) : null }]));
  return { courses, subjects, topics, folders };
}

function scopeSubtitle(scope: { courseId: string | null; subjectId: string | null; folderId: string | null; topicId: string | null }, maps: ReturnType<typeof nameMaps>): string {
  const folders: string[] = []; const seen = new Set<string>(); let folderId = scope.folderId;
  while (folderId && !seen.has(folderId)) {
    seen.add(folderId); const folder = maps.folders.get(folderId); if (!folder) break;
    folders.unshift(folder.name); folderId = folder.parentId;
  }
  return [scope.courseId ? maps.courses.get(scope.courseId) : '', scope.subjectId ? maps.subjects.get(scope.subjectId) : '', ...folders, scope.topicId ? maps.topics.get(scope.topicId) : ''].filter(Boolean).join(' · ');
}

function textChunks(text: string, size = 1400, overlap = 180): Array<{ text: string; from: number; to: number }> {
  const clean = text.trim(); if (!clean) return [];
  const chunks: Array<{ text: string; from: number; to: number }> = [];
  let from = 0;
  while (from < clean.length) {
    let to = Math.min(clean.length, from + size);
    if (to < clean.length) {
      const boundary = Math.max(clean.lastIndexOf('\n\n', to), clean.lastIndexOf('. ', to));
      if (boundary > from + size * 0.55) to = boundary + 1;
    }
    chunks.push({ text: clean.slice(from, to).trim(), from, to });
    if (to >= clean.length) break;
    from = Math.max(from + 1, to - overlap);
  }
  return chunks.filter((chunk) => chunk.text);
}

function addDocumentEntries(entries: StudySearchIndexEntry[], maps: ReturnType<typeof nameMaps>): void {
  const db = getDb();
  const rows = db.prepare(`SELECT d.*, p.id AS placement_id, p.course_id, p.subject_id, p.folder_id, p.topic_id,
    (SELECT GROUP_CONCAT(t.name, '||') FROM study_doc_tags dt JOIN study_tags t ON t.id=dt.tag_id WHERE dt.document_id=d.id) AS tag_names FROM study_docs d
    LEFT JOIN study_placements p ON p.document_id = d.id AND p.deleted_at IS NULL
    WHERE d.archived_at IS NULL AND d.deleted_at IS NULL ORDER BY d.updated_at DESC, p.position`).all() as Row[];
  for (const row of rows) {
    const sourceId = String(row.id); const title = String(row.title); const content = String(row.content_markdown ?? '');
    const placementKey = row.placement_id ? String(row.placement_id) : 'unplaced';
    const scope = { courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null, folderId: row.folder_id ? String(row.folder_id) : null, topicId: row.topic_id ? String(row.topic_id) : null };
    const tags = String(row.tag_names ?? '').split('||').filter(Boolean);
    for (const [index, chunk] of textChunks(content).entries()) entries.push({
      indexId: `document:${sourceId}:${placementKey}:${index}`, kind: 'document', sourceId, title, text: chunk.text,
      subtitle: scopeSubtitle(scope, maps), tags, scope, location: { documentId: sourceId, from: chunk.from, to: chunk.to },
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), contentHash: hash(`study-document-fragment-v2\0${title}\0${chunk.text}`), embedding: null, excluded: false,
    });
  }
}

function materialLocations(text: string): Array<{ text: string; from: number; to: number; pageNumber?: number; slideNumber?: number }> {
  const markers = parseStudyMaterialMarkers(text);
  if (!markers.length) return textChunks(text);
  return markers.map((marker, index) => ({
    text: text.slice(marker.from, markers[index + 1]?.from ?? text.length).replace(/^\[\[[^\]]+\]\]\s*/, '').trim(),
    from: marker.from, to: markers[index + 1]?.from ?? text.length,
    ...(marker.kind === 'page' ? { pageNumber: marker.number } : { slideNumber: marker.number }),
  })).filter((chunk) => chunk.text);
}

function addMaterialEntries(entries: StudySearchIndexEntry[], maps: ReturnType<typeof nameMaps>): void {
  const rows = getDb().prepare(`SELECT m.*, p.id AS placement_id, p.course_id, p.subject_id, p.folder_id, p.topic_id FROM study_materials m
    LEFT JOIN study_material_placements p ON p.material_id = m.id AND p.deleted_at IS NULL
    WHERE m.archived_at IS NULL AND m.deleted_at IS NULL ORDER BY m.updated_at DESC, p.position`).all() as Row[];
  for (const row of rows) {
    const text = [String(row.visual_description ?? ''), String(row.extracted_text ?? '')].filter((part) => part.trim()).join('\n\n'); if (!text.trim()) continue;
    const sourceId = String(row.id); const title = String(row.title);
    const placementKey = row.placement_id ? String(row.placement_id) : 'unplaced';
    const scope = { courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null, folderId: row.folder_id ? String(row.folder_id) : null, topicId: row.topic_id ? String(row.topic_id) : null };
    const metadata = parseJson<{ tags?: string[] }>(row.metadata_json, {}); const tags = metadata.tags?.filter(Boolean) ?? [];
    const chunks = materialLocations(text).flatMap((located) => textChunks(located.text).map((chunk) => ({ ...chunk, from: located.from + chunk.from, to: located.from + chunk.to, pageNumber: located.pageNumber, slideNumber: located.slideNumber })));
    for (const [index, chunk] of chunks.entries()) entries.push({
      indexId: `material:${sourceId}:${placementKey}:${index}`, kind: 'material', sourceId, title, text: chunk.text,
      subtitle: scopeSubtitle(scope, maps), tags, scope,
      location: { materialId: sourceId, pageNumber: chunk.pageNumber, slideNumber: chunk.slideNumber, from: chunk.from, to: chunk.to },
      // A material-level vector cannot represent every page of a long source. The
      // v2 hash deliberately invalidates legacy cache entries that copied that one
      // vector onto every chunk; rebuildStudySearchIndex now embeds each fragment.
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), contentHash: hash(`study-fragment-v2\0${title}\0${chunk.text}`), embedding: null, excluded: false,
    });
  }
}

function addTranscriptEntries(entries: StudySearchIndexEntry[], maps: ReturnType<typeof nameMaps>): void {
  const rows = getDb().prepare(`SELECT s.*, t.recording_id, t.kind, t.updated_at AS transcript_updated_at,
    r.title, r.course_id, r.subject_id, r.topic_id, r.created_at AS recording_created_at
    FROM study_transcript_segments s JOIN study_transcripts t ON t.id = s.transcript_id
    JOIN study_recordings r ON r.id = t.recording_id
    WHERE r.archived_at IS NULL AND r.deleted_at IS NULL AND t.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM study_transcripts newer WHERE newer.recording_id = t.recording_id AND newer.kind = t.kind AND newer.version_no > t.version_no)
    ORDER BY r.updated_at DESC, s.t_start`).all() as Row[];
  for (const row of rows) {
    const sourceId = String(row.transcript_id); const recordingId = String(row.recording_id); const title = String(row.title);
    const scope = { courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null, folderId: null, topicId: row.topic_id ? String(row.topic_id) : null };
    const text = String(row.text ?? '');
    entries.push({
      indexId: `transcript:${sourceId}:${row.id}`, kind: 'transcript', sourceId, title, text,
      subtitle: [scopeSubtitle(scope, maps), String(row.kind)].filter(Boolean).join(' · '), tags: [], scope,
      location: { recordingId, transcriptId: sourceId, segmentId: String(row.id), timestampSeconds: Number(row.t_start ?? 0) },
      createdAt: String(row.recording_created_at), updatedAt: String(row.transcript_updated_at), contentHash: hash(`${title}\0${text}`), embedding: null, excluded: false,
    });
  }
}

function addQuestionEntries(entries: StudySearchIndexEntry[], maps: ReturnType<typeof nameMaps>): void {
  const rows = getDb().prepare(`SELECT * FROM study_questions WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC`).all() as Row[];
  for (const row of rows) {
    const sourceId = String(row.id); const title = String(row.prompt); const scope = { courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null, folderId: row.folder_id ? String(row.folder_id) : null, topicId: row.topic_id ? String(row.topic_id) : null };
    const answer = parseJson<{ text?: string; value?: unknown }>(row.answer_json, {}); const options = parseJson<Array<{ text?: string }>>(row.options_json, []);
    const text = [title, answer.text ?? String(answer.value ?? ''), String(row.explanation ?? ''), String(row.source_excerpt ?? ''), ...options.map((option) => option.text ?? '')].filter(Boolean).join('\n');
    entries.push({
      indexId: `question:${sourceId}`, kind: 'question', sourceId, title, text,
      subtitle: [scopeSubtitle(scope, maps), String(row.question_type), String(row.difficulty)].filter(Boolean).join(' · '),
      tags: parseJson(row.tags_json, []), scope, location: {}, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      contentHash: hash(`${title}\0${text}`), embedding: null, excluded: false,
    });
  }
}

function addExamEntries(entries: StudySearchIndexEntry[], maps: ReturnType<typeof nameMaps>): void {
  const rows = getDb().prepare(`SELECT a.*, GROUP_CONCAT(q.prompt, '\n') AS prompts FROM study_assessments a
    LEFT JOIN study_assessment_items i ON i.assessment_id=a.id LEFT JOIN study_questions q ON q.id=i.question_id
    WHERE a.kind='exam' AND a.archived_at IS NULL AND a.deleted_at IS NULL GROUP BY a.id ORDER BY a.updated_at DESC`).all() as Row[];
  for (const row of rows) {
    const sourceId = String(row.id); const title = String(row.title); const scope = { courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null, folderId: null, topicId: row.topic_id ? String(row.topic_id) : null };
    const text = [title, String(row.description ?? ''), String(row.prompts ?? '')].filter(Boolean).join('\n');
    entries.push({ indexId: `exam:${sourceId}`, kind: 'exam', sourceId, title, text, subtitle: scopeSubtitle(scope, maps), tags: [], scope, location: {}, createdAt: String(row.created_at), updatedAt: String(row.updated_at), contentHash: hash(`${title}\0${text}`), embedding: null, excluded: false });
  }
}

export function collectStudySearchEntries(): StudySearchIndexEntry[] {
  const entries: StudySearchIndexEntry[] = []; const maps = nameMaps();
  addDocumentEntries(entries, maps); addMaterialEntries(entries, maps); addTranscriptEntries(entries, maps); addQuestionEntries(entries, maps); addExamEntries(entries, maps);
  return entries;
}

/** Lightweight source catalogue for the assistant's manual context picker. */
export function listStudyAssistantSourceOptions(): StudyAssistantSourceOption[] {
  const store = ensureLexicalIndex();
  const entries = store.entries.filter((entry) => !entry.excluded);
  const grouped = new Map<string, StudyAssistantSourceOption>();
  const fragments = new Set<string>();
  for (const entry of entries) {
    const sourceKey = studyAssistantSourceKey(entry.kind, entry.sourceId);
    const fragmentKey = assistantFragmentKey(entry);
    const newFragment = !fragments.has(fragmentKey);
    fragments.add(fragmentKey);
    const current = grouped.get(sourceKey);
    if (current) {
      if (newFragment) current.chunks += 1;
      if (!current.placements!.some((p) => JSON.stringify(p) === JSON.stringify({ ...entry.scope, id: null }))) current.placements!.push({ ...entry.scope, id: null });
      if (entry.updatedAt > current.updatedAt) current.updatedAt = entry.updatedAt;
      continue;
    }
    grouped.set(sourceKey, {
      sourceKey, kind: entry.kind, sourceId: entry.sourceId, title: entry.title, subtitle: entry.subtitle,
      scope: entry.scope, chunks: 1, updatedAt: entry.updatedAt, placements: [{ ...entry.scope, id: null }], tags: entry.tags, available: true,
    });
  }
  // Read material organization independently from the index: empty/unsupported
  // materials still belong in the picker, with an honest unavailable state.
  const placements = new Map<string, NonNullable<StudyAssistantSourceOption['placements']>>();
  for (const row of getDb().prepare('SELECT * FROM study_material_placements WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY position, id').all() as Row[]) {
    const id = String(row.material_id);
    const list = placements.get(id) ?? [];
    list.push({ id: String(row.id), courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null,
      folderId: row.folder_id ? String(row.folder_id) : null, topicId: row.topic_id ? String(row.topic_id) : null });
    placements.set(id, list);
  }
  const maps = nameMaps();
  const excluded = new Set(store.excludedSourceIds);
  for (const row of getDb().prepare('SELECT id, title, file_name, metadata_json, index_status, updated_at FROM study_materials WHERE deleted_at IS NULL AND archived_at IS NULL').all() as Row[]) {
    const sourceId = String(row.id); const sourceKey = studyAssistantSourceKey('material', sourceId);
    const prior = grouped.get(sourceKey);
    const locations = placements.get(sourceId) ?? [];
    const scope = locations[0] ?? { courseId: null, subjectId: null, folderId: null, topicId: null };
    grouped.set(sourceKey, { sourceKey, sourceId, kind: 'material', title: String(row.title), subtitle: scopeSubtitle(scope, maps), scope,
      chunks: prior?.chunks ?? 0, updatedAt: String(row.updated_at), placements: locations,
      fileName: String(row.file_name), tags: parseJson<{ tags?: string[] }>(row.metadata_json, {}).tags ?? [],
      available: Boolean(prior?.chunks) && !excluded.has(sourceId),
      unavailableReason: excluded.has(sourceId) ? 'excluded' : prior?.chunks ? undefined : 'no_content',
      indexStatus: String(row.index_status) as StudyAssistantSourceOption['indexStatus'] });
  }
  return [...grouped.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

/** The same passage can be indexed under several placements. Keep page/location
 * in the identity so repeated text on different pages remains distinct evidence. */
function assistantFragmentKey(entry: StudySearchIndexEntry): string {
  return JSON.stringify([entry.kind, entry.sourceId, entry.location, entry.contentHash]);
}

function matchesAssistantRetrievalOptions(entry: StudySearchIndexEntry, options: StudySearchOptions): boolean {
  if (options.kinds?.length && !options.kinds.includes(entry.kind)) return false;
  if (options.courseId && entry.scope.courseId !== options.courseId) return false;
  if (options.subjectId && entry.scope.subjectId !== options.subjectId) return false;
  if (options.folderId && entry.scope.folderId !== options.folderId) return false;
  if (options.topicId && entry.scope.topicId !== options.topicId) return false;
  if (options.sourceId && entry.sourceId !== options.sourceId) return false;
  if (options.tags?.length && !options.tags.every((tag) => entry.tags.some((entryTag) => normalizeStudySearchText(entryTag) === normalizeStudySearchText(tag)))) return false;
  if (options.dateFrom && entry.updatedAt < options.dateFrom) return false;
  if (options.dateTo && entry.updatedAt > `${options.dateTo}T23:59:59.999Z`) return false;
  return true;
}

/** Hybrid retrieval without polluting the user's search history. Manual source
 * selection is strict: only selected source keys can enter the returned context. */
export async function retrieveStudyAssistantEntries(
  query: string,
  options: StudySearchOptions,
  sourceKeys: string[] = [],
  limit = 18,
): Promise<StudySearchIndexEntry[]> {
  const store = ensureLexicalIndex();
  const selected = new Set(sourceKeys);
  const seenFragments = new Set<string>();
  const candidates = store.entries.filter((entry) => !entry.excluded
    && (!selected.size || selected.has(studyAssistantSourceKey(entry.kind, entry.sourceId)))
    && matchesAssistantRetrievalOptions(entry, options)).filter((entry) => {
      const key = assistantFragmentKey(entry);
      if (seenFragments.has(key)) return false;
      seenFragments.add(key); return true;
    });
  const hasVectors = candidates.some((entry) => entry.embedding?.length);
  const queryVector = hasVectors ? await embedQuery(query).catch(() => null) : null;
  const ranked = rankStudySearchEntries(query, candidates, { ...options, limit: Math.max(limit * 3, 60) }, queryVector);
  const byId = new Map(candidates.map((entry) => [entry.indexId, entry]));
  const ordered = ranked.map((result) => byId.get(result.indexId)).filter((entry): entry is StudySearchIndexEntry => Boolean(entry));
  // Manual selection means "use these sources", even when the wording of the
  // question has no literal overlap. The same fallback is necessary for automatic
  // scopes when embeddings are unavailable: otherwise a Spanish question against
  // an English vault (or any other cross-language pair) always returns zero context.
  if ((selected.size || !queryVector) && ordered.length < limit) {
    const rankedIds = new Set(ordered.map((entry) => entry.indexId));
    const fallbackCandidates = candidates
      .filter((entry) => !rankedIds.has(entry.indexId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Prefer breadth before adding a second fragment from the same source. This
    // gives the model useful coverage of a library rather than twenty adjacent
    // chunks from whichever document was edited most recently.
    const seenSources = new Set(ordered.map((entry) => studyAssistantSourceKey(entry.kind, entry.sourceId)));
    const diverse: StudySearchIndexEntry[] = [];
    const repeated: StudySearchIndexEntry[] = [];
    for (const entry of fallbackCandidates) {
      const sourceKey = studyAssistantSourceKey(entry.kind, entry.sourceId);
      if (seenSources.has(sourceKey)) repeated.push(entry);
      else { seenSources.add(sourceKey); diverse.push(entry); }
    }
    ordered.push(...diverse, ...repeated);
  }
  return ordered.slice(0, limit);
}

export async function rebuildStudySearchIndex(): Promise<StudySearchProgress> {
  if (runtime.state === 'indexing' || runtime.state === 'paused') return progress();
  runtime.state = 'indexing'; runtime.error = null; runtime.paused = false; runtime.stopRequested = false; runtime.processedEntries = 0; runtime.currentTitle = null;
  const old = readStore(); const config = modelConfig();
  try {
    const entries = collectStudySearchEntries(); runtime.totalEntries = entries.length;
    const oldByHash = new Map(old.modelProvider === config.provider && old.modelName === config.model
      ? old.entries.filter((entry) => entry.embedding?.length).map((entry) => [entry.contentHash, entry.embedding]) : []);
    const excluded = new Set(old.excludedSourceIds);
    for (const entry of entries) { entry.embedding = oldByHash.get(entry.contentHash) ?? entry.embedding ?? null; entry.excluded = excluded.has(entry.sourceId); }
    emit({ ...old, entries }, entries);
    const pending = entries.filter((entry) => !entry.excluded && !entry.embedding?.length);
    for (let offset = 0; offset < pending.length; offset += 16) {
      if (runtime.stopRequested || await waitIfPaused()) break;
      const batch = pending.slice(offset, offset + 16); runtime.currentTitle = batch[0]?.title ?? null; emit({ ...old, entries }, entries);
      const vectors = await embedMany(batch.map((entry) => `${entry.title}\n${entry.text}`));
      batch.forEach((entry, index) => { entry.embedding = vectors[index] ?? null; runtime.processedEntries++; });
      emit({ ...old, entries }, entries);
    }
    const store: StudySearchStore = {
      ...old, updatedAt: now(), modelProvider: config.provider, modelName: config.model, entries,
      excludedSourceIds: [...excluded],
    };
    writeStore(store); runtime.state = entries.length ? 'ready' : 'empty'; runtime.currentTitle = null; emit(store, entries);
    return progress(store, entries);
  } catch (cause) {
    runtime.error = cause instanceof Error ? cause.message : String(cause); runtime.state = 'error'; emit(); return progress();
  } finally { runtime.paused = false; runtime.stopRequested = false; }
}

let queuedRefresh = false;
let refreshTask: Promise<void> | null = null;

/** Incremental, de-duplicated refresh used after source changes. Existing vectors
 * are retained by content hash and only new or changed fragments are embedded. */
export function queueStudySearchIndexRefresh(): void {
  queuedRefresh = true;
  if (refreshTask) return;
  refreshTask = (async () => {
    while (queuedRefresh) {
      queuedRefresh = false;
      await rebuildStudySearchIndex();
    }
  })().finally(() => { refreshTask = null; if (queuedRefresh) queueStudySearchIndexRefresh(); });
}

function ensureLexicalIndex(): StudySearchStore {
  const store = readStore();
  const config = modelConfig();
  const collected = collectStudySearchEntries();
  const oldByHash = new Map(store.entries.map((entry) => [entry.contentHash, entry]));
  const excluded = new Set(store.excludedSourceIds);
  const entries = collected.map((entry) => {
    const old = oldByHash.get(entry.contentHash);
    return { ...entry, embedding: old?.embedding ?? entry.embedding ?? null, excluded: excluded.has(entry.sourceId) };
  });
  const unchanged = entries.length === store.entries.length && entries.every((entry, index) => {
    const old = store.entries[index];
    return old && entry.contentHash === old.contentHash && entry.excluded === old.excluded && entry.indexId === old.indexId
      && entry.updatedAt === old.updatedAt && entry.subtitle === old.subtitle
      && JSON.stringify(entry.scope) === JSON.stringify(old.scope) && JSON.stringify(entry.tags) === JSON.stringify(old.tags)
      && JSON.stringify(entry.location) === JSON.stringify(old.location);
  });
  if (unchanged) return store;
  const next = { ...store, updatedAt: now(), modelProvider: store.modelProvider || config.provider, modelName: store.modelName || config.model, entries };
  writeStore(next); return next;
}

export async function searchStudyCorpus(query: string, options: StudySearchOptions = {}): Promise<StudySearchResponse> {
  const started = performance.now(); const clean = query.trim();
  if (clean.length < 2) return { results: [], semanticAvailable: false, correctedQuery: null, suggestions: [], elapsedMs: 0 };
  const store = ensureLexicalIndex();
  const hasVectors = store.entries.some((entry) => entry.embedding?.length);
  const queryVector = hasVectors ? await embedQuery(clean).catch(() => null) : null;
  const results = rankStudySearchEntries(clean, store.entries, options, queryVector);
  const suggestions = results.length < 5 ? suggestStudySearchCorrections(clean, store.entries) : [];
  const correctedQuery = suggestions.length && clean.split(/\s+/).length === 1 ? suggestions[0] : null;
  const entry: StudySearchHistoryEntry = { id: crypto.randomUUID(), query: clean, options, resultCount: results.length, createdAt: now() };
  store.history = [entry, ...store.history.filter((item) => item.query !== clean)].slice(0, 100); writeStore(store);
  return { results, semanticAvailable: Boolean(queryVector), correctedQuery, suggestions, elapsedMs: performance.now() - started };
}

export function listStudySavedSearches(): StudySavedSearch[] { return readStore().savedSearches; }
export function saveStudySearch(name: string, query: string, options: StudySearchOptions): StudySavedSearch {
  const store = readStore(); const timestamp = now();
  const saved: StudySavedSearch = { id: crypto.randomUUID(), name: name.trim() || query.trim(), query: query.trim(), options, createdAt: timestamp, updatedAt: timestamp };
  store.savedSearches.unshift(saved); writeStore(store); return saved;
}
export function deleteStudySavedSearch(id: string): void { const store = readStore(); store.savedSearches = store.savedSearches.filter((entry) => entry.id !== id); writeStore(store); }
export function listStudySearchHistory(): StudySearchHistoryEntry[] { return readStore().history; }
export function clearStudySearchHistory(): void { const store = readStore(); store.history = []; writeStore(store); }
export function setStudySearchSourceExcluded(sourceId: string, excluded: boolean): StudySearchIndexStatus {
  const store = readStore(); const ids = new Set(store.excludedSourceIds); if (excluded) ids.add(sourceId); else ids.delete(sourceId);
  store.excludedSourceIds = [...ids]; store.entries = store.entries.map((entry) => entry.sourceId === sourceId ? { ...entry, excluded } : entry); writeStore(store); return statusFrom(store);
}
export function deleteStudySearchIndex(): void { try { fs.unlinkSync(indexPath()); } catch { /* already absent */ } runtime.state = 'empty'; runtime.error = null; emit(); }
