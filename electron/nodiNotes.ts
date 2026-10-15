import crypto from 'node:crypto';
import { deriveNodiNoteTitle } from '@shared/nodiNotes';
import type { NodiNote, NodiNoteInput } from '@shared/types';
import { mergeIncoming, selectLiveNotes, selectNote, upsertNote, type StoredNodiNote } from './nodiNotesDb';

// Quick Markdown notes for the Nodi companion.
//
// The store is `nodi.sqlite` in the user-data directory — install-wide, not per-vault — so a
// jot survives vault switches and app restarts, and so the same notes are there whichever
// corpus is open. See `electron/nodiNotesDb.ts` for why it is a table of its own rather than
// a row in somebody's vault.
//
// This file keeps the shape the companion and the IPC layer already call, so nothing above
// it had to change when the JSON file became a table.

const MAX_NOTES = 500;

/**
 * The stamp for a local write. Sync merges newest-wins, so an edit has to be newer than the
 * copy it replaces even when that copy came from a device whose clock runs ahead; a plain
 * Date.now() would lose the edit to the server's older text on the next pull.
 */
function nextStamp(existing: StoredNodiNote | null): number {
  return Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
}

function normalize(note: StoredNodiNote): NodiNote {
  return {
    id: note.id,
    title: note.title,
    titleExplicit: note.titleExplicit,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function listNodiNotes(): NodiNote[] {
  return selectLiveNotes(MAX_NOTES).map(normalize);
}

export function saveNodiNote(input: NodiNoteInput): NodiNote {
  const existing = input.id ? selectNote(input.id) : null;
  const now = nextStamp(existing);
  const content = typeof input.content === 'string' ? input.content : '';
  const explicitTitle = String(input.title || '').trim();
  const note: StoredNodiNote = {
    id: existing?.id ?? String(input.id || crypto.randomUUID()),
    title: (explicitTitle || deriveNodiNoteTitle(content)).slice(0, 100),
    titleExplicit: Boolean(explicitTitle),
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Writing to a note that was deleted brings it back, which is what editing one means.
    deletedAt: null,
  };
  upsertNote(note);
  return normalize(note);
}

/**
 * Delete a note.
 *
 * A tombstone rather than a `DELETE`: these notes travel between a person's devices, and an
 * absent row is indistinguishable from one the other device has not heard about yet. The row
 * keeps its id and its timestamps and loses its content, which is the part that was private.
 */
export function deleteNodiNote(id: string): void {
  const existing = selectNote(id);
  if (!existing) return;
  const now = nextStamp(existing);
  upsertNote({ ...existing, title: '', content: '', updatedAt: now, deletedAt: now });
}

/** Apply notes that arrived from the Nodus Server. Used by the sync lane only. */
export function applyRemoteNodiNotes(notes: StoredNodiNote[]): number {
  return mergeIncoming(notes);
}
