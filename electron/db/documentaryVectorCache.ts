import type { DocumentaryStore } from './documentaryStore';

/** The documentary store's passage vectors, held by the long-lived retrieval worker so a semantic
 *  search is arithmetic over memory rather than one SQLite-to-JS callback per stored vector.
 *
 *  Measured 2026-10-09 on a real store (141,535 passages, 68,236 vectors of 1,024 dimensions in a
 *  research scope): `semanticSearch` took 0.6-1.25 s per call inside the Electron utility process
 *  (each 4 KB blob read out of its overflow pages and copied into a new Buffer), against ~0.05 s
 *  over cached vectors.
 *
 *  Exactness: each row's magnitude is summed in the order `documentary_similarity` sums it, and
 *  each dot product the same way, so every similarity is the double the callback returned, and
 *  rows are ranked by it and then by id exactly as the statement ranks them. A revision with
 *  anything the cache does not hold the same way (a legacy JSON vector, a blob that is not a
 *  whole number of float32s, vectors of differing lengths) is scored by the statement itself.
 *
 *  Freshness: every write to `documentary_passages` bumps its revision's counter in
 *  `documentary_vector_generations` (triggers, see DocumentaryStore). A revision is cached with
 *  its counter and read again whenever the counter moved, so an in-place re-embedding or a
 *  conversion is seen by the next search; a write to another revision (preparation runs while a
 *  chat searches) rebuilds nothing. A store without the counters is never cached. */
interface CachedRevision {
  generation: number;
  /** null: scored by the statement (see above). */
  vectors: { ids: string[]; dim: number; values: Float32Array; magnitudes: Float64Array } | null;
  floats: number;
}

/** Above this many cached floats (1 GiB) the least recently used revisions are dropped. */
const MAX_CACHED_FLOATS = 256 * 1024 * 1024;

export class DocumentaryVectorCache {
  private readonly revisions = new Map<string, CachedRevision>();
  private floats = 0;
  constructor(private readonly store: DocumentaryStore) {}

  clear(): void { this.revisions.clear(); this.floats = 0; }

  /** Each revision's write counter, or null for a store without the counters. */
  private generations(indexKeys: string[]): Map<string, number> | null {
    try {
      const rows = this.store.db.prepare('SELECT index_key,generation FROM documentary_vector_generations WHERE index_key IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(indexKeys)) as Array<{ index_key: string; generation: number }>;
      return new Map(rows.map(row => [row.index_key, row.generation]));
    } catch { return null; }
  }

  private load(indexKey: string, generation: number): CachedRevision {
    const rows = this.store.db.prepare('SELECT id,vector,vector_json FROM documentary_passages WHERE index_key=? AND (vector IS NOT NULL OR vector_json IS NOT NULL)')
      .raw().all(indexKey) as Array<[string, Uint8Array | null, string | null]>;
    const first = rows[0]?.[1];
    const bytes = first ? first.byteLength : 0;
    if (!rows.length || !bytes || bytes % 4 || rows.some(([, blob]) => !blob || blob.byteLength !== bytes)) return { generation, vectors: null, floats: 0 };
    const dim = bytes / 4;
    const values = new Float32Array(rows.length * dim);
    const magnitudes = new Float64Array(rows.length);
    const ids: string[] = [];
    rows.forEach(([id, blob], slot) => {
      const vector = new Float32Array(blob!.buffer.slice(blob!.byteOffset, blob!.byteOffset + bytes));
      values.set(vector, slot * dim);
      let magnitude = 0;
      for (let index = 0; index < dim; index++) magnitude += vector[index] ** 2;
      magnitudes[slot] = magnitude;
      ids.push(id);
    });
    return { generation, vectors: { ids, dim, values, magnitudes }, floats: values.length };
  }

  private revision(indexKey: string, generation: number): CachedRevision {
    let cached = this.revisions.get(indexKey);
    if (cached && cached.generation === generation) {
      // Most recently used last.
      this.revisions.delete(indexKey); this.revisions.set(indexKey, cached);
      return cached;
    }
    if (cached) { this.revisions.delete(indexKey); this.floats -= cached.floats; }
    cached = this.load(indexKey, generation);
    this.revisions.set(indexKey, cached);
    this.floats += cached.floats;
    for (const [key, old] of this.revisions) {
      if (this.floats <= MAX_CACHED_FLOATS || key === indexKey) break;
      this.revisions.delete(key); this.floats -= old.floats;
    }
    return cached;
  }

  /** `DocumentaryStore.semanticSearch`, the same rows in the same order. */
  semanticSearch(query: number[], indexKeys: string[], limit: number, threshold = -1): ReturnType<DocumentaryStore['semanticSearch']> {
    if (!indexKeys.length || !query.length || limit <= 0) return [];
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
    if (!norm) return [];
    const keys = [...new Set(indexKeys)];
    const generations = this.generations(keys);
    if (!generations) return this.store.semanticSearch(query, indexKeys, limit, threshold);
    const scored: Array<{ id: string; similarity: number }> = [];
    const uncached: string[] = [];
    for (const key of keys) {
      const { vectors } = this.revision(key, generations.get(key) ?? 0);
      if (!vectors) { uncached.push(key); continue; }
      const { ids, dim, values, magnitudes } = vectors;
      for (let slot = 0; slot < ids.length; slot++) {
        let similarity = -2;
        const magnitude = magnitudes[slot];
        if (dim === query.length && Number.isFinite(magnitude) && magnitude) {
          let dot = 0;
          const base = slot * dim;
          for (let index = 0; index < dim; index++) dot += values[base + index] * query[index];
          similarity = dot / (norm * Math.sqrt(magnitude));
        }
        if (similarity >= threshold) scored.push({ id: ids[slot], similarity });
      }
    }
    if (uncached.length) scored.push(...this.store.semanticScores(query, uncached, threshold));
    scored.sort((a, b) => b.similarity - a.similarity || compareText(a.id, b.id));
    const chosen = scored.slice(0, limit).map(row => row.id);
    if (!chosen.length) return [];
    const rows = new Map((this.store.db.prepare('SELECT id,document_id,index_key,text,locator_json FROM documentary_passages WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(chosen)) as ReturnType<DocumentaryStore['semanticSearch']>).map(row => [row.id, row]));
    return chosen.flatMap(id => rows.has(id) ? [rows.get(id)!] : []);
  }
}

/** SQLite's BINARY collation: UTF-8 byte order, which differs from UTF-16 order only past U+D7FF. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
