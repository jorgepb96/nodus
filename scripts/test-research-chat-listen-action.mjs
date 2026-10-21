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
  assert.ok(modal.indexOf('research-chat-header-listen') > modal.indexOf('<AcademicSecondary compact={simpleInterface}'),
    'the listen action is the rightmost header control');
  const headerCss = read('src/views/researchAssistant.css');
  assert.match(headerCss, /\.research-assistant-actions \.concilium-control > \.concilium-trigger \{ box-sizing: border-box; height: 36px;/, 'Concilium matches the 36px header controls');
  assert.match(headerCss, /\.research-assistant-actions \.concilium-control \{ flex: 0 0 auto; \}/, 'Concilium keeps its full width beside the rightmost listen action');
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

test('the per-answer listen action plays directly while the header keeps the config balloon', () => {
  assert.match(modal, /testId="research-chat-listen"[\s\S]{0,80}\bdirect\b/,
    'the message action opts into direct playback');
  assert.match(listen, /if \(direct\) void directStart\(\); else setOpen/,
    'it does not open the balloon');
  assert.match(listen, /const directStart = async \(\) =>/);
  assert.match(listen, /if \(playable\.length\) \{ player\.play\(playable, 0, source\); return; \}/,
    'a saved clip plays immediately');
  assert.match(listen, /LoadingRing/);
  assert.match(listen, /playbackFraction/, 'the playing ring follows playback progress');
  assert.match(listen, /inline-grid h-6 w-6 place-items-center/, 'the icon is centred in a square ring');
  assert.match(modal, /testId="research-chat-header-listen"[\s\S]{0,120}autoStart/,
    'the header action still opens the balloon and starts');
});


test('the balloon exposes translated play, pause and restart icon buttons', () => {
  assert.match(listen, /data-testid="listen-play"/);
  assert.match(listen, /data-testid="listen-pause"/);
  assert.match(listen, /data-testid="listen-restart"/);
  assert.match(listen, /title=\{t\('Pausar'\)\}/);
  assert.match(listen, /title=\{t\('Reiniciar'\)\}/);
  assert.match(listen, /const transportPlay = \(\) =>/);
  assert.match(listen, /const transportPause = \(\) =>/);
  assert.match(listen, /const transportRestart = \(\) =>/);
});
