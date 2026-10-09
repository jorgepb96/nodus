import { applyRemoteNodiNotes } from '../nodiNotes';
import { readMeta, selectNotesChangedSince, writeMeta, type StoredNodiNote } from '../nodiNotesDb';

/**
 * Nodi's quick notes, kept level between a person's devices.
 *
 * Everything else this service syncs is a *space*: the owner publishes a snapshot, replicas
 * read it, and a writer's changes go through the mutation ledger. Nodi's notes are the one
 * thing that is not a space at all — they belong to the account and follow the person across
 * every vault — so they have their own route (`/api/v1/nodi/notes`) and their own exchange,
 * which is one request:
 *
 *   POST everything that changed here since the last sync → the server merges it into
 *   everything that changed anywhere else, and answers with what changed there since the
 *   same moment.
 *
 * Both sides merge by the same rule, newest wins and a deletion wins a tie, so the exchange
 * is safe to repeat and safe to interrupt. The reference is the *server's* clock, handed
 * back as `serverTime`: comparing a phone's idea of "now" against a desktop's is how a
 * device with a skewed clock silently stops seeing other people's notes.
 *
 * The connection is borrowed rather than configured. Any vault already connected to a Nodus
 * Server has a device token for it, and the token names the account — which is all this
 * resource needs. The first configured connection wins; syncing the same notes once per
 * vault would be the same work several times over.
 */

const LAST_SYNC_KEY = 'lastSyncedAt';
const LAST_SERVER_KEY = 'lastSyncedServer';
/**
 * How far this machine's own changes have been sent, on THIS machine's clock.
 *
 * Kept apart from LAST_SYNC_KEY on purpose. That one is the server's clock and answers
 * "what has the server got that I have not seen"; comparing a local `updated_at` against it
 * meant a desktop running behind the server never sent an edit made within its lag after a
 * sync, and that jumping it to the server's "now" skipped every change past the first batch.
 */
const LAST_SENT_KEY = 'lastSentUpdatedAt';
const REQUEST_TIMEOUT_MS = 20_000;
/** Ample for text, and a hard stop on a runaway note. */
const MAX_BATCH = 200;

export interface NodiNotesSyncTarget {
  url: string;
  token: string;
}

export interface NodiNotesSyncResult {
  sent: number;
  applied: number;
  serverTime: number | null;
  error: string | null;
}

interface WireNote {
  id: string;
  title: string;
  titleExplicit: boolean;
  content: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

function toWire(note: StoredNodiNote): WireNote {
  return {
    id: note.id,
    title: note.title,
    titleExplicit: note.titleExplicit,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}

function fromWire(value: unknown): StoredNodiNote | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '');
  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);
  if (!id || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  return {
    id,
    title: String(raw.title ?? ''),
    titleExplicit: raw.titleExplicit === true,
    content: String(raw.content ?? ''),
    createdAt,
    updatedAt,
    deletedAt: raw.deletedAt == null ? null : Number(raw.deletedAt),
  };
}

/**
 * The moment the last exchange happened, on the server's clock.
 *
 * Reset when the server changes, because "since 1 800 000 000 000" means nothing to a
 * machine that has never seen this install: without the reset, moving to another server
 * would hide every note older than the switch.
 */
function since(url: string): number {
  if (readMeta(LAST_SERVER_KEY) !== url) return 0;
  const stored = Number(readMeta(LAST_SYNC_KEY));
  return Number.isFinite(stored) ? stored : 0;
}

/** The local `updated_at` up to which this machine's changes have reached `url`. */
function sentUpTo(url: string): number {
  if (readMeta(LAST_SERVER_KEY) !== url) return 0;
  const stored = Number(readMeta(LAST_SENT_KEY));
  return Number.isFinite(stored) ? stored : 0;
}

export async function syncNodiNotes(target: NodiNotesSyncTarget): Promise<NodiNotesSyncResult> {
  const from = since(target.url);
  const sentFrom = sentUpTo(target.url);
  const changed = selectNotesChangedSince(sentFrom);
  const outgoing = changed.slice(0, MAX_BATCH);
  const truncated = changed.length > outgoing.length;

  try {
    const response = await fetch(`${target.url}/api/v1/nodi/notes?since=${from}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ notes: outgoing.map(toWire) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { sent: 0, applied: 0, serverTime: null, error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { notes?: unknown[]; serverTime?: number };
    const incoming = Array.isArray(body.notes)
      ? body.notes.map(fromWire).filter((note): note is StoredNodiNote => note !== null)
      : [];
    const applied = applyRemoteNodiNotes(incoming);

    const serverTime = Number(body.serverTime);
    if (Number.isFinite(serverTime)) {
      writeMeta(LAST_SERVER_KEY, target.url);
      writeMeta(LAST_SYNC_KEY, String(serverTime));
      // Advance only over what was actually sent. A cut batch stops one millisecond short of
      // its last note, so a note sharing that timestamp beyond the cut goes in the next one.
      const last = outgoing.at(-1)?.updatedAt;
      const sent = last === undefined ? sentFrom : truncated ? Math.max(sentFrom, last - 1) : Math.max(sentFrom, last);
      writeMeta(LAST_SENT_KEY, String(sent));
    }
    return { sent: outgoing.length, applied, serverTime: Number.isFinite(serverTime) ? serverTime : null, error: null };
  } catch (error) {
    // Offline is the ordinary case. Nothing was acknowledged, so the next tick sends the
    // same batch again — which is safe, because the merge is idempotent.
    return { sent: 0, applied: 0, serverTime: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether anything is waiting to go out, so a tick can skip the request entirely. */
export function nodiNotesPending(url: string): boolean {
  return selectNotesChangedSince(sentUpTo(url)).length > 0;
}
