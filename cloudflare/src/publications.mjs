import {
  HttpError,
  OBJECT_PART_BYTES,
  TABLE_CHUNK_BYTES,
  TABLE_CHUNK_ROWS,
  all,
  assertObjectHash,
  clampInteger,
  first,
  json,
  mimeFromBytes,
  nowIso,
  problem,
  randomId,
  readBody,
  readJson,
  run,
  safeJsonParse,
  scalarRow,
  searchProjection,
  sha256Hex,
} from './util.mjs';
import { R2_ROW_BODY_FIELD, R2_ROW_HASH_FIELD, R2_ROW_TITLE_FIELD } from './rows.mjs';

import { stageObject, queueObject } from './objectLifecycle.mjs';

const PUBLICATION_TTL_MS = 24 * 3600_000;
const VALID_TABLE = /^[a-z][a-z0-9_]{0,127}$/;
const VALID_PURPOSES = new Set(['snapshot', 'asset', 'library', 'vector', 'row', 'backup']);
const MULTIPART_MAX_BYTES = {
  asset: 8 * 1024 * 1024,
  library: 128 * 1024 * 1024,
  snapshot: 512 * 1024 * 1024,
  vector: 96 * 1024 * 1024,
  row: 512 * 1024 * 1024,
  backup: 5 * 1024 ** 3,
};

function publicationManifest(row) {
  return safeJsonParse(row?.manifest_json, {});
}

async function publicationFor(env, spaceId, publicationId, requiredStatus = null) {
  const row = await first(env.DB, 'SELECT * FROM publications WHERE id = ?1 AND space_id = ?2', publicationId, spaceId);
  if (!row) throw new HttpError(404, 'publication_not_found', 'The publication session does not exist.');
  if (requiredStatus && row.status !== requiredStatus) throw new HttpError(409, 'publication_not_staging', 'The publication is no longer open for uploads.');
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new HttpError(410, 'publication_expired', 'The publication session expired. Start it again; uploaded objects remain deduplicated.');
  return row;
}

export async function createPublication(env, auth, request) {
  const manifest = await readJson(request, 2 * 1024 * 1024);
  if (Number(manifest.protocolVersion) !== 3) throw new HttpError(400, 'unsupported_protocol', 'This Worker requires publication protocol 3.');
  const revision = String(manifest.revision || '');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(revision)) throw new HttpError(400, 'bad_revision', 'The publication revision is invalid.');
  const counts = manifest.counts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new HttpError(400, 'bad_manifest', 'The publication manifest needs table counts.');
  let totalRows = 0;
  for (const [table, count] of Object.entries(counts)) {
    if (!VALID_TABLE.test(table) || !Number.isSafeInteger(count) || count < 0) throw new HttpError(400, 'bad_manifest', `The table count for ${table} is invalid.`);
    totalRows += count;
  }
  if (totalRows > 50_000_000) throw new HttpError(413, 'too_many_rows', 'This publication declares more rows than Nodus Cloud accepts.');
  const rowObjects = Array.isArray(manifest.rowObjects) ? manifest.rowObjects : [];
  if (rowObjects.length > totalRows) throw new HttpError(400, 'bad_manifest', 'The publication declares more R2 rows than structured rows.');
  const sanitizedRowObjects = rowObjects.map((entry) => {
    const hash = assertObjectHash(entry?.hash);
    const bytes = Number(entry?.bytes);
    const table = String(entry?.table || '');
    const key = String(entry?.key || '');
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MULTIPART_MAX_BYTES.row
        || !Object.prototype.hasOwnProperty.call(counts, table) || !key || key.length > 2_000) {
      throw new HttpError(400, 'bad_manifest', 'An R2 row declaration is invalid.');
    }
    return { hash, bytes, table, key };
  });
  const existing = await first(env.DB, 'SELECT id, generation, status, expires_at FROM publications WHERE space_id = ?1 AND revision = ?2', auth.space_id, revision);
  if (existing?.status === 'active') {
    return { id: existing.id, generation: existing.generation, deduplicated: true, committed: true };
  }
  if (existing?.status === 'staging') {
    // Reopening an expired session must renew the stored deadline. Merely returning
    // a fresh-looking expiresAt left every subsequent upload failing with HTTP 410.
    if (!existing.expires_at || Date.parse(existing.expires_at) <= Date.now()) {
      existing.expires_at = new Date(Date.now() + PUBLICATION_TTL_MS).toISOString();
      await run(env.DB, "UPDATE publications SET expires_at = ?1 WHERE id = ?2 AND status = 'staging'", existing.expires_at, existing.id);
    }
    return publicationSession(existing, counts);
  }
  const latest = await first(env.DB, 'SELECT COALESCE(MAX(generation), 0) AS generation FROM publications WHERE space_id = ?1', auth.space_id);
  const generation = Number(latest?.generation || 0) + 1;
  const id = randomId('pub_');
  const now = Date.now();
  const sanitized = {
    protocolVersion: 3,
    revision,
    schemaVersion: clampInteger(manifest.schemaVersion, 0, 2_147_483_647, 0),
    vault: manifest.vault && typeof manifest.vault === 'object' ? manifest.vault : null,
    capabilities: manifest.capabilities && typeof manifest.capabilities === 'object' ? manifest.capabilities : {},
    counts,
    assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    rowObjects: sanitizedRowObjects,
    library: manifest.library && typeof manifest.library === 'object' ? manifest.library : null,
    snapshot: manifest.snapshot && typeof manifest.snapshot === 'object' ? manifest.snapshot : null,
    vectors: Array.isArray(manifest.vectors) ? manifest.vectors : [],
  };
  await run(env.DB, `INSERT INTO publications
    (id, space_id, generation, revision, status, manifest_json, expires_at, created_by_device, created_at)
    VALUES (?1, ?2, ?3, ?4, 'staging', ?5, ?6, ?7, ?8)`,
    id, auth.space_id, generation, revision, JSON.stringify(sanitized), new Date(now + PUBLICATION_TTL_MS).toISOString(), auth.device_id || null, new Date(now).toISOString());
  return publicationSession({ id, generation }, counts);
}

function publicationSession(publication, counts) {
  return {
    id: publication.id,
    generation: Number(publication.generation),
    deduplicated: false,
    committed: false,
    expiresAt: publication.expires_at || new Date(Date.now() + PUBLICATION_TTL_MS).toISOString(),
    tableChunkRows: TABLE_CHUNK_ROWS,
    tableChunkBytes: TABLE_CHUNK_BYTES,
    objectPartBytes: OBJECT_PART_BYTES,
    received: Object.fromEntries(Object.keys(counts).map((table) => [table, 0])),
  };
}

export async function publicationStatus(env, spaceId, publicationId) {
  const publication = await publicationFor(env, spaceId, publicationId);
  const manifest = publicationManifest(publication);
  const rows = await all(env.DB, `SELECT table_name, COUNT(*) AS count FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 GROUP BY table_name`, spaceId, publication.generation);
  return {
    id: publication.id,
    generation: Number(publication.generation),
    status: publication.status,
    revision: publication.revision,
    received: Object.fromEntries(rows.map((row) => [row.table_name, Number(row.count)])),
    expected: manifest.counts || {},
    expiresAt: publication.expires_at,
  };
}

export async function uploadTableChunk(env, auth, publicationId, table, request) {
  if (!VALID_TABLE.test(table)) throw new HttpError(400, 'bad_table', 'The table name is invalid.');
  const publication = await publicationFor(env, auth.space_id, publicationId, 'staging');
  const manifest = publicationManifest(publication);
  if (!Object.prototype.hasOwnProperty.call(manifest.counts || {}, table)) throw new HttpError(400, 'undeclared_table', 'The table was not declared in this publication.');
  const input = await readJson(request, TABLE_CHUNK_BYTES);
  const rows = Array.isArray(input.rows) ? input.rows : null;
  if (!rows || rows.length === 0 || rows.length > TABLE_CHUNK_ROWS) throw new HttpError(400, 'bad_chunk', `Send between 1 and ${TABLE_CHUNK_ROWS} rows per chunk.`);
  const statements = [];
  for (const entry of rows) {
    const key = String(entry?.key || '');
    const row = scalarRow(entry?.row);
    if (!key || key.length > 2000 || !row) throw new HttpError(400, 'bad_row', 'Every published row needs a scalar row and a stable key.');
    const rowJson = JSON.stringify(row);
    if (new TextEncoder().encode(rowJson).byteLength > 1_800_000) throw new HttpError(413, 'row_too_large', 'A structured row is too large for D1 and must be represented as an R2 object.');
    const overflowHash = row[R2_ROW_HASH_FIELD];
    if (overflowHash && !/^[0-9a-f]{64}$/.test(String(overflowHash))) throw new HttpError(400, 'bad_row_reference', 'The R2 row reference is invalid.');
    if (overflowHash && !(manifest.rowObjects || []).some((entry) => entry.hash === overflowHash && entry.table === table && entry.key === key)) {
      throw new HttpError(400, 'undeclared_row_reference', 'The R2 row reference was not declared by this publication.');
    }
    const search = overflowHash
      ? { title: String(row[R2_ROW_TITLE_FIELD] || '').slice(0, 1000), body: String(row[R2_ROW_BODY_FIELD] || '').slice(0, 100_000) }
      : searchProjection(row);
    statements.push(env.DB.prepare(`INSERT INTO published_rows
      (space_id, generation, table_name, row_key, row_json, search_text)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(space_id, generation, table_name, row_key)
      DO UPDATE SET row_json = excluded.row_json, search_text = excluded.search_text`).bind(
        auth.space_id, publication.generation, table, key, rowJson, search.body,
      ));
    statements.push(env.DB.prepare(`DELETE FROM published_search
      WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3 AND row_key = ?4`).bind(
        auth.space_id, String(publication.generation), table, key,
      ));
    statements.push(env.DB.prepare(`INSERT INTO published_search
      (space_id, generation, table_name, row_key, title, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
        auth.space_id, String(publication.generation), table, key, search.title, search.body,
      ));
  }
  await env.DB.batch(statements);
  const count = await first(env.DB, `SELECT COUNT(*) AS count FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 AND table_name = ?3`, auth.space_id, publication.generation, table);
  const expected = Number(manifest.counts[table]);
  if (Number(count?.count || 0) > expected) throw new HttpError(409, 'too_many_rows', `The upload contains more ${table} rows than its manifest declares.`);
  return { ok: true, table, received: Number(count?.count || 0), expected };
}

function objectKey(spaceId, purpose, hash, publication = null) {
  if (purpose === 'asset') return `spaces/${spaceId}/assets/${hash}`;
  if (purpose === 'library') return `spaces/${spaceId}/library/${hash}.zip`;
  if (purpose === 'vector') return `spaces/${spaceId}/vectors/${hash}.bin`;
  if (purpose === 'row') return `spaces/${spaceId}/rows/${hash}.json`;
  if (purpose === 'snapshot') return `spaces/${spaceId}/snapshots/${hash}.json`;
  return `spaces/${spaceId}/backups/${hash}`;
}

export async function negotiateObjects(env, spaceId, input) {
  const objects = Array.isArray(input?.objects) ? input.objects.slice(0, 2000) : [];
  const normalized = [];
  for (const entry of objects) {
    const hash = assertObjectHash(entry?.hash);
    const purpose = String(entry?.purpose || 'asset');
    if (!VALID_PURPOSES.has(purpose)) throw new HttpError(400, 'bad_purpose', 'The object purpose is invalid.');
    normalized.push({ hash, purpose });
  }
  if (!normalized.length) return { missing: [] };
  // One bounded D1 statement keeps a large image/library negotiation below the
  // Workers Free subrequest ceiling. json_each is part of D1's JSON SQL support.
  const missing = await all(env.DB, `SELECT DISTINCT json_extract(requested.value, '$.hash') AS hash
    FROM json_each(?1) AS requested
    LEFT JOIN objects AS stored
      ON stored.space_id = ?2
      AND stored.kind = json_extract(requested.value, '$.purpose')
      AND stored.hash = json_extract(requested.value, '$.hash')
    WHERE stored.hash IS NULL`, JSON.stringify(normalized), spaceId);
  return { missing: missing.map((entry) => entry.hash) };
}

export async function putSmallObject(env, auth, purpose, hashValue, request, publicationId = null) {
  if (!VALID_PURPOSES.has(purpose)) throw new HttpError(400, 'bad_purpose', 'The object purpose is invalid.');
  const hash = assertObjectHash(hashValue);
  const publication = publicationId ? await publicationFor(env, auth.space_id, publicationId, 'staging') : null;
  const max = 8 * 1024 * 1024;
  const bytes = await readBody(request, max);
  if (await sha256Hex(bytes) !== hash) throw new HttpError(400, 'hash_mismatch', 'The uploaded bytes do not match their SHA-256 address.');
  const detected = mimeFromBytes(bytes);
  const declared = String(request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (purpose === 'asset' && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(detected)) throw new HttpError(415, 'unsupported_media_type', 'Nodus only publishes PNG, JPEG, WebP or GIF image assets.');
  if (purpose === 'library' && detected !== 'application/zip') throw new HttpError(415, 'unsupported_media_type', 'A library package must be a ZIP archive.');
  const mime = purpose === 'asset' ? detected : declared || detected;
  const key = await stageObject(env, objectKey(auth.space_id, purpose, hash, publication));
  const active = publication ? null : await first(env.DB, 'SELECT active_generation FROM spaces WHERE id=?1', auth.space_id);
  const referencedGeneration = publication?.generation ?? active?.active_generation ?? 0;
  await env.OBJECTS.put(key, bytes, {
    httpMetadata: { contentType: mime, contentDisposition: 'attachment' },
    customMetadata: { sha256: hash, purpose, spaceId: auth.space_id },
  });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO objects (space_id,hash,kind,object_key,mime,bytes,created_at,last_referenced_generation)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
      ON CONFLICT(space_id,kind,hash) DO UPDATE SET last_referenced_generation=MAX(COALESCE(last_referenced_generation,0),excluded.last_referenced_generation)`)
      .bind(auth.space_id,hash,purpose,key,mime,bytes.byteLength,nowIso(),referencedGeneration),
    env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM objects WHERE object_key=?1)`).bind(key),
    ...(purpose === 'snapshot' && publication ? [env.DB.prepare(`UPDATE publications SET
      snapshot_key=(SELECT object_key FROM objects WHERE space_id=?1 AND kind='snapshot' AND hash=?2),
      snapshot_sha256=?2,snapshot_bytes=?3 WHERE id=?4`).bind(auth.space_id,hash,bytes.byteLength,publication.id)] : []),
  ]);
  return { ok: true, hash, bytes: bytes.byteLength, mime, deduplicated: false };
}

export async function startMultipart(env, auth, publicationId, request) {
  const publication = publicationId ? await publicationFor(env, auth.space_id, publicationId, 'staging') : null;
  const input = await readJson(request, 64 * 1024);
  const purpose = String(input.purpose || '');
  if (!VALID_PURPOSES.has(purpose)) throw new HttpError(400, 'bad_purpose', 'The object purpose is invalid.');
  const hash = assertObjectHash(input.hash);
  const bytes = Number(input.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MULTIPART_MAX_BYTES[purpose]) throw new HttpError(400, 'bad_size', 'The declared object size is invalid for this object type.');
  const key = await stageObject(env, objectKey(auth.space_id, purpose, hash, publication));
  await run(env.DB, 'UPDATE r2_delete_queue SET not_before=?1 WHERE object_key=?2', nowIso(Date.now()+8*86400_000), key);
  const multipart = await env.OBJECTS.createMultipartUpload(key, {
    httpMetadata: { contentType: String(input.mime || 'application/octet-stream'), contentDisposition: 'attachment' },
    customMetadata: { sha256: hash, purpose, spaceId: auth.space_id },
  });
  const id = randomId('upl_');
  await run(env.DB, `INSERT INTO multipart_uploads
    (id, space_id, publication_id, purpose, hash, object_key, r2_upload_id, mime, bytes, parts_json, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', ?10, ?11)`,
    id, auth.space_id, publication?.id ?? null, purpose, hash, key, multipart.uploadId,
    String(input.mime || 'application/octet-stream'), bytes, new Date(Date.now() + 7 * 86400_000).toISOString(), nowIso());
  return { id, partBytes: OBJECT_PART_BYTES, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
}

async function multipartRecord(env, spaceId, uploadId) {
  const row = await first(env.DB, 'SELECT * FROM multipart_uploads WHERE id = ?1 AND space_id = ?2', uploadId, spaceId);
  if (!row) throw new HttpError(404, 'upload_not_found', 'The multipart upload does not exist.');
  if (Date.parse(row.expires_at) <= Date.now()) throw new HttpError(410, 'upload_expired', 'The multipart upload expired.');
  return row;
}

export async function putMultipartPart(env, auth, uploadId, partNumberValue, request) {
  const record = await multipartRecord(env, auth.space_id, uploadId);
  const partNumber = clampInteger(partNumberValue, 1, 10_000, 0);
  if (!partNumber) throw new HttpError(400, 'bad_part', 'Multipart part numbers range from 1 to 10,000.');
  const bytes = await readBody(request, OBJECT_PART_BYTES);
  const expected = request.headers.get('x-nodus-part-sha256');
  const actual = await sha256Hex(bytes);
  if (!expected || expected !== actual) throw new HttpError(400, 'part_hash_mismatch', 'The multipart part did not arrive intact.');
  const multipart = env.OBJECTS.resumeMultipartUpload(record.object_key, record.r2_upload_id);
  const part = await multipart.uploadPart(partNumber, bytes);
  const parts = safeJsonParse(record.parts_json, []).filter((entry) => Number(entry.partNumber) !== partNumber);
  parts.push({ partNumber, etag: part.etag, bytes: bytes.byteLength, sha256: actual });
  parts.sort((left, right) => left.partNumber - right.partNumber);
  await run(env.DB, 'UPDATE multipart_uploads SET parts_json = ?1 WHERE id = ?2', JSON.stringify(parts), record.id);
  return { ok: true, partNumber, etag: part.etag, bytes: bytes.byteLength, sha256: actual };
}

export async function completeMultipart(env, auth, uploadId) {
  const record = await multipartRecord(env, auth.space_id, uploadId);
  const parts = safeJsonParse(record.parts_json, []);
  if (!parts.length) throw new HttpError(400, 'missing_parts', 'Upload at least one part before completing the object.');
  const total = parts.reduce((sum, part) => sum + Number(part.bytes || 0), 0);
  if (total !== Number(record.bytes)) throw new HttpError(409, 'size_mismatch', 'The uploaded parts do not match the declared object size.');
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].partNumber !== index + 1) throw new HttpError(409, 'missing_parts', 'Multipart parts must be complete and contiguous.');
    if (index < parts.length - 1 && Number(parts[index].bytes) < 5 * 1024 * 1024) throw new HttpError(409, 'part_too_small', 'Every multipart part except the last must be at least 5 MiB.');
  }
  const multipart = env.OBJECTS.resumeMultipartUpload(record.object_key, record.r2_upload_id);
  await run(env.DB, 'UPDATE r2_delete_queue SET not_before=?1 WHERE object_key=?2', nowIso(Date.now()+86400_000), record.object_key);
  await multipart.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
  const object = await env.OBJECTS.get(record.object_key);
  if (!object || Number(object.size) !== Number(record.bytes)) {
    await queueObject(env, record.object_key);
    await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
    throw new HttpError(409, 'size_mismatch', 'The completed object size is not the declared size.');
  }
  const digestStream = new crypto.DigestStream('SHA-256');
  const digestPromise = digestStream.digest;
  await object.body.pipeTo(digestStream);
  const actualHash = [...new Uint8Array(await digestPromise)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actualHash !== record.hash) {
    await queueObject(env, record.object_key);
    await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
    throw new HttpError(400, 'hash_mismatch', 'The completed object does not match its declared SHA-256 address.');
  }
  const prefix = await env.OBJECTS.get(record.object_key, { range: { offset: 0, length: 16 } });
  const detected = prefix?.body ? mimeFromBytes(new Uint8Array(await prefix.arrayBuffer())) : 'application/octet-stream';
  if (record.purpose === 'asset' && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(detected)) {
    await queueObject(env, record.object_key); await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
    throw new HttpError(415, 'unsupported_media_type', 'Nodus only publishes PNG, JPEG, WebP or GIF image assets.');
  }
  if (record.purpose === 'library' && detected !== 'application/zip') {
    await queueObject(env, record.object_key); await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
    throw new HttpError(415, 'unsupported_media_type', 'A library package must be a ZIP archive.');
  }
  const publication = record.publication_id ? await publicationFor(env, auth.space_id, record.publication_id, 'staging') : null;
  const verifiedMime = record.purpose === 'asset' || record.purpose === 'library' ? detected : record.mime;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO objects (space_id, hash, kind, object_key, mime, bytes, created_at, last_referenced_generation)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(space_id, kind, hash) DO UPDATE SET last_referenced_generation = MAX(COALESCE(last_referenced_generation, 0), COALESCE(excluded.last_referenced_generation, 0))`).bind(
        auth.space_id, record.hash, record.purpose, record.object_key, verifiedMime, record.bytes, nowIso(), publication?.generation ?? null,
      ),
    env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM objects WHERE object_key=?1)`).bind(record.object_key),
    env.DB.prepare('DELETE FROM multipart_uploads WHERE id = ?1').bind(record.id),
    ...(record.purpose === 'snapshot' && publication ? [
      env.DB.prepare(`UPDATE publications SET snapshot_key=(SELECT object_key FROM objects WHERE space_id=?1 AND kind='snapshot' AND hash=?2),snapshot_sha256=?2,snapshot_bytes=?3 WHERE id=?4`)
        .bind(auth.space_id, record.hash, record.bytes, publication.id),
    ] : []),
  ]);
  return { ok: true, hash: record.hash, bytes: Number(record.bytes), purpose: record.purpose };
}

export async function abortMultipart(env, auth, uploadId) {
  const record = await multipartRecord(env, auth.space_id, uploadId);
  const multipart = env.OBJECTS.resumeMultipartUpload(record.object_key, record.r2_upload_id);
  await multipart.abort();
  await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
  return { ok: true };
}

async function validateAndReferenceObjects(env, spaceId, generation, kind, entries) {
  const hashes = [...new Set(entries.map((entry) => String(entry?.hash || '')).filter(Boolean))];
  for (const hash of hashes) assertObjectHash(hash);
  if (!hashes.length) return;
  const serialized = JSON.stringify(hashes);
  // The conditional UPDATE is both validation and reference acquisition. This
  // closes the race with maintenance: either maintenance removed a candidate
  // first and the changed-row count fails, or this update moves it out of the GC
  // window before maintenance can remove it.
  const referenced = await run(env.DB, `UPDATE objects SET last_referenced_generation = ?1
    WHERE space_id = ?2 AND kind = ?3
      AND hash IN (SELECT value FROM json_each(?4))`, generation, spaceId, kind, serialized);
  if (Number(referenced?.meta?.changes || 0) !== hashes.length) {
    const missing = await first(env.DB, `SELECT requested.value AS hash FROM json_each(?1) AS requested
      LEFT JOIN objects AS stored
        ON stored.space_id = ?2 AND stored.kind = ?3 AND stored.hash = requested.value
      WHERE stored.hash IS NULL LIMIT 1`, serialized, spaceId, kind);
    throw new HttpError(409, 'object_missing', `A referenced ${kind} object has not completed uploading.`, { hash: missing?.hash || null });
  }
}

function validateLibraryManifest(library) {
  if (!library) return [];
  if (library.format !== 'nodus.server-library' || Number(library.formatVersion) !== 1
      || !Array.isArray(library.documents) || !Array.isArray(library.packages)) {
    throw new HttpError(400, 'bad_library_manifest', 'The library manifest format is invalid.');
  }
  const documents = new Map();
  for (const document of library.documents) {
    const id = String(document?.id || '');
    if (!id || id.length > 2000 || documents.has(id)) {
      throw new HttpError(400, 'bad_library_manifest', 'Library document identifiers must be present and unique.');
    }
    const packageHash = document.packageHash == null ? null : assertObjectHash(document.packageHash);
    const packageBytes = document.packageBytes == null ? null : Number(document.packageBytes);
    if ((packageHash === null) !== (packageBytes === null)
        || (packageBytes !== null && (!Number.isSafeInteger(packageBytes) || packageBytes <= 0 || packageBytes > 128 * 1024 * 1024))) {
      throw new HttpError(400, 'bad_library_manifest', 'A library document has invalid package metadata.');
    }
    documents.set(id, { packageHash, packageBytes });
  }
  const packagedDocuments = new Set();
  for (const entry of library.packages) {
    const documentId = String(entry?.documentId || '');
    const hash = assertObjectHash(entry?.hash);
    const bytes = Number(entry?.bytes);
    const document = documents.get(documentId);
    if (!document || packagedDocuments.has(documentId) || document.packageHash !== hash || document.packageBytes !== bytes) {
      throw new HttpError(400, 'bad_library_manifest', 'A library package does not match its document metadata.');
    }
    packagedDocuments.add(documentId);
  }
  for (const [documentId, document] of documents) {
    if (document.packageHash && !packagedDocuments.has(documentId)) {
      throw new HttpError(409, 'library_package_missing', 'A downloadable library document has no declared package.', { documentId });
    }
  }
  return library.packages;
}

export async function commitPublication(env, auth, publicationId) {
  const publication = await publicationFor(env, auth.space_id, publicationId, 'staging');
  const manifest = publicationManifest(publication);
  const actualRows = await all(env.DB, `SELECT table_name, COUNT(*) AS count FROM published_rows
    WHERE space_id = ?1 AND generation = ?2 GROUP BY table_name`, auth.space_id, publication.generation);
  const actual = Object.fromEntries(actualRows.map((row) => [row.table_name, Number(row.count)]));
  const mismatches = [];
  for (const [table, expected] of Object.entries(manifest.counts || {})) {
    if (Number(actual[table] || 0) !== Number(expected)) mismatches.push({ table, expected: Number(expected), received: Number(actual[table] || 0) });
  }
  if (mismatches.length) throw new HttpError(409, 'incomplete_publication', 'Some table chunks have not arrived.', { mismatches });
  if (manifest.snapshot && (!publication.snapshot_key || String(publication.snapshot_sha256) !== String(manifest.snapshot.sha256))) {
    throw new HttpError(409, 'snapshot_missing', 'The declared portable snapshot has not completed uploading.');
  }
  const assetEntries = (Array.isArray(manifest.assets) ? manifest.assets : []).flatMap((asset) => [asset, ...(asset?.thumbHash ? [{ hash: asset.thumbHash }] : [])]);
  const rowObjects = Array.isArray(manifest.rowObjects) ? manifest.rowObjects : [];
  const libraryPackages = validateLibraryManifest(manifest.library);
  await validateAndReferenceObjects(env, auth.space_id, publication.generation, 'asset', assetEntries);
  await validateAndReferenceObjects(env, auth.space_id, publication.generation, 'row', rowObjects);
  await validateAndReferenceObjects(env, auth.space_id, publication.generation, 'library', libraryPackages);
  for (const expected of Array.isArray(manifest.vectors) ? manifest.vectors : []) {
    const vectorSet = await first(env.DB, `SELECT * FROM vector_sets
      WHERE space_id = ?1 AND generation = ?2 AND kind = ?3`, auth.space_id, publication.generation, String(expected.kind));
    if (!vectorSet || vectorSet.mode !== expected.mode || Number(vectorSet.dimensions) !== Number(expected.dimensions)
        || Number(vectorSet.vector_count) !== Number(expected.count) || vectorSet.provider !== String(expected.provider || '')
        || vectorSet.model !== String(expected.model || '')) {
      throw new HttpError(409, 'vectors_incomplete', 'A declared semantic index has not completed uploading.', { kind: expected.kind });
    }
    if (expected.mode === 'r2-exact') {
      const vectorObject = await first(env.DB, `SELECT hash,bytes FROM objects
        WHERE space_id = ?1 AND kind = 'vector' AND object_key = ?2`, auth.space_id, vectorSet.object_key);
      if (!vectorObject || vectorObject.hash !== String(expected.sha256 || '') || Number(vectorObject.bytes) !== Number(expected.bytes)) {
        throw new HttpError(409, 'vectors_incomplete', 'The exact vector object does not match the publication manifest.', { kind: expected.kind });
      }
    }
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE publications SET status = 'superseded'
      WHERE space_id = ?1 AND status = 'active' AND id <> ?2`).bind(auth.space_id, publication.id),
    env.DB.prepare(`UPDATE publications SET status = 'active', committed_at = ?1, expires_at = NULL WHERE id = ?2`).bind(now, publication.id),
    env.DB.prepare(`UPDATE spaces SET active_generation = ?1, revision = ?2, schema_version = ?3,
      vault_json = ?4, updated_at = ?5 WHERE id = ?6`).bind(
        publication.generation, publication.revision, Number(manifest.schemaVersion || 0), JSON.stringify(manifest.vault || null), now, auth.space_id,
      ),
  ]);
  return { ok: true, generation: Number(publication.generation), revision: publication.revision, updatedAt: now };
}

export async function getSnapshot(env, space, request) {
  const publication = await first(env.DB, `SELECT p.* FROM publications p JOIN spaces s
    ON s.id = p.space_id AND s.active_generation = p.generation WHERE p.space_id = ?1`, space.space_id);
  if (!publication?.snapshot_key) return problem(409, 'not_published', 'This vault has no portable snapshot.');
  const etag = `W/"${publication.revision}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  const object = await env.OBJECTS.get(publication.snapshot_key);
  if (!object) return problem(503, 'snapshot_unavailable', 'The snapshot manifest exists but its object is unavailable.');
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.nodus.snapshot+json',
      'content-encoding': publicationManifest(publication)?.snapshot?.contentEncoding === 'gzip' ? 'gzip' : 'identity',
      'content-length': String(publication.snapshot_bytes),
      'cache-control': 'private, max-age=0, must-revalidate',
      etag,
      'x-nodus-revision': publication.revision,
      'x-nodus-snapshot-sha256': publication.snapshot_sha256,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function getObject(env, spaceId, hashValue, request, kind = null) {
  const hash = assertObjectHash(hashValue);
  const record = kind
    ? await first(env.DB, 'SELECT * FROM objects WHERE space_id = ?1 AND kind = ?2 AND hash = ?3', spaceId, kind, hash)
    : await first(env.DB, 'SELECT * FROM objects WHERE space_id = ?1 AND hash = ?2 ORDER BY kind LIMIT 1', spaceId, hash);
  if (!record) return problem(404, 'not_found');
  const etag = `"${hash}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  const object = await env.OBJECTS.get(record.object_key);
  if (!object) return problem(404, 'not_found');
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': record.mime,
      'content-length': String(record.bytes),
      'content-disposition': 'attachment',
      'cache-control': 'private, max-age=31536000, immutable',
      etag,
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function cleanupPublications(env, retainGenerations = 3) {
  const spaces = await all(env.DB, `SELECT id,active_generation FROM spaces WHERE active_generation IS NOT NULL ORDER BY COALESCE(gc_checked_at,'') LIMIT 1`);
  let removedRows = 0;
  for (const space of spaces) {
    const floor = Number(space.active_generation) - Math.max(1, retainGenerations) + 1;
    // Vectorize is a derived search index, not a recovery artifact. Retaining old
    // namespaces multiplies billed dimensions without improving data recovery.
    const vectorFloor = Number(space.active_generation);
    const obsoleteMembers = await all(env.DB, `SELECT vector_id, index_binding FROM vector_members
      WHERE space_id = ?1 AND generation < ?2 ORDER BY generation LIMIT 1000`, space.id, vectorFloor);
    for (const binding of [...new Set(obsoleteMembers.map((row) => row.index_binding))].slice(0,4)) {
      const index = env[binding];
      if (!index?.deleteByIds) continue;
      const ids = obsoleteMembers.filter((row) => row.index_binding === binding).map((row) => row.vector_id);
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const chunk = ids.slice(offset, offset + 1000);
        await index.deleteByIds(chunk);
        await run(env.DB, `DELETE FROM vector_members WHERE space_id = ?1
          AND vector_id IN (SELECT value FROM json_each(?2))`, space.id, JSON.stringify(chunk));
      }
    }
    // Enqueue and detach in one transaction. The predicate is evaluated at commit;
    // concurrent reference acquisition either wins or finds the object missing.
    const predicate = `space_id=?1 AND kind<>'backup' AND COALESCE(last_referenced_generation,0)<?2`;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at)
        SELECT object_key,?3,?3 FROM objects WHERE ${predicate} LIMIT 10000`).bind(space.id,floor,nowIso()),
      env.DB.prepare(`DELETE FROM objects WHERE ${predicate} AND object_key IN
        (SELECT object_key FROM r2_delete_queue WHERE not_before<=?3)`).bind(space.id,floor,nowIso()),
      env.DB.prepare('UPDATE spaces SET gc_checked_at=?1 WHERE id=?2').bind(nowIso(),space.id),
    ]);
    const result = await run(env.DB, `DELETE FROM published_rows WHERE space_id = ?1 AND generation < ?2`, space.id, floor);
    await run(env.DB, `DELETE FROM published_search WHERE space_id = ?1 AND CAST(generation AS INTEGER) < ?2`, space.id, floor);
    await run(env.DB, `DELETE FROM publications WHERE space_id = ?1 AND generation < ?2 AND status <> 'active'`, space.id, floor);
    await run(env.DB, `DELETE FROM vector_chunks WHERE space_id = ?1 AND generation < ?2
      AND NOT EXISTS (SELECT 1 FROM vector_members m WHERE m.space_id = vector_chunks.space_id AND m.generation = vector_chunks.generation)`, space.id, vectorFloor);
    await run(env.DB, `DELETE FROM vector_sets WHERE space_id = ?1 AND generation < ?2
      AND NOT EXISTS (SELECT 1 FROM vector_members m WHERE m.space_id = vector_sets.space_id AND m.generation = vector_sets.generation)`, space.id, vectorFloor);
    removedRows += Number(result?.meta?.changes || 0);
  }
  const expired = await all(env.DB, 'SELECT * FROM multipart_uploads WHERE expires_at < ?1 LIMIT 2', nowIso());
  for (const record of expired) {
    try { await env.OBJECTS.resumeMultipartUpload(record.object_key, record.r2_upload_id).abort(); } catch {
      // Already completed/aborted sessions may reject abort. R2 also automatically
      // aborts incomplete uploads after seven days; the physical key stays queued.
    }
    await queueObject(env,record.object_key);
    await run(env.DB, 'DELETE FROM multipart_uploads WHERE id = ?1', record.id);
  }
  await run(env.DB, 'DELETE FROM pairing_codes WHERE expires_at < ?1', nowIso());
  await run(env.DB, 'DELETE FROM sessions WHERE expires_at < ?1', nowIso());
  await run(env.DB, 'DELETE FROM rate_limits WHERE window_start < ?1', Date.now() - 2 * 86400_000);
  return { removedRows, abortedUploads: expired.length };
}
