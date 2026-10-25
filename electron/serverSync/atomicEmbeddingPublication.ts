import { createHash } from 'node:crypto';
import type { CompressedServerSnapshot } from './serverPublishWorkerHost';
import { fetchWithTimeout, normalizeUrl, type VaultServerConfig } from './serverSyncShared';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Upload immutable parts first. Only commit exposes the new snapshot and its vector sets. */
export async function publishAtomicEmbeddingSnapshot(config: VaultServerConfig, token: string, snapshot: CompressedServerSnapshot): Promise<Response> {
  const base = `${normalizeUrl(config.url)}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/embedding-publications`;
  const authorization = { authorization: `Bearer ${token}` };
  const vectors = config.includeVectors ? snapshot.vectors : [];
  const started = await fetchWithTimeout(base, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ revision: snapshot.revision, snapshotHash: hash(snapshot.compressed),
      index: snapshot.embeddingIndex ? { id: snapshot.embeddingIndex.id, generation: snapshot.embeddingIndex.generation } : null,
      vectors: vectors.map(vector => ({ kind: vector.kind, hash: hash(vector.compressed) })) }) });
  if (started.status === 404 || started.status === 405) throw new Error('Actualiza Nodus Server para publicar el índice activo de forma compatible. La publicación remota anterior se ha conservado.');
  if (!started.ok) return started;
  const session = await started.json() as { id: string; committed: boolean; missingSnapshot: boolean; missingKinds: string[] };
  if (!/^[a-f0-9]{64}$/.test(session.id)) throw new Error('El servidor devolvió una sesión de publicación no válida.');
  const root = `${base}/${session.id}`;
  if (!session.committed && session.missingSnapshot) {
    const response = await fetchWithTimeout(`${root}/snapshot`, { method: 'PUT', headers: { ...authorization, 'content-type': 'application/vnd.nodus.snapshot+json', 'content-encoding': 'gzip' }, body: snapshot.compressed });
    if (!response.ok) return response;
  }
  if (!session.committed) for (const vector of vectors) {
    if (!session.missingKinds.includes(vector.kind)) continue;
    const response = await fetchWithTimeout(`${root}/vectors/${vector.kind}`, { method: 'PUT', headers: { ...authorization, 'content-type': 'application/vnd.nodus.vectors', 'content-encoding': 'gzip' }, body: vector.compressed });
    if (!response.ok) return response;
  }
  return fetchWithTimeout(`${root}/commit`, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: '{}' });
}
