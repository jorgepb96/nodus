// Nodi's notes: every local change is sent, however many there are and whatever the clocks say.
//
// syncNodiNotes picked what to send with `updated_at > lastSyncedAt` and then set
// lastSyncedAt to the SERVER's time. Two consequences:
//   • only the first 200 changes (oldest first) are sent per exchange, and the watermark then
//     jumps past the rest, so a first sync of 201..500 notes never sends the newest ones;
//   • `updated_at` is this machine's clock and the watermark is the server's, so a desktop
//     whose clock runs behind never sends an edit made within that lag after a sync.
//
// No network: fetch is replaced by a fake that records what arrives and answers with a
// server time, which is all the exchange uses.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-nodi-notes-watermark')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodi-notes-watermark-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const notesModule = require(path.join(repoRoot, 'electron/nodiNotes.ts'));
const dbModule = require(path.join(repoRoot, 'electron/nodiNotesDb.ts'));
const syncModule = require(path.join(repoRoot, 'electron/serverSync/nodiNotesSync.ts'));

const received = new Map();
let serverClockOffsetMs = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init = {}) => {
  const { notes } = JSON.parse(String(init.body));
  for (const note of notes) received.set(note.id, note);
  return new Response(JSON.stringify({ notes: [], serverTime: Date.now() + serverClockOffsetMs }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

test.after(async () => {
  globalThis.fetch = originalFetch;
  dbModule.closeNodiDb();
  await rm(userData, { recursive: true, force: true });
});

const target = { url: 'https://sync.invalid', token: 'device-token' };

test('a first sync of more than one batch eventually sends every note', async () => {
  for (let index = 0; index < 250; index += 1) notesModule.saveNodiNote({ title: `Nota ${index}`, content: `Cuerpo ${index}` });
  for (let round = 0; round < 3 && syncModule.nodiNotesPending(target.url); round += 1) {
    const result = await syncModule.syncNodiNotes(target);
    assert.equal(result.error, null, result.error ?? '');
  }
  assert.equal(received.size, 250, `only ${received.size} of 250 notes ever reached the server`);
  assert.equal(syncModule.nodiNotesPending(target.url), false);
});

test('an edit made on a desktop whose clock runs behind the server is still sent', async () => {
  // The server's clock is ten minutes ahead of this machine's.
  serverClockOffsetMs = 10 * 60_000;
  const note = notesModule.saveNodiNote({ title: 'Reloj', content: 'antes' });
  await syncModule.syncNodiNotes(target);
  assert.equal(received.get(note.id)?.content, 'antes');

  // Edited a moment later, by this machine's (slow) clock.
  await new Promise((resolve) => setTimeout(resolve, 5));
  notesModule.saveNodiNote({ id: note.id, title: 'Reloj', content: 'después' });
  assert.equal(syncModule.nodiNotesPending(target.url), true, 'the edit is not seen as pending');
  await syncModule.syncNodiNotes(target);
  assert.equal(received.get(note.id)?.content, 'después', 'the edit never reached the server');
});
