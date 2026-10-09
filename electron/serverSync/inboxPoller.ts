import { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { getDb } from '../db/database';
import { listServerInbox, recordServerInbox } from '../db/serverInboxRepo';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { applyIncomingMutations, type IncomingMutation } from './mutationInbox';
import { applyPublishedLibraryAnnotationMutation } from '../libraryReader/libraryReaderStore';
import { isPublishing, markVaultDirty, noteVaultInbox } from './serverSyncService';
import { fetchWithTimeout, normalizeUrl, readVaultConfig } from './serverSyncShared';
import { drainOneSpaceAction } from './spaceActionProcessor';
import { drainAccountLibrary } from './accountLibrarySync';

/**
 * Drain the mutation ledger on this desktop's own timer.
 *
 * This used to live inside publishVault, which meant it ran only when the active vault got
 * dirty (sixty seconds of quiet, two minutes since the last upload) or when somebody
 * pressed "Publish now". An INCOMING mutation dirties nothing, so after the startup pass an
 * idle desktop collected nothing, ever: a report sent from the phone sat in the ledger
 * until its owner happened to edit something. That is the hole this closes.
 *
 * It is a separate module, and separate on purpose. serverSyncService has a module-level
 * `publishing` flag and its own autoSync gates, and both are precisely what receiving has
 * to get past.
 */

// Reader state is interactive collaboration, not background maintenance. Two seconds keeps
// read flags, translations and annotations close to the keystroke that created them while the
// durable ledger still remains the source of truth when either device is offline.
const TICK_MS = 2_000;
/** Offset from the publisher's first tick so both jobs do not collide at launch. */
const FIRST_TICK_MS = 2_500;
/**
 * How many mutations to ask for at a time.
 *
 * The old code sent neither `since` nor `limit` and ignored the `hasMore` the server
 * returns, so a phone that had queued four hundred reports would have them applied in one
 * synchronous burst on the single thread every window's IPC passes through. That is the
 * beachball. The server clamps this to 1..200 itself.
 */
const BATCH = 25;
/** 8 × 25 = 200 mutations per tick. Whatever is left waits for the next two-second pass. */
const MAX_BATCHES_PER_TICK = 8;

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;

/**
 * Image bytes never ride inside a mutation row. A mobile writer first uploads the image to the
 * content-addressed asset channel and then references that hash from a `world_images` or
 * `map_images` mutation. The owner Desktop resolves it here, verifies it again, and only then
 * lets the canonical SQLite upsert see a blob.
 */
const MISSING_IMAGE_ASSET = 'La imagen llegó sin referencia a sus bytes y no puede guardarse. Quien la envió debe volver a guardarla con una versión actual de Nodus.';

async function hydrateImageMutations(
  mutations: IncomingMutation[], base: string, spaceId: string, token: string,
): Promise<void> {
  for (const mutation of mutations) {
    if (mutation.kind !== 'upsert' || !['world_images', 'map_images', 'decorative_images'].includes(mutation.table)) continue;
    const hash = String(mutation.assets?.[0]?.hash ?? '');
    // No asset named at all is not going to change on a retry: refuse it, so it is reported
    // and acknowledged instead of stopping every later mutation behind it for good.
    if (!/^[0-9a-f]{64}$/.test(hash)) { mutation.refusal = MISSING_IMAGE_ASSET; continue; }
    const response = await fetchWithTimeout(
      `${base}/api/v1/spaces/${encodeURIComponent(spaceId)}/assets/${hash}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'image/*' } },
    );
    if (!response.ok) throw new Error(`world_image_asset_http_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('world_image_hash_mismatch');
    mutation.row = mutation.table === 'decorative_images'
      ? { ...(mutation.row ?? {}), image_blob: bytes, thumbnail_blob: bytes }
      : { ...(mutation.row ?? {}), blob: bytes, bytes: bytes.length };
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Drain once, right now, instead of waiting for the timer.
 *
 * Exported so the round-trip can be exercised without sleeping through a thirty-second
 * interval — the timer's own behaviour is the interval, not what one pass does.
 */
export async function drainServerInboxNow(): Promise<void> {
  await tick();
}

async function tick(): Promise<void> {
  // A publication holds the database for a long synchronous stretch inside
  // buildServerSnapshot; there is nothing to interleave with, so wait for the next tick.
  if (isPublishing() || draining) return;

  let config;
  try { config = readVaultConfig(getActiveVault()); }
  catch { return; }
  // `enabled` IS the pause switch, and it pauses the whole conversation with the server.
  if (!config.configured || !config.enabled) return;
  // NOT gated on autoSync. That switch means "publish automatically"; refusing to RECEIVE
  // because the user paused outbound publishing is a different promise, one they never
  // made. Collaborators' work would pile up in the ledger with nothing to say so.
  const token = getNodusServerTokenFor(config.vaultId);
  if (!token) return;

  let base: string;
  try { base = normalizeUrl(config.url); } catch { return; }
  const endpoint = `${base}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/mutations`;
  const db = getDb();

  draining = true;
  try {
    // Both server transports expose the typed action endpoint. Older deployments answer 404;
    // mutation delivery proceeds exactly as before in that case.
    await drainOneSpaceAction(config).catch(() => undefined);
    await drainAccountLibrary(config).catch(() => undefined);
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
      // No `since`. ledger.compact removes the file once it empties and nextSeq recomputes
      // from what is left, so sequence numbers RESTART AT 1 after a full compaction — a
      // remembered cursor would then skip real work. Everything still in the ledger is, by
      // construction, everything not yet acknowledged. This looks like an oversight and is
      // not one.
      const response = await fetchWithTimeout(`${endpoint}?limit=${BATCH}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      // A server that predates the ledger has no such route, and a device without the
      // right to read it gets 403. Neither is worth retrying inside this tick.
      if (response.status === 404 || response.status === 403 || !response.ok) return;
      const value = await response.json() as { mutations?: IncomingMutation[]; hasMore?: boolean };
      const mutations = value.mutations ?? [];
      if (mutations.length === 0) return;

      await hydrateImageMutations(mutations, base, config.spaceId, token);

      // The user can switch vaults across any of these awaits, and `db` was resolved before
      // the first one. Applying one space's mutations to a different corpus would be a
      // genuine data loss, not a glitch, so a switch abandons the batch: nothing was
      // acknowledged, and the newly opened vault's own poller picks up its own ledger.
      if (getActiveVault().id !== config.vaultId) return;

      // Synchronous, and deliberately so: applyIncomingMutations opens a transaction per
      // mutation, and better-sqlite3 forbids awaiting inside a db.transaction() callback.
      const summary = applyIncomingMutations(db, mutations, { external: applyPublishedLibraryAnnotationMutation });
      recordServerInbox(summary.entries, { spaceId: config.spaceId });
      noteVaultInbox(config.vaultId, {
        applied: summary.applied,
        deleted: summary.deleted,
        keptLocal: summary.keptLocal,
        refused: summary.refused.length,
      });

      if (summary.cursor > 0) {
        const acknowledgement = await fetchWithTimeout(`${endpoint}/ack`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ cursor: summary.cursor }),
        });
        if (!acknowledgement.ok) throw new Error(`El servidor no confirmó la recepción (HTTP ${acknowledgement.status}).`);
      }
      // What arrived has to travel back out to everyone else, and only a publication does
      // that. This is what publishVault's own collect step used to guarantee.
      if (summary.applied + summary.deleted > 0) markVaultDirty(config.vaultId);
      if (summary.entries.length > 0) broadcastInboxChanged();
      // The reports the phone sends land in writing_saved_drafts, and the gallery is not
      // watching the table. Without this it appears only when the view is remounted.
      if (summary.entries.some((entry) => entry.table === 'writing_saved_drafts' && (entry.outcome === 'applied' || entry.outcome === 'deleted'))) {
        broadcast('writing:saved:changed', null);
      }
      if (summary.entries.some((entry) => entry.table.startsWith('dictionary_')
        && !['dictionary_retrieval_state', 'dictionary_corpus_changes'].includes(entry.table)
        && (entry.outcome === 'applied' || entry.outcome === 'deleted'))) {
        broadcast('dictionary:changed', null);
      }
      if (summary.entries.some((entry) => ['writing_draft_reads', 'content_translations', 'decorative_images'].includes(entry.table)
        && (entry.outcome === 'applied' || entry.outcome === 'deleted'))) {
        // An open report is derived from the saved-draft list. Re-reading that list replaces
        // its value in place, so read state, translations and cover changes become visible
        // without backing out to the gallery.
        broadcast('writing:saved:changed', null);
      }
      if (summary.entries.some((entry) => entry.table === 'content_translations'
        && (entry.outcome === 'applied' || entry.outcome === 'deleted'))) {
        broadcast('translations:changed', [null, null]);
      }
      if (summary.entries.some((entry) => entry.table === 'writing_draft_annotations' && (entry.outcome === 'applied' || entry.outcome === 'deleted'))) {
        // A deletion carries only its annotation id, so the renderer treats null as
        // "refresh the report you currently have open". Upserts could be narrowed by
        // draft_id, but one channel shape keeps both paths honest.
        broadcast('writing:annotations:changed', null);
      }

      // Permanent refusals advance past poison rows. Operational failures do not: retry the
      // first one on a later poll without losing it or processing out of order beyond it.
      if (summary.retryable.length > 0 || summary.refused.length > 0) break;
      if (!value.hasMore) break;
      // The only real yield in this loop. better-sqlite3 is synchronous, so without an
      // actual await the main process never returns to its event loop and every window
      // freezes for the duration. It reads like ceremony. It is not.
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  } catch {
    // Nothing was acknowledged, so nothing was lost; the next tick asks again.
  } finally {
    draining = false;
  }
}

/** Push the current vault's inbox to every window. */
export function broadcastInboxChanged(): void {
  let entries;
  try { entries = listServerInbox(); } catch { return; }
  broadcast('nodusServer:inbox:changed', entries);
}

/**
 * Start draining, and drain once shortly afterwards.
 *
 * Called wherever the publisher is started, including on a vault switch — which is what
 * makes a newly opened vault collect what is waiting for it rather than sitting on it for
 * up to thirty seconds.
 */
export function startInboxPolling(): void {
  stopInboxPolling();
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

export function stopInboxPolling(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null;
  firstTimer = null;
}
