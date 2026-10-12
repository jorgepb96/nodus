// A local edit to a Nodi note must be stamped newer than the copy it replaces, even when that
// copy came from a device whose clock runs ahead; otherwise newest-wins sync discards the edit.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-nodi-skew-'));
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Module = require('node:module');
const rows = new Map();
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/nodiNotesDb')) return {
    selectNote: (id) => rows.get(id) ?? null,
    upsertNote: (note) => rows.set(note.id, { ...note }),
    selectLiveNotes: () => [...rows.values()].filter((note) => !note.deletedAt),
    mergeIncoming: () => 0,
  };
  return load.call(this, request, parent, isMain);
};
const notes = require(path.join(root, 'electron/nodiNotes.ts'));

test('edit and delete are stamped after a copy from a fast clock', () => {
  const ahead = Date.now() + 120_000;
  rows.set('n1', { id: 'n1', title: 'phone', titleExplicit: false, content: 'phone text', createdAt: ahead, updatedAt: ahead, deletedAt: null });
  const saved = notes.saveNodiNote({ id: 'n1', content: 'desktop edit' });
  assert.ok(saved.updatedAt > ahead, `edit stamped ${saved.updatedAt}, server copy ${ahead}`);
  notes.deleteNodiNote('n1');
  assert.ok(rows.get('n1').updatedAt > saved.updatedAt, 'the deletion is newer than the edit');
});
