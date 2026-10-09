import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { ensureWorkspaceDevice, getDb, withDatabaseContext } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import * as pages from '../db/pagesRepo';
import { SCHEMA_VERSION } from '../db/migrations';
import { quoteIdentifier, identityColumns } from '../db/rowIdentity';
import { createVault, deleteVault, getVault, listVaults, updateVaultRemote } from '../vaults/vaultRegistry';
import { clearNodusServerTokenFor, getNodusServerTokenFor, setNodusServerTokenFor } from '../secrets/secretStore';
import type { ReplicaPresenceInput, ReplicaPresenceParticipant, VaultRemote, VaultRemoteRole, VaultSummary, VaultType } from '@shared/types';
import { normalizeVaultType } from '@shared/vaultTypes';
import { applySnapshotToReplica, downloadReplicaAssets } from './replicaApply';
import { stripUnpublishableColumns, type SnapshotAssetRef } from './serverSnapshot';
import {
  countOutbox, ensureOutboxTriggers, listPendingOutbox, markOutboxRejected, markOutboxSent, MUTABLE_TABLES, pruneSentOutbox,
  withOutboxSuppressed,
} from './outboxTriggers';
import { applyIncomingMutations, type IncomingMutation } from './mutationInbox';
import { recordServerInbox } from '../db/serverInboxRepo';
import { syncServerProfilePreferencesForVault } from './profilePreferencesSync';
import {
  LEGACY_SERVER_MUTATION_LIMITS,
  negotiateRemoteMutationLimits,
  type RemoteMutationLimits,
} from './serverCompatibility';
import { requestTimeoutMs } from './serverNetwork';

/**
 * A connected vault: a local replica of a Nodus Server space.
 *
 * The publisher in serverSyncService.ts pushes; this pulls, and — for an account with write
 * access — drains the outgoing queue. They are deliberately separate services with separate
 * timers, because a machine can hold both kinds of vault at once: the corpus it owns and
 * publishes, and a colleague's corpus it merely reads.
 *
 * What this never does is delete local data. A revoked replica stops syncing and says so;
 * its rows stay exactly where they are. Destroying someone's own notes because a server
 * withdrew access is not a recovery, and it is not ours to do.
 */

const CHECK_INTERVAL_MS = 30_000;
const FIRST_TICK_MS = 7_000;
const OUTBOX_BATCH = 100;
const SHARED_BLOB_CHUNK_BYTES = 1024 * 1024;

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let working = false;
let eventWatchersStopped = true;

// SSE is only a wake-up signal. The durable source of truth remains the mutation relay,
// which means a disconnected stream loses no work: the thirty-second poll below asks for
// the same cursor and catches everything the next time either transport is available.
const eventControllers = new Map<string, AbortController>();
const eventReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const eventWakeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type ReplicaPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'revoked' | 'paused';

interface ReplicaRuntime {
  phase: ReplicaPhase;
  lastPulledAt: string | null;
  lastError: string | null;
  pendingMutations: number;
  rejectedMutations: number;
  /** Illustrations fetched on the last pull; zero once the replica holds them all. */
  lastImages: { downloaded: number; bytes: number; skipped: number } | null;
}

const runtimes = new Map<string, ReplicaRuntime>();
const readonlyPool = new Map<string, Database.Database>();

/**
 * Publications this build refused because their schema is newer than its own.
 *
 * Without this the refusal was rediscovered on every thirty-second tick: the stored ETag is
 * the last revision APPLIED, so the server answered each poll with the whole snapshot again
 * (36.7 MiB gzipped on a real academic library), which was then gunzipped and parsed on the
 * main thread (0.7–1.6 s) only to be refused. Asking with the refused revision lets the
 * server answer 304 until it publishes something else. In memory on purpose: installing the
 * update that can read it restarts the app, which is when it must be fetched again.
 */
const refusedSnapshots = new Map<string, { revision: string; message: string }>();

function runtimeFor(vaultId: string): ReplicaRuntime {
  let runtime = runtimes.get(vaultId);
  if (!runtime) {
    runtime = { phase: 'idle', lastPulledAt: null, lastError: null, pendingMutations: 0, rejectedMutations: 0, lastImages: null };
    runtimes.set(vaultId, runtime);
  }
  return runtime;
}

function normalizeUrl(value: string): string {
  const clean = String(value ?? '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error('Introduce una URL válida del servidor.'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Nodus Server necesita HTTPS fuera de localhost.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Usa solo la dirección base del servidor, sin credenciales, parámetros ni fragmentos.');
  return parsed.toString().replace(/\/+$/, '');
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs(init)) });
}

function deviceName(): string {
  return `Nodus · ${os.hostname()}`;
}

// ── Sign-in, in two steps ───────────────────────────────────────────────────
// The user knows their URL, email and password; they do not know the space ids. The first
// call returns a short-lived single-use ticket plus the spaces the account can reach, so the
// app can show a picker without holding the password or sending it twice.

export interface RemoteSpaceOption {
  id: string;
  name: string;
  description: string;
  role: VaultRemoteRole;
  vault: { id: string; name: string; type: string } | null;
  updatedAt: string | null;
  hasSnapshot: boolean;
}

export interface RemoteSignInResult {
  ticket: string;
  url: string;
  serverName: string;
  userEmail: string;
  serverKind: 'classic' | 'cloudflare';
  spaces: RemoteSpaceOption[];
}

export async function signInToNodusServer(urlValue: string, email: string, password: string): Promise<RemoteSignInResult> {
  const url = normalizeUrl(urlValue);
  const response = await request(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 401) throw new Error('El correo o la contraseña no son correctos.');
  if (response.status === 404) throw new Error('Ese servidor es anterior a los vaults conectados. Pide que lo actualicen.');
  if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);
  const value = await response.json() as { ticket: string; spaces: RemoteSpaceOption[]; service?: string; serverName?: string; server?: { name?: string; service?: string } };
  return {
    ticket: value.ticket,
    url,
    serverName: value.serverName ?? value.server?.name ?? 'Nodus Server',
    userEmail: String(email).trim().toLowerCase(),
    serverKind: value.service === 'nodus-cloudflare' || value.server?.service === 'nodus-cloudflare' ? 'cloudflare' : 'classic',
    spaces: value.spaces ?? [],
  };
}

/**
 * Create the replica: a real, fully migrated SQLite that every repository reads normally.
 *
 * Not a proxy over HTTP. Making getDb() speak to a server would mean rewriting every one of
 * the ~70 repositories, the graph service and the MCP surface; replicating into a local
 * database means all of them work unchanged, and the vault stays readable on a train.
 */
export async function createConnectedVault(input: {
  url: string;
  ticket: string;
  space: RemoteSpaceOption;
  userEmail: string;
  serverName: string;
  serverKind?: 'classic' | 'cloudflare';
}): Promise<VaultSummary> {
  // Capture the currently configured Desktop profile before creating the new replica.
  // createVault itself does not switch vaults, but keeping the snapshot explicit makes
  // the inheritance source unambiguous and protects this flow from future registry changes.
  const inheritedSettings = getSettings();
  const url = normalizeUrl(input.url);
  const response = await request(`${url}/api/v1/auth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: input.ticket, spaceId: input.space.id, deviceName: deviceName() }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error_description?: string };
    throw new Error(detail.error_description || `El servidor rechazó la conexión (HTTP ${response.status}).`);
  }
  const session = await response.json() as { deviceToken: string; role: VaultRemoteRole; space: { id: string; name: string; vault?: { type?: string } | null } };

  const remote: VaultRemote = {
    serverKind: input.serverKind === 'cloudflare' ? 'cloudflare' : 'classic',
    url,
    spaceId: input.space.id,
    spaceName: input.space.name,
    serverName: input.serverName,
    userEmail: input.userEmail,
    role: session.role,
    state: 'active',
    lastPulledRevision: null,
    lastPulledAt: null,
  };
  // The vault type comes from the publication, not from the user: a connected academic vault
  // is an academic vault, and letting someone pick a different mode for it would show them a
  // navigation that does not match the data they are about to receive.
  const type: VaultType = normalizeVaultType(input.space.vault?.type ?? session.space.vault?.type ?? 'academic');
  const vault = createVault(input.space.name, type, { origin: 'connected', remote });

  try {
    setNodusServerTokenFor(vault.id, session.deviceToken);
    await pullReplica(vault.id, { force: true });
    // pullReplica reports a failure on the runtime instead of throwing, so it has to be read
    // here; otherwise the rollback below never runs and the sign-in "succeeds" over an empty
    // vault. A space with no publication yet is not a failure (phase 'ok', with a notice).
    const hydration = runtimeFor(vault.id);
    if (hydration.phase === 'error' || hydration.phase === 'revoked') {
      throw new Error(hydration.lastError || 'No se ha podido descargar el espacio remoto.');
    }
  } catch (error) {
    runtimes.delete(vault.id);
    // A hydration that never completed leaves a vault that looks connected and holds
    // nothing. Roll it back rather than leave that behind.
    try { deleteVault(vault.id, true); } catch { /* the registry entry is already gone */ }
    throw error;
  }
  // Preference inheritance is personal control-plane state, not vault hydration. An
  // older/basic Server may not support it and must never make an otherwise valid replica
  // fail or roll back. Advanced Server persists the allowlisted profile synchronously.
  await syncServerProfilePreferencesForVault(vault, inheritedSettings).catch(() => undefined);
  return getVault(vault.id) ?? vault;
}

// ── Pulling ─────────────────────────────────────────────────────────────────

function mayWrite(vault: VaultSummary): boolean {
  return vault.remote?.state === 'active' && (vault.remote.role === 'writer' || vault.remote.role === 'owner');
}

function openReplicaDb(vault: VaultSummary): Database.Database | null {
  if (vault.active) return getDb();
  const cached = readonlyPool.get(vault.path);
  if (cached) {
    try {
      cached.prepare('SELECT 1').get();
      // The role can change between ticks, so the gate is re-evaluated on every use rather
      // than only when the handle was first opened.
      ensureOutboxTriggers(cached, mayWrite(vault));
      return cached;
    } catch { readonlyPool.delete(vault.path); }
  }
  try {
    // Writable, unlike the publisher's read-only siblings: applying a publication is a write.
    const db = new Database(vault.path, { fileMustExist: true });
    ensureWorkspaceDevice(db);
    // A non-active replica never goes through openDatabase(), which is where the gate
    // normally lives — without this, a writer's queue would silently never be populated.
    ensureOutboxTriggers(db, mayWrite(vault));
    readonlyPool.set(vault.path, db);
    return db;
  } catch { return null; }
}

function closeReplicaPool(): void {
  for (const db of readonlyPool.values()) { try { db.close(); } catch { /* ignore */ } }
  readonlyPool.clear();
}

/**
 * A 401 or 403 from the server.
 *
 * The publisher's answer is to drop its token and ask for a fresh pairing code. For a
 * replica that answer would be wrong: the vault stays, its data stays, and the user is told
 * they can sign in again or keep it as a local vault.
 */
function handleRevocation(vaultId: string, runtime: ReplicaRuntime): void {
  updateVaultRemote(vaultId, { state: 'revoked' });
  clearNodusServerTokenFor(vaultId);
  runtime.phase = 'revoked';
  runtime.lastError = 'El servidor ha revocado tu acceso a este espacio. La réplica sigue en este equipo y puedes seguir consultándola o convertirla en un vault local.';
}

async function pullRelayOperations(vault: VaultSummary, token: string, db: Database.Database, snapshotRevision: string | null): Promise<void> {
  const endpoint = `${normalizeUrl(vault.remote!.url)}/api/v1/spaces/${encodeURIComponent(vault.remote!.spaceId)}/mutations`;
  for (let batch = 0; batch < 8; batch += 1) {
    const response = await request(`${endpoint}?limit=50`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401 || response.status === 403 || response.status === 404 || !response.ok) return;
    const value = await response.json() as { mutations?: IncomingMutation[]; hasMore?: boolean };
    const mutations = value.mutations ?? []; if (!mutations.length) return;
    for (const mutation of mutations) {
      if (mutation.kind !== 'upsert' || !['world_images', 'map_images'].includes(mutation.table)) continue;
      const hash = String(mutation.assets?.[0]?.hash ?? '');
      // Deterministic: refused and acknowledged rather than thrown, or this one row would
      // stop the replica from receiving anything after it.
      if (!/^[0-9a-f]{64}$/.test(hash)) { mutation.refusal = 'La imagen llegó sin referencia a sus bytes y no puede guardarse.'; continue; }
      const binary = await request(
        `${normalizeUrl(vault.remote!.url)}/api/v1/spaces/${encodeURIComponent(vault.remote!.spaceId)}/assets/${hash}`,
        { headers: { authorization: `Bearer ${token}`, accept: 'image/*' } },
      );
      if (!binary.ok) throw new Error(`No se pudo descargar la imagen ${hash.slice(0, 12)} (HTTP ${binary.status}).`);
      const bytes = Buffer.from(await binary.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Una imagen de mundo no coincide con su hash.');
      mutation.row = { ...(mutation.row ?? {}), blob: bytes, bytes: bytes.length };
    }
    for (const mutation of mutations) {
      if (mutation.table !== 'page_document_updates' || mutation.kind !== 'upsert') continue;
      const hash = String(mutation.documentHash ?? mutation.row?.update_hash ?? '');
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('El servidor entregó una actualización Yjs sin hash válido.');
      const binary = await request(
        `${normalizeUrl(vault.remote!.url)}/api/v1/spaces/${encodeURIComponent(vault.remote!.spaceId)}/document-updates/${hash}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!binary.ok) throw new Error(`No se pudo descargar la actualización Yjs ${hash.slice(0, 12)} (HTTP ${binary.status}).`);
      const bytes = Buffer.from(await binary.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Una actualización Yjs no coincide con su hash.');
      mutation.row = { ...(mutation.row ?? {}), update_blob: bytes, update_hash: hash };
    }
    for (const mutation of mutations) {
      if (mutation.table !== 'db_attachments' || mutation.kind !== 'upsert') continue;
      const hash = String(mutation.blobHash ?? mutation.row?.blob_hash ?? '');
      if (!hash) continue;
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('El servidor entregó un adjunto sin hash válido.');
      if (db.prepare('SELECT 1 FROM db_blobs WHERE hash = ?').get(hash)) continue;
      const expected = Number(mutation.row?.bytes ?? 0);
      const chunks: Buffer[] = [];
      for (let start = 0; start < expected; start += SHARED_BLOB_CHUNK_BYTES) {
        const end = Math.min(expected - 1, start + SHARED_BLOB_CHUNK_BYTES - 1);
        const part = await request(
          `${normalizeUrl(vault.remote!.url)}/api/v1/spaces/${encodeURIComponent(vault.remote!.spaceId)}/blobs/${hash}`,
          { headers: { authorization: `Bearer ${token}`, range: `bytes=${start}-${end}` } },
        );
        if (part.status !== 206 && !(start === 0 && part.status === 200)) throw new Error(`No se pudo reanudar el adjunto ${hash.slice(0, 12)}.`);
        chunks.push(Buffer.from(await part.arrayBuffer()));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== expected || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Un adjunto descargado no coincide con su checksum.');
      const timestamp = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO db_blobs
          (hash, bytes, mime_type, data, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(hash, bytes.length, mutation.row?.mime_type ?? null, bytes, mutation.actorId || 'remote', mutation.actorId || 'remote', timestamp, timestamp);
    }
    const summary = withOutboxSuppressed(db, () => withDatabaseContext(db, () => applyIncomingMutations(db, mutations, {
      external: (mutation) => {
        if (mutation.table === 'page_revisions' && mutation.kind === 'upsert') {
          const pageId = String(mutation.row?.page_id ?? '');
          const revision = Number(mutation.row?.revision ?? 0);
          if (pageId && revision > 0 && db.prepare('SELECT 1 FROM page_revisions WHERE page_id = ? AND revision = ?').get(pageId, revision)) {
            return { outcome: 'keptLocal', entityKind: 'page_revision' };
          }
        }
        if (mutation.table !== 'page_document_updates' || mutation.kind !== 'upsert') return null;
        const hash = String(mutation.documentHash ?? mutation.row?.update_hash ?? '');
        const pageId = String(mutation.row?.page_id ?? '');
        const bytes = mutation.row?.update_blob;
        if (!pageId || !Buffer.isBuffer(bytes)) throw new Error('La actualización Yjs está incompleta.');
        if (db.prepare('SELECT 1 FROM page_document_update_receipts WHERE update_hash = ?').get(hash)
          || db.prepare('SELECT 1 FROM page_document_updates WHERE page_id = ? AND update_hash = ?').get(pageId, hash)) {
          db.prepare(
            'INSERT OR IGNORE INTO page_document_update_receipts (update_hash, page_id, operation_id, applied_at) VALUES (?, ?, ?, ?)',
          ).run(hash, pageId, mutation.id, new Date().toISOString());
          return { outcome: 'keptLocal' };
        }
        const current = pages.getPageDocument(pageId);
        if (!current) throw new Error('La página de la actualización Yjs no existe todavía.');
        const applied = pages.applyPageDocumentUpdate(pageId, new Uint8Array(bytes), current.revision, mutation.actorId || 'remote');
        if (!applied.ok) throw new Error('La página cambió mientras se aplicaba su actualización Yjs.');
        db.prepare(
          'INSERT OR IGNORE INTO page_document_update_receipts (update_hash, page_id, operation_id, applied_at) VALUES (?, ?, ?, ?)',
        ).run(hash, pageId, mutation.id, new Date().toISOString());
        return { outcome: 'applied', entityKind: 'page_update', title: applied.document.page.title };
      },
    })));
    if (vault.active && summary.entries.length) recordServerInbox(summary.entries, { spaceId: vault.remote!.spaceId });
    if (summary.cursor > 0) {
      const ack = await request(`${endpoint}/ack`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cursor: summary.cursor }) });
      if (!ack.ok) return;
      db.prepare(`INSERT INTO sync_snapshot_cursors (stream_id, cursor, snapshot_revision, hydrated_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(stream_id) DO UPDATE SET cursor = MAX(cursor, excluded.cursor),
          snapshot_revision = excluded.snapshot_revision, hydrated_at = COALESCE(sync_snapshot_cursors.hydrated_at, excluded.hydrated_at),
          updated_at = excluded.updated_at`)
        .run(`server:${vault.remote!.spaceId}`, summary.cursor, snapshotRevision, new Date().toISOString(), new Date().toISOString());
    }
    if (summary.retryable.length || summary.refused.length || !value.hasMore) return;
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

function scheduleReplicaWake(vaultId: string): void {
  if (eventWatchersStopped || eventWakeTimers.has(vaultId)) return;
  const wake = setTimeout(() => {
    eventWakeTimers.delete(vaultId);
    void pullReplica(vaultId);
  }, 25);
  wake.unref?.();
  eventWakeTimers.set(vaultId, wake);
}

function scheduleEventReconnect(vaultId: string): void {
  if (eventWatchersStopped || eventReconnectTimers.has(vaultId)) return;
  const reconnect = setTimeout(() => {
    eventReconnectTimers.delete(vaultId);
    const vault = getVault(vaultId);
    if (vault?.origin === 'connected' && vault.remote?.state === 'active') watchReplicaEvents(vault);
  }, 5_000);
  reconnect.unref?.();
  eventReconnectTimers.set(vaultId, reconnect);
}

/**
 * Listen for tiny, ephemeral wake-ups while mutations themselves stay in the durable relay.
 * Parsing is intentionally limited to SSE frame boundaries: no payload is applied from this
 * connection, so a truncated frame, reconnect or proxy retry can never create partial data.
 */
async function watchReplicaEvents(vault: VaultSummary): Promise<void> {
  if (eventWatchersStopped || eventControllers.has(vault.id) || !vault.remote) return;
  const token = getNodusServerTokenFor(vault.id);
  if (!token) return;
  const controller = new AbortController();
  eventControllers.set(vault.id, controller);
  try {
    const endpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/mutations/events`;
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      handleRevocation(vault.id, runtimeFor(vault.id));
      return;
    }
    if (!response.ok || !response.body) throw new Error(`Mutation events returned HTTP ${response.status}.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = pending.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (frame.split('\n').some((line) => line.trim() === 'event: mutation')) scheduleReplicaWake(vault.id);
        boundary = pending.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) runtimeFor(vault.id).lastError = error instanceof Error ? error.message : String(error);
  } finally {
    if (eventControllers.get(vault.id) === controller) eventControllers.delete(vault.id);
    if (!controller.signal.aborted) scheduleEventReconnect(vault.id);
  }
}

function startReplicaEventWatchers(): void {
  eventWatchersStopped = false;
  for (const vault of connectedVaults()) {
    if (vault.remote?.state === 'active') void watchReplicaEvents(vault);
  }
}

function stopReplicaEventWatchers(): void {
  eventWatchersStopped = true;
  for (const controller of eventControllers.values()) controller.abort();
  eventControllers.clear();
  for (const reconnect of eventReconnectTimers.values()) clearTimeout(reconnect);
  eventReconnectTimers.clear();
  for (const wake of eventWakeTimers.values()) clearTimeout(wake);
  eventWakeTimers.clear();
}

export async function pullReplica(vaultId: string, options: { force?: boolean } = {}): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault || vault.origin !== 'connected' || !vault.remote) return;
  const runtime = runtimeFor(vaultId);
  if (vault.remote.state === 'revoked') { runtime.phase = 'revoked'; return; }
  if (vault.remote.state === 'paused' && !options.force) { runtime.phase = 'paused'; return; }
  const token = getNodusServerTokenFor(vaultId);
  if (!token) { runtime.phase = 'error'; runtime.lastError = 'Falta la credencial de este vault conectado. Vuelve a iniciar sesión en el servidor.'; return; }

  const endpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}`;
  runtime.phase = 'syncing';
  try {
    // Refresh the role first: a downgrade has to reach ensureOutboxTriggers before anything
    // else runs, or a demoted account keeps queueing until its next restart.
    await refreshRole(vault, token);
    // Retry a changed/offline profile only for the active replica: that is the vault whose
    // per-vault model selectors getSettings() currently represents.
    if (vault.active) await syncServerProfilePreferencesForVault(vault, undefined, { pull: true }).catch(() => undefined);

    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const refused = refusedSnapshots.get(vaultId);
    if (refused) headers['if-none-match'] = `W/"${refused.revision}"`;
    else if (vault.remote.lastPulledRevision && !options.force) headers['if-none-match'] = `W/"${vault.remote.lastPulledRevision}"`;
    const response = await request(`${endpoint}/snapshot`, { headers });

    if (response.status === 401 || response.status === 403) { handleRevocation(vaultId, runtime); return; }
    if (response.status === 304 && refused) {
      // Still the publication this build cannot read. Same answer as when it was refused,
      // without downloading it again.
      runtime.phase = 'error';
      runtime.lastError = refused.message;
      return;
    }
    if (response.status === 304) {
      const db = openReplicaDb(vault);
      if (db) await pullRelayOperations(vault, token, db, vault.remote.lastPulledRevision);
      runtime.phase = 'ok';
      runtime.lastError = null;
      await drainOutbox(vaultId);
      return;
    }
    if (response.status === 409) {
      runtime.phase = 'ok';
      runtime.lastError = 'El espacio remoto todavía no ha recibido ninguna publicación.';
      return;
    }
    if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);

    const raw = Buffer.from(await response.arrayBuffer());
    // fetch() transparently decompresses, but a proxy may hand the bytes over untouched.
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const snapshot = JSON.parse(text) as { schemaVersion?: number; revision?: string; tables?: Record<string, unknown>; assets?: SnapshotAssetRef[] };

    if (Number(snapshot.schemaVersion) > SCHEMA_VERSION) {
      const message = `Este espacio se publica con un esquema más reciente (v${snapshot.schemaVersion}) que el de esta instalación (v${SCHEMA_VERSION}). Actualiza Nodus para recibirlo.`;
      const refusedRevision = response.headers.get('x-nodus-revision') || snapshot.revision || null;
      if (refusedRevision) refusedSnapshots.set(vaultId, { revision: refusedRevision, message });
      throw new Error(message);
    }
    refusedSnapshots.delete(vaultId);

    const db = openReplicaDb(vault);
    if (!db) throw new Error('No se ha podido abrir la base de datos de la réplica.');
    applySnapshotToReplica(db, snapshot);
    // Recorded as soon as it is applied, not after the relay and the images. Those are
    // retried on their own on every tick (the 304 path pulls the relay too); leaving the
    // revision unrecorded when one of them threw made each retry download and re-apply the
    // whole unchanged publication for as long as that one failure lasted.
    const revision = response.headers.get('x-nodus-revision') || snapshot.revision || null;
    updateVaultRemote(vaultId, { lastPulledRevision: revision, lastPulledAt: new Date().toISOString() });
    await pullRelayOperations(vault, token, db, snapshot.revision ?? vault.remote.lastPulledRevision);

    // The JSON carries no binary by design, so the illustration of every Deep Research
    // report arrives as a row saying "ready" with nothing behind it. Fetch the bytes and
    // put them back, skipping whatever this replica already holds.
    const images = await downloadReplicaAssets(db, snapshot.assets ?? [], async (hash) => {
      try {
        const response = await request(`${endpoint}/assets/${hash}`, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
      } catch {
        // One unreachable image must not abort a publication that is otherwise complete;
        // the next pull sees the blob still missing and tries again.
        return null;
      }
    });
    runtime.lastImages = images;

    runtime.phase = 'ok';
    runtime.lastError = null;
    runtime.lastPulledAt = new Date().toISOString();

    await drainOutbox(vaultId);
  } catch (error) {
    runtime.phase = 'error';
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }
}

async function refreshRole(vault: VaultSummary, token: string): Promise<void> {
  try {
    const response = await request(`${normalizeUrl(vault.remote!.url)}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const value = await response.json() as { spaces?: { id: string; role: VaultRemoteRole }[] };
    const match = value.spaces?.find((space) => space.id === vault.remote!.spaceId);
    if (match && match.role !== vault.remote!.role) updateVaultRemote(vault.id, { role: match.role });
  } catch {
    // Offline: the stored role is advisory anyway, and the server re-checks every request.
  }
}

// ── Draining the outgoing queue ─────────────────────────────────────────────

/**
 * What the space at the other end says it will accept.
 *
 * Asked once per vault and kept, because it changes only when the server is upgraded. A server
 * too old to publish these answers `null` for them, and every use below falls back to a
 * conservative guess rather than to an assumption — see SAFE_BATCH_BYTES.
 */
const remoteLimits = new Map<string, { limits: RemoteMutationLimits; at: number }>();
/**
 * How long a remembered answer is trusted.
 *
 * Not forever, for two reasons that point the same way: the server may be upgraded under a
 * desktop that stays open for weeks, and the shrunken budget a 413 leaves behind would
 * otherwise never grow back even once the cause is gone.
 */
const LIMITS_TTL_MS = 60 * 60_000;

/**
 * What to send in one request to a server that has not told us its ceiling.
 *
 * Servers before 3.2.1 accepted a 2 MiB body and said so nowhere, so this stays under it. The
 * cost of guessing low is an extra request; the cost of guessing high was a 413 that marked
 * nothing, kept everything pending, and re-sent the identical batch every thirty seconds
 * forever. One of those is a queue that drains slowly and the other is a queue that never
 * drains at all.
 */
const SAFE_BATCH_BYTES = 1_500_000;

async function limitsFor(vault: VaultSummary, token: string): Promise<RemoteMutationLimits> {
  const cached = remoteLimits.get(vault.id);
  if (cached && Date.now() - cached.at < LIMITS_TTL_MS) return cached.limits;
  const fallback = LEGACY_SERVER_MUTATION_LIMITS;
  try {
    const response = await request(`${normalizeUrl(vault.remote!.url)}/api/v1/capabilities`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return fallback;
    const limits = negotiateRemoteMutationLimits(await response.json());
    remoteLimits.set(vault.id, { limits, at: Date.now() });
    return limits;
  } catch {
    // Offline. Not cached, so the next tick asks again.
    return fallback;
  }
}

/**
 * Image tables whose bytes travel on the asset channel, and the column that holds them.
 *
 * Every receiver of these rows requires the image's hash in `assets`: the owner's inbox
 * (inboxPoller hydrateImageMutations) and other replicas (pullRelayOperations) throw on a
 * row without it, and neither acknowledges past a throw. A desktop writer sent them with
 * the bytes stripped and no `assets`, so one edited illustration stopped the owner from
 * collecting anything else, from anyone, for good.
 */
const IMAGE_MUTATION_COLUMNS: Record<string, string> = { world_images: 'blob', map_images: 'blob', decorative_images: 'image_blob' };

function readImageBytes(db: Database.Database, table: string, column: string, rowKey: string): Buffer | null {
  let key: unknown[];
  try { key = JSON.parse(rowKey) as unknown[]; } catch { return null; }
  const identity = identityColumns(table, undefined, db);
  if (identity.length !== key.length) return null;
  const where = identity.map((name) => `${quoteIdentifier(name)} IS ?`).join(' AND ');
  const row = db.prepare(`SELECT ${quoteIdentifier(column)} AS data FROM ${quoteIdentifier(table)} WHERE ${where}`).get(...key) as { data: unknown } | undefined;
  return Buffer.isBuffer(row?.data) && row.data.length > 0 ? row.data : null;
}

/** Read the live row a queued entry points at, so what is sent is never a stale copy. */
function readRow(db: Database.Database, table: string, rowKey: string): Record<string, unknown> | null {
  let key: unknown[];
  try { key = JSON.parse(rowKey) as unknown[]; } catch { return null; }
  const identity = identityColumns(table, undefined, db);
  if (identity.length !== key.length) return null;
  const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
  const row = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`).get(...key) as Record<string, unknown> | undefined;
  if (!row) return null;
  // Exactly the filter a publication uses. The server checks an incoming row against the
  // shape of the last snapshot, so sending the raw SELECT * — embeddings, blobs and all —
  // would be refused for naming columns that deliberately never travel.
  return stripUnpublishableColumns(row);
}

export async function drainOutbox(vaultId: string): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault || vault.origin !== 'connected' || !vault.remote) return;
  const runtime = runtimeFor(vaultId);
  // Second of the three layers that stop a reader from sending. The first is the absence of
  // triggers in their database; the third is the server's own 403.
  if (vault.remote.role === 'reader' || vault.remote.state !== 'active') return;
  const token = getNodusServerTokenFor(vaultId);
  if (!token) return;

  const db = openReplicaDb(vault);
  if (!db) return;
  const pending = listPendingOutbox(db, OUTBOX_BATCH);
  const counts = countOutbox(db);
  runtime.pendingMutations = counts.pending;
  runtime.rejectedMutations = counts.rejected;
  if (pending.length === 0) return;

  const limits = await limitsFor(vault, token);
  const batchBudget = limits.maxMutationBatchBytes ?? SAFE_BATCH_BYTES;

  const mutations = [];
  const sendable: string[] = [];
  let batchBytes = 0;
  for (const entry of pending) {
    let key: unknown[];
    try { key = JSON.parse(entry.row_key) as unknown[]; } catch { continue; }
    const row = entry.op === 'upsert' ? readRow(db, entry.table_name, entry.row_key) : null;
    // An upsert whose row is gone was deleted after being queued; the delete entry that
    // replaced it carries the truth, so this one is simply dropped.
    if (entry.op === 'upsert' && !row) { markOutboxSent(db, [entry.id]); continue; }
    let documentHash: string | null = null;
    let blobHash: string | null = null;
    if (entry.op === 'upsert' && entry.table_name === 'page_document_updates') {
      const stored = db.prepare('SELECT update_blob, update_hash FROM page_document_updates WHERE id = ?').get(String(key[0] ?? '')) as {
        update_blob: Buffer; update_hash: string | null;
      } | undefined;
      if (!stored || !Buffer.isBuffer(stored.update_blob)) {
        markOutboxRejected(db, [entry.id], 'No se encuentran los bytes de esta actualización Yjs.');
        continue;
      }
      documentHash = stored.update_hash || createHash('sha256').update(stored.update_blob).digest('hex');
      if (row) row.update_hash = documentHash;
      try {
        const upload = await request(
          `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/document-updates/${documentHash}`,
          {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/octet-stream',
              'content-length': String(stored.update_blob.length),
            },
            body: stored.update_blob,
          },
        );
        if (!upload.ok) {
          runtime.lastError = `El servidor rechazó una actualización Yjs (HTTP ${upload.status}).`;
          return;
        }
      } catch (error) {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        return;
      }
    }
    if (entry.op === 'upsert' && entry.table_name === 'db_attachments' && row?.blob_hash) {
      blobHash = String(row.blob_hash);
      const stored = db.prepare('SELECT data FROM db_blobs WHERE hash = ?').get(blobHash) as { data: Buffer } | undefined;
      if (!stored || !Buffer.isBuffer(stored.data) || createHash('sha256').update(stored.data).digest('hex') !== blobHash) {
        markOutboxRejected(db, [entry.id], 'El archivo adjunto local no coincide con su hash.');
        continue;
      }
      const blobEndpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/blobs/${blobHash}`;
      try {
        const status = await request(`${blobEndpoint}/status`, { headers: { authorization: `Bearer ${token}` } });
        if (!status.ok) throw new Error(`HTTP ${status.status}`);
        const state = await status.json() as { complete?: boolean; received?: number[] };
        if (!state.complete) {
          const received = new Set(state.received ?? []);
          const totalChunks = Math.max(1, Math.ceil(stored.data.length / SHARED_BLOB_CHUNK_BYTES));
          for (let index = 0; index < totalChunks; index += 1) {
            if (received.has(index)) continue;
            const chunk = stored.data.subarray(index * SHARED_BLOB_CHUNK_BYTES, Math.min(stored.data.length, (index + 1) * SHARED_BLOB_CHUNK_BYTES));
            const chunkHash = createHash('sha256').update(chunk).digest('hex');
            const uploaded = await request(`${blobEndpoint}/chunks/${index}`, {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream',
                'content-length': String(chunk.length), 'x-nodus-total-chunks': String(totalChunks),
                'x-nodus-total-bytes': String(stored.data.length), 'x-nodus-chunk-sha256': chunkHash,
              },
              body: chunk,
            });
            if (!uploaded.ok) throw new Error(`chunk ${index}: HTTP ${uploaded.status}`);
          }
          const completed = await request(`${blobEndpoint}/complete`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
          if (!completed.ok) throw new Error(`complete: HTTP ${completed.status}`);
        }
      } catch (error) {
        runtime.lastError = `No se pudo reanudar el adjunto ${blobHash.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    }
    let assets: { hash: string }[] | null = null;
    const imageColumn = entry.op === 'upsert' ? IMAGE_MUTATION_COLUMNS[entry.table_name] : undefined;
    if (imageColumn) {
      const image = readImageBytes(db, entry.table_name, imageColumn, entry.row_key);
      if (!image) {
        markOutboxRejected(db, [entry.id], 'Esta imagen todavía no tiene sus bytes en este equipo y no puede enviarse sin ellos.');
        continue;
      }
      const imageHash = createHash('sha256').update(image).digest('hex');
      const assetEndpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/assets/${imageHash}`;
      try {
        const present = await request(assetEndpoint, { method: 'HEAD', headers: { authorization: `Bearer ${token}` } });
        if (!present.ok) {
          const upload = await request(assetEndpoint, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'content-length': String(image.length) },
            body: image,
          });
          if (upload.status === 413 || upload.status === 415) {
            // Deterministic: this server will never take these bytes. Kept and explained.
            const detail = await upload.json().catch(() => ({})) as { error_description?: string };
            markOutboxRejected(db, [entry.id], detail.error_description || `El servidor no acepta esta imagen (HTTP ${upload.status}).`);
            continue;
          }
          if (!upload.ok) {
            runtime.lastError = `El servidor rechazó una imagen (HTTP ${upload.status}).`;
            return;
          }
        }
      } catch (error) {
        runtime.lastError = error instanceof Error ? error.message : String(error);
        return;
      }
      assets = [{ hash: imageHash }];
    }
    const mutation = {
      id: entry.id,
      clientId: clientIdFor(vaultId),
      kind: entry.op,
      table: entry.table_name,
      key,
      ...(entry.op === 'upsert' ? { row } : {}),
      schemaVersion: entry.schema_version,
      createdAt: entry.created_at,
      actorId: entry.actor_id,
      deviceId: entry.device_id,
      hlc: entry.hlc,
      ...(documentHash ? { documentHash } : {}),
      ...(blobHash ? { blobHash } : {}),
      ...(assets ? { assets } : {}),
    };

    // Measured here, where the row is in hand. A Deep Research report is one row carrying its
    // whole markdown, so a queue of them is megabytes and counting entries says nothing about
    // the size of the request they make.
    const size = Buffer.byteLength(JSON.stringify(mutation), 'utf8');
    if (limits.maxMutationBytes !== null && size > limits.maxMutationBytes) {
      // Only when the server has actually told us its ceiling. Refusing a row locally against
      // a guessed limit would throw away work the server would have taken.
      markOutboxRejected(db, [entry.id], `Este cambio ocupa ${Math.round(size / 1024)} KB y el servidor acepta ${Math.round(limits.maxMutationBytes / 1024)} KB por fila.`);
      continue;
    }
    if (mutations.length >= limits.maxMutationBatch) break;
    // Always send at least one, so a row larger than a whole batch is still attempted rather
    // than blocking everything queued behind it.
    if (mutations.length > 0 && batchBytes + size > batchBudget) break;
    batchBytes += size;
    mutations.push(mutation);
    sendable.push(entry.id);
  }
  if (mutations.length === 0) {
    // Everything pending was refused locally for size. The counters still have to move, or
    // the interface goes on showing changes as queued when nothing is going to be sent.
    const afterRefusals = countOutbox(db);
    runtime.pendingMutations = afterRefusals.pending;
    runtime.rejectedMutations = afterRefusals.rejected;
    return;
  }

  try {
    const response = await request(
      `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/mutations`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mutations }) },
    );
    if (response.status === 401) { handleRevocation(vaultId, runtime); return; }
    if (response.status === 403) {
      // Downgraded mid-flight. The queue is kept and marked, never discarded: this is a
      // colleague's unsent work, and losing it silently is the failure to avoid.
      markOutboxRejected(db, sendable, 'Esta cuenta ya no tiene permiso de escritura en el espacio remoto.');
      updateVaultRemote(vaultId, { role: 'reader' });
      runtime.lastError = 'El servidor ha retirado el permiso de escritura. Tus cambios se conservan en este equipo, sin enviar.';
      return;
    }
    if (response.status === 409) {
      // Images referenced before their bytes arrived. Retried on the next tick.
      runtime.lastError = 'Faltan imágenes por subir antes de enviar estos cambios.';
      return;
    }
    if (response.status === 413) {
      // The batch was too big for this server as a whole. Nothing was stored and nothing is
      // marked, so the work is safe; what must not happen is re-sending the identical batch
      // every tick forever, which is exactly what this used to do. Halving the budget makes
      // the queue converge on a size this server will take.
      const shrunk = Math.max(64 * 1024, Math.floor(batchBudget / 2));
      remoteLimits.set(vault.id, { limits: { ...limits, maxMutationBatchBytes: shrunk }, at: Date.now() });
      runtime.lastError = `El servidor ha rechazado un envío de ${Math.round(batchBytes / 1024)} KB por tamaño. Se reintentará en envíos más pequeños.`;
      return;
    }
    if (response.status === 507) {
      // The space holds more undelivered changes than it is allowed to. Not a rejection: it
      // clears when the owner opens Nodus and collects, so the queue is kept whole.
      runtime.lastError = 'El espacio remoto acumula cambios que su propietario aún no ha recogido. Tus cambios se conservan y se reintentarán.';
      return;
    }
    if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);
    const value = await response.json() as { accepted?: string[]; duplicate?: string[]; rejected?: { id: string; reason: string; error_description?: string }[] };
    markOutboxSent(db, [...(value.accepted ?? []), ...(value.duplicate ?? [])]);
    // The server explains the reasons it can explain; the bare code is the fallback for the
    // ones it cannot, and for servers that do not send an explanation at all.
    for (const rejection of value.rejected ?? []) markOutboxRejected(db, [rejection.id], rejection.error_description ?? rejection.reason);
    pruneSentOutbox(db);
    // The batch went out, so whatever the last attempt complained about is over. Without this
    // the "sending in smaller batches" and "the owner has not collected yet" notices above
    // would survive the condition that caused them and sit on the panel indefinitely.
    runtime.lastError = null;
    const after = countOutbox(db);
    runtime.pendingMutations = after.pending;
    runtime.rejectedMutations = after.rejected;
  } catch (error) {
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }
}

const clientIds = new Map<string, string>();

/** Stable per installation and vault, so the server can attribute a batch to one replica. */
function clientIdFor(vaultId: string): string {
  let id = clientIds.get(vaultId);
  if (!id) { id = randomUUID(); clientIds.set(vaultId, id); }
  return id;
}

// ── Service lifecycle ───────────────────────────────────────────────────────

function connectedVaults(): VaultSummary[] {
  try { return listVaults().filter((vault) => vault.origin === 'connected' && vault.remote); }
  catch { return []; }
}

async function tick(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (const vault of connectedVaults()) {
      if (vault.remote?.state !== 'active') continue;
      await pullReplica(vault.id);
    }
  } finally {
    working = false;
  }
}

export function startReplicaSync(): void {
  stopReplicaSync();
  if (connectedVaults().length === 0) return;
  startReplicaEventWatchers();
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopReplicaSync(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null;
  firstTimer = null;
  stopReplicaEventWatchers();
  closeReplicaPool();
}

export function restartReplicaSync(): void {
  startReplicaSync();
}

export interface ReplicaConnection {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  isActiveVault: boolean;
  url: string;
  spaceName: string;
  serverName: string;
  userEmail: string;
  role: VaultRemoteRole;
  state: VaultRemote['state'];
  phase: ReplicaPhase;
  lastPulledAt: string | null;
  lastError: string | null;
  pendingMutations: number;
  rejectedMutations: number;
  /** Illustrations fetched on the last pull; zero once the replica holds them all. */
  lastImages: { downloaded: number; bytes: number; skipped: number } | null;
}

export function getReplicaOverview(): ReplicaConnection[] {
  return connectedVaults().map((vault) => {
    const runtime = runtimeFor(vault.id);
    return {
      vaultId: vault.id,
      vaultName: vault.name,
      vaultType: vault.type,
      isActiveVault: vault.active,
      url: vault.remote!.url,
      spaceName: vault.remote!.spaceName,
      serverName: vault.remote!.serverName,
      userEmail: vault.remote!.userEmail,
      role: vault.remote!.role,
      state: vault.remote!.state,
      phase: runtime.phase,
      lastPulledAt: vault.remote!.lastPulledAt ?? runtime.lastPulledAt,
      lastError: runtime.lastError,
      pendingMutations: runtime.pendingMutations,
      rejectedMutations: runtime.rejectedMutations,
      lastImages: runtime.lastImages,
    };
  });
}

export async function syncReplicaNow(vaultId: string): Promise<ReplicaConnection[]> {
  await pullReplica(vaultId, { force: true });
  return getReplicaOverview();
}

export async function listReplicaPresence(vaultId: string): Promise<ReplicaPresenceParticipant[]> {
  const vault = getVault(vaultId);
  const token = vault?.remote ? getNodusServerTokenFor(vaultId) : null;
  if (!vault?.remote || !token || vault.remote.state !== 'active') return [];
  const response = await request(
    `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/presence`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return [];
  return ((await response.json()) as { participants?: ReplicaPresenceParticipant[] }).participants ?? [];
}

export async function updateReplicaPresence(vaultId: string, input: ReplicaPresenceInput | null): Promise<ReplicaPresenceParticipant[]> {
  const vault = getVault(vaultId);
  const token = vault?.remote ? getNodusServerTokenFor(vaultId) : null;
  if (!vault?.remote || !token || vault.remote.state !== 'active') return [];
  const endpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/presence`;
  const response = await request(endpoint, input == null ? {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` },
  } : {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) return [];
  return listReplicaPresence(vaultId);
}

/**
 * Cut a replica loose and keep it as an ordinary local vault.
 *
 * The offer that makes a revocation survivable: the data is already here and already
 * complete, so all that has to happen is that it stops being a replica.
 */
export function detachReplica(vaultId: string): ReplicaConnection[] {
  const vault = getVault(vaultId);
  if (vault?.origin === 'connected') {
    clearNodusServerTokenFor(vaultId);
    updateVaultRemote(vaultId, { state: 'paused' });
    runtimeFor(vaultId).phase = 'paused';
  }
  return getReplicaOverview();
}

export { MUTABLE_TABLES };
