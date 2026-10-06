// Semantic search on the server.
//
// The phone cannot hold the corpus vectors — a hundred thousand passages at 1536 float32
// dimensions is ~600 MB — and the server cannot compute an embedding, because it has no API
// key and must never be given one. So the split is: the client embeds its own query with
// its own provider and posts the vector; the server owns the corpus matrix and does the
// arithmetic.
//
// The matrix is int8. Every vector is L2-normalised first, which puts each component in
// [-1, 1] and lets a single global scale of 127 serve for all of them; cosine then reduces
// to an integer dot product. The measured error is around half a percent, far under the
// thresholds the app actually uses (0.28 for ideas, 0.32 for passages).
//
// Wire format, so it can be regenerated from scratch:
//   [uint32le headerLength][header JSON][uint32le idsLength][ids JSON][count * dim int8]

export const VECTOR_FORMAT = 'nodus.vectors';
export const VECTOR_VERSION = 1;
export const VECTOR_QUANT = 'int8-l2';
export const VECTOR_KINDS = new Set(['ideas', 'documents', 'passages']);

export function decodeVectorSet(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('The vector payload is truncated.');
  const headerLength = buffer.readUInt32LE(0);
  if (headerLength <= 0 || headerLength > buffer.length - 8) throw new Error('The vector header is not readable.');
  let header;
  try { header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8')); }
  catch { throw new Error('The vector header is not valid JSON.'); }

  if (header?.format !== VECTOR_FORMAT || Number(header.version) !== VECTOR_VERSION) throw new Error('Unsupported vector format.');
  if (header.quant !== VECTOR_QUANT) throw new Error(`Unsupported quantization: ${header.quant}.`);
  if (!VECTOR_KINDS.has(header.kind)) throw new Error('Unsupported vector kind.');
  const dim = Number(header.dim);
  const count = Number(header.count);
  if (!Number.isSafeInteger(dim) || dim <= 0 || dim > 8192) throw new Error('Unsupported vector dimension.');
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Unsupported vector count.');

  const idsOffset = 4 + headerLength;
  const idsLength = buffer.readUInt32LE(idsOffset);
  let ids;
  try { ids = JSON.parse(buffer.subarray(idsOffset + 4, idsOffset + 4 + idsLength).toString('utf8')); }
  catch { throw new Error('The vector id table is not valid JSON.'); }
  if (!Array.isArray(ids) || ids.length !== count) throw new Error('The vector id table does not match the declared count.');

  const matrixOffset = idsOffset + 4 + idsLength;
  const expected = count * dim;
  const matrix = buffer.subarray(matrixOffset);
  if (matrix.length !== expected) throw new Error(`The vector matrix is ${matrix.length} bytes, expected ${expected}.`);

  return { header, ids, dim, count, matrix: new Int8Array(matrix.buffer, matrix.byteOffset, matrix.length) };
}

/** L2-normalise a query vector so its dot product against the stored matrix is a cosine. */
export function normalize(vector) {
  const out = new Float32Array(vector.length);
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return out;
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] / norm;
  return out;
}

/**
 * Encode a set of float vectors. The desktop has its own encoder in TypeScript; this one
 * exists so the round-trip can be exercised from a test without the two ever disagreeing
 * about the layout.
 */
export function encodeVectorSet({ kind, provider, model, dim, entries, embeddingContract }) {
  const ids = entries.map((entry) => String(entry.id));
  const matrix = Buffer.alloc(entries.length * dim);
  entries.forEach((entry, row) => {
    const unit = normalize(entry.vector);
    for (let column = 0; column < dim; column += 1) {
      const value = Math.round((unit[column] ?? 0) * 127);
      matrix[row * dim + column] = Math.max(-127, Math.min(127, value));
    }
  });
  const header = Buffer.from(JSON.stringify({
    format: VECTOR_FORMAT, version: VECTOR_VERSION, kind, provider, model, dim, quant: VECTOR_QUANT, count: entries.length, embeddingContract,
  }), 'utf8');
  const idTable = Buffer.from(JSON.stringify(ids), 'utf8');
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(header.length, 0);
  const idsLength = Buffer.alloc(4);
  idsLength.writeUInt32LE(idTable.length, 0);
  return Buffer.concat([headerLength, header, idsLength, idTable, matrix]);
}

/**
 * The arithmetic on its own: row numbers and scores, best first.
 *
 * Split out of `searchVectors` so a worker thread can run it without being handed the id
 * table. The ids are thirty thousand strings for a real corpus, and structured-cloning them
 * into the worker on every query would cost more than the dot products they accompany. The
 * worker returns at most `limit` row numbers and the thread that owns the set resolves them.
 */
export function scoreVectors({ dim, count, matrix }, queryVector, { limit = 20, threshold = 0 } = {}) {
  const query = normalize(queryVector);
  const scored = [];
  for (let row = 0; row < count; row += 1) {
    let dot = 0;
    const base = row * dim;
    for (let column = 0; column < dim; column += 1) dot += query[column] * matrix[base + column];
    const score = dot / 127;
    if (score >= threshold) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function searchVectors(set, queryVector, options = {}) {
  return scoreVectors(set, queryVector, options).map(({ row, score }) => ({ id: set.ids[row], score }));
}

/**
 * The same set with its matrix in shared memory.
 *
 * A decoded set views the file buffer, which belongs to the thread that read it. Copying it
 * once into a `SharedArrayBuffer` lets every worker read the matrix in place: a query then
 * posts a handle rather than thirty-three megabytes, so the cost of using a worker at all
 * does not grow with the corpus. The copy happens once per published matrix, not per query.
 */
export function withSharedMatrix(set) {
  if (set.matrix.buffer instanceof SharedArrayBuffer) return set;
  const shared = new Int8Array(new SharedArrayBuffer(set.matrix.length));
  shared.set(set.matrix);
  return { ...set, matrix: shared };
}

/**
 * Decide whether a client's embedding provider can be compared against the stored matrix.
 *
 * Dimension alone is not enough: two different 1536-dimension models would "work" and
 * return confident nonsense. Provider, model and dimension all have to line up, exactly as
 * every desktop query already filters (electron/db/passagesRepo.ts:80).
 */
export function embeddingMatches(header, requested) {
  return Boolean(header)
    && header.provider === requested.provider
    && header.model === requested.model
    && Number(header.dim) === Number(requested.dim);
}
