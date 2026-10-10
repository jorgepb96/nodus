import { manualIdeaVisible } from './manualIdeaVisibility';
import { getDb } from './database';
import { MANUAL_IDEA_REFS_SQL, sleepIdeasWithoutWorks, userIdeaReferencesSql } from './ideaDormancy';
import { scanSimilar } from './vectorScan';
import { v4 as uuid } from 'uuid';
import { embeddingTextForIdea, embeddingTextHash } from './ideaEmbeddingText';
export { embeddingTextForIdea, embeddingTextHash };
import type {
  Idea,
  IdeaType,
  Edge,
  EdgeType,
  EdgeBasis,
  Evidence,
  EvidenceKind,
  IdeaDetail,
  IdeaByWork,
  EdgeDetail,
  EdgeTrace,
  ModelRef,
  EmbeddingProvider,
  GraphEdge,
  IdeaConnection,
  IdeaListItem,
  IdeaPage,
  IdeaPageRequest,
  IdeaPickerItem,
  WorkView,
} from '@shared/types';
import { DEFAULT_EMBEDDING_MODELS, normalizeEmbeddingModel } from '@shared/providers';
import { getWorksByIds } from './worksRepo';
import { getSettings } from './settingsRepo';
import { getEdgeFeedback } from './edgeFeedbackRepo';

const EDGE_TYPES = new Set<EdgeType>([
  'extends',
  'contradicts',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'supports',
  'refutes',
  'variant_of',
  'refines',
  'contains',
]);

const SYMMETRIC_EDGE_TYPES = new Set<EdgeType>(['contradicts', 'shares_method', 'measures_same', 'variant_of']);

export function normalizeEdgeType(type: string | null | undefined): EdgeType | null {
  const raw = (type ?? '').trim().toLowerCase();
  if (EDGE_TYPES.has(raw as EdgeType)) return raw as EdgeType;
  if (raw === 'has_variant') return 'variant_of';
  return null;
}

export function normalizeEdgeBasis(basis: string | null | undefined): EdgeBasis {
  return basis === 'explicit' ? 'explicit' : 'inferred';
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function currentEmbeddingConfig(): { provider: EmbeddingProvider; model: string } {
  const settings = getSettings();
  const provider = settings.embeddingProvider ?? 'openai';
  return {
    provider,
    model: normalizeEmbeddingModel(provider, settings.embeddingModel || DEFAULT_EMBEDDING_MODELS[provider]),
  };
}

function embeddingMetaFor(text: string, embedding: number[]): {
  provider: EmbeddingProvider;
  model: string;
  dim: number;
  textHash: string;
} {
  const config = currentEmbeddingConfig();
  return {
    ...config,
    dim: embedding.length,
    textHash: embeddingTextHash(text),
  };
}

export function ideaNeedsEmbedding(row: {
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding_text_hash: string | null;
}, text: string): boolean {
  if (!row.embedding) return true;
  const config = currentEmbeddingConfig();
  const dim = row.embedding.byteLength / 4;
  return (
    row.embedding_provider !== config.provider ||
    row.embedding_model !== config.model ||
    row.embedding_dim !== dim ||
    row.embedding_text_hash !== embeddingTextHash(text)
  );
}

// ── Embedding (de)serialization: store float32 array as BLOB ────────────────

export function encodeEmbedding(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function decodeEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Global id allocation: g-0001, g-0002, ... (assigned by the app, never AI) ─

export function nextGlobalId(): string {
  const db = getDb();
  // The counter has to be read as a NUMBER, not as text. Ids are padded to four
  // digits, which keeps a text sort honest only up to g-9999: past that ceiling
  // 'g-9999' > 'g-10000' character by character, so ORDER BY global_id DESC kept
  // answering g-9999 forever and every new idea collided with the existing
  // g-10000 ("UNIQUE constraint failed: ideas.global_id"), failing every deep
  // scan that had a genuinely new idea to record.
  const row = db
    .prepare("SELECT MAX(CAST(substr(global_id, 3) AS INTEGER)) AS n FROM ideas WHERE global_id GLOB 'g-[0-9]*'")
    .get() as { n: number | null } | undefined;
  const n = (row?.n ?? 0) + 1;
  return `g-${String(n).padStart(4, '0')}`;
}

export interface NewIdeaInput {
  type: IdeaType;
  label: string;
  statement: string;
  embedding: number[] | null;
  embeddingText?: string;
  themes?: string[];
}

export function createIdea(input: NewIdeaInput): Idea {
  return insertIdea(input, nextGlobalId());
}

/** Offline authored ideas keep their identity before joining the Mac corpus.
 * They never reserve or advance the Mac's sequential derived-idea counter. */
export function createIdeaWithIdentity(input: NewIdeaInput, globalId: string): Idea {
  if (!/^manual-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(globalId)) {
    throw new Error('Invalid authored idea identity');
  }
  return insertIdea(input, globalId);
}

function insertIdea(input: NewIdeaInput, global_id: string): Idea {
  const db = getDb();
  const created_at = new Date().toISOString();
  const embeddingText = input.embeddingText ?? embeddingTextForIdea(input);
  const meta = input.embedding ? embeddingMetaFor(embeddingText, input.embedding) : null;
  db.prepare(
    `INSERT INTO ideas (
       global_id, type, label, statement, embedding, created_at,
       embedding_provider, embedding_model, embedding_dim, embedding_text_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    global_id,
    input.type,
    input.label,
    input.statement,
    input.embedding ? encodeEmbedding(input.embedding) : null,
    created_at,
    meta?.provider ?? null,
    meta?.model ?? null,
    meta?.dim ?? null,
    meta?.textHash ?? null
  );
  return { global_id, ...input, created_at };
}

export function updateIdeaEmbedding(globalId: string, text: string, embedding: number[]): void {
  const meta = embeddingMetaFor(text, embedding);
  getDb()
    .prepare(
      `UPDATE ideas
          SET embedding = ?,
              embedding_provider = ?,
              embedding_model = ?,
              embedding_dim = ?,
              embedding_text_hash = ?
        WHERE global_id = ?`
    )
    .run(encodeEmbedding(embedding), meta.provider, meta.model, meta.dim, meta.textHash, globalId);
}

export function clearAllEmbeddings(): void {
  getDb()
    .prepare(
      `UPDATE ideas
          SET embedding = NULL,
              embedding_provider = NULL,
              embedding_model = NULL,
              embedding_dim = NULL,
              embedding_text_hash = NULL
        WHERE embedding IS NOT NULL`
    )
    .run();
}

export function getIdea(globalId: string): Idea | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ideas WHERE global_id = ?').get(globalId) as
    | (Omit<Idea, 'type' | 'label' | 'statement' | 'embedding'> & {
        type: IdeaType | null;
        label: string | null;
        statement: string | null;
        embedding: Buffer | null;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    type: row.type ?? 'claim',
    label: row.label ?? row.global_id,
    statement: row.statement ?? '',
    embedding: row.embedding ? decodeEmbedding(row.embedding) : null,
  };
}

/**
 * Lightweight idea lookup that skips the embedding BLOB. The detail panels and
 * edge explanations never need the vector, so decoding a 1536-float array on
 * every tap was pure waste (and the main reason the sidebar felt laggy on big
 * libraries — each tap re-decoded embeddings for the idea and both endpoints).
 */
export function getIdeaSummary(globalId: string): Idea | null {
  const db = getDb();
  const row = db
    .prepare('SELECT global_id, type, label, statement, created_at FROM ideas WHERE global_id = ?')
    .get(globalId) as (Omit<Idea, 'type' | 'label' | 'statement' | 'embedding'> & {
      type: IdeaType | null;
      label: string | null;
      statement: string | null;
    }) | undefined;
  if (!row) return null;
  return {
    ...row,
    type: row.type ?? 'claim',
    label: row.label ?? row.global_id,
    statement: row.statement ?? '',
    embedding: null,
  };
}

/**
 * Permanently delete one corpus idea. Unlike a rescan purge, this is an explicit
 * user action, so the stable identity and embedding are intentionally removed as
 * well as every direct derived reference. User-authored note text is preserved;
 * only its now-invalid manual-idea provenance is detached.
 */
export function deleteIdea(globalId: string): boolean {
  const db = getDb();
  let deleted = false;
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM ideas WHERE global_id=?').get(globalId)) return;
    db.prepare('DELETE FROM gaps WHERE related_idea=?').run(globalId);
    db.prepare('DELETE FROM external_refs WHERE from_idea=?').run(globalId);
    db.prepare("DELETE FROM project_chapter_idea_relations WHERE target_kind='idea' AND target_id=?").run(globalId);
    db.prepare("DELETE FROM db_relations WHERE target_kind='idea' AND target_id=? AND target_vault_id IS NULL").run(globalId);
    db.prepare('UPDATE notes SET source_json=NULL, updated_at=? WHERE json_valid(source_json) AND json_extract(source_json, \'$.note\')=\'manual-idea\' AND json_extract(source_json, \'$.ref\')=?')
      .run(new Date().toISOString(), globalId);
    db.prepare('DELETE FROM edge_feedback WHERE from_id=? OR to_id=?').run(globalId, globalId);
    db.prepare('DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE from_id=? OR to_id=?)').run(globalId, globalId);
    db.prepare('DELETE FROM edges WHERE from_id=? OR to_id=?').run(globalId, globalId);
    db.prepare('DELETE FROM evidence WHERE global_id=?').run(globalId);
    db.prepare('DELETE FROM idea_occurrences WHERE global_id=?').run(globalId);
    db.prepare('DELETE FROM idea_theme_links WHERE global_id=?').run(globalId);
    deleted = db.prepare('DELETE FROM ideas WHERE global_id=?').run(globalId).changes > 0;
  })();
  return deleted;
}

/** All ideas with a current-model embedding. Kept for small in-memory consumers. */
export function ideasWithEmbeddings(): { global_id: string; type: IdeaType; label: string; statement: string; embedding: number[] }[] {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const rows = db
    .prepare(
      `SELECT global_id, type, label, statement, embedding
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?
          AND embedding_dim IS NOT NULL
          AND orphaned_at IS NULL`
    )
    .all(config.provider, config.model) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    embedding: Buffer;
  }[];
  return rows.map((r) => ({ ...r, embedding: decodeEmbedding(r.embedding) }));
}

export interface IdeaVectorRecord {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  vector: Float32Array;
}

/** Current idea vectors as compact Float32Array views for transfer to the compute worker. */
export function ideaVectorsForCompute(): IdeaVectorRecord[] {
  const config = currentEmbeddingConfig();
  const rows = getDb()
    .prepare(
      `SELECT global_id, type, label, statement, embedding
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?
          AND embedding_dim IS NOT NULL
          AND orphaned_at IS NULL`
    )
    .all(config.provider, config.model) as Array<{
      global_id: string;
      type: IdeaType;
      label: string;
      statement: string;
      embedding: Buffer;
    }>;
  return rows.map((row) => ({
    global_id: row.global_id,
    type: row.type,
    label: row.label,
    statement: row.statement,
    vector: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
  }));
}

export function allIdeaCandidates(options: { includeDormant?: boolean } = {}): { global_id: string; type: IdeaType; label: string; statement: string }[] {
  const dormantSql = options.includeDormant ? '' : 'WHERE orphaned_at IS NULL';
  return getDb().prepare(`SELECT global_id, type, label, statement FROM ideas ${dormantSql}`).all() as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
  }[];
}

/**
 * Find ideas whose embedding cosine-similarity to the query vector meets the threshold.
 * Pushes the computation into SQLite via the vec_cosine() custom function so we never
 * load all embeddings into JS memory.
 */
export function findSimilarIdeas(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  options: { excludeIds?: string[]; includeDormant?: boolean } = {}
): { global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[] {
  const buf = encodeEmbedding(queryEmbedding);
  const config = currentEmbeddingConfig();
  const excluded = options.excludeIds ?? [];
  const excludeSql = excluded.length ? `AND global_id NOT IN (${excluded.map(() => '?').join(',')})` : '';
  // Dormant ideas (no occurrences after a rescan) are hidden from every
  // retrieval consumer; only fusion opts in, so it can revive them.
  const dormantSql = options.includeDormant ? '' : 'AND orphaned_at IS NULL';
  const manualScope = getSettings().academicMode === 'manual' ? `AND ${manualIdeaVisible('ideas.global_id')}` : '';
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT global_id, type, label, statement, vec_cosine(embedding, ?) AS similarity
         FROM ideas
         WHERE embedding IS NOT NULL
           AND embedding_provider = ?
           AND embedding_model = ?
           AND embedding_dim = ?
           ${dormantSql}
           ${manualScope}
           ${excludeSql}
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(buf, config.provider, config.model, queryEmbedding.length, ...excluded, threshold, limit) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    similarity: number;
  }[];
}

/**
 * The same search as `findSimilarIdeas`, paged so it does not hold the main process
 * for the whole scan (see ./vectorScan.ts). Used by the long generations, which run
 * several of these per report while the user is still using the app.
 */
export async function findSimilarIdeasPaged(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  opts: { nodusIds?: string[]; ideaIds?: string[] } = {}
): Promise<{ global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[]> {
  if (limit <= 0 || opts.nodusIds?.length === 0 || opts.ideaIds?.length === 0) return [];
  const config = currentEmbeddingConfig();
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  // `+` keeps SQLite on the (global_id, nodus_id) key by global_id only: an idea has one or two
  // occurrences, each checked against the scope. Without it the planner probes the key once
  // per scoped work for every idea — with a whole library in scope (14,055 works) that was
  // ~700M probes and a 16 s scan per research round; now 0.3 s.
  const scoped = nodusIds.length
    ? ` AND EXISTS (
          SELECT 1 FROM idea_occurrences scoped_occurrence
           WHERE scoped_occurrence.global_id = ideas.global_id
             AND +scoped_occurrence.nodus_id IN (${nodusIds.map(() => '?').join(',')})
        )`
    : '';
  const ranked = await scanSimilar<{ global_id: string; rid: number; similarity: number }>({
    table: 'ideas',
    sql: `SELECT global_id, rowid AS rid, vec_scan(embedding) AS similarity
            FROM ideas
           WHERE rowid > ? AND rowid <= ?
             AND embedding IS NOT NULL
             AND embedding_provider = ?
             AND embedding_model = ?
             AND embedding_dim = ?
             AND orphaned_at IS NULL${scoped}
             AND (? IS NULL OR global_id IN (SELECT value FROM json_each(?)))`,
    params: [config.provider, config.model, queryEmbedding.length, ...nodusIds, opts.ideaIds ? JSON.stringify(opts.ideaIds) : null, opts.ideaIds ? JSON.stringify(opts.ideaIds) : null],
    query: queryEmbedding,
    threshold,
    limit,
  });
  if (ranked.length === 0) return [];

  const byId = new Map(ranked.map((row) => [row.global_id, row.similarity]));
  const rows = getDb()
    .prepare(
      `SELECT global_id, type, label, statement
         FROM ideas
        WHERE global_id IN (${ranked.map(() => '?').join(',')})`
    )
    .all(...ranked.map((row) => row.global_id)) as { global_id: string; type: IdeaType; label: string; statement: string }[];
  return rows
    .map((row) => ({ ...row, similarity: byId.get(row.global_id) ?? 0 }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Cosine similarity of the query vector to a specific set of ideas (those that
 * carry a current-model embedding). Used to score graph-expansion neighbours,
 * where the candidate ids are already known and only need ranking.
 */
export function ideaEmbeddingSimilarities(
  queryEmbedding: number[],
  ids: string[]
): { global_id: string; type: IdeaType; label: string; statement: string; similarity: number }[] {
  if (ids.length === 0) return [];
  const buf = encodeEmbedding(queryEmbedding);
  const config = currentEmbeddingConfig();
  const placeholders = ids.map(() => '?').join(',');
  return getDb()
    .prepare(
      `SELECT global_id, type, label, statement, vec_cosine(embedding, ?) AS similarity
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?
          AND embedding_dim = ?
          AND global_id IN (${placeholders})
        ORDER BY similarity DESC`
    )
    .all(buf, config.provider, config.model, queryEmbedding.length, ...ids) as {
    global_id: string;
    type: IdeaType;
    label: string;
    statement: string;
    similarity: number;
  }[];
}

/** How many ideas carry an embedding for the current provider/model (0 ⇒ library not indexed). */
export function embeddedIdeaCount(): number {
  const config = currentEmbeddingConfig();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM ideas
        WHERE embedding IS NOT NULL
          AND embedding_provider = ?
          AND embedding_model = ?`
    )
    .get(config.provider, config.model) as { count: number };
  return row.count;
}

/**
 * Restore a dormant idea to active status. An idea is active exactly while some work holds
 * an occurrence of it (or a note owns it as a manual idea), so the only caller is
 * `upsertOccurrence`. An edge is not a reason to wake an idea: edges that other works hold
 * into a dormant idea stay in `edges`, and `visible_edges` hides them until a scan
 * re-attaches the idea.
 */
export function reviveIdea(globalId: string): void {
  getDb().prepare('UPDATE ideas SET orphaned_at = NULL WHERE global_id = ? AND orphaned_at IS NOT NULL').run(globalId);
}

/** True when the idea exists and is not dormant. Skips the embedding BLOB `getIdea` decodes. */
export function isActiveIdea(globalId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM ideas WHERE global_id = ? AND orphaned_at IS NULL').get(globalId));
}

export function upsertOccurrence(
  globalId: string,
  nodusId: string,
  role: 'principal' | 'secondary',
  development: string,
  confidence: number
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(global_id, nodus_id) DO UPDATE SET role=excluded.role, development=excluded.development, confidence=excluded.confidence`
  ).run(globalId, nodusId, role, development, confidence);
  // Revival: re-attaching a work to a dormant idea restores it everywhere
  // (graph, search) with its original global_id intact.
  reviveIdea(globalId);
}

export function addEvidence(
  globalId: string,
  nodusId: string,
  quote: string,
  location: string | null,
  kind: EvidenceKind,
  locator: { sourceRef?: string | null; pageNumber?: number | null } = {},
): string {
  const id = uuid();
  getDb()
    .prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind, source_ref, page_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, globalId, nodusId, quote, location, kind, locator.sourceRef ?? null, locator.pageNumber ?? null);
  return id;
}

export interface NewEdgeInput {
  id?: string;
  from_id: string;
  to_id: string;
  type: string;
  basis: string;
  confidence: number;
  source_work: string | null;
  trace?: EdgeTraceInput | null;
}

export interface EdgeTraceInput {
  method: EdgeTrace['method'];
  model?: ModelRef | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  similarity?: number | null;
  rationale?: string | null;
}

function canonicalEdgeEndpoints(fromId: string, toId: string, type: EdgeType): { from_id: string; to_id: string } {
  if (SYMMETRIC_EDGE_TYPES.has(type) && fromId > toId) {
    return { from_id: toId, to_id: fromId };
  }
  return { from_id: fromId, to_id: toId };
}

export function canonicalEdgeKey(fromId: string, toId: string, type: EdgeType): string {
  const endpoints = canonicalEdgeEndpoints(fromId, toId, type);
  return `${endpoints.from_id}|${endpoints.to_id}|${type}`;
}

export function upsertEdgeTrace(edgeId: string, trace: EdgeTraceInput): void {
  getDb()
    .prepare(
      `INSERT INTO edge_traces (
         edge_id, method, model_json, embedding_provider, embedding_model, similarity, rationale, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(edge_id) DO UPDATE SET
         method = excluded.method,
         model_json = excluded.model_json,
         embedding_provider = excluded.embedding_provider,
         embedding_model = excluded.embedding_model,
         similarity = excluded.similarity,
         rationale = excluded.rationale,
         created_at = excluded.created_at`
    )
    .run(
      edgeId,
      trace.method,
      trace.model ? JSON.stringify(trace.model) : null,
      trace.embeddingProvider ?? null,
      trace.embeddingModel ?? null,
      trace.similarity ?? null,
      trace.rationale ?? null,
      new Date().toISOString()
    );
}

export function getEdgeTrace(edgeId: string): EdgeTrace | null {
  const row = getDb()
    .prepare('SELECT * FROM edge_traces WHERE edge_id = ?')
    .get(edgeId) as
    | {
        edge_id: string;
        method: string;
        model_json: string | null;
        embedding_provider: string | null;
        embedding_model: string | null;
        similarity: number | null;
        rationale: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  let model: ModelRef | null = null;
  if (row.model_json) {
    try {
      model = JSON.parse(row.model_json) as ModelRef;
    } catch {
      model = null;
    }
  }
  return {
    edgeId: row.edge_id,
    method: row.method,
    model,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    similarity: row.similarity,
    rationale: row.rationale,
    createdAt: row.created_at,
  };
}

/** Insert an edge, de-duplicating on canonical (from, to, type); keeps the higher confidence. */
export function addEdge(input: NewEdgeInput): string | null {
  const type = normalizeEdgeType(input.type);
  if (!type) return null;
  const basis = normalizeEdgeBasis(input.basis);
  const confidence = clampConfidence(input.confidence);
  const endpoints = input.source_work === 'manual' ? { from_id: input.from_id, to_id: input.to_id } : canonicalEdgeEndpoints(input.from_id, input.to_id, type);
  // An idea related to itself is never a relation: it happens when fusion maps two
  // labels of one scan onto the same existing idea.
  if (endpoints.from_id === endpoints.to_id) return null;
  const db = getDb();
  const existing = db
    .prepare('SELECT id, confidence, source_work FROM edges WHERE from_id = ? AND to_id = ? AND type = ?')
    .get(endpoints.from_id, endpoints.to_id, type) as { id: string; confidence: number; source_work: string | null } | undefined;
  if (existing) {
    if (confidence > existing.confidence) {
      db.prepare('UPDATE edges SET confidence = ?, basis = ? WHERE id = ?').run(
        confidence,
        basis,
        existing.id
      );
    }
    // Ownership and provenance must move together: purgeDeepData deletes a work's
    // edges by source_work and recomputable ones by trace method, so an owner that
    // disagrees with its trace is either never cleaned up or cleaned up by the wrong
    // purge. A scan that re-finds an unowned (derived) edge claims it; a derived pass
    // that re-finds an owned edge leaves the owner's trace alone.
    if (existing.source_work == null && input.source_work != null) {
      db.prepare('UPDATE edges SET source_work = ? WHERE id = ?').run(input.source_work, existing.id);
      if (input.trace) upsertEdgeTrace(existing.id, input.trace);
    } else if (!(existing.source_work != null && input.source_work == null) && input.trace) {
      upsertEdgeTrace(existing.id, input.trace);
    }
    return existing.id;
  }
  const id = input.id ?? uuid();
  db.prepare(
    'INSERT INTO edges (id, from_id, to_id, type, basis, confidence, source_work) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, endpoints.from_id, endpoints.to_id, type, basis, confidence, input.source_work);
  if (input.trace) upsertEdgeTrace(id, input.trace);
  return id;
}

/**
 * Reinitialise the whole graph: drop every piece of derived analysis (ideas, themes,
 * edges, authors, gaps, evidence) and reset each work's scan status to 'none' so it can
 * be analysed again from scratch. The Zotero-sourced library (works) and the user's
 * settings are kept — only the graph is wiped.
 */
export function resetGraphData(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM idea_occurrences;
      DELETE FROM evidence;
      DELETE FROM edge_traces;
      DELETE FROM edges;
      DELETE FROM ideas;
      DELETE FROM idea_theme_links;
      DELETE FROM gaps;
      DELETE FROM external_refs;
      DELETE FROM tutor_saved_routes;
      DELETE FROM work_authors;
      DELETE FROM author_relations;
      DELETE FROM authors;
      DELETE FROM work_themes;
      DELETE FROM themes;
      DELETE FROM work_summaries;
      DELETE FROM work_idea_synthesis;
      UPDATE works SET
        light_status = 'none', light_at = NULL, light_hash = NULL,
        deep_status = 'none', deep_at = NULL, deep_hash = NULL,
        summary_status = 'none', summary_at = NULL, summary_hash = NULL, summary_error = NULL,
        source_type = NULL, notes = NULL, deep_error = NULL, deep_queued = 0;
    `);
  });
  tx();
}

/** Remove all derived deep-scan data for a work, so it can be cleanly re-scanned. */
export function purgeDeepData(nodusId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const impacted = (db.prepare('SELECT DISTINCT global_id FROM idea_occurrences WHERE nodus_id = ?').all(nodusId) as Array<{ global_id: string }>)
      .map((row) => row.global_id);
    if (impacted.length > 0) {
      const placeholders = impacted.map(() => '?').join(',');
      // Cross-work semantic edges are derived from the old embeddings/statements.
      // Remove only recomputable relations; explicit/deep edges owned by other works
      // remain physically present and the visible view hides dormant endpoints.
      db.prepare(`DELETE FROM edges WHERE id IN (
        SELECT e.id FROM edges e LEFT JOIN edge_traces et ON et.edge_id = e.id
         WHERE (e.from_id IN (${placeholders}) OR e.to_id IN (${placeholders}))
           AND (e.id LIKE 'reproc:%' OR et.method IN ('reprocess', 'bridge'))
      )`).run(...impacted, ...impacted);
    }
    db.prepare('DELETE FROM idea_occurrences WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM evidence WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE source_work = ?)').run(nodusId);
    db.prepare('DELETE FROM edges WHERE source_work = ?').run(nodusId);
    db.prepare('DELETE FROM idea_theme_links WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM gaps WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM external_refs WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_authors WHERE nodus_id = ?').run(nodusId);
    db.prepare('DELETE FROM work_idea_synthesis WHERE nodus_id = ?').run(nodusId);
    // Ideas that no longer have any occurrence go DORMANT instead of being
    // deleted. Deleting them here was the identity bug: the following rescan
    // re-extracted the same idea but fusion had nothing to match against, so it
    // minted a new global_id and orphaned every reference to the old one
    // (notes, tutor routes, drafts, edge feedback). A dormant idea keeps its
    // global_id and embedding, stays out of the graph and search (no
    // occurrences / orphaned_at filters), remains a fusion candidate, and is
    // revived by upsertOccurrence the moment any scan re-attaches it. Manual
    // ideas are never flagged: they are owned by a note and may legitimately
    // have no works linked yet. Edges do not keep an idea awake either: the
    // ones other works hold into it stay in `edges`, `visible_edges` hides them
    // while it sleeps, and they reappear when a scan re-attaches it. Those
    // works' rescans delete their own edges first, so nothing fails meanwhile.
    sleepIdeasWithoutWorks(db, new Date().toISOString());
    db.prepare(
      `DELETE FROM edges
       WHERE from_id NOT IN (SELECT global_id FROM ideas)
          OR to_id NOT IN (SELECT global_id FROM ideas)`
    ).run();
    db.prepare(
      `DELETE FROM edges
        WHERE id IN (SELECT edge_id FROM edge_traces WHERE method IN ('reprocess', 'bridge'))
          AND (from_id IN (SELECT global_id FROM ideas WHERE orphaned_at IS NOT NULL)
            OR to_id IN (SELECT global_id FROM ideas WHERE orphaned_at IS NOT NULL))`
    ).run();
    db.prepare('DELETE FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').run();
  });
  tx();
}

/**
 * Fail-closed audit for the deep-analysis replacement of one work. Call this from the
 * same transaction that writes the replacement: any violation throws and restores the
 * complete previous analysis instead of committing a partially linked graph.
 */
export function assertDeepDataIntegrity(nodusId: string): void {
  const db = getDb();
  const checks: Array<[string, string]> = [
    ['occurrences→ideas', `SELECT COUNT(*) AS n FROM idea_occurrences io
      LEFT JOIN ideas i ON i.global_id = io.global_id
      WHERE io.nodus_id = ? AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`],
    ['evidence→ideas', `SELECT COUNT(*) AS n FROM evidence ev
      LEFT JOIN ideas i ON i.global_id = ev.global_id
      WHERE ev.nodus_id = ? AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`],
    ['edges→active ideas', `SELECT COUNT(*) AS n FROM edges e
      LEFT JOIN ideas src ON src.global_id = e.from_id
      LEFT JOIN ideas dst ON dst.global_id = e.to_id
      WHERE e.source_work = ? AND (
        src.global_id IS NULL OR dst.global_id IS NULL
        OR src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL
      )`],
    ['theme links→ideas', `SELECT COUNT(*) AS n FROM idea_theme_links itl
      LEFT JOIN ideas i ON i.global_id = itl.global_id
      WHERE itl.nodus_id = ? AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`],
    ['gaps→ideas', `SELECT COUNT(*) AS n FROM gaps g
      LEFT JOIN ideas i ON i.global_id = g.related_idea
      WHERE g.nodus_id = ? AND g.related_idea IS NOT NULL
        AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`],
    ['gaps→evidence', `SELECT COUNT(*) AS n FROM gaps g
      LEFT JOIN evidence ev ON ev.id = g.evidence_id
      WHERE g.nodus_id = ? AND g.evidence_id IS NOT NULL AND ev.id IS NULL`],
    ['external refs→ideas', `SELECT COUNT(*) AS n FROM external_refs er
      LEFT JOIN ideas i ON i.global_id = er.from_idea
      WHERE er.nodus_id = ? AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`],
    ['external refs→evidence', `SELECT COUNT(*) AS n FROM external_refs er
      LEFT JOIN evidence ev ON ev.id = er.evidence_id
      WHERE er.nodus_id = ? AND er.evidence_id IS NOT NULL AND ev.id IS NULL`],
  ];
  const failures: string[] = [];
  for (const [label, sql] of checks) {
    const count = Number((db.prepare(sql).get(nodusId) as { n: number } | undefined)?.n ?? 0);
    if (count > 0) failures.push(`${label}: ${count}`);
  }
  const orphanTraces = Number((db.prepare(
    'SELECT COUNT(*) AS n FROM edge_traces et LEFT JOIN edges e ON e.id = et.edge_id WHERE e.id IS NULL',
  ).get() as { n: number } | undefined)?.n ?? 0);
  if (orphanTraces > 0) failures.push(`edge traces→edges: ${orphanTraces}`);
  if (failures.length > 0) {
    throw new Error(`Deep analysis integrity check failed for ${nodusId}: ${failures.join(', ')}`);
  }
}

/**
 * Delete ideas that have been dormant (no occurrences) longer than maxAgeDays.
 * Runs at startup as maintenance: recent dormancy is a revival opportunity —
 * fusion re-matches the idea on the next rescan and keeps its global_id —
 * while long-dormant ideas are genuinely gone from the corpus. An idea that
 * user content still points at (a chapter, a database relation, a coverage
 * link, an edge verdict…) is kept asleep instead, so the reference keeps
 * resolving. Returns the number of pruned ideas.
 */
export function pruneDormantIdeas(maxAgeDays = 30): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  let pruned = 0;
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `DELETE FROM ideas
          WHERE orphaned_at IS NOT NULL
            AND orphaned_at < ?
            AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = ideas.global_id)
            AND global_id NOT IN (${MANUAL_IDEA_REFS_SQL})
            AND global_id NOT IN (${userIdeaReferencesSql(db)})`
      )
      .run(cutoff);
    pruned = result.changes;
    if (pruned > 0) {
      db.prepare(
        `DELETE FROM edges
         WHERE from_id NOT IN (SELECT global_id FROM ideas)
            OR to_id NOT IN (SELECT global_id FROM ideas)`
      ).run();
      db.prepare('DELETE FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').run();
    }
  });
  tx();
  return pruned;
}

// ── Detail panels ───────────────────────────────────────────────────────────

/**
 * @param worksCache Works already loaded by the caller. `getWorksByIds` is a batch
 *   API, but called from here it only ever gets one idea's worth of ids at a time —
 *   usually a single one — so a caller assembling many ideas pays its four queries
 *   once per idea. Handing in a map built by that same function for the whole set
 *   collapses them to four in total; the values are identical either way.
 */
export function getIdeaDetail(globalId: string, worksCache?: Map<string, WorkView>): IdeaDetail | null {
  const db = getDb();
  const idea = getIdeaSummary(globalId);
  if (!idea) return null;
  const occRows = db.prepare('SELECT * FROM idea_occurrences WHERE global_id = ?').all(globalId) as {
    global_id: string;
    nodus_id: string;
    role: 'principal' | 'secondary';
    development: string;
    confidence: number;
  }[];
  // Batch-load all works for the occurrences in 2 queries instead of N+1
  // (previously each occurrence called getWork() → 2 queries each).
  const needed = worksCache ? occRows.map((o) => o.nodus_id).filter((id) => !worksCache.has(id)) : occRows.map((o) => o.nodus_id);
  const fetched = needed.length ? getWorksByIds(needed) : null;
  const worksById = (id: string) => worksCache?.get(id) ?? fetched?.get(id);
  const occurrences = occRows
    .map((o) => {
      const work = worksById(o.nodus_id);
      return work ? { ...o, work } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const evidence = db.prepare('SELECT * FROM evidence WHERE global_id = ?').all(globalId) as Evidence[];
  const themes = (db.prepare('SELECT DISTINCT t.label FROM idea_theme_links it JOIN themes t ON t.theme_id=it.theme_id WHERE it.global_id=? ORDER BY t.label').all(globalId) as { label: string }[]).map(row => row.label);
  return { idea, occurrences, evidence, themes };
}

/**
 * Every idea the graph would show, with only the fields a picker reads.
 *
 * Same population as the ideas lens — an idea counts once at least one
 * un-archived, deep-analysed work carries it — expressed as EXISTS rather than a
 * join plus DISTINCT, so no statement text has to be sorted to deduplicate.
 */
export function listPickerIdeas(): IdeaPickerItem[] {
  const rows = getDb()
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement
         FROM ideas i
        WHERE (${manualIdeaVisible('i.global_id')} OR EXISTS (
          SELECT 1
            FROM idea_occurrences io
            JOIN works w ON w.nodus_id = io.nodus_id
           WHERE io.global_id = i.global_id
             AND w.archived = 0
             AND w.deep_status = 'done'
        ))`
    )
    .all() as Array<Omit<IdeaPickerItem, 'type' | 'label' | 'statement'> & {
      type: IdeaType | null;
      label: string | null;
      statement: string | null;
    }>;
  return rows.map((row) => ({
    ...row,
    type: row.type ?? 'claim',
    label: row.label ?? row.global_id,
    statement: row.statement ?? '',
  }));
}

export function listIdeasPage(request: IdeaPageRequest): IdeaPage {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, Math.trunc(request.limit)));
  const offset = Math.max(0, Math.trunc(request.offset));
  const clauses = [
    `(${manualIdeaVisible('i.global_id')} OR EXISTS (
      SELECT 1 FROM idea_occurrences active_io
      JOIN works active_w ON active_w.nodus_id = active_io.nodus_id
      WHERE active_io.global_id = i.global_id
        AND active_w.archived = 0
        AND active_w.deep_status = 'done'
    ))`,
  ];
  const params: Record<string, unknown> = { limit, offset };
  if (request.type) {
    clauses.push('i.type = @type');
    params.type = request.type;
  }
  const search = request.search?.trim().toLowerCase();
  if (search) {
    clauses.push('(LOWER(i.label) LIKE @search OR LOWER(i.statement) LIKE @search)');
    params.search = `%${search}%`;
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM ideas i ${where}`).get(params) as { n: number }).n);
  const order = {
    label: 'i.label COLLATE NOCASE ASC',
    type: 'i.type ASC, i.label COLLATE NOCASE ASC',
    works: 'work_count DESC, i.label COLLATE NOCASE ASC',
    connections: 'connection_count DESC, i.label COLLATE NOCASE ASC',
    confidence: 'max_confidence DESC, i.label COLLATE NOCASE ASC',
  }[request.sort];
  const rows = db
    .prepare(
      `SELECT i.global_id AS id, i.label, i.type, i.statement,
              (SELECT COUNT(DISTINCT io.nodus_id)
                 FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
                WHERE io.global_id = i.global_id AND w.archived = 0 AND (w.deep_status = 'done' OR ${manualIdeaVisible('io.global_id')})) AS work_count,
              (SELECT MAX(io.confidence) FROM idea_occurrences io WHERE io.global_id = i.global_id) AS max_confidence,
              (SELECT COUNT(*) FROM visible_edges e
                WHERE e.type != 'contains' AND (e.from_id = i.global_id OR e.to_id = i.global_id)) AS connection_count
         FROM ideas i
         ${where}
        ORDER BY ${order}
        LIMIT @limit OFFSET @offset`
    )
    .all(params) as Array<{
      id: string;
      label: string | null;
      type: IdeaType | null;
      statement: string | null;
      work_count: number;
      max_confidence: number | null;
      connection_count: number;
    }>;
  const ids = rows.map((row) => row.id);
  const themes = new Map<string, string[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const themeRows = db
      .prepare(
        `SELECT DISTINCT l.global_id, t.label
           FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id
          WHERE l.global_id IN (${placeholders})
          ORDER BY t.label COLLATE NOCASE`
      )
      .all(...ids) as Array<{ global_id: string; label: string }>;
    for (const row of themeRows) {
      const labels = themes.get(row.global_id) ?? [];
      labels.push(row.label);
      themes.set(row.global_id, labels);
    }
  }
  const items: IdeaListItem[] = rows.map((row) => ({
    id: row.id,
    label: row.label ?? row.id,
    type: row.type ?? 'claim',
    statement: row.statement ?? '',
    workCount: Number(row.work_count),
    themes: themes.get(row.id) ?? [],
    maxConfidence: Number(row.max_confidence ?? 0),
    connectionCount: Number(row.connection_count),
  }));
  return { items, total, offset, limit };
}

export function listIdeaConnections(globalId: string): IdeaConnection[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.id, e.from_id, e.to_id, e.type AS edge_type, e.basis, e.confidence,
              other.global_id AS other_id, other.label, other.type AS idea_type, other.statement,
              (SELECT COUNT(DISTINCT io.nodus_id) FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
                WHERE io.global_id = other.global_id AND w.archived = 0 AND (w.deep_status = 'done' OR ${manualIdeaVisible('io.global_id')})) AS work_count,
              (SELECT MAX(io.confidence) FROM idea_occurrences io WHERE io.global_id = other.global_id) AS max_confidence,
              (SELECT COUNT(*) FROM visible_edges linked
                WHERE linked.type != 'contains' AND (linked.from_id = other.global_id OR linked.to_id = other.global_id)) AS connection_count
         FROM visible_edges e
         JOIN ideas other ON other.global_id = CASE WHEN e.from_id = @id THEN e.to_id ELSE e.from_id END
        WHERE e.type != 'contains' AND (e.from_id = @id OR e.to_id = @id)
        ORDER BY e.confidence DESC, other.label COLLATE NOCASE`
    )
    .all({ id: globalId }) as Array<{
      id: string;
      from_id: string;
      to_id: string;
      edge_type: string;
      basis: EdgeBasis;
      confidence: number;
      other_id: string;
      label: string | null;
      idea_type: IdeaType | null;
      statement: string | null;
      work_count: number;
      max_confidence: number | null;
      connection_count: number;
    }>;
  return rows.map((row) => ({
    edge: {
      id: row.id,
      source: row.from_id,
      target: row.to_id,
      type: row.edge_type,
      basis: row.basis,
      confidence: row.confidence,
    } satisfies GraphEdge,
    node: {
      id: row.other_id,
      label: row.label ?? row.other_id,
      type: row.idea_type ?? 'claim',
      statement: row.statement ?? '',
      workCount: Number(row.work_count),
      themes: [],
      maxConfidence: Number(row.max_confidence ?? 0),
      connectionCount: Number(row.connection_count),
    },
  }));
}

/**
 * Inverse of getIdeaDetail's occurrences: given a work's nodus_id, return every
 * idea anchored to it, paired with the fields specific to that idea↔work
 * occurrence (role, confidence, development). Read-only; no generation.
 */
export function getIdeasByWork(nodusId: string, limit: number, offset: number): { ideas: IdeaByWork[]; total: number } {
  const db = getDb();
  const total = (
    db.prepare('SELECT COUNT(*) AS count FROM idea_occurrences WHERE nodus_id = ?').get(nodusId) as { count: number }
  ).count;
  const ideas = db
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement, o.role, o.confidence, o.development
         FROM idea_occurrences o
         JOIN ideas i ON i.global_id = o.global_id
        WHERE o.nodus_id = ?
        ORDER BY i.global_id
        LIMIT ? OFFSET ?`
    )
    .all(nodusId, limit, offset) as IdeaByWork[];
  return { ideas, total };
}

/** Every direct idea↔idea edge touching an idea, with its evidence and trace. */
export function getIdeaEdges(globalId: string): EdgeDetail[] {
  const rows = getDb()
    .prepare('SELECT id FROM visible_edges WHERE from_id = ? OR to_id = ? ORDER BY confidence DESC, id')
    .all(globalId, globalId) as { id: string }[];
  return rows.map((row) => getEdgeDetail(row.id)).filter((detail): detail is EdgeDetail => detail !== null);
}

export function getEdgeDetail(edgeId: string): EdgeDetail | null {
  const db = getDb();
  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as Edge | undefined;
  if (!edge) return null;
  const from = getIdeaSummary(edge.from_id);
  const to = getIdeaSummary(edge.to_id);
  // Evidence on the source work for either endpoint idea.
  const evidence = edge.source_work
    ? (db
        .prepare('SELECT * FROM evidence WHERE nodus_id = ? AND global_id IN (?, ?)')
        .all(edge.source_work, edge.from_id, edge.to_id) as Evidence[])
    : [];
  return {
    edge,
    fromLabel: from?.label ?? edge.from_id,
    toLabel: to?.label ?? edge.to_id,
    explanation: contradictionExplanation(edge, from, to),
    evidence,
    trace: getEdgeTrace(edgeId),
    feedback: getEdgeFeedback(edge.from_id, edge.to_id, edge.type),
  };
}

function contradictionExplanation(edge: Edge, from: Idea | null, to: Idea | null): string | null {
  if (edge.type !== 'contradicts' && edge.type !== 'refutes') return null;
  const left = shortText(from?.statement || from?.label || edge.from_id);
  const right = shortText(to?.statement || to?.label || edge.to_id);
  const noun = edge.type === 'refutes' ? 'refutación' : 'contradicción';
  return `La ${noun} detectada es que "${left}" entra en tensión con "${right}".`;
}

function shortText(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}...`;
}
