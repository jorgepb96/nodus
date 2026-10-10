import { applyRemoteNodiNotes } from '../nodiNotes';
import { readMeta, selectNote, selectNotesChangedSince, writeMeta, type StoredNodiNote } from '../nodiNotesDb';
import { createHash } from 'node:crypto';

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
const SENT_NOTES_KEY = 'sentNoteFingerprints';
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
  status?: number;
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

function fingerprint(note: StoredNodiNote): string {
  return createHash('sha256').update(JSON.stringify(toWire(note))).digest('hex');
}

function sentNotes(url: string): Record<string, string> {
  try {
    const state = JSON.parse(readMeta(SENT_NOTES_KEY) || '{}') as { url?: string; notes?: Record<string, string> };
    return state.url === url && state.notes ? state.notes : {};
  } catch { return {}; }
}

export async function syncNodiNotes(target: NodiNotesSyncTarget): Promise<NodiNotesSyncResult> {
  const from = since(target.url);
  // The server's clock is a read cursor, not an acknowledgement for unsent local notes.
  // Remember actual content sent so batches >200 and clocks in the future both converge.
  const sent = sentNotes(target.url);
  const outgoing = selectNotesChangedSince(0).filter((note) => sent[note.id] !== fingerprint(note)).slice(0, MAX_BATCH);

  try {
    const response = await fetch(`${target.url}/api/v1/nodi/notes?since=${from}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ notes: outgoing.map(toWire) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { sent: 0, applied: 0, serverTime: null, error: `HTTP ${response.status}`, status: response.status };
    }
    const body = (await response.json()) as { notes?: unknown[]; serverTime?: number; rejected?: Array<{ id: string }> };
    const incoming = Array.isArray(body.notes)
      ? body.notes.map(fromWire).filter((note): note is StoredNodiNote => note !== null)
      : [];
    const applied = applyRemoteNodiNotes(incoming);
    const rejected = new Set((body.rejected || []).map((note) => note.id));
    for (const note of outgoing) if (!rejected.has(note.id)) sent[note.id] = fingerprint(note);
    for (const note of incoming) {
      const local = selectNote(note.id);
      if (local && fingerprint(local) === fingerprint(note)) sent[note.id] = fingerprint(local);
    }
    writeMeta(SENT_NOTES_KEY, JSON.stringify({ url: target.url, notes: sent }));

    const serverTime = Number(body.serverTime);
    if (Number.isFinite(serverTime)) {
      writeMeta(LAST_SERVER_KEY, target.url);
      writeMeta(LAST_SYNC_KEY, String(serverTime));
    }
    return { sent: outgoing.length - rejected.size, applied, serverTime: Number.isFinite(serverTime) ? serverTime : null,
      error: rejected.size ? 'El servidor rechazó una o más notas pendientes.' : null };
  } catch (error) {
    // Offline is the ordinary case. Nothing was acknowledged, so the next tick sends the
    // same batch again — which is safe, because the merge is idempotent.
    return { sent: 0, applied: 0, serverTime: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether anything is waiting to go out, so a tick can skip the request entirely. */
export function nodiNotesPending(url: string): boolean {
  const sent = sentNotes(url);
  return selectNotesChangedSince(0).some((note) => sent[note.id] !== fingerprint(note));
}
