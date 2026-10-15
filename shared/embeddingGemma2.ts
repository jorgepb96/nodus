import { createEmbeddingContract, type EmbeddingContract } from './embeddingContract';

export type EmbeddingRole = 'query' | 'document';
export const EMBEDDING_GEMMA2_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
export const EMBEDDING_GEMMA2_FAMILY = 'embeddinggemma-2-text-q8-v1';
export const EMBEDDING_GEMMA2_PROFILES = {
  'embeddinggemma-2-text-q8-512-v1': 512,
  'embeddinggemma-2-text-q8-256-v1': 256,
} as const;
export function isEmbeddingGemma2(model: string): model is keyof typeof EMBEDDING_GEMMA2_PROFILES {
  return Object.prototype.hasOwnProperty.call(EMBEDDING_GEMMA2_PROFILES, model);
}
export function embeddingGemma2Contract(model: string): EmbeddingContract {
  if (!isEmbeddingGemma2(model)) throw new Error(`Perfil EmbeddingGemma desconocido: ${model}`);
  return createEmbeddingContract({ provider: 'nodus', model, dim: EMBEDDING_GEMMA2_PROFILES[model],
    protocol: 'embeddinggemma2-text/1',
    task: { query: 'task: search result | query: ', document: 'title: {title|none} | text: ' },
    preprocessing: { weights: EMBEDDING_GEMMA2_REVISION, tokenizer: EMBEDDING_GEMMA2_REVISION,
      maxTokens: 8192, specialTokens: true, truncation: false, output: 'sentence_embedding',
      projection: 'onnx-model', reduction: 'matryoshka-prefix', titleFallback: 'none' },
    normalization: 'l2-after-reduction', quantization: 'onnx-q8', configVersion: 1 });
}
export function prepareEmbeddingGemma2Input(text: string, role: EmbeddingRole, title?: string): string {
  return role === 'query' ? `task: search result | query: ${text}` : `title: ${title?.trim() || 'none'} | text: ${text}`;
}
/** MRL truncation must precede normalization. Never accept a corrupt/empty row. */
export function reduceEmbeddingGemma2(vectors: number[][], count: number, dimensions: number): number[][] {
  if (![256, 512, 768].includes(dimensions) || vectors.length !== count) throw new Error('EmbeddingGemma: cantidad o dimensión incompatible.');
  return vectors.map(vector => {
    if (vector.length !== 768 || !vector.every(Number.isFinite)) throw new Error('EmbeddingGemma: vector nativo inválido.');
    const result = vector.slice(0, dimensions);
    const norm = Math.hypot(...result);
    if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('EmbeddingGemma: vector vacío.');
    return result.map(value => value / norm);
  });
}
/** Padded token cost, not sum of unpadded lengths. Long inputs get their own run. */
export function embeddingGemma2Batches(lengths: number[]): number[][] {
  const batches: number[][] = [];
  let batch: number[] = [], longest = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (!Number.isSafeInteger(length) || length < 1 || length > 8192) throw new Error(`EmbeddingGemma: entrada ${index} supera el límite de 8192 tokens (incluidos prefijos y tokens especiales).`);
    if (batch.length && (batch.length === 8 || Math.max(longest, length) * (batch.length + 1) > 2048)) {
      batches.push(batch); batch = []; longest = 0;
    }
    batch.push(index); longest = Math.max(longest, length);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
