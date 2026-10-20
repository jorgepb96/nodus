import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbeddingIndexesManager } from '../../../src/components/EmbeddingIndexesManager';
import { setActiveLang } from '../../../src/i18n';
const fixture = window as any;
fixture.actions = [];
const listeners = new Set<() => void>();
const progressListeners = new Set<() => void>();
let settings: any = { embeddingProvider: 'openai', embeddingModel: 'model-a', researchReranking: 'off', researchRerankerModel: 'bge-reranker-v2-m3-q8_0' };
// The BGE reranker an earlier version installed is already on disk.
const installedRerankers = new Set(['bge-reranker-v2-m3-q8_0']);
const rerankerSizes: Record<string, number> = { 'bge-reranker-v2-m3-q4_k_m': 438376864, 'qwen3-reranker-0.6b-q8_0': 639153184, 'bge-reranker-v2-m3-q8_0': 635676416 };
const rerankerStatus = () => {
  const models = Object.entries(rerankerSizes).map(([id, bytes]) => ({ id, bytes, available: installedRerankers.has(id), downloading: false, progress: 0 }));
  const selected = models.find(model => model.id === settings.researchRerankerModel)!;
  return { selected: selected.id, available: selected.available, downloading: false, progress: 0, bytes: selected.bytes, models };
};
let indexes = [
  { id: 'a', profile: { provider: 'openai', model: 'model-a' }, active: true, pending: 0 },
  { id: 'b', profile: { provider: 'openai', model: 'model-b' }, active: false, pending: 2 },
].map(index => ({ ...index, profile: { ...index.profile, endpoint: 'https://api.openai.com/v1', modelRevision: null, recipeVersion: 1 }, generation: 1, legacy: false,
  dimensions: 1536, preparation: 'idle', completed: 0, total: 40, coverage: [{ family: 'ideas', total: 40, indexed: 40 - index.pending, excluded: 0 }], vectors: 40 - index.pending,
  bytes: 245760, sharedBytes: 65536, reclaimableBytes: 245760, updatedAt: '2026-10-19T10:00:00.000Z', error: null,
  run: { id: `run-${index.id}`, indexId: index.id, generation: 1, reason: 'content_changed', lastReason: 'content_changed', state: 'complete', reviewed: 40, reused: 38, computed: 2, excluded: 0, failed: 0, providerInputs: 2, startedAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z', error: null } }));
const emit = () => { for (const listener of listeners) listener(); };
// A local BGE-M3 index prepared with the earlier mean-pooled profile.
fixture.addLegacyPoolingIndex = () => {
  indexes = [...indexes, { ...indexes[0], id: 'c', active: false, dimensions: 1024, profile: { provider: 'nodus', model: 'bge-m3-q8_0', endpoint: 'nodus-local-runtime', modelRevision: 'digest', recipeVersion: 1 },
    run: { ...indexes[0].run, id: 'run-c', indexId: 'c' } }];
  emit();
};
fixture.nodus = {
  getLocalRerankerStatus: async () => rerankerStatus(),
  prepareLocalReranker: async (action: string, modelId?: string) => {
    fixture.actions.push(['reranker', action, modelId]);
    if (action === 'download' && modelId) installedRerankers.add(modelId);
    return rerankerStatus();
  },
  deleteLocalReranker: async (modelId: string) => { fixture.actions.push(['rerankerDelete', modelId]); installedRerankers.delete(modelId); return rerankerStatus(); },
  updateSettings: async (patch: any) => { fixture.actions.push(['settings', patch]); settings = { ...settings, ...patch }; return settings; },
  listEmbeddingIndexRuns: async (id: string) => indexes.filter(index => index.id === id).map(index => index.run),
  compareEmbeddingIndexes: async (input: any) => {
    fixture.actions.push(['compare', input]);
    if (fixture.holdComparisons) await new Promise(resolve => { fixture.releaseComparison = resolve; });
    return { format: 'nodus.embedding-comparison/1', createdAt: '2026-10-19T10:00:00.000Z', vaultId: 'test-vault', corpusRevision: 1, sourceFingerprint: 'frozen', family: input.family, limit: 10, reranking: input.reranking,
      arms: input.indexIds.map((id: string) => ({ indexId: id, generation: 1, profile: indexes.find(index => index.id === id)?.profile, questions: input.questions.map((item: any) => ({ question: item.question, quality: item.expected?.complete ? { hit: 1, recall: 1, mrr: 1, ndcg: 1 } : null, semanticAvailable: true, embeddingMs: 5, retrievalMs: 10, workerRssBytes: 1048576, reranking: 'off', rerankingMs: 0,
        hits: [{ id: 'evidence-one', title: 'Historia de la educación', text: 'La reforma educativa amplió la enseñanza pública.', location: 'p. 12', channels: ['semantic', 'lexical'] }] })) })) };
  },
  cancelEmbeddingComparison: async (id: string) => { fixture.actions.push(['cancelComparison', id]); fixture.releaseComparison?.(); },
  listEmbeddingIndexes: async () => structuredClone(indexes),
  listEmbeddingModels: async () => [{ id: 'model-a' }, { id: 'model-b' }],
  onEmbeddingIndexesChanged: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
  onEmbeddingIndexProgress: (callback: () => void) => { progressListeners.add(callback); return () => progressListeners.delete(callback); },
  previewEmbeddingIndex: async (input: any) => { fixture.actions.push(['preview', input]); return { profile: { provider: input.provider, model: input.model, input: input.input }, existingIndexId: input.indexId,
    external: true, reusable: 38, pending: 2, excluded: 1, estimatedBytes: 245760, coverage: [], exclusions: [{ reason: 'user_excluded', count: 1 }] }; },
  prepareEmbeddingIndex: async (input: any) => { fixture.actions.push(['prepare', input]); indexes = indexes.map(index => index.id === input.indexId ? { ...index, preparation: 'running' } : index); emit(); return input.indexId; },
  controlEmbeddingIndex: async (id: string, action: string) => { fixture.actions.push([action, id]); indexes = indexes.map(index => index.id === id ? { ...index, preparation: action === 'pause' ? 'paused' : 'running' } : index); emit(); },
  deleteEmbeddingIndex: async (id: string) => { fixture.actions.push(['delete', id]); indexes = indexes.filter(index => index.id !== id); emit(); },
};
function App() {
  const [version, setVersion] = useState(0);
  fixture.rerender = () => setVersion(value => value + 1);
  return <main className="mx-auto h-screen max-w-4xl overflow-y-auto p-6" data-version={version}><EmbeddingIndexesManager vaultId="test-vault" settings={settings as any} onChange={() => setVersion(value => value + 1)} /></main>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
