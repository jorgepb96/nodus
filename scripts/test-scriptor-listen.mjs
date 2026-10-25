// Nodus Scriptor reads aloud with the same narration system as Research chat: a header
// button opens the Listen balloon (saved clips, kept or deleted after a day), and the
// selection toolbar reads the selected text at once without saving anything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const editor = read('src/components/editor/StudyEditor.tsx');
const chrome = read('src/components/workspace/EditorialChrome.tsx');
const listen = read('src/components/narration/Listen.tsx');
const narrate = read('src/lib/narration/narrate.ts');

test('the Scriptor header opens the Listen balloon for the document', () => {
  assert.match(editor, /trailing=\{<ListenButton bare testId="scriptor-header-listen"[^>]*open=\{listenOpen\} onOpenChange=\{setListen\} target=\{listenTarget\} \/>\}/);
  assert.doesNotMatch(listen, /autoStart/, 'opening the balloon never starts playback or generation');
  assert.match(chrome, /\{trailing\}<button className="editorial-header-action editorial-header-icon" aria-label=\{contextLabel\}/,
    'it sits in the header, before Context and Focus');
  assert.match(editor, /kind: 'scriptor_document', id: `\$\{active\.id\}:\$\{listenVersion\}`/,
    'every version of the text is narrated on its own');
  assert.match(editor, /const setListen = \(open: boolean\) => \{ if \(open\) setListenVersion\(hashString\(draft\)\); setListenOpen\(open\); \};/,
    'the version is fixed when the balloon opens, not on every keystroke');
});

test('«Lectura por voz» opens the same balloon in notes and keeps the study panel in study documents', () => {
  assert.match(editor, /const studyNarration = port\.referenceKind !== 'note';/);
  assert.match(editor, /if \(!studyNarration\) \{ setListen\(!listenOpen\); return; \}/);
  assert.match(editor, /\{studyNarration && showAudio && <div[^>]*data-testid="study-audio-panel"><AudioPanel/);
});

test('the selection toolbar reads the selection once, without saving it', () => {
  assert.match(editor, /\{selectionListen\(selectionImprove\.target\.text, 'toolbar-item study-selection-tool study-selection-listen'\)\}/);
  assert.match(editor, /\{selectionListen\(selectionImprove\.target\.text, 'scriptor-raw-polish scriptor-raw-listen'\)\}/,
    'raw Markdown mode has it beside «Pulir»');
  assert.match(editor, /kind: 'scriptor_selection'[\s\S]{0,160}ephemeral: true \}/);
  assert.match(editor, /<ListenButton bare direct testId="study-selection-listen"[^>]*label=\{t\('Leer la selección en voz alta'\)\} onUnavailable=\{\(\) => setListen\(true\)\}/,
    'without an engine it opens the balloon that installs one');
  assert.match(listen, /if \(target\.ephemeral\) \{ player\.cancelGeneration\(\); startNarration\(player, input, source\); return; \}/,
    'a new selection replaces the one still being generated');
  assert.match(narrate, /\.\.\.\(input\.ephemeral \? \{\} : \{ save: /, 'an ephemeral narration sends no save');
  assert.match(listen, /onPointerDown=\{bare \? \(event\) => \{ if \(event\.button === 0\) event\.preventDefault\(\); \} : undefined\}/,
    'clicking it keeps the editor selection and the toolbar');
});
