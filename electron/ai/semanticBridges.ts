import { assertAcademicAutomation } from './academicMode';
import crypto from 'node:crypto';
import type { EdgeType, ModelRef, PromptLanguage, SemanticBridgeResult, SemanticBridgeProgress } from '@shared/types';
import { getDb } from '../db/database';
import {
  addEdge,
  canonicalEdgeKey,
  currentEmbeddingConfig,
  ideaVectorsForCompute,
  normalizeEdgeType,
} from '../db/ideasRepo';
import { completeJsonWithHeadroom } from './structuredHeadroom';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';
import { activeEmbeddingIndex, profileFingerprint } from '../db/embeddingIndexesRepo';
import { computeNearestNeighbors } from '../graph/computeHost';
import { getSettings } from '../db/settingsRepo';
import { semanticBridgePrompt } from '@shared/graphPromptPacks';
import { adaptiveStructuredBatch } from './adaptiveStructuredBatch';
import { localTaskOutputTokens } from './localRequestPlanner';

const SIM_THRESHOLD = 0.70;
const TOP_K_PER_IDEA = 12;
const MAX_CANDIDATES = 1200;
const VALIDATION_BATCH = 15;
const CHECKPOINT_KIND = 'semantic_bridge_batch';
const MAX_MANUAL_QUERY_IDEAS = 400;

const VALID_EDGE_TYPES: EdgeType[] = [
  'extends', 'contradicts', 'applies_to', 'shares_method', 'precondition_of',
  'measures_same', 'supports', 'refutes', 'variant_of', 'refines',
];

type ProgressListener = (p: SemanticBridgeProgress) => void;

interface Candidate {
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  fromStatement: string;
  toStatement: string;
  fromType: string;
  toType: string;
  similarity: number;
  crossTheme: boolean;
}

interface ValidationInput {
  from: { id: string; type: string; label: string; statement: string };
  to: { id: string; type: string; label: string; statement: string };
  similarity: number;
}

interface LlmRelation {
  from: string;
  to: string;
  type: string;
  confidence?: number;
  rationale?: string;
}

interface LlmValidationResult {
  relations: LlmRelation[];
}

function isLlmValidationResult(v: unknown): v is LlmValidationResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as LlmValidationResult).relations);
}

const listeners = new Set<ProgressListener>();

let running = false;

function emit(p: SemanticBridgeProgress): void {
  for (const l of listeners) l(p);
}

export function onSemanticBridgeProgress(cb: ProgressListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isSemanticBridgeRunning(): boolean {
  return running;
}

function clip(text: string, max = 2000): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function loadThemeMap(): Map<string, Set<string>> {
  const db = getDb();
  const rows = db
    .prepare('SELECT global_id, theme_id FROM idea_theme_links')
    .all() as { global_id: string; theme_id: string }[];
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = map.get(r.global_id);
    if (!set) { set = new Set(); map.set(r.global_id, set); }
    set.add(r.theme_id);
  }
  return map;
}

function loadExistingEdgePairs(): Set<string> {
  const db = getDb();
  const rows = db.prepare('SELECT from_id, to_id FROM edges').all() as { from_id: string; to_id: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    set.add(`${r.from_id}|${r.to_id}`);
    set.add(`${r.to_id}|${r.from_id}`);
  }
  return set;
}

function bridgeQueryIds(nodusIds?: string[]): Set<string> {
  const db = getDb();
  if (nodusIds && nodusIds.length > 0) {
    const placeholders = nodusIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT global_id FROM idea_occurrences WHERE nodus_id IN (${placeholders})`)
      .all(...nodusIds) as Array<{ global_id: string }>;
    return new Set(rows.map((row) => row.global_id));
  }
  // A manual full-vault pass advances through the least-connected ideas first.
  // Keeping each run bounded prevents an accidental 10k×10k scan.
  const rows = db
    .prepare(
      `SELECT i.global_id
         FROM embedding_read_ideas i
        WHERE i.embedding IS NOT NULL AND i.orphaned_at IS NULL
        ORDER BY (SELECT COUNT(*) FROM visible_edges e WHERE e.from_id = i.global_id OR e.to_id = i.global_id) ASC,
                 i.created_at DESC
        LIMIT ?`
    )
    .all(MAX_MANUAL_QUERY_IDEAS) as Array<{ global_id: string }>;
  return new Set(rows.map((row) => row.global_id));
}

async function findCandidates(nodusIds?: string[]): Promise<Candidate[]> {
  const ideas = ideaVectorsForCompute();
  if (ideas.length < 2) return [];

  const themeMap = loadThemeMap();
  const existingPairs = loadExistingEdgePairs();
  const candidates: Candidate[] = [];

  const ideaById = new Map(ideas.map((idea) => [idea.global_id, idea]));
  const queryIds = bridgeQueryIds(nodusIds);
  const queries = ideas.filter((idea) => queryIds.has(idea.global_id));
  if (queries.length === 0) return [];
  const seenPairs = new Set<string>();

  const matches = await computeNearestNeighbors(
    queries.map((idea) => ({ id: idea.global_id, vector: idea.vector })),
    ideas.map((idea) => ({ id: idea.global_id, vector: idea.vector })),
    SIM_THRESHOLD,
    TOP_K_PER_IDEA
  );
  for (const match of matches) {
      const a = ideaById.get(match.queryId);
      const b = ideaById.get(match.candidateId);
      if (!a) continue;
      if (!b) continue;

      const pairKey = [a.global_id, b.global_id].sort().join('|');
      if (seenPairs.has(pairKey) || existingPairs.has(`${a.global_id}|${b.global_id}`)) continue;
      seenPairs.add(pairKey);

      const aThemes = themeMap.get(a.global_id);
      const bThemes = themeMap.get(b.global_id);
      let crossTheme = true;
      if (aThemes && bThemes) {
        for (const t of aThemes) {
          if (bThemes.has(t)) { crossTheme = false; break; }
        }
      }

      candidates.push({
        fromId: a.global_id,
        toId: b.global_id,
        fromLabel: a.label,
        toLabel: b.label,
        fromStatement: a.statement,
        toStatement: b.statement,
        fromType: a.type,
        toType: b.type,
        similarity: match.similarity,
        crossTheme,
      });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, MAX_CANDIDATES);
}

async function validateCandidates(
  candidates: Candidate[],
  model?: ModelRef | null,
  onProgress?: (p: SemanticBridgeProgress) => void,
  language: PromptLanguage = getSettings().promptLanguage ?? 'es'
): Promise<Map<string, { from: string; to: string; type: EdgeType; confidence: number; similarity: number; rationale: string | null }>> {
  const batches = chunk(candidates, VALIDATION_BATCH);
  const prompt = semanticBridgePrompt(language);
  const context = activeEmbeddingIndex(getDb());
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      policy: 2,
      index: context ? [context.indexId, context.generation, profileFingerprint(context.profile)] : null,
      model,
      language,
      prompt,
      candidates: candidates.map((candidate) => ({
        fromId: candidate.fromId,
        toId: candidate.toId,
        fromType: candidate.fromType,
        toType: candidate.toType,
        fromLabel: candidate.fromLabel,
        toLabel: candidate.toLabel,
        fromStatement: candidate.fromStatement,
        toStatement: candidate.toStatement,
        similarity: candidate.similarity,
      })),
    }))
    .digest('hex');

  const checkpoints = loadCheckpoints('bridges', contentHash, CHECKPOINT_KIND);
  const validated = new Map<string, { from: string; to: string; type: EdgeType; confidence: number; similarity: number; rationale: string | null }>();
  const candidateByPair = new Map(candidates.map((c) => [[c.fromId, c.toId].sort().join('|'), c]));

  const acceptRelation = (rel: LlmRelation) => {
    const type = normalizeEdgeType(rel.type);
    if (!type || !VALID_EDGE_TYPES.includes(type)) return;
    if (rel.from === rel.to) return;
    const pairKey = [rel.from, rel.to].sort().join('|');
    const candidate = candidateByPair.get(pairKey);
    if (!candidate) return;
    const confidence = Math.max(0.1, Math.min(1, Number(rel.confidence) || 0.5));
    const key = canonicalEdgeKey(rel.from, rel.to, type);
    const existing = validated.get(key);
    if (!existing || confidence > existing.confidence) {
      validated.set(key, {
        from: rel.from,
        to: rel.to,
        type,
        confidence,
        similarity: candidate.similarity,
        rationale: typeof rel.rationale === 'string' && rel.rationale.trim() ? rel.rationale.trim() : null,
      });
    }
  };

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    const saved = checkpoints.get(bi) as LlmValidationResult | undefined;
    if (saved && isLlmValidationResult(saved)) {
      for (const rel of saved.relations) acceptRelation(rel);
      continue;
    }

    onProgress?.({
      phase: 'validation',
      label: 'Validando candidatos con IA',
      current: bi + 1,
      total: batches.length,
      candidatesFound: candidates.length,
      bridgesAdded: validated.size,
    });

    const result = await adaptiveStructuredBatch<Candidate, LlmValidationResult>({
      items: batch,
      initialBatchSize: batch.length,
      combine: (parts) => ({ relations: parts.flatMap((part) => part.relations) }),
      execute: async (part, context) => {
        const input = {
          pairs: part.map((c): ValidationInput => ({
            from: { id: c.fromId, type: c.fromType, label: c.fromLabel, statement: clip(c.fromStatement, context.textLimit) },
            to: { id: c.toId, type: c.toType, label: c.toLabel, statement: clip(c.toStatement, context.textLimit) },
            similarity: Number(c.similarity.toFixed(3)),
          })),
        };
        return completeJsonWithHeadroom<LlmValidationResult>(
          {
            system: prompt,
            user: JSON.stringify(input),
            temperature: 0.1,
            maxTokens: localTaskOutputTokens('semantic-bridge', part.length),
            task: 'semantic-bridge',
            batchSize: part.length,
            splitDepth: context.splitDepth,
          },
          isLlmValidationResult,
          model,
        );
      },
    });

    saveCheckpoint('bridges', contentHash, CHECKPOINT_KIND, bi, result);

    for (const rel of result.relations) acceptRelation(rel);
  }

  clearCheckpoints('bridges', contentHash, CHECKPOINT_KIND);
  return validated;
}

function persistBridges(
  validated: Map<string, { from: string; to: string; type: EdgeType; confidence: number; similarity: number; rationale: string | null }>,
  model?: ModelRef | null
): number {
  let added = 0;
  const config = currentEmbeddingConfig();
  const tx = getDb().transaction(() => {
    for (const edge of validated.values()) {
      const id = addEdge({
        from_id: edge.from,
        to_id: edge.to,
        type: edge.type,
        basis: 'inferred',
        confidence: edge.confidence,
        source_work: null,
        trace: {
          method: 'bridge',
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
  tx();
  return added;
}

export async function discoverSemanticBridges(
  model?: ModelRef | null,
  onProgress?: ProgressListener,
  nodusIds?: string[],
  language: PromptLanguage = getSettings().promptLanguage ?? 'es'
): Promise<SemanticBridgeResult> {
  assertAcademicAutomation();
  model ??= getSettings().relationModel ?? getSettings().fusionModel ?? getSettings().synthesisModel ?? null;
  if (running) {
    return { candidatesScanned: 0, crossThemeCandidates: 0, validated: 0, added: 0 };
  }

  running = true;
  const progressListener = onProgress ? (p: SemanticBridgeProgress) => onProgress(p) : undefined;
  if (progressListener) listeners.add(progressListener);

  try {
    emit({ phase: 'scan', label: 'Escaneando pares semánticos', current: 0, total: 0, candidatesFound: 0, bridgesAdded: 0 });

    const candidates = await findCandidates(nodusIds);
    const crossTheme = candidates.filter((c) => c.crossTheme).length;

    emit({ phase: 'scan', label: `${candidates.length} candidatos encontrados (${crossTheme} cross-tema)`, current: 1, total: 1, candidatesFound: candidates.length, bridgesAdded: 0 });

    if (candidates.length === 0) {
      return { candidatesScanned: 0, crossThemeCandidates: 0, validated: 0, added: 0 };
    }

    const validated = await validateCandidates(candidates, model, emit, language);
    const added = persistBridges(validated, model);

    emit({ phase: 'done', label: `${added} nuevas relaciones`, current: 1, total: 1, candidatesFound: candidates.length, bridgesAdded: added });

    return {
      candidatesScanned: candidates.length,
      crossThemeCandidates: crossTheme,
      validated: validated.size,
      added,
    };
  } finally {
    if (progressListener) listeners.delete(progressListener);
    running = false;
  }
}
