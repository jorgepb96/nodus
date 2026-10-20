// The Research chat header has a one-click listen action for the latest finished answer:
// it opens the same Listen balloon, starts a saved clip when there is one, and otherwise
// starts generation. The per-message icon keeps opening the balloon without auto-starting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const modal = read('src/views/ResearchAssistantModal.tsx');
const listen = read('src/components/narration/Listen.tsx');

test('the Research chat header narrates the latest finished answer', () => {
  assert.match(modal, /testId="research-chat-header-listen"/);
  assert.match(modal, /<ListenButton[\s\S]{0,120}toolbar[\s\S]{0,120}autoStart/);
  assert.match(modal, /message\.role === 'assistant' && !message\.error && message\.content\.trim\(\) && message\.id !== streamingId/,
    'only a completed, non-empty assistant answer is offered');
  assert.match(modal, /markdown: \(\) => researchChatPresentation\(latestListenMessage\)\.content/,
    'it narrates exactly what is on screen');
  assert.match(modal, /latestListenTarget && <ListenButton/,
    'the action is hidden until there is an answer');
});

test('the header action opens the balloon and starts playback or generation once', () => {
  assert.match(listen, /autoStart\?: boolean/);
  assert.match(listen, /if \(!clipsLoaded \|\| !settings \|\| !status\) return;/,
    'it waits for clips and engine status before choosing');
  assert.match(listen, /if \(playable\.length\) \{ player\.play\(playable, 0, source\); return; \}/,
    'an existing clip plays immediately');
  assert.match(listen, /if \(!ready\) \{ autoStarted\.current = true; return; \}/,
    'without a ready engine it leaves the configuration visible');
  assert.match(listen, /narrate\(\);/,
    'with no clip it starts generation');
  assert.match(listen, /autoStarted\.current = true;/,
    'the effect is one-shot');
});
