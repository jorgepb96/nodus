import crypto from 'node:crypto';
import type {
  ExtractedStudyIdea,
  ExtractedStudyRelation,
  StudyIdeaConnection,
  StudyIdeaDetail,
  StudyIdeaSummary,
  StudyKnowledgeGraph,
  StudyKnowledgeJob,
  StudyKnowledgeJobStatus,
  StudyKnowledgeSourceKind,
} from '@shared/studyKnowledge';
import type { ModelRef } from '@shared/types';
import { getDb } from './database';
import { decodeEmbedding, encodeEmbedding, embeddingTextHash } from './ideasRepo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export function normalizeStudyIdeaLabel(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function summary(row: Row): StudyIdeaSummary {
  return {
    id: String(row.id), subjectId: String(row.subject_id), type: String(row.type) as StudyIdeaSummary['type'],
    label: String(row.label), statement: String(row.statement), evidenceCount: Number(row.evidence_count ?? 0),
    sourceCount: Number(row.source_count ?? 0), connectionCount: Number(row.connection_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

const SUMMARY_SQL = `SELECT i.*,
  COUNT(DISTINCT ev.id) AS evidence_count,
  COUNT(DISTINCT o.source_kind || ':' || o.source_id) AS source_count,
  (SELECT COUNT(*) FROM study_idea_edges e WHERE e.from_id=i.id OR e.to_id=i.id) AS connection_count
  FROM embedding_read_study_ideas i
  LEFT JOIN study_idea_occurrences o ON o.idea_id=i.id
  LEFT JOIN study_idea_evidence ev ON ev.occurrence_id=o.id`;

export function listStudyIdeas(subjectId: string, query = ''): StudyIdeaSummary[] {
  const clean = query.trim();
  const where = clean ? 'WHERE i.subject_id=? AND (i.label LIKE ? OR i.statement LIKE ?)' : 'WHERE i.subject_id=?';
  const params = clean ? [subjectId, `%${clean}%`, `%${clean}%`] : [subjectId];
  return (getDb().prepare(`${SUMMARY_SQL} ${where} GROUP BY i.id ORDER BY source_count DESC, connection_count DESC, i.label`).all(...params) as Row[]).map(summary);
}

export function getStudyIdeaDetail(id: string): StudyIdeaDetail | null {
  const row = getDb().prepare(`${SUMMARY_SQL} WHERE i.id=? GROUP BY i.id`).get(id) as Row | undefined;
  if (!row) return null;
  const evidence = (getDb().prepare(`SELECT ev.*, o.source_kind, o.source_id, o.source_title
    FROM study_idea_evidence ev JOIN study_idea_occurrences o ON o.id=ev.occurrence_id
    WHERE o.idea_id=? ORDER BY o.confidence DESC, ev.position`).all(id) as Row[]).map((item) => ({
      id: String(item.id), quote: String(item.quote), location: String(item.location ?? ''),
      sourceKind: String(item.source_kind) as StudyKnowledgeSourceKind, sourceId: String(item.source_id), sourceTitle: String(item.source_title),
    }));
  const connections = (getDb().prepare(`SELECT e.*,
      CASE WHEN e.from_id=? THEN e.to_id ELSE e.from_id END AS other_id,
      CASE WHEN e.from_id=? THEN target.label ELSE source.label END AS other_label
    FROM study_idea_edges e JOIN embedding_read_study_ideas source ON source.id=e.from_id JOIN embedding_read_study_ideas target ON target.id=e.to_id
    WHERE e.from_id=? OR e.to_id=? ORDER BY e.confidence DESC`).all(id, id, id, id) as Row[]).map(connection);
  return { ...summary(row), evidence, connections };
}

/** Delete one canonical study idea and every dependent vector/evidence/edge. */
export function deleteStudyIdea(id: string): boolean {
  return getDb().prepare('DELETE FROM study_ideas WHERE id=?').run(id).changes > 0;
}

function connection(row: Row): StudyIdeaConnection {
  return {
    id: String(row.id), subjectId: String(row.subject_id), fromId: String(row.from_id), toId: String(row.to_id),
    type: String(row.type) as StudyIdeaConnection['type'], basis: String(row.basis ?? ''), confidence: Number(row.confidence ?? 0),
    otherId: row.other_id ? String(row.other_id) : undefined, otherLabel: row.other_label ? String(row.other_label) : undefined,
  };
}

export function getStudyKnowledgeGraph(subjectId: string): StudyKnowledgeGraph {
  const ideas = listStudyIdeas(subjectId);
  const edges = (getDb().prepare('SELECT * FROM study_idea_edges WHERE subject_id=? ORDER BY confidence DESC').all(subjectId) as Row[]).map(connection);
  return {
    subjectId,
    nodes: ideas.map((idea) => ({ id: idea.id, label: idea.label, statement: idea.statement, type: idea.type, evidenceCount: idea.evidenceCount, connectionCount: idea.connectionCount })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.fromId, target: edge.toId, type: edge.type, basis: edge.basis, confidence: edge.confidence })),
  };
}

export function setStudyKnowledgeJob(input: {
  subjectId: string; sourceKind: StudyKnowledgeSourceKind; sourceId: string; status: StudyKnowledgeJobStatus;
  phase: string; sourceHash: string; model?: ModelRef | null; error?: string | null;
}): void {
  getDb().prepare(`INSERT INTO study_knowledge_jobs
    (subject_id,source_kind,source_id,status,phase,source_hash,model_provider,model_name,error,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,source_kind,source_id) DO UPDATE SET
    status=excluded.status, phase=excluded.phase, source_hash=excluded.source_hash, model_provider=excluded.model_provider,
    model_name=excluded.model_name, error=excluded.error, updated_at=excluded.updated_at`)
    .run(input.subjectId, input.sourceKind, input.sourceId, input.status, input.phase, input.sourceHash,
      input.model?.provider ?? null, input.model?.model ?? null, input.error ?? null, now());
}

export function getStudyKnowledgeJob(subjectId: string, sourceKind: StudyKnowledgeSourceKind, sourceId: string): StudyKnowledgeJob | null {
  const row = getDb().prepare('SELECT * FROM study_knowledge_jobs WHERE subject_id=? AND source_kind=? AND source_id=?').get(subjectId, sourceKind, sourceId) as Row | undefined;
  return row ? job(row) : null;
}

export function listStudyKnowledgeJobs(subjectId?: string): StudyKnowledgeJob[] {
  const rows = (subjectId
    ? getDb().prepare('SELECT * FROM study_knowledge_jobs WHERE subject_id=? ORDER BY updated_at DESC').all(subjectId)
    : getDb().prepare('SELECT * FROM study_knowledge_jobs ORDER BY updated_at DESC').all()) as Row[];
  return rows.map(job);
}

function job(row: Row): StudyKnowledgeJob {
  return {
    subjectId: String(row.subject_id), sourceKind: String(row.source_kind) as StudyKnowledgeSourceKind, sourceId: String(row.source_id),
    status: String(row.status) as StudyKnowledgeJob['status'], phase: String(row.phase), sourceHash: String(row.source_hash),
    model: row.model_provider && row.model_name ? { provider: String(row.model_provider) as ModelRef['provider'], model: String(row.model_name) } : null,
    error: row.error ? String(row.error) : null, updatedAt: String(row.updated_at),
  };
}

export function replaceStudySourceKnowledge(input: {
  subjectId: string; sourceKind: StudyKnowledgeSourceKind; sourceId: string; sourceTitle: string; sourceHash: string;
  ideas: ExtractedStudyIdea[]; relations: ExtractedStudyRelation[];
  embeddings: Array<number[] | null>; embeddingProvider: string; embeddingModel: string;
}): void {
  const db = getDb(); const timestamp = now();
  db.transaction(() => {
    db.prepare('DELETE FROM study_idea_edges WHERE subject_id=? AND source_kind=? AND source_id=?').run(input.subjectId, input.sourceKind, input.sourceId);
    db.prepare(`DELETE FROM study_idea_occurrences WHERE source_kind=? AND source_id=? AND idea_id IN
      (SELECT id FROM study_ideas WHERE subject_id=?)`).run(input.sourceKind, input.sourceId, input.subjectId);
    const idByKey = new Map<string, string>();
    for (const [index, idea] of input.ideas.entries()) {
      const normalized = normalizeStudyIdeaLabel(idea.label); if (!normalized || !idea.statement.trim()) continue;
      const row = db.prepare('SELECT id FROM study_ideas WHERE subject_id=? AND type=? AND normalized_label=?').get(input.subjectId, idea.type, normalized) as Row | undefined;
      const ideaId = row ? String(row.id) : crypto.randomUUID();
      const vector = input.embeddings[index] ?? null;
      if (row) {
        if (vector) {
          db.prepare(`UPDATE study_ideas SET label=?, statement=?, embedding=?, embedding_provider=?,
            embedding_model=?, embedding_dim=?, embedding_text_hash=?, updated_at=? WHERE id=?`)
            .run(idea.label.trim(), idea.statement.trim(), encodeEmbedding(vector), input.embeddingProvider,
              input.embeddingModel, vector.length, embeddingTextHash(`${idea.label}\n${idea.statement}`), timestamp, ideaId);
        } else {
          db.prepare(`UPDATE study_ideas SET label=?, statement=?, embedding_text_hash=?, updated_at=? WHERE id=?`)
            .run(idea.label.trim(), idea.statement.trim(), embeddingTextHash(`${idea.label}\n${idea.statement}`), timestamp, ideaId);
        }
      } else {
        db.prepare(`INSERT INTO study_ideas (id,subject_id,type,label,normalized_label,statement,embedding,embedding_provider,embedding_model,embedding_dim,embedding_text_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ideaId, input.subjectId, idea.type, idea.label.trim(), normalized, idea.statement.trim(),
          vector ? encodeEmbedding(vector) : null, vector ? input.embeddingProvider : null, vector ? input.embeddingModel : null,
          vector?.length ?? null, embeddingTextHash(`${idea.label}\n${idea.statement}`), timestamp, timestamp);
      }
      idByKey.set(idea.key, ideaId); idByKey.set(normalized, ideaId);
      const occurrenceId = crypto.randomUUID();
      db.prepare(`INSERT INTO study_idea_occurrences (id,idea_id,source_kind,source_id,source_title,source_hash,role,confidence,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(occurrenceId, ideaId, input.sourceKind, input.sourceId, input.sourceTitle, input.sourceHash,
        idea.role, Math.max(0, Math.min(1, idea.confidence)), timestamp, timestamp);
      const addEvidence = db.prepare('INSERT INTO study_idea_evidence (id,occurrence_id,quote,location,position,created_at) VALUES (?,?,?,?,?,?)');
      idea.evidence.filter((item) => item.quote.trim()).slice(0, 8).forEach((item, position) => addEvidence.run(crypto.randomUUID(), occurrenceId, item.quote.trim(), item.location.trim(), position, timestamp));
    }
    const subjectRows = db.prepare('SELECT id,label,normalized_label FROM study_ideas WHERE subject_id=?').all(input.subjectId) as Row[];
    for (const row of subjectRows) { idByKey.set(String(row.normalized_label), String(row.id)); idByKey.set(String(row.label), String(row.id)); }
    for (const relation of input.relations) {
      const fromId = idByKey.get(relation.from) ?? idByKey.get(normalizeStudyIdeaLabel(relation.from));
      const toId = idByKey.get(relation.to) ?? idByKey.get(normalizeStudyIdeaLabel(relation.to));
      if (!fromId || !toId || fromId === toId) continue;
      const endpoints = db.prepare('SELECT COUNT(*) value FROM study_ideas WHERE subject_id=? AND id IN (?,?)').get(input.subjectId, fromId, toId) as Row;
      if (Number(endpoints.value) !== 2) continue;
      db.prepare(`INSERT INTO study_idea_edges (id,subject_id,from_id,to_id,type,basis,confidence,source_kind,source_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,from_id,to_id,type) DO UPDATE SET
        basis=excluded.basis, confidence=MAX(study_idea_edges.confidence,excluded.confidence), source_kind=excluded.source_kind,
        source_id=excluded.source_id, updated_at=excluded.updated_at`).run(crypto.randomUUID(), input.subjectId, fromId, toId,
        relation.type, relation.basis.trim(), Math.max(0, Math.min(1, relation.confidence)), input.sourceKind, input.sourceId, timestamp, timestamp);
    }
    db.prepare(`DELETE FROM study_ideas WHERE subject_id=? AND NOT EXISTS
      (SELECT 1 FROM study_idea_occurrences o WHERE o.idea_id=study_ideas.id)`).run(input.subjectId);
  })();
}

export function sourceSubjectIds(kind: StudyKnowledgeSourceKind, sourceId: string): string[] {
  const sql = kind === 'material'
    ? `SELECT DISTINCT p.subject_id id FROM study_material_placements p JOIN study_materials m ON m.id=p.material_id
       JOIN study_subjects s ON s.id=p.subject_id JOIN study_courses c ON c.id=s.course_id
       WHERE p.material_id=? AND p.subject_id IS NOT NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL AND m.deleted_at IS NULL AND m.archived_at IS NULL
       AND s.deleted_at IS NULL AND s.archived_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL`
    : `SELECT DISTINCT p.subject_id id FROM study_placements p JOIN study_docs d ON d.id=p.document_id
       JOIN study_subjects s ON s.id=p.subject_id JOIN study_courses c ON c.id=s.course_id
       WHERE p.document_id=? AND p.subject_id IS NOT NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL AND d.deleted_at IS NULL AND d.archived_at IS NULL
       AND s.deleted_at IS NULL AND s.archived_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL`;
  return (getDb().prepare(sql).all(sourceId) as Row[]).map((row) => String(row.id));
}

export function syncStudyKnowledgeSourceScopes(kind: StudyKnowledgeSourceKind, sourceId: string): void {
  // Generated knowledge has its own provenance. Moving/unlinking a live source
  // must not erase it, including when a later background analysis runs this sync.
  // Explicit purge and lifecycle cleanup still use the existing deletion paths.
  const sourceTable = kind === 'material' ? 'study_materials' : 'study_docs';
  if (getDb().prepare(`SELECT 1 FROM ${sourceTable} WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`).get(sourceId)) return;
  const allowed = new Set(sourceSubjectIds(kind, sourceId)); const db = getDb();
  db.transaction(() => {
    const subjects = db.prepare(`SELECT DISTINCT i.subject_id id FROM study_idea_occurrences o JOIN study_ideas i ON i.id=o.idea_id
      WHERE o.source_kind=? AND o.source_id=?`).all(kind, sourceId) as Row[];
    for (const row of subjects) {
      const subjectId = String(row.id); if (allowed.has(subjectId)) continue;
      db.prepare('DELETE FROM study_idea_edges WHERE subject_id=? AND source_kind=? AND source_id=?').run(subjectId, kind, sourceId);
      db.prepare(`DELETE FROM study_idea_occurrences WHERE source_kind=? AND source_id=? AND idea_id IN
        (SELECT id FROM study_ideas WHERE subject_id=?)`).run(kind, sourceId, subjectId);
      db.prepare('DELETE FROM study_knowledge_jobs WHERE subject_id=? AND source_kind=? AND source_id=?').run(subjectId, kind, sourceId);
      db.prepare(`DELETE FROM study_ideas WHERE subject_id=? AND NOT EXISTS
        (SELECT 1 FROM study_idea_occurrences o WHERE o.idea_id=study_ideas.id)`).run(subjectId);
    }
  })();
}

export function purgeStudyKnowledgeSource(kind: StudyKnowledgeSourceKind, sourceId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM study_idea_edges WHERE source_kind=? AND source_id=?').run(kind, sourceId);
    db.prepare('DELETE FROM study_idea_occurrences WHERE source_kind=? AND source_id=?').run(kind, sourceId);
    db.prepare('DELETE FROM study_knowledge_jobs WHERE source_kind=? AND source_id=?').run(kind, sourceId);
    db.prepare(`DELETE FROM study_ideas WHERE NOT EXISTS (SELECT 1 FROM study_idea_occurrences o WHERE o.idea_id=study_ideas.id)`).run();
  })();
}

export function listStudyIdeaVectors(subjectId: string, sourceKeys: string[] = []): Array<StudyIdeaSummary & { embedding: number[] | null }> {
  const selected = sourceKeys.filter((key) => /^(?:material|document):/.test(key));
  const clauses = ['i.subject_id=?']; const params: unknown[] = [subjectId];
  if (selected.length) {
    clauses.push(`EXISTS (SELECT 1 FROM study_idea_occurrences selected WHERE selected.idea_id=i.id AND
      (selected.source_kind || ':' || selected.source_id) IN (${selected.map(() => '?').join(',')}))`);
    params.push(...selected);
  }
  const rows = getDb().prepare(`${SUMMARY_SQL} WHERE ${clauses.join(' AND ')} GROUP BY i.id ORDER BY source_count DESC`).all(...params) as Row[];
  return rows.map((row) => ({ ...summary(row), embedding: row.embedding ? decodeEmbedding(row.embedding as Buffer) : null }));
}

/**
 * The extracted idea network behind a set of sources, across subjects.
 *
 * Unit design retrieves its sources by relevance to the teacher's objective and then
 * asks what was already extracted FROM those exact sources, so the ideas inherit the
 * retrieval's scope instead of needing a subject picker of their own. Subject isolation
 * still holds in practice — the relevant sources of one objective belong to one
 * subject — but it is a consequence here, not a filter, which is why the edge lookup
 * is keyed on the idea ids rather than on a subject.
 */
export function listStudyIdeasForSources(sourceKeys: string[]): { ideas: StudyIdeaSummary[]; connections: StudyIdeaConnection[] } {
  const selected = sourceKeys.filter((key) => /^(?:material|document):/.test(key));
  if (!selected.length) return { ideas: [], connections: [] };
  const ideas = (getDb().prepare(`${SUMMARY_SQL}
    WHERE EXISTS (SELECT 1 FROM study_idea_occurrences selected WHERE selected.idea_id=i.id AND
      (selected.source_kind || ':' || selected.source_id) IN (${selected.map(() => '?').join(',')}))
    GROUP BY i.id ORDER BY source_count DESC, connection_count DESC, i.label LIMIT 60`).all(...selected) as Row[]).map(summary);
  if (!ideas.length) return { ideas, connections: [] };
  const ids = ideas.map((idea) => idea.id);
  const placeholders = ids.map(() => '?').join(',');
  // Both endpoints must be in the set: an edge to an idea the writer never sees is a
  // dangling reference the model would be tempted to invent a meaning for.
  const connections = (getDb().prepare(`SELECT * FROM study_idea_edges
    WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders})
    ORDER BY confidence DESC LIMIT 80`).all(...ids, ...ids) as Row[]).map(connection);
  return { ideas, connections };
}

export function listStudyConnectionsForIdeas(subjectId: string, ideaIds: string[]): StudyIdeaConnection[] {
  if (!ideaIds.length) return [];
  const placeholders = ideaIds.map(() => '?').join(',');
  return (getDb().prepare(`SELECT * FROM study_idea_edges WHERE subject_id=? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))
    ORDER BY confidence DESC LIMIT 40`).all(subjectId, ...ideaIds, ...ideaIds) as Row[]).map(connection);
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length); let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < length; index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** Connect newly analysed ideas only to their closest neighbours in the same
 * subject. This bounded pass avoids both cross-subject leakage and O(n²) graph
 * growth while still linking concepts that occur in different materials. */
export function connectStudySourceIdeasSemantically(subjectId: string, sourceKind: StudyKnowledgeSourceKind, sourceId: string): void {
  const db = getDb(); const timestamp = now();
  const all = (db.prepare(`SELECT id,label,embedding FROM embedding_read_study_ideas AS study_ideas WHERE subject_id=? AND embedding IS NOT NULL`).all(subjectId) as Row[])
    .map((row) => ({ id: String(row.id), label: String(row.label), embedding: decodeEmbedding(row.embedding as Buffer) }));
  const freshIds = new Set((db.prepare(`SELECT o.idea_id id FROM study_idea_occurrences o JOIN study_ideas i ON i.id=o.idea_id
    WHERE i.subject_id=? AND o.source_kind=? AND o.source_id=?`).all(subjectId, sourceKind, sourceId) as Row[]).map((row) => String(row.id)));
  const insert = db.prepare(`INSERT INTO study_idea_edges (id,subject_id,from_id,to_id,type,basis,confidence,source_kind,source_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject_id,from_id,to_id,type) DO UPDATE SET
    confidence=MAX(study_idea_edges.confidence,excluded.confidence), updated_at=excluded.updated_at`);
  db.transaction(() => {
    for (const idea of all.filter((item) => freshIds.has(item.id))) {
      const neighbours = all.filter((item) => item.id !== idea.id)
        .map((item) => ({ item, score: cosine(idea.embedding, item.embedding) }))
        .filter((item) => item.score >= 0.72).sort((a, b) => b.score - a.score).slice(0, 4);
      for (const neighbour of neighbours) {
        const [fromId, toId] = idea.id < neighbour.item.id ? [idea.id, neighbour.item.id] : [neighbour.item.id, idea.id];
        insert.run(crypto.randomUUID(), subjectId, fromId, toId, 'related',
          `Proximidad semántica entre «${idea.label}» y «${neighbour.item.label}».`, neighbour.score, sourceKind, sourceId, timestamp, timestamp);
      }
    }
  })();
}
