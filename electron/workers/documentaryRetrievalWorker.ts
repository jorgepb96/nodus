import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from './backgroundParentPort';
import { DocumentaryStore } from '../db/documentaryStore';
import { DocumentaryVectorCache } from '../db/documentaryVectorCache';
import { ResearchRetrievalBudget } from '@shared/researchRetrievalBudget';
import { validateResearchDocumentRead, type ResearchDocumentRead, type RetrievalSettings } from '@shared/researchCorpus';

/** One process serves every retrieval of the session (documentaryPreparation.ts keeps it), so the
 *  read-only store stays open and its vectors stay cached between searches. It was a new process,
 *  a new connection and a scan of every vector in scope per search: ~1 s per search on a real
 *  store, several searches per research turn. */
const opened = new Map<string, { store: DocumentaryStore; vectors: DocumentaryVectorCache; identity: string }>();

/** Which file is at `filename` now: a restore or reset replaces the store under an open connection. */
function fileIdentity(filename: string): string {
  const stat = fs.statSync(filename);
  return `${stat.dev}:${stat.ino}`;
}

function storeFor(filename: string): { store: DocumentaryStore; vectors: DocumentaryVectorCache } {
  const resolved = path.resolve(filename);
  const identity = fileIdentity(resolved);
  const existing = opened.get(resolved);
  if (existing?.store.db.open && existing.identity === identity) return existing;
  if (existing) { existing.vectors.clear(); try { existing.store.close(); } catch { /* already closed */ } opened.delete(resolved); }
  const store = new DocumentaryStore(resolved, true);
  const entry = { store, vectors: new DocumentaryVectorCache(store), identity };
  opened.set(resolved, entry);
  return entry;
}

parentPort?.on('message', (input: { id?: number; filename: string; query: string; lexicalKeys: string[]; vectorKeys: string[]; vector: number[] | null; settings: RetrievalSettings; threshold: number; activity?: boolean; read?: ResearchDocumentRead }) => {
  const id = input.id;
  try {
    const { store, vectors } = storeFor(input.filename);
    const activity = (key: string, operation: 'lexical' | 'semantic' | 'expand' | 'pages' | 'references', status: 'active' | 'completed', count?: number) => {
      if (input.activity) parentPort!.postMessage({ id, type: 'activity', key, operation, status, count });
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
    const semantic = input.vector ? vectors.semanticSearch(input.vector, input.vectorKeys, input.settings.candidates, input.threshold) : [];
    if (input.vector) activity('semantic', 'semantic', 'completed', semantic.length);
    const fused = new Map<string, { score: number; passage: typeof lexical[number] }>();
    for (const lane of [lexical, semantic]) lane.forEach((passage, index) => {
      // The same text can have separate lexical/vector index keys. Deduplicate
      // evidence by document, text and locator rather than raw index identity.
      const key = JSON.stringify([passage.document_id, passage.text, passage.locator_json]);
      const prior = fused.get(key);
      fused.set(key, { score: (prior?.score ?? 0) + 1 / (60 + index + 1), passage: prior?.passage ?? passage });
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
    parentPort!.postMessage({ id, passages: chosen, traversal: { rounds: budget.rounds, candidates: budget.candidates, evidenceTokens: budget.usedEvidenceTokens,
      partial: budget.partial || chosen.length < ranked.length || lexical.length >= input.settings.candidates || semantic.length >= input.settings.candidates,
      visited: [...budget.visited] } });
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : 'documentary_retrieval_failed' }); }
});
