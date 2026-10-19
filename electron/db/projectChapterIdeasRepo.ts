// Storage for ideas distilled from an uploaded chapter and their typed relations
// with the library. These rows live entirely apart from the curated `ideas`
// table and the graph: they are working artifacts of a manuscript, re-extracted
// when the chapter text changes (tracked by source_hash).
import { randomUUID } from 'node:crypto';
import type {
  ChapterIdeaType,
  ChapterRelationTargetKind,
  ChapterRelationType,
  ProjectChapterIdea,
} from '@shared/types';
import { getDb } from './database';
import { currentEmbeddingConfig, decodeEmbedding, encodeEmbedding, embeddingTextHash } from './ideasRepo';

export interface NewChapterIdea {
  /** Supplied by fail-closed analysis so relations can be built before publication. */
  id?: string;
  type: ChapterIdeaType;
  label: string;
  statement: string;
  embedding: number[] | null;
  embeddingText: string;
}

export interface NewChapterIdeaRelation {
  chapterIdeaId: string;
  targetKind: ChapterRelationTargetKind;
  targetId: string;
  relation: ChapterRelationType;
  similarity: number;
  confidence: number;
  rationale: string;
}

interface ChapterIdeaRow {
  id: string;
  chapter_id: string;
  project_id: string;
  type: string;
  label: string;
  statement: string;
  order_idx: number;
  created_at: string;
}

const IDEA_TYPES: ChapterIdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];

function toChapterIdea(row: ChapterIdeaRow): ProjectChapterIdea {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    projectId: row.project_id,
    type: (IDEA_TYPES.includes(row.type as ChapterIdeaType) ? row.type : 'claim') as ChapterIdeaType,
    label: row.label,
    statement: row.statement,
    orderIdx: row.order_idx,
    createdAt: row.created_at,
  };
}

/** The source_hash the stored ideas were extracted from (null when none stored). */
export function chapterIdeasSourceHash(chapterId: string): string | null {
  const row = getDb()
    .prepare('SELECT source_hash FROM project_chapter_ideas WHERE chapter_id = ? LIMIT 1')
    .get(chapterId) as { source_hash: string } | undefined;
  return row?.source_hash ?? null;
}

export function listChapterIdeas(chapterId: string): ProjectChapterIdea[] {
  return (getDb()
    .prepare('SELECT * FROM embedding_read_project_chapter_ideas AS project_chapter_ideas WHERE chapter_id = ? ORDER BY order_idx ASC')
    .all(chapterId) as ChapterIdeaRow[]).map(toChapterIdea);
}

/** Chapter ideas that carry a current-model embedding, with the decoded vector. */
export function chapterIdeaEmbeddings(
  chapterId: string
): { id: string; label: string; statement: string; type: ChapterIdeaType; embedding: number[] }[] {
  const config = currentEmbeddingConfig();
  const rows = getDb()
    .prepare(
      `SELECT id, type, label, statement, embedding
         FROM embedding_read_project_chapter_ideas AS project_chapter_ideas
        WHERE chapter_id = ?
          AND embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?`
    )
    .all(chapterId, config.provider, config.model) as {
    id: string;
    type: string;
    label: string;
    statement: string;
    embedding: Buffer;
  }[];
  return rows.map((row) => ({
    id: row.id,
    type: (IDEA_TYPES.includes(row.type as ChapterIdeaType) ? row.type : 'claim') as ChapterIdeaType,
    label: row.label,
    statement: row.statement,
    embedding: decodeEmbedding(row.embedding),
  }));
}

/** Replace all ideas for a chapter atomically (and, by cascade, their relations). */
export function replaceChapterIdeas(
  chapterId: string,
  projectId: string,
  sourceHash: string,
  ideas: NewChapterIdea[]
): ProjectChapterIdea[] {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const createdAt = new Date().toISOString();
  const ids: string[] = [];
  const insert = db.prepare(
    `INSERT INTO project_chapter_ideas (
       id, chapter_id, project_id, type, label, statement, order_idx, source_hash,
       embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM project_chapter_ideas WHERE chapter_id = ?').run(chapterId);
    ideas.forEach((idea, index) => {
      const id = randomUUID();
      ids.push(id);
      const embedding = idea.embedding;
      insert.run(
        id,
        chapterId,
        projectId,
        idea.type,
        idea.label,
        idea.statement,
        index,
        sourceHash,
        embedding ? encodeEmbedding(embedding) : null,
        embedding ? config.provider : null,
        embedding ? config.model : null,
        embedding?.length ?? null,
        embedding ? embeddingTextHash(idea.embeddingText) : null,
        createdAt
      );
    });
  })();
  return listChapterIdeas(chapterId);
}

export function replaceChapterIdeaRelations(chapterId: string, relations: NewChapterIdeaRelation[]): void {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO project_chapter_idea_relations (
       id, chapter_idea_id, chapter_id, target_kind, target_id, relation, similarity, confidence, rationale, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare('DELETE FROM project_chapter_idea_relations WHERE chapter_id = ?').run(chapterId);
    for (const relation of relations) {
      insert.run(
        randomUUID(),
        relation.chapterIdeaId,
        chapterId,
        relation.targetKind,
        relation.targetId,
        relation.relation,
        relation.similarity,
        relation.confidence,
        relation.rationale,
        createdAt
      );
    }
  })();
}

/** Publish a complete chapter analysis in one transaction. The caller builds the
 * ideas and their relations in memory, so an AI/embedding failure before this call
 * leaves the last valid analysis untouched. */
export function replaceChapterAnalysis(
  chapterId: string,
  projectId: string,
  sourceHash: string,
  ideas: NewChapterIdea[],
  relations: NewChapterIdeaRelation[],
): ProjectChapterIdea[] {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const createdAt = new Date().toISOString();
  const ids = new Set(ideas.map((idea) => idea.id).filter((id): id is string => Boolean(id)));
  if (ids.size !== ideas.length) throw new Error('Cada idea del capítulo debe tener un identificador único antes de publicarse.');
  for (const relation of relations) {
    if (!ids.has(relation.chapterIdeaId)) throw new Error('Una relación del capítulo apunta a una idea que no pertenece al análisis nuevo.');
  }

  const insertIdea = db.prepare(
    `INSERT INTO project_chapter_ideas (
       id, chapter_id, project_id, type, label, statement, order_idx, source_hash,
       embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRelation = db.prepare(
    `INSERT INTO project_chapter_idea_relations (
       id, chapter_idea_id, chapter_id, target_kind, target_id, relation, similarity, confidence, rationale, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    db.prepare('DELETE FROM project_chapter_idea_relations WHERE chapter_id = ?').run(chapterId);
    db.prepare('DELETE FROM project_chapter_ideas WHERE chapter_id = ?').run(chapterId);
    ideas.forEach((idea, index) => {
      const embedding = idea.embedding;
      insertIdea.run(
        idea.id,
        chapterId,
        projectId,
        idea.type,
        idea.label,
        idea.statement,
        index,
        sourceHash,
        embedding ? encodeEmbedding(embedding) : null,
        embedding ? config.provider : null,
        embedding ? config.model : null,
        embedding?.length ?? null,
        embedding ? embeddingTextHash(idea.embeddingText) : null,
        createdAt,
      );
    });
    for (const relation of relations) {
      insertRelation.run(
        randomUUID(),
        relation.chapterIdeaId,
        chapterId,
        relation.targetKind,
        relation.targetId,
        relation.relation,
        relation.similarity,
        relation.confidence,
        relation.rationale,
        createdAt,
      );
    }
  })();
  return listChapterIdeas(chapterId);
}

export interface ChapterIdeaRelationRow {
  id: string;
  chapter_idea_id: string;
  target_kind: ChapterRelationTargetKind;
  target_id: string;
  relation: ChapterRelationType;
  similarity: number;
  confidence: number;
  rationale: string;
}

export function listChapterIdeaRelations(chapterId: string): ChapterIdeaRelationRow[] {
  return getDb()
    .prepare(
      `SELECT id, chapter_idea_id, target_kind, target_id, relation, similarity, confidence, rationale
         FROM project_chapter_idea_relations
        WHERE chapter_id = ?
        ORDER BY confidence DESC, similarity DESC`
    )
    .all(chapterId) as ChapterIdeaRelationRow[];
}

/** Distinct library idea ids related to any chapter idea — used to seed suggestion materials. */
export function relatedLibraryIdeaIds(chapterId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT target_id
         FROM project_chapter_idea_relations
        WHERE chapter_id = ? AND target_kind = 'idea'
        ORDER BY confidence DESC`
    )
    .all(chapterId) as { target_id: string }[];
  return rows.map((row) => row.target_id);
}
