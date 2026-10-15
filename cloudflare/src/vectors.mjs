import { stageObject } from './objectLifecycle.mjs';
import { lexicalSearch } from './corpus.mjs';
import {
  HttpError,
  all,
  clampInteger,
  first,
  nowIso,
  readBody,
  readJson,
  run,
  safeJsonParse,
  sha256Hex,
} from './util.mjs';

const VECTOR_KINDS = new Set(['ideas', 'documents', 'passages']);
const VECTOR_FORMAT = 'nodus.vectors';
const VECTOR_MAX_DIRECT_BYTES = 32 * 1024 * 1024;

function bindingForDimensions(dimensions) {
  return `VECTORS_${dimensions}`;
}

function decodeHeader(bytes) {
  if (bytes.byteLength < 8) throw new HttpError(400, 'bad_vectors', 'The vector payload is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, true);
  if (headerLength <= 0 || headerLength > bytes.byteLength - 8) throw new HttpError(400, 'bad_vectors', 'The vector header is invalid.');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))); }
  catch { throw new HttpError(400, 'bad_vectors', 'The vector header is not JSON.'); }
  if (header?.format !== VECTOR_FORMAT || Number(header.version) !== 1 || header.quant !== 'int8-l2') throw new HttpError(400, 'bad_vectors', 'The vector format is unsupported.');
  const idsOffset = 4 + headerLength;
  const idsLength = view.getUint32(idsOffset, true);
  let ids;
  try { ids = JSON.parse(new TextDecoder().decode(bytes.subarray(idsOffset + 4, idsOffset + 4 + idsLength))); }
  catch { throw new HttpError(400, 'bad_vectors', 'The vector id table is invalid.'); }
  const dimensions = Number(header.dim);
  const count = Number(header.count);
  const matrixOffset = idsOffset + 4 + idsLength;
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > 8192 || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(ids) || ids.length !== count) {
    throw new HttpError(400, 'bad_vectors', 'The vector dimensions or count are invalid.');
  }
  if (bytes.byteLength - matrixOffset !== count * dimensions) throw new HttpError(400, 'bad_vectors', 'The vector matrix does not match its header.');
  return { header, ids, dimensions, count, matrixOffset };
}

export async function uploadExactVectorSet(env, auth, request, publicationId, kindValue) {
  const kind = String(kindValue || 'ideas');
  if (!VECTOR_KINDS.has(kind)) throw new HttpError(400, 'bad_kind', 'Vector kind must be ideas, documents or passages.');
  const publication = await first(env.DB, `SELECT * FROM publications WHERE id = ?1 AND space_id = ?2 AND status = 'staging'`, publicationId, auth.space_id);
  if (!publication) throw new HttpError(404, 'publication_not_found', 'The staging publication does not exist.');
  const bytes = await readBody(request, VECTOR_MAX_DIRECT_BYTES);
  const decoded = decodeHeader(bytes);
  if (String(decoded.header.kind) !== kind) throw new HttpError(400, 'kind_mismatch', 'The vector header and route name different kinds.');
  const hash = await sha256Hex(bytes);
  const key = await stageObject(env, `spaces/${auth.space_id}/vectors/${hash}.bin`);
  await env.OBJECTS.put(key, bytes, {
    httpMetadata: { contentType: 'application/vnd.nodus.vectors', contentDisposition: 'attachment' },
    customMetadata: { sha256: hash, kind, provider: String(decoded.header.provider || ''), model: String(decoded.header.model || '') },
  });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO objects (space_id, hash, kind, object_key, mime, bytes, created_at, last_referenced_generation)
      VALUES (?1, ?2, 'vector', ?3, 'application/vnd.nodus.vectors', ?4, ?5, ?6)
      ON CONFLICT(space_id, kind, hash) DO UPDATE SET last_referenced_generation = excluded.last_referenced_generation`).bind(
        auth.space_id, hash, key, bytes.byteLength, nowIso(), publication.generation,
      ),
    env.DB.prepare(`INSERT INTO vector_sets
      (space_id, generation, kind, provider, model, dimensions, vector_count, mode, object_key, index_binding, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'r2-exact', (SELECT object_key FROM objects WHERE space_id=?1 AND kind='vector' AND hash=?10), NULL, ?9)
      ON CONFLICT(space_id, generation, kind) DO UPDATE SET provider = excluded.provider, model = excluded.model,
        dimensions = excluded.dimensions, vector_count = excluded.vector_count, mode = excluded.mode, object_key = excluded.object_key, index_binding = NULL`).bind(
        auth.space_id, publication.generation, kind, String(decoded.header.provider || ''), String(decoded.header.model || ''),
        decoded.dimensions, decoded.count, key, nowIso(), hash,
      ),
  ]);
  await env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM objects WHERE object_key=?1)`).bind(key).run();
  return { ok: true, kind, mode: 'r2-exact', provider: decoded.header.provider, model: decoded.header.model, dim: decoded.dimensions, count: decoded.count, hash, bytes: bytes.byteLength };
}

export async function upsertVectorChunk(env, auth, request, publicationId, kindValue) {
  const kind = String(kindValue || 'ideas');
  if (!VECTOR_KINDS.has(kind)) throw new HttpError(400, 'bad_kind', 'Vector kind must be ideas, documents or passages.');
  const publication = await first(env.DB, `SELECT * FROM publications WHERE id = ?1 AND space_id = ?2 AND status = 'staging'`, publicationId, auth.space_id);
  if (!publication) throw new HttpError(404, 'publication_not_found', 'The staging publication does not exist.');
  const input = await readJson(request, 8 * 1024 * 1024);
  const chunkId = String(input.chunkId || '');
  if (!/^[0-9a-f]{64}$/.test(chunkId)) throw new HttpError(400, 'bad_chunk_id', 'Every Vectorize chunk needs its SHA-256 identifier.');
  const dimensions = Number(input.dimensions);
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > 1536) throw new HttpError(400, 'unsupported_dimensions', 'Vectorize accepts at most 1,536 dimensions.');
  const binding = bindingForDimensions(dimensions);
  const index = env[binding];
  if (!index?.upsert) throw new HttpError(409, 'vector_index_unavailable', `This deployment has no ${dimensions}-dimension Vectorize index.`);
  const vectors = Array.isArray(input.vectors) ? input.vectors : [];
  if (!vectors.length || vectors.length > 40) throw new HttpError(400, 'bad_vector_chunk', 'Send between 1 and 40 vectors per chunk.');
  const already = await first(env.DB, `SELECT 1 AS value FROM vector_chunks
    WHERE space_id = ?1 AND generation = ?2 AND kind = ?3 AND chunk_id = ?4`, auth.space_id, publication.generation, kind, chunkId);
  if (already) {
    const total = await first(env.DB, 'SELECT vector_count FROM vector_sets WHERE space_id = ?1 AND generation = ?2 AND kind = ?3', auth.space_id, publication.generation, kind);
    return { ok: true, kind, mode: 'vectorize', received: vectors.length, totalReceived: Number(total?.vector_count || 0), deduplicated: true, binding };
  }
  const prepared = vectors.map((entry) => {
    const id = String(entry?.id || '');
    const values = Array.isArray(entry?.values) ? entry.values.map(Number) : [];
    if (!id || values.length !== dimensions || values.some((value) => !Number.isFinite(value))) throw new HttpError(400, 'bad_vector', 'A vector id or dimension is invalid.');
    return { id: `${auth.space_id}:${kind}:${publication.generation}:${id}`, values, namespace: `${auth.space_id}:${kind}:${publication.generation}`, metadata: { spaceId: auth.space_id, generation: Number(publication.generation), kind, rowId: id, provider: String(input.provider || ''), model: String(input.model || '') } };
  });
  await index.upsert(prepared);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO vector_chunks
      (space_id, generation, kind, chunk_id, vector_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
      auth.space_id, publication.generation, kind, chunkId, prepared.length, nowIso(),
    ),
    ...prepared.map((entry) => env.DB.prepare(`INSERT OR IGNORE INTO vector_members
      (space_id, generation, kind, vector_id, index_binding) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(
        auth.space_id, publication.generation, kind, entry.id, binding,
      )),
  ]);
  const memberCount = await first(env.DB, `SELECT COUNT(*) AS count FROM vector_members
    WHERE space_id = ?1 AND generation = ?2 AND kind = ?3`, auth.space_id, publication.generation, kind);
  await run(env.DB, `INSERT INTO vector_sets
      (space_id, generation, kind, provider, model, dimensions, vector_count, mode, object_key, index_binding, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'vectorize', '', ?8, ?9)
      ON CONFLICT(space_id, generation, kind) DO UPDATE SET provider = excluded.provider, model = excluded.model,
        dimensions = excluded.dimensions, vector_count = excluded.vector_count,
        mode = 'vectorize', index_binding = excluded.index_binding`, auth.space_id, publication.generation, kind,
  String(input.provider || ''), String(input.model || ''), dimensions, Number(memberCount?.count || 0), binding, nowIso());
  const total = await first(env.DB, 'SELECT vector_count FROM vector_sets WHERE space_id = ?1 AND generation = ?2 AND kind = ?3', auth.space_id, publication.generation, kind);
  return { ok: true, kind, mode: 'vectorize', received: prepared.length, totalReceived: Number(total?.vector_count || 0), deduplicated: false, binding };
}

function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return new Float32Array(vector.length);
  return Float32Array.from(vector, (value) => value / norm);
}

function scoreExact(decoded, bytes, query, limit, threshold) {
  const unit = normalize(query);
  const heap = [];
  const matrix = new Int8Array(bytes.buffer, bytes.byteOffset + decoded.matrixOffset, decoded.count * decoded.dimensions);
  for (let row = 0; row < decoded.count; row += 1) {
    let dot = 0;
    const offset = row * decoded.dimensions;
    for (let column = 0; column < decoded.dimensions; column += 1) dot += unit[column] * matrix[offset + column];
    const score = dot / 127;
    if (score >= threshold) heap.push({ id: String(decoded.ids[row]), score });
  }
  heap.sort((left, right) => right.score - left.score);
  return heap.slice(0, limit);
}

async function rowsForMatches(env, space, kind, matches) {
  const source = kind === 'ideas'
    ? { table: 'ideas', idColumn: 'global_id' }
    : kind === 'documents'
      ? { table: 'document_vectors', idColumn: 'vector_id' }
      : { table: 'passages', idColumn: 'passage_id' };
  const { table, idColumn } = source;
  const wanted = new Set(matches.map((match) => String(match.id)));
  const records = await all(env.DB, `SELECT row_json FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3
      AND row_key IN (SELECT value FROM json_each(?4))`, space.id, space.active_generation, table,
  JSON.stringify([...wanted].map((id) => JSON.stringify([id]))));
  const byId = new Map(records.map((record) => safeJsonParse(record.row_json, null)).filter(Boolean).filter((row) => wanted.has(String(row[idColumn]))).map((row) => [String(row[idColumn]), row]));
  return matches.map((match) => ({ ...match, row: byId.get(String(match.id)) || null })).filter((match) => match.row);
}

export async function semanticSearch(env, auth, input) {
  const kind = String(input.kind || 'ideas');
  if (!VECTOR_KINDS.has(kind)) throw new HttpError(400, 'bad_kind', 'Vector kind must be ideas, documents or passages.');
  const space = await first(env.DB, 'SELECT * FROM spaces WHERE id = ?1', auth.space_id);
  if (!space?.active_generation) throw new HttpError(409, 'not_published', 'This vault has not been published.');
  const set = await first(env.DB, 'SELECT * FROM vector_sets WHERE space_id = ?1 AND generation = ?2 AND kind = ?3', auth.space_id, space.active_generation, kind);
  const requested = { provider: String(input.provider || ''), model: String(input.model || ''), dim: Number(input.dim || 0) };
  if (!set) return { results: await lexicalSearch(env, space, input.query, input.limit), indexed: false, reason: 'no_vectors', fallback: 'lexical', warning: 'This vault has not published semantic vectors. These are literal text results.' };
  if (set.provider !== requested.provider || set.model !== requested.model || Number(set.dimensions) !== requested.dim) {
    return { results: await lexicalSearch(env, space, input.query, input.limit), indexed: false, reason: 'provider_mismatch', expected: { provider: set.provider, model: set.model, dim: Number(set.dimensions) }, received: requested, fallback: 'lexical', warning: 'The query embedding does not match the published index. These are literal text results.' };
  }
  const vector = Array.isArray(input.vector) ? input.vector.map(Number) : [];
  if (vector.length !== Number(set.dimensions) || vector.some((value) => !Number.isFinite(value))) throw new HttpError(400, 'bad_vector', `The query needs ${set.dimensions} numeric dimensions.`);
  const limit = clampInteger(input.limit, 1, 50, 20);
  const threshold = Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : 0;
  let matches;
  if (set.mode === 'vectorize') {
    const index = env[set.index_binding];
    if (!index?.query) throw new HttpError(503, 'vector_index_unavailable', 'The configured Vectorize binding is unavailable.');
    const result = await index.query(vector, { topK: limit, namespace: `${auth.space_id}:${kind}:${space.active_generation}`, returnMetadata: 'all' });
    matches = (result.matches || []).map((match) => ({ id: String(match.metadata?.rowId || match.id), score: Number(match.score) })).filter((match) => match.score >= threshold);
  } else {
    const object = await env.OBJECTS.get(set.object_key);
    if (!object) throw new HttpError(503, 'vector_object_unavailable', 'The exact vector matrix is unavailable.');
    if (Number(object.size || 0) > 64 * 1024 * 1024) throw new HttpError(503, 'exact_search_requires_paid', 'This exact index is too large for one Worker invocation. Re-publish it to Vectorize or use Workers Paid.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    matches = scoreExact(decodeHeader(bytes), bytes, vector, limit, threshold);
  }
  return { results: await rowsForMatches(env, space, kind, matches), indexed: true, kind, indexable: Number(set.vector_count), embedding: { provider: set.provider, model: set.model, dim: Number(set.dimensions) }, backend: set.mode };
}
