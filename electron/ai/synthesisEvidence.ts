import { eachBounded } from '../util/async';
import { dumpToolInput } from './routeInputDump';
import type { ModelRef } from '@shared/types';
import { findRequestedTarget } from '@shared/moleculeInspection';
import {
  candidateRoutes,
  compoundAvailability,
  disconnectionClasses,
  evidencePhases,
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
import { embed } from './aiClient';
import { chemistryRunner } from './moleculeInspection';
import type { ChemistryEvidenceScope } from './chemistryEvidenceScope';

const CHEMISTRY_CAPABILITY = 'nodus:chemistry';
const DISCONNECT_TOOL = 'propose-disconnections';
const ROUTE_SEARCH_TOOL = 'search-routes';
const STOCK_TOOL = 'check-stock';
/** The route search's time budget: it returns the complete routes it has found by then. */
const ROUTE_SEARCH_SECONDS = 60;
/** Above this size the route search has never found anything, so it is not asked.
 *
 *  Derived, not chosen. Across every `[synthesisEvidence]` line on disk, grouped by distinct
 *  target: at 27 atom symbols or fewer the search returns candidates for most targets, and the
 *  largest target it has ever returned one for has 27. From 35 upwards it has returned zero for
 *  all twelve distinct targets measured — 35, 47, 56, 66, 75, 84, 94, 97, 107, 112, 117, 121, 129
 *  and 146 — while spending its full sixty-second budget each time. The threshold sits in the gap
 *  between the largest success and the smallest unbroken run of failures.
 *
 *  The measure is the count of ASCII letters in the target's SMILES, which over-counts a two-letter
 *  element and a bracketed hydrogen. It is a proxy and is named as one; it is used because it is
 *  exactly the measure the numbers above were taken with, and because nothing has parsed the target
 *  at this point, so a real heavy-atom count is not in hand.
 *
 *  Raising the budget was the other option and is the wrong one: the search is not running out of
 *  time on these, it is finding nothing. */
const ROUTE_SEARCH_MAX_ATOM_SYMBOLS = 32;
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
  /** The vault the passages and work ids are read from, for the cache key only. */
  vaultId?: string;
  /** A worker to reuse. `chemistryRunner` returns it untouched with a no-op dispose, so every
   *  phase of one gather shares a single worker instead of starting its own. */
  runner?: Runner;
  model?: ModelRef | null;
  locale?: string;
  signal?: AbortSignal;
  owner?: string;
  /** The conversation's capability scope (see moleculeInspection's InspectOptions). */
  scope?: string;
  /** The phases of this gather that failed rather than found nothing. Set by the gather, so a
   *  degraded result is used for this turn but not remembered as the whole evidence. */
  failures?: string[];
  /** Called once ORD's disconnections are known, with the evidence so far (target, starting
   *  materials and disconnections): the retrieval query reads nothing else, and the gather's slower
   *  phases — the route search's budget, the textbook schemes' second level — are still running. */
  onDisconnections?: (evidence: SynthesisEvidence) => void;
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
  const input = { indexDir, targets: targets.slice(0, 16), limit, ...(starting.length ? { startingMaterials: starting.slice(0, 16) } : {}), ...stockInput() };
  dumpToolInput(DISCONNECT_TOOL, input);
  const result = await runner.invoke({ provider, toolId: DISCONNECT_TOOL, input });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-disconnections');
  return artifact ? normalizeDisconnections(artifact.data, limit) : [];
}

/** Python processes the evidence gather may run at once. Each disconnection call is one process
 *  working through its molecules ONE AFTER ANOTHER on one core; one call per molecule spreads them
 *  across cores. Bounded, because each process holds its own template screen and RDKit. */
const DISCONNECTION_PROCESSES = 4;

/** `invokeDisconnections` with one call per molecule, run side by side, concatenated in order.
 *  The same proposals per molecule — each target is searched independently either way — in a
 *  fraction of the wall time when there are several. */
export async function invokeDisconnectionsEach(runner: Runner, targets: string[], starting: string[], limit: number, options: EvidenceOptions): Promise<TargetDisconnections[]> {
  const parts = await eachBounded(targets.slice(0, 16), DISCONNECTION_PROCESSES, (molecule) => invokeDisconnections(runner, [molecule], starting, limit, options));
  options.signal?.throwIfAborted();
  return parts.flatMap((part) => part ?? []);
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
      level = (await invokeDisconnectionsEach(runner, next, starting, PROPOSALS_PER_TARGET, options)).map((brief) => ({ ...brief, proposals: brief.proposals.slice(0, 3) }));
      briefs.push(...level);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    options.failures?.push('ORD disconnections');
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
async function textbookSchemePreparations(target: string, disconnectionsReady: Promise<TargetDisconnections[]>, starting: string[], options: EvidenceOptions): Promise<TextbookPreparation[]> {
  const provider = disconnectProvider();
  const indexDir = provider ? textbookSchemeDirectory(options.evidenceScope) : null;
  if (!provider || !indexDir) return [];
  const { runner, dispose } = chemistryRunner(options);
  // The target needs nothing from the ORD search, so its call starts now, beside it; only the
  // second-level molecules (chosen from ORD's proposals) wait for it. Each molecule is its own
  // process: one call used to work through all six one after another — 205 s on a long target.
  const one = async (molecule: string): Promise<unknown[]> => {
    dumpToolInput(DISCONNECT_TOOL, { indexDir, targets: [molecule], limit: 6, source: 'textbook' });
    const result = await runner.invoke({ provider, toolId: DISCONNECT_TOOL, input: { indexDir, targets: [molecule], limit: 6 } });
    const data = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-disconnections')?.data as { disconnections?: unknown[] } | undefined;
    return Array.isArray(data?.disconnections) ? data.disconnections : [];
  };
  try {
    const first = one(target);
    first.catch(() => undefined); // awaited below
    const disconnections = await disconnectionsReady.catch(() => [] as TargetDisconnections[]);
    const second = secondLevelTargets(disconnections, starting, 5).filter((molecule) => molecule !== target).slice(0, 5);
    const rest = await eachBounded(second, DISCONNECTION_PROCESSES - 1, one);
    const entries = [...await first.catch(() => [] as unknown[]), ...rest.flatMap((part) => part ?? [])];
    return textbookPreparations({ disconnections: entries }, (ids) => textbookCitations(ids, indexDir, options.evidenceScope), (templates) => textbookTemplateCitations(templates, indexDir, 2, options.evidenceScope));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    options.failures?.push('textbook preparations');
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
  const atomSymbols = (target.match(/[A-Za-z]/g) ?? []).length;
  if (atomSymbols > ROUTE_SEARCH_MAX_ATOM_SYMBOLS) {
    console.info(`${new Date().toISOString()} [synthesisEvidence] route search skipped: the target has ${atomSymbols} atom symbols, past the ${ROUTE_SEARCH_MAX_ATOM_SYMBOLS} above which it has never returned a candidate`);
    return [];
  }
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
    options.failures?.push('route search');
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
    options.failures?.push('availability');
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
      const vector = await embed(query, signal);
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
/** Target-level evidence, remembered between a route request and its corrections.
 *
 *  Measured on a two-turn run: the gather cost 394.4s and then 393.8s, and printed byte-identical
 *  counts both times — 43% of the whole clock, spent twice on the same answer. It is evidence about
 *  the TARGET, and the target does not change when the model is asked to fix its route, so the
 *  second computation buys nothing. On the four-turn worst case `fixes: 3` allows, this is about
 *  twenty minutes of wall clock.
 *
 *  KEYED ON THE GATHER'S REAL INPUTS, not on the question string. The question is not the input:
 *  the gather reads the target, the starting materials, the target's name, the reaction classes the
 *  request implies, the work ids in scope and the stock directory out of it, and nothing else — not
 *  the chat model, which no gather tool reads, so a correction answered by another model reuses it. Keying on those means two requests that imply the same evidence share an entry while two
 *  that imply different evidence cannot collide — and it does not depend on the question being
 *  byte-identical across turns, which is a property of the caller that has already changed once.
 *
 *  NOT DEDUPED IN FLIGHT, on purpose. Sharing one promise between two turns would propagate the
 *  first caller's cancellation into the second, and a turn that cancels is the common case. Only
 *  completed results are kept, so the worst a concurrent pair costs is the work it costs today.
 *
 *  BOUNDED BOTH WAYS. A long-lived window must not serve evidence from a corpus that has since
 *  been rescanned, and must not hold passage text for every target ever asked about. Adding a work
 *  to the scope changes the key by itself, so that case misses without help; the time limit is for
 *  passages rebuilt inside the works already in scope. */
const EVIDENCE_CACHE_TTL_MS = 30 * 60 * 1000;
const EVIDENCE_CACHE_MAX = 8;
const evidenceCache = new Map<string, { at: number; value: SynthesisEvidence }>();

function evidenceCacheKey(question: string, target: string, startingMaterials: string[], options: EvidenceOptions): string {
  const scope = options.evidenceScope;
  return JSON.stringify([
    target,
    [...startingMaterials].sort(),
    findTargetName(question) ?? '',
    [...requestMethodClasses(question)].sort(),
    scope ? [scope.workIds ? [...scope.workIds].sort() : null, scope.external, scope.web] : null,
    chemistryStockDirectory() ?? '',
    // The vault, because every passage and work id below is read from ITS database, and two
    // vaults can hold the same target with no work in scope in either — the one case the scope
    // above cannot tell apart. Passed in rather than read here: reaching for the vault registry
    // from this module pulls the database driver into it, and the suites that exercise the gather
    // deliberately stub the database out.
    options.vaultId ?? '',
  ]);
}

/** Forget everything remembered. For a test, and for any caller that knows the corpus moved. */
export function clearSynthesisEvidenceCache(): void {
  evidenceCache.clear();
}

function cachedEvidence(key: string): SynthesisEvidence | null {
  const hit = evidenceCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > EVIDENCE_CACHE_TTL_MS) { evidenceCache.delete(key); return null; }
  // Re-insert so the map's own order is least-recently-used.
  evidenceCache.delete(key);
  evidenceCache.set(key, hit);
  return hit.value;
}

function rememberEvidence(key: string, value: SynthesisEvidence): void {
  evidenceCache.set(key, { at: Date.now(), value });
  while (evidenceCache.size > EVIDENCE_CACHE_MAX) {
    const oldest = evidenceCache.keys().next();
    if (oldest.done) break;
    evidenceCache.delete(oldest.value);
  }
}

export async function gatherSynthesisEvidence(question: string, options: EvidenceOptions = {}): Promise<SynthesisEvidence | null> {
  options.signal?.throwIfAborted();
  const target = findRequestedTarget(question);
  // Said out loud. This used to be a bare `return null`, which skipped every phase of the gather
  // in silence — and because the log line is written at the END, its absence was the only trace.
  // A whole class of runs went without evidence and nothing recorded that they had.
  if (!target) {
    console.info(`${new Date().toISOString()} [synthesisEvidence] no target found in the request, so no evidence was gathered`);
    return null;
  }
  const evidenceStarted = Date.now();
  const phases = evidencePhases();
  const startingMaterials = findStartingSmiles(question, target);
  // A correction asks about the same target as the request it corrects, so the evidence is already
  // in hand. Logged, because a saving nobody can see is a saving nobody can check — and because a
  // hit that should have been a miss is only diagnosable from this line.
  const key = evidenceCacheKey(question, target, startingMaterials, options);
  const remembered = cachedEvidence(key);
  if (remembered) {
    options.onDisconnections?.(remembered);
    console.info(`${new Date().toISOString()} [synthesisEvidence] reused the evidence gathered for this target · target ${target} · ORD disconnections ${remembered.disconnections.reduce((n, d) => n + d.proposals.length, 0)} · passages ${remembered.passages.length}`);
    return remembered;
  }
  // ONE worker for the whole gather. Each phase used to call chemistryRunner itself and dispose
  // it again, so a single gather paid FOUR cold starts: four process spawns, four RDKit imports,
  // and four index or catalogue loads — one of them against a directory holding over a gigabyte
  // of vendor data. The reuse path already existed (`chemistryRunner` returns a supplied runner
  // with a no-op dispose) but EvidenceOptions never declared the field, so it was unreachable.
  const { runner, dispose } = chemistryRunner(options);
  const failures: string[] = [];
  const scoped: EvidenceOptions = { ...options, runner, failures };
  try {
    // The route search runs beside the rest of the evidence (it has its own time budget).
    const routes = phases.track('route search', searchedRoutes(target, startingMaterials, scoped));
    routes.catch(() => undefined); // awaited below; a cancelled request must not leave it unhandled
    const availability = phases.track('availability', targetAvailability(target, findTargetName(question) || target, scoped));
    availability.catch(() => undefined);
    const disconnectionsReady = phases.track('ORD disconnections', ordDisconnections(target, startingMaterials, scoped));
    disconnectionsReady.catch(() => undefined); // awaited just below
    // The scheme preparations start now: the target's own search runs beside ORD's, and only the
    // second-level molecules wait for ORD's proposals. The passages also need the disconnections.
    const prepared = phases.track('textbook preparations', textbookSchemePreparations(target, disconnectionsReady, startingMaterials, scoped));
    const disconnections = await disconnectionsReady;
    prepared.catch(() => undefined); // awaited below; a cancelled request must not leave it unhandled
    options.onDisconnections?.({ target, startingMaterials, disconnections, passages: [] });
    let passages: EvidencePassage[] = [];
    try {
      // The methods the request's own starting materials imply come first: ORD need not propose them.
      const classes = [...new Set([...requestMethodClasses(question), ...disconnectionClasses(disconnections, 6)])];
      const queries = synthesisEvidenceQueries(findTargetName(question), classes);
      passages = await phases.track('passages', textbookPassages(queries, synthesisEvidenceWorkIds(options.evidenceScope), options.signal));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      failures.push('passages');
      console.warn('[synthesisEvidence] textbook passages unavailable:', error instanceof Error ? error.message : String(error));
    }
    const preparations = await prepared;
    const candidates = await routes;
    const available = await availability;
    options.signal?.throwIfAborted();
    // One line per request, so a run's log shows which evidence reached the model.
    console.info(`${new Date().toISOString()} [synthesisEvidence] ${((Date.now() - evidenceStarted) / 1000).toFixed(1)}s · ${phases.line()} · target ${target} · ORD disconnections ${disconnections.reduce((n, d) => n + d.proposals.length, 0)} · passages ${passages.length} · textbook preparations ${preparations.length} · candidate routes ${candidates.length} · target purchasable ${available ? 'yes' : 'no/unknown'} · stock ${chemistryStockDirectory() ? 'on' : 'off'}`);
    const gathered: SynthesisEvidence = {
      target, startingMaterials, disconnections, passages,
      ...(available ? { targetAvailability: available } : {}),
      ...(preparations.length ? { textbookPreparations: preparations } : {}),
      ...(candidates.length ? { candidateRoutes: candidates } : {}),
    };
    // Only a completed gather is kept. The throwIfAborted above means a cancelled one never
    // reaches here, and a phase that failed (a runtime deadline, a worker that died) is not a
    // completed gather either: kept, it was served to every correction for the cache's lifetime
    // as if the search had found nothing. Used for this turn, gathered again for the next.
    if (failures.length) console.info(`${new Date().toISOString()} [synthesisEvidence] not remembered: ${failures.join(', ')} failed`);
    else rememberEvidence(key, gathered);
    return gathered;
  } finally {
    // Ours to close, and only ours: when the caller supplied the runner, dispose is a no-op.
    await dispose();
  }
}
