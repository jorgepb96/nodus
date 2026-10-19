export interface GeminiBatchEmbeddingRequest {
  requests: Array<{
    model: string;
    content: { parts: Array<{ text: string }> };
    taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';
  }>;
}

/**
 * Google exposes a synchronous native batch endpoint for embeddings. It is not
 * Gemini's asynchronous Batch API: every response belongs to this request and
 * preserves request order, which makes it suitable for the strict indexer.
 */
export function geminiBatchEmbeddingRequest(modelId: string, texts: string[], taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'): GeminiBatchEmbeddingRequest {
  const normalizedModel = modelId.trim().replace(/^models\//, '');
  if (!normalizedModel) throw new Error('El modelo de embeddings Gemini está vacío.');
  return {
    requests: texts.map((text) => ({
      model: `models/${normalizedModel}`,
      content: { parts: [{ text }] },
      ...(taskType ? { taskType } : {}),
    })),
  };
}

export function geminiBatchEmbeddingEndpoint(modelId: string, apiBase = 'https://generativelanguage.googleapis.com'): string {
  const normalizedModel = modelId.trim().replace(/^models\//, '');
  if (!normalizedModel) throw new Error('El modelo de embeddings Gemini está vacío.');
  return `${apiBase.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(normalizedModel)}:batchEmbedContents`;
}

export function parseGeminiBatchEmbeddingResponse(value: unknown): number[][] {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini devolvió una respuesta de embeddings vacía o inválida.');
  }
  const embeddings = (value as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings)) {
    throw new Error('Gemini no devolvió la lista de embeddings esperada.');
  }
  return embeddings.map((entry, index) => {
    const values = entry && typeof entry === 'object'
      ? (entry as { values?: unknown }).values
      : null;
    if (!Array.isArray(values)) {
      throw new Error(`Gemini devolvió un embedding inválido en la posición ${index}.`);
    }
    return values as number[];
  });
}
