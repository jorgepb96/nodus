import { createHash } from 'node:crypto';
import type { SearchableHit } from '@shared/hybridSearch';
import { literalRelevance, mergeHybridResults } from '@shared/hybridSearch';
import { cosineStudySearch } from '@shared/studySearch';
import { getDb } from '../db/database';
import { currentEmbeddingConfig } from '../db/ideasRepo';
import { activeEmbeddingIndex, embeddingGenerationRevision, embeddingIndexHead, profileFingerprint } from '../db/embeddingIndexesRepo';
import { embedQuery, embedMany } from './aiClient';

// Derived, in-memory cache scoped to the DB connection, provider, model and content.
// Deleted/restricted entities are never read from the cache: only current candidates enter retrieval.
const caches = new WeakMap<ReturnType<typeof getDb>, Map<string, Promise<number[] | null>>>();
function cacheIdentity(): string {
  const db = getDb();
  const context = activeEmbeddingIndex(db);
  return JSON.stringify([db.name, currentEmbeddingConfig(), context?.indexId, context?.generation, embeddingIndexHead(db)?.corpus_revision,
    context ? profileFingerprint(context.profile) : null,
    context ? embeddingGenerationRevision(db, context.indexId, context.generation) : 0]);
}
export async function searchHybridCorpus<T extends SearchableHit>(query: string, candidates: T[], kinds?: ReadonlySet<string>, limit = 250, queryVector?: number[]) {
  const filtered = candidates.filter((hit) => !kinds || kinds.has(hit.kind));
  const semanticCandidates = filtered.filter((hit) => hit.semanticAllowed !== false);
  const literal = filtered.filter((hit) => literalRelevance(query, hit) > 0);
  const fallback = { results: mergeHybridResults(query, literal, [], kinds, limit), semanticAvailable: false };
  if (query.trim().length < 2 || !filtered.length) return { results: [], semanticAvailable: true };
  if (!semanticCandidates.length) return { ...fallback, semanticAvailable: true };
  const db = getDb();
  const config = cacheIdentity();
  const stale = { results: [] as T[], semanticAvailable: false };
  const current = () => db.open && getDb() === db && cacheIdentity() === config;
  const cache = caches.get(db) ?? new Map<string, Promise<number[] | null>>();
  caches.set(db, cache);
  try {
    const vector = queryVector ?? await embedQuery(query);
    if (!vector) return fallback;
    const chunks = semanticCandidates.flatMap((hit) => {
      const text = `${hit.title}\n${hit.subtitle ?? ''}\n${hit.snippet ?? ''}`;
      // Index the entire text, with bounded inputs and overlap for boundary phrases.
      return Array.from({ length: Math.max(1, Math.ceil(text.length / 1800)) }, (_, i) => {
        const content = text.slice(i * 1800, i * 1800 + 2200);
        return { hit, content, key: createHash('sha256').update(config).update(content).digest('hex') };
      });
    });
    for (let offset = 0; offset < chunks.length; offset += 32) {
      if (!current()) return stale;
      const missing = [...new Map(chunks.slice(offset, offset + 32).filter((chunk) => !cache.has(chunk.key)).map((chunk) => [chunk.key, chunk])).values()];
      if (missing.length) {
        const batch = embedMany(missing.map((chunk) => chunk.content));
        missing.forEach((chunk, index) => {
          const pending = batch.then((vectors) => vectors[index] ?? null).catch(() => null);
          cache.set(chunk.key, pending);
          void pending.then((value) => { if (!value) cache.delete(chunk.key); });
        });
      }
      await Promise.all(chunks.slice(offset, offset + 32).map((chunk) => cache.get(chunk.key)));
    }
    const semantic: T[] = [];
    let available = true;
    for (const chunk of chunks) {
      const embedding = await cache.get(chunk.key);
      if (!embedding) { available = false; continue; }
      const similarity = cosineStudySearch(vector, embedding);
      if (similarity >= 0.3) semantic.push({ ...chunk.hit, snippet: chunk.content, similarity });
    }
    // Bound cache memory without affecting this request's results.
    while (cache.size > 12000) cache.delete(cache.keys().next().value!);
    return current() ? { results: mergeHybridResults(query, literal, semantic, kinds, limit), semanticAvailable: available } : stale;
  } catch {
    return current() ? fallback : stale;
  }
}
