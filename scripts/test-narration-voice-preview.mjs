import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { loadTsStubbed } from './drift-test-utils.mjs';

test('saved voice previews pause, resume, switch voices and reset after completion or failure', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__narrationTestReact = React;
  const voices = ['one', 'two'].map(id => ({ id, name: id, language: 'es', origin: 'uploaded', durationS: 10 }));
  window.nodus = {
    ttsHasHuggingFaceToken: async () => false,
    ttsVoices: async () => voices,
    ttsDiskUsage: async () => null,
  };
  const { NarrationSettings } = await loadTsStubbed('src/views/NarrationSettings.tsx', { stubs: {
    '^react$': 'module.exports = globalThis.__narrationTestReact;',
    '/i18n$': 'exports.t = s => s; exports.tx = s => s;',
    '/components/ui$': 'exports.Icon = ({name}) => globalThis.__narrationTestReact.createElement("span", {"data-icon": name});',
    '/ConfirmModal$': 'exports.ConfirmModal = () => null;',
    '/media/LocalAudioRecorder$': 'exports.useLocalAudioRecorder = () => ({state: "idle"}); exports.LocalAudioRecorderPanel = () => null;',
    '/narration/voiceAudio$': 'exports.prepareReferenceAudio = () => {};',
    '/narration/ttsClient$': 'exports.subscribeTtsStatus = exports.subscribeTtsEvents = () => () => {}; exports.voiceUrl = id => "http://localhost/voice/" + id;',
  } });
  const root = createRoot(document.getElementById('root'));
  const settings = { audioSpeed: 1, ttsStreaming: true, ttsLanguage: 'auto', ttsIdleUnloadMin: 5, ttsVoiceId: 'one', ttsAcceptedLicenses: [] };
  const selections = [];
  try {
    await act(async () => root.render(React.createElement(NarrationSettings, { settings, patch: async value => selections.push(value) })));
    const audio = document.querySelector('[data-testid="narration-voices"] > audio');
    let paused = true;
    let rejectPlay = false;
    let sourceChanges = 0;
    Object.defineProperty(audio, 'paused', { get: () => paused });
    const src = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'src');
    Object.defineProperty(audio, 'src', { get: () => src.get.call(audio), set: value => { sourceChanges++; audio.currentTime = 0; src.set.call(audio, value); } });
    audio.play = async () => {
      if (rejectPlay) throw new Error('Unavailable recording');
      paused = false;
      audio.dispatchEvent(new window.Event('play'));
    };
    audio.pause = () => {
      paused = true;
      audio.dispatchEvent(new window.Event('pause'));
    };
    const button = id => document.querySelector(`[data-testid="narration-voice-${id}"] button`);
    const icon = id => button(id).querySelector('[data-icon]').dataset.icon;
    const click = async id => act(async () => button(id).click());
    assert.equal(icon('one'), 'play');
    await click('one');
    assert.equal(icon('one'), 'pause');
    assert.equal(button('one').getAttribute('aria-label'), 'Pausar');
    assert.deepEqual(selections, [], 'preview controls do not change the selected voice');
    audio.currentTime = 4.25;
    await click('one');
    assert.equal(paused, true);
    assert.equal(icon('one'), 'play');
    await click('one');
    assert.equal(audio.currentTime, 4.25, 'resuming keeps the playback position');
    assert.equal(sourceChanges, 1, 'resuming does not reload the audio');
    await click('two');
    assert.equal(icon('one'), 'play');
    assert.equal(icon('two'), 'pause');
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.src, 'http://localhost/voice/two');
    await act(async () => { paused = true; audio.dispatchEvent(new window.Event('ended')); });
    assert.equal(icon('two'), 'play');
    await click('two');
    await act(async () => { paused = true; audio.dispatchEvent(new window.Event('error')); });
    assert.equal(icon('two'), 'play');
    rejectPlay = true;
    await click('one');
    assert.equal(icon('one'), 'play', 'failed playback does not leave a pause icon');
    rejectPlay = false;
    await click('one');
    await act(async () => root.unmount());
    assert.equal(paused, true, 'leaving settings stops the recording');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.__narrationTestReact;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.window;
    delete globalThis.document;
  }
});
