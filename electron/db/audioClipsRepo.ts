import { getDb } from './database';
import type { AudioClip, AudioEntityKind } from '@shared/types';
import { audioFileExists } from '../audio/audioPaths';

interface AudioClipRow {
  id: string;
  entity_kind: AudioEntityKind;
  entity_id: string;
  segment_index: number;
  segment_label: string;
  provider: string;
  voice: string;
  language: string;
  file_name: string;
  bytes: number;
  duration_sec: number;
  sample_rate: number;
  created_at: string;
  model_id?: string;
  pinned?: number;
}

function toClip(row: AudioClipRow): AudioClip {
  return {
    id: row.id,
    entityKind: row.entity_kind,
    entityId: row.entity_id,
    segmentIndex: row.segment_index,
    segmentLabel: row.segment_label,
    provider: (['ming', 'kokoro', 'hume', 'piper'] as const).find((provider) => provider === row.provider) ?? 'piper',
    voice: row.voice,
    language: row.language,
    fileName: row.file_name,
    bytes: row.bytes,
    durationSec: row.duration_sec,
    sampleRate: row.sample_rate,
    createdAt: row.created_at,
    // A row can outlive its file (restore from backup / sync never carries audio).
    missing: !audioFileExists(row.file_name),
    pinned: row.pinned === 1,
    modelId: row.model_id ?? '',
  };
}

export function listAudioClips(entityKind: AudioEntityKind, entityId: string): AudioClip[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM audio_clips WHERE entity_kind = ? AND entity_id = ? ORDER BY segment_index ASC, created_at ASC'
    )
    .all(entityKind, entityId) as AudioClipRow[];
  return rows.map(toClip);
}

export function getAudioClip(id: string): AudioClip | null {
  const row = getDb().prepare('SELECT * FROM audio_clips WHERE id = ?').get(id) as AudioClipRow | undefined;
  return row ? toClip(row) : null;
}

export function insertAudioClip(clip: AudioClip): void {
  getDb()
    .prepare(
      `INSERT INTO audio_clips
       (id, entity_kind, entity_id, segment_index, segment_label, provider, voice, language, file_name, bytes, duration_sec, sample_rate, created_at, model_id, pinned)
       VALUES (@id, @entity_kind, @entity_id, @segment_index, @segment_label, @provider, @voice, @language, @file_name, @bytes, @duration_sec, @sample_rate, @created_at, @model_id, @pinned)`
    )
    .run({
      id: clip.id,
      entity_kind: clip.entityKind,
      entity_id: clip.entityId,
      segment_index: clip.segmentIndex,
      segment_label: clip.segmentLabel,
      provider: clip.provider,
      voice: clip.voice,
      language: clip.language,
      file_name: clip.fileName,
      bytes: clip.bytes,
      duration_sec: clip.durationSec,
      sample_rate: clip.sampleRate,
      created_at: clip.createdAt,
      model_id: clip.modelId ?? '',
      pinned: clip.pinned ? 1 : 0,
    });
}

/** Remove a clip's metadata; returns its file name so the caller can delete the file. */
export function deleteAudioClipRow(id: string): string | null {
  const row = getDb().prepare('SELECT file_name FROM audio_clips WHERE id = ?').get(id) as
    | { file_name: string }
    | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM audio_clips WHERE id = ?').run(id);
  return row.file_name;
}

/** Remove all clips for an entity; returns their file names for file cleanup. */
export function deleteAudioClipsForEntity(entityKind: AudioEntityKind, entityId: string): string[] {
  const rows = getDb()
    .prepare('SELECT file_name FROM audio_clips WHERE entity_kind = ? AND entity_id = ?')
    .all(entityKind, entityId) as { file_name: string }[];
  getDb().prepare('DELETE FROM audio_clips WHERE entity_kind = ? AND entity_id = ?').run(entityKind, entityId);
  return rows.map((r) => r.file_name);
}

export function setAudioClipPinned(id: string, pinned: boolean): void {
  getDb().prepare('UPDATE audio_clips SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}

/** Unpinned clips of a kind created before `cutoffIso`, oldest first, at most `limit`. */
export function listExpiredAudioClips(entityKind: AudioEntityKind, cutoffIso: string, limit = 200): { id: string; fileName: string }[] {
  return (getDb()
    .prepare('SELECT id, file_name FROM audio_clips WHERE entity_kind = ? AND pinned = 0 AND created_at < ? ORDER BY created_at ASC LIMIT ?')
    .all(entityKind, cutoffIso, limit) as { id: string; file_name: string }[]).map((row) => ({ id: row.id, fileName: row.file_name }));
}

/** Distinct entity ids of one kind starting with `prefix` (chat clips are keyed `<conversationId>:<messageId>`). */
export function listAudioClipEntityIds(entityKind: AudioEntityKind, prefix: string): string[] {
  return (getDb()
    .prepare("SELECT DISTINCT entity_id FROM audio_clips WHERE entity_kind = ? AND entity_id LIKE ? ESCAPE '\\'")
    .all(entityKind, `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { entity_id: string }[]).map((row) => row.entity_id);
}

/** Bytes used by clips per kind. */
export function audioClipBytesByKind(): Record<string, number> {
  const rows = getDb().prepare('SELECT entity_kind, SUM(bytes) AS total FROM audio_clips GROUP BY entity_kind').all() as { entity_kind: string; total: number }[];
  return Object.fromEntries(rows.map((row) => [row.entity_kind, Number(row.total) || 0]));
}
