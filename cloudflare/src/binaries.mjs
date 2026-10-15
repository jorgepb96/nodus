import { all, assertObjectHash, first, HttpError, nowIso, randomId, readBody, run, sha256Hex } from './util.mjs';
import { stageObject } from './objectLifecycle.mjs';

export const BLOB_CHUNK_BYTES = 1024 * 1024;
export const MAX_SHARED_BLOB_BYTES = 32 * BLOB_CHUNK_BYTES;
export const MAX_DOCUMENT_UPDATE_BYTES = 8 * BLOB_CHUNK_BYTES;
export const MAX_SPACE_BINARY_BYTES = 512 * BLOB_CHUNK_BYTES;
export const MAX_SPACE_PARTIAL_BYTES = 64 * BLOB_CHUNK_BYTES;

async function ownBinary(env, auth, kind, hash) {
  return first(env.DB, 'SELECT * FROM binary_objects WHERE space_id=?1 AND kind=?2 AND hash=?3 AND user_id=?4', auth.space_id, kind, hash, auth.user_id);
}
export async function storeBinary(env, auth, kind, hash, bytes, upload = null) {
  if (await sha256Hex(bytes) !== hash) throw new HttpError(400, 'hash_mismatch', 'The binary checksum is invalid.');
  const existing = await ownBinary(env, auth, kind, hash);
  if (existing) return { ok: true, deduplicated: true, bytes: Number(existing.bytes) };
  const key = await stageObject(env, `spaces/${auth.space_id}/binary/${kind}/${hash}`);
  await env.OBJECTS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { sha256: hash } });
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO binary_objects(space_id,kind,hash,user_id,object_key,bytes,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE COALESCE((SELECT bytes+reserved FROM binary_storage_usage WHERE space_id=?1),0)+?6
        -COALESCE((SELECT total_bytes FROM blob_uploads WHERE id=?8 AND space_id=?1 AND user_id=?4),0)<=?9`)
      .bind(auth.space_id,kind,hash,auth.user_id,key,bytes.byteLength,nowIso(),upload?.id??null,MAX_SPACE_BINARY_BYTES),
    env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM binary_objects WHERE object_key=?1)`).bind(key),
    ...(upload ? [
      env.DB.prepare(`INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at) SELECT object_key,?2,?2 FROM blob_upload_chunks
        WHERE upload_id=?1 AND EXISTS(SELECT 1 FROM binary_objects WHERE space_id=?3 AND kind='blob' AND hash=?4 AND user_id=?5)`).bind(upload.id,nowIso(),auth.space_id,hash,auth.user_id),
      env.DB.prepare(`DELETE FROM blob_uploads WHERE id=?1 AND EXISTS(SELECT 1 FROM binary_objects WHERE space_id=?2 AND kind='blob' AND hash=?3 AND user_id=?4)`).bind(upload.id,auth.space_id,hash,auth.user_id),
    ] : []),
  ]);
  if (!await ownBinary(env,auth,kind,hash)) throw new HttpError(507,'binary_storage_quota_exceeded','This space has reached its 512 MiB binary storage limit.');
  return { ok: true, deduplicated: false, bytes: bytes.byteLength };
}

export async function putDocumentUpdate(env, auth, hashValue, request) {
  const hash = assertObjectHash(hashValue);
  return storeBinary(env,auth,'document-update',hash,await readBody(request,MAX_DOCUMENT_UPDATE_BYTES));
}

export async function getBinary(env, auth, kind, hashValue, request) {
  const hash = assertObjectHash(hashValue);
  const row = await first(env.DB, `SELECT * FROM binary_objects WHERE space_id=?1 AND kind=?2 AND hash=?3
    AND (user_id=?4 OR shared=1) ORDER BY user_id=?4 DESC LIMIT 1`,auth.space_id,kind,hash,auth.user_id);
  if (!row) throw new HttpError(404,'not_found','The binary is unavailable to this account.');
  let start = 0; let end = Number(row.bytes)-1; let status = 200;
  const rangeValue = request.headers.get('range');
  if (rangeValue) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(rangeValue);
    start = Number(range?.[1]); end = range?.[2] ? Math.min(end,Number(range[2])) : end;
    if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>end || start>=Number(row.bytes)) {
      return new Response(null,{status:416,headers:{'content-range':`bytes */${row.bytes}`}});
    }
    status = 206;
  }
  const length = end-start+1;
  const headers = { 'content-type':'application/octet-stream','content-length':String(length),'accept-ranges':'bytes',etag:`"${hash}"`,'cache-control':'private, immutable, max-age=31536000',
    ...(status===206 ? {'content-range':`bytes ${start}-${end}/${row.bytes}`} : {}) };
  if (request.method==='HEAD') return new Response(null,{status,headers});
  const object = await env.OBJECTS.get(row.object_key,status===206 ? {range:{offset:start,length}} : undefined);
  if (!object) throw new HttpError(503,'binary_unavailable','The binary reference exists but R2 has not returned its bytes.');
  return new Response(object.body,{status,headers});
}

export async function blobStatus(env, auth, hashValue) {
  const hash = assertObjectHash(hashValue);
  const complete = Boolean(await ownBinary(env,auth,'blob',hash));
  const upload = await first(env.DB,'SELECT * FROM blob_uploads WHERE space_id=?1 AND hash=?2 AND user_id=?3 AND expires_at>?4',auth.space_id,hash,auth.user_id,nowIso());
  const chunks = !complete && upload ? await all(env.DB,'SELECT chunk_index FROM blob_upload_chunks WHERE upload_id=?1 ORDER BY chunk_index',upload.id) : [];
  return {complete,received:chunks.map((chunk)=>Number(chunk.chunk_index)),chunkBytes:BLOB_CHUNK_BYTES,totalChunks:upload?.total_chunks??null,totalBytes:upload?.total_bytes??null};
}

export async function putBlobChunk(env, auth, hashValue, indexValue, request) {
  const hash = assertObjectHash(hashValue); const index = Number(indexValue);
  const totalChunks = Number(request.headers.get('x-nodus-total-chunks')); const totalBytes = Number(request.headers.get('x-nodus-total-bytes'));
  const chunkHash = assertObjectHash(request.headers.get('x-nodus-chunk-sha256'));
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(totalBytes) || totalBytes<1 || totalBytes>MAX_SHARED_BLOB_BYTES
    || !Number.isSafeInteger(totalChunks) || totalChunks!==Math.ceil(totalBytes/BLOB_CHUNK_BYTES) || index<0 || index>=totalChunks) throw new HttpError(400,'bad_chunk_metadata','The upload shape is invalid.');
  if (await ownBinary(env,auth,'blob',hash)) return {ok:true,complete:true};
  const bytes = await readBody(request,BLOB_CHUNK_BYTES);
  const expected = Math.min(BLOB_CHUNK_BYTES,totalBytes-index*BLOB_CHUNK_BYTES);
  if (bytes.byteLength!==expected || await sha256Hex(bytes)!==chunkHash) throw new HttpError(400,'chunk_hash_mismatch','The chunk size or checksum is invalid.');
  await run(env.DB,`INSERT OR IGNORE INTO blob_uploads(id,space_id,hash,user_id,total_bytes,total_chunks,expires_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE COALESCE((SELECT bytes+reserved FROM binary_storage_usage WHERE space_id=?2),0)+?5<=?8
      AND COALESCE((SELECT reserved FROM binary_storage_usage WHERE space_id=?2),0)+?5<=?9
      AND (SELECT COUNT(*) FROM blob_uploads WHERE space_id=?2)<16`,randomId('blob_'),auth.space_id,hash,auth.user_id,totalBytes,totalChunks,nowIso(Date.now()+86400_000),MAX_SPACE_BINARY_BYTES,MAX_SPACE_PARTIAL_BYTES);
  const upload = await first(env.DB,'SELECT * FROM blob_uploads WHERE space_id=?1 AND hash=?2 AND user_id=?3',auth.space_id,hash,auth.user_id);
  if (!upload) throw new HttpError(507,'partial_blob_quota_exceeded','The space partial upload budget is exhausted.');
  if (upload.total_bytes!==totalBytes || upload.total_chunks!==totalChunks || Date.parse(upload.expires_at)<=Date.now()) throw new HttpError(409,'upload_shape_changed','The upload shape changed or expired; wait for cleanup before retrying.');
  const existing = await first(env.DB,'SELECT hash FROM blob_upload_chunks WHERE upload_id=?1 AND chunk_index=?2',upload.id,index);
  if (existing) {
    if (existing.hash!==chunkHash) throw new HttpError(409,'chunk_changed','An immutable chunk already exists with another checksum.');
    return {ok:true,index,bytes:bytes.byteLength,deduplicated:true};
  }
  const key = await stageObject(env,`spaces/${auth.space_id}/blob-chunks/${upload.id}/${index}`);
  await env.OBJECTS.put(key,bytes);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO blob_upload_chunks(upload_id,chunk_index,hash,object_key) VALUES(?1,?2,?3,?4)').bind(upload.id,index,chunkHash,key),
    env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM blob_upload_chunks WHERE object_key=?1)`).bind(key),
  ]);
  return {ok:true,index,bytes:bytes.byteLength};
}

export async function completeBlob(env, auth, hashValue) {
  const hash = assertObjectHash(hashValue);
  if (await ownBinary(env,auth,'blob',hash)) return {ok:true,deduplicated:true};
  const upload = await first(env.DB,'SELECT * FROM blob_uploads WHERE space_id=?1 AND hash=?2 AND user_id=?3 AND expires_at>?4',auth.space_id,hash,auth.user_id,nowIso());
  if (!upload) throw new HttpError(409,'upload_not_started','No live upload exists.');
  const chunks = await all(env.DB,'SELECT * FROM blob_upload_chunks WHERE upload_id=?1 ORDER BY chunk_index',upload.id);
  if (chunks.length!==Number(upload.total_chunks) || chunks.some((chunk,index)=>Number(chunk.chunk_index)!==index)) throw new HttpError(409,'missing_chunks','The upload is incomplete.');
  const bytes = new Uint8Array(Number(upload.total_bytes)); let offset = 0;
  for (const chunk of chunks) {
    const object = await env.OBJECTS.get(chunk.object_key);
    if (!object) throw new HttpError(409,'missing_chunks','R2 has not returned a chunk.');
    const part = new Uint8Array(await object.arrayBuffer());
    if (await sha256Hex(part)!==chunk.hash || part.byteLength!==Math.min(BLOB_CHUNK_BYTES,bytes.byteLength-offset)) throw new HttpError(400,'chunk_hash_mismatch','A stored chunk is corrupt.');
    bytes.set(part,offset); offset+=part.byteLength;
  }
  return storeBinary(env,auth,'blob',hash,bytes,upload);
}

// Promote only binaries owned by the authenticated writer, after validating the
// mutation's scope. Knowing somebody else's private hash never grants access.
export async function referenceMutationBinary(env, auth, mutation, ownerScope) {
  const kind = mutation.table==='page_document_updates' ? 'document-update' : mutation.table==='db_attachments' ? 'blob' : null;
  if (!kind || mutation.kind!=='upsert') return;
  const hash = assertObjectHash(kind==='blob' ? mutation.blobHash || mutation.row?.blob_hash : mutation.documentHash || mutation.row?.update_hash);
  const object = await ownBinary(env,auth,kind,hash);
  if (!object) throw new HttpError(409,'missing_binary','Upload the binary before its mutation.');
  return {kind,hash,shared:ownerScope==='vault'?1:0};
}

export async function cleanupBlobUploads(env) {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at)
      SELECT c.object_key,?1,?1 FROM blob_upload_chunks c JOIN blob_uploads u ON u.id=c.upload_id
      WHERE u.id IN(SELECT id FROM blob_uploads WHERE expires_at<=?1 LIMIT 16)`).bind(nowIso()),
    env.DB.prepare('DELETE FROM blob_uploads WHERE id IN(SELECT id FROM blob_uploads WHERE expires_at<=?1 LIMIT 16)').bind(nowIso()),
    env.DB.prepare(`INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at) SELECT object_key,?1,?1 FROM binary_objects
      WHERE referenced_at IS NULL AND created_at<?2 LIMIT 1000`).bind(nowIso(),nowIso(Date.now()-7*86400_000)),
    env.DB.prepare(`DELETE FROM binary_objects WHERE referenced_at IS NULL AND created_at<?1 AND object_key IN(SELECT object_key FROM r2_delete_queue)`)
      .bind(nowIso(Date.now()-7*86400_000)),
  ]);
}
