import type { ModelRef } from '@shared/types';
import { findRequestedTarget } from '@shared/moleculeInspection';
import {
  candidateRoutes,
  compoundAvailability,
  disconnectionClasses,
  findStartingSmiles,
  findTargetName,
  formatTargetAvailability,
  isIndexLikePassage,
  isSynthesisEvidenceWork,
  normalizeDisconnections,
  requestMethodClasses,
  passageFitsQuery,
  secondLevelTargets,
  synthesisEvidenceQueries,
  type CandidateRoute,
  type EvidencePassage,
  type SynthesisEvidence,
  type TargetDisconnections,
} from '@shared/synthesisEvidence';
import { evidenceText } from '@shared/passageQuality';
import { isScannedWork, parseTextNotes } from '@shared/textProvenance';
import { capabilityRegistry } from '../capabilities/registry';
import { getDb } from '../db/database';
import { findSimilarPassages, lexicalPassageSearch, type SimilarPassage } from '../db/passagesRepo';
import { reactionIndexService } from '../reactionIndex';
import { chemistryStockDirectory } from './chemistryStock';
import { textbookCitations, textbookSchemeDirectory, textbookTemplateCitations } from './textbookSchemes';
import { formatTemplateCitation, formatTextbookCitation, textbookPreparations, type TextbookPreparation } from '@shared/textbookSchemes';
import { rerank, rerankerAvailable } from './localReranker';
import { embedQuery } from './aiClient';
import { chemistryRunner } from './moleculeInspection';
import type { ChemistryEvidenceScope } from './chemistryEvidenceScope';

const CHEMISTRY_CAPABILITY = 'nodus:chemistry';
const DISCONNECT_TOOL = 'propose-disconnections';
const ROUTE_SEARCH_TOOL = 'search-routes';
const STOCK_TOOL = 'check-stock';
/** The route search's time budget: it returns the complete routes it has found by then. */
const ROUTE_SEARCH_SECONDS = 60;
/** Proposals kept per molecule, and passages kept in all. */
const PROPOSALS_PER_TARGET = 6;
const MAX_PASSAGES = 8;
/** Passages per query, so one reaction class cannot crowd out the others. */
const PASSAGES_PER_QUERY = 2;
const PASSAGE_CHARS = 1_200;
const PASSAGE_SIMILARITY = 0.3;
/** With the reranker: candidates per lane, and how many fused candidates it orders. */
const RERANK_LANE = 20;
const RERANK_POOL = 30;

interface EvidenceOptions {
  evidenceScope?: ChemistryEvidenceScope;
  model?: ModelRef | null;
  locale?: string;
  signal?: AbortSignal;
  owner?: string;
}

function disconnectProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === DISCONNECT_TOOL) ? provider : null;
}

type Runner = ReturnType<typeof chemistryRunner>['runner'];

/** The stock directory, for a package whose disconnection tool takes one (older ones reject it). */
function stockInput(): { stockDir?: string } {
  const stockDir = chemistryStockDirectory();
  const provider = disconnectProvider();
  const accepts = provider?.tools.find((tool) => tool.id === DISCONNECT_TOOL)?.inputSchema?.properties?.stockDir;
  return stockDir && accepts ? { stockDir } : {};
}

/** One `propose-disconnections` call on an open runner. Null when the package has no such tool or
 *  the index is not downloaded; throws on a tool failure. */
export async function invokeDisconnections(runner: Runner, targets: string[], starting: string[], limit = PROPOSALS_PER_TARGET, options: EvidenceOptions = {}): Promise<TargetDisconnections[] | null> {
  options.signal?.throwIfAborted();
  if (options.evidenceScope?.external === false) return null;
  const provider = disconnectProvider();
  if (!provider || !targets.length) return null;
  const indexDir = await reactionIndexService().localDirectory();
  options.signal?.throwIfAborted();
  if (!indexDir) return null;
  const result = await runner.invoke({
    provider,
    toolId: DISCONNECT_TOOL,
    input: { indexDir, targets: targets.slice(0, 16), limit, ...(starting.length ? { startingMaterials: starting.slice(0, 16) } : {}), ...stockInput() },
  });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-disconnections');
  return artifact ? normalizeDisconnections(artifact.data, limit) : [];
}

/** One-step disconnections of the target, then of the most promising precursors, level by level
 *  (one call per level): two levels in all, three when the request names starting materials, so
 *  a route's early steps (4-nitrotoluene → 4-nitrobenzoic acid under benzocaine) are covered.
 *  Best-effort: an older package, an index without the retro tables or a tool failure returns
 *  what was found so far. */
async function ordDisconnections(target: string, starting: string[], options: EvidenceOptions): Promise<TargetDisconnections[]> {
  if (options.evidenceScope?.external === false || !disconnectProvider()) return [];
  const { runner, dispose } = chemistryRunner(options);
  const briefs: TargetDisconnections[] = [];
  try {
    let level = (await invokeDisconnections(runner, [target], starting, PROPOSALS_PER_TARGET, options)) ?? [];
    briefs.push(...level);
    for (let depth = 2; depth <= (starting.length ? 3 : 2) && level.length; depth += 1) {
      options.signal?.throwIfAborted();
      const next = secondLevelTargets(level, starting, 3).filter((molecule) => !briefs.some((brief) => brief.input === molecule || brief.target === molecule));
      if (!next.length) break;
      level = ((await invokeDisconnections(runner, next, starting, PROPOSALS_PER_TARGET, options)) ?? []).map((brief) => ({ ...brief, proposals: brief.proposals.slice(0, 3) }));
      briefs.push(...level);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] ORD disconnections unavailable:', error instanceof Error ? error.message : String(error));
  } finally {
    await dispose();
  }
  return briefs.filter((brief) => brief.proposals.length || brief.recordedRoutes.length);
}

/** Reactions in the user's textbook schemes that make the target and its most promising ORD
 *  precursors, and one-step disconnections proposed by retro templates extracted from those
 *  schemes, with book-and-page citations. Best-effort: no textbook index, an older package or a
 *  tool failure returns []. */
async function textbookSchemePreparations(target: string, disconnections: TargetDisconnections[], starting: string[], options: EvidenceOptions): Promise<TextbookPreparation[]> {
  const provider = disconnectProvider();
  const indexDir = provider ? textbookSchemeDirectory(options.evidenceScope) : null;
  if (!provider || !indexDir) return [];
  const molecules = [...new Set([target, ...secondLevelTargets(disconnections, starting, 5)])].slice(0, 6);
  const { runner, dispose } = chemistryRunner(options);
  try {
    const result = await runner.invoke({ provider, toolId: DISCONNECT_TOOL, input: { indexDir, targets: molecules, limit: 6 } });
    const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-disconnections');
    return artifact ? textbookPreparations(artifact.data, (ids) => textbookCitations(ids, indexDir, options.evidenceScope), (templates) => textbookTemplateCitations(templates, indexDir, 2, options.evidenceScope)) : [];
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] textbook schemes unavailable:', error instanceof Error ? error.message : String(error));
    return [];
  } finally {
    await dispose();
  }
}

/** Complete routes from the package's route search over the ORD and textbook indexes, stopping
 *  at the user's stock lists and starting materials, cited like the other evidence. Best-effort:
 *  an older package without the tool, no index, a timeout or a failure returns []. */
async function searchedRoutes(target: string, starting: string[], options: EvidenceOptions): Promise<CandidateRoute[]> {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  if (!provider || !provider.tools.some((tool) => tool.id === ROUTE_SEARCH_TOOL)) return [];
  const textbookDir = textbookSchemeDirectory(options.evidenceScope);
  const ordDir = options.evidenceScope?.external === false ? null : await reactionIndexService().localDirectory();
  options.signal?.throwIfAborted();
  const indexDirs = [ordDir, textbookDir].filter((dir): dir is string => !!dir);
  if (!indexDirs.length) return [];
  const stockDir = options.evidenceScope?.external === false ? null : chemistryStockDirectory();
  const { runner, dispose } = chemistryRunner(options);
  try {
    const result = await runner.invoke({
      provider,
      toolId: ROUTE_SEARCH_TOOL,
      input: {
        indexDirs,
        target,
        maxSteps: starting.length ? 5 : 4,
        budgetSeconds: ROUTE_SEARCH_SECONDS,
        ...(starting.length ? { startingMaterials: starting.slice(0, 16) } : {}),
        ...(stockDir ? { stockDir } : {}),
      },
    });
    const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'candidate-routes');
    if (!artifact) return [];
    return candidateRoutes(
      artifact.data,
      textbookDir ? (ids) => textbookCitations(ids, textbookDir, options.evidenceScope).map(formatTextbookCitation) : undefined,
      textbookDir ? (templates) => textbookTemplateCitations(templates, textbookDir, 2, options.evidenceScope).map(formatTemplateCitation) : undefined,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] route search unavailable:', error instanceof Error ? error.message : String(error));
    return [];
  } finally {
    await dispose();
  }
}

/** One sentence when the target itself is on the user's stock lists (exactly, or in another
 *  stereo/isotope form), so the model can say a route may be unnecessary. Undefined without stock
 *  lists, with stock switched off, or on any failure. */
async function targetAvailability(target: string, name: string, options: EvidenceOptions): Promise<string | undefined> {
  if (options.evidenceScope?.external === false) return undefined;
  const stockDir = chemistryStockDirectory();
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  if (!stockDir || !provider?.tools.some((tool) => tool.id === STOCK_TOOL)) return undefined;
  const { runner, dispose } = chemistryRunner(options);
  try {
    const result = await runner.invoke({ provider, toolId: STOCK_TOOL, input: { stockDir, molecules: [target] } });
    const data = (result.artifacts ?? []).find((entry) => entry.artifactType === 'stock-availability')?.data as Parameters<typeof compoundAvailability>[1] | undefined;
    return (data && formatTargetAvailability(name, compoundAvailability(target, data))) || undefined;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return undefined;
  } finally {
    await dispose();
  }
}

/** The works whose passages count as route evidence: synthetic-chemistry texts and works filed
 *  under a chemistry collection. */
export function synthesisEvidenceWorkIds(scope?: ChemistryEvidenceScope): string[] {
  if (scope?.workIds?.size === 0) return [];
  const rows = getDb().prepare(
    `SELECT w.nodus_id, w.title,
            (SELECT group_concat(c.name, char(31)) FROM work_collections wc JOIN collections c ON c.collection_key = wc.collection_key
              WHERE wc.nodus_id = w.nodus_id) AS collections
       FROM works w
      WHERE w.archived = 0 AND EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)`
  ).all() as Array<{ nodus_id: string; title: string | null; collections: string | null }>;
  return rows
    .filter((row) => (!scope?.workIds || scope.workIds.has(row.nodus_id)) && isSynthesisEvidenceWork(row.title ?? '', row.collections ? row.collections.split('\u001f') : []))
    .map((row) => row.nodus_id);
}

/** Whether a work was read mostly by OCR, from its extraction notes and highest page number. */
function scannedWorkLookup(): (nodusId: string) => boolean {
  const cache = new Map<string, boolean>();
  return (nodusId) => {
    if (cache.has(nodusId)) return cache.get(nodusId)!;
    let scanned = false;
    try {
      const row = getDb().prepare(
        `SELECT w.resolved_text_notes AS notes, (SELECT MAX(page_number) FROM passages p WHERE p.nodus_id = w.nodus_id) AS pages
           FROM works w WHERE w.nodus_id = ?`
      ).get(nodusId) as { notes: string | null; pages: number | null } | undefined;
      scanned = row ? isScannedWork(parseTextNotes(row.notes), row.pages) : false;
    } catch { /* unknown: not marked */ }
    cache.set(nodusId, scanned);
    return scanned;
  };
}

/** Passages for each query from the scoped works: the lexical lane (named reactions, reagent
 *  names) and the dense lane, fused by reciprocal rank, a few per query. */
export async function textbookPassages(queries: string[], workIds: string[], signal?: AbortSignal, perQuery = PASSAGES_PER_QUERY): Promise<EvidencePassage[]> {
  signal?.throwIfAborted();
  if (!queries.length || !workIds.length) return [];
  const chosen = new Map<string, EvidencePassage>();
  const scannedWork = scannedWorkLookup();
  for (const query of queries) {
    signal?.throwIfAborted();
    // With the local reranker each lane offers more candidates, and the reranker orders the
    // fused top RERANK_POOL by reading query and passage together (localReranker.ts).
    const reranking = rerankerAvailable();
    const laneSize = reranking ? RERANK_LANE : 6;
    const lanes: SimilarPassage[][] = [];
    try { lanes.push(lexicalPassageSearch(query, laneSize, { nodusIds: workIds })); } catch { /* FTS is optional */ }
    try {
      const vector = await embedQuery(query, signal);
      signal?.throwIfAborted();
      if (vector) lanes.push(findSimilarPassages(vector, PASSAGE_SIMILARITY, laneSize, { nodusIds: workIds }));
    } catch (error) {
      if (signal?.aborted) throw error;
      /* no embedding provider: the lexical lane alone */
    }
    const scores = new Map<string, { score: number; hit: SimilarPassage }>();
    for (const lane of lanes) {
      lane.forEach((hit, rank) => {
        const entry = scores.get(hit.passage_id) ?? { score: 0, hit };
        entry.score += 1 / (60 + rank);
        scores.set(hit.passage_id, entry);
      });
    }
    let ordered = [...scores.values()].sort((a, b) => b.score - a.score);
    if (reranking && ordered.length > 1) {
      const pool = ordered.slice(0, RERANK_POOL);
      const relevance = await rerank(query, pool.map(({ hit }) => hit.text.slice(0, 2000)), signal);
      if (relevance) ordered = pool.map((entry, index) => ({ entry, score: relevance[index] })).sort((a, b) => b.score - a.score).map(({ entry }) => entry);
    }
    let taken = 0;
    for (const { hit } of ordered) {
      if (taken >= perQuery || chosen.size >= MAX_PASSAGES) break;
      if (chosen.has(hit.passage_id) || isIndexLikePassage(hit.text)) continue;
      // Schemes flattened into text, citation runs and running heads cut out: a model given
      // "O O BN H CH2Br OH NO 2 PhCH2 …" as evidence spends its reasoning decoding it.
      const text = evidenceText(hit.text);
      if (!text || !passageFitsQuery(query, text)) continue;
      chosen.set(hit.passage_id, {
        text: text.length > PASSAGE_CHARS ? `${text.slice(0, PASSAGE_CHARS)}…` : text,
        location: hit.page_label,
        work: { title: hit.title, year: hit.year },
        retrievedFor: query,
        citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
        ...(scannedWork(hit.nodus_id) ? { scanned: true } : {}),
      });
      taken += 1;
    }
    if (chosen.size >= MAX_PASSAGES) break;
  }
  return [...chosen.values()];
}

/** Evidence for a route request, gathered before the model answers: ORD disconnections of the
 *  target and textbook passages for the target and the reaction classes those disconnections
 *  name. Null when the request names no target SMILES. */
export async function gatherSynthesisEvidence(question: string, options: EvidenceOptions = {}): Promise<SynthesisEvidence | null> {
  options.signal?.throwIfAborted();
  const target = findRequestedTarget(question);
  if (!target) return null;
  const startingMaterials = findStartingSmiles(question, target);
  // The route search runs beside the rest of the evidence (it has its own time budget).
  const routes = searchedRoutes(target, startingMaterials, options);
  routes.catch(() => undefined); // awaited below; a cancelled request must not leave it unhandled
  const availability = targetAvailability(target, findTargetName(question) || target, options);
  availability.catch(() => undefined);
  const disconnections = await ordDisconnections(target, startingMaterials, options);
  let passages: EvidencePassage[] = [];
  try {
    // The methods the request's own starting materials imply come first: ORD need not propose them.
    const classes = [...new Set([...requestMethodClasses(question), ...disconnectionClasses(disconnections, 6)])];
    const queries = synthesisEvidenceQueries(findTargetName(question), classes);
    passages = await textbookPassages(queries, synthesisEvidenceWorkIds(options.evidenceScope), options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn('[synthesisEvidence] textbook passages unavailable:', error instanceof Error ? error.message : String(error));
  }
  const preparations = await textbookSchemePreparations(target, disconnections, startingMaterials, options);
  const candidates = await routes;
  const available = await availability;
  options.signal?.throwIfAborted();
  // One line per request, so a run's log shows which evidence reached the model.
  console.info(`[synthesisEvidence] target ${target} · ORD disconnections ${disconnections.reduce((n, d) => n + d.proposals.length, 0)} · passages ${passages.length} · textbook preparations ${preparations.length} · candidate routes ${candidates.length} · target purchasable ${available ? 'yes' : 'no/unknown'} · stock ${chemistryStockDirectory() ? 'on' : 'off'}`);
  return {
    target, startingMaterials, disconnections, passages,
    ...(available ? { targetAvailability: available } : {}),
    ...(preparations.length ? { textbookPreparations: preparations } : {}),
    ...(candidates.length ? { candidateRoutes: candidates } : {}),
  };
}
