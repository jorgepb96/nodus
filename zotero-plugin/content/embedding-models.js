/* Immutable local vector contracts, shared by the UI, worker and benchmark. */
(function () {
  'use strict';
  const models = [
    { key: 'e5-small', label: 'Multilingual E5 small · Q8', id: 'Xenova/multilingual-e5-small', revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78', dimensions: 384, pooling: 'mean', maxTokens: 512, recipe: 'e5' },
    { key: 'granite-97m', label: 'Granite 97M Multilingual R2 · Q8', id: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX', revision: '536a9f241cb3f02a9c5995a1e708c784bd274859', dimensions: 384, pooling: 'cls', maxTokens: 512, recipe: 'plain' },
    { key: 'harrier-270m', label: 'Harrier 270M · Q8', id: 'onnx-community/harrier-oss-v1-270m-ONNX', revision: 'd59c919d0159aea2c19ed7d04288fcdd048d0f9c', dimensions: 640, pooling: 'sentence_embedding', maxTokens: 512, recipe: 'harrier' },
  ].map(m => Object.freeze({ ...m, dtype: 'q8', fingerprint: m.key === 'e5-small'
    ? `${m.id}@${m.revision}:q8:mean:l2:v1`
    : `${m.id}@${m.revision}:q8:${m.pooling}:l2:tokens512:${m.recipe}:v1${m.key === "harrier-270m" ? ":gather-dequant-v1" : ""}` }));
  function get(key) { const m = models.find(m => m.key === key); if (!m) throw new Error('unknown-embedding-model'); return m; }
  function input(model, role, value) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (model.recipe === 'e5') return `${role === 'query' ? 'query' : 'passage'}: ${text}`;
    if (model.recipe === 'harrier' && role === 'query') return `Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ${text}`;
    return text;
  }
  function useIndex(index, model) {
    for (const c of index.chunks || []) {
      c.embeddingVariants = c.embeddingVariants || {};
      if (Array.isArray(c.embedding) && c.embeddingModel) c.embeddingVariants[c.embeddingModel] = c.embedding;
      const vector = c.embeddingVariants[model.fingerprint];
      c.embedding = Array.isArray(vector) && vector.length === model.dimensions ? vector : null;
      c.embeddingModel = c.embedding ? model.fingerprint : null;
    }
    index.embeddingModel = model.fingerprint;
    return index;
  }
  globalThis.NodusEmbeddingModels = Object.freeze({ models: Object.freeze(models), get, input, useIndex, defaultKey: 'granite-97m' });
})();
