// El índice semántico de Testimonios: buscar por lo que se dijo, no por cómo se dijo.
//
// Un proyecto de historia oral pregunta cosas que la búsqueda textual no puede contestar
// —«¿quién habla de irse sin decir emigrar?»— y para eso hacen falta embeddings. Pero un
// embedding de la voz de alguien es un DERIVADO suyo que sale del equipo cuando el
// proveedor es externo, así que aquí manda el acuerdo:
//
//   · Indexar pasa por `evaluateAccess` en el canal `embeddingIndex`. Lo que no lo pasa NO
//     se indexa, y no queda a medias: no se guarda ni el identificador.
//   · Buscar VUELVE A PASAR por la puerta. Un acuerdo puede cambiar —un embargo nuevo, una
//     retirada de consentimiento— después de indexar, y un índice que sobrevive al permiso
//     que lo creó es la peor clase de fuga: silenciosa y con buena letra.
//   · Retirar el consentimiento borra sus vectores, sin tocar la transcripción.

import { getDb } from './database';
import { encodeEmbedding } from './ideasRepo';
import { clearActiveEmbeddingFamilies } from './embeddingIndexesRepo';
import { embeddingProvenance } from '../ai/embeddingProvenance';
import { getSettings } from './settingsRepo';
import { accessContextFor } from './testimonyRepo';
import { evaluateAccess } from '@shared/testimonyAccess';
import { preferredTranscript } from '@shared/testimonies';
import type { TestimonyTranscriptKind, TestimonyTranscriptStatus } from '@shared/types';

export interface TestimonyIndexStatus {
  /** Entrevistas cuyo acuerdo permite indexar. */
  indexable: number;
  /** Entrevistas con al menos un tramo indexado. */
  indexed: number;
  segments: number;
  /** Tramos indexados que YA NO deberían estarlo porque el acuerdo cambió. */
  stale: number;
  model: string | null;
}

export interface TestimonySemanticHit {
  segmentId: string;
  interviewId: string;
  transcriptId: string;
  similarity: number;
  text: string;
  tStart: number;
  interviewTitle: string;
  shortId: string;
  speakerLabel: string | null;
  speakerPersonId: string | null;
}

function policy(): { allowExternalProviders: boolean } {
  return { allowExternalProviders: getSettings().testimonyAllowExternalProviders };
}

/** Las entrevistas que el acuerdo deja indexar, ahora mismo. */
export function indexableInterviews(now = new Date()): string[] {
  const rows = getDb()
    .prepare('SELECT id FROM testimony_interviews WHERE deleted_at IS NULL')
    .all() as { id: string }[];
  return rows
    .filter((row) => evaluateAccess(accessContextFor(row.id), 'embeddingIndex', { now, policy: policy() }).allowed)
    .map((row) => row.id);
}

/** Los tramos que habría que indexar de una entrevista: los de su versión más autorizada. */
export function segmentsToIndex(interviewId: string): { id: string; transcriptId: string; text: string }[] {
  const db = getDb();
  const transcripts = db
    .prepare(
      `SELECT t.id AS id, t.kind AS kind, t.status AS status, t.version_no AS versionNo
         FROM testimony_transcripts t
         JOIN testimony_media m ON m.id = t.media_id
         JOIN testimony_sessions s ON s.id = m.session_id
        WHERE s.interview_id = ? AND m.deleted_at IS NULL`
    )
    .all(interviewId) as { id: string; kind: TestimonyTranscriptKind; status: TestimonyTranscriptStatus; versionNo: number }[];
  const best = preferredTranscript(transcripts);
  if (!best) return [];
  return (db
    .prepare('SELECT id, transcript_id AS transcriptId, text FROM testimony_transcript_segments WHERE transcript_id = ? ORDER BY position')
    .all(best.id) as { id: string; transcriptId: string; text: string }[])
    .filter((segment) => segment.text.trim().length >= 12);
}

export function storeEmbeddings(
  interviewId: string,
  model: string,
  entries: { segmentId: string; transcriptId: string; vector: number[] }[],
): number {
  const db = getDb();
  const stamp = new Date().toISOString();
  const access = accessContextFor(interviewId);
  const options = { now: new Date(), policy: policy() };
  const decision = evaluateAccess(access, 'embeddingIndex', options);
  const external = !['nodus', 'ollama', 'lmstudio'].includes(model.split('/')[0]);
  const externalDecision = external ? evaluateAccess(access, 'externalAi', options) : decision;
  if (!decision.allowed || decision.requiresPseudonymization || !externalDecision.allowed || externalDecision.requiresPseudonymization) return 0;
  const current = new Map(segmentsToIndex(interviewId).map(segment => [segment.id, segment]));
  let stored = 0;
  const insert = db.prepare(
    `INSERT INTO testimony_segment_embeddings (segment_id, transcript_id, interview_id, model, dim, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(segment_id) DO UPDATE SET
       transcript_id = excluded.transcript_id, interview_id = excluded.interview_id,
       model = excluded.model, dim = excluded.dim, embedding = excluded.embedding, created_at = excluded.created_at`
  );
  const run = db.transaction(() => {
    for (const entry of entries) {
      const segment = current.get(entry.segmentId);
      const origin = embeddingProvenance(entry.vector);
      if (!segment || segment.transcriptId !== entry.transcriptId || (origin?.inputText !== undefined && origin.inputText !== segment.text)) continue;
      const blob = encodeEmbedding(entry.vector);
      insert.run(
        entry.segmentId,
        entry.transcriptId,
        interviewId,
        model,
        entry.vector.length,
        blob,
        stamp,
      );
      stored++;
    }
  });
  run();
  return stored;
}

/** Borrar el índice de una entrevista: lo que hace falta cuando el acuerdo cambia. */
export function dropInterviewEmbeddings(interviewId: string): number {
  return getDb().prepare('DELETE FROM testimony_segment_embeddings WHERE interview_id = ?').run(interviewId).changes;
}

export function dropAllEmbeddings(): number {
  return clearActiveEmbeddingFamilies(getDb(), ['testimony_segment_embeddings']);
}

export function indexStatus(now = new Date()): TestimonyIndexStatus {
  const db = getDb();
  const allowed = new Set(indexableInterviews(now));
  const rows = db
    .prepare('SELECT interview_id AS interviewId, COUNT(*) AS n, MAX(model) AS model FROM embedding_read_testimony_segment_embeddings AS testimony_segment_embeddings WHERE embedding IS NOT NULL GROUP BY interview_id')
    .all() as { interviewId: string; n: number; model: string }[];
  return {
    indexable: allowed.size,
    indexed: rows.filter((row) => allowed.has(row.interviewId)).length,
    segments: rows.reduce((total, row) => total + row.n, 0),
    stale: rows.filter((row) => !allowed.has(row.interviewId)).reduce((total, row) => total + row.n, 0),
    model: rows[0]?.model ?? null,
  };
}

/**
 * Buscar por significado.
 *
 * La puerta se vuelve a evaluar aquí, entrevista por entrevista, y no se confía en que lo
 * indexado siga autorizado. Es más caro y es la única forma de que un embargo firmado ayer
 * tape hoy un pasaje que se indexó el mes pasado.
 */
export function semanticSearch(vector: number[], limit = 20, now = new Date()): TestimonySemanticHit[] {
  const db = getDb();
  const floats = new Float32Array(vector);
  const blob = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
  const rows = db
    .prepare(
      `SELECT e.segment_id AS segmentId, e.interview_id AS interviewId, e.transcript_id AS transcriptId,
              vec_cosine(e.embedding, ?) AS similarity,
              seg.text AS text, seg.t_start AS tStart,
              seg.speaker_label AS speakerLabel, seg.speaker_person_id AS speakerPersonId,
              i.title AS interviewTitle, i.short_id AS shortId
         FROM embedding_read_testimony_segment_embeddings e
         JOIN testimony_transcript_segments seg ON seg.id = e.segment_id
         JOIN testimony_interviews i ON i.id = e.interview_id
        WHERE i.deleted_at IS NULL AND e.embedding IS NOT NULL
        ORDER BY similarity DESC
        LIMIT ?`
    )
    .all(blob, Math.max(limit * 4, 40)) as TestimonySemanticHit[];

  const decided = new Map<string, boolean>();
  const out: TestimonySemanticHit[] = [];
  for (const row of rows) {
    if (!decided.has(row.interviewId)) {
      decided.set(
        row.interviewId,
        evaluateAccess(accessContextFor(row.interviewId), 'embeddingIndex', { now, policy: policy() }).allowed,
      );
    }
    if (!decided.get(row.interviewId)) continue;
    out.push({ ...row, similarity: Number(row.similarity.toFixed(4)) });
    if (out.length >= limit) break;
  }
  return out;
}
