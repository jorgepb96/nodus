import { stageObject } from './objectLifecycle.mjs';
import { referenceMutationBinary } from './binaries.mjs';
import {
  HttpError,
  MAX_MUTATION_BATCH,
  MAX_MUTATION_READ_BATCH,
  MAX_MUTATION_BYTES,
  all,
  clampInteger,
  clientAddress,
  first,
  nowIso,
  readJson,
  run,
  safeJsonParse,
  sha256Hex,
  strictRateLimit,
} from './util.mjs';
import { MUTABLE_TABLES } from './generated/mutableTables.mjs';

const MAX_LEDGER_BYTES = 50 * 1024 * 1024;
const MUTATION_BODY_INLINE_BYTES = 96 * 1024;
const MAX_NODI_NOTES = 500;
const MAX_NODI_NOTE_BYTES = 64 * 1024;
const MAX_PRIVATE_OWNERSHIP_ROWS = 250_000;
const TOMBSTONE_TTL_MS = 90 * 86400_000;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function isUserScopedMutationEntry(entry) {
  const table = String(entry?.table || entry?.table_name || '');
  if (MUTABLE_TABLES[table]?.scope === 'user') return true;
  if (table === 'pages' && (String(entry?.key?.[0] || '').startsWith('note:')
      || entry?.row?.note_id !== null && entry?.row?.note_id !== undefined && String(entry.row.note_id) !== '')) return true;
  const pageColumns = table === 'page_links' ? ['from_page_id', 'to_page_id']
    : ['page_blocks', 'page_document_updates', 'page_revisions', 'page_comments'].includes(table) ? ['page_id'] : [];
  return pageColumns.some((column) => String(entry?.row?.[column] || '').startsWith('note:'));
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function rowKey(key) {
  return JSON.stringify(key.map((value) => value == null ? null : String(value)));
}

function privateEntityKey(mutation) {
  return `${String(mutation.table || '')}:${rowKey(mutation.key)}`;
}

function pageIdsForMutation(mutation) {
  const table = String(mutation.table || '');
  if (table === 'page_links') return [mutation.row?.from_page_id, mutation.row?.to_page_id].filter(Boolean).map(String);
  if (['page_blocks', 'page_document_updates', 'page_revisions', 'page_comments'].includes(table)) {
    return [mutation.row?.page_id].filter(Boolean).map(String);
  }
  return [];
}

function ownershipTargets(mutation) {
  const targets = [{ namespace: 'entity', key: privateEntityKey(mutation) }];
  if (mutation.table === 'pages') {
    const key = mutation.row?.id ?? mutation.key?.[0];
    if (key !== null && key !== undefined && String(key) !== '') targets.push({ namespace: 'page', key: String(key) });
  }
  if (mutation.table === 'page_comments') {
    const key = mutation.row?.id ?? mutation.key?.[0];
    if (key !== null && key !== undefined && String(key) !== '') targets.push({ namespace: 'comment', key: String(key) });
  }
  return targets;
}

async function ownershipUsers(env, spaceId, namespace, key, cache) {
  const cacheKey = `${namespace}:${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const records = await all(env.DB, `SELECT user_id FROM private_mutation_ownership
    WHERE space_id = ?1 AND namespace = ?2 AND local_key = ?3`, spaceId, namespace, key);
  const owners = new Set(records.map((row) => String(row.user_id || '')).filter(Boolean));
  cache.set(cacheKey, owners);
  return owners;
}

async function privateOwnersForMutation(env, auth, mutation, cache, pendingPages, pendingComments) {
  const owners = new Set();
  if (isUserScopedMutationEntry(mutation)) owners.add(String(auth.user_id));
  for (const owner of await ownershipUsers(env, auth.space_id, 'entity', privateEntityKey(mutation), cache)) owners.add(owner);
  for (const pageId of pageIdsForMutation(mutation)) {
    for (const owner of await ownershipUsers(env, auth.space_id, 'page', pageId, cache)) owners.add(owner);
    for (const owner of pendingPages.get(pageId) ?? []) owners.add(owner);
  }
  if (['page_comment_reactions', 'page_comment_mentions'].includes(String(mutation.table || ''))) {
    const commentId = String(mutation.row?.comment_id ?? mutation.key?.[0] ?? '');
    if (commentId) {
      for (const owner of await ownershipUsers(env, auth.space_id, 'comment', commentId, cache)) owners.add(owner);
      for (const owner of pendingComments.get(commentId) ?? []) owners.add(owner);
    }
  }
  return owners;
}

function validateAnnotation(mutation) {
  const row = mutation.row;
  const kinds = new Set(['highlight', 'comment', 'bookmark']);
  const colors = new Set(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);
  const start = Number(row.start_offset);
  const end = Number(row.end_offset);
  const selected = typeof row.selected_text === 'string' ? row.selected_text : '';
  if (String(row.id ?? '') !== String(mutation.key[0] ?? '') || !row.draft_id || !row.scope
      || !kinds.has(String(row.kind ?? '')) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || !selected.trim() || selected.length !== end - start) return false;
  if (row.kind === 'highlight' && (!colors.has(row.color) || row.comment_text !== null)) return false;
  if (row.kind === 'comment' && (row.color !== null || typeof row.comment_text !== 'string' || !row.comment_text.trim())) return false;
  if (row.kind === 'bookmark' && (row.id !== `reader-bookmark:${row.draft_id}:${row.scope}` || row.color !== null || row.comment_text !== null)) return false;
  if (row.target_json == null) return true;
  let target;
  try { target = JSON.parse(String(row.target_json)); } catch { return false; }
  const attachment = typeof target?.attachmentId === 'string' ? target.attachmentId : '';
  const text = target?.type === 'text' && attachment && attachment.length <= 512
    && (target.page == null || Number.isInteger(target.page) && target.page > 0)
    && (target.chapterId == null || typeof target.chapterId === 'string' && target.chapterId.length <= 512);
  const region = target?.type === 'region' && attachment && attachment.length <= 512
    && [target.x, target.y, target.width, target.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && target.width > 0 && target.height > 0 && target.x + target.width <= 1.000001 && target.y + target.height <= 1.000001;
  return Boolean(text || region);
}

function validateMutation(mutation, knownColumns, existingAssets) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!mutation || typeof mutation !== 'object') return fail('malformed');
  if (typeof mutation.id !== 'string' || !ID.test(mutation.id)) return fail('bad_id');
  if (!['upsert', 'delete'].includes(mutation.kind)) return fail('unknown_kind');
  const table = String(mutation.table ?? '');
  const definition = MUTABLE_TABLES[table];
  if (!definition) return fail('table_not_mutable');
  if (!Array.isArray(mutation.key) || mutation.key.length !== definition.key.length
      || mutation.key.some((value) => value !== null && !['string', 'number'].includes(typeof value))) return fail('bad_key');
  if (definition.require) for (const [column, expected] of Object.entries(definition.require)) {
    const index = definition.key.indexOf(column);
    if (String(index >= 0 ? mutation.key[index] : mutation.row?.[column]) !== expected) return fail('constraint');
  }
  if (mutation.kind === 'delete') {
    if (mutation.row != null) return fail('delete_has_row');
  } else {
    if (!mutation.row || typeof mutation.row !== 'object' || Array.isArray(mutation.row)) return fail('missing_row');
    if (table === 'writing_draft_annotations' && !validateAnnotation(mutation)) return fail('constraint');
    for (const [column, value] of Object.entries(mutation.row)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return fail('non_scalar_value');
      const columns = knownColumns.get(table);
      if (columns && !columns.has(column)) return fail(`unknown_column:${column}`);
    }
  }
  for (const asset of Array.isArray(mutation.assets) ? mutation.assets : []) {
    if (!/^[0-9a-f]{64}$/.test(String(asset?.hash || ''))) return fail('bad_asset');
    if (!existingAssets.has(asset.hash)) return fail('missing_asset', { missing: asset.hash });
  }
  const bytes = utf8Bytes(JSON.stringify(mutation));
  if (bytes > MAX_MUTATION_BYTES) return fail('too_large', { bytes, limit: MAX_MUTATION_BYTES });
  return { ok: true, table, bytes };
}

async function validationContext(env, spaceId, batch) {
  const assets = [...new Set(batch.flatMap((mutation) => Array.isArray(mutation?.assets)
    ? mutation.assets.map((asset) => String(asset?.hash || '')).filter(Boolean) : []))];
  let existingAssets = new Set();
  if (assets.length) {
    const rows = await all(env.DB, `SELECT hash FROM objects WHERE space_id = ?1 AND kind = 'asset'
      AND hash IN (SELECT value FROM json_each(?2))`, spaceId, JSON.stringify(assets));
    existingAssets = new Set(rows.map((row) => row.hash));
  }
  const current = await first(env.DB, 'SELECT active_generation FROM spaces WHERE id = ?1', spaceId);
  const knownColumns = new Map();
  if (current?.active_generation != null) {
    const rows = await all(env.DB, `SELECT table_name, row_json FROM published_rows
      WHERE space_id = ?1 AND generation = ?2 AND table_name IN (SELECT value FROM json_each(?3))
      GROUP BY table_name`, spaceId, current.active_generation, JSON.stringify(Object.keys(MUTABLE_TABLES)));
    for (const row of rows) knownColumns.set(row.table_name, new Set(Object.keys(safeJsonParse(row.row_json, {}))));
  }
  return { existingAssets, knownColumns };
}

export async function postMutations(env, auth, request) {
  const input = await readJson(request, 8 * 1024 * 1024);
  const batch = Array.isArray(input.mutations) ? input.mutations : [];
  if (!batch.length) throw new HttpError(400, 'empty_batch', 'Send at least one mutation.');
  if (batch.length > MAX_MUTATION_BATCH) throw new HttpError(413, 'batch_too_large', `Send at most ${MAX_MUTATION_BATCH} mutations per request.`);
  const storedIds = new Set((await all(env.DB, `SELECT id FROM mutations WHERE space_id = ?1
    AND id IN (SELECT value FROM json_each(?2))`, auth.space_id,
  JSON.stringify(batch.map((mutation) => String(mutation?.id || ''))))).map((row) => row.id));
  const context = await validationContext(env, auth.space_id, batch);
  const accepted = [];
  const duplicate = [];
  const rejected = [];
  const missing = new Set();
  const valid = [];
  for (const mutation of batch) {
    if (storedIds.has(mutation?.id)) { duplicate.push(mutation.id); continue; }
    const verdict = validateMutation(mutation, context.knownColumns, context.existingAssets);
    if (!verdict.ok) {
      if (verdict.missing) missing.add(verdict.missing);
      rejected.push({ id: mutation?.id ?? null, reason: verdict.reason, ...(verdict.bytes ? { bytes: verdict.bytes, limitBytes: verdict.limit } : {}) });
      continue;
    }
    valid.push({ mutation, verdict });
  }
  if (missing.size) throw new HttpError(409, 'missing_assets', 'Upload referenced images before their mutations.', { missing: [...missing] });
  // Overflow bodies have body_json=NULL. Counting only that column made the
  // advertised 50 MiB limit ineffective for the most expensive mutations.
  // Use the per-mutation ceiling as a conservative bound for existing R2 bodies.
  const pending = await first(env.DB, `SELECT COALESCE(SUM(CASE WHEN body_object_key IS NOT NULL
    THEN ?2 ELSE LENGTH(CAST(body_json AS BLOB)) END), 0) AS bytes FROM mutations
    WHERE space_id = ?1 AND acknowledged_at IS NULL`, auth.space_id, MAX_MUTATION_BYTES);
  const incomingBytes = valid.reduce((sum, { verdict }) => sum + verdict.bytes, 0);
  if (incomingBytes && Number(pending?.bytes || 0) + incomingBytes > MAX_LEDGER_BYTES) {
    throw new HttpError(507, 'ledger_full', 'The owner must open Nodus before more changes can be accepted.', { limitBytes: MAX_LEDGER_BYTES });
  }
  const ownershipCache = new Map();
  const pendingPages = new Map();
  const pendingComments = new Map();
  const addPending = (map, key, userId) => {
    if (key === null || key === undefined || String(key) === '') return;
    const normalized = String(key);
    const owners = map.get(normalized) ?? new Set(); owners.add(String(userId)); map.set(normalized, owners);
  };
  for (const { mutation } of valid) {
    if (mutation.table === 'pages' && isUserScopedMutationEntry(mutation)) {
      addPending(pendingPages, mutation.row?.id ?? mutation.key?.[0], auth.user_id);
    }
  }
  for (const { mutation } of valid) {
    if (mutation.table !== 'page_comments') continue;
    const owners = await privateOwnersForMutation(env, auth, mutation, ownershipCache, pendingPages, pendingComments);
    if (owners.has(String(auth.user_id))) addPending(pendingComments, mutation.row?.id ?? mutation.key?.[0], auth.user_id);
  }
  const ownershipCount = await first(env.DB, 'SELECT COUNT(*) AS count FROM private_mutation_ownership WHERE space_id = ?1', auth.space_id);
  let privateOwnershipRows = Number(ownershipCount?.count || 0);
  for (const { mutation, verdict } of valid) {
    if (storedIds.has(mutation.id)) { duplicate.push(mutation.id); continue; }
    const privateOwners = await privateOwnersForMutation(env, auth, mutation, ownershipCache, pendingPages, pendingComments);
    if (privateOwners.size && !privateOwners.has(String(auth.user_id))) {
      rejected.push({ id: mutation.id, reason: 'private_parent_forbidden' });
      continue;
    }
    const ownerScope = privateOwners.has(String(auth.user_id)) ? `user:${auth.user_id}` : 'vault';
    const targets = ownerScope === 'vault' ? [] : ownershipTargets(mutation);
    const unseen = [];
    for (const target of targets) {
      const owners = await ownershipUsers(env, auth.space_id, target.namespace, target.key, ownershipCache);
      if (!owners.has(String(auth.user_id))) unseen.push(target);
    }
    if (privateOwnershipRows + unseen.length > MAX_PRIVATE_OWNERSHIP_ROWS) {
      rejected.push({ id: mutation.id, reason: 'private_ownership_capacity' });
      continue;
    }
    const binary = await referenceMutationBinary(env,auth,mutation,ownerScope);
    const body = JSON.stringify({
      id: String(mutation.id), clientId: String(mutation.clientId || ''), kind: mutation.kind,
      table: verdict.table, key: mutation.key, row: mutation.kind === 'upsert' ? mutation.row : null,
      assets: Array.isArray(mutation.assets) ? mutation.assets : [], schemaVersion: Number(mutation.schemaVersion) || 0,
      createdAt: String(mutation.createdAt || nowIso()), userId: auth.user_id, ownerScope,
      actorId: String(mutation.actorId || ''), deviceId: String(mutation.deviceId || ''), hlc: String(mutation.hlc || ''),
      documentHash: mutation.documentHash || null, blobHash: mutation.blobHash || null,
    });
    let bodyJson = body;
    let bodyObjectKey = null;
    if (utf8Bytes(body) > MUTATION_BODY_INLINE_BYTES) {
      bodyObjectKey = await stageObject(env, `spaces/${auth.space_id}/mutations/${await sha256Hex(body)}`);
      await env.OBJECTS.put(bodyObjectKey, body, { httpMetadata: { contentType: 'application/json' } });
      bodyJson = null;
    }
    const insert = env.DB.prepare(`INSERT OR IGNORE INTO mutations
      (id, space_id, client_id, user_id, kind, table_name, row_key, body_json, body_object_key, schema_version, created_at,body_bytes)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,?12
      WHERE COALESCE((SELECT bytes FROM mutation_ledger_usage WHERE space_id=?2),0)+?12<=?13`
    ).bind(String(mutation.id), auth.space_id, String(mutation.clientId || ''), auth.user_id, mutation.kind, verdict.table,
    rowKey(mutation.key), bodyJson, bodyObjectKey, Number(mutation.schemaVersion) || 0, String(mutation.createdAt || nowIso()),utf8Bytes(body),MAX_LEDGER_BYTES);
    const results = await env.DB.batch([
      insert,
      ...unseen.map(target=>env.DB.prepare(`INSERT OR IGNORE INTO private_mutation_ownership(space_id,namespace,local_key,user_id,created_at)
        SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM mutations WHERE id=?6 AND space_id=?1 AND user_id=?4 AND (body_json=?7 OR body_object_key=?8))`)
        .bind(auth.space_id,target.namespace,target.key,auth.user_id,nowIso(),String(mutation.id),bodyJson,bodyObjectKey)),
      ...(binary ? [env.DB.prepare(`UPDATE binary_objects SET shared=MAX(shared,?5),referenced_at=?6
        WHERE space_id=?1 AND kind=?2 AND hash=?3 AND user_id=?4
        AND EXISTS(SELECT 1 FROM mutations WHERE id=?7 AND space_id=?1 AND user_id=?4 AND (body_json=?8 OR body_object_key=?9))`)
        .bind(auth.space_id,binary.kind,binary.hash,auth.user_id,binary.shared,nowIso(),String(mutation.id),bodyJson,bodyObjectKey)] : []),
      ...(bodyObjectKey ? [env.DB.prepare(`DELETE FROM r2_delete_queue WHERE object_key=?1 AND EXISTS(SELECT 1 FROM mutations WHERE body_object_key=?1)`).bind(bodyObjectKey)] : []),
    ]);
    const result = results[0];
    if (Number(result?.meta?.changes || 0)) {
      accepted.push(String(mutation.id));
      storedIds.add(String(mutation.id));
      for (const target of unseen) {
        ownershipCache.get(`${target.namespace}:${target.key}`)?.add(String(auth.user_id));
      }
      privateOwnershipRows += unseen.length;
    } else {
      const existing=await first(env.DB,'SELECT id FROM mutations WHERE space_id=?1 AND id=?2',auth.space_id,String(mutation.id));
      if (existing) duplicate.push(String(mutation.id));
      else throw new HttpError(507,'ledger_capacity','The pending mutation ledger is full; retry after the owner acknowledges changes.');
    }
  }
  const cursor = accepted.length ? await first(env.DB, 'SELECT MAX(sequence) AS value FROM mutations WHERE space_id = ?1', auth.space_id) : null;
  return { accepted, duplicate, rejected, cursor: cursor?.value == null ? null : Number(cursor.value) };
}

async function mutationBody(env, row) {
  if (row.body_json) return safeJsonParse(row.body_json, null);
  if (!row.body_object_key) return null;
  const object = await env.OBJECTS.get(row.body_object_key);
  if (!object) return null;
  return safeJsonParse(await object.text(), null);
}

export async function getMutations(env, auth, request) {
  const url = new URL(request.url);
  const relay = url.searchParams.get('relay')==='1';
  const deviceId = auth.device_id || `oauth:${auth.user_id}`;
  const saved = relay ? await first(env.DB,'SELECT cursor FROM mutation_relay_cursors WHERE space_id=?1 AND device_id=?2',auth.space_id,deviceId) : null;
  const requested = Number(url.searchParams.get('since') || 0);
  if (!Number.isSafeInteger(requested) || requested<0) throw new HttpError(400,'bad_cursor','The cursor is invalid.');
  // An explicit local cursor allows recovery from an older local backup. A device
  // checkpoint is the fallback, not permission to skip locally missing changes.
  const since = url.searchParams.has('since') ? requested : Number(saved?.cursor || 0);
  const limit = clampInteger(url.searchParams.get('limit'), 1, MAX_MUTATION_READ_BATCH, MAX_MUTATION_READ_BATCH);
  const rows = await all(env.DB, `SELECT * FROM mutations WHERE space_id = ?1 AND sequence > ?2 AND (?4=1 OR acknowledged_at IS NULL)
    ORDER BY sequence LIMIT ?3`, auth.space_id, since, limit + 1, relay ? 1 : 0);
  const selected = rows.slice(0, limit);
  const mutations = [];
  for (const row of selected) {
    const body = await mutationBody(env, row);
    if (!body) throw new HttpError(503,'mutation_unavailable','A mutation body is missing; retry without advancing the cursor.');
    const explicitlyPrivate = String(body.ownerScope || '').startsWith('user:');
    const privateEntry = explicitlyPrivate || isUserScopedMutationEntry(body);
    const owner = explicitlyPrivate ? String(body.ownerScope).slice(5) : String(row.user_id || body.userId || '');
    // D1 has always stored the authenticated user_id alongside the body. Old private rows
    // therefore migrate safely; if ownership is ever absent, fail closed rather than share.
    if (privateEntry && (!owner || owner !== String(auth.user_id))) continue;
    mutations.push({ seq: Number(row.sequence), ...body });
  }
  const space = await first(env.DB, 'SELECT schema_version FROM spaces WHERE id = ?1', auth.space_id);
  return { mutations, cursor: Number(selected.at(-1)?.sequence ?? since), hasMore: rows.length > limit, spaceSchemaVersion: Number(space?.schema_version || 0) };
}

export async function ackMutations(env, auth, request) {
  const input = await readJson(request, 64 * 1024);
  const cursor = Number(input.cursor || 0);
  if (!Number.isSafeInteger(cursor) || cursor<0) throw new HttpError(400,'bad_cursor','The cursor is invalid.');
  const maximum = await first(env.DB,'SELECT COALESCE(MAX(sequence),0) AS cursor FROM mutations WHERE space_id=?1',auth.space_id);
  if (cursor>Number(maximum.cursor)) throw new HttpError(400,'bad_cursor','The cursor exceeds the ledger.');
  if (new URL(request.url).searchParams.get('relay')==='1') {
    await run(env.DB,`INSERT INTO mutation_relay_cursors(space_id,device_id,cursor) VALUES(?1,?2,?3)
      ON CONFLICT(space_id,device_id) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)`,auth.space_id,auth.device_id || `oauth:${auth.user_id}`,cursor);
    return {ok:true,cursor};
  }
  // Keep acknowledged bodies for replica relay; only bounded retention cleanup
  // removes them, with R2 deletions durably queued in the same transaction.
  await run(env.DB,`UPDATE mutations SET acknowledged_at=?1 WHERE space_id=?2 AND sequence<=?3 AND acknowledged_at IS NULL`,nowIso(),auth.space_id,cursor);
  const pending = await first(env.DB, 'SELECT COUNT(*) AS count FROM mutations WHERE space_id = ?1 AND acknowledged_at IS NULL', auth.space_id);
  return { ok: true, cursor, pending: Number(pending?.count || 0) };
}

function validateNodiNote(value, now) {
  if (!value || typeof value !== 'object' || !ID.test(String(value.id ?? ''))) return { error: 'malformed' };
  const content = value.content == null ? '' : String(value.content);
  if (utf8Bytes(content) > MAX_NODI_NOTE_BYTES) return { error: 'too_large' };
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  const deletedAt = value.deletedAt == null ? null : Number(value.deletedAt);
  if (![createdAt, updatedAt].every(Number.isFinite) || deletedAt !== null && !Number.isFinite(deletedAt)) return { error: 'malformed' };
  return { note: { id: String(value.id), title: String(value.title ?? '').slice(0, 100), titleExplicit: value.titleExplicit === true,
    content: deletedAt === null ? content : '', createdAt, updatedAt: Math.min(updatedAt, now), deletedAt } };
}

async function readNodiNotes(env, userId) {
  const rows = await all(env.DB, `SELECT id,title,title_explicit,content,created_ms,updated_ms,deleted_ms
    FROM nodi_notes WHERE user_id = ?1 ORDER BY updated_ms DESC`, userId);
  return rows.map((row) => ({
    id: row.id, title: row.title, titleExplicit: Boolean(row.title_explicit), content: row.content,
    createdAt: Number(row.created_ms), updatedAt: Number(row.updated_ms),
    deletedAt: row.deleted_ms == null ? null : Number(row.deleted_ms),
  }));
}

export async function getNodiNotes(env, auth, request) {
  const notes = await readNodiNotes(env, auth.user_id);
  const raw = new URL(request.url).searchParams.get('since');
  const since = raw == null || raw === '' ? Number.NaN : Number(raw);
  return { notes: Number.isFinite(since) ? notes.filter((note) => note.updatedAt > since) : notes,
    total: notes.filter((note) => note.deletedAt === null).length, serverTime: Date.now() };
}

export async function postNodiNotes(env, auth, request) {
  if (!await strictRateLimit(env, 'nodi-notes', `${auth.user_id}:${clientAddress(request)}`, 120, 60_000)) {
    throw new HttpError(429, 'rate_limited', 'Try synchronizing notes again shortly.');
  }
  const input = await readJson(request, 8 * 1024 * 1024);
  if (!Array.isArray(input.notes)) throw new HttpError(400, 'malformed', 'Send { notes: [...] }.');
  if (input.notes.length > MAX_NODI_NOTES) throw new HttpError(413, 'too_many', `Send at most ${MAX_NODI_NOTES} notes.`);
  const now = Date.now();
  const accepted = [];
  const rejected = [];
  for (const value of input.notes) {
    const verdict = validateNodiNote(value, now);
    if (verdict.note) accepted.push(verdict.note); else rejected.push({ id: String(value?.id ?? ''), reason: verdict.error });
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO nodi_notes
      (user_id,id,title,title_explicit,content,created_ms,updated_ms,deleted_ms)
      SELECT ?1,
        CAST(json_extract(incoming.value, '$.id') AS TEXT),
        CAST(json_extract(incoming.value, '$.title') AS TEXT),
        CASE WHEN json_extract(incoming.value, '$.titleExplicit') THEN 1 ELSE 0 END,
        CAST(json_extract(incoming.value, '$.content') AS TEXT),
        CAST(json_extract(incoming.value, '$.createdAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.updatedAt') AS INTEGER),
        CAST(json_extract(incoming.value, '$.deletedAt') AS INTEGER)
      FROM json_each(?2) AS incoming WHERE true
      ON CONFLICT(user_id,id) DO UPDATE SET
        title=excluded.title,title_explicit=excluded.title_explicit,content=excluded.content,
        created_ms=MIN(nodi_notes.created_ms,excluded.created_ms),updated_ms=excluded.updated_ms,deleted_ms=excluded.deleted_ms
      WHERE excluded.updated_ms > nodi_notes.updated_ms
        OR (excluded.updated_ms = nodi_notes.updated_ms AND excluded.deleted_ms IS NOT NULL AND nodi_notes.deleted_ms IS NULL)`).bind(
      auth.user_id, JSON.stringify(accepted),
    ),
    env.DB.prepare(`DELETE FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NOT NULL AND deleted_ms < ?2`).bind(
      auth.user_id, now - TOMBSTONE_TTL_MS,
    ),
    env.DB.prepare(`DELETE FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NULL AND id NOT IN (
      SELECT id FROM nodi_notes WHERE user_id = ?1 AND deleted_ms IS NULL ORDER BY updated_ms DESC LIMIT ?2
    )`).bind(auth.user_id, MAX_NODI_NOTES),
  ]);
  const notes = await readNodiNotes(env, auth.user_id);
  const live = notes.filter((note) => note.deletedAt === null);
  const raw = new URL(request.url).searchParams.get('since');
  const since = raw == null || raw === '' ? Number.NaN : Number(raw);
  return { notes: Number.isFinite(since) ? notes.filter((note) => note.updatedAt > since) : notes,
    total: live.length, rejected, serverTime: now };
}

export async function cleanupSync(env) {
  const old = nowIso(Date.now()-30*86400_000);
  return env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at)
      SELECT body_object_key,?2,?2 FROM mutations WHERE sequence IN
      (SELECT sequence FROM mutations WHERE acknowledged_at IS NOT NULL AND acknowledged_at<?1 LIMIT 1000)
      AND body_object_key IS NOT NULL`).bind(old,nowIso()),
    env.DB.prepare(`DELETE FROM mutations WHERE sequence IN
      (SELECT sequence FROM mutations WHERE acknowledged_at IS NOT NULL AND acknowledged_at<?1 LIMIT 1000)`).bind(old),
  ]);
}
