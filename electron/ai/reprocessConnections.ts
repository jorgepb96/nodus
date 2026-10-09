import { assertAcademicAutomation } from './academicMode';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import type {
  EdgeType,
  ModelRef,
  ReprocessConnectionsOptions,
  ReprocessConnectionsResult,
} from '@shared/types';
import { reprocessConnectionsPromptPack } from '@shared/reprocessConnectionsPromptPacks';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import {
  listThemeLabels,
  normalizeThemeLabel,
  pruneOrphanThemes,
  replaceIdeaThemeLinks,
  setWorkThemes,
} from '../db/themesRepo';
import {
  addEdge,
  canonicalEdgeKey,
  currentEmbeddingConfig,
  ideaVectorsForCompute,
  normalizeEdgeType,
} from '../db/ideasRepo';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';
import { completeJsonWithHeadroom } from './structuredHeadroom';
import { IDEA_EMBEDDING_THEME_LABELS_SQL } from '../db/ideaEmbeddingText';
import { computeNearestNeighbors } from '../graph/computeHost';
import { adaptiveStructuredBatch } from './adaptiveStructuredBatch';
import { localTaskOutputTokens } from './localRequestPlanner';

const THEME_BATCH = 30;
const RELATION_TOP_K_PER_IDEA = 10;
const RELATION_MAX_CANDIDATES = 1400;
const RELATION_VALIDATION_BATCH = 15;
const STATEMENT_CLIP = 2000;
const REPROC_EDGE_PREFIX = 'reproc:';

const RELATION_TYPES = new Set<EdgeType>([
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
]);

interface IdeaRow {
  global_id: string;
  type: string;
  label: string;
  statement: string;
}

interface ThemeAssignmentResult {
  assignments: { id: string; themes: string[] }[];
}

interface RelationExtractionResult {
  relations: { from: string; to: string; type: string; confidence?: number; rationale?: string }[];
}

interface RelationCandidate {
  fromId: string;
  toId: string;
  fromType: string;
  toType: string;
  fromLabel: string;
  toLabel: string;
  fromStatement: string;
  toStatement: string;
  fromThemes: string[];
  toThemes: string[];
  similarity: number;
}

export interface ReprocessProgress {
  /** Current phase: 'themes' (idea→theme assignment) or 'relations' (idea↔idea). */
  phase: 'themes' | 'relations';
  /** Human-readable label for the current phase. */
  label: string;
  /** Batch index within the current phase (1-based). */
  current: number;
  /** Total batches in the current phase. */
  total: number;
}

function isThemeAssignmentResult(v: unknown): v is ThemeAssignmentResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ThemeAssignmentResult).assignments);
}

function isRelationExtractionResult(v: unknown): v is RelationExtractionResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as RelationExtractionResult).relations);
}

function clip(text: string): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > STATEMENT_CLIP ? `${clean.slice(0, STATEMENT_CLIP)}…` : clean;
}

/**
 * Characters of statement text one request may carry.
 *
 * A batch used to be bounded only by how many items it held, and the request ships the
 * statement of every idea in it. When the prompt leaves no room, the local planner
 * clamps the answer to its 512-token floor: the model was cut mid-JSON and the whole
 * post-processing failed with "the response was cut off at the 512-output-token limit",
 * a failure a retry reproduces because nothing about the request had changed. Keeping
 * the prompt text inside this budget leaves the planner room for the answer the task
 * needs — and, on a heavy vault, it makes the batch counter advance more than once.
 */
const BATCH_TEXT_BUDGET = 10000;

/**
 * Batches of at most `maxItems` items whose measured text stays within the budget.
 * A single item heavier than the budget travels alone rather than looping forever.
 */
function batchByText<T>(items: T[], maxItems: number, weight: (item: T) => number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentWeight = 0;
  for (const item of items) {
    const cost = weight(item);
    if (current.length > 0 && (current.length >= maxItems || currentWeight + cost > BATCH_TEXT_BUDGET)) {
      batches.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(item);
    currentWeight += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** What one idea contributes to the grouping prompt, clipped as the request clips it. */
function ideaTextWeight(idea: IdeaRow): number {
  return Math.min(idea.statement.length, STATEMENT_CLIP) + idea.label.length + 40;
}

/** What one pair contributes to the validation prompt: both sides, both statements. */
function candidateTextWeight(candidate: RelationCandidate): number {
  return Math.min(candidate.fromStatement.length, STATEMENT_CLIP) + Math.min(candidate.toStatement.length, STATEMENT_CLIP)
    + candidate.fromLabel.length + candidate.toLabel.length + 60;
}

/**
 * Re-group already-extracted ideas under the curated/existing main themes using the
 * model — without re-reading any document. Rewrites idea↔theme membership (and the
 * works' theme hubs derived from it). Optionally also re-traces idea↔idea relations
 * as inferred edges. Ideas, evidence and deep-scan edges are otherwise untouched.
 */
export async function reprocessConnections(
  options: ReprocessConnectionsOptions,
  model?: ModelRef | null,
  onProgress?: (p: ReprocessProgress) => void
): Promise<ReprocessConnectionsResult> {
  assertAcademicAutomation();
  const db = getDb();
  const settings = getSettings();
  const prompt = reprocessConnectionsPromptPack(settings.promptLanguage ?? 'es');
  const locked = settings.themesLocked;
  const themeModel = model ?? settings.extractionModel ?? settings.synthesisModel ?? null;
  const relationModel = model ?? settings.relationModel ?? settings.fusionModel ?? settings.synthesisModel ?? null;

  const ideas = db
    .prepare(
      `SELECT i.global_id, i.type, i.label, i.statement
       FROM ideas i
       WHERE EXISTS (
         SELECT 1
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
         WHERE io.global_id = i.global_id
           AND w.archived = 0
           AND w.deep_status = 'done'
       )
       ORDER BY i.global_id`
    )
    .all() as IdeaRow[];

  // idea → works it appears in (non-archived only), and work → its ideas.
  const occRows = db
    .prepare(
      `SELECT io.global_id, io.nodus_id
       FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
       WHERE w.archived = 0
         AND w.deep_status = 'done'`
    )
    .all() as { global_id: string; nodus_id: string }[];
  const worksByIdea = new Map<string, string[]>();
  for (const row of occRows) {
    (worksByIdea.get(row.global_id) ?? worksByIdea.set(row.global_id, []).get(row.global_id)!).push(row.nodus_id);
  }

  let scopedIdeaIds: Set<string> | null = null;
  if (options.nodusIds && options.nodusIds.length > 0) {
    const placeholders = options.nodusIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT global_id FROM idea_occurrences WHERE nodus_id IN (${placeholders})`)
      .all(...options.nodusIds) as Array<{ global_id: string }>;
    scopedIdeaIds = new Set(rows.map((row) => row.global_id));
  }
  const activeIdeas = ideas.filter(
    (idea) => (worksByIdea.get(idea.global_id)?.length ?? 0) > 0 && (!scopedIdeaIds || scopedIdeaIds.has(idea.global_id))
  );
  if (activeIdeas.length === 0) {
    return { ideas: 0, themedIdeas: 0, newThemes: 0, relationsAdded: 0, rethemedIdeaIds: [] };
  }

  const existingLabels = listThemeLabels();
  const existingNorm = new Map(existingLabels.map((label) => [normalizeThemeLabel(label), label]));
  const system = `${prompt.themeSystem}${locked ? prompt.themeLockedRule : prompt.themeOpenRule}`;

  // Checkpoints are reusable only for the exact content, prompt policy, model and
  // theme vocabulary. IDs alone reused stale answers after a statement/model change.
  // Policy 3 bounds each request by the text it carries: a checkpoint written under
  // the old item-count batching covers a different set of ideas, so it must not be
  // reused batch-by-batch.
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      policy: 3,
      locked,
      existingLabels: [...existingLabels].sort(),
      system,
      themeModel,
      relationModel,
      ideas: activeIdeas.map((idea) => ({
        id: idea.global_id,
        type: idea.type,
        label: idea.label,
        statement: idea.statement,
      })),
    }))
    .digest('hex');

  // ── Phase 1: reassign ideas to themes ──────────────────────────────────────
  const themesByIdea = new Map<string, string[]>();
  const newThemeNorms = new Set<string>();
  const themeBatches = batchByText(activeIdeas, THEME_BATCH, ideaTextWeight);
  const themeCheckpoints = loadCheckpoints('reprocess', contentHash, 'reproc_theme_batch');
  for (let bi = 0; bi < themeBatches.length; bi++) {
    const batch = themeBatches[bi];
    // Resume from checkpoint if available.
    const saved = themeCheckpoints.get(bi) as ThemeAssignmentResult | undefined;
    if (saved && isThemeAssignmentResult(saved)) {
      const byId = new Map(saved.assignments.map((a) => [a.id, Array.isArray(a.themes) ? a.themes : []]));
      for (const idea of batch) {
        const raw = byId.get(idea.global_id) ?? [];
        const labels: string[] = [];
        const seen = new Set<string>();
        for (const candidate of raw) {
          if (typeof candidate !== 'string' || !candidate.trim()) continue;
          const norm = normalizeThemeLabel(candidate);
          if (!norm || seen.has(norm)) continue;
          const canonical = existingNorm.get(norm);
          if (canonical) { seen.add(norm); labels.push(canonical); }
          else if (!locked) { seen.add(norm); newThemeNorms.add(norm); existingNorm.set(norm, candidate.trim()); labels.push(candidate.trim()); }
          if (labels.length >= 2) break;
        }
        themesByIdea.set(idea.global_id, labels);
      }
      continue;
    }
    onProgress?.({
      phase: 'themes',
      label: prompt.groupingProgress,
      current: bi + 1,
      total: themeBatches.length,
    });
    const result = await adaptiveStructuredBatch<IdeaRow, ThemeAssignmentResult>({
      items: batch,
      initialBatchSize: batch.length,
      combine: (parts) => ({ assignments: parts.flatMap((part) => part.assignments) }),
      execute: async (part, context) => {
        const input = {
          locked,
          available_themes: existingLabels,
          ideas: part.map((idea) => ({
            id: idea.global_id,
            type: idea.type,
            label: idea.label,
            statement: clip(idea.statement).slice(0, context.textLimit),
          })),
        };
        return completeJsonWithHeadroom<ThemeAssignmentResult>(
          {
            system,
            user: JSON.stringify(input),
            temperature: 0.1,
            maxTokens: localTaskOutputTokens('theme-assignment', part.length),
            task: 'theme-assignment',
            batchSize: part.length,
            splitDepth: context.splitDepth,
          },
          isThemeAssignmentResult,
          themeModel,
        );
      },
    });
    // Checkpoint this batch result.
    saveCheckpoint('reprocess', contentHash, 'reproc_theme_batch', bi, result);
    const byId = new Map(result.assignments.map((a) => [a.id, Array.isArray(a.themes) ? a.themes : []]));
    for (const idea of batch) {
      const raw = byId.get(idea.global_id) ?? [];
      const labels: string[] = [];
      const seen = new Set<string>();
      for (const candidate of raw) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const norm = normalizeThemeLabel(candidate);
        if (!norm || seen.has(norm)) continue;
        const canonical = existingNorm.get(norm);
        if (canonical) {
          seen.add(norm);
          labels.push(canonical);
        } else if (!locked) {
          // New theme proposed (only allowed when unlocked).
          seen.add(norm);
          newThemeNorms.add(norm);
          existingNorm.set(norm, candidate.trim());
          labels.push(candidate.trim());
        }
        if (labels.length >= 2) break;
      }
      themesByIdea.set(idea.global_id, labels);
    }
  }

  // The labels each idea is embedded with, before and after this pass: an idea whose
  // string changes (content or order) now has a stale vector.
  const embeddedThemeLabels = () => new Map((db
    .prepare(`SELECT i.global_id, ${IDEA_EMBEDDING_THEME_LABELS_SQL} AS labels FROM ideas i
      WHERE i.global_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(activeIdeas.map((idea) => idea.global_id))) as Array<{ global_id: string; labels: string }>)
    .map((row) => [row.global_id, row.labels]));
  const labelsBefore = embeddedThemeLabels();

  // Apply idea→theme membership across every occurrence of each idea.
  let themedIdeas = 0;
  // The model calls above take minutes and deep scans keep committing meanwhile (a scan
  // queued during the post-batch pass starts at once; the manual reprocess has no queue
  // guard). Write links for the occurrences as they are now, not as they were read: the
  // snapshot would drop a work that fused into an idea since, and relink a work whose
  // rescan dropped one.
  const currentWorks = db.prepare(
    `SELECT io.nodus_id FROM idea_occurrences io JOIN works w ON w.nodus_id = io.nodus_id
      WHERE io.global_id = ? AND w.archived = 0 AND w.deep_status = 'done'`
  );
  const affectedWorks = new Set<string>();
  const applyThemes = db.transaction(() => {
    for (const idea of activeIdeas) {
      const labels = themesByIdea.get(idea.global_id) ?? [];
      const before = worksByIdea.get(idea.global_id) ?? [];
      const works = (currentWorks.all(idea.global_id) as Array<{ nodus_id: string }>).map((row) => row.nodus_id);
      replaceIdeaThemeLinks(idea.global_id, works, labels, 0.8, 'explicit');
      for (const nodusId of [...before, ...works]) affectedWorks.add(nodusId);
      if (labels.length > 0) themedIdeas++;
    }
    // Rebuild only works touched by this pass. Querying the persisted links keeps
    // unchanged ideas in those works represented during an incremental run.
    for (const nodusId of affectedWorks) {
      const topLabels = (db
        .prepare(
          `SELECT t.label, COUNT(DISTINCT l.global_id) AS n
             FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id
            WHERE l.nodus_id = ?
            GROUP BY t.theme_id, t.label
            ORDER BY n DESC, t.label COLLATE NOCASE
            LIMIT 4`
        )
        .all(nodusId) as Array<{ label: string }>).map((row) => row.label);
      setWorkThemes(nodusId, topLabels);
    }
    pruneOrphanThemes();
  });
  applyThemes();
  const labelsAfter = embeddedThemeLabels();
  const rethemedIdeaIds = activeIdeas.map((idea) => idea.global_id).filter((id) => labelsBefore.get(id) !== labelsAfter.get(id));
  // Theme phase done — clear its checkpoints.
  clearCheckpoints('reprocess', contentHash, 'reproc_theme_batch');

  let relationsAdded = 0;
  if (options.relations) {
    if (scopedIdeaIds) {
      const existingThemeRows = db
        .prepare(
          `SELECT DISTINCT l.global_id, t.label
             FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id
            ORDER BY t.label COLLATE NOCASE`
        )
        .all() as Array<{ global_id: string; label: string }>;
      for (const row of existingThemeRows) {
        if (scopedIdeaIds.has(row.global_id)) continue;
        const labels = themesByIdea.get(row.global_id) ?? [];
        labels.push(row.label);
        themesByIdea.set(row.global_id, labels);
      }
    }
    relationsAdded = await reprocessRelations(activeIdeas, ideas, themesByIdea, relationModel, contentHash, onProgress, Boolean(scopedIdeaIds), prompt);
  }

  return {
    ideas: activeIdeas.length,
    themedIdeas,
    newThemes: newThemeNorms.size,
    relationsAdded,
    rethemedIdeaIds,
  };
}

/**
 * Re-derive idea↔idea relations by first retrieving semantic top-k candidate
 * pairs, then asking the model to validate only those pairs. This avoids the old
 * batch-bound blind spot where two related ideas in different batches were never
 * compared, and it keeps model work bounded by candidate count rather than N².
 */
async function reprocessRelations(
  queryIdeas: IdeaRow[],
  allIdeas: IdeaRow[],
  themesByIdea: Map<string, string[]>,
  model?: ModelRef | null,
  contentHash?: string,
  onProgress?: (p: ReprocessProgress) => void,
  incremental = false,
  prompt: ReturnType<typeof reprocessConnectionsPromptPack> = reprocessConnectionsPromptPack('es')
): Promise<number> {
  const db = getDb();
  const ideaById = new Map(allIdeas.map((idea) => [idea.global_id, idea]));
  const queryIds = new Set(queryIdeas.map((idea) => idea.global_id));
  const vectors = ideaVectorsForCompute().filter((idea) => ideaById.has(idea.global_id));
  const queryVectors = vectors.filter((idea) => queryIds.has(idea.global_id));
  if (queryVectors.length === 0 || vectors.length < 2) return 0;

  const existingPairs = new Set<string>();
  const existingRows = db
    .prepare(`SELECT from_id, to_id FROM edges WHERE id NOT LIKE '${REPROC_EDGE_PREFIX}%'`)
    .all() as { from_id: string; to_id: string }[];
  for (const row of existingRows) {
    existingPairs.add([row.from_id, row.to_id].sort().join('|'));
  }

  const candidates: RelationCandidate[] = [];
  const seenPairs = new Set<string>();
  const matches = await computeNearestNeighbors(
    queryVectors.map((idea) => ({ id: idea.global_id, vector: idea.vector })),
    vectors.map((idea) => ({ id: idea.global_id, vector: idea.vector })),
    0.68,
    RELATION_TOP_K_PER_IDEA
  );
  for (const match of matches) {
      const idea = ideaById.get(match.queryId);
      const other = ideaById.get(match.candidateId);
      if (!idea) continue;
      if (!other) continue;
      const pairKey = [idea.global_id, match.candidateId].sort().join('|');
      if (seenPairs.has(pairKey) || existingPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      candidates.push({
        fromId: idea.global_id,
        toId: match.candidateId,
        fromType: idea.type,
        toType: other.type,
        fromLabel: idea.label,
        toLabel: other.label,
        fromStatement: idea.statement,
        toStatement: other.statement,
        fromThemes: themesByIdea.get(idea.global_id) ?? [],
        toThemes: themesByIdea.get(match.candidateId) ?? [],
        similarity: match.similarity,
      });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const cappedCandidates = candidates.slice(0, RELATION_MAX_CANDIDATES);
  if (cappedCandidates.length === 0) return 0;

  const batches = batchByText(cappedCandidates, RELATION_VALIDATION_BATCH, candidateTextWeight);
  const relationHash = crypto
    .createHash('sha1')
    .update(`${contentHash ?? ''}:${cappedCandidates.map((c) => `${c.fromId}:${c.toId}`).sort().join(',')}`)
    .digest('hex');
  const proposed = new Map<string, { from: string; to: string; type: EdgeType; confidence: number; similarity: number; rationale: string | null }>();
  const candidateByPair = new Map(cappedCandidates.map((c) => [[c.fromId, c.toId].sort().join('|'), c]));
  const relCheckpoints = loadCheckpoints('reprocess', relationHash, 'reproc_relation_batch');

  const acceptRelation = (relation: RelationExtractionResult['relations'][number]) => {
    if (!relation || relation.from === relation.to) return;
    const candidate = candidateByPair.get([relation.from, relation.to].sort().join('|'));
    if (!candidate) return;
    const type = normalizeEdgeType(relation.type);
    if (!type || !RELATION_TYPES.has(type)) return;
    const confidence = Math.max(0.1, Math.min(1, Number(relation.confidence) || 0.5));
    const key = canonicalEdgeKey(relation.from, relation.to, type);
    const existing = proposed.get(key);
    if (!existing || confidence > existing.confidence) {
      proposed.set(key, {
        from: relation.from,
        to: relation.to,
        type,
        confidence,
        similarity: candidate.similarity,
        rationale: typeof relation.rationale === 'string' && relation.rationale.trim() ? relation.rationale.trim() : null,
      });
    }
  };

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const saved = relCheckpoints.get(bi) as RelationExtractionResult | undefined;
    if (saved && isRelationExtractionResult(saved)) {
      for (const relation of saved.relations) acceptRelation(relation);
      continue;
    }
    onProgress?.({
      phase: 'relations',
      label: prompt.relationsProgress,
      current: bi + 1,
      total: batches.length,
    });
    // A root checkpoint is written only after every adaptive child validates, so a
    // truncated child can never publish or checkpoint a partial relation graph.
    const result = await adaptiveStructuredBatch<RelationCandidate, RelationExtractionResult>({
      items: batch,
      initialBatchSize: batch.length,
      combine: (parts) => ({ relations: parts.flatMap((part) => part.relations) }),
      execute: async (part, context) => {
        const input = {
          pairs: part.map((candidate) => ({
            from: {
              id: candidate.fromId,
              type: candidate.fromType,
              label: candidate.fromLabel,
              statement: clip(candidate.fromStatement).slice(0, context.textLimit),
              themes: candidate.fromThemes,
            },
            to: {
              id: candidate.toId,
              type: candidate.toType,
              label: candidate.toLabel,
              statement: clip(candidate.toStatement).slice(0, context.textLimit),
              themes: candidate.toThemes,
            },
            similarity: Number(candidate.similarity.toFixed(3)),
          })),
        };
        return completeJsonWithHeadroom<RelationExtractionResult>(
          {
            system: prompt.relationSystem,
            user: JSON.stringify(input),
            temperature: 0.1,
            maxTokens: localTaskOutputTokens('relation-validation', part.length),
            task: 'relation-validation',
            batchSize: part.length,
            splitDepth: context.splitDepth,
          },
          isRelationExtractionResult,
          model,
        );
      },
    });
    saveCheckpoint('reprocess', relationHash, 'reproc_relation_batch', bi, result);
    for (const relation of result.relations) acceptRelation(relation);
  }

  let added = 0;
  const config = currentEmbeddingConfig();
  const insert = db.transaction(() => {
    // An incremental pass replaces only relations touching changed ideas. A
    // manual full pass retains the original all-reprocess semantics.
    if (incremental) {
      const ids = [...queryIds];
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%' AND (from_id IN (${placeholders}) OR to_id IN (${placeholders})))`).run(...ids, ...ids);
      db.prepare(`DELETE FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%' AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`).run(...ids, ...ids);
    } else {
      db.prepare(`DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%')`).run();
      db.prepare(`DELETE FROM edges WHERE id LIKE '${REPROC_EDGE_PREFIX}%'`).run();
    }
    for (const edge of proposed.values()) {
      const id = addEdge({
        id: `${REPROC_EDGE_PREFIX}${uuid()}`,
        from_id: edge.from,
        to_id: edge.to,
        type: edge.type,
        basis: 'inferred',
        confidence: edge.confidence,
        source_work: null,
        trace: {
          method: 'reprocess',
          model,
          embeddingProvider: config.provider,
          embeddingModel: config.model,
          similarity: edge.similarity,
          rationale: edge.rationale,
        },
      });
      if (id) added++;
    }
  });
  insert();
  // Relation phase done — clear its checkpoints.
  clearCheckpoints('reprocess', relationHash, 'reproc_relation_batch');
  return added;
}
