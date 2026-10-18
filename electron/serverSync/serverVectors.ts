import { isEmbeddingGemma2, embeddingGemma2Contract } from '@shared/embeddingGemma2';
import type Database from 'better-sqlite3';

/**
 * The corpus embeddings, quantized for the server.
 *
 * The phone cannot hold the vectors — a hundred thousand passages at 1024 float32 dimensions
 * is hundreds of megabytes — and the server cannot compute an embedding, because it has no
 * API key and must never be given one. So the corpus matrix lives on the server and the
 * client posts the vector of its own query.
 *
 * Every vector is L2-normalised first, which puts each component in [-1, 1] and lets a
 * single global scale of 127 serve for all of them; cosine then reduces to an integer dot
 * product. Four bytes per dimension become one, and the measured error stays far under the
 * thresholds the app itself uses (0.28 for ideas, 0.32 for passages).
 *
 * The wire format is the one server/lib/core/vectors.mjs decodes:
 *   [uint32le headerLength][header JSON][uint32le idsLength][ids JSON][count * dim int8]
 */

export const VECTOR_FORMAT = 'nodus.vectors';
export const VECTOR_VERSION = 1;
export const VECTOR_QUANT = 'int8-l2';

export type VectorKind = 'ideas' | 'documents' | 'passages';

const SOURCES: Record<VectorKind, { table: string; id: string }> = {
  ideas: { table: 'ideas', id: 'global_id' },
  documents: { table: 'document_vectors', id: 'vector_id' },
  passages: { table: 'passages', id: 'passage_id' },
};

export interface VectorSetSummary {
  kind: VectorKind;
  provider: string;
  model: string;
  dim: number;
  count: number;
  bytes: number;
}

/**
 * Which embedding actually describes this table.
 *
 * Read from the DATA rather than from settings: a vault re-indexed with a different model
 * keeps older rows until they are refreshed, and what the server needs to advertise is the
 * embedding its matrix is really built from. The largest coherent group wins, and only that
 * group is published — mixing two models in one matrix would return confident nonsense.
 */
function dominantEmbedding(db: Database.Database, table: string): { provider: string; model: string; dim: number; count: number } | null {
  try {
    const rows = db
      .prepare(
        `SELECT embedding_provider AS provider, embedding_model AS model, embedding_dim AS dim, COUNT(*) AS count
           FROM "${table}"
          WHERE embedding IS NOT NULL AND embedding_provider IS NOT NULL AND embedding_model IS NOT NULL AND embedding_dim > 0
          GROUP BY provider, model, dim
          ORDER BY count DESC
          LIMIT 1`
      )
      .get() as { provider: string; model: string; dim: number; count: number } | undefined;
    return rows ?? null;
  } catch {
    // A vault whose schema predates the embedding columns simply has nothing to publish.
    return null;
  }
}

export function describeVectorSet(db: Database.Database, kind: VectorKind): VectorSetSummary | null {
  const source = SOURCES[kind];
  const embedding = dominantEmbedding(db, source.table);
  if (!embedding || embedding.count === 0) return null;
  return { kind, provider: embedding.provider, model: embedding.model, dim: embedding.dim, count: embedding.count, bytes: embedding.count * embedding.dim };
}

/**
 * Build the payload, one row at a time.
 *
 * The matrix is allocated once and filled in place: materialising thirty thousand
 * Float32Arrays first would briefly hold the whole float32 corpus in memory, which is the
 * cost this format exists to avoid.
 */
export function buildVectorSet(db: Database.Database, kind: VectorKind): { buffer: Buffer; summary: VectorSetSummary } | null {
  const source = SOURCES[kind];
  const embedding = dominantEmbedding(db, source.table);
  if (!embedding || embedding.count === 0 || embedding.dim <= 0) return null;

  const { provider, model, dim } = embedding;
  const rows = db
    .prepare(
      `SELECT "${source.id}" AS id, embedding FROM "${source.table}"
        WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
        ORDER BY "${source.id}"`
    )
    .iterate(provider, model, dim) as Iterable<{ id: string; embedding: Buffer }>;

  const ids: string[] = [];
  const matrix = Buffer.alloc(embedding.count * dim);
  let row = 0;
  for (const entry of rows) {
    if (row >= embedding.count) break;
    // The stored blob is a raw Float32Array; a length that disagrees with the declared
    // dimension is a corrupt row, and one of those must not shift every vector after it.
    if (!Buffer.isBuffer(entry.embedding) || entry.embedding.byteLength !== dim * 4) continue;
    const vector = new Float32Array(entry.embedding.buffer, entry.embedding.byteOffset, dim);
    let norm = 0;
    for (let index = 0; index < dim; index += 1) norm += vector[index] * vector[index];
    norm = Math.sqrt(norm);
    if (!(norm > 0)) continue;
    const base = row * dim;
    for (let index = 0; index < dim; index += 1) {
      const value = Math.round((vector[index] / norm) * 127);
      matrix[base + index] = Math.max(-127, Math.min(127, value));
    }
    ids.push(String(entry.id));
    row += 1;
  }
  if (ids.length === 0) return null;

  const count = ids.length;
  const embeddingContract = provider === 'nodus' && isEmbeddingGemma2(model) ? embeddingGemma2Contract(model) : undefined;
  if (embeddingContract && embeddingContract.dim !== dim) throw new Error('embedding_contract_dimension_mismatch');
  const header = Buffer.from(JSON.stringify({ embeddingContract, format: VECTOR_FORMAT, version: VECTOR_VERSION, kind, provider, model, dim, quant: VECTOR_QUANT, count }), 'utf8');
  const idTable = Buffer.from(JSON.stringify(ids), 'utf8');
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);
  const idsLength = Buffer.alloc(4);
  idsLength.writeUInt32LE(idTable.length, 0);
  const buffer = Buffer.concat([headerLength, header, idsLength, idTable, matrix.subarray(0, count * dim)]);
  return { buffer, summary: { kind, provider, model, dim, count, bytes: buffer.length } };
}

export interface VectorizeChunk {
  provider: string;
  model: string;
  dimensions: number;
  vectors: Array<{ id: string; values: number[] }>;
}

/**
 * Stream the coherent float vectors in API-sized groups. Vectorize currently accepts at
 * most 1,536 dimensions; larger embeddings keep using the exact R2 representation.
 */
export function *buildVectorizeChunks(db: Database.Database, kind: VectorKind, chunkSize = 250): Generator<VectorizeChunk> {
  const source = SOURCES[kind];
  const embedding = dominantEmbedding(db, source.table);
  if (!embedding || embedding.count === 0 || embedding.dim <= 0 || embedding.dim > 1536) return;
  const rows = db.prepare(
    `SELECT "${source.id}" AS id, embedding FROM "${source.table}"
      WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
      ORDER BY "${source.id}"`
  ).iterate(embedding.provider, embedding.model, embedding.dim) as Iterable<{ id: string; embedding: Buffer }>;
  let vectors: VectorizeChunk['vectors'] = [];
  for (const entry of rows) {
    if (!Buffer.isBuffer(entry.embedding) || entry.embedding.byteLength !== embedding.dim * 4) continue;
    const values = Array.from(new Float32Array(entry.embedding.buffer, entry.embedding.byteOffset, embedding.dim));
    if (!values.every(Number.isFinite)) continue;
    vectors.push({ id: String(entry.id), values });
    if (vectors.length >= chunkSize) {
      yield { provider: embedding.provider, model: embedding.model, dimensions: embedding.dim, vectors };
      vectors = [];
    }
  }
  if (vectors.length) yield { provider: embedding.provider, model: embedding.model, dimensions: embedding.dim, vectors };
}

/**
 * A cheap fingerprint of what would be published.
 *
 * Rebuilding and re-uploading tens of megabytes on every tick would be absurd when nothing
 * has been re-indexed, and the vectors are not part of the snapshot revision.
 */
export function vectorRevision(db: Database.Database, kind: VectorKind): string | null {
  const summary = describeVectorSet(db, kind);
  return summary ? `${summary.provider}|${summary.model}|${summary.dim}|${summary.count}` : null;
}
