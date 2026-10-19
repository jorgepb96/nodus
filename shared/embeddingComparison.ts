import type { EmbeddingIndexProfile } from './embeddingIndexes';
import type { EmbeddingContract } from './embeddingContract';
export type EmbeddingComparisonFamily = 'ideas' | 'passages' | 'documents' | 'documentary';
export interface EmbeddingComparisonRequest {
  requestId: string;
  vaultId?: string;
  indexIds: [string, string];
  family: EmbeddingComparisonFamily;
  questions: Array<{ question: string; expected?: { ids: string[]; complete: boolean } }>;
  limit?: number;
  reranking?: 'off' | 'local';
}
export interface EmbeddingComparisonHit {
  id: string;
  text: string;
  title: string;
  location: string | null;
  channels: string[];
  score?: number;
}
export interface RetrievalQuality {
  hit: number;
  recall: number;
  mrr: number;
  ndcg: number;
}
/** Scores require complete, explicit relevance annotations. Agreement alone is
 * never presented as evidence that either embedding model is better. */
export function retrievalQuality(ids: string[], expected?: { ids: string[]; complete: boolean }, limit = 10): RetrievalQuality | null {
  if (!expected?.complete || !expected.ids.length) return null;
  const gold = new Set(expected.ids), ranked = [...new Set(ids)].slice(0, limit);
  let relevant = 0, reciprocal = 0, dcg = 0;
  ranked.forEach((id, index) => { if (gold.has(id)) { relevant++; reciprocal ||= 1 / (index + 1); dcg += 1 / Math.log2(index + 2); } });
  const ideal = Array.from({ length: Math.min(gold.size, limit) }, (_, i) => 1 / Math.log2(i + 2)).reduce((sum, v) => sum + v, 0);
  return { hit: relevant ? 1 : 0, recall: relevant / gold.size, mrr: reciprocal, ndcg: ideal ? dcg / ideal : 0 };
}
export interface EmbeddingComparisonReport {
  format: 'nodus.embedding-comparison/1';
  createdAt: string;
  vaultId: string;
  corpusRevision: number;
  sourceFingerprint: string;
  family: EmbeddingComparisonFamily;
  limit: number;
  reranking: 'off' | 'local';
  arms: Array<{
    indexId: string; generation: number; profile: EmbeddingIndexProfile; dimensions: number; contract: EmbeddingContract;
    documentaryFingerprint?: string;
    questions: Array<{
      question: string; hits: EmbeddingComparisonHit[]; quality: RetrievalQuality | null;
      expected?: { ids: string[]; complete: boolean };
      semanticAvailable: boolean; embeddingMs: number; retrievalMs: number; workerRssBytes: number;
      reranking: string; rerankingMs: number;
    }>;
  }>;
}
export interface LocalRerankerStatus { available: boolean; downloading: boolean; progress: number; bytes: number }
