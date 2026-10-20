// The listen balloon's voice selector: a styled top-layer list with a search box and
// model/language filters. This guards the controls and the cross-model selection path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const picker = read('src/components/narration/VoicePicker.tsx');
const listen = read('src/components/narration/Listen.tsx');
const css = read('src/components/narration/voicePicker.css');

test('the voice picker has a search box and model/language filters', () => {
  assert.match(picker, /data-testid="listen-voice-search"/);
  assert.match(picker, /data-testid="listen-voice-filter-model"/);
  assert.match(picker, /data-testid="listen-voice-filter-language"/);
  assert.match(picker, /option\.engine !== engine/, 'the model filter narrows the list');
  assert.match(picker, /option\.voice\.language !== language/, 'the language filter narrows the list');
  assert.match(picker, /normalize\(\[option\.voice\.name/, 'search covers name and metadata');
  assert.match(picker, /role="option"/);
  assert.match(picker, /aria-selected=\{active\}/);
  assert.match(picker, /showPopover\(\)/, 'the list escapes the balloon scroll container');
  assert.match(css, /\.voice-picker-popover/);
  assert.match(css, /\.voice-picker-trigger/);
});

test('choosing a voice also chooses the downloaded model that speaks it', () => {
  assert.match(listen, /<VoicePicker options=\{voiceOptions\}/);
  assert.match(listen, /const voiceOptions = voices\.flatMap/);
  assert.match(listen, /ttsModelId: option\.modelId/);
  assert.match(listen, /candidates\.find\(\(entry\) => entry\.languages\.length === 1\)/,
    'Phonon prefers its per-language checkpoint');
  assert.match(listen, /downloadedModels\.some\(\(entry\) => entry\.id === modelId\)/,
    'the model select never shows a missing checkpoint as a downloaded value');
});

test('Escape closes only the picker, leaving the listen balloon open', () => {
  assert.match(picker, /event\.key === 'Escape' && open/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  assert.match(picker, /close\(\)/);
});
