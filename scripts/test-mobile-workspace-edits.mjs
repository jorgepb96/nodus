import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-workspace-edits')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-workspace-edits-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url);
let database;
try {
  database = require('../electron/db/database.ts');
  const { getActiveVault, createVault, setActiveVault } = require('../electron/vaults/vaultRegistry.ts');
  const notes = require('../electron/db/notesRepo.ts');
  const workspace = require('../electron/db/workspaceRepo.ts');
  const { markdownToBlockNote } = require('../shared/blockNoteDocument.ts');
  const { applyWorkspaceEdit } = require('../electron/desktopBridge/workspaceEdits.ts');
  const first = getActiveVault(), other = createVault('Otra bóveda aislada');
  const scoped = work => database.withVaultDatabase(first.id, () => work(database.getDb()));
  const note = await scoped(() => notes.createNote({ title: 'Documento móvil', content: 'Original' }));
  const original = await scoped(() => workspace.getWorkspaceNoteEditorData(note.id));
  const markdown = '# Documento móvil\n\nConserva [fuente](nodus://evidence/source) y $x^2$.\n\n| a | b |\n| --- | --- |\n| 37 | 2024 |';
  const nativeDocument = markdownToBlockNote(markdown);
  const request = { id: randomUUID(), noteId: note.id, input: { title: 'Documento móvil', contentMarkdown: markdown, nativeDocument, schemaVersion: 2, expectedRevision: original.revision } };
  const saved = await applyWorkspaceEdit(first.id, 'phone-grant', request);
  assert.equal(saved.id, request.id); assert.equal(saved.editorData.revision, original.revision + 1);
  assert.deepEqual(saved.editorData.nativeDocument, nativeDocument);
  const history = saved.editorData.versions.length;
  const replay = await applyWorkspaceEdit(first.id, 'phone-grant', { ...request, input: Object.fromEntries(Object.entries(request.input).reverse()) });
  assert.deepEqual(replay, saved, 'A lost acknowledgement must return the original commit');
  assert.equal((await scoped(() => workspace.getWorkspaceNoteEditorData(note.id))).versions.length, history);
  await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', { ...request, input: { ...request.input, title: 'Changed payload' } }), /idempotency_conflict/);
  const mac = await scoped(() => workspace.updateWorkspaceNote(note.id, { ...request.input, title: 'Edición del Mac', expectedRevision: saved.editorData.revision }));
  const conflictId = randomUUID();
  await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', { ...request, id: conflictId }), error => {
    assert.equal(error.code, 'revision_conflict'); assert.equal(error.remote.revision, mac.editorRevision);
    assert.equal(error.remote.documentTitle, 'Edición del Mac'); return true;
  });
  assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM desktop_workspace_edit_receipts WHERE request_id=?').get(conflictId).n), 0, 'A conflict has no commit receipt');
  await scoped(() => workspace.createWorkspaceAnnotation(note.id, { from: 0, to: 8, selectedText: 'Conserva', comment: 'Locked passage', locked: true }));
  const invalidId = randomUUID();
  await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', { id: invalidId, noteId: note.id, input: { title: 'Invalid edit', contentMarkdown: 'Removed', nativeDocument: markdownToBlockNote('Removed'), schemaVersion: 2, expectedRevision: mac.editorRevision } }), /bloqueado/);
  assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM desktop_workspace_edit_receipts WHERE request_id=?').get(invalidId).n), 0, 'Invalid structured edits never commit a receipt');
  assert.equal((await scoped(() => workspace.getWorkspaceNoteEditorData(note.id))).revision, mac.editorRevision);
  await assert.rejects(applyWorkspaceEdit(other.id, 'phone-grant', request), /document_unavailable/);
  database.closeDb(); setActiveVault(other.id);
  assert.deepEqual(await applyWorkspaceEdit(first.id, 'phone-grant', request), saved, 'A restart and active-vault switch retain the original scoped receipt');
  const folder = await scoped(() => notes.createNoteFolder({ name: 'Creación companion' }));
  const createdId = randomUUID();
  const createdNativeDocument = markdownToBlockNote(markdown);
  const creation = { id: randomUUID(), noteId: createdId, creation: { kind: 'markdown', folderId: folder.id, tags: ['offline'] },
    input: { ...request.input, nativeDocument: createdNativeDocument, title: 'Creada en el móvil', expectedRevision: 0 } };
  const created = await applyWorkspaceEdit(first.id, 'phone-grant', creation);
  assert.equal(created.note.id, createdId); assert.equal(created.note.folderId, folder.id);
  assert.deepEqual(created.note.tags, ['offline']); assert.deepEqual(created.editorData.nativeDocument, createdNativeDocument);
  assert.deepEqual(await applyWorkspaceEdit(first.id, 'phone-grant', creation), created, 'Creation replays its canonical receipt without another note');
  assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM notes WHERE id=?').get(createdId).n), 1);
  assert.equal((await scoped(() => workspace.getWorkspaceNoteEditorData(createdId))).versions.length, created.editorData.versions.length);
  const collision = { ...creation, id: randomUUID() };
  await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', collision), /identity_conflict/);
  assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM desktop_workspace_edit_receipts WHERE request_id=?').get(collision.id).n), 0);
  for (const invalidCreation of [{ ...creation.creation, kind: 'idea' }, { ...creation.creation, source: { ref: 'private' } }, { ...creation.creation, tags: [37] }]) {
    await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', { ...creation, id: randomUUID(), noteId: randomUUID(), creation: invalidCreation }), /invalid_workspace_creation/);
  }
  for (const invalid of [
    { creation: { ...creation.creation, folderId: randomUUID() } },
    { input: { ...creation.input, nativeDocument: [{ id: 'invalid-block', type: 'unsupported-private-block' }] } },
    { input: { ...creation.input, nativeDocument } },
  ]) {
    const rejected = { ...creation, ...invalid, id: randomUUID(), noteId: randomUUID() };
    await assert.rejects(applyWorkspaceEdit(first.id, 'phone-grant', rejected));
    assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM notes WHERE id=?').get(rejected.noteId).n), 0, 'Invalid creations roll back the note and its complete structured editor');
    assert.equal(await scoped(db => db.prepare('SELECT COUNT(*) n FROM desktop_workspace_edit_receipts WHERE request_id=?').get(rejected.id).n), 0);
  }
  console.log(JSON.stringify({ passed: true, structuredContentPreserved: true, atomicCanonicalReceipt: true, retryWithoutRevisionOrHistoryDuplicate: true, changedPayloadRefused: true, conflictPreservesBothDocuments: true, lockedFragmentRollback: true, isolatedVaults: 2, reopenedReceipt: true, stableCreationIdentity: true,creationRollbackForInvalidStructureAndCollection: true,providerCalls: 0, releaseApproved: false }));
} finally {
  try { database?.closeDb(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
