import type { ModelInfo } from '@shared/types';

/** Catalogue revisions are observations, never inferred from a model's display name. */
const revisions = new Map<string, string>();
export function normalizeEmbeddingEndpoint(endpoint: string): string {
  if (endpoint === 'nodus-local-runtime') return endpoint;
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('El proveedor de embeddings necesita un endpoint HTTP o HTTPS.');
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.toString().replace(/\/+$/, '');
}
const key = (provider: string, endpoint: string, model: string) => JSON.stringify([provider, normalizeEmbeddingEndpoint(endpoint), model]);
export function rememberEmbeddingModelRevisions(provider: string, endpoint: string, models: Pick<ModelInfo, 'id' | 'revision'>[]): void {
  for (const model of models) {
    if (model.revision && /^(?:sha256:)?[a-f0-9]{40,128}$/i.test(model.revision)) revisions.set(key(provider, endpoint, model.id), model.revision);
  }
}
export function knownEmbeddingModelRevision(provider: string, endpoint: string, model: string): string | null {
  return revisions.get(key(provider, endpoint, model)) ?? null;
}
