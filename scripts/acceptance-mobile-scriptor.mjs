import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scriptor-fixture-'));
installRuntimeHooks(scratch);
const { markdownToBlockNote } = createRequire(import.meta.url)('../shared/blockNoteDocument.ts');
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const client = await connectAcceptanceBridge('Scriptor document acceptance');
try {
  const title = 'Aceptación Scriptor móvil 0.1.0';
  const tree = await client.operation('getNotesTree');
  const note = tree.notes.find(note => note.title === title) ?? await client.operation('createNote', [{ title, kind: 'note', content: '# Documento de aceptación\n\nPárrafo escrito en el Mac para comprobar la edición móvil.\n\n| Fuente | Evidencia |\n| --- | --- |\n| Libro | Cita |\n\n$$E=mc^2$$', tags: ['mobile-acceptance'] }]);
  assert(note.id);
  let editor = await client.operation('getWorkspaceNoteEditorData', [note.id]);
  if (!editor.nativeDocument || process.env.NODUS_ACCEPTANCE_RESET_SCRIPTOR === '1') {
    await client.operation('updateWorkspaceNote', [note.id, { title, contentMarkdown: '# Documento de aceptación\n\nPárrafo escrito en el Mac para comprobar la edición móvil.\n\n| Fuente | Evidencia |\n| --- | --- |\n| Libro | Cita |\n\n$$E=mc^2$$', nativeDocument: markdownToBlockNote('# Documento de aceptación\n\nPárrafo escrito en el Mac para comprobar la edición móvil.\n\n| Fuente | Evidencia |\n| --- | --- |\n| Libro | Cita |\n\n$$E=mc^2$$'), expectedRevision: editor.revision, reason: 'manual' }]);
    editor = await client.operation('getWorkspaceNoteEditorData', [note.id]);
  }
  assert(editor.nativeDocument?.length > 2, 'Scriptor must open an actual structured BlockNote document');
  const expectedEdit = process.env.NODUS_ACCEPTANCE_EXPECTED_EDIT;
  if (expectedEdit) {
    assert(editor.contentMarkdown.includes(expectedEdit), 'The exact edit made by XCTest must have reached the owning Mac vault');
    assert(JSON.stringify(editor.nativeDocument).includes(expectedEdit));
    assert(editor.nativeDocument.some(block => block.type === 'table'), 'Editing text must preserve the structured table');
    assert(JSON.stringify(editor.nativeDocument).includes('E=mc^2'), 'Editing text must preserve the formula');
    assert(editor.versions.length > 0, 'The saved document must retain its version history');
    const result = { result: 'passed', noteId: note.id, expectedEdit, editorRevision: editor.revision, blockCount: editor.nativeDocument.length, versions: editor.versions.length, verification: 'Actual owning Mac document after mobile XCTest save and reopen' };
    fs.writeFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/scriptor-save-acceptance-result.json`, JSON.stringify(result,null,2), { mode: 0o600 });
    console.log(JSON.stringify(result));
  }
  fs.writeFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/scriptor-fixture.json`, JSON.stringify({ noteId: note.id, title, editorRevision: editor.revision }), { mode: 0o600 });
  if (!expectedEdit) console.log(JSON.stringify({ prepared: true, noteId: note.id, blockCount: editor.nativeDocument.length }));
} finally { await client.close(); fs.rmSync(scratch, {recursive:true,force:true}); }
