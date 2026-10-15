import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-research-note-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    '--loader:.tsx=tsx', '--jsx=automatic', `--outfile=${bundle}`,
  ], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  return require(bundle);
}

test.after(() => rm(outDir, { recursive: true, force: true }));

test('generic citation markers use the interface language while names and targets survive',()=>{
 const {localizeResearchCitationLabels}=load('src/researchNoteProvenance.ts');
 const input='[fuente](nodus://passage/scope:1) [Carey, 2020](nodus://work/paper) [fuente](https://example.com)';
 assert.equal(localizeResearchCitationLabels(input,'Source'),'[Source](nodus://passage/scope:1) [Carey, 2020](nodus://work/paper) [fuente](https://example.com)');
 assert.equal(input,'[fuente](nodus://passage/scope:1) [Carey, 2020](nodus://work/paper) [fuente](https://example.com)');
});
test('captured answers preserve exact content and resolve structured study citations', () => {
  const { researchMessageReferences, researchNoteSource } = load('src/researchNoteProvenance.ts');
  const content = 'Texto exacto ([Web](https://example.com/a)).\n\nFuente [S1](nodus://study/evidence/S1).';
  const message = {
    id: 'answer-1', role: 'assistant', content,
    study: { citations: [{
      id: 'S1', sourceKey: 'material:1', indexId: 'idx-1', kind: 'material', sourceId: 'mat-1',
      title: 'Diapositivas', subtitle: 'Tema 2', quote: 'Una cita comprobable',
      location: { materialId: 'mat-1', slideNumber: 4 }, scope: { courseId: null, subjectId: null, folderId: null, topicId: null },
    }] },
  };
  assert.deepEqual(researchMessageReferences(message), [
    { label: 'Web', href: 'https://example.com/a' },
    { citationId: 'S1', label: 'Diapositivas', subtitle: 'Tema 2', quote: 'Una cita comprobable', href: 'nodus://study/material/mat-1' },
  ]);
  const source = researchNoteSource({ surface: 'study', conversationId: 'chat-1', conversationTitle: 'Tema 2', message, messageIndex: 3, model: null });
  assert.equal(message.content, content, 'capturing metadata never rewrites the answer');
  assert.equal(source.researchChat.messageIndex, 3);
  assert.equal(source.researchChat.references[1].citationId, 'S1');
});

test('the save confirmation stays open, identifies the destination and offers both next actions', async () => {
  const modal = await readFile(path.join(repoRoot, 'src/components/SaveToNotesModal.tsx'), 'utf8');
  assert.match(modal, /data-testid="save-note-success"/);
  assert.match(modal, /data-testid="save-note-destination"/);
  assert.match(modal, /data-testid="save-note-continue"/);
  assert.match(modal, /data-testid="save-note-open"/);
  assert.doesNotMatch(modal, /setTimeout\(onClose/);
});

test('saved-note provenance is visible and can return to the exact conversation message', async () => {
  const panel = await readFile(path.join(repoRoot, 'src/components/ResearchNoteProvenancePanel.tsx'), 'utf8');
  const assistant = await readFile(path.join(repoRoot, 'src/views/ResearchAssistantModal.tsx'), 'utf8');
  const notesExport = await readFile(path.join(repoRoot, 'electron/export/notesExport.ts'), 'utf8');
  assert.match(panel, /research-note-open-conversation/);
  assert.match(panel, /note\.createdAt/);
  assert.match(assistant, /target\.messageIndex/);
  assert.match(assistant, /data-message-id/);
  assert.match(assistant, /scrollIntoView/);
  assert.match(notesExport, /source: note\.source \?\? undefined/);
  assert.match(notesExport, /\*\*Procedencia:\*\*/);
});

test('an answer saved as a study note keeps the answer and carries its provenance', () => {
  const { buildStudyNoteDocument } = load('src/studyNoteFromChat.ts');
  const content = '# Tema 2\n\nLa fórmula es $C_nH_{2n}O_2$.';
  const source = {
    origin: 'assistant',
    model: { provider: 'anthropic', model: 'claude-sonnet-4' },
    researchChat: {
      surface: 'study', conversationId: 'chat-1', conversationTitle: 'Química orgánica',
      messageId: 'answer-1', messageIndex: 2,
      references: [
        { label: 'Diapositivas', subtitle: 'Tema 2', href: 'nodus://study/material/mat-1' },
        { label: 'Sin enlace' },
      ],
    },
  };
  const document = buildStudyNoteDocument({
    title: 'Tema 2',
    content,
    source,
    placement: { courseId: 'course-1', subjectId: 'subject-1', folderId: 'folder-1', topicId: null },
    savedAt: '2026-09-17T10:00:00.000Z',
  });
  assert.equal(document.kind, 'apunte', 'the captured note is a study note, not a workspace note');
  assert.deepEqual(document.placement, { courseId: 'course-1', subjectId: 'subject-1', folderId: 'folder-1', topicId: null });
  assert.ok(document.contentMarkdown.startsWith(content), 'the answer opens the note unchanged');
  assert.match(document.contentMarkdown, /\n---\n\n\*\*Procedencia:\*\*/);
  assert.match(document.contentMarkdown, /- Conversación: Química orgánica/);
  assert.match(document.contentMarkdown, /- Guardada: 2026-09-17T10:00:00\.000Z/);
  assert.match(document.contentMarkdown, /- Modelo: anthropic \/ claude-sonnet-4/);
  assert.match(document.contentMarkdown, /\[Diapositivas\]\(nodus:\/\/study\/material\/mat-1\) — Tema 2/);
  assert.match(document.contentMarkdown, /- Sin enlace/);
});

test('the study chat offers the vault own notes as a save destination', async () => {
  const modal = await readFile(path.join(repoRoot, 'src/components/SaveToNotesModal.tsx'), 'utf8');
  const assistant = await readFile(path.join(repoRoot, 'src/views/ResearchAssistantModal.tsx'), 'utf8');
  const chat = await readFile(path.join(repoRoot, 'src/views/StudyChatView.tsx'), 'utf8');
  assert.match(modal, /data-testid="save-note-destination-study"/);
  assert.match(modal, /data-testid="save-note-study-subject"/);
  assert.match(modal, /createStudyDocument\(buildStudyNoteDocument\(\{/);
  assert.match(modal, /announceStudyWorkspaceChanged\(\)/);
  assert.match(assistant, /studyDocument=\{studyNoteDestination\}/);
  assert.match(chat, /studyNoteDestination=\{\{ onOpenSavedDocument: onOpenDocument \}\}/);
});
