/** Vectors retain their originating space until they are persisted. This closes the
 * microtask gap between a provider await completing and a repository encoding its result. */
export interface EmbeddingProvenance { indexId: string; generation: number; databasePath: string; inputText?: string }
const origins = new WeakMap<object, EmbeddingProvenance>();
export function markEmbeddingProvenance(vectors: number[][], origin: EmbeddingProvenance, texts?: string[]): void {
  vectors.forEach((vector, index) => origins.set(vector, { ...origin, inputText: texts?.[index] }));
}
export function embeddingProvenance(vector: object): EmbeddingProvenance | undefined { return origins.get(vector); }
