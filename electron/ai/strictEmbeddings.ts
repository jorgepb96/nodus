export function validateEmbeddingVectors(vectors: number[][], expected: number, modelId: string): number[][] {
  if (vectors.length !== expected) {
    throw new Error(`El modelo de embeddings ${modelId} devolvió ${vectors.length} vectores para ${expected} entradas.`);
  }
  const dimension = vectors[0]?.length ?? 0;
  if (!dimension || vectors.some((vector) =>
    !Array.isArray(vector) || vector.length !== dimension ||
    !vector.every(Number.isFinite) || !vector.some((value) => value !== 0))) {
    throw new Error(`El modelo de embeddings ${modelId} devolvió vectores vacíos, inválidos o con dimensiones incompatibles.`);
  }
  return vectors;
}

export function orderedEmbeddingEntries(
  entries: Array<{ index?: number | null; embedding: number[] }>,
  expected: number,
  modelId: string,
): number[][] {
  const ordered = [...entries].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (ordered.some((entry, index) => (expected > 1 && entry.index == null) || (entry.index != null && entry.index !== index))) {
    throw new Error(`El modelo de embeddings ${modelId} devolvió índices ausentes, repetidos o desordenados.`);
  }
  return validateEmbeddingVectors(ordered.map((entry) => entry.embedding), expected, modelId);
}

export async function requestEmbeddingBatchWithBisection(
  texts: string[],
  request: (texts: string[], offset: number) => Promise<number[][]>,
  signal?: AbortSignal,
  shouldBisect: (error: unknown) => boolean = () => true,
  offset = 0,
): Promise<number[][]> {
  try {
    return validateEmbeddingVectors(await request(texts, offset), texts.length, 'configured');
  } catch (error) {
    signal?.throwIfAborted();
    if (texts.length <= 1 || !shouldBisect(error)) throw error;
    const middle = Math.ceil(texts.length / 2);
    const [left, right] = await Promise.all([
      requestEmbeddingBatchWithBisection(texts.slice(0, middle), request, signal, shouldBisect, offset),
      requestEmbeddingBatchWithBisection(texts.slice(middle), request, signal, shouldBisect, offset + middle),
    ]);
    return [...left, ...right];
  }
}
