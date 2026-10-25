import type { EmbeddingProvider } from './types';
import type { EmbeddingContract } from './embeddingContract';
import type { EmbeddingInputProfile } from './embeddingInputProfiles';
import type { EmbeddingIndexRun } from './embeddingRuns';
import type { EmbeddingComparisonReport, EmbeddingComparisonRequest, LocalRerankerStatus } from './embeddingComparison';

export type EmbeddingIndexPreparation = 'idle' | 'running' | 'paused' | 'cancelled' | 'error';
/** Change only the affected recipe when a family's input text changes. */
export const EMBEDDING_TEXT_RECIPE_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  ideas: 1, work_summaries: 1, passages: 1, document_vectors: 1, project_chapter_chunks: 1,
  project_chapter_ideas: 1, notes: 1, archive_items: 1, study_docs: 1, study_materials: 1,
  study_ideas: 1, study_search: 1, testimony_segment_embeddings: 1,
});
export interface EmbeddingIndexProfile {
  provider: EmbeddingProvider;
  model: string;
  endpoint: string;
  modelRevision: string | null;
  recipeVersion: number;
  /** Missing on existing indices: preserve their original unprefixed input recipe. */
  input?: EmbeddingInputProfile;
}
export interface EmbeddingIndexContext {
  databasePath: string;
  indexId: string;
  generation: number;
  dimensions: number | null;
  profile: EmbeddingIndexProfile;
}
export interface EmbeddingIndexCoverage {
  family: string;
  total: number;
  indexed: number;
  excluded: number;
}
export interface EmbeddingIndexSummary {
  id: string;
  profile: EmbeddingIndexProfile;
  generation: number;
  active: boolean;
  legacy: boolean;
  dimensions: number | null;
  preparation: EmbeddingIndexPreparation;
  completed: number;
  total: number;
  coverage: EmbeddingIndexCoverage[];
  vectors: number;
  bytes: number;
  sharedBytes: number;
  reclaimableBytes: number;
  pending: number;
  updatedAt: string;
  error: string | null;
  run?: EmbeddingIndexRun;
}
export interface EmbeddingIndexPreview {
  profile: EmbeddingIndexProfile;
  existingIndexId: string | null;
  external: boolean;
  reusable: number;
  pending: number;
  excluded: number;
  estimatedBytes: number | null;
  coverage: EmbeddingIndexCoverage[];
  exclusions: Array<{ reason: string; count: number }>;
}
export interface EmbeddingIndexProgress {
  vaultId?: string;
  indexId: string;
  preparation: EmbeddingIndexPreparation;
  completed: number;
  total: number;
  family: string | null;
  error: string | null;
  run?: EmbeddingIndexRun;
}
export interface StoredEmbeddingValue {
  family: string;
  entityId: string;
  textHash: string;
  contract: EmbeddingContract;
  vector: number[];
}
export interface EmbeddingIndexesApi {
  compareEmbeddingIndexes(input: EmbeddingComparisonRequest): Promise<EmbeddingComparisonReport>;
  cancelEmbeddingComparison(requestId: string): Promise<void>;
  getLocalRerankerStatus(): Promise<LocalRerankerStatus>;
  prepareLocalReranker(action: 'download' | 'cancel', modelId?: string): Promise<LocalRerankerStatus>;
  deleteLocalReranker(modelId: string): Promise<LocalRerankerStatus>;
  listEmbeddingIndexRuns(indexId?: string, vaultId?: string): Promise<EmbeddingIndexRun[]>;
  listEmbeddingIndexes(vaultId?: string): Promise<EmbeddingIndexSummary[]>;
  previewEmbeddingIndex(input: { provider: EmbeddingProvider; model: string; input?: EmbeddingInputProfile; indexId?: string; rebuild?: boolean; vaultId?: string }): Promise<EmbeddingIndexPreview>;
  prepareEmbeddingIndex(input: { provider: EmbeddingProvider; model: string; input?: EmbeddingInputProfile; indexId?: string; rebuild?: boolean; vaultId?: string }): Promise<string>;
  activateEmbeddingIndex(id: string, vaultId?: string): Promise<void>;
  controlEmbeddingIndex(id: string, action: 'pause' | 'resume' | 'cancel', vaultId?: string): Promise<void>;
  deleteEmbeddingIndex(id: string, vaultId?: string): Promise<void>;
  onEmbeddingIndexesChanged(callback: () => void): () => void;
  onActiveEmbeddingIndexChanged(callback: () => void): () => void;
  onEmbeddingIndexProgress(callback: (progress: EmbeddingIndexProgress) => void): () => void;
}
