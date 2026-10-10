import { stageObject } from './objectLifecycle.mjs';
import {
  HttpError,
  all,
  assertObjectHash,
  clampInteger,
  first,
  nowIso,
  randomId,
  readJson,
  run,
  sha256Hex,
} from './util.mjs';

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HLC = /^\d{13}-\d{6}-[A-Za-z0-9._:~-]{1,128}$/;
const COMMAND_KINDS = new Set(['import', 'extract', 'zoteroSync', 'merge', 'export']);
const TERMINAL = new Set(['applied', 'refused', 'failed', 'cancelled']);
const MAX_RECORD_BATCH = 12;
const MAX_LIBRARY_OBJECT_BYTES = 128 * 1024 * 1024;

function versionView(row) {
  return {
    sequence: Number(row.sequence),
    recordId: row.record_id,
    versionId: row.version_id,
    baseVersionId: row.base_version_id,
    hlc: row.hlc,
    deviceId: row.device_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    deleted: Boolean(row.deleted),
    createdAt: row.created_at,
  };
}

function commandView(row) {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    schemaVersion: Number(row.schema_version),
    payload: JSON.parse(row.payload_json),
    status: row.status,
    claimedByDevice: row.claimed_by_device,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

export async function libraryChanges(env, auth, request) {
  const url = new URL(request.url);
  const cursor = clampInteger(url.searchParams.get('cursor'), 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 100, 50);
  const rows = await all(env.DB, `SELECT * FROM library_record_versions
    WHERE user_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3`, auth.user_id, cursor, limit + 1);
  const page = rows.slice(0, limit);
  const recordIds = [...new Set(page.map((row) => row.record_id))];
  let winners = [];
  if (recordIds.length) {
    const placeholders = recordIds.map((_, index) => `?${index + 2}`).join(',');
    winners = await all(env.DB, `SELECT record_id,winner_version_id,conflicted FROM library_records
      WHERE user_id=?1 AND record_id IN (${placeholders})`, auth.user_id, ...recordIds);
  }
  const winnerByRecord = new Map(winners.map((row) => [row.record_id, row]));
  return {
    changes: page.map((row) => ({
      ...versionView(row),
      winner: winnerByRecord.get(row.record_id)?.winner_version_id === row.version_id,
      conflicted: Boolean(winnerByRecord.get(row.record_id)?.conflicted),
    })),
    cursor: Number(page.at(-1)?.sequence || cursor),
    hasMore: rows.length > limit,
  };
}

export async function postLibraryRecords(env, auth, request) {
  const input = await readJson(request, 8 * 1024 * 1024);
  const records = Array.isArray(input.records) ? input.records : [];
  if (!records.length || records.length > MAX_RECORD_BATCH) {
    throw new HttpError(400, 'bad_batch', `Send between 1 and ${MAX_RECORD_BATCH} immutable record versions.`);
  }
  const accepted = [];
  const duplicate = [];
  const conflicts = [];
  // One lookup for the batch leaves room for twelve version/record upserts and
  // authentication under D1's fifty-query Free limit.
  const existingVersions = new Map((await all(env.DB, `SELECT * FROM library_record_versions
    WHERE user_id=?1 AND version_id IN (SELECT value FROM json_each(?2))`,
  auth.user_id, JSON.stringify(records.map((item) => String(item.versionId || ''))))).map((row) => [row.version_id, row]));
  for (const item of records) {
    const recordId = String(item.recordId || '');
    const versionId = String(item.versionId || '');
    const baseVersionId = item.baseVersionId == null ? null : String(item.baseVersionId);
    const hlc = String(item.hlc || '');
    if (!ID.test(recordId) || !ID.test(versionId) || (baseVersionId && !ID.test(baseVersionId))) {
      throw new HttpError(400, 'bad_id', 'Library record and version identifiers must be 1–128 safe characters.');
    }
    if (!HLC.test(hlc)) throw new HttpError(400, 'bad_hlc', 'Library versions require a valid hybrid logical clock.');
    const deleted = item.deleted === true;
    if (!deleted && (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload))) {
      throw new HttpError(400, 'bad_payload', 'A live Library version needs an object payload.');
    }
    const payloadJson = deleted ? null : JSON.stringify(item.payload);
    const existing = existingVersions.get(versionId);
    if (existing) {
      if (existing.record_id !== recordId || existing.hlc !== hlc || existing.payload_json !== payloadJson || Boolean(existing.deleted) !== deleted) {
        throw new HttpError(409, 'version_conflict', 'That immutable version identifier already names different content.');
      }
      duplicate.push(versionId);
      continue;
    }
    const previous = await first(env.DB, 'SELECT * FROM library_records WHERE user_id=?1 AND record_id=?2', auth.user_id, recordId);
    const conflicted = Boolean(previous && baseVersionId !== previous.winner_version_id);
    const now = nowIso();
    await run(env.DB, `INSERT INTO library_record_versions
      (user_id,record_id,version_id,base_version_id,hlc,device_id,payload_json,deleted,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`, auth.user_id, recordId, versionId, baseVersionId, hlc,
    auth.device_id || null, payloadJson, deleted ? 1 : 0, now);
    await run(env.DB, `INSERT INTO library_records
      (user_id,record_id,winner_version_id,winner_hlc,payload_json,deleted,conflicted,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
      ON CONFLICT(user_id,record_id) DO UPDATE SET
        winner_version_id=CASE WHEN excluded.winner_hlc > library_records.winner_hlc OR
          (excluded.winner_hlc = library_records.winner_hlc AND excluded.winner_version_id > library_records.winner_version_id)
          THEN excluded.winner_version_id ELSE library_records.winner_version_id END,
        winner_hlc=CASE WHEN excluded.winner_hlc > library_records.winner_hlc THEN excluded.winner_hlc ELSE library_records.winner_hlc END,
        payload_json=CASE WHEN excluded.winner_hlc > library_records.winner_hlc OR
          (excluded.winner_hlc = library_records.winner_hlc AND excluded.winner_version_id > library_records.winner_version_id)
          THEN excluded.payload_json ELSE library_records.payload_json END,
        deleted=CASE WHEN excluded.winner_hlc > library_records.winner_hlc OR
          (excluded.winner_hlc = library_records.winner_hlc AND excluded.winner_version_id > library_records.winner_version_id)
          THEN excluded.deleted ELSE library_records.deleted END,
        conflicted=MAX(library_records.conflicted, excluded.conflicted),
        updated_at=excluded.updated_at`, auth.user_id, recordId, versionId, hlc, payloadJson, deleted ? 1 : 0, conflicted ? 1 : 0, now);
    accepted.push(versionId);
    existingVersions.set(versionId, { record_id: recordId, hlc, payload_json: payloadJson, deleted: deleted ? 1 : 0 });
    if (conflicted) conflicts.push({ recordId, versionId, currentWinnerVersionId: previous.winner_version_id });
  }
  const cursor = Number((await first(env.DB, 'SELECT MAX(sequence) AS cursor FROM library_record_versions WHERE user_id=?1', auth.user_id))?.cursor || 0);
  return { accepted, duplicate, conflicts, cursor };
}

export async function putLibraryObject(env, auth, hashValue, request) {
  const hash = assertObjectHash(hashValue);
  const existing = await first(env.DB, 'SELECT * FROM library_objects WHERE user_id=?1 AND hash=?2', auth.user_id, hash);
  if (existing) { await request.body?.cancel().catch(()=>{}); return {hash,bytes:Number(existing.bytes),duplicate:true}; }
  const length = Number(request.headers.get('content-length'));
  if (!request.body || !Number.isSafeInteger(length) || length<1 || length>MAX_LIBRARY_OBJECT_BYTES) throw new HttpError(411,'length_required','Library uploads need Content-Length between 1 byte and 128 MiB.');
  const objectKey = await stageObject(env, `library/${auth.user_id}/${hash}`);
  const mime = String(request.headers.get('content-type') || 'application/octet-stream').slice(0, 200);
  const stream = new FixedLengthStream(length);
  const abort = new AbortController();
  const timeout = setTimeout(()=>abort.abort(new Error('Library upload timed out')),60000);
  let results;
  try {
    results = await Promise.allSettled([
      request.body.pipeTo(stream.writable,{signal:abort.signal}).catch(error=>{abort.abort(error);throw error;}),
      env.OBJECTS.put(objectKey,stream.readable,{sha256:hash,httpMetadata:{contentType:mime},customMetadata:{sha256:hash}}).catch(error=>{abort.abort(error);throw error;}),
    ]);
  } finally {clearTimeout(timeout);}
  if (results.some(result=>result.status==='rejected')) throw new HttpError(400,'hash_mismatch','The streamed object did not match its declared size and SHA-256.');
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO library_objects(user_id,hash,object_key,mime,bytes,created_at) VALUES(?1,?2,?3,?4,?5,?6)`)
      .bind(auth.user_id,hash,objectKey,mime,length,nowIso()),
    env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM library_objects WHERE object_key=?1)`).bind(objectKey),
  ]);
  return { hash, bytes: length, duplicate: false };
}

export async function getLibraryObject(env, auth, hashValue, request) {
  const hash = assertObjectHash(hashValue);
  const row = await first(env.DB, 'SELECT * FROM library_objects WHERE user_id=?1 AND hash=?2', auth.user_id, hash);
  if (!row) throw new HttpError(404, 'object_not_found', 'This account does not have that Library object.');
  const object = await env.OBJECTS.get(row.object_key);
  if (!object) throw new HttpError(503, 'object_missing', 'The Library object metadata exists but its bytes are unavailable.');
  const headers = new Headers({
    'content-type': row.mime,
    'content-length': String(row.bytes),
    'etag': `"${hash}"`,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

export async function createLibraryCommand(env, auth, request) {
  const input = await readJson(request, 512 * 1024);
  const id = String(input.id || randomId('lcmd_'));
  const idempotencyKey = String(input.idempotencyKey || '');
  const kind = String(input.kind || '');
  const schemaVersion = Number(input.schemaVersion);
  if (!ID.test(id) || !ID.test(idempotencyKey)) throw new HttpError(400, 'bad_id', 'Command identifiers must be 1–128 safe characters.');
  if (!COMMAND_KINDS.has(kind)) throw new HttpError(400, 'unknown_command_kind', 'This Library command is not in the typed contract.');
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new HttpError(400, 'bad_schema_version', 'schemaVersion must be a positive integer.');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new HttpError(400, 'bad_payload', 'payload must be an object.');
  const payload = JSON.stringify(input.payload);
  const now = nowIso();
  try {
    await run(env.DB, `INSERT INTO library_commands
      (id,user_id,idempotency_key,kind,schema_version,payload_json,created_by_device,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,'queued',?8,?8)`, id, auth.user_id, idempotencyKey, kind, schemaVersion, payload, auth.device_id || null, now);
  } catch (error) {
    const existing = await first(env.DB, 'SELECT * FROM library_commands WHERE user_id=?1 AND idempotency_key=?2', auth.user_id, idempotencyKey);
    if (!existing) throw error;
    if (existing.kind !== kind || existing.payload_json !== payload || Number(existing.schema_version) !== schemaVersion) {
      throw new HttpError(409, 'idempotency_conflict', 'That idempotency key names a different command.');
    }
    return { command: commandView(existing), duplicate: true };
  }
  return { command: commandView(await first(env.DB, 'SELECT * FROM library_commands WHERE id=?1', id)), duplicate: false };
}

export async function listLibraryCommands(env, auth, request) {
  const url = new URL(request.url);
  const since = clampInteger(url.searchParams.get('since'), 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInteger(url.searchParams.get('limit'), 1, 100, 50);
  const rows = await all(env.DB, `SELECT * FROM library_commands WHERE user_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3`, auth.user_id, since, limit + 1);
  const page = rows.slice(0, limit);
  return { commands: page.map(commandView), cursor: Number(page.at(-1)?.sequence || since), hasMore: rows.length > limit };
}

export async function cancelLibraryCommand(env, auth, id) {
  const current = await first(env.DB, 'SELECT * FROM library_commands WHERE user_id=?1 AND id=?2', auth.user_id, id);
  if (!current) throw new HttpError(404, 'command_not_found', 'The Library command does not exist.');
  if (TERMINAL.has(current.status)) return { command: commandView(current), changed: false };
  if (!['queued', 'claimed'].includes(current.status)) throw new HttpError(409, 'command_running', 'A running command can only be stopped by the Desktop processing it.');
  const now = nowIso();
  await run(env.DB, `UPDATE library_commands SET status='cancelled',updated_at=?1,finished_at=?1
    WHERE user_id=?2 AND id=?3 AND status IN ('queued','claimed')`, now, auth.user_id, id);
  return { command: commandView(await first(env.DB, 'SELECT * FROM library_commands WHERE id=?1', id)), changed: true };
}

export async function claimLibraryCommand(env, auth, request) {
  const input = await readJson(request, 64 * 1024);
  const requested = input.id == null ? null : String(input.id);
  const candidate = requested
    ? await first(env.DB, `SELECT * FROM library_commands WHERE user_id=?1 AND id=?2 AND status='queued'`, auth.user_id, requested)
    : await first(env.DB, `SELECT * FROM library_commands WHERE user_id=?1 AND status='queued' ORDER BY sequence LIMIT 1`, auth.user_id);
  if (!candidate) return { command: null };
  const now = nowIso();
  const claimed = await env.DB.prepare(`UPDATE library_commands SET status='claimed',claimed_by_device=?1,claimed_at=?2,updated_at=?2
    WHERE id=?3 AND status='queued' RETURNING *`).bind(auth.device_id || null, now, candidate.id).first();
  return { command: claimed ? commandView(claimed) : null };
}

export async function updateLibraryCommand(env, auth, id, request) {
  const input = await readJson(request, 512 * 1024);
  const status = String(input.status || '');
  if (!['running', 'applied', 'refused', 'failed'].includes(status)) throw new HttpError(400, 'bad_command_status', 'Desktop may report running, applied, refused or failed.');
  const current = await first(env.DB, 'SELECT * FROM library_commands WHERE user_id=?1 AND id=?2', auth.user_id, id);
  if (!current) throw new HttpError(404, 'command_not_found', 'The Library command does not exist.');
  if (current.claimed_by_device !== auth.device_id) throw new HttpError(403, 'wrong_command_owner', 'Only the Desktop that claimed this command may update it.');
  if (TERMINAL.has(current.status)) return { command: commandView(current), changed: false };
  const now = nowIso();
  await run(env.DB, `UPDATE library_commands SET status=?1,result_json=?2,error_code=?3,updated_at=?4,finished_at=?5 WHERE id=?6`,
    status, input.result == null ? null : JSON.stringify(input.result), input.errorCode == null ? null : String(input.errorCode).slice(0, 128), now,
    status === 'running' ? null : now, id);
  return { command: commandView(await first(env.DB, 'SELECT * FROM library_commands WHERE id=?1', id)), changed: true };
}
