import { parentPort } from './backgroundParentPort';
import { DocumentaryStore } from '../db/documentaryStore';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import { validateResearchDocumentRead, type ResearchDocumentRead, type RetrievalSettings } from '@shared/researchCorpus';

parentPort?.once('message', (input: { filename: string; query: string; lexicalKeys: string[]; vectorKeys: string[]; vector: number[] | null; settings: RetrievalSettings; threshold: number; activity?: boolean; read?: ResearchDocumentRead }) => {
  const store = new DocumentaryStore(input.filename, true);
  try {
    const activity = (key: string, operation: 'lexical' | 'semantic' | 'expand' | 'pages' | 'references', status: 'active' | 'completed', count?: number) => {
      if (input.activity) parentPort!.postMessage({ type: 'activity', key, operation, status, count });
    };
    const budget = new ResearchRetrievalBudget(input.settings);
    budget.nextRound();
    const read = input.read ? validateResearchDocumentRead(input.read) : null;
    const operation = read?.kind === 'pages' ? 'pages' : read?.kind === 'context' ? 'expand' : read?.kind === 'references' ? 'references' : 'lexical';
    activity('lexical', operation, 'active');
    const lexical = read?.kind === 'pages' ? store.physicalPages(input.lexicalKeys, read.from, read.to ?? read.from, input.settings.candidates, read.attachmentId)
      : read?.kind === 'context' ? store.adjacentPassages(read.passageId, input.lexicalKeys, read.radius ?? 1)
      : store.lexicalSearch(input.query, input.lexicalKeys, input.settings.candidates);
    activity('lexical', operation, 'completed', lexical.length);
    if (input.vector) activity('semantic', 'semantic', 'active');
    const semantic = input.vector ? store.semanticSearch(input.vector, input.vectorKeys, input.settings.candidates, input.threshold) : [];
    if (input.vector) activity('semantic', 'semantic', 'completed', semantic.length);
    const fused = new Map<string, { score: number; passage: typeof lexical[number]; lexicalIds: string[]; semanticIds: string[] }>();
    const evidenceKey = (passage: typeof lexical[number]) => JSON.stringify([passage.document_id, passage.text, passage.locator_json]);
    for (const [laneIndex, lane] of [lexical, semantic].entries()) lane.forEach((passage, index) => {
      // The same text can have separate lexical/vector index keys. Deduplicate
      // evidence by document, text and locator rather than raw index identity.
      const key = evidenceKey(passage);
      const prior = fused.get(key);
      fused.set(key, { score: (prior?.score ?? 0) + 1 / (60 + index + 1), passage: prior?.passage ?? passage,
        lexicalIds: [...(prior?.lexicalIds ?? []), ...(laneIndex === 0 ? [passage.id] : [])],
        semanticIds: [...(prior?.semanticIds ?? []), ...(laneIndex === 1 ? [passage.id] : [])] });
    });
    budget.candidates = fused.size;
    const ranked = [...fused.values()].sort((a, b) => b.score - a.score);
    const chosen: typeof lexical = [];
    const works = new Set<string>();
    // First pass prioritizes independent works, then fills remaining slots.
    for (const diverse of [true, false]) for (const { passage } of ranked) {
      if (chosen.length >= input.settings.passagesPerRound) break;
      if (diverse && works.has(passage.document_id)) continue;
      if (budget.accept(passage.id, passage.text)) { chosen.push(passage); works.add(passage.document_id); }
    }
    let frontier = chosen.slice();
    while (!read && input.settings.autoExpand && frontier.length && budget.rounds < input.settings.rounds && budget.nextRound()) {
      activity(`expand-${budget.rounds}`, 'expand', 'active');
      const next: typeof lexical = [];
      for (const passage of frontier) {
        for (const adjacent of store.adjacentPassages(passage.id, [...input.lexicalKeys, ...input.vectorKeys])) {
          if (next.length >= input.settings.passagesPerRound) break;
          if (budget.accept(adjacent.id, adjacent.text)) next.push(adjacent);
        }
      }
      activity(`expand-${budget.rounds}`, 'expand', 'completed', next.length);
      chosen.push(...next);
      frontier = next;
    }
    parentPort!.postMessage({ passages: chosen, retrievalTrace: {
      semantic: semantic.map(passage => ({ id: passage.id, documentId: passage.document_id })),
      lexical: lexical.map(passage => ({ id: passage.id, documentId: passage.document_id })),
      selected: chosen.map(passage => ({ id: passage.id, documentId: passage.document_id,
        lexicalIds: fused.get(evidenceKey(passage))?.lexicalIds ?? [], semanticIds: fused.get(evidenceKey(passage))?.semanticIds ?? [] })),
    }, traversal: { rounds: budget.rounds, candidates: budget.candidates, evidenceTokens: budget.usedEvidenceTokens,
      partial: budget.partial || chosen.length < ranked.length || lexical.length >= input.settings.candidates || semantic.length >= input.settings.candidates,
      visited: [...budget.visited] } });
  } catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : 'documentary_retrieval_failed' }); }
  finally { store.close(); }
});
