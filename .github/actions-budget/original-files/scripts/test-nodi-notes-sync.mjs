// Nodi's notes, from the desktop's side.
//
// The phone half is verified by driving the app; this is the other end of the same wire. It
// runs the REAL desktop modules — the table, the store the companion calls, and the sync lane
// — against a REAL Nodus Server process, and asks the only question that matters: does a note
// written on one device turn up on the other, and does a deletion travel too?
//
// Everything here happens in an isolated user-data directory, never the installation's own.
// A test profile called `nodus` once shadowed the real install and took its API keys with it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { withServer } from './lib/nodusServerHarness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// better-sqlite3 in this repo is built against Electron's ABI, not the system Node's, so the
// desktop's own table cannot be opened from plain `node`. Re-exec under Electron-as-Node and
// let that run do the work.
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-nodi-notes')) {
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodi-notes-desktop-'));
// The hooks make `electron` and `@shared/*` resolvable and transpile `.ts` on demand, so
// what runs below is the production code rather than a copy of it.
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

const notesModule = require(path.join(repoRoot, 'electron/nodiNotes.ts'));
const dbModule = require(path.join(repoRoot, 'electron/nodiNotesDb.ts'));
const syncModule = require(path.join(repoRoot, 'electron/serverSync/nodiNotesSync.ts'));

test.after(async () => {
  dbModule.closeNodiDb();
  await rm(userData, { recursive: true, force: true });
});

test('a note written on the desktop reaches the server, and one written elsewhere comes back', async () => {
  await withServer({ label: 'nodi-desktop' }, async (context) => {
    const spaceId = await context.createSpace('Principal');
    const { deviceToken: token } = await context.deviceToken(
      context.adminEmail, context.adminPassword, spaceId
    );
    const target = { url: context.origin, token };

    // 1) The companion writes one, exactly as the "Notas rápidas" panel does.
    const written = notesModule.saveNodiNote({ title: '', content: 'Revisar el álbum de 1949' });
    assert.equal(written.title, 'Revisar el álbum', 'the title is derived from the first words');

    const up = await syncModule.syncNodiNotes(target);
    assert.equal(up.error, null, up.error ?? '');
    assert.equal(up.sent, 1);

    const onServer = await context.api(token, 'GET', '/api/v1/nodi/notes');
    const body = await onServer.json();
    assert.equal(body.total, 1);
    assert.equal(body.notes[0].content, 'Revisar el álbum de 1949');

    // 2) Another device — the phone — writes one straight to the server.
    const fromPhone = {
      id: 'from-phone', title: 'Desde el móvil', titleExplicit: true,
      content: 'Pedir el catálogo de postales', createdAt: Date.now(), updatedAt: Date.now(),
      deletedAt: null,
    };
    await context.api(token, 'POST', '/api/v1/nodi/notes', { json: { notes: [fromPhone] } });

    // 3) The next tick brings it down into the desktop's own table.
    const down = await syncModule.syncNodiNotes(target);
    assert.equal(down.error, null, down.error ?? '');
    assert.equal(down.applied, 1);

    const local = notesModule.listNodiNotes();
    assert.equal(local.length, 2, 'both notes are in Nodi now');
    assert.ok(
      local.some((note) => note.content === 'Pedir el catálogo de postales'),
      'the note written on the phone is the one Nodi shows'
    );
  });
});

test('a deletion travels rather than being undone by the other device', async () => {
  await withServer({ label: 'nodi-desktop-delete' }, async (context) => {
    const spaceId = await context.createSpace('Principal');
    const { deviceToken: token } = await context.deviceToken(
      context.adminEmail, context.adminPassword, spaceId
    );
    const target = { url: context.origin, token };

    const note = notesModule.saveNodiNote({ title: 'Para borrar', content: 'Cuerpo' });
    await syncModule.syncNodiNotes(target);

    // Deleted on the desktop…
    notesModule.deleteNodiNote(note.id);
    assert.ok(!notesModule.listNodiNotes().some((entry) => entry.id === note.id));
    const pushed = await syncModule.syncNodiNotes(target);
    assert.equal(pushed.error, null, pushed.error ?? '');

    // …and the server holds a tombstone rather than the note.
    // About this note rather than about the count: the three tests here share one desktop
    // database on purpose — that is what a real install has — so a fresh server also
    // receives whatever the earlier tests wrote.
    const seen = await (await context.api(token, 'GET', '/api/v1/nodi/notes')).json();
    const tombstone = seen.notes.find((entry) => entry.id === note.id);
    assert.ok(
      !seen.notes.some((entry) => entry.id === note.id && entry.deletedAt === null),
      'the note is no longer live on the server'
    );
    assert.ok(tombstone, 'the deletion is remembered, so an offline device learns of it');
    assert.equal(tombstone.content, '', 'and it carries nothing that was private');

    // A later sync must not resurrect it.
    await syncModule.syncNodiNotes(target);
    assert.ok(!notesModule.listNodiNotes().some((entry) => entry.id === note.id));
  });
});

test('the exchange is safe to repeat, because both sides merge by the same rule', async () => {
  await withServer({ label: 'nodi-desktop-idempotent' }, async (context) => {
    const spaceId = await context.createSpace('Principal');
    const { deviceToken: token } = await context.deviceToken(
      context.adminEmail, context.adminPassword, spaceId
    );
    const target = { url: context.origin, token };

    notesModule.saveNodiNote({ title: 'Una', content: 'Primera' });
    await syncModule.syncNodiNotes(target);
    const before = notesModule.listNodiNotes().length;

    for (let round = 0; round < 3; round += 1) await syncModule.syncNodiNotes(target);
    assert.equal(notesModule.listNodiNotes().length, before, 'nothing was duplicated');

    const server = await (await context.api(token, 'GET', '/api/v1/nodi/notes')).json();
    assert.equal(server.total, before);
  });
});
