/**
 * Main-process side of local narration. Synthesis itself runs in the renderer
 * (Piper via WebAssembly / onnxruntime-web, which sidesteps Electron's V8 memory
 * cage that blocks native TTS addons). The main process owns the two things that
 * must live here: turning a saved Deep Research report or an immersion into
 * per-segment speakable text, and persisting the WAV bytes the renderer produces
 * as clip files in the vault's audio directory (included by full backups, omitted
 * by lightweight sync packages) with compact metadata in SQLite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AudioClip,
  AudioEntityKind,
  AudioProvider,
  AudioSegment,
  AudioSegmentRequest,
  StudyAudioBookmark,
  StudyAudioPlaylistItem,
  StudyPronunciationEntry,
} from '@shared/types';
import { getDb } from '../db/database';
import { relabelCitations } from '../citations/liveCitations';
import { deepResearchSegments, immersionSegments, studyNarrationSegments } from './speakable';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { audioDir, audioFilePath } from './audioPaths';
import {
  deleteAudioClipRow,
  deleteAudioClipsForEntity,
  insertAudioClip,
  listAudioClips,
  getAudioClip,
} from '../db/audioClipsRepo';

// ── Segmentation ─────────────────────────────────────────────────────────────

/** Build the ordered list of speakable segments for an entity (read by the
 *  renderer, which then synthesises each and posts the audio back to be saved). */
export function getEntitySegments(kind: AudioEntityKind, id: string, request: AudioSegmentRequest = {}): AudioSegment[] {
  if (isStudyAudioKind(kind)) {
    const source = request.markdown != null ? { title: request.title ?? '', markdown: request.markdown } : studyAudioSource(kind, id);
    return studyNarrationSegments(source.markdown, { ...request, title: request.title || source.title });
  }
  if (kind === 'deep_research') {
    const row = getDb().prepare('SELECT title, draft_json FROM writing_saved_drafts WHERE id = ?').get(id) as
      | { title: string; draft_json: string }
      | undefined;
    if (!row) throw new Error('El informe guardado ya no existe.');
    let draft: { title?: string; abstract?: string; draftMarkdown?: string } = {};
    try {
      draft = JSON.parse(row.draft_json);
    } catch {
      /* fall back to the row title only */
    }
    // Narration reads this report aloud, so it must speak the names the report
    // would show today, not the ones frozen into it when it was generated.
    return deepResearchSegments({
      title: draft.title || row.title,
      abstract: draft.abstract,
      draftMarkdown: relabelCitations(draft.draftMarkdown ?? ''),
    });
  }
  const row = getDb().prepare('SELECT title, topic, plan_json FROM immersion_sessions WHERE id = ?').get(id) as
    | { title: string; topic: string; plan_json: string }
    | undefined;
  if (!row) throw new Error('La inmersión ya no existe.');
  let plan: { overview?: string; stations?: unknown[]; title?: string; topic?: string } = {};
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    /* fall back to title/topic */
  }
  return immersionSegments({
    title: plan.title || row.title,
    topic: plan.topic || row.topic,
    overview: plan.overview,
    stations: (plan.stations as never[]) ?? [],
  });
}

function isStudyAudioKind(kind: AudioEntityKind): boolean { return kind.startsWith('study_'); }

function studyAudioSource(kind: AudioEntityKind, id: string): { title: string; markdown: string } {
  const db = getDb();
  if (kind === 'study_document') {
    const row = db.prepare('SELECT title, content_markdown FROM study_docs WHERE id = ? AND deleted_at IS NULL').get(id) as { title: string; content_markdown: string } | undefined;
    if (!row) throw new Error('El apunte ya no existe.');
    return { title: row.title, markdown: row.content_markdown };
  }
  if (kind === 'study_transcript') {
    const row = db.prepare(`SELECT r.title, t.content_markdown FROM study_transcripts t JOIN study_recordings r ON r.id = t.recording_id WHERE t.id = ?`).get(id) as { title: string; content_markdown: string } | undefined;
    if (!row) throw new Error('La transcripción ya no existe.');
    return { title: row.title, markdown: row.content_markdown };
  }
  if (kind === 'study_subject') {
    const subject = db.prepare('SELECT name FROM study_subjects WHERE id = ?').get(id) as { name: string } | undefined;
    if (!subject) throw new Error('La asignatura ya no existe.');
    const rows = db.prepare(`SELECT d.title, d.content_markdown FROM study_docs d JOIN study_placements p ON p.document_id = d.id
      WHERE p.subject_id = ? AND p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.archived_at IS NULL ORDER BY d.position, d.updated_at`).all(id) as Array<{ title: string; content_markdown: string }>;
    return { title: subject.name, markdown: rows.map((row) => `## ${row.title}\n\n${row.content_markdown}`).join('\n\n') };
  }
  if (kind === 'study_assistant') {
    try {
      const store = JSON.parse(fs.readFileSync(path.join(activeVaultDir(), 'study-chat-history.json'), 'utf8')) as { conversations?: Array<{ messages?: Array<{ id: string; content: string }> }> };
      const found = store.conversations?.flatMap((conversation) => conversation.messages ?? []).find((message) => message.id === id);
      if (found) return { title: 'Respuesta del asistente', markdown: found.content };
    } catch { /* history may not exist yet */ }
    throw new Error('La respuesta del asistente ya no existe.');
  }
  throw new Error('Este contenido de estudio todavía no tiene texto narrable.');
}

interface StudyAudioStore {
  version: 1;
  clips: AudioClip[];
  bookmarks: StudyAudioBookmark[];
  pronunciations: Record<string, StudyPronunciationEntry[]>;
}

const EMPTY_STUDY_AUDIO: StudyAudioStore = { version: 1, clips: [], bookmarks: [], pronunciations: {} };
function studyAudioStorePath(): string { return path.join(activeVaultDir(), 'study-audio-meta.json'); }
function readStudyAudioStore(): StudyAudioStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(studyAudioStorePath(), 'utf8')) as Partial<StudyAudioStore>;
    return { version: 1, clips: Array.isArray(parsed.clips) ? parsed.clips : [], bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [], pronunciations: parsed.pronunciations && typeof parsed.pronunciations === 'object' ? parsed.pronunciations : {} };
  } catch { return { ...EMPTY_STUDY_AUDIO, clips: [], bookmarks: [], pronunciations: {} }; }
}
function writeStudyAudioStore(store: StudyAudioStore): void {
  const target = studyAudioStorePath(); const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(temporary, JSON.stringify(store), 'utf8'); fs.renameSync(temporary, target);
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface SaveClipInput {
  segmentIndex: number;
  segmentLabel: string;
  provider: AudioProvider;
  voice: string;
  language: string;
  /** WAV bytes produced by the renderer. */
  bytes: Uint8Array;
}

/** Persist one generated segment as a WAV file plus a metadata row, returning the clip. */
export function saveClip(kind: AudioEntityKind, id: string, input: SaveClipInput): AudioClip {
  const dir = audioDir();
  const fileName = `${kind}_${id}_${String(input.segmentIndex).padStart(3, '0')}_${randomUUID().slice(0, 8)}.wav`;
  const buffer = Buffer.from(input.bytes);
  fs.writeFileSync(path.join(dir, fileName), buffer);
  const meta = parseWavMeta(buffer);
  const clip: AudioClip = {
    id: randomUUID(),
    entityKind: kind,
    entityId: id,
    segmentIndex: input.segmentIndex,
    segmentLabel: input.segmentLabel,
    provider: input.provider,
    voice: input.voice,
    language: input.language,
    fileName,
    bytes: buffer.length,
    durationSec: meta.durationSec,
    sampleRate: meta.sampleRate,
    createdAt: new Date().toISOString(),
    missing: false,
  };
  if (isStudyAudioKind(kind)) {
    const store = readStudyAudioStore(); store.clips.push(clip); writeStudyAudioStore(store);
  } else insertAudioClip(clip);
  return clip;
}

/** Minimal WAV (PCM) header parse for duration + sample rate. Returns zeros on a
 *  malformed header so a clip is still saved (duration just shows as 0:00). */
function parseWavMeta(buf: Buffer): { durationSec: number; sampleRate: number } {
  try {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return { durationSec: 0, sampleRate: 0 };
    const sampleRate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28);
    // Walk chunks to find 'data' (there may be a LIST/fact chunk before it).
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        const durationSec = byteRate > 0 ? chunkSize / byteRate : 0;
        return { durationSec, sampleRate };
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return { durationSec: 0, sampleRate };
  } catch {
    return { durationSec: 0, sampleRate: 0 };
  }
}

// ── Reads / deletes ──────────────────────────────────────────────────────────

export function clearEntityClips(kind: AudioEntityKind, id: string): void {
  if (isStudyAudioKind(kind)) {
    const store = readStudyAudioStore();
    const removed = store.clips.filter((clip) => clip.entityKind === kind && clip.entityId === id);
    store.clips = store.clips.filter((clip) => clip.entityKind !== kind || clip.entityId !== id); writeStudyAudioStore(store);
    removed.forEach((clip) => removeFile(clip.fileName)); return;
  }
  for (const fileName of deleteAudioClipsForEntity(kind, id)) removeFile(fileName);
}

export function listEntityClips(kind: AudioEntityKind, id: string): AudioClip[] {
  if (isStudyAudioKind(kind)) return readStudyAudioStore().clips
    .filter((clip) => clip.entityKind === kind && clip.entityId === id)
    .map((clip) => ({ ...clip, missing: !fs.existsSync(audioFilePath(clip.fileName)) }))
    .sort((a, b) => a.segmentIndex - b.segmentIndex || a.createdAt.localeCompare(b.createdAt));
  return listAudioClips(kind, id);
}

export function deleteClip(id: string): void {
  const store = readStudyAudioStore(); const study = store.clips.find((clip) => clip.id === id);
  if (study) { store.clips = store.clips.filter((clip) => clip.id !== id); writeStudyAudioStore(store); removeFile(study.fileName); return; }
  const fileName = deleteAudioClipRow(id);
  if (fileName) removeFile(fileName);
}

export function deleteEntityClips(kind: AudioEntityKind, id: string): void {
  clearEntityClips(kind, id);
}

/** Raw bytes for playback in the renderer (served as a data URL). */
export function readClipBytes(id: string): { bytes: Buffer; mime: string } | null {
  const study = readStudyAudioStore().clips.find((clip) => clip.id === id);
  const row = study ? { file_name: study.fileName } : getDb().prepare('SELECT file_name FROM audio_clips WHERE id = ?').get(id) as
    | { file_name: string }
    | undefined;
  if (!row) return null;
  const full = audioFilePath(row.file_name);
  if (!fs.existsSync(full)) return null;
  return { bytes: fs.readFileSync(full), mime: 'audio/wav' };
}

export function audioClipPath(id: string): string | null {
  const study = readStudyAudioStore().clips.find((clip) => clip.id === id);
  const row = study ? { file_name: study.fileName } : getDb().prepare('SELECT file_name FROM audio_clips WHERE id = ?').get(id) as { file_name: string } | undefined;
  if (!row) return null; const full = audioFilePath(row.file_name); return fs.existsSync(full) ? full : null;
}

/** Resolve only a clip registered in the currently owned vault. */
export function registeredAudioClip(id: string): AudioClip | null {
  return readStudyAudioStore().clips.find(clip => clip.id === id) ?? getAudioClip(id);
}

export function listStudyAudioBookmarks(kind: AudioEntityKind, id: string): StudyAudioBookmark[] {
  return readStudyAudioStore().bookmarks.filter((bookmark) => bookmark.entityKind === kind && bookmark.entityId === id).sort((a, b) => a.segmentIndex - b.segmentIndex);
}

export function createStudyAudioBookmark(kind: AudioEntityKind, id: string, segmentIndex: number, label: string): StudyAudioBookmark {
  const bookmark: StudyAudioBookmark = { id: randomUUID(), entityKind: kind, entityId: id, segmentIndex, label: label.trim() || `Marca ${segmentIndex + 1}`, createdAt: new Date().toISOString() };
  const store = readStudyAudioStore(); store.bookmarks.push(bookmark); writeStudyAudioStore(store); return bookmark;
}

export function deleteStudyAudioBookmark(id: string): void {
  const store = readStudyAudioStore(); store.bookmarks = store.bookmarks.filter((bookmark) => bookmark.id !== id); writeStudyAudioStore(store);
}

export function getStudyPronunciations(subjectId: string): StudyPronunciationEntry[] { return readStudyAudioStore().pronunciations[subjectId] ?? []; }
export function setStudyPronunciations(subjectId: string, entries: StudyPronunciationEntry[]): StudyPronunciationEntry[] {
  const store = readStudyAudioStore();
  store.pronunciations[subjectId] = entries.map((entry) => ({ written: entry.written.trim(), spoken: entry.spoken.trim() })).filter((entry) => entry.written && entry.spoken).slice(0, 500);
  writeStudyAudioStore(store); return store.pronunciations[subjectId];
}

export function listStudyAudioPlaylist(subjectId: string): StudyAudioPlaylistItem[] {
  const rows = getDb().prepare(`SELECT DISTINCT d.id, d.title, d.updated_at FROM study_docs d JOIN study_placements p ON p.document_id = d.id
    WHERE p.subject_id = ? AND p.deleted_at IS NULL AND d.deleted_at IS NULL ORDER BY d.updated_at DESC`).all(subjectId) as Array<{ id: string; title: string; updated_at: string }>;
  const clips = readStudyAudioStore().clips;
  return rows.map((row) => {
    const entityClips = clips.filter((clip) => clip.entityKind === 'study_document' && clip.entityId === row.id);
    return { entityId: row.id, title: row.title, subjectId, clipCount: entityClips.length, durationSec: entityClips.reduce((sum, clip) => sum + clip.durationSec, 0), updatedAt: row.updated_at };
  }).filter((item) => item.clipCount > 0);
}

function removeFile(fileName: string): void {
  try {
    fs.rmSync(audioFilePath(fileName), { force: true });
  } catch {
    /* best effort */
  }
}
