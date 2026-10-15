import type { DocumentaryStore } from './documentaryStore';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import { validateResearchDocumentRead, type ResearchDocumentRead, type RetrievalSettings } from '@shared/researchCorpus';

type Passage = ReturnType<DocumentaryStore['lexicalSearch']>[number];
type Store = Pick<DocumentaryStore, 'lexicalSearch' | 'semanticSearch' | 'physicalPages' | 'adjacentPassages'>;
type Activity = (key: string, operation: 'lexical' | 'semantic' | 'expand' | 'pages' | 'references', status: 'active' | 'completed', count?: number) => void;

export interface DocumentaryRetrievalInput {
  query: string;
  /** Independently planned facets; the semantic query remains unchanged. */
  lexicalQueries?: string[];
  lexicalKeys: string[];
  vectorKeys: string[];
  vector: number[] | null;
  settings: RetrievalSettings;
  threshold: number;
  read?: ResearchDocumentRead;
}

const evidenceKey = (passage: Passage) => JSON.stringify([passage.document_id, passage.text, passage.locator_json]);
const target = (passage: Passage) => ({ id: passage.id, documentId: passage.document_id });

/** Same production ranking, scope and budget in the worker and isolated SQL tests.
 * Facet probes are fused into one lexical lane before combining it with semantics;
 * repeating a query cannot multiply its vote. Neither path changes stored vectors. */
export function runDocumentaryRetrieval(store: Store, input: DocumentaryRetrievalInput, activity: Activity = () => {}) {
  const budget = new ResearchRetrievalBudget(input.settings);
  budget.nextRound();
  const read = input.read ? validateResearchDocumentRead(input.read) : null;
  const operation = read?.kind === 'pages' ? 'pages' : read?.kind === 'context' ? 'expand' : read?.kind === 'references' ? 'references' : 'lexical';
  activity('lexical', operation, 'active');
  // A turn plan has at most four facets. Keep the original query plus all four,
  // with bounded independent FTS windows and no extra embedding/provider calls.
  const probes = [...new Set([input.query, ...(input.lexicalQueries ?? []).slice(0, 4)].map(query => query.trim()).filter(Boolean))];
  const literal = read?.kind === 'pages' ? store.physicalPages(input.lexicalKeys, read.from, read.to ?? read.from, input.settings.candidates, read.attachmentId)
    : read?.kind === 'context' ? store.adjacentPassages(read.passageId, input.lexicalKeys, read.radius ?? 1) : null;
  const lexicalLists = literal ? [] : probes.map(query => ({ query, passages: store.lexicalSearch(query, input.lexicalKeys, input.settings.candidates) }));
  let lexical: Passage[];
  if (literal) lexical = literal;
  else if (lexicalLists.length <= 1) lexical = lexicalLists[0]?.passages ?? [];
  else {
    const combined = new Map<string, { passage: Passage; score: number }>();
    for (const { passages } of lexicalLists) {
      const seen = new Set<string>();
      passages.forEach((passage, index) => {
        const key = evidenceKey(passage);
        if (seen.has(key)) return;
        seen.add(key);
        const prior = combined.get(key);
        combined.set(key, { passage: prior?.passage ?? passage, score: (prior?.score ?? 0) + 1 / (60 + index + 1) });
      });
    }
    lexical = [...combined.values()].sort((a, b) => b.score - a.score).slice(0, input.settings.candidates).map(hit => hit.passage);
  }
  activity('lexical', operation, 'completed', lexical.length);
  if (input.vector) activity('semantic', 'semantic', 'active');
  const semantic = input.vector ? store.semanticSearch(input.vector, input.vectorKeys, input.settings.candidates, input.threshold) : [];
  if (input.vector) activity('semantic', 'semantic', 'completed', semantic.length);
  const fused = new Map<string, { score: number; passage: Passage; lexicalIds: string[]; semanticIds: string[] }>();
  for (const [laneIndex, lane] of [lexical, semantic].entries()) lane.forEach((passage, index) => {
    const key = evidenceKey(passage);
    const prior = fused.get(key);
    fused.set(key, { score: (prior?.score ?? 0) + 1 / (60 + index + 1), passage: prior?.passage ?? passage,
      lexicalIds: [...(prior?.lexicalIds ?? []), ...(laneIndex === 0 ? [passage.id] : [])],
      semanticIds: [...(prior?.semanticIds ?? []), ...(laneIndex === 1 ? [passage.id] : [])] });
  });
  budget.candidates = fused.size;
  const ranked = [...fused.values()].sort((a, b) => b.score - a.score);
  const chosen: Passage[] = [];
  const works = new Set<string>();
  const acceptedContent = new Set<string>();
  const expandedFrom = new Map<string, string[]>();
  const accept = (passage: Passage) => {
    const key = evidenceKey(passage);
    if (acceptedContent.has(key) || !budget.accept(passage.id, passage.text)) return false;
    acceptedContent.add(key);
    return true;
  };
  // First pass prioritizes independent works, then fills remaining slots.
  for (const diverse of [true, false]) for (const { passage } of ranked) {
    if (chosen.length >= input.settings.passagesPerRound) break;
    if (diverse && works.has(passage.document_id)) continue;
    if (accept(passage)) { chosen.push(passage); works.add(passage.document_id); }
  }
  let frontier = chosen.slice();
  while (!read && input.settings.autoExpand && frontier.length && budget.rounds < input.settings.rounds && budget.nextRound()) {
    activity(`expand-${budget.rounds}`, 'expand', 'active');
    const next: Passage[] = [];
    const queues = frontier.map(passage => ({ origin: passage.id, passages: store.adjacentPassages(passage.id, [...input.lexicalKeys, ...input.vectorKeys]), position: 0 }));
    // One accepted neighbor per anchor per turn: a first source's two neighbors
    // must not displace the only qualifying context of the second source.
    while (next.length < input.settings.passagesPerRound) {
      let progressed = false;
      for (const queue of queues) {
        if (next.length >= input.settings.passagesPerRound) break;
        while (queue.position < queue.passages.length) {
          const adjacent = queue.passages[queue.position++];
          if (!accept(adjacent)) continue;
          next.push(adjacent);
          expandedFrom.set(adjacent.id, [queue.origin]);
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }
    activity(`expand-${budget.rounds}`, 'expand', 'completed', next.length);
    budget.partial ||= queues.some(queue => queue.passages.slice(queue.position).some(passage => !acceptedContent.has(evidenceKey(passage))));
    chosen.push(...next);
    frontier = next;
  }
  return { passages: chosen, retrievalTrace: {
    semantic: semantic.map(target), lexical: lexical.map(target),
    lexicalQueries: lexicalLists.map(({ query, passages }) => ({ query, candidates: passages.map(target) })),
    selected: chosen.map(passage => ({ ...target(passage),
      lexicalIds: fused.get(evidenceKey(passage))?.lexicalIds ?? [], semanticIds: fused.get(evidenceKey(passage))?.semanticIds ?? [],
      ...(expandedFrom.has(passage.id) ? { expandedFrom: expandedFrom.get(passage.id) } : {}) })),
  }, traversal: { rounds: budget.rounds, candidates: budget.candidates, evidenceTokens: budget.usedEvidenceTokens,
    partial: budget.partial || chosen.length < ranked.length || lexicalLists.some(list => list.passages.length >= input.settings.candidates)
      || lexical.length >= input.settings.candidates || semantic.length >= input.settings.candidates,
    visited: [...budget.visited] } };
}
