// Construir el índice semántico de un proyecto de historia oral.
//
// Es un pipeline corto a propósito: mide, filtra por acuerdo, embebe por lotes y guarda.
// Lo que no hace es tan importante: no indexa «lo que pueda» de una entrevista restringida,
// no reintenta indefinidamente contra un proveedor caído y no deja el índice a medias sin
// decirlo — devuelve cuántos tramos entraron, cuántas entrevistas se quedaron fuera y por
// qué, para que la pantalla no pueda enseñar un índice que miente sobre su cobertura.

import { embedMany } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { accessContextFor } from '../db/testimonyRepo';
import { evaluateAccess } from '@shared/testimonyAccess';
import {
  dropInterviewEmbeddings,
  indexableInterviews,
  segmentsToIndex,
  storeEmbeddings,
  indexStatus,
} from '../db/testimonyEmbeddingsRepo';
import { getDb } from '../db/database';

export interface TestimonyIndexReport {
  indexedInterviews: number;
  indexedSegments: number;
  /** Entrevistas que el acuerdo deja fuera, por motivo. */
  withheld: { reason: string; interviews: number }[];
  /** Vectores borrados por haber dejado de estar autorizados. */
  purged: number;
  model: string;
  failed: number;
}

/** Cuántos textos van en cada llamada al proveedor. */
const BATCH = 32;

export async function buildTestimonyIndex(): Promise<TestimonyIndexReport> {
  const settings = getSettings();
  const model = `${settings.embeddingProvider}/${settings.embeddingModel}`;
  const db = getDb();
  const now = new Date();

  const allowed = new Set(indexableInterviews(now));
  const external = !['nodus', 'ollama', 'lmstudio'].includes(settings.embeddingProvider);
  const all = db.prepare('SELECT id FROM testimony_interviews WHERE deleted_at IS NULL').all() as { id: string }[];

  // Primero se limpia: una entrevista que ha dejado de estar autorizada pierde sus
  // vectores ANTES de indexar nada nuevo, para que un fallo a mitad no deje material
  // indexado sin permiso.
  let purged = 0;
  const withheld = new Map<string, number>();
  for (const row of all) {
    const access = accessContextFor(row.id);
    const localDecision = evaluateAccess(access, 'embeddingIndex', { now, policy: { allowExternalProviders: settings.testimonyAllowExternalProviders } });
    const targetDecision = external ? evaluateAccess(access, 'externalAi', { now, policy: { allowExternalProviders: settings.testimonyAllowExternalProviders } }) : localDecision;
    if (allowed.has(row.id) && targetDecision.allowed && !targetDecision.requiresPseudonymization && !localDecision.requiresPseudonymization) continue;
    allowed.delete(row.id);
    if (!localDecision.allowed) purged += dropInterviewEmbeddings(row.id);
    const decision = evaluateAccess(accessContextFor(row.id), 'embeddingIndex', {
      now,
      policy: { allowExternalProviders: settings.testimonyAllowExternalProviders },
    });
    const reason = targetDecision.reason ?? decision.reason ?? 'access_restricted';
    withheld.set(reason, (withheld.get(reason) ?? 0) + 1);
  }

  let indexedSegments = 0;
  let indexedInterviews = 0;
  let failed = 0;
  for (const interviewId of allowed) {
    const segments = segmentsToIndex(interviewId);
    if (!segments.length) continue;
    let stored = 0;
    for (let start = 0; start < segments.length; start += BATCH) {
      const batch = segments.slice(start, start + BATCH);
      const vectors = await embedMany(batch.map((segment) => segment.text));
      const entries = batch
        .map((segment, index) => ({ segmentId: segment.id, transcriptId: segment.transcriptId, vector: vectors[index] }))
        .filter((entry): entry is { segmentId: string; transcriptId: string; vector: number[] } => Array.isArray(entry.vector));
      failed += batch.length - entries.length;
      stored += storeEmbeddings(interviewId, model, entries);
    }
    if (stored > 0) {
      indexedInterviews += 1;
      indexedSegments += stored;
    }
  }

  return {
    indexedInterviews,
    indexedSegments,
    withheld: [...withheld.entries()].map(([reason, interviews]) => ({ reason, interviews })),
    purged,
    model,
    failed,
  };
}

export function testimonyIndexStatus() {
  return indexStatus();
}
