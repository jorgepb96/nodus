import { researchActivityStep, startResearchActivity } from './researchActivity';
import type { DocumentSearchHit } from '@shared/types';
import { findSimilarIdeasPaged } from '../db/ideasRepo';
import { findSimilarPassagesPaged, lexicalPassageSearch, type SimilarPassage } from '../db/passagesRepo';
import { findDocumentSupportPassages, findSimilarDocuments, lexicalDocumentSearch } from '../db/documentProfilesRepo';
import { embedQuery } from './aiClient';

const MAX_LITERAL_PROBES = 16;

export interface HierarchicalIdeaHit {
  global_id: string;
  type: import('@shared/types').IdeaType;
  label: string;
  statement: string;
  similarity: number;
}

export interface HierarchicalDocumentHit extends DocumentSearchHit {
  /** Rank-fusion score. Cosine and BM25 values are deliberately never added. */
  retrievalScore: number;
  channels: Array<'semantic' | 'lexical'>;
}

export interface HierarchicalPassageHit extends SimilarPassage {
  /** The global lane is never gated by document routing. */
  lanes: Array<'global' | 'lexical' | 'support' | 'document'>;
}

export interface HierarchicalRetrievalResult {
  embeddingAvailable: boolean;
  documents: HierarchicalDocumentHit[];
  ideas: HierarchicalIdeaHit[];
  passages: HierarchicalPassageHit[];
  routedWorkIds: string[];
}

export interface HierarchicalRetrievalOptions {
  /** Hard corpus boundary, applied before ranking in every lane. [] matches nothing. */
  nodusIds?: string[];
  ideaIds?: string[];
  embedding?: number[] | null;
  documentLimit?: number;
  ideaLimit?: number;
  passageLimit?: number;
  routedWorkLimit?: number;
  routedPassageLimit?: number;
  supportPassageLimit?: number;
  minDocumentSimilarity?: number;
  minIdeaSimilarity?: number;
  minPassageSimilarity?: number;
  lexicalDocuments?: boolean;
  lexicalPassages?: boolean;
  /** Independent literal probes, normally the atomic coverage questions owned by
   * one section. Their FTS rankings are fused rather than concatenated. */
  lexicalPassageQueries?: string[];
}

export interface RankedListItem<T> {
  key: string;
  value: T;
}

/**
 * Reciprocal-rank fusion keeps scores from heterogeneous indexes comparable:
 * only the position inside each lane is combined, never cosine with BM25.
 */
export function reciprocalRankFusion<T>(lists: RankedListItem<T>[][], k = 60): Array<T & { retrievalScore: number }> {
  const values = new Map<string, T>();
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, index) => {
      if (!values.has(item.key)) values.set(item.key, item.value);
      scores.set(item.key, (scores.get(item.key) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...values.entries()]
    .map(([key, value]) => ({ ...value, retrievalScore: scores.get(key) ?? 0 }))
    .sort((a, b) => b.retrievalScore - a.retrievalScore);
}

function collapseDocumentLane(hits: DocumentSearchHit[]): RankedListItem<DocumentSearchHit>[] {
  const seen = new Set<string>();
  const lane: RankedListItem<DocumentSearchHit>[] = [];
  for (const hit of hits) {
    // One book is one retrieval candidate. A long profile may expose dozens of
    // fields/sections; allowing all of them into RRF spends the result window on
    // one work and rewards profile verbosity rather than relevance.
    if (seen.has(hit.nodusId)) continue;
    seen.add(hit.nodusId);
    lane.push({ key: hit.nodusId, value: hit });
  }
  return lane;
}

function fuseDocuments(
  semantic: DocumentSearchHit[],
  lexical: DocumentSearchHit[],
  limit: number,
): HierarchicalDocumentHit[] {
  const semanticLane = collapseDocumentLane(semantic);
  const lexicalLane = collapseDocumentLane(lexical);
  const semanticKeys = new Set(semanticLane.map((item) => item.key));
  const lexicalKeys = new Set(lexicalLane.map((item) => item.key));
  const fused = reciprocalRankFusion([
    semanticLane,
    lexicalLane,
  ]);
  return fused.slice(0, limit).map((hit) => {
    const key = hit.nodusId;
    return {
      ...hit,
      channels: [
        ...(semanticKeys.has(key) ? ['semantic' as const] : []),
        ...(lexicalKeys.has(key) ? ['lexical' as const] : []),
      ],
    };
  });
}

function addPassageLane(
  byId: Map<string, HierarchicalPassageHit>,
  hits: SimilarPassage[],
  lane: 'lexical' | 'support' | 'document',
): void {
  for (const hit of hits) {
    const previous = byId.get(hit.passage_id);
    if (previous) {
      if (!previous.lanes.includes(lane)) previous.lanes.push(lane);
      previous.similarity = Math.max(previous.similarity, hit.similarity);
    } else {
      byId.set(hit.passage_id, { ...hit, lanes: [lane] });
    }
  }
}

function mergePassageLanes(
  global: SimilarPassage[], lexical: SimilarPassage[], support: SimilarPassage[], routed: SimilarPassage[], limit: number
): HierarchicalPassageHit[] {
  const byId = new Map<string, HierarchicalPassageHit>();
  // Reserve the complete global quota first. Document routing may add evidence,
  // but can never make a globally relevant passage disappear.
  for (const hit of global.slice(0, limit)) byId.set(hit.passage_id, { ...hit, lanes: ['global'] });
  // Exact, audit-validated profile supports come before the broader in-document
  // similarity lane. Both remain additive to the independent global quota.
  addPassageLane(byId, support, 'support');
  addPassageLane(byId, lexical, 'lexical');
  addPassageLane(byId, routed, 'document');
  // Map insertion order intentionally keeps every global hit ahead of routed
  // additions. Downstream context budgets can therefore add document evidence
  // without silently clipping a passage that the independent global lane found.
  return [...byId.values()];
}

/** A small evidence menu must not be consumed by the first retrieval lane. Rotate
 * through independent semantic, exact-support, lexical and routed candidates so a
 * literal procedural hit survives the final context limit. */
export function selectPassageEvidence(
  hits: HierarchicalPassageHit[],
  limit: number,
  options: { preferLexical?: boolean; preferSourceDiversity?: boolean } = {},
): HierarchicalPassageHit[] {
  if (limit <= 0) return [];
  type Lane = HierarchicalPassageHit['lanes'][number];
  const lanes: Lane[] = ['global', 'support', 'lexical', 'document'];
  const queues = new Map(lanes.map((lane) => [lane, hits.filter((hit) => hit.lanes.includes(lane))]));
  const positions = new Map(lanes.map((lane) => [lane, 0]));
  // Literal matches receive two turns because one coverage question commonly
  // contains several independent operations (e.g. catalogue + distribute), while
  // global semantic evidence keeps the first and final slots of a six-item menu.
  const schedule: Lane[] = options.preferLexical
    ? ['lexical', 'global', 'support', 'lexical', 'document', 'global']
    : ['global', 'lexical', 'support', 'lexical', 'document', 'global'];
  const selected: HierarchicalPassageHit[] = [];
  const seen = new Set<string>();
  const selectedWorks = new Set<string>();
  while (selected.length < limit) {
    let progressed = false;
    for (const lane of schedule) {
      if (selected.length >= limit) break;
      const queue = queues.get(lane) ?? [];
      let position = positions.get(lane) ?? 0;
      if (options.preferSourceDiversity && selectedWorks.size < Math.min(3, limit)) {
        const diverseAt = queue.findIndex((hit, index) =>
          index >= position && !seen.has(hit.passage_id) && !selectedWorks.has(hit.nodus_id));
        if (diverseAt >= position) {
          const [diverse] = queue.splice(diverseAt, 1);
          queue.splice(position, 0, diverse);
        }
      }
      while (position < queue.length) {
        const hit = queue[position++];
        positions.set(lane, position);
        if (seen.has(hit.passage_id)) continue;
        seen.add(hit.passage_id);
        selectedWorks.add(hit.nodus_id);
        selected.push(hit);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  if (selected.length < limit) {
    for (const hit of hits) {
      if (seen.has(hit.passage_id)) continue;
      seen.add(hit.passage_id);
      selectedWorks.add(hit.nodus_id);
      selected.push(hit);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

/**
 * Three independent retrieval lanes plus a fourth, document-routed passage lane.
 * Profiles orient and broaden retrieval; ideas and literal evidence retain their
 * own quotas and remain the only permissible basis for factual citations.
 */
export async function retrieveHierarchical(
  query: string,
  options: HierarchicalRetrievalOptions = {},
): Promise<HierarchicalRetrievalResult> {
  const clean = query.trim();
  if (options.nodusIds?.length === 0) return { embeddingAvailable: false, documents: [], ideas: [], passages: [], routedWorkIds: [] };
  const corpus = { nodusIds: options.nodusIds };
  const documentLimit = Math.max(0, options.documentLimit ?? 20);
  const ideaLimit = Math.max(0, options.ideaLimit ?? 60);
  const passageLimit = Math.max(0, options.passageLimit ?? 24);
  const routedWorkLimit = Math.max(0, options.routedWorkLimit ?? 12);
  const routedPassageLimit = Math.max(0, options.routedPassageLimit ?? passageLimit);
  const supportPassageLimit = Math.max(0, options.supportPassageLimit ?? routedPassageLimit);
  const vector = options.embedding === undefined ? await embedQuery(clean) : options.embedding;
  const finishProfiles = options.lexicalDocuments !== false && clean && documentLimit > 0 ? startResearchActivity('profiles', 'lexical') : undefined;
  const lexical = options.lexicalDocuments === false || !clean || documentLimit === 0
    ? []
    : lexicalDocumentSearch(clean, documentLimit * 2, corpus);
  finishProfiles?.('completed', lexical.length);
  const literalProbes = [...new Set((options.lexicalPassageQueries?.length
    ? options.lexicalPassageQueries
    : [clean]).map((probe) => probe.trim()).filter(Boolean))].slice(0, MAX_LITERAL_PROBES);
  const finishPassages = options.lexicalPassages !== false && passageLimit > 0 && literalProbes.length ? startResearchActivity('nodus', 'lexical') : undefined;
  const lexicalLists = options.lexicalPassages === false || passageLimit === 0
    ? []
    : literalProbes.map((probe) => lexicalPassageSearch(probe, passageLimit, corpus));
  const fuseLexical = (lists: SimilarPassage[][]): SimilarPassage[] => lists.length
    ? reciprocalRankFusion(lists.map((list) => list.map((hit) => ({ key: hit.passage_id, value: hit }))))
      .slice(0, passageLimit)
      .map(({ retrievalScore: _retrievalScore, ...hit }) => hit)
    : [];
  let lexicalPassages = fuseLexical(lexicalLists);
  finishPassages?.('completed', lexicalPassages.length);

  if (!vector?.length) {
    return {
      embeddingAvailable: false,
      documents: fuseDocuments([], lexical, documentLimit),
      ideas: [],
      passages: lexicalPassages.map((hit) => ({ ...hit, lanes: ['lexical'] })),
      routedWorkIds: lexical.slice(0, routedWorkLimit).map((hit) => hit.nodusId),
    };
  }

  const [semanticDocuments, ideas, globalPassages] = await Promise.all([
    documentLimit > 0
      ? researchActivityStep('profiles', 'semantic', () => findSimilarDocuments(vector, options.minDocumentSimilarity ?? 0.2, documentLimit * 2, corpus))
      : Promise.resolve([]),
    ideaLimit > 0
      ? researchActivityStep('ideas', 'semantic', () => findSimilarIdeasPaged(vector, options.minIdeaSimilarity ?? -1, ideaLimit, { ...corpus, ideaIds: options.ideaIds }))
      : Promise.resolve([]),
    passageLimit > 0
      ? researchActivityStep('nodus', 'semantic', () => findSimilarPassagesPaged(vector, options.minPassageSimilarity ?? -1, passageLimit, corpus))
      : Promise.resolve([]),
  ]);
  const documents = fuseDocuments(semanticDocuments, lexical, documentLimit);
  const routedWorkIds = [...new Set(documents.map((hit) => hit.nodusId))].slice(0, routedWorkLimit);
  // Once document routing has identified a relevant nucleus, repeat the literal
  // probes inside it. A corpus-wide BM25 list is otherwise dominated by generic
  // uses of terms such as "fotografía" or "administración" and can miss the
  // procedural passage inside the right monograph. RRF rewards hits visible both
  // globally and in the independently routed document set.
  if (routedWorkIds.length && lexicalLists.length) {
    const scopedLexicalLists = literalProbes.map((probe) => lexicalPassageSearch(
      probe,
      passageLimit,
      { nodusIds: routedWorkIds },
    ));
    lexicalPassages = fuseLexical([...scopedLexicalLists, ...lexicalLists]);
  }
  const supportPassages = supportPassageLimit > 0
    ? findDocumentSupportPassages(documents.slice(0, routedWorkLimit), supportPassageLimit)
    : [];
  const routedPassages = routedWorkIds.length && routedPassageLimit > 0
    ? await researchActivityStep('context', 'expand', () => findSimilarPassagesPaged(vector, options.minPassageSimilarity ?? -1, routedPassageLimit, { nodusIds: routedWorkIds }))
    : [];

  return {
    embeddingAvailable: true,
    documents,
    ideas,
    passages: mergePassageLanes(globalPassages, lexicalPassages, supportPassages, routedPassages, passageLimit),
    routedWorkIds,
  };
}
